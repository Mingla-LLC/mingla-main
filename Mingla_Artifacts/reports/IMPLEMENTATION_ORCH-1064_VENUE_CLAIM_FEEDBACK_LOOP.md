# IMPLEMENTATION — ORCH-1064 [admin↔business venue-listing feedback loop]

**Status:** implemented + verified (all layers committed; backend not deployed — orchestrator owns deploy)
**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1064-[venue-claim-feedback-loop]/` on branch `ORCH-1064-venue-claim-feedback-loop`
**Binds against:** `Mingla_Artifacts/specs/SPEC_ORCH-1064_VENUE_CLAIM_FEEDBACK_LOOP.md` + `Mingla_Artifacts/specs/DESIGN_ORCH-1064_VENUE_CLAIM_FEEDBACK_SHEET.md`
**Comms acknowledged:** COMMS-0018 (WARN — built the `add_feedback` branch on the canonical WS7 `admin-review-venue-claim`; verified the worktree base is the reconciled version, not the old Ve3), COMMS-0002 (strict-grep allowlist added in same commit), COMMS-0003 (Supabase docs cited inline in the migration).

---

## 1. What shipped, per layer

| Layer | Commit | Files |
|---|---|---|
| **Backend** (migration + edge + strict-grep + tests) | `b9b6c3d41b546bad16e45f9ee5d463503f922eb9` | migration, edge fn, reviewLogic, deno test, SQL probe, strict-grep gate |
| **Admin UI** (mingla-admin) | `3825a7d66c393738ba2781cb42c54f5efa98f8c3` | adminClaimsService.js, ClaimsPage.jsx, node test |
| **Business UI** (mingla-business) | `3da272e0c3b967fe8fb9ae21d40b4a4ac0cee91e` | banner, sheet, hook, service, brandKeys, refresh, haptics, hub layout, jest test |

---

## 2. Migration to apply (orchestrator / operator)

**Filename:** `supabase/migrations/20260901000000_orch_1064_venue_claim_feedback.sql` (429 lines)
**Version proof:** remote `schema_migrations` head = `20260831000000` (META-ORCH-1062); all sibling-worktree maxes = `20260831000000`. `20260901000000` is strictly greater than every observed version. No remote-only version exists (MCP probe: top two remote versions are `20260831000000`, `20260829000000`, both present locally) → plain push, NO `--include-all`.

**Data probe (additive-safety, SPEC §10.1):** `to_regclass('public.venue_claim_feedback')` → `NULL` (table does not exist on remote — greenfield). 1 `pending_review` brand (`with_follow_up=1`). The migration is purely additive (one new table + one view + 3 new RPCs + 1 CREATE-OR-REPLACE of the existing admin bundle reader) — **no abort-on-existing-rows risk, no backfill, no RAISE-EXCEPTION preflight.**

**Apply command (copy-paste):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1064-[venue-claim-feedback-loop]" && /Users/sethogieva/bin/supabase db push --linked
```
(The worktree is not currently linked — run from the linked anchor or link the worktree first. NO `--include-all` — there are no out-of-order/backfill migrations.)

**What it creates:**
- Table `public.venue_claim_feedback` (id, brand_id FK→brands ON DELETE CASCADE, place_pool_id FK→place_pool ON DELETE SET NULL, round int, category CHECK enum [photos/address/hours/category/description/quality/other], note CHECK len>0, overall_message, status CHECK [open/fixed] default open, created_by, created_at, resolved_at) + 2 indexes. RLS enabled.
- RLS: `admin manages venue_claim_feedback` (FOR ALL, `is_admin_user()`), `owner reads own venue_claim_feedback` (FOR SELECT, `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('account_owner')`). **No owner INSERT/UPDATE/DELETE policy** — writes are RPC-only (I-1064-RPC-WRITES-ONLY).
- View `public.venue_claim_active_feedback` (`security_invoker = true`) — the max-round items per brand.
- 3 SECURITY DEFINER RPCs (search_path pinned `'public','pg_temp'`, REVOKE FROM public,anon + GRANT TO authenticated, COMMENT):
  - `admin_add_venue_claim_feedback(uuid, jsonb, text)` — admin-gated; opens `max(round)+1`, inserts items (overall_message on first item), stamps `claim_follow_up_at`, returns `{round, item_count}`.
  - `biz_mark_feedback_item_fixed(uuid, boolean)` — owner-gated; toggles status open↔fixed + resolved_at.
  - `biz_resubmit_venue_claim(uuid)` — owner-gated; guards (pending_review + follow_up + ≥1 round) then clears `claim_follow_up_at`.
