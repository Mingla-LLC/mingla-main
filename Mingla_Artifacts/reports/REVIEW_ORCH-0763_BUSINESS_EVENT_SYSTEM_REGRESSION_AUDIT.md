# Review: ORCH-0763 Business Event System Regression Audit

> Date: 2026-05-08
> Skill: `$orchestrator`
> Reviewed artifact: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md`
> Verdict: APPROVED FOR SPEC DISPATCH

## Bottom Line

ORCH-0763 is now the top Mingla Business launch blocker.

Plain-English impact: organisers can create or believe they published an event, then lose sight of it after a new build or local storage loss. The system is split between server-backed drafts, server-backed public buyer reads, and local-only organiser published events. That split makes the event workflow feel haunted from the user's point of view, but the evidence is very concrete: the app has more than one owner for event truth.

## Review Decision

Approved next gate: `$forensics` SPEC.

Not approved: direct implementation, Giphy/Pexels expansion, broad media buildout, or another runtime-only smoke as the next step. The failure is architectural enough that implementation needs a bounded spec before an implementor touches code.

## Evidence Accepted

The investigation proves five launch-blocking contracts:

1. Published organiser events are still local-only in the core organiser shell.
2. Publish is not atomic and does not prove a durable server promotion.
3. The current remote-shaped evidence does not contain the user's reported published/free event as a durable published event.
4. Wizard typing instability is explained by immediate full-object autosave and stale server/list responses overwriting dirty local state.
5. Edit-published cannot survive local store loss.

Accepted evidence anchors:

- `mingla-business/app/(tabs)/home.tsx:131-133`
- `mingla-business/app/(tabs)/events.tsx:114-116`
- `mingla-business/app/event/[id]/index.tsx:106-108`
- `mingla-business/app/event/[id]/edit.tsx:73-78`
- `mingla-business/src/services/eventDrafts.ts:35-59`
- `mingla-business/src/services/eventDrafts.ts:169-189`
- `mingla-business/src/components/event/EventCreatorWizard.tsx:310-320`
- `mingla-business/src/hooks/useServerDraftEvents.ts:148-169`
- `/tmp/mingla_public_dump.sql:150594-150610`

## Lifecycle Decision

ORCH-0763 supersedes the current close path for ORCH-0756B, ORCH-0758A, and ORCH-0759 as the larger event-system integrity repair.

Those items remain useful evidence, but they should not be closed independently as "event system ready" while ORCH-0763 is open:

- ORCH-0756B proved server-backed drafts directionally, but did not solve published organiser event authority or autosave race hardening.
- ORCH-0758A cover media remains runtime-gated and should pause behind event integrity.
- ORCH-0759 improved public URLs, but event publication itself can still be false-local and non-durable.

## Approved Spec Scope

The spec must cover one coherent repair contract:

- Atomic server-side publish RPC / transaction.
- Server-backed organiser management event reads for scheduled/live/ended/cancelled events.
- Conversion of local `liveEventStore` from source of truth to cache only.
- Edit-published server hydration.
- Wizard autosave debouncing, revisioning, and stale-response protection.
- Free-only publish acceptance path.
- Recovery probes for the user's missing event.
- Regression tests that fail on the current split-authority behavior.

## Hard Non-Goals

- Do not implement product code in the spec step.
- Do not build Giphy/Pexels provider search yet.
- Do not expand profile/brand media until the event publish/source-of-truth repair is stable.
- Do not rely on local Zustand as the authoritative published-event store.
- Do not close ORCH-0756B/0758A/0759 as event-system-ready while ORCH-0763 P0s remain open.

## Next Gate

Dispatch `$forensics` with:

`Mingla_Artifacts/prompts/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

Expected output:

`Mingla_Artifacts/specs/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
