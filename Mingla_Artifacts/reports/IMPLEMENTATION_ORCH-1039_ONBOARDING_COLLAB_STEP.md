# IMPLEMENTATION — ORCH-1039 [Onboarding collaboration step — reality copy + conditional-hide]

**Mode:** IMPLEMENT (mingla-implementor, Claude parity side)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1039-[onboarding-collab-step-reality]/` on branch `ORCH-1039-onboarding-collab-step-reality`
**Surface:** Consumer app (`app-mobile/`), iOS + Android ONLY
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1039_ONBOARDING_COLLAB_STEP.md` (amended in this pass to record the operator overrides)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1039_ONBOARDING_COLLAB_STEP_REALITY.md`
**Status:** implemented and verified (state-machine logic + copy + TS + lint + happy-path test + fails-on-revert). Runtime sim/emulator verification is the tester's adversarial pass (T-09…T-14).

---

## 0. Operator-locked overrides applied (supersede the SPEC where they differ)

The SPEC had MVP (`addedFriends`-only) as primary. The operator chose **Fuller**. As shipped:

1. **Copy (final EN, fanned to all 29 locales):**
   - `collaborations.headline` = "Plan it together"
   - `collaborations.body` = "Start a group with your crew, or jump into a chat or trip you're already invited to." (covers BOTH paths — start a new group AND join an existing invite/chat/trip)
   - `collaborations.start_button` = "Start the group" (NEW key; the shared `common:start_session` was NOT edited — lower blast radius)
   - Existing "I'll do this later" skip CTA unchanged. No "session" framing in headline/body.
2. **Fuller hide condition:** `addedFriends.length > 0 || hasPendingCollabInvites || hasExistingSessions || hasPendingTripChatClaims`. Required lifting the invite + session + trip-claim reads up into `OnboardingFlow` so `getSequence` evaluates them before the step renders. Reads are non-blocking with a safe-path default while loading.
3. 4 hardcoded trip-chat strings localized + dead `onSkip` callback removed.

---

## 1. Old → New Receipts

### `app-mobile/src/hooks/onboardingSequenceLogic.ts` (NEW FILE)
**Before:** did not exist. Sequencing logic lived inline in `useOnboardingStateMachine.ts` and was untestable (React hook, no jest/renderHook in this app).
**Now:** dependency-free decision core (`STEP_SUBSTEPS`, `buildSequence`, `advance`, `retreat`, `resolveEntry`, `computeSegmentFill`). `buildSequence(6, false)` returns `[]` (Step 6 hidden); `advance`/`retreat`/`resolveEntry` skip over empty-sequence steps; `computeSegmentFill` guards against empty/single sequences (never NaN). Types imported `import type` so the module runs under Node's `--experimental-strip-types` runner (mirrors the `launchCityGateLogic.ts` ORCH-1028 precedent).
**Why:** SC-1.5/SC-2/SC-3/SC-5; makes the hide gate unit-testable (Step-0.5).
**Lines:** ~190 new.

### `app-mobile/src/hooks/useOnboardingStateMachine.ts`
**Before:** owned the static `STEP_SUBSTEPS` table + inline `goNext`/`goBack`/`progress`/initial-state logic; accepted `{ initialStep, hasGpsPermission }`; static `useState` initializer + static `STEP_SUBSTEPS[initialStep][0]` on initialStep-change.
**Now:** thin React adapter over the core. Accepts a NEW `hasCollabContext: boolean` prop. `goNext`/`goBack` delegate to `advance`/`retreat`; `progress` delegates to `computeSegmentFill`; the `useState` initializer and the `appliedInitialStep`-change `setState` both go through `resolveEntry(initialStep, hasCollabContext)` (lazy initializer) so a resume at a hidden step never paints it — not even one frame. A `hasCollabContextRef` keeps the latest flag readable synchronously inside the stable callbacks. `hasGpsPermission` retained in the prop contract (renamed `_hasGpsPermission`, reserved for the Step-4 manual_location branch).
**Why:** SC-1.5/SC-2/SC-3/SC-5; the hide gate + resume normalizer.
**Lines:** rewritten (~165 → ~135).

### `app-mobile/src/components/OnboardingFlow.tsx`
**Before:** `useOnboardingStateMachine({ initialStep, hasGpsPermission })`; collaborations step always reached; `<OnboardingCollaborationStep ... onSkip={() => {}} />` (dead callback); the invite + trip-claim reads lived only inside the child step.
**Now:** lifts `useSessionManagement()` (`pendingInvites`, `loadUserSessions`) + `usePendingTripChatClaims()` (`claims`, `loading`) up to the flow. A one-shot `useEffect` kicks `loadUserSessions()` (which does NOT auto-load) and flips `invitesFirstLoadDone`, with a 10s safety release so a hung read can never block onboarding. `hasCollabContext` = the FULLER four-signal OR, with a safe-path term (`!invitesFirstLoadDone || tripClaimsLoading`) so the step stays eligible while server reads resolve (no flash-then-yank). Passes `hasCollabContext` into the hook. Removed `onSkip={() => {}}`. Added imports for the two hooks.
**Why:** Fuller hide condition (operator override); dead-code removal (SC-6).
**Lines:** +~50 / −2.

### `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx`
**Before:** CTA used `t('common:start_session')`; four hardcoded English trip-chat strings ("Your trip and event chats", "Loading chats…", "Join the buyer group chat", "Join chat"); `onSkip: () => void` in the props interface + destructure.
**Now:** CTA reads `t('onboarding:collaborations.start_button')`; the four trip-chat strings read `t('onboarding:collaborations.trip_chats_header'|'trip_chats_loading'|'trip_chats_join_subtitle'|'trip_chats_join_button')`; `onSkip` removed from the interface and the destructure. No layout/style/data-fetch change.
**Why:** SC-1 (CTA reframe), SC-4 (trip-chat localization), SC-6 (dead-prop removal).
**Lines:** ~6 changed / 1 removed.

### `app-mobile/src/i18n/locales/<29 langs>/onboarding.json`
**Before:** `collaborations.headline` = "Plan something together" (or English fallback in pl/ro/ru/sv/tr/uk); `collaborations.body` = pre-0929 "Start a session…" framing; no `start_button` or `trip_chats_*` keys.
**Now:** all 29 locales carry the locked EN headline/body/start_button (faithfully translated for the 28 non-EN, never literal calques, no English fallback) plus the four new `trip_chats_*` keys. EN exactly matches the operator-locked values. JSON round-trip is byte-identical outside the changed block (2-space indent, ensure_ascii=False, trailing NL).
**Why:** SC-1, SC-4, SC-7 (reality-match copy + localization + coverage).
**Lines:** ~7 keys × 29 files.

### `app-mobile/src/hooks/__tests__/onboardingCollabGate.test.ts` (NEW)
Step-0.5 happy-path test (Node built-in runner) — see §4.

### `app-mobile/scripts/ci/orch-1039-collab-gate-check.mjs` (NEW) + `package.json`
CI wrapper `npm run test:orch-1039` (mirrors the `test:orch-1028` pattern).

### `scripts/orch1039_i18n_fanout.py` (NEW, repo-root scripts/)
The translation fan-out helper, kept alongside the existing `scripts/orch-0670-translate-locales.py` / `orch-0690` precedent (this dir is the established home for per-ORCH locale fan-out scripts). Re-runnable; idempotent.

---

## 2. Spec traceability

| SC | Criterion | How implemented | Verdict |
|----|-----------|-----------------|---------|
| SC-1 | Reality-match copy + new CTA key, no "session" in headline/body | EN locked values fanned to 29 locales; CTA → `collaborations.start_button` | PASS (copy + key-swap verified; render is shared RN code) |
| SC-1.5 | Step 6 hidden when no context (5 → 7) | `buildSequence(6,false)=[]` + `advance` skip-empty | PASS (T-04, T-05); runtime → tester T-09 |
| SC-2 | Back-nav skips hidden Step 6 (7 → 5) | `retreat` skip-empty | PASS (T-06); runtime → tester T-10 |
| SC-3 | Resume skips hidden Step 6 | `resolveEntry` lazy initializer | PASS (T-08); runtime → tester T-12/T-13 |
| SC-4 | Trip-chat strings localized | 4 keys + component swap | PASS (key-swap verified; locale toggle → tester T-14) |
| SC-5 | 7-segment progress bar stays correct | Fixed-7 bar keyed off raw step; `computeSegmentFill` never NaN | PASS (T-07; SegmentedProgressBar `i < currentStep` confirmed, no math change) |
| SC-6 | `onSkip` removed, compiles | Removed from interface + destructure + render site; tsc clean | PASS |
| SC-7 | All 29 JSON valid + new keys non-fallback | Programmatic validation: 29/29 parse, all 5 new keys present, no English-fallback headlines | PASS |

---

## 3. Cross-surface impact (Step 3.5)

- **Consumer iOS / Android (1,2):** AFFECTED. Shared RN code path → parity automatic. New copy + hidden Step 6 when no context. Tester confirms runtime sequencing/back-nav/resume on both an iOS sim and an Android emulator (SC-1.5/2/3 per-platform).
- **Buyer-anon Web (3), Business iOS/Android (4,5), Admin Web (6), Business Web preview (7):** NOT AFFECTED — onboarding's collaboration step exists only in the consumer app; no analog renders elsewhere.

Affected-surface count = 2, parity automatic (single shared code path) — no manual-parity drift to register.

---

## 4. Regression test

- **Path:** `app-mobile/src/hooks/__tests__/onboardingCollabGate.test.ts` (runner: `npm run test:orch-1039`).
- **Passing run:** `# tests 7 / # pass 7 / # fail 0` → `PASS [ORCH-1039]`.
- **Coverage:** T-04 (buildSequence omits Step 6 without context, includes with), T-05/T-05b (advance skips/doesn't-skip), T-06/T-06b (retreat skips/doesn't-skip), T-07 (segmentFill finite in (0,1] across full walk + Step 6 never current), T-08 (resolveEntry resume normalizer).
- **fails-on-revert verified at `1a082b0eb`:** disabling the `buildSequence` Step-6 skip flips 5 of 7 to `not ok` (T-04, T-05, T-06, T-07, T-08 — exactly the gate-dependent assertions; the two "with context" tests stay green, which is correct). Fix restored → 7/7 green again.

