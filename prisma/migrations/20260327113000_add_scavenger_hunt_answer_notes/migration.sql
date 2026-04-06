CREATE TABLE "ScavengerHuntAnswerNotes" (
  "answer_id" UUID NOT NULL,
  "note_id" UUID NOT NULL,

  CONSTRAINT "ScavengerHuntAnswerNotes_pkey" PRIMARY KEY ("answer_id", "note_id")
);

ALTER TABLE "ScavengerHuntAnswerNotes"
ADD CONSTRAINT "ScavengerHuntAnswerNotes_answer_id_fkey"
FOREIGN KEY ("answer_id") REFERENCES "ScavengerHuntAnswers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScavengerHuntAnswerNotes"
ADD CONSTRAINT "ScavengerHuntAnswerNotes_note_id_fkey"
FOREIGN KEY ("note_id") REFERENCES "Notes"("note_id")
ON DELETE CASCADE ON UPDATE CASCADE;
