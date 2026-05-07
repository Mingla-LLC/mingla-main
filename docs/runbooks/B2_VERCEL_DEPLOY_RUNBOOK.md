# B2a Path C V3 — `business.usemingla.com` Vercel Deploy Runbook

**Status:** Operator-side runbook — required to unblock Phase 16 in-app onboarding.
**Authoritative source:** `Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_CONFIG_DRIFT.md` R-1 fix
**Owner:** Sethogieva
**Estimated time:** 1.5–2 hours including DNS propagation wait

---

## Why this runbook exists

The B2a Path C V3 SPEC committed to **Path B** (Mingla-hosted web page rendering Stripe's `@stripe/connect-js`, opened via `expo-web-browser`). Path B structurally requires Mingla to host that page on a domain Mingla owns. Forensics confirmed:

- `business.mingla.com` is NXDOMAIN (not Mingla's)
- `mingla.com` is not Mingla's domain
- `usemingla.com` IS Mingla's (verified Namecheap + Google MX records)
- `mingla-business/dist/connect-onboarding.html` builds locally but is **not deployed anywhere**

The fix is to deploy the existing `mingla-business/dist/` Expo Web export to `business.usemingla.com` via Vercel.

---

## Pre-flight

- [ ] Namecheap account access (DNS for `usemingla.com`)
- [ ] Vercel account
- [ ] GitHub access to the `Mingla-LLC/mingla-main` repo
- [ ] `mingla-business/dist/` builds locally (`cd mingla-business && npx expo export -p web`)
- [ ] Stripe sandbox publishable key handy: `pk_test_51TTnt1PjlZyAYA40f3kjmxF6...` (from `stripe-values.md`)

---

## Step 1 — Set up Vercel project (~10 min)

1. Log in at https://vercel.com
2. **"Add New… → Project"**
3. Import the `Mingla-LLC/mingla-main` GitHub repo (Vercel will request GitHub access if first time)
4. Configure:
   - **Project Name:** `mingla-business-web`
   - **Framework Preset:** Other (NOT Next.js — this is Expo Web static export)
   - **Root Directory:** `mingla-business`
   - **Build Command:** `npx expo export -p web`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
5. **Environment Variables** (Vercel → Project Settings → Environment Variables):
   - `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_test_51TTnt1PjlZyAYA40f3kjmxF6uXjfEJKfFR25LiJpVqd7qw6TYfDqqKLcNamL3JGlD2vxh94Bzn4ciaqsMNN1PJ0C00oZVosOxd` (test mode; ⚠ for live launch swap to `pk_live_*` and configure separate Vercel "Production" env)
   - `EXPO_PUBLIC_SUPABASE_URL` = `https://gqnoajqerqhnvulmnyvv.supabase.co`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` = (from `mingla-business/app.config.ts` line 79 — the existing public anon JWT)
6. **Deploy.** Vercel builds and gives you a URL like `mingla-business-web-abc123.vercel.app`. Visit `https://<that-url>/connect-onboarding` — should render the connect-onboarding page (will show "Invalid onboarding link" because no `?session=...` param — that's expected).

---

## Step 2 — Configure custom domain on Vercel (~5 min)

1. Vercel → Project Settings → Domains
2. Add `business.usemingla.com`
3. Vercel will display required DNS records (CNAME). Note them — typically:
   - Type: `CNAME`
   - Name: `business`
   - Value: `cname.vercel-dns.com`

---

## Step 3 — Add CNAME record on Namecheap (~5 min + DNS propagation)

1. Log in at https://namecheap.com
2. Domain List → `usemingla.com` → Manage → Advanced DNS
3. **Add New Record:**
   - **Type:** CNAME Record
   - **Host:** `business`
   - **Value:** `cname.vercel-dns.com` (the value Vercel showed in Step 2)
   - **TTL:** Automatic
4. Save changes
5. Wait for DNS propagation (5–60 min typically; can take up to 24 hr in extreme cases)
6. Verify: `host business.usemingla.com` should resolve to Vercel IPs

---

## Step 4 — Verify Vercel sees the CNAME (~2 min)

1. Vercel → Project Settings → Domains → `business.usemingla.com`
2. Should show **"Configured"** with a green checkmark once DNS propagates
3. Vercel will auto-issue a Let's Encrypt SSL cert
4. Visit `https://business.usemingla.com/connect-onboarding` — should render with valid HTTPS

---

## Step 5 — Universal Links / App Links (DEFERRED)

**Decision 2026-05-07:** Universal Links setup is **deferred** to a follow-up cleanup ORCH. The Stripe Connect onboarding return uses the URL scheme `mingla-business://onboarding-complete` (which iOS/Android handle via the app's auto-registered scheme, NO Universal Links / AASA file required). Universal Links would let `https://business.usemingla.com/...` URLs open the app directly — useful for share links, irrelevant to payments onboarding.

**Saved for follow-up cleanup ORCH:**
- Apple Team ID: `782KVMY869` (operator-provided)
- Android SHA256: pending — operator runs `eas credentials --platform android` interactively when Universal Links work resumes

When you do that follow-up cycle: author `mingla-business/public/.well-known/apple-app-site-association` (no .json extension) + `mingla-business/public/.well-known/assetlinks.json` + add Vercel header config to serve them with `Content-Type: application/json` + EAS rebuild + verify Apple's CDN picks up the AASA file (~24 hr propagation).

For Phase 16 onboarding flow, **skip this step**.

---

## Step 6 — Set `MINGLA_BUSINESS_WEB_URL` Supabase secret (~30 sec)

```bash
/opt/homebrew/bin/supabase secrets set \
  MINGLA_BUSINESS_WEB_URL=https://business.usemingla.com
```

Then re-deploy `brand-stripe-onboard` to pick up the new env var:

```bash
/opt/homebrew/bin/supabase functions deploy brand-stripe-onboard
```

---

## Step 7 — EAS rebuild (NOT just OTA) (~15–30 min)

Universal Links registration in `app.json` is baked into the native build. After implementor updates `app.json` with `business.usemingla.com`, you need a fresh native build:

```bash
cd /Users/sethogieva/Desktop/mingla-main/mingla-business
eas build --platform ios --profile preview
```

(Replace `preview` with `production` for store submissions.)

---

## Step 8 — Verify end-to-end (~15 min)

1. Install the new EAS build on your iOS device
2. Open the Mingla Business app → tap a brand → tap "Set up payments"
3. ToS gate auto-passes (you're grandfathered)
4. Country picker → choose UK → "Set up payments"
5. **Expected:** in-app browser opens to `https://business.usemingla.com/connect-onboarding?session=...`
6. Stripe Connect Embedded Components render in the page (orange Mingla brand color, "Mingla — Set up payments" header)
7. Click through Stripe's test-mode onboarding (use synthetic data — Stripe pre-fills test fields)
8. Onboarding completes → page redirects via `mingla-business://onboarding-complete` → app receives the redirect → state changes to `complete-active` or `complete-verifying`
9. Verify in Stripe Dashboard → Connect → Connected accounts → the test account shows the brand's data

If any step fails, paste the Metro log + browser URL + Stripe Dashboard view back to the orchestrator.

---

## Rollback (if Vercel deploy goes wrong)

- Vercel → Project Settings → Domains → remove `business.usemingla.com`
- Namecheap → remove the CNAME record (or temporarily change to a placeholder)
- The previous behavior (NXDOMAIN — broken in-app onboarding) returns. No data is lost.

---

## What NOT to do

- ❌ Do NOT use `mingla.com` or `business.mingla.com`. Those are not Mingla's domains.
- ❌ Do NOT publish the AASA or assetlinks file with the wrong app bundle ID. Bundle ID is `com.sethogieva.minglabusiness` (per `app.json:13`). Apple Team ID required for AASA.
- ❌ Do NOT deploy live-mode publishable keys to a Vercel "Preview" environment. Test/live keys belong to separate Vercel envs (Production vs Preview).
- ❌ Do NOT skip the EAS rebuild. Universal Links are native config — OTA can't update them.
