# CLOSE NOTE — ORCH-0789 + ORCH-0790 + ORCH-0791 (combined)

**Closed:** 2026-05-11.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Closing skill:** Claude `mingla-orchestrator` (delegated execution end-to-end).

## What the operator reported

Two original symptoms from the public Party Block buyer page, both surfacing as the same red "Card declined — try another payment method" toast:

1. iPhone: tapping Pay then closing the Stripe sheet without entering a card produced the toast, which then could not be dismissed and the screen felt frozen.
2. Web browser: tapping Pay on any event hit a hard block reading "Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app."

Mid-investigation the operator added: "the error card declined try another payment method I got earlier, always happens after I just gave a refund." That clue split the diagnosis into three distinct mechanisms — and the close bundles all three because they all surface through the same toast.

## Why three ORCHs

The toast looks identical in every case but the mechanism is different per case. Closing them together makes the operator-facing story coherent ("no more fake card-declined errors anywhere") while keeping the per-ORCH spec/investigation/implementation chain auditable for future forensics.

| ORCH | Mechanism | Layer fixed |
|------|-----------|-------------|
| 0789 | Stripe's user-cancel returned `Canceled` but our wrapper threw away the discriminator; payment screen treated every error as a decline; Toast had no dismiss affordance on iPhone | Toast primitive + Stripe wrapper + payment.tsx error-code branching |
| 0790 | No web payment integration existed; web buyers hit an inline "use the mobile app" block | New Stripe Checkout Sessions web branch in `ticket-checkout-create` + payment.tsx web-redirect + confirm.tsx cold-resume + sessionStorage persistence (+ migration adding `awaiting_web_redirect` status + `stripe_checkout_session_id` column) |
| 0791 | RPC `biz_ticket_checkout_create_session` returned existing sessions unconditionally on idempotency-key match, including post-refund `paid_completed` rows; Stripe then reused the refunded PaymentIntent and rejected re-confirmation with a real `Failed` | RPC adds terminal-status branch that tombstones the old `idempotency_key` so a fresh session UUID is generated |

## Evidence

- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` + `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0791_REPURCHASE_AFTER_REFUND_FAILS.md`.
- **Specs:** `Mingla_Artifacts/specs/SPEC_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` + `Mingla_Artifacts/specs/SPEC_ORCH-0791_REPURCHASE_AFTER_REFUND_FAILS.md`.
- **Implementations:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` + `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` + `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0791_REPURCHASE_AFTER_REFUND_FAILS.md`.
- **QA reports:** `Mingla_Artifacts/reports/QA_ORCH-0789_AND_0790_*.md` (initial FAIL) + `Mingla_Artifacts/reports/QA_RETEST_ORCH-0789_AND_0790_*.md` (post-rework PASS).
- **Live-fire smoke:** operator-witnessed 2026-05-11 on iPhone — three native smokes (silent cancel, dismissible decline, success path) all passed; refund→repurchase smoke passed end-to-end after `supabase db push` applied `20260520000002`.
- **Live edge verification:** `ticket-checkout-create` with `surface: "web"` returned a real Stripe-hosted `cs_test_…` URL, proving the RAK has `checkout_sessions:write` scope and `MINGLA_PUBLIC_WEB_BASE_URL` is wired.
- **SQL probe (post-push):** `SELECT pg_get_functiondef(...)` on `biz_ticket_checkout_create_session` returned `has_tombstone: true, has_terminal_check: true` — the ORCH-0791 RPC body is live on remote.

## Migrations shipped

- `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql` — adds `awaiting_web_redirect` to the `ticket_checkout_sessions.status` CHECK + new `stripe_checkout_session_id` column.
- `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql` — recreates `biz_ticket_checkout_create_session` with the terminal-state-tombstone branch.

Both applied to remote via `supabase db push --linked` by operator.

## Edge functions deployed

- `ticket-checkout-create` → version 21 (verify_jwt: true preserved). Source `supabase/functions/ticket-checkout-create/index.ts`.
- `stripe-webhook` → version 32 (verify_jwt: false preserved — webhooks must not verify JWT). Source `supabase/functions/stripe-webhook/index.ts`. Webhook router gained `checkout.session.completed` handler + metadata-fallback in the PI handler.

