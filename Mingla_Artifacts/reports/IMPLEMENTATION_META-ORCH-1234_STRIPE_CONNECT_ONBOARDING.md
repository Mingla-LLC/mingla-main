# IMPLEMENTATION — META-ORCH-1234: two Stripe Connect onboarding bugs

Branch: `orch-1234-stripe-connect-onboarding-bugs`
Commits:
- `042d761a2` — Bug A (event_id null at call sites + audit.ts coercion + audit.test.ts)
- `9006f4e2f` — Bug B (ConnectOnboardingBody return_to persistence + full-page nav)
- `4e645c434` — strict-grep gate + workflow wiring

NOT pushed / NOT PR'd / NOT merged (per dispatch).

---

## BUG A — audit write threw a uuid error and failed the entire Connect webhook

Root cause (proven in investigation): `audit_log.event_id` is a **uuid** column; the
Connect webhook `writeAudit` call sites passed a Stripe `evt_…` id into it →
Postgres rejected the insert → `writeAudit` threw → the whole webhook was marked
`processed=false` (Stripe retried forever; downstream status-change notify +
AppsFlyer activation never ran). The Stripe event id already lives as text in
`payment_webhook_events.stripe_event_id`, so no audit data is lost by dropping it.

### Layer 1 — 11 source call sites changed to `event_id: null`

`supabase/functions/_shared/stripeWebhookRouter.ts` (10 sites — `event_id:` line in
each writeAudit block; line numbers are the `event_id:` line after edit):

| writeAudit block | event_id: line | was | now |
|---|---|---|---|
| syncAccount (account.updated; + capability/person via refreshAccountById) | 262 | `eventId` | `null` |
| handleExternalAccount | 463 | `event.id` | `null` |
| handlePayout | 524 | `event.id` | `null` |
| handleDeauthorized | 634 | `event.id` | `null` |
| handleRefundEvent (detached/orphan) | 700 | `event.id` | `null` |
| handleRefundEvent (non-succeeded) | 715 | `event.id` | `null` |
| handleRefundEvent (no-order orphan) | 744 | `event.id` | `null` |
| handleRefundEvent (reconciled) | 962 | `event.id` | `null` |
| handleApplicationFee | 1004 | `event.id` | `null` |
| routeStripeEvent default (webhook_unhandled) | 1516 | `event.id` | `null` |

`supabase/functions/stripe-webhook/index.ts` (1 site):

| writeAudit block | event_id: line | was | now |
|---|---|---|---|
| webhook_ip_soft_fail | 124 (writeAudit call starts 121) | `event.id` | `null` |

**NOT touched** (verified — real Mingla `events.id` uuid or already null):
- `stripeWebhookRouter.ts:916` (handleRefundEvent reconciliation) — `orderDetail.event_id` (real Mingla uuid). Left intact.
- `stripeWebhookRouter.ts:1270` — `stripe_webhook_event_id: event.id` (idempotency table, not writeAudit).
- `stripe-webhook/index.ts` lines 117 (console.warn), 160/173 (HTTP status response objects), 181 (`stripe_event_id` idempotency), 236 (HTTP response body) — none are writeAudit calls.
- cancel-order / refund-order / cancel-trip-booking / installments / process-booking-deadlines writeAudit sites — pass real Mingla `events.id`. Untouched.

### Layer 2 — writeAudit defense-in-depth (`supabase/functions/_shared/audit.ts`)

Added a strict `UUID_RE` + `coerceEventId(event_id)` helper; the insert now uses
`event_id: coerceEventId(input.event_id)`. Any non-uuid value (Stripe `evt_`/`acct_`/
arbitrary string) is coerced to `null` before the insert, so a future caller can
never again throw on the uuid column and fail the whole webhook. A real Mingla
`events.id` uuid is preserved unchanged.

### ACCEPTANCE (Bug A)
A Connect `account.updated` webhook now processes to `processed=true`: the
writeAudit insert receives `event_id: null` (a valid uuid value), no uuid error,
the `audit_log` row is written, and the post-audit notify/AppsFlyer side-effects
in `syncAccount` run. (Source-level + unit-level proof; live webhook replay not run
from the worktree — DB is LIVE prod, investigation was read-only.)

---

## BUG B — post-onboarding redirect stranded the user on "Redirecting…"

Root cause (proven): `ConnectOnboardingBody.web.tsx` runs in a **sessionless**
in-app browser (`WebBrowser.openAuthSessionAsync`). On completion `handleExit` did
a client-side `router.replace('/brand/<id>/payments')`, but that route is
auth-gated and the browser has no Supabase session, so the root layout
(`shouldRedirectToSignInFromRoute`) bounced it to `/` — the page never mounted.
Trigger: Stripe's hosted KYC flow drops Mingla's `return_to` query param mid-flow.

### Redirect approach chosen
File: `mingla-business/src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx`

1. **Persist `return_to`**: a `useEffect` on first mount writes the `return_to`
   param to `sessionStorage` (`mingla:stripe-connect:onboarding-return-to`) so it
   survives Stripe's intra-flow param drop. (`persistReturnTo`/`readPersistedReturnTo`
   helpers; sessionStorage failures are swallowed — hardened browsers.)