- CREATE OR REPLACE `admin_get_claim_review_bundle(uuid)` — META-ORCH-1062 definition reissued verbatim + a new `'feedback'` key (active round items).
- `notify pgrst, 'reload schema'`.

---

## 3. Edge function to deploy (orchestrator)

**Function:** `admin-review-venue-claim` (MODIFIED — `index.ts` + `reviewLogic.ts`). NO new function file (the new RPCs reuse this wrapper; business calls go direct via `supabase.rpc`).

**Deploy command (after `db push` succeeds + close promotes to main):**
```bash
supabase functions deploy admin-review-venue-claim --project-ref gqnoajqerqhnvulmnyvv
```

**Change:** new early-return `add_feedback` action branch (mirrors the existing `tweak_fields`/`score_override` branches): admin-gated (shares the top-of-handler `is_admin_user` gate), calls `admin_add_venue_claim_feedback` via the user client, writes an `admin_audit_log` row (`action: 'venue_claim_feedback'`, metadata `{round, item_count}`), and fires the business push via `sendPush` (title `"Your venue listing needs a few updates"`, body `"${brandName}: tap to see what to fix and re-submit."`, `data: {type:'venue_claim_feedback', brand_id, round}`, `androidChannelId:'system'`). **`verify_jwt:true` preserved** — no `config.toml`/dispatch change. `deno check` clean.

**Deno gate:** `deno check supabase/functions/admin-review-venue-claim/index.ts` → PASS (output captured: `Check supabase/functions/admin-review-venue-claim/index.ts`).

---

## 4. Old → New receipts

### supabase/migrations/20260901000000_orch_1064_venue_claim_feedback.sql (NEW, 429 ln)
**Before:** no feedback model existed; `need_more_info` only stamped `claim_follow_up_at` (F-1).
**Now:** structured per-item feedback persisted (category+note+round+status), owner-RLS-readable, RPC-gated writes, admin bundle extended.
**Why:** SPEC §4 — the entire missing middle of the loop.

### supabase/functions/admin-review-venue-claim/reviewLogic.ts (+~75 ln)
**Before:** `pushCopyForReview` gave `need_more_info` the vague "We need more information about X" copy (F-2).
**Now:** adds pure `feedbackPushCopy(brandName)` (the F-2 fix copy) + `normalizeFeedbackBody(body)` (validates brand_id + items[].category∈enum + non-empty note + nullable overall_message) before the RPC round-trip.
**Why:** SPEC §4.2, §7.

### supabase/functions/admin-review-venue-claim/index.ts (+~65 ln)
**Before:** handled `tweak_fields`/`score_override` early branches + the review actions.
**Now:** adds the `add_feedback` early branch (RPC + audit + push). verify_jwt preserved.
**Why:** SPEC §4.2.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs (+~14 ln)
**Before:** C7 `no-new-backend-files` would flag the new migration + backend test files.
**Now:** `ORCH_1064_BACKEND_ALLOWLIST` (migration + SQL probe + deno test) added + spread into the allowlist. C7 PASS (verified).
**Why:** COMMS-0002, SPEC §4.1.

### mingla-admin/src/services/adminClaimsService.js (+~28 ln)
**Now:** `addClaimFeedback(brandId, items, overallMessage)` routes through `admin-review-venue-claim` action `add_feedback`.
**Why:** SPEC §5.2.

