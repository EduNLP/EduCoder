/*
  Warnings:

  - You are about to drop the `TranscriptLineFlags` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TranscriptLineFlags" DROP CONSTRAINT "TranscriptLineFlags_line_id_fkey";

-- DropForeignKey
ALTER TABLE "TranscriptLineFlags" DROP CONSTRAINT "TranscriptLineFlags_user_id_fkey";

-- AlterTable
ALTER TABLE "FlagAssignments" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "NoteAssignments" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Notes" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropTable
DROP TABLE "TranscriptLineFlags";
