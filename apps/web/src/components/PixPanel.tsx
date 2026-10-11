import { useState } from 'react';
import { Button } from '@heroui/react/button';
import type { Order } from '../lib/api';

// Pix instructions while an order is pending: QR Code image, copy-and-paste code and expiry.
export function PixPanel({ order }: { order: Order }) {
  const [copied, setCopied] = useState(false);
  const pix = order.pix;
  if (!pix) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(pix!.qrCode); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  }
  return <section className="pix-panel" aria-live="polite">
    <h2>Pague com Pix</h2>
    <p>Abra o app do seu banco, escolha pagar com Pix e leia o código. A confirmação chega em segundos e esta página atualiza sozinha.</p>
    {pix.qrCodeBase64 ? <img className="pix-qr" src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code do Pix" width={220} height={220}/> : null}
    <label className="field"><span>Pix copia e cola</span><textarea readOnly rows={4} value={pix.qrCode} onFocus={e => e.currentTarget.select()}/></label>
    <div className="order-actions"><Button onPress={copy}>{copied ? 'Código copiado' : 'Copiar código Pix'}</Button>{pix.ticketUrl ? <a className="button button--outline" href={pix.ticketUrl} target="_blank" rel="noreferrer">Abrir no Mercado Pago</a> : null}</div>
    {pix.expiresAt ? <p className="quiet">Válido até {new Date(pix.expiresAt).toLocaleString('pt-BR')}.</p> : null}
  </section>;
}
