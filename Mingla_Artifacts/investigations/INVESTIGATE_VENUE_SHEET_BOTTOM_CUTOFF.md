# INVESTIGATE — Venue action sheets cut off at the bottom (business app + business web-mobile)

**Mode:** INVESTIGATE (read-only; no fix proposed beyond a recommended strategy).
**Date:** 2026-06-21
**Surfaces reported broken (Seth):** Business native app (iOS/Android) AND business web on mobile.
**Symptom:** The venue action sheets — "Add table", "New reservation", "Add to waitlist",
"Add a category" / menu-item sheet, blackout/closed-dates sheet — open with the bottom of the
sheet content / their primary CTA button clipped off-screen and unreachable.

**Confidence:** root cause **probable** (proven by static analysis + sibling-convention diff +
the standing keyboard invariant; not yet live-fired on the sim/device this pass — see Repro).

---

## A. PROVEN ROOT CAUSE

There are **two compounding mechanisms**, both living in the venue sheet **consumers**, not in the
shared `Sheet` primitive. The primitive is correct; the venue sheets use it wrong.

### F-1 — PRIMARY: the body `ScrollView` has no `flex: 1` on its `style`, so it is not height-bounded and overflows the panel (CONFIRMED ROOT CAUSE)

- **Symptom:** content/CTA below the fold is clipped and cannot be scrolled to.
- **Layer:** code (component).
- **Probe:** read the 6 venue sheets + the shared primitive; diffed against known-good sheets
  (`RefundSheet`, `DoorSaleNewSheet`, `AddCompGuestSheet`).
- **Evidence (verbatim):**
  - Shared primitive `mingla-business/src/components/ui/SheetMobile.tsx`:
    - Panel height is FIXED: `sheetHeight = screenHeight * SNAP_RATIOS[snapPoint]` (lines 187–208),
      anchored `bottom: 0` (`styles.bottomDock`, lines 668–673), `styles.panel` has
      `overflow: "hidden"` (line 680).
    - The inner content host is `flex: 1` with a bottom safe-area pad:
      `<View style={[styles.body, { paddingBottom: spacing.lg + bottomInset }]}>` (line 463;
      `styles.body = { flex: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.lg }`,
      lines 703–707).
  - Venue sheet `mingla-business/src/components/venue/VenueTableSheet.tsx`:
    - `import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";` (line 11) — **plain RN ScrollView**.
    - `<View style={styles.body}>` where `styles.body = { flex: 1, paddingHorizontal, paddingTop }` (lines 185, 431–435).
    - `<ScrollView contentContainerStyle={styles.scroll} ...>` (line 187) — **NO `style=` prop**, i.e. no `flex: 1` on the scroll view's own box.
    - `styles.scroll = { paddingBottom: spacing.xxl, gap: spacing.xs }` (lines 441–444) — used ONLY as `contentContainerStyle`.
    - The Save / Delete buttons are the LAST children INSIDE the ScrollView (lines 299–323).
  - Known-good contrast — `mingla-business/src/components/orders/RefundSheet.tsx`:
    - `import { ScrollView } from "../../wrappers/SmartScrollView";` (line 32).
    - `<ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} ...>` (lines 258–260) where `styles.scroll = { flex: 1, marginBottom: spacing.md }` (lines 465–468).
    - Same `flex: 1` scroll style in `DoorSaleNewSheet.tsx` (634–637) and `AddCompGuestSheet.tsx` (458–461).
- **Mechanism:** In a flex-column parent, a React Native `ScrollView` whose **outer `style`** has
  no `flex: 1` (and no fixed height) sizes itself to its content's intrinsic height rather than to
  the bounded space the panel gives it. With more content than the panel's fixed
  `screenHeight * 0.9` height, the ScrollView grows past the panel bottom; the panel's
  `overflow: "hidden"` clips the overflow, and because the ScrollView's own viewport is not smaller
  than its content there is nothing to scroll — the CTA at the bottom is permanently off-screen.
  The known-good sheets avoid this by putting `flex: 1` on the ScrollView's `style`, which bounds
  the scroll viewport to the panel and makes the content scroll inside it.

### F-2 — SECONDARY (compounding): plain RN ScrollView + no SmartScrollView means the keyboard pushes the CTA further behind the keyboard + 42dp Done bar (SECONDARY ROOT CAUSE)

