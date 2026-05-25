# REVIEW — ORCH-0975 [Consumer notifications sheet redesign]

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode)
**Date:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/`
**Branch:** `ORCH-0975-consumer-notifications-redesign`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
**Inputs reviewed against:** `specs/SPEC_ORCH-0975_ADDENDUM_PER_TYPE_MATRIX.md`, `specs/SPEC_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`, `design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`

---

## Verdict

**NEEDS WORK — single blocking gap; substantive code review otherwise APPROVED.**

The implementation is technically excellent against every hard guard and every spec criterion this reviewer can verify from source. The blocker is mechanical, not substantive: **zero of the 37 changed files are committed to the per-ORCH branch.** Per DEC-179 / ORCH-0959, the Commit-Hash Verification gate is mandatory and produces an automatic NEEDS WORK regardless of code quality. The "fails-on-revert anchor `818b5f8b746e`" cited in the implementation report §6 is the SPEC ADDENDUM commit hash (the commit BEFORE the implementation), not a code commit — the fails-on-revert claim is structurally invalid as written.

Rework is mechanical and should take the implementor <10 minutes: stage and commit the 37 changed files in 1-3 atomic commits on the per-ORCH branch, then re-run the fails-on-revert verification against the resulting code-commit hash and update the implementation report.

---

## Commit-Hash Verification (MANDATORY, DEC-179)

`git log --oneline main..HEAD` on the per-ORCH branch:

```
818b5f8b7 ORCH-0975 [Consumer notifications sheet redesign] SPEC ADDENDUM: per-type data matrix
eaf6a5313 ORCH-0975 [Consumer notifications sheet redesign] SPEC + DESIGN
10e4de3eb ORCH-0975 [Consumer notifications sheet redesign] INTAKE: WORLD_MAP + WORKTREE_REGISTRY rows
```

**Three commits — all forensics/orchestrator artifacts. ZERO implementation commits.**

`git status --short` (excluding the symlinked `node_modules/` orphans which are expected per the worktree-strategy node_modules symlink rule):

| Status | Path | Claimed in implementor report? |
|---|---|---|
| `M` | `.github/workflows/strict-grep-mingla-business.yml` | YES (§6 receipts) |
| `M` | `app-mobile/src/components/HomePage.tsx` | YES (§6 receipts) |
| `RM` | `app-mobile/src/components/NotificationsModal.tsx → NotificationsSheet.tsx` | YES (§6 receipts; git mv used) |
| `M` | `app-mobile/src/constants/designSystem.ts` | YES (§6 receipts) |
| `M` | `app-mobile/src/i18n/locales/{29 languages}/notifications.json` | YES (§6 receipts — all 29) |
| `??` | `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | YES (§6 receipts) |
| `??` | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` | YES (the report itself) |
| `??` | `app-mobile/src/components/__tests__/NotificationsSheet.test.tsx` | YES (§6 receipts) |
| `??` | `app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts` | YES (§6 receipts) |

**Total: 37 files modified or added; 0 committed.**

**Verdict on this gate:** FAIL. Per DEC-179: "If `git status` shows the file as modified-but-uncommitted, verdict is NEEDS WORK. No 'I'll commit it after review' path."

**Fails-on-revert claim cross-check:** the implementation report §6 cites `Fails-on-revert anchor: 818b5f8b746e` for the regression test. That hash matches commit `818b5f8b7 ORCH-0975 SPEC ADDENDUM: per-type data matrix` (authored by forensics, not implementor). A fails-on-revert anchor must reference a commit that CONTAINS THE CODE the test exercises. Reverting `818b5f8b7` reverts the SPEC ADDENDUM markdown file — it has no effect on `NotificationsSheet.tsx` or `notificationsFixtures.ts` and cannot cause the regression test to fail. The claim is invalid as written. Once the implementation is committed, the implementor must re-run fails-on-revert against the new code-commit hash and update the report.

---

## Dependency Walk for Config-Layer Changes (MANDATORY, DEC-179)

Touched config-layer files (per the config-layer trigger list — `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `expo.json`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, `.github/scripts/**`):

