-- ===========================================================================
-- Issue #1529 — populate notification_outbox.country_code, and stop the SMS
-- market from being defaulted.
--
-- THE DEFECT. `public.notification_outbox.country_code` was born with four
-- readers and ZERO writers (commit 2f63604b6, 2026-06-20). Proven in
-- production 2026-08-03: `select count(*), count(country_code) from
-- public.notification_outbox` → 6 rows, 0 populated. None of the 13 INSERT
-- sites across the 7 producer functions names the column. Every row is
-- therefore NULL, `smsAdapter` turned NULL into "US" via `?? "US"`, and so
-- every Nigerian text was handed to Twilio under the US kill-switch while
-- `sms_live_enabled.ng` — the switch that is supposed to hold Nigeria back —
-- governed nothing at all. Nigeria was never actually dark.
--
-- THE AUTHORITY IS THE HANDSET, NOT THE VENUE. Production contains the case
-- that settles it (#1529 F-3): outbox row 0a0039d2 — a Miami Beach property,
-- a US-region brand, and a recipient holding the Nigerian phone
-- 2347084065203. Venue- or brand-derived country returns "US" there and is
-- exactly wrong. brands.country_code is populated on only 4 of 32 brands, so
-- it is unusable regardless. The row's own `contact` is definitionally the
-- destination handset, and SMS selects a PROVIDER (Termii delivers only to
-- Nigerian MSISDNs; Twilio's toll-free is the US/RoW route), so routing must
-- follow the handset.
--
-- SECOND, BLOCKING DEFECT FIXED HERE (#1529 F-2). Supabase stores
-- `auth.users.phone` WITHOUT a leading `+` — 51 of 51 production rows, zero
-- exceptions — while the dispatcher classifies a contact as a phone only when
-- it starts with `+` (`notifyV2.ts:90`). The Stay SMS producers inserted that
-- raw value verbatim, so every Stay text died as `skipped/no_contact` before
-- country was ever consulted. Fixing country ALONE would still produce no
-- Nigerian text. §3 below normalises the Stay contact to E.164; without it
-- this issue's own acceptance criterion is unreachable.
--
-- NULL MEANS "NOT DERIVABLE". IT NEVER MEANS "US". That conflation is the
-- entire bug. Anything that reintroduces a country default against these
-- helpers has restored #1529.
--
-- NO BACKFILL, DELIBERATELY (#1529 SPEC §5). All 6 existing rows are
-- `status='done'`; the column is read only on claim, and claim takes only
-- `pending`/`retry_wait`, so a backfilled value could never be read. 3 of the
-- 6 carry email contacts where country is genuinely underivable, so a partial
-- backfill would make "unknown" indistinguishable from "not yet done". And
-- retro-stamping a routing input that did not exist at dispatch time would
-- falsify the delivery record. `consent_records` is likewise untouched — it is
-- an append-only legal record, and a NULL that honestly says "not captured"
-- beats a retrofitted guess.
--
-- PARITY CONTRACT: `public.mingla_e164_country` / `public.mingla_e164_normalize`
-- below and `supabase/functions/_shared/e164Country.ts` MUST agree on every
-- input. Enforced behaviourally by the T-5 suites, which share one fixture
-- list so the two implementations cannot drift.
--
-- Monotonic prefix 20270211001529 — frontier across the anchor and all 11
-- sibling worktrees under ~/Desktop/mingla-orchs/*/supabase/migrations was
-- 20270210001516; nothing >= 20270211 exists.
--
-- Contract: issue #1529 SPEC (comment 5171290904) §4.1-§4.3, §5, §8 step 2.
-- Evidence: issue #1529 INVESTIGATION (comment 5171290016) F-1, F-2, F-3.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- §1 — Shared derivation helpers.
--
-- These replace three private, mutually inconsistent copies of "turn a phone
-- into a country" (#1529 F-7): marketing-send's module-private
-- `countryFromE164` (+1/+234 only), a verbatim DUPLICATE of it inside its own
-- test file (so the test asserted against its own copy and would pass even if
-- production were deleted — a textbook unfalsifiable test), and notifyV2's
-- `startsWith("+234") ? "NG" : "US"` ternary, which mislabels every country
-- that is neither US nor NG.
-- ---------------------------------------------------------------------------

-- Normalise a raw stored phone into strict E.164, or NULL if it cannot be.
--
-- THIS IS WHAT MAKES THE NIGERIAN STAY PATH WORK AT ALL (#1529 F-2 — Supabase
-- stores phones without the `+`; the dispatcher requires it). Steps:
--   1. Reject NULL/blank, and reject anything containing '@' — an email is not
--      a phone. Without that guard 'user2000@example.com' would strip down to
--      the digits '2000' and masquerade as the valid E.164 '+2000'.
--   2. Keep a leading '+', drop every other non-digit (spaces, dashes,
--      parentheses), then prepend '+' when the result is bare digits.
--   3. Return NULL unless the result is strict E.164.
CREATE OR REPLACE FUNCTION public.mingla_e164_normalize(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_raw    text;
  v_digits text;
  v_out    text;
BEGIN
  v_raw := pg_catalog.btrim(COALESCE(p_phone, ''));
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;
  -- An email is never a phone. Guarded BEFORE digit-stripping, because
  -- stripping would otherwise mine digits out of the local part.
  IF pg_catalog.strpos(v_raw, '@') > 0 THEN
    RETURN NULL;
  END IF;

  IF pg_catalog.left(v_raw, 1) = '+' THEN
    v_digits := pg_catalog.regexp_replace(
      pg_catalog.substr(v_raw, 2), '[^0-9]', '', 'g'
    );
  ELSE
    v_digits := pg_catalog.regexp_replace(v_raw, '[^0-9]', '', 'g');
  END IF;
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  v_out := '+' || v_digits;
  IF v_out ~ '^\+[1-9][0-9]{1,14}$' THEN
    RETURN v_out;
  END IF;
  RETURN NULL;
END;
$function$;

-- Derive the ISO-2 country of the RECIPIENT HANDSET from a contact value.
--
-- The calling-code table is deliberately BOUNDED to the countries with a live
-- SMS route plus those present in production data. An unmapped calling code
-- resolves to NULL ("we do not know"), never to a guess.
--
-- THIS IS THE INTENDED EXTENSION POINT: adding a country is one branch here,
-- one entry in the `CALLING_CODE_TO_ISO2` table in
-- supabase/functions/_shared/e164Country.ts, and one row in the T-5 parity
-- fixture block. Order matters — LONGEST PREFIX FIRST, so '+234' is tested
-- before any shorter prefix could shadow it.
--
-- '+1' → 'US' covers all of NANP. That is correct ROUTING (Twilio serves NANP)
-- and an accepted, documented imprecision for a Canadian recipient in the
-- consent audit, whose current alternative is NULL for everyone (#1529 SPEC
-- §11 Q1). Splitting NANP by area code is a registered follow-up, not this
-- issue.
--
-- WHAT BREAKS IF THIS IS UNDONE: every notification presents as a US
-- notification again, Nigerian texts return to Twilio under the US
-- kill-switch, and `consent_records.country_code` — the legal record of who
-- consented to what — goes back to being NULL on exactly the outbox-driven
-- rows (#1529 F-4: 5 of 149 rows NULL, every one of them `source='reservation'`).
CREATE OR REPLACE FUNCTION public.mingla_e164_country(p_contact text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_e164 text;
BEGIN
  v_e164 := public.mingla_e164_normalize(p_contact);
  IF v_e164 IS NULL THEN
    RETURN NULL;
  END IF;
  -- #1529 P3-1 — too few digits to be a reachable handset. '+234' is a calling
  -- code, not a phone number, and must not resolve to Nigeria; '+1800' likewise
  -- must not resolve to the US. The shortest real E.164 numbers total 7 digits
  -- (Saint Helena +290 XXXX, Niue +683 XXXX), so 7 is the conservative floor.
  -- Applied to COUNTRY derivation only — mingla_e164_normalize is unchanged.
  IF pg_catalog.length(v_e164) - 1 < 7 THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.left(v_e164, 4) = '+234' THEN RETURN 'NG'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+44'  THEN RETURN 'GB'; END IF;
  -- #1529 P2-1 — France is NOT hypothetical. TWO production auth.users rows
  -- carry a +33 handset (direct query, 2026-08-03: +1 26, +234 18, +44 3,
  -- +32 2, +33 2). The SPEC justified omitting it on the stated basis that the
  -- excluded population was "zero in production today"; that was false, and
  -- those two users would have failed closed with country_unresolved —
  -- permanent non-delivery by construction — where origin/main reached them
  -- over Twilio. Failing closed on a genuinely unknown code is correct;
  -- excluding real users is not.
  IF pg_catalog.left(v_e164, 3) = '+33'  THEN RETURN 'FR'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+32'  THEN RETURN 'BE'; END IF;
  IF pg_catalog.left(v_e164, 2) = '+1'   THEN RETURN 'US'; END IF;
  -- Unmapped calling code — honest unknown. NEVER default to a country.
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.mingla_e164_normalize(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mingla_e164_country(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mingla_e164_normalize(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mingla_e164_country(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mingla_e164_normalize(text) IS
  'Issue #1529 — normalise a raw stored phone to strict E.164 or NULL. '
  'Supabase stores auth.users.phone WITHOUT the leading + (51/51 rows in '
  'production); the notification dispatcher only treats a contact as a phone '
  'when it starts with +, so Stay SMS rows died as no_contact before country '
  'was consulted. Mirrored in _shared/e164Country.ts normalizeE164().';

COMMENT ON FUNCTION public.mingla_e164_country(text) IS
  'Issue #1529 — ISO-2 country of the RECIPIENT HANDSET derived from an E.164 '
  'contact. Bounded calling-code table (+234 NG, +44 GB, +32 BE, +1 US); any '
  'other prefix returns NULL. NULL means NOT DERIVABLE and NEVER means US — '
  'that conflation was the defect. Mirrored in _shared/e164Country.ts '
  'countryFromE164().';

COMMENT ON COLUMN public.notification_outbox.country_code IS
  'Issue #1529 — ISO-2 country of the RECIPIENT HANDSET, derived from this row''s own
   `contact` via public.mingla_e164_country(). Authority is the handset, NOT the venue
   or brand country (proven in #1529: a US venue notifying an owner on a Nigerian
   phone). NULL means NOT DERIVABLE (contact is an email, is absent, or its calling
   code is unmapped) — it NEVER means US. On rows created BEFORE this migration NULL
   instead means "never populated (pre-#1529)"; those rows are deliberately NOT
   backfilled, because the column is read only on claim and every one of them is
   already status=done. Consumed by notify-outbox-drain → notify-dispatch →
   consent_records.country_code (legal audit). SMS provider routing derives
   independently from the destination number in smsAdapter.';

-- ---------------------------------------------------------------------------
-- §2 — Producers A/B: reservation notify outbox.
--
-- Body reproduced VERBATIM from 20261119000000_orch_1195_reservation_confirm_
-- email_on_insert.sql (the latest definition; 20261110000002 is superseded).
-- The ONLY change is the added `country_code` column and its expression on
-- both INSERTs.
--
-- Derived from NEW.guest_phone_e164 DIRECTLY, not from the
-- COALESCE(guest_phone_e164, guest_email) contact expression: when a
-- reservation carries only an email the contact IS the email and the country
-- is correctly NULL, but reading the raw phone column is clearer about intent
-- and stays correct if the COALESCE order ever changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orch_1161_reservation_notify_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_category text;
  v_contact  text;
  v_idem     text;
BEGIN
  -- ORCH-1195 — INSERT path: the fee/table reservation is born 'confirmed' (no
  -- requested→confirmed UPDATE ever fires), so the buyer confirmation email MUST be
  -- enqueued here. Anon guests (consumer_user_id NULL) still get the transactional
  -- email — can_send short-circuits on null user_id and the contact resolves to the
  -- guest email/phone, exactly as the UPDATE path does.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);
      -- STABLE key (no timestamp): one confirmed email per reservation, and a
      -- later requested→confirmed UPDATE on the same row dedups to a no-op.
      v_idem := 'buyer_reservation_confirmed:' || NEW.id::text;

      INSERT INTO public.notification_outbox
        (category_key, user_id, contact, brand_id, payload, idempotency_key,
         country_code)
      VALUES (
        'buyer_reservation_confirmed',
        NEW.consumer_user_id,
        v_contact,
        NEW.brand_id,
        jsonb_build_object(
          'reservation_id',   NEW.id,
          'status',           NEW.status,
          'reserved_for',     NEW.reserved_for,
          'party_size',       NEW.party_size,
          'guest_name',       NEW.guest_name,
          'guest_phone_e164', NEW.guest_phone_e164,
          'guest_email',      NEW.guest_email
        ),
        v_idem,
        -- #1529 — recipient handset country. NULL when the reservation carries
        -- only an email; NULL never means US.
        public.mingla_e164_country(NEW.guest_phone_e164)
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- ── UPDATE path (UNCHANGED from ORCH-1161 §7.2) ──
  -- Only enqueue on a real change to status / table / time.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for THEN
    RETURN NEW;
  END IF;

  -- Map the transition to a category.
  IF NEW.status IN ('cancelled_by_guest','cancelled_by_venue')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_category := 'buyer_reservation_cancelled';
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN
    v_category := 'buyer_reservation_confirmed';
  ELSE
    v_category := 'buyer_reservation_changed';
  END IF;

  v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);

  -- For the requested→confirmed UPDATE use the SAME stable confirmed key so it
  -- dedups against the INSERT enqueue above; other transitions keep the per-instant
  -- key (a reservation can legitimately change/cancel more than once).
  IF v_category = 'buyer_reservation_confirmed' THEN
    v_idem := 'buyer_reservation_confirmed:' || NEW.id::text;
  ELSE
    v_idem := v_category || ':' || NEW.id::text || ':'
              || to_char(now(), 'YYYYMMDD"T"HH24MISSMS');
  END IF;

  INSERT INTO public.notification_outbox
    (category_key, user_id, contact, brand_id, payload, idempotency_key,
     country_code)
  VALUES (
    v_category,
    NEW.consumer_user_id,
    v_contact,
    NEW.brand_id,
    jsonb_build_object(
      'reservation_id', NEW.id,
      'status',         NEW.status,
      'reserved_for',   NEW.reserved_for,
      'party_size',     NEW.party_size,
      'guest_name',     NEW.guest_name,
      'guest_phone_e164', NEW.guest_phone_e164,
      'guest_email',    NEW.guest_email
    ),
    v_idem,
    -- #1529 — recipient handset country (see the INSERT branch above).
    public.mingla_e164_country(NEW.guest_phone_e164)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.orch_1161_reservation_notify_outbox() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orch_1161_reservation_notify_outbox() FROM anon;

-- ---------------------------------------------------------------------------
-- §3 — Producers C/D: event + reservation reminders.
--
-- Body reproduced VERBATIM from 20261112000000_orch_1161_subc_reminder_
-- enqueue.sql. The ONLY change is the added `country_code` column on both
-- INSERTs, derived from the same `u.contact` the row is addressed to. When
-- that contact is an email, mingla_e164_country returns NULL, which is the
-- correct honest answer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_notify_reminders_enqueue(
  p_lead_hours    int,
  p_lead_bucket   text,
  p_window_minutes int DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_low      timestamptz;
  v_high     timestamptz;
  v_inserted int := 0;
  v_n        int;
BEGIN
  IF p_lead_bucket NOT IN ('24h','2h') THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: invalid lead bucket %', p_lead_bucket;
  END IF;
  IF p_lead_hours IS NULL OR p_lead_hours <= 0 THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: lead hours must be positive (got %)', p_lead_hours;
  END IF;

  v_low  := now() + make_interval(hours => p_lead_hours)
                  - make_interval(mins  => p_window_minutes / 2.0);
  v_high := now() + make_interval(hours => p_lead_hours)
                  + make_interval(mins  => p_window_minutes / 2.0);

  -- 1. EVENT/trip/experience reminders → buyer of a PAID order on an upcoming date.
  --    Entity id for idempotency = order_id (one reminder per buyer-order per bucket).
  WITH upcoming AS (
    SELECT
      o.id              AS order_id,
      o.buyer_user_id   AS buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id        AS brand_id,
      e.title           AS event_title,
      ed.start_at       AS start_at
    FROM public.event_dates ed
    JOIN public.events e ON e.id = ed.event_id
    JOIN public.orders o ON o.event_id = e.id
    WHERE ed.start_at >= v_low
      AND ed.start_at <  v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled','live')
      AND o.payment_status = 'paid'
      AND (o.buyer_user_id IS NOT NULL OR o.buyer_email IS NOT NULL OR o.buyer_phone_e164 IS NOT NULL)
  ), ins AS (
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    SELECT
      'buyer_event_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_build_object(
        'order_id',    u.order_id,
        'event_title', u.event_title,
        'reserved_for', u.start_at,
        'lead_bucket', p_lead_bucket
      ),
      'buyer_event_reminder:' || u.order_id::text || ':' || p_lead_bucket,
      -- #1529 — recipient handset country; NULL when the contact is an email.
      public.mingla_e164_country(u.contact)
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  -- 2. RESERVATION reminders → upcoming CONFIRMED reservations only.
  --    Entity id for idempotency = reservation_id.
  WITH upcoming AS (
    SELECT
      r.id                AS reservation_id,
      r.consumer_user_id  AS buyer_user_id,
      COALESCE(r.guest_phone_e164, r.guest_email) AS contact,
      r.brand_id          AS brand_id,
      r.reserved_for      AS reserved_for,
      r.party_size        AS party_size,
      r.guest_name        AS guest_name
    FROM public.reservations r
    WHERE r.reserved_for >= v_low
      AND r.reserved_for <  v_high
      AND r.status = 'confirmed'
      AND (r.consumer_user_id IS NOT NULL OR r.guest_email IS NOT NULL OR r.guest_phone_e164 IS NOT NULL)
  ), ins AS (
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    SELECT
      'buyer_reservation_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_build_object(
        'reservation_id', u.reservation_id,
        'reserved_for',   u.reserved_for,
        'party_size',     u.party_size,
        'guest_name',     u.guest_name,
        'lead_bucket',    p_lead_bucket
      ),
      'buyer_reservation_reminder:' || u.reservation_id::text || ':' || p_lead_bucket,
      -- #1529 — recipient handset country; NULL when the contact is an email.
      public.mingla_e164_country(u.contact)
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §4 — Producers E/F/G: chip-in receipts.
--
-- Body reproduced VERBATIM from 20261223000000_orch_1298_chip_in_receipt_
-- enqueue.sql (20270104000000_orch_1392 only re-GRANTs; it does not redefine
-- the body). The ONLY change is the added `country_code` column on all three
-- INSERTs, written as an EXPLICIT NULL literal.
--
-- Why an explicit literal rather than omitting the column: these three
-- categories carry no phone recipient and are not in the SMS-eligible set, so
-- their country is genuinely underivable. Writing the literal — rather than
-- leaving the column out — is what makes the §9 T-2 producer audit meaningful,
-- because that audit asserts every producer has consciously decided what its
-- country is. An omitted column is indistinguishable from a forgotten one, and
-- a forgotten one is exactly how #1529 happened.
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
  -- ORCH-1298 — enqueue locals (declared but only used on the non-replay branch).
  v_event_title   text;
  v_guest_label   text;
  v_guest_email   text;
  v_guest_payload jsonb;
  v_host_payload  jsonb;
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
  -- ORCH-1298: because the enqueue below lives AFTER this guard, a replayed
  -- webhook enqueues NOTHING (SC-6 / T-4).
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

  -- =========================================================================
  -- ORCH-1298 — enqueue the guest gift-receipt + host gift-received rows.
  -- NON-REPLAY branch ONLY (the replay path early-returned above), so this runs
  -- EXACTLY ONCE per paid contribution, for BOTH rails (Stripe + Paystack call
  -- this same RPC). v_row still holds the pre-UPDATE snapshot; every field used
  -- here (id/event_id/brand_id/user_id/guest_name/guest_email/amount_cents/
  -- currency) is UNCHANGED by the UPDATE above, so the snapshot is correct.
  --
  -- FAIL-SOFT: the whole block is a nested BEGIN…EXCEPTION subtransaction so a
  -- notification failure NEVER rolls back the paid-flip (mirrors the
  -- "notifications are best-effort" posture of fireOrderFinalizeNotifications).
  -- Each INSERT is ON CONFLICT (idempotency_key) DO NOTHING (the outbox has a
  -- UNIQUE index on idempotency_key), so a concurrent/duplicate enqueue collapses.
  -- =========================================================================
  BEGIN
    v_event_title := (SELECT e.title FROM public.events e WHERE e.id = v_row.event_id);
    -- Guest display label for the HOST copy ("Someone chipped in …" when anon w/o name).
    v_guest_label := COALESCE(NULLIF(btrim(v_row.guest_name), ''), 'Someone');
    -- Reachable guest email: the raw guest_email (anon) OR the account email
    -- (logged-in guest whose guest_email is null). auth.users is schema-qualified
    -- (search_path excludes auth); this SECURITY DEFINER fn's owner can read it.
    v_guest_email := COALESCE(
      v_row.guest_email,
      (SELECT u.email FROM auth.users u WHERE u.id = v_row.user_id)
    );

    -- Payload carried to renderCategoryMessage (F-3): amount_cents + currency
    -- drive the currency-aware fmtAmount (§4.5). brand_name is injected by the
    -- outbox drain from brand_id, so it is NOT set here.
    v_guest_payload := jsonb_build_object(
      'contribution_id', v_row.id,
      'event_id',        v_row.event_id,
      'event_title',     v_event_title,
      'amount_cents',    v_row.amount_cents,
      'currency',        v_row.currency
    );
    v_host_payload := v_guest_payload || jsonb_build_object('guest_name', v_guest_label);

    -- (1) GUEST receipt — one row. contact = resolved email; user_id may be null
    --     (anon → dispatchAnon emails the raw contact) or set (logged-in →
    --     inapp+push+email).
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    VALUES (
      'buyer_contribution_receipt',
      v_row.user_id,
      v_guest_email,
      v_row.brand_id,
      v_guest_payload,
      'chip_in_receipt:' || v_row.id || ':guest',
      -- #1529 — email recipient, no phone: country is genuinely underivable.
      -- Explicit NULL, deliberately written, not omitted.
      NULL
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- (2) HOST push + in-app — one row PER accepted owner/admin/finance team
    --     member (v2 push targets a single user_id). contact=NULL → the email
    --     channel records skipped(no_contact) while business-app push + in-app
    --     fire. Roles match the LIVE brand-payments audience (BRAND_PAYMENTS_ROLES
    --     in _shared/stripeEdgeAuth.ts; post-ORCH-1047 the owner role is
    --     'brand_owner').
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    SELECT
      'business.rsvp_contribution_received',
      m.user_id,
      NULL,
      v_row.brand_id,
      v_host_payload,
      'chip_in_receipt:' || v_row.id || ':host:' || m.user_id,
      -- #1529 — push/in-app only, contact is NULL: no handset to derive from.
      NULL
    FROM public.brand_team_members m
    WHERE m.brand_id = v_row.brand_id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('brand_owner', 'brand_admin', 'finance_manager')
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- (3) HOST email — one row to the brand contact address (email leg; user_id
    --     NULL → dispatchAnon emails once, inapp/push skipped). Seth-requested
    --     addition beyond ticket-sale parity. FAIL-SOFT: skipped when
    --     brands.contact_email is null/blank (the host still gets push + in-app
    --     from (2)).
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    SELECT
      'business.rsvp_contribution_received',
      NULL,
      b.contact_email,
      v_row.brand_id,
      v_host_payload,
      'chip_in_receipt:' || v_row.id || ':host_email',
      -- #1529 — brand contact EMAIL, no phone: country is underivable.
      NULL
    FROM public.brands b
    WHERE b.id = v_row.brand_id
      AND b.contact_email IS NOT NULL
      AND btrim(b.contact_email) <> ''
    ON CONFLICT (idempotency_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Notifications are best-effort: swallow + log so the paid finalize commits.
    RAISE WARNING 'finalize_rsvp_contribution: chip-in receipt enqueue failed (contribution %): %',
      p_contribution_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'contribution_id', p_contribution_id,
    'status', 'paid'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- §5 — Producers H/I/J/K: Stay event fanout. THE NG-CRITICAL PATH.
--
-- Body reproduced VERBATIM from 20270131013816_issue_1389_stay_notifications_
-- and_sweep.sql with TWO changes, both required:
--
--   (a) `country_code` added to all four INSERTs. Email legs (H, J) write an
--       explicit NULL literal; SMS legs (I, K) derive from the normalised
--       handset.
--
--   (b) THE SMS CONTACT IS NORMALISED TO E.164 (#1529 F-2, blocking). These
--       producers previously inserted `auth.users.phone` verbatim, and Supabase
--       stores that WITHOUT the leading '+' (51/51 production rows). The
--       dispatcher's phone classifier is `c.startsWith("+")`, so every one of
--       these rows was dropped as `skipped/no_contact` before any provider was
--       chosen — production shows exactly this: outbox row 0a0039d2 carries
--       contact '2347084065203' and its delivery reads
--       channel=sms, status=skipped, failed_reason=no_contact.
--
--       The IS NOT NULL guards now test the NORMALISED value, so a phone that
--       cannot be normalised produces NO SMS row at all rather than a row that
--       is guaranteed to be dropped downstream. That is a behaviour
--       IMPROVEMENT, not a regression: today such a row is enqueued,
--       dispatched, and recorded as skipped/no_contact — pure noise in the
--       delivery ledger.
--
-- WHAT BREAKS IF (b) IS UNDONE: Nigeria goes back to being untestable. #1529's
-- acceptance criterion — "proven with a real NG-recipient row reaching the
-- Termii branch" — is unreachable while these producers emit plus-less
-- contacts, because the row never reaches provider selection at all.
--
-- NOTE: this function runs with `SET search_path = ''`, so every reference
-- must stay fully schema-qualified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1389_enqueue_stay_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_category text;
  v_staff_event boolean := false;
  v_payload jsonb;
  v_recipient record;
  -- #1529 — the normalised E.164 handset for the SMS legs (producers I and K).
  v_phone_e164 text;
BEGIN
  IF NOT public.issue_1389_flag_enabled('STAY_NOTIFICATIONS') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = NEW.group_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_category := CASE NEW.event_type
    WHEN 'stay_request_submitted' THEN 'stay_request_received'
    WHEN 'stay_request_approved' THEN 'stay_payment_required'
    WHEN 'stay_request_declined' THEN 'stay_request_declined'
    WHEN 'stay_reservation_confirmed' THEN 'stay_reservation_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'stay_reservation_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'stay_refund_state'
    WHEN 'stay_refund_attention_required'
      THEN 'stay_reconciliation_attention'
    WHEN 'stay_payment_late_refund_due'
      THEN 'stay_reconciliation_attention'
    ELSE NULL
  END;
  IF v_category IS NULL THEN
    RETURN NEW;
  END IF;
  v_staff_event := NEW.event_type IN (
    'stay_request_submitted',
    'stay_refund_attention_required',
    'stay_payment_late_refund_due'
  );

  v_payload := jsonb_build_object(
    'stay_group_id', v_group.id,
    'public_reference', v_group.public_reference,
    'venue_id', v_group.venue_id,
    'amount_cents', COALESCE(
      (NEW.safe_metadata->>'amountMinor')::bigint,
      v_group.total_minor
    ),
    'currency', v_group.currency_code,
    'payment_deadline', v_group.payment_deadline,
    'request_deadline', v_group.request_deadline,
    'title', CASE
      WHEN v_staff_event THEN 'Stay reservation needs attention'
      ELSE 'Your Stay reservation'
    END,
    'body', CASE NEW.event_type
      WHEN 'stay_request_submitted'
        THEN 'A guest submitted a Stay reservation request.'
      WHEN 'stay_request_approved'
        THEN 'Your Stay request was approved. Complete payment before the deadline.'
      WHEN 'stay_request_declined'
        THEN 'The property declined your Stay reservation request.'
      WHEN 'stay_reservation_confirmed'
        THEN 'Your Rooms and Places are confirmed.'
      WHEN 'stay_reservation_cancelled'
        THEN 'Your selected Rooms and Places were cancelled.'
      WHEN 'stay_refund_succeeded'
        THEN 'Your Stay refund has been issued.'
      ELSE 'A Stay payment or refund needs review.'
    END
  ) || NEW.safe_metadata;

  IF v_staff_event THEN
    FOR v_recipient IN
      SELECT DISTINCT recipient.user_id, user_row.email, user_row.phone
      FROM (
        SELECT brand.account_id AS user_id
        FROM public.brands brand
        WHERE brand.id = v_group.brand_id
        UNION
        SELECT member.user_id
        FROM public.brand_team_members member
        WHERE member.brand_id = v_group.brand_id
          AND member.accepted_at IS NOT NULL
          AND member.removed_at IS NULL
          AND member.role IN (
            'brand_owner', 'brand_admin',
            'event_manager', 'finance_manager'
          )
      ) recipient
      JOIN auth.users user_row ON user_row.id = recipient.user_id
    LOOP
      -- Producer H — staff EMAIL leg. Country underivable from an email.
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code
      ) VALUES (
        v_category, v_recipient.user_id, lower(v_recipient.email),
        v_group.brand_id, v_payload,
        'stay:' || NEW.id || ':' || v_category || ':user:' ||
          v_recipient.user_id,
        NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      -- Producer I — staff SMS leg. #1529: normalise FIRST, then gate on the
      -- normalised value, so an unnormalisable phone yields no row at all.
      v_phone_e164 := public.mingla_e164_normalize(v_recipient.phone);
      IF v_phone_e164 IS NOT NULL THEN
        INSERT INTO public.notification_outbox (
          category_key, user_id, contact, brand_id, payload, idempotency_key,
          country_code
        ) VALUES (
          v_category, NULL, v_phone_e164, v_group.brand_id,
          v_payload || jsonb_build_object('channel_hint', 'sms'),
          'stay:' || NEW.id || ':' || v_category || ':sms:' ||
            v_recipient.user_id,
          public.mingla_e164_country(v_phone_e164)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  ELSE
    SELECT
      v_group.user_id AS user_id,
      COALESCE(
        NULLIF(v_group.guest_snapshot->>'email', ''),
        user_row.email
      ) AS email,
      COALESCE(
        NULLIF(v_group.guest_snapshot->>'phone', ''),
        user_row.phone
      ) AS phone
    INTO v_recipient
    FROM auth.users user_row
    WHERE user_row.id = v_group.user_id;

    -- Producer J — guest EMAIL leg. Country underivable from an email.
    IF v_group.user_id IS NOT NULL OR v_recipient.email IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code
      ) VALUES (
        v_category, v_group.user_id, lower(v_recipient.email),
        v_group.brand_id, v_payload,
        'stay:' || NEW.id || ':' || v_category || ':guest',
        NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    -- Producer K — guest SMS leg. #1529: normalise FIRST, gate on the
    -- normalised value (see producer I).
    v_phone_e164 := public.mingla_e164_normalize(v_recipient.phone);
    IF v_phone_e164 IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code
      ) VALUES (
        v_category, NULL, v_phone_e164, v_group.brand_id,
        v_payload || jsonb_build_object('channel_hint', 'sms'),
        'stay:' || NEW.id || ':' || v_category || ':guest-sms',
        public.mingla_e164_country(v_phone_e164)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1389_enqueue_stay_event()
  FROM public, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
