# SPEC — ORCH-1206: the RSVP QR pass is sent ONLY after approval (never while pending)

**Status:** APPROVED (orchestrator) — Seth: "do not send the QR code while still pending approval" (2026-06-22).
**Type:** backend-only. No client/UI change. Follow-on to ORCH-1203.

## Problem
For manual-approval RSVP events (`events.rsvp_approval_mode='manual'`), a "going" submission resolves to `rsvp_status='going'` + `approval_status='pending'`. Today the QR entry pass is delivered too early:
- `public-submit-rsvp/index.ts:320` dispatches the QR `rsvp_pass` gated ONLY on `result.status === "going"` — NOT on approval — so a pending guest gets their QR pass before the host approves.
- The host-approve RPC (`host_set_rsvp_status` / `host_bulk_approve_rsvps`, migration `20261004000000`) sends a no-QR `rsvp_approved` notice on approval — so the pass never rides the approval.
- The ORCH-1203 backfill `backfill_going_rsvp_qr_codes` gates on `rsvp_status='going'` only (not approval) → it too could mint+send a pending pass.

## Desired behavior
The QR `rsvp_pass` (the scannable entry pass) is delivered to a recipient (primary + each guest) **iff** their RSVP is `rsvp_status='going' AND approval_status='approved'**.
- **Auto-approve events** (`rsvp_approval_mode <> 'manual'`): resolve straight to going+approved → pass delivered immediately on submit (UNCHANGED behavior).
- **Manual-approval events:** submit → going+pending → NO pass yet. Host approves → pass delivered AT approval time (promptly, not via the 15-min cron).
- Never deliver a pass for pending / denied / waitlisted / maybe / not_going.

## Invariants
- **I-1:** QR pass delivered iff going AND approved. (No pending/denied/waitlisted/maybe/not_going pass.)
- **I-2:** On host approval (pending→approved, and waitlisted→approved→going), the pass is enqueued+delivered promptly at approval time.
- **I-3:** Exactly ONE QR pass per recipient across the whole lifecycle. submit, approve, and backfill MUST share a SINGLE idempotency keyspace for the pass so no recipient is ever double-sent. (Pick one canonical key, e.g. `rsvp_pass:<rsvpId>:<guestId|primary>`; retire/By-merge the ORCH-1203 `rsvp_pass_qr:` second keyspace into it, OR guarantee disjointness another way — but the end invariant is exactly-once.)
- **I-4:** Single-owner enqueue — ONE routine builds the rich `rsvp_pass` payload (recipientEmail/Name, qrCode, eventName, dateLine, venueLine, brandName, ids, role) for primary + each guest, reused by submit / approve / backfill. No third copy of the payload shape.
- **I-5:** QR mint stays single-owner via `biz_rsvp_mint_qr` (ORCH-1203). Mint may happen at submit (going) or lazily at approval — either is fine as long as the pass carries a non-null signed qr when delivered.

## Required changes
1. **`public-submit-rsvp/index.ts:~320`** — gate `dispatchRsvpPasses` on `result.status === "going" && result.approvalStatus === "approved"` (the RPC already returns `approvalStatus`). Manual-pending → skip.
2. **`host_set_rsvp_status` + `host_bulk_approve_rsvps`** (new migration; redefine via CREATE OR REPLACE, byte-faithful except the change; monotonic collision-free prefix) — on a transition INTO going+approved, enqueue the QR `rsvp_pass` for primary + each guest (mint via `biz_rsvp_mint_qr` if their qr is null) via the shared enqueue routine, with the canonical idempotency key (I-3). Keep or drop the plain `rsvp_approved` notice per least-surprise: the QR pass IS the approval confirmation, so prefer REPLACING `rsvp_approved` with the QR `rsvp_pass` on approval (don't send both). `rsvp_denied` / `rsvp_removed` unchanged.
3. **`backfill_going_rsvp_qr_codes`** (ORCH-1203; new migration redefine) — add `AND approval_status='approved'` to BOTH the primary and guest selection so the cron never sends a pending pass; align its idempotency key with the canonical keyspace (I-3).
4. Consider extracting a shared SQL routine `enqueue_rsvp_pass(p_rsvp_id)` (builds payload for primary+guests, mints qr if needed, inserts rsvp_notifications ON CONFLICT DO NOTHING) used by the approve RPC + backfill; the edge submit path keeps its TS enqueue but MUST use the same canonical key.

## Out of scope
- PDF renderers (correct). Auto-approve flow (unchanged). The rsvp_denied/removed notices.

## Tests (Step 0.5, both fails-on-revert)
- **Implementor happy-path:** (a) submit on a manual-approval event → going+pending → NO rsvp_pass enqueued; (b) host approve → exactly one QR rsvp_pass enqueued per recipient (with non-null qr); (c) auto-approve submit → pass still immediate; (d) backfill skips pending rows.
- **Tester adversarial:** pending/denied/waitlisted/maybe/not_going never yield a pass; approve→approve (re-run) / submit-then-approve / approve-then-backfill never double-send (single keyspace, ON CONFLICT); bulk-approve fans out one pass per approved rsvp; the approve RPC redefinition is byte-faithful to prod except the enqueue (capacity gate intact).

## Live verification (orchestrator, post-merge)
On prod: create a manual-approval RSVP event (or use one), submit a going RSVP → assert NO rsvp_pass row; host-approve via RPC → assert exactly one QR rsvp_pass enqueued + sent; re-approve → no double-send; clean up.