| Config file | Touched? | Diff size | Consumers | Compatibility |
|---|---|---|---|---|
| `app-mobile/package.json` | NO | — | — | — |
| `app-mobile/app.config.ts` | NO | — | — | — |
| `app-mobile/eas.json` | NO | — | — | — |
| `app-mobile/metro.config.js` | NO | — | — | — |
| `app-mobile/babel.config.js` | NO | — | — | — |
| `app-mobile/tsconfig.json` | NO | — | — | — |
| `.github/workflows/strict-grep-mingla-business.yml` | **YES** | +12 lines | `gh actions` runner; no other workflow imports/extends this file | Pure additive — registers one new job `orch-0975-notifications-sheet` mirroring the canonical registry pattern (per memory `feedback_strict_grep_registry_pattern.md`). Job is independent (own `runs-on`, own `steps`, own `actions/checkout@v4` + `actions/setup-node@v4`); no shared state with other jobs. No existing job consumes the new gate's output. |
| `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | **YES (new file)** | +N lines | Only consumer is the workflow job above | Standalone Node script using `node:fs`/`node:path` core modules (no new deps). Mirrors the `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` pattern. |

**Dependency-walk verdict:** PASS. Both config-layer touches are purely additive registry entries following the established `feedback_strict_grep_registry_pattern.md` pattern. No regression risk to other CI jobs.

---

## Substantive code review (against SPEC + ADDENDUM + DESIGN)

This section verifies every hard guard + every claimed success criterion against the actual source state (which is on disk in the worktree but uncommitted — once the implementor commits, this section's verdicts hold).

### Hard guards (from the orchestrator dispatch)

| Guard | Verdict | Evidence |
|---|---|---|
| `useNotifications.ts` BIT-IDENTICAL | **PASS** | `git diff HEAD -- app-mobile/src/hooks/useNotifications.ts` returns empty output. SC-24 satisfied. |
| No RN Modal in `NotificationsSheet.tsx` | **PASS** | Imports show `} from 'react-native';` (View/Text/etc.) and `} from '@gorhom/bottom-sheet';`. Inspected the destructured import block: `Modal` is NOT in the `react-native` destructure list. Strict-grep C1 confirms. |
| `@gorhom/bottom-sheet` used | **PASS** | Import present + strict-grep C1 confirms. |
| No filter locale namespace | **PASS** | `grep -E "FilterTab\|activeFilter\|filterTabsContainer\|filterTabsScroll" NotificationsSheet.tsx` returns 0 hits. Strict-grep C2 confirms `filters` namespace absent across all 29 locale files. |
| No location-chain row in v1 | **PASS** | `grep -E "getNotificationLocation\|fromLocationName\|toLocationName" NotificationsSheet.tsx` returns 0 hits. SC-38 satisfied. |
| No actor avatar lookup (Option C only) | **PASS** | `grep -rn "useActorAvatar" app-mobile/src` shows ONE match — in the test file as a NEGATIVE assertion (`assert.doesNotMatch(..., /useActorAvatar\|profiles\.avatar_url\|actor profile/i)`). Zero occurrences in product code. SC-37 satisfied as written. |
| HomePage 3-line touch | **PASS** | `git diff HEAD -- app-mobile/src/components/HomePage.tsx` shows exactly 2 line changes (import path + JSX component name). SC-25 satisfied. |
| EAS-OTA-eligible (no native config) | **PASS** | `git diff HEAD -- app-mobile/package.json app-mobile/app.config.ts app-mobile/eas.json` empty. SC-35 satisfied. |
| Strict-grep gate registered + green | **PASS** | `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` outputs all three gates (C1/C2/C3) green across 29 locales; workflow job registered in `strict-grep-mingla-business.yml`. SC-26 satisfied. |
| 8 mock fixtures from addendum | **PASS** | `app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts` exists; report §6 confirms 8 fixtures matching addendum §"Mock fixtures". |
| Locale shape (en) | **PASS** | `en/notifications.json` carries `header.title/subtitle/newCount/unread/markAllRead/clearAll`, `categoryLabels.social/sessions/messages/all`, no `filters` key. Matches SPEC §3.2 + Correction matrix. |
| All 29 locales touched (parity) | **PASS** | All 29 `notifications.json` files show as `M` in git status. |
| Git mv used for rename | **PASS** | `git diff -M1 --name-status` reports `RM app-mobile/src/components/NotificationsModal.tsx → NotificationsSheet.tsx` — rename detection engaged (similarity reported `R048` due to the heavy rewrite, but the RENAME is preserved which is what matters for `git log --follow` blame). SC-33 satisfied. |

### REVIEW protocol checklist (general)

| Check | Verdict | Notes |
|---|---|---|
| Root cause proven or just plausible? | **N/A (redesign, not bug fix)** | This was a design refresh with a clean handoff from SPEC + DESIGN + addendum. No root cause applies. |
| Scope appropriate — could be narrower? | **PASS** | Scope held exactly to the SPEC §2 in/out list. No drive-by edits. Operator can verify via `git status --short` showing only spec-scoped files. |
| Hidden fallback paths that mask failure? | **PASS** | The implementor adopted Option C verbatim — no `useActorAvatar` hook, no heuristic title parsing, no body-string regex extraction. Risk surface is intentionally narrow. |
| Stale cache paths serving old data? | **N/A** | No React Query key changes; `useNotifications` untouched. |
| Response shape truthful in ALL states? | **PASS (source verified)** | Report §8 confirms states (loading/empty/error/offline/submitting) all render per DESIGN §4. Live verification awaits tester. |
| Real fix or symptom mask? | **PASS (real)** | Filter chip row deleted entirely (not hidden via CSS); RN Modal swapped for bottom-sheet (not wrapped). |
| Solo/collab parity checked? | **N/A** | This sheet is solo-only by design (notifications are per-user). |
| Constitutional compliance verified? | **PASS** | Report §9 maps all 14 principles. Constitution #9 (no fabricated data) is the load-bearing one and is satisfied by Option C + no-location-row + no-bold-split-without-data. |
| Evidence chain complete? | **PARTIAL** | Source-level evidence is strong (test pass, strict-grep green, diff guards green). Live-on-sim evidence is owned by tester next. |
| Documents updated? | **N/A (implementor phase)** | Implementor wrote the implementation report; WORLD_MAP/COVERAGE_MAP/etc. update at CLOSE, not REVIEW. |
| **Commit-hash verification** | **FAIL — see above section** | Sole blocker. |
| **Dependency walk for config-layer changes** | **PASS — see above section** | Workflow + strict-grep script are purely additive registry entries. |

### Constitution map (cross-reference to implementor report §9)

All 14 principles verified. Particular attention paid to:

- **#3 No silent failures** — action errors still surface via `actionErrors` set + inline "Action failed. Tap to retry." text. PRESERVED.
- **#6 Logout clears everything** — no new persisted state. The `failedImageIds` + `actionErrors` local state survive only the component lifecycle; gone on unmount.
- **#9 No fabricated data** — VERIFIED in source: no location-chain row, no bold-actor heuristics, no inferred actor names. When `getAvatarUrl()` returns null and `actor_id != null`, the type-matched Ionicon renders (no `?` initials, no placeholder image).

---

## Minor observations (non-blocking)

These are NOT REVIEW gaps — they're notes the implementor + tester + CLOSE owner should be aware of.

### Observation O-1 — Regression test uses Node assertion pattern, not Jest

The implementor's regression test (`app-mobile/src/components/__tests__/NotificationsSheet.test.tsx`) is a Node assertion script invoked via `node src/components/__tests__/NotificationsSheet.test.tsx`, not a Jest test. The implementor's verification table at §12 documents the reason: `app-mobile/package.json` has no `test` script and no Jest harness is configured. This follows the existing app-mobile regression pattern (per the implementor's report §14).

**REVIEW position:** ACCEPTABLE for this ORCH. The Step 0.5 regression-test gate at CLOSE requires "implementor-written happy-path regression test at a real path under the repo with a passing run captured in the implementation report AND a fails-on-revert verified at <commit hash> line." Both halves are satisfiable with the Node assertion pattern — just at a different runtime than Jest. CLOSE owner should accept this pattern explicitly in the CLOSE banner OR escalate to register a follow-up app-mobile-test-harness ORCH (which the implementor recommends in §15 Discoveries — `app-mobile lacks Jest harness; recommend a tooling decision`).

### Observation O-2 — Tester adversarial test outstanding (SC-28)

SC-28 (tester-written adversarial regression test) is not implementor-owned — it's owned by Claude `mingla-tester` in the next phase. The Step 0.5 gate at CLOSE will check BOTH the implementor happy-path test AND the tester adversarial test exist. Tester must write a test at a real path under `app-mobile/src/components/__tests__/` (following the implementor's Node-assertion pattern unless the team adopts Jest first) attacking a different angle than the happy-path test (see SPEC §3.7 §"Tester adversarial test" for four suggested attack vectors).

### Observation O-3 — Visual / live-fire QA outstanding

SC-13, SC-20, SC-21, SC-29-32 all depend on visual rendering on actual devices. Source-level verification can only get the structure right — pixel-level fidelity to the operator's screenshot (ring thickness, dot positioning, pill colours, spacing rhythm, motion feel) is owned by the tester live-fire (iOS sim + Android emu + operator-attested physical iPhone for pan-down feel).

### Observation O-4 — Full repo `tsc --noEmit` fails on unrelated existing errors

Implementor's §12 verification table reports `npx tsc --noEmit` from `app-mobile/` fails on pre-existing repo issues (Deno test files, BoardDiscussion, package path/type issues). The implementor confirms `2>&1 | rg "NotificationsSheet|NotificationsModal|notificationsFixtures|HomePage"` returns zero hits — no ORCH-0975-related TS errors.

**REVIEW position:** ACCEPTABLE. ORCH-0975 cannot be held responsible for pre-existing repo-wide TS health. CLOSE owner should NOT include "full tsc green" as a CLOSE gate for this ORCH. Recommend implementor's §15 Discoveries item (app-mobile tooling cleanup) be registered as a follow-up ORCH separately.

### Observation O-5 — Git rename similarity score is low (R048)

Per the implementor's §12, `git diff -M1 --name-status` reports the rename as `R048` (48% similarity). This is expected — the body of `NotificationsSheet.tsx` was substantially rewritten (1109 → 1229 lines per §6). The rename is preserved (the key signal for `git log --follow` to track blame across the rename), but the per-line blame inside the new body will mostly attribute to the rename commit, not the pre-rename history. ACCEPTABLE per SC-33; preserves the rename, which is what the spec required.

---

## What the implementor must do to clear NEEDS WORK

This is the EXACT rework instruction. Implementor should execute these steps and re-submit:

1. **Stage all 37 implementation files in atomic commit(s).** Suggested grouping (one commit OR three logical commits — implementor's choice; both are fine):

   **Option A (one atomic commit):**
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]"
   git add app-mobile/src/constants/designSystem.ts \
           app-mobile/src/i18n/locales/*/notifications.json \
           app-mobile/src/components/NotificationsSheet.tsx \
           app-mobile/src/components/HomePage.tsx \
           app-mobile/src/components/__tests__/NotificationsSheet.test.tsx \
           app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts \
           .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs \
           .github/workflows/strict-grep-mingla-business.yml \
           Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md
   # NotificationsModal.tsx deletion is captured by the `git mv` — git status shows it as RM together with NotificationsSheet.tsx
   git commit -m "ORCH-0975 [Consumer notifications sheet redesign] IMPL: bottom-sheet + premium cards + per-type matrix v1"
   ```

   **Option B (three logical commits):**
   ```bash
   # Commit 1 — tokens + locales (additive infra)
   git add app-mobile/src/constants/designSystem.ts \
           app-mobile/src/i18n/locales/*/notifications.json
   git commit -m "ORCH-0975 IMPL part 1: glass.notificationsSheet tokens + locale namespace shift (add subtitle/newCount/categoryLabels, delete filters)"

   # Commit 2 — component rename + rewrite + caller touch + test + fixtures
   git add app-mobile/src/components/NotificationsSheet.tsx \
           app-mobile/src/components/HomePage.tsx \
           app-mobile/src/components/__tests__/NotificationsSheet.test.tsx \
           app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts
   git commit -m "ORCH-0975 IMPL part 2: NotificationsModal -> NotificationsSheet (@gorhom/bottom-sheet v5 + premium cards + Option C avatar + per-type matrix v1)"

   # Commit 3 — CI gate registration + implementation report
   git add .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs \
           .github/workflows/strict-grep-mingla-business.yml \
           Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md
   git commit -m "ORCH-0975 IMPL part 3: strict-grep gate (C1/C2/C3) + implementation report"
   ```

   Either grouping is acceptable. Operator may prefer the 3-commit split for cleaner blame on the CI gate vs the product code, but the orchestrator will accept either at re-REVIEW.

