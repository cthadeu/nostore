import { Type } from '@sinclair/typebox';
export const ErrorResponse = Type.Object({ code: Type.String(), message: Type.String(), requestId: Type.String() });
export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
export const ProductInput = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 120 }),
  description: Type.String({ minLength: 10, maxLength: 5000 }),
  priceCents: Type.Integer({ minimum: 1, maximum: 100_000_000 }),
  type: Type.Union([Type.Literal('digital'), Type.Literal('physical')]),
  paymentMethods: Type.Array(Type.Union([Type.Literal('pix'), Type.Literal('card')]), { minItems: 1, maxItems: 2, uniqueItems: true }),
  imageAssetId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  digitalAssetIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 })),
  stampBuyer: Type.Optional(Type.Boolean()),
  shippingDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 90 }), Type.Null()])),
}, { additionalProperties: false });
export const ProductResponse = Type.Object({
  id: Type.String(), publicId: Type.String(), name: Type.String(), description: Type.String(), priceCents: Type.Integer(), type: Type.String(), status: Type.String(),
  paymentMethods: Type.Array(Type.String()), imageAssetId: Type.Union([Type.String(), Type.Null()]), digitalAssetIds: Type.Array(Type.String()), digitalFiles: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), size: Type.Integer() })), stampBuyer: Type.Boolean(), shippingDays: Type.Union([Type.Integer(), Type.Null()]), updatedAt: Type.String(),
});
export const MessageResponse = Type.Object({ message: Type.String() });
