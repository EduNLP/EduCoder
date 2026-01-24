import { NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'

import type { Prisma, Role, User } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const annotators = await prisma.user.findMany({
      where: {
        role: {
          in: ['annotator', 'admin'],
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        password: true,
        annotations: {
          where: {
            hide: { not: true },
          },
          select: {
            id: true,
            transcript: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    const normalizedAnnotators = annotators.map((annotator) => ({
      id: annotator.id,
      name: annotator.name,
      username: annotator.username,
      role: annotator.role,
      password: annotator.password,
      assignedTranscripts: annotator.annotations
        .map((annotation) => {
          if (!annotation.transcript) {
            return null
          }
          return {
            id: annotation.transcript.id,
            title: annotation.transcript.title,
          }
        })
        .filter(
          (assignment): assignment is { id: string; title: string } =>
            Boolean(assignment),
        ),
    }))

    return NextResponse.json({
      success: true,
      annotators: normalizedAnnotators,
    })
  } catch (error) {
    console.error('Failed to fetch annotators', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to fetch annotators. Please try again later.',
      },
      { status: 500 },
    )
  }
}

const extractClerkError = (error: unknown) => {
  if (typeof error === 'object' && error !== null) {
    const withErrors = error as {
      errors?: Array<{ message?: string }>
      message?: string
      status?: number
    }
    if (Array.isArray(withErrors.errors) && withErrors.errors.length > 0) {
      const combinedMessage = withErrors.errors
        .map((err) => err?.message)
        .filter((msg): msg is string => Boolean(msg))
        .join(' ')
      if (combinedMessage) {
        return {
          message: combinedMessage,
          status: withErrors.status ?? 400,
        }
      }
    }
    if (typeof withErrors.message === 'string' && withErrors.message) {
      return {
        message: withErrors.message,
        status: withErrors.status ?? 400,
      }
    }
  }
  return {
    message: 'Unable to create annotator. Please try again.',
    status: 500,
  }
}

const normalizeRole = (incomingRole: string): Role => {
  if (incomingRole === 'admin') {
    return 'admin'
  }
  if (incomingRole === 'annotator') {
    return 'annotator' as Role
  }
  return 'user'
}

const normalizeTranscriptIds = (candidate: unknown): string[] => {
  if (!Array.isArray(candidate)) {
    return []
  }

  const uniqueIds = new Set<string>()
  candidate.forEach((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized) {
        uniqueIds.add(normalized)
      }
    }
  })

  return Array.from(uniqueIds)
}

const assignTranscriptsToAnnotator = async ({
  transcriptIds,
  annotatorId,
}: {
  transcriptIds: string[]
  annotatorId: string
}) => {
  if (transcriptIds.length === 0) {
    return 0
  }

  const transcripts = await prisma.transcripts.findMany({
    where: { id: { in: transcriptIds } },
    select: { id: true },
  })

  const transcriptMap = new Map(
    transcripts.map((transcript) => [transcript.id, transcript]),
  )
  const missingIds = transcriptIds.filter((id) => !transcriptMap.has(id))
  if (missingIds.length > 0) {
    throw new Error('One or more selected transcripts could not be found.')
  }

  const annotationRows: Prisma.AnnotationsCreateManyInput[] = transcripts.map((transcript) => ({
    transcript_id: transcript.id,
    created_for: annotatorId,
    gcs_path: '',
  }))

  if (annotationRows.length > 0) {
    await prisma.annotations.createMany({ data: annotationRows })
  }

  return annotationRows.length
}

const syncAnnotatorTranscriptAssignments = async ({
  transcriptIds,
  annotatorId,
}: {
  transcriptIds: string[]
  annotatorId: string
}) => {
  if (transcriptIds.length > 0) {
    const transcripts = await prisma.transcripts.findMany({
      where: { id: { in: transcriptIds } },
      select: { id: true },
    })

    const transcriptSet = new Set(transcripts.map((transcript) => transcript.id))
    const missingIds = transcriptIds.filter((id) => !transcriptSet.has(id))
    if (missingIds.length > 0) {
      throw new Error('One or more selected transcripts could not be found.')
    }
  }

  const existingAssignments = await prisma.annotations.findMany({
    where: { created_for: annotatorId },
    select: { transcript_id: true },
  })

  const existingTranscriptIds = new Set(
    existingAssignments.map((assignment) => assignment.transcript_id),
  )
  const selectedTranscriptIds = new Set(transcriptIds)

  const toCreate = transcriptIds.filter((id) => !existingTranscriptIds.has(id))
  const toUnhide = transcriptIds.filter((id) => existingTranscriptIds.has(id))
  const toHide = Array.from(
    new Set(
      existingAssignments
        .map((assignment) => assignment.transcript_id)
        .filter((id) => !selectedTranscriptIds.has(id)),
    ),
  )

  const operations: Prisma.PrismaPromise<unknown>[] = []

  if (toUnhide.length > 0) {
    operations.push(
      prisma.annotations.updateMany({
        where: {
          created_for: annotatorId,
          transcript_id: { in: toUnhide },
        },
        data: { hide: false },
      }),
    )
  }

  if (toHide.length > 0) {
    operations.push(
      prisma.annotations.updateMany({
        where: {
          created_for: annotatorId,
          transcript_id: { in: toHide },
        },
        data: { hide: true },
      }),
    )
  }

  if (toCreate.length > 0) {
    operations.push(
      prisma.annotations.createMany({
        data: toCreate.map((transcriptId) => ({
          transcript_id: transcriptId,
          created_for: annotatorId,
          gcs_path: '',
        })),
      }),
    )
  }

  if (operations.length > 0) {
    await prisma.$transaction(operations)
  }

  return {
    createdCount: toCreate.length,
    unhiddenCount: toUnhide.length,
    hiddenCount: toHide.length,
  }
}

export async function POST(request: Request) {
  try {
    if (!process.env.CLERK_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Clerk secret key is not configured on the server.' },
        { status: 500 },
      )
    }

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const role = typeof body?.role === 'string' ? body.role.trim() : ''
    const normalizedRole = normalizeRole(role)
    const transcriptIds = normalizeTranscriptIds(
      body?.transcriptIds ?? body?.transcripts ?? [],
    )

    if (!name || !username || !password || !role) {
      return NextResponse.json(
        { error: 'Name, username, role, and password are required.' },
        { status: 400 },
      )
    }

    const [firstName, ...rest] = name.split(' ').filter(Boolean)
    const lastName = rest.join(' ') || undefined
    const emailAddressCandidate = username.includes('@') ? username : undefined
    const client = await clerkClient()

    const createdUser = await client.users.createUser({
      username,
      password,
      firstName: firstName || undefined,
      lastName,
      publicMetadata: { role: normalizedRole },
      ...(emailAddressCandidate ? { emailAddress: [emailAddressCandidate] } : {}),
    })

    let databaseUser: User | null = null
    try {
      const userData = {
        name,
        username,
        password,
        role: normalizedRole,
        auth_user_id: createdUser.id,
      }

      databaseUser = await prisma.user.create({
        data: userData as Prisma.UserCreateInput,
      })
    } catch (databaseError) {
      console.error('Failed to create annotator in Prisma', databaseError)
      await client.users
        .deleteUser(createdUser.id)
        .catch((cleanupError) =>
          console.error('Failed to remove Clerk user after Prisma failure', cleanupError),
        )
      return NextResponse.json(
        {
          error:
            'User was created in auth but failed to sync with the database. Cleanup attempted; please try again.',
        },
        { status: 500 },
      )
    }

    if (!databaseUser) {
      return NextResponse.json(
        { error: 'Failed to persist annotator in the database.' },
        { status: 500 },
      )
    }

    try {
      await assignTranscriptsToAnnotator({
        transcriptIds,
        annotatorId: databaseUser.id,
      })
    } catch (assignmentError) {
      console.error(
        'Failed to prepare transcript annotations for the new annotator',
        assignmentError,
      )
      await prisma.user
        .delete({ where: { id: databaseUser.id } })
        .catch((cleanupError) =>
          console.error(
            'Failed to remove Prisma user after assignment failure',
            cleanupError,
          ),
        )
      await client.users
        .deleteUser(createdUser.id)
        .catch((cleanupError) =>
          console.error(
            'Failed to remove Clerk user after assignment failure',
            cleanupError,
          ),
        )

      const message =
        assignmentError instanceof Error
          ? assignmentError.message
          : 'Failed to assign transcripts to the annotator.'

      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: createdUser.id,
          dbId: databaseUser.id,
          authUserId: createdUser.id,
          name,
          username: createdUser.username ?? username,
          role: databaseUser.role ?? createdUser.publicMetadata?.role ?? normalizedRole,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    const { message, status } = extractClerkError(error)
    console.error('Failed to create annotator in Clerk', error)
    return NextResponse.json({ error: message }, { status })
  }
}


export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const annotatorId =
      typeof body?.annotatorId === 'string' ? body.annotatorId.trim() : ''
    const transcriptIds = normalizeTranscriptIds(
      body?.transcriptIds ?? body?.transcripts ?? [],
    )

    if (!annotatorId) {
      return NextResponse.json(
        { success: false, error: 'Annotator ID is required.' },
        { status: 400 },
      )
    }

    const annotator = await prisma.user.findUnique({
      where: { id: annotatorId },
      select: { id: true },
    })

    if (!annotator) {
      return NextResponse.json(
        { success: false, error: 'Annotator not found.' },
        { status: 404 },
      )
    }

    const { createdCount, hiddenCount, unhiddenCount } =
      await syncAnnotatorTranscriptAssignments({
        transcriptIds,
        annotatorId,
      })

    return NextResponse.json({
      success: true,
      createdCount,
      hiddenCount,
      unhiddenCount,
      assignedTranscriptIds: transcriptIds,
    })
  } catch (error) {
    console.error('Failed to assign transcripts to annotator', error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to assign transcripts. Please try again.',
      },
      { status: 500 },
    )
  }
}


