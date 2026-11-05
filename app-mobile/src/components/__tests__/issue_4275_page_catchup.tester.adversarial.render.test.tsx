// Issue #4275 tester adversarial — the real ConnectionsPage, driven. The catch-up and
// rebuild closures the page hands to useOpenChatRecovery are the ones that decide
// whether a failed read reaches the recovery controller, so this captures them from
// a mounted page rather than reading the source. Children and data hooks are mocked;
// the page, useChatList, chatListLoad, mergeMessages and withTimeout are real.
//
// FAILS-ON-REVERT, proven at the tester commit recorded on #4275:
//   - put the try/catch back in refreshOpenConversation: "an error result rejects" and
//     "a timeout rejects" fail.
//   - drop `&& user?.id` from channelKey: "signing out" fails.
// Not driven here: the brand channel path (source and hook tests only, see #4275).

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
jest.mock("../connections/PendingCollabChatSheet", () => mockModule());
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
  return new Proxy(actual, { get: (target, key) => (key === "Modal" ? () => null : target[key]) });
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
    getConversations: () => Promise.resolve({ conversations: [], error: null }),
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

describe("#4275 tester: ConnectionsPage hands recovery the truth about a read", () => {
  let renderer: any;
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <ConnectionsPage openDirectMessageWithUserId="friend-1" isTabVisible onOpenDirectMessageHandled={() => {}} />
    </QueryClientProvider>
  );

  beforeAll(async () => {
    mockGetMessages.mockResolvedValue({ messages: [], error: null, hasMore: false });
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(tree());
    });
    for (let i = 0; i < 6 && !mockRecovery.options?.channelKey; i += 1) await flush();
  });
  afterAll(async () => {
    await TestRenderer.act(async () => renderer?.unmount());
    warn.mockRestore();
    log.mockRestore();
  });

  it("an open chat gives the controller its key", () => {
    expect(mockRecovery.options.channelKey).toBe("conv-1");
    expect(mockRecovery.options.conversationId).toBe("conv-1");
  });

  it("a healthy read resolves", async () => {
    mockGetMessages.mockResolvedValueOnce({ messages: [], error: null, hasMore: false });
    await expect(mockRecovery.options.catchUp()).resolves.toBeUndefined();
  });

  it("an error result rejects, so the controller retries", async () => {
    mockGetMessages.mockResolvedValueOnce({ messages: [], error: "statement timeout", hasMore: false });
    await expect(mockRecovery.options.catchUp()).rejects.toThrow("statement timeout");
  });

  it("a thrown read rejects", async () => {
    mockGetMessages.mockRejectedValueOnce(new Error("network"));
    await expect(mockRecovery.options.catchUp()).rejects.toThrow("network");
  });

  it("a read slower than the limit rejects", async () => {
    mockGetMessages.mockImplementationOnce(() => new Promise(() => {}));
    await expect(mockRecovery.options.catchUp()).rejects.toThrow();
  }, 12000);

  it("a rebuild goes through one subscription slot", async () => {
    const before = mockSubscribe.mock.calls.length;
    const releases = mockUnsubscribe.mock.calls.length;
    mockRecovery.options.rebuildChanges();
    expect(mockSubscribe.mock.calls.length).toBe(before + 1);
    expect(mockUnsubscribe.mock.calls.length).toBe(releases + 1);
    expect(mockRecovery.options.getChangesChannelState()).toBe("joined");
  });

  it("signing out gives the controller no key, so retries stop", async () => {
    mockState.user = null;
    await TestRenderer.act(async () => renderer.update(tree()));
    await flush();
    expect(mockRecovery.options.channelKey).toBeNull();
    await expect(mockRecovery.options.catchUp()).resolves.toBeUndefined();
    mockState.user = { id: "me" };
  });
});
