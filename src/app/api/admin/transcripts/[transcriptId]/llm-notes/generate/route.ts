import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses'
const SYSTEM_USERNAME = 'llm-system'
const NOTE_CREATION_PROMPT_PART_2_PATH = path.join(
  process.cwd(),
  'prompts',
  'note_creation_prompt_part_2_static.md',
)
const NOTE_ASSIGNMENT_PROMPT_PART_2_PATH = path.join(
  process.cwd(),
  'prompts',
  'note_assignment_prompt_part_2_static.md',
)

const noteArraySchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      answer_1: { type: 'string' },
      answer_2: { type: 'string' },
    },
    required: ['title', 'answer_1', 'answer_2'],
  },
} as const

const noteResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes: noteArraySchema,
  },
  required: ['notes'],
} as const

const noteAssignmentArraySchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      note_number: { type: 'integer' },
      line_number: { type: 'integer' },
      speaker: { type: 'string' },
      utterance: { type: 'string' },
    },
    required: ['note_number', 'line_number', 'speaker', 'utterance'],
  },
} as const

const noteAssignmentResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assignments: noteAssignmentArraySchema,
  },
  required: ['assignments'],
} as const

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type PromptSettingsRow = {
  note_creation_prompt: string
  note_assignment_prompt: string
  annotate_all_lines: boolean
  range_start_line: number | null
  range_end_line: number | null
}

type PromptSourceLine = {
  line_id: string
  line_number: number
  speaker: string
  utterance: string
  segment_id: string | null
}

type GeneratedNote = {
  title: string
  answer_1: string
  answer_2: string
}

type GeneratedNoteAssignment = {
  note_number: number
  line_number: number
  speaker: string
  utterance: string
}

type OpenAiJsonResponseRequest = {
  openAiApiKey: string
  input: string
  schemaName: string
  schema: unknown
  requestFailureMessage: string
}

type WorkspaceUsageRow = {
  llm_annotation_used: number
  llm_annotation_limit: number
}

type LlmAnnotationStatus = 'not_generated' | 'in_process' | 'generated'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const resolveTranscriptId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const transcriptIdFromParams = params?.transcriptId?.trim() ?? ''
  if (transcriptIdFromParams) {
    return transcriptIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  return searchParams.get('transcriptId')?.trim() ?? ''
}

const extractOpenAiErrorMessage = (payload: unknown) => {
  if (!isRecord(payload)) {
    return null
  }

  const errorPayload = payload.error
  if (!isRecord(errorPayload)) {
    return null
  }

  return typeof errorPayload.message === 'string' ? errorPayload.message : null
}

const extractOpenAiOutputText = (payload: unknown) => {
  if (!isRecord(payload)) {
    return ''
  }

  if (typeof payload.output_text === 'string') {
    return payload.output_text.trim()
  }

  const output = Array.isArray(payload.output) ? payload.output : []
  const chunks: string[] = []

  output.forEach((item) => {
    if (!isRecord(item)) {
      return
    }

    const content = Array.isArray(item.content) ? item.content : []
    content.forEach((entry) => {
      if (!isRecord(entry)) {
        return
      }
      if (typeof entry.text === 'string' && entry.text.trim()) {
        chunks.push(entry.text)
      }
    })
  })

  return chunks.join('\n').trim()
}

const getTextField = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

const getPositiveIntegerField = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10)
      if (parsed > 0) {
        return parsed
      }
    }
  }

  return null
}

const extractJsonCandidates = (outputText: string) => {
  const candidates = [outputText]
  const fencedJsonMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedJsonMatch?.[1]) {
    candidates.push(fencedJsonMatch[1])
  }

  const firstArrayBracket = outputText.indexOf('[')
  const lastArrayBracket = outputText.lastIndexOf(']')
  if (firstArrayBracket >= 0 && lastArrayBracket > firstArrayBracket) {
    candidates.push(outputText.slice(firstArrayBracket, lastArrayBracket + 1))
  }

  const firstObjectBracket = outputText.indexOf('{')
  const lastObjectBracket = outputText.lastIndexOf('}')
  if (firstObjectBracket >= 0 && lastObjectBracket > firstObjectBracket) {
    candidates.push(outputText.slice(firstObjectBracket, lastObjectBracket + 1))
  }

  return candidates
}

