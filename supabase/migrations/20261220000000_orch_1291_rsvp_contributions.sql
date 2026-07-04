-- ===========================================================================
-- ORCH-1291 [rsvp-chip-in] — voluntary RSVP contributions (v1 of META-ORCH-1290).
--
-- Lets a guest who RSVPs FREE to an RSVP event OPTIONALLY "chip in" a voluntary
-- gift, on BOTH rails (Stripe Connect direct-charge + Paystack NGN). The
-- contribution is a GIFT: ZERO transaction tax (tax_basis='voluntary_contribution',
-- tax_cents=0), while Mingla still takes its normal application_fee cut. Money
-- math reuses the single all-in engine (Constitution #2) — no divergent path.
--
-- Preserves the RSVP payment-free WALL (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS):
-- event_rsvps gains NO payment column. Contributions live ONLY in the NEW child
-- table public.event_rsvp_contributions.
--
-- Enabling chip-in flips the RSVP into a money-collector → publish MUST be
-- bank-gated by a PROVIDER-AWARE predicate (investigation F-4/D-1): the existing
-- pg_brand_can_charge is Stripe-BLIND and would wrongly block every NGN brand.
-- The new sibling pg_brand_can_collect = (Stripe charges_enabled) OR (Paystack
-- subaccount present). The gate is CONDITIONAL — a FREE RSVP still publishes with
-- no bank requirement (do NOT gate free RSVPs).
--
-- Safe-migration protocol:
--   • $function$ dollar-tag on function bodies so trailing GRANT/COMMENT parse.
--   • business_publish_rsvp_draft: CREATE OR REPLACE (signature unchanged → NO
--     DROP); full body reproduced verbatim from 20261004000000_orch_1150 with
--     ONLY the additive contribution reads + conditional gate + 3 column writes.
--   • finalize_rsvp_contribution / pg_brand_can_collect: net-new.
--   • Monotonic prefix 20261220000000 (frontier = 20261210000000_orch_1278).
--
-- Contract: Mingla_Artifacts/specs/SPEC_ORCH-1291_RSVP_CHIP_IN.md §4.1, §8.
-- Evidence: Mingla_Artifacts/reports/INVESTIGATION_ORCH-1291_RSVP_CHIP_IN.md.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) event_rsvp_contributions — the child table (preserves the wall).
--     One row per contribution attempt. Persisted 'pending' BEFORE the provider
--     charge, flipped 'paid' by the verified webhook (finalize_rsvp_contribution).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_rsvp_contributions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- link to the guest's RSVP row (nullable: an anon buyer may pay before the
  -- link is resolved; ON DELETE SET NULL so removing an RSVP never drops the
  -- money record).
  rsvp_id                       uuid NULL REFERENCES public.event_rsvps(id) ON DELETE SET NULL,
  brand_id                      uuid NOT NULL REFERENCES public.brands(id),
  user_id                       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_name                    text NULL,
  guest_email                   text NULL,
  provider                      text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  currency                      text NOT NULL,
  -- the buyer-named gift (settlement minor unit — cents/kobo).
  amount_cents                  integer NOT NULL CHECK (amount_cents > 0),
  -- what the buyer is actually charged (= amount + passed fees; tax always 0).
  -- For v1 the organiser absorbs (WYSIWYG) so buyer_total_cents == amount_cents.
  buyer_total_cents             integer NOT NULL CHECK (buyer_total_cents > 0),
  -- Mingla's cut (miglaFee) — collected via application_fee / transaction_charge.
  application_fee_amount_cents  integer NOT NULL DEFAULT 0
                                  CHECK (application_fee_amount_cents >= 0),
  -- the engine's PricingBreakdown (tax_basis='voluntary_contribution', tax_cents=0).
  pricing_breakdown             jsonb NOT NULL,
  status                        text NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'paid', 'failed',
                                                    'refunded', 'partially_refunded',
                                                    'cancelled')),
  -- Stripe PaymentIntent id OR Paystack reference (UNIQUE → free idempotency,
  -- mirrors ticket_checkout_sessions.stripe_payment_intent_id on both rails).
  stripe_payment_intent_id      text NULL,
  -- Stripe charge id OR Paystack transaction id (set at finalize).
  stripe_charge_id              text NULL,
  refunded_amount_cents         integer NOT NULL DEFAULT 0
                                  CHECK (refunded_amount_cents >= 0),
  refund_reason                 text NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  paid_at                       timestamptz NULL,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_rsvp_contributions_reference_uniq UNIQUE (stripe_payment_intent_id)
);

CREATE INDEX IF NOT EXISTS event_rsvp_contributions_event_idx
  ON public.event_rsvp_contributions (event_id);
