-- ORCH-1338 [guest-read-backend] — Leg 1 of META-ORCH-1337 [social-proof-guest-list].
--
-- THE ONE privacy-aware backend read layer for social proof + peer guest lists:
--
--   Function A: pg_public_social_proof(p_event_id)  — anon-callable counts +
--     avatar-sample read, uniform across all four entity types (rsvp / event /
--     trip / experience). Fixes the F-3 unlimited-capacity hole: the ticketed
--     "going" count is the ABSOLUTE live-ticket count computed under DEFINER,
--     never derived from per-tier remaining. Carries the two host gates
--     (privateGuestList / hideRemainingCount) server-side. NO names, NO ids,
--     NO typed contact data on this path — for anon AND authed alike (D1).
--
--   Function B: peer_list_event_guests(p_event_id, p_limit, p_offset) — the
--     authenticated, guard-first, row-capped, column-whitelisted guest-list
--     read for the consumer sheet (ORCH-1341). Honors visibility_mode, blocked
--     pairs, and the server-enforced privateGuestList gate (D1/D2).
--
-- WHY GUARD-FIRST + WHITELIST (F-8): a SECURITY DEFINER RPC without a guard is
-- an open per-event guest-scraper. Every gate here (auth where applicable →
-- event public/live + visibility → server-side privateGuestList → hard row-cap
-- LEAST/GREATEST ≤100) runs BEFORE any guest-row read, and the output column
-- set is a hard whitelist that never emits typed contact data of non-users.
-- Do not remove a guard, reorder the guards, widen the column whitelist, or
-- add an anon grant to Function B.
-- Contract: SPEC_ORCH-1338_GUEST_READ_BACKEND.md + I-PROPOSED-1338-PEER-GUEST-
-- READ-GUARDED + I-PROPOSED-1338-SOCIAL-PROOF-COUNTS-HONEST +
-- I-PROPOSED-1338-SOCIAL-PROOF-SAMPLE-PRIVACY.
--
-- Table RLS is UNCHANGED by this migration — all peer/anon access is mediated
-- exclusively by these two functions (SPEC §4.1.3 / SC-10). No policy is
-- added, dropped, or altered; no table DDL.
--
-- COMMS-0057 / ORCH-1206: the RSVP path NEVER merges into the ticket path —
-- both functions branch CASE event_type into DISJOINT queries (the RSVP branch
-- never reads the ticketed tables and vice versa). The bracketed BRANCH-BEGIN/
-- BRANCH-END markers below are load-bearing: the orch_1338 regression tests
-- partition the function bodies on them.
--
-- SAFE-MIGRATION PROTOCOL:
--   • SECURITY DEFINER, STABLE, SET search_path = public.
--   • $function$ terminator BEFORE the grants.
--   • DROP IF EXISTS before CREATE (RETURNS json — no RETURNS-TABLE hazard).
--   • REVOKE ALL FROM PUBLIC; Function A → GRANT anon, authenticated;
--     Function B → GRANT authenticated ONLY (D1: the named list is app-gated).
--   • NOTIFY pgrst at the end.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API, then
-- verifies each function with one live call (SPEC §4.1 / SC-9).

BEGIN;

-- ---------------------------------------------------------------------------
-- Function A — pg_public_social_proof(p_event_id uuid) RETURNS json
--
-- Guard-FIRST ordering (before any count/sample work):
--   1. resolve event: public + not-deleted (event AND brand) + status in the
--      by-slug page set (scheduled/live/ended/cancelled — byte-parity with
--      pg_public_rsvp_by_slug so the card can render wherever the page does).
--      Not found → SQL NULL (mirror the by-slug NULL contract; no existence
--      oracle beyond what the by-slug RPCs already expose).
--   2. read the two host gates server-side from events.theme (never the client).
--   3. v_viewer := auth.uid() — drives block-exclusion ONLY; this function
--      returns NO names/ids to anyone.
--
-- Sample whitelist (hard): each element is EXACTLY {avatarUrl, isMinglaUser}.
-- Names live exclusively in Function B (authed). Sample size 5 =
-- SOCIAL_PROOF_SAMPLE_MAX (packages/offering-rendering/socialProofTypes.ts).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.pg_public_social_proof(uuid);

CREATE FUNCTION public.pg_public_social_proof(
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
     AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- GUARD 2 — host gates, read server-side from the resolved row (D2).
  v_private := COALESCE(
    (v_event.theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
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

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    'goingCount', v_going,
    'capacity', v_capacity,
    'privateGuestList', v_private,
    'hideRemainingCount', v_hide_remaining,
    'sample', v_sample
  );
END;
$function$;

COMMENT ON FUNCTION public.pg_public_social_proof(uuid) IS
  'ORCH-1338 — anon-callable social-proof counts + avatar sample, uniform across '
  'rsvp/event/trip/experience. Guard-first (event public + page-status set; host '
  'gates read server-side from events.theme; D2: privateGuestList=true empties the '
  'sample). Sample elements carry EXACTLY {avatarUrl,isMinglaUser} — no names, no '
  'ids, for anon AND authed alike (D1); private-visibility profiles and (for authed '
  'viewers) blocked pairs are excluded; LIMIT 5. Counts: RSVP SUM(1+plus_count) '
  'going+approved; ticketed ABSOLUTE live-ticket count (F-3 fix); capacity NULL '
  'when any tier is unlimited. F-8: a DEFINER RPC without a guard is an open '
  'per-event guest-scraper — do not weaken. SPEC_ORCH-1338_GUEST_READ_BACKEND / '
  'I-PROPOSED-1338-SOCIAL-PROOF-COUNTS-HONEST / I-PROPOSED-1338-SOCIAL-PROOF-SAMPLE-PRIVACY.';

REVOKE ALL ON FUNCTION public.pg_public_social_proof(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_social_proof(uuid) TO anon, authenticated;

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
-- touch: id, display_name, username, avatar_url, visibility_mode. Typed
-- contact data of non-users is NEVER peer-visible (whitelist discipline).
--   linked + visibility public/friends + unblocked → named row (profileId
--     included: ORCH-1341 add-friend/message need it; profiles are already
--     world-readable to authed users — 1334-sealed posture; this RPC adds
--     curation, not capability).
--   linked + visibility private → anonymous Mingla-user row (all-null identity).
--   linked + blocked pair (either direction) → row EXCLUDED entirely.
--   unlinked (anon RSVP guest / anon buyer) → anonymous non-user row.
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
                      THEN p.avatar_url END   AS named_avatar_url
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
                      THEN p.avatar_url END   AS named_avatar_url
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
  'ORCH-1338 — authed peer guest-list read for the consumer sheet (ORCH-1341). '
  'Guard-first, in order: auth (authentication_required) → event public + '
  'scheduled/live (event_not_available) → server-side privateGuestList '
  '(guest_list_private, D2) → hard row-cap LEAST/GREATEST ≤100. Column whitelist: '
  'profiles id/display_name/username/avatar_url/visibility_mode ONLY; typed '
  'contact data of non-users is never emitted. D1 mapping: named rows only for '
  'linked guests with visibility public/friends and no block either direction; '
  'linked-private → anonymous Mingla-user row; blocked pair → excluded; unlinked '
  '→ anonymous non-user row. NO anon grant. F-8: a DEFINER RPC without a guard is '
  'an open per-event guest-scraper — do not weaken. '
  'SPEC_ORCH-1338_GUEST_READ_BACKEND / I-PROPOSED-1338-PEER-GUEST-READ-GUARDED.';

REVOKE ALL ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
