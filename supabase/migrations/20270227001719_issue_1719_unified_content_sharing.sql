-- #1719 unified sharing: authoritative posters, recipient discovery, and
-- atomic/idempotent rich-card delivery. Apply surgically; linked history drifts.
BEGIN;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_media_poster_url text NULL;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS cover_media_poster_url text NULL;
ALTER TABLE public.venue_listings ADD COLUMN IF NOT EXISTS cover_media_poster_url text NULL;
ALTER TABLE public.event_cover_video_jobs ADD COLUMN IF NOT EXISTS processed_poster_url text NULL;
ALTER TABLE public.content_share_versions ADD COLUMN IF NOT EXISTS message_text text NULL;

COMMENT ON COLUMN public.events.cover_media_poster_url IS '#1719 authoritative still paired with cover_media_url/type; required for GIF/video public sharing.';
COMMENT ON COLUMN public.brands.cover_media_poster_url IS '#1719 authoritative still paired with cover_media_url/type; required for GIF/video public sharing.';
COMMENT ON COLUMN public.venue_listings.cover_media_poster_url IS '#1719 authoritative still paired with cover_media_url/type; required for GIF/video public sharing.';
COMMENT ON COLUMN public.event_cover_video_jobs.processed_poster_url IS '#1719 HEAD-validated Bunny thumbnail copied atomically when a video cover is applied.';

