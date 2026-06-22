# IMPLEMENTATION — ORCH-1219 (explorer form multi-select + no auto-advance + always-email TestFlight link)

Branch: `1219-form-multiselect-no-autoadvance` (off clean origin/main)
Worktree: `~/Desktop/mingla-orchs/1219-form-multiselect-no-autoadvance/`
Commit: **`6d25710d0`**
Date: 2026-06-22

Status: **COMPLETE — self-verified, fails-on-revert proven.** NOT deployed, NOT merged, NOT closed,
migration NOT applied, edge fn NOT deployed, no `eas update`. Those are orchestrator CLOSE steps.

---

## 1. Scope delivered (the 4 Seth-directed fixes)

- **Fix A** — explorer interest is now MULTI-SELECT with NO auto-advance. Chips toggle via
  `role="group"` + `aria-pressed` (not radiogroup/radio); `step1Valid = interest.length >= 1`;
  user presses **Next**. State `string` → `string[]`; transport `interest` → `string[]`.
- **Fix B** — organiser brand-type form: removed the 220ms pointer auto-advance; brand-type STAYS
  single-select; user presses Next. No BetaAccessModal test asserted auto-advance (verified — none
  existed), so no test was modified for Fix B; the commit body still carries `[TEST-MOD-APPROVED ORCH-1219]`.
- **Fix C** — platform-accurate copy. 3-way `Platform` = `ios | android | other` (new `resolvePlatform`
  adds `/android/i`; everything else = `other` = desktop). SuccessPanel: iOS keeps the on-screen
  TestFlight link + "We've also emailed you the link."; Android keeps the iOS-only message + "We've
  emailed you the TestFlight link to open on your iPhone."; desktop/other gets a neutral "Mingla's in
  beta on iPhone & iPad… We've emailed you the TestFlight link" message — **desktop never claims the
  user is on Android**, and NEITHER non-iOS sub-branch shows an on-screen link. DB `platform` CHECK
  widened to add `'android'`. Transport platform 3-way.
- **Fix D** — ALWAYS email the LEAD the branded iOS TestFlight link on every newly **created** submit
  (iOS AND non-iOS — Seth: "also send when the user is on ios too"). New `buildDownloadLinkEmail`
  (built through `renderShell` + a CTA button, mirroring `buildInviteEmail`) → the lead's address via
  the no-reply system sender (`EMAIL_SENDERS.system`, `assertNotResendSandbox`). Best-effort /
  non-fatal (lead is already saved). Internal `seth@usemingla.com` notify kept (both send). On
  `already_on_list` (duplicate) the user email is NOT re-sent — the duplicate returns BEFORE the send
  block (idempotency parity with the internal notify).

---

## 2. Files created / changed (purpose) — all in commit `6d25710d0`

| File | Purpose |
|---|---|
| `mingla-marketing/components/marketing/get-the-app-modal.tsx` (M) | Fix A multi-select toggle + no auto-advance; Fix C 3-way platform + `resolvePlatform` + 3-way SuccessPanel copy + "we emailed it too" line. |
| `mingla-marketing/components/marketing/beta-access-modal.tsx` (M) | Fix B — removed the 220ms `setStep(2)` pointer auto-advance; brand-type stays single-select. |
| `mingla-marketing/lib/explorer-app-submit.ts` (M) | Transport: `interest: string` → `string[]`; `platform: 'ios'|'other'` → `'ios'|'android'|'other'`. |
| `supabase/functions/explorer-app-lead-submit/index.ts` (M) | Validator: interest non-empty array of allowed values + `android` platform; insert array; new `normaliseInterest` + `buildDownloadLinkEmail` (Fix D) sent on the created path; notify subject/rows render the joined interest label. |
| `supabase/migrations/20261125000000_orch_1219_explorer_interest_multi_platform_android.sql` (A) | interest `text`→`text[]` (+ array CHECK: every elem ∈ enum AND `array_length ≥ 1`); platform CHECK `+'android'`; `admin_explorer_app_leads_list()` returns `interest text[]`. Idempotent/guard-safe. |
| `supabase/functions/explorer-app-lead-submit/__tests__/submit_happy.test.ts` (M) | Updated for the new contract `[TEST-MOD-APPROVED ORCH-1219]` + NEW implementor happy-path asserts (multi-value round-trip, de-dupe, 3 platforms, `buildDownloadLinkEmail` → lead on iOS + non-iOS). |
| `supabase/functions/explorer-app-lead-submit/__tests__/submit_adversarial.test.ts` (M) | `[TEST-MOD-APPROVED ORCH-1219]` — interest array-element rejects + empty/bare-string reject; `android` removed from the platform reject-set (now accepted). |
| `.github/scripts/strict-grep/i-proposed-1219-always-email-download-link.mjs` (A) | NEW gate (Fix D / pre-staged invariant): edge fn builds (`renderShell` + TestFlight URL) and sends the lead email on the created path, after the `already_on_list` return. |
| `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs` (A) | NEW gate (Fix A/B): explorer = multi-select `string[]` + `role="group"`/`aria-pressed` + `interest.length` + no auto-advance; organiser = single-select + no auto-advance. |
| `.github/workflows/strict-grep-mingla-business.yml` (M) | Wired both new gates as jobs (`orch-1219-always-email-download-link`, `orch-1219-form-no-autoadvance-multiselect`) with `--self-test` + live. |

---

## 3. Verification results (exact)

