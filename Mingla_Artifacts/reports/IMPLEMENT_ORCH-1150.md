# IMPLEMENTATION — ORCH-1150 [snap suggestions auto-draft + navigate to drafts]

**Skill:** mingla-implementor (business side) · **Phase:** IMPLEMENT · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]` · branch `orch-1150-snap-autodraft-navigate`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1150_SNAP_AUTODRAFT_NAVIGATE.md` (Option A — CLIENT auto-confirm-all; pure JS / OTA-able)
**Status:** implemented and verified (gates + jest green; fails-on-revert proven). Live snap→drafts on-device verification is the tester's job.

---

## 1. Summary

The business-app snap flow no longer shows a transient per-card "Suggested experiences" review (Reject/Edit/Accept). The instant the menu/activities parser returns N≥1 suggestions, the client auto-confirms EVERY proposal into a draft experience (looping the existing, tested per-proposal confirm path), shows an honest "Creating your experiences…" state, invalidates the drafts-list cache, and navigates to the Hub Experiences (Drafts) tab where the brand curates (edit / publish / delete = the new "reject"). Zero suggestions stay put with the empty toast; partial failures land the drafts that succeeded and navigate with an honest count; all-failed stays on the snap screen to retry. Ari's per-action confirm is untouched. No edge fn, no migration, no native change.

## 2. SPEC success-criteria coverage

All criteria satisfied by commit **`ad2f922ac`** (single commit).

| SC | Criterion | How verified | Status |
|----|-----------|--------------|--------|
| SC-1 | N≥1 → N drafts + navigate to `/(tabs)/hub/experiences`; drafts visible | `confirmAll` loops all ids (hook test T1: 3 ids → 3 confirms, created=3); `resolveSnapOutcome` navigate=true; snap.tsx `router.replace(DRAFTS_ROUTE)` after `invalidateExperienceList()` | ✓ |
| SC-2 | Honest loading "Creating your experiences…"; no blank/dead tap; back disabled mid-draft | snap.tsx `drafting` phase renders spinner + `copy.draftingText`; `onBack={isDrafting ? undefined : handleBack}` | ✓ |
| SC-3 | Created-N toast = real `tally.created`, singular/plural | `createdToastText` (test T10: "1 draft experience" vs "3 draft experiences") | ✓ |
| SC-4 | Zero → empty toast, stay idle, no nav, no auto-draft | snap.tsx `experiences_count === 0` short-circuits BEFORE `setPhase("drafting")` | ✓ |
| SC-5 | Partial → drafts land, navigate, honest partial toast | `resolveSnapOutcome` created>0&failed>0 → navigate + "Created N drafts; M couldn't be created." (test) | ✓ |
| SC-6 | All-failed → no nav, stay idle, error toast w/ firstError | `resolveSnapOutcome` created==0 → navigate=false, nextPhase idle, toast=`allFailed + firstError` (test) | ✓ |
| SC-7 | Idempotency — replayed id 409s, tallied failed not duplicate | `confirmAll` non-`executed`/error/throw → `failed`; server atomic flip (DO-NOT-TOUCH, reused). Hook test T5 (WRONG_STATE error → failed) | ✓ |
| SC-8 | Ari unaffected | `git diff --name-only origin/main...HEAD` excludes AriChatScreen/useConfirmPendingAction; gate asserts Ari has no `usePendingExperiences`/`confirmAll` + still imports `useConfirmPendingAction` | ✓ |
| SC-9 | Review surface removed + not imported | Both components `git rm`'d; gate asserts not-on-disk + zero importers (recursive grep) | ✓ |
| SC-10 | No fabrication | Executor (DO-NOT-TOUCH) unchanged; only parsed fields carry over; no `?? fallback` added in snap/hook | ✓ |

## 3. Files changed (vs origin/main)

| Status | File | Δ |
|--------|------|---|
| A | `.github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs` | +~230 (new gate, --self-test) |
| M | `.github/workflows/strict-grep-mingla-business.yml` | +16 (gate CI job) |
| A | `mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.test.ts` | +~290 (23 tests) |
| M | `mingla-business/app/experience/snap.tsx` | rewrite (~+60/−95 net) |
| A | `mingla-business/app/experience/snapOutcome.ts` | +~55 (pure decision/copy module) |
| M | `mingla-business/package.json` | +1 (`test:orch-1150` script) |
| D | `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx` | deleted |
| D | `mingla-business/src/components/experience/ExperienceReviewCards.tsx` | deleted |
| M | `mingla-business/src/hooks/usePendingExperiences.ts` | +~70 (`confirmAll`, `isConfirmingAll`, `invalidateExperienceList`) |
| A | `Mingla_Artifacts/investigations/…`, `…/specs/…` | forensics artifacts (carried into branch) |

