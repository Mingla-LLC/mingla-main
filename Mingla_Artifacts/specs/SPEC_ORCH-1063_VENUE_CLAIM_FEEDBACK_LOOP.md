# SPEC — ORCH-1063 [admin↔business venue-listing feedback loop]

**Status:** READY FOR IMPLEMENT (SPEC complete)
**Author:** mingla-forensics (Claude) — INVESTIGATE-then-SPEC
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1063-[venue-claim-feedback-loop]/` on branch `ORCH-1063-venue-claim-feedback-loop`
**Builds on:** META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline] — MERGED on this branch's base (`235593199`, PR #336). All META-ORCH-1062 RPCs, the admin claim modal (`ClaimsPage.jsx`), and the business "In review" banner are live.
**Comms acknowledged:** COMMS-0018 (WARN→ME factored: the WS7 admin-review + Sub-F migration are reconciled onto this branch's base, so my new feedback RPCs build on the canonical `admin-review-venue-claim` v92/`biz_review_venue_claim`).

---

## 0. Layman summary

Today an admin reviewing a venue claim can only Approve, Reject, or click "Need more info" — and "Need more info" just stamps a timestamp and fires a vague "We need more information" push. The business gets **nothing actionable**: no list of what to fix, no way to mark items done, no way to re-submit. They just see a generic "being reviewed" banner.

This SPEC closes that loop. An admin leaves **structured feedback items** (each tagged with a category — photos / address / hours / etc. — plus a free-text note) and an optional overall message, in the SAME claim modal META-ORCH-1062 built. Saving the feedback moves the claim to `need_more_info` and pushes the business a real notification. The business opens its "In review" tile (now tappable, with a badge), sees the feedback grouped by category, marks each item **Fixed** as they address it, and taps **Re-submit for review** — which flips the claim back to `pending_review` so it returns to the admin's Pending queue for a fresh look. Each re-submit starts a **new feedback round**, preserving prior rounds as history.

---

## 1. Investigation findings (proof the loop is currently dead-ended)

### 1.1 Manifest (every file read, in trace order)

| # | File | Why read |
|---|------|----------|
| 1 | `supabase/functions/admin-review-venue-claim/index.ts` (500 ln) | The admin action edge fn; where `need_more_info` is handled + push fired |
| 2 | `supabase/functions/admin-review-venue-claim/reviewLogic.ts` (84 ln) | `normalizeReviewBody` action enum + `pushCopyForReview` copy |
| 3 | `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` ln 698–863 | LATEST `biz_review_venue_claim` definition (current truth) |
| 4 | `supabase/migrations/20260813000000_meta_orch_1009_sub_f_recommend_review.sql` | `place_pool.business_recommend_edit_count` + `ai_signal_scores_veto` columns |
| 5 | `supabase/migrations/20260831000000_meta_orch_1062_admin_vetting_rpcs.sql` (374 ln) | The exact pattern to mirror: SECURITY DEFINER + `is_admin_user()` gate + `search_path` pin + REVOKE/GRANT + COMMENT |
| 6 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` ln 2987–3031 | `biz_brand_effective_rank` / `biz_brand_effective_rank_for_caller` — the canonical brand-owner predicate |
| 7 | `mingla-admin/src/pages/ClaimsPage.jsx` (935 ln) | The claim modal where the feedback UI must live |
| 8 | `mingla-admin/src/services/adminClaimsService.js` (187 ln) | The admin service layer (`reviewClaim`, `tweakClaimFields`, `overrideClaimScore`) |
| 9 | `mingla-business/src/components/brand/VenueClaimStatusBanner.tsx` (92 ln) | **THE business "In review" tile** |
| 10 | `mingla-business/src/services/venueClaimBannerLogic.ts` (62 ln) | `venueClaimBannerVariant` (`follow_up` branch) + `venueClaimBannerCopy` |
| 11 | `mingla-business/src/services/venueClaimService.ts` | `fetchVenueClaimStatus` data fetch |
| 12 | `mingla-business/app/(tabs)/hub/_layout.tsx` ln 179 | Where the banner is mounted |
| 13 | `mingla-business/src/hooks/useVenueClaimRefresh.ts` | Foreground refresh + `brandKeys` cache invalidation |
| 14 | `mingla-business/src/types/brand.ts` ln 301–317 | `Brand` type: `claimStatus`/`rejectionReason`/`claimFollowUpAt`/`placePoolId` |
| 15 | `mingla-business/src/components/ui/SheetMobile.tsx` ln 120–149 | Canonical `Sheet` primitive API (`visible`/`onClose`/`children`/`snapPoint`) |
| 16 | `supabase/functions/_shared/push-utils.ts` ln 1–60 | `sendPush({ targetUserId, title, body, data, androidChannelId })` |
| 17 | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` ln 230–349 | C7 `no-new-backend-files` gate + backend allowlist pattern |

### 1.2 Findings

- 🔴 **F-1 (Root cause — dead-ended loop). `biz_review_venue_claim` `need_more_info` writes only a timestamp.** `supabase/migrations/20260729000000…` ln 756–766: `IF p_action = 'need_more_info' THEN … UPDATE brands SET claim_follow_up_at = now() … RETURN`. No feedback payload is stored. **Current behavior:** the admin's "need more info" intent is reduced to a single boolean-ish timestamp. **Correct behavior:** structured feedback items must be persisted and surfaced to the business. **Causal chain:** admin clicks → RPC stamps timestamp → push fires generic copy → business banner shows `follow_up` variant which (F-3) renders the SAME copy as plain pending. Business sees no actionable items → loop dead. **Verification:** live data probe — the one `pending_review` brand has `claim_follow_up_at` set but there is no table anywhere storing what was requested.

- 🔴 **F-2 (Root cause — generic push). `pushCopyForReview('need_more_info', …)`** (`reviewLogic.ts` ln 75–79) returns title `"More info needed"` / body `"We need more information about ${brandName}."` — no item detail, no deep-link to a fix surface.

- 🟠 **F-3 (Contributing — banner has no actionable state).** `venueClaimBannerCopy` (`venueClaimBannerLogic.ts` ln 38–47): the `follow_up` variant returns the IDENTICAL copy to `pending_review` ("being reviewed, usually within 4 business hours"). The business literally cannot tell a follow-up request from a normal pending review. And `VenueClaimStatusBanner.tsx` renders a non-interactive `<View>` (no `onPress`, no badge, no sheet) — there is no affordance to act even if copy existed.

- 🔵 **F-4 (Observation — pattern to mirror).** META-ORCH-1062's `admin_get_claim_review_bundle` / `admin_tweak_venue_claim_fields` / `admin_apply_score_override` (migration `20260831000000`) are the exact template: `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, `auth.uid() IS NULL → not_authenticated`, `NOT is_admin_user() → forbidden`, `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated`, then a `COMMENT ON FUNCTION`. New RPCs follow this verbatim.

