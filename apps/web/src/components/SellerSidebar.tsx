import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';
import { Button } from '@heroui/react/button';
import { api } from '../lib/api';
import type { Profile } from '../lib/api';
import { Brand, Notice } from './ui';

export function SellerSidebar({ profile, total, activeCount }: { profile: Profile; total?: number; activeCount?: number }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pro = profile.plan === 'pro';
  async function logout() {
    setPending(true); setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      await mutate(() => true, undefined, { revalidate: false });
      navigate('/entrar', { replace: true });
    } catch (err) { setError((err as Error).message); setPending(false); }
  }
  return <aside className="sidebar">
    <Link to="/" aria-label="nostore início"><Brand/></Link>
    <div className="nav-caption">SEU NEGÓCIO</div>
    <nav aria-label="Menu do vendedor">
      <Link className={pathname === '/' ? 'nav-active' : undefined} to="/" aria-current={pathname === '/' ? 'page' : undefined}><span aria-hidden="true">◫</span> Visão geral</Link>
      <Link to="/#products"><span aria-hidden="true">▦</span> Meus produtos {total !== undefined ? <small>{total}</small> : null}</Link>
      <Link className={pathname === '/pedidos' ? 'nav-active' : undefined} to="/pedidos" aria-current={pathname === '/pedidos' ? 'page' : undefined}>Pedidos</Link>
      {profile.isAdmin ? <Link to="/admin/configuracoes" className={pathname === '/admin/configuracoes' ? 'nav-active' : undefined}>Plataforma</Link> : null}
      <Link className={pathname === '/configuracoes' ? 'nav-active' : undefined} to="/configuracoes" aria-current={pathname === '/configuracoes' ? 'page' : undefined}><span aria-hidden="true">⚙</span> Configurações</Link>
    </nav>
    <div className="plan-card"><span className="eyebrow">ESPAÇO PARA CRESCER</span><h3>Comece pequeno.<br/>Pense ilimitado.</h3><p>{pro ? 'Produtos ativos ilimitados no plano Pro.' : 'Até 5 produtos ativos no plano Gratuito.'}</p>{!pro && activeCount !== undefined ? <><div className="plan-meter"><span style={{ width: `${Math.min(activeCount / 5 * 100, 100)}%` }}/></div><small>{activeCount} de 5 ativos</small></> : null}</div>
    {error ? <Notice message={error} error/> : null}
    <div className="user-menu"><div className="avatar">{profile.name.charAt(0).toUpperCase()}</div><div><strong>{profile.name}</strong><small>Conta {pro ? 'Pro' : 'Gratuita'}</small></div><Button variant="ghost" isDisabled={pending} onPress={logout} aria-label="Sair da conta">↪</Button></div>
  </aside>;
}
