# IMPLEMENTATION — ORCH-1226 [careers applicant email sends from careers@usemingla.com]

Worktree: `~/Desktop/mingla-orchs/1226-[careers-applicant-from]/` on branch `1226-careers-applicant-from`
Status: **implemented and verified** (gate + Deno test green; fails-on-revert proven). Web/backend-only. NOT deployed, NOT merged.

## 1. Summary

The careers application **confirmation email to the APPLICANT** now sends FROM the careers identity
`Mingla Careers <careers@usemingla.com>` and carries a Resend `reply_to: "careers@usemingla.com"`, so
a candidate's reply lands in the careers inbox instead of the generic `notifications@` no-reply. The
**notification email to seth@usemingla.com is unchanged** — same `to: ["seth@usemingla.com"]`, same
system sender (`Mingla <notifications@usemingla.com>`), and NO `reply_to`.

The careers sender is built INLINE in `careers-apply/index.ts` (the SPEC's DO-NOT-TOUCH list forbids
editing `_shared/email/senders.ts`), mirroring that module's `resolveSender` env-override pattern: an
optional `RESEND_CAREERS_FROM` env var overrides the default, and the same `assertNotResendSandbox`
guard runs on the careers identity before it is used. Zero `_shared` files were touched.

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified | Commit |
|----|-----------|----------|--------|
| SC-1 | Applicant email `from` = careers identity (display "Mingla Careers", address `careers@usemingla.com`), via `formatSenderHeader` + `assertNotResendSandbox` guard | ✓ gate real-run PASS + Deno test `email.from.includes("careers@usemingla.com")` | `f25970c49` |
| SC-2 | Optional env override `RESEND_CAREERS_FROM` defaulting to careers@ (inline, no senders.ts edit) | ✓ `resolveCareersSender()` mirrors `resolveSender`; `deno check` OK | `f25970c49` |
| SC-3 | Applicant Resend payload sets `reply_to: "careers@usemingla.com"` (applicant only) | ✓ gate + Deno test `assertEquals(email.reply_to, "careers@usemingla.com")` | `f25970c49` |
| SC-4 | seth@ NOTIFY email untouched (same `to`, same system sender, no reply_to) | ✓ Deno test asserts `to=["seth@usemingla.com"]` AND `reply_to === undefined` | `f25970c49` |
| SC-5 | CI-enforced regression guard (strict-grep gate wired into the workflow, with --self-test) | ✓ `orch-1226-careers-applicant-from` job; self-test 5/5 PASS | `f25970c49` |
| SC-6 | Deno regression test, passes on fix, fails on revert | ✓ 17 passed; value-revert → 1 failed | `f25970c49` |

## 3. Files changed

| File | Change | ~lines |
|------|--------|--------|
| `supabase/functions/careers-apply/index.ts` | inline careers sender + applicant `reply_to` + split applicant/notify `from` | +45 / -6 |
| `supabase/functions/careers-apply/__tests__/apply_happy.test.ts` | +2 ORCH-1226 test cases (append-only) | +42 / 0 |
| `.github/scripts/strict-grep/i-proposed-1226-careers-applicant-from.mjs` | NEW strict-grep gate (+--self-test) | +156 new |
| `.github/workflows/strict-grep-mingla-business.yml` | NEW job `orch-1226-careers-applicant-from` (self-test + real-run steps) | +13 / 0 |

## 4. Data-model changes applied

None. No migration. No schema/RLS change.

## 5. Edge functions touched

- `careers-apply` — `verify_jwt=false` (PUBLIC; unauthenticated careers site). PRESERVE this value
  on deploy; NOT changed by this work. Source change only — NOT deployed (orchestrator/operator
  deploys from merged `main`). Optional new env var `RESEND_CAREERS_FROM` (defaults to
  `careers@usemingla.com` if unset — no env change required to ship correct behavior).

## 6. Regression tests added

- Strict-grep gate: `.github/scripts/strict-grep/i-proposed-1226-careers-applicant-from.mjs`
  (self-test PASS 5/5; real-run PASS).
- Deno test: 2 new cases in `supabase/functions/careers-apply/__tests__/apply_happy.test.ts`
  (append-only; total 17 tests, 17 passed).
