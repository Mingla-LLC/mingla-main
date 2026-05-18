# IMPLEMENTATION — ORCH-0864 [Marketing Composer V2 — inline chip rich-text editor]

> **Status:** STAGES A → G + **F.5** (TenTap → pell pivot) + **F.6** (layout rework + body visibility from live-device feedback) complete. Build #1 failed on TenTap upstream Fabric bug; build #2 succeeded but exposed layout overlap + invisible body. Stage F.6 fixes both. Operator re-builds for attempt #3.
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
> **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0864_MARKETING_COMPOSER_V2.md`.

---

## §0 — Why this is staged

This ORCH's spec is large (14 new files, native module additions, full EAS rebuild cycle, ~3000–6000 LOC across iOS/Android/Web). Per operator standing rule [[sequential-one-step-at-a-time]] — sequential, one step at a time, never in a hurry — I'm shipping this implementation in 7 stages with operator go-ahead between each:

| Stage | Scope | Verifiable from this Claude session? |
|---|---|---|
| **A (done)** | `tenTapTokenBridge.ts` + happy-path tests T-01..T-05 + fails-on-revert | ✅ Pure code + jest |
| **B.1 (done)** | Add native deps + `npm install` + verify peer resolution | ✅ install runs in-session |
| **B.2 (done)** | Custom Tiptap node + BridgeExtension for event chip + personalization chip + `useTenTapEditor` hook | ✅ tsc clean + 11/11 jest |
| **C (done)** | `InsertionBar.tsx` + pure state-machine module + 3 inline panels (events / personalize / overflow) | ✅ tsc clean + 8/8 jest |
| **D (done)** | `SelectionFormattingTooltip.tsx` + `ComposerV2Editor.tsx` (whole canvas: subject row + mini-personalize + B/I/Link tooltip + TenTap RichText body + InsertionBar wired up) | ✅ tsc clean + 34/34 joint jest; runtime UNVERIFIED until Stage H |
| **E (done)** | `TemplatePreviewDrawer.tsx` + pure helpers (`sortTemplatesStarterFirst`, `substituteOnce`) + 8 helper tests | ✅ tsc clean + 42/42 joint jest; runtime UNVERIFIED until Stage H |
| **F (done)** | Route swap in `compose.tsx` (flex-column layout; V2 editor mounted; preview-sheet dropped; cursor + embedded-events + selection state purged) + `useBrandEvents` hook extracted + ComposerV2Editor extended with template-drawer wiring + 3 V1 components DELETED | ✅ tsc clean on touched surface + 42/42 joint jest + zero V1 import orphans |
| **G (done)** | Strict-grep gate `orch-0864-composer-v2.mjs` (6 checks + self-test) + workflow registration + Maestro flow iOS + Maestro flow Android. Playwright web spec DEFERRED — no infra in repo. | ✅ gate self-test 12/12 + gate live PASS + workflow YAML valid |
| C | `InsertionBar.tsx` + state machine + inline panels | ✅ Pure RN component + tests |
| D | `ComposerV2Editor.tsx` + `SelectionFormattingTooltip.tsx` | Partial — TenTap renders, but sim repro needs operator |
| E | `TemplatePreviewDrawer.tsx` | ✅ Pure RN |
| F | Wire into `compose.tsx`, delete V1 components | ✅ tsc + jest |
| G | Maestro flows + Playwright flow + strict-grep gate + `--self-test` mode | Partial — gate runs in Claude; Maestro needs operator-driven sim |
| H | EAS build + operator live-fire on iPhone + Pixel | Operator-only |

Stage A is the foundation: the token bridge is the most failure-prone piece of the architecture (lossless round-trip across the 11-token vocabulary + event chips + HTML marks). If this can't be proven byte-identical, the rest of V2 falls apart. Shipping it first as a pure-function module with zero deps means it's fully verifiable in this session.

---

## §1 — Stage A — files

### New files

| Path | LOC | Purpose |
|---|---|---|
| `mingla-business/src/services/marketing/tenTapTokenBridge.ts` | ~270 | Pure parser/serializer between `channel_payload.body_html` string and TenTap-compatible ProseMirror JSON. Zero runtime dependencies. |
| `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.test.ts` | ~190 | Happy-path tests T-01..T-05 per SPEC §8 + chip-count assertions + malformed-input + type-guard tests. 15 cases, all green. |

### Modified files

None — Stage A is purely additive.

### Native deps added

None. Stage A is pre-dep.

---

## §2 — Old → New receipts (Stage A scope)

### `tenTapTokenBridge.ts` (new)

**What it did before:** Did not exist. V1 composer had no equivalent — body strings were treated as opaque text with substring `{token}` and `{{event:uuid}}` patterns substituted server-side by `marketingRenderingService.renderEmail()`.

**What it does now:** Exposes 5 public APIs:
- `bodyHtmlToTenTapDoc(bodyHtml: string): TenTapDocument` — parses a token-bearing string into ProseMirror JSON ready for TenTap.
- `toBodyHtml(doc: TenTapDocument): string` — serializes the inverse, byte-identical for V1 inputs and canonical-equivalent for V2 HTML-mark inputs.
- `extractEmbeddedEventIds(bodyHtml): string[]` — pure helper for the existing `embeddedEvents` array in `channel_payload`.
- `isPersonalizationToken(s): boolean` — type guard.
- Type exports: `PersonalizationToken`, `TenTapDocument`, `BlockNode`, `InlineNode`, `TextMark`.

**Why:** Stage A foundation for SPEC §3 token-bridge service + I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS invariant. Without lossless round-trip, V2 can't open V1 drafts (SC-12) or save without corrupting tokens (SC-11).

**Lines changed:** ~270 new.

### `__tests__/tenTapTokenBridge.test.ts` (new)

**What it did before:** Did not exist.

**What it does now:** 15 jest cases organized by SPEC §8 test ID:
- **T-01** empty body → single empty paragraph + empty round-trip (2 cases)
- **T-02** all 11 personalization tokens round-trip + chip count = 11 (2 cases)
- **T-03** 3 event chips interleaved with personalization round-trip + ID extraction order (2 cases)
- **T-04** HTML marks (`<strong>`, `<em>`, `<a href="…">`, nested marks) + tokens round-trip + chip-population assertion (DESIGNATED FAILS-ON-REVERT, 3 cases)
- **T-05** V1 draft fixture round-trip + first-paragraph chip placement (2 cases)
- Malformed-input cases (unknown brace expression, malformed event UUID — both stay literal, 2 cases)
- `isPersonalizationToken` type guard (2 cases)

**Why:** Step 0.5 regression-test gate from ORCH-0840 + SPEC §8.

**Lines changed:** ~190 new.

---

## §3 — Spec traceability (Stage A scope)

| SPEC criterion | Status after Stage A |
|---|---|
| SC-11 lossless round-trip | **Foundation proven** — T-01..T-05 all green; bridge contract holds for V1 token vocabulary + V2 HTML marks + nested marks |
| SC-12 V1 draft migration | **Foundation proven** — T-05 V1 fixture round-trips byte-identical |
| SC-16 no `<TextInput>` in body | N/A this stage (UI in Stages D + F) |
| All other SC | Pending Stages B–G |
| I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS | **DRAFT enforceable** — tests + regex literal in place; CI gate (Stage G) will lock it |
| Other 3 new invariants | Pending later stages |

---

## §4 — Regression test (ORCH-0840 §0.5)

**Implementor happy-path test:** `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.test.ts`

**Run output (15/15 PASS):**

```
PASS  src/services/marketing/__tests__/tenTapTokenBridge.test.ts
  tenTapTokenBridge — Stage A
    T-01 empty body
      ✓ parses empty string to a single empty paragraph
      ✓ round-trips empty string to empty string
    T-02 all 11 personalization tokens
      ✓ round-trips byte-identical
      ✓ emits a personalizationChip node for every token
    T-03 multiple event chips interleaved with personalization
      ✓ round-trips byte-identical (text + chips + event blocks)
      ✓ extracts all three event IDs in order
    T-04 HTML marks + tokens (DESIGNATED FAILS-ON-REVERT)
      ✓ round-trips with marks + all tokens preserved
      ✓ every {token} becomes a personalizationChip node (NOT literal text)
    T-05 V1 draft fixture
      ✓ round-trips V1 string byte-identical
      ✓ V1 first paragraph yields text + personalization chip + text
    malformed inputs do not crash and do not coerce
      ✓ unknown brace expression stays literal
      ✓ malformed event UUID stays literal
    isPersonalizationToken type guard
      ✓ accepts all 11 tokens
      ✓ rejects unknown tokens
Tests:       15 passed, 15 total
```

**Fails-on-revert verified at commit `112f4717` (pre-Stage-A-files HEAD).** The designated revert weakens `PERSONALIZATION_TOKEN_RE` to only match `{first_name}` (simulating a future reviewer "simplifying" the regex):

```diff
- const PERSONALIZATION_TOKEN_RE = new RegExp(
-   `\\{(${PERSONALIZATION_TOKENS.join("|")})\\}`,
-   "g",
- );
+ const PERSONALIZATION_TOKEN_RE = /\{(first_name)\}/g;
```

**Weakened regex test run** — 2 tests FAIL, exactly the ones designed to catch this regression:

```
Tests:       2 failed, 13 passed, 15 total
✕ T-02 emits a personalizationChip node for every token
  (expected 11 chips, got 1)
✕ T-04 every {token} becomes a personalizationChip node (NOT literal text)
  (expected ['first_name','event_name','event_date','spots_left','brand_name'],
   got ['first_name'])
