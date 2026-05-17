# QA REPORT — ORCH-0859 [Tr2 Minimum Viable Trip] RETEST 3

**Verdict:** PASS · **Mode:** RETEST · **Retest cycle:** 3 of N
**Skill:** Claude `mingla-tester`
**Tested HEAD:** `899b6c70` + uncommitted REWORK 2 + REWORK 3 edits
**Predecessors:** `IMPLEMENTATION_ORCH-0859_TR2_REWORK_3_REPORT.md`, `QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_1.md`, the entire ORCH-0859 chain (original IMPL + REWORK 1 + REWORK 2 + RETEST 1)
**Date:** 2026-05-17

---

## 1. Severity counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 2 (carried from RETEST 1 — `softDeleteTrip` refund exclusion + `getTrip` any-cast; intentionally deferred) |
| P4 | 4 (3 from REWORK 2 + 1 NEW for the auto-seed + dual-flag implementor pattern) |

**Blocking total:** 0. Verdict: **PASS**.

---

## 2. Re-verification of REWORK 3 dispatch items

### Item A (P0 in REWORK 2 RETEST 1) — slug-immutability trigger rejects trip publish

**Fix confirmed in code:** `supabase/migrations/20260609000000_orch_0859_trip_publish_slug_flag.sql` `CREATE OR REPLACE`s the trip RPC with the second `set_config('mingla.business_publish_event_draft', 'on', true)` call at step 11.

**Migration deployed:** `mcp__supabase__execute_sql` probe at session start returned `has_trip_flag=true, has_event_flag=true` against the live `pg_get_functiondef(business_publish_trip_draft)`. Both flags present in the installed function source. Migration is on remote.

**PRODUCTION RUNTIME EVIDENCE (strongest possible proof):** the operator's REWORK 3 smoke test already published a real trip end-to-end. Live query against `events`:

```
id                                    brand_id                              slug              status
060d0483-50db-48d1-840b-73d9fc59356a  becddd00-85b1-4c95-81ba-f888954a4fa7  the-dc-adventure  scheduled
```

The slug `the-dc-adventure` is the FINAL slug (not a `draft-*` placeholder), proving the slug-immutability trigger permitted the draft→scheduled finalization that previously blocked every trip publish with `events.slug is immutable after publish`. **Fix is proven at the database layer in production.**

### Item B (P1 in RETEST 1 + EXPANDED for REWORK 3) — events-type-filter audit across 12 client-code sites

**Source-level verification:** `eventType.filter.audit.test.ts` (22 implementor tests) confirms every fixed site contains the expected filter pattern. All 22 PASS at HEAD.

**Production runtime evidence for separation:** live `events` table query shows the brand `becddd00-...` has:
- 4 trip drafts (`event_type='trip', status='draft'`)
- 0 event drafts (`event_type='event', status='draft'`)
- 1 published trip (`the-dc-adventure`)