The tester writes the SECOND, adversarial test (runtime resume + back-nav, both platforms) separately.

---

## 5. Verification matrix (the /goal five clauses)

1. **Spec criteria implemented + demonstrated:** §2 table — logic criteria proven by tests; copy/key/JSON proven by programmatic checks; runtime SCs handed to tester per SPEC §6.
2. **Regression test green + fails-on-revert @ `1a082b0eb`:** §4. ✅
3. **`tsc --noEmit` clean + lint clean on touched files:** the 4 touched source files + new core + test produce ZERO tsc errors (260 repo-wide errors are pre-existing/unrelated — Deno test stubs, JSX namespace, etc., none in my files). `eslint` on the core + hook + test = clean; the 4 `react/no-unescaped-entities` errors + assorted warnings in `OnboardingFlow.tsx`/`OnboardingCollaborationStep.tsx` are pre-existing (confirmed absent from my diff). ✅
4. **14 Constitution rules:** scanned — no silent failures (the lifted invite read has a `.catch` + warn + 10s safety release; the trip-claim hook already swallows-to-empty by design), every async surface handled, copy friendly, no `any`/`@ts-ignore` added, no dating framing. PASS / N/A across the board.
5. **Edge functions:** N/A — no edge/DB/migration touched.

---

## 6. Invariants

