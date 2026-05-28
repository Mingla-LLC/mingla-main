# ORCHESTRATOR REVIEW — ORCH-0978 INVESTIGATION (Save button greyed out after video pick)

**Reviewer:** Claude `mingla-orchestrator`
**Artifact reviewed:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED.md` (377 lines, by Codex `mingla-forensics`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-27
**Companion REVIEW:** `REVIEW_ORCH-0978_INVESTIGATION_TRIM_UX_GAP.md` (APPROVED at commit `1f39b63af` 2026-05-27)

---

## Verdict — APPROVED

**Verdict tier:** APPROVED (2026-05-27, flipped from NEEDS WORK after artifact commit landed at `23fb1d877`).

**Procedural gate cleared.** Codex `mingla-forensics` committed both deliverables on the ORCH-0978 branch at commit `23fb1d877` with subject "Investigate ORCH-0978 save-button greyed iOS Maestro live-fire — 9 findings + DB 15s constraint blocker for 29s cap". `git show --stat 23fb1d877` confirms exactly 8 files (the investigation report + 7 PNG screenshots, 378 lines + binary assets), no unrelated files folded in. DEC-179 / ORCH-0959 commit-hash verification gate **PASSES**.

The investigation's substantive findings are SOUND. All 6 verbatim code quotes spot-checked against actual source pass verification. The 5-truth-layer matrix is complete and contradictions are correctly identified. Live-fire Maestro evidence is real (7 screenshots + Metro instrumentation log + DB probes via Supabase Management API). External provider docs cited inline per COMMS-0003.

---

## Commit-hash verification (DEC-179 / ORCH-0959)

| Claimed artifact | git log status | Verdict |
|---|---|---|
| `INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED.md` | committed at `23fb1d877` (378 lines) | **PASS** |
| `qa-orch-0978-runtime/save-button-greyed/` (7 screenshots) | committed at `23fb1d877` (7 PNGs, 3.1 MB) | **PASS** |

Additional untracked / uncommitted noise found in worktree (NOT in scope of this review but flagged for awareness):
- `M app-mobile/tsconfig.json` + `M mingla-business/tsconfig.json` — orchestrator's prior debugging fix from earlier session (removed bad `react` alias). Should be folded into IMPLEMENT-2 commit or its own cleanup commit before merge.
- `?? Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_2_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` — Codex implementor rework-2 report.
- `?? Mingla_Artifacts/reports/qa-orch-0978-runtime/2026-05-27_rework2_device_probe/` — orchestrator rework-2 device-probe artifacts.
- `?? app-mobile/package 2.json` — Finder duplicate, delete before CLOSE per `feedback_orchestrator_cleans_worktree_on_close.md`.

Gate **PASSES** for companion trim investigation (already committed at `38b195dd0`). Gate **FAILS** for this investigation pending commit.

---

## Dependency walk (DEC-179 / ORCH-0959)

**N/A.** This is an INVESTIGATE phase. Zero product code mutated. The investigation report claims that temporary instrumentation was added locally and removed before report finalization (§2 "Temporary instrumentation was added locally to prove state, then removed before this report. It logged only the cover-video hook and picker state"). `git diff` against `mingla-business/src/` confirms no source-code drift outside the prior-session tsconfig edits.

No `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json` (other than orchestrator's prior fix), `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, or `.github/scripts/**` touched by this investigation. Dependency walk N/A.

---

## Spot-check verification of load-bearing code claims

Read the actual source against the forensics quotes:

