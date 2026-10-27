-- Issue #4130 (integration) — one owner for brand payment readiness.
--
-- Wave 2a decides whether a brand can take money and get paid
-- (mingla-admin/src/lib/paymentReadiness.js), over the facts
-- admin_list_brand_payment_readiness reads (20280111004130): the brand's chosen
-- provider (brands.payment_provider), its Stripe Connect account
-- (stripe_connect_accounts), and its active Paystack recipient
-- (brand_paystack_recipients). Wave 3's Brands and People boards needed the
-- same verdict inside SQL (to count and filter), and had their own rule.
--
-- This migration gives the boards the Wave 2a rule, so Brands and Payments
-- can never disagree:
--
--   1. admin_brand_payment_readiness(p_brand_id) — the Wave 2a verdict as one
--      code, '<provider>_<state>':
--        provider: the chosen one (paystack | stripe); else paystack when a
--                  Paystack recipient or subaccount exists; else stripe.
--        paystack: ready (active recipient) | needs_action (subaccount, no
--                  bank) | no_setup.
--        stripe:   no_setup (no account) | needs_action (disconnected, overdue
--                  details, card payments or payouts off) | ready.
--      The same rule, in the same order, as paymentReadiness.js
--      brandProvider / paystackReadiness / stripeReadiness. Both sides are
--      pinned by issue_4130_integration tests (pg17 + admin node:test).
--   2. admin_brand_payment_readiness_w3(p_brand_id) delegates to it (Wave 3's
--      admin_list_people embeds it per brand).
--   3. admin_brands_summary() and admin_list_brands_board(...) count and filter
--      on the new codes. p_payments accepts ready | needs_action | no_setup,
--      and the older 'needs_bank' (= not ready) so an old link still filters.
--
-- Bodies of 3 are Wave 3's (20280113004130) with only the readiness
-- comparisons changed. Idempotent: CREATE OR REPLACE throughout.

--------------------------------------------------------------------------------
-- 1. The verdict.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_brand_payment_readiness(p_brand_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN f.provider = 'paystack' THEN
      CASE
        WHEN f.paystack_recipient_active THEN 'paystack_ready'
        WHEN f.paystack_subaccount_code IS NOT NULL THEN 'paystack_needs_action'
        ELSE 'paystack_no_setup'
      END
    ELSE
      CASE
        WHEN NOT f.has_stripe_account AND f.stripe_connect_id IS NULL THEN 'stripe_no_setup'
        WHEN f.stripe_detached THEN 'stripe_needs_action'
        WHEN f.stripe_past_due_count > 0 THEN 'stripe_needs_action'
        WHEN NOT f.stripe_charges_enabled THEN 'stripe_needs_action'
        WHEN NOT f.stripe_payouts_enabled THEN 'stripe_needs_action'
        ELSE 'stripe_ready'
      END
  END
  FROM (
    SELECT
      CASE
        WHEN lower(b.payment_provider) IN ('paystack', 'stripe') THEN lower(b.payment_provider)
        WHEN rcp.active OR b.paystack_subaccount_code IS NOT NULL THEN 'paystack'
        ELSE 'stripe'
      END AS provider,
      rcp.active AS paystack_recipient_active,
      b.paystack_subaccount_code,
      b.stripe_connect_id,
      sca.id IS NOT NULL AS has_stripe_account,
      COALESCE(sca.charges_enabled, false) AS stripe_charges_enabled,
      COALESCE(sca.payouts_enabled, false) AS stripe_payouts_enabled,
      sca.detached_at IS NOT NULL AS stripe_detached,
      CASE WHEN jsonb_typeof(sca.requirements->'past_due') = 'array'
        THEN jsonb_array_length(sca.requirements->'past_due') ELSE 0 END AS stripe_past_due_count
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = b.id
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM public.brand_paystack_recipients pr
                      WHERE pr.brand_id = b.id AND pr.is_active) AS active
    ) rcp
    WHERE b.id = p_brand_id
  ) f
$$;
COMMENT ON FUNCTION public.admin_brand_payment_readiness(uuid) IS
  'Issue #4130: a brand''s payment readiness as ''<provider>_<state>'' (ready | needs_action | no_setup), the Wave 2a rule of mingla-admin/src/lib/paymentReadiness.js over the facts admin_list_brand_payment_readiness reads. Internal helper; not callable by signed-in users.';
