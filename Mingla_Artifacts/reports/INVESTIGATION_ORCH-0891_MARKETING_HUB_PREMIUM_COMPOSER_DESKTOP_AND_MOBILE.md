# INVESTIGATION — ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish]

**Mode:** `mingla-forensics` INVESTIGATE (supplementary to ORCH-0885 parent investigation)
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Severity:** S1-high (operator-authorized one-PR bundle absorbing ORCH-0885-C + ORCH-0885-D-1..4 + a new Marketing mobile polish strand)
**Classification:** `missing-feature` + `ux` + `design-debt` + `performance`
**Affected surfaces:** business-web wide-desktop (≥1024px) + business-web narrow (<1024px) + business-iOS + business-Android. Out of scope: consumer-iOS, consumer-Android, buyer-anon web, admin-web.
**Author:** Claude `mingla-forensics`
**Confidence:** `probable` across all findings (parent investigation already proved most of the underlying analysis; this supplement only adds new discoveries surfaced during the bundled-scope ingest).

---

## Section 0 — Mandatory Phase-0 ingestion

This investigation is **supplementary** to the parent meta-ORCH investigation, NOT a standalone re-investigation. The parent already proved every architectural decision; this supplement only records new findings surfaced while re-reading the manifest in the bundled-scope context.

