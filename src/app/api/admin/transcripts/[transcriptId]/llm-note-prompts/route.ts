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
  annotate_all_segments: boolean
  selected_segment_ids_json: string | null
}

type TranscriptSegmentRow = {
  id: string
  segment_title: string
  segment_index: number
}

type TranscriptSegmentResponse = {
  id: string
  title: string
  index: number
  is_default_generated: boolean
}

type SaveSettingsBody = {
  scope?: unknown
  segmentIds?: unknown
  noteCreationPrompt?: unknown
  noteAssignmentPrompt?: unknown
}

const parseSegmentIdsFromBody = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((segmentId): segmentId is string => typeof segmentId === 'string')
        .map((segmentId) => segmentId.trim())
        .filter(Boolean),
    ),
  )
}

const parseSelectedSegmentIdsJson = (value: string | null) => {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return Array.from(
      new Set(
        parsed
          .filter((segmentId): segmentId is string => typeof segmentId === 'string')
          .map((segmentId) => segmentId.trim())
          .filter(Boolean),
      ),
    )
  } catch {
    return []
  }
}

const isGeneratedDefaultSegment = (title: string) =>
  title.trim().toLowerCase() === 'default_segment'

const normalizeSegmentTitle = (title: string, index: number) => {
  const trimmed = title.trim()
  if (isGeneratedDefaultSegment(trimmed)) {
    return 'Entire transcript (no segment metadata)'
  }
  return trimmed || `Segment ${index}`
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

const findTranscriptSegments = (transcriptId: string) =>
  prisma.transcriptSegments.findMany({
    where: { transcript_id: transcriptId },
    select: {
      id: true,
      segment_title: true,
      segment_index: true,
    },
    orderBy: { segment_index: 'asc' },
  })

const normalizeTranscriptSegments = (
  segments: TranscriptSegmentRow[],
): TranscriptSegmentResponse[] =>
  segments.map((segment) => ({
    id: segment.id,
    title: normalizeSegmentTitle(segment.segment_title, segment.segment_index),
    index: segment.segment_index,
    is_default_generated: isGeneratedDefaultSegment(segment.segment_title),
  }))

const hasSegmentMetadata = (segments: TranscriptSegmentResponse[]) =>
  !(segments.length === 1 && segments[0]?.is_default_generated)

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

    const [rows, segments] = await Promise.all([
      prisma.$queryRaw<PromptSettingsRow[]>`
        SELECT
          "note_creation_prompt",
          "note_assignment_prompt",
          "annotate_all_segments",
          "selected_segment_ids_json"
        FROM "LLMNotePrompts"
        WHERE "transcript_id" = ${transcriptId}
        ORDER BY "createdAt" DESC
        LIMIT 1
      `,
      findTranscriptSegments(transcriptId),
    ])

    const normalizedSegments = normalizeTranscriptSegments(segments)
    const validSegmentIds = new Set(normalizedSegments.map((segment) => segment.id))
    const row = rows[0]
    const selectedSegmentIds = row
      ? parseSelectedSegmentIdsJson(row.selected_segment_ids_json).filter((segmentId) =>
          validSegmentIds.has(segmentId),
        )
      : []

    return NextResponse.json({
      success: true,
      settings: row
        ? {
            note_creation_prompt: row.note_creation_prompt,
            note_assignment_prompt: row.note_assignment_prompt,
            annotate_all_segments: row.annotate_all_segments,
            selected_segment_ids: selectedSegmentIds,
          }
        : null,
      segments: normalizedSegments,
      segment_metadata_available: hasSegmentMetadata(normalizedSegments),
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

    const scope =
      payload.scope === 'segments' ? 'segments' : payload.scope === 'all' ? 'all' : null
    if (!scope) {
      return NextResponse.json(
        {
          success: false,
          error: 'Scope must be either "all" or "segments".',
        },
        { status: 400 },
      )
    }

    const requestedSegmentIds = parseSegmentIdsFromBody(payload.segmentIds)
    const transcriptSegments = await findTranscriptSegments(transcriptId)
    const normalizedSegments = normalizeTranscriptSegments(transcriptSegments)
    const validSegmentIds = new Set(normalizedSegments.map((segment) => segment.id))

    const annotateAllSegments = scope === 'all'
    let normalizedSelectedSegmentIds: string[] = []

    if (!annotateAllSegments) {
      if (requestedSegmentIds.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Select at least one segment when segment mode is selected.',
          },
          { status: 400 },
        )
      }

      const invalidSegmentIds = requestedSegmentIds.filter((segmentId) => !validSegmentIds.has(segmentId))
      if (invalidSegmentIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'One or more selected segments are invalid for this transcript.',
          },
          { status: 400 },
        )
      }

      const selectedSegmentIdSet = new Set(requestedSegmentIds)
      normalizedSelectedSegmentIds = normalizedSegments
        .filter((segment) => selectedSegmentIdSet.has(segment.id))
        .map((segment) => segment.id)
    }

    const selectedSegmentIdsJson = annotateAllSegments
      ? null
      : JSON.stringify(normalizedSelectedSegmentIds)

    await prisma.$executeRaw`
      INSERT INTO "LLMNotePrompts" (
        "id",
        "transcript_id",
        "created_by",
        "note_creation_prompt",
        "note_assignment_prompt",
        "annotate_all_segments",
        "selected_segment_ids_json"
      )
      VALUES (
        ${randomUUID()},
        ${transcriptId},
        ${actor.id},
        ${payload.noteCreationPrompt},
        ${payload.noteAssignmentPrompt},
        ${annotateAllSegments},
        ${selectedSegmentIdsJson}
      )
    `

    return NextResponse.json({
      success: true,
      settings: {
        note_creation_prompt: payload.noteCreationPrompt,
        note_assignment_prompt: payload.noteAssignmentPrompt,
        annotate_all_segments: annotateAllSegments,
        selected_segment_ids: normalizedSelectedSegmentIds,
      },
      segments: normalizedSegments,
      segment_metadata_available: hasSegmentMetadata(normalizedSegments),
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
