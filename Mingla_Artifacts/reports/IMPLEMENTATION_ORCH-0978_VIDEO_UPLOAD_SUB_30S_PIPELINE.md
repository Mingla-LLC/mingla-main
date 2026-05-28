# Implementation Report: Video Upload Polish + Sub-30s Cross-Surface Render (ORCH-0978)

> Date: 2026-05-26
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
> Status: implemented, partially verified

## 1. Layman Summary

Event cover video upload now uses one simple customer rule: pick or trim a video to 30 seconds, see an immediate local preview, upload the compressed version, and render the processed cover video across business/public surfaces without a black first frame. Cancel now aborts the in-flight browser upload and asks Cloudinary to destroy the raw source upload when possible, reducing orphaned media risk.

The code is implemented and covered by targeted unit/strict-grep/Deno checks. Final cross-platform confidence still needs tester-owned device/browser coverage for T-11 and T-12, plus an orchestrator-owned edge deploy for the touched functions.

## 2. Request And Context

- **Request:** Implement ORCH-0978 [Video upload polish + sub-30s perfect cross-surface render].
- **Source:** Approved ORCH-0978 spec with Amendments A1-A3, orchestrator review, and PoC compression runbook.
- **Affected surfaces:** Mingla Business cover picker, public event rendering package, Supabase event cover video edge pipeline, app-mobile native dependency graph.
- **Related issues/artifacts:** `REVIEW_ORCH-0978_SPEC_SUB_30S_PIPELINE.md`, `POC_ORCH-0978_COMPRESSION_RUNBOOK.md`, COMMS-0002, COMMS-0003, COMMS-0004.

## 3. Scope

- **In scope:** 30-second picker cap, local compression orchestration, optimistic preview, Cloudinary chunked upload for large web files, cancel abort + Cloudinary destroy, source public id persistence, 1500ms status polling, shared `EventCoverMedia` extraction, CI invariant gates, regression coverage.
- **Out of scope:** Deploying Supabase edge functions, running EAS builds, changing public/admin product behavior beyond shared rendering, adding database migrations.
- **Assumptions:** `source_public_id` already exists from prior PoC/dependency work; Cloudinary credentials already exist for edge functions; tester will run native/browser T-11/T-12 gates.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | COMMS-0002/0003/0004 were relevant WARN entries and were acknowledged. |
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Implementation contract | A1 collapsed to a single 30s cap; A2 requires zero-blocker probe/source public id cancel lookup; A3 replaces estimates with measured PoC latency. |
| `REVIEW_ORCH-0978_SPEC_SUB_30S_PIPELINE.md` | Orchestrator constraints | Preserve intent/webhook/cancel architecture and add, rather than replace, lifecycle behavior. |
| `POC_ORCH-0978_COMPRESSION_RUNBOOK.md` | Compression evidence | 389.15MB iPhone 4K HDR compressed to 5.98MB in 9.76s. |
| Existing cover picker/render/service/function files | Current behavior | Upload path had no local compression orchestration, no abort-aware cancel, and renderer lived inside business UI. |

## 5. Blast Radius

- **Direct changes:** Business cover picker flow, event cover video service, shared event rendering package, Supabase cover video functions.
- **Cascade changes:** Package exports, tsconfig path resolution, strict-grep workflow, app-mobile native dependency lockfile.
- **Parity surfaces:** Business upload/edit surfaces and public event rendering now share `EventCoverMedia`.
- **Cache impact:** New upload hook invalidates business event, event draft, public event detail, and upcoming-event keys after processed media is ready.
- **State boundaries:** Upload hook owns local preview/progress/stage/error/cancel state; persisted event cover state still updates through existing draft/published pathways.
- **Auth/RLS/security:** No RLS changes; edge functions keep existing auth/client behavior. Cloudinary destroy is best effort and signed server-side.
- **Deploy path:** Edge function redeploy required for any function importing changed `_shared/eventCoverVideo.ts`.

## 6. Old To New Receipts

### `mingla-business/src/components/ui/CoverPicker.tsx`

- **Before:** Image-first cover picker with no ORCH-0978 video upload orchestration.
- **After:** Adds video upload, 30s native trim/pick guard, optimistic local preview, stage/progress UI, cancel, and processed-video application.
- **Why:** Delivers the customer-visible upload polish and single 30s rule.
- **Approx lines changed:** 225.

