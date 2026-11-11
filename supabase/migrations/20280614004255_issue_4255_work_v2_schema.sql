-- Issue #4255, Work board v2, wave W1a (part 1 of 2): the tables, columns,
-- guards and one-time backfills. The functions that read and write them are
-- in 20280614014255_issue_4255_work_v2_functions.sql.
--
-- What this adds (all additive; no existing column is dropped):
--   1. Custom columns. ops_work_statuses holds the board's columns. Every
--      column belongs to one of three groups (todo = Not started, doing =
--      Active, done = Closed). ops_work_cards.status_id points at the column
--      and a trigger keeps the old ops_work_cards.status equal to that
--      column's group, both ways: a function that writes status (every
--      existing one) lands the card in the first live column of that group;
--      a write of status_id sets status. So every existing function, sort,
--      count, sprint carry-over, email and agent tool keeps working. Seeded
--      with To do / In progress / Done; every card is backfilled.
--   2. Subtasks are real cards: parent_id, depth (0 to 2), position,
--      start_on, estimate_minutes, description_md (up to 20,000 characters)
--      and plan_step (the old plan step's tool, status, result and check
--      time, so plan_work and update_work step keep their shape). The
--      database refuses a card that is its own ancestor, a depth over 2, an
--      open subtask under a closed card, and closing a card that has open
--      subtasks unless the closer asked to close them too (a system close,
--      a push back or a close with ops.close_children = on closes them with
--      the parent). Archiving a card archives its subtasks. Every card's plan
--      steps become subtasks once, here, and the plan column is emptied:
--      subtasks are the one owner of the plan from now on.
--   3. Files: ops_work_files (image, document or link; 25 MB cap) and the
--      PRIVATE storage bucket ops-work-files. Objects are reached only by
--      signed links for active teammates and only while their row is live.
--      No Supabase image transformations (spend cap, #1643). Each card's
--      files_url becomes a link file, and stays in step with it.
--   4. Thread: ops_work_messages (replies, mentions, edit, delete, agent
--      posts) and ops_work_message_reactions. Every existing note becomes a
--      message, with the teammates it tagged.
--   5. Sprint planning: ops_sprint_goals (five live goals per sprint, checked
--      in the function), ops_work_cards.goal_id and in_backlog,
--      ops_sprint_capacity, and ops_sprints.planned_at / plan_baseline /
--      review_note. Each sprint's goal text becomes its goal 1.
--
-- Every new table has row security on, no policy and no client privilege:
-- every read and write goes through the SECURITY DEFINER ops_ functions.
-- Static SQL only (no EXECUTE of built strings). Do not auto-apply; release
-- through the governed migration lane.
--
-- ROLLBACK (no down file): roll the admin client back first, then in one
-- transaction drop the triggers added here, restore each plan from its
-- subtasks (plan_step + title, ordered by position), drop the subtask rows
-- (parent_id IS NOT NULL AND created_via = 'system' AND plan_step IS NOT
-- NULL), restore ops_work_cards_open_title_key without the parent_id
-- condition, then drop the new columns, tables and the bucket's policies.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Columns of the board.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_work_statuses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  color       text NOT NULL,
  grp         text NOT NULL,
  position    integer NOT NULL,
  revision    bigint NOT NULL DEFAULT 1,
  archived_at timestamptz,
  archived_by text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_work_statuses_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 30 AND name !~ E'[\\r\\n]'),
  CONSTRAINT ops_work_statuses_color_check CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT ops_work_statuses_grp_check CHECK (grp IN ('todo','doing','done')),
  CONSTRAINT ops_work_statuses_position_check CHECK (position >= 0),
  CONSTRAINT ops_work_statuses_revision_check CHECK (revision > 0),
  CONSTRAINT ops_work_statuses_archive_pair CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  CONSTRAINT ops_work_statuses_created_by_check CHECK (created_by = lower(btrim(created_by)) AND created_by <> ''),
  CONSTRAINT ops_work_statuses_updated_by_check CHECK (updated_by = lower(btrim(updated_by)) AND updated_by <> '')
);
CREATE UNIQUE INDEX ops_work_statuses_live_name ON public.ops_work_statuses (lower(name)) WHERE archived_at IS NULL;
CREATE INDEX ops_work_statuses_live_order ON public.ops_work_statuses (grp, position) WHERE archived_at IS NULL;
ALTER TABLE public.ops_work_statuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_work_statuses FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_work_statuses IS
  'Issue #4255. The Work board''s columns. grp is the fixed meaning underneath (todo Not started, doing Active, done Closed); ops_work_cards.status is always the group of its status_id. Admins add, rename, recolour, reorder and archive columns through ops_status_* functions; there is always a live column in each group.';

-- The starting columns: nothing changes for anyone on day one.
INSERT INTO public.ops_work_statuses (id, name, color, grp, position, created_by, updated_by) VALUES
  ('a4255000-0000-4000-8000-000000000001', 'To do',       '#8a847b', 'todo',  0, 'system@usemingla.com', 'system@usemingla.com'),
  ('a4255000-0000-4000-8000-000000000002', 'In progress', '#2f6fd6', 'doing', 1, 'system@usemingla.com', 'system@usemingla.com'),
  ('a4255000-0000-4000-8000-000000000003', 'Done',        '#1f8a5b', 'done',  2, 'system@usemingla.com', 'system@usemingla.com');

