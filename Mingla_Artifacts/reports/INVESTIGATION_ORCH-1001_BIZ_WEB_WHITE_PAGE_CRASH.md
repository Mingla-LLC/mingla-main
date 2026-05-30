# ORCH-1001 — Business web white-page crash (investigation + fix)

**Severity:** S0-critical (launch-blocker) · **Class:** `regression` + `bug` + `architecture-flaw`
**Affected Surfaces:** business-web (Vercel `mingla-business` export at business.usemingla.com).
**Surfaces explicitly NOT in scope:** business-iOS / business-Android (native bundle is unaffected — the native trimmer still loads), consumer-iOS / consumer-Android (different app), admin-web (different app), buyer-web (same export, restored by the same fix — verified rendering).

## Symptom

Every visitor to https://business.usemingla.com/ saw a blank white page. HTTP shell + JS bundle both returned 200 — not a missing-asset / 404 problem.

## Root cause (proven)

Headless-browser reproduction of the live site captured one fatal page error at bundle-init:

```
TypeError: Cannot read properties of undefined (reading 'getEnforcing')
  at index-a5d93c70….js:1577 (module eval)
```

`getEnforcing` is `TurboModuleRegistry.getEnforcing('VideoTrim')` — emitted by `react-native-video-trim`. The package's module body runs that call at **import-eval time**. On web there is no native TurboModule runtime, so the call throws synchronously, the whole bundle init aborts, React never mounts, `#root` stays empty → white page.

The crash entered via [`CoverPicker.tsx`](../../mingla-business/src/components/ui/CoverPicker.tsx) which had an **eager top-level** `import NativeVideoTrim, { showEditor } from "react-native-video-trim";`. It shipped with commit `f09494612` ("Close ORCH-0989: unified cover picker"), deployed 2026-05-29 13:19 — the exact day the white page began.

Scan confirmed this was the ONLY ungated native-only static import in web-reachable code. `react-native-compressor` is already safe (lazy `require` inside a `Platform.OS === "web"`-gated function — its module body never executes on web).

## Fix

Metro platform split, matching the repo's existing `Sheet.web.tsx` / `BottomNav.web.tsx` convention:

- `coverPickerVideoTrimEditor.ts` — base (native) module: holds the `react-native-video-trim` import + the `showEditor`/subscription logic, byte-identical behaviour to the old inline implementation. Bundled on iOS/Android only.
- `coverPickerVideoTrimEditor.web.ts` — web stub: `trimVideoWithDedicatedEditor` resolves `null`, no native import. Metro resolves this for the web export, so `react-native-video-trim` is **absent from the web bundle entirely**.
- `CoverPicker.tsx` — imports the split module and calls it only behind the existing `Platform.OS !== "web"` gate.

**Web video upload is unchanged.** The in-app trimmer was always native-only by design (SC-7-Web-4): on web the raw clip uploads and the server (Cloudinary) trims/compresses to a browser-safe ≤29s MP4. The fix only removes the crash; the web upload path behaved this way before and after.

## Prevention (determinism)

New CI gate `orch-1001-no-native-turbomodule-in-web-bundle.mjs`: fails any **eager** top-level import of a native-only TurboModule package (`react-native-video-trim`, `react-native-compressor`) in web-reachable `mingla-business/{src,app}` unless it is a `.native.*` file or a base file with a `.web.*` sibling stub. Lazy runtime-gated `require` is correctly ignored. Self-test (5 cases) + npm-wiring check baked in. Wired as a job in `strict-grep-mingla-business.yml`.

## Evidence

- **Before:** live headless probe → `#root` length 0, 1 page error (VideoTrim getEnforcing).
- **After:** local web export of the fixed branch served + headless probe → `#root` length 5804, login screen renders ("MINGLA BUSINESS / List experiences…"), **0 page errors**, 0 failed requests. `grep` of all web chunks → 0 occurrences of `react-native-video-trim` / `getEnforcing('VideoTrim')`.
- **Fails-on-revert:** restoring the static import reintroduces the crash; the happy-path test + CI gate both fail.

## Step 0.5 regression tests

- Happy-path (implementor): `orch1001CoverPickerWebSplit.test.ts` — asserts no eager native import in CoverPicker.tsx (fails-on-revert), both split files exist, web stub holds no native import, web stub resolves null at runtime.
- Adversarial (tester, different angle): `orch1001NativeTurbomoduleGate.adversarial.test.ts` — drives the CI gate against planted hostile fixtures (eager import in plain file → FAIL; properly split pair → PASS; lazy require → ignored; missing npm wiring → FAIL) + asserts the shipped self-test passes.
- Repointed under `[TEST-MOD-APPROVED ORCH-1001]`: `CoverPicker.dedicatedTrimmer.test.ts` T-AMEND9-02 (cancel→no-upload contract now spans the split module + CoverPicker, both halves verified).

## Out of scope (flagged for META-ORCH-1002)

- Pre-existing baseline test failure `eventCoverVideoProcessingService.compression.test.ts` (`supabase.auth.getSession()` mock) — fails identically on `main`, untouched here.
- Speed: 8.79 MB single web bundle served `cache-control: max-age=0, must-revalidate` (no immutable caching on hashed assets).
- Reliability: dropdowns not loading / empty pages / multiple refreshes (data-layer determinism) — separate investigation.
