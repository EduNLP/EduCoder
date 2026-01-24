'use client'

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  EyeOff,
  Flag,
  Ghost,
  ListFilter,
  LogOut,
  BookmarkCheck,
  Check,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FormEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useTheme } from '@/context/ThemeContext'
import { useAuth, useUser } from '@clerk/nextjs'

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

type TranscriptMeta = {
  id: string
  title: string
  grade: string | null
  instructionContext: string
  annotationId: string
  status: AnnotationStatus
  annotationCompleted: boolean
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

type NoteRecord = {
  id: string
  number: number
  title: string
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
  notes?: NoteRecord[]
  assignments?: NoteAssignmentRecord[]
  error?: string
}

type NoteCreateResponse = {
  success: boolean
  note?: {
    id: string
    number: number
    title: string
    q1: string
    q2: string
    q3: string
  }
  error?: string
}

type NoteUpdateResponse = {
  success: boolean
  note?: {
    id: string
    number: number
    title: string
    q1: string
    q2: string
    q3: string
  }
  error?: string
}

type NoteSelectionSnapshot = {
  checked: boolean
  indeterminate: boolean
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

type NewNoteDraft = {
  title: string
  studentEvidence: string
  utteranceNote: string
  thinkingInsight: string
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
  bubbleBg: string
  chip: string
  border: string
}

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

const NOTE_DETAILS_FIELD_CONFIG = [
  {
    id: 'studentEvidence',
    label: 'What are students saying in the selected piece(s) of evidence?',
    placeholder: 'Capture direct quotes or summaries from the selected lines.',
    noteKey: 'q1',
  },
  {
    id: 'utteranceNote',
    label: 'What would you like to note about this utterance?',
    placeholder: 'Add your observation, context, or instructional move to track.',
    noteKey: 'q2',
  },
  {
    id: 'thinkingInsight',
    label:
      "What does this utterance reveal about the student's thinking or understanding?",
    placeholder: "Interpret the mathematical reasoning or misconception you're seeing.",
    noteKey: 'q3',
  },
] as const

const STATIC_ASSIGN_NOTES = [
  {
    id: 'static-note-1',
    title: 'Teacher',
    q1: 'Teacher asks for what stays the same with scaling.',
    q2: 'This prompt is an instructional move to surface structure.',
    q3: 'Students are likely to connect invariants to multiplicative reasoning.',
  },
  {
    id: 'static-note-2',
    title: 'Misconception',
    q1: 'Student mentions doubling without explaining why it works.',
    q2: 'The response skips justification and may reflect pattern matching.',
    q3: 'Student understanding may be fragile without structural reasoning.',
  },
  {
    id: 'static-note-3',
    title: 'Inference',
    q1: 'Student introduces a ratio table to justify the pattern.',
    q2: 'The strategy links representations to build a general rule.',
    q3: 'Evidence suggests readiness to generalize proportional relationships.',
  },
] as const

const STATIC_ASSIGN_LINE_NUMBERS = new Set([1, 2, 4, 6, 8, 10, 12, 13, 14])

const STATIC_ASSIGN_NOTE_LOOKUP = STATIC_ASSIGN_NOTES.reduce(
  (acc, note) => {
    acc[note.id] = note
    return acc
  },
  {} as Record<string, (typeof STATIC_ASSIGN_NOTES)[number]>,
)

const createStaticNoteAssignments = (rows: TranscriptRow[]) => {
  if (rows.length === 0) return {}
  return rows.reduce((acc, row) => {
    const lineNumber = Number(row.line)
    if (!Number.isFinite(lineNumber) || !STATIC_ASSIGN_LINE_NUMBERS.has(lineNumber)) {
      return acc
    }
    const randomIndex = Math.floor(Math.random() * STATIC_ASSIGN_NOTES.length)
    const noteId = STATIC_ASSIGN_NOTES[randomIndex]?.id
    if (noteId) {
      acc[row.id] = [noteId]
    }
    return acc
  }, {} as Record<string, string[]>)
}

const createNoteContentFields = (note?: {
  q1?: string
  q2?: string
  q3?: string
}) => [
  note?.q1 ?? '',
  note?.q2 ?? '',
  note?.q3 ?? '',
]

const createNoteBadges = (notes: NoteRecord[]) =>
  notes.map((note, index) => ({
    id: note.id,
    label: note.title || `Note ${note.number}`,
    colorClass: NOTE_BADGE_COLORS[index % NOTE_BADGE_COLORS.length],
    number: note.number,
    q1: note.q1,
    q2: note.q2,
    q3: note.q3,
  }))

const createEmptyNoteTitles = (noteBadges: NoteBadge[]) =>
  noteBadges.reduce((acc, note) => {
    acc[note.id] = note.label
    return acc
  }, {} as Record<string, string>)

const createNoteDetailsDrafts = (noteBadges: NoteBadge[]) =>
  noteBadges.reduce((acc, note) => {
    acc[note.id] = createNoteContentFields(note)
    return acc
  }, {} as Record<string, string[]>)

const createExpandedNotes = (noteBadges: NoteBadge[]) =>
  noteBadges.reduce((acc, note) => {
    acc[note.id] = false
    return acc
  }, {} as Record<string, boolean>)

const createEmptyNewNote = (): NewNoteDraft => ({
  title: '',
  studentEvidence: '',
  utteranceNote: '',
  thinkingInsight: '',
})

const createEmptyNoteAssignments = (noteBadges: NoteBadge[]) =>
  noteBadges.reduce((acc, note) => {
    acc[note.id] = false
    return acc
  }, {} as Record<string, boolean>)

const createAssignmentLookup = (assignments: NoteAssignmentRecord[]) =>
  assignments.reduce((acc, assignment) => {
    if (!acc[assignment.lineId]) {
      acc[assignment.lineId] = {}
    }
    acc[assignment.lineId][assignment.noteId] = true
    return acc
  }, {} as Record<string, Record<string, boolean>>)

const buildRowAssignments = (
  rows: TranscriptRow[],
  noteBadges: NoteBadge[],
  existingAssignments: Record<string, Record<string, boolean>> = {},
) =>
  rows.reduce((acc, row) => {
    const baseAssignments = createEmptyNoteAssignments(noteBadges)
    const previousAssignments = existingAssignments[row.id] ?? {}

    noteBadges.forEach((note) => {
      baseAssignments[note.id] = previousAssignments[note.id] ?? false
    })

    acc[row.id] = baseAssignments
    return acc
  }, {} as Record<string, Record<string, boolean>>)

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
    bubbleBg: 'bg-sky-50/80',
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
    bubbleBg: 'bg-amber-50/80',
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
    bubbleBg: 'bg-emerald-50/80',
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
    bubbleBg: 'bg-indigo-50/80',
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
    bubbleBg: 'bg-rose-50/80',
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
    bubbleBg: 'bg-lime-50/80',
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
  bubbleBg: 'bg-white',
  chip: 'bg-transparent text-slate-800',
  border: 'border-slate-100',
}

// Solid-white poster keeps the player blank before playback.
const WHITE_VIDEO_POSTER =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22%3E%3Crect width=%2216%22 height=%229%22 fill=%22white%22/%3E%3C/svg%3E'

const parseCueValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
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

function AnnotationPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
      Loading annotation workspace...
    </div>
  )
}

export default function AnnotationPage() {
  return (
    <Suspense fallback={<AnnotationPageFallback />}>
      <AnnotationPageContent />
    </Suspense>
  )
}

function AnnotationPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: userLoaded, user } = useUser()
  const role = (user?.publicMetadata?.role as string | undefined) ?? null
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([])
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([])
  const [transcriptMeta, setTranscriptMeta] = useState<TranscriptMeta | null>(null)
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [instructionCards, setInstructionCards] = useState<InstructionCard[]>([])
  const [isLoadingInstructionCards, setIsLoadingInstructionCards] =
    useState(false)
  const [instructionCardsError, setInstructionCardsError] = useState<string | null>(
    null,
  )
  const [videoSource, setVideoSource] = useState<VideoMeta | null>(null)
  const [videoSourceError, setVideoSourceError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [instructionCollapsed, setInstructionCollapsed] = useState(false)
  const [annotationCollapsed, setAnnotationCollapsed] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [speakerFilter, setSpeakerFilter] = useState('all')
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false)
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [checkedRows, setCheckedRows] = useState<Record<string, boolean>>({})
  const [isDragSelecting, setIsDragSelecting] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState({
    speaker: true,
    utterance: true,
    notes: true,
  })
  const [showLlmAnnotations, setShowLlmAnnotations] = useState(true)
  const [rowFlags, setRowFlags] = useState<Record<string, boolean>>({})
  const [noteBadges, setNoteBadges] = useState<NoteBadge[]>([])
  const [notesError, setNotesError] = useState<string | null>(null)
  const [rowAssignedNotes, setRowAssignedNotes] = useState<
    Record<string, Record<string, boolean>>
  >({})
  const [staticNoteAssignmentsByRow, setStaticNoteAssignmentsByRow] = useState<
    Record<string, string[]>
  >({})
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({})
  const [expandedStaticNotes, setExpandedStaticNotes] = useState<
    Record<string, boolean>
  >({})
  const [noteDetailsDrafts, setNoteDetailsDrafts] = useState<
    Record<string, string[]>
  >({})
  const [noteTitleDrafts, setNoteTitleDrafts] =
    useState<Record<string, string>>({})
  const [activeAnnotationTab, setActiveAnnotationTab] = useState<
    'assign' | 'flag'
  >('assign')
  const [newNote, setNewNote] = useState<NewNoteDraft>(createEmptyNewNote())
  const [isCreatingNote, setIsCreatingNote] = useState(false)
  const [createNoteError, setCreateNoteError] = useState<string | null>(null)
  const [showCreateNoteForm, setShowCreateNoteForm] = useState(false)
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>({})
  const [noteSaveErrors, setNoteSaveErrors] = useState<Record<string, string>>({})
  const [flagSaveError, setFlagSaveError] = useState<string | null>(null)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [showSavedBadge, setShowSavedBadge] = useState(false)
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null)
  const [isDeletingNote, setIsDeletingNote] = useState(false)
  const [isMarkingComplete, setIsMarkingComplete] = useState(false)
  const [showTranscriptScrollbar, setShowTranscriptScrollbar] = useState(false)
  const [showInstructionScrollbar, setShowInstructionScrollbar] = useState(false)
  const [activeInstructionImage, setActiveInstructionImage] = useState<{
    src: string
    title: string
  } | null>(null)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false)
  const [showVideoControls, setShowVideoControls] = useState(false)
  const [showVideoPlayOverlay, setShowVideoPlayOverlay] = useState(true)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [videoVolume, setVideoVolume] = useState(0.8)
  const [isVideoMuted, setIsVideoMuted] = useState(false)
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false)
  const [segmentPlaybackTime, setSegmentPlaybackTime] = useState(0)
  const [timelineNoteFilter, setTimelineNoteFilter] = useState<string | null>(null)
  const [timelineSettingsOpen, setTimelineSettingsOpen] = useState(false)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [activePlaybackRowId, setActivePlaybackRowId] = useState<string | null>(null)
  const savedBadgeTimeout = useRef<number | undefined>(undefined)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptScrollbarTimeout = useRef<number | undefined>(undefined)
  const instructionScrollRef = useRef<HTMLDivElement | null>(null)
  const instructionScrollbarTimeout = useRef<number | undefined>(undefined)
  const annotationPanelRef = useRef<HTMLDivElement | null>(null)
  const videoContainerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const activeVideoTranscriptRef = useRef<string | null>(null)
  const playbackRowRef = useRef<string | null>(null)
  const noteCheckboxRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const isAnnotationComplete = Boolean(transcriptMeta?.annotationCompleted)
  const timelineSettingsRef = useRef<HTMLDivElement | null>(null)
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

  const selectRow = useCallback((rowId: string) => {
    setCheckedRows({})
    setSelectedRow(rowId)
    setAnnotationCollapsed(false)
  }, [])
  const annotationMenuLinks = useMemo(
    () => [
      {
        id: 'toggle-toolbar',
        label: toolbarVisible
          ? 'Hide search & filters'
          : 'Show search & filters',
        icon: toolbarVisible ? EyeOff : Eye,
      },
      {
        id: 'toggle-llm-annotations',
        label: showLlmAnnotations ? 'Hide LLM notes' : 'Show LLM notes',
        icon: showLlmAnnotations ? EyeOff : Eye,
      },
      { id: 'hunt', label: 'Start Scavenger Hunt ✨', accent: true },
      {
        id: 'complete',
        label: isAnnotationComplete ? 'Mark as In Progress' : 'Mark as Complete',
        icon: BookmarkCheck,
      },
      { id: 'logout', label: 'Log Out', icon: LogOut },
    ],
    [isAnnotationComplete, showLlmAnnotations, toolbarVisible],
  )

  useEffect(() => {
    return () => {
      if (savedBadgeTimeout.current) {
        window.clearTimeout(savedBadgeTimeout.current)
      }
      if (transcriptScrollbarTimeout.current) {
        window.clearTimeout(transcriptScrollbarTimeout.current)
      }
      if (instructionScrollbarTimeout.current) {
        window.clearTimeout(instructionScrollbarTimeout.current)
      }
    }
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

  const handleToggleFullscreen = () => {
    const container = videoContainerRef.current
    if (!container) return
    if (document.fullscreenElement === container) {
      if (typeof document.exitFullscreen === 'function') {
        document.exitFullscreen()
      }
      return
    }
    if (typeof container.requestFullscreen === 'function') {
      container.requestFullscreen()
      return
    }
    const webkitContainer = container as HTMLDivElement & {
      webkitRequestFullscreen?: () => void
    }
    if (typeof webkitContainer.webkitRequestFullscreen === 'function') {
      webkitContainer.webkitRequestFullscreen()
    }
  }

  const handleSegmentSeek = (nextTime: number) => {
    if (!Number.isFinite(nextTime)) return
    applySegmentTime(segmentStartTime + nextTime)
  }

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
    if (instructionCollapsed) return
    const scrollElement = instructionScrollRef.current
    if (!scrollElement) return

    const handleScroll = () => {
      setShowInstructionScrollbar((previous) => (previous ? previous : true))
      if (instructionScrollbarTimeout.current) {
        window.clearTimeout(instructionScrollbarTimeout.current)
      }
      instructionScrollbarTimeout.current = window.setTimeout(() => {
        setShowInstructionScrollbar(false)
      }, 700)
    }

    scrollElement.addEventListener('scroll', handleScroll)

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll)
      if (instructionScrollbarTimeout.current) {
        window.clearTimeout(instructionScrollbarTimeout.current)
      }
    }
  }, [instructionCollapsed])

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

  const activeSegment = transcriptSegments[activeSegmentIndex] ?? null
  const hasMultipleSegments = transcriptSegments.length > 1

  const activeSegmentRows = useMemo(() => {
    if (!activeSegment || !hasMultipleSegments) {
      return transcriptRows
    }
    return transcriptRows.filter((row) => row.segmentId === activeSegment.id)
  }, [activeSegment, hasMultipleSegments, transcriptRows])

  const speakerOptions = useMemo(
    () => ['all', ...Array.from(new Set(activeSegmentRows.map((row) => row.speaker)))],
    [activeSegmentRows],
  )

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

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return activeSegmentRows.filter((row) => {
      const isFlagged = rowFlags[row.id] ?? row.flagged
      const matchesSearch =
        !query ||
        row.utterance.toLowerCase().includes(query) ||
        row.speaker.toLowerCase().includes(query)
      const matchesSpeaker =
        speakerFilter === 'all' || row.speaker === speakerFilter
      const matchesFlagged = !showFlaggedOnly || isFlagged
      return matchesSearch && matchesSpeaker && matchesFlagged
    })
  }, [activeSegmentRows, rowFlags, searchQuery, showFlaggedOnly, speakerFilter])

  const rowsWithCues = useMemo(() => {
    const rows = activeSegmentRows.filter((row) => row.inCue !== null)
    return rows.sort(
      (rowA, rowB) => (rowA.inCue ?? 0) - (rowB.inCue ?? 0),
    )
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

    const fallbackStart =
      cueStarts.length > 0 ? Math.min(...cueStarts) : null
    const fallbackEnd = cueEnds.length > 0 ? Math.max(...cueEnds) : null
    const rawStart = activeSegment?.startTime ?? fallbackStart ?? 0
    const startTime =
      typeof rawStart === 'number' && Number.isFinite(rawStart) ? Math.max(rawStart, 0) : 0
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

  const selectedTimelineNote = useMemo(
    () => noteBadges.find((note) => note.id === timelineNoteFilter) ?? null,
    [noteBadges, timelineNoteFilter],
  )

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

        // If we're between this row's end and the next start (a gap), keep this row active
        if (currentTime >= end && currentTime < nextStart) {
          return row
        }
      }
      return rowsWithCues[rowsWithCues.length - 1]
    },
    [rowsWithCues],
  )

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

    const handleVolumeChange = () => {
      const nextVolume = Number.isFinite(videoElement.volume)
        ? videoElement.volume
        : 0
      setVideoVolume(nextVolume)
      setIsVideoMuted(videoElement.muted || nextVolume === 0)
    }

    videoElement.addEventListener('volumechange', handleVolumeChange)
    return () => {
      videoElement.removeEventListener('volumechange', handleVolumeChange)
    }
  }, [videoSource?.url])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsVideoFullscreen(
        document.fullscreenElement === videoContainerRef.current,
      )
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (!selectedRow) return

    const handleArrowNavigation = (event: KeyboardEvent) => {
      if (isDragSelecting) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return
      }

      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName
        const isEditableTarget =
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          target.isContentEditable ||
          Boolean(target.closest('[contenteditable="true"]'))
        const insideAnnotationPanel = annotationPanelRef.current?.contains(target)
        if (isEditableTarget && !insideAnnotationPanel) {
          return
        }
      }

      const currentIndex = filteredRows.findIndex((row) => row.id === selectedRow)
      if (currentIndex === -1) {
        return
      }

      const offset = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex + offset
      if (nextIndex < 0 || nextIndex >= filteredRows.length) {
        return
      }

      event.preventDefault()
      const nextRowId = filteredRows[nextIndex].id
      selectRow(nextRowId)
      window.requestAnimationFrame(() => {
        const rowElement = document.querySelector<HTMLTableRowElement>(
          `[data-row-id="${nextRowId}"]`,
        )
        rowElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }

    window.addEventListener('keydown', handleArrowNavigation)
    return () => window.removeEventListener('keydown', handleArrowNavigation)
  }, [filteredRows, isDragSelecting, selectRow, selectedRow])

  useEffect(() => {
    if (!videoSource?.url) return
    resetSegmentPlayback()
  }, [resetSegmentPlayback, videoSource?.url])

  useEffect(() => {
    if (!hasMultipleSegments) return
    setCheckedRows({})
    setSelectedRow(activeSegmentRows[0]?.id ?? null)
    setActivePlaybackRowId(null)
    playbackRowRef.current = null
  }, [activeSegmentRows, hasMultipleSegments])

  const pageBackgroundStyle = useMemo(
    () => ({
      backgroundColor: theme.backgroundColor,
      backgroundImage: theme.backgroundImage ?? 'none',
    }),
    [theme],
  )

  const requestedTranscriptId = searchParams?.get('transcript') ?? null

  const loadNotes = useCallback(async (transcriptId: string) => {
    setNotesError(null)

    try {
      const response = await fetch(
        `/api/annotator/notes?transcriptId=${encodeURIComponent(transcriptId)}`,
      )
      const payload: NoteListResponse | null = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Failed to load notes.'
        throw new Error(message)
      }

      const normalized = createNoteBadges(payload.notes ?? [])
      const assignmentsByRow = createAssignmentLookup(payload.assignments ?? [])
      setNoteBadges(normalized)
      setExpandedNotes(createExpandedNotes(normalized))
      setNoteDetailsDrafts(createNoteDetailsDrafts(normalized))
      setNoteTitleDrafts(createEmptyNoteTitles(normalized))
      return { notes: normalized, assignmentsByRow }
    } catch (error) {
      console.error('Failed to load notes', error)
      setNoteBadges([])
      setExpandedNotes({})
      setNoteDetailsDrafts({})
      setNoteTitleDrafts({})
      const message =
        error instanceof Error ? error.message : 'Unable to load notes.'
      setNotesError(message)
      return { notes: [], assignmentsByRow: {} }
    }
  }, [])

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

      const normalized = (payload.items ?? []).map((item) => ({
        id: item.id,
        title: item.image_title?.trim() ?? '',
        imageUrl: item.url,
        description: item.description ?? null,
      }))

      setInstructionCards(normalized)
    } catch (error) {
      console.error('Failed to load instructional materials', error)
      setInstructionCards([])
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load instructional materials.'
      setInstructionCardsError(message)
    } finally {
      setIsLoadingInstructionCards(false)
    }
  }, [])

  const loadTranscript = useCallback(
    async (transcriptId: string) => {
      setIsLoadingTranscript(true)
      setTranscriptError(null)
      setInstructionCards([])
      setInstructionCardsError(null)
      setVideoSource(null)
      setVideoSourceError(null)
      activeVideoTranscriptRef.current = transcriptId

      try {
        const response = await fetch(
          `/api/annotator/transcripts/${encodeURIComponent(
            transcriptId,
          )}?transcriptId=${encodeURIComponent(transcriptId)}`,
        )
        const payload: TranscriptResponse | null = await response.json().catch(() => null)

        if (!response.ok || !payload?.success || !payload.transcript || !payload.lines) {
          const message = payload?.error ?? 'Failed to load transcript.'
          throw new Error(message)
        }

        const normalizedLines: TranscriptRow[] = payload.lines.map((line) => ({
          id: line.id,
          line: String(line.line ?? 0).padStart(3, '0'),
          speaker: line.speaker || 'Unknown speaker',
          utterance: line.utterance ?? '',
          inCue: parseCueValue(line.inCue),
          outCue: parseCueValue(line.outCue),
          segmentId: line.segmentId ?? null,
          flagged: Boolean(line.flagged),
        }))
        const normalizedSegments: TranscriptSegment[] = (payload.segments ?? [])
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
            ? normalizedLines.filter(
                (row) => row.segmentId === normalizedSegments[0]?.id,
              )
            : normalizedLines
        const { notes, assignmentsByRow } = await loadNotes(transcriptId)

        setTranscriptMeta(payload.transcript)
        setTranscriptRows(normalizedLines)
        setTranscriptSegments(normalizedSegments)
        loadInstructionalMaterials(transcriptId)
        setRowFlags(
          normalizedLines.reduce((acc, row) => {
            acc[row.id] = Boolean(row.flagged)
            return acc
          }, {} as Record<string, boolean>),
        )
        setRowAssignedNotes(buildRowAssignments(normalizedLines, notes, assignmentsByRow))
        setStaticNoteAssignmentsByRow(createStaticNoteAssignments(normalizedLines))
        setCheckedRows({})
        setSelectedRow(initialRows[0]?.id ?? null)
        setActivePlaybackRowId(null)
        playbackRowRef.current = null
        setActiveSegmentIndex(0)
        setSegmentPlaybackTime(0)
        setHasPlayedOnce(false)
        setShowVideoControls(false)
        setShowVideoPlayOverlay(true)
        setIsVideoPlaying(false)
        setTimelineNoteFilter(null)
        setVideoDuration(null)

        const videoResponse = await fetch(
          `/api/annotator/transcripts/${encodeURIComponent(
            transcriptId,
          )}/video?transcriptId=${encodeURIComponent(transcriptId)}`,
        )
        const videoPayload: VideoResponse | null = await videoResponse
          .json()
          .catch(() => null)

        if (activeVideoTranscriptRef.current !== transcriptId) {
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
        console.error('Failed to load transcript', error)
        setTranscriptMeta(null)
        setTranscriptRows([])
        setTranscriptSegments([])
        setInstructionCards([])
        setInstructionCardsError(null)
        setRowFlags({})
        setRowAssignedNotes({})
        setStaticNoteAssignmentsByRow({})
        setNoteBadges([])
        setExpandedNotes({})
        setExpandedStaticNotes({})
        setNoteDetailsDrafts({})
        setNoteTitleDrafts({})
        setNotesError(null)
        setActivePlaybackRowId(null)
        playbackRowRef.current = null
        setActiveSegmentIndex(0)
        setSegmentPlaybackTime(0)
        setHasPlayedOnce(false)
        setShowVideoControls(false)
        setShowVideoPlayOverlay(true)
        setIsVideoPlaying(false)
        setTimelineNoteFilter(null)
        setVideoDuration(null)
        setVideoSource(null)
        setVideoSourceError(null)
        const message =
          error instanceof Error ? error.message : 'Unable to load transcript.'
        setTranscriptError(message)
      } finally {
        setIsLoadingTranscript(false)
      }
    },
    [loadInstructionalMaterials, loadNotes],
  )

  useEffect(() => {
    if (!authLoaded || !userLoaded) {
      return
    }

    if (!isSignedIn) {
      router.replace('/')
      return
    }

    if (role === 'admin') {
      router.replace('/admin')
    }
  }, [authLoaded, isSignedIn, role, router, userLoaded])

  useEffect(() => {
    if (!authLoaded || !userLoaded) return
    if (!isSignedIn || role === 'admin') return

    if (!requestedTranscriptId) {
      setTranscriptMeta(null)
      setTranscriptRows([])
      setTranscriptSegments([])
      setInstructionCards([])
      setInstructionCardsError(null)
      setRowFlags({})
      setRowAssignedNotes({})
      setStaticNoteAssignmentsByRow({})
      setNoteBadges([])
      setExpandedNotes({})
      setExpandedStaticNotes({})
      setNoteDetailsDrafts({})
      setNoteTitleDrafts({})
      setNotesError(null)
      setCheckedRows({})
      setSelectedRow(null)
      setActiveSegmentIndex(0)
      setSegmentPlaybackTime(0)
      setHasPlayedOnce(false)
      setShowVideoControls(false)
      setShowVideoPlayOverlay(true)
      setIsVideoPlaying(false)
      setVideoSource(null)
      setVideoSourceError(null)
      activeVideoTranscriptRef.current = null
      setIsLoadingTranscript(false)
      setIsLoadingInstructionCards(false)
      setTranscriptError('Choose a transcript from your workspace to begin annotating.')
      return
    }

    if (requestedTranscriptId === transcriptMeta?.id) {
      return
    }

    loadTranscript(requestedTranscriptId)
  }, [
    authLoaded,
    isSignedIn,
    loadTranscript,
    requestedTranscriptId,
    role,
    transcriptMeta?.id,
    userLoaded,
  ])

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

  const checkedRowDetails = useMemo(
    () => activeSegmentRows.filter((row) => checkedRows[row.id]),
    [activeSegmentRows, checkedRows],
  )
  const checkedRowCount = checkedRowDetails.length
  const selectedRowData =
    activeSegmentRows.find((row) => row.id === selectedRow) ?? null
  const firstCheckedRow = selectedRowData ? null : checkedRowDetails[0] ?? null
  const activeRowData = selectedRowData ?? firstCheckedRow ?? null
  const activeRowId = activeRowData?.id ?? null
  const selectionTargetRowIds = useMemo(() => {
    if (checkedRowDetails.length > 0) {
      return checkedRowDetails.map((row) => row.id)
    }
    return activeRowId ? [activeRowId] : []
  }, [activeRowId, checkedRowDetails])
  const noteSelectionState = useMemo(() => {
    if (selectionTargetRowIds.length === 0) {
      return noteBadges.reduce((acc, note) => {
        acc[note.id] = { checked: false, indeterminate: false }
        return acc
      }, {} as Record<string, NoteSelectionSnapshot>)
    }

    return noteBadges.reduce((acc, note) => {
      const rowsWithNote = selectionTargetRowIds.filter(
        (rowId) => rowAssignedNotes[rowId]?.[note.id],
      )
      const allHaveNote = rowsWithNote.length === selectionTargetRowIds.length
      const someHaveNote = rowsWithNote.length > 0
      acc[note.id] = {
        checked: allHaveNote,
        indeterminate: !allHaveNote && someHaveNote,
      }
      return acc
    }, {} as Record<string, NoteSelectionSnapshot>)
  }, [noteBadges, rowAssignedNotes, selectionTargetRowIds])
  const flagSelectionState = useMemo(() => {
    const total = selectionTargetRowIds.length
    if (total === 0) {
      return {
        total: 0,
        flaggedCount: 0,
        allFlagged: false,
        someFlagged: false,
      }
    }

    const flaggedCount = selectionTargetRowIds.reduce(
      (count, rowId) => count + (rowFlags[rowId] ? 1 : 0),
      0,
    )
    const allFlagged = flaggedCount === total
    const someFlagged = flaggedCount > 0 && !allFlagged

    return {
      total,
      flaggedCount,
      allFlagged,
      someFlagged,
    }
  }, [rowFlags, selectionTargetRowIds])
  useEffect(() => {
    noteBadges.forEach((note) => {
      const checkbox = noteCheckboxRefs.current[note.id]
      if (checkbox) {
        checkbox.indeterminate = Boolean(
          noteSelectionState[note.id]?.indeterminate,
        )
      }
    })
  }, [noteBadges, noteSelectionState])
  const noteHighlightColorMap = useMemo(
    () =>
      noteBadges.reduce((acc, note, index) => {
        acc[note.id] =
          NOTE_HIGHLIGHT_COLORS[index % NOTE_HIGHLIGHT_COLORS.length]
        return acc
      }, {} as Record<string, string>),
    [noteBadges],
  )
  const annotationPanelTitle = useMemo(() => {
    const formatLineTitle = (
      lineValue: string | number | null | undefined,
    ): string | null => {
      if (lineValue === undefined || lineValue === null) {
        return null
      }
      return `Line ${String(lineValue).padStart(3, '0')}`
    }

    const checkedCount = checkedRowDetails.length
    if (checkedCount >= 2) {
      return `${checkedCount} lines selected`
    }

    const selectedLineTitle = formatLineTitle(selectedRowData?.line)
    if (selectedLineTitle) {
      return selectedLineTitle
    }

    const checkedLineTitle = formatLineTitle(checkedRowDetails[0]?.line)
    if (checkedLineTitle) {
      return checkedLineTitle
    }

    return 'Select a line'
  }, [checkedRowDetails, selectedRowData])
  const timelineHighlightColorClass =
    (timelineNoteFilter ? noteHighlightColorMap[timelineNoteFilter] : null) ??
    'bg-indigo-400'
  const hasTimelineHighlights =
    timelineNoteFilter !== null && timelineNoteSegments.length > 0
  const timelineTrackDuration =
    segmentDuration && segmentDuration > 0 ? segmentDuration : null
  const hasCheckedRows = checkedRowCount > 0
  const hasMultipleCheckedRows = checkedRowCount > 1
  const annotationTabs = [
    { id: 'assign', label: 'Notes' },
    { id: 'flag', label: 'Flags' },
  ]
  const flagIndicatorClass = flagSelectionState.allFlagged
    ? 'bg-rose-100 text-rose-600'
    : flagSelectionState.someFlagged
      ? 'bg-amber-100 text-amber-600'
      : 'bg-slate-100 text-slate-500'
  const flagStatusTitle = flagSelectionState.allFlagged
    ? flagSelectionState.total > 1
      ? 'Flags applied'
      : 'Flag active'
    : flagSelectionState.someFlagged
      ? 'Some flags applied'
      : 'No flag applied'
  const flagStatusDescription = flagSelectionState.allFlagged
    ? flagSelectionState.total > 1
      ? 'Remove them once the concerns are resolved.'
      : 'Remove it once the concern is resolved.'
    : flagSelectionState.someFlagged
      ? 'Add flags to the remaining lines to apply flags to all selected lines.'
      : flagSelectionState.total > 1
        ? 'Add flags to call attention to these lines.'
        : 'Add a flag to call attention to this line.'
  const flagActionLabel = flagSelectionState.allFlagged
    ? flagSelectionState.total > 1
      ? 'Remove flags'
      : 'Remove flag'
    : flagSelectionState.total > 1
      ? 'Add flags'
      : 'Add flag'
  const visibleCheckedRows = checkedRowDetails.slice(0, 12)
  const hiddenCheckedRowsCount = Math.max(
    checkedRowDetails.length - visibleCheckedRows.length,
    0,
  )
  const lineColumnWidth = '6.5rem'
  const speakerColumnWidth = '8.25rem'
  const noteColumnWidth = '12rem'
  const activeSegmentLabel = hasMultipleSegments
    ? `Section ${activeSegmentIndex + 1} of ${transcriptSegments.length}`
    : 'Video'
  const hasPreviousSegment = hasMultipleSegments && activeSegmentIndex > 0
  const hasNextSegment =
    hasMultipleSegments && activeSegmentIndex < transcriptSegments.length - 1
  const segmentPlaybackValue =
    segmentDuration && segmentDuration > 0
      ? Math.min(segmentPlaybackTime, segmentDuration)
      : 0
  const isSegmentSeekEnabled =
    Boolean(videoSource?.url) && Boolean(segmentDuration && segmentDuration > 0)
  const shouldShowPlayOverlay =
    Boolean(videoSource?.url) && !hasPlayedOnce && showVideoPlayOverlay

  const handleInstructionImageClick = useCallback((card: InstructionCard) => {
    setActiveInstructionImage({ src: card.imageUrl, title: card.title })
  }, [])

  const closeInstructionImage = useCallback(() => {
    setActiveInstructionImage(null)
  }, [])

  useEffect(() => {
    if (!activeInstructionImage) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeInstructionImage()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [activeInstructionImage, closeInstructionImage])

  if (!authLoaded || !userLoaded) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-3 pb-6 pt-0 text-slate-900 sm:px-4 lg:px-6"
        style={pageBackgroundStyle}
      >
        <p className="text-sm text-slate-500">Loading annotation workspace…</p>
      </div>
    )
  }

  if (!isSignedIn || role === 'admin') {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-3 pb-6 pt-0 text-slate-900 sm:px-4 lg:px-6"
        style={pageBackgroundStyle}
      >
        <p className="text-sm text-slate-500">Redirecting…</p>
      </div>
    )
  }

  const triggerSavedBadge = () => {
    setShowSavedBadge(true)
    if (savedBadgeTimeout.current) {
      window.clearTimeout(savedBadgeTimeout.current)
    }
    savedBadgeTimeout.current = window.setTimeout(() => {
      setShowSavedBadge(false)
    }, 2200)
  }

  const toggleNoteDetails = (noteId: string) => {
    setExpandedNotes((prev) => ({
      ...prev,
      [noteId]: !prev[noteId],
    }))
  }

  const handleNoteDescriptionChange = (
    noteId: string,
    fieldIndex: number,
    value: string,
  ) => {
    setNoteSaveErrors((prev) => {
      if (!prev[noteId]) {
        return prev
      }
      const next = { ...prev }
      delete next[noteId]
      return next
    })
    setNoteDetailsDrafts((prev) => {
      const currentFields = prev[noteId] ?? createNoteContentFields()
      const nextFields = [...currentFields]
      nextFields[fieldIndex] = value

      return {
        ...prev,
        [noteId]: nextFields,
      }
    })
  }

  const handleNoteTitleChange = (noteId: string, value: string) => {
    setNoteSaveErrors((prev) => {
      if (!prev[noteId]) {
        return prev
      }
      const next = { ...prev }
      delete next[noteId]
      return next
    })
    setNoteTitleDrafts((prev) => ({
      ...prev,
      [noteId]: value,
    }))
  }

  const openDeleteNoteModal = (noteId: string) => {
    setDeleteNoteId(noteId)
  }

  const closeDeleteNoteModal = () => {
    if (isDeletingNote) return
    setDeleteNoteId(null)
  }

  const handleDeleteNote = async (noteId: string) => {
    if (isDeletingNote) return
    setIsDeletingNote(true)
    setNoteSaveErrors((prev) => {
      if (!prev[noteId]) {
        return prev
      }
      const next = { ...prev }
      delete next[noteId]
      return next
    })

    try {
      const response = await fetch('/api/annotator/notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      })
      const payload: { success?: boolean; error?: string } | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Unable to delete note.'
        throw new Error(message)
      }

      setNoteBadges((prev) => prev.filter((entry) => entry.id !== noteId))
      setExpandedNotes((prev) => {
        if (!prev[noteId]) {
          return prev
        }
        const next = { ...prev }
        delete next[noteId]
        return next
      })
      setNoteDetailsDrafts((prev) => {
        if (!prev[noteId]) {
          return prev
        }
        const next = { ...prev }
        delete next[noteId]
        return next
      })
      setNoteTitleDrafts((prev) => {
        if (!prev[noteId]) {
          return prev
        }
        const next = { ...prev }
        delete next[noteId]
        return next
      })
      setRowAssignedNotes((prev) => {
        let didChange = false
        const nextAssignments: Record<string, Record<string, boolean>> = {}

        Object.entries(prev).forEach(([rowId, assignments]) => {
          if (!(noteId in assignments)) {
            nextAssignments[rowId] = assignments
            return
          }
          const { [noteId]: _removed, ...rest } = assignments
          nextAssignments[rowId] = rest
          didChange = true
        })

        return didChange ? nextAssignments : prev
      })
      setTimelineNoteFilter((current) => (current === noteId ? null : current))
      setDeleteNoteId(null)
      triggerSavedBadge()
    } catch (error) {
      console.error('Failed to delete note', error)
      const message =
        error instanceof Error ? error.message : 'Unable to delete note.'
      setNoteSaveErrors((prev) => ({
        ...prev,
        [noteId]: message,
      }))
    } finally {
      setIsDeletingNote(false)
    }
  }

  // Dragging across rows checks boxes instead of selecting text.
  const markRowCheckedDuringDrag = (rowId: string) => {
    setCheckedRows((prev) => (prev[rowId] ? prev : { ...prev, [rowId]: true }))
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
    const wasChecked = Boolean(checkedRows[rowId])
    setCheckedRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }))
    if (!wasChecked) {
      setAnnotationCollapsed(false)
    }
  }

  const toggleColumn = (key: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleToggleToolbar = () => {
    setToolbarVisible((previous) => {
      const next = !previous
      if (!next) {
        setFiltersOpen(false)
        setColumnsOpen(false)
      }
      return next
    })
  }

  const handleTimelineNoteSelect = (noteId: string | null) => {
    setTimelineNoteFilter((current) => (current === noteId ? null : noteId))
    setTimelineSettingsOpen(false)
  }

  const handleStaticNoteBadgeToggle = (noteId: string) => {
    setAnnotationCollapsed(false)
    setActiveAnnotationTab('assign')
    setExpandedStaticNotes((previous) => ({
      ...previous,
      [noteId]: !(previous[noteId] ?? false),
    }))
  }

  const handleNoteCheckboxChange = (noteId: string, nextChecked: boolean) => {
    if (selectionTargetRowIds.length === 0) return
    const targetRowIds = [...selectionTargetRowIds]
    setRowAssignedNotes((prev) => {
      let didChange = false
      const nextAssignments = { ...prev }

      targetRowIds.forEach((rowId) => {
        const existingAssignments =
          prev[rowId] ?? createEmptyNoteAssignments(noteBadges)
        if (existingAssignments[noteId] === nextChecked) {
          nextAssignments[rowId] = existingAssignments
          return
        }

        nextAssignments[rowId] = {
          ...existingAssignments,
          [noteId]: nextChecked,
        }
        didChange = true
      })

      return didChange ? nextAssignments : prev
    })
    triggerSavedBadge()
    void saveNoteAssignments(noteId, targetRowIds, nextChecked)
  }

  const saveNoteAssignments = async (
    noteId: string,
    lineIds: string[],
    assigned: boolean,
  ) => {
    if (lineIds.length === 0) return
    setNotesError(null)

    try {
      const response = await fetch('/api/annotator/note-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          lineIds,
          assigned,
        }),
      })
      const payload: { success?: boolean; error?: string } | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Unable to save note assignments.'
        throw new Error(message)
      }
    } catch (error) {
      console.error('Failed to save note assignments', error)
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to save note assignments.'
      setNotesError(message)
    }
  }

  const handleSaveNoteChanges = async (noteId: string) => {
    if (savingNoteIds[noteId]) return
    const note = noteBadges.find((entry) => entry.id === noteId)
    if (!note) return

    const currentTitle = (noteTitleDrafts[noteId] ?? '').trim()
    const currentDetails =
      noteDetailsDrafts[noteId] ?? createNoteContentFields(note)
    const nextDetails = [
      (currentDetails[0] ?? '').trim(),
      (currentDetails[1] ?? '').trim(),
      (currentDetails[2] ?? '').trim(),
    ]

    const didChange =
      currentTitle !== (note.label ?? '').trim() ||
      nextDetails[0] !== (note.q1 ?? '').trim() ||
      nextDetails[1] !== (note.q2 ?? '').trim() ||
      nextDetails[2] !== (note.q3 ?? '').trim()

    if (!didChange) {
      triggerSavedBadge()
      return
    }

    setSavingNoteIds((prev) => ({ ...prev, [noteId]: true }))
    setNoteSaveErrors((prev) => {
      if (!prev[noteId]) {
        return prev
      }
      const next = { ...prev }
      delete next[noteId]
      return next
    })

    try {
      const response = await fetch('/api/annotator/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          title: currentTitle,
          q1: nextDetails[0],
          q2: nextDetails[1],
          q3: nextDetails[2],
        }),
      })
      const payload: NoteUpdateResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success || !payload.note) {
        const message = payload?.error ?? 'Unable to update note.'
        throw new Error(message)
      }

      const updatedNote = payload.note
      setNoteBadges((prev) =>
        prev.map((entry) => {
          if (entry.id !== noteId) {
            return entry
          }
          const nextLabel = updatedNote.title.trim()
            ? updatedNote.title.trim()
            : `Note ${entry.number}`
          return {
            ...entry,
            label: nextLabel,
            q1: updatedNote.q1,
            q2: updatedNote.q2,
            q3: updatedNote.q3,
          }
        }),
      )
      setNoteTitleDrafts((prev) => ({
        ...prev,
        [noteId]: updatedNote.title,
      }))
      setNoteDetailsDrafts((prev) => ({
        ...prev,
        [noteId]: [updatedNote.q1, updatedNote.q2, updatedNote.q3],
      }))
      triggerSavedBadge()
    } catch (error) {
      console.error('Failed to update note', error)
      const message =
        error instanceof Error ? error.message : 'Unable to update note.'
      setNoteSaveErrors((prev) => ({
        ...prev,
        [noteId]: message,
      }))
    } finally {
      setSavingNoteIds((prev) => {
        if (!prev[noteId]) {
          return prev
        }
        const next = { ...prev }
        delete next[noteId]
        return next
      })
    }
  }

  const handleToggleFlag = () => {
    if (selectionTargetRowIds.length === 0) return
    const nextValue = !flagSelectionState.allFlagged
    setRowFlags((prev) => {
      let didChange = false
      const next = { ...prev }

      selectionTargetRowIds.forEach((rowId) => {
        if (prev[rowId] === nextValue) {
          return
        }
        next[rowId] = nextValue
        didChange = true
      })

      return didChange ? next : prev
    })
    triggerSavedBadge()
    void saveFlagAssignments(selectionTargetRowIds, nextValue)
  }

  const saveFlagAssignments = async (lineIds: string[], flagged: boolean) => {
    if (lineIds.length === 0) return
    setFlagSaveError(null)

    try {
      const response = await fetch('/api/annotator/flag-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineIds,
          flagged,
        }),
      })
      const payload: { success?: boolean; error?: string } | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Unable to save flag.'
        throw new Error(message)
      }
    } catch (error) {
      console.error('Failed to save flag assignment', error)
      const message =
        error instanceof Error ? error.message : 'Unable to save flag.'
      setFlagSaveError(message)
    }
  }

  const handleBackToWorkspace = () => {
    router.push('/workspace')
  }

  const handleMarkAnnotationComplete = async (completed: boolean) => {
    if (isMarkingComplete) return
    const transcriptId = transcriptMeta?.id ?? ''
    if (!transcriptId) {
      setCompletionError('Select a transcript before updating the status.')
      return
    }

    setIsMarkingComplete(true)
    setCompletionError(null)

    try {
      const response = await fetch('/api/annotator/annotations/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcriptId, completed }),
      })
      const payload: { success?: boolean; error?: string } | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message =
          payload?.error ??
          'Unable to update the annotation completion status.'
        throw new Error(message)
      }

      setTranscriptMeta((previous) =>
        previous ? { ...previous, annotationCompleted: completed } : previous,
      )
      triggerSavedBadge()
    } catch (error) {
      console.error('Failed to mark annotation as complete', error)
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update the annotation completion status.'
      setCompletionError(message)
    } finally {
      setIsMarkingComplete(false)
    }
  }

  const handleCreateNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreatingNote) return
    const title = newNote.title.trim()
    const transcriptId = transcriptMeta?.id ?? ''
    if (!transcriptId) {
      setCreateNoteError('Select a transcript before creating a note.')
      return
    }
    if (!title) return

    setIsCreatingNote(true)
    setCreateNoteError(null)

    try {
      const response = await fetch('/api/annotator/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcriptId,
          title,
          studentEvidence: newNote.studentEvidence,
          utteranceNote: newNote.utteranceNote,
          thinkingInsight: newNote.thinkingInsight,
        }),
      })
      const payload: NoteCreateResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success) {
        const message = payload?.error ?? 'Unable to create note.'
        throw new Error(message)
      }

      const { notes, assignmentsByRow } = await loadNotes(transcriptId)
      setRowAssignedNotes(
        buildRowAssignments(transcriptRows, notes, assignmentsByRow),
      )
      setNewNote(createEmptyNewNote())
      setShowCreateNoteForm(false)
      triggerSavedBadge()
    } catch (error) {
      console.error('Failed to create note', error)
      const message =
        error instanceof Error ? error.message : 'Unable to create note.'
      setCreateNoteError(message)
    } finally {
      setIsCreatingNote(false)
    }
  }

  const handleMenuLinkAction = (link: { id: string }) => {
    if (link.id === 'toggle-toolbar') {
      handleToggleToolbar()
      return
    }

    if (link.id === 'toggle-llm-annotations') {
      setShowLlmAnnotations((previous) => !previous)
      return
    }

    if (link.id === 'hunt') {
      router.push('/scavenger-hunt')
    }

    if (link.id === 'complete') {
      handleMarkAnnotationComplete(!isAnnotationComplete)
    }
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

  const deleteNote = deleteNoteId
    ? noteBadges.find((entry) => entry.id === deleteNoteId) ?? null
    : null
  const deleteNoteLabel = deleteNote?.label ?? 'this note'

  return (
    <div
      className="flex min-h-screen flex-col px-3 pb-6 pt-0 text-slate-900 sm:px-4 lg:px-6 lg:h-screen lg:overflow-hidden"
      style={pageBackgroundStyle}
    >
      <div className="mx-auto flex w-full max-w-none flex-1 flex-col gap-2 lg:min-h-0 lg:overflow-hidden">
        <WorkspaceHeader
          toolbarVisible={toolbarVisible}
          onToggleToolbar={handleToggleToolbar}
          onWorkspaceClick={handleBackToWorkspace}
          showWorkspaceButton
          showToolbarToggleButton={false}
          menuLinks={annotationMenuLinks}
          onMenuLinkClick={handleMenuLinkAction}
          variant="minimal"
          density="compact"
          workspaceButtonVariant="icon"
        />

        {toolbarVisible && (
          <section className="relative z-40 flex-shrink-0 rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/70 backdrop-blur-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  placeholder="Search lines, speakers, or notes"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white/70 py-3 pl-12 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((prev) => !prev)}
                  className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${
                    filtersOpen
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  <ListFilter className="h-4 w-4" />
                  Filters
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setColumnsOpen((prev) => !prev)}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                  >
                    <Columns3 className="h-4 w-4" />
                    Columns
                  </button>
                  {columnsOpen && (
                    <div className="absolute right-0 z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-200/80">
                      <p className="text-xs uppercase tracking-widest text-slate-500">
                        Visible columns
                      </p>
                      <div className="mt-3 space-y-2 text-sm">
                        {(['speaker', 'utterance', 'notes'] as const).map(
                          (column) => (
                            <label
                              key={column}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-2"
                            >
                              <span className="capitalize text-slate-600">
                                {column}
                              </span>
                              <input
                                type="checkbox"
                                checked={visibleColumns[column]}
                                onChange={() => toggleColumn(column)}
                                className="h-4 w-4 rounded border-slate-300 bg-white text-indigo-500"
                              />
                            </label>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div
              className={`grid transform gap-4 overflow-hidden transition-all duration-500 ${
                filtersOpen
                  ? 'mt-4 grid-cols-1 opacity-100 md:grid-cols-2'
                  : 'max-h-0 opacity-0'
              }`}
            >
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Speaker
                </span>
                <select
                  value={speakerFilter}
                  onChange={(event) => setSpeakerFilter(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none"
                >
                  {speakerOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === 'all' ? 'All speakers' : option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Flags
                </span>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={showFlaggedOnly}
                    onChange={(event) => setShowFlaggedOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 bg-white text-rose-500"
                  />
                  Show flagged only
                </label>
                <p className="text-xs text-slate-500">
                  Focus solely on lines that have been flagged.
                </p>
              </div>
            </div>
          </section>
        )}

        <main className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:overflow-hidden">
          <aside
            className={`flex min-h-0 flex-col rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/70 backdrop-blur-2xl transition-all duration-500 ${
              instructionCollapsed ? 'lg:w-16' : 'lg:w-80'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-1 items-center">
                {!instructionCollapsed && (
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-500">
                      {transcriptMeta?.grade ? `Grade ${transcriptMeta.grade}` : 'Transcript'}
                    </p>
                    <p className="text-base font-semibold text-slate-900">
                      {transcriptMeta?.title ?? 'Select a transcript'}
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setInstructionCollapsed((previous) => !previous)
                }
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                aria-label={
                  instructionCollapsed ? 'Expand instructions' : 'Collapse instructions'
                }
              >
                {instructionCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            </div>
            {!instructionCollapsed ? (
              <div className="mt-4 flex flex-1 flex-col gap-4 overflow-hidden">
                <div
                  ref={instructionScrollRef}
                  className={`stealth-scrollbar flex-1 space-y-3 overflow-y-auto pr-1 ${
                    showInstructionScrollbar ? 'stealth-scrollbar--active' : ''
                  }`}
                >
                  <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      Instruction & context
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {transcriptMeta?.instructionContext?.trim()
                        ? transcriptMeta.instructionContext
                        : 'No instructional context has been provided for this transcript yet.'}
                    </p>
                  </div>
                  {isLoadingInstructionCards ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
                      Loading instructional materials…
                    </div>
                  ) : instructionCards.length > 0 ? (
                    instructionCards.map((card) => {
                      const hasTitle = Boolean(card.title)
                      const fallbackLabel = 'Instructional material image'
                      return (
                        <div
                          key={card.id}
                          className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-200/70"
                        >
                          <button
                            type="button"
                            onClick={() => handleInstructionImageClick(card)}
                            className="group relative block w-full overflow-hidden rounded-2xl bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                            aria-label={
                              hasTitle ? `View ${card.title}` : 'View instructional material image'
                            }
                          >
                            <Image
                              src={card.imageUrl}
                              alt={hasTitle ? card.title : fallbackLabel}
                              width={320}
                              height={144}
                              className="h-36 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              sizes="(min-width: 1024px) 320px, 100vw"
                            />
                            <span className="sr-only">
                              {hasTitle ? `Expand ${card.title}` : 'Expand instructional material'}
                            </span>
                          </button>
                          {hasTitle && (
                            <h3 className="mt-3 text-base font-semibold text-slate-900">
                              {card.title}
                            </h3>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
                      {instructionCardsError ??
                        'No instructional materials have been uploaded yet.'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center gap-4">
                {isLoadingInstructionCards ? (
                  <p className="text-xs text-slate-500">Loading…</p>
                ) : instructionCards.length > 0 ? (
                  instructionCards.map((card) => {
                    const hasTitle = Boolean(card.title)
                    const fallbackLabel = 'Instructional material image'
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => handleInstructionImageClick(card)}
                        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-indigo-200 hover:bg-indigo-50"
                        title={hasTitle ? card.title : undefined}
                        aria-label={
                          hasTitle ? `View ${card.title}` : 'View instructional material image'
                        }
                      >
                        <Image
                          src={card.imageUrl}
                          alt={hasTitle ? card.title : fallbackLabel}
                          width={44}
                          height={44}
                          className="h-full w-full object-cover"
                          sizes="44px"
                        />
                      </button>
                    )
                  })
                ) : (
                  <p className="text-xs text-slate-500">No materials</p>
                )}
              </div>
            )}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <div className="relative flex min-h-0 flex-1 flex-col gap-3 rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70">
              <div
                className={`flex flex-col gap-3 transition-all duration-300 ${
                  isPictureInPicture
                    ? 'absolute left-0 top-0 invisible pointer-events-none'
                    : ''
                }`}
                aria-hidden={isPictureInPicture}
              >
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
                  {timelineNoteFilter && timelineTrackDuration && (
                    <div
                      className={`pointer-events-none absolute inset-x-4 ${
                        showVideoControls ? 'bottom-16' : 'bottom-3'
                      } z-30 h-2 overflow-visible`}
                    >
                      {timelineNoteSegments.map((segment, index) => {
                        const startPercent = Math.max(
                          0,
                          (segment.start / timelineTrackDuration) * 100,
                        )
                        const clampedStart = Math.min(100, startPercent)
                        const endPercent = Math.min(
                          100,
                          (segment.end / timelineTrackDuration) * 100,
                        )
                        const widthPercent = Math.min(
                          Math.max(endPercent - clampedStart, 0.8),
                          100 - clampedStart,
                        )
                        return (
                          <span
                            key={`${segment.rowId}-${index}`}
                            className={`absolute top-0 bottom-0 rounded-full shadow-sm shadow-slate-900/30 ${timelineHighlightColorClass}`}
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
                      <source
                        src={videoSource.url}
                        type={videoSource.mimeType ?? 'video/mp4'}
                      />
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
                      shouldShowPlayOverlay
                        ? ''
                        : 'pointer-events-none opacity-0'
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
                      <path
                        d="M5 4.2c0-1.18 1.3-1.9 2.34-1.2l11.2 7a1.5 1.5 0 0 1 0 2.6l-11.2 7c-1.04.66-2.34-.06-2.34-1.26V4.2Z"
                      />
                    </svg>
                  </button>
                  {videoSource?.url && (
                    <div
                      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-4 pb-3 pt-8 text-white transition duration-200 ${
                        showVideoControls ? 'opacity-100' : 'pointer-events-none opacity-0'
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
                                  Show where a note tag appears across the
                                  video.
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
                                    const isActive =
                                      timelineNoteFilter === note.id
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
                                          Show "{note.label}" on timeline
                                        </span>
                                        {isActive && (
                                          <Check className="h-4 w-4" />
                                        )}
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
              <div
                ref={transcriptScrollRef}
                className={`stealth-scrollbar relative flex-1 min-w-0 overflow-auto rounded-2xl border border-slate-100 bg-white/70 p-2 ${
                  showTranscriptScrollbar ? 'stealth-scrollbar--active' : ''
                } ${isDragSelecting ? 'select-none' : ''}`}
              >
                {isLoadingTranscript ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-slate-500">
                    Loading transcript lines…
                  </div>
                ) : transcriptError ? (
                  <div
                    className={`flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed p-4 text-sm ${
                      transcriptMeta
                        ? 'border-rose-200 bg-rose-50/70 font-semibold text-rose-700'
                        : 'border-slate-300 bg-slate-50/70 text-slate-600'
                    }`}
                  >
                    {transcriptError}
                  </div>
                ) : activeSegmentRows.length === 0 ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-600">
                    No transcript lines available.
                  </div>
                ) : (
                  <table className="w-full table-fixed border-separate border-spacing-y-3">
                    <colgroup>
                      <col style={{ width: lineColumnWidth }} />
                      {visibleColumns.speaker && (
                        <col style={{ width: speakerColumnWidth }} />
                      )}
                      {visibleColumns.utterance && <col />}
                      {visibleColumns.notes && <col style={{ width: noteColumnWidth }} />}
                    </colgroup>
                    <thead className="rounded-2xl bg-white">
                      <tr className="text-left text-xs uppercase tracking-widest text-slate-500">
                        <th
                          className="bg-white px-3 py-2 align-middle"
                          style={{
                            width: lineColumnWidth,
                            minWidth: lineColumnWidth,
                          }}
                        >
                          Line
                        </th>
                        {visibleColumns.speaker && (
                          <th
                            className="bg-white px-3 py-2 align-middle"
                            style={{
                              width: speakerColumnWidth,
                              minWidth: speakerColumnWidth,
                            }}
                          >
                            Speaker
                          </th>
                        )}
                        {visibleColumns.utterance && (
                          <th className="bg-white px-3 py-2 align-middle">
                            Utterance
                          </th>
                        )}
                        {visibleColumns.notes && (
                          <th
                            className="bg-white px-3 py-2 align-middle"
                            style={{
                              width: noteColumnWidth,
                              minWidth: noteColumnWidth,
                            }}
                          >
                            Notes
                          </th>
                        )}
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
                        const activeRowStaticNotes = showLlmAnnotations
                          ? (staticNoteAssignmentsByRow[row.id] ?? [])
                              .map((noteId) => STATIC_ASSIGN_NOTE_LOOKUP[noteId])
                              .filter(
                                (note): note is (typeof STATIC_ASSIGN_NOTES)[number] =>
                                  Boolean(note),
                              )
                          : []
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
                        const rowBgClass = isActive ? selectedBgClass : speakerColor.rowBg
                        const hoverBgClass = isActive ? '' : speakerColor.hoverBg
                        const stickyBgClass = isActive
                          ? selectedStickyBgClass
                          : `${speakerColor.stickyBg} ${speakerColor.hoverBg}`
                        const borderClass = isActive ? selectedBorderClass : speakerColor.border
                        const selectedClasses = isActive
                          ? `ring-1 ${selectedRingClass} shadow-sm ${selectedShadowClass}`
                          : ''
                        return (
                          <tr
                            key={row.id}
                            data-row-id={row.id}
                            onClick={() => handleRowSelection(row.id)}
                            onDoubleClick={() => handleRowDoubleClick(row.id)}
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
                                    <span className="text-rose-500" title="Flagged line">
                                      <Flag className="h-4 w-4" aria-hidden="true" />
                                      <span className="sr-only">Flagged line</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            {visibleColumns.speaker && (
                              <td
                                className={`sticky z-10 px-3 py-4 ${stickyBgClass} min-w-0`}
                                style={{
                                  left: lineColumnWidth,
                                  width: speakerColumnWidth,
                                  minWidth: speakerColumnWidth,
                                }}
                              >
                                <span
                                  className={`flex w-full items-center rounded-xl px-3 py-1 text-xs font-semibold ${speakerChipClass} truncate`}
                                >
                                  {row.speaker}
                                </span>
                              </td>
                            )}
                            {visibleColumns.utterance && (
                              <td className="min-w-0 px-3 py-4 align-top">
                                <p className="break-words text-sm leading-relaxed text-slate-800">
                                  {row.utterance}
                                </p>
                              </td>
                            )}
                            {visibleColumns.notes && (
                              <td
                                className="min-w-0 rounded-r-2xl px-3 py-4"
                                style={{
                                  width: noteColumnWidth,
                                  minWidth: noteColumnWidth,
                                }}
                              >
                                {(activeRowNotes.length > 0 ||
                                  activeRowStaticNotes.length > 0) && (
                                  <div className="flex flex-wrap gap-2">
                                    {activeRowNotes.map((note) => {
                                      const isTimelineNoteActive =
                                        timelineNoteFilter === note.id
                                      return (
                                        <button
                                          key={note.id}
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            handleTimelineNoteSelect(note.id)
                                          }}
                                          onMouseDown={(event) => event.stopPropagation()}
                                          onMouseUp={(event) => event.stopPropagation()}
                                          onDoubleClick={(event) =>
                                            event.stopPropagation()
                                          }
                                          aria-pressed={isTimelineNoteActive}
                                          title={
                                            isTimelineNoteActive
                                              ? `Hide "${note.label}" highlight`
                                              : `Show "${note.label}" highlight`
                                          }
                                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold shadow-sm transition ${
                                            isTimelineNoteActive
                                              ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-indigo-100'
                                              : 'border-slate-200 bg-white/80 text-slate-700 shadow-slate-100'
                                          }`}
                                        >
                                          {note.label}
                                        </button>
                                      )
                                    })}
                                    {activeRowStaticNotes.map((note) => {
                                      const isNoteExpanded =
                                        expandedStaticNotes[note.id] ?? false
                                      return (
                                        <button
                                          key={note.id}
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            handleStaticNoteBadgeToggle(note.id)
                                          }}
                                          onMouseDown={(event) => event.stopPropagation()}
                                          onMouseUp={(event) => event.stopPropagation()}
                                          onDoubleClick={(event) =>
                                            event.stopPropagation()
                                          }
                                          aria-expanded={isNoteExpanded}
                                          title={
                                            isNoteExpanded
                                              ? `Collapse "${note.title}" details`
                                              : `Expand "${note.title}" details`
                                          }
                                          className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 shadow-sm shadow-indigo-100 transition"
                                        >
                                          {note.title}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </td>
                            )}
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
                activeSegmentRows.length > 0 && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No lines match your current filters. Try adjusting the search or speaker/flag
                  filters.
                </div>
              )}
            </div>
          </section>

          <aside
            className={`flex min-h-0 flex-col rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/70 backdrop-blur-xl transition-all duration-500 lg:sticky lg:top-6 ${
              annotationCollapsed ? 'lg:w-16' : 'lg:w-96'
            }`}
            ref={annotationPanelRef}
          >
            {annotationCollapsed ? (
              <button
                type="button"
                onClick={() => setAnnotationCollapsed(false)}
                className="flex h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white/80 text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                aria-label="Expand annotations panel"
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="sr-only">Expand annotations panel</span>
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-500">
                      Annotations
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {annotationPanelTitle}
                    </p>
                    {completionError && (
                      <p className="mt-1 text-xs text-rose-600">
                        {completionError}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {showSavedBadge && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Saved
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setAnnotationCollapsed((previous) => !previous)
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                      aria-label="Collapse annotations panel"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-1 flex-col gap-4 overflow-hidden">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
                    <div className="grid grid-cols-2 gap-1">
                      {annotationTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() =>
                            setActiveAnnotationTab(tab.id as typeof activeAnnotationTab)
                          }
                          className={`rounded-xl px-3 py-2 text-xs transition ${
                            activeAnnotationTab === tab.id
                              ? 'bg-white text-slate-900 shadow-sm shadow-slate-200/80'
                              : 'text-slate-500'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex h-full flex-col gap-4 overflow-hidden">
                    <div className="flex-1 overflow-hidden">
                      {activeRowData ? (
                        <div className="stealth-scrollbar h-full space-y-5 overflow-y-auto pr-1">
                          {activeAnnotationTab === 'assign' && (
                            <div className="space-y-5">
                              <div className="space-y-3">
                                {showLlmAnnotations && (
                                  <p className="text-[11px] uppercase tracking-widest text-slate-400">
                                    My notes
                                  </p>
                                )}
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowCreateNoteForm((previous) => !previous)
                                    }
                                    aria-expanded={showCreateNoteForm}
                                    aria-controls="create-note-template"
                                    className={`flex w-full items-center justify-between gap-2 px-3 py-3 text-sm font-semibold text-slate-600 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${
                                      showCreateNoteForm
                                        ? 'border-b border-slate-200 bg-white/80'
                                        : ''
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      {!showCreateNoteForm && (
                                        <Plus className="h-4 w-4" />
                                      )}
                                      {showCreateNoteForm ? 'New note' : 'Create a note'}
                                    </span>
                                    {showCreateNoteForm && (
                                      <X
                                        className="h-4 w-4 text-slate-400"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                  {showCreateNoteForm && (
                                    <form
                                      id="create-note-template"
                                      onSubmit={handleCreateNote}
                                      className="space-y-4 bg-white p-4"
                                    >
                                      <div className="space-y-2">
                                        <label className="text-sm font-semibold text-slate-700">
                                          Title
                                        </label>
                                        <input
                                          type="text"
                                          value={newNote.title}
                                          onChange={(event) => {
                                            setCreateNoteError(null)
                                            setNewNote((prev) => ({
                                              ...prev,
                                              title: event.target.value,
                                            }))
                                          }}
                                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none"
                                          placeholder="e.g., Student connects area models"
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-sm font-semibold text-slate-700">
                                          What are students saying in the selected piece(s) of evidence?
                                        </label>
                                        <textarea
                                          value={newNote.studentEvidence}
                                          onChange={(event) => {
                                            setCreateNoteError(null)
                                            setNewNote((prev) => ({
                                              ...prev,
                                              studentEvidence: event.target.value,
                                            }))
                                          }}
                                          rows={3}
                                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none"
                                          placeholder="Capture direct quotes or summaries from the selected lines."
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-sm font-semibold text-slate-700">
                                          What would you like to note about this utterance?
                                        </label>
                                        <textarea
                                          value={newNote.utteranceNote}
                                          onChange={(event) => {
                                            setCreateNoteError(null)
                                            setNewNote((prev) => ({
                                              ...prev,
                                              utteranceNote: event.target.value,
                                            }))
                                          }}
                                          rows={3}
                                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none"
                                          placeholder="Add your observation, context, or instructional move to track."
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-sm font-semibold text-slate-700">
                                          What does this utterance reveal about the student's thinking or understanding?
                                        </label>
                                        <textarea
                                          value={newNote.thinkingInsight}
                                          onChange={(event) => {
                                            setCreateNoteError(null)
                                            setNewNote((prev) => ({
                                              ...prev,
                                              thinkingInsight: event.target.value,
                                            }))
                                          }}
                                          rows={3}
                                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none"
                                          placeholder="Interpret the mathematical reasoning or misconception you're seeing."
                                        />
                                      </div>
                                      <button
                                        type="submit"
                                        disabled={
                                          isCreatingNote ||
                                          !newNote.title.trim() ||
                                          !transcriptMeta?.id
                                        }
                                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-500/80 to-sky-400/80 px-4 py-3 text-sm font-semibold text-white transition hover:from-indigo-500 hover:to-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        <Plus className="h-4 w-4" />
                                        {isCreatingNote
                                          ? 'Creating note...'
                                          : 'Create new note'}
                                      </button>
                                      {createNoteError && (
                                        <p className="text-xs text-rose-600">
                                          {createNoteError}
                                        </p>
                                      )}
                                    </form>
                                  )}
                                </div>
                              </div>
                              {notesError && (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                  {notesError}
                                </div>
                              )}
                              {!notesError && noteBadges.length === 0 && (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                                  No notes yet. Create one to start assigning.
                                </div>
                              )}
                              {noteBadges.map((note) => {
                                const noteState =
                                  noteSelectionState[note.id] ?? {
                                    checked: false,
                                    indeterminate: false,
                                  }
                                const isNoteActive = noteState.checked
                                const isNoteMixed = noteState.indeterminate
                                const isExpanded = expandedNotes[note.id] ?? false
                                const noteDetailsValues =
                                  noteDetailsDrafts[note.id] ??
                                  createNoteContentFields()
                                const noteTitleValue = noteTitleDrafts[note.id] ?? ''
                                const noteCardToneClass = isNoteActive
                                  ? 'border-slate-300 bg-white text-slate-900 shadow-sm shadow-slate-200/80'
                                  : isNoteMixed
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-700'
                                return (
                                  <div
                                    key={note.id}
                                    className={`rounded-2xl border transition ${noteCardToneClass}`}
                                  >
                                    <label className="flex items-center gap-3 px-3 py-3">
                                      <input
                                        type="checkbox"
                                        ref={(element) => {
                                          noteCheckboxRefs.current[note.id] =
                                            element
                                        }}
                                        checked={isNoteActive}
                                        onChange={(event) =>
                                          handleNoteCheckboxChange(
                                            note.id,
                                            event.target.checked,
                                          )
                                        }
                                        className="h-4 w-4 rounded border-slate-300 bg-white text-indigo-500"
                                      />
                                      <div className="flex-1">
                                        <p className="text-sm font-semibold text-slate-900">
                                          {note.label}
                                        </p>
                                        {isNoteMixed && (
                                          <p className="text-xs font-semibold text-amber-700">
                                            Only some selected lines use this
                                            tag
                                          </p>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        aria-label={
                                          isExpanded
                                            ? 'Hide note content'
                                            : 'Show note content'
                                        }
                                        aria-expanded={isExpanded}
                                        onClick={(event) => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                          toggleNoteDetails(note.id)
                                        }}
                                        className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                      >
                                        <ChevronDown
                                          className={`h-4 w-4 transition-transform ${
                                            isExpanded ? 'rotate-180' : ''
                                          }`}
                                          aria-hidden="true"
                                        />
                                      </button>
                                    </label>
                                    {isExpanded && (
                                      <div className="space-y-3 border-t border-slate-200/70 px-3 pb-3 pt-2">
                                        <div className="space-y-2">
                                          <p className="text-xs font-semibold text-slate-500">
                                            Title
                                          </p>
                                          <input
                                            type="text"
                                            value={noteTitleValue}
                                            onChange={(event) =>
                                              handleNoteTitleChange(
                                                note.id,
                                                event.target.value,
                                              )
                                            }
                                            onBlur={triggerSavedBadge}
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none"
                                            placeholder="Add a note title"
                                          />
                                        </div>
                                        {NOTE_DETAILS_FIELD_CONFIG.map(
                                          (field, fieldIndex) => (
                                            <div
                                              key={`${note.id}-${field.id}`}
                                              className="space-y-2"
                                            >
                                              <p className="text-xs font-semibold text-slate-500">
                                                {field.label}
                                              </p>
                                              <textarea
                                                value={noteDetailsValues[fieldIndex] ?? ''}
                                                onChange={(event) =>
                                                  handleNoteDescriptionChange(
                                                    note.id,
                                                    fieldIndex,
                                                    event.target.value,
                                                  )
                                                }
                                                onBlur={triggerSavedBadge}
                                                rows={3}
                                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none"
                                                placeholder={field.placeholder}
                                              />
                                            </div>
                                          ),
                                        )}
                                        <div className="flex gap-3 pt-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openDeleteNoteModal(note.id)
                                            }
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                                          >
                                            Delete note
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleSaveNoteChanges(note.id)}
                                            disabled={Boolean(savingNoteIds[note.id])}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
                                          >
                                            {savingNoteIds[note.id]
                                              ? 'Saving...'
                                              : 'Save changes'}
                                          </button>
                                        </div>
                                        {noteSaveErrors[note.id] && (
                                          <p className="text-xs text-rose-600">
                                            {noteSaveErrors[note.id]}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                              {showLlmAnnotations && (
                                <div className="space-y-3 border-t border-slate-200/70 pt-3">
                                  <p className="text-[11px] uppercase tracking-widest text-slate-400">
                                    LLM notes
                                  </p>
                                  {STATIC_ASSIGN_NOTES.map((note) => {
                                    const isExpanded =
                                      expandedStaticNotes[note.id] ?? false
                                    return (
                                      <div
                                        key={note.id}
                                        className="rounded-2xl border border-indigo-200 bg-indigo-50/70 text-indigo-700 transition"
                                      >
                                        <div className="flex items-center gap-3 px-3 py-3">
                                          <div className="h-4 w-4" aria-hidden="true" />
                                          <p className="text-sm font-semibold text-slate-900">
                                            {note.title}
                                          </p>
                                          <button
                                            type="button"
                                            aria-label={
                                              isExpanded
                                                ? 'Hide static note details'
                                                : 'Show static note details'
                                            }
                                            aria-expanded={isExpanded}
                                            onClick={() =>
                                              setExpandedStaticNotes((previous) => ({
                                                ...previous,
                                                [note.id]: !isExpanded,
                                              }))
                                            }
                                            className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                          >
                                            <ChevronDown
                                              className={`h-4 w-4 transition-transform ${
                                                isExpanded ? 'rotate-180' : ''
                                              }`}
                                              aria-hidden="true"
                                            />
                                          </button>
                                        </div>
                                        {isExpanded && (
                                          <div className="space-y-3 border-t border-slate-200/70 px-3 pb-3 pt-2">
                                            <div className="space-y-2">
                                              <p className="text-xs font-semibold text-slate-500">
                                                Title
                                              </p>
                                              <div className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                                                {note.title}
                                              </div>
                                            </div>
                                            {NOTE_DETAILS_FIELD_CONFIG.map(
                                              (field) => (
                                                <div
                                                  key={`${note.id}-${field.id}`}
                                                  className="space-y-2"
                                                >
                                                  <p className="text-xs font-semibold text-slate-500">
                                                    {field.label}
                                                  </p>
                                                  <div className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                                                    {note[field.noteKey]}
                                                  </div>
                                                </div>
                                              ),
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                          {activeAnnotationTab === 'flag' && (
                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${flagIndicatorClass}`}
                                >
                                  <Flag className="h-5 w-5" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {flagStatusTitle}
                                  </p>
                                  <p className="text-xs text-slate-600">
                                    {flagStatusDescription}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleToggleFlag}
                                className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 ${
                                  flagSelectionState.allFlagged
                                    ? 'border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300 hover:bg-rose-100'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600'
                                }`}
                              >
                                <Flag className="h-4 w-4" />
                                {flagActionLabel}
                              </button>
                              {flagSaveError && (
                                <p className="text-xs text-rose-600">
                                  {flagSaveError}
                                </p>
                              )}
                              <p className="text-xs text-slate-500">
                                Flags sync with the "Show flagged only" filter so you can review
                                critical lines quickly.
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        !hasCheckedRows && (
                          <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                            <Ghost className="mx-auto h-10 w-10 text-slate-400" />
                            <p className="mt-3 text-base font-semibold text-slate-900">
                              Select a line to annotate.
                            </p>
                            <p className="text-sm text-slate-500">
                              Choose a transcript row to unlock quick-note tools.
                            </p>
                          </div>
                        )
                      )}
                    </div>
                    {hasMultipleCheckedRows && (
                      <div className="space-y-4 rounded-3xl border border-indigo-100 bg-white/80 p-6 shadow-sm shadow-slate-200/60">
                        <div>
                          <p className="text-base font-semibold text-slate-900">
                            Selected lines
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {visibleCheckedRows.map((row) => (
                            <span
                              key={row.id}
                              className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-slate-700"
                            >
                              Line {row.line}
                            </span>
                          ))}
                          {hiddenCheckedRowsCount > 0 && (
                            <span className="inline-flex items-center rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-semibold text-slate-500">
                              +{hiddenCheckedRowsCount} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </aside>
        </main>
        {activeInstructionImage && (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 px-4 py-8 backdrop-blur-sm"
            onClick={closeInstructionImage}
          >
            {(() => {
              const hasTitle = Boolean(activeInstructionImage.title)
              const fallbackLabel = 'Instructional material image'
              return (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                hasTitle
                  ? `${activeInstructionImage.title} preview`
                  : 'Instruction image preview'
              }
              className="relative w-full max-w-3xl rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl shadow-slate-900/30"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-500">
                    Instruction image
                  </p>
                  {hasTitle && (
                    <p className="text-lg font-semibold text-slate-900">
                      {activeInstructionImage.title}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeInstructionImage}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                  aria-label="Close image preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 max-h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                <Image
                  src={activeInstructionImage.src}
                  alt={hasTitle ? activeInstructionImage.title : fallbackLabel}
                  width={960}
                  height={540}
                  className="mx-auto h-full max-h-[64vh] w-full object-contain"
                  sizes="(min-width: 1024px) 768px, 100vw"
                />
              </div>
            </div>
              )
            })()}
          </div>
        )}
        {deleteNoteId && (
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/60 px-4 py-8 backdrop-blur-sm"
            onClick={closeDeleteNoteModal}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Delete note confirmation"
              className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl shadow-slate-900/30"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-500">
                    Confirm delete
                  </p>
                  <p className="text-lg font-semibold text-slate-900">
                    Delete "{deleteNoteLabel}"?
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDeleteNoteModal}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
                  aria-label="Close delete confirmation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                This removes the note and clears its assignments from all lines.
              </p>
              {deleteNoteId && noteSaveErrors[deleteNoteId] && (
                <p className="mt-3 text-sm text-rose-600">
                  {noteSaveErrors[deleteNoteId]}
                </p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={closeDeleteNoteModal}
                  disabled={isDeletingNote}
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => deleteNoteId && handleDeleteNote(deleteNoteId)}
                  disabled={isDeletingNote}
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeletingNote ? 'Deleting...' : 'Delete note'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
