# TEST — ORCH-1162 Public-event + cart polish (AM/PM · "Where you'll be" map · checkout theming)

- **Phase:** TEST → **RETEST-1** (runtime QA gate). **Mode:** RETEST (re-verify after REWORK), live-fire.
- **Date:** 2026-06-18 (RETEST-1 same day as original FAIL).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1162-[public-event-cart-polish]/` on branch `ORCH-1162-public-event-cart-polish` (rebased on `origin/main`, 0 behind). **RETEST HEAD / fix commit `d082222cb`** ("ORCH-1162 REWORK: 'Where you'll be' map on the LIVE event path (FoundationEventPreview) + consumer Mapbox token plumbing"). Parent / prior-FAIL state = `5f7961058`.
- **Device:** Samsung Galaxy A72 `R58R54YV7JT` (en-US). Business dev build (`com.sethogieva.minglabusiness`) driven on the **branch JS via worktree Metro** (`adb reverse 8081`, token in Metro env). Consumer leg build-pending (see §8 D-1).
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1162_PUBLIC_EVENT_CART_POLISH.md` · **IMPL:** `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1162_PUBLIC_EVENT_CART_POLISH.md`
- **Comms acked:** COMMS-0040 (WARN — RSVP public-page standardization; this ORCH touches NON-rsvp event paths only; the rework edited `FoundationEventPreview.tsx`, NOT `RsvpPublicBody.tsx`, confirmed), COMMS-0041 (WARN — experience-page standardization; rework made ZERO edits to the experience read path, confirmed). Both factored, no conflict.

---

## 1. RETEST-1 VERDICT: **CONDITIONAL PASS** — P0:0 · P1:0 · P2:1 (accept-or-build-pending) · P3:0 · P4:2

