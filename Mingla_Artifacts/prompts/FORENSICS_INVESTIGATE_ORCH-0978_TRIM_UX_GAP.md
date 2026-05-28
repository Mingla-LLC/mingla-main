# FORENSICS DISPATCH — ORCH-0978 INVESTIGATE — iOS native-trim 30s cap UX gap

**Target skill:** Claude `mingla-forensics`
**Mode:** INVESTIGATE (no SPEC, no code)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Trigger:** live-fire finding 2026-05-27 during orchestrator-owned T-11 runtime test on physical iPhone

---

## The reproducer (operator, verbatim)

> "If I select a video that is more than 30 seconds long, the trim appears, auto snaps I think, but I can't even see how many seconds it's snapped to, but I reduce till the error goes away, which is a UX gap, AND I still get the toast."

Three distinct symptoms in one report:

**Symptom A — invisible selection length.** When the iOS native trim screen appears (because the user picked a >30s clip), there is NO on-screen indication of how many seconds the current trim window represents. User cannot tell if they're at 28s or 35s.

**Symptom B — iOS auto-snap is unclear / non-deterministic.** Operator says "auto snaps I think" — meaning iOS may or may not be enforcing the `videoMaxDuration: 30` cap on the slider, but the behavior is unclear from the UI.

**Symptom C — toast STILL fires after operator reduces selection.** Even after the operator drags the trim handles inward to what they believe is ≤30s, the post-pick service rejects with the "Please trim to 30 seconds first" toast. So either iOS returned >30s despite the slider position OR the post-pick duration-check is off by a small margin OR the metadata duration of the returned clip is misreporting.

For clips ≤30s without trim: works fine (we proved compression + upload + iOS native playback path operate correctly).

---

## What the SPEC + amendments claim should happen

Per SPEC AMENDMENT 1 §"How it works per platform" (2026-05-26):

> **iOS:** `expo-image-picker.launchImageLibraryAsync` supports `videoMaxDuration: 30` + `allowsEditing: true`. The user picks ANY-length clip → iOS shows its native trim screen with a 30-second window slider → returns ONLY the trimmed 30s slice. No rejection. No friction.

So per SPEC intent: iOS should HARD-ENFORCE the 30s cap at the slider. The post-pick rejection toast is supposed to be a fallback for Android (where `videoMaxDuration` is best-effort) and web (no native trim). The toast firing on iOS is unintended.

---

## Investigation scope

### Phase 0 mandatory ingest

1. `mingla-business/src/components/ui/CoverPicker.tsx` (the picker component the implementor refactored — 225 lines added per IMPLEMENTATION report §6) — find the exact `launchImageLibraryAsync` call site, capture the full options object passed, line numbers.
2. `mingla-business/src/services/eventCoverVideoProcessingService.ts` — find the post-pick duration check that fires the toast. Capture the exact comparison (`duration > 30000` vs `>= 30000`, what units, where source duration comes from).
3. `mingla-business/src/hooks/useEventCoverVideoUpload.ts` — find how it routes the picker output into the upload flow and where the toast is triggered from. Trace the "Please trim to 30 seconds" copy back to its origin file/line.
4. The SPEC's stated contract: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §"SPEC AMENDMENT 1" — what exact picker config did SPEC mandate? Does the implementor's actual code match SPEC, or did the implementor mis-translate?
5. The IMPLEMENTATION report's traceability row §8 "A1 single 30s cap via native trim" — claims `allowsEditing: true`, `videoMaxDuration: 30`. Verify against actual source.

### External research required (cite URLs inline per COMMS-0003)

1. **`expo-image-picker` docs for `videoMaxDuration`** — what does the official Expo doc say about iOS enforcement? Is it documented as HARD-cap on the slider, or as a "max input duration before pick rejection"? https://docs.expo.dev/versions/latest/sdk/imagepicker/
2. **Apple `UIImagePickerController` `videoMaximumDuration` property** — Apple's underlying primitive. Does it cap the trim slider or the source clip? https://developer.apple.com/documentation/uikit/uiimagepickercontroller/videomaximumduration
3. **Known `expo-image-picker` GitHub issues** for `videoMaxDuration` + `allowsEditing` interaction on iOS — search recent issues + community reports. Likely candidates: trim slider doesn't constrain, duration overshoot due to keyframe boundaries, metadata vs container-duration mismatch, etc.
4. **Industry reference for "trim duration HUD"** — how do TikTok / Instagram Reels / Capcut show the user "you've selected X.Y seconds" on their custom trim sheets? Apple's native trim UI famously has NO duration label — is that the root cause, or is there a setting to enable it?

### Five-truth-layer cross-check

