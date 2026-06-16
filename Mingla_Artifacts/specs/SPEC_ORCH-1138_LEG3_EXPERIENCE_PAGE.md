# SPEC — META-ORCH-1138 Leg 3: Public EXPERIENCE Page Redesign + Reservation Intelligence (ALL surfaces)

**Mode:** SPEC (contract; no code). **Date:** 2026-06-15.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` on branch `ORCH-1138-experience-page` (HEAD up-to-date with origin/main; Leg 1 trip redesign merged `0fd6f39c4`).
**Author phase:** mingla-forensics SPEC.

> **COMMS on entry:** scanned `COMMS_LEDGER.md` Active table. No `BLOCK`+`OPEN` row addressed to `mingla-forensics`/`ORCH-1138`/`ALL`. Two `WARN`+`OPEN` to `ALL`: **COMMS-0034** (biz-web lucide blank-out) RESOLVED 2026-06-14 — no action. **COMMS-0035** (OPEN): `expo-image-manipulator` NATIVE module added to mingla-business by ORCH-1119 ships via OTA without a runtime bump; the business prod binary (runtime `1.0.0`) may lack the native side. **Acked + factored in** (this spec's allowlist forbids adding ANY new native module to mingla-business — see §Scope non-goals + §DO-NOT-TOUCH — so Leg 3 cannot compound the COMMS-0035 hazard; Leg 3 is JS/SQL/edge only and OTA-safe on the business app, except the recurrence-materialization sub-part which is server-side and OTA-irrelevant). `acked_by += mingla-forensics+SPEC (ORCH-1138 Leg 3)`.

> **Input note (provenance):** the dispatch cited `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_EBES_DEAD_CODE_DELETABILITY.md` as a prior EBES-deletability investigation. That file does **not exist** on the anchor, the worktree, or anywhere on disk. Per the SPEC hard rule "no new investigation inside SPEC," I did NOT improvise a fresh forensic root-cause; instead I grounded the EBES deletion sequence on **direct code reads** (the four real EBES consumers + the render sites + the import graph, cited file:line below) and the dispatch's stated conclusion. The EBES deletion sequence in §4.7 is bounded by what the code proves today. **OPEN QUESTION OQ-7** flags that the missing report should be located or the EBES deletion re-investigated before IMPLEMENT if any consumer below is stale.

---

## 1. Executive summary

The public experience page (`/exp/{brandSlug}/{experienceSlug}`) is the **last** unthemed, locked-dark, standalone offering renderer in Mingla — the only public page that ignores brand color/font. Leg 3 rebuilds it onto the SAME Direction-A foundation the trip leg (Leg 1) and event leg (Leg 2) already ship: `@mingla/offering-rendering`'s `ParallaxCoverShell` + `OfferingChrome` + `CountAwareGallery` + `ChipGroup` + `useResponsiveLayout`, the `@mingla/event-rendering` `createThemePalette`/`resolveTheme`/`offeringSurfaceStyles` engine, the float→dock Reserve CTA, and the responsive desktop two-column sticky panel — across web (`/exp/`), business (the same RN-web route + wizard preview), and consumer (a NEW `ConsumerExperienceDetailScreen` mirroring `ConsumerTripDetailScreen`).

It standardizes the verb to **"Reserve"** and wires the **adaptive reservation flow** the consumer deck already proved in ORCH-1072: count of bookable upcoming occurrences drives single → straight-to-cart, multi/recurring → slot picker → cart. It brings that picker to the public/web page (which has the raw dates but no count-driven picker today). It closes the documented **read-path gaps** in `publicExperienceService` (vibe intents, stop description, stop coords, per-date remaining — all authored/derived real data the page renders but the read path silently drops).

It defines, as a **clearly-scoped sub-part (§4.6)**, the ONE real supply gap the reservation-intelligence investigation proved: **recurring experiences never materialize their repeats into bookable `event_dates` rows** (the recurrence rule is decorative; the "Open daily (hours)" restaurant-style state is the most open-ended version of this gap). This sub-part needs a **schema/edge-adjacent change** (a server-side materializer at publish/edit time) and is flagged for Seth's **fold-in vs sibling** decision (OQ-1).

Finally, Leg 3 completes the **EBES decommission**: it repoints the deck-experience + venue "experiences here" consumers (this leg) and the chat events+trips consumer (this leg's final repoint) off `ExpandedBusinessEventSheet`, then DELETES EBES with zero dead code (its test suite retargeted), sequenced so nothing breaks.

---

## 2. Scope & non-goals

### In scope
1. **Experience page → Direction-A on the foundation** (web + business): re-architect `ExperiencePreview.tsx` into the dual-mode (FOUNDATION/LEGACY) shape `TripPreview.tsx` uses; rebuild route `app/exp/[brandSlug]/[experienceSlug].tsx` to resolve theme→palette→surface and feed the foundation (mirror `app/t/[brandSlug]/[tripSlug].tsx`). Closes the experience theming gap (DESIGN §B.1).
2. **Read-path widen** in `publicExperienceService.ts`: add `experience_intents`, `stop.description` (`ai_description`), `stop.lat`/`lng`, and per-date `ticketsRemaining` (DESIGN §F.5).
3. **"Reserve" CTA + adaptive flow** on the public/web page: single date → straight to cart/checkout; multi-date/recurring → slot picker → cart. Reuse the ORCH-1072 bookable-occurrence count signal. Single float→dock CTA (NO pay-split — experiences have no installment plan, DESIGN §A.7).
4. **"OPEN DAILY (hours)" reservation state** (restaurant-style: date + time-within-hours + party-size → cart) — UI/state contract here; its supply dependency is §4.6.
5. **Recurrence/open-daily materialization sub-part (§4.6)**: server-side expansion of `recurrence_rules` → bounded future `event_dates` rows at publish/edit time (+ optional rolling top-up). Schema/edge-adjacent. Fold-in vs sibling = OQ-1.
6. **Consumer experience detail**: NEW `ConsumerExperienceDetailScreen` (mirror `ConsumerTripDetailScreen`) + consumer Reserve bar (reuse `ConsumerTripReserveBar` or an experience sibling) + the occurrence picker; repoint the **deck experience** and **venue "experiences here"** entries off EBES to it.
7. **EBES final deletion**: repoint the **chat consumer** (events + trips) to the Leg-1 trip detail / Leg-2 event detail; then DELETE `ExpandedBusinessEventSheet.tsx`; retarget its test suite; zero dead code.

### Non-goals (explicit)
- **No new authoring fields.** Inclusions and cancellation/refund policy are NOT authored by the experience wizard (DESIGN §A.7) — NOT rendered, NOT read-path-wired. Adding either is a separate ORCH.
- **No per-occurrence capacity.** Capacity stays EVENT-level (I-1 ONE-TICKET; investigation Q2). The picker shows the SAME event-wide remaining on every slot; it never invents a per-slot cap.
- **No new native module in mingla-business** (COMMS-0035 guard). The map block reuses the EXISTING `buildStaticMapUrl` Mapbox-static-image approach (a plain `<Image>`, no map SDK) Leg 1 already shipped — no new dependency.
- **No pay-split / installment control on experiences** (no `installmentSchedule` in the model; DESIGN §A.7).
- **No checkout-contract change.** `ticket-checkout-create` already accepts optional `eventDateId` (investigation Q5); the request stays byte-identical to today on the null path. Leg 3 adds NO new field to the checkout request.
- **No Stripe/money-path edits** beyond passing the already-supported `eventDateId`.
- **Leg-2 event detail is a DEPENDENCY, not in scope.** The chat repoint's event branch targets the Leg-2 consumer event detail. Leg 2 is in a parallel worktree (`ORCH-1138-[event-page]`), unmerged. Sequencing constraint in §4.7 + OQ-6.

### Assumptions
- Leg 1 (trip) foundation is merged and is the canonical reference (`TripPreview` FOUNDATION mode, `app/t/.../[tripSlug].tsx`, `ConsumerTripDetailScreen`, `ConsumerTripReserveBar`, the `@mingla/offering-rendering` package).
- The anon RLS that lets `publicExperienceService` read `events`/`experience_stops`/`ticket_types`/`event_dates` already covers the newly-selected columns (they're columns on already-readable rows — no new RLS policy needed; verify in IMPLEMENT, §4.1).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|----------------------|--------------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | Deck experience + venue "experiences here" open the NEW `ConsumerExperienceDetailScreen` (Direction-A native: pinned cover + chrome + scrolling itinerary + Reserve bar + adaptive occurrence picker). Chat trip/event open Leg-1/Leg-2 detail. EBES gone. | `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (NEW), `ExpandedCardModal.tsx`, `MessageInterface.tsx`, `venueExperienceMapping.ts` (repoint), `ConsumerExperienceReserveBar.tsx` (NEW or reuse), delete `expandedCard/ExpandedBusinessEventSheet.tsx` | Manual (separate native path; SC split per-surface) |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | Same as iOS; all translucent panels use the opaque ≥0.92 frosted fallback (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). | same as #1 | Manual (Android-glass deltas) |
| 3 | **Buyer/anon Web** (`mingla-business` `/exp/{brandSlug}/{experienceSlug}`) | YES | Themed Direction-A page: parallax cover + chrome (X/Share/Mute), brand color/font, City,Country meta, vibe chips, real-stop itinerary with per-stop count-aware galleries + blurbs, map of stop 1, "Reserve" CTA, adaptive date/slot picker (incl. open-daily time+party state), desktop sticky panel. | `app/exp/[brandSlug]/[experienceSlug].tsx`, `src/components/experience/ExperiencePreview.tsx`, `src/services/publicExperienceService.ts`, `src/hooks/usePublicExperience.ts`, NEW `src/components/experience/ExperienceReserveBar.tsx` (or reuse `TripReserveBar`), NEW occurrence/slot picker component | Manual (RN-web render path) |
| 4 | **Business iOS** | YES | Wizard Step-5 preview keeps LEGACY mode byte-stable; brand viewing their own published experience via the same `/exp/` route gets the themed page. No new native module (COMMS-0035). | `ExperiencePreview.tsx` (LEGACY branch preserved), wizard caller unchanged | Auto (shared `ExperiencePreview`; LEGACY path byte-identical) |
| 5 | **Business Android** | YES | Same as Business iOS + Android-glass fallback on the themed page. | same as #4 | Auto + Android-glass |
| 6 | **Admin Web** (`mingla-admin/`, adjacent) | NO | Admin has no experience buyer page. | — | One-phrase reason: admin never renders the public experience page. |
| 7 | **Business Web preview** (adjacent) | YES (via #3) | The business app web build serves `/exp/` (same RN-web route) — the themed page IS the business-web preview. | (covered by #3) | Auto |

**Server-side (cross-cutting, all surfaces):** §4.1 read-path widen + §4.6 materialization (publish/edit RPCs + optional cron) affect every read surface uniformly via the data model — parity is automatic for the supply.

---

## 4. Layered specification

### 4.0 Foundation reuse map (what is REUSED, not rebuilt)

| Need | Reuse (do NOT re-author) | Source |
|------|--------------------------|--------|
| Parallax cover + fixed chrome + desktop sticky frame | `ParallaxCoverShell` | `@mingla/offering-rendering` (`packages/offering-rendering/index.ts`) |
| Native cover/chrome/scroll compose (consumer sheet) | `OfferingChrome` + compose-around pattern | `ConsumerTripDetailScreen.tsx:83-104` comment + body |
| Count-aware per-stop / cover galleries | `CountAwareGallery` | `@mingla/offering-rendering` |
| Vibe chips | `ChipGroup` (variant neutral/accent) | `@mingla/offering-rendering` |
| City,Country normalization | `normalizeCityCountry` | `@mingla/offering-rendering` |
| Brand theming | `resolveTheme` → `createThemePalette` → `offeringSurfaceStyles` / `resolveOfferingSurface` + `boldFontFamily` + `useThemeFont` | `@mingla/event-rendering` + `src/theme/useThemeFont.ts` |
| Reserve bar (float/docked variants, CtaState) | `TripReserveBar` (web/biz) / `ConsumerTripReserveBar` (consumer) — extend props OR sibling `Experience*ReserveBar` (OQ-2) | `mingla-business/src/components/trip/TripReserveBar.tsx`, `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` |
| Map block (no SDK) | `buildStaticMapUrl` | `mingla-business/src/utils/mapboxStaticImage.ts` |
| Collapsible About | `CollapsibleDescription` | `mingla-business/src/components/offering/CollapsibleDescription.tsx` |
| Occurrence picker signal + per-slot payload + checkout `eventDateId` | the ORCH-1072 logic in EBES (`bookableOccurrences`, `beginBooking`) — EXTRACT into a shared hook/component before EBES is deleted (§4.4) | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:236-247,439-478,348-352` |

> **Architectural rule (mirrors Leg 1C, `ConsumerTripDetailScreen.tsx:83-104`):** the consumer detail does NOT import `ExperiencePreview` (it is business-local) and does NOT mount `ParallaxCoverShell` as the gorhom sheet host (its `nativeHost` wrapper breaks the gorhom direct-child contract → frozen scroll). It COMPOSES the Direction-A native look (pinned cover + `OfferingChrome` + a bare `scrollMode="scroll"` `BottomSheetScrollView` direct child + floating/docked Reserve) the SAME way `ConsumerTripDetailScreen` does. **Honor the sheet-scroll invariant (gorhom scroll host is a DIRECT child of `BaseBottomSheet`; `BaseBottomSheet` is the SOLE gorhom consumer).**

### 4.1 Database / RLS (read-path widen — no schema change in this section)

No new tables/columns in §4.1. The four "gap" fields are EXISTING columns on already-anon-readable rows:
- `experience_intents` — read from `events.experience_intents` (text[]) **or** the `experience_intents` join table (verify which the wizard persists to; investigation §A.2 says both `events`/`experience_intents`). IMPLEMENT confirms the canonical column and that anon SELECT already covers it.
- `experience_stops.ai_description`, `experience_stops.lat`, `experience_stops.lng` — add to the SELECT in `loadExperienceSidecars` (`publicExperienceService.ts:265`). All on `experience_stops` (already anon-readable via `experience_stops_select_public`).
- Per-date `ticketsRemaining` — derived, NOT a column. See §4.3 (compute remaining for the preview path, currently hardcoded `null` at `publicExperienceService.ts:206`).

**RLS verification gate (IMPLEMENT):** confirm the existing anon SELECT policies do NOT column-restrict (Supabase RLS is row-level, not column-level by default; a `SELECT *`-style policy already exposes these columns). If any policy is column-scoped (it is not, per the service's `select("*")` on events at `:316`), STOP-AND-AMEND.

### 4.2 Service — `publicExperienceService.ts`

Widen the types + maps (no behavior change to the resolve flow):
- `PublicExperienceStop` (`:31-38`) += `description: string | null`, `lat: number | null`, `lng: number | null`.
- `loadExperienceSidecars` stops SELECT (`:265`): add `ai_description, lat, lng`.
- `mapExperience` stops map (`:228-235`): map `description: s.ai_description ?? null`, `lat: typeof s.lat === "number" ? s.lat : null`, `lng: …`.
- `PublicExperience` (`:61-89`) += `intents: string[]` (from `events.experience_intents` / join). `mapExperience` maps it (`[]` when absent — never fabricate).
- Error contract unchanged: throws on RLS/network error (no silent fallback). Return types fully typed (no `any` added beyond the existing eslint-disabled mapping inputs).

### 4.3 Per-date remaining (close the §F.5 #4 gap)

The slug-preview path sets `ticketsRemaining: null` (`:206`); the checkout sibling computes it. Bring the remaining computation into the public preview so the picker can show "N left" + sold-out per slot:
- Event-level remaining = `quantity_total − sold` where sold counts `tickets.status IN ('valid','used','transferred')`; `quantity_total = NULL` ⇒ unlimited (investigation Q2). Reuse the canonical reader (`pg_public_ticket_types_remaining` / the deck RPC's subqueries) — do NOT hand-roll a new count.
- Stamp the SAME event-level remaining onto every occurrence in the date list (per Q2 — there is no per-occurrence cap; the picker shows the same N per slot). `remaining = 0` ⇒ that slot renders disabled; all-slots-0 ⇒ Sold out.

> **Decision needed (OQ-3):** compute remaining client-side in the hook (mirrors the checkout sibling `usePublicExperienceById`) **or** add it to a thin RPC. Recommended: reuse the existing canonical reader RPC the deck already calls; do NOT introduce a new SQL count.

### 4.4 Adaptive Reserve flow — extract + reuse the ORCH-1072 signal

The single-vs-picker logic is proven and shipping in EBES. **Before EBES is deleted (§4.7)**, extract it into a shared, surface-agnostic unit so all three surfaces share ONE implementation:
- Signal: `bookableOccurrences = occurrences.filter(o => o.remaining === null || o.remaining > 0)` (EBES `:246-247`).
- `beginBooking` rule (EBES `:439-478`): `> 1` → open picker; `=== 1` → auto-select that `eventDateId` + skip to cart; `0` (one-off / no-date supply) → straight to cart with no `eventDateId`.
- Checkout: pass `eventDateId` ONLY when a slot is selected (EBES `:348-352`); `ticket-checkout-create` validates it (investigation Q5: `index.ts:237-239,306-334`). **Byte-identical** on the null path — the request MUST NOT change for single/no-date experiences.

**Deliverable:** a shared occurrence-picker component + a `useAdaptiveReservation(occurrences)` hook (location TBD — `@mingla/offering-rendering` if it can be RN+web safe, else `app-mobile/src/components/offering/` for consumer and a web-local mirror; OQ-4). The web/`/exp/` page consumes it (it has the raw `dates[]` today but no count-driven picker — investigation Q3/Discovery #2). The consumer detail consumes it. The Reserve verb is **"Reserve"** everywhere (replace the current "Get my spot" copy at `app/exp/.../[experienceSlug].tsx:181,184` and the legacy CTA).

### 4.5 "OPEN DAILY (hours)" reservation state (UI/state contract)

Restaurant-style state from DESIGN (Seth-approved): when an experience is **daily/recurring with operating hours**, the booking block presents **date + time-within-hours + party-size → cart**.
- **Date:** the adaptive picker's date list (from materialized daily occurrences — depends on §4.6).
- **Time-within-hours:** a time selector bounded by the occurrence's window (`event_dates.start_at`…`end_at`, which carry the master `doorsOpen`/`endsAt` per the publish RPC `:405-411`). The model has NO separate per-day "hours" field; the window IS `[start_at, end_at]`. **Slot interval is undefined in the model** → OQ-5 (Seth picks the interval, e.g. 30/60 min, or "any time in window"). Until OQ-5 resolves, the contract is: render the window as the bound; do NOT fabricate finer slots than the data supports.
- **Party-size:** maps to **quantity** on the existing one ticket (the cart already supports quantity). Bounded by event-level remaining. Party-size does NOT create new line items (I-1 ONE-TICKET) — it's `quantity` on the single ticket line.
- **To cart:** selected date → `eventDateId`; quantity → cart quantity; checkout request byte-identical except the already-supported `eventDateId` + quantity (both pre-existing).

> The open-daily state is **gated on §4.6 supply.** Without materialized daily occurrences there is exactly one bookable date and the state collapses to single. Flag in OQ-1.

### 4.6 SUB-PART — Recurrence / Open-Daily materialization (SCHEMA/EDGE-adjacent; fold-in vs sibling = OQ-1)

**The one real supply gap** (investigation Q4, proven): for `whenMode='recurring'`, the publish RPC (`20260825000000_…sub_b_publish_experience.sql:400-414`) and the live-edit RPC (`20260902000000_…sub_e_update_live_experience.sql:396-409`) materialize exactly ONE master `event_dates` row; the `recurrence_rules` jsonb is never expanded server-side. The client expander (`recurrenceRule.ts:185`, `HARD_CAP=52`) is display-only and consumed by NO read path. So a recurring/open-daily experience has ONE bookable slot; the picker has nothing to list; the buyer can never reserve the 2nd…Nth occurrence.

**Contract for the fix:**
1. **Server-side materializer** at the SAME publish/edit point (I-4: `event_dates` materialized at PUBLISH; investigation Invariant Impact). In the `IF v_when_mode IN ('single','recurring')` branch, when `recurring`, expand `v_recurrence_rules` from the master `v_start` into N bounded future rows (the master keeps `is_master=true`; expanded rows `is_master=false`). Port the client expander's preset/byDay/byMonthDay/bySetPos + termination (count/until/never) semantics into SQL (`generate_series`/recursive CTE), bounded.
2. **Bound:** match the existing client `HARD_CAP=52` OR a rolling window (e.g. next 90 days), Seth's choice (OQ-1 sub-question). For `never`-ending rules, a bounded window + an **optional rolling cron top-up** (a daily job that tops the window back up as occurrences pass) keeps the picker non-empty without unbounded rows.
3. **Daily / "open daily":** `preset='daily'` + `termination='never'` is the open-ended case → the materializer produces the daily occurrences the open-daily UI (§4.5) lists; each carries the master `[doorsOpen, endsAt]` window as its `[start_at, end_at]`.
4. **No checkout change:** because materialized rows are real `event_dates`, the checkout `eventDateId`-FK validation (investigation Q5) works unchanged.
5. **Capacity stays event-level** (I-1): the materializer adds NO capacity column; remaining is computed event-wide and stamped per slot (§4.3).

**Why this is schema/edge-adjacent:** it is a migration that re-emits the publish + live-edit RPC bodies (`CREATE OR REPLACE FUNCTION`) with the expansion logic, plus (if rolling) a new scheduled function. It is NOT a pure-JS change → it cannot ship via the business OTA; it ships as a migration applied via the Management API (per the memory's migration-apply hazards). **It is the only part of Leg 3 that touches the DB function layer.**

> **OQ-1 (decision for Seth): fold §4.6 into Leg 3, or spin a sibling ORCH?** Recommendation rationale for Seth: the page UI (§4.1–4.5) is shippable NOW for `single` + `multi_date` with zero schema change; `recurring`/open-daily is the only part needing the migration. Fold-in keeps the open-daily state honest at launch but couples a JS/web leg to a DB-function migration + re-emit-from-live-body hazard (COMMS-0029-class: the live prod RPC body must be preserved — ORCH-1119/1120 markers, etc.). Sibling lets the page ship immediately and the supply land separately. **Seth decides.**

### 4.7 EBES decommission + final deletion (sequence — order is load-bearing)

The four real EBES consumers (proven by import + render-site reads):
- `ExpandedCardModal.tsx:52` import; **render A** `:1742` (deck event — repointed by **Leg 2**) and **render B** `:2259` (venue "experiences here" → `selectedVenueExperience` → EBES — **THIS leg**).
- `MessageInterface.tsx:65` import; **render** `:2182` (chat group event/trip → `friend.eventPublicCard` + `friend.linkedEntityType` — **THIS leg's final repoint**).
- `ConsumerTripDetailScreen.tsx` — imports the string in a COMMENT only (`:117-121`); NOT a live consumer (Leg 1 already repointed trips off EBES). Verify no live JSX in IMPLEMENT.
- `venueExperienceMapping.ts` / `eventDateDisplay.ts` — utils that MAP onto `BusinessEventCard` (EBES's data shape) and SHARE `formatEventDateLine`; they are not EBES importers per se. Keep the mapping utils (they feed the new screen too); only the EBES render sites move.

EBES internals: renders shared `PublicEventPage` (`@mingla/event-rendering`) + ORCH-1072 occurrence picker + `TicketCartSheet` via `useNativeCheckoutFlow` (`ExpandedBusinessEventSheet.tsx:38,52-58`). `TicketCartSheet` references EBES only in comments (no import) → **no circular dep; the cart survives EBES deletion.**

**Sequence (each step independently green; revertible):**
1. **Extract the shared adaptive-reservation unit (§4.4)** from EBES into its shared home FIRST, while EBES still renders, so both old + new paths use it. Tests green.
2. **Build `ConsumerExperienceDetailScreen`** (Direction-A native compose, mirror `ConsumerTripDetailScreen`) consuming the extracted unit + `useConsumerExperienceDetail` (NEW hook, mirror `useConsumerTripDetail`; anon-read per COMMS-0009 — NEVER `.from('brands')`, use RPC-sourced brand fields).
3. **Repoint render B (venue "experiences here")** in `ExpandedCardModal.tsx:2258-2265` from `<ExpandedBusinessEventSheet data={selectedVenueExperience}>` to `<ConsumerExperienceDetailScreen …>` (sibling-sheet pattern preserved — the proven sub-sheet rule, `feedback_rn_sub_sheet_must_render_inside_parent`). Deck-experience open path (the `experienceRecToBusinessEventCard` flow at `SwipeableCards.tsx:130`/`ExpandedCardModal`) repointed to the new screen.
4. **Repoint chat (`MessageInterface.tsx:2181-2192`)**: branch on `friend.linkedEntityType` — `"trip"` → Leg-1 `ConsumerTripDetailScreen`; `"event"` → **Leg-2 consumer event detail** (DEPENDENCY — OQ-6); experience-in-chat (if reachable) → `ConsumerExperienceDetailScreen`. Remove `showGroupEventSheet` EBES mount.
5. **Confirm render A (deck event)** is already off EBES via Leg 2 (merge order — OQ-6). If Leg 2 has NOT merged at IMPLEMENT time, the deck-event branch (`ExpandedCardModal.tsx:1740-1753`) still points at EBES → **EBES deletion BLOCKS on Leg 2 merge** (do not delete until render A is repointed). Flag.
6. **DELETE `ExpandedBusinessEventSheet.tsx`** + its now-orphaned EBES-only imports. Remove the `:52` / `:65` / `:117-121`-comment references.
7. **Retarget the EBES test suite:** the EBES-keyed tests (`orch1065_experience_expand.test.tsx`, `orch_1025_seamless_native_cart.test.tsx`, etc. that mount/assert EBES) retarget to `ConsumerExperienceDetailScreen` / the extracted unit; delete tests that asserted EBES-internal structure with no behavioral successor. Net: zero references to `ExpandedBusinessEventSheet` outside git history.

### 4.8 Component states (all states, every surface)

Per DESIGN §E — Loading (skeleton: cover + title + meta + 2 stop bars + price), Error (real PostgrestError message + retry), Not-found/not-live, No-cover (accent hue), Cover-is-video (Mute toggle), Available (Reserve + "N spots left" + per-slot "N left"), Deadline/filling-up (accent banner + highlighted near-empty slot), Sold-out (banner + disabled CTA), Ended (`allDatesPast` — preserve `[experienceSlug].tsx:51-57` logic), Not-bookable (`bookable===false` → "Booking unavailable — organizer finishing payment setup", preserve ORCH-1076), whenMode=single (picker collapses to one date chip), Free (no all-in line; CTA "Reserve" / "Get my spot" → standardize to "Reserve"), Empty-stops (section omitted; 2-min enforced). Open-daily (§4.5): date + time-in-window + party-size.

### 4.9 Realtime
N/A — no realtime channel added. Remaining is read at fetch; no live-capacity socket (consistent with the existing experience/trip pages).

---

## 5. Success criteria (numbered; per-surface where parity is manual)

- **SC-1 (theming)** — `SC-1-Web` / `SC-1-iOS` / `SC-1-Android`: setting a brand's theme color/font changes the experience page's accent (every accent), page light/dark, and the title/section-head/stop-title/price/CTA font. The page is NEVER locked to `#0c0e12`/`accent.warm`. (Contrast ≥3.15:1 page, ≥4.5:1 white-on-accent via the palette engine.)
- **SC-2 (read-path)** — vibe chips render real `experience_intents`; each stop renders its real `ai_description` blurb; the map block renders stop-1's real lat/lng (or, if absent, NO map — never a placeholder, rule 9). Verified: a published experience whose stops have blurbs shows them (today the read path drops them).
- **SC-3 (adaptive Reserve)** — `SC-3-Web`/`-iOS`/`-Android`: an experience with >1 bookable occurrence opens the slot picker on Reserve; ===1 auto-selects and goes straight to cart; 0/single goes straight to cart. The checkout request is byte-identical to today on the single/no-date path (no `eventDateId`); a picked slot adds `eventDateId` only.
- **SC-4 (verb)** — every Reserve affordance reads **"Reserve"** (CTA, bar, desktop control). No "Get my spot" / "Reserve my spot" divergence across surfaces.
- **SC-5 (single CTA, no split)** — the experience page renders ONE Reserve CTA (float→dock on phone, sticky on desktop). NO pay-in-full/pay-over-time split (experiences have no plan).
- **SC-6 (open-daily)** — a daily/recurring experience with operating hours presents date + time-within-window + party-size → cart; party-size sets quantity on the one ticket (never new line items). [Gated on SC-9.]
- **SC-7 (consumer detail)** — `SC-7-iOS`/`-Android`: the deck experience + venue "experiences here" open `ConsumerExperienceDetailScreen` (themed, scrolling body, pinned cover, Reserve bar). The sheet body SCROLLS and Reserve stays pinned (gorhom direct-child contract honored — no frozen scroll).
- **SC-8 (EBES gone)** — `ExpandedBusinessEventSheet.tsx` is deleted; zero references in non-test source; deck/venue/chat all render their repointed targets; no dead code; the app builds + all suites green.
- **SC-9 (materialization)** — [if folded in] a recurring/open-daily experience materializes ≥2 bookable future `event_dates` rows at publish; the picker lists them; reserving the 2nd occurrence succeeds via `eventDateId`. `never`-rules stay bounded (≤ cap or rolling window). [If sibling: SC-9 moves to the sibling ORCH; SC-6 collapses to single until then.]
- **SC-10 (Android glass)** — every translucent panel (vibe chips, brand row, slot rows, sticky panel) uses the opaque ≥0.92 fallback + `overflow:'hidden'` + no Android shadow under rounded fill on Android.
- **SC-11 (rule 9)** — the page renders ONLY wizard-authored + legitimate-derived fields. No inclusions block, no refund ladder, no placeholder map, no fabricated per-slot capacity.
- **SC-12 (wizard preview byte-stable)** — `ExperiencePreview` LEGACY mode (palette absent) renders byte-identical to today for the wizard Step-5 caller.

---

## 6. Invariants

| ID | Status | How preserved | Test |
|----|--------|---------------|------|
| **I-1 ONE-TICKET** | preserve | one sellable `ticket_types` row; party-size = quantity, never new lines; no per-slot cap | a test asserts the cart line count stays 1 and remaining is event-level |
| **I-4 EVENT_DATES materialized at PUBLISH** | preserve + extend | §4.6 materializer hangs off the SAME publish/edit point; checkout FK-validation unchanged | publish a recurring experience → assert N rows materialized at publish, none at runtime |
| **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED (ORCH-1076)** | preserve | `bookable===false` → graceful "Booking unavailable" banner; Reserve non-tappable | preserve `[experienceSlug].tsx:166-179,224-238` behavior on the new page |
| **COMMS-0009 anon-read** | preserve | consumer detail data via anon-direct events/`experience_*` reads + RPC-sourced brand fields; NEVER `.from('brands')` | grep gate: `ConsumerExperienceDetailScreen` + its hook contain no `.from('brands')` |
| **Byte-identical checkout** | preserve | request unchanged except the already-supported optional `eventDateId` + existing quantity | snapshot the checkout body for a single experience pre/post |
| **ANDROID_GLASS_USES_OPAQUE_FALLBACK** | preserve | `Platform.select` opaque ≥0.92 + `overflow:'hidden'` on every translucent panel | reuse the existing android-glass gate |
| **Constitution rule 9 (no fabrication)** | preserve | no inclusions/refund/placeholder-map/per-slot-cap | new `experienceNoFabricatedFields.orch1138.test.ts` (mirror `tripNoFabricatedFields`) |
| **BaseBottomSheet SOLE gorhom consumer / direct-child scroll** | preserve | consumer detail composes like `ConsumerTripDetailScreen` (bare `scrollMode="scroll"`, host = direct child) | reuse the consumer-trip-foundation scroll test pattern |
| **I-PROPOSED-1138-EXPERIENCE-THEMED (DRAFT)** | NEW | the experience page resolves a palette and renders no hardcoded `#0c0e12`/`accent.warm` in FOUNDATION mode | a grep/render test asserts the FOUNDATION path has no hardcoded page bg/accent — flips ACTIVE on CLOSE (orchestrator owns the flip) |
| **I-PROPOSED-1138-EBES-DELETED (DRAFT)** | NEW | no `ExpandedBusinessEventSheet` reference in non-test source | strict-grep gate `.github/scripts/strict-grep/orch-1138-ebes-deleted.mjs` — flips ACTIVE on CLOSE |

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 happy | themed page | branded experience, color=#7C3AED, font=Poppins | accent/page/font reflect brand; no #0c0e12 | component (web+native) |
| T2 happy | read-path | experience w/ intents + stop blurbs + stop coords | vibe chips + blurbs + map render real data | service+component |
| T3 happy | adaptive >1 | 3 bookable occurrences | Reserve → picker lists 3; pick slot → cart w/ eventDateId | hook+component |
| T4 edge | adaptive ===1 | 1 bookable occurrence | Reserve → straight to cart, eventDateId auto-set | hook |
| T5 edge | adaptive 0/single | single date / no dates | Reserve → straight to cart, NO eventDateId; body byte-identical | hook+checkout snapshot |
| T6 error | RLS/network | stops fetch errors | throws; page shows error + retry; no silent [] | service |
| T7 edge | open-daily | daily/never recurring + materialized rows | date + time-in-window + party-size → cart; quantity=party-size, 1 line | component+cart |
| T8 happy | materialization | publish recurring weekly count=8 | ≥8 event_dates rows at publish; runtime adds none | DB/RPC |
| T9 edge | never rule | publish daily never | bounded rows (≤cap / window), not unbounded | DB/RPC |
| T10 happy | consumer detail | deck experience tap | ConsumerExperienceDetailScreen opens, scrolls, Reserve pinned | screen (sim) |
| T11 happy | venue experiences | "experiences here" tap | opens new screen (not EBES) | screen (sim) |
| T12 happy | chat repoint | chat trip card / event card | trip→Leg1 detail; event→Leg2 detail; no EBES | screen |
| T13 regression | EBES deleted | grep source | zero ExpandedBusinessEventSheet refs outside tests/git | gate |
| T14 edge | not-bookable | paid experience, brand charges_enabled=false | "Booking unavailable" banner; Reserve non-tappable | component |
| T15 edge | sold-out / ended | remaining 0 / all dates past | Sold out / Ended banner; CTA disabled | component |
| T16 regression | wizard preview | LEGACY mode (no palette) | byte-identical to pre-1138 | component snapshot |
| T17 a11y | picker | slot list | role=radiogroup / radio + aria-checked; ≥44pt | component |

---

## 8. Implementation order

1. **Service + types** (§4.2): widen `publicExperienceService` SELECTs + maps + `PublicExperience`/`PublicExperienceStop`. (T2, T6)
2. **Per-date remaining** (§4.3): wire the canonical remaining reader into the preview path. (T3–T5, T15)
3. **Extract adaptive-reservation unit** (§4.4) from EBES → shared home, while EBES still live. (T3–T5)
4. **`ExperiencePreview` FOUNDATION mode** (§4.0): dual-mode like `TripPreview` — parallax shell, theming, vibe chips, stop spine with per-stop `CountAwareGallery` + blurb, map block, meta City,Country. LEGACY branch preserved. (T1, T2, T16, SC-11)
5. **`/exp/` route rebuild** (mirror `/t/` route): resolve theme→palette→surface, own mute/share/dock state, feed FOUNDATION mode + Reserve bar + adaptive picker + open-daily state. (T1, T3–T7, T14, T15, T17)
6. **Consumer experience detail** (§4.7 step 2): NEW `ConsumerExperienceDetailScreen` + `useConsumerExperienceDetail` (anon-read) + Reserve bar + picker. (T10, SC-7)
7. **Repoint deck-experience + venue-experiences** off EBES (§4.7 steps 3). (T11)
8. **Repoint chat** (§4.7 step 4) — trip→Leg1, event→Leg2 (OQ-6), experience→new. (T12)
9. **[If folded] §4.6 materializer migration** (publish + live-edit RPC re-emit from LIVE prod body + optional cron). Apply via Management API. (T8, T9)
10. **Delete EBES + retarget tests** (§4.7 steps 5–7), gated on render A being off EBES (Leg 2). (T13, SC-8)
11. **Gates + new tests** (§9).

---

## 9. Regression prevention (fails-on-revert contract)

1. **`orch-1138-ebes-deleted.mjs`** strict-grep gate (`.github/scripts/strict-grep/`): FAILS if `ExpandedBusinessEventSheet` appears in non-test, non-comment source. Reverting the deletion (re-adding the file/import) FAILS the gate; restoring deletion PASSES. Protective comment: "EBES decommissioned by ORCH-1138 Leg 3; deck/venue/chat use the foundation detail screens. Re-introducing EBES regresses the experience-page redesign."
2. **`experienceThemed.orch1138.test.ts`**: asserts the FOUNDATION render path resolves a palette and emits no hardcoded `#0c0e12` page bg / `accent.warm` accent. FAILS if someone reverts `ExperiencePreview` to the unthemed renderer.
3. **`experienceNoFabricatedFields.orch1138.test.ts`** (mirror `tripNoFabricatedFields.orch1138.test.ts`): FAILS if an inclusions block, refund ladder, placeholder map, or per-slot capacity is rendered.
4. **`experienceAdaptiveReserve.orch1138.test.ts`**: asserts >1→picker, ===1→auto, 0→direct, and the byte-identical-on-null checkout body. FAILS if the adaptive signal is broken or a fabricated per-slot cap is introduced.
5. **`orch-1138-experience-reserve-verb.mjs`** (or a test): asserts the Reserve verb is "Reserve" on the experience surfaces (mirrors the spirit of `orch-1138-trip-reserve-straight-to-cart.mjs`).
6. **[If folded] `experienceRecurrenceMaterialized.orch1138.test.ts`**: publish a recurring experience → assert ≥2 `event_dates` rows at publish; revert of the materializer FAILS (back to 1 row).

Each test must FAIL on revert of its target change and PASS on restore (verified in IMPLEMENT).

---

## 10. Open questions (need Seth)

- **OQ-1 — Fold §4.6 (recurrence/open-daily materialization) into Leg 3, or sibling ORCH?** It is the only schema/edge-adjacent part; the page UI ships now for single/multi_date without it. Fold-in = honest open-daily at launch but couples a JS/web leg to a DB-function migration with the re-emit-from-live-body hazard. Sibling = page ships immediately, open-daily collapses to single until the sibling lands. Sub-question if folded: materialization bound = **52-cap (match client)** vs **rolling 90-day window + daily cron top-up** for `never`-rules?
- **OQ-2 — Reserve bar: extend `TripReserveBar`/`ConsumerTripReserveBar` with an experience mode, or create `Experience*ReserveBar` siblings?** Trip bar carries split-CTA + plan logic experiences don't need; a sibling is cleaner but duplicates the float/dock mechanics. Recommend: extend with a `splitCtas`-omitted single-CTA path (already supported) — reuse, don't duplicate.
- **OQ-3 — Per-date remaining: compute in the hook (mirror checkout sibling) or via a thin RPC?** Recommend reusing the existing canonical remaining reader the deck RPC already calls; do NOT add a new SQL count.
- **OQ-4 — Where does the extracted adaptive-reservation unit live?** `@mingla/offering-rendering` (if RN+web-safe) for true single-source, vs a consumer copy + web copy. Recommend the shared package if the picker has no app-only deps.
- **OQ-5 — Open-daily slot interval.** The model has only the `[start_at, end_at]` window (master `doorsOpen`/`endsAt`), no slot granularity. Options: (a) "any time within the window" (free time entry bounded by the window — least fabrication), (b) fixed interval (30/60 min) — but that interval is NOT in the data, so it's a product choice, not a data read. Recommend (a) until a per-slot field is authored.
- **OQ-6 — Leg-2 (event page) merge order.** The chat repoint's event branch + the deck-event EBES removal depend on Leg 2's consumer event detail existing/merged. If Leg 2 has not merged at IMPLEMENT, EBES deletion (§4.7 step 5–6) BLOCKS until render A (deck event) is off EBES. Confirm the merge sequence Leg 2 → Leg 3, or hold the EBES `DELETE` to a final cross-leg step.
- **OQ-7 — The cited EBES-deletability report is missing from disk.** Locate `INVESTIGATION_ORCH-1138_EBES_DEAD_CODE_DELETABILITY.md` (it may live in another worktree/branch), or accept the code-grounded EBES consumer map in §4.7 (deck event / deck experience / venue experiences / chat events+trips) as the authoritative consumer set. If a consumer exists that this spec's grep missed, re-investigate before IMPLEMENT.

---

## 11. Allowlist + DO-NOT-TOUCH + Downstream routing

### Allowlist (implementor may modify/create)
- `mingla-business/src/services/publicExperienceService.ts`
- `mingla-business/src/hooks/usePublicExperience.ts`
- `mingla-business/src/components/experience/ExperiencePreview.tsx`
- `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`
- NEW: `mingla-business/src/components/experience/ExperienceReserveBar.tsx` (or extend `TripReserveBar` per OQ-2), NEW occurrence/slot-picker + open-daily picker component(s)
- `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (NEW) + `app-mobile/src/hooks/useConsumerExperienceDetail.ts` (NEW) + NEW consumer reserve bar (or extend `ConsumerTripReserveBar`)
- `app-mobile/src/components/ExpandedCardModal.tsx` (repoint render B + deck-experience open path; remove EBES import after deletion)
- `app-mobile/src/components/MessageInterface.tsx` (repoint chat; remove EBES mount)
- `app-mobile/src/utils/venueExperienceMapping.ts` (repoint target only; keep the mapping)
- **DELETE:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
- The extracted shared adaptive-reservation unit (location per OQ-4) + its tests
- New tests/gates under `__tests__/` + `.github/scripts/strict-grep/`
- **[If OQ-1 = fold-in]** a NEW migration re-emitting the publish + live-edit experience RPCs (+ optional cron fn) — `supabase/migrations/` + applied via Management API

### DO-NOT-TOUCH (stop-and-amend before any edit)
- `packages/offering-rendering/*` and `packages/event-rendering/*` — REUSE only; editing `ParallaxCoverShell`'s native branch is forbidden (it ships trip+event; breaks gorhom scroll — Leg 1C learned this).
- `mingla-business/src/components/trip/TripPreview.tsx`, `TripReserveBar.tsx`, `app/t/.../[tripSlug].tsx`, `ConsumerTripDetailScreen.tsx` — the Leg-1 trip path; reference, do not modify (extend `TripReserveBar` ONLY if OQ-2 chooses extend, and additively).
- `supabase/functions/ticket-checkout-create/index.ts` — the checkout contract is final (already accepts `eventDateId`); do NOT add fields.
- `TicketCartSheet.tsx`, `useNativeCheckoutFlow` — the cart/money path; reuse, do not alter.
- The Leg-2 event path (parallel worktree) — coordinate via OQ-6, do not duplicate/clobber.
- **Any new NATIVE module in mingla-business** — forbidden (COMMS-0035). Map block reuses `buildStaticMapUrl` (no SDK).
- The shared anchor checkout — never edit.

### Downstream routing
Next = **mingla-implementor (business + consumer + backend)** to build from this SPEC + the reservation-intelligence investigation, in the worktree `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` on branch `ORCH-1138-experience-page`. **Resolve OQ-1 and OQ-6 with Seth BEFORE IMPLEMENT** (fold-in vs sibling decides whether §4.6 + SC-9 + T8/T9 are in this leg; Leg-2 merge order decides EBES deletion timing). Then = **mingla-tester** (all-surface live-fire: web themed page + sim consumer detail + EBES-gone verification + materialization if folded). Then = **mingla-orchestrator** CLOSE (flips `I-PROPOSED-1138-EXPERIENCE-THEMED` + `I-PROPOSED-1138-EBES-DELETED` ACTIVE; World Map; ledger).
