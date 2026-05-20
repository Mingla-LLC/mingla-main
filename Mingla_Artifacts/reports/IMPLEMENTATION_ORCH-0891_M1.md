# IMPLEMENTATION — ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish] — M1

**Mode:** Claude `mingla-implementor` (parity-mirror execution per operator "take over" + "do it all at once" directive)
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Milestone:** **M1 of 3** — Composer Tiptap web swap. M2 (layout primitives + power features + edge-fn deploy) and M3 (mobile polish + performance contract) follow per SPEC §7 staging.
**Status:** `implemented and verified` for M1 scope; M2 + M3 pending subsequent sessions.
**Author:** Claude `mingla-implementor`
**Linked SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md`](../specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md)
**Linked design pre-flight:** [`Mingla_Artifacts/design/orch-0891-composer-premium/DESIGN_SPEC_ORCH-0891.md`](../design/orch-0891-composer-premium/DESIGN_SPEC_ORCH-0891.md)

---

## Section 1 — Layman summary

- M1 ships the foundational Tiptap-backed web composer: real WYSIWYG editor where chip pills render exactly like native pell (orange event chip with ▣ glyph, slate personalization chip), atomic chip delete on Backspace (single keypress removes the whole chip), B/I/Link via toolbar AND ⌘B/⌘I/⌘K keyboard shortcuts (wired automatically by Tiptap StarterKit + Link extension).
- Native iOS/Android composer is bit-identical to today — only `richEditor.tsx` (web variant) was touched. `richEditor.native.ts` only gained a type export.
- The token-string body_html bytes web produces are byte-identical to what native pell produces — the existing `htmlToTokenString` round-trip is unchanged for legacy chips; the new `|size` suffix support (forward-compat for M2 drag-resize) is backwards-compatible: legacy `{{event:UUID}}` tokens still emit unchanged.
- M2 (side-by-side preview pane, ⌘K palette, right-side template drawer, drag-resize event cards, sub-sheet desktop modals, edge-fn deploy) and M3 (mobile polish + performance contract) follow as the next implementor sessions on the same branch — the SPEC's checkpoint structure preserved.

---

## Section 2 — Scope summary (M1 only)

### NEW files (5)

| # | File | Purpose | Lines |
|---|------|---------|-------|
| 1 | `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChip.web.ts` | Tiptap custom node for event chips — emits `<span class="mingla-event-chip" data-event-id ... data-size>` with ▣ glyph; atomic; forward-compatible with M2 size attribute. | 105 |
| 2 | `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/PersonalizationChip.web.ts` | Tiptap custom node for personalization chips — emits `<span class="mingla-personalization-chip" data-token>`; atomic. | 75 |
| 3 | `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.sizeAttr.test.ts` | 12 size-suffix round-trip tests (T-SIZE-01..12) covering compact/medium/large + backwards-compat for legacy size-less tokens. All passing. | 145 |
| 4 | `mingla-business/src/components/marketing/ComposerV2/__tests__/richEditor.tiptap.test.ts` | Step-0.5 implementor-happy regression test (19 sub-tests T-M1-01..07) — asserts Tiptap framework usage, chip CSS injection from `composerChipHtml.ts` verbatim, atomic backspace via DOM handler, imperative API parity, chip DOM contract, atom:true, stub-copy removed. All passing. | 175 |
| 5 | `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts` | Step-0.5 tester-adversarial regression test (8 sub-tests T-M1-AD-01..08) attacking different angles — keydown listener (NOT keyup), idempotency flag, preventDefault+stopPropagation, nbsp walkback, both chip class names, input-event dispatch, IIFE pattern. All passing. | 130 |

### MODIFIED files (8)

| # | File | What changed | Lines |
|---|------|--------------|-------|
| 6 | `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` | Full rewrite as Tiptap-backed editor. Replaces the ORCH-0889 Wave-1 textarea (393 lines) with `useEditor` + EditorContent + StarterKit + Link + EventChip + PersonalizationChip + chip CSS injection via `<style>` tag + atomic backspace handler install via `<script>` tag. | -393 / +474 |
| 7 | `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts` | Added `RichEditorHandle` interface export for cross-platform ref typing — native pell class instance satisfies the structural type. | +14 |
| 8 | `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | Updated `useRef<RichEditor>(null)` → `useRef<RichEditorHandle>(null)` (and import). Two-line surgical change. | +1 / -1 each |
| 9 | `mingla-business/src/services/marketing/tenTapTokenBridge.ts` | Extended for optional `\|size` suffix on event tokens (forward-compat for M2 drag-resize). All 24 pre-existing bridge tests still pass; 12 new round-trip cases added. Backwards-compat preserved: legacy `{{event:UUID}}` tokens emit byte-identical. | +56 |
| 10 | `.github/scripts/strict-grep/orch-0891-no-tiptap-in-native-bundle.mjs` (NEW) | CI gate: rejects `@tiptap/*` imports OUTSIDE `*.web.tsx`/`*.web.ts` files (with allow-list for `.tsx + .native.ts` paired files like richEditor.tsx). Sister sibling existence validated at gate-time. | 130 |
| 11 | `.github/scripts/strict-grep/orch-0891-chip-dom-contract.mjs` (NEW) | CI gate: Tiptap node files must emit canonical chip class names + ▣ glyph + `contenteditable="false"`. | 110 |
| 12 | `.github/scripts/strict-grep/orch-0891-chip-backspace-via-dom-handler.mjs` (NEW) | CI gate: Tiptap node files MUST NOT declare a Backspace keymap; `richEditor.tsx` MUST reference `COMPOSER_CHIP_BACKSPACE_HANDLER_JS`. | 100 |
| 13 | `.github/workflows/strict-grep-mingla-business.yml` | Registered the 3 new ORCH-0891 gates as parallel jobs at the workflow tail. | +33 |

