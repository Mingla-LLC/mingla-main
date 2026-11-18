\set ON_ERROR_STOP on

-- Issue #3645 bundle 2C — the host's paid/free choice is stored apart from
-- the ticket. Migration 20280806003645_issue_3645_paid_free_choice.sql.
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.
--
-- MINGLA-INVARIANT: I-3645-EXPERIENCE-FREE-IS-THE-HOSTS-CHOICE | issue #3645 | An experience reads as free (issue_1973_current_experience_payload, the Host wizard, Ari's flow row) only when no live option is priced above 0 and the host chose free; a paid experience saved at 0 stays paid, so it cannot publish free (experience_price_invalid). Rows saved before the choice was stored keep their derived value.
--
-- Red before green: on the previous bodies E1, E2, FP, LG (the theme without
-- experience_meta) and AU fail: the paid draft at 0 reads back free and
-- publishes free; the free-first + paid-second experience reads free and its
-- read-back is refused on save.

BEGIN;

INSERT INTO auth.users(id) VALUES ('3645c2c0-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('3645c2c0-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.as_host() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '3645c2c0-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', '3645c2c0-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
END $$;

-- A brand that can take money, Organiser Terms accepted.
CREATE FUNCTION pg_temp.brand(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code)
  VALUES (p_id, '3645c2c0-0000-4000-8000-000000000001', 'B ' || p_id, 'b2c-' || p_id,
    'NGN', 'paystack', 'NG', 'ACCT_b2c_' || right(p_id::text, 4));
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = '3645c2c0-0000-4000-8000-000000000001';
END $$;

-- What the wizard sends for a two-stop experience (the 2A suite's shape).
CREATE FUNCTION pg_temp.payload(p_free boolean, p_pricing text, p_whole integer,
  p_stop1 integer, p_stop2 integer, p_description text DEFAULT 'A walk through two good places.')
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title', 'B2c experience', 'description', p_description,
    'currency', 'NGN', 'is_free', p_free, 'pricing_mode', p_pricing,
    'whole_price_cents', CASE WHEN p_pricing = 'whole' THEN p_whole END,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'UTC', 'whenMode', 'single',
    'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '20:00'),
    'stops', jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object('place_name', 'First', 'ai_description', 'The first stop',
        'address', '1 First St', 'place_id', 'b2c-place-1', 'lat', 6.5, 'lng', 3.4, 'stop_order', 0,
        'price_cents', p_stop1)),
      jsonb_strip_nulls(jsonb_build_object('place_name', 'Second', 'ai_description', 'The second stop',
        'address', '2 Second St', 'place_id', 'b2c-place-2', 'lat', 6.6, 'lng', 3.5, 'stop_order', 1,
        'price_cents', p_stop2)))))
$$;

