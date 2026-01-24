/*
  Warnings:

  - You are about to drop the `SegmentVideos` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[video_id]` on the table `Transcripts` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "SegmentVideos" DROP CONSTRAINT "SegmentVideos_segment_id_fkey";

-- AlterTable
ALTER TABLE "Transcripts" ADD COLUMN     "video_id" UUID,
ADD COLUMN     "video_uploaded" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "SegmentVideos";

-- DropEnum
DROP TYPE "AnnotationStatus";

-- CreateTable
CREATE TABLE "Videos" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "gcs_path" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transcripts_video_id_key" ON "Transcripts"("video_id");

-- AddForeignKey
ALTER TABLE "Transcripts" ADD CONSTRAINT "Transcripts_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "Videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
