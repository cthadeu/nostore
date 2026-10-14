import { AppError } from './domain.ts';

// Thin client for the Melhor Envio API (OAuth, quotes, cart, purchase, labels, tracking). No SDK:
// plain fetch, injectable for tests. Amounts come and go as strings in BRL; we keep cents internally.
export interface MeSettings { clientId: string; clientSecret: string; env: 'sandbox' | 'production'; userAgent: string; apiBase?: string }
export interface MeTokens { token_type?: string; expires_in: number; access_token: string; refresh_token?: string }
export interface MeQuote { serviceId: number; name: string; carrier: string; carrierId: number; priceCents: number; deliveryDays: number; deliveryRange?: { min: number; max: number } }
export interface MeParcel { widthCm: number; heightCm: number; lengthCm: number; weightGrams: number; insuranceCents: number }
export interface MeParty { name: string; phone: string; email: string; document: string; address: string; number: string; complement?: string; district: string; city: string; state: string; postalCode: string }
export interface MeCartInput { serviceId: number; agencyId?: number; from: MeParty; to: MeParty; product: { name: string; priceCents: number }; parcel: MeParcel }
export interface MeTracking { id: string; protocol?: string; status: string; tracking?: string | null; melhorenvio_tracking?: string | null; posted_at?: string | null; delivered_at?: string | null; canceled_at?: string | null; expired_at?: string | null; generated_at?: string | null }

export const SCOPES = ['cart-read', 'cart-write', 'companies-read', 'shipping-calculate', 'shipping-cancel', 'shipping-checkout', 'shipping-companies', 'shipping-generate', 'shipping-preview', 'shipping-print', 'shipping-share', 'shipping-tracking', 'users-read', 'orders-read', 'purchases-read'];
const toCents = (value: unknown) => Math.round(Number(value) * 100);
const money = (cents: number) => (Math.round(cents) / 100).toFixed(2);
const onlyDigits = (value: string) => value.replace(/\D/g, '');

// Maps the carrier status vocabulary to the shipment states the platform shows.
export function mapTrackingStatus(status: string): 'purchased' | 'generated' | 'posted' | 'delivered' | 'canceled' | 'failed' | null {
  switch (status) {
    case 'pending': case 'paid': case 'released': return 'purchased';
    case 'generated': return 'generated';
    case 'posted': case 'shipping': case 'in_transit': return 'posted';
    case 'delivered': return 'delivered';
    case 'canceled': case 'cancelled': case 'expired': return 'canceled';
    case 'undelivered': case 'returned': return 'failed';
    default: return null;
  }
}

