# SPEC — ORCH-1162 Public-event + cart polish (THREE clean fixes)

- **Phase:** SPEC (binding contract). One ORCH / one PR / one worktree.
- **Date:** 2026-06-18
- **Author:** mingla-forensics (SPEC side)
- **Source investigations (runtime-proven, INVESTIGATE DONE — do NOT re-investigate):**
  - Bug 1 — `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1162_PUBLIC_EVENT_TIME_AMPM.md`
  - Bug 2 — `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1162_EVENT_MAP_PARITY.md`
  - Bug 3A — `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1162_CHECKOUT_THEMING_TRUECOST.md` (THEMING/Bug-3A part ONLY)
- **Moved OUT of this ORCH:** Bug 3B (true-cost / ORCH-1147 all-in restore) → **ORCH-1164**. NOT specced here.
- **Comms acked:** COMMS-0040 (WARN — RSVP public-page standardization), COMMS-0041 (WARN — public-experience-page standardization onto `@mingla/offering-rendering`), COMMS-0038 (FYI — standard event page already ONE shared `@mingla/event-rendering/PublicEventPage`). Coordination notes embedded in §2 + §4.B + §10.

---

## 1. Executive summary

Three independent, runtime-proven polish fixes that ship together:

1. **Bug 1 — restore AM/PM.** Two LIVE time formatters are pinned to the `en-GB` locale (a 24-hour-default locale), so they render times as "00:15" / "19:00" on every device regardless of the system 12/24h toggle. Switch them to the repo's existing 12-hour discipline (read hours via `hourCycle:h23` `formatToParts`, then convert to "10 PM" / "2:30 AM") while PRESERVING every `timeZone` argument. Fixes the consumer event AND experience date line (one helper) plus the shared "Sales open…" pre-sale banner (one shared package).

2. **Bug 2 — shared "Where you'll be" map.** TRIP already renders a real static-Mapbox snapshot-with-pin; EVENT renders a text-only venue card and EXPERIENCE renders no map. Port the proven, dependency-free `buildStaticMapUrl` primitive into the shared `@mingla/event-rendering` package, thread `lat/lng` through `PublicEventProps` + all event adapters, add a "Where you'll be" render block to the shared `PublicEventPage`, and add experience start-stop geo into `ExperiencePreview`. Q1 LOCKED: all three offering types share ONE map primitive. Rule-9 fail-safe: absent coords or token → HIDE the map (honest text fallback), never a blank/broken box.

3. **Bug 3A — checkout brand theming.** The three checkout-step CTAs (Get tickets → Continue, Your details → Continue, Payment → Pay) hardcode Mingla orange via `variant="primary"`. Add an optional `accentColor` prop to the shared `Button` primitive; the three checkout CTAs derive that color from the event's `coverHue` (no new schema). Default Mingla orange is unchanged everywhere else. Label color auto-resolves for contrast/legibility on arbitrary hues.

All three are S1 UX/design-debt fixes with no migration and no schema change.

---

## 2. Scope & non-goals

### In scope
- **Bug 1:** exactly two LIVE `en-GB`-pinned time formatters: `app-mobile/src/utils/eventDateDisplay.ts` `formatTimeInTz` and `packages/event-rendering/QuantityRow.tsx` `formatSaleDate`. Optional hygiene: dead-code `mingla-business/src/components/brand/ExperienceMiniCard.tsx` `formatNextOccurrence`.
- **Bug 2:** event public page (3 surfaces via shared renderer + 3 event adapters + the `PublicEventProps` type), experience public preview (`ExperiencePreview` + the `publicExperienceService` stop read, ADDITIVELY), the shared map primitive promoted into `@mingla/event-rendering`.
- **Bug 3A:** the `Button` primitive's optional accent prop + the three checkout-step CTAs.

### Non-goals (explicitly NOT touched, and why)
- **Bug 3B (true-cost / all-in restore)** — MOVED to ORCH-1164. This SPEC does NOT touch `CartContext.tsx`, the cart seeds, `useCartTotals`, the payment-display all-in logic, `ticket-checkout-create` web `unit_amount`, `publicExperienceService` pricing fields, `tripsService` pricing, or the ORCH-1147 regression tests.
- **TRIP map (`TripPreview.tsx` lines 605-653 + `ConsumerTripDetailScreen`)** — the proven reference. Re-confirm it still renders through the SAME primitive after the promotion (§9 RT-2), but do NOT change its behavior.
- **RSVP body (`event_type==='rsvp'` early-return branch in `PublicEventPage` + `RsvpPublicBody.tsx`)** — owned by COMMS-0040/ORCH-1163. The map block is added to the NON-rsvp event body only; the rsvp early-return is untouched.
- **Intentional-24h sites** — `format24hTimeInTz`, `formatEventLocalRange` (consumer calendar/compact range), the internal `hourCycle:h23` read inside `formatTimeLabelInTz` (it IS a 12h converter), and `experienceDateSubline.ts` `formatTimeLine` (en-US → 12h, PROVEN CORRECT). DO NOT touch any of these.
- **The proven-correct formatters** — buyer-web event/experience string-math 12h paths, `undefined`-locale pickers. PROVEN correct on Hermes; no change.
- **Admin web (`mingla-admin`)** — no public event page, no buyer checkout. Out.
- **D-3 anon-RLS trip-page regression** — separate ORCH-1164-class item; not in scope.

