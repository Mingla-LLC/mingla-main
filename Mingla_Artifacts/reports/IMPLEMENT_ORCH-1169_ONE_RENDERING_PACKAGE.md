# IMPLEMENT — ORCH-1169 [one-rendering-package]

**Status:** COMPLETE — pushed to branch `ORCH-1169-one-rendering-package` (NOT merged).
**Type:** Mechanical refactor, ZERO behavior change.
**Date:** 2026-06-19
**Owner:** mingla-implementor

---

## Goal

Dissolve `@mingla/event-rendering` ENTIRELY into `@mingla/offering-rendering` so the
monorepo has ONE rendering package. `packages/event-rendering/` is DELETED. Per Seth's
decision (after ORCH-1167 made `EventOfferingBody` the single body in
`offering-rendering`, which already depended on `event-rendering`).

---

## What was done

### 1. Source + test files moved (`git mv` → detected as renames)
- **23 source files** moved `packages/event-rendering/*` → `packages/offering-rendering/*`:
  EventCover, EventCoverMedia, GlassBlur, PublicEventNotFound, PublicEventPage, QuantityRow,
  RefundPolicyDisplay, ThemeEntranceAnimation(+.web), coverMediaPresentation, designTokens,
  experienceOpenDaily, formatTripDateRange, mapboxFunctionsBase/StaticImage/StaticProxyUrl/
  StaticUrl/Token, offeringCta, quantityRowFormat, themePalette, themeResolver, types.ts.
  Byte-for-byte preserved (no content edits).
- **6 test files** moved `packages/event-rendering/__tests__/*` → `packages/offering-rendering/__tests__/*`
  via `git mv` (rename-detected — `[TEST-RENAME-APPROVED ORCH-1169]` in commit body).
- No file-name collisions (verified `comm` between the two dirs — only package-level files
  index.ts/package.json/tsconfig.json/__tests__ "collided", merged intentionally).

### 2. Index merge (`packages/offering-rendering/index.ts`)
- Appended EVERY symbol the old `event-rendering/index.ts` exported, now from LOCAL modules.
- **Removed the now-duplicate cross-package re-export block** (`offeringSurfaceStyles`,
  `resolveOfferingSurface`, `OfferingSurfaceStyles` from `@mingla/event-rendering`) — these
  are now LOCAL (`./themePalette`). Verified ZERO duplicate export names (script-checked).
- No export-name or type-name collisions (`types.ts` etc. all unique).

### 3. Internal imports fixed (offering-rendering → local relative)
6 files repointed `from "@mingla/event-rendering"` → local `./` imports, grouped by source
module: CountAwareGallery, ChipGroup, OfferingChrome, ParallaxCoverShell, RsvpMomentumDecision,
EventOfferingBody (split into `./themePalette`, `./offeringCta`, `./types`, `./designTokens`).

### 4. External importers repointed (`@mingla/event-rendering` → `@mingla/offering-rendering`)
- **131 files modified** across `mingla-business/`, `app-mobile/`, `packages/brand-rendering/`,
  `packages/theme-animations/` (symbol names unchanged — specifier only).
- `mingla-admin/` imports event-rendering NOWHERE (verified) — no admin changes.

### 5. Config aliases (exhaustive)
- `mingla-business/tsconfig.json` + `app-mobile/tsconfig.json`: event-rendering path-alias
  pair REMOVED (package gone).
- `mingla-business/metro.config.js` + `app-mobile/metro.config.js`: event-rendering
  `extraNodeModules` alias REMOVED. (No root tsconfig; no babel module-resolver; mingla-admin
  has no tsconfig path-alias.)
- `mingla-business/jest.orch1147r2.render.cjs`: `moduleNameMapper` key + path repointed to
  `offering-rendering/QuantityRow.tsx`.
- Both metro configs load cleanly (node-validated): offering alias → correct dir,
  event-rendering alias absent.

### 6. package.json
- `packages/offering-rendering/package.json`: removed `@mingla/event-rendering` peerDep;
  MERGED event-rendering's peerDeps (expo-video, expo-blur, expo-constants, expo-image,
  expo-linear-gradient, lottie-react-native) into offering's (kept the exact prior contract).

### 7. Strict-grep + CI gates updated (path repoints, all PASS)
- `.github/scripts/strict-grep/`: orch-0978 (EventCoverMedia.tsx + index.ts paths),
  orch-1162 (single-owner path + re-export specifier — incl. escaped-slash regex),
  orch-1117, orch-0964-theme-resolver-canonical, orch-0964-theme-foreground-computed,
  orch-0783, orch-1153, orch-0805 (comment), orch-0964-checkout-no-brand-theme (regex).
- I-MOR-0827 package-isolation gate (`meta-orch-0827-package-isolation.mjs`): path-AGNOSTIC
  (walks all of `packages/`, skips `__tests__`) — NO change needed; verified it now treats
  offering-rendering as the sole rendering package and still forbids app-src imports. PASS.
- app-mobile CI: orch-0847, orch-0846, meta-orch-1002-android-glass-adversarial.
- packages/scripts CI: meta-orch-1002-sub-c-shared-glass-check (+adversarial).
- Test-file readFileSync source paths + relative-imports repointed across ~29 test files
  (mingla-business + app-mobile + mingla-marketing comments + supabase comment).

