#!/usr/bin/env bash
set -Eeuo pipefail

# Content Factory V2 controlled build
# Docker-aware version for the current ~/n8n architecture.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FACTORY_ROOT:-$HOME/n8n/content-factory-worker}"
COMPOSE_ROOT="${COMPOSE_ROOT:-$HOME/n8n}"
COMPOSE_FILE="${COMPOSE_FILE:-$COMPOSE_ROOT/docker-compose.yml}"
V2_DIR="${SCRIPT_DIR}"

BUILD_ID="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${ROOT}/backups/content-factory-v2-${BUILD_ID}"
LOG="${BACKUP_DIR}/build.log"
TARGET_WORKER="${TARGET_WORKER:-${ROOT}/worker.js}"

DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${DB_USER:-n8n}"
DB_NAME="${DB_NAME:-content_os}"

mkdir -p "${BACKUP_DIR}"

exec > >(tee -a "${LOG}") 2>&1

phase() {
  echo
  echo "============================================================"
  echo "V2 [$1] $2"
  echo "============================================================"
}

fail() {
  echo
  echo "V2 BUILD FAILED."
  echo "Backup/build log: ${LOG}"
  exit 1
}

trap 'echo "V2 build interrupted."; fail' INT TERM
trap 'echo "V2 build error at line ${LINENO}."; fail' ERR

docker_compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

db_psql() {
  docker_compose exec -T "${DB_SERVICE}" \
    psql -U "${DB_USER}" -d "${DB_NAME}" "$@"
}

db_dump() {
  docker_compose exec -T "${DB_SERVICE}" \
    pg_dump -U "${DB_USER}" -d "${DB_NAME}" "$@"
}

phase "1/10" "Preflight"

command -v docker >/dev/null 2>&1 || {
  echo "Required command not found: docker"
  exit 1
}

command -v node >/dev/null 2>&1 || {
  echo "Required command not found: node"
  exit 1
}

command -v npm >/dev/null 2>&1 || {
  echo "Required command not found: npm"
  exit 1
}

[[ -f "${COMPOSE_FILE}" ]] || {
  echo "Docker Compose file not found: ${COMPOSE_FILE}"
  exit 1
}

[[ -f "${ROOT}/package.json" ]] || {
  echo "No package.json found in ${ROOT}"
  exit 1
}

[[ -f "${V2_DIR}/migrations/001_v2.sql" ]] || {
  echo "V2 migration not found."
  exit 1
}

[[ -f "${V2_DIR}/worker/factory-worker-v2.js" ]] || {
  echo "V2 worker not found."
  exit 1
}

docker_compose ps "${DB_SERVICE}"

db_psql -v ON_ERROR_STOP=1 -c "SELECT version();"

echo "Root: ${ROOT}"
echo "Compose root: ${COMPOSE_ROOT}"
echo "Database: ${DB_NAME}"
echo "Database service: ${DB_SERVICE}"
echo "Target worker: ${TARGET_WORKER}"

phase "2/10" "Backup current system"

mkdir -p "${BACKUP_DIR}/files"

for f in worker.js factory-worker.js worker-db.js package.json package-lock.json .env; do
  if [[ -f "${ROOT}/${f}" ]]; then
    cp -p "${ROOT}/${f}" "${BACKUP_DIR}/files/${f}"
  fi
done

db_dump --format=custom > "${BACKUP_DIR}/database.dump"
db_dump --schema-only > "${BACKUP_DIR}/database.schema.sql"

echo "Backup completed: ${BACKUP_DIR}"

phase "3/10" "Install/verify dependencies"

(
  cd "${ROOT}"
  npm install
)

phase "4/10" "Create V2 database structures + migrate existing data"

db_psql -v ON_ERROR_STOP=1 < "${V2_DIR}/migrations/001_v2.sql"

phase "5/10" "Verify migrated V2 structures"

