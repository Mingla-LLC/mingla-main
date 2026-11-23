-- Issue #4571 (Work pipeline redesign), wave W7: a linked brand counts too
-- (Seth's decision (d), 23 Nov).
--   1. The rule. Demo booked (meeting) still needs a linked book_call_leads
--      booking that is on (booked or moved). Onboarded and Live are allowed
--      with a linked demo OR a linked Mingla brand (crm_records.brand_id, the
--      column the "brand linked" path writes): a brand proves the host signed
--      up. crm_4571_stage_move_ok is the ONE test; it takes the brand id, so
--      the trigger reads the row being written (NEW.brand_id), not the stored
--      one. crm_4571_demo_move_ok (W4's 5-argument test) and
--      crm_demo_stage_allowed now read the same test.
--   2. A move down into Demo booked (Onboarded back to Demo booked) needs the
--      card to have had a linked demo. A brand-only host never had one, so it
--      cannot be put in Demo booked without a demo. Grandfathered cards keep
--      moving inside the band, as in W4.
--   3. The trigger crm_4571_demo_stage_guard: a new host may be inserted at
--      Onboarded or Live when it carries a brand (Demo booked never). The
--      refusal names the stage: Demo booked needs a demo; Onboarded and Live
--      need a demo or the brand.
--   4. Linking a brand moves a host to Onboarded or Live again, as before W4:
--      crm_apply_brand_link and crm_reconcile_live are restored to their
--      pre-W4 bodies (the trigger now allows those moves), so a self-serve
--      brand sign-up (ops_brand_autolink_one, "create" and "link") lands at
--      Onboarded, or Live when the brand has a public listing.
--   5. What the card shows: crm_demo_gate gains locked_stages (each band stage
--      the rule refuses from where the card is) and reasons (the sentence per
--      stage); locked still means Demo booked is locked from below the band.
--      needs_linking and demo_cancelled are false for a host at Onboarded or
--      Live with its brand linked: that card is valid, not missing a demo.
--   6. Unlinking a demo (crm_demo_unlink) and undoing a merge
--      (crm_record_unmerge) are refused only when the card would break the
--      rule: Demo booked with no other demo, or Onboarded or Live with neither
--      another demo nor a brand. crm_demo_inbox leaves brand-linked Onboarded
--      and Live hosts out of Demos cancelled.
--   7. ops_plan_tools names log_emails (the W6b connector tool), so a Work
--      plan step may name it.
--   Unlinking a brand is not refused (it is the brand flow's own write); a
--   host left at Onboarded with neither link shows Needs linking.
--
-- INVARIANT crm-demo-or-brand-before-onboarded: gate crm_4571_demo_stage_guard
-- (crm_4571_stage_move_ok); test
-- supabase/migrations/__tests__/issue_4571_w7_brand_counts.implementor.pg17.test.sql
-- INVARIANT crm-demo-before-demo-booked: same gate; same test
--
-- Static SQL only. Every replaced body is copied from its latest definition
-- (named beside it) and each edit is marked "#4571 W7".
--
-- ROLLBACK (no down file): re-run the bodies of crm_4571_demo_move_ok,
-- crm_demo_stage_allowed, crm_4571_demo_stage_guard, crm_demo_gate,
-- crm_apply_brand_link, crm_reconcile_live and crm_demo_unlink from
-- 20281126044571, and crm_record_unmerge and crm_demo_inbox from
-- 20281126094571, and ops_plan_tools from 20271116003980; then drop
-- crm_4571_stage_move_ok and crm_4571_stage_refusal.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. The rule.
-- ---------------------------------------------------------------------------
-- #4571 W7 gate for INVARIANTS crm-demo-before-demo-booked and
-- crm-demo-or-brand-before-onboarded: the ONE test, read by the trigger, by
-- crm_demo_stage_allowed and by crm_demo_gate. Removing the brand branch makes
-- a self-serve brand stay at Prospect and fails
-- issue_4571_w7_brand_counts.implementor.pg17.test.sql.
CREATE FUNCTION public.crm_4571_stage_move_ok(
  p_record_id uuid, p_pipeline text, p_from text, p_to text, p_exempt_at timestamptz, p_brand_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_pipeline IS DISTINCT FROM 'hosts' THEN true
    WHEN p_to IS NULL OR p_to NOT IN ('meeting', 'onboarded', 'live') THEN true
    WHEN p_from IS NOT DISTINCT FROM p_to THEN true
    -- Grandfathered and still in the band.
    WHEN p_exempt_at IS NOT NULL AND p_from IN ('meeting', 'onboarded', 'live') THEN true
    WHEN public.crm_record_has_demo(p_record_id) THEN true
    -- Onboarded and Live: a linked Mingla brand counts too.
    WHEN p_to IN ('onboarded', 'live') AND p_brand_id IS NOT NULL THEN true
    -- Down inside the band (Live back to Onboarded): the card was already past
    -- the gate. Down into Demo booked only for a card that had a linked demo.
    WHEN p_from IN ('meeting', 'onboarded', 'live')
         AND (public.crm_stage_def('hosts', p_to)->>'pos')::integer < (public.crm_stage_def('hosts', p_from)->>'pos')::integer
         AND (p_to <> 'meeting' OR EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.record_id = p_record_id)) THEN true
    ELSE false
  END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_stage_move_ok(uuid, text, text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_stage_move_ok(uuid, text, text, text, timestamptz, uuid) TO service_role;

-- The plain sentence for a refused move into p_to (the trigger's words).
CREATE FUNCTION public.crm_4571_stage_refusal(p_to text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p_to = 'meeting'
    THEN 'Demo booked needs a Google Meet booked through the scheduler and linked to this card. Send the card''s scheduler link, or link the booking on Needs linking.'
    ELSE CASE p_to WHEN 'live' THEN 'Live' ELSE 'Onboarded' END
         || ' needs a demo booked through the scheduler and linked to this card, or the host''s Mingla brand linked. Send the card''s scheduler link, or link the brand on the card.'
  END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_4571_stage_refusal(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_stage_refusal(text) TO service_role;

-- From 20281126044571. #4571 W7: the same test, with the stored brand.
CREATE OR REPLACE FUNCTION public.crm_4571_demo_move_ok(
  p_record_id uuid, p_pipeline text, p_from text, p_to text, p_exempt_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT public.crm_4571_stage_move_ok(p_record_id, p_pipeline, p_from, p_to, p_exempt_at,
           (SELECT c.brand_id FROM public.crm_records c WHERE c.id = p_record_id))
$$;

-- From 20281126044571. #4571 W7: reads crm_4571_stage_move_ok with the card's brand.
CREATE OR REPLACE FUNCTION public.crm_demo_stage_allowed(p_record_id uuid, p_to text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE((SELECT public.crm_4571_stage_move_ok(c.id, c.pipeline, c.stage, p_to, c.demo_rule_exempt_at, c.brand_id)
                     FROM public.crm_records c WHERE c.id = p_record_id), true)
$$;

-- From 20281126044571. #4571 W7: the brand on the row being written counts for
-- Onboarded and Live, an insert carrying a brand may start there, and the
-- refusal names the stage.
CREATE OR REPLACE FUNCTION public.crm_4571_demo_stage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.pipeline IS DISTINCT FROM 'hosts' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Only the W4 migration grandfathers; a new card never starts exempt.
    NEW.demo_rule_exempt_at := NULL;
    IF NEW.stage IN ('meeting', 'onboarded', 'live')
       AND NOT public.crm_4571_stage_move_ok(NEW.id, NEW.pipeline, NULL, NEW.stage, NULL, NEW.brand_id) THEN
      RAISE EXCEPTION '%', 'demo_required: ' || public.crm_4571_stage_refusal(NEW.stage) USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;
  -- Leaving the band clears the exemption: coming back needs a demo (or, for
  -- Onboarded and Live, a brand).
  IF NEW.stage NOT IN ('meeting', 'onboarded', 'live') THEN
    NEW.demo_rule_exempt_at := NULL;
    RETURN NEW;
  END IF;
  IF NOT public.crm_4571_stage_move_ok(OLD.id, OLD.pipeline, OLD.stage, NEW.stage, OLD.demo_rule_exempt_at, NEW.brand_id) THEN
    RAISE EXCEPTION '%', 'demo_required: ' || public.crm_4571_stage_refusal(NEW.stage) USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. What the card shows.
-- ---------------------------------------------------------------------------
-- From 20281126044571. #4571 W7: locked_stages and reasons per band stage;
-- a brand-linked Onboarded or Live host is not missing a demo.
CREATE OR REPLACE FUNCTION public.crm_demo_gate(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'locked', r.stage NOT IN ('meeting', 'onboarded', 'live') AND 'meeting' = ANY (s.locked),
    'reason', CASE WHEN r.stage NOT IN ('meeting', 'onboarded', 'live') AND 'meeting' = ANY (s.locked)
                   THEN CASE WHEN 'onboarded' = ANY (s.locked)
                     THEN 'Demo booked means a Google Meet booked through the scheduler and linked here. Send the scheduler link, or link a demo they already booked. Onboarded also opens once the host''s Mingla brand is linked.'
                     ELSE 'Demo booked means a Google Meet booked through the scheduler and linked here. This host''s Mingla brand is linked, so Onboarded is open.' END END,
    'locked_stages', to_jsonb(s.locked),
    'reasons', COALESCE((SELECT jsonb_object_agg(x, public.crm_4571_stage_refusal(x)) FROM unnest(s.locked) x), '{}'::jsonb),
    'brand_linked', r.brand_id IS NOT NULL,
    'exempt', r.demo_rule_exempt_at IS NOT NULL,
    -- A card past the gate with nothing that lets it stand there: grandfathered,
    -- its demo was cancelled, or its brand was unlinked.
    'needs_linking', r.stage IN ('meeting', 'onboarded', 'live') AND NOT h.has_demo AND NOT h.brand_ok,
    'demo_cancelled', NOT h.has_demo AND NOT h.brand_ok AND EXISTS (
        SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
         WHERE d.record_id = r.id AND k.status IN ('cancelled', 'declined')))
  FROM (SELECT public.crm_record_has_demo(r.id) AS has_demo,
               (r.stage IN ('onboarded', 'live') AND r.brand_id IS NOT NULL) AS brand_ok) h,
       (SELECT COALESCE(array_agg(t ORDER BY o), ARRAY[]::text[]) AS locked
          FROM unnest(ARRAY['meeting', 'onboarded', 'live']) WITH ORDINALITY u(t, o)
         WHERE t IS DISTINCT FROM r.stage
           AND NOT public.crm_4571_stage_move_ok(r.id, r.pipeline, r.stage, t, r.demo_rule_exempt_at, r.brand_id)) s
$$;

-- ---------------------------------------------------------------------------
-- 3. Linking a brand moves the host again, as before W4.
-- ---------------------------------------------------------------------------
-- From 20270820003802_issue_3802_wave1_crm_pipelines.sql:1048 (the pre-W4
-- body, restored). #4571 W7: the trigger allows a brand-linked host into
-- Onboarded and Live, so the W4 skip is gone.
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


-- From 20270823003802_issue_3802_wave1_homes_targets_beta.sql:579 (the pre-W4
-- body, restored). #4571 W7: a brand-linked host is promoted to Live again;
-- the trigger allows it, so W4's crm_demo_stage_allowed filter is gone.
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
      AND (p_record_id IS NULL OR x.id = p_record_id)
    ORDER BY x.id
  LOOP
    BEGIN
      IF public.crm_brand_is_live(c.brand_id) THEN
        -- Lock the one host, then look again: it may have moved, been
        -- unlinked or been deleted since the list above was read.
        SELECT * INTO r FROM public.crm_records k WHERE k.id = c.id FOR UPDATE;
        IF FOUND AND r.deleted_at IS NULL AND r.stage NOT IN ('live', 'lost')
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

-- ---------------------------------------------------------------------------
-- 4. Unlink, undo a merge, and Demos cancelled read the same rule.
-- ---------------------------------------------------------------------------

-- From 20281126044571. #4571 W7: refused only when the card would break the rule.
CREATE OR REPLACE FUNCTION public.crm_demo_unlink(p_booking_id uuid) RETURNS jsonb
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
     -- #4571 W7: a brand-linked host at Onboarded or Live stands on its brand.
     AND NOT (v_r.stage IN ('onboarded', 'live') AND v_r.brand_id IS NOT NULL)
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

-- From 20281126094571. #4571 W7: the kept card is valid with a demo or, at
-- Onboarded or Live, its brand.
CREATE OR REPLACE FUNCTION public.crm_record_unmerge(p_merge_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v record; v_actor text; v_now timestamptz := clock_timestamp();
  m public.crm_record_merges; v_keep public.crm_records; v_drop public.crm_records; v_kind text; l jsonb; n public.ops_work_cards;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_actor := public.crm_4571_person_ctx();
  SELECT * INTO m FROM public.crm_record_merges x WHERE x.id = p_merge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That merge is not here.' USING ERRCODE = 'P0002'; END IF;
  IF m.unmerged_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_undone: This merge was already undone.' USING ERRCODE = '22023';
  END IF;
  IF m.merged_at < v_now - interval '7 days' THEN
    RAISE EXCEPTION 'too_late: A merge can be undone for 7 days. Move what you need by hand; the merge log lists every row it moved.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.crm_records c WHERE c.id IN (m.keep_id, m.drop_id) ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_keep FROM public.crm_records c WHERE c.id = m.keep_id;
  SELECT * INTO v_drop FROM public.crm_records c WHERE c.id = m.drop_id;
  IF v_keep.deleted_at IS NOT NULL OR v_drop.deleted_at IS NOT NULL OR v_drop.merged_into_id IS DISTINCT FROM v_keep.id THEN
    RAISE EXCEPTION 'cannot_undo: One of the two cards changed since (deleted, or no longer merged), so the merge cannot be undone.' USING ERRCODE = '22023';
  END IF;
  v_kind := CASE v_keep.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END;
  -- #4571 rework gate for INVARIANT crm-demo-before-demo-booked (the
  -- crm_demo_unlink rule): the demos go back to the duplicate, so a kept host
  -- in Demo booked, Onboarded or Live that would be left with no booked demo
  -- (and is not grandfathered) is refused. The undo writes nothing then; the
  -- person moves the kept card back first, as for an unlink.
  IF v_keep.pipeline = 'hosts' AND v_keep.stage IN ('meeting', 'onboarded', 'live') AND v_keep.demo_rule_exempt_at IS NULL
     -- #4571 W7: a kept host at Onboarded or Live with its brand linked stays valid.
     AND NOT (v_keep.stage IN ('onboarded', 'live') AND v_keep.brand_id IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                  WHERE d.record_id = v_keep.id AND k.status IN ('booked', 'moved')
                    AND d.booking_id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'demos') e))
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                      WHERE d.record_id = v_keep.id AND k.status IN ('booked', 'moved')
                        AND d.booking_id NOT IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'demos') e)) THEN
    RAISE EXCEPTION '%', format('demo_in_use: %s is in %s on the demo that came from %s, and undoing the merge sends that demo back. Move %s back to %s first, then undo the merge.',
      v_keep.name, public.crm_stage_def('hosts', v_keep.stage)->>'label', v_drop.name, v_keep.name,
      COALESCE(public.crm_stage_def('hosts', CASE WHEN m.moved->>'keep_stage_before' IN ('meeting', 'onboarded', 'live') THEN 'replied'
                                                ELSE m.moved->>'keep_stage_before' END)->>'label', 'Replied'))
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.crm_activity a SET record_id = v_drop.id
   WHERE a.record_id = v_keep.id AND a.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'activity') e);
  UPDATE public.crm_record_identifiers i SET record_id = v_drop.id
   WHERE i.record_id = v_keep.id AND i.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'identifiers') e)
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers d WHERE d.record_id = v_drop.id AND d.kind = i.kind AND d.value_key = i.value_key);
  UPDATE public.crm_record_owners o SET record_id = v_drop.id
   WHERE o.record_id = v_keep.id AND o.owner_email IN (SELECT e #>> '{}' FROM jsonb_array_elements(m.moved->'owners') e)
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners d WHERE d.record_id = v_drop.id AND d.owner_email = o.owner_email);
  UPDATE public.crm_record_watchers w SET record_id = v_drop.id
   WHERE w.record_id = v_keep.id AND w.watcher_email IN (SELECT e #>> '{}' FROM jsonb_array_elements(m.moved->'watchers') e)
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_watchers d WHERE d.record_id = v_drop.id AND d.watcher_email = w.watcher_email);
  UPDATE public.crm_record_demos d SET record_id = v_drop.id
   WHERE d.record_id = v_keep.id AND d.booking_id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'demos') e);
  UPDATE public.crm_email_log e SET record_id = v_drop.id
   WHERE e.record_id = v_keep.id AND e.id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(COALESCE(m.moved->'emails', '[]'::jsonb)) x)
     AND NOT EXISTS (SELECT 1 FROM public.crm_email_log d WHERE d.record_id = v_drop.id AND d.message_id = e.message_id);
  UPDATE public.crm_record_sources s SET record_id = v_drop.id
   WHERE s.record_id = v_keep.id
     AND (s.source_system, s.source_id) IN (SELECT e->>'system', e->>'id' FROM jsonb_array_elements(m.moved->'sources') e);
  UPDATE public.ops_work_files f SET record_id = v_drop.id
   WHERE f.record_id = v_keep.id AND f.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'files') e);
  FOR l IN SELECT e FROM jsonb_array_elements(m.moved->'links') e LOOP
    UPDATE public.ops_work_links w SET target_id = v_drop.id, label = l->>'label'
     WHERE w.card_id = (l->>'card_id')::uuid AND w.kind = v_kind AND w.target_id = v_keep.id;
    UPDATE public.ops_work_cards c SET revision = revision + 1, updated_by = v_actor, updated_via = NULL, updated_at = v_now
     WHERE c.id = (l->>'card_id')::uuid RETURNING * INTO n;
    IF n.id IS NOT NULL THEN
      PERFORM public.ops_card_event(n.id, v_actor, NULL, 'links', format('Undid the merge: this card links %s again', v_drop.name),
        NULL, jsonb_build_object('kind', v_kind, 'id', v_drop.id), n.revision - 1, n.revision);
    END IF;
  END LOOP;
  INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via, added_at)
  SELECT (e->>'card_id')::uuid, e->>'kind', (e->>'target_id')::uuid, e->>'label', e->>'added_by', e->>'added_via', (e->>'added_at')::timestamptz
    FROM jsonb_array_elements(m.moved->'removed_links') e
   WHERE EXISTS (SELECT 1 FROM public.ops_work_cards c WHERE c.id = (e->>'card_id')::uuid)
  ON CONFLICT DO NOTHING;
  UPDATE public.ops_work_cards c SET anchor_id = v_drop.id
   WHERE c.anchor_kind = v_kind AND c.anchor_id = v_keep.id
     AND c.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'anchors') e);

  UPDATE public.crm_records SET archived_at = NULL, archived_by = NULL, archived_reason = NULL, merged_into_id = NULL,
         updated_by = v_actor, updated_at = v_now WHERE id = v_drop.id;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at) VALUES
    (v_keep.id, 'note', v_actor, format('Undid the merge of %s.', v_drop.name), v_now, v_now),
    (v_drop.id, 'note', v_actor, format('Undid the merge into %s. This card is back on the board.', v_keep.name), v_now, v_now);
  UPDATE public.crm_record_merges SET unmerged_at = v_now, unmerged_by = v_actor WHERE id = m.id;
  PERFORM public.crm_audit(v_actor, 'crm.unmerge', 'crm_record', v_keep.id::text,
    jsonb_build_object('merge_id', m.id, 'drop_id', v_drop.id));
  SELECT * INTO v_drop FROM public.crm_records c WHERE c.id = m.drop_id;
  SELECT * INTO v_keep FROM public.crm_records c WHERE c.id = m.keep_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_drop), 'kept', public.crm_record_json(v_keep),
    'stage_note', CASE WHEN m.moved->>'stage_to' IS NOT NULL
      THEN format('%s stays in %s, where the merge moved it. Move it back yourself if that was wrong.', v_keep.name,
                  public.crm_stage_def(v_keep.pipeline, v_keep.stage)->>'label') END);
