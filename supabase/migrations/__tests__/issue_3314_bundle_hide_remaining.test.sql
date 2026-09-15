-- Issue #3314 — the public event bundle carries the organiser's "Hide remaining count".
--
-- WHAT IS PROVED (H-00 … H-09). EVERY CASE EXECUTES THE REAL READER against the full
-- applied migration chain, in its own transaction, and rolls back:
--
--   H-00  the reader keeps its signature, STABLE SECURITY DEFINER, empty search_path,
--         json result, one overload, its grants and its #1929 COMMENT
--   H-01  PUBLIC event, setting ON  -> hideRemainingCount = true
--   H-02  PUBLIC event, setting OFF -> false; setting ABSENT -> false
--   H-03  UNLISTED event, setting ON -> true; OFF -> false; ABSENT -> false.
--         This is the case #3314 exists for: the social-proof read answers NULL here.
--   H-04  the slug read and the anonymous caller see the same key
--   H-05  for public events the key equals pg_public_social_proof's own value, so the
--         two sources can never disagree about the same row
--   H-06  a value that is not a boolean does not break the page: true (fail closed);
--         JSON null reads false, a boolean-like string reads as that boolean
--   H-07  ADDITIVE ONLY: removing exactly the two #3314 hunks from the installed body
--         reproduces every other key, value and order; the new key sits straight
--         before recurrenceRule, and refundPolicy is still the last key
--   H-08  #3313 and #3284 survive: an unlisted recurring event with two upcoming nights
--         still requires a day choice, still carries refundPolicy last, and carries
--         hideRemainingCount
--   H-09  denial is unchanged: private and draft events still return NULL
--
-- FAILS-ON-REVERT:
--   delete the migration / drop the key       -> H-01 … H-08 fail (key absent)
--   cast without pg_input_is_valid            -> H-06a fails (the page read raises)
--   default an absent setting to true          -> H-02b / H-03c / H-05 fail
--   append the key after refundPolicy          -> H-07e / H-08d fail (and #3284 R-15/R-16)
--   any other edit to the re-emitted body      -> H-07a / H-07b / H-07c fail
--
-- Run after the full migration chain on fresh PostgreSQL 17, as the database owner.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.h3314_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3314 bundle hide-remaining FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$assert$;

-- A brand owned by a fresh user.
CREATE OR REPLACE FUNCTION pg_temp.h3314_brand(p_tag text, OUT o_user uuid, OUT o_brand uuid, OUT o_brand_slug text)
LANGUAGE plpgsql AS $brand$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_brand_slug := 'issue-3314-' || p_tag || '-' || o_brand;
  INSERT INTO auth.users(id, email) VALUES (o_user, 'issue-3314-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (o_brand, o_user, 'Issue 3314 ' || p_tag, o_brand_slug, 'stripe', 'US', 'USD', 'USD');
END
$brand$;

-- The theme a published event carries, with the setting ON, OFF, or ABSENT (NULL).
CREATE OR REPLACE FUNCTION pg_temp.h3314_theme(p_setting jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $theme$
  SELECT jsonb_build_object('business_event',
           jsonb_build_object('format', 'in_person',
                              'hideAddressUntilTicket', false,
                              'settings',
                                CASE WHEN p_setting IS NULL
                                  THEN jsonb_build_object('privateGuestList', false)
                                  ELSE jsonb_build_object('privateGuestList', false,
                                                          'hideRemainingCount', p_setting)
                                END))
$theme$;

-- One published ticketed event with an upcoming master date and one finite tier.
CREATE OR REPLACE FUNCTION pg_temp.h3314_event(
  p_brand uuid, p_tag text, p_visibility text, p_setting jsonb,
  OUT o_event uuid, OUT o_slug text
) LANGUAGE plpgsql AS $event$
BEGIN
  o_event := gen_random_uuid();
  o_slug := 'issue-3314-' || p_tag || '-' || o_event;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, p_brand, 'Issue 3314 ' || p_tag, o_slug, 'event', 'scheduled', p_visibility,
            'UTC', 'USD', now(), pg_temp.h3314_theme(p_setting));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency)
    VALUES (o_event, 'GA', 2500, 60, 'USD');
END
$event$;

CREATE OR REPLACE FUNCTION pg_temp.h3314_bundle(p_event uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $bundle$
  SELECT public.pg_direct_event_checkout_bundle(p_event, NULL, NULL)::jsonb
$bundle$;

-- ─── H-00: the reader's security contract is unchanged ─────────────────────────────
BEGIN;
DO $h00$
DECLARE
  v_fn constant regprocedure := 'public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure;
  v_row record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS result,
         (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang) AS lang,
         (SELECT count(*) FROM pg_proc p2 WHERE p2.pronamespace = p.pronamespace AND p2.proname = p.proname) AS overloads,
         obj_description(p.oid, 'pg_proc') AS comment
    INTO v_row FROM pg_proc p WHERE p.oid = v_fn;
  PERFORM pg_temp.h3314_assert(v_row.overloads = 1, 'H-00a exactly one pg_direct_event_checkout_bundle overload');
  PERFORM pg_temp.h3314_assert(v_row.prosecdef AND v_row.provolatile = 's' AND v_row.lang = 'sql',
    'H-00b the bundle stays a STABLE SECURITY DEFINER SQL function');
  PERFORM pg_temp.h3314_assert(v_row.proconfig = ARRAY['search_path=']::text[]
      OR v_row.proconfig = ARRAY['search_path=""']::text[],
    'H-00c search_path stays pinned to empty');
  PERFORM pg_temp.h3314_assert(v_row.result = 'json', 'H-00d it still RETURNS json');
  PERFORM pg_temp.h3314_assert(v_row.comment LIKE 'Issue #1929 exact-key public/hidden standard-event bundle%',
    'H-00e its #1929 COMMENT is kept (a same-signature replace keeps it)');
  PERFORM pg_temp.h3314_assert(
    has_function_privilege('anon', v_fn, 'EXECUTE')
      AND has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE'),
    'H-00f anon, authenticated and service_role still execute the bundle');
END
$h00$;
ROLLBACK;

-- ─── H-01 / H-02: public events ────────────────────────────────────────────────────
BEGIN;
DO $h01$
DECLARE b record; o_on record; o_off record; o_absent record; v_b jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h01');
  SELECT * INTO o_on FROM pg_temp.h3314_event(b.o_brand, 'h01-on', 'public', 'true'::jsonb);
  SELECT * INTO o_off FROM pg_temp.h3314_event(b.o_brand, 'h01-off', 'public', 'false'::jsonb);
  SELECT * INTO o_absent FROM pg_temp.h3314_event(b.o_brand, 'h01-absent', 'public', NULL);

  v_b := pg_temp.h3314_bundle(o_on.o_event);
  PERFORM pg_temp.h3314_assert(v_b IS NOT NULL, 'H-01 fixture: the bundle serves the public event');
  PERFORM pg_temp.h3314_assert(v_b ? 'hideRemainingCount'
      AND jsonb_typeof(v_b -> 'hideRemainingCount') = 'boolean',
    'H-01a the bundle carries a boolean hideRemainingCount key');
  PERFORM pg_temp.h3314_assert((v_b ->> 'hideRemainingCount')::boolean = true,
    'H-01b public, setting ON -> true (got ' || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');
  PERFORM pg_temp.h3314_assert((v_b #>> '{tickets,0,remaining}')::int = 60,
    'H-01c display only: the remaining number still travels for the stepper and sold-out gate');

  v_b := pg_temp.h3314_bundle(o_off.o_event);
  PERFORM pg_temp.h3314_assert(v_b ? 'hideRemainingCount' AND (v_b ->> 'hideRemainingCount')::boolean = false,
    'H-02a public, setting OFF -> false (got ' || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');

  v_b := pg_temp.h3314_bundle(o_absent.o_event);
  PERFORM pg_temp.h3314_assert(v_b ? 'hideRemainingCount' AND (v_b ->> 'hideRemainingCount')::boolean = false,
    'H-02b public, setting ABSENT -> false, the key still PRESENT (got '
    || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');
END
$h01$;
ROLLBACK;

-- ─── H-03: unlisted events — the case #3314 exists for ─────────────────────────────
BEGIN;
DO $h03$
DECLARE b record; o_on record; o_off record; o_absent record; v_b jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h03');
  SELECT * INTO o_on FROM pg_temp.h3314_event(b.o_brand, 'h03-on', 'hidden', 'true'::jsonb);
  SELECT * INTO o_off FROM pg_temp.h3314_event(b.o_brand, 'h03-off', 'hidden', 'false'::jsonb);
  SELECT * INTO o_absent FROM pg_temp.h3314_event(b.o_brand, 'h03-absent', 'hidden', NULL);

  PERFORM pg_temp.h3314_assert(public.pg_public_social_proof(o_off.o_event) IS NULL,
    'H-03 fixture: the social-proof read gives an unlisted event no answer at all');

  v_b := pg_temp.h3314_bundle(o_on.o_event);
  PERFORM pg_temp.h3314_assert(v_b IS NOT NULL, 'H-03 fixture: the bundle serves the unlisted event');
  PERFORM pg_temp.h3314_assert(v_b ? 'hideRemainingCount' AND (v_b ->> 'hideRemainingCount')::boolean = true,
    'H-03a unlisted, setting ON -> true (got ' || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');

  v_b := pg_temp.h3314_bundle(o_off.o_event);
  PERFORM pg_temp.h3314_assert(v_b ? 'hideRemainingCount' AND (v_b ->> 'hideRemainingCount')::boolean = false,
    'H-03b unlisted, setting OFF -> false, so the page may show the count (got '
    || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');

  v_b := pg_temp.h3314_bundle(o_absent.o_event);
  PERFORM pg_temp.h3314_assert(v_b ? 'hideRemainingCount' AND (v_b ->> 'hideRemainingCount')::boolean = false,
    'H-03c unlisted, setting ABSENT -> false (got ' || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');
END
$h03$;
ROLLBACK;

-- ─── H-04: slug read and anonymous caller ──────────────────────────────────────────
BEGIN;
DO $h04$
DECLARE b record; o_pub record; o_hid record; v_b jsonb; v_anon jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h04');
  SELECT * INTO o_pub FROM pg_temp.h3314_event(b.o_brand, 'h04-pub', 'public', 'true'::jsonb);
  SELECT * INTO o_hid FROM pg_temp.h3314_event(b.o_brand, 'h04-hid', 'hidden', 'false'::jsonb);

  PERFORM pg_temp.h3314_assert(
    pg_temp.h3314_bundle(o_pub.o_event)
      = public.pg_direct_event_checkout_bundle(NULL, b.o_brand_slug, o_pub.o_slug)::jsonb
    AND pg_temp.h3314_bundle(o_hid.o_event)
      = public.pg_direct_event_checkout_bundle(NULL, b.o_brand_slug, o_hid.o_slug)::jsonb,
    'H-04a the slug read carries the identical payload, hideRemainingCount included');

  SET LOCAL ROLE anon;
  v_b := public.pg_direct_event_checkout_bundle(o_pub.o_event, NULL, NULL)::jsonb;
  v_anon := public.pg_direct_event_checkout_bundle(o_hid.o_event, NULL, NULL)::jsonb;
  RESET ROLE;
  PERFORM pg_temp.h3314_assert((v_b ->> 'hideRemainingCount')::boolean = true
      AND (v_anon ->> 'hideRemainingCount')::boolean = false,
    'H-04b anon reads the same setting on public (true) and unlisted (false) events');
END
$h04$;
ROLLBACK;

-- ─── H-05: one value for one row — agrees with pg_public_social_proof ──────────────
BEGIN;
DO $h05$
DECLARE b record; o record; v_setting jsonb; v_sp json;
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h05');
  FOREACH v_setting IN ARRAY ARRAY['true'::jsonb, 'false'::jsonb, 'null'::jsonb, '"true"'::jsonb, '"off"'::jsonb] LOOP
    SELECT * INTO o FROM pg_temp.h3314_event(b.o_brand, 'h05', 'public', v_setting);
    v_sp := public.pg_public_social_proof(o.o_event);
    PERFORM pg_temp.h3314_assert(v_sp IS NOT NULL, 'H-05 fixture: social proof answers for the public event');
    PERFORM pg_temp.h3314_assert(
      (pg_temp.h3314_bundle(o.o_event) -> 'hideRemainingCount') = ((v_sp::jsonb) -> 'hideRemainingCount'),
      'H-05 the bundle and social proof agree for setting ' || v_setting::text
      || ' (bundle ' || COALESCE(pg_temp.h3314_bundle(o.o_event) ->> 'hideRemainingCount', 'ABSENT')
      || ', social proof ' || COALESCE((v_sp::jsonb) ->> 'hideRemainingCount', 'ABSENT') || ')');
  END LOOP;
END
$h05$;
ROLLBACK;

-- ─── H-06: a malformed value never breaks the page ─────────────────────────────────
BEGIN;
DO $h06$
DECLARE b record; o record; v_b jsonb; v_raised text;
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h06');
  SELECT * INTO o FROM pg_temp.h3314_event(b.o_brand, 'h06-bad', 'hidden', '"maybe"'::jsonb);
  BEGIN
    v_b := pg_temp.h3314_bundle(o.o_event);
    v_raised := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  PERFORM pg_temp.h3314_assert(v_raised IS NULL,
    'H-06a a non-boolean setting does not make the event page fail (raised: ' || COALESCE(v_raised, 'nothing') || ')');
  PERFORM pg_temp.h3314_assert(v_b IS NOT NULL AND (v_b ->> 'hideRemainingCount')::boolean = true,
    'H-06b a non-boolean setting reads true: fail closed (got ' || COALESCE(v_b ->> 'hideRemainingCount', 'ABSENT') || ')');

  SELECT * INTO o FROM pg_temp.h3314_event(b.o_brand, 'h06-num', 'hidden', '{"nested":true}'::jsonb);
  v_b := pg_temp.h3314_bundle(o.o_event);
  PERFORM pg_temp.h3314_assert((v_b ->> 'hideRemainingCount')::boolean = true,
    'H-06c an object setting reads true too');

  SELECT * INTO o FROM pg_temp.h3314_event(b.o_brand, 'h06-null', 'hidden', 'null'::jsonb);
  PERFORM pg_temp.h3314_assert((pg_temp.h3314_bundle(o.o_event) ->> 'hideRemainingCount')::boolean = false,
    'H-06d a JSON null setting reads false, like an absent one');

  SELECT * INTO o FROM pg_temp.h3314_event(b.o_brand, 'h06-str', 'hidden', '"true"'::jsonb);
  PERFORM pg_temp.h3314_assert((pg_temp.h3314_bundle(o.o_event) ->> 'hideRemainingCount')::boolean = true,
    'H-06e the string "true" reads true, as PostgreSQL''s boolean input does');
END
$h06$;
ROLLBACK;

-- ─── H-07: additive only ───────────────────────────────────────────────────────────
BEGIN;
DO $h07$
DECLARE
  b record; o_pub record; o_hid record;
  v_src text; v_before_src text; v_event uuid;
  v_cte_hunk constant text :=
       E'      -- issue #3314 — the organiser''s "Hide remaining count", read from the raw\n'
    || E'      -- row (theme.business_event.settings), never from the public_theme above:\n'
    || E'      -- a later tightening of that sanitiser must not quietly turn this into\n'
    || E'      -- "show". Resolved to a boolean on the output key below.\n'
    || E'      e.theme #>> ''{business_event,settings,hideRemainingCount}'' AS hide_remaining_count_setting,\n';
  v_key_hunk constant text :=
       E'      -- issue #3314 — the organiser''s "Hide remaining count", so a guest page can\n'
    || E'      -- decide from the SAME reader that served the event, public or unlisted.\n'
    || E'      -- The social-proof read that carried it before answers for public events\n'
    || E'      -- only, so an unlisted page could never learn the count was allowed.\n'
    || E'      -- Same value as pg_public_social_proof: absent or JSON null is false (the\n'
    || E'      -- organiser never turned it on). A value that is not a boolean, which\n'
    || E'      -- makes that read raise, is true here: fail closed without breaking the page.\n'
    || E'      -- Placed BEFORE recurrenceRule, not last: #3284''s contract keeps\n'
    || E'      -- recurrenceRule then refundPolicy as the final two keys.\n'
    || E'      ''hideRemainingCount'', CASE\n'
    || E'        WHEN ev.hide_remaining_count_setting IS NULL THEN false\n'
    || E'        WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, ''boolean'')\n'
    || E'          THEN ev.hide_remaining_count_setting::boolean\n'
    || E'        ELSE true\n'
    || E'      END,\n';
  v_now json; v_before json; v_now_keys text[]; v_before_keys text[]; v_expected_keys text[];
  v_at int;
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h07');
  SELECT * INTO o_pub FROM pg_temp.h3314_event(b.o_brand, 'h07-pub', 'public', 'true'::jsonb);
  SELECT * INTO o_hid FROM pg_temp.h3314_event(b.o_brand, 'h07-hid', 'hidden', NULL);

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure;
  PERFORM pg_temp.h3314_assert(
    (length(v_src) - length(replace(v_src, v_cte_hunk, ''))) = length(v_cte_hunk)
      AND (length(v_src) - length(replace(v_src, v_key_hunk, ''))) = length(v_key_hunk),
    'H-07a the installed bundle carries each #3314 hunk exactly once');
  PERFORM pg_temp.h3314_assert(md5(v_src) = '116dfbfabf706c9b818c71c634717861',
    'H-07b the installed body is byte-identical to 20270704003314 (md5 ' || md5(v_src) || ')');
  v_before_src := replace(replace(v_src, v_cte_hunk, ''), v_key_hunk, '');
  PERFORM pg_temp.h3314_assert(md5(v_before_src) = 'e26e1b4fbc414b4f816ca18eae31a932',
    'H-07c removing the two hunks gives back #3284''s exact body (md5 ' || md5(v_before_src) || ')');
  EXECUTE format(
    'CREATE FUNCTION pg_temp.h3314_bundle_before(p_event_id uuid, p_brand_slug text, p_event_slug text) '
    'RETURNS json LANGUAGE sql STABLE SET search_path TO '''' AS %L', v_before_src);

  FOREACH v_event IN ARRAY ARRAY[o_pub.o_event, o_hid.o_event] LOOP
    v_now := public.pg_direct_event_checkout_bundle(v_event, NULL, NULL);
    EXECUTE 'SELECT pg_temp.h3314_bundle_before($1, NULL, NULL)' INTO v_before USING v_event;
    PERFORM pg_temp.h3314_assert(v_before IS NOT NULL AND v_now IS NOT NULL,
      'H-07 fixture: both bodies serve the event');
    PERFORM pg_temp.h3314_assert((v_now::jsonb - 'hideRemainingCount') = v_before::jsonb,
      'H-07d the bundle minus hideRemainingCount equals the #3284 body, value for value');
    SELECT array_agg(k ORDER BY n) INTO v_now_keys FROM json_object_keys(v_now) WITH ORDINALITY AS t(k, n);
    SELECT array_agg(k ORDER BY n) INTO v_before_keys FROM json_object_keys(v_before) WITH ORDINALITY AS t(k, n);
    v_at := array_position(v_before_keys, 'recurrenceRule');
    v_expected_keys := v_before_keys[1:v_at - 1] || ARRAY['hideRemainingCount'] || v_before_keys[v_at:];
    PERFORM pg_temp.h3314_assert(v_at IS NOT NULL AND v_now_keys = v_expected_keys,
      'H-07e every prior key keeps its order; hideRemainingCount sits straight before recurrenceRule');
    PERFORM pg_temp.h3314_assert(
      v_now_keys[cardinality(v_now_keys)] = 'refundPolicy'
        AND v_now_keys[cardinality(v_now_keys) - 1] = 'recurrenceRule',
      'H-07f #3284''s contract holds: recurrenceRule then refundPolicy are still the last two keys');
  END LOOP;
END
$h07$;
ROLLBACK;

-- ─── H-08: #3313's day choice and #3284's terms survive on an unlisted recurring event ─
BEGIN;
DO $h08$
DECLARE
  b record; v_rec uuid := gen_random_uuid();
  v_rule constant jsonb := '{"preset":"weekly","byDay":"TU","termination":{"kind":"count","count":4}}';
  v_policy constant jsonb := '{"kind":"standard","tiers":[{"days_before_start":14,"refund_pct":100},{"days_before_start":7,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}';
  v_b jsonb; v_keys text[];
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h08');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone,
                            currency, published_at, refund_policy, is_recurring, is_multi_date,
                            recurrence_rules, theme)
    VALUES (v_rec, b.o_brand, 'Issue 3314 h08 recurring', 'issue-3314-h08-rec-' || v_rec, 'event',
            'scheduled', 'hidden', 'UTC', 'USD', now(), v_policy, true, false, v_rule,
            pg_temp.h3314_theme('true'::jsonb));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_rec, now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true),
           (v_rec, now() + interval '13 days', now() + interval '13 days 4 hours', 'UTC', false);

  v_b := pg_temp.h3314_bundle(v_rec);
  PERFORM pg_temp.h3314_assert(v_b IS NOT NULL, 'H-08 fixture: the bundle serves the unlisted recurring event');
  PERFORM pg_temp.h3314_assert(v_b ->> 'isMultiDate' = 'true' AND jsonb_array_length(v_b -> 'occurrences') = 2
      AND v_b -> 'recurrenceRule' = v_rule,
    'H-08a #3313 kept: two upcoming nights, a day choice, and the stored rule');
  PERFORM pg_temp.h3314_assert(v_b -> 'refundPolicy' = v_policy,
    'H-08b #3284 kept: the refund terms ride the same payload');
  PERFORM pg_temp.h3314_assert((v_b ->> 'hideRemainingCount')::boolean = true,
    'H-08c #3314: the unlisted recurring event carries its hide setting');
  SELECT array_agg(k ORDER BY n) INTO v_keys
    FROM json_object_keys(public.pg_direct_event_checkout_bundle(v_rec, NULL, NULL)) WITH ORDINALITY AS t(k, n);
  PERFORM pg_temp.h3314_assert(
    v_keys[cardinality(v_keys)] = 'refundPolicy'
      AND v_keys[cardinality(v_keys) - 1] = 'recurrenceRule'
      AND v_keys[cardinality(v_keys) - 2] = 'hideRemainingCount'
      AND v_keys[cardinality(v_keys) - 3] = 'multiDatePricingMode',
    'H-08d the tail is multiDatePricingMode, hideRemainingCount, recurrenceRule, refundPolicy (got '
    || array_to_string(v_keys[greatest(cardinality(v_keys) - 3, 1):], ', ') || ')');
END
$h08$;
ROLLBACK;

-- ─── H-09: denial is unchanged ─────────────────────────────────────────────────────
BEGIN;
DO $h09$
DECLARE b record; v_private uuid := gen_random_uuid(); v_draft uuid := gen_random_uuid();
BEGIN
  SELECT * INTO b FROM pg_temp.h3314_brand('h09');
  -- #2009 permits a trusted caller to seed a row ALREADY private (see #2160's suite).
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (v_private, b.o_brand, 'Issue 3314 h09 private', 'issue-3314-h09-private-' || v_private,
            'event', 'scheduled', 'private', 'UTC', 'USD', now(), pg_temp.h3314_theme('false'::jsonb));
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, theme)
    VALUES (v_draft, b.o_brand, 'Issue 3314 h09 draft', 'issue-3314-h09-draft-' || v_draft,
            'event', 'draft', 'draft', 'UTC', 'USD', pg_temp.h3314_theme('false'::jsonb));
  PERFORM pg_temp.h3314_assert(public.pg_direct_event_checkout_bundle(v_private, NULL, NULL) IS NULL,
    'H-09a a private event still returns NULL — the setting never leaks past the visibility gate');
  PERFORM pg_temp.h3314_assert(public.pg_direct_event_checkout_bundle(v_draft, NULL, NULL) IS NULL,
    'H-09b a draft event still returns NULL');
END
$h09$;
ROLLBACK;

SELECT 'issue_3314_bundle_hide_remaining: PASS' AS result;
