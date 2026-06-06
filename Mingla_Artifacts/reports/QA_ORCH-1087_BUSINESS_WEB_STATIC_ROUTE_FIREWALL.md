# QA - ORCH-1087 Business Web Static Route Firewall

Date: 2026-06-06
Tester: Codex tester-mingla
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1087-[business-web-route-gate]`
Branch: `ORCH-1087-business-web-route-gate`
Scope: ORCH-1087-S1 only, static business web phone-route firewall

## Verdict

**CONDITIONAL PASS.**

No P0/P1 blockers were found in S1. The branch satisfies the static Home firewall contract locally and on a physical Android Chrome local smoke: `/home` remains static and Expo-free, every visible action stays on the static shell/hash path, tabs still work, direct links to the known unsafe full routes are gone, payout copy remains provider-neutral, and a repo-running regression guard fails on the old direct-link behavior.

The condition is deploy-stage evidence: production Android Chrome and iPhone Safari cannot be called passed until the PR is merged, Vercel is deployed from merged `main`, and the same smoke is run against `https://business.usemingla.com/home`.

## Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P2 | Production phone-browser smoke is not yet run because S1 has not been merged/deployed. | Dispatch explicitly states production deploy has not happened. Local desktop Playwright and physical Android Chrome local smoke passed; no production preview/deploy target was available for safe final production proof. | After PR merge and Vercel deploy from merged `main`, run Android Chrome and iPhone Safari production smoke at `https://business.usemingla.com/home`. |
| P4 | In-app Browser plugin browser-control tools were not exposed in this session. | `tool_search` did not expose local browser navigation/click/screenshot tools. Local Playwright and Android Chrome CDP were used as fallback browser proof. | None for S1; evidence is still runtime browser proof. |

## Claim Table

| Claim / spec criterion | Status | Evidence |
|---|---:|---|
| Static `/home` stays Expo-free. | Verified | `mingla-business/public/home.html` has no Expo script tags; `npm run test:orch-1087` passed; physical Android local smoke asserted zero `/_expo/static/js` and `expo-metro-runtime` scripts. |
| Existing tabs still work. | Verified | Source tabs at `public/home.html:596-614`; local Playwright and Android Chrome CDP clicked Home, Hub, Ari, Blast, Account and saw expected static panels. |
| Every visible unsafe action stays on static shell/hash. | Verified | Source action hrefs are hash-only at `public/home.html:461`, `482`, `489`, `496`, `514`, `528`, `535`, `549`, `556`; local browser proof stayed on `/home.html#...`. |
| Static Home no longer direct-links to unsafe routes. | Verified | Guard checks forbidden `href` values for `/event/create`, Hub routes, `/ari`, marketing routes, `/account`, and `/connect-account-management` in `scripts/ci/orch-1087-static-route-firewall.mjs:38-54`. Temp old-behavior injection failed the guard. |
| `/connect-account-management` is not reachable from static Home as a missing-param dead link. | Verified | Payout action is `href="#payout-account"` at `public/home.html:556`; copy explains generated secure session requirement at `public/home.html:681-686`. |
| Provider-neutral payout copy remains. | Verified | Static Home uses `Payout account` at `public/home.html:558` and guard rejects `Stripe account` at `scripts/ci/orch-1087-static-route-firewall.mjs:56-58`. |
| Ari is safe for S1. | Verified for S1 shell contract | Ari full route is not linked from static Home; `Open Ari` uses `href="#ari-assistant"` at `public/home.html:514`. No Reanimated shim change was required because S1 shells Ari. |
| Test guards are in package scripts. | Verified | `package.json` has `test:orch-1087 = npm run test:orch-1085 && node scripts/ci/orch-1087-static-route-firewall.mjs`. |
| Test guard fails on old behavior. | Verified | Temp copy changed `href="#create-event"` to `href="/event/create"`; guard output: `ORCH-1087 static route firewall FAIL: public/home.html must not include forbidden token: href="/event/create"` and `EXIT_CODE=1`. |
| Built export includes guarded static Home. | Verified | `npx expo export -p web` produced `dist/home.html`; `npm run test:orch-1087` passed after export and checked built `dist/home.html`. |

## Platform Matrix

