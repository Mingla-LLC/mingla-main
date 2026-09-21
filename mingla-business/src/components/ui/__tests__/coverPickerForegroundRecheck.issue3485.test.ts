/**
 * Issue #3485 [stuck cover video] — regression 2 of 2: "Processing video…" never
 * settled after the app was backgrounded.
 *
 * Filmed on a Release build (2026-09-20). Server-side the job was finished —
 * `event_cover_video_jobs.status='applied'`, `events.cover_media_type='video'` —
 * and the foregrounded app still rendered "Processing video…" with an elapsed
 * timer at 4758m, over a thumbnail that was already the finished cover. Closing
 * and reopening the sheet did not clear it; only a full app restart did.
 *
 * WHY it could not clear itself: the sheet learns the truth in exactly three ways
 * — `useEventCoverVideoUpload`'s mount-time `resume()`, its live `watch()` poll,
 * and the `checkNow` read behind the "Check now" button, which `CoverPicker`
 * renders ONLY in the `detached` phase. There was no AppState listener anywhere
 * in the cover flow, so a `processing` card whose poll died while the app was
 * suspended had no route back to the server at all.
 *
 * Two layers, the convention this directory already uses:
 *   1. REAL LOGIC — `coverPickerVideoRecheck` is imported and exercised for real.
 *      CoverPicker.tsx pulls in expo-video / expo-image-picker /
 *      react-native-video-trim and cannot be mounted under jest (documented in
 *      `CoverPicker.selectedState.test.ts` and
 *      `coverPickerElapsed.issue3173.test.tsx`).
 *   2. SOURCE WIRING — the listener, the phase effect, the read they call, and
 *      the read's own settle in the hook. Each assertion fails on removing the
 *      signal this issue added.
 *
 * The timer half of this bug (4758m) is `coverPickerElapsedCeiling.issue3485`.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  RECHECKABLE_VIDEO_PHASES,
  shouldRecheckCoverVideo,
  VIDEO_RECHECK_MIN_INTERVAL_MS,
  type VideoRecheckState,
} from "../coverPickerVideoRecheck";

const UI = join(__dirname, "..");
const coverPickerSource = readFileSync(join(UI, "CoverPicker.tsx"), "utf8");
const recheckSource = readFileSync(join(UI, "coverPickerVideoRecheck.ts"), "utf8");
const hookSource = readFileSync(
  join(UI, "..", "..", "hooks", "useEventCoverVideoUpload.ts"),
  "utf8",
);

/** Source with whole-line comments removed, so prose cannot satisfy a check. */
const executable = (source: string): string =>
  source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

/** Every phase `useEventCoverVideoUpload` can put the card in. */
const ALL_PHASES = [
  "idle", "picking", "preparing", "validating", "compressing", "intent_pending",
  "uploading", "ack_pending", "processing", "reattaching", "detached", "ready",
  "applying", "applied", "error",
];

const fresh = (phase: string): VideoRecheckState => ({
  phase,
  checkInFlight: false,
  msSinceLastCheck: null,
});

