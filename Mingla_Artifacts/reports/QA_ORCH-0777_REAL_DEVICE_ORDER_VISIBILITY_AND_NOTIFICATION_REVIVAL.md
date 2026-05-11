# QA ORCH-0777 — Real-Device Order Visibility and Notification Revival

Date: 2026-05-11
Owner: Claude `mingla-tester` (canonical TEST owner per 2026-05-10 reversal)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Spec review: `Mingla_Artifacts/reports/REVIEW_SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`

## Top-Line Verdict

**Gate A — Organizer Order Visibility: CONDITIONAL PASS.**
All static, schema, PostgREST-shape, and TypeScript evidence is GREEN. Real-device iOS + Android render parity (Gates A.6-A.10) requires the operator to open the leggothis brand on a real device or simulator and confirm. Tester cannot independently launch the operator's authenticated session without operator action.

**Gate B — Failed-Terminal Notification Revival: CONDITIONAL PASS for the operator-targeted gate; PARTIAL on the wider candidate set.**
The operator's free-checkout `c1d35ae6-…` email AND SMS rows both reached `status='sent'` with `provider` and `sent_at` populated, no duplicates, no migrations applied, dispatcher ACTIVE v11 unchanged. Two non-operator SMS rows for `869bee74-…` and `e8958375-…` re-terminalized after dispatcher invocation; the SPEC's SC-B2 language treats Twilio carrier-config terminal outcomes as outside Fix B scope, but the verbal expectation "every candidate row reaches sent at dispatch time" is not met for those two rows. Operator must accept the wider-set residual or it routes back as bounded follow-up.

**ORCH-0777 dual-CLOSE gate (§3.3 / §10):** Gates A and B are independently adjudicated; verdicts are NOT collapsed. CLOSE is permissible only after the operator (i) executes the real-device Gate A.6-A.10 surface walk on iOS + Android, (ii) confirms receipt of the revived `c1d35ae6-…` email, (iii) explicitly accepts (or rejects) the two re-terminalized non-operator SMS rows as the known Twilio toll-free / Messaging Service config gap.

| Severity | Count | Notes |
|---|---:|---|
| P0 — CRITICAL | 0 | None — Fix A code change is mechanical and proven against live schema; Fix B operator-facing rows (`c1d35ae6-…`) reached `sent`. |
| P1 — HIGH | 0 | None blocking Gate A or operator-facing Gate B. |
| P2 — MEDIUM | 2 | Wider-set SMS re-terminalization on two non-operator orders (P2-1); worktree-discipline carryover diffs to dispatcher / classifier files (P2-2). |
| P3 — LOW | 1 | `orders.notification_status` rollup on `869bee74-…` reads `partial` and on `e8958375-…` reads `failed`; spec explicitly defers rollup recompute to a follow-up ORCH (P3-1). |
| P4 — NOTE | 2 | Honest error empty state on `/event/[id]/orders` is a clean addition; strict-grep G-A1..G-A4 + Jest migration-guards lock the regression class. |

---

## Inputs Read

- `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/reports/REVIEW_SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`
- `mingla-business/src/services/eventOrdersService.ts`
- `mingla-business/app/event/[id]/orders/index.tsx`
- `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`
- `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`
- `.github/workflows/strict-grep-mingla-business.yml`
- `supabase/functions/_shared/ticketCheckout.ts` (READ-ONLY — diff inspection only)
- `supabase/functions/ticket-confirmation-dispatch/index.ts` (READ-ONLY — diff inspection only)

Live, read-only Management-API SQL probes against project `gqnoajqerqhnvulmnyvv`:
- `information_schema.columns` for `public.orders.brand_id` (proves schema absence).
- `public.events` for `b1ab659e-358d-41f3-a56d-76f7b273bddd` (proves embed source).
- `public.orders JOIN public.events` for both leggothis events (proves post-fix shape returns rows).
- `public.ticket_order_notifications` filtered to the 2026-05-11 02:55-03:10 UTC dead window (proves revival ledger state).
- `public.orders LEFT JOIN public.tickets / order_line_items / ticket_order_notifications` for the three affected orders (proves no duplicates).
- `supabase_migrations.schema_migrations` for ORCH-0777 migration tail.
- Edge functions list for ACTIVE versions.

