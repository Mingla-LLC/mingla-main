# INVESTIGATION — ORCH-1113 [curated-experience-empty-deck-regression]

- **Mode:** INVESTIGATE (read-only; no fix proposed, no product code edited)
- **Date:** 2026-06-11 (v4 — re-investigated against Seth's LOCATION-specific facts: Raleigh works at 6:23 AM / Brussels fails same moment; "time-based" framing of v2/v3 challenged as DISPROVEN)
- **Investigator:** mingla-forensics
- **Project ref:** gqnoajqerqhnvulmnyvv (queried READ-ONLY via Supabase MCP execute_sql + get_logs)
- **Confidence:** **PROVEN** (source + live-DB backed, incl. Seth's REAL preferences row + per-city open-at-stored-hour counts + the exact singles-vs-curated clock divergence; backend/SQL/data root cause, exempt from the sim-reproducer directive per Prime Directive 7).

---

## ★★★★ ROOT CAUSE v4 — LOCATION-specific; pure-time-of-day DISPROVEN, stored-vs-live CLOCK divergence is the real driver ★★★★

> **THIS SECTION IS AUTHORITATIVE AND SUPERSEDES v3, v2, AND ALL PRIOR SECTIONS.** It does NOT
> contradict the v3 mechanism (the ORCH-1061 open-hours filter IS the stage that empties the deck) —
> it CORRECTS what v2/v3 got wrong about WHY Raleigh passes and Brussels fails, and reconciles ALL
> FIVE of Seth's operator facts, including the one v2/v3 could not: **Raleigh works at 6:23 AM
> (pre-dawn) showing both "Today" and "This Weekend."**
>
> **What every prior "time-of-day / timezone / live-clock" theory got WRONG (DISPROVEN):**
> The v2 "Brussels-evening vs Raleigh-afternoon at one wall-clock `now()`" framing and any theory
> that the curated filter reads the DEVICE clock are **DISPROVEN by fact #2**: at 6:23 AM Raleigh
> (when, on a live-`now()` theory, Raleigh venues would also be closed and curated would ALSO empty),
> curated STILL WORKS in Raleigh. A live-clock explanation cannot survive that fact. The curated
> filter does **not** read `now()` when a stored `datetime_pref` exists — it reads the STALE STORED
> `datetime_pref`. That single stale timestamp maps to **afternoon in Raleigh** and **late-night in
> Brussels** via each venue's own `utc_offset_minutes`, so Raleigh passes at ANY device wall-clock
> moment and Brussels fails at the SAME moment. The defect is therefore LOCATION-specific and
> INDEPENDENT of when Seth tests — exactly as fact #2 requires.

### The one-sentence proven root cause (v4)

`generate-curated-experiences/index.ts:1737-1738` runs `filterCuratedByStopHours(cards, curatedUtcNow)`
where `curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date()` — i.e. it evaluates every
curated stop's open/closed state against the **stale STORED `datetime_pref`** (Seth's live row =
`2026-04-15 21:20:44 UTC`), converted to **each venue's local time** via `card.utcOffsetMinutes`
(`_shared/curatedStopHours.ts:225-228`); that one stored instant is **17:20 (afternoon, OPEN) in
Raleigh** but **23:20 (late-night, CLOSED) in Brussels**, so every Romantic/First-Date/Group-Fun combo's
non-optional stop is dropped as closed in Brussels (and again pushed past midnight by the multi-stop
arrival cascade) while Raleigh's pass, emptying the Brussels curated deck and mislabeling it
`pool_empty` at `index.ts:1741-1742` → "No spots match right now" (`SwipeableCards.tsx:2367`).

### Empty reason fired

**`pool_empty`** — and it is UNTRUTHFUL. The per-category candidate pools are healthy (proven E-2),
so `generateCardsForType` BUILDS cards and returns NO summary; the cards are then all dropped by the
post-build `filterCuratedByStopHours`, and `index.ts:1741-1742` hardcodes
`summary = { emptyReason:'pool_empty', … }`. Edge logs (this session) confirm the function returns HTTP
**200** (versions 345) — NOT `pipeline_error`, NOT `no_viable_anchor`.

### The PROVEN curated-vs-single divergence (hypothesis E — DECISIVE, this is the root cause)

| | SINGLE cards (`discover-cards`) | CURATED multi-stop (`generate-curated-experiences`) |
|---|---|---|
| Date entry point | `filterByDateTime(places, datetimePref, **dateOption**, selectedDates)` (discover-cards:2395) | `filterCuratedByStopHours(cards, curatedUtcNow)` (index.ts:1738) — **`dateOption` NEVER read** (git: 0 commits ever touch `dateOption` in this fn) |
| **Clock used for `date_option='today'`** | **`const utcNow = new Date()` — the LIVE device clock** (discover-cards:654), then `isOpenFromHourOnwards(place, day, currentHour)` (=open at ANY hour from now→midnight) | **`datetimePref ? new Date(datetimePref) : new Date()` — PREFERS the STALE STORED `datetime_pref`** (index.ts:1737), evaluated at the literal stored instant per stop |
| Brussels @ Seth's 6:23 AM test | live `now()` → Brussels ≈ **12:23 PM (noon, OPEN)** → singles RENDER | stale `datetime_pref` → Brussels **23:20 PM (CLOSED)** → curated EMPTIES |
| Raleigh (either path) | live `now()` 6:23 AM → "open from 6:23→midnight today" catches daytime venues → RENDER | stale `datetime_pref` → Raleigh **17:20 (afternoon, OPEN)** → curated RENDERS |
| cardType no-op | `filterCuratedByStopHours` is ALSO called on singles (discover-cards:2397) but no-ops on `cardType!=='curated'` (curatedStopHours.ts:222) | applies fully (multi-stop arrival cascade) |

**This is the entire singles-work / curated-empty / Raleigh-vs-Brussels split:** the two pipelines use
TWO DIFFERENT CLOCKS. Singles' `today` mode uses the LIVE device clock (Brussels noon = open). Curated
prefers the STALE STORED `datetime_pref` (Brussels 23:20 = closed). Raleigh passes both because the stale
`datetime_pref` lands at 17:20 (afternoon) AND the live clock's "open-from-now-today" catches daytime
hours. Brussels passes only singles because only singles use the live (noon) clock.

### Hypotheses A–E — PROVEN/DISPROVEN with live evidence

- **(A) Region/city gating — DISPROVEN (SQL-level).** The deployed RPC `fetch_local_signal_ranked`
  (latest = `20260801000001_orch_0990_…`, lines 55-59) filters ONLY `pp.is_active AND pp.is_servable` +
  `place_scores.score >= min` + a lat/lng bbox. **No `city_id`, no `city`, no `country`, no allowlist,
  no region/config table.** `signalRankFetch.ts:275-295` builds a pure bbox. Brussels is not gated as a
  non-launch city anywhere in the curated path. **RULED OUT.**
- **(B) Intent-signal coverage — DISPROVEN (live counts).** At Seth's REAL radius (driving/30 min →
  `(30/60)·60·1.3·1.0 = 39 km`, clamped [0.5,50] = 39 km bbox), Brussels scored+photo-gated candidates
  per required signal: **fine_dining 23, creative_arts 36, theatre 28, brunch 3, casual_food 88,
  movies 10, play 5, nature 39, flowers 1836.** Every Seth intent BUILDS: Romantic (creative_arts 36 +
  fine_dining 23 ✓), First-Date (flowers + brunch 3/theatre 28 + creative_arts 36/fine_dining 23 ✓),
  Take-a-Stroll (nature 39 + casual_food 88 ✓). Same signal keys as Raleigh, well above threshold.
  **RULED OUT.**
- **(C) Anchor/combo assembly (`no_viable_anchor`) — DISPROVEN.** The empty reason is `pool_empty`, not
  `no_viable_anchor` (that path is reverse-anchor-only / picnic-dates). With ample per-signal candidates
  (B), `generateCardsForType` builds cards before the hours filter. No US-centric `primary_type` mismatch:
  Brussels rows carry standard Google primary types and score on the same signal keys. **RULED OUT** as
  the emptying stage; the multi-stop arrival cascade is a COMPOUNDING factor within (E), not a separate
  cause.
- **(D) Which empty reason fires — PROVEN `pool_empty` (untruthful).** Edge logs: 200 on every recent
  `generate-curated-experiences` call (no `pipeline_error`). The 200 carries `summary.pool_empty` from
  the `index.ts:1741-1742` hardcode AFTER cards were built and hours-dropped.
- **(E) Single vs curated divergence — PROVEN (the root cause).** Named at file:line in the table above:
  `discover-cards:654` (`new Date()`, live clock, `today` mode) vs `index.ts:1737`
  (`datetimePref ? new Date(datetimePref) : new Date()`, stale stored clock). This divergence + the
  per-venue `utc_offset_minutes` conversion (curatedStopHours.ts:225) IS why Brussels empties and Raleigh
  doesn't at the same device moment.

### Decisive evidence (live DB + Seth's real row — all READ-ONLY this session)

**E-1. Seth's ACTUAL preferences row** (top of `SELECT … FROM preferences ORDER BY updated_at DESC`,
updated **2026-06-11 10:24 UTC = 06:24 EDT Raleigh** — matches the "6:23 AM" test moment):
`profile_id=c727d491-…, mode='custom', custom_lat=50.8551, custom_lng=4.35121,
custom_location='Brussels-Capital, Belgium', discover_city_name='Brussels',
discover_city_country_code='BE', use_gps_location=false, date_option='today',
datetime_pref='2026-04-15 21:20:44.492+00', travel_mode='driving',
travel_constraint_value=30, selected_dates=NULL, display_intents=[romantic,first-date,take-a-stroll]`.
→ Location is **Brussels**, date mode is **today**, but `datetime_pref` is a **stale April-15 evening
timestamp**. This is the input that empties curated. (The persisted row captures only the LAST state =
Brussels; the Raleigh test he ran moments earlier used the live clock / a Raleigh location that passed.)

**E-2. Candidate pools HEALTHY in Brussels at the REAL 39 km driving bbox** (data-gap + signal-coverage
DISPROVEN). Per required signal, scored (≥120; movies≥80; flowers≥0) + photo-gated:
Brussels `fine_dining=23, creative_arts=36, theatre=28, brunch=3, casual_food=88, movies=10, play=5,
nature=39, flowers=1836`; Raleigh `fine_dining=116, creative_arts=145, theatre=35, brunch=337,
casual_food=1259, movies=23, play=260, nature=388, flowers=1319`. Both cities build every intent.

**E-3. THE DROP — open-at-the-STALE-STORED-hour, per city, per signal** (scored / OPEN), evaluating each
candidate's `opening_hours.periods` at the stored `datetime_pref` converted to venue-local time
(`2026-04-15 21:20 UTC`, Wednesday/day=3):

| signal | Brussels @ 23:20 local (scored / OPEN) | Raleigh @ 17:20 local (scored / OPEN) |
|--------|---------------------------------------|---------------------------------------|
| creative_arts | 36 / **3** | 145 / 78 |
| theatre | 28 / **3** | 35 / 19 |
| fine_dining | 23 / **1** | 116 / 110 |
| brunch | 3 / **0** | 337 / 262 |
| casual_food | 88 / **6** | 1259 / 1088 |
| movies | 10 / **1** | 23 / 19 |
| play | 5 / **1** | 260 / 238 |
| nature | 39 / 39 (ALWAYS_OPEN rescue) | 388 / 375 |

At 23:20 Brussels, the food + culture categories every vibe needs are essentially closed (1-6 open) and
the multi-stop arrival cascade pushes later stops past midnight (e.g. Romantic creative_arts at 23:20 →
fine_dining arrival ≈ 01:00) — so every Romantic/First-Date/Group-Fun combo's non-optional stop fails
`isStopOpenAtHour` → `filterCuratedByStopHours` drops all cards → `pool_empty`. At 17:20 Raleigh every
category has dozens-to-hundreds open → vibes build → deck populates. The ONLY variable that flips the
outcome is the venue-local hour the **stored** `datetime_pref` maps to — afternoon in Raleigh, late-night
in Brussels — NOT the device wall-clock.

**E-4. utc_offset coverage** (so the conversion is real, not a NULL-fallback artifact): all 1858 servable
Brussels rows in-bbox carry `utc_offset_minutes = 120` (0 NULL). The filter converts correctly to
23:20 Brussels local; this is not a missing-offset bug.

**E-5. Singles use the LIVE clock for `today`** (the asymmetry's source): `discover-cards:654`
`const utcNow = new Date();` then line 666 `isOpenFromHourOnwards(place, targetDay, currentHour)`. At
6:23 AM Raleigh = 12:23 Brussels noon, singles scan "open from noon→midnight" and find open Brussels
venues → singles render. Curated never uses this branch (no `dateOption` read; prefers `datetime_pref`).

**E-6. Runtime status.** `generate-curated-experiences` returns **200** on every recent invocation
(get_logs, versions 345, 0.1–10 s) — the empty is a 200 + `summary.pool_empty`, the `index.ts:1742`
hardcode, NOT `pipeline_error`.

**E-7. Git provenance.** `git log -S filterCuratedByStopHours` and `-S curatedUtcNow` on
`generate-curated-experiences/index.ts` → a SINGLE commit `cd1437816` "Close ORCH-1061 … solo open-hours
gate (#329)" 2026-06-02. `git log -S dateOption` on the same file → **ZERO commits** (the curated fn has
NEVER read `date_option`). So the solo curated open-hours hard-drop was **REGRESSED by ORCH-1061**; the
stored-vs-live clock asymmetry + the never-honored `date_option` are **pre-existing** but were inert on
the solo path until ORCH-1061 added the filter.

### Reconciliation against ALL FIVE operator facts (v4)

| Fact | Reconciliation |
|------|----------------|
| #1 Seth in Raleigh, 6:23 AM Thu Jun 11 | Device wall-clock is 6:23 AM, but the curated filter ignores it — it reads the stored `datetime_pref` (April-15 21:20 UTC). Raleigh-local that is 17:20 (afternoon). |
| #2 Raleigh shows curated for BOTH Today AND This Weekend at 6:23 AM | Curated evaluates Raleigh venues at the STORED 17:20 (afternoon, open), not at 6:23 AM. A live-clock theory would empty Raleigh at 6:23 AM and is therefore DISPROVEN; the stale-stored-clock explanation passes Raleigh at any device moment. (Note: `date_option` is never read by curated, so "Today vs This Weekend" doesn't change the curated computation — both render because the stored 17:20 Raleigh hour is open.) |
| #3 Switch to Brussels custom location, same session → "No spots match right now" for curated | The SAME stored `datetime_pref` (April-15 21:20 UTC) converts to 23:20 Brussels local via `utc_offset_minutes=120`; food + culture categories are closed → `filterCuratedByStopHours` drops every combo → `pool_empty` → `swipeable.no_matches_title`. |
| #4 SINGLE cards DO render for Brussels; only CURATED does not | Singles' `today` branch uses the LIVE clock (`new Date()`, Brussels noon = open) and `filterCuratedByStopHours` no-ops on non-curated cards. Curated prefers the stale stored clock (Brussels 23:20 = closed). Different clocks → different outcomes. |
| #5 6:23 AM Raleigh = ~12:23 PM Brussels (noon, open) — Brussels NOT closed for the night | TRUE for the LIVE clock (why singles work). But curated does not use the live clock; it uses the stored 23:20, which IS night in Brussels. The "noon" reality only reaches singles. |

### Five-layer reconciliation (v4)

| Layer | Finding |
|-------|---------|
| **Docs** | `preferences.date_option` is a first-class user choice ("Now/Today/This Weekend/Pick a Date"); the curated fn never reads it. `curatedStopHours.ts:8-23` documents the solo path had NO hours filter pre-ORCH-1061. `CuratedEmptyReason` defines `pool_empty`="no anchor candidates" — drifted (now also fires for hours-emptied decks). |
| **Schema** | `fetch_local_signal_ranked` (ORCH-0990 latest, lines 55-59) gates `is_active`+`is_servable`+score+bbox; **NO city/country/region gate**. Brussels rows satisfy it identically to Raleigh. The divergence is downstream date/clock handling in the edge fns, not the RPC. |
| **Code** | `index.ts:1737` curated clock = `datetimePref ?? now()` (prefers stale stored). `discover-cards:654` singles `today` clock = `new Date()` (live). `filterCuratedByStopHours` (curatedStopHours.ts:220-245) converts via `utcOffsetMinutes` and drops on any closed non-optional stop. `discover-cards:2397` calls the same filter on singles but it no-ops on `cardType!=='curated'` (curatedStopHours.ts:222). |
| **Runtime** | `generate-curated-experiences` returns 200; empty = `summary.pool_empty` (not pipeline_error). Confirmed via get_logs (versions 345). |
| **Data** | Seth's real row: Brussels custom location + `date_option='today'` + stale `datetime_pref=2026-04-15 21:20 UTC`. Brussels pool healthy per signal (E-2); at the stored 23:20 hour every food/culture signal is 0-6 open (E-3); all Brussels rows carry utc_offset=120 (E-4). Raleigh at the stored 17:20 hour has dozens-to-hundreds open per signal (E-3). |

**The gap that IS the bug:** the curated multi-stop pipeline evaluates open-hours against the
**stale stored `datetime_pref`** (never the live clock, never `date_option`), converted to each venue's
local time. That one stored instant is afternoon in Raleigh and late-night in Brussels, so Brussels
empties and Raleigh doesn't at the SAME device moment — a LOCATION-specific defect, time-of-day-INDEPENDENT
of the device clock. Singles are immune because their `today` mode uses the LIVE clock (Brussels noon =
open) and the curated hours filter no-ops on non-curated cards.

### Answers to the dispatch questions (v4)

1. **Exact location-specific stage + file:line that empties Brussels curated:** the post-build open-hours
   filter `generate-curated-experiences/index.ts:1738` (`cards = filterCuratedByStopHours(cards,
   curatedUtcNow)`), driven by `index.ts:1737` (`curatedUtcNow = datetimePref ? new Date(datetimePref) :
   new Date()` — prefers the STALE STORED `datetime_pref`), with the per-venue local-time conversion +
   drop at `_shared/curatedStopHours.ts:225-228, 220-245` (+ `isStopOpenAtHour` :172-209). It is
   location-specific because `utcOffsetMinutes` (curatedStopHours.ts:225) maps the one stored instant to
   23:20 Brussels (closed) but 17:20 Raleigh (open). Surfaced as `swipeable.no_matches_title`
   (`SwipeableCards.tsx:2367`).
2. **Which empty reason fires:** `pool_empty`, hardcoded at `index.ts:1741-1742` AFTER cards were built
   then hours-dropped — untruthful (the pool was not empty).
3. **The precise curated-vs-single divergence:** singles' `today` mode uses the LIVE device clock
   (`discover-cards:654` `new Date()` + `isOpenFromHourOnwards`), so Brussels at noon is open; curated
   prefers the STALE STORED `datetime_pref` (`index.ts:1737`), so Brussels at the stored 23:20 is closed.
   Curated also never reads `date_option` (git: 0 commits), and `filterCuratedByStopHours` no-ops on
   non-curated cards (curatedStopHours.ts:222). Different clocks → different outcomes.
4. **Whether it's region-gating / signal-coverage / anchor-combo:** NONE of those — region-gating
   DISPROVEN (no city/country gate in the RPC), signal-coverage DISPROVEN (Brussels has ample per-signal
   candidates), anchor-combo DISPROVEN as the emptying stage (`pool_empty`, not `no_viable_anchor`). It
   is the **stored-vs-live clock divergence in the open-hours filter** (E), compounded by the multi-stop
   arrival cascade pushing later stops past midnight.
5. **Regressed-by or pre-existing:** the solo-path open-hours hard-drop was **REGRESSED by ORCH-1061**
   (#329, `cd1437816`, 2026-06-02). The stored-vs-live clock asymmetry + the never-honored `date_option`
   are **pre-existing** but inert on the solo path until ORCH-1061 added the filter.
6. **Confidence:** **PROVEN** — source-traced end-to-end + Seth's real preferences row + per-city
   open-at-stored-hour counts + utc_offset coverage + the singles live-clock branch + 200 edge logs + git
   provenance. (Device confirmation would only require resetting `datetime_pref` to a current daytime
   value or clearing it — a tester step, not needed to establish cause.)
7. **Narrowest fix direction (NOT a spec):** stop the curated path from trusting a STALE stored
   `datetime_pref` and from ignoring `date_option`. Smallest correct moves, all inside
   `generate-curated-experiences` + `curatedStopHours` (no SQL change): (a) for `date_option='today'`,
   evaluate stops against the LIVE clock (`new Date()`) the way singles' `today` mode does — NOT a stored
   timestamp that may be weeks old; (b) make the curated path honor `date_option` like
   `filterByDateTime` (for `this_weekend`/`pick_dates`, "open at any hour on the target day"); (c)
   secondarily, emit a distinct empty reason (e.g. `all_closed_at_time`) instead of the hardcoded
   `pool_empty` at `index.ts:1741-1742` so the verdict and copy are honest. A stale-`datetime_pref`
   hygiene fix (recompute/clear when `date_option` changes, client-side) is complementary. Do NOT delete
   the hours filter wholesale (re-opens serving closed venues — the harm ORCH-1061 closed).

---

## ⚠️ SUPERSEDED BY v4 — FINAL ROOT CAUSE v3 (singles-work / curated-empty / weekend-plan)

> **SUPERSEDED BY ROOT CAUSE v4 above.** v3's mechanism (the ORCH-1061 open-hours filter is the
> emptying stage, and singles use a different date path) is CORRECT and carried forward. v3's two
> errors that v4 corrects: (1) Seth's live `date_option` is now `'today'`, not `'this_weekend'`, so
> v3's "weekend silently discarded" framing is moot for the actual repro; (2) v4 makes the
> Raleigh-vs-Brussels asymmetry explicit and proven (stored `datetime_pref` → 17:20 Raleigh open /
> 23:20 Brussels closed via per-venue offset) and reconciles fact #2 (Raleigh works at 6:23 AM)
> which v3 did not address directly. Retained below as saga context.

> **[v3 original banner]** THIS SECTION IS AUTHORITATIVE AND SUPERSEDES ALL PRIOR CONCLUSIONS BELOW, including the
> v2 "FINAL ROOT CAUSE — custom-location (Brussels) repro" section and its timezone framing.
> The **timezone / "Brussels evening vs Raleigh afternoon" theory is DISPROVEN** by Seth's three
> fresh facts: (1) he is in Raleigh and tested in the MORNING and it still breaks; (2) his curated
> selection is for THIS WEEKEND, so the current time-of-day is irrelevant to what he asked for;
> (3) for the SAME custom Brussels location he DOES see SINGLE cards but NOT CURATED cards. The
> defect is isolated to the curated multi-stop pipeline, and the v2 timezone explanation is wrong
> about WHY. The real driver is a **stale stored `datetime_pref` + the curated filter ignoring the
> user's `date_option`** — not the live device clock and not the city offset.

### The one-sentence proven root cause

`generate-curated-experiences/index.ts:1737-1738` builds `curatedUtcNow = new Date(datetimePref)` and runs
`filterCuratedByStopHours(cards, curatedUtcNow)` using ONLY the stored `datetime_pref` timestamp — it
**never reads `date_option`** — so when the user has `date_option='this_weekend'` but a STALE
`datetime_pref` of `2026-04-15 21:20 UTC` (Brussels ~23:20, late evening), every Romantic/First-Date/
Group-Fun combo's non-optional stop (creative_arts / brunch / play / fine_dining) is judged CLOSED at
23:20 and dropped, emptying the deck and mislabeling it `pool_empty` at `index.ts:1742`; SINGLE cards
survive the identical request because `discover-cards`' `filterByDateTime` (index.ts:670-678) BRANCHES on
`date_option` and, for `this_weekend`, tests "open at ANY hour on Sat/Sun" (`isOpenAnyTimeOnDay`) instead
of the stale evening hour, AND `filterCuratedByStopHours` itself only filters `cardType==='curated'`
(`curatedStopHours.ts:222`) so single/experience cards bypass it entirely.

### Which CuratedEmptyReason fires

**`pool_empty`** — and it is UNTRUTHFUL. The per-category candidate pools are healthy (proven below), so
`generateCardsForType` BUILDS cards and returns NO summary; the cards are then all dropped by the
post-build hours filter, and `index.ts:1741-1742` hardcodes `summary = { emptyReason:'pool_empty', … }`.
Edge logs confirm the function returns HTTP **200** (no `pipeline_error`). It is NOT `no_viable_anchor`
(that path is reverse-anchor-only, i.e. picnic-dates; the dispatch vibes are standard-branch).

### Why singles succeed where curated fails — the exact asymmetry (DECISIVE)

| | SINGLE cards (`discover-cards`) | CURATED multi-stop (`generate-curated-experiences`) |
|---|---|---|
| Candidate RPC | `query_servable_places_by_signal` (photo gate IN SQL) | `fetch_local_signal_ranked` (photo gate client-side) — both return ample Brussels rows |
| Date handling | `filterByDateTime(places, datetimePref, **dateOption**, selectedDates)` — **branches on `date_option`** | `filterCuratedByStopHours(cards, new Date(datetimePref))` — **`date_option` NEVER read** |
| `this_weekend` behavior | `isOpenAnyTimeOnDay(Sat) OR isOpenAnyTimeOnDay(Sun)` — open at ANY hour on the weekend (index.ts:673-678) | evaluates each stop at the literal stale `datetime_pref` hour (23:20) → closed |
| Hours filter scope | `filterCuratedByStopHours` is ALSO called on singles (discover-cards:2397) but **no-ops on non-curated cards** (`curatedStopHours.ts:222`: `cardType!=='curated' → return true`) | applies fully (multi-stop, accumulated arrival times) |

So the SAME stale `datetime_pref` reaches both pipelines, but singles never let it gate them (date-mode
branch + cardType no-op), while curated trusts it as the literal plan time. That is the entire
singles-work / curated-empty split.

### Reconciliation with Seth's "morning Raleigh still breaks"

The bug is NOT a function of when Seth tests. `filterCuratedByStopHours` uses `datetimePref` (the stored
value), not the device clock — `new Date()` is only the fallback when `datetimePref` is absent, and Seth's
row HAS a `datetime_pref`. His stored value is a fixed `2026-04-15 21:20 UTC` evening timestamp, so the
curated deck empties at ANY wall-clock moment he tests, morning or afternoon, in Raleigh or anywhere. The
weekend he selected (`date_option='this_weekend'`) is silently discarded by the curated path. This is why
the v2 timezone theory looked plausible (an evening hour WAS in play) but was wrong about the mechanism:
the evening hour comes from the **stale stored timestamp**, not from the Brussels↔Raleigh offset applied
to `now()`.

### Decisive evidence (live DB + Seth's real row — all READ-ONLY this session)

**E-1. Seth's ACTUAL preferences row** (`SELECT … FROM preferences WHERE custom_lat≈50.85…`, updated
2026-06-11 10:10 UTC):
`custom_lat=50.8551, custom_lng=4.35121 (Brussels), custom_location='Brussels-Capital, Belgium',
discover_city_name='Brussels', use_gps_location=false, date_option='this_weekend',
datetime_pref='2026-04-15 21:20:44+00', travel_mode='driving', travel_constraint_value=30,
selected_dates=NULL`. → He picked **This Weekend** but `datetime_pref` is a **stale April-15 evening**
timestamp. This is the input that empties curated.

**E-2. Candidate pools are HEALTHY (data-gap + photo-gate DISPROVEN).** The deployed curated RPC
`fetch_local_signal_ranked` at the real 2.925 km Brussels bbox returns per required signal:
`fine_dining=9, creative_arts=24, theatre=19, brunch=3, casual_food=31, play=2, flowers=5`. A parallel
count of scored+photo-gated rows in the same bbox: every signal's "scored" count equals its
"photo-gated" count (e.g. fine_dining 9/9, creative_arts 24/24, brunch 3/3, play 2/2) — the photo gate
drops NOTHING in Brussels. So `generateCardsForType` CAN build a card for every dispatch vibe (Romantic
needs flowers+creative_arts+fine_dining = 5/24/9 ✓; First-Date flowers+brunch+creative_arts = 5/3/24 ✓;
Group-Fun play+fine_dining = 2/9 ✓). The combo-build empty verdict at `index.ts:1219-1233` is therefore
NOT taken.

**E-3. THE DROP — open-at-the-stale-hour counts.** Evaluating each scored+photo-gated Brussels candidate's
`opening_hours.periods` at Seth's stale `datetime_pref` (2026-04-15 21:20 UTC → Brussels local ≈23:20,
Wednesday/day=3), per required signal (open / scored):
`creative_arts 0/24, brunch 0/3, play 0/2, fine_dining 0/9, theatre 1/19, casual_food 2/31`. At 23:20
essentially every category a vibe needs is CLOSED → every Romantic/First-Date/Group-Fun combo's
non-optional stop fails `isStopOpenAtHour` → `filterCuratedByStopHours` drops all cards → `pool_empty`.

**E-4. Runtime status.** Edge logs (this session) show `generate-curated-experiences` returning **200** on
every recent invocation (versions 345; 0.1–14 s) — NOT `pipeline_error`. The empty is a 200 +
`summary.pool_empty`, exactly the `index.ts:1742` hardcode.

**E-5. Git provenance.** `git log -S filterCuratedByStopHours -- generate-curated-experiences/index.ts`
→ a SINGLE commit `cd1437816` "Close ORCH-1061 … solo open-hours gate (#329)" 2026-06-02. The solo curated
path had NO open-hours filter before ORCH-1061. `git log -S dateOption -- generate-curated-experiences/index.ts`
→ ZERO commits: the curated function has **never** read `date_option`, so the date-mode asymmetry is a
pre-existing gap that ORCH-1061's filter ACTIVATED for the solo path.

### Answers to the dispatch questions (v3)

1. **Exact stage + file:line that empties Brussels curated:** the post-build open-hours filter
   `generate-curated-experiences/index.ts:1738` (`cards = filterCuratedByStopHours(cards, curatedUtcNow)`)
   driven by `index.ts:1737` (`curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date()`), with
   the drop body at `_shared/curatedStopHours.ts:220-244` (+ `isStopOpenAtHour` :172-209). NOT the
   candidate pool (`signalRankFetch.ts` / `fetch_local_signal_ranked`), NOT anchor selection, NOT combo
   proximity (`selectBlendedStop` never returns null for a non-empty list). Surfaced as
   `swipeable.no_matches_title` (`SwipeableCards.tsx:2367`).
2. **Which empty reason fires:** `pool_empty`, set at `index.ts:1741-1742` AFTER cards were built and then
   hours-dropped — untruthful (the pool was not empty).
3. **Why singles work but curated doesn't:** singles' `filterByDateTime` branches on `date_option` and for
   `this_weekend` tests open-at-ANY-hour-on-the-weekend (discover-cards:670-678), and
   `filterCuratedByStopHours` no-ops on non-curated cards (`curatedStopHours.ts:222`); curated ignores
   `date_option` and evaluates the literal stale `datetime_pref` evening hour against every stop.
