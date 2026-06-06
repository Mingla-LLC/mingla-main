# CLOSE - ORCH-1091 Business Web Mobile Cache Invalidation

Date: 2026-06-06
Status: CLOSED PASS for mobile-browser cache/chunk reliability
Surface: Business Web production and preview (`business.usemingla.com`)

## Plain-English Outcome

Mobile browsers were not all seeing the same app after deploy. Some phones kept an old Expo web entry script in cache; that stale script still pointed at deleted route chunks, so `/event/create` could hang, white-screen, or fail differently by browser. ORCH-1091 makes the entry scripts revalidate and adds an explicit cache-bust marker so phone browsers fetch the current route map after each deploy.

## Root Cause

Expo web async-route exports can keep the same eager entry filename while the lazy route chunk filenames change. Vercel was serving all `/_expo/static/*` files with `Cache-Control: public, max-age=31536000, immutable`, so a phone could reuse an old entry script that asked for stale route chunks no longer present in production. This explained why one browser worked and another did not: their cached entry scripts differed.

## What Shipped

- PR #395 (`3726c183f`) added a mobile chunk-recovery script and first-pass cache invalidation.
- PR #396 (`0422351b2`) fixed header precedence so `/_expo/static/js/web/*` is served with `Cache-Control: public, max-age=0, must-revalidate`.
- `scripts/inject-mobile-blur-css.mjs` now rewrites eager Expo web script tags with `?v=orch1091` and marks the HTML with `orch1091-js-cache-bust`.
- `scripts/ci/orch-1085-mobile-web-signin-home.mjs` now guards the Vercel header order and built HTML cache-bust.
- `src/utils/__tests__/orch_1091_mobile_web_js_cache_invalidation.test.ts` locks the header-order and injection contract.

## Verification

Passed locally:

```text
npx jest src/utils/__tests__/orch_1091_mobile_web_js_cache_invalidation.test.ts --runInBand
npm run test:orch-1085
node scripts/ci/orch-1085-mobile-web-signin-home.mjs
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && node scripts/ci/orch-1085-mobile-web-signin-home.mjs
```

Passed in production after PR #396:

```text
https://business.usemingla.com/event/create?orch1091prod2=1
```

Production evidence:

- HTML contains `orch1091-js-cache-bust`, `mingla-mobile-web-chunk-recovery`, and eager JS `?v=orch1091`.
- `/_expo/static/js/web/index-673ede93709fe16629641db487c64add.js?v=orch1091` now returns `cache-control: public, max-age=0, must-revalidate`.
- Android Chrome loaded the current `create-c6d99cfa4bc846ab943ff3e6ef08d7d0.js` route chunk and did not request stale `create-c0a9...js`.
- Android Chrome production `/home` showed the logo, signed-out state, and bottom tabs: Home, Hub, Ari, Blast, Account.
- Android Chrome production `/event/create` without a valid browser session showed the expected sign-in recovery state, not a white page or stale-chunk hang.

Seth production smoke after closeout:

- Chrome phone browser: signed-in Home -> Create opened instantly.
- Safari phone browser: signed-in Home -> Create opened instantly.
- iOS Business dev build from merged-main Metro `exp+mingla-business://expo-development-client/?url=http%3A%2F%2F172.20.17.113%3A8108` passed a native sanity check before the next web wave began.

## Boundary

This closes the deterministic cache/chunk failure class and the route-open gate for signed-in Create. Full Step 1-7 field-level polish can still be tested during normal product use, but the old cross-browser stale-bundle cause is fixed and guarded.

## Deploy Discipline

Both web deploys were from merged `main` with `[deploy]`, consistent with COMMS-0015/0018. No native OTA was required for ORCH-1091 because the fix is business-web export/Vercel behavior only.
