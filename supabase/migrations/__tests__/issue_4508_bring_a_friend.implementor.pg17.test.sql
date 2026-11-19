-- #4508 Phase 1 / Phase 2 (server) — bring a friend with just their number.
--
-- MINGLA-INVARIANT: I-4508-GUEST-NUMBER-ONLY | issue #4508 | submit_event_rsvp accepts a plus-one with only a phone number (older {name,email,phone} guests still accepted), raises rsvp_plus_ones_exceeded over the host's limit, refuses the inviter's own number, duplicates, numbers already on the event's list and released numbers, caps an inviter at 20 guest numbers per rolling 24 hours (rsvp_guest_daily_cap), and keeps a guest row (claim, pass) across a re-submit that still lists its number.
-- MINGLA-INVARIANT: I-4508-CLAIM-NEEDS-THE-NUMBER | issue #4508 | rsvp_guest_claim attaches a pass only to an account that has proved the invited number (account_owns_contact); a code proved for another number returns phone_unproved and writes nothing. On claim, inviter and guest become friends and close friends through a pairing with source rsvp_guest that check_pairing_allowed does not count; a block between them skips the friendship.
-- MINGLA-INVARIANT: I-4508-RELEASE-STOPS-TEXTS | issue #4508 | "This isn't me" (rsvp_guest_release) deletes the unclaimed guest row, frees the spot, closes queued deliveries, and the number can never be re-added to that event; a claimed guest cannot be released.
-- MINGLA-INVARIANT: I-4508-ONE-REMINDER | issue #4508 | rsvp_enqueue_guest_reminders queues at most one reminder per guest, only for unclaimed guests whose invite text was delivered, 23-24 hours before the start.
-- MINGLA-INVARIANT: I-4508-FRIEND-GOING-ONCE | issue #4508 | a close friend gets at most one "is going" notice per event, never when they turned friends_going off.
\set ON_ERROR_STOP on
\ir ../20281119004508_issue_4508_guest_phone_match.sql
\ir ../20281119014508_issue_4508_bring_a_friend.sql

BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4508 FAIL: %', p_message; END IF;
END
$fn$;

-- Runs a statement and returns the error message ('' when it succeeded).
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$fn$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', p_user::text, true);
$fn$;

