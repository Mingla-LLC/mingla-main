# ORCHESTRATOR REVIEW — ORCH-0978 IMPLEMENT-7 [dedicated-trimmer full wiring]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Under review:** commits `56f681846` (product) + `1744305a5` (tests/gates) from implementor+codex
**Against:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0978_IMPLEMENT_7_FULL_WIRING.md`, SPEC AMENDMENT 9, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_7.md`

## VERDICT: APPROVED

Zero P0, zero P1. Routes to tester sim live-fire. Two conditions to satisfy before CLOSE (below).

## Commit-hash verification

| File | Commit | Verified |
|---|---|---|
| `mingla-business/src/components/ui/CoverPicker.tsx` | `56f681846` | ✅ trimmer wiring: `allowsEditing: false` + no `videoMaxDuration` (picker selection-only); `trimVideoWithDedicatedEditor` → `buildTrimmedVideoUploadFile`; acceptance check runs on the TRIMMED `uploadFile.durationMs` (line 514/519); cancel guard (`isNative && trimResult === null → return`, line 496); web fallback; `[ORCH-0978-POC]` removed |
| `mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts` | `56f681846` | ✅ new pure helper: `durationMs = endTime − startTime`, re-stats bytes, returns `{uri: outputPath, durationMs, trimStartMs:0, trimEndMs: trimmedDuration, mimeType "video/mp4"}`; throws on zero duration/bytes |
| `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | `56f681846` | ✅ `start` accepts optional `trimStartMs`/`trimEndMs`, forwards to upload-intent, additive/back-compatible |
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | `1744305a5` | ✅ C1 revised (trimmer receives cap; `videoMaxDuration` forbidden) + new C12 |
| `mingla-business/.../__tests__/CoverPicker.dedicatedTrimmer.test.ts` | `1744305a5` | ✅ T-AMEND9-01 (helper, non-first segment 4s→29s) + T-AMEND9-02 (cancel ordering) |
| `mingla-business/.../__tests__/useEventCoverVideoUpload.test.ts` | `1744305a5` | ✅ asserts trim bounds in upload-intent body |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_7.md` | (report commit) | ✅ |

No modified-but-uncommitted product files. All scoped to `mingla-business/` + the gate.

## Dependency walk (config-layer changes)

| Changed | Consumers checked | Compatibility |
|---|---|---|
| `orch-0978-video-cap-29s.mjs` C1 revised + C12 added | Runner = `strict-grep-mingla-business.yml` (same job/script). Ran locally: **C1-C12 all PASS**. | ✅ No workflow change needed |
| `CoverPicker.tsx` video path | Shared picker mounted in events (`EventCreatorWizard`, `CreatorStep4Cover`, `EditPublishedScreen`), trips (`TripCreatorWizard`, `EditPublishedTripScreen`, `TripCreatorStep1Basics`), brand (`BrandEditView`). Change is confined to the **video** flow (`pickVideoCover`); image/GIF paths untouched. | ✅ All cover surfaces gain reliable video trim; no image/GIF regression |
| `useEventCoverVideoUpload.ts` `start` signature | Additive optional `trimStartMs?`/`trimEndMs?`; only caller (CoverPicker) updated; omitted = prior default. | ✅ Backward-compatible |
| `coverPickerVideoTrimUpload.ts` (new) | Consumed by CoverPicker + its test. | ✅ |

## Spec compliance (SPEC AMENDMENT 9, Architecture B)

- **Architecture B honored:** `git diff 145275898..HEAD` shows **zero `supabase/` changes** — no edge, no migration, no Cloudinary `so_`. The trimmed local file IS the upload. ✅
- The exact PoC gap is closed: the flow now uses the trimmed `outputPath` + trimmed duration, and the acceptance ceiling check runs on the trimmed duration (so a normally-trimmed ≤29s clip passes instead of the old original-duration rejection). ✅
- Picker selection-only (no `allowsEditing: true`, no `videoMaxDuration`); cancel aborts before upload; web guarded to the existing fallback. ✅

## Independent verification

- `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` → **C1-C12 all OK** (re-run by reviewer).
- `npx jest CoverPicker.dedicatedTrimmer + CoverPicker.videoSourceCeiling + useEventCoverVideoUpload --runInBand` → **3 suites / 5 tests PASS** (re-run by reviewer).
- T-AMEND9-01 uses a non-first segment (start 4s, end 29s → expects trimEndMs 25000) — proves arbitrary-segment selection, not just first-29s.

## Constitution

| Rule | Result |
|---|---|
| #3 No silent failures | PASS — zero-duration/zero-bytes throw user toasts; cancel returns cleanly |
| #8 Subtract before adding | PASS — PoC scaffold log removed; `allowsEditing`/`videoMaxDuration` removed |
| #2 One owner per truth | PASS — hook owns upload lifecycle; CoverPicker owns cover state |
| Scope discipline | PASS — only `mingla-business/` + the gate; no other-app or backend touch |

## Findings

- **P2-01 (condition for CLOSE) — fails-on-revert not documented.** The two regression tests exist, pass, and attack different angles (T-AMEND9-01 behavioral helper / T-AMEND9-02 cancel-ordering), but the report doesn't cite the Step-0.5 `fails-on-revert verified at <hash>` probe. Tester/implementor must document PASS-on-fixed + FAIL-on-revert for both before CLOSE.
- **P3-02 — T-AMEND9-02 is a static source-inspection test**, not behavioral (it greps `CoverPicker.tsx` for the cancel→return→start ordering). Acceptable (verifies the guard ordering + that `[ORCH-0978-POC]` is gone), and the tester's live-fire covers behavioral cancel — but a behavioral cancel test would be stronger.
- **P3-03 — broad `tsc` is red (pre-existing, unrelated).** Per the dispatch hard guard, repo-wide TS debt (`home.tsx`, checkout, marketing editor, `@mingla/payments-native`, shared typings) fails the broad typecheck; no new errors attributed to the touched files, but they couldn't be isolated from the broad failure. Accepted; a scoped typecheck of the touched files at RETEST would close the gap.
- **P4 — praise:** extracting `buildTrimmedVideoUploadFile` into a pure helper makes the high-risk trim contract unit-testable. Good pattern.

## Conditions before CLOSE

1. **Tester sim live-fire** (the behavioral proof the implementor did not run): pick a >29s video → trim an arbitrary (non-first) segment → confirm it uploads (no "trim to 29 seconds" toast), reaches `ready`/`applied`, and the cover renders the CHOSEN segment, sub-30s.
2. **Document fails-on-revert** for T-AMEND9-01 + T-AMEND9-02 (Step 0.5 gate).

## Next steps

1. Route to tester sim live-fire (sim `F7ECAC25-…` + Metro `localhost:8090` already set up).
2. Physical-device validation remains gated on the separate OneSignal device-signing fix (Xcode automatic signing) — NOT a blocker for this REVIEW or the sim live-fire.
3. CLOSE = native build (no OTA), no migration, no edge redeploy; `[deploy]` tag only if a web-build input changed (CoverPicker is in the RN bundle — confirm at CLOSE).
