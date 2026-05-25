# QA Report: Trip Capacity Single Source (ORCH-0950)

> Date: 2026-05-24
> Mode: TARGETED + SPEC-COMPLIANCE
> Verdict: FAIL
> Findings: P0:0 P1:2 P2:1 P3:0 P4:2
> Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`

## 1. Layman Summary

The ORCH-0950 capacity fix itself is mostly behaving correctly: the migration is applied on the linked Supabase project, DC Adventure no longer stores capacity in `events.theme.business_trip.capacity`, `ticket_types.quantity_total` is 100, and a DC-style buyer-web checkout for 6 seats returned HTTP 200 instead of the old `ticket_capacity_exceeded` failure.

QA still FAILS. The branch includes an ORCH-0946 migration and allowlist change despite the dispatch hard guard saying no ORCH-0946 scope. Also, the mandatory iOS simulator / Android emulator planner-edit runtime matrix did not complete: iOS automation hung, and the Android emulator did not have the Mingla Business app installed.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_TRIP_CAPACITY_DUAL_SOURCE.md`
- Primary migration: `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`
- Service/client files: `mingla-business/src/services/tripsService.ts`, `mingla-business/src/components/trip/TripCreatorWizard.tsx`, `mingla-business/src/utils/tripAdapter.ts`
- Tests: `supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts`, `mingla-business/src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RPC | `20260725000000_orch_0950_trip_capacity_single_source.sql` | Backfill, strip, live-edit RPC reroute, publish validator reroot, function comments, self-verification. |
| Scope guard | `git diff main...HEAD`, `20260724000006_orch_0946_public_ticket_types_remaining.sql` | Checked for forbidden ORCH-0946 / ORCH-0947 scope. |
| Services | `tripsService.ts` | `readBusinessTrip` capacity source and `updateTripBasics` guard. |
| Components | `TripCreatorWizard.tsx` | Step 1 capacity autosave routes through `updateTripPricing`. |
| Buyer web | Deployed `ticket-checkout-create` | DC Adventure quantity-6 checkout session creation. |
| Native | iOS sim + Android emu attempts | iOS booted but Maestro hung; Android booted but no business app package installed. |
| Tests/build | Deno, Jest, strict-grep, TypeScript | Focused gates pass; full TS still red on pre-existing repo errors. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Migration strips JSONB capacity and reconciles to ticket_types | `20260725000000` lines 82-120; live DC anon query | Verified | DC Adventure `hasThemeCapacity=false`, ticket capacity 100. |
| Live edit capacity reroutes to `ticket_types.quantity_total` | `20260725000000` lines 223-269; Deno T-02/T-03 | Verified statically | Runtime planner edit not completed on native/web UI. |
| Publish validator reads `ticket_types.quantity_total` | `20260725000000` lines 706-716; Deno T-04 | Verified statically | No publish live-fire run. |
| Checkout RPC unchanged and still reads `ticket_types.quantity_total` | No checkout RPC file in ORCH-0950 diff; Deno T-05 | Verified | Live buyer-web checkout also proved no capacity 409. |
| `updateTripBasics` rejects capacity before network | `tripsService.ts` lines 609-616; Jest test | Verified | Jest confirms no Supabase call. |
| Step 1 autosaves capacity via pricing writer | `TripCreatorWizard.tsx` lines 512-542 | Verified statically | UI live-fire unverified. |
| No ORCH-0946 / ORCH-0947 scope | `git diff main...HEAD`; ORCH-0946 migration lines 1-57 | Refuted | ORCH-0946 migration is present in branch. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Git branch/status | `git status --short --branch` | PASS with local residue noted | Branch is `ORCH-0950-trip-capacity-single-source`; unrelated local residue exists. |
| Changed-file manifest | `git diff --name-only main...HEAD` | FAIL scope guard | Includes `supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql`. |
| Strict-grep capacity gate | `node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` | PASS | `files=1434 violations=0`. |
| Strict-grep self-test | `node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.test.mjs` | PASS | 4/4 tests passed. |
| Deno migration contract | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS | 6/6 tests passed. |
| Jest client guard | `npx jest src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts --runInBand` | PASS | 1/1 test passed. |
| Diff whitespace | `git diff --check` | PASS | No output. |
| Linked migration ledger | `/Users/sethogieva/bin/supabase migration list --linked`; Supabase MCP `list_migrations` | PASS | Remote includes `20260725000000 orch_0950_trip_capacity_single_source`. |
| Live DC data probe | Supabase JS anon read | PASS | DC Adventure is scheduled trip, no JSONB capacity, ticket capacity 100. |
| DC-style buyer-web live-fire | POST deployed `ticket-checkout-create` for DC Adventure, quantity 6, surface `web` | PASS | HTTP 200 `requires_web_redirect`, total 75000 EUR; no `ticket_capacity_exceeded`. |
| Buyer-web page availability | `curl -L https://business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a` | PASS | HTTP 200, 52026 bytes. |
| iOS simulator runtime | Boot iPhone 17 Pro + run Maestro `tr2-tap-handler-routes-by-type.yaml` | BLOCKED | Sim booted and business app installed, but Maestro hung with no output; killed after timeout. |
| Android emulator runtime | Boot Pixel_8_Pro + inspect packages | BLOCKED | Emulator booted; only `com.mingla.app.v2` present, no `com.sethogieva.minglabusiness` / `com.mingla.business`. |
| Full business TS | `npx tsc --noEmit --pretty false` | FAIL unrelated/pre-existing | Existing errors in checkout buyer pages, ComposerV2, IconChrome, native payments package, shared packages, older tests. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| One owner per truth | PASS for ORCH-0950 | Capacity canonicalized to `ticket_types.quantity_total`; service alias derives from ticket rows. |
| No silent failures | PASS for guard | `updateTripBasics` throws before network when capacity appears. |
| Server state server-side | PASS | Capacity source is DB ticket row; no persisted client state change. |
| No fabricated data | PASS | Live-fire used real DC Adventure row and deployed checkout function. |
| Validate at right time | PASS | Publish and live-edit validators reroot to canonical ticket capacity. |
| Exclusion consistency | FAIL scope | ORCH-0946 scope entered this PR despite hard guard. |

