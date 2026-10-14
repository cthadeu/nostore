import { Type } from '@sinclair/typebox';
export const AccessBody = Type.Object({ token: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false });
export const FeeResponse = Type.Object({ id: Type.String(), basisPoints: Type.Integer(), createdAt: Type.String() });
export const OrderResponse = Type.Object({
  id: Type.String(), productName: Type.String(), productType: Type.String(), status: Type.String(), gateway: Type.String(), method: Type.String(),
  priceCents: Type.Integer(), feeCents: Type.Integer(), totalCents: Type.Integer(), createdAt: Type.String(), expiresAt: Type.String(), downloadable: Type.Boolean(),
  statusDetail: Type.Union([Type.String(), Type.Null()]),
  shippingCents: Type.Integer(), shippingMode: Type.String(),
  shipping: Type.Union([Type.Object({ serviceId: Type.Union([Type.Integer(), Type.Null()]), service: Type.Union([Type.String(), Type.Null()]), carrier: Type.Union([Type.String(), Type.Null()]), deliveryDays: Type.Union([Type.Integer(), Type.Null()]) }), Type.Null()]),
  shipment: Type.Union([Type.Object({ mode: Type.String(), status: Type.String(), carrier: Type.Union([Type.String(), Type.Null()]), service: Type.Union([Type.String(), Type.Null()]), trackingCode: Type.Union([Type.String(), Type.Null()]), trackingUrl: Type.Union([Type.String(), Type.Null()]), labelUrl: Type.Union([Type.String(), Type.Null()]), postedAt: Type.Union([Type.String(), Type.Null()]), deliveredAt: Type.Union([Type.String(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]) }), Type.Null()]),
  pix: Type.Union([Type.Object({ qrCode: Type.String(), qrCodeBase64: Type.Union([Type.String(), Type.Null()]), ticketUrl: Type.Union([Type.String(), Type.Null()]), expiresAt: Type.Union([Type.String(), Type.Null()]) }), Type.Null()]),
});
export const CardInput = Type.Object({ token: Type.String({ minLength: 8, maxLength: 128 }), paymentMethodId: Type.String({ minLength: 1, maxLength: 40 }), issuerId: Type.Optional(Type.String({ maxLength: 40 })) }, { additionalProperties: false });
export const Address = Type.Object({
  postalCode: Type.String({ pattern: '^\\d{8}$' }), street: Type.String({ minLength: 2, maxLength: 150 }), number: Type.String({ minLength: 1, maxLength: 20 }),
  complement: Type.Optional(Type.String({ maxLength: 100 })), district: Type.String({ minLength: 2, maxLength: 100 }), city: Type.String({ minLength: 2, maxLength: 100 }),
  state: Type.String({ pattern: '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$' }),
}, { additionalProperties: false });
export const CheckoutInput = Type.Object({
  productId: Type.String({ format: 'uuid' }), productVersion: Type.String(), feePolicyId: Type.String({ format: 'uuid' }),
  checkoutToken: Type.String({ pattern: '^[a-f0-9]{64}$' }), buyerName: Type.String({ minLength: 2, maxLength: 100 }),
  buyerEmail: Type.String({ format: 'email', maxLength: 254 }), buyerDocument: Type.String({ pattern: '^\\d{11}$|^\\d{14}$' }),
  method: Type.Union([Type.Literal('pix'), Type.Literal('card')]), address: Type.Optional(Address), acceptSimulation: Type.Optional(Type.Literal(true)), card: Type.Optional(CardInput),
  shippingServiceId: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });
