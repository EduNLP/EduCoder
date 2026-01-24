import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  bucketName,
  deleteTranscriptVideoFromBucket,
  uploadTranscriptVideoStreamToBucket,
} from '../../transcripts/storage'

export const runtime = 'nodejs'

export async function POST(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const transcriptId = searchParams.get('transcriptId')?.trim() ?? ''

    if (!transcriptId) {
      return NextResponse.json({ error: 'Transcript id is required.' }, { status: 400 })
    }

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: {
        id: true,
        title: true,
        video_id: true,
        video_uploaded: true,
        video: {
          select: {
            gcs_path: true,
          },
        },
      },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    if (!request.body || request.headers.get('content-length') === '0') {
      return NextResponse.json({ error: 'Video file is required.' }, { status: 400 })
    }

    const rawFileName = request.headers.get('x-file-name') ?? ''
    let fileName = rawFileName
    if (rawFileName) {
      try {
        fileName = decodeURIComponent(rawFileName)
      } catch {
        fileName = rawFileName
      }
    }

    const upload = await uploadTranscriptVideoStreamToBucket(
      request.body,
      fileName || 'video',
      request.headers.get('content-type') ?? undefined,
      transcript.title ?? 'transcript',
      {
        transcriptId: transcript.id,
      },
    )

    const existingVideoId = transcript.video_id ?? null
    if (existingVideoId && transcript.video?.gcs_path) {
      try {
        await deleteTranscriptVideoFromBucket(transcript.video.gcs_path)
      } catch (error) {
        console.error('Failed to delete previous transcript video', error)
      }
    }
    const saved = existingVideoId
      ? await prisma.videos.update({
          where: { id: existingVideoId },
          data: {
            file_name: upload.originalName,
            mime_type: upload.mimeType || null,
            gcs_path: upload.gcsPath,
            uploaded_at: new Date(),
          },
          select: {
            id: true,
            file_name: true,
            mime_type: true,
            gcs_path: true,
            uploaded_at: true,
          },
        })
      : await prisma.videos.create({
          data: {
            file_name: upload.originalName,
            mime_type: upload.mimeType || null,
            gcs_path: upload.gcsPath,
          },
          select: {
            id: true,
            file_name: true,
            mime_type: true,
            gcs_path: true,
            uploaded_at: true,
          },
        })

    if (!existingVideoId) {
      await prisma.transcripts.update({
        where: { id: transcript.id },
        data: {
          video_id: saved.id,
          video_uploaded: true,
        },
        select: { id: true },
      })
    } else if (!transcript.video_uploaded) {
      await prisma.transcripts.update({
        where: { id: transcript.id },
        data: {
          video_uploaded: true,
        },
        select: { id: true },
      })
    }

    return NextResponse.json({
      success: true,
      transcriptId: transcript.id,
      video: {
        id: saved.id,
        file_name: saved.file_name,
        mime_type: saved.mime_type,
        gcs_path: saved.gcs_path,
        uploaded_at: saved.uploaded_at.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to upload section video', error)
    return NextResponse.json(
      { error: 'Failed to upload video. Please try again.' },
      { status: 500 },
    )
  }
}
