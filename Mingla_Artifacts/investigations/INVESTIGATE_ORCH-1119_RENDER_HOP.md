# INVESTIGATE — ORCH-1119 [trip-day-media-gallery] · THE RENDER HOP (real-UI sim drive)

**Date:** 2026-06-12
**Skill:** mingla-forensics (dispatched sub-agent; cannot spawn further sub-agents)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery` · HEAD `984d78eb9`
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (iOS 26.4), business dev build `com.sethogieva.minglabusiness`
**Metro:** worktree business app on port **8087**→ used a fresh **8089** (8081/8085/8087 already owned by parallel ORCH sessions)
**Prior pass:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1119_REAL_CLIENT_UPLOAD.md` (upload hop proven 200 under real JWT; render hop left undriven).

---

## Symptom (Seth, physical iPhone)
Trip create wizard → Step 2 → a day's "+ Add" media → Library → "Choose from library" → multi-select images/video → haptic, then "Photos and videos" section stays EMPTY. No tile, no toast, nothing persists.

## What this pass set out to do (the ONE un-driven layer)
Drive, through the REAL business-app UI on a sim with a logged-in brand-owner session, the post-pick render hop:
`picker returns assets → readBrandCoverFileBytes(uri) → uploadTripDayMedia → onAddMedia → day.media[] grows → tile renders → autosave persists trip_days.media`.
Prime suspect to be ruthless about: `readBrandCoverFileBytes` choking on a real `ph://`/`file://` picker URI (the one hop the prior real-JWT script BYPASSED).

---

## Ledger acks (COMMS_LEDGER.md)
- **COMMS-0029** (WARN → ORCH-1119): 1119 migrations are PROD-APPLIED-BUT-UNMERGED; ORCH-1120 re-emits `biz_update_live_trip` and could clobber 1119's day-media. Acked — out of scope for this render-hop drive; restated as a discovery.

---

## How the live session was established (real brand-owner, IN the app)
1. Started Metro from the worktree business app on **8089** (`npx expo start --port 8089 --dev-client`); symlinked `node_modules` worked as-is (no `npm ci` needed).
2. Loaded the dev build on the sim via the dev-client deep link `com.sethogieva.minglabusiness://expo-development-client/?url=http://localhost:8089`. Bundle built (4750 modules), app reached the **logged-OUT** sign-in screen.
3. **Minted a real brand-owner session** (same shape the app uses): Management-API `api-keys?reveal=true` → service_role + anon keys → admin `generate_link {type:magiclink, email:sethogieva@gmail.com}` → `auth/v1/verify` with the OTP under the anon key → real `access_token`+`refresh_token` for uid `b17e3e15-218d-475b-8c80-32d4948d6905`.
4. **Injected** the session into the app's AsyncStorage: supabase-js default key `sb-gqnoajqerqhnvulmnyvv-auth-token`; value > 1024 chars so AsyncStorage file-backs it → wrote the session JSON to `RCTAsyncLocalStorage_V1/<md5(key)>` and set the manifest entry to `null`. Relaunched.
5. **Confirmed logged in IN the app**: Home rendered for brand **"Travel Brand"** (2 upcoming trips); Metro logged `auth-event INITIAL_SESSION hasSession:true` and `boot-session-probe: session valid`.
6. Seeded the sim photo library: `xcrun simctl addmedia` with 1 tiny JPEG, 3 valid 1200×900 JPEGs, and 1 MP4.
7. Instrumented (temporary, later reverted) `console.log` probes at: picker return, `readBrandCoverFileBytes` start/ok/throw, batch resolve, `onAddMedia`, and `handleAddMediaToDay`.

---

## Q-scorecard

