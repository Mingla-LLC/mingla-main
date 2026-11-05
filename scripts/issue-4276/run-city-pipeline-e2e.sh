#!/bin/bash
# Issue #4276: a city from box to final score on real Postgres and PostgREST, with every
# provider stubbed and nothing able to leave this machine.
#
# Needs a container that has replayed every migration and maps its 5432 to a host port:
#   scripts/issue-4276/run-city-pipeline-e2e.sh <container> <host-port> <postgres-password>
# It works in its own database, copied from "postgres", and removes its own PostgREST.
set -euo pipefail
CONTAINER="$1"; PORT="$2"; export PGPASSWORD="$3"
DB=issue4276e2e
REST=issue4276-e2e-postgrest
REST_PORT="${REST_PORT:-55477}"
JWT_SECRET="issue-4276-e2e-secret-issue-4276-e2e-secret"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

admin() { docker exec -i "$CONTAINER" psql -U supabase_admin -h 127.0.0.1 "$@"; }

docker rm -f "$REST" >/dev/null 2>&1 || true
# A replay also holds production's cron jobs; they are switched off below as well.
# pg_cron and pg_net hold connections to the source, and terminating them restarts the
# server. So they're pointed elsewhere for good: this container is scratch, and only the
# real kicker functions are under test, not the schedulers.
admin -d template1 -q \
  -c "ALTER SYSTEM SET cron.database_name = 'template1'" \
  -c "ALTER SYSTEM SET pg_net.database_name = 'template1'"
docker restart "$CONTAINER" >/dev/null
for _ in $(seq 1 60); do
  admin -d template1 -Atqc "select 1" >/dev/null 2>&1 && break
  sleep 2
done
admin -d template1 -q \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" \
  -c "CREATE DATABASE $DB TEMPLATE postgres"

admin -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
ALTER ROLE authenticator WITH PASSWORD 'e2e-authenticator';
-- A replayed database holds every production cron job. None may run here.
UPDATE cron.job SET active = false;
-- Placeholders. The posts they go on are caught below and never leave.
SELECT vault.create_secret('http://functions.local.test', 'supabase_url');
SELECT vault.create_secret('e2e-placeholder', 'service_role_key');
-- Every outgoing post lands here, and the test delivers it to the function in-process.
CREATE TABLE public.e2e_kicks (id bigserial PRIMARY KEY, url text, body jsonb);
GRANT ALL ON TABLE public.e2e_kicks TO service_role;
GRANT ALL ON SEQUENCE public.e2e_kicks_id_seq TO service_role;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.e2e_kicks (url, body) VALUES (url, body);
  RETURN 1;
END $$;
SQL

docker run -d --name "$REST" -p "$REST_PORT:3000" \
  -e PGRST_DB_URI="postgres://authenticator:e2e-authenticator@host.docker.internal:$PORT/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e PGRST_DB_MAX_ROWS=1000 --add-host=host.docker.internal:host-gateway \
  public.ecr.aws/supabase/postgrest:v14.10 >/dev/null
trap 'docker rm -f "$REST" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$REST_PORT/" -o /dev/null && break; sleep 1; done

cd "$ROOT"
ISSUE_4276_E2E_POSTGREST="http://127.0.0.1:$REST_PORT" \
ISSUE_4276_E2E_JWT_SECRET="$JWT_SECRET" \
ISSUE_4276_E2E_PSQL="postgres://postgres:$PGPASSWORD@127.0.0.1:$PORT/$DB" \
SUPABASE_URL="http://functions.local.test" \
GOOGLE_MAPS_API_KEY=stub GEMINI_API_KEY=stub SERPER_API_KEY=stub \
deno test --allow-all --no-check --import-map=scripts/issue-4276/e2e-import-map.json \
  scripts/issue-4276/city_pipeline_e2e.ts "${@:4}"
