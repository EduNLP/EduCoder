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
  adminVisibility?: unknown
  userVisibility?: unknown
  perAnnotator?: unknown
  annotatorVisibility?: unknown
}

type SaveVisibilityResponse = {
  success: boolean
  adminVisibility?: LLMAnnotationVisibilityAdmin
  userVisibility?: boolean
  perAnnotator?: boolean
  annotatorVisibility?: Record<string, LLMAnnotationVisibilityAdmin>
  error?: string
}

type ScavengerAssignmentPayload = {
  id: string
  created_for: string
  scavenger_visibility_admin: LLMAnnotationVisibilityAdmin
  user: {
    id: string
    name: string
    username: string
  } | null
}

type VisibilityDetailsResponse = {
  success: boolean
  adminVisibility?: LLMAnnotationVisibilityAdmin
  userVisibility?: boolean
  perAnnotator?: boolean
  assignments?: ScavengerAssignmentPayload[]
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
    select: { id: true },
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

const parseUserVisibility = (value: unknown): boolean | null => {
  if (typeof value !== 'boolean') {
    return null
  }

  return value
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

    const scavengerHunt = await prisma.scavengerHunt.findUnique({
      where: { transcript_id: transcriptId },
      select: {
        id: true,
        scavenger_visibility_admin: true,
        scavenger_visibility_user: true,
      },
    })

    if (!scavengerHunt) {
      return NextResponse.json(
        { success: false, error: 'Scavenger hunt not found.' },
        { status: 404 },
      )
    }

    const assignments = await prisma.scavengerHuntAssignment.findMany({
      where: { scavenger_id: scavengerHunt.id },
      select: {
        id: true,
        created_for: true,
        scavenger_visibility_admin: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        assigned_time: 'asc',
      },
    })

    const perAnnotator = assignments.some(
      (assignment) =>
        assignment.scavenger_visibility_admin !== scavengerHunt.scavenger_visibility_admin,
    )

    return NextResponse.json<VisibilityDetailsResponse>({
      success: true,
      adminVisibility: scavengerHunt.scavenger_visibility_admin,
      userVisibility: scavengerHunt.scavenger_visibility_user,
      perAnnotator,
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        created_for: assignment.created_for,
        scavenger_visibility_admin: assignment.scavenger_visibility_admin,
        user: assignment.user
          ? {
              id: assignment.user.id,
              name: assignment.user.name,
              username: assignment.user.username,
            }
          : null,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch scavenger hunt visibility details', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load scavenger hunt visibility details right now.',
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

    const scavengerHunt = await prisma.scavengerHunt.findUnique({
      where: { transcript_id: transcriptId },
      select: {
        id: true,
        scavenger_visibility_admin: true,
        scavenger_visibility_user: true,
      },
    })

    if (!scavengerHunt) {
      return NextResponse.json(
        { success: false, error: 'Scavenger hunt not found.' },
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

    const hasAdminVisibility = Object.prototype.hasOwnProperty.call(
      payload,
      'adminVisibility',
    )
    const hasUserVisibility = Object.prototype.hasOwnProperty.call(
      payload,
      'userVisibility',
    )
    const hasPerAnnotator = Object.prototype.hasOwnProperty.call(payload, 'perAnnotator')
    const hasAnnotatorVisibility = Object.prototype.hasOwnProperty.call(
      payload,
      'annotatorVisibility',
    )

    const adminVisibility = hasAdminVisibility
      ? parseVisibility(payload.adminVisibility)
      : null
    const userVisibility = hasUserVisibility
      ? parseUserVisibility(payload.userVisibility)
      : null
    const perAnnotator = hasPerAnnotator ? parsePerAnnotator(payload.perAnnotator) : null
    const annotatorVisibility = hasAnnotatorVisibility
      ? parseAnnotatorVisibility(payload.annotatorVisibility)
      : null

    if (hasAdminVisibility && !adminVisibility) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Admin visibility must be hidden, visible_after_completion, or always_visible.',
        },
        { status: 400 },
      )
    }

    if (hasUserVisibility && userVisibility === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'User visibility must be true or false.',
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

    if (!hasAdminVisibility && !hasUserVisibility && !hasPerAnnotator && !hasAnnotatorVisibility) {
      return NextResponse.json(
        {
          success: false,
          error:
            'At least one visibility field (adminVisibility, userVisibility, perAnnotator, or annotatorVisibility) must be provided.',
        },
        { status: 400 },
      )
    }

    const data: {
      scavenger_visibility_admin?: LLMAnnotationVisibilityAdmin
      scavenger_visibility_user?: boolean
    } = {}

    if (adminVisibility) {
      data.scavenger_visibility_admin = adminVisibility
    }
    if (userVisibility !== null) {
      data.scavenger_visibility_user = userVisibility
    }

    let updated = {
      scavenger_visibility_admin: scavengerHunt.scavenger_visibility_admin,
      scavenger_visibility_user: scavengerHunt.scavenger_visibility_user,
    }

    if (Object.keys(data).length > 0) {
      updated = await prisma.scavengerHunt.update({
        where: { id: scavengerHunt.id },
        data,
        select: {
          scavenger_visibility_admin: true,
          scavenger_visibility_user: true,
        },
      })
    }

    if (perAnnotator === false) {
      await prisma.scavengerHuntAssignment.updateMany({
        where: { scavenger_id: scavengerHunt.id },
        data: { scavenger_visibility_admin: updated.scavenger_visibility_admin },
      })
    } else if (annotatorVisibility && Object.keys(annotatorVisibility).length > 0) {
      await prisma.$transaction(
        Object.entries(annotatorVisibility).map(([annotatorId, visibility]) =>
          prisma.scavengerHuntAssignment.updateMany({
            where: {
              scavenger_id: scavengerHunt.id,
              created_for: annotatorId,
            },
            data: {
              scavenger_visibility_admin: visibility,
            },
          }),
        ),
      )
    }

    return NextResponse.json<SaveVisibilityResponse>({
      success: true,
      adminVisibility: updated.scavenger_visibility_admin,
      userVisibility: updated.scavenger_visibility_user,
      perAnnotator: perAnnotator ?? undefined,
      annotatorVisibility: perAnnotator === false ? undefined : annotatorVisibility ?? undefined,
    })
  } catch (error) {
    console.error('Failed to update scavenger hunt visibility', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to update scavenger hunt visibility right now.',
      },
      { status: 500 },
    )
  }
}
