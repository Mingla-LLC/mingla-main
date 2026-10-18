-- #3720 Completion Wave 7 — Host ideas, Q&A, moderation, appeals and cutover proof.
-- Host/community access is enforced inside SECURITY DEFINER RPCs. Base UGC,
-- reports and moderation records are never directly readable by clients.

BEGIN;

SELECT set_config(
  'issue3720_wave7.is_admin_user_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid='public.is_admin_user()'::regprocedure),
  true
);

CREATE OR REPLACE FUNCTION public.issue_3720_is_host_community_member(
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.brand_team_members btm
    WHERE btm.user_id=p_user_id
      AND btm.accepted_at IS NOT NULL
      AND btm.removed_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.issue_3720_is_host_community_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_is_host_community_member(uuid) TO authenticated;

CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('idea','question')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 3 AND 5000),
  review_state text NOT NULL CHECK (review_state IN ('pending','published','rejected','removed')),
  accepted_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_posts_feed_idx ON public.community_posts(kind,review_state,created_at DESC);
CREATE INDEX community_posts_author_idx ON public.community_posts(author_user_id,created_at);

CREATE TABLE public.community_post_votes (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(post_id,user_id)
);

CREATE TABLE public.community_post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 3000),
  review_state text NOT NULL DEFAULT 'published'
    CHECK (review_state IN ('published','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_posts
  ADD CONSTRAINT community_posts_accepted_comment_fk
  FOREIGN KEY (accepted_comment_id) REFERENCES public.community_post_comments(id) ON DELETE SET NULL;
CREATE INDEX community_post_comments_post_idx
  ON public.community_post_comments(post_id,created_at,id);

CREATE TABLE public.community_content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post','comment')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','actioned','dismissed')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reporter_user_id,target_type,target_id)
);
CREATE INDEX community_content_reports_queue_idx
  ON public.community_content_reports(state,created_at,id);

CREATE TABLE public.community_content_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appellant_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post','comment')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','upheld','restored')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appellant_user_id,target_type,target_id)
);
CREATE INDEX community_content_appeals_queue_idx
  ON public.community_content_appeals(state,created_at,id);

