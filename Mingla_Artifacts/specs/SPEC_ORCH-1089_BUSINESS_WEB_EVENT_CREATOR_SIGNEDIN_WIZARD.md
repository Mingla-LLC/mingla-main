# SPEC: ORCH-1089 Business Web Signed-In Event Creator Wizard Parity

Date: 2026-06-05  
Agent: Codex `forensic-mingla`  
Mode: SPEC from investigation  
Input report: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`

## Objective

Restore the real signed-in Business Web Event Creator wizard for phone browsers without reopening the ORCH-1085 full-route crash/spinner class. A signed-in business user on a phone browser must be able to start Create from static Home, enter the real Step 1-7 wizard, save a real draft under their current brand, and recover safely from auth, brand, draft, and module failures.

## Non-Goals and Hard Guards

- Do not deploy from this ORCH worktree. Durable deploys happen only after merge to `main`.
- Do not change `web.output`, `asyncRoutes`, or Vercel rewrites unless directly proven necessary and coordinated with ORCH-1085.
- Do not relink static Home Create before signed-in route and Step 1-7 runtime proof passes.
- Do not ship a stripped-down final wizard. The real Event Creator Step 1-7 flow remains the target.
- Do not replace provider-neutral payout copy with provider-specific seller copy. Use `Payout account`, `Connect bank`, or equivalent neutral language.
- Do not dispatch implementor from this spec. Return to orchestrator for review/routing.

## Required Implementation Order

1. Add the ORCH-1089 regression gate first.
2. Fix signed-in missing-draft web exit behavior.
3. Harden current-brand recovery error classification.
4. Prove signed-in `/event/create -> /event/{draft.id}/edit?step=0` on phone browsers with a real session or approved test fixture.
5. Prove Step 1-7 interactions and degraded phone-web cover upload behavior.
6. Only after the proof above, relink static Home Create for signed-in phone-browser users.

## Layer Contract

### 1. Static Home

File: `mingla-business/public/home.html`

Requirements:

- Preserve static Home as the phone-browser launcher.
- Preserve hash-shell links for Hub, Ari, Marketing, Account, and payout unless separately proven safe.
- Preserve provider-neutral `Payout account` copy.
- Add a reopen marker only after signed-in proof passes. Recommended marker: `data-orch-1089-create-reopened`.
- When reopened, Create may link to `/event/create` only for the intended signed-in phone-browser path and only with a fallback that can return to static Home.
- Static Home must not rely on localStorage email display as proof of a usable Expo auth session.

Acceptance criteria:

- Without the ORCH-1089 marker, Home Create remains `href="#create-event"` and opens the shell.
- With the ORCH-1089 marker and passing gate, Home Create reaches `/event/create`.
- If `/event/create` terminates with auth/brand/draft failure, `Back to Home` returns to static Home, not a full tabs route.

### 2. `/event/create`

File: `mingla-business/app/event/create.tsx`

Requirements:

- Keep bounded terminal states: signed out, auth timeout, auth error, brand error, no brand, draft hydration timeout.
- Keep draft creation gated on usable auth, current-brand recovery, draft-store hydration, and non-null current brand.
- Add any needed telemetry/logging for signed-in success and terminal failure, but do not log tokens or PII.
- Do not mint a draft until the route has a trustworthy current brand.
- Do not convert transient backend/brand query failures into "no brand" copy.

Acceptance criteria:

- Unsigned phone-browser `/event/create` still renders the ORCH-1088 sign-in recovery screen in Chromium mobile and WebKit mobile.
- Signed-in phone-browser `/event/create` creates one draft and redirects to `/event/{draft.id}/edit?step=0`.
- Repeated route mounts do not create duplicate local/server drafts.
- Brand/query failures produce a retryable brand/auth data error, not "Create or select a brand."

### 3. Current Brand Recovery

File: `mingla-business/src/hooks/useCurrentBrandRecovery.ts`

Requirements:

- Surface upstream `useBrands` and `useCreatorAccount` query errors as recovery errors.
- Preserve the existing default-brand-save warning behavior.
- Do not mark recovery complete while required queries are still unresolved.
- Distinguish:
  - true no-brand account,
  - failed brand/account query,
  - failed default-brand persistence after a temporary brand was selected.

Acceptance criteria:

- A real no-brand account sees "Create or select a brand before starting an event."
- A failed brands query or creator account query sees retryable failure copy.
- Unit tests cover all three branches.

### 4. Edit Route Recovery

File: `mingla-business/app/event/[id]/edit.tsx`

Requirements:

- Replace the immediate web `router.replace("/(tabs)/home" as never)` missing-draft branch with static-safe behavior.
- Preferred behavior: show bounded missing-draft recovery before navigation and make `Back to Home` use `safeEventsExitRoute()`.
- If auto-navigation is retained, it must call `safeEventsExitRoute()` on web.
- Preserve native behavior unless tests prove a native change is needed.

Acceptance criteria:

- Signed-in web stale/missing draft links never navigate to `/(tabs)/home`.
- Web missing-draft recovery reaches `/home#hub-events`.
- Existing unsigned missing-draft recovery continues to render in Chromium mobile and WebKit mobile.

### 5. Event Creator Wizard Step 1-7

Files:

- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `CreatorStep1Basics.tsx`
- `CreatorStep2When.tsx`
- `CreatorStep3Where.tsx`
- `CreatorStep4Cover.tsx`
- `CreatorStep5Tickets.tsx`
- `CreatorStep6Settings.tsx`
- `CreatorStep7Preview.tsx`
- supporting sheets/components imported by those steps.

