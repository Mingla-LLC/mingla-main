/* eslint-disable import/first */
/**
 * #3446 SC-7 (keyboard row) — Android back with the soft keyboard open only
 * hides the keyboard. Implementor happy-path regression for the device
 * finding: on emulator-5564 (Android 15, gesture nav) one keyevent 4 with the
 * IME up hid the keyboard AND exited Event Step 1 to Hub (k05/k06), the edge
 * swipe did the same (k08/k09), and RSVP Step 3 hid the keyboard AND moved to
 * Step 2 (r08-r10).
 *
 * The REAL `useWizardHardwareBack.native` hook and the REAL routing module are
 * mounted with react-test-renderer. Only the platform boundaries are faked,
 * following the T-A pattern (issue_3446_wizard_hardware_back.implementor):
 *   - react-native: `Platform`, a newest-first `BackHandler`, and
 *     `Keyboard.dismiss`.
 *   - expo-router: `useFocusEffect` driven by a test-owned focus context.
 *   - the repo's keyboard visibility owner, `wrappers/useKeyboardIsVisible`:
 *     a test-owned boolean. Flipping it and re-rendering is exactly what the
 *     library's keyboardDidShow / keyboardDidHide state update does.
 *   - `Date.now`: a test-owned clock, so the hide-to-press window is exact.
 *
 * Android can deliver the IME hide and hardwareBackPress for one press in
 * either order, so both are proven:
 *   - order 1, press first: the press sees the keyboard visible (K-1, K-2);
 *   - order 2, hide first: the press lands inside the window after the hide
 *     commit (K-3), and a press after the window is a normal step back (K-4).
 *
 * Fails on revert (each was run; see the #3446 rework report):
 *   - delete the keyboard rule from dispatchWizardHardwareBackPress
 *       -> K-1, K-2, K-3, K-5, K-6, K-7 and the keyboard table red
 *   - drop the window (keyboard visible only)  -> K-3, K-6 and the window rows red
 *   - drop the claim (every hide opens a window) -> K-2, K-5, K-7 red
 */

import React from "react";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Renderer {
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}
// CI installs the renderer but not a separate @types package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// platform boundaries
// ---------------------------------------------------------------------------

type BackListener = () => boolean | null | undefined;
interface FakeReactNative {
  Platform: { OS: string };
  Keyboard: { dismiss: jest.Mock<() => void> };
  mockBack: {
    subs: BackListener[];
    fallthrough: number;
    press: () => boolean;
    reset: () => void;
  };
}

jest.mock("react-native", () => {
  const mockBack = {
    subs: [] as (() => boolean | null | undefined)[],
    fallthrough: 0,
    press(): boolean {
      // RN BackHandler.android.js: newest subscription first, stop at true.
      for (let i = mockBack.subs.length - 1; i >= 0; i -= 1) {
        if (mockBack.subs[i]() === true) return true;
      }
      mockBack.fallthrough += 1;
      return false;
    },
    reset(): void {
      mockBack.subs.length = 0;
      mockBack.fallthrough = 0;
    },
  };
  return {
    Platform: { OS: "android" },
    Keyboard: { dismiss: jest.fn() },
    BackHandler: {
      addEventListener: (_event: string, listener: () => boolean | null | undefined) => {
        mockBack.subs.push(listener);
        return {
          remove: (): void => {
            const index = mockBack.subs.indexOf(listener);
            if (index >= 0) mockBack.subs.splice(index, 1);
          },
        };
      },
    },
    mockBack,
  };
});

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react") as typeof React;
  const MockFocus = ReactActual.createContext(true);
  return {
    MockFocus,
    useFocusEffect: (effect: () => undefined | void | (() => void)): void => {
      const focused = ReactActual.useContext(MockFocus);
      ReactActual.useEffect(() => (focused ? effect() : undefined), [focused, effect]);
    },
  };
});

const mockKeyboard = { visible: false };
jest.mock("../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: (): boolean => mockKeyboard.visible,
}));

import { useWizardHardwareBack } from "../useWizardHardwareBack.native";
import {
  WIZARD_KEYBOARD_BACK_WINDOW_MS,
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
  type WizardHardwareBackKeyboard,
  type WizardHardwareBackLatch,
} from "../wizardHardwareBackRouting";

