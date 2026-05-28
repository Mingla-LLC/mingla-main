# ORCHESTRATOR REVIEW — ORCH-0978 INVESTIGATION (iOS native-trim 30s cap UX gap)

**Reviewer:** Claude `mingla-orchestrator`
**Artifact reviewed:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` (commit `38b195dd0`, 253 lines, by Codex `mingla-forensics`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-27

---

## Verdict — APPROVED

The investigation correctly diagnoses the SPEC-vs-reality mismatch, names the precise file:line where the toast fires, gives honest confidence levels, and stays out of SPEC/implementation territory. All 8 findings hold up against spot-checks. Operator decision is now framed cleanly with 6 fix-shape options.

---

## Commit-hash verification (DEC-179 / ORCH-0959)

| Claimed artifact | Commit | Status |
|---|---|---|
| `INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` | `38b195dd0` (sole commit "Investigate ORCH-0978 iOS trim UX gap") | COMMITTED |

`git status --short` clean (no uncommitted scope files). Gate PASSES.

---

## Dependency walk (DEC-179 / ORCH-0959)

**N/A.** This is an INVESTIGATE phase; zero product code or config touched. No tsconfig, package.json, app.json, workflow, or script changes in the commit. Investigation report is the only deliverable.

---

## Spot-check verification of load-bearing code claims

I read the actual source against the forensics quotes:

| Forensics claim | Spot-check | Result |
|---|---|---|
| Picker config at `CoverPicker.tsx:419-426`: `mediaTypes: ["videos"], allowsEditing: true, videoMaxDuration: 30, preferredAssetRepresentationMode: Compatible, quality: 1` | Verbatim match — lines 419-426 | CONFIRMED |
| Toast trigger at `CoverPicker.tsx:434-435`: `durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250` → `"Please trim to 30 seconds first."` | Verbatim match — lines 433-435 | CONFIRMED |
| Constant `EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000` at `eventCoverVideoProcessingService.ts:16-21` | Verbatim match — line 17 | CONFIRMED |
| Normalization `duration > 0 && duration < 1000 ? duration * 1000 : duration` at `CoverPicker.tsx:404-407` | Verbatim match — lines 404-408 | CONFIRMED |

No invented quotes. All file:line citations are real.

---

## REVIEW checklist

- [x] **All 8 findings present?** YES (F-1 through F-8). Each has classification, severity, confidence, evidence, five-truth check, and finding statement.
- [x] **Five-truth-layer matrix present?** YES (§4). All 5 layers populated with verified-truth statements and per-layer confidence.
- [x] **External citations per COMMS-0003?** YES — inline URLs for: Expo `videoMaxDuration` docs (https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions), Apple `UIImagePickerController` (https://developer.apple.com/documentation/uikit/uiimagepickercontroller), Apple `UIVideoEditorController.videoMaximumDuration` (https://developer.apple.com/documentation/uikit/uivideoeditorcontroller/videomaximumduration), community StackOverflow reports (https://stackoverflow.com/questions/72854873/, https://stackoverflow.com/questions/10321254/), TikTok/Instagram industry reference (https://tiktoktip.com/..., https://www.howtogeek.com/684818/...). All claims about external library/platform behavior are URL-backed.
- [x] **No-SPEC / no-code compliance?** YES. F-7 fix-shape "Options to evaluate later, after orchestrator review" — explicitly labeled as sketches not SPEC. §8 fix-shape table is option-comparison, not a binding contract. Zero product-code edits in the commit.
- [x] **Confidence honesty?** YES — investigation explicitly downgrades F-5 to "Medium" because the exact rejected `asset.duration` was never logged, and F-8 calls out "High static / Low runtime". This matches the memory rule on physical-device-only confidence ceilings.
- [x] **Six-field root cause proof present?** YES (§7) — file/line + exact code + current behavior + expected behavior + causal chain + verification step.
- [x] **Comms ack?** YES — section §3 cites pushed anchor commit `d12aca255` with `mingla-forensics+codex (ORCH-0978 TRIM UX GAP)` appended to COMMS-0002/0003/0004.

---

## Two strengths to call out

1. **The investigation correctly separates SPEC over-promise from implementor mistake.** F-1 confirms the implementor's picker config matches SPEC AMENDMENT 1 exactly. The bug is in SPEC A1's assumption that `videoMaxDuration: 30 + allowsEditing: true` gives a "frictionless hard guarantee" — Expo + Apple docs don't actually promise that. This is exactly what a Phase 0 SPEC review SHOULD have caught two amendments ago but didn't. Forensics did the audit and found the right culprit.

2. **The Apple-side primitive distinction is rigorous.** F-4 distinguishes `UIImagePickerController.videoMaximumDuration` (the picker property Expo wires) from `UIVideoEditorController.videoMaximumDuration` (the separate editor cap). Most investigations conflate these two; this one cites both Apple URLs separately. Material because it explains why iOS shows a trim screen but doesn't expose duration HUD properties to library wrappers.

---

## One minor gap (non-blocking)

The investigation does not have direct evidence of the exact rejected `asset.duration` value — operator's physical-iPhone repro happened, but the picker code at line 430-435 doesn't log the rejected duration before showing the toast. F-5 is explicit about this limitation ("This needs one live log of `asset.duration` to confirm"). 

**Implication for the eventual fix:** if Option A (wider tolerance) is chosen, we'd want to know whether typical overshoots are ~300ms or ~5000ms before picking a number. Forensics correctly defers this to "one instrumented physical-iPhone repro" — which is a 1-line code change (add `console.log("[ORCH-0978-TRIM-DURATION]", durationMs);` before the rejection line). Cheap to add.

This is NOT a NEEDS-WORK condition — the investigation is honest about its evidence ceiling.

---

## Operator decision now framed

The investigation hands operator three paths (per dispatch §"Downstream routing"):

| Path | Description | Recommendation rationale |
|---|---|---|
| **P1 — SPEC fix into IMPLEMENT-2** | Forensics writes SPEC AMENDMENT for one of F-7 options A/B/C/D, implementor reworks, tester re-runs, CLOSE proceeds with proper fix in place. Delays close ~1 day. | Best for product quality. Recommended if the trim gap is hitting real-user frustration. |
| **P2 — Ship with known issue + follow-up ORCH** | CLOSE ORCH-0978 with the compression/upload/render work as-is (which IS green); register ORCH-NNNN for the trim UX redesign (forensics F-7 Option C or D as the SPEC starting point). | Best for shipping the 80% wins now. Trim UX gap affects only users picking >30s sources; ≤30s clips work fine per live PoC. |
| **P3 — Amend SPEC A1 to describe iOS reality** | No UX fix; just rewrite SPEC AMENDMENT 1 prose to honestly describe "iOS native trim + post-pick validation" instead of "frictionless hard cap." Ship ORCH-0978 with the gap accepted permanently. | Documentation-only; doesn't help users. Use only if operator decides the gap is acceptable forever. |

**Strong orchestrator recommendation: P2 (ship + follow-up ORCH) with one preflight tweak.**

Reasons:
- ORCH-0978's main contracts (sub-30s compression, optimistic preview, shared render package, edge fn deploy) are all validated and green
- The trim UX gap is real but bounded — only triggers when user picks >30s source AND iOS trim returns >30.25s
- Forensics F-7 Options C ("post-pick confirmation with measured duration") and D ("custom in-app trim sheet") both need real design + cross-platform QA — they're a future ORCH, not a SPEC amendment to this one
- The 1-line tolerance bump (F-7 Option A) PLUS measured-duration error copy (F-7 Option B) is a tiny IMPLEMENT-2 if Seth wants an immediate softening — could ship in ~30 min

**Preflight tweak before P2:** ask the implementor to add ONE diagnostic line (`console.log("[ORCH-0978-TRIM]", durationMs)` before the rejection at `CoverPicker.tsx:434`) so the follow-up ORCH has real-device data to size the proper fix. Zero behavior change, pure observability.

If operator prefers immediate fix: P1 with F-7 Options A+B combined (tolerance bump from 250ms to ~1000ms + show measured duration in error copy). That's a 5-line implementor change, no SPEC scope expansion, tester re-runs the live-fire, CLOSE next day.

---

## Approval and routing

**REVIEW VERDICT: APPROVED.** Forensics investigation is sound. Operator decision required to pick P1, P2, or P3. Default recommendation P2 + preflight observability tweak.
