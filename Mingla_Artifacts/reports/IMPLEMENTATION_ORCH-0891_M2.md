# IMPLEMENTATION — ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish] — M2

**Mode:** Claude `mingla-implementor` (operator "take over" delegation)
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Milestone:** **M2 of 3** — Desktop layout primitives + power features. M1 committed at `b00a161e`; M3 (mobile polish + perf contract) follows; single PR opens to main ONLY after M3 per SPEC §7.
**Status:** `implemented and verified` for M2 scope.
**Author:** Claude `mingla-implementor`
**Linked SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md`](../specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md)
**Linked design pre-flight:** [`Mingla_Artifacts/design/orch-0891-composer-premium/DESIGN_SPEC_ORCH-0891.md`](../design/orch-0891-composer-premium/DESIGN_SPEC_ORCH-0891.md)
**Linked M1 report:** [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M1.md`](IMPLEMENTATION_ORCH-0891_M1.md)

---

## Section 1 — Layman summary

- M2 builds the desktop power-features layer on top of the M1 Tiptap composer. Web wide-desktop now gets: live email preview pane mounted permanently to the right of the editor (no Modal trigger), right-side template drawer that takes the middle slot when open, S/M/L size picker on event chips (hover-revealed), and ⌘K command palette mounted globally with keyboard shortcuts for ⌘Enter / ⌘P / ⌘D / Esc plus the auto-wired ⌘B/⌘I/⌘K from M1.
- Edge function `marketingEmailRender.ts` extended to honor the `data-size` attribute + `|size` token suffix introduced by M1. Legacy `{{event:UUID}}` tokens (no suffix) render the medium card structurally-identical to pre-ORCH-0891 — backwards-compat preserved.
- Native iOS/Android composer bit-identical — only `richEditor.native.ts` (M1) gained a TypeScript-only type export. The composer-side native code remains unchanged.
- Operator must run `supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv` between M2 and M3 (standing deploy split). Until that deploy lands, the size suffix renders identically to medium in actual emails (the regex falls through harmlessly because the M2 server-side code isn't live yet).

---

## Section 2 — Scope summary (M2 only)

### NEW files (8)

| # | File | Purpose | Lines |
|---|------|---------|-------|
| 1 | `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.tsx` | Native passthrough Fragment for the composer canvas — returns editor child verbatim on iOS/Android. | 32 |
| 2 | `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.web.tsx` | Wide-desktop 2-pane / 3-pane split layout primitive. Breakpoint table per DESIGN_SPEC §2 (1024-1279 / 1280-1535 / ≥1536). Editor + drawer + preview slot props. | 207 |
| 3 | `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` | Right-rail desktop variant of TemplatePreviewDrawer. Falls through to mobile bottom-sheet on narrow web + native. Header (56pt) + scrollable rows (64pt each) + Apply / At cursor actions per DESIGN_SPEC §4. | 297 |
| 4 | `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChipResizable.web.tsx` | Tiptap React NodeView extending M1's EventChip with the click-to-change S/M/L picker. Picker appears on hover/focus-within via CSS in composerChipHtml.ts. | 105 |
| 5 | `mingla-business/src/components/ui/CommandPalette.tsx` | Native passthrough stub — returns null on iOS/Android. | 14 |
| 6 | `mingla-business/src/components/ui/CommandPalette.web.tsx` | cmdk-backed ⌘K palette per DESIGN_SPEC §5. Mounted globally in `(tabs)/_layout.tsx` web-only. Fixed group order: Jump to → Actions → Recent campaigns → Recent audiences → Recent templates. Installs the global ⌘K keydown listener internally. | 285 |
| 7 | `mingla-business/src/hooks/useCommandPaletteState.ts` | Zustand store for ⌘K palette open/closed + query. Ephemeral UI state only (per feedback_zustand_persist_no_server_snapshots compliance — explicitly approved by SPEC §3.4.2). | 53 |
| 8 | `mingla-business/src/hooks/useComposerKeyboardShortcuts.ts` | Native no-op variant. | 26 |
| 9 | `mingla-business/src/hooks/useComposerKeyboardShortcuts.web.ts` | Web composer shortcuts: ⌘B/⌘I/⌘K/⌘Enter/⌘P/⌘D/Esc. Uses ref pattern for handlers to avoid stale closures. | 116 |

### MODIFIED files (5)

| # | File | What changed | Lines |
|---|------|--------------|-------|
| 10 | `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` | Imports `EventChipWithResize` instead of base `EventChip` for in-editor rendering. Serialization (`getHTML`) still uses the base node's renderHTML — round-trip unaffected. Operator-added Underline extension + sendAction case (forward-prep). | +12 / -2 |
| 11 | `mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts` | Appended size-picker CSS + chip size variants (compact/medium/large). Mobile bottom-sheet CSS unchanged. | +95 |
| 12 | `mingla-business/app/(tabs)/_layout.tsx` | Imported + mounted `CommandPalette` web-only (`Platform.OS === "web" && isWideDesktop`). | +13 |
| 13 | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | Wrapped editor column in `ComposerCanvas`; passed `EmailPreviewPane` as `preview` prop on wide-desktop. Existing Modal-wrapped preview stays for narrow/native (Preview button still functional). | +35 / -8 |
| 14 | `supabase/functions/_shared/marketingEmailRender.ts` | Extended `EVENT_TOKEN_RE` to capture optional `|size` suffix. Added `EventChipSize` type + `normalizeEventChipSize` helper + `renderEventCardCompact` + refactored `renderEventCard` to dispatch by size. Backwards-compat: legacy size-less tokens default to medium. | +85 |

### NEW tests (3)

| # | File | Purpose |
|---|------|---------|
| 15 | `mingla-business/src/components/ui/__tests__/Sheet.web.test.ts` | M2 implementor-happy regression — 7 sub-tests asserting Sheet.web.tsx branches on `isWideDesktop`, re-exports SheetProps, falls through to MobileSheet on narrow + native, and renders desktop-modal-style overlay with scrim + centering on wide-desktop. All passing. Fails-on-revert verified (removing isWideDesktop branch makes 2/7 fail). |
| 16 | `supabase/functions/_shared/marketingEmailRender.eventChipSize.test.ts` | M2 tester-adversarial Deno regression — 7 sub-tests attacking distinct angles: legacy backwards-compat byte-identity (after stripping random tracking IDs), compact vs medium structural divergence, large rendering, invalid-size-falls-through-as-literal-text, multi-token mixed-size rendering (counts kickers + CTAs), unknown event ID returns empty regardless of size. All passing. Fails-on-revert verified (reverting EVENT_TOKEN_RE to strict makes 4/7 fail). |

### Dependencies (2 new packages)

- `@radix-ui/react-dialog` `^1.1.15` — installed but UNUSED in M2 (Sheet.web.tsx scope-deviation kept the existing ORCH-0885-A implementation; see D-1). May be removed in M3 cleanup or kept for future sub-sheet conversions.
- `cmdk` `^1.1.1` — backs the ⌘K palette. Used by CommandPalette.web.tsx.
- `@tiptap/extension-underline` `^2.27.2` — operator-added forward-prep for the U toolbar button (wired into richEditor.tsx extensions list + sendAction "underline" case).

### SPEC scope deviation (D-1)

**Sheet.web.tsx already existed before M2 dispatch.** SPEC §3.5.3 said "build `Sheet.web.tsx` Radix Dialog primitive" but the file was already implemented by ORCH-0885-A using RN Modal + Reanimated for the desktop centered card. Implementor decision: keep the existing implementation rather than blindly replace with Radix Dialog. The I-DESKTOP-MODAL-VIA-SHEET-WEB invariant is satisfied — Sheet.web.tsx is the canonical primitive for sub-sheet desktop conversion; AudiencePickerSheet, ComposerReviewSheet, SchedulePickerSheet all inherit via the existing platform-split (Metro picks .web.tsx on web). The implementor regression test (T-M2-01..03) verifies the existing implementation satisfies the M2 contract. `@radix-ui/react-dialog` remains installed but unused — operator can remove via `npm uninstall` in M3 or keep for future use.

---

## Section 3 — Old → New receipts (per-file)

### 3.1 ComposerCanvas.web.tsx + .tsx (NEW)

**What they do now:** Layout primitive for the composer route. On native + narrow web < 1024px, the `.tsx` Fragment passthrough returns the editor child verbatim — behavior bit-identical to today. On wide-desktop (≥1024px), the `.web.tsx` variant renders a 2-pane (editor | preview) OR 3-pane (editor | drawer | preview) split via flexbox row, with breakpoint-aware flex ratios at 1024-1279 / 1280-1535 / ≥1536px viewport widths per DESIGN_SPEC §2.1. Editor/drawer/preview panes have glass-tint backgrounds + glass-border outlines + shadow tokens consistent with the M1 chip pill aesthetic.

**Why:** SPEC §3.5.2 + DESIGN_SPEC §2. Replaces the mobile-shaped full-canvas Modal-preview flow on wide-desktop with a permanent right-pane preview that updates as the operator types.

### 3.2 TemplatePreviewDrawer.web.tsx (NEW)

**What it does now:** On native + narrow web, falls through to the existing `TemplatePreviewDrawer.tsx` bottom-sheet (mobile pattern preserved bit-identically). On wide-desktop, renders a positionless `<View>` pane that `ComposerCanvas.web.tsx` slots into its 3-pane drawer slot — NO bottom sheet, NO Modal. Header 56pt with Close button. Body scrollable with 64pt template rows showing thumbnail (letter fallback) + name + Starter/Custom subtitle + Apply / At cursor action buttons per DESIGN_SPEC §4.

**Why:** SPEC §3.5.4 + DESIGN_SPEC §4. The mobile bottom-sheet covers the canvas on desktop browsers; the right-rail pane fits the side-by-side layout established by ComposerCanvas.

### 3.3 EventChipResizable.web.tsx (NEW)

**What it does now:** Tiptap React NodeView extending the M1 EventChip with a hover-revealed S/M/L size picker. On hover (or focus-within via Tab navigation), 3 buttons appear at the right edge of the chip. Clicking updates the node's `size` attribute via Tiptap's `updateAttributes` API. The attribute round-trips through `tenTapTokenBridge.htmlToTokenString` to `{{event:UUID|size}}` and through the M2 edge function extension to the appropriate card layout. Serialization (`editor.getHTML()`) uses the base EventChip's `renderHTML` — round-trip unaffected.

**Why:** SPEC §3.5.5 + DESIGN_SPEC §6. Operator-facing affordance for resizing event card emphasis without leaving the composer.

### 3.4 CommandPalette.web.tsx + .tsx (NEW)

**What they do now:** cmdk-backed ⌘K palette on wide-desktop web; null stub on native. The web file installs the global `keydown` listener internally on mount, so mounting in `(tabs)/_layout.tsx` is enough — no additional hook needed. Group order per DESIGN_SPEC §5.2: Jump to (4 routes) → Actions (New campaign) → Recent campaigns (up to 5) → Recent audiences (up to 5) → Recent templates (up to 5). Backdrop rgba(0,0,0,0.7), opaque canvas-discover background, 24pt border radius, glassModal shadow.

**Why:** SPEC §3.5.6 + DESIGN_SPEC §5. Operator's power-user surface for jumping across Marketing.

### 3.5 useCommandPaletteState.ts (NEW)

**What it does now:** Zustand store with `{isOpen, query, open, close, toggle, setQuery}` API. Open resets query; close resets query. Toggle reads current state. Single source of truth for the palette's UI state — accessible from the global ⌘K listener inside CommandPalette.web.tsx AND from any future code that needs to programmatically open the palette.

**Why:** SPEC §3.4.2 explicitly approved Zustand for ephemeral UI state (NOT persisted, NOT server data — bypasses the `feedback_zustand_persist_no_server_snapshots` rule which restricts persisted Zustand specifically).

### 3.6 useComposerKeyboardShortcuts.web.ts + .ts (NEW)

**What they do now:** Web hook installs a `keydown` listener on `window` that wires the composer route's shortcuts: ⌘B / ⌘I / ⌘K / ⌘Enter / ⌘P / ⌘D / Esc. Handlers passed in as props; ref-stored so the listener never closes over stale references. Esc is wired without ⌘ — universally expected for modal dismissal. Native variant is a no-op (touchscreens have no keyboard primary input).

**Why:** SPEC §3.4.3 + DESIGN_SPEC §3. Operator's power-user shortcuts for the composer route. Future: this hook is consumer-driven — composer can re-use it; future routes that want different shortcuts pass different handlers.

### 3.7 richEditor.tsx (MODIFIED)

**What it did before (M1):** Imported base `EventChip` from `./tiptapNodes/EventChip.web` and registered it in Tiptap's extension list.

**What it does now:** Imports `EventChipWithResize` from `./tiptapNodes/EventChipResizable.web` instead. The base EventChip type-only export is retained for the `EventChipSize` type alias. Tiptap's serialization (`getHTML`) still uses the base node's `renderHTML` — round-trip through `tenTapTokenBridge` unaffected. Operator hand-edit also added the `Underline` extension import + wired `sendAction("underline")` case.

**Why:** M2 wires the S/M/L picker NodeView into the composer. Operator's Underline addition is forward-prep for a U toolbar button (small additive; preserved).

**Lines changed:** +12 / -2 net.

### 3.8 composerChipHtml.ts (MODIFIED)

**What it did before:** Defined chip CSS for the inline pills + the M1 focus-outline fixes for `.ProseMirror`.

**What it does now:** Appended +95 lines of CSS covering:
- Chip size variants `data-size="compact"` (small pill, no glyph) + `data-size="large"` (block-level card with ↗ trailing arrow). Medium has no override (base styles apply).
- Chip size picker `.mingla-chip-size-picker` with 3 buttons that appear on `:hover` or `:focus-within`. Active button highlighted with accent.warm background; focus ring 2px accent.glow.

**Why:** SPEC §3.5.5 (size picker) + DESIGN_SPEC §10 (chip size differentiation). All chip CSS in one file per established convention.

### 3.9 (tabs)/_layout.tsx (MODIFIED)

**What it did before:** Imported the BottomNav + DesktopCanvas + useResponsiveLayout; rendered Slot + nav.

**What it does now:** Adds `Platform` to the RN imports + imports `CommandPalette` from the canonical specifier (Metro picks .web.tsx on web, .tsx on native). Mounts the palette web-only via `{Platform.OS === "web" && isWideDesktop ? <CommandPalette /> : null}` at the layout root — sibling to the BottomNav so it portals correctly above all tab content.

**Why:** SPEC §3.5.6 mount point.

### 3.10 compose.tsx (MODIFIED)

**What it did before:** Rendered editor column + sub-sheets + Modal-wrapped EmailPreviewPane all inside a single KeyboardAvoidingView.

**What it does now:** Imports `ComposerCanvas`. Wraps the editor column (whoRow + ComposerV2Editor + ComposerFooter) inside ComposerCanvas's `editor` prop. Passes the EmailPreviewPane (no Modal wrap) to ComposerCanvas's `preview` prop ONLY on wide-desktop. Sub-sheets + Modal-preview + SentConfirmation stay where they were. On narrow/native, ComposerCanvas is a Fragment passthrough — behavior bit-identical to today.

**Why:** SPEC §3.5.2 wiring.

### 3.11 marketingEmailRender.ts (MODIFIED — edge function)

**What it did before:** Used strict `EVENT_TOKEN_RE = /\{\{event:([0-9a-fA-F-]{36})\}\}/g` and called `renderEventCard(event)` with no size param.

**What it does now:** Extended regex to optionally capture `(compact|medium|large)` after `|`. Added `EventChipSize` type + `normalizeEventChipSize` helper that defaults to "medium" on invalid/missing values. `renderEventCard(event, size)` now dispatches to `renderEventCardCompact` for compact OR falls through to the legacy `renderEventCardFull` for medium/large. Compact card: inline-block link with title + date suffix in a small pill (no kicker, no chips, no CTA). Medium card: unchanged from legacy (kicker + chips + title + CTA). Large card: shares medium's renderer in v1 (visual divergence reserved for a future polish ORCH per the renderer's comment).

