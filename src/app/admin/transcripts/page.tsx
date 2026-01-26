'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { Search, Upload, FileText, Download, Trash2, BookOpen } from 'lucide-react'
import UploadTranscriptModal from '@/components/admin/UploadTranscriptModal'
import UploadInstructionMaterialsModal from '@/components/admin/UploadInstructionMaterialsModal'
import {
  SPREADSHEET_ACCEPT,
  SPREADSHEET_FILE_ERROR_MESSAGE,
  validateTranscriptSpreadsheet,
} from '@/utils/transcriptFileValidation'

type TranscriptRecord = {
  id: string
  title: string
  grade: string | null
  transcript_file_name: string | null
  annotation_file_name: string | null
  llm_annotation: boolean
  assigned_users: { id: string; name: string; username: string }[]
}

type TranscriptsResponse = {
  success: boolean
  transcripts?: Array<Omit<TranscriptRecord, 'assigned_users'> & { assigned_users?: TranscriptRecord['assigned_users'] }>
  error?: string
}

const parseFileNameFromContentDisposition = (header: string | null) => {
  if (!header) {
    return null
  }

  const filenameStarMatch = header.match(/filename\*=(?:UTF-8''|)([^;]+)/i)
  if (filenameStarMatch?.[1]) {
    const cleaned = filenameStarMatch[1].replace(/["']/g, '').trim()
    try {
      return decodeURIComponent(cleaned)
    } catch {
      return cleaned
    }
  }

  const filenameMatch = header.match(/filename="?([^";]+)"?/i)
  return filenameMatch?.[1]?.trim() ?? null
}

const buildZipFileName = (title?: string) => {
  const safeBase =
    title?.trim().replace(/[/\\]/g, '-').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase() ||
    'transcript-files'
  return safeBase.endsWith('.zip') ? safeBase : `${safeBase}.zip`
}

const buildDeleteErrorMessage = (payload: any) => {
  const code = typeof payload?.code === 'string' ? payload.code : undefined

  if (code === 'HAS_INSTRUCTIONAL_MATERIALS') {
    const titles = Array.isArray(payload?.materials)
      ? payload.materials
          .map((item: any) => {
            const value = typeof item?.title === 'string' ? item.title.trim() : ''
            return value || null
          })
          .filter((value: string | null): value is string => Boolean(value))
      : []
    const count = Array.isArray(payload?.materials) ? payload.materials.length : 0
    const descriptor =
      count > 0 ? `${count} instructional material${count === 1 ? '' : 's'}` : 'instructional materials'
    const titlesText = titles.length > 0 ? ` (${titles.join(', ')})` : ''
    return `Delete the ${descriptor}${titlesText} linked to this transcript before deleting it.`
  }

  if (code === 'HAS_ASSIGNMENTS') {
    const names = Array.isArray(payload?.assignments)
      ? payload.assignments
          .map((item: any) => {
            const nameCandidate =
              typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : null
            const usernameCandidate =
              typeof item?.username === 'string' && item.username.trim()
                ? item.username.trim()
                : null
            return nameCandidate || usernameCandidate
          })
          .filter((value: string | null): value is string => Boolean(value))
      : []
    const nameText = names.length > 0 ? ` (${names.join(', ')})` : ''
    return `Remove annotator assignments${nameText} before deleting this transcript.`
  }

  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error
  }

  return 'Failed to delete transcript.'
}

