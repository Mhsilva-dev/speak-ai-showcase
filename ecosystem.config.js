// PM2 — processo único (o estado da voz ao vivo fica em memória)
module.exports = {
  apps: [{
    name: 'speak-ai',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '400M',
    kill_timeout: 6000, // dá tempo de gravar o uso das conversas por voz ao reiniciar
  }],
};