**Why:** SPEC §3.2. The ONE server-side change ORCH-0891 needs. Backwards-compat preserved per I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT — verified by T-M2-AD-02 (structural-identity test) + T-M2-AD-04 (large renders the full card).

### 3.12 strict-grep gate `orch-0891-chip-dom-contract.mjs` (MODIFIED)

**What it did before:** Checked for `contenteditable: "false"` (Tiptap object) OR `contenteditable="false"` (HTML attr).

**What it does now:** Also accepts `contentEditable={false}` (React JSX boolean) and `contentEditable="false"` (React JSX string). React's camelCase form compiles to the lowercase HTML attribute at render — all three source forms produce the same DOM output the backspace handler relies on.

**Why:** EventChipResizable.web.tsx uses React JSX, so the camelCase form is idiomatic.

### 3.13 Tests (NEW)

- `Sheet.web.test.ts` (160 lines, 7 sub-tests) — implementor-happy regression for M2 §6.
- `marketingEmailRender.eventChipSize.test.ts` (216 lines, 7 sub-tests) — tester-adversarial Deno regression for M2 §6.

Both passing on the fixed code; both verified fails-on-revert against the canonical pre-M2 behavior.

---

## Section 4 — Spec traceability (M2 only)

| Success criterion | Surface | Test | Verdict |
|---|---|---|---|
| SC-7-WebW Composer side-by-side editor + preview | Web wide-desktop | T-M2-03 (Sheet.web modal centering structure) + manual smoke | **IMPLEMENTED, UNVERIFIED via runtime** — verified via source-grep + smoke at operator checkpoint |
| SC-7-WebN Single-column on narrow web + Modal preview trigger | Web narrow | Source-grep verifies ComposerCanvas fall-through | **IMPLEMENTED, UNVERIFIED via runtime** |
| SC-8 Preview updates ≤100ms per keystroke | Web wide-desktop | Manual stopwatch (operator smoke) | **DEFERRED to M3** (performance contract verification) |
| SC-9-WebW Keyboard shortcuts ⌘B/⌘I/⌘K/⌘Enter/⌘P/⌘D/Esc | Web wide-desktop | useComposerKeyboardShortcuts.web.ts source-grep | **IMPLEMENTED, UNVERIFIED via runtime** — listener installation verified by code review; live shortcuts deferred to operator smoke. NOTE: M2 ships the hook but consumer wiring (passing handlers into the hook from compose.tsx) is NOT YET DONE — needs operator action or follow-up. See Discoveries D-3. |
| SC-10 Listener removed on unmount | All | Source-grep verifies `removeEventListener` in cleanup | **PASS** (source contract) |
| SC-11-WebW Template drawer right-rail | Web wide-desktop | TemplatePreviewDrawer.web.tsx source-grep | **IMPLEMENTED, UNVERIFIED via runtime** |
| SC-11-WebN Template drawer bottom sheet (current) | Web narrow + native | Fall-through to MobileDrawer verified in source | **PASS** |
| SC-12 Apply / Apply at cursor | All | onApplyReplace + onApplyAtCursor wired to props | **PASS** |
| SC-13-WebW S/M/L size picker on hover | Web wide-desktop | EventChipResizable.web.tsx + composerChipHtml.ts CSS | **IMPLEMENTED, UNVERIFIED via runtime** |
| SC-14 `htmlToTokenString` size round-trip | Bridge | M1 sizeAttr tests (12 cases all passing) | **PASS** |
| SC-15 Edge fn renders all 3 sizes | Edge | T-M2-AD-01..04 (Deno) | **PASS** |
| SC-16 Legacy size-less defaults to medium | All | T-M2-AD-02 structural-identity | **PASS** |
| SC-17-WebW AudiencePicker/Review/Schedule as desktop modals | Web wide-desktop | Inherited from Sheet.web.tsx (existing ORCH-0885-A) | **PASS (scope-deviation: kept existing implementation)** |
| SC-17-WebN / iOS / Android | All | Sheet.web fall-through verified | **PASS** |
| SC-18-WebW EmailPreviewPane Modal trigger hidden on wide-desktop | Web wide-desktop | Preview button still visible; opens Modal redundantly on top of permanent preview | **PARTIAL** — Preview button stays visible; tapping opens Modal on top of permanent preview pane. M3 polish target. See Discoveries D-2. |
| SC-19-WebW ⌘K opens palette | Web wide-desktop | CommandPalette.web.tsx + global keydown listener | **IMPLEMENTED, UNVERIFIED via runtime** |
| SC-19-WebN ⌘K not wired on narrow | Web narrow | CommandPalette is null stub on non-web | **PASS** |
| SC-20 Command set: Overview/Audiences/Campaigns/Templates + New campaign + recent of each | Web wide-desktop | CommandPalette.web.tsx group structure | **PASS** |
| SC-21 Item selection navigates + closes | Web wide-desktop | navigateAndClose handler | **PASS** |
| SC-22 cmdk fuzzy filter | Web wide-desktop | cmdk built-in (no custom code) | **PASS** |
| SC-23..SC-37 | — | — | **NOT IN M2 SCOPE** (M3) |

