// #4459 QA retest 2 (P2) — the real ConnectionsPage, driven. "Open guest chat" /
// "Rejoin guest chat" hand the open home screen a conversation deep link for a
// chat the loaded list does not have yet (just rejoined, or never loaded). The
// page must keep it as the target, refresh the list and open the thread once it
// arrives; if the refresh ends without it, read it by id once. No loop.
// Harness copied from the #4275 tester's page test (children and data hooks
// mocked; the page, useChatList and chatListLoad are real).
//
// FAILS-ON-REVERT: remove the pending-target branch or its resolver from
// ConnectionsPage and both cases land on the Chats list (no thread opens).
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

// react-native-web's Keyboard and AppState touch document in effects; the lane is node.
const mockDomNoop = () => {};
Object.assign(globalThis, {
  document: { addEventListener: mockDomNoop, removeEventListener: mockDomNoop, visibilityState: "visible", hidden: false, activeElement: null },
});

function mockModule(overrides: Record<string, unknown> = {}) {
  const mockHookResult: unknown = new Proxy({}, {
    get: (_t, key) => {
      if (typeof key !== "string" || key === "then" || key === "data" || key === "error") return undefined;
      if (/^is[A-Z]|^has[A-Z]|^can[A-Z]|[lL]oading$/.test(key)) return false;
      return jest.fn(() => Promise.resolve([]));
    },
  });
  return new Proxy({ __esModule: true, ...overrides } as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (typeof key !== "string") return undefined;
      if (key === "default") return () => null;
      if (/^use[A-Z]/.test(key)) return () => mockHookResult;
      if (/^[A-Z][a-z]/.test(key)) return () => null;
      return new Proxy(jest.fn(() => undefined), {
        get(fn: any, method) {
          if (method in fn || typeof method !== "string" || method === "then") return fn[method];
          return jest.fn(() => Promise.resolve({ data: [], error: null }));
        },
      });
    },
  });
}

const mockRecovery: { options: any } = { options: null };
const mockState: { user: { id: string } | null } = { user: { id: "me" } };
const mockGetMessages = jest.fn();
const mockGetConversations = jest.fn();
const mockGetConversation = jest.fn();
const mockSubscribe = jest.fn(() => ({ state: "joined" }));
const mockUnsubscribe = jest.fn();

