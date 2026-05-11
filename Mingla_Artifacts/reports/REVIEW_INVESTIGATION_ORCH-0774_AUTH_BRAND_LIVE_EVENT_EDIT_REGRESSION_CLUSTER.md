# Review Investigation ORCH-0774 Auth, Brand, Live Event Edit Regression Cluster

Date: 2026-05-10  
Reviewed report: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md`

## Verdict

**APPROVED FOR SPEC, SPLIT TRACKS.**

The investigation is strong enough to promote. It proves a launch-blocking auth-readiness and brand-state trust failure, plus a separate server-loaded live-event edit save gap. It also correctly refuses to blame Cloudinary without a job row or edge response.

## Plain-English Decision

We should not go back to Giphy/Pexels or declare ORCH-0770 runtime-ready yet. First we need to make Mingla Business stop acting half-signed-in:

- do not create server drafts until auth is genuinely ready;
- do not hide brands while auth/query state is still resolving;
- do not start video upload-intent/status/apply without a real auth token;
- do not leave stale `Preparing secure video upload...` after an edge/provider failure.

The greyed Save button for server-loaded live events is real, but it is a different repair: the app does not yet have the server mutation for full published-event editing. That should be ORCH-0774B after the auth/video handoff layer is specified.

## Accepted Findings

| Finding | Orchestrator decision |
| --- | --- |
| Auth/session readiness is not a hard gate for server mutations | Accepted as top blocker. Promote to ORCH-0774A spec. |
| Brand list loading/disabled/error collapses to `[]` | Accepted. Must be fixed with auth-ready contract and Account/Home honesty. |
| Step 4 video can leave stale upload status after failed handoff | Accepted. Include auth-gated video handoff and failure-state UX in ORCH-0774A unless spec proves it must split. |
| Server-loaded live-event non-cover edits are disabled | Accepted as separate ORCH-0774B. Do not bundle into auth-ready fix unless the spec proves a tiny safe path. |
| Exact upload-intent HTTP response was not captured | Accepted limitation. Do not reopen ORCH-0770 provider architecture on this evidence alone. |

## Next Lifecycle Gate

Dispatch `$forensics` in SPEC mode with:

`Mingla_Artifacts/prompts/SPEC_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`

Expected output:

`Mingla_Artifacts/specs/SPEC_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`

## Scope Guard

No implementation yet. No Giphy/Pexels. No broad Cloudinary rewrite. No Stripe scope. No close of ORCH-0770 runtime readiness until ORCH-0774A is repaired or explicitly bounded.

