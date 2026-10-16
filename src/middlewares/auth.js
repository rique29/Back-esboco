const { verificar } = require('../utils/jwt');
const { ApiError } = require('../utils/erros');

function extrairToken(req) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  return tipo === 'Bearer' && token ? token : null;
}

function carregarUsuario(payload) {
  return { id: Number(payload.sub), perfil: payload.perfil, nome: payload.nome };
}

function autenticar(req, res, next) {
  const token = extrairToken(req);
  if (!token) throw new ApiError(401, 'Token não informado.');
  req.usuario = carregarUsuario(verificar(token, 'access'));
  next();
}

// Deixa passar sem token (req.usuario = null), mas rejeita token inválido.
function autenticarOpcional(req, res, next) {
  const token = extrairToken(req);
  req.usuario = token ? carregarUsuario(verificar(token, 'access')) : null;
  next();
}

// Uso: exigirPerfil('GESTOR')  ou  exigirPerfil('OPERADOR', 'GESTOR')
function exigirPerfil(...perfisPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) throw new ApiError(401, 'Não autenticado.');
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      throw new ApiError(403, 'Seu perfil não tem permissão para esta ação.');
    }
    next();
  };
}

module.exports = { autenticar, autenticarOpcional, exigirPerfil };