-- The column a card lands in when only its group is known: the first live
-- column of that group. The retired status person (#4270) reads as To do.
CREATE FUNCTION public.ops_status_default(p_grp text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.id FROM public.ops_work_statuses s
   WHERE s.grp = CASE WHEN p_grp = 'person' THEN 'todo' ELSE p_grp END AND s.archived_at IS NULL
   ORDER BY s.position, s.created_at, s.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.ops_status_default(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sprint goals (needed before the card columns that point at them).
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_sprint_goals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id          uuid NOT NULL REFERENCES public.ops_sprints(id) ON DELETE CASCADE,
  title              text NOT NULL,
  owner_email        text,
  state              text NOT NULL DEFAULT 'on_track',
  state_source       text NOT NULL DEFAULT 'auto',
  manual_basis       text,
  position           integer NOT NULL DEFAULT 0,
  revision           bigint NOT NULL DEFAULT 1,
  archived_at        timestamptz,
  archived_by        text,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_sprint_goals_title_check CHECK (title = btrim(title) AND char_length(title) BETWEEN 3 AND 80 AND title !~ E'[\\r\\n]'),
  CONSTRAINT ops_sprint_goals_owner_check CHECK (owner_email IS NULL OR (owner_email = lower(btrim(owner_email)) AND owner_email <> '')),
  CONSTRAINT ops_sprint_goals_state_check CHECK (state IN ('on_track','at_risk','done','missed')),
  CONSTRAINT ops_sprint_goals_state_source_check CHECK (state_source IN ('auto','manual')),
  CONSTRAINT ops_sprint_goals_manual_basis_check CHECK (manual_basis IS NULL OR manual_basis IN ('on_track','at_risk','done','missed')),
  CONSTRAINT ops_sprint_goals_position_check CHECK (position >= 0),
  CONSTRAINT ops_sprint_goals_revision_check CHECK (revision > 0),
  CONSTRAINT ops_sprint_goals_archive_pair CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  CONSTRAINT ops_sprint_goals_created_by_check CHECK (created_by = lower(btrim(created_by)) AND created_by <> ''),
  CONSTRAINT ops_sprint_goals_updated_by_check CHECK (updated_by = lower(btrim(updated_by)) AND updated_by <> '')
);
CREATE INDEX ops_sprint_goals_live ON public.ops_sprint_goals (sprint_id, position) WHERE archived_at IS NULL;
ALTER TABLE public.ops_sprint_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_sprint_goals FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_sprint_goals IS
  'Issue #4255. Up to five live goals per sprint (checked in ops_sprint_goal_add). state_source manual means a person set state; it holds while the automatic verdict is still manual_basis (the verdict when it was set), and gives way at the next automatic change of direction.';

CREATE TABLE public.ops_sprint_capacity (
  sprint_id uuid NOT NULL REFERENCES public.ops_sprints(id) ON DELETE CASCADE,
  email     text NOT NULL,
  hours     numeric(5,1) NOT NULL,
  set_by    text NOT NULL,
  set_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sprint_id, email),
  CONSTRAINT ops_sprint_capacity_email_check CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT ops_sprint_capacity_hours_check CHECK (hours >= 0 AND hours <= 80),
  CONSTRAINT ops_sprint_capacity_set_by_check CHECK (set_by = lower(btrim(set_by)) AND set_by <> '')
);
ALTER TABLE public.ops_sprint_capacity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_sprint_capacity FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_sprint_capacity IS
  'Issue #4255. Hours a teammate has for a sprint (0 to 80). A sprint with no row reads the previous sprint''s hours.';

ALTER TABLE public.ops_sprints
  ADD COLUMN planned_at    timestamptz,
  ADD COLUMN planned_by    text,
  ADD COLUMN plan_baseline jsonb,
  ADD COLUMN review_note   text,
  ADD COLUMN revision      bigint NOT NULL DEFAULT 1;
ALTER TABLE public.ops_sprints
  ADD CONSTRAINT ops_sprints_planned_pair CHECK ((planned_at IS NULL) = (planned_by IS NULL) AND (planned_at IS NULL) = (plan_baseline IS NULL)),
  ADD CONSTRAINT ops_sprints_plan_baseline_check CHECK (plan_baseline IS NULL OR jsonb_typeof(plan_baseline) = 'array'),
  ADD CONSTRAINT ops_sprints_review_note_check CHECK (review_note IS NULL OR (review_note = btrim(review_note) AND char_length(review_note) BETWEEN 1 AND 200 AND review_note !~ E'[\\r\\n]')),
  ADD CONSTRAINT ops_sprints_revision_check CHECK (revision > 0);
COMMENT ON COLUMN public.ops_sprints.plan_baseline IS
  'Issue #4255. Set by ops_sprint_start: the cards in the sprint with their estimates and goals at that moment. A card in the sprint that is not in it was added mid-sprint.';
COMMENT ON COLUMN public.ops_sprints.goal IS
  'Issue #3980. The one free-text goal, kept and read as goal 1 for past sprints (#4255 copied it into ops_sprint_goals).';

-- ---------------------------------------------------------------------------
-- 3. Card columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_work_cards
  ADD COLUMN status_id        uuid REFERENCES public.ops_work_statuses(id),
  ADD COLUMN parent_id        uuid REFERENCES public.ops_work_cards(id) ON DELETE RESTRICT,
  ADD COLUMN depth            smallint NOT NULL DEFAULT 0,
  ADD COLUMN position         integer,
  ADD COLUMN start_on         date,
  ADD COLUMN estimate_minutes integer,
  ADD COLUMN description_md   text,
  ADD COLUMN plan_step        jsonb,
  ADD COLUMN goal_id          uuid REFERENCES public.ops_sprint_goals(id) ON DELETE SET NULL,
  ADD COLUMN in_backlog       boolean NOT NULL DEFAULT false;
ALTER TABLE public.ops_work_cards
  ADD CONSTRAINT ops_work_cards_depth_check CHECK (depth BETWEEN 0 AND 2),
  ADD CONSTRAINT ops_work_cards_depth_parent CHECK ((parent_id IS NULL) = (depth = 0)),
  ADD CONSTRAINT ops_work_cards_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  ADD CONSTRAINT ops_work_cards_position_check CHECK (position IS NULL OR position >= 0),
  ADD CONSTRAINT ops_work_cards_estimate_check CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 1 AND 60000),
  ADD CONSTRAINT ops_work_cards_description_check CHECK (description_md IS NULL OR char_length(description_md) <= 20000),
  ADD CONSTRAINT ops_work_cards_plan_step_check CHECK (plan_step IS NULL OR (jsonb_typeof(plan_step) = 'object' AND parent_id IS NOT NULL));
