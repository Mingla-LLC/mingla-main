-- Issue #4130 (Wave 3) — People, Brands and Offerings in Mingla Admin.
--
-- What this adds (read-only aggregates unless noted; every RPC is SECURITY
-- DEFINER, search_path pinned, is_admin_user() guard first, EXECUTE revoked from
-- PUBLIC and anon):
--
--   1. admin_internal_accounts — the one "staff and test" flag. A row decides;
--      with no row, the email rule decides (company domain, example.com, or
--      "test" in the address). Rows are seeded from the rule once here, and an
--      admin can mark or unmark anyone (audited, reason required).
--   2. admin_people_segments() / admin_list_people(...) / admin_get_person_activity(...)
--      — everyone with an account split into explorer (finished Explorer
--      onboarding), host (a live business account or an accepted brand team
--      role), both, incomplete (neither), internal (staff and test, left out of
--      every other count). Seed rows are never people.
--   3. admin_set_internal_account(...) — the audited mark/unmark (WRITE).
--   4. admin_brands_summary() / admin_list_brands_board(...) — brands with a
--      real owner name, payment readiness for Stripe AND Paystack, live
--      offerings and followers; deleted and staff/test brands hidden unless
--      asked for.
--   5. admin_offerings_summary() / admin_list_offerings_board(...) — offerings
--      by what an admin needs (on sale and upcoming / drafts / past / cancelled)
--      with one state per row and sold / going counts; offerings of deleted or
--      staff/test brands hidden unless asked for.
--
-- Payment readiness lives in ONE helper, admin_brand_payment_readiness_w3(),
-- so it can be swapped for the shared money helper when that lands (#4130
-- Wave 2a): Stripe Connect with charges and payouts on, OR an active
-- brand_paystack_recipients row; brands.payment_provider picks the label when
-- both are set up.
--
-- MINGLA-INVARIANT: I-4130-PEOPLE-SEGMENTS-ADMIN-ONLY | issue #4130 | People segments, brand and offering boards are admin-only aggregates; staff and test accounts are counted only as internal; marking an account internal is admin-only, needs a reason and writes admin_audit_log.

--------------------------------------------------------------------------------
-- 1. The staff and test flag.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_internal_accounts (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_internal boolean NOT NULL DEFAULT true,
  reason      text NOT NULL CHECK (length(btrim(reason)) > 0),
  marked_by   text NOT NULL CHECK (length(btrim(marked_by)) > 0),
  marked_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_internal_accounts IS
  'Issue #4130: staff and test accounts. A row decides (is_internal true or false); with no row the email rule in admin_internal_email_rule() decides. Read and written only through admin RPCs.';

-- No policies: nobody reads or writes this table from the browser.
ALTER TABLE public.admin_internal_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_internal_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_internal_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.admin_internal_email_rule(p_email text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_email, '') ~* '(usemingla|example\.com|test)'
$$;
REVOKE ALL ON FUNCTION public.admin_internal_email_rule(text) FROM PUBLIC, anon, authenticated;

-- Is this account staff or test? A row decides; else the email rule on the
-- profile, sign-in or business-account email.
CREATE OR REPLACE FUNCTION public.admin_account_is_internal(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT ia.is_internal FROM public.admin_internal_accounts ia WHERE ia.user_id = p_user_id),
    public.admin_internal_email_rule((SELECT p.email FROM public.profiles p WHERE p.id = p_user_id))
      OR public.admin_internal_email_rule((SELECT u.email FROM auth.users u WHERE u.id = p_user_id))
      OR public.admin_internal_email_rule((SELECT ca.email FROM public.creator_accounts ca WHERE ca.id = p_user_id)),
    false)
$$;
REVOKE ALL ON FUNCTION public.admin_account_is_internal(uuid) FROM PUBLIC, anon, authenticated;

-- Seed once from the rule, so every staff and test account has a recorded
-- reason. Later sign-ups that match the rule are internal without a row.
INSERT INTO public.admin_internal_accounts (user_id, is_internal, reason, marked_by)
SELECT p.id, true, 'Matched the staff and test email rule', 'rule'
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
 WHERE COALESCE(p.is_seed, false) = false
   AND (public.admin_internal_email_rule(p.email) OR public.admin_internal_email_rule(u.email))
