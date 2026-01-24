/*
  Warnings:

  - You are about to drop the column `llm_transcript` on the `Transcripts` table. All the data in the column will be lost.
  - You are about to drop the column `llm_transcript_gcs_path` on the `Transcripts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Transcripts" DROP COLUMN "llm_transcript",
DROP COLUMN "llm_transcript_gcs_path",
ADD COLUMN     "llm_annotation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "llm_annotation_gcs_path" TEXT;
