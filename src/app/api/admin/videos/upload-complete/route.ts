import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  bucketName,
  deleteTranscriptVideoFromBucket,
  getStorageClient,
} from '../../transcripts/storage'

export const runtime = 'nodejs'

type UploadCompleteRequest = {
  transcriptId?: string
  objectPath?: string
}

const normalizeMetadataValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

const decodeMetadata = (value: string) => {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const coerceMetadataRecord = (
  input: unknown,
): Record<string, string | null | undefined> => {
  if (!input || typeof input !== 'object') return {}
  const record = input as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value === null || value === undefined ? null : String(value),
    ]),
  )
}

export async function POST(request: Request) {
  try {
    if (!bucketName) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing GOOGLE_CLOUD_STORAGE_BUCKET (or alias) environment variable on the server.',
        },
        { status: 500 },
      )
    }

    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const uploaderWhere = { auth_user_id: authUserId } as Prisma.UserWhereInput
    const uploader = await prisma.user.findFirst({
      where: uploaderWhere,
      select: { id: true },
    })

    if (!uploader) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const body: UploadCompleteRequest | null = await request.json().catch(() => null)
    const transcriptId = body?.transcriptId?.trim() ?? ''
    const objectPath = body?.objectPath?.trim() ?? ''

    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    if (!objectPath || !objectPath.startsWith('videos/') || objectPath.includes('..')) {
      return NextResponse.json(
        { success: false, error: 'Invalid upload path.' },
        { status: 400 },
      )
    }

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: {
        id: true,
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
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const storage = getStorageClient()
    const file = storage.bucket(bucketName).file(objectPath)

    let metadata: {
      contentType?: string | null
      metadata?: Record<string, string | null | undefined>
    } | null = null
    try {
      const [fetchedMetadata] = await file.getMetadata()
      metadata = {
        contentType: fetchedMetadata.contentType ?? null,
        metadata: coerceMetadataRecord(fetchedMetadata.metadata),
      }
    } catch (error) {
      console.error('Unable to read uploaded video metadata', error)
      return NextResponse.json(
        { success: false, error: 'Uploaded video was not found in storage.' },
        { status: 404 },
      )
    }

    const meta = metadata?.metadata ?? {}
    const metaTranscriptId = normalizeMetadataValue(
      meta['transcript-id'] ?? meta.transcriptId,
    )
    const metaUploaderId = normalizeMetadataValue(
      meta['uploader-id'] ?? meta.uploaderId,
    )
    const metaOriginalFileName = normalizeMetadataValue(
      meta['original-file-name'] ?? meta.originalFileName,
    )

    if (!metaTranscriptId || !metaUploaderId) {
      return NextResponse.json(
        { success: false, error: 'Upload metadata is missing.' },
        { status: 400 },
      )
    }

    if (metaTranscriptId && metaTranscriptId !== transcript.id) {
      return NextResponse.json(
        { success: false, error: 'Uploaded video does not match the transcript.' },
        { status: 400 },
      )
    }

    if (metaUploaderId && metaUploaderId !== uploader.id) {
      return NextResponse.json(
        { success: false, error: 'Uploaded video does not match the uploader.' },
        { status: 400 },
      )
    }

    const resolvedFileName = decodeMetadata(metaOriginalFileName).trim() || 'video'
    const mimeType = metadata?.contentType ?? null
    const gcsPath = `gs://${bucketName}/${objectPath}`

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
            file_name: resolvedFileName,
            mime_type: mimeType,
            gcs_path: gcsPath,
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
            file_name: resolvedFileName,
            mime_type: mimeType,
            gcs_path: gcsPath,
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
    console.error('Failed to finalize video upload', error)
    return NextResponse.json(
      { success: false, error: 'Failed to finalize video upload. Please try again.' },
      { status: 500 },
    )
  }
}