**Allowlist note (stop-and-amend, in-scope):** the SPEC §11 allowlist names `snap.tsx` for the route rewrite. Two faithful extensions were made and are flagged here, not silently:
1. **`app/experience/snapOutcome.ts` (new)** — the pure navigate/toast/phase decision + copy were extracted out of `snap.tsx` because the repo's jest harness is `testEnvironment: "node"` and CANNOT import the RN `.tsx` route (JSX is compiled with `jsx:"react-native"`, not transformed for node). Extracting the pure logic is the only way to satisfy the SPEC §9 jest contract ("asserts the navigation + toast outcomes") against REAL production code rather than a re-implementation. snap.tsx imports it; the gate/test reference it.
2. **`.github/workflows/strict-grep-mingla-business.yml`** — the dispatch explicitly instructs "wire it into the workflow." Added the standard self-test + run job mirroring every sibling gate.

No DO-NOT-TOUCH file was edited (proven §8 below).

## 4. Data-model changes applied

NONE. No schema, RLS, column, index, or migration. `agent_pending_actions` lifecycle + atomic idempotency flip reused as-is.

## 5. Edge functions touched

NONE. `agent-confirm-action`, `create_experience` executor (`_shared/agentTools.ts`), `parse-restaurant-menu`, `parse-play-activities` are all DO-NOT-TOUCH and unchanged. `verify_jwt` values: not altered (no edge file in the diff). Option A drives the existing functions through the existing client.

## 6. Regression tests added

- **Path:** `mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.test.ts` — 13 tests in this file (T1, T3, T4, T5, T5b, T5c, T9 on the real `confirmAll` hook body; T1/T3/T4/T5/T10 + edge wording on the pure `resolveSnapOutcome`/`createdToastText`). Plus the kept `orch1144Chooser.tester.adversarial.test.ts` (10 tests, T8 parseMode category-agnostic). **Total 23 tests, all PASS.**
- **Append-only:** new file added; no existing test modified/deleted.
- **fails-on-revert verified at `ad2f922ac`:** reverting `snap.tsx` to re-add the `ExperienceReviewCards` import and delete the `confirmAll` call made `npm run test:orch-1150` exit non-zero at the strict-grep gate (T7 — "review removed"), with both gate assertions firing:
  - `snap.tsx references ExperienceReviewCards — the per-card Accept/Reject review must NOT be reintroduced (§9.1)`
  - `snap.tsx still imports/references a deleted review component (§9.1/§9.2)`
  Restoring the fix (`cp` back the committed clean files; `git diff --stat HEAD` empty) → `test:orch-1150` PASS (23/23). True line-deletion revert, not a comment-out.

## 7. Old → New receipts

### usePendingExperiences.ts
**Before:** exposed `parseFiles`, `confirm`, `reject`, `isConfirming`; each single `confirm` invalidated `pendingExperienceKeys.byBrand` + `experienceKeys.listByBrand`.
**Now:** adds `confirmAll(ids)` (sequential loop over the existing `confirmMutation.mutateAsync`, honest `{created,failed,firstError}` tally; error/expired/throw → failed), `isConfirmingAll` (useState toggled around the loop), and `invalidateExperienceList()` (awaitable belt-and-braces invalidation of `experienceKeys.listByBrand`). `confirm`/`reject`/`isConfirming` kept (out of scope to remove).
**Why:** SC-1/5/6/7 + §4.4/§4.6.
**Lines:** ~+70.

### app/experience/snap.tsx
**Before:** `SnapPhase = idle|parsing|review`; parse success → `setPhase("review")` → rendered `ExperienceReviewCards` with per-card Accept (one confirm)/Reject; a resolve-to-empty `useEffect` navigated after the last card.
**Now:** `SnapPhase = idle|parsing|drafting`; parse success (N≥1) → `setPhase("drafting")` → `confirmAll(ids)` → `resolveSnapOutcome` → on navigate: `await invalidateExperienceList()`, show created-N toast, then `router.replace("/(tabs)/hub/experiences")` after a 700ms honest dwell; on all-failed: error toast + stay idle. `ExperienceReviewCards` import + render + the resolve-to-empty `useEffect` removed. Back disabled while drafting. Header doc updated.
**Why:** the whole ORCH (SC-1..6, §4.5).
**Lines:** ~+60/−95 net.

### app/experience/snapOutcome.ts (new)
**Before:** n/a.
**Now:** pure `createdToastText(created)` (singular/plural) + `resolveSnapOutcome(tally, allFailedToast)` → `{navigate, toast, nextPhase}` + `SnapPhase`/`ConfirmAllTally`/`SnapOutcome` types.
**Why:** node/ts-jest-testable decision logic for the SPEC §9 jest contract.
**Lines:** ~+55.

