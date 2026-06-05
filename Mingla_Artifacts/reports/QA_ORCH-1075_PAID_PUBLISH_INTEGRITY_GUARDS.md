# QA — ORCH-1075 [Paid-publish integrity guards]

- **Mode:** mingla-tester (TARGETED + SPEC-COMPLIANCE), backend/DB scope
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1075-[paid-publish-integrity-guards]/` on branch `ORCH-1075-paid-publish-integrity-guards`
- **Date:** 2026-06-04
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1075_PAID_PUBLISH_INTEGRITY_GUARDS.md`
- **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1075_PAID_PUBLISH_INTEGRITY_GUARDS.md`
- **Migration under test:** `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql` (APPLIED LIVE on prod, `schema_migrations` head confirmed; deployed function bodies verified to carry the guards)
- **COMMS acked:** COMMS-0002 (backend allowlist — my new test file added to `ORCH_1075_BACKEND_ALLOWLIST` in the same commit), COMMS-0003 (Stripe doc URLs cited inline in the migration — verified present).

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 | **P4:** 2
- **Sim evidence:** EXEMPT for backend/DB scope (source-only sufficient per Phase 0.A exemption: SQL-only / RLS / migration). The business-app catch-site on-device QA (SC-9-iOS / SC-9-Android) is explicitly out of scope for this pass (operator+orchestrator next step); statically verified only.
- **Regression tests:**
  - implementor = `supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.ts` (13/13 PASS) — SOURCE-CONTRACT (string-presence) angle; fails-on-revert verified by implementor @ `e2c58f9bd` and independently re-verified by tester (see below).
  - implementor jest = `mingla-business/src/utils/__tests__/paidPublishGuards.test.ts` (10/10 PASS).
  - **tester adversarial = `supabase/migrations/__tests__/orch_1075_paid_publish_guards_behavioral.test.ts` (20/20 PASS) — BEHAVIOR/BOUNDARY/TRUTH-TABLE angle (different from the implementor's string-presence angle). Fails-on-revert verified by tester @ `10bd56aad`.**

### Verdict-gate compliance
- Backend/DB/migration scope → source-only is the SANCTIONED basis (Phase 0.A exemption). No UI/runtime finding requires a sim leg in this pass.
- The behavioral DB exercise with write-fixtures (T-01..T-08 with real rows) cannot run via MCP (read-only transaction; `CREATE TEMP TABLE` → `25006`). I covered it three ways instead: (a) read-only invocation of the **live deployed** `pg_brand_can_charge` + the live checkout predicate over the full brand population; (b) byte-faithful re-implementation of every guard predicate in the adversarial Deno test asserting the truth tables; (c) static reachability trace of every guard in its RPC body proving the guard runs before the persist/status-flip. This is the maximum achievable without a write-capable psql session and is sufficient for PASS on a backend-only change.

---

## 1. Live read-only probe evidence (prod DB, captured 2026-06-04)

| Probe | Result | Meaning |
|---|---|---|
| Migration `20260911000000` in `schema_migrations` | present | applied live |
| `pg_brand_can_charge` live body | matches SPEC §3.0 byte-for-byte | helper deployed correctly |
| Deployed function bodies carry guards | 6 money RPCs: guard_a+guard_b=true; `business_patch_event_when`: guard_a=false, guard_b=true | migration applied correctly, matches SPEC §2 refinement |
| Helper vs brand population | charges_false→false (13), charges_true→true (7), no_connect_row→false (32) | correct per-bucket |
| Helper vs checkout predicate, full population | **52/52 brands agree, 0 disagree** | SC-7/T-17 PROVEN equal to checkout |
| `pg_brand_can_charge('53aaea42…' Lantern & Vine)` | **false** | repro brand correctly blocked |
| `pg_brand_can_charge('00000000-…')` nonexistent | false | no-row fail-close |
| A `charges_enabled=true` attached brand | true | ready brand publishes |
| Guard A truth table (synthetic VALUES over deployed predicate) | detached-true→false, null-account→false, charges-false→false, attached-true→true | detached/null cases (absent from live data) correctly fail-close |
| Guard B boundary (`<= now()`) | `=now()`→past(reject), `-1ms`→past, `+1ms`→future(publish) | exact boundary correct |
| Guard B multi-date | [past,future]→publish (T-12), all-past→reject (T-13) | Q4 MAX semantics correct |
| T-21 backstop: Lantern & Vine LIVE paid experience "Raleigh Wine and Dine Crawl" (price 7000, online, status=scheduled) | `would_409=true` | the buyer-side 409 last-line defense still fires for the pre-existing dead-end listing |

**Checkout predicate equivalence proof (load-bearing):** the live `biz_ticket_checkout_create_session` RPC joins `stripe_connect_accounts ON s.brand_id = e.brand_id AND s.detached_at IS NULL` and rejects with `IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN RAISE 'stripe_account_not_ready'`. The helper `pg_brand_can_charge` is the exact logical complement (`EXISTS(... detached_at IS NULL AND stripe_account_id IS NOT NULL AND charges_enabled IS DISTINCT FROM false)`), confirmed equal for all 52 brands.

---

## 2. Guard reachability trace (Goal 2 — guards are NOT dead code)

| RPC | Paid test | Guard placement (verified) | Persist-after-guard? |
|---|---|---|---|
| `biz_create_experience` | `p_publish AND NOT v_is_free AND v_resolved_total>0` | inside `IF p_publish`, after price resolve + before slug build + `events` INSERT (L356) | YES — RAISE aborts txn before any write |
| `biz_publish_experience` | same | after date-model resolve, before cover patch | YES |
| `biz_update_live_experience` | `NOT v_is_free AND v_resolved_total>0` (Q3) | after `v_new_date_ends` built, before date-shift gate + UPDATE (L1564) | YES — structured RETURN before UPDATE |
| `business_publish_event_draft` | `bool_or(availableAt∈(online,both) AND NOT isFree AND price>0)` over `v_tickets` | after `event_dates` write (reads `MAX(ed.end_at)`), before status→scheduled flip (L2147) | YES — RAISE aborts incl. event_dates INSERTs |
| `business_publish_trip_draft` | `MAX(price_cents WHERE available_online)>0` | after `trip_end_before_start` + tier-count check, before slug/status flip (L2467) | YES |
| `biz_update_live_trip` | same online-tier max | after permission gate; effective end = patched `endAt` (same JSON path `v_new_business_trip` derives from) else master `event_dates.end_at` (L2726) | YES — structured RETURN before writes |
| `business_patch_event_when` | `EXISTS(ticket_types available_online AND price>0)` (Guard B only) | after `event_dates` rewrite (reads `MAX(ed.end_at)`), before events UPDATE (L3446) | YES |

Date-consistency verified: the experience Guard B recomputes `v_max_end` with **byte-identical** date-parsing to the actual `event_dates` write loop (same `doorsOpen/endsAt`, `startTime/endTime`, `AT TIME ZONE v_timezone`, `+1 day` rollover). Event/trip/patch paths read `MAX(end_at)` directly from the freshly-written `event_dates` rows — no recomputation drift. Recurring "never-ends" materialises exactly the master occurrence, so the single-date guard matches the stored data (consistent with the deck `i-discover-excludes-ended-master-date` model). NULL `v_max_end` → reject = fail-closed.

---

## 3. SPEC test-case results (T-01..T-21)

| Test | Scenario | Verdict | Evidence |
|---|---|---|---|
| T-01 | Paid exp publish, not ready → `stripe_charges_disabled`, stays draft | **PASS** | Guard A reachable in `biz_publish_experience`/`biz_create_experience` inside `IF p_publish`; RAISE before status flip; helper=false for not-ready brand (live). Atomicity: RAISE aborts txn. |
| T-02 | Paid exp publish, past date → `offering_date_past` | **PASS** | Guard B `v_max_end <= v_now`; boundary truth table proven; adversarial test green |
| T-03 | Paid event publish, not ready → `stripe_charges_disabled` | **PASS** | `v_paid_online` predicate + Guard A; live deployed body carries guard |
| T-04 | Paid event publish, past date → `offering_date_past` | **PASS** | reads `MAX(event_dates.end_at)`; boundary proven |
| T-05 | Paid trip publish, not ready → `stripe_charges_disabled` | **PASS** | `MAX(price_cents WHERE available_online)>0` + Guard A; `trip_end_before_start` preserved (L2435) |
| T-06 | Paid trip publish, range ended → `offering_date_past`; end<start still works | **PASS** | `v_end <= v_now`; existing `trip_end_before_start` untouched |
| T-07 | Edit-to-paid live exp, not ready → `{ok:false,reason:'stripe_charges_disabled'}` | **PASS** | Q3 `NOT v_is_free AND v_resolved_total>0` (any resulting paid state); structured return |
| T-08 | Edit live trip → past, paid → `{ok:false,reason:'offering_date_past'}` | **PASS** | effective-end from patched `endAt` (same path as the writer); structured return |
| T-09 (adv) | FREE offering, not ready → PUBLISHES | **PASS** | guards wrapped in paid predicate; `v_is_free`→resolved_total=0; FREE online ticket `eventPaidOnline=false` (adversarial test) |
| T-10 (adv) | FREE offering, past date → PUBLISHES | **PASS** | paid-only expiry; free bypasses both guards |
| T-11 (adv) | Stripe-ready, future-dated PAID → PUBLISHES | **PASS** | helper=true for ready brand (live); `+1ms` future → not past |
| T-12 (adv) | Multi-date paid, one future date → PUBLISHES | **PASS** | `MAX(end_at) > now()` (Q4); live + adversarial truth table |
| T-13 (adv) | Multi-date paid, ALL past → `offering_date_past` | **PASS** | `MAX(end_at) <= now()`; adversarial test green |
| T-14 (adv) | `business_patch_event_when` shift PAID event to past → `offering_date_past` | **PASS** | `EXISTS(paid-online)` + `MAX(end_at)<=now()`; live body guard_b=true |
| T-15 (adv) | `business_patch_event_when` shift FREE event to past → succeeds | **PASS** | `v_event_is_paid_online=false` for free → guard skipped |
| T-16 (adv) | In-person-only paid (`available_online=false`), not ready → PUBLISHES | **PASS** | paid test scopes to `available_online=true`; door-only `eventPaidOnline=false`; exemption does not leak when a co-listed online-paid ticket exists (adversarial test) |
| T-17 | `pg_brand_can_charge` == checkout predicate | **PASS** | 52/52 brands agree, 0 disagree (live) |
| T-18 (regression) | Strict-grep gate fails-on-revert | **PASS** | tester stripped Guard A from `biz_update_live_trip` → gate exit 1 + Deno test 1-failed; restored → both green |
| T-19 (regression) | orch-0792 still green | **PASS** | `INSERT INTO public.event_dates` retained; orch-0792-A passes against the 1075 migration (now the latest definer) |
| T-20-iOS / T-20-Android | Catch-site copy + route | **DEFERRED (out of scope this pass)** | statically verified: `paidPublishGuards.ts` copy == LOCKED SPEC §3.7; route `/brand/{id}/payments/onboard` is a real file (`BrandOnboardView`); helpers wired into all 6 call sites. On-device = operator+orchestrator next step |
| T-21 | Buyer 409 survives | **PASS** | zero `supabase/functions/**` or checkout RPC change in diff; live Lantern & Vine paid experience `would_409=true` |

**21/21 in-scope cases satisfied** (T-20 explicitly deferred to the operator-assisted on-device step per the dispatch; not a failure).

---

## 4. Strict-grep gate — has teeth (independently verified)

- `orch-1075-paid-publish-integrity-guards.mjs --self-test` → SELF-TEST PASSED (slicing isolates per-function; missing-Guard-A fixture caught).
- Real run → all 7 RPCs OK (6 both-guards, `business_patch_event_when` Guard-B-only).
- **Fails-on-revert (tester-run):** stripping Guard A from `biz_update_live_trip` → gate exit **1** ("missing Guard A marker") AND implementor Deno test **1 failed**; restoring byte-identical → both green (empty `git diff`).
- `orch-0792-A` stays GREEN (reads the 1075 migration as the latest `business_publish_event_draft` definer; `INSERT INTO public.event_dates` present).
- `orch-0863 C7 no-new-backend-files` GREEN with the new tester test file allowlisted (COMMS-0002).

---

## 5. Adversarial regression test (Step 0.5)

- **Path:** `supabase/migrations/__tests__/orch_1075_paid_publish_guards_behavioral.test.ts` (20 tests, 20/20 PASS via `deno test --allow-read`).
- **Angle (DIFFERENT from implementor):** the implementor's Deno test is SOURCE-CONTRACT (asserts guard STRINGS appear — same angle as the strict-grep gate). This tester test attacks BEHAVIOR / BOUNDARY / TRUTH-TABLE: it re-implements each deployed predicate byte-faithfully and asserts the correct boolean for the adversarial edge cases LIVE DATA CANNOT COVER — **detached connect row (charges_enabled=true) → cannot charge**, **null stripe_account_id → cannot charge**, **no connect row → cannot charge**, a **detached-true row alongside an active-false row** (EXISTS must not be rescued), the **`end_at = now()` exact boundary → PAST**, **multi-date one-future → publishes / all-past → reject (Q4)**, the **free→paid edit (Q3)** still gated, and the **in-person-only exemption not leaking** when an online-paid ticket co-exists. Anti-drift `migrationContains` assertions pin each re-implemented predicate to the live migration text so the port cannot silently diverge.
- **fails-on-revert verified at commit `10bd56aad`:** reverting the Guard B comparison (`v_max_end <= v_now`/`v_end <= v_now` → `false`) in the migration made the adversarial test FAIL (anti-drift assertion, 1 failed); restoring byte-identical → 20/20 PASS.
- Both regression tests appear in `git diff origin/main...HEAD --name-only` (ship together with the fix).

---

## 6. Type / lint / build gate

- `tsc --noEmit` (mingla-business): **zero errors in any ORCH-1075-touched file**. 243 baseline errors are all pre-existing in untouched files (documented by implementor; spot-checked).
- `eslint` on 9 touched files: exit 0, **0 errors**, 11 warnings — all warnings are on pre-existing lines NOT in this ORCH's diff (`tripsService.ts`, `EditPublishedTripScreen.tsx` existing useCallbacks); the two NEW files (`paidPublishGuards.ts` + its jest test) are 0 warnings.
- jest catch-site: 10/10. Deno suites combined: 33/33.

---

## 7. Constitution (relevant rules)

| Rule | Verdict | Note |
|---|---|---|
| 3. No silent failures | PASS | guards RAISE / structured-return with actionable reason; client maps to copy + real route |
| 9. No fabricated data | PASS | no fabricated state; fail-closed on NULL date |
| 12. Validate at right time | PASS | validates at publish/edit time with the offering's own dates, not `new Date()` server-noise; uses `v_now := now()` consistently |
| 13. Exclusion consistency | PASS | publish-gate predicate equals the checkout serving predicate (52/52 brands) |
| Others | N/A | backend-only; no auth/logout/persisted-state surface |

---

## 8. Findings

- **P3-1 (minor, no action required):** the experience-publish Guard B (`biz_create_experience`/`biz_publish_experience`) RECOMPUTES `v_max_end` separately from the `event_dates` write loop rather than reading the table. Verified byte-identical today, but a FUTURE edit to one date-parse path and not the other could drift the guard from stored dates. Event/trip/patch paths avoid this by reading `MAX(event_dates.end_at)`. Consider unifying in a follow-up; not a defect now.
- **P4-1 (praise):** Guard placement is fail-closed and atomic everywhere — RAISE/RETURN before any persist, NULL date → reject, in-person-only & free correctly exempt, paid predicate matches the ticket-write condition exactly. The event/trip/patch paths reading `MAX(end_at)` from the just-written rows is the robust choice.
- **P4-2 (praise):** helper proven equal to the checkout predicate across the entire live brand population (52/52), so publish-gate and checkout-gate can never disagree — exactly the SPEC intent.

## 9. Discoveries for orchestrator

- **D-1:** Lantern & Vine currently has a LIVE (`status=scheduled`) paid online experience "Raleigh Wine and Dine Crawl" (`would_409=true`) that pre-dates this guard — the exact operator-reported dead-end. The publish guards prevent NEW such listings; this pre-existing one still hits the buyer 409. ORCH-1076 (server-side suppression of unsellable paid offerings, already registered) is the right home for retroactively hiding/suppressing it.
- **D-2:** Behavioral write-fixture DB tests (T-01..T-08 with real rows) are not runnable via MCP (read-only transaction). The implementor's `.test.sql` is the hand-run-on-`db push` artifact; CI coverage is the two Deno suites + the strict-grep gate. Migration is already applied live, so the deployed function bodies were verified directly.