- **Symptom:** when an input is focused, the bottom of the form (and the CTA) is hidden behind the
  keyboard and the app-wide "Done" accessory bar — worsening the cutoff.
- **Layer:** code (component) vs invariant.
- **Probe:** read `SheetMobile.tsx` keyboard comments + `SmartScrollView.native.tsx` +
  `INVARIANT_REGISTRY.md`.
- **Evidence (verbatim):**
  - `SheetMobile.tsx` lines 196–204: "Sheet primitive no longer owns keyboard handling… Sheet
    consumers with TextInputs use SmartScrollView for their internal body ScrollView — KAS
    scrolls the focused input above the keyboard within that consumer's own scrollable."
  - `mingla-business/src/wrappers/SmartScrollView.native.tsx` line 31:
    `export const DEFAULT_BOTTOM_OFFSET = 54; // 12 clearance + 42 KEYBOARD_TOOLBAR_HEIGHT`.
  - `Mingla_Artifacts/INVARIANT_REGISTRY.md` `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE (ACTIVE)`
    (line 55): every keyboard-bearing surface must add ≥42dp clearance on the keyboard-open branch.
  - The venue sheets import ScrollView from `react-native` (not the wrapper) and add NO keyboard
    padding at all — so focused inputs and the CTA are occluded by the keyboard + Done bar.
- **Mechanism:** Because the venue sheets bypass SmartScrollView, the focused field is never
  worklet-scrolled above the keyboard, and the venue sheets (unlike `JoinWaitlistSheet`, which adds
  `keyboardPadding + spacing.lg + 42`) add no keyboard padding — so any input low in the form, plus
  the CTA below it, sits behind the keyboard/Done bar. This is the form of the cutoff Seth hits the
  moment he taps a field. It is a standing-invariant violation, independent of F-1.

### Why it happens on web-mobile too (same root cause, no separate bug)

- Narrow web (<1024px) resolves `Sheet` → `Sheet.web.tsx` → `MobileSheet` (the same
  `SheetMobile.tsx` `SheetWeb` branch), which uses the **same fixed-height panel + `flex: 1` body +
  `SheetMobilePanelInner`** (lines 514–662). The venue sheet body (plain ScrollView, no `flex: 1`)
  is identical. On RN-web a `ScrollView` with no `flex`/height renders a `div` that grows to content
  height; inside the fixed-height, `overflow: hidden` panel the bottom is clipped exactly as on
  native. So F-1 reproduces on web-mobile with no web-specific cause needed. (`useSafeAreaInsets`
  returns 0 on web, so the bottom pad is just `spacing.lg`; F-2's keyboard angle does not apply on
  desktop browsers, but mobile-web soft keyboards can still shrink the visual viewport — a minor
  add-on, not the primary cause.)

**Net:** The shared `Sheet` primitive is sound (fixed panel height + flex body + bottom-inset pad).
The venue sheets are the defect: they (a) omit `flex: 1` on the ScrollView's `style` (F-1, the
always-on cutoff) and (b) bypass SmartScrollView / add no keyboard padding (F-2, the keyboard-open
worsening). The known-good business sheets do both correctly — this is a **consumer-convention
deviation**, not a primitive bug.

---

## B. BLAST RADIUS

### Affected — mingla-business (8 files; same flawed pattern: plain RN ScrollView, no `flex:1` on `style`, CTA inside the scroll)

| File | ScrollView import | `<ScrollView>` (no `flex:1` style) | CTA inside scroll | Notes |
|------|-------------------|-------------------------------------|-------------------|-------|
| `mingla-business/src/components/venue/VenueTableSheet.tsx` | RN, L11 | L187 | Save/Delete L299–323 | snap 0.9 — **reported** |
| `mingla-business/src/components/venue/ReservationCreateSheet.tsx` | RN, L13 | L175 | Create L389 | snap 0.92 — **reported** |
| `mingla-business/src/components/venue/WaitlistAddSheet.tsx` | RN, L10 | L95 | Add L180 | snap 0.8 — **reported** |
| `mingla-business/src/components/venue/MenuItemSheet.tsx` | RN, L13 | L130 | Save/Delete L178–202 | snap 0.9 — **reported (menu item)** |
| `mingla-business/src/components/venue/MenuCategorySheet.tsx` | RN, L11 | L96 | Save/Delete L120–144 | "Add a category" — **reported** |
| `mingla-business/src/components/venue/VenueBlackoutSheet.tsx` | RN, L11 | L131 | Save/Remove L250–271 | snap 0.75 — venue closed-dates |
| `mingla-business/src/components/event/CreatorStep2WhenRepeatPickerSheet.tsx` | RN, L15 | L101 | "Done" L239–246 | event wizard repeat picker (adjacent, latent) |
| `mingla-business/src/components/event/PublishErrorsSheet.tsx` | RN, L11 | L52 | (no CTA; list overflow) | lower risk — read-only error list still overflows on tall lists |

