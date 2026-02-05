-- AlterTable
ALTER TABLE "Workspaces" ADD COLUMN     "llm_annotation_limit" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "llm_annotation_used" INTEGER NOT NULL DEFAULT 0;
