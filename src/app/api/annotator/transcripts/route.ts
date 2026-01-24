import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
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

    const annotations = await prisma.annotations.findMany({
      where: { created_for: annotator.id, hide: { not: true } },
      select: {
        id: true,
        annotation_completed: true,
        transcript: {
          select: {
            id: true,
            title: true,
            grade: true,
            instruction_context: true,
            video_uploaded: true,
          },
        },
      },
      orderBy: { last_updated: 'desc' },
    })

    const transcriptIds = annotations
      .map((annotation) => annotation.transcript?.id)
      .filter((id): id is string => Boolean(id))

    const noteCountByTranscript = new Map<string, number>()
    if (transcriptIds.length > 0) {
      const noteCounts = await prisma.notes.groupBy({
        by: ['transcript_id'],
        _count: { note_id: true },
        where: {
          user_id: annotator.id,
          transcript_id: { in: transcriptIds },
        },
      })

      for (const count of noteCounts) {
        noteCountByTranscript.set(count.transcript_id, count._count.note_id)
      }
    }

    const flaggedLines = await prisma.flagAssignments.findMany({
      where: { user_id: annotator.id },
      select: {
        line: {
          select: { transcript_id: true },
        },
      },
    })

    const flaggedCountByTranscript = new Map<string, number>()
    flaggedLines.forEach((flag) => {
      const transcriptId = flag.line?.transcript_id
      if (!transcriptId) return
      flaggedCountByTranscript.set(
        transcriptId,
        (flaggedCountByTranscript.get(transcriptId) ?? 0) + 1,
      )
    })

    const latestAssignmentAtByTranscript = new Map<string, Date>()
    if (transcriptIds.length > 0) {
      const assignments = await prisma.noteAssignments.findMany({
        where: {
          note: {
            user_id: annotator.id,
            transcript_id: { in: transcriptIds },
          },
        },
        select: {
          createdAt: true,
          note: {
            select: {
              transcript_id: true,
            },
          },
        },
      })

      for (const assignment of assignments) {
        const transcriptId = assignment.note.transcript_id
        const currentLatest = latestAssignmentAtByTranscript.get(transcriptId)
        if (!currentLatest || assignment.createdAt > currentLatest) {
          latestAssignmentAtByTranscript.set(transcriptId, assignment.createdAt)
        }
      }
    }

    const normalized = annotations
      .filter((annotation) => Boolean(annotation.transcript))
      .map((annotation) => ({
        annotationId: annotation.id,
        transcriptId: annotation.transcript!.id,
        title: annotation.transcript!.title,
        grade: annotation.transcript!.grade ?? null,
        instructionContext: annotation.transcript!.instruction_context ?? '',
        videoUploaded: annotation.transcript!.video_uploaded ?? false,
        status: annotation.annotation_completed
          ? 'completed'
          : (noteCountByTranscript.get(annotation.transcript!.id) ?? 0) > 0
            ? 'in_progress'
            : 'not_started',
        lastUpdated:
          latestAssignmentAtByTranscript.get(annotation.transcript!.id)?.toISOString?.() ??
          null,
        flaggedLines: flaggedCountByTranscript.get(annotation.transcript!.id) ?? 0,
      }))
      .sort((a, b) => {
        const aTime = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0
        const bTime = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0
        return bTime - aTime
      })

    return NextResponse.json({
      success: true,
      transcripts: normalized,
    })
  } catch (error) {
    console.error('Failed to fetch annotator transcripts', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load transcripts. Please try again later.',
      },
      { status: 500 },
    )
  }
}
