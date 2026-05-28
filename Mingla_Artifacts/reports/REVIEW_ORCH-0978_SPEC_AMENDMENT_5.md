# ORCHESTRATOR REVIEW — ORCH-0978 SPEC AMENDMENT 5 (event-cover-video-webhook public_id fallback)

**Reviewer:** Claude `mingla-orchestrator`
**Artifact:** `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §"SPEC AMENDMENT 5" (lines 1106-1399, 294 insertions) at commit `7e347c5b5` by Claude `mingla-forensics` (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-27
**Companion artifacts:** Investigation `INVESTIGATION_ORCH-0978_WEBHOOK_400.md` (commit `b26374dc5`), tester FAIL `QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` (commit `b85478a45`).

---

## Verdict — APPROVED

All 11 checklist items PASS. All 6 spot-checked file/line references match actual source verbatim. Dependency walk for the prescribed CI config touches surfaces no consumer conflicts. Scope is correctly bounded to the webhook fix only — IMPLEMENT-2's auth/picker/local-preview work is explicitly preserved. Item 5 (historical cleanup) correctly grounded in the F-5 probe result. Item 6 (batch redeploy ALL six event-cover-video functions) correctly clears IMPLEMENT-2's partial-deploy technical debt + ships the webhook fix in one batch. No new migration required.

Two minor observations (non-blocking, both 🔵 not 🔴/🟠):
1. **Import consolidation nit (P3):** Item 1 pseudocode shows `isValidUuid` as a separate `import` statement. The webhook already imports from `../_shared/eventCoverVideo.ts` at lines 2-9. Implementor should add `isValidUuid` to the EXISTING import line rather than introducing a redundant import statement. Not blocking — implementor will likely do this naturally.
2. **Hardening side-effect worth crediting (P4):** the NEW `recoverJobIdFromPayload` validates that the context-extracted value is a valid UUID before accepting it (via `isValidUuid(fromContext) ? fromContext : null`). The OLD line-89 path did NOT validate — it trusted whatever `contextValue` returned and passed it to the DB query, which would have returned "not found" → HTTP 500 if Cloudinary ever sent a malformed job_id string in context. The new helper handles this gracefully with a clean 400. Defensive coding bonus, worth noting in the implementation report.

---

## Commit-hash verification (DEC-179 / ORCH-0959)

| Claimed artifact | git show status | Verdict |
|---|---|---|
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` AMENDMENT 5 append | committed at `7e347c5b5` — 1 file changed, 294 insertions(+) | **PASS** |

Gate **PASSES**. The SPEC commit contains exactly the expected change scope (one SPEC file modified, no other files touched).

**Untracked worktree noise (flagged but NOT in scope of this REVIEW):** `git status --short` continues to show pre-existing artifacts from prior sessions — modified `tsconfig.json` files, leftover IMPLEMENTATION and REVIEW reports from IMPLEMENT-2 phase, node_modules symlinks, Finder duplicates, the new `qa-orch-0978-runtime/live-fire-2026-05-27/` evidence folder from the tester. These are NOT part of this SPEC commit and will be addressed at CLOSE Step 1.6 worktree sweep per `feedback_orchestrator_cleans_worktree_on_close.md`. The REVIEW reports specifically (`REVIEW_ORCH-0978_IMPLEMENT_2.md`, `REVIEW_ORCH-0978_INVESTIGATION_SAVE_BUTTON_GREYED.md`, `REVIEW_ORCH-0978_SPEC_AMENDMENT_4.md`) should be committed before CLOSE for the audit trail — this is normal closing housekeeping, not a blocker for this REVIEW.

---

## Dependency walk (DEC-179 / ORCH-0959)

The SPEC modifies ONE file (the spec markdown itself). It PRESCRIBES future changes to:

### `supabase/functions/event-cover-video-webhook/index.ts` (Item 1 + console.warn)
**No config-layer impact.** Backend edge function source, no consumer-side dependencies. The webhook imports already include 6 symbols from `_shared/eventCoverVideo.ts` (lines 2-9); adding `isValidUuid` to that import list is a 1-token addition with no breaking impact. The function's exported behavior at the request boundary is unchanged for valid inputs (200 path stays identical) and improved for the previously-failing eager-without-context input (400 → 200). **PASS.**

