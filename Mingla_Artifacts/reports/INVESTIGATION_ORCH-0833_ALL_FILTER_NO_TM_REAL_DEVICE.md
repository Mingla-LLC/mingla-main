# INVESTIGATION — ORCH-0833: "All" filter returns zero Ticketmaster events on operator's real iPhone

**Mode:** INVESTIGATE
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** Backend health **proven** via direct edge-function probe. Client-side root cause is **probable but unverified at runtime** without one Metro log capture from the operator's real iPhone (specific ask in §11 below).

---

## SYMPTOM SUMMARY

| | What happened |
|---|---|
| **Expected** | Discover → "All" date filter shows all events (Mingla business events from `public.events` + Ticketmaster events from the TM API), business-first per `I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST` |
| **Actual on real iPhone (operator-reported)** | Only Big Party (business event) renders. Zero Ticketmaster events visible (no Linkin Park, no Ben Folds, no ICP). |
| **Actual on iPhone 17 Pro sim** | Big Party + 3 visible TM events (Linkin Park, Ben Folds, ICP) — verified in prior session's screenshot `04_filter_all.png` |
| **Backend behavior (direct edge function probe this session, anon key, Raleigh + music + size 20 + no date filter + tz America/New_York)** | HTTP 200, `meta: {businessCount: 1, ticketmasterCount: 140, tmCalled: true, tmError: null}`, items: 1 business + 19 TM (first 4: Big Party, Linkin Park Experience, Ben Folds, Insane Clown Posse) |
| **Recent operator-device edge fn calls** | 2 calls to `discover-merged-events` in the last 60 min, both HTTP 200 (timestamps 18:15:55 + 18:15:58 UTC) — proving the operator's device DOES reach the edge function and DOES get successful responses |

**The contradiction:** Edge function returns 19 TM events for the exact request the client sends, but real-device renders zero. So the bug is in the mobile client OR in real-device-specific state that diverges from sim behavior.

---

## PROVEN FACT (this session)

**🟢 The edge function `discover-merged-events` is working correctly for the "All" filter scenario on Raleigh + music.** Direct probe via `curl` with the project's anon key returned a populated response with 19 TM items. Backend confirmed healthy. Sim Maestro test from the prior investigation (`04_filter_all.png`) also returns populated TM items. So the bug exists only in the path between the edge function response landing in JS and what eventually renders on the operator's real device.

---

## CANDIDATE ROOT CAUSES (ranked by probability, need operator Metro log to pin)

### 🔴 Candidate R-1: client sends a different `city.name` from real-device than sim (GPS divergence)

**File + line:** `app-mobile/src/components/DiscoverScreen.tsx:1140-1146` — request body uses `effectiveCity.name` where `effectiveCity = selectedCity ?? gpsDefaultCity`

**Hypothesis:** On the sim, the Mac's IP-based "GPS" resolves to one city (likely Raleigh based on operator's prior screenshots). On the operator's real iPhone, the actual GPS resolves to whatever city the operator is physically in. If selectedCity has not been explicitly set in the picker, gpsDefaultCity dictates the request city. If the operator's actual city has zero TM events near it but the business event (Big Party in Raleigh) shows because business events aren't city-filtered the same way TM is, we'd see exactly this symptom: 1 business + 0 TM.

**Counter-evidence:** Operator's screenshots in prior sessions showed "Raleigh" chip in the Discover header — which would mean `effectiveCity.name === "Raleigh"`. But the screenshots may have been from the sim, not the real device. Operator-screen "Raleigh" needs visual confirmation on real device.

**Verification step:** Operator captures one Metro log line: `[NightOutService] searchMerged: { city: "...", ... }` — that line's `city` field tells us exactly what the real device sent.

### 🟠 Candidate R-2: real device has a stale Metro bundle (didn't pick up recent ORCH-0828 timezone field)

**File + line:** `app-mobile/src/services/nightOutExperiencesService.ts:259-272` (uncommitted ORCH-0828 diff that added the `timezone` field + `[NightOutService] searchMerged:` log)