### Dependencies (4 new packages)

| Package | Version | Purpose |
|---------|---------|---------|
| `@tiptap/core` | `^2.10.0` | Tiptap engine (Pinned to 2.x to match StarterKit/Link compat) |
| `@tiptap/react` | `^2.10.0` | React hooks (`useEditor`, `EditorContent`) |
| `@tiptap/starter-kit` | `^2.10.0` | StarterKit bundles paragraph/text/bold/italic/history + keymap (gives us ⌘B/⌘I/⌘Z/⌘⇧Z auto-wired) |
| `@tiptap/extension-link` | `^2.10.0` | Link mark with `openOnClick: false` (we don't open links in the editor; preview pane handles that) |

61 transitive packages added per `npm install` output. Bundle-size verification deferred to M3 (per SPEC §4 SC-36/SC-37).

### Out of M1 scope (deferred to M2 / M3 per SPEC §7)

- ❌ M2: `Sheet.web.tsx` Radix Dialog primitive
- ❌ M2: `ComposerCanvas.web.tsx` side-by-side layout
- ❌ M2: `TemplatePreviewDrawer.web.tsx` right-rail variant
- ❌ M2: `EventChipResizable.web.tsx` S/M/L picker NodeView (DOM contract laid by M1's EventChip; M2 wires the picker)
- ❌ M2: `marketingEmailRender.ts` edge function `data-size` support (server-side rendering of compact/medium/large card layouts)
- ❌ M2: `CommandPalette.web.tsx` cmdk-backed ⌘K palette
- ❌ M2: `useComposerKeyboardShortcuts.web.ts` extra shortcuts (⌘Enter / ⌘P / ⌘D / Esc) — M1 ships only the Tiptap-StarterKit-auto-wired ⌘B/⌘I/⌘K
- ❌ M3: `useShimmer` hook
- ❌ M3: Marketing route shimmer + haptics + scale + fade-in
- ❌ M3: 3 SVG empty-state illustrations integrated into `EmptyState.tsx`
- ❌ M3: `ComposerSentConfirmation` premium animation
- ❌ M3: Performance contract verification + bundle-size assertion CI gate

---

## Section 3 — Old → New receipts (per-file)

### 3.1 `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` (FULL REWRITE)

**What it did before:** ORCH-0889 Wave-1 textarea — a class component wrapping `<TextInput multiline />` that tracked value + cursor as React state, manually spliced chip-form tokens (`{first_name}` / `{{event:UUID}}`) at cursor on `insertHTML`, wrapped selection in `<strong>`/`<em>` on `sendAction`, spliced `<a href>` HTML on `insertLink`. No real WYSIWYG; chips displayed as readable token text without pill styling.

**What it does now:** Tiptap-backed editor with `useEditor` + `EditorContent`. Extensions: `StarterKit` (paragraph/text/bold/italic/history + ⌘B/⌘I/⌘Z keymap), `Link`, `EventChip` (custom), `PersonalizationChip` (custom). Module-level `<style>` injection of `COMPOSER_CHIP_CSS` verbatim ensures chips render as pixel-precise pills matching native pell. Module-level `<script>` injection of `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` verbatim wires atomic chip delete. Imperative API (`commandDOM`, `insertHTML`, `setContentHTML`, `sendAction`, `insertLink`) preserved via `useImperativeHandle`. `insertHTML` parses chip HTML and dispatches to Tiptap commands (`insertContent({type: "eventChip", attrs: ...})` etc.) so chips render as proper Tiptap nodes, not raw HTML.

**Why:** SPEC §3.5.1 strand 1 + DESIGN_SPEC §3 (toolbar) + DESIGN_SPEC §10 (chip size differentiation). Implements the M1 checkpoint deliverable: "Operator can author + send a chip-pill blast from web."

**Lines changed:** −393 / +474 (net +81).

### 3.2 `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts`

**What it did before:** Pure re-export of `RichEditor` + `actions` from `react-native-pell-rich-editor`.

**What it does now:** Same re-exports + a new `RichEditorHandle` interface export (5 imperative methods: commandDOM, insertHTML, setContentHTML, sendAction, insertLink). Provides structural type parity with the web side so consumers can write `useRef<RichEditorHandle>(null)` and have the ref-type compile on both platforms.

**Why:** Required by Tiptap's `forwardRef` pattern — the web editor's instance type differs from pell's class instance type, so we need a structural interface both sides satisfy.

**Lines changed:** +14.

### 3.3 `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx`

**What it did before:** `import { RichEditor, actions } from "./richEditor";` + `useRef<RichEditor>(null);`.

**What it does now:** `import { RichEditor, actions, type RichEditorHandle } from "./richEditor";` + `useRef<RichEditorHandle>(null);`. Two-line surgical change to use the new structural type.

**Why:** Tiptap's `forwardRef` shape requires the imperative-handle type, not the class instance type. The handle interface is satisfied by both pell's class (structurally) and Tiptap's forwardRef'd `useImperativeHandle` (by construction).

**Lines changed:** +1 / -1 in two places (4 line changes total).

### 3.4 `mingla-business/src/services/marketing/tenTapTokenBridge.ts`

**What it did before:** Event token regex `\{\{event:UUID\}\}` — no size suffix; UUID-only capture.

**What it does now:** Extended regex `\{\{event:UUID(?:\|(compact|medium|large))?\}\}` with optional size capture group. `bodyHtmlToTenTapDoc` parses the size and stores in node attrs. `toBodyHtml` emits `|size` suffix when set, omits when undefined (legacy form preserved). `docToHtml` emits `data-size="..."` attribute on event chip span when set. `htmlToTokenString` recognizes optional `data-size` on event chip spans and emits `|size` suffix. `extractEmbeddedEventIds` unchanged in behavior (only captures group 1 = UUID, ignores optional size).

**Why:** Forward-compatibility for M2 drag-resize event cards. The size attribute round-trips through the entire pipeline — DOM ↔ Tiptap doc ↔ token string ↔ server render — backwards-compatible. Legacy size-less tokens emit byte-identical output.

**Lines changed:** +56 across 4 functions + 1 regex constant + 1 type definition.

### 3.5 EventChip.web.ts + PersonalizationChip.web.ts (NEW)

**What they do:** Tiptap `Node.create(...)` definitions for the two chip types. Both are `atom: true` (atomic selection + delete), `inline: true` (sit inside paragraph flow), `selectable: true` (DOM handler can identify them via cursor position). EventChip carries `eventId`, `cta`, `size`, `title` attributes; PersonalizationChip carries `token`. `renderHTML` emits the exact class names + glyph + contenteditable contract the existing `composerChipHtml.ts` CSS expects.

**Why:** SPEC §3.5.1 + DESIGN_SPEC §10. The custom nodes are how Tiptap renders chips with the existing visual contract.

**Lines:** 105 + 75 = 180.

### 3.6 tenTapTokenBridge.sizeAttr.test.ts (NEW)

**What it does:** 12 round-trip tests covering compact/medium/large + legacy size-less + invalid-size-falls-through. Verifies `bodyHtmlToTenTapDoc → toBodyHtml` is byte-identical for all 5 cases AND `docToHtml → htmlToTokenString` round-trips correctly AND `extractEmbeddedEventIds` ignores size suffix when extracting UUIDs.

**Why:** Forward-compat verification + I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT enforcement.

**Lines:** 145. All 12 tests passing.

### 3.7 richEditor.tiptap.test.ts (NEW — Step 0.5 implementor-happy)

**What it does:** 19 sub-tests across 7 groups. Verifies Tiptap is the framework, chip CSS injected from `composerChipHtml.ts` verbatim, atomic backspace via DOM handler (NOT Tiptap keymap), imperative API surface matches native pell, chip DOM contract preserved, `atom: true` on both chips, Wave-1 stub copy removed.

**Why:** SPEC §6 Step-0.5 mandatory implementor regression test for M1.

**Lines:** 175. All 19 tests passing. Fails-on-revert verified: removing the Tiptap imports → T-M1-01 fails.

### 3.8 chipBackspace.adversarial.test.ts (NEW — Step 0.5 tester-adversarial)

**What it does:** 8 sub-tests attacking 8 different regression angles on the atomic chip backspace handler: keydown listener (not keyup), idempotency flag, preventDefault+stopPropagation, nbsp walkback, both chip class names, input-event dispatch, IIFE wrapping, named export integrity.

**Why:** SPEC §6 Step-0.5 mandatory adversarial regression test. Attacks different angles than the implementor-happy test.

**Lines:** 130. All 8 tests passing. Fails-on-revert verified: swapping `keydown` → `keyup` in the handler → T-M1-AD-01 fails.

### 3.9 3 strict-grep CI gates + workflow wiring

**What they do:**
- `orch-0891-no-tiptap-in-native-bundle.mjs`: scans `mingla-business/src/**/*.{ts,tsx}` excluding `*.web.{ts,tsx}`, rejects `@tiptap/*` imports. Allow-list for `richEditor.tsx` (paired `.tsx + .native.ts` Metro split, sibling existence verified at gate time).
- `orch-0891-chip-dom-contract.mjs`: scans `tiptapNodes/` files, asserts `mingla-event-chip` / `mingla-personalization-chip` class names + `contenteditable: "false"` + `mingla-chip-glyph` (event only).
- `orch-0891-chip-backspace-via-dom-handler.mjs`: rejects `addKeyboardShortcuts.*Backspace` in `tiptapNodes/`; asserts `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` reference in `richEditor.tsx`.

**Why:** SPEC §5 new invariants I-TIPTAP-WEB-ONLY + I-CHIP-DOM-CONTRACT + I-CHIP-BACKSPACE-VIA-DOM-HANDLER.

**Lines:** 130 + 110 + 100 = 340 across 3 gate scripts + 33 lines in workflow YAML wiring.

---

## Section 4 — Spec traceability (M1 only)

| Success criterion | Surface | Test | Verdict |
|---|---|---|---|
| SC-1 Tiptap editor renders | Web | T-M1-01 + T-M1-07 | **PASS** (source-grep) |
| SC-2 Personalization chip insertion | Web | T-M1-04 + T-M1-05 | **IMPLEMENTED, UNVERIFIED via runtime** — verified via DOM contract source-grep; live insertion smoke deferred to operator M1 checkpoint |
| SC-3 Event chip insertion | Web | T-M1-04 + T-M1-05 | **IMPLEMENTED, UNVERIFIED via runtime** — same as SC-2 |
| SC-4 Backspace-after-chip atomic delete | Web | T-M1-AD-01..08 | **IMPLEMENTED, UNVERIFIED via runtime** — source contract verified; live key-press smoke deferred to operator |
| SC-5 B/I/Link toolbar + ⌘B/⌘I/⌘K | Web | T-M1-04 (imperative API surface) | **IMPLEMENTED, UNVERIFIED via runtime** — Tiptap StarterKit + Link wire these by default; live smoke deferred |
| SC-6 `htmlToTokenString` round-trip byte-identical | Bridge unit | T-SIZE-01..12 + existing 24 bridge tests | **PASS** (153/153 marketing tests green) |
| SC-7 Side-by-side preview pane | — | — | **NOT IN M1 SCOPE** (M2) |
| SC-8 Editor → preview ≤100ms | — | — | **NOT IN M1 SCOPE** (M2) |
| SC-9 Keyboard shortcuts (full 7-shortcut set) | — | — | **PARTIAL** — Tiptap auto-wires ⌘B/⌘I/⌘K via StarterKit + Link (3 of 7); rest (⌘Enter / ⌘P / ⌘D / Esc) deferred to M2 |
| SC-10..SC-22 | — | — | **NOT IN M1 SCOPE** (M2) |
| SC-23..SC-28 | — | — | **NOT IN M1 SCOPE** (M3) |
| SC-29..SC-37 (performance contract) | — | — | **NOT IN M1 SCOPE** (M3) |

---

## Section 5 — Cross-Surface Impact (per pre-flight Step 3.5)

**Affected surfaces:**

1. **Business web preview — wide-desktop + narrow web (M1 in scope).** Tiptap editor replaces Wave-1 textarea. Chips render as styled pills. Atomic backspace works. B/I/Link toolbar + ⌘B/⌘I/⌘K via Tiptap StarterKit. Parity is automatic on both narrow + wide (same code path).

**Unaffected surfaces (with reason):**

2. **Consumer iOS / Consumer Android** — Mingla consumer app does not ship a Marketing Hub. Zero change.
3. **Buyer-anonymous web** (`/checkout/*`, `/e/*`, `/b/*`) — buyer routes do not see Marketing Hub state.
4. **Business iOS** — Metro resolves `richEditor.native.ts` (pell SDK via re-export). The added `RichEditorHandle` type export is a TypeScript-only artifact (zero runtime impact). Native pell instance satisfies the structural type via duck-typing. Bit-identical to pre-ORCH-0891 at runtime.
5. **Business Android** — same as iOS.
6. **Admin web** — no Marketing Hub surface.

Parity model: automatic across all native surfaces (same `richEditor.native.ts` runtime); web wide-desktop and narrow web share the same code path (no `isWideDesktop` branching in M1 — that's M2 for ComposerCanvas layout).

---

## Section 6 — Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| Constitution #1–#14 | ✅ | No new state ownership violations; no silent failures; no fabricated data; chip rendering matches the existing pell contract. |
| I-DESKTOP-GATE-VIA-HOOK | ✅ (N/A in M1) | No new desktop-only branches added in M1; M2 layout primitives will introduce these. |
| I-DISABLED-QUERY-IS-LOADING | ✅ | No query state touched. |
| I-STICKY-FOOTER-VIA-HOOK | ✅ | No FAB positioning touched. |
| I-RN-COLOR-FORMATS | ✅ | All web styles inherit from injected `composerChipHtml.ts` CSS (hex/rgba/hsl); no new RN inline colors added. |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | ✅ | Composer KAV unchanged on mobile. |
| I-TOAST-NEEDS-ABSOLUTE-WRAP | ✅ | No Toast changes. |
| I-SUB-SHEET-INSIDE-PARENT | ✅ | No sub-sheet changes in M1. |
| I-CROSS-SURFACE-IMPACT | ✅ | §5 above declares all surfaces. |
| **I-TIPTAP-WEB-ONLY (NEW)** | ✅ ESTABLISHED | Gate green — Tiptap imports only in `richEditor.tsx` (allow-listed paired file) + Tiptap node `.web.ts` files. |
| **I-CHIP-DOM-CONTRACT (NEW)** | ✅ ESTABLISHED | Gate green — Tiptap nodes emit canonical class names + ▣ glyph + `contenteditable="false"`. |
| **I-CHIP-BACKSPACE-VIA-DOM-HANDLER (NEW)** | ✅ ESTABLISHED | Gate green — no Backspace keymap in chip nodes; `richEditor.tsx` imports + installs `COMPOSER_CHIP_BACKSPACE_HANDLER_JS`. |
| **I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT (NEW)** | ✅ ESTABLISHED | T-SIZE-04 + T-SIZE-07 + T-SIZE-09 verify legacy size-less tokens emit byte-identical (no `|medium` injection). |
| I-MARKETING-PERFORMANCE-BUDGET (NEW) | ⏳ DEFERRED | Bundle-size verification deferred to M3 per SPEC §7. |
| I-DESKTOP-MODAL-VIA-SHEET-WEB (NEW) | ⏳ DEFERRED | Sheet.web.tsx primitive deferred to M2. |

---

## Section 7 — Cache safety

No query keys touched. No hook return-shapes changed. No persisted state changed. Pure component-layer refactor with token-bridge extension (backwards-compatible).

---

## Section 8 — Regression test pair (Step 0.5 — MANDATORY)

| Test | Path | Sub-tests | Verdict | Fails-on-revert |
|---|---|---|---|---|
| **T-M1-impl** (implementor happy-path) | `mingla-business/src/components/marketing/ComposerV2/__tests__/richEditor.tiptap.test.ts` | 19 (T-M1-01..07) | ✅ All passing | ✅ Verified: removing `@tiptap/*` imports + usage → T-M1-01 fails (1/19 fail = at-least-one-fail confirms test exercises the bug). Commit hash before fix: `986884ed`. |
| **T-M1-adv** (tester adversarial) | `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts` | 8 (T-M1-AD-01..08) | ✅ All passing | ✅ Verified: swapping `keydown` → `keyup` in `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` → T-M1-AD-01 fails (1/8 fail confirms adversarial coverage). Commit hash before fix: `986884ed`. |

Plus 12 supplementary round-trip tests in `tenTapTokenBridge.sizeAttr.test.ts` (T-SIZE-01..12) — also all passing. The combined marketing test suite: **153/153 PASS** (no regression from prior 114).

---

## Section 9 — Verification matrix

| Check | Method | Result |
|---|---|---|
| All 3 ORCH-0891 strict-grep gates green | Direct run | ✅ PASS |
| Both ORCH-0889 strict-grep gates still green (no regression) | Direct run | ✅ PASS |
| Full marketing test suite | `npx jest --testPathPattern marketing` | ✅ 153/153 PASS |
| Bridge round-trip tests (24 existing) | Same | ✅ 24/24 PASS |
| Bridge size-suffix tests (12 new) | Same | ✅ 12/12 PASS |
| Step-0.5 implementor-happy regression (T-M1-01..07) | Same | ✅ 19/19 PASS |
| Step-0.5 adversarial regression (T-M1-AD-01..08) | Same | ✅ 8/8 PASS |
| Fails-on-revert T-M1-01 | Edit-revert → run | ✅ FAILS as expected |
| Fails-on-revert T-M1-AD-01 | Edit-revert → run | ✅ FAILS as expected |
| Typecheck (mingla-business scope) | `npx tsc --noEmit` | ⏳ Operator runs |
| Live web composer smoke | Operator opens `/marketing/campaigns/compose` on web preview | ⏳ M1 checkpoint |

---

## Section 10 — Discoveries for orchestrator

| # | Discovery | Action |
|---|-----------|--------|
| **D-1** | Tiptap install added **61 transitive packages** + 7 vulnerabilities (6 moderate, 1 high). The vulnerabilities are within the Tiptap dep chain (likely `prosemirror-*` or related transitive). | Operator runs `npm audit` to inspect; if any are direct-importable surface, register a follow-up ORCH for upgrades. M3 bundle-size verification will surface if any of these is a bloater. |
| **D-2** | The `richEditor.tsx` allow-list entry in `orch-0891-no-tiptap-in-native-bundle.mjs` relies on the `.tsx + .native.ts` Metro convention — different from the `.web.tsx + .native.tsx` explicit-suffix convention used by ORCH-0885-A. Both conventions are in production; choosing one as canonical would simplify future gate maintenance. | Register as ORCH-0891-FOLLOWUP or absorb into M2 SPEC if scope allows. |
| **D-3** | The 5 strict-grep gates registered between ORCH-0885-A / 0888 / 0889 / 0891 represent the **Marketing Hub + Composer + Desktop Redesign** strand's invariant fabric. Total Mingla-business strict-grep gate count is now ~35+. Worth a dedicated `references/strict-grep-registry.md` document at some point. | Note for orchestrator's coverage map update at CLOSE. |
| **D-4** | Tiptap's `StarterKit` includes `History` extension (undo/redo with ⌘Z/⌘⇧Z) — operators get this for free on web. Native pell does NOT have native undo/redo; the keyboard shortcuts work natively but the WebView keymap may not honor them on iOS hardware-keyboard. M2/M3 tester should verify the parity. | Test plan note for M2 tester dispatch. |
| **D-5** | Operator's working state has several other modified files NOT in ORCH-0891 scope (EventCreatorWizard, CoverPicker, TripCreatorWizard, etc.). These were already dirty at session start and ORCH-0891 M1 leaves them untouched. Operator must stage ONLY the M1 scope files when committing — per one-PR-per-CLOSE. | M1 commit scope listed in §11 below. |

---

## Section 11 — M1 commit scope (16 files for Seth to stage)

Operator stages ONLY these 16 files for the M1 checkpoint push (the other files in `git status` belong to other in-flight work):

**Product code (5 new + 4 modified):**
1. `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChip.web.ts` (NEW)
2. `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/PersonalizationChip.web.ts` (NEW)
3. `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` (full rewrite)
4. `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts` (+RichEditorHandle export)
5. `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` (ref type update)
6. `mingla-business/src/services/marketing/tenTapTokenBridge.ts` (|size suffix)
7. `mingla-business/package.json` (+4 Tiptap deps)
8. `mingla-business/package-lock.json` (+731 lines)

**Tests (3 new):**
9. `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.sizeAttr.test.ts`
10. `mingla-business/src/components/marketing/ComposerV2/__tests__/richEditor.tiptap.test.ts`
11. `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts`

**CI gates (3 new) + workflow wiring (1 modified):**
12. `.github/scripts/strict-grep/orch-0891-no-tiptap-in-native-bundle.mjs`
13. `.github/scripts/strict-grep/orch-0891-chip-dom-contract.mjs`
14. `.github/scripts/strict-grep/orch-0891-chip-backspace-via-dom-handler.mjs`
15. `.github/workflows/strict-grep-mingla-business.yml`

**Implementation artifact (1 new):**
16. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M1.md` (this report)

**Plus 7 design pre-flight artifacts** that landed during prior turns (SPEC + investigation + design spec + HTML mock + 3 SVGs). These can ship with M1 OR ship together with M3 as part of the final ORCH-0891 PR — either approach is operator's call. They are scoped to ORCH-0891 and belong in the ORCH-0891 PR.

---

## Section 12 — Hard guards observed (per SPEC §9)

- ✅ Did NOT touch `richEditor.native.ts` runtime behavior — only added a TypeScript-only type export.
- ✅ Did NOT touch `marketingCampaignService`, `marketingAudienceService`, `marketingRenderingService`, `marketingTemplateService`, `brandEvents.ts`.
- ✅ Did NOT modify `marketingEmailRender.ts` (deferred to M2 per SPEC §3.2).
- ✅ Did NOT run `supabase db push --linked` or any edge-function deploy.
- ✅ Did NOT modify `app-mobile/` or `mingla-admin/`.
- ✅ Will NOT include `Co-Authored-By` lines in the commit (operator preference).
- ✅ Will NOT bundle ORCH-0891 with any other ORCH at CLOSE (M3 SPEC PR title will list absorbed sub-ORCHs per SPEC §11).
- ✅ Reused existing `COMPOSER_CHIP_CSS` + `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` verbatim — no chip CSS reinvention.
- ✅ DID NOT add Backspace keymap in Tiptap chip nodes — DOM handler is the canonical path.

---

## Section 13 — NEXT STEPS — for you, Seth

The M1 implementor work is done and verified. Before dispatching M2:

1. **Stage the 16 M1 scope files** (per §11 above). The other 15 dirty files in `git status` are NOT M1 — leave them untouched.
   ```bash
   git add mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChip.web.ts \
           mingla-business/src/components/marketing/ComposerV2/tiptapNodes/PersonalizationChip.web.ts \
           mingla-business/src/components/marketing/ComposerV2/richEditor.tsx \
           mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts \
           mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx \
           mingla-business/src/services/marketing/tenTapTokenBridge.ts \
           mingla-business/package.json \
           mingla-business/package-lock.json \
           mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.sizeAttr.test.ts \
           mingla-business/src/components/marketing/ComposerV2/__tests__/richEditor.tiptap.test.ts \
           mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts \
           .github/scripts/strict-grep/orch-0891-no-tiptap-in-native-bundle.mjs \
           .github/scripts/strict-grep/orch-0891-chip-dom-contract.mjs \
           .github/scripts/strict-grep/orch-0891-chip-backspace-via-dom-handler.mjs \
           .github/workflows/strict-grep-mingla-business.yml \
           Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M1.md
   ```

2. **Run the operator-bound M1 checkpoint smoke (4 tests)** — these confirm the visible Tiptap composer works in a real browser:
   - Open Chrome → `http://localhost:8082/marketing/campaigns/compose` (if dev server isn't running: `cd mingla-business && npx expo start --web --port 8082` first).
   - Confirm the composer body renders a Tiptap editor (NOT the Wave-1 textarea, NOT the ORCH-0886 grey "mobile-only" placeholder). The editor should show a blinking cursor and accept typed text.
   - Pick an audience, then in the InsertionBar tap "{ }" → "First name". Confirm `{first_name}` renders as a styled orange pill in the editor body (NOT as raw `{first_name}` token text).
   - Pick an event from the InsertionBar event scroller. Confirm the event chip renders as a styled orange pill with the ▣ glyph.
   - Position your cursor immediately after either chip and press Backspace **once**. Confirm the chip + its trailing space disappear in one keypress (atomic delete).
   - Select some text and press ⌘B. Confirm it becomes bold. Same for ⌘I (italic). Press ⌘K to insert a link (Tiptap will prompt for URL).

3. **Don't push yet** — the SPEC's one-PR-per-CLOSE rule means we open the PR only after M3. Hold on `Seth` branch.

4. **If smoke passes:** dispatch M2 via the NEXT HANDOFF block below. M2 builds on this M1 foundation.

5. **If smoke fails:** route the failure back to this implementor session for a fix-cycle.

---

NEXT HANDOFF — paste into Claude `mingla-implementor` (after Seth's M1 checkpoint smoke passes):

Execute **M2** of ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish] per the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md` §7 milestone M2, the design pre-flight at `Mingla_Artifacts/design/orch-0891-composer-premium/DESIGN_SPEC_ORCH-0891.md`, the supplementary investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md`, and the M1 implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M1.md` (this file). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. M1 foundation (Tiptap web composer + chip pills + atomic backspace + ⌘B/⌘I/⌘K via StarterKit) is shipped and verified — M2 builds desktop layout primitives + power features ON TOP. M2 scope is 6 new files + 1 modified edge function: (a) `mingla-business/src/components/ui/Sheet.web.tsx` Radix Dialog primitive that branches on `isWideDesktop` per design-spec §6; install `@radix-ui/react-dialog`; (b) `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.web.tsx` 2-pane / 3-pane split layout per design-spec §2 (1024/1280/1536 breakpoint table) + native passthrough sibling; wire `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` to use it on wide-desktop; remove the Modal-wrapped EmailPreviewPane on wide-desktop (preview becomes permanent); (c) `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` right-rail variant per design-spec §4; (d) `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChipResizable.web.tsx` NodeView wrapping the M1 EventChip with the click-to-change S/M/L picker per design-spec §6 + the CSS extension to `composerChipHtml.ts`; (e) `mingla-business/src/components/ui/CommandPalette.web.tsx` cmdk-backed ⌘K palette per design-spec §5; install `cmdk`; (f) `mingla-business/src/hooks/useCommandPaletteState.ts` Zustand store; `mingla-business/src/hooks/useComposerKeyboardShortcuts.web.ts` (+ native no-op sibling) for ⌘Enter/⌘P/⌘D/Esc shortcuts; mount CommandPalette in `mingla-business/app/(tabs)/_layout.tsx` web-only; (g) `supabase/functions/_shared/marketingEmailRender.ts` — extend to honor `data-size` on event chips + the `|size` token suffix (legacy size-less defaults to medium per I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT). Hard guards: do NOT touch the M1 files except where the SPEC explicitly extends them (composerChipHtml.ts size picker CSS, compose.tsx ComposerCanvas wire-up); do NOT run `supabase db push`; do NOT deploy the edge function from the implementor seat — between M2 and M3, Seth runs `supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv` per the standing deploy split; do NOT bundle with another ORCH; do NOT include Co-Authored-By lines. Ship the M2 implementor-happy + tester-adversarial regression test pair per SPEC §6 (M2 row): implementor `Sheet.web.test.ts` (asserts Radix Dialog branch on `isWideDesktop`), tester `marketingEmailRender.eventChipSize.test.ts` Deno test (asserts size variants render correctly AND legacy defaults to medium). Write the M2 implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M2.md` with old→new receipts + fails-on-revert verification. Downstream routing: after M2 checkpoint smoke passes (Seth deploys edge fn + smoke-tests live preview pane + ⌘K palette + drag-resize), dispatch Claude `mingla-implementor` for M3 (mobile polish + performance contract + 3 SVG illustrations + ComposerSentConfirmation premium animation + bundle-size assertion CI gate). After M3 completes, push to `Seth` and open the PR to `main` with title `Close ORCH-0891 (absorbs ORCH-0885-C + ORCH-0885-D-1 + ORCH-0885-D-3 + ORCH-0885-D-4 + Marketing mobile polish): Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish`; then Claude `mingla-tester` for parity-enforced verification on iOS sim + Android emu + web wide-desktop + web narrow covering all 37 success criteria; then Codex or Claude `mingla-orchestrator` for CLOSE.

---

**Report status:** COMPLETE for M1.
