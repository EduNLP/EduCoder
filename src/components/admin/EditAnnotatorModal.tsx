'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { X, Eye, EyeOff } from 'lucide-react'

interface AssignedTranscript {
  id: string
  title: string
}

export interface Annotator {
  id: string
  name: string
  username: string
  password: string
  role: string
  assignedTranscripts: AssignedTranscript[]
  enabled: boolean
}

interface TranscriptOption {
  id: string
  title: string
}

type TranscriptsResponse = {
  success: boolean
  transcripts?: TranscriptOption[]
  error?: string
}

interface EditAnnotatorModalProps {
  isOpen: boolean
  onClose: () => void
  annotator: Annotator | null
  onAnnotatorCreated?: (annotator: Annotator) => void
  onAnnotatorUpdated?: (annotator: Annotator) => void
}

export default function EditAnnotatorModal({
  isOpen,
  onClose,
  annotator,
  onAnnotatorCreated,
  onAnnotatorUpdated,
}: EditAnnotatorModalProps) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState('annotator')
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [availableTranscripts, setAvailableTranscripts] = useState<TranscriptOption[]>([])
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false)
  const [transcriptsError, setTranscriptsError] = useState<string | null>(null)

  const resetFormState = useCallback(() => {
    setName('')
    setUsername('')
    setPassword('')
    setRole('annotator')
    setSelectedTranscriptIds([])
    setShowPassword(false)
    setErrorMessage(null)
    setIsSubmitting(false)
  }, [])

  // Populate form when annotator changes
  useEffect(() => {
    if (annotator) {
      setName(annotator.name)
      setUsername(annotator.username)
      setPassword(annotator.password ?? '')
      setRole(annotator.role)
      setSelectedTranscriptIds(
        annotator.assignedTranscripts.map((assignment) => assignment.id),
      )
      setShowPassword(false)
      setErrorMessage(null)
      setIsSubmitting(false)
    } else if (isOpen) {
      // Reset for new annotator each time the modal opens
      resetFormState()
    }
  }, [annotator, isOpen, resetFormState])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    let isCancelled = false
    const controller = new AbortController()

    const fetchTranscripts = async () => {
      setIsLoadingTranscripts(true)
      setTranscriptsError(null)

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
          setAvailableTranscripts(payload.transcripts ?? [])
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load transcripts', error)
        if (!isCancelled) {
          const message =
            error instanceof Error ? error.message : 'Failed to load transcripts. Please try again.'
          setTranscriptsError(message)
          setAvailableTranscripts([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingTranscripts(false)
        }
      }
    }

    fetchTranscripts()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [isOpen])

  const isEditing = annotator !== null

  if (!isOpen) return null

  const isAdminRole = role === 'admin'
  const handleTranscriptToggle = (transcriptId: string) => {
    if (isAdminRole) {
      return
    }

    setSelectedTranscriptIds((prev) =>
      prev.includes(transcriptId)
        ? prev.filter((id) => id !== transcriptId)
        : [...prev, transcriptId]
    )
  }

  const handleRoleChange = (value: string) => {
    setRole(value)

    if (value === 'admin') {
      setSelectedTranscriptIds([])
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isSubmitting) {
      return
    }

    if (annotator) {
      if (isAdminRole) {
        setErrorMessage('Admins cannot be assigned specific transcripts.')
        return
      }

      try {
        setIsSubmitting(true)
        setErrorMessage(null)

        const response = await fetch('/api/admin/annotators', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotatorId: annotator.id,
            transcriptIds: selectedTranscriptIds,
          }),
        })

        const payload = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          const message = payload?.error ?? 'Failed to update annotator.'
          throw new Error(message)
        }

        const updatedAnnotator: Annotator = {
          ...annotator,
          assignedTranscripts:
            selectedTranscriptIds.length === 0
              ? []
              : selectedTranscriptIds.map((id) => {
                  const matched =
                    availableTranscripts.find((transcript) => transcript.id === id) ??
                    annotator.assignedTranscripts.find((assignment) => assignment.id === id)
                  return {
                    id,
                    title: matched?.title ?? 'Untitled transcript',
                  }
                }),
        }

        onAnnotatorUpdated?.(updatedAnnotator)
        onClose()
      } catch (error) {
        console.error('Failed to update annotator', error)
        const message =
          error instanceof Error ? error.message : 'Failed to update annotator. Please try again.'
        setErrorMessage(message)
      } finally {
        setIsSubmitting(false)
      }

      return
    }

    try {
      console.log('Creating annotator via API', {
        username,
        role,
        transcriptAssignments: selectedTranscriptIds.length,
      })
      setIsSubmitting(true)
      setErrorMessage(null)

      const response = await fetch('/api/admin/annotators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          username,
          password,
          role,
          transcriptIds: selectedTranscriptIds,
        }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.success || !payload.user?.id) {
        const message = payload?.error ?? 'Failed to create annotator.'
        throw new Error(message)
      }

      console.log('New Clerk user created with ID:', payload.user.id, 'and database ID:', payload.user.dbId)

      const assignedTranscripts =
        selectedTranscriptIds.length === 0
          ? []
          : selectedTranscriptIds.map((id) => {
              const matched = availableTranscripts.find((transcript) => transcript.id === id)
              return {
                id,
                title: matched?.title ?? 'Untitled transcript',
              }
            })

      const newAnnotator: Annotator = {
        id: payload.user.dbId ?? payload.user.id,
        name,
        username,
        password,
        role,
        assignedTranscripts,
        enabled: true,
      }

      onAnnotatorCreated?.(newAnnotator)
      onClose()
    } catch (error) {
      console.error('Failed to create annotator', error)
      const message =
        error instanceof Error ? error.message : 'Failed to create annotator. Please try again.'
      setErrorMessage(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {isEditing ? 'Edit Annotator' : 'Create New Annotator'}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {isEditing
                  ? 'Update annotator details and transcript assignments'
                  : 'Add a new annotator to the system'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Name */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
                disabled={isSubmitting || isEditing}
              />
            </div>

            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
                disabled={isSubmitting || isEditing}
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password{' '}
                {isEditing ? (
                  <span className="text-gray-500">(view only)</span>
                ) : (
                  <span className="text-red-500">*</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEditing ? 'Current password' : 'Enter password'}
                  className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required={!isEditing}
                  disabled={isSubmitting}
                  readOnly={isEditing}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  disabled={isSubmitting}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Role */}
            <div>
              <label
                htmlFor="role"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Role <span className="text-red-500">*</span>
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => handleRoleChange(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                required
                disabled={isSubmitting || isEditing}
              >
                <option value="annotator">Annotator</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Assignable Transcripts */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Assignable Transcripts
              </label>
              {isAdminRole ? (
                <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                  <p className="text-sm text-gray-600">
                    Admins manage transcripts globally and cannot be assigned individual transcripts.
                  </p>
                </div>
              ) : (
                <>
                  <div className="border border-gray-300 rounded-lg p-4 max-h-64 overflow-y-auto bg-gray-50">
                    <div className="space-y-2">
                      {isLoadingTranscripts && availableTranscripts.length === 0 && (
                        <p className="text-sm text-gray-500">Loading transcripts…</p>
                      )}
                      {transcriptsError && (
                        <p className="text-sm text-red-600">{transcriptsError}</p>
                      )}
                      {!isLoadingTranscripts && !transcriptsError && availableTranscripts.length === 0 && (
                        <p className="text-sm text-gray-500">No transcripts available.</p>
                      )}
                      {availableTranscripts.map((transcript) => (
                        <label
                          key={transcript.id}
                          className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTranscriptIds.includes(transcript.id)}
                            onChange={() => handleTranscriptToggle(transcript.id)}
                            className="w-5 h-5 text-primary-600 border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                            disabled={isSubmitting || isLoadingTranscripts}
                          />
                          <span className="text-sm font-medium text-gray-900">
                            {transcript.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {selectedTranscriptIds.length} transcript
                    {selectedTranscriptIds.length !== 1 ? 's' : ''} selected
                  </p>
                </>
              )}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Annotators will only be able to view and work on
                the transcripts you assign to them. They will not see other transcripts.
              </p>
            </div>

            {errorMessage && (
              <div className="text-sm text-red-600" role="alert">
                {errorMessage}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Annotator'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
