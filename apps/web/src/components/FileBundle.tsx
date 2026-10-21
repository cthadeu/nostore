import { useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';

export interface BundleFile { id: string; name: string; size: number }
export interface BundleProgress { done: number; total: number; name: string }

export const BUNDLE_MAX_FILES = 40;
export const BUNDLE_EXTENSIONS = ['.pdf', '.epub', '.zip', '.jpg', '.jpeg', '.png', '.gp', '.gpx', '.gp3', '.gp4', '.gp5'];
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const extensionOf = (name: string) => (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();

// Bundle editor for a digital product: drag files in or pick them, see everything that will be sold
// together, and remove any item. Saved files and newly picked ones share one list, in sale order.
export function FileBundle({ kept, added, disabled, progress, onKeptChange, onAddedChange }: {
  kept: BundleFile[];
  added: File[];
  disabled: boolean;
  progress: BundleProgress | null;
  onKeptChange: (files: BundleFile[]) => void;
  onAddedChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [warning, setWarning] = useState('');
  const hintId = useId();
  const total = kept.length + added.length;
  const totalBytes = kept.reduce((sum, f) => sum + f.size, 0) + added.reduce((sum, f) => sum + f.size, 0);
  const full = total >= BUNDLE_MAX_FILES;

  function accept(files: File[]) {
    if (disabled) return;
    const rejected: string[] = [], duplicated: string[] = [], oversized: string[] = [];
    const chosen: File[] = [];
    let room = BUNDLE_MAX_FILES - total;
    for (const file of files) {
      if (!BUNDLE_EXTENSIONS.includes(extensionOf(file.name))) { rejected.push(file.name); continue; }
      if (file.size > MAX_FILE_BYTES) { oversized.push(file.name); continue; }
      const already = kept.some(k => k.name === file.name && k.size === file.size) || added.some(a => a.name === file.name && a.size === file.size) || chosen.some(c => c.name === file.name && c.size === file.size);
      if (already) { duplicated.push(file.name); continue; }
      if (room <= 0) continue;
      room--; chosen.push(file);
    }
    const notices = [
      rejected.length ? `${rejected.length} arquivo(s) ignorado(s) por formato não aceito` : '',
      oversized.length ? `${oversized.length} arquivo(s) acima de 100 MB` : '',
      duplicated.length ? `${duplicated.length} arquivo(s) já estavam no pacote` : '',
      files.length - rejected.length - oversized.length - duplicated.length > chosen.length ? `limite de ${BUNDLE_MAX_FILES} arquivos atingido` : '',
    ].filter(Boolean);
    setWarning(notices.join('. '));
    if (chosen.length) onAddedChange([...added, ...chosen]);
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false);
    accept(Array.from(event.dataTransfer.files));
  }

  return <div className="bundle">
    <div
      className={`bundle-drop${dragging ? ' dragging' : ''}${disabled || full ? ' disabled' : ''}`}
      onDragOver={event => { event.preventDefault(); if (!disabled && !full) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => { if (!disabled && !full) inputRef.current?.click(); }}
      onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !disabled && !full) { event.preventDefault(); inputRef.current?.click(); } }}
      role="button" tabIndex={disabled || full ? -1 : 0} aria-describedby={hintId}
    >
      <strong>{full ? `Limite de ${BUNDLE_MAX_FILES} arquivos atingido` : 'Arraste os arquivos aqui ou clique para escolher'}</strong>
      <small id={hintId}>PDF, EPUB, ZIP, JPG, PNG ou Guitar Pro (.gp, .gpx, .gp5), até 100 MB cada. Dá para selecionar vários de uma vez e voltar depois para adicionar mais.</small>
      <input
        ref={inputRef} type="file" multiple accept={BUNDLE_EXTENSIONS.join(',')} disabled={disabled || full}
        onChange={event => { accept(Array.from(event.target.files ?? [])); event.target.value = ''; }}
      />
    </div>

    <div className="bundle-summary">
      <span>{total === 0 ? 'Nenhum arquivo no pacote' : `${total} de ${BUNDLE_MAX_FILES} arquivo(s) · ${formatSize(totalBytes)}`}</span>
      {total > 1 ? <span className="quiet">O comprador recebe tudo em um único ZIP.</span> : null}
    </div>
    {warning ? <p className="bundle-warning" role="status">{warning}</p> : null}
    {progress ? <p className="bundle-progress" role="status">Enviando {progress.done} de {progress.total}: {progress.name}</p> : null}

    {total ? <ul className="file-list" aria-label="Arquivos do pacote">
      {kept.map((file, index) => <li key={file.id}>
        <span className="file-index">{index + 1}</span>
        <span className="file-name">{file.name}</span>
        <small>{formatSize(file.size)} · salvo</small>
        <button type="button" disabled={disabled} onClick={() => { setWarning(''); onKeptChange(kept.filter(f => f.id !== file.id)); }} aria-label={`Remover ${file.name}`}>Remover</button>
      </li>)}
      {added.map((file, index) => <li key={`novo-${index}-${file.name}-${file.size}`}>
        <span className="file-index">{kept.length + index + 1}</span>
        <span className="file-name">{file.name}</span>
        <small>{formatSize(file.size)} · novo</small>
        <button type="button" disabled={disabled} onClick={() => { setWarning(''); onAddedChange(added.filter((_, position) => position !== index)); }} aria-label={`Remover ${file.name}`}>Remover</button>
      </li>)}
    </ul> : null}
  </div>;
}
