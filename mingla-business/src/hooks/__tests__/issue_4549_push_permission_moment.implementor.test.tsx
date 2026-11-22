/**
 * #4549 H8 — the one-shot "asked" flag is written only after the SDK is ready
 * and the OS question was shown or the OS already had an answer.
 *
 * Fails on revert: stamping the flag before whenOneSignalReady (the pre-#4549
 * order) writes it on the not-ready launch, and the "next launch asks" test
 * then sees no prompt.
 */
import React from "react";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const storage = new Map<string, string>();
const events: string[] = [];
let ready = true;
let canAsk = true;
let promptAnswers = true; // the OS records an answer when the prompt shows
let promptThrows = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      events.push(`set:${k}`);
      storage.set(k, v);
    },
  },
}));

jest.mock("../../services/oneSignalService", () => ({
  whenOneSignalReady: async () => {
    events.push("wait");
    return ready;
  },
  canRequestPushPermission: async () => {
    events.push("canRequest");
    return canAsk;
  },
  requestPushPermission: async () => {
    events.push("prompt");
    if (promptThrows) throw new Error("native prompt failed");
    if (promptAnswers) canAsk = false;
    return promptAnswers;
  },
}));

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (scope: string, error: unknown) => {
    events.push(`nonfatal:${scope}:${error instanceof Error ? error.message : String(error)}`);
  },
}));

import { usePushPermissionMoment } from "../usePushPermissionMoment";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { unmount(): void };
  act(callback: () => void | Promise<void>): Promise<void>;
};

const FLAG = "mingla-business.pushPermissionPrompted.v1";

function Probe({ brand }: { brand: string | null }): null {
  usePushPermissionMoment(true, brand);
  return null;
}

async function launch(brand: string | null = "brand-1"): Promise<void> {
  let renderer!: { unmount(): void };
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<Probe brand={brand} />);
  });
  await TestRenderer.act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  renderer.unmount();
}

beforeEach(() => {
  storage.clear();
  events.length = 0;
  ready = true;
  canAsk = true;
  promptAnswers = true;
  promptThrows = false;
});

test("SDK not ready when the brand appears: the flag is not written and nothing is prompted", async () => {
  ready = false;
  await launch();
  expect(storage.has(FLAG)).toBe(false);
  expect(events).not.toContain("prompt");
  expect(events).not.toContain("canRequest");
  expect(events).toContain("nonfatal:push.permission_moment:sdk_not_ready");
});

test("the next launch, SDK ready and never asked: the OS prompt shows once, then the flag", async () => {
  ready = false;
  await launch();
  ready = true;
  events.length = 0;
  await launch();
  expect(events.filter((e) => e === "prompt")).toHaveLength(1);
  expect(events.indexOf(`set:${FLAG}`)).toBeGreaterThan(events.indexOf("prompt"));
  events.length = 0;
  await launch();
  expect(events).not.toContain("prompt");
});

test("already answered at the OS: never prompted, the answer is recorded", async () => {
  canAsk = false;
  await launch();
  expect(events).not.toContain("prompt");
  expect(storage.get(FLAG)).toBe("1");
});

test("no brand yet: nothing happens at all", async () => {
  await launch(null);
  expect(events).toEqual([]);
});

test("P3-3: a prompt that never showed (call failed quietly) does not write the flag", async () => {
  promptAnswers = false; // the OS can still ask afterwards
  await launch();
  expect(events).toContain("prompt");
  expect(storage.has(FLAG)).toBe(false);
  expect(events).toContain("nonfatal:push.permission_moment:prompt_not_answered");
});

test("P3-3: a prompt call that throws does not write the flag and is reported", async () => {
  promptThrows = true;
  await launch();
  expect(storage.has(FLAG)).toBe(false);
  expect(events).toContain("nonfatal:push.permission_moment:native prompt failed");
});
