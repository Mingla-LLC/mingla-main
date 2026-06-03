-- ORCH-1064 [admin↔business venue-listing feedback loop]
-- Structured feedback the admin leaves on a pending venue claim; the business
-- reads its OWN feedback, marks items fixed, and re-submits.
--
-- Docs (COMMS-0003 external-API-cited):
--   RLS:           https://supabase.com/docs/guides/database/postgres/row-level-security
--   SECURITY DEFINER + search_path:
--                  https://supabase.com/docs/guides/database/functions
--                  https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw
--   PostgREST schema reload (notify pgrst): https://postgrest.org/en/stable/references/schema_cache.html
--   pgTAP testing: https://supabase.com/docs/guides/local-development/testing/pgtap-extended
--
-- Additive only: one new table + one view + four RPC definitions (CREATE OR
-- REPLACE — three new RPCs + one extension of the META-ORCH-1062 bundle reader).
-- No mutation of existing tables, so no abort-on-existing-rows risk; no data
-- probe required for the DDL. Remote probe recorded in the implementation report:
--   venue_claim_feedback DOES NOT exist on remote (greenfield),
--   1 pending_review brand (with_follow_up=1), remote max migration = 20260831000000.
--
-- Version 20260901000000 is strictly greater than remote max (20260831000000)
-- AND every sibling-worktree max (20260831000000, this worktree). 🔒 LOCKED.
--
-- State model (LOCKED, SPEC §4.1.6): the claim NEVER leaves
-- claim_status='pending_review' during the feedback loop. need_more_info is
-- modeled as pending_review + claim_follow_up_at IS NOT NULL (the existing
-- META-ORCH-1062 / Ve3 convention). admin_add_… sets the stamp; biz_resubmit_…
-- clears it. There is NO competing status column (Constitution #2 — one owner
-- per truth). The "round" lives entirely in venue_claim_feedback.round; history
-- is preserved because re-submit never deletes prior rounds.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table public.venue_claim_feedback
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.venue_claim_feedback (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  place_pool_id   uuid references public.place_pool(id) on delete set null,
  round           integer not null,
  category        text not null check (category in
                    ('photos','address','hours','category','description','quality','other')),
  note            text not null check (length(trim(note)) > 0),
  overall_message text,                       -- non-null only on the round's first item
  status          text not null default 'open' check (status in ('open','fixed')),
  created_by      uuid not null,              -- admin auth.uid()
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz                 -- set when status flips to 'fixed'
);

create index if not exists idx_vcf_brand_round
  on public.venue_claim_feedback (brand_id, round desc, created_at);
create index if not exists idx_vcf_brand_status
  on public.venue_claim_feedback (brand_id, status);

comment on table public.venue_claim_feedback is
  'ORCH-1064 — structured admin→business feedback on a venue claim. One row per '
  'item (category+note); overall_message rides the round''s first item; round '
  'groups items per admin pass; status open/fixed; business reads only its own '
  'brand''s rows via biz_brand_effective_rank_for_caller owner predicate. '
  'need_more_info is modeled as pending_review + claim_follow_up_at (no competing '
  'status column) — do NOT add one.';

alter table public.venue_claim_feedback enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS policies — admin full read/write; brand owner SELECT-only.
--    Writes are RPC-only (the two SECURITY DEFINER business RPCs re-assert the
--    owner predicate), so NO owner INSERT/UPDATE/DELETE policy is granted.
--    I-1064-RPC-WRITES-ONLY + I-1064-FEEDBACK-OWNER-READ.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "admin manages venue_claim_feedback" on public.venue_claim_feedback;
create policy "admin manages venue_claim_feedback"
  on public.venue_claim_feedback
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "owner reads own venue_claim_feedback" on public.venue_claim_feedback;
create policy "owner reads own venue_claim_feedback"
  on public.venue_claim_feedback
  for select to authenticated
  using (
    public.biz_brand_effective_rank_for_caller(brand_id)
      >= public.biz_role_rank('account_owner')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper view: the current (max) round's items per brand, for the business
--    sheet's primary list. security_invoker=true so the view inherits the
--    caller's RLS (owner predicate) — no privilege leak.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.venue_claim_active_feedback
with (security_invoker = true) as
  select f.*
  from public.venue_claim_feedback f
  where f.round = (
    select max(f2.round) from public.venue_claim_feedback f2 where f2.brand_id = f.brand_id
  );

comment on view public.venue_claim_active_feedback is
  'ORCH-1064 — the latest feedback round''s items per brand. security_invoker so '
  'RLS (owner predicate / admin) is enforced for the caller.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC admin_add_venue_claim_feedback — admin-gated; opens a fresh round.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_add_venue_claim_feedback(
  p_brand_id        uuid,
  p_items           jsonb,    -- [{ "category": "...", "note": "..." }, ...]
  p_overall_message text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_brand   public.brands%rowtype;
  v_round   integer;
  v_pp_id   uuid;
  v_item    jsonb;
  v_cat     text;
  v_note    text;
  v_first   boolean := true;
  v_count   integer := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin_user() then raise exception 'forbidden'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'items_required';
  end if;

  select * into v_brand from public.brands b
   where b.id = p_brand_id and b.deleted_at is null;
  if not found then raise exception 'brand_not_found'; end if;
  -- Feedback is only meaningful on a claim awaiting review.
  if v_brand.claim_status <> 'pending_review' then
    raise exception 'brand_not_pending_review';
  end if;
  v_pp_id := v_brand.place_pool_id;

  -- Next round = max existing + 1 (1 if none). Prior rounds are preserved.
  select coalesce(max(round), 0) + 1 into v_round
    from public.venue_claim_feedback where brand_id = p_brand_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cat  := nullif(trim(v_item->>'category'), '');
    v_note := nullif(trim(v_item->>'note'), '');
    if v_cat is null or v_cat not in
       ('photos','address','hours','category','description','quality','other') then
      raise exception 'invalid_category';
    end if;
    if v_note is null then raise exception 'note_required'; end if;

    insert into public.venue_claim_feedback
      (brand_id, place_pool_id, round, category, note, overall_message, created_by)
    values
      (p_brand_id, v_pp_id, v_round, v_cat, v_note,
       case when v_first then nullif(trim(coalesce(p_overall_message,'')),'') else null end,
       auth.uid());
    v_first := false;
    v_count := v_count + 1;
  end loop;

  -- Move the claim to need_more_info (extends the existing action; sets the
  -- follow-up stamp the business banner already keys off).
  -- I-1064-FEEDBACK-IMPLIES-FOLLOWUP: a successful call always leaves the stamp.
  update public.brands
     set claim_follow_up_at = now()
   where id = p_brand_id;

  return jsonb_build_object('ok', true, 'round', v_round, 'item_count', v_count);
end;
$function$;

revoke all on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) to authenticated;

