# DESIGN - ORCH-1094 Business Web Core Parity Wave

Date: 2026-06-06
Skill: Codex `ui-ux-mingla`
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`
Branch: `ORCH-1094-business-web-core-parity-wave`
Mode: design direction only; no product-code implementation

## Executive Design Decision

ORCH-1094 should treat Mingla Business phone-browser work as the real organiser product, not as a landing page and not as a permanently stripped static shell. The design target is an app-like, dense, route-based business workspace that uses the existing Mingla Business dark canvas, glass surfaces, warm orange actions, bottom tabs, list cards, sheets, and operational copy patterns.

The current safety truth is still binding: `Create event` is the only approved signed-in phone route; Hub Events, Marketing, Composer, Account, and Hub Trips are `pending-proof`; Experiences, Ari, and payout management are blocked. ORCH-1094 design direction therefore has two simultaneous jobs:

1. Design the real restored route families so implementor has a premium, coherent end state.
2. Keep protected recovery honest and polished until physical Android Chrome plus mobile Safari proof allows a route to reopen.

## Comms Ledger And Hard Constraints

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first. Acknowledged relevant open `ALL` WARN rows on anchor `main` commit `b47b71eb1` as `ui-ux-mingla+codex (ORCH-1094 design ...)`.

Design constraints carried forward:

- Preserve provider-neutral payout copy from COMMS-0021: use `Payout account`, `Connect bank`, `Payments & Bank`, `payout account management`, and `generated secure session`; do not introduce user-facing `Stripe account`, `Connect Stripe`, or `Payments & Stripe` on restored seller surfaces.
- Do not deploy, OTA, merge, reap, or mutate backend/provider state from this design pass.
- Do not claim full route parity until merged-main route proof exists and physical phone-browser gates pass.
- If a future implementation changes provider payloads or Account Session behavior, the spec must cite canonical Stripe docs; this design report does not authorize provider API changes.

## Surface And Audience

Surface: Mingla Business Web in phone browsers, launched from static `/home` into Expo Web route families.

Audience: organisers and brand operators who need to create listings, manage live/draft/past items, compose campaigns, and keep account/payout readiness moving from a phone when the native app or desktop is not available.

Workflow stage: signed-in post-auth Home, route entry, route recovery, create/manage/market/account actions, and protected fallback states.

User intent: complete a real business task quickly without being trapped in a crash, blank page, stale chunk loop, missing-session link, or misleading unsupported state.

## Local Pattern Proof

Inspected local sources:

- `mingla-business/src/constants/designSystem.ts`: spacing scale, radius scale, dark canvas, glass tint/border, semantic colors, typography, warm orange accent, Android-safe glass shadows, motion durations.
- `mingla-business/public/home.html`: static Home, bottom tabs, glass cards, hash shells, ORCH-1092 reopen markers, provider-neutral payout shell copy.
- `mingla-business/app/_layout.tsx`: ORCH-1092 signed-out recovery and ORCH-1093 route status map for approved, pending-proof, and blocked phone routes.
- `mingla-business/scripts/inject-mobile-blur-css.mjs`: pre-Expo protected route recovery and script deferral.
- `mingla-business/app/(tabs)/hub/events.tsx`: dense Events list route with filters, list cards, manage/share/end-sales lazy surfaces.
- `mingla-business/app/(tabs)/marketing/index.tsx`: metrics overview, recent campaigns, FAB, loading/error/empty states.
- `mingla-business/app/(tabs)/account.tsx`: TopBar, brand rows, settings rows, sign-out, lazy brand switcher/delete/create sheets.
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`, `BrandProfileView.tsx`, and `src/utils/brandPayout.ts`: provider-neutral payout readiness and account-management copy patterns.
- Prior ORCH artifacts: ORCH-1085 inventory, ORCH-1087 route gate, ORCH-1088/1089 Event Creator investigations, ORCH-1092 close/QA, ORCH-1093 investigation/spec/implementation/QA/review.

Design-search guidance used only as support, not as a new visual language:

- Accessible mobile surfaces need visible focus states, 44px+ targets, form labels, reduced-motion handling, and adequate touch spacing.
- Touch targets need at least 8px spacing between adjacent controls.
- Placeholder-only inputs are not acceptable for form-heavy routes.

## Product Shape

### Static Home

Static Home remains the phone-browser launcher and safety net. It should feel like the compact Mingla Business dashboard: brand mark, signed-in state, primary next action, KPI/status tiles only when truthful, five bottom tabs, and immediate route status feedback.

LOCKED:

- `/home` stays Expo-free and visually aligned with Business tokens.
- Bottom tabs remain stable and tappable with 56px+ tab targets.
- Static Home must never contain fabricated KPIs, revenue, counts, ratings, or statuses.
- Static Home can link directly only to routes marked approved by route evidence.
- Pending-proof and blocked route actions must show purposeful route status, not generic "coming soon" copy.

OPEN:

- The Home hero copy can become slightly less promotional and more operational, for example: `Business Home` plus `Create, manage, and message buyers from your phone.`
- Static Home can show a route-readiness row per tab if it uses real route state and does not add fake progress.

### Event Creator

Target experience: `Create event` should feel like the native organiser wizard compressed for phone web. It should not be a separate web-lite form. It should use the real Step 1-7 sequence, with browser-safe date/time, Mapbox, validation, ticketing, cover media degradation, and publish readiness.

Current truth: `/event/create` is approved by ORCH-1093 Android proof and should remain the main exemplar for a real restored route.

LOCKED:

- First screen must reach Step 1 or a bounded recovery state within 8 seconds.
- Wizard steps use the existing dense card/list/form rhythm, not landing-page hero sections.
- Step headers should be compact: step label, title, short helper, progress affordance.
- Primary action is warm orange; secondary actions are glass/outline; destructive actions use semantic error.
- Every input has a visible label, not placeholder-only copy.
- Web media upload degradation must be explicit and useful: if device upload is not supported on phone web, show alternate actions and explain desktop/app path without blaming the user.
- Publish/bank readiness copy remains provider-neutral: `Connect bank`, `Payout account`, `payout-ready`, not Stripe-branded.

States to design:

- Loading: auth/session, brand recovery, draft hydration, first route chunk, autosave.
- Empty/no-brand: clear route to create/select brand, not an indefinite spinner.
- Error: auth timeout, brand query error, draft hydration timeout, missing draft, autosave failure, publish validation.
- Submitting: save, publish, discard, upload, ticket changes.
- Offline: draft remains local where possible; show save uncertainty.
- Permission: `event_manager` or higher required for create/publish actions.
- Rollback: failed publish/autosave returns the user to the last editable step with visible error.
- Success: draft saved/published with next action to preview/share/manage.

### Hub

Target experience: Hub is the organiser's operations list, not a marketing overview. The first restored Hub surface should prioritize Events because it is already the strongest candidate. Experiences and Trips should remain protected until their route chunks and native file-ingestion risks are proven.

LOCKED:

- Hub Events first screen should show filter pills, counts when real, loading skeleton, empty state, and event cards without opening share/manage bodies at first paint.
- Filter controls must not move layout when counts load.
- Manage/share/end-sales controls should lazy-load as sheets only after user action.
- Hub Experiences and Trips must not be presented as equally restored until route evidence exists; keep them in Home as protected entries with honest copy.
- Detail navigation must provide a static-safe return path (`/home#hub` or route-safe equivalent) when phone-web recovery blocks direct tab return.

States to design:

- Loading: skeleton rows, not spinner-only.
- Empty: universal "Nothing created yet" when no events/trips/experiences exist; event-specific empty only when other offerings exist.
- Error: retry with visible route and data state.
- Populated: filters, live/upcoming/draft/past grouping, compact cards.
- Permission: rows/actions disabled with explanation when role cannot manage.
- Submitting: cancel, end sales, delete draft, share-copy actions.
- Offline: list can show cached/stale if truthful; destructive actions disabled.
- Rollback: failed lifecycle action restores prior row state and shows toast.

### Marketing / Blast

Target experience: Marketing should feel like a lightweight campaign console. The overview can reopen before full send parity only if it is clear what is available and what is still gated. Composer shell must be functional enough for typing and schedule selection before Home links to it as a real task.

LOCKED:

- Marketing overview uses real metrics only. No fake sent/delivered/clicked counts.
- Overview first screen is compact: headline metric, four metric cards, recent campaigns, and a persistent `New campaign` action.
- Composer shell must support subject typing, body typing, template/personalization affordances, browser-native date/time controls, preview/review shell, visible save errors, and safe return.
- Browser-native date/time controls must retain visible labels and target size.
- Full send/delivery can remain later if the UI says the campaign is draft/review-only and does not imply delivery when not proven.

States to design:

- Loading: metric skeleton and composer skeleton.
- Empty: "Your first blast is one tap away" style, with a real action.
- Error: metrics/campaign load retry.
- Populated: real recent campaigns and statuses.
- Submitting: save draft, schedule, review.
- Offline: save disabled or local-draft warning; no fake sent state.
- Permission: marketing permission unavailable state.
- Rollback: failed schedule/save returns to composer with field-level error.

### Account And Payout Readiness

