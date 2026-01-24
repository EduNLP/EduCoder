-- CreateTable
CREATE TABLE "TranscriptLines" (
    "line_id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "speaker" TEXT,
    "utterance" TEXT,
    "segment" TEXT,

    CONSTRAINT "TranscriptLines_pkey" PRIMARY KEY ("line_id")
);

-- AddForeignKey
ALTER TABLE "TranscriptLines" ADD CONSTRAINT "TranscriptLines_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
