# TEST — ORCH-1329 [partner-invite email polish + "Get the Mingla Business app" download CTA + AA button-contrast fix]

**Phase:** TEST (adversarial gatekeeper; independent runtime verification). No product code written. No deploy, no merge, no close.
**Worktree:** `~/Desktop/mingla-orchs/orch-1329-[partner-invite-email-polish]/` on branch `orch-1329-partner-invite-email-polish`.
**Base:** origin/main @ `dd61352e2`. **Branch HEAD under test:** `2163d3af7` (impl) → **tester commit `44bc2ce18`** (this test).
**Method:** RUNTIME. Every claim below is backed by executing `buildInviteEmail()` and the shared email renderers in Deno 2.7.14 (`~/.deno/bin/deno`) — no source-only reasoning. This is an edge-function/email-only ORCH → Phase-0.A live-fire-sim gate EXEMPT (backend/email surface; the "runtime" is the Deno-executed render, which was performed).

---

## 1. VERDICT

# PASS

**Finding counts:** P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise).
**Regression gate:** SATISFIED — implementor happy-path test (fails-on-revert re-verified @ `cc23cf2e5`) AND tester adversarial test (different angle, on-branch, in closing diff, own fails-on-revert) both present.
**Only red in the whole email test surface:** the pre-existing `shell.test.ts` "tax row includes jurisdiction labels" (tracked as ORCH-1330) — proven identical on pristine origin/main, NOT introduced by ORCH-1329.

---

## 2. SC-by-SC matrix (runtime evidence per row)

| SC | Criterion | Result | Runtime evidence |
|----|-----------|--------|------------------|
| SC-1 | Secondary "Get the Mingla Business app" CTA in BOTH variants → static `https://usemingla.com/business/download`, outlined-ghost card | PASS | Executed `buildInviteEmail()` for both variants + all 6 roles: html contains `<a href="https://usemingla.com/business/download"` (closing quote immediately after `download` → no query appended), label "Get the Mingla Business app", card `border:1px solid #ECECEE`, ghost `border:1.5px solid #FF6B2C`, label `color:#B23E12`. |
| SC-2 | Partner-setup polish: eyebrow chip + 3 numbered steps + "Bank-secure." Stripe card + tightened fine print + `#B23E12` accents | PASS | Partner html contains eyebrow chip (`#B23E12`, `Set up for you by`), steps "Connect your bank"/"You're live", `Bank-secure.` in a `#FFF6F1` card, fine print expiry+paste-URL. |
| SC-3 | Standard-invite polish: role-clarity + value line + secondary CTA + inviter-led subject | PASS | Standard html contains value line, role-clarity ("As an event manager you can create and run events…"), inviter-led subject `${inviter} invited you to join ${brand}'s team on Mingla`. Verified across scanner/finance_manager/event_manager/brand_admin/marketing_manager/brand_owner. |
| SC-4 | Plain-text parity: both variants' `text` contain accept URL AND download URL | PASS | For all 12 (variant × role) combinations, `p.text` includes the accept token `SECRET_TOKEN_9f3a` AND `https://usemingla.com/business/download`. |
| SC-5 | AA button-contrast fix across ALL transactional emails: white-text CTA fills → `#C4471A`; decorative `#FF6B2C` unchanged | PASS | Invite primary fill = `background:#C4471A`; NO `background:#FF6B2C` / `background:#F97316` anywhere in invite html; decorative `border:1.5px solid #FF6B2C` (secondary) + `border-left:3px solid #FF6B2C` (note) preserved (surgical). Cross-surface (ticket/generic/trip/experience) all execute with action-button fill `#C4471A` and zero failing-orange button fill (see §7). |
| SC-6 | Escape gate (0785-C) green | PASS | `node orch-0785-buyer-string-escape.mjs` → "gate passed" (exit 0). |
| SC-7 | Shell-singleton gate (0785-D) green | PASS | `node orch-0785-shell-singleton.mjs` → "gate passed" (exit 0). NOTE: my adversarial test had to assemble the doctype needle from fragments because 0785-D greps `__tests__` too — caught and fixed pre-commit (see §5). |
| SC-8 | CLOSE Step-0.5 regression test present, passing, fails-on-revert | PASS | Implementor happy-path 3/3 @ `cc23cf2e5`; both implementor vectors re-verified by me (§4); tester adversarial 24/24 with its own two fails-on-revert vectors (§5). |

