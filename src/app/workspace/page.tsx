'use client'

import {
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Eye,
  EyeOff,
  ListFilter,
  LogOut,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useTheme } from '@/context/ThemeContext'
import { useAuth, useUser } from '@clerk/nextjs'

type AnnotationStatus = 'not_started' | 'in_progress' | 'completed'

type WorkspaceTranscript = {
  annotationId: string
  transcriptId: string
  title: string
  grade: string | null
  instructionContext: string
  videoUploaded: boolean
  status: AnnotationStatus
  flaggedLines: number
  lastUpdated: string | null
}

type TranscriptsResponse = {
  success: boolean
  transcripts?: WorkspaceTranscript[]
  error?: string
}

type ImportDemoResponse = {
  success?: boolean
  imported?: boolean
  transcriptId?: string
  error?: string
}

const PREFERRED_TILE_HEIGHT = 320
const WORKSPACE_ONBOARDING_DISMISSED_KEY = 'educoder.workspace.onboarding.dismissed'
const WORKSPACE_ONBOARDING_TOTAL_STEPS = 10
const WORKSPACE_ONBOARDING_STEPS = [
  'This is the page where all your transcripts live. You can select any card to annotate it.',
] as const

const statusFilters = [
  { id: 'all', label: 'All' },
  { id: 'not_started', label: 'Not Started' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'completed', label: 'Completed' },
] as const

const statusStyles: Record<
  AnnotationStatus,
  { label: string; classes: string }
> = {
  not_started: {
    label: 'Not Started',
    classes: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  },
  in_progress: {
    label: 'In Progress',
    classes: 'border-amber-200 bg-amber-50 text-amber-600',
  },
  completed: {
    label: 'Completed',
    classes: 'border-indigo-200 bg-indigo-50 text-indigo-600',
  },
}

const formatRelativeTime = (value: string | null) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const now = Date.now()
  const diffSeconds = Math.max(0, Math.round((now - parsed.getTime()) / 1000))
  if (diffSeconds < 60) return 'just now'
  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) {
    return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  }

  return parsed.toLocaleDateString()
}