const normalizeGeneratedNotes = (value: unknown): GeneratedNote[] | null => {
  const rawNotes = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.notes)
      ? value.notes
      : null

  if (!rawNotes) {
    return null
  }

  const notes: GeneratedNote[] = []
  for (const item of rawNotes) {
    if (!isRecord(item)) {
      return null
    }

    const title = getTextField(item, 'title')
    const answer_1 = getTextField(item, 'answer_1') || getTextField(item, 'q1')
    const answer_2 = getTextField(item, 'answer_2') || getTextField(item, 'q2')

    if (!title || !answer_1 || !answer_2) {
      return null
    }

    notes.push({
      title,
      answer_1,
      answer_2,
    })
  }

  return notes
}

const parseGeneratedNotes = (outputText: string): GeneratedNote[] => {
  for (const candidate of extractJsonCandidates(outputText)) {
    const normalizedCandidate = candidate.trim()
    if (!normalizedCandidate) {
      continue
    }

    try {
      const parsed = JSON.parse(normalizedCandidate)
      const normalized = normalizeGeneratedNotes(parsed)
      if (normalized) {
        return normalized
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('OpenAI response could not be parsed as notes JSON.')
}

const normalizeGeneratedNoteAssignments = (
  value: unknown,
): GeneratedNoteAssignment[] | null => {
  const rawAssignments = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.assignments)
      ? value.assignments
      : null

  if (!rawAssignments) {
    return null
  }

  const assignments: GeneratedNoteAssignment[] = []
  for (const item of rawAssignments) {
    if (!isRecord(item)) {
      return null
    }

    const noteNumber =
      getPositiveIntegerField(item, 'note_number') ??
      getPositiveIntegerField(item, 'note_index') ??
      getPositiveIntegerField(item, 'note')
    if (noteNumber === null) {
      return null
    }

    const lineNumber =
      getPositiveIntegerField(item, 'line_number') ??
      getPositiveIntegerField(item, 'line')
    if (lineNumber === null) {
      return null
    }

    assignments.push({
      note_number: noteNumber,
      line_number: lineNumber,
      speaker: getTextField(item, 'speaker'),
      utterance: getTextField(item, 'utterance'),
    })
  }

  return assignments
}

const parseGeneratedNoteAssignments = (outputText: string): GeneratedNoteAssignment[] => {
  for (const candidate of extractJsonCandidates(outputText)) {
    const normalizedCandidate = candidate.trim()
    if (!normalizedCandidate) {
      continue
    }

    try {
      const parsed = JSON.parse(normalizedCandidate)
      const normalized = normalizeGeneratedNoteAssignments(parsed)
      if (normalized) {
        return normalized
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('OpenAI response could not be parsed as note assignments JSON.')
}

const buildNoteCreationPrompt = ({
  promptTemplate,
  transcriptJson,
  instructionContext,
}: {
  promptTemplate: string
  transcriptJson: string
  instructionContext: string
}) => {
  let prompt = promptTemplate
  const hasTranscriptPlaceholder = prompt.includes('<<transcript>>')
  const hasInstructionContextPlaceholder = prompt.includes('<<instruction_context>>')

  if (hasTranscriptPlaceholder) {
    prompt = prompt.split('<<transcript>>').join(transcriptJson)
  }
  if (hasInstructionContextPlaceholder) {
    prompt = prompt
      .split('<<instruction_context>>')
      .join(instructionContext || 'No instruction context was provided.')
  }

  const sections = [prompt]
  if (!hasTranscriptPlaceholder) {
    sections.push(`Transcript:\n${transcriptJson}`)
  }
  if (instructionContext && !hasInstructionContextPlaceholder) {
    sections.push(`Instruction Context:\n${instructionContext}`)
  }

  return sections.filter(Boolean).join('\n\n')
}

const buildNoteAssignmentPrompt = ({
  promptTemplate,
  segmentTranscriptJson,
  notes,
  segmentLabel,
}: {
  promptTemplate: string
  segmentTranscriptJson: string
  notes: GeneratedNote[]
  segmentLabel: string
}) => {
  const notesJson = JSON.stringify(
    notes.map((note, index) => ({
      note_number: index + 1,
      ...note,
    })),
    null,
    2,
  )
  const noteTitles = notes.map((note, index) => `${index + 1}. ${note.title}`).join('\n')
  const noteAnswers1 = notes
    .map((note, index) => `${index + 1}. ${note.answer_1}`)
    .join('\n')
  const noteAnswers2 = notes
    .map((note, index) => `${index + 1}. ${note.answer_2}`)
    .join('\n')
  let prompt = promptTemplate
  const hasTranscriptPlaceholder = prompt.includes('<<transcript>>')
  const hasSegmentTranscriptPlaceholder = prompt.includes('<<segment_transcript>>')
  const hasNotesPlaceholder = prompt.includes('<<notes>>')
  const hasSegmentLabelPlaceholder = prompt.includes('<<segment_label>>')
  const hasNotePlaceholder = prompt.includes('<<note>>')
  const hasNoteTitlePlaceholder = prompt.includes('<<note_title>>')
  const hasNoteAnswer1Placeholder = prompt.includes('<<note_answer_1>>')
  const hasNoteAnswer2Placeholder = prompt.includes('<<note_answer_2>>')

  if (hasTranscriptPlaceholder) {
    prompt = prompt.split('<<transcript>>').join(segmentTranscriptJson)
  }
  if (hasSegmentTranscriptPlaceholder) {
    prompt = prompt.split('<<segment_transcript>>').join(segmentTranscriptJson)
  }
  if (hasNotesPlaceholder) {
    prompt = prompt.split('<<notes>>').join(notesJson)
  }
  if (hasSegmentLabelPlaceholder) {
    prompt = prompt.split('<<segment_label>>').join(segmentLabel)
  }
  if (hasNotePlaceholder) {
    prompt = prompt.split('<<note>>').join(notesJson)
  }
  if (hasNoteTitlePlaceholder) {
    prompt = prompt.split('<<note_title>>').join(noteTitles)
  }
  if (hasNoteAnswer1Placeholder) {
    prompt = prompt.split('<<note_answer_1>>').join(noteAnswers1)
  }
  if (hasNoteAnswer2Placeholder) {
    prompt = prompt.split('<<note_answer_2>>').join(noteAnswers2)
  }

  const sections = [prompt]
  if (!hasTranscriptPlaceholder && !hasSegmentTranscriptPlaceholder) {
    sections.push(`Segment Transcript:\n${segmentTranscriptJson}`)
  }
  if (!hasNotesPlaceholder && !hasNotePlaceholder) {
    sections.push(`Open Ended Notes JSON:\n${notesJson}`)
  }
  if (segmentLabel && !hasSegmentLabelPlaceholder) {
    sections.push(`Segment Label:\n${segmentLabel}`)
  }

  return sections.filter(Boolean).join('\n\n')
}

const buildTranscriptLineMatchKey = (speaker: string, utterance: string) =>
  `${speaker.trim().toLowerCase()}::${utterance.trim().toLowerCase()}`

const requestOpenAiJsonOutput = async ({
  openAiApiKey,
  input,
  schemaName,
  schema,
  requestFailureMessage,
}: OpenAiJsonResponseRequest) => {
  const openAiResponse = await fetch(OPENAI_RESPONSES_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.2',
      input,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          schema,
          strict: true,
        },
      },
    }),
  })

  const openAiPayload = (await openAiResponse.json().catch(() => null)) as unknown
  if (!openAiResponse.ok) {
    throw new Error(extractOpenAiErrorMessage(openAiPayload) ?? requestFailureMessage)
  }

  const outputText = extractOpenAiOutputText(openAiPayload)
  if (!outputText) {
    throw new Error('OpenAI returned an empty response.')
  }

  return outputText
}

