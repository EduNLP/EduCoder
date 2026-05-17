ALTER TABLE "LLMNotePrompts"
ADD COLUMN "annotate_all_segments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "selected_segment_ids_json" TEXT;