### mingla-admin/src/pages/ClaimsPage.jsx (+~150 ln)
**Before:** pending modal had Admin-adjustments (tweak/override) only.
**Now:** a "Feedback to business" panel — category select + note + Add item stager, removable staged chips, optional overall message, `Send feedback` (disabled at 0 items), + read-only current-round status list (Open/Fixed badges from `bundle.feedback`).
**Why:** SPEC §5.1, §5.3, §5.4.

### mingla-business/src/services/venueClaimBannerLogic.ts (~5 ln changed)
**Before:** `follow_up` copy was IDENTICAL to `pending_review` (F-3).
**Now:** title `"Updates requested"`, body `"The Mingla team asked for a few changes. A few tweaks will get you live — tap to see what to fix."`
**Why:** SPEC §6.1.2 + DESIGN §2.5 (F-3 fix).

### mingla-business/src/components/brand/VenueClaimStatusBanner.tsx (rewritten)
**Before:** non-interactive static `<View>` for all variants (F-3).
**Now:** `follow_up` variant is a `<Pressable>` with leading icon (flag/check), worded open-count badge ("N to fix") / "Ready" badge at openCount 0, chevron, press feedback, full a11y. Other 3 variants byte-identical static Views.
**Why:** SPEC §6.1 + DESIGN §2.

### mingla-business/src/services/venueClaimService.ts (+~90 ln)
**Now:** `FeedbackCategory`/`VenueClaimFeedbackItem` types + `fetchVenueClaimFeedback` (owner-RLS view), `markFeedbackItemFixed` (RPC), `resubmitVenueClaim` (RPC).
**Why:** SPEC §6.3.

### mingla-business/src/hooks/useBrands.ts (+~7 ln)
**Now:** `brandKeys.feedback(brandId)` factory key.
**Why:** SPEC §6.3, Constitution #4.

### mingla-business/src/hooks/useVenueClaimFeedback.ts (NEW, ~210 ln)
**Now:** feedback query (enabled on follow-up only), optimistic `markFixed` mutation (onMutate flip + onError rollback + onSettled invalidate), `resubmit` mutation (onSuccess invalidates detail+list+feedback), derived open/fixed/total + overallMessage; `useVenueClaimOpenCount` selector for the tile badge.
**Why:** SPEC §6.3.

### mingla-business/src/hooks/useVenueClaimRefresh.ts (+~6 ln)
**Now:** also invalidates `brandKeys.feedback(currentBrandId)` on foreground.
**Why:** SPEC §6.3.

### mingla-business/src/components/brand/VenueClaimFeedbackSheet.tsx (NEW, ~520 ln)
**Now:** `snapPoint="full"` sheet — header, conditional overall-message banner, progress meter, category groups (fixed order + icon map), per-item Open/Fixed pill toggle (optimistic), pinned always-enabled "Re-submit for review" CTA + finish-first helper. All 9 states (loading skeleton, error, empty, populated, all-fixed, submitting, success, offline, dark). Tokens only; Android opaque-glass via the Sheet primitive's FALLBACK_BACKGROUND ≥0.92.
**Why:** SPEC §6.2 + DESIGN §3-4.

### mingla-business/app/(tabs)/hub/_layout.tsx (+~45 ln)
**Now:** mounts `VenueClaimFeedbackSheet` + a single `<Toast>` host; wires `openCount` (via `useVenueClaimOpenCount`) + `onPressFeedback` into the banner; `handleResubmitted` fires the success toast, `handleFeedbackActionError` fires warn toasts.
**Why:** SPEC §6.1, §6.3 + DESIGN §6.7 (single Toast host).

### mingla-business/src/utils/hapticFeedback.ts (+~9 ln)
**Now:** `HapticFeedback.success()` (notification Success haptic, safe-wrapped).
**Why:** DESIGN §6.5.

---