### `mingla-business/src/hooks/useEventCoverVideoUpload.ts`

- **Before:** No dedicated hook existed.
- **After:** New hook coordinates compression, upload intent, direct/chunked upload, source acknowledgement, readiness polling, cache invalidation, and cancellation.
- **Why:** Keeps upload lifecycle state out of the picker and makes cancel/preview behavior testable.
- **Approx lines changed:** New file.

### `mingla-business/src/services/eventCoverVideoProcessingService.ts`

- **Before:** Direct upload used source files and readiness polling defaulted slower.
- **After:** Adds native compression via `react-native-compressor`, compressed file statting, abort-aware upload/cancel, web chunked upload for files over 50MB, 30s constants, 100MB source guard, and 1500ms polling.
- **Why:** Matches the PoC-backed sub-30s pipeline while preserving the existing intent/webhook/apply architecture.
- **Approx lines changed:** 232.

### `packages/event-rendering/EventCoverMedia.tsx`

- **Before:** Business renderer was embedded in `mingla-business`.
- **After:** Shared renderer supports `posterUri` and `onFirstFrameRender`, muted autoplay, user-gesture audio toggle, and native `useExoShutter={false}`.
- **Why:** Gives business/public surfaces one render contract and supports the first-frame-black guard.
- **Approx lines changed:** New file.

### `mingla-business/src/components/ui/EventCoverMedia.tsx`

- **Before:** Contained the full renderer implementation.
- **After:** Re-exports the shared package component and types.
- **Why:** Preserves existing imports while moving source of truth to `packages/event-rendering`.
- **Approx lines changed:** Replaced by shim.

### `packages/event-rendering/PublicEventPage.tsx`

- **Before:** Public page rendered image-only cover media behavior.
- **After:** Public event page renders video covers through shared `EventCoverMedia`.
- **Why:** Cross-surface parity for processed video covers.
- **Approx lines changed:** 17.

### `supabase/functions/_shared/eventCoverVideo.ts`

- **Before:** Shared constants/helpers did not include Cloudinary destroy or updated ORCH-0978 caps.
- **After:** Adds 30s processed cap, 60s/100MB source guards, signed Cloudinary destroy helper, and inline Cloudinary docs citations.
- **Why:** Implements cancel lifecycle cleanup and COMMS-0003 documentation guard.
- **Approx lines changed:** 54.

### `supabase/functions/event-cover-video-cancel/index.ts`

- **Before:** Cancel changed job state only.
- **After:** Cancel also resolves `source_public_id` and calls Cloudinary destroy best-effort after status update.
- **Why:** Reduces orphaned Cloudinary source uploads without blocking user cancel.
- **Approx lines changed:** 37.

### `supabase/functions/event-cover-video-upload-intent/index.ts`

- **Before:** Upload intent encoded trim in Cloudinary eager transformation and did not persist `source_public_id` directly.
- **After:** Eager transform no longer trims; intent writes `source_public_id` and cites Cloudinary signed upload parameters.
- **Why:** A1 moves trimming to native picker; A2 makes cancel lookup reliable.
- **Approx lines changed:** 21.

### `supabase/functions/event-cover-video-source-uploaded/index.ts`

- **Before:** Stored source asset id only.
- **After:** Stores `source_public_id` from the provider response when present.
- **Why:** Gives cancel/destroy a durable Cloudinary lookup key.
- **Approx lines changed:** 4.

### CI/test/dependency files

- **Before:** No ORCH-0978 draft invariant gates; app-mobile lacked `expo-video`; no compression happy-path test.
- **After:** Adds three strict-grep gates, wires workflow, updates package locks/tsconfig paths, and adds the compression happy-path regression.
- **Why:** Ships invariant enforcement in the same patch as backing code per COMMS-0002.
- **Approx lines changed:** 100+ across workflow, scripts, packages, and tests.

## 7. Implementation Details

