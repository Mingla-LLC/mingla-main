# ORCHESTRATOR REVIEW — ORCH-0978 IMPLEMENTATION

**Reviewer:** Claude `mingla-orchestrator`
**Artifact reviewed:** Implementation at commit `3e8d03ed0` ("event-cover-video: polish upload lifecycle") + report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-26

---

## Verdict — APPROVED (work quality) WITH HARD GATE before downstream

The implementation is correct, comprehensive, and matches SPEC + amendments A1/A2/A3 across all 9 traceability rows the implementor cited. Spot-checks of every load-bearing change PASS. The work meets the bar. **BUT downstream actions (edge deploy + tester dispatch + CLOSE) are GATED on an ORCH-0964 PR-merge rebase + re-verification** — see Gate #1 below. Without that rebase, the branch will hit 3 hard merge conflicts and the tester can't validate against production-shape code.

Comms ack: I read COMMS-0001 through COMMS-0006. None block ORCH-0978; COMMS-0002/0003/0004 were already factored by implementor (per their §4 ack). COMMS-0006 is an unrelated ORCH-0980 BLOCK already ACKNOWLEDGED.

---

## Commit-hash verification (DEC-179 / ORCH-0959 mandatory)

All 30 files cited in the implementation report appear in commit `3e8d03ed0` on the per-ORCH branch. Spot-checked load-bearing claims via direct grep against the worktree:

| Claim from implementation report | Spot-check evidence | Status |
|---|---|---|
| `cloudinaryDestroy` helper added to `_shared/eventCoverVideo.ts` | grep count 7 in shared file | COMMITTED |
| Cancel fn calls destroy + reads `source_public_id` | grep count 5 in `event-cover-video-cancel/index.ts` | COMMITTED |
| Upload-intent + source-uploaded persist `source_public_id` | grep count 1 in each | COMMITTED |
| New caps: 30000ms processed, 100MB source guard | `MAX_DURATION_MS=30000`, `MAX_SOURCE_VIDEO_BYTES=104857600` | COMMITTED |
| `useEventCoverVideoUpload.ts` hook | file exists at expected path | COMMITTED |
| `packages/event-rendering/EventCoverMedia.tsx` (shared extraction) | file exists; 561 lines | COMMITTED |
| Happy-path regression test | `mingla-business/__tests__/services/eventCoverVideoProcessingService.compression.test.ts` exists; 225 lines | COMMITTED |
| 3 strict-grep gate files | all 3 in `.github/scripts/strict-grep/orch-0978-*.mjs` | COMMITTED |
| Workflow wired (3 new jobs) | 33-line addition to `strict-grep-mingla-business.yml` | COMMITTED |
| Backend allowlist extended | 12-line addition to `orch-0863-marketing-hub-phase-b.mjs` | COMMITTED |
| `expo-video` + `react-native-compressor` in `app-mobile/package.json` | both present | COMMITTED |

`git status --short` shows zero scope-relevant uncommitted files. Gate PASSES.

---

## Dependency walk (DEC-179 / ORCH-0959 mandatory)

This commit touches multiple config-layer files. Per protocol, walk consumers:

| Config file changed | Consumers + compatibility assessment |
|---|---|
| `app-mobile/package.json` (+1 line: `react-native-compressor`) + `app-mobile/package-lock.json` (+29 lines) | Native autolinking on iOS + Android. Already covered by SPEC Step 1 PoC scaffolding commit `0eb9f8f03` (PoC PASS proved native side works). Implementation report §10 + §14 correctly flag native module change requires full `eas build`. COMPATIBLE. |
| `app-mobile/tsconfig.json` + `mingla-business/tsconfig.json` (6 lines each) | TypeScript resolution. Likely path-mapping update for the new `packages/event-rendering/` re-export — implementor's §12 "Focused ORCH-0978 typecheck PASS" confirms no new TS errors in scope. COMPATIBLE. |
| `packages/event-rendering/package.json` (peerDeps changed) | Consumers = `mingla-business` (already has expo-video) + `app-mobile` (also has expo-video now per Step 1). **HARD CONFLICT with ORCH-0964 branch** — see Gate #1. |
| `.github/workflows/strict-grep-mingla-business.yml` (+33 lines, 3 new jobs) | CI workflow. Standard pattern matching existing ORCH-0863/0972 gates. Wired correctly per report §9. COMPATIBLE with main. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (+12 lines: backend allowlist extension) | Single-file edit, additive. Already aligned with COMMS-0002 acks. COMPATIBLE. |
| 3 new files in `.github/scripts/strict-grep/orch-0978-*.mjs` | Pure additions, no consumers. COMPATIBLE. |

