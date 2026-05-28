# REVIEW ORCH-0978 IMPLEMENT-5

Verdict: **APPROVED**

Date: 2026-05-28
Reviewer: Claude `mingla-orchestrator` (Pass 1, operator-delegated)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
Branch HEAD: `97576a9e4`
Commits under review: `4bd141ff7` (step 1 product), `97576a9e4` (step 2 tests + report)
Inputs: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §SPEC AMENDMENT 7 (committed `f6e9fb9d5`), `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_5.md`

## 1. Executive summary

IMPLEMENT-5 ships SPEC AMENDMENT 7 exactly as scoped. The nullable `updatePublishedEventCoverMedia` is deleted and replaced with `setEventCover` (TypeScript-enforced non-null `mediaUrl: string`) + `clearEventCover` (the only null-writing path). The `EditPublishedScreen.tsx` save flow is rewritten with an explicit `explicitCoverSet / explicitCoverClear / metadataOnlyPatch` conditional tree + round-trip `persist_mismatch` handling. Trim values wired through the upload-intent hook, 3 stale "30 seconds" strings fixed, strict-grep C8+C9 added, the existing guard test updated. Two new Jest test files (7 scenarios) pass independently. All strict-grep checks C1-C9 green. Zero touches under `supabase/`, `app-mobile/`, `mingla-admin/`. Ready for tester live-fire RETEST + Seth physical iPhone re-validation.

## 2. Commit-hash verification (DEC-179)

| Claimed file | git log -1 result | Commit | Verdict |
|---|---|---|---|
| `mingla-business/src/services/eventCoverMediaService.ts` | `4bd141ff7` | step 1 | PASS |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | `4bd141ff7` | step 1 | PASS |
| `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | `4bd141ff7` | step 1 | PASS |
| `mingla-business/src/utils/eventCoverNativeVideo.ts` | `4bd141ff7` | step 1 | PASS |
| `mingla-business/src/utils/eventCoverMediaRules.ts` | `4bd141ff7` | step 1 | PASS |
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | `4bd141ff7` | step 1 | PASS |
| `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` | `4bd141ff7` | step 1 | PASS |
| `mingla-business/src/services/__tests__/eventCoverMediaService.setClearSplit.test.ts` | `97576a9e4` | step 2 | PASS |
| `mingla-business/src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx` | `97576a9e4` | step 2 | PASS |

All 9 files committed on the per-ORCH branch. `git diff --check` whitespace clean across both commits. `git status` shows only pre-existing dirty drift (`app-mobile/tsconfig.json`, `mingla-business/tsconfig.json`, `mingla-business/package-lock.json`, untracked prior-phase reports) — none touched by IMPLEMENT-5; scheduled for CLOSE Step 1.6 sweep.

**Minor non-blocking discrepancy:** Implementation report §9 line 128 cites commit 2 as `6a8bdb50b`, but the actual landed + pushed commit 2 is `97576a9e4` (matches the dispatch). Stale hash in the report — the implementor amended commit 2 after writing the report body. The actual landed commits are correct and verified above. No action needed beyond noting it.

## 3. Dependency walk (DEC-179)

One config-layer file touched: `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`.

| Changed file | Consumer | Status |
|---|---|---|
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` (C8+C9 added) | `.github/workflows/strict-grep-mingla-business.yml` job `orch-0978-video-cap-29s` | PASS — job runs `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`; locally green C1-C9 |

