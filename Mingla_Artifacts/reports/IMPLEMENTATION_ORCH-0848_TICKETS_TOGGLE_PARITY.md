# IMPLEMENTATION REPORT — ORCH-0848 [Tickets-section toggle parity with Active accordion]

**Status:** implemented and verified
**Branch:** `Seth`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main`
**Spec / dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0848_TICKETS_TOGGLE_PARITY.md`

## Summary (layman terms)

In the Mingla mobile app, on the Likes → Calendar tab, the "Tickets" section above the "Active" list was a flat block — always expanded, no toggle. Now it has the same chevron + count header as Active and Archive, taps to collapse and re-expand, and stays hidden entirely if you have no tickets. No change to what tickets appear or how each ticket row looks — only the section header behaviour.

## Files changed

### `app-mobile/src/components/activity/CalendarTab.tsx`

**What it did before:**
- Initial `expandedAccordionItems` state seeded with `["active"]`.
- Tickets section rendered inside `<View style={styles.businessEventSection}><View style={styles.businessEventHeader}>…</View>{rows}</View>` — non-tappable, no chevron, always expanded when `businessOrders.length > 0`.
- Styles `businessEventSection` and `businessEventHeader` defined in the StyleSheet block and used only at this one site.

**What it does now:**
- Initial state seeded with `["tickets", "active"]` so Tickets defaults to expanded (matches prior always-expanded behaviour on first paint).
- Tickets section now uses `<TouchableOpacity style={styles.accordionHeader}>` + `accordionTitleContainer` + `accordionTitle` + `accordionCount` + chevron Icon — exact mirror of the Active and Archive accordion headers at lines 1788-1839 and 1841-1888.
- Header `onPress` toggles `"tickets"` membership in `expandedAccordionItems`.
- Chevron switches between `chevron-down` (expanded) and `chevron-forward` (collapsed), `size={20}`, `color="#9ca3af"` — identical to Active/Archive.
- Body rows wrapped in `<View style={styles.accordionContentContainer}>` and gated on `expandedAccordionItems.includes("tickets")`.
- Outer `businessOrders.length > 0 && (…)` guard preserved — empty Tickets section still fully hidden (no empty accordion shell).
- Dead `businessEventSection` and `businessEventHeader` style definitions removed (subtract-before-adding; only consumer was this site).

**Why:** ORCH-0848 dispatch — operator asked the Tickets header to match the Active accordion's toggle design.

**Lines changed:** ~50 lines (state init: 1 line; section JSX: ~25 lines replaced with ~45 lines; StyleSheet: ~15 lines removed).

## Spec traceability

| Success criterion | Verification |
|---|---|
| Tickets header tappable + chevron + defaults expanded | PASS — regression S-01 + S-02 + S-05 |
| Toggling Tickets does not affect Active/Archive | PASS — toggle scoped to `"tickets"` key only (S-03); other handlers untouched |
| Empty `businessOrders` → no Tickets header | PASS — outer `businessOrders.length > 0` guard preserved (S-06) |
| Visual diff vs Active header: identical styles/chevron/count format | PASS — uses the exact same style references (`styles.accordionHeader`, `styles.accordionTitleContainer`, `styles.accordionTitle`, `styles.accordionCount`) and identical Icon props |
| TypeScript clean | PASS — `npx tsc --noEmit` shows zero new errors at CalendarTab.tsx (pre-existing errors in other files unrelated) |
| Regression test with fails-on-revert | PASS — see Regression Test section below |

## Invariant verification

- I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS: preserved — `useBusinessEventOrders` flow untouched, data source identical.
- React Query / Zustand boundaries: not touched (this is a presentation-only change).
- No silent failures: no try/catch added or modified.
- All states (loading/error/empty/populated): the empty path is `businessOrders.length === 0` → section fully hidden, which matches prior behaviour and is the intended UX (no empty accordion).

## Parity check

Not applicable — Tickets section is consumer-only (no business-app or solo/collab parallel surface).

## Cache safety

No query keys, no mutations, no Zustand keys touched. Cache state is unaffected.

## Regression surface

Tester should verify these adjacent behaviours did not regress:
1. Active accordion header still toggles independently.
2. Archive accordion header still toggles independently.
3. Filter bar (`CardFilterBar`) above the Tickets section still applies to Active/Archive entries (it never applied to Tickets and still doesn't).
4. `BusinessEventCalendarRow` opens the expanded ticket sheet correctly when tapped (touch event still propagates through `accordionContentContainer`).
5. First paint with non-empty `businessOrders` shows Tickets expanded (state default `["tickets", "active"]`).

## Regression Test

- **Path:** `app-mobile/scripts/ci/orch-0848-regression-check.mjs`
- **npm script:** `npm run test:orch-0848` (registered in `app-mobile/package.json`)
- **Run on fix:** 7/7 PASS.
- **fails-on-revert verified at `4a0b4b5cab2273a09123141c29a1fa58823720a2`** — with `app-mobile/src/components/activity/CalendarTab.tsx` reverted via `git stash`, the check reported 6/7 FAIL (only S-06 which asserts the unchanged `businessOrders.length > 0` guard still passed). After `git stash pop` the check returned to 7/7 PASS.

Coverage angles (source-level structural — JSX has no exportable pure-data seam):
- S-01: initial state seeded with `["tickets", "active"]`
- S-02: Tickets header is a `TouchableOpacity` with `styles.accordionHeader`
- S-03: onPress toggles `"tickets"` in `expandedAccordionItems`
- S-04: body gated on `expandedAccordionItems.includes("tickets")` — **fails-on-revert key**
- S-05: chevron flips on `expandedAccordionItems.includes("tickets")`
- S-06: outer `businessOrders.length > 0` guard preserved
- S-07: dead `businessEventSection` / `businessEventHeader` styles removed

The tester will add an adversarial second test from a different angle per CLOSE Step 0.5.

## Constitutional compliance

- No dead taps — header has `activeOpacity={0.7}` + functional onPress.
- One owner per truth — `expandedAccordionItems` is the single state authority for accordion expansion across all three sections.
- No silent failures — none introduced.
- One query key per entity — unaffected.
- Server state stays server-side — unaffected.
- Subtract before adding — dead styles removed; outer wrapper View collapsed into Fragment.
- No fabricated data — header count derived from `businessOrders.length`.

## Deno gate

Not applicable — no edge function code changed.

## Discoveries for orchestrator

- ORCH-0842 [Tickets-into-Active + PDF sheet] investigation proposes merging tickets into the Active accordion entirely. ORCH-0848 is a lighter interim. If ORCH-0842 ships later, ORCH-0848's `"tickets"` accordion key and gated rendering become removable — the Tickets section disappears as a standalone unit. Flag for orchestrator: 0848 does NOT block 0842.
- No other side issues observed.

## Migrations / deploys

None — pure mobile-side presentation change. No `supabase db push`, no edge function deploy.

## Working-branch discipline

- Edits applied directly to `Seth` at `/Users/sethogieva/Desktop/mingla-main`.
- Scoped files: `app-mobile/src/components/activity/CalendarTab.tsx`, `app-mobile/scripts/ci/orch-0848-regression-check.mjs`, `app-mobile/package.json`, this report.
- No unrelated files staged.
