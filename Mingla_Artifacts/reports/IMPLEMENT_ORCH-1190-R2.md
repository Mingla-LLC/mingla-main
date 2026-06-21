# IMPLEMENT — ORCH-1190 R2 (venue suite polish, web rework)

**Worktree:** `~/Desktop/mingla-orchs/1190-[venue-polish-r2]` · branch `1190-venue-polish-r2`
**Date:** 2026-06-21 · **Skill:** mingla-implementor+claude
**Scope:** REWORK of two ORCH-1190 [venue suite polish] items that did NOT take effect on business WEB.

---

## 1. Summary (plain English)

ORCH-1190 R1 shipped a "venue suite polish" batch, but two of Seth's items were still
visibly broken on business.usemingla.com (the deployed web build):

- **BUG 1 (green toggle handles)** — REAL, DIAGNOSED, FIXED, WEB-VERIFIED. The venue-suite
  toggles already routed through the shared `BrandSwitch`, but `BrandSwitch` only set the
  *native* RN `Switch` color props. On the WEB build react-native-web paints the ON-state
  HANDLE from a *separate* prop (`activeThumbColor`, default teal `#009688`) that the first
  cut never set — so the track was orange but the handle stayed teal-green. Fixed by adding
  the web-only `activeThumbColor`/`activeTrackColor`. Verified in a real react-native-web DOM
  render: the ON handle is now white, track orange.

- **BUG 2 (narrow full-width modules)** — COULD NOT REPRODUCE from current `main`; root cause
  is **NOT** in the three named modules. Reservations / Waitlist / Menu render **full-width
  at every viewport** in a faithful, real-Chromium react-native-web render of the exact shell
  structure. They carry **no `maxWidth` cap** (R1 removed caps only from Settings / Tables /
  Availability, which DID have them). I reverted the speculative no-op styling I first wrote
  and am handing BUG 2 back for live-DOM forensics (details + evidence below). I did not ship
  unverified styling as a "fix."

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Commit |
|----|-------------|--------|--------|
| BUG-1-Web | Venue-suite toggles render Mingla brand (orange track + WHITE handle) on WEB, no teal | ✓ FIXED + WEB-VERIFIED | 4857f6d25 |
| BUG-1-Native | Same toggles unchanged/correct on native (props inert on RN) | ✓ (additive, native ignores web props) | 4857f6d25 |
| BUG-2-Web | Reservations / Waitlist / Menu full-width on WEB | ⚠ NOT REPRODUCIBLE from main — see §10 | — |

---

## 3. Files changed

| File | Δ | Note |
|------|----|------|
| `mingla-business/src/components/ui/BrandSwitch.tsx` | +33 / −6 | Add web-only `activeThumbColor`/`activeTrackColor` so the ON handle is white + track orange on react-native-web. |
| `mingla-business/src/components/ui/__tests__/brandSwitch.orch1190r2.web.render.test.tsx` | +75 (new) | Web-platform render proof (the R1 blind spot). |
| `mingla-business/jest.orch1190r2.web.render.cjs` | +38 (new) | Jest config aliasing `react-native`→`react-native-web` so the test renders the WEB Switch. |

No other files changed. The 3 BUG-2 modules were reverted to `origin/main` (see §10).

---

## 4. Data-model changes applied

None. UI-only, pure-JS.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Path:** `mingla-business/src/components/ui/__tests__/brandSwitch.orch1190r2.web.render.test.tsx`
- **Config:** `mingla-business/jest.orch1190r2.web.render.cjs`
- **Run:** `cd mingla-business && npx jest --config jest.orch1190r2.web.render.cjs --runInBand`
- **Passing output:**
  ```
  PASS src/components/ui/__tests__/brandSwitch.orch1190r2.web.render.test.tsx
    ✓ ON-state: track is brand orange, handle is WHITE (never the native teal)
    ✓ OFF-state: handle is WHITE
  Tests: 2 passed, 2 total
  ```
