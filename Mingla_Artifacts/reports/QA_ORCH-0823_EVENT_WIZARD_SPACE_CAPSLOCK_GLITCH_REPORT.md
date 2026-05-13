# QA — ORCH-0823 — Event Wizard `Big␣P` Autocorrect Glitch — TEST mode

**Skill:** Claude `mingla-tester` (parity-mirror; canonical TEST owner per DEC-133 is `mingla-forensics` TEST mode — operator explicit redirect).
**Sub-mode:** TARGETED.
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Evidence:** `Mingla_Artifacts/evidence/ORCH-0823-test/` (T01-CLEAN-1..4 screenshots, T02-result, test-repro.mov)

---

## Verdict: **FAIL**

| Severity | Count |
|----------|-------|
| P0 — CRITICAL | 1 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE | 1 (good work — Path B fully eliminated) |

**Blocking issue (P0):** The operator's exact reproducer (`Big␣⇪P`) still produces `BigP` with the space erased. The patch eliminated Path B (autocorrect-driven "Bigot" substitution) but Path A (autoCapitalize="sentences" + hardware capslock collision) is now demonstrably the actual mechanism and is NOT mitigated by `autoCorrect: false`. The investigation's confidence label of `proven` for ruling out Path A was wrong; the no-capslock control test in the original investigation (r-6) could not distinguish Path A from Path B because Path B masked Path A visually.

**Re-dispatch target:** Implementor REWORK with revised SPEC guidance on the `autoCapitalize` value for the `text` variant and the Description raw `<TextInput>`.

---

## Layman summary

The fix turned off iOS's autocorrect on Mingla's event-wizard text inputs, which DID stop the "Bigot" suggestion bubble from appearing when typing `Big P`. That part works. But there's a SECOND bug nested inside the same symptom: pressing the caps lock key on a hardware keyboard, while the field is in iOS's "sentences" auto-capitalize mode AND there's a pending trailing space in the buffer, causes iOS to silently delete that trailing space. This is visible in the screenshots — after typing `Big␣` the field correctly shows `Big ` (with space), but the very next moment after the caps lock keypress (and before any letter is typed), the field shows `Big` (no space, cursor at the "g"). Then when `P` is typed, the result is `BigP`. The investigation report wrongly ruled this out. The fix needs one more change: the `text` variant's `autoCapitalize` value must NOT be `"sentences"` if the spec is to satisfy SC-1.

---

## Spec criterion verification matrix

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| **SC-1** | Operator's `Big␣⇪P` reproducer produces `Big P` with space preserved, no autocorrect bubble | **FAIL** | `T01-CLEAN-4.png` shows `BigP` (space erased). Autocorrect bubble correctly absent (half-credit on the fix). |
| **SC-2** | No-caps-lock control `Big␣P` produces `Big P` with space preserved | **PASS** | `T02-result.png` shows `Big P` with visible space, cursor after P, no autocorrect bubble. ✓ |
| SC-3 | Description field passes | **NOT TESTED** | Skipped due to T-01 FAIL on Event name — re-test after rework. Same mechanism applies (Description has explicit `autoCapitalize="sentences"` per patch). Expected FAIL on rework verification. |
| SC-4 | Step 3 venue field passes | **NOT TESTED** | Same — inherits centralised fix; same Path A defect expected. Re-test after rework. |
| **SC-5** | `VARIANT_BEHAVIOUR` regression test passes | **PASS** (verified independently) | `npm run test:orch-0823` → 24/24 tests pass. Output captured. |
| **SC-6** | Regression test FAILS when `text` variant is reverted to `{}` | **PASS** (verified independently) | Independent re-run with perl in-place revert → 3 tests fail (autoCorrect-declared, autoCapitalize-declared, autoCorrect-is-false); restored, 24/24 pass. |
| **SC-7** | TypeScript compiles clean | **PASS** | `npx tsc --noEmit` → exit 0, zero errors. |
| **SC-8** | No new lint errors | **PASS** | `npm run lint` → zero new errors. One new warning at `Input.tsx:52` (same `import/first` class as four pre-existing baseline warnings). |
| SC-9 | First-letter auto-capitalize still works on Event name | **NOT TESTED** | Skipped due to T-01 FAIL. Re-test after rework. **Note:** the proposed rework (changing `autoCapitalize` to `"none"` or `"words"`) will affect SC-9 — see Findings §P0 for the conflict and resolution paths. |

