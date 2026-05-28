# INVESTIGATION — ORCH-0978 [video cover] — iOS picker trim is not applied (user's trim is discarded)

**Author:** Claude `mingla-orchestrator` (operator-delegated INVESTIGATE)
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Supersedes the root cause in:** `INVESTIGATION_ORCH-0978_KEYFRAME_OVERSHOOT.md` §9.5 (keyframe-overshoot theory was wrong).
**Operator requirement (locked 2026-05-28):** the user MUST be able to trim to ANY ~29s segment of the video (not auto-first-29s); that chosen segment becomes the cover.

## 1 — Proven root cause

The cover-video flow relies on `expo-image-picker@17.0.11` `launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: true, videoMaxDuration: 29 })` to return a ≤29s trimmed slice. It does NOT. On the operator's physical iPhone the live `[ORCH-0978-TRIM]` log captured the returned `asset.duration` as **61700 ms and 58225.67 ms** — the full untrimmed source. The user's on-screen trim is discarded; the app receives the whole video.

**Evidence:**
- Live `[ORCH-0978-TRIM]` capture (post IMPLEMENT-6 deploy, new bundle confirmed via `capMs: 29000`): `durationMs` = 61700 / 58225.67 (≈58-62s, full source).
- Documented library defect: expo issue [#16146 "ImagePicker videoMaxDuration not working on iPhone"](https://github.com/expo/expo/issues/16146) — `videoMaxDuration` is not reliably enforced on iOS; longer videos are still selectable, and the trim via `allowsEditing` does not reliably produce a trimmed asset.
- Operator UX report: trimmer bar appears, "Video too long to send" flickers, Choose → "Please trim to 29 seconds first." — consistent with the picker returning the full asset.

**Conclusion:** `expo-image-picker`'s `allowsEditing`/`videoMaxDuration` is the wrong tool for reliable video trimming. The re-probe "cheap fix" (just re-read the duration) is ruled out: the picker isn't producing a trimmed file at all, so there is nothing correct to re-probe.

## 2 — Server-side plumbing (what already exists)

The upload pipeline was clearly designed to carry a trim window, but only half of it is wired:
- `event-cover-video-upload-intent` accepts + stores `trim_start_ms` and `trim_end_ms` (DB columns exist).
- The Cloudinary eager chain applies `du_<seconds>` (a **length/duration cap**) computed from `Math.min(trim_end_ms - trim_start_ms, MAX_DURATION_MS)`.
- **Missing: `so_<seconds>` (start-offset).** AMENDMENT 1 dropped it. So Cloudinary always cuts from 0:00 — it cannot currently extract a segment that starts partway through (e.g., seconds 12–41).

Implication: the backend can cap LENGTH but cannot yet honor a START offset. Whichever fix we choose, "any segment" support needs either (a) the app to physically trim the chosen segment before upload, or (b) re-introducing `so_` so Cloudinary extracts `[start, start+length]`.

## 3 — Recommended fix — dedicated in-app trimmer

Replace the unreliable picker-trim with a real trimmer that returns the actual trimmed file + the chosen window.

**Library:** [`react-native-video-trim`](https://github.com/maitrungduc1410/react-native-video-trim) (maitrungduc1410; actively maintained, updated 2026; npm). It presents a trim UI, supports `maxDuration: 29`, and its `onFinishTrimming` returns `outputPath`, `startTime`, `endTime`, `duration`. Requires a dev/native build (consistent with the app's existing native deps `react-native-compressor` + `expo-video`).

**Two architectures (both satisfy "user trims any segment"):**

- **Architecture B — local trim, upload the segment (RECOMMENDED).** Flow: pick video (expo-image-picker, selection only) → launch `react-native-video-trim` with `maxDuration: 29` → user drags to any ≤29s window → lib returns the trimmed `outputPath` → app uploads that file. The existing pipeline already assumes "the uploaded source IS the final slice" (AMENDMENT 1), so this slots in with **no edge change** (`du_` stays as defense-in-depth; `trim_start=0`, `trim_end=duration`; no `so_` needed). Smaller upload (only the segment). Cleanest fit.
- **Architecture A — capture window, Cloudinary cuts.** Flow: trimmer returns `[start,end]` only; upload the full source; edge adds `so_<start>` + `du_<length>` so Cloudinary extracts the segment. Re-introduces `so_` (edge change), uploads/processes the full source (more bandwidth + Cloudinary work). More moving parts. Not recommended unless local trim proves too slow on-device.

**Recommendation: Architecture B.** It matches the pipeline's existing assumption, needs no backend change, uploads less, and the AMENDMENT-8 33s ceiling/clamp + `du_` remain as harmless belt-and-suspenders.

## 4 — Tradeoffs / must-knows

- **Native rebuild required.** `react-native-video-trim` is a native module → ships via a full `eas build` (or local dev-build), NOT an OTA update. (Same constraint as the existing `react-native-compressor`/`expo-video` deps.)
- **Trimmer UI:** the library provides its own trim screen. MVP can use the default UI; visual polish to match Mingla can be a follow-up (designer pass) if desired.
- **AMENDMENT 8 stays:** the 33s source ceiling + 30s processed cap + migration remain as defense-in-depth (the trimmer now guarantees ≤29s arrives, so they rarely engage). No revert needed.
- **`videoMaxDuration`/`allowsEditing`:** remove `allowsEditing: true` from the picker call (it's now unreliable and superseded by the dedicated trimmer); keep the picker for selection only.

## 5 — Confidence

**Root cause: PROVEN** (live full-duration capture + documented library defect + operator UX report all align). **Fix-library choice: PROBABLE-strong** (react-native-video-trim is the actively-maintained standard for this exact need; final pick + on-device trim-speed should be confirmed in a short PoC at IMPLEMENT, mirroring the AMENDMENT-3 compression PoC). The re-probe cheap-fix is ruled out.

## 6 — Recommended next step

SPEC AMENDMENT 9 for Architecture B (dedicated trimmer), with a short on-device PoC clause (confirm `react-native-video-trim` trims a ≤29s segment and returns a playable `outputPath` on the operator's iPhone) before full wiring — same gate pattern as AMENDMENT 3's compression PoC. Then IMPLEMENT-7 (native dep + picker rewrite + trimmer wiring) → full `eas build` (not OTA) → tester live-fire → operator physical-iPhone re-check → CLOSE.