### `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` (Item 3 — extending with C5)
Per DEC-179, `.github/scripts/strict-grep/**` triggers dependency walk. Current file (74 lines, contains C1-C4 from AMENDMENT 4) is invoked by ONE job in `.github/workflows/strict-grep-mingla-business.yml`. Adding C5 inside the same script does NOT change the invocation point — just adds one more check inside the existing script body. No workflow file changes prescribed in this amendment (vs AMENDMENT 4 which added a new job — that's already in place). **PASS — no parallel workflow file created, matches `feedback_strict_grep_registry_pattern.md`.**

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (Item 7 — extending ORCH_0978_BACKEND_ALLOWLIST)
Per DEC-179, allowlist additions trigger walk. Current baseline confirmed: array has 7 entries — `_shared/eventCoverVideo.{ts,test.ts}`, `event-cover-video-{cancel,source-uploaded,upload-intent}/index.ts`, `event-cover-video-upload-intent/__tests__/duration-cap.test.ts`, the AMENDMENT 4 migration. Implementor must APPEND in IMPLEMENT-3 step 2:
- `supabase/functions/event-cover-video-webhook/index.ts` ← **NOT currently in allowlist** (webhook source wasn't touched by IMPLEMENT-2). IMPLEMENT-3 WILL touch it (Item 1), so this addition is REQUIRED to avoid C7 `no-new-backend-files` failure on the PR.
- `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` ← NEW test file (Item 4)

The SPEC §G correctly says "append test path + webhook source path (if missing) — check before adding to avoid dup". Implementor will need to verify the webhook source isn't already there (it isn't) before adding. **PASS — SPEC instruction is correct; implementor mechanical action is well-specified.**

### NEW test file `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts`
**Confirmed ABSENT** on disk — path is truly new. No collision with existing tests. Item 4 creates it. **PASS.**

### Edge function deploy scope (Item 6 — batch redeploy 6 functions)
All 6 function source paths confirmed present on disk: `event-cover-video-{upload-intent, source-uploaded, status, apply, cancel, webhook}/index.ts`. Current deployed versions per `mcp__supabase__list_edge_functions` (snapshot from this session's IMPLEMENT-2 deploy): upload-intent v95, source-uploaded v81, status v93, apply v91, cancel v91, webhook v120. Post-IMPLEMENT-3 expected: v96, v82, v94, v92, v92, v121 (counters all +1). `verify_jwt` settings confirmed (5 true + 1 false for webhook), Supabase CLI preserves these on `functions deploy` per `feedback_orchestrator_deploys_edge_functions.md`. **PASS.**

### No schema/migration changes
SPEC §H explicitly states "No new migration required." Schema is unchanged. `event_cover_video_jobs.failure_code` is free-text (verified during prior investigations — no enum constraint). **PASS.**

---

## Spot-check verification of SPEC quotes against actual source

Read the actual source against the SPEC's prescriptions:

| SPEC quote | Actual source | Result |
|---|---|---|
| `event-cover-video-webhook/index.ts:11-29 — contextValue helper looks at context.custom.<key> OR pipe-delimited string OR direct payload[<key>]` | Verbatim match — lines 11-29 read exactly as SPEC describes | **CONFIRMED** |
| `event-cover-video-webhook/index.ts:89-92 — current jobId extraction call site, returns 400 job_id_missing on null` | Verbatim match — lines 89-92 are exactly `const jobId = contextValue(payload, "job_id"); if (jobId === null) { return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400); }` | **CONFIRMED** |
| `_shared/eventCoverVideo.ts:106-108 — isValidUuid export` | Verbatim match — `export function isValidUuid(input: unknown): input is string { return typeof input === "string" && UUID_REGEX.test(input); }` | **CONFIRMED** |
| Existing console.log convention `[event-cover-video-webhook] JSON.stringify({stage, ...})` at line 64 | Verbatim match — Item 1's new `console.warn` follows the same `[event-cover-video-webhook] JSON.stringify({...})` pattern, preserving log-grep discoverability | **CONFIRMED** |
| Strict-grep `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` exists with C1-C4 | 74 lines confirmed; extends cleanly with C5 (5th check) | **CONFIRMED** |
| `ORCH_0978_BACKEND_ALLOWLIST` baseline has 7 entries; webhook source NOT yet allowlisted | Verbatim match — confirmed the webhook source is missing from the array, so IMPLEMENT-3 MUST append it (matches SPEC §G "append... if missing") | **CONFIRMED** |
| Six event-cover-video function sources all present on disk | 6/6 OK | **CONFIRMED** |
| Test path `__tests__/job-id-recovery.test.ts` is NEW (doesn't exist yet) | `__tests__/` directory absent for webhook function — path truly new | **CONFIRMED** |

**Eight quotes, eight matches.** No invented evidence. The SPEC's Phase 0 was rigorous.

---

## REVIEW checklist (11 of 11 PASS)

- [x] **Root cause proven or just plausible?** Investigation classified PROBABLE (not proven) — explicitly acknowledged in SPEC §L Confidence section. The fix shape (Option A public_id parsing) is correct regardless of which 400 path actually fires, so the probable→proven gap doesn't affect implementability. **PASS.**
- [x] **Scope appropriate — could be narrower?** Bound to webhook fix only. IMPLEMENT-2's work is explicitly preserved. Item 5 N/A per probe (avoiding unneeded cleanup migration). Item 6 batch redeploy clears separate technical debt that would block clean future deploys. Couldn't be narrower without leaving Item 6's discipline gap unaddressed. **PASS.**
- [x] **Hidden fallback paths that mask failure?** The new helper EXPLICITLY logs (`console.warn` with `stage: job_id_extraction_failed`) when both paths fail. Item 2 hidden flaw from investigation was traced and confirmed already covered by existing `assertProcessedDerivative` failed path. **PASS — no silent failures introduced.**
- [x] **Stale cache paths serving old data?** N/A — backend webhook fix, no client cache layer.
- [x] **Response shape truthful in ALL states?** Webhook returns 200 success on valid happy path, 400 with `{error: "validation_error", detail: "job_id_missing"}` on extraction failure (preserving existing client contract), 403 on signature failures (unchanged), 500 on internal errors (unchanged). The new console.warn is server-side observability, not part of the response shape. **PASS.**
- [x] **Real fix or symptom mask?** Real fix — addresses the root cause (Cloudinary contract mismatch on `context` field absence in eager_async notifications) by leveraging the field Cloudinary DOES include (`public_id`). Defense-in-depth, not band-aid. **PASS.**
- [x] **Solo/collab parity?** N/A — event cover authoring is single-user (event manager).
- [x] **Constitutional compliance?** §E notes one tradeoff — the `recoverJobIdFromPayload` introduces a soft contract between upload-intent's public_id template and the webhook parser ("one owner per truth" #2 risk). The new strict-grep C5 (§D Item 3) + new invariant `I-PROPOSED-EVENT-COVER-VIDEO-PUBLIC-ID-LAST-SEGMENT-IS-JOB-UUID` (§E) close this risk at CI. **PASS — constitutional rule preserved by enforcement gate.**
- [x] **Evidence chain complete?** Investigation cited, tester FAIL cited, F-5 probe result cited, Cloudinary docs URLs cited inline per COMMS-0003. **PASS.**
- [x] **Documents updated?** SPEC append correctly modifies the existing SPEC file (not a new file). AMENDMENT 5 numbering correct (continuing AMENDMENT 4's pattern). **PASS.**
- [x] **Commit-hash verification?** **PASS** (commit `7e347c5b5`, single file, 294 insertions). Specified above.
- [x] **Dependency walk?** **EXECUTED** — webhook source, two strict-grep scripts, NEW test path, 6-function deploy scope, no migration, all 7 prescribed changes assessed. **PASS.**

12 of 12 (the implicit count is 12; "11 of 11" is the standard checklist; both gates pass).

---

## Two strengths to call out

1. **F-5 probe was actually run BEFORE locking the SPEC.** The forensics SPEC mode didn't just leave Item 5 as "TBD — operator probe needed" — it ran the probe (`stuck_count = 0`) and locked Item 5 as N/A in the SPEC itself. This means IMPLEMENT-3 has zero ambiguity about cleanup scope. Compare to a hypothetical SPEC that said "implementor decides cleanup" — that would have pushed the probe to IMPLEMENT-3 and risked a wasted implementor cycle if cleanup turned out to be needed (or wasn't needed but implementor wrote cleanup code anyway). The probe-first discipline is exactly right.

2. **Item 6 (batch redeploy 6 functions) addresses a separate technical-debt gap, not just the immediate webhook fix.** IMPLEMENT-2 only deployed `event-cover-video-upload-intent` v95 even though `_shared/eventCoverVideo.ts` was modified (89 lines added for the auth diagnostic). That left the other 5 functions running on the OLDER shared bundle. The audit risk: if a future investigation needs to reason about "what version of `_shared/eventCoverVideo.ts` is each function actually running?", the answer would be inconsistent across the 6 functions. Item 6 unifies them all at the latest bundle in one batch. Plus it ships the actual fix as v121 in the same wave. Smart bundling.

---

## One minor improvement opportunity (non-blocking)

The SPEC §D Item 1 pseudocode introduces `recoverJobIdFromPayload` as a separate exported helper. Worth a small consideration: since it's only called from one site (line 89 in the webhook), it could equivalently be inlined. Separating it as a helper is BETTER for testability (the Item 4 Deno test can import + test the helper directly without spinning up the full webhook handler) — but the SPEC could be more explicit about WHERE the helper lives (top of `event-cover-video-webhook/index.ts` as a file-private `const recoverJobIdFromPayload = ...`, OR exported from `_shared/eventCoverVideo.ts`). Implementor's choice. Pre-emptive recommendation: keep it file-private at the top of the webhook (lines 30-50 region, between `contextValue` at lines 11-29 and `verifyWebhook` at lines 31-50) for locality — testability is preserved via Deno's module imports of file-private functions if they're exported, OR via testing the whole webhook handler (which Item 4 already does via 5 scenarios).

Not a blocker. Just orchestrator's two-cents on file structure that the SPEC doesn't dictate.

---

## Approval and routing

**REVIEW VERDICT: APPROVED** — SPEC AMENDMENT 5 is implementable as-shipped. All 12 gates pass. Two minor observations (import consolidation P3 + UUID-validation hardening P4) are flagged for implementor awareness but don't block.

**Downstream sequence:**

1. **Codex `implementor-mingla` IMPLEMENT-3** — two commits per §J:
   - Commit 1: webhook helper + strict-grep C5 (Item 1 + Item 3) — `~50 net lines across 2 files`
   - Commit 2: Deno regression test + ORCH_0978_BACKEND_ALLOWLIST update (Items 4 + 7) — `~150 net lines across 2 files (new test + allowlist append)`
   - Then implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_3.md` covering both commit hashes + fails-on-revert PASS/FAIL/PASS sequence + zero-touch verification of the 5 untouched event-cover-video functions + F-5 re-probe count + optional dde19eac cleanup decision.

2. **Orchestrator REVIEW of IMPLEMENT-3** — same commit-hash + dependency-walk gates.

3. **Orchestrator batch redeploy** ALL six event-cover-video functions per Item 6. Verify via `mcp__supabase__list_edge_functions` that all six version-bumped, `verify_jwt` settings preserved (webhook stays false, 5 others stay true). One curl probe per `feedback_supabase_edge_deploy_verify_first_call.md` to webhook v121 to confirm the new `job_id_extraction_failed` diagnostic log fires when expected.

4. **Tester (Claude `mingla-forensics` TEST mode or Codex `tester-mingla`) RETEST** — full T-1 through T-5 sweep + Seth's physical iPhone + ONE adversarial regression test (suggestions in SPEC §D Item 7 — duplicate webhook idempotency / stale signature / trailing slash / context-vs-public-id precedence). This time T-1 should reach `processed_url` populated AND Save enabling for the first time end-to-end in ORCH-0978's history.

5. **Orchestrator CLOSE** with `[deploy]` tag (touches `mingla-business/src/` from IMPLEMENT-2 + backend from IMPLEMENT-3 — Vercel gate applies). EAS OTA publish iOS+Android. PR open + pre-merge gate + squash merge + worktree reap. CLOSE Step 1.6 worktree sweep handles the prior-session noise.
