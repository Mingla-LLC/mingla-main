# INVESTIGATE — ORCH-1137 · Ari empty-state "+" chip glyph missing

**Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-14
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1137-[ari-emptystate-plus-glyph]/` on branch `ORCH-1137-ari-emptystate-plus-glyph` (rebased onto origin/main `f68495ca6`)
**Confidence:** PROVEN (root cause is a Code-layer build-config fact + runtime probe; web-only mechanism, native ruled out by resolution path + native chrome-icon render)

---

## Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No Active entry targets `mingla-forensics`, `ORCH-1137`, or carries an unaddressed `ALL`+`BLOCK`. COMMS-0030 (team-wide iOS build break) is RESOLVED per commit `3ee37eb75`. No ack required.

---

## Symptom summary (expected vs actual)

- **Surface (from Seth's screenshot):** mingla-business **web** preview (very wide desktop aspect ratio), Ari assistant page, first-run empty state.
- **Expected:** the hint row reads `Tap [⊕] for things to try`, where `[⊕]` is a 22×22 bordered circle chip containing a small lucide `Plus` glyph quoting the composer "+" button.
- **Actual:** the bordered circle chip renders **EMPTY** — the lucide `Plus` glyph inside is invisible. The surrounding `Text` ("Tap " and " for things to try") renders fine at the same low-contrast tertiary color.

---

## Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/components/ari/EmptyState.tsx` | The component with the symptom — the `hintChip` + `<Plus>` |
| 2 | `mingla-business/src/components/ari/InputBar.tsx` | The real composer "+" button this chip "quotes" — does ITS plus render? |
| 3 | `mingla-business/src/constants/designSystem.ts` | Resolve `textTokens.tertiary`, `glass.border.profileBase`, `radius.full` |
| 4 | `mingla-business/src/components/ari/__tests__/orch_1057_ari_composer_icons_emptystate.test.ts` | Must stay green |
| 5 | `mingla-business/src/components/ari/__tests__/orch_1101_ari_chat_composer_overhaul.test.ts` | Must stay green |
| 6 | `mingla-business/metro.config.js` | Web platform module resolution |
| 7 | `mingla-business/src/shims/lucideReactNativeWebStub.js` | **The web stub** |
| 8 | `node_modules/lucide-react-native/dist/...` | How lucide renders (real vs stub) |
| 9 | `node_modules/react-native-svg/...` | Web SVG support |

---

## Q-scorecard

**Q1 — Is the glyph color (`textTokens.tertiary`) transparent/undefined on web, making it too faint?**
EmptyState imports `text as textTokens` from `designSystem.ts`. The exported `text` const (line 288) resolves `tertiary = "rgba(255, 255, 255, 0.52)"` — a valid, visible whitish color, identical to the sibling hint `Text` (which IS visible). The `tertiary: "#6b7280"` at line 144 belongs to a DIFFERENT object that is not the one imported here. **Verdict: REFUTED** — the color is valid and visible; not a contrast/transparency bug.

**Q2 — Does the real composer "+" button (InputBar) use a lucide Plus, and does it render?**
No. The InputBar suggestions "+" button is drawn with **two `View` bars** (`styles.plusH` + `styles.plusV`, `backgroundColor: textTokens.secondary`) — NOT a lucide glyph (`InputBar.tsx:157-158`, styles `253-266`). So the EmptyState chip is the **only** place in the Ari surface that renders a lucide `Plus`. **Verdict: ANSWERED** — the chip's lucide Plus has no sibling lucide-Plus to compare against; the bug is specific to lucide rendering, and the chip is the sole carrier.

**Q3 — On web, does `<Plus>` from `lucide-react-native` actually render anything?**
No. `metro.config.js` rewrites `lucide-react-native` to `src/shims/lucideReactNativeWebStub.js` **only when `platform === "web"`**. In that stub, `Plus` (and every icon) is `IconStub = () => null`. **Verdict: CONFIRMED ROOT CAUSE** — on web the Plus glyph renders nothing; the bordered circle `View` still renders, so the chip is an empty circle.

