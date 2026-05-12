# IMPLEMENTATION — ORCH-0809 Slice M3 — Regression Lockdown

**ORCH-ID:** ORCH-0809
**Slice:** M3 (CI gates + Deno tests + mobile regression check + edge function deploy)
**Status:** implemented and verified
**Verification:** all 3 strict-grep gates PASS with negative-control proofs; 20/20 Deno tests PASS; 10/10 mobile regression checks PASS; edge function deployed to remote
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Operator directive:** "lets proceed. you have all the access execute" (2026-05-12)
**Prior slices:** M1 + M2 + 2 cache hotfixes + M2.1 + pre-M3 audit + re-audit
**Pre-M3 audit verdict:** PASS — `Mingla_Artifacts/reports/QA_ORCH-0809_PRE_M3_AUDIT_REPORT.md` §13

---

## §1 Mission Recap

M3 closes ORCH-0809 by locking the M1+M2+M2.1 implementation behind CI gates and independent tests. Three strict-grep gates protect the user-visible contracts (price filter removed, classification by ID, local-time date window); 20 Deno tests assert the edge function's v2 schema + validation + cache-key invariants; 10 mobile regression checks assert the screen-side state shape, cache key, and persistence wiring. Every gate was negative-control verified: temporarily reintroducing the protected pattern makes the gate fail, restoring the file makes it pass again.

M3 also discovers and corrects two artifact issues:
1. **Invariant ID collision** — the SPEC's planned BG/BH/BI were partially taken (BG by `orch-0807-brand-avatar-square`). Renumbered to **BH/BI/BJ** across SPEC + 4 implementation/audit reports via a single bulk sed pass.
2. **Operator unblock note** — TM `/classifications` curl unrun (key not in shell env). Segment expansion (Arts & Theatre / Comedy / Family / Film) + genre ID population remain a follow-up ORCH-0809-D, NOT blocking ORCH-0809 close.

The M2.1 edge function changes (segment slug validation + both-location rejection) were deployed in this M3 session — operator's "execute" directive authorized the deploy.

## §2 Files Created / Changed (Old → New Receipts)

### File 1 — `.github/scripts/strict-grep/orch-0809-no-discover-price-filter.mjs` (NEW)

**What it did before:** N/A
**What it does now:** Five-check Node script enforcing that the Discover price filter is fully removed. Checks DiscoverScreen.tsx for the absence of `selectedFilters.price` references, `TIER_BY_SLUG` imports, `priceFilterOptions` declarations, `type PriceFilter` aliases, and `common:tier_*` i18n key calls — all checked against code-only source (block + line comments stripped) so historical-removal documentation doesn't self-trip the gate.
**Why:** SPEC §9 Gate 1 + Constitution #3 + #9 lock-in.
**Lines:** 102
**Negative control:** appended `const priceFilterOptions = [];` to DiscoverScreen.tsx → gate exits 1 with "Check 3 FAIL"; restored → PASS 5/5.

### File 2 — `.github/scripts/strict-grep/orch-0809-tm-classification-by-id.mjs` (NEW)

**What it did before:** N/A
**What it does now:** Seven-check Node script enforcing I-PROPOSED-BI DISCOVER_TM_CLASSIFICATION_BY_ID. Checks: (1) shared classifications file exists, (2) exports DISCOVER_SEGMENT_ID + DISCOVER_GENRE_ID + resolveTmClassification, (3) no `"VERIFY"` literal in active code (comments stripped), (4) edge function imports both resolveTmClassification AND DISCOVER_SEGMENT_ID from shared, (5) recursive sweep of `app-mobile/src` + `app-mobile/app` confirms zero `KZFzniwn` literals, (6) DiscoverScreen.tsx no longer references `GENRE_TO_KEYWORDS`, (7) re-audit reinforcement — edge function contains the phrase `unknown segmentSlug` in active code (M2.1 P1-2 guard).
**Why:** SPEC §9 Gate 2 + re-audit §13 recommendation.
**Lines:** 167
**Negative control:** appended `const LEAK = "KZFzniwnSyZfZ7v7nJ"` to `app-mobile/src/types/discoverFilters.ts` → gate exits 1 with "Check 5 FAIL: 1 file(s) under app-mobile/ contain the literal KZFzniwn"; restored → PASS 7/7.

