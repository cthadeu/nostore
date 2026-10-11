import { Button } from '@heroui/react/button';
import { cloneElement, useId } from 'react';
import type { ReactNode, ReactElement } from 'react';
export function Brand() { return <span className="brand"><span className="brand-icon" aria-hidden="true">n.</span>nostore<span className="brand-dot">®</span></span>; }
export function Field({ label, children, hint }: { label: string; children: ReactElement<{ id?: string; 'aria-describedby'?: string }>; hint?: string }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint ? <small id={`${id}-hint`}>{hint}</small> : null}</div>;
}
export function Notice({ message, error = false }: { message: string; error?: boolean }) { return <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}>{message}</div>; }
export function Pending() { return <div className="loading" role="status">Preparando seu espaço…</div>; }
export function Submit({ pending, children }: { pending: boolean; children: ReactNode }) { return <Button type="submit" isPending={pending} className="primary-button">{pending ? 'Só um instante…' : children}</Button>; }
