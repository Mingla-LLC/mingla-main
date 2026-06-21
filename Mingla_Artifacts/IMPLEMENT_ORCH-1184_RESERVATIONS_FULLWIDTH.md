# IMPLEMENT — ORCH-1184 — reservations command-center desktop: bare rail + full-width workspace

**Status:** implemented and verified (jest + typecheck green; fails-on-revert proven).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1184-[reservations-cmd-fullwidth]/`
**Branch:** `ORCH-1184-reservations-cmd-fullwidth` (off origin/main HEAD `2be6d277d`).
**Surface:** Business desktop-web ONLY (`isWideDesktop` branch). Native iOS/Android + web-phone path byte-unchanged.

---

## 1. Summary

The business-app Venue command-center desktop layout got two surgical layout fixes:

1. **Bare rail.** The left rail no longer shows the grey uppercase "Command" and "Booking" section captions. It now reads as one clean, uniformly-spaced list: Overview, Tables, Availability, Reservations, Waitlist, Settings. Item order, routing, and active-state are 100% unchanged.
2. **Full-width workspace.** The two-column block (rail + workspace) no longer stops at 1200px on wide monitors. It now fills the full page width, keeping the left anchor and the left/right edge gutters. The fixed-width rail stays put; the `flex:1` workspace absorbs the extra width, so settings cards get wider and the dead right-side canvas / "black bar" Seth flagged is eliminated.

Two files changed: the in-scope `VenueSuiteShell.tsx`, plus the authorized dead-constant removal of `venueSuiteMaxWidth` in `designSystem.ts` (the contract explicitly permits removing the constant + its definition/import once unused).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied by |
|----|-----------|--------|--------------|
| SC-1 | Remove BOTH rail caption labels ("Command" / "Booking") | ✓ | `VenueSuiteShell.tsx` `DesktopRail` render — both `<Text style={styles.railSection}>` nodes deleted (commit below) |
| SC-2 | Menu items, order, routing, active-state 100% unchanged | ✓ | `renderRow` + `orderedCommandTop` / `booking` / `orderedCommandBottom` map order untouched; `deriveVenueModules` source of truth unchanged; regression test asserts the six-label order |
| SC-3 | List reads as ONE list; collapse orphaned caption gap; uniform spacing | ✓ | Captions deleted → their `paddingTop: spacing.md` gone; `railInner` `gap: spacing.xxs` now applies evenly between all rows |
| SC-4 | Remove unused `railSection` style; verify no other consumer | ✓ | `railSection` style object deleted; `grep railSection` → 0 hits repo-wide (only the now-removed lines) |
| SC-5 | `desktopCentered` no longer caps at `maxWidth` (fills page width) | ✓ | `maxWidth: venueSuiteMaxWidth` line removed from `desktopCentered` |
| SC-6 | KEEP `paddingHorizontal: spacing.md` gutters + KEEP left anchor | ✓ | `alignSelf: "flex-start"` + `paddingHorizontal: spacing.md` retained (asserted by regression test) |
| SC-7 | Remove `venueSuiteMaxWidth` constant if unused (import + definition) | ✓ | Import removed from `VenueSuiteShell.tsx`; `export const venueSuiteMaxWidth` removed from `designSystem.ts`; `grep` → only comment mentions remain |
| SC-8 | Workspace ScrollView + cards fill with no horizontal overflow | ✓ (source-verified) | `desktopWorkspace` is `flex:1`; rail fixed `venueRailWidth`; row container `width:"100%"` with no `maxWidth` → no overflow possible. Runtime eyeball deferred to Seth (see §9). |
| SC-9 | Native / narrow path byte-unchanged | ✓ | `git diff` shows no change to `phoneHost` / `phoneScroll` / `venue-suite-shell-phone` branch or styles (§8) |
| SC-10 | Regression test, fails-on-revert proven | ✓ | `venueSuiteShell.orch1184.fullwidth.test.ts` (§6) |

---

## 3. Files changed

| File | +/- | Nature |
|------|-----|--------|
| `mingla-business/src/components/venue/VenueSuiteShell.tsx` | +20 / −24 (net −4 code; comments rewritten) | In-scope: rail captions removed, `railSection` style removed, `maxWidth` removed, import removed, doc comments updated |
| `mingla-business/src/constants/designSystem.ts` | +6 / −7 | Authorized dead-constant removal: `venueSuiteMaxWidth` definition deleted, doc comment updated |
| `mingla-business/src/components/venue/__tests__/venueSuiteShell.orch1184.fullwidth.test.ts` | +130 (new) | Implementor regression test (append-only) |

---

## 4. Data-model changes applied

None. Pure desktop-web layout change. No migration, no RLS, no schema.

## 5. Edge functions touched

None.

---

## 6. Regression test

**Path:** `mingla-business/src/components/venue/__tests__/venueSuiteShell.orch1184.fullwidth.test.ts`
**Type:** happy-path, append-only (new file; no existing test modified/deleted).
**Runner:** default `jest.config.cjs` (node / ts-jest) — no RTL needed; reads the real `VenueSuiteShell.tsx` source as text + imports the real `deriveVenueModules` / `VENUE_MODULES` registry.

It asserts BOTH contract facts:
1. **Change 1** — no `styles.railSection` element/style anywhere; neither `<Text style={styles.railSection}>Command</Text>` nor `…>Booking</Text>` is rendered; the `railSection` style object is gone; AND all six items still derive in order (`["Overview","Tables","Availability","Reservations","Waitlist","Settings"]`).
2. **Change 2** — the isolated `desktopCentered` style block (comments stripped) has NO `maxWidth:` key and no `venueSuiteMaxWidth` import; AND it KEEPS `alignSelf: "flex-start"` + `paddingHorizontal: spacing.md`.

**Passing run (fix in place):**
```
PASS src/components/venue/__tests__/venueSuiteShell.orch1184.fullwidth.test.ts
PASS src/components/venue/__tests__/venueModules.test.ts
Tests:       9 passed, 9 total
```

**Fails-on-revert proof (TRUE LINE DELETION, not comment-out):** I re-added the two `<Text style={styles.railSection}>` captions + the `booking.length > 0` fragment, restored the `railSection` style object, and restored `maxWidth: venueSuiteMaxWidth` + its import — then ran the test:
```
Tests:       3 failed, 2 passed, 5 total
  ✗ the rail renders NO `railSection` caption element
  ✗ the `railSection` style object is removed (dead-style cleanup)
  ✗ `desktopCentered` no longer caps width at 1200px (no maxWidth)