2. **Re-run fails-on-revert verification against the new code-commit hash.** Recommended procedure:
   ```bash
   # Capture the new HEAD hash (the commit that contains NotificationsSheet.tsx)
   TARGET=$(git log --oneline -1 --format=%H -- app-mobile/src/components/NotificationsSheet.tsx)

   # Run the test from a clean state — should PASS
   cd app-mobile && node src/components/__tests__/NotificationsSheet.test.tsx

   # Locally revert ONLY the product file to its pre-implementation state (use git checkout from main)
   git checkout main -- src/components/NotificationsSheet.tsx 2>/dev/null \
     || git rm src/components/NotificationsSheet.tsx  # main has NotificationsModal.tsx, not NotificationsSheet.tsx — removing the file simulates the revert

   # Run the test — should FAIL (file missing OR pre-implementation shape)
   node src/components/__tests__/NotificationsSheet.test.tsx
   # Expected: exit code != 0 / FAIL output

   # Restore from the committed branch state
   git checkout HEAD -- src/components/NotificationsSheet.tsx

   # Verify the test PASSES again
   node src/components/__tests__/NotificationsSheet.test.tsx
   # Expected: exit code 0 / PASS
   ```

3. **Update implementation report §6 line `Fails-on-revert anchor: 818b5f8b746e`** to reference the NEW code-commit hash (the one captured into `$TARGET` above). The line should read: `Fails-on-revert anchor: <new-hash>` along with one sentence describing what was reverted to produce the fail (e.g., "Reverted `app-mobile/src/components/NotificationsSheet.tsx` to pre-implementation state by `git rm` — test failed because the file no longer exists; restored from HEAD and test passed again").

