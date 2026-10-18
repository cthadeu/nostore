import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string }
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  /** Shows the message as an error when it comes from a rejected promise, as success otherwise. */
  dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const LIFETIME: Record<ToastKind, number> = { success: 5000, error: 9000 };

// Transient feedback for actions the person just took. Messages that describe a lasting state
// (an environment notice, a failed shipment, a page that could not load) stay on the page instead.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [paused, setPaused] = useState(false);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string) => {
    const text = message.trim();
    if (!text) return;
    setToasts(current => {
      // The same message twice in a row moves to the end rather than stacking a duplicate.
      const without = current.filter(toast => toast.message !== text || toast.kind !== kind);
      return [...without, { id: nextId.current++, kind, message: text }].slice(-3);
    });
  }, []);

  // One timer for the oldest toast: they expire in order, and hovering the stack holds them all.
  useEffect(() => {
    const oldest = toasts[0];
    if (!oldest || paused) return;
    const timer = setTimeout(() => dismiss(oldest.id), LIFETIME[oldest.kind]);
    return () => clearTimeout(timer);
  }, [toasts, paused, dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: message => push('success', message),
    error: message => push('error', message),
    dismissAll: () => setToasts([]),
  }), [push]);

  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="false" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      {toasts.map(toast => <div key={toast.id} className={`toast-card toast-card--${toast.kind}`}>
        <span aria-hidden="true" className="toast-card-icon">{toast.kind === 'error' ? '!' : '✓'}</span>
        <p>{toast.message}</p>
        <button type="button" onClick={() => dismiss(toast.id)} aria-label="Fechar aviso">×</button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast exige o ToastProvider na árvore.');
  return api;
}
