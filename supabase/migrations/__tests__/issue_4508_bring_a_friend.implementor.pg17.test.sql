-- #4508 Phase 1 / Phase 2 (server) — bring a friend with just their number.
--
-- MINGLA-INVARIANT: I-4508-GUEST-NUMBER-ONLY | issue #4508 | submit_event_rsvp accepts a plus-one with only a phone number (older {name,email,phone} guests still accepted), raises rsvp_plus_ones_exceeded over the host's limit, refuses the inviter's own number, duplicates, numbers already on the event's list and released numbers, caps an inviter at 20 guest numbers per rolling 24 hours (rsvp_guest_daily_cap), and keeps a guest row (claim, pass) across a re-submit that still lists its number.
-- MINGLA-INVARIANT: I-4508-CLAIM-NEEDS-THE-NUMBER | issue #4508 | rsvp_guest_claim attaches a pass only to an account that has proved the invited number (account_owns_contact); a code proved for another number returns phone_unproved and writes nothing. On claim, inviter and guest become friends and close friends through a pairing with source rsvp_guest that check_pairing_allowed does not count; a block between them skips the friendship.
-- MINGLA-INVARIANT: I-4508-RELEASE-STOPS-TEXTS | issue #4508 | "This isn't me" (rsvp_guest_release) deletes the unclaimed guest row, frees the spot, closes queued deliveries, and the number can never be re-added to that event; a claimed guest cannot be released.
-- MINGLA-INVARIANT: I-4508-ONE-REMINDER | issue #4508 | rsvp_enqueue_guest_reminders queues at most one reminder per guest, only for unclaimed guests whose invite text was delivered, 23-24 hours before the start.
-- MINGLA-INVARIANT: I-4508-FRIEND-GOING-ONCE | issue #4508 | a close friend gets at most one "is going" notice per event, never when they turned friends_going off.
-- MINGLA-INVARIANT: I-4508-SIGNED-OUT-LEARNS-VALID-ONLY | issue #4508 | rsvp_guest_lookup refuses a signed-out caller (rsvp_guest_sign_in_required) before the number is read; list and release state are answered only to a signed-in caller for an event they can RSVP to now.
-- MINGLA-INVARIANT: I-4508-GUEST-TEXT-CAPS | issue #4508 | guest numbers are capped at 20 per inviter per 24 hours (signed-out inviters keyed by their network address, never the number they typed), 30 per event per 24 hours from signed-out inviters, and a number past 3 guest invites in 24 hours is added but never texted (sms_hold number_limit, willText false).
-- MINGLA-INVARIANT: I-4508-BROUGHT-BY-AFTER-CLAIM | issue #4508 | peer_list_event_guests shows a plus-one as their own row (with broughtByName) only once claimed and while their own Show me as going is on; unclaimed plus-ones never appear and count as unclaimedGuestCount on the inviter's row; the seat total is unchanged.
-- MINGLA-INVARIANT: I-4508-SIGNED-OUT-SUBMIT-NO-ORACLE | issue #4508 | adding a plus-one needs a signed-in account: a signed-out submit_event_rsvp with any guest is refused (42501 rsvp_guest_sign_in_required) before any number or list is read, with the same answer for a new, listed, released or account-listed number, writing nothing and moving the public going count not at all; a signed-out RSVP without guests is unchanged.
-- MINGLA-INVARIANT: I-4508-FRIEND-NUMBER-NOT-OWNER-READABLE | issue #4508 | a party owner's direct read of event_rsvp_guests never returns a friend picked from the friends list (whose number the server resolved); the friend still reads their own row.
-- MINGLA-INVARIANT: I-4508-SIGNED-OUT-TEXT-CEILING | issue #4508 | the signed-out text ceiling (300 a day across all events) still reads reached past 300 as defence in depth, though no signed-out guest reaches it (they are refused); signed-in inviters are not affected.
-- MINGLA-INVARIANT: I-4508-NUMBER-LIMIT-SERIALIZED | issue #4508 | submit_event_rsvp and rsvp_guest_bring hold a transaction advisory lock on each guest number before counting its invites, so concurrent submits on different events cannot both pass the 3-per-day text limit.
-- MINGLA-INVARIANT: I-4508-LOOKUP-DAILY-CEILING | issue #4508 | the signed-in guest lookup is capped at 200 per account per rolling 24 hours: the 201st call in the window answers allowed = false and writes nothing, another account is unaffected, a lookup older than 24 hours no longer counts, and the counter table is service-role only.
-- MINGLA-INVARIANT: I-4508-GUEST-CHAT-AFTER-CLAIM | issue #4508 | a plus-one is a member of the brand Guest chat (#4459) only once the pass is claimed (rsvp_guest_claim or a proven-contact claim sweep): a number matched at submit, a friend picked from a list and any signed-out RSVP add nobody; claiming joins; leaving the party removes.
-- MINGLA-INVARIANT: I-4508-HOST-LABEL-BEFORE-CLAIM | issue #4508 | host_list_rsvp_guests, biz_rsvp_scan, host_check_in_rsvp_guest and admin_list_event_rsvps name an unclaimed plus-one by the typed name or "<Inviter first name>'s guest" (rsvp_guest_host_label), never the matched account, and onMingla is false until the claim; after the claim the account name shows.
-- MINGLA-INVARIANT: I-4508-CEILING-ATOMIC-ALERT | issue #4508 | the first signed-out ceiling hold of a UTC day records one row for a single ops alert, marked only after the alert went out; a signed-in submit with guests holds the inviter's own transaction lock (45082) so one inviter's concurrent submits on any events count each other against the 20-a-day cap.
-- MINGLA-INVARIANT: I-4508-CHECKIN-CLAIMED-REFUSED | issue #4508 | host_check_in_rsvp_guest answers result claimed for a guest who has claimed the pass and checks nobody in (the pass is scanned instead).
-- MINGLA-INVARIANT: I-4508-LEGACY-MATCH-IS-CLAIMED | issue #4508 | on its first apply the bring-a-friend migration sets claimed_at = created_at on every guest row already matched to an account, keeping those accounts in the brand Guest chat; a later apply never backfills, and removes from the Guest chat an account whose only claim to it is an unclaimed match.
-- MINGLA-INVARIANT: I-4508-ONE-PLACE-PER-PERSON | issue #4508 | one account holds at most one place on an event: its own RSVP drops an unclaimed plus-one row matched to it (the inviter is told), a claimed guest pass refuses a first own RSVP (rsvp_guest_has_pass), rsvp_guest_claim refuses an account already on the list even for a row matched to it, and claim and own RSVP serialize on the event row lock.
-- MINGLA-INVARIANT: I-4508-ONE-PLACE-ON-CLAIM-PATHS | issue #4508 | the proven-contact claim sweep releases, never matches, a plus-one row of an account holding its own RSVP on the event; an anonymous own RSVP attached to an account releases its unclaimed plus-one row; a claimed guest pass keeps an anonymous own RSVP from being attached (sweep skips, claim link answers conflict, other writers get PT409); each release queues the inviter's notice once.
-- MINGLA-INVARIANT: I-4508-GUEST-ACCOUNT-COLUMNS-CLOSED | issue #4508 | anon and authenticated cannot select event_rsvp_guests.matched_user_id or invited_by_user_id (column privileges); hosts and inviters read guests only through functions that apply the claim rule.
-- MINGLA-INVARIANT: I-4508-UNCLAIMED-NOT-EXPOSED | issue #4508 | an unclaimed plus-one is in no brand ad audience (ad_list_audience_refresh guest arm, and its People arm: no person counts through an unclaimed plus-one link and no contact method that only an unclaimed plus-one gave the brand is used) and cannot read their own pass (fetch_user_rsvp_party_passes, fetch_user_going_rsvps); both follow the claim, and no one else's audience membership changes.
-- MINGLA-INVARIANT: I-4508-NO-CLAIM-AT-SUBMIT | issue #4508 | submit_event_rsvp never claims a plus-one, whatever the payload shape: an old app's {name, email, phone} guest whose number and typed email the matched account both prove is still accepted, created, matched by number and queued its pass message, but stays unclaimed with no pass in that account until rsvp_guest_claim on the guest's link.
-- MINGLA-INVARIANT: I-4508-HOST-SETTING-QUIET | issue #4508 | saving only "Guests can bring guests" on a published RSVP queues no rsvp_event_updated notice and changes nothing else; plus-ones off clears the setting for every writer of a published event (trigger), and rsvp_guest_bring refuses while plus-ones are off.
-- MINGLA-INVARIANT: I-4508-PEOPLE-AFTER-CLAIM | issue #4508 | the brand's People (biz_resolve_brand_person_source, its derived worker entry and the conflict subject) never link or name a plus-one's matched account, nor import a friend pick's server-resolved number, until the pass is claimed; an unclaimed guest is imported exactly as an unmatched number-only guest, a claim (rsvp_guest_claim or a proven-number sweep) queues a re-ingest that links the claimer only, and a release retires the link.
-- MINGLA-INVARIANT: I-4508-NO-TEXT-WITHOUT-ROUTE | issue #4508 | no 'sms' delivery is seeded for a plus-one's pass message when the number has no SMS route (public.mingla_e164_country is NULL, the adapter's #1529 rule); the guest's email, in-app and push rows and the primary's rows are seeded as before, and the guest's invite status reads not_texted.
-- MINGLA-INVARIANT: I-4508-GUEST-LABEL-NOT-INVITER | issue #4508 | submit_event_rsvp answers a guest's displayName only from the matched account or the typed name, never the host-facing "<Inviter>'s guest" fallback; a plus-one's pass message with no channel at all (no text route, no email, no account) is marked skipped at insert.
\set ON_ERROR_STOP on
\ir ../20281119004508_issue_4508_guest_phone_match.sql
\ir ../20281119014508_issue_4508_bring_a_friend.sql

BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4508 FAIL: %', p_message; END IF;
END
$fn$;

