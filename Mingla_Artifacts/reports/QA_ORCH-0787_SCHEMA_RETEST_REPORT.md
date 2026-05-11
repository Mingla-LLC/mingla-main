# QA RETEST — ORCH-0787 Order Refund + Cancel (Schema-Only Layer)

- **ORCH-ID:** ORCH-0787
- **Tester:** Claude `mingla-tester` (legacy parity mirror — operator explicit redirect)
- **Sub-mode:** RETEST (post operator gate: migration push)
- **Scope:** Schema-layer verification ONLY. Edge function live-fire is **BLOCKED** — see §3.
- **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
- **Date:** 2026-05-11
- **Prior QA:** `Mingla_Artifacts/reports/QA_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md` (CONDITIONAL PASS, condition #1 = operator gates, condition #2 = live-fire dispatch)

---

## Verdict: **CONDITIONAL PASS (schema-only; live-fire still owed)**

- **P0:** 0
- **P1:** 0 unaccepted
- **P2:** 0 new (carried forward 4 from prior QA)
- **P3:** 0 new (carried forward 3 from prior QA)
- **Blocker for next CONDITIONAL PASS condition #2:** edge function deploys not done.

**Status against prior QA's CLOSE conditions:**

| Prior-QA condition | Status |
|---|---|
| 1a. `STRIPE_RAK_TICKET_REFUND` secret configured | **UNVERIFIED** — tester cannot read Edge Function secrets via SQL or git; presumed configured per operator's dispatch, but live-fire is the only direct verifier. |
| 1b. `supabase db push --linked` applied | ✅ **CONFIRMED LIVE** — `mcp__supabase__list_migrations` shows `20260520000000_orch_0787_order_refund_cancel` on remote. (Bonus: `20260515000019_orch_0786_creator_avatars_bucket` also landed.) |
| 1c. Edge function deploys (`refund-order`, `cancel-order`, `stripe-webhook` redeploy) | ❌ **NOT DONE** — `mcp__supabase__list_edge_functions` shows: `refund-order` and `cancel-order` not in the function list at all; `stripe-webhook` is still at v26 (pre-ORCH-0787 extension). The webhook reconciler with the three new Stripe event types and the `biz_refund_order_commit_from_webhook` call is NOT deployed to the platform. |
| 2. Live-fire forensics TEST after deploys | ❌ **CANNOT RUN** — the four highest-value tests (T-19 race mitigation, T-11 dashboard refund, T-01..T-04 happy paths, T-12 RLS bypass) all require the edge functions to exist on the platform. Issuing a refund today returns 404. Triggering `stripe trigger refund.created` would dispatch to v26 stripe-webhook which still has the legacy 3-event-type union and would log every new event as `webhook_unhandled`. |

---

## §1 — Schema Verification (8 probes, all PASS)

Read-only SQL probes executed against production project `gqnoajqerqhnvulmnyvv` via `mcp__supabase__execute_sql`. No mutations.

### Probe 1 — `orders_payment_status_check` includes `'cancelled'`

✅ PASS. Live constraint:
```
CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partial_refund'::text, 'cancelled'::text])))
```
SC-13 schema portion verified. Strict-grep enforcement (no `'failed' → 'cancelled'` mapping in code) was already verified statically.

### Probe 2 — New `orders` columns

✅ PASS. All four present:
- `cancellation_reason text NULL`
- `cancelled_at timestamp with time zone NULL`
- `cancelled_by uuid NULL`
- `refunded_amount_cents integer NOT NULL DEFAULT 0`

SC-09 (cancelled_at/by/reason persistence) schema portion verified.

### Probe 3 — `refunds` table extended

✅ PASS. Six new columns appended to the existing eight:
- `currency character NOT NULL DEFAULT 'GBP'::bpchar`
- `stripe_payment_intent_id text`
- `stripe_charge_id text`
- `application_fee_refunded_cents integer NOT NULL DEFAULT 0`
- `processed_at timestamp with time zone`
- `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`

All defaults applied as spec'd. F-02 (P2 from prior QA — application_fee_refunded_cents hardcoded to 0 in edge fn) is still latent today (app_fee=0 in production); no schema-side concern.

### Probe 4 — `refund_line_items` table exists

✅ PASS. Seven columns: `id, refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents, created_at`. All NOT NULL on the data columns. RLS enabled (Probe 5).

### Probe 5 — RLS policies (I-PROPOSED-H verification)

✅ PASS. Live policies:

| Table | Policy | Cmd | Direct-predicate? |
|---|---|---|---|
| `refunds` | "Brand admin plus can manage refunds" | ALL | No (helper-based — existing) |
| `refunds` | "Refunds owner direct select for RETURNING" | SELECT | ✅ **YES** — `(initiated_by = auth.uid()) OR helper` |
| `refund_line_items` | "Refund line items inherit refund access" | ALL | No (refund→helper) |
| `refund_line_items` | "Refund line items direct select for RETURNING" | SELECT | ✅ **YES** — `EXISTS refund WHERE initiated_by = auth.uid()` |

**RLS-RETURNING-OWNER-GAP fully closed per I-PROPOSED-H.** The direct-predicate SELECT policies admit the post-mutation row via `initiated_by = auth.uid()` so any future `.insert().select()` chain from supabase-js will not 42501. Today this is unused (writes go through SECURITY DEFINER edge function via service role), but the defense-in-depth backstop is in place.

### Probe 6 — Four new RPCs

✅ PASS. All four exist with `SECURITY DEFINER` and exact spec'd signatures + return type `jsonb`:

| Function | SECURITY DEFINER | Args | Returns |
|---|---|---|---|
| `biz_refund_order` | ✅ | `p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text` | jsonb |
| `biz_refund_order_commit` | ✅ | `p_refund_id uuid, p_stripe_refund_id text, p_application_fee_refunded_cents integer, p_status text` | jsonb |
| `biz_refund_order_commit_from_webhook` | ✅ | `p_order_id uuid, p_stripe_refund_id text, p_amount_cents integer, p_currency character, p_application_fee_refunded_cents integer, p_idempotency_key_hint text` | jsonb |
| `biz_cancel_order` | ✅ | `p_order_id uuid, p_reason text` | jsonb |

Live-fire of each RPC through its real caller (per `feedback_headless_qa_rpc_gap`) is owed once edge functions are deployed.

### Probe 7 — `payment_webhook_events.account_id` generated column (Q-7 folded fix)

✅ PASS. Live:
```
account_id text NULLABLE GENERATED ALWAYS AS (payload->>'account')
```
S-09 fix verified at the schema layer. The `brandStripeOrphanedRefundsService.ts` query (re-pointed to `payload`/`type`/`stripe_event_id` + the new generated `account_id`) will now succeed at runtime.

### Probe 8 — Indexes (6 ORCH-0787 indexes + 1 retained)

✅ PASS. All six new indexes present:
- `idx_refunds_stripe_refund_id` — UNIQUE partial WHERE `stripe_refund_id IS NOT NULL` (idempotency lookup)
- `idx_refunds_order_id_status` (status-scoped joins)
- `idx_refunds_metadata_idempotency_key` — partial WHERE `metadata->>'idempotency_key' IS NOT NULL` (race-mitigation match path performance — critical for T-19)
- `idx_refund_line_items_refund_id` (FK lookup)
- `idx_refund_line_items_order_line_item_id` (per-line aggregation)
- `idx_payment_webhook_events_account_id_type` — partial composite (orphan service lookup)

Pre-existing `idx_refunds_order_id` retained. No regressions on the existing index set.

---

## §2 — Constitution + Invariant Spot-Check (schema layer)

| # | Rule | Verdict |
|---|---|---|
| 2 | One owner per truth | ✅ Server-side refund truth (refunds + refund_line_items) live and shape-correct |
| 9 | No fabricated data | ✅ `refunded_amount_cents` cache column has CHECK >=0 and <= total_cents at the constraint level |
| 12 | Validate at right time | ✅ Reason length checks at constraint level (`refunds_reason_length` 10..200, `orders_cancellation_reason_length` 10..200) |
| I-PROPOSED-H | RLS-RETURNING-OWNER-GAP prevented | ✅ Direct-predicate SELECT policies confirmed live on both new tables |

**No new constitutional or invariant violations introduced.**

---

## §3 — Hard Blocker: Edge Function Deploys

`mcp__supabase__list_edge_functions` (this session):

| Function | Status |
|---|---|
| `refund-order` | **NOT IN LIST** — never deployed |
| `cancel-order` | **NOT IN LIST** — never deployed |
| `stripe-webhook` | At version 26, last `updated_at: 1778487226202` (pre-ORCH-0787) — extension to handle `charge.refunded` / `refund.created` / `refund.updated` and to call `biz_refund_order_commit_from_webhook` is in `supabase/functions/_shared/stripeWebhookRouter.ts` on disk but NOT on the platform |

**Consequences of the deploy gap:**
- Any client tap of "Refund order" → 404 from `supabase.functions.invoke('refund-order')`. User sees `network_error` / `internal_error` toast.
- Any client tap of "Cancel order" (free) → same 404.
- Any Stripe-dashboard-initiated refund → webhook fires `charge.refund.updated`/`charge.refunded` to v26 stripe-webhook. v26 routes `charge.refund.updated` to the OLD `handleRefundUpdated` (audit-only for detached accounts, no-op for attached), and routes `charge.refunded`/`refund.created`/`refund.updated` to the `default` case which writes a `webhook_unhandled` audit row. **`public.refunds` will remain empty even when Stripe sends a refund.**
- Race-mitigation T-19 is untestable.

**This is a STATIC blocker, not a code defect.** The implementation is verified statically; it just doesn't exist on the platform yet.

---

## §4 — What I Did NOT Run (And Why)

Per tester discipline rule #3 ("NEVER accept 'works on my device'") and #9 ("NEVER claim a test passed that you didn't actually run"):

- **T-01..T-04 happy paths** — require deployed `refund-order` + live Stripe test mode. Not run.
- **T-11 dashboard refund reconcile** — requires deployed `stripe-webhook` v27+. Not run.
- **T-12 RLS bypass** — requires deployed `refund-order` + non-finance-manager JWT. Not run.
- **T-19 webhook+in-app race** — requires deployed `refund-order` + deployed `stripe-webhook` v27+. Not run.
- **iOS/Android/Web parity smoke** — operator-assisted manual smoke; out of scope for this skill anyway.

These all owe to the post-deploy live-fire pass.

---

## §5 — Discoveries for Orchestrator

1. **Deploy gate is the only blocker.** The schema is clean and the implementation is statically verified. Orchestrator must deploy `refund-order`, `cancel-order`, and `stripe-webhook` (the redeploy is mandatory for the router extension) via the local Supabase CLI. After deploy, redispatch live-fire to Claude `mingla-forensics` (TEST mode, canonical) — NOT to this skill, per DEC-133.

2. **`STRIPE_RAK_TICKET_REFUND` secret state UNVERIFIED.** I cannot read Edge Function secrets. The first call to deployed `refund-order` will fail with `"STRIPE_RAK_TICKET_REFUND environment variable is not set"` if the secret wasn't configured. Suggest the orchestrator do a dry probe (a deliberately-failing call to `refund-order` after deploy — e.g., POST with empty body — to confirm at least the secret-load step is OK before live-fire) before handing off.

3. **No new findings from this RETEST pass.** All four P2 (F-01..F-04) and three P3 (F-05/F-06/F-09) findings from the original QA report remain accurate. ORCH-0788 should still be registered for orderStore contraction + F-02 app-fee. F-03 (Jest extension), F-04 (ORCH-0782 event-edit-log re-introduction), F-09 (buyer-side staleness) tracked as separate items per the operator's earlier acceptance.

---

## §6 — Severity Counts

| Severity | This RETEST | Carried-forward from prior QA |
|---|---|---|
| P0 | 0 | 0 |
| P1 (unaccepted) | 0 | 0 |
| P2 | 0 new | 4 (F-01, F-02, F-03, F-04) |
| P3 | 0 new | 3 (F-05, F-06, F-09) |
| P4 (praise) | 0 new | 4 (F-08, F-10, F-11, schema-clean PASS) |

**Schema landing was clean — no surprises between the migration file and the production state.** That's a credit to the implementor's idempotent DDL pattern (IF EXISTS / IF NOT EXISTS / OR REPLACE on every statement).

---

**End of QA RETEST report — ORCH-0787 schema-only.**
