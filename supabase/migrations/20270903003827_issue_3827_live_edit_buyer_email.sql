-- Issue #3827 — a ticket holder, RSVP guest or experience buyer is emailed
-- when a host makes a material change to a live listing.
--
-- WHAT WAS BROKEN.
--   1. A host who moved a live event to another venue, day or format was told
--      on screen that buyers would be emailed (and texted). Nothing was sent:
--      the app only wrote a console line (`eventChangeNotifier`).
--   2. The reason a host gives for a live edit was validated and thrown away;
--      no row recorded who changed what, or why.
--   3. A live RSVP edit did alert going guests, but with empty wording ("Plans
--      changed: your event") and a link to the home page.
--
-- WHAT THIS DOES.
--   - `event_edit_notices`: one row per live edit, with the actor, the reason
--     and the old and new values. Whether buyers are emailed is decided here,
--     on the server, and nowhere else.
--   - The old values are captured by row triggers at the FIRST write a
--     transaction makes to a live listing, so every write path is covered: the
--     three live-edit functions, the leaf functions a signed-in host may still
--     call, and a plain table UPDATE. The live-edit functions flush the capture
--     with their reason; anything else is recorded at commit as `direct`.
--   - One email per event after five quiet minutes, never later than fifteen
--     minutes after the first unsent change, never within twenty minutes of
--     the previous email. An edit that is put back sends nothing.
--   - `event_edit_notice_fanout`, called by the `rsvp-notify` function on its
--     existing every-minute tick, writes one row per recipient into the
--     existing RSVP delivery ledger. No new cron job.
--
-- SHIPS SWITCHED OFF. `event_update_buyer_email` is false, so every edit is
-- recorded as `held / feature_off` and nothing is fanned out. With it off a
-- live RSVP edit queues exactly the rows it queues today. Two more guards sit
-- behind the switch: only brands in `event_update_email_pilot_brands` are live
-- until `event_update_buyer_email_all_brands` is on, and while
-- `event_update_buyer_email_allowlist_only` is TRUE (its shipped value) only
-- addresses in `event_update_email_allowlist` receive anything.
--
-- PRIVACY.
--   - An event that hides its address before or after the change: no street
--     address is stored in a notice or printed. The venue name is.
--   - Experiences: no stop address and no place name is ever stored. A route is
--     compared by fingerprint only.
--   - The online link is compared by fingerprint and never stored.
--   - Every new table is service-role only. The host reads counts only.
--
-- TRIGGER FIRING ORDER RELIED ON. The three capture triggers are BEFORE ROW
-- triggers named `issue_3827_capture_edit_notice*`. BEFORE triggers on one
-- table fire in name order, so on `events` this one fires after
-- `issue_3645_refuse_publish_with_cleared_prices` and before every `trg_*`
-- trigger. It depends on NEITHER: it never changes NEW, never returns NULL and
-- never raises, and it reads the OLD state from the table, which no BEFORE
-- trigger has written yet. Its WHEN clause skips drafts, trips and updates
-- that leave the watched columns alone, so publish (`draft` to `scheduled`)
-- and the #3645 draft-currency triggers never reach its body.
--
-- WHERE THE BODIES CAME FROM. `business_update_live_event_atomic` and
-- `biz_update_live_rsvp` are re-emitted verbatim from
-- 20270828003827_issue_3827_live_edit_location_one_owner.sql, and
-- `biz_update_live_experience` from
-- 20270323001919_issue_1919_provider_neutral_paid_readiness.sql, with only the
-- hunks marked `issue #3827 buyer email` changed. No later migration redefines
-- any of the three, and production held the same bodies when this was written
-- (md5 of prosrc 62323b17, a4b8db86, 2695010c). Signatures are unchanged, so
-- every existing GRANT, REVOKE and COMMENT survives CREATE OR REPLACE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_edit_notices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id        uuid NOT NULL,
  edited_by       uuid,
  source          text NOT NULL
    CHECK (source IN ('event', 'rsvp', 'experience', 'direct')),
  reason          text,
  -- What THIS edit changed: [{field, old, new}].
  changes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the email will say: the first unsent old value against the latest
  -- new one, with fields that were put back dropped.
  notice_changes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  state           text NOT NULL
    CHECK (state IN ('logged', 'scheduled', 'superseded', 'fanned_out', 'held')),
  hold_code       text
    CHECK (hold_code IN ('feature_off', 'refund_all', 'event_not_live', 'recorder_error')),
  send_after      timestamptz,
  superseded_by   uuid REFERENCES public.event_edit_notices(id) ON DELETE SET NULL,
  audience_count  integer NOT NULL DEFAULT 0,
  no_email_count  integer NOT NULL DEFAULT 0,
  -- Recipients kept back because the allowlist-only guard is on.
  held_count      integer NOT NULL DEFAULT 0,
  -- The values before the first unsent edit, and after this one. Addresses are
  -- already removed when the address is withheld on either side.
  base_snapshot   jsonb,
  after_snapshot  jsonb,
  first_unsent_at timestamptz,
  fanned_out_at   timestamptz,
  ops_alerted_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_edit_notices_one_scheduled_per_event
  ON public.event_edit_notices (event_id) WHERE state = 'scheduled';
CREATE INDEX IF NOT EXISTS event_edit_notices_event_created_idx
  ON public.event_edit_notices (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_edit_notices_due_idx
  ON public.event_edit_notices (send_after) WHERE state = 'scheduled';

ALTER TABLE public.event_edit_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_edit_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_edit_notices TO service_role;

COMMENT ON TABLE public.event_edit_notices IS
  '#3827 one row per live edit of an event, RSVP or experience: who, why, what changed, and whether buyers are emailed. Service role only; hosts read counts through business_event_buyer_notice_status.';

-- The values a listing had before the first write of a transaction. A row
-- lives for one transaction: the flush or the commit trigger removes it.
CREATE TABLE IF NOT EXISTS public.event_edit_notice_pending (
  xid        bigint NOT NULL,
  event_id   uuid NOT NULL,
  before     jsonb,
  actor      uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (xid, event_id)
);

ALTER TABLE public.event_edit_notice_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_edit_notice_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_edit_notice_pending TO service_role;

COMMENT ON TABLE public.event_edit_notice_pending IS
  '#3827 the before-values of a live listing, captured at the first write of a transaction and consumed in the same transaction. Service role only.';

CREATE TABLE IF NOT EXISTS public.event_update_email_pilot_brands (
  brand_id   uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_update_email_pilot_brands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_update_email_pilot_brands FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_update_email_pilot_brands TO service_role;
COMMENT ON TABLE public.event_update_email_pilot_brands IS
  '#3827 brands whose buyers are emailed about live edits while event_update_buyer_email_all_brands is off. Ships empty.';

CREATE TABLE IF NOT EXISTS public.event_update_email_allowlist (
  email      text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_update_email_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_update_email_allowlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_update_email_allowlist TO service_role;
COMMENT ON TABLE public.event_update_email_allowlist IS
  '#3827 the only addresses a live-edit email may reach while event_update_buyer_email_allowlist_only is on. Lower-case. Ships empty.';

-- The host status line reads the deliveries of a notice by its id.
CREATE INDEX IF NOT EXISTS rsvp_notifications_notice_id_idx
  ON public.rsvp_notifications ((payload ->> 'noticeId'))
  WHERE payload ? 'noticeId';

-- ---------------------------------------------------------------------------
-- 2. Flags and the email-only category.
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('event_update_buyer_email', false,
   '#3827 master switch: email buyers when a host materially changes a live listing. Off = edits are recorded as held and nothing is sent.'),
  ('event_update_buyer_email_all_brands', false,
   '#3827 when off, only brands in event_update_email_pilot_brands are live.'),
  ('event_update_buyer_email_allowlist_only', true,
   '#3827 when on, only addresses in event_update_email_allowlist receive a live-edit email.')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES
  ('buyer_event_updated', 'Purchases', true, 'high', ARRAY['email']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Is the feature live for this brand? Master switch on, and the brand is in
-- the pilot or the all-brands switch is on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_brand_live(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((SELECT f.is_enabled FROM public.feature_flags AS f
                    WHERE f.flag_key = 'event_update_buyer_email'), false)
     AND (COALESCE((SELECT f.is_enabled FROM public.feature_flags AS f
                     WHERE f.flag_key = 'event_update_buyer_email_all_brands'), false)
          OR EXISTS (SELECT 1 FROM public.event_update_email_pilot_brands AS p
                      WHERE p.brand_id = p_brand_id))
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_brand_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_edit_notice_brand_live(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The snapshot: the values a buyer acts on, and nothing else.
--   Events and RSVPs: format, venue name, address, online link (fingerprint
--   only), timezone, dates. The format is READ from where it is stored
--   (theme.business_event.format) and is NULL when nothing is stored: it is
--   never inferred from the two-valued is_online flag, which cannot tell
--   online from hybrid (#2353). The venue and address are the structured halves in
--   theme.business_event.location. A listing that has neither half has only
--   its label, which stands in for the venue name (the same fallback the
--   public page uses); on a hide-address listing that label may hold the
--   street, so it is kept as a fingerprint only.
--   Experiences: timezone, dates, the number of stops, and two fingerprints.
--   No stop address or place name leaves this function.
--   Trips are not on this rail: NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_notice_snapshot(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_type text;
  v_timezone text;
  v_label text;
  v_online text;
  v_theme jsonb;
  v_dates jsonb;
  v_venue text;
  v_address text;
  v_withheld boolean;
  v_from_label boolean := false;
  v_stops integer;
  v_route text;
  v_times text;
BEGIN
  SELECT e.event_type, e.timezone, e.location_text, e.online_url, e.theme
    INTO v_type, v_timezone, v_label, v_online, v_theme
    FROM public.events AS e
   WHERE e.id = p_event_id;
  IF NOT FOUND OR v_type NOT IN ('event', 'rsvp', 'experience') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           's', to_char(d.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'e', to_char(d.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
           ORDER BY d.start_at, d.end_at), '[]'::jsonb)
    INTO v_dates
    FROM public.event_dates AS d
   WHERE d.event_id = p_event_id;

  IF v_type = 'experience' THEN
    SELECT count(*)::integer,
           md5(COALESCE(string_agg(
             s.rank::text || '|' || lower(btrim(s.place_name)) || '|' || COALESCE(s.place_id, '')
               || '|' || btrim(s.address) || '|' || COALESCE(round(s.lat::numeric, 5)::text, '')
               || '|' || COALESCE(round(s.lng::numeric, 5)::text, ''),
             E'\n' ORDER BY s.rank), '')),
           md5(COALESCE(string_agg(COALESCE(s.start_time::text, ''), ',' ORDER BY s.rank), ''))
      INTO v_stops, v_route, v_times
      FROM (SELECT es.*, row_number() OVER (ORDER BY es.stop_order) AS rank
              FROM public.experience_stops AS es
             WHERE es.event_id = p_event_id) AS s;
    RETURN jsonb_build_object(
      'kind', 'experience',
      'timezone', v_timezone,
      'dates', v_dates,
      'stops_n', v_stops,
      'route_fp', v_route,
      'stop_times_fp', v_times);
  END IF;

  v_withheld := COALESCE(v_theme #>> '{business_event,hideAddressUntilTicket}', '') = 'true';
  v_venue := public.business_event_location_label(v_theme #>> '{business_event,location,venueName}', NULL);
  v_address := public.business_event_location_label(NULL, v_theme #>> '{business_event,location,address}');
  IF v_venue IS NULL AND v_address IS NULL THEN
    v_venue := public.business_event_location_label(v_label, NULL);
    v_from_label := v_venue IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'kind', 'event',
    'format', NULLIF(lower(btrim(COALESCE(v_theme #>> '{business_event,format}', ''))), ''),
    'venue', CASE WHEN v_from_label AND v_withheld THEN NULL ELSE v_venue END,
    'venue_fp', md5(v_venue),
    'venue_from_label', v_from_label,
    'address', CASE WHEN v_withheld THEN NULL ELSE v_address END,
    'address_fp', md5(v_address),
    'address_withheld', v_withheld,
    'online_fp', md5(NULLIF(btrim(COALESCE(v_online, '')), '')),
    'timezone', v_timezone,
    'dates', v_dates);
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_notice_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_event_notice_snapshot(uuid) TO service_role;

COMMENT ON FUNCTION public.business_event_notice_snapshot(uuid) IS
  '#3827 the values a buyer acts on (format, venue, address, online link fingerprint, timezone, dates; for an experience dates and route fingerprints). Never a stop address, a place name, an online link, or the street of a hide-address event.';

-- Remove what must not be kept once the address is withheld on either side of
-- a change: the street, and a venue that was only ever the label.
CREATE OR REPLACE FUNCTION public.event_edit_notice_scrub(p_snapshot jsonb, p_withheld boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE
    WHEN p_snapshot IS NULL OR NOT COALESCE(p_withheld, false)
         OR p_snapshot ->> 'kind' IS DISTINCT FROM 'event' THEN p_snapshot
    ELSE p_snapshot
      || jsonb_build_object('address', NULL, 'address_withheld', true)
      || CASE WHEN COALESCE((p_snapshot ->> 'venue_from_label')::boolean, false)
              THEN jsonb_build_object('venue', NULL) ELSE '{}'::jsonb END
  END
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_scrub(jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The diff: what is material to someone who already booked.
--   Yes: format, venue, address, online link, timezone, and a date the buyer
--   could hold that is no longer offered (an old start/end pair missing from
--   the new set). For experiences also the route and the stop times.
--   No: an ADDED date (the recurrence top-up adds rows), price, capacity,
--   name, description, cover, visibility, refund terms.
--   Dates are listed in full when each side has at most 3, else `many`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_diff(p_before jsonb, p_after jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_kind text := p_after ->> 'kind';
  v_withheld boolean;
BEGIN
  IF p_before IS NULL OR p_after IS NULL OR v_kind IS NULL
     OR p_before ->> 'kind' IS DISTINCT FROM v_kind THEN
    RETURN v_out;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_before -> 'dates', '[]'::jsonb)) AS o(pair)
     WHERE NOT (COALESCE(p_after -> 'dates', '[]'::jsonb) @> jsonb_build_array(o.pair))
  ) THEN
    IF jsonb_array_length(COALESCE(p_before -> 'dates', '[]'::jsonb)) <= 3
       AND jsonb_array_length(COALESCE(p_after -> 'dates', '[]'::jsonb)) <= 3 THEN
      v_out := v_out || jsonb_build_object(
        'field', 'dates', 'old', p_before -> 'dates', 'new', p_after -> 'dates');
    ELSE
      v_out := v_out || jsonb_build_object('field', 'dates', 'many', true);
    END IF;
  END IF;

  IF p_before ->> 'timezone' IS DISTINCT FROM p_after ->> 'timezone' THEN
    v_out := v_out || jsonb_build_object(
      'field', 'timezone', 'old', p_before -> 'timezone', 'new', p_after -> 'timezone');
  END IF;

  IF v_kind = 'experience' THEN
    IF p_before ->> 'route_fp' IS DISTINCT FROM p_after ->> 'route_fp'
       OR p_before ->> 'stops_n' IS DISTINCT FROM p_after ->> 'stops_n' THEN
      v_out := v_out || jsonb_build_object('field', 'route');
    END IF;
    IF p_before ->> 'stop_times_fp' IS DISTINCT FROM p_after ->> 'stop_times_fp' THEN
      v_out := v_out || jsonb_build_object('field', 'stop_times');
    END IF;
    RETURN v_out;
  END IF;

  v_withheld := COALESCE((p_before ->> 'address_withheld')::boolean, false)
             OR COALESCE((p_after ->> 'address_withheld')::boolean, false);

  -- A format is a change only between two STORED formats. A listing that had
  -- none stored gets one written by its first live save (the editor sends the
  -- format on every save); that is not a change a buyer was ever told about.
  IF p_before ->> 'format' IS NOT NULL AND p_after ->> 'format' IS NOT NULL
     AND p_before ->> 'format' IS DISTINCT FROM p_after ->> 'format' THEN
    v_out := v_out || jsonb_build_object(
      'field', 'format', 'old', p_before -> 'format', 'new', p_after -> 'format');
  END IF;

  IF p_before ->> 'venue_fp' IS DISTINCT FROM p_after ->> 'venue_fp' THEN
    IF (p_before ->> 'venue' IS NULL AND p_before ->> 'venue_fp' IS NOT NULL)
       OR (p_after ->> 'venue' IS NULL AND p_after ->> 'venue_fp' IS NOT NULL) THEN
      -- A venue known only through the label of a hide-address listing.
      v_out := v_out || jsonb_build_object('field', 'venue', 'withheld', true);
    ELSE
      v_out := v_out || jsonb_build_object(
        'field', 'venue', 'old', p_before -> 'venue', 'new', p_after -> 'venue');
    END IF;
  END IF;

  IF p_before ->> 'address_fp' IS DISTINCT FROM p_after ->> 'address_fp' THEN
    IF v_withheld THEN
      v_out := v_out || jsonb_build_object('field', 'address', 'withheld', true);
    ELSE
      v_out := v_out || jsonb_build_object(
        'field', 'address', 'old', p_before -> 'address', 'new', p_after -> 'address');
    END IF;
  END IF;

  IF p_before ->> 'online_fp' IS DISTINCT FROM p_after ->> 'online_fp' THEN
    v_out := v_out || jsonb_build_object(
      'field', 'online_link',
      'old_present', p_before ->> 'online_fp' IS NOT NULL,
      'new_present', p_after ->> 'online_fp' IS NOT NULL);
  END IF;

  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_diff(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Who is a buyer, row by row. The same three predicates as
-- business_event_buyer_count, so count(*) here equals that count (pinned by
-- the suite). A ticket with no attendee address falls back to its order's.
-- `group_key` ties an order to its tickets so one door sale with no address
-- counts as one person without an address, not one per ticket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_buyer_rows(p_event_id uuid)
RETURNS TABLE (source text, group_key text, rsvp_id uuid, email text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT 'order'::text, 'o:' || o.id::text, NULL::uuid,
         NULLIF(btrim(o.buyer_email), ''), NULLIF(btrim(o.buyer_name), '')
    FROM public.orders AS o
   WHERE o.event_id = p_event_id
     AND o.payment_status IN ('paid', 'partial_refund')
     AND o.cancelled_at IS NULL
  UNION ALL
  SELECT 'ticket'::text,
         CASE WHEN t.order_id IS NULL THEN 't:' || t.id::text ELSE 'o:' || t.order_id::text END,
         NULL::uuid,
         COALESCE(NULLIF(btrim(t.attendee_email), ''), NULLIF(btrim(po.buyer_email), '')),
         COALESCE(NULLIF(btrim(t.attendee_name), ''), NULLIF(btrim(po.buyer_name), ''))
    FROM public.tickets AS t
    LEFT JOIN public.orders AS po ON po.id = t.order_id
   WHERE t.event_id = p_event_id
     AND t.status IN ('valid', 'used', 'transferred', 'refund_pending')
  UNION ALL
  SELECT 'rsvp'::text, 'r:' || r.id::text, r.id,
         NULLIF(btrim(r.guest_email), ''), NULLIF(btrim(r.guest_name), '')
    FROM public.event_rsvps AS r
   WHERE r.event_id = p_event_id
     AND r.rsvp_status = 'going'
     AND r.approval_status = 'approved'
$fn$;

REVOKE ALL ON FUNCTION public.business_event_buyer_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_event_buyer_rows(uuid) TO service_role;

COMMENT ON FUNCTION public.business_event_buyer_rows(uuid) IS
  '#3827 the buyers of an event, one row per paid order, live ticket and going RSVP (the predicates of business_event_buyer_count), with the address and name a notice would use. Service role only.';

-- People, not rows: distinct addresses, plus groups that have no address.
CREATE OR REPLACE FUNCTION public.event_edit_notice_audience(
  p_event_id uuid, OUT recipients integer, OUT no_email integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH b AS (SELECT * FROM public.business_event_buyer_rows(p_event_id))
  SELECT (SELECT count(DISTINCT lower(b.email)) FROM b WHERE b.email IS NOT NULL)::integer,
         (SELECT count(*) FROM (
            SELECT b.group_key FROM b GROUP BY b.group_key
            HAVING bool_and(b.email IS NULL)) AS g)::integer
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_audience(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_edit_notice_audience(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6b. Withholding an address after the fact. A host can switch "hide address
-- until ticket" on while an email is waiting, or after it was fanned out but
-- before every copy went. From that moment no street may be printed: every
-- notice of the event that can still be sent loses its street values (the
-- venue name stays, and the email says "The address has changed."), and a
-- venue known only through the label loses its value too. Notices that are
-- fully sent, logged or held are history and are left as they were.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_withhold_changes(
  p_changes jsonb, p_venue_from_label boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN c.entry ->> 'field' = 'address'
        THEN jsonb_build_object('field', 'address', 'withheld', true)
      WHEN c.entry ->> 'field' = 'venue' AND COALESCE(p_venue_from_label, false)
        THEN jsonb_build_object('field', 'venue', 'withheld', true)
      ELSE c.entry
    END ORDER BY c.ord), '[]'::jsonb)
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_changes) = 'array' THEN p_changes ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS c(entry, ord)
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_withhold_changes(jsonb, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_edit_notice_withhold_unsent(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.event_edit_notices AS n
     SET notice_changes = public.event_edit_notice_withhold_changes(n.notice_changes,
           COALESCE((n.base_snapshot ->> 'venue_from_label')::boolean, false)
           OR COALESCE((n.after_snapshot ->> 'venue_from_label')::boolean, false)),
         changes = public.event_edit_notice_withhold_changes(n.changes,
           COALESCE((n.base_snapshot ->> 'venue_from_label')::boolean, false)
           OR COALESCE((n.after_snapshot ->> 'venue_from_label')::boolean, false)),
         base_snapshot = public.event_edit_notice_scrub(n.base_snapshot, true),
         after_snapshot = public.event_edit_notice_scrub(n.after_snapshot, true)
   WHERE n.event_id = p_event_id
     AND (n.state IN ('scheduled', 'superseded')
          OR (n.state = 'fanned_out' AND EXISTS (
                SELECT 1
                  FROM public.rsvp_notifications AS r
                  JOIN public.rsvp_notification_deliveries AS d ON d.notification_id = r.id
                 WHERE r.payload ? 'noticeId'
                   AND r.payload ->> 'noticeId' = n.id::text
                   AND d.status IN ('pending', 'processing', 'failed_retryable'))));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_withhold_unsent(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.event_edit_notice_withhold_unsent(uuid) IS
  '#3827 removes street values from every edit notice of an event that can still be sent (waiting, superseded, or fanned out with an undelivered copy), once the event hides its address.';

-- ---------------------------------------------------------------------------
-- 7. The recorder. Always writes one row, and decides the email.
--   Nothing material changed            -> logged
--   Material, nobody booked             -> logged
--   Material, listing no longer on sale -> held / event_not_live
--   Material, "refund all and proceed"  -> held / refund_all (and any email
--       already waiting for this event is held too: "your ticket is still
--       valid" would be false)
--   Material, feature not live for brand-> held / feature_off
--   Otherwise                           -> scheduled, replacing the waiting
--       notice for this event. The email compares the values before the FIRST
--       unsent edit with the latest ones, so an edit that was put back leaves
--       nothing to send (logged).
--   send_after = the later of
--       min(now + 5 minutes, first unsent edit + 15 minutes)  and
--       the previous email for this event + 20 minutes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_record_edit_notice(
  p_event_id uuid,
  p_actor uuid,
  p_reason text,
  p_before jsonb,
  p_after jsonb,
  p_source text,
  p_ack_sold_impact boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_brand_id uuid;
  v_status text;
  v_deleted timestamptz;
  v_withheld boolean;
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb;
  v_merged jsonb;
  v_live boolean;
  v_recipients integer := 0;
  v_no_email integer := 0;
  v_audience integer := 0;
  v_state text := 'logged';
  v_hold text;
  v_send_after timestamptz;
  v_first timestamptz;
  v_last_sent timestamptz;
  v_prev public.event_edit_notices%ROWTYPE;
  v_have_prev boolean := false;
  v_id uuid := gen_random_uuid();
BEGIN
  SELECT e.brand_id, e.status, e.deleted_at INTO v_brand_id, v_status, v_deleted
    FROM public.events AS e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none', 'live', false, 'handled', false,
      'material', false, 'audience', 0);
  END IF;

  v_withheld := COALESCE((p_before ->> 'address_withheld')::boolean, false)
             OR COALESCE((p_after ->> 'address_withheld')::boolean, false);
  v_before := public.event_edit_notice_scrub(p_before, v_withheld);
  v_after := public.event_edit_notice_scrub(p_after, v_withheld);
  v_changes := public.event_edit_notice_diff(v_before, v_after);
  v_merged := v_changes;
  v_live := public.event_edit_notice_brand_live(v_brand_id);

  -- The address is withheld NOW: nothing still waiting to go out may print a
  -- street, whatever it was recorded with.
  IF COALESCE((p_after ->> 'address_withheld')::boolean, false) THEN
    PERFORM pg_advisory_xact_lock(hashtext('issue_3827_event_edit_notice'), hashtext(p_event_id::text));
    PERFORM public.event_edit_notice_withhold_unsent(p_event_id);
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    -- One recorder at a time per event: the waiting notice is read, replaced
    -- and re-timed below.
    PERFORM pg_advisory_xact_lock(hashtext('issue_3827_event_edit_notice'), hashtext(p_event_id::text));
    SELECT a.recipients, a.no_email INTO v_recipients, v_no_email
      FROM public.event_edit_notice_audience(p_event_id) AS a;
    v_audience := v_recipients + v_no_email;

    SELECT * INTO v_prev FROM public.event_edit_notices AS n
     WHERE n.event_id = p_event_id AND n.state = 'scheduled'
     FOR UPDATE;
    v_have_prev := FOUND;

    IF v_audience = 0 THEN
      v_state := 'logged';
    ELSIF v_status NOT IN ('scheduled', 'live') OR v_deleted IS NOT NULL THEN
      v_state := 'held'; v_hold := 'event_not_live';
    ELSIF COALESCE(p_ack_sold_impact, false) THEN
      v_state := 'held'; v_hold := 'refund_all';
      IF v_have_prev THEN
        UPDATE public.event_edit_notices
           SET state = 'held', hold_code = 'refund_all', send_after = NULL
         WHERE id = v_prev.id;
        v_have_prev := false;
      END IF;
    ELSIF NOT v_live THEN
      v_state := 'held'; v_hold := 'feature_off';
    ELSE
      IF v_have_prev THEN
        v_merged := public.event_edit_notice_diff(
          public.event_edit_notice_scrub(v_prev.base_snapshot, v_withheld), v_after);
        v_first := COALESCE(v_prev.first_unsent_at, v_prev.created_at);
        v_before := public.event_edit_notice_scrub(v_prev.base_snapshot, v_withheld);
      ELSE
        v_first := v_now;
      END IF;
      IF jsonb_array_length(v_merged) = 0 THEN
        -- Put back to what buyers last knew: nothing to say.
        v_state := 'logged';
      ELSE
        SELECT max(n.fanned_out_at) INTO v_last_sent
          FROM public.event_edit_notices AS n
         WHERE n.event_id = p_event_id AND n.state = 'fanned_out';
        v_send_after := GREATEST(
          LEAST(v_now + interval '5 minutes', v_first + interval '15 minutes'),
          COALESCE(v_last_sent + interval '20 minutes', '-infinity'::timestamptz));
        v_state := 'scheduled';
      END IF;
      IF v_have_prev THEN
        -- Out of the one-scheduled-per-event index before the new row goes in.
        UPDATE public.event_edit_notices
           SET state = 'superseded', send_after = NULL
         WHERE id = v_prev.id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.event_edit_notices (
    id, event_id, brand_id, edited_by, source, reason, changes, notice_changes,
    state, hold_code, send_after, audience_count, no_email_count,
    base_snapshot, after_snapshot, first_unsent_at)
  VALUES (
    v_id, p_event_id, v_brand_id, p_actor, p_source, p_reason, v_changes,
    CASE WHEN v_state = 'scheduled' THEN v_merged ELSE v_changes END,
    v_state, v_hold, v_send_after, v_audience, v_no_email,
    CASE WHEN jsonb_array_length(v_changes) > 0 THEN v_before END,
    CASE WHEN jsonb_array_length(v_changes) > 0 THEN v_after END,
    CASE WHEN v_state = 'scheduled' THEN v_first END);

  IF v_have_prev AND v_live AND jsonb_array_length(v_changes) > 0 THEN
    UPDATE public.event_edit_notices SET superseded_by = v_id
     WHERE id = v_prev.id AND state = 'superseded';
  END IF;

  RETURN jsonb_build_object(
    'notice_id', v_id,
    'state', v_state,
    'hold_code', v_hold,
    'live', v_live,
    -- The new rail owns this change: live for the brand and something a buyer
    -- acts on changed. biz_update_live_rsvp keeps its own queue otherwise.
    'handled', v_live AND jsonb_array_length(v_changes) > 0,
    'material', jsonb_array_length(v_changes) > 0,
    'audience', v_audience,
    'no_email', v_no_email,
    'send_after', v_send_after);
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_record_edit_notice(uuid, uuid, text, jsonb, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_event_record_edit_notice(uuid, uuid, text, jsonb, jsonb, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.business_event_record_edit_notice(uuid, uuid, text, jsonb, jsonb, text, boolean) IS
  '#3827 writes the one event_edit_notices row for a live edit and decides whether, and when, buyers are emailed (5 quiet minutes, at most 15 after the first unsent edit, at least 20 after the previous email).';

-- A recorder failure must leave a trace and must never reach the host.
CREATE OR REPLACE FUNCTION public.event_edit_notice_record_failure(
  p_event_id uuid, p_actor uuid, p_reason text, p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.event_edit_notices (event_id, brand_id, edited_by, source, reason, state, hold_code)
  SELECT e.id, e.brand_id, p_actor,
         CASE WHEN p_source IN ('event', 'rsvp', 'experience', 'direct') THEN p_source ELSE 'direct' END,
         p_reason, 'held', 'recorder_error'
    FROM public.events AS e WHERE e.id = p_event_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'issue_3827: a live-edit notice could not be recorded for event % (%)', p_event_id, SQLSTATE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_record_failure(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Capture. The first write a transaction makes to a live event, RSVP or
-- experience stores the values it had. Cheap by construction:
--   - `events`: the WHEN clause on the trigger passes only when the listing is
--     scheduled or live, is not a trip, and a watched column really differs.
--   - `event_dates`, `experience_stops`: one primary-key read of the parent's
--     status, and nothing more for a draft.
--   - A second write in the same transaction is one primary-key probe.
-- It never changes the row and never raises.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_capture(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_xid bigint := txid_current();
BEGIN
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending AS p
              WHERE p.xid = v_xid AND p.event_id = p_event_id) THEN
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.event_edit_notice_pending (xid, event_id, before, actor)
    VALUES (v_xid, p_event_id, public.business_event_notice_snapshot(p_event_id), auth.uid())
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.event_edit_notice_record_failure(p_event_id, NULL, NULL, 'direct');
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_capture(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_edit_notice_capture_event_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.event_edit_notice_capture(OLD.id);
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.event_edit_notice_capture_child_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.event_id ELSE OLD.event_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM public.events AS e
              WHERE e.id = v_event_id
                AND e.status IN ('scheduled', 'live')
                AND e.event_type <> 'trip'
                AND e.deleted_at IS NULL) THEN
    PERFORM public.event_edit_notice_capture(v_event_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_capture_event_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_edit_notice_capture_child_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3827_capture_edit_notice ON public.events;
CREATE TRIGGER issue_3827_capture_edit_notice
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  WHEN (OLD.status IN ('scheduled', 'live')
        AND OLD.event_type <> 'trip'
        AND OLD.deleted_at IS NULL
        AND (OLD.timezone IS DISTINCT FROM NEW.timezone
             OR OLD.location_text IS DISTINCT FROM NEW.location_text
             OR OLD.online_url IS DISTINCT FROM NEW.online_url
             OR OLD.theme IS DISTINCT FROM NEW.theme))
  EXECUTE FUNCTION public.event_edit_notice_capture_event_trg();

DROP TRIGGER IF EXISTS issue_3827_capture_edit_notice_dates ON public.event_dates;
CREATE TRIGGER issue_3827_capture_edit_notice_dates
  BEFORE INSERT OR UPDATE OR DELETE ON public.event_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.event_edit_notice_capture_child_trg();

DROP TRIGGER IF EXISTS issue_3827_capture_edit_notice_stops ON public.experience_stops;
CREATE TRIGGER issue_3827_capture_edit_notice_stops
  BEFORE INSERT OR UPDATE OR DELETE ON public.experience_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.event_edit_notice_capture_child_trg();

-- ---------------------------------------------------------------------------
-- 9. Flush. The three live-edit functions call this once, after their writes,
-- with the reason they resolved. It compares the captured values with the
-- current ones, records the notice and hands back `buyer_notice` for the
-- screen. It cannot fail the save: any error is recorded as
-- held / recorder_error and an answer is still returned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_flush(
  p_event_id uuid,
  p_reason text,
  p_source text,
  p_ack_sold_impact boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_xid bigint := txid_current();
  v_before jsonb;
  v_after jsonb;
  v_actor uuid;
  v_found boolean;
  v_result jsonb;
BEGIN
  BEGIN
    DELETE FROM public.event_edit_notice_pending AS p
     WHERE p.xid = v_xid AND p.event_id = p_event_id
     RETURNING p.before, p.actor INTO v_before, v_actor;
    v_found := FOUND;
    IF v_found THEN
      v_after := public.business_event_notice_snapshot(p_event_id);
    END IF;
    -- No capture means no watched value was written: both sides are NULL and
    -- the row is recorded as logged with nothing changed.
    v_result := public.business_event_record_edit_notice(
      p_event_id, COALESCE(v_actor, auth.uid()), p_reason, v_before, v_after,
      p_source, COALESCE(p_ack_sold_impact, false));
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.event_edit_notice_record_failure(p_event_id, v_actor, p_reason, p_source);
    v_result := jsonb_build_object('state', 'held', 'hold_code', 'recorder_error',
      'live', false, 'handled', false, 'material', false, 'audience', 0);
  END;
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_flush(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_edit_notice_flush(uuid, text, text, boolean) TO service_role;

COMMENT ON FUNCTION public.event_edit_notice_flush(uuid, text, text, boolean) IS
  '#3827 called once by each live-edit function after its writes: records the edit notice from the captured before-values and returns buyer_notice. Never raises.';

-- ---------------------------------------------------------------------------
-- 10. The safety net. A capture nobody flushed (a leaf function called
-- directly, a plain table write, the recurrence top-up) is settled when the
-- transaction commits: recorded as `direct`, with no reason, only when
-- something material really changed. A flush deletes the capture first, so a
-- flushed edit is never recorded twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_commit_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_actor uuid;
BEGIN
  BEGIN
    DELETE FROM public.event_edit_notice_pending AS p
     WHERE p.xid = NEW.xid AND p.event_id = NEW.event_id
     RETURNING p.before, p.actor INTO v_before, v_actor;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    v_after := public.business_event_notice_snapshot(NEW.event_id);
    IF jsonb_array_length(public.event_edit_notice_diff(v_before, v_after)) > 0 THEN
      PERFORM public.business_event_record_edit_notice(
        NEW.event_id, v_actor, NULL, v_before, v_after, 'direct', false);
    ELSIF COALESCE((v_after ->> 'address_withheld')::boolean, false) THEN
      -- Nothing to tell buyers, but the address may have just become hidden.
      PERFORM public.event_edit_notice_withhold_unsent(NEW.event_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.event_edit_notice_record_failure(NEW.event_id, v_actor, NULL, 'direct');
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_commit_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3827_settle_edit_notice ON public.event_edit_notice_pending;
CREATE CONSTRAINT TRIGGER issue_3827_settle_edit_notice
  AFTER INSERT ON public.event_edit_notice_pending
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.event_edit_notice_commit_trg();

-- ---------------------------------------------------------------------------
-- 11. Fan-out. Called by rsvp-notify at the start of each tick. For every
-- notice that is due it re-checks the switches and the listing, then writes
-- one row per recipient into the existing RSVP delivery ledger:
--   - ticket and experience buyers: template `buyer_event_updated`, one row
--     per distinct address, email only (the row carries no phone and no user,
--     so the ledger seeds an email delivery and nothing else);
--   - going RSVP guests: template `rsvp_event_updated` with the notice id, so
--     they keep the channels they have today, now with real wording.
-- A recipient who is not on the allowlist while allowlist-only is on gets no
-- row at all and is counted as held. Deliveries are spread at 40 a minute so
-- other RSVP mail keeps moving. A second call inserts nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_notice_fanout(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_notice public.event_edit_notices%ROWTYPE;
  v_event record;
  v_allowlist_only boolean;
  v_recipient record;
  v_notification_id uuid;
  v_key text;
  v_index integer;
  v_held integer;
  v_recipients integer;
  v_no_email integer;
  v_notices integer := 0;
  v_rows integer := 0;
BEGIN
  -- Fail closed: a missing switch row means allowlist-only.
  v_allowlist_only := COALESCE((SELECT f.is_enabled FROM public.feature_flags AS f
    WHERE f.flag_key = 'event_update_buyer_email_allowlist_only'), true);

  -- A capture that outlived its transaction is debris from a failed settle.
  DELETE FROM public.event_edit_notice_pending WHERE created_at < now() - interval '1 day';

  FOR v_notice IN
    SELECT * FROM public.event_edit_notices AS n
     WHERE n.state = 'scheduled' AND n.send_after <= now()
     ORDER BY n.send_after
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
     FOR UPDATE SKIP LOCKED
  LOOP
    SELECT e.id, e.status, e.deleted_at, e.brand_id INTO v_event
      FROM public.events AS e WHERE e.id = v_notice.event_id;

    IF NOT public.event_edit_notice_brand_live(v_notice.brand_id) THEN
      UPDATE public.event_edit_notices
         SET state = 'held', hold_code = 'feature_off', send_after = NULL
       WHERE id = v_notice.id;
      CONTINUE;
    END IF;
    IF v_event.id IS NULL OR v_event.status NOT IN ('scheduled', 'live')
       OR v_event.deleted_at IS NOT NULL THEN
      UPDATE public.event_edit_notices
         SET state = 'held', hold_code = 'event_not_live', send_after = NULL
       WHERE id = v_notice.id;
      CONTINUE;
    END IF;

    v_index := 0;
    v_held := 0;
    FOR v_recipient IN
      WITH b AS (SELECT * FROM public.business_event_buyer_rows(v_notice.event_id)),
      by_email AS (
        SELECT lower(b.email) AS email,
               (array_agg(b.name ORDER BY b.source) FILTER (WHERE b.name IS NOT NULL))[1] AS name,
               (array_agg(b.rsvp_id) FILTER (WHERE b.rsvp_id IS NOT NULL))[1] AS rsvp_id
          FROM b WHERE b.email IS NOT NULL
         GROUP BY lower(b.email)
      )
      SELECT m.email, m.name, m.rsvp_id FROM by_email AS m
      UNION ALL
      -- A going guest with a phone and no address is still owed an alert.
      SELECT NULL::text, b.name, b.rsvp_id FROM b
       WHERE b.email IS NULL AND b.rsvp_id IS NOT NULL
      ORDER BY 1, 3
    LOOP
      IF v_allowlist_only AND NOT EXISTS (
           SELECT 1 FROM public.event_update_email_allowlist AS a
            WHERE a.email = v_recipient.email) THEN
        v_held := v_held + 1;
        CONTINUE;
      END IF;

      v_notification_id := NULL;
      IF v_recipient.rsvp_id IS NOT NULL THEN
        v_key := 'event_edit:' || v_notice.id::text || ':'
          || COALESCE(md5(v_recipient.email), 'rsvp:' || v_recipient.rsvp_id::text);
        INSERT INTO public.rsvp_notifications
          (event_id, rsvp_id, channel, recipient, status, template_key, payload,
           idempotency_key, attempt_count)
        VALUES
          (v_notice.event_id, v_recipient.rsvp_id, NULL, NULL, 'pending', 'rsvp_event_updated',
           jsonb_build_object('template_key', 'rsvp_event_updated',
                              'rsvp_id', v_recipient.rsvp_id,
                              'event_id', v_notice.event_id,
                              'noticeId', v_notice.id),
           v_key, 0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_notification_id;
      ELSE
        v_key := 'event_edit:' || v_notice.id::text || ':' || md5(v_recipient.email);
        INSERT INTO public.rsvp_notifications
          (event_id, rsvp_id, channel, recipient, status, template_key, payload,
           idempotency_key, attempt_count)
        VALUES
          (v_notice.event_id, NULL, NULL, NULL, 'pending', 'buyer_event_updated',
           jsonb_strip_nulls(jsonb_build_object(
             'template_key', 'buyer_event_updated',
             'event_id', v_notice.event_id,
             'noticeId', v_notice.id,
             'recipientEmail', v_recipient.email,
             'recipientName', v_recipient.name)),
           v_key, 0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_notification_id;
      END IF;

      IF v_notification_id IS NOT NULL THEN
        UPDATE public.rsvp_notification_deliveries
           SET next_attempt_at = now() + make_interval(mins => v_index / 40)
         WHERE notification_id = v_notification_id;
        v_index := v_index + 1;
        v_rows := v_rows + 1;
      END IF;
    END LOOP;

    SELECT a.recipients, a.no_email INTO v_recipients, v_no_email
      FROM public.event_edit_notice_audience(v_notice.event_id) AS a;
    UPDATE public.event_edit_notices
       SET state = 'fanned_out', fanned_out_at = now(), send_after = NULL,
           audience_count = v_recipients + v_no_email,
           no_email_count = v_no_email,
           held_count = v_held
     WHERE id = v_notice.id;
    v_notices := v_notices + 1;
  END LOOP;

  RETURN jsonb_build_object('notices', v_notices, 'rows', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_edit_notice_fanout(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_edit_notice_fanout(integer) TO service_role;

COMMENT ON FUNCTION public.event_edit_notice_fanout(integer) IS
  '#3827 turns each due edit notice into one RSVP-ledger row per recipient, after re-checking the switches, the listing and the allowlist. Idempotent. Service role only.';

-- ---------------------------------------------------------------------------
-- 12. What the host may see: counts, never an address.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_buyer_notice_status(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
  v_recipients integer;
  v_no_email integer;
  v_last public.event_edit_notices%ROWTYPE;
  v_sent integer := 0;
  v_pending integer := 0;
  v_failed integer := 0;
  v_last_json jsonb := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT e.brand_id INTO v_brand_id
    FROM public.events AS e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_brand_id, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT a.recipients, a.no_email INTO v_recipients, v_no_email
    FROM public.event_edit_notice_audience(p_event_id) AS a;

  SELECT * INTO v_last FROM public.event_edit_notices AS n
   WHERE n.event_id = p_event_id AND n.state IN ('scheduled', 'fanned_out', 'held')
   ORDER BY n.created_at DESC, n.id DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_last.state = 'fanned_out' THEN
      SELECT count(*) FILTER (WHERE d.status = 'sent'),
             count(*) FILTER (WHERE d.status IN ('pending', 'processing', 'failed_retryable')),
             count(*) FILTER (WHERE d.status IN ('failed_terminal', 'ambiguous'))
        INTO v_sent, v_pending, v_failed
        FROM public.rsvp_notifications AS n
        JOIN public.rsvp_notification_deliveries AS d ON d.notification_id = n.id
       WHERE n.payload ->> 'noticeId' = v_last.id::text
         AND n.payload ? 'noticeId'
         AND d.channel = 'email';
    END IF;
    v_last_json := jsonb_build_object(
      'state', v_last.state,
      'holdCode', v_last.hold_code,
      'sendAfter', v_last.send_after,
      'audience', v_last.audience_count,
      'sent', v_sent,
      'pending', v_pending,
      'failed', v_failed,
      'noEmail', v_last.no_email_count,
      'held', v_last.held_count);
  END IF;

  RETURN jsonb_build_object(
    'live', public.event_edit_notice_brand_live(v_brand_id),
    'audience', v_recipients + v_no_email,
    'last', v_last_json);
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_buyer_notice_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_event_buyer_notice_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.business_event_buyer_notice_status(uuid) IS
  '#3827 for event managers and above: whether live-edit emails are on for this brand, how many people would be told, and the counts of the last notice (sent, pending, failed, no address, held).';

-- ---------------------------------------------------------------------------
-- 13. Re-emits. Each body is copied verbatim from the range named; the only
-- changes are the hunks marked `issue #3827 buyer email`.
-- ---------------------------------------------------------------------------

-- business_update_live_event_atomic
--   Body: 20270828003827_issue_3827_live_edit_location_one_owner.sql:625-766.
--   Hunks: v_notice declared; the flush before the RETURN; `buyer_notice` in
--   the result.

CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(
  p_event_id uuid,p_patch jsonb,p_reason text,p_client_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_core_without_tickets jsonb:=COALESCE(p_patch->'core','{}'::jsonb)-'tickets';
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
  v_pricing_patch jsonb:='{}'::jsonb;
  v_reason text;   -- issue #3827
  v_notice jsonb;  -- issue #3827 buyer email
BEGIN
  -- issue #3827 — a reason is owed to BUYERS. With none, a blank reason is
  -- recorded as the stated constant; with one or more it is still refused.
  -- The core, tier and when leaves below are unchanged and still validate
  -- what they are handed, which is now the resolved reason.
  v_reason:=public.business_resolve_edit_reason(p_event_id,p_reason);
  IF v_reason IS NULL THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,v_reason,p_client_revision   -- issue #3827
  );
  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision','')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    IF p_patch->'pricing' ? 'passTax' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_tax',p_patch#>'{pricing,passTax}');
    END IF;
    IF p_patch->'pricing' ? 'passMinglaFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_mingla_fee',p_patch#>'{pricing,passMinglaFee}');
    END IF;
    IF p_patch->'pricing' ? 'passServiceFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_service_fee',p_patch#>'{pricing,passServiceFee}');
    END IF;
    PERFORM public.business_patch_pricing_switches(p_event_id,v_pricing_patch);
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  -- issue #3288 — the additional photos. AFTER the cover block, so a save that
  -- removes the cover and edits the gallery keeps the new gallery. The caller
  -- is already authenticated, role-checked and revision-checked by
  -- business_update_live_event above; the column CHECK enforces the array shape.
  IF p_patch ? 'gallery' THEN
    UPDATE public.events SET
      cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  -- issue #3827 buyer email — every write above is done. Record this edit
  -- (who, why, what changed) and decide whether buyers are emailed. A save
  -- made with "refund all and proceed" holds the email. Never raises.
  v_notice:=public.event_edit_notice_flush(
    p_event_id,v_reason,'event',
    COALESCE((v_when->>'acknowledgeSoldImpact')::boolean,false)
  );
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision,
    'buyer_notice',v_notice   -- issue #3827 buyer email
  );
END;$fn$;


-- biz_update_live_rsvp
--   Body: 20270828003827_issue_3827_live_edit_location_one_owner.sql:777-1072.
--   Hunks: v_notice declared; FOR UPDATE on the event read; the flush; the
--   guest queue runs unless the edit notice owns the change; `buyer_notice` in
--   the result. The (uuid, jsonb, text) signature, the stripe_charges_disabled
--   refusal business_update_rsvp_graph relies on, and the meaning of
--   notified_count are untouched.

CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(
  p_event_id uuid,
  p_payload jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid;
  v_existing       public.events%ROWTYPE;
  v_brand          record;
  v_now            timestamptz := now();
  v_trimmed_reason text;
  v_title          text;
  v_description    text;
  v_location_text  text;
  v_online_url     text;
  v_timezone       text;
  v_visibility     text;
  v_when           jsonb;
  v_date_iso       text;
  v_doors          text;
  v_ends           text;
  v_new_start      timestamptz;
  v_new_end        timestamptz;
  v_old_start      timestamptz;
  v_rsvp_capacity  integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  v_material_change boolean := false;
  v_going_count    integer;
  v_notified_count integer := 0;
  v_event          public.events%ROWTYPE;
  v_guest          record;
  -- ORCH-1172 — theme.business_event.settings privacy toggles.
  v_private_guest_list boolean;
  v_hide_remaining_count boolean;
  -- ORCH-1172 R2 — theme.business_event.hideAddressUntilTicket (direct child).
  v_hide_address boolean;
  v_theme          jsonb;
  v_settings       jsonb;
  -- ORCH-1296 [chip-in-edit-published-gap] — voluntary chip-in config on EDIT.
  v_rsvp_contribution_enabled boolean;
  v_rsvp_contribution_suggested_cents integer;
  v_rsvp_contribution_min_cents integer;
  -- issue #3827 — structured location (optional `location` payload key).
  v_location_structured boolean := false;
  v_location_venue text;
  v_location_address text;
  -- issue #3827 buyer email — what the edit-notice recorder answered.
  v_notice jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  -- issue #3827 — the reason check is the shared resolver: a 10 to 200
  -- character reason passes as before (business_update_rsvp_graph always
  -- hands one over), a blank reason passes only when nobody has RSVP'd or
  -- paid, and both refusals keep their existing answers.
  IF public.business_resolve_edit_reason(p_event_id, p_reason) IS NULL THEN
    IF v_trimmed_reason = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  SELECT * INTO v_existing FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL
   FOR UPDATE;   -- issue #3827 buyer email: one live edit of an event at a time
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rsvp_not_found';
  END IF;
  IF v_existing.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp'
      USING HINT = 'biz_update_live_rsvp only handles event_type=rsvp rows.';
  END IF;
  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rsvp_not_editable_status');
  END IF;
  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name INTO v_brand FROM public.brands
   WHERE id = v_existing.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'rsvp_title_required';
  END IF;
  v_description := NULLIF(p_payload->>'description', '');
  v_location_text := NULLIF(p_payload->>'location_text', '');
  -- issue #3827 — this function wrote the label only, while the editor and
  -- the public page read theme.business_event.location first, so an edited
  -- venue or address came straight back as the old one. When the payload
  -- carries `location` as an object, both halves are written (below) and the
  -- label is DERIVED from them here, ahead of the material-change compare.
  -- Without the key (an older client) the behaviour is exactly as before.
  IF jsonb_typeof(p_payload->'location') = 'object' THEN
    v_location_structured := true;
    v_location_venue := p_payload #>> '{location,venueName}';
    v_location_address := p_payload #>> '{location,address}';
    v_location_text := public.business_event_location_label(v_location_venue, v_location_address);
  END IF;
  v_online_url := NULLIF(p_payload->>'online_url', '');
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), v_existing.timezone, 'UTC');

  v_visibility := CASE COALESCE(p_payload->>'requestedVisibility', NULL)
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    WHEN 'public' THEN 'public'
    ELSE v_existing.visibility
  END;

  -- RSVP host-control (default to existing when key absent).
  v_rsvp_capacity := CASE WHEN p_payload ? 'rsvpCapacity'
    THEN NULLIF(p_payload->>'rsvpCapacity', '')::integer ELSE v_existing.rsvp_capacity END;
  v_rsvp_allow_plus_ones := COALESCE((p_payload->>'rsvpAllowPlusOnes')::boolean, v_existing.rsvp_allow_plus_ones);
  v_rsvp_plus_ones_max := COALESCE(NULLIF(p_payload->>'rsvpPlusOnesMax', '')::integer, v_existing.rsvp_plus_ones_max);
  v_rsvp_waitlist_enabled := COALESCE((p_payload->>'rsvpWaitlistEnabled')::boolean, v_existing.rsvp_waitlist_enabled);
  v_rsvp_approval_mode := COALESCE(NULLIF(p_payload->>'rsvpApprovalMode', ''), v_existing.rsvp_approval_mode);
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((p_payload->>'rsvpDiscoverable')::boolean, v_existing.rsvp_discoverable);
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- ORCH-1296 [chip-in-edit-published-gap] — voluntary chip-in config reads.
  -- Default each to the currently STORED value when the key is ABSENT: the client
  -- sends a diff payload (a chip-in field only when the organiser changed it), so
  -- an unrelated edit must keep the stored config untouched (mirrors the rsvp_*
  -- COALESCE-to-existing pattern above). enabled is a NOT NULL column; the two
  -- amount columns are nullable (present-but-null clears them).
  v_rsvp_contribution_enabled := COALESCE(
    (p_payload->>'rsvpContributionEnabled')::boolean,
    v_existing.rsvp_contribution_enabled,
    false);
  v_rsvp_contribution_suggested_cents := CASE
    WHEN p_payload ? 'rsvpContributionSuggestedCents'
      THEN NULLIF(p_payload->>'rsvpContributionSuggestedCents', '')::integer
    ELSE v_existing.rsvp_contribution_suggested_cents END;
  v_rsvp_contribution_min_cents := CASE
    WHEN p_payload ? 'rsvpContributionMinCents'
      THEN NULLIF(p_payload->>'rsvpContributionMinCents', '')::integer
    ELSE v_existing.rsvp_contribution_min_cents END;

  -- ORCH-1296 — CONDITIONAL PROVIDER-AWARE bank-gate on EDIT (mirrors
  -- business_publish_rsvp_draft, ORCH-1291). Enabling chip-in flips the RSVP into
  -- a money-collector → the brand MUST be able to collect on EITHER rail.
  -- pg_brand_can_collect is provider-aware (Stripe charges_enabled OR Paystack
  -- subaccount) — reusing the Stripe-only pg_brand_can_charge here would wrongly
  -- block every NGN brand. The gate is CONDITIONAL: when chip-in resolves OFF it
  -- NEVER fires (an organiser can always turn chip-in off; free RSVPs stay
  -- ungated). Raises the ORCH-1075-recognized 'stripe_charges_disabled' reason.
  IF v_rsvp_contribution_enabled AND NOT public.pg_brand_can_collect(v_existing.brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled'
      USING HINT = 'RSVP chip-in is enabled but the brand cannot collect (no connected bank / subaccount).';
  END IF;

  -- Single-date when (optional in payload; default to existing master).
  SELECT start_at INTO v_old_start FROM public.event_dates
   WHERE event_id = p_event_id AND is_master = true LIMIT 1;

  v_when := p_payload->'when';
  IF v_when IS NOT NULL AND NULLIF(v_when->>'date', '') IS NOT NULL THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_new_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_new_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_new_end <= v_new_start THEN
      v_new_end := v_new_end + INTERVAL '1 day';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);
    IF v_old_start IS DISTINCT FROM v_new_start THEN
      v_material_change := true;
    END IF;
  END IF;

  -- Material change = date/time OR venue/location text changed.
  IF v_location_text IS DISTINCT FROM v_existing.location_text THEN
    v_material_change := true;
  END IF;

  -- ORCH-1172 — deep-merge the two privacy toggles into
  -- theme.business_event.settings, PRESERVING every other theme key and every
  -- other settings key. jsonb_set with create_missing=true builds the nested
  -- path if it doesn't exist yet (e.g. a legacy row that never had a settings
  -- object), and only ever replaces the two leaf keys we own.
  v_theme := COALESCE(v_existing.theme, '{}'::jsonb);
  v_private_guest_list := COALESCE(
    (p_payload->>'privateGuestList')::boolean,
    (v_theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
  v_hide_remaining_count := COALESCE(
    (p_payload->>'hideRemainingCount')::boolean,
    (v_theme #>> '{business_event,settings,hideRemainingCount}')::boolean,
    false);
  -- ORCH-1172 R2 — hideAddressUntilTicket lives at
  -- theme.business_event.hideAddressUntilTicket (a DIRECT child of
  -- business_event, NOT under settings). Same default-to-existing pattern.
  v_hide_address := COALESCE(
    (p_payload->>'hideAddressUntilTicket')::boolean,
    (v_theme #>> '{business_event,hideAddressUntilTicket}')::boolean,
    false);

  v_settings := COALESCE(v_theme #> '{business_event,settings}', '{}'::jsonb);
  v_settings := jsonb_set(v_settings, '{privateGuestList}', to_jsonb(v_private_guest_list), true);
  v_settings := jsonb_set(v_settings, '{hideRemainingCount}', to_jsonb(v_hide_remaining_count), true);
  -- Ensure the business_event container exists before writing into it.
  IF v_theme -> 'business_event' IS NULL OR jsonb_typeof(v_theme -> 'business_event') <> 'object' THEN
    v_theme := jsonb_set(v_theme, '{business_event}', '{}'::jsonb, true);
  END IF;
  v_theme := jsonb_set(v_theme, '{business_event,settings}', v_settings, true);
  -- ORCH-1172 R2 — write the hideAddressUntilTicket leaf directly under
  -- business_event (NOT under settings). The container guard above already ran,
  -- so business_event is a guaranteed object; this replaces ONLY that one leaf
  -- and leaves settings + every other business_event/theme key untouched.
  v_theme := jsonb_set(v_theme, '{business_event,hideAddressUntilTicket}', to_jsonb(v_hide_address), true);
  -- issue #3827 — write both structured halves beside the derived label.
  IF v_location_structured THEN
    v_theme := public.business_event_theme_with_location(
      v_theme, v_existing.location_text, true, v_location_venue, true, v_location_address);
  END IF;

  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = NULLIF(p_payload->>'cover_media_url', ''),
    cover_media_type = NULLIF(p_payload->>'cover_media_type', ''),
    visibility = v_visibility,
    timezone = v_timezone,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    -- ORCH-1296 — persist the voluntary chip-in config on EDIT.
    rsvp_contribution_enabled = v_rsvp_contribution_enabled,
    rsvp_contribution_suggested_cents = v_rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents = v_rsvp_contribution_min_cents,
    theme = v_theme,
    updated_at = v_now
  WHERE id = p_event_id;

  -- issue #3827 buyer email — record this edit (who, why, what changed) and
  -- decide whether guests are told through the edit notice. Never raises.
  v_notice := public.event_edit_notice_flush(
    p_event_id, NULLIF(v_trimmed_reason, ''), 'rsvp', false);

  -- Enqueue rsvp_event_updated for every going+approved guest on material change.
  -- issue #3827 buyer email — unchanged whenever the edit notice does not own
  -- this change (the feature is off, the brand is outside the pilot, or the
  -- recorder saw nothing a guest acts on): the rows below are queued exactly
  -- as before, so nothing that alerts a guest today goes silent.
  IF v_material_change AND COALESCE(v_notice->>'handled', 'false') <> 'true' THEN
    FOR v_guest IN
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    LOOP
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (p_event_id, v_guest.id, NULL, NULL, 'pending', 'rsvp_event_updated',
         jsonb_build_object('template_key', 'rsvp_event_updated',
                            'rsvp_id', v_guest.id, 'event_id', p_event_id),
         'rsvp_update:' || p_event_id::text || ':' || extract(epoch FROM v_now)::bigint::text
           || ':' || v_guest.id::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_notified_count := v_notified_count + 1;
    END LOOP;
  ELSIF v_material_change THEN
    -- issue #3827 buyer email — the edit notice reaches these guests;
    -- notified_count keeps its meaning (going and approved guests).
    SELECT count(*) INTO v_notified_count FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_going_count
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND rsvp_status = 'going' AND approval_status = 'approved';

  RETURN jsonb_build_object(
    'ok', true,
    'event', to_jsonb(v_event),
    'going_count', v_going_count,
    'notified_count', v_notified_count,
    'buyer_notice', v_notice   -- issue #3827 buyer email
  );
END;
$$;


-- biz_update_live_experience
--   Body: 20270323001919_issue_1919_provider_neutral_paid_readiness.sql:2844-3473.
--   Hunks: [H0 notice-declare], [H1 notice-flush], [H2 notice-result].

CREATE OR REPLACE FUNCTION public.biz_update_live_experience(p_event_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- issue #3827 buyer email [H0 notice-declare]
  v_notice jsonb;
  v_user_id          uuid;
  v_existing         public.events%ROWTYPE;
  v_brand            record;
  v_now              timestamptz := now();
  v_trimmed_reason   text;
  v_total_sold       int;
  -- header / modes
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_old_resolved     integer;
  -- stops
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_existing_stop_keys text[];
  v_new_stop_keys    text[];
  v_dropped_stops    text[];
  -- single-mode shared place
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  -- dates
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_new_date_starts  timestamptz[];
  v_old_date_starts  timestamptz[];
  v_old_date_ends    timestamptz[];
  v_new_date_ends    timestamptz[];
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across edited dates
  v_dates_changed    boolean := false;
  -- audit
  v_severity         text;
  v_changed_keys     text[];
  v_log_id           uuid;
  v_affected_order_ids uuid[];
  -- return
  v_event            public.events%ROWTYPE;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
BEGIN
  -- ---------- 1. Auth + reason ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Load + permission + status gate ----------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience'
      USING HINT = 'biz_update_live_experience only handles event_type=experience rows.';
  END IF;

  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    -- Draft edits NEVER route here; non-live statuses are rejected so the live
    -- guards can never trip a draft.
    RETURN jsonb_build_object('ok', false, 'reason', 'experience_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 3. Sold-count context ----------
  v_total_sold := public.biz_experience_sold_count(p_event_id);

  -- ---------- 4. Parse payload (mirror biz_publish_experience) ----------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;
  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'experience_description_invalid';
  END IF;

  -- META-ORCH-1059 Sub-E FIX (live-edit dropped the vibe): persist curated
  -- experience_intents on edit, mirroring biz_publish_experience. The wizard
  -- sends p_payload->'experience_intents' (1-4 of the 4 brand ids); validate +
  -- require >=1 so a live/published experience stays deck-eligible. Key absent
  -- => leave existing intents unchanged.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(DISTINCT btrim(elem))
      INTO v_intents
      FROM jsonb_array_elements_text(p_payload->'experience_intents') AS elem
     WHERE btrim(elem) <> '';
  ELSIF p_payload ? 'experience_intent'
        AND NULLIF(btrim(p_payload->>'experience_intent'), '') IS NOT NULL THEN
    v_intents := ARRAY[btrim(p_payload->>'experience_intent')];
  ELSE
    v_intents := v_existing.experience_intents;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF v_intents IS NULL OR array_length(v_intents, 1) IS NULL THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- Live experiences are published: enforce the same 2–5 stop gate.
  IF v_stop_count < 2 OR v_stop_count > 5 THEN
    RAISE EXCEPTION 'experience_stop_count_invalid';
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
  END LOOP;

  -- Resolve the new ONE-ticket total (I-1).
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  -- ---------- 5. REFUND-GATE (only when sold > 0, except capacity) ----------

  -- 5a. Capacity can't drop below sold (applies whenever capacity present).
  IF (p_payload ? 'capacity') AND v_capacity IS NOT NULL AND v_capacity < v_total_sold THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'capacity_below_sold',
      'affected_order_count', v_total_sold
    );
  END IF;

  IF v_total_sold > 0 THEN
    -- 5b. Price lock — the ONE ticket's resolved price can't change once sold.
    SELECT price_cents INTO v_old_resolved
    FROM public.ticket_types
    WHERE event_id = p_event_id AND deleted_at IS NULL
    ORDER BY display_order ASC
    LIMIT 1;
    v_old_resolved := COALESCE(v_old_resolved, 0);

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'price_change_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- 5c. Stop removal — removing an existing (by name) stop is destructive.
    SELECT array_agg(lower(btrim(place_name)))
      INTO v_existing_stop_keys
      FROM public.experience_stops
      WHERE event_id = p_event_id;
    v_existing_stop_keys := COALESCE(v_existing_stop_keys, '{}'::text[]);

    SELECT array_agg(lower(btrim(s->>'place_name')))
      INTO v_new_stop_keys
      FROM jsonb_array_elements(v_stops) s;
    v_new_stop_keys := COALESCE(v_new_stop_keys, '{}'::text[]);

    v_dropped_stops := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_stop_keys) k
      WHERE NOT (k = ANY (v_new_stop_keys))
    );

    IF array_length(v_dropped_stops, 1) > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'stop_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_stops', to_jsonb(v_dropped_stops)
      );
    END IF;
  END IF;

  -- ---------- 6. Resolve the date model + date-shift gate ----------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');

  -- ORCH-1153 WS1 SEED-HARDENING (F-4). A stale client seed can send a recurring
  -- whenMode but a NULL recurrence_rules (e.g. firstRecurrenceRule returned null
  -- on an unexpected jsonb shape). Below, the unconditional DELETE FROM
  -- event_dates re-materialises only when recurrence_rules IS NOT NULL — so a
  -- dropped rule would collapse the expansion to its master. Re-derive the rule
  -- from the PERSISTED events.recurrence_rules rather than wiping the series. Net:
  -- a live-edit that omits the rule can never silently drain a recurring series.
  IF v_is_recurring
     AND v_recurrence_rules IS NULL
     AND v_existing.is_recurring = true
     AND v_existing.recurrence_rules IS NOT NULL THEN
    v_recurrence_rules := v_existing.recurrence_rules;
  END IF;

  IF v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- Build the proposed occurrence start/end arrays (sorted by start).
  IF v_when_mode IN ('single','recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    v_new_date_starts := ARRAY[v_start];
    v_new_date_ends   := ARRAY[v_end];
  ELSE
    IF v_multi_dates IS NULL
       OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_multi_dates) = 0 THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_new_date_starts := '{}'::timestamptz[];
    v_new_date_ends := '{}'::timestamptz[];
    FOR v_date_entry IN
      SELECT value FROM jsonb_array_elements(v_multi_dates)
      ORDER BY (value->>'date'), (value->>'startTime')
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      v_new_date_starts := v_new_date_starts || v_start;
      v_new_date_ends := v_new_date_ends || v_end;
    END LOOP;
  END IF;


  -- ORCH-1075 paid-publish integrity guards (experience live-edit) --------
  -- Q3: block ANY resulting PAID state while not Stripe-ready (free->paid AND
  -- paid->paid), and block shifting onto an already-past date. Structured
  -- return shape matches this RPC. FREE edits are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF NOT v_is_free AND v_resolved_total > 0 THEN
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    SELECT max(d) INTO v_max_end FROM unnest(v_new_date_ends) AS d;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- Date-shift gate (only with sales). Compare against current event_dates.
  IF v_total_sold > 0 THEN
    SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
      INTO v_old_date_starts, v_old_date_ends
      FROM public.event_dates
      WHERE event_id = p_event_id;
    v_old_date_starts := COALESCE(v_old_date_starts, '{}'::timestamptz[]);
    v_old_date_ends   := COALESCE(v_old_date_ends, '{}'::timestamptz[]);

    IF COALESCE(array_length(v_old_date_starts, 1), 0)
         IS DISTINCT FROM COALESCE(array_length(v_new_date_starts, 1), 0) THEN
      v_dates_changed := true;
    ELSE
      FOR v_idx IN 1 .. COALESCE(array_length(v_old_date_starts, 1), 0)
      LOOP
        IF v_old_date_starts[v_idx] IS DISTINCT FROM v_new_date_starts[v_idx]
           OR v_old_date_ends[v_idx] IS DISTINCT FROM v_new_date_ends[v_idx] THEN
          v_dates_changed := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_dates_changed THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', (
          SELECT COALESCE(jsonb_agg(to_char(d AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::jsonb)
          FROM unnest(v_old_date_starts) d
        )
      );
    END IF;
  END IF;

  -- ---------- 7. APPLY (all gates passed) ----------
  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
  END IF;

  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    experience_intents = v_intents,
    experience_intent  = v_intent,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    theme             = jsonb_set(
                          COALESCE(theme, '{}'::jsonb),
                          '{experience_meta,venue_text}',
                          to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- Replace experience_stops.
  DELETE FROM public.experience_stops WHERE event_id = p_event_id;
  v_idx := 0;
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;

    INSERT INTO public.experience_stops (
      event_id, stop_order, place_id, place_name, address,
      city, region, country_code, lat, lng,
      image_urls, start_time, price_cents, ai_description
    ) VALUES (
      p_event_id,
      COALESCE((v_stop->>'stop_order')::integer, v_idx),
      v_s_place_id,
      btrim(v_stop->>'place_name'),
      COALESCE(v_s_address, ''),
      v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
      v_s_images, v_s_start, v_s_price,
      COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- Rewrite the ONE ticket (I-1). Preserve identity by UPDATEing the live ticket
  -- in place (so existing order_line_items.ticket_type_id stays valid) rather
  -- than soft-delete + insert.
  UPDATE public.ticket_types SET
    name           = 'Standard',
    price_cents    = v_resolved_total,
    currency       = v_currency,
    quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
    is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
    is_free        = (v_resolved_total = 0),
    updated_at     = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  -- Re-materialise event_dates (gated above; safe to replace).
  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  v_min_start := NULL;
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    IF v_min_start IS NULL OR v_new_date_starts[v_idx] < v_min_start THEN
      v_min_start := v_new_date_starts[v_idx];
    END IF;
  END LOOP;
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (
      p_event_id, v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone,
      v_new_date_starts[v_idx] = v_min_start
    );
  END LOOP;
  v_next_occurrence := v_min_start;

  -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION on live-edit. The master
  -- row(s) are re-materialised above; for a `recurring` rule, expand the 2nd..Nth
  -- bookable occurrences (bounded 52-cap, OQ-1; NO cron). The DELETE above already
  -- cleared the prior rows, so the expander only ADDS the repeats. single/multi_date
  -- stay as materialised. I-4 preserved. No checkout change.
  IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
    PERFORM public.pg_expand_experience_recurrence(
      p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
    );

    -- ORCH-1153 WS1 live-edit DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN). After
    -- re-materialisation a recurring experience must never have zero future
    -- occurrences (unless the rule is count-exhausted / until-expired). Blocks a
    -- live-edit that would shift the master into the past with a non-productive
    -- rule. count/until series whose window legitimately closed are EXEMPT.
    IF NOT EXISTS (
          SELECT 1 FROM public.event_dates ed
          WHERE ed.event_id = p_event_id AND ed.start_at > v_now
        )
       AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
    THEN
      RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
    END IF;
  END IF;

  IF v_next_occurrence IS NOT NULL THEN
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{experience_meta,next_occurrence_at}',
          to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          true
        ),
        updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- ---------- 8. Audit log ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_payload));

  IF (p_payload ? 'capacity' OR p_payload ? 'stops' OR p_payload ? 'whenMode'
      OR p_payload ? 'whole_price_cents' OR p_payload ? 'pricing_mode') THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.experience_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_existing.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    jsonb_build_object('changed_keys', to_jsonb(v_changed_keys)),
    v_affected_order_ids,
    v_now
  ) RETURNING id INTO v_log_id;

  -- issue #3827 buyer email [H1 notice-flush]
  v_notice := public.event_edit_notice_flush(p_event_id, v_trimmed_reason, 'experience', false);

  -- ---------- 9. Return payload (mirror biz_publish_experience shape) ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    -- issue #3827 buyer email [H2 notice-result]
    'buyer_notice', v_notice
  );
END;
$function$
;

-- Fail the migration, not a later save, if anything is not what was meant.
DO $verify$
DECLARE
  v_src text;
  v_fn text;
  v_a jsonb := '{"kind":"event","format":"in_person","venue":"A","venue_fp":"a","address":"1 St","address_fp":"x","address_withheld":false,"online_fp":null,"timezone":"UTC","dates":[{"s":"2027-01-01T18:00:00Z","e":"2027-01-01T22:00:00Z"}]}'::jsonb;
BEGIN
  -- Ships switched off, with both guards behind the switch.
  IF COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email'), true)
     OR COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_all_brands'), true)
     OR NOT COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_allowlist_only'), false)
     OR EXISTS (SELECT 1 FROM public.event_update_email_pilot_brands)
     OR EXISTS (SELECT 1 FROM public.event_update_email_allowlist) THEN
    RAISE EXCEPTION 'issue_3827_verify: the buyer email must ship off, allowlist-only, with an empty pilot and an empty allowlist';
  END IF;

  -- The buyer category can only ever email.
  IF (SELECT default_channels FROM public.notification_categories WHERE key = 'buyer_event_updated')
       IS DISTINCT FROM ARRAY['email']::text[] THEN
    RAISE EXCEPTION 'issue_3827_verify: buyer_event_updated must be email only';
  END IF;

  -- No client role reaches an internal function or table.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.event_edit_notice_brand_live(uuid)',
    'public.business_event_notice_snapshot(uuid)',
    'public.event_edit_notice_scrub(jsonb, boolean)',
    'public.event_edit_notice_diff(jsonb, jsonb)',
    'public.business_event_buyer_rows(uuid)',
    'public.event_edit_notice_audience(uuid)',
    'public.business_event_record_edit_notice(uuid, uuid, text, jsonb, jsonb, text, boolean)',
    'public.event_edit_notice_record_failure(uuid, uuid, text, text)',
    'public.event_edit_notice_capture(uuid)',
    'public.event_edit_notice_flush(uuid, text, text, boolean)',
    'public.event_edit_notice_fanout(integer)',
    'public.event_edit_notice_withhold_changes(jsonb, boolean)',
    'public.event_edit_notice_withhold_unsent(uuid)']
  LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue_3827_verify: % is callable by a client role', v_fn;
    END IF;
  END LOOP;
  IF pg_catalog.has_function_privilege('anon', 'public.business_event_buyer_notice_status(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.business_event_buyer_notice_status(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.event_edit_notice_fanout(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3827_verify: the status read must be for signed-in hosts only and the fan-out for the service role';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.event_edit_notices', 'public.event_edit_notice_pending',
    'public.event_update_email_pilot_brands', 'public.event_update_email_allowlist']
  LOOP
    IF pg_catalog.has_table_privilege('anon', v_fn, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', v_fn, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', v_fn, 'INSERT')
       OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_fn::pg_catalog.regclass) THEN
      RAISE EXCEPTION 'issue_3827_verify: % is reachable by a client role or has row security off', v_fn;
    END IF;
  END LOOP;

  -- The leaves and the tables stay writable by signed-in hosts (old builds call
  -- business_patch_event_taxonomy and business_patch_event_when directly, and
  -- row policies allow table writes), so the notice is recorded by triggers,
  -- not by hooking the leaves. All four must be in place and enabled.
  IF (SELECT count(*) FROM pg_catalog.pg_trigger AS t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
         AND (t.tgrelid, t.tgname) IN (
           ('public.events'::pg_catalog.regclass, 'issue_3827_capture_edit_notice'),
           ('public.event_dates'::pg_catalog.regclass, 'issue_3827_capture_edit_notice_dates'),
           ('public.experience_stops'::pg_catalog.regclass, 'issue_3827_capture_edit_notice_stops'),
           ('public.event_edit_notice_pending'::pg_catalog.regclass, 'issue_3827_settle_edit_notice'))) <> 4 THEN
    RAISE EXCEPTION 'issue_3827_verify: a capture or settle trigger is missing or disabled';
  END IF;
  IF NOT (SELECT t.tgdeferrable AND t.tginitdeferred FROM pg_catalog.pg_trigger AS t
           WHERE t.tgrelid = 'public.event_edit_notice_pending'::pg_catalog.regclass
             AND t.tgname = 'issue_3827_settle_edit_notice') THEN
    RAISE EXCEPTION 'issue_3827_verify: the settle trigger must be deferred to commit';
  END IF;

  -- The diff: nothing for equal values or an added date; a lost date, a venue
  -- and an address are material; a withheld address carries no value.
  IF public.event_edit_notice_diff(v_a, v_a) <> '[]'::jsonb
     OR public.event_edit_notice_diff(v_a, v_a || '{"dates":[{"s":"2027-01-01T18:00:00Z","e":"2027-01-01T22:00:00Z"},{"s":"2027-01-08T18:00:00Z","e":"2027-01-08T22:00:00Z"}]}'::jsonb) <> '[]'::jsonb
     OR public.event_edit_notice_diff(v_a, v_a || '{"dates":[{"s":"2027-01-02T18:00:00Z","e":"2027-01-02T22:00:00Z"}]}'::jsonb) #>> '{0,field}' IS DISTINCT FROM 'dates'
     OR public.event_edit_notice_diff(v_a, v_a || '{"address":"2 St","address_fp":"y"}'::jsonb) #>> '{0,new}' IS DISTINCT FROM '2 St'
     OR public.event_edit_notice_diff(v_a, v_a || '{"format":"hybrid"}'::jsonb) #>> '{0,field}' IS DISTINCT FROM 'format'
     OR public.event_edit_notice_diff(v_a - 'format', v_a) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'issue_3827_verify: event_edit_notice_diff does not decide what is material as specified';
  END IF;
  v_src := public.event_edit_notice_diff(
    public.event_edit_notice_scrub(v_a, true),
    public.event_edit_notice_scrub(v_a || '{"address":"2 St","address_fp":"y"}'::jsonb, true))::text;
  IF pg_catalog.strpos(v_src, '"withheld": true') = 0
     OR pg_catalog.strpos(v_src, '1 St') > 0 OR pg_catalog.strpos(v_src, '2 St') > 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: a withheld address reached a notice';
  END IF;

  -- business_update_live_event_atomic: flushes with the resolved reason and
  -- still resolves it.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.business_update_live_event_atomic(uuid, jsonb, text, integer)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'event_edit_notice_flush') = 0
     OR pg_catalog.strpos(v_src, '''buyer_notice'',v_notice') = 0
     OR pg_catalog.strpos(v_src, 'acknowledgeSoldImpact') = 0
     OR pg_catalog.strpos(v_src, 'business_resolve_edit_reason') = 0
     OR pg_catalog.strpos(v_src, 'v_core_without_tickets,p_reason') > 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_update_live_event_atomic does not record the edit notice, or lost the reason resolver';
  END IF;

  -- biz_update_live_rsvp: flushes, keeps today's guest queue for a change the
  -- notice does not own, and keeps every earlier hunk.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.biz_update_live_rsvp(uuid, jsonb, text)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'event_edit_notice_flush') = 0
     OR pg_catalog.strpos(v_src, '''rsvp_update:''') = 0
     OR pg_catalog.strpos(v_src, 'v_notice->>''handled''') = 0
     OR pg_catalog.strpos(v_src, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_src, '''notified_count'', v_notified_count') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: biz_update_live_rsvp does not record the edit notice, or lost the guest queue it must keep while the feature is off';
  END IF;
  IF pg_catalog.strpos(v_src, 'business_resolve_edit_reason') = 0
     OR pg_catalog.strpos(v_src, 'business_event_theme_with_location') = 0
     OR pg_catalog.strpos(v_src, 'pg_brand_can_collect') = 0
     OR pg_catalog.strpos(v_src, 'stripe_charges_disabled') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: biz_update_live_rsvp lost the reason resolver, the structured location or the chip-in refusal';
  END IF;

  -- biz_update_live_experience: the three hunks, and its sold-ticket refusals.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.biz_update_live_experience(uuid, jsonb, text)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, '[H0 notice-declare]') = 0
     OR pg_catalog.strpos(v_src, '[H1 notice-flush]') = 0
     OR pg_catalog.strpos(v_src, '[H2 notice-result]') = 0
     OR pg_catalog.strpos(v_src, 'dates_shifted_with_sales') = 0
     OR pg_catalog.strpos(v_src, 'stop_removed_with_sales') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: biz_update_live_experience does not record the edit notice, or lost a sold-ticket refusal';
  END IF;
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
