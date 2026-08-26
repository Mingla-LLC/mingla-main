/**
 * #2649 [ari-keyboard-hides-newest-message] — implementor happy-path suite.
 *
 * THE DEFECT. `MessageList` was a TOP-anchored FlatList sitting next to a
 * composer that grows when the keyboard opens. The composer's growth came out
 * of the list's own viewport (measured: 286.00pt on iPhone 16, 252.73dp on
 * Pixel 5) while `contentOffset.y` never moved — zero `onScroll` events fired
 * across the entire keyboard cycle — so ~268pt of the newest messages fell
 * below the fold. The fix stops the thread being top-anchored: `inverted`, fed
 * newest-first, pins the newest row to the frame's bottom edge by construction.
 *
 * WHY THIS SUITE RENDERS INSTEAD OF GREPPING. Inverting silently moved every
 * ORCH-1101 cluster gap onto the WRONG boundary, because
 * `ItemSeparatorComponent` receives only `leadingItem` — the item before the
 * gap in DATA order — whose meaning flips when the list inverts. #2649 F-8
 * caught that by reading rendered separator heights out of the DOM; a source
 * pin read correctly the whole time and would have shipped it. So T-2 below
 * mounts the REAL component and reads the REAL resolved `height` off the REAL
 * separator elements, in VISUAL top-to-bottom order.
 *
 * THE HARNESS, AND WHAT IT IS ALLOWED TO KNOW. This suite runs under the
 * default node/ts-jest config (the only universally-required gate), whose
 * `react-native` map is a set of inert passthroughs — its `FlatList` renders
 * nothing at all, so separators would never materialise. This file therefore
 * substitutes a FlatList that implements the container's DOCUMENTED contract
 * and nothing else:
 *
 *   - cells are produced in DATA order;
 *   - a separator is rendered after every cell except the last, carrying
 *     `leadingItem = data[i]`;
 *   - `inverted` paints that whole sequence bottom-to-top, so data[0] ends up
 *     visually LAST and the separator following cell i sits between data[i]
 *     and data[i+1] with data[i] BELOW it.
 *
 * The emulator knows nothing about gaps, grouping, speakers or `gapAbove`. Its
 * fidelity is itself asserted in the first describe block below, against a
 * fixture whose expected interleave is written out by hand — a harness that
 * silently mis-models inversion would make every downstream assertion
 * meaningless, which is the ORCH-1373 decorative-guard failure mode.
 *
 * fails-on-revert (both legs proven by true line deletion, not comment-out):
 *   - delete `inverted` from the FlatList → T-1's visual-order assertion goes
 *     red (the thread paints newest-first, top-down);
 *   - restore the old `lead.tail === false` separator predicate → T-2's
 *     rendered heights come back [4,10,4,10,10] against an expected
 *     [10,4,10,4,10]: every cluster gap one boundary off, exactly F-8.
 *
 * Adversarial coverage (T-3 empty, T-4 single, T-5 pending+thinking tail order,
 * T-8 short-content bottom pinning, T-9 the pre-transform padding swap) is
 * tester-owned per SPEC §9 and deliberately not pre-empted here.
 */

import React from "react";

// React 19 gates its act() support on this flag; without it every mount logs a
// "testing environment is not configured to support act(...)" error that buries
// real output. (The react-test-renderer deprecation notice is expected noise.)
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { ariThread } from "../../../constants/designSystem";

// ─────────────────────────── the FlatList emulator ──────────────────────────
/**
 * Records every prop the component under test hands the container, so T-1 can
 * assert on `inverted` / `data` as RENDERED PROPS rather than as source text.
 */
