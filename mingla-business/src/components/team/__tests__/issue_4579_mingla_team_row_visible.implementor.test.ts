/**
 * #4579 retest (Android) — the Mingla Team row is visible on the FIRST open of
 * Team & permissions.
 *
 * Device: the data loads after the screen mounts (hidden -> on). The section
 * treated that as an On/Off swap, set the opacity to 0 and started a native-
 * driver fade on the Animated.View that mounted in the same commit; on Android
 * the fade did not take and the row stayed at opacity 0 while still tappable.
 *
 * Mounted with react-test-renderer over a recording Animated stand-in, so the
 * opacity the row is drawn with is read off the tree.
 *
 * fails-on-revert: restore the old effect (fade on any view change, no reset)
 * and "hidden -> on" reads opacity 0 with a fade started; drop the completion
 * reset and "an interrupted fade never strands 0" goes red.
 */
import type React from "react";

type Rec = { timings: number; stops: number; pendingDone: (() => void)[] };

function load(rec: Rec) {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const R = jest.requireActual("react") as typeof React;
  class FakeValue {
    value: number;
    constructor(v: number) {
      this.value = v;
    }
    setValue(v: number): void {
      this.value = v;
    }
  }
  const host = (name: string) => (props: { children?: React.ReactNode }) =>
    R.createElement(name, props as Record<string, unknown>, props.children);
  jest.doMock("react-native", () => ({
    Animated: {
      Value: FakeValue,
      View: host("AnimatedView"),
      timing: (v: FakeValue, cfg: { toValue: number }) => ({
        start: (done?: (r: { finished: boolean }) => void) => {
          rec.timings += 1;
          // Left pending: a native fade that never reports back (the Android case).
          rec.pendingDone.push(() => {
            v.value = cfg.toValue;
            done?.({ finished: true });
          });
        },
        stop: () => {
          rec.stops += 1;
        },
      }),
    },
    Platform: { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: host("Pressable"),
    ScrollView: host("ScrollView"),
    StyleSheet: { create: <T,>(s: T): T => s, hairlineWidth: 1 },
    Text: host("Text"),
    View: host("View"),
  }));
  jest.doMock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
  jest.doMock("../../../hooks/useMotionPreferences", () => ({ useReduceMotion: () => false }));
  jest.doMock("../../ui/Button", () => ({ Button: host("Button") }));
  jest.doMock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: host("ConfirmDialog") }));
  jest.doMock("../../ui/GlassCard", () => ({ GlassCard: host("GlassCard") }));
  jest.doMock("../../ui/Sheet", () => ({ Sheet: host("Sheet") }));
  jest.doMock("../../ui/Toast", () => ({ Toast: host("Toast") }));
  jest.doMock("../MinglaTeamMark", () => ({ MINGLA_TEAM_NAME: "Mingla Team", MinglaTeamMark: host("Mark") }));
  const TR = require("react-test-renderer") as {
    create: (e: unknown) => { root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] }; update: (e: unknown) => void; unmount: () => void };
    act: (cb: () => void) => void;
  };
  const { MinglaTeamSection, minglaTeamShouldCrossFade } = require("../MinglaTeamSection") as {
    MinglaTeamSection: React.ComponentType<Record<string, unknown>>;
    minglaTeamShouldCrossFade: (a: string, b: string, r: boolean) => boolean;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { R, TR, MinglaTeamSection, minglaTeamShouldCrossFade };
}

const ON = { status: "active", since: "2026-11-23T10:00:00Z", canRemove: true, canRestore: true };
const OFF = { status: "removed", since: null, canRemove: true, canRestore: true };

function props(state: unknown): Record<string, unknown> {
  return {
    state,
    isWideDesktop: false,
    removePending: false,
    restorePending: false,
    onRemove: async () => undefined,
    onRestore: async () => undefined,
    onSuccess: () => undefined,
    onError: () => undefined,
    defer: (fn: () => void) => fn(),
  };
}

