-- Issue #4571 (Work pipeline redesign), wave W4: demo bookings and the Demo
-- booked stage rule.
--   1. The host stage meeting is shown as "Demo booked (Google Meet)". The id
--      stays meeting, so the connector, the sweep and history keep working.
--   2. crm_record_demos links one book_call_leads booking to one host card
--      (primary key on booking_id: one booking, one card). book_call_lead_triage
--      holds the bookings a person said are not a host. Both: RLS on, no
--      policies, no client privilege.
--   3. crm_records.schedule_token: a private token per card for the card's own
--      scheduler link (usemingla.com/schedule?for=<token>). It is not the
--      record id, so a link cannot be guessed from other ids. Only the card's
--      read in Admin (crm_record_get) carries it; lists and the connector never.
--   4. Grandfathering: hosts at meeting, onboarded or live when this runs are
--      stamped demo_rule_exempt_at and keep their stage; they can move within
--      that band. Leaving the band (below meeting, or lost) clears the stamp,
--      so coming back needs a demo. One audit row records how many.
--   5. The rule, in the database, for every writer: the BEFORE INSERT OR
--      UPDATE OF stage trigger crm_4571_demo_stage_guard refuses a host at
--      meeting, onboarded or live without a linked booked (or moved) demo,
--      unless the card was exempt and already in the band. A move to lost or
--      below the band is never refused, and neither is a move down inside the
--      band (the card was already past the gate). crm_demo_stage_allowed is the
--      same test for callers that skip instead of raising: the #4452 form
--      automation (forms_move_stage) and the brand link (crm_apply_brand_link,
--      crm_reconcile_live) now skip a move the rule refuses and say so.
--   6. Linking: crm_demo_link_from_token (service role only, called by
--      growth-tools-book right after the booking is written) links a booking
--      made from the card's link. crm_demo_suggestions ranks candidates: the
--      viewer's own outbound phone call from 2 hours before to 15 minutes after
--      the booking was made, then email, then phone, then venue name. It never
--      returns an email or a phone number. crm_demo_link, crm_demo_create_record,
--      crm_demo_not_a_host and crm_demo_unlink are a person's decisions.
--      crm_demo_inbox (Needs linking, Demo booked without a linked demo, Demos
--      cancelled) and crm_demo_inbox_count (the Hosts banner) read the same rule
--      (crm_demo_needs_linking) as the Calendar's needs_linking flag. Reading
--      and deciding both need the Hosts and Creators area (crm_ctx); deciding
--      needs a person, never an agent.
--   7. Reads: crm_record_json gains next_demo and demo_gate on hosts;
--      crm_record_get gains demos and schedule_token; admin_calendar_calls
--      gains record and needs_linking; the connector's get_record gains demos.
--   8. Reschedules keep the link: it is keyed on book_call_leads.id, which the
--      calendar sync updates in place. A cancelled demo leaves the card where
--      it is (no automatic stage write) and lists it under Demos cancelled.
--
-- INVARIANT crm-demo-before-demo-booked: gate crm_4571_demo_stage_guard; test
-- supabase/migrations/__tests__/issue_4571_w4_demo_stage_rule.implementor.pg17.test.sql
-- INVARIANT crm-booking-one-card: gate crm_record_demos_pkey; same test
-- INVARIANT crm-demo-exempt-clears-on-leaving: gate crm_4571_demo_stage_guard; same test
--
-- Static SQL only. Every replaced body is copied from its latest definition
-- (named beside it) and each edit is marked "#4571 W4".
--
-- ROLLBACK (no down file): drop the trigger crm_4571_demo_stage_guard first
-- (that unlocks stages), then the functions added here and the tables
-- crm_record_demos and book_call_lead_triage. schedule_token and
-- demo_rule_exempt_at can stay (inert). Restore crm_pipeline_def from
-- 20270831003802; forms_move_stage from 20280712024452; crm_apply_brand_link
-- from 20270820003802; crm_reconcile_live from 20270823003802;
-- crm_record_json, crm_record_get and team_agent_call from 20281126034571;
-- admin_calendar_calls from 20280520004339. Revert growth-tools-book and the
-- mingla-marketing schedule page together.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Tables and columns.
-- ---------------------------------------------------------------------------
CREATE TABLE public.crm_record_demos (
  booking_id  uuid PRIMARY KEY REFERENCES public.book_call_leads(id) ON DELETE CASCADE,
  record_id   uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  link_source text NOT NULL,
  linked_by   text,
  linked_via  text,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_record_demos_link_source_check
    CHECK (link_source IN ('card_link', 'confirmed_suggestion', 'picked', 'created_from_booking')),
  -- A person links every way but the card's own link, which the booking itself carries.
  CONSTRAINT crm_record_demos_linked_by_check
    CHECK ((link_source = 'card_link') = (linked_by IS NULL)),
  CONSTRAINT crm_record_demos_linked_via_check CHECK (linked_via IS NULL OR linked_via ~ '^[a-z0-9_-]{1,40}$')
);
CREATE INDEX crm_record_demos_by_record ON public.crm_record_demos (record_id);
ALTER TABLE public.crm_record_demos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_record_demos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.crm_record_demos TO service_role;
COMMENT ON TABLE public.crm_record_demos IS
  'Issue #4571 W4. One book_call_leads booking linked to one host card (INVARIANT crm-booking-one-card: the primary key). Written only by the crm_demo_* functions. RLS on, no policies.';

