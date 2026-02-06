import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const { userId: authUserId } = await auth()
    if (!authUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true, workspace_id: true },
    })

    if (!actor) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authenticated user is not registered in the application database.',
        },
        { status: 403 },
      )
    }

    const transcripts = await prisma.transcripts.findMany({
      where: {
        workspace_id: actor.workspace_id,
      },
      select: {
        id: true,
        title: true,
        grade: true,
        transcript_file_name: true,
        annotation_file_name: true,
        llm_annotation: true,
        llm_annotation_visibility_default: true,
        llm_annotation_visibility_per_annotator: true,
        llm_annotation_gcs_path: true,
        notes: {
          where: {
            source: 'llm',
          },
          select: {
            note_id: true,
          },
          take: 1,
        },
        annotations: {
          select: {
            llm_annotation_visibility_admin: true,
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
        .map((annotation) => {
          if (!annotation.user) {
            return null
          }
          return {
            id: annotation.user.id,
            name: annotation.user.name,
            username: annotation.user.username,
            llm_annotation_visibility_admin: annotation.llm_annotation_visibility_admin,
          }
        })
        .filter(
          (
            user,
          ): user is {
            id: string
            name: string | null
            username: string | null
            llm_annotation_visibility_admin: typeof transcript.llm_annotation_visibility_default
          } => Boolean(user),
        )
      const uniqueUsers = new Map(assignedUsers.map((user) => [user.id, user]))

      return {
        id: transcript.id,
        title: transcript.title,
        grade: transcript.grade ?? null,
        transcript_file_name: transcript.transcript_file_name,
        annotation_file_name: transcript.annotation_file_name,
        llm_annotation: transcript.llm_annotation,
        llm_annotation_visibility_default: transcript.llm_annotation_visibility_default,
        llm_annotation_visibility_per_annotator:
          transcript.llm_annotation_visibility_per_annotator,
        llm_annotation_gcs_path: transcript.llm_annotation_gcs_path,
        has_llm_notes: transcript.notes.length > 0,
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
