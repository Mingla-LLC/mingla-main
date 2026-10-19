-- #3720 Host Help & Support presentation fields and host-safe Community reads.
--
-- MINGLA-INVARIANT: I-3720-HOST-COMMUNITY-PROJECTION | issue #3720 | Host
-- Community reads expose only published content plus the caller's own review
-- items. Staff-only notes and identity fields never enter these projections.

BEGIN;

ALTER TABLE public.community_announcements
  ADD COLUMN IF NOT EXISTS roadmap_card_id uuid
    REFERENCES public.community_roadmap_cards(id) ON DELETE SET NULL;

ALTER TABLE public.community_announcements
  DROP CONSTRAINT IF EXISTS community_announcements_action_line_length;
ALTER TABLE public.community_announcements
  ADD CONSTRAINT community_announcements_action_line_length
  CHECK (action_line IS NULL OR char_length(btrim(action_line)) BETWEEN 1 AND 500);

CREATE OR REPLACE FUNCTION public.issue_3720_admin_upsert_announcement(
  p_id uuid,
  p_title text,
  p_body_md text,
  p_action_line text DEFAULT NULL,
  p_roadmap_card_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_id uuid;
  v_title text:=btrim(COALESCE(p_title,''));
  v_body text:=btrim(COALESCE(p_body_md,''));
  v_action text:=NULLIF(btrim(COALESCE(p_action_line,'')),'');
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023';
  END IF;
  IF char_length(v_body)<1 OR char_length(COALESCE(v_action,''))>500 THEN
    RAISE EXCEPTION 'invalid_body_or_action' USING ERRCODE='22023';
  END IF;
  IF p_roadmap_card_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.community_roadmap_cards WHERE id=p_roadmap_card_id
  ) THEN RAISE EXCEPTION 'invalid_roadmap_card' USING ERRCODE='22023'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.community_announcements(
      title,body_md,action_line,roadmap_card_id,author_user_id
    ) VALUES(v_title,v_body,v_action,p_roadmap_card_id,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.community_announcements
    SET title=v_title,body_md=v_body,action_line=v_action,
        roadmap_card_id=p_roadmap_card_id,updated_at=now()
    WHERE id=p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;

  INSERT INTO public.community_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),CASE WHEN p_id IS NULL THEN 'create_announcement' ELSE 'update_announcement' END,
    'community_announcement',v_id,
    jsonb_build_object('title',v_title,'has_action',v_action IS NOT NULL,'roadmap_card_id',p_roadmap_card_id));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_upsert_announcement(uuid,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_upsert_announcement(uuid,text,text,text,uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.issue_3720_admin_announcement_deliveries();
CREATE FUNCTION public.issue_3720_admin_announcement_deliveries()
RETURNS TABLE(
  id uuid,title text,body_md text,action_line text,roadmap_card_id uuid,
  status text,published_at timestamptz,scheduled_at timestamptz,
  updated_at timestamptz,delivery jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT a.id,a.title,a.body_md,a.action_line,a.roadmap_card_id,a.status,
    a.published_at,a.scheduled_at,a.updated_at,
    CASE WHEN c.id IS NULL THEN NULL ELSE public.community_get_announcement_notification_status(c.id) END
  FROM public.community_announcements a
  LEFT JOIN public.community_notification_campaigns c
    ON c.kind='announcement' AND c.source_id=a.id
  ORDER BY COALESCE(a.scheduled_at,a.published_at,a.updated_at) DESC,a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_announcement_deliveries() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_announcement_deliveries() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_feed_v2(p_kind text DEFAULT NULL)
RETURNS TABLE(
  id uuid,kind text,title text,body text,author_label text,brand_label text,
  review_state text,created_at timestamptz,vote_count bigint,comment_count bigint,
  voted_by_me boolean,is_mine boolean,accepted_comment_id uuid,workflow_status text,
  public_response text,pinned boolean,locked boolean,staff_answered boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p.id,p.kind,p.title,p.body,
    COALESCE(NULLIF(btrim(pr.display_name),''),'Host') AS author_label,
    COALESCE(author_brand.name,'Independent Host') AS brand_label,
    p.review_state,p.created_at,
    (SELECT count(*) FROM public.community_post_votes v WHERE v.post_id=p.id),
    (SELECT count(*) FROM public.community_post_comments c
      WHERE c.post_id=p.id AND c.review_state='published'),
    EXISTS(SELECT 1 FROM public.community_post_votes v
      WHERE v.post_id=p.id AND v.user_id=auth.uid()),
    p.author_user_id=auth.uid(),p.accepted_comment_id,
    CASE WHEN p.kind='idea' THEN p.idea_status
      WHEN p.locked_at IS NOT NULL THEN 'locked'
      WHEN EXISTS(SELECT 1 FROM public.community_post_comments c
        WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published') THEN 'answered'
      ELSE 'unanswered' END,
    p.public_response,p.pinned_at IS NOT NULL,p.locked_at IS NOT NULL,
    EXISTS(SELECT 1 FROM public.community_post_comments c
      WHERE c.post_id=p.id AND c.staff_answer AND c.review_state='published')
  FROM public.community_posts p
  LEFT JOIN public.profiles pr ON pr.id=p.author_user_id
  LEFT JOIN LATERAL (
    SELECT b.name
    FROM public.brand_team_members btm
    JOIN public.brands b ON b.id=btm.brand_id AND b.deleted_at IS NULL
    WHERE btm.user_id=p.author_user_id AND btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL
    ORDER BY btm.accepted_at,b.id
    LIMIT 1
  ) author_brand ON true
  WHERE public.issue_3720_is_host_community_member(auth.uid())
    AND (p_kind IS NULL OR p.kind=p_kind)
    AND (p.review_state='published' OR p.author_user_id=auth.uid())
    AND NOT EXISTS(
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id=auth.uid() AND b.blocked_id=p.author_user_id)
         OR (b.blocker_id=p.author_user_id AND b.blocked_id=auth.uid())
    )
  ORDER BY (p.pinned_at IS NOT NULL) DESC,
    (SELECT count(*) FROM public.community_post_votes v WHERE v.post_id=p.id) DESC,
    p.created_at DESC,p.id;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_feed_v2(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_feed_v2(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_community_comments_v2(p_post_id uuid)
RETURNS TABLE(
  id uuid,body text,author_label text,created_at timestamptz,is_mine boolean,
  staff_answer boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT c.id,c.body,
    CASE WHEN c.staff_answer THEN COALESCE(NULLIF(btrim(c.staff_display_name),''),'Mingla team')
      ELSE COALESCE(NULLIF(btrim(pr.display_name),''),'Host') END,
    c.created_at,c.author_user_id=auth.uid(),c.staff_answer
  FROM public.community_post_comments c
  JOIN public.community_posts p ON p.id=c.post_id
  LEFT JOIN public.profiles pr ON pr.id=c.author_user_id
  WHERE c.post_id=p_post_id AND c.review_state='published' AND p.review_state='published'
    AND public.issue_3720_is_host_community_member(auth.uid())
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=auth.uid() AND b.blocked_id=p.author_user_id) OR
      (b.blocker_id=p.author_user_id AND b.blocked_id=auth.uid()))
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=auth.uid() AND b.blocked_id=c.author_user_id) OR
      (b.blocker_id=c.author_user_id AND b.blocked_id=auth.uid()))
  ORDER BY c.created_at,c.id;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_community_comments_v2(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_community_comments_v2(uuid) TO authenticated;

COMMIT;