Hard guards honored: no `supabase db push`, no edge function deploy, no provider mutation, no PII or secret reproduction (no buyer email, phone, recipient values, raw provider message ids, raw email body, or raw error body). Stable opaque IDs reused from existing ORCH-0777 artifacts only.

---

## Gate A — Organizer Order Visibility

| # | Gate | Verdict | Evidence |
|---|---|---|---|
| Gate A.1 | `npx jest src/services/__tests__/ticketCheckoutMigrationGuards.test.ts --runInBand` from `mingla-business/`. | **PASS** | `Test Suites: 1 passed, 1 total`. `Tests: 11 passed, 11 total`. The new `describe("ORCH-0777 organizer order visibility repair", …)` block contributes the 3 expected assertions (no-`brand_id`-in-select, no-`brand_id`-on-OrderRow, embed-+-mapper present) and all pass. Pre-existing 8 ORCH-0777 migration-guard assertions remain GREEN. |
| Gate A.2 | `node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` from repo root. | **PASS** | stdout: `ORCH-0777 production checkout guard passed.` Exit code 0. The four organizer-visibility assertions (G-A1..G-A4) are present at lines 187-206 of the script and pass. |
| Gate A.3 | Workflow registry inspection of `.github/workflows/strict-grep-mingla-business.yml` for an ORCH-0777 job entry. | **PASS** | Job `orch-0777-ticket-checkout-production` registered at lines 329-338 of the workflow YAML, runs `node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`. Documented in the registry header comment (line 42). One job, one script — registry pattern honored, no parallel workflow file created. |
| Gate A.4 | Live read of `events.brand_id` for `b1ab659e-358d-41f3-a56d-76f7b273bddd`. | **PASS** | Returned `[{"id":"b1ab659e-358d-41f3-a56d-76f7b273bddd","brand_id":"22a18413-bfbf-4087-9ba7-45f70deba0f3"}]` — single row with the expected brand. Embed source is valid. Independent confirmation that `orders.brand_id` truly does not exist on production: `information_schema.columns WHERE table_name='orders' AND column_name='brand_id'` returned `[]`. |
| Gate A.5 | Equivalent post-fix shape executed against production for both leggothis events. | **PASS** | Event `b1ab659e-…` ("A life in vegas"): 8 rows returned, every row carries `brand_id=22a18413-bfbf-4087-9ba7-45f70deba0f3`. Event `a3f71d85-…` ("The party block"): 3 rows returned (live count > the 2-row floor in SC-A3). Every row resolves the `events!inner(brand_id)` embed. |
| Gate A.6 | iOS Simulator (or operator real device): leggothis → "A life in vegas" → Orders, expect ≥ 8 rows. | **BLOCKED — needs operator action** | Tester cannot independently authenticate as the operator (`b17e3e15-…`) to render the React Query result on a real device, and no headless mobile-render harness exists for this surface. The operator's Gate A.5 result (8 rows for `b1ab659e-…`) is the binding underlying truth — once the device fetches with the operator's session, the React Query path is identical to the SQL path. **Operator action required:** open the installed mingla-business build, leggothis brand → "A life in vegas" → Orders, and confirm ≥ 8 OrderListCard rows render newest-first (no "No orders yet" empty state). |
| Gate A.7 | Tap order `c1d35ae6-…` → expect Order detail render with buyer name, $0.00, "Free", and the issued ticket QR. | **BLOCKED — needs operator action** | Same as A.6. Underlying ticket exists (`e7a4ef8b-7074-49f9-ae1b-efcf871e8dc2`, `status='valid'`, `qr_code` populated per investigation). **Operator action required:** tap and confirm. |
| Gate A.8 | Same event: Revenue card, Sold-count badge, Guest list, Activity feed all show non-zero values. | **BLOCKED — needs operator action** | Underlying truth: 8 rows × 1 line item × $0.00 each. Revenue = $0; Sold count = 8; Guest list ≥ 8; Activity ≥ 8 purchase entries. All hooks (`useEventOrderRevenue`, `useEventSoldCounts`, `getEventGuestList`, `useEventOrderActivity`) derive from the same `OrderRecord[]` and benefit transitively per spec §A.7. **Operator action required:** confirm visually. |
| Gate A.9 | Repeat A.6 + A.8 for "The party block" (`a3f71d85-…`): ≥ 2 rows, ≥ $50 revenue, ≥ 1 sold, ≥ 1 guest, ≥ 1 activity. | **BLOCKED — needs operator action** | Underlying truth: 3 paid orders × $50 each = $150 revenue, 3 sold tickets, 3 guests, 3 purchase activity entries. Spec floors are ≥ 2 / ≥ $50 / ≥ 1 / ≥ 1 / ≥ 1 — all clear. **Operator action required:** confirm visually. |
| Gate A.10 | Android Emulator: repeat A.6 and A.9 for platform parity. | **BLOCKED — needs operator action** | Same code path as iOS; no mobile harness available to the tester. **Operator action required:** open the Android build (or run an Android emulator with the mingla-business client) and confirm parity. |
| Gate A — supplemental | TypeScript compile check on the implementor branch (`npx tsc --noEmit` from `mingla-business/`). | **PASS** | Exit code 0. The new `OrderRow.events: { brand_id: string \| null } \| null` type and the `order.events?.brand_id ?? ""` mapper compile against the rest of the surface. |

