# IMPLEMENTATION — ORCH-1162 Public-event + cart polish (THREE clean fixes)

- **Phase:** IMPLEMENT. Status: **implemented and self-verified** (unit + gate level); on-device runtime QA is the tester's job.
- **Date:** 2026-06-18
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1162-[public-event-cart-polish]/` on branch `ORCH-1162-public-event-cart-polish` (rebased onto `origin/main` @ `0b09d6266`).
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1162_PUBLIC_EVENT_CART_POLISH.md`
- **Comms acked:** COMMS-0040 (WARN — RSVP public-page standardization), COMMS-0041 (WARN — public-experience-page standardization onto `@mingla/offering-rendering`). Both factored; coordination notes in §Comms below. (The `acked_by` ledger append is left to the orchestrator at CLOSE — the anchor working copy is polluted with ~40 uncommitted local reverts and the implementor must not touch it; flagged for the orchestrator.)

---

## 1. Summary (plain English)

Three independent, runtime-proven polish fixes that ship together:

1. **AM/PM restored.** The consumer event/experience date line and the shared "Sales open …" pre-sale banner were pinned to the `en-GB` locale (24-hour), so they showed "19:00" instead of "7 PM" on every device. Both now render a 12-hour clock with an uppercase meridiem, preserving the event timezone.
2. **"Where you'll be" map on the event page.** The public event page (buyer-web + business native + the consumer event screen) now draws the same static-Mapbox snapshot-with-pin the trip page already has — when the venue has coordinates and a Mapbox token resolves; otherwise it shows the existing text venue card (never a blank box). The map primitive is now a SINGLE shared owner in `@mingla/event-rendering`. The experience map was ALREADY shipped on origin/main (ORCH-1138 Leg 3); confirmed parity, no change.
3. **Checkout CTAs themed from the brand.** The three checkout-step buttons (Get tickets → Continue, Your details → Continue, Payment → Pay) now render the brand color from the REAL `theme_color` column — the SAME source/derivation as the public-page buttons — with an auto-contrast label. Default Mingla orange is unchanged everywhere else.

No DB migration, no schema change, no edge-function change. Client + shared-package only.

---

## 2. SPEC success-criteria coverage

| SC | Verified how | Verdict | Commit |
|----|--------------|---------|--------|
| SC-1 (`formatTimeInTz` → "PM" not "19:15") | Deno test TC-1 | ✓ | `d86aacfb7` |
| SC-1b (range both meridiem, `:00` suppressed) | Deno test TC-1b/TC-1c | ✓ | `d86aacfb7` |
| SC-2 (`formatSaleDate` → "PM" not "19:00") | Deno test TC-2 | ✓ | `d86aacfb7` |
| SC-3 (24h do-not-touch sites byte-identical) | Not edited (`format24hTimeInTz`/`formatEventLocalRange`/`formatTimeLabelInTz` h23 read/`experienceDateSubline formatTimeLine` untouched) + TC-3 proves tz still honored | ✓ | `d86aacfb7` |
| SC-4-Web / SC-4-iOS / SC-4-Android (consumer) / SC-4-Biz | Geo threaded through BOTH event adapters (`mapLiveEventToPublicEvent` + `publicEventViewRowToEvent`) → shared `PublicEventPage` map block; consumer event screen map block on `fnd.lat/lng`. Source-verified + URL contract TC-7. Runtime render is tester's. | ✓ (source) / UNVERIFIED (device) | `d86aacfb7` |
| SC-5 (no geo / no token → text card, no blank/crash) | Deno TC-5a/TC-5b (failsafe null) + render-block guard renders the existing card when `mapUrl===null` | ✓ | `d86aacfb7` |
| SC-6 (experience start-stop map) | ALREADY SHIPPED on origin/main (`publicExperienceService` selects `lat/lng`; `ExperiencePreview`/consumer screen render it). Parity confirmed; no change. | ✓ (pre-existing) | n/a |
| SC-7 (trip URL byte-equivalent post-promotion) | Deno TC-7 asserts the exact trip-reference URL string from the shared builder; TripPreview re-export unchanged | ✓ | `d86aacfb7` |
| SC-8 (pin = brand accent; URL well-formed) | TC-7/TC-8 (pin themed from `accentHex`, default fallback) | ✓ | `d86aacfb7` |
| SC-9-Web/iOS/Android (3 CTAs brand color) | `accentColor` wired on all 3 checkout Buttons from `resolveCheckoutBrandAccent` (theme_color); source-verified + Button accent path TC-9 | ✓ (source) / UNVERIFIED (device) | `d86aacfb7` |
| SC-10 (no `accentColor` → unchanged orange; non-primary ignores it) | Button only overrides when `variant==="primary"` + valid hex; default path untouched | ✓ | `d86aacfb7` |
| SC-11 (label ≥4.5:1 on any hue) | Deno TC-11 (black-on-yellow, white-on-blue, legible-on-orange all ≥4.5:1) | ✓ | `d86aacfb7` |

