import { AppError } from './domain.ts';
import type { Config } from './config.ts';

export type PaymentStatus = 'pending' | 'paid' | 'rejected' | 'refunded';
export interface PaymentGateway {
  name: string;
  create(input: { orderId: string; totalCents: number; sellerCents: number; feeCents: number; method: string }): { reference: string; status: PaymentStatus };
  simulate(current: string, outcome: 'paid' | 'rejected' | 'refunded'): PaymentStatus;
}
// This adapter never makes a charge or creates a payable Pix code.
const simulatedGateway: PaymentGateway = {
  name: 'simulated',
  create: ({ orderId }) => ({ reference: `simulated-${orderId}`, status: 'pending' }),
  simulate(current, outcome) {
    if (current === outcome) return outcome;
    if ((current === 'pending' && (outcome === 'paid' || outcome === 'rejected')) || (current === 'paid' && outcome === 'refunded')) return outcome;
    throw new AppError('INVALID_TRANSITION', 'Essa alteração não é permitida para o pagamento atual.', 409);
  },
};
export function gatewayFor(config: Config): PaymentGateway {
  if (config.paymentGateway !== 'simulated' || (config.production && !config.allowSimulatedPayments)) throw new AppError('GATEWAY_UNAVAILABLE', 'O checkout está indisponível neste ambiente.', 409);
  return simulatedGateway;
}