### Gate A — Findings

**P4-A1 (NOTE) — Honest error empty state is a clean addition.** `mingla-business/app/event/[id]/orders/index.tsx:179-206` introduces a dedicated `ordersQuery.isError` branch with `EmptyState illustration="ticket" title="Couldn't load orders"` before the loading or "No orders yet" branches fire. The spec required this only on the Orders list (§A.4 narrow blast radius); other surfaces (Order detail, Revenue, Guest list, Activity) inherit the resolution because Fix A makes the SELECT actually return rows. Pattern matches the existing chrome-row + empty-host wrappers used elsewhere in the file.

**P4-A2 (NOTE) — Strict-grep G-A1..G-A4 + Jest migration-guards form a tight regression cage.** Static gate locks the regex shape of `eventOrdersService.ts` against future drift; Jest gate validates the same shape inside a suite the live-fire matrix already runs. Future contributors cannot accidentally re-add `orders.brand_id` to the SELECT or remove the `events!inner(brand_id)` embed without a CI failure.

### Gate A — Verdict

**CONDITIONAL PASS.** Static + schema + PostgREST + TypeScript evidence is GREEN. Mobile UI render gates (A.6-A.10) are blocked on operator real-device confirmation. CLOSE-permitting only after operator confirms iOS + Android render of the leggothis Orders surfaces.

---

## Gate B — Failed-Terminal Notification Revival

