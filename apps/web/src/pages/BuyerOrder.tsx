import { useState } from 'react';
import type { FormEvent } from 'react';
import useSWR from 'swr';
import { Button } from '@heroui/react/button';
import { api, money, orderLabels } from '../lib/api';
import type { Order } from '../lib/api';
import { Brand, Field, Notice, Pending, Submit } from '../components/ui';
export default function BuyerOrder() {
  const [accessToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const { data: access, error: accessError } = useSWR(accessToken ? ['buyer-session', accessToken] : null, () => api('/buyer/session', { method: 'POST', body: JSON.stringify({ token: accessToken }) }), { revalidateOnFocus: false, revalidateOnReconnect: false, onSuccess: () => window.history.replaceState(null, '', window.location.pathname) });
  const { data: order, error: orderError, mutate } = useSWR<Order>(!accessToken || access ? '/buyer/order' : null, () => api('/buyer/order', { method: 'POST', body: '{}' }), { refreshInterval: data => data?.status === 'pending' ? 5000 : 15000 });
  const error = accessError ?? orderError;
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  async function download() {
    setPending(true); setActionError('');
    try { const result = await api<{ url: string }>('/buyer/download-ticket', { method: 'POST', body: '{}' }); window.location.assign(result.url); }
    catch (err) { setActionError((err as Error).message); } finally { setPending(false); }
  }
  async function renew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setActionError('');
    const form = new FormData(event.currentTarget);
    try { const result = await api<{ message: string }>('/buyer/renew-access', { method: 'POST', body: JSON.stringify({ orderId: form.get('orderId'), email: form.get('email') }) }); setMessage(result.message); }
    catch (err) { setActionError((err as Error).message); } finally { setPending(false); }
  }
  return <main className="narrow"><Brand/><Notice message="Ambiente de teste. Nenhum pagamento real é processado."/>
    {error ? <Notice error message={error.message}/> : accessToken && !order ? <Pending/> : null}
    {order ? <><span className="pill">{orderLabels[order.status] ?? order.status}</span><h1>{order.productName}</h1><p className="quiet">Pedido <span className="break-text">{order.id}</span></p><dl className="amounts"><div><dt>Produto</dt><dd>{money(order.priceCents)}</dd></div><div><dt>Taxa</dt><dd>{money(order.feeCents)}</dd></div><div className="total"><dt>Total simulado</dt><dd>{money(order.totalCents)}</dd></div></dl>
      {order.status === 'pending' ? <Notice message={`Aguardando aprovação do vendedor na tela Pedidos. ${order.method === 'pix' ? 'O Pix de teste não possui QR Code ou código pagável.' : 'Nenhum dado de cartão é necessário.'} Expira em ${new Date(order.expiresAt).toLocaleString('pt-BR')}.`}/> : null}
      {order.downloadable ? <Button isPending={pending} onPress={download}>Baixar produto digital</Button> : order.status === 'paid' ? <Notice message={order.productType === 'physical' ? 'Pagamento de teste aprovado. O vendedor tem acesso ao endereço para organizar o envio.' : 'O período de download terminou.'}/> : null}
      <Button variant="outline" onPress={() => mutate()}>Atualizar situação</Button>
    </> : null}
    {actionError ? <Notice error message={actionError}/> : null}{message ? <Notice message={message}/> : null}
    <details open={Boolean(error)}><summary>Solicitar outro link de acesso</summary><form onSubmit={renew}><Field label="Número do pedido"><input name="orderId" defaultValue={order?.id} required pattern="[a-fA-F0-9-]{36}"/></Field><Field label="E-mail da compra"><input name="email" type="email" required/></Field><Submit pending={pending}>Enviar novo link</Submit></form></details>
  </main>;
}
