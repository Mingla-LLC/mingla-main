# INVESTIGATION — ORCH-0787 Order Refund + Cancel Production-Grade

- **ORCH-ID:** ORCH-0787
- **Mode:** INVESTIGATE (Claude `mingla-forensics`, canonical owner per I-PROPOSED-AB)
- **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
- **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- **Date:** 2026-05-11
- **Overall verdict:** **root cause proven**, multi-layer stub map confirmed across all five truth layers
- **Overall confidence:** **High** (live SQL probed against production project `gqnoajqerqhnvulmnyvv`; latest-migration discipline applied; six-field evidence on every finding)

---

## §1 — Plain-English Summary

The Mingla Business **Orders page is a visual shell**. Filter pills for Refunded and Cancelled are wired, a Refund history ledger section renders when `order.refunds.length > 0`, a Cancelled banner section renders when `status === "cancelled"`, the order-detail status banner styles four statuses, and the JSX has Refund order / Refund again / Cancel order buttons — but for online card / Apple Pay / Google Pay orders **nothing behind the surface actually moves money or voids a ticket**.

The break is not in one place. It is in nine independent layers all stubbed during Cycle 9c with a documented "wires when B-cycle adds real Stripe" comment, then bypassed by ORCH-0777 (Stripe Connect went live without wiring the refund path, explicitly per its own spec §60). The stub today:

1. **UI gate:** four `show*` flag variables hardcoded to `false` (order detail page lines 277-281). The buttons never render.
2. **Stubbed onPress:** even if the flags flipped true, the handlers (lines 430-475) only show "coming soon" toasts.
3. **Stubbed RefundSheet:** a fully-built 678-line `RefundSheet.tsx` exists with per-line stepper + reason + permission gate, but it is **not imported by the order detail page** and its `handleConfirm` writes only to Zustand (`useOrderStore.recordRefund`) — no Stripe call, no DB write, no buyer email.
4. **Stubbed CancelOrderDialog:** similarly built and similarly Zustand-only.
5. **Stubbed adapter:** `fetchEventOrders` hardcodes `refunds: []`, `refundedQuantity: 0`, `refundedAmountGbp: 0`, and derives `status='cancelled'` from `payment_status='failed'` (wrong — `failed` means payment gateway failure, not intentional cancellation).
6. **Schema gap A:** `orders.payment_status` enum has no `'cancelled'` value (only `pending | paid | failed | refunded | partial_refund` — confirmed live).
7. **Schema gap B:** `order_line_items` has no `refunded_quantity` column. Line-level partial-refund accounting cannot persist as the spec currently presumes.
8. **Schema gap C:** `orders` has no `cancelled_at`, `cancelled_by`, `cancellation_reason`, or `refunded_amount_cents` columns. All refund/cancel state must derive from the `refunds` table + `payment_status` enum.
9. **Backend gap:** there is no `refund-order` and no `cancel-order` edge function. The Stripe webhook router handles `charge.refund.updated` but only writes an audit row for **detached** brands; it does NOT update `orders.payment_status` and does NOT write to `public.refunds`.

The `public.refunds` table itself **does** exist (baseline schema), has appropriate RLS (`biz_can_manage_payments_for_brand_for_caller`), and currently holds **zero rows in production** — confirming no refund (in-app, webhook-reconciled, or dashboard-orphan) has ever landed there.

**Production data check:** 11 paid orders, 0 refunded, 0 partial_refund, 0 failed, 0 cancelled-via-stub. The Refunded and Cancelled pills have been showing zero rows since launch — buyers and organisers have not yet stress-tested the gap, but the moment a payment fails or a refund is needed, the system breaks. Stripe Connect destination charges are live with `application_fee_amount_cents = 0` (confirmed in `ticket-checkout-create/index.ts:79`). 100% of every ticket purchase already flows through to the brand's connected account.

**What production-grade means here:** organisers tap "Refund order", a Stripe Refund is created on the platform account with `reverse_transfer: true` (destination-charge model) and optionally `refund_application_fee: true`; the `public.refunds` row is written by the same edge function; `orders.payment_status` advances to `refunded` or `partial_refund` with line-level accounting; the buyer's `tickets.status` flips to `'refunded'` or `'void'`; a transactional email is enqueued through `ticket_order_notifications`; React Query keys are invalidated; the Orders page reflects the new state. The system also stays consistent when a refund is initiated from the Stripe dashboard — the webhook handler writes the same `public.refunds` row and advances `orders.payment_status` exactly once.

---

## §2 — Phase 0 Ingestion Log

| File | Read fully? | One-line takeaway |
|---|---|---|
| `Mingla_Artifacts/prompts/FORENSICS_ORCH-0787_...md` | Yes | Authoritative dispatch; eight cross-cutting questions; read-only investigation hard-guarded. |
| `Mingla_Artifacts/WORLD_MAP.md` (ORCH-0787 + adjacent 0782/0784/0785/0786/0777/0779 rows) | Header rows | ORCH-0787 registered today; boundary excludes 0785 email branding, 0784 list summaries, 0782 resend-ticket, 0786 profile avatar, Cycle 12 door-sale refunds. |
| `Mingla_Artifacts/MASTER_BUG_LIST.md` (ORCH-0787) | Header rows | S1 missing-feature + design-debt + invariant-violation; ORCH-0777 closed Grade A but explicitly deferred refund flow. |
| `Mingla_Artifacts/PRIORITY_BOARD.md` (ORCH-0787) | Header rows | Score 90 / Investigate Now; Stripe Connect live with money moving but no return path. |
| `Mingla_Artifacts/ARTIFACT_MANIFEST.md` | Yes | Investigation reports live in `Mingla_Artifacts/reports/` with filename `INVESTIGATION_ORCH-XXXX_*.md`. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md` | Targeted (grep + adjacent context lines) | ORCH-0777 §60: "No Stripe webhook, PaymentIntent, scanner, B2 ticket-credential RLS, QR pepper, Connect onboarding, application-fee, or refund-flow changes." Refund flow is the deferred B-cycle work. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md` | Existence confirmed | 337 lines; references `RefundSheet.tsx:145` as `order.brandId` consumer (already wired for gating, not yet wired for actual refunds). |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Targeted grep | I-19 (immutable order financials), I-PROPOSED-AG (order brand from event embed), I-PROPOSED-H (RLS-RETURNING-OWNER-GAP-PREVENTED), I-PROPOSED-I (MUTATION-ROWCOUNT-VERIFIED), I-PROPOSED-J (Zustand persist no server snapshots), I-PROPOSED-P (stripe_connect_accounts canonical), I-PROPOSED-Q (Stripe API version via shared client only) — all relevant. |
| `Mingla_Artifacts/DECISION_LOG.md` | Targeted grep | DEC-119/120/121 (I-PROPOSED-J activation), DEC-110 (stub-brand), DEC-125/126/128 (docs lock-in) — no prior decision found that fixes refund authority, application-fee policy, or paid-cancellation semantics; those are open SPEC-phase questions per §7. |
| `memory/feedback_rls_returning_owner_gap.md` (4 days old, verified current) | Yes | RLS-RETURNING-OWNER-GAP applies: every owner-callable mutation policy paired with helper-only SELECT will fail under `.insert().select()` chains. Direct-predicate SELECT required, or write the refund via SECURITY DEFINER RPC / edge function service role. |
| `memory/feedback_zustand_persist_no_server_snapshots.md` (4 days old, verified current) | Yes | `RefundRecord[]`, `cancelledAt`, `refundedAmountGbp`, `lines[].refundedQuantity` on `OrderRecord` are server-derived once the backend lands; they MUST NOT be persisted by `orderStore.partialize`. Today they ARE persisted (see §3.3 Code Finding C-04). |
| `memory/feedback_headless_qa_rpc_gap.md` | Yes | Any new SECURITY DEFINER RPC introduced (e.g. `biz_refund_order`) MUST be live-fire-tested through the real edge function / mobile caller before CLOSE; raw-SQL probes are insufficient. Applies directly to ORCH-0787 implementor + tester phases. |

