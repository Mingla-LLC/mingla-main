# REVIEW ORCH-0766D - Event Cover Video Runtime Failure

> Date: 2026-05-09  
> Mode: Orchestrator Review  
> Reviewed input: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766D_EVENT_COVER_VIDEO_RUNTIME_FAILURE.md`  
> Verdict: NEEDS WORK - do not dispatch implementation for the video upload/render bug yet.

## Plain-English Decision

The latest forensic pass found something important, but it did **not** yet prove the actual video failure root cause.

What it proved is that the simulator was showing stale Step 4 code. The current source and Metro bundle say `MP4, MOV, or WebM`, but the screen under test still said `MP4/WebM`. That makes the operator's last video test invalid as proof against the current implementation.

It also proved the observed video attempt never reached saved draft state. The draft still had `coverMediaUrl: null` and `coverMediaType: null`, so there is no public URL to inspect and no event-cover renderer failure to prove yet.

## Review Findings

### S1 - Current Evidence Is Not Ready For A Media Rework

Classification: lifecycle blocker.

Evidence:

- `INVESTIGATION_ORCH-0766D_EVENT_COVER_VIDEO_RUNTIME_FAILURE.md` proves source/runtime drift.
- The live screen still displayed `MP4/WebM`, while source and Metro bundle contained `MP4, MOV, or WebM`.
- AsyncStorage retained `coverMediaUrl: null` / `coverMediaType: null`.

Impact:

- If we send this straight to implementation, the implementor will guess between duration metadata, validation, upload, public URL verification, state update, or video render.
- That is exactly the loop the operator is trying to escape.

Decision:

- No broad media rework yet.
- Run one clean, controlled runtime probe after the stale JS variable is removed.

### S2 - Observability Rework Is Proven But Should Be Bundled After The Boundary Probe

Classification: confirmed hardening gap.

Evidence:

- `EventCoverMedia` discards `expo-video` status/error payloads.
- The report proves `expo-video` exposes `payload.error`, but Mingla logs only a generic render failure.

Impact:

- If video reaches renderer and fails, current logs are too thin to diagnose.

Decision:

- If the next probe lands in renderer/display-failed territory, the rework prompt must require forwarding the `expo-video` error payload.
- If the next probe lands earlier, this still remains a small observability hardening item, but it is not the root fix.

## Required Next Prompt

Created:

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0766E_EVENT_COVER_VIDEO_CLEAN_RUNTIME_BOUNDARY_PROBE.md`

Expected output:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766E_EVENT_COVER_VIDEO_CLEAN_RUNTIME_BOUNDARY_PROBE.md`

The next probe must start only after Step 4 visibly shows current copy:

```text
MP4, MOV, or WebM
```

Then it must run one fresh 7.69-second seeded video attempt and capture the exact boundary:

```text
picker payload -> validation -> file bytes -> upload start -> upload verified -> draft state -> public URL -> renderer
```

## Scope Guard

Still paused:

- Giphy/Pexels.
- Brand media.
- Profile media.
- Ticket media.
- Another broad event-cover rewrite.

The base video path must pass the clean runtime boundary probe first.