const RN = jest.requireMock<FakeReactNative>("react-native");

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const Probe = ({ config }: { config: WizardHardwareBackConfig }): null => {
  useWizardHardwareBack(config);
  return null;
};

const owners = () => ({
  onStepBack: jest.fn<() => void | Promise<void>>(),
  onExit: jest.fn<() => void>(),
});

const configOf = (
  overrides: Partial<WizardHardwareBackConfig> = {},
): WizardHardwareBackConfig => ({
  isFirstStep: false,
  busy: false,
  exitSurfaced: false,
  onStepBack: () => undefined,
  onExit: () => undefined,
  ...overrides,
});

let clock = 0;
const mounted: Renderer[] = [];

const mount = async (config: WizardHardwareBackConfig): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Probe config={config} />);
  });
  mounted.push(tree);
  return tree;
};
/** The keyboard owner's state update commits (keyboardDidShow / keyboardDidHide). */
const keyboardCommits = async (
  tree: Renderer,
  config: WizardHardwareBackConfig,
  visible: boolean,
): Promise<void> => {
  mockKeyboard.visible = visible;
  await act(async () => {
    tree.update(<Probe config={config} />);
  });
};
const press = async (): Promise<boolean> => {
  let handled = false;
  await act(async () => {
    handled = RN.mockBack.press();
  });
  return handled;
};
const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
};

