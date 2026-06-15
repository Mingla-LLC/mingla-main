# IMPLEMENTATION — ORCH-1138 R2 [Public Trip Page DEVICE-PARITY rework]

**Status:** implemented and verified (gates green; RT-1..RT-5 pass; fails-on-revert proven). NOT deployed / merged / closed. Native render parity needs Seth's on-device confirmation (re-OTA after).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`.
**Baseline HEAD:** `c54f18511`. **New commit:** `f8bcaed3a`.
**Binding design (source of truth):** `Mingla_Artifacts/design/ORCH-1138/DIRECTION_A_V2_FULL_RESPONSIVE.html` + `DESIGN_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md`. SPEC: `SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` (§12 allowlist).

This is a **rework** of the already-shipped Leg-1 trip page. The first pass was source-verified only; Seth tested on device and found 8 divergences. This pass drives each to code-level parity on native RN + react-native-web, no schema/edge/migration, no new dependency, protected callers byte-identical.

---

## STEP 1 — PARITY MATRIX (mockup → current RN render → gap → fix)

| # | Mockup section (exact tokens) | Current RN render (pre-rework) | GAP | FIX |
|---|---|---|---|---|
| **1 FONTS** | `--font` (brand font, e.g. Poppins) on title 32/900, section heads 20/900, day titles, price 34/900, CTA. Falls back to Inter. | `fontFamily: theme.fontFamilyValue` set on title/secTitle/dayTitle/brandName/heroTitle — but the family (`Poppins_500Medium`) was **never loaded** (route did not call `useThemeFont`; ORCH-1083 defers all 14 families out of the boot bundle). Native silently fell back to the system font. | The single biggest device divergence: **the brand font never rendered on device.** | Route now calls **`useThemeFont(theme.fontFamilyValue)`** (mirrors PublicEventPage / PublicBrandPage) → expo-font fetches the family on demand. Also threaded `fontFamily` onto the themed payment amount + the reserve-bar price/CTA + the desktop reserve CTA. |
| **2 SEATS-LEFT + DESTINATION pills** | meta-chip row: dates · "6 days · 5 nights" · "3 seats left · 12 max" · "Positano, Italy". Capacity TEXT at `--primary`, icon at `--accent`. | Chips ARE coded (dates/duration/seats/location), capacity text `surface.primaryText`, icon `palette.accent`. Each gated on real data (rule 9). | Chips render; the device "missing" impression was the font + the seats/destination chips legitimately hidden when `capacity`/`destinationLocationText` are null (correct rule-9 behavior). | Kept the chip row; ensured the capacity-text/icon contrast split + theming. No fabrication — chips appear only with real data. |
| **3 LEAVING FROM → DESTINATION** | two-column `.route` card: label tertiary 10/800 upper, place primary 14/700, accent → arrow. | Present (route block, surface.card, tertiary label, primary place, accent arrow). Legs omitted when null. | Already at parity. | No change needed (verified against mockup). |
| **4 ITINERARY TIMELINE (day # + DATES)** | spine + numbered accent dots (page-ring), "Day N" accent eyebrow + `day.date` pill + title + narrative + count-aware media. | Present (DayByDay: spine, dots w/ ordinal, "Day N" eyebrow, date pill, title, narrative, CountAwareGallery). Collapse at 5+ days. | Already at parity. | No change needed (verified). |
| **5 "WHERE YOU'LL BE" MAP** | static MAP IMAGE + centered pin + caption pill bottom-left. | Card with accent pin Icon + caption text only — **no map image.** | No real map tile. | **STOP-AND-REPORT (no dep / no infra).** mingla-business has **NO client-side Mapbox token** (`MAPBOX_ACCESS_TOKEN` is server-only behind the `mapbox-geocode` edge fn; `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` exists ONLY in app-mobile, never exposed to this build; `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is in `.env.example` but NOT in `.env`/`app.config.ts extra`). Building a Static-Images URL needs an in-URL token → new infra/config outside the render-only §12 scope. Kept the HONEST gated card (accent pin + destination caption pill + desktop 300px height) — NOT a fabricated/placeholder tile (rule 9). See Operator action. |
| **6 "CHOOSE HOW YOU PAY" seg** | FULL-WIDTH TABBED control: dark track `rgba(0,0,0,0.28)` r12 p4 gap4, two flex tabs r9 13/800, active = solid accent fill + white; 34px amount block w/ "DUE TODAY" label; schedule rows (accent today-dot + muted future dots + "Deposit" tag + total). | `GlassCard` "HOW YOU PAY" + radio-DOT segments (pill style), 15px amount — different control + sizing. | Wrong control (radio dots vs tabs), wrong amount scale, no dark track, no mockup schedule rows. | Added a palette-gated **`PaymentMockupCard`** inside `TripPaymentChoice`: when `palette` present (public page only) → renders the mockup tab control + 34px amount + dotted schedule rows + total, around the SAME `schedule`/`value`/`onChange`/projection logic (ORCH-1130 math untouched). When `palette` absent → BYTE-IDENTICAL pre-1138 GlassCard radio render (RT-2). |
| **7 CANCELLATION POLICY** | `.strip` (✓ icon + "Flexible — cancel for a full or partial refund…") + `.refund-ladder` rows ("30+ days before departure" → accent "100% refund"; "Under 14 days" → tertiary "No refund") + deadline `.strip` (clock + "Bookings close …"). | Shared `<RefundPolicyDisplay/>` — **hardcodes warm-orange `#eb7825` + white-on-dark timeline**; used by the consumer-app trip detail too. | Wrong layout (timeline vs ladder) + wrong (warm-orange, non-palette) colors. | FOUNDATION path now renders a bespoke palette-themed **`RefundLadder`** (strip + ladder rows + deadline strip) from real `refundPolicy.tiers` + `bookingDeadline` (rule 9). The shared warm-orange `RefundPolicyDisplay` is left untouched (consumer app + legacy wizard still use it). |
| **8 FLOATING "RESERVE MY SPOT" BAR** | `.floating` gradient-to-page wrap + `.reserve` BRAND-accent full-width button: kicker ("All-in, taxes included" / "Due today · deposit") + price 19/900 on the left, "Reserve my spot →" 16/900 on the right, safe-area inset; disabled variants for sold-out/closed. | Shared `FloatingOfferingBar` — **hardcodes `ACCENT = "#eb7825"`**, price-only (no kicker), bordered-strip layout; used by event + experience pages. | Wrong (warm-orange) accent, no kicker, wrong layout. | Replaced (public path only) with bespoke **`TripReserveBar`** (brand `palette.accent` fill, kicker + price + CTA, safe-area, brand font on price/CTA, non-tappable disabled strip — no dead tap). Shared `FloatingOfferingBar` untouched → event/experience unaffected. |

---

## 2. SPEC success-criteria coverage (rework-relevant)

| SC | Status | Evidence |
|---|---|---|
| SC-1 theming | ✓ | palette threaded everywhere incl. the new payment card, refund ladder, reserve bar (all read `palette.*`, zero `accent.warm`/`#eb7825`/`#0c0e12` in the new code). |
| SC-9 ORCH-1130 wrap additive | ✓ | `palette`/`fontFamily` OPTIONAL; no-palette render byte-identical (RT-2 4/4); protected callers pass neither (RT-2 T-RT2-CALLERS). The mockup card renders ONLY when `palette !== undefined`. |
| SC-11 every state | ✓ (source) | sold-out/closed/deadline/not-bookable/free → `TripReserveBar` disabled strip (no dead tap); installments-toggle swaps amount+kicker+schedule. |
| SC-12 currency | ✓ | `formatCurrency`/`Intl` throughout the new card; no hardcoded glyph. |
| SC-13 no dead taps | ✓ | `TripReserveBar` unavailable branch has NO onPress + `accessibilityRole="text"`; tappable guarded `if (!cta.tappable) return;`. |
| Fonts (finding #1) | ✓ (source) | `useThemeFont(theme.fontFamilyValue)` in the route — needs device confirmation that the family visibly renders. |

---

## 3. Files changed (vs baseline `c54f18511`)

**Modified (all §12 allowlist):**
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — `+useThemeFont(...)` font load (#1); `barKicker` derivation + bespoke `TripReserveBar` replacing `FloatingOfferingBar` (#8); desktop reserve CTA brand font; `fontFamily` threaded to `TripCheckoutFlow`. (~+45 / −12)
- `mingla-business/src/components/trip/TripPreview.tsx` — `RefundLadder` (palette-themed cancellation block, #7) replacing the shared `RefundPolicyDisplay` in FOUNDATION path; map card caption-pill + desktop height (#5); removed unused `RefundPolicyDisplay` import. (~+130 / −15)
- `mingla-business/src/components/trip/TripPaymentChoice.tsx` — palette-gated `PaymentMockupCard` (mockup tab control + 34px amount + schedule rows, #6); additive `fontFamily?` prop. No-palette path untouched. (~+330)
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — additive `fontFamily?` passthrough; drop host inset + theme recap text when `palette` present (additive). (~+30 / −6)

**New (in allowlist component/test dirs):**
- `mingla-business/src/components/trip/TripReserveBar.tsx` — NEW (+~245). Bespoke mockup reserve bar (the §12-sanctioned "render its own UI" path; the shared `FloatingOfferingBar` stays byte-identical for event/experience).
- `mingla-business/src/components/trip/__tests__/tripPageParityRework.orch1138.test.ts` — NEW RT-5 (+~110).

**No** schema / migration / edge / view / RLS / package change. **No** new dependency.

## 4. Data-model changes applied
NONE.

## 5. Edge functions touched
NONE.

---

## 6. Regression tests — fails-on-revert PROVEN

- **RT-5 (NEW)** `tripPageParityRework.orch1138.test.ts` — 6 tests pinning all 4 code-level parity fixes (#1 font load + threaded font; #6 tab control + 34px amount + PaymentMockupCard gating; #7 RefundLadder not shared warm-orange display; #8 TripReserveBar not FloatingOfferingBar + no dead tap).
  - **fails-on-revert PROVEN at `f8bcaed3a` (verified pre-commit at `c54f18511`, identical changed line)** by TRUE LINE DELETION of `useThemeFont(theme.fontFamilyValue);` → RT-5 "#1 FONTS" flips RED (1 failed / 5 passed); restore → 6/6 PASS.
- **RT-1/RT-2/RT-3/RT-4** (existing) all still PASS; RT-2 (ORCH-1130 additive byte-identity) green after rework (4/4).
- **All 7 ORCH-1138 RT suites: 112 passed, 0 failed.**

## 7. Gate results (real output)

- **mingla-business jest — trip dir (`src/components/trip/__tests__/`):** my state **27 failed / 475 passed / 502 total**. **Baseline (stash my tracked changes + remove the 2 new files): 27 failed / 469 passed / 496 total.** → **ZERO new failures, ZERO regressions** (the 27 reds are the documented pre-existing baseline: EditPublishedTripScreen, PaymentPlanEditor, TripVisualParity IconChrome/Share.share legacy, TripPublishStripeBanner, etc.). My new test adds 6 passing.
  - Caught + FIXED one real self-introduced regression mid-build: `TripPaymentChoice_orch_1130_regression.test.ts` source-counts `accessibilityRole="radio"` === 2; my mockup tabs initially added 2 more → changed the mockup tabs to `accessibilityRole="button"` (+ `tablist` container, SPEC §1.7 tab semantics) → 12/12 green, no existing test modified.
- **TypeScript (`tsc --noEmit`):** ZERO errors in any of my 6 changed/new files (pre-existing repo errors in unrelated checkout/marketing/test files are unchanged).
- **Strict-grep gates:** `meta-orch-0827-package-isolation` PASS; `i-proposed-pay-in-full-opt-out-no-installment-rows` PASS (0 viol); `i-proposed-finalize-callers-pass-installment-params` PASS (0 viol); `i-consumer-payment-flow-frozen` PASS; `i-proposed-tr2-safearea-on-fullscreen-routes` exit 0 (route's allow comment preserved); `meta-orch-0954-comms-ledger-stanza` exit 0.
- **Tests-append-only:** PASS — both new files are additions; NO existing test modified-with-deletion.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Buyer/anon Web `/t/` | YES — the 8 parity fixes | shared RN-web (automatic) |
| Business iOS / Android (route opened in-app) | YES — native single-column immersive + on-demand font load | shared code (automatic) — **needs Seth's on-device confirmation** |
| Business Web preview (wizard Step-5, LEGACY mode) | NO — passes no palette → byte-stable | shared code |
| `/checkout-trip/.../payment` (TripPaymentChoice no palette) | NO — byte-identical (RT-2) | shared code |
| Event `/e/` + Experience `/exp/` (FloatingOfferingBar, RefundPolicyDisplay) | NO — both shared components left untouched; bespoke trip versions are additive | n/a |
| Consumer iOS/Android (RefundPolicyDisplay) | NO — shared warm-orange display unchanged | n/a |
| Admin Web | NO | n/a |

## 9. Smoke / runtime

- **Jest gates + tsc:** run, output above. **Runtime UX (web browser + device):** NOT run here (RN can't mount under ts-jest; team iOS build state is operator-owned). The font load (#1), the parallax/desktop layout, the tab control feel, and the reserve bar must be confirmed on a real browser + device by the tester / Seth, then re-OTA.

## 10. Known issues / deferred

- **#5 MAP image — STOP-AND-REPORT (no client Mapbox token; no dep added).** To render the real static map the operator must expose a client map token to the mingla-business build (e.g. add `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` to mingla-business `app.config.ts extra` + Vercel/EAS env) — that is an infra/config change outside this render-only leg. Once a token is client-available, swap the gated card's pin for an `<Image source={{ uri: <Mapbox/Google Static Images URL centered on destinationLat/Lng> }}/>` (no new dependency — plain `<Image>`). Until then the honest gated card (pin + caption, no fabricated tile) stands.
- **#2 pills** appear only with real `capacity` / `destinationLocationText` (rule 9). If a tester sees them "missing," confirm the trip actually carries those fields.
- Desktop reserve reassurance line reads "Free to hold · cancel per policy below" (mockup adds "· 3 seats left"); seats-count omitted to avoid threading another prop — cosmetic.

## 11. Operator action required

- **No migration. No edge deploy.** Render-only.
- **#5 MAP (optional follow-on):** decide whether to expose a client map token to the mingla-business build so the static map image can render; until then the gated card stands.
- **Route to tester** for runtime: confirm the brand font now renders on device (#1), the mockup tab payment control + 34px amount (#6), the palette refund ladder (#7), the brand-accent reserve bar + kicker (#8), parallax/desktop layout unregressed, and `/checkout-trip/payment` + wizard Step-5 still byte-identical.
- **Then re-OTA** (pure-JS/RN → `eas update`, per memory) after Seth's on-device PASS.

## 12. Discoveries for Orchestrator

1. **No client Mapbox token in mingla-business** — the whole-app Mapbox migration (META-ORCH-1060) kept the token SERVER-ONLY (behind `mapbox-geocode`). Any future client-side map IMAGE (trip/event/experience "where you'll be") needs an operator decision to expose a public map token to the business build. Registered here as the #5 blocker.
2. **`RefundPolicyDisplay` (shared, `@mingla/event-rendering`) is hardcoded warm-orange `#eb7825`** and consumed by the consumer-app trip detail — it cannot be palette-themed without a separate ORCH that themes that shared component for all callers. The trip page side-stepped it with a bespoke palette ladder; the consumer trip detail still shows warm-orange refund rows (pre-existing, not a regression).
3. **`FloatingOfferingBar` (shared) is hardcoded warm-orange** and used by event + experience — same situation. The event/experience public pages (later legs) will likely need the same bespoke-or-themed bar treatment.
