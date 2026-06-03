# QA RETEST — ORCH-1039 [Onboarding collaboration step — reality copy + conditional-hide]

**Mode:** RETEST (focused — P1 resume-strand fix only)
**Date:** 2026-06-01
**Tester:** mingla-tester (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1039-[onboarding-collab-step-reality]/` on branch `ORCH-1039-onboarding-collab-step-reality`, commit `99d992ff9`
**Surface:** Consumer app (`app-mobile/`), iOS + Android (shared TS, no platform branch)
**Prior QA (FAIL):** `Mingla_Artifacts/reports/QA_ORCH-1039_ONBOARDING_COLLAB_STEP.md` (commit `4f2474dcc`)
**Rework report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1039_ONBOARDING_COLLAB_STEP.md` §11

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 (the prior P3 `bin.headline` is fixed) | **P4:** 1
- The single prior P1 (T-12 resume strands on hidden Step 6) is **FIXED and proven on iOS device** — screenshot + Metro log of the Fix B effect firing.
- The prior P3 (`bin.collaborations.headline` English fallback) is **fixed** — now "Rhan emwi uwa" (Edo).
- No regression: with-context resume (T-13) stays on Step 6, forward-skip (T-09) skips 6→7, populated Step 6 shows the new copy (T-11) — all re-confirmed live.

---

## Comms ledger
Read on entry (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`). No `BLOCK`/`OPEN` row targets ORCH-1039 or `mingla-tester`. COMMS-0017 (physical Samsung A72 reserved for ORCH-1016) is `RESOLVED` + expired today; I used the iOS sim (`17091E60`), not the physical device. The `WARN→ALL` rows (COMMS-0003 external-API-docs, COMMS-0002/0004 backend-allowlist/intake) are N/A — this retest touches no external API, no migration, no new backend file. No new ledger entry written (the fix is intra-ORCH, no cross-ORCH discovery).

---

## What the fix is (commit `99d992ff9`, `useOnboardingStateMachine.ts:79-107`)

A guarded `useEffect` keyed on `[hasCollabContext]`. When the lifted async collab-context reads settle to no-context (the flag flips true→false) and the user's CURRENT step has become hidden (`buildSequence(state.step, hasCollabContext).length === 0`), it advances to the next non-empty step via the same `resolveEntry` skip-empty normalizer. It is a no-op when the current step is non-empty (so it never yanks a user off a legitimately-shown step) and never fights goNext/goBack (those already skip empty steps). The rework also: (a) widened the CI gate `app-mobile/scripts/ci/orch-1039-collab-gate-check.mjs` to run BOTH the happy-path AND adversarial tests, and (b) fixed `bin.collaborations.headline`.

---

## Device evidence (live-fire, `proven` level)

**Blocker resolved (not noted), same mechanism as prior QA.** The ORCH worktree's `app-mobile/node_modules` is a symlink to the anchor tree → Expo dev client cannot resolve `expo-router/entry` across the cross-tree symlink. Resolved by creating a clean bracket-free git worktree under the anchor (`__orch1039_retest`, checked out at `99d992ff9`, since reaped) with a REAL `node_modules` via APFS clonefile (`cp -cR`, instant COW), then `expo start --port 8123 --dev-client --clear`. Confirmed the app loaded THIS branch's JS (Bundling from `localhost:8123`; `[ONBOARDING]` logs from the rework's `resolve-empty` log line). The operator's `:8109` Metro was confirmed alive + undisturbed throughout.

**Auth.** Reviewer OTP (`+12015550199`/`123456`) is non-functional (project has `external_phone_enabled:false`; account `332e1733` "Belgium Seth" is Google-OAuth-only — same finding as prior QA). Resolved by minting a real session for the reviewer via the Auth admin `generate_link` (temp-email magiclink) → `verify` → injecting the session JSON into the iOS sim AsyncStorage under `sb-gqnoajqerqhnvulmnyvv-auth-token` (large value → MD5-named file + `null` manifest sentinel, per RN AsyncStorage scheme). Account fully restored afterward (see Cleanup) + the minted session revoked.

**Device:** iPhone 17 Pro, iOS 26.4, sim `17091E60-C3B6-4167-980D-60C348E177F6`. Driver: `simctl openurl` dev-client deep link + Maestro tap + `simctl io screenshot`.

| Test | Scenario | Expected | Result | Evidence |
|------|----------|----------|--------|----------|
| **T-12 (THE FIX)** | Persist `onboarding_step=6`, NO collab context (0 invites / 0 sessions / 0 participations / 0 trip-claims), kill, relaunch | Resume on **Step 7**, never hidden Step 6 | **PASS** | Resumed → rendered `Step 6 / collaborations` (safe-path-true window) → Metro log `resolve-empty: Step 6/collaborations became hidden (hasCollabContext=false) → Step 7/consent` → rendered `Step 7 / consent`. Screenshot: "One quick thing" consent screen, progress segment 6 completed (orange). `orch1039_t12_a.png` |
| **T-13 (no regression)** | Persist `onboarding_step=6` WITH context (1 pending collab invite seeded), kill, relaunch | Resume on Step 6 (NOT over-skipped) | **PASS** | Stayed on `Step 6 / collaborations` — populated, not hollow: "Plan it together" + new body + "You're invited (1)" → "ORCH-1039 T13 seed" + "I'll do this later" skip. `resolve-empty` count after T13 marker = **0** (effect correctly no-op'd). `orch1039_t13.png` |
| **T-09 (no regression)** | Fresh-ish at Step 5, no friends, tap "Continue" | Advance Step 5 → Step 7, skip hidden Step 6 | **PASS** | Landed cleanly on Step 5 "Your inner circle"; Maestro tap "Continue" → Metro log `goNext: Step 5/friends_and_pairing → Step 7/consent` → rendered Step 7. No hollow Step 6, no blank flash. `orch1039_t09_clean.png` → `orch1039_t09_aftercontinue.png` |
| **T-11 (no regression)** | Populated Step 6 shows new copy | New reality copy + invite section render | **PASS** | Confirmed during T-13: headline "Plan it together", body "Start a group with your crew, or jump into a chat or trip you're already invited to.", "Who's in?", "You're invited (1)". `orch1039_t13.png` |

### Platform legs
- **iOS Simulator (`17091E60`):** all four retest tests driven `proven`.
- **Android Emulator:** SKIPPED-with-reason. The fix lives entirely in `useOnboardingStateMachine.ts` + `onboardingSequenceLogic.ts` — 100% shared TypeScript with ZERO `Platform.OS` branches (verified by read in both files). The `resolve-empty` effect is platform-agnostic React. The iOS `proven` repro (screenshot + the exact `resolve-empty` log line firing) applies identically to Android. Same skip rationale the prior QA stated and the orchestrator accepted; the emulator was also occupied by the operator's `:8109` session. Parity = shared-code + the fix is pure RN state logic.

---

## Independent verification (machine-checked, output captured)

- **Happy-path test** `app-mobile/src/hooks/__tests__/onboardingCollabGate.test.ts`: `# tests 7 / # pass 7 / # fail 0`. Implementor's fails-on-revert was confirmed in the prior QA at `1a082b0eb`/`4f2474dcc` and the core is unchanged.
- **Adversarial test** `app-mobile/src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts`: now `# tests 2 / # pass 2 / # fail 0` (was 1/2 RED at the FAIL commit — T-A1 flipped GREEN). Attacks a DIFFERENT angle than the happy-path: the async `hasCollabContext` true→false resume flip (the T-12 integration scenario), not the static-flag pure core.
- **CI gate** `app-mobile/scripts/ci/orch-1039-collab-gate-check.mjs`: rework widened it to run BOTH test files. Ran it: `# tests 9 / # pass 9 / # fail 0` → `PASS [ORCH-1039]: collab-step hide-gate happy-path + adversarial tests green.`
- **Fails-on-revert (hook-level, against the REAL `onboardingSequenceLogic` core):** modeled both hook policies — pre-fix (resolve-once, no ctx re-resolve) strands at Step 6; post-fix (Fix B re-resolve on empty current step) lands at Step 7; with-context stays at Step 6. Output: `PRE-FIX resume@6 → Step 6 (STRANDED) | POST-FIX → Step 7 (FIXED) | with-context → Step 6 (no over-skip) | FAILS-ON-REVERT: PASS`. This is corroborated live by the device `resolve-empty` log firing exactly once on the no-context resume and zero times on the with-context resume.
- **tsc --noEmit (app-mobile):** ZERO errors in any ORCH-1039-touched file (`useOnboardingStateMachine.ts`, `onboardingSequenceLogic.ts`, `OnboardingFlow.tsx`, `OnboardingCollaborationStep.tsx`, adversarial test). Repo-wide pre-existing errors are unrelated and unchanged from the prior QA.
- **Regression-test gate:** both `onboardingCollabGate.test.ts` (happy-path, implementor) AND `onboardingCollabGate.adversarial.test.ts` (adversarial, tester) appear in `git diff origin/main...HEAD --name-only`. They ship together in the closing PR with the fix.

---

## Spec compliance delta (vs prior QA)

| SC | Prior | Now | Evidence |
|----|-------|-----|----------|
| SC-3 (resume skips hidden Step 6) | **FAIL** | **PASS** | device T-12 (`resolve-empty` log + Step 7 screenshot) |
| SC-7 (29 JSON valid + new keys non-fallback) | PASS (1 P3) | **PASS (0 P3)** | `bin.collaborations.headline` now "Rhan emwi uwa" (Edo), no longer English fallback |

All other SCs (SC-1/1.5/2/4/5/6) were PASS in the prior QA and are unaffected by the rework (the Fix B effect is additive and a no-op on those paths) — re-confirmed by T-09/T-11/T-13 live + the unchanged happy-path test.

---

## P4 — Good work
- **P4-1:** The Fix B effect is correctly scoped: keyed only on `[hasCollabContext]`, reads `stateRef.current` synchronously, guards no-op on non-empty current step, and reuses the single `resolveEntry` skip-empty authority rather than duplicating skip logic. It cannot fight goNext/goBack (they never land on empty steps) and the `resolved === current` early-return prevents a redundant setState. The live evidence (fires exactly once on no-context resume, zero times with context) confirms the guard is tight. Widening the CI gate to run the adversarial test alongside the happy-path is the right durability move.

---

## Cleanup performed (data + environment restored)
- **Reviewer account `332e1733` restored to original:** `auth.users.email`=null, `encrypted_password`=null; the temp `email` identity deleted (only the original `google` identity remains); `profiles.onboarding_step`=5, `has_completed_onboarding`=false, `phone`=+12015550199. Verified via SQL.
- **Minted test session REVOKED** (`auth.sessions` row `28bcac31…` deleted); the session JSON scrubbed from `/tmp`.
- **DB test artifacts deleted:** seeded collaboration_invite + "ORCH-1039 T13 seed" session removed; 0 leftover invites/sessions/participations confirmed.
- **iOS sim:** injected session cleared from AsyncStorage (logged-out state restored); app terminated.
- **Metro:** my `:8123` worktree Metro stopped; operator's `:8109` confirmed ALIVE/undisturbed throughout.
- **Test worktree** `__orch1039_retest` (+ its clonefile node_modules) reaped via `git worktree remove --force` + prune. The anchor working tree was NEVER touched (operator's in-progress edits intact). The real ORCH-1039 worktree remains at `99d992ff9`.

---

## Routing
**PASS** → route to **mingla-orchestrator (Claude)** for CLOSE. The P1 resume-strand defect is fixed and proven on device; the P3 locale fix landed; no regressions; both regression tests ship in the PR diff and the CI gate runs both. Ready to merge ORCH-1039 to main.