-- NULL when the call went through, else its refusal (a raise, or a live
-- edit's {ok:false} reason). Each call is its own subtransaction.
CREATE FUNCTION pg_temp.try_publish(p_event uuid, p_payload jsonb, p_publish boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  PERFORM public.biz_publish_experience(p_event, p_payload, p_publish);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.try_live(p_event uuid, p_payload jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM pg_temp.as_host();
  v_result := public.biz_update_live_experience(p_event, p_payload, 'Updating the experience for guests');
  IF v_result ? 'ok' AND NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN 'soft: ' || COALESCE(v_result->>'reason', v_result::text);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

-- The Ari path: business_apply_experience_action merges the patch over the
-- read-back payload.
CREATE FUNCTION pg_temp.try_ari(p_event uuid, p_patch jsonb, p_action text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM pg_temp.as_host();
  v_result := public.business_apply_experience_action(p_event, p_patch, p_action, NULL,
    'Updating the experience for guests');
  IF v_result ? 'ok' AND NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN 'soft: ' || COALESCE(v_result->>'reason', v_result::text);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.draft(p_brand uuid, p_payload jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  RETURN (public.biz_create_experience(p_brand, p_payload, false)->'event'->>'id')::uuid;
END $$;

CREATE FUNCTION pg_temp.readback(p_event uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  RETURN public.issue_1973_current_experience_payload(p_event);
END $$;

-- The stored choice: true, false, or NULL when none is stored.
CREATE FUNCTION pg_temp.meta_free(p_event uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN jsonb_typeof(theme #> '{experience_meta,is_free}') = 'boolean'
    THEN (theme #>> '{experience_meta,is_free}')::boolean END
    FROM public.events WHERE id = p_event
$$;

CREATE FUNCTION pg_temp.status(p_event uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT status FROM public.events WHERE id = p_event
$$;

-- ─── E1  a paid draft saved at 0 stays paid and cannot publish free ────────
DO $e1$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000e1';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'per_stop', NULL, NULL, NULL));
  v_res := pg_temp.try_publish(v_event, pg_temp.payload(false, 'per_stop', NULL, NULL, NULL), false);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'E1 FAIL: a paid draft at 0 could not be saved: %', v_res; END IF;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E1 FAIL: stored choice %, want false', pg_temp.meta_free(v_event);
  END IF;
  IF (pg_temp.readback(v_event)->>'is_free')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E1 FAIL: the paid draft at 0 reads back free';
  END IF;
  -- Publishing exactly what was read back is refused, never published free.
  v_res := pg_temp.try_publish(v_event, pg_temp.readback(v_event));
  IF v_res IS NULL OR v_res NOT LIKE '%experience_price_invalid%' THEN
    RAISE EXCEPTION 'E1 FAIL: publishing the read-back gave %', coalesce(v_res, 'published');
  END IF;
  IF pg_temp.status(v_event) <> 'draft' THEN RAISE EXCEPTION 'E1 FAIL: it left draft'; END IF;
  RAISE NOTICE 'ISSUE-3645-2C E1 PASS: a paid draft saved at 0 stays paid and cannot publish free';
END $e1$;

-- ─── E2  the Ari path keeps the choice and refuses to publish free ─────────
DO $e2$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000e2';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'whole', 0, NULL, NULL));
  v_res := pg_temp.try_ari(v_event, '{"description": "A slower walk through two good places."}', 'update');
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'E2 FAIL: the Ari update was refused: %', v_res; END IF;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM false
     OR (pg_temp.readback(v_event)->>'is_free')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E2 FAIL: an Ari update turned the paid draft free';
  END IF;
  v_res := pg_temp.try_ari(v_event, '{}', 'publish');
  IF v_res IS NULL OR v_res NOT LIKE '%experience_price_invalid%' THEN
    RAISE EXCEPTION 'E2 FAIL: Ari publish gave %', coalesce(v_res, 'published');
  END IF;
  RAISE NOTICE 'ISSUE-3645-2C E2 PASS: through Ari the paid draft at 0 stays paid and is not published free';
END $e2$;

-- ─── FP  a free first option beside a paid one is paid, and saves back ─────
DO $fp$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000f1';
  v_event uuid;
  v_res text;
  v_paid jsonb := pg_temp.payload(false, 'whole', 500000, NULL, NULL)
    || jsonb_build_object('price_options', jsonb_build_array(
         jsonb_build_object('name', 'Kids', 'price_cents', 0),
         jsonb_build_object('name', 'Adult', 'price_cents', 500000)));
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, v_paid);
  v_res := pg_temp.try_publish(v_event, v_paid);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'FP fixture FAIL: %', v_res; END IF;
  IF (pg_temp.readback(v_event)->>'is_free')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FP FAIL: free first + paid second reads free';
  END IF;
  -- Without sales, saving exactly what was read back goes through.
  v_res := pg_temp.try_live(v_event, pg_temp.readback(v_event));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'FP FAIL: saving the read-back gave %', v_res; END IF;
  -- The legacy derivation agrees: with no stored choice, a priced option wins.
  UPDATE public.events SET theme = theme #- '{experience_meta,is_free}' WHERE id = v_event;
  IF public.issue_3645_experience_is_free(v_event) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FP FAIL: legacy free first + paid second reads free';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2C FP PASS: a free first option beside a paid one is paid and saves back';
END $fp$;

-- ─── FX / TP  an explicit free choice; a priced ticket beats a stale "free" ─
DO $fx$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000f2';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, pg_temp.payload(true, 'whole', 0, NULL, NULL));
  v_res := pg_temp.try_publish(v_event, pg_temp.payload(true, 'whole', 0, NULL, NULL));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'FX FAIL: a free experience did not publish: %', v_res; END IF;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM true
     OR (pg_temp.readback(v_event)->>'is_free')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FX FAIL: an explicit free choice does not read free';
  END IF;
  -- Ari's ticket tier tool can price the ticket without passing these
  -- writers: the price wins over the stored "free".
  UPDATE public.ticket_types SET price_cents = 500000, is_free = false
   WHERE event_id = v_event AND deleted_at IS NULL;
  IF public.issue_3645_experience_is_free(v_event) IS DISTINCT FROM false
     OR (pg_temp.readback(v_event)->>'is_free')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TP FAIL: a priced ticket reads free under a stale stored choice';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2C FX/TP PASS: an explicit free choice reads free; a priced ticket always reads paid';
END $fx$;

-- ─── LG  rows saved before the choice was stored ───────────────────────────
DO $lg$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000a9';
  v_free uuid;
  v_paid uuid;
  v_zero uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_free := pg_temp.draft(v_brand, pg_temp.payload(true, 'whole', 0, NULL, NULL));
  v_paid := pg_temp.draft(v_brand, pg_temp.payload(false, 'whole', 500000, NULL, NULL));
  UPDATE public.events SET theme = theme #- '{experience_meta,is_free}' WHERE id IN (v_free, v_paid);
  IF pg_temp.meta_free(v_free) IS NOT NULL OR pg_temp.meta_free(v_paid) IS NOT NULL THEN
    RAISE EXCEPTION 'LG fixture FAIL: the legacy rows still store a choice';
  END IF;
  IF (pg_temp.readback(v_free)->>'is_free')::boolean IS DISTINCT FROM true
     OR (pg_temp.readback(v_paid)->>'is_free')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'LG FAIL: legacy rows do not keep their derived value';
  END IF;
  -- A theme without experience_meta: the save still stores it.
  v_zero := pg_temp.draft(v_brand, pg_temp.payload(false, 'whole', 0, NULL, NULL));
  UPDATE public.events SET theme = '{}'::jsonb WHERE id = v_zero;
  v_res := pg_temp.try_publish(v_zero, pg_temp.payload(false, 'whole', 0, NULL, NULL), false);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'LG FAIL: the save was refused: %', v_res; END IF;
  IF pg_temp.meta_free(v_zero) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'LG FAIL: a theme with no experience_meta lost the choice (%)', pg_temp.meta_free(v_zero);
  END IF;
  -- (theme is NOT NULL; an experience_meta that is not an object is replaced.)
  UPDATE public.events SET theme = '{"experience_meta": "legacy"}'::jsonb WHERE id = v_zero;
  v_res := pg_temp.try_publish(v_zero, pg_temp.payload(false, 'whole', 0, NULL, NULL), false);
  IF v_res IS NOT NULL OR pg_temp.meta_free(v_zero) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'LG FAIL: a non-object experience_meta lost the choice (%; %)', v_res, pg_temp.meta_free(v_zero);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2C LG PASS: rows without a stored choice keep their derived value; a bare theme stores it';
END $lg$;

-- ─── LV  live edits keep and change the choice ─────────────────────────────
DO $lv$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000b2';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'whole', 500000, NULL, NULL));
  v_res := pg_temp.try_publish(v_event, pg_temp.payload(false, 'whole', 500000, NULL, NULL));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'LV fixture FAIL: %', v_res; END IF;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LV FAIL: paid not stored'; END IF;
  v_res := pg_temp.try_live(v_event, pg_temp.payload(true, 'whole', 0, NULL, NULL));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'LV FAIL: marking it free was refused: %', v_res; END IF;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM true THEN RAISE EXCEPTION 'LV FAIL: free not stored'; END IF;
  -- An edit that does not touch the price keeps the stored choice.
  v_res := pg_temp.try_ari(v_event, '{"description": "Now with a longer walk between stops."}', 'update');
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'LV FAIL: a description edit was refused: %', v_res; END IF;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM true
     OR (pg_temp.readback(v_event)->>'is_free')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'LV FAIL: a description edit changed the choice';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2C LV PASS: a live edit stores the choice; an unrelated edit keeps it';
END $lv$;

-- ─── AU / CR  Ari merges keep it; both create branches store it ────────────
DO $au$
DECLARE
  v_brand uuid := '3645c2c0-0000-4000-8000-0000000000c1';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'whole', 0, NULL, NULL));
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CR FAIL: create (draft) did not store the paid choice';
  END IF;
  v_res := pg_temp.try_ari(v_event, '{"title": "Renamed by Ari"}', 'update');
  IF v_res IS NOT NULL OR pg_temp.meta_free(v_event) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AU FAIL: an Ari update without is_free changed the choice (%)', v_res;
  END IF;
  v_res := pg_temp.try_ari(v_event, '{"is_free": true}', 'update');
  IF v_res IS NOT NULL OR pg_temp.meta_free(v_event) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AU FAIL: Ari marking it free did not store it (%)', v_res;
  END IF;
  PERFORM pg_temp.as_host();
  v_event := (public.biz_create_experience(v_brand, pg_temp.payload(true, 'whole', 0, NULL, NULL), true)
    ->'event'->>'id')::uuid;
  IF pg_temp.meta_free(v_event) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CR FAIL: create (publish) did not store the free choice';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2C AU/CR PASS: Ari merges keep the choice; both create branches store it';
END $au$;

-- ─── K1  the patches are live, once each, and #4420's line is kept ─────────
DO $k1$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.issue_1973_current_experience_payload(uuid)'::regprocedure;
  IF v_src NOT LIKE '%issue_3645_experience_is_free(p_event_id)%'
     OR v_src LIKE '%COALESCE(v_ticket.is_free,v_event.whole_price_cents=0)%' THEN
    RAISE EXCEPTION 'K1 FAIL: the read-back does not use the one rule';
  END IF;
  FOR v_src IN SELECT prosrc FROM pg_proc WHERE oid IN (
    'public.biz_publish_experience(uuid,jsonb,boolean)'::regprocedure,
    'public.biz_update_live_experience(uuid,jsonb,text)'::regprocedure)
  LOOP
    IF (length(v_src) - length(replace(v_src, 'issue_3645_theme_with_is_free(theme, v_is_free)', '')))
       / length('issue_3645_theme_with_is_free(theme, v_is_free)') <> 1
       OR v_src NOT LIKE '%issue_4420_stored_venue_text(theme, v_stops->0)%' THEN
      RAISE EXCEPTION 'K1 FAIL: a writer does not store the choice exactly once, or lost #4420';
    END IF;
  END LOOP;
  RAISE NOTICE 'ISSUE-3645-2C K1 PASS: the patches are live once each and #4420''s line is kept';
END $k1$;

ROLLBACK;