Gate PASSES on the dependency walk EXCEPT for `packages/event-rendering/` collision with ORCH-0964 — that's a separate explicit gate below, not a "consumer not updated" defect.

---

## Critical finding — Gate #1: ORCH-0964 collision UNRESOLVED

**This is the only blocker. The implementation work itself is sound.**

SPEC §11 explicitly stated: *"IMPLEMENT cannot start until ORCH-0964 PR merges to main AND the ORCH-0978 worktree is rebased onto fresh main."*

Current state:
- **ORCH-0964 PR #220 is OPEN, not merged.** Last activity: REVIEW APPROVED + smoke-test PASS + CLOSE commit `a7ee79ecc` on the ORCH-0964 branch.
- **ORCH-0978 branched off main BEFORE ORCH-0964 landed** (INTAKE commit was on `3a1b26e77`, predating ORCH-0964 close commit).
- **The ORCH-0978 branch is missing every ORCH-0964 change** to `packages/event-rendering/`.

Confirmed 3 hard collisions on the same files (`git diff origin/ORCH-0964-public-page-theme-customization HEAD -- packages/event-rendering/`):

1. **`packages/event-rendering/index.ts`** — ORCH-0964 added exports `ThemeEntranceAnimation`, `resolveTheme`, `computeForeground`, `isThemeAnimationSlug`, `isThemeColor`, `isThemeFontSlug`, `FONT_FAMILY_MAP`, `MINGLA_DEFAULT_THEME`, `THEME_ANIMATION_SLUGS`, `THEME_FONT_SLUGS`. ORCH-0978 added export `EventCoverMedia` + types. The branches will MERGE-CONFLICT on the export block — needs to UNION both sides.
2. **`packages/event-rendering/PublicEventPage.tsx`** — ORCH-0964 added imports `BlurView`, `MINGLA_DEFAULT_THEME`, `ResolvedTheme`, `resolveTheme`, `ThemeEntranceAnimation`. ORCH-0978 doesn't have those imports (branched before they existed). Need to UNION the import set AND verify the new video-render code from ORCH-0978 composes correctly with ORCH-0964's theme-token wiring.
3. **`packages/event-rendering/package.json`** — ORCH-0964 added peer deps `expo-blur`, `lottie-react-native`. ORCH-0978 added `expo-video`, `react-native-svg`. Need to UNION both peer-dep sets.