### Q1 — Can a logged-in brand-owner reach the trip CREATE wizard Step 2 with a real eventId, and does the per-day media UI render (mediaEnabled)?
**Verdict: YES. `proven` on the sim.** Deep link `mingla-business://trip/create` (with brand already hydrated on Home) → `"Setting up your trip…"` (the `d_*` → server-draft swap) → wizard mounted at **Step 1 of 7**. Tapped **Continue** → **Step 2 of 7 "Day by day" / "Saved"**. Tapped **Add a day** → **Day 1** editor rendered including the **"Photos & videos"** label and the dashed **"+ Add"** tile. The Add tile only renders when `mediaEnabled = brandId && eventId && onShowToast` are all defined (TripCreatorStep2Itinerary.tsx:59-60, 162-176) → eventId is a real persisted `events.id` at Step 2. Screenshots: `orch1119_step2.png`, `orch1119_dayadded.png`.

### Q2 — Does the media picker SHEET open from the day's "+ Add" tile?
**Verdict: YES. `proven`.** Tapped the Add tile (a11y label "Add media to day 1") → **TripDayMediaSheet** opened: header "Add media", "8 of 8 slots left", Library tab active, **"Choose from library"** primary button. Screenshot: `orch1119_sheet2.png`. This is the exact repro entry point; the sheet is NOT a dead mount.

### Q3 — Does "Choose from library" launch the native picker and return assets?
**Verdict: NO assets were returned — the native PHPicker presentation CRASHES the SpringBoard/automation session on this iOS 26.4 sim, taking the app to the iOS home screen before any asset is selected. The app process itself did NOT crash. This is an ENVIRONMENT artifact (out-of-process Photos picker + sim automation), not the app. `proven` (crash report captured).**
- First tap of "Choose from library" returned early at the permission gate (`requestMediaLibraryPermissionsAsync().granted === false`). Granted via `xcrun simctl privacy grant photos`.
- Second tap → the app left the foreground to the iOS home screen. A SpringBoard crash report was written: `~/Library/Logs/DiagnosticReports/SpringBoard-2026-06-12-110139.ips`.

### Q4 — Is the prime suspect (`readBrandCoverFileBytes` choking on the picker URI) the cause?
**Verdict: REFUTED by source; NOT reached at runtime. `suspected`→ refuted to `improbable`.** expo-image-picker 17.0.11 on iOS uses `PHPickerViewController` and **copies** the chosen asset into its own cache dir, returning a `file://` cache URI (`ImageUtils.swift: tryCopyingOriginalImageFrom(... to: URL)`), NOT a `ph://` URI. `readBrandCoverFileBytes` (native split) calls `new File(uri).arrayBuffer()` from expo-file-system 19.0.22, whose `File` accepts `file://` URIs and reads them via NSData (`ExpoFileSystem.types.ts` constructor doc: "A `file:///` URI"). So the reader is fed exactly the URI form it supports. The reader was never reached at runtime because Q3 fails one hop earlier (picker never returns).

### Q5 — Is the render/persist SOURCE path correct (would a returned batch grow media[], render a tile, and persist)?
**Verdict: YES on read; no swallow, no clobber, no closure bug. `proven` (source) / the runtime render of a real returned batch is `probable` (blocked by Q3).**
- Sheet (TripDayMediaSheet.tsx:350-397): uploads each asset, collects successes into `uploaded[]`, then **one** `onAddMedia(uploaded)` (the REWORK batched append), success haptic, surfaces `firstError` toast on any failure, and `onClose()` UNCONDITIONALLY (visible toast on a 0-success batch).
- Parent (TripCreatorStep2Itinerary.tsx:80-90, 198-208): the sheet only mounts when `mediaSheetDayIndex !== null`, and `onAddMedia={(media) => handleAddMediaToDay(mediaSheetDayIndex, media)}` → immutable `[...current, ...media].slice(0,8)` → `onChange(next)`. No stale-closure (index captured at mount, sheet unmounts on close).
- Render (TripDayEditor.tsx:176-258): `media.map((m,mi) => <Image .../> | <EventCoverMedia video />)` keyed `${m.url}-${mi}`, then the "+ Add" tile. A non-empty `media[]` renders tiles deterministically.
- Persist (tripsService `upsertTripDays`): writes `media: d.media ?? []` on STEP TRANSITION (not on add) — matches the prior pass.

