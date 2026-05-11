# IMPLEMENTATION ORCH-0777 — Real-Device Order Visibility and Notification Revival

Date: 2026-05-11
Owner: Codex `implementor-mingla`
Status: implemented, partially verified
Dispatch: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Review: `Mingla_Artifacts/reports/REVIEW_SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`

## 1. Phase 1 / Fix A — Organizer Order Visibility

### Files Changed

| File | Change |
|---|---|
| `mingla-business/src/services/eventOrdersService.ts` | Removed top-level `orders.brand_id` from the local row type, PostgREST SELECT, and mapper. Added `events!inner ( brand_id )` and now maps `OrderRecord.brandId` from `order.events?.brand_id ?? ""`. |
| `mingla-business/app/event/[id]/orders/index.tsx` | Added the narrow `ordersQuery.isError` branch so load failures render "Couldn't load orders" instead of falling through to "No orders yet." |
| `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | Added G-A1/G-A2/G-A3/G-A4 organizer order visibility assertions. |
| `.github/workflows/strict-grep-mingla-business.yml` | Registered the existing ORCH-0777 strict-grep script as one workflow job in the existing registry workflow. No parallel workflow file was created. |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | Added `describe("ORCH-0777 organizer order visibility repair", ...)` with three regression assertions. |

### Spec Traceability

| Spec item | Evidence |
|---|---|
| A.2 SELECT contract | `eventOrdersService.ts` now selects `events!inner ( brand_id )` and no longer selects top-level `brand_id`. |
| A.3 mapper contract | `brandId` now maps from `order.events?.brand_id ?? ""`; downstream `OrderRecord.brandId` was not changed. |
| A.4 honest error state | Orders route now branches on `ordersQuery.isError` before empty state rendering. |
| A.5 strict-grep gate | ORCH-0777 strict-grep script contains four organizer visibility assertions and passes locally. |
| A.6 Jest migration guards | Migration-guards suite contains and passes the new organizer visibility regression block. |

### Guard Adjustment Note

The SPEC's literal G-A2/Jest sample pattern would reject any `brand_id` inside the entire `.from("orders")` block, which conflicts with the required `events!inner(brand_id)` embed. I implemented the contract intent instead: forbid the old top-level `event_id, brand_id, buyer_email` scalar selection while requiring the `events` embed and the new mapper source.

### Phase 1 Verification

| Command / Probe | Result |
|---|---|
| `/opt/homebrew/bin/node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | PASS: `ORCH-0777 production checkout guard passed.` |
| `npx jest src/services/__tests__/ticketCheckoutMigrationGuards.test.ts --runInBand` from `mingla-business/` | PASS: 1 suite, 11 tests. |
| `npx tsc --noEmit` from `mingla-business/` | PASS: exit 0, no output. |
| `npm run test:orch-0777` from `mingla-business/` | PASS: strict-grep passed; Jest 4 suites / 15 tests passed; TypeScript completed. |
| Production PostgREST embed sanity: `orders?select=id,event_id,events!inner(brand_id)&event_id=eq.b1ab659e-...` | PASS: 8 rows returned; all rows had `events.brand_id = 22a18413-bfbf-4087-9ba7-45f70deba0f3`. |
| Production event brand source read: `events?select=id,brand_id&id=eq.b1ab659e-...` | PASS: one row returned with `brand_id = 22a18413-bfbf-4087-9ba7-45f70deba0f3`. |

## 2. Phase 2 / Fix B — Failed-Terminal Notification Revival

### Candidate Set

Privacy-safe candidate read used only id/order/channel/status/count/timestamps. Live candidate count was 5 rows, not the approximate 7-8 expected by the investigation; the SPEC says live count is authoritative.

| notification_id | order_id | channel | pre_status | pre_attempt_count |
|---|---|---|---|---|
| `bec9b34b-1498-46e6-ae89-5f869b0f96ba` | `869bee74-0025-4dde-9d68-1e22187017bb` | email | `failed_terminal` | 1 |
| `d33ca033-f444-4284-87e0-361d73845a98` | `869bee74-0025-4dde-9d68-1e22187017bb` | sms | `failed_terminal` | 1 |
| `f8ff384c-c0bd-4e06-b414-330ae8b8d761` | `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` | email | `failed_terminal` | 1 |
| `43a586dd-3d0f-4385-9f43-6cd6720652de` | `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` | sms | `failed_terminal` | 1 |
| `a739efc0-0eeb-4e28-aca6-6215aa1568a9` | `e8958375-d3c6-411f-a678-d6a236728608` | sms | `failed_terminal` | 1 |

### Revival Update Evidence

Each candidate row was updated by row id with the SPEC's status and timestamp re-checks. Each update returned one row:

| notification_id | channel | post_update_status | post_update_attempt_count |
|---|---|---|---|
| `bec9b34b-1498-46e6-ae89-5f869b0f96ba` | email | `failed_retryable` | 0 |
| `d33ca033-f444-4284-87e0-361d73845a98` | sms | `failed_retryable` | 0 |
| `f8ff384c-c0bd-4e06-b414-330ae8b8d761` | email | `failed_retryable` | 0 |
| `43a586dd-3d0f-4385-9f43-6cd6720652de` | sms | `failed_retryable` | 0 |
| `a739efc0-0eeb-4e28-aca6-6215aa1568a9` | sms | `failed_retryable` | 0 |