| Forensics claim | Spot-check | Result |
|---|---|---|
| `CoverPicker.tsx:241-248` — `activeMediaUrl = videoUpload.localPreviewUri ?? videoUpload.processedUrl ?? localCover.coverMediaUrl` | Verbatim match lines 241-244 | **CONFIRMED** |
| `CoverPicker.tsx:266-280` — `emitChange` useEffect gated on `videoUpload.stage.phase === "ready" && videoUpload.processedUrl !== null` | Verbatim match lines 266-280 (including the early-return guard at 267-269 and the `setMediaDisplayError(null)` + `emitChange(...)` + `onShowToast("Video cover updated.")` body) | **CONFIRMED** |
| `useEventCoverVideoUpload.ts:70-75` — `setLocalPreviewUri(file.uri)` runs BEFORE compression / upload-intent | Verbatim match line 74 (preceded by `setError(null); setStatus(null); setProcessedUrl(null);` resets) | **CONFIRMED** |
| `useEventCoverVideoUpload.ts:142-152` — catch sets `error` + `stage: { phase: "error", ... }` but never clears `localPreviewUri` | Verbatim match lines 142-152 — exit path goes through `setError(nextError); setStage({ code, message, percent: 0, phase: "error" });` with NO `setLocalPreviewUri(null)` | **CONFIRMED** |
| `eventCoverVideoProcessingService.ts:548-563` — 401 from edge function mapped to `BusinessAuthNotReadyError("unauthenticated", "Finishing sign-in. Try again in a moment.")` | Verbatim match lines 548-563 including the `devWarn("edge-error-auth", ...)` call at 549 | **CONFIRMED** |
| `event-cover-video-upload-intent/index.ts:48-52` — `requireUserId(req)` called early, returns 401 Response on auth fail | Verbatim match lines 48-52 (with `logWarn(requestId, "auth_failed", { status: ... })` at 50) | **CONFIRMED** |

**Six verbatim quotes, six matches.** No invented evidence. The causal chain in §5 F-1 (picker shows local preview → upload intent 401 → ready never fires → parent gets no patch → Save stays disabled) is rigorously source-traced.

DB constraint claim in F-6 was independently verified by Codex via Supabase Management API:
```
event_cover_video_jobs_trim_max_duration       CHECK ((trim_end_ms - trim_start_ms) <= 15000)
event_cover_video_jobs_processed_max_duration  CHECK ((processed_duration_ms IS NULL) OR (processed_duration_ms <= 15000))
```
Operator-relevant: this is a NEW launch blocker discovered by this investigation. Independent of the save-button bug, the 29-second cap chosen for the trim fix CANNOT ship until these constraints are raised — the edge function would reject any 29s clip the client sent.

---

## REVIEW checklist

