import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type FlagAssignmentPayload = {
  lineIds?: string[]
  flagged?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | FlagAssignmentPayload
      | null
    const lineIds = Array.isArray(body?.lineIds)
      ? body.lineIds.filter((lineId): lineId is string => typeof lineId === 'string')
      : []
    const flagged = typeof body?.flagged === 'boolean' ? body.flagged : null

    const uniqueLineIds = Array.from(
      new Set(lineIds.map((lineId) => lineId.trim()).filter(Boolean)),
    )

    if (uniqueLineIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one line id is required.' },
        { status: 400 },
      )
    }

    if (flagged === null) {
      return NextResponse.json(
        { success: false, error: 'Flag value is required.' },
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

    const lines = await prisma.transcriptLines.findMany({
      where: { line_id: { in: uniqueLineIds } },
      select: { line_id: true, transcript_id: true },
    })

    if (lines.length !== uniqueLineIds.length) {
      return NextResponse.json(
        { success: false, error: 'One or more transcript lines are invalid.' },
        { status: 400 },
      )
    }

    const transcriptIds = new Set(lines.map((line) => line.transcript_id))
    if (transcriptIds.size !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Flag assignments must belong to a single transcript.',
        },
        { status: 400 },
      )
    }

    const transcriptId = lines[0]?.transcript_id
    const assignment = await prisma.annotations.findFirst({
      where: {
        transcript_id: transcriptId,
        created_for: annotator.id,
        hide: { not: true },
      },
      select: { id: true },
    })

    if (!assignment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript not found or not assigned to the current user.',
        },
        { status: 404 },
      )
    }

    if (flagged) {
      await prisma.flagAssignments.createMany({
        data: uniqueLineIds.map((lineId) => ({
          user_id: annotator.id,
          line_id: lineId,
        })),
        skipDuplicates: true,
      })
    } else {
      await prisma.flagAssignments.deleteMany({
        where: { user_id: annotator.id, line_id: { in: uniqueLineIds } },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update flag assignments', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to update flag assignments. Please try again later.',
      },
      { status: 500 },
    )
  }
}
