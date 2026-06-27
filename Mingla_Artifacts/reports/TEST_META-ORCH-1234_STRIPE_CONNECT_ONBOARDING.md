# TEST — META-ORCH-1234: two Stripe Connect onboarding bug fixes

Tester: mingla-tester. Branch: `orch-1234-stripe-connect-onboarding-bugs`
(`042d761a2` Bug A, `9006f4e2f` Bug B, `4e645c434` gate, `c601c45b8` impl report).
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/orch-1234-[stripe-connect-onboarding-bugs]/`.

## VERDICT: PASS

Both fixes verified at source + unit/integration + (Bug B) live-browser level.
Live Stripe webhook replay (Bug A) and a real Stripe `onExit` event (Bug B) are NOT
available pre-deploy — those specific runtime legs are capped at "verified at
source/unit + logic level" and re-checkable post-deploy via the SQL count below.
The auth-gate regression and the sessionless-relay render WERE driven in a real
Chromium browser.

---

## BUG A — Connect webhook now PROCESSES (no uuid throw)

### Live root-cause confirmation (read-only prod SQL)
- `payment_webhook_events` WHERE `account_id='acct_1Tml2YI4pBxuXrhh'` AND
  `processed=false` → **13 rows** (= 100% of that account's 13 rows; ALL stuck).
- Every stuck row's `error` =
  `writeAudit failed for action=stripe_connect.account_updated target=acct_1Tml2YI4pBxuXrhh: invalid input syntax for type uuid: "evt_…"`
  — the EXACT failure the fix removes.
- Broader blast: **304** `processed=false` Connect rows across **17** accounts
  (orchestrator re-check target after deploy).

### Source — coercion (`supabase/functions/_shared/audit.ts`)
`writeAudit` now inserts `event_id: coerceEventId(input.event_id)`; `coerceEventId`
returns the value only if it matches a strict `UUID_RE`, else `null`. A Stripe
`evt_`/`acct_`/arbitrary string can never reach the uuid column.

### Source — 11 call sites (sweep)
- `stripeWebhookRouter.ts`: all 10 `writeAudit(` blocks pass `event_id: null`
  (lines 262/463/524/634/700/715/744/962/1004/1516).
- `stripe-webhook/index.ts` soft-fail `writeAudit` passes `event_id: null` (line 125).
- ONLY non-null `event_id` remaining is router L916 `orderDetail.event_id` — a real
  Mingla `orders.event_id` uuid written to `ticket_order_notifications` (NOT writeAudit).
- The other `event.id` references (index.ts L117 console.warn, L160/173/236 HTTP
  response bodies, L181 idempotency `stripe_event_id`, router L1270 idempotency) are
  NOT writeAudit args. Sweep clean.

### No-throw trace
`syncAccount` (router L259) does `writeAudit(... event_id:null ...)` BEFORE the
`notifyBrandManagers` status-change block (L306) and the AppsFlyer side-effects.
With `event_id:null` (a valid uuid value) the insert succeeds → no throw → execution
reaches notify → webhook returns `processed=true` + writes the audit row. Previously
the throw aborted before L306.

### Tests
- Implementor `audit.test.ts` — 5/5 pass.
- ADVERSARIAL `supabase/functions/_shared/audit_adversarial_tester_1234.test.ts`
  (3 tests, NEW): a Postgres-LIKE fake that rejects any non-uuid `event_id` exactly
  as the live column did; feeds 7 Stripe-shaped ids (`evt_`/`acct_`/`py_`/`fee_`/
  empty/raw) through the real `writeAudit` and proves it NEVER throws + always
  coerces to null; preserves a real uuid; a control proves the fake genuinely throws
  on a raw id (coercion is load-bearing). 3/3 pass. Combined run 8/8.
- **Fails-on-revert**: restoring `event_id: input.event_id ?? null` in audit.ts →
  adversarial test FAILS (the evt_/acct_ ids throw the pg-like insert). Restored clean.

---

## BUG B — onboarding exit no longer strands the user

Ran the worktree web app (`npx expo start --web --clear`, 2173-module real Mingla
build) and drove a SESSIONLESS Chromium (Playwright). NOTE: the worktree `.env` has
a TEST publishable key vs the LIVE backend, so the `stripeModeHandshake` fail-close
(correctly) crashed every route to the error boundary; this is a worktree env
artifact, not a regression — neutralized for the browser run by exporting a
`pk_live_` placeholder so the handshake prefix aligned (no fix code touched).

### Browser evidence (real app, sessionless context)
1. **return_to persistence** — loaded
   `/connect-onboarding?session=…&brand_id=…&return_to=https://business.usemingla.com/foo`
   → `sessionStorage["mingla:stripe-connect:onboarding-return-to"]` =
   `"https://business.usemingla.com/foo"`. Mount `useEffect` persists it. PASS.
2. **Sessionless relay renders (no auth bounce)** — loaded
   `/stripe-onboarding-return?return_to=mingla-business://onboarding-complete` in a
   fresh sessionless browser → stayed on `/stripe-onboarding-return`, rendered
   "Returning to Mingla Business…". This is the exact fallback handleExit sends a
   stranded user to; it renders with NO Supabase session. PASS.
3. **Payments route STILL auth-gated** — `/brand/<id>/payments` sessionless →
   bounced to `/` (sign-in welcome: "Continue with Apple/Google/Email"). The fix did
   NOT un-gate it. PASS.

### Source — handleExit logic (`ConnectOnboardingBody.web.tsx`)
- Recovers `return_to` from the URL param OR sessionStorage.
- A `mingla-business://` or `https://` value → `window.location.assign(...)`
  (FULL-PAGE), never `router.replace`. `useRouter` removed entirely.
- No-`return_to` fallback → `window.location.assign('/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete')` (the exempt relay).

### Auth-gate / public-path contracts intact
- `/brand` is in NO exemption list; `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES`
  (incl. `/stripe-onboarding-return`) + `PUBLIC_BUYER_ROUTE_PREFIXES` UNCHANGED.
- `i-proposed-1232-f-public-paths-ungated.mjs` → PASS · violations=0.
- `orch_1139_connect_seller_route_allowlist` + `stripeOnboardingReturnRoute` jest
  suites → 45/45 pass.

### Tests
- ADVERSARIAL
  `mingla-business/src/components/stripe/connect-pages/__tests__/connectOnboardingExit_adversarial_tester_1234.test.ts`
  (5 tests, NEW): pins the exit CONTRACT against the source (comment-stripped):
  no `router.replace`/`push`, no `/brand/*/payments` target, persists return_to on
  mount, recovers from sessionStorage + `window.location.assign`, fallback to
  `/stripe-onboarding-return` carrying the deep link, `onExit={handleExit}`. 5/5 pass.
- **Fails-on-revert**: injecting `router.replace(\`/brand/${brandId}/payments\`)` →
  the "never SPA-replaces into payments" invariant FAILS. Restored clean.

---

## Gates
- I-PROPOSED-1234 strict-grep: `--self-test` OK; run PASS · violations=0.
- Append-only test gate: only ADDED test files (2 new) — no existing `.test.*`
  modified → no `[TEST-MOD-APPROVED]` token required.
- `deno check` on audit.ts / stripeWebhookRouter.ts / stripe-webhook/index.ts — clean.
- All temporary reverts restored with zero residual git diff on fix files.

## Tester test paths
- `supabase/functions/_shared/audit_adversarial_tester_1234.test.ts` (Bug A, deno)
- `mingla-business/src/components/stripe/connect-pages/__tests__/connectOnboardingExit_adversarial_tester_1234.test.ts` (Bug B, jest)
- Browser driver (scratchpad, not committed): `bugb_browser.mjs`

## Pre-deploy honesty caps
- Bug A: no live webhook replay (prod DB read-only) — no-throw proven at unit + source.
  Re-check post-deploy: the 13 (and 304) `processed=false` rows should drain / stop
  growing once the deployed function reprocesses on Stripe retry.
- Bug B: no real Stripe `onExit` (needs a live Connect session) — exit branch proven
  at source + unit; the sessionless-relay render and payments-gate regression WERE
  driven live in-browser.
