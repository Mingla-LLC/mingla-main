/**
 * #4420 device round 2 (Android walk): Ari sat on "Opening conversation…"
 * for minutes. A failed conversation list never restored the selection, and
 * nothing bounded a slow load. FAILS ON REVERT: drop the stall timer, the
 * conversation-list error branch, or the Try again state.
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import React from "react";
import { Text } from "react-native";

type Rendered = { update: (el: React.ReactElement) => void; toJSON: () => unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => Rendered;
};

jest.mock("../../../components/ari/AriOrb", () => ({ AriOrb: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../AriThreadLoadingState") as typeof import("../AriThreadLoadingState");

const Probe: React.FC<{ active: boolean; resetKey: number; out: { v: boolean } }> = ({ active, resetKey, out }) => {
  out.v = mod.useStalled(active, mod.ARI_THREAD_OPEN_TIMEOUT_MS, resetKey);
  return null;
};

describe("#4420 Ari thread open never spins forever", () => {
  test("a load that outlasts the timeout turns stalled; retry resets it", () => {
    jest.useFakeTimers();
    const out = { v: false };
    let r!: Rendered;
    act(() => {
      r = create(<Probe active resetKey={0} out={out} />);
    });
    expect(out.v).toBe(false);
    act(() => {
      jest.advanceTimersByTime(mod.ARI_THREAD_OPEN_TIMEOUT_MS + 1);
    });
    expect(out.v).toBe(true);
    act(() => {
      r.update(<Probe active resetKey={1} out={out} />);
    });
    expect(out.v).toBe(false);
    act(() => {
      r.update(<Probe active={false} resetKey={1} out={out} />);
      jest.advanceTimersByTime(mod.ARI_THREAD_OPEN_TIMEOUT_MS + 1);
    });
    expect(out.v).toBe(false);
    jest.useRealTimers();
  });

  test("the failed state says so and offers Try again", () => {
    let r!: Rendered;
    act(() => {
      r = create(<mod.AriThreadLoadingState failed retry={<Text>Try again</Text>} />);
    });
    const text = JSON.stringify(r.toJSON());
    expect(text).toContain("Couldn't open this conversation.");
    expect(text).toContain("Try again");
    expect(text).not.toContain("Opening conversation");
  });

  test("the screen wires the timeout and the conversation-list error", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "AriChatScreen.tsx"), "utf8");
    expect(src).toMatch(/useStalled\(threadOpening, ARI_THREAD_OPEN_TIMEOUT_MS, threadRetryKey\)/);
    expect(src).toMatch(/!conversationSelectionReady && conversations\.isError/);
    expect(src).toMatch(/<AriThreadLoadingState\s+failed=\{threadOpenFailed\}\s+retry=\{/);
    expect(src).toMatch(/onPress=\{retryThreadOpen\}/);
  });
});
