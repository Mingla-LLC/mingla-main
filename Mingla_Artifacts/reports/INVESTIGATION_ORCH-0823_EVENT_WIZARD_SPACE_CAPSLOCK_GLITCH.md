# INVESTIGATION — ORCH-0823 — Event Wizard Space + Capslock Glitch

**Skill:** Claude `mingla-forensics` (INVESTIGATE)
**Surface:** `mingla-business` — Event Creator wizard, Step 1 Basics (and adjacent steps)
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-13
**Confidence:** **root cause PROVEN** — code defect proven (H); iOS UIKit sub-mechanism confirmed via live-fire simulator reproduction (Path B — autocorrect smart-suggestion commit — is the actual mechanism; Path A — autoCapitalize+capslock interaction — is RULED OUT by the no-capslock control test).

**Live-fire status:** REPRODUCED on iPhone 17 Pro simulator (iOS 26.4, RN 0.81.5, Expo SDK 54), 2026-05-13. Evidence captured at `Mingla_Artifacts/evidence/ORCH-0823/`:

- `r-1-after-Big.png` — typed `Big`, field shows `Big`, cursor right after `g`. ✓ Expected.
- `r-2-after-space.png` — typed space, field still shows `Big` visually but cursor moved right (space present). Autosave fires ("Saving…" → "Saved"). ✓ Expected.
- `r-3-after-capslock.png` — pressed caps lock (hardware key code 57). NO visible change — caps lock is a modifier, sends no character. Buffer still contains `Big ` (space intact at this moment). ✓ Expected.
- `r-4-after-P.png` — typed `P`. **Field now shows `BigP` (no space)** highlighted in iOS's blue "candidate replacement" zone, with autocorrect suggestion bubble **`Bigot ×`** below it. ✓ **REPRODUCED operator's symptom.**
- `r-6-no-capslock.png` — control: cleared field, repeated the sequence as `Big␣P` WITHOUT caps lock toggle. Result: **identical** — `BigP` shown with `Bigot ×` autocorrect bubble. ✓ **Proves caps lock is NOT the trigger; autocorrect is.**
- `repro-A.mov` — full video of the reproduction sequence.

**What was actually happening:** Operator typed `Big` + space + caps lock + `P`. iOS UIKit's autocorrect pipeline evaluated the buffer state `Big P` (or its in-flight equivalent) and found a dictionary near-match — `Bigot` — close enough to engage the smart-replacement candidate UI. iOS does not LITERALLY delete the space character; it transforms the buffer to render `BigP` as a single highlighted token with the candidate replacement `Bigot` underneath. If the user types another character or accepts the bubble, the field commits to whatever autocorrect resolves to — but visually the space "disappears" because the candidate-replacement rendering compresses the two tokens. The user's mental model attributes the failure to caps lock because the visible compression happens around the caps-lock-then-letter keypress, but the control test (r-6) — same sequence with no caps lock — produces the same compression. **The trigger is `autoCorrect=true` on the field, applied to a string that has a dictionary near-match.**

**Why "Bigot" specifically:** iOS's dictionary considers `Big P` (or `BigP`) close to `Bigot`. Other near-misses (e.g. `Big B`, `Big M`) would produce different but equally disruptive autocorrect bubbles. Event names — which include proper nouns, brand names, slang, and stylised text — will routinely hit dictionary near-misses, so this defect surfaces broadly, not just for the operator's exact reproducer.

---

## Symptom Summary

**Expected:** Typing `Big`, space, then pressing caps-lock, then `P` yields `Big P` in the Event-name field (with whatever case the user chose, no characters lost).

**Actual (operator-reproduced):** The trailing space is erased before the `P` lands. Output is `BigP` or just `Big` with the next keystroke arriving in the wrong slot.

Operator also reports general "glitches when I type space or the capslock button" — i.e., the phenomenon is not strictly bound to the exact `Big␣⇪P` sequence; it surfaces around the interaction of space + capslock with the wizard's TextInputs.

---

## Investigation Manifest (files read, in trace order)

