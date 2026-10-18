// Digital products accept documents and Guitar Pro scores. Files are identified by their content, so
// a renamed executable never passes; the extension only tells apart formats that share a container
// (EPUB and Guitar Pro 7+ are both ZIP archives).
export const DIGITAL_MEDIA_TYPES = ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/epub+zip', 'application/octet-stream', 'application/x-guitar-pro'];
export const DIGITAL_EXTENSIONS = ['.pdf', '.epub', '.zip', '.gp', '.gpx', '.gp3', '.gp4', '.gp5'];
export const DIGITAL_FILE_HINT = 'PDF, EPUB, ZIP ou Guitar Pro (.gp, .gpx, .gp5)';
// Guitar Pro 3 to 5 start with a Pascal-style version string; 32 bytes cover it with room to spare.
export const DIGITAL_HEAD_BYTES = 32;

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GUITAR_PRO = 'FICHIER GUITAR PRO';
const GUITAR_PRO_MIME = 'application/x-guitar-pro';

export function detectDigitalMimeType(head: Buffer, filename: string): string | null {
  const extension = (filename.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head.subarray(0, 4).equals(ZIP)) {
    // Guitar Pro 7+ (.gp) and EPUB are ZIP containers; only the extension distinguishes them.
    if (extension === '.gp') return GUITAR_PRO_MIME;
    if (extension === '.epub') return 'application/epub+zip';
    return 'application/zip';
  }
  // Guitar Pro 6 (.gpx) container, compressed or stored.
  const tag = head.subarray(0, 4).toString('latin1');
  if (tag === 'BCFZ' || tag === 'BCFS') return GUITAR_PRO_MIME;
  // Guitar Pro 3 to 5: a length byte followed by "FICHIER GUITAR PRO vX.YY".
  const length = head[0] ?? 0;
  if (length >= GUITAR_PRO.length && length <= 30 && head.subarray(1, 1 + GUITAR_PRO.length).toString('latin1') === GUITAR_PRO) return GUITAR_PRO_MIME;
  return null;
}
