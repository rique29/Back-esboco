const crypto = require('crypto');
const { AES_KEY } = require('../config/env');

// AES-256-GCM: criptografa E garante que ninguém alterou o dado (tag de autenticação).
const chave = Buffer.from(AES_KEY, 'hex'); // 32 bytes = 256 bits
const PREFIXO = 'v1';

function criptografar(texto) {
  if (texto === null || texto === undefined) return null;
  const iv = crypto.randomBytes(12); // um IV novo para cada valor
  const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(String(texto), 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [PREFIXO, iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join('.');
}

function descriptografar(valor) {
  if (valor === null || valor === undefined) return null;
  try {
    const [prefixo, iv, tag, dados] = String(valor).split('.');
    if (prefixo !== PREFIXO) throw new Error('formato desconhecido');
    const decifra = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
    decifra.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decifra.update(Buffer.from(dados, 'base64')), decifra.final()]).toString('utf8');
  } catch (e) {
    console.error('[crypto] Falha ao descriptografar (chave errada ou dado alterado).');
    return null;
  }
}

module.exports = { criptografar, descriptografar };
