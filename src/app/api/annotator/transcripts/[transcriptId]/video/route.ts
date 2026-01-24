import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'
import { getStorageClient } from '@/app/api/admin/transcripts/storage'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type VideoPayload = {
  id: string
  fileName: string
  mimeType: string | null
  gcsPath: string
  uploadedAt: string
  url: string
}

const parseGcsPath = (uri: string): { bucket: string; object: string } => {
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

const buildPublicUrl = ({ bucket, object }: { bucket: string; object: string }) =>
  `https://storage.googleapis.com/${bucket}/${object}`

const resolveVideoUrl = async (gcsPath: string) => {
  const { bucket, object } = parseGcsPath(gcsPath)
  const storage = getStorageClient()
  const file = storage.bucket(bucket).file(object)

  try {
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000,
    })
    return signedUrl ?? buildPublicUrl({ bucket, object })
  } catch (error) {
    console.error('Failed to generate signed video URL', error)
    return buildPublicUrl({ bucket, object })
  }
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

    const transcript = await prisma.transcripts.findFirst({
      where: {
        id: transcriptId,
        annotations: {
          some: {
            created_for: annotator.id,
            hide: { not: true },
          },
        },
      },
      select: {
        id: true,
        video_uploaded: true,
        video: {
          select: {
            id: true,
            file_name: true,
            mime_type: true,
            gcs_path: true,
            uploaded_at: true,
          },
        },
      },
    })

    if (!transcript) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    if (!transcript.video_uploaded || !transcript.video) {
      return NextResponse.json({ success: true, video: null })
    }

    const videoUrl = await resolveVideoUrl(transcript.video.gcs_path)
    const payload: VideoPayload = {
      id: transcript.video.id,
      fileName: transcript.video.file_name,
      mimeType: transcript.video.mime_type ?? null,
      gcsPath: transcript.video.gcs_path,
      uploadedAt: transcript.video.uploaded_at.toISOString(),
      url: videoUrl,
    }

    return NextResponse.json({ success: true, video: payload })
  } catch (error) {
    console.error('Failed to fetch transcript video for annotator', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load transcript video. Please try again later.',
      },
      { status: 500 },
    )
  }
}
