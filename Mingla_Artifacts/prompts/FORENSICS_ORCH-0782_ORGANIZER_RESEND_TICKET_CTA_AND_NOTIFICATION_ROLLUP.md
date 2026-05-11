# FORENSICS ORCH-0782 — Organizer Resend Ticket CTA and Notification Rollup Recompute

Date: 2026-05-11
Canonical owner: Claude `mingla-forensics` (INVESTIGATE mode)
Working tree: create/open `.worktrees/orch-0782-organizer-resend-ticket-rollup/`
Expected output: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0782_ORGANIZER_RESEND_TICKET_CTA_AND_NOTIFICATION_ROLLUP.md`

## Mission

Investigate the deferred ORCH-0777 follow-up for an organizer-facing "Resend ticket" CTA and a reliable notification rollup recompute contract.

## Required Inputs

- `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/reports/QA_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0777.md`
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- Relevant code/schema for organizer order detail/actions, `ticket_order_notifications`, `orders.notification_status`, and `ticket-confirmation-dispatch`.

## Investigation Questions

1. What organizer surface should own a privacy-safe "Resend ticket" action: order detail, order list row menu, guest detail, or another existing action surface?
2. What exact authorization contract should gate resend actions so only the right brand/team role can trigger them?
3. What row-level truth should the action read and mutate: `ticket_order_notifications`, `orders.notification_status`, a new RPC, or a service-role Edge Function?
4. How should child notification rows remain canonical when parent `orders.notification_status` is stale or partly wrong?
5. What is the smallest correct rollup recompute contract for email+SMS mixed states?
6. How should Twilio external config failures be surfaced without pretending the order/ticket failed?
7. What regression tests or strict-grep gates would fail before the follow-up and pass after it?

## Hard Guards

- Investigation only. Do not write code, SQL migrations, provider mutations, or product copy.
- No PII, provider message IDs, raw email/SMS bodies, raw phone numbers, raw recipient emails, secrets, QR payloads, or token values in the report.
- Do not reopen ORCH-0777 unless investigation proves a current shipped code regression in the closed scope.
- Treat the two accepted non-operator SMS rows from ORCH-0777 as known Twilio configuration evidence unless new proof shows a Mingla code-side failure.

## Downstream Routing

After the investigation returns, route to Claude `mingla-forensics` SPEC mode if a bounded implementation is warranted, then Codex `implementor-mingla`, then Claude `mingla-forensics` TEST mode, then Codex `orchestrator-mingla` for CLOSE.
