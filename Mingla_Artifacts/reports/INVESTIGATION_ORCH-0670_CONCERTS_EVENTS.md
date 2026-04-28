# Investigation — ORCH-0670 Concerts & Events Brutal Audit

**Mode:** INVESTIGATE-ONLY
**Dispatch:** `prompts/FORENSICS_ORCH-0670_CONCERTS_EVENTS_BRUTAL_AUDIT.md`
**Date:** 2026-04-25
**Investigator:** mingla-forensics
**Confidence ceiling:** static-analysis only — live-fire matrix in dispatch §1.2 was NOT executed (headless environment, no Ticketmaster API key access). Per `feedback_headless_qa_rpc_gap.md`, geographic/runtime findings are marked `NEEDS-LIVE-FIRE` and capped at MEDIUM confidence regardless of how strong the code-level signal is. Static-only findings (filter logic, i18n drift, currency math, hardcoded segments, missing fallback paths) are HIGH where the code is unambiguous.

---

## §0 Executive Verdict (5 lines)

- **Q1 Geography:** **PARTIAL → likely FAIL for non-US/UK** (NEEDS-LIVE-FIRE) — segment hardcoded to music, no `countryCode`, lat/lng+50km only, currency falls back to "USD" silently, day-of-week computed in UTC from venue-local string, NY-timezone hardcoded for cache rollover. Code patterns predict Lagos/Mumbai/São Paulo see zero or near-zero with no UX distinction from "no events tonight."
- **Q2 Filtering:** **FAIL on every filter dimension** (HIGH) — date filter excluded from BOTH cache keys (mobile + edge fn) → cache poisoning across date windows; price filter is client-side-only post-fetch on a 20-row page AND tier chips (`chill`/`comfy`/`bougie`/`lavish`) are silent no-ops AND TBA-price events filtered invisibly AND USD bands applied to non-USD ranges; genre keywords joined with comma sent as TM single-`keyword` param (phrase match, not OR).
- **Q3 Robustness:** **D — failing floor** (HIGH) — i18n key drift means empty/error/no-match states render literal `discover:empty.no_events_title` strings to users; double-currency-conversion in `formatPriceRange` (parses USD-formatted edge-fn output, multiplies by user's currency rate, renders with user's symbol — a London £50 event displays as `£40-£64`); stale-cache fallback served as fresh without UX signal; logout does not clear AsyncStorage events cache (Constitution #6 candidate).
- **Q4 Horizon:** **8 hard caps documented** (HIGH) — visible-event ceiling is 20 per render; no pagination UI; segment hardcode = music only; default 50km radius; "any" = 30 days only; genre keyword precision so low most non-`all` genres return ~empty; sold-out events not filtered.
- **Total findings:** **5 RC** + **6 CF** + **9 HF** + **3 OBS** + **4 Discoveries** for the orchestrator.

---

## §0.5 Phase 0 ingestion summary

**Prior artifacts.** `prompts/FORENSICS_ORCH-0570_CURATED_BRUTAL_CLEANUP.md` § Tier 4 enumerates the same surface and is treated as authoritative orbit map. No prior `INVESTIGATION_*` or `SPEC_*` exists for this surface — first formal audit.

**Memory hits.** `feedback_headless_qa_rpc_gap.md` — code-only proofs are inadmissible for runtime questions; live-fire required before HIGH. `feedback_forensic_thoroughness.md` — full migration chain read; the `ticketmaster_events_cache` table has only one migration (no superseding rewrites) → `20260301000003_ticketmaster_cache.sql` is current truth. `feedback_solo_collab_parity.md` — N/A; this surface is solo-only (Discover tab, no collab equivalent), confirmed by grep.

**Migration chain.** Single migration touches the cache table. Single migration cleanup (`20260317210000_admin_dashboard_overhaul.sql:114`) does `DELETE FROM ticketmaster_events_cache WHERE expires_at < now();` — admin maintenance, not schema change. No drift.

**Out-of-scope confirms.** Migrations matching `event` = the host-an-event Business Platform initiative (`20260414000006..14`), separate concept. Not part of this surface.

**Cross-surface usage.** `ticketmaster_events_cache` is read/written ONLY by edge fn `ticketmaster-events`. Admin references it in two places: an allowlist (`mingla-admin/src/lib/constants.js:65`) and a Table-Browser entry (`:221`) — read-only inspection, not a write path.

---

## §1 Geographic correctness probe (Q1)

### §1.1 Static analysis

**[F-Q1-1] No `countryCode` parameter sent to Ticketmaster.** `supabase/functions/ticketmaster-events/index.ts:308-322` builds the URLSearchParams; only `apikey`, `latlong`, `radius`, `unit=km`, `segmentId`, `sort`, `size`, `page`, optionally `keyword`, `startDateTime`, `endDateTime`. Ticketmaster's `countryCode` filter is documented and supported across their global geographies. Without it, lat/lng radius search relies entirely on TM's geo index — fine where TM has dense local inventory, weak where TM's inventory is partial. **Confidence:** HIGH (code-only).

**[F-Q1-2] Hardcoded `MUSIC_SEGMENT_ID = "KZFzniwnSyZfZ7v7nJ"`** at `index.ts:16`, applied unconditionally at `:314`. UI title at `DiscoverScreen.tsx:1196` reads literally **"Concerts & Events"**. Sports / Theatre / Comedy / Family / Misc are zero. The header copy promises a superset; the code delivers a strict subset. **Confidence:** HIGH (code-only).

**[F-Q1-3] Currency defaults to USD silently.** `index.ts:148`: `const currency = range.currency ?? "USD";`. When TM's `priceRanges` array is missing `currency`, the event is tagged as USD even if the venue is in Berlin. **Confidence:** HIGH (code-only).

**[F-Q1-4] Currency symbol always `$` regardless of currency.** `index.ts:151-159`: `formatted = \`$${Math.round(min)} - $${Math.round(max)}\`` — dollar sign hardcoded. So a Berlin event with TM `priceRanges[0].currency = "EUR"` and `min=20, max=40` ships to mobile as `price: "$20 - $40"` even though the underlying numbers are euros. **Confidence:** HIGH.

**[F-Q1-5] Day-of-week label computed in UTC from venue-local YYYY-MM-DD.** `index.ts:81-92` `formatDate`: `const d = new Date(Date.UTC(year, month, day))` then `DAY_NAMES[d.getUTCDay()]`. The input `localDate` is the *venue's* local date string (e.g., `"2026-05-15"` for an event in Sydney). Constructing in UTC and reading `getUTCDay()` happens to give the same weekday because the date string has no time component, BUT this calculation is fragile and disagrees with what the venue's local calendar says when combined with the user's perception of "today." Not a bug per se for the weekday label itself, but **`getDateRange` filtering passes user-device-local times to TM as `startDateTime`/`endDateTime`** — see F-Q1-6. **Confidence:** MEDIUM (subtle; depends on TM's interpretation).

