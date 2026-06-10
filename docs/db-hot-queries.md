# Database hot queries (#426 PR4)

Maps **load-profile critical paths** to Postgres access patterns, supporting indexes, and staging verification steps.

Full 100k proof still requires staging `EXPLAIN ANALYZE` — see [scripts/db/explain-hot-queries.sql](../scripts/db/explain-hot-queries.sql).

## Critical paths (from load profile)

| Path | Edge / RPC | Tables | Migration indexes |
|------|------------|--------|-------------------|
| Discover merge | `discover-merged-events` | `events`, `brands`, `event_dates`, `ticket_types` | `idx_events_city_published` (ORCH-0824) |
| Checkout create | `ticket-checkout-create` | `event_dates`, `ticket_types`, `events` | `idx_event_dates_event_id_end_at` (ORCH-426) |
| Checkout status | `ticket-checkout-status` | `ticket_checkout_sessions`, `tickets`, `orders` | `idx_tickets_order_id_created_at` (ORCH-426) |
| Ari chat | `agent-chat` | `agent_conversations`, `agent_messages`, `agent_pending_actions` | `idx_agent_messages_user_role_created` (ORCH-426) |

## Query patterns

### Checkout create — future dates gate

```sql
SELECT count(*) FROM event_dates
WHERE event_id = $1 AND end_at > now();
```

**Index:** `(event_id, end_at)` — `idx_event_dates_event_id_end_at`

### Checkout status — tickets for order

```sql
SELECT * FROM tickets
WHERE order_id = $1
ORDER BY created_at ASC;
```

**Index:** `(order_id, created_at)` — `idx_tickets_order_id_created_at` (supplements `idx_tickets_order_id`)

### Agent chat — daily turn rate limit

```sql
SELECT count(*) FROM agent_messages
WHERE user_id = $1 AND role = 'user' AND created_at >= $2;
```

**Index:** partial `(user_id, created_at DESC) WHERE role = 'user'` — `idx_agent_messages_user_role_created`

### Discover — public events by city

Service-role read with explicit visibility filter. Partial index on published public events:

**Index:** `idx_events_city_published` — `(city) WHERE deleted_at IS NULL AND visibility = 'public' AND status IN ('scheduled','live')`

## RLS performance

High-traffic owner-scoped tables (`agent_*`, checkout) use `user_id = auth.uid()` in policies. Supabase recommends `(select auth.uid())` for initplan caching on large scans.

- Audit: `node scripts/audit/rls-perf-heuristic.mjs` (warn-only in CI)
- Fix pattern: replace `auth.uid()` with `(select auth.uid())` in policy predicates when EXPLAIN shows per-row initplan cost

## Staging verification

1. Set `DATABASE_URL` to staging (read-only role OK for EXPLAIN).
2. Run `scripts/db/explain-hot-queries.sql` in psql or Supabase SQL editor.
3. Confirm **Index Scan** or **Bitmap Index Scan** — not Seq Scan on large tables.
4. Attach output to epic #426 before checking Workstream B boxes.

## Open items (post-PR4)

- Top-20 query list from `pg_stat_statements` on staging (operator)
- RLS policy rewrites where audit + EXPLAIN justify it
- Connection pool sizing (Supavisor) — operator doc in `docs/LAUNCH_GATES.md`