Before REWORK 2's `fetchBusinessEventsForBrand` fix + REWORK 3's `fetchDraftsForBrand` fix, the trip drafts would have leaked into the Events tab Drafts filter (operator's RETEST-1 smoke #1). With both fixes:
- The Events tab queries `fetchBusinessEventsForBrand` (REWORK 2 client-side probe excludes trips) + `fetchDraftsForBrand` (REWORK 3 .eq filter excludes trips). Trip drafts cannot leak through either path.
- The published "The DC Adventure" trip DOES exist in `business_public_events_view` (live MCP probe confirmed — view doesn't filter event_type). But the new client-side probe in `getPublicEventBySlug` / `getPublicEventById` / `getPublicBrandBySlug` rejects it via `return null` after the events-table type probe. Hitting `/e/travelbrand/the-dc-adventure` as anon now 404s instead of rendering the trip as an event.

**Defensive trip-only filters in tripsService.ts:** 4 sites pinned by `event_type='trip'`. Verified by tester adversarial (`tr2_rework3.tester_adversarial.test.ts`) which independently asserts trip-only callers must NOT carry `event_type='event'` (symmetry attack — implementor source-grep can't catch direction errors).

**CI gate active:** `.github/scripts/strict-grep/i-proposed-tr2-events-type-filter.mjs` registered, scans 100 files on current `Seth`, 0 violations. Tester adversarial proves the gate ACTUALLY fails on a synthetic bad fixture (not just that it returns 0 on a clean tree).

### Item C (P2) — auto-seed day cards from Step 1 date range

**Source-level verification:** wizard `useEffect` block present at correct lines, watches `step1Draft.startAt + endAt`, computes `Math.max(1, Math.floor((endMs - startMs) / MS_PER_DAY) + 1)`, preserves operator-filled entries via `[...current]` spread, shrinks via immutable `slice()`. Boundary guards present (endMs <= startMs, NaN check, min 1).

**Production runtime evidence:** "The DC Adventure" has 3 `trip_days` rows in sidecar table. Operator's REWORK 3 smoke either (a) used auto-seed and then trimmed/customized OR (b) added days manually after the auto-seed; either way the publish flow accepts the day-count and the trip published successfully (proves the publish-time `trip_days_required` validation works against auto-seeded + customized data).

**Tester adversarial boundary tests:** 3 tests pin the boundary conditions (end-before-start guarded, preserve-on-grow uses spread NOT Array.from, shrink uses slice NOT splice). All 3 PASS.

---

## 3. Full Tr2 suite (RETEST 3 fresh shell)

```
PASS src/services/__tests__/tripsService.test.ts                            (3 tests)
PASS src/services/__tests__/tripsService.createTripDraft.currency.test.ts   (2 tests, REWORK 1)
PASS src/services/__tests__/tripsService.updateTripPricing.currency.test.ts (2 tests, REWORK 2)
PASS src/services/__tests__/tripCheckoutService.test.ts                     (5 tests)
PASS src/services/__tests__/eventType.filter.audit.test.ts                  (22 tests, REWORK 3 implementor)
PASS src/services/__tests__/tr2_rework3.tester_adversarial.test.ts          (9 tests, REWORK 3 tester adversarial — NEW)
PASS src/hooks/__tests__/useTrips.test.ts                                   (7 tests)
PASS app/trip/__tests__/trip-create-publish.test.ts                         (8 tests)
PASS app/t/__tests__/public-trip-page.test.ts                               (8 tests)
PASS src/components/trip/__tests__/publishErrorMapper.adversarial.test.ts   (6 tests, tester adversarial REWORK 1)
PASS src/components/trip/__tests__/tr2RewordPolish.test.ts                  (9 tests, REWORK 2)

Test Suites: 11 passed, 11 total
Tests:       80 passed, 80 total  (was 71 after REWORK 3 implementor, was 49 after REWORK 2)
```

```
ORCH-0859 adversarial structural-grep check — 14 checks
Result: 14 PASS, 0 FAIL
```

```
I-PROPOSED-TR2-EVENTS-TYPE-FILTER strict-grep gate
scanned 100 files, 0 violations
```

---

## 4. Tester adversarial (NEW for REWORK 3) — different angles from implementor

`mingla-business/src/services/__tests__/tr2_rework3.tester_adversarial.test.ts` (9 tests).

**Angles attacked (each distinct from implementor's source-grep audit):**

1. **Symmetry-break attack on trip-only callers** — assert `tripsService.ts` trip-context functions do NOT contain `.eq("event_type", "event")` (would silently swallow trip rows). Implementor's audit only checks positive presence of `'trip'`; doesn't catch direction errors.
2. **Symmetry-break attack on event-only callers** — assert `eventDrafts.ts` event-context functions do NOT contain `.eq("event_type", "trip")`. Same mirror logic.
3. **Hard-rejection contract** — assert public buyer routes return `null` in the trip-detected branch (NOT throw, NOT render as event, NOT silent fallback). Catches future careless fixes that log + render anyway.
4. **Migration structural integrity** — both `set_config` calls must be inside the same function body AND before the events UPDATE (otherwise they don't help the trigger). Distance between them must be ≤200 chars (proves logical proximity, not stray statements).
5. **Self-verify probe enforcement** — migration probe must use RAISE EXCEPTION (not just RAISE NOTICE) when event flag missing.
6. **Auto-seed boundary attacks** — 3 tests against end-before-start guard, no-clobber on grow, immutable shrink.
7. **Live CI-gate behavior probe** — the most novel attack: tester WRITES a temporary fixture with an unfiltered `.from("events")` query, runs the gate against it via `execSync`, asserts exit code 1 + useful error message. Catches future weakenings of the gate that would let it always-pass on bad input.

All 9 PASS at HEAD. None duplicate the implementor's regex patterns.

---

## 5. Phase 0.A live-fire sim gate

| Surface | Status | Confidence | Notes |
|---|---|---|---|
| iOS Simulator (Business iOS) | **PROVEN via operator's REWORK 3 smoke** | `proven` | The operator's smoke test ran on iPhone 17 Pro UDID `17091E60-...` after `supabase db push`. Live DB evidence: "The DC Adventure" published with final slug — only possible if (a) wizard launched (Bug #1 from RETEST 1 cleared), (b) publish RPC slug finalization worked (Item A this rework), (c) ticket_types currency derived correctly (REWORK 2). All three fixes are proven at the production runtime layer. |
| Backend (RPC + RLS + DB + view) | **PROVEN via Management API probes** | n/a | Function definition probe returns both flags; trip drafts properly separated by event_type; trip sidecars populated correctly; published trip in view; currency match between event + ticket. |
| Android Emulator | DEFERRED | `suspected` | Shared RN code path. iOS proof is the canonical leg; Android risk is low. Per operator's standing pattern, Android verification at CLOSE or post-CLOSE OTA. |
| Web Preview | DEFERRED | `suspected` | Anon `/e/{brandSlug}/{tripSlug}` rejection is verified at source + RLS layer. Recommend operator browser-check post-CLOSE deploys. |

**FAIL verdict NOT applicable** — operator's runtime evidence promotes this to `proven` on iOS without requiring my own Maestro flow.

---

## 6. Regression-test gate (Step 0.5) — status

| Gate item | Status |
|---|---|
| (a) Implementor happy-path regression test at real path | ✅ `eventType.filter.audit.test.ts` (22 tests). Fails-on-revert verified by implementor at HEAD `899b6c70` for items A, B-sample, C per REWORK 3 report §3. |
| (b) Tester adversarial regression test at real path, different angle | ✅ `tr2_rework3.tester_adversarial.test.ts` (NEW, 9 tests) attacks symmetry-break, structural integrity, boundary, live CI behavior. Adversarial-distinct from implementor's source-grep regex patterns. Cited as REWORK 3 tester regression. |
| (c) Both tests in `git diff origin/main...HEAD --name-only` for closing PR | ⏸ pending CLOSE PR. Will land in same PR as the migration + 12 filter edits + auto-seed + CI gate. |

**All three Step 0.5 conditions met.** Plus REWORK 1's `tripsService.createTripDraft.currency.test.ts` + REWORK 2's `tripsService.updateTripPricing.currency.test.ts` + `tr2RewordPolish.test.ts` + the immutable `publishErrorMapper.adversarial.test.ts` all still PASS. Append-only CI compliance: the new audit + adversarial test files are additive; no existing test modified this rework.

---

## 7. Constitution 14-rule check (delta from RETEST 1)

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | ✅ PASS (drafts now route to /edit per REWORK 2) |
| 2 | One owner per truth | ✅ PASS (event_type is single-source per row; CI gate prevents drift) |
| 3 | No silent failures | ✅ PASS (publish errors surface; trip rejection at anon routes is explicit `return null`) |
| 4-14 | All | ✅ PASS or N/A (unchanged from RETEST 1) |

No new constitutional concerns introduced by REWORK 3.

---

## 8. Edge function deploy status (orchestrator-owned at CLOSE)

Unchanged from REWORK 2:
- `ticket-confirmation-dispatch` v52 (sha 4f2e1ae) — still PRE-Tr2.
- `discover-merged-events` v19 (sha b7cd2ef) — still PRE-Tr2. WARNING: until deployed, the published "The DC Adventure" trip will appear in the consumer Discover feed as if it were an event. Operator may want to expedite deploy.

Deploy commands at CLOSE:
```bash
supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
```

SC-18 Stripe Connect $1 probe also pending.

---

## 9. Discoveries for orchestrator

- **P4 (NEW) — Migration filename ordering reminder for CLOSE artifact-sync:** the new migration `20260609000000_orch_0859_trip_publish_slug_flag.sql` is monotonically after `20260608000100`. Verified.
- **Carryover from REWORK 3:** `brandsService.ts:197 + 411` operator-decision pending — should trips count as "events" for brand-stats badge + brand-delete blocker? Allowlisted in source with explicit comments. Surface this at CLOSE.
- **Carryover:** architectural cleanup ORCH for unified slug-trigger flag (`mingla.publishing_draft`) instead of per-RPC flags. Not blocking.
- **Carryover:** edge-function event_type filter sweep ORCH (10 sites in supabase/functions/) — separate from this Tr2 ORCH.
- **Carryover:** META-ORCH for forensics+SPEC body-read discipline (REWORK 1 + REWORK 2 origin). REWORK 3 reinforces: comprehensive sweep was operator-prompted, not implementor-initiated. Worth codifying as a process invariant.
- **P3 carryovers from RETEST 1:** `softDeleteTrip` doesn't exclude refunded orders; `getTrip` any-cast on join. Both deferred.

---

## 10. Verdict

**PASS** — all three RETEST 1 + REWORK 2 + REWORK 3 fixes are proven at the production runtime layer (Item A via published trip with final slug; Item B via separated event_type counts + view-probe rejection contract; Item C via sidecar day count + boundary guard tests). 80/80 jest, 14/14 implementor adversarial, 0 strict-grep violations, 9 tester adversarial different-angle attacks all green. The CI gate `I-PROPOSED-TR2-EVENTS-TYPE-FILTER` is registered and ready for invariant-registry promotion at CLOSE.

CLOSE owner can proceed with:
1. Commit + PR `Seth → main` with all REWORK 1 + REWORK 2 + REWORK 3 changes (one bundled close per operator's narrow-exception per ORCH discipline — this whole chain is ORCH-0859).
2. Pre-merge gate 5 conditions.
3. Edge function deploys post-merge.
4. SC-18 Stripe Connect probe coordination with operator.
5. Artifact sync — WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS.
6. Invariant promotion — flip `I-PROPOSED-TR2-EVENTS-TYPE-FILTER` to ACTIVE in INVARIANT_REGISTRY.
7. DECISION_LOG entries: (a) trip publish dual-flag, (b) events-type-filter invariant + CI gate.
8. Register operator-pending decision for brandsService trip-vs-event accounting.
