import { Storage, type StorageOptions } from '@google-cloud/storage'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

export const bucketName =
  process.env.GOOGLE_CLOUD_STORAGE_BUCKET ??
  process.env.GCS_BUCKET_NAME ??
  process.env.GOOGLE_STORAGE_BUCKET ??
  ''

let storageClient: Storage | null = null

type ServiceAccountCredentials = {
  project_id?: string
  client_email?: string
  private_key?: string
}

const parseServiceAccountCredentials = (): ServiceAccountCredentials => {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!raw || !raw.trim()) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS must contain the service account JSON.',
    )
  }

  try {
    return JSON.parse(raw) as ServiceAccountCredentials
  } catch {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be valid JSON.')
  }
}

const buildStorageOptions = (): StorageOptions => {
  const credentials = parseServiceAccountCredentials()
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS JSON is missing client_email or private_key.',
    )
  }

  const projectId = credentials.project_id ?? process.env.GOOGLE_CLOUD_PROJECT_ID
  const options: StorageOptions = {
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
    },
  }

  if (projectId) {
    options.projectId = projectId
  }

  return options
}

export const getStorageClient = () => {
  if (storageClient) {
    return storageClient
  }

  storageClient = new Storage(buildStorageOptions())
  return storageClient
}

const sanitizeFileName = (fileName: string) =>
  fileName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.\-_]/g, '')

const sanitizePathSegment = (value: string, fallback: string) => {
  const normalized = value
    .trim()
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_.]/g, '')

  return normalized || fallback
}

const buildObjectPath = (fileNameRaw: string, folder: UploadFolder) => {
  const trimmed = fileNameRaw?.trim() || 'transcript'
  const lastDot = trimmed.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < trimmed.length - 1
  const extension = hasExtension ? trimmed.slice(lastDot) : ''
  const baseName = hasExtension ? trimmed.slice(0, lastDot) : trimmed
  const sanitizedBase = sanitizeFileName(baseName) || 'file'
  const uuid = randomUUID()
  return `${folder}/${sanitizedBase}-${uuid}${extension.toLowerCase()}`
}

const buildInstructionalMaterialPath = (fileNameRaw: string, transcriptTitle: string) => {
  const transcriptSegment = sanitizePathSegment(transcriptTitle || 'transcript', 'transcript')
  const trimmed = fileNameRaw?.trim() || 'instruction'
  const lastDot = trimmed.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < trimmed.length - 1
  const extension = hasExtension ? trimmed.slice(lastDot) : ''
  const baseName = hasExtension ? trimmed.slice(0, lastDot) : trimmed
  const sanitizedBase = sanitizeFileName(baseName) || 'instruction'
  const uuid = randomUUID()
  return `instructional-material/${transcriptSegment}/${sanitizedBase}-${uuid}${extension.toLowerCase()}`
}

const buildTranscriptVideoPath = (fileNameRaw: string, transcriptTitle: string) => {
  const transcriptSegment = sanitizeFileName(transcriptTitle || 'transcript') || 'transcript'
  const trimmed = fileNameRaw?.trim() || 'video'
  const lastDot = trimmed.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < trimmed.length - 1
  const extension = hasExtension ? trimmed.slice(lastDot) : ''
  const baseName = hasExtension ? trimmed.slice(0, lastDot) : trimmed
  const sanitizedVideoBase = sanitizeFileName(baseName) || 'video'
  const uuid = randomUUID()
  return `videos/${transcriptSegment}-${sanitizedVideoBase}-${uuid}${extension.toLowerCase()}`
}

export type UploadFolder = 'transcripts' | 'referrence-annotations'

export type UploadResult = {
  field: 'mainFile' | 'associatedFile'
  originalName: string
  mimeType: string
  gcsPath: string
  publicUrl: string
}

export type InstructionalMaterialUploadResult = {
  originalName: string
  mimeType: string
  gcsPath: string
  publicUrl: string
}

export type SectionVideoUploadResult = {
  originalName: string
  mimeType: string
  gcsPath: string
  publicUrl: string
}

export type SignedVideoUpload = {
  uploadUrl: string
  objectPath: string
  gcsPath: string
  publicUrl: string
  requiredHeaders: Record<string, string>
  expiresAt: string
}

