# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] — SIX device-feedback trip-page parity fixes

**Status:** implemented and verified (sim-verified on iPhone 17 Pro, iOS 26.4).
**Scope:** UI-only. NO schema / edge / checkout / dependency change. All-surface (consumer + business/web).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`.

## 1. Summary

Fixed the six trip-page issues from Seth's device screenshots:

1. **Dedup title/eyebrow (consumer)** — the eyebrow + title rendered TWICE (a seam-overlaid copy AND the in-body lead). Removed the seam copy; the eyebrow/title now render exactly once in the body, matching the business PHONE behavior (where ParallaxCoverShell renders the hero eyebrow/title only on desktop).
2. **Normalize destination everywhere** — the eyebrow trailing location, the 📍 location chip, and the route block now all read the normalized "City, Country" (e.g. "Washington, USA") via the shared `normalizeCityCountry`, on BOTH consumer and business/web.
3. **Brand "Presented by" cover** — was a plain `<Image>` (business) / a `label="Cover"` fallback truncating to the broken "COVE…" (consumer). Now renders via the media-aware `EventCoverMedia` (image + gif + muted inline video) with a CLEAN themed hue gradient fallback (`label=""`) when there's no cover. Business hook now also reads `cover_media_type` + `cover_hue` (anon-safe columns) so animated brand covers render.
4. **"Choose how you pay"** — the consumer module now mirrors the business `PaymentMockupCard` exactly: same heading "Choose how you pay", the full-width tabbed Pay-in-full / Pay-over-time toggle (dark track, active = accent fill), 34px amount block, "Due today" label, schedule rows + total, and the same sub-copy ("One payment, all-in. Taxes & fees included." / "{pct}% deposit now, then N payments. {total} total — no extra cost.").
5. **Floating Reserve bar safe-area** — the bar's price line ("From … today") bled under the home indicator. Root cause: the bar floats inside the gorhom BaseBottomSheet, whose context resolved `useSafeAreaInsets().bottom` to ~0 AND overshoots its content bottom below the viewport. Fix: the bar now uses `max(screen-passed inset, own inset, 34) + 28pt gorhom overshoot`; the screen passes its own inset down; scroll clearance matches. SIM-VERIFIED clear above the home indicator in both pay-in-full and pay-over-time states.
6. **Standard order on all surfaces** — Cancellation policy renders BEFORE How-you-pay. Consumer already did; reordered the business/web TripPreview left column (was payment-then-cancellation).

## 2. SPEC success-criteria coverage

| Fix | Surface | Verified | How |
|-----|---------|----------|-----|
| FIX-1 dedup title/eyebrow | Consumer | ✓ | sim: title/eyebrow render once; test FIX1a-d (fails-on-revert) |
| FIX-2 normalize destination | Consumer (eyebrow+chip+route) | ✓ | sim: "Washington, USA" + "Raleigh, USA → Washington, USA"; test FIX2a-e |
| FIX-2 normalize destination | Business/web (eyebrow+chip+route, phone+desktop) | ✓ | source tests + normalizer; biz test FIX-2 group |
| FIX-3 brand cover media-aware | Consumer | ✓ | sim: clean hue avatar, no "COVE"; test FIX3a-c |
| FIX-3 brand cover media-aware | Business/web | ✓ | EventCoverMedia + hook cover_media_type/cover_hue; biz test FIX-3 group |
| FIX-4 "Choose how you pay" parity | Consumer | ✓ | sim: heading + tab track + €500.00 + "Due today €125.00" + "25% deposit… no extra cost" + schedule; test FIX4a-f |
| FIX-5 reserve bar safe-area | Consumer | ✓ | sim: price line fully above home indicator (pay-full + pay-plan states); test FIX5a-c |
| FIX-6 Cancellation-before-pay | Business/web | ✓ | reordered refundBlock before payment block; biz test FIX-6 group (structural fails-on-revert) |
| FIX-6 order | Consumer | ✓ | already correct; sim confirms Cancellation → Choose how you pay |

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | ~+90/−110 | FIX-1 remove seam dup; FIX-3 brand cover label=""/radius; FIX-4 mockup pay card (replaces old module + styles); FIX-5 safeAreaBottom prop + clearance |
| `app-mobile/src/hooks/useConsumerTripFoundation.ts` | ~+8/−5 | FIX-2 normalize destination (eyebrow/chip/route from same raw source) |
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | ~+25/−3 | FIX-5 safeAreaBottom prop + max(...,34)+28 bottomInset |
| `mingla-business/src/components/trip/TripPreview.tsx` | ~+40/−18 | FIX-2 eyebrow/chip normalized; FIX-3 EventCoverMedia brand cover + brandTile overflow/label; FIX-6 reorder refund before pay |
| `mingla-business/src/hooks/usePublicTripBySlug.ts` | ~+20 | FIX-3 select+map brand cover_media_type/cover_hue + coerceBrandCoverType |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts` | +new | 23 consumer regression assertions |
| `mingla-business/src/components/trip/__tests__/tripParityFixes.orch1138.test.ts` | +new | 11 business regression assertions |

## 4. Data-model changes applied

None. FIX-3 uses existing anon-readable `brands.cover_media_type` + `brands.cover_hue` columns (verified present via read-only introspection). No migration.

## 5. Edge functions touched

None.

## 6. Regression tests added — fails-on-revert proven

