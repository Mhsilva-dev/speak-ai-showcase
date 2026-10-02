// Sessão por cookie: grava/limpa o cookie e protege as rotas (logado / admin).
const auth = require('../services/auth.service');
const usage = require('../services/usage.service');

const COOKIE = 'pid_session';

/** Grava o cookie de sessão (httpOnly, só HTTPS em produção, 30 dias) */
async function setSession(req, res, user) {
  const token = auth.sign(user.id, await auth.sessionVersion(user.id));
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 86400000, path: '/' });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Exige login. Também liga as chamadas à IA desta requisição ao usuário (para o painel de custos). */
async function requireAuth(req, res, next) {
  try {
    const s = auth.verify(req.cookies?.[COOKIE]);
    const user = s && await auth.getUser(s.id, s.sv);
    if (!user) return res.status(401).json({ error: 'Faça login para continuar' });
    req.user = user;
    usage.context.run({ userId: user.id }, next);
  } catch (err) { next(err); }
}

/** Só para administradores (usar depois de requireAuth) */
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Acesso restrito ao administrador' });
  next();
}

module.exports = { COOKIE, requireAuth, requireAdmin, setSession, clearSession };
