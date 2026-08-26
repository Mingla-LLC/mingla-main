/**
 * #2649 [ari-keyboard-hides-newest-message] — TESTER adversarial suite,
 * group-chat half.
 *
 * Carries the group-chat side of SPEC §7 T-3 (empty), T-4 (single) and T-8
 * (short content pins to the bottom), plus the risk the orchestrator's
 * REVIEW made binding TEST scope: this container went from a NON-virtualised
 * `ScrollView` + `.map()` to an inverted `FlatList`, so rows — especially rows
 * carrying images — now mount, measure and recycle through `renderItem`
 * instead of being materialised all at once.
 *
 * WHY THIS IS A DIFFERENT ANGLE, NOT A RENAMED COPY. The implementor's happy
 * suite proves the container is a `FlatList`, that it is `inverted`, that data
 * runs newest-first and that no scroll call was added. This file assumes all of
 * that and attacks what virtualisation changed underneath it:
 *
 *   - a row's rendered CONTENT must survive the move into `renderItem` intact
 *     (image + caption + meta + the delete affordance), because a `.map()` body
 *     and a `renderItem` body are not the same closure;
 *   - `keyExtractor` must produce a stable, collision-free identity, since the
 *     old `.map()` key had no recycling riding on it and this one does;
 *   - the newest-first reversal must not corrupt the hook's own array;
 *   - the empty / loading / error / no-conversation branches must render NO
 *     list container at all, not an empty inverted one.
 *
 * On-glass evidence for the same criteria (SC-4, SC-5, T-8, moderation) is in
 * the TEST REPORT on #2649; this file is the regression net under it.
 */

