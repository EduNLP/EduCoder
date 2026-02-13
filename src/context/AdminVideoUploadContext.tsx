'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type SectionVideo = {
  id: string
  file_name: string
  mime_type: string | null
  gcs_path: string
  uploaded_at: string
}

export type UploadPhase = 'preparing' | 'uploading' | 'finalizing'

type UploadResponse = {
  success: boolean
  transcriptId?: string
  video?: SectionVideo
  error?: string
}

type SignedUploadResponse = {
  success: boolean
  uploadUrl?: string
  objectPath?: string
  requiredHeaders?: Record<string, string>
  error?: string
}

export type AdminVideoUploadState = {
  transcriptId: string
  transcriptTitle: string
  isUploading: boolean
  phase: UploadPhase | null
  progress: number | null
  error: string | null
  updatedAt: number
}

type StartVideoUploadParams = {
  transcriptId: string
  transcriptTitle: string
  file: File
}

type AdminVideoUploadContextValue = {
  uploadsByTranscript: Record<string, AdminVideoUploadState>
  startVideoUpload: (params: StartVideoUploadParams) => Promise<SectionVideo>
}

const AdminVideoUploadContext = createContext<AdminVideoUploadContextValue | undefined>(
  undefined,
)

const uploadFileWithProgress = ({
  file,
  uploadUrl,
  headers,
  onProgress,
}: {
  file: File
  uploadUrl: string
  headers: Record<string, string>
  onProgress: (percent: number | null) => void
}) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', uploadUrl)

    Object.entries(headers).forEach(([name, value]) => {
      request.setRequestHeader(name, value)
    })

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        onProgress(null)
        return
      }

      const percent = Math.min(100, Math.max(0, (event.loaded / event.total) * 100))
      onProgress(percent)
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve()
        return
      }

      reject(new Error('Failed to upload video to storage.'))
    }

    request.onerror = () => {
      reject(new Error('Failed to upload video to storage.'))
    }

    request.onabort = () => {
      reject(new Error('Video upload was canceled.'))
    }

    request.send(file)
  })

export function AdminVideoUploadProvider({ children }: { children: ReactNode }) {
  const [uploadsByTranscript, setUploadsByTranscript] = useState<
    Record<string, AdminVideoUploadState>
  >({})
  const uploadsRef = useRef<Record<string, AdminVideoUploadState>>({})

  useEffect(() => {
    uploadsRef.current = uploadsByTranscript
  }, [uploadsByTranscript])

  const updateUploadState = useCallback(
    (
      transcriptId: string,
      updater: (
        current: AdminVideoUploadState | undefined,
      ) => AdminVideoUploadState | null,
    ) => {
      setUploadsByTranscript((current) => {
        const existing = current[transcriptId]
        const nextState = updater(existing)

        if (nextState === null) {
          if (!existing) {
            return current
          }

          const next = { ...current }
          delete next[transcriptId]
          return next
        }

        if (existing === nextState) {
          return current
        }

        return {
          ...current,
          [transcriptId]: nextState,
        }
      })
    },
    [],
  )

  const startVideoUpload = useCallback(
    async ({ transcriptId, transcriptTitle, file }: StartVideoUploadParams) => {
      const current = uploadsRef.current[transcriptId]
      if (current?.isUploading) {
        throw new Error('A video upload is already in progress for this transcript.')
      }

      const startedAt = Date.now()
      updateUploadState(transcriptId, () => ({
        transcriptId,
        transcriptTitle,
        isUploading: true,
        phase: 'preparing',
        progress: null,
        error: null,
        updatedAt: startedAt,
      }))

      try {
        const prepareResponse = await fetch('/api/admin/videos/upload-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcriptId,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
          }),
        })

        const preparePayload: SignedUploadResponse | null = await prepareResponse
          .json()
          .catch(() => null)

        if (
          !prepareResponse.ok ||
          !preparePayload?.success ||
          !preparePayload.uploadUrl ||
          !preparePayload.objectPath
        ) {
          const message = preparePayload?.error ?? 'Failed to prepare video upload.'
          throw new Error(message)
        }

        const uploadHeaders = preparePayload.requiredHeaders ?? {
          'Content-Type': file.type || 'application/octet-stream',
        }

        updateUploadState(transcriptId, (existing) => {
          if (!existing) {
            return null
          }

          return {
            ...existing,
            phase: 'uploading',
            progress: 0,
            updatedAt: Date.now(),
          }
        })

        await uploadFileWithProgress({
          file,
          uploadUrl: preparePayload.uploadUrl,
          headers: uploadHeaders,
          onProgress: (progress) => {
            updateUploadState(transcriptId, (existing) => {
              if (!existing || !existing.isUploading) {
                return null
              }

              if (existing.phase === 'uploading' && existing.progress === progress) {
                return existing
              }

              return {
                ...existing,
                phase: 'uploading',
                progress,
                updatedAt: Date.now(),
              }
            })
          },
        })

        updateUploadState(transcriptId, (existing) => {
          if (!existing) {
            return null
          }

          return {
            ...existing,
            phase: 'finalizing',
            progress: 100,
            updatedAt: Date.now(),
          }
        })

        const finalizeResponse = await fetch('/api/admin/videos/upload-complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcriptId,
            objectPath: preparePayload.objectPath,
          }),
        })

        const finalizePayload: UploadResponse | null = await finalizeResponse
          .json()
          .catch(() => null)

        if (!finalizeResponse.ok || !finalizePayload?.success || !finalizePayload.video) {
          const message = finalizePayload?.error ?? 'Failed to upload video.'
          throw new Error(message)
        }

        updateUploadState(transcriptId, () => null)
        return finalizePayload.video
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to upload video.'
        updateUploadState(transcriptId, (existing) => ({
          transcriptId,
          transcriptTitle: existing?.transcriptTitle ?? transcriptTitle,
          isUploading: false,
          phase: null,
          progress: null,
          error: message,
          updatedAt: Date.now(),
        }))
        throw error
      }
    },
    [updateUploadState],
  )

  const value = useMemo(
    () => ({
      uploadsByTranscript,
      startVideoUpload,
    }),
    [startVideoUpload, uploadsByTranscript],
  )

  return (
    <AdminVideoUploadContext.Provider value={value}>
      {children}
    </AdminVideoUploadContext.Provider>
  )
}

export function useAdminVideoUpload() {
  const context = useContext(AdminVideoUploadContext)
  if (!context) {
    throw new Error('useAdminVideoUpload must be used within AdminVideoUploadProvider')
  }
  return context
}
