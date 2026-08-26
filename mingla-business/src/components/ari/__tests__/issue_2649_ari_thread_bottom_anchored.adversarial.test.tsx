/**
 * #2649 [ari-keyboard-hides-newest-message] — TESTER adversarial suite.
 *
 * Owns SPEC §7 T-3 (empty), T-4 (single), T-5 (pending + thinking tail order),
 * T-8 (short content pins to the bottom) and T-9 (the pre-transform padding
 * swap). The implementor's happy-path suite owns T-1, T-2 and T-6; this file
 * deliberately does not restate them.
 *
 * WHY THIS IS A DIFFERENT ANGLE, NOT A RENAMED COPY.
 *
 * 1. The happy suite proves the fix works on a well-formed thread. This suite
 *    attacks the shapes where an inverted list historically breaks: nothing to
 *    render, one thing to render, non-bubble rows pushed onto the tail, and a
 *    content container whose padding is silently upside down.
 *
 * 2. Its FlatList emulator is DERIVED INDEPENDENTLY. The happy suite builds the
 *    cell/separator sequence in data order and reverses the flattened array.
 *    This file never reverses anything: it walks data from the LAST index
 *    downwards and emits `cell_i`, then `separator(leadingItem = data[i-1])`,
 *    reconstructing the visual sequence from the container's documented
 *    contract directly. Two harnesses built by different routes that agree on
 *    the same component are corroboration; one harness asserting against itself
 *    is not. If the happy suite's inversion model were wrong, this file's
 *    expectations would diverge from it — they do not.
 *
 * 3. Several assertions here are COUPLED TO `inverted` ON PURPOSE, so they fail
 *    on revert of the fix rather than merely describing the code as written.
 *    T-9 is the clearest case: it asserts the RENDERED visual clearances (8 at
 *    the top, 32 above the composer), computed by applying the transform to the
 *    pre-transform style. Delete `inverted` and the same style resolves to 32/8
 *    and the test goes red — which is the real regression, because the padding
 *    swap and the inversion are only correct together.
 *
 * fails-on-revert: recorded in the TEST REPORT on #2649 with the measured
 * pass/fail split per leg.
 */

import React from "react";

// React 19 gates act() support on this flag; without it every mount logs a
// "testing environment is not configured to support act(...)" error.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { ariThread, spacing } from "../../../constants/designSystem";

// ───────────────── the FlatList emulator (independent derivation) ────────────
/**
 * RN renders a FlatList's children in DATA order — cell0, sep0, cell1, sep1,
 * … cellN-1 — where sep_i is handed `leadingItem = data[i]`, and `inverted`
 * paints that whole sequence bottom-to-top.
 *
 * Rather than build-then-reverse, this emulator constructs the VISUAL sequence
 * directly, top to bottom, by walking the data backwards:
 *
 *     for i = N-1 … 0:  emit cell_i;  if i > 0 emit sep_{i-1} (lead = data[i-1])
 *
 * which places data[N-1] at the visual top, data[0] at the visual bottom, and
 * each separator between the pair it belongs to with the row BELOW it as its
 * leading item. Non-inverted mode emits the plain data-order sequence.
 */
jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
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

    const g = globalThis as unknown as {
      __issue2649AdvScrollCalls?: { method: string; arg: unknown }[];
    };
    if (!g.__issue2649AdvScrollCalls) g.__issue2649AdvScrollCalls = [];
    const calls = g.__issue2649AdvScrollCalls;
    const listRef = props.ref as { current: unknown } | undefined;
    if (listRef && typeof listRef === "object" && "current" in listRef) {
      listRef.current = {
        scrollToOffset: (arg: unknown) => calls.push({ method: "scrollToOffset", arg }),
        scrollToEnd: (arg: unknown) => calls.push({ method: "scrollToEnd", arg }),
        scrollToIndex: (arg: unknown) => calls.push({ method: "scrollToIndex", arg }),
      };
    }

    const cellAt = (index: number): React.ReactNode =>
      ReactModule.createElement(
        "AdvCell",
        {
          key: `cell-${keyExtractor ? keyExtractor(data[index], index) : String(index)}`,
          dataIndex: index,
        },
        renderItem ? renderItem({ item: data[index], index }) : null,
      );
    const sepAfter = (leadIndex: number): React.ReactNode =>
      ReactModule.createElement(
        "AdvSeparatorSlot",
        { key: `sep-${leadIndex}`, leadIndex },
        Separator
          ? ReactModule.createElement(Separator, {
              leadingItem: data[leadIndex],
              highlighted: false,
            })
          : null,
      );

    const visual: React.ReactNode[] = [];
    if (props.inverted) {
      for (let i = data.length - 1; i >= 0; i -= 1) {
        visual.push(cellAt(i));
        if (i > 0) visual.push(sepAfter(i - 1));
      }
    } else {
      for (let i = 0; i < data.length; i += 1) {
        visual.push(cellAt(i));
        if (i < data.length - 1) visual.push(sepAfter(i));
      }
    }

    const { ref: _ref, ...hostProps } = props;
    return ReactModule.createElement("FlatList", hostProps, visual);
  };

  return { ...base, FlatList };
});

