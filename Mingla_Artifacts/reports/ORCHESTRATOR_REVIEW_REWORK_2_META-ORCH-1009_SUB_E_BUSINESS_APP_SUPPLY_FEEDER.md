# ORCHESTRATOR REVIEW - REWORK 2 - META-ORCH-1009 Sub-E Business-App Supply Feeder

Date: 2026-05-31
Reviewer: orchestrator+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

Do not send to tester yet. Rework #2 fixed the four prior Sub-E review blockers, but live dev-build smoke exposed a new P1 runtime loop in the shared CoverPicker video-ready path.

## Accepted From Rework #2

| Prior blocker | Review result |
|---|---|
| Hub visibility for deck-readiness coaching | Accepted. Hub now renders the venue readiness card under the claim banner when pipeline state is present and not draft. |
| Reason-specific one-tap fix routes | Accepted. `deckReadinessRoutes.ts` maps fix codes to durable `/venue/deck-readiness` focus targets. |
| Durable resume with persisted context | Accepted. `/venue/deck-readiness` hydrates persisted Tier 2, pending AI outputs, coaching, and cover state. |
| Refresh must not confirm/publish | Accepted at code/test level. `refresh_deck_readiness` is separated from confirmation semantics and has contract coverage. |

## New P1 Finding

### P1-5 - Hero video upload can trigger an infinite update loop

During phone dev-build smoke of the Sub-E worktree, Metro logged repeated:

```text
ERROR Maximum update depth exceeded. This can happen when a component calls setState inside useEffect...
Code: CoverPicker.tsx
293 | return;
295 | setMediaDisplayError(null);
296 | emitChange({
...
Call Stack
  useEffect$argument_0 (src/components/ui/CoverPicker.tsx:295:25)
  CoverPickerSheet (src/components/ui/CoverPickerSheet.tsx:89:11)
  BrandCreationFlow (src/components/brand/BrandCreationFlow.tsx:392:9)
  BrandSwitcherSheet (src/components/brand/BrandSwitcherSheet.tsx:81:11)
  HubTabLayout (app/(tabs)/hub/_layout.tsx:175:7)
```

The log appeared immediately after:

```text
[eventCoverVideoProcessingService] video_cover_upload_ready
```

Likely root cause from code inspection: `CoverPicker.tsx` emits the processed video patch inside an effect whose dependencies include `emitChange`; `emitChange` depends on `onCoverChange`; `BrandCreationFlow` passes an inline `onCoverChange` callback, so the ready-phase emit causes a parent render, changes the callback identity, changes `emitChange`, and reruns the ready effect while `videoUpload.stage.phase === "ready"` and `processedUrl` is still non-null.

## Required Rework

1. Make the shared CoverPicker video-ready emit idempotent per processed URL.
2. Preserve the existing upload, preview, provider metadata, toast, and `onCoverVideoProcessingChange` behavior.
3. Do not special-case only BrandCreationFlow if the shared CoverPicker effect is the real owner; this path is shared across brand, venue, event, and trip surfaces.
4. Add regression coverage that would fail if the ready effect can emit repeatedly for the same processed URL due to changing callback identity.
5. Rerun the focused CoverPicker tests plus the Sub-E readiness route/card tests before handing back.

## Tester Routing

Blocked until rework #3 returns with evidence that the CoverPicker ready loop is fixed. After that, route to tester for phone runtime QA, including the `edit_cover` deck-readiness path and a real or mocked hero video upload pass.