export const uploadTranscriptVideoStreamToBucket = async (
  stream: ReadableStream<Uint8Array>,
  fileName: string,
  mimeType: string | undefined,
  transcriptTitle: string,
  metadata?: Record<string, string | undefined>,
): Promise<SectionVideoUploadResult> => {
  if (!bucketName) {
    throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET (or alias) is not configured.')
  }

  const storage = getStorageClient()
  const bucket = storage.bucket(bucketName)
  const objectPath = buildTranscriptVideoPath(fileName || 'video', transcriptTitle)
  const object = bucket.file(objectPath)

  const writeStream = object.createWriteStream({
    resumable: true,
    metadata: {
      contentType: mimeType || undefined,
      metadata: {
        originalFileName: fileName,
        ...metadata,
      },
    },
  })

  // Stream the upload to avoid buffering large videos in memory.
  const fileStream = Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>)
  await pipeline(fileStream, writeStream)

  return {
    originalName: fileName,
    mimeType: mimeType ?? '',
    gcsPath: `gs://${bucketName}/${objectPath}`,
    publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
  }
}

export const createTranscriptVideoUploadUrl = async ({
  fileName,
  contentType,
  transcriptTitle,
  transcriptId,
  uploaderId,
  expiresInMinutes = 15,
}: {
  fileName: string
  contentType: string
  transcriptTitle: string
  transcriptId: string
  uploaderId: string
  expiresInMinutes?: number
}): Promise<SignedVideoUpload> => {
  if (!bucketName) {
    throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET (or alias) is not configured.')
  }

  const storage = getStorageClient()
  const bucket = storage.bucket(bucketName)
  const objectPath = buildTranscriptVideoPath(fileName || 'video', transcriptTitle)
  const object = bucket.file(objectPath)

  const metadataHeaders: Record<string, string> = {
    'x-goog-meta-transcript-id': transcriptId,
    'x-goog-meta-uploader-id': uploaderId,
    'x-goog-meta-original-file-name': encodeURIComponent(fileName || 'video'),
  }

  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000
  const [uploadUrl] = await object.getSignedUrl({
    action: 'write',
    expires: expiresAt,
    contentType,
    extensionHeaders: metadataHeaders,
    version: 'v4',
  })

  return {
    uploadUrl,
    objectPath,
    gcsPath: `gs://${bucketName}/${objectPath}`,
    publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
    requiredHeaders: {
      'Content-Type': contentType,
      ...metadataHeaders,
    },
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export const uploadToBucket = async (file: File, folder: UploadFolder): Promise<UploadResult> => {
  if (!bucketName) {
    throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET (or alias) is not configured.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const storage = getStorageClient()
  const bucket = storage.bucket(bucketName)
  const objectPath = buildObjectPath(file.name || 'transcript', folder)
  const object = bucket.file(objectPath)

  await object.save(buffer, {
    metadata: {
      contentType: file.type || undefined,
      metadata: {
        originalFileName: file.name,
      },
    },
  })

  return {
    field: folder === 'transcripts' ? 'mainFile' : 'associatedFile',
    originalName: file.name,
    mimeType: file.type,
    gcsPath: `gs://${bucketName}/${objectPath}`,
    publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
  }
}

export const uploadInstructionalMaterialToBucket = async (
  file: File,
  transcriptTitle: string,
  metadata?: Record<string, string | undefined>,
): Promise<InstructionalMaterialUploadResult> => {
  if (!bucketName) {
    throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET (or alias) is not configured.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const storage = getStorageClient()
  const bucket = storage.bucket(bucketName)
  const objectPath = buildInstructionalMaterialPath(file.name || 'instruction', transcriptTitle)
  const object = bucket.file(objectPath)

  await object.save(buffer, {
    metadata: {
      contentType: file.type || undefined,
      metadata: {
        originalFileName: file.name,
        ...metadata,
      },
    },
  })

  return {
    originalName: file.name,
    mimeType: file.type,
    gcsPath: `gs://${bucketName}/${objectPath}`,
    publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
  }
}

export const uploadTranscriptVideoToBucket = async (
  file: File,
  transcriptTitle: string,
  metadata?: Record<string, string | undefined>,
): Promise<SectionVideoUploadResult> => {
  return uploadTranscriptVideoStreamToBucket(
    file.stream(),
    file.name || 'video',
    file.type,
    transcriptTitle,
    metadata,
  )
}

const parseGcsPath = (gcsPath: string) => {
  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/)
  if (!match) {
    throw new Error('Invalid GCS path.')
  }

  return {
    bucket: match[1],
    objectPath: match[2],
  }
}

export const deleteTranscriptVideoFromBucket = async (gcsPath: string) => {
  const { bucket: bucketFromPath, objectPath } = parseGcsPath(gcsPath)
  const storage = getStorageClient()
  const bucket = storage.bucket(bucketFromPath)

  await bucket.file(objectPath).delete({ ignoreNotFound: true })
}
