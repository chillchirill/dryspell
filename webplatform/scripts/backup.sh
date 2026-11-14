#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/dryspell
dest=${1:-/var/lib/dryspell/backups}
mkdir -p "$dest"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d "$dest/.partial-XXXXXX")
web_active=false; worker_active=false
systemctl is-active --quiet dryspell-web && web_active=true
systemctl is-active --quiet dryspell-worker && worker_active=true
resume() { $worker_active && systemctl start dryspell-worker; $web_active && systemctl start dryspell-web; return 0; }
trap resume EXIT
# Freeze both artifact writers and DB writers for a coordinated consistent backup.
systemctl stop dryspell-web dryspell-worker
docker compose --env-file /etc/dryspell/platform.env exec -T db pg_dump -U dryspell -d dryspell -Fc > "$stage/database.dump"
tar --exclude=backups -C /var/lib -czf "$stage/data.tar.gz" dryspell
tar -C /etc -czf "$stage/config.tar.gz" dryspell
(cd "$stage" && sha256sum database.dump data.tar.gz config.tar.gz > SHA256SUMS)
mv "$stage" "$dest/$stamp"
echo "Backup: $dest/$stamp (contains private credentials; access is restricted)"