CREATE INDEX ops_work_cards_children ON public.ops_work_cards (parent_id, position) WHERE parent_id IS NOT NULL;
CREATE INDEX ops_work_cards_status_col ON public.ops_work_cards (status_id) WHERE archived_at IS NULL;
CREATE INDEX ops_work_cards_goal ON public.ops_work_cards (goal_id) WHERE goal_id IS NOT NULL;
COMMENT ON COLUMN public.ops_work_cards.status_id IS
  'Issue #4255. The board column. status is always this column''s group (trigger ops_4255_a_status_sync).';
COMMENT ON COLUMN public.ops_work_cards.parent_id IS
  'Issue #4255. A subtask is a card with a parent. Two levels deep at most; never its own ancestor (trigger ops_4255_b_tree_guard).';
COMMENT ON COLUMN public.ops_work_cards.plan_step IS
  'Issue #4255. On a subtask made from (or kept in step with) a plan step: the step''s tool, status, result and checked_at, so the plan reads back in its old shape.';
COMMENT ON COLUMN public.ops_work_cards.plan IS
  'Issue #3980. Retired by #4255: plan steps are subtasks now. Kept empty on every card; the plan an agent reads is built from the subtasks.';
COMMENT ON COLUMN public.ops_work_cards.in_backlog IS
  'Issue #4255. In the backlog for sprint planning, not in a sprint plan.';

-- Every card lands in the default column of its group.
UPDATE public.ops_work_cards w SET status_id = public.ops_status_default(w.status);
ALTER TABLE public.ops_work_cards ALTER COLUMN status_id SET NOT NULL;

