'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  FileText,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Eye,
  Trash2,
  X,
} from 'lucide-react'

type LlmAnnotationVisibilityDefault = 'hidden' | 'visible_after_completion' | 'always_visible'
type LlmAnnotationStatus = 'not_generated' | 'in_process' | 'generated'

type TranscriptRecord = {
  id: string
  title: string
  grade: string | null
  transcript_file_name: string | null
  annotation_file_name: string | null
  llm_annotation: LlmAnnotationStatus
  llm_annotation_visibility_default: LlmAnnotationVisibilityDefault
  llm_annotation_visibility_per_annotator: boolean
  llm_annotation_gcs_path: string | null
  has_llm_notes: boolean
  assigned_users: AssignedAnnotator[]
}

type TranscriptPayload = {
  id: string
  title: string
  grade?: string | null
  transcript_file_name?: string | null
  annotation_file_name?: string | null
  llm_annotation?: LlmAnnotationStatus | null
  llm_annotation_visibility_default?: LlmAnnotationVisibilityDefault | null
  llm_annotation_visibility_per_annotator?: boolean | null
  llm_annotation_gcs_path?: string | null
  has_llm_notes?: boolean
  assigned_users?: Array<{
    id?: string
    name?: string | null
    username?: string | null
    llm_annotation_visibility_admin?: LlmAnnotationVisibilityDefault | null
  }>
}

type TranscriptsResponse = {
  success: boolean
  transcripts?: TranscriptPayload[]
  error?: string
}

type LlmNotePromptsPayload = {
  note_creation_prompt: string
  note_assignment_prompt: string
  annotate_all_lines: boolean
  range_start_line: number | null
  range_end_line: number | null
}

type LlmNotePromptsResponse = {
  success: boolean
  settings?: LlmNotePromptsPayload | null
  error?: string
}

type GenerateLlmNotesResponse = {
  success: boolean
  notesCreated?: number
  error?: string
}

type DeleteLlmNotesResponse = {
  success: boolean
  notesDeleted?: number
  error?: string
}

type SaveVisibilityResponse = {
  success: boolean
  defaultVisibility?: LlmAnnotationVisibilityDefault
  perAnnotator?: boolean
  annotatorVisibility?: Record<string, LlmAnnotationVisibilityDefault>
  error?: string
}

type LlmAnnotationSettings = {
  scope: 'all' | 'range'
  startLine: string
  endLine: string
  noteCreationPrompt: string
  noteAssignmentPrompt: string
}

type AnnotatorVisibility = 'never' | 'after' | 'always'

type AssignedAnnotator = {
  id: string
  name: string | null
  username: string | null
  llm_annotation_visibility_admin: LlmAnnotationVisibilityDefault | null
}

const DEFAULT_LLM_SETTINGS: LlmAnnotationSettings = {
  scope: 'all',
  startLine: '',
  endLine: '',
  noteCreationPrompt: '',
  noteAssignmentPrompt: '',
}

