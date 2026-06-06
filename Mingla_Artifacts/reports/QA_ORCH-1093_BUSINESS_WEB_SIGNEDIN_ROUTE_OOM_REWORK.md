# QA ORCH-1093 - Business Web Signed-In Route OOM Rework

Date: 2026-06-06
Tester: Codex tester-mingla
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1093-[business-web-signedin-route-oom]`
Branch: `ORCH-1093-business-web-signedin-route-oom`
Commit under test: `7cf159228a93a2a9cf7fbac014c0334907886202`

## Verdict

CONDITIONAL PASS.

The implementation now honestly fails closed instead of pretending full signed-in route parity is restored. Repo-running guards pass, the generated injected export counts the deferred phone boot payload instead of hiding it, and physical Android Chrome confirms the OOM-proven signed-in routes render protected recovery with zero Expo JS resources. `/event/create` remains the only approved signed-in phone route and reached the real wizard.

The remaining condition is mobile Safari. Codex could not run an authenticated mobile Safari route inspection in this environment: no connected iPhone/iPad was present, no iOS simulator was booted for a usable authenticated Safari run, and `ios_webkit_debug_proxy` was unavailable. This is a manual gate before close/deploy language may say route parity is restored.

## Findings

| Severity | Finding | Status | Evidence |
|---|---|---|---|
| P2 | Mobile Safari proof is missing. | Manual gate | `xcrun simctl list devices booted` showed no booted devices; USB scan showed no iPhone/iPad; `ios_webkit_debug_proxy` was not installed. |
| P4 | The first Android local smoke used a non-SPA `serve` mode and returned 404s for deep routes. | Harness corrected | Restarted server with `serve -s`; repeated physical Android smoke passed. No product evidence was taken from the 404 run. |

No P0/P1 blocker was found.

## Claim Table

| Claim | Result | Evidence |
|---|---|---|
| `npm run test:orch-1093` passes. | Verified | Command passed. It chained ORCH-1092/1089/1088/1087/1085, Jest tests, ORCH-1093 self-test, and bundle guard. |
| Self-test includes the deferred false-pass failure. | Verified | Output included `ORCH-1093 deferred false-pass self-test PASS.` |
| Fresh `npx expo export -p web` succeeds. | Verified | Export completed; only Sentry organization/project warning was printed. |
| Post-export injection succeeds. | Verified | `node scripts/inject-mobile-blur-css.mjs` printed injection success. |
| Guard counts deferred phone boot bytes and approves only `/event/create`. | Verified | `phoneBoot=2884313; __common=1881530; deferred=true; approved=/event/create`. |
| Expo Web and `asyncRoutes.web` are preserved. | Verified | `app.json` keeps `web.output: "single"` and Expo Router `asyncRoutes.web: true`; ORCH-1093 guard enforces both. |
| ORCH-1091 chunk/cache recovery is preserved. | Verified | Source and guards retain `orch1091-js-cache-bust`, `?v=${JS_CACHE_BUST_PARAM}`, `mingla-mobile-web-chunk-recovery`, `mingla-mobile-web-home-preboot`, and `mingla-mobile-web-no-blur`. |
| Vercel JS must-revalidate is preserved. | Verified | `vercel.json` has `/_expo/static/js/web/(.*)` with `public, max-age=0, must-revalidate`; ORCH-1092 and ORCH-1093 guards enforce it. |
| ORCH-1092 provider-neutral payout copy/native quarantine is preserved. | Verified | Chained ORCH-1092 guard and Jest tests passed; ORCH-1093 source guard rejects `Stripe account`, `Connect Stripe`, and `Payments & Stripe` in non-comment seller copy. |
| Physical Android Chrome protected routes load zero Expo JS and avoid OOM. | Verified | Samsung A72 Chrome run showed recovery with `expoResourceCount=0` on `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/hub/trips`; logcat grep found no V8 OOM/renderer death/Aw Snap after the corrected run. |
| Physical Android Chrome `/event/create` reaches the real wizard. | Verified | Samsung A72 Chrome redirected to `/event/d_mq2lxbrbdqdg4z/edit?step=0`, loaded 15 Expo JS resources, and displayed Step 1 wizard copy. |
| Full route parity is restored. | Refuted by design | Route-status map keeps `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/hub/trips` as `pending-proof`; only `/event/create` is `approved`. |

## Commands And Output

### Branch / Commit

```text
git status --short --branch
## ORCH-1093-business-web-signedin-route-oom...origin/ORCH-1093-business-web-signedin-route-oom