The 6 venue sheets are exactly Seth's report. The 2 event sheets are the same latent bug elsewhere
in the business app (fix them in the same pass to avoid a re-report).

### Safe — mingla-business (do NOT touch; reference patterns)

- SmartScrollView + `flex:1` style: `RefundSheet`, `DoorSaleNewSheet`, `AddCompGuestSheet`,
  `TicketTierEditSheet`, `RefundPreviewSheet`, `MultiDateOverrideSheet`, `BrandDeleteSheet`,
  `BrandStripeDetachConfirmSheet`, `VenueClaimFeedbackSheet`.
- Fixed footer / Button outside the scroll: `BrandSwitcherSheet` (Button outside; `scrollArea: {flex:1}`).
- No ScrollView (content-fit / dynamic keyboard padding): `JoinWaitlistSheet` (adds
  `keyboardPadding + spacing.lg + 42`), `OfferingManageSheet` (short action list, no scroll).

### Safe — app-mobile consumer (ZERO affected)

- `app-mobile/src/components/ui/BaseBottomSheet.tsx` is a different primitive (wraps
  `@gorhom/bottom-sheet`). It provides built-in scroll modes (`scroll`/`flatlist`/`sectionlist`
  via `BottomSheetScrollView`/`FlatList`/`SectionList`, gorhom-coordinate-aware, bounded by the
  measured draggable viewport) AND applies `withBottomInset()` → `paddingBottom = max(existing,
  safeBottomInset + tabBarExtra)` to the content container. CTA clipping is structurally prevented
  (and `TicketCartSheet` uses a `stickyFooter`). Consumer sheets are NOT in the blast radius.

**Single point of fix?** Partially. The defect is in the consumers, not the primitive — so a pure
primitive patch cannot fix it without changing how children are composed. BUT the fix is a single,
identical 2-line change repeated across the 8 files (see C). It is NOT a single shared-component
edit; it is a consumer sweep with one canonical pattern.

---

## C. RECOMMENDED FIX-ALL STRATEGY (direction only — not a spec, not code)

**Recommended approach: a consumer sweep applying the existing canonical pattern, NOT a primitive
rewrite.** The shared `Sheet` primitive is correct and is depended on by ~40 sheets; changing its
height/flex semantics risks regressing every safe consumer. The clean, low-risk fix is to make the
8 affected sheets match the already-proven `RefundSheet`/`DoorSaleNewSheet` convention:

1. **Bound the scroll viewport (fixes F-1 — the always-on cutoff):** give each affected
   `<ScrollView>` an outer `style={{ flex: 1 }}` (or a dedicated `scroll` style with `flex: 1`),
   keeping the existing `contentContainerStyle` (`paddingBottom: spacing.xxl`) for breathing room.
   This is the minimal change that makes the CTA scrollable into view on native and web-mobile.
2. **Use SmartScrollView (fixes F-2 — keyboard occlusion + satisfies the ACTIVE invariant):** swap
   `import { ScrollView } from "react-native"` → `import { ScrollView } from
   "../../wrappers/SmartScrollView"` on the body ScrollView (its default `bottomOffset = 54`
   already clears the 42dp Done bar + 12dp). This brings the venue sheets into compliance with
   `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` like every other text-input business sheet. (Keep
   horizontal pill ScrollViews — e.g. the ReservationCreateSheet date row at L213 — as plain RN
   `ScrollView`; only the vertical BODY scroll should become SmartScrollView.)

Both changes together are the established convention; doing only #1 leaves the keyboard-open
worsening (F-2 / invariant violation). Doing both makes the venue sheets byte-pattern-identical to
the known-good sheets.

**Per-sheet exceptions:**
- `PublishErrorsSheet.tsx`: read-only, no text inputs → only step #1 (bound the scroll) is needed;
  SmartScrollView is harmless but unnecessary.
