-- CreateTable
CREATE TABLE "ProductFile" (
    "productId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProductFile_pkey" PRIMARY KEY ("productId","assetId")
);

-- CreateTable
CREATE TABLE "OrderFile" (
    "orderId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "OrderFile_pkey" PRIMARY KEY ("orderId","assetId")
);

-- CreateIndex
CREATE INDEX "ProductFile_assetId_idx" ON "ProductFile"("assetId");

-- CreateIndex
CREATE INDEX "OrderFile_assetId_idx" ON "OrderFile"("assetId");

-- AddForeignKey
ALTER TABLE "ProductFile" ADD CONSTRAINT "ProductFile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFile" ADD CONSTRAINT "ProductFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFile" ADD CONSTRAINT "OrderFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFile" ADD CONSTRAINT "OrderFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing single file becomes a one-item bundle, orders keep their purchased file.
INSERT INTO "ProductFile" ("productId", "assetId", "position")
SELECT "id", "digitalAssetId", 0 FROM "Product" WHERE "digitalAssetId" IS NOT NULL;
INSERT INTO "OrderFile" ("orderId", "assetId", "position")
SELECT "id", "digitalAssetId", 0 FROM "Order" WHERE "digitalAssetId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_digitalAssetId_fkey";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "digitalAssetId";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "digitalAssetId";
