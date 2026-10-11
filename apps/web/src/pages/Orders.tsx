import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import useSWR from 'swr';
import { Button } from '@heroui/react/button';
import { api, ApiError, money, orderLabels } from '../lib/api';
import type { Order, Profile } from '../lib/api';
import { Field, Notice, Pending } from '../components/ui';
import { SellerSidebar } from '../components/SellerSidebar';
interface Sales { items: Order[]; total: number; paidCount: number; grossCents: number; feeCents: number; sellerCents: number }
export default function Orders() {
  const { data: profile, error } = useSWR<Profile>('/seller/profile');
  const [page, setPage] = useState(1); const [status, setStatus] = useState('');
  const [productId] = useState(() => new URLSearchParams(window.location.search).get('productId') ?? '');
  const { data, error: salesError, mutate } = useSWR<Sales>(profile ? `/seller/orders?page=${page}&limit=20${status ? `&status=${status}` : ''}${productId ? `&productId=${encodeURIComponent(productId)}` : ''}` : null, { refreshInterval: 10000 });
  const [pending, setPending] = useState(''); const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  async function simulate(id: string, outcome: string) {
    if (pending) return; setPending(id); setMessage('');
    try { await api(`/seller/orders/${id}/simulate`, { method: 'POST', body: JSON.stringify({ outcome }) }); await mutate(); setMessage('Pagamento de teste atualizado.'); }
    catch (err) { setMessage((err as Error).message); } finally { setPending(''); }
  }
  async function refund(id: string) {
    if (pending) return; setPending(id); setMessage('');
    try { await api(`/seller/orders/${id}/refund`, { method: 'POST' }); await mutate(); setMessage('Reembolso solicitado ao Mercado Pago. O comprador foi avisado por e-mail.'); }
    catch (err) { setMessage((err as Error).message); } finally { setPending(''); }
  }
  async function details(id: string) { try { setSelected(await api<Order>(`/seller/orders/${id}`)); } catch (err) { setMessage((err as Error).message); } }
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error) return <main className="narrow"><Notice error message={error.message}/></main>;
  if (!profile) return <Pending/>;
  return <div className="workspace"><SellerSidebar profile={profile}/><main className="main-workspace"><header className="topbar">Pedidos e vendas</header><section className="page-intro"><div><h1>Seus pedidos</h1><p>Acompanhe as compras e teste os resultados do pagamento.</p></div></section>
    {profile.paymentGateway === 'simulated' ? <Notice message="Simulação ativa: aprovações, recusas e reembolsos abaixo não movimentam dinheiro."/> : null}
    {data ? <div className="stats-grid commerce-stats"><div className="stat"><span>Compras aprovadas</span><strong>{data.paidCount}</strong></div><div className="stat"><span>{profile.paymentGateway === 'simulated' ? 'Total pago simulado' : 'Total pago'}</span><strong>{money(data.grossCents)}</strong><small>Taxas: {money(data.feeCents)}</small></div><div className="stat"><span>Parcela do vendedor</span><strong>{money(data.sellerCents)}</strong><small>Sem tarifas do gateway. Reembolsos excluídos.</small></div></div> : null}
    <Field label="Filtrar por situação"><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(orderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{productId ? <Link to="/pedidos">Ver todos os produtos</Link> : null}
    {message ? <Notice message={message}/> : null}{salesError ? <Notice error message={salesError.message}/> : !data ? <Pending/> : !data.items.length ? <div className="empty-state">Nenhum pedido encontrado. Publique um produto e compartilhe o checkout.</div> : <div className="orders-list">{data.items.map(order => <article className="order-card" key={order.id}><div><span className="pill">{orderLabels[order.status]}</span><h2>{order.productName}</h2><p>{order.buyerName} · {order.buyerEmail}</p><small>{new Date(order.createdAt).toLocaleString('pt-BR')} · {order.method === 'pix' ? 'Pix' : 'Cartão'}</small></div><div><strong>{money(order.totalCents)}</strong><p>Taxa: {money(order.feeCents)}</p></div><div className="order-actions"><Button variant="outline" onPress={() => details(order.id)}>Detalhes</Button>{profile.paymentGateway === 'simulated' && order.gateway === 'simulated' ? <>{order.status === 'pending' ? <><Button isDisabled={Boolean(pending)} onPress={() => simulate(order.id, 'paid')}>Simular aprovação</Button><Button variant="outline" isDisabled={Boolean(pending)} onPress={() => simulate(order.id, 'rejected')}>Simular recusa</Button></> : order.status === 'paid' ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={() => simulate(order.id, 'refunded')}>Simular reembolso</Button> : null}</> : order.gateway === 'mercadopago' && order.status === 'paid' ? <Button variant="outline" isDisabled={Boolean(pending)} onPress={() => refund(order.id)}>Reembolsar</Button> : null}</div></article>)}</div>}
    {selected ? <section className="order-card"><div><h2>Detalhes do pedido</h2><p className="break-text">{selected.id}</p><p>{selected.buyerName} · {selected.buyerEmail}</p>{selected.address ? <p>{Object.values(selected.address).filter(Boolean).join(', ')}</p> : <p>Produto digital — entrega pela página de acesso do comprador.</p>}</div><Button variant="outline" onPress={() => setSelected(null)}>Fechar detalhes</Button></section> : null}
    <div className="pagination"><Button variant="outline" isDisabled={page === 1} onPress={() => setPage(page - 1)}>Anterior</Button><span>Página {page}</span><Button variant="outline" isDisabled={!data || page * 20 >= data.total} onPress={() => setPage(page + 1)}>Próxima</Button></div>
  </main></div>;
}
