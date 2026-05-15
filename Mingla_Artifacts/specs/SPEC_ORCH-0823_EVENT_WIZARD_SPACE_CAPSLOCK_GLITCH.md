# SPEC — ORCH-0823 — Event Wizard `Big␣P` Autocorrect Glitch Fix

> **HISTORY ADDENDUM (2026-05-13 at CLOSE):** This spec was authored when only Path B (autocorrect smart-replacement) was understood; SC-9 ("First-letter auto-capitalize still works on Event name") was based on choosing `autoCapitalize: "sentences"`. v1 implementation followed the spec exactly. Patched-build QA discovered Path A (autoCapitalize="sentences" + hardware capslock collision) as a real, independent defect — see investigation report errata and `Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_REPORT.md`. The v2 rework changed `autoCapitalize` to `"none"` on both target files, which made SC-9 unsatisfiable. **SC-9 is formally SUPERSEDED at close** — replacement criterion: typed `slow burn vol. 4` MUST persist as `slow burn vol. 4` (no auto-cap), verified PASS via Maestro live-fire `T07-no-autocap.png` in `Mingla_Artifacts/evidence/ORCH-0823-retest/`. The remaining 8 SC criteria stand and all PASS per v2 RETEST QA. Authoritative supersession reference: `Mingla_Artifacts/DECISION_LOG.md` DEC-151. The v2 implementation report `IMPLEMENTATION_ORCH-0823_..._v2.md` §"SC-9 reconciliation" documents the rationale and the trade-off operator implicitly accepted.



**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Live-fire evidence:** `Mingla_Artifacts/evidence/ORCH-0823/` (r-1 → r-4 + r-6 + repro-A.mov)
**Severity:** S1-high — degrades J-E1 creator flow on the most-used field in the app

---

## Layman summary

The Event Wizard's free-text fields (Event name, Description, venue, address, online URL) inherit React Native's iOS defaults for autocorrect and auto-capitalize because the `Input` primitive's `text` variant ships an empty behaviour object. Live-fire confirmed that with `autoCorrect=true` active, iOS treats `Big P` as a near-miss for `Bigot`, deletes the space, and renders a candidate-replacement bubble — the operator's reported "space erased before P can be typed" symptom. The fix is centralised: set `autoCorrect: false` (and a deliberate `autoCapitalize: "sentences"`) on the `text` variant in `Input.tsx`, set the same flags explicitly on the Description raw `<TextInput>`, and lock the behaviour in with a unit test that fails if any variant in `VARIANT_BEHAVIOUR` declares an empty object. Every `<Input variant="text">` consumer in mingla-business (26 occurrences across 11 files including all of Step 1, Step 3, brand-edit, checkout, orders, guests) inherits the fix without per-site edits.

---

## Scope

Inside scope:

1. **Patch `VARIANT_BEHAVIOUR` in `mingla-business/src/components/ui/Input.tsx`** so the `text` variant explicitly declares `autoCorrect: false` and `autoCapitalize: "sentences"`. No empty `{}` value permitted for any variant.
2. **Patch the Description raw `<TextInput>`** in `mingla-business/src/components/event/CreatorStep1Basics.tsx` so it explicitly declares `autoCorrect={false}` and `autoCapitalize="sentences"`. Multi-line prose inputs MUST declare these flags directly; they cannot route through the `Input` primitive.
3. **Add a regression test** at `mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx` (or equivalent location matching repo test convention) that asserts every variant key in `VARIANT_BEHAVIOUR` declares both `autoCorrect` and `autoCapitalize`. Test must fail with a clear message if any variant reverts to `{}`.
4. **Code comment** on `VARIANT_BEHAVIOUR` in `Input.tsx` citing ORCH-0823 so a future developer doesn't "clean up" the explicit flags back to `{}`.

Outside scope (non-goals):

