import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = await context.params
    const searchParams = new URL(request.url).searchParams
    const transcriptIdFromParams = params?.transcriptId
    const transcriptIdFromQuery = searchParams.get('transcriptId') ?? undefined
    const transcriptIdFromQueryAlias = searchParams.get('transcript') ?? undefined
    const transcriptId =
      transcriptIdFromParams ?? transcriptIdFromQuery ?? transcriptIdFromQueryAlias

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

    const annotation = await prisma.annotations.findFirst({
      where: { transcript_id: transcriptId, created_for: annotator.id, hide: { not: true } },
      select: {
        id: true,
        annotation_completed: true,
        llm_annotation_visibility_user: true,
        llm_annotation_visibility_admin: true,
        transcript: {
          select: {
            id: true,
            title: true,
            grade: true,
            instruction_context: true,
          },
        },
      },
    })

    if (!annotation || !annotation.transcript) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    const lines = await prisma.transcriptLines.findMany({
      where: { transcript_id: transcriptId },
      orderBy: { line: 'asc' },
      select: {
        line_id: true,
        line: true,
        speaker: true,
        utterance: true,
        in_cue: true,
        out_cue: true,
        segment_id: true,
        flagAssignments: {
          where: { user_id: annotator.id },
          select: { user_id: true },
        },
      },
    })

    const segments = await prisma.transcriptSegments.findMany({
      where: { transcript_id: transcriptId },
      orderBy: { segment_index: 'asc' },
      select: {
        id: true,
        segment_title: true,
        segment_index: true,
        start_time: true,
        end_time: true,
      },
    })

    const normalizedLines = lines
      .filter((line) => Boolean((line.utterance ?? '').trim()))
      .map((line) => ({
        id: line.line_id,
        line: line.line,
        speaker: line.speaker?.trim() || 'Unknown speaker',
        utterance: line.utterance ?? '',
        inCue: line.in_cue === null ? null : Number(line.in_cue),
        outCue: line.out_cue === null ? null : Number(line.out_cue),
        segmentId: line.segment_id ?? null,
        flagged: (line.flagAssignments?.length ?? 0) > 0,
      }))

    const normalizedSegments = segments.map((segment) => ({
      id: segment.id,
      title: segment.segment_title,
      index: segment.segment_index,
      startTime: segment.start_time === null ? null : Number(segment.start_time),
      endTime: segment.end_time === null ? null : Number(segment.end_time),
    }))

    const [latestAssignment, noteCount] = await Promise.all([
      prisma.noteAssignments.findFirst({
        where: {
          note: {
            user_id: annotator.id,
            transcript_id: transcriptId,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          createdAt: true,
        },
      }),
      prisma.notes.count({
        where: {
          user_id: annotator.id,
          transcript_id: transcriptId,
        },
      }),
    ])

    // Compute status dynamically based on annotation_completed and note count
    const status = annotation.annotation_completed
      ? 'completed'
      : noteCount > 0
        ? 'in_progress'
        : 'not_started'

    return NextResponse.json({
      success: true,
      transcript: {
        id: annotation.transcript.id,
        title: annotation.transcript.title,
        grade: annotation.transcript.grade ?? null,
        instructionContext: annotation.transcript.instruction_context ?? '',
        annotationId: annotation.id,
        status,
        annotationCompleted: annotation.annotation_completed,
        llmAnnotationVisibilityUser: annotation.llm_annotation_visibility_user,
        llmAnnotationVisibilityAdmin: annotation.llm_annotation_visibility_admin,
        lastUpdated:
          latestAssignment?.createdAt?.toISOString?.() ??
          null,
      },
      lines: normalizedLines,
      segments: normalizedSegments,
    })
  } catch (error) {
    console.error('Failed to fetch transcript for annotator', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load transcript data. Please try again later.',
      },
      { status: 500 },
    )
  }
}
