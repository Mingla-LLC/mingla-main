/**
 * #4114 Wave 6 — the host's event chat panel resolves Explorer media.
 *
 * Mounts the REAL GroupChatPanel with three messages: an Explorer photo stored
 * as a private-bucket path, an old public-URL photo, and a view-once photo.
 *
 * fails-on-revert (true line deletion): put back
 * `<Image source={{ uri: message.file_url ?? undefined }} />` in the panel
 * (delete the GroupChatMessageMedia line) → the path photo renders the raw
 * path and the view-once photo renders an image, and both assertions fail.
 */
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/7d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.jpg";
const ONCE = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/once/1d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.jpg";
const PUBLIC = "https://example.supabase.co/storage/v1/object/public/messages/conv/u_1.jpg";

// A FlatList that renders its rows (the default react-native mock renders none).
jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const base = jest.requireActual("react-native");
  const FlatList = (props: Record<string, unknown>): React.ReactElement => {
    const data = (props.data as unknown[]) ?? [];
    const renderItem = props.renderItem as ((info: { item: unknown; index: number }) => React.ReactNode) | undefined;
    const keyExtractor = props.keyExtractor as ((item: unknown, index: number) => string) | undefined;
    const cells = data.map((item, index) =>
      ReactModule.createElement(
        "MockCell",
        { key: keyExtractor ? keyExtractor(item, index) : String(index) },
        renderItem ? renderItem({ item, index }) : null,
      ),
    );
    return ReactModule.createElement("FlatList", null, cells);
  };
  return { ...base, FlatList };
});

const mockSign = jest.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }));

const chatState: { messages: Record<string, unknown>[] } = { messages: [] };
jest.mock("../../../hooks/useEventGroupChat", () => ({
  useEventGroupChat: () => ({
    conversation: { id: "conv-1", event_name: "Rooftop set", is_broadcast_only: false },
    messages: chatState.messages,
    loading: false,
    error: null,
    refresh: async () => {},
    postMessage: async () => ({ error: null }),
  }),
}));
jest.mock("../../../hooks/useEventGroupChatModeration", () => ({
  useEventGroupChatModeration: () => ({
    setBroadcastOnly: async () => ({ error: null }),
    removeParticipant: async () => ({ error: null }),
    deleteMessage: async () => ({ error: null }),
  }),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "host" } } }) },
    storage: { from: () => ({ createSignedUrl: (path: string) => mockSign(path) }) },
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: () => {}, push: () => {} }) }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: ({ children }: { children?: React.ReactNode }) => React.createElement("SafeScreen", null, children),
}));
jest.mock("../GroupChatModerationSheet", () => ({ GroupChatModerationSheet: () => null }));
jest.mock("../../../utils/platformImagePicker", () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  requestMediaLibraryPermissionsAsync: async () => ({ status: "granted", granted: true }),
}));
jest.mock("../../../wrappers/SmartKeyboardAvoidingView", () => ({
  KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) => React.createElement("KAV", null, children),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({ DONE_BAR_OCCUPIED: 0 }));
jest.mock("../../../wrappers/keyboardClearance", () => ({ liftedBottomSpacer: () => 0 }));
jest.mock("../../../wrappers/useKeyboardHeight", () => ({ useKeyboardHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => { toJSON: () => JsonNode };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GroupChatPanel } = require("../GroupChatPanel") as { GroupChatPanel: React.ComponentType<{ eventId: string }> };

interface JsonElement {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}
type JsonNode = JsonElement | JsonNode[] | string | null;

function all(node: JsonNode, type: string, out: JsonElement[] = []): JsonElement[] {
  if (Array.isArray(node)) {
    for (const child of node) all(child, type, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (node.type === type) out.push(node);
  for (const child of node.children ?? []) all(child, type, out);
  return out;
}
function text(node: JsonNode, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => text(child, out));
  else if (node && typeof node === "object") (node.children ?? []).forEach((child) => text(child, out));
  return out;
}

const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  sender_id: "guest",
  content: "",
  created_at: new Date(1_700_000_000_000 + Number(id.slice(1)) * 1000).toISOString(),
  marketing_campaign_id: null,
  message_type: "image",
  file_url: null,
  file_name: null,
  ...extra,
});

describe("#4114 W6 GroupChatPanel media", () => {
  it("signs Explorer paths, keeps public URLs, and hides view once", async () => {
    chatState.messages = [
      row("m1", { file_url: PATH, file_name: "path.jpg" }),
      row("m2", { file_url: PUBLIC, file_name: "public.jpg" }),
      row("m3", { file_url: ONCE, view_once: true }),
    ];
    let tree: { toJSON: () => JsonNode } | null = null;
    await act(async () => {
      tree = create(React.createElement(GroupChatPanel, { eventId: "evt-1" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const json = (tree as unknown as { toJSON: () => JsonNode }).toJSON();
    const uris = all(json, "Image").map((image) => (image.props.source as { uri?: string } | undefined)?.uri);
    expect(uris).toContain(`https://signed.test/${PATH}`);
    expect(uris).toContain(PUBLIC);
    expect(uris).not.toContain(PATH);
    expect(uris.some((uri) => typeof uri === "string" && uri.includes("/once/"))).toBe(false);
    expect(mockSign).toHaveBeenCalledWith(PATH);
    expect(mockSign).not.toHaveBeenCalledWith(ONCE);
    expect(text(json)).toContain("View once photo");
  });
});
