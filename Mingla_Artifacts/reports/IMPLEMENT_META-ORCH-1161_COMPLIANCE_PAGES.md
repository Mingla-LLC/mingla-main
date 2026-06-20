# IMPLEMENT — META-ORCH-1161 — COMPLIANCE-PAGES slice

**ORCH:** META-ORCH-1161 (multi-channel notification & messaging system) — COMPLIANCE-PAGES slice
**Phase:** mingla-implementor (single bounded pass)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[compliance-pages]/` on branch `ORCH-1161-compliance-pages` (based on origin/main, up to date)
**Date:** 2026-06-20
**Status:** implemented and verified (web build + deno tests green; live edge write is UNVERIFIED until deploy — see §9)

---

## 1. Summary

Built the two marketing-site compliance pages Seth asked for plus the public opt-out backend they depend on:

1. **`/sms-terms`** — a static SMS program-terms page (carrier/toll-free-verification grade), mirroring the existing `/terms-of-service` page structure + styling.
2. **`/unsubscribe`** — a self-serve, no-login opt-out page: enter email and/or phone (E.164), choose "Marketing only" or "All messages", submit → suppressed immediately. Reads `?token=` (one-click email link) and pre-fills/uses the tokenized path server-side. Full idle/submitting/success/error/validation states.
3. **`self-serve-unsubscribe`** edge function (new, `verify_jwt = false`) — accepts `{email?, phone?, scope, token?}`, validates, and writes BOTH `channel_suppressions` (per channel) AND legacy `marketing_unsubscribes` (global, for audience-resolver back-compat), idempotently, via the service role, behind a per-IP rate limit.

No migration was needed — `channel_suppressions`, `marketing_unsubscribes`, and the `verifyUnsubscribeToken` helper all already exist on origin/main (Sub-A foundation + ORCH-0815-B).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | `/sms-terms` renders compliant SMS program terms (identity, address, message types, frequency, "Msg & data rates may apply", STOP/HELP, support, links to ToS/Privacy/unsubscribe) | ✓ | `mingla-marketing/app/sms-terms/page.tsx` + `lib/smsTermsContent.ts`; build emits `○ /sms-terms`; all required elements present (§7 receipts) |
| SC-2 | `/unsubscribe` self-serve form: email AND/OR phone + marketing-vs-all choice, POSTs to backend, success/error states, opt-out honored immediately stated, works standalone (no login) | ✓ | `mingla-marketing/app/unsubscribe/page.tsx` + `UnsubscribeForm.tsx`; build emits `○ /unsubscribe` (2.92 kB) |
| SC-3 | `?token=` pre-fill / tokenized path | ✓ | `UnsubscribeForm` reads `useSearchParams().get('token')`; passes `token` to fn; fn calls `verifyUnsubscribeToken` and uses `recipient_email` |
| SC-4 | Backend endpoint writes channel_suppressions (email row if email, sms row if phone; scope as chosen; reason='unsubscribe') AND marketing_unsubscribes, idempotent ON CONFLICT DO NOTHING, per-IP rate limit (~12/min fail-open), service-role | ✓ | `supabase/functions/self-serve-unsubscribe/{index,suppress}.ts`; behavioral test (§6); `[functions.self-serve-unsubscribe] verify_jwt=false` added to config.toml |
| SC-5 (Step 0.5) | Test proves the endpoint writes both tables for email and phone, idempotently, fails-on-revert | ✓ | `suppress.test.ts` 6/6 green; fails-on-revert proven (§6) |

---

## 3. Files changed

| File | Type | ~Lines |
|------|------|--------|
| `mingla-marketing/lib/smsTermsContent.ts` | new | 95 |
| `mingla-marketing/app/sms-terms/page.tsx` | new | 160 |
| `mingla-marketing/lib/unsubscribe-submit.ts` | new | 97 |
| `mingla-marketing/app/unsubscribe/UnsubscribeForm.tsx` | new | 270 |
| `mingla-marketing/app/unsubscribe/page.tsx` | new | 85 |
| `supabase/functions/self-serve-unsubscribe/suppress.ts` | new | 165 |
| `supabase/functions/self-serve-unsubscribe/index.ts` | new | 205 |
| `supabase/functions/self-serve-unsubscribe/suppress.test.ts` | new (test) | 175 |
| `supabase/config.toml` | edit (+10) | 10 |

No existing product code modified (config.toml is append-only registration). No existing test modified/deleted (append-only rule honored).

---

## 4. Data-model changes applied

NONE. No migration. Writes target existing tables:
- `public.channel_suppressions` — `{user_id:null, contact, channel:'email'|'sms', scope:'marketing'|'all', reason:'unsubscribe', brand_id:null}`. All values CHECK-valid (verified against `20261110000000_orch_1161_notification_foundation_tables.sql`).
- `public.marketing_unsubscribes` — `{contact_email|contact_phone (exactly one per CHECK), channel:'all', scope:'global', brand_id:null, account_id:null, reason:'self_serve_unsubscribe'}`. CHECK-valid; `channel='all'` so the audience resolver (`_shared/marketingAudience.ts`, which expands `'all'`→email+sms+rcs and filters `scope.eq.global`) honors it.

---

## 5. Edge functions touched

| Function | verify_jwt | Note |
|----------|-----------|------|
| `self-serve-unsubscribe` | **false** (preserve) | NEW. Public/anon by design (CAN-SPAM: page must work with no login). Per-IP throttle + service-role write. Registered in config.toml. |

Deploy from MERGED main (not the worktree). No other edge fn touched.

---

## 6. Regression test (implementor-owned happy-path)

- **Path:** `supabase/functions/self-serve-unsubscribe/suppress.test.ts` (6 Deno tests).
- **Command:** `deno test --allow-read supabase/functions/self-serve-unsubscribe/` → `ok | 6 passed | 0 failed`.
- **Coverage:** email-only writes channel_suppressions(email)+marketing_unsubscribes(email) with exact CHECK-valid row shapes; phone-only writes channel_suppressions(sms)+marketing_unsubscribes(phone); email+phone writes all 4 rows; idempotent (all-keys-conflict → 0 new rows, reported as already-suppressed, 200-equivalent); non-unique DB error throws (no silent failure); `isUniqueViolation` unit.
- **fails-on-revert verified at `a5d4a03c2bfa84839dff5c9ce2409caf2dc1767e`** (HEAD before the slice commit): true line-deletion of the `marketing_unsubscribes` write loop in `suppress.ts` → 4 of 6 tests FAILED; restoring the loop → 6/6 PASS again. (Deletion, not comment-out.)

---

## 7. Old → New receipts

### supabase/functions/self-serve-unsubscribe/ (new)
**Before:** no public no-login opt-out endpoint existed; only the tokenized one-click `marketing-unsubscribe` (requires a signed email token) and the in-app/STOP paths.
**Now:** a public fn accepts a typed email/phone + scope (and optionally a token), validates (email regex, E.164 regex, scope allowlist), and writes both suppression models via the service role, idempotently, behind a 12/min per-IP fail-open throttle mirroring `record-consent`.
**Why:** SC-4 / COPY §4 §5.1 — the CAN-SPAM footer + consent line reference `https://www.usemingla.com/unsubscribe`, which must actually suppress for anyone, with no login.