-- T1: the error's SQLSTATE and message ('' when it succeeded).
CREATE FUNCTION pg_temp.err_state(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
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

  -- Old payload still accepted (older app versions), from a signed-in app.
  -- T1: the same payload signed out is refused (a guest needs an account).
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Old App', 'old-4508@example.test',
    '+15550204600', 'going', 1, '[{"name":"Typed Name","email":"typed-4508@example.test","phone":"+15550204601","phoneCountryIso":"US"}]'::jsonb,
    NULL, 'US')$s$, v_event));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE guest_email = 'old-4508@example.test'),
    'T1: the old guest payload signed out is refused, writing nothing: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Owner', 'i4508-owner@example.test',
    '+15550204600', 'going', 1, '[{"name":"Typed Name","email":"typed-4508@example.test","phone":"+15550204601","phoneCountryIso":"US"}]'::jsonb,
    NULL, 'US')$s$, v_event, v_owner));
  PERFORM pg_temp.ok(v_err = '', 'the old {name,email,phone} guest payload is accepted signed in: ' || v_err);
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
  -- T1: signed out, a number already on the list is refused like any other
  -- guest (sign in required) and is not added a second time.
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Other', 'other-4508@example.test',
    '+15550204700', 'going', 1, '[{"phone":"+15550204777"}]'::jsonb, NULL, 'US')$s$, v_event));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND (SELECT count(*) FROM public.event_rsvp_guests WHERE phone = '+15550204777') = 1
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE guest_email = 'other-4508@example.test'),
    'T1: a listed number signed out is refused and not re-added: ' || v_err);
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
  -- T1: a signed-out caller is refused before the number is read.
  v_err := pg_temp.err(format($s$SELECT public.rsvp_guest_lookup(NULL, %L, '+15550204599')$s$, v_event));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'T1: a signed-out lookup is refused: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.rsvp_guest_lookup(NULL, %L, '+15550204502')$s$, v_event));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'T1: a signed-out lookup of a listed number gets the same refusal: ' || v_err);
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
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required', 'C1 / T1: a signed-out inviter cannot pick an account: ' || v_err);
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

  -- ---- P1-2 / T1: signed-out callers add no guest at all -----------------
  -- Whatever the address (capped, fresh, or one whose event allowance is
  -- spent), a signed-out submit with a guest gets the one refusal and
  -- nothing is logged against any cap.
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('a', 64))::text, true);
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'ip:' || repeat('a', 64), v_evn, '1555066' || lpad(i::text, 4, '0') FROM generate_series(1, 20) i;
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon A', 'anon-a-4508r@example.test',
    '+15550306001', 'going', 1, '[{"phone":"+15550306002"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'T1: a capped signed-out address is refused for sign-in, not the cap: ' || v_err);
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('b', 64))::text, true);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon B', 'anon-b-4508r@example.test',
    '+15550306021', 'going', 1, '[{"phone":"+15550306022"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'T1: a fresh signed-out address gets the same refusal: ' || v_err);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_guest_invite_log
      WHERE inviter_key IN ('ip:' || repeat('b', 64)))
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps
      WHERE guest_email IN ('anon-a-4508r@example.test', 'anon-b-4508r@example.test')),
    'T1: a refused signed-out submit writes nothing and logs nothing');
  -- A signed-out RSVP with no guest is unchanged.
  v_res := public.submit_event_rsvp(v_ev, NULL, 'Anon C', 'anon-c-4508r@example.test',
    '+15550306031', 'going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(v_res->>'status' = 'going' AND jsonb_array_length(v_res->'guests') = 0,
    'T1: a signed-out RSVP with no guest is accepted as before: ' || v_res::text);
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
  -- T1: signed-out parties can no longer add guests, but rows from before
  -- (a signed-out party with guests) still exist, so the rule is kept and
  -- proved on such rows, written directly.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status, plus_count)
  VALUES (v_evp, NULL, 'Ann <a href=x.co>visit evil.co</a> 9 Zed', 'anon-n-4508r@example.test',
    '+15550306301', 'going', 'approved', 1)
  RETURNING id INTO v_rsvp;
  INSERT INTO public.event_rsvp_guests(rsvp_id, phone) VALUES (v_rsvp, '+15550306302')
  RETURNING id INTO v_gid;
  PERFORM pg_temp.ok((SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n) ~ '^[[:alpha:] ''-]+( [[:upper:]]\.)?$'
    AND length((SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n)) <= 24
    AND (SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n) NOT LIKE '%.co%',
    'P2-2: letters only, at most 24: ' || coalesce((SELECT n.label FROM public.rsvp_guest_inviter_names(v_gid) n), 'NULL'));
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status, plus_count)
  VALUES (v_evp, NULL, '!!! 123 ???', 'anon-m-4508r@example.test', '+15550306311', 'going', 'approved', 1)
  RETURNING id INTO v_rsvp;
  INSERT INTO public.event_rsvp_guests(rsvp_id, phone) VALUES (v_rsvp, '+15550306312');
  v_code := public.mint_claim_link('rsvp_guest',
    (SELECT id FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp))->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, NULL)->>'inviterName' = 'A friend',
    'P2-2: nothing safe left reads "A friend"');

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
  -- T3 (one person, one place): Vic holds a claimed guest pass on this event
  -- (P2-1 above), which refuses a first own RSVP; this fixture needs Vic's
  -- own row, so the guest pass goes first.
  DELETE FROM public.event_rsvp_guests g USING public.event_rsvps r
   WHERE r.id = g.rsvp_id AND r.event_id = v_ev AND g.matched_user_id = v_vw;
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
  -- R6 P3: the host's list says this check-in was by hand.
  PERFORM pg_temp.ok((SELECT (h.plus_checkins->0->>'checkedInByHand')::boolean
                        FROM public.host_list_rsvp_guests(v_evn) h WHERE h.user_id = v_inb),
    'R6 P3: a hand check-in is listed as checkedInByHand');
  PERFORM pg_temp.as_user(v_str);
  v_err := pg_temp.err(format('SELECT public.host_check_in_rsvp_guest(%L)', v_gid));
  PERFORM pg_temp.ok(v_err = 'scanner_not_authorized', 'C7: a stranger cannot check guests in: ' || v_err);
  -- T1: this guest used to come from a signed-out submit; signed in now.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.submit_event_rsvp(v_ev, v_inb, 'Ibo Bell', 'i4508r-12@example.test',
    '+15550305400', 'going', 1, '[{"phone":"+15550306022"}]'::jsonb, NULL, 'US');
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
  v_i integer;
  v_count0 bigint;
  v_rsvps0 bigint;
  v_logs0 bigint;
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

  -- ---- T1: signed out, a new / listed / released / account-listed number
  -- get the same bytes and move the public going count identically (not at
  -- all): the submit is refused before any number is read ------------------
  INSERT INTO public.rsvp_guest_releases(event_id, phone_digits, release_count, inviter_keys)
  VALUES (v_ev, '15550407600', 2, ARRAY['user:' || v_amy]);
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('e', 64))::text, true);
  v_count0 := (public.pg_public_social_proof(v_ev)->>'goingCount')::bigint;
  v_rsvps0 := (SELECT count(*) FROM public.event_rsvps WHERE event_id = v_ev);
  v_logs0 := (SELECT count(*) FROM public.rsvp_guest_invite_log);
  FOR v_i IN 1..4 LOOP
    -- new, listed (Amy's typed guest), released, an account on the list (Gia)
    v_err := pg_temp.err_state(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Probe', %L,
      '+15550407900', 'going', 1, %L::jsonb, NULL, 'US')$s$, v_ev,
      'probe' || v_i || '-4508s@example.test',
      jsonb_build_array(jsonb_build_object('phone',
        (ARRAY['+15550407520', '+15550407500', '+15550407600', '+15550407300'])[v_i]))));
    IF v_i = 1 THEN v_err2 := v_err; END IF;
    PERFORM pg_temp.ok(v_err = v_err2 AND v_err = '42501:rsvp_guest_sign_in_required',
      'T1: probe ' || v_i || ' (new / listed / released / account) gets the same answer: ' || v_err);
    PERFORM pg_temp.ok((public.pg_public_social_proof(v_ev)->>'goingCount')::bigint = v_count0,
      'T1: probe ' || v_i || ' moves the public going count not at all');
  END LOOP;
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvps WHERE event_id = v_ev) = v_rsvps0
    AND (SELECT count(*) FROM public.rsvp_guest_invite_log) = v_logs0
    AND NOT EXISTS (SELECT 1 FROM public.rsvp_guest_signed_out_attempts WHERE inviter_key = 'ip:' || repeat('e', 64)),
    'T1: the refused probes wrote no party, no guest, no cap count');
  -- The same without guests is an ordinary signed-out RSVP, and it counts.
  v_res := public.submit_event_rsvp(v_ev, NULL, 'Pat Plain', 'plain-4508s@example.test',
    '+15550407909', 'going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(v_res->>'status' = 'going'
    AND (public.pg_public_social_proof(v_ev)->>'goingCount')::bigint = v_count0 + 1,
    'T1: a signed-out RSVP without guests still lands and counts once: ' || v_res::text);
  -- not_going never carries a guest, so a stray array is no refusal.
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat No', 'no-4508s@example.test',
    '+15550407908', 'not_going', 1, '[{"phone":"+15550407520"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = '', 'T1: a signed-out not_going is unchanged: ' || v_err);
  PERFORM set_config('request.headers', '', true);
  v_err2 := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Fae Fern', 'i4508s-12@example.test',
    '+15550407200', 'going', 1, '[{"phone":"+15550407600"}]'::jsonb, NULL, 'US')$s$, v_ev, v_fae));
  PERFORM pg_temp.ok(v_err2 = 'rsvp_guest_released', 'R-1: a signed-in caller keeps the specific code: ' || v_err2);
  v_err2 := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Fae Fern', 'i4508s-12@example.test',
    '+15550407200', 'going', 1, '[{"phone":"+15550407500"}]'::jsonb, NULL, 'US')$s$, v_ev, v_fae));
  PERFORM pg_temp.ok(v_err2 = 'rsvp_guest_already_listed', 'R-1: signed in, a listed number is named: ' || v_err2);
  v_err2 := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Fae Fern', 'i4508s-12@example.test',
    '+15550407200', 'going', 1, '[{"phone":"+15550407300"}]'::jsonb, NULL, 'US')$s$, v_ev, v_fae));
  PERFORM pg_temp.ok(v_err2 = 'rsvp_guest_already_listed', 'R-1: signed in, an account on the list is named: ' || v_err2);

  -- R-1 / N-2: the count happens before the submit and survives its rollback,
  -- against the caller only.
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('0', 64))::text, true);
  v_res := public.rsvp_guest_signed_out_attempt(v_ev, 1);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean AND (v_res->>'counted')::boolean,
    'R-1: a signed-out attempt is counted: ' || v_res::text);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Probe', 'probe4-4508s@example.test',
    '+15550407904', 'going', 1, '[{"phone":"+15550407904"}]'::jsonb, NULL, 'US')$s$, v_ev));
  -- T1: the refused submit is now the sign-in refusal.
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND (SELECT sum(guest_count) FROM public.rsvp_guest_signed_out_attempts
          WHERE inviter_key = 'ip:' || repeat('0', 64)) = 1,
    'R-1: the refused submit rolled back, the attempt it used did not: ' || v_err);
  INSERT INTO public.rsvp_guest_signed_out_attempts(inviter_key, event_id, guest_count)
  VALUES ('ip:' || repeat('0', 64), v_ev2, 19);
  v_res := public.rsvp_guest_signed_out_attempt(v_ev, 1);
  PERFORM pg_temp.ok(NOT (v_res->>'allowed')::boolean
    AND (SELECT sum(guest_count) FROM public.rsvp_guest_signed_out_attempts
          WHERE inviter_key = 'ip:' || repeat('0', 64)) = 20,
    'R-1: past 20 numbers an address is refused (across events) and nothing is written: ' || v_res::text);
  -- N-2: 30 refused attempts on one event from other callers do not use up
  -- that event's allowance for a new caller.
  INSERT INTO public.rsvp_guest_signed_out_attempts(inviter_key, event_id, guest_count)
  SELECT 'ip:' || md5('s' || i) || md5('t' || i), v_ev3, 1 FROM generate_series(1, 30) i;
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('1', 64))::text, true);
  v_res := public.rsvp_guest_signed_out_attempt(v_ev3, 1);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean AND (v_res->>'counted')::boolean,
    'N-2: refused attempts by others do not use up an event''s allowance: ' || v_res::text);
  -- N-2: the event's 30 a day counts accepted invites inside the submit.
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'ip:' || md5('u' || i) || md5('v' || i), v_ev3, '1555077' || lpad(i::text, 4, '0')
    FROM generate_series(1, 30) i;
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Pat Late', 'probe5-4508s@example.test',
    '+15550407905', 'going', 1, '[{"phone":"+15550407955"}]'::jsonb, NULL, 'US')$s$, v_ev3));
  -- T1: a signed-out guest never reaches the per-event allowance now.
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'N-2 / T1: past 30 accepted signed-out invites, a signed-out guest is refused for sign-in: ' || v_err);
  v_res := public.rsvp_guest_signed_out_attempt(gen_random_uuid(), 1);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean AND NOT (v_res->>'counted')::boolean,
    'R-1: an unknown event is not counted (the submit refuses it): ' || v_res::text);

  -- ---- R-2: a signed-out caller learns no account and no reason ----------
  INSERT INTO public.channel_suppressions(contact, channel, scope, reason)
  VALUES ('+15550407700', 'sms', 'all', 'stop_keyword');
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('2', 64))::text, true);
  -- T1: a signed-out caller cannot add a guest, so it learns nothing at all.
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Ola Out', 'out1-4508s@example.test',
    '+15550407801', 'going', 2,
    '[{"phone":"+15550407300"},{"phone":"+15550407700"}]'::jsonb, NULL, 'US')$s$, v_ev2));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'R-2 / T1: signed out learns nothing about a number (refused): ' || v_err);
  v_res := public.submit_event_rsvp(v_ev3, v_amy, 'Amy Ash', 'i4508s-11@example.test',
    '+15550407100', 'going', 1, '[{"phone":"+15550407300"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((v_res->'guests'->0->>'onMingla')::boolean
    AND v_res->'guests'->0->>'displayName' = 'Gia Gold',
    'R-2: a signed-in inviter still sees the account: ' || (v_res->'guests')::text);
  PERFORM set_config('request.headers', '', true);

  -- ---- R-3: the inviter cannot read a picked friend's row ---------------
  PERFORM pg_temp.as_user(v_amy);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) FILTER (WHERE id = v_fid), count(*) FILTER (WHERE id = v_tid)
    INTO v_seen_friend, v_seen_typed
    FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_seen_friend = 0 AND v_seen_typed = 1,
    'R-3: as the inviter, the picked friend''s row is not readable; the typed guest is: '
      || v_seen_friend || '/' || v_seen_typed);
  PERFORM pg_temp.as_user(v_fae);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_seen_own FROM public.event_rsvp_guests WHERE id = v_fid;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_seen_own = 1, 'R-3: the friend still reads their own row');
  PERFORM pg_temp.ok((SELECT phone FROM public.event_rsvp_guests WHERE id = v_fid) = '+15550407200'
    AND public.rsvp_guest_message_context(v_fid) IS NOT NULL,
    'R-3: the number is still stored for texting and claiming');

  -- ---- N-3: no app role reads a guest's number or email directly ---------
  -- As the brand owner (host read policy) and as the inviter (owner read).
  PERFORM pg_temp.ok(NOT has_column_privilege('authenticated', 'public.event_rsvp_guests', 'phone', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.event_rsvp_guests', 'email', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.event_rsvp_guests', 'phone', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.event_rsvp_guests', 'email', 'SELECT')
    AND has_column_privilege('authenticated', 'public.event_rsvp_guests', 'rsvp_id', 'SELECT')
    AND has_column_privilege('service_role', 'public.event_rsvp_guests', 'phone', 'SELECT'),
    'N-3: phone and email are not readable by app roles; other columns and service_role are');
  PERFORM pg_temp.ok(NOT has_column_privilege('authenticated', 'public.event_rsvp_guests', 'matched_user_id', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.event_rsvp_guests', 'invited_by_user_id', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.event_rsvp_guests', 'matched_user_id', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.event_rsvp_guests', 'invited_by_user_id', 'SELECT')
    AND has_column_privilege('authenticated', 'public.event_rsvp_guests', 'claimed_at', 'SELECT'),
    'T2: the matched account and the inviter account are not readable by app roles');
  -- T2: the tester's read (PostgREST select=id,matched_user_id,claimed_at) as
  -- the host JWT and as the inviter JWT, on an UNCLAIMED matched guest.
  PERFORM pg_temp.ok((SELECT matched_user_id = v_fae AND claimed_at IS NULL
                        FROM public.event_rsvp_guests WHERE id = v_fid),
    'T2 fixture: Fae''s row is matched and unclaimed');
  FOREACH v_key IN ARRAY ARRAY['matched_user_id', 'invited_by_user_id'] LOOP
    PERFORM pg_temp.as_user(v_own);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_err := pg_temp.err(format('SELECT id, %I, claimed_at FROM public.event_rsvp_guests WHERE rsvp_id = %L', v_key, v_rsvp));
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.ok(v_err LIKE 'permission denied%',
      'T2: the host cannot select ' || v_key || ': ' || v_err);
    PERFORM pg_temp.as_user(v_amy);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_err := pg_temp.err(format('SELECT id, %I, claimed_at FROM public.event_rsvp_guests WHERE id = %L', v_key, v_tid));
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.ok(v_err LIKE 'permission denied%',
      'T2: the inviter cannot select ' || v_key || ': ' || v_err);
  END LOOP;
  -- The row reads the apps use keep working without those columns.
  PERFORM pg_temp.as_user(v_own);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_err := pg_temp.err(format('SELECT id, claimed_at, rsvp_id FROM public.event_rsvp_guests WHERE rsvp_id = %L', v_rsvp));
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_err = '', 'T2: the host still selects the other columns: ' || v_err);
  PERFORM pg_temp.as_user(v_fae);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_seen_own FROM public.event_rsvp_guests WHERE id = v_fid;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_seen_own = 1, 'T2: the owner-read policy still finds a guest''s own row by account');
  FOREACH v_key IN ARRAY ARRAY['phone', 'email'] LOOP
    PERFORM pg_temp.as_user(v_own);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_err := pg_temp.err(format('SELECT %I FROM public.event_rsvp_guests WHERE rsvp_id = %L', v_key, v_rsvp));
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.ok(v_err LIKE 'permission denied%',
      'N-3: the host cannot select ' || v_key || ': ' || v_err);
    PERFORM pg_temp.as_user(v_amy);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_err := pg_temp.err(format('SELECT %I FROM public.event_rsvp_guests WHERE id = %L', v_key, v_tid));
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.ok(v_err LIKE 'permission denied%',
      'N-3: the inviter cannot select ' || v_key || ': ' || v_err);
  END LOOP;
  PERFORM pg_temp.as_user(v_own);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_seen_typed FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(v_seen_typed = 2, 'N-3: the host still reads the rows (no number): ' || v_seen_typed);
  PERFORM pg_temp.as_user(v_own);
  PERFORM pg_temp.ok((SELECT bool_and(x->>'phoneLast4' ~ '^[0-9]{4}$')
                        FROM public.host_list_rsvp_guests(v_ev) h,
                             jsonb_array_elements(h.plus_checkins) x
                       WHERE h.id = v_rsvp),
    'N-3: the host list still gives the last four digits');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

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
  -- T1: a signed-out guest is refused before the ceiling is read; the
  -- ceiling's own rule is proved directly below.
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Ola Late', 'late-4508s@example.test',
    '+15550407811', 'going', 1, '[{"phone":"+15550407812"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE phone = '+15550407812'),
    'R-4 / T1: past the ceiling a signed-out guest is refused, nothing added: ' || v_err);
  PERFORM pg_temp.ok(public.rsvp_guest_signed_out_text_ceiling_reached(),
    'R-4: the ceiling itself still reads reached past 300 (defence in depth)');
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

-- FAILS-ON-REVERT: remove rsvp_guest_lookup_day_hit's count check (always allow) -> the 201st call is allowed and L-1 fails.
DO $lookup_day$
DECLARE
  v_a uuid := '45081000-0000-4000-8000-0000000000a1';
  v_b uuid := '45081000-0000-4000-8000-0000000000a2';
  v_res jsonb;
  v_all boolean;
  v_rows integer;
