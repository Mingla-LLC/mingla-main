// MINGLA-INVARIANT: I-4255-TEAM-ICON-STAFF-ONLY | issue #4255 | the Host app top bar shows the Mingla team "M" only when team_badge says staff:true; without a query client, while loading, on an error or for a host who is not staff it renders nothing. Its badge is unread team chats plus unread mentions.
// MINGLA-INVARIANT: I-4255-TEAM-DEEP-LINKS | issue #4255 | mingla-business://team/<thread> opens that chat (/team?thread=) and mingla-business://team/mention/<id> opens Mentions at that row; an odd id still opens Mingla team, never the account tab.
// MINGLA-INVARIANT: I-4255-TEAM-NON-STAFF-GATE | issue #4255 | every Mingla team screen shows "This space is for the Mingla team" to a signed-in host who is not staff, and the staff-only settings group never renders for them.
// MINGLA-INVARIANT: I-4255-TEAM-FILES-PATH | issue #4255 | a team file uploads only to bucket team-files at the path the database issued for that chat and that attachment; over 25 MB is refused before upload.
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestNode | string)[];
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}
interface Renderer { root: TestNode; unmount: () => void; update: (node: React.ReactElement) => void }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();
const mockUpload = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockAuth: { user: { id: string } | null; loading: boolean } = { user: { id: "u-staff" }, loading: false };

jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.test/x" }, error: null }) }) },
  },
}));
jest.mock("../../../services/brandGroupFilesService", () => ({
  uploadStorageObject: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ ...mockAuth, isAuthReady: true }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../store/currentBrandStore", () => {
  const state = { currentBrandId: null, hasHydrated: true };
  const useCurrentBrandStore = (selector: (s: typeof state) => unknown) => selector(state);
  useCurrentBrandStore.getState = () => state;
  return { useCurrentBrandStore };
});
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "b1", displayName: "A brand name that is long", stats: {} }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../hooks/useBusinessNotifications", () => ({
  ...(jest.requireActual("../../../hooks/useBusinessNotifications") as object),
  useBusinessNotificationsInbox: () => ({ unreadCount: 0 }),
}));
jest.mock("../../../hooks/useBrandGroups", () => ({ useBrandGroups: () => ({ unreadCount: 0 }) }));
jest.mock("../../../hooks/useBrandEnquiries", () => ({ useBrandEnquiries: () => ({ data: undefined }) }));
jest.mock("../../ui/GlassChrome", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { GlassChrome: ({ children }: { children?: React.ReactNode }) => R.createElement("GlassChrome", null, children) };
});
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../brand/BrandMark", () => ({ BrandMark: () => null, brandMarkPhotoUrl: () => null }));
jest.mock("../../../services/mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
// The team screens load from the Brand group route's lazy chunk; that route
// module is heavy, so stand in with just what it re-exports.
jest.mock("../../../../app/messages/[conversationId]", () => ({
  TeamNotificationPrefs: (jest.requireActual("../TeamScreens") as typeof import("../TeamScreens")).TeamNotificationPrefs,
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { TopBar } = require("../../ui/TopBar") as typeof import("../../ui/TopBar");
const { teamBadgeCount, fetchTeamBadge } = require("../teamBadge") as typeof import("../teamBadge");
const { teamChatKey } = require("../../../hooks/useBusinessNotifications") as typeof import("../../../hooks/useBusinessNotifications");
const routing = require("../../../services/businessNotificationRouting") as typeof import("../../../services/businessNotificationRouting");
const service = require("../../../services/teamChatService") as typeof import("../../../services/teamChatService");
const { TeamAccessGate } = require("../TeamCommon") as typeof import("../TeamCommon");
const { teamPrefOn } = require("../TeamScreens") as typeof import("../TeamScreens");
const { useTeamAccess, useTeamRealtime } = require("../useTeamChat") as typeof import("../useTeamChat");
const { canMentionEveryone, mentionsInBody } = require("../TeamThreadScreen") as typeof import("../TeamThreadScreen");
const { MinglaTeamPrefsGroup } = require("../../../../app/account/notifications") as typeof import("../../../../app/account/notifications");
/* eslint-enable @typescript-eslint/no-require-imports */

const THREAD = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ATTACHMENT = "1a1b1c1d-1e1f-4a2b-8c3d-4e5f60718293";
const MENTION = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f00112233";
const CARD = "aabbccdd-eeff-4011-8233-445566778899";

const mounted: Renderer[] = [];
function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
async function mount(node: React.ReactElement): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(node); });
  // Queries settle, then lazy chunks (the M button, the settings group) resolve.
  for (let i = 0; i < 3; i += 1) await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  mounted.push(renderer);
  return renderer;
}
const byTestId = (root: TestNode, id: string): TestNode[] => root.findAll((node) => node.props.testID === id && typeof node.type === "string");
const allText = (root: TestNode): string => root.findAll((node) => node.type === "Text").map((node) => node.children.filter((c) => typeof c === "string").join("")).join(" | ");

function badge(value: Record<string, unknown>): void {
  mockRpc.mockImplementation(async (name: string) => (name === "team_badge" ? { data: value, error: null } : { data: null, error: null }));
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  mockUpload.mockReset();
  mockPush.mockReset();
  mockAuth.user = { id: "u-staff" };
  mockAuth.loading = false;
});
afterEach(async () => {
  while (mounted.length) {
    const renderer = mounted.pop();
    await TestRenderer.act(async () => { renderer?.unmount(); });
  }
});