jest.mock("../../hooks/useCoachMark", () => mockModule());
jest.mock("expo-blur", () => mockModule());
jest.mock("react-native-safe-area-context", () => mockModule());
jest.mock("@react-native-async-storage/async-storage", () => mockModule({
  default: {
    getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve(),
    multiGet: () => Promise.resolve([]), multiSet: () => Promise.resolve(), multiRemove: () => Promise.resolve(),
  },
}));
jest.mock("../ui/Icon", () => mockModule());
jest.mock("../../hooks/useFriends", () => mockModule());
jest.mock("../../utils/openAfterKeyboard", () => mockModule());
jest.mock("../../services/chatMediaUploadService", () => mockModule());
jest.mock("../../services/chatPickerTempFiles", () => mockModule());
jest.mock("../../services/contentShareDeliveryService", () => mockModule());
jest.mock("../../services/collabDeadEndBannerService", () => mockModule());
jest.mock("../../services/blockService", () => mockModule());
jest.mock("../../services/muteService", () => mockModule());
jest.mock("../../services/reportService", () => mockModule());
jest.mock("../../services/mixpanelService", () => mockModule());
jest.mock("../../utils/hapticFeedback", () => mockModule());
jest.mock("@mingla/offering-rendering", () => mockModule());
jest.mock("../../services/connectionsService", () => mockModule());
jest.mock("../../hooks/useScreenLogger", () => mockModule());
jest.mock("../../hooks/useKeyboard", () => mockModule());
jest.mock("../../hooks/useAppLayout", () => mockModule());
jest.mock("../../hooks/useA11yPreferences", () => mockModule());
jest.mock("../../services/networkMonitor", () => mockModule());
jest.mock("../ToastManager", () => mockModule());
jest.mock("../../utils/showMutationError", () => mockModule());
jest.mock("../ui/BaseBottomSheet", () => mockModule());
jest.mock("../connections/ChatListItem", () => mockModule());
jest.mock("../connections/NewMessageSheet", () => mockModule());
jest.mock("../connections/ChatRowActionsSheet", () => mockModule());
jest.mock("../connections/ChatListSkeleton", () => mockModule());
jest.mock("../connections/ChatAvatar", () => mockModule());
jest.mock("../connections/AddFriendSheet", () => mockModule());
jest.mock("../brandEnquiry/EnquiryChatListRow", () => mockModule());
jest.mock("../brandEnquiry/useEnquiryChatRows", () => mockModule());
jest.mock("../onboarding/CountryPickerModal", () => mockModule());
jest.mock("../connections/RequestsView", () => mockModule());
jest.mock("../connections/FriendsManagementList", () => mockModule());
jest.mock("../connections/BlockedUsersView", () => mockModule());
jest.mock("../connections/CreateGroupChatSheet", () => mockModule());
jest.mock("../connections/PendingSessionInviteRow", () => mockModule());
// #4435: the pending collab sheet is gone; a new group opens live with the link sheet.
jest.mock("../chat/GroupLiveSheet", () => mockModule());
jest.mock("../MessageInterface", () => mockModule());
jest.mock("../CustomPaywallScreen", () => mockModule());
jest.mock("../../hooks/useSessionCreationGate", () => mockModule());
jest.mock("../../hooks/useFeatureGate", () => mockModule());
jest.mock("../AddToBoardModal", () => mockModule());
jest.mock("../friends/FriendActionsSheet", () => mockModule());
jest.mock("../ReportUserModal", () => mockModule());
jest.mock("../BlockUserModal", () => mockModule());
jest.mock("../../utils/addToBoardToasts", () => mockModule());
jest.mock("../PairRequestModal", () => mockModule());
jest.mock("../IncomingPairRequestCard", () => mockModule());
jest.mock("../../hooks/usePairings", () => mockModule());
jest.mock("../../hooks/usePhoneInvite", () => mockModule());
jest.mock("../../services/phoneLookupService", () => mockModule());
jest.mock("../../services/dmCollabService", () => mockModule());
jest.mock("../../hooks/useSubscription", () => mockModule());
jest.mock("../../services/appsFlyerService", () => mockModule());
jest.mock("../../services/pairingService", () => mockModule());
jest.mock("../../hooks/useMessages", () => mockModule());
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  // react-native-web's VirtualizedList re-arms a wheel-handler timer until it finds a
  // DOM node, which never comes under the test renderer, so Jest would never exit.
  const mockStub = new Set(["Modal", "FlatList", "SectionList", "VirtualizedList"]);
  return new Proxy(actual, { get: (target, key) => (mockStub.has(key as string) ? () => null : target[key]) });
});
jest.mock("../../constants/countries", () => mockModule({ countryByCode: () => null, COUNTRIES: [], DEFAULT_COUNTRY: { code: "US" }, getCountryByCode: () => ({ code: "US", dialCode: "+1", flag: "" }) }));
jest.mock("../../hooks/useOpenChatRecovery", () => ({
  __esModule: true,
  useOpenChatRecovery: (options: unknown) => {
    mockRecovery.options = options;
  },
}));
jest.mock("../../hooks/useFriends", () => mockModule({
  useFriends: () => ({
    friends: [], friendRequests: [], loading: false, fetchFriends: jest.fn(() => Promise.resolve()),
    loadFriendRequests: jest.fn(() => Promise.resolve()), blockedUsers: [],
  }),
}));
jest.mock("../../hooks/useAppLayout", () => mockModule({ useAppLayout: () => ({ bottomNavTotalHeight: 0 }) }));
jest.mock("../../services/networkMonitor", () => mockModule({ useNetworkMonitor: () => ({ isOffline: false, isConnected: true }) }));
jest.mock("react-native-safe-area-context", () => mockModule({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../store/appStore", () => ({
  __esModule: true,
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockState), { getState: () => mockState }),
}));
jest.mock("../../services/supabase", () => ({
  __esModule: true,
  supabase: {
    from: () => {
      const answer = Promise.resolve({ data: [], error: null });
      const query: any = new Proxy({}, {
        get: (_t, key) => {
          if (key === "then") return answer.then.bind(answer);
          if (key === "single" || key === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
          return () => query;
        },
      });
      return query;
    },
    // The Chats list reads (access, removed Guest chats, team brands) answer empty.
    rpc: () => Promise.resolve({ data: [], error: null }),
    channel: () => ({ send: jest.fn() }),
    removeChannel: jest.fn(),
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
  },
  trackedInvoke: jest.fn(),
}));
jest.mock("../../services/messagingService", () => mockModule({
  messagingService: new Proxy({
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
    subscribeToConversation: (...args: unknown[]) => (mockSubscribe as any)(...args),
    unsubscribeFromConversation: (...args: unknown[]) => (mockUnsubscribe as any)(...args),
    getConversations: (...args: unknown[]) => mockGetConversations(...args),
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    fetchBrandMeta: () => Promise.resolve(new Map()),
    listRemovedBrandGuestChats: () => Promise.resolve([]),
    findExistingDirectConversation: () => Promise.resolve({
      conversation: { id: "conv-1", created_by: "me", created_at: "2026-01-01T00:00:00Z", participants: [{ user_id: "friend-1", username: "f", display_name: "F" }], unread_count: 0 },
    }),
    markConversationRead: jest.fn(() => Promise.resolve({ error: null })),
    getLastMessageReadBy: jest.fn(() => Promise.resolve(null)),
  } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : jest.fn(() => Promise.resolve({ data: [], error: null }))),
  }),
}));

