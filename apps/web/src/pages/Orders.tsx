import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import useSWR from 'swr';
import { Button } from '@heroui/react/button';
import { api, ApiError, money, orderLabels, shipmentLabels } from '../lib/api';
import type { Order, Profile, Shipment } from '../lib/api';
import { Field, Notice, Pending } from '../components/ui';
import { useToast } from '../components/Toast';
import { SellerSidebar } from '../components/SellerSidebar';
interface Sales { items: Order[]; total: number; paidCount: number; grossCents: number; feeCents: number; sellerCents: number }
// Fulfilment of a physical order: buy/print/cancel the Melhor Envio label or register a manual posting.
function ShipmentPanel({ order, onChange }: { order: Order; onChange: (shipment: Shipment | null) => Promise<void> }) {
  const toast = useToast();
  const [pending, setPending] = useState('');
  const shipment = order.shipment;
  const run = async (name: string, path: string, body?: object) => {
    if (pending) return; setPending(name);
    try { const result = await api<Shipment>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }); await onChange(result); }
    catch (err) { toast.error((err as Error).message); } finally { setPending(''); }
  };
  async function refreshTracking() { if (pending) return; setPending('sync'); try { await onChange(await api<Shipment | null>(`/seller/orders/${order.id}/shipment`)); } catch (err) { toast.error((err as Error).message); } finally { setPending(''); } }
  async function print() { if (pending) return; setPending('print'); try { const { url } = await api<{ url: string }>(`/seller/orders/${order.id}/shipment/print`, { method: 'POST', body: '{}' }); window.open(url, '_blank', 'noopener'); } catch (err) { toast.error((err as Error).message); } finally { setPending(''); } }
  async function manualPost(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await run('posted', `/seller/orders/${order.id}/shipment/posted`, { carrier: String(form.get('carrier') ?? '').trim(), trackingCode: String(form.get('trackingCode') ?? '').trim() }); }
  if (order.status !== 'paid' && !shipment) return <p className="quiet">Envio disponível após a confirmação do pagamento.</p>;
  const melhorEnvio = (shipment?.mode ?? order.shippingMode) === 'melhorenvio';
  return <div className="shipment-panel">
    <h3>Envio {order.shipping?.service ? `· ${order.shipping.carrier} ${order.shipping.service} (${money(order.shippingCents)})` : '· manual'}</h3>
    <p><span className="pill">{shipment ? shipmentLabels[shipment.status] ?? shipment.status : 'Aguardando'}</span>{shipment?.trackingCode ? <> Rastreio: <strong>{shipment.trackingCode}</strong>{shipment.trackingUrl ? <> · <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">acompanhar</a></> : null}</> : null}</p>
    {shipment?.error ? <Notice error message={shipment.error}/> : null}
    <div className="order-actions">
      {melhorEnvio && (!shipment || ['pending', 'purchased', 'failed'].includes(shipment.status)) ? <Button isDisabled={Boolean(pending)} onPress={() => run('buy', `/seller/orders/${order.id}/shipment/buy`)}>{shipment?.status === 'purchased' ? 'Gerar etiqueta' : shipment?.status === 'failed' ? 'Tentar novamente' : 'Comprar etiqueta'}</Button> : null}
      {melhorEnvio && shipment && ['generated', 'posted', 'delivered'].includes(shipment.status) ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={print}>Imprimir etiqueta</Button> : null}
      {melhorEnvio && shipment && shipment.status === 'generated' ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={() => run('posted', `/seller/orders/${order.id}/shipment/posted`)}>Marcar como postado</Button> : null}
      {melhorEnvio && shipment && ['purchased', 'generated'].includes(shipment.status) ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={() => run('cancel', `/seller/orders/${order.id}/shipment/cancel`, { reason: 'Cancelado pelo vendedor' })}>Cancelar etiqueta</Button> : null}
      {melhorEnvio && shipment && shipment.status !== 'pending' ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={refreshTracking}>Atualizar rastreio</Button> : null}
    </div>
    {!melhorEnvio && (!shipment || !shipment.postedAt) ? <form className="manual-post" onSubmit={manualPost}><Field label="Transportadora"><input name="carrier" required maxLength={60} placeholder="Correios, Jadlog…"/></Field><Field label="Código de rastreio"><input name="trackingCode" required maxLength={60}/></Field><Button type="submit" isDisabled={Boolean(pending)}>Registrar postagem</Button></form> : null}
    {shipment?.postedAt ? <p className="quiet">Postado em {new Date(shipment.postedAt).toLocaleString('pt-BR')}{shipment.deliveredAt ? ` · entregue em ${new Date(shipment.deliveredAt).toLocaleString('pt-BR')}` : ''}.</p> : null}
  </div>;
}
export default function Orders() {
  const { data: profile, error } = useSWR<Profile>('/seller/profile');
  const [page, setPage] = useState(1); const [status, setStatus] = useState('');
  const [productId] = useState(() => new URLSearchParams(window.location.search).get('productId') ?? '');
  const { data, error: salesError, mutate } = useSWR<Sales>(profile ? `/seller/orders?page=${page}&limit=20${status ? `&status=${status}` : ''}${productId ? `&productId=${encodeURIComponent(productId)}` : ''}` : null, { refreshInterval: 10000 });
  const toast = useToast();
  const [pending, setPending] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  async function simulate(id: string, outcome: string) {
    if (pending) return; setPending(id);
    try { await api(`/seller/orders/${id}/simulate`, { method: 'POST', body: JSON.stringify({ outcome }) }); await mutate(); toast.success('Pagamento de teste atualizado.'); }
    catch (err) { toast.error((err as Error).message); } finally { setPending(''); }
  }
  async function refund(id: string) {
    if (pending) return; setPending(id);
    try { await api(`/seller/orders/${id}/refund`, { method: 'POST' }); await mutate(); toast.success('Reembolso solicitado ao Mercado Pago. O comprador foi avisado por e-mail.'); }
    catch (err) { toast.error((err as Error).message); } finally { setPending(''); }
  }
  async function details(id: string) { try { setSelected(await api<Order>(`/seller/orders/${id}`)); } catch (err) { toast.error((err as Error).message); } }
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error) return <main className="narrow"><Notice error message={error.message}/></main>;
  if (!profile) return <Pending/>;
  return <div className="workspace"><SellerSidebar profile={profile}/><main className="main-workspace"><header className="topbar">Pedidos e vendas</header><section className="page-intro"><div><h1>Seus pedidos</h1><p>Acompanhe as compras e teste os resultados do pagamento.</p></div></section>
    {profile.paymentGateway === 'simulated' ? <Notice message="Simulação ativa: aprovações, recusas e reembolsos abaixo não movimentam dinheiro."/> : null}
    {data ? <div className="stats-grid commerce-stats"><div className="stat"><span>Compras aprovadas</span><strong>{data.paidCount}</strong></div><div className="stat"><span>{profile.paymentGateway === 'simulated' ? 'Total pago simulado' : 'Total pago'}</span><strong>{money(data.grossCents)}</strong><small>Taxas: {money(data.feeCents)}</small></div><div className="stat"><span>Parcela do vendedor</span><strong>{money(data.sellerCents)}</strong><small>Sem tarifas do gateway. Reembolsos excluídos.</small></div></div> : null}
    <Field label="Filtrar por situação"><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(orderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{productId ? <Link to="/pedidos">Ver todos os produtos</Link> : null}
    {salesError ? <Notice error message={salesError.message}/> : !data ? <Pending/> : !data.items.length ? <div className="empty-state">Nenhum pedido encontrado. Publique um produto e compartilhe o checkout.</div> : <div className="orders-list">{data.items.map(order => <article className="order-card" key={order.id}><div><span className="pill">{orderLabels[order.status]}</span><h2>{order.productName}</h2><p>{order.buyerName} · {order.buyerEmail}</p><small>{new Date(order.createdAt).toLocaleString('pt-BR')} · {order.method === 'pix' ? 'Pix' : 'Cartão'}</small></div><div><strong>{money(order.totalCents)}</strong><p>Taxa: {money(order.feeCents)}</p></div><div className="order-actions"><Button variant="outline" onPress={() => details(order.id)}>Detalhes</Button>{profile.paymentGateway === 'simulated' && order.gateway === 'simulated' ? <>{order.status === 'pending' ? <><Button isDisabled={Boolean(pending)} onPress={() => simulate(order.id, 'paid')}>Simular aprovação</Button><Button variant="outline" isDisabled={Boolean(pending)} onPress={() => simulate(order.id, 'rejected')}>Simular recusa</Button></> : order.status === 'paid' ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={() => simulate(order.id, 'refunded')}>Simular reembolso</Button> : null}</> : order.gateway === 'mercadopago' && order.status === 'paid' ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={() => refund(order.id)}>Reembolsar</Button> : null}</div></article>)}</div>}
    {selected ? <section className="order-card"><div><h2>Detalhes do pedido</h2><p className="break-text">{selected.id}</p><p>{selected.buyerName} · {selected.buyerEmail}</p>{selected.address ? <p>{Object.values(selected.address).filter(Boolean).join(', ')}</p> : <p>Produto digital — entrega pela página de acesso do comprador.</p>}{selected.productType === 'physical' ? <ShipmentPanel order={selected} onChange={async shipment => { setSelected({ ...selected, shipment }); await mutate(); }}/> : null}</div><Button variant="outline" onPress={() => setSelected(null)}>Fechar detalhes</Button></section> : null}
    <div className="pagination"><Button variant="outline" isDisabled={page === 1} onPress={() => setPage(page - 1)}>Anterior</Button><span>Página {page}</span><Button variant="outline" isDisabled={!data || page * 20 >= data.total} onPress={() => setPage(page + 1)}>Próxima</Button></div>
  </main></div>;
}
