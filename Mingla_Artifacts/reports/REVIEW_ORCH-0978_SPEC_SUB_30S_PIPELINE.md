# ORCHESTRATOR REVIEW — ORCH-0978 SPEC

**Reviewer:** Claude `mingla-orchestrator`
**Artifact reviewed:** `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (commit `e23304b61`, 556 lines)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-26

---

## Verdict — APPROVED

The SPEC is a binding, IMPLEMENT-ready contract. Phase 0 surfaced four real-source findings (SDK 54, mingla-business has expo-video, app-mobile doesn't, EventCoverMedia already well-architected) that materially reshape the implementation effort and were NOT in RESEARCH — exactly what a SPEC phase is for. The cross-surface declaration, layered specifications, success criteria, test matrix, and invariant gates all hold up. The double-gate on IMPLEMENT (ORCH-0964 merge + T-00 PoC pass) is correctly identified.

---

## Commit-hash verification (DEC-179 / ORCH-0959 mandatory)

| Claimed-changed file | Commit on per-ORCH branch | Status |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | `e23304b61` (verified via `git log --oneline -1`) | COMMITTED |

`git status --short` in the per-ORCH worktree shows zero uncommitted files (other than expected `node_modules` symlinks). Gate PASSES.

---

## Dependency walk (DEC-179 / ORCH-0959 mandatory)

The SPEC itself touches zero config-layer files at SPEC time — config changes are in Implementation Order Step 1 (deferred to IMPLEMENT phase). However, the SPEC PRESCRIBES changes to config-layer files that the implementor will execute. Per the REVIEW protocol, I walk the dependency graph of those prescribed changes:

| Prescribed change | Consumer files | Compatibility assessment |
|---|---|---|
| Add `"react-native-compressor": "~1.18.2"` to `app-mobile/package.json` + `mingla-business/package.json` | Both apps' Metro bundlers; both apps' iOS + Android native autolinking | New native module → requires `expo prebuild` + full `eas build` (not OTA). SPEC §11 correctly flags this. Operator must run `npm install` after the package.json change, which will trigger node_modules-symlink removal per `feedback_worktree_per_orch_workflow.md` — SPEC Step 1.5 covers this. |
| Add `"expo-video": "~3.0.16"` to `app-mobile/package.json` (mingla-business already has it) | `app-mobile` consumer cover-render surfaces (`ExpandedBusinessEventSheet.tsx`, post-ORCH-0964 `/brand/[slug]/`). Mingla-business unchanged. | New native module → same `eas build` requirement. Version-pinned to match mingla-business avoids version-drift bugs. |
| Add `react-native-compressor` to `plugins` array in both `app.json` / `app.config.ts` | Expo prebuild config; iOS Podfile + Android settings.gradle generation | Standard Expo plugin pattern; documented in the package README. |
| Move `mingla-business/src/components/ui/EventCoverMedia.tsx` → `packages/event-rendering/EventCoverMedia.tsx` | Current mingla-business consumers of EventCoverMedia + post-ORCH-0964 consumer-app consumers + the existing `packages/event-rendering/PublicEventPage.tsx` | Collision risk with ORCH-0964 (in active IMPLEMENT, also touching `packages/event-rendering/`). SPEC's OQ-1 explicitly covers this — implementor pivots to path (b) if the post-rebase package shape blocks (a). |
| New CI gate files at `.github/scripts/strict-grep/orch-0978-*.mjs` | `.github/workflows/strict-grep-mingla-business.yml` (3 new jobs) | Standard pattern — same approach as the existing ORCH-0863 + ORCH-0972 gates. Implementor must add the 3 script paths to `ORCH_0978_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` SAME commit per COMMS-0002. |
| `_shared/eventCoverVideo.ts` gets new `cloudinaryDestroy` helper | All edge functions importing from `_shared/eventCoverVideo.ts` (the upload-intent, webhook, status, cancel, source-uploaded, apply functions — 6 functions). | All 6 functions need redeploy after the shared helper changes, per orchestrator's "deploy every edge function whose `_shared/` imports were touched" rule. SPEC Step 10 (#34) correctly flags this. |
| `event-cover-video-cancel/index.ts` modified to call `cloudinaryDestroy` | The only call site is `cancelEventCoverVideoJob` in `mingla-business/src/services/eventCoverVideoProcessingService.ts`. | Single consumer; backward-compatible (the cancel still flips DB state even if destroy fails; it's best-effort). |

All consumers identified; no broken-by-design changes. Gate PASSES.

---

## REVIEW checklist

- [x] **SPEC supported by evidence?** YES — Phase 0 cited 5 concrete source files; the existing `EventCoverMedia.tsx` and `_shared/eventCoverVideo.ts` were read in full at SPEC time, not assumed.
- [x] **Scope appropriate — could be narrower?** Tight. Workstreams A (full picker inventory) and C (full lifecycle reconciliation) are explicitly out of scope. Cancel-destroy is the ONE workstream-C interaction surface and SPEC explains why (cancel orphans an asset without it; same bug).
- [x] **Hidden fallback paths that mask failure?** NONE. The optimistic-local-preview is a deliberate fallback, labeled, with regression test T-07. Best-effort destroy is labeled, with T-14 testing the failure semantics.
- [x] **Real fix vs symptom mask?** REAL FIX. Root cause is "raw upload bytes are the 30s-budget bottleneck"; SPEC addresses it via client-side compression on the platforms that can run it.
- [x] **Solo/collab parity?** N/A — cover-video upload is per-event, no collab dimension.
- [x] **Constitutional compliance?** PASSES rule 3 (cancel/destroy/abort all surface errors via logged paths), rule 9 (progress is byte/time-derived, not synthesized), rule 11 (cancel preserves `requireUserId` + `requireEventManager`), rule 14 (cold-start tolerance — no Zustand server data; local preview state is component-local).
- [x] **Evidence chain complete?** YES — every external claim cites a docs URL inline (Cloudinary docs, react-native-compressor docs, WebKit policy, expo-video API).
- [x] **Documents updated?** SPEC + REVIEW committed; WORKTREE_REGISTRY phase column updated (this commit).
- [x] **External-API docs cited inline per COMMS-0003?** YES — Cloudinary destroy endpoint + chunked upload guidelines + admin API destroy + eager_async docs all cited inline.
- [x] **Phase 2.5 Cross-Surface Impact Declaration present?** YES — all 7 surfaces (5 primary + 2 adjacent) enumerated with per-surface SC-N-{platform} success criteria where parity is manual.
- [x] **Test cases cover happy + error + edge per success criterion?** YES — 15 test cases including T-13 (signature replay attack), T-14 (destroy failure best-effort), T-15 (web chunked upload at 80 MB).
- [x] **Regression-test prep for Step 0.5 CLOSE gate?** YES — implementor happy-path at `mingla-business/__tests__/services/eventCoverVideoProcessingService.compression.test.ts` and tester adversarial at `.cancelMidProcessing.adversarial.test.ts` are clearly DIFFERENT angles (compression-success-path vs cancel-mid-processing-with-destroy-failure).

---

## Two strengths to call out

1. **Phase 0 was rigorous and surfaced reality the RESEARCH couldn't.** The discovery that `mingla-business` already has `EventCoverMedia.tsx` with web + RN branches + mute toggle saves ~40% of the IMPLEMENT effort — the SPEC narrows scope to "extract + add 2 props + add `onFirstFrameRender`" rather than "build a new render component from scratch." This is what Phase 0 ingest is supposed to deliver and the SPEC did it.

2. **The T-00 empirical PoC gate is exactly the right structural safeguard.** RESEARCH flagged that real-world react-native-compressor performance is undocumented; SPEC promotes that to a PRE-IMPLEMENT BLOCKING test rather than a "we'll find out during IMPLEMENT" deferral. If T-00 fails, the spec pivots to per-platform native modules — and that pivot is explicit and recoverable, not a mid-flight scramble.

---

## One minor concern (non-blocking, NEEDS NOTING for IMPLEMENT)

- **The Cloudinary destroy helper code in §4.2 uses `formData.append("resource_type", "video")` but the cited Cloudinary docs (`https://cloudinary.com/documentation/image_upload_api_reference#destroy_method`) reference the IMAGE destroy URL pattern.** The video destroy URL is `https://api.cloudinary.com/v1_1/{cloudName}/video/destroy` (not `/image/destroy`). The SPEC has the URL right in the prose ("`POST https://api.cloudinary.com/v1_1/{cloudName}/video/destroy`") but the citation should point at a video-specific docs page if one exists, or note that the destroy API is shared with `resource_type` distinguishing. Implementor should verify against current Cloudinary docs at IMPLEMENT-Step-4 time. Not a SPEC blocker — citation precision detail.