**Hypothesis:** The ORCH-0828 work adding the `timezone` field to the searchMerged request is still uncommitted (`git status` shows it as `M`). If the operator's real-device Metro bundle was loaded BEFORE this diff existed, the device would NOT send `timezone` in the body. The edge function at `discover-merged-events/index.ts:103` says `timezone` defaults to "UTC" if omitted — so the date filter would apply against a UTC interpretation of `localStartEndDateTime`. For the "All" filter where `localStartEndDateTime` is undefined, this should not matter (no date filter = no timezone needed). But if the bundle is otherwise stale (e.g., older searchMerged with different shape), the TM call could be malformed in some way the edge function silently absorbs.

**Counter-evidence:** Metro reload would pick up the latest bundle automatically. Operator presumably has Metro running and has reloaded since the ORCH-0828 work.

**Verification step:** Operator's Metro log will show the actual request body shape and confirm/refute the timezone presence.

### 🟠 Candidate R-3: React Query / AsyncStorage cache poisoning specific to real device

**File + line:** `app-mobile/src/components/DiscoverScreen.tsx:1067-1076` `loadNightOutCache` + lines 1113-1129 cache-hit path

**Hypothesis:** Cache key is `${NIGHT_OUT_CACHE_KEY}_v2_${user?.id}_${nightOutCityKey}_seg:${selectedFilters.segment}_date:${selectedFilters.date}_gen:${selectedFilters.genre}` — so switching from "Tonight" to "All" creates a NEW cache entry for `date:any`. If an earlier `date:any` fetch returned empty TM array (due to transient network issue, TM rate-limit, or user being in a different city at that moment), it would be persisted to `AsyncStorage` for that key. The cache-hit check at line 1118 requires `cached.venues.length > 0` — so an empty cache entry would NOT trigger the cache-hit early return, would proceed to fresh fetch, which would re-populate. So this candidate is self-healing under normal conditions.

**Why it might still be the cause:** If the cache HIT serves a populated `venues` array (TM events from a prior successful fetch), but those TM events are for a DIFFERENT city or date than the operator's current view, the rendered grid would look "wrong" but not empty. So this candidate doesn't directly explain the "zero TM" symptom.

**Verification step:** Operator clears app storage and re-tests OR captures the Metro log showing whether the JS-side fetch fires (would mean cache miss → fresh fetch was attempted).

### 🟡 Candidate R-4: cache-hit early-return path doesn't touch businessEvents state, but only nightOutCards (hidden flaw, may explain a DIFFERENT bug)

**File + line:** `app-mobile/src/components/DiscoverScreen.tsx:1117-1128`

**Exact code:**
```ts
if (
  cached &&
  cached.date === getTodayDateString() &&
  cached.venues.length > 0 &&
  cached.genre === selectedFilters.genre
) {
  setNightOutCards(cached.venues);  // ← only sets TM cards
  setFallbackActive(cached.fallbackActive ?? false);
  setNightOutLoading(false);
  return;  // ← early return — businessEvents state untouched
}
```

**Why it's a hidden flaw but NOT today's root cause:** The cache stores ONLY TM venues (line 1053 `cacheData.venues = venues` where venues is `cards = tmVenues.map(...)`). So a cache hit restores TM events but leaves `businessEvents` state stale. If a user had populated `businessEvents` from a prior fresh fetch and the cache hit serves a STALE TM array, the UI shows: stale TM + whatever `businessEvents` happened to be. The OPPOSITE of operator's symptom.

**Hidden flaw classification:** this asymmetry between persisted TM and in-memory business events will eventually cause a different bug (probably "wrong business events showing under wrong filter" if business events state leaks across filter changes). Worth fixing in the same SPEC as R-1/R-2/R-3 even if it's not today's root cause.

### 🔵 Observation O-1: 24h React Query persist allowed

**File + line:** `app-mobile/app/index.tsx:2981` `maxAge: 24 * 60 * 60 * 1000`

