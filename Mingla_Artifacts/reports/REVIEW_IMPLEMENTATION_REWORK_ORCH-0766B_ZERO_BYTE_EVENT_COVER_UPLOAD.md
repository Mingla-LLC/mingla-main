# Orchestrator Review: ORCH-0766B Zero-Byte Event Cover Upload Rework

> Date: 2026-05-09
> Reviewed artifact: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
> Verdict: APPROVED FOR TESTER RETEST, NOT CLOSED

## Plain-English Summary

The rework targets the proven failure cleanly. The prior runtime bug was that Mingla accepted a public image URL even though the object behind it was empty. The implementation now rejects empty local blobs before upload, rejects zero-byte public objects, and requires byte proof when Storage headers do not include usable content length.

This is the right next fix, but ORCH-0766B still cannot close until tester performs a fresh runtime upload and proves the new public object has non-zero bytes and renders instead of hue.

## Review Findings

### No Orchestrator Blocker Found

The implementation stayed inside the approved rework scope:

- `eventCoverMediaService.ts` now rejects `blob.size <= 0` before Supabase Storage upload.
- `eventCoverMediaRules.ts` now rejects `content-length: 0`.
- Missing content length falls back to bounded GET/range byte proof.
- Generic MIME values such as `application/octet-stream` are treated as absent when deriving upload content type.
- Regression tests now cover zero-byte local blob, zero-byte public URL, zero-byte fallback GET/range, non-empty byte proof, and generic MIME fallback.
- No migration, RLS change, provider expansion, MOV enablement, native dependency, Stripe, public-brand, or share-preview scope was added.

### Runtime Gate Still Required

Static tests prove the old zero-byte acceptance path is blocked in code. They do not prove real Expo ImagePicker assets now upload as non-empty blobs. Tester must still verify:

- a fresh image upload produces a non-zero Supabase object;
- the draft preview/Home card renders the uploaded image instead of hue;
- if the runtime still produces a zero-byte blob, the user sees a failure instead of false success;
- GIF and MP4 supported paths still work or fail honestly.

## Evidence Reviewed

- `Mingla_Artifacts/reports/RETEST_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
- Touched implementation files:
  - `mingla-business/src/utils/eventCoverMediaRules.ts`
  - `mingla-business/src/services/eventCoverMediaService.ts`
  - `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`
- Implementor-reported gates:
  - `npm run test:orch-0758a -- --runInBand` PASS, 6 suites / 45 tests
  - `npm run test:orch-0763 -- --runInBand` PASS, 7 suites / 53 tests
  - `npx tsc --noEmit` PASS
  - targeted ESLint PASS
  - `git diff --check` PASS

## Lifecycle Decision

Status moves from:

`TESTER FAIL -> IMPLEMENTOR REWORK`

to:

`REWORK IMPLEMENTED -> TESTER RUNTIME RETEST REQUIRED`

Next prompt:

`Mingla_Artifacts/prompts/TESTER_RETEST_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`

