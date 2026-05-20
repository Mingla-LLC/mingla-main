# CLOSE ORCH-0894 — Business Desktop Web Layout Lock-In

Date: 2026-05-19
Follow-up close amendment: 2026-05-20
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Surface: `mingla-business` Expo web only

## Status

CLOSED PASS for the scoped desktop web layout and wizard navigation lock-in.

## Plain-English Impact

Mingla Business desktop web now uses the available workspace more cleanly without bleeding into the left navigation rail. Home and Hub lists use compact four-column desktop grids, the event and trip creator wizards have desktop-native chrome, and the wizard left nav is clickable so operators can leave the wizard through Home, Hub, Ari, or Blast instead of relying only on the close button.

## Scoped Changes

- Home upcoming events desktop grid fills left-to-right in four compact columns.
- Hub Events, Experiences, and Trips desktop lists fill left-to-right in four compact columns.
- Event and trip creator wizards render desktop-only app chrome with the Mingla Business logo rail, top bar, step rail, and compact form pane.
- Wizard mobile behavior remains gated behind `useResponsiveLayout`; desktop chrome only renders when `isWideDesktop` is true.
- Wizard desktop nav rail items are real `Pressable` controls with accessible labels.
- Wizard rail navigation uses `router.replace(...)` so clicking a rail item exits the wizard route.
- Wizard rail has explicit top interaction layering (`zIndex: 20`, `elevation: 20`) so the visible rail can receive clicks.
- 2026-05-20 follow-up: Home desktop Upcoming now has a bounded nested scroll region (`desktopOuterScroll`, `desktopUpcomingPane`, `desktopUpcomingList`) so the KPI/header area stays fixed while the four-column Upcoming grid scrolls.
- 2026-05-20 follow-up: Home desktop Upcoming grid has explicit breathing room below the `Upcoming` header via `marginTop: spacing.sm`.

## Verification

Focused regression command:

```bash
cd mingla-business
npx jest 'src/components/__tests__/wizardDesktopLayout.test.ts' 'src/components/__tests__/desktopWebLayoutContracts.test.ts' 'src/components/ui/__tests__/BottomNavWebDesktopPolish.test.ts'
```

Result:

```text
PASS src/components/ui/__tests__/BottomNavWebDesktopPolish.test.ts
PASS src/components/__tests__/desktopWebLayoutContracts.test.ts
PASS src/components/__tests__/wizardDesktopLayout.test.ts

Test Suites: 3 passed, 3 total
Tests:       12 passed, 12 total
```

Scoped TypeScript error filter:

```bash
cd mingla-business
npx tsc --noEmit --pretty false 2>&1 | rg 'src/components/event/EventCreatorWizard|src/components/trip/TripCreatorWizard|src/components/__tests__/wizardDesktopLayout'
```

Result: no matching TypeScript errors for the touched wizard/test files.

Whitespace check:

```bash
git diff --check -- mingla-business/src/components/event/EventCreatorWizard.tsx mingla-business/src/components/trip/TripCreatorWizard.tsx mingla-business/src/components/__tests__/wizardDesktopLayout.test.ts
```

Result: pass.

2026-05-20 follow-up verification:

```bash
cd mingla-business
npx jest 'src/components/__tests__/desktopWebLayoutContracts.test.ts'
```

Result:

```text
PASS src/components/__tests__/desktopWebLayoutContracts.test.ts

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

Operator runtime confirmation: "it works" on 2026-05-20 after the nested Home Upcoming scroll fix.

## Scoped Files

- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/hub/experiences.tsx`
- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/trip/TripCreatorWizard.tsx`
- `mingla-business/src/components/__tests__/desktopWebLayoutContracts.test.ts`
- `mingla-business/src/components/__tests__/wizardDesktopLayout.test.ts`
- `Mingla_Artifacts/reports/CLOSE_ORCH-0894_BUSINESS_DESKTOP_WEB_LAYOUT_LOCK_IN.md`

## Explicitly Excluded Dirty Work

The shared `Seth` working tree contained unrelated dirty work before this close, including ORCH-0892/ORCH-0893 artifact edits, marketing/composer files, marketing hooks, package changes, and other untracked reports/scripts. Those files were intentionally left unstaged and are not part of ORCH-0894.

## Deploy Notes

No migrations, edge functions, or native module changes. This is web-facing React Native/Expo UI code and regression tests only.