- `ReservationCreateSheet.tsx`: has a nested HORIZONTAL date ScrollView (L213) — leave that one
  plain RN; only convert the outer vertical body ScrollView.
- `CreatorStep2WhenRepeatPickerSheet.tsx` (event wizard) and the menu sheets: same 2-line pattern.

**Cross-surface deltas:** native vs web-mobile share `SheetMobile.tsx`, so the same `flex: 1` fix
resolves both. SmartScrollView is `KeyboardAwareScrollView` on native and a passthrough on web
(no soft-keyboard model on desktop), so the swap is safe on both. No app-mobile changes needed.

**Regression risks / guards:**
- Do NOT alter `SheetMobile.tsx` panel height or body flex — it would ripple to ~40 safe sheets.
- Adding `flex: 1` to a ScrollView that previously content-sized could change visual height on very
  SHORT forms (the scroll box now fills the 0.8–0.92 panel rather than hugging content). This is the
  same behavior the known-good sheets already have and is acceptable (the panel height is fixed by
  snapPoint regardless), but eyeball each sheet at minimal content.
- A fails-on-revert guard should assert, per affected file, that the body ScrollView has `flex: 1`
  on its style AND (for input-bearing sheets) is imported from `wrappers/SmartScrollView` — mirror
  `orch-1165-keyboard-toolbar-clearance` / the `orch-0892-no-bespoke-keyboard-plumbing` gate style.
- OTA NOTE (COMMS-0052, BLOCK): business-app OTA is currently frozen until a new native build ships
  (posthog-react-native hard import). This fix is pure-JS but cannot be OTA'd to prod until that
  build lands; it ships with the next business native build. (Acknowledged below.)

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| Docs | `SheetMobile.tsx` header + ORCH-0892-B v2 comments: consumers own their keyboard scroll via SmartScrollView. Venue sheets do not — doc/code contradiction = the bug. |
| Schema | N/A (pure UI). |
| Code | Primitive correct (fixed panel + flex body + bottom inset). Consumers wrong (plain ScrollView, no `flex:1`, no SmartScrollView). |
| Runtime | Not live-fired this pass (see Repro). Mechanism derived from layout semantics + sibling diff. |
| Data | N/A. |

Contradiction flagged: the ACTIVE invariant `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` is violated by
all 6 venue sheets (and the 2 event sheets) — they should have been caught by the keyboard sweep but
were authored under META-ORCH-1148/ORCH-1186 with plain ScrollViews.

## Repro evidence

NOT live-fired on simulator/device this pass (read-only static investigation as dispatched —
"research only … NOT code changes"). Confidence is therefore **probable**, capped by the absence of
a sim repro per Prime Directive 7. The mechanism is proven by: (a) the fixed-height +
`overflow:hidden` panel in `SheetMobile.tsx`, (b) the missing `flex:1` on the venue ScrollView
`style` vs the present `flex:1` on every known-good sheet, and (c) the ACTIVE keyboard-clearance
invariant the venue sheets violate. To upgrade to `proven`: boot the business sim, open Add-table /
New-reservation on a small viewport (or with the keyboard up), and confirm the CTA is unreachable;
then confirm the `flex:1` + SmartScrollView change makes it scrollable.

## Discoveries for orchestrator

- DISC: `CreatorStep2WhenRepeatPickerSheet.tsx` + `PublishErrorsSheet.tsx` carry the same latent
  cutoff outside the venue suite — fold into the same fix to prevent a future re-report.
- DISC: consider extending the strict-grep keyboard gate to assert "any `<Sheet>` consumer with a
  vertical body `ScrollView` must import it from `wrappers/SmartScrollView` and set `flex:1`" so this
  class can't be reintroduced.

## COMMS-ledger acks

Read `COMMS_LEDGER.md` on entry. Relevant rows are WARN/FYI/BLOCK-but-already-acked-by-others; none
require this investigation to STOP. Noted: **COMMS-0052 (BLOCK)** — business-app OTA is frozen until
the next native build (posthog hard import); any fix to these sheets is pure-JS but ships with that
build, not via OTA. Factored into the fix-strategy OTA note above.

## Recommended next phase

SPEC the 8-file consumer sweep (2-line canonical pattern per file + per-file exceptions + a
fails-on-revert strict-grep guard), then IMPLEMENT, then TEST with a live sim repro (boot business
app, open each venue sheet at small viewport + keyboard-open, confirm CTA reachable). No primitive
edit; no app-mobile edit.
