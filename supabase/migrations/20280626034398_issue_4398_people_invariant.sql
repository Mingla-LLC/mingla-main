-- Issue #4398 (Work board v3), migration 3 of 4: the open-card invariant
-- (spec v1 Part B1). Every writer fills one owner and one watcher since
-- 20280626004398 and 20280626014398; this trigger backstops all of them at
-- commit.
--
-- INVARIANT ops-card-one-owner-one-watcher: every open Work card (status <>
-- 'done' and not archived) has exactly 1 owner and 1 watcher, different
-- people (the (card_id, email) primary key of ops_work_people keeps them
-- different). Gate: ops_4398_card_people_check (a DEFERRABLE INITIALLY
-- DEFERRED constraint trigger on ops_work_people and ops_work_cards, so a
-- function that swaps people inside one transaction still works). Refusal:
-- SQLSTATE 23514 "card_people: ...". Closed and archived cards are not
-- checked. Test: supabase/migrations/__tests__/issue_4398_work_board_v3.implementor.pg17.test.sql
--
-- The migration first proves no open card breaks the rule and stops loudly
-- if one does (production on 11 Nov 2026: 297 open cards, 0 breaking it).
--
-- ROLLBACK (no down file): DROP TRIGGER ops_4398_card_people_cards ON
-- public.ops_work_cards; DROP TRIGGER ops_4398_card_people_people ON
-- public.ops_work_people; DROP FUNCTION public.ops_4398_card_people_check().

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $precheck$
DECLARE v_bad integer; v_list text;
BEGIN
  SELECT count(*), string_agg('#' || x.number, ', ' ORDER BY x.number) INTO v_bad, v_list
    FROM (SELECT w.number FROM public.ops_work_cards w
           WHERE w.status <> 'done' AND w.archived_at IS NULL
             AND ((SELECT count(*) FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'owner') <> 1
               OR (SELECT count(*) FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'watcher') <> 1)
           ORDER BY w.number LIMIT 50) x;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'issue_4398_precheck: % open cards do not have exactly one owner and one watcher (%). Fix them first; nothing was changed.', v_bad, v_list
      USING ERRCODE = '23514';
  END IF;
END
$precheck$;

CREATE FUNCTION public.ops_4398_card_people_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_card uuid; v_open boolean; v_owners integer; v_watchers integer;
BEGIN
  IF TG_TABLE_NAME = 'ops_work_cards' THEN
    v_card := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_card := OLD.card_id;
  ELSE
    v_card := NEW.card_id;
  END IF;
  SELECT w.status <> 'done' AND w.archived_at IS NULL INTO v_open FROM public.ops_work_cards w WHERE w.id = v_card;
  IF NOT COALESCE(v_open, false) THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE p.role = 'owner'), count(*) FILTER (WHERE p.role = 'watcher') INTO v_owners, v_watchers
    FROM public.ops_work_people p WHERE p.card_id = v_card;
  IF v_owners <> 1 OR v_watchers <> 1 THEN
    RAISE EXCEPTION 'card_people: A card needs exactly one owner and one watcher, and they must be different people.'
      USING ERRCODE = '23514', DETAIL = format('card %s has %s owners and %s watchers', v_card, v_owners, v_watchers);
  END IF;
  -- An UPDATE that moves people from one card to another checks the old one too.
  IF TG_TABLE_NAME = 'ops_work_people' AND TG_OP = 'UPDATE' THEN
   IF OLD.card_id IS DISTINCT FROM NEW.card_id THEN
    SELECT w.status <> 'done' AND w.archived_at IS NULL INTO v_open FROM public.ops_work_cards w WHERE w.id = OLD.card_id;
    IF COALESCE(v_open, false) AND ((SELECT count(*) FROM public.ops_work_people p WHERE p.card_id = OLD.card_id AND p.role = 'owner') <> 1
                                    OR (SELECT count(*) FROM public.ops_work_people p WHERE p.card_id = OLD.card_id AND p.role = 'watcher') <> 1) THEN
      RAISE EXCEPTION 'card_people: A card needs exactly one owner and one watcher, and they must be different people.' USING ERRCODE = '23514';
    END IF;
   END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_4398_card_people_check() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER ops_4398_card_people_people
  AFTER INSERT OR UPDATE OR DELETE ON public.ops_work_people
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ops_4398_card_people_check();
CREATE CONSTRAINT TRIGGER ops_4398_card_people_cards
  AFTER INSERT OR UPDATE OF status, status_id, archived_at, parent_id ON public.ops_work_cards
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ops_4398_card_people_check();
ALTER TABLE public.ops_work_people ENABLE ALWAYS TRIGGER ops_4398_card_people_people;
ALTER TABLE public.ops_work_cards ENABLE ALWAYS TRIGGER ops_4398_card_people_cards;

COMMIT;
