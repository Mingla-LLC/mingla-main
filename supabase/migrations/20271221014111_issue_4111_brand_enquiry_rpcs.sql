-- #4111 Wave A — Customer enquiry RPCs.
--
-- Client RPCs (authenticated):
--   brand_enquiry_my_plans(p_brand_id)                      -> TABLE
--   brand_enquiry_send(p_brand_id,p_entry,p_context_kind,p_context_id,p_reason,p_body,p_source='explorer'|'web') -> jsonb
--   list_brand_enquiries(p_brand_id,p_status_filter)        -> jsonb {items,counts}
--   brand_enquiry_get_thread(p_enquiry_id,p_limit)          -> jsonb
--   brand_enquiry_reply(p_enquiry_id,p_body)                -> uuid   (team)
--   brand_enquiry_guest_reply(p_enquiry_id,p_body)          -> uuid   (Explorer guest)
--   brand_enquiry_set_status(p_enquiry_id,p_action)         -> text   ('resolve'|'reopen')
--   brand_enquiry_block_sender(p_enquiry_id)                -> boolean
--   brand_enquiry_report(p_enquiry_id,p_reason)             -> boolean (team or guest)
--   claim_brand_enquiries_for_user()                        -> integer
--   admin_list_reported_enquiries(p_limit)                  -> jsonb  (staff)
--   admin_enquiry_dismiss_report(p_enquiry_id)              -> boolean (staff)
--   admin_enquiry_block_everywhere(p_enquiry_id)            -> boolean (staff)
-- Public (anon): brand_enquiry_public_profile(p_brand_id)   -> jsonb
-- Service role (edge functions only): issue_4111_create_web_enquiry,
--   issue_4111_thread_by_token, issue_4111_guest_post_by_token,
--   issue_4111_reissue_link, issue_4111_claim_guest_digests,
--   issue_4111_complete_guest_digest.
--
-- Status machine: new -> replied (brand message); replied -> waiting (guest
-- message); resolved -> waiting (guest message); any -> resolved (brand
-- action); idle 30 days -> resolved (cron, next migration).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- Helpers (no client grants).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4111_email_hash(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
    ELSE encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex') END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_email_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_email_hash(text) TO service_role;

-- The reason catalog. Keys are shared with the sheet topic builder (Wave C).
CREATE OR REPLACE FUNCTION public.issue_4111_reason_label(p_reason text, p_brand_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_reason
    WHEN 'change_transfer' THEN 'Change or transfer'
    WHEN 'refund_cancel' THEN 'Refund or cancel'
    WHEN 'cant_find_tickets' THEN 'Can''t find my tickets'
    WHEN 'access_needs' THEN 'Access needs'
    WHEN 'something_else' THEN 'Something else'
    WHEN 'change_time_party' THEN 'Change time or party size'
    WHEN 'cancel' THEN 'Cancel'
    WHEN 'running_late' THEN 'Running late'
    WHEN 'missing_wrong_item' THEN 'Missing or wrong item'
    WHEN 'refund' THEN 'Refund'
    WHEN 'bring_guest' THEN 'Bring a guest'
    WHEN 'cant_make_it' THEN 'Can''t make it'
    WHEN 'question_before_booking' THEN 'Question before I book'
    WHEN 'group_booking' THEN 'Group booking'
    WHEN 'dates_times' THEN 'Dates and times'
    WHEN 'lost_something' THEN 'Lost something'
    WHEN 'feedback' THEN 'Feedback'
    WHEN 'photos_recordings' THEN 'Photos or recordings'
    WHEN 'itinerary' THEN 'Itinerary'
    WHEN 'payment_deposit' THEN 'Payment or deposit'
    WHEN 'group_custom_trip' THEN 'Group or custom trip'
    WHEN 'table_reservation' THEN 'Table or reservation'
    WHEN 'private_hire' THEN 'Private hire or big group'
    WHEN 'food_order' THEN 'Food order'
    WHEN 'general_question' THEN 'General question'
    WHEN 'work_with' THEN left('Work with ' || COALESCE(NULLIF(btrim(p_brand_name), ''), 'us'), 120)
    WHEN 'other' THEN 'Other'
    WHEN 'website_contact' THEN 'Website message'
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_reason_label(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_reason_label(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4111_is_blocked(
  p_brand_id uuid, p_email_hash text, p_user_id uuid, p_ip_hash text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.brand_enquiry_blocks block
    WHERE (block.brand_id IS NULL OR block.brand_id = p_brand_id)
      AND (
        (p_email_hash IS NOT NULL AND block.email_hash = p_email_hash)
        OR (p_user_id IS NOT NULL AND block.user_id = p_user_id)
        OR (p_ip_hash IS NOT NULL AND block.ip_hash = p_ip_hash)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_is_blocked(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_is_blocked(uuid, text, uuid, text) TO service_role;

-- Durable counters reuse the #3682 bucket table. Returns true when limited.
CREATE OR REPLACE FUNCTION public.issue_4111_enquiry_rate_limited(
  p_brand_id uuid, p_email_hash text, p_ip_hash text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_ip_hash IS NOT NULL
     AND public.biz_web_follow_rate_hit('enq:ip:' || p_ip_hash, 3600, 5) THEN
    RETURN true;
  END IF;
  IF p_email_hash IS NULL THEN RETURN true; END IF;
  IF public.biz_web_follow_rate_hit('enq:eb:' || p_brand_id::text || ':' || p_email_hash, 86400, 3) THEN
    RETURN true;
  END IF;
  IF public.biz_web_follow_rate_hit('enq:e:' || p_email_hash, 86400, 10) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_enquiry_rate_limited(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_enquiry_rate_limited(uuid, text, text) TO service_role;

-- What a context is, for this brand. p_owner (when not NULL) must own the
-- order / RSVP / reservation / stay / venue order. NULL result = not valid.
CREATE OR REPLACE FUNCTION public.issue_4111_context_facts(
  p_brand_id uuid, p_kind text, p_id uuid, p_owner uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_kind = 'none' THEN
    RETURN jsonb_build_object('kind', 'none');
  ELSIF p_kind = 'order' THEN
    SELECT jsonb_build_object(
      'kind','order','id',o.id,'title',e.title,'offering_kind',e.event_type,
      'starts_at',COALESCE(o.booked_start_at, chosen.start_at, master.start_at),
      'summary',CASE WHEN COALESCE(qty.n,0)=1 THEN '1 ticket'
        WHEN COALESCE(qty.n,0)>1 THEN qty.n::text || ' tickets' ELSE 'Booking' END,
      'payment_status',o.payment_status,'event_id',e.id)
    INTO v
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id AND e.brand_id = p_brand_id
    LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
    LEFT JOIN public.event_dates master ON master.event_id = e.id AND master.is_master
    LEFT JOIN LATERAL (SELECT sum(li.quantity)::integer n FROM public.order_line_items li WHERE li.order_id = o.id) qty ON true
    WHERE o.id = p_id
      AND (p_owner IS NULL OR o.buyer_user_id = p_owner OR o.purchased_by_user_id = p_owner)
      AND o.payment_status <> 'failed'
    LIMIT 1;
  ELSIF p_kind = 'rsvp' THEN
    SELECT jsonb_build_object(
      'kind','rsvp','id',r.id,'title',e.title,'offering_kind',e.event_type,
      'starts_at',master.start_at,
      'summary',CASE WHEN COALESCE(r.plus_count,0)>0 THEN 'RSVP · you + ' || r.plus_count ELSE 'RSVP' END,
      'event_id',e.id)
    INTO v
    FROM public.event_rsvps r
    JOIN public.events e ON e.id = r.event_id AND e.brand_id = p_brand_id
    LEFT JOIN public.event_dates master ON master.event_id = e.id AND master.is_master
    WHERE r.id = p_id AND (p_owner IS NULL OR r.user_id = p_owner)
    LIMIT 1;
  ELSIF p_kind = 'reservation' THEN
    SELECT jsonb_build_object(
      'kind','reservation','id',r.id,'title',COALESCE(vl.name,'Table reservation'),
      'offering_kind','venue','starts_at',r.reserved_for,
      'summary','Table for ' || r.party_size,'status',r.status,'venue_id',r.venue_id)
    INTO v
    FROM public.reservations r
    LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
    WHERE r.id = p_id AND r.brand_id = p_brand_id
      AND (p_owner IS NULL OR r.consumer_user_id = p_owner OR r.booked_by_user_id = p_owner)
    LIMIT 1;
  ELSIF p_kind = 'stay' THEN
    SELECT jsonb_build_object(
      'kind','stay','id',g.id,
      'title',COALESCE(NULLIF(btrim(line.offering_snapshot->>'name'),''), so.name, 'Stay'),
      'offering_kind','stay','starts_at',(line.room_check_in)::timestamptz,
      'summary','Stay · ' || g.public_reference,'status',g.state,'venue_id',g.venue_id)
    INTO v
    FROM public.stay_reservation_groups g
    LEFT JOIN LATERAL (
      SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = g.id
      ORDER BY l.room_check_in NULLS LAST, l.created_at LIMIT 1
    ) line ON true
    LEFT JOIN public.stay_offerings so ON so.id = line.offering_id
    WHERE g.id = p_id AND g.brand_id = p_brand_id
      AND (p_owner IS NULL OR g.user_id = p_owner OR g.booked_by_user_id = p_owner)
    LIMIT 1;
  ELSIF p_kind = 'venue_order' THEN
    SELECT jsonb_build_object(
      'kind','venue_order','id',vo.id,
      'title',COALESCE(vl.name,'Food order') || CASE WHEN vo.pickup_code IS NOT NULL THEN ' · ' || vo.pickup_code ELSE '' END,
      'offering_kind','venue','starts_at',vo.created_at,
      'summary',CASE WHEN COALESCE(items.n,0)=1 THEN '1 item' ELSE COALESCE(items.n,0)::text || ' items' END,
      'payment_status',vo.payment_status,'fulfillment_status',vo.fulfillment_status,'venue_id',vo.venue_id)
    INTO v
    FROM public.venue_orders vo
    LEFT JOIN public.venue_listings vl ON vl.id = vo.venue_id
    LEFT JOIN LATERAL (SELECT sum(i.quantity)::integer n FROM public.venue_order_items i WHERE i.venue_order_id = vo.id) items ON true
    WHERE vo.id = p_id AND vo.brand_id = p_brand_id
      AND (p_owner IS NULL OR vo.buyer_user_id = p_owner)
    LIMIT 1;
  ELSIF p_kind = 'offering' THEN
    SELECT jsonb_build_object(
      'kind','offering','id',e.id,'title',e.title,'offering_kind',COALESCE(e.event_type,'event'),
      'starts_at',master.start_at,'summary',NULL)
    INTO v
    FROM public.events e
    LEFT JOIN public.event_dates master ON master.event_id = e.id AND master.is_master
    WHERE e.id = p_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL AND e.status <> 'draft'
    LIMIT 1;
    IF v IS NULL THEN
      SELECT jsonb_build_object(
        'kind','offering','id',so.id,'title',so.name,'offering_kind','stay',
        'starts_at',NULL,'summary',NULL)
      INTO v
      FROM public.stay_offerings so
      WHERE so.id = p_id AND so.brand_id = p_brand_id AND so.archived_at IS NULL
      LIMIT 1;
    END IF;
  ELSIF p_kind = 'venue' THEN
    SELECT jsonb_build_object(
      'kind','venue','id',vl.id,'title',vl.name,'offering_kind','venue','starts_at',NULL,'summary',vl.address)
    INTO v
    FROM public.venue_listings vl
    WHERE vl.id = p_id AND vl.brand_id = p_brand_id
    LIMIT 1;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_context_facts(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_context_facts(uuid, text, uuid, uuid) TO service_role;

-- Team push / in-app fan-out for a guest message. Eligible (non-scanner)
-- members who muted the brand's official Brand group are skipped.
CREATE OR REPLACE FUNCTION public.issue_4111_enqueue_team_notice(
  p_enquiry_id uuid, p_category text, p_message_id uuid, p_body text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enquiry public.brand_enquiries%ROWTYPE;
  v_brand_name text;
  v_group uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_enquiry FROM public.brand_enquiries WHERE id = p_enquiry_id;
  IF NOT FOUND OR v_enquiry.spam_flag THEN RETURN 0; END IF;
  SELECT name INTO v_brand_name FROM public.brands WHERE id = v_enquiry.brand_id;
  SELECT c.id INTO v_group FROM public.conversations c
  WHERE c.linked_entity_type = 'brand' AND c.brand_id = v_enquiry.brand_id;

  INSERT INTO public.notification_outbox(
    category_key, user_id, brand_id, country_code, payload, idempotency_key, status
  )
  SELECT p_category, member.user_id, v_enquiry.brand_id, NULL,
    jsonb_build_object(
      'enquiry_id', v_enquiry.id,
      'conversation_id', v_enquiry.conversation_id,
      'message_id', p_message_id,
      'brand_id', v_enquiry.brand_id,
      'brand_name', v_brand_name,
      'guest_name', v_enquiry.guest_name,
      'topic_label', v_enquiry.topic_label,
      'body', left(btrim(COALESCE(p_body, '')), 180),
      'deep_link', 'mingla-business://messages/' || v_enquiry.conversation_id::text
    ),
    p_category || ':' || p_message_id::text || ':' || member.user_id::text,
    'pending'
  FROM (
    SELECT DISTINCT m.user_id FROM public.brand_team_members m
    WHERE m.brand_id = v_enquiry.brand_id
      AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL AND m.role <> 'scanner'
  ) member
  LEFT JOIN public.brand_group_reads reads
    ON reads.conversation_id = v_group AND reads.user_id = member.user_id
  WHERE COALESCE(reads.muted, false) IS NOT TRUE
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_enqueue_team_notice(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_enqueue_team_notice(uuid, text, uuid, text) TO service_role;

-- The one place an enquiry is created. Every caller has already decided who
-- the guest is and validated the context.
CREATE OR REPLACE FUNCTION public.issue_4111_open_enquiry(
  p_brand_id uuid,
  p_source text,
  p_origin text,
  p_entry text,
  p_context_kind text,
  p_context_id uuid,
  p_offering_kind text,
  p_reason text,
  p_body text,
  p_guest_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_ok_to_call boolean,
  p_email_confirmed boolean,
  p_spam_flag boolean,
  p_moderation_categories text[],
  p_disclosure_text text,
  p_disclosure_version text,
  p_ip_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_name text := btrim(COALESCE(p_guest_name, ''));
  v_label text;
  v_conversation uuid;
  v_enquiry uuid;
  v_message uuid;
  v_group uuid;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.issue_4111_brand_takes_enquiries(p_brand_id) THEN
    RAISE EXCEPTION 'enquiries_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_body) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  v_label := public.issue_4111_reason_label(p_reason, v_brand.name);
  IF v_label IS NULL THEN RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.conversations(
    type, linked_entity_type, brand_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', 'brand_enquiry', p_brand_id, left(v_brand.name || ' · ' || v_name, 200),
    p_guest_user_id, true, false
  ) RETURNING id INTO v_conversation;

  IF p_guest_user_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conversation, p_guest_user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO public.brand_enquiries(
    brand_id, conversation_id, source, origin, entry, context_kind, context_id,
    offering_kind, reason, topic_label, guest_user_id, guest_name, guest_email,
    guest_email_confirmed_at, guest_phone_e164, ok_to_call, disclosure_text,
    disclosure_version, ip_hash, spam_flag, moderation_categories
  ) VALUES (
    p_brand_id, v_conversation, p_source, NULLIF(btrim(COALESCE(p_origin, '')), ''), p_entry,
    p_context_kind, p_context_id, p_offering_kind, p_reason, v_label, p_guest_user_id,
    v_name, lower(btrim(p_guest_email)),
    CASE WHEN p_email_confirmed THEN now() END,
    NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
    COALESCE(p_ok_to_call, false) AND NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL,
    p_disclosure_text, p_disclosure_version, p_ip_hash,
    COALESCE(p_spam_flag, false), COALESCE(p_moderation_categories, '{}'::text[])
  ) RETURNING id INTO v_enquiry;

  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot, created_at
  ) VALUES (
    v_conversation, p_guest_user_id, v_body, 'text', 'guest', v_name, clock_timestamp()
  ) RETURNING id INTO v_message;

  -- One system card in the team's own Brand group. It is a plain insert, not
  -- issue_3720_send_brand_group_message, so the Brand-group push fan-out does
  -- not fire: the enquiry notice below is the notification.
  IF NOT COALESCE(p_spam_flag, false) THEN
    SELECT c.id INTO v_group FROM public.conversations c
    WHERE c.linked_entity_type = 'brand' AND c.brand_id = p_brand_id;
    IF v_group IS NULL THEN
      v_group := public.issue_3720_ensure_official_brand_group(p_brand_id);
    END IF;
    IF v_group IS NOT NULL THEN
      INSERT INTO public.messages(
        conversation_id, sender_id, content, message_type, sender_kind,
        sender_display_name_snapshot, card_payload, created_at
      ) VALUES (
        v_group, NULL, left('New enquiry from ' || v_name || ' · ' || v_label, 300),
        'brand_enquiry_card', 'system', 'Customer enquiry',
        jsonb_build_object('kind', 'brand_enquiry_card', 'enquiry_id', v_enquiry,
          'guest_name', v_name, 'topic_label', v_label),
        clock_timestamp()
      );
    END IF;
    PERFORM public.issue_4111_enqueue_team_notice(v_enquiry, 'business.brand_enquiry_new', v_message, v_body);
  END IF;

  RETURN jsonb_build_object(
    'enquiry_id', v_enquiry, 'conversation_id', v_conversation,
    'brand_id', p_brand_id, 'brand_name', v_brand.name, 'brand_slug', v_brand.slug,
    'topic_label', v_label
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_open_enquiry(uuid,text,text,text,text,uuid,text,text,text,uuid,text,text,text,boolean,boolean,boolean,text[],text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_open_enquiry(uuid,text,text,text,text,uuid,text,text,text,uuid,text,text,text,boolean,boolean,boolean,text[],text,text,text)
  TO service_role;

-- A guest wrote again (web token or Explorer).
CREATE OR REPLACE FUNCTION public.issue_4111_append_guest_message(
  p_enquiry_id uuid, p_body text, p_sender_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enquiry public.brand_enquiries%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_message uuid;
BEGIN
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_enquiry FROM public.brand_enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501'; END IF;
  IF public.issue_4111_is_blocked(v_enquiry.brand_id, public.issue_4111_email_hash(v_enquiry.guest_email),
       v_enquiry.guest_user_id, NULL) THEN
    RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot, created_at
  ) VALUES (
    v_enquiry.conversation_id, p_sender_user_id, v_body, 'text', 'guest', v_enquiry.guest_name, clock_timestamp()
  ) RETURNING id INTO v_message;

  UPDATE public.brand_enquiries
  SET status = CASE WHEN status = 'new' THEN 'new' ELSE 'waiting' END,
      resolved_at = NULL, resolved_by = NULL,
      last_guest_at = clock_timestamp(), updated_at = now()
  WHERE id = p_enquiry_id;

  PERFORM public.issue_4111_enqueue_team_notice(p_enquiry_id, 'business.brand_enquiry_message', v_message, v_body);
  RETURN v_message;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_append_guest_message(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_append_guest_message(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4111_require_team(p_enquiry_id uuid)
RETURNS public.brand_enquiries
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v public.brand_enquiries%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.brand_enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4111_is_enquiry_team_member(v.brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_require_team(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_require_team(uuid) TO service_role;

-- Thread JSON. p_viewer: 'team' sees member names + guest contact; 'guest'
-- sees the guest-facing "{first} at {Brand}" snapshot and no team identity.
CREATE OR REPLACE FUNCTION public.issue_4111_thread_json(
  p_enquiry_id uuid, p_viewer text, p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH e AS (
    SELECT q.*, b.name brand_name, b.slug brand_slug, b.profile_photo_url brand_logo,
      b.theme_color brand_accent
    FROM public.brand_enquiries q JOIN public.brands b ON b.id = q.brand_id
    WHERE q.id = p_enquiry_id
  ), msgs AS (
    SELECT m.id, m.created_at, m.content, m.sender_kind, m.sender_id,
      m.sender_display_name_snapshot,
      COALESCE(NULLIF(btrim(p.display_name),''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)),''),
        NULLIF(btrim(m.sender_display_name_snapshot),''), 'Team member') member_name
    FROM e
    JOIN public.messages m ON m.conversation_id = e.conversation_id AND m.deleted_at IS NULL
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  )
  SELECT jsonb_build_object(
    'enquiry', jsonb_build_object(
      'id', e.id, 'conversation_id', e.conversation_id, 'brand_id', e.brand_id,
      'brand_name', e.brand_name, 'brand_slug', e.brand_slug, 'brand_logo_url', e.brand_logo,
      'brand_accent', e.brand_accent, 'status', e.status, 'topic_label', e.topic_label,
      'reason', e.reason, 'source', e.source,
      'channel_label', CASE e.source WHEN 'site' THEN 'Website' WHEN 'web' THEN 'Web' ELSE 'App' END,
      'entry', e.entry, 'context_kind', e.context_kind, 'context_id', e.context_id,
      'offering_kind', e.offering_kind,
      'context', CASE WHEN e.context_kind <> 'none'
        THEN public.issue_4111_context_facts(e.brand_id, e.context_kind, e.context_id, NULL) END,
      'created_at', e.created_at, 'resolved_at', e.resolved_at,
      'spam_flag', CASE WHEN p_viewer = 'team' THEN e.spam_flag ELSE false END,
      'reported', e.reported_at IS NOT NULL AND e.report_dismissed_at IS NULL,
      'guest', CASE WHEN p_viewer = 'team' THEN jsonb_build_object(
          'name', e.guest_name, 'email', e.guest_email,
          'email_confirmed', e.guest_email_confirmed_at IS NOT NULL,
          'phone', CASE WHEN e.ok_to_call THEN e.guest_phone_e164 END,
          'ok_to_call', e.ok_to_call, 'has_account', e.guest_user_id IS NOT NULL)
        ELSE jsonb_build_object('name', e.guest_name) END
    ),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', msgs.id,
        'who', COALESCE(msgs.sender_kind, 'brand'),
        'display', CASE
          WHEN msgs.sender_kind = 'guest' THEN e.guest_name
          WHEN p_viewer = 'team' AND msgs.sender_kind = 'brand' THEN msgs.member_name
          ELSE COALESCE(NULLIF(btrim(msgs.sender_display_name_snapshot), ''), e.brand_name) END,
        'body', msgs.content,
        'at', msgs.created_at,
        'mine', CASE WHEN p_viewer = 'team' THEN msgs.sender_id IS NOT DISTINCT FROM auth.uid() AND msgs.sender_kind = 'brand'
          ELSE msgs.sender_kind = 'guest' END
      ) ORDER BY msgs.created_at, msgs.id) FROM msgs), '[]'::jsonb)
  )
  FROM e;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_thread_json(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_thread_json(uuid, text, integer) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Explorer / signed-in web.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_enquiry_my_plans(p_brand_id uuid)
RETURNS TABLE(
  kind text, id uuid, title text, starts_at timestamptz, summary text,
  is_upcoming boolean, can_cancel boolean, can_cancel_url text, can_request_refund boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH plans AS (
    SELECT 'order'::text k, o.id pid, e.title t,
      COALESCE(o.booked_start_at, chosen.start_at, master.start_at) s,
      CASE WHEN COALESCE(qty.n,0)=1 THEN '1 ticket' WHEN COALESCE(qty.n,0)>1 THEN qty.n::text||' tickets' ELSE 'Booking' END sm,
      false cc, false rr
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id AND e.brand_id = p_brand_id
    LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
    LEFT JOIN public.event_dates master ON master.event_id = e.id AND master.is_master
    LEFT JOIN LATERAL (SELECT sum(li.quantity)::integer n FROM public.order_line_items li WHERE li.order_id = o.id) qty ON true
    WHERE (o.buyer_user_id = v_user OR o.purchased_by_user_id = v_user)
      AND o.payment_status IN ('paid','pending')
    UNION ALL
    SELECT 'rsvp', r.rsvp_id, r.event_title, r.master_start_at,
      CASE WHEN COALESCE(r.plus_count,0)>0 THEN 'RSVP · you + '||r.plus_count ELSE 'RSVP' END,
      false, false
    FROM public.fetch_user_going_rsvps(v_user) r
    WHERE r.brand_id = p_brand_id AND r.role = 'primary'
    UNION ALL
    SELECT 'reservation', rv.id, COALESCE(vl.name,'Table reservation'), rv.reserved_for,
      'Table for '||rv.party_size,
      rv.status IN ('requested','confirmed','waitlisted') AND rv.reserved_for > now(), false
    FROM public.reservations rv
    LEFT JOIN public.venue_listings vl ON vl.id = rv.venue_id
    WHERE rv.brand_id = p_brand_id
      AND (rv.consumer_user_id = v_user OR rv.booked_by_user_id = v_user)
      AND rv.status NOT IN ('cancelled_by_guest','cancelled_by_venue')
    UNION ALL
    SELECT 'stay', g.id, COALESCE(NULLIF(btrim(line.offering_snapshot->>'name'),''), so.name, 'Stay'),
      line.room_check_in::timestamptz, 'Stay · '||g.public_reference,
      false, false
    FROM public.stay_reservation_groups g
    LEFT JOIN LATERAL (
      SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = g.id
      ORDER BY l.room_check_in NULLS LAST, l.created_at LIMIT 1
    ) line ON true
    LEFT JOIN public.stay_offerings so ON so.id = line.offering_id
    WHERE g.brand_id = p_brand_id AND (g.user_id = v_user OR g.booked_by_user_id = v_user)
      AND g.state IN ('instant_payment_pending','request_pending','approved_payment_required','finalizing','confirmed','partially_cancelled')
    UNION ALL
    SELECT 'venue_order', vo.id,
      COALESCE(vl.name,'Food order') || CASE WHEN vo.pickup_code IS NOT NULL THEN ' · '||vo.pickup_code ELSE '' END,
      vo.created_at,
      CASE WHEN COALESCE(items.n,0)=1 THEN '1 item' ELSE COALESCE(items.n,0)::text||' items' END,
      false,
      vo.payment_status = 'paid' AND vo.refund_requested_at IS NULL
        AND vo.fulfillment_status NOT IN ('cancelled','refunded')
    FROM public.venue_orders vo
    LEFT JOIN public.venue_listings vl ON vl.id = vo.venue_id
    LEFT JOIN LATERAL (SELECT sum(i.quantity)::integer n FROM public.venue_order_items i WHERE i.venue_order_id = vo.id) items ON true
    WHERE vo.brand_id = p_brand_id AND vo.buyer_user_id = v_user
      AND vo.payment_status IN ('paid','partial_refund','refunded')
  )
  SELECT plans.k, plans.pid, plans.t, plans.s, plans.sm,
    COALESCE(plans.s >= now() - interval '6 hours', false),
    plans.cc, NULL::text, plans.rr
  FROM plans
  WHERE plans.s IS NULL OR plans.s >= now() - interval '90 days'
  ORDER BY (COALESCE(plans.s >= now() - interval '6 hours', false)) DESC,
    CASE WHEN COALESCE(plans.s >= now() - interval '6 hours', false) THEN plans.s END ASC NULLS LAST,
    plans.s DESC NULLS LAST, plans.pid
  LIMIT 50;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_my_plans(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_my_plans(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_send(
  p_brand_id uuid,
  p_entry text,
  p_context_kind text,
  p_context_id uuid,
  p_reason text,
  p_body text,
  p_source text DEFAULT 'explorer'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'explorer');
  v_email text;
  v_name text;
  v_kind text := COALESCE(NULLIF(btrim(p_context_kind), ''), 'none');
  v_facts jsonb;
  v_hash text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF p_entry IS NULL OR p_entry NOT IN ('brand_page','offering','calendar','cancel_page') THEN
    RAISE EXCEPTION 'invalid_entry' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('explorer','web') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('order','rsvp','reservation','stay','venue_order','offering','venue','none')
     OR ((v_kind = 'none') <> (p_context_id IS NULL)) THEN
    RAISE EXCEPTION 'invalid_context' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(u.email)),
    COALESCE(NULLIF(btrim(p.display_name),''), NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),
      NULLIF(btrim(p.username),''), 'Mingla member')
  INTO v_email, v_name
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_user AND u.email_confirmed_at IS NOT NULL AND btrim(COALESCE(u.email,'')) <> '';
  IF v_email IS NULL THEN RAISE EXCEPTION 'verified_email_required' USING ERRCODE = '42501'; END IF;

  v_facts := public.issue_4111_context_facts(p_brand_id, v_kind, p_context_id, v_user);
  IF v_facts IS NULL THEN RAISE EXCEPTION 'invalid_context' USING ERRCODE = '22023'; END IF;

  v_hash := public.issue_4111_email_hash(v_email);
  IF public.issue_4111_is_blocked(p_brand_id, v_hash, v_user, NULL) THEN
    RAISE EXCEPTION 'enquiries_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4111_brand_takes_enquiries(p_brand_id) THEN
    RAISE EXCEPTION 'enquiries_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF public.issue_4111_enquiry_rate_limited(p_brand_id, v_hash, NULL) THEN
    RAISE EXCEPTION 'enquiry_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.issue_4111_open_enquiry(
    p_brand_id, v_source, NULL, p_entry, v_kind, p_context_id,
    v_facts->>'offering_kind', p_reason, p_body, v_user, left(v_name, 80), v_email, NULL, false,
    true, false, '{}'::text[], NULL, NULL, NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_send(uuid, text, text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_send(uuid, text, text, uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_guest_reply(p_enquiry_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.brand_enquiries e WHERE e.id = p_enquiry_id AND e.guest_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4111_append_guest_message(p_enquiry_id, p_body, auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_guest_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_guest_reply(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_brand_enquiries_for_user()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  v_email := public.issue_3720_notification_email(v_user);
  IF v_email IS NULL THEN RETURN 0; END IF;

  WITH claimed AS (
    UPDATE public.brand_enquiries e
    SET guest_user_id = v_user,
        guest_email_confirmed_at = COALESCE(e.guest_email_confirmed_at, now()),
        updated_at = now()
    WHERE e.guest_user_id IS NULL AND e.guest_email = v_email
    RETURNING e.conversation_id
  ), joined AS (
    INSERT INTO public.conversation_participants(conversation_id, user_id)
    SELECT claimed.conversation_id, v_user FROM claimed
    ON CONFLICT (conversation_id, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM claimed;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_brand_enquiries_for_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_brand_enquiries_for_user() TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Brand team.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_brand_enquiries(
  p_brand_id uuid DEFAULT NULL,
  p_status_filter text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_filter text := COALESCE(NULLIF(btrim(p_status_filter), ''), 'open');
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF v_filter NOT IN ('open','all','new','waiting','replied','resolved') THEN
    RAISE EXCEPTION 'invalid_status_filter' USING ERRCODE = '22023';
  END IF;
  IF p_brand_id IS NOT NULL AND NOT public.issue_4111_is_enquiry_team_member(p_brand_id, v_user) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH scope AS (
    SELECT e.*, b.name brand_name, b.slug brand_slug, b.profile_photo_url brand_photo_url
    FROM public.brand_enquiries e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    WHERE (p_brand_id IS NULL OR e.brand_id = p_brand_id)
      AND public.issue_4111_is_enquiry_team_member(e.brand_id, v_user)
  ), filtered AS (
    SELECT * FROM scope s
    WHERE v_filter = 'all'
       OR (v_filter = 'open' AND s.status <> 'resolved')
       OR s.status = v_filter
    ORDER BY CASE s.status WHEN 'new' THEN 0 WHEN 'waiting' THEN 1 WHEN 'replied' THEN 2 ELSE 3 END,
      GREATEST(s.last_guest_at, COALESCE(s.last_brand_at, s.last_guest_at)) DESC, s.id
    LIMIT 200
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'conversation_id', f.conversation_id, 'brand_id', f.brand_id,
        'brand_name', f.brand_name, 'brand_slug', f.brand_slug, 'brand_photo_url', f.brand_photo_url,
        'status', f.status, 'source', f.source,
        'channel_label', CASE f.source WHEN 'site' THEN 'Website' WHEN 'web' THEN 'Web' ELSE 'App' END,
        'guest_name', f.guest_name, 'topic_label', f.topic_label, 'reason', f.reason,
        'context_kind', f.context_kind, 'context_id', f.context_id,
        'spam_flag', f.spam_flag, 'email_confirmed', f.guest_email_confirmed_at IS NOT NULL,
        'created_at', f.created_at, 'last_guest_at', f.last_guest_at, 'last_brand_at', f.last_brand_at,
        'last_message_preview', (
          SELECT left(m.content, 180) FROM public.messages m
          WHERE m.conversation_id = f.conversation_id AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
      )) FROM filtered f), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
        'new', count(*) FILTER (WHERE status = 'new'),
        'waiting', count(*) FILTER (WHERE status = 'waiting'),
        'replied', count(*) FILTER (WHERE status = 'replied'),
        'resolved', count(*) FILTER (WHERE status = 'resolved'),
        'needs_reply', count(*) FILTER (WHERE status IN ('new','waiting') AND NOT spam_flag)
      ) FROM scope)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_brand_enquiries(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_brand_enquiries(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_get_thread(p_enquiry_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_enquiry public.brand_enquiries%ROWTYPE;
BEGIN
  SELECT * INTO v_enquiry FROM public.brand_enquiries WHERE id = p_enquiry_id;
  IF NOT FOUND OR NOT public.issue_4111_enquiry_row_readable(v_enquiry, v_user) THEN
    RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4111_thread_json(
    p_enquiry_id,
    CASE WHEN v_enquiry.guest_user_id = v_user AND NOT public.issue_4111_is_enquiry_team_member(v_enquiry.brand_id, v_user)
      THEN 'guest' ELSE 'team' END,
    p_limit
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_get_thread(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_get_thread(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_reply(p_enquiry_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enquiry public.brand_enquiries%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_brand_name text;
  v_first text;
  v_display text;
  v_message uuid;
BEGIN
  v_enquiry := public.issue_4111_require_team(p_enquiry_id);
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  SELECT name INTO v_brand_name FROM public.brands WHERE id = v_enquiry.brand_id;
  SELECT COALESCE(NULLIF(btrim(p.first_name),''),
      NULLIF(split_part(btrim(COALESCE(p.display_name,'')), ' ', 1),''))
  INTO v_first FROM public.profiles p WHERE p.id = auth.uid();
  v_display := left(CASE WHEN v_first IS NULL THEN v_brand_name ELSE v_first || ' at ' || v_brand_name END, 120);

  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot, created_at
  ) VALUES (
    v_enquiry.conversation_id, auth.uid(), v_body, 'text', 'brand', v_display, clock_timestamp()
  ) RETURNING id INTO v_message;

  UPDATE public.brand_enquiries
  SET status = 'replied', resolved_at = NULL, resolved_by = NULL,
      last_brand_at = clock_timestamp(), updated_at = now()
  WHERE id = p_enquiry_id;

  IF v_enquiry.guest_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox(
      category_key, user_id, brand_id, country_code, payload, idempotency_key, status
    ) VALUES (
      'explorer.brand_enquiry_reply', v_enquiry.guest_user_id, v_enquiry.brand_id, NULL,
      jsonb_build_object(
        'enquiry_id', v_enquiry.id, 'conversation_id', v_enquiry.conversation_id,
        'message_id', v_message, 'brand_id', v_enquiry.brand_id, 'brand_name', v_brand_name,
        'sender_name', v_display, 'body', left(v_body, 180),
        'deep_link', 'mingla://chat/' || v_enquiry.conversation_id::text
          || '?type=brand_enquiry&enquiryId=' || v_enquiry.id::text
      ),
      'explorer.brand_enquiry_reply:' || v_message::text, 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  -- Web guests (no account yet) are emailed by the batched guest digest.
  RETURN v_message;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_reply(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_set_status(p_enquiry_id uuid, p_action text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enquiry public.brand_enquiries%ROWTYPE;
  v_status text;
BEGIN
  v_enquiry := public.issue_4111_require_team(p_enquiry_id);
  IF p_action = 'resolve' THEN
    v_status := 'resolved';
    UPDATE public.brand_enquiries
    SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
    WHERE id = p_enquiry_id;
  ELSIF p_action = 'reopen' THEN
    v_status := CASE
      WHEN v_enquiry.last_brand_at IS NULL THEN 'new'
      WHEN v_enquiry.last_guest_at > v_enquiry.last_brand_at THEN 'waiting'
      ELSE 'replied' END;
    UPDATE public.brand_enquiries
    SET status = v_status, resolved_at = NULL, resolved_by = NULL, updated_at = now()
    WHERE id = p_enquiry_id;
  ELSE
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_set_status(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_block_sender(p_enquiry_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_enquiry public.brand_enquiries%ROWTYPE;
BEGIN
  v_enquiry := public.issue_4111_require_team(p_enquiry_id);
  INSERT INTO public.brand_enquiry_blocks(brand_id, email_hash, source_enquiry_id, created_by)
  VALUES (v_enquiry.brand_id, public.issue_4111_email_hash(v_enquiry.guest_email), v_enquiry.id, auth.uid())
  ON CONFLICT ON CONSTRAINT brand_enquiry_blocks_unique DO NOTHING;
  IF v_enquiry.guest_user_id IS NOT NULL THEN
    INSERT INTO public.brand_enquiry_blocks(brand_id, user_id, source_enquiry_id, created_by)
    VALUES (v_enquiry.brand_id, v_enquiry.guest_user_id, v_enquiry.id, auth.uid())
    ON CONFLICT ON CONSTRAINT brand_enquiry_blocks_unique DO NOTHING;
  END IF;
  UPDATE public.brand_enquiries
  SET status = 'resolved', resolved_at = COALESCE(resolved_at, now()),
      resolved_by = COALESCE(resolved_by, auth.uid()), updated_at = now()
  WHERE id = p_enquiry_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_block_sender(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_block_sender(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_enquiry_report(p_enquiry_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_enquiry public.brand_enquiries%ROWTYPE;
  v_side text;
  v_reason text := left(btrim(COALESCE(p_reason, '')), 500);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_enquiry FROM public.brand_enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501'; END IF;
  IF public.issue_4111_is_enquiry_team_member(v_enquiry.brand_id, v_user) THEN
    v_side := 'brand';
  ELSIF v_enquiry.guest_user_id = v_user THEN
    v_side := 'guest';
  ELSE
    RAISE EXCEPTION 'enquiry_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'report_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.brand_enquiries
  SET reported_at = now(), reported_by = v_user, reporter_side = v_side,
      report_reason = v_reason, report_dismissed_at = NULL, report_dismissed_by = NULL,
      updated_at = now()
  WHERE id = p_enquiry_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_report(uuid, text) TO authenticated, service_role;

-- Public: is the Message card shown, and "Usually replies within {n}"
-- (only once the brand has answered enough enquiries in the last 90 days).
CREATE OR REPLACE FUNCTION public.brand_enquiry_public_profile(p_brand_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH answered AS (
    SELECT extract(epoch FROM (first_reply.at - e.created_at)) / 60.0 minutes
    FROM public.brand_enquiries e
    JOIN LATERAL (
      SELECT min(m.created_at) at FROM public.messages m
      WHERE m.conversation_id = e.conversation_id AND m.sender_kind = 'brand' AND m.deleted_at IS NULL
    ) first_reply ON first_reply.at IS NOT NULL
    WHERE e.brand_id = p_brand_id AND e.created_at >= now() - interval '90 days' AND NOT e.spam_flag
  )
  SELECT jsonb_build_object(
    'available', public.issue_4111_brand_takes_enquiries(p_brand_id),
    'reply_minutes', CASE WHEN (SELECT count(*) FROM answered) >= 5
      THEN (SELECT ceil(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::integer FROM answered) END
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_enquiry_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brand_enquiry_public_profile(uuid) TO anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Mingla staff: only reported enquiries, only while the report is open.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_reported_enquiries(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.issue_4111_is_mingla_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'reported_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', e.id, 'brand_id', e.brand_id, 'brand_name', b.name, 'brand_slug', b.slug,
        'guest_name', e.guest_name, 'guest_email', e.guest_email,
        'has_account', e.guest_user_id IS NOT NULL, 'source', e.source,
        'topic_label', e.topic_label, 'status', e.status, 'spam_flag', e.spam_flag,
        'reported_at', e.reported_at, 'reporter_side', e.reporter_side,
        'report_reason', e.report_reason,
        'messages', public.issue_4111_thread_json(e.id, 'guest', 100)->'messages'
      ) AS row
      FROM public.brand_enquiries e JOIN public.brands b ON b.id = e.brand_id
      WHERE e.reported_at IS NOT NULL AND e.report_dismissed_at IS NULL
      ORDER BY e.reported_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    ) rows
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_reported_enquiries(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reported_enquiries(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_enquiry_dismiss_report(p_enquiry_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.issue_4111_is_mingla_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.brand_enquiries
  SET report_dismissed_at = now(), report_dismissed_by = auth.uid(), updated_at = now()
  WHERE id = p_enquiry_id AND reported_at IS NOT NULL AND report_dismissed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_enquiry_dismiss_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_dismiss_report(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_enquiry_block_everywhere(p_enquiry_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_enquiry public.brand_enquiries%ROWTYPE;
BEGIN
  IF NOT public.issue_4111_is_mingla_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_enquiry FROM public.brand_enquiries
  WHERE id = p_enquiry_id AND reported_at IS NOT NULL AND report_dismissed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.brand_enquiry_blocks(brand_id, email_hash, source_enquiry_id, created_by)
  VALUES (NULL, public.issue_4111_email_hash(v_enquiry.guest_email), v_enquiry.id, auth.uid())
  ON CONFLICT ON CONSTRAINT brand_enquiry_blocks_unique DO NOTHING;
  IF v_enquiry.guest_user_id IS NOT NULL THEN
    INSERT INTO public.brand_enquiry_blocks(brand_id, user_id, source_enquiry_id, created_by)
    VALUES (NULL, v_enquiry.guest_user_id, v_enquiry.id, auth.uid())
    ON CONFLICT ON CONSTRAINT brand_enquiry_blocks_unique DO NOTHING;
  END IF;
  UPDATE public.brand_enquiries
  SET report_dismissed_at = now(), report_dismissed_by = auth.uid(),
      status = 'resolved', resolved_at = COALESCE(resolved_at, now()), updated_at = now()
  WHERE id = p_enquiry_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_enquiry_block_everywhere(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_block_everywhere(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Service role: the anon edge functions.
-- ───────────────────────────────────────────────────────────────────────────
-- Outcome codes the edge maps to its silent 202 / 404 contract:
--   created | blocked | rate_limited | unavailable | invalid_context | invalid
CREATE OR REPLACE FUNCTION public.issue_4111_create_web_enquiry(
  p_brand_id uuid,
  p_source text,
  p_origin text,
  p_entry text,
  p_context_kind text,
  p_context_id uuid,
  p_reason text,
  p_body text,
  p_name text,
  p_email text,
  p_phone text,
  p_ok_to_call boolean,
  p_ip_hash text,
  p_spam_flag boolean,
  p_moderation_categories text[],
  p_token_hash text,
  p_disclosure_text text,
  p_disclosure_version text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_kind text := COALESCE(NULLIF(btrim(p_context_kind), ''), 'none');
  v_hash text;
  v_facts jsonb;
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_source NOT IN ('web','site') OR v_kind NOT IN ('offering','venue','none')
     OR ((v_kind = 'none') <> (p_context_id IS NULL))
     OR p_entry NOT IN ('brand_page','offering','cancel_page','site')
     OR (p_entry = 'site' AND p_source <> 'site')
     OR (p_source = 'site' AND NULLIF(btrim(COALESCE(p_origin,'')),'') IS NULL)
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF NOT public.issue_4111_brand_takes_enquiries(p_brand_id) THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;
  v_hash := public.issue_4111_email_hash(v_email);
  IF public.issue_4111_is_blocked(p_brand_id, v_hash, NULL, p_ip_hash) THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF public.issue_4111_enquiry_rate_limited(p_brand_id, v_hash, p_ip_hash) THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  v_facts := public.issue_4111_context_facts(p_brand_id, v_kind, p_context_id, NULL);
  IF v_facts IS NULL THEN RETURN jsonb_build_object('status', 'invalid_context'); END IF;

  BEGIN
    v_result := public.issue_4111_open_enquiry(
      p_brand_id, p_source, p_origin, p_entry, v_kind, p_context_id, v_facts->>'offering_kind',
      p_reason, p_body, NULL, p_name, v_email, p_phone, p_ok_to_call, false,
      p_spam_flag, p_moderation_categories, p_disclosure_text, p_disclosure_version, p_ip_hash
    );
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23514' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END;

  INSERT INTO public.brand_enquiry_access_tokens(token_hash, enquiry_id, expires_at)
  VALUES (p_token_hash, (v_result->>'enquiry_id')::uuid, now() + interval '90 days');

  RETURN v_result || jsonb_build_object('status', 'created');
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_create_web_enquiry(uuid,text,text,text,text,uuid,text,text,text,text,text,boolean,text,boolean,text[],text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_create_web_enquiry(uuid,text,text,text,text,uuid,text,text,text,text,text,boolean,text,boolean,text[],text,text,text)
  TO service_role;

-- Resolve a guest token. Rolling 90-day expiry; the first valid read confirms
-- the guest's email (they opened the link we sent to it).
CREATE OR REPLACE FUNCTION public.issue_4111_token_enquiry(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_token public.brand_enquiry_access_tokens%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_token FROM public.brand_enquiry_access_tokens WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_token.expires_at <= now() THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.brand_enquiry_access_tokens
  SET last_used_at = now(), expires_at = GREATEST(expires_at, now() + interval '90 days')
  WHERE token_hash = p_token_hash;
  RETURN v_token.enquiry_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_token_enquiry(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_token_enquiry(text) TO service_role;

-- {status:'ok', thread} | {status:'expired', enquiry_id} | {status:'invalid'}
CREATE OR REPLACE FUNCTION public.issue_4111_thread_by_token(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_enquiry uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  BEGIN
    v_enquiry := public.issue_4111_token_enquiry(p_token_hash);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('status', 'expired',
      'enquiry_id', (SELECT enquiry_id FROM public.brand_enquiry_access_tokens WHERE token_hash = p_token_hash));
  END;
  IF v_enquiry IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  UPDATE public.brand_enquiries
  SET guest_email_confirmed_at = now(), updated_at = now()
  WHERE id = v_enquiry AND guest_email_confirmed_at IS NULL;
  RETURN jsonb_build_object('status', 'ok') || public.issue_4111_thread_json(v_enquiry, 'guest', 200);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_thread_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_thread_by_token(text) TO service_role;

-- {status:'sent', message_id} | {status:'expired'|'invalid'|'blocked'|'rate_limited'|'invalid_message'}
CREATE OR REPLACE FUNCTION public.issue_4111_guest_post_by_token(p_token_hash text, p_body text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enquiry uuid;
  v_message uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  BEGIN
    v_enquiry := public.issue_4111_token_enquiry(p_token_hash);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('status', 'expired');
  END;
  IF v_enquiry IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF p_ip_hash IS NOT NULL AND public.biz_web_follow_rate_hit('enq:post:' || v_enquiry::text, 3600, 30) THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  BEGIN
    v_message := public.issue_4111_append_guest_message(v_enquiry, p_body, NULL);
  EXCEPTION
    WHEN SQLSTATE '22023' THEN RETURN jsonb_build_object('status', 'invalid_message');
    WHEN SQLSTATE '42501' THEN RETURN jsonb_build_object('status', 'blocked');
  END;
  RETURN jsonb_build_object('status', 'sent', 'message_id', v_message);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_guest_post_by_token(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_guest_post_by_token(text, text, text) TO service_role;

-- "Email me a new link". Stores the new token only when the email owns the
-- enquiry; the edge always answers 202 either way.
-- {status:'issued', enquiry_id, guest_email, guest_name, brand_name, topic_label} | {status:'none'|'rate_limited'}
CREATE OR REPLACE FUNCTION public.issue_4111_reissue_link(
  p_email text, p_enquiry_id uuid, p_token_hash text, p_ip_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_row record;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF v_email = '' OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  IF (p_ip_hash IS NOT NULL AND public.biz_web_follow_rate_hit('enq:link:ip:' || p_ip_hash, 3600, 10))
     OR public.biz_web_follow_rate_hit('enq:link:' || public.issue_4111_email_hash(v_email), 3600, 3) THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  SELECT e.id, e.guest_email, e.guest_name, e.topic_label, b.name brand_name INTO v_row
  FROM public.brand_enquiries e JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
  WHERE e.guest_email = v_email AND (p_enquiry_id IS NULL OR e.id = p_enquiry_id)
  ORDER BY e.last_guest_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'none'); END IF;
  INSERT INTO public.brand_enquiry_access_tokens(token_hash, enquiry_id, expires_at)
  VALUES (p_token_hash, v_row.id, now() + interval '90 days');
  RETURN jsonb_build_object('status', 'issued', 'enquiry_id', v_row.id, 'guest_email', v_row.guest_email,
    'guest_name', v_row.guest_name, 'brand_name', v_row.brand_name, 'topic_label', v_row.topic_label);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_reissue_link(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_reissue_link(text, uuid, text, text) TO service_role;

-- Guest reply digest (web guests without an account). Claims threads whose
-- newest brand messages have not been emailed, at most once per 10 minutes
-- per thread. Returns the claim so the sender can undo it on failure.
CREATE OR REPLACE FUNCTION public.issue_4111_claim_guest_digests(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  WITH due AS (
    SELECT e.id, e.guest_emailed_at previous
    FROM public.brand_enquiries e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    WHERE e.guest_user_id IS NULL
      AND e.last_brand_at IS NOT NULL
      AND e.last_brand_at > COALESCE(e.guest_emailed_at, 'epoch'::timestamptz)
      AND (e.guest_emailed_at IS NULL OR e.guest_emailed_at <= now() - interval '10 minutes')
      AND NOT public.issue_4111_is_blocked(e.brand_id, public.issue_4111_email_hash(e.guest_email), NULL, NULL)
    ORDER BY e.last_brand_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
    FOR UPDATE OF e SKIP LOCKED
  ), claimed AS (
    UPDATE public.brand_enquiries e SET guest_emailed_at = now()
    FROM due WHERE e.id = due.id
    RETURNING e.id, due.previous, e.guest_email, e.guest_name, e.topic_label, e.brand_id, e.conversation_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'enquiry_id', c.id, 'previous_emailed_at', c.previous, 'guest_email', c.guest_email,
    'guest_name', c.guest_name, 'topic_label', c.topic_label, 'brand_name', b.name,
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('display', m.sender_display_name_snapshot, 'body', left(m.content, 2000), 'at', m.created_at)
        ORDER BY m.created_at)
      FROM public.messages m
      WHERE m.conversation_id = c.conversation_id AND m.sender_kind = 'brand' AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(c.previous, 'epoch'::timestamptz)
    ), '[]'::jsonb)
  )), '[]'::jsonb) INTO v_result
  FROM claimed c JOIN public.brands b ON b.id = c.brand_id;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_claim_guest_digests(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_claim_guest_digests(integer) TO service_role;

-- On success stores the email's fresh link token; on failure restores the
-- previous emailed-at so the next run retries.
CREATE OR REPLACE FUNCTION public.issue_4111_complete_guest_digest(
  p_enquiry_id uuid, p_token_hash text, p_sent boolean, p_previous_emailed_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_sent THEN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'token_hash_required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.brand_enquiry_access_tokens(token_hash, enquiry_id, expires_at)
    VALUES (p_token_hash, p_enquiry_id, now() + interval '90 days')
    ON CONFLICT (token_hash) DO NOTHING;
  ELSE
    UPDATE public.brand_enquiries SET guest_emailed_at = p_previous_emailed_at WHERE id = p_enquiry_id;
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_complete_guest_digest(uuid, text, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_complete_guest_digest(uuid, text, boolean, timestamptz) TO service_role;

COMMIT;