2. **`handleExit` recovers + full-page navigates**: recovers `return_to` from the
   URL param OR sessionStorage; if it is a `mingla-business://` deep link OR a
   `https://` web URL, navigates via **`window.location.assign(...)`** (full-page —
   the deep link closes the in-app browser for native openers; a full https reload
   lets the web app re-establish its own persisted Supabase session instead of an
   SPA replace the gate intercepts).
3. **Fallback** (no recoverable `return_to`): full-page `window.location.assign`
   to the EXISTING public relay route **`/stripe-onboarding-return?return_to=mingla-business://onboarding-complete`**.
   That relay is already on `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES`
   (renders with no Supabase session) and itself bounces to the native deep link —
   so the user is NEVER stranded, and NO new public route or allowlist entry was
   needed.
4. Removed the now-unused `useRouter` import/binding (no `router.replace`/`push`
   remains in this file).

**Destination chosen for the no-`return_to` fallback:** the existing exempt
`/stripe-onboarding-return` relay (carrying the native `mingla-business://onboarding-complete`
deep link). No new landing route was added; no allowlist changed.

### ACCEPTANCE (Bug B)
Completing onboarding with OR without `return_to` in the final URL always lands the
user somewhere sensible (deep link / authed-web URL / public relay) via a full-page
navigation — never an SPA replace into an auth-gated route, never stuck on
"Redirecting…". `/brand/[id]/payments` stays auth-gated (untouched).

---

## Guards / gates / fails-on-revert proof

### New strict-grep gate
`.github/scripts/strict-grep/i-proposed-1234-stripe-connect-onboarding.mjs`
(self-tested; registered in `.github/workflows/strict-grep-mingla-business.yml` as
job `meta-orch-1234-stripe-connect-onboarding` with a `--self-test` step + a run
step). Checks:
- **A1** — no writeAudit site in `stripeWebhookRouter.ts` passes a Stripe event id
  into `event_id` (only `orderDetail.event_id` may be non-null). The detector scans
  `writeAudit(` call objects only and uses a leading word boundary so
  `stripe_webhook_event_id` / HTTP-response `event_id` fields are ignored.
- **A2** — `stripe-webhook/index.ts` soft-fail writeAudit `event_id` is `null`.
- **A3** — `audit.ts` coerces a non-uuid `event_id` to null (`UUID_RE` +
  `coerceEventId` applied at the insert; rejects the old `input.event_id ?? null`
  passthrough).
- **B1** — `ConnectOnboardingBody.web.tsx` has no `router.replace`/`push` and no nav
  to `/brand/<id>/payments`.
- **B2/B3** — `handleExit` recovers `return_to` from sessionStorage and full-page
  navigates; `return_to` is persisted on mount.

### New Deno unit test (runtime proof, Bug A)
`supabase/functions/_shared/audit.test.ts` — 5 tests: coerce `evt_`/`acct_`/garbage
→ null, preserve a real uuid, map omitted → null. All 5 pass.

### Fails-on-revert proof
- **A1**: restoring `event_id: eventId` at router line 262 → gate FAILs (`A1: router-event-id`).
- **A3**: restoring `event_id: input.event_id ?? null` in audit.ts → gate FAILs
  (`A3: audit-coerces-non-uuid`) AND 3 of 5 Deno tests FAIL.
- **B1**: restoring `router.replace(\`/brand/${brandId}/payments\`)` → gate FAILs
  (`B1: no-spa-replace` + `B1: no-payments-route-nav`).
All reverts restored cleanly; gate returns to PASS · violations=0.

### Other gates / no weakening
- `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` and `PUBLIC_BUYER_ROUTE_PREFIXES`
  are UNCHANGED → `i-proposed-1232-f-public-paths-ungated.mjs` re-run = PASS.
- No auth gate weakened; no public allowlist entry added (reused the
  already-exempt `/stripe-onboarding-return` relay).
- Edge functions: no `verify_jwt` change, no webhook signature-verification change.
- Append-only test gate: the only new test files are ADDED (allowed); no existing
  `.test.*` file modified, so no `[TEST-MOD-APPROVED …]` token was required.

### Typecheck / suites
- `deno check` on `audit.ts`, `stripeWebhookRouter.ts`, `stripe-webhook/index.ts` — clean.
- `tsc -p mingla-business/tsconfig.json` — ZERO errors in the changed
  `ConnectOnboardingBody.web.tsx` (the worktree's isolated tsconfig has a
  pre-existing baseline of cross-package/module-resolution errors in
  `../packages/*` and unrelated `app/**` files; none introduced by this change).
- Webhook router Deno suites: 9 pass; the single failing assertion
  (`stripeWebhookRouter_disputeAdversarial.test.ts` — `charge.succeeded` not in
  `STRIPE_ROUTED_EVENT_TYPES`) is PRE-EXISTING (the string is at router line 89 on
  `origin/main`; my diff is purely the 10 `event_id` lines and does not touch it).
