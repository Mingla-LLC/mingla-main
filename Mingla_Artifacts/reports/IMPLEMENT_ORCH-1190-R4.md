# IMPLEMENT ORCH-1190 R4 — venue empty-state cards full-width on business desktop web

**Status:** implemented and verified (jest web-render proof; full-shell Playwright not run — see SC table).
**Worktree:** `~/Desktop/mingla-orchs/1190-[fullwidth-r4]/` on branch `1190-fullwidth-r4`.
**Web ships via Vercel; native OTA frozen (COMMS-0052, BLOCK, acked).**

## 1. Summary

On business desktop web the venue empty-state cards (Reservations "No reservations today yet.",
Waitlist "Nobody's waiting", Menu "Build your menu" + the menu loading skeleton) rendered NARROW /
centered while the Tables module's table card + smart-capacity card render FULL-WIDTH in the same
shell. R1–R3 failed (R1/R2 builds never actually deployed; R3 dropped `width:"100%"` on the theory
it defeats `alignSelf:"stretch"`, which REGRESSED the cards to narrow/centered on live desktop).

R4 matches the empty/skeleton cards EXACTLY to the proven-working `VenueTablesModule.tableCard`
style (Seth-confirmed full-width in this exact shell), which uses BOTH `width:"100%"` AND
`alignSelf:"stretch"` together. R4 restored `width:"100%"` alongside the existing
`alignSelf:"stretch"` on each empty card AND its wrapper (and the menu skeleton card + wrapper).
Nothing else changed.

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified | How | Commit |
|----|-----------|----------|-----|--------|
| SC-1 | Reservations empty card carries `width:"100%"` + `alignSelf:"stretch"` (matches tableCard) | PASS | RNW ReactDOMServer render asserts both atomic classes ≥2 (wrapper+card) | `<this>` |
| SC-2 | Waitlist empty card carries `width:"100%"` + `alignSelf:"stretch"` | PASS | same | `<this>` |
| SC-3 | Menu empty card carries `width:"100%"` + `alignSelf:"stretch"` | PASS | same | `<this>` |
| SC-4 | Menu loading skeleton card carries `width:"100%"` + `alignSelf:"stretch"` | PASS | restored on `skeletonCard` + `skeletonWrap` | `<this>` |
| SC-5 | `emptyWrap` wrappers carry BOTH props | PASS | both classes present on the wrapper `<View>` in rendered DOM | `<this>` |
| SC-6 | Empty card width-relevant props now identical to `VenueTablesModule.tableCard` | PASS | direct style diff (both = `width:"100%"` + `alignSelf:"stretch"`) | `<this>` |
| SC-7 | Full-shell Playwright width measurement ≈ workspace width | UNVERIFIED | no built web export available in this session; jest RNW render-proof + tableCard-parity diff used as the contract instead (see §9) | — |

## 3. Files changed

| File | Δ |
|------|---|
| `mingla-business/src/components/venue/VenueReservationsModule.tsx` | +`width:"100%"` on `emptyWrap` + `emptyCard`; R4 comment |
| `mingla-business/src/components/venue/VenueWaitlistModule.tsx` | +`width:"100%"` on `emptyWrap` + `emptyCard`; R4 comment |
| `mingla-business/src/components/venue/VenueMenuModule.tsx` | +`width:"100%"` on `emptyWrap`, `emptyCard`, `skeletonWrap`, `skeletonCard`; R4 comments |
| `mingla-business/src/components/venue/__tests__/venueEmptyStateFullWidth.orch1190r3.web.render.test.tsx` | rewritten to assert width:100% PRESENT (R4 contract); `[TEST-MOD-APPROVED ORCH-1190]` |
| `mingla-business/src/components/venue/__tests__/venueEmptyStateFullWidth.orch1190r2.web.render.test.tsx` | R3 had rewritten this to assert width:100% ABSENT; restored to assert PRESENT (R4); `[TEST-MOD-APPROVED ORCH-1190]` |

## 4. Data-model changes
None.

## 5. Edge functions touched
None.

## 6. Regression tests

- **Happy-path (R4):** `mingla-business/src/components/venue/__tests__/venueEmptyStateFullWidth.orch1190r3.web.render.test.tsx`
  (3 tests) — renders each REAL module empty state through react-native-web's actual style compiler
  (ReactDOMServer, the exact atomic classes Vercel emits) and asserts each carries the compiled
  `width:"100%"` (`r-width-13qz1uu`) AND `alignSelf:"stretch"` (`r-alignSelf-1pz39u2`) classes ≥2
  (wrapper + card). Run via `jest.orch1190r3.venuewidth.web.render.cjs` — **3 passed**.