beforeEach(() => {
  RN.Platform.OS = "android";
  RN.mockBack.reset();
  RN.Keyboard.dismiss.mockClear();
  mockKeyboard.visible = false;
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("#3446 SC-7 Android back with the soft keyboard open only hides the keyboard", () => {
  test("K-1 keyboard visible (RSVP Step 3 link field): back hides the keyboard and nothing else", async () => {
    const o = owners();
    mockKeyboard.visible = true;
    await mount(configOf({ ...o }));

    expect(await press()).toBe(true);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("K-2 order 1 (press, then the hide commits): the NEXT press steps back", async () => {
    const o = owners();
    mockKeyboard.visible = true;
    const config = configOf({ ...o });
    const tree = await mount(config);

    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);

    // keyboardDidHide lands after the press (end of the IME animation).
    clock += 280;
    await keyboardCommits(tree, config, false);

    // That hide belonged to the press above, so it opens no window: a quick
    // deliberate second press is a normal step back.
    clock += 20;
    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
  });

  test("K-3 order 2 (the hide commits, then the press) inside the window: no step change", async () => {
    const o = owners();
    mockKeyboard.visible = true;
    const config = configOf({ ...o });
    const tree = await mount(config);

    await keyboardCommits(tree, config, false);
    clock += WIZARD_KEYBOARD_BACK_WINDOW_MS;

    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    // Already hidden: nothing left to dismiss.
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);

    // One hide swallows at most one press.
    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
  });

  test("K-4 a press after the window is a normal step back", async () => {
    const o = owners();
    mockKeyboard.visible = true;
    const config = configOf({ ...o });
    const tree = await mount(config);

    await keyboardCommits(tree, config, false);
    clock += WIZARD_KEYBOARD_BACK_WINDOW_MS + 1;

    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(0);
  });

  test("K-5 keyboard visible on Step 1 (Event name field): back never exits, and does not arm the exit latch", async () => {
    const o = owners();
    mockKeyboard.visible = true;
    const config = configOf({ ...o, isFirstStep: true });
    const tree = await mount(config);

    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);

    clock += 280;
    await keyboardCommits(tree, config, false);
    clock += 20;

    // Had the dismissal latched "exiting", this press would do nothing.
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
  });

  test("K-6 order 2 on Step 1: a press just after the hide still never exits", async () => {
    const o = owners();
    mockKeyboard.visible = true;
    const config = configOf({ ...o, isFirstStep: true });
    const tree = await mount(config);

    await keyboardCommits(tree, config, false);
    clock += 40;

    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("K-7 a dismissal neither arms nor releases the async step latch (Trip saves first)", async () => {
    let resolve!: () => void;
    const saving = new Promise<void>((yes) => {
      resolve = yes;
    });
    const onStepBack = jest.fn<() => Promise<void>>(() => saving);
    mockKeyboard.visible = true;
    const config = configOf({ onStepBack });
    const tree = await mount(config);

    // Dismissal first: must not arm "stepping".
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(0);
    clock += 280;
    await keyboardCommits(tree, config, false);
    clock += 20;
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(1);

    // While that save is in flight the keyboard comes up and is dismissed by
    // back. The dismissal must not release "stepping" either.
    await keyboardCommits(tree, config, true);
    expect(await press()).toBe(true);
    clock += 280;
    await keyboardCommits(tree, config, false);
    clock += 20;
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve();
      await saving;
    });
    await flushMicrotasks();
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(2);
    expect(RN.mockBack.fallthrough).toBe(0);
  });
});

describe("#3446 SC-7 dispatchWizardHardwareBackPress — keyboard rule table", () => {
  const LATCHES: WizardHardwareBackLatch[] = ["idle", "stepping", "exiting"];
  const NOW = 50_000;
  const KEYBOARDS: { name: string; keyboard: WizardHardwareBackKeyboard; dismiss: boolean }[] = [
    { name: "visible", keyboard: { visible: true, unclaimedHideAt: null, now: NOW }, dismiss: true },
    {
      name: "visible with a stale hide stamp",
      keyboard: { visible: true, unclaimedHideAt: NOW - 10_000, now: NOW },
      dismiss: true,
    },
    { name: "hid 0 ms ago", keyboard: { visible: false, unclaimedHideAt: NOW, now: NOW }, dismiss: true },
    {
      name: "hid exactly the window ago",
      keyboard: { visible: false, unclaimedHideAt: NOW - WIZARD_KEYBOARD_BACK_WINDOW_MS, now: NOW },
      dismiss: true,
    },
    {
      name: "hid 1 ms past the window",
      keyboard: { visible: false, unclaimedHideAt: NOW - WIZARD_KEYBOARD_BACK_WINDOW_MS - 1, now: NOW },
      dismiss: false,
    },
    {
      name: "hidden, hide already claimed",
      keyboard: { visible: false, unclaimedHideAt: null, now: NOW },
      dismiss: false,
    },
  ];

  const decide = (
    latch: WizardHardwareBackLatch,
    busy: boolean,
    isFirstStep: boolean,
    keyboard?: WizardHardwareBackKeyboard,
  ) => {
    const onStepBack = jest.fn<() => void | Promise<void>>();
    const onExit = jest.fn<() => void>();
    const decision = dispatchWizardHardwareBackPress(
      latch,
      { isFirstStep, busy, exitSurfaced: false, onStepBack, onExit },
      keyboard,
    );
    return { decision, calls: onStepBack.mock.calls.length + onExit.mock.calls.length };
  };

  test("the window is short: at most Android's 300 ms double-tap timeout", () => {
    expect(WIZARD_KEYBOARD_BACK_WINDOW_MS).toBeGreaterThanOrEqual(250);
    expect(WIZARD_KEYBOARD_BACK_WINDOW_MS).toBeLessThanOrEqual(300);
  });

  for (const { name, keyboard, dismiss } of KEYBOARDS) {
    for (const latch of LATCHES) {
      for (const busy of [false, true]) {
        for (const isFirstStep of [false, true]) {
          test(`keyboard ${name} · latch=${latch} busy=${busy} first=${isFirstStep}`, () => {
            const withKeyboard = decide(latch, busy, isFirstStep, keyboard);
            if (dismiss) {
              expect(withKeyboard.decision).toEqual({
                action: "dismiss_keyboard",
                nextLatch: latch,
                pending: null,
              });
              expect(withKeyboard.calls).toBe(0);
            } else {
              // Not a keyboard press: exactly the pre-keyboard rules 1-4.
              const without = decide(latch, busy, isFirstStep);
              expect(withKeyboard.decision).toEqual(without.decision);
              expect(withKeyboard.calls).toBe(without.calls);
            }
          });
        }
      }
    }
  }
});
