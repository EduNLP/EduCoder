-- CreateTable
CREATE TABLE "FlagAssignments" (
    "user_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,

    CONSTRAINT "FlagAssignments_pkey" PRIMARY KEY ("user_id", "line_id")
);

-- AddForeignKey
ALTER TABLE "FlagAssignments" ADD CONSTRAINT "FlagAssignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagAssignments" ADD CONSTRAINT "FlagAssignments_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "TranscriptLines"("line_id") ON DELETE CASCADE ON UPDATE CASCADE;