- `app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts` — 23 assertions, all pass (`node` runner per app-mobile convention).
- `mingla-business/src/components/trip/__tests__/tripParityFixes.orch1138.test.ts` — 11 assertions, all pass (ts-jest).
- **fails-on-revert verified** (true line-deletion, not comment-out):
  - FIX-1 dedup: re-adding a seam `<Text style={styles.heroTitle}>{fnd.title}</Text>` → FIX1b + FIX1d FAIL.
  - FIX-2 normalize: reverting `const destination = normalizeCityCountry(...)` → `detail.destinationText` → FIX2b FAIL.
  - FIX-6 order (business): structurally moving `{refundBlock}` after `{paymentBlock}` → FIX-6 ordering test FAIL.
- Recorded at commit: see new HEAD below.

## 7. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS | YES — FIX 1,2,3,4,5,6 | — |
| Consumer Android | YES (shared RN; opaque-clip respected on brandTile) | automatic (shared code) |
| Buyer/anon Web | YES — FIX 2,3,6 (TripPreview FOUNDATION) | automatic (one RN codebase) |
| Business iOS | YES — FIX 2,3,6 | automatic |
| Business Android | YES — FIX 2,3,6 | automatic |
| Admin Web | NO — no trip page | n/a |
| Business Web preview | YES — same TripPreview | automatic |

## 8. Smoke result (MANDATORY sim verification)

Ran the consumer app (`com.mingla.app.v2`) on the booted iPhone 17 Pro (iOS 26.4) via a JS bundle exported from the worktree (the dev-client `?url=` rebind would not connect against the parallel sessions' Metros, and the app launches from its embedded `main.jsbundle`; swapping in a worktree-built `expo export:embed` router bundle was the deterministic path). Deep-linked `com.mingla.app.v2:///t/travelbrand/the-dc-adventure` (Seth's exact "The DC Adventure" trip; brand `travelbrand` has a GIF cover).

Confirmed by eye:
- **FIX-1**: eyebrow ("7 DAYS · 6 NIGHTS · WASHINGTON, USA") + title ("The DC Adventure") render ONCE (before: twice).
- **FIX-2**: eyebrow + 📍 chip = "Washington, USA"; route = "Raleigh, USA → Washington, USA" (before: "Washington, District of Columbia, United States").
- **FIX-3**: "PRESENTED BY / Travel Brand" shows a clean themed hue avatar — no "COVE" placeholder.
- **FIX-4**: "Choose how you pay" → tab toggle; "Pay in full" = €500.00 + "One payment, all-in. Taxes & fees included."; "Pay over time" = "DUE TODAY €125.00" + "25% deposit now, then 2 payments. €500.00 total — no extra cost." + schedule rows.
- **FIX-5**: floating bar fully visible above the home indicator in BOTH states (pay-full "From €500" and the taller 2-line pay-plan "Due today · deposit / From €125.00 today") — no bleed.
- **FIX-6**: Cancellation policy renders before Choose how you pay.
- Body scrolls (ORCH-1016/1043 sheet-scroll invariant preserved).

The simulator's installed app was restored to its original embedded bundle after verification; the worktree-Metro and bracket-free symlink were torn down.

## 9. Gates

- TypeScript: clean on all 5 edited source files (app-mobile + business `tsc --noEmit`).
- New tests: 23 consumer + 11 business — all green; fails-on-revert proven.
- strict-grep: 195 pass / 16 "fail" — all 16 verified PRE-EXISTING (identical counts with my changes stashed); zero new violations. orch-1130-no-buyer-tax-form gate PASSES.
- Existing ORCH-1138 jest (orch1138/routeCityCountry/TripVisualParity): 9 failures — verified PRE-EXISTING (identical baseline count; TripVisualParity adversarial Share.share patterns etc.); my changes break none. My new file adds 11 green.
- One pre-existing red node assertion `T6c` in the prior-leg `orch_1138_consumer_trip_foundation.test.ts` was ALREADY failing on baseline (stale earlier-leg regex) — not introduced here; left untouched per append-only.

## 10. Known issues / deferred

- The FIX-5 `+28` "gorhom sheet bottom overshoot" constant is empirically sim-derived (16 clipped, bare 34 clipped, this clears with a clean gap). It is documented inline. A future BaseBottomSheet safe-area refactor (out of scope, ORCH-1016/1043 invariant) could let the bar use a bare device inset.
- The "Where you'll be" map caption pill keeps the full destination text (it is a precise map-pin label, not the eyebrow/chip/route — intentionally out of FIX-2 scope).
- Consumer brand cover is null today (anon-safe data path carries no brand cover — COMMS-0009); EventCoverMedia draws the clean hue fallback. When an anon-safe brand-cover field exists it animates with no further change.

## 11. Operator action required

- None for migrations/edge (none).
- Route back to orchestrator for REVIEW → tester dispatch. Do NOT deploy/merge/close (per dispatch).
- COMMS-0029 (WARN, `biz_update_live_trip` migration clobber) factored in: this ORCH is UI-only with NO migration, so no conflict.

## 12. Discoveries for orchestrator

- The installed consumer dev client on the booted sim launches from its EMBEDDED `main.jsbundle` and would not honor the `com.mingla.app.v2://expo-development-client/?url=` rebind against the (multiple) parallel-session Metros. Deterministic sim verification of pure-JS app-mobile changes was achieved by `expo export:embed --entry-file node_modules/expo-router/entry.js` and swapping the app's embedded bundle (restored after). Worth codifying as a sim-verification fallback when dev-client rebind is contended.
- `EventCoverMedia`'s no-media fallback renders its `label` (default "Cover") which truncates to "COVE…" in small avatars — any small circular consumer of EventCoverMedia must pass `label=""`. (This was the actual consumer FIX-3 bug.)
- Pre-existing reds in this worktree (not mine): node `T6c` in `orch_1138_consumer_trip_foundation.test.ts`; 9 business jest failures (TripVisualParity et al.); 16 strict-grep gates. Flagged for a separate cleanup.
