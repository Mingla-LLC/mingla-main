# INVESTIGATE — ORCH-1203: every confirmation PDF (event / RSVP / trip / experience) carries its scannable QR

Mode: INVESTIGATE (read-only). No product code modified. Nothing staged/committed. Throwaway Deno harness rendered + inspected real PDFs, then deleted.

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/orch-1203-[qr-on-all-pdfs]`
Live DB: `gqnoajqerqhnvulmnyvv`

---

## 1. Runtime QR-embedding proof (real renderers)

Harness imported the REAL `buildTicketPdf` / `buildRsvpPassPdf` from `supabase/functions/_shared/ticketPdf.ts`, rendered one sample per type, reloaded the saved PDF bytes with pdf-lib, and counted `/Subtype /Image` XObjects + their pixel dimensions. The QR is drawn from a 480px PNG (`qrPayloadAsPngBytes`, `width: 480`).

Run: `deno run --allow-net --allow-env --allow-read <harness>` (matches the deno flags `ticketPdf.test.ts` runs under). All PASS.

| Type | Renderer | Pages | Image XObjects | QR raster | Verdict |
|------|----------|-------|----------------|-----------|---------|
| EVENT ticket | buildTicketPdf | 1 | 1 | 480×480, 9187 B | PASS — QR embedded |
| TRIP ticket | buildTicketPdf | 1 | 1 | 480×480, 8921 B | PASS — QR embedded |
| EXPERIENCE ticket | buildTicketPdf | 1 | 1 | 480×480, 9193 B | PASS — QR embedded |
| RSVP pass | buildRsvpPassPdf | 1 | 1 | 480×480, 8756 B | PASS — QR embedded |
| EVENT + failing logoUrl | buildTicketPdf | 1 | 1 | 480×480, 8789 B | PASS — QR survives logo fetch failure |

The 480×480 image XObject is the QR (the only raster the renderers draw; the wordmark falls back to text "Mingla" when no/failed logoUrl). 2(d) is answered by the last row: a failed logo fetch falls back to text and the QR still renders.

---

## 2. Gap hunt

### (a) Any path that attaches a NON-QR PDF, or sends a confirmation with NO PDF?

NO gap. Traced both dispatchers fully.

- `ticket-confirmation-dispatch/index.ts` is the SOLE buyer-confirmation sender for event/trip/experience. The `buyer_ticket_confirmation` email branch (index.ts:1115-1163) is type-agnostic and HARD-REQUIRES the QR PDF: if `renderedPdf` is null it throws a retryable error (index.ts:1118-1126) and the email never sends. The only PDF attached is `renderedPdf` (index.ts:1128-1131) = the `buildTicketPdf` output. Trip/experience only change the email BODY (`renderTripConfirmationEmail` / `renderExperienceConfirmationEmail`, index.ts:863-974); the PDF attachment is the same single `buildTicketPdf` call (index.ts:976-990).
- All `attachments: []` branches (index.ts:1215/1261/1314/329, plus installment/refund/cancel/waitlist/intake-reanswer) are NON-confirmation notices (refund, cancel, waitlist-open, re-answer, dunning, paid-in-full) — correctly carry no QR. None is a ticket/RSVP confirmation.
- The `.ics` calendar attachment (index.ts:1143-1148) is additive, never a substitute for the ticket PDF.
- Free orders: `variant = ticket_confirmation_free` (index.ts:471-473) changes only copy; the same `buildTicketPdf` + attach path runs. Free orders still mint tickets (see (b)).
- Experience no-stops / Ari path: `renderExperienceConfirmationEmail` degrades gracefully with no itinerary (index.ts:919-964), then the SAME `buildTicketPdf` attaches the QR. No special-casing drops the PDF.
- `reconcile-stuck-checkouts` invokes dispatch with `skipNotify:true` (reconcile/index.ts:124-125) — renders + stores the PDF but intentionally sends NOTHING (index.ts:1055-1062). Not a delivered-confirmation path; no missing-QR exposure.

### (b) Could `ticketsForPdf` ever be EMPTY for a real paid/confirmed trip or experience order?

NO — structurally impossible for a committed order, and live DB confirms zero exposure.

- All three types finalize through ONE type-agnostic RPC `biz_ticket_checkout_finalize_session` (`supabase/migrations/20261117000001_orch_1188_finalize_persist_event_date_id.sql`). It mints one `tickets` row per `quantity` unit for every `ticket_checkout_session_items` row (migration:251-285), with `qr_code = biz_ticket_checkout_qr_payload(...)` always populated. No event_type branch — trip/experience mint tickets identically to events.
- The QR is FAIL-CLOSED on the pepper: finalize calls `biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper)` (migration:66), which RAISES `qr_token_pepper_missing` when the pepper is missing/short/placeholder (`20260515000016_orch_0777_qr_pepper_service_role_rpc.sql:18-22`). A missing pepper aborts the whole finalize transaction — so a NULL-QR ticket can never be committed.
- `ticketsForPdf` is built from a `tickets` query with `ticket_types!inner` (dispatch index.ts:801-805). The INNER join would drop a ticket lacking a ticket_type — but live DB shows 0/184 tickets with NULL ticket_type, and the finalize always sets `ticket_type_id` from the session item (migration:268-274). Risk is theoretical only.
- LIVE DB queries (all clean):
  - Paid/confirmed orders with ZERO ticket rows: event 0/40, experience 0/2, trip 0/27.
  - Tickets with NULL/empty qr_code: 0 of 93 event + 87 trip + 4 experience.
  - Tickets with NULL ticket_type_id: 0.
  - Completed checkout sessions with zero session-items: 0 of 66.

### (c) Does a `going` RSVP reliably enqueue an `rsvp_pass` with `qrCode` populated?

MOSTLY solid; ONE fail-open env-dependent gap.

Trace: `public-submit-rsvp/index.ts` calls RPC `submit_event_rsvp` (index.ts:236-246), then on `result.status === "going"` runs `dispatchRsvpPasses` (index.ts:282-288), which reads `event_rsvps.qr_code` (primary, index.ts:320/393-395) + `event_rsvp_guests.qr_code` (index.ts:371/408-410) and enqueues one `rsvp_pass` row per recipient with `payload.qrCode` (index.ts:418-461). In `rsvp-notify/index.ts:handleRsvpPass`, the EMAIL channel (which builds + attaches the pass PDF) is gated on `recipientEmail !== null && qrCode !== null` (index.ts:393-394). If `qrCode` is null → email channel is null → NO pass PDF (push-only at best, none for link-guests).

The RPC `submit_event_rsvp` (`20261016000001_orch_1163_event_rsvp_guests.sql`) mints the primary + per-guest signed `mingla:v1:rsvp:` qr_code ONLY when `v_status = 'going' AND p_qr_token_pepper IS NOT NULL` (migration:360, 373). This is the contrast with the ticket path:

- **GAP-C1 (fail-open, env-dependent):** `public-submit-rsvp/index.ts:225-234` resolves the pepper via `qrTokenPepper()` and, on throw, logs and proceeds with `qrPepper = null` (DEC: RSVP write must not hard-fail). The RPC then writes a `going` row with `qr_code = NULL`. The pass dispatch reads `qrCode: null` → no entry-pass PDF is ever sent for that going RSVP. Unlike tickets (which RAISE and abort), the RSVP path is fail-OPEN: the RSVP succeeds but silently ships no QR pass. Root cause = the asymmetry between `assert_qr_pepper` (raises) on the ticket side and the null-pepper-tolerated path on the RSVP side. Blast radius today = 0 (live pepper is configured; see below), but it is the only way a going RSVP yields no QR pass.

- **Manual-approval observation (NOT a missing-QR gap):** when `rsvp_approval_mode = 'manual'`, the RPC sets `approval_status = 'pending'` but still sets `v_status = 'going'` (capacity-driven, migration:284-309) and STILL mints the qr_code (gate is `v_status='going'`, not approval, migration:373). `dispatchRsvpPasses` fires on `result.status === "going"`, so the entry QR pass is emailed BEFORE the host approves. That is a product-policy question (premature pass on a pending RSVP), not a missing-QR defect, and is out of ORCH-1203 scope. There is NO separate QR-pass send on later host approval — the `rsvp_approved` template (rsvp-notify index.ts:114-121) is a plain no-attachment notice. So if a future change gated the pass to fire only after approval, the approval path would need to (re)send the pass; today it is not gated that way, so no gap.

- Waitlisted (capacity full): `v_status = 'waitlisted'`, no qr minted, `dispatchRsvpPasses` not fired. Correct by design (not going → no entry pass).

- LIVE DB (clean today): going primary RSVPs = 1, NULL qr_code = 0 (auto-approval, approved). Going guest rows = 1, NULL qr_code = 0. No going/approved RSVP or guest currently lacks a qr_code.

### (d) Is the QR fallback-safe if logo fetch (or anything) fails?

YES. Proven at runtime (table row 5): a logoUrl that fails to fetch falls back to the text "Mingla" (ticketPdf.ts:120-130 / 317-327, try/catch → `logoImage = null`) and the QR still embeds (480×480). The QR draw (ticketPdf.ts:238-243 / 415-420) is after and independent of the logo. RSVP additionally fail-closes the OTHER direction: `buildRsvpPassPdf` throws `rsvp_pass_pdf_no_qr` if `qrPayload` is empty (ticketPdf.ts:307-309) — it will never produce a QR-less pass; the email channel just won't send.

---

## 3. Verdict per type

| Type | QR-on-PDF | Notes |
|------|-----------|-------|
| EVENT | SOLID | Single fail-closed finalize mints QR ticket; dispatch hard-requires the QR PDF; runtime + live DB clean. |
| TRIP | SOLID | Same finalize + same `buildTicketPdf` attach; trip email body differs only. 0 paid trip orders with zero tickets. |
| EXPERIENCE | SOLID | Same finalize + same `buildTicketPdf`; no-stops/Ari path degrades email body only, QR PDF still attached. |
| RSVP | SOLID for the live config; one fail-open env edge (GAP-C1) | When the QR pepper is present (current prod), every going RSVP mints a qr_code and the pass PDF carries the QR. If the pepper is unavailable, the RSVP still writes `going` but the pass PDF is silently never sent (fail-open), unlike the fail-closed ticket path. |

VERDICT: **1 gap** (GAP-C1, RSVP-only, env-dependent fail-open; zero live blast radius today). Event/trip/experience QR-on-PDF = airtight.

Minimal fix surface for GAP-C1 (if the orchestrator wants the RSVP path to match the ticket path's guarantee):
- Make the going-RSVP pepper requirement fail-closed for the pass (not the RSVP write): EITHER raise/abort the qr mint inside `submit_event_rsvp` when `v_status='going'` and pepper is null (so a going RSVP can't commit without a qr_code), OR keep the write but add a backfill/alert path so a NULL-qr going RSVP is re-minted + the pass re-dispatched once the pepper is restored. File: `public-submit-rsvp/index.ts:225-234` (the null-pepper tolerance) + `20261016000001_orch_1163_event_rsvp_guests.sql:360,373` (the `p_qr_token_pepper IS NOT NULL` gate). No change needed to the PDF renderers — they already embed/guard the QR correctly.

---

## Hygiene
- Throwaway harness `supabase/functions/_shared/__tests__/_orch1203_qr_harness.ts` was created, run, and DELETED.
- Nothing staged or committed (`git status` clean of new tracked changes from this investigation).
- No product code modified.