| ID | Preserved? | How |
|----|-----------|-----|
| I-ONB-SEQUENCE-VALID | Y | advance/retreat/resolveEntry all skip empty steps via the single `buildSequence` authority; T-05/T-06/T-08. |
| I-ONB-PROGRESS-NO-NAN | Y | `computeSegmentFill` returns 1 for empty/single seq; T-07. |
| I-ONB-RESUME-NO-HIDDEN-STEP | Y | `resolveEntry` lazy initializer + `resumeSubStep` is only ever `gender_identity`; T-08. |
| I-COLLAB-DECK-IN-GROUP-CHAT | Y | No Home/active-session concept added; copy describes the real "start a group / join a chat or trip" path; create logic untouched. |
| I-CONSUMER-VOICE-NO-DATING | Y | Body uses crew/group/plan vocabulary; no romantic framing in any of the 29 locales. |

---

## 7. Parity / cache / regression surface

- **Parity:** iOS + Android share one RN code path — automatic. No solo/collab parity axis here.
- **Cache:** no React Query key changes. The lifted `useSessionManagement`/`usePendingTripChatClaims` calls reuse the same hooks the child already used (no new query keys).
- **Regression surface for tester to probe:** (1) onboarding resume at every step still lands correctly (especially gender_identity resume), (2) back-nav from Step 7 with AND without friends, (3) progress bar segment count on the skipped path, (4) a user who DOES add a friend in Step 5 then advances sees Step 6 with the new copy, (5) the populated Step 6 (invites/trip-claims) still renders with localized strings.

