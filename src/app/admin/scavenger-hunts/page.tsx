'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Edit, Eye, FileText, Plus, Search, Sparkles, Target, Trash2, X } from 'lucide-react'

type LlmAnnotationStatus = 'not_generated' | 'in_process' | 'generated'
type ScavengerVisibilityAdmin = 'hidden' | 'visible_after_completion' | 'always_visible'
type ScavengerVisibilityOption = 'never' | 'after' | 'always'

type ScavengerHuntSummary = {
  id: string
  created_at: string | null
  question_count: number
  scavenger_visibility_admin?: ScavengerVisibilityAdmin
  scavenger_visibility_user?: boolean
}

type ScavengerAssignment = {
  id: string
  annotator_id: string
  name: string | null
  username: string | null
  scavenger_visibility_admin: ScavengerVisibilityAdmin | null
}

type TranscriptRecord = {
  id: string
  title: string
  grade: string | null
  transcript_file_name: string | null
  annotation_file_name: string | null
  llm_annotation: LlmAnnotationStatus
  llm_annotation_gcs_path: string | null
  has_llm_notes: boolean
  scavenger_hunt: ScavengerHuntSummary | null
}

type TranscriptPayload = {
  id: string
  title: string
  grade?: string | null
  transcript_file_name?: string | null
  annotation_file_name?: string | null
  llm_annotation?: LlmAnnotationStatus | null
  llm_annotation_gcs_path?: string | null
  has_llm_notes?: boolean
  scavenger_hunt?: {
    id?: string
    created_at?: string | null
    question_count?: number | null
    scavenger_visibility_admin?: ScavengerVisibilityAdmin | null
    scavenger_visibility_user?: boolean | null
  } | null
}

type TranscriptsResponse = {
  success: boolean
  transcripts?: TranscriptPayload[]
  error?: string
}

type ScavengerAssignmentPayload = {
  id?: string
  created_for?: string
  scavenger_visibility_admin?: ScavengerVisibilityAdmin | null
  user?: {
    id?: string
    name?: string | null
    username?: string | null
  } | null
}

type ScavengerHuntQuestion = {
  id: string
  question: string
  orderIndex: number
}

type ScavengerHuntResponse = {
  success: boolean
  scavengerHunt?: {
    id: string
    created_at: string | null
    questions: ScavengerHuntQuestion[]
  } | null
  error?: string
}

type SaveScavengerHuntResponse = {
  success: boolean
  scavengerHunt?: ScavengerHuntSummary | null
  error?: string
}

type DeleteScavengerHuntResponse = {
  success: boolean
  error?: string
}

type SaveVisibilityResponse = {
  success: boolean
  adminVisibility?: ScavengerVisibilityAdmin
  userVisibility?: boolean
  perAnnotator?: boolean
  annotatorVisibility?: Record<string, ScavengerVisibilityAdmin>
  error?: string
}

type ScavengerVisibilityDetailsResponse = {
  success: boolean
  adminVisibility?: ScavengerVisibilityAdmin
  userVisibility?: boolean
  perAnnotator?: boolean
  assignments?: ScavengerAssignmentPayload[]
  error?: string
}

type QuestionDraft = {
  id: string
  text: string
}

