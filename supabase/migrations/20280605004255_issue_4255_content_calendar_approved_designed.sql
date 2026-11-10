-- toward #4255: content calendar stages follow Seth's model (10 Nov 2026).
--   Idea -> Writing -> Designed -> Approved -> Scheduled -> Published.
-- Stored stage keys stay ('design', 'review') so the Admin, the team agent
-- connector and every existing row keep working; only the meaning and the
-- gates change:
--   * Writing -> Designed needs approved copy AND a Drive link: a card is
--     Designed only once its design exists in Drive (folders are never made
--     ahead of the design).
--   * Designed -> Approved records the go (approve_design): Approved means
--     Ray and Abimbola have given the go for the post.
--   * Approved -> Scheduled needs a publish time and at least one channel.
-- The calendar read (ops_calendar 'content' and 'posts_undated', used by the
-- list_calendar agent tool) shows only Approved, Scheduled and Published
-- posts; Idea, Writing and Designed live on the Board only.
-- Conflicts stay 22023 (input) / PT409 (stale write); never 40001.

CREATE OR REPLACE FUNCTION public.content_calendar_move(p_id uuid, p_to text, p_expected_revision bigint, p_approve_copy boolean DEFAULT false, p_approve_design boolean DEFAULT false, p_publish_without_link boolean DEFAULT false, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; v_item public.content_calendar_items; v_replay jsonb; v_out jsonb; v_audit uuid;
  v_from_idx integer; v_to_idx integer; v_now timestamptz := clock_timestamp();
  v_previous_copy_by text; v_previous_copy_at timestamptz;
  v_previous_design_by text; v_previous_design_at timestamptz; v_previous_without_link boolean;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email,p_request_key,'move',jsonb_build_object(
    'id',p_id,'to',p_to,'expected_revision',p_expected_revision,'approve_copy',COALESCE(p_approve_copy,false),
    'approve_design',COALESCE(p_approve_design,false),'publish_without_link',COALESCE(p_publish_without_link,false)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409'; END IF;
  SELECT ord INTO v_from_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=v_item.stage;
  SELECT ord INTO v_to_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=p_to;
  IF v_to_idx IS NULL THEN RAISE EXCEPTION 'invalid_stage: Use Idea, Writing, Designed (design), Approved (review), Scheduled or Published.' USING ERRCODE='22023'; END IF;
  IF v_to_idx=v_from_idx THEN RAISE EXCEPTION 'no_change: That card is already in this stage.' USING ERRCODE='22023'; END IF;
  IF v_to_idx > v_from_idx + 1 THEN RAISE EXCEPTION 'stage_order: Move forward one stage at a time.' USING ERRCODE='22023'; END IF;
  v_previous_copy_by:=v_item.copy_approved_by; v_previous_copy_at:=v_item.copy_approved_at;
  v_previous_design_by:=v_item.design_approved_by; v_previous_design_at:=v_item.design_approved_at;
  v_previous_without_link:=v_item.published_without_link;
  IF v_item.stage='writing' AND p_to='design' THEN
    IF NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL THEN RAISE EXCEPTION 'copy_required: Add copy before Designed.' USING ERRCODE='22023'; END IF;
    IF NULLIF(btrim(COALESCE(v_item.drive_url,'')),'') IS NULL THEN RAISE EXCEPTION 'drive_required: Add the Drive link to the finished design before Designed.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_copy,false) THEN RAISE EXCEPTION 'copy_approval_required: Approve the copy before Designed.' USING ERRCODE='22023'; END IF;
    v_item.copy_approved_by:=v.actor_email; v_item.copy_approved_at:=v_now;
  ELSIF v_item.stage='design' AND p_to='review' THEN
    IF NULLIF(btrim(COALESCE(v_item.drive_url,'')),'') IS NULL THEN RAISE EXCEPTION 'drive_required: Add the Drive link to the finished design before Approved.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_design,false) THEN RAISE EXCEPTION 'design_approval_required: Record the go from Ray and Abimbola before Approved.' USING ERRCODE='22023'; END IF;
    v_item.design_approved_by:=v.actor_email; v_item.design_approved_at:=v_now;
  ELSIF v_item.stage='review' AND p_to='scheduled' THEN
    IF v_item.publish_at IS NULL OR cardinality(v_item.channels)=0 THEN RAISE EXCEPTION 'schedule_required: Add a publish date, time and at least one channel.' USING ERRCODE='22023'; END IF;
    IF v_item.design_approved_at IS NULL THEN RAISE EXCEPTION 'design_approval_required: Record the go from Ray and Abimbola before Scheduled.' USING ERRCODE='22023'; END IF;
  ELSIF v_item.stage='scheduled' AND p_to='published' AND v_item.live_url IS NULL AND NOT COALESCE(p_publish_without_link,false) THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  IF v_to_idx<v_from_idx THEN
    IF v_to_idx<=2 THEN
      v_item.copy_approved_by:=NULL; v_item.copy_approved_at:=NULL;
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    ELSIF v_to_idx<=3 THEN
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    END IF;
  END IF;
  v_item.published_without_link := p_to='published' AND v_item.live_url IS NULL AND COALESCE(p_publish_without_link,false);
  UPDATE public.content_calendar_items SET stage=p_to,
    copy_approved_by=v_item.copy_approved_by,copy_approved_at=v_item.copy_approved_at,
    design_approved_by=v_item.design_approved_by,design_approved_at=v_item.design_approved_at,
    published_without_link=v_item.published_without_link,
    revision=revision+1,updated_by=v.actor_email,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.stage_move',jsonb_build_object(
    'previous_stage',(SELECT stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE ord=v_from_idx),
    'next_stage',p_to,'from_revision',p_expected_revision,'to_revision',v_item.revision,
    'previous_copy_approved_by',v_previous_copy_by,'previous_copy_approved_at',v_previous_copy_at,
    'previous_design_approved_by',v_previous_design_by,'previous_design_approved_at',v_previous_design_at,
    'previous_published_without_link',v_previous_without_link,
    'copy_approved_by',v_item.copy_approved_by,'copy_approved_at',v_item.copy_approved_at,
    'design_approved_by',v_item.design_approved_by,'design_approved_at',v_item.design_approved_at,
    'published_without_link',v_item.published_without_link));
  v_out := jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'move',v_out);
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ops_calendar(p_from date, p_to date, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); v_base jsonb; v_expected jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_window_check(p_from, p_to);
  -- Events from the window start to 28 days after its end: go-live deadlines
  -- in the window belong to events up to 28 days later.
  SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) INTO v_base FROM public.ops_events_in_window(p_from, p_to + 28, v_today) a;
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'expected_on', r->>'title'), '[]'::jsonb) INTO v_expected FROM (
    SELECT public.ops_expected_json(x, v_today) || jsonb_build_object('occurrence', false) AS r
      FROM public.ops_expected_events x
     WHERE x.status = 'open' AND x.repeats = 'none' AND x.expected_on BETWEEN p_from AND p_to
    UNION ALL
    SELECT public.ops_expected_json(x, v_today)
           || jsonb_build_object('occurrence', true, 'series_id', x.id, 'expected_on', o->'on', 'next_on', o->'on',
                                 'state', public.ops_plain_state(public.ops_expected_anchor(x, (o->>'on')::date), v_today),
                                 'runway', public.ops_runway(false, NULL, ((o->>'on')::date::timestamp AT TIME ZONE 'UTC'), 'UTC', v_today))
      FROM public.ops_expected_events x
     CROSS JOIN LATERAL jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
     WHERE x.status = 'open' AND x.repeats <> 'none' AND NOT (o->>'live')::boolean
       AND (o->>'on')::date BETWEEN p_from AND p_to) s;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'today', v_today,
    'events', COALESCE((SELECT jsonb_agg(public.ops_calendar_event_json(a) || jsonb_build_object('state', a->'state')
                                         ORDER BY a->>'start_at', a->>'title')
                          FROM jsonb_array_elements(v_base) a WHERE (a->>'start_on')::date BETWEEN p_from AND p_to), '[]'::jsonb),
    'expected', v_expected,
    'deadlines', COALESCE((SELECT jsonb_agg(d.r ORDER BY d.r->>'date', d.r->>'label') FROM (
        SELECT jsonb_build_object('date', a->'runway'->'go_live_by', 'anchor_kind', 'event', 'anchor_id', a->'id',
                 'title', a->'title', 'label', 'Go live: ' || COALESCE(public.ops_host_json((a->>'record_id')::uuid)->>'name', a->>'title')) AS r
          FROM jsonb_array_elements(v_base) a
         WHERE NOT COALESCE((a->>'is_public')::boolean, false)
           AND (a->'runway'->>'go_live_by')::date BETWEEN p_from AND p_to
        UNION ALL
        SELECT jsonb_build_object('date', x.expected_on - 28, 'anchor_kind', 'expected', 'anchor_id', x.id,
                 'title', x.title, 'label', 'Go live: ' || COALESCE(public.ops_host_json(x.record_id)->>'name', x.title))
          FROM public.ops_expected_events x
         WHERE x.status = 'open' AND x.repeats = 'none' AND x.expected_on - 28 BETWEEN p_from AND p_to) d), '[]'::jsonb),
    'promotions', public.ops_promotions(p_from, p_to),
    -- #4255: only Approved (review), Scheduled and Published posts are on the calendar.
    'content', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'stage', i.stage,
                            'publish_at', i.publish_at, 'channels', to_jsonb(i.channels),
                            -- #4270 W3: the brand the post is for
                            'brand_id', i.brand_id, 'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = i.brand_id)) ORDER BY i.publish_at, i.title)
                           FROM public.content_calendar_items i
                          WHERE i.deleted_at IS NULL AND i.stage IN ('review', 'scheduled', 'published')
                            AND i.publish_at >= (p_from::timestamp AT TIME ZONE 'UTC')
                            AND i.publish_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')), '[]'::jsonb),
    'posts_undated', (SELECT count(*) FROM public.content_calendar_items i
                       WHERE i.deleted_at IS NULL AND i.publish_at IS NULL AND i.stage IN ('review', 'scheduled', 'published')));