**The prior P1 blocker is FIXED and live-fire PROVEN.** The "Where you'll be" static-Mapbox map now renders on the **LIVE business-app event render path** (`FoundationEventPreview`), exactly the body that all normal published events mount. Device-reproduced on `R58R54YV7JT`: the Leggo This event "Vibes and Stuff" (valid geo) now shows the Mapbox tile with a **brand-blue pin** ABOVE the venue text card. Rule-9 fallback is also live-proven (an in-person event with venue text but no geo shows the text card alone — no blank/broken box). The new `orch-1162-foundation-event-map.mjs` gate **fails-on-revert** (proven by checking out parent `5f7961058`'s FoundationEventPreview → gate exits 1).

**Why CONDITIONAL, not full PASS:** the single remaining open item is **SC-4-Web runtime render**, which is BLOCKED by two pre-existing, ORCH-1162-unrelated infra issues (D-2 reanimated dev-web crash; expo-router static-export SPA "No routes found"). I drove web by both routes and neither rendered the page shell. The web verdict is therefore given **deterministically from the code path + proven sub-components** (same shared `FoundationEventPreview` component proven on Android; the exact Mapbox URL returns HTTP-200 PNG; react-native-web `Image` emits the `<img>`). This is `probable`, not `proven`, for web pixels. The consumer leg (D-1) is explicitly build-pending per the dispatch and not gating.

**AM/PM (SC-1/2/3) and checkout `theme_color` theming (SC-9) regression spot-check: HOLD.** Live AM/PM date lines confirmed on every event opened ("Fri, 9 Oct · 9 AM – Sat, 10 Oct · 4 AM", "Tue, 1 Dec · 7 PM – Wed, 2 Dec · 12 AM"); per-brand accent theming confirmed live (Leggo This = blue, Paystack NG = orange, The-party-block brand = light). The rework commit touched NONE of those files (verified: `git show d082222cb --name-only` lists only the gate, 2 reports, `app-mobile/app.config.ts`, `FoundationEventPreview.tsx`, the adversarial test).

---

## 2. SC-by-SC matrix (RETEST-1 — focused on the reworked SC-4; others spot-confirmed from the original PASS)

| SC | Surface | Verdict | Evidence (RETEST-1) |
|----|---------|---------|----------|
| **SC-4-Biz (iOS/Android)** | business native | **PASS (device-proven)** | `R58R54YV7JT`, branch JS via worktree Metro. Deep-link `://e/leggothis/vibes-and-stuff` → "Where you'll be" now renders the static Mapbox tile (Cary/Raleigh NC, "Mapbox" attribution) with a **blue (brand-accent) pin** and a bottom-left "The place" caption pill, **ABOVE** the tappable venue text card. Screenshot: `evidence/ORCH-1162/biz_where_map.png`. This is the exact regression the prior FAIL caught — now resolved. |
| **SC-4-Web** | buyer-web | **CONDITIONAL PASS (probable, code-path + sub-components proven)** | Buyer-web renders the SAME `mingla-business/src/components/event/PublicEventPage.tsx` → `FoundationEventPreview` component proven on Android (one RN codebase). Live dev-web render BLOCKED by D-2 (`BusinessNotificationsScreen.tsx:145` reanimated `LinearTransition.dur...` crash — `evidence/ORCH-1162/web_event_full.png`, the predicted pre-existing crash). Prod web export ran but expo-router single-output SPA returns "No routes found" for the dynamic `/e/[brandSlug]/[eventSlug]` route. Deterministic proof instead: (a) the pure builder produces the live URL `…/static/pin-s+2563eb(-78.7399073,35.7907102)/…` which returns **HTTP 200 image/png 251 KB** (`curl` verified); (b) `<Image source={{uri}}>` → react-native-web 0.21.2 `Image` emits a DOM `<img>`; (c) `getPublicMapboxToken()` has an explicit web-export `process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` static fallback (`mapboxToken.ts:23`). No web-specific divergence from the proven Android path. |
| **SC-4 rule-9 fallback** (no geo/token → text card, no blank box) | all | **PASS (device-proven)** | (1) `://e/leggothis/the-party-block` (in-person, venue text "The venue", `location_geo IS NULL`) → "Where you'll be" shows the venue **text card ONLY**, no map, no blank/broken tile: `evidence/ORCH-1162/biz_nogeo_venuecard.png`. (2) `://e/paystack-ng-test-1076/...` (in-person, `venueName IS NULL`) → the whole "Where you'll be" section is cleanly omitted: `evidence/ORCH-1162/biz_nogeo_where.png`. The IIFE returns `null` before mounting any node (FoundationEventPreview.tsx:401-440). |
| **SC-4-iOS/Android (consumer)** | consumer | **build-pending (P2, non-gating)** | Rework added the consumer Mapbox token to `app-mobile/app.config.ts extra` (D-1). The `extra` is baked at native build time → resolves only after a NATIVE consumer rebuild with `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` in the consumer EAS env. NOT OTA-shippable; per dispatch this is the orchestrator's scheduled build, explicitly NOT a CLOSE blocker for this verdict. |
| SC-1 / SC-1b / SC-2 / SC-3 (AM/PM) | all | **PASS (HOLD)** | Untouched by rework. Live: every event opened shows meridiem date lines (see §1). RT-1/RT-2 unit suite re-confirmed green (§4). |
| SC-5 (rule-9 honest fallback) | all | **PASS** | Subsumed by SC-4 rule-9 above + RT-3 failsafe green. |
| SC-6 (experience map) | biz/web | **PASS (pre-existing, untouched)** | Rework made ZERO edits to the experience read path. COMMS-0041 honored. |
| SC-7 (trip URL byte-equiv) | trip | **PASS** | RT-7 exact-string contract green (§4). |
| SC-8 (pin = brand accent; URL well-formed) | all | **PASS** | Live: blue pin on Leggo This (`#2563eb` accent). Builder + 200-OK PNG verified (§5). |
| SC-9 (3 checkout CTAs brand color) | business/web | **PASS (HOLD, source + live corroboration)** | Untouched by rework. Live: per-brand accent visible on event page CTAs/price pills (blue / orange / light); checkout resolver `resolveCheckoutBrandAccent` unchanged. |
| SC-10 / SC-11 (default orange; ≥4.5:1 contrast) | all | **PASS** | RT-4 (`buttonAccentContrast`) green; untouched. |

---

## 3. Findings (RETEST-1)

### RESOLVED — P1-1 (prior FAIL): "Where you'll be" map on a dead render path
- **Prior:** the map block lived only in `packages/event-rendering/PublicEventPage.tsx` (legacy cancelled/password-gate body), so normal events rendering `FoundationEventPreview` never showed it. SC-4-Biz/SC-4-Web FAILED.
- **Fix (`d082222cb`):** the same `buildStaticMapUrl` "Where you'll be" block (geo+token gated, rule-9 fallback, pin=`palette.accent`, `testID="orch-1162-event-where-map"`) was added to `mingla-business/src/components/event/FoundationEventPreview.tsx:387-440`. `event.locationGeo` was already threaded into `PublicEventProps` by the adapter (`publicEventsService.ts:800` `locationGeo: parseLocationGeoPoint(row.location_geo)`; the `business_public_events_view` DOES expose `location_geo` — verified live). Reuses the SINGLE shared owner (no re-fork; sibling `orch-1162-map-single-owner.mjs` still passes).
- **Verified:** device-reproduced map render (SC-4-Biz PASS) + new gate fails-on-revert (§4).

### P2-1 (build-pending, non-gating) — consumer event map + buyer-web pixel render
- **Evidence:** (a) Consumer map (D-1): token now in `app-mobile/app.config.ts extra`, baked at build time → needs a native consumer rebuild with the EAS env var; not OTA. (b) Buyer-web pixel render: blocked by D-2 (pre-existing reanimated dev-web crash) and the expo-router static-export SPA routing limitation — both unrelated to ORCH-1162.
- **Impact:** consumer leg ships only after the scheduled native build; web is `probable`-proven (code path + 200-OK URL + RN-web Image), not pixel-proven.
- **Required action:** none on ORCH-1162 product code. Orchestrator schedules the consumer native build with `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` set; web pixels confirmable after D-2 is fixed or on the deployed Vercel build (which uses the prod web pipeline with proper route output, not the local single-output SPA).

### P4-1 (praise) — gate is a precise regression sentinel
`orch-1162-foundation-event-map.mjs` asserts BOTH render paths (FoundationEventPreview LIVE body + the shared package legacy body) carry the `buildStaticMapUrl` call AND the `orch-1162-event-where-map` testID. It catches the EXACT class of bug the original FAIL found (map present in source but on the wrong body) — and proven to exit 1 on revert.

### P4-2 (praise) — rework kept scope surgical
The fix touched exactly one product file (`FoundationEventPreview.tsx`) plus the consumer config, the gate, and tests. AM/PM, the map primitive trio, URL/theming math, and the checkout theming wiring are all untouched — zero regression surface, confirmed by the file list.

---

## 4. Step 0.5 — independent re-run of fails-on-revert proofs (RETEST-1)

- **NEW gate `orch-1162-foundation-event-map.mjs`** — ran on HEAD `d082222cb` → **PASS (exit 0)**. Then independently reconstructed the prior-FAIL state in a temp dir: `git show 5f7961058:mingla-business/src/components/event/FoundationEventPreview.tsx` (the pre-rework body) + current package body + the gate → gate **exit 1** with: *"missing the buildStaticMapUrl(...) call … missing the orch-1162-event-where-map testID … (SC-4 regression)"*. Confirmed `grep -c orch-1162-event-where-map` on the reverted file = **0**. **Fails-on-revert verified at `5f7961058` (the exact commit that caused the prior FAIL).**
- **`orch-1162-map-single-owner.mjs`** — PASS on HEAD (single owner preserved; rework did not re-fork).
- **Deno RT suite** (`packages/event-rendering/__tests__/`): `mapboxStaticUrl.orch1162.test.ts` (TC-7 URL contract, TC-5a/5b failsafe, TC-8 accent) + `mapboxStaticUrl.orch1162.adversarial.test.ts` (TC-ADV-1..4) → **8 passed | 0 failed**.

All proofs reproduce on the rework commit.

---

## 5. Adversarial test + URL contract (RETEST-1)

- **Path:** `packages/event-rendering/__tests__/mapboxStaticUrl.orch1162.adversarial.test.ts` (in the closing diff). Different angle than the happy-path test: attacks the **silent-correctness seams** — (1) `lng,lat` ordering in BOTH pin overlay and center segment (a swap still 200-OKs but pins the wrong hemisphere); (2) pin-hex sanitization (`#`/UPPERCASE/3-char accepted, junk → brand default); (3) coordinate `0` is VALID (Number.isFinite, not falsy-rejected); (4) NaN/Infinity → null even with a token. **4 passed.**
- **Live URL contract (deterministic):** the builder, given the live event coords `(-78.7399073, 35.7907102)` + the public `pk.*` token + brand-blue `#2563eb`, produces `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s+2563eb(-78.7399073,35.7907102)/-78.7399073,35.7907102,11/600x300@2x?access_token=pk…`. `curl` → **HTTP 200 · image/png · 251 164 bytes.** Rule-9: null token → null; NaN coord → null (verified).
- **Note on ownership:** the adversarial test was authored inside the rework commit `d082222cb` (by the implementor/rework agent), not in a separate tester commit. I independently re-ran it AND re-verified its fails-on-revert behavior is sound, and it does attack a genuinely different angle than the happy-path TC-7/5/8. The primary live-path fix (the FoundationEventPreview render block, which has no RTL harness in this repo) is regression-gated by the `orch-1162-foundation-event-map.mjs` fails-on-revert proof above — the binding regression sentinel for SC-4.

---

## 6. Constitution 14-rule matrix (against the rework diff `d082222cb`)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | map `<Image>` non-interactive by design; venue-card "Open maps" tap preserved below it. |
| 2 | One owner per truth | PASS | reuses the single `buildStaticMapUrl` owner; single-owner gate still green. |
| 3 | No silent failures | PASS | rule-9 returns `null` → honest text-card fallback (live-proven: the-party-block). |
| 4 | One query key per entity | N/A | no query changes. |
| 5 | Server state server-side | N/A | pure presentational block. |
| 6 | Logout clears everything | N/A | no persisted state. |
| 7 | Label `[TRANSITIONAL]` | N/A | none. |
| 8 | Subtract before adding | PASS | reuses shared owner, no new fork. |
| 9 | No fabricated data | PASS | no geo → no map (never a fake pin); live-proven on 3 events. |
| 10 | Currency-aware | PASS (untouched) | live: "NGN 5,225" / "$67.93" / "$50" render per brand; pricing path untouched. |
| 11 | One auth instance | PASS | anon `/e/` path; no new `useAuth` in the changed component (FoundationEventPreview is auth-free). |
| 12 | Validate at user's datetime | PASS (untouched) | AM/PM formatter unchanged; meridiem live-confirmed. |
| 13 | Exclusion consistency | N/A | n/a. |
| 14 | Persisted-state startup | N/A | n/a. |

No constitutional violations in the rework.

---

## 7. Device / parity matrix (RETEST-1)

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS | build-pending | shared RN; map source-correct; resolves after native rebuild (D-1). |
| Consumer Android | build-pending | token baked at build time; not OTA; orchestrator-scheduled build (D-1). Non-gating per dispatch. |
| Buyer/anon Web | **CONDITIONAL (probable)** | same `FoundationEventPreview` proven on Android; URL 200-OK; RN-web `Image`→`<img>`. Live pixel render blocked by pre-existing D-2 + expo-router SPA export limit (both non-1162). |
| Business iOS | code-traced | shared RN with the proven Android leg. |
| Business Android | **PASS (device-proven on `R58R54YV7JT`)** | SC-4 map RENDERS with brand pin above venue card; rule-9 fallback clean; AM/PM + per-brand theming live. |
| Admin Web | N/A | no public/checkout surface. |
| Business Web preview | same as buyer-web | CONDITIONAL by shared code path. |

Physical iPhone HITL: not invoked (Android phone covered the native leg; iOS is shared RN code-trace; not requested by dispatch).

Retest cycles: **1** (within the ≤2 threshold).

---

## 8. Discoveries for Orchestrator (not fixed here)

- **D-1 (build-pending, expected):** consumer event map + pre-existing ORCH-1138 consumer EXPERIENCE map need a NATIVE consumer rebuild with `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` in the consumer EAS env (the rework added the `app.config.ts extra` plumbing; the value is build-baked, not OTA). Schedule the consumer dev/prod build; verify both maps render post-build.
- **D-2 (pre-existing web-dev crash, unrelated to 1162):** `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx:145` `LinearTransition.duration(...)` throws at module-eval under `expo start --web` (reanimated/web), taking down the whole buyer-web dev bundle. Blocks ALL local buyer-web dev verification. Flag for a web-dev-tooling fix (separate ORCH).
- **D-3 (pre-existing, unrelated):** baseline `tsc --noEmit` on `mingla-business` reports pre-existing errors NOT in the ORCH-1162 diff: `app/checkout-trip/.../buyer.tsx` + `app/checkout/.../buyer.tsx` implicit-`any` params; several `*.render.test.tsx` missing `@testing-library/react-native`; `marketing/ComposerV2/richEditor.tsx` + `SelectionFormattingTooltip.tsx`. None are in the changed file; out of ORCH-1162 scope.

---

## 9. Routing

**CONDITIONAL PASS.** Zero P0, zero unaccepted P1. The single remaining open item (SC-4-Web live pixels + consumer leg) is the **build-pending consumer native build (D-1, explicitly accepted by the dispatch as non-gating)** plus a **web verdict given as `probable` from the proven shared code path** because live web render is blocked by pre-existing non-1162 infra (D-2, expo-router SPA export). Per the dispatch, business + web are the gating surfaces; business is device-PROVEN, web is code-path PROVEN.

**Recommendation:** route to CLOSE if Seth accepts (a) the consumer leg as orchestrator-scheduled build-pending and (b) the buyer-web verdict as `probable` (confirmable post-deploy on Vercel's prod web pipeline). If Seth requires `proven` web pixels before CLOSE, the only path is the deployed Vercel build or a D-2 fix — neither is an ORCH-1162 product-code issue.