| Surface | Result | Evidence / reason |
|---|---:|---|
| Business Web desktop browser, local built output | PASS | Playwright mobile viewport against `http://127.0.0.1:4187/home.html` clicked all visible actions; output ended `local built static Home click smoke PASS`. |
| Business Web Android Chrome, local built output | PASS | Samsung Galaxy A72 `R58R54YV7JT` via ADB reverse/CDP clicked all visible actions; output ended `physical Android Chrome local CDP static Home click smoke PASS`. Logcat grep for `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, `Aw, Snap` returned no lines. |
| Business Web Android Chrome, production | POST-MERGE/DEPLOY GATE | Production has not been deployed from merged `main`; do not test as final production proof yet. |
| Business Web iPhone Safari, production | POST-MERGE/DEPLOY GATE | No iPhone Safari device available in this Codex environment and production is not deployed. |
| Business native iOS/Android | N/A | No native code, OTA, or rebuild in S1. |
| Admin Web | N/A | No admin files touched. |
| Backend/Supabase/Stripe | N/A | No backend, migration, edge function, provider payload, deploy, or API change in S1. |

## Commands Run

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1087-[business-web-route-gate]
git status --short --branch
```

Output excerpt: `## ORCH-1087-business-web-route-gate...origin/ORCH-1087-business-web-route-gate`.

```bash
cd mingla-business
npm run test:orch-1087
```

Output:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
```

```bash
git diff --check
```

Output: no output, exit 0.

```bash
cd mingla-business
npx expo export -p web && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1087
```

Output excerpt:

```text
Exported: dist
[mobile-blur-fix] injected mobile preboot + blur-kill into dist/index.html <head>.
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
```

Expo also printed a non-fatal Sentry config warning: missing organization/project config, with environment variables used as fallback.

```bash
find dist -maxdepth 2 -type f | sort | sed -n '1,80p'
test -f dist/home.html && echo DIST_HOME_PRESENT
```

Output excerpt:

```text
dist/home.html
DIST_HOME_PRESENT
```

```bash
tmp=$(mktemp -d)
cp -R public scripts package.json "$tmp"/
cd "$tmp"
ruby -0pi -e 'sub(%q{href="#create-event"}, %q{href="/event/create"})' public/home.html
node scripts/ci/orch-1087-static-route-firewall.mjs
code=$?
echo EXIT_CODE=$code
```

Output:

```text
ORCH-1087 static route firewall FAIL: public/home.html must not include forbidden token: href="/event/create"
EXIT_CODE=1
```

```bash
cd mingla-business
python3 -m http.server 4187 --directory dist
node --input-type=module <local Playwright click smoke>
```

Output:

```text
local built static Home click smoke PASS
```

```bash
adb devices -l
adb -s R58R54YV7JT reverse tcp:4187 tcp:4187
adb -s R58R54YV7JT forward tcp:9222 localabstract:chrome_devtools_remote
adb -s R58R54YV7JT shell am start -a android.intent.action.VIEW -d http://127.0.0.1:4187/home.html com.android.chrome
adb -s R58R54YV7JT logcat -c
node --input-type=module <direct CDP static Home click smoke>
adb -s R58R54YV7JT logcat -d | rg -i 'V8 javascript OOM|CrRendererMain|onServiceDisconnected|Aw, Snap' || true
```

Output:

```text
physical Android Chrome local CDP static Home click smoke PASS
```

The logcat grep produced no matching crash/OOM lines.

## Regression Coverage

Regression coverage is adequate for S1.

- `npm run test:orch-1087` is a repo-running package script and chains the existing ORCH-1085 static Home guard.
- The new guard rejects direct static Home hrefs to all investigated unsafe routes.
- The guard checks provider-neutral payout copy by rejecting `Stripe account`.
- The guard checks static shell targets and launch-approved copy exist.
- The guard checks `dist/home.html` when web export output exists.
- Fail-on-old-behavior proof was run by injecting the previous `/event/create` direct href into a temp copy and confirming exit code 1.

Residual limitation: the automated guard proves static source/built output and local click behavior, not production Vercel deployment freshness. That is why the verdict is conditional on post-merge/deploy production smoke.

## Remaining Gates

Run only after PR merge and Vercel deploy from merged `main`:

1. Verify `origin/main` contains the ORCH-1087 squash commit and changed static files.
2. Deploy Vercel from merged `main`; do not deploy from this worktree.
3. Android Chrome production smoke at `https://business.usemingla.com/home`: tap Home, Hub, Ari, Blast, Account, and every visible action. Expected: no `Aw, Snap`, no `Finishing sign-in...`, no invalid management link, and all actions stay on static shell/hash.
4. Android logcat grep during the production smoke for `V8 javascript OOM`, `CrRendererMain`, and `onServiceDisconnected`. Expected: zero new fatal route-window lines.
5. iPhone Safari production smoke at `https://business.usemingla.com/home`: repeat tabs/actions and back/refresh/re-entry on static shell hashes.
6. Desktop production sanity at `https://business.usemingla.com/home`: confirm static Home and shell copy render acceptably.

## QA Notes

- No product code was patched during tester work.
- No backend, Supabase, edge deploy, native OTA, merge, or reap action was performed.
- The COMMS ledger was read first and relevant open WARN entries were acknowledged for this QA turn.