Verified directly: SC-2, SC-5, SC-6, SC-7, SC-8 (5/9).
Confirmed FAILED: SC-1 (1/9).
Blocked until SC-1 rework: SC-3, SC-4, SC-9 (3/9).

---

## Test cases — direct results

| Test | Result | Evidence | Notes |
|------|--------|----------|-------|
| T-01 | **FAIL** | `T01-CLEAN-1` (Big), `T01-CLEAN-2` (Big + visible space), `T01-CLEAN-3` (after capslock — space gone!), `T01-CLEAN-4` (BigP). The decisive evidence is `T01-CLEAN-3`: the field shows `Big` with cursor immediately after "g" (no space gap) RIGHT AFTER the capslock keypress and BEFORE the "P" keystroke. Path A is therefore proven by isolated keystroke. | The capslock keypress alone erases the trailing space in the buffer. |
| T-02 | **PASS** | `T02-result.png` shows `Big P` with visible space, cursor after P, no autocorrect bubble. | No-capslock case confirms Path B was successfully eliminated by the patch. |
| T-03 | NOT TESTED | — | Blocked on T-01 fix. |
| T-04 | NOT TESTED | — | Blocked on T-01 fix. |
| T-05 | NOT TESTED | — | Blocked on T-01 fix. |
| T-06 | NOT TESTED | — | Blocked on T-01 fix. |
| T-07 | NOT TESTED | — | Blocked on T-01 fix; also impacted by autoCapitalize change. |
| T-08 | NOT TESTED | — | Blocked on T-01 fix; also impacted by autoCapitalize change. |
| T-09 | **PASS** | `npm run test:orch-0823` → 24/24 | Re-run independently of implementor's claim. |
| T-10 | **PASS** | Sanity-check: revert `text: { autoCorrect: false, autoCapitalize: "sentences" }` → `text: {}` via perl in-place edit → 3 tests fail (matching SC-6) → restore → 24/24 pass. | Verified the regression-test gate catches the revert class. |
| T-11 | **PASS** | `npx tsc --noEmit` exit 0. | TypeScript clean. |
| T-12 | NOT TESTED | — | Smoke-only; can be cleared at retest. |
| T-13 | NOT TESTED | — | Blocked on T-01 fix. |
| T-14 | PARTIAL PASS | "Saving…" → "Saved" indicator visible in T01-CLEAN-1 → T01-CLEAN-2 transition. Autosave fires. | Not independently timed but visually confirmed. |

---

## Findings