BEGIN
  SELECT bool_and((public.rsvp_guest_lookup_day_hit(v_a, 200)->>'allowed')::boolean)
    INTO v_all FROM generate_series(1, 200);
  PERFORM pg_temp.ok(v_all, 'L-1: the first 200 lookups of the day are allowed');
  v_res := public.rsvp_guest_lookup_day_hit(v_a, 200);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean IS FALSE
    AND (v_res->>'hits')::integer = 200 AND (v_res->>'limit')::integer = 200,
    'L-1: the 201st lookup is refused: ' || v_res::text);
  SELECT count(*) INTO v_rows FROM public.rsvp_guest_lookup_log WHERE user_id = v_a;
  PERFORM pg_temp.ok(v_rows = 200, 'L-2: a refused lookup writes nothing: ' || v_rows);
  v_res := public.rsvp_guest_lookup_day_hit(v_b, 200);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean, 'L-3: another account is not affected');
  -- Rolling: lookups older than 24 hours stop counting.
  UPDATE public.rsvp_guest_lookup_log SET created_at = now() - interval '25 hours'
   WHERE id IN (SELECT id FROM public.rsvp_guest_lookup_log WHERE user_id = v_a ORDER BY id LIMIT 50);
  v_res := public.rsvp_guest_lookup_day_hit(v_a, 200);
  PERFORM pg_temp.ok((v_res->>'allowed')::boolean AND (v_res->>'hits')::integer = 151,
    'L-4: lookups older than 24 hours are dropped from the count: ' || v_res::text);
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.rsvp_guest_lookup_log', 'SELECT')
    AND NOT has_function_privilege('authenticated', 'public.rsvp_guest_lookup_day_hit(uuid, integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rsvp_guest_lookup_day_hit(uuid, integer)', 'EXECUTE'),
    'L-5: the counter is service-role only');
  RAISE NOTICE '#4508 lookup daily ceiling: all cases passed';
END
$lookup_day$;

-- ===========================================================================
-- Third rework (#4508): N-1, N-5, N-8, N-9 and claim sweeps.
-- FAILS-ON-REVERT: drop "AND g.claimed_at IS NOT NULL" from the guest arm -> N-1 "not in the Guest chat" fails; use rsvp_guest_display_name in host_list_rsvp_guests -> N-5 fails; remove the inviter lock (45082) from submit_event_rsvp -> P3-T6 fails; remove the claimed branch of host_check_in_rsvp_guest -> N-9 fails.
-- ===========================================================================
DO $rework3$
DECLARE
  v_own  uuid := '45084000-0000-4000-8000-000000000001';
  v_brand uuid := '45084000-0000-4000-8000-000000000002';
  v_ev   uuid := '45084000-0000-4000-8000-000000000003';
  v_amy  uuid := '45084000-0000-4000-8000-000000000011'; -- signed-in inviter
  v_kim  uuid := '45084000-0000-4000-8000-000000000012'; -- proves +15550408200
  v_lia  uuid := '45084000-0000-4000-8000-000000000013'; -- proves +15550408300
  v_mo   uuid := '45084000-0000-4000-8000-000000000014'; -- proves +15550408400 later, claims by a sweep
  v_nia  uuid := '45084000-0000-4000-8000-000000000015'; -- proves +15550408500
  v_conv uuid;
  v_res jsonb;
  v_rsvp uuid;
  v_gk uuid;
  v_gl uuid;
  v_gm uuid;
  v_def text;
  v_err text;
BEGIN
  INSERT INTO auth.users(id, email) SELECT u, 'i4508t-' || right(u::text, 2) || '@example.test'
    FROM unnest(ARRAY[v_own, v_amy, v_kim, v_lia, v_mo, v_nia]) u;
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone)
  SELECT u, 'i4508t-' || right(u::text, 2) || '@example.test', n, split_part(n, ' ', 1), split_part(n, ' ', 2), NULL
    FROM (VALUES (v_amy, 'Amy Ames'), (v_kim, 'Kim Kerr'), (v_lia, 'Lia Lane'), (v_mo, 'Mo Moss'),
                 (v_nia, 'Nia Nash')) x(u, n)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = NULL;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_amy, '+15550408100'), (v_kim, '+15550408200'), (v_lia, '+15550408300'), (v_nia, '+15550408500');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_own, 'i4508t-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_own, 'Issue 4508 Third', 'issue-4508-third', 'stripe', 'US', 'USD', 'USD',
    'host-4508t@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  VALUES (v_ev, v_brand, v_own, 'Third Party', 'third-4508t', 'rsvp', 'scheduled', 'public',
    'UTC', 'USD', NULL, false, 'auto', true, 3, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ev, now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true);

  -- ---- N-1: the Guest chat needs a claimed pass ---------------------------
  v_def := pg_get_functiondef('public.issue_4459_brand_guest_eligible(uuid,uuid)'::regprocedure);
  PERFORM pg_temp.ok(v_def LIKE '%AND g.matched_user_id = p_user_id%AND g.claimed_at IS NOT NULL%'
    AND v_def LIKE '%public.issue_4473_shared_brand_guest(p_brand_id, p_user_id) OR%'
    AND v_def LIKE '%pending_trip_chat_claims%',
    'N-1: eligibility keeps every #4459 / #4473 arm and the guest arm needs a claim');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = 'public.event_rsvp_guests'::regclass
        AND t.tgname = 'issue_4459_brand_guest_chat_rsvp_party'
        AND pg_get_triggerdef(t.oid) LIKE '%UPDATE OF matched_user_id, rsvp_id, claimed_at%'),
    'N-1: the party trigger also fires on a claim');

  v_res := public.submit_event_rsvp(v_ev, v_amy, 'Amy Ames', 'i4508t-11@example.test',
    '+15550408100', 'going', 3,
    '[{"phone":"+15550408200"},{"phone":"+15550408300"},{"phone":"+15550408400"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gk FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550408200';
  SELECT id INTO v_gl FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550408300';
  SELECT id INTO v_gm FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550408400';
  v_conv := public.issue_4459_ensure_brand_guest_chat(v_brand);
  PERFORM pg_temp.ok(v_conv IS NOT NULL
    AND (SELECT matched_user_id = v_kim AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gk)
    AND EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE conversation_id = v_conv AND user_id = v_amy),
    'fixture: Kim''s number matched (unclaimed); Amy is in the Guest chat');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.conversation_participants
                                  WHERE conversation_id = v_conv AND user_id IN (v_kim, v_lia)),
    'N-1: an unclaimed matched plus-one is not in the Guest chat');
  PERFORM set_config('request.headers', json_build_object('x-mingla-rsvp-client', repeat('9', 64))::text, true);
  -- T1: a signed-out RSVP cannot add a guest at all, so it cannot drop an
  -- account into the Guest chat either.
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Ola Out', 'out-4508t@example.test',
    '+15550408900', 'going', 1, '[{"phone":"+15550408500"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE phone = '+15550408500')
    AND NOT EXISTS (SELECT 1 FROM public.conversation_participants
                     WHERE conversation_id = v_conv AND user_id = v_nia),
    'N-1 / T1: a signed-out RSVP cannot drop an account into the Guest chat: ' || v_err);
  PERFORM set_config('request.headers', '', true);
  -- P3-T6: a signed-in submit with guests holds the inviter's own lock until
  -- commit, so a concurrent submit by the same inviter (any event, any brand)
  -- counts after it.
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_locks l
      WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
        AND l.classid = 45082::oid AND l.objsubid = 2
        AND l.objid::bigint = (hashtext('user:' || v_amy)::bigint & 4294967295)),
    'P3-T6: a signed-in submit with guests holds the inviter lock until commit');

  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_kim,
      public.mint_claim_link('rsvp_guest', v_gk)->>'code', NULL)->>'outcome' = 'claimed',
    'fixture: Kim claims');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.conversation_participants
                              WHERE conversation_id = v_conv AND user_id = v_kim),
    'N-1: claiming the pass joins the Guest chat');
  -- A proven-contact claim sweep (#4063 / #4459) matching an unmatched row to
  -- the account that proved its number is a claim too (an email-only match is
  -- not: P2-1 above).
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_mo, '+15550408400');
  UPDATE public.event_rsvp_guests SET matched_user_id = v_mo WHERE id = v_gm AND matched_user_id IS NULL;
  PERFORM pg_temp.ok((SELECT claimed_at IS NOT NULL FROM public.event_rsvp_guests WHERE id = v_gm)
    AND EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE conversation_id = v_conv AND user_id = v_mo),
    'N-1: a claim sweep that matches the row records the claim and joins');

  -- ---- N-5: hosts never see the matched account before the claim ----------
  PERFORM pg_temp.ok(public.rsvp_guest_host_label(v_gl) = 'Amy''s guest'
    AND public.rsvp_guest_display_name(v_gl) = 'Lia Lane',
    'N-5: the host label of an unclaimed matched guest is neutral: ' || public.rsvp_guest_host_label(v_gl));
  PERFORM pg_temp.as_user(v_own);
  PERFORM pg_temp.ok((SELECT x->>'name' = 'Amy''s guest' AND NOT (x->>'onMingla')::boolean
                             AND NOT (x->>'claimed')::boolean AND x->>'phoneLast4' = '8300'
                        FROM public.host_list_rsvp_guests(v_ev) h, jsonb_array_elements(h.plus_checkins) x
                       WHERE h.id = v_rsvp AND x->>'id' = v_gl::text)
    AND (SELECT h.plus_checkins::text NOT LIKE '%Lia%' FROM public.host_list_rsvp_guests(v_ev) h
          WHERE h.id = v_rsvp),
    'N-5: the host list names an unclaimed guest "Amy''s guest", onMingla false');
  PERFORM pg_temp.ok((SELECT x->>'name' = 'Kim Kerr' AND (x->>'onMingla')::boolean
                        FROM public.host_list_rsvp_guests(v_ev) h, jsonb_array_elements(h.plus_checkins) x
                       WHERE h.id = v_rsvp AND x->>'id' = v_gk::text),
    'N-5: after the claim the host sees the account name');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.ok(
    (SELECT bool_and(pg_get_functiondef(f) LIKE '%rsvp_guest_host_label(%'
                     AND pg_get_functiondef(f) NOT LIKE '%rsvp_guest_display_name(%')
       FROM unnest(ARRAY['public.biz_rsvp_scan(uuid,text)'::regprocedure,
                         'public.host_check_in_rsvp_guest(uuid)'::regprocedure,
                         'public.admin_list_event_rsvps(uuid,integer,integer)'::regprocedure,
                         'public.host_list_rsvp_guests(uuid)'::regprocedure]) f),
    'N-5: the scanner, check-in by hand, Admin and host list all use the host label');

  -- ---- N-9: a claimed guest is checked in by scanning the pass -----------
  PERFORM pg_temp.as_user(v_own);
  v_res := public.host_check_in_rsvp_guest(v_gk);
  PERFORM pg_temp.ok(v_res->>'result' = 'claimed' AND NOT (v_res ? 'checkedInAt')
    AND (SELECT checked_in_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gk)
    AND EXISTS (SELECT 1 FROM public.rsvp_scan_events e
                 WHERE e.guest_id = v_gk AND e.outcome = 'not_eligible'
                   AND e.metadata->>'reason' = 'claimed' AND e.metadata->>'source' = 'host-manual'),
    'N-9: check-in by hand refuses a claimed guest (audited): ' || v_res::text);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ---- N-8: one ops alert per UTC day the ceiling holds a guest ----------
  -- The second rework block took the ceiling past 300. T1: no signed-out
  -- guest reaches it through a submit any more, so the hold is driven
  -- directly (defence in depth); a second hold the same day adds no row.
  v_res := jsonb_build_object('first', public.rsvp_guest_signed_out_ceiling_holds(),
    'second', public.rsvp_guest_signed_out_ceiling_holds());
  PERFORM pg_temp.ok((v_res->>'first')::boolean AND (v_res->>'second')::boolean
    AND (SELECT count(*) FROM public.rsvp_guest_signed_out_ceiling_hits
          WHERE hit_day = (now() AT TIME ZONE 'UTC')::date) = 1
    AND (SELECT count(*) FROM public.issue_4508_list_ceiling_hits()) = 1,
    'N-8: the ceiling day is recorded once for one alert: ' || v_res::text);
  PERFORM pg_temp.ok(public.issue_4508_mark_ceiling_hit_reported((now() AT TIME ZONE 'UTC')::date) = 1,
    'N-8: the day is marked reported after the alert');
  PERFORM pg_temp.ok(public.issue_4508_mark_ceiling_hit_reported((now() AT TIME ZONE 'UTC')::date) = 0,
    'N-8: marking twice changes nothing');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.issue_4508_list_ceiling_hits()),
    'N-8: a reported day is no longer listed');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.rsvp_guest_signed_out_ceiling_hits', 'SELECT')
    AND NOT has_function_privilege('authenticated', 'public.issue_4508_list_ceiling_hits()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4508_mark_ceiling_hit_reported(date)', 'EXECUTE'),
    'N-8: the ceiling record is service-role only');

  -- ---- N-1: leaving the party leaves the chat ----------------------------
  PERFORM public.submit_event_rsvp(v_ev, v_amy, 'Amy Ames', 'i4508t-11@example.test',
    '+15550408100', 'going', 1, '[{"phone":"+15550408300"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.conversation_participants
                                  WHERE conversation_id = v_conv AND user_id IN (v_kim, v_mo)),
    'N-1: a claimed guest dropped from the party leaves the Guest chat');
  PERFORM pg_temp.ok(public.rsvp_guest_release(public.mint_claim_link('rsvp_guest', v_gl)->>'code')->>'outcome' = 'released'
    AND NOT EXISTS (SELECT 1 FROM public.conversation_participants
                     WHERE conversation_id = v_conv AND user_id = v_lia),
    'N-1: a released guest is not in the Guest chat');

  RAISE NOTICE '#4508 third rework: all cases passed';
END
$rework3$;