- 🔵 **F-5 (Observation — owner predicate proven live).** `biz_brand_effective_rank_for_caller(brand_id)` returns the caller's max role rank on a brand (owner via `brands.account_id = auth.uid()` OR an accepted `brand_team_members` row). `account_owner` is the owner rank. Verified live: `biz_brand_effective_rank_for_caller`, `is_admin_user`, `biz_role_rank`, and `brands.account_id` all exist on remote.

### 1.3 Five-layer cross-check

| Layer | Truth |
|-------|-------|
| Docs | META-ORCH-1062 WORLD_MAP close note: claim approval and deck eligibility are separable; `need_more_info` = follow-up. No feedback model exists. |
| Schema | `brands.claim_status` (pending_review/verified/rejected/none), `brands.claim_follow_up_at` (the ONLY `need_more_info` artifact). No `venue_claim_feedback` table. |
| Code | `biz_review_venue_claim` `need_more_info` = timestamp only; banner = static View, generic copy. |
| Runtime | Admin "Need more info" → toast "Follow-up flagged" → generic push. Business sees unchanged banner. |
| Data | 1 `pending_review` brand (`with_follow_up=1`, `with_place_pool=1`); 14 `none`. No feedback rows possible. |

**Layers agree the loop is unbuilt** — this is greenfield additive, not a regression repair.

### 1.4 Outcome step-back (journey)

- **Business goal:** "Get my venue live. If something's wrong, tell me exactly what so I can fix it fast and get re-reviewed."
- **Desired journey:** submit claim → admin reviews → if gaps, business gets a precise punch-list → fixes each → re-submits → admin re-reviews → live.
- **Divergence today:** the punch-list step does not exist; "need more info" is a black hole. This SPEC builds the punch-list, the fix-tracking, and the re-submit handshake — the whole missing middle.

---

## 2. Scope, non-goals, assumptions

### 2.1 Scope (operator-locked decisions, spec'd exactly)

1. **Feedback model:** structured **category** per item (enum: `photos`, `address`, `hours`, `category`, `description`, `quality`, `other`) + a per-item free-text **note**, plus ONE optional overall **message** per round. Admin can add multiple items in one round.
2. **On submit:** saving feedback moves the claim to **`need_more_info`** (extends the existing action) AND pushes the business ("Your venue listing needs a few updates").
3. **Per-item status:** each item is **`open` / `fixed`**. Business marks items fixed; admin sees status. On **re-submit**, claim flips `need_more_info` → `pending_review`.
4. **Round concept:** each admin feedback submission opens a fresh **round** (incrementing integer per brand); re-submission closes the active round and the next admin pass opens a new one. History preserved.

### 2.2 Non-goals

- Editing/deleting individual feedback items by the admin after submit (admin adds a new round instead). Future ORCH if needed.
- Business free-text reply to feedback (one-directional admin→business + fixed-toggles only). Future ORCH.
- Threading feedback to specific photos/scores (category-level only).
- Buyer-web / consumer-app surfaces (no claim-feedback UI there).
- Auto-approval on re-submit (re-submit returns to the human Pending queue; admin still decides).

### 2.3 Assumptions

- `need_more_info` is reachable only from `pending_review` (proven: `biz_review_venue_claim` guards `claim_status <> 'pending_review' → brand_not_pending_review`). The new feedback RPC will perform the `need_more_info` transition itself and carry the same guard.
- The business owner is `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('account_owner')`. (Locked: feedback is owner-only-readable; team members below owner do NOT read feedback in v1 — see Open Question OQ-2.)

---

## 3. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---------|----------|---------------------------|
| 1 | Consumer iOS (`app-mobile/`) | **NO** | Consumers never see venue-claim feedback. No analog. |
| 2 | Consumer Android | **NO** | Same. |
| 3 | Buyer/anon Web (`mingla-business` public routes) | **NO** | Anon buyers never see claim state. |
| 4 | Business iOS (`mingla-business/`) | **YES** | Tappable "In review" tile + badge + feedback sheet + mark-fixed + re-submit. Files §6. Parity with Android is **automatic** (shared RN code) EXCEPT the Sheet primitive (`Sheet.web.tsx` vs `SheetMobile.tsx`) — see SC per-surface. |
| 5 | Business Android | **YES** | Same shared RN code; SC-BIZ-* apply to both. Android opaque-glass policy applies to the sheet fill (memory `project_android_glass_policy_opaque_fallback.md`). |
| 6 | Admin Web (`mingla-admin/`) — adjacent | **YES** | Feedback authoring panel inside the existing claim modal. Files §5. |
| 7 | Business Web preview (`mingla-business` dev/web) — adjacent | **YES (inherits)** | Same business components render on narrow web; the Sheet resolves to `Sheet.web.tsx`. Must not regress (ORCH-0964 self-import hazard). SC-BIZ-WEB. |

