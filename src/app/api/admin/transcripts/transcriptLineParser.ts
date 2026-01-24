import Papa from 'papaparse'
import { read, utils } from 'xlsx'

export type ParsedTranscriptLine = {
  line: number
  speaker: string | null
  utterance: string
  segment: string | null
  inCue: number | null
  outCue: number | null
}

export type ParsedTranscriptFile = {
  lines: ParsedTranscriptLine[]
  segmentColumnPresent: boolean
}

export class TranscriptParsingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptParsingError'
  }
}

type ColumnKey = 'line' | 'speaker' | 'utterance' | 'segment' | 'inCue' | 'outCue'

type ColumnMap = Partial<Record<ColumnKey, number>>

const REQUIRED_COLUMNS: ColumnKey[] = ['line', 'speaker', 'utterance']

const COLUMN_MATCHERS: Record<ColumnKey, string[]> = {
  line: ['linenumber', 'line', 'line#', '#', 'linenumber#'],
  speaker: ['speaker'],
  utterance: ['utterance', 'dialogue', 'dialog', 'text'],
  segment: ['segment'],
  inCue: ['incue', 'in cue', 'in_cue', 'in-cue', 'in'],
  outCue: ['outcue', 'out cue', 'out_cue', 'out-cue', 'out'],
}

const normalizeHeader = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/[()]/g, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase()

const hasContent = (value: unknown) => String(value ?? '').trim().length > 0

const detectHeaderRow = (rows: unknown[][]) => {
  const index = rows.findIndex((row) => Array.isArray(row) && row.some(hasContent))
  if (index === -1) {
    throw new TranscriptParsingError('Transcript file is empty or missing headers.')
  }

  return { index, row: rows[index] }
}

const mapColumns = (headerRow: unknown[]): ColumnMap => {
  const mapping: ColumnMap = {}

  headerRow.forEach((cell, columnIndex) => {
    const normalized = normalizeHeader(cell)
    if (!normalized) {
      return
    }

    ;(Object.entries(COLUMN_MATCHERS) as [ColumnKey, string[]][]).forEach(
      ([column, matchers]) => {
        if (mapping[column] !== undefined) {
          return
        }

        if (matchers.some((matcher) => normalized === matcher)) {
          mapping[column] = columnIndex
        }
      },
    )
  })

  return mapping
}

const parseLineNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  const stringValue = String(value ?? '').trim()
  if (!stringValue) {
    return null
  }

  const parsed = Number.parseInt(stringValue, 10)
  if (Number.isNaN(parsed)) {
    return null
  }

  return parsed
}

const toNullableString = (value: unknown) => {
  const trimmed = String(value ?? '').trim()
  return trimmed.length ? trimmed : null
}

const parseSmpteTimecodeToSeconds = (value: string, fps = 30): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed.replace(/;/g, ':')
  if (!normalized.includes(':')) {
    return null
  }

  const parts = normalized.split(':').map((part) => part.trim())
  if (parts.length < 3 || parts.length > 4) {
    return null
  }

  const [hoursPart, minutesPart, secondsPart, framesPart] =
    parts.length === 4 ? parts : [parts[0], parts[1], parts[2], '0']

  const hours = Number.parseInt(hoursPart, 10)
  const minutes = Number.parseInt(minutesPart, 10)
  const seconds = Number.parseInt(secondsPart, 10)
  const frames = Number.parseInt(framesPart ?? '0', 10)

  if (
    [hours, minutes, seconds, frames].some((segment) => Number.isNaN(segment))
  ) {
    return null
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds + frames / fps
  return Number.isFinite(totalSeconds) ? totalSeconds : null
}

const parseCueValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2))
  }

  const trimmed = String(value ?? '').trim()
  if (!trimmed) {
    return null
  }

  const parsedTimecode = parseSmpteTimecodeToSeconds(trimmed)
  if (parsedTimecode !== null) {
    return Number(parsedTimecode.toFixed(2))
  }

  const parsed = Number.parseFloat(trimmed)
  if (Number.isNaN(parsed)) {
    return null
  }

  return Number(parsed.toFixed(2))
}

const getFileExtension = (fileName: string) =>
  fileName.split('.').pop()?.toLowerCase() ?? ''

const parseCsvRows = async (file: File): Promise<unknown[][]> => {
  const text = await file.text()
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  })

  if (parsed.errors.length > 0) {
    throw new TranscriptParsingError(parsed.errors[0]?.message || 'Unable to read CSV file.')
  }

  return Array.isArray(parsed.data) ? parsed.data : []
}

const parseSpreadsheetRows = async (file: File): Promise<unknown[][]> => {
  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = read(buffer, { dense: true })
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    throw new TranscriptParsingError('The spreadsheet does not contain any sheets.')
  }

  const worksheet = workbook.Sheets[sheetName]
  return utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
  }) as unknown[][]
}

const parseRows = async (file: File): Promise<unknown[][]> => {
  const extension = getFileExtension(file.name)
  if (extension === 'xls' || extension === 'xlsx') {
    return parseSpreadsheetRows(file)
  }

  return parseCsvRows(file)
}

export const parseTranscriptFile = async (
  file: File,
): Promise<ParsedTranscriptFile> => {
  const rows = await parseRows(file)
  const { index: headerIndex, row: headerRow } = detectHeaderRow(rows)
  const columnMap = mapColumns(headerRow)
  const segmentColumnPresent = columnMap.segment !== undefined

  const missing = REQUIRED_COLUMNS.filter((column) => columnMap[column] === undefined)
  if (missing.length > 0) {
    throw new TranscriptParsingError(
      `Transcript file is missing required columns: ${missing.join(', ')}.`,
    )
  }

  const parsedLines: ParsedTranscriptLine[] = []

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!Array.isArray(row)) {
      continue
    }

    const lineNumber = parseLineNumber(row[columnMap.line!])
    const utterance = toNullableString(row[columnMap.utterance!])
    if (lineNumber === null || !utterance) {
      continue
    }

    const speaker = toNullableString(row[columnMap.speaker!])
    const segment =
      columnMap.segment !== undefined ? toNullableString(row[columnMap.segment]) : null
    const inCue =
      columnMap.inCue !== undefined ? parseCueValue(row[columnMap.inCue]) : null
    const outCue =
      columnMap.outCue !== undefined ? parseCueValue(row[columnMap.outCue]) : null

    parsedLines.push({
      line: lineNumber,
      speaker,
      utterance,
      segment,
      inCue,
      outCue,
    })
  }

  if (parsedLines.length === 0) {
    throw new TranscriptParsingError(
      'No transcript lines found. Ensure the file has populated line numbers and utterances.',
    )
  }

  return { lines: parsedLines, segmentColumnPresent }
}
