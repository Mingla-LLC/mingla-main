-- Issue #3355 P2 — one canonical brand readiness read for Ari and Home.
--
-- brand_readiness(brand, action) answers "what is this brand missing, and
-- does it block what I am trying to do right now?" from one server-side
-- catalogue. Brand profile and Website items come from the #2830 completeness
-- audit (so the Website audit and this read cannot disagree); money items come
-- from the canonical money predicates (pg_brand_can_collect /
-- pg_brand_can_payout, currency reconciliations, the caller's own Organiser
-- Terms); action-scoped items (role, approved venue, Stay settings) appear
-- only for the actions they gate.
--
-- Seth's decisions (2026-11-01) applied here:
--   * contact email never blocks publishing (it still blocks a Website build,
--     unchanged #2830 behaviour);
--   * "Not now" is a brand-wide remembered Ari skip (who / when / why) with no
--     expiry. It never hides an item from Home and never unblocks a blocking
--     item; the item keeps its true state and carries the deferral beside it;
--   * paid tickets in drafts are allowed: nothing money-related blocks
--     draft_save.
--
-- I-BRAND-READINESS-SINGLE-SOURCE | brand_readiness is the only server
-- definition of brand missing-items; Ari's snapshot and launch plan read it.
-- I-BRAND-EVIDENCE-CLEARS-ON-WRITE | any member write that changes a brand
-- field closes that field's stale/conflict findings (Brand Edit included).
-- I-READINESS-DEFERRAL-NEVER-UNBLOCKS | blocks_action ignores deferrals.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── Brand default time zone ────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS default_timezone text
    CHECK (
      default_timezone IS NULL OR (
        length(default_timezone) BETWEEN 1 AND 64
        AND default_timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
      )
    );
COMMENT ON COLUMN public.brands.default_timezone IS
  '#3355 P2: the brand''s default IANA time zone, used by Ari flows instead of the device or UTC.';

CREATE OR REPLACE FUNCTION public.brands_default_timezone_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.default_timezone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.default_timezone
  ) THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.brands_default_timezone_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brands_default_timezone_guard ON public.brands;
CREATE TRIGGER brands_default_timezone_guard
  BEFORE INSERT OR UPDATE OF default_timezone ON public.brands
  FOR EACH ROW
  WHEN (NEW.default_timezone IS NOT NULL)
  EXECUTE FUNCTION public.brands_default_timezone_guard();

-- ── Evidence resolution marker (C5) ────────────────────────────────────────
ALTER TABLE public.brand_context_field_evidence
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolved_reason text
    CHECK (resolved_reason IS NULL OR resolved_reason IN ('value_changed'));

-- ── Catalogue (one home) ───────────────────────────────────────────────────
CREATE TABLE public.brand_readiness_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z_]*(\.[a-z_]+)?$'),
  item_group text NOT NULL CHECK (item_group IN (
    'identity','contact','location','media','website','money','team','venue'
  )),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  sort integer NOT NULL,
  scope text NOT NULL CHECK (scope IN ('brand','action')),
  owner_action text NOT NULL CHECK (owner_action IN (
    'none','answer','upload','external','approval'
  )),
  ask jsonb NOT NULL CHECK (jsonb_typeof(ask) = 'object' AND ask ? 'control'),
  route_template text CHECK (route_template IS NULL OR route_template ~ '^/'),
  route_label text NOT NULL CHECK (length(route_label) BETWEEN 1 AND 80),
  min_role text NOT NULL CHECK (min_role IN (
    'self','scanner','marketing_manager','finance_manager','event_manager',
    'brand_admin','brand_owner'
  )),
  server_predicate text CHECK (server_predicate IS NULL OR server_predicate IN (
    'biz_can_manage_payments_for_brand','biz_can_mutate_payouts_for_brand'
  )),
  is_deferrable boolean NOT NULL,
  blocking_for text[] NOT NULL DEFAULT ARRAY[]::text[],
  recommended_for text[] NOT NULL DEFAULT ARRAY[]::text[],
  catalog_version integer NOT NULL DEFAULT 1,
  CONSTRAINT brand_readiness_catalog_actions_ck CHECK (
    blocking_for <@ ARRAY[
      'draft_save','publish_free','publish_paid','trip_installments',
      'venue_submit','stay_publish','website_build','website_publish',
      'refund','bank_setup'
    ]::text[]
    AND recommended_for <@ ARRAY[
      'draft_save','publish_free','publish_paid','trip_installments',
      'venue_submit','stay_publish','website_build','website_publish',
      'refund','bank_setup'
    ]::text[]
  )
);
ALTER TABLE public.brand_readiness_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_readiness_catalog FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_readiness_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.brand_readiness_catalog TO service_role;

