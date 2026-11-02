-- MINGLA-INVARIANT: I-BRAND-ADDRESS-SAVE-CLEARS-FINDINGS | issue #3355 | Brand Edit's structured address save (address + city + country + point, as the signed-in member through RLS) closes the address and city/country stale/conflict findings and the readiness read shows them resolved.
-- MINGLA-INVARIANT: I-HOME-NOT-NOW-NEVER-HIDES | issue #3355 | Ari's brand-wide "not now" leaves the item in the readiness list Home reads, with its true state (Home always shows every outstanding item; the Host never sets or reads a deferral); only someone who can fix the item may set it; blocking money items refuse it.
--
-- Issue #3355 P5 — Home consumes readiness (implementor happy path +
-- adversarial). Runs the exact write Brand Edit now makes, under the
-- `authenticated` role with the member's JWT, so RLS, the column set and the
-- P2 evidence trigger are all exercised together. Everything rolls back.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355p5$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000005a1';
  v_admin uuid := '33550000-0000-4000-8000-0000000005a2';
  v_manager uuid := '33550000-0000-4000-8000-0000000005a3';
  v_scanner uuid := '33550000-0000-4000-8000-0000000005a4';
  v_brand uuid := '33550000-0000-4000-8000-0000000005b1';
  v_hold uuid := '33550000-0000-4000-8000-0000000005b2';
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-3355p5@example.invalid','{"full_name":"Ada Owner"}'),
    (v_admin,'admin-3355p5@example.invalid','{"full_name":"Bo Admin"}'),
    (v_manager,'manager-3355p5@example.invalid','{}'),
    (v_scanner,'scanner-3355p5@example.invalid','{}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,description,
    contact_email,address,city,country_code)
  VALUES
    (v_brand,v_owner,'Lantern Supper Club','lantern-3355p5','GBP',
      'Supper clubs in railway arches.','hello@lantern.example',
      '1 Old Arch, London','London','GB'),
    (v_hold,v_owner,'Harmattan Nights','harmattan-3355p5','NGN',
      'Rooftop sets in Lagos.','hi@harmattan.example',NULL,'Lagos','NG');
  UPDATE public.brand_team_members
  SET accepted_at=COALESCE(accepted_at,now())
  WHERE brand_id IN (v_brand,v_hold) AND user_id=v_owner;
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_admin,'brand_admin',now()),
    (v_brand,v_manager,'event_manager',now()),
    (v_brand,v_scanner,'scanner',now());

  -- Ari recorded findings against the old address and its city/country.
  INSERT INTO public.brand_context_field_evidence(
    brand_id,field_key,disposition,source_type,source_ref,source_url,observed_at,evidence_candidates)
  VALUES
    (v_brand,'address','stale','public_research','search:p5a','https://lantern.example/old',now(),
      '[{"value":"1 Old Arch","source_type":"public_research","source_ref":"p5a","source_url":"https://lantern.example/old","observed_at":"2026-10-01T00:00:00Z"}]'),
    (v_brand,'city_country','conflict','public_research','search:p5b','https://lantern.example/where',now(),
      '[{"value":"London, GB","source_type":"public_research","source_ref":"p5b","source_url":"https://lantern.example/a","observed_at":"2026-10-01T00:00:00Z"},{"value":"Margate, GB","source_type":"public_research","source_ref":"p5c","source_url":"https://lantern.example/b","observed_at":"2026-10-01T00:00:00Z"}]');

  -- Paystack hold rail: sells before it has a bank.
  UPDATE public.brands SET payment_provider='paystack', payout_country='NG',
    payout_hold_cutover_at=now()
  WHERE id=v_hold;
END;
$i3355p5$;

-- ── As the signed-in owner, through RLS (the Host's PostgREST path) ────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"33550000-0000-4000-8000-0000000005a1","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','33550000-0000-4000-8000-0000000005a1',true);

DO $i3355p5_owner$
DECLARE
  v_brand uuid := '33550000-0000-4000-8000-0000000005b1';
  v_hold uuid := '33550000-0000-4000-8000-0000000005b2';
  v_r jsonb;
  v_item jsonb;
  v_failed boolean;
  v_rows integer;
