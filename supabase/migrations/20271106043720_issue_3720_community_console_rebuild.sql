-- #3720 Admin Community console read models and audited staff actions.
--
-- Invariant #3720-C1: Host Community content remains private behind DEFINER
-- RPCs; only Admin and enabled Community moderators may use staff workflows.
-- Invariant #3720-C2: every staff-authored answer, triage change, moderation
-- decision, pause and merge is written to community_audit_log.
-- Invariant #3720-C3: Host posting pauses affect writes only. Paused Hosts can
-- still read, vote and follow Community discussions.

BEGIN;

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS idea_status text,
  ADD COLUMN IF NOT EXISTS public_response text,
  ADD COLUMN IF NOT EXISTS idea_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merged_into_post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_roadmap_card_id uuid REFERENCES public.community_roadmap_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

UPDATE public.community_posts
SET idea_status = 'new'
WHERE kind = 'idea' AND idea_status IS NULL;

ALTER TABLE public.community_posts
  DROP CONSTRAINT IF EXISTS community_posts_idea_status_check;
ALTER TABLE public.community_posts
  ADD CONSTRAINT community_posts_idea_status_check CHECK (
    (kind = 'idea' AND idea_status IN ('new','under_review','planned','in_progress','shipped','not_now'))
    OR (kind = 'question' AND idea_status IS NULL)
  );

ALTER TABLE public.community_post_comments
  ADD COLUMN IF NOT EXISTS staff_answer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_display_name text;

ALTER TABLE public.community_announcements
  ADD COLUMN IF NOT EXISTS action_line text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

ALTER TABLE public.community_roadmap_cards
  DROP CONSTRAINT IF EXISTS community_roadmap_cards_lane_check;
ALTER TABLE public.community_roadmap_cards
  ADD CONSTRAINT community_roadmap_cards_lane_check
  CHECK (lane IN ('now','next','later','shipped'));
ALTER TABLE public.community_roadmap_cards
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_label text,
  ADD COLUMN IF NOT EXISTS idea_count integer NOT NULL DEFAULT 0 CHECK (idea_count >= 0);

UPDATE public.community_roadmap_cards
SET shipped_at = COALESCE(shipped_at, updated_at)
WHERE lane = 'shipped';

CREATE OR REPLACE VIEW public.community_roadmap_public
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.public_title,
  c.public_body,
  c.lane,
  c.status,
  c.sort_order,
  c.created_at,
  c.updated_at,
  c.shipped_at,
  c.target_label,
  c.idea_count
FROM public.community_roadmap_cards c
WHERE c.status = 'published';
GRANT SELECT ON public.community_roadmap_public TO authenticated, anon;