4. **Regressed-by or pre-existing:** the open-hours hard-drop on the SOLO curated path was **REGRESSED by
   ORCH-1061** (#329, `cd1437816`, 2026-06-02). The underlying asymmetry — curated never honoring
   `date_option` — is **pre-existing** but was inert on the solo path until ORCH-1061 added the filter.
5. **Confidence:** **PROVEN** — source-traced end-to-end + Seth's real preferences row + live RPC counts +
   open-at-stale-hour counts + 200 edge logs + git provenance. (A device confirmation would just require
   resetting `datetime_pref` to a current weekend daytime and re-selecting a curated vibe — tester
   confirmation, not needed to establish cause.)
6. **Narrowest fix direction (NOT a spec):** make the curated hours filter HONOR `date_option` the same way
   `filterByDateTime` does — pass `date_option` (and `selected_dates`) into `generate-curated-experiences`
   and into `filterCuratedByStopHours`, and for `this_weekend`/`pick_dates` evaluate open-at-any-hour-on-
   the-target-day instead of the literal `datetime_pref` instant; secondarily, emit a distinct empty reason
   (e.g. `all_closed_at_time`) instead of the hardcoded `pool_empty` at `index.ts:1741-1742` so the verdict
   and copy are honest. A stale-`datetime_pref` hygiene fix (recompute it when `date_option` changes) is a
   complementary client-side option. Do NOT delete the hours filter wholesale (re-opens serving closed
   venues — the harm ORCH-1061 closed).

### Five-layer reconciliation (v3)

| Layer | Finding |
|-------|---------|
| **Docs** | `preferences.date_option` COMMENT (baseline:9061) = '"Now","Today","This Weekend","Pick a Date"' — a first-class user choice. `curatedStopHours.ts:8-23` documents the solo path had NO hours filter pre-ORCH-1061. `CuratedEmptyReason` defines `pool_empty`="no anchor candidates" — drifted (now also fires for hours-emptied decks). |
| **Schema** | `fetch_local_signal_ranked` (ORCH-0990, latest) and `query_servable_places_by_signal` (meta_orch_1009, latest) both gate `is_servable`+`is_active`+score+geo, NO city/country. Brussels rows satisfy both. The DIFFERENCE is downstream date handling in the edge fns, not the RPCs. |
| **Code** | `index.ts:1737-1742` uses only `datetimePref`; never reads `date_option`. `filterByDateTime` (discover-cards:509-707) DOES branch on `date_option`. `filterCuratedByStopHours` (curatedStopHours.ts:222) no-ops on `cardType!=='curated'`. `deckService.ts:739` forwards `datetimePref` to curated but the curated fn has no `dateOption` param. |
| **Runtime** | `generate-curated-experiences` returns 200 (not pipeline_error); the empty is `summary.pool_empty`. Confirmed via get_logs (versions 345). |
| **Data** | Seth's real row: Brussels + `this_weekend` + stale `datetime_pref=2026-04-15 21:20 UTC`. Brussels pool healthy per signal (E-2); at the stale 23:20 hour creative_arts/brunch/play/fine_dining = 0 open (E-3). |

**The gap that IS the bug:** the curated multi-stop pipeline evaluates open-hours against the literal
stored `datetime_pref` and silently ignores the user's `date_option`. With a stale evening `datetime_pref`
and a `this_weekend` selection, every vibe-matching, in-radius, scored, photo-gated Brussels combo is
dropped as "closed at 23:20," the deck empties, and it is mislabeled `pool_empty` → "No spots match right
now." Singles are immune because they branch on `date_option` (and the curated filter no-ops on them).

---

---

## ★ FINAL ROOT CAUSE — custom-location (Brussels) repro ★ (SUPERSEDES the hours-vs-data framing below)

> **This section is authoritative. Everything below it is retained as superseded context.** Seth's
> proven repro (Raleigh current-location WORKS, Brussels custom-location FAILS, same session) is the
> decisive evidence and it **confirms F-1 (the ORCH-1061 open-hours gate) as the SOLE root cause** —
> while DISPROVING every other hypothesis (data gap, score threshold, client geocoding gap, city_id
> filter, radius). The Brussels-vs-Raleigh asymmetry is not a separate bug: it is the **timezone
> manifestation** of the same hours filter, because Brussels and Raleigh are ~6 hours apart, so at one
> wall-clock test moment one city is "daytime/open" and the other is "evening/closed."

### The one-sentence proven root cause

`generate-curated-experiences/index.ts:1738` runs `filterCuratedByStopHours(cards, now())` (added to the
SOLO curated path by **ORCH-1061**, PR #329, `cd1437816`, 2026-06-02), which drops every curated card
whose any non-optional stop is CLOSED at the venue's own local arrival time — and because Brussels is
~6h ahead of Raleigh, at Seth's single test moment the Brussels venues (creative_arts / brunch / play =
**0 open**) are closed while the Raleigh venues are open, so every Brussels vibe is emptied and mislabeled
`pool_empty` (`index.ts:1741-1742`), surfacing as "No spots match right now" (`SwipeableCards.tsx:2367`).

### Decisive evidence (live DB, this session — all READ-ONLY)

**1. Brussels has HEALTHY supply at the exact query radius (data-gap DISPROVEN).** Within the real
2.925 km curated bbox at (50.85, 4.35): **535 servable + photo-gated places, 0 NULL utc_offset, 526 with
`periods` hours.** Running the actual deployed RPC `fetch_local_signal_ranked` at the Brussels bbox
returns ranked candidates for EVERY required signal: `fine_dining=9, creative_arts=24, theatre=19,
casual_food=31, brunch=3, nature=10, drinks=41, play=2, movies=8, icebreakers=51, flowers=200`. The pool
is NOT empty; the combo engine CAN build cards. (Confirms the prior "Brussels has MORE supply than
Raleigh" count.)

**2. Coordinates arrive correctly (client-geocoding-gap hypothesis A DISPROVEN).** A custom location set
via the Mapbox picker persists `custom_lat`/`custom_lng` (resolved coords) to `preferences`;
`useUserLocation.ts:55-57` returns those saved coords directly (Priority 1) and `deckService.ts:733-735`
passes `location: curatedLocation = params.location` straight to the edge fn; the server reads
`location.lat/lng` directly (`index.ts:1681-1686, 1727`). Brussels coords (50.85, 4.35) reach the RPC
intact — proven by evidence #1 returning Brussels rows. The geocoding-gap path
(`useUserLocation.ts:60-83`) only fires for LEGACY data with a string but no coords; Seth's picker
selection has coords.

**3. The candidate query has NO city_id / country filter (hypothesis B DISPROVEN).**
`signalRankFetch.ts:275-295` builds a pure lat/lng **bbox** (`p_lat_min..p_lng_max`) + signal-score gate;
the RPC `fetch_local_signal_ranked` (latest = ORCH-0990 migration) filters on `is_active AND is_servable`
+ `place_scores>=min` + bbox only. No `city_id`, no `city`, no `country` in the WHERE. A typed location
resolving a different/blank `city_id` is irrelevant to candidate selection.

**4. Radius is fine (hypothesis C DISPROVEN).** Same 2.925 km clamped radius applies to Raleigh and
Brussels identically (`distanceMath.ts` / `index.ts:1712-1713`); evidence #1 proves it yields ample
Brussels candidates.

**5. THE DIFFERENTIATOR — the open-hours filter at the timezone-shifted local hour (hypothesis D
PROVEN).** At a single realistic test moment (Seth in Raleigh ~16:00 EDT Thursday → Brussels ~22:00 CEST),
the count of scored candidates **OPEN at that local hour** per required signal:

| signal | Brussels @22:00 (scored / OPEN) | Raleigh @16:00 (scored / OPEN) |
|--------|--------------------------------|-------------------------------|
| creative_arts | 24 / **0** | 34 / 20 |
| brunch | 3 / **0** | 44 / 30 |
| play | 2 / **0** | 30 / 25 |
| nature | 10 / 0 (rescued OPEN by `ALWAYS_OPEN_TYPES`) | 32 / 22 |
| fine_dining | 9 / 2 | 23 / 6 |
| theatre | 19 / 3 | 13 / 3 |
| casual_food | 31 / 10 | 135 / 93 |
| drinks | 41 / 33 | 116 / 78 |

In Brussels at evening, `creative_arts`, `brunch`, and `play` have **ZERO open** candidates. Mapping onto
`EXPERIENCE_TYPES` (index.ts:461-609): **Romantic** combo 1 (`flowers,creative_arts,upscale_fine_dining`)
dies (creative_arts=0); **First-Date** combos `…brunch,creative_arts` and `…play,*` die (brunch=0, play=0);
**Group-Fun** combos `play,*` and `brunch,creative_arts` die (play=0, brunch=0). Every vibe that requires
`creative_arts`/`brunch`/`play` is emptied → `cards.length===0` → hardcoded `pool_empty`. In Raleigh at the
SAME instant, every category has 20-93 open → vibes build → deck populates. **The ONLY variable that
flipped the outcome is the venue-local hour, which the ~6h Brussels↔Raleigh offset shifts from
afternoon-open to evening-closed.** `creative_arts` (museums/galleries) is the cleanest killer because it
is NOT in `ALWAYS_OPEN_TYPES` (`curatedStopHours.ts:135-140`) and closes in the evening.

> Note on the prior pass's "hours judges each venue on its OWN local time so timezone isn't the cause"
> caveat: that is TRUE mechanically (`curatedStopHours.ts:225` uses `card.utcOffsetMinutes`, and Brussels
> rows carry it — 0 NULLs), but it MISSED that the *user's request time is a single wall-clock instant*,
> so the two cities are evaluated at DIFFERENT local hours. The per-venue-local-time logic is exactly why
> Brussels-evening venues read closed while Raleigh-afternoon venues read open at the same moment. The
> caveat does not exonerate the filter — it explains the asymmetry.

### Answers to the dispatch questions

1. **Exact broken step:** `supabase/functions/generate-curated-experiences/index.ts:1738`
   (`cards = filterCuratedByStopHours(cards, curatedUtcNow)`), with the mislabel at `index.ts:1741-1742`
   and the filter body at `_shared/curatedStopHours.ts:220-244` (drop-if-any-non-optional-stop-closed) +
   `isStopOpenAtHour` `:172-209`. Surfaced by `SwipeableCards.tsx:2367` (`swipeable.no_matches_title`).
2. **Which empty reason fires:** `pool_empty` — and it is UNTRUTHFUL here (cards were built, then the
   hours filter dropped them all; the hardcode at `index.ts:1742` overwrites the real cause).
3. **Client vs server vs data:** **SERVER** (edge-function open-hours filter). NOT a client geocoding gap
   (coords arrive fine), NOT a server query filter on city_id (none exists), NOT a radius problem, NOT a
   data/supply gap (Brussels is well-seeded + scored + photo-gated).
4. **Regressed-by commit or pre-existing:** **REGRESSED by ORCH-1061** (PR #329, `cd1437816`,
   2026-06-02). `git log --diff-filter=A` proves `curatedStopHours.ts` was CREATED in that commit and the
   `filterCuratedByStopHours` call was ADDED to the solo path there. Before ORCH-1061 the solo curated
   path applied NO open-hours filter, so a remote/custom evening location still served curated.
5. **Confidence:** **PROVEN.** Source-traced end-to-end + live-DB-reproduced the exact RPC at Brussels
   coords + computed the open-at-local-hour counts that empty Brussels but not Raleigh + git-proved the
   regression commit. (A device repro would just require setting a custom location whose local time is
   evening/late and selecting Romantic/First-Date/Group-Fun — recommended as tester confirmation, not
   required to establish cause.)
6. **Narrowest fix direction (NOT a spec):** make the empty verdict + copy HONEST and stop treating a
   single wall-clock `now()` as the plan time for a REMOTE location. Two complementary directions, both
   inside `generate-curated-experiences` + the empty-copy surface, no SQL change:
   (a) emit a DISTINCT reason (e.g. `all_closed_at_time`) when cards existed pre-`filterCuratedByStopHours`
   but were all dropped, instead of the hardcoded `pool_empty` (index.ts:1741-1742), and branch the
   empty copy (SwipeableCards/deckService) so it reads "Everything there is closed right now — try a later
   time" rather than "No spots match right now";
   (b) PRODUCT call (needs Seth): for a CUSTOM/remote location the user is planning for, the live `now()`
   at the user's device is the wrong clock — the filter should evaluate against the user's CHOSEN plan
   time (`datetimePref`) and, absent one, arguably should not hard-drop a remote-city plan purely because
   it is currently night there. Do NOT delete the hours filter wholesale (re-opens serving closed venues,
   the exact harm ORCH-1061 closed).

### Five-layer reconciliation (final)

| Layer | Finding (custom-location repro) |
|-------|----------------------------------|
| **Docs** | `curatedStopHours.ts:8-23` documents the solo path had NO hours filter pre-ORCH-1061; `CuratedEmptyReason` (curatedExperience.ts) defines `pool_empty`="no anchor candidates" — drifted, now also emitted for hours-emptied decks. |
| **Schema** | `fetch_local_signal_ranked` (ORCH-0990 latest) gates `is_servable` + `place_scores>=min` + lat/lng bbox; NO city_id/country. Brussels rows satisfy it (RPC returns candidates per signal). |
| **Code** | `index.ts:1738` applies `filterCuratedByStopHours` after build, before the `index.ts:1742` hardcoded `pool_empty`; `useUserLocation.ts:55-57` + `deckService.ts:733-735` pass real Brussels coords; `signalRankFetch.ts:275-295` is bbox-only. |
| **Runtime** | The empty is a 200 + `summary.pool_empty` (not an exception). `generate-curated-experiences` was not in the recent get_logs window (Seth's test predates the 1h log retention), so the candidate query was reproduced directly against live DB instead — stronger evidence than a log line. |
| **Data** | Brussels 2.925 km bbox: 535 servable+photo-gated, 0 NULL utc_offset, per-signal scored candidates present; but at 22:00 CEST creative_arts/brunch/play = 0 OPEN. Raleigh at 16:00 EDT: all categories 20-93 OPEN. The data + the venue-local-hour together produce the asymmetry. |

**The gap that IS the bug:** ORCH-1061 added a request-time (`now()`) open-hours hard-drop to the solo
curated path. For a CUSTOM/remote location the user's device `now()` maps to an evening/night local hour
in that city, so vibe-matching, in-radius, scored, photo-gated spots are dropped purely for being closed
at that instant, the deck empties, and it is mislabeled `pool_empty` and rendered "No spots match right
now." Current-location (Raleigh) is unaffected only because its local hour at the test moment was daytime.

---

## ⚠️ EVERYTHING BELOW IS SUPERSEDED CONTEXT (retained for the saga)

The sections below were the prior pass. Their core finding (F-1 = the ORCH-1061 hours filter) is
CONFIRMED and elevated by the custom-location repro above; their hedge that "timezone isn't obviously the
cause" is CORRECTED above (the per-venue-local-time logic is precisely what creates the Brussels-vs-Raleigh
asymmetry at one wall-clock moment). F-2/F-3 (combo all-or-nothing, tight radius) remain proven-mechanism
contributors but are NOT the Brussels driver (the RPC returns ample Brussels candidates per category).
F-4 (undifferentiated `pool_empty` copy) is the proximate reason the suppression reads as a bug.

---

## ⚠️ SCOPE CORRECTION (read first)

A **prior pass of this file investigated the WRONG surface** — brand-AUTHORED experiences served by
`discover-cards` / `generate-curated-experiences` front-load via the `pg_eligible_experiences_for_deck`
RPC (ORCH-1065/1070/1071/1076 supply). Seth clarified the real symptom is about the **AI-assembled,
SCORING-SYSTEM curated INTENT CARDS** — the multi-stop curated experiences built by
`generate-curated-experiences` from `place_pool` via the signal scorer — NOT brand-published
experiences. **This document fully REPLACES the prior brand-experience content.** The brand-experience
paid-supply / expired-date findings (former F-1/F-2) are NOT this bug and are out of scope here. They
remain valid for the SEPARATE brand-experience visibility question if it is ever reopened, but are
explicitly set aside here.

---

## Symptom (verbatim, re-scoped)

> The curated experience (the multi-stop "intent card" assembled by Mingla's scoring/signal system)
> returns "No spots match right now" even when there ARE spots/places that match. Seth knows matching
> spots exist in the data, yet the curated-experience generation comes back empty.

- **Expected:** picking a curated vibe (Romantic / First Date / Group Fun / Adventurous / Picnic / Stroll)
  assembles at least one multi-stop itinerary from the local place pool.
- **Actual:** the deck shows the empty state titled **"No spots match right now"**
  (`cards:swipeable.no_matches_title`, SwipeableCards.tsx:2367), and the edge fn returns
  `summary.emptyReason = 'pool_empty'`.

---

## Investigation manifest (files read, in trace order)

| # | File / object | Why |
|---|---------------|-----|
| 1 | `COMMS_LEDGER.md` | mandatory entry scan; COMMS-0018 (signal-path) reviewed (see F-5) |
| 2 | `app-mobile/src/types/curatedExperience.ts` | `CuratedEmptyReason` union + `CuratedSummary` shape |
| 3 | `supabase/functions/generate-curated-experiences/index.ts` (1–1246, 1605–1955) | the curated builder: handler defaults, `generateCardsForType`, empty-verdict assembly, NEW hours filter |
| 4 | `supabase/functions/_shared/signalRankFetch.ts` (full) | `fetchSinglesForSignalRank` — the scoring candidate query (3-gate serving) |
| 5 | `supabase/functions/_shared/distanceMath.ts` (56–79) | `radiusKmForConstraint` — the candidate radius math |
| 6 | `supabase/functions/_shared/curatedStopHours.ts` (full) | `filterCuratedByStopHours` — the ORCH-1061 open-hours gate (regression) |
| 7 | `supabase/migrations/20260801000001_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql` | LATEST definer of `fetch_local_signal_ranked` RPC (authoritative current state) |
| 8 | `app-mobile/src/services/deckService.ts` (720–1085) | client request + empty-reason aggregation |
| 9 | `app-mobile/src/components/SwipeableCards.tsx` (2355–2394) | renders `no_matches_title` for ALL empty reasons |
| 10 | Live DB + edge-function logs (READ-ONLY) | place_scores coverage, geo pool counts, hours-data coverage, runtime status codes |

---

## How the curated (scoring-system) card is built — the exact data path

```
DiscoverScreen → deckService.fetchCuratedForPills() → POST generate-curated-experiences
  body defaults: experienceType='adventurous', travelMode='walking', travelConstraintValue=30, datetimePref?=now
  → radiusKmForConstraint(30,'walking',1.0) = (30/60)*4.5*1.3*1.0 = 2.925 km → clampedRadius ≈ 2925 m   (index.ts:1712)
  → generateCardsForType(typeDef, ...)                                                                    (index.ts:868)
      for each required category slug in the vibe's combos:
        fetchForCombo(catId) → fetchSinglesForSignalRank(...)                                             (index.ts:912-941)
          → RPC fetch_local_signal_ranked  (THE SCORING SYSTEM gate)                                     (signalRankFetch.ts:268)
              G1: place_pool.is_active AND is_servable                                                    (migration:57)
              G2: place_scores[filter_signal].score >= filter_min (default 120; movies 80; flowers 0)    (migration:55)
              G3 (post-RPC): stored_photo_urls non-empty & not '__backfill_failed__'                     (signalRankFetch.ts ~ withScore.filter)
          → ranked candidates per category
      build each combo: stop-1 = best-ranked; stop-2+ = selectBlendedStop within clampedRadius
      a combo FAILS if ANY non-optional stop category has zero available picks → card skipped
  → cards[]                                                                                              (index.ts:1213)
  ── ORCH-1061 PART 2 NEW GATE ──
  → cards = filterCuratedByStopHours(cards, datetimePref ?? now)                                         (index.ts:1738)
      drops any card whose any NON-OPTIONAL stop is CLOSED at the user's projected ARRIVAL time
  → if cards.length === 0: summary = { emptyReason:'pool_empty', ... }  (HARDCODED, regardless of why)   (index.ts:1741-1742)
  → response includes summary only when cards empty                                                      (index.ts:1943)
→ deckService aggregates emptyReason (pipeline_error > no_viable_anchor > pool_empty)                     (deckService.ts:960-969)
→ SwipeableCards renders cards:swipeable.no_matches_title for the isEmpty case                            (SwipeableCards.tsx:2366-2368)
```

---

## Migration-chain authority

`fetch_local_signal_ranked` is defined/replaced in 3 migrations:
- `20260505000000_baseline_squash_orch_0729.sql` (baseline 9-arg)
- `20260801000001_orch_0990_…primary_type_gate.sql` ← **LATEST = authoritative** (11-arg, drops old 9-arg first)
- (`741076e68` Sub-A touched a sibling object `ai_signal_scores`, not this RPC body)

Per the Phase-0 migration rule, the ORCH-0990 body is current truth: two INNER JOINs to `place_scores`
(`ps_filter` gated `>= p_filter_min`, `ps_rank` ungated), bbox on `place_pool.lat/lng`, `is_active AND
is_servable`. Confirmed live (counts below match this body).

---

## Q-scorecard

**Q1 — Which empty reason fires, and is it the truthful reason?**
Verdict: **PROVEN.** The fired reason is `pool_empty` (deckService default + the index.ts:1742 hardcode).
But it is frequently **NOT** truthful: when the deck is emptied by the ORCH-1061 open-hours filter, the
candidate pool was NON-empty (cards were built, then dropped), yet the verdict is still `pool_empty`. The
user-facing copy ("No spots match right now") is identical for genuine pool-emptiness, hours-emptiness,
and combo-completion failure. See F-1, F-4.

**Q2 — Why does the curated card come back empty when matching spots exist?**
Verdict: **PROVEN (dominant cause).** The ORCH-1061 PART 2 open-hours gate (`filterCuratedByStopHours`,
added to the SOLO curated path 2026-06-02, PR #329) drops every card whose any non-optional stop is
CLOSED at the user's projected arrival time. Spots that MATCH the vibe (and pass the scorer) are dropped
purely because they're closed at the requested time — producing an empty deck that reads as "nothing
matched." This filter did NOT exist on the solo path before ORCH-1061. See F-1.

**Q3 — Is the scoring threshold / candidate pool itself starving the deck?**
Verdict: **RULED OUT as the dominant cause in a well-seeded city; SUSPECTED CONTRIBUTOR for sparse
locations / tight constraints.** Live data shows ample scored candidates within the default 2.9 km
walking radius of Raleigh for every required category (fine_dining 23, creative_arts 37, theatre 13,
casual_food 135, brunch 44, nature 44, drinks 116, play 34) — all surviving the photo gate. So the
score floor (≥120) + geo radius do NOT zero a normal city session. They CAN zero a session in a sparse
market or with a very tight travel constraint (e.g. 15-min walk ≈ 1.46 km) or for a thin category
(movies = 2 candidates at 2.9 km). See F-2, F-3.

**Q4 — Did ORCH-1062 (the vibe rank-override removal) cause this?**
Verdict: **RULED OUT.** ORCH-1062 (PR #332) changed each food/activity stop's `rank_signal` from a vibe
(`romantic`/`lively`/`icebreakers`) to the slot's OWN filter signal. In the RPC, that makes the `ps_rank`
INNER JOIN target the SAME signal as the `ps_filter` join — which RELAXES (never tightens) the join
requirement (the rank join becomes redundant with the filter join, and all signals have ~20k scores
each). It cannot reduce the candidate pool. See F-6.

**Q5 — Is this a stale client bundle or the COMMS-0018 signal_id-buggy venue→deck path?**
Verdict: **RULED OUT.** The empty verdict is produced server-side and is reproducible by the deployed RPC
+ filter logic directly. COMMS-0018 concerns approved-venue scoring (run-signal-scorer invoked without
`signal_id` on admin-approve) — a SUPPLY-onboarding gap, not the curated assembly path. The curated pool
has ~20k scored rows per signal already. See F-5.

**Q6 — Is the edge function throwing (pipeline_error)?**
Verdict: **RULED OUT for the curated fn.** Edge logs show `generate-curated-experiences` returning **200**
on every recent invocation (no 500s). `pipeline_error` is not firing. (Separately, `run-signal-scorer`
shows recent **500s** — relevant to fresh scoring of new venues, NOT to the existing curated pool; noted
as a discovery.) See F-7.

---

## Findings

### F-1 — CONFIRMED ROOT CAUSE (dominant regression): the ORCH-1061 solo open-hours gate empties the curated deck when matching-but-closed spots are dropped, then mislabels it `pool_empty`

- **Symptom:** curated vibe returns "No spots match right now" even though scored, in-radius spots match the vibe.
- **Layer:** code (edge function) + the data the gate now reads.
- **Probe (source):**
  - `generate-curated-experiences/index.ts:1737-1743`
    ```ts
    const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
    cards = filterCuratedByStopHours(cards, curatedUtcNow);
    if (cards.length === 0 && !summary) {
      summary = { emptyReason: 'pool_empty', candidateAnchorCount: 0, failedAnchorCount: 0 };
    }
    ```
  - `_shared/curatedStopHours.ts:220-244` (`filterCuratedByStopHours`) — drops a card if `isStopOpenAtHour(stop, currentHour, localDay)` is false for ANY non-optional stop, accumulating per-stop duration + travel to compute the projected arrival hour of each subsequent stop.
- **Probe (git):** `git show -s cd1437816` → `2026-06-02 23:33:58 Close ORCH-1061: … solo open-hours gate (#329)`; `git show cd1437816 -- generate-curated-experiences/index.ts` shows the `+import { filterCuratedByStopHours }` and `+cards = filterCuratedByStopHours(...)` lines were ADDED in that commit. `curatedStopHours.ts` was CREATED in the same commit (`git log --diff-filter=A`).
- **Probe (data):** `SELECT count(*) FILTER (WHERE opening_hours ? 'periods' AND jsonb_array_length(opening_hours->'periods')>0) … FROM place_pool WHERE is_active AND is_servable;`
- **Evidence (verbatim DB):** `total_servable=35251, has_periods=32867 (93.2%), null_hours=2382`. The ORCH-1061 D-1 fix made the filter read the canonical Google v1 `periods` shape, which 93% of servable rows carry — so the filter now ACTIVELY evaluates open/closed for nearly every candidate (the comment in curatedStopHours.ts:16-23 documents that the PRE-1061 reader only read the rare text shape and "barely filtered anything").
- **Mechanism:** before ORCH-1061 the SOLO curated path applied NO open-hours filter — every vibe-matching itinerary was served regardless of time. After ORCH-1061, if the user opens curated at a time when the plan's venues would be closed (late night, early morning, or a multi-stop chain whose accumulated duration pushes a later stop past its closing — e.g. a Romantic Flowers→creative_arts→fine_dining chain reaching dinner after the gallery closes), EVERY built card is dropped → `cards.length === 0` → the hardcoded `pool_empty` verdict → SwipeableCards shows "No spots match right now." The pool was NOT empty; the spots matched the vibe; they were simply filtered as closed. Default start time is `now()` (no `datetimePref`), so the time-of-day of the request directly governs how aggressively this zeroes the deck.
- **Severity:** **CONFIRMED ROOT CAUSE.** Introduced by ORCH-1061 (PR #329, `cd1437816`, 2026-06-02) — matches Seth's "now currently returns" regression framing.

### F-2 — SECONDARY ROOT CAUSE: combo-completion is all-or-nothing per vibe, so a single thin required category zeroes the whole vibe

- **Symptom:** a vibe returns empty even though MOST of its categories have candidates.
- **Layer:** code.
- **Probe (source):** `generate-curated-experiences/index.ts:1097-1115` (standard branch) — for each non-optional stop, `if (available.length === 0) { valid=false; break; }`; and `:1142-1150` — `if (!valid || builtRequired < requiredStops) continue;`. With cards never reaching `limit`, the loop exhausts at `cards.length===0` → `summary.emptyReason='pool_empty'` (`:1226-1233`).
- **Evidence (verbatim DB, 2.9 km Raleigh, score≥120, photo-gated):** `theatre=13`, `movies=2` candidates. Romantic's two combos BOTH require `upscale_fine_dining` AND (`creative_arts` OR `theatre`); Group-Fun and Adventurous include `movies`/`theatre` combos. A thin category (movies/theatre) in a tighter radius or sparser city can hit zero, failing every combo that names it. Because optional stops (`flowers`) are skipped gracefully but every other slot is mandatory, ONE empty required category = empty vibe.
- **Mechanism:** the AI assembly requires ALL non-optional stops of a combo to resolve; there is no graceful "drop a stop and still serve" path for non-optional stops. Combined with the tight default radius (2.9 km walking), a thin category zeroes the whole vibe → `pool_empty`.
- **Severity:** **SECONDARY ROOT CAUSE** (predates ORCH-1061; design behaviour of the combo engine since ORCH-0634). Biting hardest for thin-supply categories + tight constraints; co-resident with F-1.

### F-3 — SUSPECTED CONTRIBUTOR: the tight default candidate radius (walking, 30 min ≈ 2.9 km) starves sparse markets

- **Symptom:** curated empty in sparse / non-flagship cities even when the user expects "spots nearby."
- **Layer:** code (`_shared/distanceMath.ts:72-79`) + data.
- **Probe (source):** `radiusKmForConstraint(constraintMin, mode, generosity)` = `(constraintMin/60)*speed*factor*generosity`; curated uses `generosity=1.0` (index.ts:1712). Walking speed 4.5, factor 1.3 ⇒ 30 min = 2.925 km; 15 min = 1.46 km; clamped to [500 m, 50 km].
- **Evidence:** at 2.9 km Raleigh the pool is healthy (F-2 counts), but the radius scales linearly with the constraint and city density; a 15-min walking constraint halves the bbox area-linear radius, and a sparse market may have single-digit scored candidates per category, intersecting with F-2 to zero a vibe.
- **Mechanism:** tight honest radius (deliberate, ORCH-0903 — multi-stop trips traverse end-to-end) interacts with thin local supply to empty the pool. Not new (ORCH-0903), so not the regression, but a real contributor to "empty when I think spots exist nearby."
- **Severity:** **SUSPECTED CONTRIBUTOR** (proven mechanism; magnitude depends on the user's actual location + constraint, which the logs don't disclose per-request).

### F-4 — CONFIRMED (mislabel / undifferentiated copy): `pool_empty` + "No spots match right now" is shown for THREE distinct causes

- **Symptom:** Seth reads a healthy-but-closed or thin-category suppression as "nothing matched."
- **Layer:** code (edge verdict) + UI copy.
- **Probe (source):** index.ts:1742 hardcodes `pool_empty` after the hours filter (even though cards existed pre-filter); deckService.ts:960-969 collapses any reason without `pipeline_error`/`no_viable_anchor` to `pool_empty`; SwipeableCards.tsx:2366-2368 maps the `isEmpty` case to the single key `cards:swipeable.no_matches_title` for every reason except the collab privacy dead-end.
- **Evidence (verbatim):** `titleKey = isEmpty ? 'cards:swipeable.no_matches_title' : 'cards:swipeable.seen_everything'` (no branch on `curatedEmptyReason`).
- **Mechanism:** the three failure modes (genuine pool emptiness F-2/F-3, closed-at-time F-1, pipeline error) collapse to one copy string, so an expected/healthy suppression is indistinguishable from a real "no supply" — which is precisely why Seth perceives a regression.
- **Severity:** **CONFIRMED** (proximate reason the symptom reads as a bug; also the cleanest narrow fix surface — see direction).

### F-5 — RULED OUT: COMMS-0018 signal_id-buggy venue→deck path / stale bundle

- **Probe:** COMMS-0018 ledger entry + `generate-curated-experiences/index.ts:57-59` comment ("Bypasses place_pool / ai_signal_scores / run-signal-scorer ENTIRELY" — that note is about the brand-EXPERIENCE front-load, but the COMMS-0018 defect itself is in `admin-review-venue-claim`'s scorer invoke). Live `place_scores` has ~20k rows per signal.
- **Evidence (verbatim DB):** per-signal `place_scores` counts: icebreakers 21626, lively 21617, romantic 21597, drinks 21143, scenic 21127, casual_food 21099, fine_dining 21007, picnic_friendly 20598, nature 20470, creative_arts 20382, brunch 20274, play 19781, flowers 19023, theatre 18563, movies 18350, groceries 16307. The curated pool is richly scored; COMMS-0018 affects only newly-approved venues that never got scored, not the existing curated supply.
- **Severity:** **RULED OUT** for this symptom.

### F-6 — RULED OUT: ORCH-1062 vibe rank-override removal

- **Probe (git):** `git show f8b222b81` removed `EXPERIENCE_RANK_SIGNAL_OVERRIDE` entries for romantic/first-date/group-fun/adventurous/take-a-stroll food+activity stops (vibe rank signals `romantic`/`icebreakers`/`lively`), keeping only the two NATURE overrides (`scenic`, `picnic_friendly`). `resolveStopRankSignal` (index.ts:676-678) now falls back to `COMBO_SLUG_TO_FILTER_SIGNAL[catId]` for those stops.
- **Evidence:** RPC `fetch_local_signal_ranked` (migration:55-56) requires `ps_filter.signal_id=p_filter_signal AND score>=p_filter_min` AND `ps_rank.signal_id=p_rank_signal`. With ORCH-1062, `p_rank_signal == p_filter_signal` for those stops, so the `ps_rank` join targets the same already-required signal → the join is redundant, NOT additive. Pre-1062 it required a SEPARATE vibe score (`romantic`/`lively`/`icebreakers`), which is a STRICTER requirement. Therefore ORCH-1062 widened (relaxed), it did not starve.
- **Severity:** **RULED OUT.** (If anything, ORCH-1062 made empties LESS likely on the scoring side.)

### F-7 — RULED OUT for curated fn (but discovery): run-signal-scorer 500s

- **Probe:** edge `get_logs(edge-function)`.
- **Evidence (verbatim):** `generate-curated-experiences` → all recent `POST | 200` (e.g. 4641ms, 6362ms, 92ms warm). `run-signal-scorer` → multiple recent `POST | 500` (≈8.2–8.7 s each, version 186). The curated fn is NOT throwing; the scorer is.
- **Mechanism:** the curated empties are 200-responses carrying `summary.emptyReason='pool_empty'`, not exceptions — so `pipeline_error` is not the path. The scorer 500s would affect FRESH scoring of new venues (supply growth), not the already-scored curated pool, so they do not cause the present symptom.
- **Severity:** **RULED OUT** for the symptom; **flagged as a Discovery** (scorer health).

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | `curatedStopHours.ts:8-23` explicitly states the SOLO path applied NO open-hours filter before ORCH-1061 and that the D-1 fix made the filter actually bite. `CuratedEmptyReason` doc (curatedExperience.ts) defines `pool_empty` = "no anchor candidates" — but the code now emits `pool_empty` for hours-emptied decks too (a doc/code drift). |
| **Schema** | `fetch_local_signal_ranked` (latest = ORCH-0990 migration) gates on `is_servable`, `place_scores[filter]≥filter_min`, bbox. All present, correct vs migration. ≥120 floor (80 movies, 0 flowers) is intact. |
| **Code** | The NEW `filterCuratedByStopHours` call (index.ts:1738) runs AFTER cards are built and BEFORE the empty verdict; the verdict is hardcoded `pool_empty` (index.ts:1742) regardless of whether the emptiness was hours-driven. UI copy (SwipeableCards.tsx:2367) does not branch on reason. |
| **Runtime** | Edge logs: `generate-curated-experiences` returns 200 (no exception); empties are 200 + `summary.pool_empty`. `run-signal-scorer` returns 500s (separate concern). |
| **Data** | 35,251 servable place_pool rows; 32,867 (93%) carry `periods` hours → the hours gate is broadly active. ~20k `place_scores` per signal. 2.9 km Raleigh has ample per-category scored supply. |

**The gap that IS the bug:** ORCH-1061 added a time-of-day open-hours filter to the solo curated path that
previously did not exist; it now drops vibe-matching, in-radius, scored spots purely for being closed at
the requested time, and the resulting empty deck is mislabeled `pool_empty` and rendered with the generic
"No spots match right now." A user who knows matching spots exist sees a false "no match." The combo
all-or-nothing engine (F-2) and tight radius (F-3) compound this in thin markets, and the undifferentiated
copy (F-4) makes every cause look like the same regression.

---

## Repro evidence

This is a backend/SQL/data root cause (exempt from the sim-reproducer directive per Prime Directive 7).
Reproduced via: (a) source trace of the post-build hours filter + hardcoded verdict; (b) git proof that
the filter was ADDED to the solo path by ORCH-1061 on 2026-06-02; (c) live DB proof that 93% of servable
rows carry the `periods` data the filter now reads, and that scored per-category supply is ample in a
flagship city; (d) edge logs proving the curated fn returns 200 (not pipeline_error) and the scorer
returns 500s. A device/sim repro would require choosing a request time at which the local plan's stops are
closed (e.g. late night) and observing the empty deck — recommended as a tester confirmation, not required
to establish the cause.

---

## Blast radius / cross-surface map

- `filterCuratedByStopHours` is called by **both** curated paths:
  - SOLO: `generate-curated-experiences/index.ts:1738` (this fn, called directly by `deckService.ts`).
  - COLLAB: `discover-cards/index.ts` (pre-1061; the extraction made it shared, Constitution #6).
  Both are **Consumer iOS + Consumer Android**.
- The combo all-or-nothing engine (F-2) and tight radius (F-3) affect every curated vibe on both
  consumer platforms identically (shared edge fn → parity automatic).
- **In scope:** Consumer iOS, Consumer Android (the curated deck surface).
- **Out of scope:** Buyer/anon Web, Business app/web, Admin (none call `generate-curated-experiences`).

---

## Invariant impact (flagged, NOT resolved)

- **I-CURATED-HOURS-VIA-CANONICAL-READER** (ORCH-1019/1061) — F-1 is this gate working as designed at the
  data level; the defect is that the SOLO path NOW applies it (new behaviour) AND that an hours-driven
  emptiness is reported as `pool_empty`. A fix must not silently re-introduce serving closed venues; the
  product question is whether curated should hours-filter at REQUEST time vs the user's chosen plan time,
  and whether a closed-but-matching deck should say "everything nearby is closed right now" instead of
  "no spots match."
- **Honest-unknown → OPEN rule** (curatedStopHours.ts:25-27, Constitution #9) — preserved; not the cause.
- **`CuratedEmptyReason` contract** (curatedExperience.ts) — the `pool_empty` literal is now overloaded
  (covers hours-emptied decks). A new reason (e.g. `all_closed_at_time`) is a candidate but is a
  PRODUCT/contract decision for the orchestrator, not pre-decided here.

---

## Discoveries for Orchestrator

1. **`run-signal-scorer` is returning 500s** (≈8.2–8.7 s, version 186, multiple recent) — separate from
   this symptom (affects fresh scoring of new venues, not the existing curated pool) but worth its own
   triage; it can starve NEWLY-approved venues from ever reaching the deck.
2. **Undifferentiated empty copy** — "No spots match right now" is shown for genuine pool-emptiness,
   closed-at-time, and pipeline error alike (SwipeableCards.tsx:2366-2368). This is the proximate reason a
   healthy suppression reads as a regression.
3. **`pool_empty` is hardcoded after the hours filter** (index.ts:1742) — the emptyReason telemetry/UX
   can never distinguish "pool was empty" from "everything was closed," so neither logs nor copy can be
   honest about which one happened.
4. **Combo all-or-nothing** (F-2): a single thin required category (movies=2, theatre=13 at 2.9 km Raleigh)
   zeroes an entire vibe; there is no graceful non-optional-stop degrade.

---

## Recommended next phase + recommended scope (DIRECTION ONLY — not a fix, not a spec)

**Next phase: SPEC** (mingla-forensics SPEC mode or orchestrator-dispatched). Pick scope based on Seth's
intent; do NOT pre-decide:

- **Narrowest (most likely correct):** make the empty verdict + copy HONEST. (a) In
  `generate-curated-experiences`, when cards existed pre-hours-filter but were all dropped by
  `filterCuratedByStopHours`, emit a DISTINCT reason (e.g. `all_closed_at_time`) instead of the hardcoded
  `pool_empty` (index.ts:1741-1742); (b) in `SwipeableCards`/deckService, branch the empty copy on the
  reason so a closed-at-time deck says something like "Everything nearby is closed right now — try a
  later time" rather than "No spots match right now." No SQL change; preserves the hours invariant.
- **Behavioural (needs Seth's product call):** decide whether the SOLO curated path SHOULD hours-filter at
  the live request time at all (ORCH-1061 added it deliberately to avoid serving closed venues). Options
  include filtering against the user's CHOSEN plan time only (not `now()`), softening to a warning rather
  than a hard drop, or keeping at least one card and flagging closed stops. This contradicts ORCH-1061's
  explicit "don't serve closed stops" intent, so it needs sign-off.
- **Supply/robustness (separate, optional):** graceful combo degrade for thin categories (F-2) and/or a
  radius floor for curated (F-3) so a thin market still assembles a plan. Larger scope; defer unless Seth
  prioritizes sparse-market coverage.

Do NOT "fix" the empty deck by deleting the hours filter wholesale — that re-opens serving closed venues
(the exact harm ORCH-1061 closed).

---

## Confidence

**PROVEN.** The dominant regression (F-1) is established with: source proof of the post-build hours filter
+ hardcoded `pool_empty` verdict; git proof that ORCH-1061 (PR #329, `cd1437816`, 2026-06-02) ADDED that
filter to the previously-unfiltered solo path; live-DB proof that 93% of servable rows carry the hours
data the filter now reads; and edge-log proof that the curated fn returns 200 (not `pipeline_error`). The
fired empty reason is `pool_empty` and it is frequently untruthful. ORCH-1062, COMMS-0018, stale bundle,
and pipeline_error are each ruled out with evidence. F-2/F-3 (combo all-or-nothing + tight radius) are
proven-mechanism contributors whose live magnitude depends on the user's specific location/constraint,
which the logs do not disclose per-request (capping THOSE two at "probable" for any given session — the
dominant F-1 stays PROVEN).
