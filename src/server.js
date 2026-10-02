// Ponto de entrada: aplica as migrações do banco, sobe o servidor HTTP (só em 127.0.0.1, o nginx fica na frente)
// e liga as rotinas em segundo plano (voz ao vivo, relatório semanal, lembretes push, limpeza do cache de áudio).
const config = require('./config');
const { migrate } = require('./db/migrate');
const app = require('./app');
const live = require('./services/live.service');
const weeklyEmail = require('./services/weekly-email.service');
const push = require('./services/push.service');
const tts = require('./services/audio/tts.service');

migrate()
  .then(() => {
    const server = app.listen(config.port, '127.0.0.1', () => console.log(`Speak AI em http://127.0.0.1:${config.port}`));
    live.attach(server);
    weeklyEmail.schedule();
    push.schedule();
    tts.schedulePrune();

    // pm2 restart/stop: fecha as conversas por voz gravando o uso antes de sair
    const shutdown = () => {
      server.close();
      live.closeAll().catch(() => {}).finally(() => setTimeout(() => process.exit(0), 300));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  })
  .catch((err) => { console.error('Falha ao iniciar', err); process.exit(1); });