CREATE INDEX IF NOT EXISTS event_rsvp_contributions_brand_idx
  ON public.event_rsvp_contributions (brand_id);
CREATE INDEX IF NOT EXISTS event_rsvp_contributions_user_idx
  ON public.event_rsvp_contributions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_rsvp_contributions_status_idx
  ON public.event_rsvp_contributions (status, created_at);

COMMENT ON TABLE public.event_rsvp_contributions IS
  'ORCH-1291 — voluntary RSVP chip-in contributions. The CHILD table that keeps '
  'the RSVP payment-free wall (event_rsvps never gains a payment column). GIFT '
  'semantics: pricing_breakdown.tax_basis=voluntary_contribution, tax_cents=0; '
  'Mingla still takes application_fee_amount_cents. Both rails: Stripe PI id / '
  'Paystack reference share stripe_payment_intent_id (UNIQUE idempotency slot).';

-- updated_at touch trigger (reuse the RSVP touch fn shape).
CREATE OR REPLACE FUNCTION public.fn_event_rsvp_contributions_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_event_rsvp_contributions_touch ON public.event_rsvp_contributions;
CREATE TRIGGER trg_event_rsvp_contributions_touch
  BEFORE UPDATE ON public.event_rsvp_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_event_rsvp_contributions_touch_updated_at();

-- ---------------------------------------------------------------------------
-- (2) RLS on event_rsvp_contributions.
--     WRITE: service_role ONLY (all writes go through the edge fn + finalize
--     RPC; buyers never write directly). READ: (a) the contributing user_id may
--     read their own rows; (b) the brand owner/team (event_manager rank) may
--     read rows for their brand's events; (c) anon reads NOTHING (state is
--     returned to the anon buyer only via the edge fn response / status poll).
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_rsvp_contributions ENABLE ROW LEVEL SECURITY;

-- Host read: all contribution rows for their brand's events (event_manager rank).
DROP POLICY IF EXISTS event_rsvp_contributions_host_read ON public.event_rsvp_contributions;
CREATE POLICY event_rsvp_contributions_host_read ON public.event_rsvp_contributions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rsvp_contributions.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Guest read own (logged-in contributor reads their own rows).
DROP POLICY IF EXISTS event_rsvp_contributions_guest_read_own ON public.event_rsvp_contributions;
CREATE POLICY event_rsvp_contributions_guest_read_own ON public.event_rsvp_contributions
  FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for authenticated/anon → all writes are
-- service-role only (bypasses RLS). Anon gets NO policy at all → reads nothing.

GRANT SELECT, INSERT, UPDATE ON TABLE public.event_rsvp_contributions TO service_role;

