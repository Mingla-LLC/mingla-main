# QA — ORCH-0809 Pre-M3 Audit Report

**ORCH-ID:** ORCH-0809 (Discover Ticketmaster Filter Expansion v1)
**Mode:** TARGETED, advisory frame (pre-M3 sanity audit, not a CLOSE-gating test)
**Date:** 2026-05-12
**Auditor:** Claude `mingla-forensics` (TEST mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Scope:** M1 + M2 + two cache-key hotfixes as they stand today
**Inputs read:** SPEC §1–§16; M1 + M2 implementation reports; all 9 touched files (migration, server constants, edge function, client types, preferences, service, screen, picker, Zustand store)

---

## Verdict: ADVISORY — NOT clean to proceed to M3 as-is

**Two P1 items must be fixed in a small M2.1 slice before M3 ships strict-grep gates that lock in the current state.** Both are surgical (~10 LOC combined). Zero P0. Five P2 worth knowing about. Five P4 praise observations confirm the structural skeleton is sound.

If M3 ships gates on the current state without M2.1, the gates will protect code that has a misleading banner (P1-1) and a silent classification fallback that is the exact "silent failure / fabricated data" pattern the SPEC was supposed to eliminate (P1-2).

| Severity | Count |
|---|---|
| **P0 — CRITICAL** | 0 |
| **P1 — HIGH** | 2 |
| **P2 — MEDIUM** | 5 |
| **P3 — LOW** | 2 |
| **P4 — NOTE (praise)** | 5 |

---

## §1 — P1 Findings (fix before M3)

### 🔴 P1-1 — Cache hit does not update `fallbackActive` → banner state drifts from rendered events

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Lines:** 1019-1030 (cache hit branch) vs 1055 (success branch sets `setFallbackActive`)

**Exact code (cache hit branch):**
```ts
if (!skipCache) {
  const cached = await loadNightOutCache();
  if (cached && cached.date === getTodayDateString() && ... ) {
    setNightOutCards(cached.venues);
    setNightOutLoading(false);
    return;  // ← returns WITHOUT updating setFallbackActive
  }
}
```

**Exact code (success branch):**
```ts
setFallbackActive(meta?.usedFallback === true);  // ← only runs on fresh fetch
const cards = events.map(transformNightOutVenue);
setNightOutCards(cards);
saveNightOutCache(cards);
```

**What it does:** When a cache entry is served, the rendered events ARE from the cached fetch — but `fallbackActive` keeps whatever value it had from the previous filter combination. The banner ("Showing events near you — \<city\> has no Ticketmaster events right now.") renders based on `fallbackActive` + `effectiveCity`, not on the freshness or origin of the displayed events.

**What it should do:** Either (a) include `usedFallback` in the cached payload (`NightOutCache` interface adds `usedFallback: boolean`) and restore it on cache hit, or (b) `setFallbackActive(false)` defensively at the top of the cache-hit branch (less accurate — loses the information for revisits of cities that DID need fallback).

**Causal chain:**
1. User picks city A (a sparse city). Fetch fires, edge function widens to lat/lng, response has `meta.usedFallback=true`. Banner: "Showing events near you — A has no Ticketmaster events right now."
2. User picks city B (a dense city). Fetch fires, no fallback. Banner clears.
3. User picks city A again. Cache hit serves city A's cached events. `fallbackActive` is still `false` from step 2. Banner doesn't render. User sees city A's "nearby" events without the banner explaining why.

OR worse:
1. User picks city B (dense). No fallback. `fallbackActive = false`.
2. User picks city A (sparse). Fetch widens. Banner: "showing nearby for A". `fallbackActive = true`.
3. User picks city B again. Cache hit. `fallbackActive` stuck at `true`. Banner says "Showing events near you — B has no Ticketmaster events right now" while showing B's actual events. **Constitution #9 violation — banner becomes fabricated UX information.**

**Verification step:** Manually run through steps 1-3 above on iOS Simulator (or add a Jest test that fetches city A with mocked fallback, then mocks a cache hit for city B and asserts banner does not render). The current code path is reproducible with two changes of city.

**Fix:** Extend `NightOutCache` interface to include `fallbackActive: boolean`; update `saveNightOutCache` to capture the current state; update the cache-hit branch to `setFallbackActive(cached.fallbackActive ?? false)`. ~5 LOC.

---

### 🔴 P1-2 — `segmentSlug` unknown silently falls back to Music → silent classification fabrication

**File:** `supabase/functions/_shared/ticketmasterClassifications.ts`
**Lines:** 71-90 (`resolveTmClassification`)

**Exact code:**
```ts
export function resolveTmClassification(
  segmentSlug: DiscoverSegmentSlug | string | undefined,
  genreSlugs: ReadonlyArray<DiscoverGenreSlug | string>,
): { segmentId: string; genreIds: string[] } {
  const segmentId =
    (segmentSlug && DISCOVER_SEGMENT_ID[segmentSlug as DiscoverSegmentSlug]) ||
    DISCOVER_SEGMENT_ID.music;  // ← silent fallback to Music
  // ...
}
```

**What it does:** Any unknown segment slug (e.g., a future client passing `"comedy"` before M3 lands the Comedy ID, or a malformed payload from a misbehaving caller) is silently resolved to Music. The edge function then queries TM for Music segment, returns Music events. The client renders them under the user's "Comedy" chip selection.

**What it should do:** Per SPEC §11 hard guard 4 (which says "no implementation without validation") and per Constitution #3 (no silent failures) + Constitution #9 (no fabricated data) — an unknown segment slug should either:
- Edge function rejects with HTTP 400 `{ error: "unknown segmentSlug: <value>" }`, OR
- `resolveTmClassification` throws and the edge function 400s, OR
- The fallback to Music happens but the response includes an explicit `meta.unknownSegment: true` so the client can show "we couldn't filter by Comedy" rather than silently mislabel events.

**Causal chain:**
1. M3 adds `comedy` to `DiscoverSegmentSlug` on client BEFORE the operator runs the TM classifications curl.
2. Client ships an OTA update with the Comedy chip.
3. User selects Comedy chip. Client sends `segmentSlug: "comedy"`.
4. Edge function receives, `DISCOVER_SEGMENT_ID["comedy"]` is undefined, falls back to Music.
5. TM returns Music events. Client labels them as Comedy results.
6. **Constitution #9 violation in production.**

The exact same bug class as the deleted price filter. We removed the price filter for being a silent fabrication; this is structurally identical for classification.

**Verification step:** With the edge function deployed, POST a body with `segmentSlug: "comedy"` to `ticketmaster-events`. Expected: 400 with `"unknown segmentSlug"`. Actual today: 200 with Music events.

**Fix:** Add validation in the edge function handler (around line 470, near the existing `segmentSlug` resolution call): if `segmentSlug` is present and not in `DISCOVER_SEGMENT_ID`, return 400. ~6 LOC.

---

## §2 — P2 Findings (worth fixing in M2.1; not blocking)

### 🟠 P2-1 — `setFallbackActive` not reset in error catch block

**File:** `DiscoverScreen.tsx:1059-1062`

If the fetch throws, `fallbackActive` retains its previous value. User sees the error empty-state with the banner still rendered (banner is gated on `fallbackActive && effectiveCity`, and `effectiveCity` is unchanged through the error). Fix: add `setFallbackActive(false)` in the catch block.

### 🟠 P2-2 — `NightOutCache` payload missing segment + city + dateFilter + fallbackActive

**File:** `DiscoverScreen.tsx:940-944`

```ts
interface NightOutCache {
  date: string;       // ← TTL date (today)
  venues: NightOutCardData[];
  genre: string;      // ← filter dimension, but ONLY genre
}
```

Today the cache key carries city + segment + date + genre (all four) but the payload only carries genre. The predicate `cached.genre === selectedFilters.genre` is redundant given the key, but if a future change loosens the key, the predicate becomes the only defense and would not catch segment / city / date drift. Recommend including all four in the payload + extending the predicate so it's self-protecting.

### 🟠 P2-3 — `getTodayDateString` hardcoded to `America/New_York`

**File:** `DiscoverScreen.tsx:931-937`

```ts
return new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  ...
```

Pre-existing (NOT introduced by ORCH-0809) but conflicts with I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS which mandates local-time computation throughout the Discover query path. PST / GMT / JST users have a slightly different "today" boundary for cache TTL purposes. Low impact (the cache TTL is just "is this from the same calendar day") but inconsistent with the new invariant. Recommend `timeZone: undefined` to use device-local.

### 🟠 P2-4 — Edge function doesn't 400 when both `city` AND `location` are sent

**File:** `supabase/functions/ticketmaster-events/index.ts:451-457`

Validation only checks "at least one of city or location." Sending both is silently accepted (the URL builder prefers city). The service layer guards against this (`nightOutExperiencesService.ts:98-102` throws on both) but a future direct caller of the edge function bypasses it. Recommend symmetric validation at the edge function.

### 🟠 P2-5 — Brief flash of wrong-city events when reverse-geocode resolves before persisted prefs

**File:** `DiscoverScreen.tsx:870-929` (two parallel useEffects)

The preferences mount-load effect and the GPS reverse-geocode effect run in parallel. Race scenarios:

1. **Prefs first (persisted city exists):** prefs sets `selectedCity` → reverse-geocode effect bails on `if (selectedCity) return`. CLEAN.
2. **Reverse-geocode first:** `gpsDefaultCity` set → fetch fires with GPS city. Then prefs resolve with persisted city → `selectedCity` set → fetch re-fires with persisted city. User briefly sees wrong city for one network round-trip.
3. **Both fail:** chip shows "Set city", grid empty-state renders. CLEAN.
4. **Prefs first (no persisted city):** `selectedCity` stays null → reverse-geocode resolves → `gpsDefaultCity` set → fetch fires. CLEAN.

Only scenario 2 has a UX glitch. Could be eliminated by gating the fetch on a `prefsLoaded` flag, but adds complexity. Marking as P2 because it's a brief flicker, not a sustained wrong state.

---

## §3 — P3 Findings (low priority; defer or accept)

### 🟡 P3-1 — Empty `DISCOVER_GENRE_ID` maps mean genre chips silently no-op

**File:** `supabase/functions/_shared/ticketmasterClassifications.ts:53-66`

SPEC §5.3 explicitly permits this until M3 lands real IDs. Worth a tiny user-facing signal during the M3-gap window — e.g., a subtle hint in the genre modal: "Genre filtering coming soon — segment filter is active." Low priority because M3 closes the gap.

### 🟡 P3-2 — Anon user (no `userId`) flow: city is session-only

**File:** `app-mobile/src/components/discover/CityPickerSheet.tsx:181-196`

```ts
if (userId) {
  try { await PreferencesService.updateUserPreferences(...); }
  catch (err) { /* error path */ }
}
// ... still calls onCityPicked even without userId
```

For anon users, the city updates local state but never persists. Sign in → city is lost. Probably intentional (anon = no DB row) but worth confirming with product.

---

## §4 — P4 Findings (praise / observations)

### 🔵 P4-1 — Zustand registry hydration risk: ZERO (clean by design)

**File:** `app-mobile/src/store/appStore.ts:402-420`

`discoverFilters` is NOT in the `partialize` allowlist. The registry is in-memory only (tab-lifecycle survival per ORCH-0679 Wave 2.8, not session-survival). Pre-M2 users have ZERO persisted state for `discoverFilters`. The shape change `{date, price, genre}` → `{date, segment, genre}` is a pure type-level change with no migration risk.

### 🔵 P4-2 — Cross-domain blast: ZERO unintended consumers

```
NightOutExperiencesService:   DiscoverScreen.tsx + service (only)
ticketmaster-events (edge):    service + supabase/config.toml + preferences.ts (comment only)
discover_city_*:                migration + types + screen + picker (only)
ticketmasterClassifications:    types + screen + service + edge function (only)
KZFzniwn (TM ID prefix):        ZERO matches in app-mobile/ / mingla-admin/ / mingla-business/
```

Constitution #2 (one owner per truth) verified: server fully owns TM IDs.

### 🔵 P4-3 — Cache key v2 prefix correctly isolates from v1 entries

`mingla_night_out_cache_v2_*` will never match pre-fix `mingla_night_out_cache_<user>_<lat>_<lng>_<genre>` entries. Stale entries become orphan; minor AsyncStorage leak (KBs); not worth a sweep.

### 🔵 P4-4 — Backward-compat detection in edge function is intact

Posting the v1 shape (`{ location, radius, keywords, startDate, endDate }`) still works: no `city` → lat/lng path; no `segmentSlug` → Music fallback; no `localStartEndDateTime` → UTC `startDateTime`/`endDateTime` path. The branching is clean.

### 🔵 P4-5 — `useUserLocation` guard untouched

The I-LOCATION-INVALIDATE-ON-LOCATION-ONLY guard at `useUserLocation.ts:148` was preserved verbatim per spec hard guard. Location query key unchanged.

---

## §5 — Constitution Check (14 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | City chip, segment chips, genre chips, date chips all have onPress handlers |
| 2 | One owner per truth | PASS | TM IDs server-only, slugs client-only, P4-2 verified |
| 3 | No silent failures | **FAIL (P1-2)** | Unknown segmentSlug silently falls back to Music |
| 4 | One key per entity | PASS | Cache key v2 includes all four filter dims (after hotfix v2) |
| 5 | Server state server-side | PASS | DiscoverCity persisted via DB; Zustand registry not in partialize |
| 6 | Logout clears everything | PASS | Reset handler sets `discoverFilters: null`; preferences are server-side and cleared on auth change |
| 7 | Label temporary | PASS | M2 deleted the `[TRANSITIONAL]` adapter; no surviving transitional markers |
| 8 | Subtract before adding | PASS | Price filter removed cleanly before segment switcher was added |
| 9 | No fabricated data | **FAIL (P1-2)** | Same finding — Comedy chip on a "comedy"-unaware server returns Music events labeled as Comedy |
| 10 | Currency-aware | N/A | This ORCH does not touch currency display |
| 11 | One auth instance | PASS | Uses existing `user?.id` from app store |
| 12 | Validate at right time | PASS | Date math now uses local time per I-PROPOSED-BI |
| 13 | Exclusion consistency | PASS | v1 + v2 paths both apply the same segment/genre resolution rules |
| 14 | Persisted-state startup | PASS | Cache key version bump (`_v2_`) handles startup migration; `_hasHydrated` gate preserved |

**Two Constitution violations under the same root cause (P1-2). Fixing P1-2 restores #3 and #9 simultaneously.**

---

## §6 — Spec Success Criteria Coverage

| SC | Description | Audit verdict |
|---|---|---|
| SC-1 | GPS-default city populates within 5s | LIKELY PASS — code reviewed, race scenario 2 (P2-5) gives a brief flicker but no incorrect sustained state |
| SC-2 | City picker persists 5 columns | LIKELY PASS — code reviewed; live DB probe is M3 tester scope |
| SC-3 | City persists across sign-out | LIKELY PASS — mount effect re-reads on next session |
| SC-4 | Segment switcher surfaces Sports | PASS (wire path) — Sports ID resolves; UI ships M2 |
| SC-5 | Hip-Hop genre returns only hip-hop | DEFERRED M3 — empty genre map until operator curl |
| SC-6 | Local-time Tonight | PASS — `getDateRange` rewritten with `toLocalISO` |
| SC-7 | Local-time Weekend | PASS — same |
| SC-8 | Price filter UI gone | PASS — symbol greps confirm only comments survive |
| SC-9 | Fallback banner appears | **PARTIAL FAIL (P1-1)** — appears on fresh fetch but drifts on cache hits |
| SC-10 | Cache key isolation | PASS — server cache + AsyncStorage both include all four filter dims |
| SC-11 | No `"VERIFY"` literal | PASS |
| SC-12 | No `KZFzniwn` in client | PASS |
| SC-13 | No UTC `startDateTime` in Discover | PASS |
| SC-14 | "Set your city" prompt for edge user | PARTIAL — chip says "Set city" but no dedicated empty-state copy for that case |

---

## §7 — Race Condition Analysis

Five scenarios traced in `DiscoverScreen.tsx:870-929`:

| # | Sequence | Outcome | Severity |
|---|---|---|---|
| 1 | Prefs (with city) resolves → reverse-geocode bails | Clean — fetch fires once with persisted city | OK |
| 2 | Reverse-geocode resolves → prefs (with city) resolves | Brief flash of wrong city for one network RTT | P2-5 |
| 3 | Both fail | Empty-state with "Set city" chip | OK |
| 4 | Prefs (no city) → reverse-geocode | Clean — fetch fires once with GPS city | OK |
| 5 | User picks city while reverse-geocode in-flight | `setSelectedCity` short-circuits the still-pending `gpsDefaultCity` set (selectedCity takes precedence). On reverse-geocode resolution, the effect checks `if (selectedCity) return` and bails. Clean. | OK |

Only scenario 2 has a visible glitch. Not blocking.

---

## §8 — RLS Verification (concern #6)

The five new `discover_city_*` columns are nullable, added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. PostgreSQL RLS predicates operate at the row level — they gate `SELECT/INSERT/UPDATE/DELETE` on the whole row, not per-column. The existing `preferences_owner_*` policies (predicate: `user_id = auth.uid()` or equivalent) continue to gate access to the row, including the new columns.

**Verified by design.** **NOT verified live** (no Supabase MCP probe was run in this audit per the "read-only audit" hard guard). Recommend the M3 tester run a cross-user SELECT probe as a sanity check.

---

## §9 — Third Cache-Key Bug Hunt (concern #10)

Audited every cache layer for the under-keying bug class:

| Layer | Key shape | Filter dims | Verdict |
|---|---|---|---|
| AsyncStorage night-out cache | `_v2_<user>_city:<x>_seg:<s>_date:<d>_gen:<g>` | All four ✓ | CLEAN after hotfix v2 |
| Edge function server cache | `v2:city:<x>:<state>:<country>:seg:<id>:gen:<ids>:kw:<kw>:dt:<dt>` | All four + kw + state + country ✓ | CLEAN |
| React Query keys | N/A — DiscoverScreen uses `useState` + manual `useEffect`, NOT React Query for night-out fetch | N/A | CLEAN (no third instance) |
| In-memory module state | `cachedLocationSync` in `useUserLocation.ts` is location-only, no filter | N/A | CLEAN (unrelated) |

**No third instance of the under-keying bug class.** P1-1 (banner state drift on cache hit) is structurally adjacent but distinct — it's a payload-shape issue, not a key-shape issue.

---

## §10 — Recommended M2.1 Slice (before M3)

Surgical fix slice. Estimated ~15 LOC across 3 files. ~30 minutes of work.

**File 1: `DiscoverScreen.tsx`**
- Extend `NightOutCache` interface to include `fallbackActive: boolean` (1 line)
- Update `saveNightOutCache` to capture `fallbackActive` (1 line)
- Update cache-hit branch to call `setFallbackActive(cached.fallbackActive ?? false)` (1 line)
- Add `setFallbackActive(false)` to the error catch block (1 line)
- Recommended: change `getTodayDateString` to device-local (`timeZone: undefined`) — pre-existing P2 cleanup

**File 2: `supabase/functions/ticketmaster-events/index.ts`**
- After the request body destructure, before `resolveTmClassification` is called: if `segmentSlug !== undefined && !(segmentSlug in DISCOVER_SEGMENT_ID)` → return 400 `"unknown segmentSlug"` (4-5 lines)
- Symmetric: if `city && location` → return 400 `"pass either city or location, not both"` (3 lines)

**File 3: M3 strict-grep gates (when written)**
- Gate 2 should additionally assert: no caller of `resolveTmClassification` happens without first validating the slug is known. (Lighter than parsing the call site — easier to assert via a wrapper function `resolveOrReject(slug)` that throws on unknown.)

After M2.1: re-audit (this skill, ~5 min) → confirm P1 items closed → dispatch M3 with confidence the gates lock in correct behavior.

---

## §11 — Discoveries for Orchestrator

- **Process learning candidate for the invariant registry:** the bug class "filter dimension exists in code but is silently dropped at server boundary" (price filter, segmentSlug fallback) is structurally identical. Worth a permanent invariant: **any filter dimension the user can select MUST either be validated to be supported at the server boundary OR explicitly degrade with a user-visible signal — never silently fall through to a default.** Applies beyond Discover.
- **Pre-existing P2-3 (`getTodayDateString` NY-only):** worth a separate cleanup ORCH-0809-B candidate if not folded into M2.1.
- **TM `/classifications` curl is still the M3 unblock:** operator dependency unchanged from M2.
- **i18n catalog gap:** unchanged from M2 — still tracked as ORCH-0809-A candidate.

---

## §12 — Confidence Level

**HIGH** for P1 + P2 findings — every cited file/line was read in this session; root causes have six-field evidence; reproduction steps are concrete.

**MEDIUM** for SC coverage — most "PASS" verdicts are from code-trace; live-device verification is M3 tester scope.

**LOW** for RLS in-practice — no live MCP probe per the read-only hard guard.

---

**End of pre-M3 audit. Awaiting operator direction: dispatch M2.1 surgical fix slice OR accept P1 items and proceed to M3 with documented exceptions.**

---

## §13 — Re-Audit Result (post-M2.1)

**Re-audit mode:** RETEST (Claude `mingla-tester` parity mirror, dispatched by operator after M2.1 implementation returned)
**Re-audit date:** 2026-05-12
**Inputs verified:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1_M2_1.md` against the touched files at current `HEAD` on branch `Seth`.

### Verdict: PASS — CLEAN TO PROCEED TO M3

**Updated severity counts (post-M2.1):**

| Severity | Pre-M2.1 | Post-M2.1 | Delta |
|---|---|---|---|
| P0 | 0 | 0 | — |
| P1 | 2 | **0** | −2 (both closed) |
| P2 | 5 | **3** | −2 (P2-1 + P2-4 folded into P1 fix blocks) |
| P3 | 2 | 2 | — |
| P4 | 5 | 5 | — |

The two P1 findings that would have been locked in by M3's strict-grep gates as if they were correct behavior are now structurally and verifiably closed.

### Per-P1-finding re-audit

#### P1-1 — Banner state drift on cache hits — **CLOSED**

**Code evidence verified at current HEAD:**

- `app-mobile/src/components/DiscoverScreen.tsx:952` — `NightOutCache` interface field `fallbackActive: boolean` present.
- Same file:966 — `saveNightOutCache` signature now takes `fallbackActiveAtSave: boolean` second argument.
- Same file:974 — `cacheData` payload writes `fallbackActive: fallbackActiveAtSave`.
- Same file:1049 — cache-hit branch calls `setFallbackActive(cached.fallbackActive ?? false)` immediately after `setNightOutCards(cached.venues)` and before the early `return`.
- Same file:1077 — fresh-success branch captures `const usedFallbackNow = meta?.usedFallback === true;` then sets state AND passes the same value into `saveNightOutCache(cards, usedFallbackNow)` at line 1083 — single source of truth between component state and AsyncStorage payload.
- Same file:1089 — error catch branch calls `setFallbackActive(false)` so the banner doesn't stay stuck on after a failed retry / city switch (P2-1 audit finding folded into this fix).

**Reproduction trace re-walked:**

| Step | Pre-M2.1 outcome | Post-M2.1 outcome |
|---|---|---|
| Pick sparse city A → fallback fires | banner shows | banner shows + cache saves `fallbackActive: true` |
| Pick dense city B → no fallback | banner clears | banner clears + cache saves `fallbackActive: false` |
| Pick A again → cache hit | banner doesn't show (drift) | banner shows (restored from `cached.fallbackActive`) ✓ |
| Pick B again → cache hit | banner stuck on if previously visited A (drift) | banner correctly clears (restored from `cached.fallbackActive`) ✓ |
| Fetch errors out | banner stays stuck on previous value | banner clears (catch branch resets) ✓ |

#### P1-2 — Unknown `segmentSlug` silent fallback to Music — **CLOSED**

**Code evidence verified at current HEAD:**

- `supabase/functions/ticketmaster-events/index.ts:5` — `DISCOVER_SEGMENT_ID` added to the import block from `_shared/ticketmasterClassifications.ts`.
- Same file:464-468 — symmetric guard returns 400 `{ error: "pass either city or location, not both" }` if `city && location?.lat && location?.lng` (P2-4 audit finding folded in).
- Same file:477-485 — unknown-segment guard returns 400 with structured body:
  ```ts
  if (segmentSlug !== undefined && !(segmentSlug in DISCOVER_SEGMENT_ID)) {
    return new Response(JSON.stringify({
      error: `unknown segmentSlug: ${segmentSlug}`,
      supported: Object.keys(DISCOVER_SEGMENT_ID),
    }), { status: 400, ... });
  }
  ```
- The `segmentSlug !== undefined &&` left-side guard correctly preserves v1 backward-compat — undefined slug skips validation, then `resolveTmClassification(undefined, ...)` defaults to Music exactly as before.

**Trace:** a future client posting `segmentSlug: "comedy"` (before operator runs the TM classifications curl in M3) now receives `HTTP 400` with `{ error: "unknown segmentSlug: comedy", supported: ["music","sports"] }`. Pre-M2.1 behavior: `HTTP 200` with Music events labeled under the user's Comedy chip selection. Bug class eliminated.

### Constitution 14-Check (re-verified)

| # | Rule | Pre-M2.1 | Post-M2.1 | Evidence |
|---|---|---|---|---|
| 1 | No dead taps | PASS | PASS | All Discover interactive elements wired |
| 2 | One owner per truth | PASS | PASS | TM IDs server-only; zero `KZFzniwn` in client |
| 3 | No silent failures | **FAIL** | **PASS** | Unknown slug now surfaces 400; catch branch clears banner |
| 4 | One key per entity | PASS | PASS | Cache key v2 + payload `fallbackActive` symmetric |
| 5 | Server state server-side | PASS | PASS | DiscoverCity persisted via DB; banner state local |
| 6 | Logout clears everything | PASS | PASS | Unchanged |
| 7 | Label temporary | PASS | PASS | Zero `[TRANSITIONAL]` markers in M2/M2.1 |
| 8 | Subtract before adding | PASS | PASS | M2.1 added validation, didn't layer on broken behavior |
| 9 | No fabricated data | **FAIL** | **PASS** | Banner now matches events; unknown slug rejected pre-fabrication |
| 10 | Currency-aware | N/A | N/A | This ORCH doesn't touch currency |
| 11 | One auth instance | PASS | PASS | Unchanged |
| 12 | Validate at right time | PASS | PASS | Local-time date math intact |
| 13 | Exclusion consistency | PASS | PASS | Same resolution rules across v1 + v2 paths |
| 14 | Persisted-state startup | PASS | PASS | Pre-M2.1 cache entries auto-fall to `false` via `?? false` guard |

**Constitution #3 and #9 both flip from FAIL → PASS as a direct result of P1-1 + P1-2 closures.**

### Gates re-run

| Gate | Result |
|---|---|
| `deno check supabase/functions/ticketmaster-events/index.ts` | PASS (exit 0, no diagnostics) |
| `cd app-mobile && npx tsc --noEmit --skipLibCheck` (filtered to touched files) | PASS — zero new errors |
| Pre-existing unrelated tsc errors in `ConnectionsPage.tsx:2763` + `HomePage.tsx:246,249` | Still present, NOT introduced by M2.1, NOT in M2.1 scope |

### Remaining audit items (deferred per dispatch's explicit framing, NOT blocking M3)

| Item | Severity | Status | Disposition |
|---|---|---|---|
| P2-2 | NightOutCache payload doesn't include segment+city+dateFilter (only fallbackActive) | P2 | PARTIAL | M2.1 added `fallbackActive` because P1-1 required it. Full duplication of segment/city/dateFilter into payload remains defense-in-depth only — the cache KEY is authoritative. Acceptable. |
| P2-3 | `getTodayDateString` hardcoded `America/New_York` | P2 | OPEN | Pre-existing inconsistency with I-PROPOSED-BI. Candidate ORCH-0809-C. NOT blocking M3. |
| P2-5 | Reverse-geocode race causing one-RTT wrong-city flash | P2 | OPEN | One-RTT UX glitch only, no data corruption. Acceptable; revisit if testers reproduce. |
| P3-1 | Empty `DISCOVER_GENRE_ID` maps mean genre chips silently no-op | P3 | OPEN | SPEC §5.3 permits. M3 closes when operator runs TM classifications curl. |
| P3-2 | Anon user city is session-only | P3 | OPEN | Probably intentional; confirm with product. |

### M3 readiness checklist

- ✅ Two P1 findings closed with code-level evidence at cited line numbers
- ✅ Constitution #3 + #9 restored to PASS
- ✅ Deno typecheck PASS on edge function
- ✅ tsc PASS on touched mobile file
- ✅ Backward compat preserved (v1 caller still works)
- ✅ No new P0/P1 introduced by M2.1
- ✅ Two pre-existing P2s (P2-1, P2-4) folded into M2.1 alongside P1 fixes
- ⏳ Remaining P2/P3 explicitly accepted as deferred-not-blocking
- ⏳ Operator's TM `/classifications` curl is still the M3 unblock for extending segments/genres

**M3 is cleared for dispatch.** Strict-grep gates will lock in correct behavior, not bug-state. Deno + Jest tests will codify the constitutional restoration. The two new server-side guards (unknown-slug 400, both-location 400) should also be added to the M3 strict-grep gate scope as positive assertions ("edge function MUST contain `unknown segmentSlug` rejection literal" + "edge function MUST contain `pass either city or location, not both` rejection literal") so the validation can't regress.

### Discoveries for orchestrator (re-audit-specific)

- The `?? false` transitional safety floor on cache-hit `setFallbackActive(cached.fallbackActive ?? false)` is doing dual duty: (a) protecting against pre-M2.1 cache entries already in users' AsyncStorage, and (b) handling JSON.parse edge cases where the field is unexpectedly null/undefined. P4 praise — defensive design.
- The Deno typecheck on the edge function is currently being run by Claude in this session via `/Users/sethogieva/.deno/bin/deno`. Codex parity rule 8 says "Deno gates are run by the executor" — implementor satisfied this in M2.1. M3's Deno tests will be a fresh gate.
- The `supported: Object.keys(DISCOVER_SEGMENT_ID)` array in the 400 response body is a small but very nice DX improvement — any direct caller hitting the new validation gets the accepted-slug list inline. Worth flagging as a pattern to repeat in other edge function input validators across the codebase.

### Verdict summary

```
Layman summary:
- Re-audited the M2.1 implementation against the two P1 findings from the
  pre-M3 audit. Both closed at the code level. Constitution rules #3 and
  #9 (silent failures + fabricated data) flip from FAIL to PASS on the
  Discover surface.
- Two adjacent P2s (banner stuck on error, missing both-city-and-location
  guard) were folded into the M2.1 fix blocks alongside the P1s.
- M3 is cleared for dispatch.

Verdict: PASS
- P0: 0 | P1: 0 | P2: 3 (was 5) | P3: 2 | P4: 5
- Report: this file, §13

Blocking issues: None

Discoveries for orchestrator:
- Process invariant candidate: "any user-selectable filter dimension MUST
  either be validated at the server boundary OR explicitly degrade with a
  user-visible signal — never silently fall through to a default" — still
  unregistered, still worth codifying after three iterations of this bug
  class in ORCH-0809 alone.
- Recommend M3 strict-grep gate scope include positive assertions for the
  two new 400 guards so they can't regress.
```

**End of §13 re-audit. M3 dispatch authorized.**
