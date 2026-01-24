-- CreateTable
CREATE TABLE "NoteAssignments" (
    "note_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,

    CONSTRAINT "NoteAssignments_pkey" PRIMARY KEY ("note_id", "line_id")
);

-- AddForeignKey
ALTER TABLE "NoteAssignments" ADD CONSTRAINT "NoteAssignments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "Notes"("note_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAssignments" ADD CONSTRAINT "NoteAssignments_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "TranscriptLines"("line_id") ON DELETE CASCADE ON UPDATE CASCADE;
