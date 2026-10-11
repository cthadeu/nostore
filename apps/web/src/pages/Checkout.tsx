import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import useSWR from 'swr';
import { Card } from '@heroui/react/card';
import { Button } from '@heroui/react/button';
import { api, money } from '../lib/api';
import { Brand, Field, Notice, Pending, Submit } from '../components/ui';

type Offer = { publicId: string; version: string; name: string; description: string; sellerName: string; imageUrl: string; type: string; paymentMethods: string[]; priceCents: number; feeCents: number; totalCents: number; feePolicy: { id: string; basisPoints: number }; shippingDays: number | null };
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
export default function Checkout() {
  const { id } = useParams();
  const { data, error, mutate } = useSWR<Offer>(`/checkout/${id}`, { revalidateOnFocus: false });
  if (error) return <main className="narrow"><Brand/><Notice error message={error.message}/><Button onPress={() => mutate()}>Tentar novamente</Button></main>;
  if (!data) return <Pending/>;
  return <CheckoutForm key={`${data.version}-${data.feePolicy.id}`} offer={data} refresh={() => mutate()}/>;
}
function CheckoutForm({ offer, refresh }: { offer: Offer; refresh: () => unknown }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const checkoutToken = useRef(newToken());
  const submitted = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = new FormData(event.currentTarget);
    const address = offer.type === 'physical' ? Object.fromEntries(['postalCode', 'street', 'number', 'complement', 'district', 'city', 'state'].map(key => [key, String(form.get(key) ?? '').trim()])) : undefined;
    if (address) { address.postalCode = address.postalCode.replace(/\D/g, ''); address.state = address.state.toUpperCase(); }
    const values = { productId: offer.publicId, productVersion: offer.version, feePolicyId: offer.feePolicy.id, buyerName: form.get('name'), buyerEmail: form.get('email'), buyerDocument: String(form.get('document')).replace(/\D/g, ''), method: form.get('method'), address, acceptSimulation: true };
    const fingerprint = JSON.stringify(values);
    // A retry of the same submission reuses its token; changed data starts another intent.
    if (submitted.current && submitted.current !== fingerprint) checkoutToken.current = newToken();
    submitted.current = fingerprint;
    setPending(true); setError('');
    try {
      const result = await api<{ accessUrl: string }>('/checkout/orders', { method: 'POST', body: JSON.stringify({ ...values, checkoutToken: checkoutToken.current }) });
      window.location.assign(result.accessUrl);
    } catch (err) { setError((err as Error).message); setPending(false); }
  }
  return <><header className="editor-header"><Link to="/"><Brand/></Link><span className="pill">Ambiente de teste</span></header><main className="checkout-layout">
    <section><img className="checkout-image" src={offer.imageUrl} alt={offer.name}/><p className="eyebrow">{offer.type === 'digital' ? 'PRODUTO DIGITAL' : 'PRODUTO FÍSICO'} · {offer.sellerName}</p><h1>{offer.name}</h1><p className="product-description">{offer.description}</p>{offer.type === 'physical' ? <p className="quiet">Frete por conta do vendedor. Postagem em até {offer.shippingDays} dias úteis.</p> : <p className="quiet">Download após aprovação do pagamento. Acesso ao arquivo por 12 meses.</p>}</section>
    <Card className="settings-card"><Card.Header><Card.Title>Finalizar compra de teste</Card.Title></Card.Header><Card.Content>
      <Notice message="Pagamento simulado: nenhum valor será cobrado. Use dados de teste; não informe dados de cartão."/>
      <dl className="amounts"><div><dt>Produto</dt><dd>{money(offer.priceCents)}</dd></div><div><dt>Taxa de serviço ({offer.feePolicy.basisPoints / 100}%)</dt><dd>{money(offer.feeCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(offer.totalCents)}</dd></div></dl>
      <form onSubmit={submit}><fieldset disabled={pending}><Field label="Nome completo"><input name="name" required minLength={2} maxLength={100} autoComplete="name"/></Field><Field label="E-mail para receber o produto"><input name="email" type="email" required maxLength={254} autoComplete="email"/></Field><Field label="CPF ou CNPJ" hint="Para testar, use o CPF fictício 529.982.247-25."><input name="document" required inputMode="numeric" maxLength={18}/></Field>
        {offer.type === 'physical' ? <fieldset><legend>Endereço de entrega</legend>{[['postalCode', 'CEP'], ['street', 'Rua'], ['number', 'Número'], ['complement', 'Complemento'], ['district', 'Bairro'], ['city', 'Cidade'], ['state', 'UF']].map(([name, label]) => <Field key={name} label={label!}><input name={name} required={name !== 'complement'} maxLength={name === 'state' ? 2 : name === 'postalCode' ? 9 : 100}/></Field>)}</fieldset> : null}
        <Field label="Forma de pagamento"><select name="method">{offer.paymentMethods.map(method => <option key={method} value={method}>{method === 'pix' ? 'Pix simulado' : 'Cartão de crédito simulado'}</option>)}</select></Field>
        <label className="check-row"><input type="checkbox" required/> Entendo que esta é uma compra de teste, sem cobrança.</label>
      </fieldset>{error ? <><Notice error message={error}/><Button variant="outline" onPress={() => refresh()}>Atualizar condições</Button></> : null}<Submit pending={pending}>Criar pedido de teste</Submit></form>
    </Card.Content></Card>
  </main></>;
}
