/* eslint-disable import/first */
/**
 * #3446 V2 — Android back and the soft keyboard, decided on the IME's HIDE
 * ONSET rather than on a React-committed latch.
 *
 * WHAT CHANGED, AND WHY THIS WHOLE SUITE MOVED WITH IT
 * ----------------------------------------------------
 * [TEST-MOD-APPROVED #3446] This file previously encoded a model the device
 * refuted. Every case below that inverted, and every case deleted outright, is
 * marked at its own site with its own reason. The model-level reason, once:
 *
 * The retired model asked "was this hide caused by a back press?" and answered
 * it from `useKeyboardIsVisible` plus a 300 ms `unclaimedHideAt` window and a
 * `dismissRequestedAt` claim ledger. The #3446 V2 device sweep on emulator-5564
 * (Android 15, gesture nav) proved both halves unanswerable:
 *
 *   - The IME USUALLY EATS THE PRESS. Every trial logged
 *     `ORIGIN_IME ... HIDE_SOFT_INPUT_BY_BACK_KEY fromUser true`: the IME window
 *     handles KEYCODE_BACK itself, the activity never gets onBackPressed, and
 *     our BackHandler listener NEVER RUNS. So `dismissRequestedAt` was never
 *     stamped and the claim ledger was inert on the dominant path.
 *   - THE VISIBILITY SOURCE IS TWO HOPS BEHIND. `keyboardWillHide` lands at
 *     +124 ms; `keyboardDidHide` at +522 ms; the React commit the old rule read
 *     is 0.5-1.4 s behind the press. The 300 ms window was stamped from that
 *     commit, so it covered 1.0-1.8 s of WALL CLOCK — which is why 1500 ms was
 *     the worst gap (3/3 dead presses) and 3000 ms recovered.
 *   - THE PLATFORM NEVER TELLS JS WHY A KEYBOARD HID. `getEventParams` carries
 *     height, duration, timestamp, target, type, appearance. No cause, no
 *     origin. The question the old model was built to answer has no answer.
 *
 * V2 asks the one question that IS answerable at press time — is the IME up
 * right now? — from a module-scope `imeUp` flag flipped by the keyboard's onset
 * events. There is NO clock on the path: `WizardHardwareBackKeyboard` is
 * `{ imeUp: boolean }` and nothing else, so a future deadline is a type error
 * rather than a judgement call.
 *
 * THE HARNESS CHANGED TOO, AND HAD TO
 * -----------------------------------
 * [TEST-MOD-APPROVED #3446] The old harness mocked `wrappers/useKeyboardIsVisible`
 * and drove it by FLIPPING A BOOLEAN AND RE-RENDERING. That harness *is* the
 * retired model — it cannot express route A at all, because route A is a
 * keyboard change with no press and no render. The new harness mocks
 * `wrappers/imeUpTracker` and drives it with `emit(...)`, which mutates the
 * value with NO React render, exactly as the real module-scope listeners do.
 * A render must never be required for a press to see the new value; that is the
 * property under test (A-3).
 *
 * The REAL `useWizardHardwareBack.native` hook and the REAL routing module are
 * mounted with react-test-renderer. Only the platform boundaries are faked,
 * following the T-A pattern (issue_3446_wizard_hardware_back.implementor):
 *   - react-native: `Platform`, a newest-first `BackHandler`, `Keyboard.dismiss`.
 *   - expo-router: `useFocusEffect` driven by a test-owned focus context.
 *   - `wrappers/imeUpTracker`: a test-owned module-scope boolean plus `emit`.
 *
 * CASES REWRITTEN OR DELETED, each also marked at its site
 * --------------------------------------------------------
 *   K-2, K-3, K-4, K-6  DELETED. All four asserted the 300 ms hide window
 *                       (`unclaimedHideAt` inside / outside / exactly at the
 *                       bound). The window is gone: its stamp came from a React
 *                       commit 0.5-1.4 s late, so it swallowed deliberate
 *                       second presses. Route-A coverage replaces them (A-1..A-4).
 *   K-8, K-9, K-10      DELETED as written. They drove the claim ledger by
 *                       advancing a clock without committing a keyboard change.
 *                       V2 has no ledger and no clock; G-1..G-3 keep the
 *                       user-visible contract they guarded.
 *   K-13                DELETED. "An unclaimed hide swallows exactly one press"
 *                       is the window's contract. Under V2 a hide we did not
 *                       cause simply leaves `imeUp` false and the press acts —
 *                       that is the fix, not a regression (A-1).
 *   K-14                DELETED. It pinned that the dismissal REQUEST never
 *                       expires. There is no request to expire; B-2 pins the
 *                       behaviour it existed to protect.
 *   K-1, K-5, K-7,      SURVIVE IN SUBSTANCE, re-expressed on the new harness.
 *   K-11, K-12          Lineage is recorded at each successor (B-1, B-3, C-3,
 *                       C-1, A-2).
 *   the whole "keyboard rule table" describe   REWRITTEN as D-1. Its six
 *                       keyboard shapes were `visible` x `unclaimedHideAt` x the
 *                       window; there are now exactly two (`imeUp` true/false).
 *                       Its `WIZARD_KEYBOARD_BACK_WINDOW_MS` bound assertions
 *                       ("at most Android's 300 ms double-tap timeout") are
 *                       deleted with the constant itself.
 *   the whole "dismissal-request rule" describe (R-1..R-5)   DELETED. Every case
 *                       was about `dismissRequestedAt`, a field that no longer
 *                       exists. D-2 replaces them with the stronger structural
 *                       guarantee they were reaching for: the module is never
 *                       handed a clock at all.
 *   G-4..G-8            DELETED. G-4 and G-8 are window/ledger cases. G-5, G-6
 *                       and G-7 (a show restores `visible`; a plain visible
 *                       keyboard only dismisses) are kept as C-1 and B-1.
 *
 * FAILS ON REVERT (each run; exact output in the #3446 V2 implementation report)
 *   - delete the `keyboard.imeUp` guard from dispatchWizardHardwareBackPress
 *       -> D-1's 12 `imeUp: true` rows, B-1, B-3, C-1, C-2 red
 *   - delete `noteImeDismissRequested()` from the hook
 *       -> B-2, B-3, C-2, G-1, G-2, G-3 red at 0 ms
 *   - reintroduce a React-committed read or a hide window
 *       -> A-1, A-3, A-4 red
 *   - add any `_MS` constant / `Date` / numeric comparison to the keyboard path
 *       -> D-2 red
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

/**
 * [TEST-MOD-APPROVED #3446] Replaces the `wrappers/useKeyboardIsVisible` mock.
 *
 * The real tracker is a module-scope boolean flipped by four native listeners.
 * `emit` reproduces one of those listeners firing: it mutates the value and
 * does NOTHING ELSE — no state, no render, no scheduling. That is the whole
 * point of the V2 source, and it is what lets this suite express route A, where
 * the keyboard hides without any press reaching us and without any render.
 */
