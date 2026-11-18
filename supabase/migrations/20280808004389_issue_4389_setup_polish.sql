-- Issue #4389 — Host polish pass P1/P8 (spec 2026-11-18; Seth's decisions of
-- 2026-11-18: Q1, and "a handover never reopens setup", which supersedes Q2).
--
-- "Setup done" (issue_4389_brand_setup_facts) changes in three ways:
--   P1  terms are done for the BRAND once any owner or admin of it accepted the
--       current version (1.0). A brand-level record (public.brand_terms_acceptances,
--       one row per brand and version) is written by a trigger whenever an
--       active, accepted brand_owner / brand_admin row carries an acceptance,
--       and is backfilled from every past acceptance (removed members
--       included). So an owner handover never reopens setup, including the
--       'leave' handover (#3660) and admin reassignment (#3622), which REMOVE
--       the old owner. Terms also count while an active owner / admin holds the
--       acceptance. A new terms version has no record yet, so it reopens.
--   P8  a Paystack brand on the hold rail counts as able to take money (the
--       hold-rail clause of pg_brand_can_collect); a new key bank_connected
--       says whether a bank is actually attached.
--   P8  free_only_at is derived: NULL whenever the brand can take money.
-- brand_readiness_internal: the brand_setup "Payment details" preview reads
-- "Bank connected" only with a bank, "Ready to sell" on the hold rail.
--
-- Why a small table and not brands columns: it keeps one row per terms
-- version (a new version is a new row, older acceptances stay as history),
-- it is service-role only with RLS forced (the brands row is client-readable
-- and widely typed), and the one writer is the trigger below, whatever path
-- writes the member acceptance (today the brand-mingla-tos-accept edge
-- function, which needs no change).
--
-- Per-person terms checks on actions (bank add, payments start, paid publish)
-- are unchanged on purpose: they still read the caller's own member row.
--
-- Invariant (owned by tests): I-4389-SETUP-TERMS-BRAND-LEVEL | issue #4389 | brand_setup terms are done when the brand has a brand_terms_acceptances row for version 1.0 (written by trigger from any active, accepted brand_owner / brand_admin acceptance, backfilled from all past ones) OR an active, accepted owner / admin holds 1.0; no handover or member removal reopens it; a new version does; roles below admin and pending invites never write it.
-- Invariant (owned by tests): I-4389-SETUP-DETAILS-AGREES-WITH-SELL | issue #4389 | a Paystack hold-rail brand counts as able to take money in setup facts.
-- Invariant (owned by tests): I-4389-FREE-ONLY-NEVER-WITH-COLLECT | issue #4389 | setup facts never report free_only_at while details (can take money) is true.
--
-- Static SQL only. Both functions are copied verbatim from their latest
-- definition (20280701004389_issue_4389_brand_setup.sql) with only the marked
-- #4389 P1/P8 changes. Ends in a self-assert block.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 0. Brand-level terms acceptance (P1) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_terms_acceptances (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  version text NOT NULL CHECK (length(btrim(version)) > 0),
  first_accepted_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, version)
);
ALTER TABLE public.brand_terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_terms_acceptances FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_terms_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.brand_terms_acceptances TO service_role;
COMMENT ON TABLE public.brand_terms_acceptances IS
  'Issue #4389: the brand has accepted Mingla terms <version> (first time an owner or admin of it did). Written only by trigger issue_4389_record_brand_terms on brand_team_members; read by issue_4389_brand_setup_facts. Never deleted by a member removal or owner handover.';

