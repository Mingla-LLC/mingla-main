-- Issue #3355 P7 — Ari's event drafts save only facts the owner gave.
--
-- The Ari path of event draft creation (ari_execute_event_operation →
-- business_create_event_draft) used to fill gaps on its own (audit D-23/D-24):
--   * end time    — COALESCE(end_at, start + 2 hours): every Ari draft ran
--                   exactly two hours, a time nobody chose;
--   * time zone   — COALESCE(timezone, 'UTC'): a Lagos host's event could be
--                   saved in UTC;
--   * visibility  — the old planner sent 'private', which can never be
--                   published while private access is frozen (#1931).
-- Now, on the Ari path only:
--   * create_event (single / recurring) requires end_at → 'event_end_required';
--   * create_event requires a time zone → 'event_timezone_required';
--   * create_event refuses 'private' unless private access is ready
--     → 'private_access_not_ready' (read through ari_private_visibility_allowed);
--   * a draft update that moves the start requires the end too
--     → 'event_end_required' (it used to reset the end to start + 2 hours);
--   * create_event takes a place the owner picked on the card (address, city,
--     coordinates, venue name, "show the address only to ticket holders") and
--     update_event takes party types, so an Ari draft can reach the Host
--     publish gate without the wizard.
-- No ticket is ever created here unless the caller passes it (the old planner's
-- implicit free "General admission" tier is removed in edge code).
--
-- Untouched: the Host path (business_create_event_draft and
-- business_update_event_draft bodies), every publish function, issue_1931_*,
-- pg_brand_can_*, biz_require_current_organiser_terms.
-- Behaviour is pinned by
-- supabase/migrations/__tests__/issue_3355_event_seed_truth.implementor.pg17.test.sql.

-- ── Private visibility, read through one definer wrapper ───────────────────
CREATE OR REPLACE FUNCTION public.ari_private_visibility_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(public.issue_1931_private_event_access_ready(), false);
$function$;

COMMENT ON FUNCTION public.ari_private_visibility_allowed() IS
  '#3355 P7: may Ari save or offer Private visibility? A definer wrapper over issue_1931_private_event_access_ready (false while private access is frozen).';

REVOKE ALL ON FUNCTION public.ari_private_visibility_allowed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_private_visibility_allowed()
  TO service_role;

-- ── The Ari event dispatcher (full body; only the marked lines changed) ────
CREATE OR REPLACE FUNCTION public.ari_execute_event_operation(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_payload jsonb;
  v_business jsonb;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_revision integer;
  v_event_status text;
  v_when_mode text;
  v_multi_dates jsonb;
  v_recurrence_rule jsonb;
  v_date_item jsonb;
  v_date_index integer:=0;
  v_date_text text;
  v_start_text text;
  v_end_text text;
  v_draft_format text;   -- issue #2353, S6
  v_draft_online boolean;-- issue #2353, S6
  v_lat numeric;         -- issue #3355 P7: a picked place
  v_lng numeric;
  v_party_types jsonb;   -- issue #3355 P7: draft party types
BEGIN
  IF p_tool_name NOT IN('create_event','update_event','publish_event','unpublish_event','cancel_event',
    'end_event_sales','duplicate_event','patch_event_when','set_event_cover','set_event_guest_privacy','discard_event_draft')
  THEN RAISE EXCEPTION 'unsupported_event_operation';END IF;
  v_begin:=public.agent_operation_receipt_begin(p_operation_id,p_tool_name,p_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result';END IF;
  v_event_id:=NULLIF(p_args->>'event_id','')::uuid;
  CASE p_tool_name
    WHEN 'create_event' THEN
      PERFORM public.business_assert_event_visibility(p_args->'visibility');
      -- issue #3355 P7 (D-24) — never a Private draft while private access is
      -- frozen (#1931): it could never be published.
      IF p_args->>'visibility'='private' AND NOT public.ari_private_visibility_allowed() THEN
        RAISE EXCEPTION 'private_access_not_ready';
      END IF;
      -- issue #3355 P7 (D-23) — the owner's time zone, never a silent UTC.
      IF NULLIF(btrim(COALESCE(p_args->>'timezone','')),'') IS NULL THEN
        RAISE EXCEPTION 'event_timezone_required';
      END IF;
      v_timezone:=btrim(p_args->>'timezone');
      IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_timezone) THEN
        RAISE EXCEPTION 'event_timezone_invalid';
      END IF;
      v_when_mode:=COALESCE(NULLIF(p_args->>'when_mode',''),'single');
      IF v_when_mode NOT IN('single','multi_date','recurring') THEN
        RAISE EXCEPTION 'event_when_mode_invalid';
      END IF;
      v_recurrence_rule:=p_args->'recurrence_rule';
      v_multi_dates:=NULL;
      IF v_when_mode IN('single','recurring') THEN
        IF NULLIF(p_args->>'start_at','') IS NULL THEN RAISE EXCEPTION 'event_start_required';END IF;
        v_start:=(p_args->>'start_at')::timestamptz;
        -- issue #3355 P7 (D-23) — the end time the owner confirmed, never a
        -- silent start + 2 hours.
        IF NULLIF(p_args->>'end_at','') IS NULL THEN RAISE EXCEPTION 'event_end_required';END IF;
        v_end:=(p_args->>'end_at')::timestamptz;
        IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
        IF v_when_mode='recurring' AND (
          jsonb_typeof(v_recurrence_rule) IS DISTINCT FROM 'object'
          OR COALESCE(v_recurrence_rule->>'preset','') NOT IN(
            'daily','weekly','biweekly','monthly_dom','monthly_dow')
          OR jsonb_typeof(v_recurrence_rule->'termination') IS DISTINCT FROM 'object'
          OR COALESCE(v_recurrence_rule#>>'{termination,kind}','') NOT IN('count','until')
          OR (v_recurrence_rule#>>'{termination,kind}'='count' AND (
            COALESCE(v_recurrence_rule#>>'{termination,count}','') !~ '^[0-9]+$'
            OR (v_recurrence_rule#>>'{termination,count}')::integer NOT BETWEEN 1 AND 52))
          OR (v_recurrence_rule#>>'{termination,kind}'='until' AND (
            COALESCE(v_recurrence_rule#>>'{termination,until}','') !~ '^\d{4}-\d{2}-\d{2}$'
            OR (v_recurrence_rule#>>'{termination,until}')::date < (v_start AT TIME ZONE v_timezone)::date
            OR (v_recurrence_rule#>>'{termination,until}')::date > (v_start AT TIME ZONE v_timezone)::date+366))
          OR (v_recurrence_rule->>'preset' IN('weekly','biweekly','monthly_dow')
            AND COALESCE(v_recurrence_rule->>'byDay','') NOT IN('MO','TU','WE','TH','FR','SA','SU'))
          OR (v_recurrence_rule->>'preset'='monthly_dom' AND (
            COALESCE(v_recurrence_rule->>'byMonthDay','') !~ '^[0-9]+$'
            OR (v_recurrence_rule->>'byMonthDay')::integer NOT BETWEEN 1 AND 28))
          OR (v_recurrence_rule->>'preset'='monthly_dow' AND
            COALESCE(v_recurrence_rule->>'bySetPos','') NOT IN('1','2','3','4','-1'))
        ) THEN RAISE EXCEPTION 'event_recurrence_invalid';END IF;
      ELSE
        IF jsonb_typeof(p_args->'multi_dates') IS DISTINCT FROM 'array'
           OR jsonb_array_length(p_args->'multi_dates') NOT BETWEEN 2 AND 24 THEN
          RAISE EXCEPTION 'event_multi_dates_invalid';
        END IF;
        v_multi_dates:='[]'::jsonb;
        FOR v_date_item IN SELECT value FROM jsonb_array_elements(p_args->'multi_dates') LOOP
          v_date_index:=v_date_index+1;
          v_date_text:=NULLIF(v_date_item->>'date','');
          v_start_text:=NULLIF(v_date_item->>'start_time','');
          v_end_text:=NULLIF(v_date_item->>'end_time','');
          IF v_date_text IS NULL OR v_start_text IS NULL OR v_end_text IS NULL THEN
            RAISE EXCEPTION 'event_multi_date_fields_required';
          END IF;
          v_start:=public.business_resolve_event_local_datetime(
            v_date_text,v_start_text,v_timezone
          );
          v_end:=public.business_resolve_event_local_datetime(
            v_date_text,v_end_text,v_timezone
          );
          IF v_end<=v_start THEN v_end:=v_end+interval '1 day';END IF;
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_multi_dates:=v_multi_dates||jsonb_build_array(jsonb_build_object(
            'id',COALESCE(NULLIF(v_date_item->>'id',''),'ari-'||v_date_index::text),
            'date',v_date_text,'startTime',v_start_text,'endTime',v_end_text,
            'overrides',COALESCE(v_date_item->'overrides','{}'::jsonb)));
        END LOOP;
        v_date_item:=v_multi_dates->0;
        v_start:=public.business_resolve_event_local_datetime(
          v_date_item->>'date',v_date_item->>'startTime',v_timezone
        );
        v_end:=public.business_resolve_event_local_datetime(
          v_date_item->>'date',v_date_item->>'endTime',v_timezone
        );
        IF v_end<=v_start THEN v_end:=v_end+interval '1 day';END IF;
      END IF;
      -- issue #3355 P7 — a place the owner picked on the card (lat/lng from
      -- the address search, never typed or guessed).
      IF p_args ? 'location_lat' OR p_args ? 'location_lng' THEN
        IF jsonb_typeof(p_args->'location_lat') IS DISTINCT FROM 'number'
           OR jsonb_typeof(p_args->'location_lng') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'event_location_invalid';
        END IF;
        v_lat:=(p_args->>'location_lat')::numeric;
        v_lng:=(p_args->>'location_lng')::numeric;
        IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180
           OR NULLIF(btrim(COALESCE(p_args->>'city','')),'') IS NULL THEN
          RAISE EXCEPTION 'event_location_invalid';
        END IF;
      END IF;
      v_business:=jsonb_build_object(
        'schemaVersion',1,'legacyLocalDraftId',NULL,
        -- issue #2353 — accept the caller's format enum when it is one of the
        -- three canonical values; fall back to the is_online derivation only
        -- when it is absent or unrecognised, which reproduces the pre-fix
        -- output bit for bit and never fabricates 'hybrid'.
        'format',CASE
          WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
            THEN lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160)))
          WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'
          ELSE 'in_person' END,
        'partyTypes',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibeTags',COALESCE(p_args->'vibe_tags','[]'::jsonb),
        'musicGenres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city',
        'locationGeo',CASE WHEN v_lat IS NULL THEN NULL
          ELSE jsonb_build_object('lat',v_lat,'lng',v_lng) END,
        'coordinatePrecision',CASE WHEN v_lat IS NULL THEN NULL
          WHEN p_args->>'location_precision'='exact' THEN 'exact' ELSE 'approximate' END,
        'requestedVisibility',p_args->>'visibility',
        'coverHue',25,'coverProvider',jsonb_build_object(
          'provider',p_args->'cover_media_provider','sourceUrl',p_args->'cover_media_source_url',
          'credit',p_args->'cover_media_credit','creditUrl',p_args->'cover_media_credit_url','alt',p_args->'cover_media_alt'),
        'currency',p_args->'currency','whenMode',v_when_mode,
        'when',jsonb_build_object('date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
          'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
          'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),
        'recurrenceRule',CASE WHEN v_when_mode='recurring' THEN v_recurrence_rule ELSE NULL END,
        'multiDates',CASE WHEN v_when_mode='multi_date' THEN v_multi_dates ELSE NULL END,
        'location',jsonb_build_object('venueName',p_args->'location_text',
          'address',CASE WHEN jsonb_typeof(p_args->'location_address')='string'
            THEN p_args->'location_address' ELSE NULL END),
        'hideAddressUntilTicket',COALESCE((p_args->>'hide_address_until_ticket')::boolean,false),'tickets',COALESCE(p_args->'tickets','[]'::jsonb),
        'settings',jsonb_build_object('requireApproval',false,'allowTransfers',true,
          'hideRemainingCount',false,'passwordProtected',false,'privateGuestList',false,
          'inPersonPaymentsEnabled',false),
        'isRsvp',false,'rsvpCapacity',NULL,'rsvpAllowPlusOnes',false,'rsvpPlusOnesMax',0,
        'rsvpWaitlistEnabled',false,'rsvpApprovalMode','auto','rsvpDiscoverable',false,
        'rsvpContributionEnabled',false,'rsvpContributionSuggestedCents',NULL,
        'rsvpContributionMinCents',NULL,'lastStepReached',0,'clientRevision',0);
      v_payload:=jsonb_build_object(
        'title',p_args->>'title','description',p_args->'description',
        'location_text',CASE
          WHEN NULLIF(btrim(COALESCE(p_args->>'location_address','')),'') IS NOT NULL
            THEN to_jsonb(concat_ws(' · ',NULLIF(btrim(COALESCE(p_args->>'location_text','')),''),
              btrim(p_args->>'location_address')))
          ELSE p_args->'location_text' END,
        'location_geo',CASE WHEN v_lat IS NULL THEN NULL
          ELSE to_jsonb(format('(%s,%s)',v_lng,v_lat)) END,
        'online_url',p_args->'online_url',
        -- issue #2353 — is_online is a PROJECTION of format, so the pair
        -- cannot be allowed to disagree: a hybrid create must set is_online
        -- true. With no format argument this is the previous expression
        -- exactly.
        'is_online',to_jsonb(CASE
          WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
            THEN lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160))) IN ('online','hybrid')
          ELSE COALESCE((p_args->>'is_online')::boolean,false) END),
        'is_recurring',v_when_mode='recurring','is_multi_date',v_when_mode='multi_date',
        'recurrence_rules',CASE WHEN v_when_mode='recurring' THEN v_recurrence_rule ELSE NULL END,
        'timezone',v_timezone,
        'cover_media_url',p_args->'cover_media_url','cover_media_type',p_args->'cover_media_type',
        'cover_media_poster_url',p_args->'cover_media_poster_url','cover_media_provider',p_args->'cover_media_provider',
        'cover_media_source_url',p_args->'cover_media_source_url','cover_media_credit',p_args->'cover_media_credit',
        'cover_media_credit_url',p_args->'cover_media_credit_url','cover_media_alt',p_args->'cover_media_alt',
        'currency',p_args->'currency','party_types',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibe_tags',COALESCE(p_args->'vibe_tags','[]'::jsonb),'music_genres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','theme',jsonb_build_object('coverHue',25,'business_draft',v_business));
      v_result:=public.business_create_event_draft((p_args->>'brand_id')::uuid,v_payload);
    WHEN 'update_event' THEN
      SELECT status INTO v_event_status FROM public.events WHERE id=v_event_id AND event_type='event' AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found';END IF;
      IF v_event_status='draft' THEN
        v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
        v_business:=COALESCE(v_payload#>'{theme,business_draft}','{}'::jsonb);
        v_revision:=NULLIF(p_args->>'client_revision','')::integer;
        IF p_args ? 'title' THEN v_payload:=jsonb_set(v_payload,'{title}',p_args->'title',true);END IF;
        IF p_args ? 'description' THEN v_payload:=jsonb_set(v_payload,'{description}',p_args->'description',true);END IF;
        IF p_args ? 'location_text' THEN
          v_payload:=jsonb_set(v_payload,'{location_text}',p_args->'location_text',true);
          v_business:=jsonb_set(v_business,'{location,venueName}',p_args->'location_text',true);
        END IF;
        IF p_args ? 'is_online' THEN v_payload:=jsonb_set(v_payload,'{is_online}',p_args->'is_online',true);END IF;
        -- issue #2353 S6 — the DRAFT arm. `update_event` has TWO arms and S4
        -- taught only the LIVE one; this arm was in nobody's site list. The
        -- tester drove the two holes that left open:
        --
        --   * a supplied `format` was accepted, reported SUCCESSFUL, and
        --     silently DISCARDED. The host is told the edit landed and it did
        --     not — Constitution rule 3, and this whole work item began with a
        --     publish that failed silently. The asymmetry is CREATED by this
        --     migration: before S4, neither arm accepted `format`, so the two
        --     agreed by both refusing.
        --   * a supplied `is_online` moved the DERIVED column and left the
        --     SOURCE OF TRUTH stale, so a hybrid draft became
        --     `format=hybrid, is_online=false` and the disagreement SURVIVED
        --     publish into a live row. This needs no out-of-schema key:
        --     `is_online` is an ADVERTISED parameter of the tool
        --     (agentTools.ts:753), so a host saying "this one isn't online any
        --     more" reaches it directly. It is the same "derived column written
        --     without its source of truth" defect the investigation's F-9 found
        --     on business_update_live_event, on a sixth site nobody enumerated.
        --
        -- Precedence matches the create arm (S4a/S4b): a usable `format` WINS
        -- and is_online is projected from it. A bare `is_online` moves `format`
        -- only when the two would otherwise DISAGREE — `is_online=true` on a
        -- stored `hybrid` already agrees, so hybrid is PRESERVED rather than
        -- flattened to `online`, which is the entire point of a three-valued
        -- enum. An unrecognised `format` with no `is_online` stays a no-op,
        -- exactly as on the live arm. Same canonical-membership test, written
        -- the same way, as every other site in this file.
        IF lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160)))
             IN ('in_person','online','hybrid') THEN
          v_draft_format:=lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160)));
          v_business:=jsonb_set(v_business,'{format}',to_jsonb(v_draft_format),true);
          v_payload:=jsonb_set(v_payload,'{is_online}',
            to_jsonb(v_draft_format IN ('online','hybrid')),true);
        ELSIF p_args ? 'is_online' THEN
          v_draft_online:=COALESCE((v_payload->>'is_online')::boolean,false);
          v_draft_format:=lower(btrim(COALESCE(v_business->>'format',''), E' \t\n\r\f\v'||chr(160)));
          IF v_draft_format NOT IN ('in_person','online','hybrid')
             OR (v_draft_format IN ('online','hybrid')) IS DISTINCT FROM v_draft_online THEN
            v_business:=jsonb_set(v_business,'{format}',
              to_jsonb(CASE WHEN v_draft_online THEN 'online' ELSE 'in_person' END),true);
          END IF;
        END IF;
        IF p_args ? 'online_url' THEN v_payload:=jsonb_set(v_payload,'{online_url}',p_args->'online_url',true);END IF;
        -- issue #3355 P7 — party types the owner picked (canonical slugs only,
        -- the same list the publish function checks).
        IF p_args ? 'party_types' THEN
          v_party_types:=p_args->'party_types';
          IF jsonb_typeof(v_party_types) IS DISTINCT FROM 'array'
             OR jsonb_array_length(v_party_types)=0
             OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_party_types) t
               WHERE jsonb_typeof(t) IS DISTINCT FROM 'string'
                 OR (t#>>'{}') NOT IN('birthday-party','rooftop-party','club-night','house-party',
                   'warehouse-party','beach-party','pool-party','boat-party','themed-party',
                   'corporate-event','graduation-party','holiday-party','networking-event','rave','festival'))
          THEN RAISE EXCEPTION 'party_types_not_canonical';END IF;
          v_payload:=jsonb_set(v_payload,'{party_types}',v_party_types,true);
          v_business:=jsonb_set(v_business,'{partyTypes}',v_party_types,true);
        END IF;
        IF p_args ? 'visibility' THEN
          PERFORM public.business_assert_event_visibility(p_args->'visibility');
          v_business:=jsonb_set(v_business,'{requestedVisibility}',p_args->'visibility',true);
        END IF;
        IF p_args ? 'start_at' THEN
          v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),v_payload->>'timezone','UTC');
          v_start:=(p_args->>'start_at')::timestamptz;
          -- issue #3355 P7 (D-23) — moving a draft's start needs the end the
          -- owner confirmed; never a silent start + 2 hours.
          IF NULLIF(p_args->>'end_at','') IS NULL THEN RAISE EXCEPTION 'event_end_required';END IF;
          v_end:=(p_args->>'end_at')::timestamptz;
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_business:=jsonb_set(v_business,'{whenMode}','"single"'::jsonb,true);
          v_business:=jsonb_set(v_business,'{when}',jsonb_build_object(
            'date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
            'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
            'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),true);
          v_payload:=jsonb_set(v_payload,'{timezone}',to_jsonb(v_timezone),true);
        END IF;
        v_business:=jsonb_set(v_business,'{clientRevision}',to_jsonb(v_revision),true);
        v_payload:=jsonb_set(v_payload,'{theme,business_draft}',v_business,true);
        v_result:=public.business_update_event_draft(v_event_id,v_payload,v_revision);
      ELSE
        IF p_args ? 'start_at' OR p_args ? 'end_at' OR p_args ? 'timezone' THEN RAISE EXCEPTION 'live_schedule_requires_patch_event_when';END IF;
        v_business:='{}'::jsonb;
        IF p_args ? 'title' THEN v_business:=v_business||jsonb_build_object('name',p_args->'title');END IF;
        IF p_args ? 'description' THEN v_business:=v_business||jsonb_build_object('description',p_args->'description');END IF;
        IF p_args ? 'location_text' THEN v_business:=v_business||jsonb_build_object('address',p_args->'location_text');END IF;
        IF p_args ? 'online_url' THEN v_business:=v_business||jsonb_build_object('onlineUrl',p_args->'online_url');END IF;
        -- issue #2353 — this feeds business_update_live_event_atomic's `core`,
        -- which S3 now both projects to is_online and PERSISTS into
        -- theme.business_event.format. Accept an explicit format; keep the
        -- is_online derivation for legacy callers.
        -- ENTRY IS THE MEMBERSHIP TEST ITSELF, not `p_args ? 'format'`. The
        -- key-presence form was a REGRESSION this migration introduced and the
        -- tester caught by execution: with an unrecognised `format` present and
        -- `is_online` absent, the CASE's is_online fallback reads a key that is
        -- not there, so the ELSE resolved to a definite 'in_person' and S3
        -- faithfully applied it — a live hybrid event silently relabelled
        -- In person with is_online false, on a call that PRE-FIX did nothing at
        -- all. `p_args` is forwarded verbatim from the tool call
        -- (agentTools.ts:888) and neither create_event nor update_event
        -- declares top-level `additionalProperties: false`, so a model reaching
        -- for the UI's own word "Hybrid" gets there. Entering only on a value
        -- the CASE can honour restores the pre-fix no-op exactly, and is the
        -- same canonical-membership test used at every other site in this file.
        IF lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
           OR p_args ? 'is_online' THEN
          v_business:=v_business||jsonb_build_object('format',CASE
            WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
              THEN lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160)))
            WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'
            ELSE 'in_person' END);
        END IF;
        IF p_args ? 'visibility' THEN v_business:=v_business||jsonb_build_object('visibility',p_args->'visibility');END IF;
        v_result:=public.business_update_live_event_atomic(
          v_event_id,jsonb_build_object('core',v_business),p_args->>'reason',
          NULLIF(p_args->>'client_revision','')::integer
        );
      END IF;
    WHEN 'publish_event' THEN
      v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
      IF p_args ? 'visibility' THEN
        PERFORM public.business_assert_event_visibility(p_args->'visibility');
        v_payload:=jsonb_set(v_payload,'{visibility}',p_args->'visibility',true);
        v_payload:=jsonb_set(
          v_payload,'{theme,business_draft,requestedVisibility}',
          p_args->'visibility',true
        );
      END IF;
      v_result:=public.issue_1719_publish_event_with_poster(v_event_id,v_payload,
        COALESCE(NULLIF(p_args->>'client_revision','')::integer,(v_payload#>>'{theme,business_draft,clientRevision}')::integer));
    WHEN 'unpublish_event' THEN v_result:=public.business_unpublish_event_to_draft(v_event_id);
    WHEN 'cancel_event' THEN v_result:=public.business_cancel_event(v_event_id);
    WHEN 'end_event_sales' THEN v_result:=public.business_end_event_ticket_sales(v_event_id);
    WHEN 'duplicate_event' THEN v_result:=public.business_duplicate_event_as_draft(v_event_id);
    WHEN 'patch_event_when' THEN
      v_result:=public.business_update_live_event_atomic(
        v_event_id,
        jsonb_build_object('core','{}'::jsonb,'when',p_args->'when_payload'),
        p_args->>'reason',
        NULLIF(p_args->>'client_revision','')::integer
      );
    WHEN 'set_event_cover' THEN
      IF COALESCE((p_args->>'clear_cover')::boolean,false) THEN
        v_result:=public.business_clear_event_cover_media(v_event_id);
      ELSE
        v_result:=public.business_set_event_cover_media(v_event_id,p_args->>'selection_ref',
          p_args->>'cover_media_url',p_args->>'cover_media_type',p_args->>'cover_media_poster_url',p_args->>'cover_media_provider',
          p_args->>'cover_media_source_url',p_args->>'cover_media_credit',p_args->>'cover_media_credit_url',p_args->>'cover_media_alt');
      END IF;
    WHEN 'set_event_guest_privacy' THEN v_result:=public.biz_set_event_guest_privacy(v_event_id,
      (p_args->>'private_guest_list')::boolean,(p_args->>'hide_remaining_count')::boolean);
    WHEN 'discard_event_draft' THEN v_result:=public.business_discard_event_draft(v_event_id);
  END CASE;
  RETURN public.agent_operation_receipt_complete(p_operation_id,p_tool_name,p_args,v_result);
END;$function$;

COMMENT ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) IS
  '#1972 canonical confirmed event dispatcher; pending action id is the operation id. #3355 P7: create needs the owner''s end time and time zone, never Private while frozen, takes a picked place; draft updates take party types and never invent an end.';
