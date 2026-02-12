import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type SaveScavengerAnswerPayload = {
  questionId?: string
  answer?: string
  lineIds?: string[]
}

type UpdateScavengerCompletionPayload = {
  completed?: boolean
}

const resolveTranscriptId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const transcriptIdFromParams = params?.transcriptId?.trim() ?? ''
  if (transcriptIdFromParams) {
    return transcriptIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  return (
    searchParams.get('transcriptId')?.trim() ??
    searchParams.get('transcript')?.trim() ??
    ''
  )
}

const findAnnotator = async (authUserId: string) =>
  prisma.user.findFirst({
    where: { auth_user_id: authUserId },
    select: { id: true },
  })

const findAssignedAnnotation = async (transcriptId: string, annotatorId: string) =>
  prisma.annotations.findFirst({
    where: {
      transcript_id: transcriptId,
      created_for: annotatorId,
      hide: { not: true },
    },
    select: { id: true },
  })

export async function GET(request: Request, context: RouteContext) {
  try {
    const transcriptId = await resolveTranscriptId(request, context)
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

    const annotator = await findAnnotator(authUserId)
    if (!annotator) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const assignment = await findAssignedAnnotation(transcriptId, annotator.id)
    if (!assignment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    const scavengerHunt = await prisma.scavengerHunt.findUnique({
      where: { transcript_id: transcriptId },
      select: {
        id: true,
        createdAt: true,
        questions: {
          orderBy: { order_index: 'asc' },
          select: {
            id: true,
            question: true,
            order_index: true,
          },
        },
      },
    })

    if (!scavengerHunt) {
      return NextResponse.json({
        success: true,
        scavengerCompleted: false,
        scavengerHunt: null,
      })
    }

    const scavengerAssignment = await prisma.scavengerHuntAssignment.findFirst({
      where: {
        scavenger_id: scavengerHunt.id,
        created_for: annotator.id,
      },
      select: {
        scavenger_completed: true,
        answers: {
          select: {
            question_id: true,
            answer: true,
            lines: {
              select: {
                line_id: true,
              },
            },
          },
        },
      },
    })

    const answersByQuestionId = (scavengerAssignment?.answers ?? []).reduce(
      (acc, answer) => {
        acc[answer.question_id] = {
          answer: answer.answer ?? '',
          selectedLineIds: answer.lines.map((line) => line.line_id),
        }
        return acc
      },
      {} as Record<
        string,
        {
          answer: string
          selectedLineIds: string[]
        }
      >,
    )

    return NextResponse.json({
      success: true,
      scavengerCompleted: Boolean(scavengerAssignment?.scavenger_completed),
      scavengerHunt: {
        id: scavengerHunt.id,
        created_at: scavengerHunt.createdAt,
        questions: scavengerHunt.questions.map((question) => ({
          id: question.id,
          question: question.question,
          orderIndex: question.order_index,
          answer: answersByQuestionId[question.id]?.answer ?? '',
          selectedLineIds: answersByQuestionId[question.id]?.selectedLineIds ?? [],
        })),
      },
    })
  } catch (error) {
    console.error('Failed to load scavenger responses', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load scavenger responses right now.',
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | UpdateScavengerCompletionPayload
      | null
    const completed =
      typeof body?.completed === 'boolean' ? body.completed : true

    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const annotator = await findAnnotator(authUserId)
    if (!annotator) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const assignment = await findAssignedAnnotation(transcriptId, annotator.id)
    if (!assignment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    const scavengerHunt = await prisma.scavengerHunt.findUnique({
      where: { transcript_id: transcriptId },
      select: { id: true },
    })

    if (!scavengerHunt) {
      return NextResponse.json(
        { success: false, error: 'Scavenger hunt not found for this transcript.' },
        { status: 404 },
      )
    }

    const completedAt = completed ? new Date() : null
    await prisma.scavengerHuntAssignment.upsert({
      where: {
        scavenger_id_created_for: {
          scavenger_id: scavengerHunt.id,
          created_for: annotator.id,
        },
      },
      update: {
        scavenger_completed: completed,
        completedAt,
      },
      create: {
        scavenger_id: scavengerHunt.id,
        created_for: annotator.id,
        scavenger_completed: completed,
        completedAt,
      },
    })

    return NextResponse.json({
      success: true,
      completed,
    })
  } catch (error) {
    console.error('Failed to update scavenger completion status', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to update scavenger completion status right now.',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | SaveScavengerAnswerPayload
      | null
    const questionId = typeof body?.questionId === 'string' ? body.questionId.trim() : ''
    const answer = typeof body?.answer === 'string' ? body.answer.trim() : ''
    const lineIds = Array.isArray(body?.lineIds)
      ? body.lineIds.filter((lineId): lineId is string => typeof lineId === 'string')
      : []

    if (!questionId) {
      return NextResponse.json(
        { success: false, error: 'Question id is required.' },
        { status: 400 },
      )
    }

    const uniqueLineIds = Array.from(
      new Set(lineIds.map((lineId) => lineId.trim()).filter(Boolean)),
    )

    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const annotator = await findAnnotator(authUserId)
    if (!annotator) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const assignment = await findAssignedAnnotation(transcriptId, annotator.id)
    if (!assignment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    const question = await prisma.scavengerHuntQuestion.findFirst({
      where: {
        id: questionId,
        scavenger: {
          transcript_id: transcriptId,
        },
      },
      select: {
        id: true,
        scavenger_id: true,
      },
    })

    if (!question) {
      return NextResponse.json(
        { success: false, error: 'Scavenger hunt question not found.' },
        { status: 404 },
      )
    }

    if (uniqueLineIds.length > 0) {
      const validLines = await prisma.transcriptLines.findMany({
        where: {
          transcript_id: transcriptId,
          line_id: { in: uniqueLineIds },
        },
        select: {
          line_id: true,
        },
      })

      if (validLines.length !== uniqueLineIds.length) {
        return NextResponse.json(
          { success: false, error: 'One or more selected lines are invalid.' },
          { status: 400 },
        )
      }
    }

    const savedAnswer = await prisma.$transaction(async (tx) => {
      const scavengerAssignment =
        (await tx.scavengerHuntAssignment.findFirst({
          where: {
            scavenger_id: question.scavenger_id,
            created_for: annotator.id,
          },
          select: {
            id: true,
          },
        })) ??
        (await tx.scavengerHuntAssignment.create({
          data: {
            scavenger_id: question.scavenger_id,
            created_for: annotator.id,
          },
          select: {
            id: true,
          },
        }))

      const existingAnswer = await tx.scavengerHuntAnswer.findFirst({
        where: {
          assignment_id: scavengerAssignment.id,
          question_id: question.id,
        },
        select: {
          id: true,
        },
      })

      if (!answer && uniqueLineIds.length === 0) {
        if (existingAnswer) {
          await tx.scavengerHuntAnswer.delete({
            where: { id: existingAnswer.id },
          })
        }
        return {
          questionId: question.id,
          answer: '',
          selectedLineIds: [],
          updatedAt: null,
        }
      }

      const answerRecord = existingAnswer
        ? await tx.scavengerHuntAnswer.update({
            where: { id: existingAnswer.id },
            data: { answer: answer || null },
            select: {
              id: true,
              answer: true,
              updatedAt: true,
            },
          })
        : await tx.scavengerHuntAnswer.create({
            data: {
              assignment_id: scavengerAssignment.id,
              question_id: question.id,
              answer: answer || null,
            },
            select: {
              id: true,
              answer: true,
              updatedAt: true,
            },
          })

      await tx.scavengerHuntAnswerLines.deleteMany({
        where: { answer_id: answerRecord.id },
      })

      if (uniqueLineIds.length > 0) {
        await tx.scavengerHuntAnswerLines.createMany({
          data: uniqueLineIds.map((lineId) => ({
            answer_id: answerRecord.id,
            line_id: lineId,
          })),
        })
      }

      return {
        questionId: question.id,
        answer: answerRecord.answer ?? '',
        selectedLineIds: uniqueLineIds,
        updatedAt: answerRecord.updatedAt?.toISOString?.() ?? null,
      }
    })

    return NextResponse.json({
      success: true,
      answer: savedAnswer,
    })
  } catch (error) {
    console.error('Failed to save scavenger response', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to save scavenger response right now.',
      },
      { status: 500 },
    )
  }
}
