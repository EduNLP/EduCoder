import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type SubmissionStatus = 'not_started' | 'in_progress' | 'completed'
type SubmissionRecord = {
  id: string
  scavenger_completed: boolean
  assigned_time: Date
  completedAt: Date | null
  scavenger_visibility_admin: 'hidden' | 'visible_after_completion' | 'always_visible'
  scavenger_visibility_user: boolean
  scavenger: {
    transcript: {
      id: string
      title: string
    }
    _count: {
      questions: number
    }
  }
  user: {
    id: string
    name: string
    username: string
  } | null
  answers: Array<{
    answer: string | null
    updatedAt: Date
    lines: Array<{
      line_id: string
    }>
    notes?: Array<{
      note_id: string
    }>
  }>
}

const canFallbackWithoutNotes = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientValidationError) {
    return true
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021' || error.code === 'P2022'
  }

  return false
}

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

    let noteSelectionSupported = true
    let submissions: SubmissionRecord[] = []

    try {
      submissions = await prisma.scavengerHuntAssignment.findMany({
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
              notes: {
                select: {
                  note_id: true,
                },
              },
            },
          },
        },
        orderBy: {
          assigned_time: 'desc',
        },
      })
    } catch (error) {
      if (!canFallbackWithoutNotes(error)) {
        throw error
      }

      noteSelectionSupported = false
      submissions = await prisma.scavengerHuntAssignment.findMany({
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
    }

    const normalized = submissions.map((submission) => {
      const uniqueLineIds = new Set<string>()
      let latestAnswerAt: Date | null = null
      let answeredQuestionCount = 0

      for (const answer of submission.answers) {
        const hasAnswerText = Boolean(answer.answer?.trim())
        const hasLineSelection = answer.lines.length > 0
        const hasNoteSelection = noteSelectionSupported && (answer.notes?.length ?? 0) > 0

        if (hasAnswerText || hasLineSelection || hasNoteSelection) {
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
