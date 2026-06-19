# INVESTIGATE — ORCH-1162 Bug 2: "Where you'll be" map parity (event / experience / trip)

- **Phase:** INVESTIGATE (read-only forensic). No product code edited.
- **Date:** 2026-06-18
- **Device:** Samsung Galaxy A72, adb serial `R58R54YV7JT`, USB. Device clock 24h (untouched, verified `time_12_24`→`24` at end). Buyer-web driven via device Chrome under the signed-in `sethogieva@gmail.com` browser.
- **Evidence dir:** `Mingla_Artifacts/evidence/ORCH-1162/`
- **Comms:** Acked COMMS-0040 (WARN, RSVP public-page standardization). Bug 2's render target `packages/event-rendering/PublicEventPage.tsx` is adjacent to (not the same body as) the RSVP `RsvpPublicBody.tsx` flagged there; the map port adds a NON-rsvp location block and does not touch the `event_type==='rsvp'` early-return branch. No conflict, coordinated.

---

## EXECUTIVE VERDICT

**Seth's decision is feasible and the data exists.** The proven trip map primitive (`buildStaticMapUrl` + a plain `<Image>`, NO map SDK, NO new dependency) is **directly reusable** on the shared event renderer and the experience preview. Today only TRIP renders a real Mapbox snapshot-with-pin; EVENT renders a text-only venue card, and EXPERIENCE renders a placeholder pin in an empty box (a redesigned-but-still-mapless card from ORCH-1138 Leg 3).

The contract gap for EVENT is **three layers wide** and is WIDER than the dispatch's lead suspected (the dispatch named only the business-app `mapLiveEventToPublicEvent` adapter; the PUBLIC buyer-web/consumer path goes through a DIFFERENT mapper — `publicEventViewRowToEvent` — that ALSO drops the geo):

1. **Type:** `packages/event-rendering/types.ts` `PublicEventProps` (L48-82) has NO lat/lng field.
2. **Adapter (×2):** the public mapper `publicEventViewRowToEvent` (`publicEventsService.ts:701-804`) never reads `row.location_geo` though the public view exposes it; AND the business-app live mapper `mapLiveEventToPublicEvent` (`mingla-business/src/components/event/PublicEventPage.tsx:124-165`) drops `event.locationGeo`.
3. **Render:** `PublicEventPage.tsx` (the shared package, L663-783) renders only a text venue card; there is no map block.

`location_geo` IS populated on real scheduled in-person events and IS exposed by the public anon view — so the port has data to render. (See Data layer below: 14 events carry geo; the public view returns it as a `(lng,lat)` point.)

---

## INVESTIGATION MANIFEST (files read, in trace order)

1. `mingla-business/src/utils/mapboxStaticImage.ts` — `buildStaticMapUrl` (the GOOD primitive) + `getPublicMapboxToken`.
2. `mingla-business/src/components/trip/TripPreview.tsx:605-653` — the reference render block ("Where you'll be").
3. `packages/event-rendering/PublicEventPage.tsx:640-783` — the shared event renderer's location/venue card (no map).
4. `packages/event-rendering/types.ts:48-145` — `PublicEventProps` / `PublicEventPageProps` (no lat/lng field).
5. `mingla-business/src/components/event/PublicEventPage.tsx:113-199` — business-app adapter `mapLiveEventToPublicEvent` (drops `locationGeo`).
6. `mingla-business/src/store/liveEventStore.ts:113,152,199` — `LiveEvent.locationGeo?: {lat;lng}|null`.
7. `mingla-business/src/services/publicEventsService.ts:701-804` — the PUBLIC mapper `publicEventViewRowToEvent` (drops `location_geo`; the buyer-web + consumer path).
8. `mingla-business/src/services/businessEvents.ts:389` — `location_geo` `(lng,lat)`-point parse (the working precedent for reading the point).
9. `mingla-business/src/components/experience/ExperiencePreview.tsx` — stops itinerary + (post-1138) "Where you'll start" placeholder; no `buildStaticMapUrl`.
10. DB (read-only, Supabase MCP): `events.location_geo`, `business_public_events_view.location_geo`, status/geo population counts.

---

## Q-SCORECARD

