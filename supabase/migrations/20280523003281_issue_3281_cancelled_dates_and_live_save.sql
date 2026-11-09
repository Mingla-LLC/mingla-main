-- issue #3281 bundle 3 — cancelled dates everywhere, a live save that adds a
-- date and scopes a ticket to it, and a live RSVP edit that keeps its date.
--
-- W1  Every path that issues a ticket refuses a cancelled date: comps
--     (biz_comp_issue, biz_issue_comp), private links (biz_ticket_link_create,
--     pg_ticket_link_signup_days) and host approval / auto-approve
--     (issue_3827_issue_link_signup, issue_3827_issue_link_signup_days). An
--     event whose upcoming dates are all cancelled answers
--     occurrence_not_available; one with no upcoming date at all keeps its old
--     "ended" answer. An approval drops a cancelled or ended date from the
--     request (status 'declined') before capacity is counted; when no date is
--     left it raises and the request stays pending.
--     Not changed, on purpose: the door tap and the door pay-code finalize
--     record a sale whose money was already taken in person.
-- W2  Buyers see a cancelled date as cancelled: each occurrence on
--     pg_direct_event_checkout_bundle carries `cancelled` and, for builds that
--     predate it, reads sold out with no places left; a day-limited ticket
--     lists it in soldOutOccurrenceIds; the busiest-night remaining, the RSVP
--     schedule and the private link's dates and validOccurrenceIds skip it.
--     pg_public_event_by_slug emits no occurrences, so it is unchanged.
-- W4  business_update_live_event_atomic writes the dates before the tickets,
--     so one save can add a date and scope a ticket or extra to it. The strip
--     of removed dates from ticket and extra lists waits until the tickets are
--     written (a transaction-local setting read by issue_3281_strip_removed_days),
--     then runs once. A direct business_patch_event_when still strips at once.
--     offering_date_past is judged on the stored tickets (inside
--     business_patch_event_when) and again on the saved tickets.
-- W5  biz_update_live_rsvp updates the RSVP's date row in place (id, status,
--     cancelled_at and occurrence_key kept) and inserts one only when none
--     exists.
--
-- Every function below is its latest earlier definition plus the hunks
-- declared in supabase/migrations/__tests__/issue_3281_b3_reemit_hunks.ts.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Drift guard: every function here is re-emitted in full, so refuse to run
-- if a live body differs from its latest repository definition (a hotfix
-- would otherwise be overwritten silently).
DO $drift_guard$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.issue_3281_strip_removed_days(uuid)', '250ae45262671b2dcdd2ac9a113aca82'),
      ('public.business_update_live_event_atomic(uuid,jsonb,text,integer)', '0d35ba7daeabfc18ad25c5c83b3a3962'),
      ('public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)', '3ea7ff82aee396ade514803a602cf720'),
      ('public.biz_issue_comp(uuid,uuid,timestamptz,text,text,integer,text,uuid,uuid,text)', '8426b9520ffd53d8080bd3943df83c22'),
      ('public.biz_ticket_link_create(uuid,uuid,uuid,uuid,text,integer,integer,text,timestamptz,uuid,bytea,text)', '9070bb0a674eac4012eb107473413dc6'),
      ('public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text)', '834352794c7859c8830c712ac8b217c5'),
      ('public.issue_3827_issue_link_signup(uuid,uuid,text)', 'eecc7e53f01d10058b07324d4ccecc21'),
      ('public.issue_3827_issue_link_signup_days(uuid,uuid,text)', '7d122fe5643ac43a17404399da6808ba'),
      ('public.pg_direct_event_checkout_bundle(uuid,text,text)', '8ce7334376f53b00636799da36639ffb'),
      ('public.issue_3872_ticket_sale_json(uuid)', '56a3a214c4c5dad993b806876d64ab3d'),
      ('public.pg_public_rsvp_by_slug(text,text)', 'fda39914c6e687bd807879314062cecb'),
      ('public.issue_3281_ticket_dates_json(uuid)', '67c1e3e21b73c675247440b2c4fb149d'),
      ('public.pg_ticket_link_resolve(text)', '96901688b6afe3420fc34093a71cab21'),
      ('public.biz_update_live_rsvp(uuid,jsonb,text)', '675eda660809724ede7cb7ecda48668e')
    ) AS v(sig, expected_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.sig::regprocedure)
       IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #3281 re-emit drift: % no longer matches its repository definition', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