### ExperienceReviewCards.tsx + ExperienceConfirmationCard.tsx
**Before:** the snap-only per-card review stack (Accept→draft / Reject / Edit).
**Now:** DELETED (zero importers; INVESTIGATE F-2/DISC-1150-1).
**Why:** SC-9.

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | NO | no snap flow in consumer |
| 2 | Consumer Android | NO | same |
| 3 | Buyer/anon Web | NO | public buyer routes |
| 4 | Business iOS | YES | automatic (shared RN code) |
| 5 | Business Android | YES | automatic (shared RN code) |
| 6 | Admin Web | NO | no authoring |
| 7 | Business Web preview | YES | automatic (same JS route) |

Parity is automatic across iOS/Android/Web-preview (one shared RN route + hook). No manual parity surface.

**DO-NOT-TOUCH proof:** `git diff --name-only origin/main...HEAD | grep -iE "AriChatScreen|useConfirmPendingAction|agent-confirm-action|agentTools|parse-restaurant|parse-play|experiencesService|useExperiencesByBrand|hub/experiences.tsx"` → EMPTY. None edited.

## 9. Smoke / gate result (run in the worktree)

- `node …/orch-1150-snap-auto-draft.mjs --self-test` → `self-test PASS (6/6 cases)`.
- `node …/orch-1150-snap-auto-draft.mjs` → `gate PASS: snap auto-drafts all suggestions + navigates to drafts; review components deleted; Ari manual-confirm untouched.`
- `npm run test:orch-1150` → gate self-test PASS + gate PASS + **23/23 jest tests PASS**.
- `node …/orch-1004-auth-scoped-query-readiness.mjs` → still PASS (24 hooks; my `usePendingExperiences` edit preserves the `isAuthReady` gate).
- `npx tsc --noEmit` → **zero errors in any changed file** (`snap.tsx`, `snapOutcome.ts`, `usePendingExperiences.ts`, the test). Repo baseline of 325 pre-existing errors in unrelated files is unchanged (none in my files; confirmed by filtered grep returning empty).
- `npx eslint <changed files>` → **0 errors**, 2 warnings (`import/first` — inherent to the jest.mock-before-import harness style, identical to the accepted `useEventCoverVideoUpload.test.ts` / `authScopedQueryReadiness.test.ts`).

No sim/device run performed (implementor scope); the tester live-fires snap→N-drafts→drafts-tab on iOS sim + the adversarial set.

## 10. Known issues / deferred

- `confirm`/`reject`/`isConfirming` exports on `usePendingExperiences` are now unused by snap but intentionally KEPT (SPEC §4.4 — deletion is a separate cleanup ORCH).
- No `[TRANSITIONAL]` code introduced.
- Toast-across-navigation uses the SPEC's RECOMMENDED 700ms inline dwell then `router.replace` (no cross-screen toast utility surfaced). §10 open question resolved per the recommendation.

## 11. Operator action required

- **Migration `db push`:** NONE.
- **Edge deploy:** NONE.
- **OTA (on CLOSE):** pure JS → OTA the business dev/prod channel per the EAS CLI gotchas memory (`npx -y eas-cli@latest update`, per-platform, runtime biz 1.0.0). No native rebuild.
- **Invariant flip (orchestrator at CLOSE):** flip `I-PROPOSED-1150-SNAP-SUGGESTIONS-AUTO-DRAFT` DRAFT → ACTIVE.

## 12. Discoveries for Orchestrator

- None new. DISC-1150-1 (dead review components) handled by deletion + gate. DISC-1150-2 (`expired_regenerate` dead-for-snap) honored — `confirmAll` tallies it as a generic failure, no regenerate CTA, and the edge path is left intact for Ari. DISC-1150-3 (no COMMS needed) confirmed: the OPEN ledger WARN entries (1119/1120 trip-migration clobber lineage, 1133 ID collision) touch neither the snap/experience-parser client, `usePendingExperiences`, nor any migration — this ORCH ships zero migrations and zero edge changes.
- **Comms ledger:** read on entry; no OPEN BLOCK rows; the OPEN WARN rows are trip-migration/ID-collision coordination irrelevant to this client-only snap ORCH — no ack required, nothing to factor in.

**Commit:** `ad2f922ac` (all scoped changes, single commit). fails-on-revert verified at `ad2f922ac`.

**Downstream:** route to mingla-orchestrator REVIEW → mingla-tester (live-fire + adversarial: zero / partial / all-failed / Ari-unaffected / no-duplicate-on-resubmit).
