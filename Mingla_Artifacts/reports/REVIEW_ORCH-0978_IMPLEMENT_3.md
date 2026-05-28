# REVIEW ORCH-0978 IMPLEMENT-3

Verdict: **APPROVED**

Date: 2026-05-27
Reviewer: Claude `mingla-orchestrator` (Pass 1)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
Branch HEAD: `4d2896d3293fcc2767a4729d94f462cd709efa10`
Commits under review: `7728cddee204c5b1c3d8b25d1c9daf16ce0e2abc` (step 1), `4d2896d3293fcc2767a4729d94f462cd709efa10` (step 2)

Inputs reviewed:
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_3.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §SPEC AMENDMENT 5 (committed `7e347c5b5`)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_WEBHOOK_400.md` (committed `b26374dc5`)
- `Mingla_Artifacts/reports/QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` (committed `b85478a45`)
- `Mingla_Artifacts/reports/REVIEW_ORCH-0978_SPEC_AMENDMENT_5.md` (this orchestrator, untracked)

---

## 1. Executive Summary

IMPLEMENT-3 ships the SPEC AMENDMENT 5 webhook fix exactly as scoped: `recoverJobIdFromPayload` in `supabase/functions/event-cover-video-webhook/index.ts` parses the trailing UUID segment of Cloudinary's `public_id` whenever the eager callback omits the `context` field, while preserving the existing context-first precedence and signature verification. Five Deno scenarios pass, fails-on-revert proof is documented, strict-grep C5 enforces upload-intent template + webhook parser alignment, and the ORCH_0978_BACKEND_ALLOWLIST is extended in the same commit as the new backend file per COMMS-0002.

All hard guards from the dispatch hold: zero client/admin touches, zero SPEC edits, zero migrations, zero `supabase db push`, no PR opened by implementor, webhook `verify_jwt = false` preserved, two-commit landing pattern honored. The next step is orchestrator-owned: batch redeploy all six event-cover-video edge functions, then a `job_id_extraction_failed` curl probe on v121, then tester RETEST.

## 2. Commit-hash Verification

Per DEC-179, every claimed-changed file must have a commit on the per-ORCH branch.

| Claimed file | git log result | Verdict |
|---|---|---|
| `supabase/functions/event-cover-video-webhook/index.ts` | `7728cddee ORCH-0978 IMPLEMENT-3 step 1: recover webhook job id from Cloudinary public_id` | PASS |
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | `7728cddee ORCH-0978 IMPLEMENT-3 step 1...` | PASS |
| `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` | `4d2896d32 ORCH-0978 IMPLEMENT-3 step 2: cover webhook job-id recovery with Deno tests` | PASS |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `4d2896d32 ORCH-0978 IMPLEMENT-3 step 2...` | PASS |

`git diff --name-only 7728cddee~1 4d2896d3` returns exactly these four paths — no stray modifications, no uncommitted product code.

`git status --porcelain` on the worktree shows only pre-existing untracked artifacts (REVIEW/IMPLEMENTATION reports, tsconfig drift carried from prior phases, node_modules, Finder dupe `app-mobile/package 2.json`). None are part of IMPLEMENT-3 commits and all are scheduled for the CLOSE Step 1.6 sweep.

## 3. Dependency Walk (DEC-179)

Changed surfaces and downstream consumers:

| Changed file | Layer | Consumer impact | Compatibility |
|---|---|---|---|
| `event-cover-video-webhook/index.ts` | Edge function | Wraps prior top-level `serve(...)` in `handleEventCoverVideoWebhook(req, deps)`; preserves runtime via `if (import.meta.main) serve(...)`. The exported `recoverJobIdFromPayload` and `handleEventCoverVideoWebhook` are NEW exports — no existing import sites would break. | PASS |
| Webhook → `_shared/eventCoverVideo.ts` `isValidUuid` | Edge shared | Adds one import from `_shared`. `isValidUuid` already exported (verified at `_shared/eventCoverVideo.ts:106-108`). | PASS |
| `orch-0978-video-cap-29s.mjs` C5 | CI gate | New check reads two existing files (upload-intent + webhook) and asserts both contain expected pattern. Idempotent. | PASS |
| `orch-0863-marketing-hub-phase-b.mjs` `ORCH_0978_BACKEND_ALLOWLIST` | CI gate | Adds two paths to existing allowlist. `node ... orch-0863-...mjs` reports `C7: no-new-backend-files` green with 76 changed files. | PASS |
| `supabase/config.toml` `[functions.event-cover-video-webhook] verify_jwt = false` | Deploy config | NOT touched in this pass. Webhook deploy must use `--no-verify-jwt` or rely on config.toml. | PASS |

No `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**` files were touched. Two `.github/scripts/strict-grep/**` files were touched — both behave as additive checks and were verified green above.

## 4. Hard-Guard Compliance

| Guard | Result | Evidence |
|---|---|---|
| No client touches | PASS | `git diff --name-only 7728cddee~1 4d2896d3 -- 'app-mobile/**' 'mingla-business/src/**' 'mingla-admin/**'` empty |
| No SPEC edits | PASS | `git diff --name-only 7728cddee~1 4d2896d3 -- 'Mingla_Artifacts/specs/**'` empty; SPEC HEAD still `7e347c5b5` |
| No migration | PASS | `git diff --name-only 7728cddee~1 4d2896d3 -- 'supabase/migrations/**'` empty |
| No `supabase db push` | PASS | Implementor explicitly recorded as out-of-scope; no schema-impacting work |
| No PR opened by implementor | PASS | No PR opened against this branch by implementor; orchestrator owns PR at CLOSE |
| Webhook `verify_jwt = false` preserved | PASS | `supabase/config.toml` not touched; line 48-49 still `[functions.event-cover-video-webhook]\nverify_jwt = false` |
| Two-commit pattern | PASS | step 1 (product) `7728cddee` + step 2 (test) `4d2896d3` — META-ORCH-0744 contract honored |
| Backend allowlist landed with backend file | PASS | New `event-cover-video-webhook/__tests__/job-id-recovery.test.ts` allowlisted in same commit (`4d2896d3`) — COMMS-0002 contract honored |

## 5. SPEC AMENDMENT 5 Item-by-Item Verification

| Item | Required | Delivered | Verdict |
|---|---|---|---|
| Item 1: webhook public_id fallback | Add `recoverJobIdFromPayload` that tries context first, then last UUID segment of `payload.public_id`, both UUID-validated | Helper shipped verbatim at `event-cover-video-webhook/index.ts:32-42`; matches SPEC exactly | PASS |
| Item 2: failed-derivative path intact | Existing `processed_url_invalid` write path stays in place for invalid eager output | Verified in test scenario 2: `failure_code === "processed_url_invalid"` asserted on the existing path | PASS |
| Item 3: strict-grep C5 | New check enforces `event-covers/raw/${brandId}/${eventId}/${job.id}` template in upload-intent AND `recoverJobIdFromPayload`/`public_id.split` token in webhook | C5 shipped at `orch-0978-video-cap-29s.mjs:74-87`; runs green | PASS |
| Item 4: 5-scenario Deno test | Public_id fallback, context precedence, malformed public_id, missing identifiers, legacy pipe context | All 5 Deno.test cases shipped at `__tests__/job-id-recovery.test.ts`; 5/5 PASS | PASS |
| Item 5: historical cleanup probe | Re-probe stuck source_uploaded count; mutate only if scope requires | Re-probed; `stuck_count = 1` (the known tester job `dde19eac-...`). Not mutated — correctly left for tester/RETEST | PASS (no-op correctly chosen) |
| Item 6: deploy discipline | Implementor MUST NOT deploy; orchestrator batch-redeploys all six event-cover-video functions | Implementor did not deploy; report explicitly hands deploy back to orchestrator with version-bump expectations | PASS |
| Item 7: regression-test contract | Test must fail-on-revert | Fails-on-revert proof documented: PASS on fixed code → FAIL with public_id fallback replaced by `return null` → PASS after restore | PASS |

## 6. Verbatim Spot Checks

| Code site | Required text | Actual text | Verdict |
|---|---|---|---|
| `event-cover-video-webhook/index.ts:32-42` | `recoverJobIdFromPayload` with context-first precedence + UUID validation on both paths | Matches SPEC verbatim including `const lastSegment = publicId.split("/").at(-1) ?? null;` and `isValidUuid(lastSegment)` final return | PASS |
| `event-cover-video-webhook/index.ts:109-115` | `console.warn` with `stage: "job_id_extraction_failed"` before 400 return | Present with `publicId`, `hasContext`, `stage: "job_id_extraction_failed"` fields | PASS |
| `event-cover-video-webhook/index.ts:109` | Job-id derivation switched from `contextValue(payload, "job_id")` to `recoverJobIdFromPayload(payload)` | Line replaced exactly | PASS |
| `event-cover-video-upload-intent/index.ts:265` (template source) | Template `event-covers/raw/${brandId}/${eventId}/${job.id}` matches C5 regex | Untouched; C5 regex validates against this exact template | PASS |
| `supabase/config.toml:48` | `[functions.event-cover-video-webhook]\nverify_jwt = false` preserved | Unchanged | PASS |
| `_shared/eventCoverVideo.ts:106-108` | `isValidUuid` exported and importable | Import line at `event-cover-video-webhook/index.ts:6` resolves; Deno check PASS | PASS |

## 7. Automated Gates

| Gate | Command | Result |
|---|---|---|
| Deno typecheck | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` | PASS (exit 0) |
| Deno regression | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` | PASS (5 passed, 0 failed, 24ms) |
| Strict-grep ORCH-0978 | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS (C1-C5 all green) |
| Strict-grep ORCH-0863 | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS (C1-C7 green; 76 changed files in branch diff) |
| Whitespace | `git diff --check 7728cddee~1 4d2896d3` | PASS (no output) |

## 8. Refactor Observation (non-blocking)

The implementor extracted `serve(...)` into `handleEventCoverVideoWebhook(req, deps)` + `defaultDeps` so the Deno test can inject a Supabase stub and a signature-verification stub. Runtime behavior is preserved exactly via `if (import.meta.main) serve((req) => handleEventCoverVideoWebhook(req));` at the file tail. This is a legitimate test-seam refactor, not scope creep — without it the 5-scenario test would have to spin up real Supabase + real Cloudinary signature, which would defeat the regression contract. The dependency injection signature defaults to the real wiring, so the deployed function operates identically to v120 behavior except for the new `recoverJobIdFromPayload` call site and the new diagnostic warn.

## 9. Discoveries / Carry-overs

1. **F-5 re-probe result changed.** SPEC §"AMENDMENT 5" recorded `stuck_count = 0`. IMPLEMENT-3 re-probe returns `stuck_count = 1` — the single row is the tester live-fire job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`. Correctly left untouched (Item 5 cleanup was conditional). Orchestrator may cancel-or-supersede this job during RETEST so the tester picks up a clean slate.
2. **Tester live-fire happy path remains unproven for the webhook fix.** Deno scenarios prove the logic; only a fresh Cloudinary eager callback against deployed v121 can prove end-to-end recovery. Tester RETEST T-1 closes this.
3. **`event-cover-video-webhook/__tests__/` is a NEW directory.** First test file shipped under it. Future webhook regression tests should land here, not in `_shared/__tests__/`.
4. **CLOSE Step 1.6 worktree sweep** owns deletion/clarification of: `Mingla_Artifacts/reports/qa-orch-0978-runtime/live-fire-2026-05-27/`, all `IMPLEMENTATION_*.md` and `REVIEW_*.md` reports listed under untracked, pre-existing tsconfig drift, Finder dupe `app-mobile/package 2.json`. Not blocking REVIEW.

## 10. Verdict

**APPROVED.** All 8 hard guards pass, all 7 SPEC AMENDMENT 5 binding items satisfied, all 6 verbatim spot-checks match, all 5 automated gates green, commit-hash verification clean, dependency walk clean, two-commit pattern + backend allowlist + verify_jwt preservation honored.

## 11. Next Steps (orchestrator-owned, awaiting Seth's go)

1. **Batch redeploy all six event-cover-video functions** preserving each function's `verify_jwt` setting per `feedback_orchestrator_deploys_edge_functions.md`:
   - `upload-intent` v95 → v96 (`verify_jwt = true`)
   - `source-uploaded` v81 → v82 (`verify_jwt = true`)
   - `status` v93 → v94 (`verify_jwt = true`)
   - `apply` v91 → v92 (`verify_jwt = true`)
   - `cancel` v91 → v92 (`verify_jwt = true`)
   - `webhook` v120 → v121 (`verify_jwt = false`)
2. **Verify-first-call curl** on webhook v121 with valid HMAC + missing context + missing public_id; confirm 400 response body `{"error":"validation_error","detail":"job_id_missing"}` AND Supabase dashboard log shows `stage: "job_id_extraction_failed"` per `feedback_supabase_edge_deploy_verify_first_call.md`.
3. **Route to tester** for RETEST T-1 through T-5 plus Seth's physical iPhone plus one adversarial test (SPEC §D Item 7 suggestions).
4. **CLOSE** (post-tester PASS): `[deploy]` tag, EAS OTA iOS+Android (IMPLEMENT-2 client touched `mingla-business/src/`), PR open + pre-merge gate + squash merge + worktree reap + worktree sweep + add the F-6 batch-redeploy memory rule.
