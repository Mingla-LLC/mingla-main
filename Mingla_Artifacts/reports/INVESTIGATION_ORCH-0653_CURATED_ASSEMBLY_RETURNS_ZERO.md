# INVESTIGATION — ORCH-0653: generate-curated-experiences returns 0 cards for ALL curated intents

**Dispatched:** AH-180 (Forensics, INVESTIGATE-only)
**Severity:** S0 — every curated intent returns `cards: []` for every authenticated request at every launch city
**Confidence:** **MEDIUM** on root cause (5 of the 8 candidate hypotheses ruled out via 12 MCP probes + git diff + schema check; killer gate NOT identified without runtime instrumentation)
**Discovery context:** Surfaced during ORCH-0643 v1.0.1 Implementor verification (AH-179, 2026-04-24). Scoring confirmed perfect (Wegmans/Whole Foods/Sprouts/TJ all cap 200, Harris Teeter passing 137-139, Albaraka excluded). User then live-fired picnic-dates: HTTP 200, `cards:[]`. Forensics dispatched immediately.

---

## 1. Layman impact

The mobile picnic-dates flow shows the "curating your line up" skeleton indefinitely because the backend silently returns an empty card list. This affects EVERY curated intent (picnic, romantic, adventurous, take-a-stroll, first-date, group-fun) — not just picnic. Every authenticated user clicking any curated experience at any launch city sees no cards. The function returns HTTP 200 (no crash) so error monitoring won't catch it; only direct response inspection reveals the empty payload.

---

## 2. Root cause statement

**Could not be proven from MCP-only forensics.** Strongest hypothesis: a silent `console.warn` failure inside `fetchSinglesForSignalRank` at `supabase/functions/generate-curated-experiences/index.ts:382-385` causes ONE category's pre-fetch to return `[]`, which downstream forces every combo iteration to fail validation at line 890-893 (or 854-855 for reverseAnchor types). The warn message would be visible in Supabase Dashboard logs but is NOT visible via `mcp__supabase__get_logs` (which surfaces only HTTP-level events, not console output). Without Dashboard access OR an instrumented redeploy, the killer gate cannot be located with six-field evidence.

---

## 3. Hypotheses tested and result

