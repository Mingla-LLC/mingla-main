# QA Report: AI Validation Pipeline Hardening (ORCH-0425, 0426, 0427)

**Tester:** Mingla Tester
**Date:** 2026-04-14
**Mode:** SPEC-COMPLIANCE + CODE REVIEW
**Verdict:** PASS

P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 2

---

## Success Criteria Verification

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | Rules filter $0 cost — no Serper/GPT calls | PASS | `handleRunRulesFilter()` (lines 1186-1335) calls only `deterministicFilter()` and `db.from()`. Zero references to `searchPlace`, `classifyPlace`, `fetch("https://")`, or any OpenAI/Serper endpoint. `cost_usd: 0` hardcoded in job creation (line 1215) and response (line 1332). |
| SC-2 | BLOCKED_PRIMARY_TYPES contains 21 types | PASS | Set at lines 57-63 contains exactly: cemetery, funeral_home, gas_station, car_dealer, car_wash, car_rental, auto_repair, parking, storage, laundry, locksmith, plumber, electrician, roofing_contractor, insurance_agency, real_estate_agency, accounting, post_office, fire_station, police, courthouse. Count: 21. |
| SC-3 | FLOWERS_BLOCKED_TYPES contains 10 types | PASS | Set at lines 66-68 contains exactly: garden_center, garden, farm, supplier, cemetery, funeral_home, restaurant, meal_takeaway, bar, food_store. Count: 10. |
| SC-4 | Underscore normalization applied | PASS | Line 353: `const normalizedType = primaryType.replace(/_/g, " ");` — used in `checkText` on line 354. All keyword matching now uses normalized text. |
| SC-5 | Fine dining promotion checks all 3 conditions | PASS | Lines 417-420: checks `price_level === "PRICE_LEVEL_VERY_EXPENSIVE"` AND `rating != null && rating >= 4.0` AND `RESTAURANT_TYPES.has(primaryType)`. Only adds if `!cats.includes("fine_dining")` (line 423). |
| SC-6 | Min-data guard checks all 3 conditions | PASS | Lines 367-370: `rating == null && reviews === 0 && !website` → reject. `reviews` defaults to 0 via `place.review_count || 0` (line 368). |
| SC-7 | Full pipeline unchanged | PASS | `processPlace()` at line 491 runs `deterministicFilter()` first. If verdict is `"pass"`, execution continues to Stage 3 Serper (line 509), Stage 4 website (line 519), Stage 5 GPT (line 527). All existing action handlers still registered in switch (lines 1352-1361). `handleRunBatch` still calls `processPlace`. |
| SC-8 | ai_reason documented for every rules decision | PASS | Every return path in `deterministicFilter()` includes a `reason` string starting with "Rules:" or "Pipeline:". `handleRunRulesFilter` writes `result.reason` to `ai_reason` in place_pool updates (lines 1267, 1274, 1282). Audit trail also captures reason (line 1295). |
| SC-9 | GPT prompt includes Examples 18-19 | PASS | Lines 189-191: Example 18 (Ruxton Steakhouse, VERY_EXPENSIVE, steak_house → fine_dining) and Example 19 (Fogo de Chão, EXPENSIVE, brazilian_restaurant → fine_dining + casual_eats) present with correct JSON format. VERY_EXPENSIVE guidance paragraph present at line 114. Uncertainty instruction qualified by price level at line 114. |
| SC-10 | Admin UI has button + results card | PASS | Shield imported (line 14). Button at lines 797-804 with variant="secondary", icon={Shield}, disabled when rulesRunning or no preview, label includes "Free". Results card at lines 810-835 with 4 stats grid (processed/rejected/modified/unchanged) and dry_run badge. Button appears BEFORE "Start AI Verification" (line 837-838). |

---

