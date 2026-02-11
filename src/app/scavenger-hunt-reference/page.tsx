'use client'

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { VideoAnnotatePlayer } from '@/components/VideoAnnotatePlayer'
import { useTheme } from '@/context/ThemeContext'

type TranscriptRow = {
  id: string
  line: number
  speaker: string
  utterance: string
  myNotes: string[]
  llmNotes: string[]
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

type NoteEntry = {
  id: string
  number: number
  title: string
} & Record<NoteFieldId, string>

const SAMPLE_TRANSCRIPT_ROWS: TranscriptRow[] = [
  {
    id: 'row-1',
    line: 4,
    speaker: 'Teacher',
    utterance:
      "Let's compare both strategies. What stays the same when we scale the numbers?",
    myNotes: ['Note 1', 'Note 3'],
    llmNotes: ['LLM: Teacher move'],
  },
  {
    id: 'row-2',
    line: 5,
    speaker: 'Student A',
    utterance: 'It is still doubling, but the total is larger.',
    myNotes: ['Note 2'],
    llmNotes: ['LLM: Misconception check'],
  },
  {
    id: 'row-3',
    line: 6,
    speaker: 'Student B',
    utterance: 'We can check with a ratio table to see each step.',
    myNotes: ['Note 4'],
    llmNotes: ['LLM: Inference: structural thinking'],
  },
  {
    id: 'row-4',
    line: 7,
    speaker: 'Teacher',
    utterance: 'Show me where you noticed the pattern repeating.',
    myNotes: [],
    llmNotes: ['LLM: Teacher move'],
  },
]

const SAMPLE_USER_NOTES: NoteEntry[] = [
  {
    id: 'note-1',
    number: 1,
    title: 'Scaling keeps structure',
    q1: 'Student A notes doubling remains consistent even as totals change.',
    q2: 'Highlight the invariant relationship to anchor the explanation.',
    q3: 'Student sees the pattern but needs justification on why it holds.',
  },
  {
    id: 'note-2',
    number: 2,
    title: 'Partial reasoning',
    q1: 'Student A mentions doubling but stops short of using ratios.',
    q2: 'Probe for how doubling shows up in each table step.',
    q3: 'Student is on the right track but lacks the structure.',
  },
  {
    id: 'note-3',
    number: 3,
    title: 'Prompt for structure',
    q1: 'Teacher asks what stays the same when scaling up.',
    q2: 'This is a bridge to connect strategy and pattern recognition.',
    q3: 'Students need to verbalize the invariant to build reasoning.',
  },
  {
    id: 'note-4',
    number: 4,
    title: 'Strategy shift',
    q1: 'Student B suggests a ratio table to verify steps.',
    q2: 'Mark this as an explicit strategy pivot.',
    q3: 'Student is ready to justify the scaling with structure.',
  },
]

const SAMPLE_LLM_NOTES: NoteEntry[] = [
  {
    id: 'llm-note-1',
    number: 1,
    title: 'Inference: structural thinking',
    q1: 'Student B introduces a ratio table to support reasoning.',
    q2: 'LLM suggests reinforcing the link between the table and the pattern.',
    q3: 'Evidence shows readiness to generalize using proportional reasoning.',
  },
  {
    id: 'llm-note-2',
    number: 2,
    title: 'Misconception check',
    q1: 'Student A states doubling without explaining why it works.',
    q2: 'LLM flags missing justification as a potential gap.',
    q3: 'The student may rely on pattern recognition without proof.',
  },
  {
    id: 'llm-note-3',
    number: 3,
    title: 'Teacher move',
    q1: 'Teacher asks for what stays the same with scaling.',
    q2: 'LLM identifies this as a prompt to surface structure.',
    q3: 'Likely to elicit reasoning about multiplicative relationships.',
  },
]

type NotePanelProps = {
  title: string
  description: string
  notes: NoteEntry[]
  badgeTone?: 'indigo' | 'emerald' | 'amber'
  expandedNotes: Record<string, boolean>
  onToggleExpanded: (noteId: string) => void
  className?: string
}

const badgeToneStyles: Record<
  NonNullable<NotePanelProps['badgeTone']>,
  string
> = {
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
}

const QUESTION_PROMPTS = [
  'Which lines show students refining their reasoning after feedback?',
  'Where does a student shift strategies after a teacher prompt?',
  'Identify a moment where the class clarifies a misconception.',
]

function NotePanel({
  title,
  description,
  notes,
  badgeTone = 'indigo',
  expandedNotes,
  onToggleExpanded,
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
          {description ? (
            <p className="text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeToneStyles[badgeTone]}`}
        >
          {notes.length} notes
        </span>
      </div>
      <div className="stealth-scrollbar mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {notes.map((note) => {
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
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600">
                  {note.number}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {note.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    Click to {isExpanded ? 'collapse' : 'expand'} details
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
              {isExpanded && (
                <div className="space-y-3 border-t border-slate-200/70 px-3 pb-3 pt-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Title
                    </p>
                    <p className="text-sm text-slate-700">{note.title}</p>
                  </div>
                  {NOTE_FIELDS.map((field) => (
                    <div key={field.id} className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {field.label}
                      </p>
                      <p className="text-sm text-slate-700">
                        {note[field.id]}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function ScavengerHuntPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const [response, setResponse] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
  const [expandedUserNotes, setExpandedUserNotes] = useState<
    Record<string, boolean>
  >({})
  const [expandedLlmNotes, setExpandedLlmNotes] = useState<
    Record<string, boolean>
  >({})

  const pageBackgroundStyle = useMemo(
    () => ({
      backgroundColor: theme.backgroundColor,
      backgroundImage: theme.backgroundImage ?? 'none',
    }),
    [theme],
  )

  const handleBackToWorkspace = () => {
    router.push('/workspace')
  }

  const normalizeTag = (tag: string) =>
    tag.replace(/^llm:\s*/i, '').trim().toLowerCase()

  const findNoteIdFromTag = (tag: string, notes: NoteEntry[]) => {
    const numberMatch = tag.match(/note\s*(\d+)/i)
    if (numberMatch) {
      const number = Number(numberMatch[1])
      const numberMatchNote = notes.find((note) => note.number === number)
      if (numberMatchNote) {
        return numberMatchNote.id
      }
    }

    const normalizedTag = normalizeTag(tag)
    const exactTitleMatch = notes.find(
      (note) => note.title.toLowerCase() === normalizedTag,
    )
    if (exactTitleMatch) {
      return exactTitleMatch.id
    }

    const partialTitleMatch = notes.find((note) =>
      note.title.toLowerCase().includes(normalizedTag),
    )
    if (partialTitleMatch) {
      return partialTitleMatch.id
    }

    const reversePartialMatch = notes.find((note) =>
      normalizedTag.includes(note.title.toLowerCase()),
    )
    if (reversePartialMatch) {
      return reversePartialMatch.id
    }

    return undefined
  }

  const handleNoteTagClick = (
    tag: string,
    notes: NoteEntry[],
    setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>,
  ) => {
    const noteId = findNoteIdFromTag(tag, notes)
    if (!noteId) {
      return
    }

    setExpanded((previous) => ({
      ...previous,
      [noteId]: !previous[noteId],
    }))
  }

  const allRowIds = useMemo(
    () => SAMPLE_TRANSCRIPT_ROWS.map((row) => row.id),
    [],
  )
  const areAllRowsSelected =
    allRowIds.length > 0 && selectedRowIds.length === allRowIds.length

  const toggleRowSelected = (rowId: string) => {
    setSelectedRowIds((previous) =>
      previous.includes(rowId)
        ? previous.filter((id) => id !== rowId)
        : [...previous, rowId],
    )
  }

  const toggleAllRows = () => {
    setSelectedRowIds((previous) =>
      previous.length === allRowIds.length ? [] : [...allRowIds],
    )
  }

  const selectedRows = useMemo(
    () =>
      SAMPLE_TRANSCRIPT_ROWS.filter((row) => selectedRowIds.includes(row.id)),
    [selectedRowIds],
  )

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
          variant="minimal"
          density="compact"
          workspaceButtonVariant="icon"
          title="Scavenger Hunt"
        />

        <section className="grid flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,2.3fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
          <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/60 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  Scavenger hunt
                </p>
                <p className="text-xl font-semibold text-slate-900">
                  Question {questionIndex + 1}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-600 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                >
                  Lesson resources
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setQuestionIndex((index) => Math.max(0, index - 1))
                  }
                  disabled={questionIndex === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Previous question"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setQuestionIndex((index) =>
                      Math.min(QUESTION_PROMPTS.length - 1, index + 1),
                    )
                  }
                  disabled={questionIndex === QUESTION_PROMPTS.length - 1}
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Next question"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {QUESTION_PROMPTS[questionIndex]}
            </p>
            <div className="mt-3 text-xs text-slate-500">
              <span className="font-semibold uppercase tracking-[0.2em] text-slate-400">
                Selected lines:
              </span>{' '}
              {selectedRows.length > 0
                ? selectedRows.map((row) => row.line).join(', ')
                : 'None'}
            </div>
            <label
              htmlFor="scavenger-response"
              className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"
            >
              Your response
            </label>
            <textarea
              id="scavenger-response"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              rows={4}
              placeholder="Capture your evidence, cite line numbers, and describe why they matter."
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white"
            />
          </section>

          <section className="flex min-h-0 flex-col rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/60 lg:row-span-2">
            <VideoAnnotatePlayer className="mt-4" src="/lesson-1.mp4" />
            <div className="stealth-scrollbar mt-4 flex-1 overflow-auto rounded-2xl border border-slate-100 bg-white/70 p-2">
              <table className="min-w-[780px] w-full table-fixed border-separate border-spacing-y-3">
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '30%' }} />
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '21%' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
                  <tr className="text-left text-xs uppercase tracking-widest text-slate-500">
                    <th className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={areAllRowsSelected}
                        onChange={toggleAllRows}
                        aria-label="Select all transcript rows"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                    </th>
                    <th className="px-3 py-3">Line</th>
                    <th className="px-3 py-3">Speaker</th>
                    <th className="px-3 py-3">Utterance</th>
                    <th className="px-3 py-3">My notes</th>
                    <th className="px-3 py-3">LLM notes</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_TRANSCRIPT_ROWS.map((row) => {
                    const isSelected = selectedRowIds.includes(row.id)
                    return (
                      <tr
                        key={row.id}
                        className={`rounded-2xl border text-sm text-slate-700 ${
                          isSelected
                            ? 'border-indigo-200 bg-indigo-50/70'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <td className="rounded-l-2xl px-3 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelected(row.id)}
                            aria-label={`Select line ${row.line}`}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          />
                        </td>
                        <td className="border-l border-slate-100 px-3 py-3 font-mono text-xs text-slate-500">
                          {row.line}
                        </td>
                        <td className="border-l border-slate-100 px-3 py-3 font-semibold text-slate-700">
                          {row.speaker}
                        </td>
                        <td className="border-l border-slate-100 px-3 py-3 text-sm text-slate-600">
                          {row.utterance}
                        </td>
                        <td className="border-l border-slate-100 px-3 py-3">
                          {row.myNotes.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {row.myNotes.map((note) => (
                                <span
                                  key={note}
                                  onClick={() =>
                                    handleNoteTagClick(
                                      note,
                                      SAMPLE_USER_NOTES,
                                      setExpandedUserNotes,
                                    )
                                  }
                                  className="cursor-pointer rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                                >
                                  {note}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              No notes
                            </span>
                          )}
                        </td>
                        <td className="rounded-r-2xl border-l border-slate-100 px-3 py-3">
                          {row.llmNotes.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {row.llmNotes.map((note) => (
                                <span
                                  key={note}
                                  onClick={() =>
                                    handleNoteTagClick(
                                      note,
                                      SAMPLE_LLM_NOTES,
                                      setExpandedLlmNotes,
                                    )
                                  }
                                  className="cursor-pointer rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700"
                                >
                                  {note}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              No notes
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <NotePanel
            title="My notes"
            description=""
            notes={SAMPLE_USER_NOTES}
            badgeTone="emerald"
            expandedNotes={expandedUserNotes}
            onToggleExpanded={(noteId) =>
              setExpandedUserNotes((previous) => ({
                ...previous,
                [noteId]: !previous[noteId],
              }))
            }
          />

          <NotePanel
            title="LLM notes"
            description=""
            notes={SAMPLE_LLM_NOTES}
            badgeTone="indigo"
            expandedNotes={expandedLlmNotes}
            onToggleExpanded={(noteId) =>
              setExpandedLlmNotes((previous) => ({
                ...previous,
                [noteId]: !previous[noteId],
              }))
            }
          />
        </section>
      </div>
    </div>
  )
}
