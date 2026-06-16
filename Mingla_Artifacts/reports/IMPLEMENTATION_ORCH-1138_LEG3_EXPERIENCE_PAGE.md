# IMPLEMENTATION — ORCH-1138 Leg 3: Public EXPERIENCE Page Redesign + Reservation Intelligence + EBES Final Deletion

**Status:** implemented and verified (source + gates + happy-path tests + fails-on-revert) · consumer sim proof BLOCKED (environment — see §9).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` · branch `ORCH-1138-experience-page` · HEAD `7f1d49c54`.
**Comms:** scanned `COMMS_LEDGER.md`. No BLOCK row for me/ORCH-1138/ALL. COMMS-0035 (WARN, OPEN, ALL) acked + honored — Leg 3 adds NO new native module to mingla-business (JS/SQL/edge only; the map block reuses the existing `buildStaticMapUrl`).

## 1. Summary

The last unthemed public offering page (`/exp/{brandSlug}/{experienceSlug}`) is rebuilt onto the same Direction-A foundation the trip (Leg 1) and event (Leg 2) legs ship: parallax cover, brand theming + bold fonts, City,Country meta, vibe chips, a real per-stop itinerary with per-stop count-aware galleries + blurbs, a stop-1 map, and a float→dock **"Reserve"** CTA. The adaptive Reserve flow is wired: a single bookable date goes straight to cart; multiple/recurring open the slot picker; "open daily" opens a date + any-time-in-window + party-size flow — all into the existing checkout via the already-supported `eventDateId` (byte-identical on the null path). Consumer gets a new foundation experience detail screen, and EBES is fully deleted (deck/venue/chat repointed). The recurrence materializer (OQ-1: 52-cap, no cron) is authored as a migration (NOT applied).

## 2. SPEC success-criteria coverage

| SC | Status | Where (all @ `7f1d49c54`) |
|----|--------|---------------------------|
| SC-1 theming (Web/iOS/Android) | ✓ | `/exp/` route resolves `resolveTheme(brand.theme, experience.themeOverrides)`→palette→surface; `ExperiencePreview` FOUNDATION themes all accents/fonts off palette; service returns brand theme + per-experience overrides |
| SC-2 read-path | ✓ | `publicExperienceService` widens SELECT (`ai_description, lat, lng`) + `experience_intents` + per-date remaining; preview renders vibe chips + per-stop blurb + stop-1 map (rule 9 guarded) |
| SC-3 adaptive Reserve (Web/iOS/Android) | ✓ | route: `>1`/open-daily→picker, `===1` auto-select, `0`/single→cart; consumer `beginBooking` ported from EBES; eventDateId only when slot picked |
| SC-4 verb "Reserve" | ✓ | route CTA `label:"Reserve"`; picker `Reserve →`; no "Get my spot" |
| SC-5 single CTA, no split | ✓ | route reuses `TripReserveBar` and never passes `splitCtas` |
| SC-6 open-daily | ✓ | `ExperienceReservePicker` mode `open-daily`: date + time-within-window (`windowMinutes`) + party-size→quantity (I-1, never new lines) |
| SC-7 consumer detail (iOS/Android) | ✓ | `ConsumerExperienceDetailScreen` (mirrors ConsumerEventDetailScreen): gorhom scroll DIRECT child of BaseBottomSheet, pinned cover + chrome + float→dock bar, itinerary; **sim proof BLOCKED §9** |
| SC-8 EBES gone | ✓ | `ExpandedBusinessEventSheet.tsx` + orphaned `ExperienceItinerary.tsx` DELETED; deck/venue/chat repointed; zero live importers (strict-grep gate) |
| SC-9 materialization | ✓ (authored, NOT applied) | migration `20261005000000` — `pg_expand_experience_recurrence` + re-emitted publish/live-edit RPCs |
| SC-10 Android glass | ✓ | all panels use palette-resolved opaque fills (no translucent glass); reuses the foundation primitives' Android-opaque pattern |
| SC-11 rule 9 | ✓ | preview renders NO inclusions/refund/per-stop-price/placeholder-map (asserted) |
| SC-12 wizard byte-stable | ✓ | `ExperiencePreview` LEGACY branch preserved (palette-absent fallback) |

## 3. Files changed

**Business / web (mingla-business):**
- `src/services/publicExperienceService.ts` (+~90) — read-path widen (stop blurb/coords, intents, theme, per-date remaining via `pg_public_ticket_types_remaining`).
- `src/components/experience/ExperiencePreview.tsx` (rewrite, dual-mode) — FOUNDATION (Direction-A) + LEGACY (byte-stable wizard).
- `app/exp/[brandSlug]/[experienceSlug].tsx` (rewrite) — palette resolve + adaptive Reserve + `TripReserveBar` single-CTA + open-daily strip + picker wiring.
- `src/components/experience/ExperienceReservePicker.tsx` (NEW) — web/native-safe slot + open-daily picker (Sheet primitive).
- `src/components/checkout/CartContext.tsx` (+~25) — `eventDateId` state + `setEventDateId`.
- `src/services/ticketCheckoutService.ts` (+~12) — `eventDateId` input + forward-when-present.
- `src/payments/nativeCheckoutFlow.native.ts` / `.ts` (+~10) — `eventDateId` input + body (byte-identical null path).
- `app/checkout-experience/[experienceEventId]/index.tsx` (+~40) — seed `eventDateId` + `quantity` from route params.
- `app/checkout-experience/[experienceEventId]/payment.tsx` (+~6) — thread `cart.eventDateId` into web + native checkout.

**Consumer (app-mobile):**
- `src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (NEW) — foundation consumer detail + itinerary + ORCH-1072 occurrence picker.
- `src/components/ExpandedCardModal.tsx` — deck experience + venue experiences repointed off EBES (`isExperienceCard` discriminator); EBES import removed.
- `src/components/MessageInterface.tsx` — chat repointed (trip→ConsumerTripDetailScreen, event→ConsumerEventDetailScreen); EBES import + mount removed.
- **DELETED:** `src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, `src/components/expandedCard/ExperienceItinerary.tsx` (orphaned EBES-only helper).

**Tests / gates:**
- `mingla-business/src/components/experience/__tests__/experiencePageRedesign.orch1138.test.ts` (NEW, 11).
- `app-mobile/src/screens/Experience/__tests__/orch_1138_consumer_experience_foundation.test.tsx` (NEW, 11).
- `supabase/migrations/__tests__/orch_1138_recurrence_materializer.test.mjs` (NEW, 13).
- `.github/scripts/strict-grep/orch-1138-ebes-deleted.mjs` (NEW) + registered in `strict-grep-mingla-business.yml`.
- Retargeted `[TEST-MOD-APPROVED ORCH-1138]`: `orch_1025_seamless_native_cart.test.tsx`, `BaseBottomSheet.test.mjs`, `YourCircleSection.adversarial.test.tsx` — repointed EBES reads to the foundation successors (no behavioral regression).

**Backend (NOT applied):**
- `supabase/migrations/20261005000000_orch_1138_experience_recurrence_materializer.sql` (NEW).

## 4. Data-model changes applied

None applied. The migration (authored, NOT applied) adds `pg_expand_experience_recurrence(uuid, timestamptz, timestamptz, jsonb, text)` and re-emits `biz_publish_experience` + `biz_update_live_experience` (verbatim from the live `20260911000000` body) with one expander call each. No new tables/columns/RLS — the read-path fields are existing anon-readable columns (`experience_stops.ai_description/lat/lng`, `events.experience_intents`, `brands.theme_*`, `events.theme_*_override`).

## 5. Edge functions touched

None. (The checkout edge fn `ticket-checkout-create` already accepts `eventDateId` — no change; DO-NOT-TOUCH respected.)

## 6. Regression tests + fails-on-revert

- **Business** `experiencePageRedesign.orch1138` — 11 pass. **fails-on-revert PROVEN**: deleting `routeParams.eventDateId = selection.eventDateId` → SC-3 byte-identical case FAILS; restored → 11 pass.
- **Consumer** `orch_1138_consumer_experience_foundation` — 11 pass. **fails-on-revert PROVEN**: replacing `<ConsumerExperienceDetailScreen` with EBES in the modal → SC-8b FAILS; restored → 11 pass.
- **Materializer** `orch_1138_recurrence_materializer` — 13 pass. **fails-on-revert PROVEN**: deleting both `PERFORM ... pg_expand_experience_recurrence` calls → I-4 case FAILS; restored → 13 pass.
- **Gate** `orch-1138-ebes-deleted.mjs` — clean PASS; `ORCH1138_SIMULATE_REVERT=1` FAILS (fails-on-revert proven).
- **Parity intact**: trip foundation (28 checks) + event foundation (29) stay green; surviving EBES-adjacent tests (`orch_1138_reserve_straight_to_cart` 15, `orch1065_experience_expand` 5) pass after deletion.

`fails-on-revert verified at 7f1d49c54.`

## 7. Old → New receipts (key)

- **ExperiencePreview.tsx** — *before:* single-mode dark `EventCoverMedia` hero + flat stops, unthemed. *now:* dual-mode; FOUNDATION = ParallaxCoverShell + palette + vibe chips + per-stop count-aware galleries + blurb + stop-1 map + "Reserve"; LEGACY byte-stable for the wizard. *why:* SC-1/2/11/12.
- **/exp/ route** — *before:* `ExperiencePreview` + `FloatingOfferingBar` "Get my spot" → checkout (no picker). *now:* palette resolve + adaptive Reserve + `TripReserveBar` single-CTA + open-daily strip + `ExperienceReservePicker`. *why:* SC-1/3/4/5/6.
- **ConsumerExperienceDetailScreen.tsx (NEW)** — replaces the EBES hop for deck/venue experiences; foundation-composed; Reserve runs the ORCH-1072 adaptive flow → TicketCartSheet (byte-identical). *why:* SC-7/8.
- **ExpandedCardModal / MessageInterface** — *before:* mounted EBES for venue experiences + chat. *now:* render the foundation detail screens; EBES deleted. *why:* SC-8.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS | YES — new experience detail + repointed deck/venue/chat | Manual (native) |
| Consumer Android | YES — same; opaque-glass via palette fills | Manual |
| Buyer/anon Web (`/exp/`) | YES — themed Direction-A + adaptive Reserve | Manual (RN-web) |
| Business iOS | YES — wizard LEGACY byte-stable; own published `/exp/` themed | Auto (shared ExperiencePreview) |
| Business Android | YES — same + opaque glass | Auto |
| Admin Web | NO — no experience buyer page | — |
| Business Web preview | YES via `/exp/` | Auto |

Server-side read-path + materializer affect every read surface uniformly (parity automatic).

## 9. Smoke result — CONSUMER SIM PROOF BLOCKED (honest)

I attempted the mandatory consumer iOS sim proof per the runbook (booted iPhone 17 Pro, isolated Metro :8099, bracket-free symlink). **Blocked by a hard environment constraint:** the installed consumer dev client (`com.mingla.app.v2`) is bound to the **anchor** project root — its bundle entry resolves to `../../../mingla-main/app-mobile/node_modules/expo-router/entry.js`, which Metro canonicalizes back to the anchor filesystem, NOT this worktree. So a worktree-rooted Metro (and the bracket-free symlink, which resolves back to the bracket path) serves anchor code, not my changes. The worktree has **no `app-mobile/ios/` native project**, so building a fresh dev client from it needs a full `expo prebuild` + CocoaPods + xcodebuild — a heavy native operation, and I must NOT edit the anchor to sync code in. Evidence: `Mingla_Artifacts/evidence/ORCH-1138-exp/SIM_BLOCKER_devclient_bound_to_anchor.png` (Metro module-resolution red screen). All non-sim verification (typecheck, gates, happy-path + fails-on-revert tests, parity) is green. **The tester must run the consumer sim proof against a dev client built from merged main** (or a freshly-prebuilt worktree dev client) to confirm: experience detail renders + scrolls; Reserve → (single) cart / (multi/open-daily) picker → cart; the detail sheet is above the Discover header; events/trips still open their detail after EBES deletion.

## 10. Known issues / deferred

- **Consumer deck experience vibe chips are absent** — the deck `BusinessEventCard` does not carry `experience_intents`; threading them is a deck-supply change beyond the §11 allowlist. The consumer detail omits the chip block gracefully (rule 9). The WEB/`/exp/` page DOES render vibe chips (it reads `experience_intents` directly). Flagged for a follow-on deck-supply ORCH.
- **`BaseBottomSheet.test.mjs` T-C (primitive) is a PRE-EXISTING failure on origin/main** — the primitive `BaseBottomSheet.tsx:717` passes `animationConfigs={sheetAnimationConfigs}` while the test still asserts "primitive must NOT pass animationConfigs" (both present on origin/main, unrelated to my EBES retarget). My retargeted T-C reference + T-D map are correct. See Discoveries.

## 11. Operator action required

1. **Apply the materializer migration** (do NOT let `db push` surprise you — it re-emits the live RPC bodies; reconcile if the live body drifted since `20260911000000`):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1138-[experience-page]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (or apply via the Management API per the migration-apply hazards memory). No `--include-all` needed — prefix `20261005000000` is strictly greater than the max across all worktrees (`20261004000001`).
2. **No edge-function deploys** — none touched.
3. After merge: the consumer sim proof (§9) on a merged-main dev client; then tester all-surface live-fire.

## 12. Discoveries for orchestrator

- **Pre-existing test failure on main:** `app-mobile/src/components/ui/__tests__/BaseBottomSheet.test.mjs` T-C "primitive must NOT pass animationConfigs" fails because `BaseBottomSheet.tsx:717` passes `animationConfigs={sheetAnimationConfigs}` on origin/main. Register a fix-the-primitive-or-the-assertion ORCH.
- **Deck-supply gap:** the deck `discover-cards` / `experienceRecToBusinessEventCard` path doesn't carry `experience_intents` onto the consumer card → consumer detail can't show vibe chips. Small read-path/mapping ORCH would light them up.
- **Pre-existing tsc noise:** `packages/brand-rendering/PublicBrandPage.tsx:1293/1305/1323` implicit-any (untouched by me, on origin/main).