type KeyboardOnsetEvent =
  | "keyboardWillShow"
  | "keyboardDidShow"
  | "keyboardWillHide"
  | "keyboardDidHide";

const mockIme = {
  up: false,
  /** How many times the hook optimistically flagged the IME down. */
  dismissRequests: 0,
  emit(event: KeyboardOnsetEvent): void {
    mockIme.up = event === "keyboardWillShow" || event === "keyboardDidShow";
  },
  reset(): void {
    mockIme.up = false;
    mockIme.dismissRequests = 0;
  },
};

jest.mock("../../wrappers/imeUpTracker", () => ({
  isImeUp: (): boolean => mockIme.up,
  noteImeDismissRequested: (): void => {
    mockIme.up = false;
    mockIme.dismissRequests += 1;
  },
}));

import { useWizardHardwareBack } from "../useWizardHardwareBack.native";
import {
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
  type WizardHardwareBackKeyboard,
  type WizardHardwareBackLatch,
} from "../wizardHardwareBackRouting";

const RN = jest.requireMock<FakeReactNative>("react-native");

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/** Renders of the hook's host, so a test can prove none happened. */
let renders = 0;

const Probe = ({ config }: { config: WizardHardwareBackConfig }): null => {
  renders += 1;
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

/**
 * A notional wall-clock gap between two presses.
 *
 * V2 reads no clock, so this exists to PROVE that: the same sequence is driven
 * at 250 ms, 700 ms, 1.5 s and 5 s and must behave identically. 1500 ms is the
 * gap at which the retired model was 3/3 dead on emulator-5564.
 */
let clock = 0;
const waitMs = (ms: number): void => {
  clock += ms;
};

const mounted: Renderer[] = [];

const mount = async (config: WizardHardwareBackConfig): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Probe config={config} />);
  });
  mounted.push(tree);
  return tree;
};

