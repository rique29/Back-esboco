const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { ApiError } = require('./erros');

// "tipo" impede usar um token de um tipo no lugar de outro
// (ex.: usar o token do desafio 2FA como se fosse um token de acesso).
function assinar(payload, tipo, expiraEm) {
  return jwt.sign({ ...payload, typ: tipo }, JWT_SECRET, { algorithm: 'HS256', expiresIn: expiraEm });
}

function verificar(token, tipo) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    const expirado = e.name === 'TokenExpiredError';
    throw new ApiError(401, expirado ? 'Token expirado.' : 'Token inválido.');
  }
  if (payload.typ !== tipo) throw new ApiError(401, 'Token inválido.');
  return payload;
}

module.exports = { assinar, verificar };