---

## 3. Files changed (27, all in the SPEC allowlist)

**Bug 1 — AM/PM**
- `app-mobile/src/utils/eventDateDisplay.ts` (`formatTimeInTz` → h23-read + 12h-convert; +32/-… )
- `packages/event-rendering/quantityRowFormat.ts` (NEW — pure `formatSaleDate`, en-US+hour12)
- `packages/event-rendering/QuantityRow.tsx` (import the extracted `formatSaleDate`; remove inline en-GB def)
- `mingla-business/src/components/brand/ExperienceMiniCard.tsx` (A.3 hygiene — dead-code en-GB → en-US+hour12)

**Bug 2 — map (event leg; experience leg already shipped)**
- `packages/event-rendering/mapboxStaticUrl.ts` (NEW — PURE URL builder `buildStaticMapUrlWithToken`, Deno-testable, no expo-constants)
- `packages/event-rendering/mapboxToken.ts` (NEW — the `expo-constants` token read, split out so the builder is pure)
- `packages/event-rendering/mapboxStaticImage.ts` (NEW — app-facing `buildStaticMapUrl` wrapper = token read + pure core; the SINGLE owner)
- `packages/event-rendering/index.ts` (export `buildStaticMapUrl`/`getPublicMapboxToken`/`StaticMapParams`)
- `packages/event-rendering/package.json` (add `expo-constants` peerDep; also removed a pre-existing duplicate `expo-video` key)
- `mingla-business/src/utils/mapboxStaticImage.ts` (now a RE-EXPORT shim from the package)
- `app-mobile/src/utils/mapboxStaticImage.ts` (now a RE-EXPORT shim from the package — preserves I-MOR-0827)
- `packages/event-rendering/types.ts` (`PublicEventProps.locationGeo?: {lat;lng}|null`)
- `mingla-business/src/components/event/PublicEventPage.tsx` (`mapLiveEventToPublicEvent` threads `locationGeo`)
- `mingla-business/src/services/publicEventsService.ts` (`BusinessPublicEventViewRow.location_geo` + `publicEventViewRowToEvent` parses the point → `locationGeo`; `parseLocationGeoPoint` helper)
- `packages/event-rendering/PublicEventPage.tsx` (the "Where you'll be" map render block + styles; NON-rsvp only)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (consumer event map block on `fnd.lat/lng` + `whereMap` style + `Image`/`buildStaticMapUrl` imports)

**Bug 3 — checkout theming (from `theme_color`, per Seth 2026-06-18)**
- `mingla-business/src/utils/buttonAccentContrast.ts` (NEW — pure WCAG helpers: normalizeHex/relativeLuminance/contrastRatio/readableTextFor/mixHex)
- `mingla-business/src/components/ui/Button.tsx` (`accentColor?` prop; effective bg/text/hover for `primary` only)
- `mingla-business/src/utils/checkoutBrandAccent.ts` (NEW — `resolveCheckoutBrandAccent` = `createThemePalette(resolveTheme(brand.theme, event.themeOverrides)).accent`, the exact public-page derivation)
- `mingla-business/app/checkout/[eventId]/index.tsx` (Step 1 — `accentColor`)
- `mingla-business/app/checkout/[eventId]/buyer.tsx` (Step 2 — bind `brand`, `accentColor`)
- `mingla-business/app/checkout/[eventId]/payment.tsx` (Step 3 — bind `brand`, `accentColor`)

