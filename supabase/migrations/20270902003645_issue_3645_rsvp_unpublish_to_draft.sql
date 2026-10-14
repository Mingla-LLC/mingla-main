-- Issue #3645 — a published RSVP can be returned to draft.
--
-- WHAT WAS MISSING. An event has `business_unpublish_event_to_draft` and an
-- experience has `business_unpublish_experience_to_draft`. An RSVP had
-- neither: once published, the host could only edit it live.
--
-- WHAT THIS ADDS. A sibling function, `business_unpublish_rsvp_to_draft`, the
-- same way the experience path got its own (20270505001973). No existing
-- function is re-emitted: `business_unpublish_event_to_draft` keeps refusing
-- anything that is not an event, and its draft-payload helper
-- (`business_event_draft_payload_from_graph`) is event-only (it rebuilds
-- tickets, which an RSVP never has).
--
-- THE RULE IS THE EVENT / EXPERIENCE RULE, NOT A LOOSER ONE. An RSVP goes
-- back to draft only when ALL of these hold, exactly as for an event:
--   * it is published (`status = 'scheduled'`) and not deleted;
--   * the caller is an event manager or above on the brand;
--   * it has a date and that date has not started;
--   * nobody has responded and nothing has been collected: no RSVP reply of
--     ANY status (going, maybe, not going, waitlisted), no plus-one, no
--     chip-in contribution in any state, no order, ticket, scan, waitlist
--     entry or attendance-claim delivery.
-- A refused unpublish raises `rsvp_unpublish_has_commitments`; the host's way
-- out is Cancel, which goes through the reviewed refund path.
--
-- WHAT GOING BACK TO DRAFT DOES. Publishing an RSVP moved the wizard's saved
-- form from `theme.business_draft` to `theme.business_event` (dropping the
-- keys that became columns) and wrote the date to `event_dates`. This reverses
-- that: `theme.business_draft` is rebuilt from `theme.business_event`, with
-- every value that has a column taken FROM THE COLUMN (a live edit may have
-- changed the column after publish), the date is taken from `event_dates`,
-- and the `event_dates` rows are removed (a draft has none until publish).
-- Title, description, cover, slug, location and settings are left as they
-- are. The row can be published again with `business_publish_rsvp_graph`.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.business_unpublish_rsvp_to_draft(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_event public.events%ROWTYPE;v_draft jsonb;v_when jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'rsvp' THEN RAISE EXCEPTION 'rsvp_not_found';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  IF v_event.status<>'scheduled' THEN RAISE EXCEPTION 'rsvp_not_unpublishable';END IF;
  -- Lock the schedule before deciding whether the public lifecycle can move
  -- backwards. A started RSVP stays published.
  PERFORM 1 FROM public.event_dates WHERE event_id=p_event_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=p_event_id)
     OR (SELECT min(start_at) FROM public.event_dates WHERE event_id=p_event_id)<=now()
  THEN RAISE EXCEPTION 'rsvp_unpublish_not_future';END IF;
  -- Same list as business_unpublish_event_to_draft and
  -- business_unpublish_experience_to_draft.
  IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.tickets WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.scan_events WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvps WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id=g.rsvp_id WHERE r.event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvp_contributions WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.waitlist_entries WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.attendance_claim_deliveries WHERE event_id=p_event_id)
  THEN RAISE EXCEPTION 'rsvp_unpublish_has_commitments';END IF;

  SELECT jsonb_build_object(
      'date',to_char(ed.start_at AT TIME ZONE v_event.timezone,'YYYY-MM-DD'),
      'doorsOpen',to_char(ed.start_at AT TIME ZONE v_event.timezone,'HH24:MI'),
      'endsAt',to_char(ed.end_at AT TIME ZONE v_event.timezone,'HH24:MI'),
      'timezone',v_event.timezone)
    INTO v_when FROM public.event_dates ed
    WHERE ed.event_id=p_event_id ORDER BY ed.is_master DESC,ed.start_at LIMIT 1;

  v_draft:=COALESCE(v_event.theme->'business_event','{}'::jsonb)||jsonb_build_object(
    'tickets','[]'::jsonb,
    'whenMode','single',
    'when',COALESCE(v_event.theme#>'{business_event,when}','{}'::jsonb)||v_when,
    'requestedVisibility',CASE v_event.visibility
      WHEN 'private' THEN 'private' WHEN 'hidden' THEN 'unlisted' ELSE 'public' END,
    'city',v_event.city,
    'partyTypes',to_jsonb(COALESCE(v_event.party_types,ARRAY[]::text[])),
    'vibeTags',to_jsonb(COALESCE(v_event.vibe_tags,ARRAY[]::text[])),
    'musicGenres',to_jsonb(COALESCE(v_event.music_genres,ARRAY[]::text[])),
    'rsvpCapacity',v_event.rsvp_capacity,
    'rsvpAllowPlusOnes',COALESCE(v_event.rsvp_allow_plus_ones,false),
    'rsvpPlusOnesMax',COALESCE(v_event.rsvp_plus_ones_max,0),
    'rsvpWaitlistEnabled',COALESCE(v_event.rsvp_waitlist_enabled,false),
    'rsvpApprovalMode',COALESCE(v_event.rsvp_approval_mode,'auto'),
    'rsvpDiscoverable',COALESCE(v_event.rsvp_discoverable,false),
    'rsvpContributionEnabled',COALESCE(v_event.rsvp_contribution_enabled,false),
    'rsvpContributionSuggestedCents',v_event.rsvp_contribution_suggested_cents,
    'rsvpContributionMinCents',v_event.rsvp_contribution_min_cents);

  PERFORM set_config('mingla.business_publish_event_draft','on',true);
  UPDATE public.events SET status='draft',visibility='draft',published_at=NULL,
    show_on_discover=false,show_in_swipeable_deck=false,
    theme=(COALESCE(v_event.theme,'{}'::jsonb)-'business_event')||jsonb_build_object('business_draft',v_draft),
    updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  DELETE FROM public.event_dates WHERE event_id=p_event_id;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    COALESCE((v_draft->>'clientRevision')::integer,0));
END;$fn$;

REVOKE ALL ON FUNCTION public.business_unpublish_rsvp_to_draft(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_unpublish_rsvp_to_draft(uuid) TO authenticated,service_role;

COMMENT ON FUNCTION public.business_unpublish_rsvp_to_draft(uuid) IS
  'Issue #3645: returns a published RSVP to draft. Same rule as business_unpublish_event_to_draft: future-dated, event manager or above, and no reply, plus-one, chip-in, order, ticket, scan, waitlist entry or attendance-claim delivery (rsvp_unpublish_has_commitments otherwise).';

-- Verify.
DO $$
DECLARE v_oid oid:='public.business_unpublish_rsvp_to_draft(uuid)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid) THEN
    RAISE EXCEPTION 'issue_3645_verify: business_unpublish_rsvp_to_draft is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'issue_3645_verify: business_unpublish_rsvp_to_draft search_path is not fixed';
  END IF;
  IF has_function_privilege('anon',v_oid,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: business_unpublish_rsvp_to_draft grants are wrong';
  END IF;
  -- The event owner is untouched: it still refuses non-events.
  IF position('event_type<>''event''' in pg_get_functiondef('public.business_unpublish_event_to_draft(uuid)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'issue_3645_verify: business_unpublish_event_to_draft no longer refuses non-events';
  END IF;
END;
$$;

COMMIT;
