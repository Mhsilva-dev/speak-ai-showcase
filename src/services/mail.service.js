// Envio de e-mail pelo Gmail (senha de app). Em teste os e-mails ficam em `sent` em vez de sair.
const nodemailer = require('nodemailer');
const config = require('../config');

const sent = [];
let transport;

const enabled = () => config.env === 'test' || Boolean(config.smtp.user && config.smtp.pass);

async function send({ to, subject, text, html }) {
  if (config.env === 'test') { sent.push({ to, subject, text, html }); return; }
  if (!enabled()) throw new Error('E-mail não configurado (SMTP_USER/SMTP_PASS)');
  transport ||= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  await transport.sendMail({ from: `"Speak AI" <${config.smtp.user}>`, to, subject, text, html });
}

module.exports = { send, enabled, sent };
