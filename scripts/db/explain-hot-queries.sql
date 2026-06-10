-- #426 PR4 — EXPLAIN ANALYZE templates for load-profile hot paths.
-- Run on STAGING with representative UUIDs / city names. Do not run on production
-- under load without operator approval.
--
-- Usage:
--   psql "$DATABASE_URL" -v event_id='...' -v order_id='...' -v user_id='...' \
--     -v city='London' -f scripts/db/explain-hot-queries.sql

\timing on
\echo '=== ORCH-426 hot path EXPLAIN (staging) ==='

\echo '--- 1. event_dates future count (ticket-checkout-create) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*)::int
FROM public.event_dates
WHERE event_id = :'event_id'::uuid
  AND end_at > now();

\echo '--- 2. tickets by order (ticket-checkout-status) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, ticket_type_id, qr_code, status, created_at
FROM public.tickets
WHERE order_id = :'order_id'::uuid
ORDER BY created_at ASC;

\echo '--- 3. agent_messages 24h user turns (agent-chat rate limit) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*)::int
FROM public.agent_messages
WHERE user_id = :'user_id'::uuid
  AND role = 'user'
  AND created_at >= now() - interval '24 hours';

\echo '--- 4. discover public events by city (discover-merged-events) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT e.id, e.title, e.city, e.status
FROM public.events e
WHERE e.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.event_type = 'event'
  AND e.status IN ('scheduled', 'live')
  AND e.city = :'city'
LIMIT 20;

\echo '=== done ==='
