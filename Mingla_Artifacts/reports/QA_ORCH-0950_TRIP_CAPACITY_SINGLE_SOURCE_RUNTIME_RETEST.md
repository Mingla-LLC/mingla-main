# QA Runtime Retest - ORCH-0950 Trip Capacity Single Source

Retest timestamp: 2026-05-24 19:31 EDT  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`  
Branch: `ORCH-0950-trip-capacity-single-source`  
Tester: Codex tester-mingla  
Mode: RETEST  
Verdict: CONDITIONAL PASS

## Executive Summary

The requested ORCH-0950 runtime rework is not failing on an ORCH-0950 code or data-contract regression. The live DC Adventure row now has canonical capacity in `ticket_types.quantity_total=102`, `events.theme.business_trip.capacity` remains absent, iOS and business-web runtime evidence exists for edit/save/reload, and the historical checkout sessions created after those edits are real `awaiting_web_redirect` rows for EUR 750.00.

Android remains unproven at runtime, but the blocker is accepted as an environment/native-build manual gate for this ORCH: `npx expo run:android --variant debug` fails before install in `react-native-worklets` CMake configuration, not in ORCH-0950 capacity code. I did not route this back to implementor because I found no ORCH-0950 code/data regression.

Close should still be orchestrator-adjudicated, not blindly closed, for two reasons outside the original runtime rework: a fresh checkout-create call now reaches the checkout flow but fails later on Stripe hosted-session creation with `StripePermissionError/account_invalid`, and a new untracked scope-expansion report appeared in this worktree adding dashboard-coherence requirements to ORCH-0950.

## Inputs Reviewed

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RUNTIME_REWORK.md`
- `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RETEST.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- `Mingla_Artifacts/reports/SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md` appeared during this retest as untracked worktree input.

## Hard Guards Observed

- No migration apply was run.
- No edge deploy was run.
- No checkout RPC code was changed.
- No ORCH-0946 or ORCH-0947 implementation scope was changed.
- No product code was patched in tester mode.

## Findings

### P0/P1 blockers

None found for the requested ORCH-0950 runtime capacity retest.

### P2-001 - Android runtime remains unverified but is accepted as a manual/native-build gate

Status: ACCEPTED MANUAL GATE

Evidence:

- Retest command: `npx expo run:android --variant debug` from `mingla-business/`.
- Result: build failed before install during `:react-native-worklets:configureCMakeDebug[arm64-v8a]`.
- Error class: CMake configuration for `react-native-worklets`, including `No SOURCES given to target: worklets` and `RegularExpression::compile(): Invalid range in []`.
- The app never installed, so no Android planner capacity edit could run.

Adjudication:

This is not an ORCH-0950 capacity-code failure. The failure happens in native build configuration under `node_modules/react-native-worklets/android/CMakeLists.txt` before app install and before any ORCH-0950 JS, SQL, or RPC path can execute. Android remains a release/manual gate for native build readiness, but it should not route this ORCH back to implementor for capacity rework.

### P2-002 - Fresh checkout invocation now fails on external Stripe account config, not capacity

Status: EXTERNAL / NON-ORCH CAPACITY

Evidence:

- Fresh edge call to deployed `ticket-checkout-create` for DC Adventure, ticket type `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e`, quantity 6, `surface:"web"` returned HTTP 502:
  - `error=checkout_session_create_failed`
  - `detail=stripe_checkout_session_create_failed:403:stripe_key_or_capability_config:account_invalid:StripePermissionError`
- This is not `ticket_capacity_exceeded`.
- ORCH-0950 branch diff contains no checkout function or checkout client changes.

Adjudication:

The original capacity regression is not reproduced by this call. The failure occurs after checkout capacity/session logic reaches Stripe hosted-session creation. Orchestrator should decide whether this belongs to a separate Stripe/config follow-up; it is not a reason to send ORCH-0950 back to implementor for capacity logic.

### P2-003 - Runtime evidence scripts are local ignored artifacts

Status: PROCESS NOTE

Evidence:

- `git check-ignore -v Mingla_Artifacts/evidence/orch-0950-runtime/web-authenticated-edit.spec.js` reports `.gitignore:117:Mingla_Artifacts/evidence/`.
- The runtime rework report cites local evidence under `Mingla_Artifacts/evidence/orch-0950-runtime/` and screenshots under `/tmp/`.

Adjudication:

This is acceptable for this retest because the durable reports summarize the command results and the linked DB rows confirm the claimed final state. For close-quality auditability, orchestrator may want to keep the important runtime script text or screenshot descriptions in a tracked report.

### P2-004 - New ORCH-0950 dashboard scope expansion appeared during retest

Status: ORCHESTRATOR ADJUDICATION REQUIRED

Evidence:

- New untracked file: `Mingla_Artifacts/reports/SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md`.
- It says an ORCH-0947 close session added dashboard symptoms into ORCH-0950 scope, including missing Spots denominator, `Date TBD`, stale tier-card denominator, and possible remaining-count issues.

Adjudication:

This runtime retest did not implement or verify those expanded dashboard requirements. If the scope expansion is authoritative, ORCH-0950 should not be closed yet; it should go through orchestrator/spec or a bounded implementor rework for that new scope. If the current request intentionally excludes that expansion, the original runtime capacity rework can proceed to close with the Android manual gate accepted.

## Claim Verification Matrix

| Claim | Result | Evidence |
| --- | --- | --- |
| P1-001 from prior QA remains fixed | PASS | Current diff has no checkout files and no ORCH-0946/ORCH-0947 product leak; ORCH-0863 strict grep passed. |
| Service reader derives trip capacity from ticket types | PASS | `tripsService.ts` maps `ticketTypes[0]?.quantity_total ?? null` into `readBusinessTrip(...)`; `readBusinessTrip` sets `capacity: ticketCapacity`. |
| `updateTripBasics` cannot write capacity to JSONB | PASS | `tripsService.ts` throws before network when `businessTrip.capacity` is present; Jest guard passed. |
| Draft Step 1 capacity writes through pricing/ticket writer | PASS | `TripCreatorWizard.tsx` omits capacity from basics patch and then calls `updateTripPricing(... capacity: step1Draft.capacity ?? 1)`. |
| Migration strips legacy JSONB capacity | PASS | Migration strips `business_trip.capacity` and post-checks residue; Deno T-01 passed. |
| Live edit RPC writes ticket capacity and strips inbound capacity patch | PASS | Migration updates `public.ticket_types.quantity_total = v_new_capacity`, then removes `{theme,business_trip,capacity}` before the event theme merge; Deno T-02/T-03 passed. |
| Publish validator reads canonical capacity | PASS | Migration reads `tt.quantity_total INTO v_capacity`; Deno T-04 passed. |
| Checkout capacity gate remains on ticket type total | PASS for ORCH-0950 | Deno T-05 passed; branch diff has no checkout RPC/client changes; fresh checkout did not return `ticket_capacity_exceeded`. |
| iOS runtime edit/save/reload proof exists | PASS by runtime evidence + DB | Rework report records Maestro iOS edit 100 to 101 and reload screenshot; linked DB final state confirms later canonical progression to 102 with no JSONB capacity. |
| Business-web preview edit/save/reload proof exists | PASS by runtime evidence + DB | Rework report records Playwright edit 101 to 102 and reload screenshot; linked DB confirms `quantity_total=102`, `has_theme_capacity=false`, `updated_at=2026-05-24 22:17:15.180685+00`. |
| Buyer checkout was preserved after runtime edits | PASS for historical runtime proof; current external config issue noted | Linked DB confirms reported checkout sessions `789bc279-56e0-4631-a451-01ec5cec7208` and `5da11765-1e7f-4dd4-ae8d-bee6fbae758a` exist with `status=awaiting_web_redirect`, `failure_reason=null`, `total_cents=75000`, `currency=EUR`. |
| Android runtime proof is complete | ACCEPTED MANUAL GATE | Native build fails before install in `react-native-worklets` CMake. |

## Runtime Evidence

### Linked DB canonical row

Read-only linked query:

```sql
select e.id as event_id,
       e.title,
       tt.id as ticket_type_id,
       tt.quantity_total,
       tt.updated_at,
       ((e.theme->'business_trip') ? 'capacity') as has_theme_capacity