-- ===========================================================================
-- S3 (#4508): the brand's People never carry an unclaimed plus-one's account.
-- Until the guest claims, the import is the same as for an unmatched
-- number-only guest (no account link, no account name, only the typed
-- number); a friend picked from a list (whose number the server resolved) is
-- not imported at all. The claim attaches the claimer's account, by
-- rsvp_guest_claim or a proven-number claim sweep; release retires the link.
-- Runs the ingest worker's entry point (biz_resolve_brand_person_source_derived).
-- FAILS-ON-REVERT: read g.matched_user_id unmasked in the resolver and its
-- derived entry -> "S3: an unclaimed matched plus-one has no account link"
-- fails; read g.phone unmasked -> "S3: a friend pick is not imported" fails;
-- drop the claim re-ingest trigger -> "S3: a claim queues a re-ingest" fails;
-- drop the S3 attach in the resolver -> "S3: after the claim the person is
-- linked to the claimer" fails; unmask the conflict subject -> "S3: the
-- conflict subject of an unclaimed guest" fails.
-- ===========================================================================
DO $s3_people$
DECLARE
  v_own   uuid := '45086000-0000-4000-8000-000000000001';
  v_brand uuid := '45086000-0000-4000-8000-000000000002';
  v_ev    uuid := '45086000-0000-4000-8000-000000000003';
  v_amy   uuid := '45086000-0000-4000-8000-000000000011'; -- signed-in inviter
  v_kim   uuid := '45086000-0000-4000-8000-000000000012'; -- proves K, claims
  v_lia   uuid := '45086000-0000-4000-8000-000000000013'; -- matched to M by a non-proving sweep
  v_mo    uuid := '45086000-0000-4000-8000-000000000014'; -- proves M later, claims
  v_fay   uuid := '45086000-0000-4000-8000-000000000015'; -- Amy's friend, picked from the list
  v_nia   uuid := '45086000-0000-4000-8000-000000000016'; -- proves N, releases
  v_oz    uuid := '45086000-0000-4000-8000-000000000017'; -- proves O later, claimed by a sweep
  v_res jsonb;
  v_rsvp uuid;
  v_gk uuid; v_gm uuid; v_gf uuid; v_gn uuid; v_go uuid; v_gu uuid;
  v_pk uuid; v_pu uuid;
BEGIN
  INSERT INTO auth.users(id, email) SELECT u, 'i4508p-' || right(u::text, 2) || '@example.test'
    FROM unnest(ARRAY[v_own, v_amy, v_kim, v_lia, v_mo, v_fay, v_nia, v_oz]) u;
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone)
  SELECT u, 'i4508p-' || right(u::text, 2) || '@example.test', n, split_part(n, ' ', 1), split_part(n, ' ', 2), NULL
    FROM (VALUES (v_amy, 'Amy Ames'), (v_kim, 'Kim Kerr'), (v_lia, 'Lia Lane'), (v_mo, 'Mo Moss'),
                 (v_fay, 'Fay Ford'), (v_nia, 'Nia Nash'), (v_oz, 'Oz Orr')) x(u, n)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = NULL;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_amy, '+15550410100'), (v_kim, '+15550410200'), (v_fay, '+15550410500'), (v_nia, '+15550410600');
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (v_amy, v_fay, 'accepted'), (v_fay, v_amy, 'accepted');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_own, 'i4508p-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_own, 'Issue 4508 People', 'issue-4508-people', 'stripe', 'US', 'USD', 'USD',
    'host-4508p@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  VALUES (v_ev, v_brand, v_own, 'People Night', 'people-4508p', 'rsvp', 'scheduled', 'public',
    'UTC', 'USD', NULL, false, 'auto', true, 6, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ev, now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true);

  -- K matches Kim, F is a friend pick, N matches Nia, M / O / U match nobody yet.
  v_res := public.submit_event_rsvp(v_ev, v_amy, 'Amy Ames', 'i4508p-11@example.test',
    '+15550410100', 'going', 6,
    jsonb_build_array(jsonb_build_object('phone', '+15550410200'), jsonb_build_object('phone', '+15550410400'),
      jsonb_build_object('userId', v_fay), jsonb_build_object('phone', '+15550410600'),
      jsonb_build_object('phone', '+15550410800'), jsonb_build_object('phone', '+15550410700')), NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gk FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550410200';
  SELECT id INTO v_gm FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550410400';
  SELECT id INTO v_gf FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND added_from_friend;
  SELECT id INTO v_gn FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550410600';
  SELECT id INTO v_go FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550410800';
  SELECT id INTO v_gu FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550410700';
  -- A sweep that matches M to an account that has NOT proved M (an email
  -- match) is not a claim (P2-1).
  UPDATE public.event_rsvp_guests SET matched_user_id = v_lia WHERE id = v_gm;
  PERFORM pg_temp.ok(
    (SELECT matched_user_id = v_kim AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gk)
    AND (SELECT matched_user_id = v_lia AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gm)
    AND (SELECT matched_user_id = v_fay AND claimed_at IS NULL AND phone = '+15550410500'
           FROM public.event_rsvp_guests WHERE id = v_gf)
    AND (SELECT matched_user_id = v_nia AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gn)
    AND (SELECT matched_user_id IS NULL FROM public.event_rsvp_guests WHERE id IN (v_go, v_gu) LIMIT 1),
    'fixture: K, M, F and N are matched and unclaimed; O and U are unmatched');

  -- ---- before the claim -----------------------------------------------------
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', g)
     FROM unnest(ARRAY[v_gk, v_gm, v_gf, v_gn, v_go, v_gu]) g;
  SELECT l.brand_person_id INTO v_pk FROM public.brand_person_source_links l
   WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gk AND l.detached_at IS NULL;
  SELECT l.brand_person_id INTO v_pu FROM public.brand_person_source_links l
   WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gu AND l.detached_at IS NULL;
  PERFORM pg_temp.ok(v_pk IS NOT NULL AND v_pu IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.brand_people p
                     WHERE p.brand_id = v_brand AND p.linked_user_id IN (v_kim, v_lia, v_mo, v_fay, v_nia, v_oz)),
    'S3: an unclaimed matched plus-one has no account link');
  PERFORM pg_temp.ok(
    (SELECT p.linked_user_id IS NULL AND p.display_name = 'Guest' FROM public.brand_people p WHERE p.id = v_pk)
    AND (SELECT array_agg(c.channel || ':' || c.normalized_value ORDER BY c.channel)
           FROM public.brand_person_contact_methods c
          WHERE c.brand_person_id = v_pk AND c.record_state = 'active') = ARRAY['phone:+15550410200']
    AND (SELECT l.link_method FROM public.brand_person_source_links l
          WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gk AND l.detached_at IS NULL)
      = (SELECT l.link_method FROM public.brand_person_source_links l
          WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gu AND l.detached_at IS NULL)
    AND (SELECT p.linked_user_id IS NULL AND p.display_name = 'Guest' FROM public.brand_people p WHERE p.id = v_pu),
    'S3: an unclaimed matched plus-one is imported exactly as an unmatched number-only guest');
  PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM public.brand_person_names n JOIN public.brand_people p ON p.id = n.brand_person_id
       WHERE p.brand_id = v_brand
         AND (n.normalized_name ~ '(kim|lia|mo|fay|nia|oz)' OR p.display_name ~ '(Kim|Lia|Mo|Fay|Nia|Oz)')),
    'S3: no account name reaches the brand''s People before a claim');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_person_source_links l
                                  WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gf)
    AND NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods c
                     WHERE c.brand_id = v_brand AND c.normalized_value = '+15550410500'),
    'S3: a friend pick is not imported (its number was never typed) before the claim');
  PERFORM pg_temp.ok(
    (SELECT s->>'userId' IS NULL AND s->>'phone' = '+15550410200'
       FROM public.biz_brand_person_conflict_subject('rsvp_plus_one', v_gk) s)
    AND (SELECT s->>'userId' IS NULL AND s->>'phone' IS NULL
           FROM public.biz_brand_person_conflict_subject('rsvp_plus_one', v_gf) s),
    'S3: the conflict subject of an unclaimed guest carries no account and no resolved number');

  -- ---- the claim (same account the number matched) ------------------------
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_kim,
      public.mint_claim_link('rsvp_guest', v_gk)->>'code', NULL)->>'outcome' = 'claimed',
    'fixture: Kim claims');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_person_ingest_outbox o
      WHERE o.source_kind = 'rsvp_plus_one' AND o.source_id = v_gk AND o.operation = 'upsert'
        AND o.status = 'pending'
        AND o.revision_key = (SELECT md5('issue_4508_claim:' || g.id::text || ':' || g.claimed_at::text)
                                FROM public.event_rsvp_guests g WHERE g.id = v_gk)),
    'S3: a claim queues a re-ingest of the plus-one');
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_gk);
  PERFORM pg_temp.ok(
    (SELECT p.linked_user_id = v_kim FROM public.brand_people p
      WHERE p.id = public.biz_brand_person_canonical((SELECT l.brand_person_id FROM public.brand_person_source_links l
        WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gk AND l.detached_at IS NULL))),
    'S3: after the claim the person is linked to the claimer');
  PERFORM pg_temp.ok((SELECT s->>'userId' = v_kim::text
                        FROM public.biz_brand_person_conflict_subject('rsvp_plus_one', v_gk) s),
    'S3: after the claim the conflict subject names the claimer');

  -- ---- a claim by a different account than the one matched ----------------
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_mo, '+15550410400');
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_gm);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_people p
                                  WHERE p.brand_id = v_brand AND p.linked_user_id = v_lia),
    'fixture: still no link to the account the sweep matched');
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_mo,
      public.mint_claim_link('rsvp_guest', v_gm)->>'code', NULL)->>'outcome' = 'claimed',
    'fixture: Mo claims the row matched to Lia');
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_gm);
  PERFORM pg_temp.ok(
    (SELECT p.linked_user_id = v_mo FROM public.brand_people p
      WHERE p.id = public.biz_brand_person_canonical((SELECT l.brand_person_id FROM public.brand_person_source_links l
        WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gm AND l.detached_at IS NULL)))
    AND NOT EXISTS (SELECT 1 FROM public.brand_people p WHERE p.brand_id = v_brand AND p.linked_user_id = v_lia),
    'S3: a claim by another account links the claimer only');

  -- ---- a friend pick claims ------------------------------------------------
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_fay,
      public.mint_claim_link('rsvp_guest', v_gf)->>'code', NULL)->>'outcome' = 'claimed',
    'fixture: Fay claims');
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_gf);
  PERFORM pg_temp.ok(
    (SELECT p.linked_user_id = v_fay FROM public.brand_people p
      WHERE p.id = public.biz_brand_person_canonical((SELECT l.brand_person_id FROM public.brand_person_source_links l
        WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gf AND l.detached_at IS NULL))),
    'S3: a friend pick is imported and linked once claimed');

  -- ---- a proven-number claim sweep ------------------------------------------
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_oz, '+15550410800');
  UPDATE public.event_rsvp_guests SET matched_user_id = v_oz WHERE id = v_go AND matched_user_id IS NULL;
  PERFORM pg_temp.ok((SELECT claimed_at IS NOT NULL FROM public.event_rsvp_guests WHERE id = v_go)
    AND EXISTS (SELECT 1 FROM public.brand_person_ingest_outbox o
                 WHERE o.source_kind = 'rsvp_plus_one' AND o.source_id = v_go AND o.status = 'pending'
                   AND o.revision_key = (SELECT md5('issue_4508_claim:' || g.id::text || ':' || g.claimed_at::text)
                                           FROM public.event_rsvp_guests g WHERE g.id = v_go)),
    'S3: a claim sweep queues a re-ingest');
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_go);
  PERFORM pg_temp.ok(
    (SELECT p.linked_user_id = v_oz FROM public.brand_people p
      WHERE p.id = public.biz_brand_person_canonical((SELECT l.brand_person_id FROM public.brand_person_source_links l
        WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_go AND l.detached_at IS NULL))),
    'S3: after a claim sweep the person is linked to the account that proved the number');

  -- ---- release ("This isn't me") --------------------------------------------
  PERFORM pg_temp.ok(public.rsvp_guest_release(public.mint_claim_link('rsvp_guest', v_gn)->>'code')->>'outcome' = 'released',
    'fixture: N is released');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_person_ingest_outbox o
                              WHERE o.source_kind = 'rsvp_plus_one' AND o.source_id = v_gn
                                AND o.operation = 'retire' AND o.status = 'pending'),
    'S3: a release queues the retire, as today');
  v_res := public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_gn);
  PERFORM pg_temp.ok(v_res->>'linkOutcome' = 'retired'
    AND NOT EXISTS (SELECT 1 FROM public.brand_person_source_links l
                     WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = v_gn AND l.detached_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.brand_people p WHERE p.brand_id = v_brand AND p.linked_user_id = v_nia),
    'S3: a released guest''s link is retired and their account was never attached: ' || v_res::text);

  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.tg_issue_4508_guest_claim_reingest()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.tg_issue_4508_guest_claim_reingest()', 'EXECUTE')
    AND (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
           FROM pg_proc p WHERE p.oid = 'public.tg_issue_4508_guest_claim_reingest()'::regprocedure),
    'S3: the re-ingest trigger function is definer-only with a fixed search_path');

  RAISE NOTICE '#4508 brand People before the claim: all cases passed';
END
$s3_people$;