-- issue_3281_strip_removed_days: from 20280314003281_issue_3281_extras_authoring.sql
CREATE OR REPLACE FUNCTION public.issue_3281_strip_removed_days(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ticket record;
  v_kept text[];
  v_extra record; -- issue #3281
BEGIN
  -- issue #3281: business_update_live_event_atomic writes the dates, then
  -- the tickets, then strips once (so a ticket moved off a removed date is
  -- judged on its new list). A direct when-save still strips here.
  IF current_setting('mingla.issue_3281_defer_day_strip', true) = 'on' THEN
    RETURN;
  END IF;
  FOR v_ticket IN
    SELECT tt.id, tt.valid_occurrence_keys
      FROM public.ticket_types tt
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND tt.valid_occurrence_keys IS NOT NULL
     ORDER BY tt.id
       FOR UPDATE
  LOOP
    SELECT array_agg(d.occurrence_key ORDER BY d.occurrence_key) INTO v_kept
      FROM public.event_dates d
     WHERE d.event_id = p_event_id
       AND d.occurrence_key = ANY (v_ticket.valid_occurrence_keys);
    IF v_kept IS NULL THEN RAISE EXCEPTION 'tier_day_scope_empty'; END IF;
    IF cardinality(v_kept) <> cardinality(v_ticket.valid_occurrence_keys) THEN
      UPDATE public.ticket_types SET valid_occurrence_keys = v_kept, updated_at = now()
       WHERE id = v_ticket.id;
    END IF;
  END LOOP;
  -- issue #3281 — extras follow the same rule as their tiers.
  FOR v_extra IN
    SELECT a.id, a.valid_occurrence_keys
      FROM public.ticket_add_ons a
      JOIN public.ticket_types tt ON tt.id = a.ticket_type_id
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND a.is_active AND a.valid_occurrence_keys IS NOT NULL
     ORDER BY a.id
       FOR UPDATE OF a
  LOOP
    SELECT array_agg(d.occurrence_key ORDER BY d.occurrence_key) INTO v_kept
      FROM public.event_dates d
     WHERE d.event_id = p_event_id
       AND d.occurrence_key = ANY (v_extra.valid_occurrence_keys);
    IF v_kept IS NULL THEN RAISE EXCEPTION 'extra_day_scope_empty'; END IF;
    IF cardinality(v_kept) <> cardinality(v_extra.valid_occurrence_keys) THEN
      UPDATE public.ticket_add_ons SET valid_occurrence_keys = v_kept, updated_at = now()
       WHERE id = v_extra.id;
    END IF;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_strip_removed_days(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_strip_removed_days(uuid) TO service_role;

-- business_update_live_event_atomic: from 20280521004334_issue_4334_google_places.sql
CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy_with_place(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision',''),
      NULLIF(btrim(COALESCE(v_taxonomy->>'locationProviderPlaceId','')),'')
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
    -- issue #3281: dates first, so a ticket or extra in this same save can
    -- name a date the save adds. Removed dates are stripped from ticket and
    -- extra lists once the tickets are written (below), so a ticket moved
    -- off a removed date is judged on its new list, not its old one.
    PERFORM set_config('mingla.issue_3281_defer_day_strip','on',true);
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
    PERFORM set_config('mingla.issue_3281_defer_day_strip','',true);
  END IF;

  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_when IS NOT NULL THEN
    -- issue #3281: the strip business_patch_event_when deferred. A list left
    -- with no date is refused (tier_day_scope_empty), never widened.
    PERFORM public.issue_3281_strip_removed_days(p_event_id);
    -- issue #3281: business_patch_event_when judged offering_date_past on
    -- the tickets stored before this save. Judge it again on the tickets
    -- this save wrote, so a save that makes a ticket paid cannot also move
    -- every date into the past.
    IF EXISTS (SELECT 1 FROM public.ticket_types t
                WHERE t.event_id=p_event_id AND t.deleted_at IS NULL
                  AND t.available_online=true AND t.price_cents>0)
       AND COALESCE((SELECT max(ed.end_at) FROM public.event_dates ed
                      WHERE ed.event_id=p_event_id),'-infinity'::timestamptz)<=now() THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      theme_gradient_override=NULLIF(p_patch#>>'{theme,gradient}',''),
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
  -- issue #3281 — with each tier's extras, so the editor keeps them.
  SELECT COALESCE(jsonb_agg(to_jsonb(tt)||jsonb_build_object('extras',public.issue_3281_tier_extras_json(tt.id))
      ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
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
END;$function$;
REVOKE ALL ON FUNCTION public.business_update_live_event_atomic(uuid,jsonb,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_update_live_event_atomic(uuid,jsonb,text,integer) TO authenticated,service_role;

-- biz_comp_issue: from 20271218024063_issue_4063_claim_writers.sql
CREATE OR REPLACE FUNCTION public.biz_comp_issue(p_actor_id uuid, p_event_id uuid, p_ticket_type_id uuid, p_event_date_id uuid, p_guests jsonb, p_note text, p_client_request_id uuid, p_qr_token_pepper text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_actor_hourly_cap constant integer := 300;
  c_brand_daily_cap constant integer := 1000;
  v_pepper text;
  v_event record;
  v_tt record;
  v_choice jsonb;
  v_date_id uuid;
  v_per_occurrence boolean := false;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_guest jsonb;
  v_po jsonb;
  v_gi integer;
  v_pi integer;
  v_index integer;
  v_name text;
  v_email text;
  v_phone text;
  v_name_only boolean;
  v_emails text[] := ARRAY[]::text[];
  v_indexes integer[] := ARRAY[]::integer[];
  v_unnamed integer;
  -- one row per person, in submission order
  v_people jsonb := '[]'::jsonb;
  v_person jsonb;
  v_key text;
  v_existing_id uuid;
  v_dup_id uuid;
  v_dup_lead uuid;
  v_requested integer := 0;
  v_new_orders integer := 0;
  v_sold integer;
  v_held integer;
  v_remaining integer;
  v_recent integer;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_lead_id uuid;
  v_lead_name text;
  v_added integer := 0;
  v_failed integer := 0;
  v_k integer;
BEGIN
  v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF p_actor_id IS NULL OR p_event_id IS NULL OR p_ticket_type_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'note';
  END IF;

  -- ---- 1. Validate and normalise every person (nothing is written yet) ----
  IF p_guests IS NULL OR jsonb_typeof(p_guests) <> 'array'
     OR jsonb_array_length(p_guests) < 1 OR jsonb_array_length(p_guests) > 50 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'count';
  END IF;

  FOR v_gi IN 0 .. jsonb_array_length(p_guests) - 1 LOOP
    v_guest := p_guests -> v_gi;
    IF jsonb_typeof(v_guest) <> 'object'
       OR jsonb_typeof(v_guest -> 'index') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_guest -> 'name') IS DISTINCT FROM 'string'
       OR COALESCE(jsonb_typeof(v_guest -> 'email'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'phoneE164'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'nameOnly'), 'boolean') <> 'boolean'
       OR COALESCE(jsonb_typeof(v_guest -> 'plusOnes'), 'array') <> 'array' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'shape';
    END IF;
    IF (v_guest ->> 'index') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'index';
    END IF;
    v_index := (v_guest ->> 'index')::integer;
    IF v_index < 0 OR v_index > 49 OR v_index = ANY (v_indexes) THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'index';
    END IF;
    v_indexes := v_indexes || v_index;

    v_name := btrim(v_guest ->> 'name');
    v_email := NULLIF(lower(btrim(COALESCE(v_guest ->> 'email', ''))), '');
    v_phone := NULLIF(btrim(COALESCE(v_guest ->> 'phoneE164', '')), '');
    IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
    END IF;
    IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
    END IF;
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
    END IF;
    -- #4063 nameOnly compatibility: an old client that omits the field and
    -- sends no contact keeps today's name-only behaviour. New clients are
    -- explicit, so false without contact and true with contact are refused.
    v_name_only := COALESCE(
      (v_guest ->> 'nameOnly')::boolean,
      v_email IS NULL AND v_phone IS NULL
    );
    IF v_name_only AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'name_only_with_contact';
    ELSIF NOT v_name_only AND v_email IS NULL AND v_phone IS NULL THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'contact_required';
    END IF;
    IF v_email IS NOT NULL THEN
      IF v_email = ANY (v_emails) THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'listed_twice';
      END IF;
      v_emails := v_emails || v_email;
    END IF;

    v_unnamed := 0;
    IF jsonb_array_length(COALESCE(v_guest -> 'plusOnes', '[]'::jsonb)) > 9 THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'plus_ones';
    END IF;
    -- The guest goes first; their named plus-ones follow, pointing back.
    v_people := v_people || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'plusOneIndex', NULL, 'name', v_name,
      'email', v_email, 'phone', v_phone, 'partySize', 1,
      'nameOnly', v_name_only));

    FOR v_pi IN 0 .. jsonb_array_length(COALESCE(v_guest -> 'plusOnes', '[]'::jsonb)) - 1 LOOP
      v_po := v_guest -> 'plusOnes' -> v_pi;
      IF jsonb_typeof(v_po) <> 'object'
         OR COALESCE(jsonb_typeof(v_po -> 'name'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'email'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'phoneE164'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'nameOnly'), 'boolean') <> 'boolean' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'shape';
      END IF;
      v_name := NULLIF(btrim(COALESCE(v_po ->> 'name', '')), '');
      v_email := NULLIF(lower(btrim(COALESCE(v_po ->> 'email', ''))), '');
      v_phone := NULLIF(btrim(COALESCE(v_po ->> 'phoneE164', '')), '');
      IF v_name IS NULL THEN
        IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
          -- "Add their name, or leave all three empty."
          RAISE EXCEPTION 'invalid_guests' USING HINT = 'plus_one_needs_name';
        END IF;
        v_unnamed := v_unnamed + 1;
        CONTINUE;
      END IF;
      IF char_length(v_name) > 120 THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
      END IF;
      IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
      END IF;
      IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
      END IF;
      v_name_only := COALESCE(
        (v_po ->> 'nameOnly')::boolean,
        v_email IS NULL AND v_phone IS NULL
      );
      IF v_name_only AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'name_only_with_contact';
      ELSIF NOT v_name_only AND v_email IS NULL AND v_phone IS NULL THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'contact_required';
      END IF;
      IF v_email IS NOT NULL THEN
        IF v_email = ANY (v_emails) THEN
          RAISE EXCEPTION 'invalid_guests' USING HINT = 'listed_twice';
        END IF;
        v_emails := v_emails || v_email;
      END IF;
      v_people := v_people || jsonb_build_array(jsonb_build_object(
        'index', v_index, 'plusOneIndex', v_pi, 'name', v_name,
        'email', v_email, 'phone', v_phone, 'partySize', 1,
        'nameOnly', v_name_only));
    END LOOP;

    -- Blank plus-ones ride on the guest's own order.
    IF v_unnamed > 0 THEN
      FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
        IF (v_people -> v_k ->> 'index')::integer = v_index
           AND (v_people -> v_k -> 'plusOneIndex') = 'null'::jsonb THEN
          v_people := jsonb_set(v_people, ARRAY[v_k::text, 'partySize'], to_jsonb(1 + v_unnamed));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- ---- 2. Locks, in create-session order: event, brand, ticket type ----
  SELECT e.id, e.brand_id, e.status, e.deleted_at, e.event_type
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE OF e;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_open';
  END IF;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;

  IF public.biz_brand_effective_rank(v_event.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Visibility is NOT checked: public, hidden, unlisted and private events
  -- all take guest-list tickets.
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_open';
  END IF;
  IF v_event.event_type IN ('trip', 'experience', 'rsvp') THEN
    RAISE EXCEPTION 'event_type_unsupported';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id AND d.end_at > now()) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;
  -- issue #3281: every upcoming date was cancelled. Nothing can be issued,
  -- and the event has not ended, so the answer is the one checkout gives.
  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id
                  AND d.end_at > now() AND d.status = 'active')
     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id
                  AND d.end_at > now() AND d.status <> 'active') THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;

  -- The day: the same predicate checkout uses (issue_3313_event_day_choice).
  v_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF p_event_date_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()
                      AND d.status = 'active') THEN  -- issue #3281
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_date_id := p_event_date_id;
  ELSIF (v_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_date_id := (v_choice ->> 'soleOccurrenceId')::uuid;
  ELSIF COALESCE((v_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- Hidden, disabled, offline and out-of-window tiers ARE allowed: a comp is a
  -- host grant, not a sale.
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited, tt.sold_count
    INTO v_tt
    FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id
     AND tt.event_id = p_event_id
     AND tt.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_type_not_found';
  END IF;

  -- ---- 3. Replays and duplicates do not count against capacity ----
  FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
    v_person := v_people -> v_k;
    v_key := 'comp:' || p_event_id::text || ':' || p_client_request_id::text || ':' || (v_person ->> 'index')
      || CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN '' ELSE ':p' || (v_person ->> 'plusOneIndex') END;
    v_person := v_person || jsonb_build_object('key', v_key);

    SELECT o.id INTO v_existing_id FROM public.orders o WHERE o.comp_request_key = v_key;
    IF FOUND THEN
      v_person := v_person || jsonb_build_object('plan', 'replay', 'orderId', v_existing_id);
    ELSE
      v_dup_id := NULL;
      IF (v_person ->> 'email') IS NOT NULL THEN
        SELECT o.id, o.comp_party_lead_order_id INTO v_dup_id, v_dup_lead
          FROM public.orders o
         WHERE o.event_id = p_event_id AND o.source = 'comp' AND o.payment_status = 'paid'
           AND lower(o.buyer_email) = (v_person ->> 'email');
      END IF;
      IF v_dup_id IS NOT NULL THEN
        v_person := v_person || jsonb_build_object('plan', 'duplicate', 'orderId', v_dup_id,
          'dupIsLead', v_dup_lead IS NULL);
      ELSE
        v_person := v_person || jsonb_build_object('plan', 'new');
        v_requested := v_requested + (v_person ->> 'partySize')::integer;
        v_new_orders := v_new_orders + 1;
      END IF;
    END IF;
    v_people := jsonb_set(v_people, ARRAY[v_k::text], v_person);
  END LOOP;

  -- ---- 4. Capacity: the whole batch or nothing (I-3827-COMP-COUNTS-CAPACITY) ----
  -- The counter rule of the checkout create-session base (20271121003281).
  -- DELETE THIS BLOCK and a guest list can push a tier past its capacity.
  IF NOT v_tt.is_unlimited AND v_tt.quantity_total IS NOT NULL THEN
    IF v_per_occurrence AND v_date_id IS NOT NULL THEN
      v_remaining := v_tt.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tt.id, v_date_id);
    ELSE
      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tt.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tt.quantity_total - COALESCE(v_tt.sold_count, 0) - v_held;
    END IF;
    IF v_requested > v_remaining THEN
      RAISE EXCEPTION 'ticket_capacity_exceeded'
        USING HINT = jsonb_build_object('remaining', GREATEST(v_remaining, 0), 'ticketName', v_tt.name)::text;
    END IF;
  END IF;

  -- ---- 5. Rate limits (fail CLOSED: issuing sends email) ----
  IF v_new_orders > 0 THEN
    SELECT count(*)::integer INTO v_recent
      FROM public.orders o
     WHERE o.source = 'comp' AND o.comp_issued_by = p_actor_id
       AND o.created_at > now() - interval '1 hour';
    IF v_recent + v_new_orders > c_actor_hourly_cap THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
    SELECT count(*)::integer INTO v_recent
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
     WHERE e.brand_id = v_event.brand_id AND o.source = 'comp'
       AND o.created_at > now() - interval '1 day';
    IF v_recent + v_new_orders > c_brand_daily_cap THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
  END IF;

  -- ---- 6. Issue, one person per sub-block ----
  FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
    v_person := v_people -> v_k;

    IF (v_person -> 'plusOneIndex') = 'null'::jsonb THEN
      -- A guest. Their named plus-ones (next rows) attach to this order.
      v_lead_id := NULL;
      v_lead_name := v_person ->> 'name';
    END IF;

    IF (v_person -> 'plusOneIndex') <> 'null'::jsonb AND v_lead_id IS NULL
       AND (v_person ->> 'plan') = 'new' THEN
      v_one := jsonb_build_object('status', 'failed', 'code', 'lead_not_added');
    ELSIF (v_person ->> 'plan') = 'duplicate' THEN
      v_one := jsonb_build_object('status', 'failed', 'code', 'already_on_guest_list');
      -- A guest already on the list: their new plus-ones join that order.
      IF (v_person -> 'plusOneIndex') = 'null'::jsonb AND (v_person ->> 'dupIsLead')::boolean THEN
        v_lead_id := (v_person ->> 'orderId')::uuid;
      END IF;
    ELSE
      BEGIN
        v_one := public.issue_3827_comp_issue_one(
          p_event_id => p_event_id,
          p_brand_id => v_event.brand_id,
          p_ticket_type_id => p_ticket_type_id,
          p_event_date_id => v_date_id,
          p_name => v_person ->> 'name',
          p_email => v_person ->> 'email',
          p_phone_e164 => v_person ->> 'phone',
          p_party_size => (v_person ->> 'partySize')::integer,
          p_request_key => v_person ->> 'key',
          p_qr_token_pepper => v_pepper,
          p_issued_by => p_actor_id,
          p_note => v_note,
          p_metadata => CASE
            WHEN COALESCE((v_person ->> 'nameOnly')::boolean, false)
              THEN jsonb_build_object('name_only', true)
            ELSE NULL
          END,
          p_party_lead_order_id => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE v_lead_id END,
          p_party_lead_name => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE v_lead_name END,
          p_party_origin => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE 'host' END
        );
        IF (v_person -> 'plusOneIndex') = 'null'::jsonb THEN
          v_lead_id := (v_one ->> 'orderId')::uuid;
        END IF;
      EXCEPTION
        WHEN unique_violation THEN
          v_one := jsonb_build_object('status', 'failed', 'code', 'already_on_guest_list');
        WHEN OTHERS THEN
          -- No PII in the log line.
          RAISE WARNING 'biz_comp_issue: person % of event % failed: %', v_k, p_event_id, SQLSTATE;
          v_one := jsonb_build_object('status', 'failed', 'code', 'internal');
      END;
    END IF;

    IF (v_one ->> 'status') = 'failed' THEN
      v_failed := v_failed + 1;
    ELSE
      v_added := v_added + 1;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'index', (v_person ->> 'index')::integer,
      'plusOneIndex', v_person -> 'plusOneIndex',
      'status', v_one ->> 'status',
      'orderId', v_one ->> 'orderId',
      'ticketCount', (v_one ->> 'ticketCount')::integer,
      'emailQueued', COALESCE((v_one ->> 'emailQueued')::boolean, false),
      'smsQueued', COALESCE((v_one ->> 'smsQueued')::boolean, false),
      'code', v_one ->> 'code'
    ));
  END LOOP;

  -- Places left after this call, for the host's sheet.
  v_remaining := NULL;
  IF NOT v_tt.is_unlimited AND v_tt.quantity_total IS NOT NULL THEN
    IF v_per_occurrence AND v_date_id IS NOT NULL THEN
      v_remaining := v_tt.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tt.id, v_date_id);
    ELSE
      SELECT tt.sold_count INTO v_sold FROM public.ticket_types tt WHERE tt.id = v_tt.id;
      v_remaining := v_tt.quantity_total - COALESCE(v_sold, 0) - COALESCE(v_held, 0);
    END IF;
    v_remaining := GREATEST(v_remaining, 0);
  END IF;

  RETURN jsonb_build_object(
    'eventId', p_event_id,
    'eventDateId', v_date_id,
    'results', v_results,
    'addedCount', v_added,
    'failedCount', v_failed,
    'remaining', v_remaining
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text) TO service_role;

-- biz_issue_comp: from 20271224003872_issue_3872_r3_foundation.sql
CREATE OR REPLACE FUNCTION public.biz_issue_comp(
  p_brand_id uuid,
  p_event_id uuid,
  p_occurrence_at timestamptz,
  p_guest_name text,
  p_guest_email_norm text,
  p_quantity integer,
  p_source text,
  p_source_ref uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_entry public.guest_comp_entries;
  v_event_date_id uuid;
  v_ticket_type_id uuid;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  IF p_brand_id IS NULL OR p_event_id IS NULL OR p_occurrence_at IS NULL
     OR p_source_ref IS NULL OR p_issued_by IS NULL
     OR p_source NOT IN ('host','gig') OR p_quantity IS NULL
     OR p_quantity NOT BETWEEN 1 AND 10
     OR char_length(btrim(COALESCE(p_guest_name,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_comp_request';
  END IF;
  IF p_guest_email_norm IS NOT NULL AND (
    p_guest_email_norm<>lower(btrim(p_guest_email_norm))
    OR p_guest_email_norm!~'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
  ) THEN RAISE EXCEPTION 'invalid_comp_email'; END IF;

  SELECT * INTO v_entry
    FROM public.guest_comp_entries
   WHERE event_id=p_event_id AND source=p_source AND source_ref=p_source_ref;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'entryId',v_entry.id,'orderId',v_entry.order_id,'status',v_entry.status,
      'idempotentReplay',true
    );
  END IF;

  PERFORM 1
    FROM public.events e
   WHERE e.id=p_event_id AND e.brand_id=p_brand_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id,p_issued_by)<40 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT d.id INTO v_event_date_id
    FROM public.event_dates d
   WHERE d.event_id=p_event_id AND d.status='active'  -- issue #3281
     AND (d.start_at=p_occurrence_at OR p_occurrence_at BETWEEN d.start_at AND d.end_at)
   ORDER BY abs(extract(epoch FROM (d.start_at-p_occurrence_at))),d.id
   LIMIT 1;
  IF v_event_date_id IS NULL THEN RAISE EXCEPTION 'occurrence_not_found'; END IF;

  SELECT tt.id INTO v_ticket_type_id
    FROM public.ticket_types tt
   WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL
   ORDER BY
     (lower(tt.name)~'(guest|comp|creator)') DESC,
     tt.is_hidden DESC,
     tt.display_order,
     tt.created_at
   LIMIT 1;
  IF v_ticket_type_id IS NULL THEN RAISE EXCEPTION 'ticket_type_not_found'; END IF;

  v_result:=public.biz_comp_issue(
    p_issued_by,p_event_id,v_ticket_type_id,v_event_date_id,
    jsonb_build_array(jsonb_build_object(
      'index',0,'name',btrim(p_guest_name),'email',p_guest_email_norm,
      'phoneE164',NULL,'plusOnes',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object('name',NULL,'email',NULL,'phoneE164',NULL)),'[]'::jsonb)
          FROM generate_series(1,GREATEST(p_quantity-1,0))
      )
    )),
    CASE WHEN p_source='gig' THEN 'Creator gig pass' ELSE 'Host comp' END,
    p_source_ref,p_qr_token_pepper
  );
  v_order_id:=NULLIF(v_result#>>'{results,0,orderId}','')::uuid;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'comp_issue_failed'; END IF;

  INSERT INTO public.guest_comp_entries(
    brand_id,event_id,occurrence_at,guest_name,guest_email_norm,quantity,
    source,source_ref,issued_by,order_id
  ) VALUES(
    p_brand_id,p_event_id,p_occurrence_at,btrim(p_guest_name),p_guest_email_norm,p_quantity,
    p_source,p_source_ref,p_issued_by,v_order_id
  ) RETURNING * INTO v_entry;

  RETURN jsonb_build_object(
    'entryId',v_entry.id,'orderId',v_entry.order_id,'status',v_entry.status,
    'ticketCount',p_quantity,'idempotentReplay',false
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.biz_issue_comp(uuid,uuid,timestamptz,text,text,integer,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_issue_comp(uuid,uuid,timestamptz,text,text,integer,text,uuid,uuid,text) TO service_role;

-- biz_ticket_link_create: from 20271209003827_issue_3827_private_ticket_links.sql
CREATE OR REPLACE FUNCTION public.biz_ticket_link_create(
  p_actor_id uuid,
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_label text,
  p_max_uses integer,
  p_party_max integer,
  p_approval_mode text,
  p_expires_at timestamptz,
  p_link_id uuid,
  p_nonce bytea,
  p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_tier record;
  v_kind text;
  v_link public.ticket_type_links;
BEGIN
  IF p_actor_id IS NULL OR p_event_id IS NULL OR p_ticket_type_id IS NULL
     OR p_link_id IS NULL OR octet_length(p_nonce) <> 16
     OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type
    INTO v_event FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.visibility NOT IN ('public', 'hidden') THEN
    RAISE EXCEPTION 'event_unavailable';
  END IF;
  IF v_event.event_type IN ('trip', 'experience', 'rsvp') THEN
    RAISE EXCEPTION 'event_type_unsupported';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id AND d.end_at > now()) THEN
    RAISE EXCEPTION 'event_ended';
  END IF;
  -- issue #3281: every upcoming date was cancelled. Nothing can be issued,
  -- and the event has not ended, so the answer is the one checkout gives.
  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id
                  AND d.end_at > now() AND d.status = 'active')
     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id
                  AND d.end_at > now() AND d.status <> 'active') THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, p_actor_id)
      < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT tt.id, tt.event_id, tt.is_free, tt.price_cents, tt.is_disabled,
         tt.is_hidden, tt.available_online, tt.deleted_at
    INTO v_tier FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND OR v_tier.deleted_at IS NOT NULL OR v_tier.event_id <> p_event_id THEN
    RAISE EXCEPTION 'ticket_type_not_found';
  END IF;
  v_kind := CASE WHEN COALESCE(v_tier.is_free, false) OR COALESCE(v_tier.price_cents, 0) = 0
                 THEN 'guest_list' ELSE 'private_ticket' END;
  IF v_kind = 'private_ticket'
     AND (COALESCE(v_tier.is_disabled, false) OR NOT COALESCE(v_tier.available_online, false)) THEN
    RAISE EXCEPTION 'tier_not_sellable_online';
  END IF;
  IF v_kind = 'private_ticket' AND NOT COALESCE(v_tier.is_hidden, false) THEN
    RAISE EXCEPTION 'paid_tier_must_be_hidden';
  END IF;
  IF p_event_date_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()
       AND d.status = 'active'  -- issue #3281
  ) THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry_in_past';
  END IF;
  IF char_length(btrim(COALESCE(p_label, ''))) NOT BETWEEN 1 AND 60
     OR p_max_uses IS NOT NULL AND p_max_uses NOT BETWEEN 1 AND 5000
     OR COALESCE(p_party_max, 1) NOT BETWEEN 1 AND 10
     OR COALESCE(p_approval_mode, 'auto') NOT IN ('auto', 'host') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF v_kind = 'private_ticket'
     AND (COALESCE(p_party_max, 1) <> 1 OR COALESCE(p_approval_mode, 'auto') <> 'auto') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF (SELECT count(*) FROM public.ticket_type_links l
       WHERE l.event_id = p_event_id AND l.revoked_at IS NULL) >= 100 THEN
    RAISE EXCEPTION 'too_many_links';
  END IF;

  INSERT INTO public.ticket_type_links(
    id, event_id, brand_id, ticket_type_id, event_date_id, kind, label,
    max_uses, party_max, approval_mode, expires_at, token_nonce, token_hash,
    created_by
  ) VALUES (
    p_link_id, p_event_id, v_event.brand_id, p_ticket_type_id, p_event_date_id,
    v_kind, btrim(p_label), p_max_uses,
    CASE WHEN v_kind = 'private_ticket' THEN 1 ELSE COALESCE(p_party_max, 1) END,
    CASE WHEN v_kind = 'private_ticket' THEN 'auto' ELSE COALESCE(p_approval_mode, 'auto') END,
    p_expires_at, p_nonce, p_token_hash, p_actor_id
  ) RETURNING * INTO v_link;

  RETURN jsonb_build_object(
    'id', v_link.id, 'eventId', v_link.event_id,
    'ticketTypeId', v_link.ticket_type_id, 'eventDateId', v_link.event_date_id,
    'kind', v_link.kind, 'label', v_link.label, 'maxUses', v_link.max_uses,
    'partyMax', v_link.party_max, 'approvalMode', v_link.approval_mode,
    'expiresAt', v_link.expires_at, 'revokedAt', v_link.revoked_at,
    'createdAt', v_link.created_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.biz_ticket_link_create(uuid,uuid,uuid,uuid,text,integer,integer,text,timestamptz,uuid,bytea,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_create(uuid,uuid,uuid,uuid,text,integer,integer,text,timestamptz,uuid,bytea,text) TO service_role;

-- pg_ticket_link_signup_days: from 20271211003827_issue_3827_link_cover_and_dates.sql
CREATE OR REPLACE FUNCTION public.pg_ticket_link_signup_days(
  p_token_hash text,
  p_members jsonb,
  p_event_date_ids uuid[],
  p_client_request_id uuid,
  p_ip_hash text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_existing_signup public.ticket_link_signups;
  v_signup_id uuid := gen_random_uuid();
  v_date_id uuid;
  v_date_ids uuid[] := ARRAY[]::uuid[];
  v_per_date boolean := false;
  v_all_days boolean := false;
  v_d uuid;
  v_item jsonb;
  v_members jsonb := '[]'::jsonb;
  v_passes jsonb;
  v_pass jsonb;
  v_emails text[] := ARRAY[]::text[];
  v_i integer;
  v_name text;
  v_email text;
  v_phone text;
  v_existing_order uuid;
  v_first_order uuid;
  v_pending boolean;
  v_any_new boolean;
  v_lead_waiting boolean;
  v_status text;
  v_email_hits integer;
  v_phone_hits integer;
  v_member_id uuid;
  v_result jsonb;
  v_people jsonb;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_client_request_id IS NULL
     OR p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_members IS NULL OR jsonb_typeof(p_members) <> 'array'
     OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 10
     OR COALESCE(cardinality(p_event_date_ids), 0) > 60
     OR array_position(p_event_date_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_members) - 1 LOOP
    v_item := p_members -> v_i;
    v_name := btrim(COALESCE(v_item ->> 'name', ''));
    v_email := lower(btrim(COALESCE(v_item ->> 'email', '')));
    v_phone := btrim(COALESCE(v_item ->> 'phoneE164', ''));
    IF jsonb_typeof(v_item) <> 'object' OR v_item - ARRAY['name','email','phoneE164'] <> '{}'::jsonb
       OR char_length(v_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.name', 'reason', 'missing'
      )::text;
    END IF;
    IF char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.email', 'reason', 'format'
      )::text;
    END IF;
    IF v_email = ANY(v_emails) THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.email', 'reason', 'duplicate_in_request'
      )::text;
    END IF;
    v_emails := v_emails || v_email;
    IF v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.phone', 'reason', 'format'
      )::text;
    END IF;
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'position', v_i, 'name', v_name, 'email', v_email, 'phoneE164', v_phone
    ));
  END LOOP;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  SELECT s.* INTO v_existing_signup FROM public.ticket_link_signups s
   WHERE s.link_id = v_link.id AND s.client_request_id = p_client_request_id;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'position', m.position, 'name', m.name,
      'maskedEmail', CASE WHEN position('@' IN m.email) < 2 THEN '***'
        ELSE left(split_part(m.email, '@', 1), LEAST(2, char_length(split_part(m.email, '@', 1))))
          || '***@' || split_part(m.email, '@', 2) END
    ) ORDER BY m.position), '[]'::jsonb) INTO v_people
    FROM public.ticket_link_signup_members m WHERE m.signup_id = v_existing_signup.id;
    RETURN jsonb_build_object('status', CASE WHEN v_existing_signup.status = 'duplicate' THEN 'issued'
      ELSE v_existing_signup.status END, 'people', v_people, 'emailQueuedOrderIds', '[]'::jsonb);
  END IF;

  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type,
         COALESCE(e.is_multi_date, false) AS is_multi_date,
         COALESCE(e.is_recurring, false) AS is_recurring,
         COALESCE(e.multi_date_pricing_mode, 'per_day') AS pricing_mode
    INTO v_event FROM public.events e WHERE e.id = v_link.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.deleted_at INTO v_tier FROM public.ticket_types tt
   WHERE tt.id = v_link.ticket_type_id FOR UPDATE;
  v_status := public.issue_3827_link_state(v_link, now());
  -- A full link may still be replaying a request whose people already have
  -- tickets. Let the locked issuer distinguish that harmless replay from a
  -- new person who would exceed the link's limit.
  IF v_status NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_status WHEN 'revoked' THEN 'link_revoked'
      WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_status END;
  END IF;
  IF v_link.kind <> 'guest_list' THEN RAISE EXCEPTION 'not_a_guest_list_link'; END IF;
  IF jsonb_array_length(v_members) > v_link.party_max THEN
    RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
      'field', 'members', 'reason', 'too_many'
    )::text;
  END IF;

  v_choice := public.issue_3313_event_day_choice(v_link.event_id);
  v_per_date := COALESCE((v_choice ->> 'requiresChoice')::boolean, false);
  -- issue #3281: every upcoming date was cancelled. Nothing can be issued,
  -- and the event has not ended, so the answer is the one checkout gives.
  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_link.event_id
                  AND d.end_at > now() AND d.status = 'active')
     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_link.event_id
                  AND d.end_at > now() AND d.status <> 'active') THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;
  IF NOT v_per_date THEN
    -- An event that never asks for a date: exactly the single-date rule.
    IF COALESCE(cardinality(p_event_date_ids), 0) > 1 THEN
      RAISE EXCEPTION 'invalid_request';
    END IF;
    IF v_link.event_date_id IS NOT NULL THEN
      v_date_id := v_link.event_date_id;
    ELSIF COALESCE(cardinality(p_event_date_ids), 0) = 1 THEN
      v_date_id := p_event_date_ids[1];
    ELSIF (v_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
      v_date_id := (v_choice ->> 'soleOccurrenceId')::uuid;
    END IF;
    IF v_date_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_dates d
       WHERE d.id = v_date_id AND d.event_id = v_link.event_id AND d.end_at > now()
         AND d.status = 'active'  -- issue #3281
    ) THEN RAISE EXCEPTION 'occurrence_not_available'; END IF;
  ELSE
    v_all_days := v_event.is_multi_date AND NOT v_event.is_recurring
      AND v_event.pricing_mode = 'all_days';
    IF v_link.event_date_id IS NOT NULL THEN
      v_date_ids := ARRAY[v_link.event_date_id];
    ELSIF v_all_days THEN
      -- An all-days pass covers every upcoming date; the guest picks nothing.
      v_date_ids := ARRAY(
        SELECT d.id FROM public.event_dates d
         WHERE d.event_id = v_link.event_id AND d.end_at > now()
           AND d.status = 'active'  -- issue #3281
      );
    ELSE
      v_date_ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_event_date_ids, ARRAY[]::uuid[])) AS x);
    END IF;
    IF cardinality(v_date_ids) = 0 THEN
      RAISE EXCEPTION 'event_date_choice_required';
    END IF;
    IF (
      SELECT count(*) FROM public.event_dates d
       WHERE d.id = ANY(v_date_ids) AND d.event_id = v_link.event_id AND d.end_at > now()
         AND d.status = 'active'  -- issue #3281
    ) <> cardinality(v_date_ids) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_date_ids := ARRAY(
      SELECT d.id FROM public.event_dates d WHERE d.id = ANY(v_date_ids)
       ORDER BY d.start_at, d.id
    );
    v_date_id := v_date_ids[1];
  END IF;

  -- Rate gates fail closed and count every person in the group.
  IF p_ip_hash IS NOT NULL AND (
    SELECT count(*) FROM public.ticket_link_signups s
     WHERE s.ip_hash = p_ip_hash AND s.created_at > now() - interval '1 hour'
  ) >= 20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF (
    SELECT COALESCE(sum(s.member_count), 0) FROM public.ticket_link_signups s
     WHERE s.link_id = v_link.id AND s.created_at > now() - interval '1 hour'
  ) + jsonb_array_length(v_members) > 300 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF (
    SELECT count(*) FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND m.status = 'pending'
  ) + jsonb_array_length(v_members) > 500 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    v_email := v_item ->> 'email';
    v_phone := v_item ->> 'phoneE164';
    SELECT count(*) INTO v_email_hits FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND lower(m.email) = v_email
      AND m.created_at > now() - interval '1 hour';
    SELECT count(*) INTO v_phone_hits FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND m.phone_e164 = v_phone
      AND m.created_at > now() - interval '1 hour';
    IF v_email_hits >= 3 OR v_phone_hits >= 3 OR (
      SELECT count(*) FROM public.ticket_link_signup_members m
       WHERE m.event_id = v_link.event_id AND m.phone_e164 = v_phone
         AND m.created_at > now() - interval '1 hour'
    ) >= 10 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  END LOOP;

  -- Classify before insert. The lead already pending returns the same pending
  -- state without creating a second group.
  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    IF NOT v_per_date THEN
      v_existing_order := NULL;
      SELECT o.id INTO v_existing_order FROM public.orders o
       WHERE o.event_id = v_link.event_id AND o.source = 'comp'
         AND o.payment_status IN ('paid', 'partial_refund')
         AND lower(o.buyer_email) = v_item ->> 'email'
       ORDER BY o.created_at, o.id LIMIT 1;
      SELECT EXISTS(
        SELECT 1 FROM public.ticket_link_signup_members m
         WHERE m.event_id = v_link.event_id AND m.status = 'pending'
           AND lower(m.email) = v_item ->> 'email'
      ) INTO v_pending;
      IF v_i = 0 AND v_existing_order IS NULL AND v_pending THEN
        RETURN jsonb_build_object('status', 'pending', 'alreadyPending', true,
          'people', jsonb_build_array(jsonb_build_object(
            'position', 0, 'name', v_item ->> 'name', 'maskedEmail', NULL
          )), 'emailQueuedOrderIds', '[]'::jsonb);
      END IF;
      v_members := jsonb_set(v_members, ARRAY[v_i::text], v_item || jsonb_build_object(
        'status', CASE WHEN v_existing_order IS NOT NULL OR v_pending THEN 'duplicate' ELSE 'pending' END,
        'orderId', v_existing_order
      ));
    ELSE
      -- Decision (b): each date is decided on its own.
      v_passes := '[]'::jsonb;
      v_any_new := false;
      v_lead_waiting := true;
      v_first_order := NULL;
      FOREACH v_d IN ARRAY v_date_ids LOOP
        v_existing_order := public.issue_3827_comp_order_on_date(
          v_link.event_id, v_item ->> 'email', v_d);
        v_pending := v_existing_order IS NULL AND public.issue_3827_link_pending_on_date(
          v_link.event_id, v_item ->> 'email', v_d, NULL);
        IF v_existing_order IS NOT NULL THEN
          v_lead_waiting := false;
          v_first_order := COALESCE(v_first_order, v_existing_order);
        ELSIF NOT v_pending THEN
          v_lead_waiting := false;
          v_any_new := true;
        END IF;
        v_passes := v_passes || jsonb_build_array(jsonb_build_object(
          'eventDateId', v_d,
          'status', CASE WHEN v_existing_order IS NOT NULL OR v_pending THEN 'duplicate' ELSE 'pending' END,
          'orderId', v_existing_order
        ));
      END LOOP;
      IF v_i = 0 AND v_lead_waiting THEN
        RETURN jsonb_build_object('status', 'pending', 'alreadyPending', true,
          'people', jsonb_build_array(jsonb_build_object(
            'position', 0, 'name', v_item ->> 'name', 'maskedEmail', NULL
          )), 'emailQueuedOrderIds', '[]'::jsonb);
      END IF;
      v_members := jsonb_set(v_members, ARRAY[v_i::text], v_item || jsonb_build_object(
        'status', CASE WHEN v_any_new THEN 'pending' ELSE 'duplicate' END,
        'orderId', v_first_order,
        'passes', v_passes
      ));
    END IF;
  END LOOP;

  INSERT INTO public.ticket_link_signups(
    id, link_id, event_id, status, member_count, event_date_id,
    client_request_id, ip_hash, per_date
  ) VALUES (
    v_signup_id, v_link.id, v_link.event_id, 'pending', jsonb_array_length(v_members),
    v_date_id, p_client_request_id, p_ip_hash, v_per_date
  );
  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    INSERT INTO public.ticket_link_signup_members(
      signup_id, event_id, position, name, email, phone_e164, status, order_id, per_date
    ) VALUES (
      v_signup_id, v_link.event_id, v_i, v_item ->> 'name', v_item ->> 'email',
      v_item ->> 'phoneE164', v_item ->> 'status', (v_item ->> 'orderId')::uuid, v_per_date
    ) RETURNING id INTO v_member_id;
    IF v_per_date THEN
      FOR v_pass IN SELECT value FROM jsonb_array_elements(v_item -> 'passes') LOOP
        INSERT INTO public.ticket_link_member_passes(
          member_id, signup_id, event_id, event_date_id, status, order_id
        ) VALUES (
          v_member_id, v_signup_id, v_link.event_id, (v_pass ->> 'eventDateId')::uuid,
          v_pass ->> 'status', (v_pass ->> 'orderId')::uuid
        );
      END LOOP;
    END IF;
  END LOOP;

  IF v_link.approval_mode = 'auto' THEN
    v_result := public.issue_3827_issue_link_signup(v_signup_id, NULL, p_qr_token_pepper);
  ELSE
    v_result := jsonb_build_object('status', 'pending', 'emailQueuedOrderIds', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'position', m.position, 'name', m.name,
    'maskedEmail', left(split_part(m.email, '@', 1), LEAST(2, char_length(split_part(m.email, '@', 1))))
      || '***@' || split_part(m.email, '@', 2)
  ) ORDER BY m.position), '[]'::jsonb) INTO v_people
  FROM public.ticket_link_signup_members m WHERE m.signup_id = v_signup_id;
  RETURN v_result || jsonb_build_object(
    'status', CASE WHEN v_result ->> 'status' = 'duplicate' THEN 'issued' ELSE v_result ->> 'status' END,
    'people', v_people
  ) || CASE WHEN v_per_date
    THEN jsonb_build_object('eventDateIds', to_jsonb(v_date_ids))
    ELSE '{}'::jsonb END;
