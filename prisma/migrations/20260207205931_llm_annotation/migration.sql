/*
  Warnings:

  - The `llm_annotation` column on the `Transcripts` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "LLMAnnotationStatus" AS ENUM ('not_generated', 'in_process', 'generated');

-- AlterTable
ALTER TABLE "Transcripts" DROP COLUMN "llm_annotation",
ADD COLUMN     "llm_annotation" "LLMAnnotationStatus" NOT NULL DEFAULT 'not_generated';
