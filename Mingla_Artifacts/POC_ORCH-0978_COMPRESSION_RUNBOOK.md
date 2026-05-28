# ORCH-0978 PoC Runbook — physical-device compression measurement

**Goal:** validate the SPEC's assumption that `react-native-compressor`'s `auto` preset compresses a 30s 1080p iPhone clip in 5–15 seconds with output quality indistinguishable from source.

**Mode:** physical device (iPhone) — accept caveats per RESEARCH §Q1 that sim numbers don't reflect real hardware.

**Outcome:** 1 PASS/FAIL verdict that gates IMPLEMENT proceeding to Steps 2–10 of the SPEC.

---

## Pre-flight — ONE-time housekeeping (operator, ~2 minutes)

Run this against production Supabase via the SQL editor (or psql) to clear the 2 stuck `source_uploading` rows + the 7 stale cancelled rows surfaced by SPEC Amendment 2:

```sql
DELETE FROM public.event_cover_video_jobs
WHERE status IN ('source_uploading', 'cancelled')
  AND created_at < '2026-05-12';
```

Confirm by running:

```sql
SELECT status, COUNT(*) FROM public.event_cover_video_jobs GROUP BY status;
```

Expected: zero rows total after cleanup.

---

## Step 1 — Install dependencies + prebuild (operator, ~5–10 minutes)

This worktree already has `react-native-compressor` added to both `package.json` files (committed alongside this runbook). You need to actually install it + regenerate the native projects.

```bash
cd ~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business

# REMOVE the node_modules symlink (per worktree-per-orch-workflow memory rule).
# If node_modules is a symlink to anchor's node_modules, installing into it would
# corrupt the anchor for every parallel orchestrator. We need a real install here.
[ -L node_modules ] && rm node_modules

npm install

# Regenerate the iOS + Android native projects to pick up the react-native-compressor plugin.
npx expo prebuild --clean
```

If `expo prebuild` succeeds, you're ready to build the dev client.

---

## Step 2 — Build a fresh dev client to your physical iPhone (operator, ~5–15 minutes)

**Use the iOS dev-build rebuild runbook** at `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` if you want the local 3-step xcodebuild + embed-frameworks + codesign recipe (~3 min after first run, faster than EAS).

**OR use EAS:**

```bash
cd ~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business
npx eas build --platform ios --profile development --local
# When complete, drag-drop the .ipa onto your physical iPhone via Xcode → Devices, OR install via TestFlight if your dev profile is wired up.
```

Plug iPhone in. Open the freshly-built `MinglaBusinessDev` (or whatever the dev variant is named).

---

## Step 3 — Run the measurement (operator, ~5 minutes)

Start Metro in one terminal so you can see the JSON log output:

```bash
cd ~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business
npx expo start --dev-client --port 8090
```

(Port 8090 per this worktree's Metro assignment in `Mingla_Artifacts/WORKTREE_REGISTRY.md`.)

On iPhone, open the dev client. Either:

- (a) **Tap "Enter URL manually"** in the dev-client launcher → enter `mingla-business://compression-poc`, OR
- (b) **Scan the Metro QR code** to launch, then navigate to `/compression-poc` via Safari deep link `mingla-business://compression-poc`, OR  
- (c) **Edit `app/index.tsx` or any existing screen** to add a temporary `<Link href="/compression-poc">PoC</Link>` button. Easiest if the deep link doesn't work.

The screen shows one button: "Pick video + measure".

### Test runs (3 total)

For each test, record a fresh video on the iPhone Camera app (Settings → Camera → Format → "High Efficiency" for HEVC, or "Most Compatible" for H.264), then tap "Pick video + measure" → select that clip. Watch the on-screen result.

| Test | Source clip recipe | What to record |
|---|---|---|
| **A** | 30 seconds, 1080p HEVC (iPhone default since iPhone 7) | Source MB / Output MB / Elapsed s / Quality (same/worse) |
| **B** | 15 seconds, 1080p HEVC | Same |
| **C** | 30 seconds, 1080p H.264 (toggle Settings → Camera → Format → "Most Compatible" first) | Same |

For each test, also check the Metro console — the log line `[ORCH-0978-POC] {...}` confirms numbers reached the harness.

### Report back to orchestrator

Paste this filled-in table into chat:

```
Device: iPhone <model> (iOS <version>)
                  Source MB    Output MB    Time (s)    Quality (same/worse)
Test A (30s HEVC)  ___          ___          ___         ___
Test B (15s HEVC)  ___          ___          ___         ___
Test C (30s H264)  ___          ___          ___         ___
```

---

## Step 4 — Interpretation (orchestrator)

| Outcome | Verdict | Next |
|---|---|---|
| All 3 tests ≤15s + Quality "same" | **PASS** | Wait for ORCH-0964 merge → dispatch IMPLEMENT Step 2+ |
| Any test 15s–30s + Quality "same" | **CONDITIONAL PASS** | SPEC budget tightens; IMPLEMENT proceeds with reduced quality target (drop to `bitrate: 1500000` manual mode) |
| Any test >30s OR Quality "worse" | **FAIL** | SPEC amendment required — switch to per-platform native modules (custom Expo modules wrapping `AVAssetExportSession` on iOS + `MediaCodec` on Android). Significant SPEC rework. |

---

## Step 5 — Cleanup after PoC (operator + orchestrator)

After numbers are captured and the verdict is reached:

1. **Delete the PoC screen:** `rm mingla-business/app/compression-poc.tsx`
2. **Keep the `react-native-compressor` install** — it's part of SPEC Step 1 of IMPLEMENT and we already did it. (Don't revert package.json.)
3. **Delete this runbook** OR archive it under `Mingla_Artifacts/archive/` for future reference if you anticipate re-running for brand cover / trip cover / profile video PoCs.

---

## Troubleshooting

**`npm install` fails after symlink removal:**
- The node_modules symlink protects the anchor from concurrent writes. After removing it, a fresh install is slower (~3-5 min) but safe.
- If install fails with peer-dep warnings about `react-native-compressor`, run `npm install --legacy-peer-deps`.

**`expo prebuild --clean` warns about manifest conflicts:**
- Expected if `app.json` has been hand-edited recently. The prebuild regenerates from `app.json` + `app.config.ts` — accept the warnings.

**Dev client launches but compression-poc route returns 404:**
- The `app/compression-poc.tsx` file uses Expo Router's auto-routing. Confirm the file exists. If routing is stuck, restart Metro with `--clear`.

**`react-native-compressor` throws "Native module not found" on launch:**
- The plugin wasn't picked up. Re-run `npx expo prebuild --clean` and rebuild the dev client.

**Compression hangs at 0% for 30+ seconds before progressing:**
- Normal on first run (codec warm-up). Subsequent runs are faster.
- If it hangs >2 minutes, kill the app, restart, try again with a smaller source clip.

**Output video doesn't play in the on-screen `<VideoView>`:**
- expo-video #39962 first-frame-black bug. The compression still completed; check the elapsed time number. Try sharing the file URI to Photos to verify playability.

---

## Memory + invariants this PoC validates

- I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW (DRAFT) — local-URI preview pattern is implicitly tested when source plays back in the screen.
- I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT (DRAFT) — the PoC playback uses muted=false intentionally so quality eyeball includes audio; this is a test-specific override and does NOT precedent for production.

No CI gates touched by this PoC.