INSERT INTO public.brand_readiness_catalog(
  key,item_group,label,sort,scope,owner_action,ask,route_template,route_label,
  min_role,server_predicate,is_deferrable,blocking_for,recommended_for
) VALUES
  -- Identity
  ('name','identity','Brand name',10,'brand','answer',
    '{"control":"text","constraints":{"min":1,"max":80},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('description','identity','Brand description',20,'brand','answer',
    '{"control":"long_text","constraints":{"min":1,"max":500},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('tagline','identity','Tagline',30,'brand','answer',
    '{"control":"text","constraints":{"min":1,"max":120},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY[]::text[],ARRAY['publish_free','publish_paid','trip_installments','stay_publish']),
  -- Media
  ('profile_photo','media','Brand logo',40,'brand','upload',
    '{"control":"upload","audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  ('cover_media','media','Cover photo or video',50,'brand','upload',
    '{"control":"cover","audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  -- Contact
  ('contact_email','contact','Contact email',60,'brand','answer',
    '{"control":"email","audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  ('contact_phone','contact','Contact phone',70,'brand','answer',
    '{"control":"phone_e164","constraints":{"default_country":"brand_country"},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  ('social_links','contact','Website or social link',80,'brand','answer',
    '{"control":"link_list","constraints":{"networks":["website","instagram","tiktok","x","facebook","youtube","linkedin","threads"],"custom":true},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  -- Location
  ('address','location','Address',90,'brand','answer',
    '{"control":"address_place","constraints":{"writes":["address","city","country_code","lat","lng","place_id"]},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  ('city_country','location','City and country',100,'brand','answer',
    '{"control":"address_place","constraints":{"fallback":"city_country"},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  ('timezone','location','Time zone',110,'brand','answer',
    '{"control":"timezone","constraints":{"default":"derived_from_country"},"audience":"private"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY[]::text[],ARRAY['publish_free','publish_paid','trip_installments','stay_publish']),
  ('theme','media','Page colours and font',120,'brand','answer',
    '{"control":"single_choice","constraints":{"source":"theme_presets"},"audience":"public"}',
    '/brand/{brand_id}/edit','Brand profile','brand_admin',NULL,true,
    ARRAY['website_build'],
    ARRAY['publish_free','publish_paid','trip_installments','venue_submit','stay_publish']),
  -- Website setup (#2830 required/recommended; "Needed for your Website", C7)
  ('offerings_selected','website','What you offer',200,'brand','answer',
    '{"control":"multi_choice","constraints":{"source":"site_plan_offerings"},"audience":"public"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('design_key','website','Website design',210,'brand','answer',
    '{"control":"single_choice","constraints":{"options":["atelier","voyage"]},"audience":"public"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('story.who','website','Who comes with you',220,'brand','answer',
    '{"control":"long_text","constraints":{"min":1,"max":300},"audience":"public"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('story.why','website','Why they choose you',230,'brand','answer',
    '{"control":"long_text","constraints":{"min":1,"max":300},"audience":"public"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('story.main_action','website','Main visitor action',240,'brand','answer',
    '{"control":"long_text","constraints":{"min":1,"max":300},"audience":"public"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('venue_descriptor','website','Venue description',250,'brand','answer',
    '{"control":"text","constraints":{"min":1,"max":60},"audience":"public"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,true,
    ARRAY['website_build'],ARRAY[]::text[]),
  ('approved_plan','website','Approved Website plan',260,'brand','approval',
    '{"control":"handoff","constraints":{"handoff":"website"},"audience":"private"}',
    '/brand/{brand_id}/website','Website setup','brand_admin',NULL,false,
    ARRAY['website_build'],ARRAY[]::text[]),
  -- Money (one model, 3(a).7)
  ('money.market','money','Payout country and provider',300,'brand','external',
    '{"control":"handoff","constraints":{"handoff":"payment_onboarding"},"audience":"private"}',
    '/brand/{brand_id}/payments/onboard','Payments setup','brand_owner',
    'biz_can_mutate_payouts_for_brand',true,
    ARRAY[]::text[],ARRAY['publish_paid','trip_installments','stay_publish','bank_setup']),
  ('money.currency','money','Payout currency',310,'brand','external',
    '{"control":"handoff","constraints":{"handoff":"payment_onboarding"},"audience":"private"}',
    '/brand/{brand_id}/payments/onboard','Payments setup','brand_owner',
    'biz_can_mutate_payouts_for_brand',false,
    ARRAY['publish_paid','trip_installments','stay_publish'],ARRAY[]::text[]),
  ('money.currency_reconciliation','money','Currency change review',320,'brand','answer',
    '{"control":"single_choice","constraints":{"source":"currency_reconciliation_options"},"audience":"private"}',
    '/brand/{brand_id}/payments','Payments','finance_manager',
    'biz_can_manage_payments_for_brand',false,
    ARRAY['publish_paid','trip_installments','stay_publish'],ARRAY[]::text[]),
  ('money.can_sell','money','Ready to sell paid tickets',330,'brand','external',
    '{"control":"handoff","constraints":{"handoff":"payment_onboarding"},"audience":"private"}',
    '/brand/{brand_id}/payments/onboard','Payments setup','brand_owner',
    'biz_can_mutate_payouts_for_brand',false,
    ARRAY['publish_paid','trip_installments','stay_publish'],ARRAY[]::text[]),
  ('money.can_be_paid_out','money','Payouts to your bank',340,'brand','external',
    '{"control":"handoff","constraints":{"handoff":"payment_onboarding"},"audience":"private"}',
    '/brand/{brand_id}/payments/onboard','Payments setup','brand_owner',
    'biz_can_mutate_payouts_for_brand',true,
    ARRAY['trip_installments'],ARRAY['publish_paid','stay_publish']),
  ('money.provider_review','money','Payment provider review',350,'brand','external',
    '{"control":"handoff","constraints":{"handoff":"payment_onboarding"},"audience":"private"}',
    '/brand/{brand_id}/payments/onboard','Payments setup','brand_owner',
    'biz_can_mutate_payouts_for_brand',true,
    ARRAY[]::text[],ARRAY['publish_paid','trip_installments','stay_publish']),
  ('money.terms_member','money','Your Organiser Terms',360,'brand','approval',
    '{"control":"handoff","constraints":{"handoff":"organiser_terms"},"audience":"private"}',
    NULL,'Accept the Organiser Terms when you publish something paid','self',NULL,false,
    ARRAY['publish_paid','trip_installments','stay_publish','bank_setup'],ARRAY[]::text[]),
  ('money.tax_registration','money','Tax registration',370,'brand','external',
    '{"control":"handoff","constraints":{"handoff":"payments"},"audience":"private"}',
    '/brand/{brand_id}/payments','Payments','finance_manager',
    'biz_can_manage_payments_for_brand',true,
    ARRAY[]::text[],ARRAY['publish_paid']),
  -- Action-scoped
  ('team.role','team','Your role on this brand',400,'action','none',
    '{"control":"handoff","constraints":{"handoff":"team"},"audience":"private"}',
    '/brand/{brand_id}/team','Team','brand_owner',NULL,false,
    ARRAY['draft_save','publish_free','publish_paid','trip_installments',
      'venue_submit','stay_publish','website_build','website_publish',
      'refund','bank_setup'],ARRAY[]::text[]),
  ('venue.approved_exists','venue','An approved venue',410,'action','external',
    '{"control":"handoff","constraints":{"handoff":"venue_create"},"audience":"private"}',
    '/venue/create','Add a venue','event_manager',NULL,false,
    ARRAY['stay_publish'],ARRAY[]::text[]),
  ('stay.settings_complete','venue','Stay settings',420,'action','answer',
    '{"control":"handoff","constraints":{"handoff":"brand"},"audience":"private"}',
    '/brand/{brand_id}','Your venue''s Stay settings','event_manager',NULL,false,
    ARRAY['stay_publish'],ARRAY[]::text[]);

-- ── Brand-wide "not now" (no expiry; never hides; never unblocks) ──────────
CREATE TABLE public.brand_readiness_deferrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  item_key text NOT NULL REFERENCES public.brand_readiness_catalog(key),
  deferred_by uuid NOT NULL REFERENCES auth.users(id),
  deferred_at timestamptz NOT NULL DEFAULT now(),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 280),
  cleared_at timestamptz,
  cleared_by uuid REFERENCES auth.users(id),
  cleared_reason text CHECK (cleared_reason IS NULL OR cleared_reason IN (
    'owner_undo','item_resolved','catalog_changed'
  )),
  CONSTRAINT brand_readiness_deferrals_cleared_ck CHECK (
    (cleared_at IS NULL) = (cleared_reason IS NULL)
  )
);
CREATE UNIQUE INDEX brand_readiness_deferrals_active_uq
  ON public.brand_readiness_deferrals(brand_id, item_key)
  WHERE cleared_at IS NULL;
ALTER TABLE public.brand_readiness_deferrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_readiness_deferrals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_readiness_deferrals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.brand_readiness_deferrals TO service_role;

-- ── Role helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_readiness_can_fix(
  p_brand_id uuid,
  p_user_id uuid,
  p_min_role text,
  p_predicate text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF public.biz_brand_effective_rank(p_brand_id, p_user_id) < 10 THEN
    RETURN false;
  END IF;
  IF p_predicate = 'biz_can_manage_payments_for_brand' THEN
    RETURN COALESCE(public.biz_can_manage_payments_for_brand(p_brand_id, p_user_id), false);
  ELSIF p_predicate = 'biz_can_mutate_payouts_for_brand' THEN
    RETURN COALESCE(public.biz_can_mutate_payouts_for_brand(p_brand_id, p_user_id), false);
  ELSIF p_min_role = 'self' THEN
    RETURN true;
  END IF;
  RETURN public.biz_brand_effective_rank(p_brand_id, p_user_id)
    >= public.biz_role_rank(p_min_role);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_can_fix(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_can_fix(uuid,uuid,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_readiness_who_can_fix(
  p_min_role text,
  p_predicate text
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_predicate = 'biz_can_mutate_payouts_for_brand' THEN 'the brand owner'
    WHEN p_predicate = 'biz_can_manage_payments_for_brand'
      THEN 'a finance manager, a brand admin or the owner'
    WHEN p_min_role = 'self' THEN 'you'
    WHEN p_min_role = 'brand_owner' THEN 'the brand owner'
    WHEN p_min_role = 'brand_admin' THEN 'a brand admin or the owner'
    WHEN p_min_role = 'event_manager' THEN 'an event manager, a brand admin or the owner'
    WHEN p_min_role = 'finance_manager' THEN 'a finance manager or higher'
    WHEN p_min_role = 'marketing_manager' THEN 'a marketing manager or higher'
    ELSE 'any team member'
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_who_can_fix(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_who_can_fix(text,text)
  TO service_role;

-- Whether p_user_id may perform p_action at all (the team.role item).
CREATE OR REPLACE FUNCTION public.brand_readiness_action_allowed(
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rank integer;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, p_user_id);
  RETURN CASE p_action
    WHEN 'refund' THEN COALESCE(public.biz_can_manage_payments_for_brand(p_brand_id, p_user_id), false)
    WHEN 'bank_setup' THEN COALESCE(public.biz_can_mutate_payouts_for_brand(p_brand_id, p_user_id), false)
    WHEN 'website_build' THEN v_rank >= public.biz_role_rank('brand_admin')
    WHEN 'website_publish' THEN v_rank >= public.biz_role_rank('brand_admin')
    ELSE v_rank >= public.biz_role_rank('event_manager')
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_action_allowed(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_action_allowed(uuid,uuid,text)
  TO service_role;

-- ── The canonical read (internal) ──────────────────────────────────────────
-- p_user_id is the member the answer is for (Organiser Terms, can_caller_fix,
-- role). NULL is the system view used by the evidence trigger.
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
BEGIN
  IF p_action IS NOT NULL AND p_action NOT IN (
    'draft_save','publish_free','publish_paid','trip_installments',
    'venue_submit','stay_publish','website_build','website_publish',
    'refund','bank_setup'
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

  FOR v_cat IN SELECT * FROM public.brand_readiness_catalog ORDER BY sort, key LOOP
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
    ELSIF v_cat.key = 'tagline' THEN
      v_state := CASE WHEN v_tagline IS NULL THEN 'missing'
        WHEN length(v_tagline) > 120 THEN 'invalid' ELSE 'verified' END;
      v_preview := left(v_tagline, 120);
    ELSIF v_cat.key = 'timezone' THEN
      v_state := CASE WHEN v_brand.default_timezone IS NULL THEN 'missing' ELSE 'verified' END;
      v_preview := v_brand.default_timezone;
    ELSIF v_cat.key = 'money.market' THEN
      v_state := CASE WHEN COALESCE(v_brand.payout_country, v_brand.payment_country) IS NULL
        THEN 'missing' ELSE 'verified' END;
      v_preview := CASE WHEN v_state = 'verified' THEN concat_ws(' · ',
        initcap(v_brand.payment_provider), COALESCE(v_brand.payout_country, v_brand.payment_country)) END;
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
      v_state := CASE WHEN v_terms_accepted IS NULL THEN 'not_applicable'
        WHEN v_terms_accepted THEN 'verified' ELSE 'missing' END;
      v_preview := CASE WHEN v_terms_accepted THEN 'Accepted' END;
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
    ));
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
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_internal(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_internal(uuid,text,uuid)
  TO service_role;

-- ── Public read: any active member (rank >= scanner), answered for auth.uid()
CREATE OR REPLACE FUNCTION public.brand_readiness(
  p_brand_id uuid,
  p_action text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL
    OR public.biz_brand_effective_rank(p_brand_id, auth.uid()) < 10 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.brand_readiness_internal(p_brand_id, p_action, auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_readiness(uuid,text)
  TO authenticated, service_role;

-- ── "Not now" writes ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_readiness_item_json(
  p_brand_id uuid,
  p_item_key text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT item
  FROM jsonb_array_elements(
    public.brand_readiness_internal(p_brand_id, NULL, p_user_id)->'items'
  ) item
  WHERE item->>'key' = p_item_key;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_item_json(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_item_json(uuid,text,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_readiness_defer(
  p_brand_id uuid,
  p_item_key text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cat public.brand_readiness_catalog%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason,'')),'');
  v_item jsonb;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 10 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  SELECT * INTO v_cat FROM public.brand_readiness_catalog WHERE key = p_item_key;
  IF NOT FOUND OR v_cat.scope <> 'brand' THEN
    RAISE EXCEPTION 'readiness_item_unknown' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 280 THEN
    RAISE EXCEPTION 'readiness_reason_too_long' USING ERRCODE = '22023';
  END IF;
  IF NOT v_cat.is_deferrable THEN
    RAISE EXCEPTION 'readiness_item_not_deferrable' USING ERRCODE = '22023';
  END IF;
  -- Only someone who could fix the item may set it aside for the whole brand.
  -- Lower roles get a session-only skip inside the Ari flow instead.
  IF NOT public.brand_readiness_can_fix(p_brand_id, v_actor, v_cat.min_role, v_cat.server_predicate) THEN
    RAISE EXCEPTION 'readiness_defer_forbidden' USING ERRCODE = '42501';
  END IF;
  v_item := public.brand_readiness_item_json(p_brand_id, p_item_key, v_actor);
  IF v_item->>'state' IN ('verified','not_applicable') THEN
    RAISE EXCEPTION 'readiness_item_already_done' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.brand_readiness_deferrals(brand_id,item_key,deferred_by,reason)
  VALUES (p_brand_id, p_item_key, v_actor, v_reason)
  ON CONFLICT (brand_id, item_key) WHERE cleared_at IS NULL DO NOTHING;
  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'item_key', p_item_key,
    'item', public.brand_readiness_item_json(p_brand_id, p_item_key, v_actor));
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_defer(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_readiness_defer(uuid,text,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_readiness_undefer(
  p_brand_id uuid,
  p_item_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cat public.brand_readiness_catalog%ROWTYPE;
  v_cleared integer;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 10 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cat FROM public.brand_readiness_catalog WHERE key = p_item_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'readiness_item_unknown' USING ERRCODE = '22023';
  END IF;
  IF NOT public.brand_readiness_can_fix(p_brand_id, v_actor, v_cat.min_role, v_cat.server_predicate) THEN
    RAISE EXCEPTION 'readiness_defer_forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.brand_readiness_deferrals
  SET cleared_at = now(), cleared_by = v_actor, cleared_reason = 'owner_undo'
  WHERE brand_id = p_brand_id AND item_key = p_item_key AND cleared_at IS NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'item_key', p_item_key,
    'cleared', v_cleared > 0,
    'item', public.brand_readiness_item_json(p_brand_id, p_item_key, v_actor));
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_undefer(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_readiness_undefer(uuid,text)
  TO authenticated, service_role;

-- ── Evidence clearing on every brand write path (C5) ───────────────────────
-- Fires for Brand Edit's direct brands update, creation, Ari, admin and any
-- future path. Total: no statement here raises for a live brand row.
CREATE OR REPLACE FUNCTION public.brands_readiness_evidence_on_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_keys text[] := ARRAY[]::text[];
  v_member boolean;
  v_item jsonb;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN v_keys := v_keys || ARRAY['name']; END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    v_keys := v_keys || ARRAY['description','tagline'];
  END IF;
  IF NEW.contact_email IS DISTINCT FROM OLD.contact_email THEN v_keys := v_keys || ARRAY['contact_email']; END IF;
  IF NEW.contact_phone IS DISTINCT FROM OLD.contact_phone THEN v_keys := v_keys || ARRAY['contact_phone']; END IF;
  IF NEW.address IS DISTINCT FROM OLD.address THEN v_keys := v_keys || ARRAY['address']; END IF;
  IF NEW.city IS DISTINCT FROM OLD.city OR NEW.country_code IS DISTINCT FROM OLD.country_code THEN
    v_keys := v_keys || ARRAY['city_country'];
  END IF;
  IF NEW.social_links IS DISTINCT FROM OLD.social_links
    OR NEW.custom_links IS DISTINCT FROM OLD.custom_links THEN
    v_keys := v_keys || ARRAY['social_links'];
  END IF;
  IF NEW.profile_photo_url IS DISTINCT FROM OLD.profile_photo_url THEN v_keys := v_keys || ARRAY['profile_photo']; END IF;
  IF NEW.cover_media_url IS DISTINCT FROM OLD.cover_media_url
    OR NEW.cover_media_type IS DISTINCT FROM OLD.cover_media_type THEN
    v_keys := v_keys || ARRAY['cover_media'];
  END IF;
  IF NEW.theme_color IS DISTINCT FROM OLD.theme_color
    OR NEW.theme_font IS DISTINCT FROM OLD.theme_font
    OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation THEN
    v_keys := v_keys || ARRAY['theme'];
  END IF;
  IF NEW.default_timezone IS DISTINCT FROM OLD.default_timezone THEN v_keys := v_keys || ARRAY['timezone']; END IF;
  IF NEW.default_currency IS DISTINCT FROM OLD.default_currency THEN v_keys := v_keys || ARRAY['money.currency']; END IF;
  IF NEW.payout_country IS DISTINCT FROM OLD.payout_country
    OR NEW.payment_country IS DISTINCT FROM OLD.payment_country THEN
    v_keys := v_keys || ARRAY['money.market'];
  END IF;
  IF cardinality(v_keys) = 0 THEN RETURN NULL; END IF;

  -- A member's own edit is the latest owner truth: close open stale/conflict
  -- findings (and aged research) for exactly the fields that changed. Writes
  -- with no member behind them (service role, platform admin) keep today's
  -- behaviour and never award a tick.
  v_member := v_actor IS NOT NULL
    AND public.biz_brand_effective_rank(NEW.id, v_actor) >= 10;
  IF v_member THEN
    UPDATE public.brand_context_field_evidence e SET
      disposition = 'verified',
      source_type = 'owner',
      source_ref = 'mingla:brand:' || NEW.id::text || ':' || e.field_key,
      source_url = NULL,
      observed_at = now(),
      owner_confirmed_at = now(),
      evidence_candidates = '[]'::jsonb,
      recheck_fingerprint = NULL,
      resolved_at = now(),
      resolved_by = v_actor,
      resolved_reason = 'value_changed',
      updated_at = now(),
      updated_by = v_actor
    WHERE e.brand_id = NEW.id
      AND e.field_key = ANY(v_keys)
      AND (e.disposition IN ('stale','conflict')
        OR (e.disposition = 'verified' AND e.source_type IN ('public_research','imported')));
  END IF;

  -- Deferrals for items the write just resolved are cleared (item_resolved).
  IF EXISTS (
    SELECT 1 FROM public.brand_readiness_deferrals d
    WHERE d.brand_id = NEW.id AND d.cleared_at IS NULL AND d.item_key = ANY(v_keys)
  ) THEN
    FOR v_item IN
      SELECT item FROM jsonb_array_elements(
        public.brand_readiness_internal(NEW.id, NULL, v_actor)->'items') item
      WHERE item->>'key' = ANY(v_keys)
        AND item->>'state' IN ('verified','not_applicable')
    LOOP
      UPDATE public.brand_readiness_deferrals SET
        cleared_at = now(), cleared_by = v_actor, cleared_reason = 'item_resolved'
      WHERE brand_id = NEW.id AND item_key = v_item->>'key' AND cleared_at IS NULL;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.brands_readiness_evidence_on_write()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brands_readiness_evidence_on_write ON public.brands;
CREATE TRIGGER brands_readiness_evidence_on_write
  AFTER UPDATE OF name, description, contact_email, contact_phone, address,
    city, country_code, social_links, custom_links, profile_photo_url,
    cover_media_url, cover_media_type, theme_color, theme_font, theme_animation,
    default_timezone, default_currency, payout_country, payment_country
  ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.brands_readiness_evidence_on_write();

COMMENT ON FUNCTION public.brand_readiness(uuid,text) IS
  '#3355 P2: canonical brand readiness for Ari and Home. Per item: state, whether it blocks p_action, who can fix it and where, how Ari asks, and any brand-wide "not now". Deferrals never unblock.';

COMMIT;
