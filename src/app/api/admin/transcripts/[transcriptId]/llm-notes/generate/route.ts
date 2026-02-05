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

const noteArraySchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      answer_1: { type: 'string' },
      answer_2: { type: 'string' },
      answer_3: { type: 'string' },
    },
    required: ['title', 'answer_1', 'answer_2', 'answer_3'],
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

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type PromptSettingsRow = {
  note_creation_prompt: string
  annotate_all_lines: boolean
  range_start_line: number | null
  range_end_line: number | null
}

type TranscriptPromptLine = {
  line_number: number
  speaker: string
  utterance: string
}

type GeneratedNote = {
  title: string
  answer_1: string
  answer_2: string
  answer_3: string
}

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
    const answer_3 = getTextField(item, 'answer_3') || getTextField(item, 'q3')

    if (!title || !answer_1 || !answer_2 || !answer_3) {
      return null
    }

    notes.push({
      title,
      answer_1,
      answer_2,
      answer_3,
    })
  }

  return notes
}

const parseGeneratedNotes = (outputText: string): GeneratedNote[] => {
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

  for (const candidate of candidates) {
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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const transcriptId = await resolveTranscriptId(request, context)
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
      select: { id: true },
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
        line: true,
        speaker: true,
        utterance: true,
      },
    })

    const promptLines: TranscriptPromptLine[] = transcriptLines
      .filter((line) => Boolean((line.utterance ?? '').trim()))
      .map((line) => ({
        line_number: line.line,
        speaker: line.speaker?.trim() || 'Unknown speaker',
        utterance: line.utterance?.trim() ?? '',
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

    const staticPromptPart = await readFile(NOTE_CREATION_PROMPT_PART_2_PATH, 'utf8')
    const transcriptJson = JSON.stringify(promptLines, null, 2)
    const promptWithStaticPart = [
      promptSettings.note_creation_prompt.trim(),
      staticPromptPart.trim(),
    ]
      .filter(Boolean)
      .join('\n\n')
    const finalPrompt = promptWithStaticPart.includes('<<transcript>>')
      ? promptWithStaticPart.split('<<transcript>>').join(transcriptJson)
      : `${promptWithStaticPart}\n\nTranscript:\n${transcriptJson}`

    const openAiResponse = await fetch(OPENAI_RESPONSES_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        input: finalPrompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'llm_generated_notes',
            schema: noteResponseSchema,
            strict: true,
          },
        },
      }),
    })

    const openAiPayload = (await openAiResponse.json().catch(() => null)) as unknown
    if (!openAiResponse.ok) {
      const message =
        extractOpenAiErrorMessage(openAiPayload) ??
        'OpenAI request failed while generating notes.'
      return NextResponse.json(
        { success: false, error: message },
        { status: 502 },
      )
    }

    const outputText = extractOpenAiOutputText(openAiPayload)
    if (!outputText) {
      return NextResponse.json(
        { success: false, error: 'OpenAI returned an empty response.' },
        { status: 502 },
      )
    }

    let generatedNotes: GeneratedNote[]
    try {
      generatedNotes = parseGeneratedNotes(outputText)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to parse generated notes output.'
      return NextResponse.json(
        { success: false, error: message },
        { status: 502 },
      )
    }

    const notesCreated = await prisma.$transaction(async (tx) => {
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
      if (generatedNotes.length === 0) {
        return 0
      }

      await tx.notes.createMany({
        data: generatedNotes.map((note, index) => ({
          transcript_id: transcriptId,
          user_id: llmSystemUser.id,
          note_number: nextNoteNumber + index,
          title: note.title,
          q1: note.answer_1,
          q2: note.answer_2,
          q3: note.answer_3,
          source: 'llm',
        })),
      })

      return generatedNotes.length
    })

    return NextResponse.json({
      success: true,
      transcriptId,
      notesCreated,
    })
  } catch (error) {
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
