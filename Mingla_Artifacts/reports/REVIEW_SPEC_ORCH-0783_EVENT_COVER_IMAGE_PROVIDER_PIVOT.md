# Review: SPEC_ORCH-0783 Event Cover Image Provider Pivot

Date: 2026-05-11  
Reviewer: Codex `orchestrator-mingla`  
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`  
Reviewed artifact: `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`  
Verdict: APPROVED FOR CODEX `implementor-mingla`

## Plain-English Impact

The spec gives Mingla a safer launch path for event covers: stop asking organisers to use a fragile video workflow or a placeholder hue picker, and give them local image/GIF plus GIPHY/Pexels options instead. It protects existing published cover rendering, which matters because some historical rows can still contain video covers.

## Review Findings

### P2 Watchpoint - Publish RPC SQL Is Intentionally Abbreviated

The spec correctly identifies that `public.business_publish_event_draft` was last replaced in `20260515000009_orch_0769_app_wide_currency.sql`, but the SQL block does not paste the full function body. This is acceptable for review because the spec explicitly says the implementor must copy the latest body and make only ORCH-0783 additions.

Implementation guard: the implementor prompt must require reading the latest migration body before editing, preserving all ORCH-0769 currency behavior, and adding focused tests that provider metadata survives publish.

### No Blockers Found

The spec satisfies the ORCH-0783 hard guards:

- No implementation is included.
- No provider key values or secret files are referenced.
- No migration or function deletion is authorized.
- No Cloudinary/video rework is authorized.
- `coverHue` remains fallback/backcompat.
- Legacy video rendering remains in scope to preserve, not remove.
- Repo-running regression tests are mandatory in the same scoped commit/push.

## Approval Notes

Approved implementation scope is exactly the spec:

1. Add nullable event cover provider metadata.
2. Add Pexels Edge proxy and client adapter.
3. Add direct-client GIPHY adapter.
4. Refactor Step 4 to image/provider-only.
5. Preserve local image/GIF upload and legacy video rendering.
6. Add public attribution and parity rendering.
7. Rewrite ORCH-0770/0776 gates only where they currently force active Step 4 video UI.
8. Add `test:orch-0783` and the existing strict-grep workflow job.

## Explicit Non-Scope For Implementor

- Do not delete `event_cover_video_jobs`.
- Do not delete or undeploy `event-cover-video-*` functions.
- Do not drop `cover_media_type = 'video'`.
- Do not remove `EventCoverMedia` video support.
- Do not remove `coverHue`.
- Do not change brand cover/profile media.
- Do not expose Pexels as a client-side public key.
- Do not proxy/cache/copy GIPHY media through Supabase.
- Do not include provider key values in code, reports, logs, or chat.

## Next Handoff

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement ORCH-0783 in Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`. Inputs are approved spec `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, and orchestrator review `Mingla_Artifacts/reports/REVIEW_SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`; the saved implementation prompt is `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`. Hard guards: no provider key values/secrets, no migration/function deletion, no Cloudinary/video rework, keep `coverHue`, preserve legacy video rendering, do not broaden into brand media, and include repo-running regression tests in the same scoped commit/push. Expected output is `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, then route to Claude `mingla-forensics` TEST mode after orchestrator review.
