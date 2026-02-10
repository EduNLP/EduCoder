import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'
import { bucketName, uploadToBucket } from '../../storage'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
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

    const formData = await request.formData()
    const params = await context.params
    const transcriptIdFromParams = params?.transcriptId
    const transcriptIdFromBody =
      (formData.get('transcriptId') as string | null)?.trim() ?? undefined
    const transcriptId = transcriptIdFromParams ?? transcriptIdFromBody

    if (!transcriptId) {
      return NextResponse.json({ error: 'Transcript id is required.' }, { status: 400 })
    }

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: { id: true },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    const associatedCandidate = formData.get('associatedFile')
    if (!(associatedCandidate instanceof File) || associatedCandidate.size === 0) {
      return NextResponse.json({ error: 'Associated file is required.' }, { status: 400 })
    }

    const upload = await uploadToBucket(associatedCandidate, 'referrence-annotations')

    const updated = await prisma.transcripts.update({
      where: { id: transcriptId },
      data: {
        annotation_file_name: upload.originalName,
        llm_annotation_gcs_path: upload.gcsPath,
      },
      select: {
        id: true,
        annotation_file_name: true,
        llm_annotation_gcs_path: true,
      },
    })

    return NextResponse.json({
      success: true,
      transcriptId: updated.id,
      annotation_file_name: updated.annotation_file_name,
      llm_annotation_gcs_path: updated.llm_annotation_gcs_path,
      upload,
    })
  } catch (error) {
    console.error('Associated transcript upload failed', error)
    return NextResponse.json(
      { error: 'Failed to upload associated file. Please try again.' },
      { status: 500 },
    )
  }
}
