# SPEC AMENDMENT — ORCH-0788 §8 (Sweeper Orphan-Pending Path)

| Field | Value |
|---|---|
| Amends | `Mingla_Artifacts/specs/SPEC_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` §8 (Scheduled retry sweeper) |
| Discovery ID | D-0788-7 |
| Surfaced by | Orchestrator MCP probe immediately after edge-function deploys, 2026-05-11 ~23:48 UTC |
| Approved by | Operator (via `AskUserQuestion` — option "Extend sweeper to include pending > 5 min old (Recommended)") |
| Implemented in | Sweeper v2 redeploy at 2026-05-11 ~23:50 UTC (same close cycle) |
| Verified by | QA report `reports/QA_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER_REPORT.md` PASS verdict + 3 successful pg_cron runs + 0 unsent email rows post-deploy |
| Status | ACTIVE — running implementation is authoritative; this amendment documents what shipped |

---

## 1. Plain-English summary

The original SPEC §8 scoped the retry sweeper strictly to `status='failed_retryable'` rows past their exponential backoff window. This is correct steady-state behavior — newly enqueued rows hit `pending` for sub-second windows before the inline-dispatch flips them. But during the operator's `supabase db push` window today, an MCP probe surfaced **3 rows stuck in `pending` with `attempt_count=0`** because they were enqueued BEFORE this deploy made `dispatchTicketConfirmation` an inline call. The original sweeper's strict filter would have left those 3 rows stranded indefinitely (no transition to `failed_retryable` ever happens unless something attempts a send first).

Operator approved extending the sweeper to also pick up `pending` rows older than 5 minutes. Threshold rationale: in normal operation the inline-dispatch fires sub-second after enqueue; anything still `pending` after 5 min means inline-dispatch silently failed before flipping the row (e.g. wrong service-role key, dispatcher 503, network blip between INSERT and fetch). This safety net both drained the 3 legacy stuck rows AND protects against future silent inline-dispatch failures.

---

## 2. Original spec §8.1 (excerpt)

> Eligible rows: `status='failed_retryable'`, `attempt_count<3`, AND backoff window elapsed.
> Backoff: 2^attempt_count × 60 seconds since `updated_at`.
> updated_at carries the timestamp of the most recent attempt.

Scope: single eligibility path, gated on `failed_retryable` status only.

---

## 3. Amended spec §8.1

Eligible rows fall into **two** paths:

### Path 1 — Retry of failed_retryable (UNCHANGED from original)

- `status = 'failed_retryable'`
- `attempt_count < 3`
- `now() - updated_at >= 2^attempt_count × 60 seconds`

### Path 2 — Orphan-pending safety net (NEW)

- `status = 'pending'`
- `now() - created_at >= 300 seconds` (5 min, `ORPHAN_PENDING_SECONDS` constant)

Path 2 catches rows where inline-dispatch silently failed between enqueue and the dispatcher's first send attempt. Pending rows for fresh writes are NEVER picked up by the sweeper — inline-dispatch handles them sub-second.

---

## 4. Implementation receipt

File: `supabase/functions/notification-retry-sweeper/index.ts`

- Constant: `const ORPHAN_PENDING_SECONDS = 300;`
- Query filter: `.in("status", ["failed_retryable", "pending"])`
- Select adds `created_at` (in addition to existing `updated_at`)
- `isEligible(row, nowMs)` now branches on `status`:
  - For `pending`: returns `nowMs - new Date(row.created_at).getTime() >= ORPHAN_PENDING_SECONDS * 1000`
  - For `failed_retryable`: unchanged exponential backoff against `updated_at`
- Existing introspection tests updated; new test `notification-retry-sweeper: orphan-pending threshold is 5 min (300s)` added
- Test count: 9 → 10

Edge function version: v1 → v2 (redeployed within the same CLOSE cycle as the initial deploy).

---

## 5. Strict-grep gate impact

**None.** The CI gate at `.github/scripts/strict-grep/orch-0788-notification-template-key-dispatched.mjs` does NOT inspect sweeper internals (its 7 checks cover adapter exports, dispatcher routing, writer inline-dispatches, and migration cron registration — not sweeper query shape). The orphan-pending extension is enforced by code review + the new Deno introspection test, not by strict-grep. Future ORCH may add a sweeper-internals check if needed.

---

## 6. Production verification

Post-amendment, the sweeper picked up the 3 orphan-pending rows on the 23:55 UTC cron tick:

- `81fe2a68-…` (the operator's refund test from 17:46 UTC, stuck 6+ hours) → sent at 23:55:01 with Resend `provider_message_id`
- `7f868ca8-…` order pending email → sent
- `48522c03-…` order pending email → sent

All three transitioned `pending` → `sending` → `sent` via the dispatcher routing through the new `buyer_refund_issued` and `buyer_order_cancelled` branches as appropriate. Zero unsent email rows remain post-second-tick.

---

## 7. Why this amendment exists (vs. a separate ORCH)

The orphan-pending gap was a logical consequence of the deploy moment — rows enqueued before inline-dispatch existed could never recover under the original sweeper scope. Three options were considered:

1. **Manual one-time drain** (operator curls the dispatcher per stuck order) — works but doesn't protect future inline-dispatch failures
2. **New follow-up ORCH-0788-A or ORCH-0788-C** — defers the fix; the 3 stuck rows stay stuck for days
3. **In-flight spec amendment** — extends the sweeper safely, drains the 3 stuck rows immediately, AND protects against any future silent inline-dispatch failure. One-line query filter change + new isEligible branch. Tests updated.

Operator chose option 3 via explicit AskUserQuestion. This document is the formal amendment trail. The original SPEC text is preserved verbatim; this amendment is the authoritative addendum that ships alongside CLOSE.

Pattern precedent: `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`, `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-0764C_STRIPE_COUNTRY_CHANGE_BEFORE_COMPLETION.md`.

---

## 8. Future maintenance note

If a future ORCH refactors the sweeper's eligibility logic, this amendment's two-path design is the canonical contract. The `ORPHAN_PENDING_SECONDS = 300` constant SHOULD remain ≥ 60 seconds (longer than any real inline-dispatch latency) and SHOULD remain ≤ 600 seconds (so legacy/orphan rows drain within 2 cron ticks). Tuning this value outside [60, 600] requires SPEC review.