type CapturedProps = Record<string, unknown>;
const captured: { last: CapturedProps | null } = { last: null };

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  // The default config maps `react-native` to `__manual_mocks__/react-native.js`;
  // keep every primitive it provides (StyleSheet.create, View, Text, Platform…)
  // and replace ONLY the container whose rendering behaviour is under test.
  // `requireActual` goes through the same moduleNameMapper but bypasses THIS
  // factory — requiring the mapped file by relative path re-enters it and blows
  // the stack, because both resolve to the same module registry entry.
  const base = jest.requireActual("react-native");

  const FlatList = (props: Record<string, unknown>): React.ReactElement => {
    const data = (props.data as unknown[]) ?? [];
    const renderItem = props.renderItem as
      | ((info: { item: unknown; index: number }) => React.ReactNode)
      | undefined;
    const keyExtractor = props.keyExtractor as
      | ((item: unknown, index: number) => string)
      | undefined;
    const Separator = props.ItemSeparatorComponent as
      | React.ComponentType<{ leadingItem: unknown; highlighted: boolean }>
      | undefined;

    // Stand in for the container's imperative handle so the auto-scroll effect
    // executes for real and records which method it reached for. Published on
    // globalThis because a jest.mock factory cannot close over module scope.
    const g = globalThis as unknown as {
      __issue2649ScrollCalls?: { method: string; arg: unknown }[];
    };
    if (!g.__issue2649ScrollCalls) g.__issue2649ScrollCalls = [];
    const calls = g.__issue2649ScrollCalls;
    const listRef = props.ref as { current: unknown } | undefined;
    if (listRef && typeof listRef === "object" && "current" in listRef) {
      listRef.current = {
        scrollToOffset: (arg: unknown) => calls.push({ method: "scrollToOffset", arg }),
        scrollToEnd: (arg: unknown) => calls.push({ method: "scrollToEnd", arg }),
        scrollToIndex: (arg: unknown) => calls.push({ method: "scrollToIndex", arg }),
      };
    }

    const slots: React.ReactNode[] = [];
    data.forEach((item, index) => {
      const key = keyExtractor ? keyExtractor(item, index) : String(index);
      slots.push(
        ReactModule.createElement(
          "MockCell",
          { key: `cell-${key}`, dataIndex: index },
          renderItem ? renderItem({ item, index }) : null,
        ),
      );
      // FlatList renders a separator after every cell but the last, and hands
      // it the item BEFORE the separator in data order.
      if (Separator && index < data.length - 1) {
        slots.push(
          ReactModule.createElement(
            "MockSeparatorSlot",
            { key: `sep-${key}` },
            ReactModule.createElement(Separator, { leadingItem: item, highlighted: false }),
          ),
        );
      }
    });

    // `inverted` paints the cell/separator sequence bottom-to-top: data[0]
    // lands at the visual BOTTOM. Reversing the flattened sequence reproduces
    // that exactly — the separator following cell i still sits between data[i]
    // and data[i+1], with data[i] now the row BELOW it.
    const visualOrder = props.inverted ? slots.slice().reverse() : slots;
    const { ref: _ref, ...hostProps } = props;
    return ReactModule.createElement("FlatList", hostProps, visualOrder);
  };

  return { ...base, FlatList };
});

// ───────────────────────────── boundary stubs ───────────────────────────────
// Leaf presentation components are boundaries for this suite: what is under
// test is MessageList's own ordering, grouping and separator behaviour. The
// stubs carry the message text through so visual order is readable off the
// rendered tree. (AriOrb pulls react-native-svg + reanimated, and
// ToolProposalCard pulls the brand hooks and Supabase — neither loads under a
// node runner, and neither is what this suite is proving.)
jest.mock("../ChatBubble", () => ({
  ChatBubble: (props: { text: string; hideOrb?: boolean; tail?: boolean }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ChatBubbleStub", {
      text: props.text,
      hideOrb: props.hideOrb,
      tail: props.tail,
    }),
}));
jest.mock("../ToolProposalCard", () => ({
  ToolProposalCard: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToolProposalCardStub", null),
}));
jest.mock("../ResponseCard", () => ({
  ResponseCard: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ResponseCardStub", null),
}));
jest.mock("../QuickReplyChips", () => ({
  QuickReplyChips: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("QuickReplyChipsStub", null),
}));
jest.mock("../ClarifyingCard", () => ({
  ClarifyingCard: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ClarifyingCardStub", null),
}));
jest.mock("../MultiSelectPrompt", () => ({
  MultiSelectPrompt: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("MultiSelectPromptStub", null),
}));
jest.mock("lucide-react-native", () => ({
  Check: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("CheckStub", null),
}));

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => JsonNode };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MessageList } = require("../MessageList") as {
  MessageList: React.ComponentType<Record<string, unknown>>;
};

// ───────────────────────────── tree utilities ───────────────────────────────
interface JsonElement {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}
type JsonNode = JsonElement | string | null;

const isElement = (node: JsonNode): node is JsonElement =>
  typeof node === "object" && node !== null && typeof (node as JsonElement).type === "string";

function findFirst(node: JsonNode, type: string): JsonElement | null {
  if (!isElement(node)) return null;
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const hit = findFirst(child, type);
    if (hit) return hit;
  }
  return null;
}

function collect(node: JsonNode, type: string, out: JsonElement[] = []): JsonElement[] {
  if (!isElement(node)) return out;
  if (node.type === type) out.push(node);
  for (const child of node.children ?? []) collect(child, type, out);
  return out;
}

/** The container node, with every prop the component actually passed it. */
function renderThread(props: Record<string, unknown>): JsonElement {
  let tree: { toJSON: () => JsonNode } | null = null;
  act(() => {
    tree = create(React.createElement(MessageList, props));
  });
  const json = (tree as unknown as { toJSON: () => JsonNode }).toJSON();
  const list = findFirst(json, "FlatList");
  if (!list) throw new Error("no FlatList rendered");
  captured.last = list.props;
  return list;
}

