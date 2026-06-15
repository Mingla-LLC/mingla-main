# IMPLEMENTATION — ORCH-1138 Leg 1 — "Where you'll be" static Mapbox map (public trip page)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` · branch `ORCH-1138-trip-page-redesign`
**Date:** 2026-06-15 · **Dispatched by:** orchestrator (Seth)

## 1. Summary

The public trip page (`/t/{brandSlug}/{tripSlug}`) "Where you'll be" section now renders a real
**static Mapbox map image** (themed accent pin + destination caption pill), matching the
`DIRECTION_A_V2_FULL_RESPONSIVE.html` mockup. It uses the **existing client-safe PUBLIC `pk.*`
Mapbox token** as a plain `<Image>` URL (Mapbox Static Images API) — **NO new dependency, NO map
SDK, NO schema/edge/migration change**. The R2 implementor had left an honest STOP-AND-REPORT
fallback (pin-only card) because no client token was wired into the business build; this leg wires
that token the inlining-safe way (mirrors the proven GIPHY pattern) and renders the image, while
keeping the honest fallback when the token or coords are absent (Constitution rule 9 — hide, never
fabricate, never crash).

## 2. SPEC success-criteria coverage

This is the map portion of Leg 1 SC-13 (no dead taps / real map) + §4.4 step 8 (static map block,
destination lat/lng, omitted when null). Other Leg-1 SCs were satisfied by prior commits.

| Criterion | Status | Evidence (HEAD after commit) |
|-----------|--------|------------------------------|
| §4.4 #8 — static map block, real lat/lng, themed pin + caption, omitted when null | ✓ | `TripPreview.tsx` map block + `mapboxStaticImage.ts` |
| SC-13 — map is not a dead/placeholder element; real handler/content | ✓ | renders a real Mapbox image when token+coords present |
| Rule 9 — no placeholder/fabricated map; hide on missing data | ✓ | `buildStaticMapUrl` returns null → image hidden; test `mapboxStaticImage.orch1138.test.ts` |
| Works on native AND react-native-web | ✓ | plain RN `<Image>` with a URL (no native module) |
| No new dependency | ✓ | `expo-constants` already a dep (`package.json:103`); only `<Image>` + a URL string |
| Inlining-safe token read | ✓ | `Constants.expoConfig?.extra` FIRST + STATIC `process.env` fallback (giphy pattern) |

## 3. Files changed

| File | Δ | Note |
|------|---|------|
| `mingla-business/app.config.ts` | +15 | add `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` to `extra` (reads `process.env`, `?? null`, no throw, no literal) |
| `mingla-business/.env.example` | +6 | document the var name (value blank) |
| `mingla-business/src/components/trip/TripPreview.tsx` | +43/−9 | import builder; render `<Image>` map when URL present, else honest pin+caption fallback; add `mapImage` style |
| `mingla-business/src/utils/mapboxStaticImage.ts` | NEW (92) | pure URL builder + inlining-safe token read |
| `mingla-business/src/utils/__tests__/mapboxStaticImage.orch1138.test.ts` | NEW (113) | regression test (10 cases) |

## 4. Env var name + inlining-safe read

- **Env var:** `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (a PUBLIC `pk.*` token — client-safe by design;
  distinct from the server-only `MAPBOX_ACCESS_TOKEN` behind the `mapbox-geocode` edge fn).
- **app.config.ts emission:** `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null`
  inside `extra` — NO hardcoded literal, NO throw (a missing token degrades one page, not the build).
- **Runtime read** (`mapboxStaticImage.ts` `getPublicMapboxToken`):
  `Constants.expoConfig?.extra?.["EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN"]` FIRST (the only path that
  survives Hermes standalone/OTA builds), then a **STATIC** `process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`
  fallback (so the Metro-dev / web-export path resolves). This mirrors `giphyEventCoverService.ts`
  exactly — a dynamic `process.env[name]` read is NOT inlined by babel-preset-expo.

## 5. Static-map URL builder

```
https://api.mapbox.com/styles/v1/mapbox/<style>/static/
  pin-s+<accentHexNoHash>(<lng>,<lat>)/<lng>,<lat>,<zoom>/<w>x<h>@2x
  ?access_token=<token>
```
Defaults: style `dark-v11` (matches the immersive chrome), zoom 11, 600×300@2x. The pin color is the
brand `palette.accent` with the leading `#` stripped and validated (3/6-char hex), falling back to
`eb7825` (MINGLA_DEFAULT_THEME) if malformed so the URL never breaks. Coords are emitted **lng,lat**
(Mapbox is lon-first).

## 6. Fail-safe behavior (Constitution rule 9)

`buildStaticMapUrl` returns `null` (→ `<Image>` not rendered, honest pin+caption card shown) when:
- the token is absent / empty / whitespace at runtime, OR
- `lat`/`lng` is `null`/`undefined`/non-finite (`NaN`/`Infinity`).

