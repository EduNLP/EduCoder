import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type VisibilityPayload = {
  transcriptId?: string
  visible?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as VisibilityPayload | null
    const transcriptId =
      typeof body?.transcriptId === 'string' ? body.transcriptId.trim() : ''
    const visible = typeof body?.visible === 'boolean' ? body.visible : null

    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    if (visible === null) {
      return NextResponse.json(
        { success: false, error: 'Visibility value is required.' },
        { status: 400 },
      )
    }

    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const annotator = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true },
    })

    if (!annotator) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const assignment = await prisma.annotations.findFirst({
      where: {
        transcript_id: transcriptId,
        created_for: annotator.id,
        hide: { not: true },
      },
      select: { id: true },
    })

    if (!assignment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    const updated = await prisma.annotations.update({
      where: { id: assignment.id },
      data: { llm_annotation_visibility_user: visible },
      select: { llm_annotation_visibility_user: true },
    })

    return NextResponse.json({
      success: true,
      llmAnnotationVisibilityUser: updated.llm_annotation_visibility_user,
    })
  } catch (error) {
    console.error('Failed to update LLM notes visibility', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to update LLM notes visibility. Please try again later.',
      },
      { status: 500 },
    )
  }
}
