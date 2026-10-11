export class AppError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
export function calculateFee(priceCents: number, basisPoints: number) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || priceCents > 100_000_000) throw new AppError('INVALID_PRICE', 'Valor inválido.');
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new AppError('INVALID_FEE', 'Taxa inválida.');
  const feeCents = Number((BigInt(priceCents) * BigInt(basisPoints) + 5000n) / 10000n);
  return { priceCents, feeCents, totalCents: priceCents + feeCents };
}
export function effectivePlan(seller: { plan: string; proUntil: Date | null }, now = new Date()) {
  return seller.plan === 'pro' && seller.proUntil && seller.proUntil > now ? 'pro' : 'free';
}
export function assertPublicationLimit(plan: string, count: number) {
  if (plan !== 'pro' && count >= 5) throw new AppError('PRODUCT_LIMIT', 'Você atingiu os 5 produtos ativos do plano Gratuito.', 409);
}
export function isValidDocument(value: string) {
  if (!/^\d{11}$|^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const nums = [...value].map(Number);
  for (let i = value.length - 2; i < value.length; i++) {
    const sum = nums.slice(0, i).reduce((total, digit, j) => total + digit * (value.length === 11 ? i + 1 - j : (i - 1 - j) % 8 + 2), 0);
    const remainder = sum % 11;
    if (nums[i] !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}
