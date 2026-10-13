-- Issue #3645 — an unpublished draft with nothing sold follows its brand's
-- currency when that currency changes.
--
-- WHAT WAS BROKEN. A draft's currency was stamped once and never read from the
-- brand again. A host who picked one payout country and later connected a bank
-- in another kept a draft in the old currency, and at Publish
-- `tg_require_event_brand_currency` stamped the brand's NEW currency onto the
-- OLD numbers: a 50 pound ticket went on sale as a 50 naira ticket.
--
-- WHAT THIS DOES. Two triggers, no function re-emitted.
--
--   1. `issue_3645_drafts_follow_brand_currency`, AFTER UPDATE OF
--      default_currency ON public.brands. When the brand gets a currency, for
--      each of its drafts that was never published, is not deleted and has no
--      sale or payment in flight of any kind:
--        * the draft is always STAMPED with the brand's currency, in every
--          copy (row, draft JSON, ticket rows);
--        * its prices are CLEARED when the brand had a real currency before
--          AND the draft holds a copy of another currency (Seth's ruling,
--          #3645, 2026-10-13). A number is never carried across currencies;
--        * otherwise its prices are KEPT: a draft with no currency of its own
--          (typed while the screen said "Currency not set"), or any draft of a
--          brand that never had a currency.
--      When the brand LOSES its currency nothing is moved; the outgoing
--      currency is only remembered (see "TWO WRITES" below).
--
--   2. `issue_3645_refuse_publish_with_cleared_prices`, BEFORE UPDATE OF status
--      ON public.events. A trip whose package price was cleared in (1) and has
--      not been entered again cannot leave draft: `price_reentry_required`.
--
-- HOW "NO PRICE YET" IS REPRESENTED, per draft kind.
--   * Event tickets live only in `theme.business_draft.tickets[]` until
--     Publish. `priceGbp: null` with `isFree: false` is the wizard's own "no
--     price yet" state: the ticket sheet shows an empty required field and
--     `validatePublish` refuses with "Set a price for <ticket>, or mark it
--     free." A free ticket (`isFree: true`) is left exactly as it was.
--   * RSVP chip-in amounts (`rsvp_contribution_suggested_cents`,
--     `rsvp_contribution_min_cents`, and their copies in the draft JSON) are
--     nullable and optional. NULL means "the guest chooses".
--   * Trip packages are `ticket_types` rows, `price_cents integer NOT NULL`,
--     and 0 MEANS FREE: the wizard says "Free package" and Publish treats the
--     trip as free. Writing 0 alone would turn a paid package into a free one,
--     so a cleared package also gets a marker in its own
--     `trip_pricing_tiers.tier_metadata`:
--         "price_cleared_for_currency_change": {"from": "GBP", "to": "NGN"}
--     and keeps `is_free = false`. Every shipped client merges into
--     tier_metadata and preserves keys it does not know (tripsService
--     `updateTripPricing`), so the marker survives a save from an old app
--     build. Trigger (2) refuses Publish while a marked package still costs 0.
--     Once the package has a price above zero the marker means nothing.
--   * The draft JSON gets `pricesClearedForCurrencyChange: {from, to}` when a
--     ticket price or chip-in amount was cleared, so the wizard can say why
--     the fields are empty. It is a notice, not a lock: an event draft save
--     replaces the JSON.
--
-- TWO WRITES, ONE CHANGE. The payout-country picker leaves Nigeria in two
-- writes: the provider is cleared (default_currency becomes NULL), then the
-- new currency is set. The Stripe account mirror can null it too. Judged one
-- write at a time, the second looks like a brand's FIRST currency and naira
-- prices would be kept as dollars. So "the brand had a real currency before"
-- is not read from OLD alone: when a brand's currency goes to NULL, the
-- outgoing one is kept in `public.brand_cleared_currency` (one row per brand,
-- no client access), and the next write that sets a currency reads it back and
-- deletes it. NGN -> NULL -> USD therefore clears prices exactly like
-- NGN -> USD; NGN -> NULL -> NGN finds nothing out of step and changes nothing.
--
-- WHY NOT DECIDE FROM THE DRAFT'S OWN CURRENCY ALONE. Checked on the replayed
-- schema: today's owners leave a draft created on a brand with no currency
-- with NO currency of its own (events.currency NULL, draft JSON currency null,
-- a trip's package currency NULL, and a priced trip package is refused with
-- `event_currency_required`). But older builds stamped a placeholder (USD) on
-- trip and experience drafts of such brands, and a placeholder is not a
-- currency the host priced in: those drafts must keep their numbers when the
-- brand picks its first currency. Only the brand knows whether it ever had a
-- real one. And the memory cannot live on the drafts: a brand losing its
-- currency must not touch a draft at all.
--
-- WHAT IS LEFT ALONE.
--   * Published events, drafts with any order, ticket, checkout session, door
--     sale or chip-in, and events unpublished after a sale (published_at set).
--   * `event_type = 'experience'`. Experience drafts on a brand with no
--     currency are stamped USD as a placeholder, and the experience functions
--     validate against their own inline currency list (no NGN). The #3645
--     owner chat is fixing that; this trigger must not fight it.
--   * Payment plans: they are percentages of the package price, not amounts.
--   * Existing rows. No backfill. Production when this was written: no draft
--     in a currency other than its brand's; one draft with no currency on an
--     NGN brand, with nothing priced (the client stamps it on its next save).
--   * A brand that lost its currency BEFORE this migration has no remembered
--     currency, so its next currency is treated as a first one (stamp, keep).
--
-- WHY IT DOES NOT FIGHT THE OTHER CURRENCY TRIGGERS.
--   * `tg_enforce_event_ticket_currency` raises when a ticket's currency
--     differs from its event's. The event row is therefore written FIRST, then
--     its ticket rows.
--   * `tg_require_event_brand_currency` returns at once for status = 'draft'.
--   * `issue_1384_reconcile_bank_currency` (AFTER UPDATE OF default_currency
--     ON brands) writes `brands.provisional_currency_code` only. Neither it
--     nor this function writes `default_currency`, so neither re-fires the
--     other.
--
-- WHO FIRES IT. Signed-in hosts and service_role (the bank and payout-country
-- edge functions, the Stripe account mirror). The function is SECURITY DEFINER
-- with a fixed search_path and never reads auth.uid() or a request claim.
--
-- A DRAFT MUST NEVER BLOCK A BANK CONNECTION. Each draft is handled in its own
-- sub-transaction. If one cannot be moved (for example the brand's new
-- currency is not one an offering may use) that draft stays as it was, the
-- reason is written to the database log as a WARNING naming the draft, and the
-- brand's own update still succeeds.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drafts follow the brand.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_cleared_currency (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  currency character(3) NOT NULL,
  cleared_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brand_cleared_currency IS
  'Issue #3645: the currency a brand had when its default_currency was last set to NULL, kept until the brand next gets a currency. Lets a currency change made in two writes (X to NULL, NULL to Y) clear draft prices like a direct X to Y. Written and read only by the trigger function issue_3645_drafts_follow_brand_currency(); no client access.';

ALTER TABLE public.brand_cleared_currency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_cleared_currency FROM PUBLIC;
REVOKE ALL ON TABLE public.brand_cleared_currency FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_3645_drafts_follow_brand_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new char(3);
  v_old char(3);
  v_prev char(3);
  v_wipe boolean;
  v_marker jsonb;
  v_event record;
  v_theme jsonb;
  v_draft jsonb;
  v_tickets jsonb;
  v_cleared boolean;
  v_ticket_cleared boolean;
BEGIN
  v_new := upper(NULLIF(btrim(COALESCE(NEW.default_currency::text, '')), ''))::char(3);
  v_old := upper(NULLIF(btrim(COALESCE(OLD.default_currency::text, '')), ''))::char(3);

  IF v_new IS NOT DISTINCT FROM v_old THEN
    RETURN NULL;
  END IF;

  -- The brand loses its currency: no draft is touched. Remember what it had,
  -- so the write that follows is not mistaken for a first currency.
  IF v_new IS NULL THEN
    INSERT INTO public.brand_cleared_currency AS m (brand_id, currency, cleared_at)
    VALUES (NEW.id, v_old, now())
    ON CONFLICT (brand_id) DO UPDATE
      SET currency = EXCLUDED.currency, cleared_at = EXCLUDED.cleared_at;
    RETURN NULL;
  END IF;

  -- The currency the brand really had before this one: the one being replaced,
  -- or the one it had before it was cleared. NULL = it never had one.
  IF v_old IS NOT NULL THEN
    v_prev := v_old;
  ELSE
    SELECT m.currency INTO v_prev
      FROM public.brand_cleared_currency m
     WHERE m.brand_id = NEW.id;
  END IF;
  DELETE FROM public.brand_cleared_currency m WHERE m.brand_id = NEW.id;

  FOR v_event IN
    SELECT e.id, e.event_type, e.currency, e.theme,
           e.rsvp_contribution_suggested_cents, e.rsvp_contribution_min_cents,
           -- Does the draft hold a copy of ANOTHER currency, anywhere?
           ( (e.currency IS NOT NULL AND e.currency <> v_new)
             OR (jsonb_typeof(e.theme#>'{business_draft,currency}') = 'string'
                 AND NULLIF(btrim(e.theme#>>'{business_draft,currency}'), '') IS NOT NULL
                 AND upper(btrim(e.theme#>>'{business_draft,currency}')) <> v_new::text)
             OR EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(
                           CASE WHEN jsonb_typeof(e.theme#>'{business_draft,tickets}') = 'array'
                                THEN e.theme#>'{business_draft,tickets}' ELSE '[]'::jsonb END) AS jt(value)
                   WHERE jsonb_typeof(jt.value) = 'object'
                     AND jsonb_typeof(jt.value->'currency') = 'string'
                     AND NULLIF(btrim(jt.value->>'currency'), '') IS NOT NULL
                     AND upper(btrim(jt.value->>'currency')) <> v_new::text)
             OR EXISTS (
                  SELECT 1 FROM public.ticket_types tt
                   WHERE tt.event_id = e.id AND tt.deleted_at IS NULL
                     AND tt.currency IS NOT NULL AND tt.currency <> v_new)
           ) AS holds_other_currency
      FROM public.events e
     WHERE e.brand_id = NEW.id
       AND e.status = 'draft'
       AND e.published_at IS NULL
       AND e.deleted_at IS NULL
       -- Experiences are deliberately skipped; see the header.
       AND e.event_type IN ('event', 'rsvp', 'trip')
       -- Nothing sold and no money in flight, in any state.
       AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions s WHERE s.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_contributions c WHERE c.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.door_sales_ledger d WHERE d.event_id = e.id)
     ORDER BY e.id
       FOR UPDATE OF e
  LOOP
    -- Already in step in every copy: nothing to do. (A row already in the new
    -- currency whose JSON or ticket copies are not is still handled below.)
    CONTINUE WHEN v_event.currency IS NOT DISTINCT FROM v_new
              AND NOT v_event.holds_other_currency
              AND (jsonb_typeof(v_event.theme#>'{business_draft}') IS DISTINCT FROM 'object'
                   OR upper(btrim(COALESCE(v_event.theme#>>'{business_draft,currency}', ''))) = v_new::text);

    BEGIN
      -- Clear only when the brand had a real currency and this draft holds a
      -- copy of another one. Otherwise stamp and keep what was typed.
      v_wipe := v_prev IS NOT NULL AND v_event.holds_other_currency;
      v_marker := jsonb_build_object(
        'from', COALESCE(v_event.currency::text, v_prev::text), 'to', v_new::text);

      v_theme := COALESCE(v_event.theme, '{}'::jsonb);
      v_draft := v_theme->'business_draft';
      v_cleared := false;

      IF jsonb_typeof(v_draft) = 'object' THEN
        v_draft := jsonb_set(v_draft, '{currency}', to_jsonb(v_new::text), true);

        -- Event tickets. A ticket that is not free and carries a price has the
        -- price cleared (when clearing). A ticket's own currency copy, where
        -- it has one, follows in both cases.
        IF jsonb_typeof(v_draft->'tickets') = 'array' THEN
          SELECT
            COALESCE(jsonb_agg(
              CASE
                WHEN jsonb_typeof(x.ticket) <> 'object' THEN x.ticket
                ELSE
                  (CASE
                     WHEN v_wipe AND x.priced THEN
                       (SELECT jsonb_object_agg(
                                 kv.key,
                                 CASE WHEN kv.key IN ('priceGbp', 'price', 'priceMajor', 'priceAllInGbp')
                                      THEN 'null'::jsonb ELSE kv.value END)
                          FROM jsonb_each(x.ticket) AS kv)
                       || jsonb_build_object('priceGbp', NULL)
                     ELSE x.ticket
                   END)
                  || CASE WHEN x.ticket ? 'currency'
                          THEN jsonb_build_object('currency', v_new::text)
                          ELSE '{}'::jsonb END
              END
              ORDER BY x.ord), '[]'::jsonb),
            COALESCE(bool_or(v_wipe AND x.priced), false)
          INTO v_tickets, v_ticket_cleared
          FROM (
            SELECT el.value AS ticket, el.ord,
                   (jsonb_typeof(el.value) = 'object'
                    AND (el.value->'isFree') IS DISTINCT FROM 'true'::jsonb
                    AND EXISTS (
                      SELECT 1
                        FROM unnest(ARRAY['priceGbp', 'price', 'priceMajor']) AS k(name)
                       WHERE jsonb_typeof(el.value->k.name) IN ('number', 'string')
                         AND (el.value->>k.name) !~ '^\s*0*(\.0*)?\s*$'
                    )) AS priced
              FROM jsonb_array_elements(v_draft->'tickets') WITH ORDINALITY AS el(value, ord)
          ) AS x;
          v_draft := jsonb_set(v_draft, '{tickets}', v_tickets, true);
          v_cleared := v_cleared OR v_ticket_cleared;
        END IF;

        -- RSVP chip-in amounts in the draft JSON (when clearing).
        IF v_wipe AND (
             jsonb_typeof(v_draft->'rsvpContributionSuggestedCents') IN ('number', 'string')
          OR jsonb_typeof(v_draft->'rsvpContributionMinCents') IN ('number', 'string')
        ) THEN
          v_draft := v_draft || jsonb_build_object(
            'rsvpContributionSuggestedCents', NULL,
            'rsvpContributionMinCents', NULL);
          v_cleared := true;
        END IF;

        IF v_wipe AND (v_event.rsvp_contribution_suggested_cents IS NOT NULL
                       OR v_event.rsvp_contribution_min_cents IS NOT NULL) THEN
          v_cleared := true;
        END IF;

        IF v_cleared THEN
          v_draft := jsonb_set(v_draft, '{pricesClearedForCurrencyChange}', v_marker, true);
        END IF;

        v_theme := jsonb_set(v_theme, '{business_draft}', v_draft, true);
      END IF;

      IF jsonb_typeof(v_theme->'business_event') = 'object'
         AND (v_theme->'business_event') ? 'currency' THEN
        v_theme := jsonb_set(v_theme, '{business_event,currency}', to_jsonb(v_new::text), true);
      END IF;

      -- The event row FIRST: tg_enforce_event_ticket_currency compares each
      -- ticket to it.
      UPDATE public.events e
         SET currency = v_new,
             theme = v_theme,
             rsvp_contribution_suggested_cents =
               CASE WHEN v_wipe THEN NULL ELSE e.rsvp_contribution_suggested_cents END,
             rsvp_contribution_min_cents =
               CASE WHEN v_wipe THEN NULL ELSE e.rsvp_contribution_min_cents END
       WHERE e.id = v_event.id;

      IF v_wipe THEN
        -- Trip packages: mark the package BEFORE its price goes to 0, so 0 can
        -- never be read as "the host chose free".
        UPDATE public.trip_pricing_tiers tpt
           SET tier_metadata = jsonb_set(
                 COALESCE(tpt.tier_metadata, '{}'::jsonb),
                 '{price_cleared_for_currency_change}', v_marker, true)
          FROM public.ticket_types tt
         WHERE tpt.event_id = v_event.id
           AND tt.id = tpt.ticket_type_id
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0;

        -- is_free is deliberately NOT touched: it was false and stays false.
        UPDATE public.ticket_types tt
           SET currency = v_new,
               price_cents = 0
         WHERE tt.event_id = v_event.id
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0;
      END IF;

      UPDATE public.ticket_types tt
         SET currency = v_new
       WHERE tt.event_id = v_event.id
         AND tt.deleted_at IS NULL
         AND tt.currency IS DISTINCT FROM v_new;
    EXCEPTION WHEN OTHERS THEN
      -- Never block the brand's own update, and never fail quietly.
      RAISE WARNING 'issue_3645_drafts_follow_brand_currency: draft % of brand % was left in % (wanted %): % [%]',
        v_event.id, NEW.id, COALESCE(v_event.currency::text, 'no currency'), v_new, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_drafts_follow_brand_currency() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3645_drafts_follow_brand_currency() FROM anon, authenticated;

COMMENT ON FUNCTION public.issue_3645_drafts_follow_brand_currency() IS
  'Issue #3645: AFTER UPDATE OF default_currency ON brands. Never-published, nothing-sold event / RSVP / trip drafts follow the brand''s currency in every copy. Prices are cleared when the brand had a real currency before (the one replaced, or the one remembered in brand_cleared_currency when it was cleared in an earlier write) and the draft holds a copy of another currency; otherwise they are kept. Trip packages cleared this way carry tier_metadata.price_cleared_for_currency_change and keep is_free = false. Experiences are skipped. Never reads auth.uid(); a draft that cannot be moved is logged as a WARNING and never blocks the brand update.';

DROP TRIGGER IF EXISTS issue_3645_drafts_follow_brand_currency ON public.brands;
CREATE TRIGGER issue_3645_drafts_follow_brand_currency
  AFTER UPDATE OF default_currency ON public.brands
  FOR EACH ROW
  WHEN (OLD.default_currency IS DISTINCT FROM NEW.default_currency)
  EXECUTE FUNCTION public.issue_3645_drafts_follow_brand_currency();

-- ---------------------------------------------------------------------------
-- 2. A trip package whose price was cleared cannot go live at 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3645_refuse_publish_with_cleared_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.event_type = 'trip'
     AND EXISTS (
       SELECT 1
         FROM public.trip_pricing_tiers tpt
         JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
        WHERE tpt.event_id = NEW.id
          AND tt.deleted_at IS NULL
          AND tt.price_cents = 0
          AND tpt.tier_metadata ? 'price_cleared_for_currency_change'
     ) THEN
    RAISE EXCEPTION 'price_reentry_required'
      USING ERRCODE = 'P0001',
            HINT = 'The brand''s currency changed and this trip''s package prices were cleared. Enter a price for each package before publishing.';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_refuse_publish_with_cleared_prices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3645_refuse_publish_with_cleared_prices() FROM anon, authenticated;

COMMENT ON FUNCTION public.issue_3645_refuse_publish_with_cleared_prices() IS
  'Issue #3645: BEFORE UPDATE OF status ON events, draft to scheduled/live. Refuses with price_reentry_required while a trip package still costs 0 and carries tier_metadata.price_cleared_for_currency_change, so a package cleared by a brand currency change can never go on sale as free.';

DROP TRIGGER IF EXISTS issue_3645_refuse_publish_with_cleared_prices ON public.events;
CREATE TRIGGER issue_3645_refuse_publish_with_cleared_prices
  BEFORE UPDATE OF status ON public.events
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status IN ('scheduled', 'live'))
  EXECUTE FUNCTION public.issue_3645_refuse_publish_with_cleared_prices();

-- Fail the migration, not a later bank connection, if this is not what was meant.
DO $verify$
DECLARE
  v_src text;
  v_def text;
  v_config text[];
  v_secdef boolean;
BEGIN
  SELECT p.prosrc, p.proconfig, p.prosecdef INTO v_src, v_config, v_secdef
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.issue_3645_drafts_follow_brand_currency()'::pg_catalog.regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'issue_3645_verify: issue_3645_drafts_follow_brand_currency missing';
  END IF;
  IF v_secdef IS DISTINCT FROM true
     OR v_config IS NULL
     OR NOT ('search_path=public, pg_temp' = ANY (v_config)) THEN
    RAISE EXCEPTION 'issue_3645_verify: the draft currency trigger is not SECURITY DEFINER with a fixed search_path (%)', v_config;
  END IF;
  IF pg_catalog.strpos(v_src, 'auth.uid') > 0
     OR pg_catalog.strpos(v_src, 'request.jwt') > 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the draft currency trigger depends on the caller; service_role fires it too';
  END IF;
  IF pg_catalog.strpos(v_src, '''experience''') > 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the draft currency trigger names experiences; they must be skipped';
  END IF;
  IF pg_catalog.strpos(v_src, 'published_at IS NULL') = 0
     OR pg_catalog.strpos(v_src, 'public.orders') = 0
     OR pg_catalog.strpos(v_src, 'public.tickets') = 0
     OR pg_catalog.strpos(v_src, 'public.ticket_checkout_sessions') = 0
     OR pg_catalog.strpos(v_src, 'public.event_rsvp_contributions') = 0
     OR pg_catalog.strpos(v_src, 'public.door_sales_ledger') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the draft currency trigger lost a nothing-sold condition';
  END IF;
  IF pg_catalog.strpos(v_src, 'price_cleared_for_currency_change') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: a cleared trip package would be indistinguishable from a free one';
  END IF;
  IF pg_catalog.strpos(v_src, 'brand_cleared_currency') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: a currency change made in two writes (X to NULL, NULL to Y) would keep the old numbers';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c
           WHERE c.oid = 'public.brand_cleared_currency'::pg_catalog.regclass)
     OR pg_catalog.has_table_privilege('anon', 'public.brand_cleared_currency', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.brand_cleared_currency', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.brand_cleared_currency', 'INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'issue_3645_verify: brand_cleared_currency is reachable by a client role';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.issue_3645_drafts_follow_brand_currency()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.issue_3645_drafts_follow_brand_currency()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.issue_3645_refuse_publish_with_cleared_prices()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.issue_3645_refuse_publish_with_cleared_prices()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: a client role can execute a #3645 trigger function';
  END IF;

  SELECT pg_catalog.pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.brands'::pg_catalog.regclass
     AND t.tgname = 'issue_3645_drafts_follow_brand_currency'
     AND NOT t.tgisinternal;
  IF v_def IS NULL
     OR pg_catalog.strpos(v_def, 'AFTER UPDATE OF default_currency') = 0
     OR pg_catalog.strpos(v_def, 'FOR EACH ROW') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the brands trigger is missing or mis-shaped: %', v_def;
  END IF;

  SELECT pg_catalog.pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.events'::pg_catalog.regclass
     AND t.tgname = 'issue_3645_refuse_publish_with_cleared_prices'
     AND NOT t.tgisinternal;
  IF v_def IS NULL
     OR pg_catalog.strpos(v_def, 'BEFORE UPDATE OF status') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the publish refusal trigger is missing or mis-shaped: %', v_def;
  END IF;

  -- The two triggers this one must not fight are still what the header says.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.tg_require_event_brand_currency()'::pg_catalog.regprocedure;
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'NEW.status = ''draft''') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: tg_require_event_brand_currency no longer returns early for drafts';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.issue_1384_reconcile_bank_currency()'::pg_catalog.regprocedure;
  IF v_src IS NULL OR v_src ~ 'SET\s+default_currency' THEN
    RAISE EXCEPTION 'issue_3645_verify: issue_1384_reconcile_bank_currency now writes default_currency; the two triggers would re-fire each other';
  END IF;
END
$verify$;

COMMIT;