Target experience: Account should be the phone web control center for brand/profile/team/sign-out and payout readiness. Payout management is not a direct static route; it requires a generated secure session.

LOCKED:

- Static Home and Account must preserve provider-neutral payout copy.
- `Payout account` from Home stays protected unless implementation generates a secure session through an authenticated route.
- Account can expose readiness and next action, but cannot link directly to sessionless `/connect-account-management`.
- Invalid generated-session states must say what happened and provide `Return to Account` / `Return to Home`.
- If Account is pending-proof, recovery copy must not imply payout tools are usable in phone web yet.

States to design:

- Loading: brand list, partner rows, payout readiness.
- Empty/no-brand: create/select brand route.
- Error: brand query, partner status, payout readiness.
- Permission: team/admin-only rows disabled with explanation.
- Submitting: sign-out, brand switch, create brand, delete brand.
- Offline: no destructive account changes.
- Generated-session error: clear "Could not open payout account management. Try again."
- Success: generated payout/session flow returns to Account with a status message.

## Protected Recovery Design

The existing recovery copy is correct in spirit but should read less like an engineering gate and more like an intentional product state.

Recommended recovery hierarchy:

- Eyebrow: `Mingla Business`
- Title for pending routes: `<Route name> is protected on phone web.`
- Body: `This route needs Android Chrome and mobile Safari proof before direct phone entry opens. Use Home, desktop, or the Mingla Business app for now.`
- Primary action: `Return to Home`
- Optional secondary, only if available: `Open on desktop` or `Copy link`

LOCKED:

- Recovery is visible before Expo scripts for pending/blocked phone routes.
- Recovery must include the route family name.
- Recovery must not use generic error-boundary copy like `Something broke` when the app intentionally protected the route.
- Recovery must not overpromise: pending-proof means not restored yet.
- Recovery must maintain brand styling: dark canvas, glass card, orange primary action, no decorative blobs/orbs, no emojis.

OPEN:

- Copy may be softened, but the route status must remain honest.
- A route-status chip can distinguish `Protected`, `Requires desktop/app`, and `Needs secure session`.

## Navigation Model

LOCKED:

- Static Home is the safe launcher and return target.
- Phone-browser direct entry must be route-status aware before boot.
- Restored routes should preserve bottom-tab mental model where feasible, but not at the cost of first-paint memory.
- Back and refresh are part of the design contract, not QA afterthoughts.
- Hash shell routes should keep user in the static Home tab context.

OPEN:

- Implementor may use a route-local "Return to Home" affordance instead of full tab chrome on high-risk routes if that reduces boot cost and is visually coherent.
- Route-first screens may use lighter top chrome on phone web while preserving the same underlying product workflow.

## Visual System

LOCKED:

- Primary accent: `accent.warm` / `#eb7825`.
- Canvas: `canvas.depth` / `#08090c` and dark operational backgrounds.
- Cards: `glass.tint.profileBase/profileElevated` with `glass.border.profileBase/profileElevated`.
- Radius: 12-24px for route cards/sheets, 999px for pills/tabs.
- Spacing: 8/16/24/32 scale; compact dense route surfaces, not oversized hero sections.
- Typography: compact labels, 15-17px body/row text, 20-24px route section titles, no viewport-scaled type.
- Icons: existing `Icon`/`IconChrome` patterns; no emojis-as-icons in product controls.
- Blur/glass: functional and conservative because ORCH-1085/1091 proved mobile blur/chunk recovery is safety-critical.

OPEN:

- Static Home can keep a subtle warm radial accent if it does not dominate the palette or introduce blur/performance risk.
- Recovery cards can use a single route-status chip and one supporting list item if the copy remains short.

## Accessibility Criteria

LOCKED:

- Touch targets: minimum 44px, preferred 48px; adjacent targets separated by at least 8px.
- Contrast: body text and controls target WCAG AA contrast, with `text.primary/secondary` on dark glass never dropping below legible opacity.
- Labels: all form fields and date/time inputs have visible labels and accessible labels.
- Focus: web keyboard focus rings visible on links, buttons, inputs, pills, tabs, and recovery actions.
- Keyboard: composer and creator fields avoid footer overlap; `keyboardShouldPersistTaps` where relevant.
- Back behavior: browser Back from restored routes must not strand users on blank protected pages.
- Reduced motion: lazy sheets/transitions respect reduced-motion and can degrade to instant open.
- Text scaling: buttons, chips, tabs, and cards must not clip at larger browser text sizes.

## Implementation-Ready UI Acceptance Criteria

### Global Route Gate

