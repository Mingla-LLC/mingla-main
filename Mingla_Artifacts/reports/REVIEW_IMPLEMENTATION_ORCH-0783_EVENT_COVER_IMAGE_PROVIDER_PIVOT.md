# Review: ORCH-0783 Event Cover Image Provider Pivot Implementation

Date: 2026-05-11
Status: NEEDS WORK
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`

## Verdict

NEEDS WORK. The implementation is directionally in scope and preserves the key safety guards reviewed so far, but it does not satisfy the spec's regression-test contract for the new provider behavior. Do not route to Claude `mingla-forensics` TEST mode until the bounded rework below is complete.

## Findings

### P1 — New GIPHY/Pexels provider adapters lack behavior tests

Evidence:
- `mingla-business/src/services/giphyEventCoverService.ts:71` implements direct GIPHY search, query/rating parameters, response normalization, and error mapping.
- `mingla-business/src/services/pexelsEventCoverService.ts:38` implements the client call to `event-cover-pexels-search` and error mapping.
- `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md:391` requires `giphyEventCoverService.test`.
- `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md:393` requires Pexels Edge/service tests.
- `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md:413` says the ORCH-0783 strict-grep gate must fail if GIPHY/Pexels adapter files or tests are missing.
- Current `test:orch-0783` passes without any `giphyEventCoverService.test` or `pexelsEventCoverService.test`.

User impact:
Provider search is the core new launch behavior. Without adapter-level regression tests, a future change can silently break GIPHY query/rating/key handling, URL normalization, Pexels proxy invocation, or provider error mapping while the ORCH-0783 gate still passes.

Fix direction:
Add repo-running Jest tests for `giphyEventCoverService.ts` and `pexelsEventCoverService.ts`, register them in `mingla-business/package.json` `test:orch-0783`, and update `.github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs` so missing adapter tests fail.

### P1 — Pexels Edge Function success path is not regression-tested

Evidence:
- `supabase/functions/event-cover-pexels-search/index.ts:100` reads `PEXELS_API_KEY` server-side and `index.ts:126` sends it as the Pexels `Authorization` header.
- `supabase/functions/event-cover-pexels-search/index.test.ts:10` only tests request normalization/clamping.
- `supabase/functions/event-cover-pexels-search/index.test.ts:26` only tests missing auth rejection.
- `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md:393` requires proof that the Edge Function calls Pexels with server-side Authorization and `orientation=landscape`.
- `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md:400` requires missing-key/rate-limit provider failure coverage.

User impact:
The Pexels path may compile while failing its actual production contract: authenticated proxying, landscape-only provider request, normalized `src.landscape` output, and provider failure codes. This is exactly the class of launch risk ORCH-0783 was meant to retire from the active cover flow.

Fix direction:
Extend Deno tests for the success path with mocked auth/user lookup and mocked Pexels fetch, asserting Authorization stays server-side, query parameters include `orientation=landscape`, response normalization uses `src.landscape`, and rate-limit/missing-key responses keep the expected error codes without printing secret values.

## Safety Checks Passed

- Scope stayed focused on Mingla Business event cover provider pivot, related persistence, the new Pexels Edge Function, and strict-grep/test plumbing.
- `coverHue` remains in stores/mappers/renderers and Step 4 still passes it as fallback.
- Legacy video rendering remains present in `EventCoverMedia`, and public unsafe-video fallback remains in `PublicEventPage`.
- No deleted files were reported by `git diff --name-only --diff-filter=D origin/main --`.
- Provider key names are referenced only as configuration names; no provider key values were found in reviewed diffs/artifacts.
- Verified locally: `npm run --prefix mingla-business test:orch-0783 -- --runInBand`, `npm run --prefix mingla-business tsc -- --noEmit`, and `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts`.

## Required Rework

Use `Mingla_Artifacts/prompts/REWORK_IMPLEMENTOR_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`.

## Next Handoff

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Rework ORCH-0783 in Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`. Inputs are `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, and `Mingla_Artifacts/prompts/REWORK_IMPLEMENTOR_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`. Keep code changes bounded to regression coverage and strict-grep registration unless a test exposes a real provider-path bug; do not touch provider secret values, delete migrations/functions, remove `coverHue`, or alter legacy video rendering. Write the updated implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`; next route after rework returns is Codex `orchestrator-mingla` review, then Claude `mingla-forensics` TEST mode if approved.