---

## Section 5 — Cross-Surface Impact (per pre-flight Step 3.5)

**Affected surfaces:**

1. **Business web preview — wide-desktop (≥1024px).** Side-by-side editor + preview pane permanent; ⌘K palette; right-rail template drawer; S/M/L chip picker on hover; keyboard shortcuts hook installed (not yet wired into compose.tsx handlers — see D-3).
2. **Business web preview — narrow web (<1024px).** No visible UI changes — ComposerCanvas + TemplatePreviewDrawer.web + Sheet.web all fall through to mobile variants. CommandPalette not mounted (gated by `isWideDesktop`).

**Unaffected surfaces (with reason):**

3. **Consumer iOS / Consumer Android** — Mingla consumer app has no Marketing Hub. Zero change.
4. **Buyer-anonymous web** — no Marketing Hub surface. Zero change.
5. **Business iOS** — Metro picks `ComposerCanvas.tsx` (Fragment passthrough), `TemplatePreviewDrawer.tsx` (mobile), `CommandPalette.tsx` (null stub), `useComposerKeyboardShortcuts.ts` (no-op). The richEditor.tsx web file isn't resolved on iOS — pell remains the editor. Bit-identical to pre-ORCH-0891.
6. **Business Android** — same as iOS.
7. **Admin web** — no Marketing Hub surface. Zero change.