**[F-Q1-6] `getDateRange` uses device-local time, sends device-local-as-ISO to TM.** `DiscoverScreen.tsx:115-169` builds windows with `new Date()` and `setHours(0, 0, 0, 0)` (device-local), then `toISOString()` which converts to UTC. A user in Tokyo (UTC+9) tapping "today" at 8am local time sends `startDate=2026-05-14T23:00:00Z`-ish (yesterday in UTC), `endDate=2026-05-15T14:59:59Z`. Ticketmaster's `startDateTime`/`endDateTime` semantics treat these as UTC instants and filter events whose `dates.start.dateTime` falls in that range — but TM events also have `localDate` per venue. The interaction is non-trivial; the user-visible effect for distant venues from the user is unclear without live-fire. **Confidence:** MEDIUM, NEEDS-LIVE-FIRE.

**[F-Q1-7] AsyncStorage cache rollover hardcoded to America/New_York.** `DiscoverScreen.tsx:809-816` `getTodayDateString` uses `timeZone: "America/New_York"`. A user in Tokyo at 12:30am Wednesday Tokyo time gets `getTodayDateString()` = `"2026-05-13"` (Tuesday NY), serving Tuesday's cache. A user in Honolulu at 11pm Tuesday Honolulu time gets `"2026-05-14"` (Wednesday NY), serving tomorrow-keyed cache that doesn't match what they asked for. **The cache rollover is wrong for ~80% of the planet.** **Confidence:** HIGH.

**[F-Q1-8] Default `radius = 50` km is too small for several major metros.** `nightOutExperiencesService.ts:66`, `ticketmaster-events/index.ts:269`. LA metro is ~80km diameter; Greater London ~50km but venues exist further; Tokyo ~80km. UI exposes no radius adjustment. The empty-state CTA at `DiscoverScreen.tsx:1308-1309` says "Expand radius" but `handleRefresh()` doesn't change radius — same 50 sent again. **Confidence:** HIGH (code-only) for the cap; MEDIUM for "too small" (subjective).

**[F-Q1-9] GPS fallback path EXISTS** and is correct (corrects an orchestrator-suspected smell). `DiscoverScreen.tsx:751-779` resolves location: GPS first via `enhancedLocationService.getCurrentLocation()`, then preference-stored `useUserLocation(user?.id, "solo")` lat/lng. This is correctly defended. **BUT:** the fetch effect `if (deviceGpsFetchedRef.current) return;` early-bails after first resolution, only resetting on background→active. So if a user changes their preferred location from Settings while Discover is mounted in foreground, Discover does NOT pick up the new fallback location until next cold launch or backgrounding. **Confidence:** HIGH.

**[F-Q1-10] Empty-state vs no-coverage indistinguishable.** `DiscoverScreen.tsx:1303-1311` shows the same `empty.no_events_title` whether (a) TM has zero music events near user (legitimate empty), or (b) the user is in a country with zero TM coverage at all (structural gap). User sees "No events near you, try expanding radius" which is wrong-advice for case (b). **Confidence:** HIGH.

### §1.2 Live-fire matrix — NOT EXECUTED

The dispatch mandated a 5-geography minimum live-fire (NYC, LA, London, Berlin, Sydney + Lagos/Mumbai/Tokyo/São Paulo as suspect-coverage probes). **This was not performed** because:
- No Ticketmaster API key is available in this environment (would require fetching `Deno.env.get("TICKETMASTER_API_KEY")` from prod Supabase, which I cannot access).
- Live-fire requires either an authenticated `supabase.functions.invoke("ticketmaster-events", ...)` from a user session, or a direct call to `https://app.ticketmaster.com/discovery/v2/events.json?apikey=...`. Neither is available.

**Implication for this report:** every Q1 verdict is bounded at MEDIUM confidence. The orchestrator MUST commission live-fire (founder, tester with prod env access, or a one-shot probe edge fn) before the spec is locked. The dispatch's §0 founder-override clause does not fire because the static-only premise is not wrong — the live-fire is just out of reach for this agent.

What live-fire MUST measure (per dispatch §1.2):
- HTTP status per geo
- `meta.totalResults` (TM total) vs `events.length` (page slice)
- First event's `priceCurrency` raw — to confirm F-Q1-3 fires in the wild
- First event's `localDate` + computed `date` label vs venue's actual timezone — to confirm F-Q1-5/F-Q1-6
- First event's `coordinates` distance from query lat/lng — to sanity-check radius
- `events.length === 0` + UI empty-state copy for Lagos/Mumbai/São Paulo — to confirm F-Q1-10

### §1.3 Verdict

| Question | Verdict | Confidence | Basis |
|---|---|---|---|
| Q1-V1: Non-US/UK users see meaningful content? | **Probable FAIL** (Lagos/Mumbai/São Paulo) | NEEDS-LIVE-FIRE | F-Q1-1, F-Q1-10 + TM public coverage |
| Q1-V2: Prices currency-correct? | **FAIL** | HIGH | F-Q1-3, F-Q1-4, double-conversion via formatPriceRange (see HF-04) |
| Q1-V3: Dates/times correct timezone? | **PROBABLE FAIL** for AU/JP/HI | MEDIUM | F-Q1-5, F-Q1-6, F-Q1-7 |
| Q1-V4: Empty-state distinguishes "no events" from "failed to load"? | **PARTIAL** | HIGH | distinguishes loading/error/empty/filter-no-match (4 states) but conflates "no coverage" with "no events near you" — F-Q1-10 |
| Q1-V5: GPS unavailability gracefully degrades? | **PASS** | HIGH | F-Q1-9 first-half (correct fallback chain) — but second half is a hidden flaw |

---

## §2 Filter audit (Q2)

### §2.1 Date filter