1. `mingla-business/app/event/create.tsx` — wizard entry (no inputs; redirects to edit).
2. `mingla-business/app/event/[id]/edit.tsx` — wizard host route.
3. `mingla-business/src/components/event/EventCreatorWizard.tsx` — wizard shell, autosave, keyboard listener, `handleUpdate`.
4. `mingla-business/src/components/event/CreatorStep1Basics.tsx` — Event name (`Input variant="text"`) and Description (raw `<TextInput>`).
5. `mingla-business/src/components/event/CreatorStep3Where.tsx` — Venue name, Address, Online URL (`Input variant="text"`).
6. `mingla-business/src/components/event/CreatorStep5Tickets.tsx` — Ticket name (uses explicit `autoCapitalize="none"`, `autoCorrect={false}`).
7. `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` — uses explicit `autoCapitalize="none"`, `autoCorrect={false}`.
8. `mingla-business/src/components/event/TicketTierEditSheet.tsx` — uses explicit `autoCapitalize="none"`, `autoCorrect={false}`.
9. `mingla-business/src/components/event/PublicEventPage.tsx` — uses explicit `autoCapitalize="none"`, `autoCorrect={false}`.
10. `mingla-business/src/components/ui/Input.tsx` — `Input` primitive; `VARIANT_BEHAVIOUR` table.
11. `mingla-business/src/store/draftEventStore.ts` — `updateDraft` setter; `liveDraft` selector consumers.
12. `mingla-business/package.json` — `react-native: 0.81.5`, `expo: ~54.0.33`.

Phase 0 ingestion completed: read `MEMORY.md` entries on keyboard-blocks-input, sequential pace; prior `INVESTIGATION_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md` and `IMPLEMENTATION_BIZ_CYCLE_3_EVENT_CREATOR.md` (Cycle 3 spec section §3.9 covers Step 1; no TextInput flag discussion).

---

## Findings

### 🔴 Root Cause #1 — `Input` `text` variant inherits RN defaults `autoCapitalize="sentences"` + `autoCorrect=true`

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/ui/Input.tsx:355-377` |
| Exact code | `const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = { text: {}, email: { ..., autoCapitalize: "none", ... }, phone: { ... }, number: { ... }, password: { ..., autoCapitalize: "none" }, search: { autoCorrect: false, autoCapitalize: "none" } };` |
| What it does | The `text` variant supplies an empty object as TextInputProps for autoCapitalize / autoCorrect / autoComplete / keyboardType. RN's TextInput then falls back to its platform defaults: on iOS, `autoCapitalize` defaults to `"sentences"` and `autoCorrect` defaults to `true`. |
| What it should do | For free-text content fields that hold proper nouns (event names, venue names, addresses), `autoCorrect` should be **false** (autocorrect actively damages proper-noun text) and `autoCapitalize` should be either `"none"` or `"words"` (never `"sentences"` for a single-line title field — there are no sentences, just a title). |
| Causal chain | (1) Step 1 Event name uses `<Input variant="text">` at `CreatorStep1Basics.tsx:124-131`. (2) `Input` spreads `{...behaviour}` from `VARIANT_BEHAVIOUR["text"]` onto the inner `<TextInput>` at `Input.tsx:654`. (3) Because `behaviour === {}`, the inner `<TextInput>` receives no autoCapitalize / autoCorrect overrides. (4) iOS UIKit applies its defaults — sentence-style auto-capitalization plus smart-text-replacement (autocorrect). (5) The user-observed glitch surfaces inside that OS-level smart-text pipeline. |
| Verification step | Force-set `autoCapitalize: "none"` and `autoCorrect: false` in the `text` variant of `VARIANT_BEHAVIOUR` (one-line code change, no other surface area) and re-run the operator's reproducer. If the glitch disappears, this is causally responsible. The fix is also independently verified by the fact that **every other free-text TextInput in `mingla-business` sets these flags explicitly** (Step 5 ticket name, Step 6 settings via TicketTierEditSheet, MultiDateOverrideSheet, PublicEventPage public-page search, Input.tsx's own internal PickerSearchInput) — the working pattern in the repo is "autoCorrect off, autoCapitalize off." Only the wizard's `variant="text"` consumers deviate. |

### 🔴 Root Cause #2 — Description field is a raw `<TextInput>` with no autoCapitalize / autoCorrect override

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/event/CreatorStep1Basics.tsx:191-206` |
| Exact code | `<TextInput value={draft.description} onChangeText={(v) => updateDraft({ description: v })} onFocus={scrollToBottom} placeholder="What's the vibe? …" placeholderTextColor={textTokens.quaternary} multiline numberOfLines={5} textAlignVertical="top" style={styles.textarea} accessibilityLabel="Event description" />` |
| What it does | A raw multi-line TextInput with NO autoCapitalize, autoCorrect, or smart-punctuation override. iOS defaults apply: `autoCapitalize="sentences"`, `autoCorrect=true`, smart-quotes/dashes on. |
| What it should do | Multi-line descriptions are prose, so autoCorrect on + autoCapitalize="sentences" is defensible. But the SAME OS-level interaction window that produces the Event-name glitch (space + capslock) exists here too. At minimum the field should be a deliberate decision, not an inheritance. |
| Causal chain | Same shape as Root Cause #1 — RN defaults reach UIKit, smart-text pipeline owns the buffer mid-keypress, capslock-press during the "next letter capitalize" preview state collides with the controlled `value` round-trip. |
| Verification step | Same as #1 — set explicit flags and re-test. For Description, `autoCorrect={true}` may be retained (prose benefits from correction), but `autoCapitalize="sentences"` should be explicit and confirmed not to interact with the capslock failure mode in the live repro. |

