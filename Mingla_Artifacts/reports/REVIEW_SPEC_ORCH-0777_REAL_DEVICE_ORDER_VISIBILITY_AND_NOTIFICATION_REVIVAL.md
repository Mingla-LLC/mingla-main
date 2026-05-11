# REVIEW SPEC ORCH-0777 — Real-Device Order Visibility and Notification Revival

Date: 2026-05-11
Owner: Codex `orchestrator-mingla` (REVIEW)
Reviewed spec: `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Verdict: APPROVED FOR CODEX `implementor-mingla`

## Review Summary

The SPEC is approved. It correctly treats the real-device launch blocker as two independent defects with separate implementation evidence and separate CLOSE gates:

- Fix A: `mingla-business` organizer order visibility regression caused by selecting nonexistent `orders.brand_id`.
- Fix B: privacy-safe state repair for the 2026-05-11 02:55-03:09 UTC `failed_terminal` notification rows, using the already-ACTIVE `ticket-confirmation-dispatch` function.

The implementor dispatch must preserve that split. ORCH-0777 remains non-closeable until Gate A and Gate B pass independently.

## Inputs Cross-Checked

| Artifact | Result |
|---|---|
| `reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md` | Supports both root causes. Fix A is a PostgREST column-resolution failure before RLS; Fix B is a terminal notification-state problem from the provider repair window. |
| `specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` §3.5 | Supports server-backed organizer truth: orders, detail, revenue, guests, scanner, and resend action must ultimately read durable server state. Fix A advances the server-order path without reopening unrelated checkout work. |
| `specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` §6.4 | Supports the long-term resend contract, but does not require the CTA in this repair cycle. The current SPEC correctly defers the organizer "Resend ticket" CTA to a follow-up ORCH. |
| `reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` | Confirms backend checkout, provider repair timing, and dispatcher/provider behavior; also explains why earlier "Organizer Orders truth" evidence was DB-layer only, not the client SELECT path. |
| `reports/QA_ORCH-0777_TICKET_CHECKOUT_IOS_ANDROID_WEB_PARITY.md` | Confirms code-side parity before the new real-device failures; does not invalidate the later client SELECT and failed-terminal findings. |

## Scope Review

APPROVED:

- Fix A is scoped to `eventOrdersService.ts`, the Orders screen error state, the existing ORCH-0777 strict-grep script, the existing strict-grep workflow registry, and the existing Jest migration-guards suite.
- Fix B is scoped to a one-shot, privacy-safe state-repair runbook plus invocation of the already-ACTIVE `ticket-confirmation-dispatch` function.
- The prior SPEC §6.4 organizer "Resend ticket" CTA is correctly deferred to a follow-up ORCH. The current cycle must not build UI, edge-function, migration, rollup, audit-column, or rate-limit work for that CTA.

NOT APPROVED IN THIS CYCLE:

- New migration.
- `supabase db push`.
- Edge Function deploy.
- Provider/dashboard mutation.
- Source edits to `supabase/functions/ticket-confirmation-dispatch/index.ts`.
- Source edits to `supabase/functions/_shared/ticketCheckout.ts`.
- Resend-CTA product work.
- Rollup recompute behavior change.

## Strict-Grep Registry Review

The SPEC honors the strict-grep registry pattern:

- One existing script is extended: `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`.
- One workflow file receives/ensures one job entry: `.github/workflows/strict-grep-mingla-business.yml`.
- No parallel workflow file is permitted.
- Rules G-A1 through G-A4 are binding and must be evidenced in the implementation report.

Current pre-implementation repository state confirms the ORCH-0777 script exists and the workflow is the canonical registry file. The workflow job for ORCH-0777 is not yet present, which matches the SPEC's stated gap and belongs to Fix A.

## Dual-CLOSE Gate Review

The dual-CLOSE language is sufficient:

- §3.3 says ORCH-0777 cannot CLOSE until both Fix A and Fix B verification gates pass independently.
- §10 requires separate Gate A and Gate B rows and states that a combined verdict is non-conforming.
- §12 repeats that no collapse is permissible at implementation, test, or close.
- §13 routes implementation to Codex `implementor-mingla`, then TEST to Claude `mingla-forensics` / tester routing, then CLOSE back to Codex `orchestrator-mingla`.

Tester interpretation note: Gate B.3 mentions `orders.notification_status` rollup reflecting the new state, but the same cell explicitly says stale rollup is informational and not a Gate B fail because rollup recompute is deferred. For Fix B, child rows in `ticket_order_notifications` are authoritative. The implementor and tester should not turn a stale parent rollup into a false failure unless it contradicts the child ledger or creates duplicate orders/tickets/notifications.

## Approval Conditions For Implementor

The implementor must:

- Keep Phase 1 and Phase 2 as separate commits or, at minimum, separately evidenced commit-ready units if the dirty working tree prevents immediate commit.
- Produce `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`.
- Include repo-running regression evidence for Fix A: Jest migration-guards plus strict-grep script.
- Include privacy-safe state-repair evidence for Fix B: candidate rows by id/status/count only, dispatcher responses by order/channel/status only, post-run ledger rows by id/status/count only, and duplicate-check counts.
- Escalate before changing any hard-guarded file or scope.

## Downstream Dispatch

Prompt written at:

`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`

After implementor return, route to Claude `mingla-forensics` in TEST mode to execute §10 Gate A and Gate B independently, with Claude `mingla-tester` downstream routing per the 2026-05-10 reversal. Codex `orchestrator-mingla` owns CLOSE only after dual PASS.
