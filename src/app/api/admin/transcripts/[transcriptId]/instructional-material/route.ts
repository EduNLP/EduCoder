import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { prisma } from '@/lib/prisma'
import { bucketName, getStorageClient, uploadInstructionalMaterialToBucket } from '../../storage'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    transcriptId?: string
  }>
}

type MaterialResponseItem = {
  id: string
  gcs_path: string
  image_title: string
  order_index: number
  uploaded_at: string
  url: string
  segment_ids: string[]
  description?: string | null
  original_file_name?: string | null
}

type SegmentResponseItem = {
  id: string
  label: string
  index: number
}

type MaterialInput = {
  fileField: string
  title?: string
  description?: string
  orderIndex?: number
  segmentIds?: string[]
}

const parseGcsPath = (uri: string): { bucket: string; object: string } => {
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
      // fall through to error below
    }
  }

  throw new Error('Unsupported Google Cloud Storage path format.')
}

const buildPublicUrl = ({ bucket, object }: { bucket: string; object: string }) =>
  `https://storage.googleapis.com/${bucket}/${object}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const resolveMaterialDetails = async (gcsPath: string): Promise<{
  url: string
  description?: string | null
  originalFileName?: string | null
}> => {
  const { bucket, object } = parseGcsPath(gcsPath)
  const storage = getStorageClient()
  const file = storage.bucket(bucket).file(object)

  try {
    const [metadata] = await file.getMetadata()
    const customMetadata = metadata.metadata ?? {}
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000,
    })

    const rawDescription = (customMetadata as Record<string, unknown>).description
    const rawOriginal = (customMetadata as Record<string, unknown>).originalFileName
    const description =
      typeof rawDescription === 'string'
        ? rawDescription
        : rawDescription == null
          ? null
          : String(rawDescription)
    const originalFileName =
      typeof rawOriginal === 'string'
        ? rawOriginal
        : rawOriginal == null
          ? null
          : String(rawOriginal)

    return {
      url: signedUrl ?? buildPublicUrl({ bucket, object }),
      description,
      originalFileName,
    }
  } catch (error) {
    console.error('Failed to resolve material metadata', error)
    return {
      url: buildPublicUrl({ bucket, object }),
      description: null,
      originalFileName: null,
    }
  }
}

const parseMaterials = (raw: FormDataEntryValue | null): MaterialInput[] => {
  if (!raw || typeof raw !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const materials: MaterialInput[] = []

    for (const item of parsed) {
      if (!isRecord(item)) {
        continue
      }

      const fileField = typeof item.fileField === 'string' ? item.fileField.trim() : ''
      if (!fileField) {
        continue
      }

      const title = typeof item.title === 'string' ? item.title.trim() : undefined
      const description =
        typeof item.description === 'string' ? item.description.trim() : undefined
      const orderIndex =
        typeof item.orderIndex === 'number' && Number.isFinite(item.orderIndex)
          ? Math.max(0, Math.floor(item.orderIndex))
          : undefined
      const segmentIds = Array.isArray(item.segmentIds)
        ? Array.from(
            new Set(
              item.segmentIds
                .filter((segmentId): segmentId is string => typeof segmentId === 'string')
                .map((segmentId) => segmentId.trim())
                .filter((segmentId) => segmentId.length > 0),
            ),
          )
        : []

      materials.push({ fileField, title, description, orderIndex, segmentIds })
    }

    return materials
  } catch (error) {
    console.error('Failed to parse instructional materials payload', error)
    return []
  }
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
    const transcriptIdFromBody = (formData.get('transcriptId') as string | null)?.trim()
    const transcriptId = transcriptIdFromParams ?? transcriptIdFromBody

    if (!transcriptId) {
      return NextResponse.json({ error: 'Transcript id is required.' }, { status: 400 })
    }

    const transcript = await prisma.transcripts.findUnique({
      where: { id: transcriptId },
      select: { id: true, title: true },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    const instructionalMaterialLinkRaw = formData.get('instructionalMaterialLink')
    const instructionalMaterialLink =
      typeof instructionalMaterialLinkRaw === 'string'
        ? instructionalMaterialLinkRaw.trim()
        : ''

    const materials = parseMaterials(formData.get('materials'))
    if (materials.length === 0) {
      return NextResponse.json({ error: 'No instructional materials provided.' }, { status: 400 })
    }

    const requestedSegmentIds = Array.from(
      new Set(materials.flatMap((material) => material.segmentIds ?? [])),
    )
    const validSegmentIds = new Set<string>()
    if (requestedSegmentIds.length > 0) {
      const matchingSegments = await prisma.transcriptSegments.findMany({
        where: {
          transcript_id: transcript.id,
          id: {
            in: requestedSegmentIds,
          },
        },
        select: {
          id: true,
        },
      })
      matchingSegments.forEach((segment) => {
        validSegmentIds.add(segment.id)
      })

      if (validSegmentIds.size !== requestedSegmentIds.length) {
        return NextResponse.json(
          { error: 'One or more selected segments are invalid for this transcript.' },
          { status: 400 },
        )
      }
    }

    await prisma.transcripts.update({
      where: { id: transcript.id },
      data: {
        instructional_material_link: instructionalMaterialLink || null,
      },
    })

    const prepared = materials.map((item, index) => {
      const fileCandidate = formData.get(item.fileField)
      if (!(fileCandidate instanceof File) || fileCandidate.size === 0) {
        throw new Error(`File missing for instructional material #${index + 1}`)
      }

      const trimmedTitle = item.title?.trim() ?? ''
      const trimmedDescription = item.description?.trim() ?? ''

      return {
        file: fileCandidate,
        order_index: typeof item.orderIndex === 'number' ? item.orderIndex : index,
        image_title: trimmedTitle || trimmedDescription || '',
        description: trimmedDescription || undefined,
        segmentIds: (item.segmentIds ?? []).filter((segmentId) => validSegmentIds.has(segmentId)),
      }
    })

    const uploads = await Promise.all(
      prepared.map(async (item, index) => {
        const upload = await uploadInstructionalMaterialToBucket(item.file, transcript.title ?? 'transcript', {
          transcriptId,
          transcriptTitle: transcript.title ?? undefined,
          description: item.description,
          title: item.image_title || undefined,
          orderIndex: String(item.order_index ?? index),
        })

        return {
          image_title: item.image_title,
          order_index: item.order_index,
          segmentIds: item.segmentIds,
          upload,
        }
      }),
    )

    const created = await prisma.$transaction(async (tx) => {
      const createdItems: Array<{
        id: string
        gcs_path: string
        image_title: string
        order_index: number
        uploaded_at: Date
        segment_ids: string[]
      }> = []

      for (const item of uploads) {
        const createdMaterial = await tx.instructionalMaterial.create({
          data: {
            transcript_id: transcript.id,
            gcs_path: item.upload.gcsPath,
            image_title: item.image_title,
            order_index: item.order_index,
          },
          select: {
            id: true,
            gcs_path: true,
            image_title: true,
            order_index: true,
            uploaded_at: true,
          },
        })

        if (item.segmentIds.length > 0) {
          await tx.instructionalMaterialSegment.createMany({
            data: item.segmentIds.map((segmentId) => ({
              material_id: createdMaterial.id,
              segment_id: segmentId,
            })),
            skipDuplicates: true,
          })
        }

        createdItems.push({
          id: createdMaterial.id,
          gcs_path: createdMaterial.gcs_path,
          image_title: createdMaterial.image_title,
          order_index: createdMaterial.order_index,
          uploaded_at: createdMaterial.uploaded_at,
          segment_ids: item.segmentIds,
        })
      }

      return createdItems
    })

    return NextResponse.json(
      {
        success: true,
        transcriptId: transcript.id,
        items: created,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('Instructional material upload failed', error)
    const message =
      error instanceof Error ? error.message : 'Failed to upload instructional materials.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
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
      select: { id: true, instructional_material_link: true },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    const [materials, segments] = await Promise.all([
      prisma.instructionalMaterial.findMany({
        where: { transcript_id: transcript.id },
        select: {
          id: true,
          gcs_path: true,
          image_title: true,
          order_index: true,
          uploaded_at: true,
          segmentLinks: {
            select: {
              segment_id: true,
            },
          },
        },
        orderBy: { order_index: 'asc' },
      }),
      prisma.transcriptSegments.findMany({
        where: { transcript_id: transcript.id },
        select: {
          id: true,
          segment_title: true,
          segment_index: true,
        },
        orderBy: { segment_index: 'asc' },
      }),
    ])

    const normalizedSegments: SegmentResponseItem[] = segments
      .map((segment) => {
        const label = segment.segment_title.trim()
        if (!label) {
          return null
        }

        return {
          id: segment.id,
          label,
          index: segment.segment_index,
        }
      })
      .filter((segment): segment is SegmentResponseItem => segment !== null)

    if (materials.length === 0) {
      return NextResponse.json({
        success: true,
        transcriptId: transcript.id,
        instructional_material_link: transcript.instructional_material_link,
        items: [],
        segments: normalizedSegments,
      })
    }

    const items: MaterialResponseItem[] = await Promise.all(
      materials.map(async (material) => {
        const details = await resolveMaterialDetails(material.gcs_path)
        return {
          id: material.id,
          gcs_path: material.gcs_path,
          image_title: material.image_title,
          order_index: material.order_index,
          uploaded_at: material.uploaded_at.toISOString(),
          url: details.url,
          segment_ids: material.segmentLinks.map((segmentLink) => segmentLink.segment_id),
          description: details.description,
          original_file_name: details.originalFileName,
        }
      }),
    )

    return NextResponse.json({
      success: true,
      transcriptId: transcript.id,
      instructional_material_link: transcript.instructional_material_link,
      items,
      segments: normalizedSegments,
    })
  } catch (error) {
    console.error('Failed to fetch instructional materials', error)
    return NextResponse.json(
      { error: 'Unable to fetch instructional materials right now.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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
      select: { id: true, title: true },
    })

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found.' }, { status: 404 })
    }

    const materials = await prisma.instructionalMaterial.findMany({
      where: { transcript_id: transcript.id },
      select: { id: true, gcs_path: true },
    })

    if (materials.length === 0) {
      return NextResponse.json({
        success: true,
        transcriptId: transcript.id,
        deletedCount: 0,
      })
    }

    const storage = getStorageClient()
    const storageErrors: Array<{ id: string; reason: string }> = []

    await Promise.all(
      materials.map(async (material) => {
        try {
          const { bucket, object } = parseGcsPath(material.gcs_path)
          await storage.bucket(bucket).file(object).delete({ ignoreNotFound: true })
        } catch (error) {
          console.error('Failed to delete instructional material from storage', {
            gcsPath: material.gcs_path,
            error,
          })
          storageErrors.push({
            id: material.id,
            reason:
              error instanceof Error
                ? error.message
                : 'Unknown error while deleting storage object.',
          })
        }
      }),
    )

    const deletion = await prisma.instructionalMaterial.deleteMany({
      where: { transcript_id: transcript.id },
    })

    return NextResponse.json({
      success: true,
      transcriptId: transcript.id,
      deletedCount: deletion.count,
      storageErrors: storageErrors.length > 0 ? storageErrors : undefined,
    })
  } catch (error) {
    console.error('Failed to delete instructional materials', error)
    const message =
      error instanceof Error ? error.message : 'Unable to delete instructional materials.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
