-- Issue #4255 (Work board v2 + Mingla team) rework 2 after Retest 1 (FAIL at
-- 714b61e4e4). Builds on 20280614054255_issue_4255_team_rework.sql; the
-- latest body of ops_notify_people is copied from there, and each edit is
-- marked "#4255 rework 2" with its defect.
--
--   P1. A teammate's own time zone: team_set_my_timezone(p_timezone) saves the
--       device's IANA zone (checked against pg_timezone_names) on the
--       signed-in staff member's profile, only when it is empty or different.
--       Admin and the Host app call it on load, sign-in and foreground, so
--       quiet hours (22:00 to 07:00) and the 09:00 due notice read the
--       person's own clock instead of the New York fallback.
--   P2. business.team_decision goes to the card's owners only; a watcher of
--       the same tag change gets the plain business.team_mention update.
--   P3. A decision is the tag-change event itself (the after snapshot has a
--       tag and it is a different ask from the before snapshot: no tag to a
--       tag, or Send to Spend; the same ask again or taking it off is not),
--       read from ops_work_events, never from the words: a note ending in
--       "· You send" is a mention.
--       Retest 2: ops_work_update now tells the card's people on a change
--       to a different ask too (before: only no tag to a tag), so the owner
--       is asked again.
--   P3b (Retest 2). The same per-person verdict is stored on the notice
--       (team_mentions.decision) and team_inbox returns it, so Admin
--       Messages and the Host app Mentions label "Needs your decision" from
--       that flag instead of parsing the excerpt.
--   P4 (Retest 2). team_set_my_timezone refuses a connected agent (crm_ctx()
--       via, like the other team chat writes): 42501 agents_cannot_post.
--
-- Static SQL only (#1860 C7). Nothing here takes an expected revision, so no
-- conflict is raised (the PT409 rule elsewhere is untouched). Every SECURITY
-- DEFINER function sets search_path.

BEGIN;

-- ---------------------------------------------------------------------------
-- P3b. The decision verdict, stored once per notice.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_mentions ADD COLUMN decision boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.team_mentions.decision IS
  'Issue #4255. True when this notice asks its person to decide: a work card event that put a different ask (Send, Spend, Publish, Needs your OK) on the card, sent to one of its owners. Set by ops_notify_people; Admin Messages and the Host app label from it.';

-- ---------------------------------------------------------------------------
-- P2 + P3. ops_notify_people (from 20280614054255).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_notify_people(p_card_id uuid, p_event_id uuid, p_emails text[], p_actor_email text, p_excerpt text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email text; v_uid uuid; v_actor uuid; v_mention uuid; v_told integer := 0;
  -- #4255 rework B: the card opens with its thread beside it.
  v_link text := 'https://admin.usemingla.com/#/work-board?card=' || p_card_id::text || '&side=thread:' || p_card_id::text;
  v_excerpt text := COALESCE(left(public.ops_one_line(p_excerpt), 280), 'A work card changed.');
  v_card public.ops_work_cards;
  v_action text;
  v_card_title text;
  v_who text;
  v_cut integer;
  v_title text;
  v_email_ok boolean;
  -- #4255 rework 2 (P3): a decision is the event that put a Send, Spend,
  -- Publish or Needs your OK tag on the card that is a different ask from
  -- before (no tag to a tag, or one ask to another), never words that happen
  -- to end like a tag. The same ask again, or taking it off, is not.
  v_before jsonb;
  v_after jsonb;
  v_tag_set boolean;
  v_decision boolean;
  v_push_ok boolean;
  v_inapp_ok boolean;
BEGIN
  SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = p_card_id;
  SELECT e.action, e.before, e.after INTO v_action, v_before, v_after FROM public.ops_work_events e WHERE e.id = p_event_id;
  v_tag_set := v_action IS DISTINCT FROM 'note'
    AND v_before IS NOT NULL AND v_after IS NOT NULL
    AND NULLIF(v_after->'fields'->>'person_reason', '') IS NOT NULL
    AND NULLIF(v_before->'fields'->>'person_reason', '') IS DISTINCT FROM NULLIF(v_after->'fields'->>'person_reason', '');
  v_card_title := NULLIF(public.ops_one_line(v_card.title), '');

  -- Subject. A note tells only the people it tags: "<who> tagged you: <card>".
  -- Every other producer's excerpt already reads "<who> <did what>: <card>…".
  IF v_action = 'note' AND v_card_title IS NOT NULL THEN
    v_cut := position(' on ' || v_card_title || ': ' IN v_excerpt);
    v_who := CASE WHEN v_cut > 1 THEN left(v_excerpt, v_cut - 1) ELSE public.ops_name(p_actor_email) END;
    v_title := v_who || ' tagged you: ' || v_card_title;
  ELSIF v_card_title IS NOT NULL AND position(v_card_title IN v_excerpt) > 0 THEN
    v_title := v_excerpt;
  ELSIF v_card_title IS NOT NULL THEN
    v_title := public.ops_name(p_actor_email) || ' on a work card: ' || v_card_title;
  ELSE
    v_title := public.ops_name(p_actor_email) || ' on a work card';
  END IF;
  IF char_length(v_title) > 150 THEN v_title := left(v_title, 149) || '…'; END IF;

  -- Email only for cards a person should act on. A "Feature Guide is Live"
  -- card, or any automatic card already closed in the run that made it, is a
  -- bell item only.
  v_email_ok := NOT (
    v_card.auto_key IS NOT NULL AND (
      split_part(v_card.auto_key, ':', 1) = 'guide_live'
      OR (v_card.status = 'done' AND v_card.created_at = now())
    )
  );

  SELECT u.id INTO v_actor FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(p_actor_email)) ORDER BY u.created_at LIMIT 1;
  FOR v_email IN SELECT DISTINCT lower(btrim(x)) FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) x WHERE btrim(COALESCE(x, '')) <> '' LOOP
    CONTINUE WHEN v_email = lower(btrim(p_actor_email));
    v_uid := NULL;
    SELECT u.id INTO v_uid FROM auth.users u
     WHERE lower(btrim(u.email)) = v_email AND public.issue_3720_active_team_member(u.id)
     ORDER BY u.created_at LIMIT 1;
    CONTINUE WHEN v_uid IS NULL;
    -- #4255 rework 2 (P2): only the card's owners are asked to decide; a
    -- watcher of the same tag change gets the plain update. Retest 2 (P3b):
    -- the verdict is stored on the notice for Admin and the Host app.
    v_decision := v_tag_set AND EXISTS (
      SELECT 1 FROM public.ops_work_people w
       WHERE w.card_id = p_card_id AND w.role = 'owner' AND lower(btrim(w.email)) = v_email);
    v_mention := NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, decision)
    VALUES ('work_card', p_event_id, v_actor, v_uid, v_excerpt, v_link, v_decision)
    ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING
    RETURNING id INTO v_mention;
    CONTINUE WHEN v_mention IS NULL;
    IF v_email_ok THEN
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES ('admin.team_mention', v_uid, NULL,
        jsonb_build_object('title', v_title, 'body', left(v_excerpt, 180), 'mention_id', v_mention,
          'source_kind', 'work_card', 'source_id', p_event_id, 'deep_link', v_link,
          'card_id', p_card_id, 'card_title', v_card_title),
        'admin.team_mention:' || v_mention::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
      -- #4255 W1b: one push to the teammate's Host app (Mentions there opens
      -- Admin at the card). Ids only; the template writes the words. Same
      -- quiet rule as the email; only a confirmed staff account.
      IF public.team_chat_staff(v_uid) THEN
        IF v_decision THEN
          -- #4255 rework A: a decision is business.team_decision, under its
          -- own switches. Push and in-app both off: nothing is queued; in-app
          -- off alone: it pushes without a bell row (payload.inapp false).
          v_push_ok := public.can_send(v_uid, 'business.team_decision', 'push', NULL);
          v_inapp_ok := public.can_send(v_uid, 'business.team_decision', 'inapp', NULL);
          IF v_push_ok OR v_inapp_ok THEN
            INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
            VALUES ('business.team_decision', v_uid, NULL,
              jsonb_build_object('source_kind', 'work_card', 'reason', 'decision',
                'mention_id', v_mention, 'source_id', p_event_id, 'card_id', p_card_id, 'actor_user_id', v_actor,
                'inapp', v_inapp_ok,
                'deep_link', 'mingla-business://team/mention/' || v_mention::text),
              'business.team_decision:' || v_mention::text, 'pending')
            ON CONFLICT (idempotency_key) DO NOTHING;
          END IF;
        ELSE
          INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
          VALUES ('business.team_mention', v_uid, NULL,
            jsonb_build_object('source_kind', 'work_card', 'reason', CASE WHEN v_action = 'note' THEN 'mention' ELSE 'work_update' END,
              'mention_id', v_mention, 'source_id', p_event_id, 'card_id', p_card_id,
              'deep_link', 'mingla-business://team/mention/' || v_mention::text),
            'business.team_mention:' || v_mention::text, 'pending')
          ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      END IF;
    END IF;
    v_told := v_told + 1;
  END LOOP;
  RETURN v_told;