REVOKE ALL ON FUNCTION public.admin_brand_payment_readiness(uuid) FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 2. Wave 3's helper delegates (admin_list_people calls it per brand).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_brand_payment_readiness_w3(p_brand_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.admin_brand_payment_readiness(p_brand_id)
$$;
REVOKE ALL ON FUNCTION public.admin_brand_payment_readiness_w3(uuid) FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 3. Brands: count and filter on the shared verdict.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_brands_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH b AS (
    SELECT br.id, br.deleted_at,
           public.admin_brand_is_internal(br.id) AS internal
      FROM public.brands br
  ),
  live AS (
    SELECT b.id FROM b WHERE b.deleted_at IS NULL AND NOT b.internal
  )
  SELECT jsonb_build_object(
    'live_brands',      (SELECT count(*) FROM live),
    'hidden_brands',    (SELECT count(*) FROM b WHERE b.deleted_at IS NOT NULL OR b.internal),
    'deleted_brands',   (SELECT count(*) FROM b WHERE b.deleted_at IS NOT NULL),
    'internal_brands',  (SELECT count(*) FROM b WHERE b.deleted_at IS NULL AND b.internal),
    'ready_to_get_paid', (SELECT count(*) FROM live
                           WHERE public.admin_brand_payment_readiness(live.id) LIKE '%\_ready'),
    'with_live_public_offering', (
      SELECT count(*) FROM live
       WHERE EXISTS (
         SELECT 1 FROM public.events e
           LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
          WHERE e.brand_id = live.id AND e.deleted_at IS NULL AND e.visibility = 'public'
            AND public.admin_offering_is_current(e.status, d.start_at))),
    'venue_claims_waiting', (SELECT count(*) FROM public.venue_listings v WHERE v.claim_status = 'pending_review'),
    'as_of', now()
  ) INTO v_out;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_brands_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_brands_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_brands_board(
  p_search      text    DEFAULT NULL,
  p_show_hidden boolean DEFAULT false,
  p_payments    text    DEFAULT NULL,
  p_sort        text    DEFAULT 'created_desc',
  p_limit       integer DEFAULT 25,
  p_offset      integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_sort   text;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_sort := CASE lower(COALESCE(p_sort, 'created_desc'))
              WHEN 'created_asc'          THEN 'created_asc'
              WHEN 'name_asc'             THEN 'name_asc'
              WHEN 'name_desc'            THEN 'name_desc'
              WHEN 'live_offerings_desc'  THEN 'live_offerings_desc'
              WHEN 'followers_desc'       THEN 'followers_desc'
              ELSE 'created_desc'
            END;

  WITH base AS (
    SELECT br.id, br.name, br.slug, br.account_id, br.country_code, br.default_currency,
           br.payment_provider, br.take_rate_bps_override, br.claim_status,
           br.created_at, br.deleted_at, br.city,
           public.admin_brand_is_internal(br.id) AS internal,
           public.admin_brand_payment_readiness(br.id) AS payment_readiness,
           COALESCE(
             NULLIF(btrim(op.display_name), ''),
             NULLIF(btrim(concat_ws(' ', op.first_name, op.last_name)), ''),
             NULLIF(btrim(ca.display_name), ''),
             NULLIF(btrim(ca.business_name), ''),
             op.email, ca.email
           ) AS owner_name,
           COALESCE(op.email, ca.email) AS owner_email
      FROM public.brands br
      LEFT JOIN public.profiles op ON op.id = br.account_id
      LEFT JOIN public.creator_accounts ca ON ca.id = br.account_id
  ),
  filtered AS (
    SELECT b.*,
      (SELECT count(*) FROM public.events e
         LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
        WHERE e.brand_id = b.id AND e.deleted_at IS NULL AND e.visibility = 'public'
          -- #4130: public and on sale, the same rule as the KPI tile.
          AND public.admin_offering_is_current(e.status, d.start_at)) AS live_offerings,
      (SELECT count(*) FROM public.brand_follows f WHERE f.brand_id = b.id) AS followers
      FROM base b
     WHERE (COALESCE(p_show_hidden, false) OR (b.deleted_at IS NULL AND NOT b.internal))
       AND (p_payments IS NULL
            OR (p_payments = 'ready'        AND b.payment_readiness LIKE '%\_ready')
            OR (p_payments = 'needs_action' AND b.payment_readiness LIKE '%\_needs\_action')
            OR (p_payments = 'no_setup'     AND b.payment_readiness LIKE '%\_no\_setup')
            -- An older link: 'needs_bank' meant "not ready to get paid".
            OR (p_payments = 'needs_bank'   AND b.payment_readiness NOT LIKE '%\_ready'))
       AND (v_search IS NULL
            OR b.id::text = v_search
            OR b.name ILIKE '%' || v_search || '%'
            OR b.slug ILIKE '%' || v_search || '%'
            OR b.city ILIKE '%' || v_search || '%'
            OR b.owner_name ILIKE '%' || v_search || '%'
            OR b.owner_email ILIKE '%' || v_search || '%')
  ),
  ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_sort = 'created_asc'         THEN f.created_at END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'created_desc'        THEN f.created_at END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'name_asc'            THEN lower(f.name) END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'name_desc'           THEN lower(f.name) END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'live_offerings_desc' THEN f.live_offerings END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'followers_desc'      THEN f.followers END) DESC NULLS LAST,
        f.created_at DESC, f.id
    ) AS rn
    FROM filtered f
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'city', r.city,
      'owner_id', r.account_id, 'owner_name', r.owner_name, 'owner_email', r.owner_email,
      'country_code', r.country_code, 'default_currency', r.default_currency,
      'payment_provider', r.payment_provider, 'payment_readiness', r.payment_readiness,
      'take_rate_bps_override', r.take_rate_bps_override, 'claim_status', r.claim_status,
      'live_offerings', r.live_offerings, 'followers', r.followers,
      'created_at', r.created_at, 'deleted_at', r.deleted_at, 'internal', r.internal,
      'internal_decision', (SELECT jsonb_build_object('is_internal', ib.is_internal, 'reason', ib.reason,
                                                      'marked_by', ib.marked_by, 'marked_at', ib.marked_at)
                              FROM public.admin_internal_brands ib WHERE ib.brand_id = r.id)
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_brands_board(text, boolean, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_brands_board(text, boolean, text, text, integer, integer) TO authenticated, service_role;