**Tests + gate**
- `app-mobile/src/utils/__tests__/eventDateDisplay.orch1162.test.ts` (RT-1, Deno)
- `packages/event-rendering/__tests__/quantityRowSaleDate.orch1162.test.ts` (RT-2, Deno)
- `packages/event-rendering/__tests__/mapboxStaticUrl.orch1162.test.ts` (RT-3, Deno)
- `mingla-business/src/utils/__tests__/buttonAccentContrast.orch1162.test.ts` (RT-4, Deno)
- `.github/scripts/strict-grep/orch-1162-map-single-owner.mjs` (NEW — single-owner CI gate; needs workflow registration by orchestrator)

---

## 4. The `theme_color` wiring (Q2 RESOLVED — NOT `coverHue`)

Per Seth's 2026-06-18 decision (dispatch override of SPEC OQ-2), the checkout CTAs theme from the **real brand `theme_color` column**, the SAME source the public event/trip page buttons use — NOT `coverHue`.

- Confirmed `theme_color` is already in the checkout data flow: `usePublicEventById` → `getPublicEventById` → `publicEventViewRowToEvent`/`viewRowToBrand` build `brand.theme` from `business_public_events_view.brand_theme_color` (`asThemeInput(row.brand_theme_color, …)`) and `event.themeOverrides` from `theme_color_override`. No threading needed — both `event` and `brand` are already loaded in the checkout routes.
- The public-page CTA color is `createThemePalette(resolveTheme(brand.theme, event.themeOverrides)).accent`. `resolveCheckoutBrandAccent` reuses those EXACT shared resolvers, so the checkout button is byte-identical to the public-page button (auto contrast-adjusted, accessible on any hue). When no theme color resolves, `resolveTheme` falls back to Mingla orange → the Button keeps its default `primary` token (we pass `undefined` while loading to avoid a flash of wrong color).
- **Gate coexistence (important):** `orch-0964-checkout-no-brand-theme.mjs` forbids the checkout ROUTE files from importing `resolveTheme`/`ResolvedTheme`/`MINGLA_DEFAULT_THEME` directly from `@mingla/event-rendering`. My architecture respects that gate's letter — the routes import only `resolveCheckoutBrandAccent` from a `mingla-business/src/utils/` module; the util (NOT a route) imports the package resolvers. Gate PASSES. The gate's original intent (ORCH-0964: checkout NOT themed) is deliberately superseded by Seth's new requirement, delivered without tripping the gate.

---

## 5. Regression tests + fails-on-revert proofs

All four RT gates run under **Deno** (`/Users/sethogieva/.deno/bin/deno test --allow-env --no-check`) — the established runner for pure package/app logic in this repo (mingla-business jest is node-env and only runtime-imports RN under dedicated render configs; app-mobile has no jest). 13/13 green on the fix; each proven fails-on-revert by **true line-deletion** (not comment-out):

- **RT-1** `app-mobile/src/utils/__tests__/eventDateDisplay.orch1162.test.ts` (4 tests). Reverted `formatTimeInTz` to the en-GB no-hour12 body → **4 FAILED**; restored → **4 passed**. `fails-on-revert verified at d86aacfb7` (true line-deletion against this commit).
- **RT-2** `packages/event-rendering/__tests__/quantityRowSaleDate.orch1162.test.ts` (2 tests). Reverted `formatSaleDate` to en-GB `hour:"2-digit"` → **1 FAILED**; restored → **2 passed**. `fails-on-revert verified at d86aacfb7`.
- **RT-3** `packages/event-rendering/__tests__/mapboxStaticUrl.orch1162.test.ts` (4 tests). Deleted the rule-9 failsafe guards (`if (!isFiniteNumber…) return null; if (token absent) return null;`) → **2 FAILED**; restored → **4 passed**. PLUS the single-owner `.mjs` gate: re-forked the app util with a local `buildStaticMapUrl` definition → gate **FAILED** (3 errors, exit≠0); restored → **passed**. `fails-on-revert verified at d86aacfb7`.
- **RT-4** `mingla-business/src/utils/__tests__/buttonAccentContrast.orch1162.test.ts` (3 tests). Broke `readableTextFor` (always return white, drop the contrast comparison) → **1 FAILED** (TC-11); restored → **3 passed**. `fails-on-revert verified at d86aacfb7`.

