import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  bucketName,
  createTranscriptVideoUploadUrl,
} from '../../transcripts/storage'

export const runtime = 'nodejs'

type UploadUrlRequest = {
  transcriptId?: string
  fileName?: string
  contentType?: string
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

    const body: UploadUrlRequest | null = await request.json().catch(() => null)
    const transcriptId = body?.transcriptId?.trim() ?? ''
    if (!transcriptId) {
      return NextResponse.json(
        { success: false, error: 'Transcript id is required.' },
        { status: 400 },
      )
    }

    const fileName = body?.fileName?.trim() || 'video'
    const contentType = body?.contentType?.trim() || 'application/octet-stream'

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: { id: true, title: true },
    })

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'Transcript not found.' },
        { status: 404 },
      )
    }

    const upload = await createTranscriptVideoUploadUrl({
      fileName,
      contentType,
      transcriptTitle: transcript.title ?? 'transcript',
      transcriptId: transcript.id,
      uploaderId: uploader.id,
    })

    return NextResponse.json({
      success: true,
      ...upload,
    })
  } catch (error) {
    console.error('Failed to create signed upload URL', error)
    return NextResponse.json(
      { success: false, error: 'Failed to prepare video upload. Please try again.' },
      { status: 500 },
    )
  }
}