**Already-proven inputs (do not re-prove; cite by reference):**
- [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0885_DESKTOP_REDESIGN.md`](INVESTIGATION_ORCH-0885_DESKTOP_REDESIGN.md) — Tiptap framework decision, Radix/shadcn/cmdk/Floating UI primitives, `.web.tsx` carve-out pattern, per-screen audit table, 10 open operator questions.
- [`Mingla_Artifacts/specs/SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md`](../specs/SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md) — established `useResponsiveLayout()` hook + DesktopCanvas + BottomNav.web.tsx + I-DESKTOP-GATE-VIA-HOOK invariant + radial-gradient canvas tokens.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md` (in-flight at time of ORCH-0891 dispatch — not yet committed; cite by textual reference until ORCH-0889 promotes to main) — Wave-1 baseline this SPEC supersedes; `useStickyFooterOffset` hook + I-DISABLED-QUERY-IS-LOADING invariant + I-STICKY-FOOTER-VIA-HOOK invariant + the single-file `richEditor.tsx` web stub that ORCH-0891 replaces.
- [`mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts`](../../mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts) — full CSS contract for chip pills (event chip with ▣ glyph, personalization chip with `{ }` decorators) + atomic backspace handler.
- [`mingla-business/src/services/marketing/tenTapTokenBridge.ts`](../../mingla-business/src/services/marketing/tenTapTokenBridge.ts) — ProseMirror-shaped AST + `htmlToTokenString` + `extractEmbeddedEventIds` + `bodyHtmlToTenTapDoc` + `docToHtml`. Already Tiptap-compatible (ProseMirror = Tiptap's underlying engine).
- [`Mingla_Artifacts/design/desktop-redesign/03-tier3-power-features.html`](../design/desktop-redesign/03-tier3-power-features.html) — Tier 3 visual reference for ⌘K palette, multi-select rows, J/K/X/⏎ shortcut hints, persistent right rail aesthetic.

**New files read during this supplement (incremental Phase 0):**

| File | Why it matters | Read |
|---|---|---|
| `mingla-business/src/components/marketing/EmailPreviewPane.tsx` (440 lines) | The right-rail preview pane on desktop reuses this component verbatim — no new preview component needed. Self-contained: takes `{subject, bodyHtml, variables, brandName, brandHeaderImageUrl, embeddedEvents}`, renders the inbox-canvas + brand-header + variable-substituted body + inline event cards + unsubscribe footer. | ✅ surface contract |
| `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx` (598 lines) | Native InsertionBar surface — 6-pill bar (B/I/Link/+ Event/{ } Personalize/⋮) with three inline panels (events scroller / personalize grid / overflow list) + the merged F.9 toolbar. Already imports `useResponsiveLayout` — there's precedent for desktop branches inside this file. | ✅ surface contract |
| `mingla-business/src/components/marketing/AudiencePickerSheet.tsx` (336 lines) | Audience picker — uses the `Sheet` primitive. For ORCH-0891 desktop modal conversion, we need `Sheet.web.tsx` that renders as Radix Dialog when `isWideDesktop`; mobile keeps RN Sheet. | ✅ surface contract |
| `mingla-business/src/components/marketing/ComposerReviewSheet.tsx` (189 lines) | Send-now confirmation sheet — same `Sheet` primitive consumer. Same desktop-modal conversion path. | ✅ surface contract |
| `mingla-business/src/components/marketing/ComposerV2/SchedulePickerSheet.tsx` (268 lines) | Schedule date-time picker — same `Sheet` primitive. Same conversion path. | ✅ surface contract |
| `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.tsx` (539 lines) | Currently a bottom-sheet on mobile. On desktop becomes the right-side persistent drawer (per ORCH-0891 scope item 4). | ✅ surface contract |

**Skipped (already covered in parent investigation or ORCH-0889 implementation):** `ComposerV2Editor.tsx`, `richEditor.tsx`, `richEditor.native.ts`, `useResponsiveLayout.ts`, `DesktopCanvas.tsx`, `BottomNav.web.tsx`, the marketing hooks, the marketing routes, the strict-grep workflow.

---

## Section 1 — Symptom summary (operator-reported)

**Expected:**
1. The Marketing Hub feels desktop-class on wide-desktop browsers AND remains premium on mobile.
2. The Blast composer's chips render as styled pills on web exactly like native pell does today — no raw `{first_name}` token markup in the user's view.
3. The composer surface delivers desktop power features: live email preview pane (side-by-side), keyboard shortcuts, right-side template drawer, drag-resize event cards, ⌘K command palette.
4. Sub-sheets (audience picker, review, schedule, preview) feel like real desktop modals on web — not full-canvas mobile-shaped overlays.
5. Every Marketing surface on mobile (Overview / Audiences / Campaigns / Templates / send-confirmation) feels polished: shimmer skeletons, micro-interactions, haptics on every CTA, illustration upgrade.
6. Performance is fluid — no slugs, no jank, 60fps drag operations, no layout shift on chip insert.

**Actual (post-ORCH-0889 Wave-1 baseline):**
1. ✅ Web Blast tab loads correctly (Wave-1 fixed the loading-state mis-paints).
2. ❌ Composer body on web is a plain `<TextInput multiline>` (Wave-1 stopgap): tokens display as readable `{first_name}` text but NOT as styled pills.
3. ❌ No live preview pane on desktop — preview is still a modal triggered by an explicit button.
4. ❌ No keyboard shortcuts.
5. ❌ Template drawer is a bottom sheet on both mobile and desktop — wastes desktop screen space.
6. ❌ Event-card chips are fixed-size — no resize.
7. ❌ No ⌘K command palette anywhere in the business app.
8. ❌ Sub-sheets (Audience / Review / Schedule / Preview) render as mobile-shaped overlays on desktop.
9. ❌ Mobile Marketing surfaces have static skeletons (no shimmer), minimal motion polish, inconsistent haptics.
10. ❌ "Slugs" — no performance contract; long lists drop frames; FAB taps lag waiting for the route push.

---

## Section 2 — Investigation manifest (incremental)

```
ORCH-0885 parent investigation (already done)
    ↓ (decisions: Tiptap web carve-out, Radix/cmdk primitives, .web.tsx pattern, MasterDetailLayout)
ORCH-0889 Wave-1 stopgap (already shipped)
    ↓ (single file: richEditor.tsx web — textarea baseline)
ORCH-0891 (THIS ORCH) — full premium pass
    ├─→ richEditor.tsx web — full rewrite as Tiptap-backed editor
    ├─→ NEW: ComposerCanvas.web.tsx — side-by-side layout primitive
    ├─→ NEW: ComposerKeyboardShortcuts.web.tsx — ⌘B/⌘I/⌘K/⌘Enter/⌘P/⌘D/Esc
    ├─→ NEW: Sheet.web.tsx — Sheet primitive's web variant via Radix Dialog
    ├─→ TemplatePreviewDrawer.web.tsx — desktop right-rail variant
    ├─→ NEW: EventChipResizable.web.tsx — drag-resize wrapper for event cards
    ├─→ NEW: CommandPalette.web.tsx — cmdk-based ⌘K palette
    ├─→ Marketing route polish — shimmer skeletons, motion micro-interactions, haptics
    ├─→ NEW: useShimmer hook — animated skeleton placeholder
    └─→ Performance contract — bundle splitting, optimistic UI, prefetch on hover
```

---

## Section 3 — New findings (incremental)

### 🟡 HF-A — Chip CSS is already fully defined; Tiptap port is pure mapping, not invention

**File:** [`mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts`](../../mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts) lines 90–162.

**Why this matters:** The investigation worried about "visual parity" between native pell chips and the Tiptap web chips. In fact the visual contract is **fully written down already**: `COMPOSER_CHIP_CSS` exports the exact CSS rules that pell injects into its WebView at init. The same CSS string can be injected into Tiptap's editor root via `Editor.injectCss()` or applied via a shared `composer-chips.css` module loaded only in the `.web.tsx` carve-out.

**Implication for SPEC:** Tiptap custom-node definitions for `EventChip` and `PersonalizationChip` need to emit DOM elements matching `.mingla-event-chip` and `.mingla-personalization-chip` class names. The CSS handles all visual styling. Pixel parity with native is then automatic — both surfaces consume the same CSS string.

**Classification:** 🟡 Hidden Flaw — actually a positive discovery; documenting so the SPEC scopes Tiptap chip work as "map node → DOM with class name," not "design chip visuals."

### 🟡 HF-B — Atomic backspace handler is pure DOM and library-agnostic

**File:** [`composerChipHtml.ts`](../../mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts) lines 177–227 (`COMPOSER_CHIP_BACKSPACE_HANDLER_JS`).

**Why this matters:** The Notion/Linear-style "single backspace deletes the whole chip atomically" UX is already solved at the DOM level. The handler is pure DOM (`document.addEventListener('keydown', …)`), library-agnostic, and was designed for pell's WebView but works on ANY contenteditable surface.

**Implication for SPEC:** Tiptap's editor root is a contenteditable div on web. The same handler script runs in the `.web.tsx` carve-out via a `useEffect` that installs it on `editor.view.dom`. NO new backspace logic needs to be written in Tiptap-specific terms — and crucially, this means parity with native pell behavior is guaranteed by construction.

**Alternative considered:** Tiptap has a native `Backspace` keymap. We could use Tiptap's keymap API to define delete-on-backspace per chip node. BUT: that approach diverges from native pell's behavior, which uses the DOM handler. To minimize behavioral drift, the SPEC should mandate **reusing the existing DOM handler verbatim** — it's already tested in production on iOS/Android WebViews.

**Classification:** 🟡 Hidden Flaw → positive discovery. Documenting so the SPEC explicitly forbids the implementor from re-inventing chip backspace via Tiptap keymaps.

### 🟡 HF-C — `EmailPreviewPane` is fully self-contained and side-by-side-ready

**File:** [`mingla-business/src/components/marketing/EmailPreviewPane.tsx`](../../mingla-business/src/components/marketing/EmailPreviewPane.tsx) (440 lines).

**Why this matters:** The investigation called for a "live preview pane on the right on wide-desktop." The pane already exists — `EmailPreviewPane` consumes `{subject, bodyHtml, variables, brandName, brandHeaderImageUrl, embeddedEvents}` and renders the inbox-canvas mirror. Today it's mounted inside a `<Modal>` triggered by the Preview button (compose.tsx line 666–703). For the desktop side-by-side layout, the same component just gets mounted in a sibling `<View>` alongside the editor instead of inside a Modal — no new code, only layout wiring.

**Implication for SPEC:** No new "RightRailPreview" component to build. The desktop ComposerCanvas layout primitive renders `<EditorRoot />` and `<EmailPreviewPane />` side-by-side. The mobile path keeps the current Modal trigger. Component reuse is automatic via the `.web.tsx` carve-out.

**Classification:** 🟡 Hidden Flaw → positive scope reduction (saves ~500 lines of net-new component code in the SPEC).

### 🟠 CF-A — Sub-sheet desktop-modal conversion needs a single primitive, not per-sheet rewrites

**Files:**
- [`mingla-business/src/components/ui/Sheet.tsx`](../../mingla-business/src/components/ui/Sheet.tsx) (current RN Sheet primitive)
- `AudiencePickerSheet.tsx`, `ComposerReviewSheet.tsx`, `SchedulePickerSheet.tsx` — all consume `<Sheet>`
- `compose.tsx:666-703` — `EmailPreviewPane` wrapped in RN `<Modal>` (not `<Sheet>`)

**Why this matters:** Three of the four sub-sheets use the `<Sheet>` primitive; one uses RN `<Modal>`. The desktop conversion can be unified IF we ship a `Sheet.web.tsx` that branches on `isWideDesktop` and renders Radix Dialog instead. All three Sheet-based consumers inherit the conversion automatically. The Modal-based EmailPreviewPane needs a separate conversion path (one-off).

**Implication for SPEC:** One new primitive (`Sheet.web.tsx`) covers three of four desktop modal conversions. The EmailPreviewPane Modal is handled by the side-by-side layout primitive entirely (HF-C above) — it never renders as a Modal on desktop, so no Modal→Dialog conversion needed there.

**Classification:** 🟠 Contributing Factor — guides architecture toward DRY primitive vs four per-sheet rewrites.

### 🟡 HF-D — Drag-resize event cards require a server-side render touch

**Files:**
- [`composerChipHtml.ts`](../../mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts) lines 55–66 (`eventChipHtml`)
- [`tenTapTokenBridge.ts`](../../mingla-business/src/services/marketing/tenTapTokenBridge.ts) lines 437–440 (event chip → `{{event:UUID}}` token regex)
- `supabase/functions/_shared/marketingEmailRender.ts` (server-side body_html rendering — referenced from EmailPreviewPane.tsx file header)

**Why this matters:** Operator wants event cards to be drag-resizable (compact / medium / large). The chip's current DOM/token form has NO size attribute:
- DOM: `<span class="mingla-event-chip" contenteditable="false" data-event-id="UUID" data-cta="tickets">…</span>`
- Token: `{{event:UUID}}`

To honor a `data-size` attribute, we need:
1. Tiptap's `EventChip` node to expose a `size` attribute (compact/medium/large).
2. DOM emission to include `data-size="compact|medium|large"`.
3. `tenTapTokenBridge.htmlToTokenString` regex to capture the size and emit it as `{{event:UUID|size}}` (extended token shape).
4. Server-side `marketingEmailRender` to read the size attribute (or extended token) and render the appropriate card layout.

**Implication for SPEC:** This is the ONE server-side change ORCH-0891 needs. It must be specced precisely AND it must be backwards-compatible (legacy `{{event:UUID}}` tokens without a size suffix default to `medium`). The change is small (~30 lines in `marketingEmailRender.ts`) but it crosses the deploy boundary — operator must run `supabase functions deploy marketing-send` after the SPEC ships.

**Classification:** 🟡 Hidden Flaw — flag in SPEC §3 (server-side strand) for separate operator review before deploy.

### 🟡 HF-E — Bundle-size impact of adding Tiptap + Radix + cmdk + Floating UI

**Estimated impact (per parent investigation §F-8):**
- Tiptap core + StarterKit + Link extension: ~70–110 KB gz
- Radix UI primitives (Dialog + Popover + Tooltip + Dropdown): ~10–25 KB gz
- cmdk (command palette): ~6 KB gz
- Floating UI: ~8 KB gz core
- **Total new web-only bundle weight: ~95–150 KB gz.**

**Why this matters:** The current mingla-business web bundle (per ORCH-0887 [Business Web Performance] investigation) is already ~800KB–1.5MB gzipped on cold load. Adding 100–150 KB pushes it toward 1MB+ on cold load, which inflates the auth-bootstrap window (the bug ORCH-0887-A is solving in parallel).

**Implication for SPEC:** Route-level code-splitting is **mandatory**. The composer is on its own route (`/marketing/campaigns/compose`) — its bundle should be lazy-loaded via `expo-router` dynamic route imports OR React.lazy. The ⌘K command palette is global but small (6 KB) — keep it in the main bundle. Marketing list routes don't get any new heavyweight deps — they use the existing skeleton/motion primitives. Per-route bundle budget: composer route ≤ 250 KB gz (its own Tiptap + Radix slice), every other route ≤ existing baseline.

**Verification step:** Implementor must run `expo export --platform web && ls -lh dist/_expo/static/js/` post-implementation and report bundle sizes per chunk in the implementation report. SPEC mandates a Step-0.5 bundle-size assertion: if the composer chunk exceeds 280 KB gz OR the main chunk grows by >20 KB gz, REJECT and split further.

**Classification:** 🟡 Hidden Flaw — performance budget enforcement, not a current bug. Codify as a new invariant.

### 🟠 CF-B — Performance contract (no slugs) needs measurable thresholds

**Why this matters:** "No slugs" is subjective. The SPEC must commit to measurable thresholds the tester can verify, otherwise the operator's intent slips. Concrete thresholds derived from current web platform capabilities + parent investigation context:

| Metric | Threshold | Verification |
|---|---|---|
| Drag-resize event card frame rate | ≥60fps sustained | Chrome DevTools Performance recording during drag |
| Chip insert layout shift | CLS = 0.00 (no shift) | Chrome DevTools Performance recording |
| Send Now → confirmation visible | ≤200ms (optimistic UI; actual server roundtrip continues in background) | Manual stopwatch + Network panel |
| Skeleton shimmer animation | ≥60fps; uses CSS `@keyframes` or `requestAnimationFrame`, NOT setInterval | Chrome DevTools Performance recording + code review |
| Template hover prefetch | Template body fetched within 100ms of hover | Network panel |
| ⌘K palette open | ≤50ms from keypress to visible | Chrome DevTools Performance recording |
| Marketing route navigation | ≤300ms from tap to visible content (cached) | Manual stopwatch |
| Initial cold-load JS | ≤350 KB gz for the marketing route's eager chunks | `ls -lh dist/_expo/static/js/` |

**Implication for SPEC:** Codify as I-PROPOSED-MARKETING-PERFORMANCE-BUDGET (new invariant). Tester verifies each threshold; FAIL on any miss.

**Classification:** 🟠 Contributing Factor — without measurable thresholds, "no slugs" is unenforceable.

### 🟡 HF-F — Mobile premium polish strand is wider than the spec template's "Component layer" section

**Why this matters:** Scope item 8 ("Marketing Hub mobile premium polish") spans:
- Skeleton shimmer (every list route)
- Motion micro-interactions (tap scale, slide-in, fade-in on every CTA)
- Haptics on every Pressable in the Marketing surface
- Empty-state illustration upgrade (the current `EmptyState illustration="users"` is generic — needs Marketing-specific illustrations)
- Copy polish (audit every user-facing string for tone consistency with the brand voice memory)
- Send-confirmation premium animation (the moment a blast sends should feel celebratory — current `ComposerSentConfirmation` is utilitarian)

**Implication for SPEC:** Mobile polish needs its OWN dedicated section in the SPEC with per-surface success criteria, not just "polish the cards." This is also the strand most likely to trigger designer pre-flight work via `/mingla-designer` — the empty-state illustrations and send-confirmation animation are net-new visual decisions.

**Classification:** 🟡 Hidden Flaw — flag in SPEC to ensure mobile strand gets proper sub-spec depth.

### 🔵 OB-A — The 4 design mocks at `Mingla_Artifacts/design/desktop-redesign/` cover the rail/canvas/master-detail/⌘K/right-rail/multi-select aesthetic but DO NOT cover the composer specifically

**Files:**
- `00-today-baseline.html` (236 lines) — baseline screenshot of current state
- `01-tier1-container-rail.html` (240 lines) — rail + canvas (shipped via ORCH-0885-A)
- `02-tier2-desktop-shell.html` (438 lines) — master-detail in Hub/Events
- `03-tier3-power-features.html` (411 lines) — ⌘K, multi-select, right rail, keyboard nav

**Why this matters:** Mocks 02 and 03 visualize the navigation chrome (sidebar, top bar, right rail, ⌘K palette) but do NOT show a composer with chip pills + side-by-side preview + drag-resize cards + keyboard shortcuts. The implementor will need to make design decisions on composer-specific aesthetics with no mock to reference.

**Implication for SPEC:** Designer pre-flight via `/mingla-designer` is **mandatory** before implementor dispatch. Specifically, the designer must produce:
- Composer canvas split layout at 1024px / 1280px / 1440px / 1920px viewport widths.
- Insertion bar / formatting toolbar visual treatment for the desktop (current InsertionBar is mobile-shaped).
- Template drawer right-rail width + content density.
- ⌘K palette row aesthetic + recent-actions ordering.
- Drag-resize handle visual treatment.
- Send-confirmation premium animation specification.
- Empty-state illustration upgrades for Marketing (Audiences / Campaigns / Templates).

**Classification:** 🔵 Observation — flag mandatory designer pre-flight in SPEC §3 (designer section).

### 🔵 OB-B — ORCH-0891 supersedes the staged 0885-C / 0885-D-1..4 sub-ORCHs; staging notes must be archived not deleted

**Why this matters:** Per operator directive "do it all at once so we are done with it," ORCH-0891 absorbs the previously-staged ORCH-0885-C [Composer Tiptap swap] + ORCH-0885-D-1 [⌘K palette] + ORCH-0885-D-2 [Multi-select on orders] + ORCH-0885-D-3 [Right rail] + ORCH-0885-D-4 [Keyboard nav]. The first four are Marketing-related and in scope; D-2 (multi-select on event/orders) is NOT Marketing — it's Hub/Events scope.

**Implication for SPEC:** Be explicit about what 0891 absorbs vs leaves behind:
- ABSORBED: 0885-C (Tiptap composer) + 0885-D-1 (⌘K palette, scoped to Marketing surfaces) + 0885-D-3 (right rail, scoped to composer preview) + 0885-D-4 (keyboard nav, scoped to composer + ⌘K).
- NOT ABSORBED: 0885-B (Tier 2 master-detail in Hub/Events) — separate, Hub-scope; 0885-D-2 (multi-select on event/orders) — separate, Hub-scope.

**Classification:** 🔵 Observation — administrative clarity for orchestrator at CLOSE.

---

## Section 4 — Five-layer cross-check

| Layer | What it says about ORCH-0891 |
|---|---|
| **Docs** | Parent ORCH-0885 investigation queued 0885-C/D-1..4 as separate sub-ORCHs; operator now bundles them into 0891. ORCH-0889 implementation report explicitly named 0885-C as the canonical long-term composer fix. |
| **Schema** | NO database changes required. The body_html `data-size` attribute extension (HF-D) is a pure DOM/token convention change — no DB column changes. |
| **Code** | Wave-1 baseline is `richEditor.tsx` (393 lines, textarea + token-form chip injection). ORCH-0891 fully rewrites this file (Tiptap-backed, ~700 lines estimated) plus adds 6 new `.web.tsx` siblings (Sheet, ComposerCanvas, ComposerKeyboardShortcuts, TemplatePreviewDrawer, EventChipResizable, CommandPalette). |
| **Runtime** | Wave-1 produces a token-string body_html that round-trips through `htmlToTokenString` as a no-op. ORCH-0891 produces Tiptap JSONContent + canonical HTML; the same `htmlToTokenString` converts back to the token-string format. Server-side `marketing-send` reads the same token-string format. Backwards-compatible. |
| **Data** | Existing campaign drafts stored with `{{event:UUID}}` (no size suffix) default to `medium` when rendered. ORCH-0891 NEVER breaks legacy drafts. |

**Contradiction resolution:** zero contradictions. All five layers align with the parent investigation's framework decision (Tiptap + Radix + `.web.tsx` carve-outs).

---

## Section 5 — Blast radius

**Direct impact:** business-web wide-desktop (≥1024px) + business-web narrow (<1024px) + business-iOS + business-Android. ALL marketing routes on every business surface.

**Indirect impact (mobile-strand polish):** every Marketing list route's loading / empty / populated state animation; every Pressable haptic.

**Cross-surface impact:** ZERO consumer-app impact. ZERO buyer-anon impact. ZERO admin impact. ZERO native composer code changes (pell `.native.ts` untouched).

**Bundle-size impact:** +95–150 KB gz on web ONLY, gated by route-level code-splitting (composer route eager-loads its Tiptap chunk; other routes don't pay the cost).

**Cache impact:** ZERO query key changes. Token-string body_html format unchanged.

**Migration impact:** ZERO migrations. ONE backwards-compatible edge-function code change (`marketingEmailRender.ts` reads optional `|size` suffix on event tokens).

---

## Section 6 — Invariant violations + new invariants proposed

**Existing invariants preserved (must verify post-implementation):**
- Constitution #1..#14 — unchanged.
- I-DESKTOP-GATE-VIA-HOOK — every desktop branch reads `useResponsiveLayout()`.
- I-DISABLED-QUERY-IS-LOADING — preserved via shimmer skeleton patterns.
- I-STICKY-FOOTER-VIA-HOOK — preserved.
- I-RN-COLOR-FORMATS — all new RN colors hex/rgba/hsl.
- I-KEYBOARD-NEVER-BLOCKS-INPUT — mobile composer keyboard handling unchanged.
- I-TOAST-NEEDS-ABSOLUTE-WRAP — preserved.
- I-SUB-SHEET-INSIDE-PARENT — preserved on mobile; on web, RN Modal doesn't apply (Radix Dialog uses portals correctly).
- I-CROSS-SURFACE-IMPACT — ORCH-0891 SPEC §2 will declare all 5+2 surfaces.
- I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE — preserved.

**NEW invariants proposed (codify at CLOSE):**

| ID | Statement | Enforcement |
|---|---|---|
| **I-TIPTAP-WEB-ONLY** | Files importing `@tiptap/*` MUST live under `*.web.tsx` extension OR inside a Platform-gated dynamic import. Native bundles must never resolve a `@tiptap/*` package. | Strict-grep CI gate `orch-0891-no-tiptap-in-native-bundle.mjs` parallels existing `orch-0778-web-stripe-native-import-gate`. |
| **I-CHIP-DOM-CONTRACT** | Web composer chip DOM emission MUST match the class names + structure defined in `composerChipHtml.ts` (`mingla-event-chip` with `▣` glyph span, `mingla-personalization-chip`). | Strict-grep gate scans Tiptap node definitions for class name compliance. |
| **I-CHIP-BACKSPACE-VIA-DOM-HANDLER** | Chip atomic delete on web MUST use `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` verbatim — NOT Tiptap keymap reimplementation. | Strict-grep gate searches Tiptap node files for `addKeyboardShortcuts.*Backspace`. |
| **I-MARKETING-PERFORMANCE-BUDGET** | Marketing route bundle slices: composer ≤ 280 KB gz; other marketing routes ≤ 80 KB gz incremental over baseline. Drag-resize ≥60fps. Chip insert CLS = 0. ⌘K open ≤50ms. | Implementor reports + tester verifies via Chrome DevTools Performance recording. CI gate measures composer chunk size post-build. |
| **I-DESKTOP-MODAL-VIA-SHEET-WEB** | Sub-sheet → desktop modal conversion goes through `Sheet.web.tsx` Radix Dialog branch — NOT per-sheet bespoke Radix Dialog calls. DRY enforcement. | Code review at SPEC compliance; strict-grep gate optional. |

---

## Section 7 — Fix strategy (direction only — full contract in SPEC)

**ORCH-0891 ships in one PR per operator directive but the implementor work is staged in 3 internal milestones with mid-PR checkpoints:**

**Milestone M1 — Composer Tiptap web swap (week 1):** Replace Wave-1 textarea with Tiptap. Chip pills via Tiptap custom nodes with verbatim class-name parity. Backspace handler installed via DOM useEffect. B/I/Link toolbar. Keyboard shortcuts ⌘B / ⌘I / ⌘K. Subject row keeps current handling (no Tiptap on subject in M1; defer to M3 polish if needed). NO preview pane yet. NO right rail yet. **Checkpoint:** operator can author + send a chip-pill blast from web.

**Milestone M2 — Desktop layout primitives + power features (week 2):** Build `Sheet.web.tsx` (Radix Dialog branch). Build `ComposerCanvas.web.tsx` (side-by-side editor + preview). Build `TemplatePreviewDrawer.web.tsx` (right-rail drawer on desktop). Build `EventChipResizable.web.tsx` (drag-resize). Update `marketingEmailRender.ts` to honor `data-size`. Build `CommandPalette.web.tsx` (cmdk-based ⌘K). Wire ⌘Enter (send), ⌘P (preview toggle on mobile only — pane is permanent on desktop), ⌘D (templates), Esc (close any sheet). **Checkpoint:** operator can preview live + use shortcuts + drag-resize cards + open ⌘K.

**Milestone M3 — Mobile premium polish + performance contract (week 3):** `useShimmer` hook for animated skeletons. Motion micro-interactions on every Marketing surface (scale-on-press, fade-in on mount). Haptic on every Pressable (`Haptics.impactAsync(Light)` on tap). Empty-state illustration upgrade (designer-supplied SVGs). Send-confirmation premium animation (celebratory burst). Performance contract verification via Chrome DevTools recording + bundle-size assertion. **Checkpoint:** mobile feels premium; performance budget met.

**Operator may review at each checkpoint** without merging — implementor pushes to `Seth` branch, operator smoke-tests, implementor continues if approved. PR opens to `main` only after M3 completes.

---

## Section 8 — Regression prevention

**Per-milestone Step-0.5 regression tests (in addition to the 2 mandatory at CLOSE):**

| Milestone | Implementor happy-path test | Tester adversarial test |
|---|---|---|
| M1 | Tiptap web composer emits `mingla-event-chip` + `mingla-personalization-chip` DOM with correct class names. Token-string round-trip via `htmlToTokenString` produces byte-identical output to native pell's output for the same content. | Backspace at cursor-after-chip removes chip + trailing nbsp atomically in one keypress. |
| M2 | `Sheet.web.tsx` renders Radix Dialog on `isWideDesktop===true`; renders RN Sheet on `false`. `EventChipResizable` `data-size` attribute round-trips through `htmlToTokenString` extended regex. | `marketingEmailRender.ts` honors `data-size` on event tokens AND defaults legacy size-less tokens to `medium` (backwards-compat). |
| M3 | `useShimmer` hook returns animated opacity values; mobile haptic fires on every marketing Pressable. | Composer chunk size ≤ 280 KB gz post-build; drag-resize ≥60fps (10s recording, no frames below 16ms). |

---

## Section 9 — Discoveries for orchestrator

| # | Discovery | Action |
|---|---|---|
| **D-1** | The ONE server-side change (event chip `data-size` attribute in `marketingEmailRender.ts`) crosses the deploy gate. Operator must run `supabase functions deploy marketing-send` BEFORE the implementor's Tiptap composer ships drag-resize chips with new sizes — otherwise legacy renders ignore the size and send `medium` regardless. | SPEC §3 (server strand) flags this with explicit deploy-gate notes; orchestrator at CLOSE must verify deploy occurred before announcing the OTA bump. |
| **D-2** | ORCH-0890 [Web auth-bootstrap loading-state sweep] is still queued from ORCH-0889 close. ORCH-0891 does NOT absorb it — separate ORCH, separate PR, can run in parallel. | Orchestrator continues tracking ORCH-0890 separately. |
| **D-3** | The 4 desktop redesign HTML mocks do NOT cover composer specifically. Designer pre-flight via `/mingla-designer` is mandatory; SPEC §3 names the deliverables. | Operator dispatches `/mingla-designer` AFTER SPEC return, BEFORE implementor dispatch. |
| **D-4** | The `Sheet.web.tsx` primitive becomes a reusable asset for the future Hub Events / Trips desktop polish (ORCH-0885-B). 0891 builds it for Marketing; 0885-B inherits it for free. | Document in DECISION_LOG at CLOSE so the orchestrator can reference at 0885-B SPEC time. |
| **D-5** | Tiptap is the editor; the AST bridge `tenTapTokenBridge.ts` becomes the canonical web/native bridge. Future composer enhancements (collaborative editing, AI assist, version history) all flow through this single bridge. | DECISION_LOG entry at CLOSE. |
| **D-6** | Bundle-size budget is now codified at the SPEC level. Future Marketing additions (e.g., A/B-test split-test editor) must respect the budget or open a budget-revision ORCH. | New invariant I-MARKETING-PERFORMANCE-BUDGET enforces. |
| **D-7** | Mobile-strand polish (empty-state illustrations, send-confirmation animation) is the work most likely to need designer iteration. Operator should reserve 2-3 days of designer bandwidth for M3. | Calendaring note for operator. |

---

## Section 10 — Confidence

| Finding | Confidence | Evidence floor |
|---|---|---|
| HF-A (Chip CSS already defined) | **proven** | File read end-to-end; CSS string is verbatim in source. |
| HF-B (Backspace handler library-agnostic) | **proven** | File read; handler is pure DOM `document.addEventListener`. |
| HF-C (EmailPreviewPane self-contained) | **proven** | File read; component contract documented in prop interface. |
| CF-A (Sheet primitive unification path) | **probable** | Three of four consumers use `<Sheet>`; fourth uses Modal; conversion path is sound but not implementor-verified yet. |
| HF-D (drag-resize needs server touch) | **probable** | Source-grep of `tenTapTokenBridge.ts` + `composerChipHtml.ts` confirms size attribute is absent; server-side render touch confirmed by reference to `marketingEmailRender.ts` but file not fully read end-to-end this turn. |
| HF-E (bundle-size impact) | **probable** | Per-library sizes are public; total is arithmetic; route-level code-splitting effectiveness on Expo Router static export is implementor-verifiable. |
| CF-B (performance thresholds) | **probable** | Industry-standard web performance targets; achievable with modern stack. |
| HF-F (mobile polish wider than spec template) | **proven** | Per-surface scope enumeration confirms ≥6 distinct workstreams. |
| OB-A (mocks lack composer specifics) | **proven** | All 4 mocks read; none show composer. |
| OB-B (absorption + non-absorption clarity) | **proven** | Parent investigation §Section E enumerates the sub-ORCHs; cross-referenced against operator scope. |

---

## Section 11 — Layman summary

- We have everything we need to build the premium composer + desktop power features in one bundled SPEC. The parent ORCH-0885 investigation already proved every architectural decision (Tiptap on web carve-out, Radix UI for desktop modals, cmdk for the ⌘K palette, the `.web.tsx` Metro pattern we've already used three times in production). This supplement only adds the discoveries that emerged when I re-read the manifest knowing we'd be bundling everything.
- The big insight: the chip pill visuals + the atomic backspace handler + the live preview pane are ALL already built. The chip CSS is verbatim in `composerChipHtml.ts`; the backspace handler is a pure DOM script that works on any contenteditable; the preview pane is a self-contained React Native component that just needs to mount in a different layout slot on desktop. So Tiptap's job is much narrower than "build a rich text editor from scratch" — it's "render Tiptap nodes with the existing class names and bridge the AST." That cuts the work materially.
- One small server-side touch is needed: the `marketing-send` edge function needs to honor a new `data-size` attribute on event chips so drag-resize actually changes the email rendering. The change is ~30 lines and backwards-compatible (legacy chips default to medium).
- Bundle size: adding Tiptap + Radix + cmdk + Floating UI is +95-150 KB gzipped on the WEB bundle only. We code-split the composer route so users pay that cost only when they open the composer.
- Mobile polish strand is wider than I initially thought — shimmer skeletons, motion micro-interactions, haptics on every CTA, empty-state illustration upgrade, send-confirmation premium animation. The SPEC will dedicate its own section to this strand because the designer needs to produce illustrations and motion specs before code starts.
- One designer pre-flight pass is non-negotiable BEFORE implementor dispatch. The HTML mocks cover the rail/canvas/master-detail/⌘K/right-rail aesthetic but do NOT cover the composer specifically. Designer needs to produce composer canvas at multiple viewport widths, toolbar visual treatment, template drawer right-rail width, drag-resize handle aesthetic, send-confirmation animation spec, and the 3 missing empty-state illustrations.
- The implementor's work staged into 3 internal milestones (week 1: composer Tiptap swap; week 2: layout primitives + power features; week 3: mobile polish + performance contract). Operator can checkpoint review at each milestone without breaking the one-PR-per-CLOSE rule — the implementor pushes to Seth branch and only opens the PR after M3 completes.
- 5 new invariants codified at CLOSE: I-TIPTAP-WEB-ONLY (no Tiptap in native bundle), I-CHIP-DOM-CONTRACT (Tiptap nodes match existing class names), I-CHIP-BACKSPACE-VIA-DOM-HANDLER (don't reinvent atomic delete), I-MARKETING-PERFORMANCE-BUDGET (composer ≤280 KB gz, drag ≥60fps, etc.), I-DESKTOP-MODAL-VIA-SHEET-WEB (Sheet.web.tsx is the canonical desktop-modal primitive).

---

**Report status:** COMPLETE. Supplementary investigation. SPEC authored separately at [`Mingla_Artifacts/specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md`](../specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md).
