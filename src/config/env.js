require('dotenv').config();

// .trim() evita o erro clássico de um espaço sobrando no fim da linha do .env
const ler = (nome) => (process.env[nome] || '').trim();

const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET', 'AES_KEY'];
const faltando = obrigatorias.filter((nome) => !ler(nome));
if (faltando.length) {
  console.error(`[env] Faltam variáveis no .env: ${faltando.join(', ')}`);
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(ler('AES_KEY'))) {
  console.error('[env] AES_KEY precisa ter 64 caracteres hexadecimais (32 bytes).');
  process.exit(1);
}
if (ler('JWT_SECRET').length < 32) {
  console.error('[env] JWT_SECRET precisa ter pelo menos 32 caracteres.');
  process.exit(1);
}

module.exports = {
  NODE_ENV: ler('NODE_ENV') || 'development',
  EM_PRODUCAO: ler('NODE_ENV') === 'production',
  PORT: Number(ler('PORT')) || 3000,
  SUPABASE_URL: ler('SUPABASE_URL'),
  SUPABASE_SERVICE_KEY: ler('SUPABASE_SERVICE_KEY'),
  JWT_SECRET: ler('JWT_SECRET'),
  AES_KEY: ler('AES_KEY'),
  ACCESS_TOKEN_TTL: ler('ACCESS_TOKEN_TTL') || '15m',
  REFRESH_TOKEN_TTL: ler('REFRESH_TOKEN_TTL') || '7d',
  CORS_ORIGIN: ler('CORS_ORIGIN') || '*',
  RATE_LIMIT_AUTH: Number(ler('RATE_LIMIT_AUTH')) || 100,
};
