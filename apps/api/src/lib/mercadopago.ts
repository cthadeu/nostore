import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './domain.ts';
import type { PaymentStatus } from './gateway.ts';

// Thin client for the Mercado Pago APIs used by the marketplace integration: OAuth (seller linking),
// Payments (Pix and card with application_fee) and webhook signature validation. No SDK: plain fetch,
// injectable for tests.
export interface MpSettings { clientId: string; clientSecret: string; webhookSecret?: string; apiBase?: string; authBase?: string }
export type MpPaymentStatus = 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back';
export interface MpPayment {
  id: number; status: MpPaymentStatus; status_detail?: string; external_reference?: string; date_of_expiration?: string; transaction_amount?: number;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
}
export interface MpTokens { access_token: string; refresh_token?: string; expires_in: number; user_id: number; public_key?: string; live_mode?: boolean }
export interface MpPaymentInput {
  amountCents: number; feeCents: number; description: string; orderId: string; notificationUrl: string; expiresAt: Date;
  payer: { email: string; name: string; document: string };
  method: 'pix' | 'card';
  card?: { token: string; paymentMethodId: string; issuerId?: string };
}

export const mapPaymentStatus = (status: MpPaymentStatus): PaymentStatus =>
  status === 'approved' || status === 'authorized' ? 'paid'
  : status === 'rejected' || status === 'cancelled' ? 'rejected'
  : status === 'refunded' || status === 'charged_back' ? 'refunded'
  : 'pending';

// Mercado Pago expects ISO 8601 with an explicit UTC offset, e.g. 2026-10-12T00:00:00.000-03:00.
export function isoWithOffset(date: Date, offsetMinutes = -180) {
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+', abs = Math.abs(offsetMinutes);
  return `${local.toISOString().slice(0, -1)}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const cents = (value: number) => Math.round(value) / 100;
const splitName = (name: string) => { const parts = name.trim().split(/\s+/); return { first: parts[0] ?? name, last: parts.slice(1).join(' ') || parts[0] || name }; };

export class MercadoPagoClient {
  readonly apiBase: string; readonly authBase: string;
  private readonly settings: MpSettings; private readonly fetchImpl: typeof fetch;
  constructor(settings: MpSettings, fetchImpl: typeof fetch = fetch) {
    this.settings = settings; this.fetchImpl = fetchImpl;
    this.apiBase = (settings.apiBase ?? 'https://api.mercadopago.com').replace(/\/$/, '');
    this.authBase = (settings.authBase ?? 'https://auth.mercadopago.com').replace(/\/$/, '');
  }
  authorizationUrl(redirectUri: string, state: string) {
    const params = new URLSearchParams({ client_id: this.settings.clientId, response_type: 'code', platform_id: 'mp', state, redirect_uri: redirectUri });
    return `${this.authBase}/authorization?${params}`;
  }
  exchangeCode(code: string, redirectUri: string) {
    return this.request<MpTokens>('POST', '/oauth/token', { client_id: this.settings.clientId, client_secret: this.settings.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }
  refreshToken(refreshToken: string) {
    return this.request<MpTokens>('POST', '/oauth/token', { client_id: this.settings.clientId, client_secret: this.settings.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken });
  }
  // Created with the seller's token; application_fee is the marketplace commission kept by nostore.
  createPayment(accessToken: string, input: MpPaymentInput, idempotencyKey: string) {
    const { first, last } = splitName(input.payer.name);
    const body: Record<string, unknown> = {
      transaction_amount: cents(input.amountCents), description: input.description.slice(0, 250),
      // Mercado Pago rejects a zero application_fee: only send the marketplace share when there is one.
      ...(input.feeCents > 0 ? { application_fee: cents(input.feeCents) } : {}),
      external_reference: input.orderId, notification_url: input.notificationUrl, statement_descriptor: 'NOSTORE', metadata: { order_id: input.orderId },
      payer: { email: input.payer.email, first_name: first, last_name: last, identification: { type: input.payer.document.length === 14 ? 'CNPJ' : 'CPF', number: input.payer.document } },
    };
    if (input.method === 'pix') Object.assign(body, { payment_method_id: 'pix', date_of_expiration: isoWithOffset(input.expiresAt) });
    else {
      if (!input.card) throw new AppError('CARD_REQUIRED', 'Informe os dados do cartão.');
      Object.assign(body, { token: input.card.token, payment_method_id: input.card.paymentMethodId, installments: 1, binary_mode: true, ...(input.card.issuerId ? { issuer_id: Number(input.card.issuerId) } : {}) });
    }
    return this.request<MpPayment>('POST', '/v1/payments', body, { accessToken, idempotencyKey });
  }
  getPayment(accessToken: string, id: string) { return this.request<MpPayment>('GET', `/v1/payments/${encodeURIComponent(id)}`, undefined, { accessToken }); }
  refundPayment(accessToken: string, id: string, idempotencyKey: string) { return this.request<unknown>('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`, {}, { accessToken, idempotencyKey }); }

  // x-signature: "ts=...,v1=<hmac>"; manifest "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" signed with the webhook secret.
  verifyWebhookSignature(input: { signature?: string; requestId?: string; dataId?: string }, maxAgeSeconds = 10 * 60) {
    const secret = this.settings.webhookSecret;
    if (!secret || !input.signature || !input.requestId || !input.dataId) return false;
    const parts = Object.fromEntries(input.signature.split(',').map(p => p.trim().split('=') as [string, string]));
    const ts = parts.ts, v1 = parts.v1;
    if (!ts || !v1 || !/^\d+$/.test(ts)) return false;
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts) / (ts.length > 10 ? 1000 : 1));
    if (ageSeconds > maxAgeSeconds) return false;
    const dataId = /^[a-zA-Z0-9]+$/.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
    const expected = createHmac('sha256', secret).update(`id:${dataId};request-id:${input.requestId};ts:${ts};`).digest('hex');
    return expected.length === v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  }

  private async request<T>(method: string, path: string, body?: unknown, options: { accessToken?: string; idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}), ...(options.idempotencyKey ? { 'x-idempotency-key': options.idempotencyKey } : {}) };
    let response: Response;
    try { response = await this.fetchImpl(`${this.apiBase}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) }); }
    catch (error) { throw new MpError(`Mercado Pago unreachable: ${error instanceof Error ? error.message : String(error)}`, 0); }
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (!response.ok) throw new MpError(`Mercado Pago ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`, response.status, data);
    return data as T;
  }
}
export class MpError extends Error {
  readonly status: number; readonly body: unknown;
  constructor(message: string, status: number, body: unknown = null) { super(message); this.status = status; this.body = body; }
}
// Mercado Pago error bodies carry a "cause" list with numeric codes (e.g. 2059: application_fee not allowed).
export function mpErrorCode(error: unknown, code: number): boolean {
  const body = error instanceof MpError ? error.body as { cause?: { code?: number | string }[] } | null : null;
  return Boolean(body?.cause?.some(c => Number(c.code) === code));
}
const safeJson = (text: string) => { try { return JSON.parse(text) as unknown; } catch { return text; } };