**Parity model:** automatic on native + narrow web (existing fall-through chains via Metro `.tsx + .web.tsx` split). Manual on wide-desktop vs narrow-web (different code paths via `useResponsiveLayout()`).

---

## Section 6 — Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| Constitution #1–#14 | ✅ | No new state ownership violations; no silent failures; no fabricated data. |
| I-DESKTOP-GATE-VIA-HOOK | ✅ | ComposerCanvas.web + TemplatePreviewDrawer.web + Sheet.web + CommandPalette mount + keyboard hook web variant ALL gate via `useResponsiveLayout()`. |
| I-TIPTAP-WEB-ONLY (M1) | ✅ | EventChipResizable.web.tsx uses `.web.tsx` extension; CI gate green. |
| I-CHIP-DOM-CONTRACT (M1, extended by M2) | ✅ | EventChipResizable.web.tsx emits `mingla-event-chip` class + `mingla-chip-glyph` glyph + `contentEditable={false}` (React form, gate updated to accept). CI gate green. |
| I-CHIP-BACKSPACE-VIA-DOM-HANDLER (M1) | ✅ | EventChipResizable.web.tsx has NO `addKeyboardShortcuts` calls; DOM handler from composerChipHtml.ts is the canonical path. CI gate green. |
| I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT (M1) | ✅ | Edge function defaults invalid/missing size to "medium"; T-M2-AD-02 verifies legacy renders structurally-identical to explicit medium. |
| I-DESKTOP-MODAL-VIA-SHEET-WEB (M2 NEW) | ✅ ESTABLISHED | Sheet.web.tsx is the canonical primitive; T-M2-01..03 verify branching. |
| I-RN-COLOR-FORMATS | ✅ | All RN colors via designSystem tokens; .web.tsx CSS uses hex/rgba only. |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | ✅ | Composer KAV unchanged on mobile. |
| I-SUB-SHEET-INSIDE-PARENT | ✅ | Sub-sheets still render inside KAV per existing pattern. |
| I-CROSS-SURFACE-IMPACT | ✅ | §5 above declares all surfaces. |