END;
$$;
COMMENT ON FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text) IS
  'Issue #3980/#4255. The one work-card notice producer: team_mentions (linking to the card with its thread open) plus admin.team_mention (no country, no text message) plus one Host app push for a confirmed staff account: business.team_decision for an owner when the event put a You send, You spend, You publish or Needs your OK tag on the card that is a different ask from before (stored as team_mentions.decision; under the Decisions for me switches), else business.team_mention. guide_live cards and automatic cards closed in their own run get no email and no push.';

-- ---------------------------------------------------------------------------
-- P3 (Retest 2). ops_work_update (from 20280614014255): a card whose tag
-- changes to a different ask tells its people again, so the owners get the
-- decision push. One edit, marked "#4255 Retest 2 (P3)".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_work_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text;
  v_before jsonb; v_item jsonb; v_chk jsonb; cl jsonb; v_fixes jsonb; v_people jsonb; v_links_changed boolean := false;
  v_cats text[] := ARRAY[]::text[]; v_action text; v_event uuid; v_out jsonb; v_gate jsonb; v_week date; v_who text;
  v_status text; v_reason text; v_result text; v_breason text; v_owners text[]; v_watchers text[]; v_anchor_changed boolean := false;
  v_back boolean := false; v_back_reason text; -- Wave 2: leaving Needs a person; #4270: taking the tag off
  v_alias boolean := false; -- #4270: the old status person, read as To do with a tag
  v_removed_words text; -- #3980 rework 2: who was taken off, for the agent log
  v_gh_changed boolean := false; v_chat text;
  v_gh_list text; v_gh_wait boolean := false; -- #3980 synced, Wave 2: waiting for GitHub
  v_gh_cur text; -- #3980 W2 rework: the links a waiting card has now
  v_goal uuid; v_goal_sprint uuid; v_new_parent uuid; -- #4255
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github','files_url','on_brand_plan',
                   'description','start_on','estimate_minutes','goal','in_backlog','parent') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A card change does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'update',
    jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  v_who := public.ops_actor_label(v.actor_email, v.via);
  v_anchor_changed := p_changes ? 'anchor' AND (p_changes->'anchor' IS DISTINCT FROM
    CASE WHEN c.anchor_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) END);

  v_item := jsonb_build_object('id', c.id,
    'title', COALESCE(p_changes->'title', to_jsonb(c.title)),
    -- #4255: a new description is the instructions too (its first 4,000 characters)
    'instructions', CASE WHEN p_changes ? 'instructions' THEN p_changes->'instructions'
                         WHEN p_changes ? 'description' AND jsonb_typeof(p_changes->'description') = 'string'
                              AND char_length(COALESCE(public.ops_multi_line(left(p_changes->>'description', 4000)), '')) >= 10 THEN 'null'::jsonb
                         ELSE to_jsonb(c.instructions) END,
    'done_means', COALESCE(p_changes->'done_means', to_jsonb(c.done_means)),
    'owners', CASE WHEN p_changes ? 'owners' THEN p_changes->'owners' ELSE to_jsonb(public.ops_card_people(c.id, 'owner')) END,
    'watchers', CASE WHEN p_changes ? 'watchers' THEN p_changes->'watchers' ELSE to_jsonb(public.ops_card_people(c.id, 'watcher')) END,
    'links', CASE WHEN p_changes ? 'links' THEN p_changes->'links'
                  ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id)) FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb) END,
    'anchor', CASE WHEN p_changes ? 'anchor' THEN p_changes->'anchor'
                   WHEN c.anchor_id IS NOT NULL THEN jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) ELSE 'null'::jsonb END,
    'kit_step', to_jsonb(c.kit_step), 'kind', to_jsonb(c.kind),
    'person_reason', CASE WHEN p_changes ? 'person_reason' THEN p_changes->'person_reason' ELSE to_jsonb(c.person_reason) END,
    'files_url', CASE WHEN p_changes ? 'files_url' THEN p_changes->'files_url' ELSE to_jsonb(c.files_url) END,
    -- #4255
    'parent', CASE WHEN p_changes ? 'parent' THEN p_changes->'parent' ELSE to_jsonb(c.parent_id) END,
    'description', CASE WHEN p_changes ? 'description' THEN p_changes->'description' ELSE to_jsonb(c.description_md) END,
    'start_on', CASE WHEN p_changes ? 'start_on' THEN p_changes->'start_on' ELSE to_jsonb(c.start_on) END,
    'estimate_minutes', CASE WHEN p_changes ? 'estimate_minutes' THEN p_changes->'estimate_minutes' ELSE to_jsonb(c.estimate_minutes) END,
    'goal', CASE WHEN p_changes ? 'goal' THEN p_changes->'goal' ELSE to_jsonb(c.goal_id) END,
    'in_backlog', CASE WHEN p_changes ? 'in_backlog' THEN p_changes->'in_backlog' ELSE to_jsonb(c.in_backlog) END,
    'on_brand_plan', CASE WHEN p_changes ? 'on_brand_plan' THEN p_changes->'on_brand_plan' ELSE to_jsonb(c.on_brand_plan) END,
    'plan', CASE WHEN p_changes ? 'plan' THEN p_changes->'plan' ELSE c.plan END,
    'github', CASE WHEN p_changes ? 'github' THEN p_changes->'github'
                   ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'number', g.number) ORDER BY g.number)
                                    FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb) END,
    'due_on', CASE WHEN p_changes ? 'due_on' THEN p_changes->'due_on'
                   WHEN v_anchor_changed AND c.due_source <> 'explicit' THEN 'null'::jsonb ELSE to_jsonb(c.due_on) END,
    '_due_source', CASE WHEN p_changes ? 'due_on' THEN 'explicit' ELSE c.due_source END);
  IF p_changes ? 'links' AND NOT (p_changes ? 'anchor') AND c.anchor_id IS NOT NULL
     AND jsonb_typeof(p_changes->'links') = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'links') l WHERE l->>'kind' = c.anchor_kind AND lower(l->>'id') = c.anchor_id::text)
     AND c.kind = 'task' AND c.kit_step IS NULL THEN
    -- removing the anchor's link frees the card from its event
    v_item := jsonb_set(v_item, '{anchor}', 'null'::jsonb);
    IF c.due_source <> 'explicit' THEN v_item := jsonb_set(v_item, '{due_on}', to_jsonb(c.due_on)); v_item := jsonb_set(v_item, '{_due_source}', '"explicit"'); END IF;
    v_anchor_changed := true;
  END IF;
  v_chk := public.ops_validate_card(v_item, 'update', v.actor_email, v_today);
  v_fixes := v_chk->'fixes';
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' AND p_changes ? 'title' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message',
      format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
  END IF;
  cl := v_chk->'clean';

  -- status, the Send/Spend/Publish tag, blocked, result, week
  -- #4270: status is todo or doing. The old status person is still accepted
  -- from agents and old prompts: it means To do with a tag (person_reason),
  -- which is then required. A status change never clears the tag.
  v_status := c.status; v_reason := c.person_reason;
  IF p_changes ? 'status' THEN
    IF jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('todo','doing','person') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be todo or doing. Close a card with proof, or push it back.'));
    ELSIF p_changes->>'status' = 'person' THEN v_status := 'todo'; v_alias := true;
    ELSE v_status := p_changes->>'status'; END IF;
  END IF;
  IF p_changes ? 'person_reason' THEN v_reason := cl->>'person_reason'; END IF;
  IF v_alias AND v_reason IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'A Send, Spend or Publish tag must say which: send, spend, publish or other.'));
  END IF;
  -- Wave 2 / #4270: taking the tag off a card (what leaving Needs a person
  -- was) needs a reason from an agent; the log records it and owners and
  -- watchers are told.
  -- #4270 rework (P3-2): a tag that is not one of the four words (an empty
  -- string, say) is refused as a bad tag below, not as a missing reason.
  v_back := c.person_reason IS NOT NULL AND v_reason IS NULL
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'person_reason');
  IF v_back THEN
    v_back_reason := CASE WHEN jsonb_typeof(p_changes->'reason') = 'string' THEN left(public.ops_one_line(p_changes->>'reason'), 500) END;
    IF public.ops_has_control(v_back_reason) THEN v_back_reason := NULL; END IF;
    IF v.via IS NOT NULL AND v_back_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required: Say why this card no longer needs its Send, Spend or Publish tag. Your person and the card''s watchers are told.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- #3980 W2 rework 3: an agent never moves a roadmap approval card or
  -- changes what it waits for, so it cannot send it back and then close it.
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (v_status IS DISTINCT FROM c.status OR v_reason IS DISTINCT FROM c.person_reason) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
  END IF;
  n := c;
  -- #4270 W2 (D15): "Host can see this". A person decides what hosts see: an
  -- agent cannot switch it on.
  IF p_changes ? 'on_brand_plan' AND jsonb_typeof(p_changes->'on_brand_plan') = 'boolean' THEN
    IF v.via IS NOT NULL AND (p_changes->>'on_brand_plan')::boolean AND NOT c.on_brand_plan THEN
      RAISE EXCEPTION 'people_only: A person decides what hosts see.' USING ERRCODE = '42501';
    END IF;
    n.on_brand_plan := (p_changes->>'on_brand_plan')::boolean;
  END IF;
  -- Wave 2: the GitHub issues and pull requests the card waits for.
  SELECT string_agg('#' || (x->>'number'), ', ' ORDER BY (x->>'number')::integer) INTO v_gh_list
    FROM jsonb_array_elements(COALESCE(cl->'github', '[]'::jsonb)) x;
  SELECT string_agg('#' || g.number, ', ' ORDER BY g.number) INTO v_gh_cur FROM public.ops_work_github g WHERE g.card_id = c.id;
  -- #3980 W2 rework: an agent cannot change what a waiting card waits for
  -- (adding, removing or swapping a link would let it lift the wait); a
  -- person can, and the agent log says who did.
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL AND p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_cur, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL
     AND ((p_changes ? 'blocked_on_github' AND jsonb_typeof(p_changes->'blocked_on_github') = 'boolean' AND NOT (p_changes->>'blocked_on_github')::boolean)
          OR (NOT (p_changes ? 'blocked_on_github') AND p_changes ? 'blocked')) THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_list, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'blocked_on_github' THEN
    v_gh_wait := true;
    IF jsonb_typeof(p_changes->'blocked_on_github') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_on_github', 'message', 'Blocked until Live must be true or false.'));
    ELSIF (p_changes->>'blocked_on_github')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      IF v_gh_list IS NULL THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'Link a GitHub issue or pull request first; the card then waits for it to be Live.'));
      ELSE n.blocked := true; n.blocked_kind := 'github'; n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
    ELSIF c.blocked_kind = 'github' THEN
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked' THEN
    IF jsonb_typeof(p_changes->'blocked') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked', 'message', 'Blocked must be true or false.'));
    ELSIF (p_changes->>'blocked')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      v_breason := public.ops_one_line(p_changes->>'blocked_reason');
      IF v_breason IS NULL OR char_length(v_breason) NOT BETWEEN 5 AND 300 THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.'));
      ELSE n.blocked := true; n.blocked_kind := 'manual'; n.blocked_reason := v_breason; END IF;
    ELSE
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked_reason' THEN
    v_breason := public.ops_one_line(p_changes->>'blocked_reason');
    IF c.blocked_kind = 'manual' AND v_breason IS NOT NULL AND char_length(v_breason) BETWEEN 5 AND 300 THEN n.blocked_reason := v_breason;
    ELSE v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.')); END IF;
  END IF;
  -- Wave 2: a card waiting for GitHub keeps its reason in step with its links.
  IF NOT v_gh_wait AND n.blocked_kind = 'github' AND p_changes ? 'github' THEN
    IF v_gh_list IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card waiting for GitHub keeps at least one GitHub link. Lift the wait first.'));
    ELSE n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
  END IF;
  IF p_changes ? 'result' THEN
    v_result := CASE WHEN jsonb_typeof(p_changes->'result') = 'string' THEN public.ops_multi_line(p_changes->>'result') END;
    IF char_length(COALESCE(v_result, '')) > 2000 OR public.ops_has_control(v_result) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'result', 'message', 'Keep the result to 2,000 characters.'));
    ELSE n.result := v_result; END IF;
  END IF;
  IF p_changes ? 'week' AND jsonb_typeof(p_changes->'week') <> 'null' THEN
    BEGIN
      v_week := public.ops_monday((p_changes->>'week')::date);
      IF v_week NOT BETWEEN v_today - 730 AND v_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'week', 'message', 'Sprint must be a real week within two years.'));
      v_week := NULL;
    END;
  END IF;
  -- #4255: a goal belongs to one sprint, and the card must be in it. A card
  -- that moves week leaves its old sprint's goal behind.
  v_goal := (cl->>'goal_id')::uuid;
  IF v_goal IS NOT NULL THEN
    SELECT g.sprint_id INTO v_goal_sprint FROM public.ops_sprint_goals g WHERE g.id = v_goal;
    IF v_goal_sprint IS DISTINCT FROM (CASE WHEN v_week IS NOT NULL THEN (SELECT s.id FROM public.ops_sprints s WHERE s.starts_on = v_week) ELSE c.sprint_id END) THEN
      IF p_changes ? 'goal' THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That goal belongs to another sprint. Move the card to that week, or pick one of its sprint''s goals.'));
      END IF;
      v_goal := NULL;
    END IF;
  END IF;
  -- #4255: an agent moves a card only under a card its person owns.
  v_new_parent := (cl->>'parent_id')::uuid;
  IF v.via IS NOT NULL AND p_changes ? 'parent' AND v_new_parent IS DISTINCT FROM c.parent_id AND v_new_parent IS NOT NULL
     AND NOT public.ops_is_person_on(v_new_parent, v.actor_email, ARRAY['owner']) THEN
    RAISE EXCEPTION 'not_your_card: Your person is not an owner of that parent card.' USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'parent' AND jsonb_typeof(p_changes->'parent') <> 'null' AND v_new_parent IS NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'parent') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is not on the board. Use an id returned by Mingla.'));
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  n.title := cl->>'title'; n.instructions := cl->>'instructions'; n.done_means := cl->>'done_means';
  n.anchor_kind := cl->>'anchor_kind'; n.anchor_id := (cl->>'anchor_id')::uuid;
  n.due_on := (cl->>'due_on')::date; n.due_source := cl->>'due_source'; n.plan := cl->'plan';
  n.status := v_status; n.person_reason := v_reason; n.files_url := cl->>'files_url';
  -- #4255
  n.parent_id := v_new_parent; n.description_md := cl->>'description'; n.start_on := (cl->>'start_on')::date;
  n.estimate_minutes := (cl->>'estimate_minutes')::integer; n.goal_id := v_goal;
  n.in_backlog := COALESCE((cl->>'in_backlog')::boolean, c.in_backlog);
  IF v_status = 'doing' AND c.status <> 'doing' THEN n.started_at := COALESCE(c.started_at, clock_timestamp()); n.working_by := v.actor_email; n.working_via := v.via; END IF;
  -- Back to To do: nobody is working on it any more, so the mark ends.
  IF v_status = 'todo' AND c.status = 'doing' THEN n.working_by := NULL; n.working_via := NULL; END IF;
  n.sprint_id := CASE WHEN v_week IS NOT NULL THEN public.ops_sprint_ensure(v_week) ELSE c.sprint_id END;
  IF c.kind = 'promo' AND v_anchor_changed AND c.override_at IS NULL THEN
    v_gate := public.ops_promo_gate(cl->'anchor', v_today);
    n.blocked := (v_gate->>'blocked')::boolean;
    n.blocked_kind := CASE WHEN n.blocked THEN v_gate->>'kind' END;
    n.blocked_reason := CASE WHEN n.blocked THEN v_gate->>'reason' END;
  END IF;

  -- #3980 W2 rework 4: on a roadmap approval card an agent changes nothing
  -- that ties it to its draft or decides whether it is open: its links, its
  -- GitHub links, blocked or waiting, or its anchor. Its wording, plan,
  -- result and due date stay editable. (A trigger refuses the same for every
  -- other writer.)
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (ROW(n.blocked, n.blocked_kind, n.blocked_reason, n.anchor_kind, n.anchor_id)
            IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason, c.anchor_kind, c.anchor_id)
          OR (p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur)
          OR (p_changes ? 'links' AND
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT l.kind || ':' || l.target_id::text AS k FROM public.ops_work_links l WHERE l.card_id = c.id) a)
              IS DISTINCT FROM
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT (x->>'kind') || ':' || lower(x->>'id') AS k FROM jsonb_array_elements(COALESCE(cl->'links', '[]'::jsonb)) x) b))) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes what this card links to or waits for.' USING ERRCODE = '42501';
  END IF;
  -- #3980 W2 follow-up: nor who owns or watches it (the same test
  -- ops_people_set uses for "changed"; a trigger backstops every writer).
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (public.ops_card_people(c.id, 'owner')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)) x ORDER BY x)
          OR public.ops_card_people(c.id, 'watcher')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'watchers', '[]'::jsonb)) x
                                    WHERE NOT x = ANY (ARRAY(SELECT jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)))) ORDER BY x)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes who owns or watches this card.' USING ERRCODE = '42501';
  END IF;

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result, n.files_url, n.on_brand_plan,
         n.parent_id, n.description_md, n.start_on, n.estimate_minutes, n.goal_id, n.in_backlog)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result, c.files_url, c.on_brand_plan,
         c.parent_id, c.description_md, c.start_on, c.estimate_minutes, c.goal_id, c.in_backlog) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  -- #4255: the plan is the card's subtasks.
  IF p_changes ? 'plan' AND n.plan IS DISTINCT FROM public.ops_plan_from_subtasks(c.id) THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, files_url = n.files_url, on_brand_plan = n.on_brand_plan, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    parent_id = n.parent_id, description_md = n.description_md, start_on = n.start_on, estimate_minutes = n.estimate_minutes,  -- #4255
    goal_id = n.goal_id, in_backlog = n.in_backlog,
    plan = c.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via,
    working_chat = CASE WHEN v_status = 'doing' AND c.status <> 'doing' THEN v_chat
                        WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_chat END,
    working_seen_at = CASE WHEN v_status = 'doing' AND c.status <> 'doing' AND v.via IS NOT NULL THEN clock_timestamp()
                           WHEN v_status = 'doing' AND c.status <> 'doing' THEN NULL
                           WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_seen_at END
   WHERE id = c.id;
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  v_people := public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
  IF (v_people->>'changed')::boolean THEN v_cats := v_cats || 'people'::text; END IF;
  v_links_changed := public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
  IF v_links_changed THEN v_cats := v_cats || 'links'::text; END IF;
  IF 'plan' = ANY (v_cats) THEN PERFORM public.ops_plan_sync(c.id, cl->'plan', v.actor_email, v.via); END IF;  -- #4255
  IF p_changes ? 'github' THEN
    v_gh_changed := public.ops_github_set(c.id, cl->'github', v.actor_email, v.via);
    IF v_gh_changed THEN v_cats := v_cats || 'github'::text; END IF;
    -- #3980 W2 rework: a person changing what a waiting card waits for is logged by name.
    IF v_gh_changed AND c.blocked_kind = 'github' AND v.via IS NULL THEN
      PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
        format('%s changed what Card %s waits for: %s (was %s).', v_who, c.number, COALESCE(v_gh_list, 'nothing'), COALESCE(v_gh_cur, 'nothing')),
        jsonb_build_object('changed', '["github"]'::jsonb, 'from', v_gh_cur, 'to', v_gh_list, 'waiting', true));
    END IF;
  END IF;

  IF cardinality(v_cats) = 0 THEN
    SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = c.id;
    v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', NULL, 'changed', false);
    PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
    RETURN v_out;
  END IF;
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_action := CASE WHEN cardinality(v_cats) = 1 THEN v_cats[1] ELSE 'updated' END;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, v_action, CASE WHEN v_back THEN v_back_reason END, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  -- "Gia, Hal": the people taken off the card, by name, for the agent log.
  -- A name another teammate shares carries the address: "Gia <gia@...>".
  SELECT string_agg(public.ops_name(x.email)
           || CASE WHEN EXISTS (SELECT 1 FROM public.admin_team_directory() d
                                 WHERE d.status = 'active' AND d.email <> x.email
                                   AND lower(public.crm_display_name(d.email)) = lower(public.ops_name(x.email)))
                   THEN ' <' || x.email || '>' ELSE '' END, ', ' ORDER BY x.ord) INTO v_removed_words
    FROM jsonb_array_elements_text(COALESCE(v_people->'removed', '[]'::jsonb)) WITH ORDINALITY AS x(email, ord);
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_owners')), v.actor_email,
    format('%s added you as owner: %s', v_who, n.title));
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_watchers')), v.actor_email,
    format('%s added you as watcher: %s', v_who, n.title));
  -- An agent that takes someone off a card tells them: who, which agent, and
  -- the card (the notice links to it). Guardrail, not a bottleneck.
  IF v.via IN ('claude', 'codex') THEN
    PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'removed')), v.actor_email,
      format('%s took you off this card: %s', v_who, n.title));
  END IF;
  -- #4270: a card that gets a Send, Spend or Publish tag stays in its column
  -- and waits for a person; owners and watchers are told.
  -- #4255 Retest 2 (P3): a different ask is a new decision too (Send to
  -- Spend, You publish to Needs your OK), not only no tag to a tag. The same
  -- ask again never reaches here (no change, no event).
  IF n.person_reason IS NOT NULL AND n.person_reason IS DISTINCT FROM c.person_reason THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      -- #4270 rework (P3-4): the tag's own words, never "needs a person".
      format('%s: %s · %s', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'You send' WHEN 'spend' THEN 'You spend' WHEN 'publish' THEN 'You publish' ELSE 'Needs your OK' END));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s is tagged %s: %s', n.number, CASE n.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card's tag comes off.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s took the %s tag off %s%s', v_who, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title,
        COALESCE(': ' || v_back_reason, '')));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'info', c.id, 'work_card', c.id,
      format('Card %s no longer has its %s tag%s', n.number,
        CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END,
        COALESCE(': ' || v_back_reason, '.')),
      jsonb_build_object('changed', to_jsonb(v_cats), 'from', c.person_reason, 'to', n.status, 'reason', v_back_reason));
  ELSIF v.via IS NOT NULL THEN
    PERFORM public.ops_log_write(v.actor_email, v.via,
      CASE v_action WHEN 'plan' THEN 'step' WHEN 'blocked' THEN 'blocked' WHEN 'unblocked' THEN 'unblocked' ELSE 'updated' END, 'ok', c.id, 'work_card', c.id,
      CASE WHEN v_action = 'plan' THEN format('Plan on Card %s: %s of %s steps done.', n.number,
             (SELECT count(*) FROM jsonb_array_elements(n.plan) s WHERE s->>'status' = 'done'), jsonb_array_length(n.plan))
           WHEN v_action = 'blocked' THEN format('Card %s blocked: %s', n.number, n.blocked_reason)
           -- #3980 rework 2: a removal says who was taken off, not "Updated".
           WHEN v_action = 'people' AND v_removed_words IS NOT NULL
                AND jsonb_array_length(v_people->'new_owners') = 0 AND jsonb_array_length(v_people->'new_watchers') = 0
             THEN format('Took %s off Card %s: %s', v_removed_words, n.number, n.title)
           WHEN v_removed_words IS NOT NULL THEN format('Updated Card %s: %s. Took %s off it.', n.number, n.title, v_removed_words)
           ELSE format('Updated Card %s: %s', n.number, n.title) END, jsonb_build_object('changed', to_jsonb(v_cats)));
  END IF;
  v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'invalid_card: An open card already has this title. Update that card instead.' USING ERRCODE = '22023';
