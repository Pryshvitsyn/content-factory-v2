#!/usr/bin/env bash
set -Eeuo pipefail

# Controlled V2.1 execution-foundation build.
# Does not replace the production worker. It installs only the V2.1
# PostgreSQL execution boundary, verifies it, then runs deterministic tests.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_ROOT="${COMPOSE_ROOT:-$HOME/n8n}"
COMPOSE_FILE="${COMPOSE_FILE:-$COMPOSE_ROOT/docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${DB_USER:-n8n}"
DB_NAME="${DB_NAME:-content_os}"
BUILD_ID="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/n8n/backups/content-factory-v2.1-${BUILD_ID}}"

mkdir -p "$BACKUP_DIR"

fail() { echo "V2.1 BUILD FAILED. Backup: $BACKUP_DIR"; exit 1; }
trap 'echo "V2.1 build error at line ${LINENO}."; fail' ERR INT TERM

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
psql_db() { compose exec -T "$DB_SERVICE" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

echo "== V2.1 PRECHECK =="
command -v docker >/dev/null || { echo "docker is required"; exit 1; }
command -v node >/dev/null || { echo "node is required"; exit 1; }
test -f "$COMPOSE_FILE"
test -s "$SCRIPT_DIR/migrations/002_v2_1_execution.sql"
test -s "$SCRIPT_DIR/migrations/003_v2_1_execution_contract_fix.sql"
test -s "$SCRIPT_DIR/tests/v2.1-database-contract.sql"
compose ps "$DB_SERVICE"
psql_db -c 'SELECT current_database(), current_user, version();'

echo "== BACKUP =="
compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "$BACKUP_DIR/database.dump"
compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --schema-only > "$BACKUP_DIR/database.schema.sql"

echo "== APPLY V2.1 MIGRATIONS =="
psql_db < "$SCRIPT_DIR/migrations/002_v2_1_execution.sql"
psql_db < "$SCRIPT_DIR/migrations/003_v2_1_execution_contract_fix.sql"

echo "== DATABASE CONTRACT =="
psql_db < "$SCRIPT_DIR/tests/v2.1-database-contract.sql"

echo "== JAVASCRIPT CONTRACT =="
(cd "$SCRIPT_DIR" && npm test)

echo "== FINAL STATE =="
psql_db -c "SELECT 'productions' AS table_name, count(*) FROM v2_1.productions UNION ALL SELECT 'jobs', count(*) FROM v2_1.jobs UNION ALL SELECT 'stage_runs', count(*) FROM v2_1.stage_runs;"

echo
echo "CONTENT FACTORY V2.1 EXECUTION FOUNDATION READY"
echo "Backup: $BACKUP_DIR"