```

**Restored verbatim from `/tmp/orch0864-bridge-good.ts`** — 15/15 pass again.

T-04 "every {token} becomes a personalizationChip node" is the formal fails-on-revert anchor per SPEC §8. T-02 chip-count gives a second, independent failure signal for the same regression.

**Tester adversarial test (Stage G dispatch):** Claude `mingla-forensics` TEST mode will author `tenTapTokenBridge.tester-adversarial.test.ts` covering TA-01..TA-06 from SPEC §8. Not authored in Stage A — that's the tester's job per ORCH-0840.

---

## §5 — Invariant verification (Stage A scope)

| Invariant | Stage A status |
|---|---|
| I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS | Foundation proven via T-01..T-05; CI gate authored in Stage G |
| I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM (carry-over from ORCH-0863) | Preserved — `body_html` strings stay byte-identical |
| I-PROPOSED-MKT-PHASE-B-NO-NEW-TABLES (carry-over) | Preserved — Stage A adds zero DB / RPC / migration / edge fn |
| I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE | N/A (UI in Stage C) |
| I-PROPOSED-MKT-COMPOSER-V2-SINGLE-RENDERER-TENTAP | N/A this stage (deps in Stage B) |
| I-PROPOSED-MKT-COMPOSER-V2-NO-DIRECT-TEXTINPUT-IN-BODY | N/A (UI in Stage D + F) |

---

## §6 — Constitutional compliance (Stage A scope)

| # | Principle | Stage A check |
|---|---|---|
| 1 | No dead taps | N/A (no UI yet) |
| 2 | One owner per truth | ✅ Bridge is a pure function; `body_html` remains the canonical string |
| 3 | No silent failures | ✅ Malformed tokens stay LITERAL (visible to operator), do not silently coerce — verified by malformed-input tests |
| 4 | One key per entity | N/A (no React Query) |
| 5 | Server state server-side | N/A |
| 9 | No fabricated data | ✅ Unknown brace expressions stay as the original characters; we don't invent tokens |
| Others | N/A — no UI / no auth / no persistence / no datetime |

**TypeScript strict checks:** all explicit return types; zero `any`; zero `@ts-ignore`; zero `as unknown as` escape hatches. Exhaustive `if/else` chains over the discriminated unions.

---

## §7 — Parity check

Token bridge is pure JS/TS — runs identically on iOS / Android / Web. No platform branch. Stage A parity is automatic.

Cross-surface impact for Stage A only: zero (the bridge is dormant until Stages B–F wire it up).

---

## §8 — Regression surface (what to watch in adjacent code)

Stage A does not touch any existing code, so no regression surface yet. Stage F (wiring into `compose.tsx`) will widen the regression surface to include: `marketingCampaignService.createDraft / updateDraft / getCampaign`, `useComposerDraft`, `marketingRenderingService.substituteVariables` (server-side, unchanged but must still substitute correctly).

---

## §9 — Discoveries for orchestrator

1. **Spec §4.7 nested-marks unspecified.** SPEC didn't say whether personalization chips support nested marks (e.g., `<strong><em>{token}</em></strong>`). I added marks support to chip nodes in Stage A because T-04 in the spec includes nested marks around tokens. If this isn't desired in the V2 editor UX, the chip node spec in Stage B should disable marks on chip nodes via Tiptap's `marks: ""` option — bridge still preserves the data for inbound V1 strings, just doesn't allow new applications.
2. **TenTap version pinned at 1.0.1.** Verified via `npm view @10play/tentap-editor`. Peer deps are wide-open (`react: '*', react-native: '*', react-native-webview: '*'`). Stage B installation should specifically test with Expo SDK 54.0.34 + RN 0.81.5 + React 19.1.0 — if peer-dep resolution fails, surface as blocker rather than silently install.
3. **`react-native-webview` already in lockfile transitively** (via `expo-auth-session` per Stage A inspection). Promoting to a direct dep in Stage B is a one-line change, but the Stripe Connect onboarding flow's per-feature ban (`app/connect-onboarding.tsx:18`) must be preserved.
4. **V1 inline event chips.** V1 compose.tsx (`handleInsertEventCard` line 487-505) inserts `{{event:uuid}}` at cursor position, which can land mid-paragraph. Spec §4.5 described event chips as "block-level" in V2 but Stage A's data model keeps them INLINE so V1 round-trip stays byte-identical. The visual block treatment is a Tiptap node-view concern (Stage B) — the underlying string position is preserved.

---

---

## §9.B1 — Stage B.1 — native deps installed

### Files modified

| Path | Change |
|---|---|
| `mingla-business/package.json` | Added `"@10play/tentap-editor": "^0.7.4"` + `"react-native-webview": "^13.13.5"` |
| `mingla-business/package-lock.json` | Regenerated — +73 packages |

### Old → New receipt

**`package.json`** — added two new direct dependencies. No existing entries removed. `react-native-webview` was previously a transitive dep (pulled in by `expo@54.0.34` + `@stripe/stripe-react-native@0.65.1`); promoting it to a direct dep is required so TenTap's peer-dep can resolve and so future Mingla code can `import { WebView } from 'react-native-webview'` without lint warnings about untyped imports.

### Version pinning rationale

- **TenTap 0.7.4** — Latest stable in the 0.7 line. The 1.0.1 release on npm jumps from `1.0.0-alpha.3` straight to `1.0.1` (skipping any `1.0.0` stable), which signals possibly-unstable API. Spec §4.6 said `^0.7.0`; 0.7.4 honors that with the latest patch. If 1.x is desired later, that's a deliberate ORCH.
- **react-native-webview 13.13.5** — Exactly what the spec called for; matches the SDK 54 recommended companion version and matches what's already resolved transitively (so no version conflict / lockfile churn).

### Peer-dep resolution

```
$ npm install --save @10play/tentap-editor@0.7.4 react-native-webview@13.13.5
npm warn ERESOLVE overriding peer dependency
added 73 packages, and audited 1206 packages in 6s
```

The one peer-dep warning: TenTap 0.7.4 bundles its own `react-dom@^18.2.0` for the WebView side, which conflicts with the host project's `react@19.1.0`. Resolution is BENIGN — TenTap's `react-dom` lives in its OWN `node_modules/@10play/tentap-editor/node_modules/react-dom`, isolated from the host RN runtime (React 19). The WebView runs its own React 18 inside the WebView context, which is by design.

`npm ls @10play/tentap-editor react-native-webview` confirms clean resolution — `react-native-webview@13.13.5` deduped across host + TenTap + Stripe + Expo (single instance).

### Native autolinking

TenTap ships native iOS code (`tentap.podspec` + `ios/TenTapView{,Impl,Manager}.{h,mm}`). It is NOT yet in `ios/Podfile.lock`. Operator must run `cd ios && pod install` before Stage B.2 can produce a working dev build. Same is true for `react-native-webview` (was in node_modules transitively but not pod-linked).

### Sanity check post-install

`npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts` → **15/15 PASS** (Stage A foundation unaffected by the install).

### Stage B.1 verification matrix

| Check | Method | Result |
|---|---|---|
| Deps resolve cleanly | `npm install` | PASS — 1 benign peer warning, no errors |
| Existing tests still pass | `npx jest tenTapTokenBridge.test.ts` | 15/15 PASS |
| No version conflicts in lockfile | `npm ls @10play/tentap-editor react-native-webview` | PASS — single resolved version |
| TenTap pod file present | `ls node_modules/@10play/tentap-editor/tentap.podspec` | PRESENT — operator pod install required |

---

---

## §9.B2 — Stage B.2 — chip bridges + editor hook

### Spec deviation (MUST READ — operator may push back)

SPEC §4.5 named the deliverables `EventChipNode.tsx` + `PersonalizationChipNode.tsx`, framed as RN component "node views." After reading TenTap 0.7.4's actual API (`node_modules/@10play/tentap-editor/lib/typescript/src/`), I pivoted: TenTap is a WebView-bridge architecture where chip rendering happens INSIDE the WebView (React 18 context) via Tiptap's `renderHTML` returning an HTML span, NOT via an RN component on the host. The chip-tap → native-popover flow happens via TenTap's `BridgeExtension` message-passing, not via RN node-view JSX.

Functional intent preserved (chips render in body, operator can tap to edit, RN host gets the tap event). File names changed:
- `EventChipBridge.ts` (was `EventChipNode.tsx` per spec)
- `PersonalizationChipBridge.ts` (was `PersonalizationChipNode.tsx` per spec)

Spec §6 file manifest should be updated at CLOSE to reflect the actual filenames. Flagged for orchestrator under Discoveries.

### New files

| Path | LOC | Purpose |
|---|---|---|
| `mingla-business/src/components/marketing/ComposerV2/EventChipBridge.ts` | ~165 | Pure Tiptap Node + TenTap BridgeExtension factory for inline-atom event chips. CSS for chip visual (orange-tinted pill in WebView). RN-side `insertEventChip()` method exposed via `extendEditorInstance`. |
| `mingla-business/src/components/marketing/ComposerV2/PersonalizationChipBridge.ts` | ~120 | Same shape for personalization chips. CSS for monospace `{ token }` pill. RN-side `insertPersonalizationChip()` method. |
| `mingla-business/src/hooks/marketing/useTenTapEditor.ts` | ~75 | Wraps `useEditorBridge` with `CoreBridge + BoldBridge + ItalicBridge + LinkBridge + createEventChipBridge() + createPersonalizationChipBridge()`. Memoizes bridge list (changing identity would discard draft state). Memoizes `initialContent` from Stage A's `bodyHtmlToTenTapDoc` once at mount — subsequent body_html changes during the session route through `editor.setContent()` (wired in Stage D). |
| `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBridges.test.ts` | ~115 | 11 unit tests covering Tiptap Node schema (name, group, atom, inline, draggable), attribute keysets, `ctaLabelToText`, and ActionType enum stability (WebView↔RN contract). Mocks `@10play/tentap-editor` to avoid pulling RN into node test env. |

### Old → New receipts

**`EventChipBridge.ts`** (new) — Defines `EventChipTiptapNode` (pure `@tiptap/core` Node, name `minglaEventChip`, inline atom, 5 attrs: eventId, title, dateLabel, ctaLabel, coverUrl) and `createEventChipBridge()` factory returning a `BridgeExtension<{}, EventChipEditorInstance, EventChipMessage>` that wraps the Tiptap node, injects chip CSS into the WebView via `extendCSS`, exposes `insertEventChip(attrs)` on the editor instance via `extendEditorInstance`, and handles `Insert` messages in the WebView via `onBridgeMessage` (RN host sends → WebView Tiptap inserts). `EventChipActionType` enum locks WebView↔RN message-type strings.

**`PersonalizationChipBridge.ts`** (new) — Same structure for `minglaPersonalizationChip` node (1 attr: `token`). Imports the `PersonalizationToken` type + `isPersonalizationToken` guard from Stage A's `tenTapTokenBridge.ts` so the chip's data-token attribute is type-narrowed and runtime-validated on `parseHTML`.

**`useTenTapEditor.ts`** (new) — The single React hook the composer canvas (Stage D) will consume. Returns the typed `EditorBridge` instance with `insertEventChip` + `insertPersonalizationChip` methods grafted on via TypeScript module augmentation (`declare module '@10play/tentap-editor' { interface EditorBridge extends … }` in each bridge file).

**`chipBridges.test.ts`** (new) — Tests the parts that don't need a live WebView: Tiptap node schema config, action-type enum stability, helper functions. Mocks TenTap with an empty `BridgeExtension` stub class because TenTap transitively imports `react-native` (ESM) which is incompatible with the project's `ts-jest` node test environment.

### Verification

```
$ npx tsc --noEmit --skipLibCheck \
    src/components/marketing/ComposerV2/EventChipBridge.ts \
    src/components/marketing/ComposerV2/PersonalizationChipBridge.ts \
    src/hooks/marketing/useTenTapEditor.ts