**Q4 — Is this web-only, native-only, or both?**
Web-only. The Metro override is gated `if (platform === "web")`; native (ios/android) falls through to the real `lucide-react-native`, which renders via `react-native-svg` (the real Plus icon carries SVG path `M5 12h14...`). Native chrome lucide icons render on the booted iOS sim. **Verdict: web-only** (business-web AFFECTED; business-iOS / business-Android NOT affected).

**Q5 — Why does the surrounding Text render but the glyph doesn't?**
The hint `Text` is plain React Native `Text` (no lucide), so it renders identically on web and native. Only the lucide-sourced glyph hits the web stub. **Verdict: ANSWERED.**

---

## Findings

### F-1 — CONFIRMED ROOT CAUSE: `lucide-react-native` is stubbed to `() => null` on web

1. **Symptom:** The 22×22 bordered circle chip in the Ari empty-state hint renders empty on the business web preview; the `Plus` glyph inside is invisible.
2. **Layer:** Code (build/bundler config) → Runtime.
3. **Probe:**
   - Read `metro.config.js` `resolver.resolveRequest`.
   - Read `src/shims/lucideReactNativeWebStub.js`.
   - `node -e` rendering the stub's `Plus`.
   - Evidence file: `Mingla_Artifacts/evidence/ORCH-1137/web_stub_runtime_probe.txt`.
4. **Evidence (verbatim):**
   - `mingla-business/metro.config.js:192-197`:
     ```js
     if (moduleName === "lucide-react-native") {
       return { filePath: LUCIDE_REACT_NATIVE_WEB_STUB, type: "sourceFile" };
     }
     ```
     guarded by `if (platform === "web") {` at line 153.
   - `mingla-business/src/shims/lucideReactNativeWebStub.js:3,14`:
     ```js
     const IconStub = () => null;
     // ...
     Plus: IconStub,
     ```
   - Runtime probe output:
     ```
     stub.Plus typeof: function
     stub.Plus({size:13}) returns: null
     ```
   - `EmptyState.tsx:13` imports `{ Plus } from "lucide-react-native"`; `:45` renders `<Plus size={13} color={textTokens.tertiary} strokeWidth={2.25} />`.
5. **Mechanism:** On the web platform, Metro resolves `lucide-react-native` to the stub where `Plus` is `() => null`. `EmptyState` renders `<View style={styles.hintChip}>` (the bordered circle, a real RN `View`) wrapping `<Plus.../>`, which on web returns nothing → the circle renders but is empty. The sibling hint `Text` is plain RN text (not lucide) so it renders → "Tap" and "for things to try" are visible at the same tertiary color, matching the screenshot exactly.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — RULED OUT: contrast / transparent-token / clip / overflow

1. **Symptom (hypothesis):** glyph too faint, or `radius.full`/overflow clipping the 13px glyph inside the 22px circle, or `textTokens.tertiary` undefined on web.
2. **Layer:** Code.
3. **Probe:** Read `designSystem.ts:288-294` (`text` export) and the `hintChip` style (`EmptyState.tsx:85-94`).
4. **Evidence:** `text.tertiary = "rgba(255, 255, 255, 0.52)"` (visible, identical to the rendered hint Text). The chip is 22×22, the glyph 13px (fits with 4.5px margin each side), `hintChip` has no `overflow:"hidden"`, and `radius.full` (999) only rounds the border, it does not clip a centered 13px child. The hint Text using the SAME color IS visible, so faintness is disproved by the screenshot itself.
5. **Mechanism:** None — these are not the cause; the glyph never enters the render tree on web (F-1), so geometry/contrast are moot.
6. **Severity:** RULED OUT.

### F-3 — SECONDARY (web-platform latent crash risk, blast-radius): six app-used lucide icons are MISSING from the stub

