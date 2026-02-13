'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Upload, Video } from 'lucide-react'
import { useAdminVideoUpload, type SectionVideo } from '@/context/AdminVideoUploadContext'

type TranscriptRecord = {
  id: string
  title: string
  grade: string | null
  transcript_file_name: string | null
  video: SectionVideo | null
}

type VideosResponse = {
  success: boolean
  transcripts?: TranscriptRecord[]
  error?: string
}

type DeleteResponse = {
  success: boolean
  transcriptId?: string
  video?: SectionVideo | null
  error?: string
}

const formatUploadTime = (value: string | null) => {
  if (!value) return 'Unknown upload time'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown upload time'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

export default function VideosPage() {
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deletingSections, setDeletingSections] = useState<Set<string>>(
    () => new Set(),
  )
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({})
  const { startVideoUpload, uploadsByTranscript } = useAdminVideoUpload()

  const refreshTranscripts = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/videos', {
        cache: 'no-store',
      })
      const payload: VideosResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success || !payload.transcripts) {
        return
      }

      setTranscripts(payload.transcripts)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to refresh transcript videos after upload', error)
    }
  }, [])

  useEffect(() => {
    let isCancelled = false
    const controller = new AbortController()

    const fetchVideos = async () => {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const response = await fetch('/api/admin/videos', {
          signal: controller.signal,
          cache: 'no-store',
        })
        const payload: VideosResponse | null = await response.json().catch(() => null)

        if (!response.ok || !payload?.success || !payload.transcripts) {
          const message = payload?.error ?? 'Failed to load transcript videos.'
          throw new Error(message)
        }

        if (!isCancelled) {
          setTranscripts(payload.transcripts)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load transcript videos', error)
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load videos.'
          setErrorMessage(message)
          setTranscripts([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchVideos()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [])

  const filteredTranscripts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return transcripts
    return transcripts.filter((transcript) => {
      const titleMatch = transcript.title.toLowerCase().includes(query)
      const fileMatch = (transcript.transcript_file_name ?? '')
        .toLowerCase()
        .includes(query)
      return titleMatch || fileMatch
    })
  }, [searchQuery, transcripts])

  const handleDelete = async (transcriptId: string) => {
    const key = transcriptId

    setDeleteErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })

    setDeletingSections((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })

    try {
      const query = new URLSearchParams({ transcriptId })
      const response = await fetch(`/api/admin/videos?${query.toString()}`, {
        method: 'DELETE',
      })

      const payload: DeleteResponse | null = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to delete video.'
        throw new Error(message)
      }

      setTranscripts((current) =>
        current.map((transcript) => {
          if (transcript.id !== transcriptId) return transcript
          return { ...transcript, video: null }
        }),
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to delete video.'
      setDeleteErrors((current) => ({
        ...current,
        [key]: message,
      }))
    } finally {
      setDeletingSections((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const handleFileChange = (
    transcriptId: string,
    transcriptTitle: string,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    void startVideoUpload({
      transcriptId,
      transcriptTitle,
      file,
    })
      .then((video) => {
        setTranscripts((current) =>
          current.map((transcript) => {
            if (transcript.id !== transcriptId) return transcript
            return { ...transcript, video }
          }),
        )

        void refreshTranscripts()
      })
      .catch(() => {
        // Upload errors are surfaced through shared admin upload state.
      })
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Videos</h1>
          <p className="text-sm text-gray-500">
            Upload one video for each transcript.
          </p>
        </div>
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search transcripts..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading transcripts...
        </div>
      ) : errorMessage ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : filteredTranscripts.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500 shadow-sm">
          No transcripts found.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredTranscripts.map((transcript) => {
            const key = transcript.id
            const uploadState = uploadsByTranscript[key]
            const isUploading = uploadState?.isUploading ?? false
            const isDeleting = deletingSections.has(key)
            const uploadError = uploadState?.error ?? null
            const deleteError = deleteErrors[key]
            const uploadPhase = uploadState?.phase
            const uploadProgress = uploadState?.progress
            const uploadProgressPercent =
              typeof uploadProgress === 'number' ? Math.round(uploadProgress) : null

            return (
              <div
                key={transcript.id}
                className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
              >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary-50 p-2">
                      <Video className="h-5 w-5 text-primary-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {transcript.title}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {transcript.grade ? `Grade ${transcript.grade}` : 'Grade not set'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Transcript file:{' '}
                    <span className="font-medium text-gray-700">
                      {transcript.transcript_file_name ?? 'Unknown'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Transcript video</p>
                    <p className="text-xs text-gray-500">
                      {transcript.video
                        ? 'One video associated with this transcript.'
                        : 'No video uploaded yet.'}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500">
                    {transcript.video ? (
                      <div>
                        <p className="font-medium text-gray-700">
                          {transcript.video.file_name}
                        </p>
                        <p>{formatUploadTime(transcript.video.uploaded_at)}</p>
                      </div>
                    ) : (
                      null
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition-all duration-150 hover:border-primary-200 hover:text-primary-700 ${
                      isUploading || isDeleting ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    {transcript.video ? 'Replace video' : 'Upload video'}
                    <input
                      type="file"
                      accept="video/*"
                      className="sr-only"
                      disabled={isUploading || isDeleting}
                      onChange={(event) =>
                        handleFileChange(transcript.id, transcript.title, event)
                      }
                    />
                  </label>
                  {transcript.video ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!transcript.video) return
                        const confirmed = window.confirm(
                          'Delete this transcript video? This cannot be undone.',
                        )
                        if (confirmed) {
                          void handleDelete(transcript.id)
                        }
                      }}
                      disabled={isUploading || isDeleting}
                      className={`inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 shadow-sm transition-all duration-150 hover:border-red-300 hover:text-red-700 ${
                        isUploading || isDeleting ? 'cursor-not-allowed opacity-60' : ''
                      }`}
                    >
                      Delete video
                    </button>
                  ) : null}
                  <p className="text-xs text-gray-500">
                    {isUploading
                      ? uploadPhase === 'preparing'
                        ? 'Preparing upload...'
                        : uploadPhase === 'finalizing'
                        ? 'Finalizing upload...'
                        : uploadProgressPercent === null
                        ? 'Uploading video...'
                        : `Uploading video... ${uploadProgressPercent}%`
                      : isDeleting
                      ? 'Deleting video...'
                      : transcript.video
                      ? ''
                      : 'Select a video file to upload.'}
                  </p>
                </div>
                {isUploading && uploadPhase === 'uploading' ? (
                  <div className="mt-3">
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={uploadProgressPercent ?? undefined}
                      aria-label="Video upload progress"
                    >
                      <div
                        className={`h-full rounded-full bg-primary-500 transition-all duration-200 ${
                          uploadProgressPercent === null ? 'w-1/3 animate-pulse' : ''
                        }`}
                        style={
                          uploadProgressPercent === null
                            ? undefined
                            : { width: `${uploadProgressPercent}%` }
                        }
                      />
                    </div>
                  </div>
                ) : null}
                {uploadError ? (
                  <p className="mt-2 text-xs text-red-600">{uploadError}</p>
                ) : null}
                {deleteError ? (
                  <p className="mt-2 text-xs text-red-600">{deleteError}</p>
                ) : null}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