- **Architecture decisions:** Preserved the existing upload-intent, source-uploaded, webhook, status, apply, and cancel pipeline. Added lifecycle behavior only where the spec allowed: compression before upload, Cloudinary chunked upload for large web files, destroy on cancel, and shared rendering extraction.
- **Data flow:** Picker selects/trims video -> hook creates local preview -> service compresses locally when native -> upload intent signs Cloudinary source upload -> service uploads compressed/source file -> edge source acknowledgement stores source identifiers -> status polling returns processed media -> picker applies processed cover.
- **Mutation/query behavior:** Upload completion invalidates event draft, business event, public event detail, and upcoming event query families.
- **State handling:** Hook exposes `stage`, `status`, `progress`, `localPreviewUri`, `processedUrl`, `error`, `cancel`, and `reset`.
- **Error handling:** Picker surfaces user-friendly upload errors; cancel aborts in-flight upload before edge cancel; Cloudinary destroy failure logs but does not fail cancel.
- **Copy/accessibility:** Customer copy now speaks in 30-second terms and keeps cancel/progress affordances visible.
- **Analytics/notifications/realtime:** No analytics or notification changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| A1 single 30s cap via native trim | `allowsEditing: true`, `videoMaxDuration: 30`, 30s constants/copy | Jest service tests; code review | PASS |
| Remove Cloudinary trim from eager chain | Upload intent no longer emits `so_`/`du_` trim params | Deno check; strict review | PASS |
| A2 source public id cancel lookup | Upload intent/source ack write `source_public_id`; cancel reads it first | Deno check | PASS |
| Cancel aborts upload | Hook/service abort controller and strict-grep gate | Strict-grep PASS | PASS |
| Cloudinary destroy on cancel | Signed `cloudinaryDestroy` helper and cancel integration | Deno check | PASS |
| Chunked upload >50MB | Web direct upload path branches to chunked PUTs | Code review; docs citation | PASS |
| Poll interval 1500ms | Default readiness poll interval reduced | Jest PASS | PASS |
| Shared EventCoverMedia extraction | Package component + business shim + public page use | Filtered typecheck no ORCH-0978 errors | PASS |
| First-frame-black guard props | `onFirstFrameRender`, `posterUri`, native shutter disabled | Strict-grep PASS; tester T-12 still needed | PARTIAL |
| T-11 cross-platform render | Code implemented | Tester device/browser coverage pending | PENDING |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| ORCH-0978 optimistic preview | Yes | Yes | CI strict-grep script added and passed. |
| ORCH-0978 cancel aborts upload | Yes | Yes | CI strict-grep script added and passed. |
| ORCH-0978 autoplay muted contract | Yes | Yes | CI strict-grep script added and passed. |
| I-COMMS-LEDGER-ENTRY-STANZA | Yes | Yes | Existing COMMS entries were acknowledged before implementation. |
| Backend allowlist discipline | Yes | Yes | ORCH-0863 strict-grep allowlist was extended for ORCH-0978 edge files. |

## 10. Parity Check

- **Mobile:** Picker uses native edit/trim, 30s cap, compression dependency, local preview, and native renderer props. Full EAS build required because native modules changed.
- **Business app:** Upload flow, compression orchestration, progress, cancel, and apply behavior implemented.
- **Admin:** No admin UI change.
- **Public/web:** Public event page renders video cover through shared event-rendering package.
- **Solo/collab:** No membership or collaboration logic change.
- **Gaps:** Tester must run T-11 cross-platform and T-12 first-frame-black checks on actual device/browser targets.

## 11. Cache And Persisted State Safety