// ───────────────────────────── boundary stubs ───────────────────────────────
// Leaf presentation is a boundary: what is under test is MessageList's own
// ordering, tail composition and content-container geometry.
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

function renderThread(props: Record<string, unknown>): JsonElement {
  let tree: { toJSON: () => JsonNode } | null = null;
  act(() => {
    tree = create(React.createElement(MessageList, props));
  });
  const json = (tree as unknown as { toJSON: () => JsonNode }).toJSON();
  const list = findFirst(json, "FlatList");
  if (!list) throw new Error("no FlatList rendered");
  return list;
}

/** Every rendered row, in VISUAL top-to-bottom order, labelled by kind. */
function visualRows(list: JsonElement): string[] {
  return collect(list, "AdvCell").map((cell) => {
    const bubble = findFirst(cell, "ChatBubbleStub");
    if (bubble) return `msg:${String(bubble.props.text)}`;
    if (findFirst(cell, "ToolProposalCardStub")) return "pending";
    const kids = cell.children ?? [];
    if (kids.length === 0 || kids.every((k) => k === null)) return "empty";
    return "thinking";
  });
}

/** Resolved separator heights, in VISUAL top-to-bottom order. */
function visualSeparatorHeights(list: JsonElement): number[] {
  return collect(list, "AdvSeparatorSlot").map((slot) => {
    const view = (slot.children ?? []).find(isElement);
    if (!view) throw new Error("separator slot rendered nothing");
    const style = view.props.style as { height?: number } | undefined;
    if (!style || typeof style.height !== "number") {
      throw new Error(`separator has no resolved height: ${JSON.stringify(view.props.style)}`);
    }
    return style.height;
  });
}

/**
 * The clearances a USER SEES, derived by applying the container's transform to
 * the pre-transform contentContainerStyle. This is what makes T-9 fail on
 * revert of `inverted`: the padding swap is only correct while the list is
 * inverted, so the pair must be asserted together, never the raw style alone.
 */
function renderedClearances(list: JsonElement): { visualTop: number; visualBottom: number } {
  const style = (list.props.contentContainerStyle ?? {}) as {
    paddingTop?: number;
    paddingBottom?: number;
  };
  const pt = style.paddingTop ?? 0;
  const pb = style.paddingBottom ?? 0;
  return list.props.inverted
    ? { visualTop: pb, visualBottom: pt }
    : { visualTop: pt, visualBottom: pb };
}

// ──────────────────────────────── fixtures ──────────────────────────────────
let seq = 0;
const msg = (
  role: "user" | "assistant" | "tool",
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: `m${(seq += 1)}`,
  role,
  content: { text },
  tool_calls: null,
  tool_results: null,
  created_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  ...extra,
});

const baseProps = {
  pendingAction: null,
  isExecuting: false,
  onConfirm: async () => ({ ok: true }),
  onCancel: () => {},
};

const pendingFixture = {
  pending_action_id: "pa-1",
  tool_name: "create_event",
  tool_args: { title: "Rooftop set" },
};