| # | Gate | Verdict | Evidence |
|---|---|---|---|
| Gate B.1 | Implementation report's Phase 2 evidence section. | **PASS** | Report contains: candidate-set table (5 rows, IDs + status + counts only, no PII); revival-update table (5 rows post-update, all `failed_retryable` with `attempt_count=0`); dispatcher per-order outcomes table (3 orders); post-run ledger state table (5 rows, IDs + final_status + provider/sent/error presence booleans); no-duplicate counts table (3 orders, all counts = 1). No buyer email, phone, recipient, last_error body, or provider_message_id reproduced. |
| Gate B.2 | Independent re-issue of step-4 ledger state read. | **PASS for operator order; PARTIAL on wider set** | Re-read of `ticket_order_notifications` rows in the 02:55-03:10 UTC window (privacy-safe IDs/statuses/booleans only): operator order `c1d35ae6-…` email row `f8ff384c-…` is `sent` with provider+sent_at populated; operator SMS row `43a586dd-…` is `sent` with provider+sent_at populated; non-operator email `bec9b34b-…` (order `869bee74-…`) is `sent`; non-operator email `8ee6b933-…` (order `e8958375-…`) is `sent` (was already sent at 03:09:36 per investigation, not in candidate set); non-operator SMS rows `d33ca033-…` and `a739efc0-…` remain `failed_terminal`. Email channel: 100% PASS. SMS channel: 1/3 reached `sent`, 2/3 re-terminalized. |
| Gate B.3 | Re-issue step-5 no-duplicates read for each affected `order_id`. | **PASS** | Per-order counts (privacy-safe, no PII): `869bee74-…` = 1 line item / 1 ticket / 1 valid ticket / 1 email row / 1 sms row, payment_status=`paid`, rollup=`partial`. `c1d35ae6-…` = 1/1/1/1/1, payment_status=`paid`, rollup=`sent`. `e8958375-…` = 1/1/1/1/1, payment_status=`paid`, rollup=`failed`. No duplicate orders, line items, tickets, or notification rows. |
| Gate B.4 | Operator confirms receipt of revived `c1d35ae6-…` email (`tickets@usemingla.com` → operator inbox). | **BLOCKED — needs operator action** | Mingla-side ledger evidence is unambiguous: row `f8ff384c-…` has `status='sent'`, `provider` populated (Resend), `sent_at` populated, no `last_error`. Tester cannot read the operator's mailbox. **Operator action required:** confirm in the Gmail inbox (or wherever the email lands; likely "All Mail" or Promotions if previously filtered). Privacy-safe attestation only — do not reproduce subject, body, or headers. Format: "operator confirmed receipt at <UTC time>". |
| Gate B.5 | `ticket-confirmation-dispatch` ACTIVE version + dispatcher / classifier source unchanged from `main`. | **CONDITIONAL PASS** | Edge functions list confirms `ticket-confirmation-dispatch` ACTIVE **v11** (unchanged from investigation/implementation report claims). No deploy occurred during this dispatch. **Caveat:** `git status` shows working-tree modifications to `supabase/functions/_shared/ticketCheckout.ts` (+92 lines), `supabase/functions/ticket-confirmation-dispatch/index.ts` (+25 lines), and `supabase/functions/ticket-checkout-create/index.ts` (+67 lines). The diffs are pre-existing carryover from prior ORCH-0777 dispatches (the deployed v11 already contains these changes per investigation timeline 02:51 UTC); the implementor's hard-guard self-attestation explicitly notes "those files already had pre-existing worktree diffs before this dispatch and were not edited by this turn" (§3 of implementation report). The Phase-2 spec rule "no source edit to `ticket-confirmation-dispatch` or `_shared/ticketCheckout`" is honored at the dispatch boundary; orchestrator should fold these carryover diffs into a separate worktree-discipline cleanup at CLOSE (P2-2 below). |
| Gate B.6 | No production migration applied as part of Fix B. | **PASS** | `supabase_migrations.schema_migrations` tail (post `20260515000000`): `…000000` through `…000017` only. No `…000018+` entry attributed to this spec. Implementation report claimed the same; independent re-read confirms. |
| Gate B.7 | Follow-up ORCH for the deferred organizer "Resend ticket" CTA per §B.3. | **DEFERRED — orchestrator owns post-CLOSE** | Spec language: "Process gate; tester confirms entry exists, orchestrator owns its content." Tester confirms the spec mandates this filing at CLOSE-time §14 ("File a follow-up ORCH for the organizer 'Resend ticket' CTA per the §B.3 contract sketch, including the rollup recompute fix"). Codex `orchestrator-mingla` owns this entry's creation in `Mingla_Artifacts/PRIORITY_BOARD.md` / `AGENT_HANDOFFS.md` at CLOSE — not a Gate B fail. |

### Gate B — Findings

**P2-B1 (MEDIUM) — Two non-operator SMS rows re-terminalized after dispatcher invocation.** Rows `d33ca033-…` (`869bee74-…` sms) and `a739efc0-…` (`e8958375-…` sms) were flipped from `failed_terminal` → `failed_retryable` by the implementor's revival UPDATE, then re-terminalized when the dispatcher re-attempted them. The implementation report classifies these as "the known Twilio external lane" gap. Spec SC-B2 language gives both readings:
- Permissive: "SMS-channel rows MAY remain in a provider-callback chain (`sent` → `queued` → `undelivered ErrorCode 30032` per the live-fire matrix's toll-free verification in flight) — that is the carrier-verification gap already tracked outside ORCH-0777, not a Fix B regression."
- Strict: "The Fix B gate is 'Mingla-side ledger row reached `sent` at dispatch time,' which is what the operator can act on."

For these two rows, the Mingla-side ledger row did NOT reach `sent` at dispatch time — the dispatcher classified the Twilio response as terminal again. The honest reading: this is the same Twilio Messaging Service / toll-free verification gap that produced the original terminalization, not a code-side Fix B regression. **Recommended treatment:** operator explicitly accepts this as the known Twilio config gap (already tracked in `LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`) and the orchestrator records the acceptance in CLOSE notes; if the operator instead wants to re-attempt those two SMS rows after a Twilio sender re-attach, that is a separate operator-authorized one-shot, not a Fix B rework.
- *Fix direction if treated as in-scope:* operator confirms the leggothis brand's Twilio Messaging Service has a verified toll-free sender attached, then re-runs the B.1 step-2 UPDATE + step-3 dispatcher invoke for the two affected rows. No code change. Privacy-safe per the spec runbook.

