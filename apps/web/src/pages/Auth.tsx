import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';
import { api } from '../lib/api';
import { Brand, Field, Submit } from '../components/ui';
import { useToast } from '../components/Toast';

export default function Auth({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    try {
      const result = await api<{ message: string }>(`/auth/${recovery ? 'forgot-password' : register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ email: data.get('email'), ...(recovery ? {} : { password: data.get('password') }), ...(register && !recovery ? { name: data.get('name'), acceptTerms: data.get('terms') === 'on' } : {}) }) });
      if (recovery) toast.success(result.message);
      else { await mutate(() => true, undefined, { revalidate: false }); navigate('/'); }
    } catch (err) { toast.error((err as Error).message); } finally { setPending(false); }
  }
  return <div className="auth-layout"><section className="auth-story"><Brand/><div><span className="eyebrow">MENOS LOJA. MAIS POSSIBILIDADES.</span><h1>Sua próxima<br/>ideia merece<br/><em>ir mais longe.</em></h1><p>Transforme o que você cria em um produto.<br/>A gente simplifica o caminho até a venda.</p><div className="story-detail"><span>01</span> Seu produto. Seu link. Suas vendas.</div></div><small>Feito para quem quer começar.</small></section><main className="auth-form"><div className="mobile-brand"><Brand/></div><div className="auth-inner"><span className="eyebrow">SEU ESPAÇO NA NOSTORE</span><h2>{recovery ? 'Vamos recuperar seu acesso.' : register ? 'Comece com uma ideia.' : 'Bom ter você de volta.'}</h2><p>{recovery ? 'Enviaremos um link para definir uma nova senha.' : register ? 'Crie sua conta grátis e prepare seus primeiros produtos.' : 'Entre para cuidar dos seus produtos e das suas vendas.'}</p><form onSubmit={submit}>
      {register && !recovery ? <Field label="Seu nome"><input name="name" autoComplete="name" required minLength={2} maxLength={100} placeholder="Como podemos chamar você?"/></Field> : null}
      <Field label="E-mail"><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="voce@exemplo.com"/></Field>
      {!recovery ? <Field label="Senha" hint={register ? 'Use pelo menos 12 caracteres.' : undefined}><input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : 1} maxLength={128} placeholder="Sua senha"/></Field> : null}
      {register && !recovery ? <label className="check-row"><input name="terms" type="checkbox" required/>Concordo com as condições de uso desta versão de desenvolvimento.</label> : null}
      <Submit pending={pending}>{recovery ? 'Enviar instruções' : register ? 'Criar minha conta →' : 'Entrar na minha conta →'}</Submit>
    </form><div className="auth-links">{!register ? <button onClick={() => { setRecovery(!recovery); toast.dismissAll(); }}>{recovery ? 'Voltar para entrar' : 'Esqueci minha senha'}</button> : null}<p>{register ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <Link to={register ? '/entrar' : '/cadastro'}>{register ? 'Entrar' : 'Começar grátis'}</Link></p></div></div><small className="auth-footer">Um jeito mais simples de vender.</small></main></div>;
}
