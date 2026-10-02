// Webhook do GitHub: push na main → scripts/deploy.sh. Autenticado pela assinatura HMAC (X-Hub-Signature-256).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

const router = express.Router();
const ROOT = path.join(__dirname, '../..');
let running = false;

function validSignature(req) {
  const secret = process.env.DEPLOY_SECRET;
  const sig = req.get('X-Hub-Signature-256') || '';
  if (!secret || !req.rawBody || !sig.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

router.post('/', (req, res) => {
  if (!validSignature(req)) return res.status(401).json({ ok: false });
  const event = req.get('X-GitHub-Event');
  if (event === 'ping') return res.json({ ok: true, msg: 'pong' });
  if (event !== 'push' || req.body?.ref !== 'refs/heads/main') return res.json({ ok: true, msg: 'ignorado' });
  if (running) return res.json({ ok: true, msg: 'deploy já em andamento' });
  running = true;
  res.json({ ok: true, msg: 'deploy iniciado' });
  // Processo separado (setsid): sobrevive ao "pm2 restart" deste próprio servidor
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(ROOT, 'logs/deploy.log'), 'a');
  const child = spawn('setsid', ['bash', path.join(ROOT, 'scripts/deploy.sh')], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  setTimeout(() => { running = false; }, 120000);
});

module.exports = router;
