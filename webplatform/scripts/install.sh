#!/usr/bin/env bash
set -euo pipefail
umask 027
[[ ${EUID} -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu ]] || { echo 'Ubuntu required.' >&2; exit 1; }
port=4000
while (($#)); do case "$1" in --port) port=$2; shift 2;; *) echo "Unknown option $1" >&2; exit 1;; esac; done
[[ $port == 4000 ]] || { echo 'The platform contract requires port 4000.' >&2; exit 1; }
src=$(cd "$(dirname "$0")/.." && pwd)
echo "Ubuntu $VERSION_ID; architecture $(uname -m); memory and disk:"
free -m
df -h "$src"
if ss -ltn '( sport = :4000 )' | tail -n +2 | grep -q . && ! systemctl is-active --quiet dryspell-web; then
  echo 'Port 4000 is already used by another service.' >&2; exit 1
fi
apt-get update
apt-get install -y ca-certificates curl gnupg rsync xz-utils
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$VERSION_CODENAME" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Unsupported Node architecture' >&2; exit 1;; esac
  node_version=v24.14.1
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$node_version/node-$node_version-linux-$arch.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$tmp/SHA256"
  expected=$(awk -v f="node-$node_version-linux-$arch.tar.xz" '$2==f {print $1}' "$tmp/SHA256")
  [[ -n $expected ]] && echo "$expected  $tmp/node.tar.xz" | sha256sum -c -
  tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
fi
# Units use a stable absolute executable path; no per-user shell initialization.
[[ -x /usr/bin/node ]] || ln -s "$(command -v node)" /usr/bin/node
[[ $(/usr/bin/node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo '/usr/bin/node must be Node 24; resolve conflicting installation.' >&2; exit 1; }
id dryspell >/dev/null 2>&1 || useradd --system --home-dir /var/lib/dryspell --shell /usr/sbin/nologin dryspell
install -d -m 0750 -o dryspell -g dryspell /var/lib/dryspell /var/lib/dryspell/backups
install -d -m 0750 -o root -g dryspell /etc/dryspell
install -d -m 0755 /opt/dryspell
if [[ $src != /opt/dryspell ]]; then
  rsync -a --exclude=node_modules --exclude=.git --exclude=.env --exclude=config/admin.config.cjs --exclude=data/private --exclude=test-results "$src/" /opt/dryspell/
fi
cd /opt/dryspell
if [[ ! -f /etc/dryspell/platform.env ]]; then
  dbpass=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
  printf 'PORT=4000\nHOST=0.0.0.0\nDB_PORT=55432\nPOSTGRES_PASSWORD=%s\nDATABASE_URL=postgres://dryspell:%s@127.0.0.1:55432/dryspell\nADMIN_CONFIG_PATH=/etc/dryspell/admin.config.cjs\nDATA_DIR=/var/lib/dryspell\nSESSION_SECURE=false\n' "$dbpass" "$dbpass" > /etc/dryspell/platform.env
fi
chmod 0640 /etc/dryspell/platform.env
chown root:dryspell /etc/dryspell/platform.env
set -a; source /etc/dryspell/platform.env; set +a
npm ci
if [[ ! -f $ADMIN_CONFIG_PATH ]]; then
  if [[ -z ${DRYSPELL_ADMIN_PASSWORD:-} ]]; then
    [[ -t 0 ]] || { echo 'Provide DRYSPELL_ADMIN_PASSWORD (12+ characters) for initial noninteractive installation.' >&2; exit 1; }
    read -rs -p 'New administrator password (12+ characters): ' DRYSPELL_ADMIN_PASSWORD; echo
    export DRYSPELL_ADMIN_PASSWORD
  fi
  node --import tsx scripts/setup-admin.ts
fi
chown root:dryspell "$ADMIN_CONFIG_PATH"
chmod 0640 "$ADMIN_CONFIG_PATH"
npm run typecheck
npm run build
docker compose --env-file /etc/dryspell/platform.env up -d --wait db
npm run db:migrate
npm run db:seed
install -m 0644 deploy/dryspell-*.service deploy/dryspell-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable dryspell-db dryspell-web dryspell-worker dryspell-maintenance.timer
systemctl restart dryspell-db dryspell-worker dryspell-web
systemctl start dryspell-maintenance.timer
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow 4000/tcp; fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then echo 'firewalld active: configure port 4000/tcp in the intended zone.'; fi
bash scripts/smoke-test.sh
echo 'Application port: 4000. Any cloud security-group/router rule must also allow TCP 4000. See deploy/nginx.example.conf for optional TLS.'