**Manual-parity flags:** Business iOS vs Android vs Web all use shared components, so SCs are written once (SC-BIZ-N) and apply to all three; the ONE divergence is the Sheet platform-resolution (native `SheetMobile` vs `Sheet.web`), so SC-BIZ-7 has explicit iOS/Android/Web sub-criteria.

---

## 4. BACKEND LAYER

### 4.1 Migration

**File:** `supabase/migrations/20260901000000_orch_1063_venue_claim_feedback.sql`
**Version allocation (proven):** remote max = `20260831000000` (META-ORCH-1062, confirmed via `schema_migrations` live probe). Max across ALL sibling worktrees = `20260831000000` (this worktree; next highest sibling = `20260829000000`). **`20260901000000` is strictly greater than every observed version.** 🔒 LOCKED — do not reuse a lower or colliding timestamp.

> ⚠ **ID-collision note for the orchestrator (NOT this SPEC's lane):** a sibling worktree `~/Desktop/mingla-orchs/ORCH-1063-[sheet-nav-freeze-class]` also claims ORCH-1063. Per COMMS-0004/COMMS-0011 the orchestrator must renumber one before close. The migration filename uses a TIMESTAMP (`20260901000000`), not the ORCH-ID, so there is no migration-file collision regardless of how the ID dispute resolves. See OQ-1.

> ORCH-0863 backend-allowlist requirement (COMMS-0002): this migration is a NEW `supabase/migrations/*` file → it WILL trip C7 `no-new-backend-files`. The implementor MUST add an `ORCH_1063_BACKEND_ALLOWLIST` const listing this migration path to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` **in the same commit** (mirror `ORCH_0101_VE3_BACKEND_ALLOWLIST` ln 323–330). No new `supabase/functions/*` file is created (the new RPCs reuse the existing `admin-review-venue-claim` wrapper for the admin call; the business calls go direct via `supabase.rpc`), so only the migration path needs allowlisting.

#### 4.1.1 Table `public.venue_claim_feedback` 🔒 LOCKED

Single-table model (justification below). Each row is ONE feedback item; an overall message is carried per-round. To avoid a second `feedback_rounds` table while keeping round semantics, the overall message is stored on the **first item of each round** via a nullable `overall_message` column and a `round` integer groups items. **Justification for single-table over round-table:** rounds are cheap (a per-brand integer), volume is tiny (a handful of items per claim, claims are rare — 1 pending today), and the admin always writes a whole round atomically in one RPC call, so a separate rounds table adds a join + FK + RLS surface for no query benefit. The `round` integer + `is_active_round` view (4.1.3) gives history + "current round" cleanly. (If a future ORCH needs per-round metadata beyond `overall_message`, promote to a rounds table then.)

```sql
-- ORCH-1063 [admin↔business venue-listing feedback loop]
-- Structured feedback the admin leaves on a pending venue claim; the business
-- reads its OWN feedback, marks items fixed, and re-submits.
--
-- Docs (COMMS-0003 external-API-cited):
--   RLS:           https://supabase.com/docs/guides/database/postgres/row-level-security
--   SECURITY DEFINER + search_path:
--                  https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw
--   pgTAP testing: https://supabase.com/docs/guides/local-development/testing/pgtap-extended
--
-- Additive only: one new table + one view + three new RPCs (CREATE OR REPLACE).
-- No mutation of existing tables, so no abort-on-existing-rows risk; no data
-- probe required for the DDL (the brands/claim probe is recorded in the SPEC).

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
  'ORCH-1063 — structured admin→business feedback on a venue claim. One row per '
  'item (category+note); overall_message rides the round''s first item; round '
  'groups items per admin pass; status open/fixed; business reads only its own '
  'brand''s rows via biz_brand_effective_rank_for_caller owner predicate.';

alter table public.venue_claim_feedback enable row level security;
```

#### 4.1.2 RLS policies 🔒 LOCKED

Mirror brands owner-RLS (F-5). Admin writes (gated by `is_admin_user()`); brand owner reads ONLY their brand's rows; brand owner UPDATEs ONLY the `status`→`fixed` flip (enforced via the RPC, but a defensive owner-UPDATE policy is also granted so the RPC could run as invoker — we instead route status changes through a SECURITY DEFINER RPC, so the table needs only SELECT for owners and ALL for admins).

```sql
-- Admin: full read/write (the admin console + the SECURITY DEFINER RPCs run as
-- definer; this policy also lets an admin directly read rows in the admin app).
create policy "admin manages venue_claim_feedback"
  on public.venue_claim_feedback
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

-- Brand owner: SELECT only its own brand's feedback. Mirrors how brand-owned
-- rows are gated elsewhere (biz_brand_effective_rank_for_caller >= account_owner).
create policy "owner reads own venue_claim_feedback"
  on public.venue_claim_feedback
  for select to authenticated
  using (
    public.biz_brand_effective_rank_for_caller(brand_id)
      >= public.biz_role_rank('account_owner')
  );
```

> The business mark-fixed + re-submit are done through SECURITY DEFINER RPCs (4.1.4–4.1.5) which re-assert the owner predicate themselves, so NO owner-INSERT/UPDATE/DELETE policy is granted on the table — writes are RPC-only, reads are policy-gated. This keeps the table write-locked except via the audited RPC paths (Constitution #2: one owner per truth).

#### 4.1.3 Helper view `venue_claim_active_feedback` 🔵 (convenience, optional but recommended)

```sql
-- The current (max) round's items per brand, for the business sheet's primary list.
create or replace view public.venue_claim_active_feedback
with (security_invoker = true) as
  select f.*
  from public.venue_claim_feedback f
  where f.round = (
    select max(f2.round) from public.venue_claim_feedback f2 where f2.brand_id = f.brand_id
  );
```
`security_invoker = true` so the view inherits the caller's RLS (owner predicate) — no privilege leak. (Docs: RLS guide above.)

#### 4.1.4 RPC `admin_add_venue_claim_feedback` 🔒 LOCKED

```sql
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

  -- Next round = max existing + 1 (1 if none).
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
  update public.brands
     set claim_follow_up_at = now()
   where id = p_brand_id;

  return jsonb_build_object('ok', true, 'round', v_round, 'item_count', v_count);
end;
$function$;

revoke all on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) to authenticated;

comment on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) is
  'ORCH-1063 — admin-gated. Writes a fresh feedback round (items + optional '
  'overall_message on the first item) for a pending_review claim and stamps '
  'claim_follow_up_at. Returns {round, item_count}.';
```

> **Why the RPC sets `claim_follow_up_at` directly instead of calling `biz_review_venue_claim('need_more_info')`:** the existing RPC's only `need_more_info` side-effect IS `claim_follow_up_at = now()` (F-1). Re-invoking it from a SECURITY DEFINER context would double-gate `is_admin_user` (harmless) but adds a nested RPC call for one UPDATE. The edge wrapper (§5.2) calls this RPC; the claim is already `pending_review` (guarded above), so the transition is exactly the timestamp stamp. **Invariant I-1063-FEEDBACK-IMPLIES-FOLLOWUP:** every successful `admin_add_venue_claim_feedback` leaves `claim_follow_up_at` non-null. The push is fired by the edge wrapper (§5.2), NOT the RPC.

#### 4.1.5 RPC `biz_mark_feedback_item_fixed` 🔒 LOCKED

```sql
create or replace function public.biz_mark_feedback_item_fixed(
  p_feedback_id uuid,
  p_fixed       boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row     public.venue_claim_feedback%rowtype;
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
  'ORCH-1063 — brand-owner-gated. Toggles a feedback item status open/fixed '
  '(sets/clears resolved_at). Owner predicate = biz_brand_effective_rank_for_caller '
  '>= account_owner.';
```

#### 4.1.6 RPC `biz_resubmit_venue_claim` 🔒 LOCKED

```sql
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
  v_open_count   integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_brand from public.brands b
   where b.id = p_brand_id and b.deleted_at is null;
  if not found then raise exception 'brand_not_found'; end if;

  if public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('account_owner') then
    raise exception 'forbidden';
  end if;

  -- Guard: only a claim currently awaiting business action can be re-submitted,
  -- and only if a feedback round actually exists (pending feedback).
  if v_brand.claim_status <> 'pending_review' or v_brand.claim_follow_up_at is null then
    raise exception 'not_awaiting_resubmit';
  end if;

  select max(round) into v_active_round
    from public.venue_claim_feedback where brand_id = p_brand_id;
  if v_active_round is null then
    raise exception 'no_feedback_to_resubmit';
  end if;

  -- Flip back to a clean pending_review for re-review: clear the follow-up stamp
  -- so the banner reverts to plain "in review" and the admin queue shows it fresh.
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
  'ORCH-1063 — brand-owner-gated. Re-submits a claim that received feedback: '
  'clears claim_follow_up_at so it returns to the admin Pending queue as a fresh '
  'pending_review. Guards: must be pending_review WITH a follow-up stamp AND >=1 '
  'feedback round. The next admin pass opens a new round.';
```

> **Round/state model clarification (LOCKED):** the claim NEVER leaves `claim_status='pending_review'` during the feedback loop — `need_more_info` is modeled as `pending_review + claim_follow_up_at IS NOT NULL` (the existing META-ORCH-1062 convention, F-1/F-3). `admin_add_…` sets the stamp; `biz_resubmit_…` clears it. This is faithful to the existing schema (there is no separate `need_more_info` enum value on `brands.claim_status` — it's only an *action* in `biz_review_venue_claim`). The "round" lives entirely in `venue_claim_feedback.round`. History is preserved because re-submit does NOT delete prior rounds; the next `admin_add_…` simply increments `max(round)+1`.

```sql
-- ORCH-1063 — reload PostgREST schema cache so the new RPCs/view are exposed.
notify pgrst, 'reload schema';
```

### 4.2 Edge function change (NO new file)

**File (MODIFY):** `supabase/functions/admin-review-venue-claim/index.ts` — add an early-return action branch `add_feedback` (mirroring the existing `tweak_fields` / `score_override` early branches at ln 257–304). This:
1. Re-uses the admin gate (ln 239–246) already at the top.
2. Calls `admin_add_venue_claim_feedback` via `userClient.rpc` (so `auth.uid()` is the admin; the RPC re-asserts `is_admin_user`).
3. Writes an `admin_audit_log` row (`action: 'venue_claim_feedback'`, `target_type:'venue_claim'`, `target_id: brandId`, `metadata: { round, item_count }`).
4. Fires the business push via `sendPush` (F-2 fix): owner lookup via `admin.auth.admin.getUserById(brand.account_id)` is NOT needed — push targets `brand.account_id` directly (the OneSignal external_id). Look up `brands.account_id` + `name` with the service client.

**Push copy (LOCKED):** title `"Your venue listing needs a few updates"`, body `"${brandName}: tap to see what to fix and re-submit."`, `data: { type:'venue_claim_feedback', brand_id, round }`, `androidChannelId:'system'`.

**`verify_jwt` preserved** — this fn already requires `authorization` (ln 231) and is admin-gated; do not add `--no-verify-jwt`. No `config.toml`/dispatch change.

> **Why route the admin call through the edge fn but the business calls direct?** The admin feedback submit needs the push side-effect + audit row (server-only, service-role) — exactly what the existing wrapper provides. The business mark-fixed/re-submit are pure RLS-safe owner writes with no server-only side-effect, so they call `supabase.rpc(...)` directly from the app (no edge fn needed), matching how the business already reads claim status directly (`fetchVenueClaimStatus`).

### 4.3 Backend success criteria

- **SC-BE-1** `admin_add_venue_claim_feedback(brand, [{category,note}×N], msg)` by an admin on a `pending_review` brand inserts N rows at `round = max+1`, puts `msg` on the first item's `overall_message`, stamps `claim_follow_up_at`, returns `{round, item_count:N}`.
- **SC-BE-2** Same RPC by a NON-admin raises `forbidden` (no rows written).
- **SC-BE-3** Invalid category or empty note raises `invalid_category` / `note_required`; transaction rolls back (zero partial rows).
- **SC-BE-4** Calling on a `verified` or `rejected` brand raises `brand_not_pending_review`.
- **SC-BE-5** `biz_mark_feedback_item_fixed(id, true)` by the brand owner sets `status='fixed'` + `resolved_at=now()`; by a non-owner raises `forbidden`.
- **SC-BE-6** `biz_resubmit_venue_claim(brand)` by the owner on a `pending_review`+`follow_up`+≥1-round claim clears `claim_follow_up_at` and returns `{claim_status:'pending_review', resubmitted_round}`; a subsequent `admin_add_…` creates `round = previous+1` (history preserved — prior round rows still present).
- **SC-BE-7** `biz_resubmit_venue_claim` raises `not_awaiting_resubmit` when `claim_follow_up_at IS NULL`, and `no_feedback_to_resubmit` when no feedback rows exist; `forbidden` for a non-owner.
- **SC-BE-8** Owner SELECT on `venue_claim_feedback` returns ONLY their brand's rows; a different authenticated user gets zero rows (RLS). Anon gets zero (no grant).

---

## 5. ADMIN UI (mingla-admin)

### 5.1 Component changes

**File (MODIFY):** `mingla-admin/src/pages/ClaimsPage.jsx` — add a **Feedback** authoring panel inside the existing claim `<Modal>` (the META-ORCH-1062 modal, ln 421–890), in the `{isPending ? (…)}` "Admin adjustments" block (ln 655–773) or as a sibling block directly below it. Reuse the existing `<Button>`, `<Badge>`, `<Spinner>` primitives and the Tailwind token classes already in the file.

**UI contract (🔒 LOCKED structure / 🎨 OPEN exact micro-styling within the file's existing token vocabulary):**

- A section header `Feedback to business` (matching the `text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide` header style at ln 657).
- **Add-item row(s):** a category `<select>` (the 7 enum values with human labels — Photos / Address / Hours / Category / Description / Quality / Other) + a `note` text `<input>` + an "Add item" button that appends to a local `feedbackItems` array (draft state). Each staged item renders as a removable chip/row showing `category · note`.
- **Overall message:** a `<textarea>` (optional), placeholder `"Optional message to the business (one per round)."`.
- **Submit button** `Send feedback` (variant `secondary` or `primary`) — disabled when `feedbackItems.length === 0` or `acting`. Calls `addClaimFeedback(detail.id, feedbackItems, overallMessage)` (new service fn §5.2) → on success: toast `Feedback sent`, `logAdminAction('claim.add_feedback', …)`, `closeDetail()` + `load()` (the claim now shows the `Follow-up requested` badge that already exists at ln 438–440).
- **Current round display:** below the authoring form, render the active round's items (fetched via the bundle extension §5.3) grouped/listed with each item's category + note + an `Open`/`Fixed` `<Badge>` (`variant="warning"` for open, `variant="success"` for fixed) so the admin sees what the business has addressed. Read-only on the admin side (admin doesn't toggle fixed).
- States: **empty** (no feedback yet) → just the authoring form; **submitting** → button shows disabled + spinner; **error** → toast (existing `addToast({variant:'error'})` pattern); **populated** → authoring form + current-round list with statuses.

**No-AI-slop:** reuse the file's existing dark-console token palette (`--color-brand-500`, `--color-text-*`, `white/5` surfaces); no new gradients, no emoji icons (the file uses `lucide-react` — use `MessageSquarePlus` or `ListChecks` for the section icon if an icon is wanted). **References examined:** the existing META-ORCH-1062 "Admin adjustments" tweak/override block in this same file (the canonical local pattern); Linear/Height issue-comment composers (category-tag + note rows).

### 5.2 Admin service layer

**File (MODIFY):** `mingla-admin/src/services/adminClaimsService.js` — add:

```js
/** ORCH-1063 — admin sends a feedback round; routed through the edge wrapper
 *  (action:"add_feedback") so the push + admin_audit_log fire server-side. */
export async function addClaimFeedback(brandId, items, overallMessage) {
  const { data, error } = await supabase.functions.invoke("admin-review-venue-claim", {
    body: { brand_id: brandId, action: "add_feedback", items, overall_message: overallMessage ?? null },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data; // { ok, round, item_count }
}
```

### 5.3 Bundle extension (read the current round in the modal)

**File (MODIFY):** `supabase/migrations/20260901000000…` — extend `admin_get_claim_review_bundle` (CREATE OR REPLACE in the SAME new migration, AFTER the META-ORCH-1062 definition is current) to add a `'feedback'` key: the active round's items (`id, category, note, overall_message, status, created_at, resolved_at, round`). This keeps the modal's single round-trip. The admin RPC already runs admin-gated, so this is a privilege-safe join. **Alternatively** (🎨 OPEN — implementor's call) add a small `listClaimFeedback(brandId)` service fn calling a new admin-gated `admin_list_venue_claim_feedback(brand)` RPC if extending the bundle is undesirable; either satisfies SC-ADMIN-3.

### 5.4 Admin success criteria

- **SC-ADMIN-1** In a pending claim modal, an admin can stage ≥1 item (category+note), add an optional message, and tap `Send feedback`; on success a toast confirms and the claim closes + reloads with the `Follow-up requested` badge.
- **SC-ADMIN-2** `Send feedback` is disabled with zero staged items.
- **SC-ADMIN-3** The modal shows the active round's items with per-item `Open`/`Fixed` status badges (read-only on admin side).
- **SC-ADMIN-4** Submitting routes through `admin-review-venue-claim` (`add_feedback`), writes an `admin_audit_log` row, and the business push is sent (`push_sent:true` in the response when OneSignal creds present).

---

## 6. BUSINESS UI (mingla-business)

### 6.1 THE "In review" tile (exact file)

**File (MODIFY):** `mingla-business/src/components/brand/VenueClaimStatusBanner.tsx` — mounted at `mingla-business/app/(tabs)/hub/_layout.tsx:179`. This is the venue listing's "In review" tile. Currently a non-interactive `<View>` (F-3).

Changes:
1. When `variant === 'follow_up'`, render the tile as a **pressable** (`<Pressable>`/`<TouchableOpacity>`) with a **Feedback button** affordance and an **open-count badge** (count of `status='open'` items in the active round). Tap → opens the feedback sheet (§6.2).
2. New `follow_up` copy (F-3 fix — must differ from plain pending): title `"Updates requested"`, body `"The Mingla team asked for a few changes. Tap to see what to fix and re-submit."` (update `venueClaimBannerCopy` in `venueClaimBannerLogic.ts`).
3. `pending_review`, `verified`, `rejected` variants stay non-interactive Views (no behavior change).

**🔒 LOCKED:** the `follow_up` tile must (a) be tappable, (b) show a numeric open-count badge when ≥1 open item, (c) use the existing `semantic.warning*` tone tokens + `typography`/`spacing`/`radius` tokens already in the file (no magic numbers, no new colors), (d) have `accessibilityRole="button"` + `accessibilityLabel="Venue updates requested, tap to review feedback"`, (e) respect safe-area via its parent (the Hub layout already insets). **🎨 OPEN:** badge shape/placement, press-feedback animation (within the Android opaque-glass policy), icon choice.

### 6.2 The feedback sheet

**File (NEW):** `mingla-business/src/components/brand/VenueClaimFeedbackSheet.tsx` — uses the canonical `Sheet` primitive (`mingla-business/src/components/ui/Sheet` → `SheetMobile`/`Sheet.web`), `snapPoint="half"` (or `"full"` if many items), `visible`/`onClose` props. Contents:

- Header: brand name + "Updates requested".
- Optional **overall message** banner (the round's `overall_message`) if present.
- **Items grouped by category** (Photos / Address / Hours / Category / Description / Quality / Other), each item showing its note + a **Mark fixed** toggle (a `Switch` or a pill button) reflecting `status`. Toggling calls `markFeedbackItemFixed(id, next)` (§6.3) with optimistic update + rollback on error.
- A pinned **Re-submit for review** CTA at the bottom — **enabled** when all open items are addressed (or per OQ-3 policy: enabled when ≥1 item fixed / always enabled — see Open Question). Tap → `resubmitVenueClaim(brandId)` → on success toast "Re-submitted — we'll take another look", close sheet, invalidate `brandKeys.detail` + the feedback query so the tile reverts to plain pending.
- All 9 states: **loading** (spinner "Loading feedback…"), **error** (inline retry), **empty** (shouldn't happen if badge>0, but show "No open items — you're all set. Re-submit when ready."), **populated**, **submitting** (CTA disabled + spinner), **offline** (toast "You're offline — changes will retry"), **first-time/returning/degraded** (same populated layout).

**🔒 LOCKED:** category grouping; per-item Open/Fixed toggle wired to `biz_mark_feedback_item_fixed`; Re-submit CTA wired to `biz_resubmit_venue_claim`; design-system tokens only; Android opaque-glass sheet fill (memory policy); thumb-zone CTA. **🎨 OPEN:** exact toggle component, group header styling, animation, copy micro-polish within Mingla voice.

> This sheet's full granular visual contract (tokens, contrast, typography, spacing, motion, all-9-states copy) is delegated to a `mingla-designer` DESIGN pass per the granularity protocol — **the implementor must NOT free-hand the visuals.** REQUIRED design artifact: `Mingla_Artifacts/specs/DESIGN_ORCH-1063_VENUE_CLAIM_FEEDBACK_SHEET.md`. The functional contract above is binding regardless.

### 6.3 Business data layer

**File (MODIFY):** `mingla-business/src/services/venueClaimService.ts` — add:
- `fetchVenueClaimFeedback(brandId): Promise<FeedbackItem[]>` — `supabase.from('venue_claim_active_feedback').select('*').eq('brand_id', brandId)` (owner-RLS-gated view) ordered by category then created_at.
- `markFeedbackItemFixed(id, fixed): Promise<…>` — `supabase.rpc('biz_mark_feedback_item_fixed', { p_feedback_id:id, p_fixed:fixed })`.
- `resubmitVenueClaim(brandId): Promise<…>` — `supabase.rpc('biz_resubmit_venue_claim', { p_brand_id:brandId })`.

**File (NEW):** `mingla-business/src/hooks/useVenueClaimFeedback.ts` — React Query hook:
- Query key: `brandKeys` family extension — add `feedback: (brandId) => [...brandKeys.all, 'feedback', brandId]` to `useBrands.ts`'s `brandKeys` factory (Constitution #4: one key per entity, from the factory).
- `enabled`: only when the brand's `claimFollowUpAt` is set (i.e., `follow_up` variant) — no wasted fetches for plain pending/verified/rejected.
- `markFixed` mutation → optimistic toggle, `onError` rollback + toast, `onSettled` invalidate the feedback key.
- `resubmit` mutation → `onSuccess` invalidate `brandKeys.detail(brandId)` + `brandKeys.list(accountId)` + the feedback key (the tile reverts).
- Open-count derived selector for the tile badge.

**File (MODIFY):** `mingla-business/src/hooks/useVenueClaimRefresh.ts` — on app foreground, also invalidate the new `brandKeys.feedback` key for the current brand (so a fresh admin round shows without restart). Mirror the existing detail invalidation (ln 28–33).

### 6.4 Business success criteria

- **SC-BIZ-1** When a claim is in `follow_up`, the Hub "In review" tile shows the new "Updates requested" copy + a numeric open-count badge and is tappable.
- **SC-BIZ-2** Tapping opens the feedback sheet listing items grouped by category, each with its note + an Open/Fixed toggle, plus any overall message.
- **SC-BIZ-3** Toggling an item to Fixed persists (`biz_mark_feedback_item_fixed`), reflects optimistically, and the admin modal then shows that item as `Fixed`.
- **SC-BIZ-4** The Re-submit CTA, when enabled, calls `biz_resubmit_venue_claim`; on success the claim returns to plain `pending_review`, the tile reverts to "being reviewed", and the claim reappears in the admin Pending queue.
- **SC-BIZ-5** A business user who is NOT the brand owner cannot mark-fixed or re-submit (RPC `forbidden`) and the owner-RLS view returns no other brand's feedback.
- **SC-BIZ-6** All 9 sheet states render with Mingla-voice copy.
- **SC-BIZ-7 (per-surface parity):**
  - **SC-BIZ-7-iOS** Sheet opens via native `SheetMobile`, drag-to-dismiss works, safe-area respected.
  - **SC-BIZ-7-Android** Same shared code; sheet fill is opaque per the Android glass policy; back-gesture closes.
  - **SC-BIZ-7-Web** Business dev/web build resolves `Sheet.web.tsx` without the ORCH-0964 self-import recursion; sheet renders and the page does not blank.

---

## 7. NOTIFICATIONS

- **Push on admin feedback submit** → business owner (`brand.account_id`) via `sendPush` from the `add_feedback` edge branch (§4.2). Title `"Your venue listing needs a few updates"`, deep-link data `{ type:'venue_claim_feedback', brand_id, round }`. (ORCH-1030 deep-linking, if landed on base, can route this to the Hub tile — out of scope to wire here; the `data.type` is set so a future handler can.)
- **No push to admin on re-submit** (locked) — the re-submitted claim naturally reappears in the admin Pending queue (it's `pending_review` with `claim_follow_up_at` cleared). The admin queue's `listPendingClaims` already filters `claim_status='pending_review'`.

---

## 8. Invariants

- **I-1063-FEEDBACK-IMPLIES-FOLLOWUP** (NEW): a successful `admin_add_venue_claim_feedback` always leaves `claim_follow_up_at` non-null on the brand. Test: T-BE-1 asserts the stamp post-call.
- **I-1063-FEEDBACK-OWNER-READ** (NEW): `venue_claim_feedback` is readable only by an admin or the brand owner (`biz_brand_effective_rank_for_caller >= account_owner`); anon and other users get zero rows. Test: T-BE-8.
- **I-1063-RPC-WRITES-ONLY** (NEW): `venue_claim_feedback` has NO owner INSERT/UPDATE/DELETE policy — all business writes go through the two SECURITY DEFINER RPCs. Test: a direct owner `UPDATE … SET status='fixed'` from the client is denied; the RPC path succeeds.
- **I-ADMIN-WRITE-GATED** (preserved, META-ORCH-1062): every new admin RPC re-asserts `is_admin_user()` server-side. Test: T-BE-2.
- **I-SCORER-INVOKE-HAS-SIGNAL-ID** (preserved): untouched — this ORCH adds no scorer call.
- **verify_jwt preserved** on `admin-review-venue-claim`: no dispatch/config change. Test: grep + deploy config unchanged.
- **Constitution #2 (one owner per truth):** the claim's `need_more_info` state stays modeled as `pending_review + claim_follow_up_at` (no new competing status column). #4 (one key per entity): `brandKeys.feedback`. #3 (no silent failures): every mutation has `onError`. #5: admin response surfaces `{round,item_count,push_sent}`.

---

## 9. Test cases (Step 0.5: happy-path + adversarial per phase)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-BE-1 (happy)** | Admin adds a round | admin uid, pending brand, `[{photos,"add interior"},{hours,"confirm Sun"}]`, msg | 2 rows at round 1, msg on item 1, `claim_follow_up_at` set, returns `{round:1,item_count:2}` | DB RPC |
| **T-BE-2 (adversarial)** | Non-admin adds feedback | non-admin uid | `forbidden`, 0 rows | RLS/RPC |
| **T-BE-3 (edge)** | Bad category / empty note | `[{foo,"x"}]` / `[{photos,"  "}]` | `invalid_category` / `note_required`, full rollback | DB RPC |
| **T-BE-4 (adversarial)** | Feedback on verified brand | verified brand | `brand_not_pending_review` | DB RPC |
| **T-BE-5 (happy)** | Owner marks item fixed | owner uid, item id | `status='fixed'`, `resolved_at` set | DB RPC |
| **T-BE-6 (adversarial)** | Non-owner marks fixed | other user's uid | `forbidden`, status unchanged | DB RPC |
| **T-BE-7 (happy)** | Owner re-submits | owner uid, pending+follow_up+round | `claim_follow_up_at` cleared, returns pending_review; next admin round = 2 (round 1 preserved) | DB RPC |
| **T-BE-8 (adversarial)** | Re-submit guards / RLS read | follow_up null / no rows / non-owner / cross-brand SELECT | `not_awaiting_resubmit` / `no_feedback_to_resubmit` / `forbidden` / 0 rows | DB RPC + RLS |
| **T-AD-1 (happy)** | Admin UI send | stage 2 items + msg, Send | toast, audit row, `push_sent:true`, badge appears | Admin full-stack |
| **T-AD-2 (adversarial)** | Send with 0 items | empty draft | button disabled; if forced, RPC `items_required` | Admin |
| **T-BIZ-1 (happy)** | Business sees + fixes + resubmits | follow_up tile → sheet → toggle fixed → Re-submit | tile copy "Updates requested" + badge; sheet grouped; toggle persists; re-submit reverts tile + reappears in admin Pending | Business full-stack |
| **T-BIZ-2 (adversarial)** | Offline toggle | airplane mode toggle | optimistic flips then rolls back on error + toast; no phantom fixed | Business hook+UI |
| **T-BIZ-3 (parity)** | iOS + Android + web sheet | open sheet on each | renders; web does not blank (ORCH-0964); Android fill opaque | Business cross-surface |

**Revert-proof gate (Step 0.5):** the happy-path pgTAP/deno test (`orch_1063_feedback_loop`) AND an adversarial test (`orch_1063_feedback_owner_rls.adversarial`) must each FAIL when the migration/RPC is reverted.

---

## 10. Implementation order

1. **DB migration** `20260901000000_orch_1063_venue_claim_feedback.sql` (table + RLS + view + 3 RPCs + `admin_get_claim_review_bundle` feedback extension + `notify pgrst`). Add `ORCH_1063_BACKEND_ALLOWLIST` to the ORCH-0863 strict-grep gate in the SAME commit.
2. **pgTAP/deno tests** for SC-BE-1…8 (+ revert-proof).
3. **Edge fn** `admin-review-venue-claim/index.ts` `add_feedback` branch + push + audit; `reviewLogic.ts` push copy if centralized there. (No new function file → no `config.toml` change.)
4. **Admin service** `addClaimFeedback` + **ClaimsPage.jsx** feedback panel + current-round list.
5. **Business service** (`fetchVenueClaimFeedback`/`markFeedbackItemFixed`/`resubmitVenueClaim`) + `brandKeys.feedback` + `useVenueClaimFeedback` hook + `useVenueClaimRefresh` invalidation.
6. **Business UI:** `venueClaimBannerLogic.ts` copy, `VenueClaimStatusBanner.tsx` tappable + badge, new `VenueClaimFeedbackSheet.tsx` (after the `mingla-designer` DESIGN pass).
7. Tests T-AD-* + T-BIZ-* incl. cross-surface.

---

## 11. Regression prevention

- The revert-proof Step-0.5 tests catch removal of the feedback RPCs/RLS.
- `I-1063-FEEDBACK-OWNER-READ` + `I-1063-RPC-WRITES-ONLY` encoded as adversarial tests prevent an RLS-loosening regression (the classic "owner can read another brand's feedback" leak).
- Protective comments on the table + RPCs explain the `pending_review + follow_up = need_more_info` modeling so a future dev doesn't add a competing status column.
- The ORCH-0863 allowlist entry documents WHY the migration is exempt (mirrors VE3 precedent) so C7 stays green and isn't disabled wholesale.

---

## 12. Open questions (need operator steering)

- **OQ-1 (ID collision — orchestrator's lane, flag only):** a sibling worktree `~/Desktop/mingla-orchs/ORCH-1063-[sheet-nav-freeze-class]` also claims ORCH-1063. Per COMMS-0004/0011 one must renumber before close. This SPEC's migration uses a timestamp filename (`20260901000000`), so there's no file collision regardless — but the ORCH-ID on artifacts/branch needs orchestrator resolution.
- **OQ-2 (feedback read scope):** SPEC locks feedback reads to brand **owner** (`account_owner` rank). Should accepted **team members** (e.g., `event_manager`) also read/mark-fixed feedback? Default in this SPEC = owner-only; widening is a one-line predicate change (`>= biz_role_rank('viewer')` or similar). Confirm.
- **OQ-3 (Re-submit enablement):** when is the "Re-submit for review" CTA enabled? Options: (a) always enabled once ≥1 round exists; (b) enabled only when ALL open items are marked fixed; (c) enabled when ≥1 item fixed. SPEC writes the CTA wiring agnostically; default proposed = **(a) always enabled** (the business is the judge of "ready"; admin re-reviews anyway). Confirm the desired gate.
- **OQ-4 (overall_message on re-submit rounds):** locked that `overall_message` rides the round's first item. Confirm there's no need for a business-side reply field in v1 (currently a non-goal).

---

**End of SPEC — ORCH-1063.**
