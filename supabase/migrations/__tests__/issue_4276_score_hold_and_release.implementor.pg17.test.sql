-- Issue #4276: implementor proof for 20280416004276_issue_4276_score_hold_and_release_only_path.sql.
--
-- MINGLA-INVARIANT: I-4276-SCORE-STAGE-NEVER-RELEASES-HELD-AI | issue #4276 | The final-score stage never selects a place whose AI result predates the backlog hold, and the scorer leaves such a place's score untouched
-- MINGLA-INVARIANT: I-4276-RELEASE-ONLY-PATH-TO-LIVE | issue #4276 | serving_hold is cleared only inside city_pipeline_release_places
--
--   H-DATE    ai_score_hold_since() is the same instant as the rescore selector's literal
--   H-SELECT  a held place with a post-hold slice is selected; a pre-hold slice or a
--             slice with no evaluated_at is not
--   R-REFUSE  clearing serving_hold directly is refused with PT409, with or without
--             is_servable = true
--   R-RELEASE city_pipeline_release_places still releases and rejects
--   R-OTHER   the final check's verdict on a held place and ordinary updates still work
--
-- H-UNPARSEABLE an evaluated_at that cannot be read as a date is held, without raising
--             (20280417004276)
--
-- FAILS-ON-REVERT: restore the old selector and H-SELECT fails; restore the old trigger
-- and R-REFUSE fails; restore the old ai_slices_predate_hold and H-UNPARSEABLE fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_city uuid := 'a4276500-0000-4000-a000-000000000001';
  v_admin uuid := 'a4276500-0000-4000-e000-000000000001';
  v_run uuid := 'a4276500-0000-4000-c000-000000000001';
  v_new uuid := 'a4276500-0000-4000-b000-000000000001';
  v_old uuid := 'a4276500-0000-4000-b000-000000000002';
  v_nodate uuid := 'a4276500-0000-4000-b000-000000000003';
  v_rej uuid := 'a4276500-0000-4000-b000-000000000004';
  v_ids uuid[];
  v_out jsonb;
  v_selector text;
begin
  -- H-DATE
  v_selector := pg_get_functiondef('public.pg_meta_orch_1009_sub_d_select_stale_pairs(int)'::regprocedure);
  if position(to_char(public.ai_score_hold_since() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '+00' in v_selector) = 0 then
    raise exception 'H-DATE: ai_score_hold_since() (%) is not the rescore selector''s hold date', public.ai_score_hold_since();
  end if;

  insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
  values (v_city, 'gp-a42765', 'Hold City', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'seeded');
  insert into public.admin_users (id, email, role, status) values (v_admin, 'hold-a42765@local.test', 'admin', 'active');

  -- Held places: their passing verdict is parked by the trigger.
  insert into public.place_pool (id, google_place_id, name, lat, lng, city_id, is_active, serving_hold, is_servable, types, primary_type, ai_signal_scores)
  values
    (v_new, 'gp-a42765-new', 'New', 1, 1, v_city, true, true, true, array['bar'], 'bar',
      '{"drinks": {"score_0_to_100": 80, "evaluated_at": "2026-11-20T00:00:00Z"}}'),
    (v_old, 'gp-a42765-old', 'Old', 1, 1, v_city, true, true, true, array['bar'], 'bar',
      '{"drinks": {"score_0_to_100": 80, "evaluated_at": "2026-11-20T00:00:00Z"}, "romantic": {"score_0_to_100": 10, "evaluated_at": "2026-09-01T00:00:00Z"}}'),
    (v_nodate, 'gp-a42765-nodate', 'No date', 1, 1, v_city, true, true, true, array['bar'], 'bar',
      '{"drinks": {"score_0_to_100": 80}}'),
    (v_rej, 'gp-a42765-rej', 'Rejected', 1, 1, v_city, true, true, false, array['bar'], 'bar', null);

  insert into public.city_pipeline_runs (id, city_id, spend_limit_usd, started_by, status) values (v_run, v_city, 10, v_admin, 'running');

  -- H-SELECT
  v_ids := public.city_pipeline_places_to_score(v_run, null, 1000);
  if not (v_new = any (v_ids)) then raise exception 'H-SELECT: a post-hold slice was left out: %', v_ids; end if;
  if v_old = any (v_ids) then raise exception 'H-SELECT: a place with a pre-hold slice was selected'; end if;
  if v_nodate = any (v_ids) then raise exception 'H-SELECT: a slice with no evaluated_at was selected'; end if;

  -- H-UNPARSEABLE (20280417004276): a date that cannot be read is held, without raising,
  -- the same cases aiSliceIsHeld pins in issue_4276_score_hold.implementor.test.ts.
  if public.ai_slices_predate_hold('{"drinks": {"evaluated_at": "not a date"}}') is distinct from true
    or public.ai_slices_predate_hold('{"drinks": {"evaluated_at": "2026-13-45T00:00:00Z"}}') is distinct from true
    or public.ai_slices_predate_hold('{"drinks": {"evaluated_at": ""}}') is distinct from true
    or public.ai_slices_predate_hold('{"drinks": {"evaluated_at": "now"}}') is distinct from true
    or public.ai_slices_predate_hold('{"drinks": {"evaluated_at": "infinity"}}') is distinct from true then
    raise exception 'H-UNPARSEABLE: an unreadable evaluated_at was not held';
  end if;
  if public.ai_slices_predate_hold('{"drinks": {"evaluated_at": "2026-11-20T00:00:00Z"}, "x": {"evaluated_at": "not a date"}}') is distinct from true then
    raise exception 'H-UNPARSEABLE: one unreadable slice did not hold the place';
  end if;
  if public.ai_slices_predate_hold('{"drinks": {"evaluated_at": "2026-11-20T00:00:00Z"}}') is distinct from false then
    raise exception 'H-UNPARSEABLE: a readable post-hold date was held';
  end if;

  -- R-REFUSE
  begin
    update public.place_pool set serving_hold = false, is_servable = true where id = v_new;
    raise exception 'R-REFUSE: a held place went live without the release';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    update public.place_pool set serving_hold = false where id = v_new;
    raise exception 'R-REFUSE: serving_hold was cleared without the release';
  exception when sqlstate 'PT409' then null;
  end;

  -- R-OTHER: the final check can still record a verdict on a held place, and other
  -- columns still update.
  update public.place_pool set is_servable = false where id = v_old;
  if (select held_final_check_passed from public.place_pool where id = v_old) is distinct from false then
    raise exception 'R-OTHER: the final check verdict was not parked';
  end if;
  update public.place_pool set name = 'Renamed' where id = v_new;

  -- R-RELEASE
  v_out := public.city_pipeline_release_places(v_city, false);
  if (v_out ->> 'released')::int <> 2 or (v_out ->> 'rejected')::int <> 2 then
    raise exception 'R-RELEASE: unexpected result %', v_out;
  end if;
  if (select is_servable from public.place_pool where id = v_new) is not true then
    raise exception 'R-RELEASE: the passed place is not live';
  end if;
  if coalesce(current_setting('mingla.city_pipeline_release', true), '') = 'on' then
    raise exception 'R-RELEASE: the release flag was left on';
  end if;
end $$;

select 'issue_4276_score_hold_and_release: all checks passed' as result;
rollback;
