# IMPLEMENTATION - ORCH-1087 Business Web Static Route Firewall

Date: 2026-06-05 / 2026-06-06 UTC
Status: implemented and verified locally; production phone-browser smoke remains a manual tester gate after merge/deploy
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1087-[business-web-route-gate]`
Branch: `ORCH-1087-business-web-route-gate`

## A. Summary

S1 is implemented as a static Home in-page route firewall. The static `/home` launcher no longer sends phone-browser users from Home into the known unsafe full Expo routes:

- `/event/create`
- `/hub/events`
- `/hub/experiences`
- `/hub/trips`
- `/ari`
- `/marketing`
- `/marketing/campaigns/compose`
- `/account`
- `/connect-account-management`

Those visible Home actions now open static in-page shell copy with desktop/app guidance and keep the browser on the static Home document. Ari was intentionally shelled in S1, so no Reanimated shim change was made.

## B. Changed Files

| File | Change |
|---|---|
| `mingla-business/public/home.html` | Replaced unsafe full-route action hrefs with hash-based static shell actions; added route-specific degraded copy; preserved in-page tabs and neutral `Payout account` copy. |
| `mingla-business/scripts/ci/orch-1087-static-route-firewall.mjs` | New guard that fails if static Home reintroduces forbidden route hrefs, Expo scripts, `Stripe account`, or missing static shell targets/copy. It also checks `dist/home.html` when a web export exists. |
| `mingla-business/package.json` | Added `test:orch-1087`, chaining `test:orch-1085` plus the new firewall guard. |

## C. Spec Traceability

| Spec requirement | Result |
|---|---|
| Keep `/home` static and Expo-free | Verified by `test:orch-1085`, `test:orch-1087`, export output, and local click smoke. |
| Prevent static Home from opening unsafe full routes | Implemented by replacing unsafe `href="/..."` actions with `href="#..."` static shell actions. |
| Preserve existing `#hub` in-page tab behavior | Preserved: `Open Hub` still uses `data-tab-link="hub"`. |
| Preserve provider-neutral payout copy | Preserved `Payout account`; guard rejects `Stripe account`. |
| Do not expose `/connect-account-management` directly from static Home | Implemented: payout action opens `#payout-account` static shell explaining the generated-session requirement. |
| Ari option | Ari is shelled for S1; no `/ari` full-route handoff remains from static Home. |
| No full Hub/Marketing/Account/Creator rewrite | Preserved. No RN route files changed. |
| Add/update repo-running tests/gates | Added `test:orch-1087`; existing `test:orch-1085` still passes. |
| Export check for static shells in `dist` | Ran `npx expo export -p web`, injector, and `test:orch-1087`; guard checked built `dist/home.html`. |

## D. Cross-Surface Matrix

| Surface | Scope | Notes |
|---|---|---|
| Business Web phone browsers | Touched | Primary S1 surface. Static Home actions now stay in-page. |
| Business Web desktop | Indirect | `/home` launcher shows the same static shell copy if used on desktop. Full desktop routes themselves were not rewritten. |
| Business iOS | Not touched | No native code, OTA, or rebuild. |
| Business Android | Not touched | No native code, OTA, or rebuild. |
| Consumer iOS/Android/Web | Not touched | Different app/surface. |
| Admin Web | Not touched | No admin files changed. |
| Backend/Supabase/Stripe | Not touched | No migrations, edge functions, API calls, or provider payload changes. |

## E. Verification

Commands run from `mingla-business/` unless noted:

```bash
npm run test:orch-1085
```

Result: PASS. Output ended with `ORCH-1085 mobile-web sign-in PASS.`

```bash
npm run test:orch-1087
```

Result: PASS. Output ended with `ORCH-1087 static route firewall PASS.`

```bash
npx expo export -p web && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1087
```

Result: PASS. Export created `dist/`; injector added the mobile preboot/no-blur tags; `test:orch-1087` passed against source and built `dist/home.html`. Expo printed a non-fatal Sentry config warning.

```bash
git diff --check
```

Result: PASS.

Local built-output click smoke:

```bash
python3 -m http.server 4187 --directory dist
node --input-type=module <<'NODE'
# Playwright mobile viewport clicked every static Home action and asserted:
# - no Expo scripts on Home
# - path stayed /home.html
# - hash changed to the static shell target
# - expected shell title was visible
# - no console errors
NODE
```

Result: PASS. Output ended with `local static Home click smoke PASS.`

The in-app Browser plugin could not be used because the required Node browser-control tool was not exposed by tool discovery in this session; local Playwright was used as the browser fallback.

## F. Regression Proof

The old Home contract contained direct `href` values for the unsafe routes listed in the investigation. The new guard fails on any reintroduced direct `href="/event/create"`, `href="/hub/events"`, `href="/hub/experiences"`, `href="/hub/trips"`, `href="/ari"`, `href="/marketing"`, `href="/marketing/campaigns/compose"`, `href="/account"`, or `href="/connect-account-management"` in `public/home.html` or built `dist/home.html`.

This is the fail-on-old-behavior proof for S1: the old source would trip the forbidden-href checks immediately.

## G. Manual Gates Remaining

After PR merge and Vercel deploy from merged `main`, tester should run:

1. Android Chrome production smoke at `https://business.usemingla.com/home`: tap Home, Hub, Ari, Blast, Account, and every visible action. Expected: no `Aw, Snap`, no `Finishing sign-in...`, no invalid management link.
2. Android logcat grep during the smoke for `V8 javascript OOM`, `CrRendererMain`, and `onServiceDisconnected`. Expected: zero new fatal route-window lines.
3. iPhone Safari production smoke at `https://business.usemingla.com/home`: repeat tabs/actions and back/refresh/re-entry on static shell hashes.
4. Desktop sanity at `https://business.usemingla.com/home`: confirm static Home and static shell copy render acceptably.

No Supabase deploy, edge deploy, native OTA, or native rebuild is required or authorized for S1.

## H. Deploy Notes

Do not deploy from this worktree. Per COMMS-0015/0018 and the S1 spec, route through PR, merge to `main`, verify `origin/main` contains the squash commit and changed static files, then deploy Vercel from merged `main`.
