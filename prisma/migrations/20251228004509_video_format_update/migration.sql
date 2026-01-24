/*
  Warnings:

  - You are about to alter the column `start_time` on the `TranscriptSegments` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.
  - You are about to alter the column `end_time` on the `TranscriptSegments` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "TranscriptSegments" ALTER COLUMN "start_time" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "end_time" SET DATA TYPE DECIMAL(10,2);