-- One formatter owns both the externally shared text and degraded internal-chat
-- text. Clients receive this immutable server snapshot; they never reconstruct
-- prose from a remembered subset of facts.
CREATE OR REPLACE FUNCTION public.content_share_message_text(
  p_facts jsonb,p_code text,p_planning_preference text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp
AS $function$
DECLARE v_kind text:=p_facts->>'kind';v_title text:=p_facts->>'title';v_lead text;v_detail text;v_status text;v_plan text:=NULLIF(btrim(COALESCE(p_planning_preference,'')),'');
BEGIN
  IF p_code!~'^[0-9A-Za-z]{16}$' OR v_kind NOT IN ('place','curated','event','rsvp_event','trip','experience','venue','brand') OR NULLIF(btrim(v_title),'') IS NULL THEN RAISE EXCEPTION 'invalid_content_share_message';END IF;
  v_status:=CASE p_facts->>'status' WHEN 'sold_out' THEN 'Sold out' WHEN 'ended' THEN 'Ended' WHEN 'cancelled' THEN 'Cancelled' WHEN 'rsvp_closed' THEN 'RSVP closed' WHEN 'date_tbd' THEN 'Date TBD' WHEN 'dates_tbd' THEN 'Dates TBD' END;
  v_lead:=CASE v_kind
    WHEN 'place' THEN 'How about '||v_title||CASE WHEN NULLIF(p_facts->>'area','') IS NULL THEN '?' ELSE ' in '||(p_facts->>'area')||'?' END
    WHEN 'curated' THEN v_title||' is '||CASE WHEN p_facts ? 'stopCount' THEN 'a '||(p_facts->>'stopCount')||'-stop plan.' ELSE 'a Mingla plan.' END
    WHEN 'event' THEN v_title||CASE WHEN NULLIF(p_facts->>'localDate','') IS NULL THEN '.' ELSE ' is '||(p_facts->>'localDate')||CASE WHEN NULLIF(p_facts->>'localTime','') IS NULL THEN '' ELSE ' at '||(p_facts->>'localTime') END||'.' END
    WHEN 'rsvp_event' THEN 'Want to join '||v_title||'?'
    WHEN 'trip' THEN 'Take a look at '||v_title||CASE WHEN NULLIF(p_facts->>'destination','') IS NULL THEN '.' ELSE ' in '||(p_facts->>'destination')||'.' END
    WHEN 'experience' THEN 'How about '||v_title||CASE WHEN NULLIF(p_facts->>'area','') IS NULL THEN '?' ELSE ' in '||(p_facts->>'area')||'?' END
    WHEN 'venue' THEN 'Check out '||v_title||CASE WHEN NULLIF(p_facts->>'area','') IS NULL THEN '.' ELSE ' in '||(p_facts->>'area')||'.' END
    ELSE 'See what '||v_title||' has coming up.' END;
  v_detail:=COALESCE(v_status,NULLIF(CASE v_kind WHEN 'place' THEN p_facts->>'category' WHEN 'curated' THEN p_facts->>'duration' WHEN 'event' THEN p_facts->>'venue' WHEN 'rsvp_event' THEN p_facts->>'venue' WHEN 'trip' THEN p_facts->>'dateRange' WHEN 'experience' THEN p_facts->>'nextDate' WHEN 'venue' THEN p_facts->>'category' WHEN 'brand' THEN p_facts->>'category' END,''));
  IF v_plan IS NOT NULL THEN v_plan:=left(regexp_replace(v_plan,'[[:cntrl:]]',' ','g'),80);END IF;
  RETURN concat_ws(E'\n',v_lead,CASE WHEN v_detail IS NULL THEN NULL ELSE v_detail||CASE WHEN v_detail~'[.!?]$' THEN '' ELSE '.' END END,CASE WHEN v_plan IS NULL THEN NULL ELSE 'Maybe '||v_plan||'.' END,E'\nhttps://usemingla.com/s/'||p_code);
END;$function$;
REVOKE ALL ON FUNCTION public.content_share_message_text(jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.content_share_message_text(jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_content_share_version_message()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
DECLARE v_code text;
BEGIN
  SELECT short_code INTO v_code FROM public.content_share_links WHERE id=NEW.link_id;
  NEW.message_text:=public.content_share_message_text(NEW.facts,v_code,NULL);
  RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS content_share_version_message ON public.content_share_versions;
CREATE TRIGGER content_share_version_message BEFORE INSERT ON public.content_share_versions FOR EACH ROW EXECUTE FUNCTION public.tg_content_share_version_message();
ALTER TABLE public.content_share_versions DISABLE TRIGGER content_share_versions_immutable;
UPDATE public.content_share_versions v SET message_text=public.content_share_message_text(v.facts,l.short_code,NULL) FROM public.content_share_links l WHERE l.id=v.link_id AND v.message_text IS NULL;
ALTER TABLE public.content_share_versions ENABLE TRIGGER content_share_versions_immutable;
ALTER TABLE public.content_share_versions ALTER COLUMN message_text SET NOT NULL;
ALTER TABLE public.content_share_versions ADD CONSTRAINT content_share_versions_message_text_bounded CHECK(octet_length(message_text) BETWEEN 1 AND 2048);
COMMENT ON COLUMN public.content_share_versions.message_text IS '#1719 immutable server-authored external/degraded-chat message snapshot.';

CREATE OR REPLACE FUNCTION public.resolve_content_share_message(p_code text,p_version integer,p_planning_preference text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
  -- p_planning_preference remains in the signature for rollout compatibility,
  -- but the returned prose is the immutable version snapshot. External share
  -- and degraded internal chat therefore cannot tell two different stories.
  SELECT v.message_text
  FROM public.content_share_links l JOIN public.content_share_versions v ON v.link_id=l.id AND v.version=p_version
  WHERE l.short_code=p_code AND l.state='active' AND l.current_version=p_version AND l.revoked_at IS NULL AND l.deleted_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>now());
$function$;
REVOKE ALL ON FUNCTION public.resolve_content_share_message(text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_content_share_message(text,integer,text) TO service_role;

-- Production preflight on 2026-08-08 proved zero video covers and zero ready
-- jobs with stored thumbnails. No row can be truthfully backfilled, so this
-- migration intentionally updates zero rows (candidate=0/updated=0/unresolved=0).

CREATE OR REPLACE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  COALESCE(v.theme_color_override, b.theme_color) AS theme_color,
  COALESCE(v.theme_font_override, b.theme_font) AS theme_font,
  COALESCE(v.theme_animation_override, b.theme_animation) AS theme_animation,
  b.cover_hue, b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday, 'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  pp.generative_summary AS pitch,
  v.created_at, v.updated_at,
  CASE WHEN vac.iana_timezone_source IN ('derived', 'operator')
       THEN vac.iana_timezone END AS iana_timezone,
  v.cover_media_poster_url
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
LEFT JOIN public.venue_availability_config vac ON vac.venue_id = v.id
WHERE v.claim_status = 'verified';
ALTER VIEW public.venue_public_view SET (security_invoker = false);
GRANT SELECT ON public.venue_public_view TO anon, authenticated;

-- Cover identity is a three-field unit. These wrappers preserve the mature
-- publish/refund-gate functions and add the poster write in the SAME database
-- transaction. A delegated rejection rolls the entire wrapper back.
CREATE OR REPLACE FUNCTION public.assert_cover_media_triplet(
  p_url text, p_type text, p_poster_url text
) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp
AS $function$
BEGIN
  IF p_url IS NULL THEN
    IF p_type IS NOT NULL OR p_poster_url IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_cover_media_triplet' USING ERRCODE='22023';
    END IF;
    RETURN;
  END IF;
  IF octet_length(p_url)>2048 OR p_url !~ '^https://' OR p_type NOT IN ('image','gif','video')
     OR p_poster_url IS NULL OR octet_length(p_poster_url)>2048 OR p_poster_url !~ '^https://'
     OR (p_type='image' AND p_poster_url<>p_url)
     OR (p_type IN ('gif','video') AND p_poster_url=p_url) THEN
    RAISE EXCEPTION 'invalid_cover_media_triplet' USING ERRCODE='22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_cover_media_triplet(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_cover_media_triplet(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.business_publish_event_draft_v1719(
  p_event_id uuid,p_draft_payload jsonb,p_client_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_result jsonb;v_url text;v_type text;v_poster text;
BEGIN
  v_url:=NULLIF(p_draft_payload->>'cover_media_url','');v_type:=NULLIF(p_draft_payload->>'cover_media_type','');v_poster:=COALESCE(NULLIF(p_draft_payload->>'cover_media_poster_url',''),CASE WHEN v_type='image' THEN v_url END);
  PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
  v_result:=public.business_publish_event_draft(p_event_id,p_draft_payload,p_client_revision);
  UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;RETURN v_result;
END;$function$;

CREATE OR REPLACE FUNCTION public.business_publish_trip_draft_v1719(
  p_event_id uuid,p_draft_payload jsonb,p_client_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_result jsonb;v_url text;v_type text;v_poster text;
BEGIN
  v_url:=NULLIF(p_draft_payload->>'cover_media_url','');v_type:=NULLIF(p_draft_payload->>'cover_media_type','');v_poster:=COALESCE(NULLIF(p_draft_payload->>'cover_media_poster_url',''),CASE WHEN v_type='image' THEN v_url END);
  PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
  v_result:=public.business_publish_trip_draft(p_event_id,p_draft_payload,p_client_revision);
  UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;RETURN v_result;
END;$function$;

CREATE OR REPLACE FUNCTION public.biz_publish_experience_v1719(
  p_event_id uuid,p_payload jsonb,p_publish boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_result jsonb;v_cover jsonb;v_url text;v_type text;v_poster text;v_has_cover boolean;
BEGIN
  v_has_cover:=p_payload ? 'cover';
  IF NOT v_has_cover THEN RETURN public.biz_publish_experience(p_event_id,p_payload,p_publish);END IF;
  v_cover:=COALESCE(p_payload->'cover','{}'::jsonb);
  v_url:=NULLIF(v_cover->>'coverMediaUrl','');v_type:=NULLIF(v_cover->>'coverMediaType','');v_poster:=COALESCE(NULLIF(v_cover->>'coverMediaPosterUrl',''),CASE WHEN v_type='image' THEN v_url END);
  PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
  v_result:=public.biz_publish_experience(p_event_id,p_payload,p_publish);
  UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;RETURN v_result;
END;$function$;

CREATE OR REPLACE FUNCTION public.biz_update_live_trip_v1719(
  p_event_id uuid,p_patch jsonb,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_result jsonb;v_url text;v_type text;v_poster text;v_has_cover boolean;
BEGIN
  v_has_cover:=p_patch ?| ARRAY['cover_media_url','cover_media_type','cover_media_poster_url'];
  IF v_has_cover AND NOT (p_patch ?& ARRAY['cover_media_url','cover_media_type','cover_media_poster_url']) THEN RAISE EXCEPTION 'cover_media_triplet_required' USING ERRCODE='22023';END IF;
  IF v_has_cover THEN
    v_url:=NULLIF(p_patch->>'cover_media_url','');v_type:=NULLIF(p_patch->>'cover_media_type','');v_poster:=COALESCE(NULLIF(p_patch->>'cover_media_poster_url',''),CASE WHEN v_type='image' THEN v_url END);
    PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
  END IF;
  v_result:=public.biz_update_live_trip(p_event_id,p_patch,p_reason);
  IF v_has_cover AND COALESCE((v_result->>'ok')::boolean,false) THEN
    UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
    IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;
  END IF;RETURN v_result;
END;$function$;

REVOKE ALL ON FUNCTION public.business_publish_event_draft_v1719(uuid,jsonb,integer),public.business_publish_trip_draft_v1719(uuid,jsonb,integer),public.biz_publish_experience_v1719(uuid,jsonb,boolean),public.biz_update_live_trip_v1719(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_publish_event_draft_v1719(uuid,jsonb,integer),public.business_publish_trip_draft_v1719(uuid,jsonb,integer),public.biz_publish_experience_v1719(uuid,jsonb,boolean),public.biz_update_live_trip_v1719(uuid,jsonb,text) TO authenticated,service_role;

CREATE TABLE public.content_share_message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('direct','group','friend')),
  target_id uuid NOT NULL,
  short_code text COLLATE "C" NOT NULL CHECK (short_code ~ '^[0-9A-Za-z]{16}$'),
  share_version integer NOT NULL CHECK (share_version > 0),
  sender_note text NULL,
  sender_note_grapheme_count integer NOT NULL DEFAULT 0 CHECK (sender_note_grapheme_count BETWEEN 0 AND 120),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_share_message_deliveries_idempotency UNIQUE (sender_id, operation_id, target_kind, target_id)
);
CREATE INDEX content_share_message_deliveries_sender_created_idx
  ON public.content_share_message_deliveries(sender_id, created_at DESC);
ALTER TABLE public.content_share_message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_message_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_share_message_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.content_share_message_deliveries TO authenticated;
GRANT ALL ON public.content_share_message_deliveries TO service_role;
CREATE POLICY content_share_message_deliveries_sender_read
  ON public.content_share_message_deliveries FOR SELECT TO authenticated
  USING (sender_id = auth.uid());

CREATE OR REPLACE FUNCTION public.list_content_share_recipients()
RETURNS TABLE(
  key text, target_kind text, target_id uuid, person_user_id uuid,
  display_name text, username text, avatar_url text, conversation_id uuid,
  last_message_at timestamptz, participant_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH caller AS (SELECT auth.uid() AS uid),
  blocks AS (
    SELECT blocker_id, blocked_id FROM public.blocked_users, caller
    WHERE blocker_id = caller.uid OR blocked_id = caller.uid
  ),
  direct_candidates AS (
    SELECT c.id AS conversation_id, other.user_id AS person_user_id,
           c.last_message_at, c.updated_at,
           row_number() OVER (PARTITION BY other.user_id ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC, c.id) AS rank
    FROM caller
    JOIN public.conversation_participants mine ON mine.user_id = caller.uid
    JOIN public.conversations c ON c.id = mine.conversation_id
      AND c.type = 'direct' AND c.linked_entity_type = 'direct' AND c.is_enabled IS TRUE
    JOIN public.conversation_participants other ON other.conversation_id = c.id AND other.user_id <> caller.uid
    WHERE (SELECT count(DISTINCT exact_cp.user_id) FROM public.conversation_participants exact_cp WHERE exact_cp.conversation_id=c.id)=2
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=caller.uid AND b.blocked_id=other.user_id) OR (b.blocker_id=other.user_id AND b.blocked_id=caller.uid))
  ),
  direct_rows AS (
    SELECT ('person:'||p.id)::text AS key, 'direct'::text AS target_kind,
      d.conversation_id AS target_id, p.id AS person_user_id,
      COALESCE(NULLIF(btrim(p.display_name),''), NULLIF(btrim(p.username),'')) AS display_name,
      p.username, p.avatar_url, d.conversation_id, d.last_message_at, NULL::integer AS participant_count
    FROM direct_candidates d JOIN public.profiles p ON p.id=d.person_user_id
    WHERE d.rank=1 AND p.active IS TRUE
      AND COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')) IS NOT NULL
  ),
  group_rows AS (
    SELECT ('group:'||c.id)::text, 'group'::text, c.id, NULL::uuid,
      NULLIF(btrim(c.name),''), NULL::text, NULL::text,
      c.id, c.last_message_at, count(all_cp.user_id)::integer
    FROM caller
    JOIN public.conversation_participants mine ON mine.user_id=caller.uid
    JOIN public.conversations c ON c.id=mine.conversation_id
      AND c.type='group' AND c.is_enabled IS TRUE AND c.linked_entity_type <> 'support'
    JOIN public.conversation_participants all_cp ON all_cp.conversation_id=c.id
    WHERE public.can_insert_message_into_conversation(c.id,caller.uid)
      AND NULLIF(btrim(c.name),'') IS NOT NULL
    GROUP BY c.id,c.name,c.last_message_at
  ),
  friend_ids AS (
    SELECT CASE WHEN f.user_id=caller.uid THEN f.friend_user_id ELSE f.user_id END AS person_user_id
    FROM caller JOIN public.friends f ON (f.user_id=caller.uid OR f.friend_user_id=caller.uid)
    WHERE f.status='accepted' AND f.deleted_at IS NULL
  ),
  friend_rows AS (
    SELECT ('person:'||p.id)::text, 'friend'::text, p.id, p.id,
      COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')),
      p.username,p.avatar_url,NULL::uuid,NULL::timestamptz,NULL::integer
    FROM caller JOIN friend_ids f ON true JOIN public.profiles p ON p.id=f.person_user_id
    WHERE p.active IS TRUE
      AND COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM direct_rows d WHERE d.person_user_id=p.id)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=caller.uid AND b.blocked_id=p.id) OR (b.blocker_id=p.id AND b.blocked_id=caller.uid))
  )
  SELECT * FROM (
    SELECT * FROM direct_rows UNION ALL SELECT * FROM group_rows UNION ALL SELECT * FROM friend_rows
  ) recipients
  ORDER BY (last_message_at IS NULL), last_message_at DESC NULLS LAST, lower(display_name), key;
$function$;
REVOKE ALL ON FUNCTION public.list_content_share_recipients() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_content_share_recipients() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_content_share_message(
  p_operation_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_short_code text,
  p_share_version integer,
  p_sender_note text DEFAULT NULL,
  p_sender_note_grapheme_count integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sender uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_sender_note,'')), '');
  v_link public.content_share_links%ROWTYPE;
  v_version public.content_share_versions%ROWTYPE;
  v_existing public.content_share_message_deliveries%ROWTYPE;
  v_conversation uuid;
  v_other uuid;
  v_message uuid;
  v_payload jsonb;
  v_content text;
  v_kind_label text;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF p_operation_id IS NULL OR p_target_id IS NULL OR p_target_kind NOT IN ('direct','group','friend')
     OR p_short_code !~ '^[0-9A-Za-z]{16}$' OR p_share_version < 1 THEN
    RAISE EXCEPTION 'invalid_share_delivery' USING ERRCODE='22023';
  END IF;
  IF p_sender_note_grapheme_count IS NULL OR p_sender_note_grapheme_count NOT BETWEEN 0 AND 120
     OR char_length(COALESCE(v_note,'')) > 480 OR octet_length(COALESCE(v_note,'')) > 2048
     OR (v_note IS NULL AND p_sender_note_grapheme_count <> 0)
     OR (v_note IS NOT NULL AND p_sender_note_grapheme_count = 0) THEN
    RAISE EXCEPTION 'invalid_sender_note' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_sender::text||':'||p_operation_id::text||':'||p_target_kind||':'||p_target_id::text, 1719));
  SELECT * INTO v_existing FROM public.content_share_message_deliveries
   WHERE sender_id=v_sender AND operation_id=p_operation_id AND target_kind=p_target_kind AND target_id=p_target_id;
  IF FOUND THEN
    IF v_existing.short_code<>p_short_code OR v_existing.share_version<>p_share_version
       OR COALESCE(v_existing.sender_note,'')<>COALESCE(v_note,'')
       OR v_existing.sender_note_grapheme_count<>p_sender_note_grapheme_count THEN
      RAISE EXCEPTION 'idempotency_identity_mismatch' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('deliveryId',v_existing.id,'conversationId',v_existing.conversation_id,'messageId',v_existing.message_id,'inserted',false);
  END IF;

  SELECT * INTO v_link FROM public.content_share_links
   WHERE short_code=p_short_code FOR SHARE;
  IF NOT FOUND OR v_link.state<>'active' OR v_link.current_version<>p_share_version
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at<=now()) THEN
    RAISE EXCEPTION 'share_unavailable' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_version FROM public.content_share_versions
   WHERE link_id=v_link.id AND version=p_share_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'share_version_unavailable' USING ERRCODE='22023'; END IF;

  IF p_target_kind IN ('direct','group') THEN
    SELECT c.id INTO v_conversation FROM public.conversations c
    WHERE c.id=p_target_id AND c.is_enabled IS TRUE
      AND ((p_target_kind='direct' AND c.type='direct' AND c.linked_entity_type='direct')
        OR (p_target_kind='group' AND c.type='group' AND c.linked_entity_type<>'support'))
      AND EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id=c.id AND cp.user_id=v_sender)
      AND (p_target_kind<>'direct' OR (SELECT count(DISTINCT exact_cp.user_id) FROM public.conversation_participants exact_cp WHERE exact_cp.conversation_id=c.id)=2)
      AND public.can_insert_message_into_conversation(c.id,v_sender);
    IF v_conversation IS NULL THEN RAISE EXCEPTION 'target_unavailable' USING ERRCODE='42501'; END IF;
    IF p_target_kind='direct' THEN
      SELECT cp.user_id INTO v_other FROM public.conversation_participants cp
       WHERE cp.conversation_id=v_conversation AND cp.user_id<>v_sender LIMIT 1;
      IF v_other IS NULL OR EXISTS (SELECT 1 FROM public.blocked_users b WHERE (b.blocker_id=v_sender AND b.blocked_id=v_other) OR (b.blocker_id=v_other AND b.blocked_id=v_sender)) THEN
        RAISE EXCEPTION 'target_unavailable' USING ERRCODE='42501';
      END IF;
    END IF;
  ELSE
    v_other:=p_target_id;
    IF v_other=v_sender OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_other AND p.active IS TRUE)
      OR EXISTS (SELECT 1 FROM public.blocked_users b WHERE (b.blocker_id=v_sender AND b.blocked_id=v_other) OR (b.blocker_id=v_other AND b.blocked_id=v_sender))
      OR NOT (EXISTS (SELECT 1 FROM public.friends f WHERE f.status='accepted' AND f.deleted_at IS NULL AND ((f.user_id=v_sender AND f.friend_user_id=v_other) OR (f.user_id=v_other AND f.friend_user_id=v_sender)))
        OR EXISTS (SELECT 1 FROM public.pairings p WHERE p.user_a_id=LEAST(v_sender,v_other) AND p.user_b_id=GREATEST(v_sender,v_other))) THEN
      RAISE EXCEPTION 'target_unavailable' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_sender,v_other)::text||':'||GREATEST(v_sender,v_other)::text,1719));
    SELECT c.id INTO v_conversation FROM public.conversations c
      JOIN public.conversation_participants a ON a.conversation_id=c.id AND a.user_id=v_sender
      JOIN public.conversation_participants b ON b.conversation_id=c.id AND b.user_id=v_other
      WHERE c.type='direct' AND c.linked_entity_type='direct' AND c.is_enabled IS TRUE
        AND (SELECT count(DISTINCT exact_cp.user_id) FROM public.conversation_participants exact_cp WHERE exact_cp.conversation_id=c.id)=2
      ORDER BY c.last_message_at DESC NULLS LAST,c.updated_at DESC,c.id LIMIT 1;
    IF v_conversation IS NULL THEN
      INSERT INTO public.conversations(type,linked_entity_type,created_by,is_enabled,is_broadcast_only)
        VALUES('direct','direct',v_sender,true,false) RETURNING id INTO v_conversation;
      INSERT INTO public.conversation_participants(conversation_id,user_id)
        VALUES(v_conversation,v_sender),(v_conversation,v_other);
    END IF;
  END IF;

  v_kind_label:=CASE v_link.entity_kind WHEN 'rsvp_event' THEN 'RSVP event' WHEN 'curated' THEN 'Curated plan' ELSE initcap(v_link.entity_kind) END;
  -- Exactly the immutable message used by external sharing, with the optional
  -- sender-authored note above it. No second formatter is allowed here.
  v_content:=concat_ws(E'\n',CASE WHEN v_note IS NULL THEN NULL ELSE 'From the sender: '||v_note END,v_version.message_text);
  v_payload:=jsonb_build_object(
    'contract','content_share_card_v1','id','content-share:'||p_short_code||':v'||p_share_version,
    'title',v_version.facts->>'title','category',v_kind_label,
    'image',CASE WHEN v_version.media_identity IS NULL THEN NULL ELSE 'https://usemingla.com/og/s/'||p_short_code||'/v'||p_share_version||'-r2.jpg' END,
    'shareCode',p_short_code,'shareVersion',p_share_version,'kind',v_link.entity_kind,
    'facts',v_version.facts,'destination',v_version.destination_manifest-'publicDetails',
    'publicDetails',v_version.destination_manifest->'publicDetails','media',v_version.media_identity
  );
  IF v_note IS NOT NULL THEN v_payload:=v_payload||jsonb_build_object('senderNote',v_note); END IF;
  INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload)
    VALUES(v_conversation,v_sender,v_content,'card',v_payload) RETURNING id INTO v_message;
  UPDATE public.conversations SET last_message_at=now(),updated_at=now() WHERE id=v_conversation;
  INSERT INTO public.content_share_message_deliveries(sender_id,operation_id,target_kind,target_id,short_code,share_version,sender_note,sender_note_grapheme_count,conversation_id,message_id)
    VALUES(v_sender,p_operation_id,p_target_kind,p_target_id,p_short_code,p_share_version,v_note,p_sender_note_grapheme_count,v_conversation,v_message)
    RETURNING id INTO v_existing.id;
  RETURN jsonb_build_object('deliveryId',v_existing.id,'conversationId',v_conversation,'messageId',v_message,'inserted',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_content_share_message(uuid,text,uuid,text,integer,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_content_share_message(uuid,text,uuid,text,integer,text,integer) TO authenticated, service_role;

-- #1719 binding amendment: restatement of the latest effective live venue
-- listing creator (20270214001564) with only the appended poster identity.
DROP FUNCTION IF EXISTS public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL,
  p_coordinate_precision text DEFAULT '',
  -- issue #1564 — the venue's own theme. '' / NULL / unrecognised → NULL →
  -- inherit the brand. Appended last with defaults so an 18-arg named call
  -- from an older deployed client still resolves.
  p_theme_color text DEFAULT '',
  p_theme_font text DEFAULT '',
  p_theme_animation text DEFAULT '',
  -- #1719: stable still travels with the cover identity. Appended for
  -- positional compatibility with every previously shipped client.
  p_cover_media_poster_url text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_cover_poster text;
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
  v_theme_color text;
  v_theme_font text;
  v_theme_animation text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;
  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) <> 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;
  IF p_venue_category IS NULL OR p_venue_category NOT IN (
    'restaurant',
    'play',
    'creative_and_arts',
    'stay'
  ) THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;
  IF p_venue_category = 'stay' THEN
    SELECT COALESCE(flag.is_enabled, false)
    INTO v_stay_authoring_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
    IF NOT COALESCE(v_stay_authoring_enabled, false) THEN
      RAISE EXCEPTION 'stay_authoring_disabled';
    END IF;
  END IF;
  v_coordinate_precision := nullif(
    trim(coalesce(p_coordinate_precision, '')),
    ''
  );
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
  END IF;
  -- issue #1564 — normalise each theme axis INDEPENDENTLY. A bad font must not
  -- discard a good colour: the axes inherit separately by design.
  v_theme_color := nullif(trim(coalesce(p_theme_color, '')), '');
  IF v_theme_color IS NOT NULL AND v_theme_color !~* '^#[0-9a-f]{6}$' THEN
    v_theme_color := NULL;
  END IF;
  v_theme_font := nullif(trim(coalesce(p_theme_font, '')), '');
  IF v_theme_font IS NOT NULL AND v_theme_font NOT IN (
    'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
    'playfair_display','dm_serif_display','fraunces','lora',
    'bebas_neue','anton','unbounded','caveat','dancing_script'
  ) THEN
    v_theme_font := NULL;
  END IF;
  v_theme_animation := nullif(trim(coalesce(p_theme_animation, '')), '');
  IF v_theme_animation IS NOT NULL AND v_theme_animation NOT IN (
    'none','confetti','fireworks','balloons','sparkles',
    'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
  ) THEN
    v_theme_animation := NULL;
  END IF;
  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');
  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;
    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;
  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');
  IF v_cover_type IS NOT NULL
     AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;
  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;
  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;
  v_cover_poster := COALESCE(
    nullif(trim(coalesce(p_cover_media_poster_url, '')), ''),
    CASE WHEN v_cover_type = 'image' THEN v_cover_url END
  );
  PERFORM public.assert_cover_media_triplet(
    v_cover_url,
    v_cover_type,
    v_cover_poster
  );

  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_poster_url,
    cover_media_type,
    coordinate_precision,
    theme_color_override,
    theme_font_override,
    theme_animation_override,
    claim_status
  ) VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_poster,
    v_cover_type,
    v_coordinate_precision,
    v_theme_color,
    v_theme_font,
    v_theme_animation,
    'pending_review'
  )
  RETURNING id INTO v_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;
    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    ) VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL
          OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL
          OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  ) VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status =
        brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);
  RETURN v_venue_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) IS 'Issue #1463: event_manager+ may create pending-review venue listings for their own brand; publication and approval remain separately gated. Issue #1564: + p_theme_color/p_theme_font/p_theme_animation — the venue''s OWN theme, normalised per axis and fail-soft to NULL (inherit the brand) so a stale client can never block a submission over a colour. Issue #1719: the appended poster is validated and inserted atomically with URL/type.';


