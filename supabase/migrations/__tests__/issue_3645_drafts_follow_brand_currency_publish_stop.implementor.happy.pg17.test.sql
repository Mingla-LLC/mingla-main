\set ON_ERROR_STOP on

-- Issue #3645 — implementor proof for the retest-2 P1: a draft that is out of
-- step with its brand cannot be published, and its host is never at a dead
-- end (migration 20270829003645). Run after the full migration chain on
-- PostgreSQL 17. Everything is rolled back.
--
-- BEFORE. A draft the brand trigger did not move kept its old currency and
-- number. On Publish `tg_require_event_brand_currency` re-stamped it with the
-- brand's currency and `tg_enforce_event_ticket_currency` overwrote the
-- tickets: 50 pounds went on sale as 50 naira.
--
-- AFTER.
--   S-1x  Publish, a buyer starts a checkout and leaves, unpublish, the brand
--         goes GBP -> NGN. The brand trigger leaves the draft alone; Publish is
--         refused with `price_reentry_required`; `biz_sync_draft_currency`
--         then moves it and clears its price (the checkout is abandoned), and
--         the re-priced draft publishes in naira.
--   S-2x  A checkout still open: skipped, Publish refused, the sync answers
--         `checkout_in_progress` and changes nothing; once that checkout has
--         expired the sync moves the draft.
--   S-3x  An in-flight save writes GBP / 50 back over a cleared row: it cannot
--         publish. And a stale Publish sent straight at a row that IS in step
--         is refused on the currency the publish itself wrote, which proves
--         the stop runs before the re-stamp.
--   S-4x  Who may call the sync: the brand's event managers. A stranger and a
--         signed-out caller are refused.
--   S-5x  Unaffected: a draft in its brand's currency publishes as before, and
--         a FREE-only draft that is out of step publishes too.
--
-- NULL-safety: comparisons whose left side can be NULL use IS DISTINCT FROM.

BEGIN;

INSERT INTO auth.users(id) VALUES
  ('36450831-0000-4000-8000-000000000001'), ('36450831-0000-4000-8000-000000000002');
INSERT INTO public.creator_accounts(id) VALUES
  ('36450831-0000-4000-8000-000000000001'), ('36450831-0000-4000-8000-000000000002');

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user, true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user = '' THEN '' ELSE
      json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $$;

CREATE FUNCTION pg_temp.as_host() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.as_user('36450831-0000-4000-8000-000000000001')
$$;

