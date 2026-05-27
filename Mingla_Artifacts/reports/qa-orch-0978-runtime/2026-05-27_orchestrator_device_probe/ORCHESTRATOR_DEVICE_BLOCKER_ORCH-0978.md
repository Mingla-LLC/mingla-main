# ORCH-0978 Orchestrator Device Probe + Blocker Report

> Date: 2026-05-27 (UTC)
> Author: Claude `mingla-orchestrator`
> Trigger: Operator dispatch to run T-11 + T-12 runtime proof on behalf of tester
> Result: **BLOCKED — same blocker as implementor rework-2 device probe (2026-05-26 20:25 UTC)**

## Required runtime evidence (from QA_RETEST §14)

1. Android upload via real device or emulator with actual event-cover video flow
2. Cloudinary processed URL / job trace from that upload
3. **Physical iPhone native** playback of the resulting Cloudinary URL (NOT simulator — explicitly rejected by tester)
4. **Safari iOS** playback of the same URL on the same physical iPhone
5. Android cold-load screenshot or video of the actual event-cover video surface proving poster/first-frame paints (T-12)

## Device-state snapshot (this turn)

Captured at `raw_device_state.txt` in this directory. Summary:

| Probe | Result | Required | Status |
|---|---|---|---|
| `adb devices -l` | empty (zero devices) | At least one Android device or AVD | **MISSING** |
| `emulator -list-avds` | `META_ORCH_0972_Pixel_7_API35`, `Pixel_8_Pro` | Installed AVDs (boot not yet attempted) | AVDs available, not booted |
| `xcrun xctrace list devices` | Mac itself + 14 simulators; NO physical iPhone | At least one physical iPhone | **MISSING** |
| `xcrun simctl list devices booted` | iPhone 17 Pro + iPhone 17 (simulators) | Physical iPhone (sim explicitly rejected) | **SIMULATOR-ONLY** |

## Why this turn cannot satisfy the dispatch

The dispatch asks me to "connect a valid Android upload target and a physical iPhone, then confirm they show up with `adb devices -l` and `xcrun xctrace list devices`." **I cannot physically connect hardware to the operator's machine.** The implementor's rework-2 probe at `2026-05-27_rework2_device_probe/DEVICE_PROBE_ORCH-0978_REWORK_2.md` hit this exact blocker ~5 hours ago and stopped before manufacturing evidence. The honest move is the same here — STOP and report.

Producing fake evidence (simulator playback as if it were physical, emulator screenshots as if they were Android-encoded uploads) would violate:

- Tester QA report §11 explicit refusal: *"iOS — No physical proof — FAIL — Physical iPhone not connected; simulator screenshot is not sufficient."*
- Memory rule `feedback_always_simulator_repro_described_behaviour.md` — source-only / sim-only claims have a confidence ceiling of "suspected", never "proven"
- The PURPOSE of T-11 — RESEARCH issue #268 (`react-native-compressor` Android output unplayable on iOS) requires HARDWARE encoder output, which simulators can't produce

## Three unblock paths Seth can choose

**Path U1 — Physical hardware (RECOMMENDED for true T-11/T-12 proof):**
1. Connect one Android device via USB with developer-options USB-debugging enabled. Verify with `adb devices -l`.
2. Connect one physical iPhone via USB-C/Lightning + trust the Mac. Verify with `xcrun xctrace list devices` (should list iPhone before "== Simulators ==").
3. Confirm both visible, then re-dispatch this turn.

**Path U2 — Emulator/sim substitute (FAST, KNOWN-WEAKER):**
1. Boot `Pixel_8_Pro` AVD (`emulator -avd Pixel_8_Pro &`).
2. Use existing iPhone 17 Pro simulator (already booted).
3. Re-dispatch with EXPLICIT operator acceptance that:
   - Sim/emu playback is NOT the same as physical-hardware playback per memory rule
   - The T-11 issue #268 concern (`react-native-compressor` Android output unplayability on iOS hardware) will NOT be conclusively answered
   - CLOSE proceeds as CONDITIONAL PASS with the open risk recorded in the close banner

**Path U3 — Defer ORCH-0978 CLOSE entirely:**
1. Park the ORCH-0978 branch as-is (code green, automated gates green, runtime physical proof PENDING).
2. Re-dispatch T-11/T-12 + CLOSE the next time Seth has both devices physically connected.
3. Other ORCHs proceed in the meantime.

## Recommendation

**Path U1.** ORCH-0978 ships a new native module + a cross-platform render contract; the issue #268 unplayability concern is precisely what physical-hardware T-11 is designed to catch. CLOSE-on-Path-U2 risks shipping a regression that automated gates and sim runs cannot detect. ~10 minutes of cable-plugging beats discovering an Android-uploads-broken-on-iOS bug in production.

## What is NOT in scope this turn

- Re-running automated gates (already green in QA_RETEST §13 row "Edge/unit gates")
- Re-deploying edge functions (orchestrator-owned but blocked behind runtime PASS per dispatch)
- Routing to Codex tester-mingla (cannot — they'd hit the same device blocker)
- Writing a fake "PASS by sim" artifact (memory-rule violation)

## Audit trail

This artifact + the device-state snapshot are committed to the per-ORCH branch as evidence of due diligence. The orchestrator did NOT proceed to fabricate evidence or downgrade the verdict. Status remains: **runtime PASS still PENDING; cause: physical hardware not connected.**
