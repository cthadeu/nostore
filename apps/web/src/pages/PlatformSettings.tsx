import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router';
import useSWR from 'swr';
import { api, ApiError, money } from '../lib/api';
import type { Profile } from '../lib/api';
import { Field, Notice, Pending, Submit } from '../components/ui';
import { SellerSidebar } from '../components/SellerSidebar';
type Fee = { id: string; basisPoints: number; createdAt: string };
export default function PlatformSettings() {
  const { data: profile, error } = useSWR<Profile>('/seller/profile');
  const { data, error: feeError, mutate } = useSWR<{ current: Fee; history: Fee[] }>(profile?.isAdmin ? '/admin/fee' : null);
  const [preview, setPreview] = useState<number | null>(null);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || pending) return;
    const percent = Number(new FormData(event.currentTarget).get('fee'));
    setPending(true); setMessage('');
    try { await api('/admin/fee', { method: 'POST', body: JSON.stringify({ basisPoints: Math.round(percent * 100), previousId: data.current.id }) }); await mutate(); setMessage('Taxa atualizada. Pedidos existentes mantêm os valores originais.'); }
    catch (err) { setMessage((err as Error).message); } finally { setPending(false); }
  }
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error) return <main className="narrow"><Notice error message={error.message}/></main>;
  if (!profile) return <Pending/>;
  return <div className="workspace"><SellerSidebar profile={profile}/><main className="main-workspace"><section className="page-intro"><h1>Configurações da plataforma</h1></section>{!profile.isAdmin ? <Notice error message="Esta página está disponível apenas para administradores com e-mail confirmado."/> : feeError ? <Notice error message={feeError.message}/> : !data ? <Pending/> : <><form className="settings-card" onSubmit={save}><h2>Taxa de serviço</h2><p className="settings-copy">Percentual acrescido ao preço do produto, sem frete. Alterações valem para novos pedidos. A parcela nominal do vendedor corresponde ao preço do produto.</p><Field label="Taxa de serviço (%)"><input key={data.current.id} name="fee" type="number" min="0" max="100" step="0.01" required defaultValue={data.current.basisPoints / 100} onChange={event => setPreview(Number(event.target.value))}/></Field><p className="settings-hint">Exemplo com produto de R$ 100,00: taxa de {money(Math.round((preview ?? data.current.basisPoints / 100) * 100))}, total de {money(10000 + Math.round((preview ?? data.current.basisPoints / 100) * 100))}. Vigência imediata para novos pedidos.</p>{message ? <Notice message={message}/> : null}<Submit pending={pending}>Salvar taxa</Submit></form><section className="product-section"><h2>Últimas alterações</h2>{data.history.map(fee => <p className="settings-copy" key={fee.id}>{new Date(fee.createdAt).toLocaleString('pt-BR')} — {fee.basisPoints / 100}%</p>)}</section></>}</main></div>;
}