import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ───────────────── the FlatList emulator (independent derivation) ────────────
/**
 * Built by walking data BACKWARDS for the inverted case rather than by
 * building in data order and reversing — the same independent derivation used
 * by the Ari adversarial suite, so the two harnesses corroborate each other
 * instead of sharing one possible mistake. This container has no separator, so
 * the visual sequence is cells only.
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

    const g = globalThis as unknown as {
      __issue2649GroupAdvKeys?: string[];
      __issue2649GroupAdvScrollCalls?: { method: string; arg: unknown }[];
    };
    g.__issue2649GroupAdvKeys = [];
    if (!g.__issue2649GroupAdvScrollCalls) g.__issue2649GroupAdvScrollCalls = [];
    const calls = g.__issue2649GroupAdvScrollCalls;
    const listRef = props.ref as { current: unknown } | undefined;
    if (listRef && typeof listRef === "object" && "current" in listRef) {
      listRef.current = {
        scrollToOffset: (arg: unknown) => calls.push({ method: "scrollToOffset", arg }),
        scrollToEnd: (arg: unknown) => calls.push({ method: "scrollToEnd", arg }),
      };
    }

    const cellAt = (index: number): React.ReactNode => {
      const key = keyExtractor ? keyExtractor(data[index], index) : String(index);
      g.__issue2649GroupAdvKeys?.push(key);
      return ReactModule.createElement(
        "AdvCell",
        { key: `cell-${index}`, cellKey: key, dataIndex: index },
        renderItem ? renderItem({ item: data[index], index }) : null,
      );
    };

    const visual: React.ReactNode[] = [];
    if (props.inverted) {
      for (let i = data.length - 1; i >= 0; i -= 1) visual.push(cellAt(i));
    } else {
      for (let i = 0; i < data.length; i += 1) visual.push(cellAt(i));
    }

    const { ref: _ref, ...hostProps } = props;
    return ReactModule.createElement("FlatList", hostProps, visual);
  };

  return { ...base, FlatList };
});

// ───────────────────────────── boundary stubs ───────────────────────────────
const chatState: {
  messages: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  conversation: Record<string, unknown> | null;
} = {
  messages: [],
  loading: false,
  error: null,
  conversation: { id: "conv-1", event_name: "Rooftop set", is_broadcast_only: false },
};
(globalThis as unknown as { __issue2649AdvChatState: typeof chatState }).__issue2649AdvChatState =
  chatState;

jest.mock("../../../hooks/useEventGroupChat", () => ({
  useEventGroupChat: () => {
    const s = (globalThis as unknown as { __issue2649AdvChatState: typeof chatState })
      .__issue2649AdvChatState;
    return {
      conversation: s.conversation,
      messages: s.messages,
      loading: s.loading,
      error: s.error,
      refresh: async () => {},
      postMessage: async () => ({ messageId: "x", error: null }),
    };
  },
}));
jest.mock("../../../hooks/useEventGroupChatModeration", () => ({
  useEventGroupChatModeration: () => ({
    participants: [],
    loading: false,
    setBroadcastOnly: async () => ({ error: null }),
    removeParticipant: async () => ({ error: null }),
    deleteMessage: async () => ({ error: null }),
  }),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "me" } } }) } },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: () => {}, push: () => {} }) }));
jest.mock("../../ui/Button", () => ({
  Button: (props: { label?: string }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonStub", { label: props.label }),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: { name?: string }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconStub", { name: props.name }),
}));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: (props: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("SafeScreenStub", null, props.children),
}));
jest.mock("../GroupChatModerationSheet", () => ({
  GroupChatModerationSheet: (props: { visible?: boolean }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ModerationSheetStub", { visible: props.visible }),
}));
jest.mock("../../../utils/platformImagePicker", () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  requestMediaLibraryPermissionsAsync: async () => ({ status: "granted", granted: true }),
}));
// #1890's measured composer surface — a boundary, never a dependency.
jest.mock("../../../wrappers/SmartKeyboardAvoidingView", () => ({
  KeyboardAvoidingView: (props: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("KeyboardAvoidingViewStub", null, props.children),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  DONE_BAR_OCCUPIED: 53,
  // `ScrollView` is deliberately absent. Re-importing it here would resolve to
  // KeyboardAwareScrollView and reintroduce the phantom `keyboardHeight + 1`
  // spacer #2649 F-4 measured; this suite would then fail at module load.
}));
jest.mock("../../../wrappers/keyboardClearance", () => ({
  liftedBottomSpacer: (lifted: boolean, resting: number) => (lifted ? 12 : resting),
}));
jest.mock("../../../wrappers/useKeyboardHeight", () => ({ useKeyboardHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: ((work: () => void) => void) & ((work: () => Promise<void>) => Promise<void>);
  create: (node: React.ReactElement) => { toJSON: () => JsonNode };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GroupChatPanel } = require("../GroupChatPanel") as {
  GroupChatPanel: React.ComponentType<{ eventId: string }>;
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

function collectText(node: JsonNode, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (!isElement(node)) return out;
  for (const child of node.children ?? []) collectText(child, out);
  return out;
}

const message = (
  id: string,
  content: string,
  atSeconds: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  sender_id: "someone-else",
  content,
  created_at: new Date(1_700_000_000_000 + atSeconds * 1000).toISOString(),
  marketing_campaign_id: null,
  message_type: "text",
  file_url: null,
  file_name: null,
  ...extra,
});

const imageMessage = (
  id: string,
  caption: string,
  atSeconds: number,
): Record<string, unknown> =>
  message(id, caption, atSeconds, {
    message_type: "image",
    file_url: `https://cdn.example.test/${id}.jpg`,
    file_name: `${id}.jpg`,
  });

async function renderPanel(): Promise<JsonNode> {
  let tree: { toJSON: () => JsonNode } | null = null;
  await act(async () => {
    tree = create(React.createElement(GroupChatPanel, { eventId: "evt-1" }));
  });
  return (tree as unknown as { toJSON: () => JsonNode }).toJSON();
}

/** Message bodies in VISUAL top-to-bottom order. */
const visualRowText = (tree: JsonNode): string[] =>
  collect(tree, "AdvCell").map((cell) => collectText(cell).join("|"));

const cellKeys = (): string[] =>
  (globalThis as unknown as { __issue2649GroupAdvKeys?: string[] }).__issue2649GroupAdvKeys ?? [];

const groupScrollCalls = (): { method: string; arg: unknown }[] =>
  (globalThis as unknown as { __issue2649GroupAdvScrollCalls?: { method: string; arg: unknown }[] })
    .__issue2649GroupAdvScrollCalls ?? [];

beforeEach(() => {
  groupScrollCalls().length = 0;
  chatState.messages = [];
  chatState.loading = false;
  chatState.error = null;
  chatState.conversation = { id: "conv-1", event_name: "Rooftop set", is_broadcast_only: false };
});

