import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDigitalMimeType } from '../src/lib/file-types.ts';

const guitarPro = (version: string) => {
  const text = `FICHIER GUITAR PRO v${version}`;
  return Buffer.concat([Buffer.from([text.length]), Buffer.from(text, 'latin1'), Buffer.alloc(30 - text.length)]);
};
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

test('reconhece os formatos aceitos pelo conteúdo', () => {
  assert.equal(detectDigitalMimeType(Buffer.from('%PDF-1.7\n'), 'guia.pdf'), 'application/pdf');
  assert.equal(detectDigitalMimeType(zip, 'pacote.zip'), 'application/zip');
  assert.equal(detectDigitalMimeType(zip, 'livro.epub'), 'application/epub+zip');
  assert.equal(detectDigitalMimeType(zip, 'musica.gp'), 'application/x-guitar-pro', 'Guitar Pro 7+ é um ZIP identificado pela extensão');
  assert.equal(detectDigitalMimeType(Buffer.from('BCFZ    '), 'musica.gpx'), 'application/x-guitar-pro');
  assert.equal(detectDigitalMimeType(Buffer.from('BCFS    '), 'musica.gpx'), 'application/x-guitar-pro');
  assert.equal(detectDigitalMimeType(png, 'capa.png'), 'image/png');
  assert.equal(detectDigitalMimeType(jpeg, 'foto.jpg'), 'image/jpeg');
  assert.equal(detectDigitalMimeType(jpeg, 'foto.jpeg'), 'image/jpeg', 'imagem é reconhecida pelo conteúdo, não pela extensão');
  for (const version of ['3.00', '4.00', '5.00', '5.10']) {
    assert.equal(detectDigitalMimeType(guitarPro(version), `musica.gp${version[0]}`), 'application/x-guitar-pro', `versão ${version}`);
  }
});

test('recusa conteúdo que não corresponde a nenhum formato', () => {
  assert.equal(detectDigitalMimeType(Buffer.from('MZ  '), 'programa.gp5'), null, 'executável renomeado');
  assert.equal(detectDigitalMimeType(Buffer.from('FICHIER GUITAR XXX v5.00'), 'falso.gp5'), null);
  assert.equal(detectDigitalMimeType(Buffer.concat([Buffer.from([0x40]), Buffer.from('FICHIER GUITAR PRO v5.00')]), 'falso.gp5'), null, 'byte de tamanho fora do intervalo');
  assert.equal(detectDigitalMimeType(Buffer.from('texto simples'), 'nota.txt'), null);
  assert.equal(detectDigitalMimeType(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'animacao.gif'), null, 'GIF não está na lista');
  assert.equal(detectDigitalMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x00]), 'falso.png'), null, 'assinatura PNG incompleta');
  assert.equal(detectDigitalMimeType(Buffer.alloc(0), 'vazio.gp'), null);
});