const unmountAll = async (): Promise<void> => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
};

/** A fresh trial inside a loop: new listeners, new owners, clean counters. */
const resetTrial = async (): Promise<void> => {
  await unmountAll();
  RN.mockBack.reset();
  RN.Keyboard.dismiss.mockClear();
  mockIme.reset();
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
  mockIme.reset();
  renders = 0;
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(async () => {
  await unmountAll();
  jest.restoreAllMocks();
});

// ===========================================================================
// §7.A — the decision table
// ===========================================================================

describe("#3446 V2 §7.A dispatchWizardHardwareBackPress — the keyboard rule", () => {
  const LATCHES: WizardHardwareBackLatch[] = ["idle", "stepping", "exiting"];

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

  // [TEST-MOD-APPROVED #3446] Replaces the six-shape keyboard table. Its shapes
  // were `visible` crossed with `unclaimedHideAt` and the 300 ms window; the
  // keyboard input now has exactly two states, so the table is 24 rows, not 144.
  describe("D-1 exhaustive: imeUp x latch x busy x isFirstStep", () => {
    for (const imeUp of [true, false]) {
      for (const latch of LATCHES) {
        for (const busy of [false, true]) {
          for (const isFirstStep of [false, true]) {
            test(`imeUp=${imeUp} latch=${latch} busy=${busy} first=${isFirstStep}`, () => {
              const withKeyboard = decide(latch, busy, isFirstStep, { imeUp });
              if (imeUp) {
                // The IME is up. Dismiss and stop, at EVERY latch and every
                // config: a dismissal never arms or releases a latch, and it
                // never runs an owner.
                expect(withKeyboard.decision).toEqual({
                  action: "dismiss_keyboard",
                  nextLatch: latch,
                  pending: null,
                });
                expect(withKeyboard.calls).toBe(0);
              } else {
                // Not a keyboard press: exactly the pre-existing rules 1-4,
                // byte for byte, which is why they are compared against a
                // dispatch that was handed no keyboard at all.
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

  // [TEST-MOD-APPROVED #3446] Replaces R-1..R-5 and the
  // `WIZARD_KEYBOARD_BACK_WINDOW_MS` bound assertions. Those cases policed the
  // BEHAVIOUR of a deadline (never expires, `now` must not matter). This polices
  // the STRUCTURE instead: the module is never handed a clock, so no deadline
  // can be written without changing the type. That is the guard the two failed
  // attempts both needed — #3446's 1,000 ms request bound and the 300 ms hide
  // window were each added by someone reasoning about a number.
  describe("D-2 the decision module is never handed a clock", () => {
    test("WizardHardwareBackKeyboard has exactly one field, imeUp", () => {
      const keyboard: WizardHardwareBackKeyboard = { imeUp: true };
      expect(Object.keys(keyboard)).toEqual(["imeUp"]);
      expect(typeof keyboard.imeUp).toBe("boolean");
    });

    test("the routing module's source carries no clock and no deadline", () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path") as typeof import("node:path");
      const source = fs.readFileSync(
        path.join(__dirname, "..", "wizardHardwareBackRouting.ts"),
        "utf8",
      );
      // Strip line comments: the prose deliberately NAMES the retired bounds
      // ("1,000 ms", "300 ms") so the next reader learns why they are gone.
      const code = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      expect(code).not.toMatch(/\bDate\b/);
      expect(code).not.toMatch(/\bnow\b/);
      expect(code).not.toMatch(/_MS\b/);
      // A relational operator is the shape every failed attempt took:
      // `now - stampedAt <= BOUND`. Note `<` and `>` alone cannot be tested
      // here — they are TypeScript generic brackets on almost every line — so
      // the pin is the relational pair, which generics never produce.
      expect(code).not.toMatch(/<=|>=/);
      expect(code).not.toMatch(/\bsetTimeout\b|\bsetInterval\b/);
      // No numeric literal at all in the module: the two retired deadlines were
      // each written as one (1_000 and 300).
      expect(code).not.toMatch(/\b\d[\d_]*\b/);
    });

    test("the hook's source reads no clock either", () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path") as typeof import("node:path");
      const source = fs.readFileSync(
        path.join(__dirname, "..", "useWizardHardwareBack.native.ts"),
        "utf8",
      );
      const code = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toMatch(/Date\s*\.\s*now/);
      expect(code).not.toMatch(/\bsetTimeout\b|\bsetInterval\b/);
    });
  });

  test("D-3 a caller that passes no keyboard behaves exactly as before", () => {
    for (const latch of LATCHES) {
      for (const busy of [false, true]) {
        for (const isFirstStep of [false, true]) {
          const omitted = decide(latch, busy, isFirstStep, undefined);
          const down = decide(latch, busy, isFirstStep, { imeUp: false });
          expect(omitted.decision).toEqual(down.decision);
          expect(omitted.calls).toBe(down.calls);
        }
      }
    }
  });
});

// ===========================================================================
// §7.B route A — the IME ate the press. This is the DOMINANT path on the
// device, and the one the retired model was inert on.
// ===========================================================================

describe("#3446 V2 §7.B route A — the IME ate press 1; the press we receive acts", () => {
  test("A-1 later step: the IME hides itself, then our press steps back", async () => {
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    // Press 1 never reaches us: the IME window consumed KEYCODE_BACK and hid
    // itself (ORIGIN_IME / HIDE_SOFT_INPUT_BY_BACK_KEY). The only trace in JS
    // is the onset event, 124 ms later.
    mockIme.emit("keyboardWillHide");

    // Press 2 — the FIRST press we receive — must act.
    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    // Nothing was dismissed: the keyboard was already going.
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("A-2 Step 1: the same sequence runs the wizard's own close owner, once", async () => {
    // Lineage: the Step-1 half of the retired K-12, re-expressed on route A.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o, isFirstStep: true }));

    mockIme.emit("keyboardWillHide");

    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);

    // The exit latch holds: a second press never runs the exit path twice.
    waitMs(700);
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("A-3 no render happens between the hide and the press: it still steps", async () => {
    // THE property under test. The retired model read a React-committed value,
    // so it could only see a keyboard change after a render — 0.5-1.4 s late.
    // If anyone moves `imeUp` back into React state, this goes red, because the
    // renderer is never updated here.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    const rendersAfterMount = renders;
    mockIme.emit("keyboardWillHide");
    expect(await press()).toBe(true);

    expect(renders).toBe(rendersAfterMount);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("A-4 four IME-eaten cycles in ONE focus: four steps, zero dead presses", async () => {
    const o = owners();
    await mount(configOf({ ...o }));

    for (let cycle = 1; cycle <= 4; cycle += 1) {
      // The host taps a field, the keyboard comes up.
      mockIme.emit("keyboardWillShow");
      // Back press 1 is eaten by the IME; we never see it.
      mockIme.emit("keyboardWillHide");
      // Back press 2 reaches us.
      expect(await press()).toBe(true);
      expect(o.onStepBack).toHaveBeenCalledTimes(cycle);
    }

    expect(o.onStepBack).toHaveBeenCalledTimes(4);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });
});

// ===========================================================================
// §7.B route B — we DO receive the press with the IME genuinely up. This is
// the original #3446 finding, and it must stay fixed: one press, one dismissal,
// the wizard does not move.
// ===========================================================================

describe("#3446 V2 §7.B route B — a press we receive with the IME up only dismisses", () => {
  test("B-1 the press dismisses the keyboard and nothing else", async () => {
    // Lineage: the retired K-1 (and G-7), re-expressed on the new harness.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    expect(await press()).toBe(true);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(mockIme.dismissRequests).toBe(1);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("B-2 the very next press acts, with NO keyboard event in between", async () => {
    // The optimistic flag-down. The hook sets `imeUp` false at the same instant
    // it calls Keyboard.dismiss(), so the next press does not wait on
    // keyboardWillHide. Delete `noteImeDismissRequested()` from the hook and
    // this goes red at 0 ms.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);

    // No emit. No render. No clock advance at all.
    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("B-3 Step 1: press 1 dismisses only, press 2 exits, and exit never runs twice", async () => {
    // Lineage: the retired K-5 and the second half of K-12.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o, isFirstStep: true }));

    // A dismissal must not arm the exit latch, or press 2 would do nothing.
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);

    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);

    waitMs(50);
    expect(await press()).toBe(true);
    expect(o.onExit).toHaveBeenCalledTimes(1);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });
});

// ===========================================================================
// §7.B — the bounce, the named residual, and the contract that does not change
// ===========================================================================

describe("#3446 V2 §7.B the keyboard coming back, and the accepted residual", () => {
  test("C-1 the keyboard bounced back up (F-6): the next press only dismisses", async () => {
    // Lineage: the retired K-11 (and G-5/G-6). An IME-consumed hide leaves the
    // RN input focused, and the keyboard was observed re-showing itself 153 ms
    // later. `keyboardWillShow` flips `imeUp` back true, and dismissing is then
    // CORRECT — the keyboard is genuinely arriving on screen.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    expect(await press()).toBe(true);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);

    // It comes back on its own.
    mockIme.emit("keyboardWillShow");
    waitMs(153);

    expect(await press()).toBe(true);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(2);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });

  test("C-2 SC-8 the named residual: a press inside the willHide latency is swallowed, never mis-routed", async () => {
    // SC-8, the ONLY accepted dead press in the design, and it is accepted
    // rather than timed away on purpose. V2 cannot make a second press act if
    // it arrives before `keyboardWillHide` reaches JS — measured 124 ms on
    // emulator-5564 under ~10 load, budgeted 200 ms. That is INSIDE Android's
    // own 300 ms double-tap timeout, the platform's line between one gesture
    // and two.
    //
    // Adding a timer to paper over it is exactly how #3446 and #3462 both
    // failed. Do not add one. The requirement is only that such a press is
    // SWALLOWED, never routed to the wrong destination.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    // Press 1 is eaten by the IME. `keyboardWillHide` has NOT arrived yet.
    // Press 2 lands inside that latency.
    waitMs(80);
    expect(await press()).toBe(true);

    // Swallowed as a dismissal — and crucially NOT a step back or an exit.
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(RN.mockBack.fallthrough).toBe(0);

    // It costs exactly one press: the optimistic flag-down means press 3 acts,
    // even though `keyboardWillHide` still has not arrived.
    expect(await press()).toBe(true);
    expect(o.onStepBack).toHaveBeenCalledTimes(1);
  });

  test("C-3 a dismissal neither arms nor releases the async step latch (Trip saves first)", async () => {
    // Lineage: the retired K-7, re-expressed. Unchanged contract.
    let resolve!: () => void;
    const saving = new Promise<void>((yes) => {
      resolve = yes;
    });
    const onStepBack = jest.fn<() => Promise<void>>(() => saving);
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ onStepBack }));

    // Dismissal first: must not arm "stepping".
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(0);
    expect(await press()).toBe(true);
    expect(onStepBack).toHaveBeenCalledTimes(1);

    // While that save is in flight the keyboard comes up and back dismisses it.
    // The dismissal must not release "stepping" either.
    mockIme.emit("keyboardWillShow");
    expect(await press()).toBe(true);
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

  test("C-4 a listener registered after ours consumes the press first", async () => {
    // Native overlays go first for free, and JS listeners registered later do
    // too (BackHandler runs newest-first). Unchanged contract.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    const overlay = jest.fn<() => boolean>(() => true);
    RN.mockBack.subs.push(overlay);

    expect(await press()).toBe(true);
    expect(overlay).toHaveBeenCalledTimes(1);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(0);
    expect(o.onStepBack).toHaveBeenCalledTimes(0);
    expect(o.onExit).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// The #3462 gap sweep, kept. Its MECHANISM is gone but its user-visible
// contract is the same one the device sweep measures, so it stays pinned.
// ===========================================================================

describe("#3446 V2 / #3462 P2-1 — every press after a back-dismissal acts, at every gap", () => {
  // 1500 ms is where the retired model was 3/3 dead on emulator-5564. Under V2
  // the clock is not read at all, so every gap must behave identically — which
  // is what these three prove.
  const SWEEP_MS = [250, 700, 1_500, 3_000];

  test("G-1 dismiss, wait, press: steps back at 250 ms, 700 ms, 1.5 s and 3 s", async () => {
    for (const gap of SWEEP_MS) {
      await resetTrial();
      const o = owners();
      mockIme.emit("keyboardWillShow");
      await mount(configOf({ ...o }));

      // Press 1: the IME is genuinely up, so it only dismisses.
      expect(await press()).toBe(true);
      expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
      expect(o.onStepBack).toHaveBeenCalledTimes(0);

      // No keyboard event EVER arrives — the loaded device, where the onset
      // event is late or the React commit never lands in time. The press must
      // still step, because the hook already flagged the IME down.
      waitMs(gap);
      expect(await press()).toBe(true);
      expect(o.onStepBack).toHaveBeenCalledTimes(1);
      expect(o.onExit).toHaveBeenCalledTimes(0);
      expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
      expect(RN.mockBack.fallthrough).toBe(0);
    }
  });

  test("G-2 on Step 1 the same sweep exits, once, at every gap", async () => {
    for (const gap of SWEEP_MS) {
      await resetTrial();
      const o = owners();
      mockIme.emit("keyboardWillShow");
      await mount(configOf({ ...o, isFirstStep: true }));

      expect(await press()).toBe(true);
      expect(o.onExit).toHaveBeenCalledTimes(0);

      waitMs(gap);
      expect(await press()).toBe(true);
      expect(o.onExit).toHaveBeenCalledTimes(1);
      expect(o.onStepBack).toHaveBeenCalledTimes(0);
      expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
      expect(RN.mockBack.fallthrough).toBe(0);
    }
  });

  test("G-3 one focus, the whole sweep: four presses, four steps, no dead press", async () => {
    // The device sweep is one continuous session, not four fresh trials. Every
    // press in it must move the wizard — there is no gap, early or late, in
    // which one is swallowed.
    const o = owners();
    mockIme.emit("keyboardWillShow");
    await mount(configOf({ ...o }));

    expect(await press()).toBe(true);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);

    let expected = 0;
    for (const gap of SWEEP_MS) {
      waitMs(gap);
      expect(await press()).toBe(true);
      expected += 1;
      expect(o.onStepBack).toHaveBeenCalledTimes(expected);
    }
    expect(o.onStepBack).toHaveBeenCalledTimes(SWEEP_MS.length);
    expect(RN.Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(o.onExit).toHaveBeenCalledTimes(0);
    expect(RN.mockBack.fallthrough).toBe(0);
  });
});
