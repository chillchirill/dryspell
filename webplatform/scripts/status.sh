#!/usr/bin/env bash
set -euo pipefail
systemctl --no-pager status dryspell-db dryspell-web dryspell-worker dryspell-maintenance.timer