-- #1719 binding amendment: keep the retired hidden-brand creator fail-soft.
DROP FUNCTION IF EXISTS public.biz_create_venue_brand_authoring(
  text,text,text,text,double precision,double precision,text,text,text,text,text,
  text,text,text,jsonb,uuid
);
CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring(
  p_name text,p_slug text,p_description text,p_google_place_id text,
  p_lat double precision,p_lng double precision,p_city text,p_country_code text,
  p_address text,p_venue_category text,p_contact_email text,p_contact_phone text,
  p_cover_media_url text,p_cover_media_type text,p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL,p_cover_media_poster_url text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'venue_creation_moved:update_app';
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_create_venue_brand_authoring(
  text,text,text,text,double precision,double precision,text,text,text,text,text,
  text,text,text,jsonb,uuid,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_brand_authoring(
  text,text,text,text,double precision,double precision,text,text,text,text,text,
  text,text,text,jsonb,uuid,text
) TO authenticated;
COMMENT ON FUNCTION public.biz_create_venue_brand_authoring(
  text,text,text,text,double precision,double precision,text,text,text,text,text,
  text,text,text,jsonb,uuid,text
) IS '#1719 compatible poster argument; decommissioned fail-soft stub remains venue_creation_moved:update_app and creates no brand.';

COMMIT;
