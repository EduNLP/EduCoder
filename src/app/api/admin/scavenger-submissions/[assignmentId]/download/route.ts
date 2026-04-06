import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'
import { utils, write } from 'xlsx'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    assignmentId?: string
  }>
}

type SupportingLine = {
  line_id: string
  line: {
    line: number
    speaker: string | null
    utterance: string | null
  } | null
}

type SupportingNote = {
  note_id: string
  note: {
    note_number: number
    source: 'user' | 'llm'
    title: string
    q1: string
    q2: string
    q3: string
  } | null
}

type AssignmentRecord = {
  scavenger: {
    transcript: {
      title: string | null
      workspace_id: string
    }
    questions: Array<{
      id: string
      question: string
      order_index: number
    }>
  }
  user: {
    name: string
    username: string
  } | null
  answers: Array<{
    question_id: string
    answer: string | null
    lines: SupportingLine[]
    notes?: SupportingNote[]
  }>
}

const sanitizeFileName = (value: string, fallback: string) => {
  const trimmed = value.trim().replace(/[/\\]/g, '-')
  const normalized = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  return normalized || fallback
}

const buildDownloadName = ({
  transcriptTitle,
  annotatorName,
}: {
  transcriptTitle?: string | null
  annotatorName?: string | null
}) => {
  const transcriptSegment =
    transcriptTitle?.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '') ||
    'scavenger-submission'
  const annotatorSegment =
    annotatorName?.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '') ||
    null

  const combined = annotatorSegment
    ? `${transcriptSegment}-${annotatorSegment}-scavenger-submission`
    : `${transcriptSegment}-scavenger-submission`

  const baseName = sanitizeFileName(combined, 'scavenger-submission')
  return baseName.toLowerCase().endsWith('.xlsx') ? baseName : `${baseName}.xlsx`
}

const resolveAssignmentId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const assignmentIdFromParams = params?.assignmentId?.trim() ?? ''
  if (assignmentIdFromParams) {
    return assignmentIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  return (
    searchParams.get('assignmentId')?.trim() ??
    searchParams.get('id')?.trim() ??
    ''
  )
}

const normalizeSupportingLines = (lines: SupportingLine[]) => {
  const uniqueByLineId = new Map<
    string,
    {
      lineNumber: number
      speaker: string
      utterance: string
    }
  >()

  for (const selectedLine of lines) {
    if (!selectedLine.line) {
      continue
    }

    if (uniqueByLineId.has(selectedLine.line_id)) {
      continue
    }

    uniqueByLineId.set(selectedLine.line_id, {
      lineNumber: selectedLine.line.line,
      speaker: selectedLine.line.speaker ?? '',
      utterance: selectedLine.line.utterance ?? '',
    })
  }

  return Array.from(uniqueByLineId.values()).sort(
    (a, b) => a.lineNumber - b.lineNumber,
  )
}

const normalizeSupportingNotes = (notes: SupportingNote[]) => {
  const uniqueByNoteId = new Map<
    string,
    {
      noteNumber: number | null
      source: string
      title: string
      q1: string
      q2: string
      q3: string
    }
  >()

  for (const selectedNote of notes) {
    if (uniqueByNoteId.has(selectedNote.note_id)) {
      continue
    }

    if (!selectedNote.note) {
      uniqueByNoteId.set(selectedNote.note_id, {
        noteNumber: null,
        source: '',
        title: selectedNote.note_id,
        q1: '',
        q2: '',
        q3: '',
      })
      continue
    }

    const title =
      selectedNote.note.title?.trim() || `Note ${selectedNote.note.note_number}`

    uniqueByNoteId.set(selectedNote.note_id, {
      noteNumber: selectedNote.note.note_number,
      source: selectedNote.note.source === 'llm' ? 'LLM' : 'Annotator',
      title,
      q1: selectedNote.note.q1 ?? '',
      q2: selectedNote.note.q2 ?? '',
      q3: selectedNote.note.q3 ?? '',
    })
  }

  return Array.from(uniqueByNoteId.values()).sort((a, b) => {
    if (a.noteNumber === null && b.noteNumber === null) {
      return a.title.localeCompare(b.title)
    }
    if (a.noteNumber === null) {
      return 1
    }
    if (b.noteNumber === null) {
      return -1
    }
    return a.noteNumber - b.noteNumber
  })
}

