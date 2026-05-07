# Handoff — Cycle B2a (Stripe Connect onboarding wired live)

**Session date:** 2026-05-06
**Branch:** `Seth`
**Last commit on remote:** `68777449` (Phase 3-12 Stripe Connect onboarding engineering)
**Status:** Code complete (11 of 12 phases). Operator-side smoke tests + setup checklist pending.

---

## TL;DR — pick up here on your Mac

1. `git pull origin Seth` — get all the B2a code (3 commits: foundation + engineering + this handoff)
2. Run the setup checklist in §3 below (~15 min one-time)
3. Run the smoke tests in §4 below (~30 min)
4. When smoke passes, hand back "smoke passed" to the orchestrator and we run CLOSE protocol (DEC-115 + invariants ratify ACTIVE + EAS OTA)

The DB migration is already deployed (operator ran `supabase db push` 2026-05-06 from the Windows machine). Foundation is on the remote. Engineering is on the remote. Everything in the working tree on the Windows machine that's NOT in the remote is either (a) unrelated to B2a or (b) about to be committed in this handoff.

---

## 1. Where we are in the program

### B-cycle prerequisite chain (locked decision)

```
B2 (Stripe Connect live)  ← B2a CURRENT
  └── B2a (onboarding) — ENGINEERING COMPLETE; smoke pending
  └── B2b (stall recovery + detach) — DEFERRED post-B2a CLOSE
B3 (Checkout live) — gated on B2a CLOSE
B4 (Scanner + door) — gated on B3
B4 stable 4+ weeks
B5 (Marketing infra = Marketing Hub strategy) — gated on B4 stable
Mingla Brain P3 (AI agent ads) — gated on B5
```

B2a is the unblock for everything downstream.

### What this session did (in chronological order)

1. **Brainstorm: Mingla Brain AI agent strategy** → registered at `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` + memory file `project_mingla_brain_post_mechanical_ads.md`
2. **Brainstorm: Marketing Hub strategy** with 4 operator modifications (M1 max-reachability consent, M2 verified email/phone, M3 AppsFlyer cross-platform, M4 ads research) → registered at `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` (= Cycle B5)
3. **B-cycle dependency mapping** → Marketing Hub mapped to Cycle B5; gated on B2→B3→B4
4. **Q3 + Q5 strategic-question resolution** → DEC-112 (Stripe Connect = Express UX intent) + DEC-113 (brand-level routing)
5. **B2 forensics dispatch** → produced [`reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md`](../Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md) (4 root causes + 7 contributing + 9 hidden + 6 obs; 23 D-B2-N decisions surfaced)
6. **D-B2-23 SDK tech spike** → produced [`reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md`](../Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md) — caught Stripe's WebView prohibition; recommended Path B (in-app browser → Mingla web page → web SDK)
7. **3 cluster decisions locked:** split B2 into B2a + B2b; D-B2-3 trigger-synced cache; D-B2-23 Path B
8. **DEC-114 logged** — Marketplace charge model (Mingla = merchant of record)
9. **Stripe operator-side setup** (you, on Windows) — Mingla LLC sandbox account + Connect activated + platform branding + T&Cs acknowledged + RN private preview access requested (calendar gate started)
10. **Stripe-best-practices skill installed** via `npx skills add https://docs.stripe.com --skill stripe-best-practices` (lives at `~/.agents/skills/stripe-best-practices/`)
11. **B2a SPEC dispatch** → produced binding contract at [`specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`](../Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md) (~870 lines; 22 SCs; 22 test cases; 12-phase IMPL order; I-PROPOSED-O + I-PROPOSED-P pre-written DRAFT)
12. **B2a IMPL execution** — Phases 0 through 12 (skipping Phase 10 which is operator-side smoke). 2 git commits pushed to remote.
13. **IMPL report** → [`reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md`](../Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md) (~870 lines; per-SC verification table; smoke test guide §6)

### Current pipeline state