**These conflicts MUST be resolved before:**
- Edge function deploy (low risk — edge fns don't touch event-rendering — but the deploy is on the same branch state so cleaner to do post-rebase)
- Tester dispatch (T-11 cross-platform render specifically — testing render code that's missing ORCH-0964's theme tokens won't reflect production reality)
- CLOSE PR open (GitHub will block the merge with conflict markers)

### Resolution path

Two viable orderings:

**Option A (recommended) — Merge ORCH-0964 first, then rebase ORCH-0978:**
1. Operator gets ORCH-0964 PR #220 merged to main (already at CLOSE smoke-test PASS — should be hours away).
2. Implementor rebases ORCH-0978: `git fetch origin && git rebase origin/main`.
3. Resolve the 3 conflicts above (union exports, union imports, union peer deps).
4. Re-run the compression regression test + the strict-grep gates locally to confirm green.
5. Push rebased branch.
6. Orchestrator re-verifies (commit-hash + dependency walk) on the rebased branch.
7. Proceeds to edge deploy + tester dispatch.

**Option B — Push ORCH-0978 IMPLEMENT as-is and let CLOSE-time merge handle it:**
NOT RECOMMENDED. Forces conflict resolution under PR-merge pressure with less rigor. Tester runs against not-quite-production-shape code. Skipped.

---

## REVIEW checklist (rest)

- [x] **Root cause addressed?** YES — implementation matches SPEC's identified bottleneck (raw upload bytes) via client-side compression.
- [x] **Scope appropriate?** YES — narrows to declared SPEC scope; doesn't bleed into workstreams A or C (except the SPEC-permitted cancel-destroy interaction with C).
- [x] **Hidden fallback paths?** None. Cloudinary destroy is best-effort and surfaces logs; chunked upload threshold is explicit; cancel abort is wired correctly.
- [x] **Stale cache paths?** No. New hook invalidates the 4 right query key families (business events, event drafts, public event detail, upcoming events) post-readiness.
- [x] **Real fix vs symptom mask?** REAL FIX. The implementation addresses the root cause of the 30s-budget failure (raw upload bytes) at the right layer (client compression) per the empirically-verified PoC.
- [x] **Constitutional compliance?** PASSES rules 3 (no silent failures — best-effort destroy is logged), 9 (no fabricated progress — bytes/time derived), 11 (cancel preserves auth gates).
- [x] **Evidence chain complete?** Strong. 9 verification rows in §12 with exact commands. All PASS or BLOCKED (the BLOCKED row is full-repo typecheck with pre-existing unrelated errors — acceptable per implementor §14).
- [x] **Documents updated?** Implementation report shipped + spot-checked.
- [x] **External-API docs cited inline per COMMS-0003?** Per implementor §9 invariant table + report §7: Cloudinary signed-upload docs cited inline in upload-intent; Cloudinary destroy docs cited inline in cancel/shared. Spot-check confirms grep hits for docs URLs in shared/eventCoverVideo.ts.
- [x] **Backend allowlist extension per COMMS-0002?** YES — `orch-0863-marketing-hub-phase-b.mjs` updated in same commit (+12 lines).
- [x] **Phase 2.5 Cross-Surface Impact preserved?** YES — implementation report §10 walks all 5 primary + 2 adjacent surfaces; report §16 lists deploy targets per surface.

---

## Outstanding items (PARTIAL / PENDING in implementor report)

Acceptable; flagged forward to TESTER:

- **T-11 cross-platform render parity** (PENDING) — implementor implemented the shared renderer; tester must validate Android-compressed → iOS playback per RESEARCH issue #268 concern.
- **T-12 first-frame-black guard** (PARTIAL) — `onFirstFrameRender`, `posterUri`, native shutter disabled all implemented; tester must confirm Android Pixel cold-load actually paints first frame.
- **Adversarial regression test** (CLOSE Step 0.5 gate) — implementor's happy-path test is PASS; tester must add an adversarial test attacking a DIFFERENT angle (e.g., cancel-mid-processing race + Cloudinary destroy failure semantics per T-05 in SPEC §7) BEFORE CLOSE. Implementor's report doesn't include this — expected, since adversarial test is tester's job.
- **`fails-on-revert verified at <commit hash>`** for the implementor's happy-path test — implementor's §12 says "Reverting compression orchestration would fail this test" but does NOT cite a specific verification commit hash. **TESTER must verify the test actually fails on revert and cite the hash in the QA report.** Step 0.5 CLOSE gate requires this explicitly.
- **Step 1 dependencies already landed** (PoC commits `6dd1efe73` / `0eb9f8f03` / `19aef8f54`) — implementor's report §3 assumption "source_public_id already exists from prior PoC/dependency work" — but actually `source_public_id` was already a column in the DB (per SPEC Amendment 2 probe, line `source_public_id text NULL`), not from PoC. Implementor was just unclear on attribution. Not blocking.

---

## Approval and downstream gating

**REVIEW VERDICT: APPROVED (work quality) WITH MANDATORY GATE.**

The implementor's work is correct and complete against the SPEC. The branch is NOT YET ready for tester dispatch because of the unresolved ORCH-0964 collision.

**Downstream actions are STOPPED until:**

1. **ORCH-0964 PR #220 merges to main.** (Operator-owned; no orchestrator action.)
2. **ORCH-0978 worktree rebases onto fresh main.** (Implementor- or orchestrator-owned; ~10-20 min depending on conflict shape — union exports + imports + peer deps.)
3. **Compression regression + strict-grep gates re-run green on rebased branch.** (Implementor verifies.)
4. **Orchestrator re-verifies commit-hash + dependency walk on the rebased branch.** (Quick — just re-run this REVIEW's spot-checks.)

ONLY THEN:

5. **Orchestrator deploys the 6 edge functions** (event-cover-video-cancel + upload-intent + source-uploaded + webhook + status + apply — all import `_shared/eventCoverVideo.ts` which changed) per the deploy-then-verify protocol.
6. **Tester dispatch** (Claude `mingla-tester` — TARGETED with mandatory T-11 + T-12 + the adversarial T-05 regression test + the `fails-on-revert` hash verification for the implementor's test).
7. **CLOSE** (orchestrator — with `[deploy]` tag, EAS OTA note, full `eas build` warning for native module changes).