### iOS UIKit sub-mechanism — PROVEN via live-fire (Path B confirmed; Path A ruled out)

Pre-investigation hypothesized two candidate paths (A: autoCapitalize+capslock collision; B: autoCorrect smart-suggestion commit). Simulator reproduction settles it:

**Path B — autoCorrect smart-suggestion commit — CONFIRMED.** iOS autocorrect evaluates the buffer after every keystroke. When `Big␣P` (or its in-flight composition equivalent) hits the dictionary lookup, iOS finds the near-match `Bigot` and engages the smart-replacement candidate UI: the visible field collapses `Big P` into the highlighted candidate token `BigP` with the autocorrect suggestion `Bigot ×` rendered beneath. The trailing space appears to have been "erased" but is in fact compressed into the candidate-replacement rendering. Evidence: `r-4-after-P.png` (with caps lock) and `r-6-no-capslock.png` (without caps lock) — both produce the identical `BigP` + `Bigot` state, proving caps lock is irrelevant and autocorrect alone is sufficient to trigger the symptom.

**Path A — autoCapitalize="sentences" + hardware capslock collision — RULED OUT.** The control test (r-6) reproduces the symptom with the same `Big␣P` sequence and zero caps-lock activity. If Path A were responsible (or contributing), removing caps lock would have eliminated or attenuated the symptom. It did not. The autoCapitalize="sentences" default is still a code defect (proper-noun fields should not force sentence-case anyway), but it is NOT the mechanism behind the operator's reported space-erasure.

**Fix consequence:** setting `autoCorrect: false` in `VARIANT_BEHAVIOUR.text` eliminates Path B entirely. The autoCapitalize choice for the variant becomes a UX preference (sentence-case the first letter? word-case? none?) rather than a defect mitigation.