from public.events e
join public.trip_pricing_tiers tpt on tpt.event_id=e.id
join public.ticket_types tt on tt.id=tpt.ticket_type_id
where e.id='060d0483-50db-48d1-840b-73d9fc59356a';
```

Result:

```json
{
  "event_id": "060d0483-50db-48d1-840b-73d9fc59356a",
  "title": "The DC Adventure",
  "ticket_type_id": "d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e",
  "quantity_total": 102,
  "updated_at": "2026-05-24 22:17:15.180685+00",
  "has_theme_capacity": false
}
```

### Historical checkout sessions cited by implementor

Read-only linked query:

```sql
select id, event_id, status, total_cents, currency, failure_reason, created_at
from public.ticket_checkout_sessions
where id in (
  '789bc279-56e0-4631-a451-01ec5cec7208',
  '5da11765-1e7f-4dd4-ae8d-bee6fbae758a'
)
order by created_at;
```

Result:

| Session | Created | Status | Total | Failure |
| --- | --- | --- | --- | --- |
| `789bc279-56e0-4631-a451-01ec5cec7208` | `2026-05-24 22:07:47.200991+00` | `awaiting_web_redirect` | `75000 EUR` | `NULL` |
| `5da11765-1e7f-4dd4-ae8d-bee6fbae758a` | `2026-05-24 22:17:36.000799+00` | `awaiting_web_redirect` | `75000 EUR` | `NULL` |

### Fresh checkout call

Result:

```json
{
  "http": 502,
  "error": "checkout_session_create_failed",
  "detail": "stripe_checkout_session_create_failed:403:stripe_key_or_capability_config:account_invalid:StripePermissionError"
}
```

Interpretation: capacity gate was not the failure mode; Stripe hosted-session creation is externally blocked at the moment of this retest.

## Regression And Static Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| ORCH-0950 strict grep | PASS | `I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE: PASS files=1437 violations=0` |
| ORCH-0950 strict grep self-test | PASS | 4/4 Node tests passed |
| Marketing hub strict grep | PASS | C1-C7 passed |
| Deno canonical capacity regression | PASS | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts`, 6/6 passed |
| Business Jest guard | PASS | `npx jest src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts --runInBand`, 1/1 passed |
| Diff whitespace | PASS | `git diff --check` produced no output |
| Linked migration ledger | WARNING | ORCH-0950 `20260725000000` is local+remote; unrelated remote-only rows `20260724000007`, `20260724000010`, `20260725000001`, and `20260726000000` remain. No migration action taken. |

