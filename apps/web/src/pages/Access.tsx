import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { Brand, Field, Notice, Submit } from '../components/ui';
export default function Access({ reset = false }: { reset?: boolean }) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const data = new FormData(event.currentTarget); setPending(true); setError('');
    try {
      const result = await api<{ message: string }>(`/auth/${reset ? 'reset-password' : 'verify-email'}`, { method: 'POST', body: JSON.stringify({ token, ...(reset ? { password: data.get('password') } : {}) }) });
      setMessage(result.message); window.history.replaceState(null, '', window.location.pathname);
    } catch (err) { setError((err as Error).message); } finally { setPending(false); }
  }
  return <main className="narrow"><Brand/><h1>{reset ? 'Um novo começo.' : 'Confirme seu e-mail.'}</h1><p>{reset ? 'Escolha sua nova senha para voltar à nostore.' : 'Confirme abaixo para continuar preparando seus produtos.'}</p>{message ? <><Notice message={message}/><Link className="button button--primary" to={reset ? '/entrar' : '/'}>Continuar →</Link></> : <form onSubmit={submit}>{reset ? <Field label="Nova senha"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field> : null}{error ? <Notice error message={error}/> : null}<Submit pending={pending}>{reset ? 'Atualizar senha' : 'Confirmar meu e-mail'}</Submit></form>}</main>;
}