| Stage | Status |
|---|---|
| Forensics | ✅ COMPLETE (REVIEW APPROVED) |
| Spike (D-B2-23 SDK) | ✅ COMPLETE (REVIEW APPROVED) |
| SPEC | ✅ COMPLETE (REVIEW APPROVED) |
| IMPL | ✅ COMPLETE Phases 0-12 except 10 (REVIEW APPROVED foundation; engineering review pending) |
| Smoke (Phase 10) | ⏳ **PENDING — YOUR NEXT ACTION ON MAC** |
| Tester dispatch | 🔵 PENDING (after smoke; orchestrator writes prompt; you dispatch `/mingla-tester`) |
| CLOSE protocol | 🔵 PENDING (DEC-115 + invariant ratifications + 7-artifact SYNC + EAS OTA) |

---

## 2. Locked decisions (read-only — do NOT re-litigate)

| ID | Decision | Where logged |
|---|---|---|
| DEC-112 | Stripe Connect type intent = EXPRESS (Stripe owns KYC + 1099-K + chargebacks; Express dashboard for payouts) | `DECISION_LOG.md` line 102 |
| DEC-113 | Routing = BRAND-LEVEL (`stripe_connect_accounts.brand_id` FK; one Connect account per brand) | `DECISION_LOG.md` line 103 |
| DEC-114 | Charge model = MARKETPLACE (Mingla merchant-of-record; `transfer_data.destination` to brand; `application_fee_amount`) | `DECISION_LOG.md` line 104 |
| D-B2-3 | DB-trigger-synced cache (`stripe_connect_accounts` canonical; `brands.stripe_*` mirrored via trigger) | SPEC §2.2 |
| D-B2-5 | Stripe API version pin = `2026-04-30.preview` (Accounts v2 is public preview) | SPEC §2.2 + `_shared/stripe.ts:21` |
| D-B2-23 | SDK strategy = Path B (in-app browser via `expo-web-browser.openAuthSessionAsync` opens Mingla-hosted page rendering `@stripe/connect-js`) | SPEC §2.2 + spike memo |

DEC-115 will lock at B2a CLOSE (post-smoke).

---

## 3. Setup checklist for your Mac (one-time, ~15 min)

### Step 1 — Pull the branch

```bash
cd /path/to/mingla-main  # adjust to your Mac path
git pull origin Seth
git status  # should show no B2a-related files in working tree (everything committed)
```

You should see commits `f02f8211` (foundation) + `68777449` (engineering) + this handoff commit (timestamp varies).

### Step 2 — Install the new web SDK dependencies

```bash
cd mingla-business
npm install
```

This pulls `@stripe/connect-js@3.3.31` + `@stripe/react-connect-js@3.3.31` (added to package.json).

**Verify:** `npm list @stripe/connect-js @stripe/react-connect-js` — both should show `3.3.31`.

**If newer GA exists** (per D-CYCLE-B2A-IMPL-3 discovery): run `npm view @stripe/connect-js versions --json | tail -10` — if there's a newer stable release, update package.json to that exact version + commit.

### Step 3 — TypeScript + lint sweep

```bash
cd mingla-business
npx tsc --noEmit  # should exit 0
npx eslint .  # should exit 0 (no NEW errors; pre-existing warnings okay)
```

**If any errors:** they're regressions in the B2a work. Tell the orchestrator the error message + I'll dispatch a fix.

### Step 4 — Stripe Dashboard webhook configuration

The migration deployed already (`supabase db push` Windows-side). Edge functions are NOT yet deployed — that's Step 6.

- Visit `https://dashboard.stripe.com/test/webhooks` (sandbox mode toggle ON)
- Click **"Add endpoint"**
- URL: `https://<your-supabase-project-ref>.supabase.co/functions/v1/stripe-webhook`
  - Find your project ref via `supabase status` or in the Supabase Dashboard URL
- Click **"Select events"** and add these 12 event types:
  - `account.updated` ← critical for B2a
  - `account.application.deauthorized`
  - `payout.created`, `payout.paid`, `payout.failed`
  - `charge.succeeded`, `charge.failed`, `charge.refunded`
  - `application_fee.created`, `application_fee.refunded`
  - `transfer.created`, `transfer.updated`
- Save the endpoint
- Click "Reveal signing secret" → copy `whsec_*`

### Step 5 — Set Supabase Edge Function Secrets

Supabase Dashboard → Project Settings → Edge Functions → Secrets:

| Secret | Value | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (your sandbox secret key from Stripe Dashboard → Developers → API keys) | Server-side only; never frontend |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from Step 4) | Used by `stripe-webhook` for signature verification |

(The publishable key + service role key + Supabase URL are typically already configured — verify they exist.)

### Step 6 — Set frontend env var

Edit `mingla-business/.env` (or create if missing):

```
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_51TTnt1PjlZyAYA40f3kjmxF6uXjfEJKfFR25LiJpVqd7qw6TYfDqqKLcNamL3JGlD2vxh94Bzn4ciaqsMNN1PJ0C00oZVosOxd
```

(That's the publishable key you shared during the Windows session. Safe to commit to `.env`; do NOT commit to `.env` if you have a `.gitignore` rule for it — check `mingla-business/.gitignore`.)

### Step 7 — Deploy the 3 edge functions

```bash
cd /path/to/mingla-main  # repo root
supabase functions deploy brand-stripe-onboard
supabase functions deploy stripe-webhook
supabase functions deploy brand-stripe-refresh-status
```

**Verify:** `supabase functions list` should show all 3 listed with recent timestamps.

### Step 8 — Quick curl health-check

```bash
# Get your project ref + anon key first
SUPABASE_URL="https://<project-ref>.supabase.co"
ANON_KEY="<your-anon-key>"

# Test brand-stripe-onboard returns 401 (no auth)
curl -i -X POST "$SUPABASE_URL/functions/v1/brand-stripe-onboard" \
  -H "Content-Type: application/json" \
  -d '{"brand_id":"00000000-0000-0000-0000-000000000000","return_url":"mingla-business://test"}'
# EXPECTED: HTTP/1.1 401 Unauthorized + {"error":"unauthenticated"}

# Test stripe-webhook returns 400 (missing signature)
curl -i -X POST "$SUPABASE_URL/functions/v1/stripe-webhook" \
  -H "Content-Type: application/json" \
  -d '{"foo":"bar"}'
# EXPECTED: HTTP/1.1 400 Bad Request + {"error":"missing_signature"}
```

If both return as expected → edge functions are deployed correctly + auth + signature checks work.

---

## 4. Smoke test guide — what to do, what to observe at each stage

Full version with all observations is in [`reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md`](../Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md) §6. Compact version below.

### Stage 1 — Open the form (SC-01, SC-02)

**Do:** mingla-business → sign in as brand admin (rank ≥ finance_manager) → pick brand with NO Stripe yet → tap "Connect Stripe" CTA on `/brand/[id]/payments`.

**Notice:**
- BrandOnboardView idle: "Connect Stripe to start selling tickets" + bank-details-direct-to-Stripe reassurance + "Takes about 5 minutes" + 3-item prerequisites card + **"Set up payments"** primary CTA + "Cancel" + "Powered by Stripe" footer
- Tap "Set up payments" → spinner + "Creating your Stripe account…"
- ~1-3s later → in-app browser modal opens (iOS SFSafariViewController / Android Custom Tabs / Web new tab) on `business.mingla.com/connect-onboarding?session=...`
- Browser page header: "Mingla — Set up payments"
- Browser page body: Stripe form rendered with **MINGLA ORANGE (#eb7825)** primary buttons — NOT default Stripe purple

### Stage 2 — Fill + submit (SC-03, SC-04)

**Do:** Use sandbox test data — bank routing `108800` + account `00012345` (UK), any test image for ID upload.

**Notice:**
- Form submits → browser auto-redirects to `mingla-business://onboarding-complete` deep link
- App returns to foreground → state flips to **complete-active** OR **complete-verifying** (2 different copies)
- Subtle success haptic on iPhone
- Tap "Done" → routes back to `/brand/[id]/payments`
- Banner now shows "Onboarding submitted — verifying" or no banner (active)

### Stage 3 — Webhook + Realtime (SC-05, SC-06)

**Do:** Stripe Dashboard → Webhooks → your endpoint → "Send test webhook" → `account.updated`.

**Notice:**
- Stripe shows 200 OK delivery
- `payment_webhook_events` table has new row with `processed=true`
- `stripe_connect_accounts` updated; `brands.stripe_*` mirrored via trigger
- `audit_log` has new row with `action='stripe_connect.account_updated'`
- If app open on `/brand/[id]/payments`: banner auto-updates within ~5 seconds (Realtime)

### Stage 4 — Replay safety (SC-09)

**Do:** Stripe Dashboard → Webhooks → "Resend" a previously-delivered event.

**Notice:** Both deliveries return 200 OK; logs say "replayed event skipped"; ONE row in `payment_webhook_events`; ONE row in `audit_log` (no duplicates).

### Stage 5 — RLS gate (SC-11)

**Do:** Sign in as `marketing_manager`-rank account → try `/brand/[id]/payments/onboard`.

**Notice:** BrandOnboardView shows "You don't have permission" state with explanation.

### Stage 6 — Event publish gate (SC-07, SC-08)

**Do:** Try to publish a draft event with brand `stripeStatus='not_connected'`. Then complete onboarding (Stages 1-3) and try again.

**Notice:** First attempt blocked + redirect to onboarding. Second attempt (after `'active'`) succeeds.

### Stage 7 — Multi-platform (SC-18, SC-19, SC-20)

Run Stages 1-3 end-to-end on **iOS Simulator** + **Android Emulator** + **Expo Web** at `business.mingla.com`.

---

## 5. After smoke passes — CLOSE protocol

When all 22 SCs are PASS or operator-acknowledged:

1. Tell orchestrator "smoke passed" (continue this conversation OR start a fresh session and say "B2a smoke passed; run CLOSE protocol")
2. Orchestrator runs the standard CLOSE protocol:
   - **DEC-115** logged — B2a CLOSED PASS
   - **I-PROPOSED-O** flips DRAFT → ACTIVE
   - **I-PROPOSED-P** flips DRAFT → ACTIVE
   - 7 artifacts SYNCed (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
   - 7 D-CYCLE-B2A-IMPL discoveries dispositioned (close some; defer others to B2b/B3/B5)
   - 10 D-CYCLE-B2A-FOR discoveries from SPEC §17 dispositioned
3. **EAS OTA dual-platform** dispatch (per `feedback_eas_update_no_web` — NEVER comma-combined):

```bash
cd mingla-business
eas update --branch production --platform ios --message "Cycle B2a: Stripe Connect onboarding wired live (sandbox)"
eas update --branch production --platform android --message "Cycle B2a: Stripe Connect onboarding wired live (sandbox)"
```

4. Next dispatch announced:
   - B2b SPEC dispatch (J-B2.4 stall recovery + J-B2.5 detach; ~20 hrs IMPL)
   - OR Stripe Marketplace live-mode review check (calendar gate)
   - OR Stripe RN private preview eligibility approval (calendar gate; not blocking)

---

## 6. File manifest — what's on the remote vs in working tree

### On remote (Seth branch HEAD)

After this commit lands, the Seth branch will contain:

**Foundation (commit `f02f8211`):**
- `mingla-business/app.config.ts` (MOD: scheme registered)
- `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql` (NEW)
- `supabase/functions/_shared/{stripe,idempotency,audit}.ts` (NEW × 3)
- 4 orchestrator artifact updates

**Engineering (commit `68777449`):**
- 3 edge functions (`brand-stripe-onboard`, `stripe-webhook`, `brand-stripe-refresh-status`) — NEW
- Service layer (`brandStripeService.ts`, `deriveBrandStripeStatus.ts` + test, `brandMapping.ts` MOD) — NEW + MOD
- Hook layer (`useBrandStripeStatus.ts`, `useStartBrandStripeOnboarding.ts`, `useBrands.ts` MOD) — NEW + MOD
- Component layer (`BrandOnboardView.tsx` REWRITE, `BrandPaymentsView.tsx` MOD, `app/brand/[id]/payments/onboard.tsx` MOD)
- Web bundle (`app/connect-onboarding.tsx` NEW + `package.json` MOD)
- 2 CI grep gates + workflow update + INVARIANT_REGISTRY MOD

**This handoff commit:**
- `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` (this file)
- 3 orchestrator artifact updates (AGENT_HANDOFFS / OPEN_INVESTIGATIONS / PRIORITY_BOARD running headers)
- `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md` (NEW)

### NOT in this commit (intentionally — unrelated to B2a)

These files have working-tree modifications that belong to OTHER ORCHs / cycles. Do NOT commit them with B2a:

- `mingla-business/app/event/[id]/door/index.tsx` — unrelated
- `mingla-business/app/event/[id]/scanners/index.tsx` — unrelated
- `mingla-business/src/components/ui/GlassChrome.tsx` — unrelated
- `mingla-business/src/components/ui/Sheet.tsx` — unrelated (touched by another session)
- `mingla-business/src/components/ui/TopSheet.tsx` — unrelated
- `mingla-business/src/store/currentBrandStore.ts` — unrelated
- `supabase/functions/_shared/imageCollage.ts` + `imageCollage.test.ts` — ORCH-0737 v6 work
- `supabase/functions/run-place-intelligence-trial/index.ts` — ORCH-0737 v6 work
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md` — ORCH-0737 v6 work
- `Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md` — ORCH-0742 work

These will be committed by whoever owns those workstreams.

---

## 7. Discoveries to disposition at CLOSE

### From IMPL (D-CYCLE-B2A-IMPL-1..7)

| ID | Severity | Action |
|---|---|---|
| D-CYCLE-B2A-IMPL-1 | S2 | Closed at IMPL — deep link scheme fix logged as positive evidence of verification-gate pattern |
| D-CYCLE-B2A-IMPL-2 | S2 | Closed at IMPL — 9-state expansion documented as principled deviation |
| D-CYCLE-B2A-IMPL-3 | S2 | Operator action — verify `npm view @stripe/connect-js versions` post-`npm install`; bump if newer GA |
| D-CYCLE-B2A-IMPL-4 | S2 | Operator action — verify Stripe Deno SDK pin at deploy time |
| D-CYCLE-B2A-IMPL-5 | S2 | Defer — webhook event types beyond `account.updated` get B3/B4 wiring |
| D-CYCLE-B2A-IMPL-6 | S3 | Mac action — run `tsc --noEmit` per Step 3 of setup checklist |
| D-CYCLE-B2A-IMPL-7 | S2 | Defer to live-mode launch — RAK migration when going live |

### From SPEC (D-CYCLE-B2A-FOR-1..10)

10 discoveries documented in [`specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`](../Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md) §10. Most are deferred to B2b / B3 / B5; some are operator actions (FOR-1 RAK migration before live; FOR-5 deep link scheme — RESOLVED in IMPL-1).

---

## 8. Calendar gates running in parallel (not blocking B2a sandbox)

| Gate | Status | What unblocks |
|---|---|---|
| Stripe Marketplace live-mode review | Submitted 2026-05-06 (when you activated Connect on Windows); 24-48h typical | Live-mode launch (post-B2a sandbox-only) |
| Stripe RN private preview eligibility | Submitted 2026-05-06 (when you signed up for the RN component preview); no public SLA | Path A future upgrade (currently using Path B) |

Neither blocks B2a sandbox smoke. Both inform what we do AFTER B2a CLOSE:

- If live-mode approves: deploy to live (after smoke + a beta period)
- If RN preview approves: Cycle B2c upgrade swaps the in-app browser for native `<ConnectAccountOnboarding>` component (incremental refactor; no full rewrite)

---

## 9. Useful URLs + paths to bookmark

| Where | Why |
|---|---|
| `https://dashboard.stripe.com/test` | Stripe sandbox dashboard |
| `https://dashboard.stripe.com/test/webhooks` | Webhook endpoint config |
| `https://dashboard.stripe.com/test/apikeys` | Get publishable + secret keys |
| `https://dashboard.stripe.com/test/connect/accounts/overview` | View connected accounts as they onboard |
| `https://dashboard.stripe.com/test/logs` | Stripe API request logs (debug Idempotency-Keys + status codes) |
| `https://dashboard.stripe.com/test/events` | Stripe webhook event log |
| `https://supabase.com/dashboard/project/<your-ref>/functions` | Edge function logs |
| `https://supabase.com/dashboard/project/<your-ref>/database/tables` | Inspect `stripe_connect_accounts`, `payment_webhook_events`, `audit_log` |

---

## 10. Quick-reference commands

```bash
# Pull latest
cd /path/to/mingla-main && git pull origin Seth

# Install web SDK
cd mingla-business && npm install

# Type check
cd mingla-business && npx tsc --noEmit

# Deploy edge functions
supabase functions deploy brand-stripe-onboard stripe-webhook brand-stripe-refresh-status

# Tail edge function logs (during smoke)
supabase functions logs stripe-webhook --tail

# Check migration deployed
supabase db remote commit  # OR via Dashboard → Database → Migrations

# Run unit tests
cd mingla-business && npx jest src/utils/__tests__/deriveBrandStripeStatus.test.ts

# Trigger CI gates locally (after npm install)
node .github/scripts/strict-grep/i-proposed-o-stripe-no-webview-wrap.mjs
node .github/scripts/strict-grep/i-proposed-p-stripe-state-canonical.mjs

# Start mingla-business dev (web)
cd mingla-business && npx expo start --web

# Start mingla-business dev (iOS simulator)
cd mingla-business && npx expo start --ios

# Start mingla-business dev (Android emulator)
cd mingla-business && npx expo start --android
```

---

## 11. Where to find the source-of-truth docs

| Doc | Path |
|---|---|
| **B2a SPEC** (binding contract — read first) | [`Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`](../Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md) |
| **B2a IMPL report** (full file manifest, per-SC verification, smoke guide) | [`Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md`](../Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md) |
| **B2 forensics** (root causes + spike) | [`Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md`](../Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md) + [`reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md`](../Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md) |
| **B2a IMPL dispatch** (binding constraints, forbidden actions, suggested commit msg) | [`Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`](../Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md) (gitignored — not on remote; if needed, write me a one-liner and I'll regenerate) |
| **Marketing Hub strategy** (= Cycle B5) | [`Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`](../Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md) |
| **Mingla Brain strategy** | [`Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`](../Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md) |
| **Decision log** | [`Mingla_Artifacts/DECISION_LOG.md`](../Mingla_Artifacts/DECISION_LOG.md) (DEC-112 + DEC-113 + DEC-114) |
| **Invariant registry** | [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../Mingla_Artifacts/INVARIANT_REGISTRY.md) (I-PROPOSED-O + I-PROPOSED-P DRAFT) |
| **Priority board running headers** | [`Mingla_Artifacts/PRIORITY_BOARD.md`](../Mingla_Artifacts/PRIORITY_BOARD.md) (top entries trace this session's progression) |

---

## 12. If something goes wrong on Mac

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm install` fails on `@stripe/connect-js` | Version `3.3.31` doesn't exist | `npm view @stripe/connect-js versions` → pick latest stable → update package.json |
| `tsc --noEmit` errors on `BrandRow.stripe_*` | brandMapping.ts type definition stale | Pull latest; if still failing, the BrandRow type def in brandMapping.ts already has the columns — issue is elsewhere |
| Edge function deploy fails on `stripe@18.0.0` | Stripe Node SDK version unavailable | `_shared/stripe.ts:21` — adjust import URL to current stable; e.g., `https://esm.sh/stripe@latest?target=denonext` |
| `business.mingla.com/connect-onboarding` shows white page | Bundle compile failed for `@stripe/connect-js` | Check `npx expo export --platform web` output; if connect-js fails React-Native-Web shim, see SPEC §10 D-CYCLE-B2A-FOR-4 fallback |
| In-app browser doesn't return to app on iOS | `expo.scheme` not in app.config.ts | Check line 35 — should be `scheme: "mingla-business"`. If missing, add + restart Expo dev |
| Webhook returns 400 every time | `STRIPE_WEBHOOK_SECRET` doesn't match Stripe Dashboard | Re-copy from Stripe Dashboard webhook page → re-set in Supabase Edge Function Secrets |
| Banner doesn't auto-update post-webhook | Realtime subscription failed | Check `useBrandStripeStatus.ts` Realtime channel name; verify Realtime is enabled in Supabase project |

If stuck: continue this conversation OR start a fresh session and say:

> "I'm continuing B2a from the Mac. Read `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` and tell me what's pending."

The orchestrator will pick up from §1.

---

**End of handoff. Pull, install, set up, smoke. See you on the other side.**