-- ===========================================================================
-- Fix round 4 (#4508): T3 one person one place, T5 the host-only setting is
-- not an "event updated" notice, P3-T10 plus-ones off clears "guests can
-- bring guests" on the server, P3-T11 a removed claimed guest is told.
-- FAILS-ON-REVERT: skip the own-RSVP drop in submit_event_rsvp -> "T3: Gia
-- holds one place" fails; restore "AND v_guest.matched_user_id IS DISTINCT
-- FROM p_user_id" in rsvp_guest_claim -> "T3: a claim by an account already
-- on the list" fails; pass rsvpGuestsCanBring through to biz_update_live_rsvp
-- -> "T5: no event-updated notice" fails; drop the events trigger -> "P3-T10"
-- fails; drop the removed-claimed notices -> "P3-T11" fails.
-- ===========================================================================
DO $round4$
DECLARE
  v_own  uuid := '45087000-0000-4000-8000-000000000001';
  v_brand uuid := '45087000-0000-4000-8000-000000000002';
  v_ev   uuid := '45087000-0000-4000-8000-000000000003';
  v_ev2  uuid := '45087000-0000-4000-8000-000000000004';
  v_ivy  uuid := '45087000-0000-4000-8000-000000000011'; -- inviter
  v_gia  uuid := '45087000-0000-4000-8000-000000000012'; -- proves +15550411200
  v_hugo uuid := '45087000-0000-4000-8000-000000000013'; -- proves +15550411300
  v_jo   uuid := '45087000-0000-4000-8000-000000000014'; -- proves +15550411400
  v_kat  uuid := '45087000-0000-4000-8000-000000000015'; -- proves +15550411500
  v_ev3  uuid := '45087000-0000-4000-8000-000000000005';
  v_aud  uuid;
  v_res jsonb;
  v_err text;
  v_rsvp uuid;
  v_gid uuid;
  v_code text;
  v_going0 bigint;
  v_notes0 bigint;
BEGIN
  INSERT INTO auth.users(id, email) SELECT u, 'i4508v-' || right(u::text, 2) || '@example.test'
    FROM unnest(ARRAY[v_own, v_ivy, v_gia, v_hugo, v_jo]) u;
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone)
  SELECT u, 'i4508v-' || right(u::text, 2) || '@example.test', n, split_part(n, ' ', 1), split_part(n, ' ', 2), NULL
    FROM (VALUES (v_ivy, 'Ivy Ink'), (v_gia, 'Gia Glen'), (v_hugo, 'Hugo Hale'), (v_jo, 'Jo Jay')) x(u, n)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = NULL;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_ivy, '+15550411100'), (v_gia, '+15550411200'), (v_hugo, '+15550411300'), (v_jo, '+15550411400');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_own, 'i4508v-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_own, 'Issue 4508 Round Four', 'issue-4508-round4', 'stripe', 'US', 'USD', 'USD',
    'host-4508v@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at, location_text, rsvp_guests_can_bring)
  VALUES
    (v_ev, v_brand, v_own, 'Round Four', 'round-four-4508v', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), 'Pier 9', false),
    (v_ev2, v_brand, v_own, 'Round Four Two', 'round-four-two-4508v', 'rsvp', 'scheduled', 'public',
     'UTC', 'USD', NULL, false, 'auto', true, 3, now(), 'Pier 10', true);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ev, now() + interval '8 days', now() + interval '8 days 4 hours', 'UTC', true),
    (v_ev2, now() + interval '8 days', now() + interval '8 days 4 hours', 'UTC', true);

  -- ---- T3, order 1: matched at submit (unclaimed), then own RSVP --------
  v_res := public.submit_event_rsvp(v_ev, v_ivy, 'Ivy Ink', 'i4508v-11@example.test',
    '+15550411100', 'going', 1, '[{"phone":"+15550411200"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok((SELECT matched_user_id = v_gia AND claimed_at IS NULL
                        FROM public.event_rsvp_guests WHERE id = v_gid),
    'T3 fixture: Gia''s number is matched at submit, unclaimed');
  v_going0 := (public.pg_public_social_proof(v_ev)->>'goingCount')::bigint;
  v_res := public.submit_event_rsvp(v_ev, v_gia, 'Gia Glen', 'i4508v-12@example.test',
    '+15550411200', 'going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(v_res->>'status' = 'going'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid)
    AND (SELECT plus_count FROM public.event_rsvps WHERE id = v_rsvp) = 0,
    'T3: her own RSVP wins and the guest row is released: ' || v_res::text);
  PERFORM pg_temp.ok((public.pg_public_social_proof(v_ev)->>'goingCount')::bigint = v_going0,
    'T3: Gia holds one place (the count moves 2 -> 2, not 2 -> 3)');
  PERFORM pg_temp.ok(jsonb_array_length(v_res->'guestNotices') = 1
    AND v_res->'guestNotices'->0->>'kind' = 'guest_has_own_rsvp'
    AND (v_res->'guestNotices'->0->>'userId')::uuid = v_ivy
    AND v_res->'guestNotices'->0->>'phoneLast4' = '1200'
    AND v_res->'guestNotices'->0->>'eventTitle' = 'Round Four',
    'T3: the inviter is told (notice for public-submit-rsvp): ' || (v_res->'guestNotices')::text);
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gia, v_code, NULL)->>'outcome' IN ('not_found', 'released')
    AND (public.pg_public_social_proof(v_ev)->>'goingCount')::bigint = v_going0,
    'T3: the dead link claims nothing afterwards');
  -- A row that still says Gia (an older match, or a sweep) is never claimed
  -- by her while her own RSVP stands.
  INSERT INTO public.event_rsvp_guests(rsvp_id, phone, matched_user_id, invited_by_user_id)
  VALUES (v_rsvp, '+15550411200', v_gia, v_ivy) RETURNING id INTO v_gid;
  v_res := public.rsvp_guest_claim(v_gia, public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'already_on_list'
    AND (SELECT claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'T3: a claim by an account already on the list is refused even for its own match: ' || v_res::text);
  DELETE FROM public.event_rsvp_guests WHERE id = v_gid;

  -- ---- T3, order 2: claim first, then a first own RSVP -------------------
  v_res := public.submit_event_rsvp(v_ev, v_ivy, 'Ivy Ink', 'i4508v-11@example.test',
    '+15550411100', 'going', 1, '[{"phone":"+15550411300"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550411300';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_hugo,
      public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL)->>'outcome' = 'claimed',
    'T3 fixture: Hugo claims');
  v_going0 := (public.pg_public_social_proof(v_ev)->>'goingCount')::bigint;
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Hugo Hale', 'i4508v-13@example.test',
    '+15550411300', 'going', 0, '[]'::jsonb, NULL, 'US')$s$, v_ev, v_hugo));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_has_pass'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_ev AND user_id = v_hugo)
    AND (public.pg_public_social_proof(v_ev)->>'goingCount')::bigint = v_going0,
    'T3: a claimed guest pass is their place; a first own RSVP is refused: ' || v_err);
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, %L, 'Hugo Hale', 'i4508v-13@example.test',
    '+15550411300', 'not_going', 0, '[]'::jsonb, NULL, 'US')$s$, v_ev, v_hugo));
  PERFORM pg_temp.ok(v_err = '', 'T3: "Can''t go" on their own is still allowed: ' || v_err);

  -- ---- P3-T11: removing a claimed guest tells them -----------------------
  v_res := public.submit_event_rsvp(v_ev, v_ivy, 'Ivy Ink', 'i4508v-11@example.test',
    '+15550411100', 'going', 1, '[{"phone":"+15550411400"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guestNotices') n
                 WHERE n->>'kind' = 'guest_pass_removed' AND (n->>'userId')::uuid = v_hugo
                   AND (n->>'guestId')::uuid = v_gid AND n->>'inviterName' = 'Ivy I.'
                   AND n->>'eventTitle' = 'Round Four'),
    'P3-T11: the removed claimed guest is told: ' || (v_res->'guestNotices')::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guestNotices') n
                                  WHERE (n->>'userId')::uuid = v_jo),
    'P3-T11: nobody else is told');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550411400';
  PERFORM public.rsvp_guest_claim(v_jo, public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL);
  v_res := public.submit_event_rsvp(v_ev, v_ivy, 'Ivy Ink', 'i4508v-11@example.test',
    '+15550411100', 'not_going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guestNotices') n
                              WHERE n->>'kind' = 'guest_pass_removed' AND (n->>'userId')::uuid = v_jo),
    'P3-T11: "Can''t go" removes a claimed guest the same way and tells them: ' || (v_res->'guestNotices')::text);

  -- ---- T5: saving only "Guests can bring guests" tells nobody -------------
  PERFORM public.submit_event_rsvp(v_ev2, v_gia, 'Gia Glen', 'i4508v-12@example.test',
    '+15550411200', 'going', 0, '[]'::jsonb, NULL, 'US');
  v_notes0 := (SELECT count(*) FROM public.rsvp_notifications
                WHERE event_id = v_ev2 AND template_key = 'rsvp_event_updated');
  PERFORM pg_temp.as_user(v_own);
  v_res := public.business_update_rsvp_graph(v_ev2, '{"rsvpGuestsCanBring": false}'::jsonb,
    'Guests should not bring more guests', NULL);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rsvp_notifications
                       WHERE event_id = v_ev2 AND template_key = 'rsvp_event_updated') = v_notes0,
    'T5: no event-updated notice for the host-only setting');
  PERFORM pg_temp.ok((SELECT NOT rsvp_guests_can_bring AND location_text = 'Pier 10'
                        FROM public.events WHERE id = v_ev2)
    AND (v_res->>'rsvpGuestsCanBring')::boolean IS FALSE
    AND (v_res->'updateResult'->>'ok')::boolean,
    'T5: the setting is saved, nothing else on the event changes: ' || v_res::text);

  -- ---- P3-T10: plus-ones off clears "guests can bring guests" ------------
  UPDATE public.events SET rsvp_guests_can_bring = true WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2),
    'P3-T10 fixture: guests can bring guests');
  UPDATE public.events SET rsvp_allow_plus_ones = false, rsvp_plus_ones_max = 0 WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT NOT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2),
    'P3-T10: any writer turning plus-ones off clears the setting on the server');
  UPDATE public.events SET rsvp_guests_can_bring = true WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT NOT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2),
    'P3-T10: it cannot be switched on while plus-ones are off');
  -- A draft keeps the host's choice until it publishes.
  UPDATE public.events SET status = 'draft', rsvp_guests_can_bring = true WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2),
    'P3-T10: a draft keeps the wizard''s choice');
  UPDATE public.events SET status = 'scheduled' WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT NOT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2),
    'P3-T10: publishing with plus-ones off clears it');

  -- ---- J: an unclaimed plus-one is in no brand ad audience ---------------
  -- (FAILS-ON-REVERT: drop "AND g.claimed_at IS NOT NULL" from the guest arm
  -- of ad_list_audience_refresh -> "J: an unclaimed plus-one is not" fails.)
  INSERT INTO auth.users(id, email) VALUES (v_kat, 'i4508v-kat@example.test');
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name)
  VALUES (v_kat, 'i4508v-kat@example.test', 'Kat Kerr', 'Kat', 'Kerr')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_kat, '+15550411500');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  VALUES (v_ev3, v_brand, v_own, 'Round Four Ads', 'round-four-ads-4508v', 'rsvp', 'scheduled', 'public',
    'UTC', 'USD', NULL, false, 'auto', true, 3, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_ev3, now() + interval '8 days', now() + interval '8 days 4 hours', 'UTC', true);
  v_res := public.submit_event_rsvp(v_ev3, v_ivy, 'Ivy Ink', 'i4508v-11@example.test',
    '+15550411100', 'going', 1, '[{"phone":"+15550411500"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  INSERT INTO public.ad_list_audiences(audience_key, owner_kind, brand_id, kind, source, display_name)
  VALUES ('brand:' || v_brand::text || ':guests', 'host', v_brand, 'list', 'guests', 'Round Four guests')
  RETURNING id INTO v_aud;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.ad_list_audience_refresh(v_aud);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ad_list_audience_members m
      WHERE m.audience_id = v_aud AND m.removed_at IS NULL
        AND m.phone_sha256 = public.ad_list_audience_sha256(public.ad_list_audience_normalize_phone('+15550411500')))
    AND EXISTS (SELECT 1 FROM public.ad_list_audience_members m
      WHERE m.audience_id = v_aud AND m.removed_at IS NULL
        AND m.phone_sha256 = public.ad_list_audience_sha256(public.ad_list_audience_normalize_phone('+15550411100'))),
    'J: an unclaimed plus-one is not in the brand''s ad audience (the inviter is)');
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_kat,
      public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL)->>'outcome' = 'claimed', 'J fixture: Kat claims');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.ad_list_audience_refresh(v_aud);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.ad_list_audience_members m
      WHERE m.audience_id = v_aud AND m.removed_at IS NULL
        AND m.phone_sha256 = public.ad_list_audience_sha256(public.ad_list_audience_normalize_phone('+15550411500'))),
    'J: once claimed, the plus-one enters the audience like any guest');

  -- ---- K: an unclaimed matched plus-one cannot read their pass yet -------
  -- (FAILS-ON-REVERT: drop the claimed_at condition from the matched-guest
  -- arm of fetch_user_rsvp_party_passes or fetch_user_going_rsvps -> fails.)
  v_res := public.submit_event_rsvp(v_ev3, v_ivy, 'Ivy Ink', 'i4508v-11@example.test',
    '+15550411100', 'going', 2, '[{"phone":"+15550411500"},{"phone":"+15550411400"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550411400';
  UPDATE public.event_rsvp_guests SET qr_code = 'mingla-rsvp:4508v-k' WHERE id = v_gid;
  PERFORM pg_temp.ok((SELECT matched_user_id = v_jo AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'K fixture: Jo is matched, unclaimed');
  PERFORM pg_temp.as_user(v_jo);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.fetch_user_rsvp_party_passes(v_rsvp))
    AND NOT EXISTS (SELECT 1 FROM public.fetch_user_going_rsvps(v_jo) f WHERE f.qr_code = 'mingla-rsvp:4508v-k'),
    'K: an unclaimed matched guest reads no pass (party passes, going list)');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.rsvp_guest_claim(v_jo, public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL);
  PERFORM pg_temp.as_user(v_jo);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.fetch_user_rsvp_party_passes(v_rsvp) WHERE entity_id = v_gid)
    AND EXISTS (SELECT 1 FROM public.fetch_user_going_rsvps(v_jo) f WHERE f.qr_code = 'mingla-rsvp:4508v-k'),
    'K: once claimed, the pass is theirs');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  RAISE NOTICE '#4508 fix round 4: all cases passed';
END
$round4$;

ROLLBACK;

-- ===========================================================================
-- N-6 (#4508): the first apply marks guest rows matched before #4508 as
-- claimed (created_at), so existing Guest chat members keep their place; a
-- re-apply never does, and re-syncs away a member who is there only through
-- an unclaimed match. Needs committed rows and a re-run of the migration, so
-- it runs after the transactional blocks (the suite owns its database).
-- FAILS-ON-REVERT: drop the N-6 backfill -> "N-6: a legacy matched guest reads as claimed" fails; drop the re-sync -> "N-6: an unclaimed-only member is removed" fails.
-- ===========================================================================
CREATE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4508 FAIL: %', p_message; END IF;
END
$fn$;
INSERT INTO auth.users(id, email) VALUES
  ('45085000-0000-4000-8000-000000000001', 'i4508u-own@example.test'),
  ('45085000-0000-4000-8000-000000000011', 'i4508u-pri@example.test'),
  ('45085000-0000-4000-8000-000000000012', 'i4508u-leg@example.test'),
  ('45085000-0000-4000-8000-000000000013', 'i4508u-new@example.test');
INSERT INTO public.creator_accounts(id, email)
VALUES ('45085000-0000-4000-8000-000000000001', 'i4508u-own@example.test');
INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
  pricing_currency, default_currency, contact_email)
VALUES ('45085000-0000-4000-8000-000000000002', '45085000-0000-4000-8000-000000000001',
  'Issue 4508 Legacy', 'issue-4508-legacy', 'stripe', 'US', 'USD', 'USD', 'host-4508u@example.test');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
  rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
VALUES ('45085000-0000-4000-8000-000000000003', '45085000-0000-4000-8000-000000000002',
  '45085000-0000-4000-8000-000000000001', 'Legacy Night', 'legacy-4508u', 'rsvp', 'scheduled',
  'public', 'UTC', 'USD', NULL, false, 'auto', true, 2, now());
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45085000-0000-4000-8000-000000000003', now() + interval '6 days',
  now() + interval '6 days 4 hours', 'UTC', true);
INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, rsvp_status, approval_status)
VALUES ('45085000-0000-4000-8000-000000000004', '45085000-0000-4000-8000-000000000003',
  '45085000-0000-4000-8000-000000000011', 'Pri', 'going', 'approved');
-- A plus-one matched before #4508, already a Guest chat member.
INSERT INTO public.event_rsvp_guests(id, rsvp_id, name, email, phone, matched_user_id, created_at)
VALUES ('45085000-0000-4000-8000-000000000005', '45085000-0000-4000-8000-000000000004',
  'Leg', 'leg-4508u@example.test', '+15550409200', '45085000-0000-4000-8000-000000000012',
  now() - interval '30 days');
INSERT INTO public.conversation_participants(conversation_id, user_id)
VALUES (public.issue_4459_ensure_brand_guest_chat('45085000-0000-4000-8000-000000000002'),
  '45085000-0000-4000-8000-000000000012')
