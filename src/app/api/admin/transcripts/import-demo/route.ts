import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  bucketName,
  getStorageClient,
  uploadInstructionalMaterialToBucket,
  uploadToBucket,
  uploadTranscriptVideoToBucket,
} from '../storage'
import {
  parseTranscriptFile,
  TranscriptParsingError,
  type ParsedTranscriptLine,
} from '../transcriptLineParser'

export const runtime = 'nodejs'

type DemoDefinition = {
  key: string
  prefix: string
  title: string
  grade: string
  lessonGoals: string
}

type ImportActor = {
  id: string
  workspace_id: string
}

const DEMO_DEFINITIONS: DemoDefinition[] = [
  {
    key: 'sample-1',
    prefix: 'demo/sample 1',
    title: 'Sample Unit: Navigating by the Stars',
    grade: '6',
    lessonGoals:
      'In this lesson, students apply observational reasoning to make sense of how the Southern Cross and its pointer stars (Alpha and Beta Centauri) can be used to locate south in the night sky. Students revisit their own attempts to find the Southern Cross at home, refine their technique for identifying the correct right-angle intersection, and extend this to determine all cardinal directions.',
  },
  {
    key: 'sample-2',
    prefix: 'demo/sample 2',
    title: 'Sample Unit: Comparing Fractions',
    grade: '5',
    lessonGoals:
      'In this lesson, students use benchmark fractions and reasoning about numerators and denominators to determine whether a fraction is greater than or less than one half. By the end of the lesson, students should be able to determine whether a fraction is greater than one half by examining the relationship between the numerator and half of the denominator, without relying on conversion or division.',
  },
  {
    key: 'sample-3',
    prefix: 'demo/sample 3',
    title: 'Sample Unit: Classifying Quadrilaterals',
    grade: '4',
    lessonGoals:
      'In this lesson, students sort and classify quadrilaterals by their attributes including parallel sides, right angles, and side lengths and use precise mathematical vocabulary to justify their reasoning. At the end of the lesson, students should understand that quadrilaterals form a hierarchy: squares are rectangles, rectangles are parallelograms, and trapezoids having only one pair of parallel sides stand apart from that group.',
  },
]

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

const normalizeSegmentValue = (value: string | null) => (value ?? '').trim()

const isValidSegmentValue = (value: string | null) => {
  const normalized = normalizeSegmentValue(value)
  return normalized.length > 0 && normalized !== '-'
}

const toSeconds = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null

type BucketObjectFile = {
  name: string
  download: () => Promise<[Buffer]>
  getMetadata: () => Promise<[Record<string, unknown>]>
}

const isFileObject = (item: unknown): item is BucketObjectFile =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as { name?: unknown }).name === 'string' &&
  typeof (item as { download?: unknown }).download === 'function' &&
  typeof (item as { getMetadata?: unknown }).getMetadata === 'function'

