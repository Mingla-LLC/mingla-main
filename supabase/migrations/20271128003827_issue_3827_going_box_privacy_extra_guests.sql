-- =====================================================================================
-- issue #3827 going-box — a private guest list hides the going box, and hosts can add
-- the guests on their own list.
--
-- WHAT BUYERS SAW: "Private guest list" only hid the avatars. The going count, the
-- meter and "N spots left" still showed, and the server returned the count to anyone
-- (pg_public_social_proof.goingCount, business_public_events_view.rsvp_going_count,
-- pg_public_rsvp_by_slug.rsvpGoingCount and its publicEventRow).
--
-- WHAT THIS FILE DOES:
--   1. Two total helpers (never raise on a malformed theme):
--        issue_3827_private_guest_list(theme)  -> boolean
--        issue_3827_extra_guest_count(theme)   -> integer 0..5000 (else 0)
--   2. CHECK events_extra_guest_count_valid: theme.business_event.settings.extraGuestCount
--      is absent / JSON null, or a whole JSON number 0..5000. One guard over every
--      write path (publish, autosave, live edits, the leaf, Ari, anything later).
--   3. The three public reads withhold the real count (SQL NULL, never 0) when the list
--      is private, and add the host's own-list guests (0 when private) and a full
--      flag computed from the REAL count:
--        pg_public_social_proof      + extraGuestCount, capacityFull (keys appended last)
--        business_public_events_view + rsvp_capacity_full, extra_guest_count (columns
--                                      appended last; every existing ordinal kept)
--        pg_public_rsvp_by_slug      the same two columns ride INSIDE publicEventRow
--                                      only. No new top-level key (U-01d/e pin it).
--   4. biz_set_event_guest_privacy gains p_extra_guest_count (DEFAULT NULL = keep).
--      DROP + CREATE: the old 3-arg overload must go, or 3-arg calls turn ambiguous.
--      Every caller (business app named params, Ari positional 2/3 args, the live
--      editor) resolves to the new function through the defaults.
--   5. business_update_live_event and biz_update_live_rsvp carry extraGuestCount.
--
-- RULE (binding): extras are added to the going NUMBER only. They never enter
-- capacity, spots left, the meter, full / sold out, checkout or submit. The real
-- count stays the only supply truth (capacityFull / rsvp_capacity_full use it).
--
-- Every re-emit copies the latest definition forward byte for byte (read back from
-- production 2026-10-20: md5(prosrc) equal for all five functions). Changed hunks are
-- marked `issue #3827 going-box`. Latest definers:
--   pg_public_social_proof      20270413001931_issue_1931_private_event_access.sql
--   pg_public_rsvp_by_slug      20270709000000_unlisted_rsvp_invite_link.sql
--   business_public_events_view 20270523002489_issue_2489_address_privacy_server_gate.sql
--   biz_set_event_guest_privacy 20261226000000_orch_1339_set_event_guest_privacy.sql
--   business_update_live_event  20270828003827_issue_3827_live_edit_location_one_owner.sql
--   biz_update_live_rsvp        20271014103827_issue_3827_live_edit_buyer_email.sql
--
-- NOT touched on purpose: the publish RPCs (they copy business_draft.settings as it
-- stands), business_update_rsvp_graph, biz_update_live_trip / _experience (they write
-- privacy through the leaf only, COMMS-0029 class), pg_public_event_by_slug,
-- pg_direct_event_checkout_bundle, pg_public_ticket_types_remaining (checkout needs
-- per-tier remaining), submit_event_rsvp, and the edit-notice snapshot (privacy and
-- extras are display-only and never notify buyers).
--
-- DEPLOY: apply through the surgical lane right after merge, read every definition back.
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- 1 — helpers. Not SECURITY DEFINER (the frozen anon-definer allowlist is untouched).
-- EXECUTE goes to anon/authenticated/service_role exactly like issue_2489_address_withheld:
-- business_public_events_view runs these as the READER, so a revoked helper raises
-- "permission denied" for every public page (proved by #2489 TA-3 on the local replay).
-- They are pure functions of a theme value the caller already holds; nothing leaks.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3827_private_guest_list(p_theme jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  -- true only for a JSON boolean true; any other shape (absent, null, string,
  -- number, a non-object theme) is false. Total: never raises.
  SELECT COALESCE(
    (p_theme #> '{business_event,settings,privateGuestList}') = 'true'::jsonb,
    false)
$function$;

CREATE OR REPLACE FUNCTION public.issue_3827_extra_guest_count(p_theme jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  -- The whole JSON number 0..5000 at business_event.settings.extraGuestCount, else 0.
  -- CASE orders evaluation: the type test always runs before any cast. Total.
  SELECT CASE
    WHEN COALESCE(jsonb_typeof(p_theme #> '{business_event,settings,extraGuestCount}'), 'absent') <> 'number' THEN 0
    WHEN (p_theme #>> '{business_event,settings,extraGuestCount}')::numeric < 0
      OR (p_theme #>> '{business_event,settings,extraGuestCount}')::numeric > 5000 THEN 0
    WHEN (p_theme #>> '{business_event,settings,extraGuestCount}')::numeric
      <> trunc((p_theme #>> '{business_event,settings,extraGuestCount}')::numeric) THEN 0
    ELSE (p_theme #>> '{business_event,settings,extraGuestCount}')::numeric::integer
  END
$function$;

REVOKE ALL ON FUNCTION public.issue_3827_private_guest_list(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3827_extra_guest_count(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_3827_private_guest_list(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3827_extra_guest_count(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.issue_3827_private_guest_list(jsonb) IS
  'issue #3827 going-box — true only when theme.business_event.settings.privateGuestList '
  'is the JSON boolean true. Total over every jsonb shape. The one reader of the private '
  'flag for the public going-count reads.';
COMMENT ON FUNCTION public.issue_3827_extra_guest_count(jsonb) IS
  'issue #3827 going-box — guests on the host''s own list: the whole JSON number 0..5000 at '
  'theme.business_event.settings.extraGuestCount, else 0. Added to the going NUMBER only; '
  'never to capacity, spots left, full, checkout or submit.';

-- -------------------------------------------------------------------------------------
-- 2 — CHECK: one guard over every write path. Existing rows carry no key (probed on
-- production 2026-10-20: 174 of 174 absent), so VALIDATE passes.
-- -------------------------------------------------------------------------------------
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_extra_guest_count_valid;
ALTER TABLE public.events ADD CONSTRAINT events_extra_guest_count_valid CHECK (
  CASE
    WHEN COALESCE(jsonb_typeof(theme #> '{business_event,settings,extraGuestCount}'), 'null') = 'null' THEN true
    WHEN jsonb_typeof(theme #> '{business_event,settings,extraGuestCount}') <> 'number' THEN false
    WHEN (theme #>> '{business_event,settings,extraGuestCount}')::numeric < 0
      OR (theme #>> '{business_event,settings,extraGuestCount}')::numeric > 5000 THEN false
    ELSE (theme #>> '{business_event,settings,extraGuestCount}')::numeric
       = trunc((theme #>> '{business_event,settings,extraGuestCount}')::numeric)
  END
) NOT VALID;
ALTER TABLE public.events VALIDATE CONSTRAINT events_extra_guest_count_valid;

COMMENT ON CONSTRAINT events_extra_guest_count_valid ON public.events IS
  'issue #3827 going-box — theme.business_event.settings.extraGuestCount is absent, JSON '
  'null, or a whole number 0..5000 (I-PROPOSED-3827-EXTRAS-BOUNDED). The business app '
  'maps SQLSTATE 23514 on this name to "Enter a number from 0 to 5,000."';

-- -------------------------------------------------------------------------------------
-- 3 — biz_set_event_guest_privacy: + p_extra_guest_count (DEFAULT NULL = keep).
-- Body: 20261226000000_orch_1339_set_event_guest_privacy.sql. Guard order unchanged,
-- then the range guard, then the no-clobber leaf write.
-- -------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_set_event_guest_privacy(uuid, boolean, boolean);
-- Re-apply safe: a second run replaces the new signature instead of colliding.
DROP FUNCTION IF EXISTS public.biz_set_event_guest_privacy(uuid, boolean, boolean, integer);

CREATE FUNCTION public.biz_set_event_guest_privacy(
  p_event_id uuid,
  p_private_guest_list boolean DEFAULT NULL,
  p_hide_remaining_count boolean DEFAULT NULL,
  p_extra_guest_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid      uuid;
  v_event    record;
  v_theme    jsonb;
  v_settings jsonb;
  v_private  boolean;
  v_hide     boolean;
  v_extra    integer;  -- issue #3827 going-box
BEGIN
  -- GUARD 1 — authed callers only. RAISE before ANY data read.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- GUARD 2 — load the event row (any event_type; not-deleted).
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- GUARD 3 — host gate (the exact 1334/1150 event_manager predicate).
  IF public.biz_brand_effective_rank(v_event.brand_id, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- GUARD 4 — issue #3827 going-box: guests on the host's own list, 0..5000.
  IF p_extra_guest_count IS NOT NULL
     AND (p_extra_guest_count < 0 OR p_extra_guest_count > 5000) THEN
    RAISE EXCEPTION 'invalid_extra_guest_count';
  END IF;

  -- ORCH-1172/1296 no-clobber leaf write: COALESCE each param → existing theme
  -- leaf → false; jsonb_set (create_missing=true) ONLY the owned leaf keys
  -- under business_event.settings, preserving every other theme key and every
  -- other settings key.
  v_theme := COALESCE(v_event.theme, '{}'::jsonb);
  v_private := COALESCE(
    p_private_guest_list,
    (v_theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
  v_hide := COALESCE(
    p_hide_remaining_count,
    (v_theme #>> '{business_event,settings,hideRemainingCount}')::boolean,
    false);
  v_extra := COALESCE(
    p_extra_guest_count,
    public.issue_3827_extra_guest_count(v_theme));

  v_settings := COALESCE(v_theme #> '{business_event,settings}', '{}'::jsonb);
  v_settings := jsonb_set(v_settings, '{privateGuestList}', to_jsonb(v_private), true);
  v_settings := jsonb_set(v_settings, '{hideRemainingCount}', to_jsonb(v_hide), true);
  v_settings := jsonb_set(v_settings, '{extraGuestCount}', to_jsonb(v_extra), true);
  -- Ensure the business_event container exists before writing into it.
  IF v_theme -> 'business_event' IS NULL OR jsonb_typeof(v_theme -> 'business_event') <> 'object' THEN
    v_theme := jsonb_set(v_theme, '{business_event}', '{}'::jsonb, true);
  END IF;
  v_theme := jsonb_set(v_theme, '{business_event,settings}', v_settings, true);

  UPDATE public.events
     SET theme = v_theme,
         updated_at = now()
   WHERE id = p_event_id;

  -- The FINAL persisted values — the client trusts the echo.
  RETURN jsonb_build_object(
    'privateGuestList', v_private,
    'hideRemainingCount', v_hide,
    'extraGuestCount', v_extra
  );
END;
$function$;

COMMENT ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean, integer) IS
  'ORCH-1339 + issue #3827 — host-gated (event_manager rank) no-clobber leaf write for the '
  'guest-privacy display settings: theme.business_event.settings.privateGuestList / '
  '.hideRemainingCount / .extraGuestCount (0..5000, guests on the host''s own list). '
  'Guard-first: authentication_required → event_not_found → not_authorized → '
  'invalid_extra_guest_count. NULL param = keep existing (partial update); returns the '
  'final persisted values. Replaces ONLY the owned leaf keys; every sibling theme/settings '
  'key byte-survives. NEVER re-emit the big trip/experience edit RPCs for these keys '
  '(COMMS-0029 clobber class).';

-- DROP + CREATE loses the old revoke and Supabase default privileges grant anon again
-- (20261227000000_orch_1338_p2 posture restated for the new signature).
REVOKE ALL ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean, integer) TO authenticated;

-- -------------------------------------------------------------------------------------
-- 4 — pg_public_social_proof. Body: 20270413001931_issue_1931_private_event_access.sql.
-- Same signature: grants and the allowlisted anon EXECUTE survive.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_public_social_proof(
  p_event_id uuid
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event          record;
  v_private        boolean;
  v_hide_remaining boolean;
  v_viewer         uuid;
  v_going          bigint  := 0;
  v_capacity       integer := NULL;
  v_sample         json    := '[]'::json;
  v_extra          integer := 0;      -- issue #3827 going-box
  v_full           boolean := false;  -- issue #3827 going-box
BEGIN
  -- GUARD 1 — resolve the event row (public + live-page status set; no data
  -- read happens unless this passes).
  SELECT e.id, e.event_type, e.rsvp_capacity, e.theme
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public'::text
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
     AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- GUARD 2 — host gates, read server-side from the resolved row (D2).
  -- issue #3827 going-box — total helper (never raises on a malformed theme).
  v_private := public.issue_3827_private_guest_list(v_event.theme);
  v_hide_remaining := COALESCE(
    (v_event.theme #>> '{business_event,settings,hideRemainingCount}')::boolean,
    false);

  -- GUARD 3 — viewer (NULL for anon). Drives block-exclusion of the sample
  -- only; the anon and authed payload SHAPES are identical (D1).
  v_viewer := auth.uid();

  IF v_event.event_type = 'rsvp' THEN
    -- [ORCH-1338 FN-A RSVP-BRANCH-BEGIN] (COMMS-0057: reads event_rsvps ONLY)
    -- Going = SUM(1 + plus_count) over going+approved rows — byte-identical to
    -- pg_public_rsvp_by_slug / submit_event_rsvp (ORCH-1150 maybe = cap-neutral).
    SELECT COALESCE(SUM(1 + r.plus_count), 0)
      INTO v_going
      FROM public.event_rsvps r
     WHERE r.event_id = v_event.id
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved';

    v_capacity := v_event.rsvp_capacity; -- NULL = unlimited (open invite).

    IF NOT v_private THEN
      -- Avatar-cluster sample: first-in going+approved LINKED guests whose
      -- profile is non-private AND carries a real avatar (glyph fill comes
      -- from the count client-side — 15% avatar reality, F-6/F-11).
      SELECT COALESCE(json_agg(json_build_object(
               'avatarUrl', s.avatar_url,
               'isMinglaUser', true
             ) ORDER BY s.sort_created_at ASC, s.sort_row_id ASC), '[]'::json)
        INTO v_sample
        FROM (
          SELECT p.avatar_url,
                 r.created_at AS sort_created_at,
                 r.id         AS sort_row_id
            FROM public.event_rsvps r
            JOIN public.profiles p ON p.id = r.user_id
           WHERE r.event_id = v_event.id
             AND r.rsvp_status = 'going'
             AND r.approval_status = 'approved'
             AND r.user_id IS NOT NULL
             AND p.visibility_mode IN ('public', 'friends')
             AND p.avatar_url IS NOT NULL
             AND length(btrim(p.avatar_url)) > 0
             AND (
               v_viewer IS NULL
               OR (NOT public.is_blocked_by(p.id, v_viewer)
                   AND NOT public.is_blocked_by(v_viewer, p.id))
             )
           ORDER BY r.created_at ASC, r.id ASC
           LIMIT 5
        ) s;
    END IF;
    -- [ORCH-1338 FN-A RSVP-BRANCH-END]
  ELSE
    -- [ORCH-1338 FN-A TICKETED-BRANCH-BEGIN] (COMMS-0057: reads tickets /
    -- ticket_types / orders ONLY — event / trip / experience)
    -- Going = ABSOLUTE count of live tickets (ORCH-0946 sold formula, matches
    -- biz_ticket_checkout_create_session). Computed under DEFINER — this is
    -- the F-3 fix: no more deriving sold from per-tier remaining, no
    -- unlimited-capacity hole.
    SELECT COUNT(*)
      INTO v_going
      FROM public.tickets t
     WHERE t.event_id = v_event.id
       AND t.status IN ('valid', 'used', 'transferred');

    -- Capacity: NULL iff ANY non-deleted tier is unlimited/uncapped (rule 9 —
    -- scarcity is never fabricated from partial capacity), else Σ quantity_total.
    SELECT CASE
             WHEN EXISTS (
               SELECT 1
                 FROM public.ticket_types tt
                WHERE tt.event_id = v_event.id
                  AND tt.deleted_at IS NULL
                  AND (COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL)
             ) THEN NULL
             ELSE (
               SELECT SUM(tt.quantity_total)::integer
                 FROM public.ticket_types tt
                WHERE tt.event_id = v_event.id
                  AND tt.deleted_at IS NULL
             )
           END
      INTO v_capacity;

    IF NOT v_private THEN
      -- Sample = DISTINCT order BUYERS owning ≥1 live ticket (D3: buyers only;
      -- seats carry no identity), first-in by earliest order, same profile
      -- privacy + avatar + block predicates as the RSVP branch.
      SELECT COALESCE(json_agg(json_build_object(
               'avatarUrl', s.avatar_url,
               'isMinglaUser', true
             ) ORDER BY s.first_order_at ASC, s.buyer_id ASC), '[]'::json)
        INTO v_sample
        FROM (
          SELECT p.avatar_url,
                 buyers.first_order_at,
                 buyers.buyer_id
            FROM (
              SELECT o.buyer_user_id     AS buyer_id,
                     MIN(o.created_at)   AS first_order_at
                FROM public.orders o
                JOIN public.tickets t
                  ON t.order_id = o.id
                 AND t.status IN ('valid', 'used', 'transferred')
               WHERE o.event_id = v_event.id
                 AND o.buyer_user_id IS NOT NULL
               GROUP BY o.buyer_user_id
            ) buyers
            JOIN public.profiles p ON p.id = buyers.buyer_id
           WHERE p.visibility_mode IN ('public', 'friends')
             AND p.avatar_url IS NOT NULL
             AND length(btrim(p.avatar_url)) > 0
             AND (
               v_viewer IS NULL
               OR (NOT public.is_blocked_by(p.id, v_viewer)
                   AND NOT public.is_blocked_by(v_viewer, p.id))
             )
           ORDER BY buyers.first_order_at ASC, buyers.buyer_id ASC
           LIMIT 5
        ) s;
    END IF;
    -- [ORCH-1338 FN-A TICKETED-BRANCH-END]
  END IF;

  -- issue #3827 going-box — guests on the host's own list (0 when private) and
  -- the full flag, computed from the REAL count before any withholding. Extras
  -- never enter capacity or full: they never consume a Mingla spot.
  v_extra := CASE WHEN v_private THEN 0
                  ELSE public.issue_3827_extra_guest_count(v_event.theme) END;
  v_full := v_capacity IS NOT NULL AND v_going >= v_capacity;

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    -- issue #3827 going-box — a private list withholds the count (NULL, never 0).
    'goingCount', CASE WHEN v_private THEN NULL ELSE v_going END,
    'capacity', v_capacity,
    'privateGuestList', v_private,
    'hideRemainingCount', v_hide_remaining,
    'sample', v_sample,
    'extraGuestCount', v_extra,      -- issue #3827 going-box
    'capacityFull', v_full           -- issue #3827 going-box
  );
END;
$function$;

COMMENT ON FUNCTION public.pg_public_social_proof(uuid) IS
  'ORCH-1338 + issue #3827 — public social-proof summary for one public event. When the '
  'host keeps the guest list private, goingCount is NULL (withheld, never 0) and sample is '
  '[]. extraGuestCount = guests on the host''s own list (0 when private; going number '
  'only). capacityFull is computed from the REAL count and never reveals it. Keys are '
  'appended last; never reorder them.';

-- -------------------------------------------------------------------------------------
-- 5 — pg_public_rsvp_by_slug. Body: 20270709000000_unlisted_rsvp_invite_link.sql.
-- A #2489 gate carrier: the issue_2489_* and issue_1931_* clauses are verbatim.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_provider,
      e.cover_media_credit,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      -- RSVP host-control columns (ORCH-1150 mig 20261004000000).
      e.rsvp_capacity,
      e.rsvp_allow_plus_ones,
      e.rsvp_plus_ones_max,
      e.rsvp_waitlist_enabled,
      e.rsvp_approval_mode,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      -- issue #3827 going-box — read by the #3827 helpers only; never emitted.
      e.theme AS raw_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb). Default
      -- TRUE when absent so a legacy row never leaks the street (mirror the event RPC).
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'rsvp'            -- RSVP ONLY (SPEC scope)
      -- Unlisted (hidden) RSVPs open from their invite link, like #1929 did for
      -- ticketed events. Private stays closed: its access grants are not live (#2144).
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      -- Same containment the ticketed exact-link reader and the public view apply.
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  going AS (
    -- Confirmed-going headcount: SUM(1 + plus_count) over going+approved rows.
    -- Byte-identical to submit_event_rsvp's capacity predicate (maybe excluded =
    -- cap-neutral, ORCH-1150).
    SELECT COALESCE(SUM(1 + r.plus_count), 0) AS going_count
      FROM public.event_rsvps r
      JOIN ev ON ev.id = r.event_id
     WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng}.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      -- RSVP host-control block (REPLACES the event RPC's `tickets` aggregate).
      -- issue #3827 going-box — a private list withholds the count (NULL, never 0).
      'rsvpGoingCount', CASE WHEN public.issue_3827_private_guest_list(ev.raw_theme)
                             THEN NULL ELSE (SELECT going_count FROM going) END,
      'rsvpCapacity', ev.rsvp_capacity,
      'rsvpAllowPlusOnes', ev.rsvp_allow_plus_ones,
      'rsvpPlusOnesMax', ev.rsvp_plus_ones_max,
      'rsvpWaitlistEnabled', ev.rsvp_waitlist_enabled,
      'rsvpApprovalMode', ev.rsvp_approval_mode,
      -- The same event as ONE business_public_events_view-shaped row (every view
      -- column, same names, same values, the view's own address withholding), so the
      -- buyer-web / Business-app and Explorer row mappers that already render public
      -- RSVPs from that view render an unlisted RSVP from its link unchanged. Re-read
      -- by the id `ev` already admitted; it adds no visibility of its own.
      'publicEventRow', (
        SELECT to_json(r)
        FROM (
          SELECT e.id,
            e.brand_id,
            b.slug AS brand_slug,
            b.name AS brand_name,
            b.description AS brand_description,
            b.profile_photo_url AS brand_profile_photo_url,
            b.display_attendee_count AS brand_display_attendee_count,
            b.address AS brand_address,
            b.cover_media_url AS brand_cover_media_url,
            b.theme_color AS brand_theme_color,
            b.theme_font AS brand_theme_font,
            b.theme_animation AS brand_theme_animation,
            e.title,
            e.description,
            e.slug,
            e.event_type,
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::text
              ELSE e.location_text
            END AS location_text,
            e.online_url,
            e.is_online,
            e.is_recurring,
            e.is_multi_date,
            e.recurrence_rules,
            e.cover_media_url,
            e.cover_media_type,
            e.visibility,
            e.show_on_discover,
            e.status,
            e.published_at,
            e.timezone,
            e.created_at,
            e.updated_at,
            public.issue_2489_public_theme(e.theme) AS public_theme,
            e.theme_color_override,
            e.theme_font_override,
            e.theme_animation_override,
            e.currency,
            e.cover_media_provider,
            e.cover_media_source_url,
            e.cover_media_credit,
            e.cover_media_credit_url,
            e.cover_media_alt,
            ed.start_at AS master_start_at,
            ed.end_at AS master_end_at,
            ed.timezone AS master_timezone,
            ed.id AS master_event_date_id,
            e.city,
            e.party_types,
            e.vibe_tags,
            e.music_genres,
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::point
              ELSE e.location_geo
            END AS location_geo,
            COALESCE(e.pass_tax, b.default_pass_tax) AS pass_tax,
            COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee) AS pass_mingla_fee,
            COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
            b.pricing_region,
            b.pricing_currency,
            e.pricing_locked_at IS NOT NULL AS pricing_locked,
            ( SELECT public.compute_all_in_cents(min(tt.price_cents),
                       COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
                       COALESCE(e.pass_service_fee, b.default_pass_service_fee),
                       ( SELECT rt.effective_take_rate_bps
                           FROM public.resolve_effective_take_rate_bps(b.id) rt(effective_take_rate_bps, take_rate_source)))
                FROM public.ticket_types tt
               WHERE tt.event_id = e.id AND tt.price_cents > 0 AND tt.deleted_at IS NULL) AS display_price_cents,
            e.rsvp_discoverable,
            e.rsvp_capacity,
            e.rsvp_allow_plus_ones,
            e.rsvp_plus_ones_max,
            e.rsvp_waitlist_enabled,
            e.rsvp_approval_mode,
            -- issue #3827 going-box — NULL when the guest list is private.
            CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN NULL::integer
            ELSE ( SELECT COALESCE(sum(1 + rs.plus_count), 0::bigint)::integer
                FROM public.event_rsvps rs
               WHERE rs.event_id = e.id AND rs.rsvp_status = 'going'::text AND rs.approval_status = 'approved'::text) END AS rsvp_going_count,
            e.city_geo,
            e.rsvp_contribution_enabled,
            e.rsvp_contribution_suggested_cents,
            e.rsvp_contribution_min_cents,
            e.cover_media_gallery,
            -- issue #3827 going-box — view-shaped trailing columns, same order as
            -- business_public_events_view: the real-count full flag, then the
            -- host's own-list guests (0 when private).
            (e.event_type = 'rsvp'::text AND e.rsvp_capacity IS NOT NULL
              AND ( SELECT COALESCE(sum(1 + rs.plus_count), 0::bigint)::integer
                      FROM public.event_rsvps rs
                     WHERE rs.event_id = e.id AND rs.rsvp_status = 'going'::text AND rs.approval_status = 'approved'::text)
                  >= e.rsvp_capacity) AS rsvp_capacity_full,
            CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN 0
            ELSE public.issue_3827_extra_guest_count(e.theme) END AS extra_guest_count
          FROM public.events e
          JOIN public.brands b ON b.id = e.brand_id
          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
          WHERE e.id = ev.id
        ) r
      )
    ) END
  FROM ev;
$function$;

-- -------------------------------------------------------------------------------------
-- 6 — business_public_events_view. Body: 20270523002489 (security_invoker = false
-- RESTATED; a bare CREATE OR REPLACE VIEW drops it). Two columns appended last.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.business_public_events_view WITH (security_invoker = false) AS
  SELECT e.id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.description AS brand_description,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    b.address AS brand_address,
    b.cover_media_url AS brand_cover_media_url,
    b.theme_color AS brand_theme_color,
    b.theme_font AS brand_theme_font,
    b.theme_animation AS brand_theme_animation,
    e.title,
    e.description,
    e.slug,
    e.event_type,
    -- #2489 vector 1 of 3 — the combined "Venue · Street" string.
    CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END AS location_text,
    e.online_url,
    e.is_online,
    e.is_recurring,
    e.is_multi_date,
    e.recurrence_rules,
    e.cover_media_url,
    e.cover_media_type,
    e.visibility,
    e.show_on_discover,
    e.status,
    e.published_at,
    e.timezone,
    e.created_at,
    e.updated_at,
    -- #2489 vector 3 of 3 — the structured street address nested in the theme JSON.
    -- The pre-existing `- 'business_draft'` strip is preserved on BOTH branches.
    public.issue_2489_public_theme(e.theme) AS public_theme,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
    -- #2489 vector 2 of 3 — the exact venue pin. Type is `point`; the CASE preserves it.
    CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_geo END AS location_geo,
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    (
      SELECT public.compute_all_in_cents(
               MIN(tt.price_cents),
               COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
               COALESCE(e.pass_service_fee, b.default_pass_service_fee),
               (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
             )
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.price_cents > 0
        AND tt.deleted_at IS NULL
    ) AS display_price_cents,
    -- ORCH-1150 RSVP host-control columns (inert for non-RSVP rows).
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
    -- issue #3827 going-box — NULL when the guest list is private (never 0).
    CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN NULL::integer
    ELSE (
      SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
      FROM public.event_rsvps r
      WHERE r.event_id = e.id
        AND r.rsvp_status = 'going'
        AND r.approval_status = 'approved'
    ) END AS rsvp_going_count,
    -- ORCH-1167 — city-level privacy centroid. Deliberately NOT gated by #2489: it is
    -- the privacy-safe value, and the correctly-gated RPCs return it unconditionally.
    e.city_geo,
    -- ORCH-1291 [rsvp-chip-in] — voluntary contribution config.
    e.rsvp_contribution_enabled,
    e.rsvp_contribution_suggested_cents,
    e.rsvp_contribution_min_cents,
    -- issue #868 [cover-gallery] — ADDITIONAL image/GIF gallery items.
    e.cover_media_gallery,
    -- issue #3827 going-box — appended LAST (CREATE OR REPLACE VIEW keeps every
    -- existing ordinal). The real-count full flag, then the host's own-list
    -- guests (0 when private). False for non-RSVP rows.
    (e.event_type = 'rsvp'::text AND e.rsvp_capacity IS NOT NULL
      AND (
        SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
        FROM public.event_rsvps r
        WHERE r.event_id = e.id
          AND r.rsvp_status = 'going'
          AND r.approval_status = 'approved'
      ) >= e.rsvp_capacity) AS rsvp_capacity_full,
    CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN 0
    ELSE public.issue_3827_extra_guest_count(e.theme) END AS extra_guest_count
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]))
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);

COMMENT ON VIEW public.business_public_events_view IS
  '#2489 — anon-readable public offering read model. location_text, location_geo and the '
  'theme''s business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true. city_geo is exempt by design. Do not '
  're-emit this view without the gate, and do not re-implement the predicate inline. '
  'issue #3827 — rsvp_going_count is NULL when the guest list is private; '
  'rsvp_capacity_full (real count) and extra_guest_count (host''s own list, 0 when '
  'private) are appended last.';

-- -------------------------------------------------------------------------------------
-- 7 — business_update_live_event. Body: 20270828003827_issue_3827_live_edit_location_one_owner.sql.
-- One hunk: extraGuestCount is handed to the leaf. Same signature: grants survive.
-- business_update_live_event_atomic passes p_patch through unchanged (not re-emitted).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_update_live_event(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_uid uuid:=auth.uid();
  v_event public.events%ROWTYPE;
  v_ticket jsonb;
  v_ticket_id uuid;
  v_sold integer;
  v_seen uuid[]:=ARRAY[]::uuid[];
  v_settings jsonb;
  v_tickets jsonb;
  v_stored_revision integer;
  -- issue #3827 — the structured location this patch resolves to.
  v_set_venue boolean:=false;
  v_set_address boolean:=false;
  v_venue text;
  v_address text;
  v_location_theme jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.status NOT IN('scheduled','live') THEN RAISE EXCEPTION 'event_not_editable_status';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_stored_revision:=COALESCE((v_event.theme#>>'{business_event,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision<>v_stored_revision+1 THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;

  v_settings:=COALESCE(v_event.theme#>'{business_event,settings}','{}'::jsonb);
  -- issue #3827 — hideAddressUntilTicket is a DIRECT child of business_event:
  -- every reader looks there and none reads settings. This line used to write
  -- the settings child, so a host switching the toggle changed nothing. The
  -- direct child is written in the UPDATE below; the stale settings copy is
  -- dropped here so the two can never disagree again.
  IF p_patch ? 'hideAddressUntilTicket' THEN v_settings:=v_settings-'hideAddressUntilTicket';END IF;
  IF p_patch ? 'requireApproval' THEN v_settings:=jsonb_set(v_settings,'{requireApproval}',p_patch->'requireApproval',true);END IF;
  IF p_patch ? 'allowTransfers' THEN v_settings:=jsonb_set(v_settings,'{allowTransfers}',p_patch->'allowTransfers',true);END IF;
  IF p_patch ? 'passwordProtected' THEN v_settings:=jsonb_set(v_settings,'{passwordProtected}',p_patch->'passwordProtected',true);END IF;
  IF p_patch ? 'inPersonPaymentsEnabled' THEN v_settings:=jsonb_set(v_settings,'{inPersonPaymentsEnabled}',p_patch->'inPersonPaymentsEnabled',true);END IF;

  -- issue #3827 — ONE owner for the location. The row is locked above, so
  -- v_event is the row this UPDATE writes.
  --   venueName only      : set the venue half; the stored address is kept.
  --   address only (Ari)  : whole-location replace, venueName = the text and
  --                         address = NULL, the shape Ari create writes.
  --   both                : structured, each half as given.
  IF p_patch ? 'venueName' THEN
    v_set_venue:=true;
    v_venue:=p_patch->>'venueName';
    IF p_patch ? 'address' THEN
      v_set_address:=true;
      v_address:=p_patch->>'address';
    END IF;
  ELSIF p_patch ? 'address' THEN
    v_set_venue:=true;
    v_venue:=p_patch->>'address';
    v_set_address:=true;
    v_address:=NULL;
  END IF;
  v_location_theme:=public.business_event_theme_with_location(
    v_event.theme,v_event.location_text,v_set_venue,v_venue,v_set_address,v_address);

  UPDATE public.events SET
    title=CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'),'') ELSE title END,
    description=CASE WHEN p_patch ? 'description' THEN NULLIF(p_patch->>'description','') ELSE description END,
    -- issue #3827 — the label is DERIVED from the two stored halves, never
    -- assigned from one of them (that dropped the other half on every save).
    location_text=CASE WHEN v_set_venue OR v_set_address
      THEN public.business_event_location_label(
        v_location_theme#>>'{business_event,location,venueName}',
        v_location_theme#>>'{business_event,location,address}')
      ELSE location_text END,
    online_url=CASE WHEN p_patch ? 'onlineUrl' THEN NULLIF(p_patch->>'onlineUrl','') ELSE online_url END,
    -- issue #2353 — `= 'online'` set is_online FALSE for a hybrid patch,
    -- contradicting the client's own contract (is_online = online||hybrid).
    -- The client ships `format` on EVERY core patch
    -- (ISSUE_1972_CORE_PATCH_KEYS, EditPublishedScreen.tsx:231-246), so this
    -- fired on every hybrid save. Unrecognised values leave both columns
    -- untouched rather than resolving to a guess.
    is_online=CASE
      WHEN lower(btrim(COALESCE(p_patch->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
      THEN lower(btrim(p_patch->>'format', E' \t\n\r\f\v'||chr(160))) IN ('online','hybrid')
      ELSE is_online END,
    visibility=CASE WHEN p_patch ? 'visibility' THEN CASE p_patch->>'visibility' WHEN 'unlisted' THEN 'hidden' WHEN 'private' THEN 'private' ELSE 'public' END ELSE visibility END,
    -- issue #3827 — the #2353/#1972 theme expression is unchanged and is now
    -- the INPUT (t.x) of two additions: the location halves, and the
    -- hideAddressUntilTicket direct child. Both merge a rebuilt namespace, so
    -- neither is a silent no-op on a row with no business_event object.
    theme=(SELECT CASE WHEN p_patch ? 'hideAddressUntilTicket'
        THEN t.x || jsonb_build_object(
               'business_event',
               CASE WHEN jsonb_typeof(t.x->'business_event')='object'
                 THEN t.x->'business_event' ELSE '{}'::jsonb END
               || jsonb_build_object('hideAddressUntilTicket',p_patch->'hideAddressUntilTicket'))
        ELSE t.x END
      FROM (SELECT public.business_event_theme_with_location(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          -- issue #2353 — this function wrote the DERIVED column (is_online)
          -- and never its SOURCE OF TRUTH. An in_person -> hybrid change
          -- updated is_online and left theme.business_event.format stale, so
          -- S2's stored-first read would faithfully return the STALE value and
          -- the format change would vanish on the next Unpublish/Duplicate.
          -- Fixing S2 without this converts a wrong-derivation bug into a
          -- stale-data bug. The two move together.
          -- issue #2353 — and jsonb_set creates only the FINAL element of a
          -- path, so on a live row whose theme carries no `business_event`
          -- object at all the format write was a SILENT NO-OP while the
          -- is_online projection above still fired: the host set Hybrid,
          -- is_online flipped true, nothing was stored, and S2's stored-first
          -- read reported `online` on the very next load. That is the original
          -- defect, intact, on that one row shape. Merging a rebuilt namespace
          -- onto the theme creates it when absent and preserves every sibling
          -- key when present. Scoped to the format arm on purpose: the
          -- {business_event,settings} and {business_event,clientRevision}
          -- jsonb_set calls below are #1972's and are left exactly as written.
          CASE WHEN lower(btrim(COALESCE(p_patch->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
            THEN COALESCE(theme,'{}'::jsonb) || jsonb_build_object(
                   'business_event',
                   CASE WHEN jsonb_typeof(theme->'business_event')='object'
                     THEN theme->'business_event' ELSE '{}'::jsonb END
                   || jsonb_build_object('format',lower(btrim(p_patch->>'format', E' \t\n\r\f\v'||chr(160)))))
            ELSE COALESCE(theme,'{}'::jsonb) END,
          '{business_event,settings}',v_settings,true),
        '{business_event,clientRevision}',to_jsonb(p_client_revision),true),
      '{coverHue}',COALESCE(p_patch->'coverHue',theme->'coverHue','25'::jsonb),true),
      location_text,v_set_venue,v_venue,v_set_address,v_address) AS x) AS t),   -- issue #3827
    updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;

  IF p_patch ? 'tickets' THEN
    IF jsonb_typeof(p_patch->'tickets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_patch->'tickets')=0 THEN RAISE EXCEPTION 'event_ticket_required';END IF;
    FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_patch->'tickets') LOOP
      v_ticket_id:=CASE WHEN COALESCE(v_ticket->>'id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (v_ticket->>'id')::uuid ELSE gen_random_uuid() END;
      SELECT count(*) INTO v_sold FROM public.tickets WHERE ticket_type_id=v_ticket_id AND status NOT IN('void','refunded');
      IF EXISTS(SELECT 1 FROM public.ticket_types WHERE id=v_ticket_id AND event_id=p_event_id AND deleted_at IS NULL) THEN
        IF v_sold>0 AND EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.id=v_ticket_id AND (tt.price_cents IS DISTINCT FROM round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer OR COALESCE((v_ticket->>'capacity')::integer,tt.quantity_total)<v_sold)) THEN RAISE EXCEPTION 'ticket_change_with_sales';END IF;
        UPDATE public.ticket_types SET
          name=COALESCE(NULLIF(btrim(v_ticket->>'name'),''),name), description=NULLIF(v_ticket->>'description',''),
          price_cents=round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,
          quantity_total=CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          is_unlimited=COALESCE((v_ticket->>'isUnlimited')::boolean,false),is_free=COALESCE((v_ticket->>'isFree')::boolean,false),
          is_hidden=COALESCE(v_ticket->>'visibility','public')='hidden',is_disabled=COALESCE(v_ticket->>'visibility','public')='disabled',
          requires_approval=COALESCE((v_ticket->>'approvalRequired')::boolean,false),allow_transfers=COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          password_protected=COALESCE((v_ticket->>'passwordProtected')::boolean,false),waitlist_enabled=COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          min_purchase_qty=COALESCE((v_ticket->>'minPurchaseQty')::integer,1),max_purchase_qty=NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          sale_start_at=NULLIF(v_ticket->>'saleStartAt','')::timestamptz,sale_end_at=NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          available_online=COALESCE(v_ticket->>'availableAt','both') IN('online','both'),available_in_person=COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          display_order=COALESCE((v_ticket->>'displayOrder')::integer,0),updated_at=now()
        WHERE id=v_ticket_id;
      ELSE
        INSERT INTO public.ticket_types(id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,waitlist_enabled,min_purchase_qty,max_purchase_qty,sale_start_at,sale_end_at,
          available_online,available_in_person,display_order)
        VALUES(v_ticket_id,p_event_id,COALESCE(NULLIF(btrim(v_ticket->>'name'),''),'Ticket'),NULLIF(v_ticket->>'description',''),
          round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,v_event.currency,
          CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          COALESCE((v_ticket->>'isUnlimited')::boolean,false),COALESCE((v_ticket->>'isFree')::boolean,false),
          COALESCE(v_ticket->>'visibility','public')='hidden',COALESCE(v_ticket->>'visibility','public')='disabled',
          COALESCE((v_ticket->>'approvalRequired')::boolean,false),COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          COALESCE((v_ticket->>'passwordProtected')::boolean,false),COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          COALESCE((v_ticket->>'minPurchaseQty')::integer,1),NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          NULLIF(v_ticket->>'saleStartAt','')::timestamptz,NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          COALESCE(v_ticket->>'availableAt','both') IN('online','both'),COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          COALESCE((v_ticket->>'displayOrder')::integer,0));
      END IF;
      v_seen:=array_append(v_seen,v_ticket_id);
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.ticket_types tt JOIN public.tickets t ON t.ticket_type_id=tt.id WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL AND NOT(tt.id=ANY(v_seen)) AND t.status NOT IN('void','refunded')) THEN RAISE EXCEPTION 'ticket_delete_with_sales';END IF;
    UPDATE public.ticket_types SET deleted_at=now(),is_disabled=true,updated_at=now() WHERE event_id=p_event_id AND deleted_at IS NULL AND NOT(id=ANY(v_seen));
  END IF;

  -- issue #3827 going-box — extraGuestCount rides the same leaf (it range-checks).
  IF p_patch ? 'privateGuestList' OR p_patch ? 'hideRemainingCount' OR p_patch ? 'extraGuestCount' THEN
    PERFORM public.biz_set_event_guest_privacy(p_event_id,
      COALESCE((p_patch->>'privateGuestList')::boolean,(v_settings->>'privateGuestList')::boolean,false),
      COALESCE((p_patch->>'hideRemainingCount')::boolean,(v_settings->>'hideRemainingCount')::boolean,false),
      CASE WHEN p_patch ? 'extraGuestCount' THEN (p_patch->>'extraGuestCount')::integer ELSE NULL END);
    SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb) INTO v_tickets FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'tickets',v_tickets,'client_revision',p_client_revision);
END;$fn$;

-- -------------------------------------------------------------------------------------
-- 8 — biz_update_live_rsvp. Body: 20271014103827_issue_3827_live_edit_buyer_email.sql.
-- One hunk beside hideRemainingCount. v_material_change is untouched: own-list guests
-- never alert RSVP guests.
-- -------------------------------------------------------------------------------------
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
  -- issue #3827 going-box — guests on the host's own list.
  v_extra_guest_count integer;
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
  -- issue #3827 going-box — own-list guests: absent key keeps the stored value.
  -- Display only; never a material change, never a guest alert.
  v_extra_guest_count := COALESCE(
    (p_payload->>'extraGuestCount')::integer,
    public.issue_3827_extra_guest_count(v_theme));
  IF v_extra_guest_count < 0 OR v_extra_guest_count > 5000 THEN
    RAISE EXCEPTION 'invalid_extra_guest_count';
  END IF;
  v_settings := jsonb_set(v_settings, '{extraGuestCount}', to_jsonb(v_extra_guest_count), true);
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
  IF v_material_change THEN
    FOR v_guest IN
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
         -- issue #3827 buyer email — every guest the edit notice cannot reach
         -- yet gets exactly the row queued before this work: all of them when
         -- the notice does not own the change (the feature is off, the brand
         -- is outside the pilot, or the recorder saw nothing a guest acts on),
         -- and, while emails are being tested (allowlist-only), every guest
         -- who is not on the allowlist. Nothing that alerts a guest today goes
         -- silent.
         AND (COALESCE(v_notice->>'handled', 'false') <> 'true'
              OR (public.event_edit_notice_allowlist_only()
                  AND NOT public.event_edit_notice_on_allowlist(r.guest_email)))
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
    -- issue #3827 buyer email — when the edit notice owns the change it
    -- reaches the rest; notified_count keeps its meaning (going and approved
    -- guests on a material change).
    IF COALESCE(v_notice->>'handled', 'false') = 'true' THEN
      SELECT count(*) INTO v_notified_count FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved';
    END IF;
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

-- -------------------------------------------------------------------------------------
-- 9 — #2489 apply-time set check (copied from 20270523002489 §7): re-emitting two
-- carriers must leave the registry set-equal to what the catalog references.
-- -------------------------------------------------------------------------------------
DO $gate_check$
DECLARE
  v_declared   text[];
  v_found      text[];
  v_missing    text[];
  v_undeclared text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared
  FROM public.issue_2489_gate_registry();

  IF v_declared IS NULL OR cardinality(v_declared) = 0 THEN
    RAISE EXCEPTION '#2489 gate check is vacuous: the registry declared nothing.';
  END IF;

  SELECT array_agg(name ORDER BY name) INTO v_found FROM (
    SELECT p.proname::text AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'issue_2489_address_withheld'
      AND p.proname <> 'issue_2489_gate_registry'
      AND (p.prosrc LIKE '%issue_2489_address_withheld%' OR p.prosrc LIKE '%issue_2489_public_theme%')
    UNION
    SELECT c.relname::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND (pg_get_viewdef(c.oid) LIKE '%issue_2489_address_withheld%'
        OR pg_get_viewdef(c.oid) LIKE '%issue_2489_public_theme%')
  ) q;

  SELECT array_agg(x ORDER BY x) INTO v_missing
  FROM unnest(v_declared) x WHERE x <> ALL (COALESCE(v_found, ARRAY[]::text[]));
  SELECT array_agg(x ORDER BY x) INTO v_undeclared
  FROM unnest(COALESCE(v_found, ARRAY[]::text[])) x WHERE x <> ALL (v_declared);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '#2489: declared objects are not carrying the shared gate: %',
      array_to_string(v_missing, ', ');
  END IF;
  IF v_undeclared IS NOT NULL THEN
    RAISE EXCEPTION '#2489: undeclared objects are carrying the shared gate: %',
      array_to_string(v_undeclared, ', ');
  END IF;
END
$gate_check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
