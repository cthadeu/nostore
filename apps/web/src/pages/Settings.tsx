import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import useSWR from 'swr';
import { Button } from '@heroui/react/button';
import { Card } from '@heroui/react/card';
import { api, ApiError } from '../lib/api';
import type { Profile } from '../lib/api';
import { SellerSidebar } from '../components/SellerSidebar';
import { Field, Notice, Pending, Submit } from '../components/ui';
import { useToast } from '../components/Toast';

const gatewayLabels: Record<string, string> = { not_connected: 'Não conectado', pending: 'Em análise', connected: 'Conectado', active: 'Conectado', restricted: 'Recebimento restrito', revoked: 'Conexão revogada' };
const gatewayMessages: Record<string, string> = { connected: 'Conta Mercado Pago conectada. Seus produtos já podem ser publicados.', denied: 'A autorização foi cancelada no Mercado Pago.', error: 'Não foi possível concluir a conexão com o Mercado Pago. Tente novamente.' };

const shippingMessages: Record<string, string> = { connected: 'Conta Melhor Envio conectada. Cadastre o endereço de origem para calcular fretes.', denied: 'A autorização foi cancelada no Melhor Envio.', error: 'Não foi possível concluir a conexão com o Melhor Envio. Tente novamente.' };
type Origin = { phone: string | null; address: { postalCode: string; street: string; number: string; complement?: string; district: string; city: string; state: string } | null };
// Seller ↔ Melhor Envio: OAuth connection plus the postage origin (address and phone) printed on labels.
function ShippingCard({ profile, refresh }: { profile: Profile; refresh: () => Promise<void> }) {
  const { data: origin, mutate: reloadOrigin } = useSWR<Origin>(profile.shippingEnabled ? '/seller/shipping/origin' : null);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const connected = profile.shippingStatus === 'connected';
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('shipping');
    if (!result) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    if (shippingMessages[result]) result === 'connected' ? toast.success(shippingMessages[result]) : toast.error(shippingMessages[result]);
  }, [toast]);
  async function connect() { setPending(true); try { const { url } = await api<{ url: string }>('/seller/shipping/connect'); window.location.assign(url); } catch (err) { toast.error((err as Error).message); setPending(false); } }
  async function disconnect() { setPending(true); try { const result = await api<{ message: string }>('/seller/shipping/disconnect', { method: 'POST' }); await refresh(); toast.success(result.message); } catch (err) { toast.error((err as Error).message); } finally { setPending(false); } }
  async function saveOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = new FormData(event.currentTarget); const read = (k: string) => String(form.get(k) ?? '').trim();
    setPending(true);
    try {
      const result = await api<{ message: string }>('/seller/shipping/origin', { method: 'PUT', body: JSON.stringify({ phone: read('phone').replace(/\D/g, ''), address: { postalCode: read('postalCode').replace(/\D/g, ''), street: read('street'), number: read('number'), complement: read('complement') || undefined, district: read('district'), city: read('city'), state: read('state').toUpperCase() } }) });
      await Promise.all([reloadOrigin(), refresh()]); toast.success(result.message);
    } catch (err) { toast.error((err as Error).message); } finally { setPending(false); }
  }
  if (!profile.shippingEnabled) return <Card className="settings-card" id="envio"><Card.Header><Card.Title>Envio</Card.Title><Card.Description>Produtos físicos</Card.Description></Card.Header><Card.Content><p className="settings-copy">O frete calculado pelo Melhor Envio não está habilitado neste ambiente. Produtos físicos usam envio manual: você posta e informa o rastreio na tela Pedidos.</p></Card.Content></Card>;
  return <Card className="settings-card" id="envio"><Card.Header><Card.Title>Envio</Card.Title><Card.Description>Melhor Envio</Card.Description></Card.Header><Card.Content>
    <span className="pill">{connected ? 'Conectado' : 'Não conectado'}</span>
    <p className="settings-copy">{connected ? 'O comprador escolhe a transportadora no checkout e paga o frete. A etiqueta é comprada com o saldo da sua carteira Melhor Envio, na tela Pedidos.' : 'Conecte sua conta Melhor Envio para oferecer frete calculado e etiquetas nos produtos físicos. Sem conexão, o envio é manual.'}</p>
    {connected ? <Button variant="outline" isPending={pending} onPress={disconnect}>Desconectar</Button> : <Button isPending={pending} onPress={connect}>Conectar Melhor Envio</Button>}
    <form className="editor-form" onSubmit={saveOrigin} key={origin ? 'loaded' : 'empty'}><fieldset disabled={pending}><legend>Endereço de origem (remetente das etiquetas)</legend>
      <Field label="Telefone com DDD"><input name="phone" required inputMode="tel" defaultValue={origin?.phone ?? ''} placeholder="(11) 99999-9999"/></Field>
      {[['postalCode', 'CEP'], ['street', 'Rua'], ['number', 'Número'], ['complement', 'Complemento'], ['district', 'Bairro'], ['city', 'Cidade'], ['state', 'UF']].map(([name, label]) => <Field key={name} label={label!}><input name={name} required={name !== 'complement'} maxLength={name === 'state' ? 2 : name === 'postalCode' ? 9 : 100} defaultValue={(origin?.address as Record<string, string | undefined> | null)?.[name!] ?? ''}/></Field>)}
    </fieldset><Submit pending={pending}>Salvar endereço de origem</Submit></form>
    <p className="settings-hint">Publicar um produto físico com frete calculado exige a conta conectada, o endereço de origem e as medidas da embalagem no produto.</p>
  </Card.Content></Card>;
}
// Seller ↔ Mercado Pago: the connect button sends the seller to the Mercado Pago authorization page;
// the API callback stores the credentials and brings the seller back here with ?gateway=<result>.
function GatewayCard({ profile, refresh }: { profile: Profile; refresh: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const mercadoPago = profile.paymentGateway === 'mercadopago';
  const connected = profile.gatewayStatus === 'connected';
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('gateway');
    if (!result) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    if (gatewayMessages[result]) result === 'connected' ? toast.success(gatewayMessages[result]) : toast.error(gatewayMessages[result]);
  }, [toast]);
  async function connect() { setPending(true); try { const { url } = await api<{ url: string }>('/seller/gateway/connect'); window.location.assign(url); } catch (err) { toast.error((err as Error).message); setPending(false); } }
  async function disconnect() { setPending(true); try { const result = await api<{ message: string }>('/seller/gateway/disconnect', { method: 'POST' }); await refresh(); toast.success(result.message); } catch (err) { toast.error((err as Error).message); } finally { setPending(false); } }
  return <Card className="settings-card" id="recebimento"><Card.Header><Card.Title>Recebimento</Card.Title><Card.Description>{mercadoPago ? 'Mercado Pago' : 'Pagamentos simulados'}</Card.Description></Card.Header><Card.Content>
    <span className="pill">{gatewayLabels[profile.gatewayStatus] ?? 'Situação indisponível'}</span>
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
        <ShippingCard profile={profile} refresh={async () => { await mutate(); }}/>
        <Card className="settings-card"><Card.Header><Card.Title>Seu plano</Card.Title></Card.Header><Card.Content><strong>{profile.plan === 'pro' ? 'Pro' : 'Gratuito'}</strong><p className="settings-copy">{profile.plan === 'pro' ? 'Produtos ativos ilimitados.' : 'Até 5 produtos ativos por conta.'}</p><p className="settings-hint">O plano Pro de R$ 29,90/mês estará disponível quando a assinatura for habilitada.</p></Card.Content></Card>
      </div>
    </div>
  </main></div>;
}

