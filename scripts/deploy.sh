#!/usr/bin/env bash
# Deploy disparado pelo webhook do GitHub (push na main): atualiza o código, dependências e reinicia.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== $(date -Is) deploy ==="
git pull --ff-only origin main
npm ci --include=dev --no-audit --no-fund   # inclui as dependências de teste (npm test roda no servidor)
pm2 restart speak-ai --update-env
echo "=== deploy ok ==="
