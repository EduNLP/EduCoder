import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type NoteAssignmentPayload = {
  noteId?: string
  lineIds?: string[]
  assigned?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | NoteAssignmentPayload
      | null
    const noteId = typeof body?.noteId === 'string' ? body.noteId.trim() : ''
    const lineIds = Array.isArray(body?.lineIds)
      ? body.lineIds.filter((lineId): lineId is string => typeof lineId === 'string')
      : []
    const assigned = typeof body?.assigned === 'boolean' ? body.assigned : null

    if (!noteId) {
      return NextResponse.json(
        { success: false, error: 'Note id is required.' },
        { status: 400 },
      )
    }

    const uniqueLineIds = Array.from(
      new Set(lineIds.map((lineId) => lineId.trim()).filter(Boolean)),
    )

    if (uniqueLineIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one line id is required.' },
        { status: 400 },
      )
    }

    if (assigned === null) {
      return NextResponse.json(
        { success: false, error: 'Assignment value is required.' },
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

    const note = await prisma.notes.findFirst({
      where: { note_id: noteId, user_id: annotator.id },
      select: { note_id: true, transcript_id: true },
    })

    if (!note) {
      return NextResponse.json(
        { success: false, error: 'Note not found.' },
        { status: 404 },
      )
    }

    const assignment = await prisma.annotations.findFirst({
      where: {
        transcript_id: note.transcript_id,
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

    const validLines = await prisma.transcriptLines.findMany({
      where: { line_id: { in: uniqueLineIds }, transcript_id: note.transcript_id },
      select: { line_id: true },
    })

    if (validLines.length !== uniqueLineIds.length) {
      return NextResponse.json(
        { success: false, error: 'One or more transcript lines are invalid.' },
        { status: 400 },
      )
    }

    if (assigned) {
      await prisma.noteAssignments.createMany({
        data: uniqueLineIds.map((lineId) => ({
          note_id: note.note_id,
          line_id: lineId,
        })),
        skipDuplicates: true,
      })
    } else {
      await prisma.noteAssignments.deleteMany({
        where: { note_id: note.note_id, line_id: { in: uniqueLineIds } },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update note assignments', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to update note assignments. Please try again later.',
      },
      { status: 500 },
    )
  }
}