const listFiles = async (prefix: string) => {
  const storage = getStorageClient()
  const bucket = storage.bucket(bucketName)
  const [rawFiles] = await bucket.getFiles({ prefix })

  const files = rawFiles
    .filter((file) => isFileObject(file))
    .filter((file) => {
      const name = file.name.trim()
      return name.length > 0 && !name.endsWith('/')
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return files
}

const getBaseName = (fullPath: string) => {
  const parts = fullPath.split('/')
  return parts[parts.length - 1] || fullPath
}

const getLowerCaseExtension = (fileName: string) => {
  const trimmed = fileName.trim().toLowerCase()
  const dotIndex = trimmed.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return ''
  }

  return trimmed.slice(dotIndex + 1)
}

const isTranscriptFile = (fileName: string) =>
  ['csv', 'xls', 'xlsx'].includes(getLowerCaseExtension(fileName))

const isVideoFile = (fileName: string) =>
  ['mp4', 'mov', 'm4v', 'webm', 'avi'].includes(getLowerCaseExtension(fileName))

const isImageFile = (fileName: string) =>
  ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(getLowerCaseExtension(fileName))

const selectTranscriptSource = (files: BucketObjectFile[]) => {
  const byName = files.find((file) => {
    const base = getBaseName(file.name).toLowerCase()
    return base.includes('transcript') && isTranscriptFile(file.name)
  })
  if (byName) {
    return byName
  }

  return files.find((file) => isTranscriptFile(file.name))
}

const selectVideoSource = (files: BucketObjectFile[]) => {
  const byName = files.find((file) => {
    const base = getBaseName(file.name).toLowerCase()
    return base.includes('video') && isVideoFile(file.name)
  })
  if (byName) {
    return byName
  }

  return files.find((file) => isVideoFile(file.name))
}

const selectInstructionalImageSources = ({
  files,
  transcriptSourceName,
  videoSourceName,
}: {
  files: BucketObjectFile[]
  transcriptSourceName: string
  videoSourceName: string
}) =>
  files.filter((file) => {
    if (file.name === transcriptSourceName || file.name === videoSourceName) {
      return false
    }

    return isImageFile(file.name)
  })

const buildFileFromGcsObject = async (objectFile: BucketObjectFile) => {
  const [buffer] = await objectFile.download()
  const [metadata] = await objectFile.getMetadata()
  const contentTypeRaw = metadata?.contentType
  const contentType =
    typeof contentTypeRaw === 'string' && contentTypeRaw.trim()
      ? contentTypeRaw.trim()
      : 'application/octet-stream'

  const bytes = new Uint8Array(buffer)

  return new File([bytes], getBaseName(objectFile.name), {
    type: contentType,
  })
}

const importTranscriptLines = async ({
  tx,
  transcriptId,
  parsedLines,
  segmentColumnPresent,
}: {
  tx: Prisma.TransactionClient
  transcriptId: string
  parsedLines: ParsedTranscriptLine[]
  segmentColumnPresent: boolean
}) => {
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
          transcript_id: transcriptId,
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
        endSeconds = endSeconds === null ? lineEndSeconds : Math.max(endSeconds, lineEndSeconds)
      }
    })

    const created = await tx.transcriptSegments.create({
      data: {
        transcript_id: transcriptId,
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
        transcript_id: transcriptId,
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
}

const ensureAnnotationAssignment = async ({
  transcriptId,
  actorId,
  llmVisibilityDefault,
}: {
  transcriptId: string
  actorId: string
  llmVisibilityDefault: 'hidden' | 'visible_after_completion' | 'always_visible'
}) => {
  const existing = await prisma.annotations.findFirst({
    where: {
      transcript_id: transcriptId,
      created_for: actorId,
    },
    select: { id: true, hide: true },
  })

  if (existing) {
    if (existing.hide) {
      await prisma.annotations.update({
        where: { id: existing.id },
        data: { hide: false },
      })
    }
    return
  }

  await prisma.annotations.create({
    data: {
      transcript_id: transcriptId,
      created_for: actorId,
      gcs_path: '',
      llm_annotation_visibility_admin: llmVisibilityDefault,
    },
  })
}

const importDemoDefinition = async ({
  actor,
  demo,
  noteCreationPrompt,
  noteAssignmentPrompt,
}: {
  actor: ImportActor
  demo: DemoDefinition
  noteCreationPrompt: string
  noteAssignmentPrompt: string
}) => {
  const existingDemo = await prisma.transcripts.findFirst({
    where: {
      workspace_id: actor.workspace_id,
      title: demo.title,
    },
    select: {
      id: true,
      llm_annotation_visibility_default: true,
    },
  })

  if (existingDemo) {
    await prisma.transcripts.update({
      where: { id: existingDemo.id },
      data: { grade: demo.grade },
      select: { id: true },
    })

    await ensureAnnotationAssignment({
      transcriptId: existingDemo.id,
      actorId: actor.id,
      llmVisibilityDefault: existingDemo.llm_annotation_visibility_default,
    })

    return {
      key: demo.key,
      transcriptId: existingDemo.id,
      title: demo.title,
      imported: false,
    }
  }

  const allDemoFiles = await listFiles(`${demo.prefix}/`)
  const transcriptSource = selectTranscriptSource(allDemoFiles)
  if (!transcriptSource) {
    throw new Error(`Demo transcript file not found under "${demo.prefix}/".`)
  }

  const videoSource = selectVideoSource(allDemoFiles)
  if (!videoSource) {
    throw new Error(`Demo video file not found under "${demo.prefix}/".`)
  }

  const imageFiles = selectInstructionalImageSources({
    files: allDemoFiles,
    transcriptSourceName: transcriptSource.name,
    videoSourceName: videoSource.name,
  })

  if (imageFiles.length === 0) {
    throw new Error(`Demo instructional images not found under "${demo.prefix}/".`)
  }

  const transcriptFile = await buildFileFromGcsObject(transcriptSource)
  const videoFile = await buildFileFromGcsObject(videoSource)
  const instructionalImageFiles = await Promise.all(
    imageFiles.map((imageFile) => buildFileFromGcsObject(imageFile)),
  )

  let parsedLines: ParsedTranscriptLine[]
  let segmentColumnPresent = false
  try {
    const parsed = await parseTranscriptFile(transcriptFile)
    parsedLines = parsed.lines
    segmentColumnPresent = parsed.segmentColumnPresent
  } catch (error) {
    const message =
      error instanceof TranscriptParsingError
        ? error.message
        : 'Unable to parse demo transcript file.'
    throw new Error(`${demo.key}: ${message}`)
  }

  const [mainUpload, videoUpload, imageUploads] = await Promise.all([
    uploadToBucket(transcriptFile, 'transcripts'),
    uploadTranscriptVideoToBucket(videoFile, demo.title, {
      source: demo.prefix,
      importedBy: actor.id,
    }),
    Promise.all(
      instructionalImageFiles.map((image, index) =>
        uploadInstructionalMaterialToBucket(image, demo.title, {
          transcriptTitle: demo.title,
          source: demo.prefix,
          orderIndex: String(index),
          originalFileName: image.name,
        }),
      ),
    ),
  ])

  const transcript = await prisma.$transaction(async (tx) => {
    const createdVideo = await tx.videos.create({
      data: {
        file_name: videoUpload.originalName,
        mime_type: videoUpload.mimeType || null,
        gcs_path: videoUpload.gcsPath,
      },
      select: { id: true },
    })

    const createdTranscript = await tx.transcripts.create({
      data: {
        uploaded_by: actor.id,
        workspace_id: actor.workspace_id,
        title: demo.title,
        grade: demo.grade,
        instruction_context: demo.lessonGoals,
        transcript_file_name: mainUpload.originalName,
        gcs_path: mainUpload.gcsPath,
        llm_annotation: 'not_generated',
        video_id: createdVideo.id,
        video_uploaded: true,
      },
      select: {
        id: true,
        llm_annotation_visibility_default: true,
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
        ${createdTranscript.id},
        ${actor.id},
        ${noteCreationPrompt},
        ${noteAssignmentPrompt}
      )
    `

    await importTranscriptLines({
      tx,
      transcriptId: createdTranscript.id,
      parsedLines,
      segmentColumnPresent,
    })

    await tx.instructionalMaterial.createMany({
      data: imageUploads.map((image, index) => ({
        transcript_id: createdTranscript.id,
        gcs_path: image.gcsPath,
        image_title: '',
        order_index: index,
      })),
    })

    await tx.annotations.create({
      data: {
        transcript_id: createdTranscript.id,
        created_for: actor.id,
        gcs_path: '',
        llm_annotation_visibility_admin: createdTranscript.llm_annotation_visibility_default,
      },
    })

    return createdTranscript
  })

  return {
    key: demo.key,
    transcriptId: transcript.id,
    title: demo.title,
    imported: true,
  }
}

export async function POST() {
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

    const actor = await prisma.user.findFirst({
      where: { auth_user_id: authUserId },
      select: { id: true, workspace_id: true },
    })

    if (!actor) {
      return NextResponse.json(
        { error: 'Authenticated user is not registered in the application database.' },
        { status: 403 },
      )
    }

    const [noteCreationPrompt, noteAssignmentPrompt] = await Promise.all([
      readFile(noteCreationPromptPath, 'utf8'),
      readFile(noteAssignmentPromptPath, 'utf8'),
    ])

    const importedTranscripts: Array<{
      key: string
      transcriptId: string
      title: string
      imported: boolean
    }> = []
    for (const demo of DEMO_DEFINITIONS) {
      const imported = await importDemoDefinition({
        actor,
        demo,
        noteCreationPrompt,
        noteAssignmentPrompt,
      })
      importedTranscripts.push(imported)
    }

    const importedCount = importedTranscripts.filter((item) => item.imported).length
    const alreadyPresentCount = importedTranscripts.length - importedCount

    return NextResponse.json(
      {
        success: true,
        importedCount,
        alreadyPresentCount,
        totalDemos: importedTranscripts.length,
        transcripts: importedTranscripts,
      },
      { status: importedCount > 0 ? 201 : 200 },
    )
  } catch (error) {
    console.error('Failed to import demo files', error)
    const message = error instanceof Error ? error.message : 'Unable to import demo files right now.'
    const status =
      message.includes('not found under') ||
      message.includes('Unable to parse demo transcript file') ||
      message.includes('missing required columns') ||
      message.includes('No transcript lines found')
        ? 400
        : 500
    return NextResponse.json(
      {
        error: message,
      },
      { status },
    )
  }
}