comment on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) is
  'ORCH-1064 — admin-gated. Writes a fresh feedback round (items + optional '
  'overall_message on the first item) for a pending_review claim and stamps '
  'claim_follow_up_at. Returns {round, item_count}. Push is fired by the edge '
  'wrapper (admin-review-venue-claim action:add_feedback), NOT this RPC.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC biz_mark_feedback_item_fixed — brand-owner-gated toggle open↔fixed.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.biz_mark_feedback_item_fixed(
  p_feedback_id uuid,
  p_fixed       boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.venue_claim_feedback%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_row from public.venue_claim_feedback where id = p_feedback_id;
  if not found then raise exception 'feedback_not_found'; end if;

  -- Owner-only: the caller must own the brand this feedback belongs to.
  if public.biz_brand_effective_rank_for_caller(v_row.brand_id)
       < public.biz_role_rank('account_owner') then
    raise exception 'forbidden';
  end if;

  update public.venue_claim_feedback
     set status      = case when p_fixed then 'fixed' else 'open' end,
         resolved_at = case when p_fixed then now() else null end
   where id = p_feedback_id;

  return jsonb_build_object('ok', true, 'id', p_feedback_id,
                            'status', case when p_fixed then 'fixed' else 'open' end);
end;
$function$;

revoke all on function public.biz_mark_feedback_item_fixed(uuid, boolean) from public, anon;
grant execute on function public.biz_mark_feedback_item_fixed(uuid, boolean) to authenticated;

comment on function public.biz_mark_feedback_item_fixed(uuid, boolean) is
  'ORCH-1064 — brand-owner-gated. Toggles a feedback item status open/fixed '
  '(sets/clears resolved_at). Owner predicate = biz_brand_effective_rank_for_caller '
  '>= account_owner.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC biz_resubmit_venue_claim — brand-owner-gated; clears follow-up.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.biz_resubmit_venue_claim(
  p_brand_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
       < public.biz_role_rank('account_owner') then
    raise exception 'forbidden';
  end if;

  -- Guard: only a claim currently awaiting business action can be re-submitted.
  if v_brand.claim_status <> 'pending_review' or v_brand.claim_follow_up_at is null then
    raise exception 'not_awaiting_resubmit';
  end if;

  -- ...and only if a feedback round actually exists (pending feedback).
  select max(round) into v_active_round
    from public.venue_claim_feedback where brand_id = p_brand_id;
  if v_active_round is null then
    raise exception 'no_feedback_to_resubmit';
  end if;

  -- Flip back to a clean pending_review for re-review: clear the follow-up stamp
  -- so the banner reverts to plain "in review" and the admin queue shows it fresh.
  -- The next admin pass opens round = max+1 (history preserved).
  update public.brands
     set claim_follow_up_at = null
   where id = p_brand_id;

  return jsonb_build_object(
    'ok', true,
    'brand_id', p_brand_id,
    'resubmitted_round', v_active_round,
    'claim_status', 'pending_review'
  );
end;
$function$;

revoke all on function public.biz_resubmit_venue_claim(uuid) from public, anon;
grant execute on function public.biz_resubmit_venue_claim(uuid) to authenticated;

comment on function public.biz_resubmit_venue_claim(uuid) is
  'ORCH-1064 — brand-owner-gated. Re-submits a claim that received feedback: '
  'clears claim_follow_up_at so it returns to the admin Pending queue as a fresh '
  'pending_review. Guards: must be pending_review WITH a follow-up stamp AND >=1 '
  'feedback round. The next admin pass opens a new round.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Extend admin_get_claim_review_bundle (META-ORCH-1062) with a 'feedback'