## Android Adjudication

Android is not an ORCH-0950 capacity blocker in this retest. The native debug build fails before install:

```text
Execution failed for task ':react-native-worklets:configureCMakeDebug[arm64-v8a]'.
CMake Error at CMakeLists.txt:59 (add_library):
  No SOURCES given to target: worklets
RegularExpression::compile(): Invalid range in [].
```

This reproduces the same class as the prior report and occurs under native dependency/CMake configuration. Because iOS and business-web use the shared React Native capacity path and both are proven against the live fixture, Android can be accepted as a manual gate unless orchestrator chooses to make native Android build readiness a separate release blocker.

## Scope Expansion Note

The new `SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md` file changes the close-readiness question if it is authoritative. It adds dashboard reader and display requirements that were not part of the runtime rework report I was asked to retest. This QA report therefore supports close only for the original capacity single-source runtime rework, not for the newly expanded dashboard-coherence scope.

## Facts, Assumptions, Risks, Open Questions

Facts:

- Canonical DB row is correct now: capacity 102, no JSONB capacity.
- iOS/web runtime evidence plus linked DB poststate prove the original edit/save/reload path against DC Adventure.
- Historical checkout sessions after runtime edits exist and were not capacity failures.
- Fresh checkout now fails on Stripe hosted-session account/capability config, not capacity.
- Android native build still fails before install.
- No ORCH-0950 checkout RPC/client files are in the branch diff.

Assumptions:

- The runtime rework report's iOS/web UI steps are truthful local evidence; I independently verified the resulting DB/session state, not every screen interaction.
- Android's native-build failure is shared dependency/build-environment readiness, not hidden ORCH-0950 behavior.

Risks:

- If the scope-expansion artifact is authoritative, closing ORCH-0950 now would leave dashboard coherence unfinished.
- Current Stripe hosted checkout config can mask capacity-checkout proof in future retests until the account/capability issue is cleared.
- Runtime evidence scripts under `Mingla_Artifacts/evidence/` are ignored and will not travel with the branch unless summarized in tracked reports.

Open questions:

- Should orchestrator accept the scope-expansion artifact as binding on ORCH-0950 before close?
- Should the Stripe hosted-session `account_invalid` failure become a separate payment/config ORCH or a release gate outside ORCH-0950?

## Routing

Route to Codex orchestrator-mingla for adjudication, not Codex implementor-mingla for ORCH-0950 code rework. If orchestrator accepts the Android manual gate, treats the fresh Stripe config failure as external to ORCH-0950, and explicitly excludes or separately routes the new dashboard scope expansion, this runtime rework can close. If the dashboard expansion is binding, route a bounded spec/rework for that new scope; do not treat this runtime retest as an ORCH-0950 capacity-regression FAIL.