export async function DELETE(request: Request) {
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
        { success: false, error: 'Only admins can delete annotators.' },
        { status: 403 },
      )
    }

    const searchParams = new URL(request.url).searchParams
    const body = await request.json().catch(() => null)
    const annotatorIdFromQuery = searchParams.get('annotatorId') ?? ''
    const annotatorIdFromBody =
      typeof body?.annotatorId === 'string' ? body.annotatorId.trim() : ''
    const annotatorId = annotatorIdFromQuery || annotatorIdFromBody

    if (!annotatorId) {
      return NextResponse.json(
        { success: false, error: 'Annotator ID is required.' },
        { status: 400 },
      )
    }

    const annotator = await prisma.user.findUnique({
      where: { id: annotatorId },
      select: { id: true, name: true, username: true, auth_user_id: true },
    })

    if (!annotator) {
      return NextResponse.json(
        { success: false, error: 'Annotator not found.' },
        { status: 404 },
      )
    }

    const annotationCount = await prisma.annotations.count({
      where: { created_for: annotatorId },
    })

    if (annotationCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This annotator still has assigned annotations. Please delete those annotations first.',
          code: 'ANNOTATIONS_EXIST',
          annotationCount,
        },
        { status: 409 },
      )
    }

    await prisma.user.delete({ where: { id: annotatorId } })

    let clerkAccountDeleted: boolean | undefined

    if (annotator.auth_user_id) {
      if (!process.env.CLERK_SECRET_KEY) {
        console.warn(
          'Annotator removed from database, but CLERK_SECRET_KEY is missing so the auth user was not deleted.',
        )
      } else {
        try {
          const client = await clerkClient()
          await client.users.deleteUser(annotator.auth_user_id)
          clerkAccountDeleted = true
        } catch (error) {
          console.error('Failed to delete Clerk user for annotator', error)
          clerkAccountDeleted = false
        }
      }
    }

    return NextResponse.json({
      success: true,
      annotatorId: annotator.id,
      username: annotator.username,
      clerkAccountDeleted,
    })
  } catch (error) {
    console.error('Failed to delete annotator', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to delete annotator right now.',
      },
      { status: 500 },
    )
  }
}