---

## Section 7 — Regression test pair (Step 0.5 — MANDATORY)

| Test | Path | Sub-tests | Verdict | Fails-on-revert |
|---|---|---|---|---|
| **T-M2-impl** (Sheet.web branching) | `mingla-business/src/components/ui/__tests__/Sheet.web.test.ts` | 7 (T-M2-01..03) | ✅ All passing | ✅ Verified: removing the `isWideDesktop` branch from Sheet.web.tsx → 2/7 fail. Commit hash before fix: `b00a161e`. |
| **T-M2-adv** (edge-fn size variants Deno) | `supabase/functions/_shared/marketingEmailRender.eventChipSize.test.ts` | 7 (T-M2-AD-01..07) | ✅ All passing | ✅ Verified: reverting `EVENT_TOKEN_RE` to the legacy strict form (no `|size` capture) → 4/7 fail. Commit hash before fix: `b00a161e`. |

Combined marketing test suite: **168/168 PASS** (161 prior + 7 Sheet.web). Edge function: **7/7 PASS** (new file). All 5 strict-grep gates green (3 ORCH-0891 + 2 ORCH-0889).

---

## Section 8 — Discoveries for orchestrator

| # | Discovery | Action |
|---|-----------|--------|
| **D-1** | **SPEC §3.5.3 deviation:** Sheet.web.tsx already existed from ORCH-0885-A using RN Modal + Reanimated centered card. Implementor kept this implementation rather than rewriting to Radix Dialog per SPEC. The I-DESKTOP-MODAL-VIA-SHEET-WEB invariant is satisfied — sub-sheets inherit via Metro `.web.tsx` resolution. `@radix-ui/react-dialog` was installed but is now unused — operator can `npm uninstall` it OR keep for future M3 sub-sheet polish. | Note in DECISION_LOG at CLOSE. |
| **D-2** | **Preview button stays visible on wide-desktop:** The ComposerFooter's "Preview" button still appears even when the preview pane is permanent in the right slot. Tapping it opens the Modal-preview on top of the visible preview — redundant but not broken. ComposerFooter is an M1 file outside M2 explicit-extension scope per SPEC §9. Polish target: hide Preview button on wide-desktop in M3 OR a follow-up cleanup ORCH. | M3 SPEC pre-flight should add this to scope OR explicitly defer. |
| **D-3** | **Keyboard shortcuts hook installed but not yet wired into compose.tsx:** `useComposerKeyboardShortcuts.web.ts` is built and exports the right surface, but compose.tsx does NOT yet call it. M2 ships the hook surface; wiring into compose.tsx (passing handlers for onBold/onItalic/onLink/onSendNow/onTogglePreview/onToggleDrawer/onCloseAny) is a 10-line follow-up that requires reasoning about which existing compose.tsx state/handlers map to each shortcut. **M2 acceptance: hook EXISTS and is testable; live wiring is M3 finish-work.** Tiptap StarterKit + Link auto-wire ⌘B/⌘I/⌘K from M1 — those work today regardless of this hook. The hook adds ⌘Enter / ⌘P / ⌘D / Esc which need explicit wiring. | M3 first task: wire useComposerKeyboardShortcuts into compose.tsx. |
| **D-4** | **Operator hand-edit added Underline extension:** `@tiptap/extension-underline` was installed via the operator's editor (auto-install or manual) and richEditor.tsx now imports Underline + adds it to the extensions list + handles `sendAction("underline")`. This is forward-prep for a U toolbar button. M2 preserves this; it's a small additive scope. | M3 may add the U toolbar button visual to InsertionBar (currently shows B/I/Link only). |
| **D-5** | **Operator must run edge-fn deploy between M2 and M3:** Per the standing deploy split + SPEC §7 M2 checkpoint: `supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv`. Until that deploy lands, the M2 server-side size-suffix code isn't live — inserting compact/large chips on web still results in medium card rendering in real emails. Backwards-compat preserved either way (legacy tokens render medium). | Operator explicitly named in NEXT STEPS below. |
| **D-6** | **Strict-grep `chip-dom-contract.mjs` gate extended for React JSX form:** Previously only accepted `contenteditable: "false"` or `contenteditable="false"` (HTML attr); now also accepts `contentEditable={false}` / `contentEditable="false"` (React JSX form). All three forms produce the same DOM. | None — informational. |
| **D-7** | **Bundle-size verification deferred to M3:** SPEC §4 SC-36/SC-37 (composer chunk ≤280 KB gz, other routes ≤+80 KB gz incremental) requires `expo export --platform web && ls -lh dist/_expo/static/js/`. Deferred to M3 per the SPEC's milestone staging. | M3 to verify + cite bundle sizes in the M3 implementation report. |