**P2-B2 (MEDIUM) — Worktree-discipline carryover diffs to dispatcher / classifier files.** Files `supabase/functions/_shared/ticketCheckout.ts`, `supabase/functions/ticket-confirmation-dispatch/index.ts`, and `supabase/functions/ticket-checkout-create/index.ts` have working-tree diffs against `HEAD` (`ca69de38 "Clean tree"`) that were already deployed as ACTIVE v11 / v12 / v11 by prior ORCH-0777 dispatches. They are not Fix B work. The implementor's hard-guard self-attestation flags this in §3 ("PARTIAL — Phase 1 code and Phase 2 state repair have separate evidence sections, but separate Git commits were not created because the main checkout was already dirty with prior ORCH-0777/0779/0781 work when this dispatch began").
- *Fix direction:* orchestrator scopes the CLOSE commit to ORCH-0777 Fix-A files only (`mingla-business/src/services/eventOrdersService.ts`, `mingla-business/app/event/[id]/orders/index.tsx`, `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`, `.github/workflows/strict-grep-mingla-business.yml`, `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`), and folds the carryover dispatcher / classifier / checkout-create diffs into a separate ORCH-0779 / ORCH-0781 follow-up commit. Not a Fix B regression; not a CLOSE blocker for ORCH-0777 itself; flagged so the orchestrator can keep the worktree audit-trail honest.

