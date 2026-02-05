import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { bucketName, uploadToBucket, type UploadResult } from '../storage'
import {
  parseTranscriptFile,
  TranscriptParsingError,
  type ParsedTranscriptLine,
} from '../transcriptLineParser'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const normalizeSegmentValue = (value: string | null) => (value ?? '').trim()

const isValidSegmentValue = (value: string | null) => {
  const normalized = normalizeSegmentValue(value)
  return normalized.length > 0 && normalized !== '-'
}

const toSeconds = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null

const noteCreationPromptPath = path.join(
  process.cwd(),
  'prompts',
  'note_creation_prompt_part_1_customizable.md',
)

const noteAssignmentPromptPath = path.join(
  process.cwd(),
  'prompts',
  'note_assignment_prompt_part_1_customizable.md',
)

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
      select: { id: true, workspace_id: true },
    })

    if (!uploader) {
      return NextResponse.json(
        { error: 'Authenticated user is not registered in the application database.' },
        { status: 403 },
      )
    }

    const formData = await request.formData()
    const transcriptName = (formData.get('transcriptName') as string | null)?.trim() ?? ''
    if (!transcriptName) {
      return NextResponse.json({ error: 'Transcript name is required.' }, { status: 400 })
    }
    const grade = (formData.get('grade') as string | null)?.trim() ?? ''
    if (!grade) {
      return NextResponse.json({ error: 'Grade is required.' }, { status: 400 })
    }
    const instructions = (formData.get('instructions') as string | null)?.trim() ?? ''
    const mainFileCandidate = formData.get('mainFile')
    if (!(mainFileCandidate instanceof File) || mainFileCandidate.size === 0) {
      return NextResponse.json({ error: 'Main transcript file is required.' }, { status: 400 })
    }
    const mainFile = mainFileCandidate
    const associatedCandidate = formData.get('associatedFile')
    const associatedFile =
      associatedCandidate instanceof File && associatedCandidate.size > 0
        ? associatedCandidate
        : null

    let parsedLines: ParsedTranscriptLine[]
    let segmentColumnPresent = false
    try {
      const parsed = await parseTranscriptFile(mainFile)
      parsedLines = parsed.lines
      segmentColumnPresent = parsed.segmentColumnPresent
    } catch (error) {
      const message =
        error instanceof TranscriptParsingError
          ? error.message
          : 'Unable to read transcript contents. Please verify the file and try again.'

      return NextResponse.json({ error: message }, { status: 400 })
    }

    const uploads: UploadResult[] = []
    uploads.push(await uploadToBucket(mainFile, 'transcripts'))
    if (associatedFile) {
      uploads.push(await uploadToBucket(associatedFile, 'referrence-annotations'))
    }

    const mainUpload = uploads.find((upload) => upload.field === 'mainFile')
    if (!mainUpload) {
      return NextResponse.json(
        { error: 'Failed to upload the main transcript file.' },
        { status: 500 },
      )
    }
    const associatedUpload = uploads.find((upload) => upload.field === 'associatedFile')

    const [noteCreationPrompt, noteAssignmentPrompt] = await Promise.all([
      readFile(noteCreationPromptPath, 'utf8'),
      readFile(noteAssignmentPromptPath, 'utf8'),
    ])

    const transcriptRecord = await prisma.$transaction(async (tx) => {
      const transcript = await tx.transcripts.create({
        data: {
          uploaded_by: uploader.id,
          workspace_id: uploader.workspace_id,
          title: transcriptName,
          grade,
          instruction_context: instructions || '',
          transcript_file_name: mainUpload.originalName,
          gcs_path: mainUpload.gcsPath,
          llm_annotation: Boolean(associatedUpload),
          annotation_file_name: associatedUpload?.originalName ?? null,
          llm_annotation_gcs_path: associatedUpload?.gcsPath ?? null,
        },
      })

      await tx.$executeRaw`
        INSERT INTO "LLMNotePrompts" (
          "id",
          "transcript_id",
          "created_by",
          "note_creation_prompt",
          "note_assignment_prompt"
        )
        VALUES (
          ${randomUUID()},
          ${transcript.id},
          ${uploader.id},
          ${noteCreationPrompt},
          ${noteAssignmentPrompt}
        )
      `

      const segmentValuesInOrder: string[] = []
      const segmentStats = new Map<
        string,
        { startSeconds: number | null; endSeconds: number | null }
      >()

      if (segmentColumnPresent) {
        parsedLines.forEach((line) => {
          if (!isValidSegmentValue(line.segment)) {
            return
          }

          const normalizedSegment = normalizeSegmentValue(line.segment)
          if (!segmentStats.has(normalizedSegment)) {
            segmentStats.set(normalizedSegment, {
              startSeconds: null,
              endSeconds: null,
            })
            segmentValuesInOrder.push(normalizedSegment)
          }

          const stats = segmentStats.get(normalizedSegment)
          if (!stats) {
            return
          }

          const lineStartSeconds = toSeconds(line.inCue)
          const lineEndSeconds = toSeconds(line.outCue)

          if (lineStartSeconds !== null) {
            stats.startSeconds =
              stats.startSeconds === null
                ? lineStartSeconds
                : Math.min(stats.startSeconds, lineStartSeconds)
          }
          if (lineEndSeconds !== null) {
            stats.endSeconds =
              stats.endSeconds === null
                ? lineEndSeconds
                : Math.max(stats.endSeconds, lineEndSeconds)
          }
        })
      }

      const useSegments = segmentColumnPresent && segmentValuesInOrder.length > 0

      const segmentIdByTitle = new Map<string, string>()
      if (useSegments) {
        for (const [index, title] of segmentValuesInOrder.entries()) {
          const stats = segmentStats.get(title)
          const created = await tx.transcriptSegments.create({
            data: {
              transcript_id: transcript.id,
              segment_title: title,
              segment_index: index + 1,
              start_time: stats?.startSeconds ?? null,
              end_time: stats?.endSeconds ?? null,
            },
          })
          segmentIdByTitle.set(title, created.id)
        }
      }

      let defaultSegmentId: string | null = null
      if ((!segmentColumnPresent || !useSegments) && parsedLines.length > 0) {
        let startSeconds: number | null = null
        let endSeconds: number | null = null
        parsedLines.forEach((line) => {
          const lineStartSeconds = toSeconds(line.inCue)
          const lineEndSeconds = toSeconds(line.outCue)

          if (lineStartSeconds !== null) {
            startSeconds =
              startSeconds === null ? lineStartSeconds : Math.min(startSeconds, lineStartSeconds)
          }
          if (lineEndSeconds !== null) {
            endSeconds =
              endSeconds === null ? lineEndSeconds : Math.max(endSeconds, lineEndSeconds)
          }
        })

        const created = await tx.transcriptSegments.create({
          data: {
            transcript_id: transcript.id,
            segment_title: 'default_segment',
            segment_index: 1,
            start_time: startSeconds,
            end_time: endSeconds,
          },
        })
        defaultSegmentId = created.id
      }

      const linesToInsert = useSegments
        ? parsedLines.filter((line) => isValidSegmentValue(line.segment))
        : parsedLines

      if (linesToInsert.length > 0) {
        await tx.transcriptLines.createMany({
          data: linesToInsert.map((line) => ({
            transcript_id: transcript.id,
            line: line.line,
            speaker: line.speaker,
            utterance: line.utterance,
            in_cue: line.inCue,
            out_cue: line.outCue,
            segment_id: useSegments
              ? segmentIdByTitle.get(normalizeSegmentValue(line.segment)) ?? null
              : defaultSegmentId,
          })),
        })
      }

      return transcript
    })

    return NextResponse.json(
      {
        success: true,
        transcriptName,
        instructions,
        uploads,
        transcript: transcriptRecord,
        lineCount: parsedLines.length,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('Transcript upload failed', error)
    return NextResponse.json(
      { error: 'Failed to upload transcript files. Please try again.' },
      { status: 500 },
    )
  }
}