/** Message text of every rendered bubble, in VISUAL top-to-bottom order. */
const visualBubbleText = (list: JsonElement): string[] =>
  collect(list, "ChatBubbleStub").map((n) => String(n.props.text));

/** Resolved separator heights, in VISUAL top-to-bottom order. */
function visualSeparatorHeights(list: JsonElement): number[] {
  return collect(list, "MockSeparatorSlot").map((slot) => {
    const view = (slot.children ?? []).find(isElement);
    if (!view) throw new Error("separator slot rendered nothing");
    const style = view.props.style as { height?: number } | undefined;
    if (!style || typeof style.height !== "number") {
      throw new Error(`separator has no resolved height: ${JSON.stringify(view.props.style)}`);
    }
    return style.height;
  });
}

// ──────────────────────────────── fixtures ──────────────────────────────────
let seq = 0;
const msg = (role: "user" | "assistant", text: string): Record<string, unknown> => ({
  id: `m${(seq += 1)}`,
  role,
  content: { text },
  tool_calls: null,
  tool_results: null,
  created_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
});

const baseProps = {
  pendingAction: null,
  isExecuting: false,
  onConfirm: async () => ({ ok: true }),
  onCancel: () => {},
};

// The node test environment has no rAF, and MessageList's auto-scroll effect
// schedules through one. Run it synchronously so the effect executes for real
// rather than being silently swallowed.
const globalWithRaf = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  __issue2649ScrollCalls?: { method: string; arg: unknown }[];
};
if (!globalWithRaf.requestAnimationFrame) {
  globalWithRaf.requestAnimationFrame = (cb) => {
    cb(0);
    return 0;
  };
}
const scrollCalls = (): { method: string; arg: unknown }[] =>
  globalWithRaf.__issue2649ScrollCalls ?? [];

beforeEach(() => {
  seq = 0;
  captured.last = null;
  scrollCalls().length = 0;
});

// ═════════════════════ harness fidelity (test the instrument) ═══════════════
describe("#2649 harness — the FlatList emulator models the documented contract", () => {
  it("interleaves separators after every cell but the last, leadingItem = data[i]", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FlatList } = require("react-native") as {
      FlatList: React.ComponentType<Record<string, unknown>>;
    };
    const data = ["A", "B", "C"];
    const probe = (inverted: boolean): string[] => {
      let tree: { toJSON: () => JsonNode } | null = null;
      act(() => {
        tree = create(
          React.createElement(FlatList, {
            data,
            inverted,
            keyExtractor: (item: unknown) => String(item),
            renderItem: ({ item }: { item: unknown }) =>
              React.createElement("Row", { label: String(item) }),
            ItemSeparatorComponent: ({ leadingItem }: { leadingItem: unknown }) =>
              React.createElement("Sep", { lead: String(leadingItem) }),
          }),
        );
      });
      const json = (tree as unknown as { toJSON: () => JsonNode }).toJSON();
      const list = findFirst(json, "FlatList");
      if (!list) throw new Error("no list");
      // Visual top-to-bottom transcript of the container's direct children.
      return (list.children ?? []).filter(isElement).map((slot) => {
        const inner = (slot.children ?? []).find(isElement);
        if (!inner) return "?";
        return inner.type === "Row" ? `row:${inner.props.label}` : `sep:${inner.props.lead}`;
      });
    };

    // Non-inverted: data order IS visual order, separator sits BELOW its lead.
    expect(probe(false)).toEqual(["row:A", "sep:A", "row:B", "sep:B", "row:C"]);
    // Inverted: data[0] is painted last (visual bottom), and the separator
    // carrying leadingItem = X now sits ABOVE X. This flip is the entire reason
    // a data-order-relative flag cannot survive inversion.
    expect(probe(true)).toEqual(["row:C", "sep:B", "row:B", "sep:A", "row:A"]);
  });
});