---

## 3. Suite pass/fail counts (all runtime)

| Suite / gate | Result |
|---|---|
| `invite-brand-member/__tests__/` (full, incl. my new file) | **36 passed \| 0 failed** (9 orch-1050 + 3 implementor download-cta + 24 tester) |
| `_shared/email/__tests__/` (full) | **33 passed \| 1 failed** — the 1 failure is the pre-existing ORCH-1330 tax-label red (see §6) |
| ORCH-0785-C buyer-string-escape gate | PASS (exit 0) |
| ORCH-0785-D shell-singleton gate | PASS (exit 0) |
| tests-append-only gate | PASS — 3 passed, 0 failed (1 MODIFIED honored by token, 2 ADDED) |
| ORCH-0785 resend-attachment-aware / no-resend-sandbox / pdf-privacy gates | PASS (all exit 0) |
| `deno check` (index.ts + tester test + 5 shared renderers) | Clean (exit 0) |

---

## 4. Step 0.5 — independent re-run of the IMPLEMENTOR's fails-on-revert proof

Checked out the implementor's fix commit and reproduced both claimed vectors by TRUE SOURCE MUTATION (then `git checkout --` restore):

- **Commit run:** `cc23cf2e5` (fix). Happy-path `orch-1329-download-cta.test.ts` → **3 passed | 0 failed** as shipped. ✓
- **Vector 1 — remove the download payload** (`perl -i` replaced both `usemingla.com/business/download` occurrences): → **0 passed | 3 failed**. Matches the implementor's claim exactly. ✓ Restored.
- **Vector 2 — revert primary fill `#C4471A`→`#FF6B2C`**: → **1 passed | 2 failed** (the two variant tests' `PRIMARY_FILL` + "no #FF6B2C background" assertions; the URL-literal test still passes). Matches the implementor's claim exactly. ✓ Restored.

Conclusion: the implementor's fails-on-revert proof is genuine and reproduces byte-for-byte.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts` (NEW file, append-only).
- **Commit:** `44bc2ce18` on `orch-1329-partner-invite-email-polish`. Appears in `git diff origin/main...HEAD --name-only`. ✓
- **Angle (deliberately NOT the implementor's URL-present + button-color happy path):**
  1. **ESCAPE/XSS** — hostile `brandName`/`inviterName`/`personalNote`/`inviteeName` (`"><img src=x onerror=…>`, `<script>`, `</td><script>`, `<svg/onload=…>`) must be ENTITY-ESCAPED: raw tag-breakout string ABSENT + escaped form PRESENT, for BOTH variants and across the NEW polish blocks + the personal-note cell-breakout. (The pre-existing `orch-1050` escape test only checks escaped-form-*present* for the standard variant; never raw-absent, never partner, note, inviteeName, or the attribute-breakout vector.)
  2. **WRONG-APP/WRONG-TARGET** — secondary CTA = business `/business/download` and NOT `mingla.onelink.me`, consumer App Store id `id6760440898`, consumer package `com.mingla.app.v2`, or consumer `/download`; primary CTA keeps the accept token; token never leaks into the download href (`!business/download?token`).
  3. **BOTH-VARIANTS COMPLETENESS** across ALL 6 roles incl. scanner + finance_manager (implementor only used event_manager) — download URL + accept token in html AND text.
  4. **AA CONTRAST INVARIANT (surgical)** — no `background:#FF6B2C`/`#F97316`; primary `#C4471A`; decorative `#FF6B2C` border PRESERVED (guards against a blanket search-replace over-correction).
  5. **CROSS-SURFACE NON-REGRESSION** — ticket/generic (via `renderTransactionalEmail`, shell-wrapped) + trip/experience (self-contained) execute to a complete email (exactly one doctype) with action button `#C4471A` and core content intact.
- **Runtime:** 24 passed | 0 failed.
- **fails-on-revert verified locally @ `cc23cf2e5` baseline (product code patched then restored via `git checkout`, never committed):**
  - Un-escape the greeting `inviteeName` (`sharedEscapeHtml(input.inviteeName)` → `input.inviteeName`) → ESCAPE suite **0 passed | 2 failed** (`RAW hostile payload leaked UNESCAPED … <svg/onload=alert('name')>`). Restored.
  - Swap the secondary href → `https://mingla.onelink.me/w36m/r1g66ldx` → WRONG-TARGET suite **0 passed | 2 failed** (missing `<a href="https://usemingla.com/business/download"`). Restored.
- Both the implementor happy-path test AND this tester test are visible in the closing diff `origin/main...HEAD`. Regression gate SATISFIED.

---

## 6. Pre-existing RED confirmation (ORCH-1330, NOT this ORCH)

- **On this branch:** `_shared/email/__tests__/shell.test.ts` → "paid ticket render: tax row includes jurisdiction labels" (`shell.test.ts:81`) FAILS; suite = 33 passed | 1 failed.
- **On pristine origin/main @ `dd61352e2`** (independently verified via a throwaway `git worktree add --detach … origin/main`, then removed): SAME single failure, same `shell.test.ts:81`, suite = **33 passed | 1 failed**.
- **Root:** the test expects a jurisdiction-labeled tax row `Tax (New York State, New York City)`; the ticket renderer (`renderLineItems`) emits an inclusive-VAT note `Includes … VAT` instead. This logic is UNTOUCHED by ORCH-1329 (the shared-file diff is exclusively the 5 button-fill darkenings — verified line-by-line). ORCH-1329 introduced ZERO new failures.
- Confirmed as the SAME single failure the orchestrator already recorded → follow-up **ORCH-1330** (tax-jurisdiction email label). Not a CLOSE blocker for ORCH-1329.

---

## 7. Cross-surface non-regression detail (executed)

| Surface | Renderer executed | Doctype | Action button fill | Failing-orange button fill | Content intact |
|---|---|---|---|---|---|
| Ticket | `renderTransactionalEmail` (shell-wrapped) | exactly 1 (`<!doctype html>`) | `background:#C4471A` ✓ | none (`#FF6B2C`/`#F97316` absent) | "Sunset Sail", "Total", "Open in Mingla" ✓ |
| Generic/admin | `renderTransactionalEmail` (shell-wrapped) | exactly 1 | `background:#C4471A` ✓ | none | "Heads up", "Para1", cta label ✓ |
| Trip | `renderTripConfirmationEmail` (self-contained) | exactly 1 (`<!DOCTYPE html>`) | `background:#C4471A` ✓ | none | "You're booked", trip title ✓ |
| Experience | `renderExperienceConfirmationEmail` (self-contained) | exactly 1 | `background:#C4471A` ✓ | `background:` none — NOTE `color:#F97316` (stop-label TEXT accent) legitimately remains; it is not a button fill | "You're reserved", experience title ✓ |

The AA fix propagates through the shared `_shared/email/` modules automatically; no per-surface fork.

---

## 8. Constitution 14-rule matrix (independent, vs the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | Both CTAs carry live hrefs: accept URL (token-bearing) + `/business/download` (shipped ORCH-1326 307 route, investigation F-2). |
| 2 | One owner per truth | N/A | Pure render; no state ownership. |
| 3 | No silent failures | PASS | Builder is pure; handler's Resend-fail rollback path unchanged. |
| 4 | One query key per entity | N/A | No React Query. |
| 5 | Server state stays server-side | N/A | Edge function only. |
| 6 | Logout clears everything | N/A | No client state. |
| 7 | Label temporary `[TRANSITIONAL]` | PASS | No transitional code introduced (grep clean). |
| 8 | Subtract before adding | PASS | AA fix darkened existing fills surgically; no dead code left. |
| 9 | No fabricated data | PASS | Email uses real brand/inviter/role; escape suite proves no injection; download route is real, not a placeholder. |
| 10 | Currency-aware | N/A (invite) | Cross-surface ticket/trip/experience currency logic unchanged. |
| 11 | One auth instance | N/A | Handler auth unchanged; `verify_jwt=true` preserved (config.toml not in diff). |
| 12 | Validate at right time | N/A | No datetime logic changed. |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | No hydration. |

**Security posture (tester's overriding lens):** escape-safety PROVEN by adversarial runtime (both variants, all injected fields, attribute-breakout vector) with fails-on-revert. Wrong-target PROVEN (business route, not consumer/OneLink/accept). Shell-singleton PRESERVED. No dead link, no data fabrication, no injection. Clean.

---

## 9. Device / parity matrix

Backend/email-only ORCH — no app runtime. The 5 primary + 2 adjacent app surfaces (Consumer iOS/Android, Buyer Web, Business iOS/Android, Admin Web, Business Web preview) are **N/A** — no RN/app code changed (implementor cross-surface table §9 concurs). The only affected surface is **transactional email (all clients)**, verified by RUNTIME render execution in Deno (this IS the surface's runtime). Physical-iPhone HITL: N/A (no app-touchable change). Live edge-deploy: **N/A pre-merge** — the change is not deployed; the orchestrator redeploys `invite-brand-member` (preserve `verify_jwt=true`) + shared-email consumers (`ticket-confirmation-dispatch` and any transactional-email dispatcher) from MERGED main.

---

## 10. P4 praise

- **P4-1:** Escape discipline is genuinely correct — every attacker-controlled interpolation in the new polish blocks flows through `sharedEscapeHtml(...)` at the call site, and the outer `bodyHtml` is a pure `${var}` concatenation so the 0785-C gate is satisfied without contortions. My hostile-input adversarial suite could not find a single leak.
- **P4-2:** The AA fix is surgical, not a blanket purge — the decorative `#FF6B2C` border (the outline-vs-fill hierarchy signal) and the personal-note left rule are correctly preserved while only white-text button fills were darkened. My "surgical" guard (asserting the decorative border survives) confirms it.

---

## 11. Discoveries for Orchestrator (not fixed here)

- **D-1 (pre-existing red → ORCH-1330):** `shell.test.ts` tax-jurisdiction-label test fails on pristine main (§6). The `_shared/email` `deno test` suite is RED on main independent of this work; any future email PR sees 33/1. Recommend closing ORCH-1330 (renderer should emit `Tax (…jurisdictions…)` or the test should be corrected to the inclusive-VAT contract).
- **D-2 (0785-D scope note):** the shell-singleton gate greps `.ts` files under `supabase/functions/**` INCLUDING `__tests__` (unlike the 0785-C escape gate which skips tests). Any future email test that references a literal `<!doctype html>` string will trip it — assemble the needle from fragments (as this test now does). Worth a one-line note in the gate's header or a `__tests__` skip, but out of ORCH-1329 scope.
- **D-3 (carried from investigation/impl, unchanged):** the two `renderDownloadAppCta()` helpers (ticket/trip) still deep-link to the CONSUMER `/orders/{id}/chat`; a brand owner receiving a ticket/trip email is sent to the consumer app. Cross-app-attribution note, out of this ORCH's scope.

---

## 12. Routing

**PASS → CLOSE** (orchestrator). No P0/P1. Regression gate satisfied. The single email-suite red is the pre-existing ORCH-1330 tax-label failure (confirmed identical on origin/main), not a CLOSE blocker for ORCH-1329.
