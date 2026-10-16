const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { CORS_ORIGIN } = require('./config/env');
const supabase = require('./config/supabase');
const { naoEncontrado, tratarErros } = require('./middlewares/erros');
const asyncHandler = require('./utils/asyncHandler');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(express.json({ limit: '1mb' }));

// Teste rápido: a API está no ar e consegue ler o banco?
app.get(
  '/health',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from('categorias_estoque').select('nome').limit(3);
    if (error) return res.status(500).json({ api: 'ok', banco: 'ERRO', detalhe: error.message });
    res.json({ api: 'ok', banco: 'ok', exemplo: data });
  })
);

app.use('/auth', require('./routes/auth'));
app.use('/relatorios', require('./routes/relatorios'));
app.use('/vistorias', require('./routes/vistorias'));

app.use(naoEncontrado);
app.use(tratarErros);

module.exports = app;
