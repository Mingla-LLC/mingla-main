# INVESTIGATION — ORCH-1019 [Curated-card scheduling: false "could not verify opening hours" warning + missing per-stop addresses in calendar]

- **Mode:** INVESTIGATE (investigation only — no product code changed, no fix proposed beyond direction)
- **Date:** 2026-05-30
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1019-[curated-schedule-hours-calendar-notes]/` on branch `ORCH-1019-curated-schedule-hours-calendar-notes`
- **Affected surfaces:** Consumer iOS + Consumer Android (`app-mobile/`). NOT business / admin / buyer-web (no curated-card scheduling there).
- **Confidence:** PROVEN (live-fire sim repro of both operator symptoms + real-DB row evidence + five-layer reconciliation).
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets ORCH-1019, `mingla-forensics`, or actionable `ALL` this turn. COMMS-0012 (ORCH-0990 flower-stop) is thematically adjacent and was read for curated-card data-shape context; it is a different defect.

---

## 1. Symptom Summary (expected vs actual)

### Defect 1 — false "could not verify opening hours" when scheduling a curated card
- **Operator report:** "When I try to schedule a curated card, I get the error 'could not verify opening hours' when the opening hours literally exists on the card. It schedules anyway but the error is concerning. Investigate why this happens AND IF THERE ARE OTHER BUGS LIKE THIS."
- **Expected:** A curated multi-stop card with real per-stop hours validates each stop and reports an honest open/closed result. No spurious "couldn't verify" warning.
- **Actual (proven on sim):** Scheduling/**rescheduling a curated card from the Calendar tab** shows the amber banner "We couldn't verify this place's hours. Please double-check before scheduling.. Please verify opening hours before scheduling." then schedules anyway. The hours DO exist on the card (per-stop `weekdayDescriptions`).

### Defect 2 — addresses missing from the calendar
- **Operator report:** "The notes sent for curated cards don't give you the address of all the stops. When stored to the user's calendar, the user needs to be able to see everything needed — address etc — to make the plan a success from their calendar."
- **Expected:** From the calendar, the user can see the address of every stop.
- **Actual (proven on sim):** The in-app Mingla Calendar entry row shows **only one** location line (the first stop's address). Per-stop addresses for stops 2..N are buried behind two taps (open detail → expand each stop). The native/device-calendar notes builder DOES emit every stop address on initial schedule, but the Calendar-tab **reschedule fallback** rebuilds the device event with the single-place builder and loses the stop list.

---

## 2. Investigation Manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/components/activity/ProposeDateTimeModal.tsx` | the modal that emits the warning string; `handleCheckCompatibility` + `!isCurated` gating |
| 2 | `app-mobile/src/components/activity/ProposeDateTimeFooter.tsx` | curated vs regular footer branch (`isCurated` prop) |
| 3 | `app-mobile/src/utils/openingHoursUtils.ts` | canonical `extractWeekdayText` + `isPlaceOpenAt` (all-shape reader) |
| 4 | `app-mobile/src/types/curatedExperience.ts` | `CuratedStop.openingHours: Record<string,string>` declared type |
| 5 | `app-mobile/src/components/activity/SavedTab.tsx` | `checkSingleStopOpen` / `checkAllStopsOpen`, `handleProposeDateTime`, `proceedWithScheduling`, modal `isCurated` wiring |
| 6 | `app-mobile/src/components/activity/CalendarTab.tsx` | `entryToCard`, reschedule modal wiring (no `isCurated`), reschedule device-cal fallback, `renderCalendarEntry` row, `handleCardExpand` |
| 7 | `app-mobile/src/services/deviceCalendarService.ts` | `createEventFromCard` vs `createEventFromCuratedCard` notes builders |
| 8 | `app-mobile/src/services/calendarService.ts` | `addEntryFromSavedCard` allowlist (stores `stops` + `address`) |
| 9 | `app-mobile/src/services/savedCardsService.ts` | save/load round-trip of `card_data` (stops survive) |
| 10 | `supabase/functions/generate-curated-experiences/index.ts` | stop builder: `openingHours: card.opening_hours \|\| {}`, `address: card.address` |
| 11 | `supabase/functions/_shared/signalRankFetch.ts` | place_pool select list: passes `opening_hours` + `address` through unchanged |
| 12 | `supabase/functions/_shared/bouncer.ts`, `personHeroCards.ts` | confirm `place_pool.opening_hours` is the raw Google v1 jsonb object |
| 13 | `app-mobile/src/hooks/useIsPlaceOpen.ts` | bug-class sweep — uses canonical reader (correct) |
| 14 | `app-mobile/src/components/expandedCard/ActionButtons.tsx` | bug-class sweep — curated per-stop validation uses canonical reader (correct) |
| 15 | `app-mobile/src/components/ExpandedCardModal.tsx` | per-stop address render (tap-gated), `StopOpenBadge` (canonical reader, correct) |
| 16 | `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` | bug-class sweep — collab modal does NOT pass `isCurated` |
| 17 | `app-mobile/src/i18n/locales/en/activity.json` | exact `hoursUnknown` copy + the doubled-append copy bug |

---

## 3. The data-shape truth (root of the whole bug class)

`place_pool.opening_hours` is **jsonb holding the raw Google Places v1 object**, keyed `{ openNow, periods, weekdayDescriptions[], nextOpenTime }` — NOT a `{ monday: "9:00 AM – 10:00 PM" }` weekday record.

DB evidence (Supabase Management API, project `gqnoajqerqhnvulmnyvv`):

```
place_pool.opening_hours keys → ["nextOpenTime","openNow","periods","weekdayDescriptions"]   (object jsonb)
```

`generate-curated-experiences/index.ts:567` sets `openingHours: card.opening_hours || {}` — i.e. the curated stop's `openingHours` is that raw Google v1 object, passed through verbatim by `signalRankFetch.ts` (select list at line 321 includes `opening_hours`, returned untouched at line 374).

**Therefore `CuratedStop.openingHours: Record<string,string>` (curatedExperience.ts:18) is a TYPE LIE.** At runtime the value is `{ openNow, periods, weekdayDescriptions, nextOpenTime }`.

Persisted saved-card evidence (real rows) shows BOTH shapes exist in production data:
- **Google v1 object** `{openNow,periods,weekdayDescriptions,nextOpenTime}` — current generator output (the common case; all 4 of the live sim-user's saved curated cards).
- **lowercase weekday record** `{monday,tuesday,…}` — older rows (matches the declared TS type).

Either way, the bespoke validator below breaks (case mismatch for the record shape; no day key at all for the Google v1 shape).

---

## 4. Findings (classified, six-field evidence)

### 🔴 ROOT CAUSE F-1 — Calendar-tab reschedule discards `stops` and never passes `isCurated`, routing curated cards through the regular flow → false "couldn't verify" warning (the operator's exact symptom)

- **File + line:** `app-mobile/src/components/activity/CalendarTab.tsx:1948-1971` (`entryToCard`) and `:2142-2158` (`ProposeDateTimeModal` render — no `isCurated` prop).
- **Exact code:**
  - `entryToCard` returns an object containing `openingHours: entry.experience?.openingHours` and **no `stops` key at all**.
  - `<ProposeDateTimeModal … card={entryToCard(entryToReschedule)} … />` — `isCurated` prop is **omitted** → defaults to `false` (ProposeDateTimeModal default param, line 64).
- **What it does:** For a curated calendar entry, the reschedule modal opens with `isCurated=false` and a card whose top-level `openingHours` is `undefined` (curated cards carry hours per-stop; top-level `card_data.openingHours` is absent — DB: `top_has_oh=false`). It runs the **regular** flow: `handleCheckCompatibility` → `extractWeekdayText(undefined)` = `null` → `isPlaceOpenAt(null, date)` = `null` → ProposeDateTimeModal.tsx:282-284 sets `isPlaceOpen=true` + `availabilityAssumption = t('activity:proposeDateTimeModal.hoursUnknown')` → the amber warning banner (lines 618-633) shows, and the footer becomes an active "Schedule" → it schedules anyway.
- **What it should do:** Recognize the entry is curated (it has `stops`), pass `isCurated=true`, and forward the `stops` array so the modal/validator uses the per-stop hours that exist on the card.
- **Causal chain:** curated entry → tap "Reschedule" → `entryToCard` drops `stops`, maps top-level `openingHours=undefined` → modal `isCurated=false` (regular flow) → "Check Availability" → `isPlaceOpenAt(null)=null` → warning "We couldn't verify this place's hours…" + Schedule-anyway. **Exactly the operator symptom.**
- **Verification step (PROVEN on sim):** iPhone 17 Pro Max booted, dev-client `com.mingla.app.v2`, Metro from anchor checkout, logged-in user `c727d491-…`. Likes → Calendar → curated entry "Nasher Museum of Art at Duke University → Parizade" → Reschedule. Modal header read **"Schedule Experience"** (not "Schedule Plan"), no stops banner, footer **"Check Availability"** (regular flow). Selected "Now" → tapped "Check Availability" → banner appeared verbatim: *"We couldn't verify this place's hours. Please double-check before scheduling.. Please verify opening hours before scheduling."* with an active **"Schedule"** footer. Screenshots `/tmp/orch1019_13_reschedmodal.png`, `/tmp/orch1019_14_warning.png`. DB confirms this entry HAS `stops` with addresses and per-stop `weekdayDescriptions` (`s0_has_wd=true`), and `top_has_oh=false` — i.e. the hours literally exist on the card but the reschedule path can't see them.

### 🔴 ROOT CAUSE F-2 — `checkSingleStopOpen` uses a bespoke direct day-name key lookup on `stop.openingHours`, which silently misses the real data shape → false "All Stops Are Open!" (a DIFFERENT, more dangerous bug: false-OK)

- **File + line:** `app-mobile/src/components/activity/SavedTab.tsx:1092-1157` (`checkSingleStopOpen`), called by `checkAllStopsOpen` (1159-1183) from `handleProposeDateTime` (1235).
- **Exact code:**
  ```ts
  const dayName = arrivalTime.toLocaleDateString(getUserLocale(), { weekday: 'long' }); // "Saturday"
  const hoursString = stop.openingHours?.[dayName];
  if (!hoursString) { return { stopName: stop.placeName, isOpen: true }; } // assume open
  ```
- **What it does:** Looks up `openingHours["Saturday"]`. For the **Google v1 object** shape (keys `weekdayDescriptions`/`periods`/`openNow`/`nextOpenTime`) there is no `"Saturday"` key → `undefined` → "No hours data — assume open". For the **lowercase record** shape (`{saturday:…}`) the capitalized `"Saturday"` lookup also misses (case mismatch) → same false-OK. The "validate all stops" promise is a no-op for the current data shape. It also reads `arrivalTime.getHours()` (device-local time) and ignores venue `utc_offset_minutes`.
- **What it should do:** Use the canonical `extractWeekdayText(stop.openingHours)` + `isPlaceOpenAt(weekdayText, arrivalTime, utcOffsetMinutes)` — the same reader every other surface uses — which handles Google v1, lowercase records, string[], JSON-string, and `{lines}`.
- **Causal chain:** save a curated card (current generator → Google v1 hours) → SavedTab "Schedule Plan" → `checkAllStopsOpen` → `checkSingleStopOpen` looks up a non-existent day key → "assume open" for every stop → "All Stops Are Open!" alert even when a stop is closed at arrival.
- **Verification step (PROVEN on sim):** Likes → Saved → curated card "Historic Yates Mill County Park → Rey's Restaurant" → Schedule Plan → "Now" (Sat 3:07 PM) → Schedule Plan. Alert read **"All Stops Are Open! All 2 stops are open at Sat, May 30 at 3:07 PM."** Screenshot `/tmp/orch1019_10_alert.png`. DB proof of falseness: Rey's Restaurant Saturday hours are **"5:00 – 10:00 PM"**; arrival ~3:07 PM is BEFORE open → the stop is actually CLOSED, yet the validator said open. The canonical reader (`isPlaceOpenAt` on `weekdayDescriptions` "Saturday: 5:00 – 10:00 PM") would correctly return `false`.

### 🟠 CONTRIBUTING F-3 — `LockedCardSchedulingSheet` (collab "lock in plan") also omits `isCurated` → same regular-flow defect as F-1 for collab curated cards

- **File + line:** `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx:189-201`.
- **Exact code:** `const cardForModal = { id: savedCardId, title: cardTitle, ...cardData };` then `<ProposeDateTimeModal … card={cardForModal} onProposeDateTime={handleDatePicked} />` — **no `isCurated` prop**. Spreading `cardData` carries `stops` into the card object, but the modal only learns curated-ness from the `isCurated` PROP (default `false`), so a collab-locked curated plan runs the regular flow → same "couldn't verify" warning class as F-1.
- **What it should do:** Pass `isCurated` derived from `cardData.stops`.
- **Causal chain:** collab session locks a curated plan → LockedCardSchedulingSheet step "pick" → modal `isCurated=false` → regular availability flow on a card with no top-level hours → false warning.
- **Verification step:** Source-confirmed (collab path not exercised on sim this turn — no two-device collab session set up). Same mechanism as F-1 which IS sim-proven; classified `probable` for the collab surface specifically, `proven` for the shared mechanism.

### 🟠 CONTRIBUTING F-4 — Calendar-tab reschedule device-calendar fallback uses the single-place builder for curated cards → strips per-stop addresses from the device calendar on reschedule (Defect 2, native surface)

- **File + line:** `app-mobile/src/components/activity/CalendarTab.tsx:649-651`.
- **Exact code:** `const deviceEvent = DeviceCalendarService.createEventFromCard(cardData, date, …)` — always the regular builder, even when `cardData.stops?.length > 0` (the code at 643-646 already KNOWS it's curated, since it computes the "Mingla Plan: A → B" title for the delete step).
- **What it does:** On the delete-then-recreate reschedule branch (entries without a stored `device_calendar_event_id`), the recreated device event uses `createEventFromCard`, whose notes contain only top-level description/price/rating and `location: card.address` (first stop only). All per-stop "Stop N: name / Address: …" lines (which `createEventFromCuratedCard` would emit) are lost.
- **What it should do:** Branch on `cardData.stops?.length > 0` and call `createEventFromCuratedCard` like the initial-schedule path does (SavedTab.tsx:1416).
- **Causal chain:** schedule a curated card (device notes get all stop addresses) → reschedule it via the fallback branch → device event recreated with single-place builder → device calendar now missing per-stop addresses.
- **Verification step:** Source-confirmed. The primary reschedule branch (line 628, `device_calendar_event_id` present) only patches start/end dates and preserves the original notes, so it does NOT lose addresses; only the fallback recreate branch does. Classified `probable` (not exercised live; device-calendar permission flow not driven on sim this turn).

### 🟠 CONTRIBUTING F-5 — In-app Calendar entry row renders only ONE address line; per-stop addresses are double-tap-gated (Defect 2, in-app surface — the most likely surface the operator means)

- **File + line:** `app-mobile/src/components/activity/CalendarTab.tsx:1583-1590` (entry row) + `app-mobile/src/components/ExpandedCardModal.tsx:1243,1251-1256` (detail).
- **Exact code:** Row: `{entry.experience?.address || entry.address || t('…locationTBD')}` — a single location line. Detail: `{stop.address}` rendered only `{isExpanded && (…)}` per stop.
- **What it does:** The glanceable calendar entry shows the first/top-level address only. To see stop 2..N addresses the user must (1) tap the entry to open ExpandedCardModal, then (2) tap each stop to expand it. There is no single view that lists every stop's address.
- **What it should do (direction only):** Surface all stop addresses from the calendar without requiring per-stop expansion (e.g. always-visible address per stop in the curated detail, or a multi-line location summary on the entry).
- **Causal chain:** user schedules a multi-stop plan → opens it from the calendar → sees one address → cannot "see everything needed to make the plan a success from their calendar."
- **Verification step (PROVEN on sim):** Likes → Calendar showed entry "Nasher Museum of Art at Duke University → Parizade" with a single location line "2001 Campus Dr, Durham, NC 27705, USA" (stop 0 / the Nasher) and NO Parizade address ("2200 W Main St" per DB). Screenshot `/tmp/orch1019_12_cal.png`. DB confirms both stop addresses exist in `card_data.stops`.

### 🔵 OBSERVATION F-6 — Doubled / malformed warning copy

- **File + line:** `app-mobile/src/components/activity/ProposeDateTimeModal.tsx:628-631` appends `". Please verify opening hours before scheduling."` to a string (`hoursUnknown`, activity.json:131) that already ends with "…before scheduling." → on-screen the user sees a double period and a duplicated clause: *"…before scheduling.. Please verify opening hours before scheduling."* Cosmetic; rides along whenever F-1/F-3 fire. (Captured live in `/tmp/orch1019_14_warning.png`.)

### 🔵 OBSERVATION F-7 — `CuratedStop.openingHours` type is wrong

- `app-mobile/src/types/curatedExperience.ts:18` declares `openingHours: Record<string, string>`, but the runtime value is the Google v1 object. The lie is what lets `checkSingleStopOpen`'s `stop.openingHours?.[dayName]` type-check while silently missing at runtime. Not the cause by itself, but it masks F-2 from the compiler.

---

## 5. Bug-class sweep — every opening-hours / availability reader (operator asked "if there are other bugs like this")

| Site | File:line | Reader used | Verdict | Failure mode |
|------|-----------|-------------|---------|--------------|
| Curated all-stops validator (SavedTab schedule) | `SavedTab.tsx:1092` `checkSingleStopOpen` | **bespoke** `stop.openingHours?.[dayName]` + regex | 🔴 BROKEN | **FALSE-OK** — misses Google-v1 and case-mismatched record shapes → "assume open" → "All Stops Are Open!" on a closed stop (F-2). Also device-local time only. |
| Reschedule modal curated routing | `CalendarTab.tsx:1948,2142` | n/a — drops `stops`, no `isCurated` | 🔴 BROKEN | **FALSE WARNING** — regular flow on curated card → `isPlaceOpenAt(null)` → "couldn't verify" + schedule anyway (F-1). |
| Collab lock-in modal routing | `LockedCardSchedulingSheet.tsx:195` | n/a — no `isCurated` | 🟠 BROKEN | Same false-warning class as F-1 for collab curated plans (F-3). |
| Regular-card modal availability | `ProposeDateTimeModal.tsx:280-288` | canonical `extractWeekdayText`+`isPlaceOpenAt` | ✅ CORRECT | For genuine single-place cards. (The `null`→advisory-warning behavior is by design for regular cards; it only misfires when a curated card is wrongly routed here — F-1.) |
| ExpandedCardModal curated scheduling | `ActionButtons.tsx:485-486` | canonical `extractWeekdayText((stop).openingHours)` per stop | ✅ CORRECT | Handles all shapes; honest "Some Stops May Be Closed". This is the reference-correct curated validator. |
| ExpandedCardModal per-stop "Open Now" badge | `ExpandedCardModal.tsx:1340` `StopOpenBadge` → `useIsPlaceOpen` | canonical | ✅ CORRECT | |
| Regular-card "Open Now" badge | `ProposeDateTimeModal.tsx:98` `useIsPlaceOpen` | canonical | ✅ CORRECT | |
| `useIsPlaceOpen` hook | `useIsPlaceOpen.ts:32` | canonical `extractWeekdayText` | ✅ CORRECT | |

**Class summary:** There is ONE canonical, all-shape-tolerant reader (`extractWeekdayText` + `isPlaceOpenAt`) used correctly in 5 places. The defects are the 3 sites that bypass it: a bespoke parser (F-2, false-OK — the most dangerous, since it tells users a closed plan is open) and two modal call-sites that fail to pass `isCurated`/`stops` (F-1 sim-proven + F-3 collab). Note the two symptoms point in OPPOSITE directions — the SavedTab schedule path under-warns (false-OK), the Calendar reschedule path over-warns (false "couldn't verify"). Both stem from the same root: curated hours live per-stop in a Google-v1 object, and only the canonical reader handles that.

---

## 6. Five-Layer Cross-Check

| Layer | Finding |
|-------|---------|
| **Docs** | Curated banner copy promises "Opening hours will be validated for all stops" (ProposeDateTimeModal.tsx:485-487). Reality: the SavedTab validator is a no-op for the live data shape (F-2). Contradiction → bug. |
| **Schema** | `place_pool.opening_hours` is jsonb = raw Google v1 object `{openNow,periods,weekdayDescriptions,nextOpenTime}`; `address` text is populated. (Mgmt API confirmed.) `CuratedStop.openingHours: Record<string,string>` TS type disagrees with the actual jsonb shape (F-7). |
| **Code** | `checkSingleStopOpen` does a direct day-name key lookup (F-2); `entryToCard` + reschedule modal omit `stops`/`isCurated` (F-1); reschedule device-cal fallback uses single-place builder (F-4); calendar row renders one address (F-5). The canonical reader is correct (no bug). |
| **Runtime** | Sim repro: SavedTab "Schedule Plan" → "All Stops Are Open!" at 3:07 PM for a plan whose dinner stop opens 5:00 PM (false-OK). Calendar "Reschedule" → "We couldn't verify this place's hours…" + Schedule-anyway (false warning). Both captured as screenshots. |
| **Data** | Live user `c727d491-…`: 4 saved curated cards (all Google-v1 hours shape, all stops have addresses), 3 curated calendar entries (each has `stops` with addresses + per-stop `weekdayDescriptions`, `top_has_oh=false`). Rey's Restaurant Sat hours = "5:00 – 10:00 PM" proves the false-OK. |

All five layers reconcile to the same root: **curated hours are per-stop in a Google-v1 object; the canonical reader handles it, three call-sites don't.**

---

## 7. Outcome & Journey Step-Back

- **User goal:** "I found a curated plan I like — put it on my calendar at a time when everything's actually open, and let me see everything I need (addresses of every stop) to pull the plan off."
- **Journey:** discover/save curated card → Likes (Saved) → Schedule Plan → pick date/time → trust the "validated for all stops" check → entry lands on Mingla calendar + device calendar → later open it from the calendar to navigate → (maybe) reschedule.
- **Divergence points:**
  1. Schedule from Saved: validator falsely says "All Stops Are Open!" even for a closed stop (F-2) — user arrives to a closed venue. *(under-warn)*
  2. Reschedule from Calendar: false "couldn't verify hours" warning that schedules anyway (F-1) — alarming and unhelpful. *(over-warn)*
  3. From the calendar, the user sees only the first stop's address (F-5); to get stop 2..N they must dig two levels deep.
  4. Reschedule recreate-branch strips per-stop addresses from the device calendar (F-4).
- **Does fixing the reported node deliver the outcome?** Fixing only the reported "couldn't verify" warning (F-1) removes the scare but leaves the more dangerous false-OK (F-2) and the address-visibility gap (F-5/F-4). The outcome is only delivered if the fix routes ALL curated scheduling/rescheduling through the canonical per-stop reader AND surfaces every stop address from the calendar. Recommend the fix scope cover F-1+F-2+F-4+F-5 (and F-3/F-6/F-7 as cheap riders).

---

## 8. Blast Radius

- **Surfaces:** Consumer iOS + Android (shared `app-mobile` code → automatic parity; both inherit all findings). Not business/admin/buyer-web.
- **Flows:** solo (SavedTab schedule = F-2; CalendarTab reschedule = F-1/F-4/F-5) AND collab (LockedCardSchedulingSheet = F-3). Both single-stop and multi-stop curated cards.
- **Data shapes affected:** all curated cards from the current generator (Google v1 hours) — the majority; plus older lowercase-record rows.
- **Severity ranking:** F-2 (false-OK, sends users to closed venues — highest user harm) > F-1 (false warning, operator-reported, alarming) > F-5 (address visibility, operator-reported) > F-4 (reschedule address loss) > F-3 (collab parity) > F-6/F-7 (copy/type hygiene).
- **Invariants touched:** Constitution #9 (no fabricated data — "All Stops Are Open!" is fabricated availability); Constitution #12 (validate at the right time — F-2 uses device-local clock, ignores venue offset). Recommend a regression invariant: "all curated availability checks go through `extractWeekdayText`+`isPlaceOpenAt`; no bespoke day-key lookup on `openingHours`."

---

## 9. Which calendar surface(s) are missing addresses? (explicit answer)

- **In-app Mingla Calendar entry (row view): MISSING** all-but-first stop address — only one `location` line is rendered (F-5). This is the primary surface the operator's phrasing ("see everything needed … from their calendar") points to. Per-stop addresses exist in `card_data.stops` and are reachable only via open-detail → expand-each-stop (ExpandedCardModal, tap-gated).
- **Device/native calendar notes — initial schedule: PRESENT.** `createEventFromCuratedCard` emits "Stop N: name / Address: …" for every stop (deviceCalendarService.ts:230), and stops carry real addresses. Correct on first schedule.
- **Device/native calendar notes — after reschedule via the recreate fallback: MISSING** per-stop addresses (F-4) because the fallback uses `createEventFromCard` (single-place builder). The direct-by-ID reschedule branch only patches dates and preserves the original notes (no loss).

So: **both surfaces can be affected** — the in-app calendar always (F-5), the device calendar only on the reschedule recreate path (F-4).

---

## 10. Fix Strategy (direction only — NOT a spec, NOT code)

1. Route every curated availability check through the canonical `extractWeekdayText(stop.openingHours)` + `isPlaceOpenAt(weekdayText, arrival, utcOffsetMinutes)` (delete the bespoke `checkSingleStopOpen` parser) — fixes F-2 and aligns with the already-correct `ActionButtons` reference.
2. Make `entryToCard` carry `stops` (+ curated fields) and pass `isCurated` to the reschedule `ProposeDateTimeModal`; likewise pass `isCurated` from `LockedCardSchedulingSheet` — fixes F-1 + F-3.
3. Branch the reschedule device-calendar fallback on `stops?.length > 0` → `createEventFromCuratedCard` — fixes F-4.
4. Surface all stop addresses from the in-app calendar (always-visible per-stop address in curated detail, or a multi-line location summary) — fixes F-5. (UX-shaped → consider a `mingla-designer` pass.)
5. Cheap riders: correct `CuratedStop.openingHours` type to the actual shape (F-7); fix the doubled warning copy (F-6).

---

## 11. Sim-repro evidence index

| Screenshot | Proves |
|------------|--------|
| `/tmp/orch1019_06_modal.png` | SavedTab curated modal correctly shows `isCurated=true` ("Schedule Plan" + stops banner) |
| `/tmp/orch1019_10_alert.png` | F-2 false-OK: "All Stops Are Open!" at 3:07 PM for a plan with a 5 PM-open dinner stop |
| `/tmp/orch1019_13_reschedmodal.png` | F-1: reschedule modal shows REGULAR flow on a curated card ("Schedule Experience" + "Check Availability") |
| `/tmp/orch1019_14_warning.png` | F-1: exact operator symptom — "We couldn't verify this place's hours…" + Schedule-anyway; also F-6 doubled copy |
| `/tmp/orch1019_12_cal.png` | F-5: in-app calendar entry shows only the first stop's address |

(Screenshots are under `/tmp/` from the live sim session; reproduction recipe is in §4 verification steps.)

---

## 12. Discoveries for Orchestrator

- **F-2 (false-OK) is more severe than the operator-reported F-1.** It silently tells users a closed plan is open and sends them to a shut venue. Recommend prioritizing it in the fix.
- **The opposite-direction symptoms (under-warn in SavedTab, over-warn in CalendarTab) share one root** — the per-stop Google-v1 hours shape vs three non-canonical call-sites. A single "always use the canonical reader + always pass `isCurated`/`stops`" change resolves the class.
- **`CuratedStop.openingHours` type lie (F-7)** masks F-2 from TypeScript; worth a `[TRANSITIONAL]`-free type correction in the same PR.
- No new external-API contract touched; COMMS-0003 N/A.
