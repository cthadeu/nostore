CREATE TABLE "BuyerSession" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orderId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BuyerSession_tokenHash_key" ON "BuyerSession"("tokenHash");
CREATE INDEX "BuyerSession_expiresAt_idx" ON "BuyerSession"("expiresAt");