- **Q1. Does the EVENT public page render a map?** **Verdict: NO** — text-only venue card ("The place / The vanguard" + "Open maps" button). `proven` (runtime `web_12_event_venue_no_map.png`).
- **Q2. Does the EXPERIENCE public page render a map?** **Verdict: NO** — a "Where you'll start" card with a centered pin glyph + caption pill over an EMPTY box (no tiles). `proven` (runtime `web_14_passfee_exp_public.png`).
- **Q3. Does the TRIP public page render a real Mapbox snapshot-with-pin?** **Verdict: YES** — `proven` by code (`TripPreview.tsx:615-653` → `buildStaticMapUrl`) + ORCH-1138 Leg 1 ship history. Live web shot blocked by an anon-RLS trip regression (Discovery D-3) — both trip slugs returned "Couldn't load trip — permission denied for table brands".
- **Q4. Is `buildStaticMapUrl` directly reusable on the shared event renderer?** **Verdict: YES** — it is a pure, dependency-free URL builder living in the business app; the shared package would need it (or its logic) reachable. It already fail-safes to `null` (caller hides map) when token/coords absent. `proven` (source read).
- **Q5. Does a real published event actually have lat/lng?** **Verdict: YES** — 14 in-person events carry `location_geo`; the public view returns it. `proven` (DB).
- **Q6. What is the exact event contract gap?** **Verdict:** type field missing + BOTH adapters drop geo + no render block. `proven` (source).

---

## FINDINGS (six-field evidence)

### F-1 — `PublicEventProps` has no lat/lng field (CONFIRMED ROOT CAUSE — type layer)
1. **Symptom:** the shared renderer has nothing to render a map from.
2. **Layer:** code (shared package type).
3. **Probe:** read `packages/event-rendering/types.ts:48-82`.
4. **Evidence:** `PublicEventProps` "// Location" block is `format`, `venueName`, `address`, `hideAddressUntilTicket` only — NO `lat`/`lng`/`locationGeo`. `coverHue` is present (L72), so brand-pin theming is available.
5. **Mechanism:** with no lat/lng on the prop type, neither adapter can pass coords and the renderer cannot build a map URL → text-only card is the only possible output.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven`.

### F-2 — public mapper `publicEventViewRowToEvent` drops `location_geo` (CONFIRMED ROOT CAUSE — buyer-web/consumer adapter)
1. **Symptom:** buyer-web + consumer event page never receives coords (even if the type carried them).
2. **Layer:** code (service) + data.
3. **Probe:** read `publicEventsService.ts:701-804`; DB read of the public view.
4. **Evidence:** the returned `PublicEventRecord` sets `venueName`/`address` from `location.*`/`row.location_text` (L751-752) but never reads `row.location_geo`. The view DOES expose it: `SELECT location_geo FROM business_public_events_view WHERE id='5c3727fd-…'` → `"(-78.7399073,35.7907102)"`. The working `(lng,lat)`-point parser already exists at `businessEvents.ts:389` (precedent to copy).
5. **Mechanism:** the anon public read path silently discards the geo the view hands it → buyer-web/consumer event page is mapless even where data exists.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven`. NOTE: this is the surface the dispatch's lead MISSED — it named only the business-app live mapper (F-3).

### F-3 — business-app mapper `mapLiveEventToPublicEvent` drops `event.locationGeo` (SECONDARY ROOT CAUSE — business-app adapter)
1. **Symptom:** business-app native event public-preview is mapless.
2. **Layer:** code (business adapter).
3. **Probe:** read `mingla-business/src/components/event/PublicEventPage.tsx:124-165`.
4. **Evidence:** the returned object maps `venueName`/`address`/`coverHue` but never references `event.locationGeo` (which exists at `liveEventStore.ts:199` as `{lat;lng}|null`). This is the dispatch's named site.
5. **Mechanism:** the business preview adapter discards the geo it already has on the `LiveEvent`.
6. **Severity:** SECONDARY ROOT CAUSE. Confidence: `proven`.

