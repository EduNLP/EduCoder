import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type SaveScavengerBody = {
  questions?: unknown
}

const resolveTranscriptId = async (request: Request, context: RouteContext) => {
  const params = await context.params
  const transcriptIdFromParams = params?.transcriptId?.trim() ?? ''
  if (transcriptIdFromParams) {
    return transcriptIdFromParams
  }

  const searchParams = new URL(request.url).searchParams
  return searchParams.get('transcriptId')?.trim() ?? ''
}

const findActor = async (authUserId: string) =>
  prisma.user.findFirst({
    where: { auth_user_id: authUserId },
    select: { id: true, workspace_id: true },
  })

const findWorkspaceTranscript = async (transcriptId: string, workspaceId: string) =>
  prisma.transcripts.findFirst({
    where: { id: transcriptId, workspace_id: workspaceId },
    select: { id: true },
  })

const hasLlmNotes = async (transcriptId: string) =>
  prisma.notes.findFirst({
    where: { transcript_id: transcriptId, source: 'llm' },
    select: { note_id: true },
  })

export async function GET(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const actor = await findActor(authUserId)
    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const transcript = await findWorkspaceTranscript(transcriptId, actor.workspace_id)
    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const scavengerHunt = await prisma.scavengerHunt.findUnique({
      where: { transcript_id: transcriptId },
      select: {
        id: true,
        createdAt: true,
        questions: {
          select: {
            id: true,
            question: true,
            order_index: true,
          },
          orderBy: {
            order_index: 'asc',
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      scavengerHunt: scavengerHunt
        ? {
            id: scavengerHunt.id,
            created_at: scavengerHunt.createdAt,
            questions: scavengerHunt.questions.map((question) => ({
              id: question.id,
              question: question.question,
              orderIndex: question.order_index,
            })),
          }
        : null,
    })
  } catch (error) {
    console.error('Failed to fetch scavenger hunt', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to fetch scavenger hunt right now.',
      },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const actor = await findActor(authUserId)
    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const transcript = await findWorkspaceTranscript(transcriptId, actor.workspace_id)
    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const payload = (await request.json().catch(() => null)) as SaveScavengerBody | null
    if (!payload || !Array.isArray(payload.questions)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Questions must be provided as a list.',
        },
        { status: 400 },
      )
    }

    const normalizedQuestions = payload.questions
      .map((question) => (typeof question === 'string' ? question.trim() : ''))
      .filter((question) => Boolean(question))

    if (normalizedQuestions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Add at least one question to save the scavenger hunt.',
        },
        { status: 400 },
      )
    }

    const llmNote = await hasLlmNotes(transcriptId)
    if (!llmNote) {
      return NextResponse.json(
        {
          success: false,
          error: 'Generate LLM annotations to get started.',
        },
        { status: 409 },
      )
    }

    const scavengerHunt = await prisma.$transaction(async (tx) => {
      const existing = await tx.scavengerHunt.findUnique({
        where: { transcript_id: transcriptId },
        select: { id: true },
      })

      const scavengerId =
        existing?.id ??
        (
          await tx.scavengerHunt.create({
            data: { transcript_id: transcriptId },
            select: { id: true },
          })
        ).id

      await tx.scavengerHuntQuestion.deleteMany({
        where: { scavenger_id: scavengerId },
      })

      await tx.scavengerHuntQuestion.createMany({
        data: normalizedQuestions.map((question, index) => ({
          scavenger_id: scavengerId,
          question,
          order_index: index + 1,
        })),
      })

      const assignedAnnotators = await tx.annotations.findMany({
        where: {
          transcript_id: transcriptId,
          hide: { not: true },
        },
        select: { created_for: true },
      })

      const uniqueAnnotatorIds = Array.from(
        new Set(assignedAnnotators.map((assignment) => assignment.created_for)),
      )

      if (uniqueAnnotatorIds.length > 0) {
        await tx.scavengerHuntAssignment.createMany({
          data: uniqueAnnotatorIds.map((annotatorId) => ({
            scavenger_id: scavengerId,
            created_for: annotatorId,
          })),
          skipDuplicates: true,
        })
      }

      return tx.scavengerHunt.findUnique({
        where: { id: scavengerId },
        select: {
          id: true,
          createdAt: true,
          _count: {
            select: {
              questions: true,
            },
          },
        },
      })
    })

    if (!scavengerHunt) {
      return NextResponse.json(
        { success: false, error: 'Unable to save scavenger hunt.' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      scavengerHunt: {
        id: scavengerHunt.id,
        created_at: scavengerHunt.createdAt,
        question_count: scavengerHunt._count.questions,
      },
    })
  } catch (error) {
    console.error('Failed to save scavenger hunt', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to save scavenger hunt right now.',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const transcriptId = await resolveTranscriptId(request, context)
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const actor = await findActor(authUserId)
    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const transcript = await findWorkspaceTranscript(transcriptId, actor.workspace_id)
    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const scavengerHunt = await prisma.scavengerHunt.findUnique({
      where: { transcript_id: transcriptId },
      select: { id: true },
    })

    if (!scavengerHunt) {
      return NextResponse.json(
        { success: false, error: 'Scavenger hunt not found.' },
        { status: 404 },
      )
    }

    await prisma.scavengerHunt.delete({ where: { id: scavengerHunt.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete scavenger hunt', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to delete scavenger hunt right now.',
      },
      { status: 500 },
    )
  }
}
