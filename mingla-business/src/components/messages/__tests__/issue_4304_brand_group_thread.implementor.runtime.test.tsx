/**
 * #4304 part 2 — the REAL /messages/[conversationId] route and inbox list,
 * rendered: clustered bubbles with day separators, the message menu (react,
 * Reply, Copy, Create product signal, Select) and the inbox rows.
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockListMessages = jest.fn();
const mockAddReaction = jest.fn();
const mockRemoveReaction = jest.fn();
const mockListReactions = jest.fn();
const mockListReads = jest.fn();
const mockCopy = jest.fn(async () => true);
let mockIsStaff = false;
const mockRouter = { back: jest.fn(), push: jest.fn(), setParams: jest.fn(), replace: jest.fn() };
const mockGroups = [{ conversation_id: "conversation-a", brand_id: "brand-a", brand_name: "Launch team", brand_photo_url: null, member_count: 3, access_kind: "brand", muted: false }];

jest.mock("react-native", () => jest.requireActual("react-native"));
// #4398: the Team screen now imports the shared Sheet (expo-blur, untransformed ESM here).
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ conversationId: "conversation-a" }),
  useRouter: () => mockRouter,
  Redirect: () => null,
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: (...args: unknown[]) => mockCopy(...(args as [])) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../../i18n", () => ({ useBusinessMediaTranslation: () => ({ t: (key: string) => key, language: "en" }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "me" } }) }));
const mockRefreshGroups = jest.fn(async () => undefined);
const mockSetMuted = jest.fn(async () => undefined);
jest.mock("../../../hooks/useBrandGroups", () => ({
  useBrandGroups: () => ({ groups: mockGroups, refresh: mockRefreshGroups, setMuted: mockSetMuted }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false, width: 390 }) }));
jest.mock("../../../hooks/useSupportStaff", () => ({ useSupportStaff: () => ({ isStaff: mockIsStaff }) }));
jest.mock("../../../services/brandGroupsService", () => ({
  listBrandGroupMessages: (...args: unknown[]) => mockListMessages(...args),
  markBrandGroupRead: jest.fn(async () => undefined),
  sendBrandGroupMessage: jest.fn(),
}));
jest.mock("../../../services/brandGroupLiveService", () => ({
  listBrandGroupReactions: (...args: unknown[]) => mockListReactions(...args),
  listBrandGroupReadState: (...args: unknown[]) => mockListReads(...args),
  addBrandGroupReaction: (...args: unknown[]) => mockAddReaction(...args),
  removeBrandGroupReaction: (...args: unknown[]) => mockRemoveReaction(...args),
}));
jest.mock("../../../services/brandGroupRosterService", () => ({
  listBrandGroupMembers: jest.fn(async () => ({ members: [], error: null })),
  listBrandGroupMentionCandidates: jest.fn(async () => ({ candidates: [], error: null })),
}));
jest.mock("../../../services/brandGroupFileMetaService", () => ({ fileMeta: async () => [] }));
jest.mock("../../../services/supabase", () => ({
  supabase: {
    channel: () => ({ on() { return this; }, subscribe() { return this; }, send: async () => "ok" }),
    removeChannel: jest.fn(async () => undefined),
  },
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  DONE_BAR_OCCUPIED: 0,
  ScrollView: (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react");
    return R.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => {
      R.useImperativeHandle(ref, () => ({ scrollTo: jest.fn(), scrollToEnd: jest.fn() }));
      return R.createElement("ScrollViewProbe", props, props.children as React.ReactNode);
    });
  })(),
}));
jest.mock("../BrandGroupSignalModal", () => ({
  BrandGroupSignalModal: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("SignalProbe", props),
}));
jest.mock("../BrandGroupFilePreviewModal", () => ({ BrandGroupFilePreviewModal: () => null }));
jest.mock("../BrandGroupFileUploadSheet", () => ({ BrandGroupFileUploadSheet: () => null }));
jest.mock("../BrandGroupMediaPanel", () => ({ BrandGroupMediaPanel: () => null }));
jest.mock("../../media/MediaThumb", () => ({ MediaThumb: () => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("Pressable", { onPress: props.onPress }, props.label as string),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
// #4304 — the route module also carries the /messages inbox screen (one web
// chunk for both Messages routes); its TopBar is not under test here.
jest.mock("../../ui/TopBar", () => ({ TopBar: () => null }));
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
const ThreadRoute = require("../../../../app/messages/[conversationId]").default as React.ComponentType;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandGroupInboxList } = require("../BrandGroupInboxList") as typeof import("../BrandGroupInboxList");

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

function textOf(node: Node | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

const today = new Date();
const iso = (minutesAgo: number): string => new Date(today.getTime() - minutesAgo * 60_000).toISOString();
const message = (id: string, sender: string, name: string, minutesAgo: number, content = id) => ({
  id,
  conversation_id: "conversation-a",
  sender_id: sender,
  sender_display_name: name,
  sender_role: null,
  content,
  created_at: iso(minutesAgo),
  reply_to_id: null,
  related_message_ids: [],
  reply_content: null,
  reply_sender_display_name: null,
  message_type: "text",
  file_id: null,
  file_name: null,
  file_mime: null,
  file_size: null,
});

async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<ThreadRoute />);
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
  return renderer;
}

const byTestId = (renderer: Renderer, id: string): Node[] =>
  renderer.root.findAll((node) => node.props.testID === id && typeof node.type !== "string");

async function openMenu(renderer: Renderer, messageId: string): Promise<void> {
  const [bubble] = byTestId(renderer, `brand-group-bubble-${messageId}`);
  await TestRenderer.act(async () => (bubble.props.onLongPress as () => void)());
}

async function press(renderer: Renderer, testID: string): Promise<void> {
  const [node] = byTestId(renderer, testID);
  await TestRenderer.act(async () => {
    (node.props.onPress as () => void)();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
  });
}

describe("#4304 Brand-group thread", () => {
  beforeEach(() => {
    mockIsStaff = false;
    mockListMessages.mockReset();
    mockListReactions.mockReset().mockResolvedValue([]);
    mockListReads.mockReset().mockResolvedValue([]);
    mockAddReaction.mockReset().mockImplementation(async (input: { messageId: string; userId: string; emoji: string }) => ({
      id: "saved-1", message_id: input.messageId, user_id: input.userId, emoji: input.emoji,
    }));
    mockRemoveReaction.mockReset().mockResolvedValue(undefined);
    mockCopy.mockClear();
    mockListMessages.mockResolvedValue({
      messages: [
        message("a1", "ada", "Ada Obi", 10, "Doors at 7?"),
        message("a2", "ada", "Ada Obi", 9.5, "Bring the wristbands"),
        message("m1", "me", "Me", 2, "On it"),
      ],
      error: null,
    });
  });

  it("clusters bubbles under a Today separator, with no per-bubble timestamps", async () => {
    const renderer = await mount();
    const texts = renderer.root.findAll((node) => node.type === "Text").map(textOf);
    expect(texts).toContain("Today");
    // Ada's name once (first of her cluster), not on each bubble.
    expect(texts.filter((text) => text === "Ada Obi").length).toBe(1);
    expect(byTestId(renderer, "brand-group-bubble-a1")).toHaveLength(1);
    // The old always-visible action links are gone.
    expect(texts).not.toContain("Create product signal");
    expect(texts).not.toContain("Reply");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("long-press opens the menu; Reply fills the reply bar", async () => {
    const renderer = await mount();
    await openMenu(renderer, "a1");
    expect(byTestId(renderer, "brand-group-message-menu")).toHaveLength(1);
    // Non-staff: no product signal.
    expect(byTestId(renderer, "brand-group-menu-signal")).toHaveLength(0);
    await press(renderer, "brand-group-menu-reply");
    expect(byTestId(renderer, "brand-group-message-menu")).toHaveLength(0);
    const texts = renderer.root.findAll((node) => node.type === "Text").map(textOf);
    expect(texts).toContain("Replying to Ada Obi");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Copy writes the message text to the clipboard", async () => {
    const renderer = await mount();
    await openMenu(renderer, "a2");
    await press(renderer, "brand-group-menu-copy");
    expect(mockCopy).toHaveBeenCalledWith("Bring the wristbands");
    const [toast] = renderer.root.findAll((node) => node.type === "ToastProbe");
    expect(toast.props).toMatchObject({ visible: true, kind: "success", message: "Message copied" });
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Select marks related context; Support's Create product signal opens the signal form", async () => {
    mockIsStaff = true;
    const renderer = await mount();
    await openMenu(renderer, "a1");
    await press(renderer, "brand-group-menu-select");
    expect(renderer.root.findAll((node) => node.type === "Text").map(textOf)).toContain("1 related message selected");
    await openMenu(renderer, "a2");
    await press(renderer, "brand-group-menu-signal");
    const [signal] = renderer.root.findAll((node) => node.type === "SignalProbe");
    expect(signal.props).toMatchObject({ visible: true, sourceMessageId: "a2", relatedMessageIds: ["a1"] });
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("reacting from the menu saves a reaction and shows the pill; tapping the pill removes it", async () => {
    const renderer = await mount();
    await openMenu(renderer, "a1");
    await press(renderer, "brand-group-react-🔥");
    expect(mockAddReaction).toHaveBeenCalledWith({ messageId: "a1", userId: "me", emoji: "🔥" });
    const pill = renderer.root.findAll((node) => typeof node.type !== "string" && node.props.accessibilityLabel === "🔥 1, you reacted. Tap to remove");
    expect(pill.length).toBeGreaterThanOrEqual(1);
    await TestRenderer.act(async () => {
      (pill[0].props.onPress as () => void)();
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
    });
    expect(mockRemoveReaction).toHaveBeenCalledWith("saved-1");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("shows Seen by under my latest message from the read pointers", async () => {
    mockListReads.mockResolvedValue([{ user_id: "ada", display_name: "Ada Obi", last_read_at: new Date().toISOString() }]);
    const renderer = await mount();
    const texts = renderer.root.findAll((node) => node.type === "Text").map(textOf);
    expect(texts.some((text) => text.endsWith("Seen by Ada"))).toBe(true);
    await TestRenderer.act(async () => renderer.unmount());
  });
});

describe("#4304 inbox rows", () => {
  const groups = [
    { conversation_id: "g1", brand_id: "b1", brand_name: "Lagos Social", brand_slug: "lagos", brand_photo_url: null, last_message_at: new Date().toISOString(), last_message_preview: "Doors at 7?", unread_count: 2, member_count: 4, access_kind: "brand" as const, push_enabled: false, muted: true, last_message_sender_id: "ada", last_message_sender_name: "Ada Obi", last_message_type: "text" },
    { conversation_id: "g2", brand_id: "b2", brand_name: "Abuja Eats", brand_slug: "abuja", brand_photo_url: null, last_message_at: null, last_message_preview: "", unread_count: 0, member_count: 3, access_kind: "brand" as const, push_enabled: false, muted: false },
  ];

  it("renders last speaker, unread badge, mute and filters by search and Unread", async () => {
    const onOpen = jest.fn();
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <BrandGroupInboxList groups={groups} loading={false} error={null} onRetry={jest.fn()} viewerId="me" isStaff={false} onOpen={onOpen} />,
      );
    });
    const texts = (): string[] => renderer.root.findAll((node) => node.type === "Text").map(textOf);
    expect(texts()).toContain("Ada: Doors at 7?");
    expect(texts()).toContain("2");
    expect(texts()).toContain("3 people · Brand group");
    expect(renderer.root.findAll((node) => typeof node.type !== "string" && node.props.accessibilityLabel === "Lagos Social Brand group, 2 unread, muted")).not.toHaveLength(0);
    // Staff-only chips are hidden for a non-staff host.
    expect(byTestId(renderer, "brand-group-filter-supporting")).toHaveLength(0);

    await TestRenderer.act(async () => (byTestId(renderer, "brand-group-filter-unread")[0].props.onPress as () => void)());
    expect(byTestId(renderer, "brand-group-row-g2")).toHaveLength(0);
    expect(byTestId(renderer, "brand-group-row-g1")).toHaveLength(1);

    await TestRenderer.act(async () => (byTestId(renderer, "brand-group-filter-all")[0].props.onPress as () => void)());
    const [search] = renderer.root.findAll((node) => node.props.testID === "brand-group-search" && typeof node.type !== "string");
    await TestRenderer.act(async () => (search.props.onChangeText as (value: string) => void)("abuja"));
    expect(byTestId(renderer, "brand-group-row-g1")).toHaveLength(0);
    await TestRenderer.act(async () => (byTestId(renderer, "brand-group-row-g2")[0].props.onPress as () => void)());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: "g2" }));
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("shows a skeleton while loading", async () => {
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <BrandGroupInboxList groups={[]} loading error={null} onRetry={jest.fn()} viewerId="me" isStaff={false} onOpen={jest.fn()} />,
      );
    });
    expect(renderer.root.findAll((node) => node.props.testID === "brand-group-inbox-skeleton")).not.toHaveLength(0);
    await TestRenderer.act(async () => renderer.unmount());
  });
});