END;
$function$;

-- The approval now belongs to Approved (review), so moving a card back to
-- Approved (from Scheduled or Published) keeps it; moving back to Designed or
-- earlier clears it. Everything else in the guard is unchanged.
CREATE OR REPLACE FUNCTION public.content_calendar_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_old_stage integer; v_new_stage integer;
BEGIN
  IF TG_OP='UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    SELECT ord INTO v_old_stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=OLD.stage;
    SELECT ord INTO v_new_stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=NEW.stage;
    IF v_new_stage < v_old_stage THEN
      IF v_new_stage <= 2 THEN
        NEW.copy_approved_by:=NULL; NEW.copy_approved_at:=NULL;
        NEW.design_approved_by:=NULL; NEW.design_approved_at:=NULL;
      ELSIF v_new_stage <= 3 THEN
        NEW.design_approved_by:=NULL; NEW.design_approved_at:=NULL;
      END IF;
      NEW.published_without_link:=false;
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.stage NOT IN ('idea','writing') AND NEW.copy_text IS DISTINCT FROM OLD.copy_text THEN
    RAISE EXCEPTION 'copy_locked: Copy is read-only after Writing. Move the card back to Writing to revise it.' USING ERRCODE='22023';
  END IF;
  IF NEW.stage NOT IN ('idea','writing') AND
     (NULLIF(btrim(COALESCE(NEW.copy_text,'')),'') IS NULL OR NEW.copy_approved_by IS NULL OR NEW.copy_approved_at IS NULL) THEN
    RAISE EXCEPTION 'copy_approval_required: Designed and later stages require approved copy.' USING ERRCODE='22023';
  END IF;
  IF NEW.stage IN ('scheduled','published') AND
     (NEW.design_approved_by IS NULL OR NEW.design_approved_at IS NULL OR NEW.publish_at IS NULL OR cardinality(NEW.channels)=0) THEN
    RAISE EXCEPTION 'schedule_required: Scheduled and Published require the go from Ray and Abimbola, a publish date and at least one channel.' USING ERRCODE='22023';
  END IF;
  IF NEW.stage='published' AND NEW.live_url IS NULL AND NOT NEW.published_without_link THEN
    RAISE EXCEPTION 'live_link_required: Published needs a live link or the explicit without-link decision.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$function$;