// ═══════════════════════════ T-3 / T-4 — the ends ═══════════════════════════
describe("#2649 group chat T-3 — the empty and non-thread states", () => {
  it("renders an empty inverted list rather than crashing when the conversation has no messages", async () => {
    // Verified on glass: the real "just vibing" chat renders its state with no
    // rows and no mirrored content (TEST REPORT SC-4).
    const tree = await renderPanel();
    const list = findFirst(tree, "FlatList");
    expect(list).not.toBeNull();
    expect(list?.props.data).toEqual([]);
    expect(collect(tree, "AdvCell")).toHaveLength(0);
    expect(groupScrollCalls()).toEqual([]);
  });

  it("renders NO list container at all while loading", async () => {
    chatState.loading = true;
    const tree = await renderPanel();
    // An inverted FlatList mounted behind a spinner would measure an empty
    // container and then re-measure on data arrival. The branch must not render
    // the list at all.
    expect(findFirst(tree, "FlatList")).toBeNull();
  });

  it("renders NO list container when the hook reports an error", async () => {
    chatState.error = "Could not load the chat";
    const tree = await renderPanel();
    expect(findFirst(tree, "FlatList")).toBeNull();
    expect(collectText(tree).join(" ")).toContain("Could not load the chat");
  });

  it("renders NO list container when no conversation exists for the event", async () => {
    chatState.conversation = null;
    const tree = await renderPanel();
    expect(findFirst(tree, "FlatList")).toBeNull();
    expect(collectText(tree).join(" ")).toContain("No group chat exists for this event yet.");
  });
});

describe("#2649 group chat T-4 — a single message", () => {
  it("renders exactly one row and feeds it as data[0]", async () => {
    chatState.messages = [message("m1", "only one", 10)];
    const tree = await renderPanel();
    const list = findFirst(tree, "FlatList");
    expect(collect(tree, "AdvCell")).toHaveLength(1);
    expect((list?.props.data as { id: string }[])[0].id).toBe("m1");
    expect(list?.props.inverted).toBe(true);
  });
});

// ═══════════════════════════════════ T-8 ════════════════════════════════════
describe("#2649 group chat T-8 — short content pins to the bottom", () => {
  it("keeps the content container free of anything that would stretch it", async () => {
    // Measured on glass first: the real FIFA Grill Night chat holds its single
    // message against the composer with the viewport empty above it, where the
    // old ScrollView floated the thread at the top. These are the structural
    // properties that produce that, pinned so a later edit cannot quietly undo
    // it — `flexGrow: 1` / `justifyContent` / `minHeight` each restore the
    // top-floating behaviour on an inverted list.
    chatState.messages = [message("m1", "hello", 10), message("m2", "there", 20)];
    const tree = await renderPanel();
    const list = findFirst(tree, "FlatList");
    expect(list?.props.inverted).toBe(true);

    const contentStyle = (list?.props.contentContainerStyle ?? {}) as Record<string, unknown>;
    expect(contentStyle.flexGrow).toBeUndefined();
    expect(contentStyle.justifyContent).toBeUndefined();
    expect(contentStyle.minHeight).toBeUndefined();
    expect(contentStyle.flex).toBeUndefined();
  });

  it("paints oldest-at-top and newest-against-the-composer for a short thread", async () => {
    chatState.messages = [
      message("m1", "oldest", 10),
      message("m2", "middle", 20),
      message("m3", "newest", 30),
    ];
    const tree = await renderPanel();
    const text = visualRowText(tree);
    expect(text[0]).toContain("oldest");
    expect(text[text.length - 1]).toContain("newest");
  });
});

