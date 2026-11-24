-- Issue #4571: Admin's Hosts board timed out.
--
-- crm_records_list('hosts') built every card with public.crm_record_json(x),
-- one call per card. On production (1,465 host cards, 2026-11-24) that cost
-- about 9 ms a card, 13 s in all, past the 8 s statement timeout of the
-- authenticated role, so the board never loaded. Most of the time was
-- open_work: crm_record_work_ids(r.id) filtered every ops_work_cards row
-- through four OR'd EXISTS branches that no index can serve. The demo gate,
-- the W6 fields and the per-card helper calls made up most of the rest.
--
-- This migration:
--   1. crm_4571_record_work_pairs(uuid[]): the (record, work card) pairs for
--      many cards at once. Each of the four ways a work card belongs to a card
--      (a host or creator link, a call link, an expected-event anchor, an
--      event anchor of the card's brand) is its own indexed join, UNION'd.
--   2. crm_record_work_ids(uuid) now reads (1), so the card's Work section and
--      single-card reads use the same rule and get the indexed path too.
--   3. crm_4571_records_json(uuid[]): the board JSON for many cards in one
--      query. Same keys and values as crm_record_json(card) for every card;
--      open_work, the demo gate, next demo, suggest-replied and the cadence
--      are computed in the same pass instead of through per-card calls.
--   4. crm_records_list and crm_records_archived_list build their rows with
--      (3). Their auth (crm_ctx()), limits (5000 / 2000), truncated,
--      archived_count, total and grants are unchanged.
--
-- crm_record_json(r) is unchanged and stays the single-card read (it takes a
-- row value, so triggers and RETURNING paths keep working).
--
-- INVARIANT crm-board-json-matches-card-json | gate crm_4571_records_json (mirrors crm_record_json, crm_demo_gate, crm_4571_w6_json) | test supabase/migrations/__tests__/issue_4571_hosts_board_list_speed.implementor.pg17.test.sql
-- INVARIANT crm-archived-not-on-board: keep the archived_at IS NULL lines in
-- crm_records_list below.
--
-- ROLLBACK (no down file): restore crm_records_list and
-- crm_records_archived_list from 20281130064571 and crm_record_work_ids from
-- 20281130034571, then drop crm_4571_records_json(uuid[]) and
-- crm_4571_record_work_pairs(uuid[]).

-- 1. Work cards for many records. A card's work: every non-archived work card
-- linked to it (or, for a host with a brand, to any live host card with the
-- same brand), linked to one of their calls, anchored on one of their
-- expected events, or anchored on an event of the card's brand.
CREATE OR REPLACE FUNCTION public.crm_4571_record_work_pairs(p_ids uuid[])
RETURNS TABLE (record_id uuid, card_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH r AS (
    SELECT c.id, c.pipeline, c.brand_id FROM public.crm_records c WHERE c.id = ANY (p_ids)
  ),
  recs AS (
    SELECT r.id AS rid, r.id AS xid, r.pipeline FROM r
    UNION
    SELECT r.id, x.id, r.pipeline
      FROM r JOIN public.crm_records x
        ON x.brand_id = r.brand_id AND x.pipeline = 'hosts' AND x.deleted_at IS NULL
     WHERE r.pipeline = 'hosts' AND r.brand_id IS NOT NULL
  ),
  hits AS (
    SELECT recs.rid, l.card_id
      FROM recs JOIN public.ops_work_links l
        ON l.kind = CASE recs.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END AND l.target_id = recs.xid
    UNION
    SELECT recs.rid, l.card_id
      FROM public.ops_work_links l
      JOIN public.crm_activity a ON a.id = l.target_id
      JOIN recs ON recs.xid = a.record_id
     WHERE l.kind = 'call'
    UNION
    SELECT recs.rid, w.id
      FROM recs
      JOIN public.ops_expected_events z ON z.record_id = recs.xid
      JOIN public.ops_work_cards w ON w.anchor_kind = 'expected' AND w.anchor_id = z.id AND w.archived_at IS NULL
     WHERE recs.pipeline = 'hosts'
    UNION
    SELECT r.id, w.id
      FROM r
      JOIN public.events e ON e.brand_id = r.brand_id
      JOIN public.ops_work_cards w ON w.anchor_kind = 'event' AND w.anchor_id = e.id AND w.archived_at IS NULL
     WHERE r.pipeline = 'hosts' AND r.brand_id IS NOT NULL
  )
  SELECT h.rid, h.card_id
    FROM hits h JOIN public.ops_work_cards w ON w.id = h.card_id
   WHERE w.archived_at IS NULL
$$;
COMMENT ON FUNCTION public.crm_4571_record_work_pairs(uuid[]) IS
  'Issue #4571. (record_id, card_id) for every non-archived work card that belongs to each given host or creator card: host/creator links, call links, expected-event anchors and (hosts with a brand) event anchors, each through its own index. Internal: crm_record_work_ids and crm_4571_records_json.';
REVOKE ALL ON FUNCTION public.crm_4571_record_work_pairs(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_record_work_pairs(uuid[]) TO service_role;

-- 2. From 20281130034571: the same rule, now through (1).
CREATE OR REPLACE FUNCTION public.crm_record_work_ids(p_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.card_id FROM public.crm_4571_record_work_pairs(ARRAY[p_id]) p
$$;
REVOKE ALL ON FUNCTION public.crm_record_work_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_work_ids(uuid) TO service_role;

-- 3. The board JSON for many cards in one pass. Every key and value matches
-- public.crm_record_json(card) (20281130064571), including the W4 block
-- (next_demo and crm_demo_gate, 20281130114571) and the W6 block
-- (crm_4571_w6_json, 20281130084571: suggest_replied, cadence). A change to
-- any of those must be made here too; the test compares every seeded card.
CREATE OR REPLACE FUNCTION public.crm_4571_records_json(p_ids uuid[])
RETURNS TABLE (id uuid, j jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  -- Each per-card piece is a LATERAL lookup on an index, run once per card.
  -- The pieces that would otherwise call a function per card (open work and
  -- the touch author's name) are built once as maps keyed by id.
  WITH cfg AS (
    SELECT (public.crm_4571_cadence_config()->>'since')::date AS since,
           jsonb_object_agg(u.t, public.crm_4571_stage_refusal(u.t)) AS refusals,
           jsonb_object_agg(u.t, (public.crm_stage_def('hosts', u.t)->>'pos')::integer) AS pos
      FROM unnest(ARRAY['meeting', 'onboarded', 'live']) u(t)
  ),
  work AS (
    SELECT COALESCE(jsonb_object_agg(w.record_id, w.n), '{}'::jsonb) AS m
      FROM (SELECT p.record_id, count(*) AS n
              FROM public.crm_4571_record_work_pairs(p_ids) p
              JOIN public.ops_work_cards c ON c.id = p.card_id
             WHERE c.status <> 'done'
             GROUP BY p.record_id) w
  ),
  names AS (
    SELECT COALESCE(jsonb_object_agg(e.actor_email, public.ops_name(e.actor_email)) FILTER (WHERE e.actor_email IS NOT NULL), '{}'::jsonb) AS m,
           public.ops_name(NULL) AS null_name
      FROM (SELECT DISTINCT a.actor_email FROM public.crm_activity a
             WHERE a.record_id = ANY (p_ids) AND a.kind = 'touch') e
  )
  SELECT r.id,
    jsonb_build_object(
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
      'identifiers', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', i.kind, 'platform', i.platform, 'value', i.value, 'key', i.value_key,
                                                                   'id', i.id, 'status', i.status, 'bad_reason', i.bad_reason,
                                                                   'bad_at', i.bad_at, 'followers', i.followers, 'followers_at', i.followers_at)
                                                ORDER BY i.kind, i.value_key)
                                 FROM public.crm_record_identifiers i WHERE i.record_id = r.id), '[]'::jsonb),
      'contact_rule', r.contact_rule, 'contact_rule_reason', r.contact_rule_reason,
      'contact_rule_by', r.contact_rule_by, 'contact_rule_at', r.contact_rule_at,
      'last_touch_at', ts.last_at,
      'touch_count', ts.n,
      'created_by', r.created_by, 'created_at', r.created_at, 'updated_at', r.updated_at)
    || jsonb_build_object(
      'watchers', COALESCE((SELECT jsonb_agg(w.watcher_email ORDER BY w.watcher_email)
                              FROM public.crm_record_watchers w WHERE w.record_id = r.id), '[]'::jsonb),
      'last_touch', CASE WHEN t.found THEN
                      jsonb_build_object('at', t.at,
                                         'actor_name', CASE WHEN t.actor_email IS NULL THEN nm.null_name ELSE nm.m->>t.actor_email END,
                                         'channel', t.channel, 'direction', t.direction, 'outcome', t.call_outcome) END,
      'open_work', COALESCE((wk.m->>r.id::text)::bigint, 0))
    || CASE WHEN r.pipeline = 'hosts' THEN jsonb_build_object(
         'next_demo', (SELECT jsonb_build_object('booking_id', k.id, 'call_at', k.call_at, 'status', k.status)
                         FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                        WHERE d.record_id = r.id AND k.status IN ('booked', 'moved') AND k.call_at >= now() - interval '1 hour'
                        ORDER BY k.call_at, k.id LIMIT 1),
         -- crm_demo_gate (20281130114571).
         'demo_gate', jsonb_build_object(
           'locked', r.stage NOT IN ('meeting', 'onboarded', 'live') AND 'meeting' = ANY (gl.locked),
           'reason', CASE WHEN r.stage NOT IN ('meeting', 'onboarded', 'live') AND 'meeting' = ANY (gl.locked)
                          THEN CASE WHEN 'onboarded' = ANY (gl.locked)
                            THEN 'Demo booked means a Google Meet booked through the scheduler and linked here. Send the scheduler link, or link a demo they already booked. Onboarded also opens once the host''s Mingla brand is linked.'
                            ELSE 'Demo booked means a Google Meet booked through the scheduler and linked here. This host''s Mingla brand is linked, so Onboarded is open.' END END,
           'locked_stages', to_jsonb(gl.locked),
           'reasons', COALESCE((SELECT jsonb_object_agg(x, cfg.refusals->>x) FROM unnest(gl.locked) x), '{}'::jsonb),
           'brand_linked', g.brand,
           'exempt', r.demo_rule_exempt_at IS NOT NULL,
           'needs_linking', r.stage IN ('meeting', 'onboarded', 'live') AND NOT g.has_demo AND NOT g.brand_ok,
           'demo_cancelled', NOT g.has_demo AND NOT g.brand_ok AND EXISTS (
               SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                WHERE d.record_id = r.id AND k.status IN ('cancelled', 'declined'))))
       ELSE '{}'::jsonb END
    -- crm_4571_w6_json (20281130084571).
    || jsonb_build_object(
      'archived_at', r.archived_at, 'archived_by', r.archived_by, 'archived_reason', r.archived_reason,
      'merged_into', CASE WHEN r.merged_into_id IS NULL THEN NULL ELSE
        (SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM public.crm_records m WHERE m.id = r.merged_into_id) END,
      -- crm_4571_suggest_replied (20281130074571).
      'suggest_replied', CASE WHEN r.archived_at IS NULL AND r.deleted_at IS NULL
                                AND ((r.pipeline = 'hosts' AND r.stage IN ('prospect', 'contacted'))
                                     OR (r.pipeline = 'creators' AND r.stage IN ('identified', 'contacted')))
        THEN (SELECT jsonb_build_object('at', x.at, 'subject', x.subject, 'channel', x.channel)
                FROM (SELECT e.sent_at AS at, e.subject, 'email'::text AS channel
                        FROM public.crm_email_log e WHERE e.record_id = r.id AND e.direction = 'inbound'
                      UNION ALL
                      SELECT a.occurred_at, NULL, a.channel
                        FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'inbound') x
               WHERE x.at > COALESCE((SELECT max(a.occurred_at) FROM public.crm_activity a
                                       WHERE a.record_id = r.id AND a.kind = 'stage_move'), r.created_at)
               ORDER BY x.at DESC LIMIT 1) END,
      -- crm_4571_cadence (20281130084571).
      'cadence', CASE WHEN r.pipeline = 'hosts' AND r.archived_at IS NULL AND r.deleted_at IS NULL AND r.stage IN ('prospect', 'contacted')
        THEN jsonb_build_object(
          'round', cd.round, 'of', 6, 'rounds_done', cd.rounds,
          'calls', cd.calls, 'emails', cd.emails, 'emails_logged', cd.logged, 'email_days', cd.days,
          'has_phone', cd.phone, 'call_done', cd.calls >= cd.round, 'email_done', cd.emails >= cd.round, 'finished', cd.finished,
          'last_touch_on', cd.last_on, 'since', cfg.since,
          'steps', CASE WHEN cd.finished THEN jsonb_build_array('cadence finished')
                        ELSE jsonb_build_array(
                               CASE WHEN NOT cd.phone THEN 'no phone yet' WHEN cd.calls >= cd.round THEN 'call done' ELSE 'call to make' END,
                               CASE WHEN cd.emails >= cd.round THEN 'email done' ELSE 'email to send' END) END) END)
  FROM public.crm_records r
  CROSS JOIN cfg
  CROSS JOIN work wk
  CROSS JOIN names nm
  CROSS JOIN LATERAL (
    SELECT max(a.occurred_at) AS last_at, count(*) AS n
      FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch') ts
  LEFT JOIN LATERAL (
    SELECT a.occurred_at AS at, true AS found, a.actor_email, a.channel, a.direction, a.call_outcome
      FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'
     ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1) t ON true
  -- Demo gate inputs (hosts): crm_record_has_demo and the linked, live brand.
  CROSS JOIN LATERAL (
    SELECT h.has_demo, h.brand, (r.stage IN ('onboarded', 'live') AND h.brand) AS brand_ok
      FROM (SELECT r.pipeline = 'hosts' AND EXISTS (
                     SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                      WHERE d.record_id = r.id AND k.status IN ('booked', 'moved')) AS has_demo,
                   (r.brand_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.brands x WHERE x.id = r.brand_id AND x.deleted_at IS NULL)) AS brand) h) g
  -- crm_4571_stage_move_ok (20281130114571) for the three band stages.
  CROSS JOIN LATERAL (
    SELECT COALESCE(array_agg(u.t ORDER BY u.o), ARRAY[]::text[]) AS locked
      FROM unnest(ARRAY['meeting', 'onboarded', 'live']) WITH ORDINALITY u(t, o)
     WHERE r.pipeline = 'hosts'
       AND u.t IS DISTINCT FROM r.stage
       AND NOT (   (r.demo_rule_exempt_at IS NOT NULL AND r.stage IN ('meeting', 'onboarded', 'live'))
                OR g.has_demo
                OR (u.t IN ('onboarded', 'live') AND g.brand)
                OR COALESCE(r.stage IN ('meeting', 'onboarded', 'live') AND u.t <> 'meeting'
                            AND (cfg.pos->>u.t)::integer < (cfg.pos->>r.stage)::integer, false))) gl
  -- Cadence counts (only read for cards that show a cadence).
  CROSS JOIN LATERAL (
    SELECT c.calls, c.logged, c.days, c.phone, c.last_on, c.emails, c.rounds,
           LEAST(c.rounds + 1, 6) AS round,
           CASE WHEN c.phone THEN c.calls >= 6 AND c.emails >= 6 ELSE c.emails >= 6 END AS finished
      FROM (SELECT b.*, CASE WHEN b.phone THEN LEAST(b.calls, b.emails) ELSE b.emails END AS rounds
              FROM (SELECT a.*, GREATEST(a.logged, a.days) AS emails
                      FROM (SELECT
                         (SELECT count(*) FILTER (WHERE a.channel = 'phone')::integer
                            FROM public.crm_activity a
                           WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'outbound'
                             AND a.occurred_at >= (cfg.since::timestamp AT TIME ZONE 'UTC') AND a.stage_at IN ('prospect', 'contacted')) AS calls,
                         (SELECT count(*) FILTER (WHERE a.channel = 'email')::integer
                            FROM public.crm_activity a
                           WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'outbound'
                             AND a.occurred_at >= (cfg.since::timestamp AT TIME ZONE 'UTC') AND a.stage_at IN ('prospect', 'contacted')) AS logged,
                         (SELECT COALESCE(max(x.n), 0)::integer FROM (
                            SELECT e.matched_address, count(DISTINCT (e.sent_at AT TIME ZONE 'UTC')::date) AS n
                              FROM public.crm_email_log e
                             WHERE e.record_id = r.id AND e.direction = 'outbound' AND e.sent_at >= (cfg.since::timestamp AT TIME ZONE 'UTC')
                               AND e.stage_at IN ('prospect', 'contacted')
                             GROUP BY e.matched_address) x) AS days,
                         EXISTS (SELECT 1 FROM public.crm_record_identifiers i WHERE i.record_id = r.id AND i.kind = 'phone') AS phone,
                         (SELECT max((a.occurred_at AT TIME ZONE 'Africa/Lagos')::date)
                            FROM public.crm_activity a
                           WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'outbound'
                             AND a.occurred_at >= (cfg.since::timestamp AT TIME ZONE 'UTC')) AS last_on
                       WHERE r.pipeline = 'hosts' AND r.archived_at IS NULL AND r.deleted_at IS NULL
                         AND r.stage IN ('prospect', 'contacted')) a) b) c
     UNION ALL
    SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
     WHERE NOT (r.pipeline = 'hosts' AND r.archived_at IS NULL AND r.deleted_at IS NULL AND r.stage IN ('prospect', 'contacted'))) cd
  WHERE r.id = ANY (p_ids)
$function$;
COMMENT ON FUNCTION public.crm_4571_records_json(uuid[]) IS
  'Issue #4571. The board JSON for many host or creator cards in one query: the same keys and values as crm_record_json(card) for each. Internal: crm_records_list and crm_records_archived_list.';
REVOKE ALL ON FUNCTION public.crm_4571_records_json(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_records_json(uuid[]) TO service_role;

-- 4. From 20281130064571 (crm_records_list). Same answer, one pass.
-- INVARIANT crm-archived-not-on-board (test
-- issue_4571_w6a_archive_merge.implementor.pg17.test.sql): keep both
-- archived_at IS NULL lines.
CREATE OR REPLACE FUNCTION public.crm_records_list(p_pipeline text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v       record;
  v_total bigint;
  v_ids   uuid[];
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NULL;
  SELECT array_agg(x.id) INTO v_ids
  FROM (SELECT c.id FROM public.crm_records c
         WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NULL
         ORDER BY c.updated_at DESC, c.id
         LIMIT 5000) x;
  SELECT COALESCE(jsonb_agg(m.j ORDER BY c.updated_at DESC, c.id), '[]'::jsonb) INTO v_rows
    FROM public.crm_4571_records_json(COALESCE(v_ids, ARRAY[]::uuid[])) m
    JOIN public.crm_records c ON c.id = m.id;
  RETURN jsonb_build_object('pipeline', p_pipeline, 'records', v_rows, 'truncated', v_total > 5000,
    'archived_count', (SELECT count(*) FROM public.crm_records c
                        WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.crm_records_list(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_records_list(text) TO authenticated, service_role;

-- From 20281130064571 (crm_records_archived_list). Same answer, one pass.
CREATE OR REPLACE FUNCTION public.crm_records_archived_list(p_pipeline text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_total bigint; v_ids uuid[]; v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL;
  SELECT array_agg(x.id) INTO v_ids
  FROM (SELECT c.id FROM public.crm_records c
         WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL
         ORDER BY c.archived_at DESC, c.id LIMIT 2000) x;
  SELECT COALESCE(jsonb_agg(m.j ORDER BY c.archived_at DESC, c.id), '[]'::jsonb) INTO v_rows
    FROM public.crm_4571_records_json(COALESCE(v_ids, ARRAY[]::uuid[])) m
    JOIN public.crm_records c ON c.id = m.id;
  RETURN jsonb_build_object('pipeline', p_pipeline, 'records', v_rows, 'total', v_total, 'truncated', v_total > 2000);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_records_archived_list(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_records_archived_list(text) TO authenticated, service_role;
