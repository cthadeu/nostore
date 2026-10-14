-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCarrier" TEXT,
ADD COLUMN     "shippingCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingDeliveryDays" INTEGER,
ADD COLUMN     "shippingMode" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "shippingServiceId" INTEGER,
ADD COLUMN     "shippingServiceName" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "lengthCm" INTEGER,
ADD COLUMN     "shippingMode" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "widthCm" INTEGER;

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "meAccessTokenEncrypted" TEXT,
ADD COLUMN     "meConnectedAt" TIMESTAMP(3),
ADD COLUMN     "meRefreshTokenEncrypted" TEXT,
ADD COLUMN     "meTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "meUserId" TEXT,
ADD COLUMN     "originAddressEncrypted" TEXT,
ADD COLUMN     "originPhone" TEXT,
ADD COLUMN     "shippingStatus" TEXT NOT NULL DEFAULT 'not_connected';

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "meOrderId" TEXT,
    "meProtocol" TEXT,
    "carrier" TEXT,
    "service" TEXT,
    "trackingCode" TEXT,
    "labelUrl" TEXT,
    "priceCents" INTEGER,
    "error" TEXT,
    "postedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_meOrderId_key" ON "Shipment"("meOrderId");

-- CreateIndex
CREATE INDEX "Shipment_status_lastSyncAt_idx" ON "Shipment"("status", "lastSyncAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