// ═════════════ virtualisation risk — binding TEST scope per REVIEW ══════════
describe("#2649 group chat — what virtualisation changed underneath the rows", () => {
  it("renders an image row's full content through renderItem: image, caption, meta and delete", async () => {
    // The `.map()` body became a `renderItem` closure. Rows carrying images are
    // the ones the orchestrator flagged, because they now mount and measure
    // lazily. Assert the whole row survived the move, not just that it renders.
    chatState.messages = [imageMessage("img1", "look at this", 10)];
    const tree = await renderPanel();
    const cell = collect(tree, "AdvCell")[0];
    expect(cell).toBeDefined();

    const image = findFirst(cell, "Image");
    expect(image).not.toBeNull();
    expect((image?.props.source as { uri?: string })?.uri).toBe(
      "https://cdn.example.test/img1.jpg",
    );
    expect(image?.props.accessibilityLabel).toBe("img1.jpg");
    // Caption and the per-row delete affordance travel with it.
    expect(collectText(cell).join(" ")).toContain("look at this");
    expect(
      collect(cell, "IconStub").some((i) => i.props.name === "trash"),
    ).toBe(true);
  });

  it("renders an image row that has no caption without emitting an empty text node", async () => {
    chatState.messages = [
      message("img2", "", 10, {
        message_type: "image",
        file_url: "https://cdn.example.test/img2.jpg",
        file_name: null,
      }),
    ];
    const tree = await renderPanel();
    const cell = collect(tree, "AdvCell")[0];
    expect(findFirst(cell, "Image")).not.toBeNull();
    // Falls back to the generic label when the file has no name.
    expect(findFirst(cell, "Image")?.props.accessibilityLabel).toBe("Attached image");
  });

  it("gives every row a distinct recycling key, and derives it from the message id", async () => {
    // Under `.map()` a duplicate key was a console warning. Under
    // virtualisation it decides which mounted cell gets reused, so a collision
    // shows up as a row rendering another row's content after a scroll.
    chatState.messages = [
      message("m1", "one", 10),
      imageMessage("m2", "two", 20),
      message("m3", "three", 30),
    ];
    await renderPanel();
    const keys = cellKeys();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(keys.slice().sort()).toEqual(["m1", "m2", "m3"]);
    // Index-derived keys would renumber every row whenever a message arrives,
    // remounting the whole thread; the id must be doing the work.
    expect(keys.some((k) => k === "0" || k === "1" || k === "2")).toBe(false);
  });

  it("keeps a long thread's rows in order end to end, the shape that forces recycling", async () => {
    // 40 rows with images interleaved — past any realistic windowSize, so the
    // ordering assertion covers the recycled range and not just the first
    // screenful.
    chatState.messages = Array.from({ length: 40 }, (_, i) =>
      i % 4 === 0 ? imageMessage(`g${i}`, `row ${i}`, i) : message(`g${i}`, `row ${i}`, i),
    );
    const tree = await renderPanel();
    const text = visualRowText(tree);
    expect(text).toHaveLength(40);
    expect(text[0]).toContain("row 0");
    expect(text[39]).toContain("row 39");
    // Strictly increasing top-to-bottom: oldest at the top, newest against the
    // composer, with no pair transposed anywhere in the middle.
    const indices = text.map((t) => Number(/row (\d+)/.exec(t)?.[1] ?? -1));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(cellKeys()).size).toBe(40);
  });

  it("adds no scroll call of any kind, however long the thread gets", async () => {
    chatState.messages = Array.from({ length: 40 }, (_, i) => message(`g${i}`, `row ${i}`, i));
    await renderPanel();
    // F-4 measured that with the keyboard open, scrollToEnd on the old
    // container landed ~351pt past the last message in blank space. Bottom
    // anchoring must keep coming from `inverted` alone.
    expect(groupScrollCalls()).toEqual([]);
  });
});

// ═══════════════ tester-owned extras beyond the SPEC table ══════════════════
describe("#2649 group chat — the reversal must not corrupt its own input", () => {
  it("leaves the hook's messages array in its original order after render", async () => {
    // `invertedMessages` is `sortedMessages.slice().reverse()`. Drop the
    // `.slice()` and the reverse lands in place on the memoised array, so the
    // thread flips order on every re-render — silent, and invisible to any
    // assertion that reads the output once.
    chatState.messages = [
      message("m1", "one", 10),
      message("m2", "two", 20),
      message("m3", "three", 30),
    ];
    const before = chatState.messages.map((m) => m.id);
    await renderPanel();
    expect(chatState.messages.map((m) => m.id)).toEqual(before);
  });

  it("sorts by created_at rather than arrival order, then inverts that", async () => {
    // Delivered out of order, as realtime does.
    chatState.messages = [
      message("m3", "newest", 30),
      message("m1", "oldest", 10),
      message("m2", "middle", 20),
    ];
    const tree = await renderPanel();
    const text = visualRowText(tree);
    expect(text[0]).toContain("oldest");
    expect(text[1]).toContain("middle");
    expect(text[2]).toContain("newest");
  });
});
