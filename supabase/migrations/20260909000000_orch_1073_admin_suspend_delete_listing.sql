-- ORCH-1073 [admin suspend/delete venue listing + owner messaging]
-- ============================================================================
-- Adds admin controls to take a LIVE venue listing off the consumer deck:
--   • SUSPEND   — flips the place off the deck (is_active=false), suspends a
--                 claimed brand, drops the admin's custom message + to-do items
--                 into the ORCH-1064 structured to-do list, and notifies the
--                 brand owner(s) (push + in-app). Business fixes the to-dos and
--                 resubmits (existing biz_resubmit_venue_claim) → admin approves
--                 → re-bounce → back on the deck.
--   • DELETE    — soft-deletes the place_pool row (deleted_at), revokes the
--                 claim, notifies the owner. Reversible by an admin.
--   • RESTORE   — admin undo for suspend/delete.
--
-- Soft-delete invariant I-1073-DELETED-PLACE-NEVER-SERVABLE is enforced by ONE
-- row-level trigger (below): a row with deleted_at set is force-held at
-- is_servable=false AND is_active=false, so NO fetch/bouncer/scorer path can
-- resurrect it and the deck (which gates on is_servable=true AND is_active=true)
-- excludes it everywhere. No per-query filter threading required.
-- ============================================================================

-- 1) Soft-delete markers on place_pool ---------------------------------------
alter table public.place_pool add column if not exists deleted_at timestamptz;
alter table public.place_pool add column if not exists deleted_reason text;

-- 2) Invariant trigger: deleted ⇒ never servable/active ----------------------
create or replace function public._orch1073_enforce_deleted_unservable()
returns trigger
language plpgsql
as $$
begin
  if NEW.deleted_at is not null then
    NEW.is_servable := false;
    NEW.is_active := false;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_orch1073_deleted_unservable on public.place_pool;
create trigger trg_orch1073_deleted_unservable
  before insert or update on public.place_pool
  for each row execute function public._orch1073_enforce_deleted_unservable();

-- 3) Brand claim lifecycle: add 'suspended' + 'revoked' ----------------------
alter table public.brands drop constraint if exists brands_claim_status_check;
alter table public.brands add constraint brands_claim_status_check
  check (claim_status = any (array[
    'none','pending_review','verified','rejected','suspended','revoked'
  ]));

-- 4) Admin action audit: allow the new action types --------------------------
alter table public.place_admin_actions drop constraint if exists place_admin_actions_action_type_check;
alter table public.place_admin_actions add constraint place_admin_actions_action_type_check
  check (action_type = any (array[
    'deactivate','reactivate','refresh','bulk_deactivate','bulk_reactivate','bulk_refresh',
    'suspend','soft_delete','restore'
  ]));