### mingla-marketing/app/sms-terms/ (new)
**Before:** route 404'd; COPY §5.1 flagged `/sms-terms` as a page-to-create; consent line referenced a dead URL.
**Now:** static program-terms page (9 sections) with Mingla LLC identity + 700 Corporate Center Dr address + support@usemingla.com + +1 888-250-5351, message types, "Message frequency varies", "Msg & data rates may apply", STOP/HELP, carrier-liability + privacy language, and footer links to ToS/Privacy/Unsubscribe.
**Why:** SC-1 / COPY §5.1 — often required for carrier/toll-free verification.

### mingla-marketing/app/unsubscribe/ (new)
**Before:** route 404'd; COPY §5.1 page-to-create; CAN-SPAM footer + email unsubscribe links had no destination.
**Now:** server shell (matches the ToS page chrome) wrapping a `'use client'` form in `<Suspense>` (lets the route prerender statically despite `useSearchParams`). Form: email + phone inputs (inline validation), marketing/all radios, submit→`self-serve-unsubscribe`, success state ("You're opted out … honored immediately"), distinct error copy per failure (validation / invalid_token / rate_limited / server / network), reads `?token=`.
**Why:** SC-2/SC-3 / COPY §4 §5.1.

---

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | marketing-site + edge fn only |
| Consumer Android | No | same |
| Buyer/anon Web (mingla-business) | No | separate app; the CAN-SPAM footer links here but is authored elsewhere |
| Business iOS | No | — |
| Business Android | No | — |
| Admin Web | No | — |
| **Marketing Web (mingla-marketing)** | **YES** | two new public routes `/sms-terms`, `/unsubscribe`; deploys via Vercel `[deploy]` |
| **Backend (supabase edge)** | **YES** | new `self-serve-unsubscribe` fn; deploys from merged main |