- **fails-on-revert verified at `eec2d952c9d6405ce1a149ccda685230fc62b178`** (pre-commit working tree):
  - Value-revert (point the careers `reply_to`/sender constant at `notifications@`): Deno test → **1 failed**
    (`ORCH-1226 — applicant email sets a careers Reply-To` FAILED); gate → **exit 1**
    (`applicant Resend payload must set reply_to to "careers@usemingla.com"`).
  - Wiring-revert (applicant `from` → `notifyFrom`, drop the `reply_to` line): gate → **exit 1**
    (two failures: missing reply_to + buildApplicantEmail not called with `applicantFrom`).
  - Fix restored → `deno check` OK, Deno test 17/17 PASS, gate self-test 5/5 PASS, gate real-run PASS.

## 7. Old → New receipts

### supabase/functions/careers-apply/index.ts
- **Before:** both the applicant confirmation AND the seth@ notify shared ONE `from`, derived from
  `EMAIL_SENDERS.system` (`Mingla <notifications@usemingla.com>`); the applicant payload had NO
  `reply_to`, so replies went to the no-reply notifications address.
- **Now:** an inline `resolveCareersSender()` (env `RESEND_CAREERS_FROM`, default
  `Mingla Careers <careers@usemingla.com>`) builds an `applicantFrom`, guarded by
  `assertNotResendSandbox`; `buildApplicantEmail(...)` returns `reply_to: CAREERS_REPLY_TO`
  (`careers@usemingla.com`); the notify still uses the system `notifyFrom` (renamed from `from`) with
  no reply_to and `to: ["seth@usemingla.com"]`. `sendEmail`'s payload type widened to accept either
  email shape so only the applicant payload carries `reply_to`.
- **Why:** SC-1/2/3/4 — applicant replies must reach the careers inbox; the seth@ notify must not change.

### supabase/functions/careers-apply/__tests__/apply_happy.test.ts
- **Before:** no assertion on the applicant `reply_to` or careers `from`; only the generic builder shape.
- **Now:** asserts applicant `reply_to === "careers@usemingla.com"` + careers `from`, and that the
  notify targets seth@ with `reply_to === undefined`.
- **Why:** SC-6 regression guard (append-only).

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | careers email is a backend edge-fn concern |
| Consumer Android | No | same |
| Buyer/anonymous Web | No | careers site triggers the fn but the change is server-side |
| Business iOS | No | unrelated |
| Business Android | No | unrelated |
| Admin Web (adjacent) | No | careers admin reads applications; sender unchanged there |
| Business Web preview (adjacent) | No | unrelated |

Only the `careers-apply` edge function (the careers marketing site's submit endpoint) is affected.
Parity is automatic — there is exactly one code path for the applicant email.

## 9. Smoke result

No simulator/device run (pure backend email-header change; no UI). Verified at the unit + gate layer:
`deno check` OK, `deno test` 17/17 PASS (incl. the 2 new ORCH-1226 cases), strict-grep gate self-test
5/5 PASS + real-run PASS, fails-on-revert proven by value-revert + wiring-revert.

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` markers. The `RESEND_CAREERS_FROM` env var is optional and defaults
correctly; setting it is not required for correct behavior.

## 11. Operator action required

- No migration (no `db push`).
- Edge deploy (orchestrator/operator, from MERGED `main`): deploy `careers-apply`
  (`--project-ref gqnoajqerqhnvulmnyvv`); preserve `verify_jwt=false`. Verify the
  `careers@usemingla.com` address is a verified Resend sending identity on the `usemingla.com`
  domain — if `careers@` is not a verified sender, Resend will reject the applicant send (it is
  best-effort/non-fatal, so the application still saves, but the confirmation won't deliver).
- Optional: set `RESEND_CAREERS_FROM` to override the display/address; unset = the careers default.

## 12. Discoveries for Orchestrator

- `careers@usemingla.com` must be a verified Resend sending identity on `usemingla.com` for the
  applicant confirmation to actually deliver (else it silently no-ops as best-effort). Flagging for
  the operator to confirm DNS/sender verification before relying on delivery.
- This worktree carries the `careers-apply` function under the **META-ORCH-1222** careers-site work
  (file header says META-ORCH-1222). COMMS-0060 notes an ORCH-1221/1222 careers-site numbering
  collision across unmerged worktrees — orchestrator should confirm ORCH-1226 (this branch) does not
  also collide before merge (`git fetch` + scan main/branches at CLOSE).