CREATE TABLE public.book_call_lead_triage (
  booking_id uuid PRIMARY KEY REFERENCES public.book_call_leads(id) ON DELETE CASCADE,
  outcome    text NOT NULL CHECK (outcome = 'not_a_host'),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.book_call_lead_triage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.book_call_lead_triage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.book_call_lead_triage TO service_role;
COMMENT ON TABLE public.book_call_lead_triage IS
  'Issue #4571 W4. A booking a person said is not a host (Needs linking: Not a host). RLS on, no policies.';

ALTER TABLE public.crm_records
  ADD COLUMN schedule_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN demo_rule_exempt_at timestamptz;
ALTER TABLE public.crm_records
  ADD CONSTRAINT crm_records_schedule_token_key UNIQUE (schedule_token);
COMMENT ON COLUMN public.crm_records.schedule_token IS
  'Issue #4571 W4. The card''s private scheduler token (usemingla.com/schedule?for=<token>). A booking made with it links itself (crm_demo_link_from_token). Hosts only in use. Never in lists or the connector.';
COMMENT ON COLUMN public.crm_records.demo_rule_exempt_at IS
  'Issue #4571 W4. Set once by the W4 migration on hosts already at meeting, onboarded or live; cleared when the card leaves that band. While set, the card moves inside the band without a linked demo.';

-- ---------------------------------------------------------------------------
-- 2. Grandfathering, before the rule exists. One audit row with the count.
-- ---------------------------------------------------------------------------
DO $grand$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.crm_records
     SET demo_rule_exempt_at = now()
   WHERE pipeline = 'hosts' AND deleted_at IS NULL AND stage IN ('meeting', 'onboarded', 'live');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.crm_audit('system', 'crm.demo_rule_grandfathered', 'crm_pipeline', 'hosts',
    jsonb_build_object('issue', '#4571', 'exempt', v_n));
  RAISE NOTICE '#4571 W4: % hosts at Demo booked or later are grandfathered', v_n;
END
$grand$;

-- ---------------------------------------------------------------------------
-- 3. The rule.
-- ---------------------------------------------------------------------------
-- A linked demo that is still on: booked, or moved in Google Calendar.
CREATE FUNCTION public.crm_record_has_demo(p_record_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.crm_record_demos d
                   JOIN public.book_call_leads k ON k.id = d.booking_id
                  WHERE d.record_id = p_record_id AND k.status IN ('booked', 'moved'))
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_has_demo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_has_demo(uuid) TO service_role;

-- #4571 W4 gate for INVARIANT crm-demo-before-demo-booked: the ONE test, read
-- by the trigger and by crm_demo_stage_allowed. Removing it lets Replied move
-- to meeting and fails issue_4571_w4_demo_stage_rule.implementor.pg17.test.sql.
CREATE FUNCTION public.crm_4571_demo_move_ok(
  p_record_id uuid, p_pipeline text, p_from text, p_to text, p_exempt_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_pipeline IS DISTINCT FROM 'hosts' THEN true
    WHEN p_to IS NULL OR p_to NOT IN ('meeting', 'onboarded', 'live') THEN true
    WHEN p_from IS NOT DISTINCT FROM p_to THEN true
    -- Grandfathered and still in the band.
    WHEN p_exempt_at IS NOT NULL AND p_from IN ('meeting', 'onboarded', 'live') THEN true
    WHEN public.crm_record_has_demo(p_record_id) THEN true
    -- Down inside the band (Live back to Onboarded): the card was already past the gate.
    WHEN p_from IN ('meeting', 'onboarded', 'live')
         AND (public.crm_stage_def('hosts', p_to)->>'pos')::integer < (public.crm_stage_def('hosts', p_from)->>'pos')::integer THEN true
    ELSE false
  END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_demo_move_ok(uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_demo_move_ok(uuid, text, text, text, timestamptz) TO service_role;

-- The same test for a caller that must skip, not raise.
CREATE FUNCTION public.crm_demo_stage_allowed(p_record_id uuid, p_to text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE((SELECT public.crm_4571_demo_move_ok(c.id, c.pipeline, c.stage, p_to, c.demo_rule_exempt_at)
                     FROM public.crm_records c WHERE c.id = p_record_id), true)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_stage_allowed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_stage_allowed(uuid, text) TO service_role;

-- #4571 W4 gate for INVARIANTS crm-demo-before-demo-booked and
-- crm-demo-exempt-clears-on-leaving. Every writer of crm_records.stage passes
-- here: crm_record_move_stage, crm_record_undo_stage_move, the connector's
-- move_stage, the #4452 form automation, the brand link and any direct write.
CREATE FUNCTION public.crm_4571_demo_stage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.pipeline IS DISTINCT FROM 'hosts' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Only this migration grandfathers; a new card never starts exempt.
    NEW.demo_rule_exempt_at := NULL;
    IF NEW.stage IN ('meeting', 'onboarded', 'live') THEN
      RAISE EXCEPTION 'demo_required: Demo booked needs a Google Meet booked through the scheduler and linked to this card. Send the card''s scheduler link, or link the booking on Needs linking.'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;
  -- Leaving the band clears the exemption: coming back needs a demo.
  IF NEW.stage NOT IN ('meeting', 'onboarded', 'live') THEN
    NEW.demo_rule_exempt_at := NULL;
    RETURN NEW;
  END IF;
  IF NOT public.crm_4571_demo_move_ok(OLD.id, OLD.pipeline, OLD.stage, NEW.stage, OLD.demo_rule_exempt_at) THEN
    RAISE EXCEPTION 'demo_required: Demo booked needs a Google Meet booked through the scheduler and linked to this card. Send the card''s scheduler link, or link the booking on Needs linking.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_demo_stage_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_demo_stage_guard() TO service_role;
CREATE TRIGGER crm_4571_demo_stage_guard
  BEFORE INSERT OR UPDATE OF stage ON public.crm_records
  FOR EACH ROW EXECUTE FUNCTION public.crm_4571_demo_stage_guard();

-- ---------------------------------------------------------------------------
-- 4. Callers that skip a move the rule refuses, and the stage label.
-- ---------------------------------------------------------------------------
-- From 20270831003802_issue_3802_wave4_agent_write_setup.sql:622. #4571 W4: meeting is "Demo booked (Google Meet)".
CREATE OR REPLACE FUNCTION public.crm_pipeline_def(p_pipeline text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_pipeline
    WHEN 'hosts' THEN $j${
      "id": "hosts", "label": "Hosts", "singular": "host",
      "stages": [
        {"id": "prospect",  "label": "Prospect",  "hint": "Not contacted yet"},
        {"id": "contacted", "label": "Contacted", "hint": "First message sent"},
        {"id": "replied",   "label": "Replied",   "hint": "They answered"},
        {"id": "meeting",   "label": "Demo booked (Google Meet)", "hint": "A Google Meet booked through the scheduler is linked"},
        {"id": "onboarded", "label": "Onboarded", "hint": "Has a Mingla account"},
        {"id": "live",      "label": "Live",      "hint": "Has a public listing", "auto": true},
        {"id": "lost",      "label": "Lost",      "hint": "Not now, with a reason", "terminal": true}
      ],
      "icps": [
        {"id": "restaurant_bar",  "label": "Restaurant or bar"},
        {"id": "venue_gallery",   "label": "Venue or gallery"},
        {"id": "event_organizer", "label": "Event organizer"},
        {"id": "community_host",  "label": "Community host"},
        {"id": "trip_stay_host",  "label": "Trip or stay host"},
        {"id": "experience_host", "label": "Experience host"},
        {"id": "partner_org",     "label": "Partner org"}
      ],
      "reached_stages": ["onboarded", "live"]
    }$j$::jsonb
    WHEN 'creators' THEN $j${
      "id": "creators", "label": "Creators", "singular": "creator",
      "stages": [
        {"id": "identified",  "label": "Identified",  "hint": "Not contacted yet"},
        {"id": "contacted",   "label": "Contacted",   "hint": "First message sent"},
        {"id": "replied",     "label": "Replied",     "hint": "They answered"},
        {"id": "negotiating", "label": "Negotiating", "hint": "Talking terms"},
        {"id": "booked",      "label": "Booked",      "hint": "Agreement signed"},
        {"id": "posted",      "label": "Posted",      "hint": "First post is up"},
        {"id": "passed",      "label": "Passed",      "hint": "Not now, with a reason", "terminal": true}
      ],
      "icps": [
        {"id": "ambassador",  "label": "Ambassador"},
        {"id": "ugc_one_off", "label": "UGC one-off"}
      ],
      "reached_stages": ["booked", "posted"]
    }$j$::jsonb
    ELSE NULL
  END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_pipeline_def(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_def(text) TO service_role;

-- From 20280712024452_issue_4452_automations.sql:459. #4571 W4: skips a move the demo rule refuses.
CREATE OR REPLACE FUNCTION public.forms_move_stage(p_record uuid, p_stage text, p_via text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_rec public.crm_records;
  v_to  jsonb;
  v_act uuid;
BEGIN
  SELECT * INTO v_rec FROM public.crm_records WHERE id = p_record AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_rec.stage = p_stage THEN RETURN; END IF;
  -- #4571 W4: Demo booked and later need a linked booked demo. A move the rule
  -- refuses is skipped (never forced) and the skip is audited.
  IF NOT public.crm_demo_stage_allowed(p_record, p_stage) THEN
    PERFORM public.crm_audit('forms@usemingla.com', 'crm.stage_move_skipped', 'crm_record', p_record::text,
      jsonb_build_object('via', left(p_via, 40), 'from', v_rec.stage, 'to', p_stage, 'reason', 'demo_required'));
    RETURN;
  END IF;
  -- The same guards crm_record_move_stage applies; a move it would refuse is skipped, never forced.
  v_to := public.crm_stage_def(v_rec.pipeline, p_stage);
  IF v_to IS NULL OR COALESCE((v_to->>'auto')::boolean, false) OR COALESCE((v_to->>'terminal')::boolean, false)
     OR v_rec.stage = 'live' THEN
    RETURN;
  END IF;
  IF v_rec.pipeline = 'creators'
     AND (v_to->>'pos')::integer >= (public.crm_stage_def('creators', 'booked')->>'pos')::integer
     AND v_rec.agreement IS DISTINCT FROM 'signed' THEN
    RETURN;
  END IF;
  UPDATE public.crm_records SET stage = p_stage, stage_reason = NULL, updated_by = 'forms@usemingla.com', updated_at = now()
   WHERE id = p_record;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, from_stage, to_stage, body, occurred_at, created_at)
  VALUES (p_record, 'stage_move', 'forms@usemingla.com', left(p_via, 40), v_rec.stage, p_stage, NULL, now(), now())
  RETURNING id INTO v_act;
  PERFORM public.crm_audit('forms@usemingla.com', 'crm.stage_move', 'crm_record', p_record::text,
    jsonb_build_object('via', left(p_via, 40), 'activity_id', v_act,
                       'before', jsonb_build_object('stage', v_rec.stage), 'after', jsonb_build_object('stage', p_stage)));
END;
$fn$;

-- From 20270820003802_issue_3802_wave1_crm_pipelines.sql:1048. #4571 W4: no automatic Onboarded without a linked demo.
CREATE OR REPLACE FUNCTION public.crm_apply_brand_link(p_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  r       public.crm_records;
  v_moved text;
  v_brand text;
  v_now   timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO r FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR r.pipeline <> 'hosts' THEN
    RETURN NULL;
  END IF;
  SELECT b.name INTO v_brand FROM public.brands b WHERE b.id = r.brand_id;

  IF r.stage = 'live' AND NOT public.crm_brand_is_live(r.brand_id) THEN
    UPDATE public.crm_records SET stage = 'onboarded', updated_at = v_now WHERE id = r.id;
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
    VALUES (r.id, 'stage_move', NULL, 'system',
            CASE WHEN r.brand_id IS NULL
                 THEN 'Brand link removed. Stage moved back to Onboarded.'
                 ELSE 'Linked to ' || COALESCE(v_brand, 'a Mingla brand') || ', which has no public listing yet. Stage moved back to Onboarded.'
            END,
            'live', 'onboarded', v_now, v_now);
    RETURN 'onboarded';
  END IF;

  IF r.brand_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF (public.crm_stage_def('hosts', r.stage)->>'pos')::integer
       < (public.crm_stage_def('hosts', 'onboarded')->>'pos')::integer
     AND NOT public.crm_demo_stage_allowed(r.id, 'onboarded') THEN
    -- #4571 W4: the brand stays linked; the stage waits for a linked booked demo.
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
    VALUES (r.id, 'note', NULL, 'system',
            'Linked to ' || COALESCE(v_brand, 'a Mingla brand') || '. The stage stays at '
              || COALESCE(public.crm_stage_def('hosts', r.stage)->>'label', r.stage)
              || ' until a demo booked through the scheduler is linked to this card.',
            v_now, v_now);
    RETURN NULL;
  END IF;
  IF (public.crm_stage_def('hosts', r.stage)->>'pos')::integer
       < (public.crm_stage_def('hosts', 'onboarded')->>'pos')::integer THEN
    UPDATE public.crm_records SET stage = 'onboarded', updated_at = v_now WHERE id = r.id;
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
    VALUES (r.id, 'stage_move', NULL, 'system',
            'Linked to ' || COALESCE(v_brand, 'a Mingla brand') || '. Stage moved to Onboarded.',
            r.stage, 'onboarded', v_now, v_now);
    v_moved := 'onboarded';
  END IF;
  IF public.crm_reconcile_live(p_id) > 0 THEN
    v_moved := 'live';
  END IF;
  RETURN v_moved;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_apply_brand_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_brand_link(uuid) TO service_role;

-- From 20270823003802_issue_3802_wave1_homes_targets_beta.sql:579. #4571 W4: never promotes a host the demo rule refuses.
CREATE OR REPLACE FUNCTION public.crm_reconcile_live(p_record_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c            record;
  r            public.crm_records;
  v_n          integer := 0;
  v_failed     integer := 0;
  v_failed_ids uuid[] := ARRAY[]::uuid[];
  v_fp         text;
  v_now        timestamptz;
  v_act        uuid;
BEGIN
  FOR c IN
    SELECT x.id, x.brand_id
    FROM public.crm_records x
    WHERE x.pipeline = 'hosts'
      AND x.deleted_at IS NULL
      AND x.brand_id IS NOT NULL
      AND x.stage NOT IN ('live', 'lost')
      AND public.crm_demo_stage_allowed(x.id, 'live')  -- #4571 W4
      AND (p_record_id IS NULL OR x.id = p_record_id)
    ORDER BY x.id
  LOOP
    BEGIN
      IF public.crm_brand_is_live(c.brand_id) THEN
        -- Lock the one host, then look again: it may have moved, been
        -- unlinked or been deleted since the list above was read.
        SELECT * INTO r FROM public.crm_records k WHERE k.id = c.id FOR UPDATE;
        IF FOUND AND r.deleted_at IS NULL AND r.stage NOT IN ('live', 'lost')
           AND public.crm_demo_stage_allowed(r.id, 'live')  -- #4571 W4
           AND public.crm_brand_is_live(r.brand_id) THEN
          v_now := clock_timestamp();
          UPDATE public.crm_records
             SET stage = 'live', went_live_at = COALESCE(went_live_at, v_now),
                 updated_by = 'system', updated_at = v_now
           WHERE id = r.id;
          INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
          VALUES (r.id, 'stage_move', NULL, 'system',
                  'First listing went live. Stage moved to Live automatically.', r.stage, 'live', v_now, v_now)
          RETURNING id INTO v_act;
          PERFORM public.crm_audit('system', 'crm.stage_auto_live', 'crm_record', r.id::text,
            jsonb_build_object('from', r.stage, 'to', 'live', 'brand_id', r.brand_id, 'activity_id', v_act));
          v_n := v_n + 1;
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      -- Everything this host's block did is undone; the others are untouched.
      v_failed := v_failed + 1;
      v_failed_ids := v_failed_ids || c.id;
      RAISE WARNING 'crm_reconcile_live: host % was skipped and will be tried again on the next run (% %)',
        c.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  IF v_failed > 0 THEN
    v_fp := md5(array_to_string(ARRAY(SELECT f.id FROM unnest(v_failed_ids) AS f(id) ORDER BY 1), ','));
    IF p_record_id IS NOT NULL THEN
      PERFORM public.crm_audit('system', 'crm.reconcile_failed', 'crm_pipeline', 'hosts',
        jsonb_build_object('failed', v_failed, 'promoted', v_n, 'scope', 'record', 'fingerprint', v_fp));
    ELSIF NOT EXISTS (
            SELECT 1 FROM public.admin_audit_log l
             WHERE l.action = 'crm.reconcile_failed'
               AND l.metadata->>'scope' = 'scheduled'
               AND l.metadata->>'fingerprint' = v_fp
               AND l.created_at > clock_timestamp() - interval '24 hours') THEN
      PERFORM public.crm_audit('system', 'crm.reconcile_failed', 'crm_pipeline', 'hosts',
        jsonb_build_object('failed', v_failed, 'promoted', v_n, 'scope', 'scheduled', 'fingerprint', v_fp));
    END IF;
  END IF;

  IF p_record_id IS NULL THEN
    DELETE FROM public.crm_request_keys k WHERE k.created_at < clock_timestamp() - interval '30 days';
  END IF;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_reconcile_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reconcile_live(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 5. What a card and the Calendar show about demos.
-- ---------------------------------------------------------------------------
-- A card's linked demos, newest call first. Never an email or a phone number.
CREATE FUNCTION public.crm_record_demos_json(p_record_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'booking_id', k.id, 'call_at', k.call_at, 'original_call_at', k.original_call_at,
           'status', k.status, 'link_source', d.link_source, 'linked_at', d.linked_at,
           'linked_by_name', CASE WHEN d.linked_by IS NULL THEN NULL ELSE public.ops_name(d.linked_by) END,
           'meet_url', k.meet_url)
         ORDER BY k.call_at DESC, k.id), '[]'::jsonb)
  FROM public.crm_record_demos d
  JOIN public.book_call_leads k ON k.id = d.booking_id
  WHERE d.record_id = p_record_id
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_demos_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_demos_json(uuid) TO service_role;

-- Whether Demo booked is locked for this host, and why, in the words the card shows.
CREATE FUNCTION public.crm_demo_gate(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'locked', r.stage NOT IN ('meeting', 'onboarded', 'live') AND NOT h.has_demo,
    'reason', CASE WHEN r.stage NOT IN ('meeting', 'onboarded', 'live') AND NOT h.has_demo
                   THEN 'Demo booked means a Google Meet booked through the scheduler and linked here. Send the scheduler link, or link a demo they already booked.' END,
    'exempt', r.demo_rule_exempt_at IS NOT NULL,
    -- A card past the gate with no demo on: grandfathered, or its demo was cancelled.
    'needs_linking', r.stage IN ('meeting', 'onboarded', 'live') AND NOT h.has_demo,
    'demo_cancelled', NOT h.has_demo AND EXISTS (
        SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
         WHERE d.record_id = r.id AND k.status IN ('cancelled', 'declined')))
  FROM (SELECT public.crm_record_has_demo(r.id) AS has_demo) h
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_gate(public.crm_records) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_gate(public.crm_records) TO service_role;

-- The ONE rule for "this booking needs linking": a host booking that is on
-- (booked or moved), not a staff or test booking, not linked and not marked
-- Not a host. The inbox, its count (the Hosts banner) and the Calendar flag all
-- read it, so they always agree.
CREATE FUNCTION public.crm_demo_needs_linking(p_booking_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT k.audience = 'host' AND k.status IN ('booked', 'moved')
           AND NOT public.inbound_lead_is_test(k.email, COALESCE(NULLIF(btrim(k.venue), ''), k.name))
           AND NOT EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.booking_id = k.id)
           AND NOT EXISTS (SELECT 1 FROM public.book_call_lead_triage t WHERE t.booking_id = k.id)
      FROM public.book_call_leads k WHERE k.id = p_booking_id), false)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_needs_linking(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_needs_linking(uuid) TO service_role;

-- The Calendar's two fields for one booking.
CREATE FUNCTION public.crm_demo_calendar_bits(p_booking_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'record', (SELECT jsonb_build_object('id', c.id, 'name', c.name)
                 FROM public.crm_record_demos d JOIN public.crm_records c ON c.id = d.record_id
                WHERE d.booking_id = p_booking_id AND c.deleted_at IS NULL),
    'needs_linking', public.crm_demo_needs_linking(p_booking_id))
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_calendar_bits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_calendar_bits(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Linking a booking to a card.
-- ---------------------------------------------------------------------------
-- Ranked host cards for one booking, for one viewer. Each candidate carries
-- record_id, name, stage and reason (your_call, email, phone or venue_name),
-- and for your_call how many minutes before the booking the call was logged
-- (negative: after). Never the email or the phone number that matched.
CREATE FUNCTION public.crm_4571_demo_candidates(p_booking_id uuid, p_viewer text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH k AS (
    SELECT b.* FROM public.book_call_leads b WHERE b.id = p_booking_id AND b.audience = 'host'
  ),
  live AS (
    SELECT c.* FROM public.crm_records c WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL
  ),
  hits AS (
    -- 1. The viewer's own outbound call, 2 hours before to 15 minutes after the booking was made.
    SELECT l.id AS record_id, 1 AS rank, 'your_call'::text AS reason,
           max(a.occurred_at) AS at,
           round(extract(epoch FROM (k.created_at - max(a.occurred_at))) / 60)::integer AS minutes_before
      FROM k
      JOIN public.crm_activity a ON a.kind = 'touch' AND a.channel = 'phone' AND a.direction = 'outbound'
                                AND a.actor_email = p_viewer
                                AND a.occurred_at BETWEEN k.created_at - interval '2 hours' AND k.created_at + interval '15 minutes'
      JOIN live l ON l.id = a.record_id
     WHERE p_viewer IS NOT NULL
     GROUP BY l.id, k.created_at
    UNION ALL
    -- 2. The booking's email is a working email on the card.
    SELECT l.id, 2, 'email', NULL, NULL
      FROM k
      JOIN public.crm_record_identifiers i ON i.kind = 'email' AND i.status = 'ok'
                                          AND i.value_key = public.crm_ident_key('email', btrim(k.email))
      JOIN live l ON l.id = i.record_id
    UNION ALL
    -- 3. The booking's phone is a working phone on the card (the duplicate check's number rule).
    SELECT l.id, 3, 'phone', NULL, NULL
      FROM k
      CROSS JOIN LATERAL public.crm_identifier_hits('hosts',
        jsonb_build_array(jsonb_build_object('kind', 'phone', 'value_key', public.crm_ident_key('phone', k.phone_e164))), NULL) h
      JOIN public.crm_record_identifiers i ON i.record_id = h.record_id AND i.kind = 'phone'
                                          AND i.value_key = h.value_key AND i.status = 'ok'
      JOIN live l ON l.id = h.record_id
     WHERE k.phone_e164 IS NOT NULL AND public.crm_ident_key('phone', k.phone_e164) IS NOT NULL
    UNION ALL
    -- 4. The venue's name is the card's name (crm_name_key).
    SELECT l.id, 4, 'venue_name', NULL, NULL
      FROM k
      JOIN live l ON l.name_key = public.crm_name_key(btrim(k.venue))
     WHERE NULLIF(btrim(k.venue), '') IS NOT NULL AND public.crm_name_key(btrim(k.venue)) <> ''
  ),
  best AS (
    SELECT DISTINCT ON (h.record_id) h.record_id, h.rank, h.reason, h.at, h.minutes_before
      FROM hits h
     ORDER BY h.record_id, h.rank, h.at DESC NULLS LAST
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'record_id', c.id, 'name', c.name, 'stage', c.stage, 'reason', b.reason,
           'minutes_before', b.minutes_before)
         ORDER BY b.rank, b.at DESC NULLS LAST, lower(c.name), c.id), '[]'::jsonb)
  FROM (SELECT * FROM best ORDER BY rank, at DESC NULLS LAST LIMIT 8) b
  JOIN public.crm_records c ON c.id = b.record_id
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_demo_candidates(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_demo_candidates(uuid, text) TO service_role;

CREATE FUNCTION public.crm_demo_suggestions(p_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v    record;
BEGIN
  -- Whoever has the Hosts and Creators area (the people who link demos).
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT EXISTS (SELECT 1 FROM public.book_call_leads k WHERE k.id = p_booking_id) THEN
    RAISE EXCEPTION 'not_found: That booking is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.crm_4571_demo_candidates(p_booking_id, v.actor_email);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_suggestions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_suggestions(uuid) TO authenticated, service_role;

-- The one write of a link, after the caller has checked who may make it.
CREATE FUNCTION public.crm_4571_demo_link_core(
  p_booking public.book_call_leads, p_record public.crm_records, p_source text, p_actor text, p_via text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  v_have uuid;
  v_now  timestamptz := clock_timestamp();
BEGIN
  SELECT d.record_id INTO v_have FROM public.crm_record_demos d WHERE d.booking_id = p_booking.id FOR UPDATE;
  IF FOUND THEN
    IF v_have = p_record.id THEN
      RETURN false;
    END IF;
    RAISE EXCEPTION '%', format('booking_linked: This demo is already linked to %s. Unlink it there first.',
      COALESCE((SELECT c.name FROM public.crm_records c WHERE c.id = v_have), 'another card'))
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.crm_record_demos (booking_id, record_id, link_source, linked_by, linked_via, linked_at)
  VALUES (p_booking.id, p_record.id, p_source, CASE WHEN p_source = 'card_link' THEN NULL ELSE p_actor END, p_via, v_now);
  DELETE FROM public.book_call_lead_triage t WHERE t.booking_id = p_booking.id;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
  VALUES (p_record.id, 'note', CASE WHEN p_source = 'card_link' THEN NULL ELSE p_actor END,
          CASE WHEN p_source = 'card_link' THEN 'system' ELSE p_via END,
          CASE p_source
            WHEN 'card_link' THEN 'A demo was booked through this card''s scheduler link and linked here.'
            WHEN 'created_from_booking' THEN 'Card made from a booked demo, and the demo linked here.'
            ELSE 'A booked demo was linked to this card.' END,
          v_now, v_now);
  PERFORM public.crm_audit(COALESCE(CASE WHEN p_source = 'card_link' THEN NULL ELSE p_actor END, 'system'),
    'crm.demo_link', 'crm_record', p_record.id::text,
    jsonb_strip_nulls(jsonb_build_object('via', p_via))
      || jsonb_build_object('booking_id', p_booking.id, 'link_source', p_source));
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_demo_link_core(public.book_call_leads, public.crm_records, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_demo_link_core(public.book_call_leads, public.crm_records, text, text, text) TO service_role;

-- Service role only: growth-tools-book calls it right after it writes the
-- booking. A token that matches a live host card links the booking; anything
-- else answers false and the booking waits on Needs linking. The booker is
-- never told either way.
CREATE FUNCTION public.crm_demo_link_from_token(p_booking_key text, p_token uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_k public.book_call_leads;
  v_r public.crm_records;
BEGIN
  IF p_booking_key IS NULL OR p_token IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_k FROM public.book_call_leads k WHERE k.booking_key = p_booking_key AND k.audience = 'host';
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT * INTO v_r FROM public.crm_records c
   WHERE c.schedule_token = p_token AND c.pipeline = 'hosts' AND c.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.booking_id = v_k.id) THEN
    -- A retried booking write: linked already (to this card, or by a person to another).
    RETURN EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.booking_id = v_k.id AND d.record_id = v_r.id);
  END IF;
  PERFORM public.crm_4571_demo_link_core(v_k, v_r, 'card_link', NULL, NULL);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_link_from_token(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_link_from_token(text, uuid) TO service_role;

CREATE FUNCTION public.crm_4571_demo_booking(p_booking_id uuid) RETURNS public.book_call_leads
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  v_k public.book_call_leads;
BEGIN
  SELECT * INTO v_k FROM public.book_call_leads k WHERE k.id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That booking is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  IF v_k.audience <> 'host' THEN
    RAISE EXCEPTION 'not_a_host_call: Only a Host call can be linked to a host card.' USING ERRCODE = '22023';
  END IF;
  -- One decision per booking at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_demo:' || p_booking_id::text, 0));
  RETURN v_k;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_demo_booking(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_demo_booking(uuid) TO service_role;

CREATE FUNCTION public.crm_demo_link(p_booking_id uuid, p_record_id uuid, p_source text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v    record;
  v_me text;
  v_k  public.book_call_leads;
  v_r  public.crm_records;
  v_ch boolean;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'needs_a_person: A person links booked demos to cards, in Admin.' USING ERRCODE = '42501';
  END IF;
  v_me := v.actor_email;
  IF p_source IS NULL OR p_source NOT IN ('confirmed_suggestion', 'picked') THEN
    RAISE EXCEPTION 'invalid_arguments: Send confirmed_suggestion or picked.' USING ERRCODE = '22023';
  END IF;
  v_k := public.crm_4571_demo_booking(p_booking_id);
  SELECT * INTO v_r FROM public.crm_records c WHERE c.id = p_record_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.pipeline <> 'hosts' THEN
    RAISE EXCEPTION 'not_a_host: A booked demo links to a host card, not a creator.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ops_claim_assert('crm_record', v_r.id, v_me, NULL);
  v_ch := public.crm_4571_demo_link_core(v_k, v_r, p_source, v_me, NULL);
  SELECT * INTO v_r FROM public.crm_records c WHERE c.id = p_record_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_r), 'booking_id', v_k.id, 'changed', v_ch);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_link(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_link(uuid, uuid, text) TO authenticated, service_role;

-- The booking's ICP as a host ICP; NULL when it does not say.
CREATE FUNCTION public.crm_4571_booking_icp(p_icp text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_icp
    WHEN 'restaurants' THEN 'restaurant_bar'
    WHEN 'events'      THEN 'event_organizer'
    WHEN 'trips'       THEN 'trip_stay_host'
    WHEN 'hotels'      THEN 'trip_stay_host'
    WHEN 'experiences' THEN 'experience_host'
    WHEN 'art'         THEN 'venue_gallery'
    WHEN 'play'        THEN 'venue_gallery'
    ELSE NULL END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_booking_icp(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_booking_icp(text) TO service_role;

-- Create host card: the same path as Add to Hosts (crm_record_create_core),
-- with the caller as owner and the booking's email and phone as contact
-- details. A card with that name or contact already there is linked instead.
CREATE FUNCTION public.crm_demo_create_record(p_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v    record;
  v_me     text;
  v_k      public.book_call_leads;
  v_r      public.crm_records;
  v_ids    jsonb := '[]'::jsonb;
  v_fields jsonb;
  v_res    jsonb;
  v_status text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'needs_a_person: A person links booked demos to cards, in Admin.' USING ERRCODE = '42501';
  END IF;
  v_me := v.actor_email;
  v_k := public.crm_4571_demo_booking(p_booking_id);
  IF EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.booking_id = v_k.id) THEN
    RAISE EXCEPTION 'booking_linked: This demo is already linked to a card.' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(v_k.email)) <= 200 AND public.crm_ident_key('email', btrim(v_k.email)) IS NOT NULL THEN
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('kind', 'email', 'value', btrim(v_k.email)));
  END IF;
  IF v_k.phone_e164 IS NOT NULL AND public.crm_ident_key('phone', v_k.phone_e164) IS NOT NULL THEN
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('kind', 'phone', 'value', v_k.phone_e164));
  END IF;
  v_fields := jsonb_strip_nulls(jsonb_build_object(
      'name', left(COALESCE(NULLIF(btrim(v_k.venue), ''), btrim(v_k.name)), 160),
      'icp', public.crm_4571_booking_icp(v_k.icp),
      'contact', left(btrim(v_k.name), 300),
      'channel', 'email',
      'source', 'inbound'))
    || jsonb_build_object('owners', jsonb_build_array(v_me))
    || CASE WHEN jsonb_array_length(v_ids) > 0 THEN jsonb_build_object('identifiers', v_ids) ELSE '{}'::jsonb END;
  BEGIN
    v_res := public.crm_record_create_core('hosts', v_fields, v_me, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM LIKE 'invalid_name:%' THEN
      RAISE EXCEPTION 'lead_name_unusable: This booking''s name cannot be used as a host name. Add the host by hand from Hosts, then Pick another host.'
        USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;
  IF v_res->>'status' = 'duplicate' THEN
    v_status := 'linked_existing';
    SELECT * INTO v_r FROM public.crm_records c WHERE c.id = (v_res->'existing'->>'id')::uuid AND c.deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = 'PT409';
    END IF;
    IF v_r.pipeline <> 'hosts' THEN
      RAISE EXCEPTION 'not_a_host: A booked demo links to a host card, not a creator.' USING ERRCODE = '22023';
    END IF;
    PERFORM public.crm_4571_demo_link_core(v_k, v_r, 'picked', v_me, NULL);
  ELSE
    v_status := 'created';
    SELECT * INTO v_r FROM public.crm_records c WHERE c.id = (v_res->'record'->>'id')::uuid;
    PERFORM public.crm_4571_demo_link_core(v_k, v_r, 'created_from_booking', v_me, NULL);
  END IF;
  SELECT * INTO v_r FROM public.crm_records c WHERE c.id = v_r.id;
  RETURN jsonb_build_object('status', v_status, 'record', public.crm_record_json(v_r), 'booking_id', v_k.id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_create_record(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_create_record(uuid) TO authenticated, service_role;

CREATE FUNCTION public.crm_demo_not_a_host(p_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v    record;
  v_me text;
  v_k  public.book_call_leads;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'needs_a_person: A person links booked demos to cards, in Admin.' USING ERRCODE = '42501';
  END IF;
  v_me := v.actor_email;
  v_k := public.crm_4571_demo_booking(p_booking_id);
  IF EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.booking_id = v_k.id) THEN
    RAISE EXCEPTION 'booking_linked: This demo is linked to a card. Unlink it there first.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.book_call_lead_triage (booking_id, outcome, decided_by, decided_at)
  VALUES (v_k.id, 'not_a_host', v_me, clock_timestamp())
  ON CONFLICT (booking_id) DO NOTHING;
  PERFORM public.crm_audit(v_me, 'crm.demo_not_a_host', 'book_call_lead', v_k.id::text, '{}'::jsonb);
  RETURN jsonb_build_object('booking_id', v_k.id, 'outcome', 'not_a_host');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_not_a_host(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_not_a_host(uuid) TO authenticated, service_role;

-- Unlink: refused while the card sits at Demo booked or later on this demo
-- alone (not exempt, no other demo on). Move the card back first.
CREATE FUNCTION public.crm_demo_unlink(p_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v    record;
  v_me text;
  v_d  public.crm_record_demos;
  v_r  public.crm_records;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'needs_a_person: A person links booked demos to cards, in Admin.' USING ERRCODE = '42501';
  END IF;
  v_me := v.actor_email;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_demo:' || p_booking_id::text, 0));
  SELECT * INTO v_d FROM public.crm_record_demos d WHERE d.booking_id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That demo is not linked to a card.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_r FROM public.crm_records c WHERE c.id = v_d.record_id FOR UPDATE;
  PERFORM public.ops_claim_assert('crm_record', v_r.id, v_me, NULL);
  IF v_r.deleted_at IS NULL AND v_r.stage IN ('meeting', 'onboarded', 'live') AND v_r.demo_rule_exempt_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                      WHERE d.record_id = v_r.id AND d.booking_id <> p_booking_id AND k.status IN ('booked', 'moved')) THEN
    RAISE EXCEPTION '%', format('demo_in_use: %s is in %s on this demo. Move the card back first, then unlink the demo.',
      v_r.name, public.crm_stage_def('hosts', v_r.stage)->>'label') USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.crm_record_demos d WHERE d.booking_id = p_booking_id;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
  VALUES (v_r.id, 'note', v_me, NULL, 'A booked demo was unlinked from this card.', v_now, v_now);
  PERFORM public.crm_audit(v_me, 'crm.demo_unlink', 'crm_record', v_r.id::text,
    jsonb_build_object('booking_id', p_booking_id, 'link_source', v_d.link_source));
  SELECT * INTO v_r FROM public.crm_records c WHERE c.id = v_r.id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_r), 'booking_id', p_booking_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_unlink(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_unlink(uuid) TO authenticated, service_role;

-- Needs linking (Admin > Leads): bookings to link, newest call first, each
-- with its top suggestion for this viewer; host cards at Demo booked with no
-- linked demo (grandfathered, moved by hand before W4); and cards whose linked
-- demo was cancelled or declined. Never an email or a phone number.
CREATE FUNCTION public.crm_demo_inbox() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v         record;
  v_me      text;
  v_book    jsonb;
  v_without jsonb;
  v_cancel  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_me := v.actor_email;
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.call_at DESC, q.id), '[]'::jsonb) INTO v_book
  FROM (SELECT k.id, k.call_at,
               jsonb_build_object('booking_id', k.id, 'name', k.name, 'venue', k.venue, 'call_at', k.call_at,
                 'created_at', k.created_at, 'status', k.status, 'source', k.source,
                 'suggestions', public.crm_4571_demo_candidates(k.id, v_me)) AS j
          FROM public.book_call_leads k
         WHERE k.audience = 'host' AND public.crm_demo_needs_linking(k.id)
         ORDER BY k.call_at DESC, k.id
         LIMIT 200) q;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('record_id', c.id, 'name', c.name, 'stage', c.stage,
                   'exempt', c.demo_rule_exempt_at IS NOT NULL) ORDER BY lower(c.name), c.id), '[]'::jsonb) INTO v_without
  FROM public.crm_records c
  WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.stage = 'meeting'
    AND NOT public.crm_record_has_demo(c.id)
    AND NOT EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.record_id = c.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('booking_id', k.id, 'record_id', c.id, 'record_name', c.name,
                   'stage', c.stage, 'call_at', k.call_at, 'status', k.status, 'status_changed_at', k.status_changed_at)
                   ORDER BY k.status_changed_at DESC NULLS LAST, k.call_at DESC), '[]'::jsonb) INTO v_cancel
  FROM public.crm_record_demos d
  JOIN public.book_call_leads k ON k.id = d.booking_id
  JOIN public.crm_records c ON c.id = d.record_id
  WHERE c.deleted_at IS NULL AND k.status IN ('cancelled', 'declined')
    AND NOT public.crm_record_has_demo(c.id);
  RETURN jsonb_build_object('needs_linking', v_book, 'without_demo', v_without, 'cancelled', v_cancel,
    'count', jsonb_array_length(v_book), 'as_of', now());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_inbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_inbox() TO authenticated, service_role;

-- The Hosts banner: the same rule and the same limit as the list, so they agree.
CREATE FUNCTION public.crm_demo_inbox_count() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN (SELECT count(*) FROM (SELECT 1 FROM public.book_call_leads k
                                 WHERE k.audience = 'host' AND public.crm_demo_needs_linking(k.id) LIMIT 200) q)::integer;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_demo_inbox_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_inbox_count() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Reads.
-- ---------------------------------------------------------------------------
-- From 20281126034571_issue_4571_w3_crm_card_watchers_contacts.sql:717. #4571 W4: next_demo and demo_gate on hosts.
CREATE OR REPLACE FUNCTION public.crm_record_json(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'pipeline', r.pipeline, 'name', r.name, 'icp', r.icp, 'region_id', r.region_id,
    'stage', r.stage, 'stage_reason', r.stage_reason, 'contact', r.contact, 'channel', r.channel,
    'source', r.source, 'next_action', r.next_action, 'due_on', r.due_on,
    'owners', COALESCE((SELECT jsonb_agg(o.owner_email ORDER BY o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb),
    'brand_id', r.brand_id,
    'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = r.brand_id AND b.deleted_at IS NULL),
    'place_pool_id', r.place_id,
    'place_name', (SELECT p.name FROM public.place_pool p WHERE p.id = r.place_id AND p.deleted_at IS NULL),
    'beta_lead_id', r.beta_lead_id, 'followers', r.followers, 'agreement', r.agreement, 'rate', r.rate,
    'went_live_at', r.went_live_at,
    'identifiers', public.crm_identifiers_json(r.id),
    'contact_rule', r.contact_rule, 'contact_rule_reason', r.contact_rule_reason,
    'contact_rule_by', r.contact_rule_by, 'contact_rule_at', r.contact_rule_at,
    'last_touch_at', (SELECT max(a.occurred_at) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'touch_count', (SELECT count(*) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'created_by', r.created_by, 'created_at', r.created_at, 'updated_at', r.updated_at)
  || jsonb_build_object(  -- #4571 W3
    'watchers', COALESCE((SELECT jsonb_agg(w.watcher_email ORDER BY w.watcher_email)
                            FROM public.crm_record_watchers w WHERE w.record_id = r.id), '[]'::jsonb),
    'last_touch', (SELECT jsonb_build_object('at', a.occurred_at, 'actor_name', public.ops_name(a.actor_email),
                                             'channel', a.channel, 'direction', a.direction, 'outcome', a.call_outcome)
                     FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'
                    ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1),
    'open_work', (SELECT count(*) FROM public.ops_work_cards c
                   WHERE c.id IN (SELECT public.crm_record_work_ids(r.id)) AND c.status <> 'done'))
  || CASE WHEN r.pipeline = 'hosts' THEN jsonb_build_object(  -- #4571 W4
       'next_demo', (SELECT jsonb_build_object('booking_id', k.id, 'call_at', k.call_at, 'status', k.status)
                       FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                      WHERE d.record_id = r.id AND k.status IN ('booked', 'moved') AND k.call_at >= now() - interval '1 hour'
                      ORDER BY k.call_at, k.id LIMIT 1),
       'demo_gate', public.crm_demo_gate(r))
     ELSE '{}'::jsonb END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_json(public.crm_records) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_json(public.crm_records) TO service_role;

-- From 20281126034571_issue_4571_w3_crm_card_watchers_contacts.sql:2096. #4571 W4: demos and schedule_token.
CREATE OR REPLACE FUNCTION public.crm_record_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_rec public.crm_records;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'record', public.crm_record_json(v_rec),
    'links', jsonb_build_object(
      'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                                          'is_live', public.crm_brand_is_live(b.id))
                  FROM public.brands b WHERE b.id = v_rec.brand_id AND b.deleted_at IS NULL),
      'place', (SELECT jsonb_build_object('id', p.id, 'name', p.name, 'city', p.city)
                  FROM public.place_pool p WHERE p.id = v_rec.place_id AND p.deleted_at IS NULL)),
    'activity', COALESCE((
      SELECT jsonb_agg(public.crm_activity_json(a) ORDER BY a.occurred_at DESC, a.created_at DESC, a.id)
      FROM (SELECT x.* FROM public.crm_activity x
             WHERE x.record_id = v_rec.id
             ORDER BY x.occurred_at DESC, x.created_at DESC, x.id
             LIMIT 200) a), '[]'::jsonb),
    'imports', public.crm_record_sources_json(v_rec.id),
    'undoable_activity_id', public.crm_undoable_activity(v_rec.id, v.actor_email),
    'files', public.ops_record_files_json(v_rec.id))  -- #4571 W3
    -- #4571 W4: the card's linked demos and, for a host, its scheduler token
    -- (Admin builds usemingla.com/schedule?for=<token> from it). The connector
    -- never passes the token on.
    || CASE WHEN v_rec.pipeline = 'hosts'
            THEN jsonb_build_object('demos', public.crm_record_demos_json(v_rec.id), 'schedule_token', v_rec.schedule_token)
            ELSE '{}'::jsonb END;
END;
$$;

-- From 20280520004339_issue_4339_book_a_call_leads.sql:329. #4571 W4: each call carries record ({id, name} or null) and needs_linking.
CREATE OR REPLACE FUNCTION public.admin_calendar_calls(
  p_from timestamptz,
  p_to timestamptz,
  p_show_test boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  -- Guard first: whoever can see bookings in Inbound leads.
  IF NOT (public.is_admin_user() OR COALESCE(public.admin_team_can('beta_leads'), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '93 days' THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'lead_id', c.id,
        'audience', c.audience,
        'name', c.name,
        'call_at', c.call_at,
        'city', c.city,
        'icp', c.icp,
        'makes', c.creator_makes,
        'first_place', c.first_place,
        'venue', c.venue,
        'social_platform', c.social_platform,
        'social_handle', c.social_handle,
        'social_url', c.social_url,
        'work_url', c.work_url,
        'website', c.website,
        'booker_time_zone', c.booker_time_zone,
        'meet_url', c.meet_url,
        'event_url', c.event_url,
        'is_test', c.is_test,
        'status', c.status,
        'status_changed_at', c.status_changed_at,
        'original_call_at', c.original_call_at)
        || public.crm_demo_calendar_bits(c.id)  -- #4571 W4: record and needs_linking
      ORDER BY c.call_at, c.id), '[]'::jsonb),
    'as_of', now())
    INTO v_out
    FROM (
      SELECT k.*, public.inbound_lead_is_test(k.email, COALESCE(NULLIF(btrim(k.venue), ''), k.name)) AS is_test
        FROM public.book_call_leads k
       WHERE k.call_at >= p_from AND k.call_at < p_to
       ORDER BY k.call_at, k.id
       LIMIT 1000
    ) c
   WHERE p_show_test OR NOT c.is_test;
  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) IS
  'Issue #4339: the admin Calendar''s calls layer. Every booked Book a call (Host, Creator, Local) in [p_from, p_to), at most 93 days: audience, name, call_at, city, ICP or what they make, social, Meet and calendar links, lead id, status (booked, moved, cancelled or declined), when it changed and the original time of a moved call. #4571 W4: record (the linked host card, {id, name}, or null) and needs_linking (crm_demo_needs_linking). Owner/admin or the beta_leads area, guard first; never anon; never an email address.';
REVOKE ALL ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) TO authenticated, service_role;

-- From 20281126034571_issue_4571_w3_crm_card_watchers_contacts.sql:1152. #4571 W4: get_record carries the card's demos.
CREATE OR REPLACE FUNCTION public.team_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  c_tools constant text[] := ARRAY[
    'get_started', 'my_day', 'find_records', 'get_record', 'check_names',
    'find_mingla_link', 'check_contactable', 'list_beta_leads', 'team_summary',
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply',
    'save_drafts', 'update_draft', 'list_drafts', 'withdraw_drafts'];
  c_writes constant text[] := ARRAY[
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply',
    'save_drafts', 'update_draft', 'withdraw_drafts'];
  c_plumbing constant text[] := ARRAY[
    'mcp:initialize', 'mcp:ping', 'mcp:tools/list', 'mcp:resources/list', 'mcp:resources/read',
    'mcp:prompts/list', 'mcp:prompts/get', 'mcp:notification', 'mcp:other'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_rk constant text := '^[A-Za-z0-9_-]{8,70}$';
  -- The argument that holds the list, for each tool that takes one.
  c_lists constant jsonb := '{"add_records": "records", "update_records": "updates", "move_stage": "moves",
                              "set_owners": "items", "log_activity": "entries", "record_reply": "replies",
                              "save_drafts": "drafts", "withdraw_drafts": "ids"}';
  v_auth    jsonb;
  v_key     uuid;
  v_owner   text;
  v_uid     uuid;
  v_agent   text;
  v_me      jsonb;
  v_lim     jsonb := public.team_agent_limits();
  v_args    jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_tool    text;
  v_started timestamptz := clock_timestamp();
  v_day     timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_n       bigint;
  v_oldest  timestamptz;
  v_retry   integer;
  v_token   text;
  v_words   text;
  v_call    uuid;
  v_client  text;
  v_result  jsonb;
  v_ok      boolean := false;
  v_m       text[];
  v_g       jsonb;
  v_date    date;
  v_int     integer;
  v_bool    boolean;
  v_name    jsonb;
  v_rows    jsonb;
  v_utc     date := (now() AT TIME ZONE 'UTC')::date;
  v_zone    text;
  v_zfrom   text;
  v_dfrom   text;
  v_dates   jsonb;
  v_lock_before text;
  v_field   text;
  v_list    jsonb;
  v_item    jsonb;
  v_idx     integer;
  v_id      uuid;
  v_one     jsonb;
  v_two     jsonb;
  v_row     jsonb;
  v_touch   jsonb;
  v_rk      text;
  v_stage   text;
  v_pipe    text;
  v_to      text;
  v_note    text;
  v_moved   text;
  v_replay  boolean;
  v_items   integer := 0;
  v_sum     jsonb := '{}'::jsonb;
  v_c1      integer := 0;
  v_c2      integer := 0;
  v_c3      integer := 0;
  v_c4      integer := 0;
  v_c5      integer := 0;
  v_want    integer := 0;
  v_cand    jsonb;
  v_chk     jsonb;
BEGIN
  -- A setup code, not a key: handed straight on. Nothing else here runs.
  IF p_tool = 'setup:redeem' THEN
    RETURN public.team_agent_setup_redeem(p_key_hash, p_client);
  END IF;

  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN
    RETURN '{"auth":"invalid"}'::jsonb;
  END IF;
  v_key   := (v_auth->>'key_id')::uuid;
  v_owner := v_auth->>'owner_email';
  v_uid   := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent';
  v_me    := jsonb_build_object('role', v_auth->>'role', 'agent', v_agent);
  -- Only a name from the fixed lists is ever stored.
  v_tool  := CASE WHEN p_tool = ANY (c_tools) OR p_tool = ANY (c_plumbing) THEN p_tool ELSE 'unknown' END;

  -- Limits. A refused request is recorded and does not count against the key.
  -- One request at a time per key from here to the end of the transaction, so
  -- the count below and the row written after it are one step: two requests
  -- arriving together can never both be "the last one allowed". A request
  -- waits for its turn for a bounded time only.
  v_lock_before := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', (v_lim->>'key_wait_ms') || 'ms', true);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_limit:' || v_key::text, 0));
    PERFORM set_config('lock_timeout', v_lock_before, true);
  EXCEPTION WHEN lock_not_available THEN
    PERFORM set_config('lock_timeout', v_lock_before, true);
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started,
            LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer,
            'limited');
    RETURN jsonb_build_object('limited',
      jsonb_build_object('retry_after_s', 2, 'token', 'busy',
        'message', 'Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'),
      'me', v_me);
  END;
  SELECT count(*), min(c.started_at) INTO v_n, v_oldest
  FROM public.team_agent_calls c
  WHERE c.key_id = v_key AND c.started_at > v_started - interval '60 seconds' AND c.outcome <> 'limited';
  IF v_n >= (v_lim->>'requests_per_minute')::integer THEN
    v_retry := GREATEST(1, LEAST(60, ceil(60 - extract(epoch FROM (v_started - v_oldest)))::integer));
    v_token := 'rate_limited';
    v_words := format('Your agent has made a lot of requests in the last minute. Wait %s seconds, then carry on. Nothing was lost.', v_retry);
  ELSIF v_tool NOT LIKE 'mcp:%' THEN
    SELECT count(*) INTO v_n
    FROM public.team_agent_calls c
    WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited' AND c.tool NOT LIKE 'mcp:%';
    IF v_n >= (v_lim->>'tool_calls_per_day')::integer THEN
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
      v_token := 'daily_limit';
      v_words := format('Your agent reached today''s limit of %s requests. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'tool_calls_per_day');
    ELSIF v_tool = ANY (c_writes) THEN
      SELECT COALESCE(sum(c.items), 0) INTO v_n
      FROM public.team_agent_calls c
      WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited';
      -- The most this request could write, counted before it writes anything,
      -- so the day's limit is never passed part-way through a request.
      v_list := v_args->COALESCE(c_lists->>v_tool, 'record');
      v_want := CASE
        WHEN v_tool = 'upsert_record' THEN 1 + COALESCE((jsonb_typeof(v_args->'touch') = 'object')::integer, 0)
        WHEN jsonb_typeof(v_list) IS DISTINCT FROM 'array' THEN 1
        WHEN v_tool = 'add_records' THEN jsonb_array_length(v_list)
          + (SELECT count(*)::integer FROM jsonb_array_elements(v_list) AS e
              WHERE jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'first_touch') = 'object')
        ELSE jsonb_array_length(v_list) END;
      v_list := NULL;
      IF v_n >= (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := format('Your agent reached today''s limit of %s records written. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'records_written_per_day');
      ELSIF v_n + v_want > (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := format('This request could write %s records and your agent has %s left of today''s %s. Nothing was written. Send fewer in one request, or wait: the count starts again at midnight UTC.',
          v_want, (v_lim->>'records_written_per_day')::integer - v_n, v_lim->>'records_written_per_day');
      END IF;
    END IF;
  END IF;
  IF v_token IS NOT NULL THEN
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited',
      jsonb_build_object('retry_after_s', v_retry, 'token', v_token, 'message', v_words), 'me', v_me);
  END IF;

  -- The request row. From here on, crm_ctx() answers "via" this agent for
  -- this person, in this transaction only.
  INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started)
  RETURNING id INTO v_call;

  v_client := NULLIF(left(regexp_replace(COALESCE(p_client, ''), '[[:cntrl:]]', '', 'g'), 120), '');
  UPDATE public.team_agent_keys
     SET last_used_at = v_started, last_used_client = v_client
   WHERE id = v_key AND (last_used_at IS NULL OR last_used_at < v_started - interval '60 seconds');

  BEGIN
    IF v_tool LIKE 'mcp:%' THEN
      v_result := CASE
        WHEN v_tool IN ('mcp:resources/read', 'mcp:prompts/list', 'mcp:prompts/get') THEN public.team_agent_guide()
        ELSE '{}'::jsonb
      END;
    ELSE
      -- The gate, before anything else: the person must hold the crm area.
      PERFORM 1 FROM public.crm_ctx();

      -- "Today", for the tools that depend on a date: the date the request
      -- names, else today in the zone the request names, else today in the
      -- zone the key remembers, else today in UTC. The answer says which.
      IF v_tool IN ('my_day', 'team_summary', 'find_records') THEN
        v_zone := v_auth->>'time_zone';
        v_zfrom := 'your key';
        IF v_args ? 'time_zone' AND jsonb_typeof(v_args->'time_zone') <> 'null' THEN
          IF jsonb_typeof(v_args->'time_zone') <> 'string' OR (v_args->>'time_zone') !~ '^[A-Za-z0-9_+/-]{1,64}$'
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_args->>'time_zone') THEN
            RAISE EXCEPTION 'invalid_arguments: "time_zone" is missing or the wrong kind. Send a zone name such as America/New_York.' USING ERRCODE = '22023';
          END IF;
          v_zone := v_args->>'time_zone';
          v_zfrom := 'this request';
        END IF;
        BEGIN
          v_date := (clock_timestamp() AT TIME ZONE COALESCE(v_zone, 'UTC'))::date;
        EXCEPTION WHEN others THEN
          v_zone := NULL;      -- a remembered zone this server no longer knows
          v_date := v_utc;
        END;
        IF v_zone IS NULL THEN
          v_zone := 'UTC';
          v_zfrom := 'no zone is recorded for your key, so UTC';
        END IF;
        v_dfrom := 'the clock';
        IF v_args ? 'today' AND jsonb_typeof(v_args->'today') <> 'null' THEN
          BEGIN
            IF jsonb_typeof(v_args->'today') <> 'string' OR (v_args->>'today') !~ '^\d{4}-\d{2}-\d{2}$' THEN
              RAISE EXCEPTION 'bad' USING ERRCODE = '22007';
            END IF;
            v_date := (v_args->>'today')::date;
          EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send a date such as 2026-10-13.' USING ERRCODE = '22023';
          END;
          IF v_date NOT BETWEEN v_utc - 1 AND v_utc + 1 THEN
            RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send your person''s own date today (it is within a day of the date in UTC), or leave it out.' USING ERRCODE = '22023';
          END IF;
          v_dfrom := 'this request';
        END IF;
        v_dates := jsonb_build_object('today', v_date, 'time_zone', v_zone, 'zone_from', v_zfrom, 'date_from', v_dfrom);
      END IF;

      -- A tool that takes a list: the list is there, holds 1 to 50 objects.
      v_field := c_lists->>v_tool;
      IF v_field IS NOT NULL THEN
        v_list := v_args->v_field;
        IF jsonb_typeof(v_list) IS DISTINCT FROM 'array' OR jsonb_array_length(v_list) < 1
           OR (v_tool = 'withdraw_drafts' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) AS e
                 WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~* c_uuid))
           OR (v_tool <> 'withdraw_drafts' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) AS e WHERE jsonb_typeof(e) <> 'object')) THEN
          RAISE EXCEPTION '%', format('invalid_arguments: "%s" is missing or the wrong kind. Send a list of 1 to 50 valid items.', v_field)
            USING ERRCODE = '22023';
        END IF;
        IF jsonb_array_length(v_list) > (v_lim->>'items_per_request')::integer THEN
          RAISE EXCEPTION 'too_many_items: Send at most 50 items in one request. Split the rest into another request.' USING ERRCODE = '22023';
        END IF;
      END IF;
      -- A tool that adds or logs: the request key that makes a repeat safe.
      IF v_tool IN ('add_records', 'upsert_record', 'log_activity', 'record_reply', 'save_drafts') THEN
        IF jsonb_typeof(v_args->'request_key') IS DISTINCT FROM 'string' OR (v_args->>'request_key') !~ c_rk THEN
          RAISE EXCEPTION 'request_key_required: Send a request_key (8 to 70 letters, digits, - or _) with this request, and the same one if you repeat it, so a repeat changes nothing.'
            USING ERRCODE = '22023';
        END IF;
        v_rk := v_args->>'request_key';
        -- The key belongs to this tool and these arguments. Another use of it
        -- stops here, before anything is written.
        PERFORM public.crm_request_claim(v_rk || '-claim', 'agent:' || v_tool, v_args);
      END IF;

      CASE v_tool
        WHEN 'get_started' THEN
          v_g := public.team_agent_guide();
          v_result := jsonb_build_object(
            'me', (v_g->'config'->'me') - 'can_delete' - 'can_add_region',
            'role', v_auth->>'role',
            'agent', v_agent,
            'can', jsonb_build_object('delete', false,
                                      'set_targets', public.is_admin_user(),
                                      'see_team_dashboard', public.is_admin_user()),
            'status', v_g->'guide'->'status',
            'pipelines', v_g->'config'->'pipelines',
            'channels', v_g->'config'->'channels',
            'sources', v_g->'config'->'sources',
            'reply_classes', v_g->'config'->'reply_classes',
            'agreements', v_g->'config'->'agreements',
            'regions', v_g->'config'->'regions',
            'team', v_g->'config'->'team',
            'limits', v_g->'limits',
            'rules', v_g->'guide'->'rules',
            'routines', v_g->'guide'->'routines',
            'coming_next', v_g->'guide'->'coming_next');

        WHEN 'my_day', 'team_summary' THEN
          v_result := CASE v_tool WHEN 'my_day' THEN public.crm_home_summary(v_date) || jsonb_build_object('drafts_waiting', public.team_draft_counts()->'waiting')
                                                       || jsonb_build_object('calls_due', public.crm_calls_queue(v_date)->'count')  -- #4571 W3
                                  ELSE public.crm_team_summary(v_date) END;

        WHEN 'find_records' THEN
          v_result := public.team_agent_records_find((v_args - 'time_zone') || jsonb_build_object('today', v_date));

        WHEN 'get_record' THEN
          IF jsonb_typeof(v_args->'id') IS DISTINCT FROM 'string' OR (v_args->>'id') !~* c_uuid THEN
            RAISE EXCEPTION '%', format('invalid_id: "%s" is not a record id. Use an id returned by find_records.',
              left(COALESCE(v_args->>'id', ''), 60)) USING ERRCODE = '22023';
          END IF;
          v_int := (v_lim->>'record_log_default')::integer;
          IF v_args ? 'activity_limit' AND jsonb_typeof(v_args->'activity_limit') <> 'null' THEN
            IF jsonb_typeof(v_args->'activity_limit') <> 'number' OR (v_args->>'activity_limit') !~ '^\d{1,3}$'
               OR (v_args->>'activity_limit')::integer NOT BETWEEN 1 AND (v_lim->>'record_log_max')::integer THEN
              RAISE EXCEPTION '%', format('invalid_arguments: "activity_limit" is missing or the wrong kind. Send a whole number from 1 to %s.',
                v_lim->>'record_log_max') USING ERRCODE = '22023';
            END IF;
            v_int := (v_args->>'activity_limit')::integer;
          END IF;
          v_g := public.crm_record_get((v_args->>'id')::uuid);
          v_result := jsonb_build_object(
            'record', v_g->'record',
            'links', v_g->'links',
            'demos', COALESCE(v_g->'demos', '[]'::jsonb),  -- #4571 W4: call_at, status, link source; never an email or the token
            'activity', COALESCE((SELECT jsonb_agg(e ORDER BY ord)
                                    FROM jsonb_array_elements(v_g->'activity') WITH ORDINALITY AS t(e, ord)
                                   WHERE ord <= v_int), '[]'::jsonb),
            'activity_shown', LEAST(v_int, jsonb_array_length(v_g->'activity')),
            'more_activity', jsonb_array_length(v_g->'activity') > v_int);

        WHEN 'check_names' THEN
          IF jsonb_typeof(v_args->'names') IS DISTINCT FROM 'array'
             OR jsonb_array_length(v_args->'names') < 1
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_args->'names') e
                         WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 160) THEN
            RAISE EXCEPTION 'invalid_arguments: "names" is missing or the wrong kind. Send a list of 1 to 50 names, each at most 160 characters.' USING ERRCODE = '22023';
          END IF;
          IF jsonb_array_length(v_args->'names') > (v_lim->>'items_per_request')::integer THEN
            RAISE EXCEPTION 'too_many_items: Send at most 50 items in one request. Split the rest into another request.' USING ERRCODE = '22023';
          END IF;
          v_rows := '[]'::jsonb;
          FOR v_name IN SELECT e FROM jsonb_array_elements(v_args->'names') WITH ORDINALITY AS t(e, ord) ORDER BY ord LOOP
            v_rows := v_rows || jsonb_build_array(
              jsonb_build_object('name', v_name #>> '{}')
              || public.crm_duplicate_check(v_args->>'pipeline', v_name #>> '{}', NULL));
          END LOOP;
          v_result := jsonb_build_object('pipeline', v_args->>'pipeline', 'names', v_rows);

        WHEN 'find_mingla_link' THEN
          IF jsonb_typeof(v_args->'query') IS DISTINCT FROM 'string' OR char_length(v_args->>'query') > 160 THEN
            RAISE EXCEPTION 'invalid_arguments: "query" is missing or the wrong kind. Send at least 2 and at most 160 characters of a name.' USING ERRCODE = '22023';
          END IF;
          v_result := public.crm_link_search(v_args->>'kind', v_args->>'query');

        WHEN 'list_beta_leads' THEN
          v_bool := true;
          IF v_args ? 'only_new' AND jsonb_typeof(v_args->'only_new') <> 'null' THEN
            IF jsonb_typeof(v_args->'only_new') <> 'boolean' THEN
              RAISE EXCEPTION 'invalid_arguments: "only_new" is missing or the wrong kind. Send true or false.' USING ERRCODE = '22023';
            END IF;
            v_bool := (v_args->>'only_new')::boolean;
          END IF;
          v_int := (v_lim->>'find_page_default')::integer;
          IF v_args ? 'limit' AND jsonb_typeof(v_args->'limit') <> 'null' THEN
            IF jsonb_typeof(v_args->'limit') <> 'number' OR (v_args->>'limit') !~ '^\d{1,3}$'
               OR (v_args->>'limit')::integer NOT BETWEEN 1 AND (v_lim->>'find_page_max')::integer THEN
              RAISE EXCEPTION '%', format('invalid_arguments: "limit" is missing or the wrong kind. Send a whole number from 1 to %s.',
                v_lim->>'find_page_max') USING ERRCODE = '22023';
            END IF;
            v_int := (v_args->>'limit')::integer;
          END IF;
          v_g := public.crm_beta_leads_list();
          SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_rows
          FROM (SELECT e, ord FROM jsonb_array_elements(v_g->'leads') WITH ORDINALITY AS t(e, ord)
                 WHERE NOT v_bool OR jsonb_typeof(e->'host') IS DISTINCT FROM 'object'
                 ORDER BY ord LIMIT v_int) s;
          v_result := jsonb_build_object('leads', v_rows, 'total', v_g->'total', 'new_count', v_g->'new_count',
                                         'only_new', v_bool, 'shown', jsonb_array_length(v_rows));

        WHEN 'check_contactable' THEN
          v_result := public.crm_contact_check(v_args->>'pipeline', v_args->'candidates');

        WHEN 'add_records' THEN
          -- The bulk add the browser uses, then one log entry for each new
          -- record that came with a first touch.
          v_g := public.crm_records_bulk_create(
            v_args->>'pipeline',
            (SELECT jsonb_agg(t.e - 'first_touch' ORDER BY t.ord) FROM jsonb_array_elements(v_list) WITH ORDINALITY AS t(e, ord)),
            v_rk || '-a');
          v_replay := COALESCE((v_g->>'replayed')::boolean, false);
          v_rows := '[]'::jsonb;
          FOR v_idx IN 0 .. jsonb_array_length(v_list) - 1 LOOP
            v_item := v_list->v_idx;
            v_touch := NULL;
            SELECT e INTO v_one FROM jsonb_array_elements(v_g->'created') AS e WHERE (e->>'index')::integer = v_idx;
            IF FOUND THEN
              v_c1 := v_c1 + 1;
              v_row := jsonb_build_object('index', v_idx, 'status', 'created', 'record', v_one->'record');
              IF v_item ? 'first_touch' AND jsonb_typeof(v_item->'first_touch') <> 'null' THEN
                BEGIN
                  IF jsonb_typeof(v_item->'first_touch') <> 'object' THEN
                    RAISE EXCEPTION 'invalid_entry: Send first_touch as one object with a channel, a direction and the message.' USING ERRCODE = '22023';
                  END IF;
                  v_two := public.crm_record_log((v_one->'record'->>'id')::uuid,
                             (v_item->'first_touch') || jsonb_build_object('kind', 'touch'),
                             v_rk || '-t' || v_idx);
                  IF COALESCE((v_two->>'replayed')::boolean, false) THEN
                    v_touch := jsonb_build_object('status', 'replayed', 'activity', v_two->'activity');
                  ELSE
                    v_touch := jsonb_build_object('status', 'logged', 'activity', v_two->'activity');
                    v_c4 := v_c4 + 1;
                  END IF;
                  v_row := v_row || jsonb_build_object('record', v_two->'record');
                EXCEPTION
                  WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                    v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                    v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object(
                      'token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That touch could not be logged.')));
                    v_c5 := v_c5 + 1;
                  WHEN others THEN
                    RAISE WARNING 'team_agent_call: add_records item % stopped the request (% %)', v_idx, SQLSTATE, SQLERRM;
                    RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
                      USING ERRCODE = 'PT409';
                END;
              END IF;
            ELSE
              SELECT e INTO v_one FROM jsonb_array_elements(v_g->'skipped') AS e WHERE (e->>'index')::integer = v_idx;
              IF FOUND THEN
                v_c2 := v_c2 + 1;
                v_row := jsonb_build_object('index', v_idx, 'status', 'exists', 'existing', v_one->'existing',
                  'reason', CASE WHEN public.crm_name_key(regexp_replace(btrim(COALESCE(v_item->>'name', '')), '\s+', ' ', 'g'))
                                      = public.crm_name_key(COALESCE(v_one->'existing'->>'name', ''))
                                 THEN 'name' ELSE 'identifier' END);
                -- Every record this one matches is weighed: the strictest
                -- contact rule on any of them is the verdict.
                v_chk := NULL;
                BEGIN
                  v_chk := public.crm_contact_check(v_args->>'pipeline', jsonb_build_array(jsonb_strip_nulls(
                             jsonb_build_object('name', v_item->'name', 'identifiers', v_item->'identifiers'))))->'results'->0;
                EXCEPTION WHEN invalid_parameter_value THEN
                  v_chk := NULL;
                END;
                IF v_chk->>'verdict' IN ('exists', 'do_not_contact', 'warm_intro_only') THEN
                  v_row := v_row || jsonb_build_object('verdict', v_chk->'verdict', 'matches', v_chk->'matches');
                  IF v_row->>'reason' = 'identifier' THEN
                    v_row := v_row || jsonb_build_object('matched_on', (
                      SELECT m->'matched_on' FROM jsonb_array_elements(v_chk->'matches') AS m
                       WHERE m->'record'->>'id' = v_one->'existing'->>'id'));
                  END IF;
                END IF;
                IF v_item ? 'first_touch' AND jsonb_typeof(v_item->'first_touch') <> 'null' THEN
                  v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object('token', 'exists',
                    'message', 'This record was already there, so the touch was not logged. Use upsert_record or log_activity if it still applies.'));
                  v_c5 := v_c5 + 1;
                END IF;
              ELSE
                SELECT e INTO v_one FROM jsonb_array_elements(v_g->'invalid') AS e WHERE (e->>'index')::integer = v_idx;
                v_c3 := v_c3 + 1;
                v_m := regexp_match(COALESCE(v_one->>'error', ''), '^([a-z_]+): (.+)$');
                v_row := jsonb_build_object('index', v_idx, 'status', 'invalid', 'error', jsonb_build_object(
                  'token', COALESCE(v_m[1], 'invalid'), 'message', COALESCE(v_m[2], 'That record could not be added.')));
              END IF;
            END IF;
            IF v_touch IS NOT NULL THEN
              v_row := v_row || jsonb_build_object('touch', v_touch);
            END IF;
            v_rows := v_rows || jsonb_build_array(v_row);
          END LOOP;
          v_result := jsonb_build_object('results', v_rows,
            'counts', jsonb_build_object('created', v_c1, 'exists', v_c2, 'invalid', v_c3,
                                         'touches_logged', v_c4, 'touches_refused', v_c5),
            'replayed', v_replay);
          v_items := CASE WHEN v_replay THEN 0 ELSE v_c1 END + v_c4;
          v_sum := jsonb_build_object('created', CASE WHEN v_replay THEN 0 ELSE v_c1 END, 'exists', v_c2,
                                      'refused', v_c3 + v_c5, 'logged', v_c4, 'replayed', v_replay::integer);

        WHEN 'upsert_record' THEN
          -- Add it, or find it, and log this touch on it. A record that is
          -- already there is never changed by this tool.
          IF jsonb_typeof(v_args->'record') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_arguments: "record" is missing or the wrong kind. Send one record as an object with at least a name.' USING ERRCODE = '22023';
          END IF;
          v_g := public.crm_record_create(v_args->>'pipeline', v_args->'record', v_rk || '-c');
          v_replay := COALESCE((v_g->>'replayed')::boolean, false);
          IF v_g->>'status' = 'created' THEN
            v_id := (v_g->'record'->>'id')::uuid;
            v_result := jsonb_build_object('status', 'created', 'record', v_g->'record', 'moved_to', v_g->'moved_to');
            v_c1 := CASE WHEN v_replay THEN 0 ELSE 1 END;
          ELSE
            v_id := (v_g->'existing'->>'id')::uuid;
            v_result := jsonb_strip_nulls(jsonb_build_object('reason', v_g->'reason', 'matched_on', v_g->'matched_on'))
                        || jsonb_build_object('status', 'exists', 'record', public.crm_record_get(v_id)->'record');
            v_c2 := 1;
            -- Every record this one matches is weighed: the strictest contact
            -- rule on any of them is the verdict.
            BEGIN
              v_chk := public.crm_contact_check(v_args->>'pipeline', jsonb_build_array(jsonb_strip_nulls(
                         jsonb_build_object('name', v_args->'record'->'name', 'identifiers', v_args->'record'->'identifiers'))))->'results'->0;
            EXCEPTION WHEN invalid_parameter_value THEN
              v_chk := NULL;
            END;
            IF v_chk->>'verdict' IN ('exists', 'do_not_contact', 'warm_intro_only') THEN
              v_result := v_result || jsonb_build_object('verdict', v_chk->'verdict', 'matches', v_chk->'matches');
            END IF;
          END IF;
          IF v_args ? 'touch' AND jsonb_typeof(v_args->'touch') <> 'null' THEN
            BEGIN
              IF jsonb_typeof(v_args->'touch') <> 'object' THEN
                RAISE EXCEPTION 'invalid_entry: Send touch as one object with a channel, a direction and the message.' USING ERRCODE = '22023';
              END IF;
              -- A first message is not logged when any record this one
              -- matches carries a contact rule.
              IF v_chk->>'verdict' IN ('do_not_contact', 'warm_intro_only')
                 AND (v_args->'touch'->>'direction') IS DISTINCT FROM 'inbound' THEN
                RAISE EXCEPTION '%', format('%s: "%s" is marked %s: %s. Nothing was logged. %s',
                    v_chk->>'verdict', v_chk->'record'->>'name',
                    CASE v_chk->>'verdict' WHEN 'do_not_contact' THEN 'Do not contact' ELSE 'Warm intro only' END,
                    v_chk->'record'->>'contact_rule_reason',
                    CASE v_chk->>'verdict' WHEN 'do_not_contact' THEN 'Do not message them; tell your person.'
                                           ELSE 'Ask your person to make the introduction.' END)
                  USING ERRCODE = '42501';
              END IF;
              v_two := public.crm_record_log(v_id, (v_args->'touch') || jsonb_build_object('kind', 'touch'), v_rk || '-u');
              IF COALESCE((v_two->>'replayed')::boolean, false) THEN
                v_touch := jsonb_build_object('status', 'replayed', 'activity', v_two->'activity');
              ELSE
                v_touch := jsonb_build_object('status', 'logged', 'activity', v_two->'activity');
                v_c4 := 1;
              END IF;
              v_result := v_result || jsonb_build_object('record', v_two->'record');
            EXCEPTION
              WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object(
                  'token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That touch could not be logged.')));
                v_c5 := 1;
            END;
            v_result := v_result || jsonb_build_object('touch', v_touch);
          END IF;
          v_result := v_result || jsonb_build_object('replayed', v_replay);
          v_items := v_c1 + v_c4;
          v_sum := jsonb_build_object('created', v_c1, 'exists', v_c2, 'logged', v_c4, 'refused', v_c5,
                                      'replayed', v_replay::integer);

        WHEN 'save_drafts' THEN
          v_result := public.team_draft_save(v_args->'drafts', v_rk);
          v_items := (SELECT count(*) FROM jsonb_array_elements(v_result->'results') e WHERE e->>'status' = 'saved');
          v_sum := jsonb_build_object('saved', v_items,
            'refused', jsonb_array_length(v_result->'results') - v_items);

        WHEN 'update_draft' THEN
          IF jsonb_typeof(v_args->'id') IS DISTINCT FROM 'string' OR (v_args->>'id') !~* c_uuid
             OR jsonb_typeof(v_args->'changes') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_arguments: Send a draft id and a changes object.' USING ERRCODE = '22023';
          END IF;
          v_result := public.team_draft_update((v_args->>'id')::uuid, v_args->'changes');
          v_items := CASE WHEN COALESCE((v_result->>'changed')::boolean, false) THEN 1 ELSE 0 END;
          v_sum := jsonb_build_object('updated', v_items);

        WHEN 'list_drafts' THEN
          v_result := public.team_draft_list(v_args);

        WHEN 'withdraw_drafts' THEN
          v_result := public.team_draft_discard(ARRAY(SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(v_args->'ids') e));
          v_items := (SELECT count(*) FROM jsonb_array_elements(v_result->'results') e WHERE e->>'status' = 'discarded');
          v_sum := jsonb_build_object('discarded', v_items);

        WHEN 'update_records', 'move_stage', 'set_owners', 'log_activity', 'record_reply' THEN
          v_rows := '[]'::jsonb;
          FOR v_idx IN 0 .. jsonb_array_length(v_list) - 1 LOOP
            v_item := v_list->v_idx;
            BEGIN
              IF jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string' OR (v_item->>'id') !~* c_uuid THEN
                RAISE EXCEPTION '%', format('invalid_id: "%s" is not a record id. Use an id returned by find_records.',
                  left(COALESCE(v_item->>'id', ''), 60)) USING ERRCODE = '22023';
              END IF;
              v_id := (v_item->>'id')::uuid;
              v_row := jsonb_build_object('index', v_idx, 'id', v_id);

              IF v_tool = 'update_records' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'changes')) THEN
                    RAISE EXCEPTION 'unknown_field: An update takes id and changes, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_update(v_id, v_item->'changes');
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'updated', 'record', v_one->'record', 'moved_to', v_one->'moved_to');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'unchanged', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'move_stage' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'to', 'expected_from', 'reason')) THEN
                    RAISE EXCEPTION 'unknown_field: A move takes id, to, expected_from and reason, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  IF jsonb_typeof(v_item->'expected_from') IS DISTINCT FROM 'string' OR btrim(v_item->>'expected_from') = '' THEN
                    RAISE EXCEPTION '%', format('invalid_arguments: "moves[%s].expected_from" is missing or the wrong kind. Send the stage you saw the card in.', v_idx)
                      USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_move_stage(v_id, v_item->>'to', v_item->>'reason', v_item->>'expected_from');
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'moved', 'record', v_one->'record', 'activity_id', v_one->'activity_id');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'already_there', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'set_owners' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'owner_emails', 'watcher_emails'))  -- #4571 W3
                     OR jsonb_typeof(v_item->'owner_emails') IS DISTINCT FROM 'array'
                     OR jsonb_array_length(v_item->'owner_emails') > 10
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'owner_emails') AS e WHERE jsonb_typeof(e) <> 'string') THEN
                    RAISE EXCEPTION 'invalid_owners: Send owner_emails as a list of at most 10 team email addresses. An empty list means unassigned.' USING ERRCODE = '22023';
                  END IF;
                  -- #4571 W3: watcher_emails (optional, 0 to 10) is the whole watcher list; both lists are written in one step.
                  IF v_item ? 'watcher_emails' AND (jsonb_typeof(v_item->'watcher_emails') IS DISTINCT FROM 'array'
                     OR jsonb_array_length(v_item->'watcher_emails') > 10
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'watcher_emails') AS e WHERE jsonb_typeof(e) <> 'string')) THEN
                    RAISE EXCEPTION 'invalid_watchers: Send watcher_emails as a list of at most 10 team email addresses. An empty list means nobody watches.' USING ERRCODE = '22023';
                  END IF;
                  v_one := CASE WHEN v_item ? 'watcher_emails'
                    THEN public.crm_record_set_people(v_id, ARRAY(SELECT jsonb_array_elements_text(v_item->'owner_emails')),
                                                     ARRAY(SELECT jsonb_array_elements_text(v_item->'watcher_emails')), NULL)
                    ELSE public.crm_record_set_owners(v_id, ARRAY(SELECT jsonb_array_elements_text(v_item->'owner_emails'))) END;
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'updated', 'record', v_one->'record');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'unchanged', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'log_activity' THEN
                  v_one := public.crm_record_log(v_id, v_item - 'id', v_rk || '-l' || v_idx);
                  IF COALESCE((v_one->>'replayed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'replayed', 'activity', v_one->'activity', 'record', v_one->'record');
                    v_c3 := v_c3 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'logged', 'activity', v_one->'activity', 'record', v_one->'record');
                    v_c1 := v_c1 + 1;
                  END IF;

                ELSE
                  -- record_reply: the inbound touch, then the card moves to
                  -- Replied (or to the stage asked for) when that applies.
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k
                              WHERE k NOT IN ('id', 'channel', 'body', 'occurred_at', 'reply_class', 'message_ref', 'move_to', 'reason')) THEN
                    RAISE EXCEPTION 'unknown_field: A reply takes id, channel, body, occurred_at, reply_class, message_ref, move_to and reason, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  IF jsonb_typeof(v_item->'body') IS DISTINCT FROM 'string' OR btrim(v_item->>'body') = '' THEN
                    RAISE EXCEPTION 'invalid_body: Record what they said, word for word.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_log(v_id,
                    jsonb_strip_nulls(jsonb_build_object(
                      'kind', 'touch', 'direction', 'inbound', 'channel', v_item->'channel', 'body', v_item->'body',
                      'occurred_at', v_item->'occurred_at', 'reply_class', v_item->'reply_class',
                      'message_ref', v_item->'message_ref')),
                    v_rk || '-r' || v_idx);
                  v_moved := NULL;
                  v_note := NULL;
                  IF COALESCE((v_one->>'replayed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'replayed', 'activity', v_one->'activity',
                                                         'record', v_one->'record', 'moved_to', NULL);
                    v_c3 := v_c3 + 1;
                  ELSE
                    v_pipe  := v_one->'record'->>'pipeline';
                    v_stage := v_one->'record'->>'stage';
                    v_to    := NULLIF(btrim(COALESCE(v_item->>'move_to', '')), '');
                    IF v_to IS NULL THEN
                      IF COALESCE((public.crm_stage_def(v_pipe, v_stage)->>'terminal')::boolean, false) THEN
                        v_note := format('This card is in %s, so it stayed there. Move it yourself if they are back.',
                                         public.crm_stage_def(v_pipe, v_stage)->>'label');
                      ELSIF (public.crm_stage_def(v_pipe, v_stage)->>'pos')::integer
                              < (public.crm_stage_def(v_pipe, 'replied')->>'pos')::integer THEN
                        v_to := 'replied';
                      ELSIF v_stage <> 'replied' THEN
                        v_note := format('Already in %s, so the card stayed where it is.',
                                         public.crm_stage_def(v_pipe, v_stage)->>'label');
                      END IF;
                    END IF;
                    v_two := NULL;
                    IF v_to IS NOT NULL THEN
                      BEGIN
                        v_two := public.crm_record_move_stage(v_id, v_to, v_item->>'reason', v_stage);
                        IF COALESCE((v_two->>'changed')::boolean, false) THEN
                          v_moved := v_to;
                          v_c2 := v_c2 + 1;
                        END IF;
                      EXCEPTION WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                        v_two := NULL;
                        v_note := SQLERRM;
                      END;
                    END IF;
                    v_row := v_row || jsonb_build_object('status', 'logged', 'activity', v_one->'activity',
                      'record', COALESCE(v_two->'record', v_one->'record'), 'moved_to', v_moved)
                      || jsonb_strip_nulls(jsonb_build_object('move_note', v_note));
                    v_c1 := v_c1 + 1;
                  END IF;
              END IF;
            EXCEPTION
              WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                v_row := jsonb_build_object('index', v_idx, 'id', v_item->'id', 'status', 'error',
                  'error', jsonb_build_object('token', COALESCE(v_m[1], 'refused'),
                                              'message', COALESCE(v_m[2], 'That item was refused.')));
                v_c4 := v_c4 + 1;
              WHEN others THEN
                RAISE WARNING 'team_agent_call: % item % stopped the request (% %)', v_tool, v_idx, SQLSTATE, SQLERRM;
                RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
                  USING ERRCODE = 'PT409';
            END;
            v_rows := v_rows || jsonb_build_array(v_row);
          END LOOP;
          v_result := jsonb_build_object('results', v_rows, 'counts', CASE v_tool
            WHEN 'update_records' THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'error', v_c4)
            WHEN 'move_stage'     THEN jsonb_build_object('moved', v_c1, 'already_there', v_c2, 'error', v_c4)
            WHEN 'set_owners'     THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'error', v_c4)
            WHEN 'log_activity'   THEN jsonb_build_object('logged', v_c1, 'replayed', v_c3, 'error', v_c4)
            ELSE jsonb_build_object('logged', v_c1, 'moved', v_c2, 'replayed', v_c3, 'error', v_c4) END);
          v_items := v_c1;
          v_sum := CASE v_tool
            WHEN 'update_records' THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'move_stage'     THEN jsonb_build_object('moved', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'set_owners'     THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'log_activity'   THEN jsonb_build_object('logged', v_c1, 'replayed', v_c3, 'refused', v_c4)
            ELSE jsonb_build_object('logged', v_c1, 'moved', v_c2, 'replayed', v_c3, 'refused', v_c4) END;

        ELSE
          RAISE EXCEPTION 'unknown_tool: That tool does not exist. Call tools/list to see what is available.' USING ERRCODE = '22023';
      END CASE;
    END IF;
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_items := 0;
    v_sum := '{}'::jsonb;
    v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
    IF v_m IS NOT NULL THEN
      v_token := v_m[1];
      v_words := v_m[2];
    ELSE
      v_token := 'server_error';
      v_words := 'Something went wrong on our side. Nothing was saved. Send the same request again.';
      RAISE WARNING 'team_agent_call: tool % ended with an unexpected error (% %)', v_tool, SQLSTATE, SQLERRM;
    END IF;
  END;

  -- Counts only: never a name, an argument or a result.
  UPDATE public.team_agent_calls
     SET outcome = CASE WHEN v_ok THEN 'ok' ELSE left(v_token, 60) END,
         items = v_items,
         summary = v_sum,
         duration_ms = LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer
   WHERE id = v_call;

  IF v_ok THEN
    -- "dates" is there for a tool that depends on a date: the date and the
    -- time zone that answer was worked out for.
    RETURN jsonb_strip_nulls(jsonb_build_object('dates', v_dates))
           || jsonb_build_object('ok', true, 'result', v_result, 'me', v_me);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('token', v_token, 'message', v_words), 'me', v_me);
END;
$function$
;

COMMIT;