| Layer | What to verify |
|---|---|
| **Docs** | SPEC AMENDMENT 1 vs the actual `expo-image-picker` doc — does the SPEC's claim match the library's documented behavior? |
| **Schema** | Server-side `MAX_DURATION_MS = 30000` in `_shared/eventCoverVideo.ts` — confirm this is the cap the post-pick service compares against. |
| **Code** | Actual picker config — `allowsEditing: true` + `videoMaxDuration: 30` (seconds) on `launchImageLibraryAsync`. Verify the post-pick duration extraction logic. |
| **Runtime** | Operator-observed behavior (Symptoms A, B, C). Read iOS sim logs or live device logs if Maestro / live-fire can capture the picker's returned `ImagePickerAsset.duration` value for a clip the operator believed was ≤30s but was rejected. |
| **Data** | DB row for the stuck-job `f1e0d876-2843-442d-bc8e-e80ae5f9d88e` shows `source_duration_ms: 15520` — that one was ≤30s and got through. The investigation needs evidence of a job that was REJECTED at the picker stage so it never reached DB at all. Suggest operator repro with screen recording. |

### Required findings (numbered F-#)

- **F-1 — Picker config audit.** Quote the exact options object in CoverPicker.tsx's `launchImageLibraryAsync` call. Compare to SPEC AMENDMENT 1's mandated config. Does the implementor's code match?
- **F-2 — Post-pick duration check logic.** Quote the exact comparison + units + threshold. Is it 30000ms or 30s or 30001ms? Does it use the asset's `duration` field, the file metadata, or a re-stat?
- **F-3 — Toast trigger trace.** Where does "Please trim to 30 seconds first" copy live? What state path leads from picker return → toast?
- **F-4 — `expo-image-picker` iOS reality.** What does the library actually do on iOS when `videoMaxDuration: 30` + `allowsEditing: true` is set? Does it hard-cap the slider or merely accept any slider selection? Cite Apple docs + Expo docs + at least one community confirmation.
- **F-5 — Why the toast fires on a "reduced" selection.** Hypothesize root causes: (a) iOS returns clip with `duration` slightly >30s due to keyframe alignment (e.g., 30.04s), (b) post-pick check uses wrong field, (c) iOS trim slider isn't honoring `videoMaxDuration` at all and user is exceeding 30s without realizing. Rank likelihood with evidence.
- **F-6 — UX gap root cause for Symptom A (no duration HUD).** Is this an Apple platform limitation (native UIImagePickerController trim UI has no duration display) or an Expo wrapper limitation? Can we work around with a custom in-app trim sheet? Cite library options.
- **F-7 — Fix shape recommendations** (investigation-level only, not SPEC — just sketch directions for the eventual SPEC amendment). Options to evaluate: (i) tighten post-pick tolerance to allow +1s overshoot from keyframe alignment, (ii) add a custom in-app trim sheet that DOES show duration (significant scope), (iii) better post-pick error copy that says "your trimmed clip was X.Y seconds — trim closer to 30", (iv) accept the gap and document it.
- **F-8 — Cross-platform parity.** Does the same gap exist on Android? On web? Note tester's prior QA evidence on Android trim behavior.

### Hard guards

- **Investigation only.** No code changes. No SPEC writing. No fix execution.
- **External claims cite URLs inline** per COMMS-0003.
- **No live-fire required this turn** — the reproducer is already proven by operator. Source + doc reading is sufficient for F-1 through F-7. F-8 (Android parity) may need a re-read of QA_RETEST report.
- **No new ORCH-ID.** This is a finding within ORCH-0978's scope.
- **Output a report, not a fix.**

### Expected output

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` with sections:

1. Executive summary (4-6 sentences, plain English).
2. The three symptoms restated.
3. Phase 0 ingest log (files + lines read).
4. Five-truth-layer matrix.
5. Findings F-1 through F-8 with evidence (file paths + line numbers + URLs).
6. Root cause classification per finding (🔴 / 🟠 / 🟡 / 🔵).
7. Fix-shape options (sketch, not SPEC).
8. Confidence rating (H/M/L) per finding.

### Downstream routing

After this INVESTIGATE returns:
1. Orchestrator REVIEW.
2. If APPROVED, decide with operator: (a) SPEC a fix into ORCH-0978's IMPLEMENT-2 (delays close), (b) ship ORCH-0978 with this gap as known issue + register a follow-up ORCH for the fix, (c) accept the gap permanently and update SPEC AMENDMENT 1 to honestly describe the iOS reality.

### Operator awareness

The runtime PoC is still in flight. The other T-11/T-12 captures (Cloudinary URL, iPhone playback, Safari iOS, Android cold-load) are paused while this investigation runs. The orchestrator will resume runtime capture once forensics returns the report.
