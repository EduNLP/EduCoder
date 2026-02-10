-- CreateTable
CREATE TABLE "ScavengerHunts" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "scavenger_visibility_admin" "LLMAnnotationVisibilityAdmin" NOT NULL DEFAULT 'hidden',
    "scavenger_visibility_user" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScavengerHunts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScavengerHuntAssignments" (
    "id" UUID NOT NULL,
    "scavenger_id" UUID NOT NULL,
    "created_for" UUID NOT NULL,
    "scavenger_completed" BOOLEAN NOT NULL DEFAULT false,
    "scavenger_visibility_admin" "LLMAnnotationVisibilityAdmin" NOT NULL DEFAULT 'hidden',
    "scavenger_visibility_user" BOOLEAN NOT NULL DEFAULT true,
    "assigned_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScavengerHuntAssignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScavengerHuntQuestions" (
    "id" UUID NOT NULL,
    "scavenger_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "ScavengerHuntQuestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScavengerHuntAnswers" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScavengerHuntAnswers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScavengerHuntAnswerLines" (
    "answer_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,

    CONSTRAINT "ScavengerHuntAnswerLines_pkey" PRIMARY KEY ("answer_id","line_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScavengerHunts_transcript_id_key" ON "ScavengerHunts"("transcript_id");

-- CreateIndex
CREATE UNIQUE INDEX "ScavengerHuntAssignments_scavenger_id_created_for_key" ON "ScavengerHuntAssignments"("scavenger_id", "created_for");

-- CreateIndex
CREATE UNIQUE INDEX "ScavengerHuntQuestions_scavenger_id_order_index_key" ON "ScavengerHuntQuestions"("scavenger_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "ScavengerHuntAnswers_assignment_id_question_id_key" ON "ScavengerHuntAnswers"("assignment_id", "question_id");

-- AddForeignKey
ALTER TABLE "ScavengerHunts" ADD CONSTRAINT "ScavengerHunts_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntAssignments" ADD CONSTRAINT "ScavengerHuntAssignments_scavenger_id_fkey" FOREIGN KEY ("scavenger_id") REFERENCES "ScavengerHunts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntAssignments" ADD CONSTRAINT "ScavengerHuntAssignments_created_for_fkey" FOREIGN KEY ("created_for") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntQuestions" ADD CONSTRAINT "ScavengerHuntQuestions_scavenger_id_fkey" FOREIGN KEY ("scavenger_id") REFERENCES "ScavengerHunts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntAnswers" ADD CONSTRAINT "ScavengerHuntAnswers_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "ScavengerHuntAssignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntAnswers" ADD CONSTRAINT "ScavengerHuntAnswers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "ScavengerHuntQuestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntAnswerLines" ADD CONSTRAINT "ScavengerHuntAnswerLines_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "ScavengerHuntAnswers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengerHuntAnswerLines" ADD CONSTRAINT "ScavengerHuntAnswerLines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "TranscriptLines"("line_id") ON DELETE CASCADE ON UPDATE CASCADE;
