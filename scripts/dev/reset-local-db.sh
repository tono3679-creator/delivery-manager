#!/usr/bin/env bash
# ローカル PostgreSQL のデータベースを作り直し、シム → マイグレーション → デモデータの順に適用する。
#   LOCAL_DB=dm ./scripts/dev/reset-local-db.sh
set -euo pipefail
DB="${LOCAL_DB:-dm}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL="psql -h ${PGHOST:-localhost} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists ${DB} with (force)" -c "create database ${DB}"
$PSQL -d "$DB" -f scripts/dev/local-supabase-shim.sql 2>&1 | grep -v -e wal_level -e HINT || true
for f in supabase/migrations/*.sql; do
  $PSQL -d "$DB" -f "$f"
done
echo "migrated: ${DB}"
