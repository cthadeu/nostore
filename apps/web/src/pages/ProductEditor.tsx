import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useLocation } from 'react-router';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from '@heroui/react/button';
import { api, ApiError } from '../lib/api';
import type { Product, Profile } from '../lib/api';
import { Brand, Field, Notice, Pending, Submit } from '../components/ui';

export default function ProductEditor() {
  const { id } = useParams();
  const { data: profile, error } = useSWR<Profile>('/seller/profile');
  const { data: product, error: productError } = useSWR<Product>(id && profile ? `/seller/products/${id}` : null);
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/entrar" replace/>;
  if (error || productError) return <main className="narrow"><Link to="/">← Voltar</Link><Notice error message={(error ?? productError).message}/></main>;
  if (!profile || (id && !product)) return <Pending/>;
  return <Editor key={id ?? 'new'} product={product}/>;
}
function Editor({ product }: { product?: Product }) {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const location = useLocation();
  const [type, setType] = useState(product?.type ?? 'digital');
  // Bundle editing: files already saved (removable) plus files picked now (uploaded on save).
  const [kept, setKept] = useState(product?.digitalFiles ?? []);
  const [added, setAdded] = useState<File[]>([]);
  const fileSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(location.state?.saved ? 'Produto salvo como rascunho.' : '');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      async function upload(name: string, kind: string, existing: string | null) {
        const file = form.get(name);
        if (!(file instanceof File) || file.size === 0) return existing;
        const data = new FormData(); data.append('file', file);
        return (await api<{ id: string }>(`/seller/assets/${kind}`, { method: 'POST', body: data })).id;
      }
      async function uploadBundle() {
        const ids = kept.map(f => f.id);
        for (const file of added) { const data = new FormData(); data.append('file', file); ids.push((await api<{ id: string }>('/seller/assets/digital', { method: 'POST', body: data })).id); }
        return ids;
      }
      const [imageAssetId, digitalAssetIds] = await Promise.all([upload('image', 'image', product?.imageAssetId ?? null), type === 'digital' ? uploadBundle() : Promise.resolve([] as string[])]);
      const result = await api<Product>(product ? `/seller/products/${product.id}` : '/seller/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description'), priceCents: Math.round(Number(String(form.get('price')).replace(',', '.')) * 100), type, paymentMethods: form.getAll('methods'), imageAssetId, digitalAssetIds, shippingDays: type === 'physical' ? Number(form.get('shippingDays')) : null }) });
      await mutate(`/seller/products/${result.id}`, result, { revalidate: false });
      setKept(result.digitalFiles); setAdded([]);
      navigate(`/produtos/${result.id}`, { replace: true, state: { saved: true } }); setMessage('Produto salvo como rascunho.');
    } catch (err) { setError((err as Error).message); } finally { setPending(false); }
  }
  return <div><header className="editor-header"><Link to="/"><Brand/></Link><Link to="/">← Meus produtos</Link></header><main className="editor-layout"><section><span className="eyebrow">DO SEU JEITO</span><h1>{product ? 'Cuide da sua ideia.' : 'O que você vai criar?'}</h1><p className="quiet">Dê um nome, conte a história e prepare seu produto.</p><form className="editor-form" onSubmit={submit}><fieldset disabled={pending || product?.status === 'active'}><div className="type-selector"><button type="button" className={type === 'digital' ? 'selected' : ''} onClick={() => setType('digital')}><strong>↗ Digital</strong><small>E-books, guias e arquivos</small></button><button type="button" className={type === 'physical' ? 'selected' : ''} onClick={() => setType('physical')}><strong>□ Físico</strong><small>Criações para enviar</small></button></div><Field label="Nome do produto"><input name="name" defaultValue={product?.name} required minLength={2} maxLength={120} placeholder="Ex.: Guia de fotografia com o celular"/></Field><Field label="Descrição"><textarea name="description" defaultValue={product?.description} rows={5} required minLength={10} maxLength={5000} placeholder="Conte o que torna seu produto especial e o que a pessoa vai receber."/></Field><Field label="Preço (R$)"><input name="price" defaultValue={product ? (product.priceCents / 100).toFixed(2) : ''} type="number" step="0.01" min="0.01" max="1000000" required placeholder="49,90"/></Field><Field label="Imagem do produto" hint={product?.imageAssetId ? 'Uma imagem já está salva. Envie outra para substituir.' : 'JPG, PNG ou WebP. Até 8 MB.'}><input name="image" type="file" accept="image/jpeg,image/png,image/webp"/></Field>{type === 'digital' ? <><Field label="Arquivos digitais" hint="PDF, EPUB ou ZIP, até 100 MB cada. Adicione quantos quiser, um de cada vez ou vários juntos: o comprador recebe tudo em um único ZIP. Os arquivos ficam privados."><input type="file" accept=".pdf,.epub,.zip" multiple onChange={e => { setAdded(a => [...a, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }}/></Field>{kept.length + added.length ? <ul className="file-list" aria-label="Arquivos do pacote">{kept.map(f => <li key={f.id}><span>{f.name}</span><small>{fileSize(f.size)} · salvo</small><button type="button" onClick={() => setKept(k => k.filter(x => x.id !== f.id))}>Remover</button></li>)}{added.map((f, i) => <li key={`novo-${i}-${f.name}`}><span>{f.name}</span><small>{fileSize(f.size)} · novo</small><button type="button" onClick={() => setAdded(a => a.filter((_, j) => j !== i))}>Remover</button></li>)}</ul> : <p className="quiet">Nenhum arquivo no pacote ainda.</p>}</> : <Field label="Prazo de postagem (dias úteis)" hint="O custo e a organização do envio são de sua responsabilidade."><input name="shippingDays" type="number" min="1" max="90" defaultValue="3" required/></Field>}<fieldset><legend>Como você quer receber?</legend><div className="payment-options"><label className="check-row"><input type="checkbox" name="methods" value="pix" defaultChecked={!product || product.paymentMethods.includes('pix')}/> Pix</label><label className="check-row"><input type="checkbox" name="methods" value="card" defaultChecked={!product || product.paymentMethods.includes('card')}/> Cartão de crédito</label></div></fieldset>{error ? <Notice error message={error}/> : null}{message ? <Notice message={message}/> : null}<div className="editor-actions"><Link to="/">Voltar</Link><Submit pending={pending}>Salvar produto →</Submit></div></fieldset></form></section><aside className="editor-aside"><span className="eyebrow">UM PASSO DE CADA VEZ</span><h2>Uma boa ideia<br/>merece uma boa<br/>apresentação.</h2><p>Use uma imagem nítida, uma descrição clara e um nome fácil de lembrar.</p><hr/><h3>{product?.status === 'active' ? 'Seu checkout está disponível.' : 'Prepare seu checkout.'}</h3><p>Confirme seu e-mail, adicione uma imagem e, para produtos digitais, um arquivo verificado. As compras usam pagamento simulado.</p>{product ? <><Button variant="outline" isDisabled={pending} onPress={async () => {
    setPending(true); setError('');
    try { const result = await api<{ message: string }>(`/seller/products/${product.id}/${product.status === 'active' ? 'pause' : 'publish'}`, { method: 'POST' }); await mutate(`/seller/products/${product.id}`); setMessage(result.message); }
    catch (err) { setError((err as Error).message); } finally { setPending(false); }
  }}>{product.status === 'active' ? 'Pausar para editar' : 'Publicar produto'}</Button>{product.status === 'active' ? <div className="checkout-links"><Field label="Link do checkout"><input readOnly value={`${window.location.origin}/checkout/${product.publicId}`}/></Field><Button variant="outline" onPress={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/checkout/${product.publicId}`); setMessage('Link copiado.'); } catch { setError('Selecione e copie o link do campo acima.'); } }}>Copiar link</Button><a className="button button--outline" href={`/checkout/${product.publicId}`} target="_blank" rel="noreferrer">Abrir checkout</a></div> : null}<Link className="button button--outline" to={`/pedidos?productId=${product.id}`}>Ver pedidos do produto</Link></> : null}</aside></main></div>;
}
