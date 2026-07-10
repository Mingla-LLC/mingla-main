# IMPLEMENTATION — ORCH-1329 [partner-invite email polish + "Get the Mingla Business app" download CTA + AA button-contrast fix]

**Phase:** IMPLEMENT (single pass; self-verified). No deploy, no merge, no close.
**Worktree:** `~/Desktop/mingla-orchs/orch-1329-[partner-invite-email-polish]/` on branch `orch-1329-partner-invite-email-polish` (rebased on `origin/main` @ `dd61352e2` — rebase was a no-op).
**Binding contract:** `INVESTIGATION_ORCH-1329_PARTNER_INVITE_EMAIL.md` + `DESIGN_ORCH-1329_PARTNER_INVITE_EMAIL.md` + `DESIGN_ORCH-1329_mockup.html`.
**Fix commit (fails-on-revert baseline):** `cc23cf2e5`.
**Status:** implemented and verified (Deno available @ `~/.deno/bin/deno` 2.7.14 — all gates run locally).

---

## 1. Summary (plain English)

The brand-invite email now does two jobs it didn't before. (1) It carries a second, clearly-secondary button — "Get the Mingla Business app" — in BOTH email variants, pointing at `https://usemingla.com/business/download` (which sends iPhones to the business App Store and everyone else to the business web dashboard). (2) It got the full designer polish: the partner-setup email leads with a bold line, three numbered steps (Accept → Connect your bank → You're live), and an elevated "Bank-secure." Stripe reassurance card; the standard team-invite email gained a role-clarity line ("As an event manager you can…"), a brand-context line, and a warmer inviter-led subject. Separately, a cross-surface accessibility fix darkens every white-text CTA button fill in ALL transactional emails from orange (`#FF6B2C` / `#F97316`, which fail WCAG AA) to `#C4471A` (passes AA) — surgically, leaving decorative orange (links, borders, text accents) untouched.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Result | Commit |
|----|-----------|--------------|--------|--------|
| SC-1 | Secondary "Get the Mingla Business app" CTA in BOTH variants → static `https://usemingla.com/business/download`, outlined-ghost in a bordered card | New test asserts html contains the URL + label + outline border, both variants; visual match to mockup §4.2 | ✓ | cc23cf2e5 |
| SC-2 | Partner-setup polish: bold lead line + 3 numbered steps + elevated "Bank-secure." Stripe card + tightened fine print + `#B23E12` chip/badges | Code built to mockup lines 71-162; test asserts "Connect your bank"/"You're live"/"Bank-secure." | ✓ | cc23cf2e5 |
| SC-3 | Standard-invite polish: role-clarity line + brand-context line + secondary app CTA + inviter-led subject/preheaders | Code built to mockup lines 206-245; test asserts role-clarity phrase | ✓ | cc23cf2e5 |
| SC-4 | Plain-text parity: both variants' text contain accept URL AND download URL + step/role copy | Test asserts `p.text` includes download URL + accept URL both variants | ✓ | cc23cf2e5 |
| SC-5 | AA button-contrast fix across ALL transactional emails: white-text CTA fills → `#C4471A`; decorative `#FF6B2C` unchanged | Full dependency walk (§ below); grep confirms 0 white-text buttons on `#FF6B2C`/`#F97316` | ✓ | cc23cf2e5 |
| SC-6 | Escape gate (0785-C) green — download URL static literal; interpolated brand/inviter/note/role strings `sharedEscapeHtml()` | `orch-0785-buyer-string-escape.mjs` → passed | ✓ | cc23cf2e5 |
| SC-7 | Shell-singleton gate (0785-D) green — new CTAs inside `bodyHtml`, no new doctype | `orch-0785-shell-singleton.mjs` → passed | ✓ | cc23cf2e5 |
| SC-8 | CLOSE Step-0.5 regression test present, passing, fails-on-revert | 3 new tests pass; both fix-vectors proven fails-on-revert @ cc23cf2e5 | ✓ | cc23cf2e5 |

---

## 3. Files changed (8 code/test + 3 forensics artifacts + this report)

