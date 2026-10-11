ALTER TABLE "FeePolicy" ADD COLUMN "createdBy" UUID;

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "digitalAssetId" UUID,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerDocumentEncrypted" TEXT NOT NULL,
    "addressEncrypted" TEXT,
    "priceCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "feeBasisPoints" INTEGER NOT NULL,
    "feePolicyId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gateway" TEXT NOT NULL,
    "checkoutKeyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "downloadUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadTicket" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "DownloadTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutKeyHash_key" ON "Order"("checkoutKeyHash");

-- CreateIndex
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_sellerId_status_idx" ON "Order"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_orderId_key" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_reference_key" ON "PaymentAttempt"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_tokenHash_key" ON "AccessGrant"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadTicket_tokenHash_key" ON "DownloadTicket"("tokenHash");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_feePolicyId_fkey" FOREIGN KEY ("feePolicyId") REFERENCES "FeePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadTicket" ADD CONSTRAINT "DownloadTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FeePolicy" (id, "basisPoints") VALUES ('00000000-0000-4000-8000-000000000001', 0);
ALTER TABLE "FeePolicy" ADD CONSTRAINT "fee_range" CHECK ("basisPoints" BETWEEN 0 AND 10000);
ALTER TABLE "Order" ADD CONSTRAINT "order_amounts" CHECK ("priceCents" > 0 AND "feeCents" >= 0 AND "totalCents" = "priceCents" + "feeCents");
ALTER TABLE "Order" ADD CONSTRAINT "order_status" CHECK (status IN ('pending', 'paid', 'rejected', 'refunded'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_digitalAssetId_fkey" FOREIGN KEY ("digitalAssetId") REFERENCES "Asset"(id) ON DELETE RESTRICT;