- **fails-on-revert verified** by TRUE LINE-DELETION of the fix (deleting the
  `activeThumbColor: THUMB` + `activeTrackColor: accent.warm` lines), at commit 4857f6d25:
  ```
  ✕ ON-state: track is brand orange, handle is WHITE (never the native teal)
      Expected pattern: not /rgba\(0,\s*150,\s*136/
      Received string:      "rgba(0,150,136,1.00)"   ← teal #009688 returns
  ```
  Restored → 2/2 pass again.
- **No existing test modified.** The shipped `venueSuitePolish.orch1190.test.ts` (#3 asserts
  `/true:\s*accent\.warm/`) stays green (18/18) because the fix keeps `accent.warm` as the
  literal for both `trackColor.true` and `activeTrackColor`. No `[TEST-MOD-APPROVED]` needed.

---

## 7. Old → New receipts

### BrandSwitch.tsx
- **Before:** wrapped RN `Switch` with `trackColor={{false,true:accent.warm}}`, `thumbColor="#fff"`,
  `ios_backgroundColor`. On react-native-web the ON-state HANDLE is painted from `activeThumbColor`
  (default teal `#009688`) which was NOT set → teal handle on web; track was correctly orange.
- **After:** also passes `activeThumbColor="#ffffff"` + `activeTrackColor={accent.warm}` (the
  react-native-web ON-state props). Web ON handle = white, track = orange. Props are inert on
  native (RN's Switch ignores unknown props), so native is unchanged.
- **Why:** BUG 1 (Seth: green toggle handles on Tables "Party fit" + Settings "Take table
  reservations" / "Charge a reservation fee").
- **Lines changed:** ~33 (mostly doc-comment + the typed web-extras + 2 prop lines).

---

## 8. Cross-surface impact

| Surface | Affected | Detail |
|---------|----------|--------|
| Business Web (business.usemingla.com) | YES | The fix target. ON handle now white, track orange. |
| Business iOS | No-op | Native `Switch` already rendered white thumb via `thumbColor`; web props ignored. |
| Business Android | No-op | Same as iOS. |
| Buyer/anon Web | No | BrandSwitch is venue-suite only (operator side). |
| Consumer iOS/Android | No | Different app. |
| Admin Web | No | Different stack. |

Parity is AUTOMATIC (single shared `BrandSwitch` component, single RN codebase).

---

## 9. Smoke / verification (how BUG 1 was verified ON WEB — not claimed)

react-native-web cannot be eyeballed in this headless session, so I rendered the REAL
component through react-native-web's actual `Switch` (the exact component the Vercel build
ships) via `ReactDOMServer.renderToStaticMarkup` and inspected the emitted INLINE colors:

```
OLD ON: {"track":"rgba(235,120,37,1.00)","thumb":"rgba(0,150,136,1.00)"}   ← thumb TEAL
NEW ON: {"track":"rgba(235,120,37,1.00)","thumb":"rgba(255,255,255,1.00)"}  ← thumb WHITE
NEW OFF:{"track":"rgba(255,255,255,0.16)","thumb":"rgba(255,255,255,1.00)"} ← thumb WHITE
```

`rgba(0,150,136)` is `#009688` (react-native-web's `defaultActiveThumbColor`, teal-green) —
the exact off-brand handle Seth flagged. The fix replaces it with white. This is the rendered
DOM react-native-web produces, identical to the deployed build. The committed jest test
(§6) encodes this and fails-on-revert.

Gates run: existing `venueSuitePolish.orch1190` (18/18 pass), new web render (2/2),
strict-grep `orch-1148-no-buyer-tax-form-in-venue-settings` (pass),
`i-biz-venue-input-uses-mapbox` (pass), `tsc --noEmit` on BrandSwitch (exit 0).

---

## 10. BUG 2 — root-cause investigation + why no fix shipped

### What I found (evidence-backed)
- All five venue modules use an **identical** `host` style (`{paddingHorizontal, paddingTop,
  gap}`) and the shell (`VenueSuiteShell`) mounts every non-overview module inside the **same**
  `<ScrollView>` with the same content-container style. Dispatch is uniform — no per-module
  wrapper, no maxWidth on the modules.
- **R1 only edited `VenueSettingsModule`, `VenueTablesModule`, `VenueAvailabilityModule`** for
  full width (git `70b74de13`). It NEVER touched `VenueReservationsModule`,
  `VenueWaitlistModule`, or `VenueMenuModule` (last touched by META-ORCH-1148 #508 /
  META-ORCH-1186). R1's commit body even *assumed* R/W/M "already render edge-to-edge."
- The R1 full-width fix was the **removal of a `maxWidth: venueSettingsMaxWidth` (720) +
  `alignSelf:"flex-start"` cap** from Settings (and equivalent on Tables). The three "broken"
  modules carry **no such cap** — there is nothing to remove.
- **Real-browser proof:** I rendered the EXACT shell desktop branch (`desktopHost` →
  `desktopCentered{row,width:100%,alignSelf:flex-start}` → rail(220) + `desktopWorkspace{flex:1}`
  → `ScrollView` → real `host` → GlassCard) through react-native-web's real DOM and measured
  in Playwright/Chromium:
  ```
  exact shell, 1440px viewport: workspace=1188px  card=1132px  → FULL (95%)
  ```
  Also measured the empty-state card, the populated row-card (`flexDirection:row` GlassCard,
  the Tables collapse trigger), and the Reservations horizontal seg-`ScrollView` variant, at
  1280/768/480px viewports. **Every case rendered FULL width** with the current (unmodified)
  module styles.

### Conclusion
BUG 2 as scoped (a width cap / collapse in these three modules) **does not reproduce from
current `main` source.** I first wrote `width:"100%"`/`alignSelf:"stretch"` onto the host +
cards, then proved with the same browser harness that it is a **no-op** (card already fills
97%). Per "subtract before adding" + Failure Honesty I reverted those speculative edits rather
than ship code that does not change the rendered result.

### The open contradiction (for forensics)
Seth reports, on the SAME live web build, Tables/Settings full-width but R/W/M narrow. Since
R1's Tables/Settings cap-removal is clearly live (they're full-width), and R/W/M have no cap,
my faithful render cannot explain the narrow R/W/M. The remaining unmodeled factors are
runtime/live-only and need live-DOM evidence I cannot capture headless:
1. A live DevTools inspection of business.usemingla.com on the Reservations/Waitlist/Menu
   tabs to read the ACTUAL computed width + the offending CSS rule + which DOM node caps it.
2. Whether Seth's "narrow" is the centered empty-state content *cluster* (icon+title+body+
   button centered inside a full-width card) reading as "narrow," vs the card itself.