Both deployed via `/Users/sethogieva/bin/supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv`; versions verified via `mcp__supabase__list_edge_functions`.

## Secrets / env changes

- `MINGLA_PUBLIC_WEB_BASE_URL` set to `https://business.usemingla.com` (canonical Vercel-hosted Expo Web export domain, per `mingla-business/app.config.ts:92-96`).
- `STRIPE_RAK_TICKET_CHECKOUT` permission scope upgraded by operator to include `checkout_sessions:write` (in addition to existing `payment_intents:write`).

## Invariants promoted DRAFT → ACTIVE

- **I-PROPOSED-AU ERROR_TOAST_DISMISSIBLE** — every `<Toast kind="error">` must be user-dismissible without external state changes. Enforced by `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` §1–§3 + `Toast.test.tsx`.
- **I-PROPOSED-AV STRIPE_ERROR_CODE_DISCRIMINATED** — the Mingla Business Stripe wrapper preserves `PaymentSheetError.code` (`"Canceled" | "Failed" | "Timeout"`) through to callers. Enforced by `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` §4–§5 + `stripePaymentSheet.test.ts`.
- **I-PROPOSED-AW CHECKOUT-SESSION-NEVER-REUSED-POST-TERMINAL** — `biz_ticket_checkout_create_session` MUST NOT return an existing session row whose status is terminal; tombstone the row's `idempotency_key` and create a fresh session. Enforced by `.github/scripts/strict-grep/orch-0791-checkout-session-never-reused-post-terminal.mjs`.

## DIAG-marker reap (Step 1.5)

```bash
grep -rn "\[ORCH-0789-DIAG\]\|\[ORCH-0790-DIAG\]\|\[ORCH-0791-DIAG\]" \
  mingla-business/src/ mingla-business/app/ supabase/functions/ supabase/migrations/ .github/scripts/
```

Returned ZERO matches. No DIAG markers were added during this dispatch; nothing to reap.

## Test-mode caveat

The `STRIPE_RAK_TICKET_CHECKOUT` secret is currently bound to a **test-mode** restricted key (the live verification call returned `cs_test_…`). Production launch will require minting a live-mode RAK with the same permission set (`payment_intents:write` + `checkout_sessions:write`) and overwriting the Supabase secret. Test-mode is appropriate for `business.usemingla.com` during pre-launch verification; the flip to live mode is operator-owned at launch time.

## Follow-ups registered

- **ORCH-0792** — a separate, parallel work stream (event-dates backfill) failed mid-chain during the operator's `supabase db push` (migration `20260525000001_orch_0792_backfill_event_dates_from_theme.sql` raised `SQLSTATE 22023: cannot get array length of a scalar`). Root cause is an unguarded `jsonb_array_length` on a value that may be a JSON scalar. Not part of this close; surface to the originating session/agent or schedule a fix dispatch.
- **DISC-IMPL-2 / DISC-TEST-4** — `@testing-library/react-native` not installed in `mingla-business/`; SPEC §5 render tests T-04..T-12 are deferred to a follow-up sub-ORCH that adds the test-infra. Live-fire simulator smoke covered the gap for this close.
- **DISC-TEST-DISC-3** — orphan client-cancelled PaymentIntents from native cancel paths linger until 1h Stripe auto-expiry. Not blocking; P2 sub-ORCH candidate.
- **DISC-RETEST-2 / DISC-IMPL-0791-1** — free-ticket repurchase post-finalise is untraced. P3 sub-ORCH candidate only if a buyer ever reports a related issue.
- **DISC-IMPL-0791-4** — production launch requires Stripe live-mode RAK swap (see "Test-mode caveat" above).
- **Pre-existing `orch-0776a-video-upload-progress-honesty` strict-grep gate** failing on `Seth` unrelated to this dispatch — needs its own ORCH.

## What operator needs to do post-close

1. Commit the working tree (commit message below).
2. Push to `Seth`.
3. Open the PR from `Seth` → `main` and merge per the pre-merge gate.
4. Ship the iOS + Android OTA updates so existing users get the dismissible-toast + cancel-as-silent behavior immediately.

(Migrations are already on remote; edge functions are already deployed; the only remaining surface is the mobile JS bundle.)