4. **Push branch** (no PR yet — REVIEW happens before tester, push is just for orchestrator + tester convenience):
   ```bash
   git push -u origin ORCH-0975-consumer-notifications-redesign
   ```

5. **Notify orchestrator** with the new commit hashes — orchestrator re-runs Commit-Hash Verification + completes the REVIEW and emits the APPROVED handoff to Claude `mingla-tester`.

Expected time: <10 minutes. No code changes required — just commit what's already done correctly.

---

## What's NOT required (do NOT do these)

- **Do NOT change any code.** The implementation passes substantive review. Touching code introduces risk; this rework is mechanical-only.
- **Do NOT amend the existing forensics commits (`818b5f8b7`, `eaf6a5313`, `10e4de3eb`).** Add NEW commits on top.
- **Do NOT open a PR yet.** PR is opened at CLOSE, after tester PASS.
- **Do NOT use `--no-verify` or skip pre-commit hooks** (per operator standing rule). Any pre-commit hook failure should be investigated, not bypassed.
- **Do NOT alter the WORKTREE_REGISTRY row** — orchestrator removes that at CLOSE, not now.

---

## Downstream routing (after rework + re-REVIEW APPROVED)

1. **Claude `mingla-tester`** — iOS Simulator + Android Emulator parity TEST + operator-attested physical iPhone pan-down live-fire. Tester writes the SC-28 adversarial regression test at a real path (see Observation O-2) and produces `Mingla_Artifacts/reports/QA_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` with verdict PASS / CONDITIONAL PASS / FAIL.