// The node lane has no rAF and MessageList's auto-scroll effect schedules
// through one. Run it synchronously so the effect executes for real — DISC-3
// on the implementation report: without this the effect is a silent no-op and
// any assertion about it is unfalsifiable.
const globalWithRaf = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  __issue2649AdvScrollCalls?: { method: string; arg: unknown }[];
};
if (!globalWithRaf.requestAnimationFrame) {
  globalWithRaf.requestAnimationFrame = (cb) => {
    cb(0);
    return 0;
  };
}
const scrollCalls = (): { method: string; arg: unknown }[] =>
  globalWithRaf.__issue2649AdvScrollCalls ?? [];

beforeEach(() => {
  seq = 0;
  scrollCalls().length = 0;
});

// ══════════════════ harness fidelity (test the instrument) ══════════════════
describe("#2649 adversarial harness — the independent emulator agrees with the contract", () => {
  it("places data[0] at the visual BOTTOM and hands each separator the row BELOW it", () => {
    const Probe = (): React.ReactElement => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN = require("react-native");
      return React.createElement(RN.FlatList, {
        inverted: true,
        data: ["C", "B", "A"], // newest-first, as MessageList feeds it
        keyExtractor: (item: string) => item,
        renderItem: ({ item }: { item: string }) =>
          React.createElement("ProbeRow", { label: item }),
        ItemSeparatorComponent: ({ leadingItem }: { leadingItem: string }) =>
          React.createElement("ProbeSep", { lead: leadingItem }),
      });
    };
    let tree: { toJSON: () => JsonNode } | null = null;
    act(() => {
      tree = create(React.createElement(Probe));
    });
    const json = (tree as unknown as { toJSON: () => JsonNode }).toJSON();
    const list = findFirst(json, "FlatList") as JsonElement;

    const sequence: string[] = [];
    for (const child of list.children ?? []) {
      if (!isElement(child)) continue;
      const row = findFirst(child, "ProbeRow");
      if (row) {
        sequence.push(`row:${String(row.props.label)}`);
        continue;
      }
      const sep = findFirst(child, "ProbeSep");
      if (sep) sequence.push(`sep:${String(sep.props.lead)}`);
    }

    // Visual top-to-bottom: A (oldest) … C (newest) against the composer. Each
    // separator carries the row BELOW it — the gap between A and B is handed
    // B, and the gap between B and C is handed C. That is the whole reason
    // `gapAbove` is the right quantity to stamp: the leading item under
    // inversion is the row the gap sits above.
    expect(sequence).toEqual(["row:A", "sep:B", "row:B", "sep:C", "row:C"]);
  });
});

// ═══════════════════════════════════ T-3 ════════════════════════════════════
describe("#2649 T-3 — an empty thread renders nothing and crashes nothing", () => {
  it("renders no cells and no separators for an empty message array", () => {
    const list = renderThread({ ...baseProps, messages: [] });
    expect(visualRows(list)).toEqual([]);
    expect(collect(list, "AdvSeparatorSlot")).toHaveLength(0);
    expect(list.props.data).toEqual([]);
    // The bottom-anchoring contract holds even with nothing to anchor.
    expect(list.props.inverted).toBe(true);
  });

  it("does not reach for the scroll handle when there is nothing to scroll to", () => {
    renderThread({ ...baseProps, messages: [] });
    // MessageList guards its auto-scroll effect on items.length === 0. If that
    // guard is ever dropped, an inverted list would be told to scroll an empty
    // container on every mount.
    expect(scrollCalls()).toEqual([]);
  });

  it("stays empty when every message is filtered out rather than absent", () => {
    // Rows with no text are dropped before the list ever sees them. This is the
    // shape that looks non-empty to the caller and empty to the container — the
    // one an `items[0]`-style assumption breaks on.
    const list = renderThread({
      ...baseProps,
      messages: [msg("user", ""), msg("assistant", ""), msg("user", "")],
    });
    expect(visualRows(list)).toEqual([]);
    expect(collect(list, "AdvSeparatorSlot")).toHaveLength(0);
    expect(scrollCalls()).toEqual([]);
  });

  it("renders a lone thinking row on an otherwise empty thread, with no separator", () => {
    const list = renderThread({
      ...baseProps,
      messages: [],
      isThinking: true,
      renderThinking: () => React.createElement("ThinkingStub", null),
    });
    expect(collect(list, "AdvCell")).toHaveLength(1);
    expect(collect(list, "AdvSeparatorSlot")).toHaveLength(0);
    expect(findFirst(list, "ThinkingStub")).not.toBeNull();
  });
});

