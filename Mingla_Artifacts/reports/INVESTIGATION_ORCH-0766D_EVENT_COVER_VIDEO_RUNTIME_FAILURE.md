# INVESTIGATION ORCH-0766D - Event Cover Video Runtime Failure

> Date: 2026-05-09  
> Mode: Forensics / Runtime Probe  
> Surface: `mingla-business` event creator Step 4 cover video upload  
> Verdict: FAIL, but not for the previously assumed reason. Current evidence proves the simulator was running stale Step 4 JS and that the observed video path did not reach draft-state update or public URL rendering.

## Plain-English Finding

The app the operator was touching was not running the latest event-cover code.

The source code and Metro bundle both now say videos can be `MP4, MOV, or WebM`, but the live simulator Step 4 screen still displayed the old `MP4/WebM` wording. That means at least part of the retest happened against stale runtime JS, so any video verdict from that screen is contaminated.

During the observed probe, video files did get copied into the app's ImagePicker cache, including a known-good 7.69-second test video. But the current draft still has:

```text
coverMediaUrl: null
coverMediaType: null
```

So in this observed run, the video did **not** reach the successful upload/verification/state-update boundary. There is no saved public URL to prove a Supabase Storage or `expo-video` render failure yet.

## Reproduced Journey

Feature slice:

```text
Business organiser -> event creator Step 4 -> Upload cover -> Video -> native iOS picker -> selected/exported video -> Mingla validation/upload -> draft cover preview
```

Observed runtime:

1. Simulator was on event creator Step 4.
2. Step 4 still showed the old guidance:

```text
Upload an image, GIF, or MP4/WebM video up to 15 seconds and 30 MB.
```

3. Current source and Metro-served bundle both contain the newer guidance:

```text
Upload an image, GIF, or MP4, MOV, or WebM video up to 15 seconds and 30 MB.
```

4. The simulator initially had no videos in the Photos picker.
5. I seeded two deterministic simulator videos:
   - `/tmp/orch0766d_8s.mp4`: 7.693s, 8.0 MB.
   - `/tmp/orch0766d_16s.mp4`: 15.813s, 18 MB.
6. The app container then showed ImagePicker cache copies of both videos.
7. The draft state remained media-empty after the observed run.
8. I force-relaunched the app to remove the stale-process variable. The app returned to Home; the draft card still showed hue fallback.

## Environment Evidence

Booted simulator:

```text
iPhone 17 Pro
UDID: 17091E60-C3B6-4167-980D-60C348E177F6
iOS 26.4
```

Business app container:

```text
/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Data/Application/C509364A-577E-42EE-8306-10422F6BD63B
```

Expo/Metro process:

```text
node /Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules/.bin/expo start --clear
PID: 37811
Port: 8081
```

Package versions:

```text
expo-image-picker: ~17.0.11
expo-video: ~3.0.16
expo-file-system: ~19.0.21
@supabase/supabase-js: ^2.74.0
@supabase/storage-js: not direct
```

## Source/Runtime Drift Proof

Source:

- `mingla-business/src/utils/eventCoverMediaRules.ts:5-6`:

```text
Upload an image, GIF, or MP4, MOV, or WebM video up to 15 seconds and 30 MB.
```

Metro-served iOS bundle:

```text
EVENT_COVER_UPLOAD_LIMIT_COPY = "Upload an image, GIF, or MP4, MOV, or WebM video up to 15 seconds and 30 MB."
video/quicktime support present
MOV/QuickTime validation copy present
```

Live simulator screenshot before relaunch:

```text
Upload an image, GIF, or MP4/WebM video up to 15 seconds and 30 MB.
```

Root-cause classification: confirmed bug in the QA/runtime setup, not a product-code media rule by itself.

Six-field proof:

- File/line: `mingla-business/src/utils/eventCoverMediaRules.ts:5-6`.
- Exact code: source says `MP4, MOV, or WebM`.
- Current behavior: live simulator Step 4 still rendered `MP4/WebM`.
- Expected behavior: running app should render the same copy and media support contract as current source/Metro bundle.
- Causal chain: stale JS process or stale screen state -> operator retests old Step 4 behavior -> video result appears to contradict current code -> debugging keeps targeting already-fixed MOV support.
- Verification step: after a clean relaunch, resume the draft to Step 4 and confirm the inline copy says `MP4, MOV, or WebM` before any more video QA.

## Picker/File Evidence

Seeded media:

```text
/tmp/orch0766d_8s.mp4
file: ISO Media, Apple QuickTime movie, Apple QuickTime (.MOV/QT)
duration: 7.693333333333333s
size: 8.0 MB

/tmp/orch0766d_16s.mp4
file: ISO Media, Apple QuickTime movie, Apple QuickTime (.MOV/QT)
duration: 15.813333333333333s
size: 18 MB
```

App ImagePicker cache after probe:

```text
DB771B21-...mp4  size=8367682   duration=7.693333333333333
562312D6-...mp4  size=8367682   duration=7.693333333333333
891DF723-...mp4  size=8367682   duration=7.693333333333333
AF37F1E3-...mp4  size=8367682   duration=7.693333333333333
1B0EDE71-...mp4  size=19373876  duration=15.813333333333333
5600EE1F-...mp4  size=19373876  duration=15.813333333333333
984B0E5B-...mp4  size=19373876  duration=15.813333333333333
```

Interpretation:

- iOS/Expo can copy valid video bytes into the app container.
- The known 7.69s file is under the 15s product limit.
- The known 15.81s file is correctly over the 15s product limit.
- This file evidence alone does not prove Mingla received `asset.duration`; the JS picker payload was not visible in Apple unified logs.

## Draft-State Evidence

AsyncStorage draft after the observed run:

```json
{
  "id": "98e880f3-43ef-47ab-a530-deaa117b21a7",
  "name": "Runtime Share Test FreetA throwaway free-ticket QA event for testing public links and share buttons.",
  "coverHue": 25,
  "coverMediaUrl": null,
  "coverMediaType": null,
  "lastStepReached": 3,
  "clientRevision": 149,
  "updatedAt": "2026-05-09T08:42:35.895Z"
}
```

Root-cause classification: confirmed boundary location.

Six-field proof:

- File/line: `mingla-business/src/components/event/CreatorStep4Cover.tsx:142-160`.
- Exact code: draft media is updated only after `uploadEventCoverMedia(...)` returns a verified `publicUrl` and `mediaType`.
- Current behavior: app has ImagePicker video cache files, but draft media fields remain null.
- Expected behavior: a successful video upload should set `coverMediaUrl` and `coverMediaType: "video"`.
- Causal chain: picker/cache happened -> upload/update boundary did not complete -> no URL saved -> preview remains hue -> no Supabase public object or renderer proof exists for this draft.
- Verification step: run one fresh 7.69s video attempt after clean relaunch while capturing JS console; expect either a specific `EventCoverMediaError.code` before state update or a saved `coverMediaUrl`.

## Supabase Public URL Proof

No current URL exists for this draft.

Because `coverMediaUrl` is null, there was no public Storage URL to HEAD/GET for this observed failure. That eliminates public-object verification and `expo-video` remote playback as proven current root causes for this specific run.

## Renderer/Playback Evidence

Current renderer:

- `mingla-business/src/components/ui/EventCoverMedia.tsx:50-56` uses `useVideoPlayer(uri, ...)`.
- `EventCoverMedia.tsx:59-61` listens for `statusChange`, but calls `onError()` without passing the status payload.
- `expo-video/src/VideoPlayerEvents.types.ts:96-110` exposes `payload.error`.
- `expo-video/ios/VideoPlayer.swift:299-302` emits `statusChange` with an error record.

Root-cause classification: confirmed observability gap.

Six-field proof:

- File/line: `mingla-business/src/components/ui/EventCoverMedia.tsx:59-61` and `EventCoverMedia.tsx:172`.
- Exact code: `if (payload.status === "error") onError();` then `onError={() => handleMediaError("video")}`.
- Current behavior: video render failures become `Uploaded, but this cover could not be displayed`, but the native player error payload is discarded.
- Expected behavior: if video render fails, dev logs and the Step 4 handler should include the `expo-video` status/error payload.
- Causal chain: player emits useful error -> component discards it -> console has no actionable renderer cause -> forensics cannot distinguish codec, URL, transport, or player-state failures from the app logs.
- Verification step: pass `payload` through `onError(payload)` and verify `[EventCoverMedia] media render failed` includes native error data.

Important: Apple unified logs after relaunch showed AVFoundation/AVKit successfully enqueueing frames and playing a 7.693s video in the app process. That proves the simulator/native stack can play the seeded video class. It does **not** prove event-cover public URL rendering, because no event-cover URL was saved in this draft.

## Validation/Duration Semantics

Current source expects Expo picker `asset.duration` in milliseconds:

