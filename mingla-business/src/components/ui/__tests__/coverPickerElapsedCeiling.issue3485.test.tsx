/**
 * Issue #3485 [stuck cover video] — the elapsed reading has a ceiling.
 *
 * Filmed on a Release build (2026-09-20): a card still rendering "Processing
 * video…" for a job the server had already applied showed an elapsed value of
 * **4758m** — three days and seven hours — over a thumbnail that was already the
 * finished cover. That number measures nothing; it is the symptom of a phase that
 * never settled, and printing it tells the host their upload has been running
 * since Wednesday.
 *
 * The real fix for the phase is the foreground re-check in
 * `useEventCoverVideoUpload` (see
 * `useEventCoverVideoUpload.foregroundRecheck.issue3485.test.ts`). This is the
 * belt on top of it, for a client that cannot reach the server to learn better:
 * past the ceiling the honest reading is NO reading, which is what this hook
 * already returns for a missing or unparseable start (#3173).
 *
 * Exercises the hook for real — CoverPicker.tsx itself cannot be mounted under
 * jest (expo-video / expo-image-picker / react-native-video-trim), which is why
 * the reading lives in its own module.
 */
import React from "react";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { ELAPSED_CEILING_MS, ELAPSED_TICK_MS, useElapsedSince } from "../coverPickerElapsed";

// react-test-renderer ships no type declarations in this repo and adding
// @types/* would move package authority for one test file. It IS installed
// (mingla-business/package.json) and the probe below renders null — no host
// components — so it runs cleanly under the default node test environment. Same
// arrangement as coverPickerElapsed.issue3173.test.tsx.
type Renderer = { update: (el: React.ReactElement) => void; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Renderer;
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const START = "2026-09-17T02:41:00.000Z";
const START_MS = Date.parse(START);

const Probe: React.FC<{ startedAt: string | null; active: boolean; sink: (v: string | null) => void }> =
  ({ startedAt, active, sink }) => {
    sink(useElapsedSince(startedAt, active));
    return null;
  };

const renderProbe = (
  startedAt: string | null,
  active: boolean,
): { latest: () => string | null; unmount: () => void } => {
  let latest: string | null = null;
  const sink = (v: string | null): void => { latest = v; };
  let renderer: Renderer;
  act(() => {
    renderer = create(<Probe startedAt={startedAt} active={active} sink={sink} />);
  });
  return {
    latest: () => latest,
    unmount: () => { act(() => { renderer.unmount(); }); },
  };
};

describe("issue #3485 elapsed ceiling", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(START_MS); });
  afterEach(() => { jest.useRealTimers(); });

  test("the ceiling is the server's own stall deadline for a cover job", () => {
    // 12 hours. Past it the reaper has given up on the job, so there is nothing
    // left to be timing.
    expect(ELAPSED_CEILING_MS).toBe(12 * 60 * 60 * 1_000);
  });

  test("THE BUG: the filmed 4758m reading is not rendered at all", () => {
    // 4758 minutes after the source was handed to the provider — the exact shape
    // of the card on camera.
    jest.setSystemTime(START_MS + 4_758 * 60_000);
    const probe = renderProbe(START, true);
    expect(probe.latest()).toBeNull();
    probe.unmount();
  });

  test("a genuinely long encode still reads, right up to the ceiling", () => {
    jest.setSystemTime(START_MS + ELAPSED_CEILING_MS);
    const atCeiling = renderProbe(START, true);
    expect(atCeiling.latest()).toBe("720m 00s");
    atCeiling.unmount();

    jest.setSystemTime(START_MS + ELAPSED_CEILING_MS + 1_000);
    const past = renderProbe(START, true);
    expect(past.latest()).toBeNull();
    past.unmount();
  });

  test("normal readings are untouched, and still advance every second", () => {
    const probe = renderProbe(START, true);
    expect(probe.latest()).toBe("0s");
    act(() => { jest.advanceTimersByTime(ELAPSED_TICK_MS * 95); });
    expect(probe.latest()).toBe("1m 35s");
    probe.unmount();
  });

  test("crossing the ceiling while mounted stops the reading rather than freezing a lie", () => {
    jest.setSystemTime(START_MS + ELAPSED_CEILING_MS - 2_000);
    const probe = renderProbe(START, true);
    expect(probe.latest()).toBe("719m 58s");
    act(() => { jest.advanceTimersByTime(ELAPSED_TICK_MS * 3); });
    expect(probe.latest()).toBeNull();
    probe.unmount();
  });

  test("the ceiling adds no timer of its own, and leaves none behind", () => {
    jest.setSystemTime(START_MS + ELAPSED_CEILING_MS * 2);
    const probe = renderProbe(START, true);
    expect(jest.getTimerCount()).toBe(1);
    probe.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