END;

$function$
;
CREATE OR REPLACE FUNCTION public.ops_work_add(p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_item jsonb; v_idx integer := 0; v_rows jsonb := '[]'::jsonb;
  v_chk jsonb; cl jsonb; c public.ops_work_cards; v_event uuid; v_gate jsonb; v_added integer := 0; v_refused integer := 0;
  v_dups integer := 0; v_out jsonb; v_fields text; v_owners text[]; v_watchers text[]; v_ex_id uuid; v_ex_number bigint; v_ex_title text; v_who text;
  v_quick boolean; v_host_name text; v_source text; -- #4270 W2: a quick add from a host card
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_cards: Send a list of 1 to 50 cards.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-add', 'add', p_items);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);
  -- #4270 W2 (D15): a person decides what hosts see. An agent never adds a
  -- card the host can see on their plan.
  IF v.via IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
                                    WHERE jsonb_typeof(e) = 'object' AND e->'on_brand_plan' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'people_only: A person decides what hosts see.' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) ORDER BY e.ord LOOP
    -- #4270 W2 (C-6): a quick add from a host card says what, who and when;
    -- Mingla writes the instructions and done means, and staff can edit them.
    v_quick := jsonb_typeof(v_item) = 'object' AND v_item->'quick' = 'true'::jsonb;
    v_source := NULL;
    IF jsonb_typeof(v_item) = 'object' AND v_item ? 'quick' THEN
      v_item := v_item - 'quick';
    END IF;
    IF v_quick THEN
      v_source := 'host_card';
      SELECT r.name INTO v_host_name FROM public.crm_records r
       WHERE r.deleted_at IS NULL AND r.pipeline = 'hosts'
         AND r.id = (SELECT CASE WHEN public.ops_is_uuid(l->>'id') THEN (l->>'id')::uuid END
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_item->'links') = 'array' THEN v_item->'links' ELSE '[]'::jsonb END) l
                      WHERE l->>'kind' = 'host' LIMIT 1);
      IF NOT (v_item ? 'instructions') OR jsonb_typeof(v_item->'instructions') <> 'string' OR btrim(v_item->>'instructions') = '' THEN
        v_item := v_item || jsonb_build_object('instructions',
          format('Added by %s from %s''s host card.', v_who, COALESCE(v_host_name, 'a host')));
      END IF;
      IF NOT (v_item ? 'done_means') OR jsonb_typeof(v_item->'done_means') <> 'string' OR btrim(v_item->>'done_means') = '' THEN
        v_item := v_item || jsonb_build_object('done_means',
          CASE WHEN v_item->'on_brand_plan' = 'true'::jsonb THEN 'Done and the host is told in the Brand group.' ELSE 'Done with proof on this card.' END);
      END IF;
    END IF;
    v_chk := public.ops_validate_card(v_item, 'add', v.actor_email, v_today);
    IF jsonb_array_length(v_chk->'fixes') > 0 THEN
      SELECT string_agg(DISTINCT public.ops_field_words(f->>'field'), ', ') INTO v_fields FROM jsonb_array_elements(v_chk->'fixes') f;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused', 'fixes', v_chk->'fixes',
        'title', v_chk->'clean'->'title'));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', NULL, NULL, NULL,
        format('Card not added (%s): %s to fix.', COALESCE(v_chk->'clean'->>'title', 'no title'), v_fields),
        jsonb_build_object('fields', (SELECT jsonb_agg(DISTINCT f->>'field') FROM jsonb_array_elements(v_chk->'fixes') f)));
      v_refused := v_refused + 1;
    ELSIF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate', 'existing', v_chk->'duplicate',
        'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', (v_chk->'duplicate'->>'id')::uuid, 'work_card', (v_chk->'duplicate'->>'id')::uuid,
        format('Card not added: it repeats Card %s.', v_chk->'duplicate'->>'number'), '{}'::jsonb);
      v_dups := v_dups + 1;
    ELSIF v.via IS NOT NULL AND v_chk->'clean'->>'parent_id' IS NOT NULL
          AND NOT public.ops_is_person_on((v_chk->'clean'->>'parent_id')::uuid, v.actor_email, ARRAY['owner']) THEN
      -- #4255: an agent adds subtasks only under a card its person owns.
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused',
        'fixes', jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'Your person is not an owner of the parent card. Add a note there instead, or ask an owner.')),
        'title', v_chk->'clean'->'title'));
      v_refused := v_refused + 1;
    ELSE
      cl := v_chk->'clean';
      v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
      v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
      v_gate := CASE WHEN cl->>'kind' = 'promo' THEN public.ops_promo_gate(cl->'anchor', v_today) END;
      BEGIN
        INSERT INTO public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason, files_url,
          on_brand_plan, brand_plan_source, kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, request_key,
          parent_id, description_md, start_on, estimate_minutes, goal_id, in_backlog)  -- #4255
        VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
          'todo', -- #4270: a tagged card waits in To do; the tag is person_reason
          COALESCE((v_gate->>'blocked')::boolean, false),
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'kind' END,
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'reason' END,
          cl->>'person_reason', cl->>'files_url', COALESCE((cl->>'on_brand_plan')::boolean, false), v_source, cl->>'kind', (cl->>'kit_step')::integer, cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
          -- #4255: a subtask is in its parent's sprint; the plan is subtasks
          (cl->>'due_on')::date, cl->>'due_source', COALESCE((cl->>'parent_sprint_id')::uuid, public.ops_sprint_for((cl->>'due_on')::date, v_today)), '[]'::jsonb,
          v.actor_email, v.via, v.actor_email, v.via, p_request_key || '-i' || v_idx,
          (cl->>'parent_id')::uuid, cl->>'description', (cl->>'start_on')::date, (cl->>'estimate_minutes')::integer,
          (cl->>'goal_id')::uuid, COALESCE((cl->>'in_backlog')::boolean, false))
        RETURNING * INTO c;
        PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
        PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
        PERFORM public.ops_plan_sync(c.id, cl->'plan', v.actor_email, v.via);  -- #4255
        v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
        IF public.ops_github_set(c.id, cl->'github', v.actor_email, v.via) THEN
          PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'github',
            'GitHub: ' || (SELECT string_agg('#' || (g->>'number'), ', ') FROM jsonb_array_elements(cl->'github') g), NULL, NULL, c.revision, c.revision);
        END IF;
        PERFORM public.ops_notify_people(c.id, v_event, v_owners, v.actor_email, format('%s added you as owner: %s', v_who, c.title));
        PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v.actor_email, format('%s added you as watcher: %s', v_who, c.title));
        PERFORM public.ops_log_write(v.actor_email, v.via, 'card_added', 'ok', c.id, 'work_card', c.id,
          format('Added Card %s: %s', c.number, c.title), jsonb_build_object('owners', cardinality(v_owners), 'watchers', cardinality(v_watchers)));
        IF c.person_reason IS NOT NULL THEN
          PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
            format('Card %s is tagged %s: %s', c.number, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, c.title), jsonb_build_object('reason', c.person_reason));
        END IF;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'added', 'card', public.ops_card_json(c, v_today)));
        v_added := v_added + 1;
      EXCEPTION WHEN unique_violation THEN
        SELECT w.id, w.number, w.title INTO v_ex_id, v_ex_number, v_ex_title FROM public.ops_work_cards w
         WHERE w.archived_at IS NULL AND ((w.title_key = public.crm_name_key(cl->>'title') AND w.status <> 'done')
            OR (w.anchor_kind = cl->>'anchor_kind' AND w.anchor_id = (cl->>'anchor_id')::uuid AND w.kit_step = (cl->>'kit_step')::integer))
         LIMIT 1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate',
          'existing', jsonb_build_object('id', v_ex_id, 'number', v_ex_number, 'title', v_ex_title),
          'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_ex_title, v_ex_number)));
        v_dups := v_dups + 1;
      END;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  v_out := jsonb_build_object('results', v_rows, 'added', v_added, 'refused', v_refused, 'duplicate', v_dups, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-add', 'add', v_out);
  RETURN v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM ~ '^[a-z_]+: ' THEN RAISE; END IF;
  RAISE WARNING 'ops_work_add: request stopped (% %)', SQLSTATE, SQLERRM;
  RAISE EXCEPTION 'try_again: Something went wrong on our side, so nothing in this request was added. Send the same request again.' USING ERRCODE = 'PT409';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_auto_card_upsert(p_auto_key text, p_item jsonb, p_kind text, p_anchor jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; v_today date := public.ops_today(NULL); v_item jsonb; v_chk jsonb; cl jsonb;
  c public.ops_work_cards; v_event uuid; v_owners text[]; v_watchers text[]; v_existing uuid;
BEGIN
  IF p_auto_key IS NULL OR p_auto_key !~ '^[a-z_]+:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid_auto_key: An automatic card needs a key like eng_no_issue:pr-12.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_auto_card:' || p_auto_key, 0));
  SELECT w.id INTO v_existing FROM public.ops_work_cards w
   WHERE w.auto_key = p_auto_key AND w.archived_at IS NULL AND w.status <> 'done' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('status', 'kept', 'id', v_existing); END IF;
  IF EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.auto_key = p_auto_key AND w.status = 'done'
              AND w.close_kind IN ('done','already_done','declined') AND w.closed_at > now() - interval '14 days') THEN
    RETURN jsonb_build_object('status', 'kept', 'id', NULL);
  END IF;
  v_item := COALESCE(p_item, '{}'::jsonb) || jsonb_build_object('kind', COALESCE(p_kind, 'task'));
  IF p_anchor IS NOT NULL AND jsonb_typeof(p_anchor) = 'object' THEN v_item := v_item || jsonb_build_object('anchor', p_anchor); END IF;
  v_chk := public.ops_validate_card(v_item, 'auto', c_actor, v_today);
  IF jsonb_array_length(v_chk->'fixes') > 0 THEN
    RAISE WARNING 'ops_auto_card_upsert: % refused (%)', p_auto_key, (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_chk->'fixes') f);
    RETURN jsonb_build_object('status', 'refused', 'fixes', v_chk->'fixes');
  END IF;
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
    RETURN jsonb_build_object('status', 'duplicate', 'existing', v_chk->'duplicate');
  END IF;
  cl := v_chk->'clean';
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  INSERT INTO public.ops_work_cards (title, instructions, done_means, status, person_reason, kind, kit_step, anchor_kind, anchor_id, due_on, due_source,
    sprint_id, plan, created_by, created_via, updated_by, updated_via, auto_key)
  VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
    'todo', cl->>'person_reason', cl->>'kind', (cl->>'kit_step')::integer,
    cl->>'anchor_kind', (cl->>'anchor_id')::uuid, (cl->>'due_on')::date, cl->>'due_source',
    public.ops_sprint_ensure(v_today), '[]'::jsonb, c_actor, 'system', c_actor, 'system', p_auto_key)
  RETURNING * INTO c;
  PERFORM public.ops_people_set(c.id, v_owners, v_watchers, c_actor, NULL);
  PERFORM public.ops_links_set(c.id, cl->'links', c_actor, NULL);
  PERFORM public.ops_github_set(c.id, cl->'github', c_actor, NULL);
  PERFORM public.ops_plan_sync(c.id, cl->'plan', c_actor, 'system');  -- #4255: the plan is subtasks
  v_event := public.ops_card_event(c.id, c_actor, 'system', 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
  PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', c.id, 'work_card', c.id,
    format('Mingla added Card %s: %s', c.number, c.title), jsonb_build_object('auto_key', p_auto_key, 'owners', cardinality(v_owners)));
  PERFORM public.ops_notify_people(c.id, v_event, v_owners || v_watchers, c_actor, format('Mingla added: %s', c.title));
  RETURN jsonb_build_object('status', 'added', 'id', c.id, 'number', c.number);
