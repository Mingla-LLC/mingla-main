# SPEC — ORCH-1203 GAP-C1: "every going RSVP always gets a signed QR pass"

**Status:** APPROVED (orchestrator) — Seth: "harden it then close properly" (2026-06-22).
**Type:** backend-only hardening. No client UI. No PDF-renderer change (the renderers already embed + guard the QR — proven in `investigations/INVESTIGATE_ORCH-1203_QR_ON_ALL_PDFS.md`).

## Problem (GAP-C1, from the investigation)
`public-submit-rsvp/index.ts:~225-234` tolerates a missing QR pepper: it logs and
proceeds with `qrPepper=null` so the RSVP write never hard-fails. The RPC
`submit_event_rsvp` mints the signed `qr_code` only when `v_status='going' AND
p_qr_token_pepper IS NOT NULL`. So if the pepper were ever unset, a `going` RSVP
(primary or guest) would be written with `qr_code=NULL` → `rsvp-notify
handleRsvpPass` gates the QR-PDF email on `qrCode !== null` → **no pass ever sent**.
This is fail-OPEN, the opposite of the ticket path (which aborts the whole finalize
txn when the pepper is missing — `biz_ticket_checkout_assert_qr_pepper`).
Zero live blast radius today (pepper IS configured), but nothing guarantees it stays.

## Invariants (must hold after this change)
- **I-1:** A non-blocking RSVP submission stays non-blocking — a missing pepper MUST
  NOT prevent the guest from RSVPing. (Preserve current UX.)
- **I-2:** Every `going` RSVP (in `event_rsvps`) and every `going` RSVP guest (in
  `event_rsvp_guests`) ENDS UP with a non-null, **scan-valid** signed `qr_code`
  whenever the pepper is present — inline at submit when possible, else via backfill.
- **I-3:** Exactly ONE QR-bearing `rsvp_pass` is delivered per going RSVP/guest. A
  prior push-only / passless attempt (made while qr was null) MUST NOT block the
  later QR-bearing pass, and the backfill MUST NOT double-send once a QR pass has
  gone out.
- **I-4:** Single source of truth for the QR signing expression — the backfill MUST
  reuse the EXACT signing used by `submit_event_rsvp` (so `scan-ticket`/RSVP-entry
  scan validates it). Do NOT invent a second QR format. Prefer extracting the mint
  into a shared SQL routine that BOTH submit and backfill call.

## Required changes

### C-1 — Ops alert on missing pepper (visibility)
In `public-submit-rsvp/index.ts` where the missing-pepper branch currently logs +
proceeds: keep the non-blocking write (I-1) but upgrade the silent `console.*` to an
ops alert via the existing `sendOpsAlertEmail` helper (the same one ORCH-1201 uses —
locate its `_shared` path) so a pepper misconfig is caught immediately. Guard the
alert so it can't throw and break the RSVP path (wrap in try/catch, swallow).

### C-2 — Idempotent backfill (the guarantee)
New migration (monotonic, collision-checked version prefix — scan active worktrees +
`supabase/migrations/` for the max prefix) adding a SECURITY DEFINER function
`public.backfill_going_rsvp_qr_codes()` that:
1. No-ops if the pepper is absent (returns 0).
2. Mints the signed `qr_code` for `event_rsvps` (rsvp_status='going', qr_code IS NULL)
   and `event_rsvp_guests` (going, qr_code IS NULL) using the SHARED signing routine
   (I-4). Idempotent: only NULL rows are touched.
3. For each newly-minted row, enqueues a QR-bearing `rsvp_pass` notification with the
   same payload shape `handleRsvpPass` consumes (recipientEmail, recipientName,
   qrCode, eventName, dateLine, venueLine, brandName, role, ids…). Reuse the SAME
   enqueue logic the going path uses (extract/share if needed). Use a stable
   idempotency key for the QR pass (e.g. `rsvp_pass_qr:<rsvp_id|guest_id>`) so re-runs
   never double-send AND a prior push-only attempt doesn't suppress the QR pass (I-3).
4. Returns the count minted.
5. Wire to pg_cron (reuse the every-15-min cadence pattern, e.g. alongside
   `orch_1161_notify_reminders`) calling the function via `net.http_post` to a tiny
   edge fn OR directly if it's pure SQL. Prefer direct SQL invocation if possible.
   `REVOKE EXECUTE … FROM anon, PUBLIC`.

## Out of scope
- Manual-approval RSVPs sending the QR pass while `pending` then a QR-less `approved`
  notice — separate product-policy question, noted in the World Map, NOT this ORCH.
- Any PDF renderer change (already correct).

## Tests (Step 0.5 — both fails-on-revert)
- **Implementor happy-path:** prove (a) C-1 emits the ops alert + still writes the RSVP
  when pepper missing; (b) `backfill_going_rsvp_qr_codes()` mints a scan-valid qr for a
  going row with NULL qr (pepper present) and enqueues exactly one QR `rsvp_pass`; (c)
  idempotent — second run mints 0, enqueues 0.
- **Tester adversarial:** missing pepper → backfill no-ops (0), no crash; a going row
  that already has a qr is never re-minted; a prior push-only pass does NOT suppress the
  QR pass; not_going/maybe rows are never minted; signing matches `submit_event_rsvp`
  (shared routine, not a copy); double-run / concurrent-run no double-send.

## Live verification (orchestrator, post-merge)
On prod: synthesize a going RSVP with qr_code forced NULL → run
`backfill_going_rsvp_qr_codes()` → assert qr minted + one `rsvp_pass` outbox row →
drain → `done` → clean up. Confirm maybe/not_going untouched.