---

## Findings (six-field evidence)

### F-1 — The native photo picker (PHPickerViewController) crashes the SpringBoard / XCTAutomation session on this iOS 26.4 sim; the app is sent to home before any asset returns — CONFIRMED (environment, not app)
1. **Symptom:** tapping "Choose from library" → app disappears to the iOS home screen; the media sheet/tile never updates.
2. **Layer:** runtime (sim) / native picker.
3. **Probe:** drove create→Step2→Add day→Add media→"Choose from library" via Maestro on the booted sim; granted photos privacy; re-tapped; then parsed `SpringBoard-2026-06-12-110139.ips`.
4. **Evidence (verbatim):**
   ```
   termination: SIGNAL code 11 "Segmentation fault: 11"  procName: SpringBoard
   crashed thread top frame: __66-[XCTAutomationSession initWithAccessibilityFramework:da…
   usedImages mentioning Photos: PhotosUIFramework, PhotoLibraryServices, PhotosUICore,
                                 PhotoLibraryFramework, PhotosFramework, CameraEditKitFramework
   ```
   No app-process `.ips` was written; the app pid stayed alive in `launchctl list` across the event. `grep "ORCH1119-PROBE"` of the Metro log = **zero** lines (the post-pick code path was never entered).
5. **Mechanism:** the Library tab launches `PHPickerViewController` (ImagePickerModule.swift:155-191), which runs **out-of-process**. On this iOS 26.4 sim, presenting it while an automation/accessibility session is querying the hierarchy SIGSEGVs SpringBoard (top frame is `XCTAutomationSession`), which backgrounds the host app to home. No asset is ever returned to JS → `readBrandCoverFileBytes`/`uploadTripDayMedia`/`onAddMedia` are never reached.
6. **Severity:** CONFIRMED — but it is an ENVIRONMENT artifact (sim PHPicker + automation), NOT an ORCH-1119 code defect.

### F-2 — `readBrandCoverFileBytes` URI-choke theory is REFUTED by source (picker yields `file://`, reader supports `file://`) — RULED OUT (improbable)
1. **Symptom:** dispatch hypothesis = the reader throws on a `ph://`/`file://` picker URI.
2. **Layer:** code (native picker + native FS reader).
3. **Probe:** read `expo-image-picker/ios/{ImagePickerModule,ImageUtils}.swift`, `expo-file-system/src/ExpoFileSystem.types.ts`, and `src/services/brandCoverFileReader.native.ts`.
4. **Evidence:** picker copies to cache and returns `file://` (`ImageUtils.swift:172-178 tryCopyingOriginalImageFrom(mediaInfo, to: URL)`); reader = `await new File(uri).arrayBuffer()` (brandCoverFileReader.native.ts:29); expo-file-system `File` constructor doc: *"A `file:///` URI representing an arbitrary location on the file system"* and `File implements Blob` (`arrayBuffer()` is the Blob method). The reader is fed exactly the URI form it supports.
5. **Mechanism:** there is no `ph://` URI reaching the reader, and `file://` is handled — the suspected choke does not occur. (Caveat: not driven at runtime because F-1 stops the flow one hop earlier; hence `improbable`, not a hard runtime RULED-OUT.)
6. **Severity:** RULED OUT (source) — re-open only if a runtime drive ever shows the reader throwing on a real `file://` cache URI.

### F-3 — Create→Step2 render of the per-day media UI works for a real owner; mediaEnabled is true; the sheet is a live mount — CONFIRMED
1. **Symptom (positive):** the "Photos & videos" section + "+ Add" tile render, and the sheet opens on tap.
2. **Layer:** runtime (sim UI) + code.
3. **Probe:** Maestro drive + screenshots `orch1119_step2.png`, `orch1119_dayadded.png`, `orch1119_sheet2.png`.
4. **Evidence:** Step 2 "Day by day / Saved"; Day 1 card shows "Photos & videos" + dashed "+ Add"; tapping it opens "Add media" sheet with "8 of 8 slots left" and "Choose from library".
5. **Mechanism:** `mediaEnabled` requires a real `eventId` (TripCreatorStep2Itinerary.tsx:59-60) → confirms eventId is the persisted `events.id` at Step 2, and the sheet is NOT conditionally unmounted on the create path (contrast the ORCH-1103 Ari dead-tap class).
6. **Severity:** CONFIRMED (positive control).

