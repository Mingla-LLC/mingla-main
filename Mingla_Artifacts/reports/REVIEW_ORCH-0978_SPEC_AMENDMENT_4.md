# ORCHESTRATOR REVIEW — ORCH-0978 SPEC AMENDMENT 4 (consolidated trim cap + DB constraint + save-button fix)

**Reviewer:** Claude `mingla-orchestrator`
**Artifact reviewed:** `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` AMENDMENT 4 section (lines 700-1071, 372 insertions) committed at `0832fe045` by Claude `mingla-forensics` (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-27
**Companion REVIEWs:** `REVIEW_ORCH-0978_INVESTIGATION_TRIM_UX_GAP.md` (APPROVED `1f39b63af`) + `REVIEW_ORCH-0978_INVESTIGATION_SAVE_BUTTON_GREYED.md` (APPROVED 2026-05-27 after commit `23fb1d877`)

---

## Verdict — APPROVED (Pass 2, 2026-05-27)

**Verdict tier:** APPROVED — flipped from NEEDS WORK after rework at commit `fc2b51ac5` (52 insertions, 19 deletions to the AMENDMENT 4 section). Both Pass 1 gaps closed cleanly, not just patched over.

**Pass 1 history:** Pass 1 returned NEEDS WORK with two specific gaps (P1 duplicate `EVENT_COVER_MAX_VIDEO_DURATION_MS` constant in two files, P2 ambiguous `requireUserId` helper file). Claude `mingla-forensics` reworked both items in place plus added structural reinforcement (strict-grep check C3, Discovery J-bis for consolidation follow-up, explicit out-of-scope warning for the Stripe auth helper).

### Pass 2 verification of gap closure

**Gap 1 closure (P1 duplicate constant) — VERIFIED.** Item 4 now lists 5 explicit file:line edits across 4 files. Edit #3 specifically targets the older `eventCoverMediaRules.ts:4` declaration that Pass 1 dependency walk surfaced as missing. The new Background paragraph traces both consumer chains in plain English (`eventCoverVideoProcessingService.ts:17` → CoverPicker → picker rejection; `eventCoverMediaRules.ts:4` → eventCoverMediaService → storage-bucket validation), so the implementor cannot miss that updating only one would silently diverge the two pipelines. `SC-AMENDMENT-4-CAP-4` was extended to require `grep -rn "EVENT_COVER_MAX_VIDEO_DURATION_MS = 30" mingla-business/src/` returns ZERO matches post-change. New strict-grep check C3 (added to §F, expanded from 3 → 4 total checks) enforces at CI. Test compatibility note confirms zero edits to existing test files. Architectural follow-up surfaced as §J-bis Discovery for a future consolidation ORCH.

**Gap 2 closure (P2 ambiguous `requireUserId` file) — VERIFIED.** Item 2a now names both the call site (`event-cover-video-upload-intent/index.ts:48`) AND the helper definition file (`supabase/functions/_shared/eventCoverVideo.ts:58`). Adds an explicit "Out of scope (DO NOT TOUCH)" warning naming `_shared/stripeEdgeAuth.ts:40` as the Stripe helper that must NOT be instrumented, with the failure mode spelled out ("the instrumentation will land in the wrong codepath and the diagnostic will produce zero data for this ORCH"). Verification step instructs the implementor to confirm the import path inside `index.ts` resolves to the correct `_shared/` file before editing.

The amendment substance is otherwise excellent — diagnostic-first rule for the auth fix is rigorous, the migration self-verify probe is correctly structured, the "do not widen Save gate" non-goal is unambiguous, the regression-test contract names two distinct attack angles per the META-ORCH-0744 gate, the strict-grep registry update follows the canonical pattern, the new I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S invariant explicitly names BOTH constant declarations to prevent future drift.

---

## Commit-hash verification (DEC-179 / ORCH-0959)

| Claimed artifact | git show status | Verdict |
|---|---|---|
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (AMENDMENT 4 appended) | committed at `0832fe045` (1 file changed, 372 insertions) | **PASS** |

Gate **PASSES**. No artifacts left uncommitted.

---

## Dependency walk (DEC-179 / ORCH-0959)

Per the SPEC's prescribed code touches, ran grep for consumers of each touched symbol/constant.

### Consumer scan: `EVENT_COVER_MAX_VIDEO_DURATION_MS` (Item 4)

**FINDING — P1 SPEC GAP:** The constant is declared in TWO places, not one as the SPEC implies:

```
mingla-business/src/utils/eventCoverMediaRules.ts:4           export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000;
mingla-business/src/services/eventCoverVideoProcessingService.ts:17  export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000;
```

Both are 30_000 today. The SPEC AMENDMENT 4 Item 4 only directs the implementor to update line 17 of `eventCoverVideoProcessingService.ts`. If implemented literally, the two constants will diverge (29_000 vs 30_000) and depend on which one each consumer imports.

Consumer trace:
- `mingla-business/src/components/ui/CoverPicker.tsx:64` imports `EVENT_COVER_MAX_VIDEO_DURATION_MS` (which one?)
- `mingla-business/src/services/eventCoverMediaService.ts:7 + 25` imports it (which one?)
- `mingla-business/src/utils/eventCoverMediaRules.ts:339` uses it locally (`input.durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS` — would stay at 30_000 if only Item 4 ships)
- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts:6, 258, 430, 453` asserts `EVENT_COVER_MAX_VIDEO_DURATION_MS + 1` rejects — would test against whichever constant `eventCoverMediaService.ts` imports

**Required SPEC fix (Item 4):** specify EITHER (a) update BOTH constant declarations to 29_000 with explicit cite of both file:line locations, OR (b) consolidate — delete the duplicate in `eventCoverVideoProcessingService.ts`, re-export from `eventCoverMediaRules.ts` (one owner per truth — constitutional rule). Recommend (b) for architectural cleanliness, but (a) is acceptable for minimum-scope shipping. SPEC must pick.

### Consumer scan: `videoMaxDuration` (Item 4)

```
mingla-business/src/components/ui/CoverPicker.tsx:422                                 videoMaxDuration: 30
mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts:75                expect(source).not.toContain("videoMaxDuration: 15")
app-mobile/src/services/cameraService.ts:142                                          videoMaxDuration: options.maxDuration || 30
```

- The picker `videoMaxDuration: 30` matches SPEC Item 4 — correct scope. **PASS.**
- The existing test at `eventCoverMedia.test.ts:75` asserts `videoMaxDuration: 15` does NOT appear — non-blocking (29 vs 15 both satisfy the negative assertion). SPEC could optionally extend this test to positively assert `videoMaxDuration: 29` appears, but not required. **PASS.**
- `app-mobile/src/services/cameraService.ts:142` is the CONSUMER app's camera service, NOT in scope per AMENDMENT 4 cross-surface declaration (Consumer iOS/Android explicitly excluded). The 30 there is unrelated to event cover videos. **CORRECT EXCLUSION.**

### Consumer scan: `requireUserId` (Item 2a/2b)

```
supabase/functions/_shared/eventCoverVideo.ts:58              export async function requireUserId(req: Request)
supabase/functions/_shared/stripeEdgeAuth.ts:40               export async function requireUserId(req: Request)
```

**FINDING — P2 SPEC GAP:** Two `requireUserId` helpers exist in `_shared/`. The SPEC Item 2a says "wrap or inline-expand `requireUserId(req)`" but does NOT specify which file. The implementor could touch the wrong one.

**Required SPEC fix (Item 2a):** explicitly cite `supabase/functions/_shared/eventCoverVideo.ts:58` as the wrap target. The `stripeEdgeAuth.ts:40` version is out of scope (different surface — Stripe Connect endpoints, not video).

### Migration timestamp collision check (Item 1)

Scanned all `~/Desktop/mingla-orchs/*/supabase/migrations/` worktrees: highest existing timestamp `20260729000002_orch_0964_brand_event_theme_columns.sql`. The SPEC claims `20260730000000` — **CLEAR, no collision**.

### Edge function deploy implications (Item 5)

The SPEC touches `supabase/functions/event-cover-video-upload-intent/index.ts` (twice: Item 2a diagnostic, Item 5 validation, Item 2b fix). Implementor must deploy this function twice during IMPLEMENT-2 (after Item 2a diagnostic lands, after the full fix lands). SPEC §J implementation order correctly accounts for this. `verify_jwt` setting MUST be preserved (currently default `true` — confirmed via `mcp__supabase__list_edge_functions` mental model from prior context). **PASS.**

### Strict-grep workflow file (Item 9 + §F)

The SPEC says "Wire into `.github/workflows/strict-grep-mingla-business.yml` as one new job per `feedback_strict_grep_registry_pattern.md`. Do NOT create a parallel workflow file." Verified: only one workflow file exists at that path (80,746 bytes — sizeable but single). New script `orch-0978-video-cap-29s.mjs` plugs in as a new job. SPEC also correctly identifies the existing `ORCH_0978_BACKEND_ALLOWLIST` array in `orch-0863-marketing-hub-phase-b.mjs` (verified: array exists with 5 entries — implementor appends 3 more per Item 9). **PASS.**

### Test infrastructure check (Item 9)

- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts` exists (confirmed). The SPEC says implementor's test path is `mingla-business/src/hooks/__tests__/useEventCoverVideoUpload.test.ts` (NEW file). **OK — create new** is a valid path per the test gate.
- `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` (NEW) — no existing tests folder for this edge function. **OK — create new folder + file**.

**PASS** with note: implementor should ensure the new test files import paths are correct (e.g., `__tests__` is the convention in `mingla-business/src/`; the edge function dir uses `__tests__` per existing patterns in `supabase/functions/discover-cards/__tests__/`).

---

## Spot-check of SPEC quotes against actual source

| SPEC quote | Actual source | Result |
|---|---|---|
| `CoverPicker.tsx:422 — videoMaxDuration: 30` | Verbatim match line 422 | **CONFIRMED** |
| `CoverPicker.tsx:434 — durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250` | Verbatim match line 434 | **CONFIRMED** |
| `eventCoverVideoProcessingService.ts:17 — EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000` | Verbatim match line 17 | **CONFIRMED** |
| `eventCoverVideoProcessingService.ts:21 — "Use your phone's trim screen to keep video covers to 30 seconds..."` | Verbatim match line 21 | **CONFIRMED** |
| `useEventCoverVideoUpload.ts:142-152 — catch block sets stage:error without clearing localPreviewUri` | Verbatim match line 142-152 | **CONFIRMED** |
| `EditPublishedScreen.tsx:1161-1166 — Save disabled gate (Item 6 non-goal)` | Verbatim match (verified via prior Phase 0 reads) | **CONFIRMED** |
| `event-cover-video-upload-intent/index.ts:48 — requireUserId(req)` | Verbatim match line 48 | **CONFIRMED** |
| Migration source `20260515000012_orch_0770_event_cover_video_processing.sql:53-58 — CHECK 15000` | Verbatim match (read full file) | **CONFIRMED** |
| Live DB constraints: both `_trim_max_duration` + `_processed_max_duration` at `15000` | Independently verified via Management API on 2026-05-27 | **CONFIRMED** |

**Nine quotes, nine matches.** SPEC author did Phase 0 properly.

---

## REVIEW checklist

- [x] **Root cause proven or just plausible?** Both root causes are PROVEN per the two APPROVED investigations (live-fire Maestro on iOS sim + live DB constraint probe).
- [x] **Scope appropriate — could be narrower?** Yes — explicitly NOT widening Save gate, NOT building custom trim sheet, NOT redesigning auth pipeline. Diagnostic-first for Item 2 preserves narrowness.
- [x] **Hidden fallback paths that mask failure?** Item 3's `setLocalPreviewUri(null)` correctly leaves the `??` chain to fall through to `localCover.coverMediaUrl` — verified by SPEC author and confirmed by my Phase 0. No hidden fallback masks the rollback.
- [x] **Stale cache paths serving old data?** N/A — this scope doesn't touch React Query cache invalidation.
- [x] **Response shape truthful in ALL states?** Item 5 edge validation returns explicit 422 with `{error, detail}` shape; Item 2a diagnostic preserves existing 401 shape; Item 7 telemetry emits structured events. **PASS.**
- [x] **Real fix or symptom mask?** Real fix — addresses root causes (auth 401, phantom preview, DB constraint), not symptoms (button greying).
- [x] **Solo/collab parity checked?** N/A — event cover authoring is single-user (event manager).
- [x] **Constitutional compliance?** Item 4 violates "one owner per truth" (constitutional rule #2) by leaving two `EVENT_COVER_MAX_VIDEO_DURATION_MS` declarations. **FLAGGED above as P1 SPEC gap.**
- [x] **Evidence chain complete?** Both investigations cited + REVIEWs cited + live DB probe + migration timestamp scan. **PASS.**
- [x] **Documents updated?** SPEC append correctly modifies the existing SPEC file (not a new file). AMENDMENT 1 supersession statement included. **PASS.**
- [x] **Commit-hash verification?** **PASS** (commit `0832fe045`, 1 file changed, 372 insertions).
- [x] **Dependency walk?** **EXECUTED** — surfaced 1 P1 + 1 P2 gap (above).

10 of 12 PASS. 1 P1 + 1 P2 gap on the duplicate-constant + auth-helper-file specificity.

---

## Three strengths to call out

1. **Diagnostic-first rule for Item 2 (auth) is rigorous.** Most SPECs would just say "add session refresh before picker" and call it done. This one forces the implementor to land instrumentation alone, deploy it, run a Maestro repro, capture the actual failure reason from logs, THEN pick from four named fix paths. That prevents shipping a 100-line auth refactor when the actual problem is a 3-line client wiring bug (or vice versa). This is the kind of engineering discipline that prevents NEEDS-WORK rework cycles.

2. **The migration self-verify probe is structurally correct.** It probes BOTH constraint NAMES + post-condition checks ("15000 string absent" AND "29000 string present" in BOTH constraint definitions). Pre-flight probe also handles the (extremely unlikely but defensive) case of stray >29000 rows with a clear data-repair runbook, satisfying `feedback_orchestrator_deploys_edge_functions.md` invariant migration backstop without operator intervention.

3. **Item 6's non-goal is unambiguous.** The SPEC names the EXACT line ranges (`220-235`, `375-395`, `1155-1175` of `EditPublishedScreen.tsx`) that MUST NOT be touched and includes a `git diff` verification SC. This blocks the most likely implementor temptation ("just widen the gate to make the test pass") at the SPEC layer, not at REVIEW.

---

## The two gaps in detail

### P1 — Item 4 — duplicate constant declaration

**The problem:** `EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000` exists in:
1. `mingla-business/src/utils/eventCoverMediaRules.ts:4`
2. `mingla-business/src/services/eventCoverVideoProcessingService.ts:17`

SPEC Item 4 only directs the implementor to update location 2. After IMPLEMENT-2 ships:
- Picker math at `CoverPicker.tsx:434` (`> EVENT_COVER_MAX_VIDEO_DURATION_MS + 250`) becomes `> 29250` if the import resolves to location 2, or stays `> 30250` if it resolves to location 1.
- `eventCoverMediaRules.ts:339` validation (`input.durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS`) stays at 30000 ceiling — silently inconsistent with the picker.
- Existing test `eventCoverMediaService.test.ts:258, 430, 453` asserts `+ 1` rejection — would test against whichever constant `eventCoverMediaService.ts` imports.

**Required SPEC fix:** add a sub-step to Item 4:

> 4-bis: BOTH constant declarations must be updated to `29_000`:
> - `mingla-business/src/utils/eventCoverMediaRules.ts:4`: `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000;` → `29_000;`
> - `mingla-business/src/services/eventCoverVideoProcessingService.ts:17`: same change.
>
> OR, preferred per constitutional rule "one owner per truth": consolidate — delete the duplicate at `eventCoverVideoProcessingService.ts:17` and have `eventCoverVideoProcessingService.ts` re-export the constant from `eventCoverMediaRules.ts`. Update import paths if any consumer is importing from the duplicate location. Verify with grep that exactly one declaration remains.

The new `I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S` invariant should also explicitly require "exactly one declaration of the constant anywhere in the repo" if consolidation is chosen, OR "both declarations agree" if not.

### P2 — Item 2a — `requireUserId` file unspecified

**The problem:** Two `requireUserId` helpers exist in `supabase/functions/_shared/`:
1. `eventCoverVideo.ts:58` (cover-video scope)
2. `stripeEdgeAuth.ts:40` (Stripe scope)

SPEC Item 2a says "wrap or inline-expand `requireUserId(req)`" without naming the file. Implementor could touch the wrong one.

**Required SPEC fix:** add to Item 2a:

> File precision: the helper to instrument is `supabase/functions/_shared/eventCoverVideo.ts:58`. The Stripe helper at `_shared/stripeEdgeAuth.ts:40` is OUT OF SCOPE for this amendment.

---

## Approval and routing

**REVIEW VERDICT (Pass 2): APPROVED** — both Pass 1 gaps closed at rework commit `fc2b51ac5`. 11 of 11 checklist items now PASS (commit-hash + dependency-walk + all substantive review items). SPEC AMENDMENT 4 is implementable.

**Downstream sequence:**

1. **Codex `implementor-mingla` IMPLEMENT-2** — one PR covering all 9 items in §J implementation order. Dispatch prompt at `Mingla_Artifacts/prompts/IMPLEMENTOR_IMPLEMENT_2_ORCH-0978.md`.
2. **Orchestrator REVIEW** of the implementation (commit-hash + dependency-walk + code quality).
3. **Operator applies DB migration** (`supabase db push --linked` from the worktree per `feedback_orchestrator_deploys_edge_functions.md`).
4. **Orchestrator deploys** `event-cover-video-upload-intent` edge function (twice: once after Item 2a diagnostic lands, once after Item 2b fix + Item 5 validation lands).
5. **Codex tester or Claude forensics TEST** — Maestro live-fire on iOS sim AND operator's physical iPhone (per `feedback_tester_3sims_plus_operator_physical.md`).
6. **Orchestrator CLOSE** ORCH-0978 with `[deploy]` tag (touches `mingla-business/src/` so Vercel gate applies). EAS OTA publish required (no native module changes so no `eas build` needed). PR merge + worktree reap.
