# INVESTIGATION — ORCH-1303 [venue "Add hero cover" VIDEO upload does not work on business WEB]

Phase: INVESTIGATE · Skill: mingla-forensics · Date: 2026-07-04
Sourcing: **origin/main @ `8fce90ca` (HEAD)** — anchor checkout `c3ed85521` is **101 commits behind**; ALL shipped code read via `git show origin/main:<path>`.
Reporter: Seth, live prod, business.usemingla.com (web), venue **deck-readiness** page (`VenueDeckReadinessSetup`, route `/venue/deck-readiness`). "Add photos" (gallery) was fixed by ORCH-1300 and works; **"Add hero cover" does NOT**. This ORCH is the live-fire follow-up ORCH-1300 explicitly deferred (its F-5/F-6 marked the cover "should work — needs a 60-second live check"; Seth ran that check and it fails).

---

## LAYMAN ANSWER (read this first)

The **image** part of "Add hero cover" works on the website. The **video** part does not — and it has *never* worked on the web, we just never caught it because nobody could log into the authed business website to test it. When you pick a video on the website, the code hands the upload a **broken address for the file** (it takes the browser's temporary file link, which looks like `blob:https://…`, and wrongly bolts `file://` in front of it, producing `file://blob:https://…`). The uploader then tries to open that address to read the video bytes, the browser refuses because it's nonsense, and the upload dies with a cryptic "Failed to fetch" error. This is a one-line mistake that was written for the phone app (where files really do need a `file://` prefix) and wrongly runs on the web too.

Two things make it worse in practice: many iPhone videos (.mov / HEVC) can't even be read by a browser, so before it gets that far you sometimes see "Could not read this video's duration"; and clips over ~33s get a "trim to 29 seconds first" message. But the core, unconditional bug is the mangled file address — even a short, browser-friendly MP4 fails.

**Bottom line:** hero **image** cover on web = works. Hero **video** cover on web = broken by a single mangled-URL line in the shared cover picker. Because that picker is shared, the same break hits venue covers, brand covers, and trip/event covers on the web — all of them. The Bunny video host and its web upload code are fine; they're just never reached. The fix is one line; native is untouched.

---

## Symptom summary (expected vs actual)

- **Expected:** On business web, tapping "Add hero cover" → cover sheet → "Video" → pick a short clip → it compresses (no-op on web), uploads to Bunny via TUS, processes, and the venue hero shows the video.
- **Actual (web):** Picker opens, a clip is chosen, the preview flashes "Compressing…"/"Uploading…", then a red "Failed to fetch"-class error appears in the sheet; no video ever attaches. (For .mov/HEVC or >33s clips, an earlier honest toast fires instead and the upload never starts.)
- **Actual (web, image):** Works — picks, uploads to `brand_covers`, attaches. (Not the reported break.)
- **Native (iOS/Android):** Both image and video work (different code branch).

---

## Investigation manifest (every file read from origin/main, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx` | The screen. Wires "Add hero cover" → `CoverPickerSheet` (target `venue`). |
| 2 | `mingla-business/src/components/ui/CoverPickerSheet.tsx` | Sheet host; mounts on web via `Sheet`. |
| 3 | `mingla-business/src/components/ui/CoverPicker.tsx` | The unified picker. `pickImageOrGifCover` (image) + `pickVideoCover` (video). **Mangle lives at line 593.** |
| 4 | `mingla-business/src/components/ui/coverPickerDeviceMedia.ts` (web) + `.native.ts` | Device pickers. Web accepts video (`accept:"video/mp4,video/quicktime,video/*"`). |
| 5 | `mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts` | `normalizeLocalFileUri` (the mangling helper) + `buildTrimmedVideoUploadFile`. |
| 6 | `mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts` (native) + `.web.ts` | Native trimmer vs web no-op stub. |
| 7 | `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | `start()` orchestration; venue → `serverTarget:"brand"`, skips apply. |
| 8 | `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Upload legs. **Web TUS via `uploadEventCoverVideoSourceViaTus` → `fetch(input.uri)` at line 988.** |
| 9 | `mingla-business/src/services/eventCoverVideoTusPatch.ts` (web stub) + `.native.ts` | ORCH-1295/1297 native TUS PATCH; web uses XHR (`patchTusWithXhr`). |
| 10 | `mingla-business/src/utils/browserFilePicker.ts` | `pickBrowserFiles`; web `uri = URL.createObjectURL(file)` (`blob:…`). |
| 11 | `mingla-business/src/services/brandCoverService.ts` + `brandCoverFileReader.ts` (web) + `brandCoverRules.ts` | The **image** venue-cover path (works on web). |
| 12 | `supabase/functions/event-cover-video-upload-intent/index.ts` | Confirms brand/venue-target Bunny TUS descriptor is returned (signing/edge OK). |
| 13 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1300_WEB_PHOTO_COVER_UPLOAD.md` + `IMPLEMENTATION_ORCH-1300_WEB_GALLERY_PICKER.md` | The sibling saga; explicitly deferred the cover live-check (F-5/F-6). |
| 14 | `git log -S` on `normalizeLocalFileUri(asset.uri)` | Dates the mangle to ORCH-0978 (`058fabd7d`). |

---

## Q-scorecard

- **Q1 — Does "Add hero cover" open a web file picker for video at all?** Verdict: **YES.** Desktop web opens `<input type=file accept="video/mp4,video/quicktime,video/*">`; phone-web is honestly gated with a toast. NOT a dead tap. `proven` (static, deterministic). See F-1.
- **Q2 — Why does the VIDEO cover fail on web?** Verdict: **The web blob URL is mangled to `file://blob:…` by `normalizeLocalFileUri` (CoverPicker.tsx:593); the web TUS upload's `fetch(input.uri)` (service:988) then rejects.** `probable` (deterministic static proof; authed-biz-web live-fire is a named/known blocker). See F-2, F-3.
- **Q3 — Is it a native/web split where web is stubbed (dispatch prime suspect b)?** Verdict: **Partly — but not where suspected. The web TUS transport (`patchTusWithXhr`) is a REAL, correct implementation. The break is UPSTREAM: the web raw-clip branch mangles the URI before the transport is ever reached.** See F-2, F-4.
- **Q4 — Bunny signing / edge fn broken from web (hyp. c)?** Verdict: **RULED OUT.** `event-cover-video-upload-intent` returns a valid brand-target Bunny TUS descriptor (`protocol:"tus"`, presigned `AuthorizationSignature`). See F-5.
- **Q5 — Still routing to retired Cloudinary (hyp. d)?** Verdict: **RULED OUT.** Provider is `bunny`; the TUS branch is taken. The mangle predates and is independent of the provider. See F-5, F-8.
- **Q6 — Image vs video (hyp. e)?** Verdict: **IMAGE works on web; only VIDEO fails.** The image path passes `asset.uri` UNMANGLED to `uploadBrandCover`; only the video branch calls `normalizeLocalFileUri`. See F-6.
- **Q7 — Silent failure (Constitution #1/#3)?** Verdict: **Not fully silent — a cryptic error surfaces** ("Failed to fetch"-class) in the cover sheet with a retry button; retry reproduces. Two conditional inputs (.mov/HEVC, >33s) short-circuit earlier with honest toasts. See F-7.
- **Q8 — Does it also hit the 1290 wizard Cover step and BRAND covers?** Verdict: **YES to both, plus trip/event covers — all share `CoverPicker.pickVideoCover`.** Universal web-video-cover break, not venue-specific. See F-9.
- **Q9 — When did it start?** Verdict: **ORCH-0978 (`058fabd7d`, the original trim→upload commit). Web video cover has NEVER worked; it was never live-fire tested.** See F-8.

---

## Findings

### F-1 — "Add hero cover" → sheet → "Video" opens a real web picker (not a dead tap) — RULED OUT (as the break)
- **Symptom:** The button + Video affordance respond on web.
- **Layer:** code (component + web device-media split).
- **Probe:** `git show origin/main:mingla-business/src/components/{venue/VenueDeckReadinessSetup,ui/CoverPicker,ui/coverPickerDeviceMedia}.tsx|.ts`.
- **Evidence:** VenueDeckReadinessSetup.tsx:507-513 `onPress={() => setCoverVisible(true)}` → :795-806 `<CoverPickerSheet ... target={{ kind:"venue", brandId, venueId }} />`. CoverPicker "Video" button (LibraryTab, :1182-1191) disabled only by `uploading || disabled || isPhoneWeb`; on desktop web `isPhoneWeb` is false. `pickVideoCover` (:551-562) gates phone-web with an honest toast, else `launchCoverVideoPicker()` → (web) `pickBrowserFiles({ accept:"video/mp4,video/quicktime,video/*", maxFiles:1 })` (coverPickerDeviceMedia.ts:75-92).
- **Mechanism:** The picker opens on desktop web; the failure is downstream of selection.
- **Severity:** `RULED OUT` (as a dead-tap/picker cause).

### F-2 — The web raw-clip branch mangles the blob URL: `normalizeLocalFileUri(asset.uri)` → `file://blob:…` — CONFIRMED ROOT CAUSE
- **Symptom:** The uri handed to the uploader is a corrupt `file://blob:https://…` string.
- **Layer:** code.
- **Probe:** read CoverPicker.tsx:571-594 + coverPickerVideoTrimUpload.ts:17-18 + browserFilePicker.ts:99-111.
- **Evidence:**
  - Web asset uri is a browser object URL: `browserFileToPickedFileWithoutValidation` → `uri: objectUrl ?? ""`, `objectUrl = URL.createObjectURL(file)` (browserFilePicker.ts:100-110) → `blob:https://business.usemingla.com/<uuid>`.
  - `pickVideoCover` else-branch (web, `isNative === false`, `trimResult === null`), CoverPicker.tsx:586-594:
    ```
    : {
        bytes: asset.fileSize ?? 0,
        durationMs: normalizePickerDurationMs(asset.duration),
        ...
        uri: normalizeLocalFileUri(asset.uri),   // ← line 593
      };
    ```
  - `normalizeLocalFileUri` (coverPickerVideoTrimUpload.ts:17-18): `path.startsWith("file://") ? path : ` + "`file://${path}`". A `blob:` URL does not start with `file://` → returns **`file://blob:https://business.usemingla.com/<uuid>`**.
- **Mechanism:** The helper exists to prefix native trimmed file paths (`/var/mobile/…` → `file:///var/mobile/…`). On web the raw-clip branch wrongly applies it to a blob URL, corrupting it.
- **Severity:** `CONFIRMED ROOT CAUSE`.

### F-3 — The mangled uri kills the web TUS upload at `fetch(input.uri)` — CONFIRMED ROOT CAUSE (the failure point)
- **Symptom:** Upload dies immediately in the "Uploading…" stage with a "Failed to fetch"-class error.
- **Layer:** code (service, web branch).
- **Probe:** trace `useEventCoverVideoUpload.start` → `uploadEventCoverVideoSource` → `uploadEventCoverVideoSourceViaTus`.
- **Evidence:**
  - Hook `start` (useEventCoverVideoUpload.ts:100-155): `compressVideoLocally` (web no-op — `loadVideoCompressor()` returns null on web, service:431) keeps `file.uri` unchanged → intent → `uploadEventCoverVideoSource({ uri: compressed.uri, ... })`.
  - `uploadEventCoverVideoSource` (service:1061-1075): `input.upload.protocol === "tus"` → `uploadEventCoverVideoSourceViaTus(input)`.
  - `uploadEventCoverVideoSourceViaTus` (service:987-990), **first web statement:**
    ```
    if (Platform.OS === "web") {
      const blobResponse = await fetch(input.uri);   // input.uri = "file://blob:https://…" → REJECTS
      webBlob = await blobResponse.blob();
    ```
  - `fetch("file://…")` from an https origin rejects (TypeError / blocked scheme); it never reaches the (correct) TUS create POST (:1002) or `patchTusWithXhr` (:857-905, branch :1040-1047).
- **Mechanism:** Corrupt uri → `fetch` rejects → error bubbles to `start`'s catch (hook:194-218) → `setStage({phase:"error", code:"video_upload_failed", message})`. The video never uploads.
- **Severity:** `CONFIRMED ROOT CAUSE`.

### F-4 — The web TUS transport itself is correct (dispatch's "web stub" suspicion refuted) — RULED OUT
- **Symptom:** N/A (the web upload code, if reached, is well-formed).
- **Layer:** code.
- **Probe:** read `patchTusWithXhr` + the web branch of `uploadEventCoverVideoSourceViaTus` + `eventCoverVideoTusPatch.ts` (web stub).
- **Evidence:** service:1040-1047 web branch calls `patchTusWithXhr({ blob: webBlob, headers: patchHeaders, ... })`; `patchTusWithXhr` (:857-905) opens `PATCH`, sets every TUS/auth header, accepts 200/204. `eventCoverVideoTusPatch.ts` (web) is a *deliberate* stub whose functions throw only if called — and the web path never calls them (it uses XHR + `fetch().blob()`, per its own comment). The native `*.native.ts` (ORCH-1295/1297) is separate.
- **Mechanism:** The web transport is real and correct; it is simply unreachable because F-2/F-3 fail first.
- **Severity:** `RULED OUT` (web transport is not the break). Note: the dispatch's hypothesis (b) is *directionally right* (native path was the one hardened; web was never verified) but the actual defect is the URI mangle upstream, not a stubbed transport.

### F-5 — Bunny signing / intent edge fn works for brand/venue target — RULED OUT (hyp. c & d)
- **Symptom:** N/A.
- **Layer:** edge function.
- **Probe:** read `event-cover-video-upload-intent/index.ts`.
- **Evidence:** `targetKind = body.target === "brand" ? "brand" : "event"` (:224); brand-target auth gate `requireBrandCoverManager` (:335); provider `coverVideoProvider()` → `"bunny"` branch (:472-528): `bunnyCreateVideo` + `bunnyPresignTusUpload` → response `upload:{ url: presign.tusEndpoint, protocol:"tus", videoId, fields:{ AuthorizationSignature, AuthorizationExpire, LibraryId, VideoId }, metadata }` (:510-529). The AccessKey never leaves the server. Venue rides `serverTarget:"brand"` (useEventCoverVideoUpload.ts:68-69). ORCH-1298 (brand cover video preview) presupposes this pipeline works end-to-end on native.
- **Mechanism:** The client receives a valid TUS descriptor; the create/sign is not the failure. (Still-Cloudinary is refuted — provider is bunny.)
- **Severity:** `RULED OUT`.

### F-6 — IMAGE cover works on web; only VIDEO fails (hyp. e confirmed) — CONFIRMED
- **Symptom:** Image cover attaches on web; video does not.
- **Layer:** code.
- **Probe:** read `pickImageOrGifCover` (venue branch) + `uploadBrandCover` + `brandCoverFileReader.ts` (web) + `brandCoverRules.ts`.
- **Evidence:** `pickImageOrGifCover` venue branch (CoverPicker.tsx:440-469) passes `{ uri: asset.uri, mimeType, fileName, fileSize }` **unmangled** to `uploadBrandCover(target.brandId, …)`. `uploadBrandCover` → `readBrandCoverFileBytes(input.uri)` (web variant: `fetch(uri).arrayBuffer()`, brandCoverFileReader.ts) — reads the plain `blob:` URL fine → `supabase.storage.from("brand_covers").upload(...)` → `verifyBrandCoverPublicUrl` (HEAD). `resolveBrandCoverContentType` accepts the browser mime. No `normalizeLocalFileUri` anywhere on the image path.
- **Mechanism:** The image path never corrupts the uri, so it succeeds; only the video branch (F-2) is broken.
- **Severity:** `CONFIRMED` — determinative image-vs-video split.

### F-7 — Failure is a cryptic surfaced error, not a fully silent dead tap; plus two earlier honest gates — CONFIRMED (partial Constitution concern)
- **Symptom:** After "Uploading…", a red error ("Failed to fetch"-class) shows in the sheet with a retry button; retry reproduces.
- **Layer:** code.
- **Probe:** trace hook catch → CoverPicker LibraryTab error render.
- **Evidence:** hook:194-217 sets `stage.message = nextError.message` (the raw fetch TypeError text); CoverPicker.tsx:1218-1235 renders `videoErrorMessage` in an `accessibilityRole="alert"` row + "Upload failed - try again". EARLIER conditional exits in `pickVideoCover`: `durationMs <= 0` → toast "Could not read this video's duration. Try another clip." (:596-599) — fires for .mov/HEVC clips a browser can't decode metadata for (readBrowserVideoDurationMs returns null, coverPickerDeviceMedia.ts:40-62); `durationMs > 33_000` → toast "Please trim to 29 seconds first." (:600-608).
- **Mechanism:** The unconditional deep failure (F-3) shows an unhelpful engineer-facing error; some inputs are stopped earlier by honest but confusing toasts. From Seth's view: "video cover doesn't work."
- **Severity:** `CONFIRMED CONTRIBUTOR` — not a pure silent dead tap, but the surfaced copy is non-actionable ("Failed to fetch"). Flag for the SPEC to also improve error copy.

### F-8 — Introduced by ORCH-0978; provider-independent; predates the Bunny migration — CONFIRMED (history)
- **Symptom:** N/A.
- **Layer:** code history.
- **Probe:** `git log origin/main -S "normalizeLocalFileUri(asset.uri)" -- mingla-business/src/components/ui/CoverPicker.tsx`.
- **Evidence:** Single introducing commit **`058fabd7d` "Close ORCH-0978 [deploy]: video cover trim → upload → sub-30s render (dedicated trimmer)"**. The mangle sits on the `isNative`-gated raw-clip branch that only web takes. Because the corruption is upstream of the upload leg, it broke web video cover under BOTH the old Cloudinary transport and the current Bunny/TUS transport.
- **Mechanism:** Web video cover has never functioned; it escaped detection because authed business-web runtime is unreachable to the pipeline's test environments (see Repro).
- **Severity:** `CONFIRMED` — this is NOT a META-ORCH-1270 (Bunny) regression; the Bunny web path is correct and merely unreached.

### F-9 — Blast radius: EVERY web cover-video upload is broken (venue, brand, trip, event) — CONFIRMED
- **Symptom:** All shared-picker web video uploads fail identically.
- **Layer:** code.
- **Probe:** `git grep` consumers of `CoverPickerSheet`/`CoverPicker.pickVideoCover`.
- **Evidence:** `CoverPicker.pickVideoCover` is the ONE video path for all targets; the mangle is target-agnostic. Consumers on web: venue deck-readiness (`VenueDeckReadinessSetup`), the **META-ORCH-1290 wizard Cover step** (`VenueCoverStep`, s4 — same `CoverPickerSheet`), **brand** cover (BrandEditView / BrandCreationFlow, target `brand`), and **trip/event/experience** covers. ORCH-1298 fixed brand cover video *preview rendering* (a distinct downstream bug), which means the brand web upload's mangle was never the thing being tested there either.
- **Mechanism:** One shared branch → one universal web-video defect across all cover surfaces.
- **Severity:** `CONFIRMED` — in-scope for the fix are venue + (shared) the 1290 wizard + brand + trip/event covers on web. Native is out of scope (works).

---

## Five-Truth-Layer reconciliation

| Layer | Video cover ("Add hero cover" → Video) | Image cover |
|-------|----------------------------------------|-------------|
| **Docs** | ORCH-1300 F-6 claimed "Desktop-web video cover upload is functional" (based on the picker opening, NOT a completed upload). | ORCH-1300 F-5: image path web-safe (correct). |
| **Schema** | N/A (Bunny job row + `venue_listings.cover_media_*` via `syncHeroMedia`). | Storage `brand_covers/{brandId}/…`. |
| **Code** | Web branch corrupts the uri (`file://blob:…`) then `fetch()`-rejects. | Passes `asset.uri` unmangled → succeeds. |
| **Runtime** | NOT run (authed biz-web unreachable — named blocker). Static path deterministic. | Not run; path complete. |
| **Data** | No Bunny source bytes ever PATCHed → job never leaves `source_uploading` → no `cover_media_*` write. | `brand_covers` object + venue `cover_media_url` written. |

**Contradiction flagged:** ORCH-1300 F-6's Docs claim ("video works on desktop web") disagrees with Code truth (unconditional uri mangle). Code holds truth → web video cover is broken. F-6 was a static "picker opens" inference, not an upload trace; this investigation corrects it.

---

## Repro evidence

- **Live-fire NOT performed.** Named, known blocker: **authed business-web runtime is unreachable to this environment** (memory `feedback_biz_web_authed_runtime_unreachable_cap_claims`) — the venue deck-readiness page requires an authenticated brand/venue session; the same blocker capped ORCH-1300. Per Prime Directive 7 + Failure Honesty this caps confidence at `probable`.
- **Static proof is deterministic:** the mangle (F-2) is unconditional on web; the `fetch(input.uri)` on the mangled uri (F-3) is the first web statement in the TUS leg — there is no runtime branch that makes it succeed. Seth's live report (video cover fails) corroborates.
- **Seth's live-fire (external):** "Add hero cover" video does not work on business.usemingla.com — the exact behavior the static trace predicts.

---

## Blast radius / cross-surface map

- **Business Web — venue deck-readiness (`VenueDeckReadinessSetup`)** — video BROKEN, image works. IN SCOPE.
- **Business Web — META-ORCH-1290 wizard Cover step (`VenueCoverStep`, s4)** — same `CoverPickerSheet`; video BROKEN, image works. IN SCOPE (shared).
- **Business Web — BRAND cover (BrandEditView / BrandCreationFlow)** — same `pickVideoCover`; video BROKEN on web. IN SCOPE (shared root cause; confirm in SPEC).
- **Business Web — TRIP / EVENT / EXPERIENCE cover** — same `pickVideoCover`; video BROKEN on web. IN SCOPE (shared root cause).
- **Business iOS / Android (native)** — video + image WORK (raw-clip branch not taken; trimmed path normalizes a real file path correctly). OUT OF SCOPE (not broken).
- **Consumer iOS / Android** — venue/brand authoring is business-only. OUT OF SCOPE.
- **Anon/Buyer web, Admin web** — no cover authoring. OUT OF SCOPE.

## Invariant impact (flagged, not resolved)

- **Constitution #3 (no silent failures)** — partially implicated: the surfaced error is non-actionable ("Failed to fetch"); the .mov/HEVC and >33s gates are honest but confusing. SPEC should improve copy.
- **I (ORCH-1097 web-media-picker guard) / ORCH-1300 gallery guard** — neither guard asserts the web video-cover *upload* actually consumes an un-mangled uri. A fails-on-revert lock on "web video branch does not `normalizeLocalFileUri` a blob URL" is the natural regression protection (SPEC to define).
- **META-ORCH-1270 Bunny contracts** — UNAFFECTED (web TUS transport is correct; the defect is upstream). Do not touch the Bunny signing/edge path.

## Discoveries for Orchestrator (side issues)

- **D-1:** ORCH-1300's F-6 recorded "desktop-web video cover upload is functional" — this is now corrected to BROKEN. Update WORLD_MAP / any doc that inherited that claim.
- **D-2:** `.mov`/HEVC on web — even after the mangle fix, browsers (esp. Chrome) can't read metadata for many iPhone `.mov`/HEVC clips, so `readBrowserVideoDurationMs` returns null → "Could not read this video's duration." This will remain a real web-video limitation for a subset of clips; SPEC should decide whether to (a) accept + document, (b) surface a clearer "this video format isn't supported in the browser — use the app" message. Not a blocker for the primary fix.
- **D-3:** After fixing the upload, the tester must confirm the venue hero **preview renders the processed VIDEO** (VenueDeckReadinessSetup.tsx:494-506 uses `EventCoverMedia mediaType={cover.coverMediaType}`) — the analogue of ORCH-1298/1301's brand-preview lock. Venue uses `EventCoverMedia` directly, so it should render, but it has never been live-verified.

## Confidence

- **Video cover broken on web: `probable`.** Static proof is deterministic and complete (unconditional mangle + `fetch` of the mangled uri as the first web statement); corroborated by Seth's external live-fire. The only unmet step is authed-biz-web live-fire from this environment (named/known blocker).
- **Image cover works on web: `probable`** (full path traced; reuses the ORCH-0805/1300-confirmed brand cover pipeline; runtime unverified from here).
- **Root cause is the URI mangle (not a Bunny/transport/edge defect): `proven` at the code level** (single introducing commit; transport + edge independently verified correct).

## Recommended next phase + scope (direction only — NOT a fix, NOT code)

1. **SPEC a minimal, web-only URI fix** in `CoverPicker.pickVideoCover`: on web the raw-clip branch must pass the picker's `asset.uri` (the `blob:` object URL) to the uploader **without** `normalizeLocalFileUri` — i.e., only normalize on native / for the trimmed-file path. One-line-class change; do NOT touch the Bunny signing/edge/transport code.
2. **Scope = the shared root cause.** Because `pickVideoCover` is shared, the fix restores web video cover for venue, the 1290 wizard Cover step, brand, and trip/event/experience simultaneously. The SPEC's cross-surface table must enumerate all of these and set a per-surface web live-fire success criterion.
3. **Regression lock (fails-on-revert):** add a test asserting the web video branch yields an uri that (a) is NOT `file://`-prefixed when the source is a `blob:` URL and (b) is `fetch`-able; reverting to `normalizeLocalFileUri(asset.uri)` must fail it. Consider extending the ORCH-1097/1300 web-media CI guard.
4. **Error-copy hardening (SPEC decides):** replace the raw "Failed to fetch"-class surfaced message with actionable copy; decide the .mov/HEVC-on-web message (D-2).
5. **Tester gate:** authed-biz-web live-fire — pick a short MP4 on desktop web for a venue, confirm Bunny TUS upload → processing → ready → the venue hero renders the video (D-3); repeat for the 1290 wizard Cover step and a brand cover.
6. **Ship vector:** business **WEB only via Vercel `[deploy]`** at CLOSE. **NO `eas update`** for mingla-business (business is NATIVE-BUILD-ONLY per COMMS-0052→0063; OTA frozen). Native already works via the untouched branch and needs nothing; the fix rides the next native build for parity but web ships independently.

Recommended handoff: **mingla-forensics (SPEC)** → `SPEC_ORCH-1303_HERO_COVER_VIDEO_WEB_UPLOAD.md`, then implementor, then tester (authed-biz-web web-video live-fire as the CLOSE gate).