### File 3 — `.github/scripts/strict-grep/orch-0809-tm-local-time-window.mjs` (NEW)

**What it did before:** N/A
**What it does now:** Five-check Node script enforcing I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS. Uses a brace-balanced extractor (not a naive regex — the function return type `{ localStartEndDateTime: string | null }` itself contains `{`/`}` pairs that would confuse a regex extractor; the extractor heuristic looks for the first `{` followed by a statement keyword to identify the body opening). Checks: (1) no `toISOString()` inside getDateRange body, (2) old `toISONoMs` helper removed file-wide, (3) `toLocalISO` helper present inside getDateRange body, (4) edge function wires `localStartEndDateTime` in both request body destructure AND TM URL params.set, (5) re-audit reinforcement — edge function contains the phrase `pass either city or location, not both` (M2.1 P2-4 guard).
**Why:** SPEC §9 Gate 3 + re-audit §13 recommendation.
**Lines:** 175
**Negative control:** replaced `\`${toLocalISO(start)},${toLocalISO(end)}\`` in DiscoverScreen.tsx with `new Date().toISOString()` → gate exits 1 with "Check 1 FAIL: DiscoverScreen.tsx getDateRange uses toISOString()"; restored → PASS 5/5.

### File 4 — `.github/workflows/strict-grep-mingla-business.yml` (REGISTRATION)

**What it did before:** Registered every prior strict-grep gate as a separate workflow job.
**What it does now:** Adds three new jobs `orch-0809-no-discover-price-filter`, `orch-0809-tm-classification-by-id`, `orch-0809-tm-local-time-window` mirroring the existing pattern (one script + one job, no parallel workflow file). Each job sets up Node 20 + runs the corresponding `.mjs` script.
**Why:** Gates only run in CI if registered. Per the registry pattern in `feedback_strict_grep_registry_pattern.md`.
**Lines:** +33

### File 5 — `supabase/functions/ticketmaster-events/index.test.ts` (NEW)

**What it did before:** N/A
**What it does now:** 20-test Deno suite asserting the edge function's contract across 5 groups:
- **M2.1 input validation** (4 tests): unknown segmentSlug → 400 with `supported` list; both city+location → 400 with strict guard; missing both → 400; malformed `localStartEndDateTime` → 400 with regex.
- **v2 request schema** (2 tests): accepts city/stateCode/countryCode/segmentSlug/genreSlugs/localStartEndDateTime/latFallback/lngFallback/radiusFallback fields; preserves v1 shape (location/radius/startDate/endDate/keywords).
- **Local-time date window** (2 tests): wires `localStartEndDateTime` into TM URL params; falls back to UTC `startDateTime`/`endDateTime` only when local pair is absent.
- **Cache key v2** (2 tests): `buildCacheKey` composes city/lat-lng + seg + gen + kw + dt + `v2:` prefix; fallback path uses `CITY_FALLBACK_THRESHOLD` + requires numeric `latFallback`/`lngFallback`.
- **Classification resolver behavior** (10 tests): music + sports return correct IDs; unknown slug → Music defensive default (helper-level — the edge function rejects upstream); undefined slug → Music backward-compat; "all" + empty-string genre slugs filtered out; DISCOVER_SEGMENT_ID.music matches legacy hardcoded `KZFzniwnSyZfZ7v7nJ`; DISCOVER_SEGMENT_ID.sports == `KZFzniwnSyZfZ7v7nE` (TM public docs verification); no `"VERIFY"` placeholder in active code; DiscoverScreen.tsx has zero `KZFzniwn` literals.

