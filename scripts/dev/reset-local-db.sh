#!/usr/bin/env bash
# ローカル PostgreSQL のデータベースを作り直し、マイグレーション（db/bootstrap.sql → db/migrations）を適用する。
#   LOCAL_DB=dm ./scripts/dev/reset-local-db.sh
# デモデータは続けて npm run db:seed で入れる。
set -euo pipefail
DB="${LOCAL_DB:-dm}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
HOST="${PGHOST:-localhost}"
USER_NAME="${PGUSER:-postgres}"
psql -h "$HOST" -U "$USER_NAME" -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB} with (force)" -c "create database ${DB}"
DATABASE_URL="postgres://${USER_NAME}:${PGPASSWORD}@${HOST}:5432/${DB}" DATABASE_URL_UNPOOLED="" npx tsx scripts/db/migrate.ts >/dev/null
echo "migrated: ${DB}"
