/**
 * #2649 [ari-keyboard-hides-newest-message] — implementor happy-path suite,
 * event group-chat leg (SPEC §7 T-6).
 *
 * THE DEFECT, AND WHY IT IS THE WORSE OF THE TWO. `GroupChatPanel` had no
 * `scrollToEnd`, no `onContentSizeChange` and no initial scroll of any kind, so
 * the thread opened on the OLDEST message and stayed there — measured 692.00pt
 * from the newest on iPhone 16, 658.55dp on Pixel 5, with the keyboard shut.
 * The keyboard then made it worse: the container was not a plain `ScrollView`
 * but `KeyboardAwareScrollView` (the `SmartScrollView` wrapper re-exports it
 * under that name), which appends a `keyboardHeight + 1` spacer to its own
 * content whenever the keyboard is open. That spacer bought this screen nothing
 * — its composer is a SIBLING of the thread, not a child, so there is no
 * focused input inside for the library to keep clear — and it set a trap:
 * `scrollToEnd` on that container would land ~351pt past the last message, in
 * blank space.
 *
 * THE FIX, AND WHAT THIS SUITE PROVES. The thread is now an `inverted`
 * `FlatList` fed newest-first. Bottom-anchoring is structural: no scroll call,
 * no keyboard height, no listener. The assertions below read the RENDERED tree
 * — the container's type and props, and the visual paint order of the message
 * rows — rather than the source text, because "the source says FlatList" and
 * "the newest message is at the bottom" are different claims and #2649 F-8 is
 * the standing proof that only the second one matters.
 *
 * fails-on-revert (proven by true line deletion, not comment-out): removing
 * `inverted` flips the painted order to newest-at-top and reds the visual-order
 * assertion; restoring the `ScrollView` container reds the container-type
 * assertion and the paint-order assertion together.
 *
 * Adversarial coverage — image-attachment rows under virtualisation, row
 * recycling on a long thread, the moderation path, and the short-content
 * bottom-pinning case (T-8) — is tester-owned per SPEC §9 and the orchestrator's
 * binding addition to TEST scope. Deliberately not pre-empted here.
 */

import React from "react";

// React 19 gates its act() support on this flag; without it every mount logs a
// "testing environment is not configured to support act(...)" error that buries
// real output. (The react-test-renderer deprecation notice is expected noise.)
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ─────────────────────────── the FlatList emulator ──────────────────────────
/**
 * Same instrument as the Ari leg. It implements the container's DOCUMENTED
 * contract and nothing else: cells in DATA order, and `inverted` painting that
 * sequence bottom-to-top so data[0] lands at the visual BOTTOM. It knows
 * nothing about messages, ordering or this fix. Fidelity is asserted in the
 * first block below.
 */
jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  // `requireActual` goes through the same moduleNameMapper (which points
  // `react-native` at `__manual_mocks__/react-native.js`) but bypasses THIS
  // factory; requiring the mapped file by relative path re-enters it.
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
      __issue2649GroupScrollCalls?: { method: string; arg: unknown }[];
    };
    if (!g.__issue2649GroupScrollCalls) g.__issue2649GroupScrollCalls = [];
    const calls = g.__issue2649GroupScrollCalls;
    const listRef = props.ref as { current: unknown } | undefined;
    if (listRef && typeof listRef === "object" && "current" in listRef) {
      listRef.current = {
        scrollToOffset: (arg: unknown) => calls.push({ method: "scrollToOffset", arg }),
        scrollToEnd: (arg: unknown) => calls.push({ method: "scrollToEnd", arg }),
      };
    }

    const cells = data.map((item, index) =>
      ReactModule.createElement(
        "MockCell",
        { key: keyExtractor ? keyExtractor(item, index) : String(index), dataIndex: index },
        renderItem ? renderItem({ item, index }) : null,
      ),
    );
    const visualOrder = props.inverted ? cells.slice().reverse() : cells;
    const { ref: _ref, ...hostProps } = props;
    return ReactModule.createElement("FlatList", hostProps, visualOrder);
  };

  return { ...base, FlatList };
});

