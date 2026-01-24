import Papa from 'papaparse'
import { read, utils } from 'xlsx'

const SUPPORTED_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const SUPPORTED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const REQUIRED_HEADER_GROUPS = [
  {
    label: 'Line number (#)',
    matchers: ['linenumber', '#'],
  },
  {
    label: 'Speaker',
    matchers: ['speaker'],
  },
  {
    label: 'Dialogue or Utterance',
    matchers: ['dialogue', 'utterance'],
  },
] as const

const normalizeHeaderValue = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()

const hasContent = (value: unknown) => String(value ?? '').trim().length > 0

const extractFirstPopulatedRow = (rows: unknown[]): string[] => {
  for (const row of rows) {
    if (Array.isArray(row) && row.some(hasContent)) {
      return row.map((cell) => String(cell ?? '').trim())
    }
  }
  return []
}

const extractCsvHeaders = async (file: File): Promise<string[]> => {
  try {
    const text = await file.text()
    const parsed = Papa.parse<string[]>(text, {
      preview: 1,
      skipEmptyLines: 'greedy',
    })

    if (!Array.isArray(parsed.data)) {
      return []
    }

    return extractFirstPopulatedRow(parsed.data)
  } catch (error) {
    console.error('Failed to parse CSV headers', error)
    return []
  }
}

const extractExcelHeaders = async (file: File): Promise<string[]> => {
  try {
    const buffer = await file.arrayBuffer()
    const workbook = read(buffer, { dense: true })
    const sheetName = workbook.SheetNames[0]

    if (!sheetName) {
      return []
    }

    const worksheet = workbook.Sheets[sheetName]
    const rows = utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    }) as unknown[]

    return extractFirstPopulatedRow(rows)
  } catch (error) {
    console.error('Failed to parse spreadsheet headers', error)
    return []
  }
}

const getFileExtension = (file: File) => file.name.split('.').pop()?.toLowerCase() ?? ''

const getHeadersForFile = async (file: File): Promise<string[]> => {
  const extension = getFileExtension(file)

  if (extension === 'xls' || extension === 'xlsx') {
    return extractExcelHeaders(file)
  }

  return extractCsvHeaders(file)
}

const evaluateRequiredHeaders = (headers: string[]) => {
  const normalized = headers
    .map(normalizeHeaderValue)
    .filter((value) => Boolean(value))

  const headerSet = new Set(normalized)

  const missingLabels = REQUIRED_HEADER_GROUPS.filter(
    (group) => !group.matchers.some((matcher) => headerSet.has(matcher)),
  ).map((group) => group.label)

  return {
    hasAllRequiredHeaders: missingLabels.length === 0,
    missingLabels,
  }
}

export const SPREADSHEET_ACCEPT = '.csv,.xls,.xlsx'
export const SPREADSHEET_HELP_TEXT = 'CSV or Excel files (.csv, .xls, .xlsx)'
export const SPREADSHEET_FILE_ERROR_MESSAGE =
  'Please upload a CSV or Excel file (.csv, .xls, .xlsx).'

export const isAllowedSpreadsheetFile = (file: File) => {
  const extension = getFileExtension(file)
  if (SUPPORTED_EXTENSIONS.has(extension)) {
    return true
  }

  const mimeType = file.type?.toLowerCase()
  if (mimeType && SUPPORTED_MIME_TYPES.has(mimeType)) {
    return true
  }

  return false
}

export const validateTranscriptSpreadsheet = async (file: File) => {
  if (!isAllowedSpreadsheetFile(file)) {
    return {
      isValid: false,
      error: SPREADSHEET_FILE_ERROR_MESSAGE,
    }
  }

  const headers = await getHeadersForFile(file)
  if (headers.length === 0) {
    return {
      isValid: false,
      error:
        'Could not detect any column headers. Ensure the first row lists Line number (#), Speaker, and Dialogue or Utterance.',
    }
  }

  const { hasAllRequiredHeaders, missingLabels } = evaluateRequiredHeaders(headers)
  if (!hasAllRequiredHeaders) {
    const missingSummary = missingLabels.join(', ')
    return {
      isValid: false,
      error: `Missing required column${missingLabels.length > 1 ? 's' : ''}: ${missingSummary}. Include Line number (#), Speaker, and Dialogue or Utterance.`,
    }
  }

  return { isValid: true as const }
}