Requirements:

- Keep the real seven-step wizard. Do not remove steps to pass phone-browser tests.
- Step 1: basics fields accept input and Next is reachable.
- Step 2: web date/time controls use browser-native hidden inputs or an equivalent phone-web-safe path. MDN `datetime-local` reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/datetime-local
- Step 3: Mapbox suggestions must not crash the route; if test credentials cannot call Mapbox, manual proof must cover typing and recovery.
- Step 4: provider/color cover choices remain usable; phone-web device upload remains honestly degraded unless a separate P3D upload implementation is approved.
- Step 5: ticket sheet opens, saves a free ticket, and the sale-period controls do not crash phone web.
- Step 6: visibility and toggles work.
- Step 7: preview/status renders; paid-ticket blocked state remains provider-neutral.

Acceptance criteria:

- Phone browser can navigate Step 1 through Step 7 without blank screens, crashed tabs, hidden bottom dock, or unusable keyboard overlap.
- The wizard is not reduced to a final-only or recovery-only surface.
- Phone-web Step 4 device upload says it is available on desktop or in the app, while provider/color paths remain usable.
- Step 7 paid-ticket blocking copy says `Connect a bank` or equivalent provider-neutral copy, not `Connect Stripe`.

### 6. Native Module and Web Shim Safety

Files:

- `mingla-business/metro.config.js`
- `mingla-business/src/shims/reactNativeReanimatedWebStub.js`
- `mingla-business/src/components/ui/Sheet.web.tsx`
- `mingla-business/src/components/ui/CoverPicker.tsx`

Requirements:

- Keep the Reanimated web stub with `Easing.bezier` and `runOnUI`.
- Keep `Sheet.web.tsx` importing `./SheetMobile`, not `./Sheet`.
- Do not add new native-only module imports to Step 1-7 route chunks unless they are platform-split or web-shim-safe.
- If a native module is proven to crash web route evaluation, fix the import boundary with a web shim/platform split rather than hiding the whole step.

Acceptance criteria:

- Exported web build succeeds.
- Chromium mobile and WebKit mobile load `/event/create` and `/event/{id}/edit`.
- No page errors from native module evaluation during signed-in Step 1-7 proof.

### 7. Database, RLS, and Supabase

No migration is currently specified. The investigation did not prove a schema/RLS defect.

Requirements if implementation discovers DB work is actually required:

- Stop and route back to forensics/orchestrator before adding a migration.
- Read the full migration chain and latest remote migration head.
- Use a monotonic migration prefix greater than the existing max migration version.
- Keep all draft/event writes authenticated and brand-owned.

Acceptance criteria:

- No unapproved migration ships in ORCH-1089.
- Signed-in draft creation uses existing authenticated Supabase paths.

### 8. Tests and Verification

Add `test:orch-1089` in `mingla-business/package.json`.

Minimum automated gates:

- Source guard: Home Create cannot link to `/event/create` unless `data-orch-1089-create-reopened` exists.
- Source guard: Home cannot contain user-facing `Stripe account`.
- Source guard: `app/event/[id]/edit.tsx` cannot contain `router.replace("/(tabs)/home" as never)` in the web missing-draft branch.
- Source guard: Reanimated web stub still exports `Easing.bezier` and `runOnUI`.
- Unit/hook test: current-brand recovery surfaces brands query errors and creator account query errors.
- Route test: `/event/create` still has bounded terminal states.
- Route test or Playwright test: signed-in create route creates exactly one draft and reaches Step 1.
- Playwright mobile test: Chromium mobile and WebKit mobile traverse Step 1-7 with a signed-in fixture.
- Playwright mobile test: static Home Create reaches the real route only after the reopen marker is present.

The regression test must ship in the same scoped GitHub commit/push as the feature or fix. Any part that cannot be automated must become an explicit tester manual gate.

Required manual/runtime gates:

- Re-check physical Android:

```text
adb devices -l
```

- If a device row appears, prove Android Chrome using remote debugging and record screenshots/logs. Chrome remote debugging docs: https://developer.chrome.com/docs/devtools/remote-debugging/
- If no device row appears, record exactly:

```text
List of devices attached
```

with no device rows, and use Playwright Chromium mobile plus WebKit mobile as fallback.
- Safari-equivalent proof must use WebKit mobile unless blocked; if blocked, document the exact Playwright/WebKit failure.

## Launch and Deploy Contract

- Do not deploy from the ORCH worktree.
- After implementation and tester pass, merge to `main`.
- Deploy only from clean, merged `main` per COMMS-0015/0018.
- If production route behavior differs from local static serving, coordinate with ORCH-1085 before changing rewrites.

## Done Criteria

ORCH-1089 is complete only when:

- Static Home Create opens the real Event Creator for signed-in phone-browser users.
- `/event/create` signed-in flow creates one real draft and reaches Step 1.
- Step 1-7 traversal is proven on Chromium mobile and WebKit mobile.
- Physical Android Chrome is proven if a device is attached; otherwise the exact no-device blocker is documented.
- Missing-draft web paths never route to full tabs Home.
- Provider-neutral seller/payout copy remains intact.
- `npm run test:orch-1089` and relevant existing guards pass.
- Tester signs off before any deploy from merged `main`.
