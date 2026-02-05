'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { X, Upload, FileText } from 'lucide-react'
import {
  SPREADSHEET_ACCEPT,
  SPREADSHEET_FILE_ERROR_MESSAGE,
  SPREADSHEET_HELP_TEXT,
  validateTranscriptSpreadsheet,
} from '@/utils/transcriptFileValidation'

interface UploadTranscriptModalProps {
  isOpen: boolean
  onClose: () => void
  onUploaded?: (transcript: {
    id: string
    title: string
    grade: string | null
    transcript_file_name: string | null
    annotation_file_name: string | null
  }) => void
}

export default function UploadTranscriptModal({
  isOpen,
  onClose,
  onUploaded,
}: UploadTranscriptModalProps) {
  const [transcriptName, setTranscriptName] = useState('')
  const [grade, setGrade] = useState('')
  const [mainFile, setMainFile] = useState<File | null>(null)
  const [instructions, setInstructions] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const handleMainFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) {
      return
    }

    const validation = await validateTranscriptSpreadsheet(file)
    if (!validation.isValid) {
      setErrorMessage(validation.error ?? SPREADSHEET_FILE_ERROR_MESSAGE)
      setMainFile(null)
      input.value = ''
      return
    }

    setErrorMessage(null)
    setMainFile(file)
  }

  const resetForm = () => {
    setTranscriptName('')
    setGrade('')
    setInstructions('')
    setMainFile(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedTranscriptName = transcriptName.trim()
    const trimmedGrade = grade.trim()

    if (!trimmedTranscriptName) {
      setErrorMessage('Transcript name is required.')
      return
    }

    if (!trimmedGrade) {
      setErrorMessage('Grade is required.')
      return
    }

    if (!mainFile) {
      setErrorMessage('Please select the main transcript file.')
      return
    }

    const mainValidation = await validateTranscriptSpreadsheet(mainFile)
    if (!mainValidation.isValid) {
      setErrorMessage(mainValidation.error ?? SPREADSHEET_FILE_ERROR_MESSAGE)
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMessage(null)

      const formData = new FormData()
      formData.append('transcriptName', trimmedTranscriptName)
      formData.append('grade', trimmedGrade)
      formData.append('instructions', instructions)
      formData.append('mainFile', mainFile)

      const response = await fetch('/api/admin/transcripts/upload', {
        method: 'POST',
        body: formData,
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to upload transcript files.',
        )
      }

      if (payload?.transcript?.id) {
        onUploaded?.({
          id: payload.transcript.id,
          title: payload.transcript.title ?? transcriptName,
          grade: payload.transcript.grade ?? trimmedGrade ?? null,
          transcript_file_name:
            payload.transcript.transcript_file_name ?? mainFile.name,
          annotation_file_name: payload.transcript.annotation_file_name ?? null,
        })
      }

      console.log('Transcript files uploaded:', payload?.uploads)
      console.log('Transcript record:', payload?.transcript)

      resetForm()
      onClose()
    } catch (error) {
      console.error('Upload failed', error)
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to upload transcripts right now.',
      )
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
                Upload New Transcript
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Upload the main transcript file
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
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Transcript Name */}
            <div>
              <label
                htmlFor="transcriptName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Transcript Name
              </label>
              <input
                type="text"
                id="transcriptName"
                value={transcriptName}
                onChange={(e) => setTranscriptName(e.target.value)}
                placeholder="Enter transcript name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
              />
            </div>

            {/* Grade */}
            <div>
              <label
                htmlFor="grade"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Grade
              </label>
              <input
                type="text"
                id="grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="Enter grade (e.g., Grade 4)"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
              />
            </div>

            {/* Instruction and Context */}
            <div>
              <label
                htmlFor="instructionContext"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Instruction and Context
              </label>
              <textarea
                id="instructionContext"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Provide any necessary instructions or context for annotators"
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Main Transcript Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Main Transcript <span className="text-red-500">*</span>
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-primary-400 transition-colors">
                <input
                  type="file"
                  id="mainFile"
                  accept={SPREADSHEET_ACCEPT}
                  onChange={handleMainFileChange}
                  className="hidden"
                  required
                />
                <label
                  htmlFor="mainFile"
                  className="flex flex-col items-center cursor-pointer"
                >
                  <Upload className="w-12 h-12 text-gray-400 mb-3" />
                  {mainFile ? (
                    <div className="text-center">
                      <div className="flex items-center gap-2 bg-primary-50 px-4 py-2 rounded-lg">
                        <FileText className="w-4 h-4 text-primary-600" />
                        <span className="text-sm font-medium text-primary-700">
                          {mainFile.name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Click to change file
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-700 mb-1">
                        Click to upload main transcript
                      </p>
                      <p className="text-xs text-gray-500">
                        {SPREADSHEET_HELP_TEXT} up to 10MB
                      </p>
                    </div>
                  )}
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Required columns: Line number, Speaker, and Utterance.
              </p>
            </div>

            {errorMessage && (
              <p className="text-sm text-red-600 -mt-2">{errorMessage}</p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-70 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
              >
                {isSubmitting ? 'Uploading…' : 'Upload Transcript'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