-- One open top-level card per title. Subtasks often share words ("Send the
-- email"), so they are left out.
DROP INDEX public.ops_work_cards_open_title_key;
CREATE UNIQUE INDEX ops_work_cards_open_title_key ON public.ops_work_cards (title_key)
  WHERE status <> 'done' AND archived_at IS NULL AND parent_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Guards.
-- ---------------------------------------------------------------------------

-- (a) status and status_id stay one truth.
CREATE FUNCTION public.ops_4255_status_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_grp text; v_archived timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_id IS NULL THEN
      NEW.status_id := public.ops_status_default(NEW.status);
      RETURN NEW;
    END IF;
  ELSIF NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.status_id := public.ops_status_default(NEW.status);
    END IF;
    RETURN NEW;
  END IF;
  -- The column was chosen: the group follows it.
  SELECT s.grp, s.archived_at INTO v_grp, v_archived FROM public.ops_work_statuses s WHERE s.id = NEW.status_id;
  IF v_grp IS NULL THEN
    RAISE EXCEPTION 'not_found: That column is no longer on the board.' USING ERRCODE = 'P0002';
  END IF;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'column_archived: That column was archived. Pick another column.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM v_grp THEN
    RAISE EXCEPTION 'status_mismatch: A card''s status and column must agree.' USING ERRCODE = '22023';
  END IF;
  NEW.status := v_grp;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_status_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_a_status_sync
  BEFORE INSERT OR UPDATE OF status, status_id ON public.ops_work_cards
  FOR EACH ROW EXECUTE FUNCTION public.ops_4255_status_sync();
-- ALWAYS: it holds even for a session in replica mode (fixtures and bulk
-- loads write rows with ordinary triggers off; a card must still land in a
-- column).
ALTER TABLE public.ops_work_cards ENABLE ALWAYS TRIGGER ops_4255_a_status_sync;

-- (b) The tree: depth comes from the parent, no cycles, at most two levels,
--     no open subtask under a closed card, subtasks keep a position.
CREATE FUNCTION public.ops_4255_tree_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE p public.ops_work_cards; v_cursor uuid; v_hops integer := 0; v_below integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    IF TG_OP = 'UPDATE' AND OLD.parent_id IS NOT NULL THEN NEW.position := NULL; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.depth IS NOT DISTINCT FROM OLD.depth
     AND NOT (OLD.status = 'done' AND NEW.status <> 'done') THEN
    RETURN NEW;  -- same place in the tree, and not a reopen
  END IF;
  SELECT * INTO p FROM public.ops_work_cards w WHERE w.id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_parent: That parent card does not exist.' USING ERRCODE = '22023';
  END IF;
  -- A card is never its own ancestor.
  v_cursor := NEW.parent_id;
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'invalid_parent: A card cannot be a subtask of itself or of its own subtask.' USING ERRCODE = '22023';
    END IF;
    v_hops := v_hops + 1;
    IF v_hops > 10 THEN EXIT; END IF;
    SELECT w.parent_id INTO v_cursor FROM public.ops_work_cards w WHERE w.id = v_cursor;
  END LOOP;
  IF p.depth >= 2 THEN
    RAISE EXCEPTION 'too_deep: Subtasks go two levels deep at most (card, subtask, sub-subtask).' USING ERRCODE = '22023';
  END IF;
  NEW.depth := p.depth + 1;
  -- A card that already has subtasks brings them along: the deepest of them
  -- must still be at most two levels down.
  IF TG_OP = 'UPDATE' THEN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.ops_work_cards g JOIN public.ops_work_cards c ON c.id = g.parent_id WHERE c.parent_id = NEW.id) THEN 2
                WHEN EXISTS (SELECT 1 FROM public.ops_work_cards c WHERE c.parent_id = NEW.id) THEN 1 ELSE 0 END INTO v_below;
    IF NEW.depth + v_below > 2 THEN
      RAISE EXCEPTION 'too_deep: Subtasks go two levels deep at most (card, subtask, sub-subtask).' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.status <> 'done' AND NEW.archived_at IS NULL AND p.status = 'done' THEN
    RAISE EXCEPTION 'parent_closed: The parent card is closed. Reopen it first.' USING ERRCODE = '22023';
  END IF;
  IF NEW.archived_at IS NULL AND p.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_parent: That parent card was removed.' USING ERRCODE = '22023';
  END IF;
  IF NEW.position IS NULL OR (TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id AND NEW.position IS NOT DISTINCT FROM OLD.position) THEN
    SELECT COALESCE(max(c.position) + 1, 0) INTO NEW.position FROM public.ops_work_cards c
     WHERE c.parent_id = NEW.parent_id AND c.id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_tree_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_b_tree_guard
  BEFORE INSERT OR UPDATE OF parent_id, depth, status, status_id ON public.ops_work_cards
  FOR EACH ROW EXECUTE FUNCTION public.ops_4255_tree_guard();
ALTER TABLE public.ops_work_cards ENABLE ALWAYS TRIGGER ops_4255_b_tree_guard;

-- A card that moves brings its subtasks' depth along.
CREATE FUNCTION public.ops_4255_tree_follow() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.ops_work_cards c SET depth = NEW.depth + 1 WHERE c.parent_id = NEW.id AND c.depth IS DISTINCT FROM NEW.depth + 1;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_tree_follow() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_c_tree_follow
  AFTER UPDATE OF parent_id, depth ON public.ops_work_cards
  FOR EACH ROW WHEN (NEW.depth IS DISTINCT FROM OLD.depth)
  EXECUTE FUNCTION public.ops_4255_tree_follow();

-- (c) A card closes with open subtasks only when the closer asked to close
--     them too: ops.close_children = on in this transaction (ops_work_move
--     with close_children), a system close, or a push back (declined or
--     already done, which ends the whole piece of work). Open subtasks that
--     are old plan steps (plan_step set) never block a close: closing never
--     waited for plan steps before #4255 (69 tagged cards had open steps on
--     10 Nov), so Mark sent, close_work and the rest keep working; those
--     steps close with the card as a system close.
CREATE FUNCTION public.ops_4255_close_children_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_open integer;
BEGIN
  SELECT count(*) INTO v_open FROM public.ops_work_cards c
   WHERE c.parent_id = NEW.id AND c.status <> 'done' AND c.archived_at IS NULL AND c.plan_step IS NULL;
  IF v_open = 0 THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('ops.close_children', true), '') = 'on'
     OR NEW.closed_via = 'system' OR NEW.close_kind IN ('declined','already_done','system') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%', format('open_subtasks: This card has %s open %s. Close %s first, or choose to close %s too.',
      v_open, CASE WHEN v_open = 1 THEN 'subtask' ELSE 'subtasks' END,
      CASE WHEN v_open = 1 THEN 'it' ELSE 'them' END, CASE WHEN v_open = 1 THEN 'it' ELSE 'them' END)
    USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_close_children_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_d_close_children_guard
  BEFORE UPDATE OF status, status_id ON public.ops_work_cards
  FOR EACH ROW WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION public.ops_4255_close_children_guard();

