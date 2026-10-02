// Dispara o relatório semanal na mão. Uso: node scripts/weekly-email.js [email] (com e-mail: força o envio só para ele)
const db = require('../src/db/pool');
const weekly = require('../src/services/weekly-email.service');

(async () => {
  const email = process.argv[2];
  let onlyUserId = null;
  if (email) {
    const { rows } = await db.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!rows[0]) throw new Error(`Usuário não encontrado: ${email}`);
    onlyUserId = rows[0].id;
  }
  console.log(await weekly.sendAll({ onlyUserId, force: Boolean(email) }));
})().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => db.pool.end());
