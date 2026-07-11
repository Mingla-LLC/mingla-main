-- ORCH-1359 [guest-list-sheet-identity-display] — additive location on the
-- authed peer guest-list read (follows META-ORCH-1337 / ORCH-1338).
--
-- WHAT: CREATE OR REPLACE public.peer_list_event_guests(uuid, integer, integer)
-- adding EXACTLY ONE whitelisted profiles column — `location` — to the
-- NAMED-ROW projection in BOTH branches (RSVP + ticketed), plus one payload key
-- (`location`). Every guard, guard ORDER, branch marker, the REVOKE/GRANT, the
-- hard row-cap, block exclusion, and NOTIFY pgrst are preserved verbatim from
-- 20261225000000_orch_1338_social_proof_guest_reads.sql. Function A
-- (pg_public_social_proof) is NOT touched by this migration.
--
-- WHY (privacy — I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED +
-- I-PROPOSED-1338-GUARD-FIRST-PEER-READS): `named_location` reuses the EXACT
-- identity CASE guard (linked AND visibility_mode IN ('public','friends') AND
-- not-blocked either direction), so location surfaces on the SAME rows that
-- already surface display_name/username — no new row is deanonymized.
-- Anonymous (private-visibility), unlinked, and blocked→excluded rows carry
-- location = NULL. `profiles.location` is a self-authored, world-readable-to-
-- authed-users "City, Region, Country" string already shown on
-- ViewFriendProfileScreen; this adds no exposure beyond the existing profile
-- view. Constitution #9: absent location → NULL → the client renders nothing.
--
-- COLUMN WHITELIST (widened by exactly one): the ONLY profiles columns this
-- function may touch are now id, display_name, username, avatar_url, location,
-- visibility_mode. Typed contact data of non-users is NEVER emitted.
--
-- SAFE-MIGRATION PROTOCOL (frontier after 20261228000000):
--   • SECURITY DEFINER, STABLE, SET search_path = public.
--   • $function$ terminator BEFORE the grants.
--   • DROP IF EXISTS before CREATE (RETURNS json — no RETURNS-TABLE hazard).
--   • REVOKE ALL FROM PUBLIC; GRANT authenticated ONLY (D1 — no anon).
--   • NOTIFY pgrst at the end.
--
-- DO NOT auto-apply — orchestrator/Seth applies via `supabase db push --linked`
-- (or the Management API), then verifies with one live call (SPEC §5 SC-6):
-- an authed call returns `location` on a public/friends named guest and NULL on
-- private/unlinked rows, and the RPC still RAISEs guest_list_private when the
-- host gate is on.

BEGIN;

-- ---------------------------------------------------------------------------
-- Function B — peer_list_event_guests(p_event_id, p_limit, p_offset)
--                RETURNS json
--
-- Guard-FIRST ordering (each guard its own statement, in this exact order,
-- before ANY guest-row read — F-8):
--   1. auth gate      → RAISE 'authentication_required' (D1: app-gated+authed;
--                       anon NEVER reaches row data).
--   2. event resolve  → public + not-deleted + status IN (scheduled, live)
--                       ONLY (no scraping ended/cancelled guest lists)
--                       → RAISE 'event_not_available'.
--   3. privacy gate   → privateGuestList read server-side from events.theme
--                       → RAISE 'guest_list_private' (D2: suppressed IN the
--                       RPC, not client-only; defense-in-depth vs scrapers).
--   4. row-cap clamp  → LEAST(GREATEST(p_limit,1),100); offset ≥ 0. 100 is the
--                       HARD cap; no parameter combination returns more.
--
-- Per-row identity mapping (D1) — the ONLY profiles columns this query may
-- touch: id, display_name, username, avatar_url, location, visibility_mode.
-- Typed contact data of non-users is NEVER peer-visible (whitelist discipline).
--   linked + visibility public/friends + unblocked → named row (profileId +
--     location included; ORCH-1341 add-friend/message need profileId,
--     ORCH-1359 shows the public city; profiles are already world-readable to
--     authed users — 1334-sealed posture; this RPC adds curation, not
--     capability).
--   linked + visibility private → anonymous Mingla-user row (all-null identity,
--     location NULL).
--   linked + blocked pair (either direction) → row EXCLUDED entirely.
--   unlinked (anon RSVP guest / anon buyer) → anonymous non-user row
--     (location NULL).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.peer_list_event_guests(uuid, integer, integer);