---

## 8. Discoveries for orchestrator

- The dead `userPreferences` prop plumbing into `createCollaborativeSessionV2` (investigation Discovery #3) is left UNTOUCHED per scope — register a small cleanup ORCH if desired.
- `OnboardingCollaborationStep`'s `onContinue` prop is now ALSO effectively dead (the component manages `createdSessions` internally and never calls `onContinue`); left in place per scope discipline (SPEC scoped removal to `onSkip` only). Candidate for the same future cleanup ORCH.
- The lifted `useSessionManagement` invite preload now fires once at OnboardingFlow mount for ALL users (previously only when the collab step mounted). Cost is one extra `loadUserSessions` round early in onboarding; non-blocking. Acceptable; flag if the orchestrator wants it deferred until Step 5 completion.

---

## 9. Transition items
None.

## 10. Comms ledger
Read on entry. No `BLOCK`/`OPEN` row targets ORCH-1039 or `mingla-implementor`. COMMS-0003 (external-API docs-cite) is N/A (no external API touched). No new entry written (no cross-ORCH discovery).

---

## 11. REWORK (post-QA FAIL — 2026-06-01)

QA verdict on `4f2474dcc` was FAIL on one P1 (T-12) + one P3. This rework fixes both. The proven forward-skip / back-nav / friend-added-shows-step / progress-bar / localization behaviors are unchanged (no edits to `advance`/`retreat`/`buildSequence`/`computeSegmentFill` or the copy).

### P1 — resume-at-hidden-Step-6 strands the user (the fix)

**Defect (per QA root cause).** The hook resolved the entry once via the lazy `useState` initializer and re-resolved only when `initialStep` changed (the `appliedInitialStep` ref guard). It did NOT react to `hasCollabContext`. On a resume-at-Step-6 with no context, `hasCollabContext` starts on the SAFE (`true`) default while the lifted async server reads load — so the entry resolves to Step 6 — then flips to `false` when the reads settle empty, hiding Step 6 (`buildSequence(6,false)===[]`). Nothing moved the user off it ⇒ stranded on the hollow "Who's in?" placeholder, only in the resume path.

**Effect added** — `app-mobile/src/hooks/useOnboardingStateMachine.ts` ("Fix B"):
```ts
useEffect(() => {
  const current = stateRef.current
  if (buildSequence(current.step, hasCollabContext).length !== 0) return   // guard 1
  const resolved = resolveEntry(current.step, hasCollabContext)
  if (resolved.step === current.step && resolved.subStep === current.subStep) return // guard 2
  setState(resolved)
}, [hasCollabContext])
```

**Guard logic (why it never regresses active-step / forward / back).**
- **Guard 1 — fires only on the false-flip.** The body returns immediately unless the CURRENT step's sequence is empty. A user legitimately on Step 6 *with* context has a non-empty sequence ⇒ no-op; the effect never yanks an actively-used substep. The only way to be parked on an empty step is the resume safe-path window resolving to `false` afterward — exactly the T-12 path.
- **Guard 2 — idempotent.** If `resolveEntry` returns the same step+substep, no `setState` (avoids redundant renders / loops).
- **Does not fight goNext/goBack.** `advance`/`retreat` already skip empty steps, so they can never *land* the user on an empty step; the effect therefore never competes with them. It also runs only on `hasCollabContext` change, not on every nav.
- **Safe-default preserved.** While reads load, `hasCollabContext` stays `true`, Step 6 is non-empty, Guard 1 short-circuits — the show-while-checking behavior is intact. The effect acts only once the context has actually resolved to empty.
- **Uses the same skip-empty normalizer** (`resolveEntry`) as the lazy initializer and `appliedInitialStep` guard, so the resume-empty transition is consistent with every other entry path.

Import added: `useEffect` (line 1).

### P3 — `bin` (Edo/Bini) headline translated

`app-mobile/src/i18n/locales/bin/onboarding.json` → `collaborations.headline`: `"Plan it together"` (English fallback) → `"Rhan emwi uwa"` (the prior real Edo translation, matching the locale's register and the already-translated `body`/`start_button`/`trip_chats_*` keys). JSON re-validated (`require()` parse OK). Grep confirms only `en/onboarding.json` (the source) now carries the English string.

### Adversarial test now GREEN + fails-on-revert

`app-mobile/src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts` (tester's, T-A1/T-A2):
- **Before fix (`4f2474dcc`):** `# tests 2 / # pass 1 / # fail 1` — T-A1 RED (`parked === 6`).
- **After fix:** `# tests 2 / # pass 2 / # fail 0` — both GREEN.
- **Happy-path** `onboardingCollabGate.test.ts`: `# tests 7 / # pass 7 / # fail 0` (unchanged).
- **Fails-on-revert (proven):** neutralizing the skip-empty `while` loop in `resolveEntry` (`onboardingSequenceLogic.ts:145-147` — the core skip-empty authority the Fix-B effect depends on) flips the adversarial test to `# pass 0 / # fail 2` (both T-A1 and T-A2 RED); restoring it → `# pass 2 / # fail 0`. This proves the test exercises the real fix path through the pure core. Separately, the pre-rework state at `4f2474dcc` (helper modeling the old re-resolve-once policy) was independently RED on T-A1, confirming the assertion guards the resume-empty behavior.

**Test-model correction `[TEST-MOD-APPROVED ORCH-1039]`.** The adversarial test's internal model helper `hookResolvedStepAfterContextSettle` was documented as "a faithful model of the hook's CURRENT state-resolution policy." The app has no jest/renderHook (which is why the sequencing core was extracted), so the test cannot render the React hook directly — it models the hook's policy over the pure core. The helper's body previously hardcoded the BROKEN policy (`void ctxAfterSettle` — never re-resolved), making it structurally impossible to turn GREEN via code alone. Per the rework dispatch's explicit carve-out, the helper body was updated to model the now-shipped Fix-B policy (re-resolve via `resolveEntry` only when the current step's sequence became empty); the **assertions were NOT touched** (`notEqual(parked, 6)` + `equal(parked, 7)` remain the acceptance). Also fixed a pre-existing tsc error in the staged test: `initialStep: number` → `OnboardingStep` (+ a type-only `OnboardingStep` import), since `resolveEntry` types its first arg as `OnboardingStep`. tsc `--noEmit`: ZERO errors across all ORCH-1039-touched hook/test files.

### CI wrapper extended

`app-mobile/scripts/ci/orch-1039-collab-gate-check.mjs` now runs BOTH the happy-path and the adversarial test (was happy-path only), so the resume-empty regression is CI-guarded. `npm run test:orch-1039` → both green.

### Files changed in rework
- `app-mobile/src/hooks/useOnboardingStateMachine.ts` — added `useEffect` import + the guarded resolve-empty effect (~22 lines incl. comment).
- `app-mobile/src/i18n/locales/bin/onboarding.json` — 1 key (`collaborations.headline`).
- `app-mobile/src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts` — model-helper body + param type + type import (`[TEST-MOD-APPROVED ORCH-1039]`).
- `app-mobile/scripts/ci/orch-1039-collab-gate-check.mjs` — run adversarial test too.

### Surfaces
Consumer iOS + Consumer Android only, shared TypeScript, zero `Platform.OS` branch — parity automatic. No backend / web / admin / business touch.
