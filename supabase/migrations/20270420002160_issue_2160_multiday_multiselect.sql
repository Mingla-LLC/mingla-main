-- issue #2160 — a guest can attend MORE THAN ONE day of a multi-day event.
--
-- Implements the SPEC at issue #2160 as amended by SPEC AMENDMENT 1
-- (organiser-selected pricing mode). Where the two differ, the AMENDMENT
-- controls; every §-reference below is to the amendment unless it says "SPEC".
--
-- ── THE MODEL, IN ONE SENTENCE ─────────────────────────────────────────────
-- A pass admits the days it has `ticket_event_dates` rows for.
--
--   `per_day`  , D days chosen -> D tickets, ONE row each.
--   `all_days` , D days chosen -> ONE ticket, D rows.
--   no days chosen (single-date / legacy / experience / trip / RSVP)
--                               -> ZERO rows -> "not day-scoped" -> today's
--                                  any-occurrence admission window, verbatim,
--                                  for every pass ever issued.
--
-- Both modes are the SAME sentence; only the minter distributes differently.
-- `biz_ticket_scan` never asks which mode it is looking at. That is deliberate:
-- "a scan records which day it admitted, and a pass is refused on a day it was
-- not issued for" is ONE invariant and must not acquire a second enforcement
-- site (amendment §0).
--
-- ── WHAT THIS FILE CHANGES ─────────────────────────────────────────────────
--   §A  schema: 2 new tables, 2 new columns, 1 CHECK, 1 lock trigger, indexes.
--   §F  pg_direct_event_checkout_bundle  — occurrences + the multi-date signal.
--   §B  issue_1930_ticket_checkout_create_session_base — the chosen day set.
--   §B2 biz_ticket_checkout_create_session (wrapper)   — #2150 carried forward.
--   §C  issue_1930_ticket_session_authorized           — re-validate every day.
--   §D  issue_1930_ticket_checkout_finalize_base       — mint the entitlements.
--   §E  biz_ticket_scan                                — the new day ladder.
--   §G  verification probes.
--
-- §B, §B2, §C, §D, §E and §F are VERBATIM re-emits of live, payment-critical or
-- door-critical functions with named deltas. Each re-emit was extracted from
-- its latest definer by line range, not retyped:
--   §B  20270324001929_issue_1929_hidden_direct_checkout.sql:240-719
--       (the body the #1930 rename at 20270403001930:915 captured)
--   §B2 20270419002150_issue_2150_free_resubmit_idempotent.sql:158-358
--   §C  20270414002101_issue_2101_named_buyer_checkout_access.sql:971-1028
--   §D  20261117000001_orch_1188_finalize_persist_event_date_id.sql:30-335
--   §E  20260821000000_orch_1051_scanner_invite_flow.sql:420-590
--   §F  20270413001931_issue_1931_private_event_access.sql:974-1204
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Revert the code; LEAVE the tables and columns. They are additive and, with
-- the code reverted, unread — the system is byte-identical to today with two
-- dormant tables and two dormant columns. DROPPING `ticket_event_dates` is
-- destructive to already-minted day-bound passes and is NOT the rollback path.
-- The six re-emitted functions roll back by re-applying the definitions cited
-- above, in that order.
--
-- ── NO BACKFILL. ANYWHERE. FOR ANY COLUMN OR TABLE. ────────────────────────
-- See §A.1. This is a hard rule, not a default.

-- ===========================================================================
-- §A — SCHEMA. Additive. No backfill. No data migration.
-- ===========================================================================

-- §A.0 — the organiser's per-event pricing mode.
--
-- NOT NULL with a DEFAULT is deliberate: a total function with two states and
-- no "unset" third state to reason about. Inert for every single-date,
-- recurring, RSVP, trip and experience row.
--
-- WHY THE DEFAULT IS 'per_day' AND WHY THAT CANNOT REPRICE ANYTHING.
-- An organiser who priced a ticket at £10 priced AN ADMISSION. Under `per_day`
-- a two-day guest pays £20 and the organiser receives what they priced; under
-- `all_days` that same organiser would be giving a second day away on inventory
-- they already published — a silent price cut applied to every multi-date event
-- in the system at once.
--
-- And the guarantee is EXACT, not approximate: on today's build a guest can
-- select AT MOST ONE day, and with one day chosen the two modes are
-- arithmetically identical (qty x 1 either way). So for every selection any
-- guest can make on today's build, on every existing event, in either mode, the
-- price and the pass count are unchanged. The only behaviour this default
-- governs is a selection that does not yet exist. `DEFAULT 'per_day'` therefore
-- fills every existing row correctly BY CONSTRUCTION — there is nothing to
-- backfill and nothing that can move.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS multi_date_pricing_mode text NOT NULL DEFAULT 'per_day';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'events_multi_date_pricing_mode_check'
       AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_multi_date_pricing_mode_check
      CHECK (multi_date_pricing_mode IN ('per_day', 'all_days'));
  END IF;
END $$;

COMMENT ON COLUMN public.events.multi_date_pricing_mode IS
  'issue #2160 — how a guest pays for MULTIPLE days of a multi-date event. '
  '''per_day'': each chosen day is a separate admission, separately priced, and '
  'mints its own pass. ''all_days'': one price, one pass, valid on every day the '
  'guest chose. DEFAULT ''per_day'' because it is the only default that cannot '
  'silently reprice live inventory. Inert on single-date, recurring, RSVP, trip '
  'and experience rows. Locked once a live ticket exists (see the trigger below).';

-- §A.1 — HARD RULE: DO NOT BACKFILL ANY DAY BINDING FROM `orders.event_date_id`.
--
-- `tickets` deliberately gains NO `event_date_id` column, and
-- `ticket_event_dates` deliberately starts EMPTY. Deriving entitlement rows for
-- existing orders from `orders.event_date_id` would retroactively NARROW the
-- admission window of passes guests already hold — a live guest-facing
-- regression on QR codes already in wallets, already screenshotted, already
-- printed. A pass with zero rows admits on any occurrence, exactly as it does
-- today; a pass with rows admits only those. Narrowing is not a no-op, it is a
-- refusal at a door the guest already paid for.
--
-- If those orders are ever to be day-scoped it is a separate, explicitly
-- approved operation with its own gate and its own guest communication. It is
-- NOT part of this migration and must not be added to it.

-- §A.2 — `scan_events.event_date_id`: WHICH DAY THIS SCAN ADMITTED.
--
-- ON DELETE SET NULL, matching `orders_event_date_id_fkey`
-- (20261117000000_orch_1188_orders_event_date_id.sql:24-38): deleting a stale
-- occurrence must never cascade-delete a scan record. NULL means exactly one
-- thing — THIS ROW IS NOT DAY-SCOPED. Never "unknown", never "all days".
ALTER TABLE public.scan_events ADD COLUMN IF NOT EXISTS event_date_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scan_events_event_date_id_fkey'
       AND conrelid = 'public.scan_events'::regclass
  ) THEN
    ALTER TABLE public.scan_events
      ADD CONSTRAINT scan_events_event_date_id_fkey
      FOREIGN KEY (event_date_id) REFERENCES public.event_dates(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS scan_events_event_date_id_idx
  ON public.scan_events (event_date_id)
  WHERE event_date_id IS NOT NULL;

COMMENT ON COLUMN public.scan_events.event_date_id IS
  'issue #2160 — the occurrence this scan admitted the guest on (or, on a '
  'day-scoped refusal, the occurrence the pass was being presented against, so '
  'a refusal is attributable rather than anonymous). NULL means the scan was '
  'not day-scoped: a legacy or single-date pass, or an event with no '
  'event_dates rows. Written ONLY by biz_ticket_scan.';

-- §A.3 — ADMISSION-CONSUMED, ONCE PER (ticket, day).
--
-- The house pattern, not an invention: `rsvp_scan_events` already enforces
-- admission-once with a partial unique index
-- (20270204001447_issue_1447_rsvp_admission.sql:86-89,
--  rsvp_scan_events_primary_success_once ON (rsvp_id) WHERE outcome='success').
--
-- ZERO MIGRATION RISK, PROVABLY: `scan_events.event_date_id` is created in THIS
-- migration, so every pre-existing row has it NULL and the partial predicate
-- excludes all live data. The index cannot fail to build.
--
-- DO NOT ADD A NULL-DAY UNIQUE INDEX. Existing data may legitimately contain
-- more than one success row per ticket via offline-scanner reconciliation
-- (baseline squash:9487 — service role may UPDATE/DELETE for "partial scanner
-- sync repair"), and a unique index over live rows could abort the migration.
-- Null-day exactly-once stays enforced where it is today, by `tickets.status`.
-- Nothing other than `biz_ticket_scan` writes `event_date_id`, and it cannot
-- produce two successes for the same null-day pass because that pass flips to
-- `status='used'` on its first admission.
CREATE UNIQUE INDEX IF NOT EXISTS scan_events_ticket_day_success_once
  ON public.scan_events (ticket_id, event_date_id)
  WHERE scan_result = 'success' AND event_date_id IS NOT NULL;

-- §A.4 — `ticket_event_dates`: THE DAYS A PASS ADMITS. The whole model.
--
-- FKs are ON DELETE CASCADE, which DIFFERS from every other event_date_id FK
-- in this migration (those are SET NULL). The reason is not stylistic: on the
-- other tables NULL means "not day-scoped" and is a valid, meaningful state.
-- Here a ROW *IS* the entitlement, and a row pointing at a deleted occurrence
-- is not a weaker entitlement — it is a nonexistent one. Deleting a published
-- occurrence is already an organiser-destructive act guarded elsewhere.
CREATE TABLE IF NOT EXISTS public.ticket_event_dates (
  ticket_id     uuid NOT NULL REFERENCES public.tickets(id)     ON DELETE CASCADE,
  event_date_id uuid NOT NULL REFERENCES public.event_dates(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, event_date_id)
);

CREATE INDEX IF NOT EXISTS ticket_event_dates_event_date_id_idx
  ON public.ticket_event_dates (event_date_id);

COMMENT ON TABLE public.ticket_event_dates IS
  'issue #2160 — the days a pass ADMITS. A pass admits the days it has rows '
  'for. ZERO rows means "not day-scoped": today''s any-occurrence admission '
  'window, verbatim, which is what every pass issued before #2160 has and must '
  'keep. per_day mints N passes with one row each; all_days mints one pass with '
  'N rows. This table is the SOLE authority for which day a pass is valid on '
  '(I-PROPOSED-2160-A) — no other table, column or jsonb key may express it.';

-- RLS (I-1860). Inline EXISTS predicates over the parent `tickets` row,
-- mirroring "Buyer or brand team can select tickets" (baseline squash:14204).
-- Inline rather than delegated to a helper that returns the owner, per
-- feedback_rls_returning_owner_gap.
--
-- SELECT only. There is deliberately NO INSERT, UPDATE or DELETE policy: writes
-- are service-role only, from the minter. A client must never be able to grant
-- itself a day.
ALTER TABLE public.ticket_event_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyer or brand team can select ticket event dates"
  ON public.ticket_event_dates;
CREATE POLICY "Buyer or brand team can select ticket event dates"
  ON public.ticket_event_dates FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.tickets t
      LEFT JOIN public.orders o ON o.id = t.order_id
     WHERE t.id = public.ticket_event_dates.ticket_id
       AND (
         public.biz_is_brand_member_for_read(
           public.biz_event_brand_id(t.event_id), auth.uid())
         OR NOT (o.buyer_user_id IS DISTINCT FROM auth.uid())
       )
  ));

REVOKE ALL ON TABLE public.ticket_event_dates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ticket_event_dates TO authenticated;
GRANT ALL    ON TABLE public.ticket_event_dates TO service_role;

-- §A.5 — `ticket_checkout_session_event_dates`: the days chosen at checkout.
--
-- The day set is a property of the SESSION, expressed ONCE — not of the cart
-- line (amendment §1). Cart lines stay exactly (ticketTypeId, quantity), so
-- `order_line_items.total_cents = quantity x unit_price_cents` holds in every
-- row in BOTH modes. A per-line day cannot do that: under `all_days` it would
-- either charge N x (wrong) or need N-1 lines priced at zero, which makes the
-- line lie about what it cost.
--
-- Service-role ONLY: no anon or authenticated grant at all. Checkout sessions
-- are never read directly by a client today and must not start being.
CREATE TABLE IF NOT EXISTS public.ticket_checkout_session_event_dates (
  checkout_session_id uuid NOT NULL
    REFERENCES public.ticket_checkout_sessions(id) ON DELETE CASCADE,
  event_date_id uuid NOT NULL
    REFERENCES public.event_dates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (checkout_session_id, event_date_id)
);

COMMENT ON TABLE public.ticket_checkout_session_event_dates IS
  'issue #2160 — the days the guest chose, as a property of the checkout '
  'session rather than of any cart line. Read once by the finalize base to '
  'distribute ticket_event_dates rows per the event''s multi_date_pricing_mode. '
  'Service-role only.';

ALTER TABLE public.ticket_checkout_session_event_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticket_checkout_session_event_dates
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ticket_checkout_session_event_dates TO service_role;

-- §A.7 — THE PRICING MODE IS SNAPSHOTTED ONTO THE SESSION AT CREATE.
--
-- ⚠️  THIS CLOSES A REAL, REPRODUCED MONEY BUG. Without it the mode is read
-- TWICE and independently: once at create-session (where it sets the
-- multiplier that PRICES and SIZES the reservation) and again at finalize
-- (where it decides how entitlement rows are distributed). Nothing carried the
-- value between them, so an organiser flipping the mode while a guest was in
-- checkout produced a reservation priced under one rule and issued under the
-- other:
--
--   all_days -> per_day mid-session: the guest is quoted ONE price for BOTH
--     days, pays it, and receives ONE pass with ONE entitlement row. At the
--     day-2 door they paid for, the scanner says `event_ended`.
--   per_day -> all_days mid-session: the guest pays for TWO days and receives
--     TWO passes EACH admitting BOTH days — four admissions sold as two, with
--     `quantity_total` decremented by 2 for 4 bodies in the room.
--
-- THE LOCK CANNOT COVER THIS, and it is important to say why rather than
-- assume it does: `events_multi_date_pricing_mode_locked` fires on
-- `EXISTS(tickets … status IN ('valid','used','transferred'))`, and an
-- IN-FLIGHT session has minted no ticket yet. The flip is therefore PERMITTED
-- during exactly the window in which it does damage, and once the guest's
-- ticket mints the lock engages and the damage cannot be undone. §5's
-- guarantee holds only AFTER issuance; this column is what covers the window
-- before it.
--
-- THE SHAPE IS NOT INVENTED. `ticket_checkout_sessions` already snapshots
-- policy-at-create for precisely this reason —
-- `checkout_access_mode_snapshot`, `checkout_access_restrictive_epoch_snapshot`
-- and their siblings (#2101). This is the same pattern, one column wider.
--
-- NULLABLE, and NULL means "created before this column existed": the finalize
-- base falls back to reading `events` exactly as it did, so a session already
-- in flight at deploy finalizes rather than failing. New sessions always carry
-- it.
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS multi_date_pricing_mode_snapshot text;

COMMENT ON COLUMN public.ticket_checkout_sessions.multi_date_pricing_mode_snapshot IS
  'issue #2160 — the event''s multi_date_pricing_mode AS AT SESSION CREATE. The '
  'session is priced and sized under this value, so finalize MUST mint under the '
  'same one: reading events again at finalize lets an organiser flip the mode '
  'mid-checkout and issue a pass that does not match what the guest paid for. '
  'The lock cannot prevent that flip because an in-flight session holds no '
  'ticket yet. NULL only for sessions created before this column existed.';

-- §A.6 — THE LOCK. Enforced in the database, not the wizard.
--
-- A trigger rather than an RPC-level check because it is fail-closed against
-- EVERY write path — the alternative is to enumerate them and be right about
-- all of them.
--
-- The predicate is `status IN ('valid','used','transferred')`, which is exactly
-- the set capacity already treats as consumed (…1929…:436). A `void` or
-- `refunded` ticket is not a live entitlement, so an event whose only sales
-- were fully refunded may still switch.
--
-- After the first sale the flip is refused, and NOTHING happens to
-- already-issued passes — because nothing CAN happen. That is the point of the
-- lock, and it is why the wizard warns before the first sale.
CREATE OR REPLACE FUNCTION public.issue_2160_assert_pricing_mode_unlocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.event_id = OLD.id
       AND t.status IN ('valid', 'used', 'transferred')
  ) THEN
    RAISE EXCEPTION 'multi_date_pricing_mode_locked';
  END IF;
  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.issue_2160_assert_pricing_mode_unlocked() IS
  'issue #2160 — refuses a change to events.multi_date_pricing_mode once the '
  'event holds a live ticket (valid/used/transferred — the same set capacity '
  'treats as consumed). Fail-closed against every write path.';

DROP TRIGGER IF EXISTS events_multi_date_pricing_mode_locked ON public.events;
CREATE TRIGGER events_multi_date_pricing_mode_locked
  BEFORE UPDATE OF multi_date_pricing_mode ON public.events
  FOR EACH ROW
  WHEN (NEW.multi_date_pricing_mode IS DISTINCT FROM OLD.multi_date_pricing_mode)
  EXECUTE FUNCTION public.issue_2160_assert_pricing_mode_unlocked();

-- ===========================================================================
-- §F — pg_direct_event_checkout_bundle: CARRY THE OCCURRENCES (SPEC §F / D-4,
--      closes #2161) AND THE MULTI-DATE SIGNAL.
--
-- Re-emitted VERBATIM from its latest definer,
-- 20270413001931_issue_1931_private_event_access.sql:974-1204, with THREE
-- named deltas marked inline (DELTA 1/2/3 of 3).
--
-- ⚠️  WHERE THE SPEC IS WRONG, AND IT MATTERS.
-- SPEC §0 D-4 and §F both assert that since #2117 this function's visibility
-- rule "is expressed only through pg_offering_visibility_gate(e.visibility,
-- e.deleted_at, 'direct')" at 20270415002117:341, and the §6 invariant table
-- says §F "re-emits the bundle INCLUDING its pg_offering_visibility_gate
-- clause". That is not so. #2117 never redefined this function; line 341 of
-- that migration is inside `pg_public_event_tier_allin`. Measured against the
-- full applied chain before this change:
--
--     SELECT pg_get_functiondef(oid) LIKE '%pg_offering_visibility_gate%'
--       FROM pg_proc WHERE proname='pg_direct_event_checkout_bundle';
--     -> f      (and the literal `visibility IN (...)` predicate -> t)
--
-- The spec's PREMISE about the current state was wrong; its DEMANDED END STATE
-- (I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE, and SPEC test T-14 "exactly
-- one pg_offering_visibility_gate call in the bundle; no local visibility
-- predicate") is unambiguous. DELTA 2 makes it true. The substitution is
-- behaviour-identical — `pg_offering_visibility_gate(v, d, 'direct')` returns
-- COALESCE(d IS NULL AND v IN ('public','hidden'), false) — and is proved so in
-- supabase/migrations/__tests__/issue_2160_unlisted_occurrences.test.sql, which
-- exercises public / hidden / private / deleted / draft through the real reader.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(
  p_event_id uuid DEFAULT NULL,
  p_brand_slug text DEFAULT NULL,
  p_event_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      -- issue #2160 DELTA 1 of 3. See the note above the appended keys.
      e.is_multi_date,
      e.is_recurring,
      e.multi_date_pricing_mode,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      (e.theme - 'business_draft'::text) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      COALESCE(
        ((e.theme #>> '{business_event,hideAddressUntilTicket}')::boolean),
        true
      ) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      -- issue #2160 DELTA 2 of 3 — ONE VISIBILITY AUTHORITY, NOT TWO.
      -- Behaviour-identical substitution: pg_offering_visibility_gate(v,d,'direct')
      -- is COALESCE(d IS NULL AND v IN ('public','hidden'), false), which is
      -- exactly the two literal clauses it replaces. See §F in the header for
      -- why this was NOT already here despite the SPEC saying it was.
      -- Fully qualified because this function is SET search_path = ''.
      -- The gate's EXECUTE grant is not consulted: this body is SECURITY
      -- DEFINER, so the executing role is the owner (#2117 documents this).
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'direct')
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text),
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json),
      -- ══ issue #2160 DELTA 3 of 3 — APPENDED LAST ═══════════════════════
      -- Appended after every pre-existing key so CREATE OR REPLACE preserves
      -- each existing key's name AND order (the house rule at …1931…:735-740).
      --
      -- `occurrences` (SPEC §F / D-4, closes #2161). The occurrence list now
      -- travels on the SAME SECURITY DEFINER reader that served the event, so
      -- ONE authority decides who may see this event and its schedule. The
      -- direct `.from("event_dates")` read in publicEventOccurrencesService is
      -- deleted in the same change: a guest surface must never read that table
      -- again (I-PROPOSED-2160-D). Costs zero extra round trips.
      --
      -- NO `ticketsRemaining` KEY, DELIBERATELY. `event_dates` has no capacity
      -- column and capacity is authored event-level on ticket_types.quantity_
      -- total, so there is no honest per-day remaining. Stamping the
      -- event-level number onto each day would claim per-day availability that
      -- does not exist (Constitution #9).
      'occurrences', (
        SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                 'id',        d.id,
                 'startAt',   d.start_at,
                 'endAt',     d.end_at,
                 'timezone',  d.timezone,
                 'isMaster',  d.is_master
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
      ),
      -- THE MULTI-DATE SIGNAL. Without these two keys the day chooser is
      -- UNREACHABLE, and it was: `detailFromDirectBundle` hard-codes
      -- `is_multi_date: false`, this bundle is the FIRST reader consulted by
      -- both getPublicEventBySlug and getPublicEventById, and the bundle
      -- carried no multi-date key — so `asWhenMode` resolved every
      -- bundle-served ticketed event to 'single' and #2135's chooser never
      -- mounted, on PUBLIC events as well as unlisted ones. #2161 diagnosed
      -- this as "works for public, silently empty for unlisted"; measured on
      -- the full migration chain, it worked for neither. See the
      -- implementation report.
      --
      -- `isRecurring` rides along because the gate is `multi_date` ONLY —
      -- deriving multi-date from `occurrences.length > 1` would sweep in
      -- recurring events, which #2145 keeps out of scope.
      'isMultiDate', COALESCE(ev.is_multi_date, false),
      'isRecurring', COALESCE(ev.is_recurring, false),
      -- The organiser's pricing choice, so the page can say "per day" or
      -- "for all days" BEFORE the guest sees a total (amendment §7).
      'multiDatePricingMode', COALESCE(ev.multi_date_pricing_mode, 'per_day')
    ) END
  FROM ev;
$function$;

COMMENT ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text) IS
  'Issue #1929 exact-key public/hidden standard-event bundle; non-enumerable and NULL on denial; contains no authoring or management fields. issue #2160: additionally carries `occurrences` (every event_dates row, chronological) plus `isMultiDate`, `isRecurring` and `multiDatePricingMode`, so a guest surface never reads public.event_dates directly (I-PROPOSED-2160-D) and the day chooser is reachable on unlisted events. Visibility is decided by pg_offering_visibility_gate(…, ''direct'') and nowhere else (I-PROPOSED-2117).';
REVOKE ALL ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text) TO anon, authenticated, service_role;

-- ===========================================================================
-- §B — issue_1930_ticket_checkout_create_session_base: THE CHOSEN DAY SET,
--      THE PER-MODE MULTIPLIER, AND THE CAPACITY AGGREGATION.
--
-- Re-emitted VERBATIM from the body the #1930 rename captured
-- (20270324001929_issue_1929_hidden_direct_checkout.sql:240-719 — nothing has
-- redefined the base since; 1931 / 2101 / 2150 replace only the WRAPPER), with
-- SIX named deltas marked inline (DELTA 1..6 of 6). Currency mixing (#1014),
-- trip installments (#1174), the terminal-session tombstone, the in-flight
-- short-circuit and every grant are copied byte-for-byte.
--
-- ⚠️  THE SIGNATURE WIDENS, SO THE OLD ONE IS DROPPED FIRST.
-- The spec (SPEC §4.1 §B, amendment §1) requires create-session to know the
-- chosen day set: it applies the per-mode multiplier to the stored line
-- quantity, which is what makes pricing AND capacity correct in both modes.
-- Neither the SPEC nor the amendment names the parameter — this is the gap I
-- filled: a 12th parameter `p_event_date_ids uuid[] DEFAULT NULL`.
-- CREATE OR REPLACE cannot widen a signature, and leaving the 11-arg overload
-- in place would make an 11-argument call AMBIGUOUS rather than resolving to
-- the default, so the old signature is dropped explicitly.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text);

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto',
  -- ══ issue #2160 DELTA 1 of 6 — THE CHOSEN DAY SET ═════════════════════
  -- The day set is a property of the SESSION, expressed once, NOT of any
  -- cart line (amendment §1). `p_lines` keeps its exact wire shape, so
  -- order_line_items.total_cents = quantity x unit_price_cents holds in
  -- every row in BOTH pricing modes. A per-line day cannot do that: under
  -- `all_days` it would either charge N x or need N-1 lines priced at zero.
  --
  -- DEFAULT NULL, and NULL/empty means "no day chosen" — which is every
  -- single-date event, every experience, every trip, every RSVP and every
  -- caller that has not been redeployed. On that path every line below is
  -- byte-identical to the pre-#2160 body.
  p_event_date_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- ══ issue #2160 DELTA 3 of 6 — VALIDATE THE DAY SET, READ THE MODE ════
  -- Distinct, ordered by start_at, and every id must be an occurrence OF
  -- THIS EVENT that has not already ended. A day the guest cannot attend is
  -- never allowed to become an entitlement.
  --
  -- DELETE THIS BLOCK and a guest can mint a pass for another event's
  -- occurrence, or for a day that is already over.
  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids, 1) > 0 THEN
    SELECT ARRAY(
             SELECT d.id FROM public.event_dates d
              WHERE d.event_id = p_event_id
                AND d.id = ANY (p_event_date_ids)
              ORDER BY d.start_at, d.id
           )
      INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids, 1), 0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) AS x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_dates d
                WHERE d.id = ANY (v_day_ids) AND d.end_at <= now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count := COALESCE(array_length(v_day_ids, 1), 0);
  END IF;

  -- The organiser's choice. Read ONCE, here, so the whole function agrees.
  SELECT COALESCE(e.multi_date_pricing_mode, 'per_day')
    INTO v_pricing_mode
    FROM public.events e WHERE e.id = p_event_id;

  -- THE ONE MULTIPLIER, APPLIED IN ONE PLACE.
  --   per_day , D days -> D  (D admissions, D passes, D units of capacity)
  --   all_days, D days -> 1  (one pass sold once)
  --   no days chosen    -> 1  (byte-identical to pre-#2160)
  -- Because it multiplies the stored line QUANTITY, pricing, capacity and
  -- the mint loop all see the same number with no special-casing anywhere
  -- downstream (amendment §1 and §8).
  IF v_day_count > 0 AND v_pricing_mode = 'per_day' THEN
    v_day_multiplier := v_day_count;
  END IF;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
    v_qty := v_qty_raw;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    -- ══ issue #2160 DELTA 4 of 6 — THE PER-DAY MULTIPLIER ═══════════════
    -- Applied AFTER min_purchase_qty / max_purchase_qty, which stay per LINE
    -- and therefore mean "per day" — an organiser capping a guest at 4
    -- tickets means 4 per day, not 4 across a three-day festival. Applied
    -- BEFORE capacity and pricing, which must both see the real number of
    -- admissions. v_day_multiplier is 1 on every pre-#2160 path.
    v_qty := v_qty_raw * v_day_multiplier;

    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      SELECT COUNT(*)
        INTO v_sold
        FROM public.tickets t
       WHERE t.ticket_type_id = v_ticket_type.id
         AND t.status IN ('valid', 'used', 'transferred');

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- ---------------- Pass 2: per-line installment math (META-ORCH-1174 B1). ----------------
  -- For trips only, walk the BUILT line items (v_items carries the per-line
  -- totals). For each line, look up its package's tier_metadata.installments.
  -- A line with a plan (and not opted to pay-full) contributes its OWN deposit
  -- to "due today" + its OWN installment entries to the union; a line without a
  -- plan contributes its full total to "due today". The union is then re-
  -- numbered ordinal 1..M sorted by dueAt.
  --
  -- ORCH-0915 opt-out: p_payment_plan_choice='full' ⇒ NO line installments at
  -- all (every line pays full now). This is the session-wide pay-in-full path.
  IF v_is_trip AND p_payment_plan_choice <> 'full' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_total := (v_line ->> 'totalCents')::bigint;
      v_tier_metadata := NULL;

      SELECT tpt.tier_metadata
        INTO v_tier_metadata
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = p_event_id
         AND tpt.ticket_type_id = (v_line ->> 'ticketTypeId')::uuid;

      v_installments_input := CASE
        WHEN v_tier_metadata IS NOT NULL THEN v_tier_metadata -> 'installments'
        ELSE NULL
      END;

      IF v_installments_input IS NOT NULL
         AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- This package carries a payment plan → compute its per-line schedule.
        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        -- First pass over THIS line's installments: validate + accumulate pct.
        v_pct_sum := v_deposit_pct;
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
        END LOOP;

        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Second pass: amounts scaled by THIS LINE's total, last-absorbs-rounding.
        v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint;
        v_line_running := 0;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint;
            v_line_running := v_line_running + v_inst_amount;
          ELSE
            v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          -- Append to the UNION with a sortable dueAt (ordinal re-numbered below).
          v_unioned := v_unioned || jsonb_build_array(jsonb_build_object(
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sourceTicketTypeId', (v_line ->> 'ticketTypeId'),
            'sourceOrdinal', v_inst_ord
          ));
        END LOOP;

        v_due_today_cents := v_due_today_cents + v_line_deposit_cents;
        v_any_installments := true;
      ELSE
        -- No plan on this package → its full total is due today.
        v_due_today_cents := v_due_today_cents + v_line_total;
      END IF;
    END LOOP;
  END IF;

  -- ---------------- Finalize the schedule + the deposit override. ----------------
  -- When at least one line produced installments, override v_total to the summed
  -- "due today" (Σ deposits + Σ non-plan fulls) and build the unioned schedule
  -- with sequential ordinals 1..M sorted by dueAt (then stable source order). The
  -- persisted shape is byte-identical to the single-line ORCH-0869 schedule.
  IF v_any_installments THEN
    v_total := v_due_today_cents::integer;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'ordinal', rn,
               'pct', (elem ->> 'pct')::numeric,
               'amountCents', (elem ->> 'amountCents')::bigint,
               'dueAt', elem ->> 'dueAt'
             )
             ORDER BY rn
           ), '[]'::jsonb)
      INTO v_unioned
      FROM (
        SELECT elem,
               row_number() OVER (
                 ORDER BY (elem ->> 'dueAt') ASC, (elem ->> 'sourceOrdinal')::int ASC
               ) AS rn
        FROM jsonb_array_elements(v_unioned) AS elem
      ) ranked;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END,
    v_pricing_mode
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[])
  TO service_role;

COMMENT ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[]) IS
  'issue #2160 — accepts the guest''s chosen day set as a session-level property. '
  'Applies ONE multiplier (per_day: D, all_days: 1, no days: 1) to the stored line '
  'quantity, so pricing, capacity and the mint loop all read the same number. '
  'Capacity now aggregates the submitted quantity per ticket_type across the WHOLE '
  'cart (I-PROPOSED-2160-C). With p_event_date_ids NULL or empty every path is '
  'byte-identical to the pre-#2160 body.';

-- ===========================================================================
-- §B2 — biz_ticket_checkout_create_session (the WRAPPER).
--
-- Re-emitted VERBATIM from 20270419002150_issue_2150_free_resubmit_idempotent
-- .sql:158-358 with TWO deltas: the 12th parameter, and forwarding it.
--
-- ⚠️  #2150 IS CARRIED FORWARD IN FULL, DELIBERATELY.
-- This function is the LATEST definer of the create-session wrapper once this
-- migration lands, and BOTH `orch-0791-checkout-session-never-reused-post-
-- terminal.mjs` and `issue-2150-free-completed-session-returned-not-tombstoned
-- .mjs` resolve "latest definer" by highest filename prefix and assert against
-- THAT file. Re-emitting without the #2150 exemption block would silently
-- delete the fix AND turn its gate red. The #2150 migration's own header
-- anticipated this re-emit; the exemption block below is byte-identical to it.
--
-- The #2150 property also still holds under multi-day, and is strengthened by
-- it: the day set is a segment of `checkoutIdempotencyKey`, so day-1 and
-- day-1+2 selections by the same guest derive DIFFERENT keys and are two
-- legitimately distinct reservations rather than two collisions. An IDENTICAL
-- resubmit still lands on the same key and is still handed the existing order
-- back — which under multi-day prevents 2 orders x 2 days = 4 tickets and two
-- confirmation emails.
--
-- No code path in this issue relies on a terminal session being tombstoned and
-- re-minted to create a second-day reservation (SPEC §5 constraint 1).
-- ===========================================================================

DROP FUNCTION IF EXISTS public.biz_ticket_checkout_create_session(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text);

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,p_buyer_user_id uuid,p_buyer_name text,p_buyer_email text,
  p_buyer_phone_e164 text,p_marketing_opt_in boolean,p_lines jsonb,
  p_idempotency_key text,p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,p_payment_plan_choice text DEFAULT 'auto',
  -- issue #2160 DELTA 1 of 2 — the chosen day set, passed straight through to
  -- the base. The wrapper does not interpret it; the base owns validation, the
  -- pricing mode and the multiplier. NULL/empty => every path below and in the
  -- base is byte-identical to #2150.
  p_event_date_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_decision text;
  v_replay_decision text;
  v_snapshot jsonb;
  v_mode text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- #2101 — fresh decision BEFORE the idempotency replay owner.
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, p_buyer_user_id);
  IF v_decision='sign_in_required' THEN
    RAISE EXCEPTION 'checkout_sign_in_required';
  END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN
    RAISE EXCEPTION 'checkout_restricted';
  END IF;
  v_snapshot := public.issue_2101_current_access_snapshot(p_event_id,p_buyer_user_id);
  v_mode := v_snapshot->>'mode';

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key;

  IF FOUND THEN
    -- ═══════════════════════════════════════════════════════════════════════
    -- issue #2150 — A COMPLETED **FREE** RESERVATION IS RETURNED, NOT REMINTED.
    --
    -- This block is evaluated BEFORE the ORCH-0791 terminal tombstone and
    -- before the ORCH-0829-B D-1 expiry tombstone, and it is the ONLY thing
    -- that changed in this function. Every conjunct is load-bearing:
    --
    --   status='free_completed'  the only status `biz_ticket_checkout_finalize`
    --                            assigns when `total_cents = 0`.
    --   total_cents = 0          independent proof this carried NO money, so
    --                            the paid arm cannot enter here even if a
    --                            status were corrupted. THIS is the conjunct
    --                            that scopes the change to the zero-total case.
    --   order_id IS NOT NULL     there is something to hand back.
    --   revoked_at IS NULL       the sale was not revoked (#2079 / #1930).
    --   buyer identity matches   an anonymous guest is (NULL,NULL) and matches
    --                            itself; a DIFFERENT signed-in user presenting
    --                            the same derived key falls through to today's
    --                            behaviour rather than being handed someone
    --                            else's passes.
    --   a live ticket exists     a cancelled / refunded / voided reservation is
    --                            NOT a reservation the guest still holds, so it
    --                            falls through and they can re-reserve.
    --
    -- On a match the guest's ORIGINAL session is returned untouched: the key is
    -- NOT renamed, no row is inserted, and `ticket-checkout-create` answers
    -- with that same order's already-issued tickets — one order, one ticket,
    -- one confirmation email and one SMS, however many times they submit.
    -- ═══════════════════════════════════════════════════════════════════════
    IF v_existing.status='free_completed'
       AND COALESCE(v_existing.total_cents,0)=0
       AND v_existing.order_id IS NOT NULL
       AND v_existing.revoked_at IS NULL
       AND v_existing.buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
       AND EXISTS(SELECT 1 FROM public.tickets t
                   WHERE t.order_id=v_existing.order_id
                     AND t.status IN ('valid','used','transferred')) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;

    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key=idempotency_key || ':tombstone:' || id::text,
             status=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at=now()
       WHERE id=v_existing.id;
    ELSE
      v_replay_decision := public.issue_2101_ticket_checkout_access_decision(
        p_event_id, v_existing.buyer_user_id,
        v_existing.checkout_access_mode_snapshot,
        v_existing.checkout_access_restrictive_epoch_snapshot,
        v_existing.checkout_access_membership_id_snapshot,
        v_existing.checkout_access_membership_epoch_snapshot);
      IF v_replay_decision NOT IN ('allowed_unrestricted','allowed_named')
         OR (v_mode='named_buyers'
             AND v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
        RAISE EXCEPTION 'checkout_restricted';
      END IF;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;
  END IF;

  -- issue #2160 DELTA 2 of 2 — forward the day set. NOTHING ELSE IN THIS
  -- FUNCTION CHANGED: the #2150 free-completed exemption above, the ORCH-0791
  -- terminal tombstone, the ORCH-0829-B expiry tombstone, the #2101 fresh
  -- decision, the event -> brand lock order and the access snapshot write-back
  -- are byte-preserved from 20270419002150:158-358.
  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice,p_event_date_ids);

  v_session_id := (v_result->>'checkoutSessionId')::uuid;
  IF v_session_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_sessions SET
      checkout_access_mode_snapshot=v_mode,
      checkout_access_restrictive_epoch_snapshot=
        COALESCE((v_snapshot->>'restrictiveEpoch')::bigint,0),
      checkout_access_membership_id_snapshot=
        NULLIF(v_snapshot->>'membershipId','')::uuid,
      checkout_access_membership_epoch_snapshot=
        NULLIF(v_snapshot->>'membershipEpoch','')::bigint
    WHERE id=v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId',v_result->'checkoutSessionId',
    'eventId',v_result->'eventId',
    'brandId',v_result->'brandId',
    'status',v_result->'status',
    'totalCents',v_result->'totalCents',
    'subtotalCents',v_result->'subtotalCents',
    'currency',v_result->'currency',
    'stripeAccountId',v_result->'stripeAccountId',
    'orderId',v_result->'orderId',
    'items',v_result->'items',
    'lineItems',v_result->'lineItems',
    'installmentSchedule',v_result->'installmentSchedule'
  );
END $function$;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[]) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[]) IS
  '#2150: a COMPLETED ZERO-TOTAL (free) session is returned as-is instead of being '
  'tombstoned, so a guest resubmitting an identical free reservation gets their '
  'existing order back rather than a duplicate order, ticket and confirmation. '
  'ORCH-0791 terminal tombstoning is unchanged for paid_completed / failed / expired '
  'and for the ORCH-0829-B D-1 past-expiry case: an expired or failed provider '
  'session must remain re-creatable. #2160: additionally forwards the guest''s '
  'chosen day set to the base, which owns validation, the pricing mode and the '
  'per-mode multiplier.';

-- ===========================================================================
-- §C — issue_1930_ticket_session_authorized: AUTHORISE EVERY CHOSEN DAY.
-- Re-emitted VERBATIM from 20270414002101:971-1028 with ONE appended clause.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      OR (NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  TO service_role;

-- ===========================================================================
-- §D — issue_1930_ticket_checkout_finalize_base: MINT THE ENTITLEMENTS.
--
-- Re-emitted VERBATIM from the body the #1930 rename captured
-- (20261117000001_orch_1188_finalize_persist_event_date_id.sql:30-335 — 2079 /
-- 2101 / 2136 replace only the WRAPPER), with FOUR named deltas.
--
-- THE ORDER INSERT IS **NOT** CHANGED. `orders.event_date_id` keeps reading
-- `NULLIF(v_session.metadata->>'event_date_id','')::uuid`, into which the edge
-- function writes the ANCHOR — the latest-ENDING day of the chosen set, in BOTH
-- modes (D-2, I-PROPOSED-2160-B). That is why the payout and refund control
-- planes are untouched by this issue: `resolve_payout_live_occurrence` and the
-- NG release maturity rule (`ed.end_at + interval '3 days' <= now()`) read that
-- column and now correctly hold a two-day order's money until the SECOND day
-- ends. Anchoring on the first day would release the organiser's money while
-- day 2 was still unattended and refundable.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,
  p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session record;
  v_item record;
  v_order_id uuid;
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  v_qr_token_pepper text;
  i integer;
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
  -- issue #2160 DELTA 1 of 4 — the pricing mode and the chosen day set.
  v_pricing_mode text := 'per_day';
  v_days uuid[];
  v_day_count integer := 0;
  v_day_id uuid;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  SELECT *
    INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    -- ORCH-0921: replace the silent early-return with compare-and-correct.
    -- When the second caller passes p_installment_plan_root=true AND the
    -- existing order row has installment_plan_root=false AND the session
    -- carries an installment_schedule AND zero order_installments rows exist,
    -- backfill the missing installment-plan state. Idempotent: re-running
    -- after the backfill is a no-op (the EXISTS checks prevent duplicate
    -- INSERTs and redundant UPDATEs).
    IF p_installment_plan_root
       AND v_session.installment_schedule IS NOT NULL
       AND p_stripe_customer_id_on_connected_account IS NOT NULL
       AND p_saved_payment_method_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.orders
         WHERE id = v_session.order_id
           AND installment_plan_root = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.order_installments
         WHERE order_id = v_session.order_id
       )
    THEN
      v_schedule := v_session.installment_schedule;
      v_inst_array := v_schedule -> 'installments';
      v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
      v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

      FOR v_idx IN 0 .. v_inst_count - 1 LOOP
        v_inst_item := v_inst_array -> v_idx;
        v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
        v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

        IF v_inst_amount <= 0 THEN
          RAISE EXCEPTION 'installment_amount_invalid';
        END IF;

        INSERT INTO public.order_installments (
          order_id, ordinal, amount_cents, currency, due_at, status
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled'
        );
      END LOOP;

      UPDATE public.orders
         SET installment_plan_root = true,
             stripe_customer_id_on_connected_account = p_stripe_customer_id_on_connected_account,
             saved_payment_method_id = p_saved_payment_method_id,
             updated_at = now()
       WHERE id = v_session.order_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status,
      -- issue #2160 DELTA 2 of 4 — the days THIS pass admits, so the client
      -- can label it without a second read. `[]` for every pre-#2160 pass,
      -- which is what "not day-scoped" looks like on the wire.
      'eventDateIds', COALESCE((
        SELECT jsonb_agg(ted.event_date_id ORDER BY ed.start_at, ed.id)
          FROM public.ticket_event_dates ted
          JOIN public.event_dates ed ON ed.id = ted.event_date_id
         WHERE ted.ticket_id = t.id), '[]'::jsonb)
    ) ORDER BY t.created_at), '[]'::jsonb)
      INTO v_tickets
      FROM public.tickets t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = v_session.order_id;

    RETURN jsonb_build_object(
      'orderId', v_session.order_id,
      'checkoutSessionId', v_session.id,
      'eventId', v_session.event_id,
      'paymentStatus', 'paid',
      'totalCents', v_session.total_cents,
      'currency', trim(v_session.currency),
      'tickets', v_tickets,
      'notificationStatus', 'queued',
      'installmentPlanRoot', (
        SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id
      )
    );
  END IF;

  IF v_session.total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id) IS NULL THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  v_order_id := gen_random_uuid();
  v_method := CASE
    WHEN v_session.total_cents = 0 THEN 'free'
    WHEN p_stripe_payment_method_type = 'apple_pay' THEN 'apple_pay'
    WHEN p_stripe_payment_method_type = 'google_pay' THEN 'google_pay'
    ELSE 'online_card'
  END;

  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id,
    pricing_breakdown,
    -- ORCH-1188 FIX 3b: persist the buyer's selected occurrence (NULL-safe).
    event_date_id
  ) VALUES (
    v_order_id, v_session.event_id, v_session.buyer_user_id, v_session.buyer_email,
    v_session.buyer_name, v_session.buyer_phone_e164, v_session.buyer_phone_e164,
    v_session.total_cents, v_session.currency, v_method, 'paid',
    COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id),
    p_stripe_charge_id, false,
    jsonb_build_object(
      'checkout_session_id', v_session.id,
      'marketing_opt_in', v_session.marketing_opt_in
    ),
    v_session.id, 'online_checkout', v_now, 'pending',
    COALESCE(v_session.stripe_application_fee_amount_cents, 0), v_session.stripe_account_id,
    p_stripe_payment_method_type,
    CASE WHEN v_session.total_cents = 0 THEN NULL ELSE 'succeeded' END,
    v_now, v_now,
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END,
    v_session.pricing_breakdown,
    -- ORCH-1188 FIX 3b: the occurrence the buyer booked, read from the session
    -- metadata jsonb (NULL for single-date events / no selection). NULLIF guards
    -- an empty string, ::uuid is NULL-safe on NULL input.
    NULLIF(v_session.metadata->>'event_date_id', '')::uuid
  );

  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;

    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;

      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled'
      );
    END LOOP;
  END IF;

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  -- ══ issue #2160 DELTA 3 of 4 — MINT UNDER THE MODE THE GUEST WAS QUOTED ═
  --
  -- THE SNAPSHOT, NOT A FRESH READ OF `events`. The session was PRICED and
  -- SIZED under `multi_date_pricing_mode_snapshot` at create; minting under a
  -- different value issues a pass that does not match what the guest paid for,
  -- in both directions (§A.7 states the two reproductions). The lock cannot
  -- prevent the flip, because an in-flight session holds no ticket yet — which
  -- is precisely the window this line closes.
  --
  -- DELETE THE SNAPSHOT READ and an organiser flipping the mode mid-checkout
  -- either takes a two-day guest's money and admits them on one day, or sells
  -- two admissions and lets four people in.
  --
  -- COALESCE to the live event ONLY for a session created before the column
  -- existed, so anything already in flight at deploy still finalizes.
  SELECT COALESCE(
           v_session.multi_date_pricing_mode_snapshot,
           (SELECT e.multi_date_pricing_mode FROM public.events e
             WHERE e.id = v_session.event_id),
           'per_day')
    INTO v_pricing_mode;

  -- The day set, ordered by start_at so the per_day round-robin below is
  -- deterministic and testable, not incidental.

  SELECT ARRAY(
           SELECT d.event_date_id
             FROM public.ticket_checkout_session_event_dates d
             JOIN public.event_dates ed ON ed.id = d.event_date_id
            WHERE d.checkout_session_id = v_session.id
            ORDER BY ed.start_at, ed.id
         ) INTO v_days;
  v_day_count := COALESCE(array_length(v_days, 1), 0);

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    FOR i IN 1..v_item.quantity LOOP
      v_ticket_id := gen_random_uuid();
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      v_token_hash := public.biz_ticket_checkout_token_hash(v_token, v_qr_token_pepper);
      v_qr := public.biz_ticket_checkout_qr_payload(
        v_ticket_id,
        v_token_hash,
        v_qr_token_pepper
      );

      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, qr_token_hash, status, approval_status, created_at,
        issued_at
      ) VALUES (
        v_ticket_id, v_order_id, v_item.ticket_type_id, v_session.event_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr, v_token_hash, 'valid', 'auto', v_now, v_now
      );

      -- ══ issue #2160 DELTA 4 of 4 — MINT THE ADMISSION ENTITLEMENTS ═════
      -- A pass admits the days it has rows for. The mint loop itself is
      -- UNCHANGED — `v_item.quantity` already carries the per-day multiplier
      -- from the create-session base (amendment §1), so all that differs
      -- between the modes is how the days are DISTRIBUTED.
      --
      --   zero days   -> NO ROWS. Not day-scoped. Today's any-occurrence
      --                  admission window, byte-identical, which is what
      --                  every pass issued before #2160 has and must keep.
      --   all_days    -> one row per chosen day on the SINGLE pass.
      --   per_day     -> ONE row, dealt round-robin across the ordered day
      --                  set: with quantity = qty x D this yields exactly
      --                  `qty` passes per day, deterministically.
      --
      -- DELETE THIS BLOCK and every pass mints with zero days, so a guest is
      -- admitted on a day they did not pay for and the whole issue reverts.
      IF v_day_count > 0 THEN
        IF v_pricing_mode = 'all_days' THEN
          FOREACH v_day_id IN ARRAY v_days LOOP
            INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
            VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_days[((i - 1) % v_day_count) + 1])
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid',
        'eventDateIds', CASE
          WHEN v_day_count = 0 THEN '[]'::jsonb
          WHEN v_pricing_mode = 'all_days' THEN to_jsonb(v_days)
          ELSE jsonb_build_array(v_days[((i - 1) % v_day_count) + 1])
        END
      ));
    END LOOP;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(
    v_session.event_id,
    v_session.buyer_user_id,
    v_order_id,
    v_session.buyer_email
  );

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES
    (
      v_order_id,
      v_session.event_id,
      'email',
      v_session.buyer_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('checkoutSessionId', v_session.id)
    ),
    (
      v_order_id,
      v_session.event_id,
      'sms',
      v_session.buyer_phone_e164,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('checkoutSessionId', v_session.id)
    )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.ticket_checkout_sessions
     SET order_id = v_order_id,
         status = CASE WHEN total_cents = 0 THEN 'free_completed' ELSE 'paid_completed' END,
         stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
         completed_at = v_now,
         updated_at = v_now
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued',
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean) TO service_role;

COMMENT ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean) IS
  'issue #2160 — mints public.ticket_event_dates entitlement rows alongside each '
  'ticket: none when the session carries no chosen day (byte-identical to '
  'pre-#2160), one row per day on a single pass under all_days, and one row per '
  'pass dealt round-robin across the ordered day set under per_day. The order '
  'INSERT is unchanged; orders.event_date_id remains the payout/refund anchor.';

-- ===========================================================================
-- §E — biz_ticket_scan: PER-DAY ADMISSION, AND RECORD THE ADMITTING DAY.
--
-- Re-emitted VERBATIM from 20260821000000_orch_1051_scanner_invite_flow.sql
-- :420-590. Scanner authorisation (event_scanners OR brand_team_members
-- .role='scanner'), the QR regex, the signature check, `wrong_event`, the
-- payment_status gate, the grace constants (120 min before / 360 min after) and
-- the FOR UPDATE OF t row lock are ALL unchanged.
--
-- THIS IS THE HIGHEST-RISK CHANGE IN THE ISSUE and it is not smuggled in: the
-- `status='used' -> duplicate` rung and the time-window block are replaced by a
-- new decision ladder plus a CONDITIONAL terminal write. If it is wrong, guests
-- are either turned away at a door they paid for or admitted twice.
--
-- NO NEW `scan_result` STRING. `not_yet_open` and `event_ended` are already in
-- the widened CHECK (20260528000001_orch_0793_widen_scan_result_check.sql) and
-- already rendered by the scanner UI, so "valid pass, wrong day" surfaces with
-- copy the client already handles.
--
-- CONCURRENCY. Two scanners hitting the same pass at the same instant are
-- serialised by the pre-existing `SELECT … FROM tickets … FOR UPDATE OF t`: the
-- second transaction blocks, then re-reads and finds the first's committed
-- `scan_events` success row, so it answers `duplicate`. The partial unique
-- index `scan_events_ticket_day_success_once` (§A.3) is belt-and-braces for the
-- case that lock is ever weakened.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.biz_ticket_scan(
  p_event_id uuid,
  p_qr_payload text,
  p_scanner_user_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  -- Grace constants — SPEC §3.1 Decision-1. Tuning outside [60min, 24h]
  -- requires SPEC review.
  c_grace_before constant interval := interval '120 minutes';
  c_grace_after  constant interval := interval '360 minutes';

  v_match text[];
  v_ticket_id uuid;
  v_token text;
  v_ticket record;
  v_scan_result text;
  v_scan_id uuid;
  v_qr_token_pepper text;
  v_scan_event_id uuid;
  v_has_event_dates boolean;
  v_in_window boolean;
  v_next_start timestamptz;
  v_last_end timestamptz;
  -- issue #2160 — the day ladder's locals.
  v_day_count integer := 0;      -- how many days this pass admits (0 = legacy)
  v_target_day uuid;             -- the occurrence being presented against NOW
  v_admitted_day uuid;           -- the occurrence actually admitted (success)
  v_all_days_consumed boolean;   -- no unadmitted day left after this one
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  -- ORCH-1051: permission gate now honors EITHER event-scoped scanner
  -- (event_scanners; preserved verbatim) OR brand-scoped scanner
  -- (brand_team_members.role='scanner', accepted, not removed) on the
  -- event's brand. Inline predicates per [[feedback-rls-returning-owner-gap]].
  IF NOT (
    EXISTS (
      SELECT 1
        FROM public.event_scanners es
       WHERE es.event_id = p_event_id
         AND es.user_id = p_scanner_user_id
         AND es.removed_at IS NULL
         AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
        INNER JOIN public.brand_team_members m ON m.brand_id = e.brand_id
       WHERE e.id = p_event_id
         AND m.user_id = p_scanner_user_id
         AND m.role = 'scanner'
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  v_match := regexp_match(
    p_qr_payload,
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$'
  );

  IF v_match IS NULL THEN
    v_scan_result := 'not_found';
  ELSE
    v_ticket_id := v_match[1]::uuid;
    v_token := v_match[2];

    SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name
      INTO v_ticket
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.id = v_ticket_id
     FOR UPDATE OF t;

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash, v_qr_token_pepper) THEN
      v_scan_result := 'not_found';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_scan_result := 'wrong_event';
    ELSIF v_ticket.payment_status <> 'paid' THEN
      v_scan_result := 'void';
    ELSE
      -- ══════════════════════════════════════════════════════════════════════
      -- issue #2160 — THE DAY LADDER. THIS IS THE SINGLE ENFORCEMENT SITE FOR
      -- "a pass is refused on a day it was not issued for, and a scan records
      -- which day it admitted". There must never be a second one.
      --
      -- A pass admits the days it has `ticket_event_dates` rows for. The ladder
      -- never asks which pricing mode minted it — per_day gives N passes with
      -- one row each, all_days gives one pass with N rows, and both are the
      -- same sentence here.
      --
      -- ⚠️  DELETE THE `v_day_count > 0` BRANCH and a guest who bought Saturday
      --     walks in on Sunday, and a Sunday guest is refused on Saturday.
      -- ══════════════════════════════════════════════════════════════════════
      SELECT count(*) INTO v_day_count
        FROM public.ticket_event_dates ted
       WHERE ted.ticket_id = v_ticket.id;

      IF v_day_count = 0 THEN
        -- ── LEGACY / SINGLE-DATE PATH. Byte-for-behaviour identical to
        --    pre-#2160, including the one-shot `status='used'` lifecycle. Every
        --    pass ever issued before this migration is on this path and stays
        --    on it: nothing is backfilled (§A.1).
        IF v_ticket.status = 'used' THEN
          v_scan_result := 'duplicate';
        ELSIF v_ticket.status <> 'valid' THEN
          v_scan_result := 'void';
        ELSE
          -- ORCH-0793 — event time-window check. Reads event_dates per
          -- I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. Multi-date events
          -- succeed if now() lies in ANY date row's grace-extended window
          -- (most-permissive policy — SPEC §3.1 Decision-2).
          SELECT EXISTS (
            SELECT 1 FROM public.event_dates ed
             WHERE ed.event_id = p_event_id
          ) INTO v_has_event_dates;

          IF NOT v_has_event_dates THEN
            v_scan_result := 'success';
          ELSE
            SELECT EXISTS (
              SELECT 1 FROM public.event_dates ed
               WHERE ed.event_id = p_event_id
                 AND now() BETWEEN (ed.start_at - c_grace_before)
                                AND (ed.end_at   + c_grace_after)
            ) INTO v_in_window;

            IF v_in_window THEN
              v_scan_result := 'success';
              -- issue #2160 — RECORD WHICH DAY ADMITTED THEM, even here. The
              -- pass is not day-scoped, but the SCAN is attributable: the
              -- occurrence whose window matched (earliest, deterministically).
              SELECT ed.id INTO v_admitted_day
                FROM public.event_dates ed
               WHERE ed.event_id = p_event_id
                 AND now() BETWEEN (ed.start_at - c_grace_before)
                                AND (ed.end_at   + c_grace_after)
               ORDER BY ed.start_at ASC, ed.id ASC
               LIMIT 1;
            ELSE
              SELECT MIN(ed.start_at) INTO v_next_start
                FROM public.event_dates ed
               WHERE ed.event_id = p_event_id
                 AND ed.start_at - c_grace_before > now();

              IF v_next_start IS NOT NULL THEN
                v_scan_result := 'not_yet_open';
              ELSE
                v_scan_result := 'event_ended';
                SELECT MAX(ed.end_at) INTO v_last_end
                  FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id;
              END IF;
            END IF;
          END IF;

          IF v_scan_result = 'success' THEN
            UPDATE public.tickets
               SET status = 'used',
                   used_at = now(),
                   used_by_scanner_id = p_scanner_user_id
             WHERE id = v_ticket.id;
          END IF;
        END IF;

      ELSE
        -- ── DAY-SCOPED PATH.
        --
        -- `status='used'` here means "FULLY CONSUMED", not "has been scanned":
        -- an all_days pass admitting 2 of its 3 days is still `valid`. The
        -- per-day admission truth is the `scan_events` ledger row, NOT the
        -- status — which is why the duplicate rung below queries the ledger
        -- rather than the status. `'transferred'` is admitted alongside
        -- `'valid'`/`'used'` nowhere: only valid/used are live here, matching
        -- the legacy rungs it replaces.
        --
        -- THE ROSTER NEEDS NO CHANGE, and that was verified rather than
        -- assumed: biz_guest_roster_project counts check-ins as
        -- `status='used' OR used_at IS NOT NULL`
        -- (20270319000873:304), and `used_at` is set on the FIRST admission
        -- below — so a partly-admitted multi-day guest already counts as
        -- checked in with that function completely untouched.
        --
        -- THE WRITE IS LEGAL, and that was verified rather than assumed:
        -- `biz_tickets_enforce_update` (baseline squash:3420-3477) forbids a
        -- scanner-role caller from touching `used_at` outside a strict
        -- valid -> used transition, which would have made this design illegal.
        -- Its FIRST statement is `IF auth.uid() IS NULL THEN RETURN NEW`, and
        -- this function is SECURITY DEFINER invoked by the `scan-ticket` edge
        -- function under the service key, so auth.uid() is NULL and the guard
        -- short-circuits. THE TRIGGER IS NOT MODIFIED.
        IF v_ticket.status NOT IN ('valid', 'used') THEN
          v_scan_result := 'void';
        ELSE
          -- WHICH DAY IS THIS PASS BEING PRESENTED AGAINST RIGHT NOW?
          -- Two occurrences of one event CAN overlap once the 8-hour combined
          -- grace is applied (a day ending 18:00 and the next starting 11:00 do
          -- not; a same-day double session could). The tie-break is specified,
          -- not left to LIMIT 1 without ORDER BY: prefer an occurrence with NO
          -- success row yet (false sorts before true), then the earliest
          -- start_at, then the id. If every in-window day is already admitted
          -- we deliberately land on the earliest so the answer is `duplicate`,
          -- never a silent second admission.
          SELECT ed.id INTO v_target_day
            FROM public.ticket_event_dates ted
            JOIN public.event_dates ed ON ed.id = ted.event_date_id
           WHERE ted.ticket_id = v_ticket.id
             AND now() BETWEEN (ed.start_at - c_grace_before)
                            AND (ed.end_at   + c_grace_after)
           ORDER BY EXISTS (
                      SELECT 1 FROM public.scan_events se
                       WHERE se.ticket_id = v_ticket.id
                         AND se.event_date_id = ed.id
                         AND se.scan_result = 'success'
                    ) ASC,
                    ed.start_at ASC, ed.id ASC
           LIMIT 1;

          IF v_target_day IS NULL THEN
            -- Not inside ANY of THIS PASS'S days. The window is the pass's own
            -- set, never the event's — that is the whole point of the issue.
            SELECT MIN(ed.start_at) INTO v_next_start
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
               AND ed.start_at - c_grace_before > now();

            IF v_next_start IS NOT NULL THEN
              v_scan_result := 'not_yet_open';
            ELSE
              v_scan_result := 'event_ended';
              SELECT MAX(ed.end_at) INTO v_last_end
                FROM public.ticket_event_dates ted
                JOIN public.event_dates ed ON ed.id = ted.event_date_id
               WHERE ted.ticket_id = v_ticket.id;
            END IF;

            -- Attributable refusal: record the day they were TRYING to use.
            SELECT ed.id INTO v_target_day
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
             ORDER BY ed.start_at ASC, ed.id ASC
             LIMIT 1;

          ELSIF EXISTS (
            SELECT 1 FROM public.scan_events se
             WHERE se.ticket_id = v_ticket.id
               AND se.event_date_id = v_target_day
               AND se.scan_result = 'success'
          ) THEN
            -- DEDUPE BY LEDGER, NOT BY STATUS. An all_days pass legitimately
            -- admits once PER DAY, so `status` cannot answer this question.
            -- DELETE THIS RUNG and a two-day pass admits twice on day one.
            v_scan_result := 'duplicate';

          ELSE
            v_scan_result := 'success';
            v_admitted_day := v_target_day;

            -- Is any day of this pass left unadmitted after this one?
            SELECT NOT EXISTS (
              SELECT 1 FROM public.ticket_event_dates ted
               WHERE ted.ticket_id = v_ticket.id
                 AND ted.event_date_id <> v_target_day
                 AND NOT EXISTS (
                   SELECT 1 FROM public.scan_events se
                    WHERE se.ticket_id = v_ticket.id
                      AND se.event_date_id = ted.event_date_id
                      AND se.scan_result = 'success')
            ) INTO v_all_days_consumed;

            UPDATE public.tickets
               SET used_at = COALESCE(used_at, now()),
                   used_by_scanner_id = p_scanner_user_id,
                   -- 'used' means FULLY CONSUMED. Flipped only when no
                   -- unadmitted day remains, so an all_days pass stays 'valid'
                   -- between day 1 and day 2 and can be scanned again.
                   status = CASE WHEN v_all_days_consumed THEN 'used' ELSE status END
             WHERE id = v_ticket.id;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    v_scan_event_id := CASE
      WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id
      ELSE p_event_id
    END;

    INSERT INTO public.scan_events (
      ticket_id, event_id, scanner_user_id, scan_result, client_offline,
      -- issue #2160 — WHICH DAY. On success it is the occurrence that
      -- admitted them (day-scoped AND legacy alike, SC-10); on a day-scoped
      -- refusal it is the day they presented against, so the refusal is
      -- attributable rather than anonymous. NULL on every non-day-scoped
      -- refusal and on not_found / wrong_event, where there is no honest day.
      event_date_id,
      synced_at, metadata
    ) VALUES (
      v_ticket_id, v_scan_event_id, p_scanner_user_id, v_scan_result, false,
      COALESCE(v_admitted_day, v_target_day), now(),
      jsonb_build_object(
        'source', 'scan-ticket',
        'requestedEventId', p_event_id,
        'buyerName', COALESCE(v_ticket.buyer_name, ''),
        'ticketName', COALESCE(v_ticket.ticket_name, ''),
        'nextStartAt', v_next_start,
        'lastEndAt', v_last_end
      )
    )
    RETURNING id INTO v_scan_id;
  END IF;

  RETURN jsonb_build_object(
    'result', v_scan_result,
    'scanId', v_scan_id,
    'ticketId', v_ticket_id,
    'orderId', v_ticket.order_id,
    'buyerName', v_ticket.buyer_name,
    'ticketName', v_ticket.ticket_name,
    'nextStartAt', v_next_start,
    'lastEndAt', v_last_end,
    -- issue #2160 — the day this scan admitted, for the scanner UI.
    'eventDateId', v_admitted_day
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) IS
  'ORCH-1051 + ORCH-0793 + issue #2160 — scanner RPC. Validates scanner auth (event_scanners OR brand_team_members.role=scanner), QR signature, payment, ticket status and event match, then resolves the day from the PASS''S OWN ticket_event_dates set: in-window and unadmitted -> success (recording the admitting day on scan_events), already admitted that day -> duplicate (deduped by the ledger, not by status, because an all_days pass admits once PER DAY), outside every day of its set -> not_yet_open / event_ended. A pass with ZERO rows keeps the pre-#2160 any-occurrence window and one-shot lifecycle verbatim. Invariants I-PROPOSED-BB, I-PROPOSED-BC, I-PROPOSED-2160-A, I-PROPOSED-2160-E.';

-- ===========================================================================
-- §G — VERIFICATION PROBES. Fail LOUDLY if the post-migration state drifted.
-- Style follows 20260821000000_orch_1051_scanner_invite_flow.sql:640-660.
-- ===========================================================================
DO $$
DECLARE v_def text;
BEGIN
  -- P1 — the two new tables exist, with RLS on (I-1860).
  IF to_regclass('public.ticket_event_dates') IS NULL THEN
    RAISE EXCEPTION 'issue #2160 probe: public.ticket_event_dates missing post-migration';
  END IF;
  IF to_regclass('public.ticket_checkout_session_event_dates') IS NULL THEN
    RAISE EXCEPTION 'issue #2160 probe: public.ticket_checkout_session_event_dates missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ticket_event_dates'::regclass) THEN
    RAISE EXCEPTION 'issue #2160 probe: RLS not enabled on ticket_event_dates (I-1860)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.ticket_checkout_session_event_dates'::regclass) THEN
    RAISE EXCEPTION 'issue #2160 probe: RLS not enabled on ticket_checkout_session_event_dates';
  END IF;

  -- P1b — ticket_event_dates is SELECT-only for clients. No client may grant
  -- itself a day.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='ticket_event_dates'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'issue #2160 probe: ticket_event_dates has a non-SELECT policy — writes must be service-role only';
  END IF;
  -- P1c — the session day table is service-role only: no client policy at all.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='ticket_checkout_session_event_dates') THEN
    RAISE EXCEPTION 'issue #2160 probe: ticket_checkout_session_event_dates must have NO policy (service-role only)';
  END IF;

  -- P2 — the pricing mode column, its CHECK, and the default that cannot reprice.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='events'
                    AND column_name='multi_date_pricing_mode'
                    AND is_nullable='NO') THEN
    RAISE EXCEPTION 'issue #2160 probe: events.multi_date_pricing_mode missing or nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='events_multi_date_pricing_mode_check') THEN
    RAISE EXCEPTION 'issue #2160 probe: events_multi_date_pricing_mode_check missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE multi_date_pricing_mode <> 'per_day') THEN
    RAISE EXCEPTION 'issue #2160 probe: an existing event is not per_day — the default must not reprice live inventory';
  END IF;

  -- P3 — scan_events.event_date_id + the admission-once index.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='scan_events'
                    AND column_name='event_date_id') THEN
    RAISE EXCEPTION 'issue #2160 probe: scan_events.event_date_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='scan_events_ticket_day_success_once') THEN
    RAISE EXCEPTION 'issue #2160 probe: scan_events_ticket_day_success_once missing';
  END IF;

  -- P4 — the lock trigger.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='events_multi_date_pricing_mode_locked'
                    AND tgrelid='public.events'::regclass) THEN
    RAISE EXCEPTION 'issue #2160 probe: the pricing-mode lock trigger is missing';
  END IF;

  -- P5 — the scan ladder branches on the PASS'S OWN day set.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='biz_ticket_scan';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'issue #2160 probe: biz_ticket_scan not found post-migration';
  END IF;
  IF position('ticket_event_dates' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: biz_ticket_scan does not read ticket_event_dates — a pass would admit on any day (I-PROPOSED-2160-E)';
  END IF;
  IF position('event_scanners' IN v_def) = 0
     OR position('brand_team_members' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: biz_ticket_scan lost an ORCH-1051 scanner auth path';
  END IF;
  IF position('event_dates' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: biz_ticket_scan lost its event_dates reference (ORCH-0793 regression)';
  END IF;

  -- P6 — capacity aggregates per ticket type across the whole cart.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_1930_ticket_checkout_create_session_base';
  IF position('v_cart_qty_for_type' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: the create-session base no longer aggregates capacity per ticket type (I-PROPOSED-2160-C)';
  END IF;
  IF position('ticket_checkout_session_event_dates' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: the create-session base no longer persists the chosen day set';
  END IF;

  -- P7 — the finalize base mints entitlements.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_1930_ticket_checkout_finalize_base';
  IF position('ticket_event_dates' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: the finalize base no longer mints ticket_event_dates rows';
  END IF;

  -- P8 — the bundle carries the occurrences, the multi-date signal and the ONE
  -- visibility authority.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pg_direct_event_checkout_bundle';
  IF position('occurrences' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: pg_direct_event_checkout_bundle lost the occurrences key (#2161 regression)';
  END IF;
  IF position('isMultiDate' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: pg_direct_event_checkout_bundle lost the multi-date signal — the day chooser becomes unreachable';
  END IF;
  IF position('pg_offering_visibility_gate' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: pg_direct_event_checkout_bundle no longer routes through the ONE visibility gate (I-PROPOSED-2117)';
  END IF;

  -- P9 — #2150 survived the wrapper re-emit.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='biz_ticket_checkout_create_session';
  IF position('free_completed' IN v_def) = 0
     OR position(':tombstone:' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: the #2150 exemption or the ORCH-0791 tombstone was lost in the wrapper re-emit';
  END IF;

  RAISE NOTICE 'issue #2160: all post-migration probes passed.';
END $$;

-- ===========================================================================
-- §H — biz_set_event_multi_date_pricing_mode: THE ORGANISER'S CONTROL.
--
-- WHY A NEW, SMALL RPC RATHER THAN A CHANGE TO THE PUBLISH PATH.
-- The mode has to be settable from the wizard, and the obvious route —
-- threading a key through `issue_1719_publish_event_with_poster`'s draft
-- payload — would mean re-emitting a live publish RPC for one column. That is
-- clobber risk on the path every organiser uses, in exchange for nothing: this
-- column is independent of everything publish writes, and its own trigger
-- already enforces the only rule it has. A dedicated additive function is
-- strictly smaller and cannot break publishing.
--
-- THE LOCK IS NOT RE-IMPLEMENTED HERE. `events_multi_date_pricing_mode_locked`
-- (§A.6) fires on the UPDATE below exactly as it fires on any other write path,
-- and raises `multi_date_pricing_mode_locked`. Re-checking it in this function
-- would be a SECOND enforcement site that can drift from the first.
--
-- Permission mirrors the wizard's own authority: the caller must be an accepted,
-- non-removed brand team member for the event's brand, or the brand's owning
-- account. Inline EXISTS predicates per feedback_rls_returning_owner_gap.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.biz_set_event_multi_date_pricing_mode(
  p_event_id uuid,
  p_mode text
) RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_brand uuid;
  v_mode text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('per_day', 'all_days') THEN
    RAISE EXCEPTION 'multi_date_pricing_mode_invalid';
  END IF;

  SELECT e.brand_id INTO v_brand
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1 FROM public.brands b
       WHERE b.id = v_brand AND b.deleted_at IS NULL AND b.account_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.brand_team_members m
       WHERE m.brand_id = v_brand
         AND m.user_id = auth.uid()
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
         AND m.role <> 'scanner'
    )
  ) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- The trigger is the ONLY lock. A no-op write is allowed through because the
  -- trigger's WHEN clause excludes it, so re-saving an unchanged mode on a
  -- sold-out event does not error at the organiser.
  UPDATE public.events
     SET multi_date_pricing_mode = p_mode,
         updated_at = now()
   WHERE id = p_event_id;

  SELECT multi_date_pricing_mode INTO v_mode
    FROM public.events WHERE id = p_event_id;
  RETURN v_mode;
END $function$;

REVOKE ALL ON FUNCTION public.biz_set_event_multi_date_pricing_mode(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_event_multi_date_pricing_mode(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.biz_set_event_multi_date_pricing_mode(uuid, text) IS
  'issue #2160 — the organiser''s per-event multi-day pricing choice. Additive: '
  'deliberately NOT threaded through the publish RPC, so publishing carries no '
  'clobber risk for one column. The lock lives ONLY in the '
  'events_multi_date_pricing_mode_locked trigger, which fires on this UPDATE '
  'like any other and raises multi_date_pricing_mode_locked once the event holds '
  'a live ticket.';

DO $$
BEGIN
  IF to_regprocedure('public.biz_set_event_multi_date_pricing_mode(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'issue #2160 probe: the organiser pricing-mode setter is missing — the column would be inert';
  END IF;
  RAISE NOTICE 'issue #2160 §H: organiser pricing-mode setter installed.';
END $$;

-- ===========================================================================
-- §I — issue_2150_free_replay_disclosure_authorized: FAIL CLOSED BY VALUE,
--      NOT BY THE CALLER REMEMBERING TO.
--
-- Re-emitted VERBATIM from 20270419002150_issue_2150_free_resubmit_idempotent
-- .sql:113-142 with ONE change: the signed-in comparison is wrapped in
-- COALESCE(..., false).
--
-- This does NOT weaken #2150 — it is strictly stronger, and both of that
-- issue's strict-grep gates pass against this file unchanged (the disclosure
-- function is still defined, and it still compares the presented buyer status
-- token hash against `ticket_checkout_sessions.buyer_status_token_hash`). The
-- possession requirement, the anonymous-token binding and the fail-closed
-- disclosure contract are all byte-preserved.
--
-- WHY IT IS RE-EMITTED HERE RATHER THAN EDITED IN PLACE: #2150's migration has
-- already been applied on the deploy path this branch builds on, so the fix has
-- to land as a new definition. This file becomes the latest definer.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.issue_2150_free_replay_disclosure_authorized(
  p_session_id uuid,
  p_buyer_user_id uuid,
  p_buyer_status_token_hash text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_session_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Only a completed, live, zero-total reservation is ever disclosable here.
  -- Mirrors the create-session exemption so the two cannot drift apart.
  IF v_session.status<>'free_completed'
     OR COALESCE(v_session.total_cents,0)<>0
     OR v_session.order_id IS NULL
     OR v_session.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Signed-in reservation: the authenticated identity IS the possession proof.
  --
  -- ⚠️  COALESCE IS LOAD-BEARING, NOT DEFENSIVE NOISE. `uuid = NULL` is NULL,
  -- not false, so an ANONYMOUS caller (p_buyer_user_id IS NULL) asking about a
  -- SIGNED-IN guest's reservation used to return NULL from a function whose
  -- return type says boolean. That is reachable: an attacker who knows a
  -- signed-in guest's email and phone derives the same idempotency key and
  -- submits the form anonymously.
  --
  -- It failed closed ONLY because the single caller happens to write
  -- `replayAuthorized !== true`. Any future caller writing the natural
  -- `IF NOT authorized THEN refuse` would fail OPEN, because `NOT NULL` is
  -- NULL and the refusal branch never runs — handing over another guest's
  -- order id and QR payloads. A three-valued answer to a two-valued question
  -- is the bug; the fix is to stop returning one, not to require every caller
  -- to remember.
  IF v_session.buyer_user_id IS NOT NULL THEN
    RETURN COALESCE(v_session.buyer_user_id = p_buyer_user_id, false);
  END IF;

  -- Anonymous reservation: the buyer status token must be PRESENTED, not known.
  RETURN v_session.buyer_status_token_hash IS NOT NULL
     AND COALESCE(p_buyer_status_token_hash,'')<>''
     AND v_session.buyer_status_token_hash = p_buyer_status_token_hash;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2150_free_replay_disclosure_authorized(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2150_free_replay_disclosure_authorized(uuid,uuid,text)
  TO service_role;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_2150_free_replay_disclosure_authorized';
  IF position('COALESCE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: the #2150 disclosure check can still return NULL — a future caller writing IF NOT authorized would fail OPEN';
  END IF;
  IF position('buyer_status_token_hash' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: the #2150 anonymous possession binding was lost in the re-emit';
  END IF;

  -- The pricing-mode snapshot: the column, the write, and the read.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='ticket_checkout_sessions'
                    AND column_name='multi_date_pricing_mode_snapshot') THEN
    RAISE EXCEPTION 'issue #2160 probe: ticket_checkout_sessions.multi_date_pricing_mode_snapshot missing';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_1930_ticket_checkout_create_session_base';
  IF position('multi_date_pricing_mode_snapshot' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: create-session does not snapshot the pricing mode';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_1930_ticket_checkout_finalize_base';
  IF position('v_session.multi_date_pricing_mode_snapshot' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2160 probe: finalize re-reads events.multi_date_pricing_mode instead of the session snapshot — an organiser can reprice a guest mid-checkout';
  END IF;

  RAISE NOTICE 'issue #2160 §I: disclosure fails closed by value; pricing mode is snapshotted.';
END $$;
