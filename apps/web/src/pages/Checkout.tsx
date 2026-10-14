import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import useSWR from 'swr';
import { Card } from '@heroui/react/card';
import { Button } from '@heroui/react/button';
import { api, money } from '../lib/api';
import type { Order, ShippingQuote } from '../lib/api';
import { Brand, Field, Notice, Pending, Submit } from '../components/ui';
import { PixPanel } from '../components/PixPanel';

type Offer = { publicId: string; gateway: string; publicKey: string | null; shippingMode: string; version: string; name: string; description: string; sellerName: string; imageUrl: string; type: string; paymentMethods: string[]; priceCents: number; feeCents: number; totalCents: number; feePolicy: { id: string; basisPoints: number }; shippingDays: number | null };
type CardData = { token: string; paymentMethodId: string; issuerId?: string };
type CheckoutResult = { order: Order; accessUrl: string };
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');

export default function Checkout() {
  const { id } = useParams();
  const { data, error, mutate } = useSWR<Offer>(`/checkout/${id}`, { revalidateOnFocus: false });
  if (error) return <main className="narrow"><Brand/><Notice error message={error.message}/><Button onPress={() => mutate()}>Tentar novamente</Button></main>;
  if (!data) return <Pending/>;
  return <CheckoutForm key={`${data.version}-${data.feePolicy.id}`} offer={data} refresh={() => mutate()}/>;
}

