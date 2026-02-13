import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type SubmissionStatus = 'not_started' | 'in_progress' | 'completed'

export async function GET() {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true, workspace_id: true },
    })

    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const submissions = await prisma.scavengerHuntAssignment.findMany({
      where: {
        scavenger: {
          transcript: {
            workspace_id: actor.workspace_id,
          },
        },
      },
      select: {
        id: true,
        scavenger_completed: true,
        assigned_time: true,
        completedAt: true,
        scavenger_visibility_admin: true,
        scavenger_visibility_user: true,
        scavenger: {
          select: {
            transcript: {
              select: {
                id: true,
                title: true,
              },
            },
            _count: {
              select: {
                questions: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        answers: {
          select: {
            answer: true,
            updatedAt: true,
            lines: {
              select: {
                line_id: true,
              },
            },
          },
        },
      },
      orderBy: {
        assigned_time: 'desc',
      },
    })

    const normalized = submissions.map((submission) => {
      const uniqueLineIds = new Set<string>()
      let latestAnswerAt: Date | null = null
      let answeredQuestionCount = 0

      for (const answer of submission.answers) {
        const hasAnswerText = Boolean(answer.answer?.trim())
        const hasLineSelection = answer.lines.length > 0

        if (hasAnswerText || hasLineSelection) {
          answeredQuestionCount += 1
        }

        for (const line of answer.lines) {
          uniqueLineIds.add(line.line_id)
        }

        if (!latestAnswerAt || answer.updatedAt > latestAnswerAt) {
          latestAnswerAt = answer.updatedAt
        }
      }

      const status: SubmissionStatus = submission.scavenger_completed
        ? 'completed'
        : answeredQuestionCount > 0
          ? 'in_progress'
          : 'not_started'

      const lastUpdatedCandidates = [latestAnswerAt, submission.completedAt].filter(
        (value): value is Date => value instanceof Date,
      )

      const lastUpdatedAt =
        lastUpdatedCandidates.length > 0
          ? lastUpdatedCandidates
              .reduce((latest, value) => (value > latest ? value : latest))
              .toISOString()
          : null

      return {
        id: submission.id,
        status,
        assignedAt: submission.assigned_time.toISOString(),
        completedAt: submission.completedAt?.toISOString() ?? null,
        lastUpdatedAt,
        scavenger_visibility_admin: submission.scavenger_visibility_admin,
        scavenger_visibility_user: submission.scavenger_visibility_user,
        questionCount: submission.scavenger._count.questions,
        answeredQuestionCount,
        linkedLineCount: uniqueLineIds.size,
        transcript: {
          id: submission.scavenger.transcript.id,
          title: submission.scavenger.transcript.title,
        },
        annotator: submission.user
          ? {
              id: submission.user.id,
              name: submission.user.name,
              username: submission.user.username,
            }
          : null,
      }
    })

    return NextResponse.json({
      success: true,
      submissions: normalized,
    })
  } catch (error) {
    console.error('Failed to fetch scavenger submissions', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to fetch scavenger submissions. Please try again later.',
      },
      { status: 500 },
    )
  }
}
