-- MINGLA-INVARIANT: I-BRAND-READINESS-ONE-SERVER-ANSWER | issue #3355 | brand_readiness(brand, action) is the one server answer to "what is this brand missing and does it block this action"; Ari's snapshot and launch plan read it (Deno guard: supabase/functions/_shared/__tests__/issue_3355_brand_readiness.implementor.test.ts).
-- MINGLA-INVARIANT: I-BRAND-EVIDENCE-CLEARS-ON-WRITE | issue #3355 | A member's direct brands update (Brand Edit) closes that field's stale/conflict finding; writes with no member behind them never award a tick.
-- MINGLA-INVARIANT: I-READINESS-DEFERRAL-NEVER-UNBLOCKS | issue #3355 | A brand-wide "not now" never changes blocks_action and never hides the item.
--
-- Issue #3355 P2 — canonical readiness read (implementor happy path + edges).
-- Reverting the migration, the evidence trigger, the one social predicate, the
-- deferral rules or the money split makes a block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355br$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000002a1';
  v_manager uuid := '33550000-0000-4000-8000-0000000002a2';
  v_scanner uuid := '33550000-0000-4000-8000-0000000002a3';
  v_finance uuid := '33550000-0000-4000-8000-0000000002a4';
  v_stranger uuid := '33550000-0000-4000-8000-0000000002a5';
  v_brand uuid := '33550000-0000-4000-8000-0000000002b1';
  v_r jsonb;
  v_item jsonb;
  v_failed boolean;
  v_count integer;
  v_text text;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-3355br@example.invalid','{"full_name":"Ada Owner"}'),
    (v_manager,'manager-3355br@example.invalid','{}'),
    (v_scanner,'scanner-3355br@example.invalid','{}'),
    (v_finance,'finance-3355br@example.invalid','{}'),
    (v_stranger,'stranger-3355br@example.invalid','{}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,description,
    contact_email,social_links,country_code,city)
  VALUES (v_brand,v_owner,'Lantern Supper Club','lantern-3355br','GBP',
    'Supper clubs in railway arches.','hello@lantern.example','{"instagram":""}','GB','London');
  UPDATE public.brand_team_members
  SET mingla_tos_version_accepted='1.0', mingla_tos_accepted_at=now(), accepted_at=COALESCE(accepted_at,now())
  WHERE brand_id=v_brand AND user_id=v_owner;
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_manager,'event_manager',now()),
    (v_brand,v_scanner,'scanner',now()),
    (v_brand,v_finance,'finance_manager',now());

  -- ── Owner view ──────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  v_r := public.brand_readiness(v_brand,'draft_save');
  IF (v_r->>'can_proceed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'owner draft_save must proceed with a thin profile and no money: %', v_r->'counts';
  END IF;
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='contact_phone';
  IF v_item->>'state' <> 'missing' OR (v_item->>'blocks_action')::boolean
     OR v_item->>'severity' <> 'skippable' THEN
    RAISE EXCEPTION 'blank phone is missing but blocks nothing for draft_save: %', v_item;
  END IF;
  IF v_item->'fix'->>'route' <> '/brand/' || v_brand || '/edit'
     OR (v_item->'fix'->>'can_caller_fix')::boolean IS NOT TRUE
     OR v_item->'ask'->>'control' <> 'phone_e164' THEN
    RAISE EXCEPTION 'phone item must carry the Host route, owner fix and phone control: %', v_item;
  END IF;

  -- Seth #3: money never blocks a draft (paid tiers allowed in drafts).
  IF EXISTS (SELECT 1 FROM public.brand_readiness_catalog
             WHERE key LIKE 'money.%' AND 'draft_save' = ANY(blocking_for)) THEN
    RAISE EXCEPTION 'no money item may block draft_save';
  END IF;
  -- Seth #1: contact email never blocks publishing.
  IF EXISTS (SELECT 1 FROM public.brand_readiness_catalog
             WHERE key='contact_email'
               AND blocking_for && ARRAY['publish_free','publish_paid','trip_installments','stay_publish','venue_submit']) THEN
    RAISE EXCEPTION 'contact email must never block publishing';
  END IF;

  -- C1: one social predicate. {"instagram":""} is not "has socials".
  v_r := public.brand_readiness(v_brand);
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='social_links';
  IF v_item->>'state' <> 'missing' THEN
    RAISE EXCEPTION 'an empty instagram string must not count as a social link: %', v_item;
  END IF;
  -- C4: a single paragraph has no tagline.
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='tagline';
  IF v_item->>'state' <> 'missing' THEN
    RAISE EXCEPTION 'single-paragraph description has no tagline: %', v_item;
  END IF;
  -- With no action, nothing blocks and action-scoped items are absent.
  IF (v_r->'counts'->>'blocking')::int <> 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'items') i WHERE i->>'key' IN ('team.role','venue.approved_exists')) THEN
    RAISE EXCEPTION 'no-action read blocks nothing and omits action-scoped items';
  END IF;

  -- Custom link counts (Host never stores blank networks); two paragraphs give a tagline.
  UPDATE public.brands SET social_links='{}', custom_links='[{"label":"Menu","url":"https://lantern.example/menu"}]',
    description = E'Supper under the arches\n\nSupper clubs in railway arches.'
  WHERE id=v_brand;
  v_r := public.brand_readiness(v_brand);
  IF (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='social_links') <> 'verified'
     OR (SELECT item->>'value_preview' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='social_links') <> '1 link' THEN
    RAISE EXCEPTION 'a custom link counts as a public link';
  END IF;
  IF (SELECT item->>'value_preview' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='tagline')
       <> 'Supper under the arches' THEN
    RAISE EXCEPTION 'tagline uses the Home double-newline split';
  END IF;

  -- ── Not now: remembered, brand-wide, visible, never unblocking ──────────
  v_r := public.brand_readiness_defer(v_brand,'contact_phone','We use email only for now');
  v_item := v_r->'item';
  IF v_item->>'state' <> 'missing' OR v_item->'deferral' IS NULL
     OR v_item->'deferral'->>'by_user_id' <> v_owner::text
     OR v_item->'deferral'->>'by_display_name' <> 'Ada Owner'
     OR v_item->'deferral'->>'at' IS NULL
     OR v_item->'deferral'->>'reason' <> 'We use email only for now'
     OR jsonb_typeof(v_item->'deferral'->'until') <> 'null'
     OR (v_item->>'skip_in_ari')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'deferral must keep the true state and record who, when and why with no expiry: %', v_item;
  END IF;
  -- Idempotent: a second defer adds no row.
  PERFORM public.brand_readiness_defer(v_brand,'contact_phone',NULL);
  SELECT count(*) INTO v_count FROM public.brand_readiness_deferrals
  WHERE brand_id=v_brand AND item_key='contact_phone' AND cleared_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'one active deferral per brand item, got %', v_count; END IF;

  -- A teammate sees the same deferral (brand-wide, not per user).
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_manager)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  v_r := public.brand_readiness(v_brand);
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='contact_phone';
  IF v_item->'deferral'->>'by_user_id' <> v_owner::text OR (v_r->'counts'->>'deferred')::int <> 1 THEN
    RAISE EXCEPTION 'teammate must see the owner''s not-now: %', v_item;
  END IF;
  -- Role scoping: event manager cannot fix profile rows and is told who can.
  IF (v_item->'fix'->>'can_caller_fix')::boolean IS NOT FALSE
     OR v_item->'fix'->>'who_can_fix' <> 'a brand admin or the owner' THEN
    RAISE EXCEPTION 'event manager sees who can fix the phone: %', v_item->'fix';
  END IF;

  -- Deferral never unblocks: cover blocks website_build even when set aside.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM public.brand_readiness_defer(v_brand,'cover_media',NULL);
  v_r := public.brand_readiness(v_brand,'website_build');
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='cover_media';
  IF (v_item->>'blocks_action')::boolean IS NOT TRUE OR (v_item->>'skip_in_ari')::boolean
     OR v_item->'deferral' IS NULL OR (v_r->>'can_proceed')::boolean THEN
    RAISE EXCEPTION 'a deferral must never unblock a blocking item: %', v_item;
  END IF;

  -- Hard gates cannot be deferred.
  v_failed := false;
  BEGIN
    PERFORM public.brand_readiness_defer(v_brand,'money.can_sell',NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'readiness_item_not_deferrable';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'money.can_sell must not be deferrable'; END IF;
  -- Done items cannot be deferred; unknown keys refused.
  v_failed := false;
  BEGIN PERFORM public.brand_readiness_defer(v_brand,'name',NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'readiness_item_already_done'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a verified item cannot be set aside'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_readiness_defer(v_brand,'team.role',NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'readiness_item_unknown'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'action-scoped items are not brand deferrals'; END IF;

  -- Scanner reads but cannot set aside for the brand.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_scanner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_scanner::text,true);
  PERFORM public.brand_readiness(v_brand);
  v_failed := false;
  BEGIN PERFORM public.brand_readiness_defer(v_brand,'tagline',NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'readiness_defer_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'scanner cannot defer persistently'; END IF;

  -- Non-members cannot read at all.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_stranger)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_stranger::text,true);
  v_failed := false;
  BEGIN PERFORM public.brand_readiness(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLSTATE = '42501'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a non-member must not read readiness'; END IF;

  -- ── Evidence clearing on a direct brands update (Brand Edit path) ───────
  INSERT INTO public.brand_context_field_evidence(
    brand_id,field_key,disposition,source_type,source_ref,source_url,observed_at,evidence_candidates)
  VALUES
    (v_brand,'contact_email','conflict','public_research','search:1','https://lantern.example/about',now(),
      '[{"value":"a@x.example","source_type":"public_research","source_ref":"s1","source_url":"https://lantern.example/a","observed_at":"2026-10-01T00:00:00Z"},{"value":"b@x.example","source_type":"public_research","source_ref":"s2","source_url":"https://lantern.example/b","observed_at":"2026-10-01T00:00:00Z"}]'),
    (v_brand,'address','stale','public_research','search:2','https://lantern.example/old',now(),
      '[{"value":"Old Arch 1","source_type":"public_research","source_ref":"s3","source_url":"https://lantern.example/old","observed_at":"2026-10-01T00:00:00Z"}]');

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_r := public.brand_readiness(v_brand);
  IF (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='contact_email') <> 'conflict' THEN
    RAISE EXCEPTION 'fixture: email must start in conflict';
  END IF;
  v_text := v_r->>'context_revision';

  -- Brand Edit writes brands directly under the member's JWT.
  UPDATE public.brands SET contact_email='bookings@lantern.example' WHERE id=v_brand;
  v_r := public.brand_readiness(v_brand);
  IF (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='contact_email') <> 'verified' THEN
    RAISE EXCEPTION 'Brand Edit must close the email conflict (C5)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_context_field_evidence
    WHERE brand_id=v_brand AND field_key='contact_email' AND disposition='verified'
      AND source_type='owner' AND resolved_reason='value_changed' AND resolved_by=v_owner
      AND evidence_candidates='[]'::jsonb) THEN
    RAISE EXCEPTION 'resolution must be recorded with who and why';
  END IF;
  IF v_r->>'context_revision' = v_text THEN
    RAISE EXCEPTION 'context_revision must advance so open proposals fail their compare-and-set';
  END IF;
  -- Untouched fields keep their findings.
  IF (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='address') <> 'stale' THEN
    RAISE EXCEPTION 'an unrelated stale finding must survive another field''s edit';
  END IF;

  -- A write with no member behind it (service role) fires the trigger without
  -- raising and keeps today's behaviour: the finding stays.
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE public.brands SET address='2 New Arch, London' WHERE id=v_brand;
  IF NOT EXISTS (SELECT 1 FROM public.brand_context_field_evidence
    WHERE brand_id=v_brand AND field_key='address' AND disposition='stale') THEN
    RAISE EXCEPTION 'a service-role write must not award a tick';
  END IF;

  -- Resolving a deferred item clears its deferral (item_resolved), even for a
  -- service-role write; the item is no longer deferred in the read.
  UPDATE public.brands SET contact_phone='+442071234567' WHERE id=v_brand;
  IF NOT EXISTS (SELECT 1 FROM public.brand_readiness_deferrals
    WHERE brand_id=v_brand AND item_key='contact_phone' AND cleared_reason='item_resolved') THEN
    RAISE EXCEPTION 'a resolved item clears its not-now';
  END IF;

  -- Undo returns the item to the normal ask.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_r := public.brand_readiness_undefer(v_brand,'cover_media');
  IF (v_r->>'cleared')::boolean IS NOT TRUE OR v_r->'item'->'deferral' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'undefer clears the active deferral: %', v_r;
  END IF;

  -- Time zone: validated against the IANA list, then verified.
  v_failed := false;
  BEGIN UPDATE public.brands SET default_timezone='Mars/Olympus' WHERE id=v_brand;
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'invalid_timezone'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown time zones are refused'; END IF;
  UPDATE public.brands SET default_timezone='Europe/London' WHERE id=v_brand;
  IF (SELECT item->>'state' FROM jsonb_array_elements(public.brand_readiness(v_brand)->'items') item
      WHERE item->>'key'='timezone') <> 'verified' THEN
    RAISE EXCEPTION 'a saved brand time zone is verified';
  END IF;

  -- ── Money: can sell vs can be paid out, Terms per member, reconciliation ─
  v_r := public.brand_readiness(v_brand,'publish_paid');
  IF (v_r->'money'->>'can_sell')::boolean OR v_r->'money'->>'sell_reason' <> 'no_provider'
     OR (v_r->>'can_proceed')::boolean THEN
    RAISE EXCEPTION 'no provider: cannot sell, paid publish blocked: %', v_r->'money';
  END IF;

  INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency)
  VALUES (v_brand,'acct_3355br',true,false,'GB','gbp');
  v_r := public.brand_readiness(v_brand,'publish_paid');
  IF (v_r->'money'->>'can_sell')::boolean IS NOT TRUE
     OR (v_r->'money'->>'can_be_paid_out')::boolean IS NOT FALSE
     OR v_r->'money'->>'payout_reason' <> 'payouts_disabled'
     OR v_r->'money'->>'rail' <> 'stripe'
     OR (v_r->'money'->>'terms_accepted_by_caller')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'charges on, payouts off: can sell, cannot be paid out: %', v_r->'money';
  END IF;
  IF (v_r->>'can_proceed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'owner may publish paid when they can sell (payouts only warn): %',
      (SELECT jsonb_agg(i->>'key') FROM jsonb_array_elements(v_r->'items') i WHERE (i->>'blocks_action')::boolean);
  END IF;
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='money.can_be_paid_out';
  IF (v_item->>'blocks_action')::boolean OR v_item->>'severity' <> 'skippable' THEN
    RAISE EXCEPTION 'payouts are a warning for paid publish: %', v_item;
  END IF;
  v_r := public.brand_readiness(v_brand,'trip_installments');
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='money.can_be_paid_out';
  IF (v_item->>'blocks_action')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'instalment trips need payouts: %', v_item;
  END IF;

  -- The event manager never accepted the Terms: paid publish blocked for them only.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_manager)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  v_r := public.brand_readiness(v_brand,'publish_paid');
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='money.terms_member';
  IF v_item->>'state' <> 'missing' OR (v_item->>'blocks_action')::boolean IS NOT TRUE
     OR (v_item->'fix'->>'can_caller_fix')::boolean IS NOT TRUE
     OR (v_r->'money'->>'terms_accepted_by_caller')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Terms are per member: %', v_item;
  END IF;
  -- Event manager may publish (role) but not refund; finance manager may refund.
  IF (SELECT item->>'state' FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='team.role') <> 'verified' THEN
    RAISE EXCEPTION 'event manager may publish';
  END IF;
  v_r := public.brand_readiness(v_brand,'refund');
  IF (v_r->>'can_proceed')::boolean THEN
    RAISE EXCEPTION 'event manager must be refused refunds (server predicate, not rank)';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_finance)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_finance::text,true);
  v_r := public.brand_readiness(v_brand,'refund');
  IF (v_r->>'can_proceed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'finance manager may refund: %', v_r->'items';
  END IF;

  -- Pending currency reconciliation: cannot sell, cannot be paid out, the
  -- reason says why, and the item is a blocking conflict for paid publish.
  INSERT INTO public.brand_currency_reconciliations(brand_id,from_currency_code,to_currency_code,reason,status)
  VALUES (v_brand,'GBP','EUR','bank_changed','pending');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_r := public.brand_readiness(v_brand,'publish_paid');
  SELECT item INTO v_item FROM jsonb_array_elements(v_r->'items') item WHERE item->>'key'='money.currency_reconciliation';
  IF (v_r->'money'->>'can_sell')::boolean OR (v_r->'money'->>'can_be_paid_out')::boolean
     OR v_r->'money'->>'sell_reason' <> 'currency_reconciliation_pending'
     OR v_r->'money'->>'payout_reason' <> 'currency_reconciliation_pending'
     OR v_item->>'state' <> 'conflict' OR (v_item->>'blocks_action')::boolean IS NOT TRUE
     OR v_item->>'value_preview' <> 'Currency changing from GBP to EUR' THEN
    RAISE EXCEPTION 'reconciliation pending must block selling with its own reason: % %', v_r->'money', v_item;
  END IF;

  -- Closed action vocabulary.
  v_failed := false;
  BEGIN PERFORM public.brand_readiness(v_brand,'publish_everything');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'invalid_readiness_action'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown actions are refused'; END IF;

  -- Privilege: tables and internal functions are never client-readable.
  IF has_table_privilege('anon','public.brand_readiness_catalog','SELECT')
     OR has_table_privilege('authenticated','public.brand_readiness_catalog','SELECT')
     OR has_table_privilege('anon','public.brand_readiness_deferrals','SELECT')
     OR has_table_privilege('authenticated','public.brand_readiness_deferrals','SELECT')
     OR has_table_privilege('authenticated','public.brand_readiness_deferrals','INSERT')
     OR has_function_privilege('authenticated','public.brand_readiness_internal(uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.brand_readiness(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.brand_readiness(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'readiness privileges are wrong';
  END IF;
END;
$i3355br$;

ROLLBACK;
