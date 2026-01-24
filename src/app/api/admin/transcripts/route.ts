import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const transcripts = await prisma.transcripts.findMany({
      select: {
        id: true,
        title: true,
        grade: true,
        transcript_file_name: true,
        annotation_file_name: true,
        llm_annotation: true,
        llm_annotation_gcs_path: true,
        annotations: {
          select: {
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
      orderBy: {
        upload_time: 'desc',
      },
    })

    const normalized = transcripts.map((transcript) => {
      const assignedUsers = transcript.annotations
        .map((annotation) => annotation.user)
        .filter(
          (user): user is NonNullable<(typeof transcript.annotations)[number]['user']> =>
            Boolean(user),
        )
      const uniqueUsers = new Map(
        assignedUsers.map((user) => [user.id, { id: user.id, name: user.name, username: user.username }]),
      )

      return {
        id: transcript.id,
        title: transcript.title,
        grade: transcript.grade ?? null,
        transcript_file_name: transcript.transcript_file_name,
        annotation_file_name: transcript.annotation_file_name,
        llm_annotation: transcript.llm_annotation,
        llm_annotation_gcs_path: transcript.llm_annotation_gcs_path,
        assigned_users: Array.from(uniqueUsers.values()),
      }
    })

    return NextResponse.json({
      success: true,
      transcripts: normalized,
    })
  } catch (error) {
    console.error('Failed to fetch transcripts', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to fetch transcripts. Please try again later.',
      },
      { status: 500 },
    )
  }
}
