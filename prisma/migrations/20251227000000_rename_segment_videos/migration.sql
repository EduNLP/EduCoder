ALTER TABLE "TranscriptSectionVideos" RENAME TO "SegmentVideos";

ALTER TABLE "SegmentVideos"
  RENAME CONSTRAINT "TranscriptSectionVideos_pkey" TO "SegmentVideos_pkey";

ALTER INDEX "TranscriptSectionVideos_transcript_id_section_title_key"
  RENAME TO "SegmentVideos_transcript_id_section_title_key";

ALTER TABLE "SegmentVideos"
  RENAME CONSTRAINT "TranscriptSectionVideos_transcript_id_fkey" TO "SegmentVideos_transcript_id_fkey";
