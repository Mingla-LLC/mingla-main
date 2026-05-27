# INVESTIGATION — ORCH-0978 iOS native-trim 30s cap UX gap

**Mode:** INVESTIGATE only — no SPEC, no code changes  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`  
**Trigger:** operator physical-iPhone live-fire on 2026-05-27 during ORCH-0978 T-11 runtime proof  
**Output:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md`

---

## 1. Executive summary

The implementation matches SPEC AMENDMENT 1 at the picker call site: `launchImageLibraryAsync` is called with `mediaTypes: ["videos"]`, `allowsEditing: true`, and `videoMaxDuration: 30`. The gap is that the SPEC over-promised what the iOS native trim UI makes legible to the user: Expo/Apple expose a native editing surface and duration cap hooks, but neither gives Mingla a visible "selected duration is X.Y seconds" HUD or a deterministic user-facing confirmation that the returned slice is <=30 seconds. Mingla then performs a strict post-pick check against `asset.duration`, with only a 250ms tolerance, and rejects anything above 30.25s with the generic toast `"Please trim to 30 seconds first."` That explains why the operator can reduce the handles, still not know the exact selected length, and still see the toast after returning from native trim. This is a UX gap with a possible small-tolerance/metadata edge, not evidence that compression/upload/render are broken.

---

## 2. The three symptoms restated

1. **Symptom A — invisible selection length.** The iOS native trim screen did not show how many seconds were currently selected, so the operator could not tell whether the selected range was 28s, 30s, or 35s.
2. **Symptom B — unclear auto-snap.** The operator saw behavior that looked like an auto-snap, but the native UI did not make it clear whether iOS had constrained the range to exactly 30s.
3. **Symptom C — late rejection toast.** After reducing the trim selection, the app still showed `"Please trim to 30 seconds first."`, meaning the returned `ImagePickerAsset.duration` was still above Mingla's current 30.25s client threshold or was reported that way.

---

## 3. Phase 0 ingest log

