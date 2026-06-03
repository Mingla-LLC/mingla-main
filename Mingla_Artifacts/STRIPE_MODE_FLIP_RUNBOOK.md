# Stripe mode flip runbook (ORCH-1056)

> Operator-only runbook for flipping the entire Mingla Stripe surface between
> **test** and **live** modes without introducing the silent
> Vercel-vs-Supabase mismatch that broke Stripe Connect embedded onboarding
> on 2026-06-02. After ORCH-1056 lands, this is the **single source of truth**
> for any mode flip.

---

## Why this runbook exists

On 2026-06-02 we discovered Vercel was serving `pk_live_*` on
`business.usemingla.com` while Supabase edge functions were still
authenticated with `rk_test_*` restricted API keys. The Stripe Connect
Embedded `<ConnectAccountOnboarding>` iframe silently collapsed to **1px
high** — no error toast, no console error, no Sentry capture. Partners
saw a blank page mid-onboarding and couldn't finish KYC.

Root cause: the publishable key (client) and the restricted API key
(server) referred to two different Stripe platform accounts (live vs test)
and the SDK refused to bridge them, but did so by zero-sizing the iframe
rather than throwing.

ORCH-1056 codified the cure as three layers that **must all flip together**:

1. **`MINGLA_STRIPE_MODE` env var** — single source of truth, set in
   Supabase secrets AND Vercel project env.
2. **Per-role restricted API keys** — duplicated as
   `STRIPE_RAK_{ROLE}_TEST` and `STRIPE_RAK_{ROLE}_LIVE` so the helper
   `_shared/stripeMode.ts` picks the right one based on
   `MINGLA_STRIPE_MODE` and validates the prefix on read.
3. **Boot handshake** — at app boot, `mingla-business` (and `app-mobile`)
   call the public `stripe-mode` edge fn and throw a fatal
   `StripeModeMismatchError` if the backend disagrees with the bundled pk.

The admin dashboard at `#/stripe-mode` shows all three signals at a glance.

---

## Pre-flip checklist

Before flipping ANY mode:

- [ ] All three sister sessions (Sub-E, Sub-F, Sub-G of the in-flight
      Home/Hub work) have committed and merged their nearby changes — no
      staged work in the anchor checkout that a `vercel --prod` or
      `eas build` would freeze in time. See
      `[[shared-anchor-checkout-staging-hazard]]`.
- [ ] You've decided whether mobile (EAS) needs a fresh native build. **OTA
      cannot bypass a pk flip**: the publishable key is bundled at build
      time on both mobile apps. Per `[[ota-deferred-until-new-build]]`, if
      you're flipping mobile + native build is overdue, schedule the EAS
      build before flipping Supabase + Vercel — else mobile boot will
      throw `StripeModeMismatchError` until users get the new build.
- [ ] You've snapshotted the current Supabase secret fingerprints via
      `supabase secrets list --project-ref gqnoajqerqhnvulmnyvv` so you
      can revert with confidence if anything goes sideways.

---

## Supabase secrets to add (one-time, ORCH-1056 close)

ORCH-1056 introduces the **suffixed** secret shape. Add these to Supabase
without touching the existing unsuffixed `STRIPE_RAK_*` secrets — that's
the rollback safety net until we're confident the helper is stable.

Source-of-truth values: `~/Desktop/mingla-main/Key Details For Mingla/Stripe-credentials-reference-values.md`
(this file is `.gitignore`d as `*-values.md` — never commit it).

```bash
# Add mode declaration first (defaults: test, per ORCH-1056 conservative cutover):
/Users/sethogieva/bin/supabase secrets set --project-ref gqnoajqerqhnvulmnyvv \
  MINGLA_STRIPE_MODE="test"

# Duplicate every test RAK into _TEST suffix:
/Users/sethogieva/bin/supabase secrets set --project-ref gqnoajqerqhnvulmnyvv \
  STRIPE_RAK_TICKET_CHECKOUT_TEST="<rk_test_...xosC from credentials reference>" \
  STRIPE_RAK_TICKET_REFUND_TEST="<rk_test_...Gavz>" \
  STRIPE_RAK_ONBOARD_TEST="<rk_test_...Th4g>" \
  STRIPE_RAK_WEBHOOK_TEST="<rk_test_...jVSp>" \
  STRIPE_RAK_REFRESH_STATUS_TEST="<rk_test_...7IKd>" \
  STRIPE_RAK_DETACH_TEST="<rk_test_...Wjlp>" \
  STRIPE_RAK_BALANCES_TEST="<rk_test_...sc0E>" \
  STRIPE_RAK_KYC_REMINDER_TEST="<rk_test_...Xbaj>" \
  STRIPE_RAK_TAX_DASHBOARD_TEST="<rk_test_...qEG1>"

# Duplicate every live RAK into _LIVE suffix (8 keys — no tax dashboard in live):
/Users/sethogieva/bin/supabase secrets set --project-ref gqnoajqerqhnvulmnyvv \
  STRIPE_RAK_TICKET_CHECKOUT_LIVE="<rk_live_...psG>" \
  STRIPE_RAK_TICKET_REFUND_LIVE="<rk_live_...CnU>" \
  STRIPE_RAK_ONBOARD_LIVE="<rk_live_...PsV0>" \
  STRIPE_RAK_REFRESH_STATUS_LIVE="<rk_live_...SUa>" \
  STRIPE_RAK_DETACH_LIVE="<rk_live_...iPn>" \
  STRIPE_RAK_BALANCES_LIVE="<rk_live_...oFh>" \
  STRIPE_RAK_KYC_REMINDER_LIVE="<rk_live_...AaD>" \
  STRIPE_RAK_WEBHOOK_LIVE="<rk_live_...Zyd>"
```

