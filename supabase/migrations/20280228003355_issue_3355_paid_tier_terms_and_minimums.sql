-- Issue #3355 P6 — money flow: Seth's decisions 5 and 6, enforced on the server.
--
-- Decision 5: a teammate who never accepted the Organiser Terms 1.0 must accept
--   them before turning a live free offering paid. Today the publish RPCs check
--   Terms, but a live tier write (business_patch_event_ticket_tiers, the live
--   trip/experience editors, direct Host tier writes) can turn a free event
--   paid with no Terms check. This closes that gap by reusing
--   biz_require_current_organiser_terms (its body is NOT changed here).
--
-- Decision 6: a paid ticket price must be at least the payment provider's
--   minimum charge for its currency (Stripe, https://docs.stripe.com/currencies
--   #minimum-and-maximum-charge-amounts), checked when a price is SET: a new
--   paid tier or a changed price. Existing rows are never re-validated, so no
--   backfill and no table constraint; an untouched older price stays valid.
--   Currencies without a verified minimum (BGN, ISK, NGN) are not checked.
--
-- Both rules live in one BEFORE trigger on public.ticket_types, the single
-- table every ticket, trip-package and experience price is written to. The
-- publish functions (business_publish_*_draft / biz_publish_*), the money
-- predicates (pg_brand_can_collect / pg_brand_can_payout) and
-- biz_require_current_organiser_terms are untouched. A paid publish already
-- requires the publisher's Terms, so the Terms leg only adds a check on live
-- free→paid changes.
--
-- The minimum table is mirrored in edge code
-- (supabase/functions/_shared/money/providerMinimums.ts) and the Host app
-- (mingla-business/src/constants/providerMinimumCharges.ts); the Deno parity
-- test supabase/functions/_shared/__tests__/
-- issue_3355_money_flow.implementor.test.ts fails when they drift.
-- Behaviour is pinned by
-- supabase/migrations/__tests__/issue_3355_paid_tier_terms_and_minimums.implementor.pg17.test.sql.

-- ── Provider minimum charge, minor units (same unit as price_cents) ────────
CREATE OR REPLACE FUNCTION public.issue_3355_provider_minimum_charge_minor(
  p_currency text
) RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE upper(btrim(COALESCE(p_currency, '')))
    WHEN 'CAD' THEN 50
    WHEN 'CHF' THEN 50
    WHEN 'CZK' THEN 1500
    WHEN 'DKK' THEN 250
    WHEN 'EUR' THEN 50
    WHEN 'GBP' THEN 30
    WHEN 'HUF' THEN 17500
    WHEN 'NOK' THEN 300
    WHEN 'PLN' THEN 200
    WHEN 'RON' THEN 200
    WHEN 'SEK' THEN 300
    WHEN 'USD' THEN 50
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.issue_3355_provider_minimum_charge_minor(text) IS
  'Issue #3355 P6 (Seth decision 6): the payment provider minimum charge for a currency in minor units, NULL when no verified minimum. Mirrors _shared/money/providerMinimums.ts and the Host constants.';

REVOKE ALL ON FUNCTION public.issue_3355_provider_minimum_charge_minor(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_3355_provider_minimum_charge_minor(text)
  TO anon, authenticated, service_role;

-- ── The ticket price rules (decisions 5 and 6) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3355_ticket_type_paid_price_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now_paid boolean;
  v_was_paid boolean;
  v_price_set boolean;
  v_minimum integer;
  v_brand_id uuid;
  v_status text;
  v_uid uuid;
BEGIN
  v_now_paid := NEW.deleted_at IS NULL
    AND NOT COALESCE(NEW.is_free, false)
    AND COALESCE(NEW.price_cents, 0) > 0;
  IF NOT v_now_paid THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_was_paid := false;
    v_price_set := true;
  ELSE
    v_was_paid := OLD.deleted_at IS NULL
      AND NOT COALESCE(OLD.is_free, false)
      AND COALESCE(OLD.price_cents, 0) > 0;
    v_price_set := NEW.price_cents IS DISTINCT FROM OLD.price_cents
      OR NEW.is_free IS DISTINCT FROM OLD.is_free;
  END IF;

  -- Decision 6: only a price being set now is checked.
  IF v_price_set THEN
    v_minimum := public.issue_3355_provider_minimum_charge_minor(NEW.currency);
    IF v_minimum IS NOT NULL AND NEW.price_cents < v_minimum THEN
      RAISE EXCEPTION 'ticket_price_below_minimum'
        USING ERRCODE = '22023',
              DETAIL = format('currency=%s minimum_minor=%s',
                upper(btrim(NEW.currency)), v_minimum),
              HINT = 'A paid ticket must be at least the payment provider''s minimum charge for its currency.';
    END IF;
  END IF;

  -- Decision 5: a live offering with no paid tier becoming paid needs the
  -- acting member's Organiser Terms. Drafts are checked at publish; system
  -- writes (no signed-in member of the brand) are unchanged.
  IF NOT v_was_paid THEN
    v_uid := auth.uid();
    IF v_uid IS NOT NULL THEN
      SELECT e.brand_id, e.status INTO v_brand_id, v_status
      FROM public.events e
      WHERE e.id = NEW.event_id;
      IF v_status IS DISTINCT FROM 'draft'
         AND EXISTS (
           SELECT 1 FROM public.brand_team_members m
           WHERE m.brand_id = v_brand_id
             AND m.user_id = v_uid
             AND m.removed_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.ticket_types o
           WHERE o.event_id = NEW.event_id
             AND o.id IS DISTINCT FROM NEW.id
             AND o.deleted_at IS NULL
             AND NOT COALESCE(o.is_free, false)
             AND COALESCE(o.price_cents, 0) > 0
         )
      THEN
        PERFORM public.biz_require_current_organiser_terms(v_brand_id);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.issue_3355_ticket_type_paid_price_rules() IS
  'Issue #3355 P6: on a new or changed paid ticket price, refuse a price below the provider minimum (ticket_price_below_minimum) and, when a live offering with no paid tier turns paid, require the acting member''s Organiser Terms (mingla_tos_not_accepted via biz_require_current_organiser_terms).';

REVOKE ALL ON FUNCTION public.issue_3355_ticket_type_paid_price_rules()
  FROM PUBLIC, anon, authenticated;

-- Named to fire after trg_enforce_event_ticket_currency (BEFORE triggers run in
-- name order), so the currency it resolves is the one checked.
DROP TRIGGER IF EXISTS trg_zz_issue_3355_ticket_type_paid_price_rules
  ON public.ticket_types;
CREATE TRIGGER trg_zz_issue_3355_ticket_type_paid_price_rules
  BEFORE INSERT OR UPDATE OF price_cents, is_free
  ON public.ticket_types
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_3355_ticket_type_paid_price_rules();
