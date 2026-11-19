-- #4508 Phase 1 and Phase 2 (server) — bring a friend to an RSVP with just
-- their number. Spec: issue #4508 "Full build spec" + amendments 1-4.
--
--   1.10 event_rsvp_guests: name and email nullable (their length checks still
--        apply when present); invited_by_user_id, claimed_at,
--        brought_by_guest_id. "This isn't me" (1.18) DELETES the guest row (so
--        every reader, count and pass frees the spot with no extra filter) and
--        records the release, with its released_at, in rsvp_guest_releases,
--        which also stops further texts to that number for that event.
--   1.9  submit_event_rsvp: number-only guests (old {name,email,phone} guests
--        still accepted), the host's plus-one limit raised as an error, own
--        number / duplicate / already-listed / released numbers refused, a
--        per-inviter cap of 20 guest numbers per rolling 24 hours
--        (rsvp_guest_daily_cap), and guest rows are KEPT across a re-submit
--        when their number is still listed (claims, passes and texts survive).
--   1.11 rsvp_guest_display_name: account name, else the name given, else
--        "<Inviter first name>'s guest"; used by the host list, the scanner,
--        party passes and the admin RSVP list.
--   1.19-1.22 rsvp_guest_claim: one-tap claim when the account has proved the
--        invited number (account_owns_contact), otherwise phone_unproved; on
--        claim the inviter and guest become friends and close friends
--        (pairings.source = 'rsvp_guest', which check_pairing_allowed does not
--        count), skipped when either has blocked the other.
--   1.23 get_user_circle: a close friend made through an RSVP carries the event
--        as relationship context.
--   1.24 fetch_user_rsvp_party_passes: claimed, invite status, invite link.
--   2.1  rsvp_enqueue_guest_reminders: one reminder per unclaimed guest per
--        event, 23-24 hours before the start, on the existing RSVP queue.
--   2.3  friend-is-going notices, one per friend per event, drained by the
--        existing every-minute rsvp-notify tick.
--   2.5  events.rsvp_guests_can_bring (default off) and rsvp_guest_bring.
--
-- Application conflicts never raise 40001. Static SQL except where a column
-- may be absent on the CI image. Re-created functions name their source.
--
-- LOCKS (R-8). The whole file is one transaction, so every lock it takes is
-- held until COMMIT; splitting a foreign key into NOT VALID + VALIDATE inside
-- one transaction saves nothing, so this file does not pretend to. What is
-- held: ACCESS EXCLUSIVE on event_rsvp_guests, events, pairings,
-- friend_requests and notification_preferences (column / constraint changes)
-- from their statement to COMMIT; SHARE ROW EXCLUSIVE on events, event_rsvps
-- and pairings (new tables' foreign keys). The SHARE ROW EXCLUSIVE lock on
-- auth.users, which would stall sign-ins, is taken only by section 11 at the
-- very end, so it is held for that section and the commit, not the whole
-- file. Measured on the CI replay (empty tables): the whole file applies in
-- 60-100 ms. In production add one scan each of event_rsvp_guests (the two
-- foreign keys and sms_hold check), pairings and friend_requests (their source
-- checks). Section 1 also rewrites, on the first apply only, each guest row
-- already matched to an account (N-6 backfill; row locks, and one enqueue each
-- from the existing party and brand-people triggers). Section 10b re-creates
-- the #4459 party trigger (SHARE ROW EXCLUSIVE on event_rsvp_guests, already
-- held) and re-syncs Guest chat members matched to an unclaimed row (row locks
-- on conversation_participants; none exist on the first apply, because the
-- backfill marks every earlier match claimed). lock_timeout only bounds the
-- wait to acquire a lock; it does not shorten a hold.
--
-- ROLLBACK (R-7). Every table and column here is additive and may stay. To
-- roll back behaviour, re-apply the previous definitions of the re-created
-- functions from the migrations each section names: submit_event_rsvp from
-- 20281119004508 (phase 0; which itself names 20271215004063),
-- check_pairing_allowed from 20260505000000, fetch_user_rsvp_party_passes,
-- host_list_rsvp_guests, peer_list_event_guests, business_update_rsvp_graph,
-- fetch_user_going_rsvps, get_user_circle and biz_set_show_me_as_going from the
-- sources named above each; drop the new #4508 functions, the two triggers
-- (issue_4508_guest_show_me_owner_only, issue_4508_friend_going,
-- issue_4508_guest_match_is_claim) and the event_rsvp_guests_owner_read change
-- (restore it from 20280707324423). N-3: GRANT SELECT ON event_rsvp_guests TO
-- anon, authenticated restores the table read. N-1: re-apply
-- issue_4459_brand_guest_eligible and its party trigger from 20280805004459
-- (then 20280805004473's hook), and run issue_4459_safe_sync for each matched
-- guest; claimed_at may stay (it is additive). The S2
-- patch of biz_resolve_brand_person_source reverses by swapping its two
-- literals back. DATA NOTE: number-only guest rows (name and email NULL) and
-- friend guests with no proven number (phone NULL) exist once this has run;
-- the old submit_event_rsvp and old readers assume NOT NULL there, so roll the
-- functions back only together with a decision about those rows (keep them
-- and leave the columns nullable, or remove them with their parties' consent).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_rsvp_guests ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.event_rsvp_guests ALTER COLUMN email DROP NOT NULL;
-- C1: a friend picked from the friends list who has no proven number is still
-- a guest (in-app and push only), so the number may be absent too.
ALTER TABLE public.event_rsvp_guests ALTER COLUMN phone DROP NOT NULL;
-- N-6: whether claimed_at is new on this run. Only the first apply backfills
-- it (below); a re-apply never marks a #4508 guest as claimed.
SELECT set_config('mingla.issue_4508_claimed_at_is_new',
  (NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'event_rsvp_guests'
       AND column_name = 'claimed_at'))::text,
  true);
-- Plain columns first. The invited_by_user_id foreign key to auth.users is
-- added in section 11 at the end (see LOCKS above).
ALTER TABLE public.event_rsvp_guests
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS brought_by_guest_id uuid NULL,
  ADD COLUMN IF NOT EXISTS added_from_friend boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_hold text NULL,
  ADD COLUMN IF NOT EXISTS show_me_as_going boolean NOT NULL DEFAULT false;
ALTER TABLE public.event_rsvp_guests
  DROP CONSTRAINT IF EXISTS event_rsvp_guests_brought_by_guest_id_fkey;
ALTER TABLE public.event_rsvp_guests
  ADD CONSTRAINT event_rsvp_guests_brought_by_guest_id_fkey
  FOREIGN KEY (brought_by_guest_id) REFERENCES public.event_rsvp_guests(id) ON DELETE CASCADE;
ALTER TABLE public.event_rsvp_guests DROP CONSTRAINT IF EXISTS event_rsvp_guests_sms_hold_check;
ALTER TABLE public.event_rsvp_guests ADD CONSTRAINT event_rsvp_guests_sms_hold_check
  CHECK (sms_hold IS NULL OR sms_hold IN ('no_phone', 'number_limit'));
CREATE INDEX IF NOT EXISTS event_rsvp_guests_invited_by_idx
  ON public.event_rsvp_guests (invited_by_user_id) WHERE invited_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_rsvp_guests_brought_by_idx
  ON public.event_rsvp_guests (brought_by_guest_id) WHERE brought_by_guest_id IS NOT NULL;
COMMENT ON COLUMN public.event_rsvp_guests.name IS
  '#4508: the name given (old form, or by the guest at claim). NULL for a number-only guest; readers use rsvp_guest_display_name.';
COMMENT ON COLUMN public.event_rsvp_guests.claimed_at IS
  '#4508: when the guest claimed the pass (rsvp_guest_claim, or a proven-contact claim sweep that matched the row). Rows matched to an account before #4508 were backfilled with their created_at.';
-- N-6: a guest row already matched to an account before #4508 was that
-- account's pass, so it reads as claimed: the Guest chat keeps them (section
-- 10b needs a claimed pass), "Bring someone too" works and hosts see no
-- check-in-by-hand button. The claim time is unknown, so the row's own
-- created_at stands in (the earliest moment it could have been theirs). Only
-- on the first apply (the marker above); the existing party and brand-people
-- triggers see one UPDATE per such row, as for any guest-row edit.
UPDATE public.event_rsvp_guests g
   SET claimed_at = g.created_at
 WHERE current_setting('mingla.issue_4508_claimed_at_is_new', true) = 'true'
   AND g.matched_user_id IS NOT NULL
   AND g.claimed_at IS NULL;
COMMENT ON COLUMN public.event_rsvp_guests.brought_by_guest_id IS
  '#4508 2.5: the claimed guest who brought this guest (guests bring guests).';
COMMENT ON COLUMN public.event_rsvp_guests.added_from_friend IS
  '#4508 C1: the inviter picked this guest from their friends list; the server resolved the number and never returns it.';
COMMENT ON COLUMN public.event_rsvp_guests.sms_hold IS
  '#4508: why this guest is never texted (no_phone: a friend with no proven number; number_limit: the number already had 3 guest invites in 24 hours).';
COMMENT ON COLUMN public.event_rsvp_guests.show_me_as_going IS
  '#4508 D-2.4: a claimed guest shows on the public Who''s going list only while this is on. Default off, as for any RSVP.';
