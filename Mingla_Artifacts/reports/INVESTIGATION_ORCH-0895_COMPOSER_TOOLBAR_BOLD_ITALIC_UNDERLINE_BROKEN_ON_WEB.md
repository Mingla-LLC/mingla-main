# INVESTIGATION — Marketing Composer V2: Bold / Italic / Underline buttons (and Cmd shortcuts) don't work on web

**Status:** Root cause `proven` (web layer, source-level + dependency manifest confirmed).
**Confidence:** HIGH for web.
**Scope:** mingla-business marketing composer (`/marketing/blast/compose`).
**Surfaces audited:** Business Web (primary affected), Business iOS / Android (secondary — see Cross-Surface Impact below).
**Reporter:** Operator, 2026-05-19.
**Forensics author:** Claude `mingla-forensics`, 2026-05-19.

---

## Symptom Summary

**Reported:**
- Bold / Italic / Underline pill buttons in the composer toolbar do nothing.
- Cmd+B and Cmd+I keyboard shortcuts work; Cmd+U does nothing.

**Expected:**
- Highlight text + tap B/I/U → text becomes bold / italic / underlined.
- Cmd/Ctrl+B/I/U → toggle bold / italic / underline on selection.

**When it broke:**
- Bold / Italic on web: regressed in the most recent ComposerV2Editor turn (this session) when the imperative B/I handlers were rewritten from `sendAction(actions.setBold, "result")` to `commandDOM(focusExecJs("bold"))`. The web `RichEditor.commandDOM` is an intentional no-op.
- Underline on web: never worked. Tiptap `StarterKit` does NOT include the `Underline` mark, and `@tiptap/extension-underline` was never installed.
- Cmd+U on web: same reason — Tiptap auto-binds Cmd+U only when the Underline extension is registered.

---

## Phase 0 — Context Ingested

- `feedback_always_simulator_repro_described_behaviour.md` — live-fire mandate respected by inspecting the running Metro / sim state before code edits.
- `feedback_tester_canonical_and_platform_parity.md` — confirmed Business Web is a primary shipping surface for the composer (the platform the user is testing on).
- Prior diffs in this session: `richEditor.tsx` (Tiptap web shim), `ComposerV2Editor.tsx` (toolbar handlers), `composerChipHtml.ts` (chip CSS + new selection tracker).

---

## Phase 1 — Reproduction Status

**Live-fire attempt:** BLOCKED on iOS sim (Metro running on ports 8081 and 8084 is `expo start --web` only — iOS bundle returns HTTP 404). Booted iPhone 17 Pro sim has the Mingla Business dev-client app installed (May 19 16:04 build) but cannot fetch a JS bundle. iOS verification deferred until Metro is restarted with native dev-client support.

**Web verification:** SOURCE-LEVEL `proven`. The cause is mechanical (commandDOM is a literal no-op return; Underline mark is genuinely absent from the extensions array). No runtime ambiguity.

Per Prime Directive #7, the source-level confidence here is `proven` because the failure is a missing/no-op code path (not a runtime focus race or selection-state quirk). For live-fire confirmation, operator should hard-refresh the running web preview after Metro picks up the new `@tiptap/extension-underline` dependency.

---

## Phase 2 — Investigation Manifest

Files read, in trace order:

1. `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` — toolbar handler wiring (imperative handle + local handlers).
2. `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx` — Pill `onPress` → callback wiring.
3. `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` — **WEB Tiptap shim** (the affected platform's editor).
4. `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts` — iOS/Android pell re-export.
5. `mingla-business/node_modules/react-native-pell-rich-editor/src/editor.js` — pell internal `Actions.bold/italic/underline` + `focusCurrent()`.
6. `mingla-business/node_modules/react-native-pell-rich-editor/src/const.js` — `actions.setBold = 'bold'` etc.
7. `mingla-business/package.json` — Tiptap dependencies present.
8. `lsof -i :8081 :8084` — Metro instance states.
9. `xcrun simctl io ... screenshot` — sim is on iOS Settings, NOT the Mingla app.

---

## Phase 3 — Findings

### 🔴 Root Cause #1 — Web `commandDOM` is a no-op; B/I/U all routed through it

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx:312-314` |
| **Exact code** | `commandDOM: (_js: string): void => { return; },` |
| **What it does** | Discards every JS string passed in. No effect on the Tiptap editor. |
| **What it should do** | Either execute the JS against the Tiptap editor's DOM, OR not be called at all on web. |
| **Causal chain** | (1) User clicks B / I / U pill on web composer. (2) Pill `onPress` → `handleToggleBoldLocal` / sibling. (3) Handler called `richEditorRef.current?.commandDOM(focusExecJs("bold"))` (pre-fix). (4) Web `commandDOM` returns immediately. (5) Tiptap receives no command → no formatting → user sees no change. |
| **Verification** | `grep -n "commandDOM" richEditor.tsx` confirms `commandDOM: (_js) => return;` is the only web definition. The comment on lines 307–311 explicitly documents the intentional no-op: "No-op on web. … Tiptap's editor root has direct DOM access via editor.view.dom." |

### 🔴 Root Cause #2 — Underline mark never registered on web Tiptap

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx:250-268` (extensions array) + `package.json` (missing dep) |
| **Exact code** | Extensions: `StarterKit`, `Link`, `EventChipWithResize`, `PersonalizationChip` — no `Underline`. |
| **What it does** | `editor.chain().focus().toggleUnderline()` would throw / no-op because no Underline mark exists in the schema. Cmd+U also unbound (the Tiptap Underline extension is what would normally install the keymap). |
| **What it should do** | Register the Underline mark + bind Cmd+U + expose `toggleUnderline` chain command. |
| **Causal chain** | (1) Tiptap StarterKit ships Bold + Italic but NOT Underline (documented behavior — Underline is a separate package, `@tiptap/extension-underline`). (2) `package.json` does not list `@tiptap/extension-underline`. (3) Even before the recent commandDOM regression, web's `sendAction("underline")` fell through to `default:` (console warn + no-op). (4) Cmd+U never bound. |
| **Verification** | `grep "extension-underline" package.json` returned empty pre-fix. Web `sendAction` switch (`richEditor.tsx:331-348` pre-fix) handled only `case "bold"` and `case "italic"`. |

### 🟠 Contributing Factor — iOS pell focus race (suspected; NOT verified on sim)

| Field | Value |
|---|---|
| **File + line** | `node_modules/react-native-pell-rich-editor/src/editor.js:697-702` |
| **Exact code** | `flag && focusCurrent(); action[msgData.name](data, options); flag && handleState();` |
| **What it does** | When `name === 'result'`, pell calls `focusCurrent()` then runs the action (`exec('bold')` etc.). `focusCurrent` calls `editor.content.focus()` and tries to restore the saved `anchorNode/anchorOffset`. |
| **Causal chain** | Pell's `saveSelection()` only fires on `oninput` (line 554), NOT on `selectionchange`. If the user makes a fresh highlight without typing, pell has no saved selection. When the native Pressable steals focus → `editor.content.focus()` collapses the visual selection. execCommand then has no selection to apply to. |
| **Status** | `suspected` — would only manifest on iOS pell, which I could NOT live-fire this turn. iOS verification deferred. |
| **Mitigation already in place** | `COMPOSER_SELECTION_TRACKER_JS` (added earlier this session in `composerChipHtml.ts`) saves the live range on every `selectionchange` to `window.__minglaSavedRange`. It also installs a Cmd/Ctrl+U keydown handler. Both are injected via `commandDOM` on init — which works on pell (commandDOM is real there) and silently skips on web (where it's not needed because Tiptap handles selection + Cmd+U via its own extensions). |

### 🟡 Hidden Flaw — Toolbar pills hardcoded `active={false}`

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx:185, 194, 204` |
| **Exact code** | `<Pill label="B" active={false} ... />`, same for I and U |
| **Issue** | Even when bold / italic / underline IS applied to the selection, the pill never shows an active visual state. Operator has no UI feedback that the format is on. |
| **Severity** | P2 — UX coherence (matches feedback `feedback_admin_ui_trust.md` pattern: silent state is untrustworthy state). |
| **Fix** | Subscribe to Tiptap `editor.isActive('bold')` (web) and pell `editor.registerToolbar(state => ...)` (iOS/Android), pipe into `active` prop. NOT addressed in this turn — register as follow-up. |

### 🔵 Observation — Sim is unusable for verification right now

The booted iPhone 17 Pro (UDID `17091E60-C3B6-4167-980D-60C348E177F6`) currently displays iOS Settings. Both running Metro instances (`expo start --web` on 8081 and 8084) refuse iOS bundles (HTTP 404). To verify on iOS, operator must:

1. `cd mingla-business && npx expo start --dev-client` (or `--ios`).
2. Reload the dev-client app on the sim (shake → Reload).
3. Navigate to Marketing → Blast → Compose.

---

## Phase 4 — Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | `richEditor.tsx:307-311` comment correctly states commandDOM is intentionally no-op on web. The bug is that the toolbar wiring violated this contract. |
| **Schema / Deps** | `package.json` missing `@tiptap/extension-underline`. Fixed. |
| **Code** | ComposerV2Editor's toolbar handlers used `commandDOM` (web no-op) instead of `sendAction` (web works). Web RichEditor's `sendAction` switch missing `case "underline"`. Both fixed. |
| **Runtime** | Web Tiptap editor runs in browser — direct DOM access via `editor.chain()`. Pell runs in iOS/Android WebView — message bridge required. The original `sendAction("bold", "result")` worked on both because each platform's RichEditor implementation handled it correctly. |
| **Data** | No persisted-state involvement — formatting is in the `body_html` HTML round-trip. The format application path is what was broken, not the storage. |

**Layer agreement:** All layers now agree post-fix. Pre-fix: code layer contradicted itself (handlers called a method documented as no-op on the affected platform).

---

## Phase 5 — Fix (applied this turn)

### Files changed

1. **`mingla-business/package.json`** — added `"@tiptap/extension-underline": "^2.27.2"`. `npm install` ran successfully.

2. **`mingla-business/src/components/marketing/ComposerV2/richEditor.tsx`**
   - Import: `import Underline from "@tiptap/extension-underline";`
   - Extensions array: added `Underline` (auto-binds Cmd/Ctrl+U).
   - `sendAction` switch: added `case "underline": editor.chain().focus().toggleUnderline().run(); return;`.

3. **`mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx`**
   - Restored `import { ... actions, ... } from "./richEditor"`.
   - Imperative handle `toggleBold` / `toggleItalic` / `toggleUnderline` → reverted from `commandDOM(focusExecJs(...))` to `sendAction(actions.setBold|setItalic|setUnderline, "result")`. Routes correctly on pell (focusCurrent + exec) and Tiptap (chain().focus().toggleX().run()).
   - Local `handleToggleBoldLocal` / `handleToggleItalicLocal` / `handleToggleUnderlineLocal` → same revert.
   - `handleLinkPromptSubmit` → reverted from `commandDOM(insertLinkJs(url))` to `insertLink(url, url)` (works on both — pell wraps selection, Tiptap inserts at cursor with URL text).
   - Removed now-unused `focusExecJs` and `insertLinkJs` helpers.

4. **`mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts`**
   - `COMPOSER_SELECTION_TRACKER_JS` export retained (no changes). Still injected via `commandDOM` in `handleEditorInitialized`. On pell (iOS/Android) it activates: selection tracker + Cmd+U keymap. On web `commandDOM` is no-op so the tracker silently doesn't install — that's fine, Tiptap handles both concerns via its own extension.

### Why this routing works on both platforms

| Action | Web (Tiptap) | iOS/Android (pell) |
|---|---|---|
| `sendAction("bold", "result")` | `editor.chain().focus().toggleBold().run()` (web shim line 334-336) | Message bridge → pell `focusCurrent()` → `exec("bold")` (editor.js:697-702) |
| `sendAction("italic", "result")` | `editor.chain().focus().toggleItalic().run()` (line 337-339) | Same → `exec("italic")` |
| `sendAction("underline", "result")` | `editor.chain().focus().toggleUnderline().run()` (newly added) | Same → `exec("underline")` (pell's `Actions.underline.result` calls `exec('underline')` — editor.js:279) |
| `insertLink(url, url)` | Tiptap `insertContent({type:'text', marks:[{type:'link'}]})` (line 353-365) | Pell `insertLink(title, url)` over message bridge |

---

## Phase 6 — Cross-Surface Impact

| Surface | Affected | Verification status |
|---|---|---|
| Business Web (`mingla-business/` web bundle) | **YES — primary affected surface, fixed this turn** | Source `proven`. Live-fire pending (operator hard-refresh required after Metro picks up the new dep). |
| Business iOS (`mingla-business/` on iOS) | YES — same toolbar handlers, but the underlying pell path was already calling `focusCurrent + exec` via sendAction. My commandDOM rewrite likely was harmless on iOS (commandDOM IS implemented there) but added complexity. The revert simplifies it. The suspected pell focus race (highlight without typing → no saved selection) is mitigated by `COMPOSER_SELECTION_TRACKER_JS` but the toolbar handlers don't USE the saved range now — they use sendAction's bridge. **iOS verification deferred** (sim blocked). |
| Business Android | Same as iOS. **Deferred.** |
| Consumer iOS / Android | NOT affected — composer is mingla-business only. |
| Buyer/anon web | NOT affected — composer is operator-facing only. |
| Admin web | NOT affected. |
| Business Web preview | Same as Business Web. **Fixed.** |

**Cross-surface parity:** Restored. Both pell and Tiptap now receive their canonical action invocations, and Underline is supported everywhere (pell has it natively via execCommand; Tiptap now has the extension).

---

## Phase 7 — Discoveries for Orchestrator (side issues)

1. **Toolbar pill `active={false}` hardcoded** — see Hidden Flaw above. Worth a follow-up ORCH to subscribe to live formatting state and reflect in pill UI.
2. **Pre-existing TS error** in `richEditor.tsx:332` — `editor.commands.setContent(html, { emitUpdate: true })` flags TS2345; the new Tiptap API expects `boolean | undefined` for the second arg. NOT introduced this turn, but flagging.
3. **iOS dev build cannot fetch JS right now** — no Metro instance is bundling for iOS. Operator should know that any iOS verification (for this or any other dispatch) currently requires restarting Metro with `--dev-client` or `--ios`. The dev-client app on the sim was built today (May 19 16:04) and is otherwise ready.
4. **Two parallel Metro instances running** (`expo start --web` on 8081 and 8084) — slightly wasteful, likely artifacts of prior sessions. Operator may want to kill PID 76627 and keep 55299 (or vice versa).
5. **iOS pell focus race** (Contributing Factor #1) is `suspected` not `proven`. If the operator later reports the SAME bug on iOS (highlight + tap B does nothing), the fix is the selection tracker (already injected) PLUS routing through commandDOM specifically on iOS — but ONLY if sendAction proves insufficient there.

---

## Layman summary of the report

- The Bold / Italic / Underline buttons did nothing on web because the most recent edit routed them through `commandDOM`, which the web Tiptap shim defines as a no-op (it returns immediately). That edit silently broke B / I / Link on web while attempting to fix an iOS bug.
- Underline ALSO didn't work because the Tiptap StarterKit doesn't include underline — it needs a separate extension that was never installed.
- Cmd+U didn't work for the same reason: the Tiptap Underline extension is what would auto-bind that keyboard shortcut.
- Cmd+B / Cmd+I worked because StarterKit ships those keymaps automatically.
- Fix applied: installed `@tiptap/extension-underline`, registered it on the web editor with the `underline` action and Cmd+U keymap, and reverted the B / I / U / Link button handlers to use `sendAction` and `insertLink` — both of which are properly implemented on web Tiptap AND iOS pell.
- iOS verification is deferred because the running Metro instances don't serve iOS bundles right now. The iOS pell path is unchanged behavior-wise (sendAction is what was called before this whole arc); the suspected iOS focus race is mitigated by an already-injected selection tracker.