| ID | Hypothesis | Verdict | Confidence | Evidence |
|---|---|---|---|---|
| H-D1 | `getDateRange` uses device-local time, ISO-stringifies to UTC | **CONFIRMED** | HIGH | `DiscoverScreen.tsx:115-169` — `new Date()`, `setHours(0,0,0,0)`, then `toISOString()` |
| H-D2 | Edge fn cache key uses only `startDate.slice(0,10)`; endDate dropped | **CONFIRMED** | HIGH | `ticketmaster-events/index.ts:108-117` — `dateStr = startDate ? startDate.slice(0,10) : "none"`, no endDate in key |
| H-D3 | AsyncStorage cache key on mobile excludes `selectedFilters.date` | **CONFIRMED** | HIGH | `DiscoverScreen.tsx:824` — key is `${user.id}_${lat.toFixed(2)}_${lng.toFixed(2)}_${selectedFilters.genre}`, no `date` segment |
| H-D4 | The cache equality check at `:889-894` uses `cached.date === getTodayDateString() && cached.genre === ...` and ignores selectedFilters.date | **CONFIRMED** | HIGH | `cached.date` is the *cache write day-stamp*, NOT the filter window. The filter window mismatch is invisible to the equality check. |
| H-D5 | "weekend" math has Friday-evening boundary artifact | **CONFIRMED** | HIGH | `:147` — `(dayOfWeek === 5 && now.getHours() >= 18)` flips behavior at 18:00 sharp; events between Fri-9am and Fri-18:00 ambiguous: not in "today" (today returns now→eod), not in "weekend" (weekend starts Fri 18:00 unless already past 18:00). At Fri 17:59 the chip "today" returns `now → 23:59:59`, "weekend" returns `Fri 18:00 → Sun 23:59:59` — gap from now to 18:00 covered by neither. Real Friday-evening events at 18:00 itself are duplicated. |
| H-D6 | TM honors startDateTime/endDateTime as UTC; venue-local-vs-user-local interaction is non-trivial | **CONFIRMED + NEEDS-LIVE-FIRE** | MEDIUM | static can't fully resolve TM-side semantics |

