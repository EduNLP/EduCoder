import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const annotations = await prisma.annotations.findMany({
      select: {
        id: true,
        gcs_path: true,
        hide: true,
        annotation_completed: true,
        upload_time: true,
        transcript_id: true,
        created_for: true,
        transcript: {
          select: {
            id: true,
            title: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        upload_time: 'desc',
      },
    })

    const pairLookup = new Map<string, { user_id: string; transcript_id: string }>()
    for (const annotation of annotations) {
      if (!annotation.created_for || !annotation.transcript_id) {
        continue
      }
      const key = `${annotation.created_for}:${annotation.transcript_id}`
      if (!pairLookup.has(key)) {
        pairLookup.set(key, {
          user_id: annotation.created_for,
          transcript_id: annotation.transcript_id,
        })
      }
    }

    const pairFilters = Array.from(pairLookup.values())
    const noteCountByPair = new Map<string, number>()
    if (pairFilters.length > 0) {
      const noteCounts = await prisma.notes.groupBy({
        by: ['user_id', 'transcript_id'],
        _count: {
          note_id: true,
        },
        where: {
          OR: pairFilters,
        },
      })

      for (const count of noteCounts) {
        const key = `${count.user_id}:${count.transcript_id}`
        noteCountByPair.set(key, count._count.note_id)
      }
    }

    const annotatedLineCountByPair = new Map<string, number>()
    const latestAssignmentAtByPair = new Map<string, Date>()
    if (pairFilters.length > 0) {
      const assignments = await prisma.noteAssignments.findMany({
        where: {
          note: {
            OR: pairFilters,
          },
        },
        select: {
          line_id: true,
          createdAt: true,
          note: {
            select: {
              user_id: true,
              transcript_id: true,
            },
          },
        },
      })

      const lineIdsByPair = new Map<string, Set<string>>()
      for (const assignment of assignments) {
        const key = `${assignment.note.user_id}:${assignment.note.transcript_id}`
        const lineIds = lineIdsByPair.get(key) ?? new Set<string>()
        lineIds.add(assignment.line_id)
        lineIdsByPair.set(key, lineIds)

        const currentLatest = latestAssignmentAtByPair.get(key)
        if (!currentLatest || assignment.createdAt > currentLatest) {
          latestAssignmentAtByPair.set(key, assignment.createdAt)
        }
      }

      for (const [key, lineIds] of lineIdsByPair) {
        annotatedLineCountByPair.set(key, lineIds.size)
      }
    }

    const normalized = annotations.map((annotation) => {
      const pairKey =
        annotation.created_for && annotation.transcript_id
          ? `${annotation.created_for}:${annotation.transcript_id}`
          : null
      const noteCount = pairKey ? noteCountByPair.get(pairKey) ?? 0 : 0
      const annotatedLineCount = pairKey
        ? annotatedLineCountByPair.get(pairKey) ?? 0
        : 0
      const lastUpdatedAt = pairKey
        ? latestAssignmentAtByPair.get(pairKey)?.toISOString?.() ?? null
        : null
      const status = annotation.annotation_completed
        ? 'completed'
        : noteCount > 0
          ? 'in_progress'
          : 'not_started'

      return {
        noteCount,
        annotatedLineCount,
        lastUpdatedAt,
        id: annotation.id,
        status,
        gcs_path: annotation.gcs_path,
        hide: annotation.hide ?? false,
        uploadedAt: annotation.upload_time?.toISOString?.() ?? null,
        transcript: annotation.transcript
          ? {
              id: annotation.transcript.id,
              title: annotation.transcript.title,
            }
          : null,
        annotator: annotation.user
          ? {
              id: annotation.user.id,
              name: annotation.user.name,
              username: annotation.user.username,
            }
          : null,
      }
    })

    return NextResponse.json({
      success: true,
      annotations: normalized,
    })
  } catch (error) {
    console.error('Failed to fetch annotations', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to fetch annotations. Please try again later.',
      },
      { status: 500 },
    )
  }
}