END;
$function$;

-- From 20281126094571. #4571 W7: Demos cancelled leaves out brand-linked
-- Onboarded and Live hosts.
CREATE OR REPLACE FUNCTION public.crm_demo_inbox() RETURNS jsonb
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
  WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.archived_at IS NULL AND c.stage = 'meeting'
    AND NOT public.crm_record_has_demo(c.id)
    AND NOT EXISTS (SELECT 1 FROM public.crm_record_demos d WHERE d.record_id = c.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('booking_id', k.id, 'record_id', c.id, 'record_name', c.name,
                   'stage', c.stage, 'call_at', k.call_at, 'status', k.status, 'status_changed_at', k.status_changed_at)
                   ORDER BY k.status_changed_at DESC NULLS LAST, k.call_at DESC), '[]'::jsonb) INTO v_cancel
  FROM public.crm_record_demos d
  JOIN public.book_call_leads k ON k.id = d.booking_id
  JOIN public.crm_records c ON c.id = d.record_id
  WHERE c.deleted_at IS NULL AND k.status IN ('cancelled', 'declined')
    AND NOT public.crm_record_has_demo(c.id)
    -- #4571 W7: a brand-linked Onboarded or Live host is not missing a demo.
    AND NOT (c.stage IN ('onboarded', 'live') AND c.brand_id IS NOT NULL);
  RETURN jsonb_build_object('needs_linking', v_book, 'without_demo', v_without, 'cancelled', v_cancel,
    'count', jsonb_array_length(v_book), 'as_of', now());
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. Found while verifying: W6b added the connector tool log_emails, but the
--    list of tools a Work plan step may name was not told. A superset; every
--    reader checks membership only.
-- ---------------------------------------------------------------------------
-- From 20271116003980_issue_3980_wave1_work_board.sql. #4571 W7: log_emails.
CREATE OR REPLACE FUNCTION public.ops_plan_tools() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$ SELECT ARRAY[
  'get_started','my_day','find_records','get_record','check_names','find_mingla_link','check_contactable',
  'list_beta_leads','team_summary','add_records','upsert_record','update_records','move_stage','set_owners',
  'log_activity','record_reply','save_drafts','update_draft','list_drafts','withdraw_drafts',
  'list_content','add_content','update_content','assign_content','comment_content','move_content',
  'log_emails',
  'read_log','claim','release','plan_work','add_work','start_work','update_work','close_work','push_back',
  'list_work','my_work','list_calendar','runway_report','set_expected_event',
  'person']::text[] $$;

COMMENT ON FUNCTION public.crm_4571_stage_move_ok(uuid, text, text, text, timestamptz, uuid) IS
  'Issue #4571 W7. The ONE host stage rule (INVARIANTS crm-demo-before-demo-booked, crm-demo-or-brand-before-onboarded): Demo booked needs a linked booked demo; Onboarded and Live need a linked booked demo or a linked Mingla brand (brand_id). Read by the trigger crm_4571_demo_stage_guard, crm_demo_stage_allowed and crm_demo_gate.';
COMMENT ON FUNCTION public.crm_record_unmerge(uuid) IS
  'Issue #4571 W6a (rework, W7). Undo a merge within 7 days: every row crm_record_merge moved (logged emails included) goes back to the duplicate, removed duplicate Work links come back, and the duplicate is unarchived. Refused (demo_in_use, nothing written) when the demos going back are the kept host''s only booked ones and it is in Demo booked, or in Onboarded or Live with no brand linked (INVARIANTS crm-demo-before-demo-booked, crm-demo-or-brand-before-onboarded). A stage the merge moved otherwise stays (stage_note says so). People only.';

COMMIT;
