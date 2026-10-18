import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDigitalMimeType } from '../src/lib/file-types.ts';

const guitarPro = (version: string) => {
  const text = `FICHIER GUITAR PRO v${version}`;
  return Buffer.concat([Buffer.from([text.length]), Buffer.from(text, 'latin1'), Buffer.alloc(30 - text.length)]);
};
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

test('reconhece os formatos aceitos pelo conteúdo', () => {
  assert.equal(detectDigitalMimeType(Buffer.from('%PDF-1.7\n'), 'guia.pdf'), 'application/pdf');
  assert.equal(detectDigitalMimeType(zip, 'pacote.zip'), 'application/zip');
  assert.equal(detectDigitalMimeType(zip, 'livro.epub'), 'application/epub+zip');
  assert.equal(detectDigitalMimeType(zip, 'musica.gp'), 'application/x-guitar-pro', 'Guitar Pro 7+ é um ZIP identificado pela extensão');
  assert.equal(detectDigitalMimeType(Buffer.from('BCFZ    '), 'musica.gpx'), 'application/x-guitar-pro');
  assert.equal(detectDigitalMimeType(Buffer.from('BCFS    '), 'musica.gpx'), 'application/x-guitar-pro');
  for (const version of ['3.00', '4.00', '5.00', '5.10']) {
    assert.equal(detectDigitalMimeType(guitarPro(version), `musica.gp${version[0]}`), 'application/x-guitar-pro', `versão ${version}`);
  }
});

test('recusa conteúdo que não corresponde a nenhum formato', () => {
  assert.equal(detectDigitalMimeType(Buffer.from('MZ  '), 'programa.gp5'), null, 'executável renomeado');
  assert.equal(detectDigitalMimeType(Buffer.from('FICHIER GUITAR XXX v5.00'), 'falso.gp5'), null);
  assert.equal(detectDigitalMimeType(Buffer.concat([Buffer.from([0x40]), Buffer.from('FICHIER GUITAR PRO v5.00')]), 'falso.gp5'), null, 'byte de tamanho fora do intervalo');
  assert.equal(detectDigitalMimeType(Buffer.from('texto simples'), 'nota.txt'), null);
  assert.equal(detectDigitalMimeType(Buffer.alloc(0), 'vazio.gp'), null);
});
