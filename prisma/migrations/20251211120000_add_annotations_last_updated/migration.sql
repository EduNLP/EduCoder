-- AlterTable
ALTER TABLE "Annotations"
    ADD COLUMN "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "gcs_path" SET NOT NULL;

-- Backfill existing rows and then remove the default to rely on Prisma's @updatedAt handling
UPDATE "Annotations" SET "last_updated" = CURRENT_TIMESTAMP WHERE "last_updated" IS NULL;
ALTER TABLE "Annotations" ALTER COLUMN "last_updated" DROP DEFAULT;

-- CreateTable
CREATE TABLE "TranscriptLineFlags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptLineFlags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptLineFlags_user_id_line_id_key" ON "TranscriptLineFlags"("user_id", "line_id");

-- AddForeignKey
ALTER TABLE "TranscriptLineFlags" ADD CONSTRAINT "TranscriptLineFlags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptLineFlags" ADD CONSTRAINT "TranscriptLineFlags_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "TranscriptLines"("line_id") ON DELETE CASCADE ON UPDATE CASCADE;
