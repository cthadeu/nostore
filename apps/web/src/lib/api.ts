export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export const csrfToken = () => document.cookie.split('; ').find((value) => value.startsWith('nostore_csrf='))?.split('=')[1];
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = csrfToken();
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers: { ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.message ?? 'Não foi possível conectar. Tente novamente.', response.status);
  return body as T;
}
export const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
export interface Profile { id: string; name: string; email: string; displayName: string; personType: 'individual' | 'business'; documentLast4: string | null; emailVerified: boolean; plan: string; gatewayStatus: string; gatewayAccount: string | null; paymentGateway: string; shippingStatus: string; shippingEnabled: boolean; hasOrigin: boolean; isAdmin: boolean }
export interface Shipment { mode: string; status: string; carrier: string | null; service: string | null; trackingCode: string | null; trackingUrl: string | null; labelUrl: string | null; postedAt: string | null; deliveredAt: string | null; error: string | null }
export interface ShippingQuote { serviceId: number; name: string; carrier: string; priceCents: number; deliveryDays: number }
export const shipmentLabels: Record<string, string> = { pending: 'Aguardando etiqueta', purchased: 'Etiqueta comprada', generated: 'Etiqueta pronta', posted: 'Postado', delivered: 'Entregue', canceled: 'Etiqueta cancelada', failed: 'Falha no envio' };
export interface Product { id: string; publicId: string; name: string; description: string; priceCents: number; type: 'digital' | 'physical'; status: string; paymentMethods: string[]; imageAssetId: string | null; digitalAssetIds: string[]; digitalFiles: { id: string; name: string; size: number }[]; stampBuyer: boolean; shippingDays: number | null; shippingMode: 'manual' | 'melhorenvio'; weightGrams: number | null; widthCm: number | null; heightCm: number | null; lengthCm: number | null }

export interface Order { id: string; productName: string; productType: string; status: string; gateway: string; method: string; priceCents: number; feeCents: number; totalCents: number; createdAt: string; expiresAt: string; downloadable: boolean; statusDetail: string | null; shippingCents: number; shippingMode: string; shipping: { serviceId: number | null; service: string | null; carrier: string | null; deliveryDays: number | null } | null; shipment: Shipment | null; pix: { qrCode: string; qrCodeBase64: string | null; ticketUrl: string | null; expiresAt: string | null } | null; buyerName?: string; buyerEmail?: string; address?: Record<string, string> | null }
export const orderLabels: Record<string, string> = { pending: 'Aguardando pagamento', paid: 'Pago', rejected: 'Recusado', refunded: 'Reembolsado', expired: 'Expirado' };
