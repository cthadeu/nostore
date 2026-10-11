// Transactional e-mail in the site's visual language: Inter/system font, ink text on soft background,
// green brand mark, rounded card and the same primary button. Table layout and inline styles for
// e-mail clients; a plain-text twin is always generated for clients that do not render HTML.
export interface MailSpec {
  subject: string;
  eyebrow?: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  secondary?: { label: string; url: string };
  facts?: { label: string; value: string }[];
  note?: string;
  /** Simulated environment: adds the "no money moves" banner and the [Teste] subject tag. */
  test?: boolean;
}
export interface MailContent { subject: string; text: string; html: string }

const palette = { ink: '#5e565a', green: '#a9cbb7', line: '#eeedeb', soft: '#f8f9f7', muted: '#8a8386', noticeBg: '#f0f6f2', noticeLine: '#d6e3d9' };
const font = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function composeMail(spec: MailSpec, to: string): MailContent {
  const subject = `${spec.test ? '[Teste] ' : ''}${spec.subject}`;
  const textLines = [spec.heading, '', ...spec.paragraphs];
  if (spec.facts?.length) textLines.push('', ...spec.facts.map(f => `${f.label}: ${f.value}`));
  if (spec.action) textLines.push('', `${spec.action.label}: ${spec.action.url}`);
  if (spec.secondary) textLines.push(`${spec.secondary.label}: ${spec.secondary.url}`);
  if (spec.note) textLines.push('', spec.note);
  if (spec.test) textLines.push('', 'Ambiente de demonstração: nenhum valor foi cobrado.');
  textLines.push('', 'nostore');
  const p = (html: string, extra = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${palette.ink};${extra}">${html}</p>`;
  const button = (label: string, url: string) => `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 18px"><tr><td style="background:${palette.ink};border-radius:10px"><a href="${escape(url)}" style="display:inline-block;padding:13px 22px;font-family:${font};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none">${escape(label)}</a></td></tr></table>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${palette.soft};font-family:${font};color:${palette.ink}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${palette.soft}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%">
<tr><td style="padding:0 6px 18px"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="background:${palette.green};border-radius:10px;width:34px;height:34px;text-align:center;vertical-align:middle;font-size:22px;font-weight:700;letter-spacing:-1px;color:${palette.ink}">n.</td>
<td style="padding-left:9px;font-size:24px;font-weight:700;letter-spacing:-1px;color:${palette.ink}">nostore<sup style="font-size:9px;font-weight:600">&reg;</sup></td></tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${palette.line};border-radius:14px;padding:34px 34px 22px">
${spec.eyebrow ? `<div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:${palette.muted};margin-bottom:14px">${escape(spec.eyebrow)}</div>` : ''}
<h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;letter-spacing:-.03em;font-weight:600;color:${palette.ink}">${escape(spec.heading)}</h1>
${spec.paragraphs.map(t => p(escape(t))).join('\n')}
${spec.facts?.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:4px 0 18px;border-top:1px solid ${palette.line}">${spec.facts.map(f => `<tr><td style="padding:9px 14px 9px 0;font-size:12px;color:${palette.muted};white-space:nowrap;border-bottom:1px solid ${palette.line}">${escape(f.label)}</td><td style="padding:9px 0;font-size:13px;color:${palette.ink};border-bottom:1px solid ${palette.line};word-break:break-all">${escape(f.value)}</td></tr>`).join('')}</table>` : ''}
${spec.action ? button(spec.action.label, spec.action.url) : ''}
${spec.secondary ? p(`<a href="${escape(spec.secondary.url)}" style="color:${palette.ink};text-decoration:underline">${escape(spec.secondary.label)}</a>`, 'font-size:13px') : ''}
${spec.note ? p(escape(spec.note), `font-size:13px;color:${palette.muted}`) : ''}
${spec.test ? `<div style="margin-top:8px;padding:12px 16px;border:1px solid ${palette.noticeLine};border-radius:10px;background:${palette.noticeBg};font-size:12px;line-height:1.5;color:${palette.ink}">Ambiente de demonstração: nenhum valor foi cobrado.</div>` : ''}
</td></tr>
<tr><td style="padding:18px 6px 0;font-size:11px;line-height:1.6;color:${palette.muted}">Enviado para ${escape(to)} pela nostore. Se o link não abrir, copie o endereço completo para o navegador.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text: textLines.join('\n'), html };
}