function ProfileForm({ profile, refresh }: { profile: Profile; refresh: () => Promise<void> }) {
  const [personType, setPersonType] = useState(profile.personType);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const [resending, setResending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const document = String(values.get('document') ?? '').replace(/\D/g, '');
    setPending(true);
    try {
      await api('/seller/profile', { method: 'PATCH', body: JSON.stringify({ displayName: String(values.get('displayName')).trim(), personType, ...(document ? { document } : {}) }) });
      await refresh();
      const field = form.elements.namedItem('document') as HTMLInputElement;
      field.value = '';
      toast.success('Perfil atualizado.');
    } catch (err) { toast.error((err as Error).message); } finally { setPending(false); }
  }
  async function resend() {
    setResending(true);
    try { const response = await api<{ message: string }>('/auth/resend-verification', { method: 'POST' }); toast.success(response.message); }
    catch (err) { toast.error((err as Error).message); } finally { setResending(false); }
  }
  return <form className="settings-form" onSubmit={submit}>
    <Field label="Nome do vendedor" hint="Nome usado para identificar seu negócio."><input name="displayName" defaultValue={profile.displayName} required minLength={2} maxLength={100} autoComplete="organization"/></Field>
    <Field label="E-mail da conta" hint={profile.emailVerified ? 'E-mail confirmado.' : 'Confirme seu e-mail para continuar o cadastro.'}><input type="email" value={profile.email} readOnly autoComplete="email"/></Field>
    {!profile.emailVerified ? <Button variant="outline" type="button" isPending={resending} onPress={resend}>Reenviar confirmação</Button> : null}
    <Field label="Tipo de pessoa"><select name="personType" value={personType} onChange={event => setPersonType(event.target.value as Profile['personType'])}><option value="individual">Pessoa física</option><option value="business">Pessoa jurídica</option></select></Field>
    <Field label={personType === 'individual' ? 'CPF' : 'CNPJ'} hint={profile.documentLast4 ? `Documento cadastrado: final ${profile.documentLast4}. Deixe em branco para manter ou informe um novo documento para substituir.` : 'Informe o documento do responsável pelo recebimento.'}><input key={personType} name="document" inputMode="numeric" maxLength={18} required={Boolean(profile.documentLast4 && personType !== profile.personType)} placeholder={personType === 'individual' ? '000.000.000-00' : '00.000.000/0000-00'} autoComplete="off"/></Field>
    <div className="settings-submit"><Submit pending={pending}>Salvar alterações</Submit></div>
  </form>;
}
