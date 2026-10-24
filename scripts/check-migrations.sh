#!/usr/bin/env bash
# Falha quando src/db/schema.ts mudou sem migration (US-205).
#
# Gera as migrations numa copia da pasta drizzle/ e compara: se o drizzle-kit
# criar qualquer arquivo novo, o schema tem algo que o banco nao vai receber.
# Nao precisa de banco: o generate compara o schema com o ultimo snapshot.
set -euo pipefail

check=".migrations-check"
rm -rf "$check"
trap 'rm -rf "$check"' EXIT
cp -r drizzle "$check"

env -u DATABASE_URL npx drizzle-kit generate \
  --dialect postgresql \
  --schema ./src/db/schema.ts \
  --out "./$check" \
  --casing snake_case > /dev/null

if ! diff -rq drizzle "$check" > /dev/null; then
  echo "::error::src/db/schema.ts mudou sem migration. Rode 'npm run db:generate' e inclua o SQL gerado."
  diff -rN drizzle "$check" | head -40 || true
  exit 1
fi
echo "Schema e migrations em dia."