- **Companion (R2 file, restored):** `venueEmptyStateFullWidth.orch1190r2.web.render.test.tsx`
  (3 tests) — R3 had flipped it to assert width ABSENT; restored to assert width PRESENT so CI is
  consistent with the shipped fix. **3 passed**.
- **No regression** on `jest.orch1190r2.tablecard.web.render.cjs` (4 passed) + `jest.orch1190r2.web.render.cjs` (2 passed).

**fails-on-revert verified at `8c937d770` (pre-commit base HEAD):** true LINE-DELETION of the two
`width: "100%"` lines from `VenueReservationsModule` `emptyWrap`/`emptyCard` →
`jest.orch1190r3.venuewidth.web.render.cjs` produced **1 failed, 2 passed** (the Reservations test
failed on `countClass(html, WIDTH_100) >= 2`); restoring the lines → **3 passed** again.

## 7. Old → New receipts

### VenueReservationsModule.tsx / VenueWaitlistModule.tsx
- **Before:** `emptyWrap: { alignSelf:"stretch" }`, `emptyCard: { alignSelf:"stretch", alignItems:"center", gap }` — R3 dropped `width:"100%"`.
- **Now:** both `emptyWrap` and `emptyCard` carry `width:"100%"` + `alignSelf:"stretch"` (card keeps `alignItems:"center"` + gap).
- **Why:** matches the proven `VenueTablesModule.tableCard`; restores full-width on live desktop.

### VenueMenuModule.tsx
- **Before:** `emptyWrap`/`emptyCard`/`skeletonWrap`/`skeletonCard` all `alignSelf:"stretch"` only.
- **Now:** all four carry `width:"100%"` + `alignSelf:"stretch"` (emptyCard keeps `alignItems:"center"`, `paddingVertical`, gap).
- **Why:** same — empty AND loading states must span the workspace like tableCard.

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---------|----------|-------|
| Business Web (Vercel) | YES | the fix target — empty/skeleton venue cards now full-width |
| Business Web preview | YES | same RN-web compile path |
| Business iOS | no visible change | width:100%+alignSelf:stretch already the table-card norm; native already stretched. OTA-frozen anyway (COMMS-0052) |
| Business Android | no visible change | same |
| Consumer iOS / Android | no | app-mobile untouched |
| Buyer/anon Web | no | venue modules are operator-only |
| Admin Web | no | untouched |

Parity is **automatic** (one RN codebase). No SheetMobile / GlassCard / GlassChrome / app-mobile files touched.

## 9. How verified

1. **Style diff vs proven tableCard:** confirmed `VenueTablesModule.tableCard` (L322-323) = `width:"100%"` + `alignSelf:"stretch"`; all four R4-edited styles now carry the identical width-relevant pair.
2. **Real RNW render-proof:** rendered each module empty state through react-native-web's ReactDOMServer (the exact DOM Vercel emits); verified the `r-width-13qz1uu` + `r-alignSelf-1pz39u2` atomic classes appear on the wrapper AND card `<div>`s for all three modules (6 + 6 web-render tests green).
3. **fails-on-revert:** true line-deletion of `width:"100%"` → test fails; restore → passes.
4. **NOT done:** full `VenueSuiteShell` (isWideDesktop) Playwright mount + pixel width measurement — no web export build was available in this session. The RNW class-presence proof + the tableCard-parity style diff are the substitute contract (the dispatch's stated minimum: "diff your changed `emptyCard` style against `VenueTablesModule.tableCard` and confirm they are now identical in the width-relevant properties").

## 10. Known issues / deferred
- SC-7 (live Playwright workspace-width measurement) UNVERIFIED — recommend the tester drive a real web build to confirm the card width ≈ workspace width on the isWideDesktop shell. The style now byte-matches the Seth-confirmed-working tableCard, so high confidence.
- Pre-existing `react-dom/server` TS7016 declaration warning in both web-render test files — predates R4 (present at b2cb2e972); these configs use babel, not tsc; benign.

## 11. Operator action required
- No migration, no edge deploy.
- Merge the PR → Vercel builds business web → the empty venue cards render full-width.
- Do NOT `eas update` the business channel (COMMS-0052 BLOCK; native unaffected anyway).

## 12. Discoveries for orchestrator
- **R3 left TWO test files encoding the disproven "width:100% absent" theory** (`...orch1190r2.web.render.test.tsx` AND `...orch1190r3.web.render.test.tsx`). R3 rewrote the R2 file's assertions to match the R3 theory while leaving the R2 header describing the correct R2 contract — self-contradictory. R4 reconciled both to the proven contract under `[TEST-MOD-APPROVED ORCH-1190]`. Going forward there is one consistent contract across both files.
- None of the ORCH-1190 web-render jest configs are wired into a CI workflow (no `.github/` references). They are run manually. If the orchestrator wants them gate-enforced, register them in `strict-grep-mingla-business.yml` or a jest CI job.