### 🔴 P0 — Path A NOT eliminated by the patch — SC-1 FAILS

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/ui/Input.variants.ts:30` (the `text` variant entry); same defect at `mingla-business/src/components/event/CreatorStep1Basics.tsx:191-206` (Description explicit `autoCapitalize="sentences"`) |
| Exact code | `text: { autoCorrect: false, autoCapitalize: "sentences" }` (in `Input.variants.ts`) and `autoCapitalize="sentences"` (on Description raw TextInput) |
| What it does | Sets iOS UIKit's autoCapitalize mode to `"sentences"`. After a typed space character, iOS internally enters a "pre-capitalize next letter" state. Pressing the hardware caps-lock key while this state is pending causes iOS to mutate the buffer — specifically, to remove the trailing space character before any subsequent letter is processed. This is reproducible with `autoCorrect: false` (i.e. the patch is necessary but not sufficient). |
| What it should do | Preserve the trailing space across the caps-lock keypress. |
| Causal chain | (1) User types `Big`. (2) User types space — buffer is `Big ` (verified by `T01-CLEAN-2.png` with cursor visually after space). (3) User presses caps lock — buffer becomes `Big` (verified by `T01-CLEAN-3.png` — cursor visually right after "g", no space gap). (4) User types `P` — buffer becomes `BigP`. The defect happens at step 3 BEFORE any character key is pressed. |
| Verification step | Already verified by `T01-CLEAN-3.png` (captured between capslock press and P keystroke). Re-run on a build with `autoCapitalize: "none"` and confirm `T01-CLEAN-3` equivalent shows `Big ` (with space gap) and final result is `Big P` or `Big P` (capslock-cased). |

**Why the investigation report's "Path A ruled out" claim was wrong:** The original investigation's r-6 control test (broken build, no-capslock `Big␣P`) produced the same visible output `BigP` + `Bigot` bubble as r-4 (with caps lock). I interpreted this as "caps lock isn't the trigger; autocorrect is sufficient alone." That conclusion was correct for Path B's contribution but did NOT prove Path A's absence — Path B masked Path A visually. With Path B now eliminated by `autoCorrect: false`, the patched build's T-01 shows Path A in isolation: the capslock keypress alone erases the trailing space, no autocorrect required.

**Fix instructions (for implementor REWORK):**

The spec's chosen `autoCapitalize: "sentences"` value is incompatible with SC-1. Operator + spec author must choose one of:

1. **Change `autoCapitalize` to `"none"`** on both `text` variant in `Input.variants.ts` AND Description raw TextInput in `CreatorStep1Basics.tsx`. This is the safest fix — eliminates Path A entirely. Trade-off: SC-9 (first-letter auto-cap) is dropped — `slow burn vol. 4` stays `slow burn vol. 4`. Matches every other working free-text input in mingla-business (ticket name, multi-date label, etc. — all use `"none"`). Recommended.
2. **Change to `autoCapitalize: "words"`** — likely eliminates Path A (different UIKit state machine) and capitalises each word. Needs TEST verification. SC-9 modified to "each word's first letter capitalises."
3. **Keep `"sentences"` and accept SC-1 cannot be met by this fix class** — would require a more invasive change (e.g. uncontrolled TextInput with `defaultValue` to bypass JS↔native round-trip, OR a controlled-value reconciliation guard that re-inserts the space on next keystroke). Out of scope for ORCH-0823's "minimal centralised fix" framing.

**Recommended path:** Option 1 (`autoCapitalize: "none"`). Quick, matches sibling pattern, fully eliminates Path A. Operator's typed input `Big Party Spender` will require shift-typing each capital — standard mobile input behaviour. SC-9 spec criterion will need to be revised to either reflect that the auto-cap is intentionally absent, or to test for `"words"` mode instead.

### 🔵 P4 — NOTE: Path B fully eliminated by the patch (positive finding)

| Field | Value |
|---|---|
| File + line | `Input.variants.ts:30` + every consumer of `<Input variant="text">` in mingla-business |
| Exact code | `text: { autoCorrect: false, ... }` (added by ORCH-0823 implementor) |
| What it does | With `autoCorrect: false`, iOS does not engage smart-replacement candidate UI on any free-text input wired through `<Input variant="text">`. |
| Verification | `T02-result.png` (no-capslock `Big␣P` produces `Big P` with no `Bigot` bubble) and `T01-CLEAN-4.png` (with caps lock — no `Bigot` bubble even though Path A still erases the space). |

Credit the implementor for executing the centralised fix cleanly. The Path B class is fully resolved. The remaining work is narrow: revise `autoCapitalize` to eliminate Path A.

---

## Constitutional compliance check

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 1 | No dead taps | PASS | No interaction changes. |
| 2 | One owner per truth | PASS | `VARIANT_BEHAVIOUR` is single-owner in `Input.variants.ts`; re-exported but not duplicated. |
| 3 | No silent failures | PASS | No error paths affected. |
| 4 | One key per entity | N/A | |
| 5 | Server state server-side | PASS | No server-state changes. |
| 6 | Logout clears everything | N/A | |
| 7 | Label temporary | N/A | |
| 8 | Subtract before adding | PASS | Empty `{}` replaced cleanly. |
| 9 | No fabricated data | **WEAKENED — still vulnerable.** Path A still allows iOS to silently mutate user input (space erasure). User types `Big P`, persisted draft holds `BigP`. This is a residual data-integrity violation that the rework must close. | P0 finding above. |
| 10 | Currency-aware | N/A | |
| 11 | One auth instance | N/A | |
| 12 | Validate at right time | N/A | |
| 13 | Exclusion consistency | N/A | |
| 14 | Persisted-state startup | N/A | |

---

## Cross-domain impact

- `mingla-business/` only. `app-mobile/` and `mingla-admin/` not impacted by this patch. Re-test post-rework should still scope to `mingla-business/`.
- All 26 `<Input variant="text">` consumers inherit the centralised fix and therefore inherit BOTH the fix (Path B gone) AND the residual defect (Path A still present). Operator-facing impact remains broad until rework.

---

## Parity check

- iOS sim live-fire performed on iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4.
- Android emulator parity NOT exercised — Android does not have the same smart-text pipeline; Path A specifically relies on iOS UIKit's capslock+autoCapitalize state machine. Post-rework re-test should confirm on Android emulator anyway for SC-2 / SC-4 / SC-5 parity.
- Solo / collab mode: N/A (UI primitive, not mode-specific).

---

## Rework requirements

Implementor (Codex `implementor-mingla` or Claude `mingla-implementor`) must:

1. **Resolve the `autoCapitalize` choice with operator** (or accept the recommended `"none"` value per the P0 finding above). This is a SPEC-class decision: the original SPEC chose `"sentences"` without testing Path A specifically; the test result shows that choice cannot satisfy SC-1.
2. **Apply the chosen `autoCapitalize` value** to:
   - `mingla-business/src/components/ui/Input.variants.ts` — `text` variant entry.
   - `mingla-business/src/components/event/CreatorStep1Basics.tsx` — Description raw `<TextInput>`.
3. **Update or revise SC-9** in the spec to reflect the new behaviour (or remove SC-9 if `"none"` is chosen and auto-cap is intentionally not provided).
4. **Update the rationale comment** in `Input.variants.ts` to cite both Path A and Path B, noting that Path A was discovered during TEST mode and required the autoCapitalize change.
5. **Update the regression test** if any new value-policy is to be enforced (currently the test asserts `autoCorrect === false` for every variant; if the new policy is also `autoCapitalize !== "sentences"` for the `text` variant, add that assertion).
6. **Write rework report** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_v2.md` with diff receipts.