### 🟠 Contributing Factor — Wizard re-render on every keystroke widens the race window

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/event/EventCreatorWizard.tsx:175-178, 377-396` |
| Exact code | `const liveDraft = useDraftEventStore((s) => s.drafts.find((d) => d.id === initialDraft.id)) ?? initialDraft; … const handleUpdate = useCallback((patch) => { … updateDraft(liveDraft.id, revisionedPatch); … queueAutosave(nextDraft); }, [liveDraft, markDraftDirty, queueAutosave, updateDraft]);` |
| What it does | Every keystroke calls `updateDraft` → `set((s) => ({ drafts: s.drafts.map(...) }))` ([draftEventStore.ts:778-785](mingla-business/src/store/draftEventStore.ts#L778-L785)), which creates a new `drafts` array and a new draft object. The wizard re-renders. `liveDraft` is a new object identity. `handleUpdate` is a new callback identity. The inline `onChangeText={(v) => updateDraft({ name: v })}` arrow is recreated. The controlled TextInput receives a new `value` prop AND a new `onChangeText` prop on every keystroke. |
| What it should do | Not a defect on its own — controlled inputs in RN are designed to handle this. But it widens the JS→native round-trip window in which the OS smart-text pipeline can race against the controlled value. |
| Causal chain | This factor does not, by itself, drop characters. It compounds Root Causes #1/#2 by lengthening the window during which the OS buffer (with smart-text state) and the JS-controlled `value` can be out of sync. |
| Verification step | The fix for Root Causes #1/#2 alone should resolve the operator-reported glitch. If the glitch persists after autoCorrect/autoCapitalize are set explicitly, then the contributing factor needs its own remediation (e.g., `useRef` to keep the TextInput uncontrolled with `defaultValue` + `onChangeText`, or memoize `onChangeText` per field). The orchestrator and implementor should NOT pre-emptively rewrite the controlled-input pattern — fix Root Cause first, then re-test. |

### 🟡 Hidden Flaw — Pattern deviation across the wizard

Every other free-text TextInput in `mingla-business` explicitly sets `autoCapitalize="none"` and `autoCorrect={false}`:

- `CreatorStep5Tickets.tsx` → via `TicketTierEditSheet.tsx:923-924`
- `MultiDateOverrideSheet.tsx:436-437`
- `PublicEventPage.tsx:884-885`
- `Input.tsx:466-467` (internal `PickerSearchInput`)

The wizard's Step 1 Basics fields, Step 3 Where fields (`venueName`, `address`, `onlineUrl`), and any other `<Input variant="text">` consumer deviate from this established convention. This is a maintenance-time hazard: each new `variant="text"` consumer inherits the bug unless the implementor remembers to override it.

### 🔵 Observations

1. **No `onChangeText` normalizer** drops or rewrites spaces in either `CreatorStep1Basics.tsx` or `draftEventStore.ts`. Spaces are preserved end-to-end at the JS layer. The character loss is at the OS/native-bridge layer.
2. **The 700ms autosave debouncer** ([EventCreatorWizard.tsx:241](mingla-business/src/components/event/EventCreatorWizard.tsx#L241)) does not fire on every keystroke and is not implicated in per-keystroke glitches. Ruled out.
3. **Zustand persist** is not in the JS path here — `draftEventStore` uses `set` synchronously; no AsyncStorage round-trip per keystroke.
4. **Keyboard.addListener** in `EventCreatorWizard.tsx:262-279` listens for show/hide; not for keypress events. Not implicated.

---

## Five-Layer Cross-Check

| Layer | Result |
|---|---|
| **Docs** | Cycle 3 spec §3.9 specifies Step 1 fields (name, description, category) but does NOT specify TextInput behavioural flags (autoCapitalize, autoCorrect, smart-quotes). Implementor inherited RN defaults. Spec gap, not contradiction. |
| **Schema** | N/A — pure client glitch. `draft.name` is a `string` in the Zustand store ([draftEventStore.ts:81](mingla-business/src/store/draftEventStore.ts#L81)) and `events.name text not null` in the DB. Neither layer rewrites input. |
| **Code** | Root Causes #1 + #2 located. `Input.tsx:355-377` + `CreatorStep1Basics.tsx:191-206`. |
| **Runtime** | Operator reproduced the bug. Live JS-side runtime is not implicated (no string-mutating logic between TextInput and store). UIKit smart-text pipeline is the runtime owner of the buffer at the moment of the glitch. |
| **Data** | After the glitch, `useDraftEventStore.getState().drafts[i].name` reflects whatever onChangeText last received from the native bridge — i.e., the post-erasure value. The store is not separately mutating. |

**Contradiction:** Docs (Cycle 3 §3.9) say "Event name field" with no behavioral constraints. Code applies iOS UIKit defaults. The defaults are wrong for the use case. Implementor never made an explicit choice; the field inherited defaults that produce the operator-reported glitch.

---

## Blast Radius

Every `<Input variant="text">` consumer in `mingla-business` is exposed:

| Surface | Field | Exposure |
|---|---|---|
| Step 1 Basics | Event name | Operator-reported. Confirmed. |
| Step 1 Basics | Description (raw TextInput, no overrides) | Same defect, multiline. |
| Step 3 Where | Venue name | `variant="text"`, no overrides. Same defect. |
| Step 3 Where | Address | `variant="text"`, no overrides. Same defect. |
| Step 3 Where | Online URL | `variant="text"`, no overrides. Same defect; here autoCorrect off is **strongly** desirable (URLs must not be autocorrected). |
| Cross-app | Any other `mingla-business` consumer of `<Input variant="text">` | Same defect inherited. Grep `variant="text"` in `mingla-business/src/` to enumerate before SPEC. |

Not exposed (already set explicit flags): Step 5 ticket name, MultiDateOverrideSheet override label, TicketTierEditSheet name, PublicEventPage search field.

**Cross-app check:** `app-mobile/` has its own `Input` primitive (consumer app). Out of scope for ORCH-0823 unless operator extends scope. Note for orchestrator: if the consumer app's `Input` has the same defect class, register a sibling ORCH.

**Cross-platform check:** Both paths (A and B above) are iOS-specific UIKit behavior. Android TextInput does not have the same smart-text pipeline; the operator's exact reproducer is unlikely to fire on Android. However, `autoCorrect=true` + `autoCapitalize="sentences"` are still wrong defaults for proper-noun fields on Android (autocorrect will mangle event names). Android exposure is "annoyance / wrong-output" rather than "characters disappear."

---

## Invariant Violations

No registered Mingla invariant is directly violated. This is a UX defect, not a constitutional breach. However, this finding establishes a candidate **new** invariant:

- **I-PROPOSED-AD INPUT-VARIANT-EXPLICIT-FLAGS** — every consumer of the `<Input>` primitive's free-text variants in `mingla-business` (and downstream apps) MUST receive explicit `autoCorrect` and `autoCapitalize` semantics from the variant table; no variant may inherit RN platform defaults. Codify the variant table as the single owner; ban inline overrides at call-sites by convention (call-sites should specify a variant, not props). The SPEC author should evaluate whether to graduate this proposal into the registry.

---

## Recurring Pattern Check

This is a textbook **"defaults are wrong" / "platform-default inheritance"** pattern. Sibling examples in the Mingla codebase: oklch color formats silently failing on RN (`feedback_rn_color_formats.md`), `.neq()` excluding NULLs on Supabase (`feedback_supabase_neq_null.md`). All three share the failure mode: a library/platform default is applied when the developer didn't make an explicit choice, and the default is wrong for Mingla's use case.

---

## Fix Strategy (direction only — SPEC writes the contract)

1. **Make `Input` variant flags explicit and complete.** In `VARIANT_BEHAVIOUR.text`, set `autoCorrect: false` and `autoCapitalize: "sentences"` (or `"none"` — SPEC author decides based on whether title-case is desirable for event names; my recommendation is `"sentences"` so the first letter capitalizes naturally without breaking capslock; the autoCorrect=false setting is what eliminates the iOS smart-text race).
2. **Set explicit flags on the Description raw `<TextInput>`** at `CreatorStep1Basics.tsx:191-206`. SPEC author decides whether to keep autoCorrect on for prose (recommended) or off for safety (also defensible). At minimum, make the choice explicit and not inherited.
3. **Consider promoting the description to use a dedicated `<Input variant="textarea">`** if such a variant exists or should be added — this folds the description field into the same explicit-flags discipline as everything else.
4. **Audit every `<Input variant="text">` consumer in `mingla-business/src/`** as part of the SPEC scope. Step 3 fields are confirmed exposed; enumerate any others.
5. **Do NOT touch the controlled-input pattern** (`updateDraft` Zustand re-render). The contributing factor is real but the root-cause fix should resolve the user-visible bug; rewriting the controlled-input pattern is a much larger change with its own risk surface and should only happen if the targeted fix fails verification.

---

## Regression Prevention Requirements

The SPEC should require:

1. **Test case:** automated test (or documented manual reproducer) that types `Big`, space, capslock-on, `P` into the Event-name field on iOS simulator and asserts the resulting value is `Big P` (case may vary depending on autoCapitalize choice — assert the literal `"Big "` substring is preserved).
2. **Lint / pattern gate:** CI guard that fails on any `<Input variant="text">` usage where the variant default is "fallthrough." Easiest implementation: ensure `VARIANT_BEHAVIOUR.text` is non-empty (sets both `autoCapitalize` and `autoCorrect`), and never silently regresses to `{}`. A unit test on `VARIANT_BEHAVIOUR` that asserts every variant declares `autoCorrect` and `autoCapitalize` would catch the regression class.
3. **Comment:** `Input.tsx` `VARIANT_BEHAVIOUR` table should carry a `// Why: ORCH-0823 — never inherit RN defaults; capslock+space drops characters under iOS smart-text` comment so a future developer doesn't "clean up" the explicit flags back to `{}`.

