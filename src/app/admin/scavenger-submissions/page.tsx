'use client'

import { useEffect, useState } from 'react'
import { Search, Filter, Download } from 'lucide-react'

type SubmissionStatus = 'not_started' | 'in_progress' | 'completed'
type StatusFilter = 'All' | SubmissionStatus
type ScavengerVisibilityAdmin = 'hidden' | 'visible_after_completion' | 'always_visible'

type ScavengerSubmissionApiRecord = {
  id: string
  status: SubmissionStatus
  assignedAt?: string | null
  completedAt?: string | null
  lastUpdatedAt?: string | null
  scavenger_visibility_admin?: ScavengerVisibilityAdmin | null
  scavenger_visibility_user?: boolean | null
  questionCount?: number | null
  answeredQuestionCount?: number | null
  linkedLineCount?: number | null
  transcript?: { id: string; title: string } | null
  annotator?: { id: string; name: string; username: string } | null
}

type ScavengerSubmissionsResponse = {
  success: boolean
  submissions?: ScavengerSubmissionApiRecord[]
  error?: string
}

type ScavengerSubmission = {
  id: string
  status: SubmissionStatus
  assignedAt: string | null
  lastUpdatedAt: string | null
  scavengerVisibilityAdmin: ScavengerVisibilityAdmin
  scavengerVisibilityUser: boolean
  questionCount: number
  answeredQuestionCount: number
  linkedLineCount: number
  transcriptTitle: string
  annotatorName: string
  annotatorUsername: string | null
  annotatorId: string | null
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

const sanitizeFileName = (value: string, fallback: string) => {
  const trimmed = value.trim().replace(/[/\\]/g, '-')
  const normalized = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  return normalized || fallback
}

const buildFallbackName = (submission: ScavengerSubmission) => {
  const transcriptSegment = submission.transcriptTitle?.trim() || 'scavenger-submission'
  const annotatorSegment = submission.annotatorName?.trim() || ''
  const combined = [transcriptSegment, annotatorSegment]
    .filter(Boolean)
    .join('-')
  const baseName = sanitizeFileName(
    `${combined}-scavenger-submission`,
    'scavenger-submission',
  )
  return baseName.toLowerCase().endsWith('.xlsx') ? baseName : `${baseName}.xlsx`
}

const isSubmissionStatus = (value: unknown): value is SubmissionStatus =>
  value === 'not_started' || value === 'in_progress' || value === 'completed'

const isScavengerVisibilityAdmin = (
  value: unknown,
): value is ScavengerVisibilityAdmin =>
  value === 'hidden' || value === 'visible_after_completion' || value === 'always_visible'

export default function ScavengerSubmissionsPage() {
  const [submissions, setSubmissions] = useState<ScavengerSubmission[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [annotatorFilter, setAnnotatorFilter] = useState<string>('All')
  const [notification, setNotification] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [downloadingSubmissions, setDownloadingSubmissions] = useState<Set<string>>(
    () => new Set(),
  )
  const placeholderValue = '--'

  useEffect(() => {
    let isCancelled = false
    const controller = new AbortController()

    const fetchSubmissions = async () => {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const response = await fetch('/api/admin/scavenger-submissions', {
          signal: controller.signal,
        })
        const payload: ScavengerSubmissionsResponse | null = await response
          .json()
          .catch(() => null)

        if (!response.ok || !payload?.success || !payload.submissions) {
          const message = payload?.error ?? 'Failed to load scavenger submissions.'
          throw new Error(message)
        }

        if (isCancelled) return

        const normalized: ScavengerSubmission[] = payload.submissions.map((submission) => ({
          id: submission.id,
          status: isSubmissionStatus(submission.status)
            ? submission.status
            : 'not_started',
          assignedAt:
            typeof submission.assignedAt === 'string' && submission.assignedAt
              ? submission.assignedAt
              : null,
          lastUpdatedAt:
            typeof submission.lastUpdatedAt === 'string' && submission.lastUpdatedAt
              ? submission.lastUpdatedAt
              : null,
          scavengerVisibilityAdmin: isScavengerVisibilityAdmin(
            submission.scavenger_visibility_admin,
          )
            ? submission.scavenger_visibility_admin
            : 'hidden',
          scavengerVisibilityUser: Boolean(submission.scavenger_visibility_user),
          questionCount:
            typeof submission.questionCount === 'number' ? submission.questionCount : 0,
          answeredQuestionCount:
            typeof submission.answeredQuestionCount === 'number'
              ? submission.answeredQuestionCount
              : 0,
          linkedLineCount:
            typeof submission.linkedLineCount === 'number'
              ? submission.linkedLineCount
              : 0,
          transcriptTitle:
            submission.transcript?.title?.trim() || 'Untitled transcript',
          annotatorName:
            submission.annotator?.name?.trim() ||
            submission.annotator?.username?.trim() ||
            'Unassigned annotator',
          annotatorUsername: submission.annotator?.username?.trim() || null,
          annotatorId: submission.annotator?.id ?? null,
        }))

        setSubmissions(normalized)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load scavenger submissions', error)
        if (!isCancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to load scavenger submissions.'
          setErrorMessage(message)
          setSubmissions([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchSubmissions()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [])

  const statusLabels: Record<SubmissionStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
  }

  const getStatusColor = (status: SubmissionStatus | 'unknown') => {
    switch (status) {
      case 'not_started':
        return 'bg-yellow-100 text-yellow-800'
      case 'in_progress':
        return 'bg-blue-100 text-blue-800'
      case 'completed':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatStatusLabel = (status: SubmissionStatus) =>
    statusLabels[status] ?? 'Unknown'

  const formatDate = (value: string | null) => {
    if (!value) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return null
    }
    return parsed.toLocaleString()
  }

  const formatVisibility = (value: ScavengerVisibilityAdmin) => {
    switch (value) {
      case 'hidden':
        return 'Hidden'
      case 'visible_after_completion':
        return 'Visible After Completion'
      case 'always_visible':
        return 'Always Visible'
      default:
        return 'Hidden'
    }
  }

  const formatQuestionProgress = (submission: ScavengerSubmission) =>
    `${submission.answeredQuestionCount} / ${submission.questionCount}`

  const handleDownload = async (submission: ScavengerSubmission) => {
    if (downloadingSubmissions.has(submission.id)) {
      return
    }

    setDownloadingSubmissions((current) => {
      const updated = new Set(current)
      updated.add(submission.id)
      return updated
    })

    try {
      const response = await fetch(
        `/api/admin/scavenger-submissions/${submission.id}/download?assignmentId=${encodeURIComponent(
          submission.id,
        )}`,
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to download scavenger submission.'
        throw new Error(message)
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition')
      const suggestedName =
        parseFileNameFromContentDisposition(contentDisposition) ||
        buildFallbackName(submission)

      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = suggestedName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)

      setNotification(
        `Downloading "${submission.transcriptTitle}" for ${submission.annotatorName}.`,
      )
    } catch (error) {
      console.error('Failed to download scavenger submission', error)
      const message =
        error instanceof Error ? error.message : 'Failed to download scavenger submission.'
      setNotification(message)
    } finally {
      setDownloadingSubmissions((current) => {
        const updated = new Set(current)
        updated.delete(submission.id)
        return updated
      })
    }
  }

  const uniqueAnnotators = Array.from(
    new Map(
      submissions.map((submission) => [
        submission.annotatorUsername ?? submission.annotatorId ?? submission.id,
        submission.annotatorName,
      ]),
    ).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]))

  const normalizedSearch = searchQuery.trim().toLowerCase()

  const filteredSubmissions = submissions.filter((submission) => {
    const matchesSearch =
      submission.transcriptTitle.toLowerCase().includes(normalizedSearch) ||
      submission.annotatorName.toLowerCase().includes(normalizedSearch) ||
      (submission.annotatorUsername ?? '').toLowerCase().includes(normalizedSearch)
    const matchesStatus = statusFilter === 'All' || submission.status === statusFilter
    const matchesAnnotator =
      annotatorFilter === 'All' ||
      submission.annotatorUsername === annotatorFilter ||
      submission.annotatorId === annotatorFilter
    return matchesSearch && matchesStatus && matchesAnnotator
  })

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Scavenger Submissions</h1>
        <p className="text-gray-600 mt-2">Track and manage scavenger hunt response progress</p>
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
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1 lg:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by transcript or annotator..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <select
            value={annotatorFilter}
            onChange={(event) => setAnnotatorFilter(event.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
          >
            <option value="All">All Annotators</option>
            {uniqueAnnotators.map(([username, name]) => (
              <option key={username} value={username}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
          >
            <option value="All">All Statuses</option>
            <option value="not_started">{statusLabels.not_started}</option>
            <option value="in_progress">{statusLabels.in_progress}</option>
            <option value="completed">{statusLabels.completed}</option>
          </select>
        </div>

        {(statusFilter !== 'All' || annotatorFilter !== 'All' || searchQuery) && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-200 flex-wrap">
            <span className="text-sm text-gray-600">Active filters:</span>
            {statusFilter !== 'All' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                Status: {formatStatusLabel(statusFilter)}
                <button
                  onClick={() => setStatusFilter('All')}
                  className="hover:text-blue-900 ml-1"
                >
                  ×
                </button>
              </span>
            )}
            {annotatorFilter !== 'All' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm">
                Annotator:{' '}
                {uniqueAnnotators.find(([username]) => username === annotatorFilter)?.[1] ||
                  annotatorFilter}
                <button
                  onClick={() => setAnnotatorFilter('All')}
                  className="hover:text-indigo-900 ml-1"
                >
                  ×
                </button>
              </span>
            )}
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                Search: "{searchQuery}"
                <button
                  onClick={() => setSearchQuery('')}
                  className="hover:text-green-900 ml-1"
                >
                  ×
                </button>
              </span>
            )}
            <button
              onClick={() => {
                setStatusFilter('All')
                setAnnotatorFilter('All')
                setSearchQuery('')
              }}
              className="text-sm text-gray-600 hover:text-gray-900 underline ml-2"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {errorMessage}
        </div>
      )}

      {isLoading && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-700">
          Loading scavenger submissions...
        </div>
      )}

      <div className="mb-4">
        <p className="text-sm text-gray-600">
          Showing <span className="font-semibold text-gray-900">{filteredSubmissions.length}</span>{' '}
          of <span className="font-semibold text-gray-900">{submissions.length}</span>{' '}
          submissions
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Transcript
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Assigned To
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Scavenger Status
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Assigned On
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Visibility
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Last Updated
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Questions Answered
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Supporting Lines
                </th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredSubmissions.map((submission) => {
                const isDownloading = downloadingSubmissions.has(submission.id)

                return (
                  <tr
                    key={submission.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-900">
                        {submission.transcriptTitle}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-gray-900">{submission.annotatorName}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                          submission.status,
                        )}`}
                      >
                        {formatStatusLabel(submission.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(submission.assignedAt) ?? placeholderValue}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatVisibility(submission.scavengerVisibilityAdmin)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(submission.lastUpdatedAt) ?? placeholderValue}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatQuestionProgress(submission)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {submission.linkedLineCount}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end">
                        <button
                          aria-label="Download"
                          type="button"
                          onClick={() => void handleDownload(submission)}
                          disabled={isDownloading}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-medium text-blue-700 transition-colors hover:text-blue-800 ${
                            isDownloading ? 'cursor-not-allowed opacity-70' : ''
                          }`}
                          title={isDownloading ? 'Downloading...' : 'Download activity'}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && !errorMessage && filteredSubmissions.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm mt-6">
          <Filter className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No scavenger submissions found
          </h3>
          <p className="text-gray-600">
            {searchQuery || statusFilter !== 'All' || annotatorFilter !== 'All'
              ? 'Try adjusting your filters or search query'
              : 'No scavenger submissions available at this time'}
          </p>
        </div>
      )}

      <div className="lg:hidden space-y-4 mt-6">
        {filteredSubmissions.map((submission) => {
          const isDownloading = downloadingSubmissions.has(submission.id)

          return (
            <div
              key={submission.id}
              className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
            >
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-semibold text-gray-900">
                    {submission.transcriptTitle}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Submission Status</p>
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                        submission.status,
                      )}`}
                    >
                      {formatStatusLabel(submission.status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">Annotator:</p>
                <span className="text-gray-900">{submission.annotatorName}</span>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Assigned On</p>
                  <p className="text-sm text-gray-900">
                    {formatDate(submission.assignedAt) ?? placeholderValue}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Visibility</p>
                  <p className="text-sm text-gray-900">
                    {formatVisibility(submission.scavengerVisibilityAdmin)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Last Updated</p>
                  <p className="text-sm text-gray-900">
                    {formatDate(submission.lastUpdatedAt) ?? placeholderValue}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Questions Answered</p>
                  <p className="text-sm text-gray-900">
                    {formatQuestionProgress(submission)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Linked Lines</p>
                  <p className="text-sm text-gray-900">{submission.linkedLineCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Annotator Override</p>
                  <p className="text-sm text-gray-900">
                    {submission.scavengerVisibilityUser ? 'On' : 'Off'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleDownload(submission)}
                disabled={isDownloading}
                className={`inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:border-blue-300 hover:text-blue-800 ${
                  isDownloading ? 'cursor-not-allowed opacity-70' : ''
                }`}
              >
                <Download className="w-4 h-4" />
                {isDownloading ? 'Downloading...' : 'Download'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
