# OPERATOR ORCH-0777 — Close-Condition Attestation

Date: 2026-05-11
Owner: Operator
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Status: READY FOR OPERATOR ACTION
Expected return: paste the privacy-safe attestation back to Codex `orchestrator-mingla`

## Context

ORCH-0777 dual-gate QA returned CONDITIONAL PASS for both Gate A and Gate B in `Mingla_Artifacts/reports/QA_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`.

Static, schema, PostgREST, Jest, strict-grep, TypeScript, and DB-ledger evidence are GREEN. CLOSE is still blocked until the operator supplies the three confirmations below.

## Required Operator Confirmations

1. Gate A.6-A.10 real-device parity:
   - On iOS, open the leggothis brand in the installed Mingla Business build.
   - For event `b1ab659e-…` ("A life in vegas"), confirm Orders renders 8 rows.
   - For event `a3f71d85-…` ("The party block"), confirm Orders renders 3 rows.
   - On both events, confirm Order detail, Revenue, Sold, Guest, and Activity surfaces render the expected non-empty/accurate state from the QA report.
   - Repeat the same parity walk on Android.

2. Gate B.4 revived email receipt:
   - Confirm the revived `c1d35ae6-…` ticket email arrived in the operator mailbox.
   - Privacy-safe attestation only. Do not paste subject, body, headers, recipient, provider message id, or raw email content.

3. P2-B1 Twilio external-lane decision:
   - Either explicitly accept the two non-operator SMS rows `d33ca033-…` (`869bee74-…`) and `a739efc0-…` (`e8958375-…`) as the known Twilio toll-free / Messaging Service config gap.
   - Or route a bounded follow-up to Codex `implementor-mingla` for one-shot UPDATE + dispatcher re-invoke after Twilio sender re-attach.

## Close Routing After Return

If all three confirmations PASS / accepted, Codex `orchestrator-mingla` should proceed to CLOSE, file the deferred organizer "Resend ticket" CTA + rollup-recompute follow-up ORCH per spec §B.3 / §14, and scope the CLOSE commit to the five Fix-A files only:

- `mingla-business/src/services/eventOrdersService.ts`
- `mingla-business/app/event/[id]/orders/index.tsx`
- `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`
- `.github/workflows/strict-grep-mingla-business.yml`
- `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`

The dispatcher / classifier / checkout-create carryover diffs are not part of this close and should be folded into a separate ORCH-0779 / ORCH-0781 follow-up commit.

If any Gate A.6-A.10 real-device check fails, do not close. Route back to Codex `implementor-mingla` for REWORK with the exact failing gate cited.

## Copy-Paste Return Format

```text
ORCH-0777 operator close-condition attestation:
Gate A.6-A.10 iOS: PASS/FAIL — <privacy-safe notes, include failing gate if any>
Gate A.6-A.10 Android: PASS/FAIL — <privacy-safe notes, include failing gate if any>
Gate B.4 revived c1d35ae6-… email receipt: PASS/FAIL — confirmed at <UTC time or N/A>; no body/headers/provider IDs reproduced.
P2-B1 Twilio external-lane decision: ACCEPT known config gap / ROUTE one-shot follow-up after sender re-attach.
Requested routing: CLOSE / REWORK / FOLLOW-UP.
```