---

## Discoveries for Orchestrator

1. **Step 3 Where fields share the defect.** `venueName`, `address`, `onlineUrl` are all `<Input variant="text">` without overrides. SPEC scope should include them, not just Step 1.
2. **Potential `app-mobile/` parity.** The consumer app has its own `Input` primitive. Quick triage recommended to decide whether ORCH-0823 should spawn a sibling ORCH for `app-mobile`.
3. **Spec §3.9 (Cycle 3) gap.** The Cycle 3 spec specifies field presence and validation but not TextInput behavioural flags. Future spec template should include a "TextInput contract" checklist (autoCapitalize, autoCorrect, smart-punctuation, keyboardType).
4. **Tooling: `npx expo run:ios` + Xcode 26 devicectl version-output mismatch.** During live-fire setup, `npx expo run:ios` (with or without a `--device` flag pointing at the booted simulator) routed the simulator UDID through `devicectl`, which mis-detected the destination as a physical device and demanded code-signing certificates. Workaround used: `xcodebuild -workspace ... -destination "platform=iOS Simulator,id=..."` directly. The CLI build also required manually running `Pods/Target Support Files/Pods-minglabusiness/Pods-minglabusiness-frameworks.sh` with the right env vars (CONFIGURATION_BUILD_DIR, BUILT_PRODUCTS_DIR, FRAMEWORKS_FOLDER_PATH, PODS_XCFRAMEWORKS_BUILD_DIR, TOOLCHAIN_DIR, PLATFORM_NAME, SRCROOT, TARGET_BUILD_DIR, CONFIGURATION, ACTION, EXPANDED_CODE_SIGN_IDENTITY, ARCHS, XCODE_VERSION_MAJOR, EFFECTIVE_PLATFORM_NAME) and then re-running `codesign --force --sign -` on every embedded framework + the `minglabusiness.debug.dylib` + the main binary + the .app bundle to repair the signature after framework insertion. Register as a sibling dev-tooling ORCH so the next forensics/tester session doesn't burn ~30 minutes solving the same problem.
5. **Stale Metro module graph.** The Metro instance the operator had running had a cached resolution failure for `react-native-appsflyer` even though the package was installed in `node_modules`. Cleared with `npx expo start --clear`. Standalone "if Metro suddenly can't find packages, clear cache first" gotcha — note for the developer-onboarding doc.
6. **Stale dev build risk.** The dev build that was installed on the simulator at session start (bundle UUID `0A59C2E9-…`) predated the OneSignal native module being added, so the JS bundle loaded but TurboModuleRegistry crashed with `'OneSignal' could not be found`. Anyone testing against a stale dev build will hit this and assume their auth state is broken when actually the binary is out of date. The `app-mobile` consumer app likely has the same risk if pinned dev builds are reused.

