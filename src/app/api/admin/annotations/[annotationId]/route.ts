import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    annotationId?: string
  }>
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true, role: true },
    })

    if (!actor || actor.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only admins can delete annotations.' },
        { status: 403 },
      )
    }

    const params = await context.params
    const searchParams = new URL(request.url).searchParams
    const body = await request.json().catch(() => null)
    const annotationIdFromParams = params?.annotationId
    const annotationIdFromQuery = searchParams.get('annotationId')
    const annotationIdFromBody =
      typeof body?.annotationId === 'string' ? body.annotationId.trim() : ''
    const annotationId =
      annotationIdFromParams ?? annotationIdFromQuery ?? annotationIdFromBody ?? ''

    if (!annotationId) {
      return NextResponse.json(
        { success: false, error: 'Annotation id is required.' },
        { status: 400 },
      )
    }

    const annotation = await prisma.annotations.findUnique({
      where: { id: annotationId },
      select: {
        id: true,
        hide: true,
        created_for: true,
        transcript_id: true,
      },
    })

    if (!annotation) {
      return NextResponse.json(
        { success: false, error: 'Annotation not found.' },
        { status: 404 },
      )
    }

    if (!annotation.hide) {
      return NextResponse.json(
        { success: false, error: 'Only hidden annotations can be deleted.' },
        { status: 409 },
      )
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const notes = await tx.notes.findMany({
        where: {
          user_id: annotation.created_for,
          transcript_id: annotation.transcript_id,
        },
        select: { note_id: true },
      })

      const noteIds = notes.map((note) => note.note_id)
      const noteAssignmentsResult =
        noteIds.length > 0
          ? await tx.noteAssignments.deleteMany({
              where: { note_id: { in: noteIds } },
            })
          : { count: 0 }

      const notesResult = await tx.notes.deleteMany({
        where: {
          user_id: annotation.created_for,
          transcript_id: annotation.transcript_id,
        },
      })

      const flagAssignmentsResult = await tx.flagAssignments.deleteMany({
        where: {
          user_id: annotation.created_for,
          line: {
            transcript_id: annotation.transcript_id,
          },
        },
      })

      await tx.annotations.delete({ where: { id: annotation.id } })

      return {
        noteAssignments: noteAssignmentsResult.count,
        notes: notesResult.count,
        flagAssignments: flagAssignmentsResult.count,
      }
    })

    return NextResponse.json({
      success: true,
      annotationId: annotation.id,
      deleted,
    })
  } catch (error) {
    console.error('Failed to delete annotation', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to delete annotation right now.',
      },
      { status: 500 },
    )
  }
}
