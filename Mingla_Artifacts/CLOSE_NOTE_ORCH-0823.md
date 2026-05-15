# CLOSE NOTE — ORCH-0823

Date closed: 2026-05-13
Closed by: Claude `mingla-orchestrator` (operator delegated "take over, explain in layman terms")
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: pending (this close opens it)

## Verdict

**PASS** (v2 RETEST) — `Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_RETEST_REPORT.md`. Zero P0/P1/P2/P3. Two P4 NOTES (good v2 rework; clean test-tooling pivot to Maestro). One retest cycle (v1 → v2). Live-fire performed on iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4.

## Plain-English impact

Typing into the Event Wizard's text fields used to glitch: type `Big`, space, caps lock, `P` and you'd end up with `BigP` and an autocorrect suggestion bubble offering `Bigot`. Two distinct iOS UIKit defects were behind the same symptom, only one was visible at first — autocorrect "helpfully" substituting near-miss words. Eliminating that revealed a second defect: hardware caps-lock pressed while iOS's "sentences" auto-capitalize state machine was active silently deletes the pending trailing space before any letter is processed.

The fix is two small config changes in two files, plus a regression test that locks in the policy. Every `<Input variant="text">` consumer in `mingla-business` (26 occurrences across 11 files — event name, venue, address, brand fields, checkout, orders, guests, etc.) inherits the fix through the centralised `VARIANT_BEHAVIOUR` table. The Description multi-line field gets the same explicit flags inline. Trade-off: typing `slow burn vol. 4` no longer auto-capitalises to `Slow burn vol. 4` — users shift-type capitals like in every other Mingla input. This matches sibling fields (ticket name, multi-date label, public-event search, country picker — all already used `"none"`).

## What shipped

**Two implementation revs in one cycle:**

| Rev | What |
|-----|------|
| Rev 1 (v1) | Centralised fix: extract `VARIANT_BEHAVIOUR` to pure-data sibling `Input.variants.ts` so the test can import it in node env without JSX. Set `autoCorrect: false` on every variant. Keep `autoCapitalize: "sentences"` on the `text` variant (preserves first-letter auto-cap). Add explicit flags to the Description raw `<TextInput>`. New Jest regression test (24 assertions) enforces every variant declares both flags. Added per-ORCH test script `test:orch-0823`. |
| Rev 2 (v2) | After v1 QA FAIL exposed Path A: change `autoCapitalize` from `"sentences"` to `"none"` on the `text` variant and the Description field. Regression test extended to ban `"sentences"` as a value for any variant (now 30 assertions). SC-9 (first-letter auto-cap) formally superseded. |

Files changed in the final state:
- `mingla-business/src/components/ui/Input.tsx` (modified — re-exports + comment)
- `mingla-business/src/components/ui/Input.variants.ts` (new — pure-data sibling)
- `mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx` (new — 30-assertion regression test)
- `mingla-business/src/components/event/CreatorStep1Basics.tsx` (modified — Description explicit flags)
- `mingla-business/package.json` (modified — `test:orch-0823` script entry)

## Verification matrix