-- A brand that can take money, with the organiser terms accepted, so a paid
-- Publish is refused for no other reason.
CREATE FUNCTION pg_temp.brand(p_id uuid, p_currency text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (p_id, '36450831-0000-4000-8000-000000000001', 'PS ' || p_id, 'ps-' || p_id, p_currency);
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_ps_' || right(p_id::text, 4) WHERE id = p_id;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = '36450831-0000-4000-8000-000000000001';
END $$;

-- What the wizard sends: one online ticket. p_price NULL = a free ticket.
CREATE FUNCTION pg_temp.payload(p_currency text, p_price numeric) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('title', 'PS draft', 'timezone', 'UTC', 'currency', p_currency,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'currency', p_currency,
      'tickets', jsonb_build_array(jsonb_build_object('id', 't_one', 'name', 'General',
        'isFree', p_price IS NULL, 'priceGbp', p_price, 'capacity', 10, 'availableAt', 'online',
        'currency', p_currency)),
      'city', 'London', 'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public', 'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))))
$$;

CREATE FUNCTION pg_temp.draft(p_id uuid, p_brand uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (p_id, p_brand, '36450831-0000-4000-8000-000000000001', 'PS draft',
    'draft-ps-' || p_id, 'event', 'draft', 'draft', 'UTC')
$$;

CREATE FUNCTION pg_temp.revision(p_event uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::integer, 0)
    FROM public.events WHERE id = p_event
$$;

-- The host saves the draft (as the signed-in host, through the real owner).
CREATE FUNCTION pg_temp.save(p_event uuid, p_payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_event_draft(p_event, p_payload, pg_temp.revision(p_event) + 1);
  RESET ROLE;
END $$;

-- The host presses Publish. Returns NULL when it published, else the refusal.
CREATE FUNCTION pg_temp.publish(p_event uuid, p_payload jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_refused text := NULL;
BEGIN
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.business_publish_event_draft(p_event, p_payload, pg_temp.revision(p_event) + 1);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM;
  END;
  RESET ROLE;
  RETURN v_refused;
END $$;

CREATE FUNCTION pg_temp.sync(p_event uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_out jsonb;
BEGIN
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  v_out := public.biz_sync_draft_currency(p_event);
  RESET ROLE;
  RETURN v_out->>'outcome';
END $$;

-- "Nothing in this currency at this number is on sale."
CREATE FUNCTION pg_temp.on_sale(p_event uuid, p_currency text, p_cents integer) RETURNS boolean
LANGUAGE sql AS $$
  SELECT (SELECT status FROM public.events WHERE id = p_event) <> 'draft'
     AND EXISTS (SELECT 1 FROM public.ticket_types tt
                  WHERE tt.event_id = p_event AND tt.deleted_at IS NULL
                    AND tt.price_cents = p_cents AND tt.currency = p_currency)
$$;

-- ─── S-1x  an abandoned checkout ─────────────────────────────────────────────
DO $abandoned$
DECLARE
  v_brand uuid := '36450831-0000-4000-8000-0000000000a0';
  v_event uuid := '36450831-0000-4000-8000-0000000000a1';
  v_before record;
  e record;
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_event, 'GBP', 5000) THEN
    RAISE EXCEPTION 'S-10 fixture: a GBP draft on a GBP brand did not publish at 50 pounds: %', v_out;
  END IF;
  -- A buyer starts a checkout and leaves. The host takes the event back to draft.
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, idempotency_key, expires_at)
  VALUES (v_event, v_brand, 'Buyer', 'buyer@example.com', '+447700900001',
    'ps-session-a1', now() + interval '1 hour');
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  PERFORM public.business_unpublish_event_to_draft(v_event);
  RESET ROLE;
  SELECT status, published_at, currency, theme INTO v_before FROM public.events WHERE id = v_event;
  IF v_before.status IS DISTINCT FROM 'draft' OR v_before.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'S-11 fixture: expected an unpublished draft, got % / %', v_before.status, v_before.published_at;
  END IF;

  -- The brand moves to naira. An unattended change does not touch this draft.
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'GBP' OR e.theme IS DISTINCT FROM v_before.theme THEN
    RAISE EXCEPTION 'S-12 the brand''s change touched a draft a buyer had opened a checkout on: %', e.currency;
  END IF;

  -- S-13 the host presses Publish with what the app holds (pounds, 50).
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'S-13 FIFTY POUNDS WENT ON SALE AS FIFTY NAIRA';
  END IF;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'S-14 Publish of a pound draft on a naira brand answered "%", expected price_reentry_required', v_out;
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'S-15 a refused publish moved the draft';
  END IF;

  -- S-16 not a dead end: the app asks for the draft to be brought in step.
  -- The checkout is abandoned (taking the event off sale ended it), so it moves.
  v_out := pg_temp.sync(v_event);
  IF v_out IS DISTINCT FROM 'moved_prices_cleared' THEN
    RAISE EXCEPTION 'S-16 the sync answered "%", expected moved_prices_cleared', v_out;
  END IF;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'NGN'
     OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN'
     OR jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceGbp}') IS DISTINCT FROM 'null'
     OR (e.theme#>'{business_draft,tickets,0,isFree}') IS DISTINCT FROM 'false'::jsonb
     OR NOT ((e.theme->'business_draft') ? 'pricesClearedForCurrencyChange') THEN
    RAISE EXCEPTION 'S-17 the synced draft is not "naira, no price yet, not free, with the note": % %',
      e.currency, e.theme->'business_draft';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types tt
              WHERE tt.event_id = v_event AND tt.deleted_at IS NULL AND tt.price_cents > 0) THEN
    RAISE EXCEPTION 'S-18 an old ticket row kept its number after the sync';
  END IF;
  -- Asking again changes nothing.
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'in_step' THEN
    RAISE EXCEPTION 'S-19 a second sync did not answer in_step';
  END IF;

  -- S-1A the host enters a naira price and publishes.
  PERFORM pg_temp.save(v_event, pg_temp.payload('NGN', 9000));
  v_out := pg_temp.publish(v_event, pg_temp.payload('NGN', 9000));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_event, 'NGN', 900000) THEN
    RAISE EXCEPTION 'S-1A the re-priced draft did not publish at 9000 naira: %', v_out;
  END IF;
END
$abandoned$;

-- ─── S-2x  a checkout still open ─────────────────────────────────────────────
DO $open_checkout$
DECLARE
  v_brand uuid := '36450831-0000-4000-8000-0000000000b0';
  v_event uuid := '36450831-0000-4000-8000-0000000000b1';
  v_before record;
  e record;
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, idempotency_key, status, expires_at)
  VALUES (v_event, v_brand, 'Buyer', 'buyer@example.com', '+447700900002',
    'ps-session-b1', 'requires_payment', now() + interval '1 hour');
  SELECT currency, theme INTO v_before FROM public.events WHERE id = v_event;

  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'GBP' OR e.theme IS DISTINCT FROM v_before.theme THEN
    RAISE EXCEPTION 'S-20 a draft with a checkout in progress was moved';
  END IF;

  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'S-21 Publish with a checkout in progress answered "%", expected price_reentry_required', v_out;
  END IF;

  -- S-22 the buyer is still there: the sync says so and changes nothing.
  v_out := pg_temp.sync(v_event);
  IF v_out IS DISTINCT FROM 'checkout_in_progress' THEN
    RAISE EXCEPTION 'S-22 the sync answered "%" while a checkout was open, expected checkout_in_progress', v_out;
  END IF;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'GBP' OR e.theme IS DISTINCT FROM v_before.theme THEN
    RAISE EXCEPTION 'S-23 the sync moved a draft with a checkout in progress';
  END IF;
  -- Money already moving never becomes "abandoned" by age.
  UPDATE public.ticket_checkout_sessions
     SET status = 'processing_payment', expires_at = now() - interval '1 day'
   WHERE idempotency_key = 'ps-session-b1';
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'checkout_in_progress' THEN
    RAISE EXCEPTION 'S-24 a payment in flight past its expiry was treated as abandoned';
  END IF;

  -- S-25 the buyer's time runs out. Now the draft may be moved.
  UPDATE public.ticket_checkout_sessions
     SET status = 'requires_payment', expires_at = now() - interval '1 minute'
   WHERE idempotency_key = 'ps-session-b1';
  v_out := pg_temp.sync(v_event);
  IF v_out IS DISTINCT FROM 'moved_prices_cleared' THEN
    RAISE EXCEPTION 'S-25 after the checkout expired the sync answered "%", expected moved_prices_cleared', v_out;
  END IF;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'NGN'
     OR jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceGbp}') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'S-26 the draft was not moved to naira with its price cleared: % %',
      e.currency, e.theme#>'{business_draft,tickets,0}';
  END IF;

  -- S-27 a COMPLETED checkout is a sale: never moved, by anyone.
  UPDATE public.events SET currency = 'GBP',
         theme = jsonb_set(theme, '{business_draft,currency}', '"GBP"') WHERE id = v_event;
  UPDATE public.ticket_checkout_sessions SET status = 'free_completed'
   WHERE idempotency_key = 'ps-session-b1';
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'sale_exists' THEN
    RAISE EXCEPTION 'S-27 a draft with a completed checkout was not answered sale_exists';
  END IF;