| File | Δ | What |
|------|---|------|
| `supabase/functions/invite-brand-member/index.ts` | +217/−~89 net | Full `buildInviteEmail()` rewrite (both variants HTML + plain-text) + `roleCanPhrase()`/`roleArticle()` helpers |
| `supabase/functions/_shared/email/shell.ts` | +7 | New `BRAND_ORANGE_BUTTON = "#C4471A"` const + `SHELL_TOKENS` export |
| `supabase/functions/_shared/email/ticketBody.ts` | ~12 | Destructure `BRAND_ORANGE_BUTTON`; download-CTA fill → token (keeps `BRAND_ORANGE` for text accents) |
| `supabase/functions/_shared/email/genericBody.ts` | ~7 | CTA fill → `BRAND_ORANGE_BUTTON` (its only orange use) |
| `supabase/functions/_shared/email/tripConfirmationEmail.ts` | 1 line | Download-CTA fill `#F97316` → `#C4471A` |
| `supabase/functions/_shared/email/experienceConfirmationEmail.ts` | 1 line | Download-CTA fill `#F97316` → `#C4471A` |
| `supabase/functions/invite-brand-member/__tests__/orch-1329-download-cta.test.ts` | +94 (new) | Happy-path regression (both variants, html+text, button fill) |
| `supabase/functions/invite-brand-member/__tests__/orch-1050-invite-happy.test.ts` | +5/−1 | One assertion `Accept:` → `Accept your invitation:` (new §6 copy) — `[TEST-MOD-APPROVED ORCH-1329]` |
| `Mingla_Artifacts/investigations/…`, `specs/…` (2), + this report | new | ORCH paper trail |

---

## 4. Button dependency-walk (the AA fix, surgical) — COMPLETE

**Rule applied:** every CTA button whose `<a>`/`<td>` carries WHITE label text on an orange fill was darkened to `#C4471A` (AA 4.93:1). Decorative orange (`#FF6B2C`) used as link color, border, or non-white text accent was LEFT unchanged. A dedicated token `SHELL_TOKENS.BRAND_ORANGE_BUTTON` centralizes the value; files that already consume `SHELL_TOKENS` use the token, self-contained/inline-by-design files use the literal `#C4471A`.

### 4a. Buttons DARKENED (white text on orange → `#C4471A`)

