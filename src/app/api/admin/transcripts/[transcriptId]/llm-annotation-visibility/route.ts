import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import type { LLMAnnotationVisibilityAdmin } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type SaveVisibilityBody = {
  defaultVisibility?: unknown
  perAnnotator?: unknown
  annotatorVisibility?: unknown
}

type SaveVisibilityResponse = {
  success: boolean
  defaultVisibility?: LLMAnnotationVisibilityAdmin
  perAnnotator?: boolean
  annotatorVisibility?: Record<string, LLMAnnotationVisibilityAdmin>
  error?: string
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

const findActor = async (authUserId: string) =>
  prisma.user.findFirst({
    where: { auth_user_id: authUserId },
    select: { id: true, workspace_id: true },
  })

const findWorkspaceTranscript = async (transcriptId: string, workspaceId: string) =>
  prisma.transcripts.findFirst({
    where: { id: transcriptId, workspace_id: workspaceId },
    select: {
      id: true,
      llm_annotation_visibility_default: true,
      llm_annotation_visibility_per_annotator: true,
    },
  })

const parseVisibility = (value: unknown): LLMAnnotationVisibilityAdmin | null => {
  if (typeof value !== 'string') {
    return null
  }

  if (value === 'hidden' || value === 'visible_after_completion' || value === 'always_visible') {
    return value
  }

  return null
}

const parsePerAnnotator = (value: unknown): boolean | null => {
  if (typeof value !== 'boolean') {
    return null
  }

  return value
}

const parseAnnotatorVisibility = (
  value: unknown,
): Record<string, LLMAnnotationVisibilityAdmin> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const result: Record<string, LLMAnnotationVisibilityAdmin> = {}

  for (const [annotatorId, rawVisibility] of Object.entries(candidate)) {
    if (!annotatorId) {
      continue
    }

    const parsed = parseVisibility(rawVisibility)
    if (!parsed) {
      return null
    }
    result[annotatorId] = parsed
  }

  return result
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

    const payload = (await request.json().catch(() => null)) as SaveVisibilityBody | null
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Request body is required.' },
        { status: 400 },
      )
    }

    const hasDefaultVisibility = Object.prototype.hasOwnProperty.call(
      payload,
      'defaultVisibility',
    )
    const hasPerAnnotator = Object.prototype.hasOwnProperty.call(payload, 'perAnnotator')
    const hasAnnotatorVisibility = Object.prototype.hasOwnProperty.call(
      payload,
      'annotatorVisibility',
    )

    const visibility = hasDefaultVisibility
      ? parseVisibility(payload.defaultVisibility)
      : null
    const perAnnotator = hasPerAnnotator ? parsePerAnnotator(payload.perAnnotator) : null
    const annotatorVisibility = hasAnnotatorVisibility
      ? parseAnnotatorVisibility(payload.annotatorVisibility)
      : null

    if (hasDefaultVisibility && !visibility) {
      return NextResponse.json(
        {
          success: false,
          error: 'Default visibility must be hidden, visible_after_completion, or always_visible.',
        },
        { status: 400 },
      )
    }

    if (hasPerAnnotator && perAnnotator === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Per-annotator visibility must be true or false.',
        },
        { status: 400 },
      )
    }

    if (hasAnnotatorVisibility && annotatorVisibility === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Annotator visibility must be an object keyed by annotator id with values of hidden, visible_after_completion, or always_visible.',
        },
        { status: 400 },
      )
    }

    if (!hasDefaultVisibility && !hasPerAnnotator && !hasAnnotatorVisibility) {
      return NextResponse.json(
        {
          success: false,
          error:
            'At least one visibility field (defaultVisibility, perAnnotator, or annotatorVisibility) must be provided.',
        },
        { status: 400 },
      )
    }

    const data: {
      llm_annotation_visibility_default?: LLMAnnotationVisibilityAdmin
      llm_annotation_visibility_per_annotator?: boolean
    } = {}

    if (visibility) {
      data.llm_annotation_visibility_default = visibility
    }
    if (perAnnotator !== null) {
      data.llm_annotation_visibility_per_annotator = perAnnotator
    }

    let updated = {
      llm_annotation_visibility_default: transcript.llm_annotation_visibility_default,
      llm_annotation_visibility_per_annotator: transcript.llm_annotation_visibility_per_annotator,
    }

    if (Object.keys(data).length > 0) {
      updated = await prisma.transcripts.update({
        where: { id: transcriptId },
        data,
        select: {
          llm_annotation_visibility_default: true,
          llm_annotation_visibility_per_annotator: true,
        },
      })
    }

    if (perAnnotator === false) {
      await prisma.annotations.updateMany({
        where: {
          transcript_id: transcriptId,
        },
        data: {
          llm_annotation_visibility_admin: updated.llm_annotation_visibility_default,
        },
      })
    } else if (annotatorVisibility && Object.keys(annotatorVisibility).length > 0) {
      await prisma.$transaction(
        Object.entries(annotatorVisibility).map(([annotatorId, visibility]) =>
          prisma.annotations.updateMany({
            where: {
              transcript_id: transcriptId,
              created_for: annotatorId,
            },
            data: {
              llm_annotation_visibility_admin: visibility,
            },
          }),
        ),
      )
    }

    return NextResponse.json<SaveVisibilityResponse>({
      success: true,
      defaultVisibility: updated.llm_annotation_visibility_default,
      perAnnotator: updated.llm_annotation_visibility_per_annotator,
      annotatorVisibility: perAnnotator === false ? undefined : annotatorVisibility ?? undefined,
    })
  } catch (error) {
    console.error('Failed to update LLM annotation visibility', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to update LLM annotation visibility right now.',
      },
      { status: 500 },
    )
  }
}
