-- Freight is part of the order total: total = product + platform fee + shipping.
ALTER TABLE "Order" DROP CONSTRAINT "order_amounts";
ALTER TABLE "Order" ADD CONSTRAINT "order_amounts" CHECK ("priceCents" > 0 AND "feeCents" >= 0 AND "shippingCents" >= 0 AND "totalCents" = "priceCents" + "feeCents" + "shippingCents");