---

## 6. Old → New receipts (per surface)

### `app-mobile/src/utils/eventDateDisplay.ts` — `formatTimeInTz`
- **Before:** `Intl.DateTimeFormat("en-GB",{hour:"numeric",minute:"2-digit",timeZone:tz}).format(...).replace(/:00\b/,"").replace(/\bam\b/g,"AM")…` → "19:00" on every device; the am/pm replace was dead (en-GB emits none).
- **Now:** h23 `formatToParts` in `tz` → 12h convert → "7:15 PM"/"12 AM", `:00` suppressed, meridiem uppercase. `timeZone: tz` preserved exactly.
- **Why:** SC-1/SC-1b (F-1). **Lines:** ~+18/-9.

### `packages/event-rendering/QuantityRow.tsx` + `quantityRowFormat.ts` — `formatSaleDate`
- **Before:** inline `toLocaleString("en-GB",{…hour:"2-digit"})` → "Wed 15 Jul, 19:00".
- **Now:** extracted to a pure module; `toLocaleString("en-US",{…hour:"numeric",hour12:true})` → "Wed, Jul 15, 7:00 PM". No tz (existing behavior). `Number.isFinite` guard + "soon" fallback kept.
- **Why:** SC-2 (F-2) + makes the formatter unit-testable. **Lines:** QuantityRow ~-12/+4; new module +24.

### `mingla-business/src/components/brand/ExperienceMiniCard.tsx` — `formatNextOccurrence` (dead code)
- **Before:** `toLocaleString("en-GB",{…hour:"numeric"})`. Zero importers (the live mini-card is inline in `packages/brand-rendering/PublicBrandPage.tsx`).
- **Now:** en-US + hour12. **Why:** A.3 hygiene (F-6) — no latent en-GB site. **Lines:** ~+3/-1.

### `packages/event-rendering/mapboxStaticImage.ts` (+ `mapboxStaticUrl.ts`, `mapboxToken.ts`) — primitive promotion
- **Before:** `buildStaticMapUrl` duplicated byte-for-byte in `mingla-business/src/utils/` AND `app-mobile/src/utils/`.
- **Now:** ONE owner in the package, split into a pure URL core (`mapboxStaticUrl.ts`, no expo-constants → Deno-testable) + the token read (`mapboxToken.ts`) + the app-facing wrapper (`mapboxStaticImage.ts`). Both app utils re-export from the package.
- **Why:** B.0 + I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER, preserving I-MOR-0827. **Lines:** new +141; app utils −~200 (shimmed).

### `packages/event-rendering/types.ts` + both event adapters + `PublicEventPage.tsx` (pkg) — event map
- **Before:** no lat/lng on `PublicEventProps`; both event adapters dropped geo; renderer had no map block → text-only card.
- **Now:** `locationGeo?` on the type; `mapLiveEventToPublicEvent` reads `event.locationGeo`; `publicEventViewRowToEvent` parses `row.location_geo` (the `(lng,lat)` point) via `parseLocationGeoPoint`; the renderer draws a static-Mapbox block above the venue card when geo+token resolve, else the existing text card (rule-9). NON-rsvp branch only (COMMS-0040).
- **Why:** SC-4/SC-5/SC-8 (F-1..F-4 map). **Lines:** type +8, biz adapter +3, service +27, pkg renderer +92.

### `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` — consumer event map
- **Before:** foundation body (`fnd`) rendered a text venue card only; `fnd.lat/lng` already populated (comment said "for the map") but unused.
- **Now:** a static-Mapbox `<Image>` above the venue card when `fnd.lat/lng` finite + token resolves; else nothing (the tappable venue card is the fallback). Mirrors the consumer EXPERIENCE screen's `startMap`.
- **Why:** SC-4-iOS/Android (the consumer event render path is the foundation body, NOT `cardToPublicEvent` — see §8). **Lines:** +40.