CREATE TABLE public.community_cutover_evidence (
  evidence_key text PRIMARY KEY CHECK (evidence_key IN (
    'delivery_proof','release_records','clickup_export','clickup_reconciliation',
    'clickup_archival','native_live_proof','board_progress','agent_seats'
  )),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','verified','not_applicable')),
  evidence_ref text,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.community_cutover_evidence(evidence_key) VALUES
  ('delivery_proof'),('release_records'),('clickup_export'),('clickup_reconciliation'),
  ('clickup_archival'),('native_live_proof'),('board_progress'),('agent_seats')
ON CONFLICT DO NOTHING;

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_content_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_cutover_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_posts,public.community_post_votes,
  public.community_post_comments,public.community_content_reports,
  public.community_content_appeals,public.community_cutover_evidence
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.community_posts,public.community_post_votes,
  public.community_post_comments,public.community_content_reports,
  public.community_content_appeals,public.community_cutover_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_community_submit_post(
  p_kind text, p_title text, p_body text
) RETURNS TABLE(post_id uuid, review_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_prior integer; v_id uuid; v_state text;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_kind NOT IN ('idea','question') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023';
  END IF;
  IF char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 3 AND 160
     OR char_length(btrim(COALESCE(p_body,''))) NOT BETWEEN 3 AND 5000 THEN
    RAISE EXCEPTION 'invalid_content' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_prior FROM public.community_posts p WHERE p.author_user_id=v_uid;
  v_state:=CASE WHEN v_prior<3 THEN 'pending' ELSE 'published' END;
  INSERT INTO public.community_posts(author_user_id,kind,title,body,review_state)
  VALUES(v_uid,p_kind,btrim(p_title),btrim(p_body),v_state) RETURNING id INTO v_id;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(v_uid,'submit_'||p_kind,'community_post',v_id,jsonb_build_object('review_state',v_state));
  RETURN QUERY SELECT v_id,v_state;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_submit_post(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_submit_post(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_feed(p_kind text DEFAULT NULL)
RETURNS TABLE(
  id uuid,kind text,title text,body text,author_label text,review_state text,
  created_at timestamptz,vote_count bigint,comment_count bigint,
  voted_by_me boolean,is_mine boolean,accepted_comment_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p.id,p.kind,p.title,p.body,
    COALESCE(NULLIF(btrim(pr.display_name),''),'Host') AS author_label,
    p.review_state,p.created_at,
    (SELECT count(*) FROM public.community_post_votes v WHERE v.post_id=p.id),
    (SELECT count(*) FROM public.community_post_comments c
      WHERE c.post_id=p.id AND c.review_state='published'),
    EXISTS(SELECT 1 FROM public.community_post_votes v
      WHERE v.post_id=p.id AND v.user_id=auth.uid()),
    p.author_user_id=auth.uid(),p.accepted_comment_id
  FROM public.community_posts p
  LEFT JOIN public.profiles pr ON pr.id=p.author_user_id
  WHERE public.issue_3720_is_host_community_member(auth.uid())
    AND (p_kind IS NULL OR p.kind=p_kind)
    AND (p.review_state='published' OR p.author_user_id=auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id=auth.uid() AND b.blocked_id=p.author_user_id)
         OR (b.blocker_id=p.author_user_id AND b.blocked_id=auth.uid())
    )
  ORDER BY (SELECT count(*) FROM public.community_post_votes v WHERE v.post_id=p.id) DESC,
           p.created_at DESC,p.id;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_feed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_feed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_toggle_vote(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_now boolean;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid) OR NOT EXISTS(
    SELECT 1 FROM public.community_posts p WHERE p.id=p_post_id AND p.review_state='published'
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
        (b.blocker_id=v_uid AND b.blocked_id=p.author_user_id) OR
        (b.blocker_id=p.author_user_id AND b.blocked_id=v_uid))
  ) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  DELETE FROM public.community_post_votes v WHERE v.post_id=p_post_id AND v.user_id=v_uid;
  IF FOUND THEN v_now:=false;
  ELSE INSERT INTO public.community_post_votes(post_id,user_id) VALUES(p_post_id,v_uid); v_now:=true;
  END IF;
  RETURN v_now;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_toggle_vote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_toggle_vote(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_add_comment(p_post_id uuid,p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_id uuid; v_owner uuid; v_title text;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid) OR
     char_length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'not_authorized_or_invalid' USING ERRCODE='42501';
  END IF;
  SELECT author_user_id,title INTO v_owner,v_title FROM public.community_posts
  WHERE id=p_post_id AND review_state='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
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

CREATE OR REPLACE FUNCTION public.issue_3720_community_comments(p_post_id uuid)
RETURNS TABLE(id uuid,body text,author_label text,created_at timestamptz,is_mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT c.id,c.body,COALESCE(NULLIF(btrim(pr.display_name),''),'Host'),c.created_at,
    c.author_user_id=auth.uid()
  FROM public.community_post_comments c
  JOIN public.community_posts p ON p.id=c.post_id
  LEFT JOIN public.profiles pr ON pr.id=c.author_user_id
  WHERE c.post_id=p_post_id AND c.review_state='published'
    AND p.review_state='published'
    AND public.issue_3720_is_host_community_member(auth.uid())
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=auth.uid() AND b.blocked_id=p.author_user_id) OR
      (b.blocker_id=p.author_user_id AND b.blocked_id=auth.uid()))
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=auth.uid() AND b.blocked_id=c.author_user_id) OR
      (b.blocker_id=c.author_user_id AND b.blocked_id=auth.uid()))
  ORDER BY c.created_at,c.id;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_comments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_comments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_accept_answer(
  p_post_id uuid,p_comment_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.issue_3720_is_host_community_member(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  UPDATE public.community_posts p SET accepted_comment_id=p_comment_id,updated_at=now()
  WHERE p.id=p_post_id AND p.kind='question' AND p.author_user_id=auth.uid()
    AND p.review_state='published' AND EXISTS(
      SELECT 1 FROM public.community_post_comments c
      WHERE c.id=p_comment_id AND c.post_id=p.id AND c.review_state='published');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_accept_answer(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_accept_answer(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_report(
  p_target_type text,p_target_id uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_id uuid; v_author uuid;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid)
     OR p_target_type NOT IN ('post','comment')
     OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_report' USING ERRCODE='22023';
  END IF;
  IF p_target_type='post' THEN
    SELECT author_user_id INTO v_author FROM public.community_posts WHERE id=p_target_id AND review_state='published';
  ELSE
    SELECT author_user_id INTO v_author FROM public.community_post_comments WHERE id=p_target_id AND review_state='published';
  END IF;
  IF v_author IS NULL OR v_author=v_uid THEN RAISE EXCEPTION 'not_reportable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.community_content_reports(reporter_user_id,target_type,target_id,reason)
  VALUES(v_uid,p_target_type,p_target_id,btrim(p_reason))
  ON CONFLICT(reporter_user_id,target_type,target_id) DO UPDATE SET reason=EXCLUDED.reason,state='open',created_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_report(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_report(text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_block_author(
  p_target_type text,p_target_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_author uuid;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p_target_type='post' THEN SELECT author_user_id INTO v_author FROM public.community_posts WHERE id=p_target_id AND review_state='published';
  ELSIF p_target_type='comment' THEN SELECT author_user_id INTO v_author FROM public.community_post_comments WHERE id=p_target_id AND review_state='published';
  ELSE RAISE EXCEPTION 'invalid_target' USING ERRCODE='22023'; END IF;
  IF v_author IS NULL OR v_author=v_uid THEN RAISE EXCEPTION 'not_blockable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.blocked_users(blocker_id,blocked_id,reason)
  VALUES(v_uid,v_author,'community') ON CONFLICT(blocker_id,blocked_id) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_block_author(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_block_author(text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_appeal(
  p_target_type text,p_target_id uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_id uuid; v_allowed boolean:=false;
BEGIN
  IF NOT public.issue_3720_is_host_community_member(v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_target_type='post' THEN
    SELECT EXISTS(SELECT 1 FROM public.community_posts WHERE id=p_target_id AND author_user_id=v_uid AND review_state IN ('rejected','removed')) INTO v_allowed;
  ELSIF p_target_type='comment' THEN
    SELECT EXISTS(SELECT 1 FROM public.community_post_comments WHERE id=p_target_id AND author_user_id=v_uid AND review_state='removed') INTO v_allowed;
  END IF;
  IF NOT v_allowed OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'not_appealable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.community_content_appeals(appellant_user_id,target_type,target_id,reason)
  VALUES(v_uid,p_target_type,p_target_id,btrim(p_reason))
  ON CONFLICT(appellant_user_id,target_type,target_id) DO UPDATE SET reason=EXCLUDED.reason,state='open',reviewed_by=NULL,reviewed_at=NULL,created_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_appeal(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_appeal(text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_moderation_queue()
RETURNS TABLE(queue_type text,record_id uuid,target_type text,target_id uuid,title text,body text,reason text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.community_can('moderate',auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT q.queue_type,q.record_id,q.target_type,q.target_id,q.title,q.body,q.reason,q.created_at
  FROM (
    SELECT 'post_review'::text AS queue_type,p.id AS record_id,'post'::text AS target_type,
      p.id AS target_id,p.title,p.body,NULL::text AS reason,p.created_at
      FROM public.community_posts p WHERE p.review_state='pending'
    UNION ALL
    SELECT 'report'::text,r.id,r.target_type,r.target_id,NULL::text,NULL::text,r.reason,r.created_at
      FROM public.community_content_reports r WHERE r.state='open'
    UNION ALL
    SELECT 'appeal'::text,a.id,a.target_type,a.target_id,NULL::text,NULL::text,a.reason,a.created_at
      FROM public.community_content_appeals a WHERE a.state='open'
  ) q
  ORDER BY q.created_at,q.record_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_moderation_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_moderation_queue() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_moderate(
  p_queue_type text,p_record_id uuid,p_action text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_target_type text; v_target_id uuid;
BEGIN
  IF NOT public.community_can('moderate',auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p_queue_type='post_review' THEN
    IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
    UPDATE public.community_posts SET review_state=CASE WHEN p_action='approve' THEN 'published' ELSE 'rejected' END,updated_at=now()
      WHERE id=p_record_id AND review_state='pending';
  ELSIF p_queue_type='report' THEN
    SELECT target_type,target_id INTO v_target_type,v_target_id FROM public.community_content_reports WHERE id=p_record_id AND state='open' FOR UPDATE;
    IF NOT FOUND OR p_action NOT IN ('remove','dismiss') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
    IF p_action='remove' AND v_target_type='post' THEN UPDATE public.community_posts SET review_state='removed',updated_at=now() WHERE id=v_target_id;
    ELSIF p_action='remove' THEN UPDATE public.community_post_comments SET review_state='removed',updated_at=now() WHERE id=v_target_id;
    END IF;
    UPDATE public.community_content_reports SET state=CASE WHEN p_action='remove' THEN 'actioned' ELSE 'dismissed' END,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_record_id;
  ELSIF p_queue_type='appeal' THEN
    SELECT target_type,target_id INTO v_target_type,v_target_id FROM public.community_content_appeals WHERE id=p_record_id AND state='open' FOR UPDATE;
    IF NOT FOUND OR p_action NOT IN ('restore','uphold') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
    IF p_action='restore' AND v_target_type='post' THEN UPDATE public.community_posts SET review_state='published',updated_at=now() WHERE id=v_target_id;
    ELSIF p_action='restore' THEN UPDATE public.community_post_comments SET review_state='published',updated_at=now() WHERE id=v_target_id;
    END IF;
    UPDATE public.community_content_appeals SET state=CASE WHEN p_action='restore' THEN 'restored' ELSE 'upheld' END,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_record_id;
  ELSE RAISE EXCEPTION 'invalid_queue_type' USING ERRCODE='22023'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'moderate_'||p_action,p_queue_type,p_record_id,'{}');
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_moderate(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_moderate(text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_cutover_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_pending bigint; v_reports bigint; v_appeals bigint; v_missing bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_pending FROM public.community_posts WHERE review_state='pending';
  SELECT count(*) INTO v_reports FROM public.community_content_reports WHERE state='open';
  SELECT count(*) INTO v_appeals FROM public.community_content_appeals WHERE state='open';
  SELECT count(*) INTO v_missing FROM public.community_cutover_evidence WHERE state='pending';
  RETURN jsonb_build_object('pending_posts',v_pending,'open_reports',v_reports,'open_appeals',v_appeals,
    'pending_evidence',v_missing,'ready',v_pending=0 AND v_reports=0 AND v_appeals=0 AND v_missing=0,
    'evidence',(SELECT jsonb_agg(jsonb_build_object('key',evidence_key,'state',state,'evidence_ref',evidence_ref) ORDER BY evidence_key) FROM public.community_cutover_evidence));
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_cutover_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_cutover_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_record_cutover_evidence(
  p_key text,p_state text,p_evidence_ref text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin_user() OR p_state NOT IN ('verified','not_applicable')
     OR NULLIF(btrim(COALESCE(p_evidence_ref,'')),'') IS NULL THEN
    RAISE EXCEPTION 'not_authorized_or_invalid' USING ERRCODE='42501';
  END IF;
  IF p_key='clickup_archival' AND EXISTS(
    SELECT 1 FROM public.community_cutover_evidence
    WHERE evidence_key IN ('clickup_export','clickup_reconciliation') AND state='pending'
  ) THEN RAISE EXCEPTION 'clickup_reconciliation_required' USING ERRCODE='23514'; END IF;
  IF p_key='agent_seats' AND EXISTS(
    SELECT 1 FROM public.community_cutover_evidence
    WHERE evidence_key<>'agent_seats' AND state='pending'
  ) THEN RAISE EXCEPTION 'agent_seats_last' USING ERRCODE='23514'; END IF;
  UPDATE public.community_cutover_evidence SET state=p_state,evidence_ref=btrim(p_evidence_ref),
    verified_by=auth.uid(),verified_at=now(),updated_at=now() WHERE evidence_key=p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_key' USING ERRCODE='22023'; END IF;
  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,metadata)
  VALUES(auth.uid(),'record_cutover_evidence','community_cutover',jsonb_build_object('key',p_key,'state',p_state));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_record_cutover_evidence(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_record_cutover_evidence(text,text,text) TO authenticated;

INSERT INTO public.notification_categories(key,section,is_transactional,urgency,default_channels,reach_mode,active)
VALUES('business.community_reply','community',false,'normal',ARRAY['inapp']::text[],'reach_once',true)
ON CONFLICT(key) DO UPDATE SET default_channels=EXCLUDED.default_channels,active=true;

DO $publication$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='community_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_posts;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='community_post_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_post_comments;
  END IF;
END $publication$;

DO $guard$
BEGIN
  IF current_setting('issue3720_wave7.is_admin_user_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid='public.is_admin_user()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_is_admin_user_changed';
  END IF;
END $guard$;

COMMIT;
