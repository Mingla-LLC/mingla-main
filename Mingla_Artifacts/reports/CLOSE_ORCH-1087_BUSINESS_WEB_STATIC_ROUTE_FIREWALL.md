# CLOSE - ORCH-1087 Business Web Static Route Firewall

Date: 2026-06-05 / 2026-06-06 UTC
Status: CLOSED-PASS-GradeA for S1
Merged PR: #390
Merged main SHA: `93d3248db8631f45563e4dfef862c3e2aa0acb1e`

## Outcome

ORCH-1087 S1 closed the immediate mobile-browser hazard after sign-in: static Home no longer links phone-browser users into the known unsafe full Expo routes. The visible Home actions now stay on the static Home document with hash-based shell states and honest desktop/app guidance.

This does not claim the full business web app is feature-complete on phone browsers. It makes Home deterministic and prevents the current post-sign-in path from opening routes already proven to crash, hang, or render invalid copy.

## Production Evidence

Production URL: `https://business.usemingla.com/home`

Production HTML verification after the Vercel deployment from merged `main`:

- New static shell copy present: `not ready for phone browsers`.
- Unsafe direct route hrefs absent from Home.
- `Payout account` copy present.
- `Stripe account` copy absent.
- Expo bundle tokens absent from static Home.

Physical Android Chrome production smoke:

- Device: Samsung Galaxy A72 `R58R54YV7JT`.
- Opened production Home in Chrome.
- Clicked Home, Create event, Hub, Events, Trips, Ari, Marketing, Compose, Account, Account settings, and Payout account.
- Result: all actions stayed on `https://business.usemingla.com/home?...#...`.
- Browser console: no events.
- Static Home unsafe anchors: none.
- Expo script tokens: none.
- Clean logcat grep for `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, `Aw, Snap`, `fatal exception`, `SIGSEGV`, and `Render process`: zero matches.
- Evidence files: `/tmp/orch1087-prod-android-home.png`, `/tmp/orch1087-prod-android-clean-logcat-grep.txt`.

iPhone Safari supporting smoke:

- Device: booted iPhone 17 Pro Simulator, iOS 26.4.
- Opened production Home in Safari.
- First capture reproduced the temporary blank/white paint state.
- After a longer load, Safari rendered static Home with the Mingla Business header, hero, and bottom tabs.
- Evidence files: `/tmp/orch1087-prod-ios-safari-home.png`, `/tmp/orch1087-prod-ios-safari-home-20s.png`.

## Scope Closed

- `/home` static post-sign-in launcher.
- Static Home action links for `/event/create`, `/hub/events`, `/hub/experiences`, `/hub/trips`, `/ari`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/connect-account-management`.
- Regression guard: `npm run test:orch-1087`.
- Production deployment from merged `main`.

## Residual Work

The follow-on business web parity work remains open by design:

- Full event creator on phone browsers.
- Full Hub routes on phone browsers.
- Full Ari route on phone browsers.
- Full marketing overview and campaign composer on phone browsers.
- Full Account and generated payout-management session flow on phone browsers.
- Dedicated physical iPhone Safari click automation or manual device pass for those full routes.

## Final Verdict

Closed as PASS-GradeA for S1 because the immediate post-sign-in phone-browser path is now deterministic on production and protected by a repo-running regression guard. The full web app remains a multi-slice optimization/parity program, not something this static route firewall attempted to finish.