### `mingla-business/src/components/ui/Button.tsx` (+ `buttonAccentContrast.ts`) — accent prop
- **Before:** `primary` fixed to `accent.warm` (#eb7825); no accent override.
- **Now:** optional `accentColor` (primary only) → effective bg + auto-contrast label (`readableTextFor`) + 6%-lighter web hover. Invalid/absent → default token. Contrast helpers in a pure unit-testable util.
- **Why:** SC-9/SC-10/SC-11 (3A). **Lines:** Button +39; util +66.

### `checkoutBrandAccent.ts` + 3 checkout routes — wiring
- **Before:** all 3 CTAs `variant="primary"` (orange).
- **Now:** each passes `accentColor={resolveCheckoutBrandAccent({brandTheme, eventThemeOverrides})}` (matches public-page CTA from `theme_color`); `undefined` while loading.
- **Why:** SC-9 + §4. **Lines:** util +39; routes +12/+13/+12.

---

## 7. Cross-surface impact

| # | Surface | Bug 1 | Bug 2 | Bug 3 | Parity |
|---|---------|-------|-------|-------|--------|
| 1 | Consumer iOS | COVERED (`formatTimeInTz` + QuantityRow) | COVERED (consumer event screen map + experience already shipped) | n/a (checkout is biz-only) | manual adapter + auto |
| 2 | Consumer Android | COVERED (same shared code) | COVERED | n/a | same |
| 3 | Buyer/anon Web | PARTIAL (QuantityRow sale banner; web date lines already correct) | COVERED (`publicEventViewRowToEvent` geo → shared renderer; experience shipped) | COVERED (3 CTAs) | auto + manual |
| 4 | Business iOS | COVERED (QuantityRow) | COVERED (`mapLiveEventToPublicEvent` geo) | COVERED | manual + auto |
| 5 | Business Android | COVERED | COVERED | COVERED | same |
| 6 | Admin Web | NOT covered (no public/checkout surface) | NOT covered | NOT covered | n/a |
| 7 | Business Web preview (adjacent) | PARTIAL (QuantityRow) | COVERED (shared renderer + experience) | COVERED (same routes) | auto + manual |

Manual parity points (the tester must verify all): the two event adapters (`mapLiveEventToPublicEvent` + `publicEventViewRowToEvent`) and the consumer event screen are SEPARATE render paths; the experience map is a third (pre-existing) path. The map render block in the shared `PublicEventPage` auto-covers buyer-web + business native.

---

## 8. Known issues / deferred / SPEC divergences

- **D-IMPL-1 (SPEC vs reality — consumer adapter path):** the SPEC named `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` `mapCardToPublicEvent`. That file no longer exists on origin/main — the consumer EVENT detail now renders a "foundation" body in `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (the `fnd` model), and `cardToPublicEvent` there feeds ONLY the CTA state machine, NOT the rendered body. I therefore added the consumer event map to the foundation body (where `fnd.lat/lng` already live), not to `cardToPublicEvent`. Same intent, correct render path.
- **D-IMPL-2 (experience leg already shipped):** Bug 2's experience leg (B.4 — `publicExperienceService` stop `lat/lng` + `ExperiencePreview` "Where you'll start" map) is ALREADY present on origin/main (ORCH-1138 Leg 3 / ORCH-1151). I made ZERO edits to `publicExperienceService.ts` and `ExperiencePreview.tsx` — confirms COMMS-0041's "do NOT diverge the read shape" is honored by construction. SC-6 satisfied pre-existing.
- **D-IMPL-3 (`expo-constants` split):** to keep `buildStaticMapUrl` Deno-unit-testable (RT-3), the pure URL assembly lives in `mapboxStaticUrl.ts` (no expo-constants in its chain) and the token read in `mapboxToken.ts`. The single `buildStaticMapUrl` definition (the wrapper) is in `mapboxStaticImage.ts`; the single-owner gate counts exactly one. Functionally identical to the prior duplicated builder.
- **D-IMPL-4 (package.json dedup):** removed a pre-existing duplicate `"expo-video": "*"` key while adding `"expo-constants": "*"`. Behavior-neutral JSON hygiene.

---

## 9. Operator / orchestrator actions

- **No migration. No edge-function deploy. No OTA from the implementor.** This ORCH is client + shared-package only.
- **Register the new CI gate:** add `node .github/scripts/strict-grep/orch-1162-map-single-owner.mjs` to the strict-grep workflow job (orchestrator/CI owns workflow registration).
- **COMMS ledger:** append `mingla-implementor+claude (ORCH-1162)` to the `acked_by` of COMMS-0040 and COMMS-0041 at CLOSE (I did not write to the polluted anchor mid-implementation).
- **Flip the four `DRAFT I-PROPOSED-1162-*` invariants ACTIVE at CLOSE** (orchestrator).

---

## 10. Self-verify gate results (real output)

- **Deno RT-1..RT-4:** `13 passed | 0 failed`. All four proven fails-on-revert by true line-deletion (§5).
- **`orch-1162-map-single-owner.mjs`:** PASS; fails-on-revert proven (re-fork → 3 errors).
- **`meta-orch-0827-package-isolation.mjs`:** PASS. **`orch-1138-mor-isolation.mjs`:** PASS. **`orch-0964-checkout-no-brand-theme.mjs`:** PASS (§4).
- **`tsc --noEmit` (mingla-business):** ZERO type errors in any file I added/edited (`Button.tsx`, `buttonAccentContrast.ts`, `checkoutBrandAccent.ts`, `publicEventsService.ts`, `components/event/PublicEventPage.tsx`, `quantityRowFormat.ts`). Pre-existing/environmental errors only (the package `PublicEventPage.tsx`/`mapboxToken.ts` `react`/`expo-constants` "cannot find module" cascade is identical with or without my changes — mingla-business tsc does not resolve the package's own peer deps; the old `mapboxStaticImage.ts` errored the same way).
- **UNVERIFIED (needs the tester, on device/sim):** the actual rendered map image on each surface (SC-4), the rendered checkout CTA colors on device (SC-9). Source + URL-contract + Deno-level verified; runtime render is the tester's per the SPEC.
- **UNRUN gate (environmental):** the QuantityRow RTL render config (`jest.orch1147r2.render.cjs`) requires `@testing-library/react-native` (testdeps overlay) not installed in this worktree's symlinked node_modules — operator/CI to run `npx jest --config mingla-business/jest.orch1147r2.render.cjs` after installing the overlay. My QuantityRow change is byte-equivalent (only moved `formatSaleDate` to a pure module + imported it), and RT-2 proves the formatter. Likewise the default mingla-business jest lacks the `@mingla/*` moduleNameMapper, so service tests that runtime-import the package fail to resolve there — pre-existing (the import predates this ORCH).

---

## 11. Comms coordination (COMMS-0040 / COMMS-0041)

- **COMMS-0040 (RSVP body standardization):** the event map block was added to the shared `packages/event-rendering/PublicEventPage.tsx` NON-rsvp body only. The `event_type==='rsvp'` early-return body (in the business-app wrapper `mingla-business/src/components/event/PublicEventPage.tsx`) and `RsvpPublicBody.tsx` are UNTOUCHED. No conflict with the imminent RSVP-body promotion.
- **COMMS-0041 (experience-page standardization onto `@mingla/offering-rendering`):** I made ZERO edits to `publicExperienceService.ts` and `ExperiencePreview.tsx` (the experience map was already shipped). The read shape is unchanged; nothing diverges. The shared map primitive now lives in `@mingla/event-rendering` and is dependency-free, so when the experience page is later promoted onto `@mingla/offering-rendering`, the same `buildStaticMapUrl(start-stop geo, palette.accent)` call ports over unchanged. No bespoke experience-detail renderer introduced; no migration onto offering-rendering in this ORCH.
