import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import type { Prisma } from '@prisma/client'
import { deleteTranscriptVideoFromBucket } from '../transcripts/storage'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const transcripts = await prisma.transcripts.findMany({
      select: {
        id: true,
        title: true,
        grade: true,
        transcript_file_name: true,
        upload_time: true,
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
      orderBy: {
        upload_time: 'desc',
      },
    })

    const normalized = transcripts.map((transcript) => {
      const video = transcript.video

      return {
        id: transcript.id,
        title: transcript.title,
        grade: transcript.grade ?? null,
        transcript_file_name: transcript.transcript_file_name ?? null,
        video: video
          ? {
              id: video.id,
              file_name: video.file_name,
              mime_type: video.mime_type,
              gcs_path: video.gcs_path,
              uploaded_at: video.uploaded_at.toISOString(),
            }
          : null,
      }
    })

    return NextResponse.json({
      success: true,
      transcripts: normalized,
    })
  } catch (error) {
    console.error('Failed to fetch transcript videos', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load transcript videos. Please try again later.',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
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
        video_id: true,
        video: {
          select: {
            id: true,
            gcs_path: true,
          },
        },
      },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    if (!transcript.video_id || !transcript.video) {
      return NextResponse.json({
        success: true,
        transcriptId: transcript.id,
        video: null,
      })
    }

    await deleteTranscriptVideoFromBucket(transcript.video.gcs_path)

    await prisma.$transaction([
      prisma.transcripts.update({
        where: { id: transcript.id },
        data: {
          video_id: null,
          video_uploaded: false,
        },
        select: { id: true },
      }),
      prisma.videos.delete({
        where: { id: transcript.video.id },
        select: { id: true },
      }),
    ])

    return NextResponse.json({
      success: true,
      transcriptId: transcript.id,
      video: null,
    })
  } catch (error) {
    console.error('Failed to delete transcript video', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to delete transcript video. Please try again later.',
      },
      { status: 500 },
    )
  }
}