export default function DashboardPage() {
  const router = useRouter()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: userLoaded } = useUser()
  const { theme } = useTheme()
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] =
    useState<(typeof statusFilters)[number]['id']>('all')
  const [tileMinHeight, setTileMinHeight] = useState(PREFERRED_TILE_HEIGHT)
  const [transcripts, setTranscripts] = useState<WorkspaceTranscript[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  const filteredTiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return transcripts.filter((tile) => {
      const matchesStatus = statusFilter === 'all' || tile.status === statusFilter
      const matchesQuery =
        !query ||
        tile.title.toLowerCase().includes(query) ||
        tile.instructionContext.toLowerCase().includes(query)
      return matchesStatus && matchesQuery
    })
  }, [searchQuery, statusFilter, transcripts])

  const showImportDemoButton = !isLoading && transcripts.length === 0
  const [isImportingDemo, setIsImportingDemo] = useState(false)
  const [importDemoError, setImportDemoError] = useState<string | null>(null)
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)
  const [onboardingStage, setOnboardingStage] = useState<'prompt' | 'tour'>(
    'prompt',
  )
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0)

  const pageBackgroundStyle = useMemo(
    () => ({
      backgroundColor: theme.backgroundColor,
      backgroundImage: theme.backgroundImage ?? 'none',
    }),
    [theme],
  )

  const workspaceMenuLinks = useMemo(
    () => [
      {
        id: 'toggle-toolbar',
        label: toolbarVisible ? 'Hide search & filters' : 'Show search & filters',
        icon: toolbarVisible ? EyeOff : Eye,
      },
      { id: 'logout', label: 'Log Out', icon: LogOut },
    ],
    [toolbarVisible],
  )

  const updateTileHeight = useCallback(() => {
    const gridElement = gridRef.current
    if (!gridElement) return

    const { top } = gridElement.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const styles = getComputedStyle(gridElement)
    const rowGap = parseFloat(styles.rowGap || '0')
    const safetyPadding = 24
    const availableHeight = viewportHeight - top - safetyPadding
    const desiredHeight = Math.round((availableHeight - rowGap) / 2)
    const cappedHeight = Math.min(desiredHeight, PREFERRED_TILE_HEIGHT)

    setTileMinHeight(cappedHeight > 0 ? cappedHeight : PREFERRED_TILE_HEIGHT)
  }, [])

  useEffect(() => {
    updateTileHeight()
    window.addEventListener('resize', updateTileHeight)

    return () => {
      window.removeEventListener('resize', updateTileHeight)
    }
  }, [updateTileHeight])

  useEffect(() => {
    if (!authLoaded || !userLoaded) {
      return
    }

    if (!isSignedIn) {
      router.replace('/')
      return
    }

  }, [authLoaded, isSignedIn, router, userLoaded])

  const fetchTranscripts = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/annotator/transcripts', {
        signal,
      })
      const payload: TranscriptsResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || !payload?.success || !payload.transcripts) {
        const message = payload?.error ?? 'Failed to load assigned transcripts.'
        throw new Error(message)
      }

      setTranscripts(payload.transcripts)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      console.error('Failed to load assigned transcripts', error)
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load assigned transcripts.'
      setErrorMessage(message)
      setTranscripts([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchTranscripts(controller.signal)

    return () => {
      controller.abort()
    }
  }, [fetchTranscripts])

  useEffect(() => {
    try {
      const isDismissed =
        window.localStorage.getItem(WORKSPACE_ONBOARDING_DISMISSED_KEY) === 'true'
      if (!isDismissed) {
        setIsOnboardingOpen(true)
      }
    } catch {
      setIsOnboardingOpen(true)
    }
  }, [])

  if (!authLoaded || !userLoaded) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-3 py-6 text-slate-900 sm:px-4 lg:px-6"
        style={pageBackgroundStyle}
      >
        <p className="text-sm text-slate-500">Loading workspace…</p>
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-3 py-6 text-slate-900 sm:px-4 lg:px-6"
        style={pageBackgroundStyle}
      >
        <p className="text-sm text-slate-500">Redirecting…</p>
      </div>
    )
  }

  const handleToggleToolbar = () => {
    setToolbarVisible((previous) => !previous)
  }

  const navigateToAnnotate = (
    transcriptId: string,
    options?: { showLessonGoalsOnboarding?: boolean },
  ) => {
    const search = new URLSearchParams({ transcript: transcriptId })
    if (options?.showLessonGoalsOnboarding) {
      search.set('onboarding', 'lesson-goals')
    }
    router.push(`/annotate?${search.toString()}`)
  }

  const handleTileClick = (tile: WorkspaceTranscript) => {
    navigateToAnnotate(tile.transcriptId)
  }

  const handleMenuLinkAction = (link: { id: string }) => {
    if (link.id === 'toggle-toolbar') {
      handleToggleToolbar()
    }
  }

  const handleImportDemo = async () => {
    setImportDemoError(null)
    setErrorMessage(null)
    setIsImportingDemo(true)

    try {
      const response = await fetch('/api/admin/transcripts/import-demo', {
        method: 'POST',
      })

      const payload: ImportDemoResponse | null = await response
        .json()
        .catch(() => null)

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error ?? 'Failed to import demo files.')
      }

      await fetchTranscripts()
    } catch (error) {
      console.error('Failed to import demo files', error)
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to import demo files right now.'
      setImportDemoError(message)
    } finally {
      setIsImportingDemo(false)
    }
  }

  const handleCloseOnboarding = (persistDismissal: boolean) => {
    setIsOnboardingOpen(false)
    setOnboardingStage('prompt')
    setOnboardingStepIndex(0)
    if (!persistDismissal) {
      return
    }

    try {
      window.localStorage.setItem(WORKSPACE_ONBOARDING_DISMISSED_KEY, 'true')
    } catch {
      // Ignore storage failures and continue with local state only.
    }
  }

  const handleOpenOnboarding = () => {
    setIsOnboardingOpen(true)
    setOnboardingStage('prompt')
    setOnboardingStepIndex(0)
  }

  const handleStartOnboardingTour = () => {
    setOnboardingStage('tour')
    setOnboardingStepIndex(0)
  }

  const handleNextOnboardingStep = () => {
    const nextStepIndex = onboardingStepIndex + 1
    if (nextStepIndex >= WORKSPACE_ONBOARDING_STEPS.length) {
      handleCloseOnboarding(true)
      const firstVisibleTile = filteredTiles[0]
      if (firstVisibleTile) {
        navigateToAnnotate(firstVisibleTile.transcriptId, {
          showLessonGoalsOnboarding: true,
        })
      }
      return
    }

    setOnboardingStepIndex(nextStepIndex)
  }

  return (
    <div
      className="flex min-h-screen flex-col px-3 py-6 text-slate-900 sm:px-4 lg:px-6"
      style={pageBackgroundStyle}
    >
      <div className="mx-auto flex w-full max-w-none flex-1 flex-col gap-5">
        <WorkspaceHeader
          toolbarVisible={toolbarVisible}
          onToggleToolbar={handleToggleToolbar}
          showWorkspaceButton={false}
          leftLabel="workspace"
          showToolbarToggleButton={false}
          showCommandCenterCloseButton={false}
          showCommandCenterHeading={false}
          menuLinks={workspaceMenuLinks}
          onMenuLinkClick={handleMenuLinkAction}
        />

        {toolbarVisible && (
          <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  placeholder="Search transcripts, facilitators, or notes"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white/70 py-3 pl-12 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setStatusFilter(filter.id)}
                    className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${
                      statusFilter === filter.id
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'
                    }`}
                    aria-pressed={statusFilter === filter.id}
                  >
                    {filter.id === 'all' && <ListFilter className="h-4 w-4" />}
                    {filter.id === 'not_started' && (
                      <CalendarDays className="h-4 w-4" />
                    )}
                    {filter.id === 'in_progress' && <Clock3 className="h-4 w-4" />}
                    {filter.id === 'completed' && (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="flex flex-1 flex-col rounded-3xl px-4 py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500">
                Transcript library
              </p>
              <p className="text-xl font-semibold text-slate-900">
                Select a transcript to annotate
              </p>
            </div>
            <p className="text-sm text-slate-500">
              {isLoading
                ? 'Loading assigned transcripts…'
                : `${filteredTiles.length} of ${transcripts.length} visible`}
            </p>
          </div>

          {errorMessage && (
            <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {errorMessage}
            </p>
          )}

          <div
            ref={gridRef}
            className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))]"
          >
            {filteredTiles.map((tile) => {
              const lastUpdatedLabel = formatRelativeTime(tile.lastUpdated)
              return (
                <button
                  key={tile.transcriptId}
                  type="button"
                  onClick={() => handleTileClick(tile)}
                  className="flex flex-col rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/60 p-5 text-left shadow-lg shadow-slate-200/80 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                  style={{ minHeight: tileMinHeight }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-widest text-indigo-500">
                      {tile.grade ? `Grade: ${tile.grade}` : 'Grade: Unspecified'}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[tile.status].classes}`}
                    >
                      {statusStyles[tile.status].label}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-900">
                    {tile.title}
                  </h3>
                  <p className="mt-1 line-clamp-5 text-sm leading-relaxed text-slate-600">
                    {tile.instructionContext || 'No instructional context has been provided yet.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                    {tile.flaggedLines > 0 && (
                      <span className="rounded-2xl bg-white/90 px-3 py-1 font-medium text-rose-600 shadow-inner shadow-rose-100/80">
                        {tile.flaggedLines} flag{tile.flaggedLines === 1 ? '' : 's'}
                      </span>
                    )}
                    {lastUpdatedLabel && (
                      <span className="rounded-2xl bg-white/90 px-3 py-1 text-slate-500">
                        Updated {lastUpdatedLabel}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
            {!isLoading && filteredTiles.length === 0 && (
              <div className="col-span-full flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                <p className="text-base font-semibold text-slate-900">
                  {transcripts.length === 0
                    ? 'No transcripts are assigned to you yet.'
                    : 'No transcripts match your filters.'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {transcripts.length === 0
                    ? 'Import demo files to quickly explore the workspace.'
                    : 'Try clearing the search or switching status filters.'}
                </p>
                {importDemoError && (
                  <p className="mt-4 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {importDemoError}
                  </p>
                )}
                {showImportDemoButton && (
                  <button
                    type="button"
                    onClick={handleImportDemo}
                    disabled={isImportingDemo}
                    className="mt-6 inline-flex items-center justify-center rounded-2xl border border-indigo-300 bg-indigo-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  >
                    {isImportingDemo ? 'Importing demo files…' : 'Import demo files'}
                  </button>
                )}
                {isImportingDemo && (
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-indigo-500">
                    This may take up to a minute.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-end gap-2 sm:bottom-4 sm:right-4">
        {isOnboardingOpen && (
          <section className="pointer-events-auto w-[min(340px,calc(100vw-2rem))] max-w-[340px] overflow-hidden rounded-2xl border border-sky-400/80 bg-sky-600 text-white shadow-[0_20px_42px_-24px_rgba(3,105,161,0.8)]">
            <div className="space-y-3 p-4">
              <div
                className={`flex items-start gap-3 ${
                  onboardingStage === 'prompt' || onboardingStepIndex === 0
                    ? 'justify-between'
                    : 'justify-end'
                }`}
              >
                {onboardingStage === 'prompt' && (
                  <p className="text-base font-semibold leading-tight text-white">
                    Need a quick tour of the workspace?
                  </p>
                )}
                {onboardingStage === 'tour' && onboardingStepIndex === 0 && (
                  <p className="text-base font-semibold leading-tight text-white">
                    Welcome to EduCoder
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => handleCloseOnboarding(true)}
                  className="mt-0.5 shrink-0 rounded-lg p-1.5 text-white/90 transition hover:bg-sky-500/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Close onboarding message"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {onboardingStage === 'prompt' ? (
                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCloseOnboarding(true)}
                    className="rounded-lg px-3 py-1.5 text-sm text-sky-50 transition hover:bg-sky-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    No thanks
                  </button>
                  <button
                    type="button"
                    onClick={handleStartOnboardingTour}
                    className="inline-flex min-w-[4.5rem] items-center justify-center rounded-lg border border-sky-300/80 bg-sky-500/35 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    Let&apos;s go
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-sky-50">
                    {WORKSPACE_ONBOARDING_STEPS[onboardingStepIndex]}
                  </p>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-sm font-medium text-sky-100">
                      {`${onboardingStepIndex + 1} of ${WORKSPACE_ONBOARDING_TOTAL_STEPS}`}
                    </p>
                    <button
                      type="button"
                      onClick={handleNextOnboardingStep}
                      className="inline-flex min-w-[4.5rem] items-center justify-center rounded-lg border border-sky-300/80 bg-sky-500/35 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
        <button
          type="button"
          onClick={handleOpenOnboarding}
          className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg shadow-slate-300/70 transition hover:-translate-y-0.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          aria-label="Open workspace onboarding message"
        >
          <CircleHelp className="h-6 w-6" />
        </button>
      </div>
    </div>
  )
}