| # | File:line | Was | Now | Mechanism |
|---|-----------|-----|-----|-----------|
| 1 | `invite-brand-member/index.ts:270` | `background:#FF6B2C` | `background:#C4471A` (literal) | Primary "Accept" CTA — spec §1 mandates inline literals for this email |
| 2 | `_shared/email/ticketBody.ts` renderDownloadAppCta | `background:${BRAND_ORANGE}` (#FF6B2C) | `background:${BRAND_ORANGE_BUTTON}` | "Open in Mingla" order-chat CTA (white text) |
| 3 | `_shared/email/genericBody.ts` cta | `background:${BRAND_ORANGE}` (#FF6B2C) | `background:${BRAND_ORANGE_BUTTON}` | Generic/admin-compose CTA (white text) |
| 4 | `_shared/email/tripConfirmationEmail.ts:124` | `background:#F97316` | `background:#C4471A` (literal) | Trip "Open in Mingla" CTA (white text) — self-contained file |
| 5 | `_shared/email/experienceConfirmationEmail.ts:223` | `background:#F97316` | `background:#C4471A` (literal) | Experience "Open in Mingla" CTA (white text) — self-contained file |

**Confirmation:** `grep -rniE "background:#(FF6B2C|F97316)" supabase/functions/` → 0 matches after the change. No white-text button remains on a failing orange fill.

### 4b. `#FF6B2C` / `#F97316` deliberately LEFT unchanged (one-word reason)

| File:line | Occurrence | Reason |
|-----------|-----------|--------|
| `shell.ts:9` | `BRAND_ORANGE` const | token (still used for footer link) |
| `shell.ts:84` | footer `<a … color:${BRAND_ORANGE}>` mailto | link |
| `calendar.ts:144` | `BRAND_ORANGE` const | token (eyebrow-text only) |
| `calendar.ts:160` | `color:${BRAND_ORANGE}` "Add to calendar" | text-accent |
| `calendar.ts:158` | Google/Outlook/Apple buttons `background:#FFFFFF` + ink text | not-white-text (white-fill buttons) |
| `ticketBody.ts:37` | `color:${BRAND_ORANGE}` "Mingla event" eyebrow | text-accent |
| `ticketBody.ts:129` | `color:${BRAND_ORANGE}` ticket badge | text-accent |
| `experienceConfirmationEmail.ts:171` | `color:#F97316` stop label | text-accent |
| `invite-brand-member/index.ts:260` | personal-note `border-left:3px solid #FF6B2C` | border |
| `invite-brand-member/index.ts:283` | secondary CTA `border:1.5px solid #FF6B2C` | border (outlined ghost; label is `#B23E12`) |
| `marketing-unsubscribe/index.ts:169` | `<a … color:#FF6B2C>` | link (HTTP page, gate-allowlisted dir) |
| `invite-brand-member/index.ts:229` (was `:222`) | chip text (was `color:#FF6B2C`) | chip-handled-as-#B23E12 (changed to AA text token, not the button token) |

---

## 5. Data-model changes applied

None. No migration. No schema/RLS/constraint change. `verify_jwt=true` unchanged (config.toml untouched). Resend send path, auth/permission gate, token/expiry logic, and the `partner_brand_links` insert are all untouched.

---

## 6. Edge functions touched (for orchestrator/operator deploy from MERGED main)

| Function | verify_jwt to preserve | Note |
|----------|------------------------|------|
| `invite-brand-member` | **true** | Email body/text rewrite only; contract unchanged |
| Shared `_shared/email/*` (shell, ticketBody, genericBody, tripConfirmationEmail, experienceConfirmationEmail) | n/a (shared modules) | Consumed by ticket/trip/experience/generic email dispatchers — those functions must be redeployed to pick up the AA button-fill change: **ticket-confirmation-dispatch** (and any function importing these renderers). |

**Cross-surface deploy note:** because the button-fill change lives in shared `_shared/email/` modules, EVERY edge function that renders a transactional email inherits it on redeploy. The implementor deploys nothing — orchestrator/operator deploys from merged main.

---

## 7. Regression tests added

- **Path:** `supabase/functions/invite-brand-member/__tests__/orch-1329-download-cta.test.ts` (3 tests).
- **Passing run:** full invite suite `12 passed | 0 failed` (9 pre-existing + 3 new) via `deno test --allow-env --allow-net supabase/functions/invite-brand-member/__tests__/`.
- **fails-on-revert verified at `cc23cf2e5`** — two independent fix-vectors proven by TRUE LINE DELETION (not comment-out):
  - Deleting the `usemingla.com/business/download` payload (both occurrences) → **0 passed | 3 failed**; restore → 12 passed.
  - Reverting the primary fill `#C4471A`→`#FF6B2C` → **1 passed | 2 failed** (the two variant tests' `PRIMARY_FILL` + "no `#FF6B2C` background" assertions); restore → 12 passed.
- **Append-only:** `test-append-only-check.js` → `2 passed, 0 failed` (new file ADDED; existing file MODIFIED honored by `[TEST-MOD-APPROVED ORCH-1329]` in commit `cc23cf2e5` body).

---

## 8. Old → New receipts

### `invite-brand-member/index.ts` (`buildInviteEmail`)
- **Before:** two variants, ONE CTA (accept). Partner body = one dense paragraph; standard body = one line. Stripe note buried in grey fine print. No app-download link in html OR text. Primary button fill `#FF6B2C`.
- **Now:** partner = eyebrow chip (`#B23E12`) + bold lead line + 3 numbered steps + optional personal note + primary CTA (`#C4471A`) + elevated "Bank-secure." trust card + secondary outlined "Get the Mingla Business app" CTA + tightened fine print. Standard = value line + role-clarity line + brand-context line + primary CTA + same secondary CTA + fine print. Both plain-text bodies carry accept URL + download URL + step/role copy. New inviter-led standard subject + stronger preheaders.
- **Why:** SC-1..SC-4, SC-6; DESIGN_ORCH-1329 §5/§6.
- **Lines:** ~217 changed.

### `_shared/email/shell.ts`, `ticketBody.ts`, `genericBody.ts`, `tripConfirmationEmail.ts`, `experienceConfirmationEmail.ts`
- **Before:** white-text CTA buttons on `#FF6B2C`/`#F97316` (2.84:1 / ~3.0:1 — fail AA).
- **Now:** `#C4471A` (4.93:1 — pass AA) via new `BRAND_ORANGE_BUTTON` token / literal.
- **Why:** SC-5; DESIGN_ORCH-1329 §10 (Seth-approved path B).
- **Lines:** shell +7; ticketBody ~12; genericBody ~7; trip/experience 1 each.

---

## 9. Cross-surface impact table

| Surface | Affected? | What changes / reason |
|---------|-----------|-----------------------|
| Consumer iOS | No | No app runtime; email-only ORCH |
| Consumer Android | No | Same |
| Buyer/anonymous Web | No | Same |
| Business iOS | No | Same (email links point AT the business app, but no app code changed) |
| Business Android | No | Same |
| Admin Web (adjacent) | No | Same |
| Business Web preview (adjacent) | No | Same |
| **Transactional email (all clients)** | **Yes** | Invite email fully redesigned; ticket/trip/experience/generic email CTA buttons darkened to AA. Parity is AUTOMATIC (shared `_shared/email/` modules) — no manual per-surface fork. |

---

## 10. Smoke result

Backend/email ORCH — no simulator/device runtime applies (Prime-Directive exemption for pure email/static-analysis work; the "runtime" is the shipped `/business/download` 307 route, unchanged by this ORCH). Verified by: `deno check` (6 files, clean), `deno test` (invite suite 12/12; shared-email suite 33/34 — see §12 D-1), both strict-grep gates green, append-only gate green, and byte-level fails-on-revert. Visual fidelity checked against `DESIGN_ORCH-1329_mockup.html` block-by-block.

---

## 11. Known issues / deferred

- **Intentional deviation from the mockup (per locked decision #4):** the mockup renders the PRIMARY button on `#FF6B2C` (its legend says "keeps the shared brand fill"); this build ships it on `#C4471A` because Seth approved DESIGN §10 path B (darken shared button fill). All other pixels match the mockup.
- **Download URL kept a plain static literal** (not the optional `MINGLA_MARKETING_WEB_URL` env). The env override was verified escape-gate-safe (identifier `downloadUrl` is not in the 0785-C prefix set), but the static literal is what the spec §4.2 mandates ("STATIC LITERAL, no interpolation") and carries zero risk — chosen deliberately.
- No `[TRANSITIONAL]` code introduced.

---

## 12. Operator action required

1. **No migration.** Nothing to `db push`.
2. **Edge deploy (from MERGED main, orchestrator/operator-owned):** redeploy `invite-brand-member` AND every function that renders transactional email via the shared `_shared/email/` renderers (at minimum `ticket-confirmation-dispatch`, plus any notify/generic-email path) so the AA button-fill lands everywhere. Preserve `verify_jwt=true` on `invite-brand-member`.
3. Route to REVIEW → tester (adversarial second test + spec-compliance).

---

## 13. Discoveries for Orchestrator

- **D-1 (pre-existing main-red, NOT this ORCH):** `_shared/email/__tests__/shell.test.ts` → "paid ticket render: tax row includes jurisdiction labels" FAILS on pristine `origin/main` (proven: stashed all ORCH-1329 changes → `9 passed | 1 failed`, same failure). It expects `Tax (New York State, New York City)` and the renderer emits a different tax label. Unrelated to buttons/copy; left untouched per scope discipline. **Recommend a follow-up ORCH** (tax-jurisdiction email label) — and note the email `deno test` suite is currently red on main independent of this work.
- **D-2 (from investigation F-6, unchanged):** `tripConfirmationEmail.ts` + `experienceConfirmationEmail.ts` bypass `renderShell` and emit their own `<!DOCTYPE html>` (legal under 0785-D — they live in `_shared/email/`). Shell-consistency cleanup candidate.
- **D-3 (from investigation D-2):** the two `renderDownloadAppCta()` helpers still deep-link to the CONSUMER `/orders/{id}/chat` — a brand owner receiving a ticket/trip email is sent to the consumer app. Cross-app-attribution note, out of this ORCH's scope.