END;
$$;
REVOKE ALL ON FUNCTION public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text) TO service_role;

-- issue_3827_issue_link_signup: from 20271211003827_issue_3827_link_cover_and_dates.sql
CREATE OR REPLACE FUNCTION public.issue_3827_issue_link_signup(
  p_signup_id uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup public.ticket_link_signups;
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_member record;
  v_existing uuid;
  v_new integer := 0;
  v_used integer;
  v_held integer := 0;
  v_remaining integer;
  v_lead_order uuid;
  v_one jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_state text;
BEGIN
  SELECT s.* INTO v_signup FROM public.ticket_link_signups s WHERE s.id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_found'; END IF;
  -- issue #3827: several dates per sign-up.
  IF v_signup.per_date THEN
    RETURN public.issue_3827_issue_link_signup_days(p_signup_id, p_issued_by, p_qr_token_pepper);
  END IF;
  IF v_signup.status NOT IN ('pending', 'issued', 'duplicate') THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;
  IF v_signup.status IN ('issued', 'duplicate') THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = v_signup.link_id FOR UPDATE;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type
    INTO v_event FROM public.events e WHERE e.id = v_signup.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited,
         tt.sold_count
    INTO v_tier FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id FOR UPDATE;

  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_state
      WHEN 'revoked' THEN 'link_revoked' WHEN 'expired' THEN 'link_expired'
      ELSE v_state END;
  END IF;

  -- issue #3281: the request's date was cancelled, or ended, while it
  -- waited (or, with no date of its own, every upcoming date was
  -- cancelled). Nothing is issued and the request stays pending.
  IF v_signup.event_date_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = v_signup.event_date_id AND d.status = 'active' AND d.end_at > now()
  ) THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;
  IF v_signup.event_date_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_signup.event_id
                      AND d.end_at > now() AND d.status = 'active')
     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_signup.event_id
                  AND d.end_at > now() AND d.status <> 'active') THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;

  -- Re-classify under the event lock. A host may have added somebody while the
  -- request waited; that person is skipped without blocking the group.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position FOR UPDATE
  LOOP
    SELECT o.id INTO v_existing FROM public.orders o
     WHERE o.event_id = v_signup.event_id AND o.source = 'comp'
       AND o.payment_status IN ('paid', 'partial_refund')
       AND lower(o.buyer_email) = lower(v_member.email)
     ORDER BY o.created_at, o.id LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.ticket_link_signup_members
         SET status = 'duplicate', order_id = v_existing WHERE id = v_member.id;
      v_skipped := v_skipped || jsonb_build_array(v_member.name);
      IF v_member.position = 0 THEN v_lead_order := v_existing; END IF;
      INSERT INTO public.ticket_order_notifications(
        order_id, event_id, channel, recipient, idempotency_key, payload
      ) VALUES (
        v_existing, v_signup.event_id, 'email', v_member.email,
        'ticket_link_resend:' || v_existing::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        jsonb_build_object('source', 'comp', 'resend', true)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    ELSE
      UPDATE public.ticket_link_signup_members
         SET status = 'pending', order_id = NULL WHERE id = v_member.id;
      v_new := v_new + 1;
    END IF;
  END LOOP;

  v_used := public.issue_3827_link_uses_taken(v_link.id);
  IF v_link.max_uses IS NOT NULL AND v_used + v_new > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full' USING HINT = jsonb_build_object(
      'remaining', GREATEST(v_link.max_uses - v_used, 0), 'needed', v_new
    )::text;
  END IF;

  v_choice := public.issue_3313_event_day_choice(v_signup.event_id);
  IF NOT v_tier.is_unlimited AND v_tier.quantity_total IS NOT NULL THEN
    IF COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false)
       AND v_signup.event_date_id IS NOT NULL THEN
      v_remaining := v_tier.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tier.id, v_signup.event_date_id);
    ELSE
      SELECT COALESCE(sum(i.quantity), 0)::integer INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tier.id AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tier.quantity_total - COALESCE(v_tier.sold_count, 0) - v_held;
    END IF;
    IF v_new > v_remaining THEN
      RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
        'remaining', GREATEST(v_remaining, 0), 'needed', v_new,
        'ticketName', v_tier.name
      )::text;
    END IF;
  END IF;

  -- Lead first, then guests. Exceptions are deliberately not caught:
  -- I-3827-LINK-GROUP-ATOMIC rolls the entire group back.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position
  LOOP
    IF v_member.status = 'duplicate' THEN CONTINUE; END IF;
    v_one := public.issue_3827_comp_issue_one(
      v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
      v_signup.event_date_id, v_member.name, v_member.email, v_member.phone_e164,
      1, 'link:' || v_signup.id::text || ':' || v_member.position::text,
      p_qr_token_pepper, p_issued_by, v_link.id, NULL,
      CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_order END,
      CASE WHEN v_member.position = 0 THEN NULL ELSE (
        SELECT m0.name FROM public.ticket_link_signup_members m0
         WHERE m0.signup_id = v_signup.id AND m0.position = 0
      ) END,
      CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
      jsonb_build_object(
        'marketing_opt_in', true, 'via_link', true,
        'ticket_link_signup_id', v_signup.id
      )
    );
    v_existing := (v_one ->> 'orderId')::uuid;
    UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_existing;
    UPDATE public.ticket_link_signup_members
       SET status = 'issued', order_id = v_existing WHERE id = v_member.id;
    IF v_member.position = 0 THEN v_lead_order := v_existing; END IF;
    IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
      v_orders := v_orders || jsonb_build_array(v_existing);
    END IF;
  END LOOP;

  UPDATE public.ticket_link_signups
     SET status = CASE WHEN v_new = 0 THEN 'duplicate' ELSE 'issued' END,
         lead_order_id = v_lead_order,
         decided_by = p_issued_by,
         decided_at = CASE WHEN p_issued_by IS NULL THEN decided_at ELSE now() END
   WHERE id = v_signup.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_new = 0 THEN 'duplicate' ELSE 'issued' END,
    'leadOrderId', v_lead_order, 'emailQueuedOrderIds', v_orders,
    'issuedCount', v_new, 'skippedNames', v_skipped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3827_issue_link_signup(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_issue_link_signup(uuid,uuid,text) TO service_role;

-- issue_3827_issue_link_signup_days: from 20271211003827_issue_3827_link_cover_and_dates.sql
CREATE OR REPLACE FUNCTION public.issue_3827_issue_link_signup_days(
  p_signup_id uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup public.ticket_link_signups;
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_member record;
  v_pass record;
  v_existing uuid;
  v_first uuid;
  v_member_new boolean;
  v_new_passes integer := 0;
  v_new_people integer := 0;
  v_new_members integer := 0;
  v_units integer;
  v_used integer;
  v_held integer := 0;
  v_remaining integer;
  v_all_days boolean;
  v_lead_name text;
  v_lead_order uuid;
  v_lead_orders jsonb := '{}'::jsonb;
  v_party_lead uuid;
  v_dates uuid[];
  v_anchor uuid;
  v_order uuid;
  v_one jsonb;
  v_resent uuid[] := ARRAY[]::uuid[];
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_state text;
BEGIN
  SELECT s.* INTO v_signup FROM public.ticket_link_signups s WHERE s.id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_found'; END IF;
  IF NOT v_signup.per_date THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF v_signup.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = v_signup.link_id FOR UPDATE;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type,
         COALESCE(e.is_multi_date, false) AS is_multi_date,
         COALESCE(e.is_recurring, false) AS is_recurring,
         COALESCE(e.multi_date_pricing_mode, 'per_day') AS pricing_mode
    INTO v_event FROM public.events e WHERE e.id = v_signup.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited,
         tt.sold_count
    INTO v_tier FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id FOR UPDATE;

  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_state
      WHEN 'revoked' THEN 'link_revoked' WHEN 'expired' THEN 'link_expired'
      ELSE v_state END;
  END IF;

  -- The same rule the public event payload and normal checkout use.
  v_all_days := v_event.is_multi_date AND NOT v_event.is_recurring
    AND v_event.pricing_mode = 'all_days';

  -- Re-classify every chosen date under the event lock (decision b).
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position FOR UPDATE
  LOOP
    v_member_new := false;
    v_first := NULL;
    FOR v_pass IN
      SELECT p.id, p.event_date_id FROM public.ticket_link_member_passes p
        JOIN public.event_dates d ON d.id = p.event_date_id
       WHERE p.member_id = v_member.id
       ORDER BY d.start_at, d.id
    LOOP
      -- issue #3281: a date cancelled, or ended, while the request waited
      -- is dropped from it before anything is counted. An all-days pass is
      -- then issued on the dates still pending.
      IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.id = v_pass.event_date_id
                      AND d.status = 'active' AND d.end_at > now()) THEN
        UPDATE public.ticket_link_member_passes
           SET status = 'declined', order_id = NULL WHERE id = v_pass.id;
        CONTINUE;
      END IF;
      v_existing := public.issue_3827_comp_order_on_date(
        v_signup.event_id, v_member.email, v_pass.event_date_id);
      IF v_existing IS NOT NULL THEN
        UPDATE public.ticket_link_member_passes
           SET status = 'duplicate', order_id = v_existing WHERE id = v_pass.id;
        v_first := COALESCE(v_first, v_existing);
        IF NOT (v_existing = ANY(v_resent)) THEN
          v_resent := v_resent || v_existing;
          INSERT INTO public.ticket_order_notifications(
            order_id, event_id, channel, recipient, idempotency_key, payload
          ) VALUES (
            v_existing, v_signup.event_id, 'email', v_member.email,
            'ticket_link_resend:' || v_existing::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
            jsonb_build_object('source', 'comp', 'resend', true)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      ELSIF public.issue_3827_link_pending_on_date(
        v_signup.event_id, v_member.email, v_pass.event_date_id, v_signup.id
      ) THEN
        UPDATE public.ticket_link_member_passes
           SET status = 'duplicate', order_id = NULL WHERE id = v_pass.id;
      ELSE
        UPDATE public.ticket_link_member_passes
           SET status = 'pending', order_id = NULL WHERE id = v_pass.id;
        v_member_new := true;
        v_new_passes := v_new_passes + 1;
      END IF;
    END LOOP;

    IF v_member_new THEN
      UPDATE public.ticket_link_signup_members
         SET status = 'pending', order_id = NULL WHERE id = v_member.id;
      v_new_members := v_new_members + 1;
      -- Decision (a): a person this link already counts is not counted again.
      IF NOT EXISTS (
        SELECT 1 FROM public.orders o
          JOIN public.tickets t ON t.order_id = o.id
         WHERE o.ticket_link_id = v_link.id AND o.source = 'comp'
           AND o.payment_status IN ('paid', 'partial_refund')
           AND t.status IN ('valid', 'used')
           AND lower(o.buyer_email) = lower(v_member.email)
      ) THEN
        v_new_people := v_new_people + 1;
      END IF;
    ELSE
      UPDATE public.ticket_link_signup_members
         SET status = 'duplicate', order_id = v_first WHERE id = v_member.id;
      v_skipped := v_skipped || jsonb_build_array(v_member.name);
    END IF;
  END LOOP;

  -- issue #3281: every date the request named is cancelled or over.
  -- Raising rolls the drops back, so the request stays pending.
  IF NOT EXISTS (SELECT 1 FROM public.ticket_link_member_passes p
                  WHERE p.signup_id = v_signup.id AND p.status <> 'declined') THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;

  v_used := public.issue_3827_link_uses_taken(v_link.id);
  IF v_link.max_uses IS NOT NULL AND v_used + v_new_people > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full' USING HINT = jsonb_build_object(
      'remaining', GREATEST(v_link.max_uses - v_used, 0), 'needed', v_new_people
    )::text;
  END IF;

  -- Capacity counts passes, the way normal checkout does: per night on a
  -- recurring event; one shared pool otherwise, where a per-day pass uses one
  -- place per date and an all-days pass uses one place.
  v_choice := public.issue_3313_event_day_choice(v_signup.event_id);
  IF NOT v_tier.is_unlimited AND v_tier.quantity_total IS NOT NULL THEN
    IF COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false) THEN
      FOR v_pass IN
        SELECT p.event_date_id, count(*)::integer AS needed
          FROM public.ticket_link_member_passes p
         WHERE p.signup_id = v_signup.id AND p.status = 'pending'
         GROUP BY p.event_date_id
      LOOP
        v_remaining := v_tier.quantity_total
          - public.issue_3313_ticket_type_occurrence_taken(v_tier.id, v_pass.event_date_id);
        IF v_pass.needed > v_remaining THEN
          RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
            'remaining', GREATEST(v_remaining, 0), 'needed', v_pass.needed,
            'ticketName', v_tier.name, 'eventDateId', v_pass.event_date_id
          )::text;
        END IF;
      END LOOP;
    ELSE
      v_units := CASE WHEN v_all_days THEN v_new_members ELSE v_new_passes END;
      SELECT COALESCE(sum(i.quantity), 0)::integer INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tier.id AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tier.quantity_total - COALESCE(v_tier.sold_count, 0) - v_held;
      IF v_units > v_remaining THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
          'remaining', GREATEST(v_remaining, 0), 'needed', v_units,
          'ticketName', v_tier.name
        )::text;
      END IF;
    END IF;
  END IF;

  -- The lead's existing passes anchor a guest's party line on each date.
  SELECT m0.name INTO v_lead_name FROM public.ticket_link_signup_members m0
   WHERE m0.signup_id = v_signup.id AND m0.position = 0;
  SELECT COALESCE(jsonb_object_agg(p.event_date_id::text, p.order_id), '{}'::jsonb)
    INTO v_lead_orders
    FROM public.ticket_link_member_passes p
    JOIN public.ticket_link_signup_members m ON m.id = p.member_id
   WHERE m.signup_id = v_signup.id AND m.position = 0
     AND p.status = 'duplicate' AND p.order_id IS NOT NULL;
  SELECT m.order_id INTO v_lead_order FROM public.ticket_link_signup_members m
   WHERE m.signup_id = v_signup.id AND m.position = 0 AND m.status = 'duplicate';

  -- Lead first, then guests.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position
  LOOP
    IF v_member.status = 'duplicate' THEN CONTINUE; END IF;
    IF v_all_days THEN
      v_dates := ARRAY(
        SELECT p.event_date_id FROM public.ticket_link_member_passes p
          JOIN public.event_dates d ON d.id = p.event_date_id
         WHERE p.member_id = v_member.id AND p.status = 'pending'
         ORDER BY d.start_at, d.id
      );
      v_party_lead := NULL;
      IF v_member.position <> 0 THEN
        SELECT o.id INTO v_party_lead FROM public.orders o
         WHERE o.id IN (
           SELECT value::uuid FROM jsonb_each_text(v_lead_orders)
         ) AND o.comp_party_lead_order_id IS NULL
         ORDER BY o.created_at, o.id LIMIT 1;
      END IF;
      -- One pass valid on every new date: no day on the order while the pass
      -- rows are written, then the latest-ending date anchors the order (the
      -- payout and refund anchor normal checkout uses).
      v_one := public.issue_3827_comp_issue_one(
        v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
        CASE WHEN cardinality(v_dates) = 1 THEN v_dates[1] ELSE NULL END,
        v_member.name, v_member.email, v_member.phone_e164,
        1, 'link:' || v_signup.id::text || ':' || v_member.position::text,
        p_qr_token_pepper, p_issued_by, v_link.id, NULL,
        v_party_lead,
        CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_name END,
        CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
        jsonb_build_object(
          'marketing_opt_in', true, 'via_link', true,
          'ticket_link_signup_id', v_signup.id
        )
      );
      v_order := (v_one ->> 'orderId')::uuid;
      IF cardinality(v_dates) > 1 THEN
        INSERT INTO public.ticket_event_dates(ticket_id, event_date_id)
        SELECT t.id, x.id FROM public.tickets t CROSS JOIN unnest(v_dates) AS x(id)
         WHERE t.order_id = v_order
        ON CONFLICT DO NOTHING;
        SELECT d.id INTO v_anchor FROM public.event_dates d
         WHERE d.id = ANY(v_dates) ORDER BY d.end_at DESC, d.id DESC LIMIT 1;
        UPDATE public.orders SET event_date_id = v_anchor WHERE id = v_order;
      END IF;
      UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_order;
      UPDATE public.ticket_link_member_passes
         SET status = 'issued', order_id = v_order
       WHERE member_id = v_member.id AND status = 'pending';
      UPDATE public.ticket_link_signup_members
         SET status = 'issued', order_id = v_order WHERE id = v_member.id;
      IF v_member.position = 0 THEN
        v_lead_order := COALESCE(v_lead_order, v_order);
        SELECT v_lead_orders || COALESCE(jsonb_object_agg(x.id::text, v_order), '{}'::jsonb)
          INTO v_lead_orders FROM unnest(v_dates) AS x(id);
      END IF;
      IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
        v_orders := v_orders || jsonb_build_array(v_order);
      END IF;
    ELSE
      v_first := NULL;
      FOR v_pass IN
        SELECT p.id, p.event_date_id FROM public.ticket_link_member_passes p
          JOIN public.event_dates d ON d.id = p.event_date_id
         WHERE p.member_id = v_member.id AND p.status = 'pending'
         ORDER BY d.start_at, d.id
      LOOP
        v_party_lead := NULL;
        IF v_member.position <> 0 THEN
          SELECT o.id INTO v_party_lead FROM public.orders o
           WHERE o.id = (v_lead_orders ->> v_pass.event_date_id::text)::uuid
             AND o.comp_party_lead_order_id IS NULL;
        END IF;
        v_one := public.issue_3827_comp_issue_one(
          v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
          v_pass.event_date_id, v_member.name, v_member.email, v_member.phone_e164,
          1, 'link:' || v_signup.id::text || ':' || v_member.position::text
            || ':' || v_pass.event_date_id::text,
          p_qr_token_pepper, p_issued_by, v_link.id, NULL,
          v_party_lead,
          CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_name END,
          CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
          jsonb_build_object(
            'marketing_opt_in', true, 'via_link', true,
            'ticket_link_signup_id', v_signup.id
          )
        );
        v_order := (v_one ->> 'orderId')::uuid;
        v_first := COALESCE(v_first, v_order);
        UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_order;
        UPDATE public.ticket_link_member_passes
           SET status = 'issued', order_id = v_order WHERE id = v_pass.id;
        IF v_member.position = 0 THEN
          v_lead_orders := v_lead_orders || jsonb_build_object(v_pass.event_date_id::text, v_order);
        END IF;
        IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
          v_orders := v_orders || jsonb_build_array(v_order);
        END IF;
      END LOOP;
      UPDATE public.ticket_link_signup_members
         SET status = 'issued', order_id = v_first WHERE id = v_member.id;
      IF v_member.position = 0 THEN v_lead_order := COALESCE(v_first, v_lead_order); END IF;
    END IF;
  END LOOP;

  UPDATE public.ticket_link_signups
     SET status = CASE WHEN v_new_passes = 0 THEN 'duplicate' ELSE 'issued' END,
         lead_order_id = v_lead_order,
         decided_by = p_issued_by,
         decided_at = CASE WHEN p_issued_by IS NULL THEN decided_at ELSE now() END
   WHERE id = v_signup.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_new_passes = 0 THEN 'duplicate' ELSE 'issued' END,
    'leadOrderId', v_lead_order, 'emailQueuedOrderIds', v_orders,
    'issuedCount', v_new_members, 'issuedPasses', v_new_passes,
    'skippedNames', v_skipped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3827_issue_link_signup_days(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_issue_link_signup_days(uuid,uuid,text) TO service_role;

-- pg_direct_event_checkout_bundle: from 20280521004334_issue_4334_google_places.sql
CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(p_event_id uuid DEFAULT NULL::uuid, p_brand_slug text DEFAULT NULL::text, p_event_slug text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$WITH issue_3281_original(payload) AS MATERIALIZED (
WITH issue_3872_original(payload) AS MATERIALIZED (

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
      -- issue #2160 DELTA 1 of 3. See the note above the appended keys.
      e.is_multi_date,
      e.is_recurring,
      e.multi_date_pricing_mode,
      e.refund_policy,
      -- issue #3313 — the stored rule, and the one day-choice predicate.
      e.recurrence_rules,
      public.issue_3313_event_day_choice(e.id) AS day_choice,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.location_provider_place_id,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      -- issue #3314 — the organiser's "Hide remaining count", read from the raw
      -- row (theme.business_event.settings), never from the public_theme above:
      -- a later tightening of that sanitiser must not quietly turn this into
      -- "show". Resolved to a boolean on the output key below.
      e.theme #>> '{business_event,settings,hideRemainingCount}' AS hide_remaining_count_setting,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      -- issue #2160 DELTA 2 of 3 — WITHDRAWN. The literal predicate STAYS.
      --
      -- This clause was briefly `pg_offering_visibility_gate(e.visibility,
      -- e.deleted_at, 'direct')`, to make the SPEC's demanded end state
      -- (T-14 / I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE) true — the SPEC
      -- asserted the gate was ALREADY here and it was not. The substitution was
      -- behaviour-identical and proved so. It is withdrawn anyway, because it
      -- is STRUCTURALLY UNAVAILABLE to any migration that lands after #2117:
      --
      --   The #2117 offering-visibility-gate workflow under `.github/workflows/`
      --   (filename ends `issue-2117-offering-visibility-gate-tests`; the
      --   extension is omitted ON PURPOSE — `validate-manifest-v2.mjs:796`
      --   discovers CI dependencies by scanning EVERY non-workflow file for
      --   `/[A-Za-z0-9_.-]+\.ya?ml/`, comments included, so spelling it in full
      --   here registers this migration as a consumer of that workflow and
      --   drifts the reference inventory. It failed exactly that way in CI.
      --   This file is not a consumer of it; it only explains a decision.)
      --   applies THE WHOLE CHAIN EXCEPT #2117, captures the A-SC-9 baseline,
      --   then applies #2117. Calling the gate makes this file fail phase 1
      --   with "function public.pg_offering_visibility_gate(...) does not
      --   exist" — a `LANGUAGE sql` body is validated at CREATE time. Moving
      --   this file to phase 2 fixes that and then fails A-SC-9(a), because
      --   §H's `authenticated` grant is no longer in the BEFORE snapshot and
      --   is reported as having "arrived" with #2117.
      --
      -- Both constraints cannot hold at once, so the gate is not reusable by
      -- anything downstream of it until that lane's baseline capture is
      -- restructured. That is #2117's own decision to make, not this issue's,
      -- and it is recorded in the implementation report rather than worked
      -- around here: a payment-adjacent public reader is the wrong place to
      -- carry a CI-shaped compromise.
      --
      -- The literal below is what #1929/#1931 shipped and is byte-identical to
      -- what the gate would have returned for audience 'direct'.
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- issue #2462 — THE ORGANISER'S PURCHASE RULES. Absent from this reader
      -- since #1929, which is why `directBundleTicketToStub` fabricated
      -- `minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true`: it had
      -- nothing to map. The server has always enforced them, so the cart let a
      -- guest pick a quantity the RPC then refused with
      -- `ticket_quantity_above_max` -> "Nothing was reserved - please try again",
      -- a permanent dead end. DELETE THESE THREE LINES and that returns.
      tt.min_purchase_qty,
      tt.max_purchase_qty,
      tt.allow_transfers,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        -- issue #3313 — per-night capacity: the most places any UPCOMING night
        -- still has, from the same per-night counter the checkout guard reads
        -- (ONE OWNER FOR CAPACITY). "Sold out" only when every night is full.
        WHEN COALESCE((ev.day_choice ->> 'perOccurrenceCapacity')::boolean, false)
             AND EXISTS (
               SELECT 1 FROM public.event_dates d
                WHERE d.event_id = ev.id AND d.end_at > now()
             )
          THEN (
            SELECT GREATEST(0, MAX(
                     tt.quantity_total
                     - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                   ))
              FROM public.event_dates d
             WHERE d.event_id = ev.id AND d.end_at > now()
               AND d.status = 'active'  -- issue #3281
          )
        ELSE GREATEST(
          0,
          tt.quantity_total
            -- issue #2491 C2 step 4 — the same switch as the guard, on the READ
            -- path. This subquery ran once per ticket type PER PAGE VIEW, and at
            -- 100k sold that is ~18.7 ms of database time for every person merely
            -- LOOKING at the event. Page views arrive before reservations and
            -- outnumber them, so this is the larger volume problem of the two.
            -- Switched to the same column the guard now reads, so the advertised
            -- number and the enforced number remain ONE OWNER FOR CAPACITY (#2462).
            - COALESCE(tt.sold_count, 0)
            -- issue #2462 — IN-FLIGHT HOLDS COUNT. This subtrahend is byte-for-byte
            -- the `v_reserved` the capacity guard in
            -- issue_1930_ticket_checkout_create_session_base already applies. Without
            -- it the page advertises stock the server has committed: measured on
            -- production, 5 concurrent holds moved the guard by 5 and moved this
            -- number by 0 (229 -> 229). At low traffic v_reserved is ~0 so the two
            -- agree and the divergence is invisible; under load the guest reads
            -- "N available" and is refused as sold out. ONE OWNER FOR CAPACITY.
            - COALESCE((
                SELECT SUM(i.quantity)::integer
                FROM public.ticket_checkout_session_items i
                JOIN public.ticket_checkout_sessions s
                  ON s.id = i.checkout_session_id
                WHERE i.ticket_type_id = tt.id
                  AND s.expires_at > now()
                  AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
              ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
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
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- #4334 N-1: the picked Google place id, withheld with the street.
      'googlePlaceId', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE ev.location_provider_place_id
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
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
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order,
          -- issue #2462 — APPENDED LAST so CREATE OR REPLACE preserves every
          -- pre-existing key name and order (house rule, …1931…:735-740).
          'minPurchaseQty', tix.min_purchase_qty,
          'maxPurchaseQty', tix.max_purchase_qty,
          'allowTransfers', tix.allow_transfers
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json),
      -- ══ issue #2160 DELTA 3 of 3 — APPENDED LAST ═══════════════════════
      -- Appended after every pre-existing key so CREATE OR REPLACE preserves
      -- each existing key's name AND order (the house rule at …1931…:735-740).
      --
      -- `occurrences` (SPEC §F / D-4, closes #2161). The occurrence list now
      -- travels on the SAME SECURITY DEFINER reader that served the event, so
      -- ONE authority decides who may see this event and its schedule. The
      -- direct `.from("event_dates")` read in publicEventOccurrencesService is
      -- deleted in the same change: a guest surface must never read that table
      -- again (I-PROPOSED-2160-D). Costs zero extra round trips.
      --
      -- NO `ticketsRemaining` KEY, DELIBERATELY. `event_dates` has no capacity
      -- column and capacity is authored event-level on ticket_types.quantity_
      -- total, so there is no honest per-day remaining. Stamping the
      -- event-level number onto each day would claim per-day availability that
      -- does not exist (Constitution #9).
      'occurrences', (
        SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                 'id',        d.id,
                 'startAt',   d.start_at,
                 'endAt',     d.end_at,
                 'timezone',  d.timezone,
                 'isMaster',  d.is_master,
                 -- issue #3281 many-dates — APPENDED LAST on each occurrence
                 'soldOut', CASE
                   -- issue #3281: forced for builds that predate `cancelled`.
                   WHEN d.status <> 'active' THEN true
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE COALESCE((
                     SELECT bool_and(
                       tt.quantity_total IS NOT NULL
                       AND public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                             >= tt.quantity_total
                     )
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                       AND NOT COALESCE(tt.is_unlimited, false)
                   ), false)
                 END,
                 'placesLeft', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   WHEN d.status <> 'active' THEN 0  -- issue #3281
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE (
                     SELECT GREATEST(0, SUM(
                       GREATEST(0,
                         tt.quantity_total
                         - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                       )
                     ))
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                       AND NOT COALESCE(tt.is_unlimited, false)
                       AND tt.quantity_total IS NOT NULL
                   )
                 END,
                 'placesLeftByTicket', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   -- issue #3281: every ticket on sale reads 0 on a cancelled date.
                   WHEN d.status <> 'active' THEN (
                     SELECT COALESCE(pg_catalog.json_object_agg(tt.id::text, 0), '{}'::json)
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                   )
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE (
                     SELECT COALESCE(pg_catalog.json_object_agg(
                       tt.id::text,
                       GREATEST(0,
                         tt.quantity_total
                         - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                       )
                     ), '{}'::json)
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                       AND NOT COALESCE(tt.is_unlimited, false)
                       AND tt.quantity_total IS NOT NULL
                   )
                 END,
                 'overrideTitle', d.override_title,
                 'overrideLocation', d.override_location,
                 -- issue #3281 — APPENDED LAST. A cancelled date stays listed so a
                 -- buyer who saw it reads "Cancelled" instead of it vanishing.
                 'cancelled', d.status <> 'active'
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
           -- issue #3313 — a recurring event offers only nights still ahead,
           -- which keeps `isMultiDate === (occurrences.length > 1)` true (the
           -- shipped native shape check). Multi-date events are unchanged
           -- (do NOT filter ended multi-date rows — F5 / many-dates picker).
           AND (NOT (COALESCE(ev.is_recurring, false) AND NOT COALESCE(ev.is_multi_date, false))
                OR d.end_at > now())
      ),
      -- THE MULTI-DATE SIGNAL. Without these two keys the day chooser is
      -- UNREACHABLE, and it was: `detailFromDirectBundle` hard-codes
      -- `is_multi_date: false`, this bundle is the FIRST reader consulted by
      -- both getPublicEventBySlug and getPublicEventById, and the bundle
      -- carried no multi-date key — so `asWhenMode` resolved every
      -- bundle-served ticketed event to 'single' and #2135's chooser never
      -- mounted, on PUBLIC events as well as unlisted ones. #2161 diagnosed
      -- this as "works for public, silently empty for unlisted"; measured on
      -- the full migration chain, it worked for neither. See the
      -- implementation report.
      --
      -- `isRecurring` rides along because the gate is `multi_date` ONLY —
      -- deriving multi-date from `occurrences.length > 1` would sweep in
      -- recurring events, which #2145 keeps out of scope.
      -- issue #3313 — `isMultiDate` now means "the guest must pick a day":
      -- unchanged for multi-date events, and true for a recurring event while
      -- more than one night is ahead. Every shipped client already mounts the
      -- day chooser from this key, so recurring events get it with no release.
      'isMultiDate', COALESCE((ev.day_choice ->> 'requiresChoice')::boolean, false),
      'isRecurring', COALESCE(ev.is_recurring, false),
      -- The organiser's pricing choice, so the page can say "per day" or
      -- "for all days" BEFORE the guest sees a total (amendment §7).
      'multiDatePricingMode', COALESCE(ev.multi_date_pricing_mode, 'per_day'),
      -- issue #3314 — the organiser's "Hide remaining count", so a guest page can
      -- decide from the SAME reader that served the event, public or unlisted.
      -- The social-proof read that carried it before answers for public events
      -- only, so an unlisted page could never learn the count was allowed.
      -- Same value as pg_public_social_proof: absent or JSON null is false (the
      -- organiser never turned it on). A value that is not a boolean, which
      -- makes that read raise, is true here: fail closed without breaking the page.
      -- Placed BEFORE recurrenceRule, not last: #3284's contract keeps
      -- recurrenceRule then refundPolicy as the final two keys.
      'hideRemainingCount', CASE
        WHEN ev.hide_remaining_count_setting IS NULL THEN false
        WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
          THEN ev.hide_remaining_count_setting::boolean
        ELSE true
      END,
      -- issue #3281 many-dates — before #3313 recurrenceRule / #3284 refundPolicy
      -- so R-16e still sees recurrenceRule immediately before refundPolicy.
      'allDaysPass', (
        COALESCE(ev.is_multi_date, false)
        AND NOT COALESCE(ev.is_recurring, false)
        AND COALESCE(ev.multi_date_pricing_mode, 'per_day') = 'all_days'
      ),
      'nextStartAt', (sched.schedule ->> 'nextStartAt')::timestamptz,
      'nextEndAt', (sched.schedule ->> 'nextEndAt')::timestamptz,
      'upcomingCount', COALESCE((sched.schedule ->> 'upcomingCount')::integer, 0),
      -- issue #3313 — APPENDED LAST. The stored repeat rule, so the public page
      -- can say "Every Tuesday" over the real dates instead of "Recurring
      -- (incomplete)".
      'recurrenceRule', CASE
        WHEN COALESCE(ev.is_recurring, false) AND jsonb_typeof(ev.recurrence_rules) = 'object'
          THEN ev.recurrence_rules
        ELSE NULL
      END,
      'refundPolicy', ev.refund_policy
    ) END
  FROM ev
  LEFT JOIN LATERAL (
    SELECT public.issue_3281_event_schedule(ev.id) AS schedule
  ) sched ON true
)
SELECT public.issue_3872_enrich_public_ticket_payload(payload,'tickets','id',NULL) FROM issue_3872_original
)
SELECT public.issue_3281_attach_public_extras(payload) FROM issue_3281_original;$function$;
REVOKE ALL ON FUNCTION public.pg_direct_event_checkout_bundle(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_direct_event_checkout_bundle(uuid,text,text) TO anon,authenticated,service_role;

-- issue_3872_ticket_sale_json: from 20280228003281_issue_3281_day_limited_tickets.sql
CREATE OR REPLACE FUNCTION public.issue_3872_ticket_sale_json(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'saleBaseCents',s.sale_base_cents,
    'saleAllInCents',CASE WHEN s.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(
      s.sale_base_cents,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
      COALESCE(e.pass_service_fee,b.default_pass_service_fee),
      (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
    ) END,
    'saleEndsAt',s.sale_ends_at,
    'saleName',s.sale_name,
    'saleRemaining',s.sale_remaining
  ) || CASE WHEN tt.valid_occurrence_keys IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      -- issue #3281 — keys exist only on day-limited tickets, so every other
      -- ticket's payload is unchanged. No counts: "Hide remaining" still holds.
      -- The reader's run-wide remaining would read sold out after one full date.
      'remaining',public.issue_3281_listed_remaining(tt.id),
      'validOccurrenceIds',COALESCE((
        SELECT jsonb_agg(d.id ORDER BY d.start_at,d.id) FROM public.event_dates d
         WHERE d.event_id=tt.event_id AND d.occurrence_key=ANY(tt.valid_occurrence_keys)
      ),'[]'::jsonb),
      'soldOutOccurrenceIds',COALESCE((
        SELECT jsonb_agg(d.id ORDER BY d.start_at,d.id) FROM public.event_dates d
         WHERE d.event_id=tt.event_id AND d.occurrence_key=ANY(tt.valid_occurrence_keys)
           AND (d.status<>'active'  -- issue #3281: a cancelled date is never on sale
             OR (NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
           AND public.issue_3313_ticket_type_occurrence_taken(tt.id,d.id)>=tt.quantity_total))
      ),'[]'::jsonb)
    ) END
  FROM public.ticket_types tt
  JOIN public.events e ON e.id=tt.event_id
  JOIN public.brands b ON b.id=e.brand_id
  LEFT JOIN LATERAL public.issue_3872_display_sale_unit(tt.id,now()) s ON true
  WHERE tt.id=p_ticket_type_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_ticket_sale_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_ticket_sale_json(uuid) TO service_role;

-- pg_public_rsvp_by_slug: from 20280521004334_issue_4334_google_places.sql
CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$WITH issue_3872_original(payload) AS MATERIALIZED (

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
      e.location_provider_place_id,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
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
      b.theme_gradient AS brand_theme_gradient,
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
      'themeGradientOverride', ev.theme_gradient_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation,
        'themeGradient', ev.brand_theme_gradient
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
      -- #4334 N-1: the picked Google place id, withheld with the street. Added
      -- just before publicEventRow so every earlier key keeps its position.
      'googlePlaceId', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE ev.location_provider_place_id
      END,
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
            sched.next_start_at,
            sched.next_end_at,
            sched.upcoming_count,
            sched.schedule_line,
            b.theme_gradient AS brand_theme_gradient,
            e.theme_gradient_override,
            -- #4334: the view's appended last column, same withholding rule.
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::text
              ELSE e.location_provider_place_id
            END AS location_provider_place_id
          FROM public.events e
          JOIN public.brands b ON b.id = e.brand_id
          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
          LEFT JOIN LATERAL (
            SELECT
              n.start_at AS next_start_at,
              n.end_at AS next_end_at,
              COALESCE(c.upcoming_count, 0) AS upcoming_count,
              CASE
                WHEN COALESCE(c.upcoming_count, 0) = 0 THEN NULL
                WHEN c.upcoming_count = 1 THEN to_char(
                  n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon')
                ELSE format(
                  '%s · +%s more',
                  to_char(n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon'),
                  c.upcoming_count - 1)
              END AS schedule_line
            FROM (
              SELECT count(*)::integer AS upcoming_count
                FROM public.event_dates d
               WHERE d.event_id = e.id AND d.end_at > now()
                 AND d.status = 'active'  -- issue #3281
            ) c
            LEFT JOIN LATERAL (
              SELECT d.start_at, d.end_at
                FROM public.event_dates d
               WHERE d.event_id = e.id AND d.end_at > now()
                 AND d.status = 'active'  -- issue #3281
               ORDER BY d.start_at, d.id
               LIMIT 1
            ) n ON true
          ) sched ON true
          WHERE e.id = ev.id
        ) r
      )
    ) END
  FROM ev
)
SELECT public.issue_3872_enrich_rsvp_payload(payload) FROM issue_3872_original;$function$;
GRANT EXECUTE ON FUNCTION public.pg_public_rsvp_by_slug(text,text) TO anon,authenticated,service_role;

-- issue_3281_ticket_dates_json: from 20280406003281_issue_3281_private_link_ticket_dates.sql
CREATE OR REPLACE FUNCTION public.issue_3281_ticket_dates_json(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'validOccurrenceIds',
    CASE WHEN tt.valid_occurrence_keys IS NULL THEN NULL ELSE to_jsonb(ARRAY(
      SELECT d.id FROM public.event_dates d
       WHERE d.event_id = tt.event_id
         AND d.occurrence_key = ANY (tt.valid_occurrence_keys)
         AND d.status = 'active'  -- issue #3281
       ORDER BY d.start_at, d.id)) END)
  FROM public.ticket_types tt
  WHERE tt.id = p_ticket_type_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_ticket_dates_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_ticket_dates_json(uuid) TO service_role;

-- pg_ticket_link_resolve: from 20280430011023_issue_1023_theme_fonts_and_gradients.sql
CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link public.ticket_type_links;
  v_state text;
  v_result jsonb;
  v_remaining integer;
  v_active boolean;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  v_state := public.issue_3827_link_state(v_link, now());

  SELECT CASE
    WHEN COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL THEN NULL
    ELSE GREATEST(tt.quantity_total - COALESCE(tt.sold_count, 0) - COALESCE((
      SELECT sum(i.quantity)::integer FROM public.ticket_checkout_session_items i
      JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
      WHERE i.ticket_type_id = tt.id AND s.expires_at > now()
        AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
    ), 0), 0) END INTO v_remaining
  FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id;

  -- The state the page shows. Only an active link learns the cover media
  -- and the date-choice settings.
  v_active := v_state = 'active' AND v_remaining IS DISTINCT FROM 0;

  SELECT jsonb_build_object(
    'state', CASE WHEN v_state = 'active' AND v_remaining = 0 THEN 'sold_out' ELSE v_state END,
    'kind', v_link.kind,
    'linkId', v_link.id,
    'eventId', e.id,
    'guestsMax', GREATEST(v_link.party_max - 1, 0),
    'approvalRequired', v_link.approval_mode = 'host',
    'eventDateId', v_link.event_date_id,
    'hideRemaining', COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false),
    'event', jsonb_build_object(
      'title', e.title, 'brandName', b.name, 'brandSlug', b.slug,
      'eventSlug', e.slug, 'visibility', e.visibility,
      'coverUrl', e.cover_media_url, 'startAt', ed.start_at,
      'endAt', ed.end_at, 'timezone', COALESCE(ed.timezone, e.timezone),
      'venueLine', CASE WHEN public.issue_2489_address_withheld(e.theme)
        THEN NULLIF(e.theme #>> '{business_event,location,venueName}', '')
        ELSE COALESCE(NULLIF(e.theme #>> '{business_event,location,venueName}', ''), e.location_text) END,
      'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
      'themeColor', COALESCE(e.theme_color_override, b.theme_color),
      -- issue #1023: the gradient follows the colour's level as one unit.
      'themeGradient', CASE WHEN e.theme_color_override IS NOT NULL
        THEN e.theme_gradient_override ELSE b.theme_gradient END,
      'themeFont', COALESCE(e.theme_font_override, b.theme_font)
    ) || CASE WHEN v_active THEN jsonb_build_object(
      'coverMediaType', e.cover_media_type,
      'coverPosterUrl', e.cover_media_poster_url
    ) ELSE '{}'::jsonb END,
    'tier', CASE WHEN v_link.kind = 'guest_list'
      THEN jsonb_build_object('id', tt.id, 'name', tt.name)
      ELSE jsonb_build_object(
        'id', tt.id, 'name', tt.name, 'description', tt.description,
        'priceCents', tt.price_cents,
        'allInCents', CASE WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
          ELSE public.compute_all_in_cents(
            tt.price_cents, COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
            COALESCE(e.pass_service_fee, b.default_pass_service_fee),
            (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
          ) END,
        'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
        'minPurchaseQty', COALESCE(tt.min_purchase_qty, 1),
        'maxPurchaseQty', tt.max_purchase_qty,
        'isUnlimited', COALESCE(tt.is_unlimited, false),
        'waitlistEnabled', COALESCE(tt.waitlist_enabled, false),
        'remaining', CASE WHEN COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false)
          THEN NULL ELSE v_remaining END,
        'saleStartAt', tt.sale_start_at, 'saleEndAt', tt.sale_end_at
      ) || COALESCE(public.issue_3872_ticket_sale_json(tt.id),'{}'::jsonb)
        || COALESCE(public.issue_3281_ticket_dates_json(tt.id),'{}'::jsonb) END,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'startAt', d.start_at, 'endAt', d.end_at, 'timezone', d.timezone
      ) ORDER BY d.start_at)
      FROM public.event_dates d
      WHERE d.event_id = e.id AND d.end_at > now()
        AND d.status = 'active'  -- issue #3281
        AND v_link.event_date_id IS NULL
        AND COALESCE((public.issue_3313_event_day_choice(e.id) ->> 'requiresChoice')::boolean, false)
    ), '[]'::jsonb)
  ) || CASE WHEN v_active THEN jsonb_build_object(
    'multiDatePricingMode', COALESCE(e.multi_date_pricing_mode, 'per_day'),
    'allDaysPass', COALESCE(e.is_multi_date, false) AND NOT COALESCE(e.is_recurring, false)
      AND COALESCE(e.multi_date_pricing_mode, 'per_day') = 'all_days'
  ) ELSE '{}'::jsonb END INTO v_result
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  JOIN public.ticket_types tt ON tt.id = v_link.ticket_type_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.id = v_link.event_id;
  RETURN COALESCE(v_result, jsonb_build_object('state', 'not_found'));
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_ticket_link_resolve(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_ticket_link_resolve(text) TO service_role;

-- biz_update_live_rsvp: from 20271128003827_issue_3827_going_box_privacy_extra_guests.sql
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
  v_date_row       uuid;  -- issue #3281
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
    -- issue #3281: the date row keeps its id, so everything that points at
    -- it stays attached, and keeps its status, cancelled_at and
    -- occurrence_key (an edit never un-cancels a date). A row is inserted
    -- only when none exists. Extra legacy rows go, as before.
    SELECT d.id INTO v_date_row FROM public.event_dates d
     WHERE d.event_id = p_event_id
     ORDER BY d.is_master DESC, d.start_at, d.id LIMIT 1;
    IF v_date_row IS NULL THEN
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);
    ELSE
      DELETE FROM public.event_dates WHERE event_id = p_event_id AND id <> v_date_row;
      UPDATE public.event_dates
         SET start_at = v_new_start, end_at = v_new_end, timezone = v_timezone, is_master = true
       WHERE id = v_date_row
         AND (start_at, end_at, timezone, is_master)
             IS DISTINCT FROM (v_new_start, v_new_end, v_timezone, true);
    END IF;
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
GRANT EXECUTE ON FUNCTION public.biz_update_live_rsvp(uuid,jsonb,text) TO authenticated;

COMMIT;
