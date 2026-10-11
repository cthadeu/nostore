import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import useSWR from 'swr';
import { Button } from '@heroui/react/button';
import { Card } from '@heroui/react/card';
import { api, ApiError } from '../lib/api';
import type { Profile } from '../lib/api';
import { SellerSidebar } from '../components/SellerSidebar';
import { Field, Notice, Pending, Submit } from '../components/ui';

const gatewayLabels: Record<string, string> = { not_connected: 'Não conectado', pending: 'Em análise', connected: 'Conectado', active: 'Conectado', restricted: 'Recebimento restrito', revoked: 'Conexão revogada' };
const gatewayMessages: Record<string, string> = { connected: 'Conta Mercado Pago conectada. Seus produtos já podem ser publicados.', denied: 'A autorização foi cancelada no Mercado Pago.', error: 'Não foi possível concluir a conexão com o Mercado Pago. Tente novamente.' };

// Seller ↔ Mercado Pago: the connect button sends the seller to the Mercado Pago authorization page;
// the API callback stores the credentials and brings the seller back here with ?gateway=<result>.
function GatewayCard({ profile, refresh }: { profile: Profile; refresh: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(() => { const result = new URLSearchParams(window.location.search).get('gateway'); if (result) window.history.replaceState(null, '', window.location.pathname + window.location.hash); return result ? gatewayMessages[result] ?? '' : ''; });
  const mercadoPago = profile.paymentGateway === 'mercadopago';
  const connected = profile.gatewayStatus === 'connected';
  async function connect() { setPending(true); setMessage(''); try { const { url } = await api<{ url: string }>('/seller/gateway/connect'); window.location.assign(url); } catch (err) { setMessage((err as Error).message); setPending(false); } }
  async function disconnect() { setPending(true); setMessage(''); try { const result = await api<{ message: string }>('/seller/gateway/disconnect', { method: 'POST' }); await refresh(); setMessage(result.message); } catch (err) { setMessage((err as Error).message); } finally { setPending(false); } }
  return <Card className="settings-card" id="recebimento"><Card.Header><Card.Title>Recebimento</Card.Title><Card.Description>{mercadoPago ? 'Mercado Pago' : 'Pagamentos simulados'}</Card.Description></Card.Header><Card.Content>
    <span className="pill">{gatewayLabels[profile.gatewayStatus] ?? 'Situação indisponível'}</span>
    {message ? <Notice message={message}/> : null}
    {mercadoPago ? <>
      <p className="settings-copy">{connected ? `Conta Mercado Pago ${profile.gatewayAccount ?? ''} conectada. As vendas caem direto nela; a taxa de serviço da nostore é descontada automaticamente em cada pagamento.` : 'Conecte sua conta Mercado Pago para receber pelos seus checkouts. Você será levado ao Mercado Pago para autorizar a nostore e voltará para cá em seguida.'}</p>
      {connected ? <Button variant="outline" isPending={pending} onPress={disconnect}>Desconectar</Button> : <Button isPending={pending} onPress={connect}>Conectar Mercado Pago</Button>}
      <p className="settings-hint">A publicação de produtos exige a conta conectada. Você pode desconectar quando quiser; produtos ativos deixam de aceitar compras até reconectar.</p>
    </> : <p className="settings-copy">Modo simulado: publique produtos e aprove compras de teste na tela Pedidos, sem movimentar dinheiro.</p>}
  </Card.Content></Card>;
}

export default function Settings() {
  const { data: fee } = useSWR<{ basisPoints: number }>('/seller/fee');
  const { data: profile, error, mutate } = useSWR<Profile>('/seller/profile');
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error) return <main className="narrow"><Notice message={error.message} error/><Button onPress={() => mutate()}>Tentar novamente</Button></main>;
  if (!profile) return <Pending/>;
  return <div className="workspace"><SellerSidebar profile={profile}/><main className="main-workspace">
    <header className="topbar"><span>Sua conta, do seu jeito</span><span className="pill">● Plano {profile.plan === 'pro' ? 'Pro' : 'Gratuito'}</span></header>
    <section className="page-intro"><div><span className="eyebrow">CUIDE DOS DETALHES</span><h1>Configurações</h1><p>Atualize seu perfil e acompanhe o recebimento das suas vendas.</p></div></section>
    <div className="settings-grid">
      <Card className="settings-card"><Card.Header><Card.Title>Perfil do vendedor</Card.Title><Card.Description>Os dados de quem está por trás dos seus produtos.</Card.Description></Card.Header><Card.Content><ProfileForm key={profile.id} profile={profile} refresh={async () => { await mutate(); }}/></Card.Content></Card>
      <div className="settings-secondary"><Card className="settings-card"><Card.Header><Card.Title>Taxa de serviço</Card.Title></Card.Header><Card.Content><p className="settings-copy">{fee ? `${fee.basisPoints / 100}% acrescidos ao preço do produto, sem frete.` : 'Carregando taxa…'}</p>{profile.isAdmin ? <a href="/admin/configuracoes">Configurar taxa da plataforma →</a> : <p className="settings-hint">O percentual é definido pela administração da nostore.</p>}</Card.Content></Card>
        <GatewayCard profile={profile} refresh={async () => { await mutate(); }}/>
        <Card className="settings-card"><Card.Header><Card.Title>Seu plano</Card.Title></Card.Header><Card.Content><strong>{profile.plan === 'pro' ? 'Pro' : 'Gratuito'}</strong><p className="settings-copy">{profile.plan === 'pro' ? 'Produtos ativos ilimitados.' : 'Até 5 produtos ativos por conta.'}</p><p className="settings-hint">O plano Pro de R$ 29,90/mês estará disponível quando a assinatura for habilitada.</p></Card.Content></Card>
      </div>
    </div>
  </main></div>;
}