-- 5a) SUSPEND ----------------------------------------------------------------
create or replace function public.admin_suspend_listing(
  p_place_id        uuid,
  p_overall_message text default null,
  p_items           jsonb default '[]'::jsonb,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_brand    public.brands%rowtype;
  v_round    integer;
  v_item     jsonb;
  v_cat      text;
  v_note     text;
  v_first    boolean := true;
  v_count    integer := 0;
  v_uid      uuid;
  v_notified integer := 0;
  v_msg      text := nullif(trim(coalesce(p_overall_message,'')),'');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin_user() then raise exception 'forbidden'; end if;

  -- Take it off the deck (is_active gate). deleted rows cannot be suspended.
  update public.place_pool set is_active = false
   where id = p_place_id and deleted_at is null;
  if not found then raise exception 'place_not_found_or_deleted'; end if;

  -- Claimed (verified) brand → suspend it + drive the business banner/to-do list.
  select * into v_brand
    from public.brands
   where place_pool_id = p_place_id and deleted_at is null and claim_status = 'verified'
   limit 1;

  if found then
    update public.brands
       set claim_status = 'suspended', claim_follow_up_at = now()
     where id = v_brand.id;

    -- Structured to-do round (mirrors ORCH-1064 admin_add_venue_claim_feedback).
    if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
      select coalesce(max(round),0)+1 into v_round
        from public.venue_claim_feedback where brand_id = v_brand.id;
      for v_item in select * from jsonb_array_elements(p_items) loop
        v_cat  := nullif(trim(v_item->>'category'),'');
        v_note := nullif(trim(v_item->>'note'),'');
        if v_cat is null or v_cat not in
           ('photos','address','hours','category','description','quality','other') then
          raise exception 'invalid_category';
        end if;
        if v_note is null then raise exception 'note_required'; end if;
        insert into public.venue_claim_feedback
          (brand_id, place_pool_id, round, category, note, overall_message, created_by)
        values
          (v_brand.id, p_place_id, v_round, v_cat, v_note,
           case when v_first then v_msg else null end, auth.uid());
        v_first := false;
        v_count := v_count + 1;
      end loop;
    elsif v_msg is not null then
      -- Message but no explicit items → one 'other' to-do carrying the message.
      select coalesce(max(round),0)+1 into v_round
        from public.venue_claim_feedback where brand_id = v_brand.id;
      insert into public.venue_claim_feedback
        (brand_id, place_pool_id, round, category, note, overall_message, created_by)
      values (v_brand.id, p_place_id, v_round, 'other', v_msg, v_msg, auth.uid());
      v_count := 1;
    end if;

    -- Notify active brand members (in-app + push pipeline picks it up).
    for v_uid in
      select user_id from public.brand_team_members
       where brand_id = v_brand.id and removed_at is null and accepted_at is not null
    loop
      insert into public.notifications
        (user_id, type, title, body, brand_id, related_id, related_type, deep_link, data)
      values
        (v_uid, 'listing_suspended', 'Your listing was suspended',
         coalesce(v_msg, 'An admin suspended your venue listing. Open it to see what to fix.'),
         v_brand.id, p_place_id::text, 'place_pool',
         '/brand/' || v_brand.id::text || '/listing',
         jsonb_build_object('place_id', p_place_id, 'brand_id', v_brand.id, 'reason', p_reason));
      v_notified := v_notified + 1;
    end loop;
  end if;

  insert into public.place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  values (p_place_id, 'suspend', auth.uid(), p_reason,
          jsonb_build_object('brand_id', v_brand.id, 'todo_items', v_count, 'notified', v_notified));

  return jsonb_build_object('ok', true, 'suspended', true,
                            'brand_id', v_brand.id, 'todo_items', v_count, 'notified', v_notified);
end;
$$;

-- 5b) SOFT-DELETE ------------------------------------------------------------
create or replace function public.admin_soft_delete_listing(
  p_place_id uuid,
  p_reason   text default null,
  p_message  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_brand    public.brands%rowtype;
  v_uid      uuid;
  v_notified integer := 0;
  v_msg      text := nullif(trim(coalesce(p_message,'')),'');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin_user() then raise exception 'forbidden'; end if;

  -- Soft-delete; the trigger forces is_servable=false + is_active=false.
  update public.place_pool
     set deleted_at = now(), deleted_reason = p_reason
   where id = p_place_id and deleted_at is null;
  if not found then raise exception 'place_not_found_or_already_deleted'; end if;

  -- Revoke a claimed brand. Keep place_pool_id intact so RESTORE can re-link.
  select * into v_brand
    from public.brands
   where place_pool_id = p_place_id and deleted_at is null
     and claim_status in ('verified','suspended','pending_review')
   limit 1;
  if found then
    update public.brands
       set claim_status = 'revoked', claim_follow_up_at = now()
     where id = v_brand.id;
    for v_uid in
      select user_id from public.brand_team_members
       where brand_id = v_brand.id and removed_at is null and accepted_at is not null
    loop
      insert into public.notifications
        (user_id, type, title, body, brand_id, related_id, related_type, deep_link, data)
      values
        (v_uid, 'listing_removed', 'Your listing was removed',
         coalesce(v_msg, 'An admin removed your venue listing from Mingla.'),
         v_brand.id, p_place_id::text, 'place_pool',
         '/brand/' || v_brand.id::text || '/listing',
         jsonb_build_object('place_id', p_place_id, 'reason', p_reason));
      v_notified := v_notified + 1;
    end loop;
  end if;

  insert into public.place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  values (p_place_id, 'soft_delete', auth.uid(), p_reason,
          jsonb_build_object('brand_id', v_brand.id, 'notified', v_notified));

  return jsonb_build_object('ok', true, 'deleted', true,
                            'brand_id', v_brand.id, 'notified', v_notified);
end;
$$;

-- 5c) RESTORE (admin undo) ---------------------------------------------------
create or replace function public.admin_restore_listing(p_place_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_was_deleted boolean;
  v_brand_id    uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin_user() then raise exception 'forbidden'; end if;

  select (deleted_at is not null) into v_was_deleted
    from public.place_pool where id = p_place_id;
  if v_was_deleted is null then raise exception 'place_not_found'; end if;

  -- Clear soft-delete + bring it back as active. is_servable is left to the
  -- bouncer/scorer to re-establish (a restore should not fabricate servability).
  update public.place_pool
     set deleted_at = null, deleted_reason = null, is_active = true
   where id = p_place_id;

  -- Re-verify a brand we suspended/revoked for this place.
  update public.brands
     set claim_status = 'verified', claim_follow_up_at = null
   where place_pool_id = p_place_id and claim_status in ('suspended','revoked')
  returning id into v_brand_id;

  insert into public.place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  values (p_place_id, 'restore', auth.uid(), null,
          jsonb_build_object('was_deleted', v_was_deleted, 'brand_id', v_brand_id));

  return jsonb_build_object('ok', true, 'restored', true,
                            'was_deleted', v_was_deleted, 'brand_id', v_brand_id);
end;
$$;

grant execute on function public.admin_suspend_listing(uuid,text,jsonb,text)  to authenticated, service_role;
grant execute on function public.admin_soft_delete_listing(uuid,text,text)    to authenticated, service_role;
grant execute on function public.admin_restore_listing(uuid)                  to authenticated, service_role;

-- 6) Extend the ORCH-1064 resubmit loop to accept a SUSPENDED brand ----------
-- A suspended listing (claim_status='suspended', follow-up stamp set by
-- admin_suspend_listing) is a corrective state: the business fixes the to-do
-- items and resubmits, flipping back to pending_review for admin re-approval
-- (runApproveGoLive then re-bounces → is_servable=true + is_active=true → live).
create or replace function public.biz_resubmit_venue_claim(p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_brand        public.brands%rowtype;
  v_active_round integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_brand from public.brands b
   where b.id = p_brand_id and b.deleted_at is null;
  if not found then raise exception 'brand_not_found'; end if;

  if public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_owner') then
    raise exception 'forbidden';
  end if;

  -- Awaiting business action = need-more-info (pending_review + stamp) OR suspended.
  if v_brand.claim_status not in ('pending_review','suspended')
     or v_brand.claim_follow_up_at is null then
    raise exception 'not_awaiting_resubmit';
  end if;

  select max(round) into v_active_round
    from public.venue_claim_feedback where brand_id = p_brand_id;
  if v_active_round is null then
    raise exception 'no_feedback_to_resubmit';
  end if;

  -- Back to a clean pending_review for re-review (history preserved).
  update public.brands
     set claim_status = 'pending_review', claim_follow_up_at = null
   where id = p_brand_id;

  return jsonb_build_object(
    'ok', true,
    'brand_id', p_brand_id,
    'resubmitted_round', v_active_round,
    'claim_status', 'pending_review'
  );
end;
$function$;
