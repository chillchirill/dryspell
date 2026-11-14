#!/usr/bin/env bash
set -euo pipefail
sudo systemctl start dryspell-db dryspell-worker dryspell-web
curl --fail --retry 10 --retry-delay 2 --retry-connrefused http://127.0.0.1:4000/health/ready