### F-4 — the shared renderer has no map block (CONFIRMED ROOT CAUSE — render layer)
1. **Symptom:** even with coords, nothing draws a map.
2. **Layer:** code (shared package render).
3. **Probe:** read `PublicEventPage.tsx:663-783`.
4. **Evidence:** the location region is the `event.venueName !== null` Pressable venue card (L664-742) and an `online` branch (L743-783). No `<Image>` map, no "Where you'll be" heading, no `buildStaticMapUrl` call. Runtime confirms: `web_12` shows the text card.
5. **Mechanism:** missing render block → no map regardless of data/type.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven` (source + runtime).

### F-5 — `ExperiencePreview` "Where you'll start" is a placeholder pin, no Mapbox image (SECONDARY ROOT CAUSE — experience)
1. **Symptom:** experience page shows a flat box with a centered pin glyph + "Tasting Room A" caption, no map tiles.
2. **Layer:** code + runtime.
3. **Probe:** runtime `web_14_passfee_exp_public.png`; grep of `ExperiencePreview.tsx` (no `buildStaticMapUrl`/`StaticMap` import).
4. **Evidence:** the page renders stop addresses (itinerary) and a "Where you'll start" card, but the card is the honest pin+caption fallback only — `buildStaticMapUrl` is never called. (Stops carry text `address` only; the experience needs the start-stop geo wired the same way as trip destination geo.)
5. **Mechanism:** experience never builds a static-map URL → mapless, same primitive missing as the event renderer.
6. **Severity:** SECONDARY ROOT CAUSE. Confidence: `proven`.

### F-6 — `buildStaticMapUrl` is the reusable primitive (RULED-IN as reuse target, not a bug)
1. **Symptom:** n/a (this is the GOOD code).
2. **Layer:** code.
3. **Probe:** read `mapboxStaticImage.ts` in full.
4. **Evidence:** pure function `(lat,lng,accentHex,style,zoom,w,h,token) → string|null`; returns `null` on non-finite coords or missing token (caller hides). NO SDK, NO new dep; works native + react-native-web. The brand-pin is themed via `accentHex` (`normalizePinHex`, falls back to `#eb7825`).
5. **Mechanism:** directly callable from a shared event/experience render block once lat/lng + accent (`coverHue`-derived) are threaded through the prop type and both adapters.
6. **Severity:** RULED-IN (reuse target). Confidence: `proven`.

---

## PER-SURFACE MAP PARITY TABLE (offering × surface)

Status key: REAL = Mapbox snapshot-with-pin; TEXT = text-only venue card; PLACEHOLDER = pin glyph in empty box; — = n/a.

| Offering | Consumer app | Business app | Buyer-web | Cause |
|---|---|---|---|---|
| **EVENT** | TEXT (shared `PublicEventPage` via consumer adapter; mapless) | TEXT (`mapLiveEventToPublicEvent` drops geo) | **TEXT — proven** (`web_12`) | F-1 + F-2 (public) + F-3 (biz) + F-4 |
| **EXPERIENCE** | PLACEHOLDER (same `ExperiencePreview` body) | PLACEHOLDER | **PLACEHOLDER — proven** (`web_14`) | F-5 |
| **TRIP** | REAL (shared `TripPreview`) | REAL | **REAL — deterministic** (code `TripPreview.tsx:615-653`; live web blocked by D-3 RLS) | reference (good) |

All three offering bodies are shared across the three apps (consumer/business/web render the same package component per type), so a fix at the shared renderer + the prop type + the per-surface adapters reaches all three surfaces at once. Parity is **manual at the adapter layer** (3 adapters: public-service, business-live, experience) and **automatic at the render layer** (one shared block per offering type).

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | Memory/decision: ONE shared static-Mapbox primitive across all 3 offering types; trip shipped it (ORCH-1138 Leg 1). | The decision is not yet realized for event/experience — that IS Bug 2. |
| **Schema** | `events.location_geo point`; `business_public_events_view` exposes `location_geo`; trip destination geo lives in the public_theme blob (`destinationLat/Lng` mapped in `tripsService.ts`/`publicEventsService.ts:1368`). | No conflict — data path exists for event; experience start-stop geo wiring TBD. |
| **Code** | Trip renders `buildStaticMapUrl`; event renders text; experience renders placeholder. Both event adapters drop geo. | The decisive gap: code does less than the data/decision support. |
| **Runtime** | Event = text card (`web_12`); experience = placeholder pin (`web_14`); event public page DOES show all-in price + brand-blue CTA (renderer themes fine). | Matches code. |
| **Data** | 14 events carry geo; the pass-fee experience has stop addresses but the start-stop geo is the wiring question. | Event port is unblocked by data; experience needs start-stop geo confirmed at spec time. |

---

## REPRO EVIDENCE (device runs)

| # | Screenshot | What it proves |
|---|---|---|
| 1 | `web_11_event_top.png` | Correct EVENT page loaded ("Vibes and Stuff", Leggo This). |
| 2 | `web_12_event_venue_no_map.png` | **EVENT "Where you'll be" = text venue card + "Open maps", NO map image.** Bug 2 event side. Also shows the public renderer already themes (brand-blue "Buy ticket") + shows all-in "$67.93". |
| 3 | `web_14_passfee_exp_public.png` | **EXPERIENCE "Where you'll start" = pin glyph in an EMPTY box, NO tiles.** Bug 2 experience side. |
| 4 | `web_15_trip_real_map.png`, `web_16_trip2_map.png` | Both anon trip pages 500 with "permission denied for table brands" → Discovery D-3 (could not capture the live trip-map reference; trip=REAL is deterministic by code). |

Device clock left at 24h (unchanged). Chrome returned to home at end.

---

## DATA-AVAILABILITY PROOF (read-only)

