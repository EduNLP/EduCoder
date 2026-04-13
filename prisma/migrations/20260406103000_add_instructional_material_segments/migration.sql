-- CreateTable
CREATE TABLE "InstructionalMaterialSegments" (
    "material_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructionalMaterialSegments_pkey" PRIMARY KEY ("material_id", "segment_id")
);

-- CreateIndex
CREATE INDEX "InstructionalMaterialSegments_segment_id_idx" ON "InstructionalMaterialSegments"("segment_id");

-- AddForeignKey
ALTER TABLE "InstructionalMaterialSegments" ADD CONSTRAINT "InstructionalMaterialSegments_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "InstructionalMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructionalMaterialSegments" ADD CONSTRAINT "InstructionalMaterialSegments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "TranscriptSegments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