describe("issue #3485 re-check rule (real logic)", () => {
  test("THE BUG: a card sitting in `processing` asks the server again", () => {
    expect(shouldRecheckCoverVideo(fresh("processing"))).toBe(true);
  });

  test("the `detached` card asks too — the same read its button performs", () => {
    expect(shouldRecheckCoverVideo(fresh("detached"))).toBe(true);
  });

  test("and NO other phase does", () => {
    const asks = ALL_PHASES.filter((phase) => shouldRecheckCoverVideo(fresh(phase)));
    expect(asks).toEqual(["processing", "detached"]);
    expect([...RECHECKABLE_VIDEO_PHASES]).toEqual(asks);
  });

  test("a terminal card is left alone — there is nothing to settle", () => {
    for (const phase of ["idle", "applied", "error"]) {
      expect(shouldRecheckCoverVideo(fresh(phase))).toBe(false);
    }
  });

  test("a phase with LOCAL work in flight is left alone — a settle must not race it", () => {
    // No server job exists yet in the first five; the last three have a local
    // operation mid-flight, and `reattaching` belongs to `resume`'s own deadline.
    for (const phase of [
      "picking", "preparing", "validating", "compressing", "intent_pending",
      "uploading", "ack_pending", "applying", "reattaching", "ready",
    ]) {
      expect(shouldRecheckCoverVideo(fresh(phase))).toBe(false);
    }
  });

  test("no storm: a read already in flight blocks the next one", () => {
    expect(shouldRecheckCoverVideo({ ...fresh("processing"), checkInFlight: true })).toBe(false);
    expect(shouldRecheckCoverVideo({ ...fresh("detached"), checkInFlight: true })).toBe(false);
  });

  test("no storm: a second foreground inside the window is refused, and after it is allowed", () => {
    const justRead = { ...fresh("processing"), msSinceLastCheck: 0 };
    expect(shouldRecheckCoverVideo(justRead)).toBe(false);
    expect(
      shouldRecheckCoverVideo({
        ...justRead,
        msSinceLastCheck: VIDEO_RECHECK_MIN_INTERVAL_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldRecheckCoverVideo({ ...justRead, msSinceLastCheck: VIDEO_RECHECK_MIN_INTERVAL_MS }),
    ).toBe(true);
  });

  test("a freshly opened sheet has no previous read to wait behind", () => {
    expect(shouldRecheckCoverVideo({ ...fresh("processing"), msSinceLastCheck: null })).toBe(true);
  });

  test("the window is a few seconds — long enough to absorb a burst, short enough to be useless as a poller", () => {
    expect(VIDEO_RECHECK_MIN_INTERVAL_MS).toBe(5_000);
  });

  test("the rule is pure — no React, no React Native, nothing to mount", () => {
    const body = executable(recheckSource);
    expect(body).not.toMatch(/from "react/);
    expect(body).not.toMatch(/\buseState\b|\buseRef\b|\buseEffect\b|AppState/);
  });
});

describe("issue #3485 re-check wiring (source)", () => {
  test("the picker listens for the app coming back to the foreground", () => {
    const body = executable(coverPickerSource);
    expect(body).toContain("AppState.addEventListener(\"change\", (next) => {");
    expect(body).toContain("if (next === \"active\") recheckVideoJobRef.current();");
    // Clean removal: the listener must not outlive the sheet.
    expect(body).toContain("return () => subscription.remove();");
  });

  test("the listener is installed once, not re-subscribed on every phase change", () => {
    const start = coverPickerSource.indexOf(
      "if (Platform.OS === \"web\") return;\n    const subscription = AppState",
    );
    expect(start).toBeGreaterThan(-1);
    // The effect that owns the listener closes on an EMPTY dependency list.
    const closes = coverPickerSource.indexOf("}, []);", start);
    expect(closes).toBeGreaterThan(start);
    expect(coverPickerSource.slice(start, closes)).toContain("subscription.remove()");
    expect(coverPickerSource).toContain("recheckVideoJobRef.current = recheckVideoJob;");
  });

  test("the web build is not asked for an AppState lifecycle it does not have", () => {
    const at = coverPickerSource.indexOf("const subscription = AppState.addEventListener");
    expect(at).toBeGreaterThan(-1);
    expect(coverPickerSource.slice(at - 300, at)).toContain("if (Platform.OS === \"web\") return;");
  });

  test("the sheet opening on a server-owned phase asks once as well", () => {
    // Keyed on `recheckVideoJob`, whose identity changes only with the phase and
    // the hook's `checkNow` — never with the watch's per-poll percent updates.
    expect(coverPickerSource).toContain("  useEffect(() => {\n    recheckVideoJob();\n  }, [recheckVideoJob]);");
    // Both are read off the hook's object at RENDER time: `videoUpload` is a
    // fresh object every render, so depending on it would rebuild the callback
    // every render and re-fire this effect on every poll tick.
    expect(coverPickerSource).toContain("const checkVideoJobNow = videoUpload.checkNow;");
    expect(coverPickerSource).toContain("const videoJobPhase = videoUpload.stage.phase;");
    expect(coverPickerSource).toContain("}, [checkVideoJobNow, videoJobPhase]);");
  });

  test("the rule decides, and the picker obeys it", () => {
    expect(coverPickerSource).toContain('from "./coverPickerVideoRecheck"');
    const start = coverPickerSource.indexOf("const recheckVideoJob = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = coverPickerSource.slice(start, coverPickerSource.indexOf("}, [checkVideoJobNow, videoJobPhase]);", start));
    expect(body).toContain("!shouldRecheckCoverVideo({");
    expect(body).toContain("phase: videoJobPhase,");
    expect(body).toContain("checkInFlight: videoRecheckInFlightRef.current,");
    // The in-flight flag is taken before the read and released after it, or a
    // slow read would let every later foreground through.
    expect(body).toContain("videoRecheckInFlightRef.current = true;");
    expect(body).toContain("videoRecheckInFlightRef.current = false;");
    expect(body.indexOf("videoRecheckInFlightRef.current = true;"))
      .toBeLessThan(body.indexOf("void checkVideoJobNow()"));
  });

  test("a read that cannot reach the server does not become an error card", () => {
    const start = coverPickerSource.indexOf("const recheckVideoJob = useCallback(");
    const body = coverPickerSource.slice(start, coverPickerSource.indexOf("}, [checkVideoJobNow, videoJobPhase]);", start));
    expect(body).toContain(".catch(() => {");
    // No notice, no toast, no stage write on failure — the card keeps its phase.
    expect(body).not.toContain("setVideoPickNotice");
    expect(body).not.toContain("onShowToast");
  });

  test("the read it calls is the one that settles the card, apply step included", () => {
    // The other half of the fix lives in the hook and predates this issue: this
    // pins that `checkNow` really is a canonical read routed through the settle,
    // so the foreground signal lands on `applied` rather than just re-rendering.
    const at = hookSource.indexOf("const checkNow = useCallback(");
    expect(at).toBeGreaterThan(-1);
    const body = hookSource.slice(at, hookSource.indexOf("}, [settleCanonical]);", at));
    expect(body).toContain("await settleCanonical(await fetchEventCoverVideoStatus(jobIdRef.current))");
    // And the settle is what applies a job that came back `ready`.
    const settle = hookSource.slice(hookSource.indexOf("const settleCanonical = useCallback("));
    expect(settle.slice(0, 900)).toContain("await applyEventCoverVideoJob(");
  });

  test("the elapsed reading cannot print an absurd value for a card like that", () => {
    // Belt on top of the signal, proven in coverPickerElapsedCeiling.issue3485.
    expect(readFileSync(join(UI, "coverPickerElapsed.ts"), "utf8"))
      .toContain("ELAPSED_CEILING_MS");
  });
});
