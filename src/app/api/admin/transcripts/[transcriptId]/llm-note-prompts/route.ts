import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

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

type SaveSettingsBody = {
  scope?: unknown
  startLine?: unknown
  endLine?: unknown
  noteCreationPrompt?: unknown
  noteAssignmentPrompt?: unknown
}

const parseLineNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  let normalized = Number.NaN
  if (typeof value === 'number') {
    normalized = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) {
      normalized = Number(trimmed)
    }
  }

  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error('Line numbers must be positive whole numbers.')
  }

  return normalized
}

const resolveTranscriptId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const transcriptIdFromParams = params?.transcriptId?.trim() ?? ''
  if (transcriptIdFromParams) {
    return transcriptIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  const transcriptIdFromQuery = searchParams.get('transcriptId')?.trim() ?? ''
  return transcriptIdFromQuery
}

const findActor = async (authUserId: string) =>
  prisma.user.findFirst({
    where: { auth_user_id: authUserId },
    select: { id: true, workspace_id: true },
  })

const findWorkspaceTranscript = async (transcriptId: string, workspaceId: string) =>
  prisma.transcripts.findFirst({
    where: { id: transcriptId, workspace_id: workspaceId },
    select: { id: true },
  })

export async function GET(request: Request, context: RouteContext) {
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

    const actor = await findActor(authUserId)
    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const transcript = await findWorkspaceTranscript(transcriptId, actor.workspace_id)
    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const rows = await prisma.$queryRaw<PromptSettingsRow[]>`
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

    return NextResponse.json({
      success: true,
      settings: rows[0] ?? null,
    })
  } catch (error) {
    console.error('Failed to fetch LLM note prompt settings', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to fetch LLM note prompt settings right now.',
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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

    const actor = await findActor(authUserId)
    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const transcript = await findWorkspaceTranscript(transcriptId, actor.workspace_id)
    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const payload = (await request.json().catch(() => null)) as SaveSettingsBody | null
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Request body is required.' },
        { status: 400 },
      )
    }

    if (
      typeof payload.noteCreationPrompt !== 'string' ||
      typeof payload.noteAssignmentPrompt !== 'string'
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Note creation and note assignment prompts must be text values.',
        },
        { status: 400 },
      )
    }

    const scope = payload.scope === 'range' ? 'range' : payload.scope === 'all' ? 'all' : null
    if (!scope) {
      return NextResponse.json(
        {
          success: false,
          error: 'Scope must be either "all" or "range".',
        },
        { status: 400 },
      )
    }

    let startLine: number | null
    let endLine: number | null

    try {
      startLine = parseLineNumber(payload.startLine)
      endLine = parseLineNumber(payload.endLine)
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Invalid line range values provided.',
        },
        { status: 400 },
      )
    }

    const annotateAllLines = scope === 'all'
    let normalizedStartLine: number | null = null
    let normalizedEndLine: number | null = null

    if (!annotateAllLines) {
      if (startLine === null || endLine === null) {
        return NextResponse.json(
          {
            success: false,
            error: 'Start and end lines are required when range mode is selected.',
          },
          { status: 400 },
        )
      }

      if (startLine > endLine) {
        return NextResponse.json(
          {
            success: false,
            error: 'Start line cannot be greater than end line.',
          },
          { status: 400 },
        )
      }

      normalizedStartLine = startLine
      normalizedEndLine = endLine
    }

    await prisma.$executeRaw`
      INSERT INTO "LLMNotePrompts" (
        "id",
        "transcript_id",
        "created_by",
        "note_creation_prompt",
        "note_assignment_prompt",
        "annotate_all_lines",
        "range_start_line",
        "range_end_line"
      )
      VALUES (
        ${randomUUID()},
        ${transcriptId},
        ${actor.id},
        ${payload.noteCreationPrompt},
        ${payload.noteAssignmentPrompt},
        ${annotateAllLines},
        ${normalizedStartLine},
        ${normalizedEndLine}
      )
    `

    return NextResponse.json({
      success: true,
      settings: {
        note_creation_prompt: payload.noteCreationPrompt,
        note_assignment_prompt: payload.noteAssignmentPrompt,
        annotate_all_lines: annotateAllLines,
        range_start_line: normalizedStartLine,
        range_end_line: normalizedEndLine,
      },
    })
  } catch (error) {
    console.error('Failed to save LLM note prompt settings', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to save LLM note prompt settings right now.',
      },
      { status: 500 },
    )
  }
}