## 7. Findings

### P1 High

**P1-001: Branch includes ORCH-0946 migration under an explicit no-ORCH-0946 hard guard**

- **Evidence:** `git diff --name-only main...HEAD` includes `supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql`; the migration declares `-- ORCH-0946 [Buyer-web sold-out gate]` at lines 1-15 and creates/grants `public.pg_public_ticket_types_remaining` at lines 19-55.
- **What is wrong:** The TEST dispatch explicitly hard-guarded "no ORCH-0946/ORCH-0947 scope." This branch includes a full ORCH-0946 migration and an ORCH-0946 backend allowlist entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` lines 634-640.
- **Impact:** The ORCH-0950 PR would ship adjacent buyer-web sold-out-gate schema/API scope through the trip-capacity PR. That breaks the worktree-per-ORCH contract and makes close/revert/review boundaries unsafe.
- **Required fix:** Remove ORCH-0946 changes from this ORCH-0950 branch, or have orchestrator rebase ORCH-0950 onto a main/base that already legitimately contains ORCH-0946. Do not smuggle the ORCH-0946 migration in the ORCH-0950 PR.
- **Retest:** Re-run `git diff --name-only main...HEAD` and confirm no ORCH-0946/ORCH-0947 files or allowlist comments remain in the ORCH-0950 diff, then rerun the strict-grep and migration ledger gates.

**P1-002: Mandatory native planner-edit runtime matrix did not complete**

- **Evidence:** iOS simulator booted and had `com.sethogieva.minglabusiness` installed, but `~/.maestro/bin/maestro --device 17091E60-C3B6-4167-980D-60C348E177F6 test mingla-business/maestro/tr2-tap-handler-routes-by-type.yaml` hung with no output and was killed. Android Pixel_8_Pro booted, but `adb shell pm list packages` showed only `package:com.mingla.app.v2`; business packages `com.sethogieva.minglabusiness` and `com.mingla.business` were absent.
- **What is wrong:** The dispatch required mandatory iOS sim, Android emu, buyer-web parity, and DC-Adventure-style live-fire validation. Buyer-web passed, but the business native planner-edit legs were not proven.
- **Impact:** Cannot claim SC-04/SC-08/SC-09/SC-10 PASS across the required native business surfaces. The code path is shared RN and statically correct, but the release gate asked for runtime proof.
- **Required fix:** Provide/install the current Mingla Business dev build on Android, ensure iOS/Android are authenticated as a brand that can edit DC Adventure or an equivalent seeded trip, then run the exact capacity-edit matrix: edit capacity upward, verify `ticket_types.quantity_total` changes, verify `events.theme.business_trip.capacity` stays absent, reload dashboard, and verify buyer checkout succeeds below the new remaining capacity.
- **Retest:** Repeat on iOS sim, Android emu, and business web preview with screenshots/log output and a read-only post-edit data probe.

### P2 Medium

**P2-001: Full `mingla-business` TypeScript remains red**

- **Evidence:** `npx tsc --noEmit --pretty false` exits 2 with existing errors in `app/checkout-trip/[tripEventId]/buyer.tsx`, `app/checkout/[eventId]/buyer.tsx`, ComposerV2, `IconChrome`, native payments module resolution, and shared packages.
- **What is wrong:** Not apparently caused by ORCH-0950, and the focused Jest/Deno gates pass, but full TS cannot be used as a green release signal.
- **Impact:** Residual compile-safety risk remains outside this ORCH.
- **Required fix:** Not ORCH-0950 scope unless orchestrator requires a clean global TS gate; keep as known pre-existing debt.

### P4 Notes

- **P4-001:** The core ORCH-0950 SQL and service wiring are consistent with the spec: backfill/strip is at migration lines 82-120, live-edit reroute/strip is at lines 223-269, publish capacity validation is at lines 706-716, service read-through is at `tripsService.ts` lines 327-345, and the client guard is at lines 609-616.
- **P4-002:** DC-style buyer-web live-fire passed after operator migration apply: deployed `ticket-checkout-create` returned HTTP 200 `requires_web_redirect` for DC Adventure quantity 6 with a hosted checkout URL, directly attacking the original 55-sold/raise-to-100 failure shape.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-01 JSONB capacity stripped | PASS | Live DC probe: `hasThemeCapacity=false`; migration strip lines 98-120 | None |
| SC-02 MAX backfill | PASS static | Migration lines 82-96; Deno T-01 | None |
| SC-03 live edit writes ticket type and strips patch | PASS static | Migration lines 223-269; Deno T-02/T-03 | Runtime edit unverified under P1-002 |
| SC-04 buyer checkout succeeds after planner edit | PARTIAL | Buyer-web DC quantity-6 succeeded; planner edit not rerun | P1-002 |
| SC-05 publish validates ticket capacity | PASS static | Migration lines 706-716; Deno T-04 | None |
| SC-06 `updateTripBasics` capacity throws | PASS | Jest guard test; `tripsService.ts` lines 609-616 | None |
| SC-07 strict-grep gate | PASS | Gate and self-test green | None |
| SC-08 dashboard KPI resolves current ticket capacity | PARTIAL | Service maps from ticket row; dashboard live reload unverified | P1-002 |
| SC-09 Step 1 autosaves via pricing writer | PASS static | `TripCreatorWizard.tsx` lines 512-542 | Runtime autosave unverified under P1-002 |
| SC-10 non-capacity trip CRUD preserved | PARTIAL | No code regression seen; full native/web sweep not completed | P1-002 |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| ORCH-0950 SECURITY DEFINER search path | N/A/PASS | New function definitions set `search_path = public, pg_temp` | PASS |
| Checkout RPC untouched | PASS | No checkout RPC file in ORCH-0950 diff; Deno T-05 | PASS |
| ORCH-0946 anon RPC scope present | P1 | `20260724000006` grants `EXECUTE` to anon/authenticated lines 51-55 | FAIL scope, not evaluated for ORCH-0950 security correctness |

## 10. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Business iOS | Attempted | BLOCKED | Sim booted; business app installed; Maestro hung. |
| Business Android | Attempted | BLOCKED | Emulator booted; business app not installed. |
| Business web preview | No | NOT RUN | Buyer-web public route checked; planner web preview not run. |
| Buyer web | Yes | PASS | DC Adventure checkout quantity 6 returned HTTP 200 hosted checkout. |
| Admin | N/A | N/A | Out of scope. |
| Consumer app | N/A | N/A | Out of scope. |

## 11. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Migration applied | Supabase CLI + MCP migration list | PASS | None |
| DC Adventure storage state | Supabase JS anon read | PASS | None for read state |
| DC-style checkout | Deployed `ticket-checkout-create` POST | PASS | Cleanup optional: abandoned checkout session `4ec07075-ae75-4dff-ab83-d0230a0b39f1` is not paid/finalized. |
| Planner edit runtime | Native/web app matrix | BLOCKED | Required before CLOSE. |

## 12. Required Actions

1. **P1-001:** Remove ORCH-0946 migration/allowlist scope from the ORCH-0950 branch, or rebase this branch onto a main/base that already contains ORCH-0946 legitimately before PR.
2. **P1-002:** Re-run mandatory runtime matrix with an authenticated Mingla Business app on iOS and Android plus business web preview; prove capacity edit writes `ticket_types.quantity_total`, does not restore JSONB capacity, dashboard reloads current capacity, and buyer checkout succeeds.

## 13. Conditional / Recommended Actions

1. Track full `mingla-business` TypeScript red separately unless orchestrator decides global TS must be green before this PR.
2. Consider adding a dedicated Maestro/Playwright ORCH-0950 live-fire script so future tester passes do not rely on ad hoc UI navigation.

## 14. Discoveries For Orchestrator

- ORCH-0946 was already applied remotely per migration ledger and local comment lines 634-640, but it is still a hard-guard violation for this ORCH-0950 branch as long as it appears in `main...HEAD`.
- The current Android emulator image has only the consumer app installed, not Mingla Business. Future business runtime QA needs a known-good Android business dev build preinstalled.

## 15. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| N/A first QA cycle | N/A | N/A | N/A |

Retest cycle: 1

## 16. Verdict

FAIL. Do not route to CLOSE. Route to implementor/orchestrator rework for the ORCH-0946 scope leak first, then rerun tester for the mandatory native + web planner-edit live-fire matrix.
