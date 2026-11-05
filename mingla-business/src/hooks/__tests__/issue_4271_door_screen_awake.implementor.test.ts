/**
 * #4271 T10 — the phone stays awake and bright while a code shows, and goes back
 * to how it was on leaving. A binary without a module simply goes without.
 */
import { createElement } from "react";

const renderer = require("react-test-renderer") as {
  create: (element: unknown) => { update: (element: unknown) => void; unmount: () => void };
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

const keepAwake = { activate: jest.fn(() => Promise.resolve()), deactivate: jest.fn(() => Promise.resolve()) };
const brightness = {
  getBrightnessAsync: jest.fn(() => Promise.resolve(0.4)),
  setBrightnessAsync: jest.fn(() => Promise.resolve()),
};
let modules: Record<string, unknown> = {};

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock(
  "expo",
  () => ({ requireOptionalNativeModule: (name: string) => modules[name] ?? null }),
  { virtual: true },
);

// eslint-disable-next-line import/first
import { useDoorScreenAwake } from "../useDoorScreenAwake";

const Probe = ({ active }: { active: boolean }): null => {
  useDoorScreenAwake(active);
  return null;
};

describe("#4271 useDoorScreenAwake", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modules = { ExpoKeepAwake: keepAwake, ExpoBrightness: brightness };
  });

  test("holds awake at full brightness while showing, restores on leaving", async () => {
    let tree: { update: (element: unknown) => void; unmount: () => void } | undefined;
    await renderer.act(async () => {
      tree = renderer.create(createElement(Probe, { active: true }));
    });
    expect(keepAwake.activate).toHaveBeenCalledWith("door-pay-code");
    expect(brightness.setBrightnessAsync).toHaveBeenLastCalledWith(1);
    await renderer.act(async () => {
      tree?.update(createElement(Probe, { active: false }));
    });
    expect(keepAwake.deactivate).toHaveBeenCalledWith("door-pay-code");
    expect(brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4);
  });

  test("a binary with neither module does nothing and does not throw", async () => {
    modules = {};
    await renderer.act(async () => {
      renderer.create(createElement(Probe, { active: true }));
    });
    expect(keepAwake.activate).not.toHaveBeenCalled();
    expect(brightness.setBrightnessAsync).not.toHaveBeenCalled();
  });

  test("stays quiet while no code is showing", async () => {
    await renderer.act(async () => {
      renderer.create(createElement(Probe, { active: false }));
    });
    expect(keepAwake.activate).not.toHaveBeenCalled();
  });
});
