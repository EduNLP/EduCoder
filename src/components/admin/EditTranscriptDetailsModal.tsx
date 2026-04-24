'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'

type TranscriptToEdit = {
  id: string
  title: string
  grade: string | null
  instruction_context: string
}

type EditTranscriptPayload = {
  title: string
  grade: string
  instructionContext: string
}

interface EditTranscriptDetailsModalProps {
  isOpen: boolean
  transcript: TranscriptToEdit | null
  isSaving: boolean
  errorMessage: string | null
  onClose: () => void
  onSave: (values: EditTranscriptPayload) => Promise<void>
}

export default function EditTranscriptDetailsModal({
  isOpen,
  transcript,
  isSaving,
  errorMessage,
  onClose,
  onSave,
}: EditTranscriptDetailsModalProps) {
  const [title, setTitle] = useState('')
  const [grade, setGrade] = useState('')
  const [instructionContext, setInstructionContext] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !transcript) {
      return
    }

    setTitle(transcript.title ?? '')
    setGrade(transcript.grade ?? '')
    setInstructionContext(transcript.instruction_context ?? '')
    setValidationError(null)
  }, [
    isOpen,
    transcript?.id,
    transcript?.title,
    transcript?.grade,
    transcript?.instruction_context,
  ])

  if (!isOpen || !transcript) {
    return null
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedTitle = title.trim()
    const trimmedGrade = grade.trim()
    const trimmedInstructionContext = instructionContext.trim()

    if (!trimmedTitle) {
      setValidationError('Transcript name is required.')
      return
    }

    if (!trimmedGrade) {
      setValidationError('Grade is required.')
      return
    }

    setValidationError(null)
    await onSave({
      title: trimmedTitle,
      grade: trimmedGrade,
      instructionContext: trimmedInstructionContext,
    })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={() => {
          if (!isSaving) {
            onClose()
          }
        }}
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 p-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Edit Transcript Details</h2>
              <p className="mt-1 text-sm text-gray-600">Update name, grade, and lesson goals.</p>
            </div>
            <button
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg p-2 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6 p-6">
            <div>
              <label
                htmlFor="edit-transcript-name"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Transcript Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="edit-transcript-name"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Enter transcript name"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="edit-transcript-grade"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Grade <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="edit-transcript-grade"
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                placeholder="Enter grade (e.g., Grade 4)"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="edit-transcript-instruction-context"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Lesson Learning Goals
              </label>
              <textarea
                id="edit-transcript-instruction-context"
                value={instructionContext}
                onChange={(event) => setInstructionContext(event.target.value)}
                rows={4}
                placeholder="Provide lesson learning goals"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {(validationError || errorMessage) && (
              <p className="text-sm text-red-600">{validationError ?? errorMessage}</p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-primary-600 px-6 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