3. A data-dependent populated state (real reservations/menu rows) that my synthetic render
   didn't exercise.

**Recommendation:** route BUG 2 to mingla-forensics with a live-DOM capture requirement
(screenshot + computed-style export from the deployed site), since source + faithful render
both say the modules are full-width.

---

## 11. Operator action required

- **No migration. No edge deploy.** Pure-JS UI.
- **Deploy:** business web (Vercel) + business OTA. ⚠ **Business OTA is BLOCKED** per
  COMMS-0052 (1187 Leg 3 hard-imports `posthog-react-native`; OTA to runtime 1.0.0 crashes
  shipped binaries) — this fix ships with the NEXT business native build OR via the Vercel web
  deploy (web is unaffected by the native-module block). The BUG-1 fix is web-relevant, so the
  **Vercel `[deploy]` web build is the path that gets it to Seth.**
- After deploy, eyeball the venue Tables "Party fit" toggle + Settings "Take table
  reservations" / "Charge a reservation fee" on business.usemingla.com: handle WHITE, track
  ORANGE when on.

## 12. Discoveries for Orchestrator

- **DISC-1190R2-A:** The shipped ORCH-1190 #3 toggle test is source-text-only and every venue
  render test runs on the `ios` jest platform → the venue suite has **zero web-platform render
  coverage**, which is exactly why the teal-handle web bug shipped. This R2 adds the first
  web render config (`jest.orch1190r2.web.render.cjs`). Consider a standing web render-gate for
  venue chrome.
