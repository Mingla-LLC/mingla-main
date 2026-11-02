-- Issue #3355 P6 — Seth's decisions 5 and 6 on the server (implementor happy
-- path + edges) for migration
-- 20280228003355_issue_3355_paid_tier_terms_and_minimums.sql.
--
--   D5: a teammate who never accepted the Organiser Terms is refused when they
--       turn a live free event paid (direct tier write AND the live tier patch
--       RPC business_patch_event_ticket_tiers); a Terms-accepted teammate
--       passes; drafts are untouched.
--   D6: a new paid price below the provider minimum is refused, the exact
--       minimum passes, a currency with no verified minimum is not checked,
--       and an existing below-minimum row is left alone (other edits and an
--       unchanged price still save; nothing is backfilled).
--   No publish regression: a valid paid publish and a valid free publish
--   through business_publish_event_draft still succeed; a below-minimum paid
--   publish is refused.
--
-- FAILS-ON-REVERT: drop trigger trg_zz_issue_3355_ticket_type_paid_price_rules
-- (or delete either rule from issue_3355_ticket_type_paid_price_rules) and the
-- matching block below raises.
-- Every row is synthetic and rolled back.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355pm$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000006a1';
  v_terms_mgr uuid := '33550000-0000-4000-8000-0000000006a2';
  v_plain_mgr uuid := '33550000-0000-4000-8000-0000000006a3';
  v_brand uuid := '33550000-0000-4000-8000-0000000006b1';
  v_ngn_brand uuid := '33550000-0000-4000-8000-0000000006b2';
  v_live uuid := '33550000-0000-4000-8000-0000000006c1';
  v_live2 uuid := '33550000-0000-4000-8000-0000000006c2';
  v_draft uuid := '33550000-0000-4000-8000-0000000006c3';
  v_paid_draft uuid := '33550000-0000-4000-8000-0000000006c4';
  v_free_draft uuid := '33550000-0000-4000-8000-0000000006c5';
  v_low_draft uuid := '33550000-0000-4000-8000-0000000006c6';
  v_ngn_live uuid := '33550000-0000-4000-8000-0000000006c7';
  v_free_tier uuid := '33550000-0000-4000-8000-0000000006d1';
  v_free_tier2 uuid := '33550000-0000-4000-8000-0000000006d2';
  v_old_tier uuid := '33550000-0000-4000-8000-0000000006d3';
  v_failed boolean;
  v_state text;
  v_status text;
  v_count integer;
  v_price integer;
  v_updated timestamptz;
  v_def text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'owner-3355pm@example.invalid'),
    (v_terms_mgr,'terms-3355pm@example.invalid'),
    (v_plain_mgr,'plain-3355pm@example.invalid');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code,city)
  VALUES
    (v_brand,v_owner,'Lantern Money Club','lantern-3355pm','GBP','GB','London'),
    (v_ngn_brand,v_owner,'Lagos Money Club','lagos-3355pm','NGN','NG','Lagos');
  UPDATE public.brand_team_members
  SET mingla_tos_version_accepted='1.0', mingla_tos_accepted_at=now(),
      accepted_at=COALESCE(accepted_at,now())
  WHERE brand_id IN (v_brand,v_ngn_brand) AND user_id=v_owner;
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,
    mingla_tos_version_accepted,mingla_tos_accepted_at) VALUES
    (v_brand,v_terms_mgr,'event_manager',now(),'1.0',now()),
    (v_brand,v_plain_mgr,'event_manager',now(),NULL,NULL),
    (v_ngn_brand,v_plain_mgr,'event_manager',now(),NULL,NULL);
  INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,
    detached_at,country,default_currency,created_at,updated_at)
  VALUES (v_brand,'acct_3355pm_ready',true,NULL,'GB','GBP',now(),now());

  -- Catalogue seal: the rule is a trigger on ticket_types, no table constraint.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.ticket_types'::regclass
      AND tgname='trg_zz_issue_3355_ticket_type_paid_price_rules'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'the paid price rules trigger is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ticket_types'::regclass AND conname ILIKE '%minimum%'
  ) THEN
    RAISE EXCEPTION 'no minimum constraint may be added (existing rows must stay valid)';
  END IF;
  -- The Terms helper is reused, never rewritten.
  v_def := pg_get_functiondef('public.biz_require_current_organiser_terms(uuid,uuid)'::regprocedure);
  IF position('mingla_tos_not_accepted' IN v_def) = 0 THEN
    RAISE EXCEPTION 'biz_require_current_organiser_terms changed shape';
  END IF;

  -- Fixtures as the system (no signed-in member): live free events + a draft.
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
  VALUES
    (v_live,v_brand,'Free supper','free-supper-3355pm','event','scheduled','public','Europe/London','GBP'),
    (v_live2,v_brand,'Free brunch','free-brunch-3355pm','event','scheduled','public','Europe/London','GBP'),
    (v_draft,v_brand,'Draft supper','draft-supper-3355pm','event','draft','draft','Europe/London','GBP'),
    (v_ngn_live,v_ngn_brand,'Lagos free','lagos-free-3355pm','event','scheduled','public','Africa/Lagos','NGN');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total)
  VALUES
    (v_free_tier,v_live,'Free entry',0,'GBP',true,50),
    (v_free_tier2,v_live2,'Free entry',0,'GBP',true,50);

  -- ── D5: a teammate without Terms cannot turn a live free event paid ───────
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_plain_mgr,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_plain_mgr::text,true);
  v_failed := false;
  BEGIN
    UPDATE public.ticket_types SET is_free=false, price_cents=1500 WHERE id=v_free_tier;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%mingla_tos_not_accepted%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'D5: a non-Terms teammate turned a live free tier paid';
  END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total)
    VALUES (v_live,'VIP',2500,'GBP',false,10);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%mingla_tos_not_accepted%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'D5: a non-Terms teammate added a paid tier to a live free event';
  END IF;

  -- The real live patch path (the gap): business_patch_event_ticket_tiers.
  SELECT updated_at INTO v_updated FROM public.events WHERE id=v_live;
  v_failed := false;
  BEGIN
    PERFORM public.business_patch_event_ticket_tiers(
      v_live,
      jsonb_build_array(jsonb_build_object(
        'id', v_free_tier::text, 'name', 'Free entry', 'isFree', false,
        'priceGbp', 15, 'capacity', 50, 'isUnlimited', false)),
      v_updated, NULL, NULL, 'Turning this night into a paid supper');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%mingla_tos_not_accepted%';
    IF NOT v_failed THEN
      RAISE EXCEPTION 'D5: live patch refused for the wrong reason: %', SQLERRM;
    END IF;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'D5: business_patch_event_ticket_tiers let a non-Terms teammate go paid';
  END IF;
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id=v_free_tier;
  IF v_price <> 0 THEN
    RAISE EXCEPTION 'D5: the refused change must not be saved (price %)', v_price;
  END IF;

  -- Drafts are checked at publish, not here: the same teammate may price a draft.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total)
  VALUES (v_draft,'Early bird',1200,'GBP',false,20);

  -- A Terms-accepted teammate passes, via the live patch RPC.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_terms_mgr,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_terms_mgr::text,true);
  SELECT updated_at INTO v_updated FROM public.events WHERE id=v_live;
  PERFORM public.business_patch_event_ticket_tiers(
    v_live,
    jsonb_build_array(jsonb_build_object(
      'id', v_free_tier::text, 'name', 'Free entry', 'isFree', false,
      'priceGbp', 15, 'capacity', 50, 'isUnlimited', false)),
    v_updated, NULL, NULL, 'Turning this night into a paid supper');
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id=v_free_tier;
  IF v_price <> 1500 THEN
    RAISE EXCEPTION 'D5: Terms-accepted teammate must turn the event paid (price %)', v_price;
  END IF;
  -- and with a direct write on the other live event.
  UPDATE public.ticket_types SET is_free=false, price_cents=900 WHERE id=v_free_tier2;

  -- Once the event is paid, the non-Terms teammate's further price edits are
  -- not a free→paid change (decision 5 is about turning it paid).
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_plain_mgr,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_plain_mgr::text,true);
  UPDATE public.ticket_types SET price_cents=1600 WHERE id=v_free_tier;

  -- ── D6: provider minimum on new or changed prices ────────────────────────
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_failed := false;
  BEGIN
    INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total)
    VALUES (v_live,'Too cheap',29,'GBP',false,10);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'ticket_price_below_minimum';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'D6: a new 29p ticket must be refused (GBP minimum 30p)';
  END IF;
  v_failed := false;
  BEGIN
    UPDATE public.ticket_types SET price_cents=20 WHERE id=v_free_tier;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'ticket_price_below_minimum';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'D6: changing a price to 20p must be refused';
  END IF;
  -- The exact minimum passes.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total)
  VALUES (v_live,'Exactly the minimum',30,'GBP',false,10);
  -- A currency with no verified minimum is not checked.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total)
  VALUES (v_ngn_live,'Small naira',100,'NGN',false,10);
  -- A free tier is never checked.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total)
  VALUES (v_live,'Guest list',0,'GBP',true,10);

  -- An existing below-minimum row (written before this rule) stays valid.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total)
  VALUES (v_old_tier,v_live,'Legacy 20p',20,'GBP',false,10);
  SET LOCAL session_replication_role = origin;
  UPDATE public.ticket_types SET name='Legacy 20p (renamed)', quantity_total=12
  WHERE id=v_old_tier;
  UPDATE public.ticket_types SET price_cents=20 WHERE id=v_old_tier;
  SELECT price_cents INTO v_price FROM public.ticket_types WHERE id=v_old_tier;
  IF v_price <> 20 THEN
    RAISE EXCEPTION 'D6: the existing below-minimum row must be untouched (price %)', v_price;
  END IF;
  v_failed := false;
  BEGIN
    UPDATE public.ticket_types SET price_cents=25 WHERE id=v_old_tier;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'ticket_price_below_minimum';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'D6: changing an old row to another below-minimum price must be refused';
  END IF;

  -- ── No publish regression ────────────────────────────────────────────────
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone)
  VALUES
    (v_paid_draft,v_brand,'Paid draft','paid-draft-3355pm','event','draft','draft','UTC'),
    (v_free_draft,v_brand,'Free draft','free-draft-3355pm','event','draft','draft','UTC'),
    (v_low_draft,v_brand,'Low draft','low-draft-3355pm','event','draft','draft','UTC');

  -- A valid PAID publish (owner, Terms accepted, brand can collect, £10).
  PERFORM public.business_publish_event_draft(v_paid_draft, jsonb_build_object(
    'title', 'Paid Supper Club',
    'timezone', 'UTC',
    'is_online', true,
    'online_url', 'https://example.com/live/3355pm',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      'requestedVisibility', 'public',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Standard', 'isFree', false, 'price', 10, 'capacity', 100,
        'availableAt', 'both')),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('exclusive', 'vibrant', 'artsy'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));
  SELECT status INTO v_status FROM public.events WHERE id=v_paid_draft;
  SELECT count(*) INTO v_count FROM public.ticket_types
  WHERE event_id=v_paid_draft AND deleted_at IS NULL AND price_cents=1000 AND NOT is_free;
  IF v_status <> 'scheduled' OR v_count <> 1 THEN
    RAISE EXCEPTION 'valid paid publish must still succeed (status %, paid tiers %)', v_status, v_count;
  END IF;

  -- A valid FREE publish.
  PERFORM public.business_publish_event_draft(v_free_draft, jsonb_build_object(
    'title', 'Free Supper Club',
    'timezone', 'UTC',
    'is_online', true,
    'online_url', 'https://example.com/live/3355pm-free',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      'requestedVisibility', 'public',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('exclusive', 'vibrant', 'artsy'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));
  SELECT status INTO v_status FROM public.events WHERE id=v_free_draft;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'valid free publish must still succeed (status %)', v_status;
  END IF;

  -- A below-minimum paid publish is refused, and nothing is published.
  v_failed := false;
  BEGIN
    PERFORM public.business_publish_event_draft(v_low_draft, jsonb_build_object(
      'title', 'Too Cheap Supper',
      'timezone', 'UTC',
      'is_online', true,
      'online_url', 'https://example.com/live/3355pm-low',
      'theme', jsonb_build_object('business_draft', jsonb_build_object(
        'format', 'online',
        'requestedVisibility', 'public',
        'tickets', jsonb_build_array(jsonb_build_object(
          'name', 'Cheap', 'isFree', false, 'price', 0.2, 'capacity', 100,
          'availableAt', 'both')),
        'partyTypes', jsonb_build_array('festival'),
        'vibeTags', jsonb_build_array('exclusive', 'vibrant', 'artsy'),
        'whenMode', 'single',
        'when', jsonb_build_object(
          'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
          'doorsOpen', '20:00', 'endsAt', '23:00')
      ))
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'ticket_price_below_minimum';
    IF NOT v_failed THEN
      RAISE EXCEPTION 'below-minimum publish refused for the wrong reason: %', SQLERRM;
    END IF;
  END;
  SELECT status INTO v_status FROM public.events WHERE id=v_low_draft;
  IF NOT v_failed OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'a 20p paid publish must be refused and stay a draft (status %)', v_status;
  END IF;
END;
$i3355pm$;

ROLLBACK;

\echo 'issue #3355 P6 paid tier Terms and minimums PASS'