END;
$$;

-- ---------------------------------------------------------------------------
-- P3b. team_inbox (from 20280614054255): each mention carries decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_inbox(
  p_alert_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  RETURN (
    WITH m AS MATERIALIZED (
      SELECT tm.id, tm.source_kind, tm.created_at, tm.read_at, tm.body_excerpt, tm.deep_link,
             e.card_id, e.action,
             tm.decision, -- #4255 Retest 2 (P3b)
             tmsg.thread_id, tmsg.id AS message_id, -- #4255 W1b
             public.team_inbox_kind(tm.source_kind, e.action) AS kind,
             COALESCE(
               CASE WHEN tm.source_kind = 'work_due' THEN 'Mingla' END, -- #4255 rework F
               CASE WHEN e.id IS NOT NULL THEN public.ops_actor_label(e.actor_email, e.via) END,
               public.crm_display_name(lower(btrim(u.email))),
               'A teammate') AS actor
        FROM public.team_mentions tm
        LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
        LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id -- #4255 W1b
        LEFT JOIN auth.users u ON u.id = tm.actor_user_id
       WHERE tm.target_user_id = v_me
         AND (tm.source_kind <> 'team_message'
              OR (tmsg.deleted_at IS NULL AND public.team_chat_can_read(tmsg.thread_id))) -- #4255 W1b
    ), a AS MATERIALIZED (
      SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at,
             public.team_inbox_ticket_resolved(n.data) AS ticket_resolved
        FROM public.notifications n
       WHERE n.user_id = v_me AND n.type = ANY (v_types)
         AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
    )
    SELECT jsonb_build_object(
      'mentions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'kind', x.kind, 'source_kind', x.source_kind, 'card_id', x.card_id, 'action', x.action,
          'thread_id', x.thread_id, 'message_id', x.message_id, -- #4255 W1b
          'decision', x.decision, -- #4255 Retest 2 (P3b): the one decision flag
          'actor_name', x.actor, 'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
          'created_at', x.created_at, 'read_at', x.read_at) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM m ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
          'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
          'ticket_resolved', x.ticket_resolved) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM a ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'unread', jsonb_build_object(
        'mentions', (SELECT count(*) FROM m WHERE kind = 'mention' AND read_at IS NULL),
        'work_updates', (SELECT count(*) FROM m WHERE kind = 'work_update' AND read_at IS NULL),
        'support', (SELECT count(*) FROM a WHERE read_at IS NULL AND NOT ticket_resolved))
    )
  );
