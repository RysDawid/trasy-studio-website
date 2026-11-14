#!/usr/bin/env bash
# Wysyła stronę na trasy-studio.pl (SEOHost) przez rsync po SSH.
# Dane serwera: wpis "Host trasy-studio" w ~/.ssh/config (poza repo).
# Użycie: ./deploy.sh      wysyłka
#         ./deploy.sh -n   podgląd zmian bez wysyłania
set -euo pipefail
cd "$(dirname "$0")"

DEST="trasy-studio:domains/trasy-studio.pl/public_html/"

rsync -avz --delete "$@" \
  --exclude '.git*' --exclude 'deploy.sh' --exclude '*.md' \
  --filter 'P .htaccess' --filter 'P .well-known/' --filter 'P cgi-bin/' \
  ./ "$DEST"