**Why:** Deno-runtime regression coverage. Reads source files off disk (same pattern as `scan-ticket/index.test.ts`) so no DB or network is required.
**Lines:** 230
**Result:** `deno test --allow-read` → **20 passed | 0 failed (8ms)**.

### File 6 — `app-mobile/scripts/ci/orch-0809-regression-check.mjs` (NEW)

**What it did before:** N/A
**What it does now:** 10-check Node script asserting mobile-side contracts that aren't fully covered by strict-grep (deeper structural checks). Pattern matches `app-mobile/scripts/ci/orch-0749-regression-check.mjs` — `app-mobile/` doesn't have Jest configured for source-code tests; the in-repo norm is Node CI scripts that grep on-disk source.

Ten checks: (1) NightOutCache.fallbackActive field present, (2) saveNightOutCache writes fallbackActive into payload, (3) cache-hit branch restores `setFallbackActive(cached.fallbackActive ?? false)`, (4) error catch branch resets fallbackActive, (5) AsyncStorage cache key includes city/seg/date/gen tokens, (6) selectedFilters initial shape uses `segment` not `price`, (7) service `search` validates exactly-one-of city/location, (8) CityPickerSheet persists all five `discover_city_*` fields, (9) UserPreferences type declares all five `discover_city_*` fields, (10) Zustand discoverFilters registry shape uses `segment`.
**Why:** Defense-in-depth coverage of the M2 + M2.1 contracts that strict-grep can't easily assert (structural vs literal patterns).
**Lines:** 158
**Result:** **10/10 passed.**

### File 7 — `app-mobile/package.json` (SCRIPT REGISTRATION)

**What it did before:** Listed `test:orch-0749` + `test:orch-0751` test scripts.
**What it does now:** Adds `test:orch-0809` invoking the new regression check script.
**Why:** Make the regression check discoverable + runnable from the operator's standard `npm run` interface.
**Lines:** +1

### File 8 — `supabase/functions/ticketmaster-events/index.ts` (DEPLOYED, no source change)

**What changed before this session:** M2.1 added the unknown-segment + both-location rejection guards (in code, not deployed).
**What changed in this session:** Deployed via `/Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv` after operator's "execute" directive. Bundled size: 87.39kB. Dashboard URL: https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions
**Why:** Per memory `feedback_orchestrator_deploys_edge_functions.md` and the operator's explicit blanket execute authorization.
**Verification:** CLI output: `Deployed Functions on project gqnoajqerqhnvulmnyvv: ticketmaster-events`.

### Files 9–13 — Invariant ID bump across SPEC + 4 reports

**What changed:** Bulk sed pass renumbered invariant IDs `BG/BH/BI → BH/BI/BJ` to resolve the late-discovered collision with `orch-0807-brand-avatar-square` which had already claimed I-PROPOSED-BG. Three-stage temp-token rename preserved the mapping order:

- `I-PROPOSED-BG DISCOVER_CITY_PERSISTED` → `I-PROPOSED-BH DISCOVER_CITY_PERSISTED`
- `I-PROPOSED-BH DISCOVER_TM_CLASSIFICATION_BY_ID` → `I-PROPOSED-BI DISCOVER_TM_CLASSIFICATION_BY_ID`
- `I-PROPOSED-BI DISCOVER_TM_LOCAL_TIME_WINDOWS` → `I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS`

Files touched:
- `Mingla_Artifacts/specs/SPEC_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0809_*_M1.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0809_*_M2.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0809_*_M2_1.md`
- `Mingla_Artifacts/reports/QA_ORCH-0809_PRE_M3_AUDIT_REPORT.md`

Verification: `grep -ohE "I-PROPOSED-B[H-J] [A-Z_]+" SPEC...md | sort -u` returns exactly the three expected mappings.

The strict-grep workflow registration in `.github/workflows/strict-grep-mingla-business.yml` references the NEW (BI, BJ) IDs in the job display names — written from scratch with the correct IDs.