ON CONFLICT (conversation_id, user_id) DO NOTHING;
-- The state before #4508: no claimed_at column at all.
ALTER TABLE public.event_rsvp_guests DROP COLUMN claimed_at CASCADE;
\ir ../20281119014508_issue_4508_bring_a_friend.sql
DO $n6$
BEGIN
  PERFORM pg_temp.ok((SELECT claimed_at = created_at FROM public.event_rsvp_guests
                       WHERE id = '45085000-0000-4000-8000-000000000005'),
    'N-6: a legacy matched guest reads as claimed, at its created_at');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = public.issue_4459_ensure_brand_guest_chat('45085000-0000-4000-8000-000000000002')
        AND user_id = '45085000-0000-4000-8000-000000000012'),
    'N-6: a legacy matched guest keeps their Guest chat place');
  -- S3: a guest claimed by the backfill keeps their account in the brand's People.
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', '45085000-0000-4000-8000-000000000005');
  PERFORM pg_temp.ok((SELECT p.linked_user_id = '45085000-0000-4000-8000-000000000012'
                        FROM public.brand_person_source_links l JOIN public.brand_people p ON p.id = l.brand_person_id
                       WHERE l.source_kind = 'rsvp_plus_one' AND l.source_id = '45085000-0000-4000-8000-000000000005'
                         AND l.detached_at IS NULL),
    'S3: a legacy matched guest (claimed by the backfill) stays linked in the brand''s People');
END
$n6$;
-- A later apply: a member there only through an unclaimed match is removed,
-- and nothing is backfilled.
INSERT INTO public.event_rsvp_guests(id, rsvp_id, phone, matched_user_id)
VALUES ('45085000-0000-4000-8000-000000000006', '45085000-0000-4000-8000-000000000004',
  '+15550409300', '45085000-0000-4000-8000-000000000013');
INSERT INTO public.conversation_participants(conversation_id, user_id)
VALUES (public.issue_4459_ensure_brand_guest_chat('45085000-0000-4000-8000-000000000002'),
  '45085000-0000-4000-8000-000000000013')
ON CONFLICT (conversation_id, user_id) DO NOTHING;
\ir ../20281119014508_issue_4508_bring_a_friend.sql
DO $n6b$
BEGIN
  PERFORM pg_temp.ok((SELECT claimed_at IS NULL FROM public.event_rsvp_guests
                       WHERE id = '45085000-0000-4000-8000-000000000006'),
    'N-6: a re-apply never marks a #4508 guest as claimed');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = public.issue_4459_ensure_brand_guest_chat('45085000-0000-4000-8000-000000000002')
        AND user_id = '45085000-0000-4000-8000-000000000013'),
    'N-6: an unclaimed-only member is removed by the re-sync');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = public.issue_4459_ensure_brand_guest_chat('45085000-0000-4000-8000-000000000002')
        AND user_id = '45085000-0000-4000-8000-000000000012'),
    'N-6: the legacy member stays');
  RAISE NOTICE '#4508 legacy matches: all cases passed';
END
$n6b$;

-- ===========================================================================
-- Fix round 4 races (#4508), two real sessions (dblink), committed rows in
-- their own namespace (the suite owns its database).
--   T3: a claim and the same account's own RSVP on one event, in either
--       order, end with exactly one place: the second waits for the first.
--   P3-T6: two submits by one inviter on events of different brands, at
--       19 of 20, cannot both pass the daily cap.
-- FAILS-ON-REVERT: drop the event lock from rsvp_guest_claim -> "T3 race: the
-- own RSVP waits for the claim" fails; drop the inviter lock (45082) from
-- submit_event_rsvp -> "P3-T6 race: the second submit waits" fails.
-- ===========================================================================
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO auth.users(id, email) VALUES
  ('45088000-0000-4000-8000-000000000001', 'i4508w-own@example.test'),
  ('45088000-0000-4000-8000-000000000002', 'i4508w-own2@example.test'),
  ('45088000-0000-4000-8000-000000000011', 'i4508w-ivy@example.test'),
  ('45088000-0000-4000-8000-000000000012', 'i4508w-gia@example.test'),
  ('45088000-0000-4000-8000-000000000013', 'i4508w-hal@example.test');
INSERT INTO public.profiles(id, email, display_name, first_name, last_name) VALUES
  ('45088000-0000-4000-8000-000000000011', 'i4508w-ivy@example.test', 'Ivy Race', 'Ivy', 'Race'),
  ('45088000-0000-4000-8000-000000000012', 'i4508w-gia@example.test', 'Gia Race', 'Gia', 'Race'),
  ('45088000-0000-4000-8000-000000000013', 'i4508w-hal@example.test', 'Hal Race', 'Hal', 'Race')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  ('45088000-0000-4000-8000-000000000012', '+15550412200'),
  ('45088000-0000-4000-8000-000000000013', '+15550412300');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('45088000-0000-4000-8000-000000000001', 'i4508w-own@example.test'),
  ('45088000-0000-4000-8000-000000000002', 'i4508w-own2@example.test');
INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
  pricing_currency, default_currency, contact_email) VALUES
  ('45088000-0000-4000-8000-000000000021', '45088000-0000-4000-8000-000000000001', 'Race One', 'race-one-4508w',
   'stripe', 'US', 'USD', 'USD', 'race1-4508w@example.test'),
  ('45088000-0000-4000-8000-000000000022', '45088000-0000-4000-8000-000000000002', 'Race Two', 'race-two-4508w',
   'stripe', 'US', 'USD', 'USD', 'race2-4508w@example.test');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
  rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at) VALUES
  ('45088000-0000-4000-8000-000000000031', '45088000-0000-4000-8000-000000000021', '45088000-0000-4000-8000-000000000001',
   'Race A', 'race-a-4508w', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', NULL, false, 'auto', true, 3, now()),
  ('45088000-0000-4000-8000-000000000032', '45088000-0000-4000-8000-000000000021', '45088000-0000-4000-8000-000000000001',
   'Race B', 'race-b-4508w', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', NULL, false, 'auto', true, 3, now()),
  ('45088000-0000-4000-8000-000000000033', '45088000-0000-4000-8000-000000000022', '45088000-0000-4000-8000-000000000002',
   'Race C', 'race-c-4508w', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', NULL, false, 'auto', true, 3, now());
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
SELECT e, now() + interval '9 days', now() + interval '9 days 4 hours', 'UTC', true
  FROM unnest(ARRAY['45088000-0000-4000-8000-000000000031', '45088000-0000-4000-8000-000000000032',
                    '45088000-0000-4000-8000-000000000033']::uuid[]) e;
-- Ivy brings Gia's number to Race A and Hal's number to Race B (both unclaimed).
SELECT public.submit_event_rsvp('45088000-0000-4000-8000-000000000031', '45088000-0000-4000-8000-000000000011',
  'Ivy Race', 'i4508w-ivy@example.test', '+15550412100', 'going', 1, '[{"phone":"+15550412200"}]'::jsonb, NULL, 'US');
SELECT public.submit_event_rsvp('45088000-0000-4000-8000-000000000032', '45088000-0000-4000-8000-000000000011',
  'Ivy Race', 'i4508w-ivy@example.test', '+15550412100', 'going', 1, '[{"phone":"+15550412300"}]'::jsonb, NULL, 'US');

-- P3-T6 fixture, committed: Ivy has 2 numbers logged from the parties above;
-- 17 more put her at 19 of 20.
INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
SELECT 'user:45088000-0000-4000-8000-000000000011', '45088000-0000-4000-8000-000000000032',
       '1555041' || lpad(i::text, 4, '0') FROM generate_series(1, 17) i;

-- The links are minted here, committed, so the other sessions can read them.
SELECT public.mint_claim_link('rsvp_guest', g.id) FROM public.event_rsvp_guests g
  JOIN public.event_rsvps r ON r.id = g.rsvp_id
 WHERE r.event_id IN ('45088000-0000-4000-8000-000000000031', '45088000-0000-4000-8000-000000000032');

DO $race$
DECLARE
  -- Loopback TCP: the image trusts 127.0.0.1, while its local socket asks
  -- supabase_admin for a password the suite does not hold.
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=%L', current_database(), current_user,
    current_setting('port'));
  v_ev_a uuid := '45088000-0000-4000-8000-000000000031';
  v_ev_b uuid := '45088000-0000-4000-8000-000000000032';
  v_ev_c uuid := '45088000-0000-4000-8000-000000000033';
  v_ivy uuid := '45088000-0000-4000-8000-000000000011';
  v_gia uuid := '45088000-0000-4000-8000-000000000012';
  v_hal uuid := '45088000-0000-4000-8000-000000000013';
  v_code_a text;
  v_code_b text;
  v_out text;
  v_i integer;
BEGIN
  -- Read the committed links (never re-mint here: that would lock the link
  -- row in this session, which the other sessions then wait on).
  SELECT l.code INTO v_code_a FROM public.claim_links l
    JOIN public.event_rsvp_guests g ON g.id = l.subject_id JOIN public.event_rsvps r ON r.id = g.rsvp_id
   WHERE l.subject_kind = 'rsvp_guest' AND l.revoked_at IS NULL AND r.event_id = v_ev_a;
  SELECT l.code INTO v_code_b FROM public.claim_links l
    JOIN public.event_rsvp_guests g ON g.id = l.subject_id JOIN public.event_rsvps r ON r.id = g.rsvp_id
   WHERE l.subject_kind = 'rsvp_guest' AND l.revoked_at IS NULL AND r.event_id = v_ev_b;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM dblink(v_conn, format(
      'SELECT public.rsvp_guest_for_code(%L)::text', v_code_a)) AS t(r text) WHERE r IS NOT NULL),
    'race fixture: another session resolves the committed link');
  PERFORM dblink_connect('i4508_a', v_conn);
  PERFORM dblink_connect('i4508_b', v_conn);

  -- T3, claim first: session A claims and holds; B's own RSVP must wait.
  PERFORM dblink_exec('i4508_a', 'BEGIN');
  PERFORM * FROM dblink('i4508_a', format('SELECT public.rsvp_guest_claim(%L, %L, NULL)::text', v_gia, v_code_a)) AS t(r text);
  PERFORM dblink_send_query('i4508_b', format($q$SELECT coalesce((SELECT 'ok' FROM public.submit_event_rsvp(%L, %L,
    'Gia Race', 'i4508w-gia@example.test', '+15550412200', 'going', 0, '[]'::jsonb, NULL, 'US') LIMIT 1), 'ok')$q$,
    v_ev_a, v_gia));
  PERFORM pg_sleep(0.5);
  PERFORM pg_temp.ok(dblink_is_busy('i4508_b') = 1, 'T3 race: the own RSVP waits for the claim');
  PERFORM dblink_exec('i4508_a', 'COMMIT');
  BEGIN
    SELECT r INTO v_out FROM dblink_get_result('i4508_b') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_out := SQLERRM;
  END;
  PERFORM dblink_get_result('i4508_b');
  PERFORM pg_temp.ok(v_out LIKE '%rsvp_guest_has_pass%',
    'T3 race (claim first): the own RSVP after the claim is refused: ' || coalesce(v_out, 'NULL'));
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvps WHERE event_id = v_ev_a AND user_id = v_gia) = 0
    AND (SELECT count(*) FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
          WHERE r.event_id = v_ev_a AND g.matched_user_id = v_gia AND g.claimed_at IS NOT NULL) = 1,
    'T3 race (claim first): Gia holds exactly one place');

  -- T3, own RSVP first: A's own RSVP holds; B's claim must wait, then finds nothing.
  PERFORM dblink_exec('i4508_a', 'BEGIN');
  PERFORM * FROM dblink('i4508_a', format($q$SELECT public.submit_event_rsvp(%L, %L, 'Hal Race',
    'i4508w-hal@example.test', '+15550412300', 'going', 0, '[]'::jsonb, NULL, 'US')::text$q$, v_ev_b, v_hal)) AS t(r text);
  PERFORM dblink_send_query('i4508_b', format('SELECT public.rsvp_guest_claim(%L, %L, NULL)->>''outcome''', v_hal, v_code_b));
  PERFORM pg_sleep(0.5);
  PERFORM pg_temp.ok(dblink_is_busy('i4508_b') = 1, 'T3 race: the claim waits for the own RSVP');
  PERFORM dblink_exec('i4508_a', 'COMMIT');
  SELECT r INTO v_out FROM dblink_get_result('i4508_b') AS t(r text);
  PERFORM dblink_get_result('i4508_b');
  PERFORM pg_temp.ok(v_out IN ('not_found', 'released', 'already_on_list'),
    'T3 race (own RSVP first): the claim after it claims nothing: ' || coalesce(v_out, 'NULL'));
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvps WHERE event_id = v_ev_b AND user_id = v_hal) = 1
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
          WHERE r.event_id = v_ev_b AND g.matched_user_id = v_hal),
    'T3 race (own RSVP first): Hal holds exactly one place');

  -- P3-T6: Ivy at 19 of 20 (two counted above, 17 more), then two submits on
  -- events of different brands at once: the second waits and is refused.
  -- (the 17 log rows are committed above the block)
  PERFORM dblink_exec('i4508_a', 'BEGIN');
  PERFORM * FROM dblink('i4508_a', format($q$SELECT public.submit_event_rsvp(%L, %L, 'Ivy Race',
    'i4508w-ivy@example.test', '+15550412100', 'going', 2, '[{"phone":"+15550412200"},{"phone":"+15550412901"}]'::jsonb, NULL, 'US')::text$q$,
    v_ev_a, v_ivy)) AS t(r text);
  PERFORM dblink_send_query('i4508_b', format($q$SELECT 'ok' FROM public.submit_event_rsvp(%L, %L, 'Ivy Race',
    'i4508w-ivy@example.test', '+15550412100', 'going', 1, '[{"phone":"+15550412902"}]'::jsonb, NULL, 'US')$q$,
    v_ev_c, v_ivy));
  PERFORM pg_sleep(0.5);
  PERFORM pg_temp.ok(dblink_is_busy('i4508_b') = 1, 'P3-T6 race: the second submit waits for the first');
  PERFORM dblink_exec('i4508_a', 'COMMIT');
  BEGIN
    SELECT r INTO v_out FROM dblink_get_result('i4508_b') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_out := SQLERRM;
  END;
  PERFORM dblink_get_result('i4508_b');
  PERFORM pg_temp.ok(v_out LIKE '%rsvp_guest_daily_cap%',
    'P3-T6 race: the 21st number from the second submit is refused: ' || coalesce(v_out, 'NULL'));
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rsvp_guest_invite_log WHERE inviter_key = 'user:' || v_ivy) = 20,
    'P3-T6 race: exactly 20 numbers were logged');
  PERFORM dblink_disconnect('i4508_a');
  PERFORM dblink_disconnect('i4508_b');
  RAISE NOTICE '#4508 fix round 4 races: all cases passed';
END
$race$;