DO $test$
DECLARE
  v_owner uuid := '45081000-0000-4000-8000-000000000001';
  v_brand uuid := '45081000-0000-4000-8000-000000000002';
  v_event uuid := '45081000-0000-4000-8000-000000000003';
  v_soon  uuid := '45081000-0000-4000-8000-000000000004';
  v_ada   uuid := '45081000-0000-4000-8000-000000000011'; -- inviter
  v_gus   uuid := '45081000-0000-4000-8000-000000000012'; -- guest who claims
  v_hal   uuid := '45081000-0000-4000-8000-000000000013'; -- proved another number
  v_bea   uuid := '45081000-0000-4000-8000-000000000014'; -- blocked by Ada
  v_xan   uuid := '45081000-0000-4000-8000-000000000015'; -- close friend of Yas
  v_yas   uuid := '45081000-0000-4000-8000-000000000016';
  v_zed   uuid := '45081000-0000-4000-8000-000000000017'; -- close friend, opted out
  v_res   jsonb;
  v_rsvp  uuid;
  v_guest uuid;
  v_guest2 uuid;
  v_code  text;
  v_code_bea text;
  v_err   text;
  v_count integer;
  v_pr    uuid;
  v_notif uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'i4508-owner@example.test'), (v_ada, 'i4508-ada@example.test'),
    (v_gus, 'i4508-gus@example.test'), (v_hal, 'i4508-hal@example.test'),
    (v_bea, 'i4508-bea@example.test'), (v_xan, 'i4508-xan@example.test'),
    (v_yas, 'i4508-yas@example.test'), (v_zed, 'i4508-zed@example.test');
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone) VALUES
    (v_ada, 'i4508-ada@example.test', 'Ada Obi', 'Ada', 'Obi', '+15550204501'),
    (v_gus, 'i4508-gus@example.test', 'Gus Grant', 'Gus', 'Grant', NULL),
    (v_hal, 'i4508-hal@example.test', 'Hal Hart', 'Hal', 'Hart', NULL),
    (v_bea, 'i4508-bea@example.test', 'Bea Bell', 'Bea', 'Bell', NULL),
    (v_xan, 'i4508-xan@example.test', 'Xan Xu', 'Xan', 'Xu', NULL),
    (v_yas, 'i4508-yas@example.test', 'Yas Yu', 'Yas', 'Yu', NULL),
    (v_zed, 'i4508-zed@example.test', 'Zed Zu', 'Zed', 'Zu', NULL)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = EXCLUDED.phone;
  -- Gus proved the number Ada will type; Hal proved a different one; Bea too.
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_gus, '+15550204502'), (v_hal, '+15550204599'), (v_bea, '+15550204503');

  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'i4508-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_owner, 'Issue 4508 Bring', 'issue-4508-bring', 'stripe', 'US', 'USD', 'USD',
    'host-4508b@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  VALUES
    (v_event, v_brand, v_owner, 'Rooftop Night', 'rooftop-4508', 'rsvp', 'scheduled',
     'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 2, now()),
    (v_soon, v_brand, v_owner, 'Tomorrow Jam', 'tomorrow-4508', 'rsvp', 'scheduled',
     'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 3, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_event, now() + interval '10 days', now() + interval '10 days 4 hours', 'America/New_York', true),
    (v_soon, now() + interval '23 hours 30 minutes', now() + interval '28 hours', 'America/New_York', true);

  -- ---- Happy: number-only guest ------------------------------------------
  v_res := public.submit_event_rsvp(v_event, v_ada, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 1,
    jsonb_build_array(jsonb_build_object('phone', '+15550204502', 'phoneCountryIso', 'US')),
    NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_guest FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  PERFORM pg_temp.ok(v_guest IS NOT NULL
    AND (SELECT name IS NULL AND email IS NULL AND invited_by_user_id = v_ada
           FROM public.event_rsvp_guests WHERE id = v_guest),
    'a number-only guest is stored with no name or email, invited by Ada');
  PERFORM pg_temp.ok((SELECT matched_user_id FROM public.event_rsvp_guests WHERE id = v_guest) = v_gus,
    'the number matches Gus''s proved phone');
  PERFORM pg_temp.ok(jsonb_array_length(v_res->'guests') = 1
    AND v_res->'guests'->0->>'phoneLast4' = '4502', 'the submit result lists the guest: ' || v_res::text);
  PERFORM pg_temp.ok((SELECT plus_count FROM public.event_rsvps WHERE id = v_rsvp) = 1,
    'plus_count is the guest rows');
  PERFORM pg_temp.ok((SELECT n.label FROM public.rsvp_guest_inviter_names(v_guest) n) = 'Ada O.',
    'the inviter label is "First L."');

  -- An unmatched number shows "<Inviter>'s guest".
  v_res := public.submit_event_rsvp(v_event, v_ada, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 2,
    jsonb_build_array(
      jsonb_build_object('phone', '+15550204502', 'phoneCountryIso', 'US'),
      jsonb_build_object('phone', '+15550204777', 'phoneCountryIso', 'US')),
    NULL, 'US');
  SELECT id INTO v_guest2 FROM public.event_rsvp_guests
   WHERE rsvp_id = v_rsvp AND phone = '+15550204777';
  PERFORM pg_temp.ok(public.rsvp_guest_display_name(v_guest2) = 'Ada''s guest',
    'an unclaimed unmatched guest shows as "Ada''s guest": ' || coalesce(public.rsvp_guest_display_name(v_guest2), 'NULL'));
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_guest),
    'a re-submit that still lists the number keeps the same guest row');

  -- Old payload still accepted (older app versions).
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Old App', 'old-4508@example.test',
    '+15550204600', 'going', 1, '[{"name":"Typed Name","email":"typed-4508@example.test","phone":"+15550204601","phoneCountryIso":"US"}]'::jsonb,
    NULL, 'US')$s$, v_event));
  PERFORM pg_temp.ok(v_err = '', 'the old {name,email,phone} guest payload is accepted: ' || v_err);
  PERFORM pg_temp.ok(public.rsvp_guest_display_name((SELECT g.id FROM public.event_rsvp_guests g
      WHERE g.phone = '+15550204601')) = 'Typed Name', 'a typed name is kept and shown');

  -- ---- Adversarial: submit refusals ---------------------------------------
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 1, '[{"phone":"+15550204501"}]'::jsonb, NULL, 'US')$s$, v_event, v_ada));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_own_number', 'own number refused: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 2, '[{"phone":"+15550204555"},{"phone":"+1 555 020 4555"}]'::jsonb, NULL, 'US')$s$, v_event, v_ada));
  PERFORM pg_temp.ok(v_err IN ('rsvp_guest_duplicate', 'rsvp_guest_phone_invalid'),
    'a duplicate (or malformed duplicate) refused: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 2, '[{"phone":"+15550204555"},{"phone":"+15550204555"}]'::jsonb, NULL, 'US')$s$, v_event, v_ada));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_duplicate', 'a duplicate number refused: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 3, '[{"phone":"+15550204561"},{"phone":"+15550204562"},{"phone":"+15550204563"}]'::jsonb, NULL, 'US')$s$, v_event, v_ada));
  PERFORM pg_temp.ok(v_err = 'rsvp_plus_ones_exceeded', 'the host limit is enforced on the server: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Other', 'other-4508@example.test',
    '+15550204700', 'going', 1, '[{"phone":"+15550204777"}]'::jsonb, NULL, 'US')$s$, v_event));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_already_listed', 'a number already on the list refused: ' || v_err);
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'user:' || v_hal, v_event, '1555099' || lpad(i::text, 4, '0') FROM generate_series(1, 20) i;
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Hal Hart', 'i4508-hal@example.test',
    '+15550204599', 'going', 1, '[{"phone":"+15550204888"}]'::jsonb, NULL, 'US')$s$, v_event, v_hal));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_daily_cap', 'the 21st number in 24 hours is refused: ' || v_err);

  -- ---- Claim --------------------------------------------------------------
  v_code := public.mint_claim_link('rsvp_guest', v_guest)->>'code';
  v_res := public.rsvp_guest_resolve(v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'status' = 'open' AND v_res->>'inviterName' = 'Ada O.'
    AND v_res->>'phoneLast4' = '4502' AND NOT (v_res ? 'phone'),
    'resolve shows the inviter and last four only: ' || v_res::text);
  v_res := public.rsvp_guest_claim(v_hal, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'phone_unproved',
    'a code proved for a different number cannot claim: ' || v_res::text);
  PERFORM pg_temp.ok((SELECT claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_guest),
    'the refused claim wrote nothing');
  v_res := public.rsvp_guest_claim(v_ada, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'own_party', 'the inviter cannot claim their own guest');

  v_res := public.rsvp_guest_claim(v_gus, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'claimed' AND v_res->>'friendship' = 'connected'
    AND (v_res->>'closeFriend')::boolean, 'Gus claims and becomes Ada''s close friend: ' || v_res::text);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.friends
     WHERE status = 'accepted' AND deleted_at IS NULL
       AND ((user_id = v_ada AND friend_user_id = v_gus) OR (user_id = v_gus AND friend_user_id = v_ada))) = 2,
    'friends both ways');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.pairings WHERE source = 'rsvp_guest'
      AND user_a_id = LEAST(v_ada, v_gus) AND user_b_id = GREATEST(v_ada, v_gus)),
    'a free close-friend pairing');
  PERFORM pg_temp.ok((SELECT current_count FROM public.check_pairing_allowed(v_ada)) = 0,
    'the RSVP pairing does not use the allowance');
  PERFORM pg_temp.ok(public.rsvp_guest_display_name(v_guest) = 'Gus Grant',
    'a claimed guest shows their account name');
  v_res := public.rsvp_guest_claim(v_gus, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'already_claimed', 'claiming twice is a no-op');
  v_res := public.rsvp_guest_release(v_code);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'already_claimed', 'a claimed guest cannot be released');

  -- Re-submit keeps the claim.
  PERFORM public.submit_event_rsvp(v_event, v_ada, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 2,
    jsonb_build_array(jsonb_build_object('phone', '+15550204502'), jsonb_build_object('phone', '+15550204777')),
    NULL, 'US');
  PERFORM pg_temp.ok((SELECT claimed_at IS NOT NULL FROM public.event_rsvp_guests WHERE id = v_guest),
    'a re-submit keeps the claimed guest');

  -- Party passes for Ada: claimed flag and invite link (QR minted directly here).
  UPDATE public.event_rsvps SET qr_code = 'mingla-rsvp:4508-primary' WHERE id = v_rsvp;
  UPDATE public.event_rsvp_guests SET qr_code = 'mingla-rsvp:4508-g-' || left(id::text, 8) WHERE rsvp_id = v_rsvp;
  PERFORM pg_temp.as_user(v_ada);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.fetch_user_rsvp_party_passes(v_rsvp)
      WHERE entity_id = v_guest AND claimed AND invite_link = 'https://usemingla.com/c/' || v_code
        AND invited_by_name = 'Ada O.' AND invite_status = 'not_texted') = 1,
    'Ada''s pass sheet shows the guest claimed with its link');
  PERFORM pg_temp.as_user(v_gus);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.fetch_user_rsvp_party_passes(v_rsvp)) = 1
    AND (SELECT invite_link IS NULL FROM public.fetch_user_rsvp_party_passes(v_rsvp)),
    'a matched guest sees only their own pass, without the link');

  -- Blocked pair: claim works, no friendship.
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (v_ada, v_bea);
  v_res := public.submit_event_rsvp(v_soon, v_ada, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 1, jsonb_build_array(jsonb_build_object('phone', '+15550204503')), NULL, 'US');
  v_code_bea := public.mint_claim_link('rsvp_guest',
    (SELECT g.id FROM public.event_rsvp_guests g WHERE g.rsvp_id = (v_res->>'rsvpId')::uuid))->>'code';
  v_res := public.rsvp_guest_claim(v_bea, v_code_bea, 'Bea');
  PERFORM pg_temp.ok(v_res->>'outcome' = 'claimed' AND v_res->>'friendship' = 'blocked'
    AND NOT (v_res->>'closeFriend')::boolean, 'a blocked pair claims with no friendship: ' || v_res::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.friends
      WHERE user_id IN (v_ada, v_bea) AND friend_user_id IN (v_ada, v_bea)), 'no friend rows for a blocked pair');

  -- ---- Release ("This isn't me") ------------------------------------------
  v_code := public.mint_claim_link('rsvp_guest', v_guest2)->>'code';
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_event, v_rsvp, NULL, 'rsvp_pass', jsonb_build_object('role', 'guest', 'guestId', v_guest2),
    'i4508-pass-g2') RETURNING id INTO v_notif;
  v_res := public.rsvp_guest_release(v_code);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'released' AND (v_res->>'inviterUserId')::uuid = v_ada,
    'release returns the inviter: ' || v_res::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_guest2)
    AND (SELECT plus_count FROM public.event_rsvps WHERE id = v_rsvp) = 1, 'the spot is freed');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries
      WHERE notification_id = v_notif AND status IN ('pending', 'failed_retryable', 'deferred')),
    'queued texts to the released number are closed');
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, NULL)->>'status' = 'released'
    AND public.rsvp_guest_claim(v_gus, v_code, NULL)->>'outcome' = 'released',
    'a released link stays released');
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 2, '[{"phone":"+15550204502"},{"phone":"+15550204777"}]'::jsonb, NULL, 'US')$s$, v_event, v_ada));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_released', 'a released number cannot be re-added: ' || v_err);

  -- ---- Lookup (amendment 4) -----------------------------------------------
  -- P1-1: a signed-out caller learns only whether the number is valid.
  v_res := public.rsvp_guest_lookup(NULL, v_event, '+15550204599');
  PERFORM pg_temp.ok(v_res = '{"valid": true}'::jsonb,
    'P1-1: a signed-out lookup says only valid: ' || v_res::text);
  v_res := public.rsvp_guest_lookup(NULL, v_event, '+15550204502');
  PERFORM pg_temp.ok(v_res = '{"valid": true}'::jsonb,
    'P1-1: a signed-out lookup of a listed number says only valid: ' || v_res::text);
  v_res := public.rsvp_guest_lookup(v_ada, v_event, '+15550204599');
  PERFORM pg_temp.ok(v_res->'user'->>'displayName' = 'Hal Hart'
    AND (v_res->>'alreadyOnList') = 'false' AND (v_res->>'released') = 'false',
    'a signed-in lookup on an open event shows the name and list state: ' || v_res::text);
  v_res := public.rsvp_guest_lookup(v_hal, v_event, '+15550204502');
  PERFORM pg_temp.ok((v_res->>'alreadyOnList')::boolean,
    'a number on someone else''s party reads as on the list: ' || v_res::text);
  v_res := public.rsvp_guest_lookup(v_ada, v_event, '+15550204503');
  PERFORM pg_temp.ok(NOT (v_res->>'onMingla')::boolean, 'a blocked account looks like not on Mingla');
  v_res := public.rsvp_guest_lookup(v_ada, v_event, '+15550204501');
  PERFORM pg_temp.ok((v_res->>'isYou')::boolean, 'your own number is "you"');

  -- ---- Bring someone too (2.5) -------------------------------------------
  v_res := public.rsvp_guest_bring(v_gus, v_guest, '+15550204950', 'US', NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'not_allowed', 'off by default: ' || v_res::text);
  UPDATE public.events SET rsvp_guests_can_bring = true WHERE id = v_event;
  v_res := public.rsvp_guest_bring(v_hal, v_guest, '+15550204950', 'US', NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'not_your_pass', 'only the claimed guest may bring');
  v_res := public.rsvp_guest_bring(v_gus, v_guest, '+15550204950', 'US', NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'added'
    AND (SELECT plus_count FROM public.event_rsvps WHERE id = v_rsvp) = 2,
    'a claimed guest brings one person: ' || v_res::text);
  v_res := public.rsvp_guest_bring(v_gus, v_guest, '+15550204951', 'US', NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'already_brought', 'one each');
  PERFORM public.submit_event_rsvp(v_event, v_ada, 'Ada Obi', 'i4508-ada@example.test',
    '+15550204501', 'going', 1, jsonb_build_array(jsonb_build_object('phone', '+15550204502')), NULL, 'US');
  PERFORM pg_temp.ok((SELECT plus_count FROM public.event_rsvps WHERE id = v_rsvp) = 2
    AND EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE phone = '+15550204950'),
    'the inviter''s re-submit keeps the guest Gus brought');

  -- ---- Reminder (2.1) -----------------------------------------------------
  v_res := public.submit_event_rsvp(v_soon, v_xan, 'Xan Xu', 'i4508-xan@example.test',
    '+15550204801', 'going', 1, jsonb_build_array(jsonb_build_object('phone', '+15550204802')), NULL, 'US');
  SELECT id INTO v_guest2 FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  UPDATE public.event_rsvp_guests SET created_at = now() - interval '7 hours'
   WHERE rsvp_id IN (SELECT id FROM public.event_rsvps WHERE event_id = v_soon);
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  SELECT v_soon, g.rsvp_id, NULL, 'rsvp_pass', jsonb_build_object('role', 'guest', 'guestId', g.id),
         'i4508-soon-' || g.id
    FROM public.event_rsvp_guests g
   WHERE g.rsvp_id IN (SELECT id FROM public.event_rsvps WHERE event_id = v_soon);
  UPDATE public.rsvp_notification_deliveries d SET status = 'sent'
    FROM public.rsvp_notifications n
   WHERE d.notification_id = n.id AND n.idempotency_key LIKE 'i4508-soon-%' AND d.channel = 'sms';
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rsvp_notification_deliveries d
      JOIN public.rsvp_notifications n ON n.id = d.notification_id
     WHERE n.idempotency_key = 'i4508-soon-' || v_guest2 AND d.channel = 'sms' AND d.status = 'sent') = 1,
    'fixture: the guest invite text was delivered by sms');
  v_count := public.rsvp_enqueue_guest_reminders(200);
  PERFORM pg_temp.ok(v_count = 1 AND EXISTS (SELECT 1 FROM public.rsvp_notifications
      WHERE idempotency_key = 'rsvp_guest_reminder:' || v_guest2),
    'one reminder for the unclaimed guest (Bea''s claimed pass gets none): ' || v_count);
  PERFORM pg_temp.ok(public.rsvp_enqueue_guest_reminders(200) = 0, 'never a second reminder');

  -- ---- Friend is going (2.3) ----------------------------------------------
  INSERT INTO public.pair_requests(sender_id, receiver_id, status) VALUES (v_xan, v_yas, 'accepted')
  RETURNING id INTO v_pr;
  INSERT INTO public.pairings(user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST(v_xan, v_yas), GREATEST(v_xan, v_yas), v_pr);
  INSERT INTO public.pair_requests(sender_id, receiver_id, status) VALUES (v_zed, v_yas, 'accepted')
  RETURNING id INTO v_pr;
  INSERT INTO public.pairings(user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST(v_zed, v_yas), GREATEST(v_zed, v_yas), v_pr);
  INSERT INTO public.notification_preferences(user_id, friends_going) VALUES (v_zed, false)
  ON CONFLICT (user_id) DO UPDATE SET friends_going = false;
  PERFORM public.submit_event_rsvp(v_event, v_yas, 'Yas Yu', 'i4508-yas@example.test',
    '+15550204811', 'going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_friend_going_notices WHERE actor_user_id = v_yas),
    'no notice while Show me as going is off');
  PERFORM pg_temp.as_user(v_yas); -- the owner-only consent guard
  UPDATE public.event_rsvps SET show_me_as_going = true WHERE event_id = v_event AND user_id = v_yas;
  UPDATE public.event_rsvps SET rsvp_status = 'maybe' WHERE event_id = v_event AND user_id = v_yas;
  UPDATE public.event_rsvps SET rsvp_status = 'going' WHERE event_id = v_event AND user_id = v_yas;
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rsvp_friend_going_notices
      WHERE event_id = v_event AND actor_user_id = v_yas) = 1
    AND EXISTS (SELECT 1 FROM public.rsvp_friend_going_notices WHERE friend_user_id = v_xan),
    'one notice for Xan, none for Zed (opted out), none twice');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.issue_4508_take_friend_going_notices(50)
      WHERE friend_user_id = v_xan AND send AND actor_name = 'Yas' AND event_title = 'Rooftop Night') = 1,
    'the notice is taken once with the actor and event');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.issue_4508_take_friend_going_notices(50)) = 0,
    'and never again');

  -- ---- Circle context (1.23) ----------------------------------------------
  INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app)
  VALUES (v_gus, 'af-4508-gus', 'ios', 'id-4508', 'consumer');
  PERFORM pg_temp.as_user(v_ada);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.get_user_circle(v_ada, 60, 0) c
      WHERE c.user_id = v_gus AND c.tier = 'close' AND c.relationship_source = 'rsvp_guest'
        AND c.relationship_context_type = 'event' AND c.relationship_context_id = v_event
        AND c.relationship_context_title = 'Rooftop Night') = 1,
    'Gus is Ada''s close friend "through Rooftop Night"');

  RAISE NOTICE '#4508 bring a friend: all cases passed';
END
$test$;

ROLLBACK;