### 8. Latent test bug fixed (exposed by the merge, not introduced)
`offeringRenderingIsolation.orch1138.test.ts` `walk()` did NOT skip `__tests__`; the merged
package now has more (Deno) tests that legitimately use `node:fs` + readFileSync app paths,
tripping the FORBIDDEN regex. Fixed `walk()` to skip `__tests__` (mirrors the canonical
strict-grep gate). Also broadened its allowed-external-import set to the declared expo
peer-deps (the package now legitimately pulls expo-video/blur/etc. via the cover/theme/glass
primitives). Same I-MOR-0827 intent preserved. → 3/3 PASS.

### 9. event-rendering DELETED
`packages/event-rendering/` (package.json, tsconfig, index.ts, all moved files, empty
`__tests__`) removed entirely. `ls packages/event-rendering` → No such file or directory.

### 10. Zero remaining references
Repo-wide grep: ZERO `@mingla/event-rendering` (specifier) and `packages/event-rendering`
(path) anywhere, EXCEPT `Mingla_Artifacts/` docs and a single intentional ORCH-1169
historical-note comment in the isolation test documenting the merge.

---

## Verification

### Typecheck (the no-behavior-change gate) — baseline vs after
| App | Baseline `error TS` | After | Delta |
|---|---|---|---|
| mingla-business | 461 | 461 | **0** |
| app-mobile | 562 | 562 | **0** |
| mingla-admin | 0 | 0 | **0** |

The diff shows the SAME pre-existing package-file errors (strict/JSX resolution when the
app's tsc visits package source) merely RELOCATED from `packages/event-rendering/*` paths to
`packages/offering-rendering/*` paths — identical error text, identical count. **ZERO new
errors introduced.** Broken module resolution would have surfaced here; it did not.

### Strict-grep gates — ALL PASS
I-MOR-0827 package-isolation; ORCH-0978 autoplay-muted; ORCH-1162 map-single-owner;
ORCH-1153 opendaily; ORCH-0964 (resolver-canonical, foreground-computed, checkout-no-brand-theme);
ORCH-0783; ORCH-1117; ORCH-0805; the 5 ORCH-1167 (shell-agnostic-body, allin-price-in-ticket-box,
canonical-9-section-order, city-level-map, one-read-rpc) — incl. `--self-test` fails-on-revert
verified on all 4 that support it; the 6 ORCH-1138 gates. meta-orch-1002 glass checks
(app-mobile 29/29, packages 9/9 + 5/5).

### Jest
- offering-rendering package suite: 8 jest-compatible suites PASS (52 tests), incl. every
  orch_1167 cover/box test whose internal `../<file>` imports + readFileSync paths I repointed
  (r2/r3/r4/r5/r7/r8 + event_box_totals). The 13 "failed-to-run" suites are PRE-EXISTING
  **Deno** tests (`https://deno.land/...` imports, `.ts`-extension imports, `Deno.test`) that
  never ran under jest — unchanged by this refactor.
- `offeringRenderingIsolation.orch1138` → 3/3 PASS (after the walk()-skip-__tests__ fix).
- `orch_1138_event_foundation` → 30 assertions PASS via node (it's a node:assert source-test;
  jest reports "0 tests" by design — pre-existing). The repointed
  `read("../packages/offering-rendering/PublicEventPage.tsx")` resolves correctly.
- `createThemePalette.parity`, `offeringCta.orch1117`, `resolveRsvpCta.orch1150`,
  `QuantityRow.waitlist` (all import via repointed relative `../../../../../packages/
  offering-rendering/*` paths) → PASS.
- Pre-existing failures (NOT mine — my edits to these files were rendering-string-only,
  git-diff-confirmed): `serverDraftLifecycleGuards` (ENOENT `app/(tabs)/events.tsx` +
  router.replace content drift), `eventCoverMedia.test` (component content assertions),
  orch-0847/0846 (reference a deleted `ExpandedBusinessEventSheet.tsx`). All rendering-package
  checks in those gates PASS.

### Web export (bundler integrity)
`npx expo export -p web` from mingla-business → **EXIT 0**, "Web Bundled 378ms index.js
(554 modules)", produced `dist`. The alias removal did NOT break module resolution; the merged
`@mingla/offering-rendering` resolves end-to-end on react-native-web. (dist cleaned up.)

---

## Guards held
- ZERO logic changes; identical exported symbol names.
- I-MOR-0827 holds — offering-rendering imports nothing from any app `src/` (gate PASS).
- No circular import (event-rendering never imported offering-rendering; merge is one-directional).
- No export/type collisions (script-verified).

## Counts
- **29 files moved** (23 source + 6 tests, all git-rename-detected).
- **131 external importer files repointed** (specifier swap).
- **~29 test files + 6 config/jest files + ~14 gate/CI scripts** updated for paths/aliases.
- **2 tsconfig + 2 metro aliases removed**; **1 package.json peerDep merged**.

## Blockers
None. The refactor is complete and mechanically clean.

## NOT done (out of scope / by design)
- Not merged (branch pushed only, per dispatch).
- Pre-existing unrelated test failures left as-is (documented above).
- Prod `__common` bundle-budget gate not run (needs a prod export; the dev export succeeding
  proves resolution integrity, which is the verification target).
