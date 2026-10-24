import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockListMessages = jest.fn();
const mockScrollTo = jest.fn();
const mockRefreshGroups = jest.fn(async () => undefined);
const mockSetMuted = jest.fn(async () => undefined);
let mockFileMeta: Record<string, unknown>[] = [];
const mockGroups = [{ conversation_id: "conversation-a", brand_name: "Launch team", member_count: 3, access_kind: "brand", muted: false }];

jest.mock("react-native", () => jest.requireActual("react-native"));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ conversationId: "conversation-a" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-a" } }) }));
jest.mock("../../../hooks/useBrandGroups", () => ({
  useBrandGroups: () => ({
    groups: mockGroups,
    refresh: mockRefreshGroups,
    setMuted: mockSetMuted,
  }),
}));
jest.mock("../../../hooks/useBrandGroupMedia", () => ({ useBrandGroupFileMeta: () => ({ data: mockFileMeta }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: true }) }));
jest.mock("../../../hooks/useSupportStaff", () => ({ useSupportStaff: () => ({ isStaff: false }) }));
jest.mock("../../../services/brandGroupsService", () => ({
  listBrandGroupMessages: (...args: unknown[]) => mockListMessages(...args),
  markBrandGroupRead: jest.fn(async () => undefined),
  sendBrandGroupMessage: jest.fn(),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: {
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: jest.fn(async () => undefined),
  },
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react");
    return R.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => {
      R.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
      return R.createElement("ScrollViewProbe", props, props.children as React.ReactNode);
    });
  })(),
}));
jest.mock("../BrandGroupSignalModal", () => ({ BrandGroupSignalModal: () => null }));
jest.mock("../BrandGroupFilePreviewModal", () => ({
  BrandGroupFilePreviewModal: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("PreviewProbe", props),
}));
jest.mock("../BrandGroupFileUploadSheet", () => ({ BrandGroupFileUploadSheet: () => null }));
jest.mock("../BrandGroupMediaPanel", () => ({
  BrandGroupMediaPanel: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("PanelProbe", props),
}));
jest.mock("../BrandGroupMediaBubble", () => ({
  BrandGroupMediaBubble: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("BubbleProbe", props),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("Pressable", { onPress: props.onPress }, props.label as string),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("SafeScreenProbe", props, props.children as React.ReactNode),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToastProbe", props),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BrandGroupThreadRoute = require("../../../../app/messages/[conversationId]").default as React.ComponentType;

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const message = (id: string, createdAt: string, overrides: Record<string, unknown> = {}) => ({
  id,
  conversation_id: "conversation-a",
  sender_id: "other-user",
  sender_display_name: "Mingla teammate",
  sender_role: "brand",
  content: id,
  created_at: createdAt,
  reply_content: null,
  reply_sender_display_name: null,
  file_id: null,
  file_name: null,
  file_mime: null,
  file_size: null,
  ...overrides,
});

async function mountAndOpenPanel(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<BrandGroupThreadRoute />);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
  });
  const [mediaButton] = renderer.root.findAll((node) => node.props.accessibilityLabel === "chat.media_a11y");
  await TestRenderer.act(async () => (mediaButton.props.onPress as () => void)());
  return renderer;
}

describe("#3988 rendered Show in chat page search", () => {
  beforeEach(() => {
    mockListMessages.mockReset();
    mockScrollTo.mockReset();
    mockFileMeta = [];
  });

  it("highlights an already-loaded message without loading another page", async () => {
    mockListMessages.mockResolvedValue({ messages: [message("target", "2026-10-24T12:00:00.000Z")], error: null });
    const renderer = await mountAndOpenPanel();
    const [panel] = renderer.root.findAll((node) => node.type === "PanelProbe");
    await TestRenderer.act(async () => (panel.props.onShowInChat as (id: string) => Promise<void>)("target"));
    expect(mockListMessages).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll((node) => node.type === "PanelProbe")).toHaveLength(0);
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("loads two older keyset pages and then reveals the target", async () => {
    mockListMessages
      .mockResolvedValueOnce({ messages: [message("newest", "2026-10-24T12:00:00.000Z")], error: null })
      .mockResolvedValueOnce({ messages: [message("middle", "2026-10-23T12:00:00.000Z")], error: null })
      .mockResolvedValueOnce({ messages: [message("target", "2026-10-22T12:00:00.000Z")], error: null });
    const renderer = await mountAndOpenPanel();
    const [panel] = renderer.root.findAll((node) => node.type === "PanelProbe");
    await TestRenderer.act(async () => (panel.props.onShowInChat as (id: string) => Promise<void>)("target"));
    expect(mockListMessages).toHaveBeenCalledTimes(3);
    expect(renderer.root.findAll((node) => node.type === "Text" && node.props.children === "target").length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAll((node) => node.type === "PanelProbe")).toHaveLength(0);
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("stops after ten older pages and surfaces the missing-message notice", async () => {
    mockListMessages.mockImplementation(async (_conversationId: string, before?: string | null) => {
      if (!before) return { messages: [message("newest", "2026-10-24T12:00:00.000Z")], error: null };
      const page = mockListMessages.mock.calls.length - 1;
      return { messages: [message(`older-${page}`, `2026-10-${String(24 - page).padStart(2, "0")}T12:00:00.000Z`)], error: null };
    });
    const renderer = await mountAndOpenPanel();
    const [panel] = renderer.root.findAll((node) => node.type === "PanelProbe");
    await TestRenderer.act(async () => (panel.props.onShowInChat as (id: string) => Promise<void>)("missing"));
    expect(mockListMessages).toHaveBeenCalledTimes(11);
    const [toast] = renderer.root.findAll((node) => node.type === "ToastProbe");
    expect(toast.props).toMatchObject({ visible: true, message: "viewer.show_in_chat_missing" });
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("renders a pending 65-second video bubble and a PDF file card", async () => {
    mockFileMeta = [{ fileId: "video-file", durationMs: 65_000, width: 1920, height: 1080, thumbState: "pending" }];
    mockListMessages.mockResolvedValue({
      messages: [
        message("video-message", "2026-10-24T12:00:00.000Z", {
          file_id: "video-file",
          file_name: "recap.mp4",
          file_mime: "video/mp4",
          file_size: 12_000,
        }),
        message("pdf-message", "2026-10-24T11:00:00.000Z", {
          file_id: "pdf-file",
          file_name: "launch-brief-with-a-very-long-name.pdf",
          file_mime: "application/pdf",
          file_size: 4_000,
        }),
      ],
      error: null,
    });
    const renderer = await mountAndOpenPanel();
    const [bubble] = renderer.root.findAll((node) => node.type === "BubbleProbe");
    expect(bubble.props.item).toMatchObject({ fileId: "video-file", kind: "video", durationMs: 65_000, thumbState: "pending" });
    expect(renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === "Open launch-brief-with-a-very-long-name.pdf")).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.type === "Text" && node.props.children === "launch-brief-with-a-very-long-name.pdf")).toHaveLength(1);
    await TestRenderer.act(async () => renderer.unmount());
  });
});
