# IMPLEMENTATION REWORK - ORCH-0763 Business Event System Regression Repair

Date: 2026-05-08
Role: `$implementor`
Scope source: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

## Verdict

CONDITIONAL PASS.

The client-side repair is implemented and verified locally. The remaining blocker is deployment/remote database state: local migration `20260515000004_orch_0763_event_system_regression_repair.sql` is still not applied to the linked remote database.

## What Changed

1. Autosave stale-response protection
   - Added revision-aware draft guards in `mingla-business/src/utils/serverDraftAutosaveGuards.ts`.
   - Added `clientRevision`, active edit metadata, dirty/saved markers, and server-aware upsert paths in `draftEventStore`.
   - Updated `EventCreatorWizard` so edits and step progress bump a local revision before autosave.
   - Updated server draft mapping/autosave/publish paths so revision metadata is preserved and sent.

2. Server-backed lifecycle honesty
   - Server-loaded Event Detail no longer pretends local lifecycle actions succeeded.
   - End-sales/cancel actions for server-backed events now surface honest unavailable toasts.
   - `EventManageMenu` accepts `canUseLifecycleActions` so server-backed events do not expose unsupported local lifecycle actions.

3. Legacy `le_...` route recovery
   - Added `useManagedEventRoute` to resolve server-backed events by real server ID while preserving local fallback.
   - Event Detail and edit routes redirect legacy `le_...` IDs with `serverEventId` to the durable server event ID.

4. Event Detail management subroutes
   - Rewired orders, order detail, guests, guest detail, scanner, scanners, door sales, door sale detail, and reconciliation routes to use shared server-backed event resolution.
   - These routes now show loading while server event resolution is pending instead of immediately rendering false "Event not found" states.

5. Regression tests
   - Added pure tests for autosave revision guard behavior.
   - Expanded lifecycle/static guards to cover autosave revision wiring, server lifecycle honesty, and all managed event subroutes.
   - Updated publish RPC tests so publish sends `p_client_revision`.

## Verification

Passed:
- `npx tsc --noEmit`
- `npm run test:orch-0763`
  - 5 suites passed
  - 31 tests passed
- `npm run test:orch-0759`
  - 4 suites passed
  - 27 tests passed
- `npm run test:orch-0756b`
  - 2 suites passed
  - 22 tests passed
- `git diff --check`
- Targeted `npx eslint ...`
  - Exit code 0
  - Existing warnings remain in touched/pre-existing files; no lint errors remain.

Remote state checked:
- `/Users/sethogieva/bin/supabase migration list --linked`
- Result: `20260515000004` is local-only; remote column is blank.

## Remaining Blocker

The client can now handle server-backed links/routes more honestly, but production cannot be considered repaired until migration `20260515000004` is applied through the approved release path.

No `supabase db push`, deploy, or production data mutation was run in this pass.