END
$open_checkout$;

-- ─── S-3x  the old currency written back over a cleared row ──────────────────
DO $write_back$
DECLARE
  v_brand uuid := '36450831-0000-4000-8000-0000000000c0';
  v_event uuid := '36450831-0000-4000-8000-0000000000c1';
  e record;
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'NGN'
     OR jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceGbp}') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'S-30 fixture: a clean draft was not moved and cleared';
  END IF;

  -- S-31 A STALE PUBLISH SENT STRAIGHT AT A ROW THAT IS IN STEP. The stored
  -- row says naira; only what this Publish writes says pounds. If the stop ran
  -- AFTER the re-stamp it would see naira on both sides and let it through.
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'S-31 a stale Publish put fifty pounds on sale as fifty naira';
  END IF;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'S-32 a stale Publish answered "%"; the stop did not see the currency the publish wrote (it must run before the re-stamp)', v_out;
  END IF;
  IF NOT ('issue_3645_refuse_publish_with_cleared_prices'::name COLLATE "C"
            < 'trg_require_event_brand_currency_update'::name COLLATE "C")
     OR (SELECT count(*) FROM pg_trigger t
          WHERE t.tgrelid = 'public.events'::regclass AND NOT t.tgisinternal
            AND t.tgname IN ('issue_3645_refuse_publish_with_cleared_prices',
                             'trg_require_event_brand_currency_update')
            AND (t.tgtype & 2) = 2) <> 2 THEN
    RAISE EXCEPTION 'S-33 the publish stop and the re-stamp are not both BEFORE triggers in that name order';
  END IF;

  -- S-34 AN IN-FLIGHT SAVE writes pounds and 50 back over the cleared row (the
  -- draft owner stores what it is sent). It still cannot publish.
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'S-34 fixture: the write-back did not land';
  END IF;
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'S-35 a written-back pound draft answered "%" on Publish, expected price_reentry_required', v_out;
  END IF;
  -- The same draft sent with the brand's currency on the old number is refused
  -- too: the STORED draft is still in pounds.
  v_out := pg_temp.publish(v_event, pg_temp.payload('NGN', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'S-36 the old number relabelled as naira answered "%" on Publish', v_out;
  END IF;
  -- And the way out works here as well.
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'moved_prices_cleared' THEN
    RAISE EXCEPTION 'S-37 the sync did not clear a written-back draft';
  END IF;
END
$write_back$;

-- ─── S-4x  who may call the sync ─────────────────────────────────────────────
DO $who$
DECLARE
  v_event uuid := '36450831-0000-4000-8000-0000000000c1';
  v_refused text;
BEGIN
  v_refused := NULL;
  PERFORM pg_temp.as_user('36450831-0000-4000-8000-000000000002');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.biz_sync_draft_currency(v_event);
  EXCEPTION WHEN OTHERS THEN v_refused := SQLERRM;
  END;
  RESET ROLE;
  IF v_refused IS DISTINCT FROM 'insufficient_event_permission' THEN
    RAISE EXCEPTION 'S-40 a stranger calling the sync got "%", expected insufficient_event_permission', v_refused;
  END IF;

  v_refused := NULL;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.biz_sync_draft_currency(v_event);
  EXCEPTION WHEN OTHERS THEN v_refused := SQLERRM;
  END;
  IF v_refused IS DISTINCT FROM 'not_authenticated' THEN
    RAISE EXCEPTION 'S-41 a signed-out caller got "%", expected not_authenticated', v_refused;
  END IF;

  IF has_function_privilege('anon', 'public.biz_sync_draft_currency(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.biz_sync_draft_currency(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
          'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S-42 the sync, or the routine behind it, is granted to the wrong roles';
  END IF;
END
$who$;

-- ─── S-5x  unaffected publishes ──────────────────────────────────────────────
DO $unaffected$
DECLARE
  v_brand uuid := '36450831-0000-4000-8000-0000000000d0';
  v_paid uuid := '36450831-0000-4000-8000-0000000000d1';
  v_free uuid := '36450831-0000-4000-8000-0000000000d2';
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');

  -- S-50 a draft in its brand's currency publishes exactly as before.
  PERFORM pg_temp.draft(v_paid, v_brand);
  PERFORM pg_temp.save(v_paid, pg_temp.payload('GBP', 50));
  v_out := pg_temp.publish(v_paid, pg_temp.payload('GBP', 50));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_paid, 'GBP', 5000) THEN
    RAISE EXCEPTION 'S-50 an ordinary publish in the brand''s own currency was refused: %', v_out;
  END IF;

  -- S-51 a FREE-only draft that the brand's change did not move (a buyer once
  -- opened a checkout on it) still publishes: there is no number to protect.
  PERFORM pg_temp.draft(v_free, v_brand);
  PERFORM pg_temp.save(v_free, pg_temp.payload('GBP', NULL));
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, idempotency_key, status, expires_at)
  VALUES (v_free, v_brand, 'Buyer', 'buyer@example.com', '+447700900003',
    'ps-session-d2', 'expired', now() - interval '1 day');
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  IF (SELECT currency FROM public.events WHERE id = v_free) IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'S-51 fixture: the free draft was expected to be left in pounds';
  END IF;
  v_out := pg_temp.publish(v_free, pg_temp.payload('GBP', NULL));
  IF v_out IS NOT NULL
     OR (SELECT status FROM public.events WHERE id = v_free) IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'S-52 a free-only draft was refused publish: %', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types tt
              WHERE tt.event_id = v_free AND tt.deleted_at IS NULL AND tt.price_cents > 0) THEN
    RAISE EXCEPTION 'S-53 a free-only publish produced a priced ticket';
  END IF;
END
$unaffected$;

ROLLBACK;