// ═══════════════════════════════════ T-4 ════════════════════════════════════
describe("#2649 T-4 — a single message renders with no separator and sits at the bottom", () => {
  it("renders exactly one row and never invokes the separator", () => {
    const list = renderThread({ ...baseProps, messages: [msg("user", "only")] });
    expect(visualRows(list)).toEqual(["msg:only"]);
    // A separator that ran here would be reading `gapAbove` off an undefined
    // leading item — the exact shape that crashed the thread in ORCH-1101.
    expect(collect(list, "AdvSeparatorSlot")).toHaveLength(0);
  });

  it("feeds that single message as data[0], the row pinned to the frame's bottom edge", () => {
    const list = renderThread({ ...baseProps, messages: [msg("assistant", "only")] });
    const data = list.props.data as { kind: string; message: { id: string } }[];
    expect(data).toHaveLength(1);
    expect(data[0].kind).toBe("message");
    expect(list.props.inverted).toBe(true);
  });
});

// ═══════════════════════════════════ T-5 ════════════════════════════════════
describe("#2649 T-5 — pending and thinking compose the tail in the right order", () => {
  const threadProps = {
    ...baseProps,
    messages: [msg("user", "u1"), msg("assistant", "a1")],
    pendingAction: pendingFixture,
    isThinking: true,
    renderThinking: () => React.createElement("ThinkingStub", null),
  };

  it("puts thinking bottom-most, pending directly above it, newest message above that", () => {
    const list = renderThread(threadProps);
    expect(visualRows(list)).toEqual(["msg:u1", "msg:a1", "pending", "thinking"]);
  });

  it("gives the non-bubble tail rows the full turn gap, never the cluster gap", () => {
    // The adversarial shape: the newest bubble is Ari, and `speakerOf()` also
    // reports "ari" for BOTH pending and thinking. Anything that let the
    // grouping pass reach those two rows would collapse these boundaries to
    // gapGroup and quietly retune the ORCH-1101 rhythm at the tail. Pinned at
    // the turn gap so that change cannot land silently.
    const list = renderThread(threadProps);
    const heights = visualSeparatorHeights(list);
    expect(heights).toEqual([
      ariThread.gapTurn, // u1 → a1 (speaker changes)
      ariThread.gapTurn, // a1 → pending
      ariThread.gapTurn, // pending → thinking
    ]);
    expect(heights).not.toContain(ariThread.gapGroup);
  });

  it("keeps the tail rows out of the newest bubble's cluster even mid-Ari-run", () => {
    // Two consecutive Ari bubbles form a genuine cluster (gapGroup between
    // them), and the pending card must NOT join it.
    const list = renderThread({
      ...threadProps,
      messages: [msg("user", "u1"), msg("assistant", "a1"), msg("assistant", "a2")],
    });
    expect(visualRows(list)).toEqual(["msg:u1", "msg:a1", "msg:a2", "pending", "thinking"]);
    expect(visualSeparatorHeights(list)).toEqual([
      ariThread.gapTurn, // u1 → a1
      ariThread.gapGroup, // a1 → a2, the same-speaker cluster
      ariThread.gapTurn, // a2 → pending
      ariThread.gapTurn, // pending → thinking
    ]);
  });

  it("still composes the tail correctly when pending is present without thinking", () => {
    const list = renderThread({
      ...baseProps,
      messages: [msg("assistant", "a1")],
      pendingAction: pendingFixture,
    });
    expect(visualRows(list)).toEqual(["msg:a1", "pending"]);
    expect(visualSeparatorHeights(list)).toEqual([ariThread.gapTurn]);
  });
});