--    key — the active round's items — so the admin modal sees what the business
--    has addressed in a single round-trip. CREATE OR REPLACE re-issues the
--    full META-ORCH-1062 definition verbatim plus the new key (admin-gated, so
--    privilege-safe). Keep the rest byte-faithful to 20260831000000.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_get_claim_review_bundle(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_brand    public.brands%rowtype;
  v_pp       public.place_pool%rowtype;
  v_scores   jsonb;
  v_feedback jsonb;
  v_has_pp   boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin_user() then
    raise exception 'forbidden';
  end if;

  select * into v_brand
  from public.brands b
  where b.id = p_brand_id and b.deleted_at is null;
  if not found then
    raise exception 'brand_not_found';
  end if;

  if v_brand.place_pool_id is not null then
    select * into v_pp from public.place_pool pp where pp.id = v_brand.place_pool_id;
    v_has_pp := found;
  end if;

  if v_has_pp then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'signal_id', ps.signal_id,
               'score', ps.score,
               'scored_at', ps.scored_at
             ) order by ps.score desc
           ), '[]'::jsonb)
    into v_scores
    from public.place_scores ps
    where ps.place_id = v_pp.id;
  else
    v_scores := '[]'::jsonb;
  end if;

  -- ORCH-1064 — the active (max) round's feedback items, so the admin sees what
  -- the business has marked fixed. Admin-gated definer → privilege-safe read.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', f.id,
             'round', f.round,
             'category', f.category,
             'note', f.note,
             'overall_message', f.overall_message,
             'status', f.status,
             'created_at', f.created_at,
             'resolved_at', f.resolved_at
           ) order by f.category, f.created_at
         ), '[]'::jsonb)
  into v_feedback
  from public.venue_claim_feedback f
  where f.brand_id = p_brand_id
    and f.round = (
      select max(f2.round) from public.venue_claim_feedback f2 where f2.brand_id = p_brand_id
    );

  return jsonb_build_object(
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'name', v_brand.name,
      'slug', v_brand.slug,
      'claim_status', v_brand.claim_status,
      'venue_category', v_brand.venue_category,
      'address', v_brand.address,
      'cover_media_url', v_brand.cover_media_url,
      'contact_email', v_brand.contact_email,
      'google_place_id', v_brand.google_place_id,
      'description', v_brand.description,
      'lat', v_brand.lat,
      'lng', v_brand.lng,
      'place_pool_id', v_brand.place_pool_id
    ),
    'place_pool', case when v_has_pp then jsonb_build_object(
      'id', v_pp.id,
      'is_active', v_pp.is_active,
      'is_servable', v_pp.is_servable,
      'bouncer_reason', v_pp.bouncer_reason,
      'bouncer_validated_at', v_pp.bouncer_validated_at,
      'stored_photo_urls', to_jsonb(v_pp.stored_photo_urls),
      'business_gallery_urls', to_jsonb(v_pp.business_gallery_urls),
      'photo_aesthetic_data', v_pp.photo_aesthetic_data,
      'price_level', v_pp.price_level,
      'price_tiers', to_jsonb(v_pp.price_tiers),
      'website', v_pp.website,
      'rating', v_pp.rating,
      'review_count', v_pp.review_count,
      'ai_signal_scores', v_pp.ai_signal_scores,
      'ai_signal_scores_veto', v_pp.ai_signal_scores_veto,
      'business_authoring_status', v_pp.business_authoring_status,
      'business_authoring_inputs', v_pp.business_authoring_inputs,
      'fetched_via', v_pp.fetched_via,
      'national_phone_number', v_pp.national_phone_number,
      'google_maps_uri', v_pp.google_maps_uri,
      'serves_dinner', v_pp.serves_dinner,
      'serves_lunch', v_pp.serves_lunch,
      'serves_wine', v_pp.serves_wine,
      'serves_cocktails', v_pp.serves_cocktails,
      'outdoor_seating', v_pp.outdoor_seating,
      'good_for_groups', v_pp.good_for_groups,
      'good_for_children', v_pp.good_for_children,
      'live_music', v_pp.live_music,
      'reservable', v_pp.reservable,
      'allows_dogs', v_pp.allows_dogs
    ) else null end,
    'scores', v_scores,
    'feedback', v_feedback
  );
end;
$function$;

revoke all on function public.admin_get_claim_review_bundle(uuid) from public, anon;
grant execute on function public.admin_get_claim_review_bundle(uuid) to authenticated;

comment on function public.admin_get_claim_review_bundle(uuid) is
  'META-ORCH-1062 Q4 + ORCH-1064 — admin-gated (is_admin_user) single-round-trip '
  'claim-review bundle: brand identity + linked place_pool vetting fields + '
  'place_scores array + the active venue_claim_feedback round (ORCH-1064).';

-- ORCH-1064 — reload PostgREST schema cache so the new RPCs/view are exposed.
notify pgrst, 'reload schema';