describe("#4579 retest (Android) — the Mingla Team row is never left invisible", () => {
  afterEach(() => jest.dontMock("react-native"));

  function mountSequence(states: unknown[]) {
    const rec: Rec = { timings: 0, stops: 0, pendingDone: [] };
    const { R, TR, MinglaTeamSection } = load(rec);
    let tree: ReturnType<typeof TR.create> | null = null;
    TR.act(() => {
      tree = TR.create(R.createElement(MinglaTeamSection, props(states[0])));
    });
    const opacityAfter: (number | null)[] = [];
    const read = (): number | null => {
      const t = tree as unknown as ReturnType<typeof TR.create>;
      const views = t.root.findAll((n) => n.type === "AnimatedView");
      if (views.length === 0) return null;
      return (views[0].props.style as { opacity: { value: number } }).opacity.value;
    };
    opacityAfter.push(read());
    for (const s of states.slice(1)) {
      TR.act(() => {
        (tree as unknown as ReturnType<typeof TR.create>).update(R.createElement(MinglaTeamSection, props(s)));
      });
      opacityAfter.push(read());
    }
    return { rec, opacityAfter, tree: tree as unknown as ReturnType<typeof TR.create>, TR };
  }

  it("first load (hidden -> on): the row is drawn at opacity 1 and no fade is started", () => {
    const { rec, opacityAfter } = mountSequence([null, ON]);
    expect(opacityAfter).toEqual([null, 1]);
    expect(rec.timings).toBe(0);
  });

  it("first load straight to off (hidden -> off) is also instant at opacity 1", () => {
    const { rec, opacityAfter } = mountSequence([undefined, OFF]);
    expect(opacityAfter).toEqual([null, 1]);
    expect(rec.timings).toBe(0);
  });

  it("a real swap (on -> off -> on) cross-fades each time and ends at opacity 1", () => {
    const { rec, opacityAfter, TR } = mountSequence([ON, OFF]);
    expect(opacityAfter).toEqual([1, 0]);
    expect(rec.timings).toBe(1);
    TR.act(() => rec.pendingDone.shift()?.());
    const second = mountSequence([ON, OFF, ON]);
    expect(second.rec.timings).toBe(2);
    TR.act(() => {
      while (second.rec.pendingDone.length > 0) second.rec.pendingDone.shift()?.();
    });
    const views = second.tree.root.findAll((n) => n.type === "AnimatedView");
    expect((views[0].props.style as { opacity: { value: number } }).opacity.value).toBe(1);
  });

  it("an interrupted fade never strands opacity 0 (swap, then the section goes hidden and comes back)", () => {
    const { rec, opacityAfter } = mountSequence([ON, OFF, null, ON]);
    // The swap started a fade that never reported back; going hidden stops it
    // and resets to 1; coming back is a first load again: visible, no fade.
    expect(rec.stops).toBeGreaterThanOrEqual(1);
    expect(opacityAfter[3]).toBe(1);
    expect(rec.timings).toBe(1);
  });

  it("the pure rule: only on <-> off cross-fades, never with reduced motion", () => {
    const { minglaTeamShouldCrossFade } = load({ timings: 0, stops: 0, pendingDone: [] });
    expect(minglaTeamShouldCrossFade("hidden", "on", false)).toBe(false);
    expect(minglaTeamShouldCrossFade("hidden", "off", false)).toBe(false);
    expect(minglaTeamShouldCrossFade("on", "hidden", false)).toBe(false);
    expect(minglaTeamShouldCrossFade("on", "on", false)).toBe(false);
    expect(minglaTeamShouldCrossFade("on", "off", false)).toBe(true);
    expect(minglaTeamShouldCrossFade("off", "on", false)).toBe(true);
    expect(minglaTeamShouldCrossFade("off", "on", true)).toBe(false);
  });
});