### Assumptions
- A1: `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` resolves at runtime on buyer-web export, business app, and consumer app (it already does — trip maps render in prod via ORCH-1138 Leg 1).
- A2: `expo-constants` is installable as a `@mingla/event-rendering` peerDependency (both consuming apps already depend on it: `mingla-business` ~18.0.13, `app-mobile` ~18.0.9 — VERIFIED).
- A3: `experience_stops` persists `lat`/`lng` (VERIFIED — index `experience_stops_latlng_idx` exists; consumer deck already reads them).

---

## 3. Cross-Surface Impact Declaration (per-surface)

| # | Surface | Bug 1 (AM/PM) | Bug 2 (map) | Bug 3A (theming) | Files touched there | Parity |
|---|---------|---------------|-------------|------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | COVERED — `formatTimeInTz` (event + experience date line) + `QuantityRow` sale banner | COVERED — `mapCardToPublicEvent` + `cardToPublicEvent` pass `locationGeo`; shared renderer draws map; experience already renders via `ConsumerExperienceDetailScreen` (no change) | NOT covered (checkout CTAs are business-app routes only) | `app-mobile/src/utils/eventDateDisplay.ts`, the 2 consumer event adapters | manual (adapters) + auto (shared renderer + shared QuantityRow) |
| 2 | Consumer Android (`app-mobile`) | COVERED (same shared code; F-1 proven on Android device) | COVERED (same) | NOT covered | same as iOS | same |
| 3 | Buyer/anon Web (`mingla-business` `/e/{slug}/{slug}`, `/exp/...`, `/checkout/{eventId}`) | PARTIAL — only the shared `QuantityRow` sale banner (web event/exp date lines already correct, string-math) | COVERED — event via `mapLiveEventToPublicEvent` + shared renderer; experience via `ExperiencePreview` + `publicExperienceService` stop geo | COVERED — the 3 checkout CTAs render on web | `QuantityRow.tsx`, `PublicEventPage.tsx` (pkg), business event adapter, `ExperiencePreview.tsx`, `publicExperienceService.ts`, 3 checkout files, `Button.tsx` | auto (shared) + manual (adapters/checkout) |
| 4 | Business iOS (`mingla-business`) | COVERED — `QuantityRow` sale banner (checkout) | COVERED — native event preview via `mapLiveEventToPublicEvent`; experience preview via `ExperiencePreview` | COVERED — 3 checkout CTAs | same business files | manual + auto |
| 5 | Business Android (`mingla-business`) | COVERED (same) | COVERED (same) | COVERED (same) | same | same |
| 6 | Admin Web (`mingla-admin`) | NOT covered — no public event/time surface | NOT covered — no public page | NOT covered — no checkout | none | n/a |
| 7 | Business Web preview (adjacent) | PARTIAL — `QuantityRow` only (its event date line is the correct string-math path) | COVERED — same shared renderer + `ExperiencePreview` | COVERED — same checkout routes | same business files | auto + manual |

---

## 4. Layered specification

This change is **client + shared-package only**. No DB migration. One ADDITIVE read-shape extension in `publicExperienceService` (a SELECT column add + interface field add — NOT an RPC change, NOT a divergence; see COMMS-0041 note in §10).

### 4.A — Bug 1: restore AM/PM (meridiem)

**Reference 12h discipline to copy (already in-repo, PROVEN correct):**
`mingla-business/src/utils/eventDateDisplay.ts` `formatTimeLabelInTz` (lines 199-220) — reads the local hour/minute via `Intl.DateTimeFormat("en-CA",{timeZone,hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(...)`, then converts to "10 PM" / "2:30 AM" via `formatTimeLabel` (lines 107-119). This is the canonical pattern. The two fixes below MUST mirror it (timezone-preserving, meridiem-emitting, minute-suppressing on `:00`).

**A.1 — `app-mobile/src/utils/eventDateDisplay.ts` `formatTimeInTz` (lines 50-58). LIVE, CONFIRMED ROOT CAUSE (F-1).**
- **Current:** `new Intl.DateTimeFormat("en-GB",{hour:"numeric",minute:"2-digit",timeZone:tz}).format(...).replace(/:00\b/,"").replace(/\bam\b/g,"AM").replace(/\bpm\b/g,"PM")` → emits "19:00" on all devices; the `.replace(/\bam\b/…)` is dead post-processing (en-GB emits no am/pm).
- **Change contract:** rewrite the body to produce a 12h label with uppercase meridiem in the supplied `tz`, suppressing `:00` minutes. Acceptable mechanisms (implementor picks ONE):
  - (preferred) the `formatToParts` h23-read + 12h-convert pattern from `formatTimeLabelInTz`; OR
  - `Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",hour12:true,timeZone:tz})` then `.replace(/:00(?= ?[AP]M)/,"")` and uppercase the meridiem.
