# QA Report: ORCH-0948 Waitlist Feature

> Date: 2026-05-24
> Mode: TARGETED
> Verdict: FAIL
> Findings: P0:0 P1:2 P2:2 P3:0 P4:2

## 1. Layman Summary

ORCH-0948 is directionally implemented and the focused waitlist source/regression suites pass, including the new TEST-owned adversarial tests T-WL-10, T-WL-11, and T-WL-12. The live Supabase project also shows the migration applied, the waitlist trigger/RPC/indexes present, `ticket_order_notifications.order_id` nullable, and the three expected edge functions active.

Release is still blocked. Two required close/pre-merge gates fail: `tests-append-only` rejects a modified implementor test file with deleted lines, and the ORCH-0863 backend strict-grep gate rejects four source-reconciled remote-only migration files. Runtime parity on the planner panel also remains unverified on iOS/Android/web because TEST mode did not mutate the live project and the live project currently has no waitlist-enabled ticket rows to exercise.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0948_WAITLIST_FEATURE.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0948_WAITLIST_FEATURE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0948_WAITLIST_FEATURE.md`
- Deploy receipts: `Mingla_Artifacts/reports/DEPLOY_ORCH-0948_WAITLIST_FEATURE.md`
- Live Supabase project: `gqnoajqerqhnvulmnyvv`
- Added TEST adversarial tests:
  - `supabase/functions/ticket-confirmation-dispatch/__tests__/waitlist-spot-open.adversarial.test.ts`
  - `mingla-business/src/components/waitlist/__tests__/JoinWaitlistSheet.adversarial.test.tsx`
  - `.github/scripts/strict-grep/__tests__/orch-0948-confirm-exclusion.test.mjs`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `supabase/migrations/20260724000010_orch_0948_waitlist_feature.sql`, live information schema, `pg_trigger`, `pg_proc`, `pg_policies` | Applied migration, nullable `order_id`, trigger/RPC existence, constraints, indexes, brand-team SELECT RLS. |
| Edge/RPC | `waitlist-signup`, `ticket-confirmation-dispatch`, `notification-retry-sweeper` | Deno check/test, live edge function versions, anon negative-path HTTP responses. |
| Services/hooks | `waitlistService.ts`, `useJoinWaitlistMutation.ts`, `useEventWaitlist.ts` | Client shape, query key, realtime invalidation, error mapping by source read. |
| Components/screens | `QuantityRow`, `JoinWaitlistSheet`, `PublicEventPage`, checkout index, `TicketTierEditSheet` | CTA wiring, sheet negative UX, planner read-only panel by source and Jest/source tests. |
| Tests/build | Deno, Jest, Node strict-grep self-test, append-only, strict-grep gates | Focused regression results and release-gate status. |

## 4. Findings

### P1-001: Append-only regression gate fails on an implementor test modification

- Evidence: `node .github/scripts/test-append-only-check.js` failed with `supabase/functions/notification-retry-sweeper/index.test.ts - 4 deleted lines detected`.
- Additional evidence: `git diff origin/main...HEAD -- supabase/functions/notification-retry-sweeper/index.test.ts` shows 19 insertions and 4 deletions, including formatting changes and broadening `assert(SOURCE.includes("new Set(eligible.map"))` to `assert(SOURCE.includes("new Set("))`.
- Impact: Violates the dispatch hard guard and Step 0.5 append-only enforcement. This blocks close/PR merge even though the focused Deno suite passes.
- Required rework: Restore deleted lines or move the new waitlist assertion into an append-only addition that preserves existing assertions exactly. If a prior assertion is truly wrong, use the formal `[TEST-MOD-APPROVED ORCH-NNNN]` path with rationale, but do not silently weaken the test.
- Retest: rerun `node .github/scripts/test-append-only-check.js`.

### P1-002: ORCH-0863 backend strict-grep gate fails on reconciled migration files

- Evidence: `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` failed C7 with offenders:
  - `supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql`
  - `supabase/migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql`
  - `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`
  - `supabase/migrations/20260725000001_orch_0947_biz_trip_tickets_sold.sql`
- Impact: Required pre-merge gate is red. Deploy report explains these were source-reconciled remote-only migrations, but the gate currently rejects them.
- Required rework: Either remove/rebase away transient reconciliation files before PR, or explicitly allowlist the exact reconciled migration files in the backend gate with an ORCH-owned rationale. Then rerun the strict-grep gate.
- Retest: rerun `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`.

### P2-001: Required device/web parity remains unverified at runtime

- Evidence: Maestro `2.5.1`, booted iOS simulator, and Android emulator are available, but no waitlist Maestro flow exists under `mingla-business/maestro/`. Live query found zero waitlist-enabled ticket rows, so the planner panel could not be exercised against persisted data without creating live data.
- Impact: SPEC SC-3 requires business iOS, business Android, and business web-preview parity for the planner panel and realtime count update. Source code supports the shared path, but runtime parity evidence is incomplete.
- Required rework or manual gate: Add/run a waitlist planner Maestro flow against seeded non-production data, or provide operator-approved live test data and run iOS/Android/web preview verification.

### P2-002: True live FIFO/idempotency mutation paths were not executed

- Evidence: Supabase MCP SQL ran as `supabase_read_only_user`; TEST did not persistently mutate live data. T-WL-07/T-WL-08 are repo-running source-regression checks, and live SQL verified the trigger/function definitions, but no live `tickets.status` flip was executed.
- Impact: SC-6 and adversarial T-WL-07/T-WL-08 are partially verified, not end-to-end proven on live data.
- Required rework or manual gate: Run the FIFO/idempotency SQL against a disposable branch or operator-approved test rows, then verify oldest rows invite first and repeated status flips enqueue exactly one notification.

## 5. Verification Performed

| Check | Result | Evidence |
|---|---|---|
| Live migration applied | PASS | Supabase migration list includes `20260724000010 orch_0948_waitlist_feature`. |
| Live edge functions | PASS | `waitlist-signup` v1 `verify_jwt=false`; `ticket-confirmation-dispatch` v81; `notification-retry-sweeper` v51. |
| Live schema/RPC/trigger read-only check | PASS | `order_id_nullable=YES`, `waitlist_trigger_exists=true`, `event_waitlist_get_exists=true`, `dedupe_email_idx_exists=true`, `fifo_idx_exists=true`. |
| Live RLS read-only check | PASS | `waitlist_entries` has authenticated brand-team SELECT policy only; no anon insert policy was added. |
| Live anon edge negative paths | PASS | `/waitlist-signup` returned 400 `invalid_input` for `consent:false`, 422 `missing_contact`, and 404 for fake enabled-ticket lookup; no QA row was created. |
| Deno check | PASS | `deno check` on the three edge functions plus T-WL-10 passed. |
| Deno focused suite | PASS | `37 passed | 0 failed`. Includes T-WL-01, T-WL-02, T-WL-05, T-WL-06, T-WL-07, T-WL-08, T-WL-09, T-WL-10, and sweeper/dispatcher regressions. |
| Jest focused suite | PASS | 3 suites, 8 tests passed: QuantityRow, JoinWaitlistSheet happy path, JoinWaitlistSheet adversarial. |
| T-WL-12 strict-grep self-test | PASS | `node --test .github/scripts/strict-grep/__tests__/orch-0948-confirm-exclusion.test.mjs`: 3 passed. |
| ORCH-0948 confirm exclusion gate | PASS | `node .github/scripts/strict-grep/orch-0948-waitlist-feature.mjs`: PASS. |
| ORCH-0863 backend gate | FAIL | C7 rejects four reconciled migrations. See P1-002. |
| Append-only test gate | FAIL | Existing sweeper test has deleted lines. See P1-001. |
| Git diff hard guard | PASS | Forbidden-path grep returned no `app-mobile/`, `mingla-admin/`, confirm route, or `TicketQrCarousel.tsx` diff. |
| `git diff --check` | PASS | No whitespace errors. |

## 6. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-1-web | PASS by source/test | `PublicEventPage.tsx` opens `JoinWaitlistSheet`; package `QuantityRow` has waitlist affordance; Jest/source tests pass. | None. |
| SC-2-web | PASS by source/test | Checkout index passes `onJoinWaitlist`; `JoinWaitlistSheet` mounted; QuantityRow test passes. | None. |
| SC-3-iOS/android/web | PARTIAL | `TicketTierEditSheet` uses `useEventWaitlist`, count/list panel, nested `WaitlistEntriesSheet`; no runtime parity executed. | P2-001. |
| SC-4 | PARTIAL | Edge source/test asserts valid email+consent insert shape; live project not mutated. | P2-002/manual live-data gap. |
| SC-5 | PASS by source/test | T-WL-02 and service mapping cover 409 `already_waiting`; sheet copy covered. | None. |
| SC-6 | PARTIAL | Live trigger/function exists; T-WL-07/T-WL-08 source tests pass; no live status flip. | P2-002. |
| SC-7 | PARTIAL | Dispatcher branch and T-WL-10 pass; provider send not executed against live Resend/Twilio. | Manual provider gate remains. |
| SC-8 | PASS live negative | Anon call returned 400 `{"error":"invalid_input","detail":"Consent is required"}`. | None. |
| SC-9 | PASS live negative | Anon call returned 422 `{"error":"missing_contact"}`. | None. |
| SC-10 | PASS for edge, PARTIAL for web UI | `waitlist-signup` live accepts anon key and is `verify_jwt=false`; buyer-web routes have no `useAuth` in waitlist path. Browser runtime not exercised. | P2-001 for runtime parity. |
| SC-11 | PARTIAL | No source evidence of dead taps/silent generic errors in covered paths; runtime console not checked. | P2-001. |
| SC-12 | PASS | ORCH-0948 strict-grep passes; forbidden-path diff grep returned empty. | None. |

## 7. SPEC §11 Regression Tests

| ID | Status | Evidence | Fails-on-revert |
|---|---|---|---|
| T-WL-01 | PASS | `signup-happy.test.ts` in Deno focused suite. | Reported by implementor at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`; path missing at base. |
| T-WL-02 | PASS | `signup-dedupe.test.ts` in Deno focused suite. | Reported by implementor at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`; path missing at base. |
| T-WL-03 | PASS | `JoinWaitlistSheet.test.tsx` in Jest focused suite. | Reported by implementor at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`; path missing at base. |
| T-WL-04 | PASS | `QuantityRow.waitlist.test.tsx` in Jest focused suite. | Reported by implementor at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`; path missing at base. |
| T-WL-05 | PASS | Migration source test in Deno focused suite. | `git cat-file -e 4b734b1c...:supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts` returned missing. |
| T-WL-06 | PASS | `waitlistSpotOpen.test.ts` in Deno focused suite. | Reported by implementor at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`; path missing at base. |
| T-WL-07 | PASS by source, live PARTIAL | Migration source test checks FIFO trigger clauses; live trigger definition exists. | Same missing-file evidence as T-WL-05. |
| T-WL-08 | PASS by source, live PARTIAL | Migration source test checks idempotency key/on-conflict clauses. | Same missing-file evidence as T-WL-05. |
| T-WL-09 | PASS by source/live schema | Migration source test passes; live `order_id_nullable=YES`. | Same missing-file evidence as T-WL-05. |
| T-WL-10 | PASS | New Deno adversarial dispatcher test: 4 passed. | `git cat-file -e 4b734b1c...:supabase/functions/ticket-confirmation-dispatch/__tests__/waitlist-spot-open.adversarial.test.ts` returned missing. |
| T-WL-11 | PASS | New Jest adversarial sheet test: 3 passed. | `git cat-file -e 4b734b1c...:mingla-business/src/components/waitlist/__tests__/JoinWaitlistSheet.adversarial.test.tsx` returned missing. |
| T-WL-12 | PASS | New Node strict-grep self-test: 3 passed. | `git cat-file -e 4b734b1c...:.github/scripts/strict-grep/__tests__/orch-0948-confirm-exclusion.test.mjs` returned missing. |