const reserveWorkspaceLlmAnnotationUsage = async (workspaceId: string) => {
  const rows = await prisma.$queryRaw<WorkspaceUsageRow[]>`
    UPDATE "Workspaces"
    SET "llm_annotation_used" = "llm_annotation_used" + 1
    WHERE "id" = ${workspaceId}
      AND "llm_annotation_used" < "llm_annotation_limit"
    RETURNING "llm_annotation_used", "llm_annotation_limit"
  `

  return rows[0] ?? null
}

const updateTranscriptAnnotationStatus = async (
  transcriptId: string,
  status: LlmAnnotationStatus,
) =>
  prisma.transcripts.update({
    where: { id: transcriptId },
    data: { llm_annotation: status },
  })

const safeUpdateTranscriptAnnotationStatus = async (
  transcriptId: string,
  status: LlmAnnotationStatus,
) => {
  try {
    await updateTranscriptAnnotationStatus(transcriptId, status)
  } catch (error) {
    console.error('Failed to update LLM annotation status', {
      transcriptId,
      status,
      error,
    })
  }
}

export async function POST(request: Request, context: RouteContext) {
  let transcriptId = ''
  let shouldResetStatus = false

  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true, role: true, workspace_id: true },
    })

    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    if (actor.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only admins can generate LLM notes.' },
        { status: 403 },
      )
    }

    const transcript = await prisma.transcripts.findFirst({
      where: { id: transcriptId, workspace_id: actor.workspace_id },
      select: { id: true, instruction_context: true },
    })

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const promptRows = await prisma.$queryRaw<PromptSettingsRow[]>`
      SELECT
        "note_creation_prompt",
        "note_assignment_prompt",
        "annotate_all_lines",
        "range_start_line",
        "range_end_line"
      FROM "LLMNotePrompts"
      WHERE "transcript_id" = ${transcriptId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `

    const promptSettings = promptRows[0]
    if (!promptSettings) {
      return NextResponse.json(
        { success: false, error: 'No LLM note prompt settings found for this transcript.' },
        { status: 404 },
      )
    }

    let lineRange: { gte: number; lte: number } | undefined
    if (!promptSettings.annotate_all_lines) {
      if (
        promptSettings.range_start_line === null ||
        promptSettings.range_end_line === null
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Line range settings are incomplete for this transcript.',
          },
          { status: 400 },
        )
      }

      if (promptSettings.range_start_line > promptSettings.range_end_line) {
        return NextResponse.json(
          {
            success: false,
            error: 'Start line cannot be greater than end line.',
          },
          { status: 400 },
        )
      }

      lineRange = {
        gte: promptSettings.range_start_line,
        lte: promptSettings.range_end_line,
      }
    }

    const transcriptLines = await prisma.transcriptLines.findMany({
      where: {
        transcript_id: transcriptId,
        ...(lineRange ? { line: lineRange } : {}),
      },
      orderBy: { line: 'asc' },
      select: {
        line_id: true,
        line: true,
        speaker: true,
        utterance: true,
        segment_id: true,
      },
    })

    const promptLines: PromptSourceLine[] = transcriptLines
      .filter((line) => Boolean((line.utterance ?? '').trim()))
      .map((line) => ({
        line_id: line.line_id,
        line_number: line.line,
        speaker: line.speaker?.trim() || 'Unknown speaker',
        utterance: line.utterance?.trim() ?? '',
        segment_id: line.segment_id,
      }))

    if (promptLines.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No transcript lines are available to generate notes.',
        },
        { status: 400 },
      )
    }

    const llmSystemUser = await prisma.user.findFirst({
      where: {
        workspace_id: actor.workspace_id,
        username: SYSTEM_USERNAME,
      },
      select: { id: true },
    })

    if (!llmSystemUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unable to find the llm-system user for this workspace.',
        },
        { status: 404 },
      )
    }

    const openAiApiKey = process.env.OPENAI_API_KEY
    if (!openAiApiKey) {
      return NextResponse.json(
        { success: false, error: 'OPENAI_API_KEY is not configured on the server.' },
        { status: 500 },
      )
    }

    const [noteCreationStaticPromptPart, noteAssignmentStaticPromptPart] =
      await Promise.all([
        readFile(NOTE_CREATION_PROMPT_PART_2_PATH, 'utf8'),
        readFile(NOTE_ASSIGNMENT_PROMPT_PART_2_PATH, 'utf8'),
      ])

    const usageReservation = await reserveWorkspaceLlmAnnotationUsage(actor.workspace_id)
    if (!usageReservation) {
      return NextResponse.json(
        {
          success: false,
          error: 'LLM annotation limit reached for this workspace.',
        },
        { status: 429 },
      )
    }

    const transcriptJson = JSON.stringify(
      promptLines.map(({ line_number, speaker, utterance }) => ({
        line_number,
        speaker,
        utterance,
      })),
      null,
      2,
    )
    const instructionContext = transcript.instruction_context.trim()

    const noteCreationPromptTemplate = [
      promptSettings.note_creation_prompt.trim(),
      noteCreationStaticPromptPart.trim(),
    ]
      .filter(Boolean)
      .join('\n\n')
    const noteCreationPrompt = buildNoteCreationPrompt({
      promptTemplate: noteCreationPromptTemplate,
      transcriptJson,
      instructionContext,
    })

    await updateTranscriptAnnotationStatus(transcriptId, 'in_process')
    shouldResetStatus = true

    let generatedNotes: GeneratedNote[]
    try {
      const outputText = await requestOpenAiJsonOutput({
        openAiApiKey,
        input: noteCreationPrompt,
        schemaName: 'llm_generated_notes',
        schema: noteResponseSchema,
        requestFailureMessage: 'OpenAI request failed while generating notes.',
      })
      generatedNotes = parseGeneratedNotes(outputText)
    } catch (error) {
      await safeUpdateTranscriptAnnotationStatus(transcriptId, 'not_generated')
      shouldResetStatus = false

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to generate notes output.'
      return NextResponse.json(
        { success: false, error: message },
        { status: 502 },
      )
    }

    const lineIdByLineNumber = new Map<number, string>()
    const lineIdBySpeakerUtterance = new Map<string, string>()
    promptLines.forEach((line) => {
      if (!lineIdByLineNumber.has(line.line_number)) {
        lineIdByLineNumber.set(line.line_number, line.line_id)
      }

      const key = buildTranscriptLineMatchKey(line.speaker, line.utterance)
      if (key && !lineIdBySpeakerUtterance.has(key)) {
        lineIdBySpeakerUtterance.set(key, line.line_id)
      }
    })

    const orderedSegments = await prisma.transcriptSegments.findMany({
      where: { transcript_id: transcriptId },
      orderBy: { segment_index: 'asc' },
      select: {
        id: true,
        segment_index: true,
        segment_title: true,
      },
    })

    const linesBySegmentId = new Map<string, PromptSourceLine[]>()
    const unsegmentedLines: PromptSourceLine[] = []
    promptLines.forEach((line) => {
      if (!line.segment_id) {
        unsegmentedLines.push(line)
        return
      }

      const current = linesBySegmentId.get(line.segment_id) ?? []
      current.push(line)
      linesBySegmentId.set(line.segment_id, current)
    })

    const noteAssignmentSegments: Array<{
      segmentLabel: string
      lines: PromptSourceLine[]
    }> = []
    const knownSegmentIds = new Set<string>()

    orderedSegments.forEach((segment) => {
      const lines = linesBySegmentId.get(segment.id) ?? []
      if (lines.length === 0) {
        return
      }

      knownSegmentIds.add(segment.id)
      noteAssignmentSegments.push({
        segmentLabel: `Segment ${segment.segment_index}: ${segment.segment_title}`,
        lines,
      })
    })

    linesBySegmentId.forEach((lines, segmentId) => {
      if (knownSegmentIds.has(segmentId) || lines.length === 0) {
        return
      }

      noteAssignmentSegments.push({
        segmentLabel: `Segment ${noteAssignmentSegments.length + 1}`,
        lines,
      })
    })

    if (unsegmentedLines.length > 0) {
      noteAssignmentSegments.push({
        segmentLabel: 'Unsegmented Lines',
        lines: unsegmentedLines,
      })
    }

    if (noteAssignmentSegments.length === 0) {
      noteAssignmentSegments.push({
        segmentLabel: 'Segment 1',
        lines: promptLines,
      })
    }

    const noteAssignmentPromptTemplate = [
      promptSettings.note_assignment_prompt.trim(),
      noteAssignmentStaticPromptPart.trim(),
    ]
      .filter(Boolean)
      .join('\n\n')

    let noteAssignmentLineIdsByNote: string[][]
    try {
      if (generatedNotes.length === 0) {
        noteAssignmentLineIdsByNote = []
      } else {
        const assignmentLineIdsBySegment = await Promise.all(
          noteAssignmentSegments.map(async (segment) => {
            const segmentTranscriptJson = JSON.stringify(
              segment.lines.map(({ line_number, speaker, utterance }) => ({
                line_number,
                speaker,
                utterance,
              })),
              null,
              2,
            )
            const segmentLineIds = new Set(segment.lines.map((line) => line.line_id))

            const noteAssignmentPrompt = buildNoteAssignmentPrompt({
              promptTemplate: noteAssignmentPromptTemplate,
              segmentTranscriptJson,
              notes: generatedNotes,
              segmentLabel: segment.segmentLabel,
            })

            const outputText = await requestOpenAiJsonOutput({
              openAiApiKey,
              input: noteAssignmentPrompt,
              schemaName: 'llm_generated_note_assignments',
              schema: noteAssignmentResponseSchema,
              requestFailureMessage:
                'OpenAI request failed while generating note assignments.',
            })

            const generatedAssignments = parseGeneratedNoteAssignments(outputText)
            const lineIdsByNote = generatedNotes.map(() => new Set<string>())

            generatedAssignments.forEach((assignment) => {
              const noteIndex = assignment.note_number - 1
              if (noteIndex < 0 || noteIndex >= lineIdsByNote.length) {
                return
              }

              const lineIdFromLineNumber = lineIdByLineNumber.get(assignment.line_number)
              const lineId =
                lineIdFromLineNumber ??
                lineIdBySpeakerUtterance.get(
                  buildTranscriptLineMatchKey(assignment.speaker, assignment.utterance),
                )

              if (!lineId || !segmentLineIds.has(lineId)) {
                return
              }

              lineIdsByNote[noteIndex].add(lineId)
            })

            return lineIdsByNote
          }),
        )

        const aggregatedLineIdsByNote = generatedNotes.map(() => new Set<string>())
        assignmentLineIdsBySegment.forEach((segmentLineIdsByNote) => {
          segmentLineIdsByNote.forEach((lineIds, noteIndex) => {
            lineIds.forEach((lineId) => {
              aggregatedLineIdsByNote[noteIndex].add(lineId)
            })
          })
        })
        noteAssignmentLineIdsByNote = aggregatedLineIdsByNote.map((lineIds) =>
          Array.from(lineIds),
        )
      }
    } catch (error) {
      await safeUpdateTranscriptAnnotationStatus(transcriptId, 'not_generated')
      shouldResetStatus = false

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to generate note assignments output.'
      return NextResponse.json(
        { success: false, error: message },
        { status: 502 },
      )
    }

    const { notesCreated, noteAssignmentsCreated } = await prisma.$transaction(async (tx) => {
      const maxNoteNumber = await tx.notes.aggregate({
        where: {
          transcript_id: transcriptId,
          user_id: llmSystemUser.id,
        },
        _max: {
          note_number: true,
        },
      })

      const nextNoteNumber = (maxNoteNumber._max.note_number ?? 0) + 1
      const notesCreated = generatedNotes.length
      let noteAssignmentsCreated = 0

      if (notesCreated > 0) {
        for (const [index, note] of generatedNotes.entries()) {
          const createdNote = await tx.notes.create({
            data: {
              transcript_id: transcriptId,
              user_id: llmSystemUser.id,
              note_number: nextNoteNumber + index,
              title: note.title,
              q1: note.answer_1,
              q2: note.answer_2,
              q3: '',
              source: 'llm',
            },
            select: {
              note_id: true,
            },
          })

          const lineIds = noteAssignmentLineIdsByNote[index] ?? []
          if (lineIds.length === 0) {
            continue
          }

          const assignmentResult = await tx.noteAssignments.createMany({
            data: lineIds.map((lineId) => ({
              note_id: createdNote.note_id,
              line_id: lineId,
            })),
            skipDuplicates: true,
          })

          noteAssignmentsCreated += assignmentResult.count
        }
      }

      const totalLlmNotes = await tx.notes.count({
        where: {
          transcript_id: transcriptId,
          source: 'llm',
        },
      })
      const nextStatus: LlmAnnotationStatus =
        totalLlmNotes > 0 ? 'generated' : 'not_generated'
      await tx.transcripts.update({
        where: { id: transcriptId },
        data: { llm_annotation: nextStatus },
      })

      return {
        notesCreated,
        noteAssignmentsCreated,
      }
    })

    shouldResetStatus = false

    return NextResponse.json({
      success: true,
      transcriptId,
      notesCreated,
      noteAssignmentsCreated,
    })
  } catch (error) {
    if (shouldResetStatus && transcriptId) {
      await safeUpdateTranscriptAnnotationStatus(transcriptId, 'not_generated')
    }

    console.error('Failed to generate LLM notes', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to generate LLM notes right now.',
      },
      { status: 500 },
    )
  }
}