```
RED confirmed. I then restored the fix from a backup and re-ran → 9/9 GREEN.

`fails-on-revert verified at 2be6d277d4028299dcde4c0d24541ebd8b319d92` (the worktree HEAD the revert was performed against; the fix-commit hash is recorded in the chat summary).

---

## 7. Old → New receipts

### VenueSuiteShell.tsx — `DesktopRail` render
**Before:** rendered `<Text style={styles.railSection}>Command</Text>`, then Overview, then (if booking modules) `<Text style={styles.railSection}>Booking</Text>` + booking rows, then Settings.
**After:** renders Overview, booking rows, Settings — no captions. Band grouping still drives ORDER (Overview first, booking band, Settings last) via the unchanged `orderedCommandTop` / `booking` / `orderedCommandBottom` arrays.
**Why:** SC-1/SC-2/SC-3 — bare clean list, order preserved.
**Lines:** ~6 removed.

### VenueSuiteShell.tsx — `styles.railInner` / `styles.railSection`
**Before:** `railSection` style (labelCap, tertiary color, `paddingTop: spacing.md`) created a top gap before each caption, opening a band-gap between the Overview group and the booking band.
**After:** `railSection` deleted entirely; `railInner`'s `gap: spacing.xxs` now applies uniformly between all rows (no orphaned gap).
**Why:** SC-3/SC-4 — uniform spacing + dead-style cleanup (subtract-before-add).
**Lines:** ~8 removed.

### VenueSuiteShell.tsx — `styles.desktopCentered`
**Before:** `maxWidth: venueSuiteMaxWidth` (1200) capped the two-column block; on wide monitors content stopped at 1200px and the dark canvas showed to the right (the "black bar").
**After:** `maxWidth` removed; block expands to full available width. `alignSelf: "flex-start"` (left anchor) + `paddingHorizontal: spacing.md` (edge gutters) retained.
**Why:** SC-5/SC-6 — fill the page, keep gutters + left anchor.
**Lines:** 1 removed (+ comment rewrite).

### designSystem.ts — `venueSuiteMaxWidth`
**Before:** `export const venueSuiteMaxWidth = 1200 as const;`
**After:** removed (now unused after the `desktopCentered` edit; only `venueRailWidth` remains). Doc comment updated to record the ORCH-1184 removal.
**Why:** SC-7 — dead-constant cleanup, contract-authorized.
**Lines:** 1 removed (+ comment update).

---

## 8. Cross-surface impact table

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Business Web (desktop) | YES | The `isWideDesktop` layout: bare rail + full-width workspace. Parity automatic (single shared codebase, but this branch is desktop-web-gated). |
| Business Web preview (adjacent) | YES (same code) | Same `isWideDesktop` render. |
| Business iOS | NO | `isWideDesktop` is false on phone; renders the unchanged `phoneHost` branch. |
| Business Android | NO | Same — phone branch byte-unchanged. |
| Consumer iOS | NO | `app-mobile`; not touched. |
| Consumer Android | NO | Not touched. |
| Buyer/anonymous Web | NO | Buyer routes don't mount `VenueSuiteShell`. |
| Admin Web (adjacent) | NO | Separate Vite app; not touched. |

Parity is automatic on the affected surface (one shared component, single desktop branch). No manual parity surfaces.

`git diff` confirms the native/web-phone branch (the `else` of `isWideDesktop`: `phoneHost` / `phoneScroll` / `venue-suite-shell-phone`) and all its styles are byte-unchanged — only the doc-comment line containing `isWideDesktop` appears in the diff.

---

## 9. Smoke result

- `npx jest venueSuiteShell.orch1184.fullwidth venueModules` → **9 passed**.
- `npx jest src/components/venue/__tests__` (full venue dir) → **11 suites, 65 tests passed** (no sibling regression).
- `npx tsc --noEmit` → **0 errors in touched files**; total error count identical (665) with and without the change, confirming no new type errors introduced (the 665 are a pre-existing baseline — RTL render-test module-not-found + DraftEvent `rsvp`/`category` drift + checkout-buyer `any` params — all unrelated to this ORCH; see §12).
- No strict-grep gate references `VenueSuiteShell` / `railSection` / `venueSuiteMaxWidth` / `desktopCentered` (`grep .github/scripts/strict-grep/` → 0 hits).
- **Runtime desktop eyeball (browser at wide width) NOT performed in this session** — the layout correctness (no right-side black bar, wider cards, no horizontal overflow) is source-verified (`flex:1` workspace + fixed rail + `width:"100%"` row, no `maxWidth`). Recommend Seth/tester confirm on a wide monitor.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- Runtime desktop-web visual confirmation deferred to Seth/tester (§9).

---

## 11. Operator action required

- **No migration. No edge-function deploy.** Pure JS/layout change.
- This is a business-app (mingla-business) change to the desktop-web render path. When merged, it ships to business web automatically on the next web deploy; native apps are unaffected (phone branch unchanged) so no OTA is strictly required for this change, though it rides along harmlessly in any business OTA.
- Route back to orchestrator for REVIEW → tester (adversarial test + wide-monitor runtime eyeball).

---

## 12. Discoveries for Orchestrator

- **Pre-existing baseline:** `npx tsc --noEmit` in `mingla-business` reports **665 errors on origin/main** (NOT introduced by this ORCH — identical count with my change stashed). Largest buckets: (a) render-test files importing `@testing-library/react-native` which isn't resolvable under the default tsconfig (they run under dedicated render configs), (b) `DraftEvent` missing `isRsvp`/`rsvp*` + stale `category` in several service tests, (c) checkout buyer `any`-typed params, (d) `@mingla/payments-native` module-not-found in native payment wrappers. These are unrelated to ORCH-1184 and pre-date it — flagging for triage, NOT fixed here (scope discipline).
- No cross-ORCH file overlap: `VenueSuiteShell.tsx` is owned by META-ORCH-1148 (venue suite); this is a scoped desktop-layout polish on top of it, no logic touched. COMMS-0038/0039 (META-ORCH-1148 realtime-publication gate red) are unrelated to this layout change and were not triggered.