React Query cache is persisted to AsyncStorage with 24-hour max age. Any query keys that match `shouldDehydrateMinglaQuery` get persisted across cold starts. The `nightOutCards` state is NOT a React Query key (it's plain `useState` driven by the Discover screen), so this persist policy doesn't directly affect the merged-discover flow. But it does affect `useBusinessEventOrders`, `usePublicEventTickets`, and other hooks — which is relevant to other bugs but not this one.

---

## FIVE-LAYER CROSS-CHECK

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | `INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md` Part B already documented this as "probable cache / TM API returning empty" but couldn't promote past probable without runtime evidence | Acknowledged — that prior doc is superseded by this one |
| **Schema** | `events` table + `public.events` baseline RLS allows anon SELECT on public + scheduled/live events; `discover-merged-events` uses service-role to query | Healthy — direct probe returns correct data |
| **Code** | Source-trace at all four candidate locations + edge function fully read; merge math correct (line 479-486 of edge fn: business first, then TM up to `size - businessCount`); JS-side partition correct (line 1158-1162 of DiscoverScreen) | Code is correct in intent |
| **Runtime — sim** | Maestro live-fire from prior session screenshot `04_filter_all.png` shows Big Party + 3 TM events | Healthy |
| **Runtime — real device** | Operator-reported: zero TM events. 2 recent edge fn invocations both HTTP 200. NO Metro log captured for the failing tap. | **Contradicts sim runtime — pin requires Metro log** |
| **Data — backend** | Direct edge-fn probe this session: 1 business + 19 TM items | Healthy |
| **Data — client cache** | Cache key includes date filter; cache stores only TM venues; cache-hit path doesn't refresh business events | Has the R-4 hidden flaw but doesn't explain today's symptom |

**Contradiction located:** real-device runtime vs sim runtime vs proven backend health. Three layers say the system works; one user-reported layer says it doesn't. Without the Metro log from the failing tap, we can't distinguish R-1 (city divergence) from R-2 (stale bundle) from R-3 (cache poisoning).

---

## BLAST RADIUS

**If R-1 is correct (city divergence):**
- Affects every real-device user whose GPS resolves to a city with zero TM events
- Workaround: operator manually picks Raleigh in CityPickerSheet
- Does NOT affect sim users (Mac's IP-based location)

**If R-2 is correct (stale bundle):**
- Affects only the operator's current device session
- Self-heals on Metro reload / fresh build
- Will not reproduce after operator's pending EAS build

**If R-3 is correct (cache poisoning):**
- Affects only this user's device until cache clears (24h) OR user clears app data
- Could affect any user who triggered a transient empty fetch
- Workaround: clear app data

**R-4 hidden flaw blast radius:**
- Affects cache-hit flows where business events state is stale relative to the displayed filter
- Wider than this bug; will surface as "wrong business events showing under wrong filter" over time

---

## INVARIANT VIOLATIONS

**None proven** without runtime evidence. If R-4 is acted on as part of the SPEC fix, propose new invariant:

**I-PROPOSED-DISCOVER-CACHE-PARITY** — the Discover merged-events cache MUST store BOTH `nightOutCards` (TM) and `businessEvents` together, OR the cache-hit early-return path MUST trigger a parallel fresh fetch for business events. The current asymmetry (TM persisted, businessEvents in-memory only) creates a class of "filter-state-leak" bugs.

---

## FIX STRATEGY (DIRECTION ONLY — NOT A SPEC)

Three layers of fix, depending on which candidate is confirmed by the Metro log:

1. **If R-1 (city divergence):** add a visible "Pick a city" affordance on first-launch if GPS-derived city has zero events; OR auto-fall-back to the largest nearby city with TM coverage. Mostly UX work.

2. **If R-2 (stale bundle):** no code fix needed — the operator's pending EAS build will refresh the native binary AND the JS bundle. Validates by retesting after install.

3. **If R-3 (cache poisoning):** add an in-flight `cache.invalidate()` on filter change, OR add a version bump to the cache key shape (force migration), OR add timestamp + reject-if-older-than-N-minutes to the cache hit check.

4. **R-4 always:** refactor `fetchNightOutEvents` so the cache-hit early-return path ALSO restores `businessEvents` state (via a SECOND AsyncStorage key) OR drop the cache-hit early-return entirely and always re-fetch (the React Query layer below should provide its own caching at the hook level). Cleanest fix: persist `businessEvents` alongside `venues` in the existing cache shape — add `businessEvents: BusinessEventCardData[]` to `NightOutCache` interface + populate it during `saveNightOutCache` + restore it during the cache-hit branch.

---

## REGRESSION PREVENTION

- Add a strict-grep CI gate or runtime assertion that any `setNightOutCards` call from a cache-hit path is paired with a `setBusinessEvents` call (or a fresh fetch trigger).
- Add a `[NightOutService] searchMerged response:` log line at `nightOutExperiencesService.ts:298` AFTER the edge function call returns, showing `data.meta.businessCount` + `data.meta.ticketmasterCount` + `data.items.length` — this would have made today's investigation trivial (the operator's Metro log would have surfaced the divergence between sim and real device in 30 seconds).
- The proposed invariant `I-PROPOSED-DISCOVER-CACHE-PARITY` (per §"Invariant Violations" above) codifies the asymmetry as a class of bug.

---

## DISCOVERIES FOR ORCHESTRATOR

### D-1: missing post-fetch log line cost us a full investigation
`nightOutExperiencesService.ts:259-272` logs the REQUEST body before sending, but NEVER logs the response shape after the edge fn returns. If a `[NightOutService] searchMerged response:` log had been added in the ORCH-0828 diff next to the request log, today's investigation would have been ~5 minutes (just ask operator to capture one Metro log and we'd see immediately whether the response was populated or empty). Recommend adding it as a 3-line addition in the SPEC that follows this investigation.