// ═══════════════════════════════════ T-8 ════════════════════════════════════
describe("#2649 T-8 — short content pins to the bottom, and stays that way", () => {
  it("holds the bottom-anchoring contract when the thread is far shorter than the viewport", () => {
    // Verified on glass first (TEST REPORT SC-1/T-8: two messages sit against
    // the composer with the viewport empty above them). This pins the two
    // structural properties that produce it, so a later edit cannot undo the
    // behaviour while the screenshots still look like history.
    const list = renderThread({
      ...baseProps,
      messages: [msg("user", "u1"), msg("assistant", "a1")],
    });
    expect(list.props.inverted).toBe(true);

    const style = (list.props.contentContainerStyle ?? {}) as Record<string, unknown>;
    // An inverted list pins short content to the bottom because its content
    // container is free to be shorter than the frame. `flexGrow: 1`,
    // `justifyContent` or a `minHeight` would each stretch it and float the
    // thread back to the top — the classic "fix" for a non-inverted list, and
    // a regression here.
    expect(style.flexGrow).toBeUndefined();
    expect(style.justifyContent).toBeUndefined();
    expect(style.minHeight).toBeUndefined();
    expect(style.flex).toBeUndefined();
  });

  it("keeps the newest row as data[0] no matter how little content there is", () => {
    for (const count of [1, 2, 3]) {
      seq = 0;
      const messages = Array.from({ length: count }, (_, i) =>
        msg(i % 2 === 0 ? "user" : "assistant", `m${i}`),
      );
      const list = renderThread({ ...baseProps, messages });
      const rows = visualRows(list);
      // Visual order is always oldest-at-top, newest-against-the-composer.
      expect(rows[rows.length - 1]).toBe(`msg:m${count - 1}`);
    }
  });
});

// ═══════════════════════════════════ T-9 ════════════════════════════════════
describe("#2649 T-9 — the content padding is pre-transform and renders the ORCH-1101 geometry", () => {
  it("renders 8 of clearance at the visual top and 32 above the composer", () => {
    const list = renderThread({
      ...baseProps,
      messages: [msg("user", "u1"), msg("assistant", "a1")],
    });
    const { visualTop, visualBottom } = renderedClearances(list);
    // The ORCH-1101 geometry, unchanged: tight at the top, full scroll
    // clearance above the composer. Asserted as what the user sees, not as the
    // raw style — so deleting `inverted` (which flips the container back and
    // makes the same style render 32/8) turns this red.
    expect(visualTop).toBe(spacing.sm);
    expect(visualBottom).toBe(spacing.xl);
    expect(visualTop).toBe(8);
    expect(visualBottom).toBe(32);
  });

  it("carries the swapped values in the style itself, which is what makes it correct inverted", () => {
    const list = renderThread({ ...baseProps, messages: [msg("user", "u1")] });
    const style = (list.props.contentContainerStyle ?? {}) as Record<string, number>;
    expect(style.paddingTop).toBe(spacing.xl);
    expect(style.paddingBottom).toBe(spacing.sm);
    // Horizontal padding is transform-invariant and must be left alone.
    expect(style.paddingHorizontal).toBe(spacing.md);
  });
});

// ═════════════════ tester-owned extras beyond the SPEC table ════════════════
describe("#2649 adversarial — the reversal must not corrupt its own input", () => {
  it("leaves the caller's messages array in its original order after render", () => {
    // `invertedItems` is built with a copy before `.reverse()`. Dropping that
    // copy would reverse the source in place — and because the list rebuilds on
    // every render, the thread would flip order on each pass. Silent, and
    // invisible to any assertion that only reads the rendered output once.
    const messages = [msg("user", "first"), msg("assistant", "second"), msg("user", "third")];
    const before = messages.map((m) => m.id);
    renderThread({ ...baseProps, messages });
    expect(messages.map((m) => m.id)).toEqual(before);
  });

  it("paints the same visual order on a re-render, not an oscillating one", () => {
    const messages = [msg("user", "first"), msg("assistant", "second"), msg("user", "third")];
    const first = visualRows(renderThread({ ...baseProps, messages }));
    const second = visualRows(renderThread({ ...baseProps, messages }));
    expect(first).toEqual(["msg:first", "msg:second", "msg:third"]);
    expect(second).toEqual(first);
  });

  it("scrolls to the newest row by offset 0 and never by scrollToEnd", () => {
    // In an inverted list scrollToEnd runs to the OLDEST message. Pinned here
    // because the two calls are one token apart and both compile.
    renderThread({ ...baseProps, messages: [msg("user", "u1"), msg("assistant", "a1")] });
    const calls = scrollCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === "scrollToOffset")).toBe(true);
    expect(calls.map((c) => c.arg)).toContainEqual({ offset: 0, animated: true });
    expect(calls.some((c) => c.method === "scrollToEnd")).toBe(false);
  });
});
