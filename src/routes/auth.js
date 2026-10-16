const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const supabase = require('../config/supabase');
const { EM_PRODUCAO, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, RATE_LIMIT_AUTH } = require('../config/env');
const { ApiError, checar } = require('../utils/erros');
const { assinar, verificar } = require('../utils/jwt');
const asyncHandler = require('../utils/asyncHandler');
const { validar } = require('../middlewares/validar');
const { autenticarOpcional } = require('../middlewares/auth');
const { registerSchema, loginSchema, verify2faSchema, refreshSchema } = require('../schemas/auth');

const router = express.Router();

const CODIGO_VALIDADE_MIN = 10;
const MAX_TENTATIVAS = 5;
const COLUNAS_PUBLICAS =
  'id, codigo_colaborador, nome_completo, email, cargo_perfil, setor, dois_fatores_ativo, ativo, ultimo_login, created_at';
// Usado para gastar o mesmo tempo quando o usuário não existe (evita descobrir e-mails válidos)
const HASH_FALSO = bcrypt.hashSync('senha-falsa-apenas-para-comparar', 12);

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: RATE_LIMIT_AUTH,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  })
);

function publico(usuario) {
  const { senha_hash, ...resto } = usuario;
  return resto;
}

function emitirTokens(usuario) {
  const base = { sub: String(usuario.id), perfil: usuario.cargo_perfil, nome: usuario.nome_completo };
  return {
    token_type: 'Bearer',
    access_token: assinar(base, 'access', ACCESS_TOKEN_TTL),
    refresh_token: assinar({ sub: base.sub }, 'refresh', REFRESH_TOKEN_TTL),
    expires_in: ACCESS_TOKEN_TTL,
    usuario: publico(usuario),
  };
}

async function buscarPorLogin(login) {
  let usuario = checar(
    await supabase.from('usuarios').select('*').eq('email', login.toLowerCase()).maybeSingle()
  );
  if (!usuario) {
    usuario = checar(await supabase.from('usuarios').select('*').eq('codigo_colaborador', login).maybeSingle());
  }
  return usuario;
}

// POST /auth/register
// Público: cria sempre OPERADOR. Para criar GESTOR, é preciso estar logado como GESTOR.
router.post(
  '/register',
  autenticarOpcional,
  validar(registerSchema),
  asyncHandler(async (req, res) => {
    const { senha, cargo_perfil, ...dados } = req.body;

    let perfil = 'OPERADOR';
    if (cargo_perfil && cargo_perfil !== 'OPERADOR') {
      if (!req.usuario || req.usuario.perfil !== 'GESTOR') {
        throw new ApiError(403, 'Somente um gerente logado pode criar usuários com este perfil.');
      }
      perfil = cargo_perfil;
    }

    const senha_hash = await bcrypt.hash(senha, 12);
    const criado = checar(
      await supabase
        .from('usuarios')
        .insert({ ...dados, senha_hash, cargo_perfil: perfil })
        .select(COLUNAS_PUBLICAS)
        .single()
    );
    res.status(201).json(criado);
  })
);

// POST /auth/login  ->  etapa 1: confere senha e gera o desafio 2FA
router.post(
  '/login',
  validar(loginSchema),
  asyncHandler(async (req, res) => {
    const { login, senha } = req.body;
    const usuario = await buscarPorLogin(login);

    const senhaConfere = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FALSO);
    if (!usuario || !senhaConfere || !usuario.ativo) {
      throw new ApiError(401, 'Credenciais inválidas.');
    }

    if (!usuario.dois_fatores_ativo) {
      checar(await supabase.from('usuarios').update({ ultimo_login: new Date().toISOString() }).eq('id', usuario.id));
      return res.json(emitirTokens(usuario));
    }

    // Invalida códigos anteriores ainda abertos e cria um novo
    checar(
      await supabase
        .from('codigos_verificacao')
        .update({ utilizado: true })
        .eq('usuario_id', usuario.id)
        .eq('finalidade', 'LOGIN_2FA')
        .eq('utilizado', false)
    );

    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    checar(
      await supabase.from('codigos_verificacao').insert({
        usuario_id: usuario.id,
        codigo,
        finalidade: 'LOGIN_2FA',
        expira_em: new Date(Date.now() + CODIGO_VALIDADE_MIN * 60 * 1000).toISOString(),
      })
    );

    // TODO (produção): enviar o código por e-mail/SMS. Por enquanto aparece no log do container.
    console.log(`[2FA] Código de ${usuario.email}: ${codigo} (válido por ${CODIGO_VALIDADE_MIN} min)`);

    res.json({
      mensagem: 'Código de verificação gerado. Informe-o em /auth/verify-2fa.',
      desafio_token: assinar({ sub: String(usuario.id) }, 'desafio', `${CODIGO_VALIDADE_MIN}m`),
      expira_em_minutos: CODIGO_VALIDADE_MIN,
      ...(EM_PRODUCAO ? {} : { codigo_dev: codigo }), // só em desenvolvimento!
    });
  })
);

// POST /auth/verify-2fa  ->  etapa 2: valida o código de 6 dígitos e entrega os tokens
router.post(
  '/verify-2fa',
  validar(verify2faSchema),
  asyncHandler(async (req, res) => {
    const { desafio_token, codigo } = req.body;
    const desafio = verificar(desafio_token, 'desafio');

    const registro = checar(
      await supabase
        .from('codigos_verificacao')
        .select('*')
        .eq('usuario_id', Number(desafio.sub))
        .eq('finalidade', 'LOGIN_2FA')
        .eq('utilizado', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    if (!registro) throw new ApiError(401, 'Código inválido ou expirado.');

    const fechar = async (campos) =>
      checar(await supabase.from('codigos_verificacao').update(campos).eq('id', registro.id));

    if (new Date(registro.expira_em) < new Date()) {
      await fechar({ utilizado: true });
      throw new ApiError(401, 'Código inválido ou expirado.');
    }

    const igual =
      Buffer.from(registro.codigo).length === Buffer.from(codigo).length &&
      crypto.timingSafeEqual(Buffer.from(registro.codigo), Buffer.from(codigo));
    if (!igual) {
      const tentativas = registro.tentativas + 1;
      await fechar({ tentativas, utilizado: tentativas >= MAX_TENTATIVAS });
      throw new ApiError(401, 'Código inválido ou expirado.');
    }

    await fechar({ utilizado: true });

    const usuario = checar(await supabase.from('usuarios').select('*').eq('id', Number(desafio.sub)).maybeSingle());
    if (!usuario || !usuario.ativo) throw new ApiError(401, 'Credenciais inválidas.');

    checar(await supabase.from('usuarios').update({ ultimo_login: new Date().toISOString() }).eq('id', usuario.id));
    res.json(emitirTokens(usuario));
  })
);

// POST /auth/refresh  ->  troca um refresh token válido por um novo par de tokens
router.post(
  '/refresh',
  validar(refreshSchema),
  asyncHandler(async (req, res) => {
    const payload = verificar(req.body.refresh_token, 'refresh');
    const usuario = checar(await supabase.from('usuarios').select('*').eq('id', Number(payload.sub)).maybeSingle());
    if (!usuario || !usuario.ativo) throw new ApiError(401, 'Usuário inativo ou inexistente.');
    res.json(emitirTokens(usuario));
  })
);

module.exports = router;
