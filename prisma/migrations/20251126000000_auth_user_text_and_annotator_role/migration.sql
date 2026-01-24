-- AlterEnum
DO $$
BEGIN
    ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'annotator';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END$$;

-- AlterTable
ALTER TABLE "User"
ALTER COLUMN "auth_user_id" TYPE TEXT USING "auth_user_id"::text;

