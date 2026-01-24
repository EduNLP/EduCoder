/*
  Warnings:

  - You are about to drop the column `section_title` on the `SegmentVideos` table. All the data in the column will be lost.
  - You are about to drop the column `transcript_id` on the `SegmentVideos` table. All the data in the column will be lost.
  - You are about to drop the column `segment` on the `TranscriptLines` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SegmentVideos" DROP CONSTRAINT "SegmentVideos_transcript_id_fkey";

-- DropIndex
DROP INDEX "SegmentVideos_transcript_id_section_title_key";

-- AlterTable
ALTER TABLE "SegmentVideos" DROP COLUMN "section_title",
DROP COLUMN "transcript_id",
ADD COLUMN     "segment_id" UUID;

-- AlterTable
ALTER TABLE "TranscriptLines" DROP COLUMN "segment",
ADD COLUMN     "segment_id" UUID;

-- CreateTable
CREATE TABLE "TranscriptSegments" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "segment_title" TEXT NOT NULL,
    "segment_index" INTEGER NOT NULL,
    "start_time" INTEGER,
    "end_time" INTEGER,

    CONSTRAINT "TranscriptSegments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TranscriptLines" ADD CONSTRAINT "TranscriptLines_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "TranscriptSegments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentVideos" ADD CONSTRAINT "SegmentVideos_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "TranscriptSegments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegments" ADD CONSTRAINT "TranscriptSegments_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
