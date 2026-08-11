-- ===========================================================================
-- Issue #1819 — rework of the adversarial tester's two HIGH findings against
-- Phase 2 of #1767 (the venue_orders money rail).
--
-- H-1 — ANON RETAINED TRUNCATE ON THE FIVE MONEY TABLES.
-- Phase 2 wrote its GRANTs and never revoked Supabase's DEFAULT table grants.
-- `ALTER DEFAULT PRIVILEGES` hands anon/authenticated the FULL privilege set on
-- every new public table, and RLS — which Phase 2 does enable, correctly — does
-- NOT gate TRUNCATE. The tester executed `TRUNCATE ... as anon` successfully
-- inside a rolled-back transaction on production. It is not reachable through
-- PostgREST today, which is the only reason it was HIGH rather than CRITICAL;
-- on five money tables it is one misconfiguration away from catastrophic.
--
-- Phase 1 got this right one migration earlier — `REVOKE ALL ON public.qr_spots
-- FROM anon;` (20270305001789:279, and the same for its other three tables).
-- This matches that pattern and extends it to `authenticated`, which needs
-- SELECT and nothing else.
--
-- This is the TABLE-level twin of the FUNCTION-level lesson #1790 already
-- learned the hard way: a default grant is an EXPLICIT ACL entry, so the only
-- thing that removes it is naming the role.
--
-- H-2 — THE IDEMPOTENCY KEY WAS A GLOBAL, CLIENT-CHOSEN NAMESPACE.
-- `venue_orders_idempotency_uniq ON (idempotency_key)` carried no tenant
-- scoping, so one brand's client-supplied key could collide with another's —
-- and because the replay read matched on the key alone, the loser of that
-- collision was handed back ANOTHER BRAND'S order id, total and payment status.
-- The unique index is now (brand_id, venue_id, idempotency_key): the same grain
-- the key's own derivation uses, since a session belongs to exactly one venue.
--
-- Tightening a uniqueness scope can only ever ADMIT rows that were previously
-- rejected; it can never collapse two distinct orders into one. A genuine retry
-- resolves the same spot, hence the same brand and venue, so replay detection is
-- unaffected.
--
-- DARK: no venue has ordering enabled and the order tables hold no rows, so
-- both changes are free of data motion. Apply via the Management-API lane from
-- MERGED main; never `supabase db push`.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- H-1. Revoke the default grants. anon gets NOTHING on any of the five.
--
-- `authenticated` keeps SELECT and only SELECT on the four order-family tables:
-- Supabase evaluates RLS per subscriber for `postgres_changes`, so removing the
-- read would silently kill the Phase-3 Orders queue's realtime — the exact
-- ORCH-0854 failure class. Its writes were never wanted: every order write is a
-- service-role edge function or a SECURITY DEFINER RPC, and the table carries no
-- INSERT/UPDATE/DELETE policy for it to pass anyway.
--
-- REVOKE-then-GRANT, in that order, so the end state is exactly the intended
-- set rather than the default set minus whatever was thought of.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.venue_order_sessions       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_orders               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_order_items          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_order_item_modifiers FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.venue_order_sessions       TO authenticated;
GRANT SELECT ON public.venue_orders               TO authenticated;
GRANT SELECT ON public.venue_order_items          TO authenticated;
GRANT SELECT ON public.venue_order_item_modifiers TO authenticated;

-- The limiter is service-role-only by design: it is written by the edge
-- function and read by nobody else. It has no RLS policy at all, so a default
-- grant here was pure surface.
REVOKE ALL ON public.venue_order_rate_limits FROM PUBLIC, anon, authenticated;

-- Service-role is re-stated so the intended end state is readable in one place.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_sessions       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_orders               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_items          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_item_modifiers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_rate_limits    TO service_role;

COMMENT ON TABLE public.venue_order_rate_limits IS
  'SPEC #1788 OQ-5 — per-spot order limiter. service_role ONLY: no RLS policy, '
  'no anon or authenticated grant (#1819 H-1). RLS does not gate TRUNCATE, so a '
  'default grant on a money-adjacent table is real surface, not theory.';

-- ---------------------------------------------------------------------------
-- H-2. Scope the idempotency namespace to the tenant.
--
-- Same index NAME, so nothing downstream has to learn a new one; only the key
-- widens. Dropped and recreated rather than altered because a unique index's
-- column list cannot be changed in place.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.venue_orders_idempotency_uniq;
CREATE UNIQUE INDEX venue_orders_idempotency_uniq
  ON public.venue_orders (brand_id, venue_id, idempotency_key);

COMMENT ON COLUMN public.venue_orders.idempotency_key IS
  'SPEC #1788 P-23 layer 1. CLIENT-SUPPLIED, therefore NOT a global namespace: '
  'unique per (brand_id, venue_id, idempotency_key) as of #1819 H-2. Before that '
  'scoping, one brand''s key could collide with another''s and the replay read '
  'would hand back the OTHER brand''s order id, total and payment status. Every '
  'reader of this column must filter on brand_id and venue_id too.';

COMMIT;
