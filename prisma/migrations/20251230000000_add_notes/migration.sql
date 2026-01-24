-- CreateTable
CREATE TABLE "Notes" (
    "note_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "note_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "q1" TEXT NOT NULL,
    "q2" TEXT NOT NULL,
    "q3" TEXT NOT NULL,

    CONSTRAINT "Notes_pkey" PRIMARY KEY ("note_id")
);

-- AddForeignKey
ALTER TABLE "Notes" ADD CONSTRAINT "Notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notes" ADD CONSTRAINT "Notes_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