- **Query keys changed:** Added event cover video query key module for upload job scoping.
- **Invalidations added:** Business events, event drafts, public event detail, and upcoming event keys invalidate after processed video readiness.
- **Data shape changes:** Existing event cover metadata shape is extended through service/hook usage; no migration was added.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Local in-flight preview is transient; persisted cover media still comes from existing event/draft records.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Compression happy-path regression | `npx jest __tests__/services/eventCoverVideoProcessingService.compression.test.ts --runInBand --no-cache` | PASS | Verifies 389MB source compresses to ~6MB mock output, uploads compressed URI/bytes, then applies processed URL. Reverting compression orchestration would fail this test. |
| Existing event cover service tests | `npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand --no-cache` | PASS | 13 tests updated for 30s copy/contract. |
| ORCH-0978 strict-grep gates | `node .github/scripts/strict-grep/orch-0978-video-upload-optimistic-preview.mjs && node .github/scripts/strict-grep/orch-0978-video-cancel-aborts-upload.mjs && node .github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | Includes the three draft invariant CI gates shipped with code. |
| Cancel function Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-cancel/index.ts` | PASS | Validates edge import/type surface. |
| Upload intent Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts` | PASS | Validates signed upload/source public id changes. |
| Source uploaded Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-source-uploaded/index.ts` | PASS | Validates source public id write. |
| Other importer Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-status/index.ts supabase/functions/event-cover-video-apply/index.ts` | PASS | Required because `_shared/eventCoverVideo.ts` changed. |
| Shared helper Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts` | PASS | 8 tests. Initial no-allow-env run failed as expected because tests read env. |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors. |
| Focused ORCH-0978 typecheck screen | `npx tsc --noEmit --pretty false 2>&1 | rg "eventCover|CoverPicker|EventCoverMedia|useEventCoverVideo|packages/event-rendering/EventCoverMedia|__tests__/services/eventCoverVideoProcessingService.compression"` | PASS | No ORCH-0978-specific TypeScript errors emitted after path updates. Full repo typecheck still fails on unrelated pre-existing errors. |
| Full repo typecheck | `npx tsc --noEmit` | BLOCKED | Existing unrelated failures remain in app home tabs, checkout buyer tests, ComposerV2, payments-native resolution, and older category test shapes. |

## 13. Regression Surface

1. Cover image picking, because `CoverPicker` now carries video state alongside image upload state.
2. Published/manual event cover edits, because video application must not auto-save in the wrong mode.
3. Trip cover pickers, because they reuse `CoverPicker` but explicitly keep video upload disabled.
4. Public event rendering, because it now consumes shared `EventCoverMedia`.
5. Supabase cover video functions, because `_shared/eventCoverVideo.ts` changed and importers need redeploy.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Native module changes | OTA alone will not deliver `expo-video`/compression native runtime changes | Full EAS build is run and installed | `app-mobile/package.json`, package lock |
| Edge deploy pending | Cancel destroy/source public id logic will not run in deployed env until functions are redeployed | Orchestrator deploys touched functions/importers | Supabase functions |
| T-11/T-12 pending | Actual device/browser render and first-frame-black behavior not manually proven | Tester runs mandatory cross-platform checks | Tester handoff |
| Full typecheck unrelated failures | Repo-wide typecheck cannot be used as a clean green gate yet | Existing unrelated TS errors are resolved separately | Multiple pre-existing files |

## 15. Discoveries For Orchestrator

- No new blocker was found requiring a new COMMS entry.
- The native module change should be called out at CLOSE: this cannot be fully shipped by OTA only.
- Edge deploy should include every function importing `_shared/eventCoverVideo.ts`, not only `event-cover-video-cancel`.

## 16. Deploy Notes

- **Migrations:** None added in this implementation. Assumes `source_public_id` already landed with Step 1 dependencies/PoC work.
- **Edge functions:** Redeploy `event-cover-video-cancel`, `event-cover-video-upload-intent`, `event-cover-video-source-uploaded`, `event-cover-video-webhook`, `event-cover-video-status`, and `event-cover-video-apply`.
- **Mobile OTA/native:** OTA can ship JS, but native dependency changes require a full EAS build for real device coverage and release.
- **Business/admin web:** Business web rebuild/deploy required for picker/service/rendering changes. Admin unchanged.
- **Env vars/secrets:** Existing Cloudinary env vars are reused: cloud name, API key, and API secret.

## Suggested Commit Message

```text
event-cover-video: polish upload and lifecycle

Resolves: ORCH-0978
Evidence: compression Jest regression, service Jest suite, ORCH-0978 strict-grep gates, Deno checks/tests, implementation report
Deploy: redeploy event cover video edge functions/importers; full EAS build required for native module changes
```

## Ready-To-Test Checklist

1. In Mingla Business event cover editing, pick a video longer than 30 seconds and confirm the native trim UI enforces the 30-second cap.
2. Pick a large iPhone-style video and confirm the local preview appears immediately while compression/upload/progress states advance.
3. Cancel during upload and confirm the UI returns to a clean state; inspect edge logs for best-effort Cloudinary destroy.
4. Let upload complete and confirm the processed cover video appears on business and public event surfaces without a black first frame.
5. Run tester T-11 cross-platform render and T-12 first-frame-black guard before CLOSE.