- Expo type docs: `duration?: number | null` is video length in milliseconds.
- Mingla limit: `EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000`.
- Mingla rejects:
  - missing video duration as `video_duration_unknown`;
  - duration over 15000 as `video_too_long`.

The operator report that an "8 seconds" video got a "choose up to 15 seconds" toast can be explained by either:

1. stale JS still running old copy/old flow;
2. `asset.duration` being missing, which maps to `video_duration_unknown`;
3. the picker returning a different selected/exported asset than the operator expected;
4. a true over-limit duration value in the JS payload.

Only option 1 is proven right now. Options 2-4 require the JS picker payload, specifically:

```text
[CreatorStep4Cover] picked cover asset
duration
fileName
fileSize
mimeType
type
uri
```

## Weird Console Logs

Observed Apple unified logs include noisy simulator/native framework messages:

- Photos picker permission/cache messages.
- Accessibility notification failures such as `Post notification failed ... app ax and automation are off`.
- AVFoundation/AVKit debug logs such as `can't apply volume, no audio render pipeline`.

Those are not proven to be the event-cover failure. The earlier JS maximum-depth error is also not present in this current probe output.

The important missing logs are the React Native `console.info` objects from:

- `[CreatorStep4Cover] picked cover asset`
- `[eventCoverMedia] upload-start`
- `[eventCoverMedia] upload-verified`
- `[CreatorStep4Cover] cover media draft update queued`
- `[EventCoverMedia] media render failed`

Apple unified logging did not surface these JS objects during the probe, so the Metro terminal/React Native console remains a required evidence source for the next run.

## False Leads Eliminated

- **"MOV support was not added": eliminated for source/Metro. Current source and served bundle support `video/quicktime`, `.mov`, and `.qt`.
- **"This observed run reached Supabase but failed render": not proven. Draft state has no URL and no storage object was available to verify.
- **"The app cannot physically read/copy short videos": downgraded. The app container contains non-zero 7.69s video cache files.
- **"The seeded 8s video is actually over 15s": eliminated. AVFoundation reports 7.693s.
- **"Native simulator cannot play this video class": downgraded. AVFoundation logs show successful first-frame enqueue/playback for a 7.693s movie in the app process after relaunch.

## Required Next Probe Before Rework

Do not send this to implementation for another media rewrite yet. The next probe must be one clean runtime attempt after the stale-bundle variable is removed.

Steps:

1. Use the relaunched app.
2. Resume the draft `Runtime Share Test...`.
3. Go to Step 4.
4. Confirm the inline copy says:

```text
MP4, MOV, or WebM
```

5. Pick the seeded 7.69s video from Photos.
6. Capture the Metro console object for:

```text
[CreatorStep4Cover] picked cover asset
```

7. Immediately inspect:
   - app container recent files;
   - `mingla-business.draftEvent.v1`;
   - public URL HEAD/GET if `coverMediaUrl` exists.

Decision tree:

- If `asset.duration` is null: root is duration metadata handling; spec a fallback AVAsset-duration read before rejecting.
- If `asset.duration <= 15000` and `upload-start` never appears: root is validation/classification before upload.
- If `upload-start` appears and `upload-verified` does not: root is byte reader, Supabase upload, or public URL verifier.
- If `upload-verified` appears and draft remains null: root is draft update/autosave state.
- If draft gets `coverMediaUrl/type` and Step 4 says display failed: root is renderer/playback/public URL; then use the forwarded `expo-video` payload.

## Minimal Proven Implementation Spec

Only these changes are justified by current proof:

1. Forward video player error payloads.
   - Change `EventCoverVideo` so `onError` receives the full `statusChange` payload.
   - Pass that payload to `handleMediaError("video", payload)`.
   - Add/update a component test proving video status errors preserve native error details.

2. Add explicit upload-error debug logging.
   - In `CreatorStep4Cover.showUploadError`, dev-log `EventCoverMediaError.code` and message before showing the toast.
   - This must not expose auth tokens or signed URLs.
   - Add a test/source guard if the project uses source guards for this area.

3. Add a QA freshness gate to the tester prompt/report template for this feature.
   - Before any event-cover runtime verdict, tester must confirm the live Step 4 copy matches current source.
   - If source says `MP4, MOV, or WebM` but runtime says `MP4/WebM`, the test is invalid and must start after clean reload/relaunch.

Do **not** rework Supabase upload, MOV acceptance, or the trimmer again from this report alone. Those areas may still fail, but this run did not produce the evidence needed to target them without guessing.

