-- CreateEnum
CREATE TYPE "LLMAnnotationVisibilityAdmin" AS ENUM ('hidden', 'visible_after_completion', 'always_visible');

-- AlterTable
ALTER TABLE "Annotations" ADD COLUMN     "llm_annotation_visibility_admin" "LLMAnnotationVisibilityAdmin" NOT NULL DEFAULT 'hidden',
ADD COLUMN     "llm_annotation_visibility_user" BOOLEAN NOT NULL DEFAULT true;
