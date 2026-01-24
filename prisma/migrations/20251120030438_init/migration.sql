-- CreateEnum
CREATE TYPE "AnnotationStatus" AS ENUM ('not_started', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcripts" (
    "id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instruction_context" TEXT NOT NULL,
    "gcs_path" TEXT NOT NULL,
    "upload_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "llm_transcript" BOOLEAN NOT NULL DEFAULT false,
    "llm_transcript_gcs_path" TEXT,
    "instructional_material_link" TEXT,

    CONSTRAINT "Transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructionalMaterial" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "gcs_path" TEXT NOT NULL,
    "image_title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructionalMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotations" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "created_for" UUID NOT NULL,
    "gcs_path" TEXT NOT NULL,
    "status" "AnnotationStatus" NOT NULL DEFAULT 'not_started',
    "upload_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Transcripts" ADD CONSTRAINT "Transcripts_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructionalMaterial" ADD CONSTRAINT "InstructionalMaterial_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotations" ADD CONSTRAINT "Annotations_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "Transcripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotations" ADD CONSTRAINT "Annotations_created_for_fkey" FOREIGN KEY ("created_for") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
