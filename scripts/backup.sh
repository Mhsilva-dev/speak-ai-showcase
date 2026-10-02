#!/usr/bin/env bash
# Backup diário do Speak AI: banco PostgreSQL (formato custom do pg_dump) + uploads dos alunos.
# Mantém os últimos 14 dias. Restaurar: docker exec -i speak-db pg_restore -U speak -d speak --clean --if-exists --no-owner < db-AAAAMMDD-HHMM.dump
set -euo pipefail
umask 077   # backups têm dados dos alunos: só o root lê
APP="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-$HOME/backups/speak-ai}"
STAMP=$(date +%Y%m%d-%H%M)
KEEP_DAYS=14
mkdir -p "$DEST"

docker exec "${PG_CONTAINER:-speak-db}" pg_dump -U "${PG_USER:-speak}" -d "${PG_DB:-speak}" -Fc > "$DEST/db-$STAMP.dump.tmp"
mv "$DEST/db-$STAMP.dump.tmp" "$DEST/db-$STAMP.dump"

if [ -d "$APP/uploads" ] && [ -n "$(ls -A "$APP/uploads" 2>/dev/null)" ]; then
  tar -czf "$DEST/uploads-$STAMP.tgz" -C "$APP" uploads
fi
cp "$APP/.env" "$DEST/env-latest.bak" && chmod 600 "$DEST/env-latest.bak"

find "$DEST" -name 'db-*.dump' -mtime +$KEEP_DAYS -delete
find "$DEST" -name 'uploads-*.tgz' -mtime +$KEEP_DAYS -delete
echo "$(date -Is) backup ok: db-$STAMP.dump ($(du -h "$DEST/db-$STAMP.dump" | cut -f1))"