const createQuestionDraft = (text = ''): QuestionDraft => {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `question-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return { id, text }
}

const buildDefaultQuestions = () => [
  createQuestionDraft(''),
  createQuestionDraft(''),
  createQuestionDraft(''),
]

const mapDefaultVisibilityToUi = (
  value?: ScavengerVisibilityAdmin | null,
): ScavengerVisibilityOption => {
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
): ScavengerVisibilityAdmin | null => {
  if (value === 'hidden' || value === 'visible_after_completion' || value === 'always_visible') {
    return value
  }
  return null
}

const mapUiVisibilityToDefault = (
  value: ScavengerVisibilityOption,
): ScavengerVisibilityAdmin => {
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

const buildAnnotatorVisibilityState = (
  assignments: ScavengerAssignment[],
  fallbackVisibility: ScavengerVisibilityOption,
  existing?: Record<string, ScavengerVisibilityOption>,
): Record<string, ScavengerVisibilityOption> =>
  assignments.reduce<Record<string, ScavengerVisibilityOption>>((acc, assignment) => {
    acc[assignment.annotator_id] = existing?.[assignment.annotator_id] ?? fallbackVisibility
    return acc
  }, {})

const buildAnnotatorVisibilityOverrides = (
  assignments: ScavengerAssignment[],
): Record<string, ScavengerVisibilityOption> =>
  assignments.reduce<Record<string, ScavengerVisibilityOption>>((acc, assignment) => {
    acc[assignment.annotator_id] = mapDefaultVisibilityToUi(
      assignment.scavenger_visibility_admin,
    )
    return acc
  }, {})

const normalizeScavengerAssignments = (
  assignments?: ScavengerAssignmentPayload[] | null,
): ScavengerAssignment[] => {
  if (!Array.isArray(assignments)) {
    return []
  }

  return assignments
    .map((assignment) => {
      const annotatorId =
        typeof assignment.created_for === 'string' ? assignment.created_for : ''
      const id = typeof assignment.id === 'string' ? assignment.id : ''
      if (!annotatorId || !id) {
        return null
      }

      const user = assignment.user ?? null
      return {
        id,
        annotator_id: annotatorId,
        name: typeof user?.name === 'string' ? user.name.trim() || null : null,
        username: typeof user?.username === 'string' ? user.username.trim() || null : null,
        scavenger_visibility_admin: parseVisibilityDefault(
          assignment.scavenger_visibility_admin,
        ),
      }
    })
    .filter((assignment): assignment is ScavengerAssignment => assignment !== null)
}

const getAnnotatorLabel = (annotator: ScavengerAssignment) =>
  annotator.name?.trim() || annotator.username?.trim() || 'Unnamed user'

export default function ScavengerHuntsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [activeTranscript, setActiveTranscript] = useState<TranscriptRecord | null>(null)
  const [activeScavengerId, setActiveScavengerId] = useState<string | null>(null)
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isModalLoading, setIsModalLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [visibilityTranscript, setVisibilityTranscript] = useState<TranscriptRecord | null>(null)
  const [defaultVisibility, setDefaultVisibility] = useState<ScavengerVisibilityOption>('never')
  const [showAnnotatorOverrides, setShowAnnotatorOverrides] = useState(false)
  const [scavengerAssignments, setScavengerAssignments] = useState<ScavengerAssignment[]>([])
  const [annotatorVisibility, setAnnotatorVisibility] = useState<
    Record<string, ScavengerVisibilityOption>
  >({})
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(false)
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

        if (!isCancelled) {
          const normalized: TranscriptRecord[] = (payload.transcripts ?? []).map((transcript) => ({
            id: transcript.id,
            title: transcript.title,
            grade: transcript.grade?.trim() || null,
            transcript_file_name: transcript.transcript_file_name ?? null,
            annotation_file_name: transcript.annotation_file_name ?? null,
            llm_annotation: transcript.llm_annotation ?? 'not_generated',
            llm_annotation_gcs_path: transcript.llm_annotation_gcs_path ?? null,
            has_llm_notes: Boolean(transcript.has_llm_notes),
            scavenger_hunt: transcript.scavenger_hunt?.id
              ? {
                  id: transcript.scavenger_hunt.id,
                  created_at: transcript.scavenger_hunt.created_at ?? null,
                  question_count: transcript.scavenger_hunt.question_count ?? 0,
                  scavenger_visibility_admin:
                    parseVisibilityDefault(
                      transcript.scavenger_hunt.scavenger_visibility_admin,
                    ) ?? 'hidden',
                  scavenger_visibility_user: Boolean(
                    transcript.scavenger_hunt.scavenger_visibility_user,
                  ),
                }
              : null,
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

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredTranscripts = useMemo(
    () =>
      transcripts.filter((transcript) => {
        if (!normalizedSearch) return true
        return (
          transcript.title.toLowerCase().includes(normalizedSearch) ||
          (transcript.transcript_file_name ?? '').toLowerCase().includes(normalizedSearch)
        )
      }),
    [transcripts, normalizedSearch],
  )

  const closeModal = () => {
    setIsModalOpen(false)
    setActiveTranscript(null)
    setActiveScavengerId(null)
    setQuestionDrafts([])
    setIsDeleting(false)
    setModalError(null)
  }

  const openScavengerModal = async (transcript: TranscriptRecord) => {
    setActiveTranscript(transcript)
    setActiveScavengerId(transcript.scavenger_hunt?.id ?? null)
    setQuestionDrafts([])
    setIsModalOpen(true)
    setIsModalLoading(true)
    setIsDeleting(false)
    setModalError(null)

    try {
      const response = await fetch(
        `/api/admin/transcripts/${transcript.id}/scavenger-hunt`,
      )
      const payload: ScavengerHuntResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to load scavenger hunt.'
        throw new Error(message)
      }

      if (payload.scavengerHunt?.questions?.length) {
        setQuestionDrafts(
          payload.scavengerHunt.questions
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((question) => createQuestionDraft(question.question)),
        )
        setActiveScavengerId(payload.scavengerHunt.id)
      } else {
        setQuestionDrafts(buildDefaultQuestions())
        setActiveScavengerId(null)
      }
    } catch (error) {
      console.error('Failed to load scavenger hunt', error)
      setModalError(
        error instanceof Error ? error.message : 'Unable to load scavenger hunt details.',
      )
      setQuestionDrafts(buildDefaultQuestions())
    } finally {
      setIsModalLoading(false)
    }
  }

  const openVisibilityModal = async (transcript: TranscriptRecord) => {
    const scavengerVisibilityAdmin =
      transcript.scavenger_hunt?.scavenger_visibility_admin ?? 'hidden'
    const initialDefaultVisibility = mapDefaultVisibilityToUi(scavengerVisibilityAdmin)
    const initialPerAnnotatorVisibility = Boolean(
      transcript.scavenger_hunt?.scavenger_visibility_user,
    )

    setVisibilityTranscript(transcript)
    setDefaultVisibility(initialDefaultVisibility)
    setShowAnnotatorOverrides(initialPerAnnotatorVisibility)
    setScavengerAssignments([])
    setAnnotatorVisibility({})
    setIsAssignmentsLoading(true)
    setVisibilityErrorMessage(null)

    try {
      const response = await fetch(
        `/api/admin/transcripts/${transcript.id}/scavenger-visibility`,
      )
      const payload: ScavengerVisibilityDetailsResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message =
          payload?.error ?? 'Failed to load scavenger hunt visibility details.'
        throw new Error(message)
      }

      const updatedAdminVisibility =
        payload.adminVisibility ?? mapUiVisibilityToDefault(initialDefaultVisibility)
      const updatedPerAnnotatorVisibility =
        typeof payload.userVisibility === 'boolean'
          ? payload.userVisibility
          : initialPerAnnotatorVisibility
      const nextDefaultVisibility = mapDefaultVisibilityToUi(updatedAdminVisibility)
      const normalizedAssignments = normalizeScavengerAssignments(payload.assignments)
      const overrides = buildAnnotatorVisibilityOverrides(normalizedAssignments)

      setDefaultVisibility(nextDefaultVisibility)
      setScavengerAssignments(normalizedAssignments)
      setAnnotatorVisibility(
        buildAnnotatorVisibilityState(
          normalizedAssignments,
          nextDefaultVisibility,
          overrides,
        ),
      )
      setShowAnnotatorOverrides(updatedPerAnnotatorVisibility)
    } catch (error) {
      console.error('Failed to load scavenger hunt visibility details', error)
      setVisibilityErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load scavenger hunt visibility details.',
      )
    } finally {
      setIsAssignmentsLoading(false)
    }
  }

  const closeVisibilityModal = () => {
    setVisibilityTranscript(null)
    setShowAnnotatorOverrides(false)
    setScavengerAssignments([])
    setAnnotatorVisibility({})
    setIsAssignmentsLoading(false)
    setVisibilityErrorMessage(null)
  }

  const handleAnnotatorVisibilityChange = (
    annotatorId: string,
    visibility: ScavengerVisibilityOption,
  ) => {
    setAnnotatorVisibility((previous) => ({
      ...previous,
      [annotatorId]: visibility,
    }))
  }

  const handleToggleAnnotatorOverrides = () => {
    setShowAnnotatorOverrides((current) => {
      const next = !current
      if (next) {
        setAnnotatorVisibility((previous) =>
          buildAnnotatorVisibilityState(scavengerAssignments, defaultVisibility, previous),
        )
      }
      return next
    })
  }

  const handleSelectVisibilityColumn = (visibility: ScavengerVisibilityOption) => {
    setAnnotatorVisibility(() => {
      const next: Record<string, ScavengerVisibilityOption> = {}
      scavengerAssignments.forEach((assignment) => {
        next[assignment.annotator_id] = visibility
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
        `/api/admin/transcripts/${visibilityTranscript.id}/scavenger-visibility`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            adminVisibility: mapUiVisibilityToDefault(defaultVisibility),
            userVisibility: showAnnotatorOverrides,
            perAnnotator: showAnnotatorOverrides,
            annotatorVisibility: annotatorVisibilityPayload,
          }),
        },
      )
      const payload: SaveVisibilityResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to save scavenger hunt activity visibility.'
        throw new Error(message)
      }

      const updatedAdminVisibility =
        payload.adminVisibility ?? mapUiVisibilityToDefault(defaultVisibility)
      const updatedUserVisibility =
        typeof payload.userVisibility === 'boolean'
          ? payload.userVisibility
          : showAnnotatorOverrides

      setTranscripts((current) =>
        current.map((transcript) =>
          transcript.id === visibilityTranscript.id
            ? {
                ...transcript,
                scavenger_hunt: transcript.scavenger_hunt
                  ? {
                      ...transcript.scavenger_hunt,
                      scavenger_visibility_admin: updatedAdminVisibility,
                      scavenger_visibility_user: updatedUserVisibility,
                    }
                  : transcript.scavenger_hunt,
              }
            : transcript,
        ),
      )
      setVisibilityTranscript((current) =>
        current
          ? {
              ...current,
              scavenger_hunt: current.scavenger_hunt
                ? {
                    ...current.scavenger_hunt,
                    scavenger_visibility_admin: updatedAdminVisibility,
                    scavenger_visibility_user: updatedUserVisibility,
                  }
                : current.scavenger_hunt,
            }
          : current,
      )
      setDefaultVisibility(mapDefaultVisibilityToUi(updatedAdminVisibility))
      closeVisibilityModal()
    } catch (error) {
      console.error('Failed to save scavenger hunt activity visibility', error)
      setVisibilityErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to save scavenger hunt activity visibility.',
      )
    } finally {
      setIsVisibilitySaving(false)
    }
  }

  const handleQuestionChange = (questionId: string, value: string) => {
    setQuestionDrafts((current) =>
      current.map((question) =>
        question.id === questionId ? { ...question, text: value } : question,
      ),
    )
  }

  const handleAddQuestion = () => {
    setQuestionDrafts((current) => [...current, createQuestionDraft('')])
  }

  const handleRemoveQuestion = (questionId: string) => {
    setQuestionDrafts((current) => current.filter((question) => question.id !== questionId))
  }

  const handleSaveScavengerHunt = async () => {
    if (!activeTranscript) return

    const cleanedQuestions = questionDrafts
      .map((question) => question.text.trim())
      .filter((question) => Boolean(question))

    if (cleanedQuestions.length === 0) {
      setModalError('Add at least one question to save the scavenger hunt.')
      return
    }

    setIsSaving(true)
    setModalError(null)

    try {
      const response = await fetch(
        `/api/admin/transcripts/${activeTranscript.id}/scavenger-hunt`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions: cleanedQuestions }),
        },
      )
      const payload: SaveScavengerHuntResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload || !payload.success || !payload.scavengerHunt) {
        const message = payload?.error ?? 'Failed to save scavenger hunt.'
        throw new Error(message)
      }

      const savedScavengerHunt = payload.scavengerHunt

      setTranscripts((current) =>
        current.map((transcript) => {
          if (transcript.id !== activeTranscript.id) {
            return transcript
          }

          const updatedScavengerHunt: ScavengerHuntSummary = {
            ...savedScavengerHunt,
            scavenger_visibility_admin:
              savedScavengerHunt.scavenger_visibility_admin ??
              transcript.scavenger_hunt?.scavenger_visibility_admin ??
              'hidden',
            scavenger_visibility_user:
              typeof savedScavengerHunt.scavenger_visibility_user === 'boolean'
                ? savedScavengerHunt.scavenger_visibility_user
                : transcript.scavenger_hunt?.scavenger_visibility_user ?? false,
          }

          return {
            ...transcript,
            scavenger_hunt: updatedScavengerHunt,
          }
        }),
      )
      setNotification('Scavenger hunt saved.')
      closeModal()
    } catch (error) {
      console.error('Failed to save scavenger hunt', error)
      setModalError(
        error instanceof Error ? error.message : 'Unable to save scavenger hunt right now.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteScavengerHunt = async () => {
    if (!activeTranscript || !activeScavengerId || isDeleting) {
      return
    }

    const confirmed = window.confirm(
      `Delete scavenger hunt for "${activeTranscript.title}"? This removes all scavenger hunt questions and responses for this transcript.`,
    )
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    setModalError(null)

    try {
      const response = await fetch(
        `/api/admin/transcripts/${activeTranscript.id}/scavenger-hunt`,
        {
          method: 'DELETE',
        },
      )
      const payload: DeleteScavengerHuntResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to delete scavenger hunt.'
        throw new Error(message)
      }

      setTranscripts((current) =>
        current.map((transcript) =>
          transcript.id === activeTranscript.id
            ? {
                ...transcript,
                scavenger_hunt: null,
              }
            : transcript,
        ),
      )
      setNotification('Scavenger hunt deleted.')
      closeModal()
    } catch (error) {
      console.error('Failed to delete scavenger hunt', error)
      setModalError(
        error instanceof Error
          ? error.message
          : 'Unable to delete scavenger hunt right now.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Scavenger Hunts</h1>
        <p className="text-gray-600 mt-2">
          Build question sets from LLM annotations and guide annotators to key moments.
        </p>
      </div>

      {notification && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900">
          <span>{notification}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-primary-800 underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Target className="w-5 h-5 text-primary-600" />
            Use LLM notes to craft scavenger hunt prompts for each transcript.
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
          const hasLlmNotes = transcript.has_llm_notes
          const isGenerating = transcript.llm_annotation === 'in_process'
          const isGenerated = transcript.llm_annotation === 'generated'
          const hasScavenger = Boolean(transcript.scavenger_hunt?.id)
          const questionCount = transcript.scavenger_hunt?.question_count ?? 0

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
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                      hasLlmNotes
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    {hasLlmNotes ? 'LLM annotations ready' : 'LLM annotations required'}
                  </span>

                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                      hasScavenger
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    {hasScavenger
                      ? `${questionCount} question${questionCount === 1 ? '' : 's'}`
                      : 'No scavenger hunt yet'}
                  </span>
                </div>

                {!hasLlmNotes && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {isGenerating
                      ? 'LLM annotations are generating. Check back soon.'
                      : 'Generate LLM annotations to get started.'}{' '}
                    {!isGenerating && (
                      <Link
                        href="/admin/llm-annotations"
                        className="font-semibold text-amber-900 underline-offset-2 hover:underline"
                      >
                        Open LLM Annotations
                      </Link>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-200">
                <button
                  onClick={() => openScavengerModal(transcript)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    hasLlmNotes
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                  disabled={!hasLlmNotes}
                >
                  {hasScavenger ? (
                    <Edit className="w-4 h-4" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span className="text-sm font-medium">
                    {hasScavenger ? 'Edit Scavenger Hunt' : 'Create Scavenger Hunt'}
                  </span>
                </button>
                {hasScavenger && (
                  <button
                    onClick={() => void openVisibilityModal(transcript)}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    <span className="text-sm font-medium">Visibility</span>
                  </button>
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

      {isModalOpen && activeTranscript && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => {
              if (!isSaving && !isDeleting) {
                closeModal()
              }
            }}
          />

          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl transform transition-all">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {activeScavengerId ? 'Edit Scavenger Hunt' : 'Create Scavenger Hunt'}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {activeTranscript.title}
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className={`p-2 rounded-lg transition-colors ${
                    isSaving || isDeleting
                      ? 'cursor-not-allowed text-gray-300'
                      : 'hover:bg-gray-100'
                  }`}
                  disabled={isSaving || isDeleting}
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {isModalLoading && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    Loading scavenger hunt details...
                  </div>
                )}

                {modalError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {modalError}
                  </div>
                )}

                <div className="space-y-3">
                  {questionDrafts.map((question, index) => (
                    <div key={question.id} className="flex gap-3 items-start">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-600">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <label className="sr-only">Question {index + 1}</label>
                        <textarea
                          rows={2}
                          value={question.text}
                          onChange={(event) =>
                            handleQuestionChange(question.id, event.target.value)
                          }
                          placeholder="Enter a scavenger hunt question..."
                          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                        />
                      </div>
                      {!activeScavengerId && (
                        <button
                          type="button"
                          onClick={() => handleRemoveQuestion(question.id)}
                          className={`mt-1 rounded-lg border px-2 py-2 text-sm transition-colors ${
                            questionDrafts.length === 1
                              ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                              : 'border-gray-200 text-gray-500 hover:bg-gray-100'
                          }`}
                          disabled={questionDrafts.length === 1}
                          aria-label="Remove question"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="h-4 w-4" />
                  Add question
                </button>

                {activeScavengerId && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Saving will replace the existing scavenger hunt questions.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
                {activeScavengerId && (
                  <button
                    type="button"
                    onClick={handleDeleteScavengerHunt}
                    className={`mr-auto inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      isSaving || isDeleting
                        ? 'border-red-200 text-red-300 cursor-not-allowed'
                        : 'border-red-200 text-red-700 hover:bg-red-50'
                    }`}
                    disabled={isSaving || isDeleting}
                  >
                    <Trash2 className="h-4 w-4" />
                    {isDeleting ? 'Deleting...' : 'Delete Scavenger Hunt'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                  disabled={isSaving || isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveScavengerHunt}
                  className={`px-4 py-2 rounded-lg text-white transition-colors ${
                    isSaving || isDeleting
                      ? 'bg-primary-300 cursor-not-allowed'
                      : 'bg-primary-600 hover:bg-primary-700'
                  }`}
                  disabled={isSaving || isDeleting}
                >
                  {isSaving ? 'Saving...' : 'Save Scavenger Hunt'}
                </button>
              </div>
            </div>
          </div>
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
                    Scavenger Hunt Visibility
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Choose when scavenger hunt activity is visible to admins.
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
                      Scavenger Hunt Visibility (Default)
                    </p>
                    <div className="mt-4 space-y-3">
                      <label className="flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="radio"
                          name="scavenger-visibility-admin"
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
                          name="scavenger-visibility-admin"
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
                          name="scavenger-visibility-admin"
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
                      <p className="text-sm font-semibold text-gray-900">
                        Customize per annotator
                      </p>
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
                    (isAssignmentsLoading ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        Loading scavenger assignments...
                      </div>
                    ) : scavengerAssignments.length ? (
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
                            {scavengerAssignments.map((assignment) => {
                              const annotatorLabel = getAnnotatorLabel(assignment)
                              const currentVisibility =
                                annotatorVisibility[assignment.annotator_id] ?? defaultVisibility

                              return (
                                <tr key={assignment.id} className="bg-white">
                                  <td className="px-4 py-4 font-medium text-gray-900">
                                    {annotatorLabel}
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="radio"
                                      name={`visibility-${assignment.annotator_id}`}
                                      checked={currentVisibility === 'never'}
                                      onChange={() =>
                                        handleAnnotatorVisibilityChange(
                                          assignment.annotator_id,
                                          'never',
                                        )
                                      }
                                      className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                                      aria-label={`Hide scavenger hunt activity for ${annotatorLabel}`}
                                    />
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="radio"
                                      name={`visibility-${assignment.annotator_id}`}
                                      checked={currentVisibility === 'after'}
                                      onChange={() =>
                                        handleAnnotatorVisibilityChange(
                                          assignment.annotator_id,
                                          'after',
                                        )
                                      }
                                      className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                                      aria-label={`Show scavenger hunt activity after completion for ${annotatorLabel}`}
                                    />
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="radio"
                                      name={`visibility-${assignment.annotator_id}`}
                                      checked={currentVisibility === 'always'}
                                      onChange={() =>
                                        handleAnnotatorVisibilityChange(
                                          assignment.annotator_id,
                                          'always',
                                        )
                                      }
                                      className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                                      aria-label={`Always show scavenger hunt activity for ${annotatorLabel}`}
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
                        No annotators are assigned to this scavenger hunt yet.
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
    </div>
  )
}