export class MelhorEnvioClient {
  readonly host: string; readonly apiBase: string;
  private readonly settings: MeSettings; private readonly fetchImpl: typeof fetch;
  constructor(settings: MeSettings, fetchImpl: typeof fetch = fetch) {
    this.settings = settings; this.fetchImpl = fetchImpl;
    this.host = settings.env === 'sandbox' ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br';
    this.apiBase = (settings.apiBase ?? `${this.host}/api/v2`).replace(/\/$/, '');
  }
  authorizationUrl(redirectUri: string, state: string) {
    const params = new URLSearchParams({ client_id: this.settings.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), state });
    return `${this.host}/oauth/authorize?${params}`;
  }
  exchangeCode(code: string, redirectUri: string) {
    return this.request<MeTokens>('POST', `${this.host}/oauth/token`, { grant_type: 'authorization_code', client_id: this.settings.clientId, client_secret: this.settings.clientSecret, redirect_uri: redirectUri, code });
  }
  refreshToken(refreshToken: string) {
    return this.request<MeTokens>('POST', `${this.host}/oauth/token`, { grant_type: 'refresh_token', client_id: this.settings.clientId, client_secret: this.settings.clientSecret, refresh_token: refreshToken });
  }
  // Quotes for one unit of a product; services the carriers cannot take (size, weight, route) are dropped.
  async calculate(accessToken: string, input: { fromPostalCode: string; toPostalCode: string; productId: string; parcel: MeParcel }): Promise<MeQuote[]> {
    const body = {
      from: { postal_code: onlyDigits(input.fromPostalCode) }, to: { postal_code: onlyDigits(input.toPostalCode) },
      products: [{ id: input.productId, width: input.parcel.widthCm, height: input.parcel.heightCm, length: input.parcel.lengthCm, weight: input.parcel.weightGrams / 1000, insurance_value: Number(money(input.parcel.insuranceCents)), quantity: 1 }],
      options: { receipt: false, own_hand: false },
    };
    const services = await this.request<Array<Record<string, unknown>>>('POST', `${this.apiBase}/me/shipment/calculate`, body, accessToken);
    return (Array.isArray(services) ? services : []).filter(s => !s.error && s.price !== undefined && s.price !== null).map(s => {
      const company = (s.company ?? {}) as { id?: number; name?: string };
      const range = s.delivery_range as { min?: number; max?: number } | undefined;
      return { serviceId: Number(s.id), name: String(s.name), carrier: String(company.name ?? ''), carrierId: Number(company.id ?? 0), priceCents: toCents(s.custom_price ?? s.price), deliveryDays: Number(s.custom_delivery_time ?? s.delivery_time ?? 0), deliveryRange: range?.min !== undefined && range?.max !== undefined ? { min: range.min, max: range.max } : undefined };
    }).filter(q => Number.isFinite(q.priceCents) && q.priceCents > 0);
  }
  insertCart(accessToken: string, input: MeCartInput) {
    const party = (p: MeParty) => ({ name: p.name, phone: onlyDigits(p.phone), email: p.email, document: p.document.length === 11 ? p.document : undefined, company_document: p.document.length === 14 ? p.document : undefined, address: p.address, number: p.number, complement: p.complement || undefined, district: p.district, city: p.city, state_abbr: p.state, country_id: 'BR', postal_code: onlyDigits(p.postalCode) });
    const body = {
      service: input.serviceId, ...(input.agencyId ? { agency: input.agencyId } : {}),
      from: party(input.from), to: party(input.to),
      products: [{ name: input.product.name.slice(0, 250), quantity: 1, unitary_value: money(input.product.priceCents) }],
      volumes: [{ height: input.parcel.heightCm, width: input.parcel.widthCm, length: input.parcel.lengthCm, weight: input.parcel.weightGrams / 1000 }],
      options: { insurance_value: money(input.parcel.insuranceCents), receipt: false, own_hand: false, reverse: false, non_commercial: true },
    };
    return this.request<{ id: string; protocol?: string; price?: string | number }>('POST', `${this.apiBase}/me/cart`, body, accessToken);
  }
  checkout(accessToken: string, orderIds: string[]) { return this.request<{ purchase?: { id?: string; protocol?: string; total?: string | number; status?: string } }>('POST', `${this.apiBase}/me/shipment/checkout`, { orders: orderIds }, accessToken); }
  generate(accessToken: string, orderIds: string[]) { return this.request<Record<string, { status: boolean; message?: string }>>('POST', `${this.apiBase}/me/shipment/generate`, { orders: orderIds }, accessToken); }
  print(accessToken: string, orderIds: string[]) { return this.request<{ url: string }>('POST', `${this.apiBase}/me/shipment/print`, { mode: 'private', orders: orderIds }, accessToken); }
  tracking(accessToken: string, orderIds: string[]) { return this.request<Record<string, MeTracking>>('POST', `${this.apiBase}/me/shipment/tracking`, { orders: orderIds }, accessToken); }
  cancel(accessToken: string, orderId: string, description: string) { return this.request<Record<string, { canceled?: boolean }>>('POST', `${this.apiBase}/me/shipment/cancel`, { order: { id: orderId, reason_id: '2', description: description.slice(0, 250) } }, accessToken); }
  agencies(accessToken: string, query: { companyId: number; state: string; city: string }) {
    const params = new URLSearchParams({ company: String(query.companyId), country: 'BR', state: query.state, city: query.city });
    return this.request<Array<{ id: number; name?: string }>>('GET', `${this.apiBase}/me/shipment/agencies?${params}`, undefined, accessToken);
  }
  private async request<T>(method: string, url: string, body?: unknown, accessToken?: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': this.settings.userAgent, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) };
    let response: Response;
    try { response = await this.fetchImpl(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25_000) }); }
    catch (error) { throw new MeError(`Melhor Envio unreachable: ${error instanceof Error ? error.message : String(error)}`, 0); }
    const text = await response.text();
    let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new MeError(`Melhor Envio ${method} ${url.replace(this.host, '')} -> ${response.status}: ${text.slice(0, 300)}`, response.status, data);
    return data as T;
  }
}
export class MeError extends Error {
  readonly status: number; readonly body: unknown;
  constructor(message: string, status: number, body: unknown = null) { super(message); this.status = status; this.body = body; }
}
// Melhor Envio validation errors arrive as { message, errors: { field: [..] } }; surface a readable line.
export function meErrorMessage(error: unknown): string {
  if (!(error instanceof MeError)) return error instanceof Error ? error.message : String(error);
  const body = error.body as { message?: string; errors?: Record<string, string[]>; error?: string } | null;
  const details = body?.errors ? Object.values(body.errors).flat().join(' ') : '';
  return [body?.message ?? body?.error, details].filter(Boolean).join(' ') || error.message;
}
export const mentionsAgency = (error: unknown) => /agency|ag[êe]ncia/i.test(meErrorMessage(error));
export const mentionsBalance = (error: unknown) => /saldo|balance|insufficient/i.test(meErrorMessage(error));
export function assertShippingError(error: unknown, fallback: string): never {
  if (mentionsBalance(error)) throw new AppError('SHIPPING_BALANCE', 'Saldo insuficiente na carteira Melhor Envio. Adicione créditos e tente de novo.', 409);
  throw new AppError('SHIPPING_ERROR', `${fallback} ${meErrorMessage(error)}`.trim(), 502);
}
