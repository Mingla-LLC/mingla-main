# REVIEW ORCH-0766B - Custom Event Cover Upload Runtime Failure

Date: 2026-05-09  
Reviewer: Orchestrator  
Reviewed artifact: `reports/INVESTIGATION_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_FAILURE.md`

## Verdict

APPROVED FOR SPEC-LEVEL FOLLOW-UP, NOT IMPLEMENTATION YET.

Plain-English impact: the event-cover upload feature is not ready for users. Videos can fail before they even reach storage, and images can appear to upload while the organiser still sees the old hue fallback. That makes the feature feel broken and would poison the next Giphy/Pexels/brand/profile expansion if we build on top of it.

## Evidence Quality

High for the video failure class.

- Code proves videos are rejected when `asset.duration` is missing.
- Code proves only MP4/WebM are accepted, while common native picker video outputs can differ.
- Existing tests currently encode the brittle old behavior instead of the desired runtime behavior.

Medium-high for the image failure class.

- Code proves `EventCoverMedia` silently falls back to hue on image/video render error.
- Operator runtime evidence matches that fallback behavior exactly.
- One runtime log is still required to distinguish "public URL cannot render" from "draft state/autosave wiped `coverMediaUrl` back to null."

## Orchestrator Decision

This should not go directly to `$implementor` as a broad media feature. The next step is a focused `$forensics` SPEC/reconfirmation pass that:

1. Converts the proven video bug into an implementation contract.
2. Requires the one missing runtime diagnostic for image upload/render.
3. Produces a bounded rework spec for event-cover upload only.
4. Keeps brand media, profile media, tickets, Giphy, and Pexels paused until the event-cover path is stable.

## Status

ORCH-0766B is now a Fix Now media reliability blocker under the richer custom Mingla upload track.

Next prompt: `prompts/SPEC_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`

