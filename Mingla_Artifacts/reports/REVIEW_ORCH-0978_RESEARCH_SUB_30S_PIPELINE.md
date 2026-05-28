# ORCHESTRATOR REVIEW — ORCH-0978 RESEARCH report

**Reviewer:** Claude `mingla-orchestrator`
**Artifact reviewed:** `Mingla_Artifacts/reports/RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (commit `bf7bd8db2`, 520 lines, 35 inline-cited sources)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-26

---

## Verdict — APPROVED

The research report satisfies every dispatch requirement, surfaces three load-bearing findings the SPEC would have hit at IMPLEMENT time without it, and recommends a coherent architecture with brutally-honest confidence bounds. Ready for SPEC dispatch.

---

## Commit-hash verification (DEC-179 / ORCH-0959 mandatory)

| Claimed-changed file | Commit on per-ORCH branch | Status |
|---|---|---|
| `Mingla_Artifacts/reports/RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | `bf7bd8db2` (verified via `git log --diff-filter=A`) | COMMITTED |
| `Mingla_Artifacts/WORKTREE_REGISTRY.md` (phase column update) | `bf7bd8db2` (same commit) | COMMITTED |
| `Mingla_Artifacts/prompts/FORENSICS_RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | `95861d93e` (INTAKE commit) | COMMITTED (force-add since prompts/ is gitignored, precedent ORCH-0964) |
| `COMMS_LEDGER.md` (forensics+claude ORCH-0978 RESEARCH ack on COMMS-0003) | `3bc73c62e` on `main` (orchestrator commit, local, push pending) | COMMITTED LOCALLY — push pending operator |

`git status --short` in the per-ORCH worktree shows zero uncommitted files (other than expected `node_modules` symlinks). Gate PASSES.

---

## Dependency walk (DEC-179 / ORCH-0959 mandatory)

This was a RESEARCH phase. **Zero config-layer files changed.** No diff in `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `expo.json`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, or `.github/scripts/**`. Dependency walk N/A. Gate PASSES.

---

## REVIEW checklist

- [x] **Recommendation supported by evidence?** YES — 35 inline-cited primary sources across Cloudinary docs (12), Supabase docs (3), Expo + RN docs (10), FFmpegKit retirement (2), browser autoplay policies (3), industry engineering blogs (4), UX patterns (3), Apple community (2), self/repo (5). Citation format compliant with COMMS-0003 throughout.
- [x] **Scope appropriate — could be narrower?** NO — research is correctly scoped to the single dispatch goal. Workstreams A (video-everywhere inventory) and C (Cloudinary lifecycle) are explicitly out of scope per the dispatch and the report respects that boundary.
- [x] **Hidden fallback paths that mask failure?** NONE found. The optimistic-local-preview pattern IS a deliberate fallback for the perceived-30s pivot — clearly labeled as such in the executive recommendation and §5 architecture diagram, not hidden.
- [x] **Real fix vs symptom mask?** REAL FIX. The recommendation identifies the root cause (raw upload bytes are the bottleneck for the 30s budget — naïve 30s 1080p iPhone clip = ~60 MB = 96 seconds at 5 Mbps) and addresses it (pre-compress on device cuts bytes ~85%). Not a UX-only patch.
- [x] **Constitutional compliance?** PASSES rules 3 (no silent failures — Q8 covers webhook/transcode/timeout failure surfaces), 9 (no fabricated data — the report flags `[BENCHMARK NEEDED]` where it can't cite, doesn't invent numbers), 12 (validate at right time — Cloudinary signature verification is server-side webhook, not client).
- [x] **Evidence chain complete?** YES — every Q1-Q8 synthesis ends with a numbered "Citations" sub-list; bibliography in §8 is organized by category; cross-references to existing source code (file:line) are accurate.
- [x] **Brutal honesty?** YES — three clear examples: (a) explicit `[BENCHMARK NEEDED]` markers in the latency table where Cloudinary doesn't publish per-clip numbers, (b) MEDIUM confidence rating with the math shown rather than HIGH-by-default, (c) Q1-B flags react-native-compressor's iOS-cross-playability bug as an unresolved SPEC-time risk rather than papering over it.
- [x] **Documents updated?** YES — registry phase column updated to "RESEARCH REVIEW", report committed, dispatch prompt committed.
- [x] **External-API docs cited inline per COMMS-0003?** YES — every Cloudinary parameter, every webhook header, every expo-video API call cites a URL inline.