After this set, the unsuffixed `STRIPE_RAK_*` secrets remain in place — the
helper will not read them. Treat them as the rollback path; a follow-up ORCH
will delete them once we've run 1+ week with no mismatch errors in Sentry.

---

## Vercel env vars to swap (per flip)

The mingla-business Vercel project (`@sethogieva/mingla-business`) needs
**two** env vars to stay aligned with the chosen Supabase mode:

| Var | Production value (test mode) | Production value (live mode) |
|---|---|---|
| `MINGLA_STRIPE_MODE` | `test` | `live` |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...OxdL` | `pk_live_...SS` |

```bash
# Switch Vercel to test:
vercel env rm MINGLA_STRIPE_MODE production
echo "test" | vercel env add MINGLA_STRIPE_MODE production
vercel env rm EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY production
echo "<full pk_test_ value from credentials reference>" | \
  vercel env add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY production

# Then redeploy from main:
vercel --prod
```

Mirror the same swap for `MINGLA_STRIPE_MODE=live` + `pk_live_` when going
to live mode.

`app.config.ts:120-180` already gates the Vercel build to fail-close if
the pk prefix disagrees with `MINGLA_STRIPE_MODE` — this is the second
layer of the safety net.

---

## Mobile build requirement

Mobile (both `app-mobile` consumer and `mingla-business` native) bundles
`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` at EAS build time. Per
`[[ota-deferred-until-new-build]]`, an `eas update` cannot ship a new pk.

After flipping Supabase + Vercel, schedule an EAS build for both apps so
the bundled pk catches up:

```bash
# In the worktree / repo root:
cd app-mobile && eas build --profile production --platform all
cd ../mingla-business && eas build --profile production --platform all
```

Users on older builds will hit `StripeModeMismatchError` at app boot until
they update. The ErrorBoundary surfaces a recoverable fallback (and
Sentry captures the event) — better than the silent collapse.

---

## Verification step

After flipping Supabase + Vercel:

1. Open the admin dashboard: `https://admin.usemingla.com/#/stripe-mode`
2. Confirm:
   - Backend mode pill matches the target (TEST or LIVE).
   - Backend `publishablePrefix` matches what you wrote into the
     `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` Vercel env var.
   - The success banner is green: **"All signals aligned — TEST mode"**
     (or LIVE).
3. Smoke-test a partner Stripe Connect Embedded session on
   `business.usemingla.com/connect-partner-onboarding` — iframe should
   render at full height, scroll smoothly on iOS, no auto-zoom on input
   focus.
4. Smoke-test a brand Stripe Connect Embedded session on
   `business.usemingla.com/connect-onboarding` — same checklist (the
   ORCH-1056 backport applies the iOS fixes here too).

If the admin dashboard shows red, **do not redeploy** — re-run the
Supabase secret-set step, double-check the Vercel env, and refresh.

---

## Rollback procedure

The unsuffixed `STRIPE_RAK_*` secrets remain in Supabase through ORCH-1056.
Rollback = unset `MINGLA_STRIPE_MODE` + revert client code:

```bash
# Unset the suffixed env vars (helper will throw → revert client code below):
/Users/sethogieva/bin/supabase secrets unset --project-ref gqnoajqerqhnvulmnyvv \
  MINGLA_STRIPE_MODE
```

Then revert the ORCH-1056 PR (or selectively revert
`_shared/stripe.ts` + `_shared/stripeBlueprintClient.ts` to the
pre-ORCH-1056 SHAs from `8cd547a9a^`). The unsuffixed `STRIPE_RAK_*`
secrets stay live so any rolled-back code path still reads from them.

---

## Cross-references

- ORCH-1056 SPEC: this file's parent ORCH (commits on branch
  `ORCH-1056-stripe-mode-unification`).
- Stripe credentials reference vault:
  `~/Desktop/mingla-main/Key Details For Mingla/Stripe-credentials-reference-values.md`
  (NEVER commits — `*-values.md` pattern is gitignored).
- Pre-ORCH-1056 hotfix series:
  `git log 77f1b8219..8cd547a9a --oneline` for the 10 partner-only fixes
  that shipped on 2026-06-02.
- Validator pattern reference:
  `mingla-business/app.config.ts:120-180` (the Vercel-build pk-prefix
  fail-close that landed in the hotfix series).
- Boot handshake source:
  `mingla-business/src/services/stripeModeHandshake.ts` +
  `app-mobile/src/services/stripeModeHandshake.ts`.
- Edge fn: `supabase/functions/stripe-mode/index.ts`.

---

## Cited Stripe docs

- Stripe API keys (publishable/secret/restricted prefixes documented):
  https://docs.stripe.com/keys
- Restricted API keys: https://docs.stripe.com/keys/restricted
- Stripe Connect Embedded Components quickstart:
  https://docs.stripe.com/connect/embedded-components/quickstart
- Stripe Connect Embedded Components customization (iframe behavior):
  https://docs.stripe.com/connect/embedded-components/customization
