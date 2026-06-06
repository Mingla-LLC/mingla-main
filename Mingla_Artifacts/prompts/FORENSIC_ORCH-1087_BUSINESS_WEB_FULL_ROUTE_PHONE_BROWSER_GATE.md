# FORENSIC DISPATCH - ORCH-1087 Business Web Full-Route Phone-Browser Gate

You are Codex `forensic-mingla` for ORCH-1087 [Business web full-route phone-browser gate].

## Goal

Produce the first Phase 3 full-web completion gate for Mingla Business: a route-by-route phone-browser truth table for every static Home tab/action and the implementation spec for what must happen next. This is not a code implementation task. The output should tell Seth, deterministically, which routes already work on phone browsers, which crash or white-screen, which are slow, which must be lightweight/static shells, and which can be explicitly launch-approved as degraded/unsupported.

## Worktree

- Anchor: `/Users/sethogieva/Desktop/mingla-main` on `main` is dirty/behind; do not use it for product evidence.
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1087-[business-web-route-gate]`
- Branch: `ORCH-1087-business-web-route-gate`
- Base: `origin/main` at or after PR #389 (`72aa66ef6`).

## Mandatory entry steps

1. Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before any other work.
2. Factor COMMS-0015/0018: deploy/OTA only from merged main; do not deploy or OTA from this worktree.
3. Read:
   - `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
   - `Mingla_Artifacts/specs/SPEC_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md`
   - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1085_BUSINESS_WEB_MOBILE_SIGNIN_HOME.md`
   - `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1085_MOBILE_WEB_HOME_TABS.md`
   - `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1085_MOBILE_WEB_HOME_CI_HARDENING.md`
   - `mingla-business/public/home.html`
   - `mingla-business/vercel.json`
   - `mingla-business/scripts/inject-mobile-blur-css.mjs`
   - `mingla-business/src/diagnostics/chunkReloadGuard.ts`

## Scope

Affected Surfaces:

- Business Web production / preview on phone browsers.
- Signed-in static Home and every Home tab/action that hands off into full Expo/RN web.

Explicitly NOT in scope for implementation:

- Business iOS native app.
- Business Android native app.
- Consumer iOS/Android.
- Admin Web.
- Backend schema/data repair.
- Any code change, deploy, OTA, PR merge, or worktree reap.

Routes/actions that must be classified at minimum:

- `/home`
- `/event/create`
- `/hub/events`
- `/hub/experiences`
- `/hub/trips`
- `/ari`
- `/marketing`
- `/marketing/campaigns/compose`
- `/account`
- `/connect-account-management`
- Any other static Home link discovered in `public/home.html`.

## Required investigation

1. Build a source-derived route map from `public/home.html` and the Expo route tree. For each route, identify the major feature family and obvious native/web hazards: native pickers, camera, DateTimePicker, keyboard-controller, Stripe Connect SDK, Tiptap/rich editor, Mapbox input, sheets/overlays, QR/share, large eager imports, auth/session restore, or route rewrites.
2. Run production phone-browser probes on the plugged-in Android phone when available. Use Android Chrome through `adb`/DevTools if possible. Capture:
   - whether the route first paints,
   - approximate time-to-usable,
   - visible error text,
   - console errors,
   - network 404/chunk errors,
   - fatal/OOM/renderer-death logcat grep,
   - whether back/refresh/re-entry works.
3. If mobile Safari cannot be run in this environment, do not fabricate evidence. Mark Safari as an explicit manual gate and describe the exact smoke matrix Seth or a tester must run.
4. Distinguish production evidence from source-only evidence. Do not promote source assumptions into runtime claims.
5. Decide the route contract for each path:
   - `PASS_NOW`: production phone browser route works acceptably.
   - `FIX_REQUIRED`: route is intended full web but currently crashes, white-screens, hangs, or is materially broken.
   - `STATIC_SHELL_REQUIRED`: route should be protected by a lightweight/static shell before full RN-web is safe.
   - `UNSUPPORTED_WITH_COPY`: route can be intentionally degraded on phone browsers with explicit launch-approved copy.
   - `NEEDS_CREDENTIAL_OR_DATA`: route cannot be completed without a signed-in account/data setup, and the required account/data must be named.
6. Define the next implementation slices. Do not lump everything into one mega-PR. Recommend the smallest first implementor slice that improves the most user pain without making full web fragile.

## Required outputs

Write both files:

1. `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
2. `Mingla_Artifacts/specs/SPEC_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`

The investigation must include:

- Executive route table.
- Android device/environment details.
- Commands/probes run.
- Evidence paths for screenshots/logs if created.
- Route-by-route source hazards and runtime results.
- Honest non-evidence.

The spec must include:

- Route contracts.
- First implementation slice recommendation.
- Required regression tests and CI/source gates.
- Required phone-browser manual gates.
- Deploy discipline and `[deploy]` requirement for web changes.
- Explicit handoff to `implementor-mingla` only after orchestrator review.

## Hard guards

- Do not change production code.
- Do not deploy.
- Do not OTA.
- Do not merge.
- Do not reap the worktree.
- Do not use the dirty anchor as source truth.
- Do not reject ORCH-1085 Phase 2; it is closed and production-proven. ORCH-1087 is a Phase 3 continuation.
- Preserve COMMS-0021 provider-neutral seller copy in any recommendation.

## Completion condition

Stop when the two artifacts above are written in the ORCH-1087 worktree and your final response gives a PASS/NEEDS-WORK style summary of what the route gate found and which implementor slice should happen first.
