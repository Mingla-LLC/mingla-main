# IMPLEMENTATION — ORCH-0809 Slice M2.1 — Pre-M3 P1 Fix Slice

**ORCH-ID:** ORCH-0809
**Slice:** M2.1 (surgical fix slice addressing two P1 findings from the pre-M3 audit)
**Status:** implemented and verified
**Verification:** Deno typecheck PASS, tsc PASS on touched file; both P1 audit findings structurally closed
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Audit driving this slice:** `Mingla_Artifacts/reports/QA_ORCH-0809_PRE_M3_AUDIT_REPORT.md`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md`
**Prior slices:** M1 + M2 + two cache-key hotfixes (`*_M1.md` + `*_M2.md` reports)

---

## §1 Mission Recap

The pre-M3 audit flagged two P1 findings that would have been locked in by M3's strict-grep gates as if they were correct behavior:

- **P1-1** — the "showing nearby because city has no events" banner state drifts from rendered events on cache hits, because the cache payload doesn't carry the `fallbackActive` flag. Reproduces in two steps of city-switching, produces a Constitution #9 (fabricated UX) violation.
- **P1-2** — unknown `segmentSlug` silently falls back to Music at the edge function. Same bug class as the deleted price filter; Constitution #3 (silent failure) + Constitution #9 (fabrication) both fail when a future client passes a segment slug whose ID isn't yet shipped.

M2.1 closes both with surgical edits (no scope creep). One adjacent P2 (`fallbackActive` not reset on fetch error) was fixed alongside P1-1 because the same code block needed touching and it's the same conceptual bug — banner drift on the error path. The other P2 items (NY-timezone hardcode, payload extension to include segment/city/dateFilter) remain registered but deferred to keep the slice tight.

## §2 Files Changed (Old → New Receipts)

### File 1 — `supabase/functions/ticketmaster-events/index.ts` (EDGE FUNCTION VALIDATION)

**What it did before:**
- Imported `resolveTmClassification`, `DiscoverSegmentSlug`, `DiscoverGenreSlug` from `_shared/ticketmasterClassifications.ts`.
- Validated only "city OR location must be present" + `localStartEndDateTime` format.
- Called `resolveTmClassification(segmentSlug, genreSlugs ?? [])` which silently returned Music's ID for any unrecognized segment slug.
- Silently accepted requests with BOTH city AND location (the URL builder preferred city; no error).

**What it does now:**
- Imports `DISCOVER_SEGMENT_ID` alongside the existing imports (no signature change to the shared module).
- After the "city OR location" check, adds a symmetric **"NOT both city AND location"** guard → returns HTTP 400 `{ error: "pass either city or location, not both" }` if both are provided. Matches the service-layer guard at `nightOutExperiencesService.ts:98-102`.
- After the both-or-neither location guards, adds a **segment validation guard**: if `segmentSlug !== undefined && !(segmentSlug in DISCOVER_SEGMENT_ID)` → returns HTTP 400 `{ error: "unknown segmentSlug: <value>", supported: [...] }`. The `supported` array surfaces the accepted slug list so any direct caller can self-correct without reading source.
- `undefined` `segmentSlug` continues to default to Music via `resolveTmClassification` for backward-compat with v1 callers.

**Why:** P1-2 audit fix. Eliminates Constitution #3 + Constitution #9 violations at the classification boundary. Aligns the edge function's input validation with the service-layer's expected guarantees (the service rejects both-city-and-location, so the edge function rejecting it too is the symmetric server-side guard).

**Lines changed:** +21 (3 new imports addition, 1 validation block of ~10 lines for both-location, 1 validation block of ~10 lines for unknown segment).

**Constitutional alignment:**
- Restores #3 (no silent failures) — unknown slug now surfaces structured 400 instead of returning Music events.
- Restores #9 (no fabricated data) — client cannot receive Music events labeled under a different segment.

### File 2 — `app-mobile/src/components/DiscoverScreen.tsx` (CACHE PAYLOAD + BANNER STATE)

**What it did before:**
- `NightOutCache` interface stored `{ date, venues, genre }` only — `fallbackActive` was not persisted.
- `saveNightOutCache(venues)` saved without capturing `fallbackActive`.
- Cache-hit branch in `fetchNightOutEvents` (lines 1019-1030) restored `nightOutCards` but did NOT touch `setFallbackActive` — banner state kept its previous value from a different filter combination.
- Success branch set `setFallbackActive(meta?.usedFallback === true)` only on fresh fetches.
- Error catch branch did NOT clear `fallbackActive` — the banner stayed visible on failed retries.

**What it does now:**
- `NightOutCache` interface extended with `fallbackActive: boolean`. Comment block documents:
  - The filter dimensions (city, segment, dateFilter, genre) authoritatively live in the cache KEY (not the payload — TTL date and the genre check are redundant with the key, but kept for defense-in-depth).
  - The payload's only must-have new field is `fallbackActive` for banner restoration.
- `saveNightOutCache(venues, fallbackActiveAtSave)` now takes a second argument and writes it into the payload. The single caller (the fetch success branch) passes `usedFallbackNow` — the same value just written to React state.
- Cache-hit branch now reads `cached.fallbackActive` and calls `setFallbackActive(cached.fallbackActive ?? false)` — `?? false` is the transitional-safety floor for any pre-M2.1 cache entries that may still be in AsyncStorage (those entries auto-expire over TTL within the same calendar day).
- Success branch stores the result of `meta?.usedFallback === true` in a `usedFallbackNow` local, sets state from it, and passes it into `saveNightOutCache(cards, usedFallbackNow)` — single source of truth between state and cache.
- Error catch branch sets `setFallbackActive(false)` so the banner doesn't stay stuck on failed fetches.

**Why:** P1-1 audit fix (banner drift on cache hit) + P2-1 audit fix (banner stuck on after error). Restores Constitution #9 — banner copy now matches the events actually being displayed in all four states (fresh-success, cache-hit, fresh-error, retry).

**Lines changed:** ~18 (4 lines on the interface + 7 lines on `saveNightOutCache` + 5 lines on the cache-hit + success branches + 2 lines on the catch branch).

## §3 Audit Findings Coverage Matrix

| Audit finding | Severity | Status after M2.1 | Evidence |
|---|---|---|---|
| **P1-1** — Banner state drift on cache hits | P1 | **CLOSED** | `NightOutCache.fallbackActive` field persisted + restored on cache hit; banner state now coupled to displayed events in all paths |
| **P1-2** — Unknown segmentSlug silent fallback to Music | P1 | **CLOSED** | Edge function 400s with `{ error, supported }` when slug is not in `DISCOVER_SEGMENT_ID`; verified by Deno typecheck on the new validation block |
| **P2-1** — `setFallbackActive` not reset on error | P2 | **CLOSED** (folded into P1-1 fix block) | `setFallbackActive(false)` added to error catch branch |
| **P2-2** — `NightOutCache` payload missing segment/city/dateFilter | P2 | **PARTIAL** | `fallbackActive` added (necessary for P1-1). Full segment/city/dateFilter inclusion deferred — the cache KEY already carries them authoritatively; payload duplication is defense-in-depth only and not required to close any P1. Deferred to a future cleanup. |
| **P2-3** — `getTodayDateString` hardcoded `America/New_York` | P2 | **NOT FIXED** | Pre-existing inconsistency; deferred per the dispatch's "optional, not required" framing. Worth a separate ORCH-0809-C candidate. |
| **P2-4** — Edge function doesn't 400 on both city+location | P2 | **CLOSED** (folded in alongside P1-2 since both are server-side input validation in the same handler) | New symmetric guard returns 400 if `city && location?.lat && location?.lng` |
| **P2-5** — Brief wrong-city flash if reverse-geocode resolves before prefs | P2 | **NOT FIXED** | One-RTT UX glitch; would require a `prefsLoaded` gate adding complexity. Deferred per dispatch's "not required" framing. |

## §4 Verification Matrix

| Check | Method | Result |
|---|---|---|
| Deno typecheck on edge function + shared classifications | `/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/ticketmasterClassifications.ts supabase/functions/ticketmaster-events/index.ts` | PASS (exit 0, no diagnostics) |
| tsc on touched mobile file | `cd app-mobile && npx tsc --noEmit --skipLibCheck` | PASS — zero new errors on DiscoverScreen.tsx (three pre-existing unrelated errors in `ConnectionsPage.tsx` + `HomePage.tsx` remain — flagged in M2 report, NOT introduced by this slice) |
| P1-1 reproduction trace (cache hit serves wrong banner state) | Code-trace: cache-hit branch now calls `setFallbackActive(cached.fallbackActive ?? false)`. Verified by reading the four affected paths (success-fresh, success-fallback, success-cache-hit, error-catch) — all four now correctly synchronize banner state with displayed events. | STRUCTURALLY CLOSED |
| P1-2 reproduction trace (unknown segmentSlug → Music) | Code-trace: edge function rejects unknown slug with 400 before reaching `resolveTmClassification`. Manual live-fire `POST /ticketmaster-events` with `segmentSlug: "comedy"` would now return 400 instead of 200 with Music events. | STRUCTURALLY CLOSED (live verification = M3 tester) |
| Backward compat — v1 caller still works | `segmentSlug === undefined` in request body → skips both new guards → `resolveTmClassification(undefined, ...)` defaults to Music's ID exactly as before. | PRESERVED |
| Backward compat — v2 caller with valid slug | `segmentSlug === "music"` or `"sports"` → passes the `in DISCOVER_SEGMENT_ID` check → proceeds normally. | PRESERVED |
| Cache key shape | UNCHANGED by this slice — M2 hotfix v2 key `v2_${userId}_city:_seg:_date:_gen:` still in place. | PRESERVED |

## §5 Invariant Preservation Check

| Invariant | Pre-M2.1 | Post-M2.1 |
|---|---|---|
| Constitution #2 — One owner per truth | PRESERVED | PRESERVED |
| Constitution #3 — No silent failures | **FAIL (audit P1-2)** | **RESTORED** — unknown slug now surfaces 400 |
| Constitution #4 — One key per entity | PRESERVED | PRESERVED |
| Constitution #9 — No fabricated data | **FAIL (audit P1-1 + P1-2)** | **RESTORED** — banner matches events; unknown slug rejected before fabrication |
| Constitution #13 — Exclusion consistency | PRESERVED | PRESERVED |
| I-PROPOSED-BL DISCOVER_CITY_PERSISTED | DRAFT — ready | DRAFT — ready (no change) |
| I-PROPOSED-BM DISCOVER_TM_CLASSIFICATION_BY_ID | DRAFT — partial (silent fallback gap) | DRAFT — **structurally complete now** (server-owned classification with explicit rejection of unknown slugs) |
| I-PROPOSED-BN DISCOVER_TM_LOCAL_TIME_WINDOWS | DRAFT — ready | DRAFT — ready (no change) |
| I-LOCATION-INVALIDATE-ON-LOCATION-ONLY | UNTOUCHED | UNTOUCHED |
| Zustand-persist no server snapshots | PRESERVED | PRESERVED |

## §6 Parity Check

This slice is mobile + edge function only. Does NOT touch admin or business surfaces. Cross-domain blast probe is unchanged from M2 — `grep` for the touched symbols returns only the Discover surface + the edge function.

| Side | Touched? | Notes |
|---|---|---|
| Solo / Collab | N/A | Discover has no solo/collab fork |
| iOS / Android / Web | Same code path | One platform's behavior == all platforms' behavior; tester verifies in M3 |
| `mingla-admin/` | Untouched | No consumer of `NightOutExperiencesService` or `ticketmaster-events` |
| `mingla-business/` | Untouched | Same |

## §7 Cache Safety Check

The cache key shape did NOT change in this slice. Existing M2-hotfix-v2 cache entries from the current operator session are still keyed correctly (`v2_userId_city:_seg:_date:_gen:`). The cache PAYLOAD shape changed (added `fallbackActive: boolean`), and the load branch falls back to `false` via `?? false` for any pre-M2.1 payloads that may sit in AsyncStorage. Those pre-M2.1 entries expire naturally within the same calendar day via the existing TTL date check.

No cache flush required. No version bump of the cache key prefix required.

## §8 Regression Surface

Adjacent features most likely to surface a regression from this slice:

1. **Discover cache hits across filter combinations** — switch city A (fallback) → city B (no fallback) → city A again. Banner should now correctly render on the third event-set even though it's served from cache.
2. **Edge function v1 backward compat** — direct callers that send v1 shape (no `segmentSlug`, no `city`) must still get a 200 with Music events. Verified by code trace; live verification in M3.
3. **Direct-API misuse** — any caller (now or future) that sends `{ city: "X", location: { lat, lng } }` will now get 400 instead of silent city-precedence. The current sole caller (`nightOutExperiencesService.ts:98-102`) already guards this client-side, so no in-app regression. External integrations would surface.
4. **Discover error handling** — pull-to-refresh on a city that fails returns user to the error empty-state; banner now correctly clears.
5. **Pre-M2.1 cache entries in production** — users with the M2-hotfix-v2 cache who upgrade to M2.1 will load entries without `fallbackActive` → falls back to `false` → banner renders only on fresh fetches until the entry expires. No crash, no wrong behavior — just a one-cycle "banner doesn't show on first cache hit after upgrade" UX nit. Auto-resolves within 2 hours (TTL).

## §9 Operator-Owned Steps

Per the dispatch's standing deploy split:

- **Migration:** NONE required for M2.1. No schema change.
- **Edge function deploy:** orchestrator-owned. After this report's approval, deploy with:
  ```
  /Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv
  ```
  Verify version bump via `mcp__supabase__list_edge_functions`. The deploy is safe to run independently — backward-compatible with v1 callers and with M2's deployed v2 shape; only adds rejection paths for previously-undefined edge-case inputs (unknown slug, both location+city).
- **EAS OTA:** required for the mobile-side payload-and-state fix. Per `feedback_eas_update_no_web.md`, run as two separate invocations:
  ```
  cd app-mobile && eas update --branch production --platform ios --message "ORCH-0809 M2.1: banner state drift + segment validation"
  cd app-mobile && eas update --branch production --platform android --message "ORCH-0809 M2.1: banner state drift + segment validation"
  ```

## §10 Discoveries for Orchestrator

- **Audit finding P2-3 (`getTodayDateString` NY timezone)** remains open. Recommend registering as ORCH-0809-C candidate (cleanup) or folding into M3's local-time strict-grep gate scope.
- **Audit finding P2-5 (reverse-geocode race)** remains open. UX glitch only, not a data issue. Worth a follow-up if testers reproduce.
- **Process invariant candidate for the registry:** *"Any user-selectable filter dimension MUST either be validated at the server boundary OR explicitly degrade with a user-visible signal — never silently fall through to a default."* Applies beyond Discover. This bug class has now appeared three times in ORCH-0809 alone (price filter as deleted, P1-2 segmentSlug, P1-1 banner-state-on-cache-hit). The audit registry should adopt this so M3's strict-grep gate scope can codify the rule.
- **Pre-existing unrelated tsc errors in `ConnectionsPage.tsx:2763` + `HomePage.tsx:246,249`** are still visible. Untouched by M2.1. Worth a separate cleanup ORCH.

## §11 Re-Audit Recommendation

The audit dispatch said: "after M2.1 returns clean, dispatch Claude `mingla-forensics` for a 5-min re-audit confirming P1 items closed, then Slice M3 follows."

Recommended re-audit scope (5 min):
1. Verify `NightOutCache` interface includes `fallbackActive` and `saveNightOutCache` writes it.
2. Verify the cache-hit branch in `fetchNightOutEvents` calls `setFallbackActive(cached.fallbackActive ?? false)`.
3. Verify the catch branch sets `setFallbackActive(false)`.
4. Verify the edge function returns 400 on unknown `segmentSlug`.
5. Verify the edge function returns 400 on both `city` AND `location` present.
6. Re-run the constitution 14-check — confirm #3 + #9 now PASS for the Discover surface.

After re-audit PASS, M3 (strict-grep gates + Deno/Jest tests + classification ID harvest) is unblocked.

---

**End of M2.1 report. Awaiting re-audit + M3 dispatch (or operator direction).**