- [x] **All 9 findings present?** YES (F-1 through F-9). Each has classification (Confirmed bug / Confirmed launch blocker / Confirmed behavior / Production-hardening gap / Test gap), root cause proof with file/line + exact behavior + runtime proof + causal chain + expected behavior + fix direction + regression guard.
- [x] **Five-truth-layer matrix present?** YES (§4). All 5 layers populated. Docs layer correctly notes contradiction with runtime + schema. Schema layer correctly surfaces the 15s constraint blocker. Code layer cites exact line ranges. Runtime layer cites Maestro evidence files + Metro log + DB probe result. Data layer cites probe result.
- [x] **Live-fire on iOS sim (mandatory per `feedback_always_simulator_repro_described_behaviour.md`)?** YES. Maestro on iPhone 17 sim UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`. iOS 26.4. Coordinate/text flow, no osascript. 7 screenshots in evidence folder. Metro instrumentation log captured. DB probe via Supabase Management API. **No "suspected" downgrade — confidence is "proven" per the rule.**
- [x] **Maestro used, not osascript?** YES. §3 environment block explicitly states "Driver: Maestro coordinate/text flow, no `osascript`". Per `feedback_sim_test_drivers_maestro_default.md`.
- [x] **External citations per COMMS-0003?** YES — inline URLs for: Expo local development builds (https://docs.expo.dev/workflow/overview/), Cloudinary upload API (https://cloudinary.com/documentation/image_upload_api_reference), Cloudinary authentication signatures (https://cloudinary.com/documentation/authentication_signatures), Supabase Management API (https://supabase.com/docs/reference/api/introduction). All external behavior claims URL-backed.
- [x] **No-SPEC / no-code compliance?** YES. §6 "Fix-shape recommendations" explicitly framed as recommendations, not SPEC. §7 "SPEC AMENDMENT 2 inputs" is a checklist for downstream forensics SPEC mode, not a binding contract. No product-code edits left in the diff (instrumentation was reverted; orchestrator's old tsconfig changes are separate noise).
- [x] **Confidence honesty?** YES — §9 explicitly cites limits: (a) screen recorder was unavailable due to host glitch, evidence is screenshot/log/DB based not video based; (b) the successful Cloudinary/webhook/save path was NOT reached because the confirmed repro fails at upload-intent auth. This matches the memory rule on live-fire confidence ceilings.
- [x] **Six-field root cause proof present?** YES for F-1, F-2, F-4, F-5. File/line + exact code/behavior + runtime proof + causal chain + expected behavior + fix direction + regression guard for each.
- [x] **Cross-link to companion investigation?** YES — §1 explicit ("the operator-selected 29-second cap from the approved trim investigation will still fail until schema constraints are raised above 29 seconds"). §7 inputs row 1 names the consolidated cap contract. §9 notes the trim REVIEW APPROVED at `1f39b63af`.
- [x] **Comms ack?** YES — COMMS-0003 + COMMS-0002 + COMMS-0004 `acked_by` already include `mingla-forensics+codex (ORCH-0978 SAVE BUTTON GREYED — ...)` entries as of the current ledger snapshot.
- [x] **Commit-hash verification?** **PASS.** Investigation report + evidence folder committed at `23fb1d877` on the per-ORCH branch (2026-05-27). 8 files exactly, no unrelated artifacts folded in.

All 11 checklist items PASS.

---

## Two strengths to call out

1. **The investigation correctly redirected the diagnosis.** The original operator hypothesis — and the initial dispatch's framing — assumed the bug lived in the disable-gate logic or the React Query / Realtime cache invalidation path (F-7 in the dispatch). Codex live-fire instead proved that the failure happens 5 steps EARLIER: at the edge function's `requireUserId(req)` returning 401, before any job row is even created. The cache / Realtime path is fine — it never gets exercised because the upload pipeline collapses at step 1. This is exactly what live-fire is for: source-only reasoning would have written the wrong fix.

2. **The DB-constraint discovery is load-bearing for the consolidated SPEC AMENDMENT 2.** F-6 surfaces that `event_cover_video_jobs.trim_max_duration` and `processed_max_duration` still cap at 15,000 ms — a hard-coded 15-second ceiling in the migration that was never raised when SPEC A1 chose 30s. If the trim-cap fix had shipped as a client-only "videoMaxDuration: 29" change without F-6 being caught, IMPLEMENT-2 would have shipped GREEN at the client layer and then every 29s upload would have been rejected by the edge function with a 422. Codex caught this BEFORE IMPLEMENT-2 was written. This is the kind of cross-layer find that justifies live-fire + schema introspection on every investigation.

---

## One minor gap (non-blocking, beyond the commit gate)

The investigation does not name WHY `requireUserId(req)` returns 401 even though the operator was visibly signed in and could navigate the app. Three possible explanations are surfaced but not narrowed:

(a) Session token TTL expired between sign-in and picker tap (likely if session has been idle for >1 hour).
(b) The picker triggers a token refresh race — the picker's edge call fires before the Supabase JS client's silent refresh completes.
(c) The token IS valid but `requireUserId` is reading from a header path that the business app's `supabase.functions.invoke` does NOT populate (a wiring bug, not an auth bug).

Each requires a different fix:
- (a) → auth-readiness preflight (per F-2 fix direction)
- (b) → await session refresh before launching picker
- (c) → fix the header wiring in `eventCoverVideoProcessingService.ts` invoke call

**Implication for SPEC AMENDMENT 2:** the spec must instruct the implementor to first instrument `requireUserId` to log WHICH check failed (token absent vs token expired vs token invalid vs userId not returned), reproduce on sim, then pick the right fix. A blind "add auth preflight" risks not solving the actual problem.

This is NOT a NEEDS-WORK condition — the investigation is honest about its evidence ceiling (§9 explicitly: "the successful Cloudinary/webhook/save path was not reached"). Just a flag for SPEC mode.

---

## Consolidated SPEC AMENDMENT 2 scope (for downstream forensics SPEC mode)

Both investigations (this one + `INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` already APPROVED `1f39b63af`) consolidate into ONE SPEC AMENDMENT 2 and ONE IMPLEMENT-2 pass. Required items, ranked by severity:

| # | Item | Source | Severity |
|---|---|---|---|
| 1 | Drop and recreate `event_cover_video_jobs_trim_max_duration` + `event_cover_video_jobs_processed_max_duration` constraints with 29,000 ms ceiling (new migration). Self-verify probe in migration. | F-6 (save-bug investigation) | **P0 launch blocker** |
| 2 | Auth-readiness preflight before launching picker. Instrument `requireUserId` first to identify which of (a)/(b)/(c) above is the actual failure mode, then implement the targeted fix. | F-2 (save-bug investigation) | **P0** |
| 3 | Clear `localPreviewUri` in `useEventCoverVideoUpload` catch block before `setStage({ phase: "error" })`. Or move local preview into a distinct `failedLocalPreviewUri` field with explicit retry/remove UI. | F-1, F-5 (save-bug investigation) | **P0** |
| 4 | Lower client picker cap from 30s to 29s in 2 constants: `CoverPicker.tsx:425` (`videoMaxDuration: 30 → 29`) + `eventCoverVideoProcessingService.ts:17` (`EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000 → 29_000`). | Trim investigation Option A | **P1** |
| 5 | One-line diagnostic log `console.log("[ORCH-0978-TRIM]", durationMs)` before rejection at `CoverPicker.tsx:434` for observability on real-device overshoot magnitudes. | Trim REVIEW preflight tweak | **P2** (optional) |
| 6 | Keep `EditPublishedScreen` Save gate strict — do NOT widen to allow empty patches. | F-4 (save-bug investigation, "Do not choose" §6) | **Constraint** |
| 7 | Structured telemetry: `video_cover_upload_intent_failed`, `video_cover_upload_ready`, `video_cover_upload_preview_rolled_back`. | F-7 (save-bug investigation) | **P2** |
| 8 | Regression tests in same commit: hook 401 path clears preview; component shows retry not phantom; screen Save stays disabled with explicit failure UI; migration self-verify; edge validates 29,000ms accepted + 29,001ms rejected. | F-9 + F-6 (save-bug investigation) | **P0 per `feedback_close_commit_precommit_checks.md`** |
| 9 | Live-fire gate: rebuilt iOS dev client + Maestro pick ≤29s + final Cloudinary URL renders + Save enables. | F-8 (save-bug investigation) | **CONDITION on IMPLEMENT-2 CONDITIONAL PASS** |

This is a 9-item single SPEC AMENDMENT 2 dispatch, ONE IMPLEMENT-2 PR, ONE RETEST, ONE CLOSE.

---

## Approval and routing

**REVIEW VERDICT: APPROVED** — all 11 checklist items pass, all 9 findings hold up against spot-checks (6 verbatim code quotes verified), procedural commit gate satisfied by `23fb1d877`. Ready for SPEC AMENDMENT 2 dispatch.

**Downstream sequence:**

1. **Forensics SPEC AMENDMENT 2** — Claude or Codex `mingla-forensics` (operator's choice). Consolidates 9 items from the table above into a single bounded amendment. Cites both investigations as input.
2. **Orchestrator REVIEW** of SPEC AMENDMENT 2.
3. **Codex `implementor-mingla` IMPLEMENT-2** — one PR fixing all 9 items.
4. **Orchestrator REVIEW** + edge function deploys (`event-cover-video-upload-intent` will rev for the auth preflight; migration applies operator-side).
5. **Codex tester or Claude forensics TEST** — Maestro live-fire on iOS sim AND operator's physical iPhone (per `feedback_tester_3sims_plus_operator_physical.md`).
6. **Orchestrator CLOSE** ORCH-0978 with `[deploy]` tag (touches `mingla-business/src/` so Vercel gate applies).