-- ===========================================================================
-- Fix round 5 (#4508), one transaction, rolled back.
--   R5-1 nothing about an unclaimed plus-one enters a brand ad audience
--        through the People arm either; a before/after membership diff on one
--        seeded brand shows only the unclaimed plus-ones' rows change.
--   R5-2 one place per person on the claim sweep and the anonymous-RSVP
--        attach, in both orders; the inviter's notice is queued once.
--   R6   (fix round 6) no claim at submit: an old app's name, email and
--        number guest is accepted and messaged as before but stays unclaimed
--        until the guest claims through their link.
-- FAILS-ON-REVERT: drop the two People-arm lines from the J patch -> "R5-1:
-- the diff is exactly" fails; drop the sweep guest-arm patch -> "R5-2 order
-- 1" fails; drop the attach trigger -> "R5-2 order 2" fails; drop the RSVP-arm
-- or claim-link patch -> "R5-2 claimed pass" fails; claim any guest at submit
-- (for example an old-contract guest whose account proves the typed email)
-- -> "R6 old contract" fails.
-- ===========================================================================
BEGIN;
-- The stock CI image has no auth.identities (GoTrue makes it); this block
-- adds it inside its own transaction, as the phase-0 suite does, so the
-- verified-email arm of account_owns_contact is exercised.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz;
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'email',
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sign_in_at timestamptz
);
CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4508 FAIL: %', p_message; END IF;
END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.err_state(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', p_user::text, true);
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.signed_out() RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claims', '', true);
  SELECT set_config('request.jwt.claim.sub', '', true);
$fn$;
-- Snapshots of one audience's live members as (key, email hash, phone hash).
CREATE TEMP TABLE r5_members (phase text, member_key text, email_sha256 text, phone_sha256 text) ON COMMIT DROP;
CREATE OR REPLACE FUNCTION pg_temp.snap(p_audience uuid, p_phase text) RETURNS void LANGUAGE sql AS $fn$
  DELETE FROM pg_temp.r5_members WHERE phase = p_phase;
  INSERT INTO pg_temp.r5_members
  SELECT p_phase, m.member_key::text, m.email_sha256::text, m.phone_sha256::text
    FROM public.ad_list_audience_members m
   WHERE m.audience_id = p_audience AND m.removed_at IS NULL;
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.members(p_phase text)
RETURNS TABLE (member_key text, email_sha256 text, phone_sha256 text) LANGUAGE sql AS $fn$
  SELECT r.member_key, r.email_sha256, r.phone_sha256 FROM pg_temp.r5_members r WHERE r.phase = p_phase;
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.phash(p_phone text) RETURNS text LANGUAGE sql AS $fn$
  SELECT public.ad_list_audience_sha256(public.ad_list_audience_normalize_phone(p_phone))::text;
$fn$;

DO $round5$
DECLARE
  v_own   uuid := '45089000-0000-4000-8000-000000000001';
  v_brand uuid := '45089000-0000-4000-8000-000000000002';
  v_ev    uuid := '45089000-0000-4000-8000-000000000003'; -- R5-1 ads
  v_ev2   uuid := '45089000-0000-4000-8000-000000000004'; -- R5-2
  v_ev3   uuid := '45089000-0000-4000-8000-000000000005'; -- R6
  v_ivy   uuid := '45089000-0000-4000-8000-000000000011'; -- inviter
  v_mo    uuid := '45089000-0000-4000-8000-000000000012'; -- RSVPs, no number of her own
  v_cal   uuid := '45089000-0000-4000-8000-000000000013'; -- claims
  v_pia   uuid := '45089000-0000-4000-8000-000000000014'; -- R5-2 order 1
  v_rae   uuid := '45089000-0000-4000-8000-000000000015'; -- R5-2 order 2 (unclaimed)
  v_quin  uuid := '45089000-0000-4000-8000-000000000016'; -- R5-2 claimed pass
  v_lee   uuid := '45089000-0000-4000-8000-000000000017'; -- R6 proves number and email
  v_max   uuid := '45089000-0000-4000-8000-000000000018'; -- R6 email unverified
  v_fri   uuid := '45089000-0000-4000-8000-000000000019'; -- R6 Ivy's friend
  v_aud_new uuid;
  v_def_new text;
  v_def_old text;
  v_res jsonb;
  v_rsvp uuid;
  v_gid uuid;
  v_gid2 uuid;
  v_anon uuid;
  v_err text;
  v_n integer;
  v_extra integer;
  v_missing integer;
BEGIN
  INSERT INTO auth.users(id, email) SELECT u, 'i4508r5-' || right(u::text, 2) || '@example.test'
    FROM unnest(ARRAY[v_own, v_ivy, v_mo, v_cal, v_pia, v_rae, v_quin, v_lee, v_max, v_fri]) u;
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone)
  SELECT u, 'i4508r5-' || right(u::text, 2) || '@example.test', n, split_part(n, ' ', 1), split_part(n, ' ', 2), NULL
    FROM (VALUES (v_ivy, 'Ivy Ives'), (v_mo, 'Mo Mars'), (v_cal, 'Cal Cole'), (v_pia, 'Pia Pratt'),
                 (v_rae, 'Rae Ross'), (v_quin, 'Quin Quay'), (v_lee, 'Lee Lund'), (v_max, 'Max Mead'),
                 (v_fri, 'Fri Fox')) x(u, n)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = NULL;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_ivy, '+15550509100'), (v_cal, '+15550509300'), (v_rae, '+15550509500'),
    (v_lee, '+15550509700'), (v_max, '+15550509800'), (v_fri, '+15550509900');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_own, 'i4508r5-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_own, 'Issue 4508 Round Five', 'issue-4508-round5', 'stripe', 'US', 'USD', 'USD',
    'host-4508r5@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  SELECT e, v_brand, v_own, t, s, 'rsvp', 'scheduled', 'public', 'UTC', 'USD', NULL, false, 'auto', true, 3, now()
    FROM (VALUES (v_ev, 'Round Five Ads', 'round-five-ads-4508r5'),
                 (v_ev2, 'Round Five Places', 'round-five-places-4508r5'),
                 (v_ev3, 'Round Five Old Apps', 'round-five-old-4508r5')) x(e, t, s);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  SELECT e, now() + interval '9 days', now() + interval '9 days 4 hours', 'UTC', true
    FROM unnest(ARRAY[v_ev, v_ev2, v_ev3]) e;

  -- ======================= R5-1 the People arm ===========================
  -- Ivy goes and brings: an unclaimed number-only guest; Cal (claims); and an
  -- old-contract guest typed with Mo's email beside a number nobody proved
  -- (unclaimed; the People import adds that number to Mo's person). Mo goes
  -- on her own with no number of her own.
  PERFORM public.submit_event_rsvp(v_ev, v_mo, 'Mo Mars', 'i4508r5-mo@example.test',
    NULL, 'going', 0, '[]'::jsonb, NULL, NULL);
  v_res := public.submit_event_rsvp(v_ev, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 3, jsonb_build_array(
      jsonb_build_object('phone', '+15550509201'),
      jsonb_build_object('phone', '+15550509300'),
      jsonb_build_object('name', 'Mo Mars', 'email', 'i4508r5-mo@example.test', 'phone', '+15550509202')),
    NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND claimed_at IS NULL) = 3,
    'R5-1 fixture: three unclaimed guests');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509300';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_cal, public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL)->>'outcome' = 'claimed',
    'R5-1 fixture: Cal claims');
  -- The People worker's own entry point, for every source on the event.
  PERFORM public.biz_resolve_brand_person_source_derived('event_rsvp', r.id)
     FROM public.event_rsvps r WHERE r.event_id = v_ev ORDER BY r.created_at, r.id;
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', g.id)
     FROM public.event_rsvp_guests g WHERE g.rsvp_id = v_rsvp ORDER BY g.created_at, g.id;
  PERFORM pg_temp.ok(EXISTS (
      SELECT 1 FROM public.brand_person_contact_methods m JOIN public.brand_people p ON p.id = m.brand_person_id
       WHERE p.brand_id = v_brand AND m.channel = 'phone'
         AND public.ad_list_audience_normalize_phone(m.normalized_value) = public.ad_list_audience_normalize_phone('+15550509201')),
    'R5-1 fixture: the unclaimed number-only guest is a brand People contact');
  PERFORM pg_temp.ok(EXISTS (
      SELECT 1 FROM public.brand_person_contact_methods m JOIN public.brand_people p ON p.id = m.brand_person_id
       WHERE p.brand_id = v_brand AND p.linked_user_id = v_mo AND m.channel = 'phone'
         AND public.ad_list_audience_normalize_phone(m.normalized_value) = public.ad_list_audience_normalize_phone('+15550509202')),
    'R5-1 fixture: the typed number is on Mo''s People record, from the unclaimed guest only');

  INSERT INTO public.ad_list_audiences(audience_key, owner_kind, brand_id, kind, source, display_name)
  VALUES ('brand:' || v_brand::text || ':guests', 'host', v_brand, 'list', 'guests', 'Round Five guests')
  RETURNING id INTO v_aud_new;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.ad_list_audience_refresh(v_aud_new);
  PERFORM pg_temp.snap(v_aud_new, 'after');
  -- The same refresh with only the two People-arm lines taken back out (the
  -- function as it stood before this round), then put back.
  v_def_new := pg_get_functiondef('public.ad_list_audience_refresh(uuid)'::regprocedure);
  v_def_old := replace(replace(v_def_new,
    E'\n          AND NOT public.issue_4508_contact_only_from_unclaimed_plus_one(m.id)', ''),
    E'\n            AND NOT public.issue_4508_unclaimed_plus_one_link(l.source_kind, l.source_id)', '');
  EXECUTE v_def_old;
  PERFORM public.ad_list_audience_refresh(v_aud_new);
  PERFORM pg_temp.snap(v_aud_new, 'before');
  EXECUTE v_def_new;
  PERFORM public.ad_list_audience_refresh(v_aud_new);
  PERFORM set_config('request.jwt.claim.role', '', true);

  SELECT count(*) INTO v_extra FROM (
    SELECT * FROM pg_temp.members('before') EXCEPT SELECT * FROM pg_temp.members('after')) d;
  SELECT count(*) INTO v_missing FROM (
    SELECT * FROM pg_temp.members('after') EXCEPT SELECT * FROM pg_temp.members('before')) d;
  -- Before: the unclaimed number-only guest is a member, and Mo's member row
  -- carries the number typed beside her email. After: neither.
  PERFORM pg_temp.ok(
    (SELECT array_agg(coalesce(d.phone_sha256, '-') ORDER BY d.phone_sha256) FROM (
       SELECT * FROM pg_temp.members('before') EXCEPT SELECT * FROM pg_temp.members('after')) d)
      = (SELECT array_agg(h ORDER BY h) FROM unnest(ARRAY[pg_temp.phash('+15550509201'), pg_temp.phash('+15550509202')]) h)
    AND v_extra = 2 AND v_missing = 1
    AND (SELECT d.phone_sha256 IS NULL FROM (
           SELECT * FROM pg_temp.members('after') EXCEPT SELECT * FROM pg_temp.members('before')) d),
    format('R5-1: the diff is exactly the unclaimed guests'' rows (before-only %s, after-only %s)', v_extra, v_missing));
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM pg_temp.members('after')) = (SELECT count(*) FROM pg_temp.members('before')) - 1
    AND NOT EXISTS (SELECT 1 FROM pg_temp.members('after') m
                     WHERE m.phone_sha256 IN (pg_temp.phash('+15550509201'), pg_temp.phash('+15550509202')))
    AND EXISTS (SELECT 1 FROM pg_temp.members('after') m WHERE m.phone_sha256 = pg_temp.phash('+15550509300'))
    AND EXISTS (SELECT 1 FROM pg_temp.members('after') m WHERE m.phone_sha256 = pg_temp.phash('+15550509100')),
    'R5-1: no unclaimed number is in the audience; the claimed guest and the inviter are');
  PERFORM pg_temp.ok(length(v_def_new) - length(v_def_old) = length(
      E'\n          AND NOT public.issue_4508_contact_only_from_unclaimed_plus_one(m.id)'
      || E'\n            AND NOT public.issue_4508_unclaimed_plus_one_link(l.source_kind, l.source_id)'),
    'R5-1: the before definition differs by the two People-arm lines only');
  -- A claim brings the guest in.
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509201';
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_pia, '+15550509201');
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_pia, public.mint_claim_link('rsvp_guest', v_gid)->>'code', NULL)->>'outcome' = 'claimed',
    'R5-1 fixture: the number-only guest claims');
  PERFORM public.biz_resolve_brand_person_source_derived('rsvp_plus_one', v_gid);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.ad_list_audience_refresh(v_aud_new);
  PERFORM pg_temp.snap(v_aud_new, 'claimed');
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_temp.members('claimed') m WHERE m.phone_sha256 = pg_temp.phash('+15550509201')),
    'R5-1: once claimed, the guest is in the audience');
  DELETE FROM public.verified_phone_identities WHERE user_id = v_pia;

  -- ======================= R5-2 one place, sweep paths ===================
  -- Order 1: own RSVP first, then the sweep. Ivy adds Pia's number before Pia
  -- proved it (unmatched); Pia RSVPs on her own; then Pia proves the number
  -- and the sweep runs.
  v_res := public.submit_event_rsvp(v_ev2, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 1, '[{"phone":"+15550509400"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  PERFORM public.submit_event_rsvp(v_ev2, v_pia, 'Pia Pratt', 'i4508r5-14@example.test',
    NULL, 'going', 0, '[]'::jsonb, NULL, NULL);
  PERFORM pg_temp.ok((SELECT matched_user_id IS NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'R5-2 fixture: the guest row is not matched to Pia yet');
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_pia, '+15550509400');
  v_res := public.claim_attendance_by_verified_identity(v_pia);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid)
    AND (SELECT plus_count FROM public.event_rsvps WHERE id = v_rsvp) = 0
    AND (SELECT count(*) FROM public.event_rsvps WHERE event_id = v_ev2 AND user_id = v_pia) = 1,
    'R5-2 order 1: her own RSVP wins; the sweep releases the guest row instead of leaving it: ' || v_res::text);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rsvp_guest_notices n
                       WHERE n.guest_id = v_gid AND n.user_id = v_ivy AND n.kind = 'guest_has_own_rsvp'
                         AND n.phone_last4 = '9400' AND n.status = 'pending') = 1,
    'R5-2 order 1: the inviter''s notice is queued');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.claim_links
                                  WHERE subject_kind = 'rsvp_guest' AND subject_id = v_gid AND revoked_at IS NULL),
    'R5-2 order 1: the guest link is dead');
  -- A "Can't go" own RSVP still leaves the row alone (unchanged).
  v_res := public.submit_event_rsvp(v_ev2, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 1, '[{"phone":"+15550509401"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid2 FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509401';
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE event_id = v_ev2 AND user_id = v_pia;
  UPDATE public.verified_phone_identities SET phone_e164 = '+15550509401' WHERE user_id = v_pia;
  PERFORM public.claim_attendance_by_verified_identity(v_pia);
  PERFORM pg_temp.ok((SELECT matched_user_id IS NULL FROM public.event_rsvp_guests WHERE id = v_gid2),
    'R5-2: a "Can''t go" own RSVP still keeps the sweep off the row, as before');

  -- Order 2: the guest row is matched first (unclaimed), then an own RSVP
  -- arrives through the anonymous-RSVP attach (the sweep's RSVP arm).
  v_res := public.submit_event_rsvp(v_ev2, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 2, '[{"phone":"+15550509401"},{"phone":"+15550509500"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509500';
  PERFORM pg_temp.ok((SELECT matched_user_id = v_rae AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'R5-2 fixture: Rae is matched at submit, unclaimed');
  PERFORM pg_temp.signed_out();
  v_res := public.submit_event_rsvp(v_ev2, NULL, 'Rae Ross', 'rae-anon-4508r5@example.test',
    '+15550509501', 'going', 0, '[]'::jsonb, NULL, 'US');
  v_anon := (v_res->>'rsvpId')::uuid;
  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via)
  VALUES (v_rae, 'email', 'rae-anon-4508r5@example.test', 'email_code');
  v_res := public.claim_attendance_by_verified_identity(v_rae);
  PERFORM pg_temp.ok((SELECT user_id FROM public.event_rsvps WHERE id = v_anon) = v_rae
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid)
    AND (SELECT count(*) FROM public.rsvp_guest_notices WHERE guest_id = v_gid AND user_id = v_ivy) = 1,
    'R5-2 order 2: the attached own RSVP wins; the unclaimed guest row is released and the inviter told: ' || v_res::text);

  -- A claimed guest pass is the person's place: Quin's number is matched and
  -- claimed by the sweep; her earlier anonymous RSVP is then never attached.
  PERFORM pg_temp.signed_out();
  v_res := public.submit_event_rsvp(v_ev2, NULL, 'Quin Quay', 'quin-anon-4508r5@example.test',
    '+15550509601', 'going', 0, '[]'::jsonb, NULL, 'US');
  v_anon := (v_res->>'rsvpId')::uuid;
  v_res := public.submit_event_rsvp(v_ev2, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 3, '[{"phone":"+15550509401"},{"phone":"+15550509600"},{"phone":"+15550509602"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509600';
  -- She proves the number first: the sweep claims the guest pass.
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_quin, '+15550509600');
  v_res := public.claim_attendance_by_verified_identity(v_quin);
  PERFORM pg_temp.ok((SELECT matched_user_id = v_quin AND claimed_at IS NOT NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'R5-2 claimed pass fixture: the sweep claims the guest pass: ' || v_res::text);
  -- Then she proves the email of her earlier anonymous RSVP.
  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via)
  VALUES (v_quin, 'email', 'quin-anon-4508r5@example.test', 'email_code');
  v_res := public.claim_attendance_by_verified_identity(v_quin);
  PERFORM pg_temp.ok((SELECT user_id IS NULL FROM public.event_rsvps WHERE id = v_anon)
    AND (SELECT claimed_at IS NOT NULL FROM public.event_rsvp_guests WHERE id = v_gid),
    'R5-2 claimed pass: the sweep leaves the anonymous RSVP unattached: ' || v_res::text);
  v_res := public.claim_attendance_by_verified_identity(v_quin);
  PERFORM pg_temp.ok((SELECT user_id IS NULL FROM public.event_rsvps WHERE id = v_anon),
    'R5-2 claimed pass: a second sweep still leaves it');
  -- The claim link answers conflict (the established duplicate-owner answer).
  UPDATE public.event_rsvps
     SET pass_recovery_token_hash = encode(sha256(convert_to('r5-quin', 'UTF8')), 'hex')
   WHERE id = v_anon;
  v_res := public.claim_attendance_internal_v2(v_quin, 'rsvp', v_ev2, v_anon,
    sha256(convert_to('r5-quin', 'UTF8')), NULL);
  PERFORM pg_temp.ok(v_res->>'result' = 'conflict' AND (SELECT user_id IS NULL FROM public.event_rsvps WHERE id = v_anon),
    'R5-2 claimed pass: the claim link answers conflict: ' || v_res::text);
  -- Any other writer is stopped by the attach trigger.
  v_err := pg_temp.err_state(format('UPDATE public.event_rsvps SET user_id = %L WHERE id = %L', v_quin, v_anon));
  PERFORM pg_temp.ok(v_err = 'PT409:rsvp_guest_has_pass',
    'R5-2 claimed pass: a direct attach is refused: ' || v_err);
  -- Draining: each queued notice is taken once.
  SELECT count(*) INTO v_n FROM public.issue_4508_take_guest_notices(50) t
   WHERE t.user_id = v_ivy AND t.kind = 'guest_has_own_rsvp' AND t.event_title = 'Round Five Places';
  PERFORM pg_temp.ok(v_n = 2, 'R5-2: the tick takes both queued notices: ' || v_n);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.issue_4508_take_guest_notices(50)),
    'R5-2: a notice is taken once');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.rsvp_guest_notices', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.rsvp_guest_notices', 'SELECT')
    AND NOT has_function_privilege('authenticated', 'public.issue_4508_take_guest_notices(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4508_release_for_own_place(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4508_sweep_guest_yields(uuid, uuid)', 'EXECUTE'),
    'R5-2: the queue and its functions are service-role only');
  -- The patched #4459 bodies keep the #4063 claims rules (the #4063 gate reads
  -- their source in 20280805004459): no claim-link or visibility read in the
  -- sweep, and each patch is there exactly once.
  v_def_new := pg_get_functiondef('public.claim_attendance_by_verified_identity(uuid)'::regprocedure);
  PERFORM pg_temp.ok(v_def_new !~* 'claim_links' AND v_def_new !~* '\mvisibility\M'
    AND (length(v_def_new) - length(replace(v_def_new, 'issue_4508_sweep_guest_yields', ''))) / length('issue_4508_sweep_guest_yields') = 1
    AND (length(v_def_new) - length(replace(v_def_new, 'g4508.claimed_at IS NOT NULL', ''))) / length('g4508.claimed_at IS NOT NULL') = 1,
    'R5-2: the patched sweep keeps the #4063 rules and carries each patch once');
  v_def_new := pg_get_functiondef('public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure);
  PERFORM pg_temp.ok(v_def_new !~* '\mvisibility\M'
    AND (length(v_def_new) - length(replace(v_def_new, 'g4508.claimed_at IS NOT NULL', ''))) / length('g4508.claimed_at IS NOT NULL') = 1,
    'R5-2: the patched claim link keeps the #4063 rules and carries its patch once');

  -- ======================= R6 no claim at submit ===========================
  -- Lee proved her number and her email (a verified email identity): the
  -- strongest old-app case. Max proved his number only.
  INSERT INTO auth.identities(user_id, provider, identity_data) VALUES
    (v_lee, 'email', jsonb_build_object('email', 'lee-4508r5@example.test', 'email_verified', true)),
    (v_max, 'email', jsonb_build_object('email', 'max-4508r5@example.test', 'email_verified', false));
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (v_ivy, v_fri, 'accepted'), (v_fri, v_ivy, 'accepted');
  -- An old app's request: every guest {name, email, phone}, through the
  -- delivery wrapper production calls, with a pass pepper.
  v_res := public.submit_event_rsvp_with_delivery(v_ev3, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 2, jsonb_build_array(
      jsonb_build_object('name', 'Lee Lund', 'email', 'lee-4508r5@example.test', 'phone', '+15550509700', 'phoneCountryIso', 'US'),
      jsonb_build_object('name', 'Max Mead', 'email', 'max-4508r5@example.test', 'phone', '+15550509800', 'phoneCountryIso', 'US')),
    'r6-test-pepper-0123456789abcdef0123456789', 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509700';
  SELECT id INTO v_gid2 FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509800';
  PERFORM pg_temp.ok(v_gid IS NOT NULL AND v_gid2 IS NOT NULL
    AND (SELECT count(*) FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp) = 2,
    'R6 old contract: the old app''s guests are accepted and created');
  PERFORM pg_temp.ok((SELECT matched_user_id = v_lee AND claimed_at IS NULL AND name = 'Lee Lund'
                        AND email = 'lee-4508r5@example.test' FROM public.event_rsvp_guests WHERE id = v_gid),
    'R6 old contract: the account that proves the number and the typed email is matched, never claimed');
  PERFORM pg_temp.ok((SELECT matched_user_id = v_max AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid2),
    'R6 old contract: an unverified email is matched by number and unclaimed too');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') g WHERE g->>'claimed' = 'true'),
    'R6 old contract: the submit answer says no guest is claimed: ' || (v_res->'guests')::text);
  PERFORM pg_temp.as_user(v_lee);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.fetch_user_rsvp_party_passes(v_rsvp))
    AND NOT EXISTS (SELECT 1 FROM public.fetch_user_going_rsvps(v_lee) f
                     WHERE f.qr_code = (SELECT qr_code FROM public.event_rsvp_guests WHERE id = v_gid)),
    'R6 old contract: no pass in her app before she claims');
  PERFORM pg_temp.signed_out();
  -- What she still gets: the pass message, queued as before, to the typed
  -- email and the number (the email goes out with the guest's link).
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rsvp_notifications n
                       WHERE n.rsvp_id = v_rsvp AND n.template_key = 'rsvp_pass'
                         AND n.payload->>'role' = 'guest' AND n.payload->>'guestId' = v_gid::text
                         AND n.payload->>'recipientEmail' = 'lee-4508r5@example.test') = 1,
    'R6 old contract: her pass message is queued with her typed email');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                       JOIN public.rsvp_notifications n ON n.id = d.notification_id
                      WHERE n.payload->>'guestId' = v_gid::text AND d.channel = 'email')
    AND EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                       JOIN public.rsvp_notifications n ON n.id = d.notification_id
                      WHERE n.payload->>'guestId' = v_gid::text AND d.channel = 'sms'),
    'R6 old contract: the email and the text are both queued: ' || COALESCE((SELECT string_agg(d.channel, ',')
       FROM public.rsvp_notification_deliveries d JOIN public.rsvp_notifications n ON n.id = d.notification_id
      WHERE n.payload->>'guestId' = v_gid::text), 'none'));
  -- The link both messages carry opens her invite, and claiming it works.
  v_err := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_err, NULL)->>'status' = 'open',
    'R6 old contract: her link opens her invite');
  v_res := public.rsvp_guest_claim(v_lee, v_err, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'claimed', 'R6 old contract: she claims with her link: ' || v_res::text);
  PERFORM pg_temp.as_user(v_lee);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.fetch_user_rsvp_party_passes(v_rsvp) WHERE entity_id = v_gid),
    'R6 old contract: after the claim the pass is in her app');
  PERFORM pg_temp.signed_out();
  -- A request that mixes an old-contract guest with a number-only guest or a
  -- friend pick is accepted the same way, every guest unclaimed.
  DELETE FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  v_res := public.submit_event_rsvp(v_ev3, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 2, jsonb_build_array(
      jsonb_build_object('name', 'Lee Lund', 'email', 'lee-4508r5@example.test', 'phone', '+15550509700'),
      jsonb_build_object('userId', v_fri)),
    NULL, 'US');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvp_guests
                       WHERE rsvp_id = v_rsvp AND claimed_at IS NULL AND matched_user_id IN (v_lee, v_fri)) = 2,
    'R6 mixed: an old-contract guest beside a friend pick, both unclaimed');

  -- ================ Round 7: no text without a route =====================
  -- A Ghana number has no SMS route (mingla_e164_country NULL): the submit
  -- answers willText false, and no 'sms' delivery is queued for it, while
  -- its pass email still is. A routable number beside it keeps its text.
  DELETE FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  v_res := public.submit_event_rsvp_with_delivery(v_ev3, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 2, jsonb_build_array(
      jsonb_build_object('name', 'Gita Gee', 'email', 'gita-4508r7@example.test', 'phone', '+233300000701', 'phoneCountryIso', 'GH'),
      jsonb_build_object('phone', '+15550509901', 'phoneCountryIso', 'US')),
    'r7-test-pepper-0123456789abcdef0123456789', 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+233300000701';
  SELECT id INTO v_gid2 FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550509901';
  PERFORM pg_temp.ok(v_gid IS NOT NULL AND v_gid2 IS NOT NULL,
    'R7 route: both guests are created: ' || v_res::text);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.rsvp_notifications n
                      WHERE n.payload->>'guestId' = v_gid::text AND n.template_key = 'rsvp_pass'),
    'R7 route: the unroutable guest''s pass message is queued');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                       JOIN public.rsvp_notifications n ON n.id = d.notification_id
                      WHERE n.payload->>'guestId' = v_gid::text AND d.channel = 'sms'),
    'R7 route: no text is queued for a number with no SMS route: ' || COALESCE((SELECT string_agg(d.channel, ',')
       FROM public.rsvp_notification_deliveries d JOIN public.rsvp_notifications n ON n.id = d.notification_id
      WHERE n.payload->>'guestId' = v_gid::text), 'none'));
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                       JOIN public.rsvp_notifications n ON n.id = d.notification_id
                      WHERE n.payload->>'guestId' = v_gid::text AND d.channel = 'email'),
    'R7 route: the unroutable guest''s pass email is still queued');
  PERFORM pg_temp.ok(public.rsvp_guest_invite_status(v_gid) = 'not_texted',
    'R7 route: the unroutable guest reads not_texted, not failed');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                       JOIN public.rsvp_notifications n ON n.id = d.notification_id
                      WHERE n.payload->>'guestId' = v_gid2::text AND d.channel = 'sms'),
    'R7 route: a routable guest number still gets its text');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                       JOIN public.rsvp_notifications n ON n.id = d.notification_id
                      WHERE n.rsvp_id = v_rsvp AND n.payload->>'role' = 'primary' AND d.channel = 'sms'),
    'R7 route: the primary''s text is unchanged');

  -- ================ Round 8: labels and a message with no channel ========
  -- The submit answer names a guest only by a real name: none for a number
  -- nobody named (the apps show its last four), never "<Inviter>'s guest".
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') g
                      WHERE g->>'phoneLast4' = '9901' AND g->>'displayName' IS NULL),
    'R8 label: an unnamed number guest has no display name: ' || (v_res->'guests')::text);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') g
                      WHERE g->>'phoneLast4' = '0701' AND g->>'displayName' = 'Gita Gee'),
    'R8 label: a typed name is still the display name: ' || (v_res->'guests')::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'guests') g
                      WHERE g->>'displayName' LIKE '%''s guest'),
    'R8 label: never the host-facing inviter label: ' || (v_res->'guests')::text);
  -- A Ghana number with no email and no account has no channel left: its
  -- message ends skipped, not pending forever.
  DELETE FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  v_res := public.submit_event_rsvp_with_delivery(v_ev3, v_ivy, 'Ivy Ives', 'i4508r5-ivy@example.test',
    '+15550509100', 'going', 1, jsonb_build_array(
      jsonb_build_object('phone', '+233300000801', 'phoneCountryIso', 'GH')),
    'r8-test-pepper-0123456789abcdef0123456789', 'US');
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+233300000801';
  PERFORM pg_temp.ok((SELECT n.status = 'skipped' AND n.last_error = 'no_deliverable_channel'
                        FROM public.rsvp_notifications n
                       WHERE n.payload->>'guestId' = v_gid::text AND n.template_key = 'rsvp_pass'),
    'R8 skipped: a guest message with no channel ends skipped: ' || COALESCE((SELECT n.status
       FROM public.rsvp_notifications n WHERE n.payload->>'guestId' = v_gid::text), 'none'));
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_notifications n
                       WHERE n.rsvp_id = v_rsvp AND n.payload->>'role' = 'primary' AND n.status = 'skipped'),
    'R8 skipped: the primary''s message is never skipped by this rule');

  RAISE NOTICE '#4508 fix round 5: all cases passed';
END
$round5$;

ROLLBACK;