// ───────────────────────────── boundary stubs ───────────────────────────────
// Data hooks, navigation, Supabase and the leaf UI kit are boundaries: what is
// under test is which container the panel renders its thread into and in what
// order it paints the rows.
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
(globalThis as unknown as { __issue2649ChatState: typeof chatState }).__issue2649ChatState =
  chatState;

jest.mock("../../../hooks/useEventGroupChat", () => ({
  useEventGroupChat: () => {
    const s = (globalThis as unknown as { __issue2649ChatState: typeof chatState })
      .__issue2649ChatState;
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
  GroupChatModerationSheet: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ModerationSheetStub", null),
}));
jest.mock("../../../utils/platformImagePicker", () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  requestMediaLibraryPermissionsAsync: async () => ({ status: "granted", granted: true }),
}));
// The composer's keyboard surface is #1890's measured territory and is NOT
// touched by #2649 (SPEC §4.2(e), §10). Stub it at the boundary so this suite
// can neither depend on it nor disturb it.
jest.mock("../../../wrappers/SmartKeyboardAvoidingView", () => ({
  KeyboardAvoidingView: (props: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("KeyboardAvoidingViewStub", null, props.children),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  DONE_BAR_OCCUPIED: 53,
  // Deliberately NOT exporting `ScrollView`. If GroupChatPanel ever imports it
  // from this wrapper again, the thread silently becomes a
  // KeyboardAwareScrollView and this suite fails at module load — which is the
  // regression #2649 F-4 measured, caught at the import boundary.
}));
jest.mock("../../../wrappers/keyboardClearance", () => ({
  liftedBottomSpacer: (lifted: boolean, resting: number) => (lifted ? 12 : resting),
}));
jest.mock("../../../wrappers/useKeyboardHeight", () => ({ useKeyboardHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The repository intentionally omits @types/react-test-renderer.
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

function collectText(node: JsonNode, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (!isElement(node)) return out;
  for (const child of node.children ?? []) collectText(child, out);
  return out;
}

const message = (id: string, content: string, atSeconds: number): Record<string, unknown> => ({
  id,
  sender_id: "someone-else",
  content,
  created_at: new Date(1_700_000_000_000 + atSeconds * 1000).toISOString(),
  marketing_campaign_id: null,
  message_type: "text",
  file_url: null,
  file_name: null,
});

/**
 * Mounts the REAL panel. Async because the panel resolves the signed-in user id
 * through `supabase.auth.getUser()` on mount; draining that promise INSIDE act
 * is what makes the "mine vs theirs" row styling real rather than a state the
 * assertions never reach — and it keeps the resulting setState from landing
 * after the test has finished.
 */
async function renderPanel(): Promise<JsonNode> {
  let tree: { toJSON: () => JsonNode } | null = null;
  await act(async () => {
    tree = create(React.createElement(GroupChatPanel, { eventId: "evt-1" }));
  });
  return (tree as unknown as { toJSON: () => JsonNode }).toJSON();
}

const groupScrollCalls = (): { method: string; arg: unknown }[] =>
  (globalThis as unknown as { __issue2649GroupScrollCalls?: { method: string; arg: unknown }[] })
    .__issue2649GroupScrollCalls ?? [];

beforeEach(() => {
  groupScrollCalls().length = 0;
  chatState.messages = [];
  chatState.loading = false;
  chatState.error = null;
  chatState.conversation = { id: "conv-1", event_name: "Rooftop set", is_broadcast_only: false };
});

// ═════════════════════ harness fidelity (test the instrument) ═══════════════
describe("#2649 harness — the FlatList emulator models inversion the same way", () => {
  it("paints data[0] at the visual BOTTOM when inverted, and at the top otherwise", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FlatList } = require("react-native") as {
      FlatList: React.ComponentType<Record<string, unknown>>;
    };
    const probe = (inverted: boolean): string[] => {
      let tree: { toJSON: () => JsonNode } | null = null;
      act(() => {
        tree = create(
          React.createElement(FlatList, {
            data: ["A", "B", "C"],
            inverted,
            keyExtractor: (item: unknown) => String(item),
            renderItem: ({ item }: { item: unknown }) =>
              React.createElement("Row", { label: String(item) }),
          }),
        );
      });
      const list = findFirst((tree as unknown as { toJSON: () => JsonNode }).toJSON(), "FlatList");
      if (!list) throw new Error("no list");
      return (list.children ?? [])
        .filter(isElement)
        .map((cell) => String((cell.children ?? []).filter(isElement)[0]?.props.label));
    };
    expect(probe(false)).toEqual(["A", "B", "C"]);
    expect(probe(true)).toEqual(["C", "B", "A"]);
  });
});

// ═══════════════════════════════════ T-6 ════════════════════════════════════
describe("#2649 T-6 — the event group chat is a bottom-anchored virtualised list", () => {
  const three = [
    message("m1", "oldest message", 1),
    message("m2", "middle message", 2),
    message("m3", "newest message", 3),
  ];

  it("renders the thread as an inverted FlatList, not a ScrollView", async () => {
    chatState.messages = three;
    const json = await renderPanel();

    const list = findFirst(json, "FlatList");
    expect(list).not.toBeNull();
    expect(list?.props.inverted).toBe(true);

    // The KeyboardAwareScrollView that used to host this thread — and its
    // keyboardHeight+1 phantom spacer — is gone from the rendered tree.
    expect(findFirst(json, "ScrollView")).toBeNull();
  });

  it("feeds the list newest-first so the newest message paints at the bottom", async () => {
    chatState.messages = three;
    const json = await renderPanel();
    const list = findFirst(json, "FlatList");
    if (!list) throw new Error("no list");

    const data = list.props.data as { id: string; content: string }[];
    expect(data.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);

    // And the paint order that data actually produces, read top-to-bottom off
    // the rendered cells. This is the assertion `inverted` is load-bearing for.
    const painted = (list.children ?? [])
      .filter(isElement)
      .map((cell) => collectText(cell).find((t) => t.endsWith("message")));
    expect(painted).toEqual(["oldest message", "middle message", "newest message"]);
  });

  it("sorts by created_at rather than trusting the hook's arrival order", async () => {
    // Realtime delivers out of order; the panel's own sort must still put the
    // newest message at data[0].
    chatState.messages = [
      message("late", "newest message", 9),
      message("early", "oldest message", 1),
      message("mid", "middle message", 5),
    ];
    const list = findFirst(await renderPanel(), "FlatList");
    expect((list?.props.data as { id: string }[]).map((m) => m.id)).toEqual([
      "late",
      "mid",
      "early",
    ]);
  });

  it("adds no scroll call of any kind — bottom-anchoring is structural", async () => {
    // SPEC §4.2(d): with the keyboard open on the OLD container, scrollToEnd
    // landed ~351pt past the last message. Deleting the container deleted the
    // trap; adding a scroll call would import a new one.
    chatState.messages = three;
    await renderPanel();
    expect(groupScrollCalls()).toEqual([]);
  });

  it("still renders the empty, loading and no-conversation states", async () => {
    chatState.messages = [];
    expect(findFirst(await renderPanel(), "FlatList")).not.toBeNull();

    chatState.loading = true;
    expect(findFirst(await renderPanel(), "ActivityIndicator")).not.toBeNull();

    chatState.loading = false;
    chatState.conversation = null;
    const json = await renderPanel();
    expect(findFirst(json, "FlatList")).toBeNull();
    expect(collectText(json).join(" ")).toContain("No group chat exists for this event yet.");
  });
});
