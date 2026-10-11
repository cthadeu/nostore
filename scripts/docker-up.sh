#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  umask 077
  nostore_key=$(openssl rand -hex 32)
  sed "s/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=$nostore_key/" .env.example > .env
fi
if ! sed -n '/^ENCRYPTION_KEY=[[:xdigit:]]\{64\}$/p' .env | grep -q .; then
  echo 'Defina ENCRYPTION_KEY no .env com o resultado de: openssl rand -hex 32' >&2
  exit 1
fi
exec docker compose up --build -d "$@"