## Edge Case Verification

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| E-1 | Supermarket with flowers | PASS | `supermarket` is NOT in `FLOWERS_BLOCKED_TYPES` set (lines 66-68). Filter returns "pass" — place unchanged. |
| E-2 | Florist with "Delivery" in name | PASS | Check 8 (line 448): `primaryType !== "florist"` guard prevents stripping. A florist keeps flowers regardless of name. |
| E-3 | Flowers stripped → zero categories | PASS | Lines 461-468: if `cats.length === 0` after stripping, returns `verdict: "reject"` with appended reason "— no remaining categories, rejected". |
| E-4 | Already has fine_dining + VERY_EXPENSIVE | PASS | Line 423: `if (!cats.includes("fine_dining"))` — skips promotion if already present. Falls through to check 7/8 or returns "pass". |
| E-5 | VERY_EXPENSIVE + 3.5 rating | PASS | Line 419: `rating >= 4.0` — 3.5 fails condition. Check 6 skipped entirely. |
| E-6 | Has rating, no reviews, no website | PASS | Line 370: `rating == null` is false if rating exists → min-data guard not triggered. Place passes to subsequent checks. |
| E-7 | Dry run mode | PASS | Lines 1261 and 1303-1306: `if (!body.dry_run)` gates all DB writes. Dry run path only increments counters. Response includes `dry_run: body.dry_run || false` (line 1333). |
| E-8 | "modify" → "reclassify" in audit trail | PASS | Line 1291: `decision: result.verdict === "modify" ? "reclassify" : result.verdict` — modify mapped to reclassify in both `handleRunRulesFilter` and `processPlace` (line 496). |

---

## Regression Checks

| Check | Verdict | Evidence |
|-------|---------|----------|
| All pipeline actions registered | PASS | Switch statement (lines 1352-1362): `preview`, `create_run`, `run_batch`, `run_status`, `get_results`, `review_queue`, `override`, `stop_run`, `pause_run`, `resume_run`, `run_rules_filter` — all present. |
| handleRunBatch calls processPlace | PASS | Line 844 (approx): `result = await processPlace(place);` still present in batch handler. |
| "Start Verification" button unchanged | PASS | Lines 838-843: same `handleStart` onClick, same `starting` state, same `create_run` action (line 441). Only change is comment updated to "Start AI Verification". |
| Review Queue tab unaffected | PASS | `ReviewQueueTab` component not modified. No grep matches for changes in that section. |
| Command Center tab unaffected | PASS | `CommandCenterTab` component not modified. No grep matches for changes. |

---

## Security Check

| Check | Verdict | Evidence |
|-------|---------|----------|
| Admin auth required | PASS | `handleRunRulesFilter` is called from the serve handler switch (line 1362) which is inside the `try` block after `checkAdmin(req)` succeeds (lines 1345-1346). Same auth gate as all other handlers. |
| No new external API calls | PASS | `handleRunRulesFilter` only calls `db.from()` (Supabase client). Zero `fetch()` calls, zero Serper/OpenAI references. |
| No data exposure | PASS | Response shape (lines 1325-1334) returns only aggregate counts (total_processed, rejected, modified, unchanged, cost_usd, dry_run) — less data than existing handlers. No place names or PII in response. |

---

## Constitutional Compliance

| # | Rule | Verdict |
|---|------|---------|
| 1 | No dead taps | PASS — button has onClick handler, disabled state, loading state |
| 2 | One owner per truth | PASS — place_pool remains single source, audit trail in ai_validation_results |
| 3 | No silent failures | PASS — catch block in admin shows error toast (line 489). Edge function returns json error responses. |
| 5 | Server state server-side | N/A — no Zustand changes |
| 8 | Subtract before adding | PASS — old deterministicFilter replaced, not layered on |
| 9 | No fabricated data | PASS — rules filter only strips/rejects, never adds fake data |
| 13 | Exclusion consistency | PASS — same `deterministicFilter` used by both rules-only AND full pipeline. One set of rules, one location. |

---

## Praise (P4)

- **P4-1: Clean separation of concerns.** The rules-only handler reuses `deterministicFilter()` without duplicating it. One function, two callers. Zero drift risk.
- **P4-2: Audit trail discipline.** Rules-only mode writes to both `place_pool` AND `ai_validation_results` with `stage_resolved: 2` and `cost_usd: 0`, making it trivially easy to distinguish rules-filter results from AI results in queries.

---

## Discoveries for Orchestrator

None. Implementation is clean and within scope.

---

## Verdict

**PASS** — 10/10 success criteria verified, 8/8 edge cases verified, 5/5 regression checks passed, 3/3 security checks passed. Zero defects found. Code is production-ready pending deploy + runtime verification.