## §3 Verification Matrix

| Spec / audit criterion | Method | Result |
|---|---|---|
| SC-8 Price filter UI gone (SPEC) | Gate 1 (5 checks) | PASS — 5/5 |
| SC-11 No `"VERIFY"` in classifications | Gate 2 Check 3 | PASS |
| SC-12 No `KZFzniwn` in `app-mobile/` | Gate 2 Check 5 | PASS — sweep returned 0 hits across `app-mobile/src` + `app-mobile/app` |
| SC-13 No UTC `startDateTime` in Discover path | Gate 3 Check 1 + Check 2 | PASS — neither `toISOString()` (in getDateRange) nor `toISONoMs` (file-wide) present |
| Re-audit recommendation: edge function 400 on unknown slug | Gate 2 Check 7 + Deno test 1 | PASS |
| Re-audit recommendation: edge function 400 on both city+location | Gate 3 Check 5 + Deno test 2 | PASS |
| SC-9 Fallback banner state correct on cache hit | Mobile regression T-03 + T-04 | PASS |
| SC-10 Cache key isolation (M2 hotfixes) | Mobile regression T-05 + Deno test cache-key-v2 | PASS |
| `NightOutCache.fallbackActive` persistence | Mobile regression T-01 + T-02 | PASS |
| `UserPreferences.discover_city_*` declared | Mobile regression T-09 | PASS |
| CityPickerSheet persistence flow | Mobile regression T-08 | PASS |
| Zustand registry shape uses `segment` | Mobile regression T-10 | PASS |
| Service validates exactly-one-of-city-or-location | Mobile regression T-07 | PASS |
| Classification IDs correct (Music + Sports) | Deno test 17 + 18 | PASS |
| Edge function v1 backward compat | Deno test 6 | PASS |
| Negative-control: Gate 1 fires on price-filter reintroduction | Manual injection of `priceFilterOptions` literal | PASS — gate exits 1 |
| Negative-control: Gate 2 fires on client TM ID leak | Manual injection of `KZFzniwnSyZfZ7v7nJ` literal to discoverFilters.ts | PASS — gate exits 1 |
| Negative-control: Gate 3 fires on UTC reintroduction | Replaced `toLocalISO(start)` template with `new Date().toISOString()` | PASS — gate exits 1 |
| Edge function deployed | `/Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv` | PASS — bundled 87.39kB |
| Deno typecheck on edge function (post-M2.1 still clean) | `deno check supabase/functions/ticketmaster-events/index.ts` | PASS — exit 0 |

## §4 Invariant Status

| Invariant | Pre-M3 | Post-M3 |
|---|---|---|
| I-PROPOSED-BH DISCOVER_CITY_PERSISTED (renumbered from BG) | DRAFT | DRAFT — ready to flip ACTIVE on CLOSE (DB migration live, M2 persistence wired, M2.1 fixed cache restoration) |
| I-PROPOSED-BI DISCOVER_TM_CLASSIFICATION_BY_ID (renumbered from BH) | DRAFT | DRAFT — ready to flip ACTIVE on CLOSE (server constants shipped, slug→ID resolver live, Gate 2 protects, Deno tests confirm) |
| I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS (renumbered from BI) | DRAFT | DRAFT — ready to flip ACTIVE on CLOSE (local-time date math live, Gate 3 protects, Deno test confirms wire path) |
| Constitution #3 No silent failures | RESTORED post-M2.1 | PRESERVED + locked by Gate 2 Check 7 |
| Constitution #9 No fabricated data | RESTORED post-M2.1 | PRESERVED + locked by Gate 2 + mobile regression T-03 |
| Constitution #2 One owner per truth | PRESERVED | PRESERVED + locked by Gate 2 Check 5 (no client TM IDs) |
| I-LOCATION-INVALIDATE-ON-LOCATION-ONLY | UNTOUCHED | UNTOUCHED |
| Zustand-persist no server snapshots | PRESERVED | PRESERVED — `discoverFilters` registry holds string slugs only, not in `partialize`, not server-state |

