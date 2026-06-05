# IMPLEMENTATION REWORK ORCH-1085 - Mobile Web Home CI Hardening

Date: 2026-06-05
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1085-[phase2-close-sync]`
Branch: `ORCH-1085-phase2-close-sync`
Base: `origin/main` at `58ba51ad80cadce4dbc7863f110622ae586796e7`
Status: implemented and locally verified

## Outcome

This rework closes the tester's remaining Phase 2 hardening findings after PR #387:

- The static mobile-web Home regression guard is now wired into GitHub Actions.
- The static Account tab no longer uses provider-specific "Stripe account" copy.
- The ORCH-1085 guard now fails if `public/home.html` regresses to placeholder copy, loads the Expo bundle, or reintroduces the provider-specific static copy.

This does not claim the full Expo/RN web app is complete. It hardens the crash-stop signed-in browser landing page that Seth can use today while Phase 3 inventories and optimizes the full web app route-by-route.

## Files Changed

- `.github/workflows/strict-grep-mingla-business.yml`
  - Adds `orch-1085-mobile-web-signin-home`.
  - Runs `npm run test:orch-1085` from `mingla-business`.
  - Registers the gate in the workflow comment registry.
- `mingla-business/public/home.html`
  - Changes Account tab action title from `Stripe account` to `Payout account`.
- `mingla-business/scripts/ci/orch-1085-mobile-web-signin-home.mjs`
  - Adds a negative assertion against `Stripe account` in the static Home shell.

## Verification

Local command:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1085-[phase2-close-sync]/mingla-business
npm run test:orch-1085
```

Result:

```text
ORCH-1085 mobile-web sign-in PASS.
```

Prior production proof from this close lane:

- `https://business.usemingla.com/home` served the branded tabbed static Home shell.
- Physical Android Chrome loaded production `/home`.
- Physical Android Chrome `/auth/callback#access_token=...&refresh_token=...` redirected to `/home`.
- Fatal/OOM/renderer-death grep returned zero lines at `/tmp/orch1085-prod-callback-fatal-only.txt`.
- Screenshot: `/tmp/orch1085-prod-tabbed-home.png`.

## Deploy Notes

This touches `mingla-business/public/home.html`, so the PR title/commit must include `[deploy]` for Vercel. Deploy/verification must happen from merged `main`, per COMMS-0015 and COMMS-0018.

No native OTA is needed for this rework.

## Residual Work

Phase 3 remains open: full business-web functionality needs route-by-route forensic inventory and optimization, including heavy surfaces such as cover picker/media upload, marketing composer, Stripe Connect, Ari, Hub, creator wizards, sheets/modals, date/time pickers, Mapbox/location, QR/share, auth/session restore, OG/deep-link rewrites, analytics/native SDK shims, and all Expo/RN-web parity assumptions.