CREATE FUNCTION public.peer_list_event_guests(
  p_event_id uuid,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_viewer  uuid;
  v_event   record;
  v_private boolean;
  v_limit   integer;
  v_offset  integer;
  v_guests  json    := '[]'::json;
  v_fetched integer := 0;
BEGIN
  -- GUARD 1 — authed callers only (D1). RAISE before ANY data read.
  v_viewer := auth.uid();
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- GUARD 2 — event must be public + not-deleted + scheduled-or-live ONLY.
  SELECT e.id, e.event_type, e.theme
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public'::text
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text]);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_available';
  END IF;

  -- GUARD 3 — server-enforced privateGuestList (D2).
  v_private := COALESCE(
    (v_event.theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
  IF v_private THEN
    RAISE EXCEPTION 'guest_list_private';
  END IF;

  -- GUARD 4 — hard row cap (≤100, ≥1) + non-negative offset.
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  IF v_event.event_type = 'rsvp' THEN
    -- [ORCH-1338 FN-B RSVP-BRANCH-BEGIN] (COMMS-0057: reads event_rsvps ONLY)
    -- One row per going+approved RSVP; party_size = 1 + plus_count (web
    -- plus-one rows stay inside party_size; matched_user_id surfacing is
    -- deferred — live table empty, F-11 / SPEC §10).
    WITH base AS (
      SELECT r.id              AS row_id,
             r.user_id         AS linked_user_id,
             (1 + r.plus_count) AS party_size,
             r.created_at
        FROM public.event_rsvps r
       WHERE r.event_id = v_event.id
         AND r.rsvp_status = 'going'
         AND r.approval_status = 'approved'
    ),
    visible AS (
      SELECT c.*
        FROM (
          SELECT b.row_id,
                 b.party_size,
                 b.created_at,
                 (b.linked_user_id IS NOT NULL) AS is_mingla_user,
                 (b.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends')) AS is_named,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.id END           AS named_profile_id,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.display_name END AS named_display_name,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.username END     AS named_username,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.avatar_url END   AS named_avatar_url,
                 -- ORCH-1359 — public city, identity-gated (named rows ONLY);
                 -- SAME CASE guard as the identity columns above. Do not emit
                 -- location on anon/private/unlinked rows.
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.location END     AS named_location
            FROM base b
            LEFT JOIN public.profiles p ON p.id = b.linked_user_id
           WHERE b.linked_user_id IS NULL
              OR (NOT public.is_blocked_by(b.linked_user_id, v_viewer)
                  AND NOT public.is_blocked_by(v_viewer, b.linked_user_id))
        ) c
       ORDER BY c.is_named DESC, c.created_at ASC, c.row_id ASC
       LIMIT v_limit + 1 OFFSET v_offset
    ),
    numbered AS (
      SELECT v.*,
             row_number() OVER (
               ORDER BY v.is_named DESC, v.created_at ASC, v.row_id ASC
             ) AS rn
        FROM visible v
    )
    SELECT COALESCE(json_agg(json_build_object(
             'profileId',    n.named_profile_id,
             'displayName',  n.named_display_name,
             'username',     n.named_username,
             'avatarUrl',    n.named_avatar_url,
             'location',     n.named_location,
             'isMinglaUser', n.is_mingla_user,
             'isAnonymous',  NOT n.is_named,
             'partySize',    n.party_size
           ) ORDER BY n.rn) FILTER (WHERE n.rn <= v_limit), '[]'::json),
           COUNT(*)::integer
      INTO v_guests, v_fetched
      FROM numbered n;
    -- [ORCH-1338 FN-B RSVP-BRANCH-END]
  ELSE
    -- [ORCH-1338 FN-B TICKETED-BRANCH-BEGIN] (COMMS-0057: reads orders/tickets
    -- ONLY — event / trip / experience)
    -- One row per order owning ≥1 live ticket; party_size = that order's live
    -- ticket count (D3: extra seats render as glyphs client-side).
    WITH base AS (
      SELECT o.id              AS row_id,
             o.buyer_user_id   AS linked_user_id,
             COUNT(t.id)::integer AS party_size,
             o.created_at
        FROM public.orders o
        JOIN public.tickets t
          ON t.order_id = o.id
         AND t.status IN ('valid', 'used', 'transferred')
       WHERE o.event_id = v_event.id
       GROUP BY o.id, o.buyer_user_id, o.created_at
    ),
    visible AS (
      SELECT c.*
        FROM (
          SELECT b.row_id,
                 b.party_size,
                 b.created_at,
                 (b.linked_user_id IS NOT NULL) AS is_mingla_user,
                 (b.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends')) AS is_named,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.id END           AS named_profile_id,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.display_name END AS named_display_name,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.username END     AS named_username,
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.avatar_url END   AS named_avatar_url,
                 -- ORCH-1359 — public city, identity-gated (named rows ONLY);
                 -- SAME CASE guard as the identity columns above. Do not emit
                 -- location on anon/private/unlinked rows.
                 CASE WHEN b.linked_user_id IS NOT NULL
                       AND p.visibility_mode IN ('public', 'friends')
                      THEN p.location END     AS named_location
            FROM base b
            LEFT JOIN public.profiles p ON p.id = b.linked_user_id
           WHERE b.linked_user_id IS NULL
              OR (NOT public.is_blocked_by(b.linked_user_id, v_viewer)
                  AND NOT public.is_blocked_by(v_viewer, b.linked_user_id))
        ) c
       ORDER BY c.is_named DESC, c.created_at ASC, c.row_id ASC
       LIMIT v_limit + 1 OFFSET v_offset
    ),
    numbered AS (
      SELECT v.*,
             row_number() OVER (
               ORDER BY v.is_named DESC, v.created_at ASC, v.row_id ASC
             ) AS rn
        FROM visible v
    )
    SELECT COALESCE(json_agg(json_build_object(
             'profileId',    n.named_profile_id,
             'displayName',  n.named_display_name,
             'username',     n.named_username,
             'avatarUrl',    n.named_avatar_url,
             'location',     n.named_location,
             'isMinglaUser', n.is_mingla_user,
             'isAnonymous',  NOT n.is_named,
             'partySize',    n.party_size
           ) ORDER BY n.rn) FILTER (WHERE n.rn <= v_limit), '[]'::json),
           COUNT(*)::integer
      INTO v_guests, v_fetched
      FROM numbered n;
    -- [ORCH-1338 FN-B TICKETED-BRANCH-END]
  END IF;

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    'returned', LEAST(v_fetched, v_limit),
    'hasMore', v_fetched > v_limit,
    'guests', v_guests
  );
END;
$function$;

COMMENT ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) IS
  'ORCH-1338/1359 — authed peer guest-list read for the consumer sheet (ORCH-1341). '
  'Guard-first, in order: auth (authentication_required) → event public + '
  'scheduled/live (event_not_available) → server-side privateGuestList '
  '(guest_list_private, D2) → hard row-cap LEAST/GREATEST ≤100. Column whitelist: '
  'profiles id/display_name/username/avatar_url/location/visibility_mode ONLY; typed '
  'contact data of non-users is never emitted. D1 mapping: named rows only for '
  'linked guests with visibility public/friends and no block either direction '
  '(ORCH-1359 emits location on those SAME named rows); linked-private → anonymous '
  'Mingla-user row (location null); blocked pair → excluded; unlinked → anonymous '
  'non-user row (location null). NO anon grant. F-8: a DEFINER RPC without a guard '
  'is an open per-event guest-scraper — do not weaken. '
  'SPEC_ORCH-1338_GUEST_READ_BACKEND / SPEC_ORCH-1359_GUEST_LIST_IDENTITY / '
  'I-PROPOSED-1338-PEER-GUEST-READ-GUARDED / I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED.';

REVOKE ALL ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