function ProfileForm({ profile, refresh }: { profile: Profile; refresh: () => Promise<void> }) {
  const [personType, setPersonType] = useState(profile.personType);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const document = String(values.get('document') ?? '').replace(/\D/g, '');
    setPending(true); setError(''); setMessage('');
    try {
      await api('/seller/profile', { method: 'PATCH', body: JSON.stringify({ displayName: String(values.get('displayName')).trim(), personType, ...(document ? { document } : {}) }) });
      await refresh();
      const field = form.elements.namedItem('document') as HTMLInputElement;
      field.value = '';
      setMessage('Perfil atualizado.');
    } catch (err) { setError((err as Error).message); } finally { setPending(false); }
  }
  async function resend() {
    setResending(true); setMessage(''); setError('');
    try { const response = await api<{ message: string }>('/auth/resend-verification', { method: 'POST' }); setMessage(response.message); }
    catch (err) { setError((err as Error).message); } finally { setResending(false); }
  }
  return <form className="settings-form" onSubmit={submit}>
    <Field label="Nome do vendedor" hint="Nome usado para identificar seu negócio."><input name="displayName" defaultValue={profile.displayName} required minLength={2} maxLength={100} autoComplete="organization"/></Field>
    <Field label="E-mail da conta" hint={profile.emailVerified ? 'E-mail confirmado.' : 'Confirme seu e-mail para continuar o cadastro.'}><input type="email" value={profile.email} readOnly autoComplete="email"/></Field>
    {!profile.emailVerified ? <Button variant="outline" type="button" isPending={resending} onPress={resend}>Reenviar confirmação</Button> : null}
    <Field label="Tipo de pessoa"><select name="personType" value={personType} onChange={event => setPersonType(event.target.value as Profile['personType'])}><option value="individual">Pessoa física</option><option value="business">Pessoa jurídica</option></select></Field>
    <Field label={personType === 'individual' ? 'CPF' : 'CNPJ'} hint={profile.documentLast4 ? `Documento cadastrado: final ${profile.documentLast4}. Deixe em branco para manter ou informe um novo documento para substituir.` : 'Informe o documento do responsável pelo recebimento.'}><input key={personType} name="document" inputMode="numeric" maxLength={18} required={Boolean(profile.documentLast4 && personType !== profile.personType)} placeholder={personType === 'individual' ? '000.000.000-00' : '00.000.000/0000-00'} autoComplete="off"/></Field>
    {error ? <Notice error message={error}/> : null}{message ? <Notice message={message}/> : null}
    <div className="settings-submit"><Submit pending={pending}>Salvar alterações</Submit></div>
  </form>;
}