CREATE FUNCTION public.ops_4255_close_children() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE r record; n public.ops_work_cards; v_before jsonb;
        v_kind text := CASE WHEN COALESCE(current_setting('ops.close_children', true), '') = 'on' OR NEW.close_kind <> 'done'
                            THEN NEW.close_kind ELSE 'system' END;
BEGIN
  FOR r IN SELECT c.id, c.revision FROM public.ops_work_cards c
            WHERE c.parent_id = NEW.id AND c.status <> 'done' AND c.archived_at IS NULL ORDER BY c.position, c.number FOR UPDATE LOOP
    v_before := public.ops_card_snapshot(r.id);
    UPDATE public.ops_work_cards c SET status = 'done', person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
      close_kind = v_kind, close_reason = left(format('Closed with Card %s.', NEW.number), 500),
      closed_at = NEW.closed_at, closed_by = NEW.closed_by, closed_via = NEW.closed_via,
      working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
      revision = c.revision + 1, updated_by = NEW.updated_by, updated_via = NEW.updated_via, updated_at = now()
     WHERE c.id = r.id RETURNING c.* INTO n;
    PERFORM public.ops_claims_release_card(r.id, 'closed', NEW.updated_by);
    PERFORM public.ops_card_event(r.id, NEW.updated_by, NEW.updated_via, 'closed', format('Closed with Card %s.', NEW.number),
      v_before, public.ops_card_snapshot(r.id), r.revision, n.revision);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_close_children() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_e_close_children
  AFTER UPDATE OF status, status_id ON public.ops_work_cards
  FOR EACH ROW WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION public.ops_4255_close_children();

-- (d) Removing a card removes its subtasks.
CREATE FUNCTION public.ops_4255_archive_children() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.ops_work_cards c SET archived_at = NEW.archived_at, archived_by = NEW.archived_by, archive_reason = NEW.archive_reason,
    working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
    revision = c.revision + 1, updated_by = NEW.updated_by, updated_via = NEW.updated_via, updated_at = now()
   WHERE c.parent_id = NEW.id AND c.archived_at IS NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_archive_children() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_f_archive_children
  AFTER UPDATE OF archived_at ON public.ops_work_cards
  FOR EACH ROW WHEN (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL)
  EXECUTE FUNCTION public.ops_4255_archive_children();

-- ---------------------------------------------------------------------------
-- 5. Thread.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_work_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           uuid NOT NULL REFERENCES public.ops_work_cards(id) ON DELETE CASCADE,
  parent_message_id uuid REFERENCES public.ops_work_messages(id) ON DELETE CASCADE,
  author_email      text NOT NULL,
  via               text,
  chat              text,
  body_md           text NOT NULL DEFAULT '',
  mentions          text[] NOT NULL DEFAULT ARRAY[]::text[],
  mention_everyone  boolean NOT NULL DEFAULT false,
  event_id          uuid UNIQUE REFERENCES public.ops_work_events(id) ON DELETE SET NULL,
  revision          bigint NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at         timestamptz,
  deleted_at        timestamptz,
  deleted_by        text,
  request_key       text,
  CONSTRAINT ops_work_messages_author_check CHECK (author_email = lower(btrim(author_email)) AND author_email <> ''),
  CONSTRAINT ops_work_messages_via_check CHECK (via IS NULL OR via IN ('claude','codex','system')),
  CONSTRAINT ops_work_messages_chat_check CHECK (chat IS NULL OR chat = 'default' OR chat ~ '^[0-9a-f]{16}$'),
  CONSTRAINT ops_work_messages_body_check CHECK (char_length(body_md) <= 10000),
  CONSTRAINT ops_work_messages_mentions_check CHECK (cardinality(mentions) <= 50),
  CONSTRAINT ops_work_messages_not_own_parent CHECK (parent_message_id IS NULL OR parent_message_id <> id),
  CONSTRAINT ops_work_messages_revision_check CHECK (revision > 0),
  CONSTRAINT ops_work_messages_deleted_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX ops_work_messages_by_card ON public.ops_work_messages (card_id, created_at);
CREATE INDEX ops_work_messages_replies ON public.ops_work_messages (parent_message_id, created_at) WHERE parent_message_id IS NOT NULL;
CREATE UNIQUE INDEX ops_work_messages_request_key ON public.ops_work_messages (author_email, request_key) WHERE request_key IS NOT NULL;
ALTER TABLE public.ops_work_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_work_messages FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_work_messages IS
  'Issue #4255. A card''s thread. Replies are one level (parent_message_id points at a top-level message). Each message has a note event (event_id) so mentions go through ops_notify_people with the #4255 email rules unchanged. Edit and delete are the author''s own; delete is soft.';