BEGIN
  v_r := public.brand_readiness(v_brand);
  IF (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item
      WHERE item->>'key'='address') <> 'stale'
     OR (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item
      WHERE item->>'key'='city_country') <> 'conflict' THEN
    RAISE EXCEPTION 'fixture: address must start stale and city/country in conflict: %', v_r->'items';
  END IF;

  -- Brand Edit's structured address save: one UPDATE carrying the address,
  -- the city and country from the picked place, and its point.
  UPDATE public.brands
  SET address='12 Harbour Street, Margate CT9 1EU',
      city='Margate', country_code='GB', lat=51.3891, lng=1.3863
  WHERE id=v_brand AND deleted_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'the owner''s Brand Edit address save must pass RLS (rows=%)', v_rows;
  END IF;

  v_r := public.brand_readiness(v_brand);
  FOR v_item IN SELECT item FROM jsonb_array_elements(v_r->'items') item
    WHERE item->>'key' IN ('address','city_country') LOOP
    IF v_item->>'state' <> 'verified' THEN
      RAISE EXCEPTION 'Brand Edit must clear the stale Ari flag on %: %', v_item->>'key', v_item;
    END IF;
  END LOOP;
  IF (SELECT item->>'value_preview' FROM jsonb_array_elements(v_r->'items') item
      WHERE item->>'key'='city_country') <> 'Margate, GB' THEN
    RAISE EXCEPTION 'city/country must read back what Brand Edit saved: %', v_r->'items';
  END IF;

  -- Ari's "not now" never removes the item from the read Home uses (Seth
  -- 2026-11-01): it stays, true state, and blocks nothing new.
  PERFORM public.brand_readiness_defer(v_brand,'contact_phone',NULL);
  v_r := public.brand_readiness(v_brand);
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item
  WHERE item->>'key'='contact_phone';
  IF v_item IS NULL OR v_item->>'state' <> 'missing'
     OR v_item->'deferral'->>'by_display_name' <> 'Ada Owner'
     OR v_item->'deferral'->>'until' IS NOT NULL
     OR (v_item->>'blocks_action')::boolean THEN
    RAISE EXCEPTION 'a skipped item stays listed, missing, with who and no expiry: %', v_item;
  END IF;
  PERFORM public.brand_readiness_undefer(v_brand,'contact_phone');
  SELECT item INTO v_item FROM jsonb_array_elements(public.brand_readiness(v_brand)->'items') item
  WHERE item->>'key'='contact_phone';
  IF v_item->'deferral' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'undefer must clear the deferral: %', v_item;
  END IF;

  -- Adversarial: the can-sell blocker cannot be set aside.
  v_failed := false;
  BEGIN PERFORM public.brand_readiness_defer(v_brand,'money.can_sell',NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'readiness_item_not_deferrable'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'money.can_sell must refuse Not now'; END IF;

  -- Adversarial (publish form, C8): the Paystack hold-rail brand can sell.
  v_r := public.brand_readiness(v_hold);
  IF (v_r->'money'->>'can_sell')::boolean IS NOT TRUE
     OR v_r->'money'->>'rail' <> 'paystack_hold' THEN
    RAISE EXCEPTION 'hold-rail brand must read can_sell=true on the hold rail: %', v_r->'money';
  END IF;
END;
$i3355p5_owner$;

-- ── Event manager: sees the rows, cannot fix or skip them (C9) ─────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"33550000-0000-4000-8000-0000000005a3","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','33550000-0000-4000-8000-0000000005a3',true);

DO $i3355p5_manager$
DECLARE
  v_brand uuid := '33550000-0000-4000-8000-0000000005b1';
  v_item jsonb;
  v_failed boolean;
BEGIN
  SELECT item INTO v_item FROM jsonb_array_elements(public.brand_readiness(v_brand)->'items') item
  WHERE item->>'key'='contact_phone';
  IF (v_item->'fix'->>'can_caller_fix')::boolean
     OR v_item->'fix'->>'who_can_fix' <> 'a brand admin or the owner' THEN
    RAISE EXCEPTION 'event manager: phone must say who can fix it: %', v_item;
  END IF;
  SELECT item INTO v_item FROM jsonb_array_elements(public.brand_readiness(v_brand)->'items') item
  WHERE item->>'key'='money.can_sell';
  IF (v_item->'fix'->>'can_caller_fix')::boolean
     OR v_item->'fix'->>'who_can_fix' <> 'the brand owner' THEN
    RAISE EXCEPTION 'event manager: can-sell must point at the owner: %', v_item;
  END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_readiness_defer(v_brand,'contact_phone',NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'readiness_defer_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an event manager must not set a brand-wide Not now'; END IF;
END;
$i3355p5_manager$;

-- ── Scanner: may read (rank 10) but can fix nothing on the profile ─────────
SELECT set_config('request.jwt.claims',
  '{"sub":"33550000-0000-4000-8000-0000000005a4","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','33550000-0000-4000-8000-0000000005a4',true);

DO $i3355p5_scanner$
DECLARE
  v_brand uuid := '33550000-0000-4000-8000-0000000005b1';
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM jsonb_array_elements(public.brand_readiness(v_brand)->'items') item
  WHERE item->>'group' IN ('identity','contact','location','media')
    AND (item->'fix'->>'can_caller_fix')::boolean;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'a scanner can fix no profile item (got %)', v_count;
  END IF;
  -- And cannot write the brand through RLS either.
  UPDATE public.brands SET city='Nowhere' WHERE id=v_brand;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'a scanner must not edit the brand'; END IF;
END;
$i3355p5_scanner$;

RESET ROLE;

-- ── Back as postgres: the resolution is recorded with who and why ──────────
DO $i3355p5_audit$
BEGIN
  IF (SELECT count(*) FROM public.brand_context_field_evidence
      WHERE brand_id='33550000-0000-4000-8000-0000000005b1'
        AND field_key IN ('address','city_country')
        AND disposition='verified' AND resolved_reason='value_changed'
        AND resolved_by='33550000-0000-4000-8000-0000000005a1') <> 2 THEN
    RAISE EXCEPTION 'both findings must be closed by the owner''s Brand Edit save';
  END IF;
END;
$i3355p5_audit$;

ROLLBACK;
