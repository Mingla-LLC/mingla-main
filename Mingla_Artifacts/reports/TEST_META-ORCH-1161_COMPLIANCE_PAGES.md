# TEST — META-ORCH-1161 — COMPLIANCE-PAGES slice

**ORCH:** META-ORCH-1161 — COMPLIANCE-PAGES slice (`/sms-terms` + `/unsubscribe` + `self-serve-unsubscribe` edge fn)
**Skill:** mingla-tester (canonical TEST owner)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[compliance-pages]/` on branch `ORCH-1161-compliance-pages`
**HEAD tested:** `10df8081f` (dispatch named `495c1f297`; `10df8081f` is the rebased-on-main sibling with byte-identical slice content — see note below)
**Date:** 2026-06-20

---

## 1. Verdict

**CONDITIONAL PASS** — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 2 P4.

CLEAR-TO-CLOSE after merge, with ONE post-deploy confirmation the orchestrator must perform (the live edge-fn round-trip — explicitly a post-deploy step per the dispatch, NOT a pre-merge blocker). The single non-blocking condition is the post-deploy live-fire; no P1/P2 defects exist, so this is a clean conditional gated only on the deploy step the dispatch already carved out.

**Commit note (non-defect):** the dispatch cites `495c1f297`; the worktree HEAD is `10df8081f`. Verified `git cat-file` content of both: same slice, `10df8081f` is `495c1f297` rebased on top of `00710f41b` (RSVP) + `a5d4a03c2` (consent). The slice files are identical. Tested against HEAD `10df8081f`.

**Exemption posture:** the marketing pages are web-static (no interactive runtime state machine beyond the form, which I exercised by source + build-prerender + transport trace); the edge fn + DB writes are backend-only → source + live-Postgres evidence is the correct evidence class. No simulator surface (no app-mobile / business-app change). Live device matrix N/A; live edge round-trip deferred to post-deploy per dispatch.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | `/sms-terms` renders compliant SMS program terms (Mingla LLC identity, address, msg types, frequency, "Msg & data rates may apply", STOP/HELP, support, ToS/Privacy/unsubscribe links) | **PASS** | `lib/smsTermsContent.ts` 9 sections — Mingla LLC + "700 Corporate Center Dr, Raleigh, NC 27607" + support@usemingla.com + +1 888-250-5351 + msg types + "Message frequency varies" + "Msg & data rates may apply" + STOP(+QUIT/END/CANCEL/UNSUBSCRIBE/REVOKE/OPT OUT) + HELP + carrier-liability + privacy/terms; page links to /sms-terms/privacy/terms. Build prerenders `○ /sms-terms` (106kB). |
| SC-2 | `/unsubscribe` self-serve form: email AND/OR phone + marketing-vs-all, POSTs to backend, success/error/validation states, "honored immediately" stated, works no-login | **PASS** | `UnsubscribeForm.tsx` — email+phone inputs (inline EMAIL/E.164 validation, aria-invalid), marketing/all radios, submit→`submitUnsubscribe`, idle/submitting/success/error states, distinct error copy per failure (validation/invalid_token/rate_limited/server/network), "honored immediately" success + footer copy, no `useAuth`. Build prerenders `○ /unsubscribe` (115kB). |
| SC-3 | `?token=` pre-fill / tokenized one-click path | **PASS** | Form reads `useSearchParams().get('token')`, passes it to the fn; with a token present `hasContact=true` so no typed contact is needed (one-click works). Edge fn `verifyUnsubscribeToken(token)` → uses `recipient_email` (lowercased) when no typed email; bad token + no contact → `invalid_token` (page falls back to manual form). |
| SC-4 | Backend writes channel_suppressions (email row if email, sms row if phone, scope-as-chosen, reason='unsubscribe') AND marketing_unsubscribes (one row per contact, scope='global', channel='all'), idempotent, per-IP rate limit fail-open, service-role | **PASS** | `suppress.ts` writes exactly those rows. **Verified against LIVE Postgres** that every value is CHECK-valid: `channel_suppressions` channel∈{email,sms}, scope∈{transactional,marketing,all}, reason∈{...,unsubscribe}; `marketing_unsubscribes` channel∈{...,all}, scope∈{...,global}, "exactly one of email/phone" CHECK + scope='global'⇒brand/account NULL CHECK. Idempotency via real unique indexes `channel_suppressions_uniq_idx` + `uq_unsub_email_channel_scope` + `uq_unsub_phone_channel_scope` → 23505 tolerated. Rate limit 12/min per-IP sliding window, fail-OPEN on null IP (index.ts:55-67), runs BEFORE parse/DB. |
| SC-5 | Test proves both-table write for email + phone, idempotent, fails-on-revert | **PASS** | `suppress.test.ts` 6/6 green; fails-on-revert independently re-run (§4). |

---

## 3. Findings

### P3-1 — `console.warn` on rate-limit logs the raw client IP (PII-adjacent)
**Evidence:** `index.ts:107` `console.warn("[self-serve-unsubscribe] rate-limited", { ip: requestIp })`.
**Impact:** raw IP in edge logs. Low — operational logs, short retention, no user-facing exposure; matches the `record-consent` precedent. Not a blocker.
**Required fix (optional):** hash/truncate the IP in the log line, or drop the `ip` field.
**Retest:** grep the deployed fn log line.

### P4-1 (praise) — Idempotency designed against the REAL unique indexes
The COALESCE-based `channel_suppressions_uniq_idx` (`(COALESCE(user_id,contact),channel,scope,COALESCE(brand_id,'global'))`) means a re-submit of the same anon contact/channel/scope collides → 23505 → counted as `alreadySuppressed`, returns 200. Verified the index expression matches the written row shape exactly. Clean Constitution-#3 posture: non-unique errors throw (no silent failure), unique violations are tolerated.

### P4-2 (praise) — Email lowercasing closes a real case-mismatch suppression bypass
`index.ts` lowercases the email on BOTH the typed-email (`:134`) and token-recipient (`:144`) paths, and `can_send()` matches `s.contact = lower(p_contact)`. I proved on live Postgres (§5) that this is load-bearing: a mixed-case stored contact would let a normalized-case send slip through. Correctly fenced.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out worktree HEAD `10df8081f`. Ran `deno test --allow-read supabase/functions/self-serve-unsubscribe/` → **`ok | 6 passed | 0 failed`**.
- **True line-deletion** of the `for (const row of legacyRows) { ... }` marketing_unsubscribes write loop in `suppress.ts` (deletion, not comment-out) → re-ran tests → **`FAILED | 2 passed | 4 failed`** (the email-only, phone-only, email+phone, and idempotent tests fail at their row-shape assertions). Restored the file → `git diff` empty (clean). **Implementor's fails-on-revert claim independently CONFIRMED** at `10df8081f`.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Angle:** email-case-mismatch suppression **bypass** — an angle the implementor's happy-path suite did not cover.
- **Live-Postgres proof (read-only, BEGIN/ROLLBACK):**
  - Edge-fn behavior (lowercased contact stored) → `can_send(NULL,'buyer_event_reminder','email','Adversary@Example.COM')` = **false** AND for the lowercased address = **false** → suppression honored for ANY casing. ✓
  - Regression sim (lowercasing removed → mixed-case `Adversary@Example.COM` stored) → `can_send(...,'adversary@example.com')` = **true** (NOT suppressed) → the opted-out user still receives mail = the **BYPASS**. ✓ proven.
  - (Side discovery, §7) `can_send` returns false for any non-transactional category with a NULL user even with no suppression row — the marketing anon-send path relies on the `marketing_unsubscribes` audience resolver, not `can_send`. The resolver lowercases both the unsub email (`marketingAudience.ts:214`) and the buyer email (`:240`) → case-insensitive there too.
- **Test path:** `supabase/functions/self-serve-unsubscribe/case_bypass.test.ts` (NEW, append-only). Two asserts: (1) writer stores `contact` verbatim → proves normalization MUST be upstream; (2) `index.ts` lowercases on BOTH email-resolution paths (the actual bypass fence).
- **fails-on-revert verified at `10df8081f`:** removed `.toLowerCase()` from both `index.ts` email lines → adversarial test → **`FAILED | 1 passed | 1 failed`** (the enforcement-guard assertion fails). Restored → `git diff` empty; test → 2/2 pass.
- **In closing diff:** confirmed both `suppress.test.ts` and `case_bypass.test.ts` appear in `git diff main...HEAD --name-only`. Adversarial test committed to the branch.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | Opt-out button wired→`submitUnsubscribe`; disabled only when no valid contact/submitting. |
| 2 | One owner per truth | PASS | `suppress.ts` is the SOLE DB-write path; index.ts only validates/normalizes. |
| 3 | No silent failures | PASS | Non-unique DB error throws→500; bad token w/no contact→`invalid_token`; missing env→`server_misconfigured`; unique violation correctly tolerated (not a failure). |
| 4 | One query key per entity | N/A | No React Query. |
| 5 | Server state stays server-side | PASS | Form uses local `useState` for form fields only. |
| 6 | Logout clears everything | N/A | Anon/no-login by design. |
| 7 | `[TRANSITIONAL]` labeled | N/A | None introduced. |
| 8 | Subtract before adding | PASS | No migration; reuses existing tables + token helper. |
| 9 | No fabricated data | PASS | Real Mingla LLC identity/address/phone; no placeholders. |
| 10 | Currency-aware | N/A | No money. |
| 11 | One auth instance | PASS | Marketing app uses raw fetch + anon key; no Supabase client/auth. |
| 12 | Validate at right time | PASS | E.164 + email regex client AND server; scope allowlist server-side. |
| 13 | Exclusion consistency | PASS | Writes BOTH suppression models so every send-path (can_send + audience resolver) honors the opt-out, case-insensitively. |
| 14 | Persisted-state startup | N/A | No hydration gate. |

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS | N/A | not touched |
| Consumer Android | N/A | not touched |
| Buyer/anon Web (mingla-business) | N/A | separate app; CAN-SPAM footer links here but authored elsewhere |
| Business iOS / Android | N/A | not touched |
| Admin Web | N/A | not touched |
| **Marketing Web (mingla-marketing)** | **PASS (build/prerender)** | `npm run build` ✓ Compiled successfully; `○ /sms-terms` + `○ /unsubscribe` prerendered static; no `--clear` needed (the prior 1161 web-export gotcha did not recur). Runtime form behavior traced by source; live Vercel render = post-deploy. |
| **Backend (supabase edge)** | **PASS (logic) / NOT-YET-DEPLOYED** | `list_edge_functions` shows only legacy `marketing-unsubscribe` deployed; `self-serve-unsubscribe` not yet live. `verify_jwt=false` correctly set in config.toml:294-295 (public no-login path; fn self-validates — worst-case abuse is suppressing a contact = self-harm, low risk, rate-limited). |

**No-regression to existing fns:** `git diff main...HEAD` does NOT touch `marketing-unsubscribe`, `marketingAudience.ts`, or `marketingTokens.ts` — all untouched. Legacy tokenized unsubscribe + audience resolver unaffected.

---

## 8. Discoveries for Orchestrator

1. **Post-deploy live-fire (REQUIRED before declaring the page live, NOT a merge blocker):** after deploying `self-serve-unsubscribe` from MERGED main, POST a test `{email}` and `{phone}` → confirm one `channel_suppressions` row (lowercased contact) + one `marketing_unsubscribes` row each land; re-POST → 200 with `already_suppressed>0` and no dup rows; load the live `/unsubscribe` + `/sms-terms` on Vercel.
2. **`can_send` is opt-IN for anon marketing:** a NULL-user non-transactional category returns false regardless of suppression rows. The anon marketing SEND path therefore depends on the `marketing_unsubscribes` audience resolver, which this slice writes correctly (scope='global', channel='all', lowercased). Confirm Sub-B's blast send-path actually consults the resolver (out of this slice's scope).
3. **Two suppression models coexist** (`channel_suppressions` + legacy `marketing_unsubscribes`); the implementor flagged the legacy write can be retired when Sub-B/C fully migrate the send path. Track for that ORCH.
4. **P3-1** raw-IP log line — optional hardening.

---

## 9. Accepted conditions (CONDITIONAL PASS)

- **C-1 (post-deploy, dispatch-carved-out):** live edge-fn round-trip + live Vercel page render — orchestrator performs after merge+deploy. NOT a P1/P2; explicitly a post-deploy confirmation per the dispatch. No defect blocks merge.

---

## 10. Comms ledger

Read `COMMS_LEDGER.md` on entry. No BLOCK+OPEN row addressed to mingla-tester / ORCH-1161 / ALL. The open WARN-to-ALL row COMMS-0040 (RSVP-page standardization) does not touch `/sms-terms`, `/unsubscribe`, or the unsubscribe edge fn. No ack required; no new entry warranted (FYI only, as expected by the dispatch).
