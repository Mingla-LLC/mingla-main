/**
 * #3173 — the processing card must prove it is alive.
 *
 * Operator report (2026-09-10, production): the cover sheet sat unchanged for
 * the whole encode and read as hung. It was not — the job finished in 73s — but
 * nothing on screen moved, because Bunny gives us no usable percentage for most
 * of the wait (its first encoding webhook carries progress 0, which
 * `mapEventCoverVideoStatus` now deliberately refuses to treat as determinate).
 *
 * Elapsed time is the remaining honest signal. These tests exercise the hook for
 * real — CoverPicker.tsx itself cannot be mounted under jest (expo-video /
 * expo-image-picker / react-native-video-trim), which is exactly why the logic
 * lives in its own module. The wiring assertions at the bottom cover the seam
 * the render test cannot reach.
 */
import { readFileSync } from "fs";
import { join } from "path";

import React from "react";
import { ELAPSED_TICK_MS, formatElapsed, useElapsedSince } from "../coverPickerElapsed";

// react-test-renderer ships no type declarations in this repo and adding
// @types/* would move package authority for one test file. It IS installed
// (mingla-business/package.json), and the probe below renders null — no host
// components — so it runs cleanly under the default node test environment.
type Renderer = { update: (el: React.ReactElement) => void; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Renderer;
};


describe("#3173 formatElapsed", () => {
  test("sub-minute readings are bare seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(999)).toBe("0s");
    expect(formatElapsed(1_000)).toBe("1s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  test("a minute and over is minutes plus zero-padded seconds", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(83_000)).toBe("1m 23s");
    expect(formatElapsed(69_000)).toBe("1m 09s");
    expect(formatElapsed(3_600_000)).toBe("60m 00s");
  });

  test("device/server clock skew never runs the counter backwards", () => {
    // A negative elapsed would render as a countdown into the past, which is a
    // worse lie than showing nothing.
    expect(formatElapsed(-1)).toBe("0s");
    expect(formatElapsed(-120_000)).toBe("0s");
  });
});

// React only honours act() when the environment opts in; without this the
// renderer still works but every act() logs "not configured to support act(...)".
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const START = "2026-09-10T06:36:31.924Z";
const START_MS = Date.parse(START);

const Probe: React.FC<{ startedAt: string | null; active: boolean; sink: (v: string | null) => void }> =
  ({ startedAt, active, sink }) => {
    sink(useElapsedSince(startedAt, active));
    return null;
  };

const renderProbe = (
  startedAt: string | null,
  active: boolean,
): { latest: () => string | null; update: (s: string | null, a: boolean) => void; unmount: () => void } => {
  let latest: string | null = null;
  const sink = (v: string | null): void => { latest = v; };
  let renderer: Renderer;
  act(() => {
    renderer = create(<Probe startedAt={startedAt} active={active} sink={sink} />);
  });
  return {
    latest: () => latest,
    update: (s, a) => { act(() => { renderer.update(<Probe startedAt={s} active={a} sink={sink} />); }); },
    unmount: () => { act(() => { renderer.unmount(); }); },
  };
};

describe("#3173 useElapsedSince", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(START_MS); });
  afterEach(() => { jest.useRealTimers(); });

  test("an inactive phase reports nothing at all", () => {
    const probe = renderProbe(START, false);
    expect(probe.latest()).toBeNull();
    probe.unmount();
  });

  test("a missing or unparseable start reports nothing rather than a wrong number", () => {
    const missing = renderProbe(null, true);
    expect(missing.latest()).toBeNull();
    missing.unmount();
    const junk = renderProbe("not a timestamp", true);
    expect(junk.latest()).toBeNull();
    junk.unmount();
  });

  test("the reading actually advances once a second — this is the whole point", () => {
    const probe = renderProbe(START, true);
    expect(probe.latest()).toBe("0s");
    act(() => { jest.advanceTimersByTime(ELAPSED_TICK_MS * 3); });
    expect(probe.latest()).toBe("3s");
    act(() => { jest.advanceTimersByTime(ELAPSED_TICK_MS * 60); });
    expect(probe.latest()).toBe("1m 03s");
    probe.unmount();
  });

  test("leaving the phase stops the ticking and clears the reading", () => {
    const probe = renderProbe(START, true);
    act(() => { jest.advanceTimersByTime(ELAPSED_TICK_MS * 2); });
    expect(probe.latest()).toBe("2s");
    probe.update(START, false);
    expect(probe.latest()).toBeNull();
    // An interval that outlived its phase would keep a closed sheet re-rendering.
    expect(jest.getTimerCount()).toBe(0);
    probe.unmount();
  });

  test("unmounting mid-encode leaves no live interval behind", () => {
    const probe = renderProbe(START, true);
    expect(jest.getTimerCount()).toBe(1);
    probe.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("#3173 CoverPicker wiring", () => {
  const source = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");

  test("the card takes its elapsed reading from the shared hook", () => {
    expect(source).toContain('from "./coverPickerElapsed"');
    expect(source).toContain("useElapsedSince(");
  });

  test("elapsed is scoped to the processing phase and anchored on the provider handover", () => {
    const call = source.slice(source.indexOf("useElapsedSince("), source.indexOf("useElapsedSince(") + 220);
    expect(call).toContain("status?.sourceUploadedAt ?? status?.createdAt ?? null");
    expect(call).toContain('stage.phase === "processing"');
  });

  test("elapsed fills the percent slot only when there is no percentage to show", () => {
    expect(source).toContain("elapsed !== null");
    const slot = source.slice(source.indexOf("copy.percent !== null\n          ? <Text"));
    expect(slot.slice(0, 600)).toContain("{elapsed}");
  });

  test("the ticking value is hidden from the card's polite live region", () => {
    // The card announces itself on change; a value that moves every second would
    // re-announce the whole card every second.
    const slot = source.slice(source.indexOf("{elapsed}") - 400, source.indexOf("{elapsed}") + 40);
    expect(slot).toContain("accessibilityElementsHidden");
    expect(slot).toContain('importantForAccessibility="no"');
  });
});