- **Marketing `tsc --noEmit`**: `EXIT=0` (clean). (`node_modules` was installed in the worktree for
  the typecheck; it is gitignored, not committed.)
- **`deno check supabase/functions/explorer-app-lead-submit/index.ts`**: PASS (exit 0).
- **Deno tests** (`deno test --allow-env --allow-net …/__tests__/` with `DENO_TESTING=1` +
  `MINGLA_LOGO_URL` + `MINGLA_FOOTER_ADDRESS`): **31 passed | 0 failed** (18 happy + 13 adversarial).
- **All 7 strict-grep gates** (5× `i-proposed-1216-*` + 2× new `i-proposed-1219-*`): **7/7 PASS**
  (each `--self-test` AND live).
  - The 5 ORCH-1216 gates still PASS with **NO matcher edits** — the nested-ternary refactor
    preserved the `isIos ? ( … ) : ( … )` shape, `<SuccessPanel` mounts once under
    `status === 'success'` with `platform={platform}`, and the TestFlight URL stays only in the iOS
    success branch of the modal (the edge-fn email URL is a different file the modal gate doesn't scan).

---

## 4. Fails-on-revert proof (in the working tree, then restored)

| Guard | Revert applied | Result |
|---|---|---|
| `i-proposed-1219-form-no-autoadvance-multiselect` gate | explorer state → `useState('')` + `role="radiogroup"` | gate **EXIT=1** (fix → EXIT=0) |
| `i-proposed-1219-always-email-download-link` gate | replaced the `buildDownloadLinkEmail(lead, …)` send call with `buildNotifyEmail` | gate **EXIT=1** ("defined but never CALLED") (fix → EXIT=0) |
| `submit_happy.test.ts` (Fix A) | validator → scalar `interest` (old contract) | **9 passed / 9 FAILED** (fix → 18/0) |
| `submit_happy.test.ts` (Fix D) | `buildDownloadLinkEmail` `to` → `seth@usemingla.com` | **16 passed / 2 FAILED** (Fix D tests) (fix → 18/0) |

Working tree is clean after all restores (`git status` empty) and matches commit `6d25710d0`.

---

## 5. Gate matcher edits

- **No edits to any of the 5 existing `i-proposed-1216-*` gates were required.** The refactor kept the
  modal structures those gates key on (`function SuccessPanel`, the `isIos ? ( … ) : ( … )` ternary,
  the single `status === 'success'`-gated `<SuccessPanel platform={platform} …>` mount). The android
  no-link gate isolates the non-iOS branch via `isIos ? (…) : ( other )`; my `other` branch now
  internally does `isAndroid ? (…) : (…)` and neither sub-branch contains the token or the "Open in
  TestFlight" label, so the gate still passes.
- **One mid-build fix inside the NEW email gate** (not a 1216 matcher): the builder-body isolation
  initially used a brace-depth scan that miscounted the dense `${…}` / inline-CSS `{…}` of the email
  HTML. Switched to slicing the builder def → the next top-level `function` decl, and the "is it
  called?" check now finds the first `buildDownloadLinkEmail(` occurrence that is NOT the definition.

---

## 6. What the TESTER / ORCHESTRATOR must know before TEST / DEPLOY

1. **Migration NOT applied to the live DB** — `20261125000000_orch_1219_…sql`. Prefix verified FREE on
   `origin/main` AND across all sibling worktrees' `supabase/migrations/`. The `explorer_app_leads`
   table is empty in prod, so the `interest text → text[]` conversion is clean. Apply on CLOSE (from
   merged main). Migration is idempotent / guard-safe (DO-block constraint discovery + `drop … if exists`).
2. **Edge fn NOT deployed** — `explorer-app-lead-submit`. Deploy from merged main on CLOSE. The
   migration must land FIRST (the insert now writes a `text[]` interest + may write `platform='android'`).
3. **`RESEND_API_KEY` + `MINGLA_FROM_EMAIL`** are already set in prod (per the dispatch). The branded
   lead email also reads `MINGLA_LOGO_URL` / `MINGLA_FOOTER_ADDRESS` / `SUPPORT_EMAIL` (already wired
   for the rest of the transactional pipeline) and resolves the sender via `EMAIL_SENDERS.system`
   (`RESEND_SYSTEM_FROM`, default `Mingla <notifications@usemingla.com>`).
4. **LIVE-SEND WARNING for the tester**: the Fix D email goes to the **real lead address** on every
   created submit. Any e2e that POSTs a real-looking new email WILL trigger a live Resend send to that
   address. The tester must **mock / guard live sends** (use a sink address you own, or stub the Resend
   POST) — do not fire real leads at arbitrary inboxes. The send is best-effort/non-fatal, so a stubbed
   failure does not change the 200 `created` response.
5. **Adversarial coverage gap (intentional, tester-owned)**: I updated the existing adversarial test
   to the new contract but the tester should add the *adversarial half* — e.g. an `interest` array
   that exceeds the 5-value cap, a 6-element duplicate-laden array, a `platform='android'` end-to-end
   insert assertion against the widened CHECK, and a handler-level proof that a duplicate
   (`already_on_list`) does NOT call `buildDownloadLinkEmail` (the gate proves the call sits after the
   early return, but a runtime assertion would harden it).
6. **No native / app-mobile / mingla-business changes; no new npm deps in mingla-marketing.** The anon
   key stays client-only; service role stays in the edge fn (the `no-service-key-client` gate still
   scans 86 marketing files clean).
