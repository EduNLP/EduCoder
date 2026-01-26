'use client'

import { useEffect, useState } from 'react'
import { UserPlus, Edit, Trash2, FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import EditAnnotatorModal, { type Annotator } from '@/components/admin/EditAnnotatorModal'

type AnnotatorsResponse = {
  success: boolean
  annotators?: Array<{
    id: string
    name: string
    username: string
    password: string
    role: string
    assignedTranscripts?: Array<{
      id: string
      title: string
    }>
  }>
  currentUserId?: string
  error?: string
}

export default function AnnotatorsPage() {
  const router = useRouter()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: userLoaded, user } = useUser()
  const role = (user?.publicMetadata?.role as string | undefined) ?? null
  const [annotators, setAnnotators] = useState<Annotator[]>([])
  const [selectedAnnotator, setSelectedAnnotator] = useState<Annotator | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isLoadingAnnotators, setIsLoadingAnnotators] = useState(false)
  const [annotatorsError, setAnnotatorsError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingAnnotatorId, setDeletingAnnotatorId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoaded || !userLoaded) {
      return
    }

    if (!isSignedIn) {
      router.replace('/')
      return
    }

    if (role !== 'admin') {
      router.replace('/workspace')
    }
  }, [authLoaded, isSignedIn, role, router, userLoaded])

  useEffect(() => {
    if (!authLoaded || !userLoaded || !isSignedIn || role !== 'admin') {
      return
    }

    let isCancelled = false
    const controller = new AbortController()

    const fetchAnnotators = async () => {
      setIsLoadingAnnotators(true)
      setAnnotatorsError(null)

      try {
        const response = await fetch('/api/admin/annotators', {
          signal: controller.signal,
        })
        const payload: AnnotatorsResponse | null = await response.json().catch(() => null)

        if (!response.ok || !payload?.success || !payload.annotators) {
          const message = payload?.error ?? 'Failed to load annotators.'
          throw new Error(message)
        }

        if (!isCancelled) {
          setCurrentUserId(payload.currentUserId ?? null)
          const normalizedAnnotators: Annotator[] = payload.annotators.map((annotator) => ({
            id: annotator.id,
            name: annotator.name,
            username: annotator.username,
            password: annotator.password,
            role: annotator.role,
            assignedTranscripts: annotator.assignedTranscripts ?? [],
            enabled: true,
          }))

          setAnnotators(normalizedAnnotators)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load annotators', error)
        if (!isCancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load annotators. Please try again.'
          setAnnotatorsError(message)
          setAnnotators([])
          setCurrentUserId(null)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingAnnotators(false)
        }
      }
    }

    fetchAnnotators()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [authLoaded, isSignedIn, role, userLoaded])

  if (!authLoaded || !userLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12 text-gray-700">
        <p className="text-sm text-gray-500">Loading admin tools…</p>
      </div>
    )
  }

  if (!isSignedIn || role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12 text-gray-700">
        <p className="text-sm text-gray-500">Redirecting…</p>
      </div>
    )
  }

  const handleEditClick = (annotator: Annotator) => {
    setSelectedAnnotator(annotator)
    setIsEditModalOpen(true)
  }

  const handleCreateNew = () => {
    setSelectedAnnotator(null)
    setIsEditModalOpen(true)
  }

  const handleAnnotatorCreated = (newAnnotator: Annotator) => {
    setAnnotators((previous) => [...previous, newAnnotator])
  }

  const handleAnnotatorUpdated = (updatedAnnotator: Annotator) => {
    setAnnotators((previous) =>
      previous.map((annotator) => (annotator.id === updatedAnnotator.id ? updatedAnnotator : annotator)),
    )
  }

  const closeModal = () => {
    setIsEditModalOpen(false)
    setSelectedAnnotator(null)
  }

  const deleteAnnotator = async (id: Annotator['id']) => {
    if (deletingAnnotatorId) {
      return
    }

    const targetAnnotator = annotators.find((annotator) => annotator.id === id)
    if (targetAnnotator && targetAnnotator.assignedTranscripts.length > 0) {
      setDeleteError(
        'This annotator still has assigned annotations. Please delete their annotations first.',
      )
      return
    }

    try {
      setDeletingAnnotatorId(id)
      setDeleteError(null)

      const response = await fetch(
        `/api/admin/annotators?annotatorId=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        },
      )
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        const message =
          payload?.code === 'ANNOTATIONS_EXIST'
            ? 'This annotator still has assigned annotations. Please delete their annotations first.'
            : payload?.error ?? 'Failed to delete annotator.'
        throw new Error(message)
      }

      setAnnotators((previous) => previous.filter((annotator) => annotator.id !== id))
    } catch (error) {
      console.error('Failed to delete annotator', error)
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to delete annotator. Please try again.'
      setDeleteError(message)
    } finally {
      setDeletingAnnotatorId(null)
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Annotators</h1>
        <p className="text-gray-600 mt-2">Manage annotator accounts and transcript assignments</p>
      </div>

      {/* Top Actions Bar */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <button
          onClick={handleCreateNew}
          className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm font-medium"
        >
          <UserPlus className="w-5 h-5" />
          Add New Annotator
        </button>
      </div>

      {deleteError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </div>
      ) : null}

      {/* Annotators Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                  Name
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                  Username
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                  Role
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                  Assigned Transcripts
                </th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoadingAnnotators ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={5}>
                    Loading annotators…
                  </td>
                </tr>
              ) : annotatorsError ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-red-600" colSpan={5}>
                    {annotatorsError}
                  </td>
                </tr>
              ) : annotators.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={5}>
                    No annotators found.
                  </td>
                </tr>
              ) : (
                annotators.map((annotator) => {
                  const isCurrentUser = annotator.id === currentUserId
                  return (
                    <tr
                      key={annotator.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <span className="font-medium text-gray-900">
                          {annotator.name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-700">
                          {annotator.username}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                            annotator.role === 'admin'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {annotator.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {annotator.assignedTranscripts.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-900">
                              {annotator.assignedTranscripts.length} transcript{annotator.assignedTranscripts.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500 italic">
                            No assignments
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEditClick(annotator)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {isCurrentUser ? null : (
                            <button
                              onClick={() => void deleteAnnotator(annotator.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={deletingAnnotatorId === annotator.id}
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card View for Mobile */}
      <div className="lg:hidden space-y-4 mt-6">
        {isLoadingAnnotators ? (
          <p className="text-sm text-gray-500">Loading annotators…</p>
        ) : annotatorsError ? (
          <p className="text-sm text-red-600">{annotatorsError}</p>
        ) : annotators.length === 0 ? (
          <p className="text-sm text-gray-500">No annotators found.</p>
        ) : (
          annotators.map((annotator) => {
            const isCurrentUser = annotator.id === currentUserId
            return (
              <div
                key={annotator.id}
                className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
              >
                <div className="flex items-start mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {annotator.name}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      @{annotator.username}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium mt-2 ${
                        annotator.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {annotator.role}
                    </span>
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">Assigned Transcripts:</p>
                  {annotator.assignedTranscripts.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-900">
                        {annotator.assignedTranscripts.length} transcript{annotator.assignedTranscripts.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500 italic">
                      No assignments
                    </span>
                  )}
                </div>

                <div className="flex gap-2 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => handleEditClick(annotator)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    <span className="text-sm font-medium">Edit</span>
                  </button>
                  {isCurrentUser ? null : (
                    <button
                      onClick={() => void deleteAnnotator(annotator.id)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={deletingAnnotatorId === annotator.id}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="text-sm font-medium">Delete</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Edit Modal */}
      <EditAnnotatorModal
        isOpen={isEditModalOpen}
        onClose={closeModal}
        annotator={selectedAnnotator}
        onAnnotatorCreated={handleAnnotatorCreated}
        onAnnotatorUpdated={handleAnnotatorUpdated}
      />
    </div>
  )
}