Parity: automatic — single marketing app, single edge fn. No manual multi-surface mirroring.

---

## 9. Smoke result / verification matrix

- **Marketing app typecheck:** `npm run typecheck` (tsc --noEmit) → clean, whole app incl. 4 new files.
- **Marketing app production build:** `npm run build` → ✓ Compiled successfully; `○ /sms-terms` (175 B) and `○ /unsubscribe` (2.92 kB) both prerendered; 12/12 static pages generated.
- **Edge fn typecheck:** `deno check` on `index.ts` and `suppress.ts` → both Check OK.
- **Edge fn tests:** `deno test` → 6/6 pass; fails-on-revert proven (§6).
- **Strict-grep gates:** `orch-0847-marketing-opt-in-default-unchecked`, `orch-0863-marketing-hub-phase-b`, `i-proposed-1161-sms-from-approved-sender-and-kill-switch` → all PASS.
- **UNVERIFIED (needs deploy):** the live edge write to the real DB (no live-fire against the deployed fn yet). The behavioral test proves the write LOGIC with a fake client + asserts CHECK-valid row shapes against the real DDL; the live round-trip is for the tester post-deploy. `lint` (next lint) is interactive-unconfigured in this repo and was not run; typecheck + build cover the same surface.

---

## 10. Known issues / deferred (backlog for orchestrator)

- **Notification-preferences matrix UI** — OUT OF SCOPE (Sub-A prefs UI). Not built.
- **Sub-C moments** (reminders cron, purchase push) and **Sub-B marketing SMS send** — OUT OF SCOPE.
- **In-app preference center deep-link** — the success copy points opted-out users to `support@usemingla.com`; an in-app "manage preferences" deep-link can be added when the prefs UI ships.
- **Live-fire DB round-trip** — defer to tester after the fn is deployed (verify a real `channel_suppressions` + `marketing_unsubscribes` row lands for a test email/phone, and that a re-submit is idempotent).
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

1. **Deploy the edge function from MERGED main** (NOT the worktree):
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main && /Users/sethogieva/bin/supabase functions deploy self-serve-unsubscribe
   ```
   Preserve `verify_jwt = false` (already in config.toml). It requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (already set for the project) and, for the tokenized path, the existing `UNSUBSCRIBE_TOKEN_SECRET`.
2. **Deploy the marketing pages via Vercel** — these ship on a `[deploy]`-tagged commit to main (mind the Vercel `[deploy]`-gate cancel trap: if a non-`[deploy]` commit lands after, push an empty `[deploy]` commit). Confirm `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in the Vercel env (they are, per `.env.example` defaults).
3. **No migration to push** — none was added.

---

## 12. Discoveries for Orchestrator

- **COMMS scan:** no BLOCK+OPEN row addressed to mingla-implementor / ORCH-1161 / ALL. The open WARN-to-ALL rows (RSVP-page standardization 0040/0041, Stripe seller copy 0021, etc.) do not touch the marketing `/sms-terms` `/unsubscribe` routes or the unsubscribe edge fn. No new COMMS entry warranted.
- **Two suppression models coexist** (`channel_suppressions` new + `marketing_unsubscribes` legacy). This slice writes BOTH per the dispatch. When Sub-B/C migrate the send-path fully onto `channel_suppressions`, the legacy `marketing_unsubscribes` write here can be retired — flag for that ORCH.
- **`marketing_unsubscribes` CHECK forbids both contacts in one row** — handled by splitting into one row per contact. Anyone extending this table must respect that constraint.
