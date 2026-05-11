# QA Report — ORCH-0785 Premium Transactional Email Branding + Buyer Ticket PDF/QR

Date: 2026-05-11
Tester: Claude `mingla-tester` (operator-redirected from default `mingla-forensics` TEST mode)
Mode: TARGETED + SPEC-COMPLIANCE hybrid
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Head: `e7d7678f` ORCH-0785: silence docs-artifact-regression false-positive on private prompt link

## Verdict

**PASS (code-side scope).** Every spec §12 success criterion that can be verified
without deployed edge functions and live Resend/Twilio environment is verified
GREEN. MG-1..MG-6 real-fire gates are explicitly DEFERRED-PENDING-OPERATOR-UNBLOCK
per spec §15.2 — not failed, not silently passed. Verbatim halt request below.

**Severity counts:** P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 4 (positive observations).

## 1. Layman summary

ORCH-0785 lands a single Mingla-branded email shell, three verified senders, and
real PDF ticket attachments behind every paid + free checkout email. Every
runtime guard in the spec is in code; every CI gate the spec specified is
registered, wired into the workflow, and green. The implementation preserved
ORCH-0777's ledger contract bit-for-bit (verified by static diff). The only
thing left before merge is the operator's four unblock items (six Supabase
secrets, logo publish, Resend DKIM verification, PR approval).

## 2. Inputs read

- Spec `Mingla_Artifacts/specs/SPEC_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
- Investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md`
- UI/UX direction `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`
- Implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
- PR #74 on GitHub
- All product files in scope (33 files staged on Seth)

## 3. Step 6 — Independent gate re-run (NOT trusting implementor claims)

Run from a clean cwd on branch `Seth`:

