'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { X, Upload, Image as ImageIcon, Trash2, Plus } from 'lucide-react'

interface InstructionItem {
  id: string
  image: File | null
  imagePreview: string | null
  text: string
  segmentIds: string[]
}

interface ExistingInstructionItem {
  id: string
  imageUrl: string
  imageTitle: string
  segmentIds: string[]
  description?: string | null
  uploadedAt?: string
  orderIndex: number
  fileName?: string | null
}

type ExistingInstructionApiItem = {
  id?: string | number | null
  url?: string | null
  gcs_path?: string | null
  image_title?: string | null
  title?: string | null
  segment_ids?: Array<string | null> | null
  description?: string | null
  uploaded_at?: string | null
  order_index?: number | null
  original_file_name?: string | null
}

type TranscriptSegmentItem = {
  id: string
  label: string
  index: number
}

type TranscriptSegmentApiItem = {
  id?: string | number | null
  label?: string | null
  title?: string | null
  segment_title?: string | null
  index?: number | null
  segment_index?: number | null
}

interface UploadInstructionMaterialsModalProps {
  isOpen: boolean
  onClose: () => void
  transcriptId: string
  transcriptName: string
}

export default function UploadInstructionMaterialsModal({
  isOpen,
  onClose,
  transcriptId,
  transcriptName,
}: UploadInstructionMaterialsModalProps) {
  const [instructionalMaterialLink, setInstructionalMaterialLink] = useState('')
  const [items, setItems] = useState<InstructionItem[]>([
    { id: '1', image: null, imagePreview: null, text: '', segmentIds: [] }
  ])
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegmentItem[]>([])
  const [openSegmentPickerItemId, setOpenSegmentPickerItemId] = useState<string | null>(null)
  const openSegmentPickerRef = useRef<HTMLDivElement | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [existingItems, setExistingItems] = useState<ExistingInstructionItem[]>([])
  const [isLoadingExisting, setIsLoadingExisting] = useState(false)
  const [existingError, setExistingError] = useState<string | null>(null)
  const [hasCheckedExisting, setHasCheckedExisting] = useState(false)
  const [isDeletingExisting, setIsDeletingExisting] = useState(false)
  const [deleteExistingError, setDeleteExistingError] = useState<string | null>(null)

  if (!isOpen) return null

  useEffect(() => {
    if (!isOpen || !transcriptId) {
      return
    }

    setHasCheckedExisting(false)
    setExistingItems([])
    setTranscriptSegments([])
    setDeleteExistingError(null)
    setIsDeletingExisting(false)
    setOpenSegmentPickerItemId(null)

    let isCancelled = false
    const controller = new AbortController()

    const loadExisting = async () => {
      setIsLoadingExisting(true)
      setExistingError(null)

      try {
        const response = await fetch(
          `/api/admin/transcripts/${encodeURIComponent(transcriptId)}/instructional-material?transcriptId=${encodeURIComponent(transcriptId)}`,
          { signal: controller.signal },
        )
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || payload?.success === false) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : 'Failed to load existing instructional materials.'
          throw new Error(message)
        }

        if (Array.isArray(payload?.items) && !isCancelled) {
          const items = payload.items as ExistingInstructionApiItem[]

          const normalized = items
            .map((item): ExistingInstructionItem => {
              const segmentIds = Array.isArray(item.segment_ids)
                ? Array.from(
                    new Set(
                      item.segment_ids
                        .filter((segmentId): segmentId is string => typeof segmentId === 'string')
                        .map((segmentId) => segmentId.trim())
                        .filter((segmentId) => segmentId.length > 0),
                    ),
                  )
                : []

              return {
                id: String(item.id ?? ''),
                imageUrl: String(item.url ?? item.gcs_path ?? ''),
                imageTitle: String(item.image_title ?? item.title ?? 'Instruction item'),
                segmentIds,
                description:
                  typeof item.description === 'string' || item.description === null
                    ? item.description
                    : undefined,
                uploadedAt: typeof item.uploaded_at === 'string' ? item.uploaded_at : undefined,
                orderIndex:
                  typeof item.order_index === 'number' && Number.isFinite(item.order_index)
                    ? item.order_index
                    : 0,
                fileName:
                  typeof item.original_file_name === 'string'
                    ? item.original_file_name
                    : undefined,
              }
            })
            .filter(
              (item: ExistingInstructionItem): item is ExistingInstructionItem =>
                Boolean(item.imageUrl) && Boolean(item.id),
            )

          setExistingItems(normalized)
        }

        if (!isCancelled) {
          const payloadSegments = Array.isArray(payload?.segments)
            ? (payload.segments as TranscriptSegmentApiItem[])
            : []
          const normalizedSegments = payloadSegments
            .map((segment): TranscriptSegmentItem | null => {
              const id = String(segment.id ?? '').trim()
              if (!id) {
                return null
              }

              const labelCandidate =
                typeof segment.label === 'string' && segment.label.trim()
                  ? segment.label.trim()
                  : typeof segment.segment_title === 'string' && segment.segment_title.trim()
                    ? segment.segment_title.trim()
                    : typeof segment.title === 'string' && segment.title.trim()
                      ? segment.title.trim()
                      : null

              const indexCandidate =
                typeof segment.index === 'number' && Number.isFinite(segment.index)
                  ? Math.floor(segment.index)
                  : typeof segment.segment_index === 'number' &&
                      Number.isFinite(segment.segment_index)
                    ? Math.floor(segment.segment_index)
                    : null

              const label =
                labelCandidate ?? (indexCandidate !== null ? String(indexCandidate) : '')
              if (!label) {
                return null
              }

              return {
                id,
                label,
                index: indexCandidate ?? Number.MAX_SAFE_INTEGER,
              }
            })
            .filter((segment): segment is TranscriptSegmentItem => segment !== null)
            .sort((segmentA, segmentB) => {
              if (segmentA.index !== segmentB.index) {
                return segmentA.index - segmentB.index
              }
              return segmentA.label.localeCompare(segmentB.label)
            })

          setTranscriptSegments(normalizedSegments)
        }

        if (!isCancelled) {
          const link =
            typeof payload?.instructional_material_link === 'string'
              ? payload.instructional_material_link.trim()
              : ''
          setInstructionalMaterialLink(link)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Failed to load existing instructional materials', error)
        if (!isCancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load existing instructional materials.'
          setExistingError(message)
          setExistingItems([])
          setTranscriptSegments([])
          setInstructionalMaterialLink('')
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingExisting(false)
          setHasCheckedExisting(true)
        }
      }
    }

    loadExisting()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [isOpen, transcriptId])

  useEffect(() => {
    if (!openSegmentPickerItemId) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (!openSegmentPickerRef.current) {
        return
      }

      if (!openSegmentPickerRef.current.contains(event.target as Node)) {
        setOpenSegmentPickerItemId(null)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSegmentPickerItemId(null)
      }
    }

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openSegmentPickerItemId])

  const handleAddItem = () => {
    const newItem: InstructionItem = {
      id: Date.now().toString(),
      image: null,
      imagePreview: null,
      text: '',
      segmentIds: [],
    }
    setItems((previous) => [...previous, newItem])
  }

  const handleRemoveItem = (id: string) => {
    setItems((previous) => {
      if (previous.length <= 1) {
        return previous
      }
      return previous.filter((item) => item.id !== id)
    })
    setOpenSegmentPickerItemId((current) => (current === id ? null : current))
  }

  const handleImageUpload = (id: string, file: File) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      setItems((previous) =>
        previous.map((item) =>
          item.id === id
            ? { ...item, image: file, imagePreview: reader.result as string }
            : item,
        ),
      )
    }
    reader.readAsDataURL(file)
  }

  const handleTextChange = (id: string, text: string) => {
    setItems((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, text } : item,
      ),
    )
  }

  const handleAddSegmentToItem = (itemId: string, segmentId: string) => {
    setItems((previous) =>
      previous.map((item) => {
        if (item.id !== itemId || item.segmentIds.includes(segmentId)) {
          return item
        }

        return {
          ...item,
          segmentIds: [...item.segmentIds, segmentId],
        }
      }),
    )
    setOpenSegmentPickerItemId(null)
  }

  const handleRemoveSegmentFromItem = (itemId: string, segmentId: string) => {
    setItems((previous) =>
      previous.map((item) =>
        item.id === itemId
          ? {
              ...item,
              segmentIds: item.segmentIds.filter((currentSegmentId) => currentSegmentId !== segmentId),
            }
          : item,
      ),
    )
  }

  const resetForm = () => {
    setInstructionalMaterialLink('')
    setItems([{ id: '1', image: null, imagePreview: null, text: '', segmentIds: [] }])
    setTranscriptSegments([])
    setOpenSegmentPickerItemId(null)
    setErrorMessage(null)
    setExistingItems([])
    setExistingError(null)
    setHasCheckedExisting(false)
    setIsLoadingExisting(false)
    setDeleteExistingError(null)
    setIsDeletingExisting(false)
  }

  const handleSubmit = async () => {
    if (!hasCheckedExisting || existingItems.length > 0) {
      return
    }

    const itemsWithImages = items.filter((item) => item.image)
    if (itemsWithImages.length === 0) {
      setErrorMessage('Please upload at least one instruction image.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMessage(null)

      const formData = new FormData()
      formData.append('transcriptId', transcriptId)
      formData.append('instructionalMaterialLink', instructionalMaterialLink.trim())

      const materials = itemsWithImages.map((item, index) => {
        const fileField = `file-${index}`
        if (item.image) {
          formData.append(fileField, item.image)
        }

        const selectedSegmentLabels = item.segmentIds
          .map((segmentId) =>
            transcriptSegments.find((segment) => segment.id === segmentId)?.label ?? null,
          )
          .filter((label): label is string => Boolean(label))
        const segmentBasedTitle =
          selectedSegmentLabels.length > 0
            ? selectedSegmentLabels.map((label) => `segment ${label}`).join(', ')
            : ''

        return {
          fileField,
          title: segmentBasedTitle || item.text.trim(),
          description: item.text.trim(),
          orderIndex: index,
          segmentIds: item.segmentIds,
        }
      })

      formData.append('materials', JSON.stringify(materials))

      const response = await fetch(
        `/api/admin/transcripts/${encodeURIComponent(transcriptId)}/instructional-material`,
        {
          method: 'POST',
          body: formData,
        },
      )

      const payload = await response.json().catch(() => ({}))

      if (!response.ok || payload?.success === false) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to upload instructional materials.'
        throw new Error(message)
      }

      resetForm()
      onClose()
    } catch (error) {
      console.error('Failed to upload instructional materials', error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to upload instructional materials right now.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteExisting = async () => {
    if (!transcriptId || isDeletingExisting) {
      return
    }

    const confirmed = window.confirm(
      'Delete all instructional materials for this transcript? This cannot be undone.',
    )
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingExisting(true)
      setDeleteExistingError(null)

      const response = await fetch(
        `/api/admin/transcripts/${encodeURIComponent(transcriptId)}/instructional-material?transcriptId=${encodeURIComponent(transcriptId)}`,
        { method: 'DELETE' },
      )
      const payload = await response.json().catch(() => ({}))

      if (!response.ok || payload?.success === false) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to delete instructional materials.'
        throw new Error(message)
      }

      if (Array.isArray(payload?.storageErrors) && payload.storageErrors.length > 0) {
        console.warn('Some storage objects could not be deleted', payload.storageErrors)
      }

      setExistingItems([])
      setExistingError(null)
      setInstructionalMaterialLink('')
      setItems([{ id: '1', image: null, imagePreview: null, text: '', segmentIds: [] }])
      setHasCheckedExisting(true)
      setOpenSegmentPickerItemId(null)
    } catch (error) {
      console.error('Failed to delete instructional materials', error)
      setDeleteExistingError(
        error instanceof Error
          ? error.message
          : 'Failed to delete instructional materials.',
      )
    } finally {
      setIsDeletingExisting(false)
    }
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Upload Instruction Materials</h2>
            <p className="text-sm text-gray-600 mt-1">For: {transcriptName}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!hasCheckedExisting || isLoadingExisting ? (
            <div className="flex min-h-[200px] items-center justify-center text-sm text-gray-600">
              Checking for existing materials...
            </div>
          ) : (
            <>
              {existingError && (
                <div className="mb-4 text-sm text-red-600">{existingError}</div>
              )}

              {existingItems.length > 0 ? (
                <>
                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Instructional material link
                    </label>
                    <input
                      type="url"
                      value={instructionalMaterialLink || 'No link provided'}
                      readOnly
                      disabled
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                    />
                  </div>

                  {deleteExistingError && (
                    <div className="mb-4 text-sm text-red-600">{deleteExistingError}</div>
                  )}

                  <div className="mb-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700">
                          Instruction Items (Images & Text)
                        </label>
                        <span className="text-xs text-gray-500">
                          Existing materials are view-only.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDeleteExisting}
                        disabled={isDeletingExisting}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                        {isDeletingExisting ? 'Deleting...' : 'Delete materials'}
                      </button>
                    </div>

                    <div className="space-y-4">
                      {existingItems.map((item, index) => {
                        const selectedSegments = item.segmentIds
                          .map((segmentId) =>
                            transcriptSegments.find((segment) => segment.id === segmentId) ?? null,
                          )
                          .filter((segment): segment is TranscriptSegmentItem => segment !== null)

                        return (
                          <div
                            key={item.id}
                            className="bg-gray-50 rounded-lg p-6 border-2 border-gray-200 hover:border-primary-300 transition-colors"
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700">
                                  Item {index + 1}
                                </h4>
                                {item.fileName && (
                                  <p className="text-xs text-gray-500 mt-1">
                                    Uploaded file: {item.fileName}
                                  </p>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                Position {item.orderIndex + 1}
                                {item.uploadedAt
                                  ? ` · Uploaded ${new Date(item.uploadedAt).toLocaleString()}`
                                  : ''}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-2">
                                  Image
                                </label>
                                <div className="relative">
                                  <Image
                                    src={item.imageUrl}
                                    alt={item.imageTitle}
                                    width={600}
                                    height={400}
                                    unoptimized
                                    className="h-48 w-full rounded-lg border-2 border-gray-300 object-cover"
                                  />
                                  <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-gray-200" />
                                </div>
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-2">
                                  Associated Text
                                </label>
                                <textarea
                                  value={item.description ?? ''}
                                  placeholder="Enter description or instructions for this image..."
                                  readOnly
                                  disabled
                                  className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg bg-gray-100 text-gray-700 resize-none cursor-not-allowed"
                                />
                              </div>
                            </div>

                            {selectedSegments.length > 0 && (
                              <div className="mt-4">
                                <label className="block text-xs font-medium text-gray-600 mb-2">
                                  Associated Segments
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  {selectedSegments.map((segment) => (
                                    <span
                                      key={`${item.id}-${segment.id}`}
                                      className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-800"
                                    >
                                      {`segment ${segment.label}`}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      disabled
                      className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 bg-gray-50 cursor-not-allowed"
                    >
                      <Plus className="w-5 h-5" />
                      <span className="font-medium">Add Another Item</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Title Input */}
                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Instructional material link
                    </label>
                    <input
                      type="url"
                      value={instructionalMaterialLink}
                      onChange={(e) => setInstructionalMaterialLink(e.target.value)}
                      placeholder="Enter instructional material link..."
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  {/* Gallery Items */}
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-4">
                      Instruction Items (Images & Text)
                    </label>
                    
                    <div className="space-y-4">
                      {items.map((item, index) => {
                        const selectedSegments = item.segmentIds
                          .map((segmentId) =>
                            transcriptSegments.find((segment) => segment.id === segmentId) ?? null,
                          )
                          .filter((segment): segment is TranscriptSegmentItem => segment !== null)
                        const availableSegments = transcriptSegments.filter(
                          (segment) => !item.segmentIds.includes(segment.id),
                        )
                        const isSegmentPickerOpen = openSegmentPickerItemId === item.id

                        return (
                          <div
                            key={item.id}
                            className="bg-gray-50 rounded-lg p-6 border-2 border-gray-200 hover:border-primary-300 transition-colors"
                          >
                            <div className="flex items-start justify-between mb-4">
                              <h4 className="text-sm font-semibold text-gray-700">
                                Item {index + 1}
                              </h4>
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.id)}
                                  className="text-red-600 hover:text-red-700 transition-colors"
                                  title="Remove item"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Image Upload */}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-2">
                                  Image
                                </label>
                                {item.imagePreview ? (
                                  <div className="relative group">
                                    <Image
                                      src={item.imagePreview}
                                      alt={`Preview ${index + 1}`}
                                      width={600}
                                      height={400}
                                      unoptimized
                                      className="h-48 w-full rounded-lg border-2 border-gray-300 object-cover"
                                    />
                                    <div className="absolute inset-0 bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                                      <label className="cursor-pointer bg-white px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">
                                        Change Image
                                        <input
                                          type="file"
                                          accept="image/*"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0]
                                            if (file) handleImageUpload(item.id, file)
                                          }}
                                          className="hidden"
                                        />
                                      </label>
                                    </div>
                                  </div>
                                ) : (
                                  <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-colors">
                                    <div className="flex flex-col items-center justify-center">
                                      <ImageIcon className="w-10 h-10 text-gray-400 mb-2" />
                                      <p className="text-sm text-gray-600 font-medium">
                                        Upload Image
                                      </p>
                                      <p className="text-xs text-gray-500 mt-1">
                                        PNG, JPG, GIF up to 10MB
                                      </p>
                                    </div>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) handleImageUpload(item.id, file)
                                      }}
                                      className="hidden"
                                    />
                                  </label>
                                )}
                              </div>

                              {/* Text Input */}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-2">
                                  Associated Text
                                </label>
                                <textarea
                                  value={item.text}
                                  onChange={(e) => handleTextChange(item.id, e.target.value)}
                                  placeholder="Enter description or instructions for this image..."
                                  className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                                />
                              </div>
                            </div>

                            <div className="mt-4">
                              <label className="block text-xs font-medium text-gray-600 mb-2">
                                Associated Segments
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                {selectedSegments.map((segment) => (
                                  <button
                                    key={`${item.id}-${segment.id}`}
                                    type="button"
                                    onClick={() => handleRemoveSegmentFromItem(item.id, segment.id)}
                                    className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-800 hover:bg-primary-200 transition-colors"
                                    title={`Remove segment ${segment.label}`}
                                  >
                                    <span>{`segment ${segment.label}`}</span>
                                    <X className="h-3 w-3" />
                                  </button>
                                ))}

                                {selectedSegments.length === 0 && (
                                  <span className="text-xs text-gray-500">No segments selected.</span>
                                )}

                                <div
                                  className="relative"
                                  ref={isSegmentPickerOpen ? openSegmentPickerRef : null}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenSegmentPickerItemId((current) =>
                                        current === item.id ? null : item.id,
                                      )
                                    }
                                    disabled={availableSegments.length === 0}
                                    className="inline-flex items-center rounded-full border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
                                  >
                                    + Add segment
                                  </button>

                                  {isSegmentPickerOpen && (
                                    <div className="absolute left-0 top-full z-20 mt-2 w-64 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                                      {availableSegments.map((segment) => (
                                        <button
                                          key={segment.id}
                                          type="button"
                                          onClick={() => handleAddSegmentToItem(item.id, segment.id)}
                                          className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                                        >
                                          {`segment ${segment.label}`}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {transcriptSegments.length === 0 && (
                                <p className="mt-2 text-xs text-gray-500">
                                  No transcript segments available.
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Add Item Button */}
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-primary-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                      <span className="font-medium">Add Another Item</span>
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          {errorMessage && hasCheckedExisting && existingItems.length === 0 && (
            <p className="text-sm text-red-600 mr-auto">{errorMessage}</p>
          )}
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Close
          </button>
          {hasCheckedExisting && existingItems.length === 0 && (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {isSubmitting ? 'Uploading...' : 'Upload Materials'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
