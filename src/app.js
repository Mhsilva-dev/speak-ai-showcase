// App Express: JSON, cookies, webhook de deploy, API (/api) e o SPA (public/). O nginx cuida de HTTPS e cabeçalhos de segurança.
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const routes = require('./routes');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// rawBody: necessário para validar a assinatura do webhook de deploy
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/deploy')) req.rawBody = buf; } }));
app.use(cookieParser());

app.use('/api/deploy', require('./routes/deploy'));
app.use('/api', routes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

const pub = path.join(__dirname, '../public');
// Sem cache longo: o navegador revalida por ETag, então atualizações chegam na hora
app.use(express.static(pub, { index: false, maxAge: 0 }));
// SPA: /, /login, /english, /spanish, /english/aula/:id …
// Versão do build no index.html: cada reinício troca a URL do app.js/styles.css e o navegador baixa a versão nova
const fs = require('fs');
const VERSION = Date.now().toString(36);
const indexHtml = fs.readFileSync(path.join(pub, 'index.html'), 'utf8').replaceAll('__V__', VERSION);
app.get('/{*path}', (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.status === 503) return res.status(503).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

module.exports = app;