1. **No rewrite of the controlled-input / Zustand re-render pattern.** Investigation identified this as a contributing factor only. Root-cause fix is sufficient. Any rewrite is a separate ORCH.
2. **No changes to `app-mobile/`.** Consumer app's `Input` primitive may share the defect class; that's a sibling ORCH the orchestrator decides to spawn separately after triage.
3. **No changes to `mingla-admin/`.** Admin uses its own UI primitives (React 19 + Tailwind, no shared `Input` component). Out of scope.
4. **No changes to non-`text` variants of `Input`.** `email`, `phone`, `number`, `password`, `search` already declare explicit `autoCapitalize` and most declare `autoCorrect`. The regression test will enforce both — if any of those variants is currently missing `autoCorrect` declaration, the test will flag and the implementor will fill in the missing value (default to `false` for those variants because none of them benefit from autocorrect).
5. **No per-call-site edits.** The 26 `variant="text"` occurrences enumerated below inherit the centralised fix; do NOT touch them individually.
6. **No new `autoCapitalize` value for the `text` variant beyond `"sentences"`.** This spec locks in `"sentences"` so the first-letter-of-first-word capitalises automatically (matches iOS standard + operator's typed "Big Party Spender" expectation). Changing to `"none"` or `"words"` is a separate UX decision the operator can revisit, but it is not part of this fix.

Assumptions:

- React Native 0.81.5 + Expo SDK 54 + iOS 26.4 simulator behaviour confirmed via live-fire.
- The Description field is a raw `<TextInput>` deliberately (multi-line semantics that the `Input` primitive does not support). It will continue to be a raw `<TextInput>`; the fix is just to declare flags explicitly on it.
- No active feature flag gates the `Input` primitive's behaviour. The patch ships unconditionally.

---

## Variant=text consumers (informational — all inherit the centralised fix)

26 occurrences across 11 files. Implementor does NOT edit these — listed for spec completeness and TEST-mode coverage:

- `mingla-business/src/components/ui/ConfirmDialog.tsx:160`
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:290`
- `mingla-business/src/components/brand/BrandEditView.tsx` (×10: lines 477, 485, 622, 678, 689, 700, 711, 722, 733, 744, 755)
- `mingla-business/src/components/checkout/PaymentElementStub.tsx:178, 199`
- `mingla-business/src/components/event/CreatorStep1Basics.tsx:128` (Event name)
- `mingla-business/src/components/event/CreatorStep3Where.tsx:59, 74, 157` (Venue name, Address, Online URL)
- `mingla-business/app/__styleguide.tsx:429, 432, 456, 459` (style-guide previews — not user-facing)
- `mingla-business/app/checkout/[eventId]/buyer.tsx:350, 382`
- `mingla-business/app/event/[id]/orders/index.tsx:270`
- `mingla-business/app/event/[id]/guests/index.tsx:450`

Plus the raw `<TextInput>` in `CreatorStep1Basics.tsx:191-206` (Description), which is patched directly.

---

## Layer-by-layer specification

### Database layer

Not affected. No migrations.

### Edge function layer

Not affected. No edge function changes.

### Service layer

Not affected. No service changes.

### Hook layer

Not affected. No hook changes.

### Component layer

#### File: `mingla-business/src/components/ui/Input.tsx`

**Change 1 — `VARIANT_BEHAVIOUR.text` entry.**

Current (lines 355-377):

```ts
const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = {
  text: {},
  email: {
    keyboardType: "email-address",
    autoCapitalize: "none",
    autoComplete: "email",
  },
  phone: {
    keyboardType: "phone-pad",
    autoComplete: "tel",
  },
  number: {
    keyboardType: "numeric",
  },
  password: {
    autoComplete: "password",
    autoCapitalize: "none",
  },
  search: {
    autoCorrect: false,
    autoCapitalize: "none",
  },
};
```

Required (post-fix):

```ts
// Why: ORCH-0823 — no variant may inherit RN platform defaults. iOS autocorrect
// (autoCorrect=true default) on free-text Mingla fields produces near-miss
// substitutions ("Big P" → "Bigot") that erase the user's input. Every variant
// MUST declare autoCorrect AND autoCapitalize explicitly. Regression test
// at __tests__/Input.variantBehaviour.test.tsx fails if this contract breaks.
const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = {
  text: {
    autoCorrect: false,
    autoCapitalize: "sentences",
  },
  email: {
    keyboardType: "email-address",
    autoCorrect: false,
    autoCapitalize: "none",
    autoComplete: "email",
  },
  phone: {
    keyboardType: "phone-pad",
    autoCorrect: false,
    autoCapitalize: "none",
    autoComplete: "tel",
  },
  number: {
    keyboardType: "numeric",
    autoCorrect: false,
    autoCapitalize: "none",
  },
  password: {
    autoCorrect: false,
    autoCapitalize: "none",
    autoComplete: "password",
  },
  search: {
    autoCorrect: false,
    autoCapitalize: "none",
  },
};
```

Notes:
- `text` variant gets `autoCorrect: false` + `autoCapitalize: "sentences"`. The first letter of the first word capitalises automatically (so the operator types "big party spender" and sees "Big party spender"; subsequent capitals are user-driven via shift). Autocorrect is OFF, eliminating Path B.
- `email`, `phone`, `number`, `password`, `search` get `autoCorrect: false` explicitly. None of them benefit from autocorrect (typos in emails/phones/passwords/searches should NOT be silently substituted). For variants that already had `autoCapitalize: "none"`, that value is preserved.
- The leading code comment is REQUIRED and must cite ORCH-0823 and the regression test file path. Do not paraphrase or shorten the rationale.

**Change 2 — No other edits to `Input.tsx`.** The `<TextInput>` JSX that consumes `{...behaviour}` at line 654 is unchanged. The fix is in the data table only.

---

#### File: `mingla-business/src/components/event/CreatorStep1Basics.tsx`

**Change 1 — Description raw `<TextInput>` explicit flags.**

Current (lines 191-206):

```tsx
<TextInput
  value={draft.description}
  onChangeText={(v) => updateDraft({ description: v })}
  // Multiline TextInput on iOS doesn't trigger reliable
  // scroll-into-view from `automaticallyAdjustKeyboardInsets`,
  // so on focus we manually scroll the wizard to the bottom
  // (Description is the last field on Step 1).
  onFocus={scrollToBottom}
  placeholder="What's the vibe? Doors, dress code, sound system, who it's for…"
  placeholderTextColor={textTokens.quaternary}
  multiline
  numberOfLines={5}
  textAlignVertical="top"
  style={styles.textarea}
  accessibilityLabel="Event description"
/>
```

Required (post-fix):

```tsx
<TextInput
  value={draft.description}
  onChangeText={(v) => updateDraft({ description: v })}
  // Multiline TextInput on iOS doesn't trigger reliable
  // scroll-into-view from `automaticallyAdjustKeyboardInsets`,
  // so on focus we manually scroll the wizard to the bottom
  // (Description is the last field on Step 1).
  onFocus={scrollToBottom}
  placeholder="What's the vibe? Doors, dress code, sound system, who it's for…"
  placeholderTextColor={textTokens.quaternary}
  multiline
  numberOfLines={5}
  textAlignVertical="top"
  // ORCH-0823: explicit autoCorrect=false eliminates iOS autocorrect
  // near-miss substitutions (e.g. "Big P" → "Bigot") that erase user
  // input. autoCapitalize="sentences" matches the prose-style placeholder.
  autoCorrect={false}
  autoCapitalize="sentences"
  style={styles.textarea}
  accessibilityLabel="Event description"
/>
```

Notes:
- The `autoCorrect={false}` decision matches the `Input` primitive's `text` variant for consistency.
- The `autoCapitalize="sentences"` choice matches the prose-shaped placeholder ("What's the vibe? Doors, dress code…") — the field is sentence-style content where the first letter capitalises naturally.
- The comment is REQUIRED.

**Change 2 — No other edits to `CreatorStep1Basics.tsx`.** The `Event name` field at line 124-131 inherits the `Input` primitive fix; do NOT touch it.

---

#### File: `mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx` (NEW)

**Required.** New test file. If the test directory doesn't exist, create it.

```tsx
/**
 * ORCH-0823 regression test — every Input variant must declare both
 * autoCorrect and autoCapitalize explicitly. No variant may inherit
 * React Native's iOS defaults (autoCorrect=true, autoCapitalize="sentences"),
 * which produce near-miss substitutions ("Big P" → "Bigot") that erase
 * user input on free-text fields.
 *
 * If this test fails, DO NOT weaken it. Add the missing field to the
 * VARIANT_BEHAVIOUR entry in src/components/ui/Input.tsx.
 */

import { describe, it, expect } from "@jest/globals";

// Import the internal VARIANT_BEHAVIOUR table. If it's not currently
// exported, add `export` to its declaration in Input.tsx.
import { VARIANT_BEHAVIOUR } from "../Input";

describe("Input VARIANT_BEHAVIOUR — ORCH-0823 regression", () => {
  const expectedKeys: ReadonlyArray<keyof typeof VARIANT_BEHAVIOUR> = [
    "text",
    "email",
    "phone",
    "number",
    "password",
    "search",
  ];

  expectedKeys.forEach((variant) => {
    describe(`variant: ${variant}`, () => {
      const behaviour = VARIANT_BEHAVIOUR[variant];

      it("declares autoCorrect explicitly", () => {
        expect(behaviour).toHaveProperty("autoCorrect");
        expect(typeof behaviour.autoCorrect).toBe("boolean");
      });

      it("declares autoCapitalize explicitly", () => {
        expect(behaviour).toHaveProperty("autoCapitalize");
        expect(behaviour.autoCapitalize).toMatch(
          /^(none|sentences|words|characters)$/,
        );
      });

      it("autoCorrect is false (Mingla policy — no near-miss substitutions)", () => {
        expect(behaviour.autoCorrect).toBe(false);
      });
    });
  });
});
```

Notes:
- Implementor MUST add `export` to the `VARIANT_BEHAVIOUR` const in `Input.tsx` so the test can import it. This is the only `Input.tsx` change beyond the table itself.
- If the repo's test runner is not Jest, adapt the imports/assertions to match the existing convention. Search for an existing component test (e.g. `*.test.tsx` in `mingla-business/src/components/`) and mirror its setup.
- The third assertion in each variant (`autoCorrect === false`) encodes the Mingla policy that no variant should silently rewrite user input. If a future variant genuinely needs autocorrect (prose-style only — currently none do), the policy can be revisited via a follow-up ORCH; do not weaken the test unilaterally.

---

## Success criteria

1. **SC-1 — Operator's exact reproducer no longer triggers the symptom.** On iPhone 17 Pro simulator (UDID `17091E60-C3B6-4167-980D-60C348E177F6`), iOS 26.4, after the fix is applied: type `Big`, press space, press caps lock, type `P` in the Event name field. The field MUST show `Big P` (or `BIG P` depending on caps-lock state — but the SPACE MUST be preserved). NO autocorrect suggestion bubble may appear.

2. **SC-2 — No-capslock control passes.** Same sim, same field. Clear field. Type `Big P` directly (no caps lock). Field MUST show `Big P` with the space preserved. NO autocorrect bubble.

3. **SC-3 — Description field passes.** Same sim. Navigate to Description multiline field. Type `Big P`. Field MUST show `Big P`. NO autocorrect bubble.

4. **SC-4 — Step 3 venue field passes.** Same sim. Navigate to Step 3 Where → Venue name. Type `Big P`. Field MUST show `Big P`. NO autocorrect bubble.

5. **SC-5 — VARIANT_BEHAVIOUR regression test passes.** `npm test` (or the repo's equivalent) runs the new `Input.variantBehaviour.test.tsx` and all assertions pass.

6. **SC-6 — VARIANT_BEHAVIOUR regression test FAILS if `text` variant is reverted to `{}`.** Implementor must demonstrate this by (a) temporarily reverting `text: { autoCorrect: false, autoCapitalize: "sentences" }` to `text: {}` in a local edit, (b) running the test, (c) confirming the test fails with a clear error message, (d) reverting the local edit. This is a sanity-check, not a permanent change; document in the implementation report.

7. **SC-7 — TypeScript compiles clean.** `tsc --noEmit` (or repo's typecheck script) passes with zero new errors. The `VariantBehaviour` type at `Input.tsx:350-353` already includes `autoCorrect` and `autoCapitalize` as optional keys; the fix only fills in values, no type-shape change.

8. **SC-8 — No lint errors.** Repo's lint script passes with zero new errors. Comment formatting matches the file's existing convention.

9. **SC-9 — First-letter auto-capitalize still works on Event name.** Type `slow burn vol. 4` into Event name (lowercase intent). The first letter MUST auto-capitalise to `S` (because `autoCapitalize="sentences"` is set). Result: `Slow burn vol. 4`. This confirms autoCapitalize is preserved while autoCorrect is removed.

---

## Test cases (for TEST mode)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Operator reproducer | Event name: `Big␣⇪P` (capslock between space and P) | Field shows `Big P` or `BIG P`; space preserved; no autocorrect bubble | Sim live-fire |
| T-02 | No-capslock control | Event name: `Big␣P` | Field shows `Big P`; space preserved; no autocorrect bubble | Sim live-fire |
| T-03 | Description field | Description: `Big␣P` | Field shows `Big P`; space preserved; no autocorrect bubble | Sim live-fire |
| T-04 | Step 3 Venue | Venue name: `Big␣P` | Field shows `Big P`; space preserved; no autocorrect bubble | Sim live-fire |
| T-05 | Step 3 Address | Address: `123␣Main␣St` | Field shows `123 Main St`; spaces preserved | Sim live-fire |
| T-06 | Step 3 Online URL | Online URL (Online format): `https://example.com` | URL preserved exactly; no autocorrect; "example" not substituted to anything | Sim live-fire |
| T-07 | First-letter auto-cap preserved (Event name) | Event name: `slow burn vol. 4` | Field shows `Slow burn vol. 4` (first letter capitalised by sentences mode) | Sim live-fire |
| T-08 | First-letter auto-cap preserved (Description) | Description: `doors at 10pm.` | Field shows `Doors at 10pm.` (first letter capitalised) | Sim live-fire |
| T-09 | VARIANT_BEHAVIOUR regression test passes | Run test suite | All variants declare autoCorrect + autoCapitalize; all autoCorrect values are `false` | Unit test |
| T-10 | VARIANT_BEHAVIOUR regression test catches revert | Temporarily set `text: {}` and run test | Test fails with clear message | Unit test sanity-check |
| T-11 | TypeScript passes | `tsc --noEmit` | Zero new errors | Type check |
| T-12 | Other variants still work (smoke) | Open sign-in screen (uses `variant="email"` or similar) and type credentials | No autocorrect interference; email/password fields behave normally | Sim live-fire |
| T-13 | No-near-miss control (no glitch should occur) | Event name: `Slow Burn` | Field shows `Slow Burn`; no autocorrect bubble (none expected anyway with autoCorrect=false) | Sim live-fire |
| T-14 | Autosave still fires | Type any text into Event name | Status indicator transitions "Saving…" → "Saved" within ~1s; persists across wizard back/forward | Sim live-fire |

T-01 through T-08 and T-12 through T-14 are live-fire on the booted iPhone 17 Pro simulator (same setup used in the investigation). T-09 through T-11 are CLI-runnable in the implementor's local environment.

---

## Invariants

This change preserves the following existing invariants:

- **I-PROPOSED-J (Zustand persist no server snapshots)** — unaffected; the fix is in TextInput configuration, not state.
- **I-38 (IconChrome touch ≥ 44pt)** — unaffected; no touch-target changes.
- **I-39 (Explicit accessibilityLabel on interactive Pressable)** — unaffected; `Input` and the Description `TextInput` already declare `accessibilityLabel`.
- **Constitutional rule #9 (No fabricated data)** — strengthened. Before this fix, iOS autocorrect could substitute "Bigot" for user-typed "Big P", which is a form of data fabrication at the input layer. The fix eliminates that.
- **Constitutional rule #1 (No dead taps)** — unaffected.

This change establishes one NEW proposed invariant:

- **I-PROPOSED-AD — INPUT-VARIANT-EXPLICIT-FLAGS.** Every variant in `mingla-business/src/components/ui/Input.tsx`'s `VARIANT_BEHAVIOUR` table MUST declare both `autoCorrect` (always `false`) and `autoCapitalize` (any of `none` | `sentences` | `words` | `characters`). No variant may evaluate to an empty `{}` or omit either property. Enforced by the regression test at `Input.variantBehaviour.test.tsx`. The orchestrator should graduate this proposal into `INVARIANT_REGISTRY.md` at CLOSE.

---

## Implementation order

1. Open `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
2. Edit `mingla-business/src/components/ui/Input.tsx`:
   a. Add `export` to the `VARIANT_BEHAVIOUR` const declaration.
   b. Replace the `VARIANT_BEHAVIOUR` table with the post-fix version (above).
3. Edit `mingla-business/src/components/event/CreatorStep1Basics.tsx`:
   a. Add `autoCorrect={false}` and `autoCapitalize="sentences"` to the Description `<TextInput>` props.
   b. Add the explanatory comment above those props.
4. Create `mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx` with the contents above. If the `__tests__` folder doesn't exist, create it. If the repo convention is co-located tests (e.g. `Input.test.tsx` next to `Input.tsx`), mirror that convention and update the path.
5. Run `npm test` (or repo equivalent) and confirm the new test passes.
6. Run `tsc --noEmit` and confirm zero new errors.
7. Run the repo's lint script (`npm run lint` or equivalent) and confirm zero new errors.
8. Write the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md` with old→new diff receipts, lint/typecheck/test outputs, and any deviations.
9. Hand back to the operator. Do NOT push, do NOT open PR, do NOT deploy. The orchestrator handles CLOSE after TEST passes.

---

## Regression prevention

The defect class is "platform-default inheritance" — when a developer omits explicit configuration, the platform's default applies, and that default is wrong for Mingla's use case. Three prevention layers:

1. **Structural — VARIANT_BEHAVIOUR table.** All TextInput configuration for the `Input` primitive is centralised in one table. A developer adding a new variant cannot omit `autoCorrect` / `autoCapitalize` without the regression test catching them.
2. **Test — `Input.variantBehaviour.test.tsx`.** The test asserts every variant declares both flags. If a future PR reverts to `{}`, the test fails in CI before merge.
3. **Comment — code-adjacent rationale.** The leading comment on `VARIANT_BEHAVIOUR` cites ORCH-0823 and the regression test path. A developer cleaning up code will see the rationale before deleting the explicit flags.

For the Description raw `<TextInput>`: the inline comment above its `autoCorrect` / `autoCapitalize` props serves the same purpose. There is no centralised guard for raw `<TextInput>` usage across the codebase — that would be a larger ORCH (lint rule or codebase-wide pattern enforcement) and is explicitly out of scope here.

---

## Hard guards for implementor

- No product code edits outside the three files named in "Implementation order" (Input.tsx, CreatorStep1Basics.tsx, Input.variantBehaviour.test.tsx). If the regression test file path needs to differ to match repo convention, document that deviation in the implementation report.
- No `supabase db push`. No edge function deploys. No new database objects. This is a pure-client fix.
- No changes to the controlled-input / Zustand re-render pattern. The investigation labelled this a contributing factor only.
- No changes to other `Input` variants beyond filling in `autoCorrect` / `autoCapitalize` values as specified.
- No changes to `app-mobile/` or `mingla-admin/`.
- No commits, no pushes, no PRs, no merges. Orchestrator owns those steps.
- No provider secrets, no `.env` edits.
- If the regression test catches an unexpected violation in `email`/`phone`/`number`/`password`/`search` variants (e.g. one of them is missing a field after the spec's prescribed values are applied), STOP and ask the operator — do not paper over with an arbitrary value.

---

## Confidence

Investigation is at confidence `proven` (live-fire verified). Spec confidence is **H** — the fix is one-line-equivalent and centralised, the test is self-contained, the test cases are concrete and live-fire-verifiable on the same sim that already reproduced the bug.

---

## Discoveries surfaced during SPEC (carryover from investigation)

These are unchanged from the investigation report; restated here so the implementor sees them without cross-referencing:

1. **Step 3 fields share the defect.** Already covered by the centralised fix.
2. **Potential `app-mobile/` parity.** Operator decides whether to spawn a sibling ORCH.
3. **Cycle 3 spec template gap.** Future specs for TextInput-bearing surfaces should include a "TextInput contract" checklist.
4. **Tooling: expo run:ios + Xcode 26 devicectl mismatch.** Sibling dev-tooling ORCH candidate.
5. **Stale Metro module-graph cache.** Documentation/onboarding note.
6. **Stale dev-build crash class.** OneSignal native module missing on older bundles — onboarding note.