-- D-2.4: the consent is the guest's own; host and staff writes never flip it
-- (the same owner-only rule #3682 put on event_rsvps).
CREATE OR REPLACE FUNCTION public.tg_issue_4508_guest_show_me_owner_only()
RETURNS trigger
LANGUAGE plpgsql
AS $g$
BEGIN
  IF OLD.show_me_as_going IS NOT DISTINCT FROM NEW.show_me_as_going THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.matched_user_id
     AND NEW.claimed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL AND current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'show_me_as_going_owner_only' USING ERRCODE = '42501';
END;
$g$;
REVOKE ALL ON FUNCTION public.tg_issue_4508_guest_show_me_owner_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4508_guest_show_me_owner_only ON public.event_rsvp_guests;
CREATE TRIGGER issue_4508_guest_show_me_owner_only
  BEFORE UPDATE OF show_me_as_going ON public.event_rsvp_guests
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4508_guest_show_me_owner_only();
-- R-3 (C1): a friend picked from the friends list carries the number THEIR
-- account proved, which the inviter never typed and must never read. The
-- party owner's direct read (20280707324423) no longer covers those rows; the
-- friend still reads their own row, hosts keep their read, and the apps read
-- guests only through SECURITY DEFINER functions (which return no number for
-- a friend guest), so texting, claiming and the host lists are unaffected.
ALTER POLICY event_rsvp_guests_owner_read ON public.event_rsvp_guests
  USING (((EXISTS ( SELECT 1
     FROM public.event_rsvps r
    WHERE ((r.id = event_rsvp_guests.rsvp_id) AND (r.user_id = ( SELECT auth.uid() AS uid)))))
      AND NOT event_rsvp_guests.added_from_friend)
    OR (matched_user_id = ( SELECT auth.uid() AS uid)));
-- N-3: no app role reads a guest's number or email by a direct table read.
-- The host read policy (any event manager of the brand) and the owner read
-- policy decide which ROWS a signed-in user sees; these column grants decide
-- that phone and email are never among the columns. Every reader that needs
-- them runs as service_role or inside a SECURITY DEFINER function (texting,
-- claiming, host phoneLast4, the Admin list), so none is affected. No client
-- in the apps, Host, Admin or the website selects this table directly. A
-- column added later is not readable by app roles until granted here.
REVOKE SELECT ON TABLE public.event_rsvp_guests FROM PUBLIC, anon, authenticated;
DO $n3_columns$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'event_rsvp_guests'
     AND c.column_name NOT IN ('phone', 'email');
  EXECUTE format('GRANT SELECT (%s) ON public.event_rsvp_guests TO authenticated', v_cols);
END
$n3_columns$;
-- A proven-contact claim sweep (#4063 / #4459 claim of pending passes) that
-- matches an unmatched guest row to an account which has proved the row's
-- NUMBER is that account claiming the pass, exactly as rsvp_guest_claim would
-- accept it, so it is recorded as a claim (the Guest chat, "Bring someone
-- too" and the host list then treat it as one). A match by email alone is not
-- (P2-1: an account that proves the number may still take the row).
-- rsvp_guest_claim sets claimed_at itself; a submit only inserts.
CREATE OR REPLACE FUNCTION public.tg_issue_4508_guest_match_is_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $g$
BEGIN
  IF OLD.matched_user_id IS NULL AND NEW.matched_user_id IS NOT NULL
     AND NEW.claimed_at IS NULL AND NEW.phone IS NOT NULL
     AND public.account_owns_contact(NEW.matched_user_id, NULL, NEW.phone) THEN
    NEW.claimed_at := now();
  END IF;
  RETURN NEW;
END;
$g$;
REVOKE ALL ON FUNCTION public.tg_issue_4508_guest_match_is_claim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4508_guest_match_is_claim ON public.event_rsvp_guests;
CREATE TRIGGER issue_4508_guest_match_is_claim
  BEFORE UPDATE OF matched_user_id ON public.event_rsvp_guests
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4508_guest_match_is_claim();

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_guests_can_bring boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.events.rsvp_guests_can_bring IS
  '#4508 2.5: a claimed guest may bring one more person, within total capacity. Default off.';

ALTER TABLE public.pairings
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'request';
ALTER TABLE public.pairings DROP CONSTRAINT IF EXISTS pairings_source_check;
ALTER TABLE public.pairings ADD CONSTRAINT pairings_source_check
  CHECK (source IN ('request', 'rsvp_guest'));
COMMENT ON COLUMN public.pairings.source IS
  '#4508 D1: rsvp_guest pairings (made when a brought guest claims) do not use the pairing allowance.';

ALTER TABLE public.friend_requests DROP CONSTRAINT IF EXISTS friend_requests_source_check;
ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_source_check
  CHECK (source = ANY (ARRAY['app'::text, 'map'::text, 'onboarding'::text,
    'session'::text, 'share_link'::text, 'rsvp_guest'::text]));

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS friends_going boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.notification_preferences.friends_going IS
  '#4508 2.3: push when a close friend is going to an event.';

CREATE TABLE IF NOT EXISTS public.rsvp_guest_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rsvp_id uuid NULL REFERENCES public.event_rsvps(id) ON DELETE SET NULL,
  phone_digits text NOT NULL CHECK (phone_digits ~ '^[0-9]{7,15}$'),
  inviter_user_id uuid NULL,
  claim_code text NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  -- P3-8: who released it so far (user:<id> or rsvp:<party id>) and how often.
  release_count integer NOT NULL DEFAULT 1,
  inviter_keys text[] NOT NULL DEFAULT '{}',
  CONSTRAINT rsvp_guest_releases_event_number UNIQUE (event_id, phone_digits)
);
CREATE INDEX IF NOT EXISTS rsvp_guest_releases_code_idx
  ON public.rsvp_guest_releases (claim_code) WHERE claim_code IS NOT NULL;
COMMENT ON TABLE public.rsvp_guest_releases IS
  '#4508 1.18: "This isn''t me". The inviter whose guest was released can never text or re-add that number for this event; another inviter may add it once, and a second release bars it for the whole event (rsvp_guest_number_barred).';
-- The codes of every released guest row (a number may be released twice).
CREATE TABLE IF NOT EXISTS public.rsvp_guest_released_codes (
  claim_code text PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES public.rsvp_guest_releases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rsvp_guest_invite_log (
  id bigserial PRIMARY KEY,
  inviter_key text NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  phone_digits text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvp_guest_invite_log_window_idx
  ON public.rsvp_guest_invite_log (inviter_key, created_at);
CREATE INDEX IF NOT EXISTS rsvp_guest_invite_log_number_idx
  ON public.rsvp_guest_invite_log (phone_digits, created_at);
CREATE INDEX IF NOT EXISTS rsvp_guest_invite_log_event_idx
  ON public.rsvp_guest_invite_log (event_id, created_at);
COMMENT ON TABLE public.rsvp_guest_invite_log IS
  '#4508 1.9: one row per guest number added by an inviter. inviter_key is user:<id> for a signed-in inviter and ip:<salted hash> for a signed-out one (never the unverified number they typed). The caps count these rows, so removing and re-adding does not reset them: 20 per inviter, 30 per event from signed-out inviters, and a number past 3 in 24 hours is added but not texted.';
-- R-4: the signed-out daily text ceiling counts these rows across every event.
CREATE INDEX IF NOT EXISTS rsvp_guest_invite_log_signed_out_idx
  ON public.rsvp_guest_invite_log (created_at) WHERE inviter_key LIKE 'ip:%';

-- R-1: every signed-out submit that carries guest numbers is counted here, in
-- its own transaction BEFORE the submit runs (public-submit-rsvp calls
-- rsvp_guest_signed_out_attempt first), so a submit the database refuses and
-- rolls back still uses up the caller's and the event's allowance.
CREATE TABLE IF NOT EXISTS public.rsvp_guest_signed_out_attempts (
  id bigserial PRIMARY KEY,
  inviter_key text NOT NULL CHECK (inviter_key LIKE 'ip:%'),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_count integer NOT NULL CHECK (guest_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvp_guest_signed_out_attempts_key_idx
  ON public.rsvp_guest_signed_out_attempts (inviter_key, created_at);
CREATE INDEX IF NOT EXISTS rsvp_guest_signed_out_attempts_event_idx
  ON public.rsvp_guest_signed_out_attempts (event_id, created_at);
COMMENT ON TABLE public.rsvp_guest_signed_out_attempts IS
  '#4508 R-1 / N-2: guest numbers a signed-out caller tried to add, accepted or refused, counted before the submit so a refused submit still counts against that caller (20 per address per rolling 24 hours). The 30-per-event allowance counts accepted invites only (rsvp_guest_invite_log, inside the submit).';

-- N-8: the first time in a UTC day the signed-out text ceiling holds a
-- guest, one row here; rsvp-notify sends one ops alert for it and only then
-- marks it reported.
CREATE TABLE IF NOT EXISTS public.rsvp_guest_signed_out_ceiling_hits (
  hit_day date PRIMARY KEY,
  first_hit_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz NULL
);
COMMENT ON TABLE public.rsvp_guest_signed_out_ceiling_hits IS
  '#4508 N-8: one row per UTC day on which the signed-out guest text ceiling (300 per rolling 24 hours) first held a guest. Reported by one ops alert from rsvp-notify (issue_4508_list_ceiling_hits, issue_4508_mark_ceiling_hit_reported).';

-- P3-5: the friend-is-going enqueue never blocks an RSVP, and a failure is
-- recorded here (the rsvp-notify tick reports unreported rows) rather than
-- dropped.
-- The signed-in guest lookup is limited to 30 a minute (public-submit-rsvp); this
-- log gives it a ceiling of 200 per account per rolling 24 hours. One row per
-- lookup that was allowed.
CREATE TABLE IF NOT EXISTS public.rsvp_guest_lookup_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvp_guest_lookup_log_user_idx
  ON public.rsvp_guest_lookup_log (user_id, created_at);
COMMENT ON TABLE public.rsvp_guest_lookup_log IS
  '#4508: one row per signed-in guest lookup that was allowed; the daily ceiling (200 per account per rolling 24 hours) counts these. Rows older than 24 hours are swept by the next lookup of the same account.';

CREATE TABLE IF NOT EXISTS public.rsvp_friend_going_failures (
  id bigserial PRIMARY KEY,
  event_id uuid NULL,
  actor_user_id uuid NULL,
  sql_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS rsvp_friend_going_failures_unreported_idx
  ON public.rsvp_friend_going_failures (created_at) WHERE reported_at IS NULL;
COMMENT ON TABLE public.rsvp_friend_going_failures IS
  '#4508 P3-5: a friend-is-going enqueue that failed inside the RSVP trigger. Reported by one ops alert from rsvp-notify, then marked (issue_4508_list_friend_going_failures, issue_4508_mark_friend_going_failures_reported).';

CREATE TABLE IF NOT EXISTS public.rsvp_guest_connections (
  guest_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL,
  guest_user_id uuid NOT NULL,
  pairing_id uuid NULL REFERENCES public.pairings(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('connected', 'already_friends', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvp_guest_connections_pairing_idx
  ON public.rsvp_guest_connections (pairing_id) WHERE pairing_id IS NOT NULL;
COMMENT ON TABLE public.rsvp_guest_connections IS
  '#4508 1.21-1.23: the friendship a claimed RSVP guest made, and the event it came through.';

CREATE TABLE IF NOT EXISTS public.rsvp_friend_going_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  friend_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'taken')),
  created_at timestamptz NOT NULL DEFAULT now(),
  taken_at timestamptz NULL,
  CONSTRAINT rsvp_friend_going_notices_once UNIQUE (event_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS rsvp_friend_going_notices_pending_idx
  ON public.rsvp_friend_going_notices (created_at) WHERE status = 'pending';
COMMENT ON TABLE public.rsvp_friend_going_notices IS
  '#4508 2.3: "{Name} is going to {event}". At most one per friend per event, ever.';

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['rsvp_guest_releases', 'rsvp_guest_invite_log',
    'rsvp_guest_connections', 'rsvp_friend_going_notices', 'rsvp_guest_released_codes',
    'rsvp_friend_going_failures', 'rsvp_guest_signed_out_attempts',
    'rsvp_guest_lookup_log', 'rsvp_guest_signed_out_ceiling_hits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END
$rls$;
REVOKE ALL ON SEQUENCE public.rsvp_guest_invite_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.rsvp_guest_invite_log_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.rsvp_friend_going_failures_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.rsvp_friend_going_failures_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.rsvp_guest_signed_out_attempts_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.rsvp_guest_signed_out_attempts_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.rsvp_guest_lookup_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.rsvp_guest_lookup_log_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Names
-- ---------------------------------------------------------------------------
-- P2-2: a name that reaches a Mingla-branded text is reduced to letters,
-- spaces, hyphens and apostrophes. Empty when nothing survives.
CREATE OR REPLACE FUNCTION public.rsvp_guest_safe_name_part(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT NULLIF(btrim(regexp_replace(
    regexp_replace(coalesce(p_value, ''), '[^[:alpha:] ''-]', '', 'g'),
    '[[:space:]]+', ' ', 'g')), '');
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_safe_name_part(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_safe_name_part(text) TO service_role;

-- The inviter of a guest: who added the number, else the party's primary.
-- first_name and label are always made of letters, spaces, hyphens and
-- apostrophes (label adds " L." for a last initial), at most 24 characters.
-- A signed-out inviter's typed name gets the same treatment; nothing left
-- means NULL, which every caller renders as "A friend".
CREATE OR REPLACE FUNCTION public.rsvp_guest_inviter_names(p_guest_id uuid)
RETURNS TABLE (inviter_user_id uuid, first_name text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  WITH raw AS (
    SELECT COALESCE(g.invited_by_user_id, r.user_id) AS uid,
           CASE WHEN g.invited_by_user_id IS NULL OR g.invited_by_user_id = r.user_id
             THEN r.guest_name END AS typed,
           p.first_name AS p_first, p.last_name AS p_last,
           p.display_name AS p_display, p.username AS p_username
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      LEFT JOIN public.profiles p ON p.id = COALESCE(g.invited_by_user_id, r.user_id)
     WHERE g.id = p_guest_id
  ), parts AS (
    SELECT raw.uid,
           COALESCE(
             public.rsvp_guest_safe_name_part(raw.p_first),
             public.rsvp_guest_safe_name_part(split_part(btrim(coalesce(raw.p_display, '')), ' ', 1)),
             public.rsvp_guest_safe_name_part(split_part(btrim(coalesce(raw.typed, '')), ' ', 1)),
             public.rsvp_guest_safe_name_part(raw.p_username)
           ) AS first_raw,
           COALESCE(
             public.rsvp_guest_safe_name_part(raw.p_last),
             public.rsvp_guest_safe_name_part(substr(btrim(coalesce(raw.p_display, '')),
               length(split_part(btrim(coalesce(raw.p_display, '')), ' ', 1)) + 1)),
             public.rsvp_guest_safe_name_part(substr(btrim(coalesce(raw.typed, '')),
               length(split_part(btrim(coalesce(raw.typed, '')), ' ', 1)) + 1))
           ) AS last_raw
      FROM raw
  ), bounded AS (
    SELECT parts.uid,
           NULLIF(btrim(left(split_part(parts.first_raw, ' ', 1), 20)), '') AS first_name,
           upper(left(NULLIF(regexp_replace(coalesce(parts.last_raw, ''), '[^[:alpha:]]', '', 'g'), ''), 1)) AS initial
      FROM parts
  )
  SELECT bounded.uid,
         bounded.first_name,
         CASE
           WHEN bounded.first_name IS NULL THEN NULL
           WHEN bounded.initial IS NULL OR lower(bounded.first_name) = 'guest' THEN bounded.first_name
           ELSE bounded.first_name || ' ' || bounded.initial || '.'
         END
    FROM bounded;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_inviter_names(uuid) IS
  '#4508: the inviter of a guest (who added the number, else the primary): account id, first name, and "First L." for texts. Letters, spaces, hyphens and apostrophes only, at most 24 characters; NULL when nothing survives.';
REVOKE ALL ON FUNCTION public.rsvp_guest_inviter_names(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_inviter_names(uuid) TO service_role;

-- 1.11 The guest's display name everywhere.
CREATE OR REPLACE FUNCTION public.rsvp_guest_display_name(p_guest_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    NULLIF(btrim(p.display_name), ''),
    NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), ''),
    NULLIF(btrim(g.name), ''),
    (SELECT n.first_name || '''s guest' FROM public.rsvp_guest_inviter_names(g.id) n
      WHERE n.first_name IS NOT NULL),
    'Guest')
    FROM public.event_rsvp_guests g
    LEFT JOIN public.profiles p ON p.id = g.matched_user_id
   WHERE g.id = p_guest_id;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_display_name(uuid) IS
  '#4508 1.11: matched account name, else the name given, else "<Inviter first name>''s guest", else "Guest".';
REVOKE ALL ON FUNCTION public.rsvp_guest_display_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_display_name(uuid) TO service_role;

-- N-5: the name hosts, the door scanner and Admin see. Until the guest claims
-- the pass, the account a number matched is never named (a host could
-- otherwise look up who owns a number by adding it): the name the inviter
-- typed, else "<Inviter first name>'s guest", else "Guest"; the apps add the
-- last four digits. After the claim it is the 1.11 display name.
CREATE OR REPLACE FUNCTION public.rsvp_guest_host_label(p_guest_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN g.claimed_at IS NOT NULL
    THEN public.rsvp_guest_display_name(g.id)
    ELSE COALESCE(
      NULLIF(btrim(g.name), ''),
      (SELECT n.first_name || '''s guest' FROM public.rsvp_guest_inviter_names(g.id) n
        WHERE n.first_name IS NOT NULL),
      'Guest')
    END
    FROM public.event_rsvp_guests g
   WHERE g.id = p_guest_id;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_host_label(uuid) IS
  '#4508 N-5: host, scanner and Admin name for a plus-one. Unclaimed: the typed name, else "<Inviter first name>''s guest", else "Guest" (never the matched account). Claimed: rsvp_guest_display_name.';
REVOKE ALL ON FUNCTION public.rsvp_guest_host_label(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_host_label(uuid) TO service_role;

-- The state of the invite text for one guest (1.14 / 1.15 / 1.24).
CREATE OR REPLACE FUNCTION public.rsvp_guest_invite_status(p_guest_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.event_rsvp_guests g
     WHERE g.id = p_guest_id AND (g.sms_hold IS NOT NULL OR g.phone IS NULL))
  THEN 'not_texted' ELSE COALESCE((
    SELECT CASE
             WHEN d.status = 'sent' THEN 'sent'
             WHEN d.status IN ('failed_terminal', 'ambiguous') THEN 'failed'
             ELSE 'sending'
           END
      FROM public.rsvp_notifications n
      JOIN public.rsvp_notification_deliveries d
        ON d.notification_id = n.id AND d.channel = 'sms'
     WHERE n.template_key IN ('rsvp_pass', 'rsvp_approved', 'rsvp_waitlist_promoted')
       AND n.payload->>'guestId' = p_guest_id::text
     ORDER BY n.created_at DESC
     LIMIT 1
  ), 'not_texted') END;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_invite_status(uuid) IS
  '#4508: sent | sending | failed | not_texted for the guest''s invite text. A failed or suppressed text is never retried.';
REVOKE ALL ON FUNCTION public.rsvp_guest_invite_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_invite_status(uuid) TO service_role;

-- Numbers an account has proved or holds (own-number refusal).
CREATE OR REPLACE FUNCTION public.rsvp_account_phone_digits(p_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_out text[] := '{}';
  v_auth text;
BEGIN
  IF p_user_id IS NULL THEN RETURN v_out; END IF;
  SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d <> ''), '{}') INTO v_out
    FROM (
      SELECT regexp_replace(coalesce(v.phone_e164, ''), '\D', '', 'g') AS d
        FROM public.verified_phone_identities v WHERE v.user_id = p_user_id
      UNION ALL
      SELECT regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
        FROM public.profiles p WHERE p.id = p_user_id
    ) s;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'phone'
  ) THEN
    EXECUTE 'SELECT regexp_replace(coalesce(phone, ''''), ''\D'', '''', ''g'') FROM auth.users WHERE id = $1'
      INTO v_auth USING p_user_id;
    IF coalesce(v_auth, '') <> '' AND NOT (v_auth = ANY (v_out)) THEN
      v_out := v_out || v_auth;
    END IF;
  END IF;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_account_phone_digits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_account_phone_digits(uuid) TO service_role;

-- Is this number (digits) already on the event's list, outside one party?
CREATE OR REPLACE FUNCTION public.rsvp_number_on_event_list(
  p_event_id uuid, p_digits text, p_except_rsvp_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE r.event_id = p_event_id
       AND r.id IS DISTINCT FROM p_except_rsvp_id
       AND r.rsvp_status <> 'not_going'
       AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = p_digits
  ) OR EXISTS (
    SELECT 1 FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.id IS DISTINCT FROM p_except_rsvp_id
       AND r.rsvp_status <> 'not_going'
       AND regexp_replace(coalesce(r.guest_phone, ''), '\D', '', 'g') = p_digits
  );
$function$;
REVOKE ALL ON FUNCTION public.rsvp_number_on_event_list(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_number_on_event_list(uuid, text, uuid) TO service_role;

-- Is this account already on the event's list, outside one party?
CREATE OR REPLACE FUNCTION public.rsvp_user_on_event_list(
  p_event_id uuid, p_user_id uuid, p_except_rsvp_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.event_rsvps r
       WHERE r.event_id = p_event_id AND r.user_id = p_user_id
         AND r.id IS DISTINCT FROM p_except_rsvp_id
         AND r.rsvp_status <> 'not_going'
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvp_guests g
        JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE r.event_id = p_event_id AND g.matched_user_id = p_user_id
         AND r.id IS DISTINCT FROM p_except_rsvp_id
         AND r.rsvp_status <> 'not_going'
    ));
$function$;
REVOKE ALL ON FUNCTION public.rsvp_user_on_event_list(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_user_on_event_list(uuid, uuid, uuid) TO service_role;

-- C1: the number an account has PROVED (a code received at it), the same
-- proof account_owns_contact accepts. NULL when it has none. Never returned
-- to a client.
CREATE OR REPLACE FUNCTION public.rsvp_account_proven_phone(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_phone text;
  v_number_expr text;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  FOR v_phone IN
    SELECT c.phone FROM (
      SELECT v.phone_e164 AS phone, 1 AS rank, v.verified_at AS at
        FROM public.verified_phone_identities v WHERE v.user_id = p_user_id
      UNION ALL
      SELECT a.value, 2, a.last_proved_at
        FROM public.account_claim_contacts a
       WHERE a.user_id = p_user_id AND a.channel = 'phone' AND a.revoked_at IS NULL
    ) c
    WHERE c.phone ~ '^\+[1-9][0-9]{7,14}$'
    ORDER BY c.rank, c.at DESC
  LOOP
    IF public.account_owns_contact(p_user_id, NULL, v_phone) THEN RETURN v_phone; END IF;
  END LOOP;
  IF to_regclass('auth.identities') IS NOT NULL THEN
    v_number_expr := CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'phone'
      ) THEN 'coalesce(i.identity_data->>''phone'', u.phone)'
      ELSE 'i.identity_data->>''phone'''
    END;
    FOR v_phone IN EXECUTE format($q$
      SELECT '+' || regexp_replace(coalesce(%1$s, ''), '[^0-9]', '', 'g')
        FROM auth.identities i
        JOIN auth.users u ON u.id = i.user_id
       WHERE i.user_id = $1 AND i.provider = 'phone'
       ORDER BY i.last_sign_in_at DESC NULLS LAST
    $q$, v_number_expr) USING p_user_id
    LOOP
      IF v_phone ~ '^\+[1-9][0-9]{7,14}$'
         AND public.account_owns_contact(p_user_id, NULL, v_phone) THEN
        RETURN v_phone;
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_account_proven_phone(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_account_proven_phone(uuid) TO service_role;

-- C1: two accounts are friends for a friend-picked guest (accepted, not
-- removed) and neither has blocked the other.
CREATE OR REPLACE FUNCTION public.rsvp_guest_friend_pickable(p_inviter uuid, p_friend uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT p_inviter IS NOT NULL AND p_friend IS NOT NULL AND p_inviter <> p_friend
    AND EXISTS (
      SELECT 1 FROM public.friends f
       WHERE f.status = 'accepted' AND f.deleted_at IS NULL
         AND ((f.user_id = p_inviter AND f.friend_user_id = p_friend)
           OR (f.user_id = p_friend AND f.friend_user_id = p_inviter)))
    AND NOT public.has_block_between(p_inviter, p_friend)
    AND NOT EXISTS (
      SELECT 1 FROM public.friends b
       WHERE b.status = 'blocked' AND b.deleted_at IS NULL
         AND ((b.user_id = p_inviter AND b.friend_user_id = p_friend)
           OR (b.user_id = p_friend AND b.friend_user_id = p_inviter)));
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_friend_pickable(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_friend_pickable(uuid, uuid) TO service_role;

-- P3-8: is this number barred for this inviter on this event? The inviter
-- whose guest said "This isn't me" can never re-add it; anyone else may add
-- it until it has been released twice.
CREATE OR REPLACE FUNCTION public.rsvp_guest_number_barred(
  p_event_id uuid, p_digits text, p_inviter_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.rsvp_guest_releases rel
     WHERE rel.event_id = p_event_id AND rel.phone_digits = p_digits
       AND (rel.release_count >= 2
         OR (p_inviter_key IS NOT NULL AND p_inviter_key = ANY (rel.inviter_keys))));
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_number_barred(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_number_barred(uuid, text, text) TO service_role;

-- The release key of whoever invited a guest: user:<id>, else the party.
CREATE OR REPLACE FUNCTION public.rsvp_guest_release_key(p_inviter uuid, p_rsvp_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT CASE WHEN p_inviter IS NOT NULL THEN 'user:' || p_inviter::text
              WHEN p_rsvp_id IS NOT NULL THEN 'rsvp:' || p_rsvp_id::text END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_release_key(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_release_key(uuid, uuid) TO service_role;

-- C3: a number that has opted out of texts (STOP), as can_send reads it.
CREATE OR REPLACE FUNCTION public.rsvp_guest_number_suppressed(p_phone text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT p_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.channel_suppressions s
     WHERE s.channel = 'sms' AND s.scope IN ('transactional', 'all')
       AND (s.contact = p_phone OR s.contact = lower(p_phone)));
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_number_suppressed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_number_suppressed(text) TO service_role;

-- P1-1: an event this viewer can RSVP to right now: open (an RSVP event,
-- scheduled or live, not deleted, its date not over) and visible to them
-- (reachable by its public or link-shared page, or they are already on it).
CREATE OR REPLACE FUNCTION public.rsvp_event_open_for_viewer(p_event_id uuid, p_viewer uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_viewer IS NULL OR p_event_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.event_type = 'rsvp'
       AND e.status IN ('scheduled', 'live') AND e.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.event_id = e.id AND d.is_master IS TRUE
                      AND d.end_at > clock_timestamp())
  ) THEN
    RETURN false;
  END IF;
  RETURN public.pg_offering_passes_visibility_gate(p_event_id, 'direct')
    OR EXISTS (SELECT 1 FROM public.event_rsvps r
                WHERE r.event_id = p_event_id AND r.user_id = p_viewer);
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_event_open_for_viewer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_event_open_for_viewer(uuid, uuid) TO service_role;

-- P1-2: who is inviting, for the caps. A signed-in inviter is their account.
-- A signed-out inviter is the salted hash of their network address, which
-- public-submit-rsvp sends as the x-mingla-rsvp-client request header (never
-- the unverified number they typed). No header reads as one shared
-- "ip:unknown" bucket, so a caller cannot escape the cap by omitting it.
CREATE OR REPLACE FUNCTION public.rsvp_guest_inviter_key(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v text;
BEGIN
  IF p_user_id IS NOT NULL THEN RETURN 'user:' || p_user_id::text; END IF;
  BEGIN
    v := NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-mingla-rsvp-client';
  EXCEPTION WHEN others THEN
    v := NULL;
  END;
  RETURN CASE WHEN v ~ '^[0-9a-f]{64}$' THEN 'ip:' || v ELSE 'ip:unknown' END;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_inviter_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_inviter_key(uuid) TO service_role;

-- P1-2: the guest-number caps, checked after this request's rows are logged.
--   20 numbers per inviter per rolling 24 hours (signed in or not);
--   30 numbers per event per 24 hours from signed-out inviters altogether.
CREATE OR REPLACE FUNCTION public.rsvp_guest_assert_caps(p_inviter_key text, p_event_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.rsvp_guest_invite_log l
       WHERE l.inviter_key = p_inviter_key
         AND l.created_at > now() - interval '24 hours') > 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4508', MESSAGE = 'rsvp_guest_daily_cap';
  END IF;
  IF p_inviter_key LIKE 'ip:%' AND (SELECT count(*) FROM public.rsvp_guest_invite_log l
       WHERE l.event_id = p_event_id AND l.inviter_key LIKE 'ip:%'
         AND l.created_at > now() - interval '24 hours') > 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4508', MESSAGE = 'rsvp_guest_daily_cap';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_assert_caps(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_assert_caps(text, uuid) TO service_role;

-- P1-2: a number gets at most 3 guest-invite texts per 24 hours across every
-- event and inviter. Past that the guest is still added (the spot is held)
-- but not texted (sms_hold = number_limit). Counted before this add is logged.
CREATE OR REPLACE FUNCTION public.rsvp_guest_number_over_limit(p_digits text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT (SELECT count(*) FROM public.rsvp_guest_invite_log l
           WHERE l.phone_digits = p_digits
             AND l.created_at > now() - interval '24 hours') >= 3;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_number_over_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_number_over_limit(text) TO service_role;

-- R-14: callers take this transaction lock on a number before counting its
-- invites, so two submits on different events cannot both read "2" and both
-- text. Numbers are always locked in ascending key order (no deadlock).
CREATE OR REPLACE FUNCTION public.rsvp_guest_lock_numbers(p_digits text[])
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key integer;
BEGIN
  FOR v_key IN
    SELECT DISTINCT hashtext('rsvp_guest_number:' || d)
      FROM unnest(coalesce(p_digits, '{}'::text[])) d
     WHERE d IS NOT NULL AND d <> ''
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(4508, v_key);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_lock_numbers(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_lock_numbers(text[]) TO service_role;

-- R-4: a ceiling on guests texted for signed-out inviters across every event,
-- per rolling 24 hours. Past it a signed-out guest is still added but not
-- texted (sms_hold = number_limit), so a burst across many open events cannot
-- run up an unbounded SMS bill. Signed-in inviters are not counted here.
CREATE OR REPLACE FUNCTION public.rsvp_guest_signed_out_text_ceiling_reached()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT (SELECT count(*) FROM public.rsvp_guest_invite_log l
           WHERE l.inviter_key LIKE 'ip:%'
             AND l.created_at > now() - interval '24 hours') >= 300;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_signed_out_text_ceiling_reached() IS
  '#4508 R-4: true once 300 guests were added by signed-out inviters in the last 24 hours, across all events.';
REVOKE ALL ON FUNCTION public.rsvp_guest_signed_out_text_ceiling_reached() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_signed_out_text_ceiling_reached() TO service_role;

-- N-8: the ceiling is counted under one transaction lock, held to commit, so
-- two signed-out submits can never both read 299 and both text. Taken after
-- the number locks (rsvp_guest_lock_numbers), always in that order.
CREATE OR REPLACE FUNCTION public.rsvp_guest_lock_signed_out_ceiling()
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(45084, 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_lock_signed_out_ceiling() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_lock_signed_out_ceiling() TO service_role;

-- N-8: is this signed-out guest held by the ceiling? The first hold of a UTC
-- day records that day for one ops alert. Call with the ceiling lock held.
CREATE OR REPLACE FUNCTION public.rsvp_guest_signed_out_ceiling_holds()
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.rsvp_guest_signed_out_text_ceiling_reached() THEN
    RETURN false;
  END IF;
  INSERT INTO public.rsvp_guest_signed_out_ceiling_hits(hit_day)
  VALUES ((now() AT TIME ZONE 'UTC')::date)
  ON CONFLICT (hit_day) DO NOTHING;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_signed_out_ceiling_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_signed_out_ceiling_holds() TO service_role;

-- N-8: ceiling days not yet reported; rsvp-notify sends one ops alert and
-- only after it went out marks the day reported (a failed alert retries on
-- the next tick).
CREATE OR REPLACE FUNCTION public.issue_4508_list_ceiling_hits()
RETURNS TABLE (hit_day date, first_hit_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT h.hit_day, h.first_hit_at
    FROM public.rsvp_guest_signed_out_ceiling_hits h
   WHERE h.reported_at IS NULL
   ORDER BY h.hit_day;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_list_ceiling_hits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_list_ceiling_hits() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4508_mark_ceiling_hit_reported(p_hit_day date)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.rsvp_guest_signed_out_ceiling_hits h
     SET reported_at = now()
   WHERE h.hit_day = p_hit_day AND h.reported_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_mark_ceiling_hit_reported(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_mark_ceiling_hit_reported(date) TO service_role;

-- R-1 / N-2: counts a signed-out caller's guest numbers BEFORE the submit, in
-- a transaction of its own, so a refused (rolled back) submit still counts
-- against that caller. The caller is the salted address hash
-- public-submit-rsvp sends in the x-mingla-rsvp-client header
-- (rsvp_guest_inviter_key). Refuses, writing nothing, when this would take
-- the address past 20 guest numbers across all events in 24 hours. Only the
-- caller's own allowance is counted here: the event's 30-a-day allowance for
-- signed-out inviters counts accepted invites inside the submit
-- (rsvp_guest_assert_caps), so refused attempts from one caller cannot use up
-- an event's allowance for everyone else.
CREATE OR REPLACE FUNCTION public.rsvp_guest_signed_out_attempt(
  p_event_id uuid, p_guest_count integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_key text := public.rsvp_guest_inviter_key(NULL);
  v_count integer := GREATEST(coalesce(p_guest_count, 0), 0);
BEGIN
  IF v_count = 0 OR p_event_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
    -- Nothing to count; the submit refuses an unknown event by itself.
    RETURN jsonb_build_object('allowed', true, 'counted', false);
  END IF;
  PERFORM pg_advisory_xact_lock(45081, hashtext(v_key));
  IF (SELECT coalesce(sum(a.guest_count), 0) FROM public.rsvp_guest_signed_out_attempts a
       WHERE a.inviter_key = v_key
         AND a.created_at > now() - interval '24 hours') + v_count > 20 THEN
    RETURN jsonb_build_object('allowed', false, 'counted', false);
  END IF;
  INSERT INTO public.rsvp_guest_signed_out_attempts(inviter_key, event_id, guest_count)
  VALUES (v_key, p_event_id, v_count);
  RETURN jsonb_build_object('allowed', true, 'counted', true);
END;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_signed_out_attempt(uuid, integer) IS
  '#4508 R-1 / N-2: counts a signed-out caller''s guest numbers before the submit (its own transaction), so refused submits count against that caller''s 20-per-address daily cap. Per caller only; the per-event allowance counts accepted invites inside the submit.';
REVOKE ALL ON FUNCTION public.rsvp_guest_signed_out_attempt(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_signed_out_attempt(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Close friends through an RSVP do not use the pairing allowance (D1).
--    check_pairing_allowed: baseline 20260505000000 line 3877; only the count
--    changes (it skips source = 'rsvp_guest'). search_path as #4423 W5 set it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_pairing_allowed(p_user_id uuid)
RETURNS TABLE(allowed boolean, current_count integer, max_allowed integer, tier text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_tier TEXT; v_limits JSONB; v_max INTEGER; v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  v_max := (v_limits->>'max_pairings')::INTEGER;
  SELECT COUNT(*) INTO v_count FROM pairings
   WHERE (user_a_id = p_user_id OR user_b_id = p_user_id)
     AND source <> 'rsvp_guest';
  IF v_max = -1 THEN allowed := true; ELSE allowed := (v_count < v_max); END IF;
  current_count := v_count; max_allowed := v_max; tier := v_tier;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Friendship on claim (1.21, 1.22). Reuses the friend and pairing tables
--    exactly as accept_friend_request_atomic / accept_pair_request_atomic
--    write them; never touches a block, never deletes one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4508_connect_rsvp_pair(
  p_inviter uuid, p_guest_user uuid, p_guest_id uuid, p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_a uuid;
  v_b uuid;
  v_pairing uuid;
  v_request uuid;
  v_already boolean;
  v_outcome text;
BEGIN
  IF p_inviter IS NULL OR p_guest_user IS NULL OR p_inviter = p_guest_user THEN
    RETURN jsonb_build_object('friendship', 'none', 'closeFriend', false);
  END IF;

  IF public.has_block_between(p_inviter, p_guest_user) OR EXISTS (
    SELECT 1 FROM public.friends f
     WHERE f.status = 'blocked' AND f.deleted_at IS NULL
       AND ((f.user_id = p_inviter AND f.friend_user_id = p_guest_user)
         OR (f.user_id = p_guest_user AND f.friend_user_id = p_inviter))
  ) THEN
    INSERT INTO public.rsvp_guest_connections(guest_id, event_id, inviter_user_id,
      guest_user_id, outcome)
    VALUES (p_guest_id, p_event_id, p_inviter, p_guest_user, 'blocked')
    ON CONFLICT (guest_id) DO NOTHING;
    RETURN jsonb_build_object('friendship', 'blocked', 'closeFriend', false);
  END IF;

  v_already := EXISTS (
    SELECT 1 FROM public.friends WHERE user_id = p_inviter AND friend_user_id = p_guest_user
       AND status = 'accepted' AND deleted_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.friends WHERE user_id = p_guest_user AND friend_user_id = p_inviter
       AND status = 'accepted' AND deleted_at IS NULL
  );

  IF NOT v_already THEN
    INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (p_inviter, p_guest_user, 'accepted'), (p_guest_user, p_inviter, 'accepted')
    ON CONFLICT (user_id, friend_user_id)
    DO UPDATE SET status = 'accepted', deleted_at = NULL, updated_at = now();
    INSERT INTO public.friend_requests (sender_id, receiver_id, status, source)
    VALUES (p_inviter, p_guest_user, 'accepted', 'rsvp_guest')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;
    -- A pending request either way is settled, as accepting would settle it.
    UPDATE public.friend_requests SET status = 'accepted', updated_at = now()
     WHERE status = 'pending'
       AND ((sender_id = p_inviter AND receiver_id = p_guest_user)
         OR (sender_id = p_guest_user AND receiver_id = p_inviter));
  END IF;

  -- Close friend: a pairing in canonical order, made free (source rsvp_guest).
  IF p_inviter < p_guest_user THEN v_a := p_inviter; v_b := p_guest_user;
  ELSE v_a := p_guest_user; v_b := p_inviter; END IF;
  SELECT id INTO v_pairing FROM public.pairings WHERE user_a_id = v_a AND user_b_id = v_b;
  IF v_pairing IS NULL THEN
    -- An active pair request either way is reused (its unique index allows
    -- one pending-or-accepted request per direction).
    SELECT pr.id INTO v_request FROM public.pair_requests pr
     WHERE pr.status IN ('pending', 'accepted')
       AND ((pr.sender_id = p_inviter AND pr.receiver_id = p_guest_user)
         OR (pr.sender_id = p_guest_user AND pr.receiver_id = p_inviter))
     ORDER BY (pr.status = 'accepted') DESC, pr.created_at
     LIMIT 1
     FOR UPDATE;
    IF v_request IS NULL THEN
      INSERT INTO public.pair_requests (sender_id, receiver_id, status, visibility)
      VALUES (p_inviter, p_guest_user, 'accepted', 'visible')
      RETURNING id INTO v_request;
    ELSE
      UPDATE public.pair_requests SET status = 'accepted', visibility = 'visible'
       WHERE id = v_request AND status = 'pending';
    END IF;
    INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id, source)
    VALUES (v_a, v_b, v_request, 'rsvp_guest')
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING
    RETURNING id INTO v_pairing;
    IF v_pairing IS NULL THEN
      SELECT id INTO v_pairing FROM public.pairings WHERE user_a_id = v_a AND user_b_id = v_b;
    END IF;
  END IF;

  v_outcome := CASE WHEN v_already THEN 'already_friends' ELSE 'connected' END;
  INSERT INTO public.rsvp_guest_connections(guest_id, event_id, inviter_user_id,
    guest_user_id, pairing_id, outcome)
  VALUES (p_guest_id, p_event_id, p_inviter, p_guest_user, v_pairing, v_outcome)
  ON CONFLICT (guest_id) DO NOTHING;

  RETURN jsonb_build_object('friendship', v_outcome, 'closeFriend', v_pairing IS NOT NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_connect_rsvp_pair(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_connect_rsvp_pair(uuid, uuid, uuid, uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 5. submit_event_rsvp (20281119004508, from 20271215004063 lines 500-772).
--    Unchanged: signature, grants, the event and #1902 gates, #1857 phone
--    authority, the #4063 anonymous guard, approval and capacity resolution,
--    the parent upsert and pass minting. Changed (marked #4508): guest
--    validation (3b), capacity counts guests a claimed guest brought, and the
--    guest child set (6) keeps rows whose number is still listed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0,
  p_guests      jsonb   DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event       public.events%ROWTYPE;
  v_master_count integer;
  v_master_end_at timestamptz;
  v_plus        integer;
  v_confirmed   integer;
  v_status      text;
  v_approval    text;
  v_name        text;
  v_existing_id uuid;
  v_guest       jsonb;
  v_guest_id    uuid;
  v_gname       text;
  v_gemail      text;
  v_gphone      text;
  v_gphone_country_iso text;
  v_token_hash  text;
  v_qr          text;
  v_primary_qr  text;
  -- #4508
  v_max_guests  integer;
  v_digits      text;
  v_seen        text[] := '{}';
  v_own         text[] := '{}';
  v_brought     integer := 0;
  v_match       uuid;
  v_kept        public.event_rsvp_guests%ROWTYPE;
  v_new_count   integer := 0;
  v_recent      integer;
  v_inviter_key text;
  v_guests_out  jsonb;
  v_seen_users  uuid[] := '{}';
  v_norm        jsonb := '[]'::jsonb;
  v_friend      uuid;
  v_prior_id    uuid;
  v_release_key text;
  v_hold        text;
  -- R-1: a signed-out caller is never told whether a number is already on
  -- this event's list (by number or by its account) or was released on it.
  -- Such a guest is answered exactly like a new number (v_quiet): counted,
  -- but no row and no text. A signed-in caller keeps the specific refusals.
  v_quiet       boolean;
  v_signed_out_guests jsonb := '[]'::jsonb;
BEGIN
  -- 1. Load + gate the event (FOR UPDATE serializes concurrent submits).
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR v_event.event_type <> 'rsvp'
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_not_open';
  END IF;

  -- #1902: preserve the deployed authoritative acquisition boundary. This
  -- precedes every validation, capacity, identity, guest, pass, and delivery write.
  SELECT count(*)::integer, max(ed.end_at)
    INTO v_master_count, v_master_end_at
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
     AND ed.is_master IS TRUE;

  IF v_master_count <> 1 OR v_master_end_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1902',
      MESSAGE = 'rsvp_date_unavailable';
  END IF;

  IF v_master_end_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1901',
      MESSAGE = 'rsvp_event_ended';
  END IF;

  IF p_rsvp_status NOT IN ('going', 'not_going', 'maybe') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  -- 2. Contact gate for link guests (anon — no user_id).
  v_name := NULLIF(btrim(COALESCE(p_guest_name, '')), '');
  IF p_user_id IS NULL THEN
    IF v_name IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
      RAISE EXCEPTION 'rsvp_contact_required';
    END IF;
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE(NULLIF(btrim(p_guest_email), ''), 'Guest');
  END IF;

  -- #1857: changed writers accept only strict E.164 and explicit ISO provenance.
  IF NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL
     AND btrim(p_guest_phone) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'rsvp_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rsvp_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'rsvp_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;

  -- #4063 W0: an anonymous submission never changes an RSVP that already exists for that email.
  IF p_user_id IS NULL AND EXISTS (
    SELECT 1
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND lower(btrim(r.guest_email)) = lower(btrim(p_guest_email))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4063',
      MESSAGE = 'rsvp_already_exists';
  END IF;

  -- 3. Clamp plus_count.
  v_plus := GREATEST(COALESCE(p_plus_count, 0), 0);
  IF v_event.rsvp_allow_plus_ones THEN
    v_plus := LEAST(v_plus, v_event.rsvp_plus_ones_max);
  ELSE
    v_plus := 0;
  END IF;


  -- #4508: the caller's existing party (if any), for the rules below that
  -- treat guests already on it differently from guests being added.
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_prior_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = p_user_id;
  END IF;
  v_release_key := public.rsvp_guest_release_key(p_user_id, v_prior_id);

  -- 3b. Per-guest validation. #4508 1.9: a guest needs only a phone number;
  --     name and email are optional (older apps still send them). C1: a
  --     signed-in inviter may instead send {userId} for a friend picked from
  --     their friends list; the server checks the friendship and resolves
  --     that account's proven number itself. The host's plus-one limit is an
  --     error, not a silent clamp. The inviter's own number (P3-6: for guests
  --     being added, not one already on the party), duplicates anywhere in
  --     the party (P3-4: including guests a claimed guest brought) and
  --     barred numbers are refused.
  IF p_rsvp_status = 'not_going' THEN
    p_guests := '[]'::jsonb;
    v_plus := 0;
  ELSE
    IF jsonb_typeof(COALESCE(p_guests, '[]'::jsonb)) <> 'array' THEN
      p_guests := '[]'::jsonb;
    END IF;
    p_guests := COALESCE(p_guests, '[]'::jsonb);
    v_max_guests := CASE WHEN v_event.rsvp_allow_plus_ones
      THEN COALESCE(v_event.rsvp_plus_ones_max, 0) ELSE 0 END;
    IF jsonb_array_length(p_guests) > v_max_guests THEN
      RAISE EXCEPTION 'rsvp_plus_ones_exceeded' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_guests) <> v_plus THEN
      RAISE EXCEPTION 'rsvp_guest_count_mismatch';
    END IF;
    v_own := public.rsvp_account_phone_digits(p_user_id);
    IF NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL THEN
      v_own := v_own || regexp_replace(p_guest_phone, '\D', '', 'g');
    END IF;
    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
      IF jsonb_typeof(v_guest) <> 'object'
         OR v_guest - ARRAY['name','email','phone','phoneCountryIso','userId'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
      END IF;
      v_friend := NULL;
      v_gphone := NULL;
      IF v_guest ? 'userId' THEN
        -- C1: {userId} alone, from a signed-in inviter, for a friend.
        IF p_user_id IS NULL
           OR v_guest - ARRAY['userId'] <> '{}'::jsonb
           OR jsonb_typeof(v_guest->'userId') <> 'string'
           OR (v_guest->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
        END IF;
        v_friend := (v_guest->>'userId')::uuid;
        IF NOT public.rsvp_guest_friend_pickable(p_user_id, v_friend) THEN
          RAISE EXCEPTION 'rsvp_guest_not_friend' USING ERRCODE = '22023';
        END IF;
        IF v_friend = ANY (v_seen_users) OR EXISTS (
          SELECT 1 FROM public.event_rsvp_guests g
           WHERE g.rsvp_id = v_prior_id AND g.brought_by_guest_id IS NOT NULL
             AND g.matched_user_id = v_friend) THEN
          RAISE EXCEPTION 'rsvp_guest_duplicate' USING ERRCODE = '22023';
        END IF;
        v_seen_users := v_seen_users || v_friend;
        v_gphone := public.rsvp_account_proven_phone(v_friend);
      ELSE
        IF NULLIF(btrim(COALESCE(v_guest->>'phone', '')), '') IS NULL THEN
          RAISE EXCEPTION 'rsvp_guest_contact_required';
        END IF;
        IF btrim(v_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$' THEN
          RAISE EXCEPTION 'rsvp_guest_phone_invalid' USING ERRCODE = '22023';
        END IF;
        IF (v_guest ? 'name' AND jsonb_typeof(v_guest->'name') NOT IN ('string', 'null'))
           OR length(btrim(COALESCE(v_guest->>'name', ''))) > 120 THEN
          RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
        END IF;
        IF NULLIF(btrim(COALESCE(v_guest->>'email', '')), '') IS NOT NULL
           AND (btrim(v_guest->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
             OR length(btrim(v_guest->>'email')) > 254) THEN
          RAISE EXCEPTION 'rsvp_guest_email_invalid' USING ERRCODE = '22023';
        END IF;
        IF v_guest ? 'phoneCountryIso'
           AND jsonb_typeof(v_guest->'phoneCountryIso') <> 'null'
           AND (jsonb_typeof(v_guest->'phoneCountryIso') <> 'string'
             OR (v_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$') THEN
          RAISE EXCEPTION 'rsvp_guest_phone_country_invalid' USING ERRCODE = '22023';
        END IF;
        v_gphone := btrim(v_guest->>'phone');
      END IF;

      v_digits := CASE WHEN v_gphone IS NULL THEN NULL
        ELSE regexp_replace(v_gphone, '\D', '', 'g') END;
      IF v_digits IS NOT NULL THEN
        -- P3-6: an unchanged guest already on this party passes (older apps
        -- re-send the whole party); only a guest being added is refused.
        IF v_digits = ANY (v_own) AND NOT EXISTS (
          SELECT 1 FROM public.event_rsvp_guests g
           WHERE g.rsvp_id = v_prior_id AND g.brought_by_guest_id IS NULL
             AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = v_digits) THEN
          RAISE EXCEPTION 'rsvp_guest_own_number' USING ERRCODE = '22023';
        END IF;
        IF v_digits = ANY (v_seen) OR EXISTS (
          SELECT 1 FROM public.event_rsvp_guests g
           WHERE g.rsvp_id = v_prior_id AND g.brought_by_guest_id IS NOT NULL
             AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = v_digits) THEN
          RAISE EXCEPTION 'rsvp_guest_duplicate' USING ERRCODE = '22023';
        END IF;
        -- R-1: signed out, a released number is answered like a new one below.
        IF p_user_id IS NOT NULL
           AND public.rsvp_guest_number_barred(p_event_id, v_digits, v_release_key) THEN
          RAISE EXCEPTION 'rsvp_guest_released' USING ERRCODE = '22023';
        END IF;
        v_seen := v_seen || v_digits;
      END IF;
      v_norm := v_norm || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'userId', v_friend,
        'phone', v_gphone,
        'phoneCountryIso', CASE WHEN v_friend IS NULL
          THEN NULLIF(v_guest->>'phoneCountryIso', '') END,
        'name', CASE WHEN v_friend IS NULL
          THEN NULLIF(btrim(COALESCE(v_guest->>'name', '')), '') END,
        'email', CASE WHEN v_friend IS NULL
          THEN NULLIF(btrim(COALESCE(v_guest->>'email', '')), '') END)));
    END LOOP;
  END IF;

  -- #4508 2.5: guests a claimed guest brought ride on this party's count.
  IF p_user_id IS NOT NULL AND p_rsvp_status <> 'not_going' THEN
    SELECT count(*)::integer INTO v_brought
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE r.event_id = p_event_id AND r.user_id = p_user_id
       AND g.brought_by_guest_id IS NOT NULL;
  END IF;

  -- 4. Resolve approval + attendance (UNCHANGED from ORCH-1150 maybe version).
  v_approval := CASE WHEN v_event.rsvp_approval_mode = 'manual' THEN 'pending' ELSE 'approved' END;

  IF p_rsvp_status = 'not_going' THEN
    v_status := 'not_going';
  ELSIF p_rsvp_status = 'maybe' THEN
    v_status := 'maybe';
    v_approval := 'approved';
  ELSIF v_event.rsvp_capacity IS NULL THEN
    v_status := 'going';
  ELSE
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND (p_user_id IS NULL OR r.user_id IS DISTINCT FROM p_user_id);
    IF (v_confirmed + 1 + v_plus + v_brought) > v_event.rsvp_capacity THEN
      IF v_event.rsvp_approval_mode = 'manual' THEN
        v_status := 'going';
      ELSIF v_event.rsvp_waitlist_enabled THEN
        v_status := 'waitlisted';
        v_approval := 'approved';
      ELSE
        RAISE EXCEPTION 'rsvp_full';
      END IF;
    ELSE
      v_status := 'going';
    END IF;
  END IF;

  -- 5. UPSERT the parent row.
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = p_user_id;
  ELSIF NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND lower(guest_email) = lower(btrim(p_guest_email));
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_rsvps
       SET rsvp_status = v_status,
           approval_status = v_approval,
           plus_count = v_plus,
           guest_name = v_name,
           guest_email = COALESCE(NULLIF(btrim(p_guest_email), ''), guest_email),
           guest_phone = COALESCE(NULLIF(btrim(p_guest_phone), ''), guest_phone),
           guest_phone_country_iso = CASE WHEN NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN guest_phone_country_iso ELSE p_guest_phone_country_iso END,
           waitlisted_at = CASE WHEN v_status = 'waitlisted' THEN COALESCE(waitlisted_at, now()) ELSE NULL END
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.event_rsvps
      (event_id, user_id, guest_name, guest_email, guest_phone, guest_phone_country_iso,
       rsvp_status, approval_status, plus_count, waitlisted_at)
    VALUES
      (p_event_id, p_user_id, v_name,
       NULLIF(btrim(p_guest_email), ''), NULLIF(btrim(p_guest_phone), ''), p_guest_phone_country_iso,
       v_status, v_approval, v_plus,
       CASE WHEN v_status = 'waitlisted' THEN now() ELSE NULL END)
    RETURNING id INTO v_existing_id;
  END IF;

  -- 6. #4508: the guest child set. A guest still listed (by number, or by
  --    account for a friend picked from the list) keeps its row (claim, pass
  --    and texts survive a re-submit); a guest no longer listed is removed; a
  --    new guest is added. Guests a claimed guest brought stay unless the
  --    party is no longer going or maybe.
  DELETE FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = v_existing_id
     AND (v_status = 'not_going'
       OR (g.brought_by_guest_id IS NULL
         AND NOT (regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = ANY (v_seen))
         AND NOT coalesce(g.added_from_friend AND g.matched_user_id = ANY (v_seen_users), false)));

  v_inviter_key := public.rsvp_guest_inviter_key(p_user_id);
  -- R-14: hold every listed number's lock until commit before any invite is
  -- counted, so concurrent submits on other events see each other's adds.
  PERFORM public.rsvp_guest_lock_numbers(v_seen);
  -- N-8: then the signed-out ceiling's lock, so it is counted atomically.
  IF p_user_id IS NULL AND jsonb_array_length(v_norm) > 0 THEN
    PERFORM public.rsvp_guest_lock_signed_out_ceiling();
  END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(v_norm) LOOP
    v_friend := NULLIF(v_guest->>'userId', '')::uuid;
    v_gname  := v_guest->>'name';
    v_gemail := v_guest->>'email';
    v_gphone := v_guest->>'phone';
    v_digits := CASE WHEN v_gphone IS NULL THEN NULL
      ELSE regexp_replace(v_gphone, '\D', '', 'g') END;
    v_gphone_country_iso := v_guest->>'phoneCountryIso';

    SELECT * INTO v_kept FROM public.event_rsvp_guests g
     WHERE g.rsvp_id = v_existing_id AND g.brought_by_guest_id IS NULL
       AND ((v_digits IS NOT NULL
             AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = v_digits)
         OR (v_friend IS NOT NULL AND g.added_from_friend AND g.matched_user_id = v_friend))
     ORDER BY g.created_at
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.event_rsvp_guests
         SET name = COALESCE(v_gname, name),
             email = COALESCE(v_gemail, email),
             phone_country_iso = COALESCE(v_gphone_country_iso, phone_country_iso)
       WHERE id = v_kept.id;
      v_guest_id := v_kept.id;
      v_qr := v_kept.qr_code;
    ELSE
      -- R-1: signed in, a number or account already on the list (or a second
      -- number of an account already in this party) is refused by name.
      -- Signed out it is answered like a new number (v_quiet below).
      v_quiet := false;
      IF v_digits IS NOT NULL
         AND public.rsvp_number_on_event_list(p_event_id, v_digits, v_existing_id) THEN
        IF p_user_id IS NOT NULL THEN
          RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
        END IF;
        v_quiet := true;
      END IF;
      IF NOT v_quiet AND p_user_id IS NULL AND v_digits IS NOT NULL
         AND public.rsvp_guest_number_barred(p_event_id, v_digits, v_release_key) THEN
        v_quiet := true;
      END IF;
      v_match := NULL;
      IF NOT v_quiet THEN
        IF v_friend IS NOT NULL THEN
          v_match := v_friend;
        ELSE
          -- #4508 0.2: never the primary's own account.
          v_match := NULLIF(public.biz_resolve_verified_user(v_gemail, v_gphone), p_user_id);
        END IF;
        IF v_match IS NOT NULL
           AND public.rsvp_user_on_event_list(p_event_id, v_match, v_existing_id) THEN
          IF p_user_id IS NOT NULL THEN
            RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
          END IF;
          v_quiet := true;
        ELSIF v_match IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.event_rsvp_guests g
           WHERE g.rsvp_id = v_existing_id AND g.matched_user_id = v_match) THEN
          IF p_user_id IS NOT NULL THEN
            RAISE EXCEPTION 'rsvp_guest_duplicate' USING ERRCODE = '22023';
          END IF;
          v_quiet := true;
        END IF;
      END IF;
      -- R-4 / N-8: past the signed-out daily ceiling the guest is held, not
      -- texted (counted under the ceiling lock; the first hold of a day is
      -- recorded for one ops alert).
      v_hold := CASE
        WHEN v_digits IS NULL THEN 'no_phone'
        WHEN public.rsvp_guest_number_over_limit(v_digits) THEN 'number_limit'
        WHEN p_user_id IS NULL
             AND public.rsvp_guest_signed_out_ceiling_holds() THEN 'number_limit'
      END;
      -- Every new number counts against the caps, a quiet one included, so
      -- the caps cannot tell the two apart either.
      IF v_digits IS NOT NULL THEN
        INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
        VALUES (v_inviter_key, p_event_id, v_digits);
      END IF;
      v_new_count := v_new_count + 1;
      IF p_user_id IS NULL THEN
        -- R-1 / R-2: what a signed-out caller is told, the same for a quiet
        -- guest and a new one: the last four digits they typed and whether a
        -- text will go (the per-number limit, the ceiling, or an opt-out).
        v_signed_out_guests := v_signed_out_guests || jsonb_build_array(jsonb_build_object(
          'guestId', NULL,
          'phoneLast4', right(v_digits, 4),
          'onMingla', false,
          'displayName', NULL,
          'claimed', false,
          'broughtByGuest', false,
          'addedFromFriend', false,
          'willText', v_hold IS NULL AND NOT public.rsvp_guest_number_suppressed(v_gphone),
          'notTextedReason', NULL));
      END IF;
      IF v_quiet THEN
        CONTINUE;
      END IF;
      INSERT INTO public.event_rsvp_guests (rsvp_id, name, email, phone, phone_country_iso,
        matched_user_id, invited_by_user_id, added_from_friend, sms_hold)
      VALUES (v_existing_id, v_gname, v_gemail, v_gphone, v_gphone_country_iso,
        v_match, p_user_id, v_friend IS NOT NULL, v_hold)
      RETURNING id INTO v_guest_id;
      v_qr := NULL;
    END IF;

    -- Mint the per-guest signed pass ONLY on a going resolution.
    IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL AND v_qr IS NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
        FROM public.biz_rsvp_mint_qr(v_guest_id, p_qr_token_pepper) m;
      UPDATE public.event_rsvp_guests
         SET qr_token_hash = v_token_hash, qr_code = v_qr
       WHERE id = v_guest_id;
    END IF;
  END LOOP;

  -- #4508 1.9 / P1-2: the guest-number caps (20 per inviter; 30 per event
  -- from signed-out inviters).
  IF v_new_count > 0 THEN
    PERFORM public.rsvp_guest_assert_caps(v_inviter_key, p_event_id);
  END IF;

  -- #4508: plus_count is the party's guest rows (the primary's and any a
  -- claimed guest brought).
  UPDATE public.event_rsvps
     SET plus_count = (SELECT count(*)::integer FROM public.event_rsvp_guests g
                        WHERE g.rsvp_id = v_existing_id)
   WHERE id = v_existing_id;

  -- 7. Mint the PRIMARY's signed pass ONLY for going, idempotent on qr_token_hash.
  v_primary_qr := NULL;
  IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
    SELECT qr_code INTO v_primary_qr FROM public.event_rsvps
     WHERE id = v_existing_id AND qr_token_hash IS NOT NULL;
    IF v_primary_qr IS NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_primary_qr
        FROM public.biz_rsvp_mint_qr(v_existing_id, p_qr_token_pepper) m;
      UPDATE public.event_rsvps
         SET qr_token_hash = v_token_hash, qr_code = v_primary_qr
       WHERE id = v_existing_id;
    END IF;
  END IF;

  -- C3: sending is asynchronous, so no send status is claimed here. A guest
  -- who will never be texted says so now (willText false, with the reason);
  -- every other guest's text is on its way. A friend picked from the list
  -- never has their number, or its last four, returned. R-2: a signed-out
  -- caller is never told whether a number has an account (onMingla false, no
  -- name) nor why a guest will not be texted (willText only).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'guestId', g.id,
           'phoneLast4', CASE WHEN g.added_from_friend OR g.phone IS NULL THEN NULL
             ELSE right(regexp_replace(g.phone, '\D', '', 'g'), 4) END,
           'onMingla', p_user_id IS NOT NULL AND g.matched_user_id IS NOT NULL,
           'displayName', CASE WHEN p_user_id IS NOT NULL
             THEN public.rsvp_guest_display_name(g.id) END,
           'claimed', g.claimed_at IS NOT NULL,
           'broughtByGuest', g.brought_by_guest_id IS NOT NULL,
           'addedFromFriend', g.added_from_friend,
           'willText', w.reason IS NULL,
           'notTextedReason', CASE WHEN p_user_id IS NOT NULL THEN w.reason END
         ) ORDER BY g.created_at, g.id), '[]'::jsonb)
    INTO v_guests_out
    FROM public.event_rsvp_guests g
    CROSS JOIN LATERAL (SELECT CASE
      WHEN g.phone IS NULL THEN 'no_phone'
      WHEN g.sms_hold IS NOT NULL THEN g.sms_hold
      WHEN public.rsvp_guest_number_suppressed(g.phone) THEN 'suppressed'
    END AS reason) w
   WHERE g.rsvp_id = v_existing_id;
  -- R-1: a signed-out caller's party is always new (#4063 W0), so every guest
  -- in it was answered in the loop, in the order sent, with no guest id: a
  -- guest id (or the invite link minted from it) would tell a new guest from
  -- a quiet one.
  IF p_user_id IS NULL THEN
    v_guests_out := v_signed_out_guests;
  END IF;

  RETURN jsonb_build_object(
    'rsvpId', v_existing_id,
    'status', v_status,
    'approvalStatus', v_approval,
    'capacityFull', (v_status = 'waitlisted'),
    'confirmationToken', v_primary_qr,
    'guests', v_guests_out
  );
END;
$$;

COMMENT ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) IS '#4063: an anonymous submission never changes an RSVP that already exists for that email. I-4063-RSVP-SUBMIT-GUARD. #4508: number-only guests, server plus-one limit, own/duplicate/listed/released numbers refused, 20 guest numbers per inviter per 24h, guest rows kept across re-submits.';

REVOKE ALL ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) TO service_role;


-- ---------------------------------------------------------------------------
-- 6. The guest link: resolve, release ("This isn't me"), claim, bring.
--    The token is the guest's claim-link code (claim_links, subject
--    rsvp_guest, the /c/ link texted to the guest). A code identifies a guest
--    for display; it never grants ownership: claiming needs a proven number.
--    All four are service_role only; the claim-link edge function calls them
--    (rate limits, and the signed-in user id from the verified JWT).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_guest_for_code(p_code text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT l.subject_id FROM public.claim_links l
   WHERE l.code = upper(btrim(coalesce(p_code, '')))
     AND l.purpose = 'claim' AND l.subject_kind = 'rsvp_guest'
     AND l.revoked_at IS NULL
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_for_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_for_code(text) TO service_role;

CREATE OR REPLACE FUNCTION public.rsvp_guest_resolve(p_code text, p_viewer uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_event record;
  v_inviter record;
  v_status text;
  v_public boolean;
BEGIN
  IF upper(btrim(coalesce(p_code, ''))) !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_guest FROM public.event_rsvp_guests
   WHERE id = public.rsvp_guest_for_code(p_code);
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.rsvp_guest_released_codes rc
                WHERE rc.claim_code = upper(btrim(p_code)))
    THEN RETURN jsonb_build_object('status', 'released'); END IF;
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id;
  SELECT e.id, e.title, e.slug, e.status, e.deleted_at, e.location_text, e.visibility,
         e.timezone, e.cover_media_url, e.cover_media_type,
         b.name AS brand_name, b.slug AS brand_slug,
         md.start_at, md.end_at, md.timezone AS date_timezone
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN LATERAL (
      SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master IS TRUE
       ORDER BY d.start_at, d.id LIMIT 1
    ) md ON true
   WHERE e.id = v_rsvp.event_id;
  SELECT * INTO v_inviter FROM public.rsvp_guest_inviter_names(v_guest.id);
  -- C5: the cover only for an event whose page the public can open (the same
  -- gate the public event page uses), and only an image.
  v_public := public.pg_offering_passes_visibility_gate(v_event.id, 'direct');

  v_status := CASE
    WHEN v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
      OR coalesce(v_event.end_at, v_event.start_at) < now() THEN 'ended'
    WHEN v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN 'not_eligible'
    WHEN v_guest.claimed_at IS NOT NULL THEN 'claimed'
    ELSE 'open'
  END;

  RETURN jsonb_build_object(
    'status', v_status,
    'guestId', v_guest.id,
    'rsvpId', v_rsvp.id,
    'inviterName', coalesce(v_inviter.label, 'A friend'),
    'inviterFirstName', v_inviter.first_name,
    'inviterHasAccount', v_inviter.inviter_user_id IS NOT NULL,
    'phoneLast4', CASE WHEN v_guest.added_from_friend OR v_guest.phone IS NULL THEN NULL
      ELSE right(regexp_replace(v_guest.phone, '\D', '', 'g'), 4) END,
    'claimedByViewer', p_viewer IS NOT NULL AND v_guest.claimed_at IS NOT NULL
      AND v_guest.matched_user_id = p_viewer,
    'viewerCanClaim', p_viewer IS NOT NULL AND v_status = 'open'
      AND p_viewer IS DISTINCT FROM v_rsvp.user_id
      AND p_viewer IS DISTINCT FROM v_inviter.inviter_user_id
      AND CASE WHEN v_guest.added_from_friend THEN v_guest.matched_user_id = p_viewer
        ELSE public.account_owns_contact(p_viewer, NULL, v_guest.phone) END,
    'viewerIsInviter', p_viewer IS NOT NULL
      AND (p_viewer = v_rsvp.user_id OR p_viewer = v_inviter.inviter_user_id),
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', v_event.title,
      'startsAt', v_event.start_at,
      'endsAt', v_event.end_at,
      'timezone', coalesce(v_event.date_timezone, v_event.timezone),
      'venueLine', v_event.location_text,
      'brandName', v_event.brand_name,
      'eventUrl', CASE WHEN v_event.brand_slug IS NOT NULL AND v_event.slug IS NOT NULL
        THEN 'https://host.usemingla.com/e/' || v_event.brand_slug || '/' || v_event.slug END,
      'coverImageUrl', CASE WHEN v_public
          AND NULLIF(btrim(coalesce(v_event.cover_media_url, '')), '') IS NOT NULL
          AND coalesce(v_event.cover_media_type, 'image') = 'image'
        THEN v_event.cover_media_url END
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_resolve(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_resolve(text, uuid) TO service_role;

-- 1.18 "This isn't me": frees the spot, stops texts to the number from this
-- inviter, and returns the inviter so the caller can tell them in-app.
-- P3-1: a text already claimed by the worker but not yet handed to the
-- provider is closed too; the worker's pre-send mark then refuses it.
-- P3-8: the bar is on this inviter; a second release bars the whole event.
CREATE OR REPLACE FUNCTION public.rsvp_guest_release(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_inviter record;
  v_title text;
  v_digits text;
  v_key text;
  v_release uuid;
BEGIN
  SELECT * INTO v_guest FROM public.event_rsvp_guests
   WHERE id = public.rsvp_guest_for_code(p_code)
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.rsvp_guest_released_codes rc
                WHERE rc.claim_code = upper(btrim(coalesce(p_code, ''))))
    THEN RETURN jsonb_build_object('outcome', 'already_released'); END IF;
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_claimed');
  END IF;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id FOR UPDATE;
  SELECT * INTO v_inviter FROM public.rsvp_guest_inviter_names(v_guest.id);
  SELECT title INTO v_title FROM public.events WHERE id = v_rsvp.event_id;
  v_digits := regexp_replace(coalesce(v_guest.phone, ''), '\D', '', 'g');
  v_key := public.rsvp_guest_release_key(v_inviter.inviter_user_id, v_rsvp.id);

  IF v_digits ~ '^[0-9]{7,15}$' THEN
    INSERT INTO public.rsvp_guest_releases(event_id, rsvp_id, phone_digits,
      inviter_user_id, claim_code, inviter_keys)
    VALUES (v_rsvp.event_id, v_rsvp.id, v_digits, v_inviter.inviter_user_id,
      upper(btrim(p_code)), ARRAY[v_key])
    ON CONFLICT (event_id, phone_digits) DO UPDATE
      SET released_at = now(), claim_code = EXCLUDED.claim_code,
          release_count = public.rsvp_guest_releases.release_count
            + CASE WHEN v_key = ANY (public.rsvp_guest_releases.inviter_keys) THEN 0 ELSE 1 END,
          inviter_keys = CASE WHEN v_key = ANY (public.rsvp_guest_releases.inviter_keys)
            THEN public.rsvp_guest_releases.inviter_keys
            ELSE public.rsvp_guest_releases.inviter_keys || v_key END
    RETURNING id INTO v_release;
    INSERT INTO public.rsvp_guest_released_codes(claim_code, release_id)
    VALUES (upper(btrim(p_code)), v_release)
    ON CONFLICT (claim_code) DO NOTHING;
  END IF;

  -- No further texts: every queued delivery for this guest is closed,
  -- including one the worker holds but has not yet handed to the provider.
  UPDATE public.rsvp_notification_deliveries d
     SET status = 'failed_terminal', safe_error_code = 'rsvp_guest_released',
         processing_started_at = NULL, lease_id = NULL, updated_at = now()
    FROM public.rsvp_notifications n
   WHERE d.notification_id = n.id
     AND n.payload->>'guestId' = v_guest.id::text
     AND (d.status IN ('pending', 'failed_retryable', 'deferred')
       OR (d.status = 'processing' AND d.provider_io_started_at IS NULL));
  UPDATE public.claim_links SET revoked_at = now()
   WHERE purpose = 'claim' AND subject_kind = 'rsvp_guest'
     AND subject_id = v_guest.id AND revoked_at IS NULL;

  DELETE FROM public.event_rsvp_guests WHERE id = v_guest.id;
  UPDATE public.event_rsvps
     SET plus_count = (SELECT count(*)::integer FROM public.event_rsvp_guests g
                        WHERE g.rsvp_id = v_rsvp.id)
   WHERE id = v_rsvp.id;

  RETURN jsonb_build_object(
    'outcome', 'released',
    'eventId', v_rsvp.event_id,
    'eventTitle', v_title,
    'inviterUserId', v_inviter.inviter_user_id,
    'phoneLast4', CASE WHEN v_guest.added_from_friend THEN NULL ELSE NULLIF(right(v_digits, 4), '') END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_release(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_release(text) TO service_role;

-- 1.19-1.22 Claim. One tap when the account has proved the invited number
-- (account_owns_contact); otherwise phone_unproved, and the app proves the
-- number with send-otp / verify-otp first. A code proved for a DIFFERENT
-- number never claims. P2-1: a row matched to an account that does not own
-- the number (an old email match) goes to the proven claimer. C1: a friend
-- picked from the list is matched by account, so that account claims it.
-- P3-2: nothing is claimed after the event has ended.
CREATE OR REPLACE FUNCTION public.rsvp_guest_claim(
  p_user_id uuid, p_code text, p_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_end timestamptz;
  v_inviter record;
  v_name text := NULLIF(btrim(coalesce(p_name, '')), '');
  v_friend jsonb;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023'; END IF;
  IF v_name IS NOT NULL AND length(v_name) > 120 THEN
    RAISE EXCEPTION 'rsvp_guest_name_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_guest FROM public.event_rsvp_guests
   WHERE id = public.rsvp_guest_for_code(p_code)
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.rsvp_guest_released_codes rc
                WHERE rc.claim_code = upper(btrim(coalesce(p_code, ''))))
    THEN RETURN jsonb_build_object('outcome', 'released'); END IF;
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id;
  SELECT coalesce(max(d.end_at), max(d.start_at)) INTO v_end
    FROM public.event_dates d WHERE d.event_id = v_event.id AND d.is_master IS TRUE;
  IF v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
     OR v_end IS NULL OR v_end <= now() THEN
    RETURN jsonb_build_object('outcome', 'ended');
  END IF;
  IF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('outcome', 'ineligible');
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_guest.matched_user_id = p_user_id
        THEN 'already_claimed' ELSE 'claimed_by_other' END,
      'guestId', v_guest.id, 'rsvpId', v_rsvp.id, 'eventId', v_rsvp.event_id);
  END IF;
  SELECT * INTO v_inviter FROM public.rsvp_guest_inviter_names(v_guest.id);
  IF p_user_id = v_rsvp.user_id OR p_user_id = v_inviter.inviter_user_id THEN
    RETURN jsonb_build_object('outcome', 'own_party');
  END IF;
  IF public.rsvp_user_on_event_list(v_rsvp.event_id, p_user_id, NULL)
     AND v_guest.matched_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('outcome', 'already_on_list');
  END IF;
  IF v_guest.added_from_friend THEN
    -- C1: the inviter chose this account; only it may claim the pass.
    IF v_guest.matched_user_id IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('outcome', 'claimed_by_other',
        'guestId', v_guest.id, 'rsvpId', v_rsvp.id, 'eventId', v_rsvp.event_id);
    END IF;
  ELSE
    IF NOT public.account_owns_contact(p_user_id, NULL, v_guest.phone) THEN
      RETURN jsonb_build_object(
        'outcome', 'phone_unproved',
        'phoneLast4', right(regexp_replace(coalesce(v_guest.phone, ''), '\D', '', 'g'), 4));
    END IF;
    -- P2-1: a row matched to another account that has NOT proved this number
    -- (for example an old email match) is taken by the proven claimer. Two
    -- accounts that both proved it are a real conflict.
    IF v_guest.matched_user_id IS NOT NULL AND v_guest.matched_user_id <> p_user_id
       AND public.account_owns_contact(v_guest.matched_user_id, NULL, v_guest.phone) THEN
      RAISE EXCEPTION 'conflict_rsvp_guest_claim' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  UPDATE public.event_rsvp_guests
     SET matched_user_id = p_user_id,
         claimed_at = now(),
         name = COALESCE(v_name, name)
   WHERE id = v_guest.id;

  -- 1.21 Only now: friends and close friends, free (D1, D2).
  v_friend := public.issue_4508_connect_rsvp_pair(
    v_inviter.inviter_user_id, p_user_id, v_guest.id, v_rsvp.event_id);

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'guestId', v_guest.id,
    'rsvpId', v_rsvp.id,
    'eventId', v_rsvp.event_id,
    'inviterUserId', v_inviter.inviter_user_id,
    'inviterName', coalesce(v_inviter.label, 'A friend'),
    'friendship', v_friend->>'friendship',
    'closeFriend', coalesce((v_friend->>'closeFriend')::boolean, false)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_claim(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_claim(uuid, text, text) TO service_role;

-- Amendment 4: the live match under the number field.
-- P1-1: a signed-out caller learns only whether the number is valid. A
-- signed-in caller learns whether it is theirs and, when it belongs to an
-- account (blocks hide it), that account's public name. alreadyOnList and
-- released are answered only for an event the caller can RSVP to now.
CREATE OR REPLACE FUNCTION public.rsvp_guest_lookup(
  p_viewer uuid, p_event_id uuid, p_phone text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_user uuid;
  v_profile jsonb;
  v_open boolean;
  v_party uuid;
BEGIN
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  IF p_viewer IS NULL THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  v_open := public.rsvp_event_open_for_viewer(p_event_id, p_viewer);
  IF v_digits = ANY (public.rsvp_account_phone_digits(p_viewer)) THEN
    RETURN jsonb_strip_nulls(jsonb_build_object('valid', true, 'isYou', true, 'onMingla', true,
      'alreadyOnList', CASE WHEN v_open THEN false END,
      'released', CASE WHEN v_open THEN false END));
  END IF;
  v_user := public.biz_resolve_verified_user(NULL, v_phone);
  IF v_user IS NOT NULL AND (
    public.has_block_between(p_viewer, v_user) OR EXISTS (
      SELECT 1 FROM public.friends f
       WHERE f.status = 'blocked' AND f.deleted_at IS NULL
         AND ((f.user_id = p_viewer AND f.friend_user_id = v_user)
           OR (f.user_id = v_user AND f.friend_user_id = p_viewer)))
  ) THEN
    v_user := NULL;
  END IF;
  IF v_user IS NOT NULL THEN
    SELECT jsonb_build_object(
             'id', p.id,
             'displayName', coalesce(NULLIF(btrim(p.display_name), ''),
               NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')),
             'username', p.username,
             'avatarUrl', p.avatar_url)
      INTO v_profile FROM public.profiles p WHERE p.id = v_user;
  END IF;
  IF v_open THEN
    SELECT r.id INTO v_party FROM public.event_rsvps r
     WHERE r.event_id = p_event_id AND r.user_id = p_viewer LIMIT 1;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'valid', true,
    'isYou', false,
    'onMingla', v_user IS NOT NULL,
    'alreadyOnList', CASE WHEN v_open THEN
      public.rsvp_number_on_event_list(p_event_id, v_digits, v_party)
      OR (v_user IS NOT NULL AND public.rsvp_user_on_event_list(p_event_id, v_user, v_party))
    END,
    'released', CASE WHEN v_open THEN
      public.rsvp_guest_number_barred(p_event_id, v_digits,
        public.rsvp_guest_release_key(p_viewer, v_party))
    END,
    'user', v_profile
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_lookup(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_lookup(uuid, uuid, text) TO service_role;

-- The daily ceiling on the signed-in lookup: 200 per account per rolling 24
-- hours, counted only for lookups the per-minute limit let through. Answers
-- {allowed, hits, limit} like the per-minute counter, so the edge function
-- returns the same rate_limited refusal. A refused call writes nothing.
CREATE OR REPLACE FUNCTION public.rsvp_guest_lookup_day_hit(
  p_user_id uuid, p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit integer := GREATEST(1, coalesce(p_limit, 200));
  v_hits integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'rate_limit_scope_required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(45083, hashtext(p_user_id::text));
  DELETE FROM public.rsvp_guest_lookup_log
   WHERE user_id = p_user_id AND created_at <= now() - interval '24 hours';
  SELECT count(*) INTO v_hits FROM public.rsvp_guest_lookup_log WHERE user_id = p_user_id;
  IF v_hits >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'hits', v_hits, 'limit', v_limit);
  END IF;
  INSERT INTO public.rsvp_guest_lookup_log(user_id) VALUES (p_user_id);
  RETURN jsonb_build_object('allowed', true, 'hits', v_hits + 1, 'limit', v_limit);
END;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_lookup_day_hit(uuid, integer) IS
  '#4508: per-account daily ceiling (200 per rolling 24 hours) on the signed-in guest lookup. Returns {allowed,hits,limit}.';
REVOKE ALL ON FUNCTION public.rsvp_guest_lookup_day_hit(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_lookup_day_hit(uuid, integer) TO service_role;

-- 2.5 A claimed guest brings one more person (host setting, default off).
-- Same rules as a submit: P3-2 not after the event ended, P3-3 not an
-- account already on the list, the barred-number rule, the per-inviter cap
-- and the per-number text limit.
CREATE OR REPLACE FUNCTION public.rsvp_guest_bring(
  p_user_id uuid, p_guest_id uuid, p_phone text, p_phone_country_iso text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_end timestamptz;
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_confirmed integer;
  v_new uuid;
  v_match uuid;
  v_token_hash text;
  v_qr text;
  v_key text;
BEGIN
  IF p_user_id IS NULL OR p_guest_id IS NULL THEN
    RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023';
  END IF;
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'rsvp_guest_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_phone_country_iso IS NOT NULL AND p_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rsvp_guest_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  v_digits := regexp_replace(v_phone, '\D', '', 'g');

  SELECT r.* INTO v_rsvp FROM public.event_rsvps r
    JOIN public.event_rsvp_guests g ON g.rsvp_id = r.id
   WHERE g.id = p_guest_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  -- Same lock order as submit_event_rsvp: the event first.
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id FOR UPDATE;
  SELECT * INTO v_guest FROM public.event_rsvp_guests WHERE id = p_guest_id FOR UPDATE;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id FOR UPDATE;
  SELECT coalesce(max(d.end_at), max(d.start_at)) INTO v_end
    FROM public.event_dates d WHERE d.event_id = v_event.id AND d.is_master IS TRUE;

  IF v_guest.matched_user_id IS DISTINCT FROM p_user_id OR v_guest.claimed_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_your_pass');
  END IF;
  IF NOT v_event.rsvp_guests_can_bring THEN
    RETURN jsonb_build_object('outcome', 'not_allowed');
  END IF;
  IF v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
     OR v_end IS NULL OR v_end <= now() THEN
    RETURN jsonb_build_object('outcome', 'ended');
  END IF;
  IF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('outcome', 'ineligible');
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_rsvp_guests b WHERE b.brought_by_guest_id = v_guest.id) THEN
    RETURN jsonb_build_object('outcome', 'already_brought');
  END IF;
  IF v_digits = ANY (public.rsvp_account_phone_digits(p_user_id)) THEN
    RAISE EXCEPTION 'rsvp_guest_own_number' USING ERRCODE = '22023';
  END IF;
  v_key := 'user:' || p_user_id::text;
  IF public.rsvp_guest_number_barred(v_event.id, v_digits, v_key) THEN
    RAISE EXCEPTION 'rsvp_guest_released' USING ERRCODE = '22023';
  END IF;
  IF public.rsvp_number_on_event_list(v_event.id, v_digits, NULL) THEN
    RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
  END IF;
  v_match := NULLIF(NULLIF(public.biz_resolve_verified_user(NULL, v_phone), p_user_id), v_rsvp.user_id);
  IF v_match IS NOT NULL AND public.rsvp_user_on_event_list(v_event.id, v_match, NULL) THEN
    RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
  END IF;
  IF v_event.rsvp_capacity IS NOT NULL THEN
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = v_event.id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved';
    IF v_confirmed + 1 > v_event.rsvp_capacity THEN
      RETURN jsonb_build_object('outcome', 'rsvp_full');
    END IF;
  END IF;

  -- R-14: the number's lock before its invites are counted.
  PERFORM public.rsvp_guest_lock_numbers(ARRAY[v_digits]);
  INSERT INTO public.event_rsvp_guests (rsvp_id, phone, phone_country_iso,
    matched_user_id, invited_by_user_id, brought_by_guest_id, sms_hold)
  VALUES (v_rsvp.id, v_phone, p_phone_country_iso, v_match, p_user_id, v_guest.id,
    CASE WHEN public.rsvp_guest_number_over_limit(v_digits) THEN 'number_limit' END)
  RETURNING id INTO v_new;
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  VALUES (v_key, v_event.id, v_digits);
  PERFORM public.rsvp_guest_assert_caps(v_key, v_event.id);
  IF p_qr_token_pepper IS NOT NULL THEN
    SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
      FROM public.biz_rsvp_mint_qr(v_new, p_qr_token_pepper) m;
    UPDATE public.event_rsvp_guests SET qr_token_hash = v_token_hash, qr_code = v_qr
     WHERE id = v_new;
  END IF;
  UPDATE public.event_rsvps
     SET plus_count = (SELECT count(*)::integer FROM public.event_rsvp_guests g
                        WHERE g.rsvp_id = v_rsvp.id)
   WHERE id = v_rsvp.id;
  -- The new guest's pass text (idempotent per guest).
  PERFORM public.enqueue_rsvp_pass(v_rsvp.id, p_qr_token_pepper);
  RETURN jsonb_build_object('outcome', 'added', 'guestId', v_new, 'rsvpId', v_rsvp.id,
    'eventId', v_event.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_bring(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_bring(uuid, uuid, text, text, text) TO service_role;

-- What rsvp-notify needs to write a guest's invite or reminder text.
-- smsHold: a guest the worker must never text (no number, or the number had
-- its 3 guest invites in 24 hours).
CREATE OR REPLACE FUNCTION public.rsvp_guest_message_context(p_guest_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN g.id IS NULL THEN jsonb_build_object('exists', false)
  ELSE jsonb_build_object(
    'exists', true,
    'claimed', g.claimed_at IS NOT NULL,
    'guestId', g.id,
    'rsvpId', r.id,
    'eventId', e.id,
    'eventTitle', e.title,
    'eventStartAt', md.start_at,
    'eventTimezone', coalesce(md.timezone, e.timezone),
    'inviterLabel', coalesce(n.label, 'A friend'),
    'inviterFirstName', n.first_name,
    'smsHold', CASE WHEN g.phone IS NULL THEN 'no_phone' ELSE g.sms_hold END,
    'eligible', r.rsvp_status = 'going' AND r.approval_status = 'approved'
      AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
  ) END
    FROM (SELECT p_guest_id AS id) q
    LEFT JOIN public.event_rsvp_guests g ON g.id = q.id
    LEFT JOIN public.event_rsvps r ON r.id = g.rsvp_id
    LEFT JOIN public.events e ON e.id = r.event_id
    LEFT JOIN LATERAL (
      SELECT d.start_at, d.timezone FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master IS TRUE
       ORDER BY d.start_at, d.id LIMIT 1
    ) md ON true
    LEFT JOIN LATERAL public.rsvp_guest_inviter_names(g.id) n ON true;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_message_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_message_context(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. 2.1 Reminder: one text 23-24 hours before the start to a guest who has
--    not claimed and whose invite text was delivered. Idempotency key per
--    guest = at most one, ever. Rides the existing RSVP queue; the existing
--    every-minute rsvp-notify tick calls this before claiming deliveries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_enqueue_guest_reminders(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rsvp_notifications
    (event_id, rsvp_id, channel, recipient, status, template_key, payload,
     idempotency_key, attempt_count)
  SELECT r.event_id, r.id, NULL, NULL, 'pending', 'rsvp_guest_reminder',
         jsonb_build_object(
           'template_key', 'rsvp_guest_reminder',
           'rsvp_id', r.id,
           'event_id', r.event_id,
           'guestId', g.id,
           'role', 'guest',
           'eventName', e.title,
           'brandId', e.brand_id
         ),
         'rsvp_guest_reminder:' || g.id::text, 0
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id = g.rsvp_id
    JOIN public.events e ON e.id = r.event_id
    JOIN LATERAL (
      SELECT d.start_at FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master IS TRUE
       ORDER BY d.start_at, d.id LIMIT 1
    ) md ON true
   WHERE g.claimed_at IS NULL
     AND g.phone ~ '^\+[1-9][0-9]{7,14}$'
     AND g.created_at < now() - interval '6 hours'
     AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
     AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
     AND md.start_at > now() + interval '23 hours'
     AND md.start_at <= now() + interval '24 hours'
     AND EXISTS (
       SELECT 1 FROM public.rsvp_notifications n
         JOIN public.rsvp_notification_deliveries d
           ON d.notification_id = n.id AND d.channel = 'sms' AND d.status = 'sent'
        WHERE n.rsvp_id = r.id AND n.payload->>'guestId' = g.id::text
          AND n.template_key IN ('rsvp_pass', 'rsvp_approved', 'rsvp_waitlist_promoted')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.rsvp_notifications x
        WHERE x.idempotency_key = 'rsvp_guest_reminder:' || g.id::text
     )
   ORDER BY md.start_at, g.id
   LIMIT LEAST(GREATEST(coalesce(p_limit, 200), 1), 500)
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_enqueue_guest_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_enqueue_guest_reminders(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. 2.3 Friends see where you're going. When someone is going (approved)
--    with "Show me as going" on, each close friend gets one notice per event,
--    unless that friend turned friends_going off, is already on the list, or
--    either blocked the other. Never blocks the RSVP write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_issue_4508_friend_going()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.user_id IS NULL OR NEW.rsvp_status <> 'going'
     OR NEW.approval_status <> 'approved' OR NOT NEW.show_me_as_going THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.rsvp_status = 'going' AND OLD.approval_status = 'approved'
     AND OLD.show_me_as_going THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO public.rsvp_friend_going_notices(event_id, actor_user_id, friend_user_id)
    SELECT NEW.event_id, NEW.user_id, f.other
      FROM (
        SELECT CASE WHEN p.user_a_id = NEW.user_id THEN p.user_b_id ELSE p.user_a_id END AS other
          FROM public.pairings p
         WHERE NEW.user_id IN (p.user_a_id, p.user_b_id)
      ) f
      JOIN public.events e ON e.id = NEW.event_id
     WHERE e.visibility = 'public' AND e.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.event_id = e.id AND d.start_at > now())
       AND NOT public.has_block_between(NEW.user_id, f.other)
       AND NOT public.rsvp_user_on_event_list(NEW.event_id, f.other, NULL)
       AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np
                        WHERE np.user_id = f.other
                          AND (np.friends_going = false OR np.push_enabled = false))
    ON CONFLICT (event_id, friend_user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- P3-5: never block the RSVP, never drop the failure. It is recorded and
    -- the rsvp-notify tick raises an ops alert for it (R-5).
    INSERT INTO public.rsvp_friend_going_failures(event_id, actor_user_id, sql_state)
    VALUES (NEW.event_id, NEW.user_id, SQLSTATE);
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_issue_4508_friend_going() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4508_friend_going ON public.event_rsvps;
CREATE TRIGGER issue_4508_friend_going
AFTER INSERT OR UPDATE OF rsvp_status, approval_status, show_me_as_going, user_id
ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4508_friend_going();

-- Taken at most once (status pending -> taken in the same statement that
-- returns it), re-checking the friend's preference and list at send time.
CREATE OR REPLACE FUNCTION public.issue_4508_take_friend_going_notices(p_limit integer DEFAULT 50)
RETURNS TABLE (notice_id uuid, event_id uuid, friend_user_id uuid, actor_user_id uuid,
  actor_name text, event_title text, send boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT n.id FROM public.rsvp_friend_going_notices n
     WHERE n.status = 'pending'
     ORDER BY n.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
  ), taken AS (
    UPDATE public.rsvp_friend_going_notices n
       SET status = 'taken', taken_at = now()
      FROM due WHERE n.id = due.id
    RETURNING n.*
  )
  SELECT t.id, t.event_id, t.friend_user_id, t.actor_user_id,
         coalesce(NULLIF(btrim(p.first_name), ''),
           NULLIF(split_part(btrim(coalesce(p.display_name, '')), ' ', 1), ''),
           NULLIF(btrim(p.username), ''), 'A friend'),
         e.title,
         (e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
           AND NOT public.rsvp_user_on_event_list(t.event_id, t.friend_user_id, NULL)
           AND NOT public.has_block_between(t.actor_user_id, t.friend_user_id)
           AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np
                            WHERE np.user_id = t.friend_user_id
                              AND (np.friends_going = false OR np.push_enabled = false))
           AND EXISTS (SELECT 1 FROM public.event_rsvps r
                        WHERE r.event_id = t.event_id AND r.user_id = t.actor_user_id
                          AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
                          AND r.show_me_as_going))
    FROM taken t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p ON p.id = t.actor_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_take_friend_going_notices(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_take_friend_going_notices(integer) TO service_role;

-- P3-5 / R-5: friend-is-going enqueue failures not yet reported. rsvp-notify
-- reads them, sends ONE ops alert through the shared ops-alert helper, and
-- only after that alert went out marks them reported; a failed alert leaves
-- them unreported for the next tick (the alert's idempotency key stops a
-- repeat tick from emailing the same set twice).
DROP FUNCTION IF EXISTS public.issue_4508_take_friend_going_failures(integer);
CREATE OR REPLACE FUNCTION public.issue_4508_list_friend_going_failures(p_limit integer DEFAULT 50)
RETURNS TABLE (failure_id bigint, event_id uuid, sql_state text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT f.id, f.event_id, f.sql_state, f.created_at
    FROM public.rsvp_friend_going_failures f
   WHERE f.reported_at IS NULL
   ORDER BY f.created_at, f.id
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_list_friend_going_failures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_list_friend_going_failures(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4508_mark_friend_going_failures_reported(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.rsvp_friend_going_failures f
     SET reported_at = now()
   WHERE f.id = ANY (coalesce(p_ids, '{}'::bigint[])) AND f.reported_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_mark_friend_going_failures_reported(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_mark_friend_going_failures_reported(bigint[]) TO service_role;


-- ---------------------------------------------------------------------------
-- 9. Readers (1.11, 1.24, 1.25, 1.26).
-- fetch_user_rsvp_party_passes (20270204001447 lines 486-529): same rows and
-- grants; the guest name follows 1.11, and each row adds claimed, invited_by,
-- the invite text status and the guest's invite link. Only the party's
-- primary sees a guest's invite link and status (the Nudge and the success
-- screen); a matched guest sees only their own row, as before. C2:
-- guests_can_bring (the host's "Bring someone too" setting) on the viewer's
-- own pass rows only. A friend picked from the list never shows a number.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fetch_user_rsvp_party_passes(uuid);
CREATE FUNCTION public.fetch_user_rsvp_party_passes(p_rsvp_id uuid)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  display_name text,
  qr_code text,
  claimed boolean,
  invited_by_name text,
  invite_status text,
  invite_link text,
  phone_last4 text,
  guests_can_bring boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
  SELECT 'primary'::text, r.id,
         COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(r.guest_name,'Guest'),r.guest_name),
         r.qr_code,
         true, NULL::text, NULL::text, NULL::text, NULL::text,
         e.rsvp_guests_can_bring
    FROM public.event_rsvps r
    JOIN public.events e ON e.id=r.event_id
    LEFT JOIN public.profiles p ON p.id=r.user_id
   WHERE r.id=p_rsvp_id
     AND r.user_id=auth.uid()
     AND r.rsvp_status='going'
     AND r.approval_status='approved'
     AND r.qr_code IS NOT NULL
     AND e.deleted_at IS NULL
     AND e.status<>'cancelled'
  UNION ALL
  SELECT 'guest'::text, g.id,
         public.rsvp_guest_display_name(g.id),
         g.qr_code,
         g.claimed_at IS NOT NULL,
         (SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n),
         CASE WHEN r.user_id=auth.uid() THEN public.rsvp_guest_invite_status(g.id) END,
         CASE WHEN r.user_id=auth.uid() THEN (
           SELECT 'https://usemingla.com/c/' || l.code FROM public.claim_links l
            WHERE l.purpose='claim' AND l.subject_kind='rsvp_guest'
              AND l.subject_id=g.id AND l.revoked_at IS NULL
            ORDER BY l.created_at DESC LIMIT 1) END,
         CASE WHEN r.user_id=auth.uid() AND NOT g.added_from_friend AND g.phone IS NOT NULL
           THEN right(regexp_replace(g.phone,'\D','','g'),4) END,
         -- R-6: only a guest who has claimed the pass may bring someone.
         CASE WHEN g.matched_user_id=auth.uid() AND g.claimed_at IS NOT NULL
           THEN e.rsvp_guests_can_bring END
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id=g.rsvp_id
    JOIN public.events e ON e.id=r.event_id
   WHERE r.id=p_rsvp_id
     AND (r.user_id=auth.uid() OR g.matched_user_id=auth.uid())
     AND r.rsvp_status='going'
     AND r.approval_status='approved'
     AND g.qr_code IS NOT NULL
     AND e.deleted_at IS NULL
     AND e.status<>'cancelled'
   ORDER BY 1 DESC, 2;
$function$;
REVOKE ALL ON FUNCTION public.fetch_user_rsvp_party_passes(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_user_rsvp_party_passes(uuid)
  TO authenticated;


-- host_list_rsvp_guests (20270204001447 lines 650-679): only plus_checkins
-- changes: each guest adds invitedByName, claimed, onMingla and
-- broughtByGuestId. N-5: name is rsvp_guest_host_label (never the matched
-- account's name before the guest claims) and onMingla is true only for a
-- claimed guest. Email columns may be empty for guests.
-- Host console: preserve existing 18-column contract and append check-in truth.
CREATE OR REPLACE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
RETURNS TABLE (
  id uuid,event_id uuid,user_id uuid,guest_name text,guest_email text,guest_phone text,
  rsvp_status text,approval_status text,plus_count integer,waitlisted_at timestamptz,
  promoted_at timestamptz,created_at timestamptz,display_name text,username text,
  avatar_url text,email text,phone text,source text,checked_in_at timestamptz,
  checked_in_by uuid,plus_checked_in_count integer,plus_checkins jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND
    public.biz_brand_effective_rank(e.brand_id,auth.uid())>=public.biz_role_rank('event_manager'))
  THEN RAISE EXCEPTION 'insufficient_event_permission'; END IF;
  RETURN QUERY SELECT r.id,r.event_id,r.user_id,r.guest_name,r.guest_email,r.guest_phone,
    r.rsvp_status,r.approval_status,r.plus_count,r.waitlisted_at,r.promoted_at,r.created_at,
    COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(r.guest_name,'Guest'),r.guest_name),
    p.username,p.avatar_url,COALESCE(NULLIF(btrim(p.email),''),NULLIF(btrim(r.guest_email),'')),
    COALESCE(NULLIF(btrim(p.phone),''),NULLIF(btrim(r.guest_phone),'')),
    CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END,r.checked_in_at,r.checked_in_by,
    (SELECT count(*)::integer FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',public.rsvp_guest_host_label(g.id),
      'checkedInAt',g.checked_in_at,'checkedInBy',g.checked_in_by,
      'invitedByName',(SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n),
      'claimed',g.claimed_at IS NOT NULL,
      'onMingla',g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL,
      'broughtByGuestId',g.brought_by_guest_id,
      -- C8: the last four digits only, never the number.
      'phoneLast4',CASE WHEN g.phone IS NOT NULL
        THEN right(regexp_replace(g.phone,'\D','','g'),4) END) ORDER BY g.created_at)
      FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id),'[]'::jsonb)
  FROM public.event_rsvps r LEFT JOIN public.profiles p ON p.id=r.user_id
  WHERE r.event_id=p_event_id ORDER BY
    CASE WHEN r.approval_status='pending' THEN 0 WHEN r.rsvp_status='going' AND r.approval_status='approved' THEN 1
      WHEN r.rsvp_status='waitlisted' THEN 2 WHEN r.rsvp_status='maybe' THEN 3 ELSE 4 END,r.created_at;
END;
$$;

-- biz_rsvp_scan (20270204001447): only attendeeDisplayName and the added
-- invitedByName, claimed and phoneLast4 change. N-5: a plus-one's name is
-- rsvp_guest_host_label (never the matched account before the claim); an
-- unclaimed plus-one also gives the last four digits for the door.
CREATE OR REPLACE FUNCTION public.biz_rsvp_scan(p_event_id uuid, p_qr_payload text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  c_before constant interval := interval '120 minutes';
  c_after constant interval := interval '360 minutes';
  v_actor uuid := auth.uid(); v_match text[]; v_entity_id uuid;
  v_rsvp public.event_rsvps%ROWTYPE; v_guest public.event_rsvp_guests%ROWTYPE;
  v_event_id uuid; v_outcome text := 'not_found'; v_now timestamptz := now();
  v_next_start timestamptz; v_last_end timestamptz; v_scan_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND public.biz_brand_effective_rank(e.brand_id,v_actor)
        >= public.biz_role_rank('event_manager'))
    OR EXISTS (SELECT 1 FROM public.event_scanners es WHERE es.event_id=p_event_id
      AND es.user_id=v_actor AND es.removed_at IS NULL
      AND COALESCE((es.permissions->>'scan')::boolean,true))
    OR EXISTS (SELECT 1 FROM public.events e JOIN public.brand_team_members m ON m.brand_id=e.brand_id
      WHERE e.id=p_event_id AND m.user_id=v_actor AND m.role='scanner'
        AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'scanner_not_authorized'; END IF;

  v_match := regexp_match(COALESCE(p_qr_payload,''),
    '^mingla:v1:rsvp:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    v_entity_id := v_match[1]::uuid;
    SELECT * INTO v_rsvp FROM public.event_rsvps
      WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
    IF NOT FOUND THEN
      SELECT * INTO v_guest FROM public.event_rsvp_guests
        WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
      IF FOUND THEN SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id=v_guest.rsvp_id; END IF;
    END IF;
    IF v_rsvp.id IS NOT NULL THEN
      v_event_id := v_rsvp.event_id;
      IF v_event_id <> p_event_id THEN v_outcome := 'wrong_event';
      ELSIF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
        v_outcome := CASE WHEN v_rsvp.approval_status='denied' THEN 'revoked' ELSE 'not_eligible' END;
      ELSIF EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
        AND (e.deleted_at IS NOT NULL OR e.status='cancelled')) THEN v_outcome := 'revoked';
      ELSIF (CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END) IS NOT NULL
        THEN v_outcome := 'duplicate';
      ELSIF NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id) THEN v_outcome := 'success';
      ELSIF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id
        AND v_now BETWEEN start_at-c_before AND end_at+c_after) THEN v_outcome := 'success';
      ELSE
        SELECT min(start_at) INTO v_next_start FROM public.event_dates
          WHERE event_id=p_event_id AND start_at-c_before > v_now;
        IF v_next_start IS NOT NULL THEN v_outcome := 'not_yet_open';
        ELSE v_outcome := 'event_ended';
          SELECT max(end_at) INTO v_last_end FROM public.event_dates WHERE event_id=p_event_id;
        END IF;
      END IF;
      IF v_outcome='success' THEN
        IF v_guest.id IS NOT NULL THEN UPDATE public.event_rsvp_guests
          SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_guest.id;
        ELSE UPDATE public.event_rsvps SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_rsvp.id;
        END IF;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.rsvp_scan_events(requested_event_id,matched_event_id,rsvp_id,guest_id,
    scanner_user_id,outcome,metadata)
  VALUES(p_event_id,v_event_id,
    CASE WHEN v_guest.id IS NULL THEN v_rsvp.id ELSE NULL END,v_guest.id,v_actor,v_outcome,
    jsonb_strip_nulls(jsonb_build_object('source','scan-rsvp','nextStartAt',v_next_start,'lastEndAt',v_last_end)))
  RETURNING id INTO v_scan_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'result',v_outcome,'scanId',v_scan_id,
    'entityType',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NULL THEN 'primary' ELSE 'guest' END END,
    'entityId',CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(v_guest.id,v_rsvp.id) END,
    'attendeeDisplayName',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NOT NULL THEN public.rsvp_guest_host_label(v_guest.id)
        ELSE v_rsvp.guest_name END END,
    -- #4508 1.25: who brought an unclaimed guest, for the door.
    'invitedByName',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL THEN
      (SELECT n.label FROM public.rsvp_guest_inviter_names(v_guest.id) n) END,
    'claimed',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL THEN
      v_guest.claimed_at IS NOT NULL END,
    'phoneLast4',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL
      AND v_guest.claimed_at IS NULL AND v_guest.phone IS NOT NULL THEN
      right(regexp_replace(v_guest.phone,'\D','','g'),4) END,
    'nextStartAt',v_next_start,'lastEndAt',v_last_end,'checkedInAt',
    CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END,v_now) END));
END;
$$;
REVOKE ALL ON FUNCTION public.biz_rsvp_scan(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_rsvp_scan(uuid,text) TO authenticated;

-- C7: a host admits one plus-one by hand (an unclaimed guest who arrives with
-- the inviter has no QR on their own phone). The same people as a door scan
-- may do it, under the same rules and with the same answer shape as
-- biz_rsvp_scan; the check-in is audited in rsvp_scan_events like a scan.
-- N-9: a guest who has claimed the pass is checked in by scanning it, so this
-- answers result 'claimed' and checks nobody in (audited as not_eligible with
-- reason claimed, the outcome list of rsvp_scan_events being #1447's).
CREATE OR REPLACE FUNCTION public.host_check_in_rsvp_guest(p_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  c_before constant interval := interval '120 minutes';
  c_after constant interval := interval '360 minutes';
  v_actor uuid := auth.uid();
  v_guest public.event_rsvp_guests%ROWTYPE; v_rsvp public.event_rsvps%ROWTYPE;
  v_event_id uuid; v_outcome text; v_now timestamptz := now();
  v_next_start timestamptz; v_last_end timestamptz; v_scan_id uuid;
BEGIN
  SELECT r.event_id INTO v_event_id
    FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
   WHERE g.id = p_guest_id;
  IF v_actor IS NULL OR v_event_id IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.events e WHERE e.id=v_event_id
      AND public.biz_brand_effective_rank(e.brand_id,v_actor)
        >= public.biz_role_rank('event_manager'))
    OR EXISTS (SELECT 1 FROM public.event_scanners es WHERE es.event_id=v_event_id
      AND es.user_id=v_actor AND es.removed_at IS NULL
      AND COALESCE((es.permissions->>'scan')::boolean,true))
    OR EXISTS (SELECT 1 FROM public.events e JOIN public.brand_team_members m ON m.brand_id=e.brand_id
      WHERE e.id=v_event_id AND m.user_id=v_actor AND m.role='scanner'
        AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'scanner_not_authorized'; END IF;

  SELECT * INTO v_guest FROM public.event_rsvp_guests WHERE id=p_guest_id FOR UPDATE;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id=v_guest.rsvp_id;
  IF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    v_outcome := CASE WHEN v_rsvp.approval_status='denied' THEN 'revoked' ELSE 'not_eligible' END;
  ELSIF EXISTS (SELECT 1 FROM public.events e WHERE e.id=v_event_id
    AND (e.deleted_at IS NOT NULL OR e.status='cancelled')) THEN v_outcome := 'revoked';
  ELSIF v_guest.checked_in_at IS NOT NULL THEN v_outcome := 'duplicate';
  ELSIF v_guest.claimed_at IS NOT NULL THEN v_outcome := 'claimed';
  ELSIF NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=v_event_id) THEN v_outcome := 'success';
  ELSIF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=v_event_id
    AND v_now BETWEEN start_at-c_before AND end_at+c_after) THEN v_outcome := 'success';
  ELSE
    SELECT min(start_at) INTO v_next_start FROM public.event_dates
      WHERE event_id=v_event_id AND start_at-c_before > v_now;
    IF v_next_start IS NOT NULL THEN v_outcome := 'not_yet_open';
    ELSE v_outcome := 'event_ended';
      SELECT max(end_at) INTO v_last_end FROM public.event_dates WHERE event_id=v_event_id;
    END IF;
  END IF;
  IF v_outcome='success' THEN
    UPDATE public.event_rsvp_guests SET checked_in_at=v_now, checked_in_by=v_actor
     WHERE id=v_guest.id;
  END IF;
  INSERT INTO public.rsvp_scan_events(requested_event_id,matched_event_id,rsvp_id,guest_id,
    scanner_user_id,outcome,metadata)
  VALUES(v_event_id,v_event_id,NULL,v_guest.id,v_actor,
    CASE WHEN v_outcome='claimed' THEN 'not_eligible' ELSE v_outcome END,
    jsonb_strip_nulls(jsonb_build_object('source','host-manual','nextStartAt',v_next_start,'lastEndAt',v_last_end,
      'reason',CASE WHEN v_outcome='claimed' THEN 'claimed' END)))
  RETURNING id INTO v_scan_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'result',v_outcome,'scanId',v_scan_id,
    'entityType',CASE WHEN v_outcome IN ('success','duplicate') THEN 'guest' END,
    'entityId',CASE WHEN v_outcome IN ('success','duplicate') THEN v_guest.id END,
    'attendeeDisplayName',CASE WHEN v_outcome IN ('success','duplicate') THEN
      public.rsvp_guest_host_label(v_guest.id) END,
    'invitedByName',CASE WHEN v_outcome IN ('success','duplicate') THEN
      (SELECT n.label FROM public.rsvp_guest_inviter_names(v_guest.id) n) END,
    'nextStartAt',v_next_start,'lastEndAt',v_last_end,'checkedInAt',
    CASE WHEN v_outcome IN ('success','duplicate') THEN COALESCE(v_guest.checked_in_at,v_now) END));
END;
$$;
COMMENT ON FUNCTION public.host_check_in_rsvp_guest(uuid) IS
  '#4508 C7: a host admits one plus-one by hand (same people, rules and answer shape as biz_rsvp_scan; audited as source host-manual). N-9: a claimed guest answers result claimed and is not checked in (scan their pass).';
-- R-13: the same grants as biz_rsvp_scan. A service-role caller has no
-- auth.uid(), so it could only ever be refused; nothing calls it that way.
REVOKE ALL ON FUNCTION public.host_check_in_rsvp_guest(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.host_check_in_rsvp_guest(uuid) TO authenticated;

-- admin_list_event_rsvps (20261224000000): only plus_guests changes (1.26): the
-- host label (N-5: never the matched account's name before the claim),
-- invitedByName and claimed. Guests may have no email.
CREATE OR REPLACE FUNCTION public.admin_list_event_rsvps(
  p_event_id uuid,
  p_limit    int DEFAULT 25,
  p_offset   int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total    bigint;
  v_rows     jsonb;
  v_counts   jsonb;
  v_capacity int;
  v_headcount bigint;
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset   int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO v_total FROM public.event_rsvps r WHERE r.event_id = p_event_id;
  SELECT rsvp_capacity INTO v_capacity FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(sum(1 + COALESCE(r.plus_count, 0))
                  FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'), 0)
  INTO v_headcount
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  SELECT jsonb_build_object(
    'going',               count(*) FILTER (WHERE r.rsvp_status = 'going'),
    'not_going',           count(*) FILTER (WHERE r.rsvp_status = 'not_going'),
    'waitlisted',          count(*) FILTER (WHERE r.rsvp_status = 'waitlisted'),
    'maybe',               count(*) FILTER (WHERE r.rsvp_status = 'maybe'),
    'pending',             count(*) FILTER (WHERE r.approval_status = 'pending'),
    'approved',            count(*) FILTER (WHERE r.approval_status = 'approved'),
    'denied',              count(*) FILTER (WHERE r.approval_status = 'denied'),
    'confirmed_attending', count(*) FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'),
    'total_headcount',     v_headcount,
    'capacity',            v_capacity,
    'capacity_remaining',  CASE WHEN v_capacity IS NULL THEN NULL ELSE v_capacity - v_headcount END
  )
  INTO v_counts
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  -- ORCH-1334: LEFT JOIN profiles in the ranked CTE to resolve app-member identity
  -- (whitelisted columns only) + a source discriminator. The 'Guest' sentinel
  -- resolves to the real profile name at read time.
  WITH ranked AS (
    SELECT r.*,
           p.display_name AS profile_display_name,
           p.username     AS profile_username,
           p.avatar_url   AS profile_avatar_url,
           p.email        AS profile_email,
           p.phone        AS profile_phone,
           row_number() OVER (ORDER BY r.created_at DESC, r.id) AS rn
    FROM public.event_rsvps r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.event_id = p_event_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rsvp_id',         r.id,
      'guest_name',      r.guest_name,
      'guest_email',     r.guest_email,
      'guest_phone',     r.guest_phone,
      'user_id',         r.user_id,
      'rsvp_status',     r.rsvp_status,
      'approval_status', r.approval_status,
      'plus_count',      r.plus_count,
      'waitlisted_at',   r.waitlisted_at,
      'promoted_at',     r.promoted_at,
      'created_at',      r.created_at,
      -- ORCH-1334 appended identity/provenance keys (whitelisted profile columns).
      'display_name',    COALESCE(NULLIF(btrim(r.profile_display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name),
      'username',        r.profile_username,
      'avatar_url',      r.profile_avatar_url,
      'email',           COALESCE(NULLIF(btrim(r.profile_email), ''), NULLIF(btrim(r.guest_email), '')),
      'phone',           COALESCE(NULLIF(btrim(r.profile_phone), ''), NULLIF(btrim(r.guest_phone), '')),
      'source',          CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END,
      'plus_guests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', public.rsvp_guest_host_label(g.id), 'email', g.email, 'phone', g.phone,
          'invitedByName', (SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n),
          'claimed', g.claimed_at IS NOT NULL) ORDER BY g.created_at)
        FROM public.event_rsvp_guests g WHERE g.rsvp_id = r.id
      ), '[]'::jsonb)
    ) ORDER BY r.rn
  ), '[]'::jsonb)
  INTO v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'counts', v_counts);
END;
$$;


-- get_user_circle (20260724000005): only tier_close and its combined row
-- change (1.23: source rsvp_guest, context the event, "through {event}").
-- Return shape unchanged, so CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION public.get_user_circle(
  p_viewer_user_id uuid,
  p_limit int DEFAULT 60,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  user_id                     uuid,
  tier                        text,
  display_name                text,
  username                    text,
  avatar_url                  text,
  has_business_app            boolean,
  relationship_source         text,
  relationship_label          text,
  relationship_context_type   text,
  relationship_context_id     uuid,
  relationship_context_title  text,
  relationship_source_count   int,
  sort_score                  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR v_caller <> p_viewer_user_id THEN
    RAISE EXCEPTION 'get_user_circle: unauthorized (caller=%, requested=%)', v_caller, p_viewer_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'get_user_circle: p_limit out of range (must be 1..200)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH
  consumer_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'consumer'
  ),
  dual_app_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'business'
  ),
  event_recency AS (
    SELECT
      ed.event_id,
      MAX(COALESCE(ed.end_at, ed.start_at)) AS event_at
    FROM public.event_dates ed
    GROUP BY ed.event_id
  ),
  tier_close AS (
    SELECT
      CASE WHEN p.user_a_id = p_viewer_user_id THEN p.user_b_id ELSE p.user_a_id END AS other_id,
      EXTRACT(EPOCH FROM p.created_at)::bigint * 1000 AS rel_created_ms,
      -- #4508 1.23: a close friend made through an RSVP carries the event.
      rc.event_id AS rsvp_event_id,
      CASE WHEN rc.event_id IS NULL THEN NULL
        WHEN rce.visibility IN ('public', 'discover') THEN rce.title
        ELSE 'a private event' END AS rsvp_event_title
    FROM public.pairings p
    LEFT JOIN LATERAL (
      SELECT c.event_id FROM public.rsvp_guest_connections c
       WHERE c.pairing_id = p.id ORDER BY c.created_at LIMIT 1
    ) rc ON true
    LEFT JOIN public.events rce ON rce.id = rc.event_id
    WHERE p_viewer_user_id IN (p.user_a_id, p.user_b_id)
  ),
  tier_friend AS (
    SELECT
      f.friend_user_id AS other_id,
      EXTRACT(EPOCH FROM f.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
      AND f.friend_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
  ),
  viewer_friends AS (
    SELECT f.friend_user_id AS fid
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
  ),
  viewer_events AS (
    SELECT DISTINCT o.event_id AS eid
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.buyer_user_id = p_viewer_user_id
      AND o.payment_status = 'paid'
      AND e.deleted_at IS NULL
      AND e.event_type IN ('event', 'trip')
  ),
  tier_fof_candidates AS (
    SELECT
      f2.friend_user_id AS other_id,
      f2.user_id AS mutual_friend_id,
      COALESCE(NULLIF(TRIM(pr.display_name), ''), NULLIF(TRIM(pr.username), ''), 'a friend') AS mutual_friend_name,
      EXTRACT(EPOCH FROM f2.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f2
    JOIN public.profiles pr ON pr.id = f2.user_id
    WHERE f2.user_id IN (SELECT vf.fid FROM viewer_friends vf)
      AND f2.status = 'accepted'
      AND f2.deleted_at IS NULL
      AND f2.friend_user_id <> p_viewer_user_id
      AND f2.friend_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
      AND f2.friend_user_id NOT IN (SELECT tf.other_id FROM tier_friend tf)
  ),
  tier_fof_ranked AS (
    SELECT
      tfc.*,
      COUNT(*) OVER (PARTITION BY tfc.other_id)::int AS source_count,
      ROW_NUMBER() OVER (
        PARTITION BY tfc.other_id
        ORDER BY tfc.rel_created_ms DESC, LOWER(tfc.mutual_friend_name) ASC, tfc.mutual_friend_id ASC
      ) AS rn
    FROM tier_fof_candidates tfc
  ),
  tier_fof AS (
    SELECT
      tfr.other_id,
      tfr.rel_created_ms,
      tfr.mutual_friend_id,
      tfr.mutual_friend_name,
      tfr.source_count
    FROM tier_fof_ranked tfr
    WHERE tfr.rn = 1
  ),
  tier_coattendee_event_matches AS (
    SELECT
      o2.buyer_user_id AS other_id,
      e.id AS event_id,
      e.event_type,
      CASE
        WHEN e.visibility IN ('public', 'discover') THEN e.title
        WHEN e.event_type = 'trip' THEN 'Shared private trip'
        ELSE 'Shared private event'
      END AS safe_event_title,
      CASE
        WHEN e.event_type = 'trip' AND e.visibility IN ('public', 'discover') THEN 'Also joined ' || e.title
        WHEN e.event_type = 'trip' THEN 'Shared private trip'
        WHEN COALESCE(er.event_at, MAX(o2.created_at)) >= now() AND e.visibility IN ('public', 'discover')
          THEN 'Also going to ' || e.title
        WHEN COALESCE(er.event_at, MAX(o2.created_at)) >= now() THEN 'Shared private event'
        WHEN e.visibility IN ('public', 'discover') THEN 'Also attended ' || e.title
        ELSE 'Shared private event'
      END AS event_relationship_label,
      MAX(EXTRACT(EPOCH FROM COALESCE(er.event_at, o2.created_at))::bigint * 1000) AS rel_created_ms,
      COALESCE(er.event_at, MAX(o2.created_at)) AS event_at
    FROM public.orders o2
    JOIN public.events e ON e.id = o2.event_id
    LEFT JOIN event_recency er ON er.event_id = o2.event_id
    WHERE o2.event_id IN (SELECT ve.eid FROM viewer_events ve)
      AND e.deleted_at IS NULL
      AND e.event_type IN ('event', 'trip')
      AND o2.payment_status = 'paid'
      AND o2.buyer_user_id IS NOT NULL
      AND o2.buyer_user_id <> p_viewer_user_id
      AND o2.buyer_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
      AND o2.buyer_user_id NOT IN (SELECT tf.other_id FROM tier_friend tf)
    GROUP BY o2.buyer_user_id, e.id, e.event_type, e.title, e.visibility, er.event_at
  ),
  tier_coattendee_ranked AS (
    SELECT
      tcem.*,
      COUNT(*) OVER (PARTITION BY tcem.other_id)::int AS source_count,
      ROW_NUMBER() OVER (
        PARTITION BY tcem.other_id
        ORDER BY
          CASE WHEN tcem.event_at >= now() THEN 0 ELSE 1 END ASC,
          tcem.rel_created_ms DESC,
          LOWER(tcem.safe_event_title) ASC,
          tcem.event_id ASC
      ) AS rn
    FROM tier_coattendee_event_matches tcem
  ),
  tier_coattendee AS (
    SELECT
      tcr.other_id,
      tcr.rel_created_ms,
      tcr.event_id,
      tcr.event_type,
      tcr.safe_event_title,
      tcr.event_relationship_label,
      tcr.source_count
    FROM tier_coattendee_ranked tcr
    WHERE tcr.rn = 1
  ),
  tier_extended_sources AS (
    SELECT
      tf.other_id,
      tf.rel_created_ms,
      1 AS source_priority,
      'friend_of_friend'::text AS raw_relationship_source,
      'Friend of ' || tf.mutual_friend_name AS relationship_label,
      'user'::text AS relationship_context_type,
      tf.mutual_friend_id AS relationship_context_id,
      tf.mutual_friend_name AS relationship_context_title,
      tf.source_count AS relationship_source_count
    FROM tier_fof tf
    UNION ALL
    SELECT
      tc.other_id,
      tc.rel_created_ms,
      2 AS source_priority,
      'co_attendee'::text AS raw_relationship_source,
      tc.event_relationship_label AS relationship_label,
      tc.event_type::text AS relationship_context_type,
      tc.event_id AS relationship_context_id,
      tc.safe_event_title AS relationship_context_title,
      tc.source_count AS relationship_source_count
    FROM tier_coattendee tc
  ),
  tier_extended_ranked AS (
    SELECT
      tes.*,
      (
        SELECT COUNT(DISTINCT tes2.raw_relationship_source)
        FROM tier_extended_sources tes2
        WHERE tes2.other_id = tes.other_id
      ) AS source_type_count,
      MAX(tes.rel_created_ms) OVER (PARTITION BY tes.other_id) AS max_rel_created_ms,
      ROW_NUMBER() OVER (
        PARTITION BY tes.other_id
        ORDER BY tes.source_priority DESC, tes.rel_created_ms DESC, LOWER(tes.relationship_label) ASC, tes.relationship_context_id ASC
      ) AS rn
    FROM tier_extended_sources tes
  ),
  tier_extended AS (
    SELECT
      ter.other_id,
      ter.max_rel_created_ms AS rel_created_ms,
      CASE WHEN ter.source_type_count > 1 THEN 'mixed' ELSE ter.raw_relationship_source END AS relationship_source,
      ter.relationship_label,
      ter.relationship_context_type,
      ter.relationship_context_id,
      ter.relationship_context_title,
      ter.relationship_source_count
    FROM tier_extended_ranked ter
    WHERE ter.rn = 1
  ),
  combined AS (
    SELECT
      tc.other_id,
      'close'::text AS tier,
      tc.rel_created_ms,
      CASE WHEN tc.rsvp_event_id IS NOT NULL THEN 'rsvp_guest' ELSE 'paired' END::text AS relationship_source,
      'Close friend'::text AS relationship_label,
      CASE WHEN tc.rsvp_event_id IS NOT NULL THEN 'event' END::text AS relationship_context_type,
      tc.rsvp_event_id AS relationship_context_id,
      tc.rsvp_event_title AS relationship_context_title,
      1::int AS relationship_source_count
    FROM tier_close tc
    UNION ALL
    SELECT
      tf.other_id,
      'friend'::text AS tier,
      tf.rel_created_ms,
      'friend'::text AS relationship_source,
      'Friend'::text AS relationship_label,
      NULL::text AS relationship_context_type,
      NULL::uuid AS relationship_context_id,
      NULL::text AS relationship_context_title,
      1::int AS relationship_source_count
    FROM tier_friend tf
    UNION ALL
    SELECT
      te.other_id,
      'extended'::text AS tier,
      te.rel_created_ms,
      te.relationship_source,
      te.relationship_label,
      te.relationship_context_type,
      te.relationship_context_id,
      te.relationship_context_title,
      te.relationship_source_count
    FROM tier_extended te
  )
  SELECT
    c.other_id AS user_id,
    c.tier,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    (c.other_id IN (SELECT dau.user_id FROM dual_app_users dau)) AS has_business_app,
    c.relationship_source,
    c.relationship_label,
    c.relationship_context_type,
    c.relationship_context_id,
    c.relationship_context_title,
    c.relationship_source_count,
    ((CASE c.tier WHEN 'close' THEN 3 WHEN 'friend' THEN 2 ELSE 1 END)::bigint * (1::bigint << 50))
      + GREATEST(
          c.rel_created_ms,
          COALESCE((
            SELECT MAX(EXTRACT(EPOCH FROM COALESCE(er2.event_at, o3.created_at))::bigint * 1000)
            FROM public.orders o3
            JOIN public.events e2 ON e2.id = o3.event_id
            LEFT JOIN event_recency er2 ON er2.event_id = o3.event_id
            WHERE o3.payment_status = 'paid'
              AND o3.buyer_user_id = c.other_id
              AND e2.deleted_at IS NULL
              AND e2.event_type IN ('event', 'trip')
              AND o3.event_id IN (SELECT ve2.eid FROM viewer_events ve2)
          ), 0)
        ) AS sort_score
  FROM combined c
  JOIN public.profiles pr ON pr.id = c.other_id
  WHERE c.other_id IN (SELECT cu.user_id FROM consumer_users cu)
    AND c.other_id <> p_viewer_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.friends fb
      WHERE fb.user_id = p_viewer_user_id
        AND fb.friend_user_id = c.other_id
        AND fb.status = 'blocked'
        AND fb.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.friends rb
      WHERE rb.user_id = c.other_id
        AND rb.friend_user_id = p_viewer_user_id
        AND rb.status = 'blocked'
        AND rb.deleted_at IS NULL
    )
  ORDER BY sort_score DESC, c.other_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_circle(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_circle(uuid, int, int) TO authenticated;


-- ---------------------------------------------------------------------------
-- P3-7 fetch_user_going_rsvps (20280322004251, verbatim but for the guest
-- branch's display_name and invited_by): a number-only guest has no name, so
-- the guest row reads the 1.11 display name and the inviter label. Same
-- return shape, so CREATE OR REPLACE; grants restated as #4251 states them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)
RETURNS TABLE(rsvp_id uuid, guest_id uuid, role text, qr_code text, rsvp_status text, approval_status text, plus_count integer, display_name text, invited_by text, event_id uuid, event_title text, event_slug text, cover_media_url text, timezone text, location_text text, is_online boolean, online_url text, brand_id uuid, brand_slug text, brand_name text, master_start_at timestamp with time zone, master_end_at timestamp with time zone, created_at timestamp with time zone, cover_media_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ORCH-1392: self-scope gate. anon is revoked at the grant layer; an
  -- authenticated caller may only read their OWN rows. service_role
  -- (auth.uid() IS NULL) is the trusted edge-function path and bypasses.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id          AS rsvp_id,
    NULL::uuid    AS guest_id,
    'primary'     AS role,
    r.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name) AS display_name,
    NULL::text    AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    r.created_at,
    e.cover_media_type
  FROM public.event_rsvps r
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  LEFT JOIN public.profiles pr ON pr.id = r.user_id
  WHERE r.user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL

  UNION ALL

  SELECT
    r.id          AS rsvp_id,
    g.id          AS guest_id,
    'guest'       AS role,
    g.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    -- #4508 P3-7: the 1.11 display name (a number-only guest has no name).
    public.rsvp_guest_display_name(g.id) AS display_name,
    COALESCE((SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n), r.guest_name) AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    g.created_at,
    e.cover_media_type
  FROM public.event_rsvp_guests g
  JOIN public.event_rsvps r ON r.id = g.rsvp_id
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  LEFT JOIN public.profiles pg ON pg.id = g.matched_user_id
  WHERE g.matched_user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fetch_user_going_rsvps(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_user_going_rsvps(p_user_id uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D-2.4 / C4 peer_list_event_guests (20270810003682, verbatim but for the
-- lines marked #4508): "Brought by" on the public Who's going list. Same
-- signature and return type, so CREATE OR REPLACE keeps its grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.peer_list_event_guests(
  p_event_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_event record;
  v_limit integer;
  v_offset integer;
  v_guests json := '[]'::json;
  v_fetched integer := 0;
  v_private_others integer := 0;
  v_viewer_show boolean := NULL;
BEGIN
  -- Guard 1: authentication, before any attendance read.
  IF v_viewer IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  -- Guard 2: only a public, current offering owned by a live brand.
  SELECT e.id, e.event_type, e.status, e.theme INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public'
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live')
     AND e.event_type IN ('rsvp', 'event', 'trip', 'experience');
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_available'; END IF;

  -- Guard 3: host privacy remains absolute, even for an attendee.
  IF COALESCE(
    (v_event.theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false
  ) THEN RAISE EXCEPTION 'guest_list_private'; END IF;

  -- Guard 4: exact primary attendance. Email, phone, plus-one and transferred
  -- ticket identity are deliberately insufficient.
  IF v_event.event_type = 'rsvp' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_rsvps r
       WHERE r.event_id = v_event.id
         AND r.user_id = v_viewer
         AND r.rsvp_status = 'going'
         AND r.approval_status = 'approved'
    ) THEN RAISE EXCEPTION 'attendance_required'; END IF;
  ELSIF v_event.event_type IN ('event', 'trip', 'experience') THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.orders o
        JOIN public.tickets t ON t.order_id = o.id
       WHERE o.event_id = v_event.id
         AND o.buyer_user_id = v_viewer
         AND o.payment_status IN ('paid', 'partial_refund')
         AND t.approval_status IN ('auto', 'approved')
         AND (
           (v_event.status = 'scheduled' AND t.status = 'valid') OR
           (v_event.status = 'live' AND t.status IN ('valid', 'used'))
         )
    ) THEN RAISE EXCEPTION 'attendance_required'; END IF;
  ELSE
    RAISE EXCEPTION 'event_not_available';
  END IF;

  -- Clamp only after every disclosure guard.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH shown_guests AS (
    -- #4508 D-2.4: a plus-one is a row of their own only once claimed, while
    -- their own Show me as going is on, and with no block either way.
    SELECT g.id AS row_id, g.matched_user_id AS linked_user_id, g.created_at,
           r.id AS rsvp_id, COALESCE(g.invited_by_user_id, r.user_id) AS inviter_id
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE v_event.event_type = 'rsvp'
       AND r.event_id = v_event.id
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved'
       AND g.claimed_at IS NOT NULL
       AND g.matched_user_id IS NOT NULL
       AND g.show_me_as_going
       AND NOT public.is_blocked_by(g.matched_user_id, v_viewer)
       AND NOT public.is_blocked_by(v_viewer, g.matched_user_id)
  ), attendance AS (
    -- #4508 D-2.4: the inviter's row keeps every guest not shown on their own
    -- (headcount unchanged) and carries how many have not claimed yet.
    SELECT r.id AS row_id, r.user_id AS linked_user_id,
           (1 + r.plus_count
              - (SELECT count(*) FROM shown_guests sg WHERE sg.rsvp_id = r.id))::integer AS party_size,
           r.created_at,
           r.show_me_as_going,
           (SELECT count(*) FROM public.event_rsvp_guests ug
             WHERE ug.rsvp_id = r.id AND ug.claimed_at IS NULL)::integer AS unclaimed_count,
           NULL::uuid AS inviter_id
      FROM public.event_rsvps r
     WHERE v_event.event_type = 'rsvp'
       AND r.event_id = v_event.id
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved'
    UNION ALL
    SELECT sg.row_id, sg.linked_user_id, 1, sg.created_at, true, 0, sg.inviter_id
      FROM shown_guests sg
    UNION ALL
    SELECT o.id, o.buyer_user_id, COUNT(t.id)::integer, o.created_at,
           o.show_me_as_going, 0, NULL::uuid
      FROM public.orders o
      JOIN public.tickets t ON t.order_id = o.id
     WHERE v_event.event_type IN ('event', 'trip', 'experience')
       AND o.event_id = v_event.id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND t.approval_status IN ('auto', 'approved')
       AND (
         (v_event.status = 'scheduled' AND t.status = 'valid') OR
         (v_event.status = 'live' AND t.status IN ('valid', 'used'))
       )
     GROUP BY o.id, o.buyer_user_id, o.created_at, o.show_me_as_going
  ), user_opted AS (
    -- Per-user opt-in across every paid/RSVP attendance row for this event.
    SELECT a.linked_user_id, bool_or(a.show_me_as_going) AS opted
      FROM attendance a
     WHERE a.linked_user_id IS NOT NULL
     GROUP BY a.linked_user_id
  ), privacy_final AS (
    SELECT a.row_id, a.party_size, a.created_at, a.unclaimed_count,
           -- #4508 D-2.4: "Brought by {first name}", only when the inviter is
           -- someone this viewer may see by name (self, friend, opted in).
           CASE WHEN a.inviter_id IS NOT NULL
                 AND NOT public.is_blocked_by(a.inviter_id, v_viewer)
                 AND NOT public.is_blocked_by(v_viewer, a.inviter_id)
                 AND (a.inviter_id = v_viewer
                   OR EXISTS (
                     SELECT 1 FROM public.friends f
                      WHERE f.status = 'accepted'
                        AND f.deleted_at IS NULL
                        AND (
                          (f.user_id = v_viewer AND f.friend_user_id = a.inviter_id)
                          OR (f.friend_user_id = v_viewer AND f.user_id = a.inviter_id)
                        ))
                   OR COALESCE((SELECT uoi.opted FROM user_opted uoi
                                 WHERE uoi.linked_user_id = a.inviter_id), false))
                THEN (SELECT COALESCE(
                        public.rsvp_guest_safe_name_part(split_part(btrim(coalesce(ip.first_name, '')), ' ', 1)),
                        public.rsvp_guest_safe_name_part(split_part(btrim(coalesce(ip.display_name, '')), ' ', 1)))
                        FROM public.profiles ip WHERE ip.id = a.inviter_id)
           END AS brought_by_name,
           a.linked_user_id IS NOT NULL AS is_mingla_user,
           -- #3682 J: named when self, accepted friend, or user-level opt-in.
           a.linked_user_id IS NOT NULL AND (
             a.linked_user_id = v_viewer
             OR EXISTS (
               SELECT 1 FROM public.friends f
                WHERE f.status = 'accepted'
                  AND f.deleted_at IS NULL
                  AND (
                    (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                    OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                  )
             )
             OR COALESCE(uo.opted, false)
           ) AS is_named,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.id END AS profile_id,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.display_name END AS display_name,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.username END AS username,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.avatar_url END AS avatar_url,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.location END AS location
      FROM attendance a
      LEFT JOIN user_opted uo ON uo.linked_user_id = a.linked_user_id
      LEFT JOIN public.profiles p ON p.id = a.linked_user_id
     WHERE a.linked_user_id IS NULL OR (
       NOT public.is_blocked_by(a.linked_user_id, v_viewer)
       AND NOT public.is_blocked_by(v_viewer, a.linked_user_id)
     )
  ), ranked AS (
    SELECT p.*,
           row_number() OVER (
             ORDER BY
               CASE
                 WHEN p.is_named AND NULLIF(btrim(p.avatar_url), '') IS NOT NULL THEN 0
                 WHEN p.is_named THEN 1
                 ELSE 2
               END,
               p.created_at ASC,
               p.row_id ASC
           ) AS rn
      FROM privacy_final p
  ), page AS (
    SELECT r.*
      FROM ranked r
     WHERE r.rn > v_offset
       AND r.rn <= v_offset + v_limit + 1
  ), aggregates AS (
    SELECT
      -- Same unit as goingCount (party size / ticket count), so the sheet can
      -- say "N going · M keep it private" without mixing row counts into seats.
      (SELECT COALESCE(SUM(pf.party_size), 0)::integer
         FROM privacy_final pf WHERE NOT pf.is_named) AS private_others,
      (
        SELECT bool_or(a.show_me_as_going)
          FROM attendance a
         WHERE a.linked_user_id = v_viewer
      ) AS viewer_show,
      (SELECT COUNT(*)::integer FROM page) AS fetched
  )
  SELECT COALESCE(json_agg(json_build_object(
           'profileId', p.profile_id,
           'displayName', p.display_name,
           'username', p.username,
           'avatarUrl', p.avatar_url,
           'location', p.location,
           'isMinglaUser', p.is_mingla_user,
           'isAnonymous', NOT p.is_named,
           'partySize', p.party_size,
           'broughtByName', p.brought_by_name,
           'unclaimedGuestCount', p.unclaimed_count
         ) ORDER BY p.rn) FILTER (WHERE p.rn <= v_offset + v_limit), '[]'::json),
         ag.fetched,
         ag.private_others,
         ag.viewer_show
    INTO v_guests, v_fetched, v_private_others, v_viewer_show
    FROM aggregates ag
    LEFT JOIN page p ON true
   GROUP BY ag.fetched, ag.private_others, ag.viewer_show;

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    'returned', LEAST(v_fetched, v_limit),
    'hasMore', v_fetched > v_limit,
    'nextOffset', CASE WHEN v_fetched > v_limit THEN v_offset + v_limit ELSE NULL END,
    'guests', COALESCE(v_guests, '[]'::json),
    'privateOthersCount', COALESCE(v_private_others, 0),
    'viewerShowMeAsGoing', v_viewer_show
  );
END;
$function$;

COMMENT ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) IS
  '#871 entitled roster + #3682 Show me as going. Authed attendees only. '
  'Named rows: self, accepted friends, or show_me_as_going. Others anonymous; '
  'privateOthersCount (party/ticket seats) feeds "M keep it private". '
  '#4508 D-2.4: a claimed plus-one with Show me as going on is a row of their own '
  'with broughtByName; unclaimed plus-ones never appear and are counted as '
  'unclaimedGuestCount on the inviter''s row; the seat total is unchanged.';

-- ---------------------------------------------------------------------------
-- D-2.4 biz_set_show_me_as_going (20270810003682, verbatim but for the
-- #4508 lines): a claimed plus-one turns their own Show me as going on or
-- off with the same call. Same signature, grants kept.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_set_show_me_as_going(
  p_event_id uuid,
  p_show boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_viewer uuid := auth.uid();
  v_event record;
  v_updated integer := 0;
  v_guest_updated integer := 0;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF p_event_id IS NULL OR p_show IS NULL THEN
    RAISE EXCEPTION 'invalid_show_me_as_going' USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.event_type, e.status
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live')
     AND e.event_type IN ('rsvp', 'event', 'trip', 'experience');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_available' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.event_type = 'rsvp' THEN
    UPDATE public.event_rsvps r
       SET show_me_as_going = p_show
     WHERE r.event_id = v_event.id
       AND r.user_id = v_viewer
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    -- #4508 D-2.4: a claimed plus-one sets their own consent the same way.
    UPDATE public.event_rsvp_guests g
       SET show_me_as_going = p_show
      FROM public.event_rsvps r
     WHERE g.rsvp_id = r.id
       AND r.event_id = v_event.id
       AND g.matched_user_id = v_viewer
       AND g.claimed_at IS NOT NULL
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved';
    GET DIAGNOSTICS v_guest_updated = ROW_COUNT;
    v_updated := v_updated + v_guest_updated;
  ELSE
    UPDATE public.orders o
       SET show_me_as_going = p_show
     WHERE o.event_id = v_event.id
       AND o.buyer_user_id = v_viewer
       AND o.payment_status IN ('paid', 'partial_refund')
       AND EXISTS (
         SELECT 1
           FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND (
              (v_event.status = 'scheduled' AND t.status = 'valid')
              OR (v_event.status = 'live' AND t.status IN ('valid', 'used'))
            )
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'attendance_required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event.id,
    'showMeAsGoing', p_show
  );
END;
$f$;

-- ---------------------------------------------------------------------------
-- C6 business_update_rsvp_graph (20280521004334, verbatim but for the #4508
-- lines): the host save path persists rsvpGuestsCanBring and returns it.
-- Same signature, grants kept.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_update_rsvp_graph(p_event_id uuid, p_payload jsonb, p_reason text DEFAULT NULL::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.events%ROWTYPE; v_draft jsonb; v_patch jsonb; v_merged jsonb;
  v_theme jsonb; v_result jsonb; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE;
  v_live_payload jsonb; v_update_result jsonb; v_current_revision integer; v_expected_revision integer;
  v_suggested integer; v_minimum integer;
  v_keep_cover boolean;  -- applied-cover guard
BEGIN
  IF v_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR public.biz_brand_effective_rank(v.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_payload::text||':'||COALESCE(p_reason,''),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_update:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='update' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  IF v.status='draft' AND v.visibility='draft' THEN
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
       OR EXISTS(SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'rsvp_draft_graph_invalid';
    END IF;
    v_draft:=COALESCE(v.theme#>'{business_draft}','{}'::jsonb);
    v_patch:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
    v_current_revision:=COALESCE((v_draft->>'clientRevision')::integer,0);
    v_expected_revision:=NULLIF(p_payload->>'__expectedClientRevision','')::integer;
    IF v_expected_revision IS NOT NULL AND v_expected_revision<v_current_revision THEN
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='PT409';
    END IF;
    -- Applied-cover guard — a cover the server put on this row (a draft_auto
    -- cover-video job finishing after the host closed the sheet) must survive
    -- a save from a client that has not seen it. With `__coverBase` (the
    -- cover the client last received) it is a three-way merge: keep the
    -- stored cover when the client's cover is still its base and the server's
    -- has moved since. A client without the key falls back to: the stored
    -- cover is an applied draft_auto job's video and no save has landed since
    -- that job applied.
    v_keep_cover := (CASE WHEN p_payload ? '__coverBase' THEN
        NULLIF(p_payload->>'cover_media_url','') IS NOT DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
        AND v.cover_media_url IS DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
      ELSE
        v.cover_media_url IS NOT NULL
        AND NULLIF(p_payload->>'cover_media_url','') IS DISTINCT FROM v.cover_media_url
        AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
          WHERE j.event_id = p_event_id AND j.target_kind = 'event'
            AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
            AND j.processed_url = v.cover_media_url
            AND j.applied_at >= v.updated_at)
      END);
    v_patch:=v_patch-'__expectedClientRevision'-'__coverBase';
    v_merged:=jsonb_set(v_draft||v_patch,'{clientRevision}',to_jsonb(COALESCE(v_expected_revision,v_current_revision+1)),true);
    IF v_patch?'when' THEN v_merged:=jsonb_set(v_merged,'{when}',COALESCE(v_draft->'when','{}'::jsonb)||(v_patch->'when'),true); END IF;
    IF v_patch?'settings' THEN v_merged:=jsonb_set(v_merged,'{settings}',COALESCE(v_draft->'settings','{}'::jsonb)||(v_patch->'settings'),true); END IF;
    IF COALESCE(jsonb_array_length(COALESCE(v_merged->'tickets','[]'::jsonb)),0)<>0
       OR COALESCE((v_merged->>'isRsvp')::boolean,true)<>true THEN
      RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
    END IF;
    v_suggested:=NULLIF(v_merged->>'rsvpContributionSuggestedCents','')::integer;
    v_minimum:=NULLIF(v_merged->>'rsvpContributionMinCents','')::integer;
    IF (v_suggested IS NOT NULL AND v_suggested<=0)
       OR (v_minimum IS NOT NULL AND v_minimum<=0)
       OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
      RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
    END IF;
    v_theme:=jsonb_set(COALESCE(v.theme,'{}'::jsonb),'{business_draft}',v_merged,true);
    UPDATE public.events SET
      title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),v.title),
      description=CASE WHEN p_payload?'description' THEN NULLIF(p_payload->>'description','') ELSE v.description END,
      location_text=CASE WHEN p_payload?'location_text' THEN NULLIF(p_payload->>'location_text','') ELSE v.location_text END,
      online_url=CASE WHEN p_payload?'online_url' THEN NULLIF(p_payload->>'online_url','') ELSE v.online_url END,
      cover_media_url=CASE WHEN v_keep_cover THEN v.cover_media_url WHEN p_payload?'cover_media_url' THEN NULLIF(p_payload->>'cover_media_url','') ELSE v.cover_media_url END,
      cover_media_poster_url=CASE WHEN v_keep_cover THEN v.cover_media_poster_url WHEN p_payload?'cover_media_poster_url' THEN NULLIF(p_payload->>'cover_media_poster_url','') ELSE v.cover_media_poster_url END,
      cover_media_type=CASE WHEN v_keep_cover THEN v.cover_media_type WHEN p_payload?'cover_media_type' THEN NULLIF(p_payload->>'cover_media_type','') ELSE v.cover_media_type END,
      cover_media_provider=CASE WHEN v_keep_cover THEN v.cover_media_provider WHEN p_payload?'cover_media_provider' THEN NULLIF(p_payload->>'cover_media_provider','') ELSE v.cover_media_provider END,
      cover_media_source_url=CASE WHEN v_keep_cover THEN v.cover_media_source_url WHEN p_payload?'cover_media_source_url' THEN NULLIF(p_payload->>'cover_media_source_url','') ELSE v.cover_media_source_url END,
      cover_media_credit=CASE WHEN v_keep_cover THEN v.cover_media_credit WHEN p_payload?'cover_media_credit' THEN NULLIF(p_payload->>'cover_media_credit','') ELSE v.cover_media_credit END,
      cover_media_credit_url=CASE WHEN v_keep_cover THEN v.cover_media_credit_url WHEN p_payload?'cover_media_credit_url' THEN NULLIF(p_payload->>'cover_media_credit_url','') ELSE v.cover_media_credit_url END,
      cover_media_alt=CASE WHEN v_keep_cover THEN v.cover_media_alt WHEN p_payload?'cover_media_alt' THEN NULLIF(p_payload->>'cover_media_alt','') ELSE v.cover_media_alt END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE v.cover_media_gallery END,
      timezone=COALESCE(NULLIF(p_payload->>'timezone',''),v.timezone),
      is_online=CASE WHEN v_patch?'format' THEN (v_patch->>'format') IN ('online','hybrid') ELSE v.is_online END,
      theme=v_theme,
      party_types=CASE WHEN v_patch?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'partyTypes')) ELSE v.party_types END,
      vibe_tags=CASE WHEN v_patch?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'vibeTags')) ELSE v.vibe_tags END,
      music_genres=CASE WHEN v_patch?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'musicGenres')) ELSE v.music_genres END,
      city=CASE WHEN v_patch?'city' THEN NULLIF(v_patch->>'city','') ELSE v.city END,
      -- Where-step pin: written when the save carries it (the wizard always does;
      -- an explicit null clears it with the address). Absent key keeps the row.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE v.location_geo END,
      location_provider_place_id=CASE WHEN p_payload?'location_provider_place_id' THEN public.places_checked_place_id(NULLIF(btrim(p_payload->>'location_provider_place_id'),'')) ELSE v.location_provider_place_id END,
      theme_color_override=CASE WHEN p_payload?'theme_color_override' THEN NULLIF(p_payload->>'theme_color_override','') ELSE v.theme_color_override END,
      theme_font_override=CASE WHEN p_payload?'theme_font_override' THEN NULLIF(p_payload->>'theme_font_override','') ELSE v.theme_font_override END,
      theme_animation_override=CASE WHEN p_payload?'theme_animation_override' THEN NULLIF(p_payload->>'theme_animation_override','') ELSE v.theme_animation_override END,
      theme_gradient_override=CASE WHEN p_payload?'theme_gradient_override' THEN NULLIF(p_payload->>'theme_gradient_override','') ELSE v.theme_gradient_override END,
      currency=COALESCE(NULLIF(upper(COALESCE(p_payload->>'currency',v_patch->>'currency')),''),v.currency),updated_at=now()
    WHERE id=p_event_id;
  ELSE
    IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'rsvp_edit_reason_invalid' USING ERRCODE='22023';
    END IF;
    v_live_payload:=p_payload||jsonb_build_object('title',COALESCE(NULLIF(p_payload->>'title',''),v.title));
    v_update_result:=public.biz_update_live_rsvp(p_event_id,v_live_payload,p_reason);
    UPDATE public.events SET
      party_types=CASE WHEN p_payload?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'partyTypes')) ELSE party_types END,
      vibe_tags=CASE WHEN p_payload?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'vibeTags')) ELSE vibe_tags END,
      music_genres=CASE WHEN p_payload?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'musicGenres')) ELSE music_genres END,
      city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END,
      -- Where-step pin on a published RSVP: a re-picked address sends its
      -- coordinate and precision together; an unrelated edit sends neither.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE location_geo END,
      location_provider_place_id=CASE WHEN p_payload?'location_provider_place_id' THEN public.places_checked_place_id(NULLIF(btrim(p_payload->>'location_provider_place_id'),'')) ELSE location_provider_place_id END,
      coordinate_precision=CASE WHEN p_payload?'location_geo' THEN
        CASE WHEN NULLIF(p_payload->>'location_geo','') IS NOT NULL
              AND p_payload->>'coordinate_precision' IN ('exact','approximate')
             THEN p_payload->>'coordinate_precision' END
        ELSE coordinate_precision END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE cover_media_gallery END
    WHERE id=p_event_id;
  END IF;
  -- #4508 C6: the host's "Bring someone too" setting, on a draft or a live
  -- RSVP alike. Absent key keeps the stored value.
  IF p_payload ? 'rsvpGuestsCanBring' THEN
    IF jsonb_typeof(p_payload->'rsvpGuestsCanBring') <> 'boolean' THEN
      RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
    END IF;
    UPDATE public.events
       SET rsvp_guests_can_bring=(p_payload->>'rsvpGuestsCanBring')::boolean
     WHERE id=p_event_id;
  END IF;
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  v_result:=v_result||jsonb_build_object('rsvpGuestsCanBring',
    (SELECT e.rsvp_guests_can_bring FROM public.events e WHERE e.id=p_event_id));
  IF v_update_result IS NOT NULL THEN
    v_result:=v_result||jsonb_build_object('updateResult',v_update_result);
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'update',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;


-- ---------------------------------------------------------------------------
-- S2 biz_resolve_brand_person_source: a number-only plus-one has no name, and
-- the rsvp_plus_one arm read btrim(g.name) into the brand_people insert, which
-- failed on NULL (the ingest trigger then dropped the guest). The arm now uses
-- the 'Guest' sentinel every other arm uses. This follows #3524's convention
-- for this function (its live body carries #1772's and #3524's string
-- patches): take the live definition, replace exactly one expression, and
-- raise if it did not land. Idempotent: a second run leaves it as it is.
-- ---------------------------------------------------------------------------
DO $s2_patch$
DECLARE
  v_def text;
  v_anchor text := 'SELECT e.brand_id,r.event_id,g.matched_user_id,btrim(g.name),';
  v_new text := 'SELECT e.brand_id,r.event_id,g.matched_user_id,COALESCE(NULLIF(btrim(g.name),''''),''Guest''),';
BEGIN
  SELECT pg_get_functiondef(
    'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)
    INTO v_def;
  IF position(v_new in v_def) > 0 THEN
    RAISE NOTICE '#4508: biz_resolve_brand_person_source already names number-only guests; unchanged.';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'issue_4508_s2_patch_anchor_missing';
  END IF;
  v_def := replace(v_def, v_anchor, v_new);
  IF v_def NOT LIKE 'CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source%'
     OR v_def NOT LIKE '%s.superseded_at IS NULL%'
     OR v_def NOT LIKE '%issue_3524_grade_marketing_consent%' THEN
    RAISE EXCEPTION 'issue_4508_s2_patch_failed';
  END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source%s',
    substr(v_def, length('CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source') + 1));
END
$s2_patch$;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source(
  uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source(
  uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 10b. Brand Guest chat (#4459): a plus-one joins only after claiming (N-1).
--      A number matched to an account at submit (or a friend picked from a
--      list) is not that person's yes, so the guest arm of
--      issue_4459_brand_guest_eligible now needs a claimed pass.
--      Re-created from its latest writer: the #4459 body (20280805004459
--      lines 190-224) as #4473's hook patched it (20280805004473
--      issue_4473_hook_brand_guest prepends the issue_4473_shared_brand_guest
--      arm). Only the guest arm changes (AND g.claimed_at IS NOT NULL). The
--      party trigger also fires on claimed_at, so a claim joins the chat;
--      release (row delete) and a claim by another account already re-sync.
--      Nothing else of #4459 is redefined (issue_4459_ensure_brand_guest_chat
--      is untouched). Rows matched before #4508 were backfilled as claimed in
--      section 1 (N-6), so existing members keep their place; any account
--      that is a member only through an unclaimed match is re-synced (and so
--      removed) here. A no-op when #4459 is absent, as #4473 does.
-- ---------------------------------------------------------------------------
DO $n1_guest_chat$
DECLARE
  v_shared_arm text := '';
BEGIN
  IF to_regprocedure('public.issue_4459_brand_guest_eligible(uuid,uuid)') IS NULL
     OR to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.issue_4459_tg_event_rsvp_guests()') IS NULL THEN
    RAISE NOTICE '#4508: #4459 Guest chat absent; eligibility unchanged.';
    RETURN;
  END IF;
  IF to_regprocedure('public.issue_4473_shared_brand_guest(uuid,uuid)') IS NOT NULL THEN
    v_shared_arm := 'public.issue_4473_shared_brand_guest(p_brand_id, p_user_id) OR ';
  END IF;
  EXECUTE format($create$
CREATE OR REPLACE FUNCTION public.issue_4459_brand_guest_eligible(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND (%s
    EXISTS (
      SELECT 1 FROM public.orders o JOIN public.events e ON e.id = o.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND o.buyer_user_id = p_user_id
         AND o.payment_status IN ('paid', 'partial_refund')
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
        JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND r.user_id = p_user_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvp_guests g
        JOIN public.event_rsvps r ON r.id = g.rsvp_id
        JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
        JOIN public.events e ON e.id = r.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND g.matched_user_id = p_user_id
         AND g.claimed_at IS NOT NULL
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    ) OR EXISTS (
      SELECT 1 FROM public.pending_trip_chat_claims pc
        JOIN public.orders o ON o.id = pc.order_id
        JOIN public.events e ON e.id = pc.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND pc.claimed_by_user_id = p_user_id AND pc.claimed_at IS NOT NULL
         AND o.payment_status IN ('paid', 'partial_refund')
    )
  );
$function$
$create$, v_shared_arm);
  -- (Literal statements: the #1860 gate reads every DDL this file runs.)
  EXECUTE 'REVOKE ALL ON FUNCTION public.issue_4459_brand_guest_eligible(uuid, uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.issue_4459_brand_guest_eligible(uuid, uuid) TO service_role';

  -- The #4459 party trigger, now also on claimed_at (same function).
  EXECUTE 'DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_rsvp_party ON public.event_rsvp_guests';
  EXECUTE 'CREATE TRIGGER issue_4459_brand_guest_chat_rsvp_party
  AFTER INSERT OR UPDATE OF matched_user_id, rsvp_id, claimed_at OR DELETE
  ON public.event_rsvp_guests
  FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_event_rsvp_guests()';

  -- Re-sync every account matched to an unclaimed guest row, so one that
  -- joined through that match alone leaves (one that is eligible another way
  -- stays). issue_4459_safe_sync never fails the migration.
  PERFORM public.issue_4459_safe_sync(s.brand_id, s.user_id, 'rsvp_party')
     FROM (SELECT DISTINCT e.brand_id, g.matched_user_id AS user_id
             FROM public.event_rsvp_guests g
             JOIN public.event_rsvps r ON r.id = g.rsvp_id
             JOIN public.events e ON e.id = r.event_id
            WHERE g.matched_user_id IS NOT NULL AND g.claimed_at IS NULL) s;
END
$n1_guest_chat$;

-- ---------------------------------------------------------------------------
-- 11. Foreign keys to auth.users, last (R-8): adding one takes SHARE ROW
--     EXCLUSIVE on auth.users, which stalls sign-ins until COMMIT, so they are
--     added only here, right before the commit. Each validates in the same
--     statement (a NOT VALID + VALIDATE split would save nothing inside one
--     transaction).
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_rsvp_guests
  DROP CONSTRAINT IF EXISTS event_rsvp_guests_invited_by_user_id_fkey;
ALTER TABLE public.event_rsvp_guests
  ADD CONSTRAINT event_rsvp_guests_invited_by_user_id_fkey
  FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.rsvp_guest_releases
  DROP CONSTRAINT IF EXISTS rsvp_guest_releases_inviter_user_id_fkey;
ALTER TABLE public.rsvp_guest_releases
  ADD CONSTRAINT rsvp_guest_releases_inviter_user_id_fkey
  FOREIGN KEY (inviter_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.rsvp_guest_connections
  DROP CONSTRAINT IF EXISTS rsvp_guest_connections_inviter_user_id_fkey;
ALTER TABLE public.rsvp_guest_connections
  ADD CONSTRAINT rsvp_guest_connections_inviter_user_id_fkey
  FOREIGN KEY (inviter_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.rsvp_guest_connections
  DROP CONSTRAINT IF EXISTS rsvp_guest_connections_guest_user_id_fkey;
ALTER TABLE public.rsvp_guest_connections
  ADD CONSTRAINT rsvp_guest_connections_guest_user_id_fkey
  FOREIGN KEY (guest_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.rsvp_friend_going_notices
  DROP CONSTRAINT IF EXISTS rsvp_friend_going_notices_actor_user_id_fkey;
ALTER TABLE public.rsvp_friend_going_notices
  ADD CONSTRAINT rsvp_friend_going_notices_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.rsvp_friend_going_notices
  DROP CONSTRAINT IF EXISTS rsvp_friend_going_notices_friend_user_id_fkey;
ALTER TABLE public.rsvp_friend_going_notices
  ADD CONSTRAINT rsvp_friend_going_notices_friend_user_id_fkey
  FOREIGN KEY (friend_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;