- **Invariants:** PRESERVE the `timeZone: tz` argument exactly. PRESERVE the `:00` suppression (so "10 PM" not "10:00 PM"). Output must contain "AM" or "PM" (uppercase). Update the in-file doc-comment so it no longer lies ("Sat 18 May · 10 PM" must now be true).
- **Blast:** `formatEventDateLine` (lines 93-115) is the sole caller — fixes consumer EVENT date line AND consumer EXPERIENCE expanded-card date line at once (one helper, two offering types).

**A.2 — `packages/event-rendering/QuantityRow.tsx` `formatSaleDate` (lines 117-127). LIVE (deterministic), SECONDARY ROOT CAUSE (F-2).**
- **Current:** `new Date(iso).toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})` → "Wed 15 Jul, 19:00".
- **Change contract:** keep the date portion ("Wed 15 Jul"), render the time portion as 12h with uppercase meridiem. Mechanism: switch the locale to `"en-US"` with `hour:"numeric", minute:"2-digit", hour12:true` (en-US default is h12), e.g. `toLocaleString("en-US",{weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})` → "Wed, Jul 15, 7:00 PM". The exact glyph order may differ from en-GB; the binding requirement is **a meridiem appears**. Keep the `Number.isFinite` guard + "soon" fallback (lines 118-119).
- **Note:** this formatter takes NO timezone (renders in the host's local zone) — that is existing behavior; do NOT add a tz argument (out of scope).
- **Blast:** the shared "Sales open {…}" pre-sale banner across consumer `TicketCartSheet`, business checkout, AND buyer-web `PublicEventPage` (one shared package fixes all three).

**A.3 — (OPTIONAL hygiene) `mingla-business/src/components/brand/ExperienceMiniCard.tsx` `formatNextOccurrence` (lines 100-104). DEAD CODE (F-6, zero importers).**
- Either delete the unused component or fix the en-GB call for parity. NO live impact; no success criterion depends on it. If touched, the implementor must confirm zero importers first (`rg "ExperienceMiniCard"`).

### 4.B — Bug 2: shared "Where you'll be" map

**Primitive promotion (the import-boundary decision).** `@mingla/event-rendering` must NOT import from `mingla-business/src` (`I-MOR-0827-PACKAGE-ISOLATION`), and today the pure builder is duplicated byte-for-byte in `mingla-business/src/utils/mapboxStaticImage.ts` AND `app-mobile/src/utils/mapboxStaticImage.ts` (the app-mobile copy's own header laments the forced duplication). Resolution:

- **B.0 — Port the pure builder into the package.** Create `packages/event-rendering/mapboxStaticImage.ts` containing `buildStaticMapUrl` + `getPublicMapboxToken` + `StaticMapParams` (verbatim logic from `mingla-business/src/utils/mapboxStaticImage.ts`, the rule-9 null-on-missing-token/coords fail-safe intact). Export it from `packages/event-rendering/index.ts`. Add `expo-constants` to `packages/event-rendering/package.json` `peerDependencies` (`"expo-constants": "*"`).
- Re-point the two app copies to re-export from the package so the duplication + drift ends:
  - `mingla-business/src/utils/mapboxStaticImage.ts` → `export { buildStaticMapUrl, getPublicMapboxToken } from "@mingla/event-rendering";` (preserve the named exports `TripPreview.tsx:72` + `ConsumerExperienceDetailScreen.tsx:91` import).
  - `app-mobile/src/utils/mapboxStaticImage.ts` → same re-export. This keeps `I-MOR-0827` intact (app-mobile imports from the `@mingla/*` package, not from `mingla-business/src`).

**B.1 — Type layer. `packages/event-rendering/types.ts` `PublicEventProps` (lines 48-82). CONFIRMED ROOT CAUSE (F-1, map).**
- Add an optional location-geo field in the `// Location` block:
  ```ts
  /** ORCH-1162 — venue lat/lng for the static-Mapbox "Where you'll be" snapshot.
      null → no map (rule-9: honest text-card fallback). */
  locationGeo?: { lat: number; lng: number } | null;
  ```
- Optional (renderer hint, default behavior fine without it): none required — `coverHue` (line 72) is already present for the pin color.

**B.2 — Adapter layer (3 event adapters — ALL must thread geo). CONFIRMED + SECONDARY ROOT CAUSES (F-2, F-3, map).**
- **Buyer-web + business native** path: `mingla-business/src/components/event/PublicEventPage.tsx` `mapLiveEventToPublicEvent` (lines 124-164). Add `locationGeo: event.locationGeo ?? null` (source: `LiveEvent.locationGeo` at `liveEventStore.ts:199`). NOTE: the buyer-web `/e/...` route hydrates a `LiveEvent`/`PublicEventRecord` from `publicEventViewRowToEvent`; if that record does NOT yet carry `locationGeo`, ALSO populate it in `publicEventViewRowToEvent` (`publicEventsService.ts:701-804`) by reading `row.location_geo` (the `business_public_events_view` exposes it; `BusinessPublicEventViewRow` lacks the field today — ADD `location_geo: string | null` to that row interface) using the proven `(lng,lat)`-point parser at `businessEvents.ts:389`. (See OQ-1 — confirm whether the web route passes through `mapLiveEventToPublicEvent` or builds props directly; both adapters must end up with geo.)
- **Consumer deck/expanded** path: `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` `mapCardToPublicEvent` (lines 125-193). Add `locationGeo: card.locationGeo ?? null` (source: `BusinessEventCard.locationGeo` at `mergedDiscover.ts:59`, already populated by `discover-merged-events/_business-query.ts:121` — VERIFIED, no backend change needed).
- **Consumer event detail** path: `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` `cardToPublicEvent` (lines 137-170). Add `locationGeo: card.locationGeo ?? null`.

**B.3 — Render layer. `packages/event-rendering/PublicEventPage.tsx` (NON-rsvp venue region, lines 663-783). CONFIRMED ROOT CAUSE (F-4, map).**
- Add a "Where you'll be" block, modeled on `TripPreview.tsx:615-653`, rendered ABOVE or replacing the text venue card for in-person events when `event.locationGeo` has finite lat/lng:
  ```
  const mapUrl = event.locationGeo
    ? buildStaticMapUrl({ lat, lng, accentHex: palette.accent, height })
    : null;
  mapUrl !== null
    ? <Image source={{uri: mapUrl}} resizeMode="cover" accessibilityLabel={`Map of ${venueName ?? "the venue"}`} />  // + pin + caption pill (venueName)
    : <existing text venue card (lines 664-742)>   // rule-9 honest fallback
  ```
- **`accentHex` = `palette.accent`** (the same brand accent the page already renders its CTA/venue-disk with — derived from `resolveTheme` → `createThemePalette`). This matches the existing trip pin.
- **Rule-9 fail-safe (HARD):** if `buildStaticMapUrl` returns `null` (no token at runtime OR missing/non-finite coords), render the EXISTING text venue card — never a blank box, never a placeholder tile, never a crash. The `online` branch (lines 743-783) is unchanged.
- **DO NOT** add the block inside the `event_type==='rsvp'` early-return body (COMMS-0040).

**B.4 — Experience preview geo. `ExperiencePreview` + `publicExperienceService` (ADDITIVE). SECONDARY ROOT CAUSE (F-5, map).**
- **Read shape (additive — see COMMS-0041 §10):** in `publicExperienceService.ts`, add `lat: number | null` + `lng: number | null` to the `PublicExperienceStop` interface (line 31-38) and SELECT `lat`/`lng` from `experience_stops` in the stops query, mapping them at the `stops.map(...)` projection (lines 228-235). This is an additive column add, NOT an RPC introduction and NOT a read-pattern divergence.
- **Render:** in `mingla-business/src/components/experience/ExperiencePreview.tsx`, add a "Where you'll be" block (parity with the event block) keyed off the FIRST stop with finite `lat`/`lng` (the start stop), calling the package `buildStaticMapUrl({lat,lng,accentHex:palette.accent,height})`. Rule-9: no geo / no token → render the existing stops-list/address card only (no map), never a blank box. (The consumer experience surface `ConsumerExperienceDetailScreen.tsx:737-745` ALREADY renders this map — no change there; this brings business+web to parity.)

### 4.C — Bug 3A: checkout brand theming (derive from `coverHue`)

**C.1 — `mingla-business/src/components/ui/Button.tsx`. Add optional accent override.**
- Add `accentColor?: string` to `ButtonProps` (after line 68). Semantics: an optional brand-accent hex that, when provided, overrides the `primary` variant's background.
- In the component body, after `const tokens = VARIANT_TOKENS[variant];` (line 144), compute the effective background + label color:
  ```
  // ORCH-1162 — optional brand-accent override for primary CTAs only.
  // Label color auto-resolves for WCAG-legibility on arbitrary hues.
  const brandBg = (variant === "primary" && typeof accentColor === "string" && /^#?[0-9a-fA-F]{6}$/.test(accentColor.replace(/^#/,"")))
    ? normalizeHex(accentColor) : null;
  const effectiveBg = brandBg ?? tokens.background;
  const effectiveText = brandBg ? readableTextFor(brandBg) : tokens.text;
  const effectiveHoverBg = brandBg ? lighten(brandBg, 0.06) : tokens.hoverBackground;
  ```
  Use `effectiveBg`/`effectiveText`/`effectiveHoverBg` in `containerStaticStyle.backgroundColor` (line 204), `resolvedTextColor` (line 211), and the web hover style (line 231). Disabled state unchanged. Only `variant === "primary"` is affected; `secondary`/`ghost`/`destructive` ignore `accentColor`.
- **Contrast/legibility (HARD):** `readableTextFor(bg)` returns `#000000` or `#ffffff` by max WCAG contrast ratio — REUSE the proven helper logic from `packages/event-rendering/themePalette.ts` (`relativeLuminance` + `contrastRatio` + `readableTextFor`, lines 90-108). Inline a small local copy in `Button.tsx` (Button is in `mingla-business/src`, cannot import the package internals) OR a tiny shared util. The label must hit ≥ 4.5:1 against the resolved background; if the raw `coverHue` color cannot, darken/lighten the background toward the chosen text color until it does (mirror `contrastAdjustedForWhiteText`).

**C.2 — Derive the brand accent hex from `coverHue` at each checkout step.**
- `coverHue` (number, hue degrees) → hex via the canonical cover formula already in-repo: `hsl(${coverHue}, 60%, 45%)` (used at `PublicEventPage.tsx:377` and `EventCover.tsx:53`). Add a tiny shared helper `coverHueToHex(hue: number): string` (HSL 60/45 → hex) in `mingla-business/src/utils/` (e.g. extend `eventDateDisplay`'s sibling util area, or a new `coverHueColor.ts`); the three checkout files import it.
- **Step 1 — Get tickets → Continue:** `mingla-business/app/checkout/[eventId]/index.tsx:305` `variant="primary"` Button → add `accentColor={coverHueToHex(event.coverHue)}`. `event.coverHue` is in scope via `usePublicEventById` (loaded at line 75, used at line 242).
- **Step 2 — Your details → Continue:** `mingla-business/app/checkout/[eventId]/buyer.tsx:597` → add `accentColor={coverHueToHex(event.coverHue)}` (event loaded via the same `usePublicEventById` pattern in this route; confirm the local variable name and pass its `coverHue`).
- **Step 3 — Payment → Pay:** `mingla-business/app/checkout/[eventId]/payment.tsx:681` → add `accentColor={coverHueToHex(event.coverHue)}`.
- If `event` is not yet loaded (loading state), pass `undefined` → falls back to Mingla orange (no flash of wrong color is acceptable during load).

**See OQ-2:** the public-page CTA actually themes from `resolveTheme().color` (brand theme color), NOT `coverHue`. Q2 LOCKED `coverHue`; this spec honors the lock. If Seth wants the checkout CTA to MATCH the public-page CTA exactly, the derivation source flips to `resolveTheme(brand.theme, event.themeOverrides).color` — flagged, not silently chosen.

---

## 5. Success criteria (numbered, per-surface where parity is manual)

**Bug 1**
- **SC-1:** `formatTimeInTz("2026-06-17T23:15:00Z","America/New_York")` returns a string containing "PM" (a meridiem), e.g. "7:15 PM" — NOT "19:15". (consumer iOS + Android, shared code.)
- **SC-1b:** `formatEventDateLine` for a known start/end renders both times with meridiem ("… · 7 PM – 10 PM"). The `:00` minute is suppressed ("7 PM" not "7:00 PM").
- **SC-2:** `formatSaleDate("2026-07-15T19:00:00Z")` returns a string containing "PM" — NOT "19:00". (shared `QuantityRow` → consumer iOS/Android, business iOS/Android, buyer-web.)
- **SC-3:** `format24hTimeInTz`, `formatEventLocalRange`, and `experienceDateSubline.ts formatTimeLine` outputs are BYTE-IDENTICAL before and after (regression guard for the do-not-touch sites).

**Bug 2**
- **SC-4-Web:** an in-person published event with `location_geo` on `/e/{slug}/{slug}` renders an `<Image>` Mapbox static map (a `https://api.mapbox.com/styles/...` URI), not the text-only venue card.
- **SC-4-iOS / SC-4-Android (consumer):** the same event in the consumer expanded card renders the map image (geo threaded via `mapCardToPublicEvent`).
- **SC-4-Biz (iOS/Android):** the business native event preview renders the map (geo via `mapLiveEventToPublicEvent`).
- **SC-5:** an event with NO `location_geo` (or token absent) renders the EXISTING text venue card (rule-9) — no blank box, no crash, no broken image. `online`-format events still render the online card.
- **SC-6:** an experience with a start stop carrying `lat/lng` renders a Mapbox static map in `ExperiencePreview` (business + web); one without geo renders the stops/address card only.
- **SC-7:** TRIP pages (`TripPreview`, consumer trip screen) render the SAME static-Mapbox snapshot as before the primitive promotion — byte-equivalent URL output (no regression).
- **SC-8:** the map pin color equals the page's brand accent (`palette.accent`), and the static-map URL is well-formed (`buildStaticMapUrl` output unchanged from the trip reference for identical inputs).

**Bug 3A**
- **SC-9-Web / SC-9-iOS / SC-9-Android (business):** Step 1, Step 2, and Step 3 CTAs render the brand `coverHue`-derived color (NOT `#eb7825`) when `event.coverHue` is loaded.
- **SC-10:** a `Button` with no `accentColor` (every other site app-wide) renders the unchanged Mingla orange `#eb7825` for `variant="primary"`. `secondary`/`ghost`/`destructive` ignore `accentColor`.
- **SC-11:** for ANY `coverHue` in [0,360), the CTA label color resolves to ≥ 4.5:1 contrast against the resolved background (legibility on light AND dark brand hues).

---

## 6. Invariants

### Preserved
- **`I-MOR-0827-PACKAGE-ISOLATION`** — `app-mobile` and the package do NOT import from `mingla-business/src`. PRESERVED: the map primitive is promoted INTO `@mingla/event-rendering`; both apps re-export from the `@mingla/*` package. Verified by the existing package-isolation grep gate.
- **`I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY`** — date reads stay sourced from `event_dates`/`master_*`. Bug 1 only changes the FORMATTER, not the source instant. PRESERVED.
- **Rule-9 (no fabricated/placeholder data)** — the map HIDES (text fallback) when coords/token absent; no placeholder tile.

### New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip)
- **`DRAFT I-PROPOSED-1162-PUBLIC-TIME-HAS-MERIDIEM`** — every public-facing offering TIME formatter (event/experience date lines, the shared sale-window banner) renders a 12-hour clock WITH an uppercase AM/PM meridiem; locale-pinning a public time formatter to a 24h-default locale (`en-GB`/`en-CA`) WITHOUT an explicit `hour12`/h23-convert is forbidden. Excludes the named intentional-24h sites. Test: §7 TC-1/TC-2 + the SC-3 byte-identical guard.
- **`DRAFT I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER`** — there is exactly ONE `buildStaticMapUrl` implementation, owned by `@mingla/event-rendering`; `mingla-business` and `app-mobile` re-export it, never re-implement. Test: §7 TC-7 (grep gate: no second `buildStaticMapUrl` function body outside the package).
- **`DRAFT I-PROPOSED-1162-MAP-FAILSAFE-HIDES`** — a public offering map block renders ONLY when `buildStaticMapUrl` returns a non-null URL; null → the honest text/address fallback, never a blank/placeholder box. Test: §7 TC-5.
- **`DRAFT I-PROPOSED-1162-CHECKOUT-CTA-BRAND-THEMED`** — the three checkout-step CTAs derive their color from the event's `coverHue` (or its locked source) with a contrast-resolved label; `Button` default `primary` stays Mingla orange when `accentColor` is omitted. Test: §7 TC-9/TC-10/TC-11.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| TC-1 (happy) | AM/PM restored, consumer | `formatTimeInTz("2026-06-17T23:15:00Z","America/New_York")` | contains "PM" (e.g. "7:15 PM"), NOT "19:15" | util |
| TC-1b (edge) | midnight + on-hour suppression | `formatTimeInTz("2026-06-18T04:00:00Z","America/New_York")` | "12 AM" (no `:00`, has meridiem) | util |
| TC-2 (happy) | sale banner meridiem | `formatSaleDate("2026-07-15T19:00:00Z")` | contains "PM", NOT "19:00" | pkg util |
| TC-3 (regression) | do-not-touch 24h sites unchanged | `format24hTimeInTz` / `formatEventLocalRange` / `experienceDateSubline formatTimeLine` | byte-identical to pre-change snapshot | util |
| TC-4 (happy) | event geo flows to renderer | `mapLiveEventToPublicEvent({…locationGeo:{lat,lng}})` then render | `PublicEventProps.locationGeo` set; `<Image>` map renders | adapter+render |
| TC-4b (happy) | consumer geo flows | `mapCardToPublicEvent({…locationGeo:{lat,lng}})` | `locationGeo` present on props | adapter |
| TC-5 (error/edge) | no geo / no token → hide | `locationGeo:null` OR `buildStaticMapUrl→null` | text venue card renders; no `<Image>` map; no crash | render |
| TC-6 (happy) | experience start-stop map | `PublicExperienceStop` with `lat/lng` | `ExperiencePreview` renders map image | service+render |
| TC-7 (regression) | trip URL unchanged + single owner | `buildStaticMapUrl` same inputs as trip ref | identical URL string; grep finds ONE impl (in pkg) | pkg |
| TC-9 (happy) | checkout CTA brand color | Button `accentColor="#1d4ed8"` `variant="primary"` | background "#1d4ed8" (not "#eb7825") | component |
| TC-10 (regression) | default orange preserved | Button `variant="primary"` no `accentColor` | background `accent.warm` (#eb7825) | component |
| TC-10b (edge) | non-primary ignores accent | Button `variant="ghost" accentColor="#1d4ed8"` | unchanged ghost styling | component |
| TC-11 (edge) | contrast on extremes | `accentColor` for `coverHue` 55 (yellow) and 0 (red) | label ≥4.5:1 (black on yellow, white on red) | component |

---

## 8. Implementation order

1. **Bug 1 (lowest risk, no UI wiring):** A.1 `formatTimeInTz`, A.2 `formatSaleDate`, (optional A.3). Add TC-1/1b/2/3 unit tests.
2. **Bug 2 — primitive:** B.0 port `mapboxStaticImage.ts` into `@mingla/event-rendering` + index export + `expo-constants` peerDep; re-point the two app re-exports. Add TC-7 (trip URL parity + single-owner grep).
3. **Bug 2 — type + adapters:** B.1 `PublicEventProps.locationGeo`; B.2 all 3 event adapters (+ `publicEventViewRowToEvent` / `BusinessPublicEventViewRow` if OQ-1 requires). Add TC-4/4b.
4. **Bug 2 — render:** B.3 event "Where you'll be" block (rule-9 fallback); B.4 experience service stop geo + `ExperiencePreview` block. Add TC-5/TC-6.
5. **Bug 3A:** C.1 `Button.accentColor` + contrast helper + TC-9/10/10b/11; C.2 `coverHueToHex` util + wire the 3 checkout CTAs.
6. Run all gates (§9), prove fails-on-revert, write the implementation report.

---

## 9. Regression prevention (fails-on-revert contracts)

- **RT-1 (Bug 1):** `app-mobile/src/utils/__tests__/eventDateDisplay.orch1162.test.ts` + `packages/event-rendering/__tests__/quantityRow.saleDate.orch1162.test.ts` assert the formatter output CONTAINS "AM"/"PM" for a known time. MUST FAIL when either formatter is reverted to `en-GB`-no-`hour12` (the reverted output has no meridiem). Protective comment: "en-GB has no am/pm; a `.replace(/am/)` here is a tell-tale latent 24h bug — keep the 12h discipline."
- **RT-2 (Bug 2 — trip parity + single owner):** a test asserting `buildStaticMapUrl({lat:35.79,lng:-78.74,accentHex:"#eb7825",token:"T"})` equals the exact trip-reference URL, PLUS a grep gate (CI `.mjs`) asserting exactly ONE `export const buildStaticMapUrl` definition repo-wide and that it lives under `packages/event-rendering/`. FAILS if someone re-forks the primitive or changes the URL contract.
- **RT-3 (Bug 2 — failsafe):** a render test asserting that with `locationGeo:null` the map `<Image>` is ABSENT and the text venue card is PRESENT. FAILS if the rule-9 fallback is removed (blank box).
- **RT-4 (Bug 3A):** a `Button` test asserting (a) `accentColor="#1d4ed8"` `variant="primary"` → background "#1d4ed8"; (b) no `accentColor` → `accent.warm`; (c) label contrast ≥4.5:1 for two extreme hues. FAILS if the CTAs revert to plain `variant="primary"` (the brand color disappears) or the contrast resolver is dropped.

---

## 10. Open questions

- **OQ-1 (Bug 2 web adapter path):** does the buyer-web `/e/{slug}/{slug}` route render through `mingla-business/src/components/event/PublicEventPage.tsx` (`mapLiveEventToPublicEvent`) with a `LiveEvent` already carrying `locationGeo`, OR does it hydrate from `publicEventViewRowToEvent` (which currently drops `row.location_geo`)? The investigation (F-2) says the public mapper drops it. RESOLUTION FOR IMPLEMENTOR: thread geo at BOTH `mapLiveEventToPublicEvent` AND `publicEventViewRowToEvent` (+ add `location_geo` to `BusinessPublicEventViewRow`) so whichever path the web route uses ends up with coords. No blocker — both are in the allowlist.
- **OQ-2 (Bug 3A color source):** Q2 is LOCKED to `coverHue`, so this spec derives the CTA color from `hsl(coverHue,60%,45%)`. BUT the public-page CTA (the one the buyer sees on `/e/...`) themes from `resolveTheme(brand.theme, event.themeOverrides).color` (the brand theme color), which can differ from `coverHue`. If Seth wants the checkout CTA to visually MATCH the public-page CTA, flip the derivation source to `resolveTheme(...).color`. Flagged for a one-line Seth decision; default (per the lock) is `coverHue`.
- **OQ-3 (COMMS-0040/0041 coordination — HARD):** the experience-page touch (B.4) intersects two imminent structural moves: COMMS-0040 (RSVP body → `packages/`) and COMMS-0041 (public-experience-page standardization onto `@mingla/offering-rendering`, retiring `ExperiencePreview` + unifying the read onto one RPC like `pg_public_experience_by_slug`). This spec adds the experience map block ADDITIVELY (a stop-geo SELECT add + a render block on the EXISTING `ExperiencePreview` + the EXISTING `publicExperienceService` read shape) so it survives the promotion: when the body moves onto `@mingla/offering-rendering`, the same `buildStaticMapUrl(start-stop geo, palette.accent)` block ports over unchanged, and the `lat/lng` stop fields carry into the new RPC's projection. **Do NOT** introduce a new bespoke experience-detail renderer, **do NOT** diverge the `publicExperienceService` read PATTERN (only add columns), and **do NOT** migrate the experience page onto offering-rendering in this ORCH. Coordinate via the COMMS-0041 row before merge. The event map block lives in `@mingla/event-rendering/PublicEventPage` (COMMS-0038 confirms this is already the single shared standard-event body) and is rsvp-safe (added to the non-rsvp branch only — COMMS-0040).

---

## 11. Downstream routing

- **NEXT = mingla-implementor.** Build all three fixes in ONE worktree / ONE PR. Inputs: this SPEC + the three INVESTIGATE artifacts. Honor the allowlist + do-not-touch (below). Prove all four RT gates fail-on-revert. Write the implementation report under the worktree's `Mingla_Artifacts/reports/`.
- **THEN = mingla-tester:** runtime-verify SC-1..SC-11 across consumer iOS/Android, business iOS/Android, buyer-web (device + sim). Use a real in-person event WITH `location_geo` (e.g. "Vibes and Stuff" / "The Reckoning", coords `(-78.7399073,35.7907102)`) for the map; a known-time event for AM/PM; any branded event for theming.
- **THEN = mingla-orchestrator CLOSE:** flip the four `DRAFT I-PROPOSED-1162-*` invariants ACTIVE; sync World Map / registry. STOP at on-device QA + merge (Conductor auto-advance otherwise).
- **Worktree:** no ORCH-1162 worktree exists yet. The orchestrator spawns `~/Desktop/mingla-orchs/ORCH-1162-[public-event-cart-polish]/` on branch `ORCH-1162-public-event-cart-polish` at IMPLEMENT dispatch. (This SPEC artifact was written into the anchor `Mingla_Artifacts/specs/` because no worktree was provided to the SPEC phase; the implementor should `git fetch && rebase origin/main` in the spawned worktree before starting.)

### Allowlist (implementor MAY change ONLY these)
- `app-mobile/src/utils/eventDateDisplay.ts` (Bug 1)
- `packages/event-rendering/QuantityRow.tsx` (Bug 1)
- `mingla-business/src/components/brand/ExperienceMiniCard.tsx` (Bug 1, optional hygiene)
- `packages/event-rendering/mapboxStaticImage.ts` (NEW — Bug 2 primitive)
- `packages/event-rendering/index.ts` (export the primitive)
- `packages/event-rendering/package.json` (add `expo-constants` peerDep)
- `mingla-business/src/utils/mapboxStaticImage.ts` (re-export)
- `app-mobile/src/utils/mapboxStaticImage.ts` (re-export)
- `packages/event-rendering/types.ts` (`PublicEventProps.locationGeo`)
- `packages/event-rendering/PublicEventPage.tsx` (Bug 2 render block, NON-rsvp only)
- `mingla-business/src/components/event/PublicEventPage.tsx` (`mapLiveEventToPublicEvent`)
- `mingla-business/src/services/publicEventsService.ts` (`publicEventViewRowToEvent` + `BusinessPublicEventViewRow` geo — per OQ-1)
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (`mapCardToPublicEvent`)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (`cardToPublicEvent`)
- `mingla-business/src/services/publicExperienceService.ts` (ADDITIVE stop `lat/lng`)
- `mingla-business/src/components/experience/ExperiencePreview.tsx` (Bug 2 experience map)
- `mingla-business/src/components/ui/Button.tsx` (Bug 3A `accentColor`)
- `mingla-business/src/utils/coverHueColor.ts` (NEW — `coverHueToHex`) or equivalent sibling util
- `mingla-business/app/checkout/[eventId]/index.tsx`, `buyer.tsx`, `payment.tsx` (Bug 3A wiring)
- NEW test files under each layer's `__tests__/` (RT-1..RT-4)

### DO-NOT-TOUCH (stop-and-amend before any of these)
- `mingla-business/src/components/trip/TripPreview.tsx` + `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (trip reference — only re-confirm parity)
- the `event_type==='rsvp'` early-return body in `PublicEventPage.tsx` + `RsvpPublicBody.tsx` (COMMS-0040)
- `format24hTimeInTz`, `formatEventLocalRange`, `formatTimeLabelInTz` internal h23 read, `experienceDateSubline.ts formatTimeLine` (intentional/correct)
- `CartContext.tsx`, cart seeds, `useCartTotals`, payment all-in display, `ticket-checkout-create` `unit_amount`, `publicExperienceService`/`tripsService` PRICING fields, the ORCH-1147 tests (Bug 3B → ORCH-1164)
- `@mingla/offering-rendering` migration of the experience page (COMMS-0041 — additive only here)
- any DB migration / RLS / edge-function logic change (this ORCH is client + shared-package only)
