-- #4063 W0 adversarial proof. Every rejected resubmission is byte-neutral.
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_signed_in uuid := gen_random_uuid();
  v_forwarded_link_holder uuid := gen_random_uuid();
  v_rightful_claimant uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_anon_event uuid := gen_random_uuid();
  v_signed_event uuid := gen_random_uuid();
  v_anon_rsvp uuid := gen_random_uuid();
  v_signed_rsvp uuid := gen_random_uuid();
  v_before_parents jsonb;
  v_after_parents jsonb;
  v_before_guests jsonb;
  v_after_guests jsonb;
  v_attempt record;
  v_state text;
  v_message text;
  v_claim jsonb;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, created_at, updated_at
  ) VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue4063-adv-owner@example.test',
     clock_timestamp(), clock_timestamp()),
    (v_signed_in, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'signed-victim@example.test',
     clock_timestamp(), clock_timestamp()),
    (v_forwarded_link_holder, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'forwarded-holder@example.test',
     clock_timestamp(), clock_timestamp()),
    (v_rightful_claimant, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rightful-claimant@example.test',
     clock_timestamp(), clock_timestamp());

  INSERT INTO public.creator_accounts (id, email, created_at)
  VALUES (v_owner, 'issue4063-adv-owner@example.test', clock_timestamp());

  INSERT INTO public.brands (
    id, account_id, slug, name, default_currency, created_at, updated_at
  ) VALUES (
    v_brand, v_owner, 'issue-4063-w0-adversarial', 'Issue 4063 W0 Adversarial',
    'USD', clock_timestamp(), clock_timestamp()
  );

  INSERT INTO public.events (
    id, brand_id, created_by, event_type, title, slug, description, status,
    visibility, published_at, currency, timezone, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, created_at, updated_at
  ) VALUES
    (v_anon_event, v_brand, v_owner, 'rsvp', 'Anonymous row', 'anon-row-4063', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto',
     true, 2, clock_timestamp(), clock_timestamp()),
    (v_signed_event, v_brand, v_owner, 'rsvp', 'Signed row', 'signed-row-4063', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto',
     true, 2, clock_timestamp(), clock_timestamp());

  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES
    (v_anon_event, clock_timestamp() + interval '1 hour',
     clock_timestamp() + interval '2 hours', 'UTC', true),
    (v_signed_event, clock_timestamp() + interval '1 hour',
     clock_timestamp() + interval '2 hours', 'UTC', true);

  INSERT INTO public.event_rsvps (
    id, event_id, user_id, guest_name, guest_email, guest_phone,
    guest_phone_country_iso, rsvp_status, approval_status, plus_count,
    qr_token_hash, qr_code, pass_recovery_token_hash,
    pass_recovery_token_created_at, created_at, updated_at
  ) VALUES
    (v_anon_rsvp, v_anon_event, NULL, 'Anonymous Victim',
     'anonymous-victim@example.test', '+15554063101', 'US', 'going', 'approved', 1,
     repeat('a', 64), 'mingla:v1:rsvp:anonymous-original', repeat('b', 64),
     clock_timestamp(), clock_timestamp(), clock_timestamp()),
    (v_signed_rsvp, v_signed_event, v_signed_in, 'Signed Victim',
     'signed-victim@example.test', '+15554063102', 'US', 'going', 'approved', 1,
     repeat('c', 64), 'mingla:v1:rsvp:signed-original', repeat('d', 64),
     clock_timestamp(), clock_timestamp(), clock_timestamp());

  INSERT INTO public.event_rsvp_guests (
    id, rsvp_id, name, email, phone, phone_country_iso,
    qr_token_hash, qr_code, pass_recovery_token_hash,
    pass_recovery_token_created_at, created_at
  ) VALUES
    (gen_random_uuid(), v_anon_rsvp, 'Anon Plus One',
     'anon-plus@example.test', '+15554063201', 'US', repeat('e', 64),
     'mingla:v1:rsvp:anon-plus-original', repeat('f', 64),
     clock_timestamp(), clock_timestamp()),
    (gen_random_uuid(), v_signed_rsvp, 'Signed Plus One',
     'signed-plus@example.test', '+15554063202', 'US', repeat('1', 64),
     'mingla:v1:rsvp:signed-plus-original', repeat('2', 64),
     clock_timestamp(), clock_timestamp());

  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
    INTO v_before_parents
    FROM public.event_rsvps r
   WHERE r.id IN (v_anon_rsvp, v_signed_rsvp);
  SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id)
    INTO v_before_guests
    FROM public.event_rsvp_guests g
   WHERE g.rsvp_id IN (v_anon_rsvp, v_signed_rsvp);

  FOR v_attempt IN
    SELECT * FROM (VALUES
      (v_anon_event, 'anonymous-victim@example.test'),
      (v_anon_event, ' ANONYMOUS-VICTIM@EXAMPLE.TEST '),
      (v_signed_event, 'signed-victim@example.test'),
      (v_signed_event, ' SIGNED-VICTIM@EXAMPLE.TEST ')
    ) AS attempts(event_id, email)
  LOOP
    BEGIN
      PERFORM public.submit_event_rsvp(
        v_attempt.event_id, NULL, 'Replacement', v_attempt.email,
        '+15554063999', 'not_going', 0, '[]'::jsonb,
        'issue-4063-replacement-pepper', 'US'
      );
      RAISE EXCEPTION 'anonymous resubmission unexpectedly succeeded: %', v_attempt.email;
    EXCEPTION WHEN SQLSTATE 'P4063' THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                              v_message = MESSAGE_TEXT;
      IF v_state <> 'P4063' OR v_message <> 'rsvp_already_exists' THEN
        RAISE EXCEPTION 'wrong rejection for %: % / %',
          v_attempt.email, v_state, v_message;
      END IF;
    END;
  END LOOP;

  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
    INTO v_after_parents
    FROM public.event_rsvps r
   WHERE r.id IN (v_anon_rsvp, v_signed_rsvp);
  SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id)
    INTO v_after_guests
    FROM public.event_rsvp_guests g
   WHERE g.rsvp_id IN (v_anon_rsvp, v_signed_rsvp);

  IF v_after_parents IS DISTINCT FROM v_before_parents THEN
    RAISE EXCEPTION 'rejected resubmission changed an RSVP row';
  END IF;
  IF v_after_guests IS DISTINCT FROM v_before_guests THEN
    RAISE EXCEPTION 'rejected resubmission changed a plus-one or credential row';
  END IF;

  -- A forwarded recovery link proves possession of the link, not ownership of
  -- the RSVP contact. A refusal must consume nothing so the actual contact
  -- owner can use the same link afterwards.
  v_claim := public.claim_attendance_internal_v2(
    v_forwarded_link_holder, 'rsvp', v_anon_event, v_anon_rsvp,
    decode(repeat('b', 64), 'hex')
  );
  IF v_claim->>'result' <> 'identity_mismatch'
     OR v_claim->>'contactChannel' <> 'email'
     OR v_claim::text ILIKE '%anonymous-victim@example.test%' THEN
    RAISE EXCEPTION 'forwarded RSVP link returned unsafe refusal: %', v_claim;
  END IF;
  IF (SELECT user_id IS NOT NULL
            OR pass_recovery_token_hash <> repeat('b', 64)
        FROM public.event_rsvps WHERE id = v_anon_rsvp) THEN
    RAISE EXCEPTION 'forwarded RSVP link refusal changed owner or proof';
  END IF;

  v_claim := public.claim_attendance_internal_v2(
    v_forwarded_link_holder, 'rsvp', v_anon_event, v_anon_rsvp,
    decode(repeat('b', 64), 'hex')
  );
  IF v_claim->>'result' <> 'identity_mismatch' THEN
    RAISE EXCEPTION 'forwarded RSVP link refusal consumed the proof: %', v_claim;
  END IF;

  INSERT INTO public.verified_phone_identities(user_id, phone_e164)
  VALUES (v_rightful_claimant, '+15554063101');

  v_claim := public.claim_attendance_internal_v2(
    v_rightful_claimant, 'rsvp', v_anon_event, v_anon_rsvp,
    decode(repeat('b', 64), 'hex')
  );
  IF v_claim->>'result' <> 'claimed'
     OR (SELECT user_id FROM public.event_rsvps WHERE id = v_anon_rsvp)
          IS DISTINCT FROM v_rightful_claimant THEN
    RAISE EXCEPTION 'proved RSVP contact did not claim the original link: %', v_claim;
  END IF;

  RAISE NOTICE 'issue #4063 W0 PG17 adversarial PASS';
END
$test$;

ROLLBACK;
