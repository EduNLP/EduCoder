/*
  Warnings:

  - You are about to drop the column `scavenger_status` on the `Annotations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Annotations" DROP COLUMN "scavenger_status",
ADD COLUMN     "annotation_completed" BOOLEAN NOT NULL DEFAULT false;
