-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('user', 'llm');

-- AlterTable
ALTER TABLE "Notes" ADD COLUMN     "source" "NoteSource" NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "LLMNotePrompts" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "note_creation_prompt" TEXT NOT NULL,
    "note_assignment_prompt" TEXT NOT NULL,
    "annotate_all_lines" BOOLEAN NOT NULL DEFAULT true,
    "range_start_line" INTEGER,
    "range_end_line" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMNotePrompts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LLMNotePrompts" ADD CONSTRAINT "LLMNotePrompts_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMNotePrompts" ADD CONSTRAINT "LLMNotePrompts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
