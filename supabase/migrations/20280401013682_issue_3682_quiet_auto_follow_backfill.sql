-- #3682 closeout — quiet backfill of the automatic follows that never fired.
--
-- From #3774 (2026-10-08) until the .finally fix, every auto-follow crashed in
-- the edge helper before reaching the database, so no signed-in buyer was
-- followed. Seth (2026-11-03): backfill quietly, source = 'purchase', no message.
--
-- Scope: orders created on/after 2026-10-08 that are paid (or partially
-- refunded), have a buyer_user_id, and have no auto-follow claim yet.
--   * The claim is recorded for every such order (it marks the order as
--     processed, so a late confirm/webhook replay can never follow later).
--   * The follow is inserted only when the person
--       - still has a live Explorer profile (not deleted, not deactivated),
--       - does not already follow the brand, and
--       - shows no sign of having unfollowed it: brand_follows is hard-deleted
--         on unfollow, so the only surviving trace is a per-brand channel
--         preference row (brand_follow_channel_prefs) for a brand they no
--         longer follow. Those people are skipped.
--   * The brand must not be deleted.
-- The work lives in private.issue_3682_backfill_auto_follows() (no client
-- grants) so the PG17 suite can re-run it on seeded rows; the migration calls it
-- once.
-- Idempotent: the NOT EXISTS on claims and ON CONFLICT on follows make a
-- re-run a no-op. Nothing here sends anything: the only trigger on
-- brand_follows (issue_1777_brand_follows_source) marks circle reach for
-- recompute; it does not notify.

BEGIN;

CREATE OR REPLACE FUNCTION private.issue_3682_backfill_auto_follows(
  p_since timestamptz DEFAULT timestamptz '2026-10-08 00:00:00+00'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_orders integer := 0;
  v_follows integer := 0;
  v_claims integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS issue_3682_backfill_orders (
    order_id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    brand_id uuid NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE issue_3682_backfill_orders;

  INSERT INTO issue_3682_backfill_orders (order_id, user_id, brand_id)
  SELECT o.id, o.buyer_user_id, e.brand_id
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    JOIN public.profiles p ON p.id = o.buyer_user_id
                          AND p.active
                          AND p.explorer_deleted_at IS NULL
   WHERE o.buyer_user_id IS NOT NULL
     AND o.payment_status IN ('paid', 'partial_refund')
     AND o.created_at >= p_since
     AND NOT EXISTS (
       SELECT 1 FROM public.brand_follow_auto_claims c
        WHERE c.order_id = o.id
     );
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  INSERT INTO public.brand_follows (user_id, brand_id, source)
  SELECT DISTINCT bo.user_id, bo.brand_id, 'purchase'
    FROM issue_3682_backfill_orders bo
   WHERE NOT EXISTS (
           SELECT 1 FROM public.brand_follows f
            WHERE f.user_id = bo.user_id AND f.brand_id = bo.brand_id
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.brand_follow_channel_prefs cp
            WHERE cp.user_id = bo.user_id AND cp.brand_id = bo.brand_id
         )
  ON CONFLICT ON CONSTRAINT brand_follows_user_brand_key DO NOTHING;
  GET DIAGNOSTICS v_follows = ROW_COUNT;

  INSERT INTO public.brand_follow_auto_claims (
    order_id, user_id, brand_id, source, source_kind, source_id
  )
  SELECT bo.order_id, bo.user_id, bo.brand_id, 'purchase', 'order', bo.order_id
    FROM issue_3682_backfill_orders bo
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_claims = ROW_COUNT;

  TRUNCATE issue_3682_backfill_orders;
  RETURN jsonb_build_object(
    'orders', v_orders, 'follows', v_follows, 'claims', v_claims
  );
END;
$f$;

REVOKE ALL ON FUNCTION private.issue_3682_backfill_auto_follows(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

DO $run$
DECLARE v jsonb;
BEGIN
  v := private.issue_3682_backfill_auto_follows();
  RAISE NOTICE 'issue-3682 quiet auto-follow backfill: %', v;
END
$run$;

COMMIT;