**Gaps:** No prior INVESTIGATION report on online refunds exists in `Mingla_Artifacts/reports/` (verified by `ls` filter for refund/cancel — only the Stripe orphaned-refund section evidence appears, not an investigation). Cycle 9c spec referenced in code comments was not located in `Mingla_Artifacts/specs/` under that name; the surviving authoritative artifacts for Cycle 9c are the inline JSDoc headers on `RefundSheet.tsx`, `CancelOrderDialog.tsx`, and `orderStore.ts`. This is a documentation drift that does not block the investigation (the code is the current authority) but should be flagged for SPEC §2 to either locate or recreate.

---

## §3 — Five-Truth-Layer Findings

Format per row: **(a) statement** — **(b) evidence** — **(c) layer** — **(d) invariant/rule ref** — **(e) confidence H/M/L** — **(f) what would raise confidence**.

### §3.1 Docs Layer

**D-01 (🔴 Root Cause — Docs)** — Cycle 9c shipped the refund + cancel UI explicitly as a stub with a published "wires when B-cycle adds real Stripe" exit condition. — `mingla-business/src/components/orders/RefundSheet.tsx:16-17` (verbatim: `NO Stripe-fee-retained line in stub mode (Const #9; D-9c-4 — would fabricate fee data). Wires when B-cycle adds real Stripe.`) and `mingla-business/src/store/orderStore.ts:27-32` (verbatim: `[TRANSITIONAL] Zustand persist holds orders client-side. B-cycle migrates to Supabase orders + order_line_items per PR #59 §B.4.`). — **Docs** — I-19 + Const #9 (no fabricated data). — **H**. — Locate the original Cycle 9c spec file in `Mingla_Artifacts/archive/` to confirm D-9c-4 was an explicit non-goal (not strictly required — code header is binding TRANSITIONAL label).

**D-02 (🟠 Contributing — Docs)** — ORCH-0777 explicitly EXCLUDED the refund flow from its scope despite shipping Stripe Connect destination charges live to production. — `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md:60` (verbatim: `No Stripe webhook, PaymentIntent, scanner, B2 ticket-credential RLS, QR pepper, Connect onboarding, application-fee, or refund-flow changes. Those surfaces are intact per the prior spec and live-fire matrix.`) — **Docs** — none. — **H**. — Already confirmed.

**D-03 (🔵 Observation — Docs)** — `mingla-business/src/components/orders/RefundSheet.tsx:2-19` JSDoc names two spec sections (`§3.4.3 J-M3 full refund + J-M4 partial refund`) that exist in code but cannot be cross-referenced to a discoverable Cycle 9c spec file. — Phase 0 ingestion grep returned zero results for `SPEC_CYCLE_9C*` or `SPEC_ORCH_07[0-4]*_REFUND*` in `Mingla_Artifacts/specs/` or `Mingla_Artifacts/archive/` — **Docs** — none. — **M**. — Locate the spec file by searching `Mingla_Artifacts/archive/superseded_specs/` and the `Mingla_Artifacts/github/` historical project planning source named in ART-DIR-GITHUB. The implementor cannot re-derive Cycle 9c verbatim without it; SPEC phase must re-write from current code + this investigation.

---

### §3.2 Schema Layer

**S-01 (🔴 Root Cause — Schema)** — `orders.payment_status` CHECK constraint admits five values; `'cancelled'` is not one of them. — Live probe (Management API, 2026-05-11): `CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partial_refund'::text])))`. Migration chain: only `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:8544` defines this CHECK; ORCH-0777 migration `20260515000013_orch_0777_ticket_checkout_core.sql` adds columns but does not alter the CHECK; no later migration alters it. — **Schema** — directly contradicts current adapter logic at `mingla-business/src/services/eventOrdersService.ts:45-50` which maps `'failed' → 'cancelled'`. — **H**. — Already proven live.

**S-02 (🔴 Root Cause — Schema)** — `order_line_items` has no `refunded_quantity` or `refunded_amount_cents` column. Production schema columns are exactly: `id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents`. — Live probe: `information_schema.columns` for `public.order_line_items` returned six columns; no refund accounting present. — **Schema** — directly breaks the order detail UX's per-line partial-refund tracking expectation (`OrderLineRecord.refundedQuantity` at `orderStore.ts:75-76` cannot persist server-side today). — **H**. — Already proven live.

**S-03 (🔴 Root Cause — Schema)** — `orders` has no `cancelled_at`, `cancelled_by`, `cancellation_reason`, or `refunded_amount_cents` column. — Live probe: `information_schema.columns` for `public.orders` returned 28 columns; nearest neighbours present are `failed_at` and `confirmed_at`, but no cancel-side column. — **Schema** — server cannot persist cancellation timestamp/actor/reason; `RefundRecord.reason` lives only on `public.refunds.reason` and there is no analogous cancel-side row. — **H**. — Already proven live.

**S-04 (🟢 Observation — Schema, positive)** — `public.refunds` table **already exists** with `id, order_id, stripe_refund_id, amount_cents, reason, initiated_by, status, created_at`. Status CHECK = `'pending' | 'succeeded' | 'failed' | 'cancelled'`. — Live probe: `information_schema.columns` for `public.refunds` returned eight columns; `COUNT(*) = 0` in production. Baseline `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:9231-9242`. — **Schema** — none. — **H**. — Already proven live. **Observation:** this table has NO `currency`, NO `stripe_payment_intent_id`, NO `application_fee_refunded_cents`, NO line-level join, NO `processed_at` timestamp. SPEC must decide whether to (a) add these columns or (b) use `mingla_revenue_log` for fee refunds + a sibling table for line-level refund items.

**S-05 (🟢 Observation — Schema, positive)** — `tickets.status` CHECK already supports `'refunded'` and `'void'` (in addition to `'valid' | 'used' | 'transferred'`). The ticket void contract is schema-ready. — Live probe: `CHECK ((status = ANY (ARRAY['valid'::text, 'used'::text, 'void'::text, 'transferred'::text, 'refunded'::text])))`. Production distribution today: 10 valid + 1 used; zero void/refunded/transferred. — **Schema** — none. — **H**. — Already proven live.

**S-06 (🟠 Contributing — Schema)** — `tickets` has FK to `orders.id` but no FK to `order_line_items.id`. There is no schema-level link telling us which of the N issued ticket rows corresponds to which line item. — Live probe: `tickets` columns include `order_id, ticket_type_id`; there is no `order_line_item_id`. — **Schema** — affects partial-refund-by-line semantics: when refunding 2 of 4 same-ticket-type tickets, the implementor must pick 2 of the 4 ticket rows by some deterministic policy (e.g. oldest qr_token_hash first, or any-still-valid first). SPEC must define the policy explicitly. — **H**. — Already proven live.

**S-07 (🟠 Contributing — Schema)** — `public.refunds` RLS is a single ALL-policy `Brand admin plus can manage refunds` whose USING + WITH CHECK both call `biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(order_id))`. Both helpers are SECURITY DEFINER STABLE. No direct-predicate SELECT policy exists. — Live probe `pg_policies` + `pg_get_functiondef` for `biz_can_manage_payments_for_brand_for_caller`. — **Schema + RLS** — **directly violates I-PROPOSED-H pattern signature** (`feedback_rls_returning_owner_gap.md`). Any supabase-js `.insert(...).select()` or `.update(...).select()` chain on `public.refunds` from the mobile client will fail with 42501 even when the WITH CHECK passes, because the SELECT-for-RETURNING evaluation will route through the SECURITY DEFINER helper which empirically fails under in-transaction NEW-row context (RC-0728 evidence). — **H**. — Already proven by pattern + live RLS probe. The fix path is to issue refunds from an edge function using service role (bypass RLS) OR add a direct-predicate SELECT policy to `public.refunds`. **The edge function path is strongly recommended** because Stripe API calls cannot live in supabase-js anyway.

