# Implementation Report: Account Sessions Form Encoding Rework (ORCH-0954)

> Date: 2026-05-25
> Mode: Rework
> Spec: User-dispatched rework from `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`
> Status: implemented and verified

## 1. Layman Summary

Stripe was rejecting Mingla's embedded onboarding/account-management session calls because Mingla sent that one Stripe endpoint as JSON. The edge helper now keeps JSON for Accounts v2 while sending Account Sessions as Stripe's documented form parameters, so the next live-fire can reach the provider path that was previously blocked.

## 2. Request And Context

- **Request:** Fix the P1 blocker where `stripeBlueprintRequest()` sends `/v1/account_sessions` as JSON even though Stripe documents Account Sessions create with form-style parameters.
- **Source:** `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`, "New finding - P1 BLOCKER - Account Sessions are sent to Stripe with the wrong content type".
- **Affected surfaces:** Supabase shared Stripe client and scoped Deno regression tests.
- **Related issues/artifacts:** ORCH-0954 [Embedded onboarding cutover], COMMS-0002, COMMS-0003.

## 3. Scope

- **In scope:** Split request body encoding by endpoint family; add regression coverage that fails if Account Sessions use JSON; run Deno and strict-grep gates.
- **Out of scope:** Live-fire retest, edge deploy, secret writes, production key changes, `brand-stripe-tax-dashboard-link/`, migrations.
- **Assumptions:** Stripe Accounts v2 and Account Links v2 should continue using JSON in this raw blueprint client; only `/v1/account_sessions` needs form encoding.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry check | COMMS-0002 and COMMS-0003 were already acknowledged for implementor ORCH-0954 and remain active constraints. |
| `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` | Tester failure contract | Stripe rejected `/v1/account_sessions` with the form content-type error. |
| `supabase/functions/_shared/stripeBlueprintClient.ts` | Defect owner | `createAccountSession()` used the JSON-only raw request helper. |
| `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts` | Existing helper coverage | Test decoded all captured bodies as JSON, so it could not catch the transport bug. |
| `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts` | Provider-shape coverage | Mocked Stripe contract did not reject JSON content for Account Sessions. |
| `supabase/functions/brand-stripe-onboard/index.ts` | Caller check | Logical Account Session payload was already correct and no longer sent `collection_options`. |
| `supabase/functions/brand-stripe-account-session/index.ts` | Caller check | Account management/onboarding surfaces both route through `createAccountSession()`. |
| Stripe docs | External API truth | Account Sessions create uses form-style `-d` parameters; Accounts v2 create uses JSON. |

Docs checked:

- https://docs.stripe.com/api/account_sessions/create
- https://docs.stripe.com/api/v2/core/accounts/create

## 5. Blast Radius

- **Direct changes:** Shared Stripe HTTP helper now supports `bodyFormat: "json" | "form"`; `createAccountSession()` opts into form encoding.
- **Cascade changes:** `brand-stripe-onboard` and `brand-stripe-account-session` now send Stripe Account Sessions with `application/x-www-form-urlencoded`.
- **Parity surfaces:** Business embedded onboarding and account-management session creation are affected through the edge functions.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** Preserved `STRIPE_RAK_ONBOARD` only; no secret fallback or key writes.
- **Deploy path:** Edge functions need tester live-fire first; this rework did not deploy.

## 6. Old To New Receipts

### `supabase/functions/_shared/stripeBlueprintClient.ts`

- **Before:** Every `stripeBlueprintRequest()` call set `Content-Type: application/json` and `JSON.stringify(options.body)`.
- **After:** The helper defaults to JSON but can form-encode nested Stripe parameters with bracket notation; `createAccountSession()` sets `bodyFormat: "form"`.
- **Why:** Stripe Account Sessions create is a v1 endpoint documented with form-style parameters, while Accounts v2 remains JSON.
- **Approx lines changed:** 50.

### `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`

- **Before:** Captured request bodies were always parsed as JSON and Account Session tests asserted JSON object shape.
- **After:** Captures JSON or form bodies based on `Content-Type`; Account Session coverage asserts form content type, non-JSON body, `account`, and nested `components[...]` params.
- **Why:** Local regression now fails on the exact content-type bug.
- **Approx lines changed:** 40.

### `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts`

- **Before:** Mock provider accepted JSON Account Sessions if the object shape looked right.
- **After:** Mock provider rejects JSON for `/v1/account_sessions` with Stripe's documented content-type error and asserts form params.
- **Why:** Provider-shape mock now matches the live-fire failure mode.
- **Approx lines changed:** 65.

## 7. Implementation Details