### D-2: R-4 hidden flaw should be folded into the same SPEC
Even if today's root cause turns out to be R-1 or R-2, the asymmetric cache (TM persisted, businessEvents in-memory only) is a latent bug that will surface eventually. Fold it into whatever SPEC follows this investigation rather than spinning a separate ORCH.

### D-3: cache-hit early-return + 24h maxAge is dangerously stale
The cache-hit path doesn't validate against server data; if the server-side dataset has changed (new events published, expired events removed), the cached version could be up to 24 hours stale. For Discover specifically (which is meant to surface what's HAPPENING NOW), 24-hour staleness is too long. Consider dropping cache `maxAge` to 1-2 hours for this query key OR adding a stale-while-revalidate pattern (return cached immediately, fetch fresh in background, swap when ready).

### D-4: prior investigation `INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md` is superseded by THIS document
That report's Part B was source-only "probable cache" speculation. This investigation supersedes it with: proven backend health + classified candidate root causes + the explicit Metro-log ask. Orchestrator should reference THIS file going forward.

---

## CONFIDENCE LEVEL: **Probable, NOT proven**

What's proven:
- Backend (edge fn + TM API) returns correct data for the operator's filter shape — DIRECT PROBE this session
- Sim renders correctly with the same filter — PRIOR LIVE-FIRE
- 2 recent edge fn invocations from the operator's device returned HTTP 200 — DB log
- Mobile client code path for the merge + render is correct in intent — SOURCE READ all 4 candidate locations

What's NOT proven:
- Which specific candidate (R-1, R-2, R-3) is the actual real-device root cause
- The shape of the response the operator's device received on those 2 recent edge fn calls

What would promote this to **proven**:
- ONE Metro log capture from the operator's real iPhone showing the `[NightOutService] searchMerged:` log line for an "All" filter tap, plus the next 2 seconds of logs (especially `[QUERY]` lines from the React Query layer if any fire). That single piece of evidence is the difference between "I think it's R-1" and "PROVEN it's R-1."

---

## WHAT I NEED FROM THE OPERATOR (single ask)

**Capture one Metro log of an "All" filter tap on your real iPhone.** Specifically:

1. Open the dev-build app on your iPhone (Metro at port 8084 already running).
2. Go to Discover tab.
3. **In your Metro terminal**, note the current line count or just clear the visible buffer.
4. **Tap the "All" filter chip ONCE** on your iPhone.
5. **Wait ~3 seconds** for the network response.
6. **Copy the next 10-20 lines of Metro output** and paste them back. Specifically I'm looking for the line that starts with `[NightOutService] searchMerged:` — that one log line, with its full object dump, tells me the request body shape (city, segment, timezone, etc.) and whether subsequent `[QUERY]` lines indicate success or error.

**Bonus:** if you can also do a cold-start variant (kill the app, reopen, immediately tap All without first tapping Tonight), that rules out the R-3 cache-poisoning theory.

Once I have that log, the investigation flips from "probable" to "proven" and I can immediately write the SPEC. Until then, I refuse to write the SPEC on speculation — the difference between R-1 (city divergence — needs UX fix), R-2 (stale bundle — no code fix needed), and R-3 (cache poisoning — needs cache invalidation fix) is large enough that the wrong SPEC wastes implementor time.

---

## Working-Branch Discipline

This investigation lives in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code modified. No spec written (deferred until Metro log evidence). No migrations applied. No global indexes written.