git rev-parse HEAD
7cf159228a93a2a9cf7fbac014c0334907886202
```

### Regression Guard

```text
npm run test:orch-1093
...
ORCH-1093 self-test PASS.
ORCH-1093 deferred false-pass self-test PASS.
ORCH-1093 bundle budgets PASS. phoneBoot=2884313; __common=1881530; deferred=true; approved=/event/create
ORCH-1093 route chunk /hub/trips trips-16ecc294365aad13f1001aa0c491ddda.js 12661
ORCH-1093 route chunk /hub/events events-539a600e4d9dbe46e145238db5723687.js 18954
ORCH-1093 route chunk /marketing index-140ddfb8fd743bc1ed14962475948c9c.js 11952
ORCH-1093 route chunk /marketing/campaigns/compose compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
ORCH-1093 route chunk /account account-4d3134140304fd405f5982d94f4524f1.js 9055
ORCH-1093 route chunk /event/create create-285c84b67ccbda12c0b293d15a34f037.js 4522
ORCH-1093 signed-in route OOM PASS.
```

### Export / Injection / Guard

```text
npx expo export -p web
Exported: dist
```

Sentry warning noted: missing organization/project config; export still completed.

```text
node scripts/inject-mobile-blur-css.mjs
[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.

node scripts/ci/orch-1093-signedin-route-oom.mjs
ORCH-1093 bundle budgets PASS. phoneBoot=2884313; __common=1881530; deferred=true; approved=/event/create
...
ORCH-1093 signed-in route OOM PASS.
```

### Physical Android Chrome

Setup:

```text
adb devices -l
R58R54YV7JT device usb:1-1 product:a72qnseea model:SM_A725F device:a72q transport_id:5

adb -s R58R54YV7JT reverse tcp:56815 tcp:56815
adb -s R58R54YV7JT forward tcp:9222 localabstract:chrome_devtools_remote
npx --yes serve -s -l 56815 dist
```

Session seed:

```text
SESSION_FOUND key=sb-gqnoajqerqhnvulmnyvv-auth-token bytes=4085
LOCAL_SESSION_SEEDED
```

Route evidence:

| Route | Android Chrome result | Expo JS resources | OOM / Aw Snap |
|---|---|---:|---|
| `/hub/events` | Protected recovery; pending-proof copy visible | 0 | None in logcat grep |
| `/marketing` | Protected recovery; pending-proof copy visible | 0 | None in logcat grep |
| `/marketing/campaigns/compose` | Protected recovery; pending-proof copy visible | 0 | None in logcat grep |
| `/account` | Protected recovery; pending-proof copy visible | 0 | None in logcat grep |
| `/hub/trips` | Protected recovery; pending-proof copy visible | 0 | None in logcat grep |
| `/event/create` | Real wizard reached at `/event/d_mq2lxbrbdqdg4z/edit?step=0`; Step 1 copy visible | 15 | None in logcat grep |

Post-run logcat grep:

```text
adb -s R58R54YV7JT shell logcat -d -t 1500 | rg -i 'V8 javascript OOM|CrRendererMain|Aw, Snap|onServiceDisconnected \(crash or killed by oom\)|127.0.0.1:56815|business.usemingla'
```

No OOM, `CrRendererMain`, `Aw, Snap`, or renderer-death lines were returned after the corrected SPA-server run.

### Mobile Safari Availability

```text
xcrun simctl list devices booted
== Devices ==
-- iOS 26.4 --

system_profiler SPUSBDataType | rg -i 'iphone|ipad|ios'
# no output

which ios_webkit_debug_proxy
# no output
```

## Source Guard Review

| Guard | Result | Evidence |
|---|---|---|
| Expo Web path retained | PASS | `app.json` has `web.output: "single"`. |
| Expo Router async routes retained | PASS | `app.json` has `asyncRoutes.web: true`. |
| ORCH-1093 route status is honest | PASS | `app/_layout.tsx` maps `/event/create` to `approved`; `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/hub/trips` to `pending-proof`; `/hub/experiences`, `/ari`, and payout route to `blocked`. |
| Static/injected route guard matches source route status | PASS | `scripts/inject-mobile-blur-css.mjs` uses the same pending/blocked route map and renders recovery before Expo scripts on signed-in phone pending routes. |
| Tab-global heavy UI is lazy | PASS | `(tabs)/_layout.tsx` imports `GlobalSearchSheetHost` and `CommandPaletteHost`; hosts lazy-load bodies only when opened. |
| Action sheets are lazy on target routes | PASS | Trips/events/account/hub/marketing layouts use `React.lazy` for share/manage/switch/create/delete bodies. |
| Native-module quarantine retained | PASS | ORCH-1092 guard passed and ORCH-1093 eager-token guard passed against generated boot chunks. |

## Regression Coverage

The regression coverage is adequate for this fail-closed rework.

- `npm run test:orch-1093` is repo-running and chains the prior ORCH-1092/1089/1088/1087/1085 gates.
- The ORCH-1093 self-test fails the original oversized eager shape.
- The ORCH-1093 deferred false-pass self-test covers the reviewer-reported bug where `eager=0` hid oversized deferred boot scripts.
- The generated-output guard proves only `/event/create` is approved while the deferred phone boot remains oversized.
- Physical Android Chrome covers the production failure mode with a stored business session.

Fail-on-revert proof was not performed because tester mode must not mutate product code and the explicit self-tests already encode the two known failing shapes.

## Platform Matrix

| Platform / Browser | Result | Notes |
|---|---|---|
| Android Chrome physical Samsung A72 | PASS | Protected routes recover with zero Expo JS; `/event/create` reaches real wizard; no OOM/Aw Snap logcat evidence. |
| Mobile Safari | MANUAL GATE | No connected iPhone/iPad or usable authenticated Safari inspection path was available to Codex. |
| Desktop web source/export | PASS | Export and generated-output CI guards pass; desktop command/search behavior was source-verified but not manually clicked in this QA pass. |
| Native business app | Not directly run | Source changes use lazy hosts and native command host stub; no native runtime proof requested for this web OOM rework. |

## Residual Risk

1. Mobile Safari may behave differently from Android Chrome for the injected route deferral and pending-proof recovery. Seth must run the Safari manual gate before close/deploy confidence.
2. `/event/create` still loads the full deferred Expo boot payload on phone. Android Chrome survived in this pass, but Safari must also prove it.
3. Pending-proof routes are not restored; they are deliberately protected. Do not label `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, or `/hub/trips` as full web parity restored.
4. The local Android smoke uses an exported build served through `serve -s`, not a Vercel deployment. This is appropriate for tester no-deploy constraints, but deploy verification remains separate.

## Manual Safari Gate

Run after the same export/injection shape is deployed or served locally:

1. Open mobile Safari with a stored business session.
2. Visit `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/hub/trips`.
3. Expected: protected recovery appears within 8 seconds; no blank screen, crash, repeated reload, or Expo route boot.
4. Visit `/event/create`.
5. Expected: real event creator wizard appears within 8 seconds; no blank screen, crash, repeated reload, or memory failure.

If Safari fails any pending route recovery or `/event/create`, route back to implementor with this QA report and the failing route evidence.
