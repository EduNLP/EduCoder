'use client'

import { useEffect, useState } from 'react'
import { Search, Download, Filter, Trash2 } from 'lucide-react'

type AnnotationStatus = 'not_started' | 'in_progress' | 'completed'
type StatusFilter = 'All' | AnnotationStatus

type AnnotationApiRecord = {
  id: string
  status: AnnotationStatus
  gcs_path?: string | null
  hide?: boolean | null
  uploadedAt?: string | null
  lastUpdatedAt?: string | null
  noteCount?: number | null
  annotatedLineCount?: number | null
  transcript?: { id: string; title: string } | null
  annotator?: { id: string; name: string; username: string } | null
}

type AnnotationsResponse = {
  success: boolean
  annotations?: AnnotationApiRecord[]
  error?: string
}

type Annotation = {
  id: string
  status: AnnotationStatus
  gcsPath: string
  isHidden: boolean
  uploadedAt: string | null
  lastUpdatedAt: string | null
  transcriptTitle: string
  transcriptId: string | null
  annotatorName: string
  annotatorUsername: string | null
  annotatorId: string | null
  noteCount: number
  annotatedLineCount: number
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

const buildFallbackName = (annotation: Annotation) => {
  const transcriptSegment = annotation.transcriptTitle?.trim() || 'annotation'
  const annotatorSegment = annotation.annotatorName?.trim() || ''
  const combined = [transcriptSegment, annotatorSegment]
    .filter(Boolean)
    .join('-')
  const baseName = sanitizeFileName(`${combined}-annotations`, 'annotations')
  return baseName.toLowerCase().endsWith('.xlsx') ? baseName : `${baseName}.xlsx`
}

export default function AnnotationsPage() {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [annotatorFilter, setAnnotatorFilter] = useState<string>('All')
  const [notification, setNotification] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [downloadingAnnotations, setDownloadingAnnotations] = useState<Set<string>>(
    () => new Set(),
  )
  const [deletingAnnotations, setDeletingAnnotations] = useState<Set<string>>(
    () => new Set(),
  )
  const placeholderValue = '--'

  const isAnnotationStatus = (value: unknown): value is AnnotationStatus =>
    value === 'not_started' || value === 'in_progress' || value === 'completed'

  useEffect(() => {
    let isCancelled = false
    const controller = new AbortController()

    const fetchAnnotations = async () => {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const response = await fetch('/api/admin/annotations', {
          signal: controller.signal,
        })
        const payload: AnnotationsResponse | null = await response.json().catch(() => null)

        if (!response.ok || !payload?.success || !payload.annotations) {
          const message = payload?.error ?? 'Failed to load annotations.'
          throw new Error(message)
        }

        if (isCancelled) return

        const normalized: Annotation[] = payload.annotations.map((annotation) => {
          const status = isAnnotationStatus(annotation.status)
            ? annotation.status
            : 'not_started'

          const annotatorName =
            annotation.annotator?.name?.trim() ||
            annotation.annotator?.username?.trim() ||
            'Unassigned annotator'

          const annotatorUsername = annotation.annotator?.username?.trim() || null

          return {
            id: annotation.id,
            status,
            gcsPath: annotation.gcs_path ?? '',
            isHidden: annotation.hide ?? false,
            uploadedAt:
              typeof annotation.uploadedAt === 'string' && annotation.uploadedAt
                ? annotation.uploadedAt
                : null,
            lastUpdatedAt:
              typeof annotation.lastUpdatedAt === 'string' && annotation.lastUpdatedAt
                ? annotation.lastUpdatedAt
                : null,
            transcriptTitle:
              annotation.transcript?.title?.trim() || 'Untitled transcript',
            transcriptId: annotation.transcript?.id ?? null,
            annotatorName,
            annotatorUsername,
            annotatorId: annotation.annotator?.id ?? null,
            noteCount: typeof annotation.noteCount === 'number' ? annotation.noteCount : 0,
            annotatedLineCount:
              typeof annotation.annotatedLineCount === 'number'
                ? annotation.annotatedLineCount
                : 0,
          }
        })

        setAnnotations(normalized)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load annotations', error)
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load annotations.'
          setErrorMessage(message)
          setAnnotations([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchAnnotations()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [])

  const statusLabels: Record<AnnotationStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
  }

  const getStatusColor = (status: AnnotationStatus | 'unknown') => {
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

  const formatStatusLabel = (status: AnnotationStatus) =>
    statusLabels[status] ?? 'Unknown'

  const formatAssignedOn = (value: string | null) => {
    if (!value) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return null
    }
    return parsed.toLocaleString()
  }

  const formatVisibility = (isHidden: boolean) => (isHidden ? 'Hidden' : 'Visible')

  const handleDownload = async (annotation: Annotation) => {
    if (downloadingAnnotations.has(annotation.id)) {
      return
    }

    setDownloadingAnnotations((current) => {
      const updated = new Set(current)
      updated.add(annotation.id)
      return updated
    })

    try {
      const response = await fetch(
        `/api/admin/annotations/${annotation.id}/download?annotationId=${encodeURIComponent(annotation.id)}`,
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to download annotation file.'
        throw new Error(message)
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition')
      const suggestedName =
        parseFileNameFromContentDisposition(contentDisposition) ||
        buildFallbackName(annotation)

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
        `Downloading "${annotation.transcriptTitle}" for ${annotation.annotatorName}.`,
      )
    } catch (error) {
      console.error('Failed to download annotation file', error)
      const message =
        error instanceof Error ? error.message : 'Failed to download annotation file.'
      setNotification(message)
    } finally {
      setDownloadingAnnotations((current) => {
        const updated = new Set(current)
        updated.delete(annotation.id)
        return updated
      })
    }
  }

  const handleDelete = async (annotation: Annotation) => {
    if (deletingAnnotations.has(annotation.id)) {
      return
    }

    if (!annotation.isHidden) {
      setNotification('Only hidden annotations can be deleted.')
      return
    }

    const confirmDelete = window.confirm(
      `Delete the hidden annotation for "${annotation.transcriptTitle}" assigned to ${annotation.annotatorName}? This will also remove their notes, note assignments, and flag assignments for this transcript.`,
    )
    if (!confirmDelete) {
      return
    }

    setDeletingAnnotations((current) => {
      const updated = new Set(current)
      updated.add(annotation.id)
      return updated
    })
    setNotification(null)

    try {
      const response = await fetch(`/api/admin/annotations/${annotation.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotationId: annotation.id }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to delete annotation.'
        throw new Error(message)
      }

      setAnnotations((current) =>
        current.filter((item) => item.id !== annotation.id),
      )
      setNotification(
        `Deleted annotation for "${annotation.transcriptTitle}" assigned to ${annotation.annotatorName}.`,
      )
    } catch (error) {
      console.error('Failed to delete annotation', error)
      const message =
        error instanceof Error ? error.message : 'Failed to delete annotation.'
      setNotification(message)
    } finally {
      setDeletingAnnotations((current) => {
        const updated = new Set(current)
        updated.delete(annotation.id)
        return updated
      })
    }
  }

  // Get unique annotators for filter
  const uniqueAnnotators = Array.from(
    new Map(
      annotations.map((annotation) => [
        annotation.annotatorUsername ?? annotation.annotatorId ?? annotation.id,
        annotation.annotatorName,
      ]),
    ).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]))

  const normalizedSearch = searchQuery.trim().toLowerCase()

  const filteredAnnotations = annotations.filter((annotation) => {
    const matchesSearch =
      annotation.transcriptTitle.toLowerCase().includes(normalizedSearch) ||
      annotation.annotatorName.toLowerCase().includes(normalizedSearch) ||
      (annotation.annotatorUsername ?? '').toLowerCase().includes(normalizedSearch)
    const matchesStatus = statusFilter === 'All' || annotation.status === statusFilter
    const matchesAnnotator =
      annotatorFilter === 'All' ||
      annotation.annotatorUsername === annotatorFilter ||
      annotation.annotatorId === annotatorFilter
    return matchesSearch && matchesStatus && matchesAnnotator
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Annotations</h1>
        <p className="text-gray-600 mt-2">Track and manage all annotation progress</p>
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

      {/* Filters Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        </div>
        
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search Bar */}
          <div className="relative flex-1 lg:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by transcript or annotator..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Annotator Filter */}
          <select
            value={annotatorFilter}
            onChange={(e) => setAnnotatorFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
          >
            <option value="All">All Annotators</option>
            {uniqueAnnotators.map(([username, name]) => (
              <option key={username} value={username}>
                {name}
              </option>
            ))}
          </select>

          {/* Annotation Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
          >
            <option value="All">All Statuses</option>
            <option value="not_started">{statusLabels.not_started}</option>
            <option value="in_progress">{statusLabels.in_progress}</option>
            <option value="completed">{statusLabels.completed}</option>
          </select>
        </div>

        {/* Active Filters Display */}
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
                Annotator: {uniqueAnnotators.find(([username]) => username === annotatorFilter)?.[1] || annotatorFilter}
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
          Loading annotations...
        </div>
      )}

      {/* Results Count */}
      <div className="mb-4">
        <p className="text-sm text-gray-600">
          Showing <span className="font-semibold text-gray-900">{filteredAnnotations.length}</span> of{' '}
          <span className="font-semibold text-gray-900">{annotations.length}</span> annotations
        </p>
      </div>

      {/* Annotations Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Transcript
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Annotator
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Annotation Status
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
                  Notes
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Annotated Lines
                </th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredAnnotations.map((annotation) => {
                const isDownloading = downloadingAnnotations.has(annotation.id)
                const downloadDisabled = !annotation.transcriptId
                const isDeleting = deletingAnnotations.has(annotation.id)
                return (
                  <tr
                    key={annotation.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-900">
                        {annotation.transcriptTitle}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-gray-900">
                        {annotation.annotatorName}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                          annotation.status
                        )}`}
                      >
                        {formatStatusLabel(annotation.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatAssignedOn(annotation.uploadedAt) ?? placeholderValue}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatVisibility(annotation.isHidden)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatAssignedOn(annotation.lastUpdatedAt) ?? placeholderValue}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {annotation.noteCount}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {annotation.annotatedLineCount}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          aria-label="Download"
                          onClick={() => handleDownload(annotation)}
                          disabled={downloadDisabled || isDownloading}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                            downloadDisabled
                              ? 'text-gray-300 cursor-not-allowed'
                              : isDownloading
                                ? 'text-blue-400 cursor-wait'
                                : 'text-blue-700 hover:text-blue-800'
                          }`}
                          title={
                            downloadDisabled
                              ? 'No file'
                              : isDownloading
                                ? 'Downloading...'
                                : 'Download annotation file'
                          }
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          aria-label="Delete"
                          title="Delete"
                          type="button"
                          onClick={() => void handleDelete(annotation)}
                          disabled={isDeleting}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                            isDeleting
                              ? 'text-red-300 cursor-wait'
                              : 'text-red-600 hover:text-red-700'
                          }`}
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Empty State */}
      {!isLoading && !errorMessage && filteredAnnotations.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm mt-6">
          <Filter className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No annotations found
          </h3>
          <p className="text-gray-600">
            {searchQuery || statusFilter !== 'All' || annotatorFilter !== 'All'
              ? 'Try adjusting your filters or search query'
              : 'No annotations available at this time'}
          </p>
        </div>
      )}

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-4 mt-6">
        {filteredAnnotations.map((annotation) => {
          const isDownloading = downloadingAnnotations.has(annotation.id)
          const downloadDisabled = !annotation.transcriptId
          const isDeleting = deletingAnnotations.has(annotation.id)
          return (
            <div
              key={annotation.id}
              className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
            >
              {/* Header */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-semibold text-gray-900">
                    {annotation.transcriptTitle}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Annotation Status</p>
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                        annotation.status
                      )}`}
                    >
                      {formatStatusLabel(annotation.status)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Annotator */}
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">Annotator:</p>
                <span className="text-gray-900">{annotation.annotatorName}</span>
              </div>

              {/* Details */}
              <div className="mb-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Assigned On</p>
                  <p className="text-sm text-gray-900">
                    {formatAssignedOn(annotation.uploadedAt) ?? placeholderValue}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Visibility</p>
                  <p className="text-sm text-gray-900">
                    {formatVisibility(annotation.isHidden)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Last Updated</p>
                  <p className="text-sm text-gray-900">
                    {formatAssignedOn(annotation.lastUpdatedAt) ?? placeholderValue}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Notes</p>
                  <p className="text-sm text-gray-900">{annotation.noteCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Annotated Lines</p>
                  <p className="text-sm text-gray-900">
                    {annotation.annotatedLineCount}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-gray-200 space-y-2">
                <button
                  onClick={() => handleDownload(annotation)}
                  disabled={downloadDisabled || isDownloading}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    downloadDisabled
                      ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                      : isDownloading
                        ? 'bg-blue-50 text-blue-500 cursor-wait'
                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  <Download className="w-4 h-4" />
                  <span className="text-sm font-medium">Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(annotation)}
                  disabled={isDeleting}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    isDeleting
                      ? 'bg-red-50 text-red-300 cursor-wait'
                      : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Delete</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