2. **Claude `mingla-orchestrator`** — CLOSE. Includes Step 0.5 regression-test gate (both implementor + tester tests cited with commit hashes), Step 1 artifact updates (WORLD_MAP / COVERAGE_MAP / etc.), Step 1.5 DIAG-marker reap (`grep -rn "\[ORCH-0975-DIAG\]"` → expect zero), Step 1.7 worktree-registry row removal in CLOSE commit, Step 2 commit message (NO `[deploy]` tag — `app-mobile/` is not a Vercel surface), Step 3 EAS OTA publish via `cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0975: redesigned consumer notifications sheet"`, Step 1.7 reap (`scripts/orch-worktree/reap.sh`).

---

## Comms-ledger acknowledgement

Acked at REVIEW entry (this turn): COMMS-0002 (ORCH-0863 strict-grep gate scope — N/A, this REVIEW does not push to `supabase/functions/`), COMMS-0003 (external-API docs verification — N/A, no external API touched), COMMS-0004 (INTAKE ID scan — N/A, this is REVIEW not INTAKE), COMMS-0005 (ORCH-0964 collision — N/A, different files). Orchestrator will append `mingla-orchestrator+claude (ORCH-0975 REVIEW — N/A)` to each row's `acked_by` in a separate direct-to-main commit on the anchor.

---

**End of REVIEW_ORCH-0975. Verdict: NEEDS WORK (mechanical — commit all 37 files; re-run fails-on-revert; update report §6 hash). Substantive code is APPROVED pending rework completion.**