ON CONFLICT (user_id) DO NOTHING;

--------------------------------------------------------------------------------
-- 2. Segments. One classification, used by every People RPC.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_people_classified()
RETURNS TABLE (user_id uuid, segment text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p.id,
    CASE
      WHEN public.admin_account_is_internal(p.id) THEN 'internal'
      WHEN h.is_host AND x.is_explorer THEN 'both'
      WHEN h.is_host THEN 'host'
      WHEN x.is_explorer THEN 'explorer'
      ELSE 'incomplete'
    END
  FROM public.profiles p
  CROSS JOIN LATERAL (
    SELECT (COALESCE(p.has_completed_onboarding, false) AND p.explorer_deleted_at IS NULL) AS is_explorer
  ) x
  CROSS JOIN LATERAL (
    SELECT (
      EXISTS (SELECT 1 FROM public.creator_accounts ca WHERE ca.id = p.id AND ca.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.brand_team_members m
                  WHERE m.user_id = p.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
    ) AS is_host
  ) h
  WHERE COALESCE(p.is_seed, false) = false
$$;
REVOKE ALL ON FUNCTION public.admin_people_classified() FROM PUBLIC, anon, authenticated;

-- Payment readiness of one brand. [TRANSITIONAL] swap for the shared Wave 2a
-- money helper at merge — exit when that helper is on main.
CREATE OR REPLACE FUNCTION public.admin_brand_payment_readiness_w3(p_brand_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN b.payment_provider = 'paystack' AND s.paystack_ok THEN 'paystack_ready'
    WHEN b.payment_provider = 'stripe' AND s.stripe_ok THEN 'stripe_ready'
    WHEN s.stripe_ok THEN 'stripe_ready'
    WHEN s.paystack_ok THEN 'paystack_ready'
    ELSE 'needs_bank'
  END
  FROM public.brands b
  CROSS JOIN LATERAL (
    SELECT
      (b.stripe_connect_id IS NOT NULL
        AND COALESCE(b.stripe_charges_enabled, false)
        AND COALESCE(b.stripe_payouts_enabled, false)) AS stripe_ok,
      EXISTS (SELECT 1 FROM public.brand_paystack_recipients r
               WHERE r.brand_id = b.id AND r.is_active) AS paystack_ok
  ) s
  WHERE b.id = p_brand_id
$$;
REVOKE ALL ON FUNCTION public.admin_brand_payment_readiness_w3(uuid) FROM PUBLIC, anon, authenticated;

-- An offering that is on sale or happening, not past.
CREATE OR REPLACE FUNCTION public.admin_offering_is_current(p_status text, p_start timestamptz)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_status IN ('scheduled', 'live')
     AND (p_start IS NULL OR p_start + interval '24 hours' > now())
$$;
REVOKE ALL ON FUNCTION public.admin_offering_is_current(text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_people_segments()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT jsonb_build_object(
    'explorer',   count(*) FILTER (WHERE c.segment = 'explorer'),
    'host',       count(*) FILTER (WHERE c.segment = 'host'),
    'both',       count(*) FILTER (WHERE c.segment = 'both'),
    'incomplete', count(*) FILTER (WHERE c.segment = 'incomplete'),
    'internal',   count(*) FILTER (WHERE c.segment = 'internal'),
    'people',     count(*) FILTER (WHERE c.segment <> 'internal'),
    'countries',  COALESCE((
      SELECT jsonb_agg(DISTINCT p.country ORDER BY p.country)
        FROM public.profiles p
        JOIN public.admin_people_classified() c2 ON c2.user_id = p.id
       WHERE NULLIF(btrim(p.country), '') IS NOT NULL), '[]'::jsonb),
    'as_of',      now()
  ) INTO v_out
  FROM public.admin_people_classified() c;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_segments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_segments() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_people(
  p_segment      text        DEFAULT 'explorer',
  p_search       text        DEFAULT NULL,
  p_country      text        DEFAULT NULL,
  p_joined_since timestamptz DEFAULT NULL,
  p_limit        integer     DEFAULT 25,
  p_offset       integer     DEFAULT 0,
  p_sort         text        DEFAULT 'joined_desc'
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
  IF p_segment IS NULL OR p_segment NOT IN ('explorer', 'host', 'both', 'incomplete', 'internal') THEN
    RAISE EXCEPTION 'invalid_segment';
  END IF;
  v_sort := CASE lower(COALESCE(p_sort, 'joined_desc'))
              WHEN 'joined_asc'       THEN 'joined_asc'
              WHEN 'name_asc'         THEN 'name_asc'
              WHEN 'name_desc'        THEN 'name_desc'
              WHEN 'last_active_desc' THEN 'last_active_desc'
              WHEN 'last_active_asc'  THEN 'last_active_asc'
              ELSE 'joined_desc'
            END;

  WITH base AS (
    SELECT p.id, p.email, p.phone, p.username, p.country, p.created_at, p.active,
           p.is_beta_tester, p.onboarding_step,
           COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             NULLIF(btrim(ca.display_name), ''),
             NULLIF(btrim(ca.business_name), ''),
             NULLIF(btrim(p.username), '')
           ) AS name,
           c.segment
      FROM public.admin_people_classified() c
      JOIN public.profiles p ON p.id = c.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = p.id
     WHERE c.segment = p_segment
       AND (p_country IS NULL OR p.country = p_country)
       AND (p_joined_since IS NULL OR p.created_at >= p_joined_since)
       AND (
         v_search IS NULL
         OR p.display_name ILIKE '%' || v_search || '%'
         OR concat_ws(' ', p.first_name, p.last_name) ILIKE '%' || v_search || '%'
         OR p.username ILIKE '%' || v_search || '%'
         OR p.email ILIKE '%' || v_search || '%'
         OR p.phone ILIKE '%' || v_search || '%'
         OR ca.business_name ILIKE '%' || v_search || '%'
       )
  ),
  enriched AS (
    SELECT b.*,
      u.raw_app_meta_data ->> 'provider' AS sign_in_method,
      NULLIF(GREATEST(
        COALESCE(u.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE((SELECT max(a.created_at) FROM public.user_activity a WHERE a.user_id = b.id), '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS last_active
      FROM base b
      LEFT JOIN auth.users u ON u.id = b.id
  ),
  ranked AS (
    SELECT e.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_sort = 'joined_asc'       THEN e.created_at END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'joined_desc'      THEN e.created_at END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'name_asc'         THEN lower(e.name) END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'name_desc'        THEN lower(e.name) END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'last_active_asc'  THEN e.last_active END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'last_active_desc' THEN e.last_active END) DESC NULLS LAST,
        e.created_at DESC, e.id
    ) AS rn
    FROM enriched e
  )
  SELECT
    (SELECT count(*) FROM base),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',             r.id,
      'name',           r.name,
      'email',          r.email,
      'phone',          r.phone,
      'country',        NULLIF(btrim(r.country), ''),
      'joined_at',      r.created_at,
      'last_active_at', r.last_active,
      'sign_in_method', r.sign_in_method,
      'banned',         (r.active = false),
      'is_beta_tester', COALESCE(r.is_beta_tester, false),
      'segment',        r.segment,
      'onboarding_step', r.onboarding_step,
      'closed_business_account', EXISTS (
        SELECT 1 FROM public.creator_accounts ca2 WHERE ca2.id = r.id AND ca2.deleted_at IS NOT NULL),
      'saves',   (SELECT count(*) FROM public.saved_card s WHERE s.profile_id = r.id),
      'tickets', (SELECT count(*) FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
                   WHERE o.buyer_user_id = r.id AND o.payment_status = 'paid' AND t.status <> 'void'),
      'friends', (SELECT count(*) FROM public.friends f
                   WHERE f.user_id = r.id AND f.status = 'accepted' AND f.deleted_at IS NULL),
      'brands', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.id, 'name', x.name, 'role', x.role,
                 'payment_readiness', public.admin_brand_payment_readiness_w3(x.id))
                 ORDER BY x.role_rank, x.name)
          FROM (
            SELECT b.id, b.name, 'brand_owner'::text AS role, 0 AS role_rank
              FROM public.brands b
             WHERE b.account_id = r.id AND b.deleted_at IS NULL
            UNION
            SELECT b.id, b.name, m.role, 1
              FROM public.brand_team_members m
              JOIN public.brands b ON b.id = m.brand_id
             WHERE m.user_id = r.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
               AND b.deleted_at IS NULL AND b.account_id IS DISTINCT FROM r.id
          ) x), '[]'::jsonb),
      'live_offerings', (
        SELECT count(*) FROM public.events e
          LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
         WHERE e.deleted_at IS NULL
           AND public.admin_offering_is_current(e.status, d.start_at)
           AND e.brand_id IN (
             SELECT b.id FROM public.brands b WHERE b.account_id = r.id AND b.deleted_at IS NULL
             UNION
             SELECT m.brand_id FROM public.brand_team_members m
              WHERE m.user_id = r.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)),
      'internal', (SELECT jsonb_build_object('reason', ia.reason, 'marked_by', ia.marked_by, 'marked_at', ia.marked_at)
                     FROM public.admin_internal_accounts ia WHERE ia.user_id = r.id AND ia.is_internal)
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_people(text, text, text, timestamptz, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_people(text, text, text, timestamptz, integer, integer, text) TO authenticated, service_role;

-- One person's activity for the drawer: the segment, last active, saves,
-- friends, and their tickets (newest 50).
CREATE OR REPLACE FUNCTION public.admin_get_person_activity(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT jsonb_build_object(
    'segment', (SELECT c.segment FROM public.admin_people_classified() c WHERE c.user_id = p_user_id),
    'is_seed', COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.id = p_user_id), false),
    'last_sign_in_at', (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = p_user_id),
    'last_activity_at', (SELECT max(a.created_at) FROM public.user_activity a WHERE a.user_id = p_user_id),
    'sign_in_method', (SELECT u.raw_app_meta_data ->> 'provider' FROM auth.users u WHERE u.id = p_user_id),
    'saves', (SELECT count(*) FROM public.saved_card s WHERE s.profile_id = p_user_id),
    'friends', (SELECT count(*) FROM public.friends f
                 WHERE f.user_id = p_user_id AND f.status = 'accepted' AND f.deleted_at IS NULL),
    'internal', (SELECT jsonb_build_object('is_internal', ia.is_internal, 'reason', ia.reason,
                                           'marked_by', ia.marked_by, 'marked_at', ia.marked_at)
                   FROM public.admin_internal_accounts ia WHERE ia.user_id = p_user_id),
    'orders', COALESCE((
      SELECT jsonb_agg(row_to_json(o_row)::jsonb ORDER BY o_row.created_at DESC)
        FROM (
          SELECT o.id, o.event_id, e.title AS event_title, e.event_type,
                 d.start_at AS event_start_at, o.payment_status, o.created_at,
                 o.total_cents, o.currency,
                 (SELECT count(*) FROM public.tickets t WHERE t.order_id = o.id AND t.status <> 'void') AS ticket_count
            FROM public.orders o
            LEFT JOIN public.events e ON e.id = o.event_id
            LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
           WHERE o.buyer_user_id = p_user_id
           ORDER BY o.created_at DESC
           LIMIT 50
        ) o_row), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_person_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_person_activity(uuid) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. Mark or unmark staff and test (WRITE, audited, reason required).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_internal_account(
  p_user_id  uuid,
  p_internal boolean,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_email  text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_internal IS NULL THEN RAISE EXCEPTION 'internal_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();

  v_before := jsonb_build_object(
    'is_internal', public.admin_account_is_internal(p_user_id),
    'row', (SELECT to_jsonb(ia) FROM public.admin_internal_accounts ia WHERE ia.user_id = p_user_id));

  INSERT INTO public.admin_internal_accounts AS ia (user_id, is_internal, reason, marked_by, marked_at)
  VALUES (p_user_id, p_internal, btrim(p_reason), COALESCE(v_email, 'admin'), now())
  ON CONFLICT (user_id) DO UPDATE
    SET is_internal = EXCLUDED.is_internal,
        reason      = EXCLUDED.reason,
        marked_by   = EXCLUDED.marked_by,
        marked_at   = EXCLUDED.marked_at;

  v_after := jsonb_build_object(
    'is_internal', public.admin_account_is_internal(p_user_id),
    'row', (SELECT to_jsonb(ia) FROM public.admin_internal_accounts ia WHERE ia.user_id = p_user_id));

  PERFORM public.admin_write_audit(
    CASE WHEN p_internal THEN 'person.mark_internal' ELSE 'person.unmark_internal' END,
    'user', p_user_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));

  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_internal_account(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_internal_account(uuid, boolean, text) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. Brands.
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
           (br.account_id IS NOT NULL AND public.admin_account_is_internal(br.account_id)) AS internal
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
                           WHERE public.admin_brand_payment_readiness_w3(live.id) <> 'needs_bank'),
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
           (br.account_id IS NOT NULL AND public.admin_account_is_internal(br.account_id)) AS internal,
           public.admin_brand_payment_readiness_w3(br.id) AS payment_readiness,
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
        WHERE e.brand_id = b.id AND e.deleted_at IS NULL
          AND public.admin_offering_is_current(e.status, d.start_at)) AS live_offerings,
      (SELECT count(*) FROM public.brand_follows f WHERE f.brand_id = b.id) AS followers
      FROM base b
     WHERE (COALESCE(p_show_hidden, false) OR (b.deleted_at IS NULL AND NOT b.internal))
       AND (p_payments IS NULL
            OR (p_payments = 'ready' AND b.payment_readiness <> 'needs_bank')
            OR (p_payments = 'needs_bank' AND b.payment_readiness = 'needs_bank'))
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
      'created_at', r.created_at, 'deleted_at', r.deleted_at, 'internal', r.internal
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_brands_board(text, boolean, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_brands_board(text, boolean, text, text, integer, integer) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 5. Offerings.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_offerings_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH shown AS (
    SELECT e.id, e.status, e.visibility, e.published_at, d.start_at
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
     WHERE e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND NOT (b.account_id IS NOT NULL AND public.admin_account_is_internal(b.account_id))
  )
  SELECT jsonb_build_object(
    'on_sale_public', (SELECT count(*) FROM shown s
                        WHERE s.visibility = 'public' AND public.admin_offering_is_current(s.status, s.start_at)),
    'starting_14_days', (SELECT count(*) FROM shown s
                          WHERE s.visibility = 'public' AND public.admin_offering_is_current(s.status, s.start_at)
                            AND s.start_at >= now() AND s.start_at < now() + interval '14 days'),
    'drafts_never_published', (SELECT count(*) FROM shown s WHERE s.status = 'draft' AND s.published_at IS NULL),
    'sold_7_days', (SELECT count(*) FROM public.tickets t
                      JOIN public.orders o ON o.id = t.order_id
                      JOIN shown s ON s.id = t.event_id
                     WHERE o.payment_status = 'paid' AND t.status <> 'void'
                       AND COALESCE(o.confirmed_at, o.created_at) >= now() - interval '7 days'),
    'as_of', now()
  ) INTO v_out;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_offerings_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_offerings_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_offerings_board(
  p_view        text    DEFAULT 'on_sale',
  p_search      text    DEFAULT NULL,
  p_event_type  text    DEFAULT NULL,
  p_brand_id    uuid    DEFAULT NULL,
  p_show_hidden boolean DEFAULT false,
  p_sort_dir    text    DEFAULT NULL,
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
  v_view   text := lower(COALESCE(p_view, 'on_sale'));
  v_asc    boolean;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_view NOT IN ('on_sale', 'drafts', 'past', 'cancelled', 'all') THEN
    RAISE EXCEPTION 'invalid_view';
  END IF;
  -- Soonest first for what is on sale; newest first everywhere else.
  v_asc := CASE lower(COALESCE(p_sort_dir, ''))
             WHEN 'asc' THEN true
             WHEN 'desc' THEN false
             ELSE v_view = 'on_sale'
           END;

  WITH base AS (
    SELECT e.id, e.title, e.slug, e.event_type, e.status, e.visibility, e.brand_id,
           e.city, e.currency, e.published_at, e.created_at, e.bookings_closed, e.deleted_at,
           b.name AS brand_name,
           d.start_at,
           (e.deleted_at IS NOT NULL OR b.deleted_at IS NOT NULL
             OR (b.account_id IS NOT NULL AND public.admin_account_is_internal(b.account_id))) AS hidden,
           CASE
             WHEN e.status = 'cancelled' THEN 'cancelled'
             WHEN e.status = 'draft' THEN 'draft'
             WHEN e.status = 'ended' OR NOT public.admin_offering_is_current(e.status, d.start_at) THEN 'ended'
             WHEN d.start_at IS NOT NULL AND now() >= d.start_at - interval '4 hours' THEN 'happening_now'
             WHEN e.visibility IN ('private', 'hidden') THEN e.visibility
             WHEN COALESCE(e.bookings_closed, false) THEN 'sales_closed'
             ELSE 'on_sale'
           END AS state
      FROM public.events e
      LEFT JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
  ),
  filtered AS (
    SELECT * FROM base
     WHERE (COALESCE(p_show_hidden, false) OR NOT hidden)
       AND (p_event_type IS NULL OR event_type = p_event_type)
       AND (p_brand_id IS NULL OR brand_id = p_brand_id)
       AND (
         v_view = 'all'
         OR (v_view = 'on_sale' AND state IN ('on_sale', 'happening_now', 'sales_closed', 'private', 'hidden'))
         OR (v_view = 'drafts' AND state = 'draft')
         OR (v_view = 'past' AND state = 'ended')
         OR (v_view = 'cancelled' AND state = 'cancelled')
       )
       AND (v_search IS NULL
            OR title ILIKE '%' || v_search || '%'
            OR brand_name ILIKE '%' || v_search || '%'
            OR city ILIKE '%' || v_search || '%'
            OR slug ILIKE '%' || v_search || '%')
  ),
  ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_view IN ('on_sale', 'past') AND v_asc THEN f.start_at END) ASC NULLS LAST,
        (CASE WHEN v_view IN ('on_sale', 'past') AND NOT v_asc THEN f.start_at END) DESC NULLS LAST,
        (CASE WHEN v_asc THEN f.created_at END) ASC,
        (CASE WHEN NOT v_asc THEN f.created_at END) DESC,
        f.id
    ) AS rn
    FROM filtered f
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'slug', r.slug, 'event_type', r.event_type,
      'status', r.status, 'visibility', r.visibility, 'state', r.state,
      'brand_id', r.brand_id, 'brand_name', r.brand_name, 'city', r.city,
      'currency', r.currency, 'start_at', r.start_at, 'published_at', r.published_at,
      'created_at', r.created_at, 'hidden', r.hidden,
      'sold', (SELECT count(*) FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
                WHERE t.event_id = r.id AND o.payment_status = 'paid' AND t.status <> 'void'),
      'going', (SELECT count(*) FROM public.event_rsvps rv
                 WHERE rv.event_id = r.id AND rv.rsvp_status = 'going' AND rv.approval_status = 'approved')
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_offerings_board(text, text, text, uuid, boolean, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_offerings_board(text, text, text, uuid, boolean, text, integer, integer) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- Self-check: apply fails if anon could run any of these.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_people_segments()',
    'public.admin_list_people(text,text,text,timestamptz,integer,integer,text)',
    'public.admin_get_person_activity(uuid)',
    'public.admin_set_internal_account(uuid,boolean,text)',
    'public.admin_brands_summary()',
    'public.admin_list_brands_board(text,boolean,text,text,integer,integer)',
    'public.admin_offerings_summary()',
    'public.admin_list_offerings_board(text,text,text,uuid,boolean,text,integer,integer)',
    'public.admin_people_classified()',
    'public.admin_account_is_internal(uuid)',
    'public.admin_brand_payment_readiness_w3(uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue #4130: % is still executable by anon', v_fn;
    END IF;
  END LOOP;
END $$;
