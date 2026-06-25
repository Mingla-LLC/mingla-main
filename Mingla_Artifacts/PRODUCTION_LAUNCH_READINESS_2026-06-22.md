# Production Launch Readiness — Stripe/Paystack LIVE flip + store submissions

**Author:** mingla-orchestrator
**Date:** 2026-06-22
**Scope:** Flip Stripe + Paystack to LIVE, push consumer app (app-mobile) then business app (mingla-business) to App Store + Play Store.
**Status:** RECON COMPLETE — awaiting Seth's go on the pivotal decisions below. Nothing flipped or submitted yet.

---

## Current backend state (verified live, not assumed)

| Signal | Value | Source |
|---|---|---|
| `MINGLA_STRIPE_MODE` (Supabase) | **`test`** | secrets digest = SHA256("test") |
| `PAYSTACK_MODE` (Supabase) | **unset → defaults to `test`** | not in secrets list; `_shared/paystack.ts` default |
| Stripe `_LIVE` RAKs staged | **8/8 present** | secrets list |
| Stripe `_TEST` RAKs staged | **9/9 present** | secrets list |
| Paystack LIVE + TEST keys | **both present** | secrets list |
| Active Supabase project | **`gqnoajqerqhnvulmnyvv`** (master doc labels "DEV/TEST") | both apps' `EXPO_PUBLIC_SUPABASE_URL` default + all edge fns + live Stripe webhooks point here |
| Stripe LIVE account | `acct_1TU23tIAdZKekynz`, **0 connected accounts** | master keys doc |
| Paystack go-live | **APPROVED 2026-06-20** | master keys doc |

## App identity / versions

| | Consumer (app-mobile) | Business (mingla-business) |
|---|---|---|
| version | 1.1.0 | 1.0.0 |
| bundleId / package | com.mingla.app.v2 | com.sethogieva.minglabusiness |
| EAS projectId | 01f9ff7c-379a-4be5-9236-1195d6921c6d | 2d30bbc0-38d9-4a41-bf69-de89cbf6d142 |
| ASC App ID | 6760440898 | 6768737367 |
| Play submit | track=internal, releaseStatus=draft | track=internal, releaseStatus=draft |
| EAS prod pk | `pk_live_…` (per master doc, intentional fail-close) | `pk_live_…` |

---

## THREE issues that must be handled (orchestrator findings)

### 1. PIVOTAL: two Supabase projects exist — which one is production?
Master keys doc lists a **separate "Mingla-prod" project `gupxgpmukdwhozqfmzgd`** (created 2026-06-10). But **everything real lives on `gqnoajqerqhnvulmnyvv`**: both apps' default `SUPABASE_URL`, all ~100 edge functions, all migrations/data, and the **live Stripe webhook endpoints** (`we_1TalBI…`, `we_1TalBa…`) all point there. The "prod" project is empty and unwired.
- **Recommendation:** launch on `gqnoajqerqhnvulmnyvv`. Migrating to the dedicated prod project is a full project stand-up (deploy all fns, migrations, secrets, RLS, storage, recreate webhooks, repoint both apps) — a separate META-ORCH, NOT part of this launch. Going live = flip two mode switches on the project that already hosts the live infra.

### 2. Native builds are REQUIRED, not optional (this resolves COMMS-0052/0051/0047)
`main` hard-imports native modules added since the last store builds: `posthog-react-native` + `expo-tracking-transparency` (business, META-ORCH-1187) and `react-native-keyboard-controller` (consumer, ORCH-1171). An OTA would crash on launch — COMMS-0052 BLOCK forbids it. **Cutting fresh `eas build --profile production` for both apps compiles these and is the documented resolution.** This launch IS the unblock.

### 3. GAP IN THE RUNBOOK: webhook signing secrets are NOT mode-suffixed
`_shared/stripeWebhookSignature.ts` reads **unsuffixed** `STRIPE_WEBHOOK_SECRET` (Connect) + `STRIPE_WEBHOOK_SECRET_PLATFORM`. The ORCH-1056 runbook only flips RAKs (suffixed) + Vercel pk + mode — it **does not** mention webhook secrets. Flipping `MINGLA_STRIPE_MODE=live` does NOT change them; they currently hold TEST values. **They must be manually re-set to the LIVE values or every incoming live webhook (payment confirmation, refunds, disputes, Connect account.updated) fails signature verification → orders never confirm.**
- LIVE values to set: `STRIPE_WEBHOOK_SECRET` (Connect) + `STRIPE_WEBHOOK_SECRET_PLATFORM` (Platform). **Values redacted — see the master keys doc (`~/Desktop/Key Details For Mingla/MINGLA_MASTER_KEYS.md`); never store live secrets in the repo.**

---

## Proposed launch sequence (gated)

**Phase 0 — backend live flip (reversible, ~15 min):**
1. Supabase: `MINGLA_STRIPE_MODE=live`, `PAYSTACK_MODE=live`.
2. Supabase: set LIVE webhook secrets (issue #3 above).
3. Vercel (mingla-business prod): `MINGLA_STRIPE_MODE=live` + `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`, then `vercel --prod`.
4. Verify: admin `#/stripe-mode` all-green; buyer-web checkout boot handshake passes; Paystack callback reachable.

**Phase 1 — consumer production build + submit:**
5. `cd app-mobile && eas build --profile production --platform ios` then `--platform android`.
6. `eas submit --profile production` per platform (iOS→ASC 6760440898, Android→internal/draft).

**Phase 2 — business production build + submit (after consumer verified):**
7. Same for mingla-business (ASC 6768737367). This + Phase 1 lifts COMMS-0052/0051.

**Phase 3 — close-out:** resolve COMMS-0052/0051/0047; resume OTA on new runtimeVersion; SYNC artifacts; update master doc's mode line.

---

## Open decisions for Seth
- **D1:** Confirm launch backend = `gqnoajqerqhnvulmnyvv` (recommended) vs migrate to `gupxgpmukdwhozqfmzgd`.
- **D2:** Flip backend to LIVE now (recommended — store review takes days; reversible) vs hold until builds are store-approved.
- **D3:** Submit to internal/TestFlight track first (recommended, current eas.json default) vs straight to public release.
