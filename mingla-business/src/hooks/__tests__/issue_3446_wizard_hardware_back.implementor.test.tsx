/* eslint-disable import/first */
/**
 * #3446 — Android hardware back in the Business creation wizards: the native
 * hook and its pure routing module (SPEC §4.1, §4.3, §7 T-A).
 *
 * The REAL `useWizardHardwareBack.native` hook is mounted with
 * react-test-renderer. Only its two platform boundaries are faked:
 *   - react-native: `Platform` (mutable OS) and a `BackHandler` that keeps a
 *     newest-first subscription list like RN's JS dispatcher, stops at the
 *     first listener returning true, and counts presses nobody handled
 *     (`fallthrough`, i.e. the navigator's goBack would have popped the wizard).
 *   - expo-router: `useFocusEffect`, driven by a test-owned focus context. Like
 *     the real hook it runs the callback on focus, cleans up on blur/unmount,
 *     and re-runs when the callback identity changes.
 *
 * Fails on revert (each was run; see the #3446 implementation report):
 *   - listener returns false/undefined                 -> T-1 red (fallthrough 1)
 *   - useFocusEffect deps [config] / re-subscribe      -> T-4 red
 *   - no "stepping" latch                              -> T-5 red
 *   - no "exiting" latch                               -> T-7 red
 *   - no Platform gate                                 -> T-10 red
 *   - dispatcher rules reordered / changed             -> T-10b red
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
  BackHandler: {
    addEventListener: (event: string, listener: BackListener) => { remove: () => void };
  };
  mockBack: {
    subs: BackListener[];
    addCalls: string[];
    fallthrough: number;
    press: () => boolean;
    reset: () => void;
  };
}

jest.mock("react-native", () => {
  const mockBack = {
    subs: [] as (() => boolean | null | undefined)[],
    addCalls: [] as string[],
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
      mockBack.addCalls.length = 0;
      mockBack.fallthrough = 0;
    },
  };
  return {
    Platform: { OS: "android" },
    BackHandler: {
      addEventListener: (event: string, listener: () => boolean | null | undefined) => {
        mockBack.addCalls.push(event);
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

import { useWizardHardwareBack } from "../useWizardHardwareBack.native";
import {
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
  type WizardHardwareBackLatch,
} from "../wizardHardwareBackRouting";

const RN = jest.requireMock<FakeReactNative>("react-native");
const { MockFocus } = jest.requireMock<{ MockFocus: React.Context<boolean> }>("expo-router");

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const Probe = ({ config }: { config: WizardHardwareBackConfig }): null => {
  useWizardHardwareBack(config);
  return null;
};
const Screen = ({
  focused,
  config,
}: {
  focused: boolean;
  config: WizardHardwareBackConfig;
}): React.ReactElement => (
  <MockFocus.Provider value={focused}>
    <Probe config={config} />
  </MockFocus.Provider>
);

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

const mounted: Renderer[] = [];
const mount = async (config: WizardHardwareBackConfig, focused = true): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Screen focused={focused} config={config} />);
  });
  mounted.push(tree);
  return tree;
};
const rerender = async (
  tree: Renderer,
  config: WizardHardwareBackConfig,
  focused = true,
): Promise<void> => {
  await act(async () => {
    tree.update(<Screen focused={focused} config={config} />);
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
const deferred = (): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  RN.Platform.OS = "android";
  RN.mockBack.reset();
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

// ---------------------------------------------------------------------------

describe("#3446 useWizardHardwareBack (native) — Android hardware back steps the wizard", () => {
  test("T-1 step N>1: back runs the wizard's own Back owner and never falls through", async () => {
    const o = owners();
    await mount(configOf({ ...o }));
    expect(RN.mockBack.addCalls).toEqual(["hardwareBackPress"]);

    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("T-2 step 1: back runs the wizard's own close owner (parity with the X)", async () => {
    const o = owners();
    await mount(configOf({ ...o, isFirstStep: true }));

    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("T-3 busy: a press during publish/autosave/pre-check/discard is swallowed", async () => {
    const o = owners();
    await mount(configOf({ ...o, busy: true }));

    expect(await press()).toBe(true);
    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("T-4 re-renders never re-subscribe, and a press acts on the LATEST config", async () => {
    const first = owners();
    const tree = await mount(configOf({ ...first }));
    const history = [first];
    for (let i = 0; i < 5; i += 1) {
      const next = owners();
      history.push(next);
      await rerender(tree, configOf({ ...next, isFirstStep: i % 2 === 0 }));
    }
    // i = 4 was the last re-render -> isFirstStep true.
    expect(RN.mockBack.addCalls).toHaveLength(1);
    expect(RN.mockBack.subs).toHaveLength(1);

    expect(await press()).toBe(true);
    const latest = history[history.length - 1];
    expect(latest.onExit).toHaveBeenCalledTimes(1);
    for (const stale of history.slice(0, -1)) {
      expect(stale.onExit).toHaveBeenCalledTimes(0);
      expect(stale.onStepBack).toHaveBeenCalledTimes(0);
    }
  });

  test("T-5 async Back (Trip saves first): a second press never skips a step", async () => {
    const gate = deferred();
    const onStepBack = jest.fn<() => Promise<void>>(() => gate.promise);
    await mount(configOf({ onStepBack }));

    expect(await press()).toBe(true);
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await flushMicrotasks();

    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(2);
  });

  test("T-6 async Back that rejects: no unhandled rejection and the latch releases", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const gate = deferred();
      const onStepBack = jest
        .fn<() => void | Promise<void>>()
        .mockImplementationOnce(() => gate.promise)
        .mockImplementation(() => undefined);
      await mount(configOf({ onStepBack }));

      expect(await press()).toBe(true);
      await act(async () => {
        gate.reject(new Error("autosave failed"));
      });
      await flushMicrotasks();
      await flushMicrotasks();

      expect(unhandled).toEqual([]);
      expect(await press()).toBe(true);
      expect(onStepBack).toHaveBeenCalledTimes(2);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("T-7 exit latch: a double press exits once; the latch releases when the exit surfaces UI", async () => {
    const o = owners();
    const tree = await mount(configOf({ ...o, isFirstStep: true }));

    expect(await press()).toBe(true);
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);

    // The exit surfaced its discard dialog (or failure toast) -> released.
    await rerender(tree, configOf({ ...o, isFirstStep: true, exitSurfaced: true }));
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(2);
  });

  test("T-8 blur and unmount remove the listener, so back belongs to the navigator again", async () => {
    const o = owners();
    const config = configOf({ ...o });
    const tree = await mount(config);
    expect(RN.mockBack.subs).toHaveLength(1);

    await rerender(tree, config, false);
    expect(RN.mockBack.subs).toHaveLength(0);
    expect(await press()).toBe(false);
    expect(RN.mockBack.fallthrough).toBe(1);

    await act(async () => {
      tree.unmount();
    });
    mounted.splice(mounted.indexOf(tree), 1);
    expect(RN.mockBack.subs).toHaveLength(0);
    expect(await press()).toBe(false);
    expect(RN.mockBack.fallthrough).toBe(2);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);

    // A focused unmount removes it too.
    const again = await mount(configOf({ ...o }));
    expect(RN.mockBack.subs).toHaveLength(1);
    await act(async () => {
      again.unmount();
    });
    mounted.splice(mounted.indexOf(again), 1);
    expect(RN.mockBack.subs).toHaveLength(0);
  });

  test("T-9 an overlay listener registered after the wizard keeps precedence", async () => {
    const o = owners();
    const tree = await mount(configOf({ ...o }));
    const overlay = jest.fn<() => boolean>(() => true);
    const overlaySub = RN.BackHandler.addEventListener("hardwareBackPress", overlay);

    // Re-renders must not jump the wizard ahead of the overlay.
    await rerender(tree, configOf({ ...o }));
    await rerender(tree, configOf({ ...o, isFirstStep: true }));

    expect(await press()).toBe(true);
    expect(overlay).toHaveBeenCalledTimes(1);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);

    overlaySub.remove();
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
  });

  test.each(["ios", "web"])("T-10 %s: no BackHandler subscription is ever created", async (os) => {
    RN.Platform.OS = os;
    const o = owners();
    const tree = await mount(configOf({ ...o }));
    await rerender(tree, configOf({ ...o, isFirstStep: true }));
    expect(RN.mockBack.addCalls).toEqual([]);
    expect(RN.mockBack.subs).toHaveLength(0);
  });
});

describe("#3446 dispatchWizardHardwareBackPress — T-10b pure decision table", () => {
  const LATCHES: WizardHardwareBackLatch[] = ["idle", "stepping", "exiting"];
  const run = (
    latch: WizardHardwareBackLatch,
    busy: boolean,
    isFirstStep: boolean,
    asyncBack: boolean,
  ) => {
    const pending = Promise.resolve();
    const onStepBack = jest.fn<() => void | Promise<void>>(() =>
      asyncBack ? pending : undefined,
    );
    const onExit = jest.fn<() => void>();
    const decision = dispatchWizardHardwareBackPress(latch, {
      isFirstStep,
      busy,
      exitSurfaced: false,
      onStepBack,
      onExit,
    });
    return { decision, onStepBack, onExit, pending };
  };

  for (const latch of LATCHES) {
    for (const busy of [false, true]) {
      for (const isFirstStep of [false, true]) {
        for (const asyncBack of [false, true]) {
          const name = `latch=${latch} busy=${busy} first=${isFirstStep} ${asyncBack ? "async" : "sync"}`;
          test(name, () => {
            const { decision, onStepBack, onExit, pending } = run(
              latch,
              busy,
              isFirstStep,
              asyncBack,
            );
            if (latch !== "idle") {
              // Rule 1: a press in flight -> nothing, latch unchanged.
              expect(decision).toEqual({ action: "none", nextLatch: latch, pending: null });
              expect(onStepBack).not.toHaveBeenCalled();
              expect(onExit).not.toHaveBeenCalled();
            } else if (busy) {
              // Rule 2: busy -> nothing.
              expect(decision).toEqual({ action: "none", nextLatch: "idle", pending: null });
              expect(onStepBack).not.toHaveBeenCalled();
              expect(onExit).not.toHaveBeenCalled();
            } else if (isFirstStep) {
              // Rule 3: first step -> close owner once, latch exiting.
              expect(decision).toEqual({ action: "exit", nextLatch: "exiting", pending: null });
              expect(onExit).toHaveBeenCalledTimes(1);
              expect(onStepBack).not.toHaveBeenCalled();
            } else if (asyncBack) {
              // Rule 4 (thenable): Back owner once, latch stepping, same promise.
              expect(decision.action).toBe("step_back");
              expect(decision.nextLatch).toBe("stepping");
              expect(decision.pending).toBe(pending);
              expect(onStepBack).toHaveBeenCalledTimes(1);
              expect(onExit).not.toHaveBeenCalled();
            } else {
              // Rule 4 (sync): Back owner once, latch stays idle.
              expect(decision).toEqual({ action: "step_back", nextLatch: "idle", pending: null });
              expect(onStepBack).toHaveBeenCalledTimes(1);
              expect(onExit).not.toHaveBeenCalled();
            }
          });
        }
      }
    }
  }

  test("does not swallow a synchronous throw from an owner", () => {
    expect(() =>
      dispatchWizardHardwareBackPress("idle", {
        isFirstStep: false,
        busy: false,
        exitSurfaced: false,
        onStepBack: () => {
          throw new Error("owner threw");
        },
        onExit: () => undefined,
      }),
    ).toThrow("owner threw");
  });
});
