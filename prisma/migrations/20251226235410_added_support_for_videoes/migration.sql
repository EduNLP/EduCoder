-- CreateTable
CREATE TABLE "TranscriptSectionVideos" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "section_title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "gcs_path" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSectionVideos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSectionVideos_transcript_id_section_title_key" ON "TranscriptSectionVideos"("transcript_id", "section_title");

-- AddForeignKey
ALTER TABLE "TranscriptSectionVideos" ADD CONSTRAINT "TranscriptSectionVideos_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
