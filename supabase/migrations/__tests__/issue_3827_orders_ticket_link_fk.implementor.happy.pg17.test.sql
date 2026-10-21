-- issue #3827 — orders link to their private ticket link, implementor happy path (pg17 post-replay).
-- MINGLA-INVARIANT: I-3827-ORDERS-EMBEDS-HAVE-FKS | issue #3827 | every table the Host Orders/Guests select (eventOrdersService.fetchEventOrders) embeds is joined to its parent by a real foreign key, and orders.ticket_link_id references ticket_type_links(id) ON DELETE SET NULL through exactly one path.
--
-- PostgREST resolves `orders?select=...,ticket_type_links(label)` only through a
-- foreign key. Without orders_ticket_link_id_fkey it answers HTTP 400 and every
-- Orders and Guests screen fails (production, 2026-10-21). Mocked client tests
-- cannot see this, so the schema itself is asserted here.

\set ON_ERROR_STOP on

-- Read-only catalog checks; no transaction wrapper, because step 4 re-runs the
-- migration, which carries its own BEGIN/COMMIT.

CREATE OR REPLACE FUNCTION pg_temp.i3827fk_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #3827 orders FK FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- Foreign keys joining two public tables, in either direction.
CREATE OR REPLACE FUNCTION pg_temp.i3827fk_links(p_a text, p_b text)
RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND ((c.conrelid = to_regclass('public.' || p_a) AND c.confrelid = to_regclass('public.' || p_b))
       OR (c.conrelid = to_regclass('public.' || p_b) AND c.confrelid = to_regclass('public.' || p_a)))
$$;

-- 1. The exact constraint the hotfix applied.
SELECT pg_temp.i3827fk_assert(
  EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
     WHERE c.conrelid = 'public.orders'::regclass
       AND c.conname = 'orders_ticket_link_id_fkey'
       AND c.contype = 'f'
       AND c.confrelid = 'public.ticket_type_links'::regclass
       AND array_length(c.conkey, 1) = 1
       AND a.attname = 'ticket_link_id'
       AND fa.attname = 'id'
       AND c.confdeltype = 'n'
       AND c.convalidated
  ),
  'orders.ticket_link_id references ticket_type_links(id) ON DELETE SET NULL (validated)'
);

-- 2. Exactly one path, so the embed is not ambiguous (PGRST201).
SELECT pg_temp.i3827fk_assert(
  pg_temp.i3827fk_links('orders', 'ticket_type_links') = 1,
  'orders <-> ticket_type_links has exactly one foreign key'
);

-- 3. Every embed in eventOrdersService.fetchEventOrders is backed by a real FK.
SELECT pg_temp.i3827fk_assert(pg_temp.i3827fk_links(e.parent, e.child) >= 1,
         'embed ' || e.parent || ' -> ' || e.child || ' has a foreign key')
  FROM (VALUES
    ('orders', 'ticket_type_links'),
    ('orders', 'events'),
    ('orders', 'tickets'),
    ('tickets', 'ticket_event_dates'),
    ('orders', 'order_line_items'),
    ('order_line_items', 'ticket_types'),
    ('orders', 'refunds'),
    ('refunds', 'refund_line_items')
  ) AS e(parent, child);

-- 4. Re-running the migration where the constraint already exists (as in production) is a no-op.
\ir ../20271210003827_issue_3827_orders_ticket_link_fk.sql
SELECT pg_temp.i3827fk_assert(
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_ticket_link_id_fkey') = 1,
  're-running the migration where the constraint exists changes nothing'
);
