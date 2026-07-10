-- ORCH-1339 [momentum-card-cross-entity] — Leg 2 of META-ORCH-1337 [social-proof-guest-list].
--
-- biz_set_event_guest_privacy(p_event_id, p_private_guest_list, p_hide_remaining_count)
-- — THE ONE no-clobber leaf write for the two host guest-privacy display gates
-- (theme.business_event.settings.privateGuestList / .hideRemainingCount), so the
-- trip + experience wizards can persist their new toggles WITHOUT re-emitting the
-- big edit RPCs. DO NOT re-emit biz_update_live_trip / biz_update_live_experience /
-- business_publish_trip_draft / biz_publish_experience for these two keys — that
-- is the COMMS-0029 class collision (two ORCHs re-emitting biz_update_live_trip;
-- the last migration applied CLOBBERS the other's body). This leaf RPC exists
-- precisely to avoid that. Write-pattern precedent byte-followed: ORCH-1172/1296
-- jsonb deep-merge (20261222000000_orch_1296_rsvp_edit_chip_in.sql:225-250).
--
-- Entity-agnostic: works for all four event_types (rsvp / event / trip /
-- experience). The standard-event and RSVP wizards KEEP their existing full write
-- paths — co-existing leaf writes cannot clobber each other because jsonb_set
-- replaces ONLY the two owned leaf keys and preserves every sibling theme /
-- business_event / settings key (hideAddressUntilTicket etc. byte-survive).
--
-- Guard-FIRST ordering (each guard BEFORE any write):
--   1. auth      → RAISE 'authentication_required'
--   2. event     → RAISE 'event_not_found'   (id + deleted_at IS NULL)
--   3. host gate → RAISE 'not_authorized'    (biz_brand_effective_rank >=
--                  biz_role_rank('event_manager') — the exact ORCH-1334/1150
--                  host predicate, verbatim from 20261004000000:126-128)
--
-- NULL param = keep the existing value (partial update). RETURNS the FINAL
-- persisted values — the client trusts this echo, never its optimistic state.
--
-- SAFE-MIGRATION PROTOCOL:
--   • DROP IF EXISTS before CREATE (RETURNS jsonb — no RETURNS-TABLE hazard).
--   • $function$ terminator BEFORE the grants.
--   • REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated ONLY (host-gated
--     in-function; no anon grant — this is a write).
--   • Table RLS UNCHANGED — the write is RPC-mediated and host-gated in-function.
--   • NOTIFY pgrst at the end.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API at SHIP.

BEGIN;

DROP FUNCTION IF EXISTS public.biz_set_event_guest_privacy(uuid, boolean, boolean);

CREATE FUNCTION public.biz_set_event_guest_privacy(
  p_event_id uuid,
  p_private_guest_list boolean DEFAULT NULL,
  p_hide_remaining_count boolean DEFAULT NULL
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

  -- ORCH-1172/1296 no-clobber leaf write: COALESCE each param → existing theme
  -- leaf → false; jsonb_set (create_missing=true) ONLY the two owned leaf keys
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

  v_settings := COALESCE(v_theme #> '{business_event,settings}', '{}'::jsonb);
  v_settings := jsonb_set(v_settings, '{privateGuestList}', to_jsonb(v_private), true);
  v_settings := jsonb_set(v_settings, '{hideRemainingCount}', to_jsonb(v_hide), true);
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
    'hideRemainingCount', v_hide
  );
END;
$function$;

COMMENT ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) IS
  'ORCH-1339 — host-gated (event_manager rank) no-clobber leaf write for the two '
  'guest-privacy display gates: theme.business_event.settings.privateGuestList / '
  '.hideRemainingCount. Guard-first: authentication_required → event_not_found → '
  'not_authorized. NULL param = keep existing (partial update); returns the final '
  'persisted values. ORCH-1172/1296 deep-merge precedent — replaces ONLY the two '
  'owned leaf keys; every sibling theme/settings key byte-survives. NEVER re-emit '
  'the big trip/experience edit RPCs for these keys (COMMS-0029 clobber class). '
  'SPEC_ORCH-1339_MOMENTUM_CARD_CROSS_ENTITY §4.2.';

REVOKE ALL ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
