-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "pixExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pixQrCode" TEXT,
ADD COLUMN     "pixQrCodeBase64" TEXT,
ADD COLUMN     "pixTicketUrl" TEXT,
ADD COLUMN     "providerPaymentId" TEXT,
ADD COLUMN     "statusDetail" TEXT;

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "mpAccessTokenEncrypted" TEXT,
ADD COLUMN     "mpConnectedAt" TIMESTAMP(3),
ADD COLUMN     "mpPublicKey" TEXT,
ADD COLUMN     "mpRefreshTokenEncrypted" TEXT,
ADD COLUMN     "mpTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "mpUserId" TEXT;

-- CreateTable
CREATE TABLE "GatewayEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "action" TEXT,
    "resourceId" TEXT,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GatewayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GatewayEvent_provider_resourceId_idx" ON "GatewayEvent"("provider", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayEvent_provider_requestId_key" ON "GatewayEvent"("provider", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerPaymentId_key" ON "PaymentAttempt"("providerPaymentId");

