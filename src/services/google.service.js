// Login com Google (OAuth 2.0 / OpenID Connect, fluxo por redirecionamento — funciona também no app instalado)
const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('./student.service');

const enabled = () => Boolean(config.google.clientId && config.google.clientSecret);
const redirectUri = (req) => `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
const newState = () => crypto.randomBytes(16).toString('hex');

function authUrl(req, state) {
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Troca o código pelo id_token. O token vem direto do Google (TLS + client secret), então basta conferir as claims. */
async function exchange(req, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: config.google.clientId, client_secret: config.google.clientSecret,
      redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new HttpError(502, 'O Google não confirmou o login');
  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString());
  if (claims.aud !== config.google.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
    || claims.exp * 1000 < Date.now()) throw new HttpError(401, 'Login do Google inválido');
  if (!claims.email || !claims.email_verified) throw new HttpError(401, 'Seu e-mail do Google não está verificado');
  return { sub: claims.sub, email: claims.email, name: claims.name };
}

module.exports = { enabled, authUrl, exchange, newState };