No other config-layer files (`app.json`, `vercel.json`, `package.json`, `tsconfig*`, `metro.config.*`, `babel.config.*`, `next.config.*`, other workflows) touched. `package-lock.json` drift is pre-existing (from this session's earlier `@expo/ngrok --no-save` install), NOT in IMPLEMENT-5's commits — confirmed via `git diff --name-only 4bd141ff7~1 97576a9e4` which does not list it.

## 4. Hard-guard compliance

| Guard | Result | Evidence |
|---|---|---|
| Client-only (no edge source change) | PASS | `git diff --name-only 4bd141ff7~1 97576a9e4 -- 'supabase/**'` empty |
| No edge function redeploy | PASS | No `supabase/functions/` diff; report §16 confirms no redeploy |
| No `supabase db push` | PASS | No `supabase/migrations/` diff |
| No migration | PASS | Same |
| No PR opened by implementor | PASS | No PR against this branch by implementor; orchestrator owns PR at CLOSE |
| Two-commit pattern (META-ORCH-0744) | PASS | Commit 1 product (7 files) + Commit 2 tests + report (3 files) |
| No scope beyond Items 1-8 | PASS | Items 1-7 implemented; Item 8 (DIAG) intentionally skipped (allowed — optional); no out-of-scope files |
| No `app-mobile/` or `mingla-admin/` touch | PASS | `git diff --name-only 4bd141ff7~1 97576a9e4 -- 'app-mobile/**' 'mingla-admin/**'` empty |

## 5. SPEC AMENDMENT 7 item-by-item verification

| Item | Required | Delivered | Verdict |
|---|---|---|---|
| Item 1 — tighten cover-save guard | explicit set/clear/metadata-only conditional tree in EditPublishedScreen.tsx | Lines 618-687: `explicitCoverSet`, `explicitCoverClear`, `metadataOnlyPatch` branches; `setEventCover`/`clearEventCover` calls; `persist_mismatch` toast at 675 | PASS |
| Item 2 — split service | `setEventCover` (non-null URL) + `clearEventCover`; delete `updatePublishedEventCoverMedia` | Service line 180 `setEventCover` with `mediaUrl: string` (line 182, NOT `string\|null`); line 239 `clearEventCover`; old symbol grep returns only the test-assertion-that-verifies-deadness | PASS |
| Item 3 — round-trip verification | `setEventCover` re-reads + throws `persist_mismatch` on mismatch | Service line 228 throws `persist_mismatch`; error union has it at eventCoverMediaRules.ts:17 | PASS |
| Item 4 — wire trim values | `trimStartMs: 0` + `trimEndMs: compressed.durationMs` in hook | useEventCoverVideoUpload.ts:100-101 present | PASS |
| Item 5 — 3 text strings | "30 seconds" → "29 seconds" in eventCoverNativeVideo.ts + eventCoverMediaRules.ts (×2) | grep "30 seconds" returns zero matches in both files; C9 green | PASS |
| Item 6 — strict-grep C8 + C9 | C8 (service split + dead symbol) + C9 (dead "30 seconds") | Both present and green in local run | PASS |
| Item 7 — Jest regression tests (T-AMEND7-01..07) | 2 new test files | `eventCoverMediaService.setClearSplit.test.ts` + `EditPublishedScreen.coverPersistence.test.tsx`; 7/7 pass | PASS |
| Item 8 — optional DIAG console.log | Optional | Intentionally skipped (allowed) | N/A |
| Guard-test update | `serverDraftLifecycleGuards.test.ts:352` → set/clear assertion | Updated; targeted test `-t "published cover media server write"` passes | PASS |

## 6. Independently re-run automated gates

| Gate | Command | Result |
|---|---|---|
| Strict-grep ORCH-0978 | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS — C1-C9 all green |
| AMENDMENT 7 Jest | `npx jest eventCoverMediaService.setClearSplit.test.ts EditPublishedScreen.coverPersistence.test.tsx --runInBand` | PASS — 2 suites, 7 tests |
| Updated guard test | `npx jest serverDraftLifecycleGuards.test.ts -t "published cover media server write"` | PASS — 1 passed |
| tsc on touched files | `npx tsc --noEmit --pretty false \| grep <6 touched files>` | PASS — zero TS errors in any IMPLEMENT-5-touched file |
| Whitespace | `git diff --check 4bd141ff7~1 97576a9e4` | PASS — empty |
| Dead old symbol | `grep -rn updatePublishedEventCoverMedia mingla-business/src/` | PASS — only the test assertion verifying its absence |
| Dead "30 seconds" | `grep -rn "30 seconds" eventCoverNativeVideo.ts eventCoverMediaRules.ts` | PASS — zero matches |

## 7. Fails-on-revert proof (META-ORCH-0744 Step 0.5 prep)

Implementation report §12 documents the fails-on-revert sequence: reverse-applied the `EditPublishedScreen.tsx` product diff → reran the two AMENDMENT 7 Jest files → T-AMEND7-05, T-AMEND7-06, T-AMEND7-07 FAILED (service tests still passed because the service split is independent of the component rewrite) → restored → 7/7 PASS. This proves the component-rewrite tests actually exercise the bug (they fail when the fix is reverted). The implementor's happy-path test (T-AMEND7-05) is the load-bearing regression for the F-1 root cause.

**Outstanding for CLOSE Step 0.5:** the tester-written adversarial test (T-AMEND7-08 — persist-mismatch toast) is NOT in IMPLEMENT-5 (correctly out of implementor scope per SPEC §G). The tester writes it during RETEST. CLOSE's regression-test gate requires BOTH the implementor happy-path (T-AMEND7-05, present) AND the tester adversarial (T-AMEND7-08, pending). CLOSE cannot proceed until the tester lands T-AMEND7-08 with its own fails-on-revert proof.

## 8. Honesty assessment (pre-existing red states)

The implementation report §12 + §15 transparently flag two pre-existing failures NOT introduced by IMPLEMENT-5:
1. **Full `serverDraftLifecycleGuards.test.ts` suite FAILs** on unrelated stale route/source assertions. I independently confirmed the IMPLEMENT-5-updated assertion (`published cover media server write`) PASSES; the other failures are outside this ORCH's scope.
2. **Full `mingla-business` `tsc --noEmit` FAILs** on repo-wide errors (checkout, marketing editor, package typings, fixture drift). I independently confirmed ZERO tsc errors in any of the 6 IMPLEMENT-5-touched files.

This is exemplary implementor honesty — flagging unrelated red CI rather than hiding it or claiming false-green. Both are pre-existing repo state, not regressions. Worth registering as a separate cleanup ORCH if not already tracked (Discovery for Orchestrator below).

## 9. Discoveries for Orchestrator

1. **Pre-existing repo-wide tsc red + serverDraftLifecycleGuards full-suite red** — not introduced by IMPLEMENT-5. If GitHub CI runs full `tsc` or the full guard suite as a required check, the PR may show red on unrelated grounds. Orchestrator should confirm at PR time whether these are already-tracked / already-red on `main`, or whether a separate cleanup ORCH is needed. Do NOT let unrelated red block this PR if `main` is already red on the same surfaces.
2. **`tripsService.ts:672-674` + `useBrandCoverUpload.ts`** still carry the same `patch.coverMediaUrl !== undefined` read-through pattern (SPEC §B non-goal + investigation Discovery). File a follow-up ORCH at CLOSE Step 4 to audit cover-like services for the same bug class before I-PROPOSED-NO-COVER-NULL-IMPLICIT-WRITE is declared fully systemic.
3. **Commit-2 hash discrepancy** in the implementation report (§9 cites `6a8bdb50b`, actual `97576a9e4`) — cosmetic; actual landed commits verified correct.

## 10. Verdict

**APPROVED.** All 8 hard guards pass, all 8 SPEC AMENDMENT 7 items honored (7 implemented + 1 optional-skipped), commit-hash verified across 9 files, dependency walk clean (strict-grep workflow wired), two-commit pattern + fails-on-revert proof present, 7/7 Jest pass independently, strict-grep C1-C9 green, zero tsc errors in touched files, zero backend/migration/PR-open violations. The TypeScript-enforced `mediaUrl: string` signature makes the silent-null-write bug class structurally impossible to reintroduce. Ready for tester live-fire RETEST (must include T-AMEND7-08 as the adversarial regression) + Seth physical iPhone re-validation, then CLOSE.
