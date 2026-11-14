#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# -eq 2 && $2 == --replace-current ]] || { echo 'Usage: restore.sh BACKUP_DIRECTORY --replace-current (replaces current platform data)' >&2; exit 1; }
backup=$(realpath "$1")
[[ -f $backup/SHA256SUMS ]] || { echo 'Missing backup manifest' >&2; exit 1; }
(cd "$backup" && sha256sum -c SHA256SUMS)
cd /opt/dryspell
systemctl stop dryspell-web dryspell-worker
tar -C /etc -xzf "$backup/config.tar.gz"
tar -C /var/lib -xzf "$backup/data.tar.gz"
chown -R dryspell:dryspell /var/lib/dryspell
docker compose --env-file /etc/dryspell/platform.env up -d --wait db
docker compose --env-file /etc/dryspell/platform.env exec -T db pg_restore -U dryspell -d dryspell --clean --if-exists --exit-on-error < "$backup/database.dump"
systemctl start dryspell-worker dryspell-web
bash scripts/smoke-test.sh