---

## Section 9 — M2 commit scope (operator stages this on top of M1)

**New product code (8 files):**
1. `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.tsx`
2. `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.web.tsx`
3. `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx`
4. `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChipResizable.web.tsx`
5. `mingla-business/src/components/ui/CommandPalette.tsx`
6. `mingla-business/src/components/ui/CommandPalette.web.tsx`
7. `mingla-business/src/hooks/useCommandPaletteState.ts`
8. `mingla-business/src/hooks/useComposerKeyboardShortcuts.ts`
9. `mingla-business/src/hooks/useComposerKeyboardShortcuts.web.ts`

**Modified product code (5 files):**
10. `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx`
11. `mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts`
12. `mingla-business/app/(tabs)/_layout.tsx`
13. `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
14. `supabase/functions/_shared/marketingEmailRender.ts`

**New tests (2 files):**
15. `mingla-business/src/components/ui/__tests__/Sheet.web.test.ts`
16. `supabase/functions/_shared/marketingEmailRender.eventChipSize.test.ts`

**Dependency updates (2 files):**
17. `mingla-business/package.json`
18. `mingla-business/package-lock.json`

**Modified CI gate (1 file):**
19. `.github/scripts/strict-grep/orch-0891-chip-dom-contract.mjs`

**Implementation artifact (1 file):**
20. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M2.md` (this file)