## §5 Operator Gates Status

| Gate | Status |
|---|---|
| DB migration `20260601000001_orch_0809_discover_city_preferences.sql` | Applied (operator ran `supabase db push --linked` earlier in session) |
| Edge function `ticketmaster-events` v2 + M2.1 validation guards | Deployed (this M3 session) |
| EAS OTA for `app-mobile/` | Pending — operator runs two separate invocations per memory `feedback_eas_update_no_web.md`:<br>`cd app-mobile && eas update --branch production --platform ios --message "ORCH-0809: Discover city picker + segments + local-time + gates"`<br>`cd app-mobile && eas update --branch production --platform android --message "ORCH-0809: Discover city picker + segments + local-time + gates"` |
| TM `/classifications` curl (segment expansion) | Not run — key not in shell env. Becomes a follow-up ORCH-0809-D when operator provides output. ORCH-0809 CLOSE proceeds without this. |

## §6 Discoveries for Orchestrator

- **Process invariant strongly recommended for the registry:** *"any user-selectable filter dimension MUST either be validated at the server boundary OR explicitly degrade with a user-visible signal — never silently fall through to a default; AND MUST appear in every cache key on every layer (AsyncStorage + React Query + edge function cache)."* This bug class hit ORCH-0809 four times (price filter, city in AsyncStorage key, date in AsyncStorage key, segmentSlug at edge function). The invariant text is ready to register; the strict-grep Gate 2 Check 7 + Gate 1 are already in place to enforce key parts of it. Recommended ID: I-PROPOSED-BK FILTER_DIMENSION_VALIDATED_OR_KEYED. Pre-existing per-skill memory `feedback_supabase_neq_null.md` is the SQL analog — this is the broader cross-layer version.
- **Invariant ID assignment process gap:** the SPEC's planned BG/BH/BI weren't validated against the live registry or against in-flight ORCH workflow registrations at SPEC-write time. The orchestrator should grep `.github/workflows/strict-grep-mingla-business.yml` for `I-PROPOSED-` labels in addition to `INVARIANT_REGISTRY.md` before assigning new IDs.
- **Pre-existing unrelated tsc errors** in `ConnectionsPage.tsx:2763` + `HomePage.tsx:246,249` are still present, untouched throughout ORCH-0809. Candidate for a separate cleanup ORCH.
- **ORCH-0809-D candidate (segment + genre expansion):** when operator provides TM `/classifications.json` output, a follow-up slice extends `DiscoverSegmentSlug` union (add `arts-theatre`, `comedy`, `family`, `film`) + populates `DISCOVER_GENRE_ID` with verified IDs + extends `SEGMENT_OPTIONS` in DiscoverScreen.tsx. No code restructure — purely additive.
- **ORCH-0809-C candidate (NY-timezone hardcode):** `getTodayDateString` in DiscoverScreen.tsx hardcodes `America/New_York`. Pre-existing inconsistency with I-PROPOSED-BJ. Worth a one-line cleanup.
- **`fabricationLoopCount`-style memory worth coining:** the operator's pre-M3 audit call ("let's do a thorough audit before M3 so it's a clean pass") is the right pattern for any ORCH with surface-area complexity — it caught two P1s that strict-grep gates would have locked in. Worth codifying as `feedback_pre_lockdown_audit.md` in the operator's memory: "before any slice that ships CI gates protecting current state, run a forensics TARGETED audit in advisory frame to confirm current state IS correct."

## §7 Regression Surface (M3 only)

M3 ships ONLY tests + gates + workflow registration + edge deploy. No new product behavior, no UI change, no schema change. The regression surface is the CI itself:

1. **CI pipeline duration** — 3 new jobs added to the workflow. Each is ~5 seconds (single Node script). Marginal CI time impact.
2. **False-positive risk** — Gate 1 strips comments before checking, so historical-removal documentation is safe. Gate 2 Check 3 + Check 7 strip comments. Gate 3 Check 1 extracts the getDateRange body specifically. All three negative-controls were re-run after the comment-stripping fix to confirm the gates still fire on real reintroduction.
3. **Edge function deploy impact** — the deployed v2 schema is additive and backward-compatible. Existing v1 callers (none other than DiscoverScreen) continue to work. The new validation guards (unknown segmentSlug, both-location) only fire on inputs that no current caller emits.

## §8 What's NOT in M3 (intentionally)

- **TM segment/genre expansion** — gated on operator's curl output. Becomes ORCH-0809-D.
- **NY-timezone hardcode** — pre-existing inconsistency, candidate ORCH-0809-C.
- **i18n locale sweep for new chip labels** — candidate ORCH-0809-A.
- **NightOutCache payload extension to include segment/city/dateFilter** — defense-in-depth only; cache key is authoritative; deferred.
- **Reverse-geocode race UX glitch** — one-RTT flash only, P2 OPEN, acceptable.
- **iOS / Android / Web parity smoke** — tester deliverable post-EAS-OTA.

## §9 ORCH-0809 CLOSE Readiness Checklist

- ✅ DB migration applied to remote (operator confirmed `supabase db push --linked` earlier)
- ✅ Edge function deployed (M3 session, this report §5)
- ✅ Three strict-grep gates passing with negative-control proof
- ✅ Three gates registered in workflow file
- ✅ 20 Deno tests passing
- ✅ 10 mobile regression checks passing
- ✅ Constitution #3 + #9 restored AND locked by gates
- ✅ Three invariants (BH / BI / BJ) ready to flip DRAFT→ACTIVE on CLOSE
- ✅ All implementation reports + SPEC use consistent invariant IDs (BH/BI/BJ)
- ✅ Cross-domain blast verified zero (`mingla-admin/`, `mingla-business/` untouched)
- ✅ Pre-existing tsc errors flagged for separate ORCH (not ORCH-0809's concern)
- ⏳ EAS OTA — operator runs the two `eas update` invocations
- ⏳ iOS / Android / Web parity tester smoke — after EAS OTA lands

## §10 Total ORCH-0809 Scope Delivered

Across M1 + M2 + M2 hotfix v1 + M2 hotfix v2 + M2.1 + M3:

- **Database:** 1 migration (5 new nullable columns on `preferences`), 1 apply-time RAISE EXCEPTION probe
- **Server constants:** 1 new shared file (`ticketmasterClassifications.ts`) with segment + genre maps + resolver
- **Edge function:** rewritten v2 schema (additive + backward-compat) with city/segment/genre/local-time path + <5-result fallback + v2 cache key + 4 input validation guards
- **Mobile types:** 2 new files (`discoverFilters.ts`) + `preferences.ts` extension
- **Mobile service:** rewritten with `search()` method; v1 adapter deleted in M2
- **Mobile component:** `DiscoverScreen.tsx` major surgery (city chip + segment switcher + price filter removal + local-time date math + fallback banner + cache key correctness) + 1 new component (`CityPickerSheet.tsx`, ~360 lines)
- **Zustand store:** filter shape change (`price` → `segment`)
- **CI infrastructure:** 3 strict-grep gates + workflow registration; 20-test Deno suite; 10-check mobile regression script
- **Artifacts:** SPEC + 4 implementation reports + 1 audit report (with §13 re-audit appendix) + this M3 report — all consistent on invariant IDs
- **Constitution:** #3 + #9 restored and locked

**Total files touched across all slices:** 14 (8 product code, 3 gates, 1 workflow, 1 Deno test, 1 mobile test, plus various artifacts).

---

**End of M3 report. ORCH-0809 is CLOSE-ready pending operator EAS OTA + optional parity smoke.**
