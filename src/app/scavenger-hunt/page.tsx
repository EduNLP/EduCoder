'use client'

import {
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  LogOut,
  Pause,
  Play,
  Settings,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'

import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useTheme } from '@/context/ThemeContext'

type TranscriptRow = {
  id: string
  line: string
  speaker: string
  utterance: string
  inCue: number | null
  outCue: number | null
  segmentId: string | null
  flagged: boolean
}

type TranscriptSegment = {
  id: string
  title: string
  index: number
  startTime: number | null
  endTime: number | null
}

type AnnotationStatus = 'not_started' | 'in_progress' | 'completed'

type LlmAnnotationVisibilityAdmin =
  | 'hidden'
  | 'visible_after_completion'
  | 'always_visible'

type TranscriptMeta = {
  id: string
  title: string
  grade: string | null
  instructionContext: string
  annotationId: string
  status: AnnotationStatus
  annotationCompleted: boolean
  llmAnnotationVisibilityUser: boolean
  llmAnnotationVisibilityAdmin: LlmAnnotationVisibilityAdmin
  scavengerVisibilityAdmin: LlmAnnotationVisibilityAdmin
  scavengerCompleted?: boolean
  lastUpdated: string | null
}

type TranscriptResponse = {
  success: boolean
  transcript?: TranscriptMeta
  lines?: Array<{
    id: string
    line: number
    speaker: string
    utterance: string
    inCue?: number | string | null
    outCue?: number | string | null
    segmentId?: string | null
    flagged?: boolean
  }>
  segments?: Array<{
    id: string
    title: string
    index: number
    startTime?: number | string | null
    endTime?: number | string | null
  }>
  error?: string
}

type InstructionalMaterialResponse = {
  success: boolean
  items?: Array<{
    id: string
    url: string
    image_title: string
    description?: string | null
  }>
  instructional_material_link?: string | null
  error?: string
}

type InstructionCard = {
  id: string
  title: string
  imageUrl: string
  description?: string | null
}

type VideoMeta = {
  id: string
  fileName: string
  mimeType: string | null
  gcsPath: string
  uploadedAt: string
  url: string
}

type VideoResponse = {
  success: boolean
  video?: VideoMeta | null
  error?: string
}

type NoteEntry = {
  id: string
  number: number
  title: string
  q1: string
  q2: string
  q3: string
}

type NoteBadge = {
  id: string
  label: string
  colorClass: string
  number: number
  q1: string
  q2: string
  q3: string
}

type NoteAssignmentRecord = {
  noteId: string
  lineId: string
}

type NoteListResponse = {
  success: boolean
  notes?: NoteEntry[]
  assignments?: NoteAssignmentRecord[]
  llmNotes?: NoteEntry[]
  llmAssignments?: NoteAssignmentRecord[]
  error?: string
}

type ScavengerQuestionResponse = {
  success: boolean
  scavengerCompleted?: boolean
  scavengerHunt?: {
    id: string
    created_at: string
    questions: Array<{
      id: string
      question: string
      orderIndex: number
      answer?: string | null
      selectedLineIds?: string[]
    }>
  } | null
  error?: string
}

type SaveScavengerAnswerResponse = {
  success: boolean
  answer?: {
    questionId: string
    answer: string
    selectedLineIds: string[]
    updatedAt: string | null
  }
  error?: string
}

type UpdateScavengerCompletionResponse = {
  success: boolean
  completed?: boolean
  error?: string
}

type ScavengerQuestion = {
  key: string
  id: string | null
  prompt: string
  orderIndex: number
}

type ScavengerAnswerDraft = {
  answer: string
  selectedLineIds: string[]
}

type SpeakerColor = {
  rowBg: string
  hoverBg: string
  stickyBg: string
  selectedBg: string
  selectedStickyBg: string
  selectedBorder: string
  selectedRing: string
  selectedShadow: string
  chip: string
  border: string
}

const NOTE_FIELDS = [
  {
    id: 'q1',
    label: 'What are students saying in the selected piece(s) of evidence?',
  },
  {
    id: 'q2',
    label: 'What would you like to note about this utterance?',
  },
  {
    id: 'q3',
    label:
      "What does this utterance reveal about the student's thinking or understanding?",
  },
] as const

type NoteFieldId = (typeof NOTE_FIELDS)[number]['id']

const DEFAULT_QUESTION_PROMPTS = [
  'Which lines show students refining their reasoning after feedback?',
  'Where does a student shift strategies after a teacher prompt?',
  'Identify a moment where the class clarifies a misconception.',
]

const SCAVENGER_AUTOSAVE_DEBOUNCE_MS = 300
const SCAVENGER_SAVED_BADGE_DURATION_MS = 1200

const NOTE_BADGE_COLORS = [
  'border-sky-200 bg-sky-50 text-sky-700',
  'border-amber-200 bg-amber-50 text-amber-700',
  'border-rose-200 bg-rose-50 text-rose-700',
  'border-emerald-200 bg-emerald-50 text-emerald-700',
]

const NOTE_HIGHLIGHT_COLORS = [
  'bg-sky-400',
  'bg-amber-400',
  'bg-rose-400',
  'bg-emerald-400',
]

const speakerPalette: SpeakerColor[] = [
  {
    rowBg: 'bg-sky-50',
    hoverBg: 'hover:bg-sky-100',
    stickyBg: 'bg-sky-50',
    selectedBg: 'bg-sky-100',
    selectedStickyBg: 'bg-sky-100',
    selectedBorder: 'border-sky-200',
    selectedRing: 'ring-sky-200',
    selectedShadow: 'shadow-sky-100',
    chip: 'bg-transparent text-slate-800',
    border: 'border-sky-100',
  },
  {
    rowBg: 'bg-amber-50',
    hoverBg: 'hover:bg-amber-100',
    stickyBg: 'bg-amber-50',
    selectedBg: 'bg-amber-100',
    selectedStickyBg: 'bg-amber-100',
    selectedBorder: 'border-amber-200',
    selectedRing: 'ring-amber-200',
    selectedShadow: 'shadow-amber-100',
    chip: 'bg-transparent text-slate-800',
    border: 'border-amber-100',
  },
  {
    rowBg: 'bg-emerald-50',
    hoverBg: 'hover:bg-emerald-100',
    stickyBg: 'bg-emerald-50',
    selectedBg: 'bg-emerald-100',
    selectedStickyBg: 'bg-emerald-100',
    selectedBorder: 'border-emerald-200',
    selectedRing: 'ring-emerald-200',
    selectedShadow: 'shadow-emerald-100',
    chip: 'bg-transparent text-slate-800',
    border: 'border-emerald-100',
  },
  {
    rowBg: 'bg-indigo-50',
    hoverBg: 'hover:bg-indigo-100',
    stickyBg: 'bg-indigo-50',
    selectedBg: 'bg-indigo-100',
    selectedStickyBg: 'bg-indigo-100',
    selectedBorder: 'border-indigo-200',
    selectedRing: 'ring-indigo-200',
    selectedShadow: 'shadow-indigo-100',
    chip: 'bg-transparent text-slate-800',
    border: 'border-indigo-100',
  },
  {
    rowBg: 'bg-rose-50',
    hoverBg: 'hover:bg-rose-100',
    stickyBg: 'bg-rose-50',
    selectedBg: 'bg-rose-100',
    selectedStickyBg: 'bg-rose-100',
    selectedBorder: 'border-rose-200',
    selectedRing: 'ring-rose-200',
    selectedShadow: 'shadow-rose-100',
    chip: 'bg-transparent text-slate-800',
    border: 'border-rose-100',
  },
  {
    rowBg: 'bg-lime-50',
    hoverBg: 'hover:bg-lime-100',
    stickyBg: 'bg-lime-50',
    selectedBg: 'bg-lime-100',
    selectedStickyBg: 'bg-lime-100',
    selectedBorder: 'border-lime-200',
    selectedRing: 'ring-lime-200',
    selectedShadow: 'shadow-lime-100',
    chip: 'bg-transparent text-slate-800',
    border: 'border-lime-100',
  },
]

const fallbackSpeakerColor: SpeakerColor = {
  rowBg: 'bg-slate-50',
  hoverBg: 'hover:bg-slate-100',
  stickyBg: 'bg-slate-50',
  selectedBg: 'bg-slate-100',
  selectedStickyBg: 'bg-slate-100',
  selectedBorder: 'border-slate-200',
  selectedRing: 'ring-slate-200',
  selectedShadow: 'shadow-slate-100',
  chip: 'bg-transparent text-slate-800',
  border: 'border-slate-100',
}

const badgeToneStyles: Record<'indigo' | 'emerald' | 'amber', string> = {
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
}

const WHITE_VIDEO_POSTER =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22%3E%3Crect width=%2216%22 height=%229%22 fill=%22white%22/%3E%3C/svg%3E'

const parseCueValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const formatTimestamp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '--:--'
  const totalSeconds = Math.max(0, Math.floor(value))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const createNoteBadges = (notes: NoteEntry[]) =>
  notes.map((note, index) => ({
    id: note.id,
    label: note.title.trim() || `Note ${note.number}`,
    colorClass: NOTE_BADGE_COLORS[index % NOTE_BADGE_COLORS.length],
    number: note.number,
    q1: note.q1,
    q2: note.q2,
    q3: note.q3,
  }))

const createAssignmentLookup = (assignments: NoteAssignmentRecord[]) =>
  assignments.reduce((acc, assignment) => {
    if (!acc[assignment.lineId]) {
      acc[assignment.lineId] = {}
    }
    acc[assignment.lineId][assignment.noteId] = true
    return acc
  }, {} as Record<string, Record<string, boolean>>)

const createAssignmentListLookup = (assignments: NoteAssignmentRecord[]) =>
  assignments.reduce((acc, assignment) => {
    if (!acc[assignment.lineId]) {
      acc[assignment.lineId] = []
    }
    acc[assignment.lineId].push(assignment.noteId)
    return acc
  }, {} as Record<string, string[]>)

const createExpandedMap = (notes: NoteEntry[]) =>
  notes.reduce((acc, note) => {
    acc[note.id] = false
    return acc
  }, {} as Record<string, boolean>)

const createScavengerQuestionKey = (questionId: string | null, index: number) =>
  questionId ? questionId : `default-${index + 1}`

const createDefaultScavengerQuestions = (): ScavengerQuestion[] =>
  DEFAULT_QUESTION_PROMPTS.map((prompt, index) => ({
    key: createScavengerQuestionKey(null, index),
    id: null,
    prompt,
    orderIndex: index + 1,
  }))

const createEmptyScavengerAnswerDraft = (): ScavengerAnswerDraft => ({
  answer: '',
  selectedLineIds: [],
})

const normalizeLineIds = (lineIds: string[]) =>
  Array.from(new Set(lineIds.map((lineId) => lineId.trim()).filter(Boolean)))

const normalizeScavengerDraft = (
  draft: ScavengerAnswerDraft,
): ScavengerAnswerDraft => ({
  answer: draft.answer,
  selectedLineIds: normalizeLineIds(draft.selectedLineIds),
})

const cloneScavengerDraft = (
  draft: ScavengerAnswerDraft,
): ScavengerAnswerDraft => ({
  answer: draft.answer,
  selectedLineIds: [...draft.selectedLineIds],
})

const cloneScavengerDraftMap = (
  drafts: Record<string, ScavengerAnswerDraft>,
) =>
  Object.entries(drafts).reduce((acc, [key, draft]) => {
    acc[key] = cloneScavengerDraft(draft)
    return acc
  }, {} as Record<string, ScavengerAnswerDraft>)

