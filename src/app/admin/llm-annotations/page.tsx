'use client'

import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  Download,
  FileText,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Paperclip,
  Eye,
  X,
} from 'lucide-react'
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
  llm_annotation_gcs_path: string | null
}

type TranscriptPayload = {
  id: string
  title: string
  grade?: string | null
  transcript_file_name?: string | null
  annotation_file_name?: string | null
  llm_annotation?: boolean
  llm_annotation_gcs_path?: string | null
}

type TranscriptsResponse = {
  success: boolean
  transcripts?: TranscriptPayload[]
  error?: string
}

type LlmAnnotationSettings = {
  scope: 'all' | 'range'
  startLine: string
  endLine: string
  prompt: string
}

const SAMPLE_VISIBILITY_ANNOTATORS = [
  { id: 'annotator-1', name: 'Jordan Lee', defaultVisibility: 'after' },
  { id: 'annotator-2', name: 'Riley Chen', defaultVisibility: 'always' },
  { id: 'annotator-3', name: 'Morgan Patel', defaultVisibility: 'hide' },
]

const DEFAULT_LLM_SETTINGS: LlmAnnotationSettings = {
  scope: 'all',
  startLine: '',
  endLine: '',
  prompt: '',
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

export default function LlmAnnotationsPage() {
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [generatedTranscriptIds, setGeneratedTranscriptIds] = useState<Set<string>>(() => new Set())
  const [downloadingTranscriptId, setDownloadingTranscriptId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [attachingTranscriptId, setAttachingTranscriptId] = useState<string | null>(null)
  const [attachError, setAttachError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [settingsTranscript, setSettingsTranscript] = useState<TranscriptRecord | null>(null)
  const [visibilityTranscript, setVisibilityTranscript] = useState<TranscriptRecord | null>(null)
  const [llmSettingsByTranscriptId, setLlmSettingsByTranscriptId] = useState<
    Record<string, LlmAnnotationSettings>
  >({})

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

        if (isCancelled) return

        const normalized: TranscriptRecord[] = (payload.transcripts ?? []).map((transcript) => ({
          id: transcript.id,
          title: transcript.title,
          grade: transcript.grade?.trim() || null,
          transcript_file_name: transcript.transcript_file_name ?? null,
          annotation_file_name: transcript.annotation_file_name ?? null,
          llm_annotation: Boolean(transcript.llm_annotation),
          llm_annotation_gcs_path: transcript.llm_annotation_gcs_path ?? null,
        }))
        setTranscripts(normalized)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load transcripts', error)
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load transcripts.'
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

  const filteredTranscripts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return transcripts
    return transcripts.filter((transcript) => {
      const titleMatch = transcript.title.toLowerCase().includes(query)
      const fileMatch = (transcript.transcript_file_name ?? '').toLowerCase().includes(query)
      return titleMatch || fileMatch
    })
  }, [searchQuery, transcripts])

  const handleGenerate = (transcriptId: string) => {
    setGenerateError(null)
    setGeneratedTranscriptIds((current) => {
      const next = new Set(current)
      next.add(transcriptId)
      return next
    })
  }

  const handleDownload = async (transcriptId: string) => {
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
      console.error('Failed to download LLM annotations', error)
      setDownloadError({
        transcriptId,
        message: error instanceof Error ? error.message : 'Failed to download LLM annotations.',
      })
    } finally {
      setDownloadingTranscriptId(null)
    }
  }

  const handleAttachFile = async (transcriptId: string, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) {
      return
    }

    setAttachError(null)

    const validation = await validateTranscriptSpreadsheet(file)
    if (!validation.isValid) {
      setAttachError({
        transcriptId,
        message: validation.error ?? SPREADSHEET_FILE_ERROR_MESSAGE,
      })
      input.value = ''
      return
    }

    setAttachingTranscriptId(transcriptId)

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
            : 'Failed to attach generated file.'
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
                llm_annotation_gcs_path:
                  typeof payload?.llm_annotation_gcs_path === 'string'
                    ? payload.llm_annotation_gcs_path
                    : transcript.llm_annotation_gcs_path,
              }
            : transcript,
        ),
      )
    } catch (error) {
      console.error('Failed to attach LLM annotation', error)
      const message =
        error instanceof Error ? error.message : 'Failed to attach generated file.'
      setAttachError({ transcriptId, message })
    } finally {
      setAttachingTranscriptId(null)
      input.value = ''
    }
  }

  const updateLlmSettings = (transcriptId: string, updates: Partial<LlmAnnotationSettings>) => {
    setLlmSettingsByTranscriptId((previous) => {
      const current = previous[transcriptId] ?? DEFAULT_LLM_SETTINGS
      return {
        ...previous,
        [transcriptId]: {
          ...current,
          ...updates,
        },
      }
    })
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">LLM Annotations</h1>
        <p className="text-gray-600 mt-2">
          Generate, review, and attach LLM reference annotations.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Sparkles className="w-5 h-5 text-primary-600" />
            LLM-generated files can be attached to transcripts for reference.
          </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredTranscripts.map((transcript) => {
          const hasAttachment = Boolean(
            transcript.llm_annotation_gcs_path || transcript.annotation_file_name || transcript.llm_annotation,
          )
          const isGenerated = hasAttachment || generatedTranscriptIds.has(transcript.id)
          const isDownloading = downloadingTranscriptId === transcript.id
          const isAttaching = attachingTranscriptId === transcript.id
          const attachErrorMessage =
            attachError?.transcriptId === transcript.id ? attachError.message : null
          const downloadErrorMessage =
            downloadError?.transcriptId === transcript.id ? downloadError.message : null
          const generateErrorMessage =
            generateError?.transcriptId === transcript.id ? generateError.message : null

          return (
            <div
              key={transcript.id}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow border border-gray-200"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {transcript.title}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {transcript.transcript_file_name ?? 'No transcript file name provided'}
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                  <span className="font-medium">Grade:</span>
                  <span>{transcript.grade?.trim() || 'Not provided'}</span>
                </div>
              </div>

              <div className="mb-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                      hasAttachment
                        ? 'bg-green-100 text-green-700'
                        : isGenerated
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    {hasAttachment
                      ? 'LLM file available'
                      : isGenerated
                        ? 'Generation in progress'
                        : 'LLM file not generated'}
                  </span>
                </div>

                {transcript.annotation_file_name && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary-600" />
                        <span className="text-sm font-medium text-gray-700">
                          {transcript.annotation_file_name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">LLM Annotation File</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t border-gray-200">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setSettingsTranscript(transcript)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span className="text-sm font-medium">Settings</span>
                  </button>

                  <button
                    onClick={() => handleGenerate(transcript.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="text-sm font-medium">Generate LLM Annotations</span>
                  </button>

                </div>

                {isGenerated && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleDownload(transcript.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        hasAttachment
                          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      } ${isDownloading ? 'opacity-70 cursor-not-allowed' : ''}`}
                      disabled={isDownloading || !hasAttachment}
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {isDownloading ? 'Downloading...' : 'Download'}
                      </span>
                    </button>
                    <div>
                      <input
                        type="file"
                        id={`replace-llm-${transcript.id}`}
                        className="hidden"
                        accept={SPREADSHEET_ACCEPT}
                        onChange={(event) => handleAttachFile(transcript.id, event)}
                        disabled={isAttaching}
                      />
                      <label
                        htmlFor={`replace-llm-${transcript.id}`}
                        className={`inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer ${
                          isAttaching ? 'opacity-70 pointer-events-none' : ''
                        }`}
                      >
                        <Paperclip className="w-4 h-4" />
                        <span className="text-sm font-medium">
                          {isAttaching ? 'Replacing...' : 'Replace'}
                        </span>
                      </label>
                    </div>
                    <button
                      onClick={() => setVisibilityTranscript(transcript)}
                      className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      <span className="text-sm font-medium">Annotation Visibility</span>
                    </button>
                  </div>
                )}

                {generateErrorMessage && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    {generateErrorMessage}
                  </p>
                )}
                {downloadErrorMessage && (
                  <p className="text-xs text-red-600">{downloadErrorMessage}</p>
                )}
                {attachErrorMessage && (
                  <p className="text-xs text-red-600">{attachErrorMessage}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!isLoading && filteredTranscripts.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm">
          <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No transcripts found
          </h3>
          <p className="text-gray-600">
            {searchQuery ? 'Try adjusting your search' : 'Upload your first transcript to get started'}
          </p>
        </div>
      )}

      {visibilityTranscript && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setVisibilityTranscript(null)}
          />

          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl transform transition-all">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Annotation Modal Setting
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Control when LLM-generated annotations are visible to each annotator
                  </p>
                </div>
                <button
                  onClick={() => setVisibilityTranscript(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6">
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm text-gray-700">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Annotator</th>
                        <th className="px-4 py-3 text-center font-semibold">Hide</th>
                        <th className="px-4 py-3 text-center font-semibold">After Completion</th>
                        <th className="px-4 py-3 text-center font-semibold">Always Show</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {SAMPLE_VISIBILITY_ANNOTATORS.map((annotator) => (
                        <tr key={annotator.id} className="bg-white">
                          <td className="px-4 py-4 font-medium text-gray-900">
                            {annotator.name}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <input
                              type="radio"
                              name={`visibility-${annotator.id}`}
                              defaultChecked={annotator.defaultVisibility === 'hide'}
                              className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                              aria-label={`Hide LLM annotations for ${annotator.name}`}
                            />
                          </td>
                          <td className="px-4 py-4 text-center">
                            <input
                              type="radio"
                              name={`visibility-${annotator.id}`}
                              defaultChecked={annotator.defaultVisibility === 'after'}
                              className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                              aria-label={`Show LLM annotations after completion for ${annotator.name}`}
                            />
                          </td>
                          <td className="px-4 py-4 text-center">
                            <input
                              type="radio"
                              name={`visibility-${annotator.id}`}
                              defaultChecked={annotator.defaultVisibility === 'always'}
                              className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                              aria-label={`Always show LLM annotations for ${annotator.name}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-gray-200 p-6 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setVisibilityTranscript(null)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setVisibilityTranscript(null)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsTranscript && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setSettingsTranscript(null)}
          />

          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg transform transition-all">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">LLM Settings</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {settingsTranscript.title}
                  </p>
                </div>
                <button
                  onClick={() => setSettingsTranscript(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">Transcript line selection</p>
                  <p className="text-xs text-gray-600 mt-1">
                    Choose whether to annotate the full transcript or a specific line range.
                  </p>

                  <div className="mt-4 space-y-3">
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="llm-line-scope"
                        checked={
                          (llmSettingsByTranscriptId[settingsTranscript.id]?.scope ??
                            DEFAULT_LLM_SETTINGS.scope) === 'all'
                        }
                        onChange={() => updateLlmSettings(settingsTranscript.id, { scope: 'all' })}
                        className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                      />
                      Annotate all lines
                    </label>
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="llm-line-scope"
                        checked={
                          (llmSettingsByTranscriptId[settingsTranscript.id]?.scope ??
                            DEFAULT_LLM_SETTINGS.scope) === 'range'
                        }
                        onChange={() => updateLlmSettings(settingsTranscript.id, { scope: 'range' })}
                        className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                      />
                      Annotate a line range
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="text-xs text-gray-600">
                        Start line
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={llmSettingsByTranscriptId[settingsTranscript.id]?.startLine ?? ''}
                          onChange={(event) =>
                            updateLlmSettings(settingsTranscript.id, { startLine: event.target.value })
                          }
                          disabled={
                            (llmSettingsByTranscriptId[settingsTranscript.id]?.scope ??
                              DEFAULT_LLM_SETTINGS.scope) !== 'range'
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400"
                          placeholder="e.g. 1"
                        />
                      </label>
                      <label className="text-xs text-gray-600">
                        End line
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={llmSettingsByTranscriptId[settingsTranscript.id]?.endLine ?? ''}
                          onChange={(event) =>
                            updateLlmSettings(settingsTranscript.id, { endLine: event.target.value })
                          }
                          disabled={
                            (llmSettingsByTranscriptId[settingsTranscript.id]?.scope ??
                              DEFAULT_LLM_SETTINGS.scope) !== 'range'
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400"
                          placeholder="e.g. 120"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-900">
                    LLM prompt
                    <textarea
                      value={llmSettingsByTranscriptId[settingsTranscript.id]?.prompt ?? ''}
                      onChange={(event) =>
                        updateLlmSettings(settingsTranscript.id, { prompt: event.target.value })
                      }
                      rows={5}
                      placeholder="Describe how the LLM should annotate the transcript..."
                      className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    This prompt is used when generating annotations for the selected lines.
                  </p>
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    onClick={() => setSettingsTranscript(null)}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setSettingsTranscript(null)}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Save settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
