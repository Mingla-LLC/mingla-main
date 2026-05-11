# RUNTIME QA ORCH-0774A - Auth-Ready Brand Video Handoff Guards

Verdict: CONDITIONAL PASS - auth/brand/create runtime smoke passed; picker, fresh-login, autosave, and sign-out gates remain operator-unverified  
Date: 2026-05-10  
Tester mode: TARGETED / OPERATOR-ASSISTED RUNTIME  
Prompt: `Mingla_Artifacts/prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`

## Plain-English Verdict

The active simulator state does not reproduce the reported brand disappearance or create-draft auth crash. The app is authenticated, the Account screen shows the user's brands, and opening the create-event route lands in a usable server-backed wizard draft. A filtered simulator log check around that smoke did not show the forbidden `AuthSessionMissingError`, create-draft failure, autosave failure, or stale video-prep signatures.

This is still not a full runtime PASS because the operator-assisted steps that require native touch/picker/sign-out interaction were not performed in this pass. I cannot honestly certify image/GIF picker, video picker/processing, background autosave, fresh sign-in timing, or true sign-out cleanup without those actions being driven on the device.

## Runtime Setup

- Device: iPhone 17 Pro simulator.
- UDID: `17091E60-C3B6-4167-980D-60C348E177F6`.
- App bundle: `com.sethogieva.minglabusiness`.
- App display name: `mingla-business`.
- Data container: `/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Data/Application/C509364A-577E-42EE-8306-10422F6BD63B/`.
- Starting auth state: authenticated app UI visible.
- Starting selected brand: `Leggo This`.
- Screenshot evidence:
  - `/tmp/orch0774a-runtime-current.png`
  - `/tmp/orch0774a-create-smoke.png`

## Commands Run

```bash
xcrun simctl list devices booted
```

Result: PASS. Booted iPhone 17 Pro simulator found.

```bash
xcrun simctl listapps booted | rg -n "com\.sethogieva\.minglabusiness|CFBundleDisplayName|DataContainer" -C 2
```

Result: PASS. Installed app and data container identified.

```bash
xcrun simctl io booted screenshot /tmp/orch0774a-runtime-current.png
```

Result: PASS. Screenshot showed Account tab with populated `Your brands`.

```bash
xcrun simctl openurl booted 'mingla-business://event/create'
sleep 4 && xcrun simctl io booted screenshot /tmp/orch0774a-create-smoke.png
```

Result: PASS. Create route opened Event Creator Wizard Step 1 for `Leggo This` and showed `Server draft`.

```bash
xcrun simctl spawn booted log show --last 2m --style compact --predicate 'process == "minglabusiness" AND (eventMessage CONTAINS[c] "AuthSessionMissingError" OR eventMessage CONTAINS[c] "useCreateServerDraft" OR eventMessage CONTAINS[c] "useServerDraftAutosave" OR eventMessage CONTAINS[c] "Operation failed" OR eventMessage CONTAINS[c] "Finishing sign-in" OR eventMessage CONTAINS[c] "Server draft")'
```

Result: PASS for the filtered smoke window. No forbidden auth/create/autosave signatures were returned.

```bash
npm run test:orch-0774a
```

Result: PASS. 5 suites, 41 tests.

```bash
git diff --check
```

Result: PASS.

Note: Jest emitted the existing Watchman recrawl warning. It did not fail the gate.

## Runtime Coverage Matrix

| Gate | Status | Evidence |
| --- | --- | --- |
| Fresh login / brand honesty | PARTIAL PASS | Authenticated Account showed `Carry Test`, `Brand 3`, `Test Stripe`, and `Leggo This`; fresh signed-out to signed-in transition was not performed. |
| Brand-list honesty while logged in | PASS | Current screenshot shows populated brands instead of a false empty state. |
| Create event immediately after session restore | PARTIAL PASS | Deep link opened Step 1 `Server draft`; filtered log window showed no forbidden create/auth errors. Fresh-login immediacy was not performed. |
| Draft autosave after edit/background/foreground | UNVERIFIED | Requires operator to type into wizard and background/foreground the app. |
| Step 4 image/GIF upload | UNVERIFIED | Requires native picker interaction. |
| Step 4 video upload and processing handoff | UNVERIFIED | Requires native picker and media-processing interaction. |
| Step 4 failure recovery | UNVERIFIED | Requires safe induced processing/auth/network failure. |
| True sign-out cleanup | UNVERIFIED | Requires operator to sign out and inspect private-state cleanup. |

## Findings

No P0/P1 product blocker was reproduced in this runtime smoke.

### P2 - Full operator-assisted runtime proof remains incomplete

The report prompt explicitly requires native sign-in, picker, upload, autosave, and sign-out interactions. This tester pass could prove the current authenticated brand list and create-route smoke, but it did not drive the native media picker or sign-out UI. ORCH-0774A should not be fully closed solely on this report.

Required runtime steps before final close:

- Start from signed out, sign in normally, and confirm brands do not silently disappear during auth/query settling.
- Create an event immediately after sign-in and confirm no `AuthSessionMissingError` or create-draft operation failure.
- Edit wizard fields, background and foreground the app, then edit again and confirm no auth-missing autosave storm.
- On Step 4, upload an image or GIF and confirm preview rendering.
- On Step 4, upload a short video and confirm upload-intent/status/apply wait for auth-ready, clear progress correctly, and show a real processed cover or stage-specific failure.
- Induce a safe failure where practical and confirm the previous cover remains, inline retryable error appears, and loading clears.
- Sign out intentionally and confirm private brand/draft state clears.

## Verdict

CONDITIONAL PASS.

The auth/brand/create symptoms are clean in the available runtime smoke, and the focused ORCH-0774A regression suite still passes. The media-picker, autosave, fresh-login, and sign-out paths remain manual runtime gates, not failures.