export default function TranscriptsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [instructionMaterialsTranscript, setInstructionMaterialsTranscript] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [uploadingTranscriptId, setUploadingTranscriptId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [downloadingTranscriptId, setDownloadingTranscriptId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [deletingTranscriptId, setDeletingTranscriptId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{ transcriptId: string; message: string } | null>(null)

  const handleTranscriptUploaded = (transcript: {
    id: string
    title: string
    grade: string | null
    transcript_file_name: string | null
    annotation_file_name: string | null
  }) => {
    setTranscripts((previous) => {
      const normalized: TranscriptRecord = {
        ...transcript,
        grade: transcript.grade?.trim() || null,
        transcript_file_name: transcript.transcript_file_name ?? null,
        annotation_file_name: transcript.annotation_file_name ?? null,
        llm_annotation: Boolean(transcript.annotation_file_name),
        assigned_users: [],
      }

      const alreadyExists = previous.some((item) => item.id === transcript.id)
      if (alreadyExists) {
        return previous.map((item) =>
          item.id === transcript.id ? { ...normalized, assigned_users: item.assigned_users } : item,
        )
      }

      return [normalized, ...previous]
    })
  }

  useEffect(() => {
    let isCancelled = false
    const controller = new AbortController()

    const fetchTranscripts = async () => {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const response = await fetch('/api/admin/transcripts', {
          signal: controller.signal,
        })
        const payload: TranscriptsResponse | null = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          const message = payload?.error ?? 'Failed to load transcripts.'
          throw new Error(message)
        }

        if (!isCancelled) {
          const normalized: TranscriptRecord[] = (payload.transcripts ?? []).map((transcript) => ({
            ...transcript,
            grade: transcript.grade?.trim() || null,
            transcript_file_name: transcript.transcript_file_name ?? null,
            annotation_file_name: transcript.annotation_file_name ?? null,
            llm_annotation: Boolean(transcript.llm_annotation),
            assigned_users: transcript.assigned_users ?? [],
          }))
          setTranscripts(normalized)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load transcripts', error)
        if (!isCancelled) {
          const message =
            error instanceof Error ? error.message : 'Unable to load transcripts right now.'
          setErrorMessage(message)
          setTranscripts([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchTranscripts()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [])

  const handleDeleteTranscript = async (transcriptId: string) => {
    const transcript = transcripts.find((item) => item.id === transcriptId)
    const confirmMessage = transcript?.title
      ? `Delete transcript "${transcript.title}"? This will remove its files from cloud storage.`
      : 'Delete this transcript? This will remove its files from cloud storage.'

    if (!window.confirm(confirmMessage)) {
      return
    }

    setDeleteError(null)
    setDeletingTranscriptId(transcriptId)

    try {
      const response = await fetch(
        `/api/admin/transcripts/${encodeURIComponent(transcriptId)}?transcriptId=${encodeURIComponent(transcriptId)}`,
        { method: 'DELETE' },
      )
      const payload = await response.json().catch(() => null)

      if (!response.ok || payload?.success === false) {
        const message = buildDeleteErrorMessage(payload)
        throw new Error(message)
      }

      if (Array.isArray(payload?.storageErrors) && payload.storageErrors.length > 0) {
        console.warn(
          'Transcript deleted but some storage objects could not be removed',
          payload.storageErrors,
        )
      }

      setTranscripts((previous) =>
        previous.filter((item) => item.id !== transcriptId),
      )
    } catch (error) {
      console.error('Failed to delete transcript', error)
      const message = error instanceof Error ? error.message : 'Failed to delete transcript.'
      setDeleteError({ transcriptId, message })
    } finally {
      setDeletingTranscriptId(null)
    }
  }

  const handleAssociatedFileUpload = async (transcriptId: string, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) {
      return
    }

    setUploadError(null)

    const validation = await validateTranscriptSpreadsheet(file)
    if (!validation.isValid) {
      setUploadError({
        transcriptId,
        message: validation.error ?? SPREADSHEET_FILE_ERROR_MESSAGE,
      })
      input.value = ''
      return
    }

    setUploadingTranscriptId(transcriptId)

    try {
      const formData = new FormData()
      formData.append('transcriptId', transcriptId)
      formData.append('associatedFile', file)

      const response = await fetch(`/api/admin/transcripts/${transcriptId}/associated`, {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok || payload?.success === false) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to upload associated file.'
        throw new Error(message)
      }

      const annotationFileName =
        typeof payload?.annotation_file_name === 'string' && payload.annotation_file_name
          ? payload.annotation_file_name
          : file.name

      setTranscripts((previous) =>
        previous.map((transcript) =>
          transcript.id === transcriptId
            ? {
                ...transcript,
                annotation_file_name: annotationFileName,
                llm_annotation: true,
              }
            : transcript,
        ),
      )
    } catch (error) {
      console.error('Failed to upload associated file', error)
      const message =
        error instanceof Error ? error.message : 'Failed to upload associated file.'
      setUploadError({ transcriptId, message })
    } finally {
      setUploadingTranscriptId(null)
      input.value = ''
    }
  }

  const handleDownloadTranscript = async (transcriptId: string) => {
    setDownloadError(null)
    setDownloadingTranscriptId(transcriptId)

    try {
      const transcript = transcripts.find((item) => item.id === transcriptId)
      const response = await fetch(
        `/api/admin/transcripts/${transcriptId}/download?transcriptId=${encodeURIComponent(transcriptId)}`,
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to generate download link.'
        throw new Error(message)
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition')
      const suggestedName =
        parseFileNameFromContentDisposition(contentDisposition) ??
        buildZipFileName(transcript?.title)

      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = suggestedName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.error('Failed to download transcript', error)
      setDownloadError({
        transcriptId,
        message: error instanceof Error ? error.message : 'Failed to download transcript.',
      })
    } finally {
      setDownloadingTranscriptId(null)
    }
  }

  const filteredTranscripts = transcripts.filter((t) =>
    t.title.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Transcripts</h1>
        <p className="text-gray-600 mt-2">Manage and review all transcripts</p>
      </div>

      {/* Top Actions Bar */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm font-medium"
          >
            <Upload className="w-5 h-5" />
            Upload New Transcript
          </button>

          <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
            {/* Search Bar */}
            <div className="relative flex-1 lg:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search transcripts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {errorMessage}
        </div>
      )}

      {isLoading && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-700">
          Loading transcripts...
        </div>
      )}

      {/* Transcripts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredTranscripts.map((transcript) => {
          const isUploadingAssociated = uploadingTranscriptId === transcript.id
          const associatedError =
            uploadError?.transcriptId === transcript.id ? uploadError.message : null
          const isDeleting = deletingTranscriptId === transcript.id

          return (
            <div
              key={transcript.id}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow border border-gray-200"
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {transcript.title}
                </h3>
                <div className="inline-flex items-center gap-2 px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                  <span className="font-medium">Grade:</span>
                  <span>{transcript.grade?.trim() || 'Not provided'}</span>
                </div>
              </div>

              {/* Files */}
              <div className="mb-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary-600" />
                      <span className="text-sm font-medium text-gray-700">
                        {transcript.transcript_file_name ?? 'No transcript file name provided'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Transcript File</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {transcript.annotation_file_name ? (
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary-600" />
                        <span className="text-sm font-medium text-gray-700">
                          {transcript.annotation_file_name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Annotation File</p>
                    </div>
                  ) : (
                    <div className="flex-1 relative">
                      <input
                        type="file"
                        id={`associated-file-${transcript.id}`}
                        className="hidden"
                        onChange={(e) => handleAssociatedFileUpload(transcript.id, e)}
                        accept={SPREADSHEET_ACCEPT}
                        disabled={isUploadingAssociated}
                      />
                      <label
                        htmlFor={`associated-file-${transcript.id}`}
                        className={`block border-2 border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 hover:bg-gray-100 hover:border-primary-400 cursor-pointer transition-all ${
                          isUploadingAssociated ? 'opacity-70 pointer-events-none' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Upload className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">
                            {isUploadingAssociated
                              ? 'Uploading associated file...'
                              : 'Click to upload associated file'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">CSV, XLS, XLSX only</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Required columns: Line number (or #), Speaker, and Dialogue (or Utterance).
                        </p>
                      </label>
                      {associatedError && (
                        <p className="text-xs text-red-600 mt-2">{associatedError}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Annotators */}
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Annotators Assigned:
                </p>
                {transcript.assigned_users.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {transcript.assigned_users.map((annotator) => {
                      const label = annotator.name || annotator.username
                      return (
                        <span
                          key={annotator.id}
                          className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm"
                        >
                          {label || 'Unnamed user'}
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No annotators assigned</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadTranscript(transcript.id)}
                    className={`flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors ${
                      downloadingTranscriptId === transcript.id ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                    disabled={downloadingTranscriptId === transcript.id}
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      {downloadingTranscriptId === transcript.id ? 'Downloading...' : 'Download'}
                    </span>
                  </button>

                  <button
                    onClick={() => handleDeleteTranscript(transcript.id)}
                    className={`flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors ${
                      isDeleting ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                    disabled={isDeleting}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </span>
                  </button>
                </div>

                <button
                  onClick={() => setInstructionMaterialsTranscript(transcript.id)}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors border border-purple-200"
                  title="Upload instruction materials"
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="text-sm font-medium">Upload Instruction Materials</span>
                </button>

                {downloadError?.transcriptId === transcript.id && (
                  <p className="text-xs text-red-600">{downloadError.message}</p>
                )}
                {deleteError?.transcriptId === transcript.id && (
                  <p className="text-xs text-red-600">{deleteError.message}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {!isLoading && filteredTranscripts.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm">
          <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No transcripts found
          </h3>
          <p className="text-gray-600">
            {searchQuery
              ? 'Try adjusting your search'
              : 'Upload your first transcript to get started'}
          </p>
        </div>
      )}

      {/* Upload Modal */}
      <UploadTranscriptModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploaded={handleTranscriptUploaded}
      />

      {/* Upload Instruction Materials Modal */}
      {instructionMaterialsTranscript !== null && (
        <UploadInstructionMaterialsModal
          isOpen={true}
          onClose={() => setInstructionMaterialsTranscript(null)}
          transcriptId={instructionMaterialsTranscript}
          transcriptName={
            transcripts.find(t => t.id === instructionMaterialsTranscript)?.title || ''
          }
        />
      )}
    </div>
  )
}