CREATE TABLE public.ops_work_message_reactions (
  message_id uuid NOT NULL REFERENCES public.ops_work_messages(id) ON DELETE CASCADE,
  email      text NOT NULL,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, email, emoji),
  CONSTRAINT ops_work_message_reactions_email_check CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT ops_work_message_reactions_emoji_check CHECK (char_length(emoji) BETWEEN 1 AND 16 AND emoji !~ '[[:space:][:cntrl:]]')
);
ALTER TABLE public.ops_work_message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_work_message_reactions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Files.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_work_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        uuid NOT NULL REFERENCES public.ops_work_cards(id) ON DELETE CASCADE,
  message_id     uuid REFERENCES public.ops_work_messages(id) ON DELETE SET NULL,
  kind           text NOT NULL,
  name           text NOT NULL,
  mime           text,
  size_bytes     bigint,
  storage_path   text UNIQUE,
  url            text,
  from_files_url boolean NOT NULL DEFAULT false,
  added_by       text NOT NULL,
  added_via      text,
  added_at       timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,
  archived_by    text,
  CONSTRAINT ops_work_files_kind_check CHECK (kind IN ('image','document','link')),
  CONSTRAINT ops_work_files_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT ops_work_files_mime_check CHECK (mime IS NULL OR (char_length(mime) BETWEEN 3 AND 120 AND mime ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$')),
  CONSTRAINT ops_work_files_size_check CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 26214400),
  CONSTRAINT ops_work_files_where CHECK (
    (kind = 'link' AND url IS NOT NULL AND storage_path IS NULL AND mime IS NULL AND size_bytes IS NULL)
    OR (kind <> 'link' AND url IS NULL AND storage_path IS NOT NULL AND mime IS NOT NULL AND size_bytes IS NOT NULL AND NOT from_files_url)),
  CONSTRAINT ops_work_files_url_check CHECK (url IS NULL OR (char_length(url) BETWEEN 9 AND 2000 AND url ~ '^https://[^[:space:]]+$')),
  CONSTRAINT ops_work_files_path_check CHECK (storage_path IS NULL OR storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  CONSTRAINT ops_work_files_added_by_check CHECK (added_by = lower(btrim(added_by)) AND added_by <> ''),
  CONSTRAINT ops_work_files_added_via_check CHECK (added_via IS NULL OR added_via IN ('claude','codex','system')),
  CONSTRAINT ops_work_files_archive_pair CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);
CREATE INDEX ops_work_files_by_card ON public.ops_work_files (card_id, added_at) WHERE archived_at IS NULL;
CREATE INDEX ops_work_files_by_message ON public.ops_work_files (message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX ops_work_files_one_files_url ON public.ops_work_files (card_id) WHERE from_files_url AND archived_at IS NULL;
ALTER TABLE public.ops_work_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_work_files FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_work_files IS
  'Issue #4255. A card''s files: pictures and documents in the private ops-work-files bucket (25 MB each, signed links only, while the row is live), and links. from_files_url marks the one link that mirrors ops_work_cards.files_url (the Host app and host card still write that).';

-- The card's Files link (written by the host card and the Host app too)
-- stays in step with its link file.
CREATE FUNCTION public.ops_4255_files_url_follow() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_host text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.files_url IS NOT DISTINCT FROM OLD.files_url THEN RETURN NULL; END IF;
  IF NEW.files_url IS NULL THEN
    UPDATE public.ops_work_files f SET archived_at = now(), archived_by = NEW.updated_by
     WHERE f.card_id = NEW.id AND f.from_files_url AND f.archived_at IS NULL;
    RETURN NULL;
  END IF;
  v_host := COALESCE(NULLIF(substring(NEW.files_url FROM '^https://([^/?#]+)'), ''), 'Files');
  UPDATE public.ops_work_files f SET url = NEW.files_url, name = left(v_host, 200)
   WHERE f.card_id = NEW.id AND f.from_files_url AND f.archived_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.ops_work_files (card_id, kind, name, url, from_files_url, added_by, added_via)
    VALUES (NEW.id, 'link', left(v_host, 200), NEW.files_url, true, NEW.updated_by,
            CASE WHEN NEW.updated_via IN ('claude','codex','system') THEN NEW.updated_via END);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_files_url_follow() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4255_g_files_url_follow
  AFTER INSERT OR UPDATE OF files_url ON public.ops_work_cards
  FOR EACH ROW EXECUTE FUNCTION public.ops_4255_files_url_follow();

-- The private bucket. Static SQL only (#1860 C7): the bucket shape is
-- probed, never EXECUTEd. No image transformations (#1643).
DO $bucket$
DECLARE has_public boolean; has_file_size_limit boolean; has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public') INTO has_public;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') INTO has_file_size_limit;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') INTO has_allowed_mime_types;
  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('ops-work-files', 'ops-work-files', false, 26214400, ARRAY[
      'image/jpeg','image/png','image/webp','image/gif','image/heic',
      'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv','application/vnd.apple.keynote','application/vnd.apple.numbers','application/vnd.apple.pages'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('ops-work-files', 'ops-work-files', false)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name) VALUES ('ops-work-files', 'ops-work-files')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  END IF;
END
$bucket$;

-- Who may put or read an object: an active teammate, for a live file row.
-- An upload goes only to the path ops_file_add issued to that person in the
-- last 24 hours; a read (which is how a signed link is made) only while the
-- file row is live and its card is not removed.
CREATE FUNCTION public.ops_file_can_upload(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE(public.admin_team_can('crm'), false)
     AND EXISTS (SELECT 1 FROM public.ops_work_files f JOIN public.ops_work_cards w ON w.id = f.card_id
                  WHERE f.storage_path = p_name AND f.archived_at IS NULL AND w.archived_at IS NULL
                    AND f.added_at > now() - interval '24 hours'
                    AND f.added_by = (SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.ops_file_can_upload(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_file_can_upload(text) TO authenticated;

CREATE FUNCTION public.ops_file_can_read(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE(public.admin_team_can('crm'), false)
     AND EXISTS (SELECT 1 FROM public.ops_work_files f JOIN public.ops_work_cards w ON w.id = f.card_id
                  WHERE f.storage_path = p_name AND f.archived_at IS NULL AND w.archived_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.ops_file_can_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_file_can_read(text) TO authenticated;

DROP POLICY IF EXISTS ops_work_files_object_insert ON storage.objects;
CREATE POLICY ops_work_files_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ops-work-files' AND public.ops_file_can_upload(name));

DROP POLICY IF EXISTS ops_work_files_object_select ON storage.objects;
CREATE POLICY ops_work_files_object_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ops-work-files' AND public.ops_file_can_read(name));
-- No UPDATE or DELETE policy: a file is never replaced in place; archiving
-- its row stops it being served at once.

-- ---------------------------------------------------------------------------
-- 7. Backfills, once.
-- ---------------------------------------------------------------------------

-- The teammate a plan step names (exactly one current teammate, by address
-- or first name as a whole word), else the card's owners for a person step,
-- else nobody.
CREATE FUNCTION public.ops_4255_step_owners(p_text text, p_tool text, p_card_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_text text := lower(COALESCE(p_text, '')); v_owner text[];
BEGIN
  v_owner := ARRAY(SELECT d.email FROM public.admin_team_directory() d
                    WHERE d.status = 'active'
                      AND (position(lower(d.email) IN v_text) > 0
                           OR (char_length(split_part(public.crm_display_name(d.email), ' ', 1)) >= 3
                               AND position('@' IN public.crm_display_name(d.email)) = 0
                               AND v_text ~ ('\m' || regexp_replace(lower(split_part(public.crm_display_name(d.email), ' ', 1)),
                                                                    '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')))
                    ORDER BY d.email);
  IF cardinality(v_owner) = 1 THEN RETURN v_owner; END IF;
  IF p_tool = 'person' THEN RETURN public.ops_card_people(p_card_id, 'owner'); END IF;
  RETURN ARRAY[]::text[];
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_step_owners(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- (a) Plan steps become subtasks. Done steps become closed subtasks; on a
--     card that is already closed every step is closed with it; on a removed
--     card its subtasks are removed with it. A step that names exactly one
--     current teammate (by name or address) gets that teammate as owner; a
--     person step with no name gets the card's owners.
CREATE FUNCTION public.ops_4255_plan_to_subtasks() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com';
  r record; s record; v_title text; v_id uuid; v_done boolean; v_owner text[]; v_before jsonb; n public.ops_work_cards;
  v_cards integer := 0; v_steps integer := 0; v_owned integer := 0;
BEGIN
  FOR r IN SELECT w.* FROM public.ops_work_cards w
            WHERE w.parent_id IS NULL AND jsonb_typeof(w.plan) = 'array' AND jsonb_array_length(w.plan) > 0
            ORDER BY w.number FOR UPDATE LOOP
    v_before := public.ops_card_snapshot(r.id);
    FOR s IN SELECT e.value AS step, row_number() OVER (ORDER BY CASE WHEN (e.value->>'n') ~ '^\d{1,3}$' THEN (e.value->>'n')::integer END NULLS LAST, e.ord) AS rn
               FROM jsonb_array_elements(r.plan) WITH ORDINALITY e(value, ord) WHERE jsonb_typeof(e.value) = 'object' LOOP
      v_title := btrim(left(COALESCE(public.ops_one_line(s.step->>'text'), ''), 160));
      IF char_length(v_title) < 3 OR public.crm_name_key(v_title) = '' THEN v_title := format('Step %s', s.rn); END IF;
      v_done := r.status = 'done' OR s.step->>'status' = 'done';
      INSERT INTO public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, plan_step,
        parent_id, position, close_kind, close_reason, closed_at, closed_by, closed_via,
        archived_at, archived_by, archive_reason, created_by, created_via, updated_by, updated_via)
      VALUES (v_title,
        left(format('Step %s of Card %s: %s', s.rn, r.number, COALESCE(public.ops_one_line(s.step->>'text'), v_title)), 4000),
        'This step is done and read back.',
        CASE WHEN v_done THEN 'done' ELSE 'todo' END, 'task', r.due_on, 'explicit', r.sprint_id, '[]'::jsonb,
        jsonb_build_object('tool', COALESCE(NULLIF(btrim(s.step->>'tool'), ''), 'person'),
                           'status', COALESCE(s.step->>'status', 'todo'),
                           'result', s.step->'result', 'checked_at', s.step->'checked_at'),
        r.id, (s.rn - 1)::integer,
        CASE WHEN s.step->>'status' = 'done' THEN 'done' WHEN v_done THEN 'system' END,
        CASE WHEN s.step->>'status' = 'done' THEN 'Marked done in the plan before plans became subtasks (#4255).'
             WHEN v_done THEN format('Closed with Card %s before plans became subtasks (#4255).', r.number) END,
        CASE WHEN v_done THEN COALESCE(public.ops_try_timestamptz(s.step->>'checked_at'), r.closed_at, r.updated_at) END,
        CASE WHEN v_done THEN c_actor END, CASE WHEN v_done THEN 'system' END,
        r.archived_at, r.archived_by, r.archive_reason, c_actor, 'system', c_actor, 'system')
      RETURNING id INTO v_id;
      v_owner := public.ops_4255_step_owners(s.step->>'text', s.step->>'tool', r.id);
      IF cardinality(v_owner) > 0 THEN
        INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via)
        SELECT v_id, x, 'owner', c_actor, NULL FROM unnest(v_owner) x ON CONFLICT DO NOTHING;
        v_owned := v_owned + 1;
      END IF;
      v_steps := v_steps + 1;
    END LOOP;
    -- The plan's one owner is now its subtasks. The revision goes up so an
    -- open screen reloads, and undo cannot bring the old plan back.
    UPDATE public.ops_work_cards SET plan = '[]'::jsonb, revision = revision + 1, updated_at = now()
     WHERE id = r.id RETURNING * INTO n;
    PERFORM public.ops_card_event(r.id, c_actor, 'system', 'plan', 'The plan''s steps are subtasks now (#4255).',
      v_before, public.ops_card_snapshot(r.id), r.revision, n.revision);
    v_cards := v_cards + 1;
  END LOOP;
  RETURN jsonb_build_object('cards', v_cards, 'subtasks', v_steps, 'with_owner', v_owned);
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_plan_to_subtasks() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ops_4255_plan_to_subtasks() IS
  'Issue #4255. One-time move of every card''s plan steps into subtasks; called once by its migration (tested directly by issue_4255_work_v2.implementor.pg17.test.sql). Internal: no client can call it.';
SELECT public.ops_4255_plan_to_subtasks();

-- (b) Notes become thread messages, with the teammates each one tagged. The
--     note event stays (it is what each notice points at) and the message
--     keeps it, so nothing is copied twice.
CREATE FUNCTION public.ops_4255_notes_to_messages() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.ops_work_messages (card_id, author_email, via, chat, body_md, mentions, event_id, created_at)
  SELECT e.card_id, e.actor_email, e.via, e.chat, left(e.body, 10000),
         COALESCE((SELECT array_agg(DISTINCT lower(btrim(u.email)) ORDER BY lower(btrim(u.email)))
                     FROM public.team_mentions m JOIN auth.users u ON u.id = m.target_user_id
                    WHERE m.source_kind = 'work_card' AND m.source_id = e.id AND u.email IS NOT NULL), ARRAY[]::text[]),
         e.id, e.at
    FROM public.ops_work_events e
   WHERE e.action = 'note' AND e.body IS NOT NULL AND btrim(e.body) <> ''
     AND NOT EXISTS (SELECT 1 FROM public.ops_work_messages x WHERE x.event_id = e.id)
   ORDER BY e.at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4255_notes_to_messages() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ops_4255_notes_to_messages() IS
  'Issue #4255. One-time copy of every note into its card''s thread; called once by its migration and safe to repeat (a note already copied is skipped). Internal.';
SELECT public.ops_4255_notes_to_messages();

-- (c) Each card's Files link becomes a link file.
INSERT INTO public.ops_work_files (card_id, kind, name, url, from_files_url, added_by, added_via, added_at, archived_at, archived_by)
SELECT w.id, 'link', left(COALESCE(NULLIF(substring(w.files_url FROM '^https://([^/?#]+)'), ''), 'Files'), 200), w.files_url, true,
       w.updated_by, NULL, w.updated_at, w.archived_at, w.archived_by
  FROM public.ops_work_cards w
 WHERE w.files_url IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.ops_work_files f WHERE f.card_id = w.id AND f.from_files_url);

-- (d) Each sprint's goal text becomes its goal 1.
INSERT INTO public.ops_sprint_goals (sprint_id, title, state, state_source, position, created_by, updated_by, created_at, updated_at)
SELECT s.id, btrim(left(s.goal, 80)), 'on_track', 'auto', 0, COALESCE(s.updated_by, 'system@usemingla.com'), 'system@usemingla.com', s.created_at, s.updated_at
  FROM public.ops_sprints s
 WHERE s.goal IS NOT NULL AND char_length(btrim(left(s.goal, 80))) >= 3
   AND NOT EXISTS (SELECT 1 FROM public.ops_sprint_goals g WHERE g.sprint_id = s.id);

COMMIT;
