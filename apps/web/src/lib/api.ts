export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = document.cookie.split('; ').find((value) => value.startsWith('nostore_csrf='))?.split('=')[1];
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers: { ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.message ?? 'Não foi possível conectar. Tente novamente.', response.status);
  return body as T;
}
export const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
export interface Profile { id: string; name: string; email: string; displayName: string; personType: 'individual' | 'business'; documentLast4: string | null; emailVerified: boolean; plan: string; gatewayStatus: string; paymentGateway: string; isAdmin: boolean }
export interface Product { id: string; publicId: string; name: string; description: string; priceCents: number; type: 'digital' | 'physical'; status: string; paymentMethods: string[]; imageAssetId: string | null; digitalAssetIds: string[]; digitalFiles: { id: string; name: string; size: number }[]; stampBuyer: boolean }

export interface Order { id: string; productName: string; productType: string; status: string; gateway: string; method: string; priceCents: number; feeCents: number; totalCents: number; createdAt: string; expiresAt: string; downloadable: boolean; buyerName?: string; buyerEmail?: string; address?: Record<string, string> | null }
export const orderLabels: Record<string, string> = { pending: 'Aguardando pagamento', paid: 'Pago', rejected: 'Recusado', refunded: 'Reembolsado', expired: 'Expirado' };
