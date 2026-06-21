# QA — ORCH-1184 — venue command-center desktop: bare rail + full-width workspace

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise)
**Surface:** Business desktop-web ONLY (`isWideDesktop` branch). Native iOS/Android + web-phone byte-unchanged.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1184-[reservations-cmd-fullwidth]/` · branch `ORCH-1184-reservations-cmd-fullwidth` · fix commit `5b1bdf2e6` (off origin/main `2be6d277d`).
**Evidence ceiling note:** this is a desktop-web LAYOUT change. I verified both claims by (1) reading the diff, (2) a REAL react-test-renderer mount of `VenueSuiteShell` in the wide-desktop branch (rendered tree + flattened style, not source-grep), and (3) jest + typecheck gates. A live wide-BROWSER pixel eyeball was not performed (per dispatch — Seth will eyeball); the one purely-visual claim (no right-side "black bar" / wider cards on a wide monitor) is capped at **suspected** and listed as a residual.

---

## 1. Claims verified

### Claim 1 — bare rail (no "Command"/"Booking" captions; six items unchanged order/routing/active-state)
**PASS — proven by mount.**
- Diff: both `<Text style={styles.railSection}>Command</Text>` and the `booking.length > 0 ? (<><Text …>Booking</Text>…) : null` fragment are deleted from `DesktopRail`'s render; the `railSection` style object is deleted; the render is now `{orderedCommandTop.map(renderRow)}{booking.map(renderRow)}{orderedCommandBottom.map(renderRow)}` (`VenueSuiteShell.tsx` L293–299).
- Order/routing/active-state source of truth UNCHANGED: `command`/`booking` filters + `orderedCommandTop`/`orderedCommandBottom` arrays + `renderRow` (with `testID` `venue-rail-<m>`, `accessibilityRole="tab"`, `onPress={() => onSelect(m)}`, active bar) are byte-identical to origin/main.
- **Runtime mount proof (my adversarial test):** rendered the real `DesktopRail` inside a mounted `VenueSuiteShell` (`isWideDesktop=true`, reservations ON → all six modules). Read the six rail rows from the REAL host tree by their `venue-rail-*` testIDs → labels are exactly `["Overview","Tables","Availability","Reservations","Waitlist","Settings"]` in order; and `findAll` over every rendered `<Text>` contains NEITHER "Command" NOR "Booking".

### Claim 2 — full-width workspace (`desktopCentered` drops `maxWidth: venueSuiteMaxWidth`; keeps `paddingHorizontal: spacing.md` + left anchor; constant removed)
**PASS — proven by flattened style.**
- Diff: `maxWidth: venueSuiteMaxWidth` removed from `styles.desktopCentered`; `alignSelf: "flex-start"` + `paddingHorizontal: spacing.md` + `width: "100%"` + `flexDirection: "row"` retained (`VenueSuiteShell.tsx` L307–323). Import of `venueSuiteMaxWidth` removed (L31–39). `export const venueSuiteMaxWidth = 1200 as const;` removed from `designSystem.ts` (only `venueRailWidth` remains).
- No remaining code consumer of `venueSuiteMaxWidth` repo-wide (grep → only comment + test-string mentions). No remaining code consumer of `railSection` (same). `typography` + `textTokens` imports remain used elsewhere in the file (L368/403/407 + L369/372/404/408) → removing the `railSection` style did NOT orphan an import.
- **Runtime mount proof (my adversarial test):** `StyleSheet.flatten` of the actual `desktopCentered` View's resolved style → `maxWidth` is `undefined` (NOT a number); `alignSelf === "flex-start"`; `paddingHorizontal` is a number `> 0`; `flexDirection === "row"`; `width === "100%"`. The 1200 cap is gone in the RESOLVED style, not just the source text.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | Remove BOTH rail caption labels | PASS | Diff L286–299; mount: no "Command"/"Booking" text node |
| SC-2 | Six items, order, routing, active-state unchanged | PASS | `renderRow`/order arrays byte-unchanged; mount: 6 labels in order, `onPress`/`testID`/`accessibilityState` intact |
| SC-3 | Reads as ONE list; orphaned caption gap collapsed; uniform spacing | PASS (source) / suspected (pixel) | captions + their `paddingTop: spacing.md` gone; `railInner` `gap: spacing.xxs` now uniform. Pixel rhythm = Seth eyeball |
| SC-4 | Remove unused `railSection` style; no other consumer | PASS | style object deleted; `grep railSection` → 0 code hits repo-wide |
| SC-5 | `desktopCentered` no longer caps `maxWidth` | PASS | mount: flattened style `maxWidth === undefined` |
| SC-6 | KEEP `paddingHorizontal: spacing.md` + left anchor | PASS | mount: `paddingHorizontal` number > 0 (= 16); `alignSelf === "flex-start"` |
| SC-7 | Remove `venueSuiteMaxWidth` constant (import + def) | PASS | import removed; `export const` removed; 0 code consumers |
| SC-8 | Workspace ScrollView + cards fill, no horizontal overflow | PASS (source) / suspected (pixel) | `desktopWorkspace` `flex:1`; rail fixed `venueRailWidth`; row `width:"100%"` no `maxWidth` → no overflow by construction. Pixel = Seth eyeball |
| SC-9 | Native / narrow path byte-unchanged | PASS | `git diff` touches ZERO lines of `phoneHost`/`phoneScroll`/`venue-suite-shell-phone`/`desktopWorkspace` (grep over diff → no match) |
| SC-10 | Regression test fails-on-revert | PASS | implementor + tester both fail-on-revert (§4, §5) |

---

## 3. Findings

**No P0 / P1 / P2 / P3.** Two P4 (praise):
- **P4-1 (praise):** clean subtract-before-add — the dead `railSection` style AND the now-unused `venueSuiteMaxWidth` constant + its import were removed in the same change, not left dangling. Zero orphaned consumers repo-wide.
- **P4-2 (praise):** the change is surgically desktop-only. The diff does not touch a single line of the phone/native branch or its styles — confirmed by grepping the diff for the phone identifiers (zero hits).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

I checked out the implementor's fix at worktree HEAD `5b1bdf2e6` and ran the IMPLEMENTOR's happy-path test `venueSuiteShell.orch1184.fullwidth.test.ts`:
- **Fix in place:** `Tests: 9 passed, 9 total` (incl. `venueModules`), the suite itself 5/5 green.
- **Reverted (TRUE line restoration, not comment-out):** I re-added the `<Text style={styles.railSection}>Command/Booking</Text>` captions + `booking.length > 0` fragment, restored the `railSection` style object, restored `maxWidth: venueSuiteMaxWidth` + the import, and restored `export const venueSuiteMaxWidth = 1200` in `designSystem.ts`. My adversarial render test then went RED on BOTH assertions:
  - `(a) … NO Command/Booking caption …` → `expect(received).not.toContain("Command")` FAILED; received array `["Command","Overview","Booking","Tables","Availability","Reservations","Waitlist","Settings"]`.
  - `(b) … NO numeric maxWidth …` → `expect(typeof flat.maxWidth).not.toBe("number")` FAILED (resolved `maxWidth` = 1200).
- **Restored from backup:** `git diff --stat` for both product files is EMPTY (they match committed HEAD again) and the adversarial test is GREEN 2/2.

`fails-on-revert independently re-verified at HEAD 5b1bdf2e6` (revert performed against this commit; restore confirmed clean).

---

## 5. Adversarial test added (tester-owned, different angle, on-branch)

- **Test path:** `mingla-business/src/components/venue/__tests__/venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx`
- **Config path:** `mingla-business/jest.orch1184.adversarial.render.cjs` (worktree-local render config; precedent = `jest.orch1122.adversarial.render.cjs`).
- **Different angle:** the implementor's test is 100% SOURCE-TEXT regex over the `.tsx` file + a registry derive — it never mounts, never resolves the StyleSheet, never inspects a rendered tree. Mine ACTUALLY MOUNTS `VenueSuiteShell` in the `isWideDesktop` branch (react-test-renderer@19.1.0 + @testing-library/react-native@13.3.3) and asserts on (a) the REAL rendered rail tree (no "Command"/"Booking" text node; six labels in order) and (b) the REAL `StyleSheet.flatten`'d `desktopCentered` style (no numeric `maxWidth`; keeps anchor + gutters). This catches a regression a variable-driven caption or a merged-style-array `maxWidth` could sneak past source-grep.
- **Append-only:** NEW file; modifies/deletes no existing test. Both the implementor's happy-path test AND my adversarial test appear in `git diff origin/main...HEAD --name-only` for the closing PR.
- **`fails-on-revert verified at 5b1bdf2e6`** (true line-deletion of the fix → both assertions RED; restore → GREEN; §4).
- **Run:** `cd mingla-business && npx jest --config jest.orch1184.adversarial.render.cjs --runInBand` → 2 passed, 2 total.
- **Provisioning note (residual):** the render deps `react-test-renderer@19.1.0` + `@testing-library/react-native@^13` are in `node_modules` (gitignored) — provisioned once via `npm i` (config header documents the command). The npm install side-effect on `package.json`/`package-lock.json` was reverted so the commit diff contains ONLY the test + config. A CI runner without these deps must `npm i` them first (same constraint as every existing `jest.orch11xx.render.cjs` config).

---

## 6. Native / narrow path UNCHANGED confirmation

`git diff origin/main...HEAD -- VenueSuiteShell.tsx | grep -E '^[-+].*(phoneHost|phoneScroll|venue-suite-shell-phone|desktopWorkspace)'` → ZERO matches. The phone/native single-column branch (`return (<View style={styles.phoneHost} testID="venue-suite-shell-phone">…`, L223–242) and its styles (`phoneHost`, `phoneScroll`) are byte-unchanged. The only `isWideDesktop`-adjacent diff lines are the in-scope desktop render + the doc comment. Change is desktop-web-only as claimed.

---

## 7. Gates run (commands + output)

```
cd mingla-business
$ npx jest venueSuiteShell.orch1184.fullwidth.test venueModules
  Tests: 9 passed, 9 total            (implementor happy-path + registry)
$ npx jest src/components/venue/__tests__
  Test Suites: 11 passed, 11 total
  Tests: 65 passed, 65 total          (no sibling regression in the venue dir)
$ npx jest --config jest.orch1184.adversarial.render.cjs --runInBand
  Tests: 2 passed, 2 total            (tester adversarial MOUNT)
$ npx tsc --noEmit   (HEAD)           → 665 errors
$ npx tsc --noEmit   (origin/main versions of the 2 touched files swapped in) → 665 errors
  → ZERO new typecheck errors. No error references any touched file
    (grep 'VenueSuiteShell.tsx|designSystem.ts' over tsc output → 0 hits).
```
The 665 are a pre-existing baseline (RTL-import module-not-found in render-test files, `DraftEvent` rsvp/category drift, checkout-buyer `any` params, `@mingla/payments-native` not-found) — unrelated to ORCH-1184, identical with and without the change. **Discovery for orchestrator**, not a finding.

No strict-grep gate references `VenueSuiteShell` / `railSection` / `venueSuiteMaxWidth` / `desktopCentered` (grep over `.github/scripts/strict-grep/` → 0 hits) → no CI gate affected.

---

## 8. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Note |
|---|------|---------|------|
| 1 | No dead taps | PASS | `renderRow` `onPress` unchanged; six rows still route |
| 2 | One owner per truth | PASS | `deriveVenueModules`/`VENUE_MODULES` remain single source of module order |
| 3 | No silent failures | N/A | pure layout; no error path |
| 4 | One query key per entity | N/A | no query change |
| 5 | Server state server-side | N/A | no state change |
| 6 | Logout clears everything | N/A | n/a |
| 7 | Label `[TRANSITIONAL]` | N/A | none introduced |
| 8 | Subtract before adding | PASS | dead style + dead constant removed (P4-1) |
| 9 | No fabricated data | N/A | n/a |
| 10 | Currency-aware | N/A | n/a |
| 11 | One auth instance | N/A | n/a |
| 12 | Validate at right time | N/A | n/a |
| 13 | Exclusion consistency | N/A | n/a |
| 14 | Persisted-state startup gate | N/A | n/a |

No violations.

---

## 9. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Business Web (desktop, `isWideDesktop`) | PASS (mount) / suspected (pixel) | Render-mount proves rail tree + flattened style. Wide-browser pixel eyeball = Seth (residual). |
| Business Web preview (adjacent) | PASS (same code) | Same `isWideDesktop` render path. |
| Business iOS | N/A — not affected | `isWideDesktop` false on phone; phone branch byte-unchanged (§6). |
| Business Android | N/A — not affected | Same. |
| Consumer iOS / Android | N/A | `app-mobile` not touched. |
| Buyer/anonymous Web | N/A | Buyer routes don't mount `VenueSuiteShell`. |
| Admin Web (adjacent) | N/A | Separate Vite app; not touched. |

Physical-iPhone HITL: **not required** — this branch never renders on phone (the change is gated behind `isWideDesktop`, which is always false on native). No edge-fn / migration / live-deploy state to verify (pure JS layout).

---

## 10. Discoveries for orchestrator (not fixed here)

1. **Pre-existing typecheck baseline = 665 errors on `mingla-business` origin/main** (NOT ORCH-1184). Buckets: render-test files importing `@testing-library/react-native` unresolvable under the default tsconfig; `DraftEvent` missing rsvp/stale `category`; checkout buyer `any` params; `@mingla/payments-native` module-not-found. Flag for a typecheck-debt triage ORCH.
2. **Render-test dep provisioning is per-worktree, manual.** Every `jest.orch11xx.render.cjs` (incl. mine) needs `react-test-renderer` + `@testing-library/react-native` in `node_modules`, not declared in `package.json`. CI/fresh worktrees must `npm i` them. A standing dev-dependency declaration would remove this footgun — orchestrator's call.

---

## 11. Residuals for Seth (capped at suspected)

- **Wide-monitor pixel eyeball (suspected):** on a real wide browser, confirm (a) no right-side dead canvas / "black bar", (b) settings cards visibly wider, (c) the rail reads as one clean uniformly-spaced list with no orphaned gap where "Booking" used to sit, (d) no horizontal scrollbar. Source + mount say these hold by construction (`flex:1` workspace, fixed rail, `width:"100%"` row, no `maxWidth`, uniform `gap`), but pixels were not eyeballed this session.

---

## Verdict line

**PASS** — P0:0 P1:0 P2:0 P3:0 P4:2. Regression gate satisfied (implementor happy-path fails-on-revert re-verified @ `5b1bdf2e6`; tester adversarial MOUNT test on-branch, in-diff, fails-on-revert @ `5b1bdf2e6`). Zero new typecheck errors (665 baseline both sides). Native path byte-unchanged. One residual: wide-browser pixel eyeball deferred to Seth (suspected). Routes to CLOSE.