CREATE OR REPLACE FUNCTION public.issue_4389_record_brand_terms()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- The WHEN clause already limits this to active, accepted owner / admin
  -- rows that carry an acceptance; re-check so the function is safe alone.
  IF NEW.removed_at IS NULL
     AND NEW.accepted_at IS NOT NULL
     AND NEW.role IN ('brand_owner','brand_admin')
     AND NEW.mingla_tos_accepted_at IS NOT NULL
     AND NULLIF(btrim(COALESCE(NEW.mingla_tos_version_accepted, '')), '') IS NOT NULL THEN
    INSERT INTO public.brand_terms_acceptances (brand_id, version, first_accepted_at)
    VALUES (NEW.brand_id, NEW.mingla_tos_version_accepted, NEW.mingla_tos_accepted_at)
    ON CONFLICT (brand_id, version) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_record_brand_terms() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4389_record_brand_terms ON public.brand_team_members;
CREATE TRIGGER issue_4389_record_brand_terms
AFTER INSERT OR UPDATE OF mingla_tos_version_accepted, mingla_tos_accepted_at, accepted_at, role, removed_at
ON public.brand_team_members
FOR EACH ROW
WHEN (NEW.removed_at IS NULL AND NEW.accepted_at IS NOT NULL
  AND NEW.role IN ('brand_owner','brand_admin')
  AND NEW.mingla_tos_accepted_at IS NOT NULL
  AND NEW.mingla_tos_version_accepted IS NOT NULL)
EXECUTE FUNCTION public.issue_4389_record_brand_terms();

-- Backfill: every past acceptance by an owner or admin who had joined,
-- removed members included (the earliest time per brand and version). A
-- function (service_role only) so the pg17 suite runs the exact backfill;
-- idempotent.
CREATE OR REPLACE FUNCTION public.issue_4389_backfill_brand_terms()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.brand_terms_acceptances (brand_id, version, first_accepted_at)
  SELECT m.brand_id, m.mingla_tos_version_accepted, min(m.mingla_tos_accepted_at)
  FROM public.brand_team_members m
  WHERE m.accepted_at IS NOT NULL
    AND m.role IN ('brand_owner','brand_admin')
    AND m.mingla_tos_accepted_at IS NOT NULL
    AND NULLIF(btrim(COALESCE(m.mingla_tos_version_accepted, '')), '') IS NOT NULL
  GROUP BY m.brand_id, m.mingla_tos_version_accepted
  ON CONFLICT (brand_id, version) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_backfill_brand_terms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_backfill_brand_terms() TO service_role;

SELECT public.issue_4389_backfill_brand_terms();