async function flush(): Promise<void> {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConnectionsPage = (require("../ConnectionsPage") as { default: React.ComponentType<any> }).default;

const GUEST_CHAT = {
  id: "bg-1",
  created_by: "brand-owner",
  created_at: "2026-11-16T10:00:00Z",
  updated_at: "2026-11-16T10:00:00Z",
  type: "group",
  name: "Lagos Vibes",
  linked_entity_type: "brand_guests",
  brand_id: "brand-1",
  participants: [{ id: "p1", conversation_id: "bg-1", user_id: "me", joined_at: "2026-11-16T10:00:00Z", last_read_at: null }],
  unread_count: 0,
};

const openedIds = (): string[] => mockGetMessages.mock.calls.map(([id]) => id as string);

describe("#4459: a deep link to a chat the list has not loaded yet opens the thread", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  let renderer: any;
  let client: QueryClient;
  const handled = jest.fn();

  const page = (deepLinkParams: Record<string, string> | null) => (
    <QueryClientProvider client={client}>
      <ConnectionsPage isTabVisible deepLinkParams={deepLinkParams} onDeepLinkHandled={handled} />
    </QueryClientProvider>
  );
  const LINK = { tab: "messages", conversationId: "bg-1" };
  // The home screen is already open with its Chats list loaded (as when the
  // booking card is reached from it); then the shell hands it the link.
  const mount = async (): Promise<void> => {
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(page(null));
    });
    for (let i = 0; i < 8; i += 1) await flush();
    await TestRenderer.act(async () => {
      renderer.update(page(LINK));
    });
    for (let i = 0; i < 12; i += 1) await flush();
  };

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    handled.mockReset();
    mockGetMessages.mockReset().mockResolvedValue({ messages: [], error: null, hasMore: false });
    mockGetConversations.mockReset();
    mockGetConversation.mockReset();
  });
  afterEach(async () => {
    await TestRenderer.act(async () => renderer?.unmount());
    client.clear();
  });
  afterAll(() => {
    warn.mockRestore();
    log.mockRestore();
  });

  it("Rejoin: the chat arrives with the list refresh and opens once", async () => {
    // The first list read predates the rejoin; the refresh has the chat.
    mockGetConversations
      .mockResolvedValueOnce({ conversations: [], error: null })
      .mockResolvedValue({ conversations: [GUEST_CHAT], error: null });
    await mount();
    expect(openedIds()).toContain("bg-1");
    expect(handled).toHaveBeenCalled();
    expect(mockGetConversations.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockGetConversation).not.toHaveBeenCalled();
    const opens = openedIds().filter((id) => id === "bg-1").length;
    for (let i = 0; i < 4; i += 1) await flush();
    expect(openedIds().filter((id) => id === "bg-1").length).toBe(opens);
  });

  it("Open: a chat the refreshed list still lacks is read by id once and opens", async () => {
    mockGetConversations.mockResolvedValue({ conversations: [], error: null });
    mockGetConversation.mockResolvedValue({ conversation: GUEST_CHAT, error: null });
    await mount();
    expect(mockGetConversation).toHaveBeenCalledTimes(1);
    expect(mockGetConversation).toHaveBeenCalledWith("bg-1", "me");
    expect(openedIds()).toContain("bg-1");
    for (let i = 0; i < 4; i += 1) await flush();
    expect(mockGetConversation).toHaveBeenCalledTimes(1);
  });
});