The outer JSX gate `bt.destinationLat !== null && bt.destinationLng !== null` is **preserved**
(required by the append-only `tripNoFabricatedFields.orch1138.test.ts` gate). Never a fabricated tile,
never a crash.

## 7. Old → New receipt — `TripPreview.tsx`

- **Before:** the "Where you'll be" card rendered ONLY an accent location icon + destination caption
  pill over an empty surface (R2 STOP-AND-REPORT honest fallback; no client token existed).
- **Now:** when the public `pk.*` token AND real coords are present, a Mapbox static map `<Image>`
  fills the card (themed accent pin at the destination, 0.9 opacity, `cover`), with the accent icon +
  caption pill overlaid (matches mockup `.map`/`.map-pin`/`.map-cap`). When the token or coords are
  absent, it falls back to the prior honest pin+caption card.
- **Why:** §4.4 step 8 / SC-13 — the mockup's real map, now buildable because the client-safe token
  is wired (dispatch-authorized).
- **Lines:** +43/−9.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS | No | consumer app untouched (app-mobile not edited) |
| Consumer Android | No | same |
| Buyer/anon Web (`/t/...`) | **Yes** | static `<Image>` URL renders on react-native-web |
| Business iOS | **Yes** (in-app trip preview) | shared `TripPreview` component → automatic |
| Business Android | **Yes** | shared component → automatic; honors existing glass policy (unchanged) |
| Admin Web | No | not a consumer of TripPreview |
| Business Web preview (wizard Step 5) | **Yes** but inert | wizard passes NO `palette` (LEGACY mode) and trip coords are usually present; the map block is shared, but the wizard render is unaffected by token wiring (image hidden if no token in dev) |

Parity is **automatic** (single shared RN component). No manual per-surface code paths.

## 9. Regression test

- **Path:** `mingla-business/src/utils/__tests__/mapboxStaticImage.orch1138.test.ts` (10 cases).
- **Result:** 10/10 PASS (happy path, themed pin, hex-fallback, no-token→null, empty-token→null,
  null-coords→null, non-finite-coords→null, extra-first read, process.env fallback, default-token read).
- **fails-on-revert VERIFIED** at HEAD: deleting the line
  `if (typeof token !== "string" || token.trim().length === 0) return null;` (true line deletion, not
  a comment-out) makes the suite go RED (`token` possibly null at `encodeURIComponent` + the
  no-token cases fabricate a URL). Restored → 10/10 PASS again.

## 10. Other gates run (all green)

- `tripNoFabricatedFields.orch1138.test.ts` — 4/4 PASS (lat/lng map gate intact, no placeholder).
- `tripPaymentAdditivePalette.orch1138.test.ts` / `tripPageParityRework.orch1138.test.ts` /
  `TripPaymentChoice_orch_1130_regression.test.ts` — 22/22 PASS (R2 parity + ORCH-1130 protected
  callers byte-identical when no palette).
- `orch1116GiphyConfigGuard.test.ts` — 8/8 PASS (app.config.ts change did not break the giphy guard).
- `orch-1130-no-buyer-tax-form.mjs`, `meta-orch-0827-package-isolation.mjs` — PASS.
- `tsc --noEmit`: my touched files contribute ZERO errors (the 315-error count is the pre-existing
  project baseline under the root tsconfig, unrelated to this change).

## 11. Known issues / deferred

- **Smoke = source/test-verified only**, not device-rendered. The map will only show pixels on the
  dev OTA AFTER the operator provisions `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (the public `pk.*` from the
  master keys doc) into the EAS/Vercel env + the OTA shell. Until then the page correctly shows the
  honest pin+caption fallback (by design).
- No `[TRANSITIONAL]` code introduced.

## 12. Operator action required

1. **Provision the token** before the map renders: set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` = the public
   `pk.*` Mapbox token (master keys doc; same value the consumer app uses) in:
   - EAS environment(s) for the business build profiles, and
   - the Vercel project (business web), and
   - the OTA shell env used for the dev OTA publish.
2. No migration. No edge-function deploy. No schema change.
3. Route to **mingla-tester** to flip the map states on a real device/web (token present → real
   map with themed pin; token absent → honest fallback; no-coords trip → no map block).

## 13. Discoveries for orchestrator

- **app.config.ts is NOT in the spec §12 allowlist** (which is render-only). The dispatch explicitly
  authorized `app.config.ts` + the trip render path + `.env.example` for this map fix, so I proceeded
  — flagging it here for the registry. No other off-allowlist files were touched.
- The new util lives at `mingla-business/src/utils/mapboxStaticImage.ts` (app side, NOT the isolated
  `@mingla/offering-rendering` package) so it may read `expo-constants`; package-isolation gate stays
  green.
- COMMS-0029 (WARN/OPEN, `biz_update_live_trip` migration clobber) was read; it does NOT apply —
  this leg makes zero schema/migration/edge changes.