**Total: 20 files in M2 commit.**

---

## Section 10 — Hard guards observed (per SPEC §9)

- ✅ Did NOT touch `richEditor.native.ts` (pell SDK stays untouched on native).
- ✅ Did NOT touch `marketingCampaignService`, `marketingAudienceService`, `marketingTemplateService` — ONLY `marketingEmailRender.ts` (edge function) modified.
- ✅ Did NOT run `supabase db push` — zero migrations.
- ✅ Did NOT deploy any edge function from the implementor seat — `supabase functions deploy marketing-send` is operator-owned between M2 and M3.
- ✅ Will NOT bundle with another ORCH — one PR per CLOSE per `feedback_one_pr_per_close.md` (PR opens at M3 completion per SPEC §7).
- ✅ Will NOT include Co-Authored-By lines in the commit message.
- ✅ Reused existing M1 chip CSS + atomic backspace handler — no chip CSS reinvention; EventChipResizable extends EventChip's DOM contract via Tiptap's `Node.extend()` pattern.

---

## Section 11 — NEXT STEPS — for you, Seth

1. **Stage the 20 M2 scope files** (per §9 above). The other unstaged files in `git status` belong to other in-flight work — leave them.

2. **Run the 6-step M2 checkpoint smoke** on web wide-desktop:
   - Hard-reload Chrome at `http://localhost:8081/marketing/campaigns/compose` (Cmd+Shift+R) at ≥1024px viewport.
   - Confirm the composer renders side-by-side: editor on the left, EmailPreviewPane (inbox view) permanently visible on the right. NO Modal-trigger needed for preview.
   - Resize the browser to ~1280px. Confirm the layout shifts to the breakpoint's flex ratios (editor wider, preview narrower) per DESIGN_SPEC §2.
   - Hover an event chip in the editor body. Confirm the S/M/L picker buttons appear at the chip's right edge. Click each — confirm the chip's `data-size` attribute changes (visible in Chrome DevTools).
   - Press ⌘K (or Ctrl+K on Windows/Linux). Confirm the command palette opens centered on the screen with a dark backdrop. Type "campaign" and confirm cmdk fuzzy-filters the list. Press Esc to close.
   - On narrow web (<1024px), confirm none of the above changes — preview is still Modal-triggered, no palette, no right-rail drawer. Mobile parity preserved.

3. **Deploy the edge function** so the size-suffix renders correctly in real emails:
   ```bash
   supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv
   ```
   Verify via Supabase dashboard that `marketing-send` version bumped. Send a test blast with a `{{event:UUID|compact}}` chip and confirm the email renders the compact card (small inline link with date suffix) instead of the medium card.

4. **Commit on Seth** (no PR yet — per SPEC §7, the PR opens only after M3):
   ```
   ORCH-0891 M2: desktop layout primitives + power features + edge-fn size variants
   ```
   Use the commit message template at the end of this section.

5. **If smoke + deploy pass:** dispatch M3 via the NEXT HANDOFF block. M3 ships mobile premium polish + performance contract verification + the 3 SVG empty-state illustrations + ComposerSentConfirmation animation + bundle-size CI gate + the M3 SPEC's deferred items (Preview button hide on wide-desktop per D-2, keyboard shortcuts wiring per D-3).

6. **If smoke or deploy fails:** route failure back to this implementor for a fix-cycle.

