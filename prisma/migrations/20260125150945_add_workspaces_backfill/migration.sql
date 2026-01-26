-- CreateTable
CREATE TABLE "Workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspaces_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "workspace_id" UUID;

-- AlterTable
ALTER TABLE "Transcripts" ADD COLUMN "workspace_id" UUID;

-- Backfill
INSERT INTO "Workspaces" ("id", "name", "createdAt")
VALUES ('61d0f1ee-c2e4-4966-bb3f-863b735a1150', 'Default Workspace', CURRENT_TIMESTAMP);

UPDATE "User"
SET "workspace_id" = '61d0f1ee-c2e4-4966-bb3f-863b735a1150'
WHERE "workspace_id" IS NULL;

UPDATE "Transcripts"
SET "workspace_id" = '61d0f1ee-c2e4-4966-bb3f-863b735a1150'
WHERE "workspace_id" IS NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "workspace_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "Transcripts" ALTER COLUMN "workspace_id" SET NOT NULL;

-- DropIndex
DROP INDEX "User_username_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_workspace_id_username_key" ON "User"("workspace_id", "username");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcripts" ADD CONSTRAINT "Transcripts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
