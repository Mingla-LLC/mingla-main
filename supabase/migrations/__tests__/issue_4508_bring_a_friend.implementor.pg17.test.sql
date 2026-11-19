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
  -- R-1: a signed-out caller gets the one code that does not say why.
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_unavailable', 'a number already on the list refused (signed out): ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Hal Hart', 'i4508-hal@example.test',
    '+15550204599', 'going', 1, '[{"phone":"+15550204777"}]'::jsonb, NULL, 'US')$s$, v_event, v_hal));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_already_listed', 'a number already on the list refused (signed in): ' || v_err);
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

-- ===========================================================================
-- Wave A rework (#4508): every review finding, contract gap and D-2.4.
-- MINGLA-INVARIANT: I-4508-SIGNED-OUT-LEARNS-VALID-ONLY | issue #4508 | rsvp_guest_lookup tells a signed-out caller only whether a number is valid; list and release state are answered only to a signed-in caller for an event they can RSVP to now.
-- MINGLA-INVARIANT: I-4508-GUEST-TEXT-CAPS | issue #4508 | guest numbers are capped at 20 per inviter per 24 hours (signed-out inviters keyed by their network address, never the number they typed), 30 per event per 24 hours from signed-out inviters, and a number past 3 guest invites in 24 hours is added but never texted (sms_hold number_limit, willText false).
-- MINGLA-INVARIANT: I-4508-BROUGHT-BY-AFTER-CLAIM | issue #4508 | peer_list_event_guests shows a plus-one as their own row (with broughtByName) only once claimed and while their own Show me as going is on; unclaimed plus-ones never appear and count as unclaimedGuestCount on the inviter's row; the seat total is unchanged.
-- ===========================================================================
DO $rework$
DECLARE
  v_own  uuid := '45082000-0000-4000-8000-000000000001';
  v_brand uuid := '45082000-0000-4000-8000-000000000002';
  v_ev   uuid := '45082000-0000-4000-8000-000000000003';
  v_evp  uuid := '45082000-0000-4000-8000-000000000004'; -- private
  v_evn  uuid := '45082000-0000-4000-8000-000000000005'; -- happening now
  v_eve  uuid := '45082000-0000-4000-8000-000000000006'; -- will have ended
  v_ina  uuid := '45082000-0000-4000-8000-000000000011';
  v_inb  uuid := '45082000-0000-4000-8000-000000000012';
  v_inc  uuid := '45082000-0000-4000-8000-000000000013';
  v_fri  uuid := '45082000-0000-4000-8000-000000000014'; -- friend, proven phone
  v_frn  uuid := '45082000-0000-4000-8000-000000000015'; -- friend, no phone
  v_str  uuid := '45082000-0000-4000-8000-000000000016'; -- stranger
  v_blk  uuid := '45082000-0000-4000-8000-000000000017'; -- friend who blocked ina
  v_gus  uuid := '45082000-0000-4000-8000-000000000018'; -- proves +15550305001
  v_eml  uuid := '45082000-0000-4000-8000-000000000019'; -- matched by an old email
  v_vw   uuid := '45082000-0000-4000-8000-000000000020'; -- viewer on the list
  v_res jsonb;
  v_err text;
  v_rsvp uuid;
  v_gid uuid;
  v_gid2 uuid;
  v_code text;
  v_notif uuid;
  v_lease uuid := gen_random_uuid();
  v_n integer;
  v_list json;
  v_seats integer;
BEGIN
  INSERT INTO auth.users(id, email) SELECT u, 'i4508r-' || right(u::text, 2) || '@example.test'
    FROM unnest(ARRAY[v_own, v_ina, v_inb, v_inc, v_fri, v_frn, v_str, v_blk, v_gus, v_eml, v_vw]) u;
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone)
  SELECT u, 'i4508r-' || right(u::text, 2) || '@example.test', n, split_part(n, ' ', 1), split_part(n, ' ', 2), NULL
    FROM (VALUES (v_ina, 'Ina Ames'), (v_inb, 'Ibo Bell'), (v_inc, 'Ivo Cole'), (v_fri, 'Fay Ford'),
                 (v_frn, 'Fin North'), (v_str, 'Sam Stone'), (v_blk, 'Bo Black'), (v_gus, 'Gil Gray'),
                 (v_eml, 'Em Lowe'), (v_vw, 'Vic Wade')) x(u, n)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = NULL;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_ina, '+15550305100'), (v_fri, '+15550305200'), (v_gus, '+15550305001'), (v_str, '+15550305300');
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (v_ina, v_fri, 'accepted'), (v_fri, v_ina, 'accepted'),
    (v_ina, v_frn, 'accepted'), (v_frn, v_ina, 'accepted'),
    (v_ina, v_blk, 'accepted'), (v_blk, v_ina, 'accepted'),
    (v_vw, v_ina, 'accepted'), (v_ina, v_vw, 'accepted');
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (v_blk, v_ina);

  INSERT INTO public.creator_accounts(id, email) VALUES (v_own, 'i4508r-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_own, 'Issue 4508 Rework', 'issue-4508-rework', 'stripe', 'US', 'USD', 'USD',
    'host-4508r@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at, cover_media_url, cover_media_type)
  VALUES
    (v_ev, v_brand, v_own, 'Garden Party', 'garden-4508r', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), 'https://cdn.example.test/garden.jpg', 'image'),
    (v_evp, v_brand, v_own, 'Secret Supper', 'secret-4508r', 'rsvp', 'scheduled', 'private',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), 'https://cdn.example.test/secret.jpg', 'image'),
    (v_evn, v_brand, v_own, 'Right Now', 'now-4508r', 'rsvp', 'live', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), NULL, NULL),
    (v_eve, v_brand, v_own, 'Soon Over', 'over-4508r', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), NULL, NULL);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ev, now() + interval '5 days', now() + interval '5 days 4 hours', 'UTC', true),
    (v_evp, now() + interval '5 days', now() + interval '5 days 4 hours', 'UTC', true),
    (v_evn, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true),
    (v_eve, now() + interval '2 days', now() + interval '2 days 3 hours', 'UTC', true);

  -- ---- C1: a friend picked from the list ---------------------------------
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 1, %L::jsonb, NULL, 'US')$s$, v_ev, v_ina, jsonb_build_array(jsonb_build_object('userId', v_str))));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_not_friend', 'C1: a stranger cannot be picked: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 1, %L::jsonb, NULL, 'US')$s$, v_ev, v_ina, jsonb_build_array(jsonb_build_object('userId', v_blk))));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_not_friend', 'C1: a friend who blocked you cannot be picked: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon', 'anon-4508r@example.test',
    '+15550305900', 'going', 1, %L::jsonb, NULL, 'US')$s$, v_ev, jsonb_build_array(jsonb_build_object('userId', v_fri))));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_keys_invalid', 'C1: a signed-out inviter cannot pick an account: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 2, %L::jsonb, NULL, 'US')$s$, v_ev, v_ina,
    jsonb_build_array(jsonb_build_object('userId', v_fri), jsonb_build_object('phone', '+15550305200'))));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_duplicate', 'C1: a picked friend typed again by number is a duplicate: ' || v_err);

  v_res := public.submit_event_rsvp(v_ev, v_ina, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 2,
    jsonb_build_array(jsonb_build_object('userId', v_fri), jsonb_build_object('userId', v_frn)), NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.ok((SELECT phone = '+15550305200' AND matched_user_id = v_fri AND added_from_friend
                        AND sms_hold IS NULL FROM public.event_rsvp_guests
                       WHERE rsvp_id = v_rsvp AND matched_user_id = v_fri),
    'C1: the server resolves the friend''s proven number and matches the friend');
  PERFORM pg_temp.ok((SELECT phone IS NULL AND sms_hold = 'no_phone' FROM public.event_rsvp_guests
                       WHERE rsvp_id = v_rsvp AND matched_user_id = v_frn),
    'C1: a friend with no proven number is still a guest, not texted');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') x
                                  WHERE x->>'phoneLast4' IS NOT NULL OR x::text LIKE '%5550305200%'),
    'C1: the friend''s number never comes back: ' || (v_res->'guests')::text);
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v_res->'guests') x
                       WHERE (x->>'willText')::boolean AND (x->>'addedFromFriend')::boolean) = 1
    AND (SELECT count(*) FROM jsonb_array_elements(v_res->'guests') x
          WHERE NOT (x->>'willText')::boolean AND x->>'notTextedReason' = 'no_phone') = 1,
    'C3: the response says which guest will not be texted and why: ' || (v_res->'guests')::text);
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND matched_user_id = v_frn;
  -- A pass row for the no-phone friend seeds no text (in-app and push only).
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_ev, v_rsvp, NULL, 'rsvp_pass', jsonb_build_object('role', 'guest', 'guestId', v_gid), 'i4508r-frn')
  RETURNING id INTO v_notif;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries
      WHERE notification_id = v_notif AND channel = 'sms')
    AND EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries
      WHERE notification_id = v_notif AND channel = 'in_app'),
    'C1: a friend with no number gets in-app and push, never a text');
  PERFORM pg_temp.ok(public.rsvp_guest_invite_status(v_gid) = 'not_texted', 'no-phone guest reads not_texted');
  v_res := public.submit_event_rsvp(v_ev, v_ina, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 2,
    jsonb_build_array(jsonb_build_object('userId', v_fri), jsonb_build_object('userId', v_frn)), NULL, 'US');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid),
    'C1: a re-submit keeps the picked friend''s row');
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_str, v_code, NULL)->>'outcome' = 'claimed_by_other',
    'C1: only the picked account can claim a friend-picked pass');
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_frn, v_code, NULL)->>'outcome' = 'claimed',
    'C1: the picked friend claims without a number');

  -- ---- C2: guestsCanBring on the viewer's own pass ------------------------
  UPDATE public.events SET rsvp_guests_can_bring = true WHERE id = v_ev;
  UPDATE public.event_rsvp_guests SET qr_code = 'mingla-rsvp:4508r-' || left(id::text, 8) WHERE rsvp_id = v_rsvp;
  UPDATE public.event_rsvps SET qr_code = 'mingla-rsvp:4508r-p' WHERE id = v_rsvp;
  PERFORM pg_temp.as_user(v_frn);
  PERFORM pg_temp.ok((SELECT guests_can_bring FROM public.fetch_user_rsvp_party_passes(v_rsvp)
                       WHERE entity_id = v_gid) IS TRUE,
    'C2: the guest''s own pass row carries guestsCanBring');
  PERFORM pg_temp.as_user(v_ina);
  PERFORM pg_temp.ok((SELECT phone_last4 FROM public.fetch_user_rsvp_party_passes(v_rsvp)
                       WHERE entity_id = (SELECT id FROM public.event_rsvp_guests
                                           WHERE rsvp_id = v_rsvp AND matched_user_id = v_fri)) IS NULL,
    'C1: the inviter''s pass sheet never shows a picked friend''s digits');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ---- P3-6: an old app re-sends a party holding the inviter's own number --
  INSERT INTO public.event_rsvp_guests(rsvp_id, name, email, phone, invited_by_user_id)
  VALUES (v_rsvp, 'Live Case', 'live-4508r@example.test', '+15550305100', v_ina);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 3, %L::jsonb, NULL, 'US')$s$, v_ev, v_ina,
    jsonb_build_array(jsonb_build_object('userId', v_fri), jsonb_build_object('userId', v_frn),
      jsonb_build_object('name', 'Live Case', 'email', 'live-4508r@example.test', 'phone', '+15550305100'))));
  PERFORM pg_temp.ok(v_err = '', 'P3-6: an unchanged pre-existing own-number guest still passes: ' || v_err);
  DELETE FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550305100';
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 3, %L::jsonb, NULL, 'US')$s$, v_ev, v_ina,
    jsonb_build_array(jsonb_build_object('userId', v_fri), jsonb_build_object('userId', v_frn),
      jsonb_build_object('phone', '+15550305100'))));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_own_number', 'P3-6: a newly added own number is still refused: ' || v_err);

  -- ---- P3-4: the party tree is one set -------------------------------------
  v_res := public.submit_event_rsvp(v_ev, v_ina, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 2,
    jsonb_build_array(jsonb_build_object('userId', v_frn), jsonb_build_object('phone', '+15550305001')), NULL, 'US');
  SELECT id INTO v_gid2 FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550305001';
  v_code := public.mint_claim_link('rsvp_guest', v_gid2)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gus, v_code, NULL)->>'outcome' = 'claimed', 'fixture: Gil claims');
  v_res := public.rsvp_guest_bring(v_gus, v_gid2, '+15550305777', 'US', NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'added', 'fixture: Gil brings one: ' || v_res::text);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 3, %L::jsonb, NULL, 'US')$s$, v_ev, v_ina,
    jsonb_build_array(jsonb_build_object('userId', v_frn), jsonb_build_object('phone', '+15550305001'),
      jsonb_build_object('phone', '+15550305777'))));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_duplicate', 'P3-4: a number a brought guest holds is a duplicate: ' || v_err);

  -- ---- P3-3: guest_bring refuses an account already on the list ------------
  PERFORM public.submit_event_rsvp(v_ev, v_str, 'Sam Stone', 'i4508r-16@example.test',
    '+15550305301', 'going', 0, '[]'::jsonb, NULL, 'US');
  DELETE FROM public.event_rsvp_guests WHERE brought_by_guest_id = v_gid2;
  v_err := pg_temp.err(format($s$SELECT public.rsvp_guest_bring(%L, %L, '+15550305300', 'US', NULL)$s$, v_gus, v_gid2));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_already_listed', 'P3-3: bring refuses an account already going: ' || v_err);

  -- ---- Cap through guest_bring ----------------------------------------------
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'user:' || v_gus, v_ev, '1555077' || lpad(i::text, 4, '0') FROM generate_series(1, 20) i;
  v_err := pg_temp.err(format($s$SELECT public.rsvp_guest_bring(%L, %L, '+15550305778', 'US', NULL)$s$, v_gus, v_gid2));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_daily_cap', 'the cap applies through guest_bring: ' || v_err);

  -- ---- P1-2: signed-out caps ---------------------------------------------
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('a', 64))::text, true);
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'ip:' || repeat('a', 64), v_evn, '1555066' || lpad(i::text, 4, '0') FROM generate_series(1, 20) i;
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon A', 'anon-a-4508r@example.test',
    '+15550306001', 'going', 1, '[{"phone":"+15550306002"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_daily_cap',
    'P1-2: a signed-out inviter is capped by network address: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon A', 'anon-a2-4508r@example.test',
    '+15550306011', 'going', 1, '[{"phone":"+15550306012"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_daily_cap',
    'P1-2: a fresh typed primary number does not reset the cap: ' || v_err);
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('b', 64))::text, true);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon B', 'anon-b-4508r@example.test',
    '+15550306021', 'going', 1, '[{"phone":"+15550306022"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = '', 'P1-2: another network address is not capped: ' || v_err);
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'ip:' || md5(i::text) || md5(i::text), v_ev, '1555055' || lpad(i::text, 4, '0') FROM generate_series(1, 30) i;
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('c', 64))::text, true);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon C', 'anon-c-4508r@example.test',
    '+15550306031', 'going', 1, '[{"phone":"+15550306032"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_daily_cap',
    'P1-2: signed-out inviters share a per-event cap of 30: ' || v_err);
  PERFORM set_config('request.headers', '', true);
  -- Per-number: past 3 guest invites in 24 hours it is added, never texted.
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'user:' || gen_random_uuid(), v_evp, '15550306099' FROM generate_series(1, 3);
  v_res := public.submit_event_rsvp(v_evp, v_inb, 'Ibo Bell', 'i4508r-12@example.test',
    '+15550305400', 'going', 1, '[{"phone":"+15550306099"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((SELECT sms_hold FROM public.event_rsvp_guests
                       WHERE rsvp_id = (v_res->>'rsvpId')::uuid) = 'number_limit'
    AND NOT (v_res->'guests'->0->>'willText')::boolean
    AND v_res->'guests'->0->>'notTextedReason' = 'number_limit',
    'P1-2: a number past 3 guest invites a day is held, not texted: ' || v_res::text);
  PERFORM pg_temp.ok(public.rsvp_guest_message_context(
      (SELECT id FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid))->>'smsHold' = 'number_limit',
    'the worker reads the hold');

  -- ---- C3: an opted-out number says so at once -----------------------------
  INSERT INTO public.channel_suppressions(contact, channel, scope, reason)
  VALUES ('+15550306199', 'sms', 'all', 'stop_keyword');
  v_res := public.submit_event_rsvp(v_evp, v_inc, 'Ivo Cole', 'i4508r-13@example.test',
    '+15550305500', 'going', 1, '[{"phone":"+15550306199"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(NOT (v_res->'guests'->0->>'willText')::boolean
    AND v_res->'guests'->0->>'notTextedReason' = 'suppressed',
    'C3: a STOPped number reads willText false, suppressed: ' || v_res::text);

  -- ---- P1-1: list state only for an event the caller can RSVP to -----------
  v_res := public.rsvp_guest_lookup(v_str, v_evp, '+15550306099');
  PERFORM pg_temp.ok(NOT (v_res ? 'alreadyOnList') AND NOT (v_res ? 'released'),
    'P1-1: no list state for a private event the caller is not on: ' || v_res::text);
  v_res := public.rsvp_guest_lookup(v_inb, v_evp, '+15550306199');
  PERFORM pg_temp.ok((v_res->>'alreadyOnList')::boolean,
    'P1-1: list state for an event the caller is already on: ' || v_res::text);

  -- ---- P2-2: a signed-out inviter's typed name is made safe ----------------
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('d', 64))::text, true);
  v_res := public.submit_event_rsvp(v_evp, NULL, 'Ann <a href=x.co>visit evil.co</a> 9 Zed',
    'anon-n-4508r@example.test', '+15550306301', 'going', 1, '[{"phone":"+15550306302"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.ok((SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n) ~ '^[[:alpha:] ''-]+( [[:upper:]]\.)?$'
    AND length((SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n)) <= 24
    AND (SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n) NOT LIKE '%.co%',
    'P2-2: letters only, at most 24: ' || coalesce((SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n), 'NULL'));
  v_res := public.submit_event_rsvp(v_evp, NULL, '!!! 123 ???', 'anon-m-4508r@example.test',
    '+15550306311', 'going', 1, '[{"phone":"+15550306312"}]'::jsonb, NULL, 'US');
  v_code := public.mint_claim_link('rsvp_guest',
    (SELECT id FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid))->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, NULL)->>'inviterName' = 'A friend',
    'P2-2: nothing safe left reads "A friend"');
  PERFORM set_config('request.headers', '', true);

  -- ---- C5: cover only for a public event -----------------------------------
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, NULL)->'event'->>'coverImageUrl' IS NULL,
    'C5: a private event''s cover is not returned');
  v_code := public.mint_claim_link('rsvp_guest', v_gid2)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, NULL)->'event'->>'coverImageUrl'
      = 'https://cdn.example.test/garden.jpg', 'C5: a public event''s cover is returned');

  -- ---- P2-1: a row matched by an old email goes to the proven claimer ------
  v_res := public.submit_event_rsvp(v_ev, v_inb, 'Ibo Bell', 'i4508r-12@example.test',
    '+15550305400', 'going', 1, '[{"phone":"+15550306401"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  UPDATE public.event_rsvp_guests SET matched_user_id = v_eml WHERE id = v_gid;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_vw, '+15550306401');
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  v_res := public.rsvp_guest_claim(v_vw, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'claimed'
    AND (SELECT matched_user_id FROM public.event_rsvp_guests WHERE id = v_gid) = v_vw,
    'P2-1: the proven claimer takes a row matched to an account that never proved the number: ' || v_res::text);

  -- ---- P3-1: release stops a text the worker holds but has not sent --------
  v_res := public.submit_event_rsvp(v_eve, v_inc, 'Ivo Cole', 'i4508r-13@example.test',
    '+15550305500', 'going', 1, '[{"phone":"+15550306501"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_eve, (v_res->>'rsvpId')::uuid, NULL, 'rsvp_pass',
    jsonb_build_object('role', 'guest', 'guestId', v_gid), 'i4508r-p31') RETURNING id INTO v_notif;
  UPDATE public.rsvp_notification_deliveries SET status = 'processing', lease_id = v_lease,
         processing_started_at = now()
   WHERE notification_id = v_notif AND channel = 'sms';
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code)->>'outcome' = 'released', 'fixture: released');
  PERFORM pg_temp.ok(public.mark_rsvp_notification_provider_io(
      (SELECT id FROM public.rsvp_notification_deliveries WHERE notification_id = v_notif AND channel = 'sms'),
      v_lease) = false,
    'P3-1: the worker''s pre-send mark refuses a text released while it was held');

  -- ---- P3-8: the bar is per inviter until a second release -----------------
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Ivo Cole', 'i4508r-13@example.test',
    '+15550305500', 'going', 1, '[{"phone":"+15550306501"}]'::jsonb, NULL, 'US')$s$, v_eve, v_inc));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_released', 'P3-8: the same inviter cannot re-add: ' || v_err);
  v_res := public.submit_event_rsvp(v_eve, v_inb, 'Ibo Bell', 'i4508r-12@example.test',
    '+15550305400', 'going', 1, '[{"phone":"+15550306501"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.ok(v_gid IS NOT NULL, 'P3-8: another inviter may add it once');
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code)->>'outcome' = 'released', 'second release');
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Vic Wade', 'i4508r-20@example.test',
    '+15550305600', 'going', 1, '[{"phone":"+15550306501"}]'::jsonb, NULL, 'US')$s$, v_eve, v_vw));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_released', 'P3-8: a second release bars the whole event: ' || v_err);
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, NULL)->>'status' = 'released',
    'a second release''s code reads released');

  -- ---- P3-2: no claim and no bring after the event ended -------------------
  v_res := public.submit_event_rsvp(v_eve, v_ina, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 1, '[{"phone":"+15550305001"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  UPDATE public.event_dates SET start_at = now() - interval '5 hours', end_at = now() - interval '1 hour'
   WHERE event_id = v_eve;
  v_res := public.rsvp_guest_claim(v_gus, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'ended'
    AND (SELECT claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'P3-2: a claim after the end is refused: ' || v_res::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_guest_connections WHERE guest_id = v_gid),
    'P3-2: no friendship is made through an ended event');
  UPDATE public.event_rsvp_guests SET matched_user_id = v_gus, claimed_at = now() WHERE id = v_gid;
  UPDATE public.events SET rsvp_guests_can_bring = true WHERE id = v_eve;
  PERFORM pg_temp.ok(public.rsvp_guest_bring(v_gus, v_gid, '+15550306601', 'US', NULL)->>'outcome' = 'ended',
    'P3-2: no bring after the end');

  -- ---- P3-5: a friend-going failure is recorded, the RSVP still lands ------
  EXECUTE $t$CREATE FUNCTION public.i4508_test_boom() RETURNS trigger LANGUAGE plpgsql AS $b$
    BEGIN RAISE EXCEPTION 'boom'; END $b$$t$;
  EXECUTE 'CREATE TRIGGER i4508_boom BEFORE INSERT ON public.rsvp_friend_going_notices
           FOR EACH ROW EXECUTE FUNCTION public.i4508_test_boom()';
  INSERT INTO public.pair_requests(sender_id, receiver_id, status) VALUES (v_vw, v_str, 'accepted');
  INSERT INTO public.pairings(user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST(v_vw, v_str), GREATEST(v_vw, v_str),
    (SELECT id FROM public.pair_requests WHERE sender_id = v_vw AND receiver_id = v_str));
  DELETE FROM public.event_rsvps WHERE event_id = v_ev AND user_id = v_str;
  PERFORM public.submit_event_rsvp(v_ev, v_vw, 'Vic Wade', 'i4508r-20@example.test',
    '+15550305600', 'going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.as_user(v_vw);
  UPDATE public.event_rsvps SET show_me_as_going = true WHERE event_id = v_ev AND user_id = v_vw;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'DROP TRIGGER i4508_boom ON public.rsvp_friend_going_notices';
  PERFORM pg_temp.ok((SELECT show_me_as_going FROM public.event_rsvps WHERE event_id = v_ev AND user_id = v_vw),
    'P3-5: the RSVP write still lands');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.rsvp_friend_going_failures
      WHERE event_id = v_ev AND actor_user_id = v_vw AND reported_at IS NULL),
    'P3-5: the failure is recorded, not swallowed');
  -- R-5: listed until the ops alert went out, then marked reported.
  PERFORM pg_temp.ok((SELECT count(*) FROM public.issue_4508_list_friend_going_failures(50)
                       WHERE event_id = v_ev) = 1
    AND (SELECT count(*) FROM public.issue_4508_list_friend_going_failures(50)
          WHERE event_id = v_ev) = 1,
    'R-5: an unreported failure stays listed until it is marked');
  PERFORM pg_temp.ok(public.issue_4508_mark_friend_going_failures_reported(
      ARRAY(SELECT failure_id FROM public.issue_4508_list_friend_going_failures(50))) >= 1,
    'R-5: marked once the alert went out');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.issue_4508_list_friend_going_failures(50)) = 0,
    'R-5: a marked failure is never listed again');

  -- ---- P3-7: fetch_user_going_rsvps names a number-only guest -------------
  -- Gil's profile has no name at all: only the 1.11 rule can name the row.
  UPDATE public.profiles SET display_name = NULL, first_name = NULL, last_name = NULL WHERE id = v_gus;
  PERFORM pg_temp.as_user(v_gus);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.fetch_user_going_rsvps(v_gus) f
                                  WHERE f.role = 'guest' AND f.display_name IS NULL)
    AND EXISTS (SELECT 1 FROM public.fetch_user_going_rsvps(v_gus) f WHERE f.role = 'guest'),
    'P3-7: a number-only guest row always has a display name');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.profiles SET display_name = 'Gil Gray', first_name = 'Gil', last_name = 'Gray' WHERE id = v_gus;

  -- ---- D-2.4 / C4: Brought by on Who's going -------------------------------
  -- Ina's party on v_ev: Fay (unclaimed, picked), Fin (claimed), Gil (claimed).
  PERFORM public.submit_event_rsvp(v_ev, v_ina, 'Ina Ames', 'i4508r-11@example.test',
    '+15550305100', 'going', 3,
    jsonb_build_array(jsonb_build_object('userId', v_frn), jsonb_build_object('phone', '+15550305001'),
      jsonb_build_object('userId', v_fri)), NULL, 'US');
  SELECT r.id INTO v_rsvp FROM public.event_rsvps r WHERE r.event_id = v_ev AND r.user_id = v_ina;
  PERFORM pg_temp.as_user(v_ina);
  PERFORM public.biz_set_show_me_as_going(v_ev, true);
  PERFORM pg_temp.as_user(v_gus);
  PERFORM public.biz_set_show_me_as_going(v_ev, true); -- Gil opts in; Fin stays off
  PERFORM pg_temp.ok((SELECT show_me_as_going FROM public.event_rsvp_guests WHERE id = v_gid2),
    'D-2.4: a claimed guest sets their own Show me as going');
  PERFORM pg_temp.as_user(v_vw);
  v_list := public.peer_list_event_guests(v_ev, 50, 0);
  SELECT COALESCE(sum((g->>'partySize')::int), 0) INTO v_seats FROM json_array_elements(v_list->'guests') g;
  PERFORM pg_temp.ok(v_seats = (SELECT sum(1 + plus_count) FROM public.event_rsvps
                                 WHERE event_id = v_ev AND rsvp_status = 'going' AND approval_status = 'approved'),
    'D-2.4: the seat total is unchanged: ' || v_list::text);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM json_array_elements(v_list->'guests') g
                              WHERE g->>'profileId' = v_gus::text AND g->>'broughtByName' = 'Ina'
                                AND (g->>'partySize')::int = 1),
    'D-2.4: a claimed guest with Show me as going on is their own row, Brought by Ina: ' || v_list::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM json_array_elements(v_list->'guests') g
                                  WHERE g->>'profileId' IN (v_frn::text, v_fri::text)),
    'D-2.4: claimed-but-private and unclaimed guests are not shown by name');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM json_array_elements(v_list->'guests') g
                              WHERE g->>'profileId' = v_ina::text
                                AND (g->>'unclaimedGuestCount')::int = 1),
    'D-2.4: the inviter row carries +1 unclaimed guest: ' || v_list::text);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ---- C8 / C7: the host's list and a check-in by hand ---------------------
  v_res := public.submit_event_rsvp(v_evn, v_inb, 'Ibo Bell', 'i4508r-12@example.test',
    '+15550305400', 'going', 1, '[{"phone":"+15550306801"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.as_user(v_own);
  PERFORM pg_temp.ok((SELECT h.plus_checkins->0->>'phoneLast4' FROM public.host_list_rsvp_guests(v_evn) h
                       WHERE h.user_id = v_inb) = '6801'
    AND (SELECT h.plus_checkins::text FROM public.host_list_rsvp_guests(v_evn) h
          WHERE h.user_id = v_inb) NOT LIKE '%5550306801%',
    'C8: the host sees the last four digits only');
  v_res := public.host_check_in_rsvp_guest(v_gid);
  PERFORM pg_temp.ok(v_res->>'result' = 'success' AND v_res->>'entityType' = 'guest'
    AND v_res->>'invitedByName' = 'Ibo B.'
    AND (SELECT checked_in_by FROM public.event_rsvp_guests WHERE id = v_gid) = v_own,
    'C7: the host admits an unclaimed guest: ' || v_res::text);
  PERFORM pg_temp.ok(public.host_check_in_rsvp_guest(v_gid)->>'result' = 'duplicate',
    'C7: a second check-in is a duplicate');
  PERFORM pg_temp.as_user(v_str);
  v_err := pg_temp.err(format('SELECT public.host_check_in_rsvp_guest(%L)', v_gid));
  PERFORM pg_temp.ok(v_err = 'scanner_not_authorized', 'C7: a stranger cannot check guests in: ' || v_err);
  PERFORM pg_temp.as_user(v_own);
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE phone = '+15550306022';
  PERFORM pg_temp.ok(public.host_check_in_rsvp_guest(v_gid)->>'result' = 'not_yet_open',
    'C7: the door window applies as for a scan');

  -- ---- C6: the host saves "Bring someone too" ------------------------------
  UPDATE public.events SET rsvp_guests_can_bring = false WHERE id = v_ev;
  v_res := public.business_update_rsvp_graph(v_ev, jsonb_build_object('rsvpGuestsCanBring', true,
    'title', 'Garden Party'), 'Allow guests to bring one more person', NULL);
  PERFORM pg_temp.ok((SELECT rsvp_guests_can_bring FROM public.events WHERE id = v_ev)
    AND (v_res->>'rsvpGuestsCanBring')::boolean
    AND (v_res->'event'->>'rsvp_guests_can_bring')::boolean,
    'C6: the host save path persists and returns rsvpGuestsCanBring: ' || left(v_res::text, 300));
  v_err := pg_temp.err(format($s$SELECT public.business_update_rsvp_graph(%L, '{"rsvpGuestsCanBring":"yes"}'::jsonb,
    'Allow guests to bring one more person', NULL)$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_payload_invalid', 'C6: a non-boolean is refused: ' || v_err);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ---- S2: a number-only guest reaches the brand's people ------------------
  v_res := public.biz_resolve_brand_person_source_derived('rsvp_plus_one',
    (SELECT id FROM public.event_rsvp_guests WHERE phone = '+15550306022'));
  PERFORM pg_temp.ok(v_res->>'linkOutcome' IN ('linked', 'already_linked')
    AND v_res->>'personId' IS NOT NULL,
    'S2: a number-only plus-one is ingested: ' || v_res::text);

  RAISE NOTICE '#4508 wave A rework: all cases passed';
END
$rework$;


-- ===========================================================================
-- Second rework (#4508): R-1 to R-14.
-- MINGLA-INVARIANT: I-4508-SIGNED-OUT-SUBMIT-NO-ORACLE | issue #4508 | a signed-out submit_event_rsvp refuses a number already on the event's list, a number released on it, and a number whose account is already listed with the one code rsvp_guest_unavailable, never says whether a guest number has an account (onMingla false, no name) or why a guest will not be texted (notTextedReason null), and every signed-out guest number is counted by rsvp_guest_signed_out_attempt before the submit, so a refused submit still uses the 20-per-address and 30-per-event daily allowance.
-- MINGLA-INVARIANT: I-4508-FRIEND-NUMBER-NOT-OWNER-READABLE | issue #4508 | a party owner's direct read of event_rsvp_guests never returns a friend picked from the friends list (whose number the server resolved); the friend still reads their own row.
-- MINGLA-INVARIANT: I-4508-SIGNED-OUT-TEXT-CEILING | issue #4508 | past 300 guests added by signed-out inviters in 24 hours across all events, a signed-out inviter's guest is added but never texted; signed-in inviters are not affected.
-- MINGLA-INVARIANT: I-4508-NUMBER-LIMIT-SERIALIZED | issue #4508 | submit_event_rsvp and rsvp_guest_bring hold a transaction advisory lock on each guest number before counting its invites, so concurrent submits on different events cannot both pass the 3-per-day text limit.
-- ===========================================================================
DO $rework2$
DECLARE
  v_own  uuid := '45083000-0000-4000-8000-000000000001';
  v_brand uuid := '45083000-0000-4000-8000-000000000002';
  v_ev   uuid := '45083000-0000-4000-8000-000000000003';
  v_ev2  uuid := '45083000-0000-4000-8000-000000000004';
  v_ev3  uuid := '45083000-0000-4000-8000-000000000005';
  v_amy  uuid := '45083000-0000-4000-8000-000000000011'; -- signed-in inviter
  v_fae  uuid := '45083000-0000-4000-8000-000000000012'; -- Amy's friend, proven number
  v_gia  uuid := '45083000-0000-4000-8000-000000000013'; -- has an account, going herself
  v_res jsonb;
  v_res2 jsonb;
  v_err text;
  v_err2 text;
  v_rsvp uuid;
  v_fid uuid;
  v_tid uuid;
  v_seen_friend integer;
  v_seen_typed integer;
  v_seen_phone text;
  v_seen_own integer;
  v_key text;
BEGIN
  INSERT INTO auth.users(id, email) SELECT u, 'i4508s-' || right(u::text, 2) || '@example.test'
    FROM unnest(ARRAY[v_own, v_amy, v_fae, v_gia]) u;
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone)
  SELECT u, 'i4508s-' || right(u::text, 2) || '@example.test', n, split_part(n, ' ', 1), split_part(n, ' ', 2), NULL
    FROM (VALUES (v_amy, 'Amy Ash'), (v_fae, 'Fae Fern'), (v_gia, 'Gia Gold')) x(u, n)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = NULL;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_amy, '+15550407100'), (v_fae, '+15550407200'), (v_gia, '+15550407300');
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (v_amy, v_fae, 'accepted'), (v_fae, v_amy, 'accepted');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_own, 'i4508s-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_own, 'Issue 4508 Second', 'issue-4508-second', 'stripe', 'US', 'USD', 'USD',
    'host-4508s@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at, rsvp_guests_can_bring)
  VALUES
    (v_ev, v_brand, v_own, 'Second Party', 'second-4508s', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), true),
    (v_ev2, v_brand, v_own, 'Elsewhere', 'elsewhere-4508s', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), false),
    (v_ev3, v_brand, v_own, 'Busy', 'busy-4508s', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), false);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ev, now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true),
    (v_ev2, now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true),
    (v_ev3, now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true);

  -- Fixtures: Amy is going with a typed number and her friend Fae picked by
  -- account; Gia is going herself with a different typed number.
  v_res := public.submit_event_rsvp(v_ev, v_amy, 'Amy Ash', 'i4508s-11@example.test',
    '+15550407100', 'going', 2,
    jsonb_build_array(jsonb_build_object('phone', '+15550407500'), jsonb_build_object('userId', v_fae)),
    NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_fid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND added_from_friend;
  SELECT id INTO v_tid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND NOT added_from_friend;
  PERFORM public.submit_event_rsvp(v_ev, v_gia, 'Gia Gold', 'i4508s-13@example.test',
    '+15550407399', 'going', 0, '[]'::jsonb, NULL, 'US');

  -- ---- R-1: signed out, listed / released / account listed read the same --
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('e', 64))::text, true);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Probe', 'probe1-4508s@example.test',
    '+15550407901', 'going', 1, '[{"phone":"+15550407500"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_unavailable', 'R-1: a listed number reads unavailable: ' || v_err);
  INSERT INTO public.rsvp_guest_releases(event_id, phone_digits, release_count, inviter_keys)
  VALUES (v_ev, '15550407600', 2, ARRAY['user:' || v_amy]);
  v_err2 := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Probe', 'probe2-4508s@example.test',
    '+15550407902', 'going', 1, '[{"phone":"+15550407600"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err2 = v_err, 'R-1: a released number reads exactly the same: ' || v_err2);
  v_err2 := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Probe', 'probe3-4508s@example.test',
    '+15550407903', 'going', 1, '[{"phone":"+15550407300"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err2 = v_err, 'R-1: a number whose account is going reads the same: ' || v_err2);
  v_err2 := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Fae Fern', 'i4508s-12@example.test',
    '+15550407200', 'going', 1, '[{"phone":"+15550407600"}]'::jsonb, NULL, 'US')$s$, v_ev, v_fae));
  PERFORM pg_temp.ok(v_err2 = 'rsvp_guest_released', 'R-1: a signed-in caller keeps the specific code: ' || v_err2);

  -- R-1: the count happens before the submit and survives its rollback.
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('0', 64))::text, true);
  v_res := public.rsvp_guest_signed_out_attempt(v_ev, 1);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean AND (v_res->>'counted')::boolean,
    'R-1: a signed-out attempt is counted: ' || v_res::text);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Probe', 'probe4-4508s@example.test',
    '+15550407904', 'going', 1, '[{"phone":"+15550407500"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_unavailable'
    AND (SELECT sum(guest_count) FROM public.rsvp_guest_signed_out_attempts
          WHERE inviter_key = 'ip:' || repeat('0', 64)) = 1,
    'R-1: the refused submit rolled back, the attempt it used did not');
  INSERT INTO public.rsvp_guest_signed_out_attempts(inviter_key, event_id, guest_count)
  VALUES ('ip:' || repeat('0', 64), v_ev2, 19);
  v_res := public.rsvp_guest_signed_out_attempt(v_ev, 1);
  PERFORM pg_temp.ok(NOT (v_res->>'allowed')::boolean
    AND (SELECT sum(guest_count) FROM public.rsvp_guest_signed_out_attempts
          WHERE inviter_key = 'ip:' || repeat('0', 64)) = 20,
    'R-1: past 20 numbers an address is refused (across events) and nothing is written: ' || v_res::text);
  INSERT INTO public.rsvp_guest_signed_out_attempts(inviter_key, event_id, guest_count)
  SELECT 'ip:' || md5('s' || i) || md5('t' || i), v_ev3, 1 FROM generate_series(1, 30) i;
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('1', 64))::text, true);
  v_res := public.rsvp_guest_signed_out_attempt(v_ev3, 1);
  PERFORM pg_temp.ok(NOT (v_res->>'allowed')::boolean,
    'R-1: an event takes 30 signed-out guest numbers a day, refused ones included: ' || v_res::text);
  v_res := public.rsvp_guest_signed_out_attempt(gen_random_uuid(), 1);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean AND NOT (v_res->>'counted')::boolean,
    'R-1: an unknown event is not counted (the submit refuses it): ' || v_res::text);

  -- ---- R-2: a signed-out caller learns no account and no reason ----------
  INSERT INTO public.channel_suppressions(contact, channel, scope, reason)
  VALUES ('+15550407700', 'sms', 'all', 'stop_keyword');
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('2', 64))::text, true);
  v_res := public.submit_event_rsvp(v_ev2, NULL, 'Ola Out', 'out1-4508s@example.test',
    '+15550407801', 'going', 2,
    '[{"phone":"+15550407300"},{"phone":"+15550407700"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(
    (SELECT matched_user_id FROM public.event_rsvp_guests
      WHERE rsvp_id = (v_res->>'rsvpId')::uuid AND phone = '+15550407300') = v_gia,
    'fixture: the number is matched to Gia''s account on the server');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') x
                                  WHERE (x->>'onMingla')::boolean OR x->>'displayName' IS NOT NULL
                                     OR x->>'notTextedReason' IS NOT NULL)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') x
                 WHERE NOT (x->>'willText')::boolean),
    'R-2: signed out sees no account, no name and no reason, only willText: ' || (v_res->'guests')::text);
  v_res := public.submit_event_rsvp(v_ev3, v_amy, 'Amy Ash', 'i4508s-11@example.test',
    '+15550407100', 'going', 1, '[{"phone":"+15550407300"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((v_res->'guests'->0->>'onMingla')::boolean
    AND v_res->'guests'->0->>'displayName' = 'Gia Gold',
    'R-2: a signed-in inviter still sees the account: ' || (v_res->'guests')::text);
  PERFORM set_config('request.headers', '', true);

  -- ---- R-3: the inviter cannot read a picked friend's number --------------
  PERFORM pg_temp.as_user(v_amy);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) FILTER (WHERE id = v_fid), count(*) FILTER (WHERE id = v_tid),
         max(phone) FILTER (WHERE id = v_fid)
    INTO v_seen_friend, v_seen_typed, v_seen_phone
    FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_seen_friend = 0 AND v_seen_phone IS NULL AND v_seen_typed = 1,
    'R-3: as the inviter, the picked friend''s row (and number) is not readable; the typed guest is: '
      || v_seen_friend || '/' || v_seen_typed);
  PERFORM pg_temp.as_user(v_fae);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_seen_own FROM public.event_rsvp_guests WHERE id = v_fid;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_seen_own = 1, 'R-3: the friend still reads their own row');
  PERFORM pg_temp.ok((SELECT phone FROM public.event_rsvp_guests WHERE id = v_fid) = '+15550407200'
    AND public.rsvp_guest_message_context(v_fid) IS NOT NULL,
    'R-3: the number is still stored for texting and claiming');

  -- ---- R-6: an unclaimed matched guest is not offered "Bring someone too" -
  UPDATE public.event_rsvp_guests SET qr_code = 'mingla-rsvp:4508s-' || left(id::text, 8) WHERE rsvp_id = v_rsvp;
  UPDATE public.event_rsvps SET qr_code = 'mingla-rsvp:4508s-p' WHERE id = v_rsvp;
  PERFORM pg_temp.as_user(v_fae);
  PERFORM pg_temp.ok((SELECT guests_can_bring FROM public.fetch_user_rsvp_party_passes(v_rsvp)
                       WHERE entity_id = v_fid) IS NULL,
    'R-6: a matched guest who has not claimed gets no guestsCanBring');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_fae,
      public.mint_claim_link('rsvp_guest', v_fid)->>'code', NULL)->>'outcome' = 'claimed',
    'fixture: Fae claims');
  PERFORM pg_temp.as_user(v_fae);
  PERFORM pg_temp.ok((SELECT guests_can_bring FROM public.fetch_user_rsvp_party_passes(v_rsvp)
                       WHERE entity_id = v_fid) IS TRUE,
    'R-6: once claimed, the host setting shows');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ---- R-13: check-in by hand has the scan's grants ------------------------
  PERFORM pg_temp.ok(NOT has_function_privilege('service_role', 'public.host_check_in_rsvp_guest(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.host_check_in_rsvp_guest(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.host_check_in_rsvp_guest(uuid)', 'EXECUTE'),
    'R-13: authenticated only, as biz_rsvp_scan');

  -- ---- R-14: the number's lock is held until commit ----------------------
  PERFORM public.submit_event_rsvp(v_ev3, v_amy, 'Amy Ash', 'i4508s-11@example.test',
    '+15550407100', 'going', 1, '[{"phone":"+15550407850"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_locks l
      WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
        AND l.classid = 4508::oid AND l.objsubid = 2
        AND l.objid::bigint = (hashtext('rsvp_guest_number:15550407850')::bigint & 4294967295)),
    'R-14: submit holds the number''s advisory lock until commit');
  PERFORM pg_temp.ok(public.rsvp_guest_bring(v_fae, v_fid, '+15550407851', 'US', NULL)->>'outcome' = 'added'
    AND EXISTS (SELECT 1 FROM pg_locks l
      WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
        AND l.classid = 4508::oid AND l.objsubid = 2
        AND l.objid::bigint = (hashtext('rsvp_guest_number:15550407851')::bigint & 4294967295)),
    'R-14: guest_bring holds the number''s advisory lock too');

  -- ---- R-4: a daily ceiling on signed-out guest texts, all events ---------
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'ip:' || md5('c' || i) || md5('d' || i), v_ev2, '1555088' || lpad(i::text, 4, '0')
    FROM generate_series(1, 300) i;
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('3', 64))::text, true);
  v_res := public.submit_event_rsvp(v_ev, NULL, 'Ola Late', 'late-4508s@example.test',
    '+15550407811', 'going', 1, '[{"phone":"+15550407812"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((SELECT sms_hold FROM public.event_rsvp_guests
                       WHERE rsvp_id = (v_res->>'rsvpId')::uuid) = 'number_limit'
    AND NOT (v_res->'guests'->0->>'willText')::boolean,
    'R-4: past the signed-out daily ceiling a guest is added but not texted: ' || v_res::text);
  PERFORM set_config('request.headers', '', true);
  v_res := public.submit_event_rsvp(v_ev3, v_fae, 'Fae Fern', 'i4508s-12@example.test',
    '+15550407200', 'going', 1, '[{"phone":"+15550407813"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((SELECT sms_hold IS NULL FROM public.event_rsvp_guests
                       WHERE rsvp_id = (v_res->>'rsvpId')::uuid AND phone = '+15550407813')
    AND (v_res->'guests'->0->>'willText')::boolean,
    'R-4: a signed-in inviter is not held by the signed-out ceiling: ' || v_res::text);

  RAISE NOTICE '#4508 second rework: all cases passed';
END
$rework2$;

ROLLBACK;
