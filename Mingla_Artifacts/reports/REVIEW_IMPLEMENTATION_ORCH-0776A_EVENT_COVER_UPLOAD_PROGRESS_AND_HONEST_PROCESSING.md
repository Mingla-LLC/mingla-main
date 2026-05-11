# REVIEW IMPLEMENTATION ORCH-0776A — Event Cover Upload Progress and Honest Processing

Date: 2026-05-10
Reviewer: orchestrator
Verdict: APPROVED FOR TESTER VERIFICATION / NOT CLOSE-READY

## Plain-English Impact

The fix moves Mingla from a blind spinner to a more honest video-cover upload experience. Organisers should now see real progress while their phone video is being uploaded to Cloudinary. After the upload completes, Mingla should stop pretending it knows Cloudinary's internal compression percentage and instead show honest processing copy.

This is not closed yet. Runtime proof is required because the original pain happened on the real picker/upload/provider path.

## Evidence Reviewed

- Implementation report: `reports/IMPLEMENTATION_ORCH-0776A_EVENT_COVER_UPLOAD_PROGRESS_AND_HONEST_PROCESSING.md`
- Service change: `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- Step 4 UI change: `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- Regression tests: `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
- Strict guard: `.github/scripts/strict-grep/orch-0776a-video-upload-progress-honesty.mjs`
- Package gate: `mingla-business/package.json` script `test:orch-0776a`

## What Was Accepted

- `uploadEventCoverVideoSource` now emits real upload progress from bytes sent/expected.
- Step 4 renders `Uploading video... N%` plus an accessible progress bar while the source file is being uploaded.
- Step 4 switches to `Upload complete. Compressing browser-safe video...` after upload reaches 100%.
- The implementation avoids fake Cloudinary compression percentages.
- Provider upload failures keep Cloudinary's returned detail where possible.
- Regression coverage exists for upload progress and provider upload failure mapping.

## Verification Reported

Passed:

```bash
npm run test:orch-0776a
```

Passed:

```bash
npx tsc --noEmit
```

Passed:

```bash
git diff --check
```

## Remaining Risk

- Cloudinary does not expose granular eager-transformation progress, so the processing phase can only be represented as a named state, not a true percentage.
- The implementation is not proven on the real simulator/device picker path yet.
- The broader ORCH-0776/ORCH-0770 runtime journey remains open until a real video reaches processed status and renders as the public/browser-safe cover.

## Lifecycle Decision

Move to tester verification.

Next prompt:

`prompts/TESTER_ORCH-0776A_EVENT_COVER_UPLOAD_PROGRESS_AND_HONEST_PROCESSING.md`

Do not close ORCH-0776A, resume Giphy/Pexels, or broaden media work until tester returns PASS or the operator explicitly accepts residual runtime risk.

