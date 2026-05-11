# CLOSE NOTE — ORCH-0785

Date closed: 2026-05-11
Closed by: Claude `mingla-orchestrator` (operator delegated "take over")
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Head at close: `e7d7678f` ORCH-0785: silence docs-artifact-regression false-positive on private prompt link
PR: [#74 Close ORCH-0784 + ship ORCH-0785](https://github.com/Mingla-LLC/mingla-main/pull/74)

## Verdict

**PASS code-side.** QA verdict at
`Mingla_Artifacts/reports/QA_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
returned PASS with zero P0/P1/P2/P3 findings (4 P4 positive observations). Every
spec §12 success criterion SC-1..SC-14 and every §15 test matrix row T-01..T-14 +
RT-8..RT-12 is verified GREEN. MG-1..MG-6 real-fire gates are operator-assisted
LAUNCH operations, not CLOSE gates — they run after edge deploys, which run
after the operator clears the secrets + logo + DKIM unblock list.

## What shipped

A single shared Mingla brand shell + buyer ticket PDF renderer + three verified
senders + five CI gates now govern every customer-facing email Mingla sends
server-side. The Resend sandbox sender (`onboarding@resend.dev`) is permanently
rejected by `assertNotResendSandbox` and by the ORCH-0785-B strict-grep gate.

Files shipped (33 in the ORCH-0785 commit + 1 doc-link follow-up):

- `supabase/functions/_shared/email/` (new module): `escape`, `senders`, `copy`,
  `currency`, `dateLine`, `types`, `shell`, `ticketBody`, `genericBody`, `index`
  + 3 `__tests__` files (23 Deno tests).
- `supabase/functions/_shared/ticketPdf.ts` + `_shared/__tests__/ticketPdf.test.ts`
  (5 tests). pdf-lib + qrcode via esm.sh; one A4 page per ticket; 240pt QR; 5 MB
  size cap.
- `supabase/functions/ticket-confirmation-dispatch/index.ts` — branded email +
  PDF attachment; ORCH-0777 ledger contract preserved bit-for-bit.
- `supabase/functions/notify-dispatch/index.ts` — `emailVariant: "generic_notification"`
  opt-in; legacy plain-text path now routes through `EMAIL_SENDERS.system` with
  sandbox guard; `onboarding@resend.dev` fallback removed.
- `supabase/functions/admin-send-email/index.ts` — brand-shell toggle (default ON),
  CTA support, sandbox guard.
- `mingla-admin/src/pages/EmailPage.jsx` — brand-shell Toggle + Preview-modal callout,
  Step-4 setup help rewritten away from Resend sandbox.
- `supabase/functions/stripe-{kyc-stall-reminder,webhook-health-check}/index.ts` —
  both pass `emailVariant: "generic_notification"`.
- 8 misleadingly-named `send-*` functions stamped with ORCH-0785 rename-deferral
  header (spec §11; 9th file `send-pair-request-visible` does not exist in repo).
- 5 strict-grep gates + 5 workflow jobs (ORCH-0785-A..E).

## Verification evidence

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md`
- UI/UX design: `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
- QA: `Mingla_Artifacts/reports/QA_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`

## Local checks at close

- `for g in resend-attachment-aware no-resend-sandbox-fallback buyer-string-escape shell-singleton pdf-privacy; do node .github/scripts/strict-grep/orch-0785-$g.mjs; done` → all 5 exit 0.
- `deno test --allow-env --allow-read --allow-net supabase/functions/_shared/email/__tests__/ supabase/functions/_shared/__tests__/ticketPdf.test.ts` → 23 / 23 passed.
- `deno check` clean on `ticket-confirmation-dispatch`, `notify-dispatch`, `admin-send-email`, `stripe-kyc-stall-reminder`, `stripe-webhook-health-check`.
- DIAG marker reap for `[ORCH-0785-DIAG]`: zero matches.

## GitHub CI on PR #74 at close

Required-check set GREEN (`gh pr checks 74 --watch` exited 0). Includes:

- ORCH-0785-A..E (all 5 new gates)
- docs-artifact-regression
- Migrations apply cleanly from baseline
- ORCH-0776, ORCH-0776D, ORCH-0777, ORCH-0778, ORCH-0783, ORCH-0784 prior gates
- All I-PROPOSED-* prior gates
- Deno unit tests for Stripe shared modules
- GitGuardian Security Checks

Non-required failures (do not block merge per pre-merge gate condition 1):

- ORCH-0786 + ORCH-0787 strict-grep gates — expect parallel-track code still
  uncommitted on Seth; pre-existing and unrelated to ORCH-0785.
- Vercel × 3 — `Deployment rate limited — retry in 24 hours`.

## Deploy / launch operations (post-CLOSE; operator-gated)

ORCH-0785 ships no SQL migration and no mobile bundle change, so neither
`supabase db push` nor `eas update` is needed for this close. The remaining
launch operations are:

1. **Operator unblock list (BLOCKING for edge deploys + MG-1..MG-6):**
   - `supabase secrets set` six env vars (`MINGLA_LOGO_URL`,
     `MINGLA_LOGO_URL_2X`, `MINGLA_FOOTER_ADDRESS`, `RESEND_TICKET_FROM`,
     `RESEND_ADMIN_FROM`, `RESEND_SYSTEM_FROM`).
   - Publish logo at `https://usemingla.com/email-assets/mingla-logo.png` (+ `@2x.png`).
   - Confirm Resend DKIM/SPF/DMARC for `tickets@`, `hello@`,
     `notifications@usemingla.com`.

2. **Orchestrator-owned edge deploys (after operator clears 1):**
   ```bash
   supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy notify-dispatch                --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy admin-send-email               --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy stripe-kyc-stall-reminder      --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy stripe-webhook-health-check    --project-ref gqnoajqerqhnvulmnyvv
   ```

3. **Operator-assisted real-fire smoke (MG-1..MG-6):** free + paid ticket
   purchase real-fire, admin EmailPage send, `notify-dispatch` emailTo path,
   secrets verification, DKIM status verification.

## Invariants promoted on close

Four new invariants flip from DRAFT to ACTIVE (renumbered from spec §14 to
avoid collision with already-allocated I-PROPOSED-AD..AG identifiers):

- **I-PROPOSED-AM EMAIL_BRAND_SHELL_SINGLETON** — every customer-facing email
  flows through `_shared/email/`; no `<!doctype html>` outside `_shared/email/**`.
  CI gate: ORCH-0785-D.
- **I-PROPOSED-AN RESEND_NO_SANDBOX_SENDER** — `*@resend.dev` rejected by
  `assertNotResendSandbox`. CI gate: ORCH-0785-B + runtime guard.
- **I-PROPOSED-AO BUYER_INPUT_HTML_ESCAPED** — every buyer/event/brand/order
  string interpolated into HTML flows through `escapeHtml`. CI gate: ORCH-0785-C.
- **I-PROPOSED-AP TICKET_PDF_PRIVACY** — PDF excludes `qr_token_hash`, QR pepper,
  Stripe payment IDs, buyer phones. CI gate: ORCH-0785-E.

## Discoveries promoted to follow-up ORCHs

1. `send-pair-request-visible` named in spec §11 does not exist in the repo;
   8 of 9 files stamped. **No new ORCH required** — spec is the documentation
   discrepancy, not the code.
2. `MINGLA_LOGO_URL_2X` is read but not yet wired into the shell `<img srcset>`.
   **Follow-up ORCH** (low priority) to add retina `srcset` markup once 1x is
   in production.
3. Pre-existing `pushPayload as unknown as Parameters<typeof sendPush>[0]` cast
   in `notify-dispatch` papers over a real `PushPayload` type drift. **Out of
   scope for ORCH-0785**; absorb into the next push-related ORCH or a META-ORCH.

## Status delta

- ORCH-0785: REGISTERED 2026-05-11 → INVESTIGATION COMPLETE → SPEC COMPLETE →
  IMPLEMENTATION COMPLETE → QA PASS code-side → **CLOSED CODE-SIDE 2026-05-11**.
- Outstanding LAUNCH operations: edge deploys + MG-1..MG-6 (operator-gated).