const canFallbackWithoutNotes = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientValidationError) {
    return true
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021' || error.code === 'P2022'
  }

  return false
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const assignmentId = await resolveAssignmentId(request, context)
    if (!assignmentId) {
      return NextResponse.json(
        { error: 'Assignment id is required.' },
        { status: 400 },
      )
    }

    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { workspace_id: true },
    })

    if (!actor) {
      return NextResponse.json(
        {
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    let noteSelectionSupported = true
    let assignment: AssignmentRecord | null = null

    try {
      assignment = await prisma.scavengerHuntAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          scavenger: {
            select: {
              transcript: {
                select: {
                  title: true,
                  workspace_id: true,
                },
              },
              questions: {
                orderBy: { order_index: 'asc' },
                select: {
                  id: true,
                  question: true,
                  order_index: true,
                },
              },
            },
          },
          user: {
            select: {
              name: true,
              username: true,
            },
          },
          answers: {
            select: {
              question_id: true,
              answer: true,
              lines: {
                select: {
                  line_id: true,
                  line: {
                    select: {
                      line: true,
                      speaker: true,
                      utterance: true,
                    },
                  },
                },
              },
              notes: {
                select: {
                  note_id: true,
                  note: {
                    select: {
                      note_number: true,
                      source: true,
                      title: true,
                      q1: true,
                      q2: true,
                      q3: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    } catch (error) {
      if (!canFallbackWithoutNotes(error)) {
        throw error
      }

      noteSelectionSupported = false
      assignment = await prisma.scavengerHuntAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          scavenger: {
            select: {
              transcript: {
                select: {
                  title: true,
                  workspace_id: true,
                },
              },
              questions: {
                orderBy: { order_index: 'asc' },
                select: {
                  id: true,
                  question: true,
                  order_index: true,
                },
              },
            },
          },
          user: {
            select: {
              name: true,
              username: true,
            },
          },
          answers: {
            select: {
              question_id: true,
              answer: true,
              lines: {
                select: {
                  line_id: true,
                  line: {
                    select: {
                      line: true,
                      speaker: true,
                      utterance: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    }

    if (!assignment) {
      return NextResponse.json(
        { error: 'Scavenger submission not found.' },
        { status: 404 },
      )
    }

    if (assignment.scavenger.transcript.workspace_id !== actor.workspace_id) {
      return NextResponse.json(
        { error: 'Scavenger submission not found.' },
        { status: 404 },
      )
    }

    if (assignment.scavenger.questions.length === 0) {
      return NextResponse.json(
        { error: 'No scavenger hunt questions were found for this submission.' },
        { status: 404 },
      )
    }

    const answerByQuestionId = new Map<
      string,
      {
        answerText: string
        supportingLines: ReturnType<typeof normalizeSupportingLines>
        supportingNotes: ReturnType<typeof normalizeSupportingNotes>
      }
    >()

    for (const answer of assignment.answers) {
      answerByQuestionId.set(answer.question_id, {
        answerText: answer.answer?.trim() ?? '',
        supportingLines: normalizeSupportingLines(answer.lines),
        supportingNotes: noteSelectionSupported
          ? normalizeSupportingNotes(answer.notes ?? [])
          : [],
      })
    }

    const workbook = utils.book_new()

    assignment.scavenger.questions.forEach((question, index) => {
      const answer = answerByQuestionId.get(question.id)
      const rows: (string | number)[][] = [
        ['Question'],
        [question.question ?? ''],
        [],
        ['Answer'],
        [answer?.answerText ?? ''],
        [],
        ['Supporting Lines'],
        ['Line number', 'Speaker', 'Utterance'],
      ]

      if (answer?.supportingLines.length) {
        answer.supportingLines.forEach((line) => {
          rows.push([line.lineNumber, line.speaker, line.utterance])
        })
      } else {
        rows.push(['', '', ''])
      }

      rows.push([])
      rows.push(['Supporting Notes'])
      rows.push([
        'Note number',
        'Source',
        'Title',
        'What does this tell you about students’ progress towards the lesson goals?',
        'How might you, as a teacher, respond to this student(s)?',
        'Additional note context',
      ])

      if (answer?.supportingNotes.length) {
        answer.supportingNotes.forEach((note) => {
          rows.push([
            note.noteNumber ?? '',
            note.source,
            note.title,
            note.q1,
            note.q2,
            note.q3,
          ])
        })
      } else {
        rows.push(['', '', '', '', '', ''])
      }

      const worksheet = utils.aoa_to_sheet(rows)
      utils.book_append_sheet(workbook, worksheet, `Question ${index + 1}`)
    })

    const fileBuffer = write(workbook, { bookType: 'xlsx', type: 'buffer' })
    const fileName = buildDownloadName({
      transcriptTitle: assignment.scavenger.transcript.title ?? null,
      annotatorName: assignment.user?.name ?? assignment.user?.username ?? null,
    })

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
    console.error('Failed to generate scavenger submission download', error)
    return NextResponse.json(
      { error: 'Unable to download scavenger submission right now.' },
      { status: 500 },
    )
  }
}