| Spec SC | Status | Evidence |
|---------|--------|----------|
| SC-1 (operator's `Big␣⇪P` reproducer) | PASS (by mechanism + control) | autoCapitalize="none" proven live via T-07; Path A's state machine cannot engage |
| SC-2 (no-capslock `Big␣P`) | PASS | `Mingla_Artifacts/evidence/ORCH-0823-retest/T02-event-name.png` |
| SC-3 (Description field) | PASS | `T03-desc-coord.png` |
| SC-4 (Step 3 venue field) | PASS (by inheritance) | Same `<Input variant="text">` consumer; T-02 proves the centralised fix reaches all consumers |
| SC-5 (regression test passes) | PASS | `npm run test:orch-0823` → 30/30 |
| SC-6 (regression test catches revert) | PASS | Sanity-check: revert `text` to `{}` → 4 assertions fail; restore → 30/30 pass |
| SC-7 (TypeScript clean) | PASS | `npx tsc --noEmit` → exit 0 |
| SC-8 (no new lint errors) | PASS | `npm run lint` → zero new errors |
| ~~SC-9~~ (first-letter auto-cap) | **SUPERSEDED at close** | DEC-151. Replacement: `slow burn vol. 4` persists as `slow burn vol. 4`. Verified via `T07-no-autocap.png`. |

Operator-witnessed end-to-end: operator confirmed via this Claude orchestrator session that the QA RETEST verdict PASS is acceptable; "take over, explain in layman terms" dispatch authorized the close.

## DIAG-marker reaping (Step 1.5)

```bash
grep -rn "\[ORCH-0823-DIAG\]" mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ supabase/functions/ mingla-admin/src/ 2>/dev/null
```

**Result: ZERO matches.** No diagnostic markers to reap. Step 1.5 clean.

## Commit message

```
Close ORCH-0823: Event wizard Big␣⇪P autocorrect + capslock space-erasure fix

Two iOS UIKit defects were producing the same symptom in mingla-business
event wizard text fields: (1) autocorrect smart-replacement substituting
"Big P" → "Bigot" and visually erasing the space, (2) autoCapitalize
"sentences" mode colliding with hardware caps-lock keypresses and silently
deleting the pending trailing space. Investigation initially identified
only the first defect; patched-build QA revealed the second.

Centralised fix in mingla-business/src/components/ui/Input.variants.ts:
every variant in VARIANT_BEHAVIOUR now declares autoCorrect=false and
autoCapitalize=none (or "none"-class — never "sentences"). All 26
<Input variant="text"> consumers across 11 files inherit the fix. The
wizard's Description raw <TextInput> gets the same explicit flags inline.

New Jest regression test (30 assertions across 6 variants) bans empty
variant configs and bans autoCapitalize="sentences" entirely. Sanity-
check verified the test catches reverts.

Trade-off: Event name, venue, address etc. no longer auto-capitalise the
first letter (matches sibling fields like ticket name, multi-date label,
public-event search). Spec SC-9 formally superseded; replacement criterion
documented in DEC-151.

Live-fire QA via Maestro on iPhone 17 Pro iOS 26.4 — PASS verdict zero
P0/P1/P2/P3. Investigation report carries Path-A errata addendum.

New invariant I-PROPOSED-BP INPUT-VARIANT-EXPLICIT-FLAGS registered
ACTIVE. Decision DEC-151 logged.
```

## EAS OTA

`mingla-business` is the affected app (not `app-mobile`). The repo's `mingla-business/package.json` scripts include `build-production-ios` / `build-production-android` (EAS Build profiles) but no `eas update` script. Operator should publish OTA via:

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0823: Event wizard Big P autocorrect + capslock fix"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0823: Event wizard Big P autocorrect + capslock fix"
```

If `mingla-business` has no production EAS Update channel yet (it's a pre-MVP surface per MEMORY's project structure quick-reference), this fix lands in the next TestFlight / internal release rather than a runtime OTA. No SQL migrations were touched; no native module changes; OTA is the right shipping mechanism if the channel exists.

## Invariants / decisions

- **I-PROPOSED-BP INPUT-VARIANT-EXPLICIT-FLAGS** — new ACTIVE invariant. Every Input variant must declare both `autoCorrect` (must be `false`) and `autoCapitalize` (must NOT be `"sentences"`). Enforced by Jest regression test. Scope: `mingla-business/` only at this time.
- **DEC-151** — codifies (1) autocorrect ban, (2) sentences-mode ban + Path A discovery, (3) investigation Path-A errata, (4) SC-9 supersession, (5) I-PROPOSED-BP registration, (6) test-tooling Maestro-default codification, (7) modifier-key isolation matrix process improvement.

## Follow-ups queued

1. **Potential `app-mobile/` parity ORCH.** The consumer app has its own `Input` primitive. Worth a quick triage to decide whether to spawn a sibling ORCH propagating I-PROPOSED-BP to `app-mobile`. Operator's call.
2. **Cycle 3 spec template gap** (carryover from investigation Discoveries §3). Future specs that introduce TextInput-bearing surfaces should include a "TextInput contract" checklist (autoCapitalize, autoCorrect, smart-punctuation, keyboardType). Not codified as a hard process change — operator may register as a separate META-ORCH or absorb into the next spec template revision.
3. **Dev-tooling: `npx expo run:ios` + Xcode 26 devicectl mismatch + Pods embed-frameworks phase skipped on CLI builds** (carryover from investigation Discoveries §4). Two workarounds were needed mid-session: `xcodebuild` direct with manual `Pods-minglabusiness-frameworks.sh` invocation + manual `codesign --force --sign -` on every embedded framework + the `minglabusiness.debug.dylib` + the main binary + the .app bundle. Worth a sibling dev-tooling ORCH so future TEST sessions don't burn ~30 min solving the same problem.
4. **`fb-idb` broken on Python 3.14.** `pipx install fb-idb` succeeded but `idb --version` fails with a Python error. The fix is a Python 3.11/3.12 venv. Worth a memory note for future TEST sessions that need hardware-keyboard-event drivers.
5. **Pre-existing `import/first` lint warnings in `Input.tsx`** (carryover from v1 implementation §"Discoveries"). Lines 36, 46, 47, 48 — caused by `type` declarations sitting between import groups. Trivial cleanup, out-of-scope for ORCH-0823.
6. **Other dirty work on `Seth` not committed in this close:** ORCH-0822 (Twilio TFV rejection investigation), ORCH-0824 (business events in consumer discover — implementation + spec + investigation + new edge function + 2 migrations + new app-mobile/mingla-business files), pre-existing modifications to `app.json` / `eas.json` / `draftEventStore.ts` / `draftEventValidation.ts` / `serverDraftEventMapper.ts` / `supabase/config.toml`. All untouched by this CLOSE per scoped-staging discipline. Operator triages separately.

## Document sync

- `INVARIANT_REGISTRY.md` — I-PROPOSED-BP ACTIVE block added (this close).
- `DECISION_LOG.md` — DEC-151 prepended (this close).
- Investigation report — Path-A errata addendum appended at bottom (this close).
- Spec — HISTORY ADDENDUM block prepended at top noting SC-9 supersession (this close).
- `CLOSE_NOTE_ORCH-0823.md` — NEW (this file).
- `WORLD_MAP.md` / `MASTER_BUG_LIST.md` / `COVERAGE_MAP.md` / `PRODUCT_SNAPSHOT.md` / `PRIORITY_BOARD.md` / `AGENT_HANDOFFS.md` / `OPEN_INVESTIGATIONS.md` — trail by cycles per established convention (CLOSE_NOTE files are the canonical recent-cycle record; global indexes update via batched maintenance — see CLOSE_NOTE_ORCH-0807 §"Document sync" for the same pattern).

## Evidence

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md` (with Path-A errata addendum at bottom).
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md` (with SC-9 supersession HISTORY ADDENDUM at top).
- v1 implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`.
- v1 QA FAIL (where Path A first proven): `Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_REPORT.md` with evidence at `Mingla_Artifacts/evidence/ORCH-0823-test/` (T01-CLEAN-1..4 step-by-step screenshots; T01-CLEAN-3 is the smoking gun).
- v2 implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_v2.md`.
- v2 RETEST PASS (where fix is verified): `Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_RETEST_REPORT.md` with Maestro evidence at `Mingla_Artifacts/evidence/ORCH-0823-retest/` (T02, T03-desc-coord, T07, T08-desc-coord, T13 + 60 MB retest video).
- Commit on `Seth`: see `git log --oneline -1` after this CLOSE push.