**P3-B1 (LOW) — `orders.notification_status` rollup is partly stale on non-operator rows.** Rollup for `869bee74-…` = `partial` (correct; email sent, sms terminal). Rollup for `c1d35ae6-…` = `sent` (correct; both channels sent). Rollup for `e8958375-…` = `failed` (correct; this order's email is sent and sms is terminal — but the rollup says `failed`, not `partial`). The investigation flagged this rollup-recompute defect (§"HIDDEN FLAW — `orders.notification_status` rollup can lie") and the spec explicitly defers the fix to a follow-up ORCH. Spec review §"Tester interpretation note" reiterates: "child rows in `ticket_order_notifications` are authoritative. The implementor and tester should not turn a stale parent rollup into a false failure." Treating this as P3 informational; not a Gate B fail.

### Gate B — Verdict

**CONDITIONAL PASS.** Operator-targeted evidence (the `c1d35ae6-…` "A life in vegas" free-checkout email AND SMS revival, no duplicates, no migration, no edge function deploy, ACTIVE v11 unchanged) is GREEN. Wider-set evidence (two non-operator SMS rows re-terminalized) requires operator acceptance of the known Twilio toll-free / Messaging Service config gap, OR a separate operator-authorized one-shot revival after Twilio sender re-attach. Operator email-receipt confirmation (Gate B.4) is also pending operator action.

---

## Independent Verification Trail (re-runnable)

The probes below can be re-run by any operator or orchestrator with the Supabase Management API token; all are read-only and PII-free.

### Schema verification (Gate A.4)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'brand_id';
-- Expected: 0 rows (column does not exist).

SELECT id, brand_id FROM public.events
WHERE id = 'b1ab659e-358d-41f3-a56d-76f7b273bddd';
-- Expected: 1 row, brand_id = '22a18413-bfbf-4087-9ba7-45f70deba0f3'.
```

### Post-fix PostgREST shape equivalent (Gate A.5)

```sql
SELECT o.id, o.event_id, o.payment_method, o.payment_status, o.total_cents, e.brand_id
FROM public.orders o JOIN public.events e ON e.id = o.event_id
WHERE o.event_id IN (
  'b1ab659e-358d-41f3-a56d-76f7b273bddd',
  'a3f71d85-33a5-4149-be8c-a1c1e33b3f7e'
)
ORDER BY o.event_id, o.created_at DESC;
-- Expected: 8 rows for b1ab659e-…, ≥ 2 rows for a3f71d85-…, every row carries the leggothis brand_id.
```

### Post-revival ledger state (Gate B.2)

```sql
SELECT id, order_id, channel, status, attempt_count,
       (provider IS NOT NULL) AS provider_present,
       (sent_at IS NOT NULL) AS sent_at_present,
       (last_error IS NOT NULL) AS last_error_present,
       created_at, updated_at
FROM public.ticket_order_notifications
WHERE created_at >= '2026-05-11 02:55:00+00'
  AND created_at <  '2026-05-11 03:10:00+00'
ORDER BY created_at ASC, channel ASC;
-- Operator c1d35ae6-… email row f8ff384c-…: status='sent', provider_present=true.
-- Operator c1d35ae6-… sms row 43a586dd-…:  status='sent', provider_present=true.
-- Non-operator 869bee74-… sms row d33ca033-…: status='failed_terminal' (Twilio config — see P2-B1).
-- Non-operator e8958375-… sms row a739efc0-…: status='failed_terminal' (Twilio config — see P2-B1).
```

### Per-order no-duplicates (Gate B.3)

```sql
SELECT o.id AS order_id, o.payment_status, o.notification_status AS rollup_status,
       COUNT(DISTINCT oli.id) AS line_item_count,
       COUNT(DISTINCT t.id)   AS ticket_count,
       COUNT(DISTINCT t.id) FILTER (WHERE t.status='valid') AS valid_ticket_count,
       COUNT(DISTINCT n.id) FILTER (WHERE n.channel='email') AS email_notification_count,
       COUNT(DISTINCT n.id) FILTER (WHERE n.channel='sms')   AS sms_notification_count
FROM public.orders o
LEFT JOIN public.order_line_items oli ON oli.order_id = o.id
LEFT JOIN public.tickets t            ON t.order_id   = o.id
LEFT JOIN public.ticket_order_notifications n ON n.order_id = o.id
WHERE o.id IN (
  '869bee74-0025-4dde-9d68-1e22187017bb',
  'c1d35ae6-49dc-4bfc-9586-1b22f6f93fca',
  'e8958375-d3c6-411f-a678-d6a236728608'
)
GROUP BY o.id, o.payment_status, o.notification_status
ORDER BY o.id;
-- Expected: every count = 1 for all three rows.
```

### Migration tail (Gate B.6)

```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version >= '20260515000000' ORDER BY version;
-- Expected tail: 20260515000000 → 20260515000017. No 20260515000018+.
```

### Edge function ACTIVE versions (Gate B.5)

```bash
curl -s "https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/functions" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" | \
  jq '.[] | select(.slug | test("ticket-confirmation|ticket-checkout|stripe-webhook|scan-ticket")) | {slug, version, status}'
# Expected: ticket-confirmation-dispatch v11 ACTIVE; ticket-checkout-create v12 ACTIVE;
# stripe-webhook v16 ACTIVE; ticket-checkout-status v11 ACTIVE; scan-ticket v11 ACTIVE.
```

### Local CI gates (Gate A.1, A.2)

```bash
cd mingla-business && npx jest src/services/__tests__/ticketCheckoutMigrationGuards.test.ts --runInBand
# Expected: 11 passed / 11 total, including 3 new "ORCH-0777 organizer order visibility repair" tests.

cd .. && /opt/homebrew/bin/node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs
# Expected: stdout "ORCH-0777 production checkout guard passed."; exit 0.

cd mingla-business && npx tsc --noEmit
# Expected: exit 0, no output.
```

---

## Hard-Guard Compliance Self-Attestation

| Guard | Result |
|---|---|
| No `supabase db push` issued by tester | PASS — tester only issued read-only Management API SQL probes. |
| No edge function deploy issued by tester | PASS — read-only `GET /v1/projects/.../functions`. |
| No provider mutation | PASS — no Resend / Twilio / Stripe / OneSignal / Mixpanel call from tester. |
| No new migration | PASS — schema_migrations tail confirmed unchanged. |
| No PII / secrets in this report | PASS — no buyer email, phone, recipient, full provider message id, full last_error body, raw email body, raw QR payload, buyer status token, QR pepper, or service-role key reproduced. Only opaque IDs (already cited in prior ORCH-0777 artifacts), statuses, counts, and presence booleans. |
| No source edit by tester | PASS — tester read 5 product files for static evidence and emitted 0 edits to product code. Only this QA report file is written. |
| Gate A and Gate B independently adjudicated | PASS — separate verdicts (CONDITIONAL PASS each), separate evidence sections, no collapse. |

---

## Routing After This Report

Because the verdict is dual CONDITIONAL PASS, routing depends on whether the operator accepts the explicit residuals:

- **Path 1 — Operator confirms Gate A.6-A.10 real-device renders (iOS + Android), confirms Gate B.4 email receipt, AND explicitly accepts the two re-terminalized non-operator SMS rows as the known Twilio toll-free / Messaging Service config gap:** route to Codex `orchestrator-mingla` for CLOSE with all three operator confirmations recorded in CLOSE notes; orchestrator files the deferred Resend-CTA + rollup-recompute follow-up ORCH (Gate B.7); orchestrator scopes the CLOSE commit to Fix-A files only and folds the dispatcher / classifier / checkout-create carryover diffs into a separate ORCH-0779 / ORCH-0781 follow-up (P2-B2).

- **Path 2 — Operator does NOT accept the two re-terminalized SMS rows:** route to Codex `implementor-mingla` for a bounded follow-up — no code change, run the B.1 step-2 UPDATE + step-3 dispatcher invoke ONCE on those two rows after the operator re-attaches the Twilio Messaging Service sender. Output a small follow-up implementation report; tester re-runs Gate B.2 only on those two rows; on `sent`, route Path 1.

- **Path 3 — Operator confirms Fix-A renders fail in iOS or Android (any of A.6-A.10):** route to Codex `implementor-mingla` for REWORK with the failing gate cited; tester re-runs Gate A.6-A.10 only on the affected platform.

ORCH-0777 cannot CLOSE on Path 3 OR on a refusal of P2-B1 acceptance.

---

## Discoveries for Orchestrator (informational, not gates)

- **Live count for "The party block" has grown from 2 to 3** between investigation (2026-05-11 early UTC) and this QA pass. Latest order is `ca651e1a-…` (paid, $50, online_card). No effect on Gate A.5 floor (≥ 2).

- **The rollup recompute fix** (`ticket-confirmation-dispatch/index.ts:181-184`) is now provably needed: `e8958375-…` rollup reads `failed` even though that order's email row is `sent`. The follow-up Resend-CTA ORCH (§B.3) should land the rollup recompute change in the same cycle.

- **The strict-grep registry pattern is healthy** post-Cycle-17b: the ORCH-0777 job entry slots cleanly into the existing `strict-grep-mingla-business.yml` registry without spawning a parallel workflow file. Recommend extending the same pattern to other production-table client SELECTs (`from("events")`, `from("tickets")`, `from("ticket_types")`) per spec §11 fourth row — file as a META-ORCH process item.

- **Investigation timeline rounding correction:** the dead-window candidate set is 5 rows after Phase 2, not the "approximately 7-8" the investigation projected. The two never-counted rows (`16c6339e-…`, `f3393adc-…`, `2c25c503-…` enumerated in investigation) are NOT in the 02:55-03:10 dead window per the live read; their notification rows fall outside that window or were already non-terminal when Phase 2 ran. Implementation report's note "Live candidate count was 5 rows" matches the live re-read.

- **Worktree discipline:** the implementor explicitly flagged the dirty main checkout (§4 of implementation report). Recommend the orchestrator's CLOSE step include a worktree-isolation pass — scope the ORCH-0777 commit to the five Fix-A files only; commit the dispatcher / classifier / checkout-create carryover diffs under separate ORCH-0779 / ORCH-0781 commits.

---

## Confidence

- **Gate A static + schema + PostgREST evidence:** **HIGH.** Schema absence proven; embed source proven; live shape proven for both events; jest + strict-grep + tsc all green.
- **Gate A real-device parity (A.6-A.10):** **N/A — pending operator confirmation.** Tester cannot independently render with operator session.
- **Gate B operator-targeted (`c1d35ae6-…`):** **HIGH.** Both channels reached `sent` at dispatch time, no duplicates, no migration, no deploy.
- **Gate B wider set (two re-terminalized SMS rows):** **MEDIUM ON FIX-B RESPONSIBILITY.** Twilio Messaging Service / toll-free config is the proximate cause per investigation timeline; spec SC-B2 language is asymmetric and the operator must explicitly accept or reject.
- **Hard-guard compliance:** **HIGH.** Read-only probes only; no edits, no deploys, no migrations, no PII.

End of QA report.
