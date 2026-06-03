# QA — ORCH-1039 [Onboarding collaboration step — reality copy + conditional-hide]

**Mode:** TARGETED (orchestrator-dispatched TEST)
**Date:** 2026-06-01
**Tester:** mingla-tester (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1039-[onboarding-collab-step-reality]/` on branch `ORCH-1039-onboarding-collab-step-reality`, commit `4f2474dcc`
**Surface:** Consumer app (`app-mobile/`), iOS + Android
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1039_ONBOARDING_COLLAB_STEP.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1039_ONBOARDING_COLLAB_STEP.md`

---

## VERDICT: FAIL (1 P1 defect)

- **P0:** 0 | **P1:** 1 | **P2:** 0 | **P3:** 1 | **P4:** 2
- The copy rewrite, the forward-flow hide gate, back-nav, the with-context resume, and localization are all **PASS, proven on iOS device**.
- **One P1 resume edge case fails on device (T-12):** a user persisted at `onboarding_step === 6` with NO collaboration context resumes onto the **hidden Step 6 hollow placeholder**, NOT Step 7 — the exact "empty Step 6" the ORCH exists to eliminate, in the resume path.

---

## Comms ledger
Read on entry. No `BLOCK`/`OPEN` row targets ORCH-1039 or `mingla-tester`. COMMS-0017 (physical Samsung A72 reserved for ORCH-1016) is RESOLVED + I used the emulator, not the physical device. COMMS-0003 (external-API docs) N/A — no external API touched. No new ledger entry written (the defect is intra-ORCH, not cross-ORCH).

---

## Device evidence (live-fire, `proven` level)

**Blocker resolved (not noted):** the worktree's `node_modules` is a symlink to the anchor tree; Expo's dev client cannot resolve `expo-router/entry` across a cross-tree symlink (red-box `Unable to resolve module ./app-mobile/node_modules/expo-router/entry`). Resolved by creating a clean bracket-free git worktree under the anchor (`__orch1039_test`, since reaped) and giving it a REAL `node_modules` via an APFS clonefile copy (`cp -cR`, instant COW), then `expo start --port 8119 --dev-client --clear`. Bundle then served + the app ran this branch's JS (dev menu "Connected to: http://localhost:8119"). Operator's :8109 Metro was left untouched throughout.

**Auth:** the dispatch's reviewer phone OTP (`+12015550199`/`123456`) is NOT functional — the project has `external_phone_enabled:false` + no `sms_test_otp` configured, and account `332e1733` ("Belgium Seth") is actually a **Google-OAuth** account (`profiles.phone` carries +12015550199 but `auth.users` has only a google identity). Resolved by minting a real session via admin temp-email magiclink → injecting it into the iOS sim AsyncStorage (`sb-…-auth-token`). Account fully restored afterward (see Cleanup).

| Test | Scenario | Expected | Result | Evidence |
|------|----------|----------|--------|----------|
| **T-09** | Fresh, no friends, advance past Step 5 | Land on Step 7; Step 6 never visible | **PASS** | `goNext: Step 5/friends_and_pairing → Step 7/consent`; screen shows Step 7 "One quick thing" consent; progress bar segment 6 shows COMPLETED while on Step 7. `ios_21b`→`ios_22b` |
| **T-10** | No friends, on Step 7, Back | Land on Step 5, skip hidden Step 6, no blank flash | **PASS** | `goBack: Step 7/consent → Step 5/friends_and_pairing`; screen shows Step 5 "Your inner circle". `ios_23b` |
| **T-11** | Add a friend in Step 5, advance | Step 6 shows with new copy + "Start the group" CTA | **PASS** | Friend invited → "YOUR PEOPLE (1)"; `goNext: Step 5 → Step 6/collaborations`; Step 6 renders headline "Plan it together", body "Start a group with your crew, or jump into a chat or trip you're already invited to.", "Who's in?" + chip, "I'll do this later" skip; session-name + create-form surface on chip-select; creating a session flips footer to "Continue". `ios_27b`/`ios_28b`/`ios_29b` |
| **T-12** | Kill on Step 6 with NO context, relaunch | Resume on Step 7, never hidden Step 6 | **FAIL (P1)** | Resumed + parked on **Step 6 / collaborations hollow placeholder** ("Plan it together" / "Who's in?" with EMPTY chip strip), 70s+, no goNext/goBack, no advance. `ios_36`/`ios_37`. Root cause below. |
| **T-13** | Kill on Step 6 WITH context, relaunch | Resume on Step 6 | **PASS** | With a pending collab-invite seeded, resumed stably on `Step 6 / collaborations`; "You're invited (1)" section renders (localized invite strings). `ios_32` |
| **T-14** | Non-EN locale, populated Step 6 | Headline/body/CTA/trip-chat strings translated | **PASS** | ES locale: headline "Planéenlo juntos", body "Crea un grupo con tu gente, o únete a un chat o viaje al que ya te invitaron.", "¿Quién se apunta?", "Atrás". `ios_38` |

**Progress bar (SC-5):** PASS — fixed 7-segment bar; on Step 7 after skipping Step 6, segment 6 renders COMPLETED (orange), segment 7 grey. Never stuck/blank. Confirmed in `ios_22b`.

### Platform legs
- **iOS Simulator (iPhone 17 Pro, iOS 26.4, `17091E60`):** all 6 tests driven `proven`. Maestro + simctl, screenshots captured.
- **Android Emulator (Pixel 8 Pro, `emulator-5554`):** the dev build was repointed to :8119 and **confirmed running this branch's JS** (`Android Bundled … expo-router/entry.js` in Metro). Full onboarding walk on Android was NOT driven: the emulator is occupied by the operator's live `:8109` session (logged in as a different, fully-onboarded user), and driving onboarding would require logging that user out + injecting a reviewer session — disruptive to a possibly-live operator session. The onboarding sequencing core (`onboardingSequenceLogic.ts`), the state-machine hook, the gate, and the copy are **100% shared TypeScript with zero `Platform.OS` branches** (verified by read), so the iOS behavior — including the T-12 defect, which is pure shared logic — is platform-identical. Android leg = **parity-by-shared-code + bundle-confirmed-on-device**; the iOS T-12 FAIL applies identically to Android. (Stated skip-with-reason per the parity rule.)

---

## P1 — T-12 resume strands the user on the hidden Step 6

**Severity:** P1 (the precise failure mode the ORCH exists to remove — the hollow Step 6 placeholder — reappears in the resume path).
**Where:** `app-mobile/src/hooks/useOnboardingStateMachine.ts:47-49, 72-77`.
**Proven:** on iOS device (`ios_36`/`ios_37`) AND by an independent adversarial unit test (RED).

**Root cause.** With the FULLER (operator-override) gate, `hasCollabContext` is derived from two ASYNC server reads lifted into `OnboardingFlow`, and defaults to the SAFE/eligible (`true`) value while those reads load (`OnboardingFlow.tsx:770-788`, term `!invitesFirstLoadDone || liftedTripClaimsLoading`). The hook resolves the entry step via a lazy `useState` initializer ONCE (`resolveEntry(initialStep, hasCollabContext)`), and re-resolves ONLY when `initialStep` changes (the `appliedInitialStep` ref guard, lines 72-77). It does NOT re-resolve when `hasCollabContext` flips.

Resume sequence for a no-context user persisted at step 6:
1. App resumes; lazy/`appliedInitialStep` resolves `resolveEntry(6, true)` (reads still loading ⇒ safe path) → **state = Step 6**.
2. `loadUserSessions` + trip-claim reads settle to no-context → `hasCollabContext` flips to **false** → Step 6 is now hidden (`buildSequence(6,false)===[]`).
3. `initialStep` is unchanged (still 6), so the `appliedInitialStep` guard never re-fires, and there is no other effect watching `hasCollabContext`. **State stays on the now-hidden Step 6** → the hollow "Who's in?" placeholder, exactly what §3.6 "Net resume contract" + SC-3 promised would never happen.

The forward path (T-09) is unaffected because `addedFriends.length===0` is synchronous local data evaluated correctly at the moment of `goNext`. The bug is specific to the **resume-at-step-6** path where the async safe-path window masks the no-context state and nothing re-resolves afterward.

**Why the impl's own tests + SPEC missed it.** The implementor's happy-path test (`onboardingCollabGate.test.ts`) only exercises the pure core with a STATIC `hasCollabContext` — `resolveEntry(6,false)` is correctly Step 7. The pure core is correct; the defect lives in the React adapter's resolve-once policy interacting with the async safe-path default. The SPEC §3.6 resume guard was written against the MVP synchronous `addedFriends`-only gate; the operator's FULLER async gate (§3.3 override) silently invalidated the guard's "hasCollabContext known at resolve time" assumption.

**Fix (for implementor rework).** Re-resolve (or skip-forward off) the current step when `hasCollabContext` flips such that the current `state.step` becomes empty. Concretely: an effect in `useOnboardingStateMachine` that, when `buildSequence(state.step, hasCollabContext).length === 0`, advances `state` to the next non-empty step (mirrors `resolveEntry`/`advance` skip-empty). Guard it so it fires only on the false-flip (not on the safe-path true window) and never yanks a step the user is actively interacting with mid-substep. T-A1 (below) turns GREEN when fixed; re-run T-12 on device to confirm.

---

## P3 — `bin` (Edo/Bini) locale headline left as English fallback

**Where:** `app-mobile/src/i18n/locales/bin/onboarding.json` → `collaborations.headline` = `"Plan it together"` (English).
The `bin` body + `start_button` + all four `trip_chats_*` keys ARE properly translated to Edo (e.g. body "Bụlọ otu vbe iyẹnmwẹ ruẹ…", start_button "Bụlọ otu"). Only the headline reverted to English; the prior `bin` headline ("Rhan emwi uwa") was a real translation. SPEC §3.1.d explicitly said NOT to perpetuate English fallbacks. 28/29 locales fully translated; this one key in one locale is the only miss. Low impact (cosmetic, single key, single least-common locale). Fix: translate `bin.collaborations.headline`.

---

## P4 — Good work
- **P4-1:** Extracting the sequencing into the dependency-free `onboardingSequenceLogic.ts` decision core (mirroring the ORCH-1028 `launchCityGateLogic.ts` precedent) is exactly right — it made the gate unit-testable under Node's built-in runner with no jest, and the skip-empty logic in `advance`/`retreat`/`resolveEntry` reads from a single `buildSequence` authority so forward/back/resume cannot diverge. The pure core is correct and clean.
- **P4-2:** The 28-locale translation fan-out is high quality (faithful, non-calque, register-matched) and JSON-valid across all 29 files.

---

## Spec compliance matrix

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 (reality copy + new CTA key, no "session") | PASS | EN block exact; CTA `collaborations.start_button`; device T-11 |
| SC-1.5 (Step 6 hidden when no context, 5→7) | PASS | device T-09 + `goNext: 5→7` log |
| SC-2 (back-nav skips hidden Step 6, 7→5) | PASS | device T-10 + `goBack: 7→5` log |
| SC-3 (resume skips hidden Step 6) | **FAIL** | device T-12: resume@6 no-context strands on hidden Step 6 (P1) |
| SC-4 (trip-chat strings localized) | PASS | source key-swap + ES render (T-14) + "You're invited" section (T-13) |
| SC-5 (7-segment bar correct, never NaN) | PASS | device (segment 6 completed on Step 7) + T-07 unit |
| SC-6 (`onSkip` removed, compiles) | PASS | grep: `onSkip` absent from collab component + its render site (the `onSkip` at OnboardingFlow.tsx:3191 belongs to the Step-5 friends component, not the collab step); tsc clean on touched files |
| SC-7 (29 JSON valid + new keys non-fallback) | PASS (1 P3) | 29/29 parse, all 5 new keys present; only `bin.headline` is an EN fallback (P3) |

---

## Independent verification (machine-checked, output captured)

- **Implementor happy-path test** `app-mobile/src/hooks/__tests__/onboardingCollabGate.test.ts`: `# tests 7 / # pass 7 / # fail 0`. **Fails-on-revert independently confirmed** — neutralizing the `buildSequence` Step-6 skip flips 5/7 to `not ok` (T-04/T-05/T-06/T-07/T-08), restore → 7/7 green. Implementor cited fails-on-revert at `1a082b0eb`; I re-verified at HEAD `4f2474dcc`.
- **Tester adversarial test** `app-mobile/src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts` (NEW, staged on the ORCH branch): attacks a DIFFERENT angle — the async `hasCollabContext` true→false flip on resume (the T-12 integration scenario), which the implementor's static-flag test does not cover. Currently **RED on T-A1** (documents the P1 defect) and GREEN on T-A2 (isolates the fix to the hook's re-resolution). It turns GREEN when the P1 is fixed. Run: `node --experimental-strip-types --test src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts` → `# tests 2 / # pass 1 / # fail 1`.
- **tsc --noEmit:** 260 repo-wide pre-existing errors; **ZERO in any ORCH-1039-touched file** (grep of the touched paths returned nothing). Matches impl claim.
- **Regression-test gate:** both tests present on the ORCH branch (`git status` shows the implementor's committed + the tester's staged). On a FAIL→REWORK, they ship together in the closing PR after the fix.