- **Architecture decisions:** Keep the existing raw helper and add an explicit body encoding option instead of introducing a second client or touching callers beyond the endpoint wrapper.
- **Data flow:** Account Session input remains `{ accountId, components, idempotencyKey }`; only the HTTP body changes to `account=...&components[...]=...`.
- **Mutation/query behavior:** None.
- **State handling:** None.
- **Error handling:** Existing Stripe error parsing is unchanged.
- **Copy/accessibility:** None.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Keep JSON for Accounts v2 | Default `bodyFormat` remains JSON; `createRecipientAccount()` unchanged | Unit and contract assertions for `Content-Type: application/json` | PASS |
| Send `/v1/account_sessions` as form parameters | `createAccountSession()` uses `bodyFormat: "form"` | Unit and contract assertions for `application/x-www-form-urlencoded` and nested bracket params | PASS |
| Regression fails on JSON Content-Type for Account Sessions | Contract mock rejects JSON Account Sessions with the Stripe error from live-fire | Deno contract suite green after fix; would fail on old JSON helper | PASS |
| TEST mode only / no deploy / no secrets | No Stripe live API mutation, no Supabase secret write, no Vercel key change, no deploy | Command history and changed-file set | PASS |
| Do not touch tax dashboard link | No file under `brand-stripe-tax-dashboard-link/` changed | `git diff --name-only` scoped review | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-COMMS-LEDGER-ENTRY-STANZA | Yes | Yes | Ledger read first; active warnings factored in. |
| I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED | Yes | Yes | Stripe Account Sessions and Accounts v2 docs checked inline. |
| RAK-only Stripe onboarding credentials | Yes | Yes | Fail-close test remains green. |
| ORCH-0954 controller props pinned | Yes | Yes | Strict-grep guard passed. |
| No tax-dashboard rewrite in ORCH-0954 | Yes | Yes | Guarded by COMMS-0001/dispatch; no touch. |

## 10. Parity Check

- **Mobile:** No mobile code touched.
- **Business app:** Edge-generated onboarding/account-management URLs benefit through shared Account Session creation.
- **Admin:** No admin code touched.
- **Public/web:** No marketing/public code touched.
- **Solo/collab:** No mode-specific behavior.
- **Gaps:** Browser render and KYC flows still require tester SPEC §6 live-fire retest after deploy.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None persisted.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Edge function import path unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Format | `/Users/sethogieva/.deno/bin/deno fmt supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts` | PASS | Checked 3 files. |
| Shared client check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/stripeBlueprintClient.ts` | PASS | Exit 0. |
| Scoped shared Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts` | PASS | 6 passed, 0 failed. |
| Edge check: onboard | `/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-onboard/index.ts` | PASS | Exit 0. |
| Edge check: account session | `/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-account-session/index.ts` | PASS | Exit 0. |
| Broader ORCH-0954 edge suite | `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-read --allow-run=/Users/sethogieva/.deno/bin/deno supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts supabase/functions/brand-stripe-onboard/index.test.ts` | PASS | 12 passed, 0 failed. |
| ORCH-0954 controller guard | `node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs` | PASS | Managed-risk controller pinned. |
| ORCH-0954 RAK guard | `node .github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs` | PASS | RAK-only guard passed. |
| ORCH-0863 known backend gate | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | Relevant because COMMS-0002 warned about this gate. |
| Whitespace | `git diff --check -- supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts` | PASS | No whitespace errors. |

## 13. Regression Surface

1. Account Session onboarding/session minting: now changes transport encoding for both `brand-stripe-onboard` and `brand-stripe-account-session`.
2. Accounts v2 create: must remain JSON and unchanged for `/v2/core/accounts`.
3. Account Links v2: still uses default JSON in the same helper.
4. Stripe error surfaces: unchanged error parsing should still return safe provider messages.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Live-fire not rerun by implementor | Local Deno proves wire contract, but Stripe TEST + browser smoke still must verify deployed behavior. | Tester reruns SPEC §6 live-fire and records PASS/FAIL. | `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` |
| Existing dirty worktree | Several files/artifacts pre-existed this rework. | Orchestrator/tester decide scoped staging/commit boundaries. | Worktree status |

## 15. Discoveries For Orchestrator

- None beyond the already documented COMMS-0002 and COMMS-0003 warnings.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** Code affects `brand-stripe-onboard` and `brand-stripe-account-session` through `_shared/stripeBlueprintClient.ts`; do not deploy until orchestrator/tester routing authorizes it.
- **Mobile OTA/native:** None.
- **Business/admin web:** None.
- **Env vars/secrets:** None changed; do not alter Stripe/Vercel Production keys.

## Suggested Commit Message

```text
fix(stripe): form-encode embedded account sessions

Resolves: ORCH-0954
Evidence: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_ACCOUNT_SESSIONS_FORM_ENCODING.md
Deploy: edge deploy after tester/orchestrator approval only
```

## Ready-To-Test Checklist

1. Deploy the scoped edge-function update only after the authorized routing step.
2. Run SPEC §6 live-fire on TEST mode using a fresh brand.
3. Confirm `brand-stripe-onboard` returns a hosted onboarding URL/client secret instead of Stripe's form content-type error.
4. Confirm `brand-stripe-account-session` returns a management URL/client secret for the same brand.
5. Continue browser smoke for embedded onboarding, notification banner, account management, bank edit, payout schedule, tax-registration inspection, and DB diff.