function CheckoutForm({ offer, refresh }: { offer: Offer; refresh: () => unknown }) {
  const simulated = offer.gateway === 'simulated';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [method, setMethod] = useState(offer.paymentMethods[0] ?? 'pix');
  const [buyer, setBuyer] = useState<{ name: string; email: string; document: string; address?: Record<string, string> } | null>(null);
  const [pixOrder, setPixOrder] = useState<CheckoutResult | null>(null);
  // Freight: quotes for the typed postal code; the chosen service id travels with the order.
  const calculated = offer.type === 'physical' && offer.shippingMode === 'melhorenvio';
  const [postalCode, setPostalCode] = useState('');
  const [quotes, setQuotes] = useState<ShippingQuote[] | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [serviceId, setServiceId] = useState<number | null>(null);
  async function fetchQuotes(cep: string) {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) { setQuotes(null); setServiceId(null); return; }
    setQuoting(true); setQuoteError('');
    try { const result = await api<{ quotes: ShippingQuote[] }>(`/checkout/${offer.publicId}/shipping-quotes`, { method: 'POST', body: JSON.stringify({ postalCode: digits }) }); setQuotes(result.quotes); setServiceId(result.quotes[0]?.serviceId ?? null); if (!result.quotes.length) setQuoteError('Nenhuma transportadora atende este CEP para este produto.'); }
    catch (err) { setQuotes(null); setServiceId(null); setQuoteError((err as Error).message); } finally { setQuoting(false); }
  }
  const chosen = quotes?.find(q => q.serviceId === serviceId) ?? null;
  const shippingCents = calculated ? (chosen?.priceCents ?? 0) : 0;
  const checkoutToken = useRef(newToken());
  const submitted = useRef<string | null>(null);

  async function createOrder(values: Record<string, unknown>, card?: CardData) {
    const fingerprint = JSON.stringify({ ...values, card: card?.token });
    // A retry of the same submission reuses its token; changed data (or a new card token) starts another intent.
    if (submitted.current && submitted.current !== fingerprint) checkoutToken.current = newToken();
    submitted.current = fingerprint;
    return api<CheckoutResult>('/checkout/orders', { method: 'POST', body: JSON.stringify({ ...values, card, checkoutToken: checkoutToken.current }) });
  }
  function readForm(form: FormData) {
    const address = offer.type === 'physical' ? Object.fromEntries(['postalCode', 'street', 'number', 'complement', 'district', 'city', 'state'].map(key => [key, String(form.get(key) ?? '').trim()])) : undefined;
    if (address) { address.postalCode = address.postalCode.replace(/\D/g, ''); address.state = address.state.toUpperCase(); }
    return { name: String(form.get('name') ?? '').trim(), email: String(form.get('email') ?? '').trim(), document: String(form.get('document') ?? '').replace(/\D/g, ''), address };
  }
  function baseValues(b: NonNullable<typeof buyer>) {
    return { productId: offer.publicId, productVersion: offer.version, feePolicyId: offer.feePolicy.id, buyerName: b.name, buyerEmail: b.email, buyerDocument: b.document, method, address: b.address, ...(calculated && serviceId ? { shippingServiceId: serviceId } : {}), ...(simulated ? { acceptSimulation: true } : {}) };
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const b = readForm(new FormData(event.currentTarget));
    if (calculated && !chosen) { setError('Informe o CEP e escolha uma opção de frete.'); return; }
    if (!simulated && method === 'card') { setBuyer(b); setError(''); return; }
    setPending(true); setError('');
    try {
      const result = await createOrder(baseValues(b));
      if (!simulated && method === 'pix' && result.order.pix) { setPixOrder(result); setBuyer(b); setPending(false); return; }
      window.location.assign(result.accessUrl);
    } catch (err) { setError((err as Error).message); setPending(false); }
  }
  async function payWithCard(card: CardData) {
    if (!buyer || pending) return;
    setPending(true); setError('');
    try { const result = await createOrder(baseValues(buyer), card); window.location.assign(result.accessUrl); }
    catch (err) { setError((err as Error).message); setPending(false); }
  }
  // Pix: poll the order with the checkout token until the payment is confirmed, then open the order page.
  useEffect(() => {
    if (!pixOrder) return;
    const timer = setInterval(async () => {
      try {
        const order = await api<Order>('/buyer/order', { method: 'POST', body: JSON.stringify({ token: checkoutToken.current }) });
        if (order.status !== 'pending') { clearInterval(timer); window.location.assign(pixOrder.accessUrl); }
        else setPixOrder(current => current ? { ...current, order } : current);
      } catch { /* keep polling; transient errors are expected */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [pixOrder?.accessUrl]);

  const methodLabel = (m: string) => m === 'pix' ? (simulated ? 'Pix simulado' : 'Pix') : (simulated ? 'Cartão de crédito simulado' : 'Cartão de crédito');
  return <><header className="editor-header"><Link to="/"><Brand/></Link>{simulated ? <span className="pill">Ambiente de teste</span> : <span className="pill">Pagamento seguro · Mercado Pago</span>}</header><main className="checkout-layout">
    <section><img className="checkout-image" src={offer.imageUrl} alt={offer.name}/><p className="eyebrow">{offer.type === 'digital' ? 'PRODUTO DIGITAL' : 'PRODUTO FÍSICO'} · {offer.sellerName}</p><h1>{offer.name}</h1><p className="product-description">{offer.description}</p>{offer.type === 'physical' ? <p className="quiet">Frete por conta do vendedor. Postagem em até {offer.shippingDays} dias úteis.</p> : <p className="quiet">Download liberado logo após a confirmação do pagamento, por link permanente enviado ao seu e-mail.</p>}</section>
    <Card className="settings-card"><Card.Header><Card.Title>{simulated ? 'Finalizar compra de teste' : 'Finalizar compra'}</Card.Title></Card.Header><Card.Content>
      {simulated ? <Notice message="Pagamento simulado: nenhum valor será cobrado. Use dados de teste; não informe dados de cartão."/> : null}
      <dl className="amounts"><div><dt>Produto</dt><dd>{money(offer.priceCents)}</dd></div><div><dt>Taxa de serviço ({offer.feePolicy.basisPoints / 100}%)</dt><dd>{money(offer.feeCents)}</dd></div>{calculated ? <div><dt>Frete{chosen ? ` · ${chosen.carrier} ${chosen.name}` : ''}</dt><dd>{chosen ? money(chosen.priceCents) : 'a calcular'}</dd></div> : null}<div className="total"><dt>Total</dt><dd>{money(offer.totalCents + shippingCents)}</dd></div></dl>
      {pixOrder ? <><Notice message={`Pedido ${pixOrder.order.id} criado. Assim que o pagamento for confirmado, você será levado à página do pedido.`}/><PixPanel order={pixOrder.order}/></> : null}
      {!pixOrder && !(buyer && method === 'card' && !simulated) ? <form onSubmit={submit}><fieldset disabled={pending}><Field label="Nome completo"><input name="name" required minLength={2} maxLength={100} autoComplete="name" defaultValue={buyer?.name}/></Field><Field label="E-mail para receber o produto"><input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={buyer?.email}/></Field><Field label="CPF ou CNPJ" hint={simulated ? 'Para testar, use o CPF fictício 529.982.247-25.' : 'Exigido pelo Mercado Pago para identificar o pagamento.'}><input name="document" required inputMode="numeric" maxLength={18} defaultValue={buyer?.document}/></Field>
        {offer.type === 'physical' ? <fieldset><legend>Endereço de entrega</legend>
          <Field label="CEP" hint={calculated ? 'As opções de frete aparecem assim que o CEP for informado.' : undefined}><input name="postalCode" required inputMode="numeric" maxLength={9} value={postalCode || buyer?.address?.postalCode || ''} onChange={e => { setPostalCode(e.target.value); if (calculated) void fetchQuotes(e.target.value); }}/></Field>
          {calculated ? <div className="shipping-options" aria-live="polite">{quoting ? <p className="quiet">Calculando frete…</p> : null}{quoteError ? <Notice error message={quoteError}/> : null}{quotes?.map(q => <label key={q.serviceId} className="check-row shipping-option"><input type="radio" name="shippingServiceId" value={q.serviceId} checked={serviceId === q.serviceId} onChange={() => setServiceId(q.serviceId)}/> <span><strong>{q.carrier} {q.name}</strong> · {money(q.priceCents)} · até {q.deliveryDays} dias úteis</span></label>)}</div> : null}
          {[['street', 'Rua'], ['number', 'Número'], ['complement', 'Complemento'], ['district', 'Bairro'], ['city', 'Cidade'], ['state', 'UF']].map(([name, label]) => <Field key={name} label={label!}><input name={name} required={name !== 'complement'} maxLength={name === 'state' ? 2 : 100} defaultValue={buyer?.address?.[name!]}/></Field>)}</fieldset> : null}
        <Field label="Forma de pagamento"><select name="method" value={method} onChange={e => setMethod(e.target.value)}>{offer.paymentMethods.map(m => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></Field>
        {simulated ? <label className="check-row"><input type="checkbox" required/> Entendo que esta é uma compra de teste, sem cobrança.</label> : null}
      </fieldset>{error ? <><Notice error message={error}/><Button variant="outline" onPress={() => refresh()}>Atualizar condições</Button></> : null}<Submit pending={pending}>{simulated ? 'Criar pedido de teste' : method === 'card' ? 'Continuar para o cartão' : 'Gerar Pix'}</Submit></form> : null}
      {buyer && method === 'card' && !simulated && !pixOrder ? <CardBrick publicKey={offer.publicKey ?? ''} amountCents={offer.totalCents + shippingCents} email={buyer.email} pending={pending} error={error} onBack={() => { setBuyer(null); setError(''); }} onSubmit={payWithCard}/> : null}
    </Card.Content></Card>
  </main></>;
}

declare global { interface Window { MercadoPago?: new (publicKey: string, options?: { locale?: string }) => { bricks(): { create(type: string, container: string, settings: unknown): Promise<{ unmount(): void }> } } } }
let sdkPromise: Promise<void> | null = null;
function loadSdk() {
  if (window.MercadoPago) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://sdk.mercadopago.com/js/v2'; script.async = true; script.onload = () => resolve(); script.onerror = () => reject(new Error('Não foi possível carregar o Mercado Pago. Verifique sua conexão.')); document.head.appendChild(script); });
  return sdkPromise;
}
// Card data never touches our servers: the Brick tokenizes it with the seller's public key.
function CardBrick({ publicKey, amountCents, email, pending, error, onBack, onSubmit }: { publicKey: string; amountCents: number; email: string; pending: boolean; error: string; onBack: () => void; onSubmit: (card: CardData) => Promise<void> }) {
  const [loadError, setLoadError] = useState('');
  const submitRef = useRef(onSubmit); submitRef.current = onSubmit;
  useEffect(() => {
    let controller: { unmount(): void } | null = null; let cancelled = false;
    loadSdk().then(async () => {
      if (cancelled || !window.MercadoPago) return;
      const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      controller = await mp.bricks().create('cardPayment', 'cardPaymentBrick_container', {
        initialization: { amount: amountCents / 100, payer: { email } },
        customization: { paymentMethods: { maxInstallments: 1 }, visual: { style: { theme: 'default' } } },
        callbacks: {
          onReady: () => {},
          onError: (e: { message?: string }) => setLoadError(e?.message ?? 'Erro no formulário de cartão.'),
          onSubmit: (formData: { token: string; payment_method_id: string; issuer_id?: string | number }) => submitRef.current({ token: formData.token, paymentMethodId: formData.payment_method_id, issuerId: formData.issuer_id !== undefined ? String(formData.issuer_id) : undefined }),
        },
      });
    }).catch(err => setLoadError((err as Error).message));
    return () => { cancelled = true; controller?.unmount(); };
  }, [publicKey, amountCents, email]);
  return <div>
    <Notice message="Pagamento à vista no cartão de crédito, processado pelo Mercado Pago. Seus dados de cartão não passam pela nostore."/>
    <div id="cardPaymentBrick_container"/>
    {loadError ? <Notice error message={loadError}/> : null}{error ? <Notice error message={error}/> : null}{pending ? <Notice message="Processando pagamento…"/> : null}
    <Button variant="outline" onPress={onBack} isDisabled={pending}>Voltar e revisar dados</Button>
  </div>;
}
