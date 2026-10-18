import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from '@heroui/react/button';
import { Card } from '@heroui/react/card';
import { api, money, ApiError } from '../lib/api';
import type { Profile, Product, SalesSummary } from '../lib/api';
import { Brand, Notice, Pending } from '../components/ui';
import { useToast } from '../components/Toast';
import { SellerSidebar } from '../components/SellerSidebar';

// Sales of the last 15 days against the 15 days before: count, amount paid and the seller's share.
function SalesStats({ sales }: { sales?: SalesSummary }) {
  const trend = (now: number, before: number) => before === 0 ? (now > 0 ? 'novo' : 'sem vendas no período anterior') : `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% vs. 15 dias anteriores`;
  const current = sales?.current, previous = sales?.previous;
  const period = sales ? `${new Date(sales.current.from).toLocaleDateString('pt-BR')} a ${new Date().toLocaleDateString('pt-BR')}` : '';
  return <section className="sales-stats"><div className="section-heading"><div><h2>Vendas dos últimos 15 dias</h2><p>{period ? `Pagamentos confirmados de ${period}.` : 'Carregando…'}</p></div><Link className="quiet" to="/pedidos">Ver pedidos →</Link></div>
    <div className="stats-grid commerce-stats">
      <Card className="stat"><Card.Header><span className="stat-label">Vendas confirmadas <span>✓</span></span></Card.Header><Card.Content><strong>{current ? current.paidCount : '—'}</strong><small>{current && previous ? trend(current.paidCount, previous.paidCount) : ' '}{current?.refundedCount ? ` · ${current.refundedCount} reembolso(s)` : ''}</small></Card.Content></Card>
      <Card className="stat"><Card.Header><span className="stat-label">Valor total vendido <span>R$</span></span></Card.Header><Card.Content><strong>{current ? money(current.totalCents) : '—'}</strong><small>{current && previous ? trend(current.totalCents, previous.totalCents) : ' '}</small></Card.Content></Card>
      <Card className="stat soft"><Card.Header><span className="stat-label">Sua parte <span>↗</span></span></Card.Header><Card.Content><strong>{current ? money(current.priceCents + current.shippingCents) : '—'}</strong><small>{current ? `Produtos ${money(current.priceCents)}${current.shippingCents ? ` + frete ${money(current.shippingCents)}` : ''} · taxa nostore ${money(current.feeCents)}` : ' '}</small></Card.Content></Card>
    </div></section>;
}
export default function Dashboard() {
  const { data: profile, error } = useSWR<Profile>('/seller/profile');
  const [page, setPage] = useState(1);
  const { data: products, error: productsError } = useSWR<{ items: Product[]; total: number; activeCount: number }>(profile ? `/seller/products?page=${page}&limit=12` : null);
  const { data: sales } = useSWR<SalesSummary>(profile ? '/seller/summary?days=15' : null, { refreshInterval: 60000 });
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function verify() { setBusy(true); try { const result = await api<{ message: string }>('/auth/resend-verification', { method: 'POST' }); toast.success(result.message); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); } }
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error) return <main className="narrow"><Notice error message={error.message}/><Button onPress={() => mutate('/seller/profile')}>Tentar novamente</Button></main>;
  if (!profile) return <Pending/>;
  return <div className="workspace"><SellerSidebar profile={profile} total={products?.total} activeCount={products?.activeCount}/><main className="main-workspace" id="overview"><header className="topbar"><span>Seu espaço criativo</span><span className="pill">● Plano {profile.plan === 'pro' ? 'Pro' : 'Gratuito'}</span></header><section className="page-intro"><div><span className="eyebrow">CADA IDEIA TEM UM COMEÇO</span><h1>Olá, {profile.name.split(' ')[0]} <span className="hello-dot">✳</span></h1><p>Vamos dar vida ao seu próximo produto?</p></div><Link className="button button--primary" to="/produtos/novo">+ Novo produto</Link></section>
    {!profile.emailVerified ? <div className="verification"><span><strong>Falta só confirmar seu e-mail.</strong><br/>Enviamos um link para {profile.email}.</span><Button variant="outline" isDisabled={busy} onPress={verify}>Reenviar e-mail</Button></div> : null}
    <div className="stats-grid"><Card className="stat"><Card.Header><span className="stat-label">Produtos cadastrados <span>▦</span></span></Card.Header><Card.Content><strong>{products?.total ?? '—'}</strong><small>Suas ideias tomando forma</small></Card.Content></Card><Card className="stat"><Card.Header><span className="stat-label">Produtos ativos <span>↗</span></span></Card.Header><Card.Content><strong>{products?.activeCount ?? '—'}<em>{profile.plan === 'pro' ? ' / ∞' : ' / 5'}</em></strong><small>Disponíveis no seu plano</small></Card.Content></Card><Card className="stat soft"><Card.Header><span className="stat-label">Seu próximo passo <span>✧</span></span></Card.Header><Card.Content><strong className="stat-text">Teste sua primeira venda</strong><small><Link to="/pedidos">Acompanhar pedidos e pagamentos →</Link></small></Card.Content></Card></div>
    <SalesStats sales={sales}/>
    <section className="product-section" id="products"><div className="section-heading"><div><h2>Meus produtos <span>{products?.total ?? 0}</span></h2><p>Um link para cada coisa incrível que você cria.</p></div><span className="quiet">Todos os produtos</span></div>{productsError ? <Notice error message={productsError.message}/> : !products ? <Pending/> : products.items.length ? <><div className="product-grid">{products.items.map(product => <Link to={`/produtos/${product.id}`} key={product.id} className="product-card"><div className={`product-cover ${product.type}`}>{product.imageAssetId ? <img src={`/api/v1/seller/assets/${product.imageAssetId}/image`} alt=""/> : <span aria-hidden="true">{product.type === 'digital' ? '↗' : '□'}</span>}<span className="status-pill">{product.status === 'draft' ? 'Rascunho' : product.status === 'active' ? 'Ativo' : 'Pausado'}</span></div><div className="product-info"><small>{product.type === 'digital' ? 'PRODUTO DIGITAL' : 'PRODUTO FÍSICO'}</small><h3>{product.name}</h3><div><strong>{money(product.priceCents)}</strong><span>Editar ↗</span></div></div></Link>)}</div><div className="pagination"><Button variant="outline" isDisabled={page === 1} onPress={() => setPage(page - 1)}>Anterior</Button><span>Página {page}</span><Button variant="outline" isDisabled={page * 12 >= products.total} onPress={() => setPage(page + 1)}>Próxima</Button></div></> : <div className="empty-state"><span className="empty-icon">✳</span><h3>Tudo começa com o primeiro produto.</h3><p>Um e-book, um guia, uma criação sua.<br/>Prepare os detalhes e encontre seu próximo começo.</p><Link to="/produtos/novo" className="button button--primary">Criar meu primeiro produto ↗</Link></div>}</section>
    <footer className="workspace-footer"><span>Pequenas ideias. Grandes possibilidades.</span><Brand/></footer></main></div>;
}