-- ---------------------------------------------------------------------------
-- (3) events config columns (organiser config; nullable so non-RSVP events are
--     unaffected). No rsvp_contribution_mode column in v1 (mode is implicitly
--     'optional'; the enum is DEFERRED to the required-mode fast-follow).
-- ---------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_contribution_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rsvp_contribution_suggested_cents integer NULL,
  ADD COLUMN IF NOT EXISTS rsvp_contribution_min_cents integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_rsvp_contribution_suggested_positive'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_rsvp_contribution_suggested_positive
      CHECK (rsvp_contribution_suggested_cents IS NULL OR rsvp_contribution_suggested_cents > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_rsvp_contribution_min_positive'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_rsvp_contribution_min_positive
      CHECK (rsvp_contribution_min_cents IS NULL OR rsvp_contribution_min_cents > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.events.rsvp_contribution_enabled IS
  'ORCH-1291 — when true, this RSVP event solicits a voluntary chip-in gift after '
  'RSVP. Flips the event into a money-collector → publish is bank-gated via '
  'pg_brand_can_collect. Default false so every existing event is unchanged.';

-- ---------------------------------------------------------------------------
-- (4) pg_brand_can_collect — PROVIDER-AWARE readiness predicate.
--
--     WHY provider-aware (investigation F-4/D-1, the Stripe-blind trap): the
--     existing pg_brand_can_charge only checks stripe_connect_accounts, so
--     reusing it verbatim would FALSELY BLOCK every Paystack (NGN) brand from
--     publishing a chip-in RSVP even though it can demonstrably collect via its
--     subaccount. This sibling adds the Paystack signal. DO NOT repurpose
--     pg_brand_can_charge (Stripe-only, still used by the ticket paths).
--
--     Mirrors pg_brand_can_charge's hardened posture: SECURITY DEFINER + locked
--     search_path='' (every identifier schema-qualified) so an anon/non-owner
--     caller does not get a false-negative from RLS on stripe_connect_accounts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_brand_can_collect(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.pg_brand_can_charge(p_brand_id)                  -- Stripe: charges_enabled
      OR EXISTS (
        SELECT 1 FROM public.brands b
         WHERE b.id = p_brand_id
           AND b.paystack_subaccount_code IS NOT NULL            -- Paystack: subaccount present
      );
$function$;

COMMENT ON FUNCTION public.pg_brand_can_collect(uuid) IS
  'ORCH-1291 — PROVIDER-AWARE money-readiness predicate. TRUE iff the brand can '
  'collect on EITHER rail: Stripe charges_enabled (pg_brand_can_charge) OR a '
  'Paystack subaccount present. The RSVP chip-in publish gate calls THIS, never '
  'pg_brand_can_charge (Stripe-blind → would wrongly block every NGN brand — '
  'investigation F-4/D-1). SECURITY DEFINER + search_path='''' mirrors '
  'pg_brand_can_charge so anon/non-owner callers never get an RLS false-negative.';

GRANT EXECUTE ON FUNCTION public.pg_brand_can_collect(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (5) finalize_rsvp_contribution — SECURITY DEFINER, service_role. IDEMPOTENT
--     (early-return if already 'paid'). Flips status='paid', sets paid_at +
--     stripe_charge_id. Mirrors biz_ticket_checkout_finalize's idempotency shape
--     but writes ONLY the contribution row: NO order, NO ticket, NO QR/admission.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_rsvp_contribution(
  p_contribution_id     uuid,
  p_provider_ref        text,
  p_charge_id           text,
  p_payment_method_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.event_rsvp_contributions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.event_rsvp_contributions
   WHERE id = p_contribution_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contribution_not_found';
  END IF;

  -- Idempotent early-return: a duplicate webhook delivery for an already-paid
  -- contribution is a no-op (T-11). Return the current row as-is.
  IF v_row.status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'contribution_id', v_row.id,
      'status', v_row.status
    );
  END IF;

  -- Authenticity note: p_contribution_id arrives from Stripe/Paystack metadata
  -- that Mingla set at create and the provider echoes back verbatim on a
  -- signature-verified webhook, so the id is trustworthy. We do NOT hard-match
  -- the provider ref (the web Stripe path stores the Checkout Session id, but
  -- payment_intent.succeeded carries the PI id — a strict match would falsely
  -- reject the web finalize). The ref is back-filled below for audit only.
  UPDATE public.event_rsvp_contributions
     SET status = 'paid',
         paid_at = now(),
         stripe_charge_id = COALESCE(p_charge_id, stripe_charge_id),
         stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_provider_ref),
         updated_at = now()
   WHERE id = p_contribution_id
     AND status <> 'paid';

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'contribution_id', p_contribution_id,
    'status', 'paid'
  );
END;
$function$;

COMMENT ON FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text) IS
  'ORCH-1291 — finalize a voluntary RSVP contribution from the verified '
  'Stripe/Paystack webhook. IDEMPOTENT: early-returns if already paid (T-11). '
  'Writes ONLY the contribution row (NO order/ticket/QR). service_role only.';

GRANT EXECUTE ON FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text) TO service_role;

COMMIT;

-- ===========================================================================
-- (6) business_publish_rsvp_draft — CONDITIONAL provider-aware bank-gate.
--
-- Reproduced VERBATIM from 20261004000000_orch_1150_rsvp_events.sql (signature
-- unchanged → CREATE OR REPLACE, no DROP). The ONLY behavioral changes:
--   (a) read rsvpContributionEnabled / rsvpContributionSuggestedCents /
--       rsvpContributionMinCents from the draft payload;
--   (b) when rsvp_contribution_enabled=true, RAISE 'stripe_charges_disabled'
--       unless pg_brand_can_collect(brand_id) — provider-aware. FREE RSVPs
--       (enabled=false) are NEVER gated (do NOT gate free RSVPs — SC-6);
--   (c) persist the 3 config columns in the UPDATE.
-- The wall soft-delete of stray ticket_types is preserved verbatim (SC-9).
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.business_publish_rsvp_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_timezone text;
  v_visibility text;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_event_dates_rows jsonb;
  v_when jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- RSVP host-control locals.
  v_rsvp_capacity integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  -- ORCH-1291 — voluntary chip-in config.
  v_rsvp_contribution_enabled boolean;
  v_rsvp_contribution_suggested_cents integer;
  v_rsvp_contribution_min_cents integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;
  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency INTO v_brand
    FROM public.brands WHERE id = v_event.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  -- Taxonomy (party-type gate KEPT — steering #2). City NOT required (freeform).
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]);

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;
  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;
  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;
  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','hiphop-rap','pop','rock','latin','afrobeats','rnb-soul',
    'disco-funk','reggae-dancehall','indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  -- RSVP host-control reads.
  v_rsvp_capacity := NULLIF(v_business_draft->>'rsvpCapacity', '')::integer;
  v_rsvp_allow_plus_ones := COALESCE((v_business_draft->>'rsvpAllowPlusOnes')::boolean, false);
  v_rsvp_plus_ones_max := COALESCE((v_business_draft->>'rsvpPlusOnesMax')::integer, 0);
  v_rsvp_waitlist_enabled := COALESCE((v_business_draft->>'rsvpWaitlistEnabled')::boolean, false);
  v_rsvp_approval_mode := COALESCE(NULLIF(v_business_draft->>'rsvpApprovalMode', ''), 'auto');
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((v_business_draft->>'rsvpDiscoverable')::boolean, false);

  -- ORCH-1291 — voluntary chip-in config reads (nullable; absent → disabled/NULL).
  v_rsvp_contribution_enabled := COALESCE((v_business_draft->>'rsvpContributionEnabled')::boolean, false);
  v_rsvp_contribution_suggested_cents := NULLIF(v_business_draft->>'rsvpContributionSuggestedCents', '')::integer;
  v_rsvp_contribution_min_cents := NULLIF(v_business_draft->>'rsvpContributionMinCents', '')::integer;

  -- ORCH-1291 — CONDITIONAL provider-aware bank-gate. ONLY when chip-in is
  -- enabled does the RSVP become a money-collector requiring a connected payout
  -- rail. pg_brand_can_collect is PROVIDER-AWARE (Stripe charges_enabled OR
  -- Paystack subaccount) — reusing the Stripe-only pg_brand_can_charge here would
  -- wrongly block every NGN brand (investigation F-4/D-1). A FREE RSVP
  -- (enabled=false) is NEVER gated (SC-6). Raises the ORCH-1075-recognized
  -- 'stripe_charges_disabled' reason so paidPublishGuards routes to bank setup.
  IF v_rsvp_contribution_enabled AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled'
      USING HINT = 'RSVP chip-in is enabled but the brand cannot collect (no connected bank / subaccount).';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;
  -- A private RSVP can never be on a public discovery feed.
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- Slug.
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'rsvp';
  END IF;
  v_final_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = v_event.brand_id AND e.deleted_at IS NULL
      AND e.id <> p_event_id AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL; v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL; v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL; v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  -- Single-date only (steering #4).
  v_when := v_business_draft->'when';
  v_date_iso := NULLIF(v_when->>'date', '');
  IF v_date_iso IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;
  v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
  v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
  v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
  v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
  IF v_end <= v_start THEN
    v_end := v_end + INTERVAL '1 day';
  END IF;

  -- Discoverable RSVPs must be future-dated (no dead deck card). Link-only is
  -- allowed same-day. NO stripe gate for FREE RSVPs (moneyless).
  IF v_rsvp_discoverable AND v_end <= v_now THEN
    RAISE EXCEPTION 'offering_date_past';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

  -- Permit the draft->scheduled slug finalization (ORCH-0763 trigger).
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);

  UPDATE public.events
  SET
    event_type = 'rsvp',
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = false,
    is_multi_date = false,
    recurrence_rules = NULL,
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets' - 'category' - 'partyTypes' - 'vibeTags' - 'musicGenres'
        - 'city' - 'locationGeo'),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    -- ORCH-1291 — persist the voluntary chip-in config.
    rsvp_contribution_enabled = v_rsvp_contribution_enabled,
    rsvp_contribution_suggested_cents = v_rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents = v_rsvp_contribution_min_cents,
    updated_at = v_now
  WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  -- An RSVP creates ZERO ticket_types (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS).
  -- Defensive: soft-delete any stray ticket rows from a mis-routed draft.
  UPDATE public.ticket_types
     SET deleted_at = v_now, updated_at = v_now
   WHERE event_id = p_event_id AND deleted_at IS NULL;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_event_dates_rows
    FROM public.event_dates ed WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'tickets', '[]'::jsonb,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.business_publish_rsvp_draft(uuid, jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.business_publish_rsvp_draft(uuid, jsonb, integer) IS
  'ORCH-1150 + ORCH-1291 — RSVP publish RPC. Zero tickets; keeps party-type gate. '
  'ORCH-1291: CONDITIONAL provider-aware bank-gate — when rsvpContributionEnabled '
  'the brand must pg_brand_can_collect (Stripe OR Paystack), else RAISE '
  'stripe_charges_disabled; FREE RSVPs stay ungated. Persists the 3 chip-in '
  'config columns. do NOT merge back into the event/ticket path.';

COMMIT;
