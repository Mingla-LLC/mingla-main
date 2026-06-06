# SPEC - ORCH-1087 Business Web Full-Route Phone-Browser Gate

Date: 2026-06-05 / 2026-06-06 UTC
Mode: SPEC from completed route-gate investigation
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1087-[business-web-route-gate]`
Branch: `ORCH-1087-business-web-route-gate`

## 1. Outcome And Scope

Goal: no static Home action may send a phone-browser user into an unproven crash, white screen, endless spinner, or mystery invalid-link route.

This spec is not "make all business web complete." It is the first safety slice after the route gate. It converts the current static Home into a deterministic phone-browser launcher: routes that are proven safe stay linked, routes that crash get lightweight shells or explicit degraded copy, and routes that need generated credentials/session params stop being direct dead links.

In scope:

- `mingla-business/public/home.html`
- Static/public phone-browser shell files if needed.
- Vercel routing for those static shells if needed.
- Web-only Reanimated shim fix for Ari if `/ari` remains a direct full-route link.
- CI/source gates and phone-browser manual gates.

Out of scope:

- No full Hub/Marketing/Account/Creator wizard rewrite.
- No Supabase migrations, RLS, edge deploys, Stripe payload/API changes, or native rebuilds.
- No deploy from this worktree.
- No OTA, merge, or reap by implementor.
- No provider-specific seller copy regression; preserve COMMS-0021 neutral copy.

## 2. Route Contracts

| Route | Contract | Required next behavior |
|---|---|---|
| `/home` | `PASS_NOW` | Keep static `/home` with zero Expo scripts and five tabs. |
| `/event/create` | `STATIC_SHELL_REQUIRED` until full wizard proof exists | On phone browsers, do not leave users on `Finishing sign-in...`; show a static create shell with "Use desktop or the Mingla Business app to create listings for now" or an equivalent launch-approved copy. |
| `/hub/events` | `STATIC_SHELL_REQUIRED` | Phone browser must not load the crashing full Hub route. Show Hub shell with Events/Experiences/Trips options as disabled/degraded or desktop/app copy. |
| `/hub/experiences` | `STATIC_SHELL_REQUIRED` | Same as Hub shell; no direct full RN route on phone. |
| `/hub/trips` | `STATIC_SHELL_REQUIRED` | Same as Hub shell; no direct full RN route on phone. |
| `/ari` | `FIX_REQUIRED` | Either fix `Easing.bezier` shim and prove Ari renders on Android Chrome, or replace the static Home Ari handoff with a static Ari shell. |
| `/marketing` | `STATIC_SHELL_REQUIRED` | Phone browser must not load the crashing full Marketing overview. Show Blast shell with safe copy and desktop/app guidance. |
| `/marketing/campaigns/compose` | `STATIC_SHELL_REQUIRED` | Phone browser must not load Composer until Tiptap, schedule picker, keyboard, and data paths are proven. |
| `/account` | `STATIC_SHELL_REQUIRED` | Phone browser must not load the crashing full Account route. Show Account shell with safe sign-out/profile/payout guidance only if implemented statically. |
| `/connect-account-management` | `STATIC_SHELL_REQUIRED` from static Home; full route is `NEEDS_CREDENTIAL_OR_DATA` | Static Home must not directly link to the missing-param route. Link to an Account/Payout shell or remove/disable the action until a generated account-session path is proven. |

## 3. First Implementor Slice

Recommended slice: **ORCH-1087-S1 static phone-route firewall**.

Implement the smallest safe product move:

1. Keep `/home` exactly static and Expo-free.
2. Replace every static Home full-Expo `href` that crashed or hung on Android Chrome with a phone-browser-safe static shell target or in-page shell state.
3. Preserve the existing in-page `#hub` tab behavior.
4. Keep provider-neutral payout copy: `Payout account`, `Payments & Bank`, `Connect bank`.
5. Do not expose `/connect-account-management` directly from static Home unless a real account-session URL is generated and tested.
6. If keeping `/ari` as a full route in this slice, first add `Easing.bezier` to the web Reanimated shim and prove `/ari` renders on Android Chrome. If that proof is not included, Ari must become a static shell too.

Why this first: one slice prevents the most severe current user harm, because Hub, Marketing, Account, and several deep links crash the browser renderer. It also avoids a mega-PR that tries to make every RN-web workflow production-grade at once.

## 4. Implementation Requirements

### 4.1 Static Home link policy

LOCKED:

- `public/home.html` must not load Expo scripts.
- `public/home.html` must not link phone users directly to any route classified `STATIC_SHELL_REQUIRED`.
- `public/home.html` must not contain `Stripe account`.
- The Account/Payout surface must use neutral copy.
- Existing static Home tabs must still switch without a page load.

OPEN:

- Implementor may choose one shared static shell page with route-specific copy, or multiple static pages, as long as the route and copy are clear.
- Static shell copy can be product-polished, but must be explicit: this route is not ready for phone browser yet, and the user should use desktop or native app.

### 4.2 Ari shim option

If the first slice fixes Ari rather than shelling it:

- Add a web-safe `Easing.bezier(x1, y1, x2, y2)` implementation to `src/shims/reactNativeReanimatedWebStub.js`.
- It may return a conservative identity/linear function only if visual reduced-motion behavior remains acceptable on web.
- Add a web import/render regression for `AriOrb` or `/ari` route proving module load does not throw.
- Production Android Chrome `/ari` must render Ari's actual initial state or explicit disclosure modal, not the root error boundary.

### 4.3 Full Expo routes

Do not attempt full fixes for these in S1:

- Hub list/detail data, share modals, manage menus.
- Experience generation file inputs.
- Marketing Composer rich editor and schedule picker.
- Account brand switcher/delete/partner flows.
- Creator wizard event edit flow.

Those become later sub-ORCHs after the static firewall stops active crashes.

## 5. Regression Tests And CI Gates

Required automated tests in the same scoped commit/push as implementation:

1. `npm run test:orch-1085` must still pass.
2. Add or update a static Home guard that fails if `public/home.html` links directly to:
   - `/hub/events`
   - `/hub/experiences`
   - `/hub/trips`
   - `/marketing`
   - `/marketing/campaigns/compose`
   - `/account`
   - `/connect-account-management`
   - `/event/create`
   unless the link is explicitly marked as a non-phone/desktop-only branch and the phone path is static-safe.
3. Add a guard that fails if static Home includes `Stripe account`.
4. Add a guard that proves static shell targets exist and include launch-approved copy for each blocked action.
5. If Ari shim is fixed, add a web test that imports/renders `AriOrb` or `/ari` without `Easing.bezier` throwing.
6. Add a web export check that the static phone shells are present in `dist` after `npx expo export -p web && node scripts/inject-mobile-blur-css.mjs`.

Manual tester gate if automation cannot prove Chrome renderer stability:

- Physical Android Chrome on `business.usemingla.com`, not only localhost.
- iPhone Safari on `business.usemingla.com`.
- Desktop browser sanity for `/home` and any new static shell.

## 6. Required Phone-Browser Manual Gates

Android Chrome:

1. Open `https://business.usemingla.com/home`.
2. Confirm first paint shows the static Home and DevTools/DOM check shows zero Expo scripts.
3. Tap each static Home tab: Home, Hub, Ari, Blast, Account.
4. Tap every action visible on those tabs.
5. Expected: no action opens Chrome `Aw, Snap`, no action hangs on `Finishing sign-in...`, no action shows an invalid management link from a static Home tap.
6. Grep logcat for `V8 javascript OOM`, `CrRendererMain`, and `onServiceDisconnected`; expected zero new fatal lines during the smoke.

Mobile Safari:

1. Open `https://business.usemingla.com/home` on an iPhone.
2. Repeat every tab and action tap.
3. Confirm no blank page, reload loop, invalid management link, or unsupported copy mismatch.
4. Confirm back/refresh/re-entry for `/home` and every static shell.

Manual Safari gate is required because this Codex environment could not run mobile Safari.

## 7. Deploy Discipline

This is a web-surface change. The implementation PR title must include `[deploy]`.

LOCKED sequence:

1. Implement only on the ORCH worktree branch.
2. Commit the static shell/link/test changes together.
3. Push the branch and open PR.
4. Merge through GitHub only after checks pass.
5. Verify `origin/main` contains the squash commit and the changed static files.
6. Deploy Vercel from merged `main`, never from the worktree.
7. Run production Android/Safari smoke after deploy.

No Supabase deploy, edge deploy, native OTA, or native rebuild is part of S1.

## 8. Later Slices After S1

After S1 stops the user-facing crash traps, route full-web parity separately:

1. Ari browser parity: fix shim, prove streaming/input/drawer/disclosure/keyboard.
2. Hub browser parity: list load, details, share modal, manage menus, data states.
3. Creator wizard web completion: event/trip/experience create/edit with Mapbox, media, date/time, sheets.
4. Marketing Composer web parity: rich editor, schedule picker, audience/template, preview/review/send.
5. Account and payout sessions: generated session links, Connect/Tax docs, provider-neutral copy.

Stripe/account-session specs must cite canonical Stripe docs per COMMS-0003 before changing any endpoint, payload, or embedded component behavior. S1 should avoid Stripe API changes entirely.

## 9. Success Criteria

S1 is successful when:

- Static `/home` still passes.
- Every static Home phone action either stays in static Home, opens a static shell, or opens a runtime-proven route.
- Android Chrome production smoke has zero new `Aw, Snap` pages and zero new V8 OOM / `CrRendererMain` crash lines.
- `/ari` either renders successfully after the shim fix or is no longer a full-route phone-browser handoff.
- `/connect-account-management` is no longer reachable from static Home as a missing-param dead link.
- CI fails if future edits reintroduce direct phone links to the known crashing routes.

## 10. Downstream Routing

After orchestrator review, route to Codex `implementor-mingla` for S1 only. Do not self-dispatch. The implementor should write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1087_BUSINESS_WEB_STATIC_ROUTE_FIREWALL.md` and return to tester/orchestrator for Android Chrome plus Safari smoke.