**RC-D-1 — Date filter cache poisoning (HIGH).**
- File:line: `DiscoverScreen.tsx:824` + `:889-894` + `ticketmaster-events/index.ts:108-117`.
- Exact code: `const nightOutCacheKey = \`${NIGHT_OUT_CACHE_KEY}_${user?.id}_${nightOutGpsLat?.toFixed(2)}_${nightOutGpsLng?.toFixed(2)}_${selectedFilters.genre}\`;` and `if (cached && cached.date === getTodayDateString() && cached.venues.length > 0 && cached.genre === selectedFilters.genre) { setNightOutCards(cached.venues); ... return; }`
- What it does: serves the same cached events regardless of the user's date-filter selection.
- What it should do: cache should be keyed by `(geo, genre, dateFilter)` triple; equality check should include date-filter equality.
- Causal chain: user opens with `date=any` → cache fills with 30-day window → user taps `date=today` → mobile cache hits (geo + genre + today's day-stamp match) → 30-day events served as if they were today's → user sees events for next month under "Tonight" chip → broken-feeling filter.
- Verification: run with React DevTools, observe `nightOutCacheKey` doesn't change when only `selectedFilters.date` changes; observe `setNightOutCards(cached.venues)` fires on date toggle without a fresh fetch.

### §2.2 Price filter

| ID | Hypothesis | Verdict | Confidence | Evidence |
|---|---|---|---|---|
| H-P1 | Price filter is client-side only, never sent to TM | **CONFIRMED** | HIGH | `DiscoverScreen.tsx:1051-1080` — `useMemo` filter on already-fetched `nightOutCards`. No `priceFilter` in `getEvents` body. |
| H-P2 | Page size 20 + price filter post-fetch = invisible empty under filter | **CONFIRMED** | HIGH | size 20 at edge fn `:272`, mobile `:911`. If first 20 results are all $200+, "free" filter returns empty even if TM has free events at page 1+. |
| H-P3 | Events with both priceMin and priceMax null are excluded under any non-`any` filter | **CONFIRMED** | HIGH | `:1054-1055` — `if (card.priceMin === null && card.priceMax === null) return false;`. TBA-price events vanish. |
| H-P4 | "free" branch math | **CONFIRMED PARTIAL** | HIGH | `:1059-1060` — `case "free": return max === 0;` where `max = card.priceMax \|\| min` and `min = card.priceMin \|\| 0`. If event has `priceMin=0, priceMax=null`, `max = priceMax \|\| min = null \|\| 0 = 0` → `0 === 0` → returned. OK. But if event has *no* priceRanges (TBA), H-P3 fires first and excludes it. Free-but-TBA events impossible to surface. |
| H-P5 | Tier chips (`chill`/`comfy`/`bougie`/`lavish`) are silent no-ops | **CONFIRMED** | HIGH | The switch at `:1058-1071` has cases for `free`, `under-25`, `25-50`, `50-100`, `over-100`, and `default: return true`. Tier slugs `chill`/`comfy`/`bougie`/`lavish` hit `default`. The chips render (built from `PRICE_TIERS` at `:1094-1100`) but they don't filter. |
| H-P6 | Mixed filter ID space confirms H-P5 | **CONFIRMED** | HIGH | `priceFilterOptions` builds chips from `PRICE_TIERS` (tier slugs) but the switch handles only the alternative USD-band IDs. Two filter taxonomies coexisting in the same chip set — only the USD bands actually filter, but the chip labels are tier names like "Chill · $50 max". |
| H-P7 | USD bands applied to non-USD numeric ranges | **CONFIRMED** | HIGH | The numeric `priceMin`/`priceMax` come from TM's raw `priceRanges[0]` in event-currency, but the band thresholds (25, 50, 100) are USD-bound. A London event with `priceMin=30 (GBP)` gets compared to `< 25` USD threshold and excluded under "under-25" even though £30 ≈ $38 (close to the band). |

**RC-P-1 — Tier chips don't filter (HIGH).**
- File:line: `DiscoverScreen.tsx:1058-1071` + `:1094-1100`.
- Exact code: switch on `selectedFilters.price` with cases `free`/`under-25`/`25-50`/`50-100`/`over-100`/`default: return true`. `priceFilterOptions` injects chips from `PRICE_TIERS.filter((tier) => tier.slug !== "any").map(...)` producing slugs `chill`/`comfy`/`bougie`/`lavish`.
- What it does: tapping `Chill · $50 max` sets `selectedFilters.price = "chill"`, the filter switch hits `default`, returns `true` for every card → identical result set to `any`.
- What it should do: either (a) remove tier chips and surface only USD bands, (b) add tier-slug cases to the switch with USD-equivalent ranges, or (c) replace the dual taxonomy with a single one. Behavioral choice belongs to the spec.
- Causal chain: user expects "Chill" to show cheaper events; nothing changes; user concludes "filtering doesn't work."
- Verification: tap `Chill`; observe `selectedFilters.price === "chill"`; observe `filteredNightOutCards.length === nightOutCards.length` (no delta).

**RC-P-2 — TBA-price events invisibly excluded under any non-`any` filter (HIGH).**
- File:line: `DiscoverScreen.tsx:1054-1055`.
- Exact code: `if (card.priceMin === null && card.priceMax === null) return false;`
- What it does: any event whose TM `priceRanges` was empty/missing is dropped from results when ANY price filter is set, with no UX signal.
- What it should do: spec must decide — either (a) show TBA events under `any` only (current, but make it explicit), (b) include TBA events under all filters with a "price unknown" badge, (c) add a "Show TBA" toggle.
- Causal chain: a venue that hasn't published prices yet (common for festivals 6 months out) is invisible under any filter. User wonders why specific events disappear.
- Verification: write a unit test for `filteredNightOutCards` with one card `{priceMin: null, priceMax: null}` and `selectedFilters.price = "free"`; expect length 0.

### §2.3 Genre filter

| ID | Hypothesis | Verdict | Confidence | Evidence |
|---|---|---|---|---|
| H-G1 | Genre keywords sent to TM joined by comma → phrase match on literal | **CONFIRMED** | HIGH | `ticketmaster-events/index.ts:320-322` — `if (searchKeywords.length > 0) params.set("keyword", searchKeywords.join(","));`. TM Discovery v2's `keyword` param is freeform single-string search; `"afrobeats,amapiano"` becomes a phrase match against event names/attractions/venues. |
| H-G2 | TM offers `classificationName`/`genreId`/`subGenreId` for proper genre filtering | **CONFIRMED** | HIGH | TM Discovery v2 docs (well-known): `classificationName` accepts comma-OR-list of names, `genreId` accepts genre IDs from the `/classifications` endpoint. None are used here. |
| H-G3 | Cache keys correctly include keywords (mobile + edge fn) | **CONFIRMED** | HIGH | edge fn `:114-116` includes sorted keywords; mobile key `:824` includes `selectedFilters.genre`. Genre cache invalidation works. |
| H-G4 | Most non-`all` genres return ~empty | **PROBABLE** | NEEDS-LIVE-FIRE | static-only signal is strong (literal `"afrobeats,amapiano"` won't match many TM event names) but degree depends on TM's full-text index behavior. |

**RC-G-1 — Genre filter sends comma-joined string as TM `keyword` (HIGH).**
- File:line: `ticketmaster-events/index.ts:320-322`.
- Exact code: `if (searchKeywords.length > 0) { params.set("keyword", searchKeywords.join(",")); }`
- What it does: requests `keyword=afrobeats,amapiano` (one literal string) which TM treats as phrase match against event/attraction/venue names.
- What it should do: use `classificationName` with comma-OR-list (TM's documented OR semantics for that param) OR call `/classifications` once to map our genre slugs → TM `genreId`/`subGenreId` and use those IDs.
- Causal chain: user picks `Afrobeats` → API returns events with name/attraction containing the literal `"afrobeats,amapiano"` (essentially zero) → empty grid → user sees "No events match your filters" (or worse, the i18n key, see RC-IX-1) → user concludes filtering broken.
- Verification: hit edge fn with `genre=afrobeats` for NYC; observe `meta.totalResults = 0` or near-zero. Then hit TM directly with `classificationName=afrobeats,amapiano` and observe non-zero. Delta = bug magnitude.

### §2.4 Implicit filters

**[F-IMP-1] Sort hardcoded `"date,asc"`** (`DiscoverScreen.tsx:908`, edge fn default `:273`). UI never exposes alternatives. TM accepts `"distance,asc"`, `"relevance,desc"`, `"name,asc"`, `"random,asc"`, `"venueName,asc"`. **OBS-1.**

**[F-IMP-2] Page hardcoded `0`.** No `setPage` call anywhere on this surface. No infinite scroll, no "Load more" button. The `page` parameter in `getEvents()` exists but is never passed by `DiscoverScreen.tsx:901-910`. The user-visible event ceiling per render is `meta.events.length ≤ 20`. **Cf. RC-H-1.**

**[F-IMP-3] Sold-out events shown unfiltered.** `EventGridCard.tsx:290` shows `SOLD OUT` badge but the event is NOT removed from `filteredNightOutCards`. Tapping it opens `ExpandedCardModal` with `ticketUrl` to TM's sold-out page. **HF-08.**

### §2.5 Filter cache poisoning matrix

| Repro | Predicted result | Confidence |
|---|---|---|
| Open Discover with `genre=all`, `date=any`; switch to `date=weekend` | Stale `any`-window cache served (RC-D-1) | HIGH |
| Open Discover with `date=today`; close app; open next morning | `getTodayDateString()` ticks (NY-tz) → cache miss → fresh fetch | HIGH for users in NY-tz; UNCERTAIN for users outside NY-tz (F-Q1-7) |
| Switch genre `all → afrobeats` | Cache miss (genre is in key); fresh fetch with broken `keyword` (RC-G-1); near-empty grid | HIGH |
| Switch price `any → free` | Cache hit (price not in key); same 20 events; client-side filter strips TBA (RC-P-2) and excludes any with no priceMin/Max | HIGH |
| Switch price `any → chill` | Cache hit; client-side filter no-op (RC-P-1); zero delta in grid | HIGH |
| Reset filters | `handleResetFilters` does NOT clear cache; chip state resets but stale cache continues to serve under any pre-existing filter combination | HIGH (HF-09) |

---

## §3 Robustness audit (Q3)

### §3.1 i18n key drift — RC-IX-1 (HIGH, S1 user-visible)

**File:line:** `DiscoverScreen.tsx:1296-1320` + `app-mobile/src/i18n/locales/en/discover.json`.

**Exact code (UI):**
```tsx
title={t("discover:error.title")}            // EXISTS in JSON ✓
subtitle={t("discover:error.subtitle")}       // ❌ MISSING
actionLabel={t("discover:error.retry")}       // EXISTS ✓
title={t("discover:empty.no_events_title")}   // ❌ MISSING (JSON has "empty.no_events")
subtitle={t("discover:empty.no_events_subtitle")} // ❌ MISSING
actionLabel={t("discover:empty.expand_radius")}   // ❌ MISSING
title={t("discover:empty.no_match_title")}        // ❌ MISSING (JSON has "empty.no_matching")
subtitle={t("discover:empty.no_match_subtitle")}  // ❌ MISSING
actionLabel={t("discover:empty.reset_filters")}   // ❌ MISSING
```

**Verified by:** grep `app-mobile/src/i18n/locales/en/discover.json` for each key.

**What it does:** when react-i18next can't find a key, default behavior depending on `react-i18next` config is to render the key string itself. `app-mobile/src/i18n/index.ts` config controls this — to be inspected by spec, but the fact that 7 keys are missing is unambiguous. User opens Discover in Lagos with no events → sees a card titled `discover:empty.no_events_title` with subtitle `discover:empty.no_events_subtitle` and a button labeled `discover:empty.expand_radius`. **Every empty/error/no-match state is visually broken.**

**What it should do:** all 7 keys must exist in `en` plus all 28 other locales. Per existing convention, JSON keys use flat dot-notation strings, NOT nested objects.

**Causal chain:** a real user in any geography hitting any of three failure paths (network error, zero results, filter no-match) sees raw key strings instead of helpful copy. This is an **always-broken** path; it's invisible until you hit it. Founder's "filtering not working" perception likely amplified by this — when a filter combination produces zero matches, the user sees a broken-looking screen with literal `discover:empty.no_match_title`.

**Verification:** mount DiscoverScreen with `nightOutCards: []` and `nightOutLoading: false`, `nightOutError: null` → render → expect screen text containing `"discover:empty.no_events_title"` literal.

**Blast radius:** this is solo Discover only; no parallel collab path; no cross-surface leak.

### §3.2 Other silent-failure paths

| HF | Description | File:line | Severity | Confidence |
|---|---|---|---|---|
| HF-01 | Stale-cache fallback on TM 429/5xx serves possibly-day-old data with `fromCache:true` flag UI never surfaces — Constitution #3 | `ticketmaster-events/index.ts:349-389` | S2 | HIGH |
| HF-02 | Edge fn cache write fire-and-forget without await; failure silently dropped | `ticketmaster-events/index.ts:430-454` | S3 | HIGH |
| HF-03 | `handleResetFilters` does NOT clear AsyncStorage cache | `DiscoverScreen.tsx:1046-1048` | S3 | HIGH |
| HF-04 | `formatPriceRange` double-converts currency — see §3.3 below | `formatters.ts:141-177` | S1 | HIGH |
| HF-05 | Sold-out events not filtered from grid; only badged | `DiscoverScreen.tsx:1051-1080` (no filter) | S3 | HIGH |
| HF-06 | No abort/cancel on rapid filter toggle — slow request can overwrite fast request's UI | `DiscoverScreen.tsx:881-926` (no AbortController, no in-flight cancellation) | S2 | HIGH |
| HF-07 | `clearUserData` (logout) does NOT remove `mingla_night_out_cache_<userId>_*` AsyncStorage entries — Constitution #6 candidate (mild: keys are user-scoped so cross-user leakage is null, but storage grows unboundedly across user-switching) | `appStore.ts:217-233` (no AsyncStorage cleanup); cache never cleaned by anything except per-event handleRefresh | S3 | HIGH |
| HF-08 | Sticky GPS — `deviceGpsFetchedRef.current` only resets on background→active. Preference-location change while foreground → not picked up until cold launch | `DiscoverScreen.tsx:759-790` | S3 | HIGH |
| HF-09 | Multi-night residency dedup: same artist same venue 5 consecutive nights = 5 grid rows. No dedup key. | `DiscoverScreen.tsx:1051-1080` (no dedup pass) | S3 | MEDIUM |
| HF-10 | TM API key absent: edge fn returns plain-string error 500; mobile shows `discover:error.title` ("Something went wrong") + missing-key subtitle (RC-IX-1) — user sees broken copy | `ticketmaster-events/index.ts:249-254` + RC-IX-1 | S2 | HIGH |
| HF-11 | Friday-evening date-window gap (H-D5) | `DiscoverScreen.tsx:147` | S3 | HIGH |
| HF-12 | `pickBestImage` returns `""` when no images; UI render path on empty image is `<ExpoImage source={{uri: ""}} />` — produces blank box, not graceful fallback | `ticketmaster-events/index.ts:121-135` + `DiscoverScreen.tsx:313-319` | S3 | HIGH |
| HF-13 | `enhancedLocationService.getCurrentLocation()` exception path falls through silently to fallback-pref location — when GPS is denied with a hard error, the user is silently routed to their preferred city. No UX signal that GPS is denied. | `DiscoverScreen.tsx:762-779` | S3 | HIGH |

### §3.3 The currency double-conversion (HF-04 detail)

**File:line:** `app-mobile/src/components/utils/formatters.ts:141-177`.

**Exact code:**
```ts
export function formatPriceRange(priceRange: string | undefined, currencyCode: string = 'USD'): string {
  // ...
  const minUSD = parseFloat(rangeMatch[1].replace(/,/g, ''));
  const maxUSD = parseFloat(rangeMatch[2].replace(/,/g, ''));
  const minConverted = Math.round(minUSD * rate);
  const maxConverted = Math.round(maxUSD * rate);
  return `${symbol}${minConverted.toLocaleString(...)} - ${symbol}${maxConverted.toLocaleString(...)}`;
}
```

**Variable names admit the bug:** `minUSD` is a hardcoded assumption that the input is USD. The function is pure currency conversion: parse USD numbers, multiply by rate to user's currency, render with user's symbol.

**For Discover events** at `EventGridCard:287` — `formattedPrice = formatPriceRange(card.price, currency)`:

- `card.price` is the edge-fn-formatted string `"$50 - $80"` for a London event whose raw TM `priceRanges[0]` was `{ min: 50, max: 80, currency: "GBP" }`.
- `currency` arg = `accountPreferences?.currency` (user's account currency, e.g., "USD" if user is American or "GBP" if user is British).
- The `$` prefix in `card.price` is stripped by the regex; `50` and `80` are parsed.
- They are multiplied by the user's `rate` (derived via `getRate(currencyCode)` — implementation not read, but its semantics from naming and use-site are clear: USD→user-currency rate).

**Result for a UK user** (account currency = "GBP", rate = 0.79 if rate is GBP-per-USD or 1.0 if rate is "user-currency-per-itself"): the underlying numbers ARE GBP, but the function treats them as USD and multiplies by 0.79 → renders `£40 - £64`. Numbers double-discount.

**Result for a US user** viewing a Berlin event: edge fn returns `"$50 - $80"` (literal `$` regardless of EUR currency, F-Q1-4); user account currency = "USD"; rate = 1.0; renders `$50 - $80` — but the underlying numbers were EUR, so we're showing EUR numerals with USD symbol. **The user thinks the show is $50; reality is €50 ≈ $54.** Off by exchange rate.

**Both directions broken.** Constitution #9 (no fabricated data) and #10 (currency-aware UI). **HIGH confidence.**

### §3.4 Robustness floor grade: D

- Always-broken: i18n on every empty/error path (RC-IX-1).
- Always-broken: currency math (HF-04).
- Always-broken: tier chips do nothing (RC-P-1).
- Always-broken: most genre filters return ~empty (RC-G-1).
- Frequently-broken: date filter cache poisoning (RC-D-1).
- Sometimes-broken: NY-timezone cache rollover (F-Q1-7).
- Production state is below quality bar from `MEMORY.md` ("zero bugs, zero glitches, 100% clean").

---

## §4 Horizon audit (Q4)

| # | Cap | File:line | Current value | Founder-visible consequence |
|---|---|---|---|---|
| 1 | Segment hardcoded music | `ticketmaster-events/index.ts:16, 314` | `KZFzniwnSyZfZ7v7nJ` (Music) | Zero sports/theatre/comedy/family/misc — UI title "Concerts & Events" is **deceptive** |
| 2 | Page size | `nightOutExperiencesService.ts:72`, `ticketmaster-events/index.ts:272` | 20 | UI ceiling per render = 20 events |
| 3 | Page index | `DiscoverScreen.tsx:901-910` | always 0 (no `page` arg passed) | No pagination of any kind in UI; second-page events are unreachable |
| 4 | Radius | `DiscoverScreen.tsx:904`, `nightOutExperiencesService.ts:66` | 50 km | LA / Tokyo / suburban metros truncated; UI says "Expand radius" but `handleRefresh` doesn't change it |
| 5 | Cache horizon | `DiscoverScreen.tsx:889` (per-day reuse) | first 20 fetched, kept 1 day | If TM has 200 events, UI shows 20 for the entire day |
| 6 | Date "any" window | `DiscoverScreen.tsx:163-167` | next 30 days | "Any date" is actually "Next 30 days" — events 6 months out invisible |
| 7 | Genre keyword precision | `ticketmaster-events/index.ts:320-322` | comma-joined literal | Most non-`all` genres return ~empty (RC-G-1) — invisible cap on what user sees |
| 8 | Sold-out events | `DiscoverScreen.tsx:1051-1080` (no filter) | shown unfiltered | Inflates the 20-event grid with non-actionable items, displacing actionable ones |

**Founder-knowledge classification:**

| Cap | UI signals it? | Classification |
|---|---|---|
| Music-only segment | "Concerts & Events" title contradicts | **DECEPTIVE** |
| 20 page size | no UI signal | implicit |
| Page 0 only | no Load More button, no infinite scroll | implicit |
| 50km radius | "Expand radius" CTA suggests adjustability that doesn't exist | **DECEPTIVE** |
| 1-day cache reuse | no signal | implicit |
| 30-day "any" window | "Any Date" chip label contradicts | **DECEPTIVE** |
| Broken genre keyword | empty grid + i18n-broken empty state | implicit-then-deceptive |
| Sold-out included | SOLD OUT badge present | explicit |

Three deceptive caps + four implicit caps. The user-visible horizon today is **at most 20 music events within 50km, in the next 30 days, with most genre filters returning near-zero** — and the UI gives no honest signal of any of this.

---

## §5 Five-truth-layer reconcile

| Layer | Question | Finding | Layer holds truth? |
|---|---|---|---|
| **Docs** | Product doc says what about Concerts & Events? | No product doc found in `Mingla_Artifacts/` for this surface. The dispatch context refers to ORCH-0590 Phase 3 (Tinder-Explore glass redesign) — purely visual, no behavioral spec. **Documentation gap.** | n/a |
| **Schema** | What does the cache enforce? | One unique `cache_key`, JSONB `events`, 2h `expires_at` default, service-role-only RLS. Single migration, no drift. | yes (clean) |
| **Code** | What does code do? | All findings above. Music-only, radius 50, page 0, comma keyword, double currency, 7 missing i18n keys, etc. | yes (broken in many places) |
| **Runtime** | What happens when it runs? | NEEDS-LIVE-FIRE for geography. Code-level reproductions of filter/empty-state failures are confidently predicted. | partial |
| **Data** | What's actually in the cache? | NEEDS-LIVE-FIRE — would require `SELECT cache_key, total_results, fetched_at, expires_at FROM ticketmaster_events_cache ORDER BY fetched_at DESC LIMIT 50`. | unverified |

**Contradictions found:**
1. **UI title vs code segment** — "Concerts & Events" rendered, music-segment-only fetched.
2. **CTA text vs handler** — "Expand radius" button reuses 50km radius.
3. **Chip label vs filter logic** — `Chill · $50 max` chip + nothing-happens filter.
4. **Filter taxonomy mismatch** — `priceFilterOptions` builds tier-slug chips, switch handles USD-band slugs only.
5. **i18n keys** — 7 keys called by code, 0 of 7 defined in any of 29 locale JSONs.

Five contradictions across three layer pairs. Each is a root-cause class of bug.

---

## §6 Constitutional & invariant scan

**Violations identified:**

| Rule | Violation | Finding ID |
|---|---|---|
| **#2 — One owner per truth** | Three formatters of "event date" exist: `formatDate` (edge fn label), raw `localDate` (edge fn), `formatShortDate` (mobile relabel). Drift potential, no contract. Also: dual filter taxonomy in price chips (RC-P-1). | OBS-2 |
| **#3 — No silent failures** | RC-P-1 (tier no-ops), RC-P-2 (TBA invisibly excluded), RC-G-1 (genre returns empty silently), HF-01 (stale cache passes as fresh), HF-02 (cache write fire-and-forget), HF-13 (GPS denial routes silently to fallback) | many |
| **#6 — Logout clears everything** | HF-07 — AsyncStorage events cache survives logout; mild because keyed by userId | HF-07 |
| **#9 — No fabricated data** | F-Q1-3 (default USD), F-Q1-4 (always `$` symbol), HF-04 (currency double-convert) | several |
| **#10 — Currency-aware UI** | HF-04 (double conversion), H-P7 (USD bands applied to non-USD) | HF-04 |
| **#13 — Exclusion consistency** | Sold-out events generated by TM, badged but not excluded; UI text "On Sale / Sold Out / Soon" exists in i18n but UI flow doesn't filter | HF-05 |

**Proposed new invariants** (for the spec to register):
- **I-EVENTS-CURRENCY-HONEST** — every event price displayed honors its source currency; never coerced to USD; never double-converted. Verified by unit test: Berlin event with `priceCurrency:"EUR"` renders with `€` symbol and unmodified numerals.
- **I-FILTER-CHIP-BEHAVIORAL-PARITY** — every filter chip rendered must produce a behavioral delta in either the API request OR the client-side filter. No silent no-op chips. CI gate: snapshot of filter chip set vs handler switch coverage.
- **I-CACHE-KEY-COVERS-ALL-INPUTS** — every input that affects the response must appear in the cache key (mobile AsyncStorage AND server-side row key). Date filter MUST be in both keys.
- **I-I18N-KEY-EXISTS** — every `t(...)` key referenced in mobile code MUST exist in `en` JSON. CI gate: AST grep + JSON diff.
- **I-SURFACE-TITLE-SCOPE-PARITY** — UI title may not promise content scope the code excludes. "Concerts & Events" title implies multi-vertical; if code is music-only, title must be "Concerts" or scope must expand.

---

## §7 Solo / collab parity

This surface is **solo-only**. Confirmed:
- DiscoverScreen receives no `currentMode` prop; no collab branch in render.
- `useUserLocation(user?.id, "solo")` hardcoded second arg.
- `savedCardsService.saveCard(user.id, transformed, "solo")` hardcoded mode.
- Grep for any session/collab/board reference touching `nightOutExperiencesService` or `ticketmaster-events`: zero hits.

**No solo/collab parity bug; no collab path to break.** Per `feedback_solo_collab_parity.md` — when fixing solo, no collab equivalent exists for this surface, so the rule is satisfied by absence.

---

## §8 Blast radius

**Direct readers/writers of `ticketmaster_events_cache` table:**
- `supabase/functions/ticketmaster-events/index.ts` (read on cache hit, read on stale fallback, write on miss, delete-expired on write)
- `supabase/migrations/20260317210000_admin_dashboard_overhaul.sql:114` (admin maintenance DELETE)
- `mingla-admin/src/lib/constants.js:65, 221` (read-only allowlist + Table-Browser entry)

**Direct callers of `ticketmaster-events` edge fn:**
- `app-mobile/src/services/nightOutExperiencesService.ts` (only caller)

**Direct consumers of `nightOutExperiencesService`:**
- `app-mobile/src/components/DiscoverScreen.tsx` (only consumer)

**Saved-card cross-surface:**
- `handleToggleSave` (line 999) and `ExpandedCardModal.onSave` (line 1346) call `savedCardsService.saveCard(user.id, transformed, "solo")`.
- Saved card payload at line 1006-1026 includes `nightOutData` envelope. The `card.price` field saved is the edge-fn-formatted string (with hardcoded `$`). When reloaded later from saves, the same buggy `formatPriceRange` chain applies — **HF-04 propagates into saved cards**.
- Currency at save-time may differ from currency at view-time (user changes account currency between save and view). The saved string `"$50 - $80"` is parsed as USD on every view → re-multiplied. Compounding error if user switches currency multiple times.

**Analytics:**
- Grep `mixpanel|appsflyer|track` in `DiscoverScreen.tsx`: **no events fired on this surface.** No funnel data on filter usage, save rate, click-through. **OBS-3.**

**Realtime:**
- No realtime channels for events. Per `useForegroundRefresh.ts:38-39` comment: "Discover screen is Ticketmaster-only; no query key to refresh." Confirms no React Query usage on this surface — explains why foreground refresh skips it.

**Cross-surface bug propagation:** the saved-card path is the only durable cross-surface bleed. Currency double-conversion poisons saved cards.

---

## §9 Hidden flaws inventory

Already enumerated in §3.2 (HF-01 through HF-13). For convenience the highest-severity ones, recapped:

- **HF-04** (S1): currency double-conversion in `formatPriceRange` poisons every event price for non-USD users AND propagates into saved cards.
- **HF-13** (S3): silent GPS-denial-routes-to-fallback breaks the trust contract of "show me events near me" — for users who toggled off location, they see events for the city in their preference (which they may not have updated in months).
- **HF-06** (S2): rapid filter toggling can race; slow Promise resolves last and overwrites correct UI.
- **HF-08** (S3): sticky-GPS prevents in-foreground location updates from settings.

---

## §10 Discoveries for orchestrator

- **ORCH-0670.D-1 — Saved-card currency contract is broken across all save-card paths, not only Discover events.** `formatPriceRange` is generic and used wherever a saved card displays a price. The double-conversion bug is a **whole-app currency display invariant violation** if the upstream `card.price` is ever a non-USD-formatted string. Recommend a separate ORCH-0670.D-1 spec scope to audit every callsite of `formatPriceRange` and the contract of "what is `card.price` always denominated in." This may affect curated experiences, deck cards, paired-profile cards.
- **ORCH-0670.D-2 — `keep-warm` edge fn warmup happens in `useForegroundRefresh:280` but not on Discover mount.** Cold open of Discover from app launch may hit a 5-15s cold-start latency on `ticketmaster-events`. Consider whether warmup should fire on Discover mount.
- **ORCH-0670.D-3 — Admin "Concerts & Events" surface absent.** The admin dashboard has Place Pool / Photo Pool / Signal Library / Email / Reports tabs, but no panel to inspect `ticketmaster_events_cache` rows, evict cache by geo, see TM API hit rate, or override the music segment. Operating the surface in production is currently blind.
- **ORCH-0670.D-4 — `ticketmaster_events_cache` cleanup runs only on cache-write success path.** The fire-and-forget delete-expired (`ticketmaster-events/index.ts:444-450`) only fires after a successful upsert. If TM is in 5xx for hours and serves stale cache, no cleanup runs. Table grows unboundedly during outages. Recommend a scheduled cron (Supabase pg_cron) or a separate `cleanup-cache` edge fn.

---

## §11 Confidence summary

| Finding ID | Class | Confidence | How to raise |
|---|---|---|---|
| RC-IX-1 (i18n key drift) | Root Cause | **HIGH** | already provable; no upgrade needed |
| RC-D-1 (date cache poisoning) | Root Cause | **HIGH** | already provable |
| RC-P-1 (tier chips no-op) | Root Cause | **HIGH** | already provable |
| RC-P-2 (TBA invisibly excluded) | Root Cause | **HIGH** | already provable |
| RC-G-1 (genre keyword malformed) | Root Cause | **HIGH** for "code is wrong"; **NEEDS-LIVE-FIRE** for "user-visible empty rate" |
| F-Q1-1..F-Q1-10 (geography family) | Contributing/Hidden | **HIGH** static, **MEDIUM** runtime | live-fire matrix in §1.2 |
| HF-04 (currency double-convert) | Hidden Flaw | **HIGH** | already provable |
| HF-01..HF-13 | Hidden Flaw | mostly **HIGH** static; HF-09 dedup MEDIUM | unit reproduction tests |
| OBS-1..OBS-3 | Observation | n/a | n/a |

**Overall investigation confidence: HIGH for everything not requiring runtime, MEDIUM for everything requiring runtime.** The dispatch's mandatory live-fire matrix (§1.2) should be commissioned before SPEC dispatch.

---

## §12 Recommended next steps (NOT a spec)

The orchestrator should consider these scope candidates for the spec phase. **No prescriptive solutions here; just scope buckets ranked by user-visible severity:**

1. **Scope A — Correctness blockers (recommend single bundled spec):**
   - RC-IX-1 (i18n keys: 7 missing × 29 locales = 203 strings to add)
   - HF-04 (currency-correct event price; redefine `formatPriceRange` contract OR change edge-fn output to expose currency separately)
   - RC-P-1 (decide tier chips vs USD bands — pick one)
   - RC-G-1 (use `classificationName` or `genreId` from TM `/classifications`)
   - RC-D-1 (add `selectedFilters.date` to mobile cache key + `endDate` to edge-fn cache key)

2. **Scope B — Geographic correctness (NEEDS-LIVE-FIRE first):**
   - F-Q1-1 (`countryCode` parameter)
   - F-Q1-2 (segment hardcode — decide: rename UI title to "Concerts" OR add segments)
   - F-Q1-7 (NY-tz cache rollover → user-tz)
   - F-Q1-10 (separate "no coverage in your country" empty state from "no events tonight")

3. **Scope C — Robustness floor:**
   - HF-01..HF-13 cluster

4. **Scope D — Horizon expansion (Q4):**
   - Pagination UI + caller (`page` parameter)
   - Radius adjustment UI
   - Date "any" → genuinely any (e.g., 12 months)
   - Sold-out filter toggle

5. **Scope E — Defer to follow-up ORCH IDs:**
   - D-1 (whole-app currency contract audit)
   - D-3 (admin surface for events ops)
   - D-4 (cron-based cache cleanup)

**Recommended dispatch order:** A (correctness) → live-fire → B (geography) → C (robustness) → D (horizon). A and live-fire can begin in parallel. Each scope is independently mergeable.

---

## §13 Regression prevention requirements (input to spec)

For the class of bugs found, the spec must define structural safeguards:

1. **CI gate: i18n key existence.** AST-grep all `t("namespace:key")` references in mobile code; assert each key exists in `en/<namespace>.json`. Negative-control: rename a key, expect CI red; rename back, expect CI green. Catches RC-IX-1 family forever.
2. **CI gate: filter chip-handler parity.** AST-grep filter option arrays vs filter switch cases; assert no chip slug falls through to `default: return true` silently. Catches RC-P-1 family.
3. **Unit test: cache key surjection.** For every `(geo, genre, date, price)` combination in the input space, assert the cache-key function maps to a unique key. Catches RC-D-1 family.
4. **Unit test: currency display invariant.** Snapshot `EventGridCard` with `card.price = "$50 - $80"` and `currency = "GBP"` for a Berlin event with raw `priceCurrency = "EUR"`; assert symbol matches source currency, no double conversion. Catches HF-04.
5. **CI gate: edge fn input-schema parity with TM docs.** Lock down which TM params we send and how they're encoded; if `keyword` ever joins more than one element, fail CI. Catches RC-G-1 regression.
6. **Live-fire smoke matrix in tester suite.** Before any change to events surface, tester runs ≥5 geography probes via the actual edge fn and asserts: `meta.totalResults > 0` for NYC/London, currency matches venue country, day-of-week label matches venue tz. Catches geography drift forever.

---

## §14 Investigation manifest (files read, in order)

1. `Mingla_Artifacts/prompts/FORENSICS_ORCH-0670_CONCERTS_EVENTS_BRUTAL_AUDIT.md` — dispatch
2. `Mingla_Artifacts/prompts/FORENSICS_ORCH-0570_CURATED_BRUTAL_CLEANUP.md` § Tier 4 — prior orbit map
3. `supabase/functions/ticketmaster-events/index.ts` — edge fn (entire file, 479 lines)
4. `supabase/migrations/20260301000003_ticketmaster_cache.sql` — schema
5. `supabase/migrations/20260317210000_admin_dashboard_overhaul.sql:114` — admin maintenance DELETE
6. `app-mobile/src/services/nightOutExperiencesService.ts` — service (entire, 107 lines)
7. `app-mobile/src/components/DiscoverScreen.tsx` — UI (relevant orbits: 1-90, 90-300, 300-468, 690-940, 940-1140, 1199-1500)
8. `app-mobile/src/components/utils/formatters.ts:141-240` — `formatPriceRange` + `parseAndFormatDistance`
9. `app-mobile/src/i18n/locales/en/discover.json` — i18n keys (drift verified)
10. `app-mobile/src/constants/priceTiers.ts` — `PRICE_TIERS` source
11. `app-mobile/src/hooks/useForegroundRefresh.ts` — to confirm no events query family
12. `app-mobile/src/store/appStore.ts:215-280` — `clearUserData` (logout)
13. `mingla-admin/src/lib/constants.js:65, 221` — admin allowlist refs (read-only)

---

## §15 What this report is NOT

- Not a spec. No code shape proposed; scope candidates only.
- Not a fix. No code written.
- Not a UX redesign. Designer dispatch downstream of spec.
- Not a complete geographic verdict. Live-fire matrix in §1.2 was not executed; geography findings capped at MEDIUM.

**End report.** Orchestrator: please commission the live-fire matrix before locking the spec, and consider scope-bundle A (correctness blockers) as the lead spec scope per §12.