### Live-fire performed (2026-05-13)

Live-fire reproduction WAS performed as part of this investigation. Evidence at `Mingla_Artifacts/evidence/ORCH-0823/` includes per-step screenshots (r-1 through r-4 for the operator's exact reproducer; r-6 for the no-caps-lock control) and a video (`repro-A.mov`). Reproduction confirmed Path B (autocorrect smart-suggestion commit) as the actual mechanism and ruled out Path A (autoCapitalize+capslock collision). The "caps lock" element of the operator's reported symptom is a coincidence of timing — the autocorrect engages on the letter after the space regardless of any caps-lock activity. TEST mode after implementation should re-run the same reproducer on the patched build and additionally exercise the Description field and Step 3 fields.

---

## What This Is NOT (hypotheses tested and disproved)

- **Not an `onChangeText` normalizer** — neither `CreatorStep1Basics.tsx` nor `draftEventStore.updateDraft` modifies the string. Verified by reading the full chain.
- **Not the 700ms autosave debouncer** — debounce horizon is too long to affect per-keystroke timing.
- **Not Zustand persist async I/O** — `set` is synchronous; no AsyncStorage round-trip per keystroke.
- **Not a sheet/modal stacking issue** — Step 1 has no active sub-sheet when name/description are being typed.
- **Not a parent-remount of TextInput** — `liveDraft` selector preserves React-element identity for the TextInput; `value` prop changes do not remount the input.

---

## Confidence

| Aspect | Confidence | Evidence |
|---|---|---|
| Code defect (Root Causes #1 + #2 exist) | **H — PROVEN** | Source read; verified against working sibling files. |
| Causal chain from defect to user-visible glitch | **H — PROVEN** | Live-fire repro `r-4-after-P.png` + `r-6-no-capslock.png` show identical `BigP` + `Bigot` outcome with and without caps lock. iOS autocorrect is the producer; the `text` variant's missing `autoCorrect: false` is the gate that lets it run. |
| iOS sub-mechanism identification | **H — PROVEN** | Path B (autocorrect smart-suggestion commit) confirmed by reproduction; Path A (autoCapitalize+capslock) ruled out by the no-caps-lock control test. |
| Recommended fix resolves the symptom | **H** | Will be verified end-to-end in TEST mode after implementor sets `autoCorrect: false` on `VARIANT_BEHAVIOUR.text` (and on the Description raw TextInput). Pattern-match against every other working free-text input in `mingla-business` (all of which set autoCorrect=false explicitly) is corroborating evidence. |
| Blast radius (Step 3 fields affected too) | **H** | Source-read confirmed identical defect; Step 3 fields use same `Input variant="text"` consumer with no overrides. TEST mode should live-fire at least one Step 3 field. |

Overall: **root cause PROVEN.** Live-fire reproduction settles the iOS sub-mechanism question. Fix from the original analysis stands unchanged — set `autoCorrect: false` in `VARIANT_BEHAVIOUR.text` and on the Description raw TextInput.

---

## Recommended next phase

SPEC. The orchestrator should dispatch SPEC mode to this same skill (`mingla-forensics`), citing this investigation, with scope = Step 1 + Step 3 + `Input.tsx` `VARIANT_BEHAVIOUR.text`. The SPEC must define explicit autoCapitalize / autoCorrect contracts per variant, the lint/test guard, and the live-fire verification protocol for TEST mode.

---

## ERRATA — added at ORCH-0823 CLOSE on 2026-05-13

**This investigation wrongly ruled out Path A.** The original Findings §"iOS UIKit sub-mechanism" section claimed "Path A — autoCapitalize="sentences" + hardware capslock collision — RULED OUT." That conclusion was incorrect.

**The error:** the no-capslock control test (r-6) produced the same visible `BigP` + `Bigot` output as the with-capslock case (r-4). I read this as "caps lock isn't the trigger; autocorrect is sufficient alone." That conclusion was correct for proving Path B's contribution, but did NOT prove Path A's absence — Path B's autocorrect smart-replacement was masking Path A's space erasure. Both paths produce the same visible output in the broken build because autocorrect's candidate-replacement UI compresses `Big P` into `BigP` regardless of whether the space was already erased by capslock.

**The corrective evidence:** the v1 patch's `autoCorrect: false` change eliminated Path B (verified by patched-build QA T-02: no-capslock `Big P` correctly preserved with space). With Path B unmasked, the with-capslock case (v1 patched-build QA T-01-CLEAN-3.png) showed `Big` with cursor at "g" — no space gap — **immediately after the capslock keypress, before any letter was typed**. This proves Path A is real and is the mechanism by which capslock erases the trailing space when `autoCapitalize: "sentences"` is active.

**The fix:** the v2 rework changed `autoCapitalize: "sentences"` → `"none"` on both the `text` variant of `VARIANT_BEHAVIOUR` and the Description raw `<TextInput>`. Patched-build RETEST QA T-07 (`slow burn vol. 4` lowercase preserved) confirms `autoCapitalize: "none"` is live; combined with T-02 (no-capslock case PASS), Path A is now structurally impossible because the sentences-mode state machine never engages — there is nothing for caps lock to collide with.

**Process learning codified at CLOSE:** investigations of keypress-interaction bugs must explicitly run a "modifier-key isolation matrix" — test the bug WITH and WITHOUT each candidate modifier (caps lock, shift, option) under each candidate fix combination. Same-visible-output across two cases is NOT sufficient to rule out modifier involvement when masking pipelines (autocorrect, smart-replacement, candidate-UI) are active. Codified in DEC-151 and as a recurring-pattern note for `failure-patterns.md`.

**Cross-references:**
- v1 QA FAIL (where Path A was first proven): `Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_REPORT.md` §"Findings" P0 + T01-CLEAN-3 evidence at `Mingla_Artifacts/evidence/ORCH-0823-test/T01-CLEAN-3.png`.
- v2 RETEST PASS (where the fix is verified): `Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_RETEST_REPORT.md`.
- DEC-151 (architectural decisions captured at close): `Mingla_Artifacts/DECISION_LOG.md`.
- I-PROPOSED-BP INPUT-VARIANT-EXPLICIT-FLAGS (new invariant): `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
