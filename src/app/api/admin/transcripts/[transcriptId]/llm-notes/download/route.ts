import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { utils, write } from 'xlsx'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type NoteRecord = {
  note_id: string
  note_number: number
  title: string
  q1: string
  q2: string
  q3: string
}

const sanitizeFileName = (value: string, fallback: string) => {
  const trimmed = value.trim().replace(/[/\\]/g, '-')
  const normalized = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  return normalized || fallback
}

const buildDownloadName = (transcriptTitle?: string | null) => {
  const transcriptSegment =
    transcriptTitle?.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '') ||
    'llm-notes'

  const baseName = sanitizeFileName(`${transcriptSegment}-llm-notes`, 'llm-notes')
  return baseName.toLowerCase().endsWith('.xlsx') ? baseName : `${baseName}.xlsx`
}

const formatNoteCell = (note: NoteRecord) => {
  const title = note.title?.trim() || `Note ${note.note_number}`
  return title
}

const buildHeaderRow = (noteColumnCount: number, includeSegment: boolean) => {
  const header = ['Line number', 'Speaker', 'Utterance', 'LLM Note']
  for (let index = 2; index <= noteColumnCount; index += 1) {
    header.push(`LLM Note ${index}`)
  }
  if (includeSegment) {
    header.unshift('Segment')
  }
  return header
}

const resolveTranscriptId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const transcriptIdFromParams = params?.transcriptId?.trim() ?? ''
  if (transcriptIdFromParams) {
    return transcriptIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  return searchParams.get('transcriptId')?.trim() ?? ''
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { role: true, workspace_id: true },
    })

    if (!actor || actor.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can download LLM notes.' },
        { status: 403 },
      )
    }

    const transcript = await prisma.transcripts.findFirst({
      where: { id: transcriptId, workspace_id: actor.workspace_id },
      select: {
        id: true,
        title: true,
      },
    })

    if (!transcript) {
      return NextResponse.json(
        { error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const [lines, notes, segments] = await Promise.all([
      prisma.transcriptLines.findMany({
        where: { transcript_id: transcript.id },
        select: {
          line_id: true,
          segment_id: true,
          line: true,
          speaker: true,
          utterance: true,
        },
        orderBy: { line: 'asc' },
      }),
      prisma.notes.findMany({
        where: {
          transcript_id: transcript.id,
          source: 'llm',
        },
        select: {
          note_id: true,
          note_number: true,
          title: true,
          q1: true,
          q2: true,
          q3: true,
        },
        orderBy: [{ note_number: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.transcriptSegments.findMany({
        where: { transcript_id: transcript.id },
        select: { id: true, segment_index: true, segment_title: true },
        orderBy: { segment_index: 'asc' },
      }),
    ])

    if (notes.length === 0) {
      return NextResponse.json(
        { error: 'No generated LLM notes available for this transcript.' },
        { status: 404 },
      )
    }

    const noteIds = notes.map((note) => note.note_id)
    const assignments =
      noteIds.length > 0
        ? await prisma.noteAssignments.findMany({
            where: { note_id: { in: noteIds } },
            select: { note_id: true, line_id: true },
          })
        : []

    const noteById = new Map<string, NoteRecord>()
    notes.forEach((note) => {
      noteById.set(note.note_id, note)
    })

    const noteIdsByLine = new Map<string, string[]>()
    assignments.forEach((assignment) => {
      if (!noteById.has(assignment.note_id)) {
        return
      }
      const current = noteIdsByLine.get(assignment.line_id) ?? []
      current.push(assignment.note_id)
      noteIdsByLine.set(assignment.line_id, current)
    })

    let maxNotesPerLine = 0
    const segmentIndexById = new Map<string, number>()
    const segmentTitleById = new Map<string, string>()
    segments.forEach((segment) => {
      segmentIndexById.set(segment.id, segment.segment_index)
      segmentTitleById.set(segment.id, segment.segment_title)
    })
    const includeSegment = segments.length > 1

    const lineRows = lines.map((line) => {
      const assignedNoteIds = noteIdsByLine.get(line.line_id) ?? []
      const uniqueNoteIds = Array.from(new Set(assignedNoteIds))
      const assignedNotes = uniqueNoteIds
        .map((noteId) => noteById.get(noteId))
        .filter((note): note is NoteRecord => Boolean(note))
        .sort((a, b) => a.note_number - b.note_number)

      const noteCells = assignedNotes.map(formatNoteCell)
      if (noteCells.length > maxNotesPerLine) {
        maxNotesPerLine = noteCells.length
      }

      const segmentIndex = line.segment_id
        ? segmentIndexById.get(line.segment_id) ?? null
        : null
      const segmentTitle = line.segment_id
        ? segmentTitleById.get(line.segment_id) ?? null
        : null

      return {
        line,
        noteCells,
        segmentIndex,
        segmentTitle,
      }
    })

    const noteColumnCount = Math.max(1, maxNotesPerLine)
    const rows: (string | number)[][] = [
      buildHeaderRow(noteColumnCount, includeSegment),
    ]

    if (includeSegment) {
      lineRows.sort((a, b) => {
        const aIndex = a.segmentIndex ?? Number.MAX_SAFE_INTEGER
        const bIndex = b.segmentIndex ?? Number.MAX_SAFE_INTEGER
        if (aIndex !== bIndex) {
          return aIndex - bIndex
        }
        return a.line.line - b.line.line
      })
    }

    lineRows.forEach((row) => {
      const outputRow: (string | number)[] = [
        row.line.line,
        row.line.speaker ?? '',
        row.line.utterance ?? '',
        ...row.noteCells,
      ]

      if (includeSegment) {
        outputRow.unshift(row.segmentTitle ?? '')
      }

      while (outputRow.length < rows[0].length) {
        outputRow.push('')
      }

      rows.push(outputRow)
    })

    const workbook = utils.book_new()
    const worksheet = utils.aoa_to_sheet(rows)
    utils.book_append_sheet(workbook, worksheet, 'Annotations')

    const notesHeader = [
      'Note ID',
      'Title',
      'What are the students saying or doing?',
      'Interpret this w/r/t the lesson purpose (activity, lesson, and unit learning goal info)',
      'What possible teacher responses would you do?',
    ]
    const notesRows: (string | number)[][] = [
      notesHeader,
      ...notes.map((note) => [
        note.note_number,
        note.title ?? '',
        note.q1 ?? '',
        note.q2 ?? '',
        note.q3 ?? '',
      ]),
    ]
    const notesWorksheet = utils.aoa_to_sheet(notesRows)
    utils.book_append_sheet(workbook, notesWorksheet, 'LLM Notes')

    const fileBuffer = write(workbook, { bookType: 'xlsx', type: 'buffer' })
    const fileName = buildDownloadName(transcript.title)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(
          fileName,
        )}"`,
        'Content-Length': String(fileBuffer.byteLength),
      },
    })
  } catch (error) {
    console.error('Failed to generate LLM notes download', error)
    return NextResponse.json(
      { error: 'Unable to download LLM notes right now.' },
      { status: 500 },
    )
  }
}