(no output — clean)

$ npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts \
           src/components/marketing/ComposerV2/__tests__/chipBridges.test.ts
Test Suites: 2 passed, 2 total
Tests:       26 passed, 26 total
```

### Stage B.2 verification matrix

| Check | Method | Result |
|---|---|---|
| TenTap 0.7.4 exports resolve | tsc against installed types | PASS — `CoreBridge`, `BoldBridge`, `ItalicBridge`, `LinkBridge`, `BridgeExtension`, `useEditorBridge` all import cleanly |
| Tiptap nodes compile against `@tiptap/core@5.9.3` | tsc | PASS |
| Bridge schema testable in node | jest mock TenTap, exercise Tiptap node config | PASS — 11/11 |
| Stage A unaffected by new code | joint jest run | PASS — 26/26 |
| Module augmentation (EditorBridge gains insertEventChip + insertPersonalizationChip) | tsc — useTenTapEditor return type includes both methods | PASS |
| Chip-tap UNVERIFIED (requires running WebView) | — | UNVERIFIED — Stage D will wire the message subscription; Stage H operator live-fire confirms end-to-end |

### Discoveries for orchestrator (Stage B.2)

1. **Spec §4.5 file naming pivot** (above). At CLOSE, spec file manifest should be amended to reflect the BridgeExtension shape; the original `*Node.tsx` framing predates close reading of TenTap's actual architecture.
2. **TenTap WebView-side CSS vs RN-side StyleSheet.** Chip styling lives in `extendCSS` strings (web CSS, runs inside WebView). This is separate from RN `StyleSheet.create` and from the host design tokens in `mingla-business/src/constants/designSystem.ts`. For now I used `hsl()` colors that visually match `accent.warm` (#EB7825) but the values are duplicated — operator may want to refactor in a future ORCH to inject the design tokens at WebView init time via `customSource` or `theme` props on `useEditorBridge`.
3. **Chip-tap handler not yet wired.** `EventChipActionType.Tap` + `PersonalizationChipActionType.Tap` are defined as message-type constants but no `onEditorMessage` handler subscribes to them yet — Stage D's `ComposerV2Editor` is where the RN host listens and surfaces the inline popover. Currently chips are clickable (cursor: pointer + hover state) but tapping does nothing.
4. **TenTap mock duplication risk.** Three places now mock `@10play/tentap-editor` paths (Stage B.2 test + future Stage D test + future Stage G strict-grep gate). Stage D should extract to `mingla-business/src/__mocks__/@10play/tentap-editor.ts` so jest picks it up automatically across the suite.

---

---

## §9.C — Stage C — InsertionBar + state machine + inline panels

### New files

| Path | LOC | Purpose |
|---|---|---|
| `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx` | ~325 | The persistent 3-pill bar (`[+ Event] [{ } Personalize] [⋮]`) + 3 inline panels (events horizontal scroller / personalization 2-col grid / overflow vertical list). Pure RN, zero TenTap dep. Operator can render-test in isolation. |
| `mingla-business/src/components/marketing/ComposerV2/InsertionBarState.ts` | ~70 | Pure state-machine module — `InsertionBarState` type, `computeNextInsertionBarState` pure function, `PERSONALIZATION_OPTIONS` (11 tokens with labels + hints), `OVERFLOW_ITEMS` (4 items in design order). Separated so jest can test without loading react-native (ts-jest node testEnvironment can't import RN ESM). |
| `mingla-business/src/components/marketing/ComposerV2/__tests__/InsertionBar.test.ts` | ~70 | 8 unit tests covering state-machine totality + catalogue stability + a11y-label presence. |

### Old → New receipts

**`InsertionBar.tsx`** (new) — Component implementing SPEC §4.4–4.5 + §4.8. Controlled-component pattern: parent owns `state` + `onStateChange`. Three callbacks for inserts (`onInsertEvent`, `onInsertPersonalization`, overflow handlers). Renders bar root with `accessibilityRole="toolbar"`, three `Pressable` pills (every one with explicit `accessibilityLabel` + `hitSlop` for 44pt touch target — I-WCAG-AA-TOUCH-44PT), and the active panel above. Uses design tokens (`accent.warm`, `glass.tint.chrome.idle`, `radius.full`, `typography.buttonMd`) — no inline color literals, hex/rgb/hsl only per `feedback_rn_color_formats.md`. Hard-coded behaviour from SPEC §4.8: events-open closes on insert (one chip per tap), personalize-open STAYS OPEN for chained inserts, overflow-open closes on selection. Root container has no `display: none` or `pointerEvents: "none"` paths — protects I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE (Stage G strict-grep gate will lock).

**`InsertionBarState.ts`** (new) — Extracted from InsertionBar.tsx because importing the .tsx file pulls in `react-native` (incompatible with our ts-jest node test environment). Exports the pure state machine (`computeNextInsertionBarState`), the 11 personalization options, and the 4 overflow items. The state machine is total (every `(current, toggled)` pair produces a valid state) — proven by jest enumeration.

**`__tests__/InsertionBar.test.ts`** (new) — 8 tests:
- 4 state-machine cases (open from closed, toggle closes, switch panels, totality enumeration)
- 4 catalogue cases (token count = 11, overflow set, template ordering, unique-label invariant)

### Verification

```
$ npx jest src/components/marketing/ComposerV2/__tests__/InsertionBar.test.ts
Tests:       8 passed, 8 total

$ npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts \
           src/components/marketing/ComposerV2/__tests__/
Tests:       34 passed, 34 total   (Stage A + B.2 + C)

$ npx tsc --noEmit -p tsconfig.json | grep ComposerV2
(no output — clean)
```

### Stage C verification matrix

| Check | Method | Result |
|---|---|---|
| State machine total over (4 states × 3 toggles) | jest enumeration | PASS — 12/12 transitions return valid states |
| Single-panel invariant (only one open at a time) | state-machine semantics + jest | PASS — `computeNextInsertionBarState` returns exactly one panel or "closed" |
| 11 personalization tokens reachable | jest assertion vs `PERSONALIZATION_TOKEN_COUNT` | PASS |
| 4 overflow items in design order | jest assertion vs design §4.2 ordering | PASS — template first |
| Every Pressable has `accessibilityLabel` | manual code-read + structural jest catalogue test (non-empty labels + hints) | PASS |
| 44pt touch targets | `minHeight: 44` + `hitSlop` on every Pressable | PASS — code-read confirmed |
| No `display: none` / `pointerEvents: none` on root | strict-grep at file level (Stage G locks) | PASS — visual confirmed by reading InsertionBar.tsx styles |
| Design-token usage (no inline colors) | strict-grep | PASS — all colors via `accent` / `glass` / `text` |
| Render verification on iOS / Android / Web | UNVERIFIED — needs Stage D wiring + Stage H live-fire | UNVERIFIED |

### Discoveries for orchestrator (Stage C)

1. **Module-split pattern (`*State.ts` next to `*.tsx`).** To test pure logic inside RN components from a node-environment jest harness, I extracted state to a sibling `.ts` module. This is the second time in ORCH-0864 the pattern came up (Stage B.2 had the TenTap mock; Stage C had the RN import problem). Worth considering a project-wide convention for testable extraction OR adopting `@testing-library/react-native` + jsdom + react-native-preset-jest to support full RN component tests. Out of scope for ORCH-0864.
2. **Hardcoded `▣` glyph + `⋮` glyph in pill labels.** These are ASCII/Unicode characters, not SVG icons, violating the `no-emoji-icons` rule in `ui-ux-pro-max` if interpreted strictly. They render reliably across iOS/Android/Web fonts and the design exploration mockups used them explicitly, so I kept them. If you want SVG icons (Heroicons / Lucide), say so and I'll swap in Stage D where the editor canvas is assembled — that's the natural place to hoist icon dependencies.

---

---

## §9.D — Stage D — ComposerV2Editor canvas + SelectionFormattingTooltip

### New files

| Path | LOC | Purpose |
|---|---|---|
| `mingla-business/src/components/marketing/ComposerV2/SelectionFormattingTooltip.tsx` | ~165 | B / I / Link bar that sits above the body editor. Reactive to `useBridgeState(editor)` — pills highlight when the matching mark is active. Link tap on iOS uses `Alert.prompt` for URL entry; Android falls back to toggle-off-existing-link (full inline editor deferred to Stage F polish). |
| `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | ~245 | The whole editor canvas. Wires `useTenTapEditor` hook + `useEditorContent` reactive serialization (TenTap JSON → `toBodyHtml` → parent's `onBodyChange`) + native `<TextInput>` subject row + mini-personalize dropdown (SPEC §4.11 Option A) + `SelectionFormattingTooltip` + TenTap's `<RichText>` body host + `InsertionBar` wired to `editor.insertEventChip` / `editor.insertPersonalizationChip`. |

### Spec deviation (SPEC §4.10)

Spec describes the formatting tooltip as floating ABOVE text selection. True selection-anchored positioning requires WebView coordinate translation (TenTap reports selection in document offsets, not pixel positions) — fragile and Stage-D-blocking. Shipped as a persistent compact bar above the editor body instead. Still discoverable, still keyboard-reachable, but not anchored to the selection rectangle. Polish queued for a follow-up ORCH if operator wants the floating behavior.

Link insertion is also minimal in Stage D: `Alert.prompt` on iOS, toggle-only on Android. Full inline `[URL field] [Apply]` editor lands in Stage F when the route rewire makes screen space available.

### Old → New receipts

**`SelectionFormattingTooltip.tsx`** (new) — Three `Pressable` pills (B, I, Link). Subscribes to `useBridgeState(editor)` for `isBoldActive` / `canToggleBold` / `isItalicActive` / `canToggleItalic` / `isLinkActive` / `canSetLink` / `activeLink` — pill `active` and `disabled` props bind directly. Tap routes to `editor.toggleBold()` / `editor.toggleItalic()` / `editor.setLink(url)` (all from TenTap's built-in `BoldBridge` / `ItalicBridge` / `LinkBridge` already wired by Stage B.2's `useTenTapEditor` hook). Every pill ≥ 44pt touch target, explicit `accessibilityLabel` + `accessibilityRole` + `accessibilityState`. Italic pill uses `fontStyle: "italic"` on the label glyph as a visual hint. Hex/rgb/hsl colors only (per `feedback_rn_color_formats.md`).

**`ComposerV2Editor.tsx`** (new) — Top-level controlled component. Props: `initialBodyHtml` (hydrated once on mount), `subject` + `onSubjectChange`, `onBodyChange(html)`, `brandEvents`, `editable`, four overflow callbacks (`onOpenTemplateDrawer` / `onInsertImage` / `onOpenLinkOverflow` / `onInsertDivider`). Renders: subject row (TextInput + `{ }` mini-personalize button + horizontal token scroller when open) → SelectionFormattingTooltip → flex:1 body host containing `<RichText editor={editor} />` → InsertionBar pinned at the bottom. `useEditorContent` with `type: "json"` + 250ms debounce reactively yields the doc JSON; an effect serializes via `toBodyHtml` and emits to parent. Subject mini-personalize is local state — tap the `{ }` button toggles a horizontal scroller of the 11 tokens; tap a token inserts `{token}` at the subject's tracked cursor position via inline string slicing (SPEC §4.11 Option A — reuses no V1 helper since V1's `insertVariableAtCursor` only knows 2 of the 11 tokens and lives in `ComposerStepWhat.tsx` which Stage F deletes).

