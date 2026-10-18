import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useLocation } from 'react-router';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from '@heroui/react/button';
import { uploadPresigned } from '@vercel/blob/client';
import { api, ApiError, csrfToken } from '../lib/api';
import type { Product, Profile } from '../lib/api';
import { Brand, Field, Notice, Pending, Submit } from '../components/ui';
import { BUNDLE_MAX_FILES, FileBundle } from '../components/FileBundle';
import type { BundleProgress } from '../components/FileBundle';

export default function ProductEditor() {
  const { id } = useParams();
  const { data: profile, error } = useSWR<Profile>('/seller/profile');
  const { data: product, error: productError } = useSWR<Product>(id && profile ? `/seller/products/${id}` : null);
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error || productError) return <main className="narrow"><Link to="/">← Voltar</Link><Notice error message={(error ?? productError).message}/></main>;
  if (!profile || (id && !product)) return <Pending/>;
  return <Editor key={id ?? 'new'} product={product} gateway={profile.paymentGateway} shippingEnabled={profile.shippingEnabled}/>;
}
const statusView: Record<string, { label: string; heading: string; copy: string }> = {
  active: { label: 'Publicado', heading: 'Seu checkout está disponível.', copy: 'Compartilhe o link. Para alterar qualquer dado, pause o produto primeiro.' },
  paused: { label: 'Pausado', heading: 'Produto pausado.', copy: 'O checkout está fechado para novas compras. Edite o que precisar e publique de novo para voltar a vender.' },
  draft: { label: 'Rascunho', heading: 'Prepare seu checkout.', copy: 'Confirme seu e-mail, adicione uma imagem e, para produtos digitais, os arquivos do pacote.' },
};
function Editor({ product, gateway, shippingEnabled }: { product?: Product; gateway: string; shippingEnabled: boolean }) {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const location = useLocation();
  const [type, setType] = useState(product?.type ?? 'digital');
  const [shippingMode, setShippingMode] = useState<'manual' | 'melhorenvio'>(product?.shippingMode ?? (shippingEnabled ? 'melhorenvio' : 'manual'));
  // Bundle editing: files already saved (removable) plus files picked now (uploaded on save).
  const [kept, setKept] = useState(product?.digitalFiles ?? []);
  const [added, setAdded] = useState<File[]>([]);
  const [progress, setProgress] = useState<BundleProgress | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(location.state?.saved ? 'Produto salvo como rascunho.' : '');
  // Feedback lives above the form and is brought into view: on long forms the user would otherwise miss it.
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message || error) feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [message, error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = new FormData(event.currentTarget);
    if (type === 'digital' && kept.length + added.length > BUNDLE_MAX_FILES) { setError(`O pacote aceita até ${BUNDLE_MAX_FILES} arquivos.`); return; }
    setPending(true); setError('');
    try {
      const IMAGE_LIMIT = 4 * 1024 * 1024;
      async function upload(name: string, kind: string, existing: string | null) {
        const file = form.get(name);
        if (!(file instanceof File) || file.size === 0) return existing;
        if (file.size > IMAGE_LIMIT) throw new Error('A imagem deve ter até 4 MB.');
        const data = new FormData(); data.append('file', file);
        return (await api<{ id: string }>(`/seller/assets/${kind}`, { method: 'POST', body: data })).id;
      }
      // Digital files go straight from the browser to the object store (no request-size limit);
      // the API registers the file first and validates it after the upload finishes.
      async function uploadDigital(file: File) {
        const contentType = file.type || 'application/octet-stream';
        const start = await api<{ mode: 'direct' | 'api'; id?: string; pathname?: string; maxApiBytes?: number }>('/seller/assets/digital/start', { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, contentType }) });
        if (start.mode !== 'direct') {
          if (start.maxApiBytes && file.size > start.maxApiBytes) throw new Error(`${file.name}: arquivos acima de ${Math.floor(start.maxApiBytes / 1048576)} MB não são aceitos neste ambiente.`);
          const data = new FormData(); data.append('file', file);
          return (await api<{ id: string }>('/seller/assets/digital', { method: 'POST', body: data })).id;
        }
        const csrf = csrfToken();
        await uploadPresigned(start.pathname!, file, { access: 'private', contentType, handleUploadUrl: '/api/v1/seller/assets/digital/presign', clientPayload: start.id, multipart: file.size > 8 * 1024 * 1024, headers: csrf ? { 'X-CSRF-Token': csrf } : {} });
        return (await api<{ id: string }>(`/seller/assets/digital/${start.id}/complete`, { method: 'POST' })).id;
      }
      async function uploadBundle() {
        const uploaded: string[] = new Array(added.length);
        let next = 0, done = 0;
        setProgress(added.length ? { done: 0, total: added.length, name: added[0]!.name } : null);
        await Promise.all(Array.from({ length: Math.min(3, added.length) }, async () => {
          for (let index = next++; index < added.length; index = next++) {
            const file = added[index]!;
            uploaded[index] = await uploadDigital(file);
            done++;
            setProgress({ done, total: added.length, name: file.name });
          }
        }));
        return [...kept.map(f => f.id), ...uploaded];
      }
      const [imageAssetId, digitalAssetIds] = await Promise.all([upload('image', 'image', product?.imageAssetId ?? null), type === 'digital' ? uploadBundle() : Promise.resolve([] as string[])]);
      const result = await api<Product>(product ? `/seller/products/${product.id}` : '/seller/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description'), priceCents: Math.round(Number(String(form.get('price')).replace(',', '.')) * 100), type, paymentMethods: form.getAll('methods'), imageAssetId, digitalAssetIds, stampBuyer: type === 'digital' && form.get('stampBuyer') === 'on', shippingDays: type === 'physical' ? Number(form.get('shippingDays')) : null, shippingMode: type === 'physical' ? shippingMode : 'manual', ...(type === 'physical' && shippingMode === 'melhorenvio' ? { weightGrams: Number(form.get('weightGrams')), widthCm: Number(form.get('widthCm')), heightCm: Number(form.get('heightCm')), lengthCm: Number(form.get('lengthCm')) } : { weightGrams: null, widthCm: null, heightCm: null, lengthCm: null }) }) });
      await mutate(`/seller/products/${result.id}`, result, { revalidate: false });
      setKept(result.digitalFiles); setAdded([]);
      navigate(`/produtos/${result.id}`, { replace: true, state: { saved: true } }); setMessage('Produto salvo como rascunho.');
    } catch (err) { setError((err as Error).message); } finally { setPending(false); setProgress(null); }
  }
  return <div><header className="editor-header"><Link to="/"><Brand/></Link><Link to="/">← Meus produtos</Link></header><main className="editor-layout"><section><span className="eyebrow">DO SEU JEITO</span><h1>{product ? 'Cuide da sua ideia.' : 'O que você vai criar?'}</h1><p className="quiet">Dê um nome, conte a história e prepare seu produto.</p><div ref={feedbackRef} className="editor-feedback" aria-live="polite">{error ? <Notice error message={error}/> : null}{message ? <Notice message={message}/> : null}</div><form className="editor-form" onSubmit={submit}><fieldset disabled={pending || product?.status === 'active'}><div className="type-selector"><button type="button" className={type === 'digital' ? 'selected' : ''} onClick={() => setType('digital')}><strong>↗ Digital</strong><small>E-books, guias e arquivos</small></button><button type="button" className={type === 'physical' ? 'selected' : ''} onClick={() => setType('physical')}><strong>□ Físico</strong><small>Criações para enviar</small></button></div><Field label="Nome do produto"><input name="name" defaultValue={product?.name} required minLength={2} maxLength={120} placeholder="Ex.: Guia de fotografia com o celular"/></Field><Field label="Descrição"><textarea name="description" defaultValue={product?.description} rows={5} required minLength={10} maxLength={5000} placeholder="Conte o que torna seu produto especial e o que a pessoa vai receber."/></Field><Field label="Preço (R$)"><input name="price" defaultValue={product ? (product.priceCents / 100).toFixed(2) : ''} type="number" step="0.01" min="0.01" max="1000000" required placeholder="49,90"/></Field><Field label="Imagem do produto" hint={product?.imageAssetId ? 'Uma imagem já está salva. Envie outra para substituir.' : 'JPG, PNG ou WebP. Até 4 MB.'}><input name="image" type="file" accept="image/jpeg,image/png,image/webp"/></Field>{type === 'digital' ? <><FileBundle kept={kept} added={added} disabled={pending || product?.status === 'active'} progress={progress} onKeptChange={setKept} onAddedChange={setAdded}/><label className="check-row"><input type="checkbox" name="stampBuyer" defaultChecked={product?.stampBuyer ?? false}/> Personalizar PDFs com o nome e o CPF/CNPJ do comprador no rodapé de cada página</label></> : <><Field label="Prazo de postagem (dias úteis)" hint="Dias para postar após a confirmação do pagamento."><input name="shippingDays" type="number" min="1" max="90" defaultValue={product?.shippingDays ?? 3} required/></Field>
        <Field label="Forma de envio" hint={shippingMode === 'melhorenvio' ? 'O comprador escolhe a transportadora e paga o frete no checkout. Exige conta Melhor Envio conectada e endereço de origem em Configurações → Envio.' : 'Você organiza e arca com o envio e informa o rastreio na tela Pedidos. Considere o custo no preço.'}><select name="shippingMode" value={shippingMode} onChange={e => setShippingMode(e.target.value as 'manual' | 'melhorenvio')}>{shippingEnabled ? <option value="melhorenvio">Frete calculado (Melhor Envio)</option> : null}<option value="manual">Envio manual, frete incluso no preço</option></select></Field>
        {shippingMode === 'melhorenvio' ? <fieldset className="parcel-fields"><legend>Embalagem</legend><Field label="Peso (g)"><input name="weightGrams" type="number" min="1" max="30000" required defaultValue={product?.weightGrams ?? ''}/></Field><Field label="Largura (cm)"><input name="widthCm" type="number" min="1" max="105" required defaultValue={product?.widthCm ?? ''}/></Field><Field label="Altura (cm)"><input name="heightCm" type="number" min="1" max="105" required defaultValue={product?.heightCm ?? ''}/></Field><Field label="Comprimento (cm)"><input name="lengthCm" type="number" min="1" max="105" required defaultValue={product?.lengthCm ?? ''}/></Field></fieldset> : null}</>}<fieldset><legend>Como você quer receber?</legend><div className="payment-options"><label className="check-row"><input type="checkbox" name="methods" value="pix" defaultChecked={!product || product.paymentMethods.includes('pix')}/> Pix</label><label className="check-row"><input type="checkbox" name="methods" value="card" defaultChecked={!product || product.paymentMethods.includes('card')}/> Cartão de crédito</label></div></fieldset><div className="editor-actions"><Link to="/">Voltar</Link><Submit pending={pending}>Salvar produto →</Submit></div></fieldset></form></section><aside className="editor-aside"><span className="eyebrow">UM PASSO DE CADA VEZ</span><h2>Uma boa ideia<br/>merece uma boa<br/>apresentação.</h2><p>Use uma imagem nítida, uma descrição clara e um nome fácil de lembrar.</p><hr/>{product ? <span className={`product-status product-status--${product.status}`}><span aria-hidden="true">●</span> {statusView[product.status]?.label ?? product.status}</span> : null}<h3>{statusView[product?.status ?? 'draft']?.heading}</h3><p>{statusView[product?.status ?? 'draft']?.copy} {gateway === 'simulated' ? 'As compras usam pagamento simulado.' : 'As compras são processadas pelo Mercado Pago.'}</p>{product ? <div className="product-actions"><Button {...(product.status === 'active' ? { variant: 'outline' as const } : { className: 'primary-button' })} isDisabled={pending} onPress={async () => {
    setPending(true); setError('');
    try { const result = await api<{ message: string }>(`/seller/products/${product.id}/${product.status === 'active' ? 'pause' : 'publish'}`, { method: 'POST' }); await mutate(`/seller/products/${product.id}`); setMessage(result.message); }
    catch (err) { setError((err as Error).message); } finally { setPending(false); }
  }}>{product.status === 'active' ? 'Pausar para editar' : product.status === 'paused' ? 'Publicar novamente' : 'Publicar produto'}</Button>{product.status === 'active' ? <><Field label="Link do checkout"><input readOnly value={`${window.location.origin}/checkout/${product.publicId}`}/></Field><Button variant="outline" onPress={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/checkout/${product.publicId}`); setMessage('Link copiado.'); } catch { setError('Selecione e copie o link do campo acima.'); } }}>Copiar link</Button><a className="button button--outline" href={`/checkout/${product.publicId}`} target="_blank" rel="noreferrer">Abrir checkout</a></> : null}<Link className="button button--outline" to={`/pedidos?productId=${product.id}`}>Ver pedidos do produto</Link></div> : null}</aside></main></div>;
}