END;
$$;
COMMENT ON FUNCTION public.team_inbox(text[], integer) IS
  'Issue #4130/#4255: the signed-in teammate''s own inbox. Mentions split into real mentions and Work updates with who did it (each carries decision, the per-person verdict ops_notify_people stored: Admin Messages and the Host app label "Needs your decision" from it; team chat mentions carry their thread_id and message_id; deleted or left ones are hidden; the 09:00 due notice is from Mingla); support alerts with whether their ticket is already resolved (then never unread). Own rows only.';

-- ---------------------------------------------------------------------------
-- P1. team_set_my_timezone: the device's zone on the teammate's own profile.
-- ---------------------------------------------------------------------------
-- Signed-in only, never a connected agent. A host who is not staff is answered {staff:false} and
-- nothing is written (the team clock is for staff). An unknown zone is
-- refused (22023) and nothing is written. The same zone again writes nothing.
CREATE FUNCTION public.team_set_my_timezone(p_timezone text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_zone text := btrim(COALESCE(p_timezone, ''));
  v_current text;
  v_via text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'team_timezone_signed_out' USING ERRCODE = '42501';
  END IF;
  -- #4255 Retest 2 (P4): a connected agent never writes its person's clock,
  -- like every other team chat write (team_chat_ctx). crm_ctx() is the one
  -- reader of the gateway ledger; a caller it refuses reads as a person.
  BEGIN
    SELECT x.via INTO v_via FROM public.crm_ctx() x;
  EXCEPTION WHEN insufficient_privilege THEN
    v_via := NULL;
  END;
  IF v_via IS NOT NULL THEN
    RAISE EXCEPTION 'agents_cannot_post: Agents do not change a teammate''s time zone.' USING ERRCODE = '42501';
  END IF;
  IF v_zone = '' OR char_length(v_zone) > 64
     OR v_zone LIKE 'posix/%'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_zone) THEN
    RAISE EXCEPTION 'team_timezone_unknown' USING ERRCODE = '22023',
      DETAIL = 'Use an IANA time zone name, for example Africa/Lagos.';
  END IF;
  IF NOT public.team_chat_staff(v_uid) THEN
    RETURN jsonb_build_object('staff', false, 'timezone', NULL, 'changed', false);
  END IF;
  SELECT NULLIF(btrim(p.timezone), '') INTO v_current FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('staff', true, 'timezone', NULL, 'changed', false);
  END IF;
  IF v_current IS NOT DISTINCT FROM v_zone THEN
    RETURN jsonb_build_object('staff', true, 'timezone', v_zone, 'changed', false);
  END IF;
  UPDATE public.profiles p SET timezone = v_zone WHERE p.id = v_uid;
  RETURN jsonb_build_object('staff', true, 'timezone', v_zone, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.team_set_my_timezone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_set_my_timezone(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.team_set_my_timezone(text) IS
  'Issue #4255. Saves the signed-in staff member''s device time zone (an IANA name in pg_timezone_names) on profiles.timezone, only when it is empty or different; quiet hours and the 09:00 due notice read it. Non-staff: {staff:false}, nothing written. Unknown zone: 22023. A connected agent: 42501 agents_cannot_post.';

COMMIT;