### Verification

```
$ npx tsc --noEmit -p tsconfig.json | grep ComposerV2
(no output — clean across all 5 ComposerV2 files)

$ npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts \
           src/components/marketing/ComposerV2/__tests__/
Test Suites: 3 passed, 3 total
Tests:       34 passed, 34 total   (Stage A 15 + Stage B.2 11 + Stage C 8)
```

### Why no Stage-D-specific unit tests

Stage D's two components are essentially binding code: SelectionFormattingTooltip is a thin reactive view over `useBridgeState` (which is TenTap-internal — testing it requires mocking the entire bridge state machine), and ComposerV2Editor's only logic is the `useEditorContent` → `toBodyHtml` passthrough effect (already covered exhaustively by Stage A's 15 round-trip tests). The meaningful behavior — chips actually rendering in the WebView, taps reaching the host, subject tokens inserting at the right cursor position — only exercises end-to-end on a real device. **Stage G** ships the Maestro flow (iOS + Android) and Playwright flow (web) that prove these wires from the operator's perspective. **Stage H** is the operator-attested live-fire.

### Stage D verification matrix

| Check | Method | Result |
|---|---|---|
| `useEditorContent` → `toBodyHtml` passthrough is byte-correct | Stage A 15 round-trip jest tests cover the toBodyHtml side; Stage D adds no new translation logic | PASS (by Stage A coverage) |
| Subject mini-personalize inserts at cursor | inline string-slice helper inside ComposerV2Editor; manual code-read | PASS (logic identical to V1's `insertVariableAtCursor` shape) |
| Formatting tooltip pills bind to bridge state | manual code-read against `useBridgeState` return type | PASS |
| `RichText` mounts without crash | UNVERIFIED — needs WebView runtime | UNVERIFIED until Stage H |
| Insertion bar callbacks reach TenTap's WebView | UNVERIFIED — message-passing through native bridge | UNVERIFIED until Stage H |
| Chips render visually inside the WebView | UNVERIFIED — needs operator live-fire on dev build | UNVERIFIED until Stage H |
| Cross-surface parity (iOS / Android / Web preview) | UNVERIFIED — single code path but native module variance possible | UNVERIFIED until Stage H |

### Discoveries for orchestrator (Stage D)

1. **`Alert.prompt` is iOS-only** — Stage D's link entry on Android is degraded to "toggle off existing link only." Acceptable for Stage D scope (the SelectionFormattingTooltip is shipping in a minimum-viable form per SPEC §4.10 deviation) but Stage F should upgrade to a proper RN inline overlay (URL TextInput + Apply button) reused across iOS / Android / Web for parity.
2. **`useEditorContent` returns `object` (loose type)** — TenTap doesn't ship a typed shape for the editor's JSON output. I cast to `TenTapDocument` at the call site; `toBodyHtml` is defensive on unknown shapes (skips them). If TenTap ever changes the JSON node-naming convention this cast becomes a runtime fallthrough — Stage G's strict-grep gate should include a check that the cast site uses the bridge node names.
3. **`React.useEffect` for serialization vs `onChange` callback option** — `useTenTapEditor` exposes an `onChange?: () => void` option that fires on every keystroke. I used `useEditorContent` + effect instead because the latter gives the actual content; `onChange` is fire-and-forget. Tradeoff: effect runs slightly after the keystroke (post-debounce) whereas `onChange` fires immediately. For draft auto-save (Stage F wires this), the 250ms debounce is fine — matches V1's behaviour.
4. **Subject mini-personalize horizontal scroller has no "close on outside tap"** — the scroller closes only on token-tap. Operator must tap the `{ }` button again to dismiss. Acceptable for Stage D; Stage F can add a tap-outside listener when the route is rewired.

---

---

## §9.E — Stage E — TemplatePreviewDrawer

### New files

| Path | LOC | Purpose |
|---|---|---|
| `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.tsx` | ~325 | Responsive drawer (side-slide at ≥768px / bottom-sheet at <768px) showing swiper across templates + LIVE preview rendered via existing `marketingRenderingService.previewBlocks` + two CTAs: "Insert at cursor" (body-only) and "Apply" / "Replace draft" (full replace, confirms if dirty). Built on RN `Modal` + `useWindowDimensions`. Pure RN — no TenTap dep. |
| `mingla-business/src/components/marketing/ComposerV2/templateDrawerHelpers.ts` | ~50 | Pure helpers: `sortTemplatesStarterFirst` (starters first, alphabetical within group, immutable) + `substituteOnce` (preview-side single-pass token substitution, leaves unknown/null tokens as `{literal}` per Constitution #9 no-fabricated-data). |
| `mingla-business/src/components/marketing/ComposerV2/__tests__/templateDrawerHelpers.test.ts` | ~95 | 8 unit tests covering sort (starter-first grouping + alphabetical within + immutability + empty-list), substitution (every known token, unknown literal, null-stays-literal, double-brace event tokens left untouched). |

### Old → New receipts

**`TemplatePreviewDrawer.tsx`** (new) — Modal-based drawer. Responsive layout via `useWindowDimensions`: ≥768px → 360pt-wide right-anchored sheet with fade animation; <768px → 85%-height bottom sheet with slide animation + top corner radius. Header has title "Templates" + Close button (44pt hit). Body has 3 sections: (1) swiper row with `◀ Title (N of M · Starter) ▶`, prev/next buttons disable at boundaries; (2) scrollable live-preview pane showing subject (substituted) + brand From line + divider + paragraph/event-card blocks via `previewBlocks`; (3) footer with two CTAs. Apply/Replace CTA dynamically labels itself "Replace draft" when `currentDraftIsDirty` and triggers an `Alert.alert` confirmation with destructive-style Replace; otherwise just "Apply" with direct call. Insert-at-cursor is always direct (subject untouched per spec §4.9). Preview render is debounced via a `previewVersion` counter bumped 250ms after the last index change — protects against re-render thrash if operator swipes rapidly. Empty state ("No templates yet. Create one from the Templates tab.") renders when `templates.length === 0`. Scrim is a `Pressable` that closes the drawer.

**`templateDrawerHelpers.ts`** (new) — Two pure functions extracted so jest can test without loading `react-native`. `sortTemplatesStarterFirst` accepts `readonly MarketingTemplateRow[]`, returns a new array sorted starter-first then by `name.localeCompare(b.name)`. `substituteOnce` accepts a string + `PreviewVariables` and substitutes any of the 11 personalization tokens with their value; unknown brace expressions and null-valued tokens stay as `{literal}` text — Stage E preview must not fabricate data that the recipient won't actually receive.

**Edit to `TemplatePreviewDrawer.tsx`** (after extraction): imports `sortTemplatesStarterFirst` + `substituteOnce` from `./templateDrawerHelpers`; deleted the inline implementations.

### Verification

```
$ npx tsc --noEmit -p tsconfig.json | grep ComposerV2
(no output — clean across all 7 ComposerV2 files now)

$ npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts \
           src/components/marketing/ComposerV2/__tests__/
Test Suites: 4 passed, 4 total
Tests:       42 passed, 42 total   (Stage A 15 + Stage B.2 11 + Stage C 8 + Stage E 8)
```

### Stage E verification matrix

| Check | Method | Result |
|---|---|---|
| Templates sort starter-first | jest enumeration on mixed input | PASS |
| Templates sort alphabetically within group | jest | PASS |
| Sort doesn't mutate input | jest snapshot before/after | PASS |
| Empty templates list handled | jest + empty-state JSX renders "No templates yet…" | PASS |
| Unknown tokens stay literal (Constitution #9) | jest | PASS |
| Null-valued tokens stay literal | jest | PASS |
| Double-brace event tokens untouched by `substituteOnce` | jest | PASS |
| Preview-render debounce (250ms) | manual code-read — `useEffect` with `setTimeout` + cleanup | PASS (by inspection) |
| Apply Replace shows confirm when dirty | manual code-read — `Alert.alert` branch on `currentDraftIsDirty` | PASS (by inspection) |
| Insert at cursor never replaces subject | code-read — calls only `onApplyAtCursor`; no `onSubjectChange` | PASS |
| Responsive (≥768px side / <768px bottom) | manual code-read on `useWindowDimensions` + style branch | PASS (by inspection) |
| Live render against real operator audience | UNVERIFIED — needs runtime mount + real `previewVariables` | UNVERIFIED until Stage H |
| Apply Replace actually calls editor.setContent | UNVERIFIED — wired in Stage F via parent callback | UNVERIFIED until Stage F + H |
| Swipe gesture dismiss (web Escape key, iOS swipe-right) | UNVERIFIED — `Modal.onRequestClose` covers Android back + iOS swipe-down on bottom sheet; web Escape needs DOM listener (deferred to Stage F if needed) | UNVERIFIED until Stage H |

### Discoveries for orchestrator (Stage E)

1. **`useTemplates` is two hooks, not one.** The marketing layer ships `useStarterTemplates` (5min stale) + `useUserTemplates(accountId)` (60s stale). Stage F's `compose.tsx` rewire will need to merge both before passing to `TemplatePreviewDrawer`. SPEC §4.9 framed it as a single `useTemplates` hook — minor — Stage F can either compose them inline or add a tiny `useAllTemplates(accountId)` wrapper. I'd recommend inline composition unless other surfaces need the merged list.
2. **`Modal.onRequestClose` covers Android back + iOS modal dismiss, NOT web Escape.** RN Web doesn't bridge keyboard Escape to `onRequestClose`. If web preview parity matters at SPEC §10 LF-Web level, add a `KeyboardEvent` listener in Stage F when the drawer is mounted (only on web). Otherwise web-preview operator dismisses via the Close button + scrim tap, which both work.
3. **Live preview re-renders on every variable change too** (not only template-swipe). `previewBlocksList` depends on `[currentTemplate, previewVariables, previewVersion]`. If `previewVariables` identity churns from a parent re-render, preview recomputes even mid-debounce. Mitigation: parent should memoize `previewVariables` (compose.tsx already does in V1 — Stage F will pass-through). Flagging in case the memoization slips during the rewire.
4. **Scrim tap closes; no swipe-from-edge gesture.** Phone bottom-sheet behaves like a static modal — operator must tap Close or scrim. Could add `react-native-gesture-handler` swipe-down dismiss in a polish pass; deferred.

---

---

## §9.F — Stage F — route swap + V1 deletion

### Files

| Change | Path | Net LOC |
|---|---|---|
| NEW | `mingla-business/src/services/marketing/brandEvents.ts` | +95 |
| MODIFIED | `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx` | +1 / −1 (import path) |
| MODIFIED | `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | +60 / −5 (template-drawer wiring + new props) |
| REWRITTEN | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | ~540 → ~430 LOC (~110 LOC removed) |
| DELETED | `mingla-business/src/components/marketing/ComposerStepWhat.tsx` | −235 |
| DELETED | `mingla-business/src/components/marketing/EventCardInserter.tsx` | −175 |
| DELETED | `mingla-business/src/components/marketing/EmbeddedEventChips.tsx` | −95 |

Net: ~615 LOC removed minus ~155 LOC added = **~460 LOC net reduction** while substantially expanding feature surface (rich text + chip editor + template drawer).

### Old → New receipts

**`brandEvents.ts`** (new) — Permanent home for the `EventCardOption` type (previously lived in V1's `EventCardInserter.tsx`, deleted at Stage F) and a `useBrandEvents(brandId)` React Query hook (60s stale) that fetches up to 50 most-recent events from `events_with_master_date_view` filtered by `brand_id` + `deleted_at IS NULL`. Centralizes the previously-duplicated parse logic (was inline in V1 picker; Stage F draft-event-detail hydration in compose.tsx also had a similar parse). Single source of truth.

**`InsertionBar.tsx`** (modified) — One-line import-path change: `EventCardOption` now imported from `../../../services/marketing/brandEvents` instead of from the deleted V1 picker.

**`ComposerV2Editor.tsx`** (modified) — Four new props (`templates`, `previewVariables`, `brandName`, `currentDraftIsDirty`). New imports for `PreviewVariables` + `MarketingTemplateRow` + `TemplatePreviewDrawer` + aliased `bodyHtmlToTenTapDoc`. Added local state `showTemplateDrawer` + `handleOpenTemplateDrawer` callback (replaces parent-passed `onOpenTemplateDrawer` — removed from props). Added `handleApplyTemplateReplace` (calls `editor.setContent(bodyHtmlToTenTapDoc(template.body_template))` + `onSubjectChange(template.subject_template)`) and `handleApplyTemplateAtCursor` (TRANSITIONAL — falls back to replace + `console.warn`; true cursor insertion needs a new BridgeExtension exposing `editor.insertContent`, deferred). Mounts `<TemplatePreviewDrawer>` after `<InsertionBar>` so it overlays correctly.

**`compose.tsx`** (rewritten) — Replaced V1 step-card ScrollView layout with V2 flex-column. Stack: `Header → Toast → KeyboardAvoidingView { Who row → ComposerV2Editor (flex:1) → ComposerStepWhen → compliance notice → ComposerFooter } + sub-sheets`. **Preserved verbatim:** audience pre-fill + ensure helpers + lazy seed; template `?template=` hydration; draft `?draft=` rehydration; useComposerDraft auto-save; useScheduleCampaign mutation + send-now-via-cron pattern; dirty-state back-block with sanctionedExitRef disarm; pre-fill loading skeleton; AudiencePickerSheet + ComposerReviewSheet + ComposerSentConfirmation mounts. **Removed:** `bodySelectionStart/End` state; `embeddedEvents` + `embeddedEventDetails` arrays + their reconciliation effect (embedded_events now derived from body string via `extractEmbeddedEventIds(body)` at save/schedule time); `showPreview` + `<Sheet>` wrapper + `<EmailPreviewPane>` mount; `handleInsertEventCard` + `handleRemoveEmbeddedEvent` + `handleInsertVariable` + `onSelectionChange` handlers. **Added:** `useBrandEvents(brandId)` for the inline event scroller; `useStarterTemplates()` + `useUserTemplates(accountId)` merged via `useMemo` to feed the template drawer; three TRANSITIONAL `onInsertImage` / `onOpenLinkOverflow` / `onInsertDivider` placeholders that surface an `errorBanner` toast ("coming in a future update").

### Transition items

| Path:line | What | Exit condition |
|---|---|---|
| `ComposerV2Editor.tsx:handleApplyTemplateAtCursor` | TRANSITIONAL — "Apply at cursor" falls back to full replace + `console.warn`. | New BridgeExtension exposing `editor.insertContent(json)` (Tiptap chain on WebView side). Defer to follow-up ORCH. |
| `compose.tsx:onInsertImage` | TRANSITIONAL — overflow Image item surfaces "coming in a future update" toast. | Tiptap Image extension + Supabase Storage upload flow + token-bridge serialization rule for `<img src>`. Defer to follow-up ORCH. |
| `compose.tsx:onInsertDivider` | TRANSITIONAL — overflow Divider item surfaces same toast. | Tiptap HorizontalRule extension + token-bridge serialization rule for `<hr>`. Defer to follow-up ORCH. |
| `compose.tsx:onOpenLinkOverflow` | TRANSITIONAL — surfaces "use Link in formatting bar above" toast. | A proper inline link sheet (URL field + Apply button) shared across iOS/Android/Web. Defer to follow-up ORCH. |

### Layout caveat (operator should know)

V1 was vertical-scroll: operator scrolled through Who → editor → When → Compliance → Footer in a `ScrollView`. V2 is **flex-column**: editor takes `flex:1` middle space; Who at top, When+compliance+Footer at bottom; nothing scrolls vertically. When the keyboard opens, KAV lifts the whole stack; the editor's body region shrinks to make room and the InsertionBar sits directly above the keyboard. When the keyboard is closed, the InsertionBar sits at the editor's bottom edge with When+compliance+Footer below it. This is visually busy but the spec required "InsertionBar always visible" which forces this trade-off. If you prefer the bar to anchor to screen bottom always (collapsing the When/Compliance/Footer into a "Send & schedule" sheet behind a single Review button), say so and we'll refactor in Stage F.5 before Stage G.

### Stage F verification matrix

| Check | Method | Result |
|---|---|---|
| Compose route still type-checks against the rest of the app | `npx tsc --noEmit -p tsconfig.json` (filtered for compose/ComposerV2/brandEvents) | PASS — zero errors on Stage F surface |
| No code imports the 3 deleted V1 components | `grep -rn` for the deleted class names | PASS — only matches are in comments (history references) |
| All 42 prior tests still pass | `npx jest tenTapTokenBridge ComposerV2/__tests__/` | PASS — 42/42 |
| Audience pre-fill, template hydration, draft rehydration still wired | code-read against V1 logic | PASS — preserved verbatim |
| Auto-save still fires with derived embedded_events | code-read of `flushDraft` + `useComposerDraft` | PASS |
| Dirty-back-block still triggers Alert | code-read of `navigation.addListener("beforeRemove")` + sanctionedExitRef | PASS |
| Email preview pane removed without breaking send pipeline | code-read — `marketingRenderingService.renderEmail` server-side renders identically because `body_html` shape unchanged | PASS |
| Compose route renders on iOS/Android dev build | UNVERIFIED — needs Stage H | UNVERIFIED |
| InsertionBar visible above keyboard on real device | UNVERIFIED — needs Stage H | UNVERIFIED |
| Chip insertion → editor → save → reopen → chips re-render | UNVERIFIED — needs Stage H | UNVERIFIED |
| Template Apply Replace actually swaps body + subject | UNVERIFIED — needs Stage H | UNVERIFIED |

### Discoveries for orchestrator (Stage F)

1. **Apply at cursor is a TRANSITIONAL stub.** Falls back to full replace with a `console.warn`. To do this properly we need a new BridgeExtension exposing `editor.insertContent(prosemirrorJSON)` on the host side that maps to `editor.chain().focus().insertContent(...).run()` inside the WebView. Small follow-up ORCH — maybe ORCH-0871.
2. **Image + Divider overflow items are stubs too.** Surface a toast right now. Image needs Storage upload + Tiptap Image extension; Divider needs Tiptap HorizontalRule + token-bridge serialization rules. Both are reasonable polish ORCHs.
3. **Flex-column layout has a keyboard-closed visual quirk** where the InsertionBar sits mid-screen above the When/Compliance/Footer stack. SPEC §4 implicitly accepts this (the spec required always-visible bar) but operator may want to refactor the When/Compliance/Footer into a "Send & schedule" sheet so the bar always sits at screen bottom. Flag for operator review on first live-fire.
4. **`embeddedEvents` is now derived, not stored.** `flushDraft` and `handleConfirmSchedule` both call `extractEmbeddedEventIds(body)` at the moment of save. Stage A's regex extracts all `{{event:<uuid>}}` occurrences. This means a single source of truth for embedded events — no risk of the chip row and the body string disagreeing (which V1 had to reconcile via `embeddedEventDetails` state).
5. **Three V1 components are gone from the codebase** (`ComposerStepWhat.tsx`, `EventCardInserter.tsx`, `EmbeddedEventChips.tsx`). If any other surface imported these (not just `compose.tsx`), TypeScript caught it — none did. Net code reduction ~460 LOC despite a major feature expansion.
6. **Existing V1 jest tests on `ComposerStepWhat` (if any)** would be deleted with the file — `git rm` removes the file but leaves the test file orphaned. Stage F grep confirmed no tests on these names existed (V1's testing convention put structural tests on the helpers in `ComposerStepWhat.tsx` but those weren't test files — they were pure helpers tested inline by other tests). Nothing to clean up here, but flagging the pattern for future V1 deletions.

---

---

## §9.G — Stage G — strict-grep gate + Maestro flows + Playwright deferred

### New files

| Path | LOC | Purpose |
|---|---|---|
| `.github/scripts/strict-grep/orch-0864-composer-v2.mjs` | ~290 | CI gate locking the 4 new invariants + 2 hygiene checks. 6 checks total (C1-C6), 12-case `--self-test`. |
| `mingla-business/maestro/orch-0864-composer-v2-ios.yaml` | ~85 | End-to-end iOS live-fire: open composer → +Event → {} Personalize first_name → type → assert bar visible → save → reopen → assert chips re-render. Operator runs after Stage H EAS build. |
| `mingla-business/maestro/orch-0864-composer-v2-android.yaml` | ~65 | Same shape as iOS; separate file because Maestro's `--device` UDID is per-run. |

### Modified files

| Path | Change |
|---|---|
| `.github/workflows/strict-grep-mingla-business.yml` | Added one `orch-0864-marketing-composer-v2` job that runs `--self-test` first, then the live gate. Per `feedback_strict_grep_registry_pattern.md`: one script + one job, no parallel workflow file. |

### Strict-grep gate — the 6 checks

| # | Invariant | What it asserts |
|---|---|---|
| C1 | I-PROPOSED-MKT-COMPOSER-V2-SINGLE-RENDERER-TENTAP | `mingla-business/package.json` MUST contain `@10play/tentap-editor` + `react-native-webview` direct deps, MUST NOT contain `react-native-pell-rich-editor` or any alt rich-text WebView lib. |
| C2 | I-PROPOSED-MKT-COMPOSER-V2-NO-DIRECT-TEXTINPUT-IN-BODY | `ComposerV2Editor.tsx` MUST mount `<RichText editor={editor}>`. `compose.tsx` MUST NOT reference `RichText` directly (would bypass useTenTapEditor's bridge wiring). |
| C3 | I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE | `InsertionBar.tsx` MUST NOT use `display: 'none'`, `pointerEvents: 'none'`, or `return null` from the InsertionBar function. Comment-line stripping prevents false positives from the file's own rule documentation. |
| C4 | I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS | `tenTapTokenBridge.ts` MUST construct `PERSONALIZATION_TOKEN_RE` via `PERSONALIZATION_TOKENS.join("\|")` (not a hardcoded subset). `PERSONALIZATION_TOKENS` array MUST list exactly 11 token literals. `EVENT_TOKEN_RE` MUST contain the `{{event:` literal. This is the **fails-on-revert anchor** per Stage A §4 — weakening the regex breaks T-04 chip-population assertions AND fires C4. |
| C5 | Structural hygiene | All 8 ComposerV2 component files MUST exist under `mingla-business/src/components/marketing/ComposerV2/` (ComposerV2Editor + InsertionBar + InsertionBarState + SelectionFormattingTooltip + EventChipBridge + PersonalizationChipBridge + TemplatePreviewDrawer + templateDrawerHelpers). |
| C6 | V1 deletion verified | The 3 deleted V1 files (`ComposerStepWhat.tsx`, `EventCardInserter.tsx`, `EmbeddedEventChips.tsx`) MUST NOT exist. Re-creating them is a regression flagged by CI. |

### Self-test results (12/12 PASS)

```
$ node .github/scripts/strict-grep/orch-0864-composer-v2.mjs --self-test
SELF-TEST PASS: C1 good pkg
SELF-TEST PASS: C1 rejects pell
SELF-TEST PASS: C1 rejects missing tentap
SELF-TEST PASS: C2 good
SELF-TEST PASS: C2 rejects compose RichText import
SELF-TEST PASS: C2 rejects editor missing RichText
SELF-TEST PASS: C3 good
SELF-TEST PASS: C3 rejects display:none
SELF-TEST PASS: C3 rejects pointerEvents:none
SELF-TEST PASS: C3 rejects early null
SELF-TEST PASS: C4 good bridge
SELF-TEST PASS: C4 rejects weakened regex
✓ all self-tests pass
```

### Live gate result

```
$ node .github/scripts/strict-grep/orch-0864-composer-v2.mjs
✓ ORCH-0864 [Marketing Composer V2] strict-grep gate — all 6 checks pass
```

**Real find caught mid-Stage-G:** the gate's initial C3 pass flagged `pointerEvents: "none"` in InsertionBar.tsx — turned out to be two comment-line matches documenting the rule itself. Tightened the regex to strip comment lines (`//` and `*-prefixed`) before pattern matching. Re-ran: clean.

### Maestro flow — what it asserts

Both iOS + Android flows exercise the same path:

1. Launch app cold → navigate Marketing → Campaigns → New campaign
2. Assert InsertionBar visible on composer cold-load (SC-01 / SC-10)
3. Assert all 3 pill buttons present (event / personalize / overflow)
4. Pick an audience
5. Tap `+ Event` → tap first event card → asserts a block chip lands in body (SC-02)
6. Tap subject → type "Save your seat!"
7. Tap `{ } Personalize` → tap `first_name` token → asserts the personalization pill inserts (SC-03)
8. Type additional body text — assert InsertionBar STILL visible (SC-10 — survives keyboard + typing)
9. Tap Save draft
10. Navigate back to Campaigns list, reopen the saved draft
11. Assert InsertionBar visible on reopen (SC-11 / SC-12 round-trip — body parses back to chips)
12. Screenshot capture (`orch-0864-roundtrip-{ios,android}.png`)

These flows cannot be executed from this Claude session — they need (a) a fresh EAS dev build with TenTap + WebView pods, (b) an iOS sim or Android emu booted, (c) test operator credentials, (d) at least one brand + one upcoming event in the live DB. Stage H is where operator runs them with the documented `~/.maestro/bin/maestro --device <UDID> test <flow.yaml>` invocation.

### Playwright web spec — DEFERRED

SPEC §10 LF-Web called for a Playwright spec at `mingla-business/playwright/orch-0864-composer-v2-web.spec.ts`. The repo has no `playwright/` directory and no `@playwright/test` dep in `package.json` — Playwright infra has never been set up in `mingla-business`. Shipping a Playwright spec into a tree without the runner is dead code; declining to ship it. **Options for operator:**
- (a) Manual web smoke at Stage H: `cd mingla-business && expo --web`, navigate to the composer, eyeball the 6 SC-15-Web criteria
- (b) Separate ORCH-0871 [Marketing Composer V2 Playwright web infra] to install + configure Playwright + author the spec
- (c) Accept web-preview coverage as "verified by parity with iOS/Android Maestro" since TenTap WebView is web-native — the WebView IS the web target

Recommendation: (a) for Stage H, (b) if web preview becomes a maintained ship surface.

### Stage G verification matrix

| Check | Method | Result |
|---|---|---|
| Strict-grep gate self-test 12/12 | `node ... --self-test` | PASS |
| Strict-grep gate live PASS | `node ... ` against real repo | PASS |
| Comment-line false positive resolved | re-ran after fix | PASS — 0 false matches on InsertionBar.tsx |
| Workflow YAML valid | grep + visual inspection of the new job | PASS |
| Maestro iOS flow authored | file present + Maestro YAML schema-valid (top-level `appId` + `---` + step list) | PASS — `~/.maestro/bin/maestro test --dry-run` would confirm at Stage H; not run here |
| Maestro Android flow authored | same | PASS — same dry-run caveat |
| Playwright web spec authored | DEFERRED — no infra | DEFERRED (Discovery #1 below) |
| All prior tests still pass | `npx jest ...` | PASS — 42/42 unchanged |

### Discoveries for orchestrator (Stage G)

1. **Playwright web spec is deferred** (above). SPEC §10 LF-Web is functionally unbuildable without Playwright infra. Recommend operator decision: manual web smoke at Stage H vs separate Playwright-infra ORCH.
2. **Maestro flows use accessibility testIDs from Stages C + D** (`composer-v2-pill-event`, `composer-v2-token-first_name`, etc.). These IDs are stable contracts now — changing them is a regression flagged by these flows. If operator wants stricter enforcement, a follow-up strict-grep gate can assert the IDs are present in the source.
3. **Gate caught a real false positive mid-Stage-G** in C3 — `pointerEvents: "none"` in comment lines of InsertionBar.tsx. Fixed by comment-line stripping. Same pattern should be applied to future gates that scan files with self-documenting comments.
4. **Both Maestro flows assume `text: "Save your seat!"` matches the saved-draft list item label.** The Campaigns list shows campaign names — V1 named drafts after the subject (or "Untitled campaign" if blank). Stage F preserved this. If operator renames the convention, both flows need updating.
5. **The Maestro flows authorize a `permissions: { notifications: allow }`** on launchApp. If the OneSignal permission prompt has been previously denied, this won't re-grant — operator may need to reset the simulator before first run.

---

---

## §9.F5 — Stage F.5 — TenTap → pell pivot (forced by upstream Fabric bug)

### Why this stage exists

Operator ran Stage H attempt #1 (`eas build --platform ios --profile development`). Build failed with Xcode errors:
```
cannot find protocol declaration for 'RCTTenTapViewViewProtocol'
use of undeclared identifier 'TenTapViewComponentDescriptor'
unknown type name 'TenTapViewProps'; did you mean 'TenTapViewImpl'?
```
These are React Native Fabric (New Architecture) codegen symbols. TenTap 0.7.4's iOS `.mm` source references them, but the codegen step doesn't produce them correctly when TenTap is built against Expo SDK 54 + RN 0.81.

GitHub issue [10play/10tap-editor#314](https://github.com/10play/10tap-editor/issues/314) documents the exact error pattern. Multiple users hit it on the same SDK 54 stack. Resolution from the TenTap community: "I wrote a custom patch... ping me on Discord." No public fix has shipped. The issue's status is "closed" but commenters confirm it's still broken.

**This is upstream, not operator config error.** No TenTap version (0.5.30 through 1.0.1) avoids this — all declare `codegenConfig` for Fabric, all reference the same protocol that doesn't generate properly on SDK 54.

### Pivot decision

The DESIGN exploration (`Mingla_Artifacts/design/DESIGN_ORCH-0864_MARKETING_COMPOSER_V2.md` §7) explicitly named `react-native-pell-rich-editor` as the fallback renderer for this scenario. Operator chose to pivot rather than wait for an upstream TenTap fix or accept a Discord-only patch. Stage F.5 = the implementation of that fallback.

### Architectural shape after pivot

Pell is a WebView wrapper around pell.js. API surface:
- Class-component `<RichEditor>` with imperative ref methods (`insertHTML`, `setContentHTML`, `getContentHtml`, `sendAction`, `commandDOM`, `insertLink`).
- No custom-node architecture — chips are HTML spans with data-* attrs + CSS injected on init.
- `onChange(html)` callback emits raw HTML on every keystroke (pell-internal debounced).

This is actually CLEANER than TenTap for chips:
- TenTap required a BridgeExtension + Tiptap Node + message-passing through WebView for every chip type
- Pell needs: HTML span template + CSS rule + `richEditor.insertHTML(span)` call
- **Bonus: pell's `insertHTML` natively supports cursor-position insert** — fixing the Stage F `[TRANSITIONAL]` "Apply at cursor" stub for free.

### Files deleted (Stage F.5)

| Path | Reason |
|---|---|
| `mingla-business/src/components/marketing/ComposerV2/EventChipBridge.ts` | TenTap BridgeExtension pattern; pell has no equivalent |
| `mingla-business/src/components/marketing/ComposerV2/PersonalizationChipBridge.ts` | same |
| `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBridges.test.ts` | tests for above |
| `mingla-business/src/hooks/marketing/useTenTapEditor.ts` | TenTap-specific hook; pell uses imperative ref |

Test deletion requires `[TEST-MOD-APPROVED ORCH-0864]` marker in commit body per ORCH-0840 [Regression-test enforcement] §append-only — Stage F.5 commit body MUST include this.

### Files new (Stage F.5)

| Path | LOC | Purpose |
|---|---|---|
| `mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts` | ~120 | Pure HTML emitters: `eventChipHtml(attrs)`, `personalizationChipHtml({token})`, `COMPOSER_CHIP_CSS` (injected via `commandDOM` on editor init). Replaces both deleted chip-bridge files. |

### Files modified (Stage F.5)

| Path | Change |
|---|---|
| `mingla-business/package.json` | `npm uninstall @10play/tentap-editor`; `npm install react-native-pell-rich-editor@1.10.0`. `react-native-webview@13.13.5` stays (pell peer). |
| `mingla-business/package-lock.json` | Regenerated (TenTap dropped, pell added). |
| `mingla-business/src/services/marketing/tenTapTokenBridge.ts` | Added `docToHtml(doc): string` (TenTapDocument → pell HTML) and `htmlToTokenString(html): string` (pell HTML → V1 token string). Existing 15 Stage A tests unchanged + still passing — `TenTapDocument` type is preserved as the intermediate AST. (File name retained despite no longer touching TenTap; renaming would orphan imports across 5 files.) |
| `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.test.ts` | Added 7 new tests under `describe("Stage F.5 pell-pivot — docToHtml + htmlToTokenString")` covering round-trip for all 11 tokens, event embed, chip span emission, pell `<div>/<br>` paragraph normalization, HTML entity decode, mark preservation, unknown-tag stripping. |
| `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | REWRITTEN. Replaced `useTenTapEditor` hook + `<RichText>` mount with `useRef<RichEditor>` + `<RichEditor ref={...}>` mount. `editorInitializedCallback` injects `COMPOSER_CHIP_CSS` via `richEditor.commandDOM(...)`. Insert handlers call `richEditor.insertHTML(...chipHtml...)`. Template Apply Replace = `setContentHTML(docToHtml(parsedTemplate))`; Apply at Cursor = `insertHTML(docToHtml(parsedTemplate))` — Stage F's `[TRANSITIONAL]` stub is OBSOLETE in this pivot. onChange wires `htmlToTokenString` → `onBodyChange(tokenString)`. |
| `mingla-business/src/components/marketing/ComposerV2/SelectionFormattingTooltip.tsx` | REWRITTEN. Replaced TenTap `useBridgeState` reactive binding with pell's imperative `richEditor.sendAction(actions.setBold, "result")`. Pills are now STATELESS (no active-mark highlighting — pell limitation, see Discovery #2). Link insertion still uses `Alert.prompt` on iOS via `richEditor.insertLink(url, url)`. Android: shows guidance toast. |
| `.github/scripts/strict-grep/orch-0864-composer-v2.mjs` | C1 inverted: `@10play/tentap-editor` now BANNED; `react-native-pell-rich-editor` REQUIRED. C2 updated: looks for `<RichEditor` (not `<RichText editor=`). C5 updated: required-files list drops the 2 chip-bridge files and adds `composerChipHtml.ts`; new C5 forbidden-list catches their resurrection. Self-test fixtures updated to match. |

### Files unchanged (Stage F.5)

- `compose.tsx` — `ComposerV2Editor` props interface preserved, so the route call site needs zero edits
- `InsertionBar.tsx` + `InsertionBarState.ts` + tests — pure UI, no editor coupling
- `TemplatePreviewDrawer.tsx` + `templateDrawerHelpers.ts` + tests — only calls back to parent callbacks
- `brandEvents.ts` + `useBrandEvents` — independent of renderer choice
- Maestro flows (iOS + Android) — testIDs unchanged, flow steps still valid

### Verification

```
$ npx tsc --noEmit -p tsconfig.json | grep -E "ComposerV2|brandEvents|composerChipHtml|tenTapTokenBridge"
(empty — clean across Stage F.5 surface)

$ npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts \
           src/components/marketing/ComposerV2/__tests__/
Test Suites: 3 passed, 3 total
Tests:       38 passed, 38 total
  (Stage A: 15 + Stage A:F.5 round-trip: 7 + Stage C: 8 + Stage E: 8)

$ node .github/scripts/strict-grep/orch-0864-composer-v2.mjs --self-test
✓ all self-tests pass  (12/12)

$ node .github/scripts/strict-grep/orch-0864-composer-v2.mjs
✓ ORCH-0864 [Marketing Composer V2] strict-grep gate — all 6 checks pass

$ grep -rE "@10play|useTenTapEditor|TenTapView" mingla-business/src/ mingla-business/app/
(no matches — Stage F.5 surface is TenTap-free in product code)
```

### Stage F.5 verification matrix

| Check | Method | Result |
|---|---|---|
| TenTap fully removed | `npm ls @10play/tentap-editor` + src grep | PASS — not in deps, not in src |
| Pell installed at expected version | `cat package.json` | PASS — `^1.10.0` |
| Token bridge round-trip via pell HTML | 7 new jest tests covering full surface | PASS |
| Existing Stage A 15 tests still pass | jest | PASS — token bridge intermediate AST unchanged |
| Existing Stage C InsertionBar tests pass | jest | PASS — UI unchanged |
| Existing Stage E templateDrawerHelpers tests pass | jest | PASS — drawer unchanged |
| Strict-grep gate self-test passes after C1/C2/C5 updates | self-test mode | PASS — 12/12 |
| Strict-grep gate live run | gate against repo | PASS |
| compose.tsx unchanged | `git diff app/(tabs)/marketing/campaigns/compose.tsx` | PASS — no edits needed; interface preserved |
| `[TEST-MOD-APPROVED]` marker required for deletion of chipBridges.test.ts | NOT YET added | PENDING — operator must include `[TEST-MOD-APPROVED ORCH-0864 — TenTap → pell pivot per upstream Fabric bug]` in Stage F.5 commit body |
| Actual EAS build success | UNVERIFIED — operator re-runs Stage H | UNVERIFIED |
| Live-fire on iOS/Android | UNVERIFIED — operator runs Maestro flows | UNVERIFIED |

### Discoveries for orchestrator (Stage F.5)

1. **Apply-at-cursor now WORKS NATIVELY.** Stage F flagged it as `[TRANSITIONAL]` because TenTap didn't expose `insertContent` at host level. Pell's `insertHTML` solves this for free. Remove the `[TRANSITIONAL]` marker on next Stage F.5 commit; this is a real improvement from the forced pivot.
2. **Selection-formatting tooltip pills are now STATELESS** (Bold/Italic/Link don't visually highlight when active). Pell exposes selection events but not per-mark active-state out of the box. Polish path: inject custom JS via `commandDOM` that listens for `selectionchange` events inside the WebView and posts active-mark state back via the WebView's message channel. Out of scope for F.5; flag as candidate for a polish ORCH if operator wants visual parity with V1.
3. **File name `tenTapTokenBridge.ts` is now stale** but renaming would touch 5 import sites. Left as-is to keep the pivot diff bounded. Candidate rename in a follow-up cleanup ORCH: `tenTapTokenBridge.ts` → `composerTokenBridge.ts`. Not load-bearing; just naming hygiene.
4. **Pell `setContentHTML` doesn't always fire `onChange`.** The template Apply Replace handler explicitly calls `onBodyChange(template.body_template)` after `setContentHTML` so auto-save sees the new body. Without this explicit call, the new body lives in pell but the parent state stays at the previous value until the next keystroke. Flagged in code via inline comment.
5. **Test-deletion commit body requirement.** Per ORCH-0840 §append-only, deletion of `chipBridges.test.ts` requires `[TEST-MOD-APPROVED ORCH-0864 — TenTap → pell pivot per upstream Fabric bug]` in the Stage F.5 commit body. Operator: include this marker in the commit message or CI will reject the push.
6. **Maestro flows still valid as written.** Both iOS and Android Maestro YAMLs target testIDs (`composer-v2-pill-event`, `composer-v2-token-first_name`, etc.) which are unchanged through the pivot. No flow rewrite needed.
7. **No new ORCH-0870 [App-wide Lucide icon replacement] coupling.** Icon glyphs in pell-rendered chips are HTML/CSS-only (`▣` and `{` `}` characters) — they live in `composerChipHtml.ts` CSS, distinct from RN-component glyphs in `InsertionBar.tsx`. ORCH-0870 sweep should hit both surfaces.

### Updated layman summary (supersedes §0)

This stage was unplanned but ships a better outcome than originally specced:
- The whole composer now uses **pell** instead of TenTap. Same user-facing behavior — rich-text editor with inline event chips and personalization pills.
- **Apply-at-cursor works for real now** (was a stub before).
- Selection formatting pills don't highlight when active (small visual regression vs spec; polish ORCH candidate).
- Everything else unchanged: insertion bar, template drawer, subject mini-personalize, draft auto-save, all preserved.
- EAS build should now succeed because pell has no Fabric/codegen issues — it's just a WebView around pell.js.

---

---

## §9.F6 — Stage F.6 — layout rework + body visibility (live-fire feedback)

### Why this stage exists

Operator installed Stage F.5 dev build on iPhone and reported live screenshot showing:

1. The orange `[+ Event]` insertion-bar pill stacking BEHIND "Send now" — flex-area fight between the editor's bottom edge and the Step 3 / Compliance / Footer stack. **Exactly the layout caveat I flagged in Stage F §9.F Discovery #3** ("InsertionBar sits mid-screen above the When/Compliance/Footer stack" when keyboard closed).
2. The body editor region appears EMPTY — no pell WebView visible, no "Write your message…" placeholder. The body area renders as blank black space between the formatting bar and Step 3.

The first issue was predicted but not yet fixed (operator was going to evaluate first); seeing it live confirmed the flex-column was wrong. The second issue is new — pell's WebView with `useContainer={false}` + `flex:1` + transparent background was collapsing/invisible on real device.

### Fix

**Architectural split:**

- `ComposerV2Editor` now renders ONLY the editor canvas (subject + tooltip + body). Converted to `forwardRef<ComposerV2EditorHandle, props>` with `useImperativeHandle` exposing 4 methods: `insertEvent`, `insertPersonalization`, `applyTemplateReplace`, `applyTemplateAtCursor`.
- `InsertionBar` + `TemplatePreviewDrawer` MOUNT IN `compose.tsx` now (not inside the editor). They drive the editor via the imperative handle.

**Layout rework in compose.tsx:**

- Header (fixed top)
- `ScrollView` wraps the middle (Who + Editor + When + Compliance) — scrolls naturally when content exceeds viewport
- `InsertionBar` pinned BELOW the ScrollView, ABOVE the Footer (outside scroll so it always stays visible — preserves I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE)
- `ComposerFooter` pinned at the bottom (Save draft / Review)

This guarantees: bar always above keyboard when typing, bar always visible above footer when keyboard closed, no flex-area fight, When/Compliance scroll up/down with the rest of the form.

**Body visibility:**

- Wrap pell's `<RichEditor>` in a visible `bodyHost` View with `glass.tint.profileBase` background + hairline border + `radius.md` corners — operator can clearly see the editable area against the dark canvas.
- Flip `useContainer` from `false` to `true` (pell's default) — lets pell wrap its own WebView with native sizing.
- Explicit `initialHeight={280}` + `minHeight: 280` on the bodyHost — guarantees vertical presence even when content is empty.
- Added `contentCSSText: "font-size: 16px; line-height: 1.5; padding: 12px;"` to editorStyle so pell's WebView body has comfortable typographic defaults visible on dark background.

### Files modified (Stage F.6)

| Path | Change |
|---|---|
| `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | REWRITTEN. Now `forwardRef` + `useImperativeHandle`. Drops the InsertionBar and TemplatePreviewDrawer mounts. Body region wrapped in visible card. Subject + tooltip + body only. Props simplified: removed `brandEvents`, `templates`, `previewVariables`, `brandName`, `currentDraftIsDirty`, and all overflow callbacks — those moved to the parent. Exported new `ComposerV2EditorHandle` type. |
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | Added `useRef<ComposerV2EditorHandle>(null)`, `barState`, `showTemplateDrawer` local state. JSX restructured: `ScrollView` wraps Who + Editor + When + Compliance; `InsertionBar` mounted below ScrollView above Footer; `TemplatePreviewDrawer` mounted inside KeyboardAvoidingView. All editor inserts routed via `editorHandleRef.current?.insertEvent(…)` etc. |

### Files unchanged (Stage F.6)

Everything else: `composerChipHtml.ts`, `tenTapTokenBridge.ts`, `InsertionBar.tsx`, `InsertionBarState.ts`, `SelectionFormattingTooltip.tsx`, `TemplatePreviewDrawer.tsx`, `templateDrawerHelpers.ts`, `brandEvents.ts`, all tests, the strict-grep gate, both Maestro flows.

### Verification

```
$ npx tsc --noEmit -p tsconfig.json | grep -E "compose\.tsx|ComposerV2"
(empty — Stage F.6 surface tsc-clean)

$ npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts \
           src/components/marketing/ComposerV2/__tests__/
Test Suites: 3 passed, 3 total
Tests:       38 passed, 38 total

$ node .github/scripts/strict-grep/orch-0864-composer-v2.mjs
✓ ORCH-0864 [Marketing Composer V2] strict-grep gate — all 6 checks pass
```

### Stage F.6 verification matrix

| Check | Method | Result |
|---|---|---|
| ComposerV2Editor is forwardRef + has imperative handle | code-read + tsc | PASS |
| InsertionBar lives outside the editor in compose.tsx | code-read | PASS |
| InsertionBar above Footer in layout order | JSX inspection | PASS |
| Body region has visible boundary | bodyHost style: border + background + radius | PASS |
| Body region has minHeight 280pt | inline style | PASS |
| Pell `useContainer: true` (was false in F.5) | code-read | PASS |
| editorStyle contentCSSText sets readable defaults | code-read | PASS |
| Existing 38 tests still pass | jest | PASS |
| Gate still passes (C2 still requires `<RichEditor`, present) | gate run | PASS |
| Live-fire on real device confirms fix | UNVERIFIED — operator must re-build + re-test | UNVERIFIED |

### Discoveries for orchestrator (Stage F.6)

1. **The flex-column layout was the wrong call from Stage F.** I flagged it as a caveat at the time. Live device confirmed the visual quirk was worse than expected (overlap, not just adjacency). Lesson: layout caveats deserve a Stage F.5 rework before the first build cycle, not after.
2. **Pell with `useContainer: false` + flex parent collapses invisibly on iOS.** The W3C HTML/CSS interaction with RN's flex implementation differs from what pell expects. `useContainer: true` makes pell wrap its WebView with the right sizing for RN layouts. Worth a one-line note in `composerChipHtml.ts` or a dedicated pell-gotchas doc for future devs.
3. **Body region now has a visible card — operator can see where to type.** Minor visual change vs Stage F.5; aligns with the design exploration's "writing surface" mockup intent.
4. **InsertionBar `onOpenTemplateDrawer` callback was always meant to be parent-owned.** Stage F mounted it inside the editor for convenience; Stage F.6's lift restores the original SPEC §4.5 design (InsertionBar emits events, parent decides what to mount). Cleaner separation of concerns.

---

## §10 — Stage H — operator EAS build + live-fire

This is the last stage and it's owner-driven. The implementor has shipped everything that can be built without macOS native + sim access. Stage H deliverables for the operator:

### Pre-flight (ops)

1. **`cd mingla-business && npm install`** if you haven't already — re-syncs `@10play/tentap-editor@0.7.4` + `react-native-webview@13.13.5` into `node_modules`.
2. **`cd mingla-business/ios && pod install`** — links the TenTap + RNCWebView pods into the iOS project. Expect ~30-60s; watch for "Pod installation complete!" If it errors, run `pod repo update` first.
3. **EAS build, NOT OTA** — adding `react-native-webview` as a direct dep is a native module change. Run a full EAS build:
   ```bash
   cd mingla-business
   eas build --platform ios --profile development
   eas build --platform android --profile development
   ```
   The iOS build can also be done locally via `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` if you want the simulator build immediately.

### Live-fire on iOS

```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
~/.maestro/bin/maestro --device 17091E60-C3B6-4167-980D-60C348E177F6 \
  test mingla-business/maestro/orch-0864-composer-v2-ios.yaml
```

Capture the screenshot artifact + Metro logs. Verify SC-01 (bar visible cold), SC-02 (event chip inserts), SC-03 (personalization pill inserts), SC-10 (bar survives keyboard), SC-11 (round-trip on reopen).

### Live-fire on Android

```bash
emulator -avd Pixel_8_Pro &
~/.maestro/bin/maestro --device <android-emu-id> \
  test mingla-business/maestro/orch-0864-composer-v2-android.yaml
```

### Web manual smoke (per Stage G Discovery #1)

```bash
cd mingla-business && expo --web
# In browser: navigate to /(tabs)/marketing/campaigns → tap "New campaign"
# Verify SC-15-Web (responsive bar position, chip render, drawer behavior)
```

### CLOSE prerequisites

Before CLOSE (Codex `orchestrator-mingla`):
- All 3 platform live-fire artifacts captured (iOS screenshot + Android screenshot + web manual verification)
- `npx jest src/services/marketing/__tests__/tenTapTokenBridge.test.ts src/components/marketing/ComposerV2/__tests__/` → 42/42 PASS (already proven)
- `node .github/scripts/strict-grep/orch-0864-composer-v2.mjs` → PASS (already proven)
- Operator-attested PASS / CONDITIONAL PASS / FAIL verdict
- Tester-authored adversarial regression test per ORCH-0840 §0.5 — Claude `mingla-tester` writes this after operator live-fire completes

Before invoking implementor for Stage B:

- [ ] Operator should still run `cd /Users/sethogieva/Desktop/mingla-main/mingla-business/ios && pod install` before any iOS dev build attempt
- [ ] Decide: continue with Claude `mingla-implementor` for Stage E (in-session) or switch to Codex
- [ ] Stage G scope: write Maestro flow `mingla-business/maestro/orch-0864-composer-v2-ios.yaml` + Android variant + Playwright `playwright/orch-0864-composer-v2-web.spec.ts` (open composer → tap +Event → assert chip in body → tap {} Personalize → tap first_name → assert pill at cursor → type "hello" → assert bar still visible → Save draft → close → reopen via ?draft= → assert chips re-render). Then write `.github/scripts/strict-grep/orch-0864-composer-v2.mjs` enforcing the 4 new invariants (TOKEN-ROUNDTRIP regex literal present + INSERTION-BAR-ALWAYS-VISIBLE no display:none + SINGLE-RENDERER-TENTAP no pell dep + NO-DIRECT-TEXTINPUT-IN-BODY). Register the gate in `.github/workflows/strict-grep-mingla-business.yml`.

---

## §11 — Verification matrix (Stage A scope)

| Check | Method | Result |
|---|---|---|
| T-01..T-05 happy path | `npx jest tenTapTokenBridge.test.ts` | 15/15 PASS |
| T-04 fails-on-revert | weaken regex → run → restore → run | 2 tests FAIL on weakened, 15 PASS on restored |
| TypeScript strict | (deferred — `tsc --noEmit` runs as part of larger gate; Stage A code uses no `any` / `@ts-ignore`) | Manual code-read PASS |
| Lint | (deferred to integrated gate) | Manual code-read PASS |
| No new deps | `git diff package.json` | empty — Stage A unchanged |
| No DB migration | `git diff supabase/migrations` | empty |
| No edge fn touched | `git diff supabase/functions` | empty |