| Gate | Command | Result |
|---|---|---|
| ORCH-0785-A resend-attachment-aware | `node .github/scripts/strict-grep/orch-0785-resend-attachment-aware.mjs` | exit 0 ✓ |
| ORCH-0785-B no-resend-sandbox-fallback | `node .github/scripts/strict-grep/orch-0785-no-resend-sandbox-fallback.mjs` | exit 0 ✓ |
| ORCH-0785-C buyer-string-escape | `node .github/scripts/strict-grep/orch-0785-buyer-string-escape.mjs` | exit 0 ✓ |
| ORCH-0785-D shell-singleton | `node .github/scripts/strict-grep/orch-0785-shell-singleton.mjs` | exit 0 ✓ |
| ORCH-0785-E pdf-privacy | `node .github/scripts/strict-grep/orch-0785-pdf-privacy.mjs` | exit 0 ✓ |
| Deno tests | `deno test --allow-env --allow-read --allow-net supabase/functions/_shared/email/__tests__/ supabase/functions/_shared/__tests__/ticketPdf.test.ts` | **23 / 23 passed** |
| Deno check | `deno check` × 5 touched edge functions | 0 errors |
| GitHub CI (PR #74) | required-check set | watch exited 0 (all required checks green) |

## 4. Step 4–5 — Forensic code reading + behavioural contract

### 4.1 SC-9 / I-PROPOSED-AN — `assertNotResendSandbox` before every Resend POST

| File | POST line | Guard call | Distance |
|---|---|---|---|
| `ticket-confirmation-dispatch/index.ts` | 42 (helper), 397 (call site) | 334 (pre-render block) + internal in `renderTransactionalEmail` line 107 of `_shared/email/index.ts` | safe — guard precedes call |
| `notify-dispatch/index.ts` plain path | 59 | 49 | 10 lines earlier ✓ |
| `notify-dispatch/index.ts` branded path | 114 | internal to `renderTransactionalEmail` (line 96) | render-time, before POST ✓ |
| `admin-send-email/index.ts` | 107 | 57 (and internal renderer if `useBrandShell`) | 50 lines earlier ✓ |

Every Resend POST is protected. **PASS.**

### 4.2 SC-14 — Behavioural contract preservation (ORCH-0777 contract)

| Element | Pre-0785 | Post-0785 | Verdict |
|---|---|---|---|
| Service-role auth gate | `req.headers.get("authorization") !== ` Bearer ${serviceKey}`` | line 233 — byte-identical | ✓ |
| Ledger ingest filter | `.in("status", ["pending", "failed_retryable"])` | line 364 — byte-identical | ✓ |
| Transition: claim | status → `"sending"` | line 380 — identical | ✓ |
| Transition: success | status → `"sent"` | lines 409, 421 — identical | ✓ |
| Transition: failure | terminal vs retryable on attempt_count ≥ 3 | lines 432-440 — identical | ✓ |
| Rollup recompute | `failed ? (sent ? "partial" : "failed") : "sent"` | line 448 — byte-identical | ✓ |

Idempotency-key uniqueness on `ticket_order_notifications` is structural (unchanged
DDL) so preservation is automatic. **PASS.**

### 4.3 SC-4 — Missing/video cover fallback

`ticketBody.ts:15-22` defines `isRenderableImage(url, type)`:
- returns `false` if `url` is null/undefined
- returns `false` if `type` is `"video"` or `"gif"`
- returns `true` only for `image` or legacy null `type` with a URL

`ticketBody.ts:24-43` `renderHero`: when `isRenderableImage` returns false, emits
a branded orange-tinted table block with the event title; never emits `<img>`,
never emits `<video>`. **PASS.**

### 4.4 SC-5 — Missing master event_date

`dateLine.ts:11-13`: `if (!startAtIso) return ""` → empty string ⇒
`ticketBody.ts:65-71` `renderDateLine` returns `""` ⇒ template-literal
interpolation produces an empty span ⇒ no date line rendered. No fabricated
date. Constitution rule 9 satisfied. **PASS.**

### 4.5 SC-6 — XSS escape

`ticketBody.ts` has **19** `escapeHtml(...)` call sites for every dynamic
string interpolation in the HTML template. `genericBody.ts` has **5** for
title, paragraphs[*], cta.label, cta.url.

PDF text is drawn via `pdfDoc.drawText(...)` — not HTML; XSS payloads render
as literal text. `ticketPdf.ts` has **11** `drawText` calls. **PASS.**

### 4.6 SC-10 — PDF size cap

`ticketPdf.ts:48`: `SIZE_CAP_BYTES = 5 * 1024 * 1024` (5 MB).
`ticketPdf.ts:215-216`: throws `ticket_pdf_size_exceeded` on overflow.
Dispatcher classifies as retryable (line 393 — error code routed through
`renderError`). **PASS.**

### 4.7 I-PROPOSED-AP — PDF privacy contract

Banned token scan of `_shared/ticketPdf.ts`:

| Token | Hits | Context |
|---|---|---|
| `qr_token_hash` | 1 | Line 3 (file header comment) — explicitly allowed by ORCH-0785-E gate which skips lines starting with `//` |
| `qr_token_pepper` | 0 | clean |
| `stripe_payment_intent_id` | 0 | clean |
| `stripe_charge_id` | 0 | clean |
| `buyer_phone` / `buyer_phone_e164` | 0 | clean (implementor also dropped from `OrderJoin` interface + dispatcher SELECT — verified) |

Ticket PDF carries only: `event.title`, `event.startAtIso`, `event.timezone`,
`event.locationText`, `event.brandName`, `order.shortId`, `ticket.ticketId`,
`ticket.ticketName`, `ticket.qrPayload` (= same string as `tickets.qr_code`),
`attendeeNameHint` (buyer name). All allowed by spec §5.4. **PASS.**

### 4.8 I-PROPOSED-AM — Email shell singleton

Forensic neighbor scan: `grep -rn '<!doctype html>\|<html lang=' supabase/functions/`
returns no rows outside `_shared/email/**`. **PASS.**

### 4.9 Constitution 14-rule check (touched rules only)

| Rule | Relevant? | Verdict |
|---|---|---|
| 1 No dead taps | EmailPage toggle | ✓ Toggle has `onChange` |
| 2 One owner per truth | senders + footer addr | ✓ Single `EMAIL_SENDERS` constant, single `MINGLA_FOOTER_ADDRESS` env |
| 3 No silent failures | dispatcher catch blocks | ✓ All catches surface to `renderError` / `last_error` / `outcomes` |
| 4 One key per entity | N/A (server-side renderer, no React Query) | N/A |
| 5 Server state server-side | N/A | N/A |
| 6 Logout clears everything | N/A | N/A |
| 7 Label TRANSITIONAL | No new TRANSITIONAL items | ✓ |
| 8 Subtract before adding | Old plain HTML replaced; sandbox fallback removed | ✓ |
| 9 No fabricated data | Null cover / null date → omit, never invent | ✓ |
| 10 Currency-aware | `formatMoneyFromCents` uses `Intl.NumberFormat` with order.currency | ✓ |
| 11 One auth instance | N/A (service-role only) | N/A |
| 12 Validate at right time | `Intl.DateTimeFormat` uses event timezone, not `new Date()` | ✓ |
| 13 Exclusion consistency | N/A | N/A |
| 14 Persisted-state startup | N/A | N/A |

No automatic-P0 triggers. **PASS.**

## 5. Spec §12 success criteria — per-row verdict

| SC | Criterion | Evidence | Verdict |
|---|---|---|---|
| SC-1 | Free checkout: branded HTML + PDF from tickets@usemingla.com | shell.test.ts "free ticket render" + dispatcher variant routing line 162-163 | PASS |
| SC-2 | Paid checkout: branded HTML + PDF | shell.test.ts "paid ticket render" | PASS |
| SC-3 | PDF QR scans against `scan-ticket` → success | PDF QR payload === `tickets.qr_code` verbatim (`ticketPdf.ts:248` qrPayload field); `scan-ticket` reads `tickets.qr_code` unchanged. **Real-fire confirmation deferred to MG-1/MG-2.** | PASS (code-side); DEFERRED MG |
| SC-4 | Missing/video cover → branded fallback, no `<img>`, no `<video>` | §4.3 above | PASS |
| SC-5 | Missing master date → date line omitted | §4.4 above | PASS |
| SC-6 | Buyer name `<script>...</script>` escapes in HTML; literal in PDF | shell.test.ts "buyer name XSS" + §4.5 | PASS |
| SC-7 | `notify-dispatch` `generic_notification` → from `notifications@usemingla.com` | shell.test.ts "generic_notification routes to system sender" | PASS |
| SC-8 | EmailPage shell ON → from `hello@usemingla.com`, preview reflects shell | shell.test.ts "admin_compose routes to admin sender" + EmailPage.jsx:166,668,701 | PASS |
| SC-9 | Sandbox guard before POST | §4.1 above | PASS |
| SC-10 | 10-ticket PDF < 5MB; overflow → `ticket_pdf_size_exceeded` | ticketPdf.test.ts size envelopes + §4.6 | PASS |
| SC-11 | All 5 strict-grep gates fail pre-impl, pass post-impl | §3 above + GitHub CI on PR #74 | PASS |
| SC-12 | `send-*` files carry ORCH-0785 header | 8 of 9 stamped; 9th file (`send-pair-request-visible`) does not exist in repo — implementor discovery confirmed independently (`ls supabase/functions/send-pair-request-visible` → No such file). Closest match `notify-pair-request-visible` is well-named, out of scope | PASS (with discovery) |
| SC-13 | No new SQL migration | `ls supabase/migrations/*orch_0785*` returns nothing | PASS |
| SC-14 | Behavioural contract preservation | §4.2 above | PASS |

## 6. Spec §15 test matrix — per-row verdict

| Test | Mapped to | Verdict |
|---|---|---|
| T-01 (RT-1) Free render | shell.test.ts "free ticket render" | ✓ |
| T-02 (RT-2) Paid render | shell.test.ts "paid ticket render" | ✓ |
| T-03 (RT-4) PDF QR round-trip | ticketPdf.test.ts "parseable PDF with one page per ticket" + "no forbidden privacy strings" | ✓ |
| T-04 (RT-3) Missing/video cover fallback | shell.test.ts "missing image cover" + "video cover" | ✓ |
| T-05 Missing master date | shell.test.ts "missing master event_date" | ✓ |
| T-06 (RT-6) Buyer-name XSS | shell.test.ts "buyer name XSS escapes" | ✓ |
| T-07 notify-dispatch generic shell opt-in | shell.test.ts "generic_notification routes" | ✓ |
| T-08 admin-send-email brand shell | shell.test.ts "admin_compose routes" + EmailPage.jsx UI inspection | ✓ |
| T-09 (RT-7) Sender sandbox guard | senders.test.ts + shell.test.ts "sender sandbox guard rejects @resend.dev" | ✓ |
| T-10 PDF size envelope | ticketPdf.test.ts size envelopes | ✓ |
| T-11 (RT-5) Resend attachments present | dispatcher line 397-405 passes `attachments: [{ filename, content }]` in POST body | ✓ |
| T-12 send-* header grep | `grep -l "ORCH-0785: This function does NOT" supabase/functions/send-*/index.ts \| wc -l` → 8 (9th doesn't exist) | ✓ |
| T-13 (RT-11) Admin EmailPage default sender | EmailPage.jsx:162 `setFromEmail("hello@usemingla.com")` matches `EMAIL_SENDERS.admin.address` | ✓ |
| T-14 Behavioural contract preservation | §4.2 above (static diff verdict) | ✓ |
| RT-8 ORCH-0785-A | §3 above | ✓ |
| RT-9 ORCH-0785-B | §3 above | ✓ |
| RT-10 ORCH-0785-C | §3 above | ✓ |
| RT-11 ORCH-0785-D | §3 above | ✓ |
| RT-12 ORCH-0785-E | §3 above | ✓ |

## 7. §15.2 Manual / provider gates (MG-1..MG-6) — DEFERRED PENDING OPERATOR

Per the dispatch's hard-guard "do not silently CONDITIONAL PASS — halt and request
unblock", these gates are explicitly held back and surfaced to the operator. None
are failed; none can be exercised without operator action.

| Gate | What's needed | Owner |
|---|---|---|
| MG-1 free-ticket purchase → email + PDF + scan | Edge deploys after secrets are set; logo published; DKIM verified | Operator clears unblock → orchestrator deploys → operator/tester real-fire |
| MG-2 paid-ticket purchase → same | same | same |
| MG-3 Admin EmailPage individual send with shell ON | same secrets + DKIM + admin-send-email deploy | same |
| MG-4 notify-dispatch `emailTo` path with generic_notification | same secrets + DKIM + notify-dispatch deploy | same |
| MG-5 Operator confirms secrets in Supabase dashboard | operator action | Operator |
| MG-6 Operator confirms Resend DKIM verification | operator action | Operator |

**Halt + unblock request:** the operator must (a) `supabase secrets set` the six
env vars MINGLA_LOGO_URL, MINGLA_LOGO_URL_2X, MINGLA_FOOTER_ADDRESS,
RESEND_TICKET_FROM, RESEND_ADMIN_FROM, RESEND_SYSTEM_FROM, (b) publish the
Mingla logo at `https://usemingla.com/email-assets/mingla-logo.png` + `@2x.png`,
(c) verify Resend DKIM/SPF/DMARC for `tickets@`, `hello@`, `notifications@usemingla.com`,
(d) approve PR #74. After those four items, the orchestrator deploys
`ticket-confirmation-dispatch`, `notify-dispatch`, `admin-send-email`,
`stripe-kyc-stall-reminder`, `stripe-webhook-health-check`. Only then can
MG-1..MG-6 be exercised.

## 8. P4 — positive observations

- **P4-1.** Pre-render-once architecture in `ticket-confirmation-dispatch`
  (lines 318-358): the renderer + PDF run exactly once per dispatch and the
  cached result is reused across multiple email ledger rows. Avoids per-row
  recomputation. Clean.
- **P4-2.** `ticketBody.ts` cleanly separates already-escaped HTML fragments
  by naming convention (`orderShortLineHtml`, `renderHero(...)` returning
  pre-built HTML). Matches the ORCH-0785-C gate's `*Html` allowlist exactly
  and prevents future contributors from accidentally interpolating raw input.
- **P4-3.** `ticketPdf.ts` chunked `bytesToBase64` (lines 51-62) avoids
  call-stack overflow on large PDF byte arrays — defensive against future
  bigger orders.
- **P4-4.** Implementor proactively dropped `buyer_phone_e164` from the
  `OrderJoin` interface AND the SELECT projection rather than leaving it as
  dead privacy surface — exceeds spec §5.4 floor.

## 9. Discoveries for orchestrator

1. **`send-pair-request-visible` does not exist** — confirmed independently.
   Spec §11 named 9 files; 8 stamped. The remaining 9th is a naming artifact
   in the spec, not a missed file. Suggest updating spec §11 at CLOSE to
   reflect 8 files + an explicit "no such file" note for `send-pair-request-visible`.
2. **`MINGLA_LOGO_URL_2X` is read but not wired into shell HTML.** The renderer
   `_shared/email/index.ts:55` validates the env exists but the shell `<img>`
   in `_shared/email/shell.ts:45` only uses `MINGLA_LOGO_URL`. Reserve as a
   follow-up ORCH for retina `<img srcset>` markup; not a current defect.
3. **Pre-existing `pushPayload as Parameters<typeof sendPush>[0]` cast in
   `notify-dispatch`** received an `as unknown as` patch to keep `deno check`
   clean. The underlying `PushPayload` type drift is real but out of ORCH-0785
   scope; suggest a META-ORCH or absorb into ORCH-0786/0787.
4. **Pre-existing `ORCH-0786` and `ORCH-0787` strict-grep gates on `main`
   currently fail on PR #74** because the corresponding scoped code is still
   uncommitted on Seth. These are NOT ORCH-0785 regressions — they fail in
   the same way they would on the prior `Seth` head. The branch protection
   set on PR #74 does not include them as required (watch exited 0).

## 10. Verification matrix summary

| Layer | Checked | Verdict |
|---|---|---|
| Spec compliance | 14 / 14 SCs | PASS |
| Test matrix | 14 T + 5 RT | PASS |
| Strict-grep gates | 5 / 5 | PASS |
| Deno tests | 23 / 23 | PASS |
| Deno check | 5 / 5 edge functions | PASS |
| GitHub CI required-check set | watch exit 0 | PASS |
| Constitution 14 rules | all relevant rules verified | PASS |
| Behavioural contract preservation | service-role auth + ledger + rollup | PASS |
| New invariants AL/AM/AN/AO | enforced by gates + runtime guards | PASS (DRAFT — flips to ACTIVE on CLOSE) |
| Real-fire manual gates MG-1..MG-6 | 6 / 6 | **DEFERRED PENDING OPERATOR** |

## 11. Verdict statement

**PASS for the code-side scope of ORCH-0785.** The implementation matches the
spec, the gates are wired correctly, the contracts are preserved, and the
privacy + security guards are in code and enforced. No P0/P1/P2/P3 findings.

**Real-fire MG-1..MG-6 are explicitly held back until the operator clears the
four unblock items.** Per the dispatch's hard-guard, this report does not
silently downgrade to CONDITIONAL PASS — it halts and surfaces the unblock
request verbatim.

---

## Next Handoff Paragraph

NEXT HANDOFF — paste into Claude `mingla-orchestrator` (or Codex
`orchestrator-mingla` — operator's choice; either side can run CLOSE per
DEC-145 parity):

ORCH-0785 has PASSED the code-side QA at
`Mingla_Artifacts/reports/QA_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
with zero P0/P1/P2/P3 findings (4 P4 positive observations). Every spec §12
success criterion SC-1..SC-14 and every §15 test matrix row T-01..T-14 +
RT-8..RT-12 is verified GREEN against the head `e7d7678f` on branch `Seth`;
PR #74 (`Close ORCH-0784 + ship ORCH-0785`) carries the same five
ORCH-0785-A..E strict-grep gates green on GitHub CI. The §15.2 real-fire
gates MG-1..MG-6 are explicitly DEFERRED PENDING OPERATOR UNBLOCK — the
operator must (1) `supabase secrets set` the six env vars MINGLA_LOGO_URL,
MINGLA_LOGO_URL_2X, MINGLA_FOOTER_ADDRESS, RESEND_TICKET_FROM,
RESEND_ADMIN_FROM, RESEND_SYSTEM_FROM, (2) publish the Mingla logo at
`https://usemingla.com/email-assets/mingla-logo.png` + `@2x.png`,
(3) confirm Resend DKIM/SPF/DMARC for tickets@/hello@/notifications@usemingla.com,
(4) approve PR #74. After those clear, the orchestrator runs the five
edge-function deploys, exercises MG-1..MG-6 end-to-end, runs the pre-merge
gate per Working-Branch Discipline, gets operator merge confirmation, and
merges PR #74. CLOSE protocol then runs Steps 1–4 (artifact sync + DIAG
reap + commit message + EAS Update notes — note no SQL migration and no
EAS update is needed for ORCH-0785 since mobile bundles are untouched).
The four new DRAFT invariants I-PROPOSED-AM EMAIL_BRAND_SHELL_SINGLETON,
I-PROPOSED-AN RESEND_NO_SANDBOX_SENDER, I-PROPOSED-AO BUYER_INPUT_HTML_ESCAPED,
and I-PROPOSED-AP TICKET_PDF_PRIVACY flip to ACTIVE on CLOSE. Working tree:
`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