- `SELECT count(*) total, count(location_geo) with_geo, count(location_geo) FILTER (WHERE is_online=false) inperson_with_geo FROM events;` → `total:175, with_geo:14, inperson_with_geo:14`. (The earlier `status='published'` count was 0 because the enum value is `'scheduled'`, not `'published'`.)
- Sample scheduled in-person event with geo: "The Reckoning" `(-78.7399073,35.7907102)`; "Vibes and Stuff" (the runtime fixture) same coords.
- `SELECT location_geo FROM business_public_events_view WHERE id IN (…)` → returns `"(-78.7399073,35.7907102)"` — **the anon public view already exposes geo**; the public mapper simply discards it.

---

## REUSE VERDICT

`buildStaticMapUrl` is **directly reusable** on the shared event renderer AND the experience preview. It is pure, dependency-free, react-native-web-safe, brand-pin-themable from `coverHue`, and fail-safe (null → hide). The remaining work (for the SPEC, not this phase): (a) add a lat/lng field to `PublicEventProps` (and the experience equivalent), (b) populate it in the PUBLIC mapper `publicEventViewRowToEvent` (reuse the `businessEvents.ts:389` point-parser) AND the business-live `mapLiveEventToPublicEvent` (read `event.locationGeo`), (c) add a "Where you'll be" render block to the shared `PublicEventPage` (and thread experience start-stop geo into `ExperiencePreview`), all calling `buildStaticMapUrl` with `accentHex` derived from `coverHue`. Whether the primitive moves into `packages/` or is imported is a SPEC decision; functionally it is reusable as-is.

---

## BLAST RADIUS / CROSS-SURFACE MAP

- **In scope:** EVENT (3 surfaces, shared renderer + 2 adapters + type), EXPERIENCE (3 surfaces, shared preview + start-stop geo wiring).
- **Out of scope / no change:** TRIP (already correct — the reference); online-format events (no venue → map correctly hidden by the same rule 9 fail-safe); RSVP events (the `event_type==='rsvp'` early-return body owned by COMMS-0040 — a map there is a separate decision).
- **Token dependency:** `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` must be present in the buyer-web export's `Constants.expoConfig.extra` AND the app builds (it already is for trips — trip maps render in prod, per ORCH-1138 Leg 1). No new token needed.

---

## DISCOVERIES FOR ORCHESTRATOR

- **D-1:** The dispatch's lead under-scoped the EVENT adapter gap — it named only the business-app `mapLiveEventToPublicEvent`. The PUBLIC buyer-web/consumer path uses a SEPARATE mapper (`publicEventViewRowToEvent`) that ALSO drops geo. A spec that fixes only the business mapper would leave buyer-web + consumer mapless. BOTH adapters must be fixed.
- **D-2:** The EVENT public renderer ALREADY themes its CTA to the brand color (runtime `web_12` shows a brand-BLUE "Buy ticket", not Mingla orange) and ALREADY shows the all-in price ("$67.93"). The public PAGE is healthy — Bug 3's theming/true-cost defects are in the CHECKOUT flow, not the public page. (See the checkout investigation.)
- **D-3 (P1 regression, unrelated surface):** BOTH anon trip public pages (`/t/travelbrand/the-dc-adventure`, `/t/travelbrand/the-sone`) return "Couldn't load trip — permission denied for table brands" on buyer-web. Anonymous buyers cannot view ANY trip public page. This looks like an anon-RLS regression on the trip read path, plausibly from the ORCH-1138 theme-via-`business_public_events_view` change (COMMS-0009) leaking a direct `brands` read. Needs its own investigation/ORCH — it blocks all web trip sales.
- **D-4:** Experience stops carry only a text `address` today; the "Where you'll start" map needs the start-stop's lat/lng. Confirm at spec time whether `experience_stops` persists geo or whether it must be geocoded (the trip path uses persisted destination geo).

---

## CONFIDENCE & RECOMMENDED NEXT PHASE

- **Overall confidence: `proven`** for the event-mapless + experience-placeholder runtime facts, the 3-layer contract gap, the data availability, and the reuse verdict. Trip=REAL is `proven`-by-code (`probable` on live web only, blocked by D-3).
- **Recommended next phase: SPEC** — port the proven static-Mapbox primitive to the shared event renderer + experience preview: add lat/lng to the prop type, populate it in BOTH event adapters (public + business-live) and the experience path, add the render block calling `buildStaticMapUrl` with `coverHue`-derived `accentHex`, preserving the rule-9 null→hide fail-safe. Out of scope: trip (reference), RSVP body (COMMS-0040), and D-3 (separate ORCH). **No fix proposed here.**