const normalizeLlmSettings = (
  payload: LlmNotePromptsPayload | null | undefined,
): LlmAnnotationSettings => {
  if (!payload) {
    return DEFAULT_LLM_SETTINGS
  }

  return {
    scope: payload.annotate_all_lines ? 'all' : 'range',
    startLine:
      typeof payload.range_start_line === 'number' ? String(payload.range_start_line) : '',
    endLine:
      typeof payload.range_end_line === 'number' ? String(payload.range_end_line) : '',
    noteCreationPrompt: payload.note_creation_prompt ?? '',
    noteAssignmentPrompt: payload.note_assignment_prompt ?? '',
  }
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
    title
      ?.trim()
      .replace(/[/\\]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .toLowerCase() || 'transcript-files'
  return safeBase.endsWith('.zip') ? safeBase : `${safeBase}.zip`
}

const buildLlmNotesFileName = (title?: string) => {
  const transcriptSegment =
    title
      ?.trim()
      .replace(/[/\\]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .toLowerCase() || 'transcript'

  const safeBase = `${transcriptSegment}-llm-notes`
  return safeBase.endsWith('.xlsx') ? safeBase : `${safeBase}.xlsx`
}

const buildAnnotatorVisibilityState = (
  annotators: AssignedAnnotator[],
  fallbackVisibility: AnnotatorVisibility,
  existing?: Record<string, AnnotatorVisibility>,
): Record<string, AnnotatorVisibility> =>
  annotators.reduce<Record<string, AnnotatorVisibility>>((acc, annotator) => {
    acc[annotator.id] = existing?.[annotator.id] ?? fallbackVisibility
    return acc
  }, {})

const mapDefaultVisibilityToUi = (
  value?: LlmAnnotationVisibilityDefault | null,
): AnnotatorVisibility => {
  switch (value) {
    case 'visible_after_completion':
      return 'after'
    case 'always_visible':
      return 'always'
    case 'hidden':
    default:
      return 'never'
  }
}

const parseVisibilityDefault = (
  value: unknown,
): LlmAnnotationVisibilityDefault | null => {
  if (value === 'hidden' || value === 'visible_after_completion' || value === 'always_visible') {
    return value
  }
  return null
}

const mapUiVisibilityToDefault = (
  value: AnnotatorVisibility,
): LlmAnnotationVisibilityDefault => {
  switch (value) {
    case 'after':
      return 'visible_after_completion'
    case 'always':
      return 'always_visible'
    case 'never':
    default:
      return 'hidden'
  }
}

const buildAnnotatorVisibilityOverrides = (
  annotators: AssignedAnnotator[],
): Record<string, AnnotatorVisibility> =>
  annotators.reduce<Record<string, AnnotatorVisibility>>((acc, annotator) => {
    if (annotator.llm_annotation_visibility_admin) {
      acc[annotator.id] = mapDefaultVisibilityToUi(
        annotator.llm_annotation_visibility_admin,
      )
    }
    return acc
  }, {})

const mergeAnnotatorVisibility = (
  annotators: AssignedAnnotator[],
  overrides?: Record<string, LlmAnnotationVisibilityDefault> | null,
): AssignedAnnotator[] => {
  if (!overrides) {
    return annotators
  }

  return annotators.map((annotator) => ({
    ...annotator,
    llm_annotation_visibility_admin:
      overrides[annotator.id] ?? annotator.llm_annotation_visibility_admin,
  }))
}

const normalizeAssignedUsers = (
  users?: TranscriptPayload['assigned_users'] | null,
): AssignedAnnotator[] => {
  if (!Array.isArray(users)) {
    return []
  }

  return users
    .map((user) => ({
      id: typeof user.id === 'string' ? user.id : '',
      name: typeof user.name === 'string' ? user.name.trim() || null : null,
      username: typeof user.username === 'string' ? user.username.trim() || null : null,
      llm_annotation_visibility_admin: parseVisibilityDefault(
        user.llm_annotation_visibility_admin,
      ),
    }))
    .filter((user) => user.id)
}

const getAnnotatorLabel = (annotator: AssignedAnnotator) =>
  annotator.name?.trim() || annotator.username?.trim() || 'Unnamed user'

export default function LlmAnnotationsPage() {
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [generatingTranscriptIds, setGeneratingTranscriptIds] = useState<Set<string>>(() => new Set())
  const [generateError, setGenerateError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [downloadingTranscriptId, setDownloadingTranscriptId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [deletingTranscriptIds, setDeletingTranscriptIds] = useState<Set<string>>(() => new Set())
  const [deleteError, setDeleteError] = useState<{ transcriptId: string; message: string } | null>(null)
  const [settingsTranscript, setSettingsTranscript] = useState<TranscriptRecord | null>(null)
  const [visibilityTranscript, setVisibilityTranscript] = useState<TranscriptRecord | null>(null)
  const [defaultVisibility, setDefaultVisibility] = useState<AnnotatorVisibility>('never')
  const [showAnnotatorOverrides, setShowAnnotatorOverrides] = useState(false)
  const [annotatorVisibility, setAnnotatorVisibility] = useState<Record<string, AnnotatorVisibility>>({})
  const [llmSettingsByTranscriptId, setLlmSettingsByTranscriptId] = useState<
    Record<string, LlmAnnotationSettings>
  >({})
  const [isSettingsLoading, setIsSettingsLoading] = useState(false)
  const [isSettingsSaving, setIsSettingsSaving] = useState(false)
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null)
  const [isVisibilitySaving, setIsVisibilitySaving] = useState(false)
  const [visibilityErrorMessage, setVisibilityErrorMessage] = useState<string | null>(null)

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
          llm_annotation: transcript.llm_annotation ?? 'not_generated',
          llm_annotation_visibility_default:
            transcript.llm_annotation_visibility_default ?? 'hidden',
          llm_annotation_visibility_per_annotator: Boolean(
            transcript.llm_annotation_visibility_per_annotator,
          ),
          llm_annotation_gcs_path: transcript.llm_annotation_gcs_path ?? null,
          has_llm_notes: Boolean(transcript.has_llm_notes),
          assigned_users: normalizeAssignedUsers(transcript.assigned_users),
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

  useEffect(() => {
    const transcriptId = settingsTranscript?.id
    if (!transcriptId) {
      return
    }

    let isCancelled = false
    const controller = new AbortController()

    const fetchSettings = async () => {
      setIsSettingsLoading(true)
      setSettingsErrorMessage(null)

      try {
        const response = await fetch(
          `/api/admin/transcripts/${transcriptId}/llm-note-prompts`,
          { signal: controller.signal },
        )
        const payload: LlmNotePromptsResponse | null = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          const message = payload?.error ?? 'Failed to load LLM note prompt settings.'
          throw new Error(message)
        }

        if (isCancelled) {
          return
        }

        setLlmSettingsByTranscriptId((previous) => ({
          ...previous,
          [transcriptId]: normalizeLlmSettings(payload.settings ?? null),
        }))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to fetch LLM prompt settings', error)
        if (!isCancelled) {
          setSettingsErrorMessage(
            error instanceof Error ? error.message : 'Failed to load LLM note prompt settings.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsSettingsLoading(false)
        }
      }
    }

    fetchSettings()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [settingsTranscript?.id])

  const filteredTranscripts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return transcripts
    return transcripts.filter((transcript) => {
      const titleMatch = transcript.title.toLowerCase().includes(query)
      const fileMatch = (transcript.transcript_file_name ?? '').toLowerCase().includes(query)
      return titleMatch || fileMatch
    })
  }, [searchQuery, transcripts])

  const handleGenerate = async (transcriptId: string) => {
    if (generatingTranscriptIds.has(transcriptId)) {
      return
    }

    setGenerateError(null)

    setGeneratingTranscriptIds((current) => {
      const next = new Set(current)
      next.add(transcriptId)
      return next
    })

    setTranscripts((current) =>
      current.map((transcript) =>
        transcript.id === transcriptId
          ? { ...transcript, llm_annotation: 'in_process' }
          : transcript,
      ),
    )

    try {
      const response = await fetch(`/api/admin/transcripts/${transcriptId}/llm-notes/generate`, {
        method: 'POST',
      })
      const payload: GenerateLlmNotesResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to generate LLM notes.'
        throw new Error(message)
      }

      const notesCreated = typeof payload?.notesCreated === 'number' ? payload.notesCreated : 0

      setTranscripts((current) =>
        current.map((transcript) =>
          transcript.id === transcriptId
            ? {
                ...transcript,
                has_llm_notes: transcript.has_llm_notes || notesCreated > 0,
                llm_annotation:
                  transcript.has_llm_notes || notesCreated > 0 ? 'generated' : 'not_generated',
              }
            : transcript,
        ),
      )
    } catch (error) {
      console.error('Failed to generate LLM notes', error)
      setGenerateError({
        transcriptId,
        message: error instanceof Error ? error.message : 'Failed to generate LLM notes.',
      })

      setTranscripts((current) =>
        current.map((transcript) =>
          transcript.id === transcriptId
            ? { ...transcript, llm_annotation: 'not_generated' }
            : transcript,
        ),
      )
    } finally {
      setGeneratingTranscriptIds((current) => {
        const next = new Set(current)
        next.delete(transcriptId)
        return next
      })
    }
  }

  const handleDownload = async (transcriptId: string) => {
    setDownloadError(null)
    setDownloadingTranscriptId(transcriptId)

    try {
      const transcript = transcripts.find((item) => item.id === transcriptId)
      const hasGeneratedNotes = Boolean(transcript?.has_llm_notes)
      const endpoint = hasGeneratedNotes
        ? `/api/admin/transcripts/${transcriptId}/llm-notes/download?transcriptId=${encodeURIComponent(transcriptId)}`
        : `/api/admin/transcripts/${transcriptId}/download?transcriptId=${encodeURIComponent(transcriptId)}`
      const response = await fetch(
        endpoint,
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to download LLM notes.'
        throw new Error(message)
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition')
      const suggestedName =
        parseFileNameFromContentDisposition(contentDisposition) ??
        (hasGeneratedNotes
          ? buildLlmNotesFileName(transcript?.title)
          : buildZipFileName(transcript?.title))

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
        message: error instanceof Error ? error.message : 'Failed to download LLM notes.',
      })
    } finally {
      setDownloadingTranscriptId(null)
    }
  }

  const handleDeleteGeneratedNotes = async (transcript: TranscriptRecord) => {
    if (deletingTranscriptIds.has(transcript.id)) {
      return
    }

    const confirmed = window.confirm(
      `Delete generated LLM notes for "${transcript.title}"? This removes all LLM notes and note assignments for this transcript.`,
    )
    if (!confirmed) {
      return
    }

    setDeleteError(null)
    setDeletingTranscriptIds((current) => {
      const next = new Set(current)
      next.add(transcript.id)
      return next
    })

    try {
      const response = await fetch(`/api/admin/transcripts/${transcript.id}/llm-notes`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcriptId: transcript.id }),
      })
      const payload: DeleteLlmNotesResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to delete LLM notes.'
        throw new Error(message)
      }

      setTranscripts((current) =>
        current.map((item) =>
          item.id === transcript.id
            ? {
                ...item,
                has_llm_notes: false,
                llm_annotation: 'not_generated',
              }
            : item,
        ),
      )
    } catch (error) {
      console.error('Failed to delete LLM notes', error)
      setDeleteError({
        transcriptId: transcript.id,
        message: error instanceof Error ? error.message : 'Failed to delete LLM notes.',
      })
    } finally {
      setDeletingTranscriptIds((current) => {
        const next = new Set(current)
        next.delete(transcript.id)
        return next
      })
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

  const openSettingsModal = (transcript: TranscriptRecord) => {
    setSettingsErrorMessage(null)
    setSettingsTranscript(transcript)
  }

  const closeSettingsModal = () => {
    if (isSettingsSaving) {
      return
    }

    setSettingsTranscript(null)
    setSettingsErrorMessage(null)
  }

  const handleSaveSettings = async () => {
    if (!settingsTranscript) {
      return
    }

    const transcriptId = settingsTranscript.id
    const currentSettings = llmSettingsByTranscriptId[transcriptId] ?? DEFAULT_LLM_SETTINGS

    setIsSettingsSaving(true)
    setSettingsErrorMessage(null)

    try {
      const response = await fetch(`/api/admin/transcripts/${transcriptId}/llm-note-prompts`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: currentSettings.scope,
          startLine: currentSettings.scope === 'range' ? currentSettings.startLine : null,
          endLine: currentSettings.scope === 'range' ? currentSettings.endLine : null,
          noteCreationPrompt: currentSettings.noteCreationPrompt,
          noteAssignmentPrompt: currentSettings.noteAssignmentPrompt,
        }),
      })
      const payload: LlmNotePromptsResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to save LLM note prompt settings.'
        throw new Error(message)
      }

      setLlmSettingsByTranscriptId((previous) => ({
        ...previous,
        [transcriptId]: normalizeLlmSettings(payload.settings ?? null),
      }))
      setSettingsTranscript(null)
    } catch (error) {
      console.error('Failed to save LLM prompt settings', error)
      setSettingsErrorMessage(
        error instanceof Error ? error.message : 'Failed to save LLM note prompt settings.',
      )
    } finally {
      setIsSettingsSaving(false)
    }
  }

  const openVisibilityModal = (transcript: TranscriptRecord) => {
    const nextDefaultVisibility = mapDefaultVisibilityToUi(
      transcript.llm_annotation_visibility_default,
    )
    const existingOverrides = buildAnnotatorVisibilityOverrides(transcript.assigned_users)
    setVisibilityTranscript(transcript)
    setDefaultVisibility(nextDefaultVisibility)
    setShowAnnotatorOverrides(transcript.llm_annotation_visibility_per_annotator)
    setAnnotatorVisibility(
      buildAnnotatorVisibilityState(
        transcript.assigned_users,
        nextDefaultVisibility,
        existingOverrides,
      ),
    )
    setVisibilityErrorMessage(null)
  }

  const closeVisibilityModal = () => {
    setVisibilityTranscript(null)
    setShowAnnotatorOverrides(false)
    setVisibilityErrorMessage(null)
  }

  const handleAnnotatorVisibilityChange = (
    annotatorId: string,
    visibility: AnnotatorVisibility,
  ) => {
    setAnnotatorVisibility((previous) => ({
      ...previous,
      [annotatorId]: visibility,
    }))
  }

  const handleToggleAnnotatorOverrides = () => {
    setShowAnnotatorOverrides((current) => {
      const next = !current
      if (next && visibilityTranscript) {
        setAnnotatorVisibility((previous) =>
          buildAnnotatorVisibilityState(
            visibilityTranscript.assigned_users,
            defaultVisibility,
            previous,
          ),
        )
      }
      return next
    })
  }

  const handleSelectVisibilityColumn = (visibility: AnnotatorVisibility) => {
    if (!visibilityTranscript) {
      return
    }

    setAnnotatorVisibility(() => {
      const next: Record<string, AnnotatorVisibility> = {}
      visibilityTranscript.assigned_users.forEach((annotator) => {
        next[annotator.id] = visibility
      })
      return next
    })
  }

  const handleSaveVisibility = async () => {
    if (!visibilityTranscript || isVisibilitySaving) {
      return
    }

    setIsVisibilitySaving(true)
    setVisibilityErrorMessage(null)

    try {
      const annotatorVisibilityPayload = showAnnotatorOverrides
        ? Object.fromEntries(
            Object.entries(annotatorVisibility).map(([annotatorId, visibility]) => [
              annotatorId,
              mapUiVisibilityToDefault(visibility),
            ]),
          )
        : undefined
      const response = await fetch(
        `/api/admin/transcripts/${visibilityTranscript.id}/llm-annotation-visibility`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            defaultVisibility: mapUiVisibilityToDefault(defaultVisibility),
            perAnnotator: showAnnotatorOverrides,
            annotatorVisibility: annotatorVisibilityPayload,
          }),
        },
      )
      const payload: SaveVisibilityResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to save LLM annotation visibility.'
        throw new Error(message)
      }

      const updatedVisibility =
        payload.defaultVisibility ?? mapUiVisibilityToDefault(defaultVisibility)
      const updatedPerAnnotator =
        typeof payload.perAnnotator === 'boolean'
          ? payload.perAnnotator
          : showAnnotatorOverrides
      let updatedAnnotatorVisibility =
        payload.annotatorVisibility ?? annotatorVisibilityPayload ?? null

      if (!updatedPerAnnotator && visibilityTranscript) {
        updatedAnnotatorVisibility = visibilityTranscript.assigned_users.reduce<
          Record<string, LlmAnnotationVisibilityDefault>
        >((acc, annotator) => {
          acc[annotator.id] = updatedVisibility
          return acc
        }, {})
      }

      setTranscripts((current) =>
        current.map((transcript) =>
          transcript.id === visibilityTranscript.id
            ? {
                ...transcript,
                llm_annotation_visibility_default: updatedVisibility,
                llm_annotation_visibility_per_annotator: updatedPerAnnotator,
                assigned_users: mergeAnnotatorVisibility(
                  transcript.assigned_users,
                  updatedAnnotatorVisibility,
                ),
              }
            : transcript,
        ),
      )
      setVisibilityTranscript((current) =>
        current
          ? {
              ...current,
              llm_annotation_visibility_default: updatedVisibility,
              llm_annotation_visibility_per_annotator: updatedPerAnnotator,
              assigned_users: mergeAnnotatorVisibility(
                current.assigned_users,
                updatedAnnotatorVisibility,
              ),
            }
          : current,
      )
      setDefaultVisibility(mapDefaultVisibilityToUi(updatedVisibility))
      closeVisibilityModal()
    } catch (error) {
      console.error('Failed to save LLM annotation visibility', error)
      setVisibilityErrorMessage(
        error instanceof Error ? error.message : 'Failed to save LLM annotation visibility.',
      )
    } finally {
      setIsVisibilitySaving(false)
    }
  }

  const activeSettings =
    settingsTranscript ? llmSettingsByTranscriptId[settingsTranscript.id] ?? DEFAULT_LLM_SETTINGS : null

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
            transcript.llm_annotation_gcs_path || transcript.annotation_file_name,
          )
          const hasGeneratedNotes =
            transcript.has_llm_notes || transcript.llm_annotation === 'generated'
          const isGenerating =
            transcript.llm_annotation === 'in_process' || generatingTranscriptIds.has(transcript.id)
          const isGenerated = hasAttachment || hasGeneratedNotes
          const canDownload = hasAttachment || hasGeneratedNotes
          const isDownloading = downloadingTranscriptId === transcript.id
          const isDeleting = deletingTranscriptIds.has(transcript.id)
          const downloadErrorMessage =
            downloadError?.transcriptId === transcript.id ? downloadError.message : null
          const generateErrorMessage =
            generateError?.transcriptId === transcript.id ? generateError.message : null
          const deleteErrorMessage =
            deleteError?.transcriptId === transcript.id ? deleteError.message : null

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
                        : isGenerating || hasGeneratedNotes
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    {hasAttachment
                      ? 'LLM file available'
                      : isGenerating
                        ? 'Generation in progress'
                        : hasGeneratedNotes
                          ? 'LLM notes generated'
                        : 'LLM notes not generated'}
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
                    onClick={() => openSettingsModal(transcript)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span className="text-sm font-medium">Settings</span>
                  </button>

                  {isGenerated && (
                    <button
                      onClick={() => handleDownload(transcript.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        canDownload
                          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      } ${isDownloading ? 'opacity-70 cursor-not-allowed' : ''}`}
                      disabled={isDownloading || !canDownload}
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {isDownloading
                          ? 'Downloading...'
                          : hasGeneratedNotes
                            ? 'Download LLM Notes'
                            : 'Download'}
                      </span>
                    </button>
                  )}

                  {isGenerated && (
                    <button
                      onClick={() => openVisibilityModal(transcript)}
                      className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      <span className="text-sm font-medium">Annotation Visibility</span>
                    </button>
                  )}

                  {isGenerated && hasGeneratedNotes && (
                    <button
                      onClick={() => void handleDeleteGeneratedNotes(transcript)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        isDeleting
                          ? 'bg-red-50 text-red-400 cursor-not-allowed'
                          : 'bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                      disabled={isDeleting}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {isDeleting ? 'Deleting...' : 'Delete LLM Notes'}
                      </span>
                    </button>
                  )}

                  {!isGenerated && (
                    <button
                      onClick={() => void handleGenerate(transcript.id)}
                      className={`flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors ${
                        isGenerating ? 'opacity-70 cursor-not-allowed' : ''
                      }`}
                      disabled={isGenerating}
                    >
                      <Sparkles className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {isGenerating ? 'Generating...' : 'Generate LLM Annotations'}
                      </span>
                    </button>
                  )}

                </div>

                {generateErrorMessage && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    {generateErrorMessage}
                  </p>
                )}
                {downloadErrorMessage && (
                  <p className="text-xs text-red-600">{downloadErrorMessage}</p>
                )}
                {deleteErrorMessage && (
                  <p className="text-xs text-red-600">{deleteErrorMessage}</p>
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
            onClick={closeVisibilityModal}
          />

          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl transform transition-all">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    LLM Annotation Visibility
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Choose the default visibility and optionally customize it per annotator.
                  </p>
                </div>
                <button
                  onClick={closeVisibilityModal}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6">
                <div className="space-y-5">
                  <div
                    className={`rounded-lg border border-gray-200 bg-gray-50 p-4 ${
                      showAnnotatorOverrides ? 'opacity-60' : ''
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900">
                      LLM Annotation Visibility (Default)
                    </p>
                    <div className="mt-4 space-y-3">
                      <label className="flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="radio"
                          name="llm-visibility-default"
                          checked={defaultVisibility === 'never'}
                          onChange={() => setDefaultVisibility('never')}
                          disabled={showAnnotatorOverrides}
                          className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                        />
                        Hidden
                      </label>
                      <label className="flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="radio"
                          name="llm-visibility-default"
                          checked={defaultVisibility === 'after'}
                          onChange={() => setDefaultVisibility('after')}
                          disabled={showAnnotatorOverrides}
                          className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                        />
                        Visible after completion
                      </label>
                      <label className="flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="radio"
                          name="llm-visibility-default"
                          checked={defaultVisibility === 'always'}
                          onChange={() => setDefaultVisibility('always')}
                          disabled={showAnnotatorOverrides}
                          className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                        />
                        Always visible
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">
                      {showAnnotatorOverrides
                        ? 'Per-annotator settings are enabled'
                        : 'Applies to all annotators'}
                    </p>
                  </div>
                  {visibilityErrorMessage && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {visibilityErrorMessage}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Customize per annotator</p>
                      <p className="text-xs text-gray-500">
                        Allow different visibility settings for each annotator.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-3 text-sm font-medium text-gray-600">
                      <span>{showAnnotatorOverrides ? 'On' : 'Off'}</span>
                      <span className="relative inline-flex h-6 w-11 items-center">
                        <input
                          type="checkbox"
                          role="switch"
                          className="peer sr-only"
                          checked={showAnnotatorOverrides}
                          onChange={handleToggleAnnotatorOverrides}
                          aria-controls="annotator-visibility-grid"
                          aria-label="Customize per annotator visibility"
                        />
                        <span className="absolute inset-0 rounded-full bg-gray-200 transition-colors peer-checked:bg-primary-600" />
                        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                      </span>
                    </label>
                  </div>

                  {showAnnotatorOverrides &&
                    (visibilityTranscript?.assigned_users.length ? (
                      <div
                        id="annotator-visibility-grid"
                        className="overflow-x-auto rounded-lg border border-gray-200"
                      >
                        <table className="min-w-full text-sm text-gray-700">
                          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">Annotator</th>
                              <th className="px-4 py-3 text-center font-semibold">
                                <div className="flex flex-col items-center gap-1">
                                  <span>Hidden</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectVisibilityColumn('never')}
                                    className="text-[11px] font-semibold text-gray-400 hover:text-gray-500"
                                    aria-label="Set all annotators to hidden"
                                  >
                                    Select all
                                  </button>
                                </div>
                              </th>
                              <th className="px-4 py-3 text-center font-semibold">
                                <div className="flex flex-col items-center gap-1">
                                  <span>Visible after completion</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectVisibilityColumn('after')}
                                    className="text-[11px] font-semibold text-gray-400 hover:text-gray-500"
                                    aria-label="Set all annotators to visible after completion"
                                  >
                                    Select all
                                  </button>
                                </div>
                              </th>
                              <th className="px-4 py-3 text-center font-semibold">
                                <div className="flex flex-col items-center gap-1">
                                  <span>Always visible</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectVisibilityColumn('always')}
                                    className="text-[11px] font-semibold text-gray-400 hover:text-gray-500"
                                    aria-label="Set all annotators to always visible"
                                  >
                                    Select all
                                  </button>
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {(visibilityTranscript?.assigned_users ?? []).map((annotator) => {
                              const annotatorLabel = getAnnotatorLabel(annotator)
                              const currentVisibility =
                                annotatorVisibility[annotator.id] ?? defaultVisibility

                              return (
                                <tr key={annotator.id} className="bg-white">
                                  <td className="px-4 py-4 font-medium text-gray-900">
                                    {annotatorLabel}
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="radio"
                                      name={`visibility-${annotator.id}`}
                                      checked={currentVisibility === 'never'}
                                      onChange={() =>
                                        handleAnnotatorVisibilityChange(annotator.id, 'never')
                                      }
                                      className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                                      aria-label={`Hide LLM annotations for ${annotatorLabel}`}
                                    />
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="radio"
                                      name={`visibility-${annotator.id}`}
                                      checked={currentVisibility === 'after'}
                                      onChange={() =>
                                        handleAnnotatorVisibilityChange(annotator.id, 'after')
                                      }
                                      className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                                      aria-label={`Show LLM annotations after completion for ${annotatorLabel}`}
                                    />
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="radio"
                                      name={`visibility-${annotator.id}`}
                                      checked={currentVisibility === 'always'}
                                      onChange={() =>
                                        handleAnnotatorVisibilityChange(annotator.id, 'always')
                                      }
                                      className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                                      aria-label={`Always show LLM annotations for ${annotatorLabel}`}
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        No annotators are assigned to this transcript yet.
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-gray-200 p-6 sm:flex-row sm:justify-end">
                <button
                  onClick={closeVisibilityModal}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSaveVisibility()}
                  disabled={isVisibilitySaving}
                  className={`px-4 py-2 bg-primary-600 text-white rounded-lg transition-colors ${
                    isVisibilitySaving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-700'
                  }`}
                >
                  {isVisibilitySaving ? 'Saving...' : 'Save changes'}
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
            onClick={closeSettingsModal}
          />

          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl transform transition-all">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">LLM Annotation Settings</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Define how notes should be generated and assigned.
                  </p>
                </div>
                <button
                  onClick={closeSettingsModal}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {isSettingsLoading && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    Loading settings...
                  </div>
                )}
                {settingsErrorMessage && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {settingsErrorMessage}
                  </div>
                )}

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
                        checked={(activeSettings?.scope ?? DEFAULT_LLM_SETTINGS.scope) === 'all'}
                        onChange={() => updateLlmSettings(settingsTranscript.id, { scope: 'all' })}
                        disabled={isSettingsLoading || isSettingsSaving}
                        className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                      />
                      Annotate all lines
                    </label>
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="llm-line-scope"
                        checked={(activeSettings?.scope ?? DEFAULT_LLM_SETTINGS.scope) === 'range'}
                        onChange={() => updateLlmSettings(settingsTranscript.id, { scope: 'range' })}
                        disabled={isSettingsLoading || isSettingsSaving}
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
                          value={activeSettings?.startLine ?? ''}
                          onChange={(event) =>
                            updateLlmSettings(settingsTranscript.id, { startLine: event.target.value })
                          }
                          disabled={
                            (activeSettings?.scope ?? DEFAULT_LLM_SETTINGS.scope) !== 'range' ||
                            isSettingsLoading ||
                            isSettingsSaving
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
                          value={activeSettings?.endLine ?? ''}
                          onChange={(event) =>
                            updateLlmSettings(settingsTranscript.id, { endLine: event.target.value })
                          }
                          disabled={
                            (activeSettings?.scope ?? DEFAULT_LLM_SETTINGS.scope) !== 'range' ||
                            isSettingsLoading ||
                            isSettingsSaving
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400"
                          placeholder="e.g. 120"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-900">
                      Note Creation
                      <textarea
                        value={activeSettings?.noteCreationPrompt ?? ''}
                        onChange={(event) =>
                          updateLlmSettings(settingsTranscript.id, {
                            noteCreationPrompt: event.target.value,
                          })
                        }
                        rows={4}
                        disabled={isSettingsLoading || isSettingsSaving}
                        placeholder="Describe how notes should be generated..."
                        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-900">
                      Note Assignment
                      <textarea
                        value={activeSettings?.noteAssignmentPrompt ?? ''}
                        onChange={(event) =>
                          updateLlmSettings(settingsTranscript.id, {
                            noteAssignmentPrompt: event.target.value,
                          })
                        }
                        rows={4}
                        disabled={isSettingsLoading || isSettingsSaving}
                        placeholder="Describe how each generated note should be assigned..."
                        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    onClick={closeSettingsModal}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    disabled={isSettingsSaving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSettings}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                    disabled={isSettingsLoading || isSettingsSaving}
                  >
                    {isSettingsSaving ? 'Saving...' : 'Save settings'}
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