**S-08 (🟠 Contributing — Schema)** — Same RLS-RETURNING risk applies to `public.orders` UPDATE. The SELECT policy is `biz_can_read_order_for_caller(id)` (SECURITY DEFINER helper) and the UPDATE policy is `biz_can_manage_orders_for_event_for_caller(event_id)` (same pattern). Advancing `payment_status` to `refunded` via supabase-js `.update().select()` from the mobile client is at risk for the same 42501 failure. — Live probe `pg_policies`. — **Schema + RLS** — I-PROPOSED-H. — **H**. — Same mitigation: write the status advance from a SECURITY DEFINER RPC (mirroring `biz_ticket_checkout_finalize`) or from the edge function via service role.

**S-09 (🟡 Hidden Flaw — Schema/Code Coupling)** — `BrandStripeOrphanedRefundsSection` calls `brandStripeOrphanedRefundsService.fetchBrandStripeOrphanedRefunds`, which queries `payment_webhook_events` selecting `event_id, raw_payload, created_at` and filtering on `event_type` and `account_id`. Production schema for `payment_webhook_events` has columns `id, stripe_event_id, type, payload, processed, processed_at, error, created_at, retry_count, retries_exhausted` — none of which match `event_id`, `raw_payload`, `event_type`, or `account_id`. — Live probe `information_schema.columns` for `public.payment_webhook_events`. Service code at `mingla-business/src/services/brandStripeOrphanedRefundsService.ts:48-56`. — **Schema/Code** — runtime breakage when an organiser opens BrandStripeOrphanedRefundsSection with refunds present (today this surface returns nothing because both refunds and Stripe-dashboard refunds are zero, so the bug is dormant). — **H**. — Reproducible by attempting the query; out of ORCH-0787's core scope but on the orphan-refund interplay seam. **Recommendation:** register a separate ORCH-0788 (or fold into ORCH-0787 §5 blast radius as a required side-fix) to either rename the columns in the orphan service or add a view aliasing them. SPEC phase decides.

---

### §3.3 Code Layer

**C-01 (🔴 Root Cause — Code)** — Order detail page hardcodes all four primary-action visibility flags to `false`. — `mingla-business/app/event/[id]/orders/[oid]/index.tsx:277-281` (verbatim: `const showRefundFull = false; const showRefundPartialAgain = false; const showCancelOrder = false; const showSecondaryPartialFromFull = false;`). — **Code** — Const #1 (no dead taps — actually inverted: dead buttons that don't render at all), I-19, code stale relative to Cycle 9c spec §3.4.2 derivation. — **H**. — Already verified by direct read.

**C-02 (🔴 Root Cause — Code)** — Order detail page action `onPress` handlers fire "coming soon" toasts only — they do not open `RefundSheet`, do not open `CancelOrderDialog`, and do not call any service. — `mingla-business/app/event/[id]/orders/[oid]/index.tsx:430-475` (e.g. line 434 `onPress={() => showToast("Refunds are coming soon.")}`). — **Code** — Const #3 (no silent failures — this is a "silent stub" pattern), I-19 spirit. — **H**. — Already verified.

**C-03 (🔴 Root Cause — Code)** — `eventOrdersService.fetchEventOrders` hardcodes `refundedQuantity: 0`, `refundedAmountGbp: 0`, `refundedAmount: 0`, `refunds: []`, and derives `cancelledAt` from `payment_status === "failed"`. The `statusFromPayment` mapper at lines 45-50 maps `'failed' → 'cancelled'`. — `mingla-business/src/services/eventOrdersService.ts:45-50, 110-123`. — **Code** — directly breaks the order detail page's Refund history ledger (always empty), and conflates payment-gateway failure with intentional cancellation (S-01 violation). — **H**. — Already verified.

**C-04 (🟠 Contributing — Code)** — `useOrderStore` Zustand store persists `entries: OrderRecord[]` via `partialize`. `OrderRecord` includes `refunds: RefundRecord[]`, `refundedAmountGbp: number`, `cancelledAt: string | null`, and `lines[].refundedQuantity: number` — all server-derived fields once ORCH-0787 ships. — `mingla-business/src/store/orderStore.ts:201-208` (`partialize: (s): PersistedState => ({ entries: s.entries })`). — **Code** — **DIRECTLY violates I-PROPOSED-J Zustand persist no server snapshots.** Today this is tolerated because the JSDoc header line 28 marks `useOrderStore` as `[TRANSITIONAL]` pending B-cycle backend wiring (per ORCH-0739 carve-out for the 5 transitional stores). ORCH-0787 IS the B-cycle event for orders. — **H**. — Already verified by reading the partialize block. **SPEC must specify the exit-condition for this TRANSITIONAL marker**: either contract the store to ID-only (`currentOrderId`) and read live via React Query (per I-PROPOSED-J pattern), OR document an explicit time-bounded extension. **Hard guard from the dispatch prompt:** SPEC must NOT modify `partialize` to persist refunds — it must move the source of truth to server and use the existing React Query keys `eventOrdersKeys.detail(eventId)` / `eventOrdersKeys.order(eventId, orderId)`.

**C-05 (🟠 Contributing — Code)** — `RefundSheet.tsx` exists with full UX (per-line stepper, full/partial mode, reason input 10..200 chars, permission gate `REFUND_ORDER = finance_manager rank 30`), but its `handleConfirm` calls only `useOrderStore.recordRefund` (client-side Zustand) and never calls Stripe or writes to `public.refunds`. — `mingla-business/src/components/orders/RefundSheet.tsx:170-256` (handleConfirm body) + line 16-17 (`Wires when B-cycle adds real Stripe.`). Cycle 9c gated CTA by `canPerformAction(currentRank, "REFUND_ORDER")` at line 146. — **Code** — Const #9 fabrication risk: today refunds are FAKE — they advance the Zustand store but do NOT move money. If an organiser were to flip the show-flags true and tap Refund, the buyer would see "refunded" in the app but their card would never be credited. This is worse than "coming soon" — it's actively deceptive. — **H**. — Already verified. **Critical risk gate:** SPEC must specify that the flags cannot be flipped true until the edge function wiring is complete and tested live-fire.

