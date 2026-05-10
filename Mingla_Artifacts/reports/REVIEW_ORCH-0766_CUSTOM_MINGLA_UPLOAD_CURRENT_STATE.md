# Review: ORCH-0766 Custom Mingla Upload Current State

Date: 2026-05-09  
Skill: `$orchestrator`  
Reviewed artifact: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766_CUSTOM_MINGLA_UPLOAD_CURRENT_STATE.md`  
Verdict: APPROVED FOR RUNTIME TESTER DISPATCH

## Plain-English Impact

We can reopen custom Mingla upload work, but only the event-cover slice is ready for runtime verification.

The app now has code and deployed storage for organisers to upload event cover images, GIFs, and short videos. The earlier event-source blocker has materially improved because ORCH-0763 publish/read migrations are applied remotely and focused event tests pass. That means event covers can move from "paused behind architecture repair" to "prove it on device."

Brand cover upload, brand photo upload, ticket-tier media, and Giphy/Pexels are not ready to implement from this artifact alone. They need a separate spec after the event-cover runtime proof and profile/avatar storage proof are handled.

## Review Decision

Approved next gate: `$tester` runtime QA for custom event cover upload.

Prompt written:

`Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0766A_CUSTOM_EVENT_COVER_UPLOAD.md`

Required output:

`Mingla_Artifacts/reports/RUNTIME_ORCH-0766A_CUSTOM_EVENT_COVER_UPLOAD.md`

## Evidence Accepted

Accepted from forensics:

- Event cover upload is implemented in `CreatorStep4Cover`.
- Event media upload service writes to Supabase Storage bucket `event_covers`.
- Event cover rules validate image/GIF/video types, 30 MB max, and 15 second video duration.
- Event media renders through `EventCoverMedia`, with video handled by `expo-video`.
- `20260515000002_orch_0758a_event_cover_storage.sql` is applied remotely.
- ORCH-0763 publish/read repair migrations are applied remotely through `20260515000007`.
- `npm run test:orch-0758a` passed 6 suites / 35 tests.
- `npm run test:orch-0763` passed 7 suites / 47 tests.

## Accepted Limits

Runtime evidence is still missing:

- Real device/simulator upload to Storage.
- Storage RLS behavior for a real authenticated event manager.
- GIF/video playback on native build.
- Reduced-motion video behavior.
- Publish preservation from draft upload through public event/checkout/order/list surfaces.

These are tester gates, not implementor gates, unless tester finds a product-code failure.

## Non-Goals For This Tester Pass

Do not test as in-scope:

- Brand cover upload.
- Brand photo upload.
- Business profile avatar storage migration.
- Ticket-tier media.
- Giphy/Pexels provider search.
- Admin moderation tooling.

These remain follow-on tracks.

## Next Recommendation

Dispatch `$tester` with:

`Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0766A_CUSTOM_EVENT_COVER_UPLOAD.md`

If tester passes, orchestrator can then write a `$forensics` SPEC prompt for the next custom upload expansion slice:

1. profile avatar bucket proof/migration,
2. brand cover and brand photo upload,
3. then Giphy/Pexels provider picker.