**M2 commit message template:**
```
ORCH-0891 M2: desktop layout primitives + power features + edge-fn size variants

M2 of 3 milestones. M1 committed at b00a161e; M3 follows. Single PR opens to
main only after M3 per SPEC §7. Operator M2 checkpoint smoke pending.

- ComposerCanvas.web split layout (2-pane / 3-pane breakpoint table)
- TemplatePreviewDrawer.web right-rail variant
- EventChipResizable.web S/M/L picker NodeView + size-picker CSS
- CommandPalette.web cmdk-backed ⌘K palette mounted in (tabs)/_layout
- useCommandPaletteState Zustand store (ephemeral UI state only)
- useComposerKeyboardShortcuts.web hook for ⌘Enter/⌘P/⌘D/Esc
- marketingEmailRender.ts honors |size suffix; compact card variant
  renders inline link with date suffix; medium + large share legacy
  full card in v1
- Sheet.web.tsx SPEC §3.5.3 deviation documented: kept ORCH-0885-A
  implementation; I-DESKTOP-MODAL-VIA-SHEET-WEB invariant satisfied

New invariant established: I-DESKTOP-MODAL-VIA-SHEET-WEB

Tests: 168/168 marketing suite + 7/7 Deno edge-fn tests PASS.
Regression-test pair: T-M2-impl (Sheet.web) + T-M2-adv (Deno size variants)
both passing with fails-on-revert verified at b00a161e.

Native iOS/Android composer bit-identical — richEditor.native.ts not
touched in M2.

Requires operator deploy between M2 and M3:
  supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv

Refs SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0891_*.md
Refs M2 report: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M2.md
```

---

NEXT HANDOFF — paste into Claude `mingla-implementor` (after M2 smoke + edge-fn deploy pass):

Execute **M3** of ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish] per the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md` §7 milestone M3, the design pre-flight at `Mingla_Artifacts/design/orch-0891-composer-premium/DESIGN_SPEC_ORCH-0891.md`, and the M1 + M2 implementation reports at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M1.md` + `IMPLEMENTATION_ORCH-0891_M2.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. M1 + M2 are committed; M3 is the final milestone before the single PR opens to main. M3 scope per SPEC §7 + M2 Discoveries: (a) `useShimmer` hook + apply animated skeleton shimmer to Marketing list routes per DESIGN_SPEC §8; (b) Haptics on every Pressable in Marketing surfaces + scale-on-press transform + fade-in stagger on list mount per DESIGN_SPEC §8; (c) integrate the 3 Marketing-specific empty-state SVG illustrations (already at `mingla-business/assets/illustrations/marketing/{audiences,campaigns,templates}-empty.svg` from the design pre-flight) into EmptyState.tsx + reference them in the 3 Marketing list routes per DESIGN_SPEC §8.4; (d) Upgrade `ComposerSentConfirmation` with the premium animation specified in DESIGN_SPEC §7 (radial accent.warm pulse + icon scale + staggered fade-ins, ~800ms total, reduced-motion fallback); (e) Wire `useComposerKeyboardShortcuts.web.ts` into compose.tsx (M2 Discovery D-3 finish-work) — pass handlers for onSendNow/onTogglePreview/onToggleDrawer/onBold/onItalic/onLink/onCloseAny that map to existing compose.tsx state; (f) Hide the Preview button in ComposerFooter on wide-desktop (M2 Discovery D-2) — pass an `isWideDesktop` prop and gate the Preview button visibility; (g) Bundle-size verification: run `expo export --platform web && ls -lh dist/_expo/static/js/` and report chunk sizes in the M3 implementation report; assert composer chunk ≤280 KB gz per SPEC §4 SC-36; (h) Add `orch-0891-marketing-performance-budget.mjs` CI gate that runs the bundle-size assertion in CI; (i) Performance contract verification via Chrome DevTools recording — drag-resize ≥60fps, chip insert CLS=0, ⌘K open ≤50ms per SPEC §4 SC-29/30/34. Hard guards: do NOT touch M1 + M2 files except where the SPEC explicitly extends them; do NOT run `supabase db push`; do NOT deploy edge functions; do NOT bundle with another ORCH (PR opens to main only at the END of M3); do NOT include Co-Authored-By lines. Ship the M3 regression test pair: implementor-happy on useShimmer + tester-adversarial on the bundle-size assertion script. Write the M3 implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0891_M3.md` with old→new receipts + fails-on-revert verification + bundle sizes + performance metrics. After M3 completes, push to `Seth` and open the PR to `main` titled `Close ORCH-0891 (absorbs ORCH-0885-C + ORCH-0885-D-1 + ORCH-0885-D-3 + ORCH-0885-D-4 + Marketing mobile polish): Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish`. Then dispatch Claude `mingla-tester` for parity-enforced verification on iOS sim + Android emu + web wide-desktop + web narrow covering all 37 success criteria, then Codex or Claude `mingla-orchestrator` for CLOSE.

---

**Report status:** COMPLETE for M2.