-- ── 1. Setup facts ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4389_brand_setup_facts(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_sca public.stripe_connect_accounts%ROWTYPE;
  v_provider text;
  v_market boolean;
  v_terms boolean;
  v_details boolean := false;
  v_bank boolean := false;
  v_stripe_state text := 'none';
  v_due jsonb := '[]'::jsonb;
  v_waiting text;
  v_published boolean;
  v_complete boolean;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_market := v_brand.payout_country IS NOT NULL;
  SELECT r.provider INTO v_provider FROM public.payout_country_rail(v_brand.payout_country) r;
  v_provider := COALESCE(v_provider, v_brand.payment_provider, 'stripe');

  -- #4389 P1: terms are done for the BRAND once an owner or admin of it
  -- accepted the current version (brand_terms_acceptances, kept through any
  -- handover or removal), or while an active, accepted owner / admin holds it.
  -- A pending invite or a role below admin never counts; a new version
  -- reopens it.
  v_terms := EXISTS (
    SELECT 1 FROM public.brand_terms_acceptances a
    WHERE a.brand_id = p_brand_id AND a.version = '1.0'
  ) OR EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('brand_owner','brand_admin')
      AND m.mingla_tos_version_accepted = '1.0'
      AND m.mingla_tos_accepted_at IS NOT NULL
  );

  IF v_provider = 'paystack' THEN
    v_bank := v_brand.paystack_subaccount_code IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.brand_paystack_recipients r
      WHERE r.brand_id = p_brand_id AND r.is_active IS TRUE);
    -- #4389 P8: a hold-rail brand can take money before a bank (the hold-rail
    -- clause of pg_brand_can_collect, 20270726003645). pg_brand_can_collect is
    -- deliberately not called: it fails closed on a pending currency change,
    -- and setup must not reopen during one.
    v_details := v_bank OR (
      v_brand.payment_provider = 'paystack'
      AND v_brand.payout_hold_cutover_at IS NOT NULL);
  ELSE
    SELECT * INTO v_sca FROM public.stripe_connect_accounts
    WHERE brand_id = p_brand_id AND detached_at IS NULL;
    IF v_sca.id IS NOT NULL THEN
      v_due := CASE WHEN jsonb_typeof(v_sca.requirements->'currently_due') = 'array'
        THEN v_sca.requirements->'currently_due' ELSE '[]'::jsonb END
        || CASE WHEN jsonb_typeof(v_sca.requirements->'past_due') = 'array'
        THEN v_sca.requirements->'past_due' ELSE '[]'::jsonb END;
      -- Pending verification counts as submitted. A freshly created account
      -- whose requirements were never read (no currently_due key) is only
      -- "started".
      IF v_sca.charges_enabled IS TRUE
         OR (jsonb_typeof(v_sca.requirements->'currently_due') = 'array'
             AND jsonb_array_length(v_due) = 0) THEN
        v_details := true;
        v_stripe_state := 'submitted';
      ELSIF jsonb_typeof(v_sca.requirements->'currently_due') = 'array' THEN
        v_stripe_state := 'action_needed';
      ELSE
        v_stripe_state := 'started';
      END IF;
    END IF;
  END IF;

  SELECT l.invited_owner_email INTO v_waiting
  FROM public.partner_brand_links l
  WHERE l.brand_id = p_brand_id AND l.cancelled_at IS NULL AND l.accepted_at IS NULL
  ORDER BY l.invited_at DESC LIMIT 1;

  v_published := EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL AND e.status <> 'draft');
  v_complete := v_market AND v_terms AND v_details;

  RETURN jsonb_build_object(
    'payout_country', v_brand.payout_country,
    'currency', btrim(v_brand.default_currency),
    'provider', v_provider,
    'market', v_market,
    'terms', v_terms,
    'details', v_details,
    'bank_connected', v_bank,
    'stripe_state', v_stripe_state,
    'due', v_due,
    'waiting_for', v_waiting,
    'complete', v_complete,
    -- #4389 P8: derived, never stored: "free events only" is never reported
    -- for a brand that can take money. is_draft still reads the raw column.
    'free_only_at', CASE WHEN v_details THEN NULL ELSE v_brand.setup_free_only_at END,
    'payments_setup_started_at', v_brand.payments_setup_started_at,
    'published', v_published,
    'is_draft', NOT v_complete AND v_brand.setup_free_only_at IS NULL AND NOT v_published
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_brand_setup_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_brand_setup_facts(uuid) TO service_role;

-- ── 2. Readiness (brand_setup preview and comment only) ────────────────────
-- Copied from 20280701004389_issue_4389_brand_setup.sql (latest).
CREATE OR REPLACE FUNCTION public.brand_readiness_internal(
  p_brand_id uuid,
  p_action text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_completeness jsonb;
  v_audit jsonb := '{}'::jsonb;
  v_field jsonb;
  v_cat public.brand_readiness_catalog%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_state text;
  v_preview text;
  v_blocking text[];
  v_blocks boolean;
  v_done boolean;
  v_deferral jsonb;
  v_can_fix boolean;
  v_route text;
  v_tagline text;
  v_parts text[];
  v_can_sell boolean;
  v_can_payout boolean;
  v_pending_recon public.brand_currency_reconciliations%ROWTYPE;
  v_stripe public.stripe_connect_accounts%ROWTYPE;
  v_has_stripe boolean;
  v_has_paystack boolean;
  v_hold_rail boolean;
  v_has_recipient boolean;
  v_rail text;
  v_sell_reason text;
  v_payout_reason text;
  v_terms_accepted boolean;
  v_review_due boolean;
  v_review_deadline timestamptz;
  v_blocking_count integer := 0;
  v_wait_count integer := 0;
  v_done_count integer := 0;
  v_deferred_count integer := 0;
  -- #4389
  v_setup jsonb;
  v_extra jsonb;
BEGIN
  IF p_action IS NOT NULL AND p_action NOT IN (
    'draft_save','publish_free','publish_paid','trip_installments',
    'venue_submit','stay_publish','website_build','website_publish',
    'refund','bank_setup','brand_setup'
  ) THEN
    RAISE EXCEPTION 'invalid_readiness_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  v_completeness := public.brand_context_completeness_internal(p_brand_id);
  FOR v_field IN SELECT value FROM jsonb_array_elements(v_completeness->'fields') LOOP
    v_audit := v_audit || jsonb_build_object(v_field->>'key', v_field);
  END LOOP;

  -- Tagline uses the Home split of brands.description (first of two or more
  -- paragraphs separated by a blank line), C4.
  SELECT array_agg(btrim(part, E' \t\r\n')) INTO v_parts
  FROM regexp_split_to_table(
    btrim(COALESCE(v_brand.description,''), E' \t\r\n'), E'\n\n+'
  ) part
  WHERE btrim(part, E' \t\r\n') <> '';
  v_tagline := CASE WHEN COALESCE(array_length(v_parts,1),0) >= 2 THEN v_parts[1] END;

  -- Money facts (canonical predicates; their bodies are not changed here).
  v_can_sell := COALESCE(public.pg_brand_can_collect(p_brand_id), false);
  v_can_payout := COALESCE(public.pg_brand_can_payout(p_brand_id), false);
  SELECT * INTO v_pending_recon FROM public.brand_currency_reconciliations
  WHERE brand_id = p_brand_id AND status = 'pending'
  ORDER BY initiated_at DESC LIMIT 1;
  SELECT * INTO v_stripe FROM public.stripe_connect_accounts
  WHERE brand_id = p_brand_id AND detached_at IS NULL AND stripe_account_id IS NOT NULL
  ORDER BY updated_at DESC LIMIT 1;
  v_has_stripe := v_stripe.id IS NOT NULL;
  v_has_paystack := v_brand.paystack_subaccount_code IS NOT NULL;
  v_hold_rail := v_brand.payment_provider = 'paystack'
    AND v_brand.payout_hold_cutover_at IS NOT NULL AND NOT v_has_paystack;
  v_has_recipient := EXISTS (
    SELECT 1 FROM public.brand_paystack_recipients r
    WHERE r.brand_id = p_brand_id AND r.is_active IS TRUE
  );
  v_rail := CASE
    WHEN v_brand.payment_provider = 'paystack' AND v_has_paystack THEN 'paystack'
    WHEN v_hold_rail THEN 'paystack_hold'
    WHEN v_has_stripe THEN 'stripe'
    WHEN v_has_paystack THEN 'paystack'
    ELSE 'none'
  END;
  v_review_due := v_has_stripe AND (
    NULLIF(v_stripe.requirements->>'disabled_reason','') IS NOT NULL
    OR (jsonb_typeof(v_stripe.requirements->'currently_due') = 'array'
      AND jsonb_array_length(v_stripe.requirements->'currently_due') > 0)
  );
  v_review_deadline := CASE
    WHEN v_has_stripe AND COALESCE(v_stripe.requirements->>'current_deadline','') ~ '^[0-9]{9,11}$'
      THEN to_timestamp((v_stripe.requirements->>'current_deadline')::bigint)
  END;
  v_sell_reason := CASE
    WHEN v_can_sell THEN 'ready'
    WHEN v_pending_recon.id IS NOT NULL THEN 'currency_reconciliation_pending'
    WHEN v_rail = 'none' THEN 'no_provider'
    WHEN v_has_stripe AND NULLIF(v_stripe.requirements->>'disabled_reason','') IS NOT NULL
      THEN 'provider_disabled'
    ELSE 'kyc_incomplete'
  END;
  v_payout_reason := CASE
    WHEN v_can_payout THEN 'ready'
    WHEN v_pending_recon.id IS NOT NULL THEN 'currency_reconciliation_pending'
    WHEN v_hold_rail AND NOT v_has_recipient THEN 'hold_rail_sell_before_bank'
    WHEN v_review_due THEN 'provider_review'
    WHEN v_has_stripe AND v_stripe.payouts_enabled IS NOT TRUE THEN 'payouts_disabled'
    ELSE 'no_bank'
  END;
  v_terms_accepted := CASE WHEN p_user_id IS NULL THEN NULL ELSE EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND m.mingla_tos_version_accepted = '1.0'
      AND m.mingla_tos_accepted_at IS NOT NULL
  ) END;

  -- #4389: the brand_setup checklist reads one set of facts.
  IF p_action = 'brand_setup' THEN
    v_setup := public.issue_4389_brand_setup_facts(p_brand_id);
  END IF;

  FOR v_cat IN SELECT * FROM public.brand_readiness_catalog ORDER BY sort, key LOOP
    -- #4389: brand_setup lists exactly its own 4 items.
    IF p_action = 'brand_setup' AND NOT ('brand_setup' = ANY(v_cat.blocking_for)) THEN
      CONTINUE;
    END IF;
    -- Action-scoped items appear only for the actions they concern.
    IF v_cat.scope = 'action' AND (
      p_action IS NULL
      OR NOT (p_action = ANY(v_cat.blocking_for) OR p_action = ANY(v_cat.recommended_for))
    ) THEN
      CONTINUE;
    END IF;

    v_blocking := v_cat.blocking_for;
    v_preview := NULL;
    v_field := v_audit->v_cat.key;

    IF v_field IS NOT NULL THEN
      -- #2830 audit item: its state and evidence are the truth.
      v_state := v_field->>'state';
      IF v_field->>'requirement' = 'optional' THEN
        v_blocking := array_remove(v_blocking, 'website_build');
      END IF;
      IF v_state NOT IN ('missing') THEN
        v_preview := CASE v_cat.key
          WHEN 'social_links' THEN (
            SELECT CASE WHEN count(*) = 1 THEN '1 link' ELSE count(*)::text || ' links' END
            FROM (
              SELECT 1 FROM jsonb_each_text(
                CASE WHEN jsonb_typeof(v_brand.social_links) = 'object'
                  THEN v_brand.social_links ELSE '{}'::jsonb END) e
              WHERE NULLIF(btrim(e.value),'') IS NOT NULL
              UNION ALL
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_brand.custom_links) = 'array'
                  THEN v_brand.custom_links ELSE '[]'::jsonb END) e
              WHERE jsonb_typeof(e) = 'object' AND NULLIF(btrim(COALESCE(e->>'url','')),'') IS NOT NULL
            ) links)
          WHEN 'city_country' THEN NULLIF(concat_ws(', ',
            NULLIF(btrim(COALESCE(v_brand.city,'')),''), v_brand.country_code),'')
          WHEN 'profile_photo' THEN 'Added'
          WHEN 'cover_media' THEN 'Added'
          WHEN 'theme' THEN 'Set'
          WHEN 'approved_plan' THEN 'Approved'
          WHEN 'design_key' THEN initcap(v_field->>'value')
          WHEN 'offerings_selected' THEN CASE
            WHEN jsonb_typeof(v_field->'value') = 'array'
              THEN jsonb_array_length(v_field->'value')::text || ' chosen' END
          ELSE left(v_field->>'value', 120)
        END;
      END IF;
    ELSIF v_cat.key = 'brand.name' THEN
      -- #4389: always complete once the row exists.
      v_state := 'verified';
      v_preview := left(v_brand.name, 120);
    ELSIF v_cat.key = 'money.details_submitted' THEN
      -- #4389: Stripe: undetached account with nothing currently/past due
      -- (pending verification counts); Paystack: subaccount, recipient or the
      -- hold rail (#4389 P8).
      v_state := CASE WHEN (v_setup->>'details')::boolean THEN 'verified' ELSE 'missing' END;
      v_preview := CASE
        -- #4389 P8: a hold-rail brand with no bank reads "Ready to sell".
        WHEN (v_setup->>'details')::boolean AND v_setup->>'provider' = 'paystack'
          AND COALESCE((v_setup->>'bank_connected')::boolean, false) THEN 'Bank connected'
        WHEN (v_setup->>'details')::boolean AND v_setup->>'provider' = 'paystack' THEN 'Ready to sell'
        WHEN (v_setup->>'details')::boolean THEN 'Sent'
        WHEN v_setup->>'stripe_state' = 'action_needed' THEN 'One more thing'
        WHEN v_setup->>'stripe_state' = 'started' THEN 'Started' END;
    ELSIF v_cat.key = 'tagline' THEN
      v_state := CASE WHEN v_tagline IS NULL THEN 'missing'
        WHEN length(v_tagline) > 120 THEN 'invalid' ELSE 'verified' END;
      v_preview := left(v_tagline, 120);
    ELSIF v_cat.key = 'timezone' THEN
      v_state := CASE WHEN v_brand.default_timezone IS NULL THEN 'missing' ELSE 'verified' END;
      v_preview := v_brand.default_timezone;
    ELSIF v_cat.key = 'money.market' THEN
      IF p_action = 'brand_setup' THEN
        -- #4389: bank country set (the one truth).
        v_state := CASE WHEN v_brand.payout_country IS NULL THEN 'missing' ELSE 'verified' END;
        v_preview := CASE WHEN v_state = 'verified' THEN concat_ws(' · ',
          v_brand.payout_country, btrim(v_brand.default_currency)) END;
      ELSE
        v_state := CASE WHEN COALESCE(v_brand.payout_country, v_brand.payment_country) IS NULL
          THEN 'missing' ELSE 'verified' END;
        v_preview := CASE WHEN v_state = 'verified' THEN concat_ws(' · ',
          initcap(v_brand.payment_provider), COALESCE(v_brand.payout_country, v_brand.payment_country)) END;
      END IF;
    ELSIF v_cat.key = 'money.currency' THEN
      v_state := CASE WHEN v_brand.default_currency IS NULL THEN 'missing' ELSE 'verified' END;
      v_preview := v_brand.default_currency;
    ELSIF v_cat.key = 'money.currency_reconciliation' THEN
      v_state := CASE WHEN v_pending_recon.id IS NULL THEN 'verified' ELSE 'conflict' END;
      v_preview := CASE WHEN v_pending_recon.id IS NOT NULL THEN
        'Currency changing from ' || btrim(v_pending_recon.from_currency_code)
          || ' to ' || btrim(v_pending_recon.to_currency_code) END;
    ELSIF v_cat.key = 'money.can_sell' THEN
      v_state := CASE WHEN v_can_sell THEN 'verified' ELSE 'missing' END;
      v_preview := CASE WHEN v_can_sell THEN 'Ready' END;
    ELSIF v_cat.key = 'money.can_be_paid_out' THEN
      v_state := CASE WHEN v_can_payout THEN 'verified' ELSE 'missing' END;
      v_preview := CASE WHEN v_can_payout THEN 'Ready' END;
    ELSIF v_cat.key = 'money.provider_review' THEN
      v_state := CASE WHEN NOT v_has_stripe THEN 'not_applicable'
        WHEN v_review_due THEN 'missing' ELSE 'verified' END;
      v_preview := CASE WHEN v_review_due THEN 'Stripe needs more information'
        || COALESCE(' by ' || to_char(v_review_deadline AT TIME ZONE 'UTC', 'FMDD Mon YYYY'), '') END;
    ELSIF v_cat.key = 'money.terms_member' THEN
      IF p_action = 'brand_setup' THEN
        -- #4389 P1: the brand accepted (brand record or an active owner / admin).
        v_state := CASE WHEN (v_setup->>'terms')::boolean THEN 'verified' ELSE 'missing' END;
        v_preview := CASE WHEN v_state = 'verified' THEN 'Accepted' END;
      ELSE
        v_state := CASE WHEN v_terms_accepted IS NULL THEN 'not_applicable'
          WHEN v_terms_accepted THEN 'verified' ELSE 'missing' END;
        v_preview := CASE WHEN v_terms_accepted THEN 'Accepted' END;
      END IF;
    ELSIF v_cat.key = 'money.tax_registration' THEN
      v_state := CASE
        WHEN v_brand.default_pass_tax IS NOT TRUE THEN 'not_applicable'
        WHEN EXISTS (
          SELECT 1 FROM public.brand_tax_registration_attestations a
          WHERE a.brand_id = p_brand_id AND a.has_active_registration IS TRUE
        ) THEN 'verified'
        ELSE 'missing' END;
    ELSIF v_cat.key = 'team.role' THEN
      v_state := CASE WHEN public.brand_readiness_action_allowed(p_brand_id, p_user_id, p_action)
        THEN 'verified' ELSE 'missing' END;
      v_preview := (
        SELECT initcap(replace(m.role,'_',' ')) FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
          AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL
        ORDER BY public.biz_role_rank(m.role) DESC LIMIT 1);
    ELSIF v_cat.key = 'venue.approved_exists' THEN
      v_state := CASE WHEN EXISTS (
        SELECT 1 FROM public.venue_listings v
        WHERE v.brand_id = p_brand_id AND v.claim_status = 'verified'
      ) THEN 'verified' ELSE 'missing' END;
    ELSIF v_cat.key = 'stay.settings_complete' THEN
      v_state := CASE WHEN EXISTS (
        SELECT 1 FROM public.stay_settings s
        JOIN public.venue_listings v ON v.id = s.venue_id
        WHERE v.brand_id = p_brand_id AND v.claim_status = 'verified'
          AND length(btrim(COALESCE(s.summary,''))) >= 20
          AND length(btrim(COALESCE(s.timezone,''))) > 0
          AND s.check_in_time IS NOT NULL AND s.check_out_time IS NOT NULL
      ) THEN 'verified' ELSE 'missing' END;
    ELSE
      v_state := 'missing';
    END IF;

    v_done := v_state IN ('verified','not_applicable');
    -- I-READINESS-DEFERRAL-NEVER-UNBLOCKS: deferral plays no part here.
    v_blocks := p_action IS NOT NULL AND p_action = ANY(v_blocking) AND NOT v_done;

    v_deferral := NULL;
    IF NOT v_done THEN
      SELECT jsonb_build_object(
        'by_user_id', d.deferred_by,
        'by_display_name', COALESCE(
          NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'full_name','')),''),
          NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'name','')),''),
          'A teammate'),
        'at', d.deferred_at,
        'until', NULL,
        'reason', d.reason)
      INTO v_deferral
      FROM public.brand_readiness_deferrals d
      LEFT JOIN auth.users u ON u.id = d.deferred_by
      WHERE d.brand_id = p_brand_id AND d.item_key = v_cat.key AND d.cleared_at IS NULL;
    END IF;

    v_can_fix := public.brand_readiness_can_fix(
      p_brand_id, p_user_id, v_cat.min_role, v_cat.server_predicate);
    v_route := replace(v_cat.route_template, '{brand_id}', p_brand_id::text);
    v_extra := '{}'::jsonb;
    IF p_action = 'brand_setup' THEN
      -- #4389: every checklist row opens the full-screen setup route.
      v_route := '/brand/' || p_brand_id::text || '/setup?step=' || CASE v_cat.key
        WHEN 'brand.name' THEN 'name'
        WHEN 'money.market' THEN 'country'
        ELSE 'pay' END;
      v_extra := jsonb_build_object('waiting_for', CASE
        WHEN v_cat.key IN ('money.terms_member','money.details_submitted') AND NOT v_done
          THEN v_setup->'waiting_for' END);
    END IF;

    IF v_blocks THEN v_blocking_count := v_blocking_count + 1;
    ELSIF v_done THEN v_done_count := v_done_count + 1;
    ELSE v_wait_count := v_wait_count + 1;
    END IF;
    IF v_deferral IS NOT NULL THEN v_deferred_count := v_deferred_count + 1; END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', v_cat.key,
      'group', v_cat.item_group,
      'label', v_cat.label,
      'state', v_state,
      'value_preview', v_preview,
      'blocks_action', v_blocks,
      'severity', CASE WHEN v_blocks THEN 'blocking'
        WHEN v_done THEN 'done' ELSE 'skippable' END,
      'blocking_for', to_jsonb(v_blocking),
      'recommended_for', to_jsonb(v_cat.recommended_for),
      'deferrable', v_cat.is_deferrable,
      'deferral', v_deferral,
      'skip_in_ari', v_deferral IS NOT NULL AND NOT v_blocks,
      'owner_action', v_cat.owner_action,
      'fix', jsonb_build_object(
        'route', v_route,
        'route_label', v_cat.route_label,
        'min_role', v_cat.min_role,
        'server_predicate', v_cat.server_predicate,
        'can_caller_fix', v_can_fix,
        'who_can_fix', public.brand_readiness_who_can_fix(v_cat.min_role, v_cat.server_predicate)),
      'ask', v_cat.ask,
      'verify', jsonb_build_object('probe','brand_readiness','item_key',v_cat.key)
    ) || v_extra);
  END LOOP;

  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'context_revision', v_completeness->>'context_revision',
    'evaluated_at', now(),
    'action', p_action,
    'can_proceed', v_blocking_count = 0,
    'items', v_items,
    'money', jsonb_build_object(
      'can_sell', v_can_sell,
      'can_be_paid_out', v_can_payout,
      'sell_reason', v_sell_reason,
      'payout_reason', v_payout_reason,
      'rail', v_rail,
      'currency', v_brand.default_currency,
      'terms_accepted_by_caller', v_terms_accepted),
    'counts', jsonb_build_object(
      'blocking', v_blocking_count,
      'can_wait', v_wait_count,
      'done', v_done_count,
      'deferred', v_deferred_count)
  ) || CASE WHEN p_action = 'brand_setup'
    THEN jsonb_build_object('setup', v_setup) ELSE '{}'::jsonb END;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_internal(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_internal(uuid,text,uuid)
  TO service_role;

-- ── 3. Self-assert ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.issue_4389_brand_setup_facts(uuid)'::regprocedure);
  IF position('m.user_id = v_brand.account_id' in v_def) > 0 THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: terms still owner-only';
  END IF;
  IF position('brand_terms_acceptances' in v_def) = 0 THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: facts do not read the brand terms record';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issue_4389_record_brand_terms'
      AND tgrelid = 'public.brand_team_members'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: brand terms trigger missing';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'public.brand_terms_acceptances'::regclass) THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: brand_terms_acceptances must force RLS';
  END IF;
  IF has_table_privilege('authenticated', 'public.brand_terms_acceptances', 'SELECT')
     OR has_table_privilege('anon', 'public.brand_terms_acceptances', 'SELECT') THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: brand_terms_acceptances must be service_role only';
  END IF;
  IF position('bank_connected' in v_def) = 0
     OR position('payout_hold_cutover_at' in v_def) = 0 THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: facts missing hold rail / bank_connected';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4389_brand_setup_facts(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4389_brand_setup_facts(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.brand_readiness_internal(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: internal functions must be service_role only';
  END IF;
  IF position('Ready to sell' in pg_get_functiondef(
       'public.brand_readiness_internal(uuid,text,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_4389_setup_polish_verify: readiness preview not updated';
  END IF;
END;
$$;

COMMIT;
