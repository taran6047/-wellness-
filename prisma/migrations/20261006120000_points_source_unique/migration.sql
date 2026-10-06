-- DropIndex
DROP INDEX "PointsEvent_userId_idx";

-- AlterTable
ALTER TABLE "PointsEvent" ADD COLUMN     "date" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PointsEvent_userId_sourceType_date_idx" ON "PointsEvent"("userId", "sourceType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PointsEvent_sourceType_sourceId_key" ON "PointsEvent"("sourceType", "sourceId");
