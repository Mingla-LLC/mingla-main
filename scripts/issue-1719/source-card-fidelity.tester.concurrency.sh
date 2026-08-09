#!/usr/bin/env bash
set -euo pipefail

# Four independent database clients race the same delivery operation. Results
# are persisted in the disposable test database so response-loss semantics can
# be verified without trusting any one worker's stdout.
psql -v ON_ERROR_STOP=1 -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" <<'SQL'
DROP TABLE IF EXISTS public.issue1719_tester_concurrency_results;
CREATE TABLE public.issue1719_tester_concurrency_results(worker integer PRIMARY KEY,result jsonb NOT NULL);
SQL

for worker in 1 2 3 4; do
  (
    psql -v ON_ERROR_STOP=1 -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v worker="$worker" <<'SQL'
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
INSERT INTO public.issue1719_tester_concurrency_results(worker,result)
SELECT :worker,public.send_content_share_message(
  '92000000-0000-0000-0000-000000000001','direct','10000000-0000-0000-0000-000000000202',
  l.short_code,l.current_version,'Concurrent note',15
)
FROM public.content_share_links l WHERE l.source_key='issue1719:native:place';
SQL
  ) &
done
wait

# A fifth call represents a client that lost the first response and retried.
psql -v ON_ERROR_STOP=1 -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" <<'SQL'
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
INSERT INTO public.issue1719_tester_concurrency_results(worker,result)
SELECT 5,public.send_content_share_message(
  '92000000-0000-0000-0000-000000000001','direct','10000000-0000-0000-0000-000000000202',
  l.short_code,l.current_version,'Concurrent note',15
)
FROM public.content_share_links l WHERE l.source_key='issue1719:native:place';

DO $$
DECLARE delivery_id uuid; message_id uuid;
BEGIN
  IF (SELECT count(*) FROM public.issue1719_tester_concurrency_results)<>5
     OR (SELECT count(*) FROM public.issue1719_tester_concurrency_results WHERE (result->>'inserted')::boolean)<>1
     OR (SELECT count(*) FROM public.issue1719_tester_concurrency_results WHERE NOT (result->>'inserted')::boolean)<>4
     OR (SELECT count(DISTINCT result->>'messageId') FROM public.issue1719_tester_concurrency_results)<>1 THEN
    RAISE EXCEPTION 'four-worker/response-loss idempotency failed';
  END IF;
  SELECT (result->>'deliveryId')::uuid,(result->>'messageId')::uuid INTO delivery_id,message_id
  FROM public.issue1719_tester_concurrency_results LIMIT 1;
  IF (SELECT count(*) FROM public.content_share_message_deliveries WHERE id=delivery_id)<>1
     OR (SELECT count(*) FROM public.messages WHERE id=message_id)<>1 THEN
    RAISE EXCEPTION 'duplicate delivery/message persisted';
  END IF;
END$$;
DROP TABLE public.issue1719_tester_concurrency_results;
SELECT 'issue-1719 source-card-fidelity four-worker concurrency PASS' AS result;
SQL