**C-06 (🟠 Contributing — Code)** — `CancelOrderDialog.tsx` is gated to `paymentMethod === "free"` only (per Q-9c-5 / JSDoc line 9-10). It calls `useOrderStore.cancelOrder` (client-side Zustand) + a 1.2s simulated processing delay, fires `notifyEventChanged` from the caller. No edge function. No server DB write. — `mingla-business/src/components/orders/CancelOrderDialog.tsx:1-100` (header + state + reset). — **Code** — for free orders this is closer to correct (no Stripe involvement) but still missing server DB persistence (`orders.payment_status = 'cancelled'` cannot be set because the value isn't in the enum per S-01). For paid orders, the dialog is by-design not invoked — the spec routes paid-cancellation to the refund flow. — **H**. — Already verified. **SPEC question:** is intentional cancellation of a paid order a valid distinct state from full refund? (See §4.4.)

**C-07 (🟠 Contributing — Code — Webhook Router)** — `stripeWebhookRouter.ts` routes `charge.refund.updated` to `handleRefundUpdated`, which writes a `writeAudit` row ONLY IF the connected account is detached. For attached accounts (the normal case), it returns the brandId and does nothing — no update to `orders.payment_status`, no insert into `public.refunds`, no ticket void, no notification fan-out. The router also handles `application_fee.refunded` → writes to `mingla_revenue_log`. — `supabase/functions/_shared/stripeWebhookRouter.ts:379-406` (handleRefundUpdated) + `:408-445` (handleApplicationFee) + `:550-555` (case routing). — **Code** — confirms the orphan-refund interplay gap. Dashboard-initiated refunds today are visible in raw webhook events but do not propagate to `public.refunds` or `orders.payment_status`. — **H**. — Already verified. **SPEC must extend `handleRefundUpdated` to:** look up the order by `payment_intent` or `charge_id`, insert/upsert `public.refunds` by `stripe_refund_id`, advance `orders.payment_status` to `refunded` / `partial_refund` based on accumulated refund amount, void tickets, enqueue buyer notification, and reconcile with any pre-existing in-app refund row idempotently.

**C-08 (🟠 Contributing — Code — Webhook Router)** — `STRIPE_ROUTED_EVENT_TYPES` lists `charge.refund.updated` and `application_fee.refunded` but NOT `refund.created` or `refund.updated` (the newer Stripe Refunds API events). — `supabase/functions/_shared/stripeWebhookRouter.ts:17-37`. — **Code** — Stripe's modern refund event surface uses the `refund.*` event family for refunds created via the v1 `/refunds` API; `charge.refund.updated` is the legacy charge-side event. Whether this gap matters depends on the Stripe API version (`STRIPE_API_VERSION` at `_shared/stripe.ts` — not read here). — **M**. — Confirm by reading `supabase/functions/_shared/stripe.ts` STRIPE_API_VERSION pinned value. SPEC phase should decide whether to subscribe to both event families or only the legacy charge-side family.

**C-09 (🟢 Observation — Code)** — Stripe Connect destination charge model is confirmed live. `ticket-checkout-create/index.ts:79` passes `p_application_fee_amount_cents: 0` (Mingla charges zero platform fee in production today), and `:164` passes `transfer_data: { destination: stripeAccountId }`. This is the canonical Stripe destination-charge pattern. — Direct grep on the file. — **Code** — affects refund authority per Stripe docs: destination charges are refunded on the PLATFORM account (no `Stripe-Account` header) with `reverse_transfer: true` to pull funds back from the connected account, and optionally `refund_application_fee: true` to refund the platform fee on the same call. — **H**. — Already verified. **SPEC implication:** the new `refund-order` edge function uses the platform Stripe key (NOT `Stripe-Account` header) and MUST pass `reverse_transfer: true`. When `application_fee_amount_cents > 0` in the future, it must also pass `refund_application_fee: true` (or do a separate `application_fee.refund` call) — that's a SPEC-phase fork.

**C-10 (🟢 Observation — Code)** — Permission gate for refunds is already defined and matches the DB RLS: `permissionGates.ts:20` sets `REFUND_ORDER = BRAND_ROLE_RANK.finance_manager (30)`, the DB policy on `public.refunds` calls `biz_can_manage_payments_for_brand_for_caller(...)`. — `mingla-business/src/utils/permissionGates.ts:19-25` + live RLS probe. — **Code + Schema** — none. — **H**. — Already verified.

**C-11 (🟢 Observation — Code)** — `DoorRefundSheet.tsx` is a fully-built, server-disconnected sibling that mirrors the partial-refund UX the spec phase will need: per-line stepper (lines 251-301), reason input 10..200 chars (lines 311-353), permission gate `REFUND_DOOR_SALE = finance_manager rank 30` (lines 121-123), 1.2s simulated processing → `useDoorSalesStore.recordRefund` (Zustand-only, OBS-1 hard lock prevents `useScanStore` cross-touch). — `mingla-business/src/components/door/DoorRefundSheet.tsx:1-396`. — **Code** — none (door sales are an explicitly parallel ledger per I-Cycle-12). — **H**. — Already verified. **SPEC reuse opportunity:** the online refund flow's UX should mirror this exact pattern; the difference is the back-end (online refund hits Stripe + writes to `public.refunds`; door refund stays client-side per the I-Cycle-12 separation).

---

### §3.4 Runtime Layer

**R-01 (🔴 Root Cause — Runtime)** — Today, the only visible Refund / Cancel UX in production is the filter pills + status banner styles + (when an order has `payment_status='failed'`) the bogus Cancelled banner. None of the action buttons ever render because `showRefundFull = showRefundPartialAgain = showCancelOrder = showSecondaryPartialFromFull = false`. — Code reading C-01 + production order distribution probe (11 paid, 0 failed = no bogus Cancelled in production today). — **Runtime + Data** — Const #1 partial violation (organisers expect actionable buttons; they get a static "Refund order" only inside the spec's claimed contract — currently invisible). — **H**. — Already proven by code + live data.

**R-02 (🔴 Root Cause — Runtime)** — A refund issued from the Stripe dashboard today: webhook fires → `stripe-webhook` edge function → dispatcher routes to `handleRefundUpdated` → audit row written (for detached accounts only) → no `public.refunds` insert → no `orders.payment_status` update → no ticket void → no buyer notification → the Refund history ledger on the order detail page remains empty → the organiser sees `status='paid'` while Stripe reports `'refunded'`. — Code reading C-07 + live `public.refunds` count = 0 + live `payment_webhook_events` table existence. — **Runtime + Data** — five-truth-layer divergence (Stripe = refunded; DB = paid; UI = paid; buyer = card credited but app says they still hold a valid ticket). — **H**. — Already proven by code + data probe.

**R-03 (🟠 Contributing — Runtime)** — Cache invalidation contract is documented at `useEventOrders.ts:23-37` (`eventOrdersKeys` factory). On a successful refund or cancel, the following keys must be invalidated to refresh all consumers: `eventOrdersKeys.detail(eventId)` (orders list), `eventOrdersKeys.order(eventId, orderId)` (detail), `eventOrdersKeys.soldCounts([eventId, ...])` (sold-count rollups), and `eventOrdersKeys.salesSummary(eventId, currency, ticketSignature)` (sales summary used by ORCH-0784's in-flight surface). Today, because refunds only mutate Zustand, React Query keys are NOT invalidated (Zustand has its own re-render via `useOrderStore` selectors). — `mingla-business/src/hooks/useEventOrders.ts:23-37`. — **Runtime** — none directly, but SPEC must call out invalidation explicitly. — **H**. — Already verified.

**R-04 (🟠 Contributing — Runtime)** — Buyer notification fan-out: `ticket_order_notifications` table has columns `channel, recipient, status, provider, provider_message_id, idempotency_key, attempt_count` per live probe. Today this table is populated only by `ticket-confirmation-dispatch` for purchase confirmation. There is no refund or cancellation notification template. — Live probe + grep for `ticket_order_notifications` writers. — **Runtime** — buyer is anonymous; push is not available; SMS is configured for TollFree per ORCH-0777 Twilio residual; **email is the only certain channel**. ORCH-0785 (premium email branding) is the canonical owner of the buyer email template — ORCH-0787 must enqueue a notification row, ORCH-0785 owns the rendered content. — **H**. — Already verified.

---

### §3.5 Data Layer

| Probe | Result | Interpretation |
|---|---|---|
| `orders.payment_status` CHECK constraint | `'pending' | 'paid' | 'failed' | 'refunded' | 'partial_refund'` | No `'cancelled'` value (S-01 confirmed live) |
| `orders.payment_status` distribution | 11 paid; 0 in every other state | No production data masking the stub today |
| `public.refunds` COUNT(*) | 0 | No refund has ever landed; orphan + in-app paths both inert |
| `public.refunds` columns | 8 columns; no `currency`, no `stripe_payment_intent_id`, no line-level link | SPEC must decide whether to extend the table |
| `orders` columns | 28 columns; has `stripe_payment_intent_id`, `stripe_charge_id`, `failed_at`, `confirmed_at`, `is_door_sale`, `stripe_application_fee_amount_cents`, `stripe_transfer_destination`; no `cancelled_at`, `cancelled_by`, `cancellation_reason`, `refunded_amount_cents`, `voided_at` | All cancel/refund state must derive from `payment_status` + `refunds` joins (or new columns must be added) |
| `order_line_items` columns | 6 columns; no `refunded_quantity`, no `refunded_amount_cents` | Line-level partial-refund cannot persist without new columns or new table |
| `tickets.status` CHECK | `'valid' | 'used' | 'void' | 'transferred' | 'refunded'` | Void contract is schema-ready (S-05) |
| `tickets` distribution | 10 valid + 1 used; 0 void/refunded/transferred | No production data exercises void path yet |
| `public.refunds` RLS | Single ALL-policy via SECURITY DEFINER helper; no direct-predicate SELECT | RLS-RETURNING-OWNER-GAP risk (S-07) |
| `public.orders` RLS | SELECT + UPDATE via SECURITY DEFINER helpers; no direct-predicate | RLS-RETURNING-OWNER-GAP risk on payment_status update (S-08) |
| `tickets` RLS | "Finance plus can update tickets" UPDATE policy + scanner UPDATE + buyer/brand SELECT | Refund-driven ticket void uses Finance UPDATE path |
| RPCs touching `payment_status` | Only `biz_ticket_checkout_finalize` + `biz_ticket_scan` | Tight blast radius for cancelled-vs-failed split |
| `ticket_checkout_sessions` columns | Has `stripe_account_id`, `stripe_payment_intent_id`, `stripe_application_fee_amount_cents` | Refund flow can derive connected-account info from the session row |
| `mingla_revenue_log` columns | Has `refunded_amount_cents` + `refunded` bool | Application-fee refund accounting already wired (via webhook) |
| `payment_webhook_events` columns | `id, stripe_event_id, type, payload, processed, processed_at, error, created_at, retry_count, retries_exhausted` | Brand orphan service queries non-existent columns (S-09 hidden flaw) |
| `payment_webhook_events` relkind | `r` (TABLE — not view) | S-09 cannot be explained by view aliasing |

All probes were read-only via `POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query` per `reference_supabase_management_api.md`. No mutations.

---

## §4 — Cross-Cutting Analysis (§4.1–§4.8)

### §4.1 — Authority for in-app refund (platform vs connected account)

**Answer:** Platform-issued refund on the platform Stripe key with `reverse_transfer: true`. **No `Stripe-Account` header.**

**Reasoning:** ORCH-0777 ships Stripe Connect **destination charges** — verified by `ticket-checkout-create/index.ts:164` `transfer_data: { destination: stripeAccountId }` and by `orders.stripe_transfer_destination` column existence. Per Stripe documentation for destination charges (Stripe Connect docs, "Issuing refunds"), the platform creates the charge on its own account with a `transfer_data` destination, and refunds are issued on the **platform** account (the API call goes to `https://api.stripe.com/v1/refunds` without the `Stripe-Account` header). To pull money back from the connected account's balance, the platform passes `reverse_transfer: true`. If a platform fee is in play, `refund_application_fee: true` reverses it on the same call.

**Confidence:** **H** for the model selection (live evidence of `transfer_data.destination`); **M** for the exact API call shape (would be lifted to H by reading the published Stripe destination-charge refund example, which SPEC phase will cite).

**No prior decision found in `DECISION_LOG.md`** — this is a new decision SPEC must lock in with a fresh DEC entry.

### §4.2 — Application fee on refund

**Answer:** **Decision required — fork for SPEC phase.** Today `application_fee_amount_cents = 0` in production (`ticket-checkout-create/index.ts:79`), so the proportional/fixed-fee policy is academic for the launch. The spec must still specify the contract for the day Mingla turns on a non-zero fee.

**Recommendation to the SPEC operator:** code the `refund-order` edge function to always pass `refund_application_fee: true` when `orders.stripe_application_fee_amount_cents > 0`. For partial refunds, Stripe automatically refunds the application fee proportionally to the refund amount — no additional Mingla logic required. Reconcile via the `application_fee.refunded` webhook → `mingla_revenue_log.refunded_amount_cents` (already wired per `stripeWebhookRouter.ts:408-445`).

**Confidence:** **M** — pending operator decision on whether the application fee is refundable at all.

### §4.3 — Ticket void contract

**Answer:** Use the existing `tickets.status` enum. On full refund or full cancel, advance every `tickets.status` for the order from `'valid'` → `'refunded'` (or `'void'` for cancellation — SPEC chooses one). On partial refund, advance exactly N of the order's M ticket rows for the affected `ticket_type_id`(s).

**SPEC must define the deterministic line-to-ticket selection policy** because `tickets` has no FK to `order_line_items.id` (S-06). Recommended policies (SPEC chooses one):
- (a) Lowest `tickets.created_at` first (oldest tickets refunded first).
- (b) Highest `tickets.qr_token_hash` ordinal first.
- (c) Reject the refund if any ticket for the affected line item has `status='used'` (force the organiser to choose explicit per-ticket void via a per-ticket UI — heavy spec).
- (d) Refund proportionally and update `order_line_items.refunded_quantity` (requires schema change S-02).

The scanner gate at `biz_ticket_scan` already filters on `payment_status <> 'paid'` per ORCH-0777 migration line 708 — so once `payment_status` is `refunded`, the scanner rejects the ticket even if `tickets.status` is still `'valid'`. This is a **double-gate** opportunity: SPEC must decide whether `tickets.status` advance is required (defense-in-depth) or whether `orders.payment_status` advance is sufficient (single source of truth). The defense-in-depth path is preferred — single-source has historically caused replay attacks where a row update is missed.

**Confidence:** **H** — schema and scanner gate proven; the choice is a SPEC-phase fork.

### §4.4 — Cancel for paid online orders

**Decision required — fork for SPEC phase.** Today `CancelOrderDialog` is gated to `paymentMethod === "free"` only. The question: is intentional cancellation of an unrefunded paid order a valid distinct state, or does it reduce to "full refund + void tickets"?

**Industry comparable patterns (informational, do not bind):**
- **Eventbrite:** organiser-side cancellation of a paid order issues a full refund automatically. No "cancelled but unrefunded" state exposed to organiser.
- **DICE:** similar — refund is the path for paid cancellation.
- **Universe (now Ticketmaster Universe):** allows full refund OR "mark as cancelled, no refund" with operator confirmation; rare.

**Recommendation to the SPEC operator:** for the launch, **collapse paid cancellation into the full-refund flow** to keep the surface minimal and reduce reconciliation risk. Free cancellations stay distinct (no Stripe involvement). Revisit if support requests "cancel without refund" become frequent.

**Confidence:** **M** — operator preference.

### §4.5 — Cancelled vs Failed separation

**Answer:** A new `'cancelled'` value must be added to the `orders_payment_status_check` constraint, **and every consumer that filters on `payment_status='failed'` as a proxy for cancellation must be migrated.** Live blast-radius enumeration:

| Consumer | File:line | Today | Needs change? |
|---|---|---|---|
| Adapter `statusFromPayment` | `mingla-business/src/services/eventOrdersService.ts:45-50` | `'failed' → 'cancelled'` | YES — split `'failed' → 'cancelled'` (gateway failure) from `'cancelled' → 'cancelled'` (intentional). |
| Adapter `cancelledAt` derivation | `mingla-business/src/services/eventOrdersService.ts:123` | `payment_status === "failed" ? created_at : null` | YES — when intentional cancellation lands, `cancelledAt` must derive from a new column or a query against `public.refunds`/a new ledger. |
| Currency aggregation | `supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:64` | `IN ('paid', 'refunded', 'partial_refund')` | NO — cancelled excluded from currency reconciliation by design. |
| RPC `biz_ticket_checkout_finalize` | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:481+` | Writes `payment_status` on success path; sets `'failed'` on failure path | NO — leaves `'failed'` as-is for gateway failures. |
| RPC `biz_ticket_scan` | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:657+` | Filters on `payment_status <> 'paid'` at line 708 | NO — `cancelled` already excluded by `<> 'paid'`. |

The blast radius is **tight** (one mapping file + maybe one adapter line). Both touches are in `eventOrdersService.ts`. No admin dashboard SQL uses `payment_status='failed'`. No edge function depends on the conflated mapping.

**Confidence:** **H** — blast radius mapping done.

### §4.6 — Orphan-refund interplay

**Answer:** After ORCH-0787 lands, the webhook handler will write to `public.refunds` directly for refunds attached to known orders (via `stripe_payment_intent` or `stripe_charge_id` join). `BrandStripeOrphanedRefundsSection` will continue to surface only **truly orphan** refunds — refunds whose connected account is detached, OR refunds whose payment_intent has no `public.orders` row (e.g., card-readers operating outside the platform).

**However, S-09 confirms `brandStripeOrphanedRefundsService.ts` queries columns that do not exist in `payment_webhook_events`** (`event_id`, `raw_payload`, `event_type`, `account_id` instead of `stripe_event_id`, `payload`, `type` — there is no `account_id` column at all). This service is currently dormant (zero refunds in production) but will break at runtime the moment a refund lands. **SPEC must decide whether to fold this fix into ORCH-0787 scope or register a new ORCH** (the orchestrator's hard guard in the dispatch said keep orphan-refund out unless investigation proves shared scope — it does, marginally, so SPEC should include the column rename as a required side-fix). The shared scope: ORCH-0787's webhook handler will need to query `payment_webhook_events` for idempotency reconciliation, and it must use the correct columns.

**Confidence:** **H** for the scope-overlap; **M** for the operator-side decision.

### §4.7 — Notification fan-out

**Answer:** **Email only**, via `ticket_order_notifications` (existing `channel` column already supports `'email' | 'sms'`). SMS may be added if the brand has it enabled and the buyer provided E.164 phone. Push is not applicable (anonymous buyer). The new `refund-order` edge function enqueues a row in `ticket_order_notifications` with `idempotency_key = "refund:{order_id}:{stripe_refund_id}"`. The actual email body / branding is **owned by ORCH-0785**. ORCH-0787 must:
- Define the notification row contract (channel, recipient, idempotency_key, payload jsonb fields).
- Ensure the `notify-dispatch` edge function picks up the row and routes via Resend.
- Coordinate with ORCH-0785 on the rendered HTML/text content.

**Confidence:** **H** — table contract proven; ORCH-0785 dependency cleanly bounded.

### §4.8 — Free-order cancellation

**Answer:** Same edge function path as paid cancellation, with a branch on `orders.payment_method = 'free'` (or `orders.total_cents = 0`) to **skip** the Stripe API call. The DB write side is identical: `orders.payment_status = 'cancelled'` (after S-01 fix), `tickets.status = 'void'`, `public.refunds` row optional (amount_cents = 0 might violate the `refunds_amount_positive` CHECK — SPEC should not write a row for free cancellations).

**Recommendation:** route everything through one `cancel-order` edge function with a free/paid branch internally. This keeps a single auditable path. The orchestrator's INTAKE memo mentioned the alternative (free-only client-side RPC), but the consistency argument wins.

**Confidence:** **H** — pattern matches `biz_ticket_checkout_finalize` (which itself branches on `total_cents > 0` per migration line 538).

---

## §5 — Blast Radius Map

Every file / table / RPC / edge function / React Query key / Zustand slice / RLS policy / CI gate that ORCH-0787 will touch:

### §5.1 — Database (new migration)

| Object | Change |
|---|---|
| `orders.payment_status` CHECK | Add `'cancelled'` to the value list. |
| `orders` columns | Add `cancelled_at timestamptz`, `cancelled_by uuid` (FK to `auth.users`), `cancellation_reason text`. Optionally `refunded_amount_cents int DEFAULT 0` as a denormalized cache. |
| `public.refunds` columns | Optionally add `currency char(3)`, `stripe_payment_intent_id text`, `processed_at timestamptz`. **Strongly add** a line-level table `public.refund_line_items (id, refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents)`. |
| `tickets` | No schema change. Use existing `status` enum (`'refunded' | 'void'`). |
| `public.refunds` RLS | Add a direct-predicate SELECT policy that admits the post-mutation row by `initiated_by = auth.uid()` OR an equivalent column (to prevent RLS-RETURNING-OWNER-GAP if any path uses supabase-js insert+select). |
| New RPC `biz_refund_order(p_order_id, p_lines jsonb, p_reason, p_stripe_refund_id)` | SECURITY DEFINER. Writes `refunds`, `refund_line_items`, advances `orders.payment_status`, voids `tickets.status`. Returns updated order shape. Live-fire mandatory before CLOSE (per `feedback_headless_qa_rpc_gap`). |
| New RPC `biz_cancel_order(p_order_id, p_reason)` | SECURITY DEFINER. Writes `cancelled_at/by/reason`, advances `orders.payment_status = 'cancelled'`, voids tickets. Free orders only — or shared with paid via internal branch. |

### §5.2 — Edge functions (new + modified)

| Function | Action |
|---|---|
| `supabase/functions/refund-order/index.ts` | **NEW.** Caller (mobile) → JWT-authenticated → calls `biz_refund_order` (preflight RLS check via `biz_can_manage_payments_for_brand_for_caller`) → calls Stripe Refund API on platform key with `payment_intent`, `amount`, `reason`, `reverse_transfer: true`, optional `refund_application_fee: true` → records the `stripe_refund_id` back to `public.refunds` row → enqueues `ticket_order_notifications` row → returns updated order. Idempotency key: `refund:{order_id}:{idempotency_key_from_client}`. |
| `supabase/functions/cancel-order/index.ts` | **NEW.** Caller → JWT auth → calls `biz_cancel_order` → for `payment_method !== 'free'`: ALSO calls Stripe Refund API (per §4.4 collapse-to-refund recommendation; or alternative spec) → returns updated order. |
| `supabase/functions/_shared/stripeWebhookRouter.ts` `handleRefundUpdated` | **MODIFY.** Look up order by `payment_intent` or `charge_id` → upsert `public.refunds` by `stripe_refund_id` (idempotent with in-app refund row) → advance `orders.payment_status` → void tickets → enqueue buyer notification. Also handle `charge.refunded` (the create-side event, currently not in `STRIPE_ROUTED_EVENT_TYPES`). |
| `supabase/functions/_shared/stripeWebhookRouter.ts` `STRIPE_ROUTED_EVENT_TYPES` | Add `'charge.refunded'` and possibly `'refund.created'`/`'refund.updated'` (Stripe API version dependent). |
| `supabase/functions/notify-dispatch/index.ts` | **TOUCH.** Add refund / cancellation email + SMS templates routing. Owner: ORCH-0785 (premium email branding); ORCH-0787 only adds the routing key. |

### §5.3 — Services + hooks (mobile-business)

| File | Action |
|---|---|
| `mingla-business/src/services/eventOrdersService.ts` | **MAJOR.** Replace `statusFromPayment('failed' → 'cancelled')` with separate `'failed' → 'failed'` (new status surface) and `'cancelled' → 'cancelled'`. Replace `refunds: []` hardcode with a SELECT from `public.refunds` (joined or via separate query). Wire `refundedQuantity` and `refundedAmountGbp` from the new line-level refund table. |
| `mingla-business/src/services/orderRefundService.ts` | **NEW.** Wraps the `refund-order` edge function call. Returns `{ order, refund }` on success; throws structured error per `edgeFunctionError.ts`. |
| `mingla-business/src/services/orderCancelService.ts` | **NEW.** Wraps `cancel-order` edge function call. |
| `mingla-business/src/hooks/useEventOrders.ts` | **MINOR.** Add `useRefundOrder()` and `useCancelOrder()` React Query mutations with `onSuccess` invalidation of `eventOrdersKeys.detail`, `eventOrdersKeys.order`, `eventOrdersKeys.soldCounts`, `eventOrdersKeys.salesSummary`. |

### §5.4 — Components (mobile-business)

| File | Action |
|---|---|
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | **MAJOR.** Remove the four hardcoded `false` flags (lines 277-281); derive them from `order.status + order.paymentMethod + canRefund` per Cycle 9c §3.4.2. Wire `RefundSheet` open/close state. Wire `CancelOrderDialog` open/close state. Replace "coming soon" toasts with the real sheets. Add error-toast UX on edge function failure. |
| `mingla-business/src/components/orders/RefundSheet.tsx` | **MAJOR.** Replace `useOrderStore.recordRefund` (Zustand) with `useRefundOrder()` mutation. Remove the 1.2s simulated `sleep` (real Stripe latency replaces it). Keep the existing UX (per-line stepper, reason, permission gate). Surface error states (network, Stripe declined, etc.) per `edgeFunctionError.ts`. |
| `mingla-business/src/components/orders/CancelOrderDialog.tsx` | **MAJOR.** Replace `useOrderStore.cancelOrder` with `useCancelOrder()` mutation. Remove the simulated sleep. Decide free-only vs free-and-paid per §4.4. |
| `mingla-business/src/store/orderStore.ts` | **CONTRACT.** Per I-PROPOSED-J, contract from full server snapshot to ID-only / cache. **Hard guard:** SPEC must NOT add refund/cancel fields to `partialize`. The clean exit is to delete `useOrderStore.recordRefund`, `useOrderStore.cancelOrder`, and the `refunds[]`, `refundedAmountGbp`, `cancelledAt`, `lines[].refundedQuantity` fields from `OrderRecord` — all moves to server-truth via React Query. **Alternative** (less invasive): keep `OrderRecord` shape as-is, but block updates from `recordRefund`/`cancelOrder` once the new server flow lands (force callers to invalidate React Query instead). SPEC chooses. |
| `mingla-business/app/event/[id]/orders/index.tsx` `matchesFilter` | **MINOR.** Add explicit handling of `'failed'` status (separate filter pill or hide entirely). |

### §5.5 — React Query keys

All keys are already factory-style in `eventOrdersKeys` — no new keys to register. ORCH-0787 must invalidate the existing keys post-mutation.

### §5.6 — Stripe API version + shared client

- `supabase/functions/_shared/stripe.ts` `STRIPE_API_VERSION` is the canonical pin per I-PROPOSED-Q. ORCH-0787's `refund-order` edge function MUST use the shared client, MUST NOT pass an inline `apiVersion:` literal.

### §5.7 — CI gates

| Gate | Action |
|---|---|
| `.github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs` | **NEW.** Enforce: (a) `eventOrdersService` selects from `public.refunds` (not `refunds: []`), (b) `RefundSheet` does not call `useOrderStore.recordRefund` directly (must go through `useRefundOrder` mutation), (c) no `payment_status='failed'` → `'cancelled'` mapping anywhere, (d) `orderStore.partialize` does not include refunds[]/cancelledAt. |
| `.github/workflows/strict-grep-mingla-business.yml` | **MINOR.** Add a job entry running the new script (mirrors the existing `orch-0777-ticket-checkout-production` job pattern per `feedback_strict_grep_registry_pattern.md`). |
| `mingla-business/src/services/__tests__/eventOrdersService.test.ts` | **MINOR.** Add coverage for refund-row pull, partial-refund accounting, cancelled-vs-failed separation. |
| `supabase/functions/refund-order/_test/` | **NEW.** Deno test for happy + Stripe-declined + RLS-gate + idempotent-replay + webhook-reconciliation paths. Live-fire required per `feedback_headless_qa_rpc_gap.md`. |

### §5.8 — Decision log + invariant registry + memory rails

- New DEC entry: Stripe Connect destination-charge refund authority = platform account + `reverse_transfer: true`.
- New DEC entry: paid-cancellation collapsed into refund flow (per §4.4) — or distinct, per operator's call.
- New invariant: I-PROPOSED-?? REFUND-AUTHORITY-PLATFORM-ACCOUNT-ONLY (CI-enforced).
- New invariant: I-PROPOSED-?? ORDER-PAYMENT-STATUS-CANCELLED-IS-INTENTIONAL (the `'cancelled'` enum value is reserved for organiser action; `'failed'` is gateway failure only).
- Memory rail update: extend `feedback_zustand_persist_no_server_snapshots.md` with the orderStore TRANSITIONAL exit when ORCH-0787 closes.

---

## §6 — Invariant Violations

### §6.1 — Currently violated by the stub state

| Invariant | Violation evidence | After-fix state |
|---|---|---|
| **I-19** Immutable order financials | Stub-state `orderStore.recordRefund` mutates client-side without server truth. Once a buyer's card is charged but the in-app refund only updates Zustand, the financials surface lies to the organiser. | Server-only refund truth via `public.refunds` + `orders.payment_status`. Zustand is a cache, not the source. |
| **I-PROPOSED-AG** Order brand from event embed + child notification rows authoritative | Refund flow today never writes child notification rows for refund/cancel — rollup would lag. | New `ticket_order_notifications` row on refund/cancel with idempotency key. |
| **I-PROPOSED-H** RLS-RETURNING-OWNER-GAP prevented | `public.refunds` and `public.orders` have no direct-predicate SELECT policy; only SECURITY DEFINER helper policies. Any supabase-js `.insert().select()` would 42501. | Issue refund from edge function service role (bypasses RLS) OR add direct-predicate SELECT policy. Recommend edge function path. |
| **I-PROPOSED-I** Mutation rowcount verified | New refund/cancel mutations MUST chain `.select()` and verify non-null `data` to detect silent 0-row writes. | SPEC enforces in service wrappers. |
| **I-PROPOSED-J** Zustand persist no server snapshots | `orderStore.partialize` persists full `OrderRecord` including `refunds[]`, `refundedAmountGbp`, `cancelledAt`, `lines[].refundedQuantity` — TRANSITIONAL marker present but exit overdue. | Contract to ID-only or document binding extension. |
| **I-PROPOSED-Q** Stripe API version via shared client only | New `refund-order` edge function must use `_shared/stripe.ts` STRIPE_API_VERSION; no inline literal. | CI gate enforces. |
| **Const #1** No dead taps | Action buttons are gated to `false` — render-suppressed dead intent. (Arguably less violation than "renders + does nothing", but still dishonest UX.) | Real buttons that actually issue refunds. |
| **Const #3** No silent failures | "Coming soon" toast hides a stubbed feature. | Real success/failure surfacing with detailed error states. |
| **Const #9** No fabricated data | Refunded amounts of `0` always returned regardless of true refund state; Cancelled filter pill is reachable only through the conflated `'failed'` mapping. | Real numbers from `public.refunds`; Cancelled reflects intentional cancellation only. |

### §6.2 — New invariants ORCH-0787 should establish

- **I-PROPOSED-(new) REFUND-AUTHORITY-PLATFORM-DESTINATION** — Refund of a destination-charge order is issued on the platform Stripe key with `reverse_transfer: true`. No `Stripe-Account` header. Application-fee refund coordinates via `refund_application_fee: true` when the original charge had one. Enforced by CI grep over `supabase/functions/refund-order/index.ts`.
- **I-PROPOSED-(new) ORDER-CANCELLED-VS-FAILED-SEPARATION** — `orders.payment_status='failed'` is a gateway failure (write only by `biz_ticket_checkout_finalize` failure path). `orders.payment_status='cancelled'` is intentional cancellation (write only by `biz_cancel_order`). No mapping conflates them. Enforced by CI grep + unit test.
- **I-PROPOSED-(new) REFUND-ROW-WRITTEN-BEFORE-STATUS-ADVANCED** — `public.refunds` row insert must precede `orders.payment_status` advance within the same transaction (or via RPC) — never write the status without the audit row.

---

## §7 — Open Questions for SPEC (operator decisions required)

| # | Question | Default if operator doesn't choose |
|---|---|---|
| Q-1 | Should paid-order intentional cancellation be a distinct state, or collapse into full refund? (§4.4) | **Collapse into full refund** (Eventbrite pattern; simplest spec). |
| Q-2 | Application fee refund policy: always refund proportionally? (§4.2) | **Always proportional** (Stripe's default with `refund_application_fee: true`). |
| Q-3 | Partial-refund line-to-ticket selection policy: oldest-first, highest-qr-hash-first, or per-ticket UI? (§4.3) | **Oldest-first** (deterministic, no UI burden). |
| Q-4 | `tickets.status` advance on refund: defense-in-depth (also flip to `'refunded'`) or single-source (rely on `payment_status` scanner gate)? (§4.3) | **Defense-in-depth** — flip both. |
| Q-5 | Cancellation reason: required or optional? Min/max chars? | **Required, 10..200 chars** (mirrors `RefundSheet` and `DoorRefundSheet` patterns; consistent UX). |
| Q-6 | Undo window: should newly-issued refunds be reversible (e.g., 60-second un-do)? | **No undo.** Stripe doesn't support refund reversal; the only undo is a forward "re-charge" which is a separate flow. |
| Q-7 | Should `orphan-refund service` column-name bug (S-09) fold into ORCH-0787 or get a new ORCH? | **Fold in** — webhook handler change forces touching the orphan path. |
| Q-8 | `orderStore` TRANSITIONAL exit strategy: contract to ID-only, OR keep shape and stop writing refunds locally? (C-04, I-PROPOSED-J) | **Stop writing refunds locally** in v1 (keep shape, document a follow-up ORCH for ID-only contraction). Less disruptive to existing consumers. |
| Q-9 | Free-order cancellation: same `cancel-order` edge function with internal branch, or separate client-side path? (§4.8) | **Same edge function with internal branch.** |
| Q-10 | Should webhook handler subscribe to modern `refund.created`/`refund.updated` events in addition to `charge.refund.updated`? (C-08) | **Yes** — broader compatibility with future Stripe API versions. |

---

## §8 — Out-of-Scope Boundary

ORCH-0787 **does NOT** own:

- **ORCH-0785 — premium transactional email branding** owns the rendered HTML/text of the refund + cancellation emails. ORCH-0787 only enqueues the `ticket_order_notifications` row; ORCH-0785's templates render it.
- **ORCH-0784 — event list sales summary visibility** owns the post-refund display contract on Home / Events list cards. ORCH-0787's React Query invalidation will refresh those surfaces; the visibility logic is not re-touched.
- **ORCH-0782 — organizer resend-ticket CTA + notification rollup recompute** owns the resend-ticket mechanic. ORCH-0787 may emit notifications on refund/cancel, but the rollup recompute is ORCH-0782's surface.
- **ORCH-0786 — business profile avatar** is unrelated.
- **Cycle 12 — door-sale refund flow** (`DoorRefundSheet.tsx` + `useDoorSalesStore.recordRefund`) is a parallel ledger per I-Cycle-12. ORCH-0787 may copy UX patterns but does not modify door-sale code.
- **`BrandStripeOrphanedRefundsSection`** — kept as a surface for **truly orphan** refunds (detached account or no matching order). ORCH-0787 fixes the column-rename bug (S-09) as a marginal-shared-scope side-fix per Q-7, but does NOT change the surface's purpose.
- **Application-fee policy increase** — Mingla charging more than 0% — is a separate operator decision and a separate ORCH. ORCH-0787 must code the refund flow to handle both `app_fee=0` and `app_fee>0` cases.
- **Buyer-side ticket UI** (app-mobile / web /e/ /o/) — anonymous buyer surfaces are unchanged; the buyer sees the refund only via email.

---

## §9 — Confidence Summary

**Overall:** **High** confidence on the stub map (all five layers proven; production data probed; code re-read; latest-migration discipline applied; six-field evidence on every finding). **Medium** confidence on a small set of SPEC-phase forks where the operator preference is the decisive input (§4.2 application-fee policy, §4.4 paid-cancellation semantics, Q-1 through Q-10).

**What raises confidence:**
- Live Management API probes on 11 production tables and 4 RLS surfaces (zero mutations).
- Direct read of the latest migration for `orders.payment_status`, `public.refunds`, `tickets`, `order_line_items`, `ticket_checkout_sessions`, `payment_webhook_events`.
- Direct read of `stripeWebhookRouter.ts` confirming the `handleRefundUpdated` audit-only behaviour.
- Direct read of `RefundSheet.tsx`, `CancelOrderDialog.tsx`, `DoorRefundSheet.tsx`, and `orderStore.ts` confirming the UX scaffolds exist and are server-disconnected.
- Cross-check against I-PROPOSED-H / I-PROPOSED-J / I-PROPOSED-Q / I-19 invariants — all confirmed relevant.

**What would raise the remaining medium-confidence items to high:**
- Operator answer on Q-1 (paid-cancellation policy).
- Operator answer on Q-2 (application-fee refund policy).
- Reading `supabase/functions/_shared/stripe.ts` for the pinned `STRIPE_API_VERSION` and confirming `charge.refunded` event support at that version.

**Verdict:** the investigation is sufficient for the SPEC phase to commence. The stub map is proven, the blast radius is enumerated, the invariants are named, and ten operator decisions are isolated for confirmation.

---

## §10 — Discoveries for Orchestrator (side issues)

- **S-09 — orphan refund service column mismatch.** `mingla-business/src/services/brandStripeOrphanedRefundsService.ts:48-56` queries `payment_webhook_events` columns that do not exist (`event_id`, `raw_payload`, `event_type`, `account_id`). The service is currently dormant (zero refunds in production), but the moment a Stripe-dashboard refund lands for a detached connected account, the section crashes or returns nothing. Recommended: fold into ORCH-0787 SPEC §5 as a required side-fix because the webhook reconciliation must query the same table. If folded out, register as ORCH-0788.
- **C-08 — webhook router missing `charge.refunded` and modern `refund.*` events.** Currently only `charge.refund.updated` and `application_fee.refunded` are routed. SPEC phase should confirm coverage against the pinned `STRIPE_API_VERSION`.
- **Cycle 9c spec file not locatable.** `Mingla_Artifacts/specs/` and the immediate archive paths contain no `SPEC_CYCLE_9C_*` or refund-flow spec. The code header JSDocs are the surviving authority. SPEC phase should re-derive from the code + this investigation, and either locate the historical spec or document its loss (D-03).
- **`orderStore` TRANSITIONAL exit overdue.** Per I-PROPOSED-J the store should have contracted post-ORCH-0742 for orders too. ORCH-0787 is the right moment to either complete the contraction or document a binding extension (C-04 + Q-8).

---

**End of investigation report — ORCH-0787.**

Next dispatch: Claude `mingla-forensics` SPEC mode, working from this report.