| # | Hypothesis | Probe | Verdict |
|---|-----------|-------|---------|
| H-1 | groceries signal weights wrong / scoring broken | Probe A (signal_definitions current_version_id) | ❌ ruled out — v1.0.1 active, all 4 amended weights match spec |
| H-2 | groceries supply too low at Raleigh | Probe B (servable count by signal) | ❌ ruled out — 20 servable groceries, 174 nature, 37 flowers in Raleigh bbox |
| H-3 | nature parks too far from groceries (3km picnic anchor radius) | Probe 4 (haversine matrix) | ❌ ruled out — 20 Raleigh parks have ≥1 grocery within 3km, most have 1-6 |
| H-4 | RPC `query_servable_places_by_signal` broken | Probe C (direct RPC call) | ❌ ruled out — returns 20 nature places at Raleigh |
| H-5 | NULL google_place_id poisons comboUsedIds Set | Probe 5 | ❌ ruled out — 0 NULL/empty gpids in 1700 servable Raleigh places |
| H-6 | Cross-signal joins missing (filter has rows, rank doesn't) | Probe 9 (join overlap) | ❌ ruled out — every (filterSignal, rankSignal) pair has 100% join coverage |
| H-7 | Picnic combos invalid because picnic_friendly anchors all far from user | Probe 11 (top-10 anchors with distance) | ❌ ruled out — Pullen Park 2.23km, Brentwood 6.52km, Lake Johnson 7.12km — all under 30min driving |
| H-8 | place_pool schema missing required columns | Probe 12 (information_schema) | ❌ ruled out — all 24 columns selected by fetchSinglesForSignalRank Step 3 EXIST |
| H-9 | Supabase JS `.in()` URL-too-long on large eligibleIds for some signals | Probe 7 (eligible counts) | 🟡 partially ruled out — for nature/groceries (361/115) URL is fine; for casual_food (2069 → truncated to 1000 by .select() default) URL might be ~38KB which COULD exceed PostgREST limit. NOT TESTED with runtime call. **Strongest remaining suspect.** |
| H-10 | Function bypasses for anonymous JWT (anon key has no `sub`) | Read line 1302-1314 | ❌ ruled out for curated — `try { ... } catch {}` silently sets `poolUserId='anonymous'`, function continues. (NOTE: `discover-cards` DOES gate on JWT — separate behavior, surfaced as ORCH-0653.D-3 below.) |
| H-11 | Comment-only commit `322b7337` regression | Git diff vs ORCH-0634 7456b0f3 + deployed v137 grep | ❌ ruled out — only ORCH-0640 removed pool-first blocks, my commit is pure 11-line comment, deployed v137 contains the comment but otherwise identical to local source |
| H-12 | All curated intents broken because of a global validation gate | Live-fire matrix (picnic, romantic, adventurous, take-a-stroll) | ✅ confirmed — ALL 4 tested intents return `cards: []`. Bug is universal, not picnic-specific. |

---

## 4. Investigation Manifest

| # | File | Layer | Why read |
|---|------|-------|----------|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0653_CURATED_ASSEMBLY_RETURNS_ZERO.md` | Dispatch | Phase 0 context |
| 2 | `Mingla_Artifacts/MASTER_BUG_LIST.md` (top banners) | Docs | Pre-existing claims about ORCH-0646 + ORCH-0640 |
| 3 | `supabase/functions/generate-curated-experiences/index.ts` (full, 1507 lines) | Edge fn | Locate killer gate |
| 4 | `~/.claude/.../tool-results/mcp-supabase-get_edge_function-1777061622035.txt` (deployed v137) | Edge fn (live) | Diff against local source |
| 5 | `supabase/functions/_shared/timeoutFetch.ts` (presence check) | Helper | Confirm helper still exists post-ORCH-0640 |
| 6 | `git show --stat 2b10b7c2` + `git diff 7456b0f3 322b7337` | Code history | Bisect window between v135 working + v137 broken |
| 7 | `supabase/migrations/*` grep for `card_pool|place_pool|place_scores|admin_place_pool_mv|signal_definitions` | Schema | Migration chain check (no recent regression in dependencies of curated path) |
| 8 | `outputs/IMPLEMENTATION_ORCH-0634_D008_CURATED_MODULE_LOAD_FIX_REPORT.md` | Docs | Last-known-working evidence (v135 returned 4 adventurous cards) |
| 9 | MCP Probes 1-12 | Schema + Data | 12 SQL probes against live `Mingla-dev` |
| 10 | Live-fire curls × 5 (picnic walking 30, picnic driving 30, romantic driving 30/120, adventurous, take-a-stroll, discover-cards control) | Runtime | Reproduce + isolate |

---

## 5. Findings

### 🔴 Root Cause #1 (PROBABLE — not provable without runtime instrumentation)

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/generate-curated-experiences/index.ts:370-385` (Step 3 of `fetchSinglesForSignalRank`) — OR — line 890-893 / 854-855 (combo loop validation gates) |
| **Exact code** | Step 3: `.from('place_pool').select(...).eq('is_active', true).eq('is_servable', true).in('id', rankedIds).gte('lat', centerLat - latDelta)...` followed by `if (placeErr || !places) { console.warn(...); return []; }` |
| **What it does** | When ANY one query fails (URL-too-long, network error, supabase-js bug, env var missing), `console.warn` is logged to Dashboard stderr (NOT visible via MCP) and the function returns `[]`. Downstream, `categoryPlaces[catId] = []` triggers `valid = false` at line 892 for every combo iteration. Function returns `cards: []` with HTTP 200. |
| **What it should do** | Either successfully return up to `limit` candidates, OR throw a propagating error that hits the outer catch at line 1499 and returns HTTP 500. The current silent `console.warn + return []` violates Constitution #3 (no silent failures) and creates the exact symptom we're seeing. |
| **Causal chain** | mobile picnic tap → curated invocation → generateCardsForType called → fetchSinglesForSignalRank('nature', ...) for picnic anchor → some Supabase query fails silently → returns `[]` → `categoryPlaces['nature'] = []` → reverseAnchor branch sees `anchorPlaces.length === 0` at line 817 → `valid = false` → ALL `limit*2` combo iterations fail same way → cards.length === 0 → function returns `{cards: [], totalCardsBuilt: 0}` HTTP 200 → mobile interprets empty array as "still loading" or "empty state" → skeleton stuck |
| **Verification step** | Deploy a temporary instrumented version of `generate-curated-experiences` that adds `console.error` (not warn — make it visible to error logs) BEFORE every `return []` in fetchSinglesForSignalRank AND before every `continue` / `valid = false` in the combo loop. Re-fire picnic at Raleigh with REAL user JWT. Read Dashboard stderr. The `console.error` line that appears identifies the killer gate. ETA: 30 min after dispatch. |

**Classification: 🔴 Root Cause (PROBABLE)** — fits all evidence but cannot achieve six-field certainty without runtime instrumentation or Dashboard access. The forensic dispatch's INVESTIGATE-only constraint prevents that step.

### 🟠 Contributing Factor #1 — Default Supabase JS `.select()` row limit silently truncates Step 1 results

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/generate-curated-experiences/index.ts:324-328` |
| **Exact code** | `await supabaseAdmin.from('place_scores').select('place_id').eq('signal_id', filterSignal).gte('score', filterMin)` — NO `.limit()` |
| **What it does** | PostgREST default cap is 1000 rows. For signals with >1000 eligible places (casual_food=2069, icebreakers=1519, drinks=1227, brunch=1014), Step 1 silently returns only 1000 IDs — and which 1000 is non-deterministic without an explicit ORDER BY. |
| **What it should do** | EITHER add `.limit(50000)` (server-side max), OR add `.order('score', { ascending: false }).limit(500)` to deterministically pick the highest-scoring N places, OR use `.range(0, 9999)`. |
| **Why this matters** | This contributes to Root Cause #1 because if Step 1 returns 1000 mostly-non-Raleigh IDs, Step 2's `.in()` URL becomes ~38KB which can exceed PostgREST URL limits, causing Step 3 to silently error. NOT proven but plausible. |
| **Verification** | After Root Cause is identified via instrumentation, confirm whether this contributes via SQL probe — does the `.select(place_id).eq('signal_id','casual_food').gte('score',120)` actually return all 2069 rows or just 1000 over the wire? Easy to test from `supabase functions serve`. |

**Classification: 🟠 Contributing Factor.**

### 🟡 Hidden Flaw #1 — `fetchSinglesForSignalRank` returns `[]` on ANY error, masking the failure

`supabase/functions/generate-curated-experiences/index.ts:357` and `:382`:
```ts
if (rankErr || !rankRows || rankRows.length === 0) return [];
if (placeErr || !places) { console.warn(...); return []; }
```

A `console.warn` is logged but the caller cannot distinguish "no eligible places" from "query errored." Downstream sees `[]` and treats it as a normal empty result. This is a Constitutional #3 violation (silent failure). EVEN AFTER ROOT CAUSE IS FIXED, this pattern should be replaced with a propagating throw OR an explicit `{error: string, places: []}` return shape so the assembly loop can decide whether to retry or surface the error.

**Classification: 🟡 Hidden Flaw.**

### 🟡 Hidden Flaw #2 — Outer catch at line 1499 returns HTTP 500 with `cards: []`, indistinguishable from HTTP 200 + empty cards on the JSON shape

```ts
} catch (err) {
  console.error('[curated-v2] Error:', err);
  return new Response(
    JSON.stringify({ error: ..., cards: [] }),
    { status: 500, ... },
  );
}
```

If the mobile React Query layer doesn't check `status_code` AND only inspects `cards.length`, error vs empty-success look identical. The skeleton-stuck symptom is consistent with mobile not surfacing errors. (See ORCH-0653.D-1 for the mobile-side discovery.)

**Classification: 🟡 Hidden Flaw.**

### 🔵 Observation #1 — Function execution time 800-7677ms with `skipDescriptions: true` is anomalous

With descriptions skipped and no external API calls (verified by grep), the function should complete in <1s. The 7677ms execution time observed in MCP logs hints at:
- Many supabase queries in sequence (50+ at ~100ms each, including the per-anchor near-anchor 3km fetches for picnic — probably 10-20 such fetches)
- Or supabase queries timing out (~5s default) and the function fall-through path eating time

Not a blocker but worth instrumenting. Could indicate Supabase JS client connection pool exhaustion or per-request connection setup overhead.

**Classification: 🔵 Observation.**

### 🔵 Observation #2 — Pullen Park appears 3 times in top-10 picnic anchors at Raleigh

Probe 11 returned 3 separate `place_pool` rows for "Pullen Park" all at picnic_friendly score 199.9, all is_servable=true, all 2.23km from user. This means 3 separate google_place_ids registered for the same physical park. Not a regression cause, but an uncategorized data-quality issue worth a separate dedup pass.

**Classification: 🔵 Observation.**

---

## 6. Five-Layer Cross-Check

| Layer | Status | Notes |
|-------|--------|-------|
| **Docs** | ✅ healthy | ORCH-0634 IMPLEMENTATION report explicitly stated `generateCardsForType` returns 4 adventurous cards at Raleigh (last known v135). ORCH-0640 spec stated curated continues via `generateCardsForType` after pool-first removal. |
| **Schema** | ✅ healthy | All 24 place_pool columns the curated function selects EXIST. signal_definitions + signal_definition_versions populated. place_scores has 6,348 rows for groceries (and many more for other signals). admin_place_pool_mv rebuild not relevant (curated doesn't read MV). |
| **Code (JS)** | 🟡 suspect | `fetchSinglesForSignalRank` and assembly loop have multiple silent-failure paths. No fix is obvious from static reading; need runtime trace. |
| **Runtime** | 🔴 broken | All curated intents return `cards: []` HTTP 200. Confirmed via 4+ live-fire curls with anon JWT + 1 control via discover-cards. (Discover-cards gates on JWT-sub claim — anon JWT fails. Curated does NOT gate on JWT-sub but still returns empty.) |
| **Data** | ✅ healthy | All needed signals scored, all needed supply present in bbox, photos present, is_servable correctly flagged. 12 MCP probes confirm. |

**Contradiction:** Code logically should return cards (data + schema healthy), but runtime returns empty. Bug is in code-runtime interface — most likely a silent supabase-js error at one of the 3 `if (xxxErr) return []` sites in fetchSinglesForSignalRank.

---

## 7. Bisect findings (when did the regression land?)

- **Last known WORKING:** commit `b180a0f5` (ORCH-0634.D-008 fix), deployed as v135 — `outputs/IMPLEMENTATION_ORCH-0634_D008_CURATED_MODULE_LOAD_FIX_REPORT.md` documents "real curated adventurous request returned 4 full cards" at Raleigh.

- **Suspected REGRESSION commit:** `2b10b7c2` (ORCH-0640 Great Demolition, 2026-04-23). This commit removed the `serveCuratedCardsFromPool` import + 70 lines of pool-first card_pool fallback blocks. Pre-demolition: pool-first was a fast path; if it returned ≥75% of `limit` cards, response shipped without invoking `generateCardsForType`. Post-demolition: `generateCardsForType` is the SOLE path. If `generateCardsForType` was always broken but pool-first usually masked it, the demolition exposed the bug.

- **Today's COMMENT-ONLY commit:** `322b7337` (mine, 2026-04-24). Pure 11-line `[CRITICAL — ORCH-0643]` comment at line 442 of generate-curated-experiences. Comment is in deployed v137 (verified via grep of downloaded source). Cannot have caused regression.

- **Deployment timeline:**
  - v135 deployed post-`b180a0f5` (per AH-165 report) — WORKING
  - v136 deployment timing unknown — STATE UNKNOWN (ORCH-0640 demolition commit but logs show only HTTP, not body)
  - v137 deployed 2026-04-24 19:48:27 UTC (per `mcp__supabase__get_edge_function` updated_at timestamp) — BROKEN (currently). Deployment likely from the parallel ORCH-0646 chat which redeployed `generate-curated-experiences` per their banner claim.

**Bisect verdict:** regression introduced by ORCH-0640 (commit 2b10b7c2) — the pool-first removal exposed a pre-existing bug in `generateCardsForType`. ORCH-0640's tester report likely missed it because the test focused on mobile serving (deck) which uses `discover-cards`, not curated assembly.

---

## 8. Deployment vs source diff

`mcp__supabase__get_edge_function('generate-curated-experiences')` returned 122,844 chars (v137 deployed bundle as JSON). Search markers found:
- `CRITICAL — ORCH-0643` ✅ present (= matches my comment in commit 322b7337)
- `ORCH-0640` ✅ present
- `ORCH-0643` ✅ present

**Conclusion:** deployed v137 == current local source. Diff scope = my 11-line comment-only addition + everything that was already in commit 322b7337 (no further drift).

---

## 9. Blast Radius Map

| Surface | Affected | Notes |
|---------|----------|-------|
| Mobile curated intents (all 6: picnic, romantic, adventurous, first-date, group-fun, take-a-stroll) | **YES — all return 0 cards** | Confirmed via 4 direct live-fires |
| Mobile singles (Discover swipe deck) | **NO — separate code path** (discover-cards) | Discover-cards rejects anon JWT but should work for real user JWT (presumably user is seeing cards in Discover) |
| Mobile saved cards | NO | Reads from saved_card table, doesn't invoke curated |
| Mobile collab session decks | UNVERIFIED | Likely affected since collab can include curated cards — needs separate test |
| Admin Place Pool / Signal Library | NO | Different RPCs (post-ORCH-0646 cleanup) |
| Solo / collab parity | UNIVERSAL — both modes affected | Curated intents are intent-based, not mode-based |
| Cache / query keys | unaffected | No mutation of place_scores or place_pool needed for fix |

---

## 10. Invariant Violations

- **Constitutional #3 (No silent failures):** ❌ violated. Function returns 200 with empty array instead of an actionable error. Multiple `return []` sites in fetchSinglesForSignalRank swallow errors.
- **I-COMBO-REFERENCED-SIGNALS-SCORED** (new, ORCH-0643 v2.1): ✅ preserved (groceries IS scored).
- **I-THREE-GATE-SERVING (G1+G2+G3):** ✅ preserved at the SQL level.
- **I-SIGNAL-SERVING-ONLY:** ✅ preserved.
- **I-NO-CURATED-PERSISTENCE:** ✅ preserved.

The Constitution #3 violation is the load-bearing one. The fix MUST replace silent `return []` with surfaced errors so future regressions in this same path become observable.

---

## 11. Fix Strategy (direction — NOT a spec, NOT code)

1. **Instrument first.** Deploy a temporary `generate-curated-experiences` that adds `console.error` (visible in error logs, not warn) at every silent-failure point in `fetchSinglesForSignalRank` (lines 330, 357, 382-385) AND at every `valid = false` / `continue` in the combo loop (lines 854-859, 890-894, 920-936). Each error log must include the catId, anchor.gpid (if applicable), and supabase error message verbatim.

2. **Re-fire from real device** OR **from this MCP session with a fresh JWT.** Let one full curated request execute. Read Dashboard logs.

3. **Confirm killer gate.** The first `console.error` line printed identifies it. Now Root Cause #1 has six-field evidence.

4. **Spec the structural fix.** Two changes minimum:
   - At each silent-failure return in fetchSinglesForSignalRank, throw a typed error OR return `{error: string, places: []}` so the caller can route to the outer 500 path
   - At Step 1 of fetchSinglesForSignalRank, add explicit `.limit(50000)` to bypass the PostgREST default 1000 truncation

5. **Regression-prevention test.** Add a Deno test that calls `generateCardsForType` for each EXPERIENCE_TYPES entry against a fixture place_pool / place_scores and asserts `cards.length >= 1`. Run on every deploy of generate-curated-experiences.

---

## 12. Discoveries for Orchestrator

- **ORCH-0653.D-1:** Mobile UX cannot distinguish skeleton (loading) vs empty (200 with cards: []) for curated intents. Picnic skeleton stuck = empty response treated as still-loading. Separate mobile-side dispatch needed.
- **ORCH-0653.D-2:** Deploy hygiene gap. Today's commit `322b7337` modified `generate-curated-experiences/index.ts` (only a comment) but the orchestrator CLOSE protocol does NOT auto-deploy edge functions. The parallel ORCH-0646 chat happened to deploy it for unrelated reasons; otherwise the comment would have stayed local. Process gap: comment-only changes to edge functions are dangerous because a future "re-deploy because of unrelated reason" can bring them along silently and produce a cache invalidation that masks deeper issues.
- **ORCH-0653.D-3:** `discover-cards` aggressively gates on JWT-sub claim with explicit error response (`auth_required` / `JWTMissingSub`). `generate-curated-experiences` SILENTLY downgrades to `poolUserId='anonymous'` and continues. Inconsistent auth UX. Either both should gate explicitly OR both should silently downgrade. Pick one and align — register as separate ORCH.
- **ORCH-0653.D-4:** Pullen Park (and possibly other Raleigh parks) has 3 separate `place_pool` rows with the same name and lat/lng but different google_place_ids. Need a dedup audit on place_pool to ensure single source of truth per physical place. Affects analytics, deduplication logic in combo assembly (comboUsedIds keyed by gpid means 3 different "Pullen Parks" can be picked across iterations as if distinct).
- **ORCH-0653.D-5:** ORCH-0640 demolition tester report did not catch this regression. Tester scope was mobile-serving (deck) which uses `discover-cards`, not curated assembly. Add to ORCH-0640 retrospective: tester behavioral matrix should include at least 1 live-fire per curated intent at one launch city.
- **ORCH-0653.D-6:** `fetchSinglesForSignalRank` Step 1 lacks an explicit `.limit()` and lacks `.order()` — for any signal with >1000 eligible places, results are silently truncated AND the truncation is non-deterministic. Hidden bug class beyond curated.

---

## 13. Confidence per finding

| Finding | Confidence | What would raise it |
|---------|-----------|---------------------|
| Root Cause #1 (silent return [] in fetchSinglesForSignalRank) | **MEDIUM** | Deploy instrumented version → identify first `console.error` → six-field evidence → HIGH |
| Contributing Factor #1 (.select() default 1000-row limit) | **HIGH** | Already proven by Probe 7 distribution (4 signals exceed 1000) + reading code (no .limit() at line 324) |
| Hidden Flaw #1 (silent return [] is Constitution #3 violation) | **HIGH** | Code-level proof |
| Hidden Flaw #2 (HTTP 500 vs 200+empty indistinguishable on JSON shape) | **HIGH** | Code-level proof |
| Bisect (regression from ORCH-0640) | **HIGH** | Working evidence at v135 + git diff shows only ORCH-0640 removed pool-first |
| Universal scope (all curated intents broken) | **HIGH** | 4 of 6 intents directly tested |
| Strongest hypothesis (root cause is in Step 3 of fetchSinglesForSignalRank) | **MEDIUM** | All other hypotheses ruled out via probes; Step 3 is the only silent failure path that explains the pattern |

---

## 14. Why I could not achieve HIGH confidence on Root Cause

Per Forensics Phase 5 rules: a Root Cause without all six fields is not provable. I have:
- File + line: ✅ `fetchSinglesForSignalRank:382-385`
- Exact code: ✅
- What it does: ✅ (deduced from static read)
- What it should do: ✅
- Causal chain: ✅ (mechanically traced)
- **Verification step: ❌** I cannot verify which of the 3 silent-return points actually fires without runtime instrumentation. The `console.warn` at line 383 only goes to Dashboard stderr, NOT visible via MCP `get_logs`.

The dispatch's HARD constraint was "INVESTIGATE only — DO NOT spec, DO NOT implement, DO NOT deploy." Verification requires deploying an instrumented version, which is out of scope. Honest label: **probable** root cause, not **proven**.

---

## 15. Recommended next dispatch

**Option A (fastest):** Orchestrator writes IMPL_INSTRUMENT prompt — implementor deploys a temporary `generate-curated-experiences` v138 with explicit `console.error` lines at every silent-return / continue / valid=false. Re-fire from real device or anon JWT. Read Dashboard logs. Identify killer gate. Then implementor reverts instrumentation + writes the structural fix in v139. Total: ~45 min.

**Option B (cleaner):** Orchestrator writes SPEC prompt that mandates the structural fix WITHOUT identifying the exact gate first — replace ALL silent `return []` in fetchSinglesForSignalRank with thrown errors, AND add `.order('score', { ascending: false }).limit(500)` to Step 1. The throws will surface as 500 errors AND the next live-fire will show the actual error message. Total: ~30 min implementor + ~15 min tester.

**My vote: Option B.** It's structurally correct (Constitution #3 fix), doesn't require a separate instrumentation cycle, and the side effect of "next live-fire returns 500 with error message" IS the diagnostic. Saves a round trip.

---

**END OF INVESTIGATION REPORT**