### Dispatcher Invocation Evidence

The already-ACTIVE `ticket-confirmation-dispatch` function was invoked once per affected order using a transiently fetched service-role API key. The key was not printed or artifacted.

| order_id | outcomes |
|---|---|
| `869bee74-0025-4dde-9d68-1e22187017bb` | email `sent`; sms `failed_terminal` |
| `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` | email `sent`; sms `sent` |
| `e8958375-d3c6-411f-a678-d6a236728608` | sms `failed_terminal` |

### Post-Run Ledger Evidence

| notification_id | order_id | channel | final_status | provider_present | sent_at_present | last_error_present |
|---|---|---|---|---|---|---|
| `bec9b34b-1498-46e6-ae89-5f869b0f96ba` | `869bee74-0025-4dde-9d68-1e22187017bb` | email | `sent` | true | true | false |
| `d33ca033-f444-4284-87e0-361d73845a98` | `869bee74-0025-4dde-9d68-1e22187017bb` | sms | `failed_terminal` | false | false | true |
| `f8ff384c-c0bd-4e06-b414-330ae8b8d761` | `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` | email | `sent` | true | true | false |
| `43a586dd-3d0f-4385-9f43-6cd6720652de` | `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` | sms | `sent` | true | true | false |
| `a739efc0-0eeb-4e28-aca6-6215aa1568a9` | `e8958375-d3c6-411f-a678-d6a236728608` | sms | `failed_terminal` | false | false | true |

Interpretation: the buyer-email revival succeeded for both email rows, including the operator's `c1d35ae6-...` free checkout. Two SMS rows re-terminalized and were not looped again, per the SPEC's instruction that terminal rows after revival require separate ad-hoc operator judgment.

### No-Duplicate Evidence

| order_id | payment_status | rollup_status | line_item_count | ticket_count | valid_ticket_count | email_notification_count | sms_notification_count |
|---|---|---|---:|---:|---:|---:|---:|
| `869bee74-0025-4dde-9d68-1e22187017bb` | `paid` | `partial` | 1 | 1 | 1 | 1 | 1 |
| `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` | `paid` | `sent` | 1 | 1 | 1 | 1 | 1 |
| `e8958375-d3c6-411f-a678-d6a236728608` | `paid` | `failed` | 1 | 1 | 1 | 1 | 1 |

No duplicate orders, line items, tickets, or notification rows were created for the affected orders.

### Phase 2 Deployment / Migration Checks

| Check | Result |
|---|---|
| `ticket-confirmation-dispatch` active function | ACTIVE v11. No deploy was run. |
| `supabase_migrations.schema_migrations` ORCH-0777 tail | Versions present: `20260515000013`, `20260515000014`, `20260515000015`, `20260515000016`, `20260515000017`; no `20260515000018+` migration from this spec. |

## 3. Hard-Guard Self-Attestation

| Guard | Result |
|---|---|
| No `supabase db push` | PASS — no DB push command was run. |
| No Edge Function deploy | PASS — no deploy command was run. |
| No provider/dashboard mutation | PASS — no provider/dashboard settings were changed. |
| No new migration | PASS — no migration file was created. |
| No source edit to `ticket-confirmation-dispatch` or `_shared/ticketCheckout` | PASS for this implementation scope — those files already had pre-existing worktree diffs before this dispatch and were not edited by this turn. |
| No Resend CTA work | PASS — no CTA/UI resend surface, edge function, migration, audit-column, or rollup recompute work was added. |
| No PII/secrets in artifacts | PASS — report uses ids, statuses, counts, and provider/sent/error presence booleans only. Service-role key was fetched transiently and not printed. |
| Phase separation | PARTIAL — Phase 1 code and Phase 2 state repair have separate evidence sections, but separate Git commits were not created because the main checkout was already dirty with prior ORCH-0777/0779/0781 work when this dispatch began. |

## 4. Known Residuals / Risks

| Item | Status | Required next handling |
|---|---|---|
| Fix B SMS rows | PARTIAL | Two candidate SMS rows re-terminalized after dispatcher invocation. Do not auto-loop. Tester/operator should treat this as independent Gate B evidence and decide whether it is the known Twilio external lane or a separate follow-up. |
| Operator inbox confirmation | UNVERIFIED BY CODEX | Tester/operator must confirm the revived `c1d35ae6-...` email arrived; no email body/header should be artifacted. |
| UI real-device render | UNVERIFIED BY CODEX | Tester must execute Gate A iOS/Android organizer Orders surfaces. |
| Worktree/commit discipline | PARTIAL | This work was done in main because the orchestrator prompt named main and the user dispatched takeover there. The checkout was already dirty, so commits were not made. Orchestrator should isolate/stage only scoped paths during close. |

## 5. Downstream Routing

Route to Claude `mingla-forensics` in TEST mode for SPEC §10 Gate A and Gate B, with Claude `mingla-tester` downstream routing per the 2026-05-10 reversal. Gate A can proceed from the green code/test evidence. Gate B must independently adjudicate the mixed notification outcome: email revival succeeded and no duplicates were created, while two SMS rows remain `failed_terminal`.