## 8. Security / Privacy

| Check | Result | Evidence |
|---|---|---|
| No anon direct insert policy | PASS | Live `pg_policies` shows only authenticated brand-team SELECT for `waitlist_entries`. |
| Service-role-only signup writer | PASS by source | `waitlist-signup/index.ts` uses `serviceClient()` after input validation. |
| No PII in tested logs/source | PASS by source | Edge source logs event/ticket/outcome, not buyer email/phone/name. |
| Anon edge availability | PASS | `waitlist-signup` live `verify_jwt=false`; anon negative-path calls returned application errors, not auth errors. |
| Provider send path | PARTIAL | Source/test coverage only; live Resend/Twilio send not executed. |

## 9. Parity

| Surface/path | Status | Notes |
|---|---|---|
| Buyer public web `/e/{brandSlug}/{eventSlug}` | PASS by source/test, runtime not browsed | Shared public page opens `JoinWaitlistSheet`. |
| Buyer checkout web `/checkout/{eventId}` | PASS by source/test, runtime not browsed | Checkout page passes `onJoinWaitlist` and mounts sheet. |
| Business iOS | UNVERIFIED runtime | iOS simulator booted; no waitlist Maestro flow/test data used. |
| Business Android | UNVERIFIED runtime | Android emulator attached; no waitlist Maestro flow/test data used. |
| Business web preview | UNVERIFIED runtime | Source supports shared RN path; web preview not opened against waitlist data. |
| Admin / app-mobile / confirm routes | PASS no-scope-touch | Forbidden diff grep empty for excluded roots/files. |

## 10. Required Actions

1. Fix P1-001 so `node .github/scripts/test-append-only-check.js` passes without weakening existing implementor tests.
2. Fix P1-002 so `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` passes with the reconciled migration situation resolved.
3. After P1 fixes, rerun the focused Deno/Jest/Node gates listed in this report.

## 11. Conditional / Manual Gates

1. Run SC-3 planner parity on business iOS, business Android, and business web preview using Maestro/browser evidence against seeded waitlist rows.
2. Run true FIFO/idempotency mutation checks on a disposable Supabase branch or operator-approved test rows.
3. Execute one provider-safe dispatcher test for `waitlist_spot_open` email/SMS if Resend/Twilio sandboxing is available.

## 12. Next Routing

Verdict is FAIL. Route to implementor/orchestrator rework for P1-001 and P1-002 before CLOSE. Tester can retest after the two red gates are fixed and runtime parity/manual gates are either completed or explicitly accepted by the operator.