// ═══════════════════════════════════ T-1 ════════════════════════════════════
describe("#2649 T-1 — the Ari thread is bottom-anchored by construction", () => {
  const twelve = [
    msg("user", "u-01"),
    msg("assistant", "a-02"),
    msg("user", "u-03"),
    msg("assistant", "a-04"),
    msg("user", "u-05"),
    msg("assistant", "a-06"),
    msg("user", "u-07"),
    msg("assistant", "a-08"),
    msg("user", "u-09"),
    msg("assistant", "a-10"),
    msg("user", "u-11"),
    msg("assistant", "a-12"),
  ];

  it("renders an inverted list whose data[0] is the NEWEST message", () => {
    const list = renderThread({ ...baseProps, messages: twelve });

    // Read off the container's rendered props, not off the source file.
    expect(list.props.inverted).toBe(true);

    const data = list.props.data as { message: { content: { text: string } } }[];
    expect(data).toHaveLength(12);
    expect(data[0].message.content.text).toBe("a-12"); // newest first
    expect(data[data.length - 1].message.content.text).toBe("u-01"); // oldest last
  });

  it("paints the thread oldest-at-top, newest-at-bottom against the composer", () => {
    // This is the assertion that dies if `inverted` is removed: the reversed
    // data would then paint newest-first, top-down.
    const list = renderThread({ ...baseProps, messages: twelve });
    expect(visualBubbleText(list)).toEqual([
      "u-01",
      "a-02",
      "u-03",
      "a-04",
      "u-05",
      "a-06",
      "u-07",
      "a-08",
      "u-09",
      "a-10",
      "u-11",
      "a-12",
    ]);
  });

  it("holds the newest row at offset 0 — no keyboard height reaches this list", () => {
    // The list must not have grown any keyboard coupling: bottom-anchoring is
    // structural. `maintainVisibleContentPosition` was measured byte-identical
    // to the broken baseline (F-6) and must not appear either.
    const list = renderThread({ ...baseProps, messages: twelve });
    expect(list.props.maintainVisibleContentPosition).toBeUndefined();
    expect(Object.keys(list.props).some((k) => /keyboardHeight|keyboardOffset/i.test(k))).toBe(
      false,
    );
  });

  it("brings a new message to the newest row via offset 0, never scrollToEnd", () => {
    // In an inverted list the newest row IS offset 0; scrollToEnd would now run
    // to the OLDEST message. This executes the real auto-scroll effect and
    // records the method it actually called.
    renderThread({ ...baseProps, messages: twelve });
    expect(scrollCalls()).toEqual([{ method: "scrollToOffset", arg: { offset: 0, animated: true } }]);
  });
});

// ═══════════════════════════════════ T-2 ════════════════════════════════════
describe("#2649 T-2 — ORCH-1101 speaker-grouping rhythm survives inversion", () => {
  /**
   * Two genuine same-speaker runs (a1→a2 and u2→u3). Read top-to-bottom the
   * gaps must be:
   *
   *   u1
   *      10  (user → ari, a turn boundary)
   *   a1
   *       4  (ari → ari, an iMessage cluster)
   *   a2
   *      10
   *   u2
   *       4  (user → user)
   *   u3
   *      10
   *   a3
   */
  const withRuns = [
    msg("user", "u1"),
    msg("assistant", "a1"),
    msg("assistant", "a2"),
    msg("user", "u2"),
    msg("user", "u3"),
    msg("assistant", "a3"),
  ];

  it("renders the cluster gap on the run boundaries and the turn gap elsewhere", () => {
    const list = renderThread({ ...baseProps, messages: withRuns });

    // Sanity: the fixture really did render in the visual order the expectation
    // below is written against.
    expect(visualBubbleText(list)).toEqual(["u1", "a1", "a2", "u2", "u3", "a3"]);

    // The load-bearing assertion — resolved heights off the rendered separator
    // elements, in visual order. Under the predicate this replaced these come
    // back [4, 10, 4, 10, 10]: every cluster gap one boundary off.
    expect(visualSeparatorHeights(list)).toEqual([
      ariThread.gapTurn, // u1 → a1
      ariThread.gapGroup, // a1 → a2   (cluster)
      ariThread.gapTurn, // a2 → u2
      ariThread.gapGroup, // u2 → u3   (cluster)
      ariThread.gapTurn, // u3 → a3
    ]);
  });

  it("keeps the orb on the first Ari bubble of a cluster and the tail on the last", () => {
    const list = renderThread({ ...baseProps, messages: withRuns });
    const bubbles = collect(list, "ChatBubbleStub");
    const byText = (t: string): JsonElement => {
      const hit = bubbles.find((b) => b.props.text === t);
      if (!hit) throw new Error(`no bubble ${t}`);
      return hit;
    };
    // a1 opens the Ari cluster: orb shown, tail dropped (interior bubble).
    expect(byText("a1").props.hideOrb).toBe(false);
    expect(byText("a1").props.tail).toBe(false);
    // a2 closes it: orb suppressed, tail restored.
    expect(byText("a2").props.hideOrb).toBe(true);
    expect(byText("a2").props.tail).toBe(true);
  });

  it("gives a bubble following a tool ribbon the full turn gap", () => {
    // A ribbon breaks a run, so the bubble after it must never cluster with the
    // bubble before it.
    const ribbon = {
      id: "tool-1",
      role: "tool",
      content: { text: "" },
      tool_calls: null,
      tool_results: { outcome: "executed", tool_name: "noop", result: {} },
      created_at: new Date(1_700_000_500_000).toISOString(),
    };
    const list = renderThread({
      ...baseProps,
      messages: [msg("assistant", "a1"), ribbon, msg("assistant", "a2")],
    });
    expect(visualSeparatorHeights(list)).toEqual([ariThread.gapTurn, ariThread.gapTurn]);
  });
});