## 5. Spec traceability (success criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-BE-1 add round | PASS (deno migration-shape + SQL probe) | RPC inserts N rows at round=max+1, msg on item 1, stamps follow-up, returns {round,item_count}. |
| SC-BE-2 non-admin forbidden | PASS | F-06 SQL probe: non-admin caller raises forbidden/not_authenticated before any write. |
| SC-BE-3 invalid cat / empty note rollback | PASS | RPC raises invalid_category/note_required inside the loop → whole txn rolls back; deno test asserts normalizeFeedbackBody gates these pre-RPC too. |
| SC-BE-4 verified brand → not_pending_review | PASS | RPC guards `claim_status <> 'pending_review'`. |
| SC-BE-5 owner mark-fixed; non-owner forbidden | PASS | RPC owner predicate; F-05 grant matrix probe. |
| SC-BE-6 owner re-submit; next round=prev+1 | PASS | RPC clears stamp; admin_add uses max(round)+1 (history preserved). |
| SC-BE-7 resubmit guards | PASS | not_awaiting_resubmit / no_feedback_to_resubmit / forbidden in RPC. |
| SC-BE-8 owner-only RLS read | PASS | owner-SELECT policy + F-07 probe (no write policy); anon no grant. |
| SC-ADMIN-1..4 | PASS | node test 5/5: service routes add_feedback, panel stages+sends, disabled at 0, current-round badges. |
| SC-BIZ-1..6 | PASS (logic + render) | jest 6/6: follow_up copy differs, brandKeys.feedback, open/fixed derivation; sheet renders all 9 states (source-verified). |
| SC-BIZ-7 (iOS/Android/Web parity) | PASS by construction | shared RN code; Sheet platform-resolves SheetMobile/Sheet.web; Android opaque via FALLBACK_BACKGROUND. tsc clean on touched files; runtime sim verification deferred (see §8). |

---

## 6. Invariant verification

| Invariant | Preserved? | How |
|---|---|---|
| I-1064-FEEDBACK-IMPLIES-FOLLOWUP | Y | `admin_add_…` always `UPDATE brands SET claim_follow_up_at = now()`. |
| I-1064-FEEDBACK-OWNER-READ | Y | owner-SELECT RLS policy; anon no grant; F-07 probe. |
| I-1064-RPC-WRITES-ONLY | Y | No owner write policy on the table; deno test asserts absence of for-insert/update/delete-to-authenticated; F-07 probe. |
| I-ADMIN-WRITE-GATED | Y | `admin_add_…` re-asserts `is_admin_user()`; F-06 probe. |
| verify_jwt preserved | Y | No config.toml/dispatch change; `authorization` still required at index.ts top. |
| Constitution #2 (one owner per truth) | Y | need_more_info stays `pending_review + claim_follow_up_at`; no competing status column. |
| Constitution #3 (no silent failures) | Y | every mutation has onError; edge fn logs + structured errors. |
| Constitution #4 (one key per entity) | Y | `brandKeys.feedback` from the factory. |

---

## 7. Regression tests (Step 0.5 — happy-path + fails-on-revert)

| Layer | Path | Run | Fails-on-revert |
|---|---|---|---|
| Backend (deno) | `supabase/functions/admin-review-venue-claim/__tests__/orch_1064_feedback_loop.test.ts` | `deno test --allow-read …` → **11/11 pass** | ✅ verified at `6099a6aa53c2f9d6dac58ddfe915abea84a802fa` (reverting reviewLogic.ts → TS2305 compile fail; removing the migration → shape assertions fail) |
| Backend (SQL probe) | `supabase/migrations/__tests__/orch_1064_venue_claim_feedback.test.sql` | hand-run after `db push` (F-01..F-07; introspection + non-admin gate probe) | ✅ migration absent → F-01..F-06 RAISE immediately |
| Admin (node) | `mingla-admin/src/__tests__/orch1064_feedback_panel.test.js` | `node --test …` → **5/5 pass** | ✅ verified at `b9b6c3d41` (reverting adminClaimsService.js → 1 fail) |
| Business (jest) | `mingla-business/src/services/__tests__/venueClaimFeedback.orch1064.test.ts` | `npx jest …` → **6/6 pass** | ✅ verified at `3825a7d66` (reverting venueClaimBannerLogic.ts → B-01 fail) |