- LOCKED: `/home` first paint remains static, Expo-free, and usable.
- LOCKED: every Home action has one of three visible statuses: approved real route, pending protected recovery, or blocked/generated-session-only.
- LOCKED: pending/blocked phone direct routes render recovery before Expo boot and include `Return to Home`.
- LOCKED: no route status copy contains `Stripe account`, `Connect Stripe`, or `Payments & Stripe` in user-facing text.
- LOCKED: route recovery screenshots at 375px and 430px widths show no clipped text, overlap, or horizontal scroll.

### Event Creator

- LOCKED: Create opens Step 1 or bounded recovery within 8 seconds on Android Chrome and mobile Safari.
- LOCKED: Step 1-7 each has loading, validation error, save/submitting, and permission/capability states.
- LOCKED: Step 4 media upload has honest phone-web degradation or a proven browser file path.
- LOCKED: Step 5/7 payout readiness uses `Connect bank` / `Payout account`.
- LOCKED: publish/save failures are field-specific where possible and never silent.
- OPEN: implementor may split wizard step chunks if the UI remains visually identical.

### Hub

- LOCKED: Hub Events first screen shows useful loading/empty/error/populated states without eager share/manage bodies.
- LOCKED: Events filter pills are 44px+ high, horizontally scrollable if needed, and stable under count changes.
- LOCKED: lifecycle actions open sheets only after tap and include cancel/error/rollback states.
- LOCKED: Experiences and Trips remain protected unless implementation proves route-first-screen safety.
- OPEN: Trips may be restored before Experiences if it passes route budgets and physical browser proof.

### Marketing

- LOCKED: Marketing overview displays only real campaign metrics and real campaign rows.
- LOCKED: Composer shell supports subject/body typing, preview/review shell, and web-native schedule controls before Home direct link is allowed.
- LOCKED: schedule controls use visible labels and browser-native inputs on web.
- LOCKED: full send can stay later, but copy must say draft/review if send is not proven.
- OPEN: campaign template drawer can be disabled with honest copy if it is not route-safe yet.

### Account / Payout

- LOCKED: Account first screen has brand list loading/empty/error/populated states and a safe sign-out path.
- LOCKED: payout readiness copy remains provider-neutral.
- LOCKED: Home `Payout account` never directly opens sessionless `/connect-account-management`.
- LOCKED: generated-session errors explain the missing/expired secure session and return to Account/Home.
- OPEN: Account route can show a "Manage payouts & tax" action only after the route generates or receives a valid secure session.

## Tester Visual And Interaction Checks

Run only after the full ORCH-1094 implementation slice is complete.

Required phone-browser checks:

1. Android Chrome physical device on production-equivalent merged-main preview or production after merge.
2. Mobile Safari on iPhone, real device preferred.
3. Widths: 360/375, 390/430, and one desktop sanity width.
4. `/home`: first paint, all five tabs, all visible actions, Back/refresh/re-entry.
5. `/event/create`: Step 1 route, step navigation, field validation, save/publish recovery, media degradation, payout readiness copy.
6. `/hub/events`: loading/empty/error/populated if fixtures allow, filters, share/manage lazy sheet open/close.
7. `/marketing`: overview loading/error/empty/populated; composer subject/body/schedule/preview shell.
8. `/account`: brand list, settings rows, sign-out trigger, payout readiness action/shell.
9. Protected routes: `/hub/trips`, `/hub/experiences`, `/ari`, `/connect-account-management` until reopened; expected protected copy and zero Expo JS resources on phone.
10. Crash scan: no `Aw, Snap`, no V8 OOM, no `CrRendererMain`, no stale chunk loop, no blank page after 8 seconds.

Accessibility checks:

- Keyboard focus visible on desktop web.
- Mobile controls hit 44px+ target size.
- Large text does not clip bottom nav, cards, action rows, or recovery card.
- Reduced motion path does not depend on long animation.
- Form labels are visible and accessible.

## Downstream Routing Recommendation

Route to orchestrator review, then implementor for a bundled build only if the implementation prompt preserves the route-status truth:

- Build real product-quality phone-web route surfaces for Event Creator, Hub Events, Marketing overview/Composer shell, and Account.
- Keep pending/blocked protected recovery as a first-class state until each route has physical proof.
- Preserve ORCH-1091 cache/chunk recovery, ORCH-1092 provider-neutral payout copy, and ORCH-1093 fail-closed route protection.
- Require one combined tester pass after implementation; do not split visual acceptance away from crash/memory acceptance.

## Bottom Line

The premium Mingla Business phone-browser product is a dense operational app surface with real route workflows, not a hero page and not a static apology shell. ORCH-1094 should restore value route by route while keeping the current protected recovery states visually intentional, provider-neutral, and impossible to confuse with completed parity.