---

## Three load-bearing findings the SPEC would have hit at IMPLEMENT without this research

1. **FFmpegKit is RETIRED** — binaries removed from CocoaPods/Maven/npm April 1, 2025; repo archived June 23, 2025 [cited: https://tanersener.medium.com/saying-goodbye-to-ffmpegkit-33ae939767e1]. If SPEC had defaulted to "use ffmpeg-kit-react-native" it would have failed at first npm install. The research correctly pivots to `react-native-compressor` v1.18.2 (May 2026, actively maintained).

2. **`expo-av` REMOVED in Expo SDK 55** (released 2026) — must use `expo-video` [cited: https://swmansion.com/blog/the-future-of-video-in-react-native-moving-from-expo-av-to-expo-video-6f4f78e51196/]. Any code still importing from `expo-av` is dead. SPEC must verify Mingla's current Expo SDK version and may need a migration pass before or during IMPLEMENT.

3. **Cloudinary INCOMING transformation is a trap** — synchronous-only, holds upload connection during transcode, risks 60–120s cellular NAT timeouts [cited: https://cloudinary.com/documentation/eager_and_incoming_transformations]. The intuitive "do everything in one round-trip" architecture would have ended up with failed mobile uploads. Research correctly recommends KEEPING the current `eager_async + webhook` pattern and attacking the budget via pre-compression instead.

---

## Two non-blocking concerns (SPEC-time follow-ups, not REVIEW gates)

- **Q1-A empirical benchmark gap** — research correctly notes that real-world `react-native-compressor` time-to-compress on Mingla's typical inputs is not published. SPEC should require a hands-on PoC measurement on iPhone 13/16 Pro + Pixel 6/Galaxy S22 before locking the §3 latency budget numbers.
- **Q4-A current Expo SDK version unverified** — research deferred to a `package.json` grep at SPEC Phase 0. This is fine as a phase boundary but should be the SPEC author's very first read (treat as Phase 0 mandatory ingest).

Neither rises to NEEDS WORK. Both are explicitly listed in §7 Open Questions and routed to SPEC.

---

## What the SPEC must produce

Per dispatch §"Downstream routing": SPEC dispatch (same forensics skill, SPEC mode) codifies this architecture into a binding contract. The SPEC should cover:

- **Layered specification** (database / edge fn / service / hook / component) per the standard Phase 3 SPEC template.
- **Cross-Surface Impact section (Phase 2.5 MANDATORY)** declaring all 5 primary + 2 adjacent surfaces with per-surface success criteria (SC-N-iOS, SC-N-Android, SC-N-Web format).
- **Inline Cloudinary docs URLs** for every parameter and webhook payload field (COMMS-0003 binding).
- **Operator gate on IMPLEMENT timing** — explicit clause: SPEC may be APPROVED, but IMPLEMENT dispatch is GATED on ORCH-0964 [Public-page theme customization] PR merging to main (avoid collision on `mingla-business/src/components/brand/` + `packages/event-rendering/` + the new `packages/brand-rendering/`).
- **Q1-A PoC clause** — SPEC includes a "measure real-world compression on iPhone 13/16 Pro + Pixel 6/Galaxy S22" pre-IMPLEMENT acceptance criterion, with a fallback path (per-platform native AVAssetExportSession/MediaCodec custom modules) if react-native-compressor benchmarks don't meet the 5–15s assumption.

---

## Approval

**REVIEW VERDICT: APPROVED.** Forensics is cleared to write the SPEC.
