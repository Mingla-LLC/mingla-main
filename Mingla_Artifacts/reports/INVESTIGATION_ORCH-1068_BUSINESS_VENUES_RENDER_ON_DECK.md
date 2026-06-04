# INVESTIGATION — ORCH-1068 [business-authored venues render on the consumer deck]

**Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1068-[business-venues-render-on-deck]/` on branch `ORCH-1068-business-venues-render-on-deck`
**Confidence:** root cause **proven** (live DB + full source trace; operator drove the iPhone 17 Pro sim this session and confirmed non-render)
**Builds on:** ORCH-1067 (B7 photo gate — CLOSED 2026-06-03), META-ORCH-1062 (scorer signal_id fix), META-ORCH-1009 Sub-E/F (business authoring pipeline). Acked COMMS-0018, COMMS-0002, COMMS-0003.

---

## Symptom Summary

| | |
|---|---|
| **Expected** | A business-authored venue that is `is_servable=true`, scored (drinks=200), in range, and open during its real hours RENDERS on the consumer **Drinks & Music** deck. |
| **Actual** | It does NOT render. The raw RPC `query_servable_places_by_signal` returns it (so it "looks surfaced" in DB probes), but the `discover-cards` edge function silently drops it before the response. |
| **Reproducer** | Lantern & Vine, `place_pool.id = 8b720912-a0bf-405a-88f8-773eca6f3f33`, `drinks` score 200, Raleigh. Drinks deck, "today" date mode. |
| **When** | Always — for every business-authored venue, since the authoring pipeline first wrote array-shaped hours (META-ORCH-1009 Sub-E). |

---

## Five-Layer Cross-Check

| Layer | Finding |
|-------|---------|
| **Docs** | discover-cards header (`index.ts:143-146`, `216-229`) declares "Cards without opening hours are EXCLUDED except ALWAYS_OPEN_TYPES" and that `opening_hours` is "the unwrapped Google Places v1 `regularOpeningHours` shape" with top-level `periods`. The doc assumes Google shape universally — it predates business authoring. |
| **Schema** | `place_pool.opening_hours` is `jsonb` (untyped). It can hold EITHER the Google object `{openNow, periods, weekdayDescriptions, …}` OR a business array `[{weekday,isClosed,openTime,closeTime}]`. No constraint enforces a shape. |
| **Code** | `discover-cards` `filterByDateTime` → `hasOpeningData`/`isOpenAtHour` read `oh.periods` / `oh._periods` / lowercase-day text keys. A top-level ARRAY satisfies none → returns `false` → excluded. |
| **Runtime** | RPC returns Lantern (proven). `discover-cards` solo path (line 2036) applies `filterByDateTime(..., 'today')` → Lantern dropped → deck response omits it. |
| **Data (live)** | Lantern `opening_hours` = `[{"weekday":0,"isClosed":false,"openTime":"07:00","closeTime":"20:00"}, …7 rows]`; `oh_type='array'`; `utc_offset_minutes=null`; `stored_photo_urls[0]` = a Cloudinary `.mp4`. 3 business-authored rows total, 2 servable, all array-shaped hours, all null utc_offset, all video-first photo[0]. |

**The layers disagree at Schema vs Code:** the schema permits two shapes; the code reads only one. That is the bug.

---

## Findings (classified)

### 🔴 F-1 (ROOT CAUSE) — discover-cards open-hours filter cannot read the business array hours shape

- **File + line:** `supabase/functions/discover-cards/index.ts:291-305` (`hasOpeningData`) and `:238-288` (`isOpenAtHour`); applied at `:2036` (solo) and `:1244` (collab).
- **Exact code (`hasOpeningData`):**
  ```ts
  const oh = place.openingHours;
  if (oh && typeof oh === 'object') {
    if (Array.isArray(oh.periods) && oh.periods.length > 0) return true;
    if (Array.isArray(oh._periods) && oh._periods.length > 0) return true;
    return DAY_NAMES.some(d => oh[d]);   // oh['monday'] etc.
  }
  return false;
  ```
- **What it does:** For Lantern's value (a JS array), `typeof oh === 'object'` is true, but `oh.periods`/`oh._periods` are `undefined` and `oh['monday']` is `undefined` → `hasOpeningData` returns `false`. `primary_type='restaurant'` is NOT in `ALWAYS_OPEN_TYPES` → no escape. In "today" mode, `filterByDateTime` (`:361`) drops any place where `hasOpeningData` is false.
- **What it should do:** Recognize the venue is open 07:00–20:00 every day and INCLUDE it during those hours; exclude it only when genuinely closed.
- **Causal chain:** authoring writes array hours → RPC returns the row (no hours filter in RPC) → `transformServablePlaceToCard` maps `row.opening_hours` → `card.openingHours` (`:500`) → `filterByDateTime` → `hasOpeningData(card)=false` → card removed → deck response omits it → user never sees the venue.
- **Verification step:** In Deno, call `hasOpeningData({ openingHours: [{weekday:0,isClosed:false,openTime:"07:00",closeTime:"20:00"}], placeType:'restaurant' })` → returns `false`. Swap in `{ periods:[{open:{day:0,hour:7},close:{day:0,hour:20}}] }` → returns `true`. (Disproves the non-cause candidates below.)

**Candidate causes considered and DISPROVEN (Prime Directive 1):**
1. *Cohort excludes it* — DISPROVEN: `admin_config.signal_serving_drinks_pct = 100` (live) → `isInCohort` true for everyone.
2. *RPC filters it out* — DISPROVEN: `pg_get_functiondef(query_servable_places_by_signal)` shows WHERE clause is only `is_servable, is_active, score≥filter_min, photos present, radius, exclude_ids` — NO hours predicate. Lantern satisfies all (score 200 ≥ 120, 7 photos, servable, in Raleigh radius).
3. *Photo gate (B7)* — DISPROVEN: ORCH-1067 already fixed that; Lantern is `is_servable=true`, `deck_eligible`.
4. *Round-robin/interleave drops it* — DISPROVEN: single chip "Drinks & Music" → its bucket is the only bucket; `roundRobinByChip` returns it. The drop is strictly at `filterByDateTime`.

### 🔴 F-2 (ROOT CAUSE, latent off-by-one) — business array weekday convention is 0=Monday, but Google periods (and the filter's `day` index) are 0=Sunday

- **File + line:** Convention declared in `mingla-business/src/types/brand.ts:336` (`BrandHourEntry … weekday 0 = Monday … 6 = Sunday`) and `mingla-business/src/utils/venueBrandHours.ts:2`. Write path: `run-business-place-authoring-pipeline/index.ts:533` and `:592` (`opening_hours: draft.hours ?? draft.openingHours ?? null` — stored verbatim, NO conversion).
- **What it does:** The stored array's `weekday` field uses **0=Monday**. The discover-cards filter computes `targetDay = localDate.getUTCDay()` which is **0=Sunday** (JS convention) and `period.open.day` in Google is **0=Sunday**. The reverse mapper `mapPoolOpeningHoursToBrandHours.ts:23-27` documents `googleDayToWeekday(0→6)` proving the two systems differ by this exact offset.
- **What it should do:** Any fix that reads the array MUST translate business `weekday` (0=Mon) → Google `day` (0=Sun) (`day = (weekday + 1) % 7`), or the open/closed check is off by one day.
- **Causal chain:** Lantern is open all 7 days with identical hours, so this off-by-one is MASKED today (every day looks the same). The moment any business venue is closed one weekday (e.g. closed Sunday), a naive array reader would report the wrong day's hours.
- **Verification step:** Author a venue closed Sunday only; under a naive reader it would show open Sunday and closed Monday. The normalize step (F-1 fix) must apply `(weekday+1)%7`.
- **Classification rationale:** Today it does not cause the Lantern symptom (root cause is F-1), but it is a guaranteed correctness defect the F-1 fix MUST handle, so it is elevated to ROOT CAUSE for the fix contract (not merely a hidden flaw).

### 🟠 F-3 (CONTRIBUTING / blast-radius) — every consumer-side hours reader assumes the Google object shape

Enumerated readers of `opening_hours` on the consumer path (grep `supabase/functions`):
- `generate-curated-experiences/index.ts:527,531-532` — reads `card.opening_hours.openNow` for `isOpenNow` and passes to `filterCuratedByStopHours` (which reads `.periods`). Array → `openNow` undefined → `isOpenNow` mis-derived; `.periods` absent → curated module's honest-unknown branch assumes OPEN (does not exclude, but does not correctly gate either).
- `_shared/personHeroCards.ts:196-198` — `opening_hours.openNow` → array → `isOpenNow=null`.
- `_shared/signalRankFetch.ts:55,374` + `_shared/stopAlternatives.ts:57,207` — type `opening_hours` as `Record<string,unknown>` and forward it; downstream `.periods` reads fail on arrays.
- `_shared/curatedStopHours.ts` `isStopOpenAtHour` — reads `.periods`/`_periods`/text; array yields honest-unknown→OPEN.

**Why this matters for the fix decision:** the array shape leaks into MANY consumer readers, all of which already correctly handle the Google object. Normalizing the stored data to the Google shape fixes ALL of them in one move. Teaching only `discover-cards` leaves curated `openNow`, person-hero, and rank-fetch readers subtly wrong. This is the decisive argument for NORMALIZE-AT-WRITE + BACKFILL over teach-the-filter.

### 🟠 F-4 (CONTRIBUTING) — `utc_offset_minutes` is NULL on all 3 business rows → "today" mode uses a crude longitude fallback

- **File + line:** `discover-cards/index.ts:363` — `offsetMin = place.utcOffsetMinutes ?? (place.lng != null ? Math.round(place.lng/15)*60 : 0)`.
- **What it does:** With `utc_offset_minutes=null`, the deck derives the venue's local time from longitude (`lng/15 h`). For Raleigh (lng −78.74) this yields ≈ −5h, close enough that the "open now" window is roughly right, but it ignores DST and is not authoritative.
- **Impact:** Does NOT cause exclusion (the longitude fallback still produces a plausible local hour, and Lantern is open 07:00–20:00 so most daytime probes pass). It is an accuracy gap, not the blocker. The normalize step SHOULD also populate `utc_offset_minutes` from the venue's tz for correctness.
- **Classification:** contributing accuracy gap, not the render blocker.

### 🟠 F-5 (CONTRIBUTING / UX) — video-first `stored_photo_urls[0]` produces a broken/fallback hero (card renders, hero wrong)

- **File + line:** `discover-cards/index.ts:498` (`image: storedPhotos[0] ?? null`) → `app-mobile/src/components/SwipeableCards.tsx:144-163` (`CardHeroImage` renders via `ExpoImage` only).
- **What it does:** Lantern's `stored_photo_urls[0]` is a Cloudinary `video/upload/...mp4`. The card's `image` becomes that `.mp4`. `ExpoImage` cannot decode an `.mp4` → `onError` fires → it swaps to `CARD_FALLBACK_IMAGE` (a generic stock photo). The card is NOT dropped, but the hero shows a wrong/generic image instead of the venue's real photo (`stored_photo_urls[1]` is a real `.jpg`).
- **What it should do:** The deck hero should be the first IMAGE url (skip leading video), so the static hero is the venue's real photo. Video remains available for any future cover-video player; the still hero must be an image.
- **Verification step:** On the deck card, observe Lantern's hero is the fallback stock photo, not its uploaded gallery image. After fix (pick first non-video url), hero = `…/gallery/mpvfz1bobnl59k.jpg`.
- **Classification:** contributing UX defect — once F-1 lets the card render, F-5 determines whether it renders WELL. In scope because the acceptance criterion is "renders" and a fallback-stock hero is a poor render.

### 🔵 F-6 (OBSERVATION) — other Google-shape fields degrade gracefully (no gap)

- `rating=null`, `review_count=0` → `transformServablePlaceToCard` passes them straight through; mobile hides the rating badge when null (`I-DECK-CARD-CONTRACT` honest-unknown). No fabrication, no exclusion. **No gap.**
- `price_level='PRICE_LEVEL_VERY_EXPENSIVE'` → `googleLevelToTierSlug` maps it (authoring writes canonical Google levels via `PRICE_TIER_TO_GOOGLE_LEVEL`). **No gap.**
- `primary_type='restaurant'`, `types=['restaurant','food','point_of_interest']` → valid Google-style types; signal is score-driven not type-gated on the drinks chip. **No gap.**
- `google_place_id=null` → only used as a secondary id (`placeId`); mobile keys on `place_id` uuid. **No gap.**

### 🔵 F-7 (OBSERVATION) — the RPC is the correct place to NOT filter hours

`query_servable_places_by_signal` deliberately omits an hours predicate (hours are a client-time concern needing the user's "today/weekend/pick-dates" choice + tz). Keeping the hours gate in `discover-cards` is the right architecture; the fix belongs at the DATA shape (normalize) + a defensive reader, not in the RPC.

---

## Format-Gap Inventory (the deliverable table)

| # | Google-shape assumption | Business-authored reality | Verdict | Where |
|---|---|---|---|---|
| 1 | hours = object `{periods:[{open:{day,hour},close:{…}}], openNow, …}` | top-level array `[{weekday,isClosed,openTime,closeTime}]` | **GAP — primary blocker** (F-1) | `discover-cards hasOpeningData/isOpenAtHour` |
| 2 | weekday index 0=Sunday (Google `day`) | array `weekday` 0=Monday (BrandHourEntry) | **GAP — latent off-by-one** (F-2) | authoring write path + any array reader |
| 3 | `opening_hours.openNow` boolean present | absent on array | **GAP — curated/person-hero isOpenNow** (F-3) | `generate-curated-experiences`, `personHeroCards` |
| 4 | `utc_offset_minutes` populated | NULL | **GAP — accuracy only, not blocker** (F-4) | `discover-cards` today-mode local time |
| 5 | `stored_photo_urls[0]` is an image | can be a Cloudinary `.mp4` | **GAP — broken/fallback hero** (F-5) | deck `image` + `CardHeroImage` |
| 6 | rating/review_count/price_level/types/google_place_id | null rating, 0 reviews, canonical Google price level, Google-style types, null gpid | **NO GAP — degrade cleanly** (F-6) | transformer + mobile |
| 7 | RPC should not gate hours | n/a | **NO GAP — correct as-is** (F-7) | RPC |

Serving-cohort question (operator asked): **NOT a gap.** `signal_serving_drinks_pct=100` (live) → cohort includes everyone; `query_servable_places_by_signal` has no hours/type gate. The reason the sim deck "didn't match the raw drinks ranking" is exclusively F-1 (the open-hours filter removing the business row after the RPC returned it), plus the F-5 hero making any rendered card look wrong.

---

## Blast Radius

- **Affects:** Consumer iOS + Consumer Android deck (solo AND collab — both call `filterByDateTime`/`filterCuratedByStopHours`). Curated solo path (`generate-curated-experiences`) for `isOpenNow` accuracy. Person-hero cards. NOT admin, NOT buyer-web, NOT business-app UI.
- **Existing data at risk:** exactly 3 business-authored rows (2 servable, 1 `processing`). A backfill touches only `business_author_brand_id IS NOT NULL` rows — zero risk to the 80k+ Google rows.
- **Invariants touched:** `I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME` (unchanged — fix doesn't touch distance), Constitution #13 exclusion-consistency (generation vs serving must agree — the normalize keeps both reading one shape), Constitution #9 no-fabrication (hero must show real photo or honest fallback, not a misleading stock image for a venue we DO have a photo for).

---

## Outcome & Journey Step-Back (Phase 5.5)

**User's goal (the business):** "I listed my venue; consumers should discover it on the deck like any other place." **(The consumer):** "Show me real open places matching my vibe."

**Journey:** business authors venue → pipeline marks `deck_eligible` + admin approves → `is_servable=true` + scored → consumer picks Drinks → deck RPC returns it → **(diverges here)** open-hours filter drops it → consumer never sees it. Even if it rendered, the hero would be a generic stock photo (F-5 divergence #2).

**Does fixing F-1 alone deliver the outcome?** Partially — the card would render, but with a broken hero (F-5) and a latent wrong-day risk (F-2). To deliver the FULL outcome the fix must: normalize hours to the Google shape (fixes F-1 + F-3 across all readers) WITH the weekday translation (F-2) and tz population (F-4), AND pick an image hero (F-5). That is why the SPEC scope is the normalize+backfill class-fix plus the hero-picker, not just a one-line filter patch.

---

## Fix Strategy (direction — full contract in the SPEC)

**Chosen: NORMALIZE-AT-WRITE + BACKFILL (operator's lean), with a defensive teach-the-reader safety net.**

1. **Normalize-at-write:** in `run-business-place-authoring-pipeline`, convert the wizard array `[{weekday(0=Mon),isClosed,openTime,closeTime}]` → canonical Google v1 object `{openNow:null, periods:[{open:{day,hour,minute},close:{day,hour,minute}}], weekdayDescriptions:[…]}` with `day = (weekday+1)%7`, before the `place_pool` write (both Tier-1 create + confirm sites). Also set `utc_offset_minutes` from the venue tz. Future business venues then flow through the ENTIRE consumer pipeline unchanged.
2. **Backfill migration** (version `20260905000000`, strictly > remote max `20260904000000`): a one-shot that rewrites the 3 existing `business_author_brand_id IS NOT NULL` rows whose `opening_hours` is array-shaped into the Google object shape (same conversion + weekday translation), idempotent (`jsonb_typeof(opening_hours)='array'` guard).
3. **Defensive safety net (cheap, belt-and-suspenders):** add an array-shape branch to `discover-cards` `hasOpeningData`/`isOpenAtHour` AND to `_shared/curatedStopHours.ts isStopOpenAtHour`, so any future un-normalized array still serves correctly instead of being silently excluded. This is the regression guard, not the primary fix.
4. **Hero picker (F-5):** in `discover-cards transformServablePlaceToCard`, set `image` to the first NON-video url in `stored_photo_urls` (keep full list in `images`). Optionally mirror in the curated/person-hero transformers.

**Why not teach-the-filter ONLY:** F-3 proves the array leaks into ≥4 consumer readers; teaching only discover-cards leaves the rest wrong. Normalize fixes the class.

---

## Discoveries for Orchestrator

- **D-1 (data-integrity, this ORCH):** the authoring write path stores the business array WITHOUT weekday translation — both the normalize fix AND any reader must apply `(weekday+1)%7`. Captured as F-2.
- **D-2 (ORCH-1067 close was over-optimistic):** ORCH-1067's CLOSE banner said "confirm it surfaces on the deck" as a close action; it deployed the photo-gate fix but the venue still does not surface because of THIS open-hours gate. Not a regression — a second, independent gate. Worth a note in WORLD_MAP that the "surfaces on deck" outcome is only delivered by ORCH-1068.
- **D-3 (follow-up candidate):** business venues have no real video cover-PLAYER on the deck card yet (F-5 fix only picks an image still). A future ORCH could add an autoplaying cover-video hero on the deck (gated, per the unified cover-picker memory note).

---

## Confidence

**Root cause F-1: proven** — live DB shows the array shape; source trace shows the exact exclusion line; non-causes disproven with live config + the RPC definition; operator drove the iPhone 17 Pro sim this session and confirmed non-render. F-2/F-3/F-5 proven by source + live data. Sim acceptance of the FIX is deferred to TEST per SC-ACCEPT.