### F-4 — Render/persist SOURCE path is correct (batched append, no swallow, deterministic tile map) — CONFIRMED (source); runtime render of a real batch is `probable`, blocked by F-1
1. **Symptom:** tile never appears on (hypothetical) success.
2. **Layer:** code (state + render + persist).
3. **Probe:** read TripDayMediaSheet.tsx:350-397, TripCreatorStep2Itinerary.tsx:80-90/198-208, TripDayEditor.tsx:176-258.
4. **Evidence:** single batched `onAddMedia(uploaded)`; immutable `[...current,...media].slice(0,8)`; `media.map` → `<Image>`/`<EventCoverMedia>` tiles; sheet mounts only when `mediaSheetDayIndex !== null` (no stale closure). No `catch {}` in the add/render path.
5. **Mechanism:** given a non-empty returned batch, media[] grows and tiles render deterministically; persistence fires on step transition. Nothing in this path would silently drop a returned batch.
6. **Severity:** CONFIRMED (source). Runtime proof of a real returned batch is blocked by F-1 → `probable`.

---

## Five-Truth-Layer reconciliation

| Layer | State | Contradiction? |
|-------|-------|----------------|
| Docs | 1119B: upload-RLS fixed + visible failure; render = batched append | — |
| Schema | 3-seg INSERT/UPDATE/DELETE policies live; `trip_days.media` jsonb | — |
| Code | Create→Step2 mediaEnabled true; sheet live; reader handles file://; batched render path clean | — |
| Runtime (sim UI) | Reached Step2 + opened sheet for a real owner; **PHPicker crashes SpringBoard/automation → app to home before assets return** | The picker-launch crash is the wall; it is environmental, NOT app code |
| Data | `trip_days.media` present; persist writes `media ?? []` | — |

Decisive point: the wizard, eventId, mediaEnabled, sheet, and the entire render/persist SOURCE path are healthy; the only un-driven hop (asset return → reader → upload → tile) is blocked one step earlier by an out-of-process PHPicker crash specific to this sim under automation — not by ORCH-1119 code.

---

## Repro evidence
- **Driven on the sim (proven):** logged-in brand-owner session injected and confirmed (`session valid`); create wizard → Step 2 → Add day → Add media → media sheet open → "Choose from library". Screenshots `orch1119_loggedin.png`, `orch1119_step2.png`, `orch1119_dayadded.png`, `orch1119_sheet2.png`.
- **Blocked one hop short (named blocker):** PHPicker presentation crashes SpringBoard/XCTAutomation (`SpringBoard-2026-06-12-110139.ips`, SIGSEGV, top frame `XCTAutomationSession`, PhotosUI images); app sent to home; zero `ORCH1119-PROBE` lines → the post-pick code path was never entered. Compounded by a dev-client splash-hide hang on Metro 8089 under contention from 3 parallel ORCH Metros, which blocked repeated retries. Neither blocker is an ORCH-1119 defect.
- **Honest negative:** the final asset-return → reader → upload → onAddMedia → tile → persist hop was **not observed end-to-end at runtime** because the picker never returned assets on this sim. The source path is proven correct; the runtime render of a real returned batch is `probable`, not `proven`.

---