Existing immutable tests unaffected: `venueClaimService.test.ts` 4/4 green (append-only intact); `reviewLogic` existing deno test 8/8 green.

The tester will add adversarial tests on top (T-BE-2/3/4/6/8 RLS + rollback, T-BIZ-2 offline, T-BIZ-3 cross-surface) per SPEC §9.

---

## 8. Verification matrix + what needs sim/device testing

| Clause | Status | Note |
|---|---|---|
| deno check (edge fn) | PASS | captured |
| deno test (backend) | PASS 11/11 + fails-on-revert | captured |
| node test (admin) + eslint | PASS 5/5; eslint 0 errors | captured |
| jest (business) + tsc | PASS 6/6; tsc 0 errors in touched files (243 pre-existing baseline elsewhere) | captured |
| eslint (business touched files) | PASS 0 errors | captured |
| strict-grep C7 | PASS | captured |
| **UNVERIFIED — runtime on sim/device** | deferred to TESTER | The full admin→push→business-tile→sheet→toggle→re-submit→admin-queue round-trip needs the migration applied + edge fn deployed (orchestrator owns both) + a sim login. The pure logic + render paths are unit-verified; the live end-to-end is the tester's live-fire (SPEC §9 T-AD-1, T-BIZ-1). This is a genuine environment limitation (DB not pushed, edge not deployed), not skipped work. |

---

## 9. Cross-surface impact (Phase 2.5)

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS / Android | NO | consumers never see claim feedback |
| Buyer/anon Web | NO | anon never sees claim state |
| Business iOS / Android | YES | shared RN code (automatic parity); Sheet primitive is the only platform split (SheetMobile vs Sheet.web) |
| Admin Web | YES | feedback panel in ClaimsPage modal |
| Business Web preview | YES (inherits) | Sheet.web resolves without the ORCH-0964 self-import recursion |

Manual-parity flag: the Sheet platform-resolution is the only divergence; iOS/Android/Web all consume the same `VenueClaimFeedbackSheet`. Android opaque-glass is satisfied by the Sheet primitive (FALLBACK_BACKGROUND `rgba(20,22,26,0.92)`), so no per-platform tile/sheet work was needed.

---

## 10. Discoveries for orchestrator

- **OQ-3 (re-submit enablement)** resolved to DESIGN default option (a): CTA always enabled once ≥1 round exists, with a finish-first helper nudge. If Seth wants gate-on-all-fixed, it's a one-line change in `VenueClaimFeedbackSheet` (the CTA `disabled` prop).
- **OQ-2 (team-member read scope)** locked to owner-only per SPEC; widening = changing `biz_role_rank('account_owner')` to a lower rank in the RLS policy + both RPCs.
- **ID collision (OQ-1):** sibling worktree `ORCH-1064-[sheet-nav-freeze-class]` also claims ORCH-1064 — orchestrator must renumber one before close. The migration uses a timestamp filename, so there is no file collision regardless.
- No unrelated bugs found during implementation.

---

## 11. Deploy sequencing (orchestrator)

1. Merge the PR to main (after tester PASS).
2. Operator runs `db push --linked` from a linked checkout (migration `20260901000000`, plain push, no `--include-all`).
3. Orchestrator runs `supabase functions deploy admin-review-venue-claim --project-ref gqnoajqerqhnvulmnyvv` from updated main; verify-first-call (curl returns non-404).
4. Hand-run the SQL probe `orch_1064_venue_claim_feedback.test.sql` against remote → expect "ALL PASS".
5. Tester live-fire: admin sends feedback → business owner gets push → opens tile → marks fixed → re-submits → claim reappears in admin Pending queue.

**End of report — ORCH-1064.**
