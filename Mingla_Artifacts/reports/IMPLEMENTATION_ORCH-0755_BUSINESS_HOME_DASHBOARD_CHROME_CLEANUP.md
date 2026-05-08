# IMPLEMENTATION_ORCH-0755_BUSINESS_HOME_DASHBOARD_CHROME_CLEANUP

Status: implemented, partially verified
Date: 2026-05-08
Owner: Codex implementor

## Summary

Implemented the ORCH-0755 business home dashboard chrome cleanup in `mingla-business/app/(tabs)/home.tsx`.

The populated business home state no longer renders the greeting block (`Good morning/afternoon/evening`, `Hey, {brand}`). The full-width dashed bottom `Build a new event` CTA was removed. A compact `Build event` action now appears only inside the Upcoming empty card, where it explains the empty state and gives the user the next sensible action.

No event data, summary ownership, ORCH-0754 source-of-truth logic, stores, Supabase code, mobile app code, admin app code, or tests were changed.

## Files Changed

- `mingla-business/app/(tabs)/home.tsx`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0755_BUSINESS_HOME_DASHBOARD_CHROME_CLEANUP.md`

## Before / After

Before:

- Populated home rendered a greeting block above the dashboard cards.
- Populated home rendered a bottom full-width dashed `Build a new event` CTA with `About 4 minutes`.
- The build-event action lived outside the Upcoming context, so it looked visually detached from the section it helped.

After:

- Populated home starts directly with the dashboard content.
- The detached bottom CTA is gone.
- `Build event` appears only when Upcoming is empty, inside the Upcoming empty card, with an accessible button role and label.
- Existing event summary rendering remains untouched for active draft/live/upcoming events.

## Verification

### TypeScript

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit
```

Result: PASS. The command exited `0` with no output.

### ORCH-0754 Regression Gate

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npm run test:orch-0754
```

Result: PASS.

Key output:

```text
I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
PASS src/utils/__tests__/brandEventSummary.test.ts
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

Note: Jest also emitted the existing Watchman recrawl warning for `/Users/sethogieva/Desktop/mingla-main`; it did not fail the test run.

### Removed Chrome Grep

Command:

```bash
rg -n "Hey, \\{currentBrand\\.displayName\\}|About 4 minutes|style=\\{styles\\.buildCta\\}|buildCtaTitle|buildCtaSub|greetingHey" "mingla-business/app/(tabs)/home.tsx"
```

Result: PASS. The command exited `1` with no matches, which is expected for this negative grep.

### Full Lint

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npm run lint
```

Result: FAIL due to pre-existing repo-wide lint debt outside this change.

Key output:

```text
✖ 188 problems (80 errors, 108 warnings)
  0 errors and 56 warnings potentially fixable with the `--fix` option.
```

The lint output did not include `mingla-business/app/(tabs)/home.tsx`. Reported errors were in other files such as `app/__styleguide.tsx`, `app/account/delete.tsx`, `app/event/[id]/index.tsx`, and multiple `src/components/*` files.

## Scope Guard

- Did not change the ORCH-0754 event summary helper or regression test.
- Did not change fabricated-data detection gates.
- Did not change brand/event stores, query ownership, Supabase schema/RLS/functions, Stripe code, mobile app, admin app, or public web surfaces.
- Did not alter event ordering, empty-state data rules, live-window behavior, or draft/live/upcoming classification.
- Did not touch unrelated dirty worktree files.

## Tester Notes

Recommended targeted QA:

- Business home with a current brand and active events: no greeting block, no bottom `Build a new event` CTA, active Upcoming cards still render real data.
- Business home with a current brand and no active events: Upcoming empty card shows the compact `Build event` action.
- Empty no-brand state still uses its existing onboarding prompt and topbar behavior.