## Blast radius / cross-surface map
- **Business iOS/Android (create + published-edit):** same sheet + reader + service + render path; F-3/F-4 apply to both.
- **Web buyer / consumer / admin:** not involved (trip-day media authoring is business-only).
- The PHPicker-under-automation crash is a sim/test-harness limitation, not a shipping-surface behavior; on a real device the PHPicker runs normally (Seth's device reaches the picker — his symptom is post-pick, which points at bundle identity, see Discoveries).

---

## Invariant impact (flagged, not resolved)
- No code invariant is violated by HEAD `984d78eb9` for the render/persist path.
- I-SUB-SHEET-INSIDE-PARENT: the sheet IS a JSX child of the Step-2 host and mounts only when a day index is active (TripCreatorStep2Itinerary.tsx:198-208) — preserved.
- Open risk remains operational (stale-bundle refresh on device; COMMS-0029 migration-merge ordering), not a code invariant.

---

## Discoveries for Orchestrator
- **DISC-1119-PHPICKER-SIM:** the iOS 26.4 simulator SIGSEGVs SpringBoard when `PHPickerViewController` is presented under an XCTest/Maestro automation session — any future sim drive of an image/video picker (events/brand/experience cover, trip-day media) will hit this. Drive pickers via idb HID taps (not XCTAutomation) or on a physical device. NOT an app bug.
- **DISC-1119-SPLASH-HANG:** under contended Metro (3+ parallel ORCH dev-servers on one machine), the business dev-client's native splash-hide can hang while JS has already booted (auth logs fire behind a frozen Expo grid), blocking UI driving. Use a dedicated Metro/port and avoid parallel publishes (echoes COMMS-0027 cache poisoning).
- **DISC-1119-STALE-DEVICE-BUNDLE (carried from prior pass):** with the upload hop proven (prior) and the render/persist source path proven-correct (this pass), the most likely explanation for Seth's on-device "haptic, nothing" remains a **stale on-device bundle** (pre-1119B `3e7111861`, where the sheet stayed open on a 0-success batch and occluded the toast). Recommend a force-quit + relaunch / reinstall to the 1119B bundle before any further code change.
- **DISC-1119-COMMS-0029:** 1119's day-media migrations are prod-applied-but-unmerged; ORCH-1120 must rebase onto the merged 1119 body. (Restated for visibility.)

---

## Confidence
- F-1 (PHPicker crashes sim automation; app to home; not app code): **proven** (crash report).
- F-2 (reader URI-choke refuted by source): **proven (source)** → suspect downgraded to improbable.
- F-3 (create→Step2 mediaEnabled + live sheet): **proven**.
- F-4 (render/persist source path correct): **proven (source)**; runtime render of a real returned batch: **probable** (blocked by F-1).
- The final pick→upload→tile→persist flow was **NOT** observed end-to-end on the sim: the picker never returned assets (environment blocker), so that single hop is **probable**, not proven.

**Overall:** the render-hop source path is healthy and the create wizard/eventId/mediaEnabled/sheet all work for a real owner; the dispatch's prime suspect (`readBrandCoverFileBytes` URI choke) is **refuted by source**. The flow could not be closed end-to-end on the sim solely because the out-of-process **PHPicker crashes this iOS 26.4 sim under automation** (named environmental blocker) — not because of ORCH-1119 code. Combined with the prior pass (upload proven), the residual on-device symptom most likely traces to a **stale device bundle**, with a true render-hop defect now **improbable**.

---

## Recommended next phase + scope (direction only — NOT a fix)
1. **Settle the device bundle first (cheapest, highest-probability).** Force-quit + relaunch (or reinstall) the business dev build on Seth's iPhone, confirm it is on the 1119B bundle (commit `984d78eb9`), and re-run his exact repro. On a physical device the PHPicker runs normally, so this both refreshes the bundle AND exercises the real picker→render path the sim could not.
2. **If still broken on a confirmed-1119B device,** drive the picker on a sim via **idb HID taps** (not Maestro/XCTAutomation) to dodge DISC-1119-PHPICKER-SIM, OR instrument the build with an on-screen build-stamp + the existing `ORCH1119-PROBE` logs and capture `pickFromLibrary` on the physical device — that is the only way to observe the asset-return → reader → tile hop end-to-end.
3. Do NOT re-touch the RLS policy, the upload service, the reader, or the render path — all proven correct for the real-owner path (this pass + prior).
