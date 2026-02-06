import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
const SYSTEM_USERNAME = 'llm-system'

type NotePayload = {
  noteId?: string
  transcriptId?: string
  title?: string
  studentEvidence?: string
  utteranceNote?: string
  thinkingInsight?: string
  q1?: string
  q2?: string
  q3?: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const transcriptId = (searchParams.get('transcriptId') ?? '').trim()

    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
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
      select: { id: true, workspace_id: true },
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

    const notes = await prisma.notes.findMany({
      where: { transcript_id: transcriptId, user_id: annotator.id },
      orderBy: { note_number: 'asc' },
      select: {
        note_id: true,
        note_number: true,
        title: true,
        q1: true,
        q2: true,
        q3: true,
      },
    })

    const noteIds = notes.map((note) => note.note_id)
    const assignments =
      noteIds.length > 0
        ? await prisma.noteAssignments.findMany({
            where: { note_id: { in: noteIds } },
            select: { note_id: true, line_id: true },
          })
        : []

    const llmSystemUser = await prisma.user.findFirst({
      where: { workspace_id: annotator.workspace_id, username: SYSTEM_USERNAME },
      select: { id: true },
    })
    const llmNotes = llmSystemUser
      ? await prisma.notes.findMany({
          where: {
            transcript_id: transcriptId,
            user_id: llmSystemUser.id,
            source: 'llm',
          },
          orderBy: { note_number: 'asc' },
          select: {
            note_id: true,
            note_number: true,
            title: true,
            q1: true,
            q2: true,
            q3: true,
          },
        })
      : []
    const llmNoteIds = llmNotes.map((note) => note.note_id)
    const llmAssignments =
      llmNoteIds.length > 0
        ? await prisma.noteAssignments.findMany({
            where: { note_id: { in: llmNoteIds } },
            select: { note_id: true, line_id: true },
          })
        : []

    return NextResponse.json({
      success: true,
      notes: notes.map((note) => ({
        id: note.note_id,
        number: note.note_number,
        title: note.title,
        q1: note.q1,
        q2: note.q2,
        q3: note.q3,
      })),
      assignments: assignments.map((assignment) => ({
        noteId: assignment.note_id,
        lineId: assignment.line_id,
      })),
      llmNotes: llmNotes.map((note) => ({
        id: note.note_id,
        number: note.note_number,
        title: note.title,
        q1: note.q1,
        q2: note.q2,
        q3: note.q3,
      })),
      llmAssignments: llmAssignments.map((assignment) => ({
        noteId: assignment.note_id,
        lineId: assignment.line_id,
      })),
    })
  } catch (error) {
    console.error('Failed to load notes', error)
    return NextResponse.json(
      { success: false, error: 'Unable to load notes. Please try again later.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as NotePayload | null
    const transcriptId =
      typeof body?.transcriptId === 'string' ? body.transcriptId.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const q1 =
      typeof body?.studentEvidence === 'string'
        ? body.studentEvidence.trim()
        : typeof body?.q1 === 'string'
          ? body.q1.trim()
          : ''
    const q2 =
      typeof body?.utteranceNote === 'string'
        ? body.utteranceNote.trim()
        : typeof body?.q2 === 'string'
          ? body.q2.trim()
          : ''
    const q3 =
      typeof body?.thinkingInsight === 'string'
        ? body.thinkingInsight.trim()
        : typeof body?.q3 === 'string'
          ? body.q3.trim()
          : ''

    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'Title is required.' },
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

    const createdNote = await prisma.$transaction(async (tx) => {
      const maxNoteNumber = await tx.notes.aggregate({
        where: { transcript_id: transcriptId, user_id: annotator.id },
        _max: { note_number: true },
      })
      const nextNoteNumber = (maxNoteNumber._max?.note_number ?? 0) + 1

      return tx.notes.create({
        data: {
          transcript_id: transcriptId,
          user_id: annotator.id,
          note_number: nextNoteNumber,
          title,
          q1,
          q2,
          q3,
          createdAt: new Date(),
        },
        select: {
          note_id: true,
          note_number: true,
          title: true,
          q1: true,
          q2: true,
          q3: true,
        },
      })
    })

    return NextResponse.json({
      success: true,
      note: {
        id: createdNote.note_id,
        number: createdNote.note_number,
        title: createdNote.title,
        q1: createdNote.q1,
        q2: createdNote.q2,
        q3: createdNote.q3,
      },
    })
  } catch (error) {
    console.error('Failed to create note', error)
    return NextResponse.json(
      { success: false, error: 'Unable to create note. Please try again later.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as NotePayload | null
    const noteId = typeof body?.noteId === 'string' ? body.noteId.trim() : ''

    if (!noteId) {
      return NextResponse.json(
        { success: false, error: 'Note id is required.' },
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

    const existingNote = await prisma.notes.findFirst({
      where: { note_id: noteId, user_id: annotator.id },
      select: {
        note_id: true,
        note_number: true,
        title: true,
        q1: true,
        q2: true,
        q3: true,
      },
    })

    if (!existingNote) {
      return NextResponse.json(
        { success: false, error: 'Note not found.' },
        { status: 404 },
      )
    }

    const title =
      typeof body?.title === 'string' ? body.title.trim() : existingNote.title
    const q1 =
      typeof body?.studentEvidence === 'string'
        ? body.studentEvidence.trim()
        : typeof body?.q1 === 'string'
          ? body.q1.trim()
          : existingNote.q1
    const q2 =
      typeof body?.utteranceNote === 'string'
        ? body.utteranceNote.trim()
        : typeof body?.q2 === 'string'
          ? body.q2.trim()
          : existingNote.q2
    const q3 =
      typeof body?.thinkingInsight === 'string'
        ? body.thinkingInsight.trim()
        : typeof body?.q3 === 'string'
          ? body.q3.trim()
          : existingNote.q3

    const updatedNote = await prisma.notes.update({
      where: { note_id: noteId },
      data: {
        title,
        q1,
        q2,
        q3,
      },
      select: {
        note_id: true,
        note_number: true,
        title: true,
        q1: true,
        q2: true,
        q3: true,
      },
    })

    return NextResponse.json({
      success: true,
      note: {
        id: updatedNote.note_id,
        number: updatedNote.note_number,
        title: updatedNote.title,
        q1: updatedNote.q1,
        q2: updatedNote.q2,
        q3: updatedNote.q3,
      },
    })
  } catch (error) {
    console.error('Failed to update note', error)
    return NextResponse.json(
      { success: false, error: 'Unable to update note. Please try again later.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as NotePayload | null
    const noteId = typeof body?.noteId === 'string' ? body.noteId.trim() : ''

    if (!noteId) {
      return NextResponse.json(
        { success: false, error: 'Note id is required.' },
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

    const existingNote = await prisma.notes.findFirst({
      where: { note_id: noteId, user_id: annotator.id },
      select: { note_id: true },
    })

    if (!existingNote) {
      return NextResponse.json(
        { success: false, error: 'Note not found.' },
        { status: 404 },
      )
    }

    await prisma.notes.delete({ where: { note_id: noteId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete note', error)
    return NextResponse.json(
      { success: false, error: 'Unable to delete note. Please try again later.' },
      { status: 500 },
    )
  }
}
