import { AppError } from './domain.ts';
import type { Config } from './config.ts';

export type PaymentStatus = 'pending' | 'paid' | 'rejected' | 'refunded';
export interface PaymentGateway {
  name: 'simulated' | 'mercadopago';
  /** Only the simulator lets the seller drive outcomes by hand. */
  simulate?(current: string, outcome: 'paid' | 'rejected' | 'refunded'): PaymentStatus;
}
export function assertTransition(current: string, next: PaymentStatus): PaymentStatus {
  if (current === next) return next;
  if ((current === 'pending' && (next === 'paid' || next === 'rejected')) || (current === 'paid' && next === 'refunded')) return next;
  throw new AppError('INVALID_TRANSITION', 'Essa alteração não é permitida para o pagamento atual.', 409);
}
// This adapter never makes a charge or creates a payable Pix code.
const simulatedGateway: PaymentGateway = { name: 'simulated', simulate: (current, outcome) => assertTransition(current, outcome) };
const mercadoPagoGateway: PaymentGateway = { name: 'mercadopago' };
export function gatewayFor(config: Config): PaymentGateway {
  if (config.paymentGateway === 'mercadopago') return mercadoPagoGateway;
  if (config.paymentGateway !== 'simulated' || (config.production && !config.allowSimulatedPayments)) throw new AppError('GATEWAY_UNAVAILABLE', 'O checkout está indisponível neste ambiente.', 409);
  return simulatedGateway;
}