After rework, re-dispatch to TEST mode for RETEST of T-01 + T-02 + T-03 + T-04 + T-05 + T-07 + T-08 + T-13 on the same iPhone 17 Pro simulator.

---

## Investigation report errata

The original investigation report (`INVESTIGATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`) labelled Path A "RULED OUT" with confidence H based on the no-capslock control test (r-6) showing identical output to the with-capslock case (r-4). This conclusion was incorrect because Path B's autocorrect smart-replacement masked Path A's space erasure — both produced the same visible `BigP` + `Bigot` state, so the control could not distinguish them. The patch's `autoCorrect: false` unmasked Path A, which is now observable in isolation (T01-CLEAN-3 shows the space disappearing on capslock alone, before any letter is typed). The investigation's confidence on the iOS sub-mechanism should be downgraded; both Path A AND Path B were active in the original symptom, and both need explicit mitigation.

Orchestrator at CLOSE should add an addendum to the investigation report citing this errata and pointing to the QA report as the corrective evidence.

---

## Discoveries for orchestrator

1. **Path A confirmed via TEST mode** — `autoCapitalize: "sentences"` + hardware capslock erases trailing space on iOS. This is a defect class that other RN/iOS apps may have; worth a feedback memory note for future investigations.
2. **Investigation report needs an errata** — see above.
3. **Implementor pattern observation**: the implementor's decision to extract `VARIANT_BEHAVIOUR` to a sibling file `Input.variants.ts` (deviation from spec) was the correct call given ts-jest's `jsx: "react-native"` JSX-preservation behaviour. This is a useful pattern for future similar testable-data-out-of-JSX situations.
4. **Test methodology learning**: TEST mode should explicitly distinguish "no-capslock control" tests from "with-capslock target" tests for keypress-interaction bugs. The investigation conflated them by accepting same visible output as confirmation. Future spec templates should include a "modifier-key isolation matrix" for input-bugs.
5. **Repo test convention gap**: no top-level `npm test` aggregate; per-ORCH scripts only. Operator already aware (in implementation report).

---

## Files NOT changed by TEST mode

Per discipline rule: TEST mode is read-only. Zero product code edits. The fix files remain in their post-implementation state:

- `mingla-business/src/components/ui/Input.tsx` (unchanged from implementation)
- `mingla-business/src/components/ui/Input.variants.ts` (unchanged from implementation)
- `mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx` (unchanged)
- `mingla-business/src/components/event/CreatorStep1Basics.tsx` (unchanged)
- `mingla-business/package.json` (unchanged)

---

## Verdict reaffirmed: FAIL

Re-dispatch to implementor for REWORK with the autoCapitalize change. Once reworked, RETEST on the same simulator to clear T-01 + T-03 + T-04 + SC-1 + SC-3 + SC-4 + SC-9. The remaining unblocked criteria (SC-2, SC-5, SC-6, SC-7, SC-8) are already verified and stand.