describe("#4255 W5 top bar: the Mingla team M", () => {
  test("hidden, and no crash, when the top bar mounts without a query client", async () => {
    badge({ staff: true, chats: 1, mentions: 0 });
    const bar = await mount(<TopBar leftKind="brand" />);
    expect(byTestId(bar.root, "topbar-mingla-team")).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("hidden for a signed-in host who is not staff", async () => {
    badge({ staff: false, chats: 0, messages: 0, mentions: 0, total: 0 });
    const bar = await mount(<QueryClientProvider client={client()}><TopBar leftKind="brand" /></QueryClientProvider>);
    expect(mockRpc).toHaveBeenCalledWith("team_badge");
    expect(byTestId(bar.root, "topbar-mingla-team")).toHaveLength(0);
  });

  test("hidden when the check fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const bar = await mount(<QueryClientProvider client={client()}><TopBar leftKind="brand" /></QueryClientProvider>);
    expect(byTestId(bar.root, "topbar-mingla-team")).toHaveLength(0);
  });

  test("staff see it between the chat bubble and the bell, with chats plus mentions on the badge", async () => {
    badge({ staff: true, chats: 2, messages: 7, mentions: 3, total: 5 });
    const bar = await mount(<QueryClientProvider client={client()}><TopBar leftKind="brand" /></QueryClientProvider>);
    const button = byTestId(bar.root, "topbar-mingla-team");
    expect(button).toHaveLength(1);
    expect(button[0].props.accessibilityLabel).toBe("Mingla team, 5 unread");
    expect(allText(button[0])).toContain("5");
    await TestRenderer.act(async () => { (button[0].props.onPress as () => void)(); });
    expect(mockPush).toHaveBeenCalledWith("/team");
    const source = fs.readFileSync(path.resolve(__dirname, "../../ui/TopBar.tsx"), "utf8");
    const order = ["<EnquiryAwareMessagesButton", "<LazyMinglaTeamSlot", 'icon="bell"'].map((s) => source.indexOf(s));
    expect(order[0]).toBeGreaterThan(0);
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
  });

  test("the badge caps at 9+", async () => {
    badge({ staff: true, chats: 8, mentions: 4 });
    const bar = await mount(<QueryClientProvider client={client()}><TopBar leftKind="brand" /></QueryClientProvider>);
    expect(allText(byTestId(bar.root, "topbar-mingla-team")[0])).toContain("9+");
  });

  test("on a 320pt phone the brand name truncates instead of pushing the icons off", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../ui/TopBar.tsx"), "utf8");
    expect(source).toMatch(/brandLabel: \{\n\s+flexShrink: 1,/);
    expect(source).toMatch(/brandRow: \{[^}]*minWidth: 0,/);
  });
});

describe("#4255 W5 badge math", () => {
  test("unread chats plus unread mentions; nothing for non-staff or bad values", () => {
    expect(teamBadgeCount({ staff: true, chats: 2, mentions: 3 })).toBe(5);
    expect(teamBadgeCount({ staff: false, chats: 2, mentions: 3 })).toBe(0);
    expect(teamBadgeCount(null)).toBe(0);
    expect(teamBadgeCount({ staff: true, chats: -1, mentions: Number.NaN })).toBe(0);
    expect(teamBadgeCount({ staff: true, chats: 1.7, mentions: 0 })).toBe(1);
  });
  test("the top bar's read cleans the counts and zeroes them for non-staff", async () => {
    badge({ staff: true, chats: "2", mentions: -4, messages: null, total: 9 });
    expect(await fetchTeamBadge()).toEqual({ staff: true, admin: false, chats: 2, messages: 0, mentions: 0, total: 9 });
    badge({ staff: true, admin: true, chats: 0 });
    expect((await fetchTeamBadge()).admin).toBe(true);
    badge({ staff: false, admin: true, chats: 3, mentions: 3 });
    expect(await fetchTeamBadge()).toEqual({ staff: false, admin: false, chats: 0, messages: 0, mentions: 0, total: 0 });
    mockRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(fetchTeamBadge()).rejects.toThrow("nope");
  });
});

describe("#4255 W5 push routing", () => {
  test("a team chat link opens that chat", () => {
    expect(routing.parseBusinessDeepLink(`mingla-business://team/${THREAD}`)).toBe(`/team?thread=${THREAD}`);
    expect(routing.resolveBusinessNavTarget({ type: "business.team_message", deepLink: `mingla-business://team/${THREAD}` })).toBe(`/team?thread=${THREAD}`);
  });
  test("an Admin mention link opens Mentions at that row", () => {
    expect(routing.parseBusinessDeepLink(`mingla-business://team/mention/${MENTION}`)).toBe(`/team?tab=mentions&mention=${MENTION}`);
    expect(routing.resolveBusinessNavTarget({ type: "business.team_mention", deepLink: `mingla-business://team/mention/${MENTION}` })).toBe(`/team?tab=mentions&mention=${MENTION}`);
  });
  test("odd or missing ids still open Mingla team, never the account tab", () => {
    expect(routing.parseBusinessDeepLink("mingla-business://team/not-a-thread")).toBe("/team");
    expect(routing.parseBusinessDeepLink("mingla-business://team/mention/../../x")).toBe("/team?tab=mentions");
    expect(routing.parseBusinessDeepLink("mingla-business://team")).toBe("/team");
    expect(routing.resolveBusinessNavTarget({ type: "business.team_decision", deepLink: "mingla-business://team/mention/" })).toBe("/team?tab=mentions");
    expect(routing.resolveBusinessNavTarget({ type: "business.team_member_joined", brandId: "b1" })).toBe("/brand/b1/team");
  });
});

describe("#4255 W5 a host who is not staff", () => {
  test("any team screen shows This space is for the Mingla team", async () => {
    badge({ staff: false });
    const child = jest.fn(() => <></>);
    const view = await mount(<QueryClientProvider client={client()}><TeamAccessGate>{child}</TeamAccessGate></QueryClientProvider>);
    expect(byTestId(view.root, "team-locked")).toHaveLength(1);
    expect(allText(view.root)).toContain("This space is for the Mingla team");
    expect(child).not.toHaveBeenCalled();
    await TestRenderer.act(async () => { (byTestId(view.root, "team-locked-home")[0].props.onPress as () => void)(); });
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
  });

  test("signed out: the gate never asks the database", async () => {
    mockAuth.user = null;
    const view = await mount(<QueryClientProvider client={client()}><TeamAccessGate>{() => <></>}</TeamAccessGate></QueryClientProvider>);
    expect(byTestId(view.root, "team-locked")).toHaveLength(1);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("staff get the screen", async () => {
    badge({ staff: true });
    const view = await mount(<QueryClientProvider client={client()}><TeamAccessGate>{(userId) => <>{React.createElement("Probe", { testID: `probe-${userId}` })}</>}</TeamAccessGate></QueryClientProvider>);
    expect(byTestId(view.root, "probe-u-staff")).toHaveLength(1);
  });

  test("the Mingla team settings group never renders for them", async () => {
    badge({ staff: false });
    const view = await mount(<QueryClientProvider client={client()}><MinglaTeamPrefsGroup userId="u-host" /></QueryClientProvider>);
    expect(byTestId(view.root, "team-prefs")).toHaveLength(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("staff get the group: In app and Push for mentions, decisions and direct messages; Push alone for group messages", async () => {
    badge({ staff: true });
    const select = { select: () => select, eq: () => select, in: async () => ({ data: [{ category_key: "business.team_message", channel: "push", enabled: true }], error: null }) };
    mockFrom.mockReturnValue(select);
    const view = await mount(<QueryClientProvider client={client()}><MinglaTeamPrefsGroup userId="u-staff" /></QueryClientProvider>);
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(byTestId(view.root, "team-prefs")).toHaveLength(1);
    expect(mockFrom).toHaveBeenCalledWith("notification_channel_prefs");
    for (const key of ["business.team_mention", "business.team_decision", "business.team_message"]) {
      for (const channel of ["inapp", "push"]) expect(byTestId(view.root, `team-pref-${key}-${channel}`)).toHaveLength(1);
    }
    expect(byTestId(view.root, "team-pref-business.team_message-push")[0].props.value).toBe(true);
    // #4255 fix-up: groups are their own switch, off by default (a DM switch row does not turn it on).
    expect(byTestId(view.root, "team-pref-business.team_group_message-push")).toHaveLength(1);
    expect(byTestId(view.root, "team-pref-business.team_group_message-push")[0].props.value).toBe(false);
    expect(byTestId(view.root, "team-pref-business.team_group_message-inapp")).toHaveLength(0);
    expect(byTestId(view.root, "team-pref-business.team_group_message-inapp-none")).toHaveLength(1);
    expect(allText(view.root)).toContain("Group messages");
    expect(allText(view.root)).toContain("Direct messages");
  });

  test("the team screens load from the Brand group chunk, never the boot bundle", () => {
    const route = fs.readFileSync(path.resolve(__dirname, "../../../../app/messages/[conversationId].tsx"), "utf8");
    expect(route).toContain('export { TeamNotificationPrefs, TeamScreen } from "../../src/components/minglaTeam/TeamScreens";');
    // One team route: the list, a chat (?thread=) and new chats (?compose=) share it.
    expect(fs.readdirSync(path.resolve(__dirname, "../../../../app/team"))).toEqual(["index.tsx"]);
    expect(fs.readFileSync(path.resolve(__dirname, "../../../../app/team/index.tsx"), "utf8")).toContain('await import("../messages/[conversationId]")');
    const topBar = fs.readFileSync(path.resolve(__dirname, "../../ui/TopBar.tsx"), "utf8");
    // Only the badge check is static; the button is a lazy chunk.
    expect(topBar).not.toMatch(/^import[^;]*(minglaTeam|teamChatService)/m);
    expect(topBar).toContain('React.lazy(() => import("../minglaTeam/teamBadge"))');
  });

  test("defaults match the database: everything on except group message pushes", () => {
    expect(teamPrefOn([], "business.team_mention", "push")).toBe(true);
    expect(teamPrefOn([], "business.team_decision", "inapp")).toBe(true);
    expect(teamPrefOn([], "business.team_message", "inapp")).toBe(true);
    // #4255 fix-up: a DM pushes by default; a group only once switched on.
    expect(teamPrefOn([], "business.team_message", "push")).toBe(true);
    expect(teamPrefOn([], "business.team_group_message", "push")).toBe(false);
    expect(teamPrefOn([{ category_key: "business.team_group_message", channel: "push", enabled: true }], "business.team_group_message", "push")).toBe(true);
    expect(teamPrefOn([{ category_key: "business.team_mention", channel: "push", enabled: false }], "business.team_mention", "push")).toBe(false);
  });
});

describe("#4255 W5 sign-out clears team data", () => {
  function Live({ userId }: { userId: string | null }): null {
    useTeamRealtime(userId, THREAD, true);
    return null;
  }
  test("the realtime channel closes when the person signs out", async () => {
    interface FakeChannel { on: jest.Mock; subscribe: jest.Mock }
    const channel: FakeChannel = { on: jest.fn(), subscribe: jest.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mockChannel.mockReturnValue(channel);
    const qc = client();
    const view = await mount(<QueryClientProvider client={qc}><Live userId="u-staff" /></QueryClientProvider>);
    expect(mockChannel).toHaveBeenCalledWith(`team:${THREAD}`);
    await TestRenderer.act(async () => { view.update(<QueryClientProvider client={qc}><Live userId={null} /></QueryClientProvider>); });
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
    expect(mockChannel).toHaveBeenCalledTimes(1);
  });

  test("every team key sits under the signed-in user, and sign-out clears the whole query cache", () => {
    const keys = [
      teamChatKey("u1", "badge"), teamChatKey("u1", "threads"), teamChatKey("u1", "messages", THREAD), teamChatKey("u1", "people"),
      teamChatKey("u1", "mentions"), teamChatKey("u1", "file", ATTACHMENT), teamChatKey("u1", "prefs"),
    ];
    for (const key of keys) expect(key.slice(0, 2)).toEqual(["team-chat", "u1"]);
    expect(teamChatKey("u1", "messages", THREAD)).toEqual(["team-chat", "u1", "messages", THREAD]);
    expect(teamChatKey("u2", "badge")).not.toEqual(teamChatKey("u1", "badge"));
    const auth = fs.readFileSync(path.resolve(__dirname, "../../../context/AuthContext.tsx"), "utf8");
    const signOut = auth.slice(auth.indexOf("const signOut = useCallback("), auth.indexOf("const authStatus = useMemo("));
    expect(signOut).toContain("queryClient.clear();");
    const signedOut = auth.slice(auth.indexOf('if (_event === "SIGNED_OUT")'));
    expect(signedOut.slice(0, 1200)).toContain("queryClient.clear();");
  });
});

describe("#4255 fix-up: @everyone is offered only to an owner or admin", () => {
  test("team_badge admin decides; never in a DM", () => {
    expect(canMentionEveryone(true, { kind: "group" })).toBe(true);
    expect(canMentionEveryone(true, { kind: "team" })).toBe(true);
    expect(canMentionEveryone(false, { kind: "group" })).toBe(false);
    expect(canMentionEveryone(false, { kind: "team" })).toBe(false);
    expect(canMentionEveryone(true, { kind: "dm" })).toBe(false);
    expect(canMentionEveryone(true, null)).toBe(false);
  });
  test("the thread screen reads the flag from the staff check and gives it to the suggestions and the send", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../TeamThreadScreen.tsx"), "utf8");
    expect(source).toContain("const canEveryone = canMentionEveryone(isTeamAdmin, thread);");
    expect(source).toContain("mentionsInBody(body, pickedMentions.current, canEveryone)");
  });
  test("a teammate who is not admin typing @everyone mentions nobody extra", () => {
    expect(mentionsInBody("@everyone hi", new Map(), false)).toEqual({ ids: [], everyone: false });
    expect(mentionsInBody("@everyone hi", new Map(), true).everyone).toBe(true);
  });
  function Probe(): null {
    const access = useTeamAccess();
    (globalThis as { __teamAdmin?: boolean }).__teamAdmin = access.admin;
    return null;
  }
  test("the staff check carries admin from team_badge, and only for staff", async () => {
    badge({ staff: true, admin: true });
    await mount(<QueryClientProvider client={client()}><Probe /></QueryClientProvider>);
    expect((globalThis as { __teamAdmin?: boolean }).__teamAdmin).toBe(true);
    badge({ staff: true, admin: false });
    await mount(<QueryClientProvider client={client()}><Probe /></QueryClientProvider>);
    expect((globalThis as { __teamAdmin?: boolean }).__teamAdmin).toBe(false);
  });
});

describe("#4255 fix-up: realtime never filters on a primary key (I-PROPOSED-ORCH-0931)", () => {
  function Live({ threadId }: { threadId: string | null }): null {
    useTeamRealtime("u-staff", threadId, true);
    return null;
  }
  test("the thread channel listens to team_threads without id=eq.* and refreshes only for its own thread", async () => {
    interface FakeChannel { on: jest.Mock; subscribe: jest.Mock }
    const channel: FakeChannel = { on: jest.fn(), subscribe: jest.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mockChannel.mockReturnValue(channel);
    const qc = client();
    const invalidate = jest.spyOn(qc, "invalidateQueries");
    await mount(<QueryClientProvider client={qc}><Live threadId={THREAD} /></QueryClientProvider>);
    const bindings = channel.on.mock.calls.map((call) => call[1] as { table: string; event: string; filter?: string });
    for (const b of bindings) expect(b.filter ?? "").not.toMatch(/(^|[^_a-z])id=eq\./);
    const threadsCall = channel.on.mock.calls.find((call) => (call[1] as { table: string }).table === "team_threads");
    expect(threadsCall).toBeDefined();
    expect((threadsCall?.[1] as { filter?: string }).filter).toBeUndefined();
    const handler = threadsCall?.[2] as (payload: { new?: { id?: unknown } }) => void;
    invalidate.mockClear();
    handler({ new: { id: CARD } });
    expect(invalidate).not.toHaveBeenCalled();
    handler({ new: { id: THREAD } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: teamChatKey("u-staff", "messages", THREAD) });
  });

  test("the repo gate passes on the team chat hook", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../useTeamChat.ts"), "utf8");
    expect(source).not.toMatch(/filter:\s*`id=eq\./);
  });
});

describe("#4255 W5 attachments", () => {
  const file = (size: number, name = "flyer.png", mimeType: string | null = "image/png") => ({ uri: "file:///x", name, mimeType, size });

  test("over 25 MB is refused before upload with the rev 4 words", () => {
    expect(() => service.checkTeamFile(file(25 * 1024 * 1024 + 1, "Venue contract.pdf", "application/pdf"))).toThrow("Venue contract.pdf is over 25 MB. Share it as a link instead.");
    expect(service.checkTeamFile(file(1000)).kind).toBe("image");
    expect(service.checkTeamFile(file(1000, "deck.pptx", null)).mime).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(() => service.checkTeamFile(file(1000, "clip.mp4", "video/mp4"))).toThrow("can't be sent here");
  });

  test("the upload goes to team-files at the path the database issued", async () => {
    mockRpc.mockResolvedValue({ data: { attachment: { id: ATTACHMENT }, upload: { bucket: "team-files", path: `${THREAD}/${ATTACHMENT}/flyer.png` } }, error: null });
    const checked = service.checkTeamFile(file(1000));
    const added = await service.addTeamFile(THREAD, checked);
    expect(mockRpc).toHaveBeenCalledWith("team_attachment_add", { p_thread_id: THREAD, p_file: { kind: "image", name: "flyer.png", mime: "image/png", size_bytes: 1000 } });
    await service.uploadTeamFile(THREAD, added.attachment.id, added.path, checked, () => undefined);
    expect(mockUpload).toHaveBeenCalledWith("team-files", `${THREAD}/${ATTACHMENT}/flyer.png`, "image/png", checked.local, expect.any(Function));
  });

  test("a path for another chat or attachment, or another bucket, is refused", async () => {
    const checked = service.checkTeamFile(file(1000));
    await expect(service.uploadTeamFile(THREAD, ATTACHMENT, `${CARD}/${ATTACHMENT}/flyer.png`, checked, () => undefined)).rejects.toThrow("Couldn't upload");
    await expect(service.uploadTeamFile(THREAD, ATTACHMENT, `${THREAD}/${CARD}/flyer.png`, checked, () => undefined)).rejects.toThrow("Couldn't upload");
    expect(mockUpload).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: { attachment: { id: ATTACHMENT }, upload: { bucket: "brand-group-file-staging", path: `${THREAD}/${ATTACHMENT}/flyer.png` } }, error: null });
    await expect(service.addTeamFile(THREAD, checked)).rejects.toThrow("Couldn't upload");
  });
});

describe("#4255 W5 Open in Mingla Admin", () => {
  test("the link Admin issued for the card, else the card on Work, else Messages", () => {
    expect(service.teamAdminUrl({ deep_link: `https://admin.usemingla.com/#/work-board?card=${CARD}`, card_id: CARD })).toBe(`https://admin.usemingla.com/#/work-board?card=${CARD}`);
    expect(service.teamAdminUrl({ deep_link: `https://admin.usemingla.com/#/content-calendar?card=${CARD}`, card_id: null })).toBe(`https://admin.usemingla.com/#/content-calendar?card=${CARD}`);
    expect(service.teamAdminUrl({ deep_link: "https://evil.example/#/work", card_id: CARD })).toBe(`https://admin.usemingla.com/#/work-board?card=${CARD}`);
    expect(service.teamAdminUrl({ deep_link: null, card_id: "nope" })).toBe("https://admin.usemingla.com/#/messages");
  });

  test("links get a friendly name with no page fetch", () => {
    expect(service.teamLinkLabel("https://drive.google.com/file/d/1")).toEqual({ name: "Google Drive file", host: "drive.google.com" });
    expect(service.teamLinkLabel("https://docs.google.com/document/d/1")).toEqual({ name: "Google Doc", host: "docs.google.com" });
    expect(service.teamLinkLabel("https://www.instagram.com/p/abc")).toEqual({ name: "Instagram post", host: "instagram.com" });
    expect(service.normalizeTeamLink("drive.google.com/x")).toBe("https://drive.google.com/x");
    expect(service.normalizeTeamLink("not a link")).toBeNull();
  });
});
