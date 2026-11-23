/**
 * #4490 spec 08 O3 — useScreenAwake(tag): a station screen stays awake with no
 * brightness change; the door pay code keeps its full brightness (#4271).
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

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock(
  "expo",
  () => ({ requireOptionalNativeModule: (name: string) => ({ ExpoKeepAwake: keepAwake, ExpoBrightness: brightness } as Record<string, unknown>)[name] ?? null }),
  { virtual: true },
);

// eslint-disable-next-line import/first
import { useScreenAwake } from "../useScreenAwake";

const Probe = ({ active }: { active: boolean }): null => {
  useScreenAwake(active, { tag: "station-board" });
  return null;
};

describe("08-O3 useScreenAwake", () => {
  beforeEach(() => jest.clearAllMocks());
  test("a station holds the screen awake by its own tag and never touches brightness", async () => {
    let tree: { update: (element: unknown) => void } | undefined;
    await renderer.act(async () => {
      tree = renderer.create(createElement(Probe, { active: true }));
    });
    expect(keepAwake.activate).toHaveBeenCalledWith("station-board");
    expect(brightness.getBrightnessAsync).not.toHaveBeenCalled();
    expect(brightness.setBrightnessAsync).not.toHaveBeenCalled();
    await renderer.act(async () => {
      tree?.update(createElement(Probe, { active: false }));
    });
    expect(keepAwake.deactivate).toHaveBeenCalledWith("station-board");
  });
});