- **DISC-1190R2-B (BUG 2):** Reservations/Waitlist/Menu are full-width from `main` in a
  faithful real-browser render; the narrow symptom needs live-DOM forensics (see §10). Not a
  module-style cap.
- **COMMS:** Acked COMMS-0051 (already acked for ORCH-1190 — venue UI only, no migrations) and
  COMMS-0052 (business OTA block — deploy via Vercel web for the BUG-1 fix). No new COMMS
  written (no cross-ORCH file overlap; BrandSwitch is venue-suite-local).

---

## BUG-2 REWORK — empty-state cards narrow on WEB (RESOLVED at commit 7716b3351)

### Corrected diagnosis (supersedes DISC-1190R2-B)
The prior pass could NOT reproduce BUG-2 because it rendered the **populated**
path. The narrow card is the **EMPTY STATE**: Reservations ("No reservations
today yet."), Waitlist ("Nobody's waiting"), and Menu ("Build your menu") render
their empty card while a fresh/quiet venue has no rows. Those empty-state
`GlassCard` wrappers carried **no explicit width** and used `alignItems:"center"`.
On the react-native-web target a column flex child with no width + centered items
shrinks to its content's min width, so the card collapsed to a centered
~half-width card — while VenueTablesModule/VenueSettingsModule content cards
(`width:"100%"`, e.g. VenueTablesModule.tsx:314) span the workspace. Native
(`ios`) renders don't collapse the same way, which is why source-grep + native
render tests never caught it.

### Fix
Added `width:"100%"` + `alignSelf:"stretch"` to each module's empty-state card
style; inner icon/text stays centered via `alignItems`. Also stretched the
populated rows that shared the same latent gap so they stay full-width on web:

| File | Style(s) made full-width |
|---|---|
| `mingla-business/src/components/venue/VenueReservationsModule.tsx` | `emptyCard` |
| `mingla-business/src/components/venue/VenueWaitlistModule.tsx` | `emptyCard`, `card` (populated queue row) |
| `mingla-business/src/components/venue/VenueMenuModule.tsx` | `emptyCard`, `categoryCard` (populated), `skeletonCard` (loading) |

Tables/Settings left untouched (reference/correct surfaces; in scope = the three
named modules). NOTE for orchestrator: `VenueTablesModule.emptyCard` has the same
latent width gap but is never the observed symptom (Tables shows content); flagged
below, not fixed (scope).

### How verified (web render, exactly)
Wrote a NEW web render-proof that mounts each module's REAL empty state through
**react-native-web** (the deployed business web build) via `ReactDOMServer.
renderToStaticMarkup` — the same harness pattern as the BUG-1 BrandSwitch web
test. react-native-web compiles `width:"100%"` to the deterministic atomic class
`r-width-13qz1uu` (verified by direct probe). The test asserts each module's empty
state renders (copy present) AND the empty card carries `r-width-13qz1uu`.

A DOM dump confirmed the width class lands on exactly ONE element per empty render
— the GlassCard wrapper that also carries the elevated-variant box-shadow + 24px
radius + the emptyCard gap/alignSelf — i.e. the visible CARD, not an inner view.

- Config: `mingla-business/jest.orch1190r2.venuewidth.web.render.cjs`
- Test: `mingla-business/src/components/venue/__tests__/venueEmptyStateFullWidth.orch1190r2.web.render.test.tsx`
- Run: `cd mingla-business && npx jest --config jest.orch1190r2.venuewidth.web.render.cjs --runInBand`
- Result: **3/3 PASS** (Reservations, Waitlist, Menu).

### Regression / fails-on-revert
`fails-on-revert verified at commit 7716b3351`. Proven by TRUE LINE-DELETION of
`width:"100%"` from all three `emptyCard` styles → **3/3 FAIL** (the empty copy
still renders, so the failure is specifically the missing width class), then
restored → **3/3 PASS**. Append-only: new test + new config; no existing test
modified (no `[TEST-MOD-APPROVED]` needed).

Existing ORCH-1190 tests re-run green after the change: `venueSuitePolish.orch1190`
+ `venueModules` = 22/22 pass; BUG-1 `brandSwitch.orch1190r2.web.render` = 2/2 pass.
`tsc --noEmit` clean on the three modules (the only tsc note is the pre-existing
`react-dom/server` missing-types warning, identical to the committed BUG-1 web test).

### Discoveries (BUG-2)
- **DISC-1190R2-C:** `VenueTablesModule.emptyCard` carries the same latent
  no-width gap as the three fixed modules — harmless today (Tables shows content,
  never the empty card in the observed flow) so left untouched for scope, but if a
  brand ever lands on an empty Tables state it would show the same narrow card.
  Trivial one-line follow-on if desired.
- **Deploy:** This is a pure-JS/CSS web fix → ships via the **Vercel `[deploy]`
  web build** (web is unaffected by the COMMS-0052 native-module OTA block).

---

## BUG-3 (REWORK) — table-card STILL cramped one-char-per-line on mobile

**Commit:** `218e40943`

### Symptom (Seth, on device)
An added table tile ("Test Table · 2 seats · parties 1–2 · Indoor · Standard")
renders cramped on a narrow mobile viewport — the title wraps one character per
line ("T\ne\ns\nt…"). The first ORCH-1190 pass (#593 `70b74de13`) restructured
the row (inner `tableRow` flexDirection:row + `tableMain`/`tableText` flex:1 +
minWidth:0 + card width:100%) and claimed this fixed it, but it was STILL broken.

### Diagnosis (evidence-backed)
Modeled the EXACT native layout tree with the real Yoga engine (`yoga-layout`,
the same engine RN uses on device) at width 375. Findings:

- The chain is `list → GlassChrome outer (width:100%) → clip → content → GlassCard
  padding View → tableRow → tableMain(flex:1,minWidth:0) → tableText(flex:1,
  minWidth:0) → name`.
- With the card's `width:"100%"` present AND every ancestor stretching, the text
  column measures 251px at 375 — correct. So the prior fix IS correct in isolation.
- The collapse reproduces ONLY when the card is NOT pinned to a definite cross
  width: a Yoga model with an ancestor `alignItems:"flex-start"`/`"center"` and
  the card NOT carrying `width:100%` yields card=92, text-column=0, name height
  302 (the one-char-per-line wrap). `width:"100%"` resolves against the PARENT, so
  it only protects when the parent itself is definite-width and stretching. The
  shell's phone path wraps the module in a vertical `ScrollView` content container
  (no alignItems set) — a class of container where the lone `width:100%` is not a
  guaranteed protection across RN versions/ancestor styles.
- **Probable why-Seth-still-saw-it:** COMMS-0052 — the business OTA has been
  BLOCKED since `70b74de13` merged (posthog-react-native hard-import), so the #593
  table fix never reached Seth's installed binary. He was testing a build WITHOUT
  the prior fix. Regardless, the fix below is hardened so it cannot regress under
  any ancestor.

### Fix (`mingla-business/src/components/venue/VenueTablesModule.tsx`, +19/-5)
- `styles.tableCard`: added `alignSelf:"stretch"` alongside the existing
  `width:"100%"`. `alignSelf:stretch` forces the card to fill its cross-axis
  regardless of the ancestor's `alignItems`; both are kept (neither alone covers
  every container — width:100% for definite parents, alignSelf:stretch for
  non-stretch ancestors).
- `styles.tableRow`: added `width:"100%"` so the GlassCard padding wrapper (which
  itself carries no width) cannot leave the row content-sized; the flex:1 +
  minWidth:0 text column now measures against the full card width.

Re-ran the Yoga model after the fix: card=343 / text-column=251 / height=18 under
`alignItems:flex-start`, `center`, AND `stretch` ancestors — no collapse in any case.

### Old → New receipt
**Before:** card `{ width:"100%" }`; row `{ flexDirection:row, alignItems:center,
gap }`. Text column collapses to min-content under a non-stretch / non-definite
ancestor → one-char-per-line title.
**After:** card `{ width:"100%", alignSelf:"stretch" }`; row `{ …, width:"100%" }`.
Card fills cross-axis under any ancestor; row spans full card; title wraps
word-level. **Why:** REWORK of #8 — make the full-width layout ancestor-proof.
**Lines:** ~+19/-5 (styles only; no JSX/logic change).

### Regression test (fails-on-revert proven)
`mingla-business/__tests__/venueTableCardMobileWidth.orch1190r2.web.render.test.tsx`
(+ config `jest.orch1190r2.tablecard.web.render.cjs`). Renders the POPULATED
VenueTablesModule through react-native-web (ReactDOMServer) and asserts the
compiled atomic classes: card carries `r-alignSelf-1pz39u2` (alignSelf:stretch) +
`r-width-13qz1uu` (width:100%); ≥2 `r-width-13qz1uu` (card + row); text column
carries `r-flex-13awgt0` (flex:1) + `r-minWidth-bcqeeo` (minWidth:0). 4/4 PASS.

**fails-on-revert verified at commit 218e40943** — by TRUE LINE-DELETION of
`alignSelf:"stretch"` (tableCard) and `width:"100%"` (tableRow): the two layout
assertions FAIL (2 failed, 2 passed); restored → 4/4 PASS. Append-only: new test
+ new config, no existing test modified ([TEST-MOD-APPROVED] not needed).

### Gates re-run
- `venueTableCardMobileWidth.orch1190r2.web.render` — 4/4 PASS.
- `venueEmptyStateFullWidth.orch1190r2.web.render` (BUG-2) — 3/3 PASS.
- `venueSuitePolish.orch1190` — 18/18 PASS.
- `tsc --noEmit`: no error on VenueTablesModule.tsx (styles-only). The only test-file
  note is the pre-existing `react-dom/server` missing-types warning, identical to the
  committed BUG-1/BUG-2 web render tests.

### How verified (explicit)
1. Reproduced the collapse with the real Yoga layout engine at 375px (not source
   reasoning) — showed card=92 / text-column=0 / name-height=302 under a
   non-stretch + non-definite-width ancestor.
2. Proved the fix at 375px under flex-start / center / stretch ancestors — all
   card=343 / text-column=251 / height=18.
3. Rendered the populated module through react-native-web (the deployed web build)
   and confirmed the fixed atomic classes land on the card + row + text column.
   NOT verified on a physical device / sim (no business native build available;
   OTA blocked by COMMS-0052). Web-render + Yoga-engine proof stands; on-device
   confirmation arrives with the next business native build.

### Cross-surface impact
Shared RN StyleSheet → Business iOS · Business Android · Business Web (Vercel) all
get the fix automatically (one code path). Web ships now via Vercel `[deploy]`;
iOS/Android ship with the next business native build (COMMS-0052 OTA block).
Unaffected: Consumer iOS/Android, Buyer/anonymous web, Admin web (no venue tables module).

### COMMS
Acked COMMS-0052 (BLOCK): no `eas update` performed; this turn is code + commit
only (no deploy/OTA/merge), so the block is honored. BUG-3 is pure-JS/CSS.