db_psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'factory_v2_builds' AS table_name, count(*) FROM factory_v2_builds;
SELECT 'pipeline_runs' AS table_name, count(*) FROM pipeline_runs;
SELECT 'job_stages' AS table_name, count(*) FROM job_stages;
SELECT 'artifacts' AS table_name, count(*) FROM artifacts;
SELECT 'stage_attempts' AS table_name, count(*) FROM stage_attempts;
SELECT 'dead_letter_jobs' AS table_name, count(*) FROM dead_letter_jobs;
SELECT 'continuity_snapshots' AS table_name, count(*) FROM continuity_snapshots;
SELECT 'shots' AS table_name, count(*) FROM shots;
SELECT 'asset_requirements' AS table_name, count(*) FROM asset_requirements;
SELECT 'provider_capabilities' AS table_name, count(*) FROM provider_capabilities;
SQL

phase "6/10" "Register build and replace worker"

db_psql -v ON_ERROR_STOP=1 \
  -v build_id="${BUILD_ID}" \
  -v backup_path="${BACKUP_DIR}" <<'SQL'
INSERT INTO factory_v2_builds(
  build_key,
  version,
  status,
  current_phase,
  backup_path
)
VALUES(
  :'build_id',
  '2.0.0',
  'running',
  'worker_replacement',
  :'backup_path'
)
ON CONFLICT(build_key) DO UPDATE
SET
  current_phase = EXCLUDED.current_phase,
  backup_path = EXCLUDED.backup_path;
SQL

if [[ -f "${TARGET_WORKER}" ]]; then
  cp -p "${TARGET_WORKER}" "${BACKUP_DIR}/files/worker.pre-v2.js"
fi

cp "${V2_DIR}/worker/factory-worker-v2.js" "${TARGET_WORKER}"

if [[ -f "${ROOT}/factory-worker.js" ]]; then
  cp "${V2_DIR}/worker/factory-worker-v2.js" "${ROOT}/factory-worker.js"
fi

node --check "${TARGET_WORKER}"

phase "7/10" "Verify NVIDIA-first provider configuration"

db_psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  provider_count integer;
  model_count integer;
BEGIN
  SELECT count(*)
  INTO provider_count
  FROM ai_providers
  WHERE slug = 'nvidia';

  SELECT count(*)
  INTO model_count
  FROM ai_models m
  JOIN ai_providers p ON p.id = m.provider_id
  WHERE p.slug = 'nvidia'
    AND m.enabled = true;

  IF provider_count = 0 THEN
    RAISE EXCEPTION 'NVIDIA provider is missing';
  END IF;

  IF model_count = 0 THEN
    RAISE EXCEPTION 'No enabled NVIDIA model exists';
  END IF;
END $$;

SELECT
  p.slug,
  m.model_id,
  m.enabled
FROM ai_models m
JOIN ai_providers p ON p.id = m.provider_id
WHERE p.slug = 'nvidia';
SQL

phase "8/10" "Run database + worker smoke test"

(
  cd "${ROOT}"
  node "${V2_DIR}/tests/smoke-test.js"
)

phase "9/10" "Final integrity checks"

db_psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='job_stages'
  ) THEN
    RAISE EXCEPTION 'job_stages missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='artifacts'
  ) THEN
    RAISE EXCEPTION 'artifacts missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='dead_letter_jobs'
  ) THEN
    RAISE EXCEPTION 'dead_letter_jobs missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='continuity_snapshots'
  ) THEN
    RAISE EXCEPTION 'continuity_snapshots missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='shots'
  ) THEN
    RAISE EXCEPTION 'shots missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='asset_requirements'
  ) THEN
    RAISE EXCEPTION 'asset_requirements missing';
  END IF;
END $$;
SQL

phase "10/10" "Mark V2 build complete"

db_psql -v ON_ERROR_STOP=1 \
  -v build_id="${BUILD_ID}" <<'SQL'
UPDATE factory_v2_builds
SET
  status = 'completed',
  current_phase = 'smoke_test',
  completed_at = now()
WHERE build_key = :'build_id';
SQL

echo
echo "============================================================"
echo "CONTENT FACTORY V2 BUILD COMPLETE"
echo "============================================================"
echo "Backup: ${BACKUP_DIR}"
echo "Worker: ${TARGET_WORKER}"
echo "Version: 2.0.0"
echo