1. **Symptom:** Not the reported symptom, but a related web defect in the same stub.
2. **Layer:** Code → Runtime.
3. **Probe:** `grep` union of lucide imports across `mingla-business/src`; compared to the stub's exports; `node -e` reading missing keys.
4. **Evidence:**
   - App imports: `AlertTriangle, ArrowUp, Check, CheckSquare, Menu, Pencil, Play, Plus, Settings, Square, X`.
   - Stub exports: `ArrowUp, AtSign, Facebook, Globe2, Instagram, Linkedin, Menu, Music2, Plus, Settings, X, Youtube`.
   - Probe: `AlertTriangle/Check/CheckSquare/Pencil/Play/Square => undefined`.
   - Usage sites: `ClarifyingCard.tsx:68` (`Check`), `MultiSelectPrompt.tsx:70,113,115` (`Check/CheckSquare/Square`), `ToolProposalCard.tsx:239,257,291` (`Play/Pencil/AlertTriangle`).
5. **Mechanism:** On web, importing a name not present in the stub yields `undefined`; rendering `<undefined .../>` throws React's "type is invalid" error. These icons live in Ari **conversation** components (tool proposals, multi-select, clarifying cards), which do NOT mount on first-run empty state — so they don't affect the ORCH-1137 symptom, but they are a latent web crash the moment an Ari conversation renders those cards on web. **Out of ORCH-1137 scope; flagged as a Discovery.**
6. **Severity:** SECONDARY ROOT CAUSE (of a different, latent web defect) — registered for Orchestrator, NOT in the ORCH-1137 fix scope.

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | EmptyState header comments (ORCH-1057, ORCH-1101 Bug #5) say the hint renders a lucide `Plus` chip quoting the composer "+". | Docs assume lucide renders on all surfaces — silent on web stub. |
| **Schema** | N/A (pure UI). | — |
| **Code** | `EmptyState.tsx` renders real lucide `<Plus>`; `metro.config.js` swaps lucide for a null-stub on web; the "quoted" InputBar "+" is actually two Views, not lucide. | **Yes** — code's web-bundler reality contradicts the doc/component intent. This gap IS the bug. |
| **Runtime** | Stub `Plus({size:13}) → null`; native real `Plus` carries SVG path `M5 12h14...`; native iOS sim renders lucide chrome icons. | Confirms web=blank, native=renders. |
| **Data** | N/A. | — |

Truth holder: **Code (bundler config)**. The contradiction between the component's intent (render a lucide Plus everywhere) and the web stub (lucide → null) is exactly the defect.

---

## Repro evidence (live-fire)

- **Web (target surface):** Source + bundler config + runtime probe prove the mechanism deterministically. The web bundle (Metro web / Vercel web export) resolves `lucide-react-native` → stub; `Plus` is `() => null`. Probe output saved to `Mingla_Artifacts/evidence/ORCH-1137/web_stub_runtime_probe.txt`. This is a build-config certainty, not a flaky runtime — every web render of any lucide icon is blank. Confidence: PROVEN at Code+Runtime. (A live browser screenshot was not captured because the symptom is fully determined by the platform-gated stub; the mechanism cannot vary at runtime. Capping note: per Prime Directive 7 this is a build-config fact, so source+probe is sufficient for PROVEN here — the "live-fire" requirement is satisfied by the runtime probe that executes the exact stub the web bundle loads.)
- **Native iOS (ruled-out surface):** Booted iPhone 17 Pro (`17091E60-...`); launched `com.sethogieva.minglabusiness`; screenshot `Mingla_Artifacts/evidence/ORCH-1137/native_ios_launch.png` shows lucide chrome glyphs (search/bell/+ in the top bar) rendering. Native resolution path bypasses the stub (the override is `platform === "web"` only) and uses the real lucide Plus (SVG path `M5 12h14...`). Native cannot exhibit the empty-circle symptom by construction.

---

## Blast radius / cross-surface map

| Surface | Affected? | Reason |
|---------|-----------|--------|
| Consumer iOS (`app-mobile`) | N/A | Different app; not in scope. (Note: app-mobile has its own lucide handling — out of scope.) |
| Consumer Android (`app-mobile`) | N/A | Different app. |
| Buyer/anon Web (mingla-business public routes) | N/A for THIS symptom | Ari is an authenticated business surface, not a public buyer route. (Any lucide icon on a public web route would also be blank — see F-3 latent risk.) |
| **Business iOS** | **NOT affected** | Real lucide renders via react-native-svg. |
| **Business Android** | **NOT affected** | Real lucide renders via react-native-svg. |
| Admin Web (`mingla-admin`) | N/A | Separate app (lucide-react, not lucide-react-native). |
| **Business Web preview** | **AFFECTED** | lucide → null stub. The Ari empty-state Plus is one of MANY blank lucide glyphs (also the InputBar ArrowUp send glyph, the AriChatScreen header Menu/Settings — all in the stub → all blank on web). |

**Other lucide glyphs blanked on business web (same root cause, broader symptom):** `ArrowUp` (Ari send button), `Menu` + `Settings` (Ari header), `X`, and any other in-stub icon used on a web-reachable screen. ORCH-1137's scope is the empty-state chip; the orchestrator should decide whether the fix targets just the chip or the whole web-stub strategy.

---

## Invariant impact

- No existing invariant in `INVARIANT_REGISTRY.md` mandates lucide-on-web rendering. The web stub was introduced by ORCH-1085 (`f65f43ca8`) to keep the web bundle building (the real ESM `lucide-react-native` breaks Metro web parse — confirmed: `require('lucide-react-native')` under node throws `Unexpected token 'typeof'`). Any fix MUST preserve the web build (do not regress the ORCH-1085 build-fix) and MUST keep the two existing tests green (they assert source structure: `import { Plus } from "lucide-react-native"`, `<Plus size={13}`, the split copy, no Pressable). A fix that swaps the chip's glyph implementation must NOT delete those asserted strings, or must land a TEST-MOD-APPROVED amendment.

---

## Discoveries for Orchestrator

1. **(F-3) Latent web crash:** six lucide icons used in Ari conversation components (`AlertTriangle, Check, CheckSquare, Pencil, Play, Square`) are absent from the web stub → `undefined` → React "type is invalid" crash if those cards render on business web. Not the ORCH-1137 symptom (they don't mount on first-run), but a real web defect. Recommend a separate ORCH or fold into a broader "lucide-on-web" decision.
2. **Broad web-stub blank-out:** the stub blanks EVERY lucide glyph on business web (send button arrow, header Menu/Settings, etc.). If business web is a supported surface (it is exported to Vercel), this is a systemic web-icon gap, not a one-chip cosmetic issue. Orchestrator should decide scope: fix the one chip vs. fix the lucide-on-web rendering strategy.
3. **The "quoted" composer "+" is not a lucide glyph:** the InputBar suggestions button is two crossing Views, not a lucide Plus. Any SPEC that wants the chip to truly mirror the real button could use the same two-View technique — which would ALSO render on web (Views are not stubbed) and sidestep the lucide-web gap entirely. (Direction only — NOT a fix.)

---

## Confidence

**PROVEN.** Root cause is a deterministic, platform-gated build-config fact (web → null stub) corroborated by a runtime probe executing the exact stub the web bundle loads, and the native non-affection is proven by the resolution path + a native sim render of lucide chrome icons. No layer is unverified.

---

## Recommended next phase + scope (direction only — NO fix proposed)

- **Next:** SPEC (mingla-forensics SPEC mode, or orchestrator dispatch).
- **Scope direction:** decide whether ORCH-1137 fixes ONLY the empty-state chip glyph on web, or addresses the broader lucide-on-web stub gap (F-3 + Discovery 2). The fix must (a) keep the business web bundle building (don't regress ORCH-1085), (b) keep `orch_1057_...` and `orch_1101_...` tests green or land TEST-MOD-APPROVED amendments, (c) render a visible "+" inside the chip on business web while staying identical on iOS/Android. The SPEC owns choosing the mechanism; this investigation only proves the cause.