---

## Approval and the unmet operator gates

**REVIEW VERDICT: APPROVED.**

But the SPEC's own §11 routing identifies two operator-level gates that must clear before IMPLEMENT dispatch:

### Gate 1 — ORCH-0964 PR merge — UNMET

`gh pr list --search "ORCH-0964"` returned no open PR for ORCH-0964 today. The ORCH-0964 worktree (`~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/`) is still in active IMPLEMENT with WIP across `packages/event-rendering/`, `mingla-business/src/components/event/`, `app-mobile/app/brand/`, `app-mobile/src/hooks/useBrandBySlug.ts`, etc. Per WORLD_MAP intake (2026-05-26) and SPEC §11 routing, ORCH-0978 IMPLEMENT cannot start until ORCH-0964 PR merges AND the ORCH-0978 worktree is rebased onto fresh main. **Status: BLOCKED.**

### Gate 2 — T-00 empirical PoC — NOT YET RUN

Real-world `react-native-compressor` benchmarks on iPhone 13 / iPhone 16 Pro / Pixel 6 / Galaxy S22 are required before IMPLEMENT. Three options for satisfying this gate:
- (a) Seth runs the PoC manually on his physical iPhone + a local Android device.
- (b) Forensics writes a Maestro/dev-build script that runs the PoC and records numbers (longer setup but more rigorous + reusable for future video ORCHs).
- (c) Defer T-00 to a "characterize early in IMPLEMENT" task — implementor measures on the first day and stops if numbers don't pencil out. SPEC quality drops because the budget is then verified late, but it's an acceptable risk-shift if Seth wants to move fast.

The PoC CAN be run in parallel with the ORCH-0964 wait — they're independent gates.

---

## Next actions for orchestrator handoff

Three concrete paths Seth chooses between:

**Path A (recommended, conservative):** Wait for ORCH-0964 to merge. While waiting, run T-00 PoC manually OR ask forensics to script it. When ORCH-0964 merges + T-00 passes, dispatch IMPLEMENT.

**Path B (parallel):** Dispatch IMPLEMENT NOW with explicit "DO NOT touch `packages/event-rendering/` or `packages/brand-rendering/` until ORCH-0964 merges; do every other Implementation Order step first" instruction. Rebase + finish the extraction step after ORCH-0964 merges. Higher coordination cost, faster wall-clock.

**Path C (defer):** Pause ORCH-0978 entirely; resume when ORCH-0964 closes. Lowest cost; longest delay.

Recommendation: Path A. ORCH-0964 is in active IMPLEMENT (last commit `69b4e375f` was SPEC AMENDMENT 3 — close to PR-ready), so the wait is probably hours-to-days not weeks. The T-00 PoC can fill the wait productively.