const areScavengerDraftsEqual = (
  first: ScavengerAnswerDraft,
  second: ScavengerAnswerDraft,
) => {
  if (first.answer !== second.answer) {
    return false
  }
  if (first.selectedLineIds.length !== second.selectedLineIds.length) {
    return false
  }
  return first.selectedLineIds.every((lineId, index) => lineId === second.selectedLineIds[index])
}

const buildScavengerDraftMap = (
  questions: ScavengerQuestion[],
) =>
  questions.reduce((acc, question) => {
    acc[question.key] = createEmptyScavengerAnswerDraft()
    return acc
  }, {} as Record<string, ScavengerAnswerDraft>)

type NotePanelProps = {
  title: string
  description: string
  notes: NoteEntry[]
  badgeTone?: 'indigo' | 'emerald' | 'amber'
  expandedNotes: Record<string, boolean>
  onToggleExpanded: (noteId: string) => void
  emptyState: string
  className?: string
}

function NotePanel({
  title,
  description,
  notes,
  badgeTone = 'indigo',
  expandedNotes,
  onToggleExpanded,
  emptyState,
  className,
}: NotePanelProps) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/60 ${
        className ?? ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">{title}</p>
          {description ? <p className="text-sm text-slate-500">{description}</p> : null}
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeToneStyles[badgeTone]}`}
        >
          {notes.length} notes
        </span>
      </div>
      <div className="stealth-scrollbar mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {notes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
            {emptyState}
          </div>
        ) : (
          notes.map((note) => {
            const isExpanded = Boolean(expandedNotes[note.id])
            return (
              <div
                key={note.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 transition"
              >
                <button
                  type="button"
                  onClick={() => onToggleExpanded(note.id)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center px-3 py-3 text-left"
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">{note.title}</p>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>
                {isExpanded && (
                  <div className="border-t border-slate-200/70 px-3 py-3">
                    <div className="divide-y divide-slate-200/60">
                      <div className="space-y-1 pb-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                          Title
                        </p>
                        <p className="text-sm font-medium leading-6 tracking-normal text-slate-700">
                          {note.title}
                        </p>
                      </div>
                      {NOTE_FIELDS.map((field) => (
                        <div key={field.id} className="space-y-1 pt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            {field.label}
                          </p>
                          <p className="text-sm font-medium leading-6 tracking-normal text-slate-700">
                            {note[field.id as NoteFieldId]}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

export default function ScavengerHuntPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()

  const [questionIndex, setQuestionIndex] = useState(0)
  const [scavengerQuestions, setScavengerQuestions] = useState<ScavengerQuestion[]>(
    () => createDefaultScavengerQuestions(),
  )
  const [answersByQuestionKey, setAnswersByQuestionKey] = useState<
    Record<string, ScavengerAnswerDraft>
  >(() => {
    const defaultQuestions = createDefaultScavengerQuestions()
    return buildScavengerDraftMap(defaultQuestions)
  })
  const [scavengerAutosaveError, setScavengerAutosaveError] = useState<string | null>(
    null,
  )
  const [showSavedBadge, setShowSavedBadge] = useState(false)
  const [isMarkingScavengerComplete, setIsMarkingScavengerComplete] = useState(false)
  const [scavengerCompletionError, setScavengerCompletionError] = useState<string | null>(
    null,
  )

  const [transcriptMeta, setTranscriptMeta] = useState<TranscriptMeta | null>(null)
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([])
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([])
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [rowFlags, setRowFlags] = useState<Record<string, boolean>>({})

  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [isLessonResourcesModalOpen, setIsLessonResourcesModalOpen] = useState(false)
  const [instructionCards, setInstructionCards] = useState<InstructionCard[]>([])
  const [isLoadingInstructionCards, setIsLoadingInstructionCards] = useState(false)
  const [instructionCardsError, setInstructionCardsError] = useState<string | null>(null)
  const [instructionalMaterialLink, setInstructionalMaterialLink] = useState<string | null>(
    null,
  )
  const [activeInstructionSlideIndex, setActiveInstructionSlideIndex] = useState(0)

  const [videoSource, setVideoSource] = useState<VideoMeta | null>(null)
  const [videoSourceError, setVideoSourceError] = useState<string | null>(null)

  const [userNotes, setUserNotes] = useState<NoteEntry[]>([])
  const [llmNotes, setLlmNotes] = useState<NoteEntry[]>([])
  const [notesError, setNotesError] = useState<string | null>(null)
  const [noteBadges, setNoteBadges] = useState<NoteBadge[]>([])
  const [rowAssignedNotes, setRowAssignedNotes] = useState<
    Record<string, Record<string, boolean>>
  >({})
  const [llmNoteAssignmentsByRow, setLlmNoteAssignmentsByRow] = useState<
    Record<string, string[]>
  >({})

  const [expandedUserNotes, setExpandedUserNotes] = useState<Record<string, boolean>>(
    {},
  )
  const [expandedLlmNotes, setExpandedLlmNotes] = useState<Record<string, boolean>>(
    {},
  )

  const [showTranscriptScrollbar, setShowTranscriptScrollbar] = useState(false)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [isDragSelecting, setIsDragSelecting] = useState(false)

  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false)
  const [showVideoControls, setShowVideoControls] = useState(false)
  const [showVideoPlayOverlay, setShowVideoPlayOverlay] = useState(true)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [videoVolume, setVideoVolume] = useState(0.8)
  const [isVideoMuted, setIsVideoMuted] = useState(false)
  const [segmentPlaybackTime, setSegmentPlaybackTime] = useState(0)
  const [timelineNoteFilter, setTimelineNoteFilter] = useState<string | null>(null)
  const [timelineSettingsOpen, setTimelineSettingsOpen] = useState(false)
  const [activePlaybackRowId, setActivePlaybackRowId] = useState<string | null>(null)

  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptScrollbarTimeout = useRef<number | undefined>(undefined)
  const videoContainerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const timelineSettingsRef = useRef<HTMLDivElement | null>(null)
  const activeTranscriptFetchRef = useRef<string | null>(null)
  const playbackRowRef = useRef<string | null>(null)
  const answersByQuestionRef = useRef<Record<string, ScavengerAnswerDraft>>({})
  const savedAnswersByQuestionRef = useRef<Record<string, ScavengerAnswerDraft>>({})
  const autosaveTimeoutsRef = useRef<Record<string, number>>({})
  const autosaveAbortControllersRef = useRef<Record<string, AbortController>>({})
  const savedBadgeTimeout = useRef<number | undefined>(undefined)
  const dragStateRef = useRef<{
    isPointerDown: boolean
    hasDragged: boolean
    startRowId: string | null
    startX: number
    startY: number
  }>({
    isPointerDown: false,
    hasDragged: false,
    startRowId: null,
    startX: 0,
    startY: 0,
  })
  const skipClickRef = useRef<string | null>(null)

  const pageBackgroundStyle = useMemo(
    () => ({
      backgroundColor: theme.backgroundColor,
      backgroundImage: theme.backgroundImage ?? 'none',
    }),
    [theme],
  )

  const requestedTranscriptId =
    searchParams?.get('transcript')?.trim() ||
    searchParams?.get('transcriptId')?.trim() ||
    null

  const currentQuestion = scavengerQuestions[questionIndex] ?? null
  const currentQuestionDraft = useMemo(
    () =>
      currentQuestion
        ? answersByQuestionKey[currentQuestion.key] ?? createEmptyScavengerAnswerDraft()
        : createEmptyScavengerAnswerDraft(),
    [answersByQuestionKey, currentQuestion],
  )
  const response = currentQuestionDraft.answer
  const checkedRows = useMemo(
    () =>
      currentQuestionDraft.selectedLineIds.reduce((acc, lineId) => {
        acc[lineId] = true
        return acc
      }, {} as Record<string, boolean>),
    [currentQuestionDraft.selectedLineIds],
  )

  const isScavengerComplete = Boolean(transcriptMeta?.scavengerCompleted)
  const scavengerMenuLinks = useMemo(
    () => [
      {
        id: 'complete',
        label: isMarkingScavengerComplete
          ? 'Updating status...'
          : isScavengerComplete
            ? 'Mark as In Progress'
            : 'Mark as Complete',
        icon: BookmarkCheck,
      },
      { id: 'annotations', label: 'Annotations', icon: FileText },
      { id: 'logout', label: 'Log Out', icon: LogOut },
    ],
    [isMarkingScavengerComplete, isScavengerComplete],
  )

  const isAnnotationComplete = Boolean(transcriptMeta?.annotationCompleted)
  const llmAnnotationVisibilityAdmin =
    transcriptMeta?.llmAnnotationVisibilityAdmin ?? 'hidden'
  const canShowLlmAnnotations =
    llmAnnotationVisibilityAdmin === 'always_visible' ||
    (llmAnnotationVisibilityAdmin === 'visible_after_completion' &&
      isAnnotationComplete)
  const shouldShowLlmAnnotations =
    canShowLlmAnnotations && Boolean(transcriptMeta?.llmAnnotationVisibilityUser)

  const llmNotesById = useMemo(
    () =>
      llmNotes.reduce((acc, note) => {
        acc[note.id] = note
        return acc
      }, {} as Record<string, NoteEntry>),
    [llmNotes],
  )

  const activeSegment = transcriptSegments[activeSegmentIndex] ?? null
  const hasMultipleSegments = transcriptSegments.length > 1

  const activeSegmentRows = useMemo(() => {
    if (!activeSegment || !hasMultipleSegments) {
      return transcriptRows
    }
    return transcriptRows.filter((row) => row.segmentId === activeSegment.id)
  }, [activeSegment, hasMultipleSegments, transcriptRows])

  const speakerColorMap = useMemo(
    () =>
      Array.from(new Set(activeSegmentRows.map((row) => row.speaker))).reduce(
        (acc, speaker, index) => {
          acc[speaker] = speakerPalette[index % speakerPalette.length]
          return acc
        },
        {} as Record<string, SpeakerColor>,
      ),
    [activeSegmentRows],
  )

  const rowsWithCues = useMemo(() => {
    const rows = activeSegmentRows.filter((row) => row.inCue !== null)
    return rows.sort((rowA, rowB) => (rowA.inCue ?? 0) - (rowB.inCue ?? 0))
  }, [activeSegmentRows])

  const segmentTimeRange = useMemo(() => {
    const cueStarts: number[] = []
    const cueEnds: number[] = []

    activeSegmentRows.forEach((row) => {
      if (typeof row.inCue === 'number' && Number.isFinite(row.inCue)) {
        cueStarts.push(row.inCue)
      }
      const endCandidate = row.outCue ?? row.inCue
      if (typeof endCandidate === 'number' && Number.isFinite(endCandidate)) {
        cueEnds.push(endCandidate)
      }
    })

    const fallbackStart = cueStarts.length > 0 ? Math.min(...cueStarts) : null
    const fallbackEnd = cueEnds.length > 0 ? Math.max(...cueEnds) : null
    const rawStart = activeSegment?.startTime ?? fallbackStart ?? 0
    const startTime =
      typeof rawStart === 'number' && Number.isFinite(rawStart)
        ? Math.max(rawStart, 0)
        : 0
    const rawEnd = activeSegment?.endTime ?? fallbackEnd ?? videoDuration ?? null
    const endTime =
      typeof rawEnd === 'number' && Number.isFinite(rawEnd)
        ? Math.max(rawEnd, startTime)
        : null
    const duration = endTime !== null ? Math.max(endTime - startTime, 0) : null

    return { startTime, endTime, duration }
  }, [activeSegment?.endTime, activeSegment?.startTime, activeSegmentRows, videoDuration])

  const segmentStartTime = segmentTimeRange.startTime
  const segmentEndTime = segmentTimeRange.endTime
  const segmentDuration = segmentTimeRange.duration

  const clampVideoTimeToSegment = useCallback(
    (time: number) => {
      if (time < segmentStartTime) return segmentStartTime
      if (segmentEndTime !== null && time > segmentEndTime) return segmentEndTime
      return time
    },
    [segmentEndTime, segmentStartTime],
  )

  const applySegmentTime = useCallback(
    (absoluteTime: number) => {
      if (!Number.isFinite(absoluteTime)) return
      const clampedTime = clampVideoTimeToSegment(absoluteTime)
      const videoElement = videoRef.current
      if (videoElement) {
        videoElement.currentTime = clampedTime
      }
      setSegmentPlaybackTime(Math.max(0, clampedTime - segmentStartTime))
    },
    [clampVideoTimeToSegment, segmentStartTime],
  )

  const resetSegmentPlayback = useCallback(() => {
    const videoElement = videoRef.current
    if (videoElement) {
      videoElement.pause()
      videoElement.currentTime = segmentStartTime
    }
    setSegmentPlaybackTime(0)
    setHasPlayedOnce(false)
    setShowVideoPlayOverlay(true)
    setShowVideoControls(false)
    setIsVideoPlaying(false)
  }, [segmentStartTime])

  const noteHighlightColorMap = useMemo(
    () =>
      noteBadges.reduce((acc, note, index) => {
        acc[note.id] = NOTE_HIGHLIGHT_COLORS[index % NOTE_HIGHLIGHT_COLORS.length]
        return acc
      }, {} as Record<string, string>),
    [noteBadges],
  )

  const timelineHighlightColorClass =
    (timelineNoteFilter ? noteHighlightColorMap[timelineNoteFilter] : null) ??
    'bg-indigo-400'

  const timelineNoteSegments = useMemo(() => {
    if (!timelineNoteFilter) return []
    const duration = segmentDuration
    if (!duration || !Number.isFinite(duration) || duration <= 0) return []

    return rowsWithCues.reduce<Array<{ start: number; end: number; rowId: string }>>(
      (segments, row, index) => {
        if (!rowAssignedNotes[row.id]?.[timelineNoteFilter]) {
          return segments
        }

        const absoluteStart = row.inCue
        if (typeof absoluteStart !== 'number' || !Number.isFinite(absoluteStart)) {
          return segments
        }

        const nextStartCandidate =
          row.outCue ?? rowsWithCues[index + 1]?.inCue ?? segmentEndTime ?? absoluteStart
        const absoluteEnd =
          typeof nextStartCandidate === 'number' && Number.isFinite(nextStartCandidate)
            ? nextStartCandidate
            : absoluteStart
        const relativeStart = absoluteStart - segmentStartTime
        const relativeEnd = absoluteEnd - segmentStartTime
        if (relativeEnd <= 0 || relativeStart >= duration) {
          return segments
        }

        const clampedStart = Math.max(relativeStart, 0)
        const clampedEnd = Math.min(relativeEnd, duration)
        const safeEnd =
          clampedEnd > clampedStart
            ? clampedEnd
            : Math.min(duration, clampedStart + 0.5)

        segments.push({
          start: clampedStart,
          end: safeEnd,
          rowId: row.id,
        })

        return segments
      },
      [],
    )
  }, [
    rowAssignedNotes,
    rowsWithCues,
    segmentDuration,
    segmentEndTime,
    segmentStartTime,
    timelineNoteFilter,
  ])

  const findRowForTime = useCallback(
    (currentTime: number) => {
      if (!rowsWithCues.length) return null
      const firstRow = rowsWithCues[0]
      if (!firstRow) return null
      if (currentTime < (firstRow.inCue ?? 0)) {
        return firstRow
      }

      for (let index = 0; index < rowsWithCues.length; index += 1) {
        const row = rowsWithCues[index]
        const start = row.inCue ?? 0
        const nextStart = rowsWithCues[index + 1]?.inCue ?? Number.POSITIVE_INFINITY
        const end = row.outCue ?? nextStart

        if (currentTime >= start && currentTime < end) {
          return row
        }

        if (currentTime >= end && currentTime < nextStart) {
          return row
        }
      }

      return rowsWithCues[rowsWithCues.length - 1]
    },
    [rowsWithCues],
  )

  const scrollRowIntoView = useCallback((rowId: string, alignToTop = false) => {
    const container = transcriptScrollRef.current
    const rowElement = document.querySelector<HTMLTableRowElement>(
      `[data-row-id="${rowId}"]`,
    )
    if (!rowElement) return

    window.requestAnimationFrame(() => {
      if (container && container.contains(rowElement)) {
        const containerRect = container.getBoundingClientRect()
        const rowRect = rowElement.getBoundingClientRect()
        const offsetTop = rowRect.top - containerRect.top + container.scrollTop
        const targetTop = alignToTop ? offsetTop : Math.max(offsetTop - 24, 0)
        container.scrollTo({
          top: targetTop,
          behavior: 'smooth',
        })
        return
      }

      rowElement.scrollIntoView({
        behavior: 'smooth',
        block: alignToTop ? 'start' : 'nearest',
        inline: 'nearest',
      })
    })
  }, [])

  const filteredRows = activeSegmentRows

  const lineColumnWidth = '6.5rem'
  const speakerColumnWidth = '8.25rem'
  const noteColumnWidth = '12rem'
  const hasVideo = Boolean(videoSource?.url)
  const isTranscriptEmpty = hasVideo
    ? activeSegmentRows.length === 0
    : transcriptRows.length === 0
  const hasRowsForFilters = hasVideo
    ? activeSegmentRows.length > 0
    : transcriptRows.length > 0

  const tableHeadClass = hasVideo
    ? 'rounded-2xl bg-white'
    : 'sticky top-0 z-20 rounded-2xl bg-white/95 backdrop-blur'
  const lineHeaderClass = hasVideo
    ? 'bg-white px-3 py-2 align-middle'
    : 'sticky left-0 top-0 z-30 bg-white px-3 py-3 backdrop-blur'
  const speakerHeaderClass = hasVideo
    ? 'bg-white px-3 py-2 align-middle'
    : 'sticky top-0 z-30 bg-white px-3 py-3 backdrop-blur'
  const standardHeaderClass = hasVideo
    ? 'bg-white px-3 py-2 align-middle'
    : 'sticky top-0 z-10 bg-white px-3 py-3'

  const activeSegmentLabel = hasMultipleSegments
    ? `Section ${activeSegmentIndex + 1} of ${transcriptSegments.length}`
    : null
  const hasPreviousSegment = hasMultipleSegments && activeSegmentIndex > 0
  const hasNextSegment =
    hasMultipleSegments && activeSegmentIndex < transcriptSegments.length - 1

  const segmentPlaybackValue =
    segmentDuration && segmentDuration > 0
      ? Math.min(segmentPlaybackTime, segmentDuration)
      : 0
  const isSegmentSeekEnabled =
    hasVideo && Boolean(segmentDuration && segmentDuration > 0)

  const resolvedVideoMimeType = useMemo(() => {
    const rawMimeType = videoSource?.mimeType?.trim().toLowerCase()
    if (!rawMimeType) return 'video/mp4'
    if (typeof document === 'undefined') {
      return rawMimeType === 'video/quicktime' ? 'video/mp4' : rawMimeType
    }
    const canPlay = document.createElement('video').canPlayType(rawMimeType)
    if (canPlay) return rawMimeType
    return rawMimeType === 'video/quicktime' ? 'video/mp4' : rawMimeType
  }, [videoSource?.mimeType])

  const shouldShowPlayOverlay = hasVideo && !hasPlayedOnce && showVideoPlayOverlay

  const triggerSavedBadge = useCallback(() => {
    setShowSavedBadge(true)
    if (savedBadgeTimeout.current) {
      window.clearTimeout(savedBadgeTimeout.current)
    }
    savedBadgeTimeout.current = window.setTimeout(() => {
      setShowSavedBadge(false)
    }, SCAVENGER_SAVED_BADGE_DURATION_MS)
  }, [])

  const clearScavengerAutosaveState = useCallback(() => {
    Object.values(autosaveTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    autosaveTimeoutsRef.current = {}

    Object.values(autosaveAbortControllersRef.current).forEach((controller) => {
      controller.abort()
    })
    autosaveAbortControllersRef.current = {}

    if (savedBadgeTimeout.current) {
      window.clearTimeout(savedBadgeTimeout.current)
      savedBadgeTimeout.current = undefined
    }
    setShowSavedBadge(false)
    savedAnswersByQuestionRef.current = {}
    setScavengerAutosaveError(null)
  }, [])

  const saveScavengerDraft = useCallback(
    async (question: ScavengerQuestion, draft: ScavengerAnswerDraft) => {
      if (!question.id) {
        return
      }

      const transcriptId =
        activeTranscriptFetchRef.current ?? transcriptMeta?.id ?? requestedTranscriptId
      if (!transcriptId) {
        return
      }

      const normalizedDraft = normalizeScavengerDraft(draft)
      const existingController = autosaveAbortControllersRef.current[question.key]
      if (existingController) {
        existingController.abort()
      }

      const controller = new AbortController()
      autosaveAbortControllersRef.current[question.key] = controller

      try {
        const response = await fetch(
          `/api/annotator/transcripts/${encodeURIComponent(
            transcriptId,
          )}/scavenger-hunt?transcriptId=${encodeURIComponent(transcriptId)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              questionId: question.id,
              answer: normalizedDraft.answer,
              lineIds: normalizedDraft.selectedLineIds,
            }),
            signal: controller.signal,
          },
        )

        const payload: SaveScavengerAnswerResponse | null = await response
          .json()
          .catch(() => null)

        if (!response.ok || !payload?.success) {
          const message = payload?.error ?? 'Unable to auto-save scavenger response.'
          throw new Error(message)
        }

        const savedDraft = normalizeScavengerDraft({
          answer: payload.answer?.answer ?? normalizedDraft.answer,
          selectedLineIds:
            payload.answer?.selectedLineIds ?? normalizedDraft.selectedLineIds,
        })

        savedAnswersByQuestionRef.current[question.key] = cloneScavengerDraft(savedDraft)
        setScavengerAutosaveError(null)
        const latestDraftForQuestion =
          answersByQuestionRef.current[question.key] ?? createEmptyScavengerAnswerDraft()
        const draftUnchangedSinceRequest = areScavengerDraftsEqual(
          latestDraftForQuestion,
          normalizedDraft,
        )

        if (!draftUnchangedSinceRequest) {
          return
        }

        triggerSavedBadge()

        setAnswersByQuestionKey((previous) => {
          const currentDraft =
            previous[question.key] ?? createEmptyScavengerAnswerDraft()
          if (areScavengerDraftsEqual(currentDraft, savedDraft)) {
            return previous
          }

          const next = {
            ...previous,
            [question.key]: savedDraft,
          }
          answersByQuestionRef.current = next
          return next
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to auto-save scavenger response', error)
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to auto-save scavenger response.'
        setScavengerAutosaveError(message)
      } finally {
        if (autosaveAbortControllersRef.current[question.key] === controller) {
          delete autosaveAbortControllersRef.current[question.key]
        }
      }
    },
    [requestedTranscriptId, transcriptMeta?.id, triggerSavedBadge],
  )

  const queueScavengerAutosave = useCallback(
    (question: ScavengerQuestion, draft: ScavengerAnswerDraft) => {
      if (!question.id) {
        return
      }

      const normalizedDraft = normalizeScavengerDraft(draft)
      const savedDraft = savedAnswersByQuestionRef.current[question.key]
      if (savedDraft && areScavengerDraftsEqual(savedDraft, normalizedDraft)) {
        const existingTimeout = autosaveTimeoutsRef.current[question.key]
        if (existingTimeout) {
          window.clearTimeout(existingTimeout)
          delete autosaveTimeoutsRef.current[question.key]
        }
        return
      }

      const existingTimeout = autosaveTimeoutsRef.current[question.key]
      if (existingTimeout) {
        window.clearTimeout(existingTimeout)
      }

      autosaveTimeoutsRef.current[question.key] = window.setTimeout(() => {
        delete autosaveTimeoutsRef.current[question.key]
        const latestDraft =
          answersByQuestionRef.current[question.key] ?? createEmptyScavengerAnswerDraft()
        const normalizedLatestDraft = normalizeScavengerDraft(latestDraft)
        const latestSavedDraft = savedAnswersByQuestionRef.current[question.key]
        if (
          latestSavedDraft &&
          areScavengerDraftsEqual(latestSavedDraft, normalizedLatestDraft)
        ) {
          return
        }
        void saveScavengerDraft(question, normalizedLatestDraft)
      }, SCAVENGER_AUTOSAVE_DEBOUNCE_MS)
    },
    [saveScavengerDraft],
  )

  const updateCurrentQuestionDraft = useCallback(
    (updater: (draft: ScavengerAnswerDraft) => ScavengerAnswerDraft) => {
      if (!currentQuestion) {
        return
      }

      setAnswersByQuestionKey((previous) => {
        const currentDraft =
          previous[currentQuestion.key] ?? createEmptyScavengerAnswerDraft()
        const nextDraft = normalizeScavengerDraft(updater(currentDraft))

        if (areScavengerDraftsEqual(currentDraft, nextDraft)) {
          return previous
        }

        const next = {
          ...previous,
          [currentQuestion.key]: nextDraft,
        }
        answersByQuestionRef.current = next
        queueScavengerAutosave(currentQuestion, nextDraft)
        return next
      })
    },
    [currentQuestion, queueScavengerAutosave],
  )

  const handleResponseChange = useCallback(
    (nextAnswer: string) => {
      updateCurrentQuestionDraft((draft) => ({
        ...draft,
        answer: nextAnswer,
      }))
    },
    [updateCurrentQuestionDraft],
  )

  const selectRow = useCallback(
    (rowId: string) => {
      setSelectedRow(rowId)
      updateCurrentQuestionDraft((draft) => ({
        ...draft,
        selectedLineIds: [rowId],
      }))
    },
    [updateCurrentQuestionDraft],
  )

  const selectedRows = useMemo(
    () => transcriptRows.filter((row) => checkedRows[row.id]),
    [checkedRows, transcriptRows],
  )

  const selectedLineText =
    selectedRows.length > 0
      ? selectedRows
          .map((row) => Number.parseInt(row.line, 10))
          .filter((line) => Number.isFinite(line))
          .join(', ')
      : 'None'
  const hasInstructionCards = instructionCards.length > 0
  const activeInstructionCard = hasInstructionCards
    ? instructionCards[Math.min(activeInstructionSlideIndex, instructionCards.length - 1)] ?? null
    : null

  const handleBackToWorkspace = () => {
    router.push('/workspace')
  }

  const handleMarkScavengerComplete = useCallback(
    async (completed: boolean) => {
      if (isMarkingScavengerComplete) return

      const transcriptId = transcriptMeta?.id ?? requestedTranscriptId
      if (!transcriptId) {
        setScavengerCompletionError('Select a transcript before updating the status.')
        return
      }

      setIsMarkingScavengerComplete(true)
      setScavengerCompletionError(null)

      try {
        const response = await fetch(
          `/api/annotator/transcripts/${encodeURIComponent(
            transcriptId,
          )}/scavenger-hunt?transcriptId=${encodeURIComponent(transcriptId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed }),
          },
        )
        const payload: UpdateScavengerCompletionResponse | null = await response
          .json()
          .catch(() => null)

        if (!response.ok || !payload?.success) {
          const message =
            payload?.error ?? 'Unable to update scavenger completion status.'
          throw new Error(message)
        }

        const nextCompleted =
          typeof payload.completed === 'boolean' ? payload.completed : completed
        setTranscriptMeta((previous) =>
          previous ? { ...previous, scavengerCompleted: nextCompleted } : previous,
        )
        triggerSavedBadge()
      } catch (error) {
        console.error('Failed to update scavenger completion status', error)
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to update scavenger completion status.'
        setScavengerCompletionError(message)
      } finally {
        setIsMarkingScavengerComplete(false)
      }
    },
    [
      isMarkingScavengerComplete,
      requestedTranscriptId,
      transcriptMeta?.id,
      triggerSavedBadge,
    ],
  )

  const handleMenuLinkAction = useCallback(
    (link: { id: string }) => {
      if (link.id === 'complete') {
        void handleMarkScavengerComplete(!isScavengerComplete)
        return
      }

      if (link.id === 'annotations') {
        const transcriptId = transcriptMeta?.id ?? requestedTranscriptId
        const nextPath = transcriptId
          ? `/annotate?transcript=${encodeURIComponent(transcriptId)}`
          : '/annotate'
        router.push(nextPath)
      }
    },
    [
      handleMarkScavengerComplete,
      isScavengerComplete,
      requestedTranscriptId,
      router,
      transcriptMeta?.id,
    ],
  )

  const closeLessonResourcesModal = useCallback(() => {
    setIsLessonResourcesModalOpen(false)
  }, [])

  const showPreviousInstructionSlide = useCallback(() => {
    if (instructionCards.length <= 1) return
    setActiveInstructionSlideIndex((currentIndex) =>
      currentIndex > 0 ? currentIndex - 1 : instructionCards.length - 1,
    )
  }, [instructionCards.length])

  const showNextInstructionSlide = useCallback(() => {
    if (instructionCards.length <= 1) return
    setActiveInstructionSlideIndex((currentIndex) =>
      currentIndex < instructionCards.length - 1 ? currentIndex + 1 : 0,
    )
  }, [instructionCards.length])

  const handleLessonResourcesClick = () => {
    const transcriptId = transcriptMeta?.id ?? requestedTranscriptId
    if (transcriptId) {
      void loadInstructionalMaterials(transcriptId)
    } else {
      setInstructionCards([])
      setInstructionCardsError('Select a transcript to load lesson resources.')
      setInstructionalMaterialLink(null)
      setIsLoadingInstructionCards(false)
      setActiveInstructionSlideIndex(0)
    }
    setIsLessonResourcesModalOpen(true)
  }

  const markRowCheckedDuringDrag = (rowId: string) => {
    updateCurrentQuestionDraft((draft) => {
      if (draft.selectedLineIds.includes(rowId)) {
        return draft
      }
      return {
        ...draft,
        selectedLineIds: [...draft.selectedLineIds, rowId],
      }
    })
  }

  const startDragSelection = (rowId: string) => {
    dragStateRef.current.hasDragged = true
    setIsDragSelecting(true)
    setSelectedRow(null)
    markRowCheckedDuringDrag(rowId)
    const selection = window.getSelection?.()
    selection?.removeAllRanges?.()
  }

  const maybeStartDragSelection = (
    rowId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    const state = dragStateRef.current
    if (!state.isPointerDown || state.hasDragged) return
    const deltaX = Math.abs(event.clientX - state.startX)
    const deltaY = Math.abs(event.clientY - state.startY)
    if (deltaX + deltaY > 3) {
      startDragSelection(state.startRowId ?? rowId)
      if (state.startRowId && state.startRowId !== rowId) {
        markRowCheckedDuringDrag(rowId)
      }
    }
  }

  const handleRowMouseDown = (
    rowId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    if (event.button !== 0) return
    dragStateRef.current.isPointerDown = true
    dragStateRef.current.hasDragged = false
    dragStateRef.current.startRowId = rowId
    dragStateRef.current.startX = event.clientX
    dragStateRef.current.startY = event.clientY
    skipClickRef.current = null
  }

  const handleRowPointerDrag = (
    rowId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    if (!dragStateRef.current.isPointerDown) return
    maybeStartDragSelection(rowId, event)
    if (dragStateRef.current.hasDragged) {
      markRowCheckedDuringDrag(rowId)
    }
  }

  const handleRowMouseUp = (rowId: string) => {
    if (
      dragStateRef.current.hasDragged &&
      dragStateRef.current.startRowId === rowId
    ) {
      skipClickRef.current = rowId
    }
  }

  const toggleRowCheckbox = (rowId: string) => {
    updateCurrentQuestionDraft((draft) => {
      const isSelected = draft.selectedLineIds.includes(rowId)
      return {
        ...draft,
        selectedLineIds: isSelected
          ? draft.selectedLineIds.filter((lineId) => lineId !== rowId)
          : [...draft.selectedLineIds, rowId],
      }
    })
  }

  const handleRowSelection = useCallback(
    (rowId: string) => {
      if (isDragSelecting) return
      if (skipClickRef.current) {
        if (skipClickRef.current === rowId) {
          skipClickRef.current = null
          return
        }
        skipClickRef.current = null
      }
      selectRow(rowId)
    },
    [isDragSelecting, selectRow],
  )

  const handleRowDoubleClick = useCallback(
    (rowId: string) => {
      const videoElement = videoRef.current
      if (!videoElement) return
      const row = activeSegmentRows.find((entry) => entry.id === rowId)
      if (!row) return
      const cueTime = row.inCue ?? row.outCue
      if (cueTime === null || cueTime === undefined) return
      if (!Number.isFinite(cueTime)) return

      applySegmentTime(Math.max(cueTime, 0))
      const playPromise = videoElement.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          /* Ignore autoplay rejection; user can tap play */
        })
      }
      setActivePlaybackRowId(row.id)
      playbackRowRef.current = row.id
    },
    [activeSegmentRows, applySegmentTime],
  )

  const handleTimelineNoteSelect = useCallback((noteId: string | null) => {
    setTimelineSettingsOpen(false)
    setTimelineNoteFilter((previous) =>
      previous === noteId ? null : noteId,
    )
  }, [])

  const handleUserNoteBadgeToggle = useCallback((noteId: string) => {
    setExpandedUserNotes((previous) => ({
      ...previous,
      [noteId]: !previous[noteId],
    }))
  }, [])

  const handleLlmNoteBadgeToggle = useCallback((noteId: string) => {
    setExpandedLlmNotes((previous) => ({
      ...previous,
      [noteId]: !previous[noteId],
    }))
  }, [])

  const handleVideoPlayClick = () => {
    const videoElement = videoRef.current
    if (!videoElement) return
    if (
      videoElement.currentTime < segmentStartTime ||
      (segmentEndTime !== null && videoElement.currentTime >= segmentEndTime)
    ) {
      videoElement.currentTime = segmentStartTime
      setSegmentPlaybackTime(0)
    }
    const playPromise = videoElement.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (!hasPlayedOnce) setShowVideoPlayOverlay(true)
      })
    }
  }

  const handleVideoPlay = () => {
    setHasPlayedOnce(true)
    setShowVideoControls(true)
    setShowVideoPlayOverlay(false)
    setIsVideoPlaying(true)
  }

  const handleVideoLoadedMetadata = () => {
    const duration = videoRef.current?.duration
    if (typeof duration === 'number' && Number.isFinite(duration)) {
      setVideoDuration(duration)
    }
    if (videoRef.current) {
      videoRef.current.currentTime = segmentStartTime
      setSegmentPlaybackTime(0)
    }
  }

  const handleVideoPause = () => {
    setIsVideoPlaying(false)
    if (!hasPlayedOnce) {
      setShowVideoPlayOverlay(true)
    }
  }

  const handleTogglePlayback = () => {
    const videoElement = videoRef.current
    if (!videoElement) return

    if (videoElement.paused || videoElement.ended) {
      if (
        videoElement.currentTime < segmentStartTime ||
        (segmentEndTime !== null && videoElement.currentTime >= segmentEndTime)
      ) {
        applySegmentTime(segmentStartTime)
      }
      const playPromise = videoElement.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (!hasPlayedOnce) setShowVideoPlayOverlay(true)
        })
      }
      return
    }

    videoElement.pause()
  }

  const handleVolumeChange = (nextVolume: number) => {
    if (!Number.isFinite(nextVolume)) return
    const clampedVolume = Math.min(1, Math.max(0, nextVolume))
    const videoElement = videoRef.current
    if (videoElement) {
      videoElement.volume = clampedVolume
      videoElement.muted = clampedVolume === 0
    }
    setVideoVolume(clampedVolume)
    setIsVideoMuted(clampedVolume === 0)
  }

  const handleToggleMute = () => {
    const videoElement = videoRef.current
    if (!videoElement) return
    const nextMuted = !isVideoMuted
    videoElement.muted = nextMuted
    setIsVideoMuted(nextMuted)
    if (!nextMuted && videoElement.volume === 0) {
      videoElement.volume = 0.6
      setVideoVolume(0.6)
    }
  }

  const handleSegmentSeek = (nextTime: number) => {
    if (!Number.isFinite(nextTime)) return
    applySegmentTime(segmentStartTime + nextTime)
  }

  const handleSegmentNavigate = (direction: -1 | 1) => {
    setActiveSegmentIndex((currentIndex) => {
      const nextIndex = currentIndex + direction
      if (nextIndex < 0 || nextIndex >= transcriptSegments.length) {
        return currentIndex
      }
      return nextIndex
    })
  }

  const loadInstructionalMaterials = useCallback(async (transcriptId: string) => {
    setIsLoadingInstructionCards(true)
    setInstructionCardsError(null)

    try {
      const response = await fetch(
        `/api/admin/transcripts/${encodeURIComponent(
          transcriptId,
        )}/instructional-material?transcriptId=${encodeURIComponent(transcriptId)}`,
      )
      const payload: InstructionalMaterialResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to load instructional materials.'
        throw new Error(message)
      }

      const activeTranscriptId =
        activeTranscriptFetchRef.current ?? transcriptMeta?.id ?? requestedTranscriptId
      if (activeTranscriptId && activeTranscriptId !== transcriptId) {
        return
      }

      const normalized = (payload.items ?? [])
        .map((item) => ({
          id: item.id,
          title: item.image_title?.trim() ?? '',
          imageUrl: item.url,
          description: item.description ?? null,
        }))
        .filter((item) => Boolean(item.imageUrl))

      setInstructionCards(normalized)
      setInstructionalMaterialLink(payload.instructional_material_link ?? null)
      setActiveInstructionSlideIndex(0)
    } catch (error) {
      console.error('Failed to load instructional materials', error)
      setInstructionCards([])
      setInstructionalMaterialLink(null)
      setActiveInstructionSlideIndex(0)
      const message =
        error instanceof Error ? error.message : 'Unable to load instructional materials.'
      setInstructionCardsError(message)
    } finally {
      setIsLoadingInstructionCards(false)
    }
  }, [requestedTranscriptId, transcriptMeta?.id])

  const loadScavengerData = useCallback(async (transcriptId: string) => {
    const defaultQuestions = createDefaultScavengerQuestions()
    const defaultDrafts = buildScavengerDraftMap(defaultQuestions)

    activeTranscriptFetchRef.current = transcriptId
    clearScavengerAutosaveState()
    setIsLoadingTranscript(true)
    setTranscriptError(null)
    setNotesError(null)
    setScavengerCompletionError(null)
    setInstructionCards([])
    setIsLoadingInstructionCards(false)
    setInstructionCardsError(null)
    setInstructionalMaterialLink(null)
    setActiveInstructionSlideIndex(0)
    setIsLessonResourcesModalOpen(false)
    setVideoSource(null)
    setVideoSourceError(null)
    setScavengerQuestions(defaultQuestions)
    setAnswersByQuestionKey(defaultDrafts)
    answersByQuestionRef.current = defaultDrafts
    savedAnswersByQuestionRef.current = cloneScavengerDraftMap(defaultDrafts)
    setQuestionIndex(0)

    try {
      const transcriptResponse = await fetch(
        `/api/annotator/transcripts/${encodeURIComponent(
          transcriptId,
        )}?transcriptId=${encodeURIComponent(transcriptId)}`,
      )

      const transcriptPayload: TranscriptResponse | null = await transcriptResponse
        .json()
        .catch(() => null)

      if (
        !transcriptResponse.ok ||
        !transcriptPayload?.success ||
        !transcriptPayload.transcript ||
        !transcriptPayload.lines
      ) {
        const message = transcriptPayload?.error ?? 'Failed to load transcript.'
        throw new Error(message)
      }

      const normalizedLines: TranscriptRow[] = transcriptPayload.lines.map((line) => ({
        id: line.id,
        line: String(line.line ?? 0).padStart(3, '0'),
        speaker: line.speaker || 'Unknown speaker',
        utterance: line.utterance ?? '',
        inCue: parseCueValue(line.inCue),
        outCue: parseCueValue(line.outCue),
        segmentId: line.segmentId ?? null,
        flagged: Boolean(line.flagged),
      }))

      const normalizedSegments: TranscriptSegment[] = (transcriptPayload.segments ?? [])
        .map((segment) => ({
          id: segment.id,
          title: segment.title,
          index: segment.index,
          startTime: parseCueValue(segment.startTime),
          endTime: parseCueValue(segment.endTime),
        }))
        .sort((segmentA, segmentB) => segmentA.index - segmentB.index)

      const initialRows =
        normalizedSegments.length > 1
          ? normalizedLines.filter((row) => row.segmentId === normalizedSegments[0]?.id)
          : normalizedLines

      if (activeTranscriptFetchRef.current !== transcriptId) {
        return
      }

      setTranscriptMeta(transcriptPayload.transcript)
      setTranscriptRows(normalizedLines)
      setTranscriptSegments(normalizedSegments)
      setRowFlags(
        normalizedLines.reduce((acc, row) => {
          acc[row.id] = Boolean(row.flagged)
          return acc
        }, {} as Record<string, boolean>),
      )
      setSelectedRow(initialRows[0]?.id ?? null)
      setActiveSegmentIndex(0)
      setActivePlaybackRowId(null)
      playbackRowRef.current = null
      setTimelineNoteFilter(null)
      setVideoDuration(null)
      setSegmentPlaybackTime(0)
      setHasPlayedOnce(false)
      setShowVideoControls(false)
      setShowVideoPlayOverlay(true)
      setIsVideoPlaying(false)

      try {
        const notesResponse = await fetch(
          `/api/annotator/notes?transcriptId=${encodeURIComponent(transcriptId)}`,
        )
        const notesPayload: NoteListResponse | null = await notesResponse
          .json()
          .catch(() => null)

        if (!notesResponse.ok || !notesPayload?.success) {
          const message = notesPayload?.error ?? 'Failed to load notes.'
          throw new Error(message)
        }

        if (activeTranscriptFetchRef.current !== transcriptId) {
          return
        }

        const normalizedUserNotes = (notesPayload.notes ?? []).map((note) => ({
          id: note.id,
          number: note.number,
          title: note.title,
          q1: note.q1,
          q2: note.q2,
          q3: note.q3,
        }))
        const normalizedLlmNotes = (notesPayload.llmNotes ?? []).map((note) => ({
          id: note.id,
          number: note.number,
          title: note.title,
          q1: note.q1,
          q2: note.q2,
          q3: note.q3,
        }))

        const badges = createNoteBadges(normalizedUserNotes)
        const assignmentsByRow = createAssignmentLookup(notesPayload.assignments ?? [])
        const llmAssignmentsByRow = createAssignmentListLookup(
          notesPayload.llmAssignments ?? [],
        )

        const normalizedAssignments = normalizedLines.reduce(
          (acc, row) => {
            const existingAssignments = assignmentsByRow[row.id] ?? {}
            acc[row.id] = badges.reduce((noteAcc, note) => {
              noteAcc[note.id] = Boolean(existingAssignments[note.id])
              return noteAcc
            }, {} as Record<string, boolean>)
            return acc
          },
          {} as Record<string, Record<string, boolean>>,
        )

        setUserNotes(normalizedUserNotes)
        setLlmNotes(normalizedLlmNotes)
        setNoteBadges(badges)
        setRowAssignedNotes(normalizedAssignments)
        setLlmNoteAssignmentsByRow(llmAssignmentsByRow)
        setExpandedUserNotes(createExpandedMap(normalizedUserNotes))
        setExpandedLlmNotes(createExpandedMap(normalizedLlmNotes))
        setNotesError(null)
      } catch (error) {
        console.error('Failed to load scavenger notes', error)
        if (activeTranscriptFetchRef.current !== transcriptId) {
          return
        }

        setUserNotes([])
        setLlmNotes([])
        setNoteBadges([])
        setRowAssignedNotes({})
        setLlmNoteAssignmentsByRow({})
        setExpandedUserNotes({})
        setExpandedLlmNotes({})

        const message =
          error instanceof Error ? error.message : 'Unable to load notes.'
        setNotesError(message)
      }

      try {
        const questionsResponse = await fetch(
          `/api/annotator/transcripts/${encodeURIComponent(
            transcriptId,
          )}/scavenger-hunt?transcriptId=${encodeURIComponent(transcriptId)}`,
        )
        const questionsPayload: ScavengerQuestionResponse | null =
          await questionsResponse.json().catch(() => null)

        if (activeTranscriptFetchRef.current !== transcriptId) {
          return
        }

        if (questionsResponse.ok && questionsPayload?.success) {
          if (typeof questionsPayload.scavengerCompleted === 'boolean') {
            setTranscriptMeta((previous) =>
              previous
                ? {
                    ...previous,
                    scavengerCompleted: questionsPayload.scavengerCompleted,
                  }
                : previous,
            )
          }

          const fetchedQuestions = questionsPayload.scavengerHunt?.questions ?? []
          const normalizedQuestions = fetchedQuestions
            .map((question, index) => {
              const questionId = question.id?.trim() ?? ''
              const prompt = question.question?.trim() ?? ''
              if (!questionId || !prompt) {
                return null
              }

              return {
                key: createScavengerQuestionKey(questionId, index),
                id: questionId,
                prompt,
                orderIndex:
                  typeof question.orderIndex === 'number' &&
                  Number.isFinite(question.orderIndex)
                    ? question.orderIndex
                    : index + 1,
              } satisfies ScavengerQuestion
            })
            .filter((question): question is ScavengerQuestion => question !== null)
            .sort((questionA, questionB) => questionA.orderIndex - questionB.orderIndex)

          if (normalizedQuestions.length > 0) {
            const fetchedQuestionsById = fetchedQuestions.reduce(
              (acc, question) => {
                const questionId = question.id?.trim() ?? ''
                if (questionId) {
                  acc[questionId] = question
                }
                return acc
              },
              {} as Record<string, (typeof fetchedQuestions)[number]>,
            )

            const nextDrafts = normalizedQuestions.reduce(
              (acc, question) => {
                const payloadQuestion =
                  question.id ? fetchedQuestionsById[question.id] : undefined
                const rawAnswer = payloadQuestion?.answer
                const selectedLineIds = Array.isArray(payloadQuestion?.selectedLineIds)
                  ? payloadQuestion.selectedLineIds.filter(
                      (lineId): lineId is string => typeof lineId === 'string',
                    )
                  : []

                acc[question.key] = normalizeScavengerDraft({
                  answer: typeof rawAnswer === 'string' ? rawAnswer : '',
                  selectedLineIds,
                })

                return acc
              },
              {} as Record<string, ScavengerAnswerDraft>,
            )

            setScavengerQuestions(normalizedQuestions)
            setAnswersByQuestionKey(nextDrafts)
            answersByQuestionRef.current = nextDrafts
            savedAnswersByQuestionRef.current = cloneScavengerDraftMap(nextDrafts)
            setQuestionIndex(0)
          } else {
            setScavengerQuestions(defaultQuestions)
            setAnswersByQuestionKey(defaultDrafts)
            answersByQuestionRef.current = defaultDrafts
            savedAnswersByQuestionRef.current = cloneScavengerDraftMap(defaultDrafts)
            setQuestionIndex(0)
          }
        }
      } catch (error) {
        console.error('Failed to load scavenger questions', error)
      }

      try {
        const videoResponse = await fetch(
          `/api/annotator/transcripts/${encodeURIComponent(
            transcriptId,
          )}/video?transcriptId=${encodeURIComponent(transcriptId)}`,
        )
        const videoPayload: VideoResponse | null = await videoResponse
          .json()
          .catch(() => null)

        if (activeTranscriptFetchRef.current !== transcriptId) {
          return
        }

        if (!videoResponse.ok || !videoPayload?.success) {
          const message = videoPayload?.error ?? 'Unable to load video.'
          setVideoSource(null)
          setVideoSourceError(message)
        } else {
          setVideoSource(videoPayload.video ?? null)
          setVideoSourceError(null)
        }
      } catch (error) {
        console.error('Failed to load scavenger video', error)
        if (activeTranscriptFetchRef.current !== transcriptId) {
          return
        }

        setVideoSource(null)
        const message =
          error instanceof Error ? error.message : 'Unable to load video.'
        setVideoSourceError(message)
      }
    } catch (error) {
      console.error('Failed to load scavenger transcript', error)
      if (activeTranscriptFetchRef.current !== transcriptId) {
        return
      }

      setTranscriptMeta(null)
      setTranscriptRows([])
      setTranscriptSegments([])
      setSelectedRow(null)
      setRowFlags({})
      setUserNotes([])
      setLlmNotes([])
      setNoteBadges([])
      setRowAssignedNotes({})
      setLlmNoteAssignmentsByRow({})
      setExpandedUserNotes({})
      setExpandedLlmNotes({})
      setInstructionCards([])
      setIsLoadingInstructionCards(false)
      setInstructionCardsError(null)
      setInstructionalMaterialLink(null)
      setActiveInstructionSlideIndex(0)
      setIsLessonResourcesModalOpen(false)
      setTimelineNoteFilter(null)
      setVideoSource(null)
      setVideoSourceError(null)
      setScavengerQuestions(defaultQuestions)
      setAnswersByQuestionKey(defaultDrafts)
      answersByQuestionRef.current = defaultDrafts
      savedAnswersByQuestionRef.current = cloneScavengerDraftMap(defaultDrafts)
      setQuestionIndex(0)
      setSegmentPlaybackTime(0)
      setHasPlayedOnce(false)
      setShowVideoControls(false)
      setShowVideoPlayOverlay(true)
      setIsVideoPlaying(false)

      const message =
        error instanceof Error ? error.message : 'Unable to load transcript.'
      setTranscriptError(message)
    } finally {
      if (activeTranscriptFetchRef.current === transcriptId) {
        setIsLoadingTranscript(false)
      }
    }
  }, [clearScavengerAutosaveState])

  useEffect(() => {
    answersByQuestionRef.current = answersByQuestionKey
  }, [answersByQuestionKey])

  useEffect(() => {
    if (scavengerQuestions.length === 0) {
      setQuestionIndex(0)
      return
    }

    setQuestionIndex((index) =>
      Math.min(index, Math.max(scavengerQuestions.length - 1, 0)),
    )
  }, [scavengerQuestions.length])

  useEffect(() => {
    if (!requestedTranscriptId) {
      const defaultQuestions = createDefaultScavengerQuestions()
      const defaultDrafts = buildScavengerDraftMap(defaultQuestions)

      activeTranscriptFetchRef.current = null
      clearScavengerAutosaveState()
      setTranscriptMeta(null)
      setTranscriptRows([])
      setTranscriptSegments([])
      setSelectedRow(null)
      setRowFlags({})
      setUserNotes([])
      setLlmNotes([])
      setNoteBadges([])
      setRowAssignedNotes({})
      setLlmNoteAssignmentsByRow({})
      setExpandedUserNotes({})
      setExpandedLlmNotes({})
      setInstructionCards([])
      setIsLoadingInstructionCards(false)
      setInstructionCardsError(null)
      setInstructionalMaterialLink(null)
      setActiveInstructionSlideIndex(0)
      setIsLessonResourcesModalOpen(false)
      setVideoSource(null)
      setVideoSourceError(null)
      setScavengerQuestions(defaultQuestions)
      setAnswersByQuestionKey(defaultDrafts)
      answersByQuestionRef.current = defaultDrafts
      savedAnswersByQuestionRef.current = cloneScavengerDraftMap(defaultDrafts)
      setQuestionIndex(0)
      setIsLoadingTranscript(false)
      setNotesError(null)
      setTranscriptError('Open Scavenger Hunt from Annotate so a transcript can be loaded.')
      return
    }

    loadScavengerData(requestedTranscriptId)
  }, [clearScavengerAutosaveState, loadScavengerData, requestedTranscriptId])

  useEffect(() => {
    return () => {
      if (transcriptScrollbarTimeout.current) {
        window.clearTimeout(transcriptScrollbarTimeout.current)
      }
      Object.values(autosaveTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      autosaveTimeoutsRef.current = {}

      Object.values(autosaveAbortControllersRef.current).forEach((controller) => {
        controller.abort()
      })
      autosaveAbortControllersRef.current = {}
      if (savedBadgeTimeout.current) {
        window.clearTimeout(savedBadgeTimeout.current)
        savedBadgeTimeout.current = undefined
      }
    }
  }, [])

  useEffect(() => {
    const handleMouseUp = () => {
      if (!dragStateRef.current.isPointerDown && !dragStateRef.current.hasDragged) {
        return
      }
      dragStateRef.current.isPointerDown = false
      dragStateRef.current.hasDragged = false
      dragStateRef.current.startRowId = null
      dragStateRef.current.startX = 0
      dragStateRef.current.startY = 0
      setIsDragSelecting(false)
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  useEffect(() => {
    if (!timelineSettingsOpen) return

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (timelineSettingsRef.current?.contains(target ?? null)) return
      setTimelineSettingsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTimelineSettingsOpen(false)
      }
    }

    window.addEventListener('mousedown', handleOutsideClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [timelineSettingsOpen])

  useEffect(() => {
    setActiveInstructionSlideIndex((currentIndex) => {
      if (instructionCards.length === 0) {
        return 0
      }
      return Math.min(currentIndex, instructionCards.length - 1)
    })
  }, [instructionCards.length])

  useEffect(() => {
    if (!isLessonResourcesModalOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLessonResourcesModal()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        showPreviousInstructionSlide()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        showNextInstructionSlide()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [
    closeLessonResourcesModal,
    isLessonResourcesModalOpen,
    showNextInstructionSlide,
    showPreviousInstructionSlide,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const handlePointerChange = () => {
      const coarse = mediaQuery.matches
      setIsCoarsePointer(coarse)
      if (!hasPlayedOnce) {
        setShowVideoControls(false)
        return
      }
      if (coarse) {
        setShowVideoControls(true)
      }
    }

    handlePointerChange()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handlePointerChange)
      return () => mediaQuery.removeEventListener('change', handlePointerChange)
    }

    mediaQuery.addListener(handlePointerChange)
    return () => mediaQuery.removeListener(handlePointerChange)
  }, [hasPlayedOnce])

  useEffect(() => {
    const scrollElement = transcriptScrollRef.current
    if (!scrollElement) return

    const handleScroll = () => {
      setShowTranscriptScrollbar((previous) => (previous ? previous : true))
      if (transcriptScrollbarTimeout.current) {
        window.clearTimeout(transcriptScrollbarTimeout.current)
      }
      transcriptScrollbarTimeout.current = window.setTimeout(() => {
        setShowTranscriptScrollbar(false)
      }, 700)
    }

    scrollElement.addEventListener('scroll', handleScroll)
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll)
      if (transcriptScrollbarTimeout.current) {
        window.clearTimeout(transcriptScrollbarTimeout.current)
      }
    }
  }, [])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) {
      setIsPictureInPicture(false)
      return
    }

    const handleEnter = () => setIsPictureInPicture(true)
    const handleLeave = () => setIsPictureInPicture(false)

    videoElement.addEventListener('enterpictureinpicture', handleEnter)
    videoElement.addEventListener('leavepictureinpicture', handleLeave)

    const videoWithWebkit = videoElement as HTMLVideoElement & {
      webkitPresentationMode?: string
    }

    const handleWebkitModeChange = () => {
      if (typeof videoWithWebkit.webkitPresentationMode !== 'string') return
      setIsPictureInPicture(
        videoWithWebkit.webkitPresentationMode === 'picture-in-picture',
      )
    }

    if (typeof videoWithWebkit.webkitPresentationMode === 'string') {
      videoElement.addEventListener(
        'webkitpresentationmodechanged',
        handleWebkitModeChange,
      )
      handleWebkitModeChange()
    } else if ('pictureInPictureElement' in document) {
      setIsPictureInPicture(document.pictureInPictureElement === videoElement)
    } else {
      setIsPictureInPicture(false)
    }

    return () => {
      videoElement.removeEventListener('enterpictureinpicture', handleEnter)
      videoElement.removeEventListener('leavepictureinpicture', handleLeave)
      if (typeof videoWithWebkit.webkitPresentationMode === 'string') {
        videoElement.removeEventListener(
          'webkitpresentationmodechanged',
          handleWebkitModeChange,
        )
      }
    }
  }, [videoSource?.url])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement || !videoSource?.url) return

    const handleTimeUpdate = () => {
      let currentTime = videoElement.currentTime
      if (currentTime < segmentStartTime) {
        currentTime = segmentStartTime
        videoElement.currentTime = segmentStartTime
      }
      if (segmentEndTime !== null && currentTime >= segmentEndTime) {
        videoElement.pause()
        videoElement.currentTime = segmentEndTime
        currentTime = segmentEndTime
      }
      setSegmentPlaybackTime(Math.max(0, currentTime - segmentStartTime))

      if (rowsWithCues.length === 0) return
      const currentRow = findRowForTime(currentTime)
      if (!currentRow) return
      if (playbackRowRef.current === currentRow.id) return

      playbackRowRef.current = currentRow.id
      setActivePlaybackRowId(currentRow.id)
      scrollRowIntoView(currentRow.id, true)
    }

    videoElement.addEventListener('timeupdate', handleTimeUpdate)
    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [
    findRowForTime,
    rowsWithCues.length,
    scrollRowIntoView,
    segmentEndTime,
    segmentStartTime,
    videoSource?.url,
  ])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return
    videoElement.volume = videoVolume
    videoElement.muted = isVideoMuted
  }, [isVideoMuted, videoSource?.url, videoVolume])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return

    const handleVolumeEvent = () => {
      const nextVolume = Number.isFinite(videoElement.volume)
        ? videoElement.volume
        : 0
      setVideoVolume(nextVolume)
      setIsVideoMuted(videoElement.muted || nextVolume === 0)
    }

    videoElement.addEventListener('volumechange', handleVolumeEvent)
    return () => {
      videoElement.removeEventListener('volumechange', handleVolumeEvent)
    }
  }, [videoSource?.url])

  useEffect(() => {
    if (!videoSource?.url) return
    resetSegmentPlayback()
  }, [resetSegmentPlayback, videoSource?.url])

  useEffect(() => {
    if (!hasMultipleSegments) return

    setSelectedRow((currentSelectedRow) => {
      if (
        currentSelectedRow &&
        activeSegmentRows.some((row) => row.id === currentSelectedRow)
      ) {
        return currentSelectedRow
      }
      return activeSegmentRows[0]?.id ?? null
    })
    setActivePlaybackRowId(null)
    playbackRowRef.current = null
  }, [activeSegmentRows, hasMultipleSegments])

  useEffect(() => {
    const selectedLineId = currentQuestionDraft.selectedLineIds[0] ?? null
    if (!selectedLineId) {
      return
    }

    setSelectedRow((currentSelectedRow) =>
      currentSelectedRow === selectedLineId ? currentSelectedRow : selectedLineId,
    )
  }, [currentQuestionDraft.selectedLineIds])

  const currentQuestionPrompt =
    currentQuestion?.prompt ?? 'No scavenger hunt question is available yet.'

  return (
    <div
      className="flex min-h-screen h-screen flex-col overflow-hidden px-3 pb-6 pt-0 text-slate-900 sm:px-4 lg:px-6"
      style={pageBackgroundStyle}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col gap-4">
        <WorkspaceHeader
          toolbarVisible={false}
          onToggleToolbar={() => {}}
          onWorkspaceClick={handleBackToWorkspace}
          showWorkspaceButton
          showToolbarToggleButton={false}
          menuLinks={scavengerMenuLinks}
          onMenuLinkClick={handleMenuLinkAction}
          variant="minimal"
          density="compact"
          workspaceButtonVariant="icon"
          title="Scavenger Hunt"
        />

        <section className="grid flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,2.3fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
          <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/60 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xl font-semibold text-slate-900">
                  Question {scavengerQuestions.length > 0 ? questionIndex + 1 : 0}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showSavedBadge && (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleLessonResourcesClick}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-600 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                >
                  Lesson Resources
                </button>
                <button
                  type="button"
                  onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
                  disabled={questionIndex === 0 || scavengerQuestions.length === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Previous question"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setQuestionIndex((index) =>
                      Math.min(scavengerQuestions.length - 1, index + 1),
                    )
                  }
                  disabled={
                    scavengerQuestions.length === 0 ||
                    questionIndex === scavengerQuestions.length - 1
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Next question"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="mt-2 text-sm text-slate-600">{currentQuestionPrompt}</p>

            <div className="mt-3 text-xs text-slate-500">
              <span className="font-semibold uppercase tracking-[0.2em] text-slate-400">
                Selected lines:
              </span>{' '}
              {selectedLineText}
            </div>

            <textarea
              id="scavenger-response"
              value={response}
              onChange={(event) => handleResponseChange(event.target.value)}
              rows={4}
              placeholder="Write comparative analysis"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white"
            />

            {(
              transcriptError ||
              notesError ||
              scavengerAutosaveError ||
              scavengerCompletionError
            ) && (
              <div className="mt-3 space-y-2">
                {transcriptError && (
                  <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                    {transcriptError}
                  </p>
                )}
                {notesError && (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    {notesError}
                  </p>
                )}
                {scavengerAutosaveError && (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    {scavengerAutosaveError}
                  </p>
                )}
                {scavengerCompletionError && (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    {scavengerCompletionError}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="flex min-h-0 min-w-0 flex-col rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70 lg:row-span-2">
            {hasVideo ? (
              <div
                className={`flex flex-col gap-3 transition-all duration-300 ${
                  isPictureInPicture
                    ? 'absolute left-0 top-0 invisible pointer-events-none'
                    : ''
                }`}
                aria-hidden={isPictureInPicture}
              >
                {hasMultipleSegments && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-0 text-sm font-semibold text-slate-700">
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-slate-600">
                      {activeSegmentLabel}
                    </span>
                    <div className="flex items-center gap-2">
                      {hasPreviousSegment && (
                        <button
                          type="button"
                          onClick={() => handleSegmentNavigate(-1)}
                          aria-label="Previous section"
                          className="flex items-center justify-center rounded-xl p-2 text-slate-600 transition hover:bg-slate-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                      )}
                      {hasNextSegment && (
                        <button
                          type="button"
                          onClick={() => handleSegmentNavigate(1)}
                          aria-label="Next section"
                          className="flex items-center justify-center rounded-xl p-2 text-slate-600 transition hover:bg-slate-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div
                  ref={videoContainerRef}
                  className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white"
                  onMouseEnter={() => {
                    if (!hasPlayedOnce) return
                    setShowVideoControls(true)
                  }}
                  onMouseLeave={() => {
                    if (!hasPlayedOnce || isCoarsePointer) return
                    setShowVideoControls(false)
                  }}
                  onFocusCapture={() => {
                    if (!hasPlayedOnce) return
                    setShowVideoControls(true)
                  }}
                  onBlurCapture={(event) => {
                    if (!hasPlayedOnce || isCoarsePointer) return
                    const nextTarget = event.relatedTarget as Node | null
                    if (nextTarget && event.currentTarget.contains(nextTarget)) {
                      return
                    }
                    setShowVideoControls(false)
                  }}
                  onTouchStart={() => {
                    if (!hasPlayedOnce) return
                    setShowVideoControls(true)
                  }}
                >
                  {timelineNoteFilter && segmentDuration && (
                    <div
                      className={`pointer-events-none absolute inset-x-4 ${
                        showVideoControls ? 'bottom-16' : 'bottom-3'
                      } z-30 h-2 overflow-visible`}
                    >
                      {timelineNoteSegments.map((segment, index) => {
                        const startPercent = Math.max(
                          0,
                          (segment.start / segmentDuration) * 100,
                        )
                        const clampedStart = Math.min(100, startPercent)
                        const endPercent = Math.min(
                          100,
                          (segment.end / segmentDuration) * 100,
                        )
                        const widthPercent = Math.min(
                          Math.max(endPercent - clampedStart, 0.8),
                          100 - clampedStart,
                        )
                        return (
                          <span
                            key={`${segment.rowId}-${index}`}
                            className={`absolute bottom-0 top-0 rounded-full shadow-sm shadow-slate-900/30 ${timelineHighlightColorClass}`}
                            style={{
                              left: `${clampedStart}%`,
                              width: `${widthPercent}%`,
                              opacity: 0.9,
                            }}
                          />
                        )
                      })}
                    </div>
                  )}

                  <video
                    key={videoSource?.url ?? 'empty-video'}
                    ref={videoRef}
                    className="video-annotate-player h-full w-full max-h-[360px] bg-white"
                    data-controls-visible={showVideoControls ? 'true' : 'false'}
                    tabIndex={isPictureInPicture ? -1 : 0}
                    controls={false}
                    playsInline
                    preload="metadata"
                    poster={WHITE_VIDEO_POSTER}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={handleTogglePlayback}
                    onPlay={handleVideoPlay}
                    onPause={handleVideoPause}
                    onEnded={handleVideoPause}
                    onLoadedMetadata={handleVideoLoadedMetadata}
                  >
                    {videoSource?.url ? (
                      <source src={videoSource.url} type={resolvedVideoMimeType} />
                    ) : null}
                    Your browser does not support the video tag.
                  </video>

                  {!isLoadingTranscript && !videoSource?.url && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm shadow-slate-200/70">
                        {videoSourceError ?? 'No video uploaded for this transcript.'}
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleVideoPlayClick}
                    aria-label="Play video"
                    className={`absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/30 text-white shadow-[0_10px_30px_-18px_rgba(15,23,42,0.8)] backdrop-blur-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      shouldShowPlayOverlay ? '' : 'pointer-events-none opacity-0'
                    }`}
                    aria-hidden={!shouldShowPlayOverlay}
                    tabIndex={shouldShowPlayOverlay ? 0 : -1}
                  >
                    <svg
                      width="22"
                      height="26"
                      viewBox="0 0 22 26"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M5 4.2c0-1.18 1.3-1.9 2.34-1.2l11.2 7a1.5 1.5 0 0 1 0 2.6l-11.2 7c-1.04.66-2.34-.06-2.34-1.26V4.2Z" />
                    </svg>
                  </button>

                  {videoSource?.url && (
                    <div
                      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-4 pb-3 pt-8 text-white transition duration-200 ${
                        showVideoControls
                          ? 'opacity-100'
                          : 'pointer-events-none opacity-0'
                      }`}
                    >
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/80 via-slate-950/40 to-transparent" />
                      <input
                        type="range"
                        min={0}
                        max={segmentDuration ?? 0}
                        step={0.1}
                        value={segmentPlaybackValue}
                        onChange={(event) =>
                          handleSegmentSeek(Number(event.target.value))
                        }
                        disabled={!isSegmentSeekEnabled}
                        className="relative z-10 h-1 w-full cursor-pointer accent-white/90"
                        aria-label="Seek within segment"
                      />
                      <div className="relative z-10 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleTogglePlayback}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                            aria-label={isVideoPlaying ? 'Pause video' : 'Play video'}
                          >
                            {isVideoPlaying ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </button>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleToggleMute}
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              aria-label={isVideoMuted ? 'Unmute video' : 'Mute video'}
                            >
                              {isVideoMuted || videoVolume === 0 ? (
                                <VolumeX className="h-4 w-4" />
                              ) : (
                                <Volume2 className="h-4 w-4" />
                              )}
                            </button>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={videoVolume}
                              onChange={(event) =>
                                handleVolumeChange(Number(event.target.value))
                              }
                              className="h-1 w-20 cursor-pointer accent-white/90"
                              aria-label="Adjust volume"
                            />
                          </div>
                          <span className="text-xs font-mono text-white/80">
                            {formatTimestamp(segmentPlaybackValue)} /{' '}
                            {formatTimestamp(segmentDuration)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative" ref={timelineSettingsRef}>
                            <button
                              type="button"
                              onClick={() =>
                                setTimelineSettingsOpen((open) => !open)
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              aria-label="Timeline highlight settings"
                              aria-expanded={timelineSettingsOpen}
                              aria-controls="timeline-highlight-panel"
                            >
                              <Settings className="h-4 w-4" />
                            </button>
                            {timelineSettingsOpen && (
                              <div
                                id="timeline-highlight-panel"
                                className="absolute bottom-full right-0 z-30 mb-3 w-56 rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-700 shadow-xl shadow-slate-900/10 backdrop-blur-md"
                              >
                                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                                  Timeline highlight
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Show where a note tag appears across the video.
                                </p>
                                <div className="mt-2 space-y-1">
                                  <button
                                    type="button"
                                    onClick={() => handleTimelineNoteSelect(null)}
                                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs transition ${
                                      timelineNoteFilter === null
                                        ? 'border border-slate-200 bg-slate-50 text-slate-900 shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-50'
                                    }`}
                                  >
                                    <span>Hide highlights</span>
                                    {timelineNoteFilter === null && (
                                      <Check className="h-4 w-4" />
                                    )}
                                  </button>
                                  {noteBadges.map((note) => {
                                    const isActive = timelineNoteFilter === note.id
                                    return (
                                      <button
                                        key={note.id}
                                        type="button"
                                        onClick={() =>
                                          handleTimelineNoteSelect(note.id)
                                        }
                                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs transition ${
                                          isActive
                                            ? 'border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm'
                                            : 'text-slate-600 hover:bg-slate-50'
                                        }`}
                                      >
                                        <span className="text-left">
                                          Show &quot;{note.label}&quot; on timeline
                                        </span>
                                        {isActive && <Check className="h-4 w-4" />}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              hasMultipleSegments && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1 text-sm font-semibold text-slate-700">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-slate-600">
                    {activeSegmentLabel}
                  </span>
                  <div className="flex items-center gap-2">
                    {hasPreviousSegment && (
                      <button
                        type="button"
                        onClick={() => handleSegmentNavigate(-1)}
                        aria-label="Previous section"
                        className="flex items-center justify-center rounded-xl p-2 text-slate-600 transition hover:bg-slate-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    )}
                    {hasNextSegment && (
                      <button
                        type="button"
                        onClick={() => handleSegmentNavigate(1)}
                        aria-label="Next section"
                        className="flex items-center justify-center rounded-xl p-2 text-slate-600 transition hover:bg-slate-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            )}

              <div
                ref={transcriptScrollRef}
                className={`stealth-scrollbar stealth-scrollbar--overlay relative mt-4 flex-1 min-w-0 overflow-auto rounded-2xl border border-slate-100 bg-white/70 p-2 pr-0.5 ${
                  showTranscriptScrollbar ? 'stealth-scrollbar--active' : ''
                } ${isDragSelecting ? 'select-none' : ''}`}
              >
              {isLoadingTranscript ? (
                <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-slate-500">
                  Loading transcript lines...
                </div>
              ) : transcriptError ? (
                <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm font-semibold text-rose-700">
                  {transcriptError}
                </div>
              ) : isTranscriptEmpty ? (
                <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-600">
                  No transcript lines available.
                </div>
              ) : (
                <table className="w-full table-fixed border-separate border-spacing-y-3">
                  <colgroup>
                    <col style={{ width: lineColumnWidth }} />
                    <col style={{ width: speakerColumnWidth }} />
                    <col />
                    <col style={{ width: noteColumnWidth }} />
                  </colgroup>
                  <thead className={tableHeadClass}>
                    <tr className="text-left text-xs uppercase tracking-widest text-slate-500">
                      <th
                        className={lineHeaderClass}
                        style={{
                          width: lineColumnWidth,
                          minWidth: lineColumnWidth,
                        }}
                      >
                        Line
                      </th>
                      <th
                        className={speakerHeaderClass}
                        style={
                          hasVideo
                            ? {
                                width: speakerColumnWidth,
                                minWidth: speakerColumnWidth,
                              }
                            : {
                                left: lineColumnWidth,
                                width: speakerColumnWidth,
                                minWidth: speakerColumnWidth,
                              }
                        }
                      >
                        Speaker
                      </th>
                      <th className={standardHeaderClass}>Utterance</th>
                      <th
                        className={standardHeaderClass}
                        style={{
                          width: noteColumnWidth,
                          minWidth: noteColumnWidth,
                        }}
                      >
                        Notes
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.map((row) => {
                      const isSelected = selectedRow === row.id
                      const isChecked = Boolean(checkedRows[row.id])
                      const isActive =
                        isSelected || isChecked || activePlaybackRowId === row.id

                      const activeRowNotes = noteBadges.filter(
                        (note) => rowAssignedNotes[row.id]?.[note.id],
                      )
                      const activeRowLlmNotes = shouldShowLlmAnnotations
                        ? (llmNoteAssignmentsByRow[row.id] ?? [])
                            .map((noteId) => llmNotesById[noteId])
                            .filter((note): note is NoteEntry => Boolean(note))
                        : []

                      const hasRowNotes =
                        activeRowNotes.length > 0 || activeRowLlmNotes.length > 0
                      const speakerColor =
                        speakerColorMap[row.speaker] ?? fallbackSpeakerColor

                      const speakerChipClass = speakerColor.chip
                      const selectedBgClass = speakerColor.selectedBg || speakerColor.rowBg
                      const selectedStickyBgClass =
                        speakerColor.selectedStickyBg || speakerColor.stickyBg
                      const selectedBorderClass =
                        speakerColor.selectedBorder || speakerColor.border
                      const selectedRingClass =
                        speakerColor.selectedRing || 'ring-slate-200'
                      const selectedShadowClass =
                        speakerColor.selectedShadow || 'shadow-slate-100'

                      const rowBgClass = isActive
                        ? selectedBgClass
                        : speakerColor.rowBg
                      const hoverBgClass = isActive ? '' : speakerColor.hoverBg
                      const stickyBgClass = isActive
                        ? selectedStickyBgClass
                        : `${speakerColor.stickyBg} ${speakerColor.hoverBg}`
                      const borderClass = isActive
                        ? selectedBorderClass
                        : speakerColor.border
                      const selectedClasses = isActive
                        ? `ring-1 ${selectedRingClass} shadow-sm ${selectedShadowClass}`
                        : ''

                      return (
                        <tr
                          key={row.id}
                          data-row-id={row.id}
                          onClick={() => handleRowSelection(row.id)}
                          onDoubleClick={
                            hasVideo ? () => handleRowDoubleClick(row.id) : undefined
                          }
                          onMouseDown={(event) => handleRowMouseDown(row.id, event)}
                          onMouseEnter={(event) => handleRowPointerDrag(row.id, event)}
                          onMouseMove={(event) => handleRowPointerDrag(row.id, event)}
                          onMouseUp={() => handleRowMouseUp(row.id)}
                          className={`group cursor-pointer rounded-2xl border text-sm text-slate-700 transition ${borderClass} ${rowBgClass} ${hoverBgClass} ${selectedClasses} ${
                            isActive ? '' : 'hover:border-indigo-200/60'
                          }`}
                        >
                          <td
                            className={`sticky left-0 z-10 rounded-l-2xl px-3 py-4 ${stickyBgClass}`}
                            style={{
                              width: lineColumnWidth,
                              minWidth: lineColumnWidth,
                            }}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(checkedRows[row.id])}
                                onChange={(event) => {
                                  event.stopPropagation()
                                  toggleRowCheckbox(row.id)
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                className="h-4 w-4 rounded-sm border border-slate-300 bg-white text-indigo-500 focus:ring-0 focus:ring-offset-0"
                                aria-label={`Select line ${row.line}`}
                              />
                              <div className="flex items-center gap-2 font-mono text-xs text-slate-500">
                                <span>{row.line}</span>
                                {rowFlags[row.id] && (
                                  <span className="inline-flex h-2 w-2 rounded-full bg-rose-400" />
                                )}
                              </div>
                            </div>
                          </td>
                          <td
                            className={`sticky z-10 min-w-0 px-3 py-4 ${stickyBgClass}`}
                            style={{
                              left: lineColumnWidth,
                              width: speakerColumnWidth,
                              minWidth: speakerColumnWidth,
                            }}
                          >
                            <span
                              className={`flex w-full items-center truncate rounded-xl px-3 py-1 text-xs font-semibold ${speakerChipClass}`}
                            >
                              {row.speaker}
                            </span>
                          </td>
                          <td className="min-w-0 px-3 py-4 align-top">
                            <p className="break-words text-sm leading-relaxed text-slate-800">
                              {row.utterance}
                            </p>
                          </td>
                          <td
                            className="min-w-0 rounded-r-2xl px-3 py-4"
                            style={{
                              width: noteColumnWidth,
                              minWidth: noteColumnWidth,
                            }}
                          >
                            {hasRowNotes ? (
                              <div className="flex flex-wrap gap-2">
                                {activeRowNotes.map((note) => {
                                  if (!hasVideo) {
                                    return (
                                      <span
                                        key={note.id}
                                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold shadow-sm ${note.colorClass}`}
                                      >
                                        {note.label}
                                      </span>
                                    )
                                  }

                                  const isUserNoteExpanded =
                                    expandedUserNotes[note.id] ?? false
                                  return (
                                    <button
                                      key={note.id}
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        handleUserNoteBadgeToggle(note.id)
                                      }}
                                      onMouseDown={(event) => event.stopPropagation()}
                                      onMouseUp={(event) => event.stopPropagation()}
                                      onDoubleClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      aria-expanded={isUserNoteExpanded}
                                      title={
                                        isUserNoteExpanded
                                          ? `Collapse "${note.label}" details`
                                          : `Expand "${note.label}" details`
                                      }
                                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold shadow-sm transition ${
                                        isUserNoteExpanded
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-emerald-100'
                                          : 'border-slate-200 bg-white/80 text-slate-700 shadow-slate-100'
                                      }`}
                                    >
                                      {note.label}
                                    </button>
                                  )
                                })}

                                {activeRowLlmNotes.map((note) => {
                                  const isExpanded = expandedLlmNotes[note.id] ?? false
                                  const noteLabel =
                                    note.title.trim() || `Note ${note.number}`
                                  return (
                                    <button
                                      key={note.id}
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        handleLlmNoteBadgeToggle(note.id)
                                      }}
                                      onMouseDown={(event) =>
                                        event.stopPropagation()
                                      }
                                      onMouseUp={(event) => event.stopPropagation()}
                                      onDoubleClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      aria-expanded={isExpanded}
                                      title={
                                        isExpanded
                                          ? `Collapse "${noteLabel}" details`
                                          : `Expand "${noteLabel}" details`
                                      }
                                      className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 shadow-sm shadow-indigo-100 transition"
                                    >
                                      {noteLabel}
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">No notes</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {filteredRows.length === 0 &&
              !isLoadingTranscript &&
              !transcriptError &&
              hasRowsForFilters && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No lines are available in this section.
                </div>
              )}
          </section>

          <NotePanel
            title="My notes"
            description=""
            notes={userNotes}
            badgeTone="emerald"
            expandedNotes={expandedUserNotes}
            onToggleExpanded={handleUserNoteBadgeToggle}
            emptyState="No personal notes were found for this transcript."
          />

          <NotePanel
            title="LLM notes"
            description=""
            notes={shouldShowLlmAnnotations ? llmNotes : []}
            badgeTone="indigo"
            expandedNotes={expandedLlmNotes}
            onToggleExpanded={handleLlmNoteBadgeToggle}
            emptyState={
              shouldShowLlmAnnotations
                ? 'No LLM notes were found for this transcript.'
                : 'LLM notes are currently hidden for this transcript.'
            }
          />
        </section>
      </div>
      {isLessonResourcesModalOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 px-4 py-8 backdrop-blur-sm"
          onClick={closeLessonResourcesModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Lesson resources"
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/30"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  Lesson resources
                </p>
                <h2 className="text-lg font-semibold text-slate-900">
                  {transcriptMeta?.title ?? 'Transcript resources'}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeLessonResourcesModal}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                aria-label="Close lesson resources"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="stealth-scrollbar flex-1 overflow-y-auto px-6 py-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                    Instruction & context
                  </h3>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {transcriptMeta?.instructionContext?.trim()
                        ? transcriptMeta.instructionContext
                        : 'No instructional context has been provided for this transcript yet.'}
                    </p>
                    {instructionalMaterialLink?.trim() && (
                      <a
                        href={instructionalMaterialLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                      >
                        Open external instructional link
                      </a>
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                      Instructional materials
                    </h3>
                    {hasInstructionCards && (
                      <span className="text-xs font-semibold text-slate-500">
                        {activeInstructionSlideIndex + 1} of {instructionCards.length}
                      </span>
                    )}
                  </div>

                  {isLoadingInstructionCards ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
                      Loading instructional materials...
                    </div>
                  ) : hasInstructionCards && activeInstructionCard ? (
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                        <Image
                          src={activeInstructionCard.imageUrl}
                          alt={
                            activeInstructionCard.title ||
                            `Instructional material ${activeInstructionSlideIndex + 1}`
                          }
                          width={1280}
                          height={720}
                          className="h-[min(58vh,460px)] w-full object-contain"
                          sizes="(min-width: 1024px) 720px, 100vw"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                        <button
                          type="button"
                          onClick={showPreviousInstructionSlide}
                          disabled={instructionCards.length <= 1}
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Previous instructional material"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="min-w-0 flex-1 text-center">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {activeInstructionCard.title ||
                              `Instructional material ${activeInstructionSlideIndex + 1}`}
                          </p>
                          {activeInstructionCard.description?.trim() && (
                            <p className="mt-1 text-xs text-slate-500">
                              {activeInstructionCard.description}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={showNextInstructionSlide}
                          disabled={instructionCards.length <= 1}
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Next instructional material"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
                      {instructionCardsError ?? 'No instructional materials have been uploaded yet.'}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
