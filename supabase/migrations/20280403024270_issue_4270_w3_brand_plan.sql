-- Issue #4270 (Wave 3) — the brand plan: Calendar posts get a brand, one
-- plan per brand for staff and for the brand's hosts, and hosts can add to it.
--
--   1. content_calendar_items gains brand_id, collaborator_record_id (a
--      Creators record), plan_link_url (the one link staff and the host both
--      see; https only; the Drive link is never touched, D12, D13),
--      brand_plan_author_id and brand_plan_source (host_card or host_app).
--   2. brand_plan_post_state: what the host sees for a post. An Idea with a
--      date is Planned, Writing and Design are Being made, Review is In
--      review, then Scheduled, and Published is Posted. An undated Idea is not
--      on the plan.
--   3. content_calendar_item_json carries the brand, collaborator, plan link
--      and the host state; content_calendar_update takes brand_id,
--      collaborator_record_id and plan_link_url, and a brand post whose date,
--      title or plan link changes posts a quiet line in its Brand group
--      (OQ-5). plan_link_url never goes into audit metadata.
--   4. ops_calendar's content rows carry the brand.
--   5. ops_brand_plan (staff read) and brand_plan_for_host (host read): one
--      plan per brand, merged from the brand's dated posts, the Work cards on
--      the brand's host records that the host can see, and the brand's
--      events, experiences and trips. Promised events are on the staff plan
--      only, labelled Promised (D22). Nothing is copied (the plan is a read).
--   6. ops_brand_plan_add (staff, from the host card) and
--      brand_plan_host_add / _update / _remove (hosts, from the Host app). A
--      post goes on the Calendar as an Idea at 12:00 UTC on its date (D5,
--      D17); a task becomes a Work card in To do owned by the host record's
--      owners, watched by the owners of the brand's other host records (D6,
--      D21), with instructions and done means written by Mingla (C-6). A
--      title that is already taken gets " · {brand}" (D24). Hosts change and
--      remove only their own items, while Mingla has not started on them
--      (D7). Hosts see Mingla's people by first name only (D19).
--   7. ops_brand_plan_set_link: staff add, change or remove the plan link on
--      any post or task on the plan (D12).
--   8. brand_plan_line: a quiet system line in the Brand group when an item
--      is added, its date moves, its title changes, a link is added, changed
--      or removed, or a host removes one. It counts as unread under the
--      existing rules (D23); no push.
--
-- Static SQL only (no EXECUTE of built strings); write conflicts raise PT409,
-- never 40001. CREATE OR REPLACE keeps every owner and grant. Do not
-- auto-apply. Release through the governed migration lane, after
-- 20280403014270.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A post's brand, collaborator and plan link.
-- ---------------------------------------------------------------------------
ALTER TABLE public.content_calendar_items ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;
-- No foreign key to crm_records: pipeline tables stay closed (#3802). The
-- Calendar's save checks the id is a live Creators record, and every read
-- skips a deleted one.
ALTER TABLE public.content_calendar_items ADD COLUMN collaborator_record_id uuid;
ALTER TABLE public.content_calendar_items ADD COLUMN plan_link_url text;
ALTER TABLE public.content_calendar_items ADD COLUMN brand_plan_author_id uuid;
ALTER TABLE public.content_calendar_items ADD COLUMN brand_plan_source text;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT content_calendar_plan_link_check
  CHECK (plan_link_url IS NULL OR (char_length(plan_link_url) BETWEEN 9 AND 2000 AND plan_link_url ~ '^https://[^[:space:]]+$'));
ALTER TABLE public.content_calendar_items ADD CONSTRAINT content_calendar_plan_source_check
  CHECK (brand_plan_source IS NULL OR brand_plan_source IN ('host_card','host_app'));
ALTER TABLE public.content_calendar_items ADD CONSTRAINT content_calendar_plan_author_pair
  CHECK (brand_plan_author_id IS NULL OR brand_plan_source = 'host_app');
CREATE INDEX content_calendar_items_brand_publish ON public.content_calendar_items (brand_id, publish_at)
  WHERE deleted_at IS NULL AND brand_id IS NOT NULL;
COMMENT ON COLUMN public.content_calendar_items.brand_id IS
  'Issue #4270. The brand this post is for. A dated post with a brand is on that brand''s plan.';
COMMENT ON COLUMN public.content_calendar_items.collaborator_record_id IS
  'Issue #4270. Optional: the creator (a Creators record) this post is made with.';
COMMENT ON COLUMN public.content_calendar_items.plan_link_url IS
  'Issue #4270. The plan link: staff and the brand''s hosts both see it. https only. The Drive link stays staff-only.';
COMMENT ON COLUMN public.content_calendar_items.brand_plan_author_id IS
  'Issue #4270. The host user who added this post from the Host app. Only with brand_plan_source host_app.';
COMMENT ON COLUMN public.content_calendar_items.brand_plan_source IS
  'Issue #4270. Where a plan post came from: host_card (staff) or host_app (a host).';

-- The plan link is a link: it never goes into audit metadata.
ALTER TABLE public.content_calendar_audit DROP CONSTRAINT content_calendar_audit_metadata_check;
ALTER TABLE public.content_calendar_audit ADD CONSTRAINT content_calendar_audit_metadata_check CHECK (
  jsonb_typeof(metadata) = 'object' AND
  NOT (metadata ?| ARRAY['title','copy','copy_text','notes','body','comment','drive_url','live_url','plan_link_url','before','after']));

-- ---------------------------------------------------------------------------
-- 2. Small helpers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_plan_post_state(p_stage text, p_publish_at timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_stage = 'idea' THEN CASE WHEN p_publish_at IS NOT NULL THEN 'planned' END
    WHEN p_stage IN ('writing','design') THEN 'being_made'
    WHEN p_stage = 'review' THEN 'in_review'
    WHEN p_stage = 'scheduled' THEN 'scheduled'
    WHEN p_stage = 'published' THEN 'posted'
  END
$$;

CREATE FUNCTION public.brand_plan_state_words(p_state text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_state
    WHEN 'planned' THEN 'Planned' WHEN 'being_made' THEN 'Being made' WHEN 'in_review' THEN 'In review'
    WHEN 'scheduled' THEN 'Scheduled' WHEN 'posted' THEN 'Posted'
    WHEN 'todo' THEN 'To do' WHEN 'doing' THEN 'In progress' WHEN 'done' THEN 'Done'
    WHEN 'live' THEN 'Live now' WHEN 'draft' THEN 'Draft' WHEN 'happened' THEN 'Happened'
    WHEN 'on_mingla' THEN 'On Mingla' WHEN 'promised' THEN 'Promised'
  END
$$;

-- Rework (W3 test P3-2): a link with a control character, an invisible
-- formatting character (zero-width, bidirectional and the like), an unusual
-- space, or anything before the site name is refused, so the site name on its
-- button always reads as the site it opens.
CREATE FUNCTION public.brand_plan_link_hidden(p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_url ~ '[[:cntrl:]\u0080-\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\U000E0000-\U000E0FFF]'
      OR p_url ~ '^https://[^/?#]*[@\\]'
$$;

-- {url, site} for a plan link ("canva.com"), or null.
CREATE FUNCTION public.brand_plan_link_json(p_url text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_url IS NULL OR p_url !~ '^https://[^[:space:]]+$' OR public.brand_plan_link_hidden(p_url) THEN NULL
    ELSE jsonb_build_object('url', p_url,
      'site', regexp_replace(lower(substring(p_url FROM '^https://([^/?#:]+)')), '^www\.', '')) END
$$;

-- "Wed 12 Nov".
CREATE FUNCTION public.brand_plan_day_words(p_day date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$ SELECT to_char(p_day, 'Dy FMDD Mon') $$;

-- A link from the plan: https, at most 2,000 characters, or null to clear.
CREATE FUNCTION public.brand_plan_clean_link(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'invalid_link: Links start with https://' USING ERRCODE = '22023';
  END IF;
  v := btrim(p_value #>> '{}');
  IF v = '' THEN RETURN NULL; END IF;
  IF char_length(v) NOT BETWEEN 9 AND 2000 OR v !~ '^https://[^[:space:]]+$' OR public.brand_plan_link_hidden(v) THEN
    RAISE EXCEPTION 'invalid_link: Links start with https://' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- A Mingla teammate on the plan, by first name only (D19).
CREATE FUNCTION public.brand_plan_staff_first(p_email text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN n = 'A teammate' OR btrim(n) = '' THEN 'Mingla' ELSE split_part(btrim(n), ' ', 1) END
    FROM (SELECT public.ops_name(p_email) AS n) s
$$;

-- A host, by the name the brand team sees.
CREATE FUNCTION public.brand_plan_host_name(p_uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN position('@' IN x) = 0 THEN x END
       FROM (SELECT COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.first_name), '')) AS x
               FROM public.profiles p WHERE p.id = p_uid) y),
    'A host')
$$;

-- What a host is called in the records a host write leaves (card events,
-- request keys, the Calendar's created_by): their sign-in email, or their id.
CREATE FUNCTION public.brand_plan_host_actor(p_uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE((SELECT NULLIF(lower(btrim(u.email)), '') FROM auth.users u WHERE u.id = p_uid), 'host-' || p_uid::text)
$$;

-- The brand's host card (the oldest host record), or null.
CREATE FUNCTION public.brand_plan_host_record(p_brand_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.id FROM public.crm_records c
   WHERE c.brand_id = p_brand_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts'
   ORDER BY c.created_at, c.id LIMIT 1
$$;

-- Rework (W3 test P3-6, D14): who may read a brand's plan in the Host app:
-- anyone who can read its Brand group. That is every accepted, not removed
-- member of the team (venue staff included, rank -1) and anyone with a read
-- rank on the brand, while the brand is not deleted.
CREATE FUNCTION public.brand_plan_can_read(p_brand_id uuid, p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND p_brand_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL)
     AND (public.biz_is_brand_member_for_read(p_brand_id, p_uid)
          OR EXISTS (SELECT 1 FROM public.brand_team_members m
                      WHERE m.brand_id = p_brand_id AND m.user_id = p_uid
                        AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL))
$$;

-- Who may add to it and change their own items: marketing managers and up.
CREATE FUNCTION public.brand_plan_can_write(p_brand_id uuid, p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.brand_plan_can_read(p_brand_id, p_uid)
     AND public.biz_brand_effective_rank(p_brand_id, p_uid) >= public.biz_role_rank('marketing_manager')
$$;

-- A title as the brand's plan shows it: without the " · {brand}" that
-- host-added items always carry on the Calendar and the Work board.
CREATE FUNCTION public.brand_plan_title_words(p_title text, p_brand_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN s.suffix IS NOT NULL AND char_length(p_title) > char_length(s.suffix)
                   AND right(p_title, char_length(s.suffix)) = s.suffix
              THEN left(p_title, char_length(p_title) - char_length(s.suffix)) ELSE p_title END
    FROM (SELECT (SELECT ' · ' || left(b.name, 80) FROM public.brands b WHERE b.id = p_brand_id) AS suffix) s
$$;

-- Rework (W3 test P3-3, D24): a host-added item is always stored as
-- "{title} · {brand}", so what a host is told never depends on titles they
-- cannot see. Null when that title is taken too.
CREATE FUNCTION public.brand_plan_host_title(p_kind text, p_title text, p_brand_id uuid, p_except uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_suffix text; v_try text;
BEGIN
  SELECT ' · ' || left(b.name, 80) INTO v_suffix FROM public.brands b WHERE b.id = p_brand_id;
  v_try := public.brand_plan_title_words(p_title, p_brand_id);
  v_try := left(v_try, 160 - char_length(COALESCE(v_suffix, ''))) || COALESCE(v_suffix, '');
  IF p_kind = 'post' AND NOT EXISTS (SELECT 1 FROM public.content_calendar_items i
                                       WHERE i.deleted_at IS NULL AND i.title_key = public.crm_name_key(v_try)
                                         AND i.id IS DISTINCT FROM p_except) THEN
    RETURN v_try;
  END IF;
  IF p_kind = 'task' AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards w
                                       WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.title_key = public.crm_name_key(v_try)
                                         AND w.id IS DISTINCT FROM p_except) THEN
    RETURN v_try;
  END IF;
  RETURN NULL;
END;
$$;

-- A from/to window of at most 120 days.
CREATE FUNCTION public.brand_plan_window_check(p_from date, p_to date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 120 THEN
    RAISE EXCEPTION 'invalid_window: Ask for at most 120 days, from a date to a later one.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- D24: a title that is free on the Calendar (posts) or among open cards
-- (tasks), trying "{title} · {brand}" when the title is taken. Null when both
-- are taken.
CREATE FUNCTION public.brand_plan_free_title(p_kind text, p_title text, p_brand_name text, p_except uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_try text;
BEGIN
  FOREACH v_try IN ARRAY ARRAY[p_title, left(p_title, GREATEST(1, 160 - char_length(' · ' || COALESCE(p_brand_name, '')))) || ' · ' || COALESCE(p_brand_name, '')] LOOP
    CONTINUE WHEN v_try IS NULL OR char_length(v_try) > 160;
    IF p_kind = 'post' AND NOT EXISTS (SELECT 1 FROM public.content_calendar_items i
                                         WHERE i.deleted_at IS NULL AND i.title_key = public.crm_name_key(v_try)
                                           AND i.id IS DISTINCT FROM p_except) THEN
      RETURN v_try;
    END IF;
    IF p_kind = 'task' AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards w
                                         WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.title_key = public.crm_name_key(v_try)
                                           AND w.id IS DISTINCT FROM p_except) THEN
      RETURN v_try;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. The quiet line in the Brand group (titles and dates only).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_plan_line(p_brand_id uuid, p_text text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_conversation uuid; v_id uuid; v_text text := left(public.ops_one_line(p_text), 300);
BEGIN
  IF p_brand_id IS NULL OR v_text IS NULL THEN RETURN NULL; END IF;
  SELECT c.id INTO v_conversation FROM public.conversations c
   WHERE c.linked_entity_type = 'brand' AND c.brand_id = p_brand_id LIMIT 1;
  IF v_conversation IS NULL THEN
    v_conversation := public.issue_3720_ensure_official_brand_group(p_brand_id);
  END IF;
  IF v_conversation IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot)
  VALUES (v_conversation, NULL, v_text, 'system', 'system', 'Plan')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Plan items, as staff and as the brand's hosts see them.
-- ---------------------------------------------------------------------------
-- The brand of a card on the plan (through its host link), or null.
CREATE FUNCTION public.brand_plan_card_brand(p_card_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r.brand_id FROM public.ops_work_links l JOIN public.crm_records r ON r.id = l.target_id
   WHERE l.card_id = p_card_id AND l.kind = 'host' AND r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.brand_id IS NOT NULL
   ORDER BY r.created_at, r.id LIMIT 1
$$;

-- A post on the plan. Rework (W3 test P3-5): for a host, can_edit also needs
-- write rank now (p_can_write), not only being the author.
CREATE FUNCTION public.brand_plan_post_item(i public.content_calendar_items, p_for_host boolean, p_uid uuid, p_can_write boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_for_host THEN
    jsonb_build_object('kind', 'post', 'id', i.id, 'title', public.brand_plan_title_words(i.title, i.brand_id),
      'on', (i.publish_at AT TIME ZONE 'UTC')::date,
      'at', CASE WHEN i.stage IN ('scheduled','published') THEN i.publish_at END,
      'state', public.brand_plan_post_state(i.stage, i.publish_at),
      'state_words', public.brand_plan_state_words(public.brand_plan_post_state(i.stage, i.publish_at)),
      'link', public.brand_plan_link_json(i.plan_link_url),
      'live_url', CASE WHEN i.stage = 'published' THEN i.live_url END,
      'by', CASE WHEN i.brand_plan_source = 'host_app' THEN 'host' ELSE 'mingla' END,
      'mine', i.brand_plan_author_id IS NOT DISTINCT FROM p_uid AND p_uid IS NOT NULL,
      'can_edit', i.brand_plan_author_id IS NOT DISTINCT FROM p_uid AND p_uid IS NOT NULL AND i.stage = 'idea' AND COALESCE(p_can_write, false),
      'revision', i.revision)
  ELSE
    jsonb_build_object('kind', 'post', 'id', i.id, 'title', i.title,
      'on', (i.publish_at AT TIME ZONE 'UTC')::date, 'at', i.publish_at,
      'state', public.brand_plan_post_state(i.stage, i.publish_at),
      'state_words', public.brand_plan_state_words(public.brand_plan_post_state(i.stage, i.publish_at)),
      'stage', i.stage,
      'link', public.brand_plan_link_json(i.plan_link_url),
      'drive_url', i.drive_url, 'live_url', i.live_url,
      'by', CASE WHEN i.brand_plan_source = 'host_app' THEN 'host' ELSE 'mingla' END,
      'source', i.brand_plan_source, 'mine', false, 'can_link', true, 'revision', i.revision)
  END
$$;

-- A Work card on the plan.
CREATE FUNCTION public.brand_plan_card_item(c public.ops_work_cards, p_for_host boolean, p_uid uuid, p_can_write boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_for_host THEN
    jsonb_build_object('kind', 'task', 'id', c.id, 'title', public.brand_plan_title_words(c.title, public.brand_plan_card_brand(c.id)),
      'on', c.due_on, 'at', NULL,
      'state', c.status, 'state_words', public.brand_plan_state_words(c.status),
      'link', public.brand_plan_link_json(c.files_url),
      'by', CASE WHEN c.brand_plan_source = 'host_app' THEN 'host' ELSE 'mingla' END,
      'mine', c.brand_plan_author_id IS NOT DISTINCT FROM p_uid AND p_uid IS NOT NULL,
      'can_edit', c.brand_plan_author_id IS NOT DISTINCT FROM p_uid AND p_uid IS NOT NULL AND c.status = 'todo' AND COALESCE(p_can_write, false),
      'revision', c.revision)
  ELSE
    jsonb_build_object('kind', 'task', 'id', c.id, 'number', c.number, 'title', c.title, 'on', c.due_on, 'at', NULL,
      'state', c.status, 'state_words', public.brand_plan_state_words(c.status),
      'link', public.brand_plan_link_json(c.files_url),
      'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                            FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
      'by', CASE WHEN c.brand_plan_source = 'host_app' THEN 'host' ELSE 'mingla' END,
      'source', c.brand_plan_source, 'mine', false, 'can_link', true, 'revision', c.revision)
  END
$$;

-- The cards on the brand's host records that the host can see.
CREATE FUNCTION public.brand_plan_cards(p_brand_id uuid, p_from date, p_to date) RETURNS SETOF public.ops_work_cards
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.* FROM public.ops_work_cards c
   WHERE c.archived_at IS NULL AND c.on_brand_plan AND c.due_on BETWEEN p_from AND p_to
     AND EXISTS (SELECT 1 FROM public.ops_work_links l JOIN public.crm_records r ON r.id = l.target_id
                  WHERE l.card_id = c.id AND l.kind = 'host' AND r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.brand_id = p_brand_id)
$$;

-- An event, experience or trip of the brand on the plan.
CREATE FUNCTION public.brand_plan_event_item(e public.events, p_on date, p_live boolean, p_today date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('kind', CASE WHEN e.event_type IN ('experience','trip') THEN e.event_type ELSE 'event' END,
    'event_type', e.event_type, 'id', e.id, 'title', e.title, 'on', p_on, 'at', NULL,
    'state', s.st, 'state_words', public.brand_plan_state_words(s.st),
    'link', NULL, 'by', 'host', 'mine', false, 'can_link', false)
    FROM (SELECT CASE WHEN p_live THEN 'live' WHEN e.status = 'draft' THEN 'draft'
                      WHEN p_on < p_today OR e.status = 'ended' THEN 'happened' ELSE 'on_mingla' END AS st) s
$$;

-- The staff plan of a host card's brand.
CREATE FUNCTION public.ops_brand_plan(p_record_id uuid, p_from date, p_to date, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); r public.crm_records; b public.brands; v_items jsonb;
  v_owners text[]; v_watchers text[];
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO r FROM public.crm_records c WHERE c.id = p_record_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That host card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_plan_window_check(p_from, p_to);
  SELECT * INTO b FROM public.brands x WHERE x.id = r.brand_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('brand', NULL, 'record_id', r.id, 'today', v_today, 'from', p_from, 'to', p_to, 'items', '[]'::jsonb,
      'task_defaults', jsonb_build_object('owners', '[]'::jsonb, 'watchers', '[]'::jsonb));
  END IF;
  -- Rework (W3 test P3-9): who owns and watches a task added here unless the
  -- form changes it (D6, D21), so the form shows exactly what will be saved.
  v_owners := ARRAY(SELECT o.owner_email FROM public.crm_record_owners o WHERE o.record_id = r.id
                       AND public.ops_team_email(o.owner_email) IS NOT NULL ORDER BY o.added_at, o.owner_email);
  v_watchers := ARRAY(SELECT DISTINCT o.owner_email FROM public.crm_record_owners o JOIN public.crm_records x ON x.id = o.record_id
                       WHERE x.brand_id = b.id AND x.pipeline = 'hosts' AND x.deleted_at IS NULL AND x.id <> r.id
                         AND public.ops_team_email(o.owner_email) IS NOT NULL
                         AND NOT (o.owner_email = ANY (v_owners)) ORDER BY 1);
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.j->>'on', x.j->>'kind', x.j->>'title'), '[]'::jsonb) INTO v_items FROM (
    SELECT public.brand_plan_post_item(i, false, NULL, false) AS j FROM public.content_calendar_items i
     WHERE i.deleted_at IS NULL AND i.brand_id = b.id AND i.publish_at IS NOT NULL
       AND (i.publish_at AT TIME ZONE 'UTC')::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT public.brand_plan_card_item(c, false, NULL, false) FROM public.brand_plan_cards(b.id, p_from, p_to) c
    UNION ALL
    -- The brand's events, experiences and trips Mingla promotes (the host
    -- card's scope: private and hidden ones stay off). Rework (W3 test
    -- P2-1): each sits on the date it is on now or next; one on right now is
    -- Live now on today.
    SELECT public.brand_plan_event_item(e, CASE WHEN w.live THEN GREATEST(w.start_on, v_today) ELSE w.start_on END, w.live, v_today)
      FROM public.events e
     CROSS JOIN LATERAL public.ops_event_when(e.id) w
     WHERE e.brand_id = b.id AND e.deleted_at IS NULL AND w.starts_at IS NOT NULL
       AND public.ops_event_in_scope(e.id)
       AND CASE WHEN w.live THEN GREATEST(w.start_on, v_today) ELSE w.start_on END BETWEEN p_from AND p_to
    UNION ALL
    -- D22: promised events, on the staff plan only.
    SELECT jsonb_build_object('kind', 'promised', 'id', z.id, 'title', z.title, 'on', z.expected_on, 'at', NULL,
             'state', 'promised', 'state_words', 'Promised', 'link', NULL, 'by', 'mingla', 'mine', false, 'can_link', false)
      FROM public.ops_expected_events z JOIN public.crm_records hr ON hr.id = z.record_id
     WHERE z.status = 'open' AND hr.deleted_at IS NULL AND hr.pipeline = 'hosts' AND hr.brand_id = b.id
       AND z.expected_on BETWEEN p_from AND p_to
  ) x;
  RETURN jsonb_build_object('brand', jsonb_build_object('id', b.id, 'name', b.name), 'record_id', r.id,
    'today', v_today, 'from', p_from, 'to', p_to, 'items', v_items,
    'task_defaults', jsonb_build_object('owners', to_jsonb(v_owners), 'watchers', to_jsonb(v_watchers)));
END;
$$;

-- The plan as the brand's own team sees it in the Host app. The team's own
-- private and hidden events are on it: the team already reads them in the
-- Host app (the staff plan keeps them off). Venue staff read the plan (D14) but
-- not those events (they have no read rank on events), so they get only the
-- events anyone can open.
CREATE FUNCTION public.brand_plan_for_host(p_brand_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); b public.brands; v_today date; v_items jsonb; v_can_write boolean; v_team boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.brand_plan_can_read(p_brand_id, v_uid) THEN
    RAISE EXCEPTION 'not_found: This plan is not here.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO STRICT b FROM public.brands x WHERE x.id = p_brand_id;
  PERFORM public.brand_plan_window_check(p_from, p_to);
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(b.default_timezone, ''), 'UTC'))::date;
  v_can_write := public.brand_plan_can_write(p_brand_id, v_uid);
  v_team := public.biz_is_brand_member_for_read(p_brand_id, v_uid);
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.j->>'on', x.j->>'kind', x.j->>'title'), '[]'::jsonb) INTO v_items FROM (
    SELECT public.brand_plan_post_item(i, true, v_uid, v_can_write) AS j FROM public.content_calendar_items i
     WHERE i.deleted_at IS NULL AND i.brand_id = b.id AND i.publish_at IS NOT NULL
       AND public.brand_plan_post_state(i.stage, i.publish_at) IS NOT NULL
       AND (i.publish_at AT TIME ZONE 'UTC')::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT public.brand_plan_card_item(c, true, v_uid, v_can_write) FROM public.brand_plan_cards(b.id, p_from, p_to) c
    UNION ALL
    -- The brand's own events, experiences and trips (the team sees them all
    -- in the Host app already): not deleted, not cancelled, with a date.
    -- Rework (W3 test P2-1): on the date they are on now or next; one on
    -- right now is Live now on today.
    SELECT public.brand_plan_event_item(e, CASE WHEN w.live THEN GREATEST(w.start_on, v_today) ELSE w.start_on END, w.live, v_today)
      FROM public.events e
     CROSS JOIN LATERAL public.ops_event_when(e.id) w
     WHERE e.brand_id = b.id AND e.deleted_at IS NULL AND e.status <> 'cancelled' AND w.starts_at IS NOT NULL
       AND (v_team OR public.ops_event_public(e.id))
       AND CASE WHEN w.live THEN GREATEST(w.start_on, v_today) ELSE w.start_on END BETWEEN p_from AND p_to
  ) x;
  RETURN jsonb_build_object('brand', jsonb_build_object('id', b.id, 'name', b.name), 'today', v_today,
    'from', p_from, 'to', p_to, 'can_add', v_can_write, 'items', v_items);
END;
$$;

-- "Seth added a link to "Menu reveal"." and the like; null when nothing changed.
CREATE FUNCTION public.brand_plan_link_words(p_who text, p_title text, p_old text, p_new text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_old IS NOT DISTINCT FROM p_new THEN NULL
    WHEN p_old IS NULL THEN format('%s added a link to “%s”.', p_who, p_title)
    WHEN p_new IS NULL THEN format('%s removed the link from “%s”.', p_who, p_title)
    ELSE format('%s changed the link on “%s”.', p_who, p_title) END
$$;

-- What a plan item from the plan form says: type, title, date, link, note.
-- The words are the form's own ("Say what it is.", "Pick a date.").
CREATE FUNCTION public.brand_plan_clean_item(p_item jsonb, p_allowed text[], p_today date, p_need_type boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_bad text; v_type text; v_title text; v_on date; v_link text; v_note text;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'invalid: Send what it is and its date.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_item) k WHERE NOT (k = ANY (p_allowed)) ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A plan item does not take "%s".', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  IF p_need_type THEN
    v_type := CASE WHEN jsonb_typeof(p_item->'type') = 'string' THEN p_item->>'type' END;
    IF v_type IS NULL OR v_type NOT IN ('post','task') THEN
      RAISE EXCEPTION 'invalid_type: Choose Post or Task.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_need_type OR p_item ? 'title' THEN
    v_title := CASE WHEN jsonb_typeof(p_item->'title') = 'string' THEN public.ops_one_line(p_item->>'title') END;
    IF v_title IS NULL OR public.crm_name_key(v_title) = '' THEN
      RAISE EXCEPTION 'invalid_title: Say what it is.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_title) > 160 OR public.ops_has_control(p_item->>'title') THEN
      RAISE EXCEPTION 'invalid_title: Say what it is in up to 160 characters.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_need_type OR p_item ? 'on' THEN
    IF jsonb_typeof(p_item->'on') <> 'string' OR (p_item->>'on') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'invalid_date: Pick a date.' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_on := (p_item->>'on')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'invalid_date: Pick a date.' USING ERRCODE = '22023';
    END;
    IF v_on < p_today THEN RAISE EXCEPTION 'invalid_date: Pick today or a later date.' USING ERRCODE = '22023'; END IF;
    IF v_on > p_today + 365 THEN RAISE EXCEPTION 'invalid_date: Pick a date within the next year.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_item ? 'link' THEN v_link := public.brand_plan_clean_link(p_item->'link'); END IF;
  IF p_item ? 'note' AND jsonb_typeof(p_item->'note') <> 'null' THEN
    IF jsonb_typeof(p_item->'note') <> 'string' OR char_length(p_item->>'note') > 500 OR public.ops_has_control(p_item->>'note') THEN
      RAISE EXCEPTION 'invalid_note: A note is up to 500 characters.' USING ERRCODE = '22023';
    END IF;
    v_note := public.ops_one_line(p_item->>'note');
  END IF;
  RETURN jsonb_build_object('type', v_type, 'title', v_title, 'on', v_on, 'link', v_link, 'note', v_note,
    'has_title', p_item ? 'title', 'has_on', p_item ? 'on', 'has_link', p_item ? 'link', 'has_note', p_item ? 'note');
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Staff add to the plan from the host card.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_brand_plan_add(p_record_id uuid, p_item jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(NULL); r public.crm_records; b public.brands; v_replay jsonb; v_out jsonb;
  cl jsonb; v_title text; v_on date; v_who text; i public.content_calendar_items; c public.ops_work_cards;
  v_owners text[]; v_watchers text[]; v_email text; v_res jsonb; v_row jsonb; v_task jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: A person adds to a brand''s plan. Agents add cards with add_work.' USING ERRCODE = '42501';
  END IF;
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,70}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 70 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.crm_records x WHERE x.id = p_record_id AND x.deleted_at IS NULL AND x.pipeline = 'hosts';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That host card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO b FROM public.brands x WHERE x.id = r.brand_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_brand: This host has no brand on Mingla yet, so it has no plan.' USING ERRCODE = '22023'; END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-plan', 'brand_plan_add',
    jsonb_build_object('record_id', p_record_id, 'item', p_item));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  -- The staff form allows the date of the viewer's today (one day of zone tolerance, like Work cards).
  cl := public.brand_plan_clean_item(p_item, ARRAY['type','title','on','link','note','owners','watchers'], v_today - 1, true);
  v_title := cl->>'title'; v_on := (cl->>'on')::date;
  v_who := public.brand_plan_staff_first(v.actor_email);
  -- Owners and watchers: teammates, by email.
  IF p_item ? 'owners' AND jsonb_typeof(p_item->'owners') <> 'null' THEN
    IF jsonb_typeof(p_item->'owners') <> 'array' THEN RAISE EXCEPTION 'invalid_owners: Pick owners from the team.' USING ERRCODE = '22023'; END IF;
    FOR v_email IN SELECT jsonb_array_elements_text(p_item->'owners') LOOP
      IF public.ops_team_email(v_email) IS NULL THEN RAISE EXCEPTION 'invalid_owners: Pick owners from the team.' USING ERRCODE = '22023'; END IF;
      v_owners := array_append(v_owners, public.ops_team_email(v_email));
    END LOOP;
  END IF;
  IF p_item ? 'watchers' AND jsonb_typeof(p_item->'watchers') <> 'null' THEN
    IF jsonb_typeof(p_item->'watchers') <> 'array' THEN RAISE EXCEPTION 'invalid_watchers: Pick watchers from the team.' USING ERRCODE = '22023'; END IF;
    -- Rework (W3 test P3-9): a list sent is the list saved; [] means nobody.
    v_watchers := ARRAY[]::text[];
    FOR v_email IN SELECT jsonb_array_elements_text(p_item->'watchers') LOOP
      IF public.ops_team_email(v_email) IS NULL THEN RAISE EXCEPTION 'invalid_watchers: Pick watchers from the team.' USING ERRCODE = '22023'; END IF;
      v_watchers := array_append(v_watchers, public.ops_team_email(v_email));
    END LOOP;
  END IF;

  IF cl->>'type' = 'post' THEN
    v_title := public.brand_plan_free_title('post', v_title, b.name, NULL);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.content_calendar_items (title, owner_emails, publish_at, notes, brand_id, plan_link_url, brand_plan_source, created_by, updated_by)
    VALUES (v_title, COALESCE((SELECT array_agg(DISTINCT x) FROM unnest(v_owners) x), ARRAY[v.actor_email]),
            (v_on::timestamp + time '12:00') AT TIME ZONE 'UTC', cl->>'note', b.id, cl->>'link', 'host_card', v.actor_email, v.actor_email)
    RETURNING * INTO i;
    PERFORM public.content_calendar_audit_write(i.id, v.actor_email, NULL, 'content.created',
      jsonb_build_object('to_revision', i.revision, 'source', 'host_card',
        'changed_fields', jsonb_build_array('title','owners','stage','publish_at','brand_id','plan_link_url')));
    PERFORM public.brand_plan_line(b.id, format('%s added “%s” to the plan for %s.', v_who,
      public.brand_plan_title_words(i.title, b.id), public.brand_plan_day_words(v_on)));
    v_out := jsonb_build_object('kind', 'post', 'status', 'added', 'title_changed', i.title <> (cl->>'title'),
      'item', public.brand_plan_post_item(i, false, NULL, false));
  ELSE
    v_title := public.brand_plan_free_title('task', v_title, b.name, NULL);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
    IF char_length(v_title) < 3 THEN
      RAISE EXCEPTION 'invalid_title: Say what it is in 3 to 160 characters.' USING ERRCODE = '22023';
    END IF;
    -- D6, D21: the host card's owners own it; the owners of the brand's other
    -- host records watch it (usually nobody).
    IF v_owners IS NULL THEN
      v_owners := ARRAY(SELECT o.owner_email FROM public.crm_record_owners o WHERE o.record_id = r.id ORDER BY o.added_at, o.owner_email);
    END IF;
    IF v_watchers IS NULL THEN
      v_watchers := ARRAY(SELECT DISTINCT o.owner_email FROM public.crm_record_owners o JOIN public.crm_records x ON x.id = o.record_id
                           WHERE x.brand_id = b.id AND x.pipeline = 'hosts' AND x.deleted_at IS NULL AND x.id <> r.id
                             AND NOT (o.owner_email = ANY (v_owners)));
    END IF;
    v_task := jsonb_build_object('quick', true, 'title', v_title, 'owners', to_jsonb(v_owners), 'watchers', to_jsonb(v_watchers),
      'due_on', v_on, 'on_brand_plan', true, 'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', r.id)))
      || CASE WHEN cl->>'link' IS NOT NULL THEN jsonb_build_object('files_url', cl->>'link') ELSE '{}'::jsonb END
      || CASE WHEN cl->>'note' IS NOT NULL THEN jsonb_build_object('instructions',
           format('Added by %s from %s''s host card. Note: %s', public.ops_actor_label(v.actor_email, NULL), r.name, cl->>'note')) ELSE '{}'::jsonb END;
    v_res := public.ops_work_add(jsonb_build_array(v_task), p_request_key || '-task');
    v_row := v_res->'results'->0;
    IF v_row->>'status' = 'added' THEN
      SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = (v_row #>> '{card,id}')::uuid;
      PERFORM public.brand_plan_line(b.id, format('%s added “%s” to the plan for %s.', v_who,
        public.brand_plan_title_words(c.title, b.id), public.brand_plan_day_words(v_on)));
      v_out := jsonb_build_object('kind', 'task', 'status', 'added', 'title_changed', c.title <> (cl->>'title'),
        'item', public.brand_plan_card_item(c, false, NULL, false), 'card', v_row->'card');
    ELSE
      v_out := jsonb_build_object('kind', 'task', 'status', COALESCE(v_row->>'status', 'refused'),
        'fixes', COALESCE(v_row->'fixes', '[]'::jsonb), 'message', v_row->'message');
    END IF;
  END IF;
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-plan', 'brand_plan_add', v_out);
  RETURN v_out;
-- Rework (W3 test P3-8): two adds of the same title at once: the second is
-- told in the D24 words, never the raw constraint.
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Staff set the plan link on any post or task on the plan (D12).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_brand_plan_set_link(p_kind text, p_id uuid, p_link text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_link text; i public.content_calendar_items; c public.ops_work_cards; v_brand uuid; v_words text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: A person changes a plan link.' USING ERRCODE = '42501';
  END IF;
  v_link := public.brand_plan_clean_link(to_jsonb(p_link));
  IF p_kind = 'post' THEN
    SELECT * INTO i FROM public.content_calendar_items x WHERE x.id = p_id AND x.deleted_at IS NULL AND x.brand_id IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That item is no longer on the plan.' USING ERRCODE = 'P0002'; END IF;
    -- content_calendar_update checks the revision and posts the plan line.
    PERFORM public.content_calendar_update(p_id, jsonb_build_object('plan_link_url', v_link), p_expected_revision, NULL);
    SELECT * INTO i FROM public.content_calendar_items x WHERE x.id = p_id;
    RETURN jsonb_build_object('kind', 'post', 'item', public.brand_plan_post_item(i, false, NULL, false));
  ELSIF p_kind = 'task' THEN
    SELECT * INTO c FROM public.ops_work_cards x WHERE x.id = p_id AND x.archived_at IS NULL AND x.on_brand_plan;
    v_brand := CASE WHEN FOUND THEN public.brand_plan_card_brand(c.id) END;
    IF v_brand IS NULL THEN RAISE EXCEPTION 'not_found: That item is no longer on the plan.' USING ERRCODE = 'P0002'; END IF;
    v_words := public.brand_plan_link_words(public.brand_plan_staff_first(v.actor_email), public.brand_plan_title_words(c.title, v_brand), c.files_url, v_link);
    PERFORM public.ops_work_update(p_id, jsonb_build_object('files_url', v_link), p_expected_revision, NULL);
    PERFORM public.brand_plan_line(v_brand, v_words);
    SELECT * INTO c FROM public.ops_work_cards x WHERE x.id = p_id;
    RETURN jsonb_build_object('kind', 'task', 'item', public.brand_plan_card_item(c, false, NULL, false));
  END IF;
  RAISE EXCEPTION 'invalid_kind: A plan link goes on a post or a task.' USING ERRCODE = '22023';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Hosts add, change and remove their own plan items (Host app).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_plan_host_add(p_brand_id uuid, p_item jsonb, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); b public.brands; v_actor text; v_name text; v_today date; v_replay jsonb; v_out jsonb;
  cl jsonb; v_title text; v_shown text; v_on date; v_record uuid; v_record_name text; v_owners text[]; v_watchers text[];
  i public.content_calendar_items; c public.ops_work_cards; v_event uuid; v_n integer;
BEGIN
  IF v_uid IS NULL OR NOT public.brand_plan_can_read(p_brand_id, v_uid) THEN
    RAISE EXCEPTION 'not_found: This plan is not here.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.brand_plan_can_write(p_brand_id, v_uid) THEN
    RAISE EXCEPTION 'read_only: You can see this plan. Ask your brand admin to let you add to it.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT b FROM public.brands x WHERE x.id = p_brand_id;
  v_actor := public.brand_plan_host_actor(v_uid);
  v_name := public.brand_plan_host_name(v_uid);
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(b.default_timezone, ''), 'UTC'))::date;
  IF p_request_key IS NOT NULL AND p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v_actor, p_request_key, 'brand_plan_host_add', jsonb_build_object('brand_id', p_brand_id, 'item', p_item));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  cl := public.brand_plan_clean_item(p_item, ARRAY['type','title','on','link','note'], v_today, true);
  v_title := cl->>'title'; v_on := (cl->>'on')::date;
  -- At most 30 adds a day for one person on one brand.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brand_plan_host_add:' || v_uid::text || ':' || p_brand_id::text, 0));
  SELECT (SELECT count(*) FROM public.content_calendar_items x
           WHERE x.brand_id = p_brand_id AND x.brand_plan_author_id = v_uid AND x.created_at > now() - interval '1 day')
       + (SELECT count(*) FROM public.ops_work_cards w
           WHERE w.brand_plan_author_id = v_uid AND w.created_at > now() - interval '1 day'
             AND public.brand_plan_card_brand(w.id) = p_brand_id) INTO v_n;
  IF v_n >= 30 THEN
    RAISE EXCEPTION 'too_many: You''ve added a lot today. Try again tomorrow.' USING ERRCODE = '22023';
  END IF;
  v_record := public.brand_plan_host_record(p_brand_id);
  v_owners := ARRAY(SELECT o.owner_email FROM public.crm_record_owners o WHERE o.record_id = v_record ORDER BY o.added_at, o.owner_email);

  IF cl->>'type' = 'post' THEN
    -- D24 (rework, P3-3): always "{title} · {brand}" on the Calendar.
    v_title := public.brand_plan_host_title('post', v_title, b.id, NULL);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.content_calendar_items (title, owner_emails, publish_at, notes, brand_id, plan_link_url,
      brand_plan_author_id, brand_plan_source, created_by, updated_by)
    VALUES (v_title, v_owners, (v_on::timestamp + time '12:00') AT TIME ZONE 'UTC',
      format('Added by %s in the Host app.', v_name) || COALESCE(' Note: ' || (cl->>'note'), ''),
      b.id, cl->>'link', v_uid, 'host_app', v_actor, v_actor)
    RETURNING * INTO i;
    PERFORM public.content_calendar_audit_write(i.id, v_actor, NULL, 'content.created',
      jsonb_build_object('to_revision', i.revision, 'source', 'host_app',
        'changed_fields', jsonb_build_array('title','owners','stage','publish_at','brand_id','plan_link_url')));
    v_shown := public.brand_plan_title_words(i.title, b.id);
    PERFORM public.brand_plan_line(b.id, format('%s added “%s” to the plan for %s.', v_name, v_shown, public.brand_plan_day_words(v_on)));
    v_out := jsonb_build_object('kind', 'post', 'status', 'added', 'title_changed', v_shown <> (cl->>'title'),
      'item', public.brand_plan_post_item(i, true, v_uid, true));
  ELSE
    IF v_record IS NULL THEN
      RAISE EXCEPTION 'no_host_card: Mingla hasn''t set up your brand yet. Message the Brand group instead.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_title) < 3 THEN
      RAISE EXCEPTION 'invalid_title: Say what it is in 3 to 160 characters.' USING ERRCODE = '22023';
    END IF;
    v_title := public.brand_plan_host_title('task', v_title, b.id, NULL);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
    SELECT x.name INTO v_record_name FROM public.crm_records x WHERE x.id = v_record;
    v_watchers := ARRAY(SELECT DISTINCT o.owner_email FROM public.crm_record_owners o JOIN public.crm_records x ON x.id = o.record_id
                         WHERE x.brand_id = b.id AND x.pipeline = 'hosts' AND x.deleted_at IS NULL AND x.id <> v_record
                           AND NOT (o.owner_email = ANY (v_owners)));
    INSERT INTO public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan,
      files_url, on_brand_plan, brand_plan_author_id, brand_plan_source, created_by, created_via, updated_by, updated_via)
    VALUES (v_title,
      format('Added by %s from the Brand group plan.', v_name) || COALESCE(' Note: ' || (cl->>'note'), ''),
      'Done and the host is told in the Brand group.', 'todo', 'task', v_on, 'explicit',
      public.ops_sprint_for(v_on, public.ops_today(NULL)), '[]'::jsonb,
      cl->>'link', true, v_uid, 'host_app', v_actor, NULL, v_actor, NULL)
    RETURNING * INTO c;
    PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v_actor, NULL);
    PERFORM public.ops_links_set(c.id, jsonb_build_array(jsonb_build_object('kind', 'host', 'id', v_record, 'label', v_record_name)), v_actor, NULL);
    v_event := public.ops_card_event(c.id, v_actor, NULL, 'added', 'Added from the Host app.', NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
    PERFORM public.ops_notify_people(c.id, v_event, v_owners, v_actor, format('%s added a task on the %s plan: %s', v_name, b.name, c.title));
    PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v_actor, format('%s added a task on the %s plan: %s', v_name, b.name, c.title));
    PERFORM public.ops_log_write(v_actor, NULL, 'card_added', 'ok', c.id, 'work_card', c.id,
      format('Added Card %s from the Host app: %s', c.number, c.title), jsonb_build_object('source', 'host_app', 'owners', cardinality(v_owners)));
    v_shown := public.brand_plan_title_words(c.title, b.id);
    PERFORM public.brand_plan_line(b.id, format('%s added “%s” to the plan for %s.', v_name, v_shown, public.brand_plan_day_words(v_on)));
    v_out := jsonb_build_object('kind', 'task', 'status', 'added', 'title_changed', v_shown <> (cl->>'title'),
      'item', public.brand_plan_card_item(c, true, v_uid, true));
  END IF;
  PERFORM public.ops_request_finish(v_actor, p_request_key, 'brand_plan_host_add', v_out);
  RETURN v_out;
-- Rework (W3 test P3-8): a same-title race gets the D24 words, never the raw
-- constraint.
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
END;
$$;

-- Rework (W3 test P3-4): at most 12 changes an hour for one person on one
-- brand's plan, so repeated renames cannot flood the Brand group with lines.
CREATE FUNCTION public.brand_plan_host_change_check(p_brand_id uuid, p_uid uuid, p_actor text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brand_plan_host_change:' || p_uid::text || ':' || p_brand_id::text, 0));
  SELECT (SELECT count(*) FROM public.content_calendar_audit a JOIN public.content_calendar_items x ON x.id = a.item_id
           WHERE a.actor_email = p_actor AND a.metadata->>'source' = 'host_app'
             AND a.action IN ('content.updated', 'content.rescheduled') AND a.created_at > now() - interval '1 hour'
             AND x.brand_id = p_brand_id AND x.brand_plan_author_id = p_uid)
       + (SELECT count(*) FROM public.ops_work_events e JOIN public.ops_work_cards w ON w.id = e.card_id
           WHERE e.actor_email = p_actor AND e.action = 'updated' AND e.body = 'Changed from the Host app.'
             AND e.at > now() - interval '1 hour' AND w.brand_plan_author_id = p_uid
             AND public.brand_plan_card_brand(w.id) = p_brand_id) INTO v_n;
  IF v_n >= 12 THEN
    RAISE EXCEPTION 'too_many: You''ve made a lot of changes just now. Try again in an hour.' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION public.brand_plan_host_update(p_kind text, p_id uuid, p_changes jsonb, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_brand uuid; b public.brands; v_actor text; v_name text; v_today date; cl jsonb;
  i public.content_calendar_items; n public.content_calendar_items; c public.ops_work_cards; w public.ops_work_cards;
  v_title text; v_on date; v_link text; v_before jsonb; v_fields text[] := ARRAY[]::text[]; v_old_shown text; v_shown text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_found: This item is not on your plan.' USING ERRCODE = 'P0002'; END IF;
  -- Only the caller's own item that is on the plan now: a post with its
  -- brand and a date, a card staff still let the host see (rework, P3-1).
  IF p_kind = 'post' THEN
    SELECT * INTO i FROM public.content_calendar_items x
     WHERE x.id = p_id AND x.deleted_at IS NULL AND x.brand_plan_author_id = v_uid
       AND x.brand_id IS NOT NULL AND x.publish_at IS NOT NULL FOR UPDATE;
    v_brand := CASE WHEN FOUND THEN i.brand_id END;
  ELSIF p_kind = 'task' THEN
    SELECT * INTO c FROM public.ops_work_cards x
     WHERE x.id = p_id AND x.archived_at IS NULL AND x.brand_plan_author_id = v_uid AND x.on_brand_plan FOR UPDATE;
    v_brand := CASE WHEN FOUND THEN public.brand_plan_card_brand(c.id) END;
  END IF;
  IF v_brand IS NULL OR NOT public.brand_plan_can_read(v_brand, v_uid) THEN
    RAISE EXCEPTION 'not_found: This item is not on your plan.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.brand_plan_can_write(v_brand, v_uid) THEN
    RAISE EXCEPTION 'read_only: You can see this plan. Ask your brand admin to let you change it.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT b FROM public.brands x WHERE x.id = v_brand;
  v_actor := public.brand_plan_host_actor(v_uid);
  v_name := public.brand_plan_host_name(v_uid);
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(b.default_timezone, ''), 'UTC'))::date;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid: Send what to change.' USING ERRCODE = '22023';
  END IF;
  cl := public.brand_plan_clean_item(p_changes, ARRAY['title','on','link','note'], v_today, false);

  IF p_kind = 'post' THEN
    IF i.stage <> 'idea' THEN
      RAISE EXCEPTION 'locked: Mingla is already working on this post. Reply in the chat to change it.' USING ERRCODE = '22023';
    END IF;
    IF p_expected_revision IS NULL OR i.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'stale_write: This changed. Showing the latest.' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.brand_plan_host_change_check(v_brand, v_uid, v_actor);
    v_title := i.title;
    IF (cl->>'has_title')::boolean THEN
      v_title := public.brand_plan_host_title('post', cl->>'title', b.id, i.id);
      IF v_title IS NULL THEN
        RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
      END IF;
    END IF;
    v_on := CASE WHEN (cl->>'has_on')::boolean THEN (cl->>'on')::date ELSE (i.publish_at AT TIME ZONE 'UTC')::date END;
    v_link := CASE WHEN (cl->>'has_link')::boolean THEN cl->>'link' ELSE i.plan_link_url END;
    UPDATE public.content_calendar_items SET title = v_title,
      publish_at = CASE WHEN (cl->>'has_on')::boolean THEN (v_on::timestamp + time '12:00') AT TIME ZONE 'UTC' ELSE publish_at END,
      plan_link_url = v_link,
      notes = CASE WHEN (cl->>'has_note')::boolean THEN format('Added by %s in the Host app.', v_name) || COALESCE(' Note: ' || (cl->>'note'), '') ELSE notes END,
      revision = revision + 1, updated_by = v_actor, updated_at = now()
     WHERE id = i.id RETURNING * INTO n;
    IF n.title IS DISTINCT FROM i.title THEN v_fields := array_append(v_fields, 'title'); END IF;
    IF n.publish_at IS DISTINCT FROM i.publish_at THEN v_fields := array_append(v_fields, 'publish_at'); END IF;
    IF n.plan_link_url IS DISTINCT FROM i.plan_link_url THEN v_fields := array_append(v_fields, 'plan_link_url'); END IF;
    IF n.notes IS DISTINCT FROM i.notes THEN v_fields := array_append(v_fields, 'notes'); END IF;
    PERFORM public.content_calendar_audit_write(n.id, v_actor, NULL,
      CASE WHEN v_fields = ARRAY['publish_at'] THEN 'content.rescheduled' ELSE 'content.updated' END,
      jsonb_build_object('changed_fields', to_jsonb(v_fields), 'from_revision', i.revision, 'to_revision', n.revision, 'source', 'host_app'));
    v_old_shown := public.brand_plan_title_words(i.title, v_brand);
    v_shown := public.brand_plan_title_words(n.title, v_brand);
    IF n.publish_at IS DISTINCT FROM i.publish_at THEN
      PERFORM public.brand_plan_line(v_brand, format('%s moved “%s” to %s.', v_name, v_shown, public.brand_plan_day_words(v_on)));
    END IF;
    IF n.title IS DISTINCT FROM i.title THEN
      PERFORM public.brand_plan_line(v_brand, format('%s renamed “%s” to “%s”.', v_name, v_old_shown, v_shown));
    END IF;
    PERFORM public.brand_plan_line(v_brand, public.brand_plan_link_words(v_name, v_shown, i.plan_link_url, n.plan_link_url));
    RETURN jsonb_build_object('kind', 'post', 'item', public.brand_plan_post_item(n, true, v_uid, true));
  END IF;

  IF c.status <> 'todo' THEN
    RAISE EXCEPTION 'locked: Mingla is already working on this task. Reply in the chat to change it.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR c.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This changed. Showing the latest.' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.brand_plan_host_change_check(v_brand, v_uid, v_actor);
  v_title := c.title;
  IF (cl->>'has_title')::boolean THEN
    IF char_length(cl->>'title') < 3 THEN
      RAISE EXCEPTION 'invalid_title: Say what it is in 3 to 160 characters.' USING ERRCODE = '22023';
    END IF;
    v_title := public.brand_plan_host_title('task', cl->>'title', b.id, c.id);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
  END IF;
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards SET title = v_title,
    due_on = CASE WHEN (cl->>'has_on')::boolean THEN (cl->>'on')::date ELSE due_on END, due_source = 'explicit',
    files_url = CASE WHEN (cl->>'has_link')::boolean THEN cl->>'link' ELSE files_url END,
    instructions = CASE WHEN (cl->>'has_note')::boolean THEN format('Added by %s from the Brand group plan.', v_name) || COALESCE(' Note: ' || (cl->>'note'), '') ELSE instructions END,
    revision = revision + 1, updated_by = v_actor, updated_via = NULL, updated_at = now()
   WHERE id = c.id RETURNING * INTO w;
  PERFORM public.ops_card_event(w.id, v_actor, NULL, 'updated', 'Changed from the Host app.', v_before, public.ops_card_snapshot(w.id), c.revision, w.revision);
  v_old_shown := public.brand_plan_title_words(c.title, v_brand);
  v_shown := public.brand_plan_title_words(w.title, v_brand);
  IF w.due_on IS DISTINCT FROM c.due_on THEN
    PERFORM public.brand_plan_line(v_brand, format('%s moved “%s” to %s.', v_name, v_shown, public.brand_plan_day_words(w.due_on)));
  END IF;
  IF w.title IS DISTINCT FROM c.title THEN
    PERFORM public.brand_plan_line(v_brand, format('%s renamed “%s” to “%s”.', v_name, v_old_shown, v_shown));
  END IF;
  PERFORM public.brand_plan_line(v_brand, public.brand_plan_link_words(v_name, v_shown, c.files_url, w.files_url));
  RETURN jsonb_build_object('kind', 'task', 'item', public.brand_plan_card_item(w, true, v_uid, true));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
END;
$$;

CREATE FUNCTION public.brand_plan_host_remove(p_kind text, p_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_brand uuid; v_actor text; v_name text;
  i public.content_calendar_items; n public.content_calendar_items; c public.ops_work_cards; w public.ops_work_cards; v_before jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_found: This item is not on your plan.' USING ERRCODE = 'P0002'; END IF;
  -- Only the caller's own item that is on the plan now (rework, P3-1).
  IF p_kind = 'post' THEN
    SELECT * INTO i FROM public.content_calendar_items x
     WHERE x.id = p_id AND x.deleted_at IS NULL AND x.brand_plan_author_id = v_uid
       AND x.brand_id IS NOT NULL AND x.publish_at IS NOT NULL FOR UPDATE;
    v_brand := CASE WHEN FOUND THEN i.brand_id END;
  ELSIF p_kind = 'task' THEN
    SELECT * INTO c FROM public.ops_work_cards x
     WHERE x.id = p_id AND x.archived_at IS NULL AND x.brand_plan_author_id = v_uid AND x.on_brand_plan FOR UPDATE;
    v_brand := CASE WHEN FOUND THEN public.brand_plan_card_brand(c.id) END;
  END IF;
  IF v_brand IS NULL OR NOT public.brand_plan_can_read(v_brand, v_uid) THEN
    RAISE EXCEPTION 'not_found: This item is not on your plan.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.brand_plan_can_write(v_brand, v_uid) THEN
    RAISE EXCEPTION 'read_only: You can see this plan. Ask your brand admin to let you change it.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.brand_plan_host_actor(v_uid);
  v_name := public.brand_plan_host_name(v_uid);
  IF p_kind = 'post' THEN
    IF i.stage <> 'idea' THEN
      RAISE EXCEPTION 'locked: Mingla is already working on this post. Reply in the chat to change it.' USING ERRCODE = '22023';
    END IF;
    IF p_expected_revision IS NULL OR i.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'stale_write: This changed. Showing the latest.' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.content_calendar_items SET deleted_at = now(), deleted_by = v_actor, revision = revision + 1, updated_by = v_actor, updated_at = now()
     WHERE id = i.id RETURNING * INTO n;
    PERFORM public.content_calendar_audit_write(n.id, v_actor, NULL, 'content.deleted',
      jsonb_build_object('from_revision', i.revision, 'to_revision', n.revision, 'changed_fields', jsonb_build_array('deleted_at'), 'source', 'host_app'));
    PERFORM public.brand_plan_line(v_brand, format('%s removed “%s” from the plan.', v_name, public.brand_plan_title_words(i.title, v_brand)));
    RETURN jsonb_build_object('kind', 'post', 'id', i.id, 'removed', true);
  END IF;
  IF c.status <> 'todo' THEN
    RAISE EXCEPTION 'locked: Mingla is already working on this task. Reply in the chat to change it.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR c.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This changed. Showing the latest.' USING ERRCODE = 'PT409';
  END IF;
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards SET archived_at = now(), archived_by = v_actor, archive_reason = 'Removed by the host in the Host app.',
    revision = revision + 1, updated_by = v_actor, updated_via = NULL, updated_at = now()
   WHERE id = c.id RETURNING * INTO w;
  PERFORM public.ops_card_event(w.id, v_actor, NULL, 'archived', 'Removed by the host in the Host app.', v_before, public.ops_card_snapshot(w.id), c.revision, w.revision);
  PERFORM public.brand_plan_line(v_brand, format('%s removed “%s” from the plan.', v_name, public.brand_plan_title_words(c.title, v_brand)));
  RETURN jsonb_build_object('kind', 'task', 'id', c.id, 'removed', true);
END;
$$;

-- Rework (W3 test P4): switching "Host can see this" on or off posts a plan
-- line, so the host knows a card joined or left their plan.
CREATE FUNCTION public.brand_plan_flag_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_brand uuid; v_who text;
BEGIN
  -- A card with no due date is not on the plan either way. The switch never
  -- starts a Brand group and never fails a card save over one: with no group
  -- yet there is nobody to tell.
  IF NEW.archived_at IS NOT NULL OR NEW.status = 'done' OR NEW.due_on IS NULL THEN RETURN NEW; END IF;
  v_brand := public.brand_plan_card_brand(NEW.id);
  IF v_brand IS NULL OR NOT EXISTS (SELECT 1 FROM public.conversations x WHERE x.linked_entity_type = 'brand' AND x.brand_id = v_brand) THEN
    RETURN NEW;
  END IF;
  v_who := public.brand_plan_staff_first(NEW.updated_by);
  IF NEW.on_brand_plan THEN
    PERFORM public.brand_plan_line(v_brand, format('%s added “%s” to the plan for %s.', v_who,
      public.brand_plan_title_words(NEW.title, v_brand), public.brand_plan_day_words(NEW.due_on)));
  ELSE
    PERFORM public.brand_plan_line(v_brand, format('%s removed “%s” from the plan.', v_who, public.brand_plan_title_words(NEW.title, v_brand)));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ops_work_cards_brand_plan_flag_line
  AFTER UPDATE OF on_brand_plan ON public.ops_work_cards
  FOR EACH ROW WHEN (OLD.on_brand_plan IS DISTINCT FROM NEW.on_brand_plan)
  EXECUTE FUNCTION public.brand_plan_flag_line();

-- ---------------------------------------------------------------------------
-- 3-4. The Calendar knows a post's brand.
-- ---------------------------------------------------------------------------
-- From 20271020003802; the #4270 W3 keys are new.
CREATE OR REPLACE FUNCTION public.content_calendar_item_json(r public.content_calendar_items) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'title', r.title, 'stage', r.stage, 'owners', to_jsonb(r.owner_emails),
    'publish_at', r.publish_at, 'channels', to_jsonb(r.channels), 'copy', r.copy_text,
    'notes', r.notes, 'drive_url', r.drive_url, 'live_url', r.live_url,
    'copy_approved_by', r.copy_approved_by, 'copy_approved_at', r.copy_approved_at,
    'design_approved_by', r.design_approved_by, 'design_approved_at', r.design_approved_at,
    'published_without_link', r.published_without_link,
    'format', r.format, 'audience', r.audience, 'city_id', r.city_id,
    'city_name', (SELECT c.name FROM public.seeding_cities c WHERE c.id = r.city_id),
    'revision', r.revision, 'created_by', r.created_by, 'created_at', r.created_at,
    'updated_by', r.updated_by, 'updated_at', r.updated_at,
    'comment_count', (SELECT count(*) FROM public.content_calendar_comments c WHERE c.item_id = r.id))
  -- #4270 W3: the brand, the creator it is made with, the plan link and
  -- what the brand's hosts see.
  || jsonb_build_object(
    'brand_id', r.brand_id,
    'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = r.brand_id),
    'collaborator', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM public.crm_records c
                      WHERE c.id = r.collaborator_record_id AND c.deleted_at IS NULL),
    'plan_link_url', r.plan_link_url,
    'host_state', CASE WHEN r.brand_id IS NOT NULL THEN public.brand_plan_post_state(r.stage, r.publish_at) END,
    'host_state_words', CASE WHEN r.brand_id IS NOT NULL THEN public.brand_plan_state_words(public.brand_plan_post_state(r.stage, r.publish_at)) END,
    'brand_plan_source', r.brand_plan_source)
$$;

-- From 20271231204134 (#4134); only the #4270 W3 lines are new.
CREATE OR REPLACE FUNCTION public.content_calendar_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; v_item public.content_calendar_items; v_after jsonb; v_replay jsonb; v_out jsonb;
  v_args jsonb; v_audit uuid; v_action text := 'content.updated'; v_value text; v_channels text[];
  v_fields text[]; v_before_publish timestamptz;
  -- #4270 W3: what the plan line compares
  v_old public.content_calendar_items; v_who text; v_old_state text; v_new_state text;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_args := jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision);
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'update', v_args);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN
       ('title','publish_at','channels','copy','notes','drive_url','live_url','format','audience','city_id',
        'brand_id','collaborator_record_id','plan_link_url')) THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one supported field.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409';
  END IF;
  v_before_publish := v_item.publish_at;
  v_old := v_item;
  SELECT array_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(p_changes) k;
  IF p_changes ? 'title' THEN
    IF jsonb_typeof(p_changes->'title') <> 'string' OR char_length(btrim(p_changes->>'title')) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'invalid_title: Title must be 1 to 160 characters.' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.content_calendar_items i WHERE i.id<>p_id AND i.deleted_at IS NULL
                 AND i.title_key=public.crm_name_key(p_changes->>'title')) THEN
      RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
    END IF;
    v_item.title := btrim(p_changes->>'title');
  END IF;
  IF p_changes ? 'publish_at' THEN
    IF jsonb_typeof(p_changes->'publish_at') = 'null' THEN v_item.publish_at := NULL;
    ELSIF jsonb_typeof(p_changes->'publish_at') <> 'string' THEN RAISE EXCEPTION 'invalid_publish_at: Use a date-time or null.' USING ERRCODE='22023';
    ELSE v_item.publish_at := (p_changes->>'publish_at')::timestamptz; END IF;
  END IF;
  IF p_changes ? 'channels' THEN
    IF jsonb_typeof(p_changes->'channels') <> 'array' OR jsonb_array_length(p_changes->'channels') > 9
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'channels') e
                   WHERE jsonb_typeof(e) <> 'string' OR e#>>'{}' NOT IN ('instagram','tiktok','facebook','x','threads','youtube','linkedin','website','email')) THEN
      RAISE EXCEPTION 'invalid_channels: Choose only supported channels.' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(array_agg(DISTINCT e ORDER BY e), ARRAY[]::text[]) INTO v_channels
      FROM jsonb_array_elements_text(p_changes->'channels') e;
    v_item.channels := v_channels;
  END IF;
  IF p_changes ? 'copy' THEN
    IF v_item.stage NOT IN ('idea','writing') THEN
      RAISE EXCEPTION 'copy_locked: Copy is read-only after Writing. Move the card back to Writing to revise it.' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_changes->'copy') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'copy','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_copy: Copy must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.copy_text := NULLIF(p_changes->>'copy','');
  END IF;
  IF p_changes ? 'notes' THEN
    IF jsonb_typeof(p_changes->'notes') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'notes','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_notes: Notes must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.notes := NULLIF(p_changes->>'notes','');
  END IF;
  FOREACH v_value IN ARRAY ARRAY['drive_url','live_url'] LOOP
    IF p_changes ? v_value THEN
      IF jsonb_typeof(p_changes->v_value) NOT IN ('string','null') OR char_length(COALESCE(p_changes->>v_value,'')) > 2000
         OR (NULLIF(p_changes->>v_value,'') IS NOT NULL AND (p_changes->>v_value) !~ '^https?://') THEN
        RAISE EXCEPTION 'invalid_url: Links must start with http:// or https:// and be at most 2,000 characters.' USING ERRCODE='22023'; END IF;
      IF v_value='drive_url' THEN v_item.drive_url := NULLIF(p_changes->>v_value,'');
      ELSE v_item.live_url := NULLIF(p_changes->>v_value,''); END IF;
    END IF;
  END LOOP;
  IF p_changes ? 'format' THEN
    IF jsonb_typeof(p_changes->'format') NOT IN ('string','null') OR (NULLIF(p_changes->>'format','') IS NOT NULL
       AND p_changes->>'format' NOT IN ('graphic','carousel','short_video','long_video','story','talking_head','motion_graphics','photo_ugc','blog','email','landing_page')) THEN
      RAISE EXCEPTION 'invalid_format: Choose a supported format.' USING ERRCODE='22023'; END IF;
    v_item.format := NULLIF(p_changes->>'format','');
  END IF;
  IF p_changes ? 'audience' THEN
    IF jsonb_typeof(p_changes->'audience') NOT IN ('string','null') OR (NULLIF(p_changes->>'audience','') IS NOT NULL
       AND p_changes->>'audience' NOT IN ('explorer','business','education_investor')) THEN
      RAISE EXCEPTION 'invalid_audience: Choose a supported audience.' USING ERRCODE='22023'; END IF;
    v_item.audience := NULLIF(p_changes->>'audience','');
  END IF;
  IF p_changes ? 'city_id' THEN
    IF jsonb_typeof(p_changes->'city_id')='null' OR NULLIF(p_changes->>'city_id','') IS NULL THEN v_item.city_id := NULL;
    ELSIF jsonb_typeof(p_changes->'city_id') <> 'string' OR NOT EXISTS (SELECT 1 FROM public.seeding_cities c WHERE c.id=(p_changes->>'city_id')::uuid) THEN
      RAISE EXCEPTION 'invalid_city: Choose a listed city.' USING ERRCODE='22023';
    ELSE v_item.city_id := (p_changes->>'city_id')::uuid; END IF;
  END IF;
  -- #4270 W3: the brand, the creator it is made with, and the plan link
  -- (https only; the Drive link is never touched).
  IF p_changes ? 'brand_id' THEN
    IF jsonb_typeof(p_changes->'brand_id')='null' OR NULLIF(p_changes->>'brand_id','') IS NULL THEN v_item.brand_id := NULL;
    ELSIF jsonb_typeof(p_changes->'brand_id') <> 'string'
       OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id=(p_changes->>'brand_id')::uuid AND b.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'invalid_brand: Choose a brand that is on Mingla.' USING ERRCODE='22023';
    ELSE v_item.brand_id := (p_changes->>'brand_id')::uuid; END IF;
  END IF;
  IF p_changes ? 'collaborator_record_id' THEN
    IF jsonb_typeof(p_changes->'collaborator_record_id')='null' OR NULLIF(p_changes->>'collaborator_record_id','') IS NULL THEN v_item.collaborator_record_id := NULL;
    ELSIF jsonb_typeof(p_changes->'collaborator_record_id') <> 'string'
       OR NOT EXISTS (SELECT 1 FROM public.crm_records c WHERE c.id=(p_changes->>'collaborator_record_id')::uuid
                        AND c.pipeline='creators' AND c.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'invalid_collaborator: Choose a creator from the Creators board.' USING ERRCODE='22023';
    ELSE v_item.collaborator_record_id := (p_changes->>'collaborator_record_id')::uuid; END IF;
  END IF;
  IF p_changes ? 'plan_link_url' THEN
    v_item.plan_link_url := public.brand_plan_clean_link(p_changes->'plan_link_url');
  END IF;
  IF v_item.stage NOT IN ('idea','writing') AND
     (NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL OR v_item.copy_approved_at IS NULL OR v_item.copy_approved_by IS NULL) THEN
    RAISE EXCEPTION 'copy_approval_required: Design and later stages require approved copy.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage IN ('scheduled','published') AND
     (v_item.design_approved_at IS NULL OR v_item.design_approved_by IS NULL OR v_item.publish_at IS NULL OR cardinality(v_item.channels)=0) THEN
    RAISE EXCEPTION 'schedule_required: Scheduled and Published require approved design, a publish date and at least one channel.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage='published' AND v_item.live_url IS NULL AND NOT v_item.published_without_link THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  UPDATE public.content_calendar_items SET title=v_item.title, publish_at=v_item.publish_at, channels=v_item.channels,
    copy_text=v_item.copy_text, notes=v_item.notes, drive_url=v_item.drive_url, live_url=v_item.live_url,
    format=v_item.format, audience=v_item.audience, city_id=v_item.city_id,
    brand_id=v_item.brand_id, collaborator_record_id=v_item.collaborator_record_id, plan_link_url=v_item.plan_link_url,
    revision=revision+1,
    updated_by=v.actor_email, updated_at=now() WHERE id=p_id RETURNING * INTO v_item;
  v_after := public.content_calendar_item_json(v_item);
  IF v_fields = ARRAY['publish_at']::text[] THEN v_action := 'content.rescheduled'; END IF;
  v_audit := public.content_calendar_audit_write(p_id, v.actor_email, v.via, v_action,
    jsonb_build_object('changed_fields',to_jsonb(v_fields),'from_revision',p_expected_revision,'to_revision',v_item.revision) ||
    CASE WHEN v_action='content.rescheduled' THEN jsonb_build_object('previous_publish_at',v_before_publish) ELSE '{}'::jsonb END);
  -- #4270 W3 (OQ-5): a brand post on the plan tells its Brand group when it
  -- joins or leaves the plan, moves, is renamed, or its plan link changes.
  v_who := public.brand_plan_staff_first(v.actor_email);
  v_old_state := CASE WHEN v_old.brand_id IS NOT NULL THEN public.brand_plan_post_state(v_old.stage, v_old.publish_at) END;
  v_new_state := CASE WHEN v_item.brand_id IS NOT NULL THEN public.brand_plan_post_state(v_item.stage, v_item.publish_at) END;
  IF v_old_state IS NOT NULL AND (v_new_state IS NULL OR v_old.brand_id IS DISTINCT FROM v_item.brand_id) THEN
    PERFORM public.brand_plan_line(v_old.brand_id, format('%s removed “%s” from the plan.', v_who, public.brand_plan_title_words(v_old.title, v_old.brand_id)));
  END IF;
  IF v_new_state IS NOT NULL AND (v_old_state IS NULL OR v_old.brand_id IS DISTINCT FROM v_item.brand_id) THEN
    PERFORM public.brand_plan_line(v_item.brand_id, format('%s added “%s” to the plan for %s.', v_who, public.brand_plan_title_words(v_item.title, v_item.brand_id),
      public.brand_plan_day_words((v_item.publish_at AT TIME ZONE 'UTC')::date)));
  ELSIF v_new_state IS NOT NULL THEN
    IF (v_old.publish_at AT TIME ZONE 'UTC')::date IS DISTINCT FROM (v_item.publish_at AT TIME ZONE 'UTC')::date THEN
      PERFORM public.brand_plan_line(v_item.brand_id, format('%s moved “%s” to %s.', v_who, public.brand_plan_title_words(v_item.title, v_item.brand_id),
        public.brand_plan_day_words((v_item.publish_at AT TIME ZONE 'UTC')::date)));
    END IF;
    IF v_old.title IS DISTINCT FROM v_item.title THEN
      PERFORM public.brand_plan_line(v_item.brand_id, format('%s renamed “%s” to “%s”.', v_who, public.brand_plan_title_words(v_old.title, v_item.brand_id), public.brand_plan_title_words(v_item.title, v_item.brand_id)));
    END IF;
    PERFORM public.brand_plan_line(v_item.brand_id, public.brand_plan_link_words(v_who, public.brand_plan_title_words(v_item.title, v_item.brand_id), v_old.plan_link_url, v_item.plan_link_url));
  END IF;
  v_out := jsonb_build_object('item', v_after, 'audit_id', v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_changes: A date or identifier has the wrong shape.' USING ERRCODE='22023';
END;
$function$
;

-- From 20271201003980; only the #4270 W3 brand lines are new.
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
    'content', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'stage', i.stage,
                            'publish_at', i.publish_at, 'channels', to_jsonb(i.channels),
                            -- #4270 W3: the brand the post is for
                            'brand_id', i.brand_id, 'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = i.brand_id)) ORDER BY i.publish_at, i.title)
                           FROM public.content_calendar_items i
                          WHERE i.deleted_at IS NULL AND i.publish_at >= (p_from::timestamp AT TIME ZONE 'UTC')
                            AND i.publish_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')), '[]'::jsonb),
    'posts_undated', (SELECT count(*) FROM public.content_calendar_items i WHERE i.deleted_at IS NULL AND i.publish_at IS NULL));
END;
$function$
;

-- ---------------------------------------------------------------------------
-- Grants. Internal helpers: nobody but the definer functions. Staff reads and
-- writes: signed-in staff (crm_ctx decides). Host functions: signed-in users.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.brand_plan_post_state(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_state_words(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_link_json(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_day_words(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_clean_link(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_staff_first(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_host_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_host_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_host_record(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_window_check(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_free_title(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_line(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_post_item(public.content_calendar_items, boolean, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_card_item(public.ops_work_cards, boolean, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_link_hidden(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_can_read(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_can_write(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_title_words(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_host_title(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_host_change_check(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_flag_line() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_cards(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_card_brand(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_event_item(public.events, date, boolean, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_link_words(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_plan_clean_item(jsonb, text[], date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_plan_post_state(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_plan_state_words(text) TO service_role;

REVOKE ALL ON FUNCTION public.ops_brand_plan(uuid, date, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_brand_plan_add(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_brand_plan_set_link(text, uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_brand_plan(uuid, date, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_brand_plan_add(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_brand_plan_set_link(text, uuid, text, bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.brand_plan_for_host(uuid, date, date) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.brand_plan_host_add(uuid, jsonb, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.brand_plan_host_update(text, uuid, jsonb, bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.brand_plan_host_remove(text, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.brand_plan_for_host(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_plan_host_add(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_plan_host_update(text, uuid, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_plan_host_remove(text, uuid, bigint) TO authenticated;

COMMENT ON FUNCTION public.ops_brand_plan(uuid, date, date, date) IS
  'Issue #4270. The brand plan on a host card (staff): the brand''s dated posts, the Work cards its host can see, its events, experiences and trips, and promised events (Promised). At most 120 days. A read: nothing is copied.';
COMMENT ON FUNCTION public.ops_brand_plan_add(uuid, jsonb, text) IS
  'Issue #4270. Staff add a post (a Calendar Idea at 12:00 UTC on its date) or a task (a Work card the host can see) to a host card''s brand plan. People only.';
COMMENT ON FUNCTION public.ops_brand_plan_set_link(text, uuid, text, bigint) IS
  'Issue #4270. Staff add, change or remove the plan link on a post or task on a brand plan. https only.';
COMMENT ON FUNCTION public.brand_plan_for_host(uuid, date, date) IS
  'Issue #4270. The brand plan in the Host app, for the brand''s own team. Plan links only (never the Drive link, copy, notes or staff details). At most 120 days.';
COMMENT ON FUNCTION public.brand_plan_host_add(uuid, jsonb, text) IS
  'Issue #4270. A host adds a post or a task to their brand plan from the Host app.';
COMMENT ON FUNCTION public.brand_plan_host_update(text, uuid, jsonb, bigint) IS
  'Issue #4270. A host changes the title, date, link or note of their own plan item while Mingla has not started on it.';
COMMENT ON FUNCTION public.brand_plan_host_remove(text, uuid, bigint) IS
  'Issue #4270. A host removes their own plan item while Mingla has not started on it.';
COMMENT ON FUNCTION public.brand_plan_line(uuid, text) IS
  'Issue #4270. A quiet system line in a brand''s Brand group about its plan (titles and dates only). No push.';

-- ---------------------------------------------------------------------------
-- Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $check4270w3$
DECLARE r record; v_src text; v_first text;
  c_host constant text[] := ARRAY['brand_plan_for_host(uuid,date,date)', 'brand_plan_host_add(uuid,jsonb,text)',
                                  'brand_plan_host_update(text,uuid,jsonb,bigint)', 'brand_plan_host_remove(text,uuid,bigint)'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.content_calendar_items'::regclass AND conname = 'content_calendar_plan_link_check')
     OR pg_catalog.pg_get_constraintdef((SELECT oid FROM pg_catalog.pg_constraint WHERE conrelid = 'public.content_calendar_audit'::regclass
                                          AND conname = 'content_calendar_audit_metadata_check')) NOT LIKE '%plan_link_url%' THEN
    RAISE EXCEPTION 'issue 4270 wave 3 self-check: the post columns are not as stated';
  END IF;
  IF public.brand_plan_post_state('idea', now()) <> 'planned' OR public.brand_plan_post_state('idea', NULL) IS NOT NULL
     OR public.brand_plan_post_state('design', now()) <> 'being_made' OR public.brand_plan_post_state('published', now()) <> 'posted' THEN
    RAISE EXCEPTION 'issue 4270 wave 3 self-check: the host state mapping is wrong';
  END IF;
  -- Links: https only, and no hidden characters.
  IF public.brand_plan_link_json('https://canva.com/x') IS NULL OR public.brand_plan_link_json('http://canva.com') IS NOT NULL
     OR public.brand_plan_link_json('https://canva.com' || chr(8238) || 'moc.evil') IS NOT NULL
     OR public.brand_plan_link_json('https://canva.com' || chr(7) || 'x') IS NOT NULL
     OR public.brand_plan_link_json('https://canva.com:x@evil.example') IS NOT NULL
     OR public.brand_plan_link_json('https://canva.com/a@b') IS NULL THEN
    RAISE EXCEPTION 'issue 4270 wave 3 self-check: plan links are not checked as stated';
  END IF;
  -- Who reads and who writes (D14): the read rule names the Brand group's
  -- team rule and the read rank; the write rule needs marketing manager.
  FOR r IN SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, p.prosrc FROM pg_catalog.pg_proc p
            WHERE p.oid IN ('public.brand_plan_can_read(uuid,uuid)'::regprocedure, 'public.brand_plan_can_write(uuid,uuid)'::regprocedure) LOOP
    IF NOT r.prosecdef OR NOT (r.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: % is not pinned', r.sig;
    END IF;
  END LOOP;
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.brand_plan_can_read(uuid,uuid)'::regprocedure)
       NOT LIKE '%p_uid IS NOT NULL%b.deleted_at IS NULL%biz_is_brand_member_for_read(p_brand_id, p_uid)%m.accepted_at IS NOT NULL AND m.removed_at IS NULL%'
     OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.brand_plan_can_write(uuid,uuid)'::regprocedure)
       NOT LIKE '%brand_plan_can_read(p_brand_id, p_uid)%AND public.biz_brand_effective_rank(p_brand_id, p_uid) >= public.biz_role_rank(''marketing_manager'')%' THEN
    RAISE EXCEPTION 'issue 4270 wave 3 self-check: the read or write rule is not as stated';
  END IF;
  -- Every host function is SECURITY DEFINER with a pinned search_path,
  -- signed-in users only, and its first statement is its door: the
  -- membership check for the read and add, the sign-in check for update and
  -- remove (which then find only the caller's own item on the plan and check
  -- membership before anything else).
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, p.prosrc FROM pg_catalog.pg_proc p
            WHERE p.oid IN (SELECT ('public.' || x)::regprocedure FROM unnest(c_host) x) LOOP
    IF NOT r.prosecdef OR NOT (r.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: % is not pinned', r.sig;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('service_role', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: % has the wrong grants', r.sig;
    END IF;
    IF position('v_uid uuid := auth.uid();' IN substring(r.prosrc FOR position('BEGIN' IN r.prosrc))) = 0 THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: % does not take the caller from auth.uid()', r.sig;
    END IF;
    v_src := regexp_replace(substring(r.prosrc FROM position('BEGIN' IN r.prosrc) + 5), '^[[:space:]]+', '');
    v_first := substring(v_src FOR position('END IF;' IN v_src));
    IF r.proname IN ('brand_plan_for_host', 'brand_plan_host_add') THEN
      IF v_first NOT LIKE 'IF v_uid IS NULL OR NOT public.brand_plan_can_read(p_brand_id, v_uid) THEN%RAISE EXCEPTION ''not_found: This plan is not here.'' USING ERRCODE = ''P0002'';%' THEN
        RAISE EXCEPTION 'issue 4270 wave 3 self-check: % does not start with its membership check', r.sig;
      END IF;
    ELSE
      IF v_first NOT LIKE 'IF v_uid IS NULL THEN RAISE EXCEPTION ''not_found: This item is not on your plan.'' USING ERRCODE = ''P0002'';%'
         OR (length(r.prosrc) - length(replace(r.prosrc, 'x.brand_plan_author_id = v_uid', ''))) / length('x.brand_plan_author_id = v_uid') <> 2
         OR r.prosrc NOT LIKE '%x.brand_plan_author_id = v_uid AND x.on_brand_plan FOR UPDATE%'
         OR r.prosrc NOT LIKE '%IF v_brand IS NULL OR NOT public.brand_plan_can_read(v_brand, v_uid) THEN%' THEN
        RAISE EXCEPTION 'issue 4270 wave 3 self-check: % does not check the caller''s own item and membership first', r.sig;
      END IF;
    END IF;
    IF r.proname <> 'brand_plan_for_host' AND r.prosrc NOT LIKE '%IF NOT public.brand_plan_can_write(%' THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: % does not check the write rank', r.sig;
    END IF;
  END LOOP;
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.brand_plan_for_host(uuid,date,date)'::regprocedure)
       NOT LIKE '%AND (v_team OR public.ops_event_public(e.id))%' THEN
    RAISE EXCEPTION 'issue 4270 wave 3 self-check: venue staff could read events they cannot open';
  END IF;
  -- Nothing of the plan is runnable by anon; every internal helper is closed
  -- to signed-in users too (only the four host functions and the staff ops_
  -- functions are callable).
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE 'brand\_plan%' OR p.proname LIKE 'ops\_brand\_plan%' OR p.proname = 'ops_event_when') LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: anon can run %', r.sig;
    END IF;
    IF r.proname LIKE 'brand\_plan%' AND NOT (replace(r.sig, 'public.', '') = ANY (c_host))
       AND has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: the internal helper % is callable', r.sig;
    END IF;
    IF r.proname = 'ops_event_when' AND has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4270 wave 3 self-check: the internal helper % is callable', r.sig;
    END IF;
  END LOOP;
  IF pg_catalog.pg_get_functiondef('public.content_calendar_update(uuid,jsonb,bigint,text)'::regprocedure) NOT LIKE '%brand_plan_line%' THEN
    RAISE EXCEPTION 'issue 4270 wave 3 self-check: Calendar edits do not post plan lines';
  END IF;
END;
$check4270w3$;

COMMIT;
