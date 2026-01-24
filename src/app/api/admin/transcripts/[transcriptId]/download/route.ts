import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import JSZip from 'jszip'

import { prisma } from '@/lib/prisma'
import { bucketName, getStorageClient } from '../../storage'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type ParsedGcsPath = { bucket: string; object: string }

const sanitizeFileName = (value: string, fallback: string) => {
  const trimmed = value.trim().replace(/[/\\]/g, '-')
  const normalized = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  const safe = normalized || fallback
  return safe.toLowerCase()
}

const dedupeFileNames = (files: { gcsPath: string; fileName: string }[]) => {
  const seen = new Set<string>()

  return files.map((file) => {
    if (!seen.has(file.fileName)) {
      seen.add(file.fileName)
      return file
    }

    const lastDot = file.fileName.lastIndexOf('.')
    const base =
      lastDot > 0 ? file.fileName.slice(0, lastDot) : file.fileName
    const ext = lastDot > 0 ? file.fileName.slice(lastDot) : ''

    let counter = 1
    let candidate = `${base}-${counter}${ext}`
    while (seen.has(candidate)) {
      counter += 1
      candidate = `${base}-${counter}${ext}`
    }

    seen.add(candidate)
    return { ...file, fileName: candidate }
  })
}

const parseGcsPath = (uri: string): ParsedGcsPath => {
  if (!uri) {
    throw new Error('Storage path is required.')
  }

  const trimmed = uri.trim()
  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice('gs://'.length)
    const slashIndex = withoutScheme.indexOf('/')
    if (slashIndex === -1) {
      throw new Error('Invalid Google Cloud Storage URI.')
    }

    const bucket = withoutScheme.slice(0, slashIndex)
    const object = withoutScheme.slice(slashIndex + 1)
    if (!bucket || !object) {
      throw new Error('Invalid Google Cloud Storage URI.')
    }

    return { bucket, object }
  }

  if (trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      if (
        url.hostname === 'storage.googleapis.com' ||
        url.hostname === 'storage.cloud.google.com'
      ) {
        const segments = url.pathname.replace(/^\/+/, '').split('/')
        const [bucket, ...rest] = segments
        if (!bucket || rest.length === 0) {
          throw new Error('Invalid Google Cloud Storage URL.')
        }

        const object = rest.join('/')
        return { bucket, object }
      }
    } catch {
      // fall through
    }
  }

  throw new Error('Unsupported Google Cloud Storage path format.')
}

export async function GET(request: Request, context: RouteContext) {
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

    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const searchParams = new URL(request.url).searchParams
    const transcriptIdFromParams = params?.transcriptId
    const transcriptIdFromQuery = searchParams.get('transcriptId') ?? undefined
    const transcriptId = transcriptIdFromParams ?? transcriptIdFromQuery
    if (!transcriptId) {
      return NextResponse.json({ error: 'Transcript id is required.' }, { status: 400 })
    }

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: {
        gcs_path: true,
        transcript_file_name: true,
        llm_annotation_gcs_path: true,
        annotation_file_name: true,
        title: true,
      },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    const filesToDownload: { gcsPath: string; fileName: string }[] = []
    if (transcript.gcs_path) {
      filesToDownload.push({
        gcsPath: transcript.gcs_path,
        fileName: sanitizeFileName(
          transcript.transcript_file_name ?? 'transcript',
          'transcript',
        ),
      })
    }
    if (transcript.llm_annotation_gcs_path) {
      filesToDownload.push({
        gcsPath: transcript.llm_annotation_gcs_path,
        fileName: sanitizeFileName(
          transcript.annotation_file_name ?? 'annotation',
          'annotation',
        ),
      })
    }

    if (filesToDownload.length === 0) {
      return NextResponse.json(
        { error: 'No files available to download for this transcript.' },
        { status: 404 },
      )
    }

    const normalizedFiles = dedupeFileNames(filesToDownload)
    const storage = getStorageClient()
    const zip = new JSZip()

    await Promise.all(
      normalizedFiles.map(async ({ gcsPath, fileName }) => {
        const { bucket, object } = parseGcsPath(gcsPath)
        const [fileBuffer] = await storage.bucket(bucket).file(object).download()
        zip.file(fileName, fileBuffer)
      }),
    )

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    const zipUint8Array = new Uint8Array(zipBuffer)
    const zipFileName = `${sanitizeFileName(
      transcript.title ?? 'transcript-files',
      'transcript-files',
    )}.zip`

    return new NextResponse(zipUint8Array, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"`,
        'Content-Length': String(zipBuffer.byteLength),
      },
    })
  } catch (error) {
    console.error('Failed to generate download URL', error)
    return NextResponse.json(
      { error: 'Unable to generate download link right now.' },
      { status: 500 },
    )
  }
}