CREATE TABLE IF NOT EXISTS public.community_posting_pauses (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  paused_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_posting_pauses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_posting_pauses FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_posting_pauses TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_community_filter_match(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT CASE
    WHEN COALESCE(p_text,'') ~* '([+][0-9][0-9 ()-]{7,}|[0-9][0-9 ()-]{9,})' THEN 'phone number detected'
    WHEN COALESCE(p_text,'') ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}' THEN 'email address detected'
    WHEN COALESCE(p_text,'') ~* '\m(account number|bank details|routing number|sort code)\M' THEN 'bank details detected'
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_filter_match(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_filter_match(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_submit_post(
  p_kind text, p_title text, p_body text
) RETURNS TABLE(post_id uuid, review_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_prior integer; v_id uuid; v_state text;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_posting_pauses pp
    WHERE pp.user_id=v_uid AND (pp.paused_until IS NULL OR pp.paused_until>now())
  ) THEN RAISE EXCEPTION 'posting_paused' USING ERRCODE='42501'; END IF;
  IF p_kind NOT IN ('idea','question') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 3 AND 160
     OR char_length(btrim(COALESCE(p_body,''))) NOT BETWEEN 3 AND 5000 THEN
    RAISE EXCEPTION 'invalid_content' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_prior FROM public.community_posts p WHERE p.author_user_id=v_uid;
  v_state:=CASE
    WHEN v_prior<3 OR public.issue_3720_community_filter_match(p_title||' '||p_body) IS NOT NULL THEN 'pending'
    ELSE 'published'
  END;
  INSERT INTO public.community_posts(author_user_id,kind,title,body,review_state,idea_status)
  VALUES(v_uid,p_kind,btrim(p_title),btrim(p_body),v_state,CASE WHEN p_kind='idea' THEN 'new' END)
  RETURNING id INTO v_id;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(v_uid,'submit_'||p_kind,'community_post',v_id,jsonb_build_object('review_state',v_state));
  RETURN QUERY SELECT v_id,v_state;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_submit_post(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_submit_post(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_add_comment(p_post_id uuid,p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_id uuid; v_owner uuid; v_title text;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid)
     OR char_length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'not_authorized_or_invalid' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_posting_pauses pp
    WHERE pp.user_id=v_uid AND (pp.paused_until IS NULL OR pp.paused_until>now())) THEN
    RAISE EXCEPTION 'posting_paused' USING ERRCODE='42501';
  END IF;
  SELECT author_user_id,title INTO v_owner,v_title FROM public.community_posts
  WHERE id=p_post_id AND review_state='published' AND locked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found_or_locked' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.blocked_users b WHERE
    (b.blocker_id=v_uid AND b.blocked_id=v_owner) OR
    (b.blocker_id=v_owner AND b.blocked_id=v_uid)) THEN
    RAISE EXCEPTION 'blocked' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.community_post_comments(post_id,author_user_id,body)
  VALUES(p_post_id,v_uid,btrim(p_body)) RETURNING id INTO v_id;
  IF v_owner<>v_uid THEN
    INSERT INTO public.notification_outbox(category_key,user_id,country_code,payload,idempotency_key,status)
    VALUES('business.community_reply',v_owner,NULL,
      jsonb_build_object('type','business.community_reply','post_id',p_post_id,
        'comment_id',v_id,'title','New Community reply','body','Someone replied to "'||left(v_title,120)||'"',
        'deep_link','mingla-business://community/post/'||p_post_id::text),
      'business.community_reply:'||v_id::text||':'||v_owner::text,'pending')
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_add_comment(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_add_comment(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_list_posts(
  p_kind text,
  p_filter text DEFAULT NULL
) RETURNS TABLE(
  id uuid, title text, body text, author_label text, author_user_id uuid,
  review_state text, workflow_status text, public_response text,
  vote_count bigint, comment_count bigint, created_at timestamptz,
  pinned boolean, locked boolean, merged_into_post_id uuid,
  promoted_roadmap_card_id uuid, staff_answered boolean, duplicate_hint jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_kind NOT IN ('idea','question') OR NOT public.community_can('moderate',auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT p.id,p.title,p.body,
    COALESCE(NULLIF(btrim(pr.display_name),''),'Host'),p.author_user_id,
    p.review_state,CASE WHEN p.kind='idea' THEN p.idea_status ELSE
      CASE WHEN p.locked_at IS NOT NULL THEN 'locked'
           WHEN EXISTS(SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer) THEN 'answered'
           ELSE 'unanswered' END END,
    p.public_response,
    (SELECT count(*) FROM public.community_post_votes v WHERE v.post_id=p.id),
    (SELECT count(*) FROM public.community_post_comments c WHERE c.post_id=p.id AND c.review_state='published'),
    p.created_at,p.pinned_at IS NOT NULL,p.locked_at IS NOT NULL,p.merged_into_post_id,
    p.promoted_roadmap_card_id,
    EXISTS(SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published'),
    CASE WHEN p.kind='idea' THEN (
      SELECT jsonb_build_object('id',d.id,'title',d.title,'votes',
        (SELECT count(*) FROM public.community_post_votes dv WHERE dv.post_id=d.id))
      FROM public.community_posts d
      WHERE d.kind='idea' AND d.id<>p.id AND d.review_state='published'
        AND extensions.similarity(lower(d.title),lower(p.title)) >= 0.35
      ORDER BY extensions.similarity(lower(d.title),lower(p.title)) DESC,d.created_at
      LIMIT 1
    ) END
  FROM public.community_posts p
  LEFT JOIN public.profiles pr ON pr.id=p.author_user_id
  WHERE p.kind=p_kind
    AND (p_filter IS NULL OR p_filter='all'
      OR (p.kind='idea' AND p.idea_status=p_filter)
      OR (p.kind='question' AND p_filter='unanswered' AND p.locked_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published'))
      OR (p.kind='question' AND p_filter='answered' AND EXISTS(SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published'))
      OR (p.kind='question' AND p_filter='locked' AND p.locked_at IS NOT NULL))
  ORDER BY CASE WHEN p.kind='question' AND NOT EXISTS(
      SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published'
    ) THEN 0 ELSE 1 END,p.created_at,p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_list_posts(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_list_posts(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_update_idea(
  p_post_id uuid,
  p_status text,
  p_public_response text DEFAULT NULL,
  p_merge_into uuid DEFAULT NULL,
  p_promote boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_post public.community_posts%ROWTYPE; v_roadmap uuid; v_revision integer; v_notified integer:=0;
BEGIN
  IF NOT public.community_can('moderate',auth.uid()) OR p_status NOT IN
    ('new','under_review','planned','in_progress','shipped','not_now') THEN
    RAISE EXCEPTION 'not_authorized_or_invalid' USING ERRCODE='42501';
  END IF;
  IF p_status='not_now' AND NULLIF(btrim(COALESCE(p_public_response,'')),'') IS NULL THEN
    RAISE EXCEPTION 'public_response_required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_post FROM public.community_posts WHERE id=p_post_id AND kind='idea' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p_merge_into IS NOT NULL THEN
    IF p_merge_into=p_post_id OR NOT EXISTS(SELECT 1 FROM public.community_posts WHERE id=p_merge_into AND kind='idea' AND review_state='published') THEN
      RAISE EXCEPTION 'invalid_merge_target' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.community_post_votes(post_id,user_id)
    SELECT p_merge_into,user_id FROM public.community_post_votes WHERE post_id=p_post_id
    ON CONFLICT DO NOTHING;
    UPDATE public.community_posts SET review_state='removed',merged_into_post_id=p_merge_into,updated_at=now()
    WHERE id=p_post_id;
  ELSE
    UPDATE public.community_posts SET idea_status=p_status,
      public_response=NULLIF(btrim(COALESCE(p_public_response,'')),''),
      idea_revision=idea_revision+1,updated_at=now()
    WHERE id=p_post_id RETURNING idea_revision INTO v_revision;
  END IF;
  IF p_promote THEN
    INSERT INTO public.community_roadmap_cards(public_title,public_body,internal_note,lane,status,sort_order,idea_count)
    VALUES(v_post.title,left(v_post.body,140),'Promoted from Community idea '||p_post_id::text,'next','draft',
      (SELECT COALESCE(max(sort_order),-1)+1 FROM public.community_roadmap_cards),
      (SELECT count(*) FROM public.community_post_votes WHERE post_id=p_post_id))
    RETURNING id INTO v_roadmap;
    UPDATE public.community_posts SET promoted_roadmap_card_id=v_roadmap,updated_at=now() WHERE id=p_post_id;
  END IF;
  WITH recipients AS (
    SELECT v_post.author_user_id AS user_id UNION
    SELECT user_id FROM public.community_post_votes WHERE post_id=p_post_id
  ), ins AS (
    INSERT INTO public.notification_outbox(category_key,user_id,country_code,payload,idempotency_key,status)
    SELECT 'business.community_reply',r.user_id,NULL,
      jsonb_build_object('type','business.community_reply','post_id',p_post_id,'title','Idea updated',
        'body',CASE WHEN p_merge_into IS NULL THEN 'Mingla updated "'||left(v_post.title,100)||'" to '||replace(p_status,'_',' ')
                    ELSE 'Mingla merged "'||left(v_post.title,100)||'" into a related idea' END,
        'deep_link','mingla-business://community/post/'||COALESCE(p_merge_into,p_post_id)::text),
      'business.community.idea:'||p_post_id::text||':'||COALESCE(v_revision,0)::text||':'||r.user_id::text,'pending'
    FROM recipients r ON CONFLICT(idempotency_key) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_notified FROM ins;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),CASE WHEN p_merge_into IS NULL THEN 'update_idea' ELSE 'merge_idea' END,
    'community_post',p_post_id,jsonb_build_object('status',p_status,'merge_into',p_merge_into,'roadmap_card_id',v_roadmap,'notified',v_notified));
  RETURN jsonb_build_object('roadmap_card_id',v_roadmap,'notified',v_notified);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_update_idea(uuid,text,text,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_update_idea(uuid,text,text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_question_action(
  p_post_id uuid,
  p_action text,
  p_answer text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid; v_title text; v_comment uuid; v_name text;
BEGIN
  IF NOT public.community_can('moderate',auth.uid()) OR p_action NOT IN ('answer','pin','unpin','lock','unlock','hide') THEN
    RAISE EXCEPTION 'not_authorized_or_invalid' USING ERRCODE='42501';
  END IF;
  SELECT author_user_id,title INTO v_owner,v_title FROM public.community_posts
  WHERE id=p_post_id AND kind='question' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p_action='answer' THEN
    IF char_length(btrim(COALESCE(p_answer,''))) NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'answer_required' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(NULLIF(btrim(p.display_name),''),split_part(u.email,'@',1),'Mingla team') INTO v_name
    FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=auth.uid();
    INSERT INTO public.community_post_comments(post_id,author_user_id,body,staff_answer,staff_display_name)
    VALUES(p_post_id,auth.uid(),btrim(p_answer),true,v_name) RETURNING id INTO v_comment;
    INSERT INTO public.notification_outbox(category_key,user_id,country_code,payload,idempotency_key,status)
    VALUES('business.community_reply',v_owner,NULL,
      jsonb_build_object('type','business.community_reply','post_id',p_post_id,'comment_id',v_comment,
        'title','Mingla answered your question','body',left(v_title,120),
        'deep_link','mingla-business://community/post/'||p_post_id::text),
      'business.community.staff_answer:'||v_comment::text||':'||v_owner::text,'pending')
    ON CONFLICT(idempotency_key) DO NOTHING;
  ELSIF p_action='pin' THEN UPDATE public.community_posts SET pinned_at=now(),updated_at=now() WHERE id=p_post_id;
  ELSIF p_action='unpin' THEN UPDATE public.community_posts SET pinned_at=NULL,updated_at=now() WHERE id=p_post_id;
  ELSIF p_action='lock' THEN UPDATE public.community_posts SET locked_at=now(),updated_at=now() WHERE id=p_post_id;
  ELSIF p_action='unlock' THEN UPDATE public.community_posts SET locked_at=NULL,updated_at=now() WHERE id=p_post_id;
  ELSE UPDATE public.community_posts SET review_state='removed',hidden_reason='Hidden by Community staff',updated_at=now() WHERE id=p_post_id;
  END IF;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'question_'||p_action,'community_post',p_post_id,
    jsonb_build_object('comment_id',v_comment,'staff_display_name',v_name));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_question_action(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_question_action(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_moderation_workspace(p_section text DEFAULT 'reports')
RETURNS TABLE(
  queue_type text, record_id uuid, target_type text, target_id uuid,
  title text, body text, reason text, author_user_id uuid, author_label text,
  created_at timestamptz, due_at timestamptz, filter_match text, metadata jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.community_can('moderate',auth.uid()) OR p_section NOT IN
    ('reports','first_posts','appeals','hidden','paused_hosts','audit_log') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_section='reports' THEN RETURN QUERY
    SELECT 'report'::text,r.id,r.target_type,r.target_id,
      CASE WHEN r.target_type='post' THEN p.title ELSE NULL END,
      COALESCE(p.body,c.body),r.reason,COALESCE(p.author_user_id,c.author_user_id),
      COALESCE(NULLIF(btrim(pr.display_name),''),'Host'),r.created_at,r.created_at+interval '24 hours',
      public.issue_3720_community_filter_match(COALESCE(p.body,c.body)),
      jsonb_build_object('report_count',(SELECT count(*) FROM public.community_content_reports x WHERE x.target_type=r.target_type AND x.target_id=r.target_id AND x.state='open'))
    FROM public.community_content_reports r
    LEFT JOIN public.community_posts p ON r.target_type='post' AND p.id=r.target_id
    LEFT JOIN public.community_post_comments c ON r.target_type='comment' AND c.id=r.target_id
    LEFT JOIN public.profiles pr ON pr.id=COALESCE(p.author_user_id,c.author_user_id)
    WHERE r.state='open' ORDER BY r.created_at,r.id;
  ELSIF p_section='first_posts' THEN RETURN QUERY
    SELECT 'post_review'::text,p.id,'post'::text,p.id,p.title,p.body,NULL::text,p.author_user_id,
      COALESCE(NULLIF(btrim(pr.display_name),''),'Host'),p.created_at,p.created_at+interval '24 hours',
      public.issue_3720_community_filter_match(p.title||' '||p.body),jsonb_build_object('kind',p.kind)
    FROM public.community_posts p LEFT JOIN public.profiles pr ON pr.id=p.author_user_id
    WHERE p.review_state='pending' ORDER BY p.created_at,p.id;
  ELSIF p_section='appeals' THEN RETURN QUERY
    SELECT 'appeal'::text,a.id,a.target_type,a.target_id,
      CASE WHEN a.target_type='post' THEN p.title ELSE NULL END,COALESCE(p.body,c.body),a.reason,
      a.appellant_user_id,COALESCE(NULLIF(btrim(pr.display_name),''),'Host'),a.created_at,
      a.created_at+interval '72 hours',public.issue_3720_community_filter_match(COALESCE(p.body,c.body)),'{}'::jsonb
    FROM public.community_content_appeals a
    LEFT JOIN public.community_posts p ON a.target_type='post' AND p.id=a.target_id
    LEFT JOIN public.community_post_comments c ON a.target_type='comment' AND c.id=a.target_id
    LEFT JOIN public.profiles pr ON pr.id=a.appellant_user_id
    WHERE a.state='open' ORDER BY a.created_at,a.id;
  ELSIF p_section='hidden' THEN RETURN QUERY
    SELECT 'hidden'::text,p.id,'post'::text,p.id,p.title,p.body,p.hidden_reason,p.author_user_id,
      COALESCE(NULLIF(btrim(pr.display_name),''),'Host'),p.updated_at,NULL::timestamptz,
      public.issue_3720_community_filter_match(p.title||' '||p.body),jsonb_build_object('kind',p.kind)
    FROM public.community_posts p LEFT JOIN public.profiles pr ON pr.id=p.author_user_id
    WHERE p.review_state IN ('rejected','removed') ORDER BY p.updated_at DESC,p.id;
  ELSIF p_section='paused_hosts' THEN RETURN QUERY
    SELECT 'paused_host'::text,pp.user_id,'host'::text,pp.user_id,NULL::text,NULL::text,pp.reason,
      pp.user_id,COALESCE(NULLIF(btrim(pr.display_name),''),split_part(u.email,'@',1),'Host'),pp.created_at,
      pp.paused_until,NULL::text,jsonb_build_object('paused_until',pp.paused_until)
    FROM public.community_posting_pauses pp JOIN auth.users u ON u.id=pp.user_id
    LEFT JOIN public.profiles pr ON pr.id=pp.user_id
    WHERE pp.paused_until IS NULL OR pp.paused_until>now() ORDER BY pp.created_at DESC;
  ELSE RETURN QUERY
    SELECT 'audit'::text,a.id,COALESCE(a.entity_type,'community')::text,a.entity_id,NULL::text,NULL::text,a.action,
      a.actor_user_id,COALESCE(NULLIF(btrim(pr.display_name),''),split_part(u.email,'@',1),'Mingla team'),
      a.created_at,NULL::timestamptz,NULL::text,COALESCE(a.metadata,'{}'::jsonb)
    FROM public.community_audit_log a LEFT JOIN auth.users u ON u.id=a.actor_user_id
    LEFT JOIN public.profiles pr ON pr.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_moderation_workspace(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_moderation_workspace(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_moderate(
  p_queue_type text,p_record_id uuid,p_action text,p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_target_type text; v_target_id uuid; v_author uuid; v_until timestamptz;
BEGIN
  IF NOT public.community_can('moderate',auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p_queue_type='post_review' THEN
    IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
    UPDATE public.community_posts SET review_state=CASE WHEN p_action='approve' THEN 'published' ELSE 'rejected' END,
      hidden_reason=CASE WHEN p_action='reject' THEN NULLIF(btrim(COALESCE(p_reason,'')),'') END,updated_at=now()
    WHERE id=p_record_id AND review_state='pending' RETURNING author_user_id INTO v_author;
  ELSIF p_queue_type='report' THEN
    SELECT target_type,target_id INTO v_target_type,v_target_id FROM public.community_content_reports WHERE id=p_record_id AND state='open' FOR UPDATE;
    IF NOT FOUND OR p_action NOT IN ('keep','hide','remove','pause_7','pause_30','pause_permanent') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
    IF v_target_type='post' THEN SELECT author_user_id INTO v_author FROM public.community_posts WHERE id=v_target_id;
    ELSE SELECT author_user_id INTO v_author FROM public.community_post_comments WHERE id=v_target_id; END IF;
    IF p_action IN ('hide','remove') THEN
      IF v_target_type='post' THEN UPDATE public.community_posts SET review_state='removed',hidden_reason=COALESCE(NULLIF(btrim(p_reason),''),'Community guidelines'),updated_at=now() WHERE id=v_target_id;
      ELSE UPDATE public.community_post_comments SET review_state='removed',updated_at=now() WHERE id=v_target_id; END IF;
    END IF;
    IF p_action LIKE 'pause_%' THEN
      IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'host_visible_reason_required' USING ERRCODE='22023'; END IF;
      v_until:=CASE p_action WHEN 'pause_7' THEN now()+interval '7 days' WHEN 'pause_30' THEN now()+interval '30 days' ELSE NULL END;
      INSERT INTO public.community_posting_pauses(user_id,paused_by,reason,paused_until)
      VALUES(v_author,auth.uid(),btrim(p_reason),v_until)
      ON CONFLICT(user_id) DO UPDATE SET paused_by=EXCLUDED.paused_by,reason=EXCLUDED.reason,paused_until=EXCLUDED.paused_until,updated_at=now();
    END IF;
    UPDATE public.community_content_reports SET state=CASE WHEN p_action='keep' THEN 'dismissed' ELSE 'actioned' END,
      reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_record_id;
  ELSIF p_queue_type='appeal' THEN
    SELECT target_type,target_id INTO v_target_type,v_target_id FROM public.community_content_appeals WHERE id=p_record_id AND state='open' FOR UPDATE;
    IF NOT FOUND OR p_action NOT IN ('restore','uphold') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
    IF p_action='restore' AND v_target_type='post' THEN UPDATE public.community_posts SET review_state='published',hidden_reason=NULL,updated_at=now() WHERE id=v_target_id;
    ELSIF p_action='restore' THEN UPDATE public.community_post_comments SET review_state='published',updated_at=now() WHERE id=v_target_id; END IF;
    UPDATE public.community_content_appeals SET state=CASE WHEN p_action='restore' THEN 'restored' ELSE 'upheld' END,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_record_id;
  ELSIF p_queue_type='hidden' AND p_action='restore' THEN
    UPDATE public.community_posts SET review_state='published',hidden_reason=NULL,updated_at=now() WHERE id=p_record_id RETURNING author_user_id INTO v_author;
  ELSIF p_queue_type='paused_host' AND p_action='restore' THEN
    DELETE FROM public.community_posting_pauses WHERE user_id=p_record_id RETURNING user_id INTO v_author;
  ELSE RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'moderate_'||p_action,p_queue_type,p_record_id,
    jsonb_build_object('reason',NULLIF(btrim(COALESCE(p_reason,'')),''),'target_type',v_target_type,'target_id',v_target_id,'author_user_id',v_author));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_moderate(text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_moderate(text,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_announcement_deliveries()
RETURNS TABLE(
  id uuid,title text,body_md text,status text,published_at timestamptz,scheduled_at timestamptz,
  updated_at timestamptz,delivery jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT a.id,a.title,a.body_md,a.status,a.published_at,a.scheduled_at,a.updated_at,
    CASE WHEN c.id IS NULL THEN NULL ELSE public.community_get_announcement_notification_status(c.id) END
  FROM public.community_announcements a
  LEFT JOIN public.community_notification_campaigns c ON c.kind='announcement' AND c.source_id=a.id
  ORDER BY COALESCE(a.scheduled_at,a.published_at,a.updated_at) DESC,a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_announcement_deliveries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_announcement_deliveries() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_retry_announcement(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.is_admin_user() OR NOT EXISTS(
    SELECT 1 FROM public.community_notification_campaigns WHERE id=p_campaign_id AND kind='announcement'
  ) THEN RAISE EXCEPTION 'not_authorized_or_not_found' USING ERRCODE='42501'; END IF;
  UPDATE public.notification_outbox SET status='retry_wait',attempts=0,next_attempt_at=now(),processed_at=NULL,last_error=NULL
  WHERE payload->>'campaign_id'=p_campaign_id::text AND status='failed';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'retry_announcement','community_notification_campaign',p_campaign_id,jsonb_build_object('requeued',v_count));
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_retry_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_retry_announcement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_team_roster()
RETURNS TABLE(
  user_id uuid,display_name text,email text,community_role text,support_role text,
  available boolean,last_active timestamptz,enabled boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH people AS (
    SELECT u.id FROM auth.users u JOIN public.admin_users a ON lower(a.email)=lower(u.email) WHERE a.status='active'
    UNION SELECT user_id FROM public.community_staff WHERE enabled
    UNION SELECT user_id FROM public.support_staff WHERE enabled
  )
  SELECT u.id,
    COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(cs.display_name),''),NULLIF(btrim(ss.display_name),''),split_part(u.email,'@',1)),
    u.email,
    CASE WHEN a.status='active' THEN 'admin' ELSE cs.role END,
    ss.role,COALESCE(ss.available,false),GREATEST(u.last_sign_in_at,cs.updated_at,ss.updated_at),
    COALESCE(cs.enabled,ss.enabled,a.status='active',false)
  FROM people x JOIN auth.users u ON u.id=x.id
  LEFT JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.admin_users a ON lower(a.email)=lower(u.email)
  LEFT JOIN public.community_staff cs ON cs.user_id=u.id
  LEFT JOIN public.support_staff ss ON ss.user_id=u.id
  ORDER BY lower(COALESCE(NULLIF(btrim(p.display_name),''),u.email));
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_team_roster() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_team_roster() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT public.community_get_announcement_notification_status(NULL) INTO v_status;
  RETURN jsonb_build_object(
    'reports_due',(SELECT count(*) FROM public.community_content_reports WHERE state='open'),
    'reports_oldest',(SELECT min(created_at) FROM public.community_content_reports WHERE state='open'),
    'first_posts',(SELECT count(*) FROM public.community_posts WHERE review_state='pending'),
    'first_posts_oldest',(SELECT min(created_at) FROM public.community_posts WHERE review_state='pending'),
    'unanswered_tickets',(SELECT count(*) FROM public.support_tickets WHERE status IN ('new','open','pending')),
    'tickets_oldest',(SELECT min(COALESCE(last_message_at,created_at)) FROM public.support_tickets WHERE status IN ('new','open','pending')),
    'unanswered_questions',(SELECT count(*) FROM public.community_posts p WHERE p.kind='question' AND p.review_state='published' AND NOT EXISTS(SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published')),
    'questions_oldest',(SELECT min(p.created_at) FROM public.community_posts p WHERE p.kind='question' AND p.review_state='published' AND NOT EXISTS(SELECT 1 FROM public.community_post_comments c WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published')),
    'ideas_to_triage',(SELECT count(*) FROM public.community_posts WHERE kind='idea' AND review_state='published' AND idea_status='new'),
    'ideas_oldest',(SELECT min(created_at) FROM public.community_posts WHERE kind='idea' AND review_state='published' AND idea_status='new'),
    'last_announcement',v_status
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_upsert_roadmap_card(
  p_id uuid,p_public_title text,p_public_body text,p_internal_note text,p_lane text,p_status text DEFAULT 'draft'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_title text:=btrim(COALESCE(p_public_title,'')); v_lane text:=COALESCE(NULLIF(btrim(COALESCE(p_lane,'')),''),'now'); v_status text:=COALESCE(NULLIF(btrim(COALESCE(p_status,'')),''),'draft'); v_sort integer;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF v_lane NOT IN ('now','next','later','shipped') THEN RAISE EXCEPTION 'invalid_lane' USING ERRCODE='22023'; END IF;
  IF v_status NOT IN ('draft','published','archived') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
  IF p_id IS NULL THEN
    SELECT COALESCE(max(sort_order),-1)+1 INTO v_sort FROM public.community_roadmap_cards;
    INSERT INTO public.community_roadmap_cards(public_title,public_body,internal_note,lane,status,sort_order,shipped_at)
    VALUES(v_title,NULLIF(btrim(COALESCE(p_public_body,'')),''),NULLIF(btrim(COALESCE(p_internal_note,'')),''),v_lane,v_status,v_sort,CASE WHEN v_lane='shipped' THEN now() END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.community_roadmap_cards SET public_title=v_title,public_body=NULLIF(btrim(COALESCE(p_public_body,'')),''),
      internal_note=NULLIF(btrim(COALESCE(p_internal_note,'')),''),lane=v_lane,status=v_status,
      shipped_at=CASE WHEN v_lane='shipped' THEN COALESCE(shipped_at,now()) ELSE NULL END,updated_at=now()
    WHERE id=p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),CASE WHEN p_id IS NULL THEN 'create_roadmap_card' ELSE 'update_roadmap_card' END,'community_roadmap_card',v_id,jsonb_build_object('lane',v_lane,'status',v_status));
  RETURN v_id;
END;
$$;

COMMIT;
