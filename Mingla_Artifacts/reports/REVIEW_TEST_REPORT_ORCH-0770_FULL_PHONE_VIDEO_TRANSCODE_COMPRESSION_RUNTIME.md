# REVIEW TEST REPORT ORCH-0770 — Full Phone Video Transcode + Compression Runtime Gate

## Verdict

ACCEPTED AS BLOCKED / UNVERIFIED FOR RUNTIME.

Plain-English impact: Mingla has fixed the Cloudinary callback bridge and the code now looks ready to attempt the real organiser journey, but we still have not proven the journey that matters to users: pick a phone video, process it, save/apply the processed MP4, and see it play on the public event page in a browser.

## Evidence Reviewed

- Tester report: `reports/TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`
- Implementation rework: `reports/IMPLEMENTATION_REWORK_ORCH-0770_CLOUDINARY_WEBHOOK_AND_SECRET_HARDENING.md`
- Orchestrator implementation review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0770_CLOUDINARY_WEBHOOK_AND_SECRET_HARDENING.md`
- Root cause register: `ROOT_CAUSE_REGISTER.md` entry `RC-0770`

## Accepted Findings

1. **Prior webhook blockers are resolved.**
   - Tester verified the remote webhook now returns function-level `403 missing_signature`, not Supabase gateway `401`.
   - Tester verified invalid signature and missing timestamp are rejected by function code.
   - Tester verified `verify_jwt=false`, timestamp-aware signature verification, deployed functions, configured secret names, and remote migration presence.

2. **Static gates pass.**
   - `npm run test:orch-0770` passed.
   - Jest media tests passed: 27/27.
   - Deno edge-function check passed.
   - Deno signature tests passed: 5/5.

3. **Runtime proof is still missing.**
   - No real phone video job row was captured.
   - No real Cloudinary callback/update was observed.
   - No public browser playback of a processed MP4 was verified.
   - No published-event replacement/save semantics were verified.

## Lifecycle Decision

Do not close ORCH-0770.

Move from generic tester prompt to **operator-assisted runtime QA**, because the remaining gate requires the signed-in business app/device, real picker assets, and public event URL observation.

## Next Dispatch

Use:

`prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`

Expected output:

`reports/RUNTIME_QA_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`

## Close Criteria

ORCH-0770 can only return to orchestrator close review after the runtime QA report includes:

- image/GIF control proof;
- short phone-video proof;
- long-video trim proof;
- `event_cover_video_jobs` row proof for at least one successful processed job;
- proof that the final public event cover URL is the processed MP4, not raw MOV/QuickTime;
- public browser playback proof: not black, loops, sound/mute reachable;
- published-event replacement proof: old cover remains until processed video is ready and `Save changes` is used.

