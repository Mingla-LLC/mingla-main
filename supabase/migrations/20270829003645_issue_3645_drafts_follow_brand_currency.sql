-- Issue #3645 — an unpublished draft with nothing sold follows its brand's
-- currency when that currency changes.
--
-- WHAT WAS BROKEN. A draft's currency was stamped once and never read from the
-- brand again. A host who picked one payout country and later connected a bank
-- in another kept a draft in the old currency, and at Publish
-- `tg_require_event_brand_currency` stamped the brand's NEW currency onto the
-- OLD numbers: a 50 pound ticket went on sale as a 50 naira ticket.
--
-- WHAT THIS DOES. Three triggers, one small table, one per-draft routine and
-- one small function a host's app may call. No existing function re-emitted.
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
--      ON public.events, running before the currency re-stamp. (a) A trip whose
--      package price was cleared in (1) and has not been entered again cannot
--      leave draft. (b) A money-bearing draft that carries a currency other
--      than the one its brand now sells in cannot leave draft either. Both
--      answer `price_reentry_required`. `biz_sync_draft_currency(event)` is
--      the way out: it moves that one draft, if it may be moved.
--
--   3. `issue_3645_refuse_price_on_cleared_package`, a deferred constraint
--      trigger on public.trip_pricing_tiers and public.ticket_types. At
--      commit, a package that still carries the marker from (1) and has a
--      price above 0 is refused: `price_reentry_required`. That is a pricing
--      form left open across the change, or an older app build, sending the
--      OLD number back. Such a build cannot re-price a cleared package; the
--      host does it on Host web. See section 3 below for why it is deferred.
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
--     and the clear itself leaves `is_free` as it was (false). `is_free` is
--     NOT what marks the package: the draft owner recomputes it as
--     "price = 0" on every save, so a later save of a still-empty price flips
--     it to true. The MARKER is the only thing that says "no price yet", and
--     Publish is refused on the marker, whatever `is_free` says. Every shipped
--     client merges into
--     tier_metadata and preserves keys it does not know (tripsService
--     `updateTripPricing`), so the marker survives a save from an old app
--     build. Trigger (2) refuses Publish while a marked package still costs 0,
--     and trigger (3) refuses a marked package with a price above 0, so the
--     marker and a price never coexist.
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
--   * Published events; drafts with any order, ticket, door sale or chip-in;
--     drafts on which a buyer ever started a checkout (the brand trigger is
--     strict about this; see the routine's own comment); and events
--     unpublished after a sale (published_at set). None of these can be
--     published while out of step with their brand: see (2)(b). A draft held
--     back only by an ABANDONED checkout is moved by `biz_sync_draft_currency`
--     when its host asks.
--   * `event_type = 'experience'`. Experience drafts on a brand with no
--     currency are stamped USD as a placeholder, and the experience functions
--     validate against their own inline currency list (no NGN). The #3645
--     owner chat is fixing that; this trigger must not fight it.
--   * Payment plans: they are percentages of the package price, not amounts.
--   * Existing rows. No backfill. Production when this was written: no draft
--     in a currency other than its brand's; one draft with no currency on an
--     NGN brand, with nothing priced (the client stamps it on its next save).
--   * LIMIT of the remembered currency: a brand that lost its currency BEFORE
--     this migration has nothing remembered, so its next currency is treated
--     as a first one (stamp, keep).
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

-- The ONE routine that moves a draft to a currency. The brand trigger runs it
-- for each of a brand's drafts; `biz_sync_draft_currency` runs it for one
-- draft a host could not publish. It never reads auth.uid() or a request
-- claim: who may call it is decided by its callers.
--
-- Returns what happened:
--   'moved_prices_cleared'   stamped, and prices cleared
--   'moved'                  stamped, prices kept
--   'in_step'                already in that currency in every copy
--   'not_a_draft'            missing, deleted, not a draft, or an experience
--   'unpublished_after_sale' it was published once and still carries that date
--   'sale_exists'            an order, ticket, chip-in, door sale or a
--                            COMPLETED checkout exists
--   'checkout_in_progress'   a buyer has a checkout open right now
--   'checkout_was_started'   (brand trigger only) a buyer once opened a
--                            checkout on it, even an abandoned one
--
-- WHICH CHECKOUT SESSIONS COUNT (ticket_checkout_sessions.status is one of
-- pending_free, requires_payment, awaiting_web_redirect, processing_payment,
-- paid_completed, free_completed, failed, expired; expires_at is NOT NULL):
--   * completed:   status IN ('paid_completed', 'free_completed'), or the
--                  session has an order_id                -> 'sale_exists'
--   * in progress: status = 'processing_payment' (money may be moving, at
--                  any age), or status IN ('pending_free', 'requires_payment',
--                  'awaiting_web_redirect') AND expires_at > now()
--                                                         -> 'checkout_in_progress'
--   * everything else (failed, expired, or a pending session past its
--     expires_at) is an ABANDONED checkout with no order: nobody paid and
--     nobody can any more.
--
-- WHO IS STOPPED BY AN ABANDONED CHECKOUT. The brand trigger is, on purpose
-- (p_abandoned_checkouts_block = true, answer 'checkout_was_started'): an
-- unattended change to a brand never touches a draft a buyer once opened a
-- checkout on. Such a draft cannot be published out of step with its brand
-- (trigger (2)(b) refuses), and when the host is refused the app calls
-- `biz_sync_draft_currency`, which passes false: with the host present and
-- asking, an abandoned checkout no longer stops the move. So that draft is
-- never at a dead end, and never goes on sale at the old number.
CREATE OR REPLACE FUNCTION public.issue_3645_move_draft_to_currency(
  p_event_id uuid,
  p_new character(3),
  p_prev character(3),
  p_assume_previous boolean DEFAULT false,
  p_abandoned_checkouts_block boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_wipe boolean;
  v_marker jsonb;
  v_theme jsonb;
  v_draft jsonb;
  v_tickets jsonb;
  v_cleared boolean;
  v_ticket_cleared boolean;
BEGIN
  IF p_new IS NULL THEN
    RETURN 'not_a_draft';
  END IF;

  SELECT e.id, e.event_type, e.status, e.deleted_at, e.published_at, e.currency, e.theme,
         e.rsvp_contribution_suggested_cents, e.rsvp_contribution_min_cents,
         -- Does the draft hold a copy of ANOTHER currency, anywhere?
         ( (e.currency IS NOT NULL AND e.currency <> p_new)
           OR (jsonb_typeof(e.theme#>'{business_draft,currency}') = 'string'
               AND NULLIF(btrim(e.theme#>>'{business_draft,currency}'), '') IS NOT NULL
               AND upper(btrim(e.theme#>>'{business_draft,currency}')) <> p_new::text)
           OR EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(e.theme#>'{business_draft,tickets}') = 'array'
                              THEN e.theme#>'{business_draft,tickets}' ELSE '[]'::jsonb END) AS jt(value)
                 WHERE jsonb_typeof(jt.value) = 'object'
                   AND jsonb_typeof(jt.value->'currency') = 'string'
                   AND NULLIF(btrim(jt.value->>'currency'), '') IS NOT NULL
                   AND upper(btrim(jt.value->>'currency')) <> p_new::text)
           OR EXISTS (
                SELECT 1 FROM public.ticket_types tt
                 WHERE tt.event_id = e.id AND tt.deleted_at IS NULL
                   AND tt.currency IS NOT NULL AND tt.currency <> p_new)
         ) AS holds_other_currency
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
     FOR UPDATE OF e;

  -- Experiences are deliberately skipped; see the header.
  IF NOT FOUND
     OR v_event.deleted_at IS NOT NULL
     OR v_event.status <> 'draft'
     OR v_event.event_type NOT IN ('event', 'rsvp', 'trip') THEN
    RETURN 'not_a_draft';
  END IF;
  IF v_event.published_at IS NOT NULL THEN
    RETURN 'unpublished_after_sale';
  END IF;

  -- Nothing sold and no money in flight.
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.event_rsvp_contributions c WHERE c.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.door_sales_ledger d WHERE d.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.ticket_checkout_sessions s
                 WHERE s.event_id = p_event_id
                   AND (s.status IN ('paid_completed', 'free_completed')
                        OR s.order_id IS NOT NULL)) THEN
    RETURN 'sale_exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_sessions s
              WHERE s.event_id = p_event_id
                AND (s.status = 'processing_payment'
                     OR (s.status IN ('pending_free', 'requires_payment', 'awaiting_web_redirect')
                         AND s.expires_at > now()))) THEN
    RETURN 'checkout_in_progress';
  END IF;
  -- The brand trigger (p_abandoned_checkouts_block) is stricter: ANY checkout
  -- session ever started on the draft keeps it out of an unattended move.
  IF p_abandoned_checkouts_block
     AND EXISTS (SELECT 1 FROM public.ticket_checkout_sessions s
                  WHERE s.event_id = p_event_id) THEN
    RETURN 'checkout_was_started';
  END IF;

  -- Already in step in every copy: nothing to do. (A row already in the new
  -- currency whose JSON or ticket copies are not is still handled below.)
  IF v_event.currency IS NOT DISTINCT FROM p_new
     AND NOT v_event.holds_other_currency
     AND (jsonb_typeof(v_event.theme#>'{business_draft}') IS DISTINCT FROM 'object'
          OR upper(btrim(COALESCE(v_event.theme#>>'{business_draft,currency}', ''))) = p_new::text) THEN
    RETURN 'in_step';
  END IF;

  -- Clear only when the brand had a real currency and this draft holds a copy
  -- of another one. Otherwise stamp and keep what was typed.
  v_wipe := (p_prev IS NOT NULL OR p_assume_previous) AND v_event.holds_other_currency;
  v_marker := jsonb_build_object(
    'from', COALESCE(v_event.currency::text, p_prev::text), 'to', p_new::text);

  v_theme := COALESCE(v_event.theme, '{}'::jsonb);
  v_draft := v_theme->'business_draft';
  v_cleared := false;

  IF jsonb_typeof(v_draft) = 'object' THEN
    v_draft := jsonb_set(v_draft, '{currency}', to_jsonb(p_new::text), true);

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
                      THEN jsonb_build_object('currency', p_new::text)
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
    v_theme := jsonb_set(v_theme, '{business_event,currency}', to_jsonb(p_new::text), true);
  END IF;

  -- The event row FIRST: tg_enforce_event_ticket_currency compares each
  -- ticket to it.
  UPDATE public.events e
     SET currency = p_new,
         theme = v_theme,
         rsvp_contribution_suggested_cents =
           CASE WHEN v_wipe THEN NULL ELSE e.rsvp_contribution_suggested_cents END,
         rsvp_contribution_min_cents =
           CASE WHEN v_wipe THEN NULL ELSE e.rsvp_contribution_min_cents END
   WHERE e.id = v_event.id;

  IF v_wipe THEN
    -- Trip packages: the price goes to 0 and the package is marked in ONE
    -- statement, so 0 can never be read as "the host chose free" and a
    -- marked package never holds a price, whatever the constraint mode.
    -- is_free is not touched here. It is not relied on either: the draft
    -- owner recomputes it on every save. The marker is what counts.
    WITH cleared AS (
      UPDATE public.ticket_types tt
         SET currency = p_new,
             price_cents = 0
       WHERE tt.event_id = v_event.id
         AND tt.deleted_at IS NULL
         AND tt.price_cents > 0
      RETURNING tt.id
    )
    UPDATE public.trip_pricing_tiers tpt
       SET tier_metadata = jsonb_set(
             COALESCE(tpt.tier_metadata, '{}'::jsonb),
             '{price_cleared_for_currency_change}', v_marker, true)
      FROM cleared c
     WHERE tpt.event_id = v_event.id
       AND tpt.ticket_type_id = c.id;
  END IF;

  UPDATE public.ticket_types tt
     SET currency = p_new
   WHERE tt.event_id = v_event.id
     AND tt.deleted_at IS NULL
     AND tt.currency IS DISTINCT FROM p_new;

  RETURN CASE WHEN v_wipe THEN 'moved_prices_cleared' ELSE 'moved' END;
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean) FROM anon, authenticated;

COMMENT ON FUNCTION public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean) IS
  'Issue #3645: moves ONE never-published, nothing-sold event / RSVP / trip draft to a currency in every copy and says what happened. Prices are cleared when the brand had a real currency before (p_prev, or p_assume_previous) and the draft holds a copy of another currency; otherwise kept. Completed or in-progress checkouts always stop the move; abandoned and expired ones stop it only when p_abandoned_checkouts_block is true (the brand trigger). Never reads auth.uid(); callers decide who may run it. Not executable by client roles.';

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
  v_event record;
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
    SELECT e.id, e.currency
      FROM public.events e
     WHERE e.brand_id = NEW.id
       AND e.status = 'draft'
       AND e.deleted_at IS NULL
       AND e.event_type IN ('event', 'rsvp', 'trip')
     ORDER BY e.id
  LOOP
    BEGIN
      PERFORM public.issue_3645_move_draft_to_currency(v_event.id, v_new, v_prev, false, true);
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
  'Issue #3645: AFTER UPDATE OF default_currency ON brands. Never-published, nothing-sold event / RSVP / trip drafts follow the brand''s currency in every copy. Prices are cleared when the brand had a real currency before (the one replaced, or the one remembered in brand_cleared_currency when it was cleared in an earlier write) and the draft holds a copy of another currency; otherwise they are kept. Trip packages cleared this way carry tier_metadata.price_cleared_for_currency_change, which (not is_free) is what marks them as having no price yet. Experiences are skipped. Never reads auth.uid(); a draft that cannot be moved is logged as a WARNING and never blocks the brand update.';

DROP TRIGGER IF EXISTS issue_3645_drafts_follow_brand_currency ON public.brands;
CREATE TRIGGER issue_3645_drafts_follow_brand_currency
  AFTER UPDATE OF default_currency ON public.brands
  FOR EACH ROW
  WHEN (OLD.default_currency IS DISTINCT FROM NEW.default_currency)
  EXECUTE FUNCTION public.issue_3645_drafts_follow_brand_currency();

-- ---------------------------------------------------------------------------
-- 2. Publish stops: a cleared trip package cannot go live at 0, and a draft
--    that is out of step with its brand cannot go live at all.
--
-- (b) is for every draft (1) did NOT move: one with a checkout in progress or
-- a sale, one whose brand moved to a currency no offering may use (the
-- WARNING path), and one an in-flight save or an older app build wrote the
-- old currency and price back over (`business_update_event_draft` stores what
-- it is sent). Before this, Publish itself did the damage:
-- `tg_require_event_brand_currency` re-stamped the event with the brand's
-- currency and `tg_enforce_event_ticket_currency` overwrote the tickets, so
-- 50 pounds went on sale as 50 naira.
--
-- ORDER. BEFORE row triggers on one table fire in NAME order. This trigger,
-- `issue_3645_refuse_publish_with_cleared_prices`, sorts before
-- `trg_require_event_brand_currency_update`, so it sees NEW.currency as the
-- publish wrote it, before the re-stamp replaces it. It also reads OLD (the
-- stored draft), so it does not depend on that order to see the stored copy.
--
-- "HOLDS A PAID PRICE". The publish owners declare a moneyless publish with
-- the transaction flag `mingla.publish_free_only` (issue #1014). Without that
-- flag the publish is money-bearing. The stored draft is checked as well
-- (priced tickets in the draft JSON, priced ticket rows, chip-in amounts), so
-- a flag left on by an earlier publish in the same transaction cannot hide a
-- priced draft. A free-only draft is never refused here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3645_refuse_publish_with_cleared_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand_currency char(3);
  v_out_of_step boolean;
  v_money boolean;
BEGIN
  -- (a) A trip package cleared by a currency change and not priced again.
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

  -- (b) A draft priced in a currency its brand no longer sells in.
  IF NEW.event_type NOT IN ('event', 'rsvp', 'trip') THEN
    RETURN NEW;
  END IF;

  -- The currency the re-stamp is about to use (same resolution as
  -- tg_require_event_brand_currency).
  SELECT upper(COALESCE(sca.default_currency::text, b.default_currency::text))::char(3)
    INTO v_brand_currency
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca
      ON sca.brand_id = b.id
     AND sca.detached_at IS NULL
   WHERE b.id = NEW.brand_id
     AND b.deleted_at IS NULL
   LIMIT 1;
  IF v_brand_currency IS NULL THEN
    RETURN NEW;
  END IF;

  v_out_of_step :=
       (NEW.currency IS NOT NULL AND NEW.currency <> v_brand_currency)
    OR (OLD.currency IS NOT NULL AND OLD.currency <> v_brand_currency)
    OR (jsonb_typeof(OLD.theme#>'{business_draft,currency}') = 'string'
        AND NULLIF(btrim(OLD.theme#>>'{business_draft,currency}'), '') IS NOT NULL
        AND upper(btrim(OLD.theme#>>'{business_draft,currency}')) <> v_brand_currency::text)
    OR EXISTS (
         SELECT 1 FROM public.ticket_types tt
          WHERE tt.event_id = NEW.id AND tt.deleted_at IS NULL
            AND tt.price_cents > 0
            AND tt.currency IS NOT NULL AND tt.currency <> v_brand_currency);
  IF NOT v_out_of_step THEN
    RETURN NEW;
  END IF;

  v_money :=
       current_setting('mingla.publish_free_only', true) IS DISTINCT FROM 'on'
    OR COALESCE(NEW.rsvp_contribution_enabled, false)
       AND (NEW.rsvp_contribution_suggested_cents IS NOT NULL
            OR NEW.rsvp_contribution_min_cents IS NOT NULL)
    OR EXISTS (
         SELECT 1 FROM public.ticket_types tt
          WHERE tt.event_id = NEW.id AND tt.deleted_at IS NULL AND tt.price_cents > 0)
    OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(OLD.theme#>'{business_draft,tickets}') = 'array'
                       THEN OLD.theme#>'{business_draft,tickets}' ELSE '[]'::jsonb END) AS jt(value)
          WHERE jsonb_typeof(jt.value) = 'object'
            AND (jt.value->'isFree') IS DISTINCT FROM 'true'::jsonb
            AND EXISTS (
              SELECT 1 FROM unnest(ARRAY['priceGbp', 'price', 'priceMajor']) AS k(name)
               WHERE jsonb_typeof(jt.value->k.name) IN ('number', 'string')
                 AND (jt.value->>k.name) !~ '^\s*0*(\.0*)?\s*$'));
  IF v_money THEN
    RAISE EXCEPTION 'price_reentry_required'
      USING ERRCODE = 'P0001',
            HINT = 'This draft is priced in a currency its brand no longer sells in. Its prices must be entered again in the brand''s currency before it can be published.';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_refuse_publish_with_cleared_prices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3645_refuse_publish_with_cleared_prices() FROM anon, authenticated;

COMMENT ON FUNCTION public.issue_3645_refuse_publish_with_cleared_prices() IS
  'Issue #3645: BEFORE UPDATE OF status ON events, draft to scheduled/live; fires before trg_require_event_brand_currency_update (name order). Refuses with price_reentry_required (a) while a trip package still costs 0 and carries tier_metadata.price_cleared_for_currency_change, and (b) when a money-bearing draft carries a currency other than the one its brand now sells in, so Publish can never put the brand''s new currency on a number typed in the old one. Free-only drafts are not refused.';

DROP TRIGGER IF EXISTS issue_3645_refuse_publish_with_cleared_prices ON public.events;
CREATE TRIGGER issue_3645_refuse_publish_with_cleared_prices
  BEFORE UPDATE OF status ON public.events
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status IN ('scheduled', 'live'))
  EXECUTE FUNCTION public.issue_3645_refuse_publish_with_cleared_prices();

-- ---------------------------------------------------------------------------
-- 2b. The way out of a refused Publish: `biz_sync_draft_currency`.
--
-- A host refused by (2)(b) must not be at a dead end. This runs the SAME
-- per-draft routine the brand trigger runs, for that one draft, and says what
-- happened. If the draft can be moved (nothing sold, no checkout in progress)
-- it is moved to the brand's currency and its prices are cleared, and the host
-- enters new ones. If a checkout is still in progress or a sale exists, it is
-- left alone and the answer says so.
--
-- Who may call it: a signed-in member of the brand with the same rank the
-- draft-save functions require (event manager). The permission check is the
-- only place the caller is read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_sync_draft_currency(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
  v_brand_currency char(3);
  v_outcome text;
  v_currency char(3);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT e.brand_id INTO v_brand_id
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_brand_id, v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT upper(COALESCE(sca.default_currency::text, b.default_currency::text))::char(3)
    INTO v_brand_currency
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca
      ON sca.brand_id = b.id
     AND sca.detached_at IS NULL
   WHERE b.id = v_brand_id
     AND b.deleted_at IS NULL
   LIMIT 1;

  IF v_brand_currency IS NULL THEN
    v_outcome := 'brand_has_no_currency';
  ELSE
    -- The host was refused because this draft is priced in another currency:
    -- a copy of another currency is cleared, whatever the brand's history.
    -- Abandoned checkouts do not stop it here: the host is present and asked.
    v_outcome := public.issue_3645_move_draft_to_currency(p_event_id, v_brand_currency, NULL, true, false);
  END IF;

  SELECT e.currency INTO v_currency FROM public.events e WHERE e.id = p_event_id;
  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'currency', v_currency::text,
    'brandCurrency', v_brand_currency::text);
END
$function$;

REVOKE ALL ON FUNCTION public.biz_sync_draft_currency(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_sync_draft_currency(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_sync_draft_currency(uuid) TO authenticated;

COMMENT ON FUNCTION public.biz_sync_draft_currency(uuid) IS
  'Issue #3645: for a brand member with event-manager rank, moves ONE draft to its brand''s current currency through the same routine the brand trigger uses (prices in another currency are cleared) and returns {outcome, currency, brandCurrency}. outcome is one of moved_prices_cleared, moved, in_step, not_a_draft, unpublished_after_sale, sale_exists, checkout_in_progress, brand_has_no_currency. An abandoned or expired checkout with no order does not stop it. Called by the Host app when Publish is refused with price_reentry_required, so the host can enter prices again.';

-- ---------------------------------------------------------------------------
-- 3. A cleared trip package cannot be saved with a price it did not get after
--    the clear.
--
-- A pricing form left open across the currency change, or an app build older
-- than this change, still holds the OLD number. It reads the package's
-- metadata (marker included) and sends both back: the old number would be
-- stored under the new currency and, having a price, would publish. A correct
-- client leaves the marker out when the host types a price. So a package that
-- still carries the marker AND has a price above 0 is refused:
-- `price_reentry_required`.
--
-- DEFERRED, checked when the transaction commits, not on each statement. The
-- draft owner writes the price first and the metadata second; judged between
-- the two, a correct re-price would look wrong. At commit only the end state
-- counts. Nothing in the chain switches this to immediate: the draft owner
-- `biz_apply_trip_draft_graph` and its callers never run SET CONSTRAINTS (the
-- only use in the chain names `stay_offering_media_sort_unique`), and the
-- wipe in (1) is a single statement that passes in either mode.
--
-- (2) and (3) agree: with the marker a package can only cost 0, and at 0 it
-- cannot be published. To publish, the host types a price (the marker goes)
-- or says free (the marker goes).
-- ---------------------------------------------------------------------------
-- The commit-time check below looks a package up by its ticket type on every
-- ticket price update. trip_pricing_tiers had indexes on (event_id) and
-- (event_id, ticket_type_id) only, neither usable for that lookup. A plain
-- CREATE INDEX (it runs inside this transaction, so not CONCURRENTLY) is
-- acceptable here: the table held 17 rows in production when this was written.
CREATE INDEX IF NOT EXISTS idx_trip_pricing_tiers_ticket_type
  ON public.trip_pricing_tiers (ticket_type_id);

CREATE OR REPLACE FUNCTION public.issue_3645_refuse_price_on_cleared_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ticket_type_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'ticket_types' THEN
    v_ticket_type_id := NEW.id;
  ELSE
    v_ticket_type_id := NEW.ticket_type_id;
  END IF;

  -- A save that REPLACED a marked package's metadata with something that is
  -- not an object at all (`"tier_metadata": null`) and left a price on it. No
  -- correct client sends that: it always sends an object. It is the marker
  -- being thrown away with the old number, so it is refused like the marker
  -- being sent back.
  --
  -- An EMPTY object cannot be told apart here and is NOT refused: a correct
  -- re-price of a package with no description and no payment plan sends
  -- exactly `{}` (the metadata it read, minus the marker). Telling the two
  -- apart needs the client to say it knew about the clear, which is a change
  -- to what the draft owner accepts, not something this trigger can see.
  -- (Nested on purpose: OLD has no tier_metadata on ticket_types, and no OLD
  -- at all on an insert; plpgsql resolves every field an expression names.)
  IF TG_TABLE_NAME = 'trip_pricing_tiers' AND TG_OP = 'UPDATE' THEN
    IF OLD.tier_metadata ? 'price_cleared_for_currency_change'
       AND jsonb_typeof(NEW.tier_metadata) IS DISTINCT FROM 'object'
       AND EXISTS (
         SELECT 1 FROM public.ticket_types tt
          WHERE tt.id = v_ticket_type_id
            AND tt.deleted_at IS NULL
            AND tt.price_cents > 0
       ) THEN
      RAISE EXCEPTION 'price_reentry_required'
        USING ERRCODE = 'P0001',
              HINT = 'The brand''s currency changed and this package''s price was cleared. The price sent was not entered after the clear. Enter the price again.';
    END IF;
  END IF;

  -- The rows as they stand NOW (commit time), not as this write left them.
  IF EXISTS (
    SELECT 1
      FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
     WHERE tt.id = v_ticket_type_id
       AND tt.deleted_at IS NULL
       AND tt.price_cents > 0
       AND tpt.tier_metadata ? 'price_cleared_for_currency_change'
  ) THEN
    RAISE EXCEPTION 'price_reentry_required'
      USING ERRCODE = 'P0001',
            HINT = 'The brand''s currency changed and this package''s price was cleared. The price sent was not entered after the clear. Enter the price again.';
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_refuse_price_on_cleared_package() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3645_refuse_price_on_cleared_package() FROM anon, authenticated;

COMMENT ON FUNCTION public.issue_3645_refuse_price_on_cleared_package() IS
  'Issue #3645: deferred constraint trigger on trip_pricing_tiers (tier_metadata) and ticket_types (price_cents). At commit, a trip package that still carries tier_metadata.price_cleared_for_currency_change and has a price above 0 is refused with price_reentry_required, so a stale pricing form or an older app build cannot store the old number under the brand''s new currency.';

DROP TRIGGER IF EXISTS issue_3645_refuse_price_on_cleared_package ON public.trip_pricing_tiers;
CREATE CONSTRAINT TRIGGER issue_3645_refuse_price_on_cleared_package
  AFTER INSERT OR UPDATE OF tier_metadata ON public.trip_pricing_tiers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_3645_refuse_price_on_cleared_package();

DROP TRIGGER IF EXISTS issue_3645_refuse_price_on_cleared_package ON public.ticket_types;
CREATE CONSTRAINT TRIGGER issue_3645_refuse_price_on_cleared_package
  AFTER UPDATE OF price_cents ON public.ticket_types
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.price_cents > 0)
  EXECUTE FUNCTION public.issue_3645_refuse_price_on_cleared_package();

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
  -- The trigger and the one routine it runs are judged together.
  SELECT v_src || ' ' || p.prosrc INTO v_src
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)'::pg_catalog.regprocedure;
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
  IF pg_catalog.strpos(v_src, 'published_at IS NOT NULL') = 0
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

  -- The move routine: definer, fixed path, closed to clients, and the
  -- narrowed checkout rule is the one written in its header.
  IF NOT (SELECT p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig)
            FROM pg_catalog.pg_proc AS p
           WHERE p.oid = 'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)'::pg_catalog.regprocedure)
     OR pg_catalog.has_function_privilege('anon', 'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: the per-draft move routine is not a closed SECURITY DEFINER function';
  END IF;
  IF pg_catalog.strpos(v_src, '''paid_completed'', ''free_completed''') = 0
     OR pg_catalog.strpos(v_src, 's.expires_at > now()') = 0
     OR pg_catalog.strpos(v_src, '''processing_payment''') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the checkout rule changed; a completed or in-progress checkout must stop the move and an abandoned one must not';
  END IF;

  -- The way out of a refused publish: signed-in members only, same rank as
  -- the draft-save functions, and it runs the shared routine.
  SELECT p.prosrc INTO v_def FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.biz_sync_draft_currency(uuid)'::pg_catalog.regprocedure;
  IF v_def IS NULL
     OR pg_catalog.strpos(v_def, 'issue_3645_move_draft_to_currency') = 0
     OR pg_catalog.strpos(v_def, 'biz_role_rank(''event_manager'')') = 0
     OR pg_catalog.strpos(v_def, 'not_authenticated') = 0
     OR pg_catalog.has_function_privilege('anon', 'public.biz_sync_draft_currency(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.biz_sync_draft_currency(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: biz_sync_draft_currency is missing, unguarded, or granted to the wrong roles';
  END IF;

  -- The publish stop must run BEFORE the re-stamp: BEFORE row triggers fire in
  -- name order.
  IF NOT ('issue_3645_refuse_publish_with_cleared_prices'::name COLLATE "C"
            < 'trg_require_event_brand_currency_update'::name COLLATE "C")
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS t
        WHERE t.tgrelid = 'public.events'::pg_catalog.regclass
          AND t.tgname = 'trg_require_event_brand_currency_update' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'issue_3645_verify: the publish stop no longer sorts before the currency re-stamp trigger on events';
  END IF;

  -- (3) the stale-price refusal: on both tables, deferred to commit.
  IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_trigger AS t
       WHERE t.tgname = 'issue_3645_refuse_price_on_cleared_package'
         AND t.tgrelid IN ('public.trip_pricing_tiers'::pg_catalog.regclass,
                           'public.ticket_types'::pg_catalog.regclass)
         AND t.tgconstraint <> 0
         AND t.tgdeferrable
         AND t.tginitdeferred) <> 2 THEN
    RAISE EXCEPTION 'issue_3645_verify: the cleared-package price refusal is missing, or is not a deferred constraint trigger on both tables (an immediate one refuses a correct re-price)';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = 'public.trip_pricing_tiers'::pg_catalog.regclass
       AND a.attname = 'ticket_type_id'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'issue_3645_verify: no index on trip_pricing_tiers leads with ticket_type_id; the commit-time check would scan the table on every ticket price update';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.issue_3645_refuse_price_on_cleared_package()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.issue_3645_refuse_price_on_cleared_package()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: a client role can execute the cleared-package price refusal';
  END IF;
  -- The draft owner must not force constraints to immediate: it writes the
  -- price before the metadata, and a correct re-price would be refused.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('biz_apply_trip_draft_graph', 'biz_publish_trip_command',
                         'business_publish_trip_draft', 'biz_create_trip_draft')
       AND p.prosrc ~* 'set\s+constraints'
  ) THEN
    RAISE EXCEPTION 'issue_3645_verify: a trip draft function runs SET CONSTRAINTS; the deferred cleared-package refusal would judge a half-written package';
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