| File / source | Lines read | Why it matters |
|---|---:|---|
| `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` | Active entries | COMMS-0002, COMMS-0003, COMMS-0004 were open WARN entries applying to ALL; acknowledged by `mingla-forensics+codex (ORCH-0978 TRIM UX GAP)` in pushed anchor commit `d12aca255`. |
| `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_ORCH-0978_TRIM_UX_GAP.md` | 1-119 | Full dispatch, required findings F-1..F-8, external-doc citation requirement, no-SPEC/no-code guard. |
| `mingla-business/src/components/ui/CoverPicker.tsx` | 1-620 | Picker call, duration normalization, client-side toast, upload routing. |
| `mingla-business/src/services/eventCoverVideoProcessingService.ts` | 1-860 | 30s constants, upload/compression path, error copy mapping, source-duration request path. |
| `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | 1-185 | How picker output enters compression/upload/intent flow and where no extra trim validation occurs. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | 1-260 plus searched later sections | SPEC AMENDMENT 1 single-30s cap claim and server-side defense. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | 1-240 | Traceability row §8 claims A1 picker cap implemented. |
| `Mingla_Artifacts/reports/QA_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | 1-225 | Initial QA evidence: A1 static pass, runtime picker flow not live-fired. |
| `Mingla_Artifacts/reports/QA_RETEST_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | 1-205 | Retest evidence: runtime T-11/T-12 still missing; A1 static pass cites `CoverPicker.tsx:420-435`. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_2_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | 1-104 | Latest rework state: no code changes, physical device proof blocked. |
| `Mingla_Artifacts/reports/qa-orch-0978-runtime/...` | device probe files | Confirms no repository-owned rejected-picker job evidence exists; rejected assets never reach DB. |
| `supabase/functions/_shared/eventCoverVideo.ts` | 1-340 | Schema/server truth: `MAX_DURATION_MS=30000`, `MAX_SOURCE_VIDEO_DURATION_MS=60000`, processed derivative must be <=30000ms. |
| `supabase/functions/event-cover-video-upload-intent/index.ts` | 100-250 | Edge validates `sourceDurationMs <= 60000`, persists `source_duration_ms`, and uses a <=30000ms eager duration budget. |
| `mingla-business/node_modules/expo-image-picker` | iOS/Android implementation and TS types | Proves Expo maps `videoMaxDuration` to `UIImagePickerController.videoMaximumDuration` on iOS and returns `duration` in ms from AVAsset duration. |
| External docs and community reports | URLs inline below | Required by COMMS-0003 for Expo/Apple/community claims. |

Memory read: `MEMORY.md`, `feedback_external_api_docs_verified.md`, `feedback_worktree_per_orch_workflow.md`, `feedback_response_2_section_universal.md`, and `feedback_forensic_thoroughness.md`. Relevant constraints: external docs must be cited, work must stay in the ORCH worktree, and source-only investigation should label runtime gaps honestly.

---

## 4. Five-truth-layer matrix

| Layer | Verified truth | Confidence |
|---|---|---|
| **Docs** | SPEC AMENDMENT 1 says iOS returns only the trimmed 30s slice with "No friction, no rejection" (`SPEC...:16-21`). Expo docs say `videoMaxDuration` is the maximum duration "for video recording", with iOS editing capped to 10 minutes and Android/web caveats, not a documented library-trim HUD contract: https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions. Apple documents `UIImagePickerController.videoMaximumDuration` under video recording on `UIImagePickerController`, while `UIVideoEditorController.videoMaximumDuration` says the editor forces a loaded movie to fit before saving: https://developer.apple.com/documentation/uikit/uiimagepickercontroller and https://developer.apple.com/documentation/uikit/uivideoeditorcontroller/videomaximumduration. | High for docs mismatch; medium for exact native-UI behavior because Apple's web docs are sparse and native UI is closed-source. |
| **Schema / server** | Edge shared helper sets `MAX_DURATION_MS` default `30000` and source-defense default `60000` (`_shared/eventCoverVideo.ts:17-28`). Upload intent rejects `sourceDurationMs > MAX_SOURCE_VIDEO_DURATION_MS` and validates trim range (`event-cover-video-upload-intent/index.ts:120-145`). Processed derivative validation rejects `durationMs > MAX_DURATION_MS` (`_shared/eventCoverVideo.ts:312-315`). | High. |
| **Code** | Picker calls `launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: true, videoMaxDuration: 30, preferredAssetRepresentationMode: Compatible, quality: 1 })` (`CoverPicker.tsx:419-426`). It normalizes `asset.duration`, rejects `durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250`, and uses the generic toast (`CoverPicker.tsx:404-435`). Expo iOS code sets `picker.videoMaximumDuration = options.videoMaxDuration`, enables `picker.allowsEditing`, and caps edit mode at 600s (`ImagePickerModule.swift:131-142`). Expo reads edited-video duration from the picked edited URL when `allowsEditing` is true (`MediaHandler.swift:347-366`). | High. |
| **Runtime / tests** | Operator physical-iPhone live-fire proved symptoms A/B/C. Existing QA/retest artifacts did not live-fire the picker trim flow; they marked A1 static pass only and runtime proof missing (`QA_RETEST...:120-129`). No live log captured the rejected asset's returned `duration`. | Medium: symptom is operator-proven; exact returned duration is unobserved. |
| **Data** | Dispatch notes the successful stuck-job example `f1e0d876-2843-442d-bc8e-e80ae5f9d88e` had `source_duration_ms: 15520`, proving <=30s clips can pass. Rejected picker attempts never create `event_cover_video_jobs` rows because rejection happens before `videoUpload.start()`. Current runtime folders contain no rejected-picker job evidence and previous probes report zero usable video fixture rows. | Medium: accepted-row fact is dispatch-supplied; rejected-row absence follows code path and artifacts. |

---

## 5. Findings

### F-1 — Picker config audit

**Classification:** confirmed implementation-contract match  
**Severity:** 🔵 informational  
**Confidence:** High

**Evidence:** `CoverPicker.tsx:419-426` calls:

```ts
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ["videos"],
  allowsEditing: true,
  videoMaxDuration: 30,
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  quality: 1,
});
```

**Five-truth check:** Docs: SPEC AMENDMENT 1 requires `videoMaxDuration: 30` + `allowsEditing: true` (`SPEC...:16-21`). Schema: server cap remains 30s final / 60s source defense (`_shared/eventCoverVideo.ts:17-28`). Code: implementation matches the mandated picker flags. Runtime: operator saw iOS native trim appear, consistent with `allowsEditing: true`, but not with the promised "No friction, no rejection." Data: no row is written until this picker stage passes.

**Finding:** The implementor did not mistranslate the SPEC picker config. The mismatch is between the SPEC's assumption about iOS native-trim UX and what the native picker makes visible/guaranteed to the user.

---

### F-2 — Post-pick duration check logic

**Classification:** UX gap / likely bug edge  
**Severity:** 🟠 high  
**Confidence:** High for code, Medium for exact rejected value

**Evidence:** `EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000` lives in `eventCoverVideoProcessingService.ts:16-21`. The picker normalizes `asset.duration` with a defensive seconds-to-ms conversion (`CoverPicker.tsx:404-407`), then rejects if `durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250` (`CoverPicker.tsx:429-435`). Expo's local TS type says `ImagePickerAsset.duration` is "Length of the video in milliseconds" (`ImagePicker.types.ts:313-316`). Expo's iOS native code reads duration in milliseconds from an `AVURLAsset` (`VideoUtils.swift:19-25`), and for edited videos reads the edited picked URL when `allowsEditing` is true (`MediaHandler.swift:347-366`).

**Five-truth check:** Docs: Expo declares returned duration in ms and describes `videoMaxDuration` in seconds. Schema: final cap is exactly 30000ms. Code: client allows 30250ms, then blocks before compression/upload. Runtime: toast fired after the operator believed the clip was reduced. Data: rejected clips never reach DB; no `source_duration_ms` exists for the failing attempt.

**Finding:** The toast is driven by returned picker metadata, not by Cloudinary, compression, or server state. The current comparison gives only 250ms of slack; if the native editor returns a duration such as 30.3s due to frame/keyframe/export rounding, the client rejects it even though the user reasonably believes they selected "about 30s."

---

### F-3 — Toast trigger trace

**Classification:** confirmed UX gap  
**Severity:** 🟠 high  
**Confidence:** High

**Evidence:** The copy `"Please trim to 30 seconds first."` lives directly in `CoverPicker.tsx:434-435`. It fires after `launchImageLibraryAsync` returns and before `videoUpload.start()` is called (`CoverPicker.tsx:443-449`). `useEventCoverVideoUpload.start()` never sees this rejected asset; its first action would be setting local preview and compressing (`useEventCoverVideoUpload.ts:59-88`). The service's edge validation copy is different: `"Native trim did not return a valid 30-second clip. Trim again and retry."` for trim errors (`eventCoverVideoProcessingService.ts:270-273`).

**Five-truth check:** Docs: SPEC says iOS should have no rejection for trimmed clip. Schema: no row because no upload intent is created. Code: toast originates in component, not service/hook. Runtime: operator saw exactly this toast after reducing selection. Data: no DB row is expected for this rejection.

**Finding:** Symptom C is a component-stage rejection. Because the toast does not include the returned measured duration, it gives the user no way to understand whether the native trim returned 30.3s, 35s, an original-duration value, or another metadata anomaly.

---

### F-4 — `expo-image-picker` iOS reality

**Classification:** confirmed SPEC/docs mismatch + platform limitation  
**Severity:** 🟠 high  
**Confidence:** Medium-High

**Evidence:** Expo docs for `videoMaxDuration` say it is "Maximum duration, in seconds, for video recording," with iOS editing automatically limited to 10 minutes when `allowsEditing` is true, Android support dependent on the installed camera app, and Web no effect: https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions. Expo's actual SDK 54/17.0.11 iOS implementation sets `UIImagePickerController.videoMaximumDuration` to the passed option and uses the legacy `UIImagePickerController` path when `allowsEditing` is true (`ImagePickerModule.swift:94-98`, `131-145`). Apple exposes `UIImagePickerController.videoMaximumDuration` on the picker docs and describes `UIVideoEditorController.videoMaximumDuration` as the editor maximum for trimmed movies before saving: https://developer.apple.com/documentation/uikit/uiimagepickercontroller and https://developer.apple.com/documentation/uikit/uivideoeditorcontroller/videomaximumduration. Community reports align with "iOS gives a trim path while Android often does not," but also show developers relying on `allowsEditing` and still needing validation: https://stackoverflow.com/questions/72854873/why-expo-imagepicker-is-not-giving-me-an-option-to-trim-the-video-before-when-uploading-from-an-android-device-even-after-using-videomaxduration-30 and https://stackoverflow.com/questions/10321254/videomaximumduration-doesnt-limit-the-duration.

**Five-truth check:** Docs: Expo does not document a hard library-slider cap with a visible selected-duration HUD. Schema: server allows source <=60s, final <=30s. Code: Expo wires the native property, but Mingla still validates after return. Runtime: iOS trim appeared but was unclear. Data: only successful <=30s row evidence exists.

**Finding:** The SPEC sentence "iOS shows its native trim screen with a 30-second window slider → returns ONLY the trimmed 30s slice. No rejection. No friction" is stronger than the documented Expo contract. Expo/Apple support a native edit path and duration properties; they do not give Mingla a documented guarantee that the user will see exact selected duration or that Mingla should remove post-pick validation.

---

### F-5 — Why the toast fires on a "reduced" selection

**Classification:** likely bug / open runtime proof gap  
**Severity:** 🟠 high  
**Confidence:** Medium

**Ranked likelihoods:**

1. **Most likely: selected range remained above 30.25s because the native UI had no duration HUD.** The operator explicitly could not see the selected duration, and the toast fires only when `durationMs > 30250` (`CoverPicker.tsx:434-435`).
2. **Plausible: native export/duration metadata overshot 30s by more than 250ms.** Expo reads `AVURLAsset.duration` from the edited picked URL (`MediaHandler.swift:347-366`; `VideoUtils.swift:19-25`). Frame/timebase/export rounding can make a clip that feels visually "30s" report slightly over 30s. This needs one live log of `asset.duration` to confirm.
3. **Less likely: Mingla is using the wrong duration units.** Expo types and native code both indicate ms, and Mingla normalizes only suspicious sub-1000 values (`CoverPicker.tsx:404-407`).
4. **Less likely but possible: iOS trim did not honor `videoMaxDuration` for the selected-library path on this OS/device state.** Community reports show the behavior depends on `allowsEditing`, and Expo uses the legacy picker path correctly, but the native UI is closed-source and the operator's "auto snaps I think" report is not enough to prove hard enforcement.

**Five-truth check:** Docs: no exact guarantee on library-selected output precision. Schema: server would allow source <=60s, so this exact toast is client-only. Code: rejection path is exact and early. Runtime: missing `asset.duration` log is the key unknown. Data: failing attempt has no row.

**Finding:** The current evidence supports a UX/metadata mismatch more than a service-layer defect. The investigation cannot prove the exact root cause among the top two without one instrumented physical-iPhone repro that logs the returned `asset.duration`.

---

### F-6 — UX gap root cause for Symptom A (no duration HUD)

**Classification:** confirmed UX gap / platform limitation  
**Severity:** 🟠 high  
**Confidence:** High

**Evidence:** `expo-image-picker` options include `allowsEditing`, `videoMaxDuration`, `quality`, `videoExportPreset`, and related picker configuration, but no option for showing or customizing a selected-duration HUD (`ImagePicker.types.ts:404-522`; docs: https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions). Apple picker/editor docs expose duration cap properties, not UI customization for selected-duration labels: https://developer.apple.com/documentation/uikit/uiimagepickercontroller and https://developer.apple.com/documentation/uikit/uivideoeditorcontroller/videomaximumduration. Industry/social editors commonly make duration more legible through their own editing surfaces: TikTok/CapCut help-style reports describe selected portion duration changing as handles move (example: https://tiktoktip.com/trim-video-on-tiktok-and-easier-ways-to-do-it-on-desktop-and-mobile/), and Instagram/Reels guides describe explicit duration choices/progress/trim surfaces rather than relying on opaque system trim UI (example: https://www.howtogeek.com/684818/how-to-use-instagram-reels/).

**Five-truth check:** Docs: no Expo/Apple setting found for native duration HUD. Schema: unrelated. Code: Mingla does not own the native trim UI. Runtime: operator saw no duration. Data: no persisted evidence because this is pre-upload UI.

**Finding:** Symptom A is not fixable by toggling another known `expo-image-picker` option. A visible selected-duration HUD would require Mingla-owned UI after pick or a custom in-app trim surface/library, not the current native picker alone.

---

### F-7 — Fix-shape recommendations (investigation-level sketch only)

**Classification:** production decision options, not SPEC  
**Severity:** 🟡 medium  
**Confidence:** Medium

**Option shapes to evaluate later, after orchestrator review:**

1. **Tolerance / boundary option:** evaluate whether a wider post-pick tolerance, paired with server/final derivative validation, safely absorbs native export rounding. Risk: accepting too much above 30s undermines the product cap unless Cloudinary/server later clamps or rejects with clear copy.
2. **Better rejection-copy option:** keep the native picker, but make the post-pick rejection honest by showing the returned measured duration, e.g. the user learns the returned clip was 31.2s instead of seeing a generic instruction. Risk: still asks the user to use an opaque native trim UI.
3. **Post-pick confirmation option:** after native return, show an in-app confirmation state with measured duration before upload. Risk: adds a step but avoids mystery.
4. **Custom trim-sheet option:** replace or augment native trim with Mingla-owned trim UI that shows selected duration and enforces the cap visibly. Risk: largest scope; likely requires a dedicated video-trimming package/native module and new cross-platform QA.
5. **Known-issue/documentation option:** ship ORCH-0978 with the iOS native-trim UX gap documented, then register a follow-up. Risk: users may still hit the same frustration in production.
6. **Spec-honesty option:** amend SPEC AMENDMENT 1 to say iOS offers native trim plus post-pick validation, not a frictionless hard guarantee. Risk: does not improve UX, but removes false product claims.

**Five-truth check:** Docs: native picker does not expose enough UI control for a HUD. Schema: final 30s invariant remains server-owned. Code: current implementation has a natural post-pick validation point. Runtime: the operator pain is concentrated between native picker return and toast. Data: no rejected rows means any observability addition must happen client-side before upload.

**Finding:** The safest next step is a product/orchestrator choice, not immediate code. The options trade scope against honesty: copy/tolerance is small; custom trim is the only option that fully solves the invisible-duration UX.

---

### F-8 — Cross-platform parity

**Classification:** confirmed platform-parity gap  
**Severity:** 🟡 medium  
**Confidence:** High for static code/docs, Low for runtime parity because live-fire was not run

**Evidence:** Expo docs say Android effect depends on installed camera app and Web has no effect: https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions. The installed Expo Android source applies `allowsEditing` crop only when the picked asset is an image (`ImagePickerModule.kt:209-217`) and passes `MediaStore.EXTRA_DURATION_LIMIT` only for camera capture (`CameraContract.kt:32-38`), not library-picked videos. A community Expo report describes iOS offering a trim path while Android accepts longer uploads under the same `videoMaxDuration: 30` config: https://stackoverflow.com/questions/72854873/why-expo-imagepicker-is-not-giving-me-an-option-to-trim-the-video-before-when-uploading-from-an-android-device-even-after-using-videomaxduration-30. QA retest says A1 is static-pass only and runtime picker flow was not live-fired (`QA_RETEST...:120-129`).

**Five-truth check:** Docs: Android/web are explicitly weaker than iOS. Schema: server source-defense protects up to 60s, final derivative <=30s. Code: Android library video trim is not implemented in Expo's Android editing branch; web no native trim. Runtime: Android/web fallback rejection has not been live-fired in current QA artifacts. Data: rejected assets never reach DB.

**Finding:** The exact invisible-duration native iOS HUD gap is iOS-specific, but the broader "user cannot reliably produce a <=30s clip inside Mingla" gap exists across Android and web in different forms. Android/web are already documented as fallback-rejection paths; iOS should now be treated as "native trim plus validation" rather than "hard frictionless cap."

---

## 6. Root-cause classification summary

| Finding | Classification | Severity | Confidence |
|---|---|---|---|
| F-1 | confirmed implementation-contract match | 🔵 informational | High |
| F-2 | UX gap / likely bug edge | 🟠 high | High code / Medium runtime |
| F-3 | confirmed UX gap | 🟠 high | High |
| F-4 | confirmed SPEC/docs mismatch + platform limitation | 🟠 high | Medium-High |
| F-5 | likely bug / open runtime proof gap | 🟠 high | Medium |
| F-6 | confirmed UX gap / platform limitation | 🟠 high | High |
| F-7 | production decision options, not SPEC | 🟡 medium | Medium |
| F-8 | confirmed platform-parity gap | 🟡 medium | High static / Low runtime |

---

## 7. Six-field root cause proof

| Field | Proof |
|---|---|
| File/line | `CoverPicker.tsx:419-435`; `ImagePickerModule.swift:131-142`; `MediaHandler.swift:347-366`; `VideoUtils.swift:19-25`; `_shared/eventCoverVideo.ts:17-28`; `event-cover-video-upload-intent/index.ts:120-145`. |
| Exact code/schema | Picker passes `allowsEditing: true`, `videoMaxDuration: 30`; client rejects `durationMs > 30_000 + 250`; Expo returns duration from AVAsset in ms; edge final cap is 30000ms and source defense cap is 60000ms. |
| Current behavior | iOS native trim opens, but it does not show selected duration; after user adjusts handles, returned `asset.duration` can still trip the client toast. |
| Expected behavior | SPEC AMENDMENT 1 expected iOS to return a <=30s slice without friction or rejection. |
| Causal chain | SPEC overpromises native iOS trim determinism -> app relies on native UI for user-facing cap -> native UI does not expose selected duration -> app validates returned metadata after the user leaves native UI -> generic toast fires if metadata exceeds 30.25s -> user sees a late, unexplained rejection. |
| Verification step | One physical-iPhone repro with a >30s video should log `asset.duration`, selected source duration if available, and whether the toast fires. Expected proof: failing case returns `asset.duration > 30250` or reveals a metadata anomaly. No live-fire is required for this investigation, but that one log is required before a precise fix SPEC can rank tolerance vs UI. |

---

## 8. Fix-shape options (not a SPEC)

| Option | Shape | Upside | Risk / cost |
|---|---|---|---|
| A | Accept a measured overshoot tolerance larger than 250ms, while preserving server/final derivative validation. | Smallest code change if physical logs show tiny overshoot. | Could silently allow over-30s source clips unless paired with final enforcement and honest copy. |
| B | Include returned duration in rejection copy. | Makes the current fallback understandable. | Does not solve native-trim opacity. |
| C | Add post-pick confirmation / measured-duration screen before upload. | Gives user a Mingla-owned duration readout without full custom trim. | Adds friction after native picker. |
| D | Build/buy custom in-app trim sheet with visible selected-duration HUD. | Fully solves Symptom A and makes enforcement legible across platforms. | Largest scope; native-module/runtime QA required. |
| E | Ship ORCH-0978 with known issue and follow-up ORCH. | Avoids delaying the already-green compression/render work. | Leaves a real operator-hit UX gap in production. |
| F | Amend SPEC AMENDMENT 1 to describe actual iOS reality. | Restores artifact honesty. | Documentation-only; no user improvement. |

---

## 9. Confidence and remaining unknowns

**Overall confidence:** Medium-High. The source/docs chain is strong, and the operator symptom matches the current code path exactly. The missing piece is the exact `asset.duration` returned by the rejected physical-iPhone trim attempt.

**Unknowns that block a precise fix SPEC:**

1. Was the rejected `asset.duration` barely over cap (for example 30.3s) or substantially over cap?
2. Does this reproduce consistently on the same physical iPhone / iOS version / clip, or only with particular source encodings?
3. Does `preferredAssetRepresentationMode: Compatible` affect returned edited-duration precision for this path?
4. Would a 1s tolerance preserve the product promise once Cloudinary processed derivative validation still enforces 30000ms?

---

## 10. Downstream routing

Route this report to Claude `mingla-orchestrator` for REVIEW. After APPROVED REVIEW, the operator + orchestrator should choose one of the three dispatch-level paths: SPEC a fix into ORCH-0978 IMPLEMENT-2, ship ORCH-0978 with this as a known issue plus follow-up ORCH, or accept the gap and amend SPEC AMENDMENT 1 to honestly describe iOS reality.
