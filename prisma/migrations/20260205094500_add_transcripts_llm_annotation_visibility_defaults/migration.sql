-- AlterTable
ALTER TABLE "Transcripts" ADD COLUMN     "llm_annotation_visibility_default" "LLMAnnotationVisibilityAdmin" NOT NULL DEFAULT 'hidden',
ADD COLUMN     "llm_annotation_visibility_per_annotator" BOOLEAN NOT NULL DEFAULT false;
