import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

const resolveTranscriptId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const transcriptIdFromParams = params?.transcriptId?.trim() ?? ''
  if (transcriptIdFromParams) {
    return transcriptIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  const transcriptIdFromQuery = searchParams.get('transcriptId')?.trim() ?? ''
  if (transcriptIdFromQuery) {
    return transcriptIdFromQuery
  }

  const body = await request.json().catch(() => null)
  return typeof body?.transcriptId === 'string' ? body.transcriptId.trim() : ''
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true, role: true, workspace_id: true },
    })

    if (!actor || actor.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only admins can delete generated LLM notes.' },
        { status: 403 },
      )
    }

    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const transcript = await prisma.transcripts.findFirst({
      where: {
        id: transcriptId,
        workspace_id: actor.workspace_id,
      },
      select: {
        id: true,
      },
    })

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const deleted = await prisma.notes.deleteMany({
      where: {
        transcript_id: transcriptId,
        source: 'llm',
      },
    })

    return NextResponse.json({
      success: true,
      transcriptId,
      notesDeleted: deleted.count,
    })
  } catch (error) {
    console.error('Failed to delete generated LLM notes', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to delete generated LLM notes right now.',
      },
      { status: 500 },
    )
  }
}
