import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { bucketName, getStorageClient } from '../storage'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type ParsedGcsPath = { bucket: string; object: string }

type DeleteBlockReason =
  | 'HAS_INSTRUCTIONAL_MATERIALS'
  | 'HAS_ASSIGNMENTS'

const parseGcsPath = (uri: string): ParsedGcsPath => {
  if (!uri) {
    throw new Error('Storage path is required.')
  }

  const trimmed = uri.trim()
  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice('gs://'.length)
    const slashIndex = withoutScheme.indexOf('/')
    if (slashIndex === -1) {
      throw new Error('Invalid Google Cloud Storage URI.')
    }

    const bucket = withoutScheme.slice(0, slashIndex)
    const object = withoutScheme.slice(slashIndex + 1)
    if (!bucket || !object) {
      throw new Error('Invalid Google Cloud Storage URI.')
    }

    return { bucket, object }
  }

  if (trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      if (
        url.hostname === 'storage.googleapis.com' ||
        url.hostname === 'storage.cloud.google.com'
      ) {
        const segments = url.pathname.replace(/^\/+/, '').split('/')
        const [bucket, ...rest] = segments
        if (!bucket || rest.length === 0) {
          throw new Error('Invalid Google Cloud Storage URL.')
        }

        const object = rest.join('/')
        return { bucket, object }
      }
    } catch {
      // fall through to error below
    }
  }

  throw new Error('Unsupported Google Cloud Storage path format.')
}

const buildBlockedResponse = ({
  transcriptId,
  error,
  reason,
  materials,
  assignments,
}: {
  transcriptId: string
  error: string
  reason: DeleteBlockReason
  materials?: Array<{ id: string; title: string }>
  assignments?: Array<{ id: string; name: string | null; username: string }>
}) =>
  NextResponse.json(
    {
      success: false,
      transcriptId,
      error,
      code: reason,
      materials,
      assignments,
    },
    { status: 409 },
  )

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!bucketName) {
      return NextResponse.json(
        {
          error:
            'Missing GOOGLE_CLOUD_STORAGE_BUCKET (or alias) environment variable on the server.',
        },
        { status: 500 },
      )
    }

    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const uploaderWhere = { auth_user_id: authUserId } as Prisma.UserWhereInput
    const uploader = await prisma.user.findFirst({
      where: uploaderWhere,
      select: { id: true },
    })

    if (!uploader) {
      return NextResponse.json(
        { error: 'Authenticated user is not registered in the application database.' },
        { status: 403 },
      )
    }

    const params = await context.params
    const searchParams = new URL(request.url).searchParams
    const transcriptIdFromParams = params?.transcriptId
    const transcriptIdFromQuery = searchParams.get('transcriptId') ?? undefined
    const transcriptId = transcriptIdFromParams ?? transcriptIdFromQuery

    if (!transcriptId) {
      return NextResponse.json({ error: 'Transcript id is required.' }, { status: 400 })
    }

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: {
        id: true,
        title: true,
        gcs_path: true,
        llm_annotation_gcs_path: true,
        materials: {
          select: {
            id: true,
            image_title: true,
          },
        },
        annotations: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        },
      },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    if (transcript.materials.length > 0) {
      const materials = transcript.materials.map((item) => ({
        id: item.id,
        title: item.image_title,
      }))
      return buildBlockedResponse({
        transcriptId: transcript.id,
        error: 'This transcript has instructional materials. Please delete them first.',
        reason: 'HAS_INSTRUCTIONAL_MATERIALS',
        materials,
      })
    }

    const assignments = transcript.annotations
      .map((annotation) => annotation.user)
      .filter((user): user is NonNullable<(typeof transcript.annotations)[number]['user']> => Boolean(user))
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
      }))

    if (assignments.length > 0) {
      return buildBlockedResponse({
        transcriptId: transcript.id,
        error:
          'This transcript is assigned to annotators. Remove the assignments before deleting.',
        reason: 'HAS_ASSIGNMENTS',
        assignments,
      })
    }

    const storage = getStorageClient()
    const storageErrors: Array<{ path: string; message: string }> = []
    const storagePaths = [transcript.gcs_path, transcript.llm_annotation_gcs_path].filter(
      (value): value is string => Boolean(value),
    )

    await Promise.all(
      storagePaths.map(async (gcsPath) => {
        try {
          const { bucket, object } = parseGcsPath(gcsPath)
          await storage.bucket(bucket).file(object).delete({ ignoreNotFound: true })
        } catch (error) {
          console.error('Failed to delete transcript object from storage', { gcsPath, error })
          storageErrors.push({
            path: gcsPath,
            message:
              error instanceof Error ? error.message : 'Unknown error while deleting object.',
          })
        }
      }),
    )

    await prisma.transcripts.delete({
      where: { id: transcript.id },
    })

    return NextResponse.json({
      success: true,
      transcriptId: transcript.id,
      title: transcript.title,
      storageErrors: storageErrors.length > 0 ? storageErrors : undefined,
    })
  } catch (error) {
    console.error('Transcript deletion failed', error)
    return NextResponse.json(
      { error: 'Unable to delete transcript right now.' },
      { status: 500 },
    )
  }
}