---

## Cleanup performed (data + environment restored)

- **Reviewer account `332e1733` restored to original:** `auth.users.email`=null, `encrypted_password`=null, temp `email` identity deleted (only the original `google` identity remains); `profiles.onboarding_step`=5, `has_completed_onboarding`=false, `profiles.phone`=+12015550199 — all original.
- **DB test artifacts deleted:** the created "Weekend plans" session, its `session_participants` row, and the seeded pending `collaboration_invite` — 0 leftover invites/sessions/participants confirmed.
- **iOS sim:** injected session + onboarding data + ES locale override cleared from AsyncStorage (logged-out EN state restored).
- **Android emulator:** repointed back to the operator's `:8109` build; my `adb reverse tcp:8119` removed; the operator's `tcp:8109` reverse left intact.
- **Metro:** my `:8119` worktree Metro stopped; operator's `:8109` confirmed still ALIVE/undisturbed.
- **Temp worktree** `__orch1039_test` (with its metro.config test-edit) reaped via `git worktree remove`. Anchor working tree never touched (operator's in-progress edits intact). Real ORCH worktree carries only the staged adversarial test.

---

## Routing
FAIL → route to **mingla-implementor (Claude)** for rework of the single P1 (hook re-resolution on `hasCollabContext` false-flip) + the P3 `bin.headline` translation. The adversarial test (T-A1) is the acceptance gate for the P1 fix; re-run device T-12 to confirm the resume lands on Step 7. Then RETEST.
