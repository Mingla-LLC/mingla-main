# FORENSICS ORCH-1089 - Business Web Signed-In Event Creator Wizard Parity

You are Codex `forensic-mingla` working in:

`/Users/sethogieva/Desktop/mingla-orchs/ORCH-1089-[business-web-event-creator-signedin-wizard]`

Branch:

`ORCH-1089-business-web-event-creator-signedin-wizard`

## Goal

Produce a brutal investigation report and implementation spec for restoring the real signed-in Event Creator wizard on phone browsers. The outcome Seth wants is not another stripped-down Home: a signed-in organiser on mobile Chrome/Safari must be able to start Create from Business Home and complete the actual Event Creator workflow quickly and reliably.

## Required Outputs

1. `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
2. `Mingla_Artifacts/specs/SPEC_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`

Return to Codex `orchestrator-mingla` for review. Do not implement product code.

## Mandatory Context

Read `COMMS_LEDGER.md` first from the anchor checkout. Factor COMMS-0015/0018: deploy/OTA only from merged main, never from a worktree. Factor COMMS-0021: seller/payout user-facing copy stays provider-neutral.

Read these artifacts before conclusions:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
- `Mingla_Artifacts/reports/QA_ORCH-1087_BUSINESS_WEB_STATIC_ROUTE_FIREWALL.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/QA_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`

## Affected Surfaces

Primary: Business Web production/preview on phone browsers, static Home Create handoff, `/event/create`, `/event/{draftId}/edit`, and Event Creator Step 1-7.

Explicitly NOT in scope: Business iOS, Business Android, Consumer iOS/Android, Admin Web, buyer checkout, Hub, Ari, marketing/composer, Account, and payout-management, except for shared route-wide imports that are proven direct blockers for Event Creator.

## Investigation Questions

1. How does static `public/home.html` know a browser is signed in, and does that session correctly hydrate the Expo route at `/event/create` on phone browsers?
2. Why did Seth see welcome/logo success followed by Safari/phone-browser repeated-problem, white screen, or `Something went wrong` on `/auth/callback` and then later after sign-in?
3. After ORCH-1088, what happens on a signed-in phone browser when `/event/create` loads: auth status, current-brand query, draft creation/reuse, local draft hydration, route transitions, and first visible wizard state?
4. Which Event Creator Step 1-7 components import native-only or web-unsafe modules, including media pickers, date/time controls, Mapbox/location input, draggable lists, Stripe/payout gates, QR/share, haptics, animations, overlays/sheets, or browser APIs?
5. What exact route contract is needed before Home Create can change from `#create-event` to `/event/create`?
6. What automated regression tests can run in-repo and fail on the old broken behavior? What must remain a manual Android Chrome/Safari auth gate?
7. What performance/load proof is required so the wizard is not just correct but fast enough on phone browsers?

## Required Runtime Proof

Use physical Android Chrome if `adb devices` shows Seth's plugged-in phone; otherwise record the blocker and use Playwright/mobile browser proof plus a Safari-equivalent path. Try to reproduce production and local/export behavior. Capture console errors, network failures, visible text, URL transitions, and whether the route shows real wizard UI, terminal recovery, or generic crash.

## Hard Guards

- No implementation in this phase.
- No Home Create relink until spec success criteria require and tester can prove Android Chrome + Safari Step 1-7.
- No stripped-down replacement wizard as the final answer unless the spec explicitly proves a web-specific degradation is necessary and names the exact user-facing copy.
- Preserve provider-neutral copy such as `Payout account`, `Connect bank`, and `Connect a bank`; do not introduce user-facing `Stripe account` copy.
- Do not change `web.output`, `asyncRoutes`, or Vercel rewrites in this ORCH unless the investigation proves they are directly required for Event Creator and explicitly coordinates with ORCH-1085.
- Any behavior fix spec must require repo-running regression tests in the same implementation commit/push.

## Expected Spec Shape

The spec must define:

- Root cause findings with six-field proof.
- Layer-by-layer implementation contract for auth/session, current brand, draft creation/reuse, wizard route state, Step 1-7 web parity, media picker degradation, error/retry/recovery states, performance budget, telemetry/logging if needed, and Home Create relink gate.
- Success criteria for Android Chrome and Safari.
- Automated tests/scripts to add or update.
- Manual tester gates for signed-in browser proof.
- Deploy plan: PR with `[deploy]` for web if product code changes, merge to main, Vercel from merged main, no native OTA unless shared native JS changes and orchestrator explicitly decides it is required.
