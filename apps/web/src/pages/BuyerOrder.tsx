import { useState } from 'react';
import type { FormEvent } from 'react';
import useSWR from 'swr';
import { Button } from '@heroui/react/button';
import { api, money, orderLabels, shipmentLabels } from '../lib/api';
import type { Order } from '../lib/api';
import { Brand, Field, Notice, Pending, Submit } from '../components/ui';
import { PixPanel } from '../components/PixPanel';
import { useToast } from '../components/Toast';
export default function BuyerOrder() {
  const [accessToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const { data: access, error: accessError } = useSWR(accessToken ? ['buyer-session', accessToken] : null, () => api('/buyer/session', { method: 'POST', body: JSON.stringify({ token: accessToken }) }), { revalidateOnFocus: false, revalidateOnReconnect: false, onSuccess: () => window.history.replaceState(null, '', window.location.pathname) });
  const { data: order, error: orderError, mutate } = useSWR<Order>(!accessToken || access ? '/buyer/order' : null, () => api('/buyer/order', { method: 'POST', body: '{}' }), { refreshInterval: data => data?.status === 'pending' ? 5000 : 15000 });
  const error = accessError ?? orderError;
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function download() {
    setPending(true);
    try { const result = await api<{ url: string }>('/buyer/download-ticket', { method: 'POST', body: '{}' }); window.location.assign(result.url); }
    catch (err) { toast.error((err as Error).message); } finally { setPending(false); }
  }
  async function renew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const form = new FormData(event.currentTarget);
    try { const result = await api<{ message: string }>('/buyer/renew-access', { method: 'POST', body: JSON.stringify({ orderId: form.get('orderId'), email: form.get('email') }) }); toast.success(result.message); }
    catch (err) { toast.error((err as Error).message); } finally { setPending(false); }
  }
  const simulated = !order || order.gateway === 'simulated';
  return <main className="narrow"><Brand/>{simulated ? <Notice message="Ambiente de teste. Nenhum pagamento real é processado."/> : null}
    {error ? <Notice error message={error.message}/> : accessToken && !order ? <Pending/> : null}
    {order ? <><span className="pill">{orderLabels[order.status] ?? order.status}</span><h1>{order.productName}</h1><p className="quiet">Pedido <span className="break-text">{order.id}</span></p><dl className="amounts">{order.shippingCents ? <><div><dt>Produto</dt><dd>{money(order.totalCents - order.shippingCents)}</dd></div><div><dt>Frete{order.shipping?.service ? ` (${order.shipping.carrier} ${order.shipping.service})` : ''}</dt><dd>{money(order.shippingCents)}</dd></div></> : null}<div className="total"><dt>{simulated ? 'Total simulado' : 'Total'}</dt><dd>{money(order.totalCents)}</dd></div></dl>
      {order.status === 'pending' ? (simulated ? <Notice message={`Aguardando aprovação do vendedor na tela Pedidos. ${order.method === 'pix' ? 'O Pix de teste não possui QR Code ou código pagável.' : 'Nenhum dado de cartão é necessário.'} Expira em ${new Date(order.expiresAt).toLocaleString('pt-BR')}.`}/> : order.pix ? <PixPanel order={order}/> : <Notice message={`Aguardando a confirmação do pagamento pelo Mercado Pago. Expira em ${new Date(order.expiresAt).toLocaleString('pt-BR')}.`}/>) : null}
      {order.downloadable ? <Button isPending={pending} onPress={download}>Baixar produto digital</Button> : order.status === 'paid' ? <Notice message={order.productType === 'physical' ? `Pagamento ${simulated ? 'de teste ' : ''}aprovado. O vendedor tem acesso ao endereço para organizar o envio.` : 'O período de download terminou.'}/> : null}
      {order.productType === 'physical' && order.status === 'paid' ? <section className="shipment-panel"><h3>Entrega</h3>{order.shipment ? <><p><span className="pill">{shipmentLabels[order.shipment.status] ?? order.shipment.status}</span>{order.shipment.carrier ? ` · ${order.shipment.carrier}` : ''}</p>{order.shipment.trackingCode ? <p>Rastreio: <strong className="break-text">{order.shipment.trackingCode}</strong>{order.shipment.trackingUrl ? <> · <a href={order.shipment.trackingUrl} target="_blank" rel="noreferrer">acompanhar</a></> : null}</p> : <p className="quiet">O código de rastreio aparece aqui assim que o vendedor postar.</p>}</> : <p className="quiet">O vendedor está preparando o envio.</p>}{order.shipping?.deliveryDays ? <p className="quiet">Prazo estimado da transportadora: até {order.shipping.deliveryDays} dias úteis após a postagem.</p> : null}</section> : null}
      <Button variant="outline" onPress={() => mutate()}>Atualizar situação</Button>
    </> : null}
    <details open={Boolean(error)}><summary>Solicitar outro link de acesso</summary><form onSubmit={renew}><Field label="Número do pedido"><input name="orderId" defaultValue={order?.id} required pattern="[a-fA-F0-9-]{36}"/></Field><Field label="E-mail da compra"><input name="email" type="email" required/></Field><Submit pending={pending}>Enviar novo link</Submit></form></details>
  </main>;
}
