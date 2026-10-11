import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const formatDocument = (digits: string) =>
  digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  : digits.length === 14 ? digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  : digits;

export function buyerStamp(buyer: { name: string; document: string }) {
  const kind = buyer.document.length === 14 ? 'CNPJ' : 'CPF';
  return `Licenciado para ${buyer.name} · ${kind} ${formatDocument(buyer.document)}`;
}

// Writes the stamp centered in the footer of every page. Non-WinAnsi characters are replaced so the
// standard font never throws on an unusual name.
export async function stampPdf(input: Uint8Array, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const safe = text.replace(/[^\x20-\x7E -ÿ]/g, '?');
  const size = 8;
  const width = font.widthOfTextAtSize(safe, size);
  for (const page of pdf.getPages()) {
    const { width: pageWidth } = page.getSize();
    page.drawText(safe, { x: Math.max(12, (pageWidth - width) / 2), y: 14, size, font, color: rgb(0.45, 0.45, 0.45) });
  }
  return pdf.save({ useObjectStreams: false });
}
