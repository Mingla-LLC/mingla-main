# Review: ORCH-0783 Event Cover Image Provider Pivot Rework

Date: 2026-05-11
Status: APPROVED FOR TEST
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`

## Verdict

APPROVED. The rework satisfies the prior implementation-review blockers: provider adapter behavior is now covered by repo-running tests, the Pexels Edge success/error path is covered by Deno tests, and the ORCH-0783 strict-grep gate now fails if the provider adapter test files are missing.

## Findings

No blocking findings.

## Evidence Reviewed

- Rework prompt: `Mingla_Artifacts/prompts/REWORK_IMPLEMENTOR_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Prior implementation review: `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Updated implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- GIPHY adapter test: `mingla-business/src/services/__tests__/giphyEventCoverService.test.ts`
- Pexels client adapter test: `mingla-business/src/services/__tests__/pexelsEventCoverService.test.ts`
- Pexels Edge test: `supabase/functions/event-cover-pexels-search/index.test.ts`
- ORCH-0783 structural guard: `.github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs`

## Rework Contract Check

| Requirement | Verdict | Evidence |
|---|---:|---|
| GIPHY adapter behavior tests | PASS | `giphyEventCoverService.test.ts` covers direct API URL, exact trimmed query, `rating=pg`, limit/offset clamping, selected URL fallback order, metadata normalization, missing key, rate-limit, provider-unavailable, invalid response, and short-query rejection. |
| Pexels client adapter behavior tests | PASS | `pexelsEventCoverService.test.ts` covers Supabase function invocation, trimmed query, page/perPage, short-query rejection, Edge error mapping, and invalid response shape. |
| Pexels Edge success/error tests | PASS | `index.test.ts` covers authenticated success proxying, server-side Authorization, `orientation=landscape`, clamped page/perPage, `src.landscape` normalization, rate-limit passthrough, missing key, and provider 429. |
| Strict-grep requires adapter tests | PASS | ORCH-0783 guard `requiredFiles` includes both provider adapter test files. |
| No provider secret exposure | PASS | Review scan found test placeholder strings only in tests; no provider key values in runtime code/artifacts. |
| No migration/function deletion | PASS | `git diff --name-only --diff-filter=D origin/main --` returned no deleted files. |
| Preserve `coverHue` | PASS | Existing stores/mappers/renderers keep `coverHue`; ORCH-0783 only hides the Step 4 hue picker. |
| Preserve legacy video rendering | PASS | `EventCoverMedia` video path and `PublicEventPage` unsafe-video fallback remain guarded; ORCH-0770/0776 gates pass. |

## Verification Run By Orchestrator

Passed:
- `cd mingla-business && npm run test:orch-0783` — 7 suites, 66 tests passed.
- `cd mingla-business && npm run test:orch-0770` — ORCH-0770 strict-grep passed; 3 suites, 26 tests passed; TypeScript in script passed.
- `cd mingla-business && npm run test:orch-0776` — ORCH-0776 strict-grep passed; 1 suite, 13 tests passed.
- `cd mingla-business && npm run tsc -- --noEmit` — passed.
- `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts` — 5 tests passed.
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-pexels-search/index.ts` — passed.
- `node .github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs` — passed.
- `git diff --check` — passed.

Non-evidence note: one initial `npm run test:orch-0783` command was accidentally launched from the worktree root and failed because the root has no `package.json`; the same gate was rerun from `mingla-business/` and passed.

## Residual Tester Scope

Claude `mingla-forensics` TEST mode should verify the full ORCH-0783 implementation, not only the rework tests. Priority manual/runtime areas remain iOS, Android, and Web parity for local image/GIF upload, GIPHY select, Pexels select, remove-cover fallback, no active Step 4 video/hue entry point, public attribution, checkout/order/card rendering, provider failure handling, and legacy video rows.

## Next Handoff

NEXT HANDOFF — paste into Claude `mingla-forensics` (TEST mode):

Test ORCH-0783 — event cover image provider pivot in Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`. Inputs are spec `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, spec review `Mingla_Artifacts/reports/REVIEW_SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, initial implementation review `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, rework prompt `Mingla_Artifacts/prompts/REWORK_IMPLEMENTOR_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, and rework approval `Mingla_Artifacts/reports/REVIEW_REWORK_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`. Run TEST mode with five-truth-layer cross-check; do not apply migrations, deploy functions, read or print provider secret values, weaken tests, delete migrations/functions, remove `coverHue`, or retire legacy video rendering. Write QA output at `Mingla_Artifacts/reports/QA_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` with PASS / CONDITIONAL PASS / FAIL, severity counts, verification commands, and manual parity evidence or explicit unverified gates. After PASS or accepted CONDITIONAL PASS, route to Codex `orchestrator-mingla` for CLOSE; after FAIL, route to Codex `implementor-mingla` for bounded rework.
