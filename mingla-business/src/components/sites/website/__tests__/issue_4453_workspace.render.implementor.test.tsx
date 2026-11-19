/*
 * #4453 Website workspace — the shell, rendered against a stand-in server
 * (the real data layer and query cache run; only the network is replaced):
 * each mode, every old address, autosave with its optimistic and conflict
 * paths, list rows, the Publish panel in each state, Ari's plan / question /
 * rollback / team-request flows, the lock, and the phone layout.
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = { data?: unknown; fail?: { status: number; code: string; latest?: Record<string, unknown> } };
const mockCalls: { action: string; args: Record<string, unknown> }[] = [];
let mockServer: (action: string, args: Record<string, unknown>) => Reply = () => ({ data: {} });
let mockWide = true;
let mockPreviewProps: Record<string, unknown> = {};
const mockPost = jest.fn();
const mockRpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let mockRequestRows: Record<string, unknown>[] = [];
let mockAboutOff = false;
let mockSwitcherProps: { brandId?: string; compact?: boolean } | null = {};
let mockEmit: (events: { id: string; event_type: string; detail?: unknown }[]) => void = () => undefined;
const mockChat = {
  conversationId: null as string | null,
  sendMessage: jest.fn(),
  sendChoice: jest.fn(),
  setSurface: jest.fn(),
  setWorkflowContext: jest.fn(),
  setSiteFocus: jest.fn(),
  clearPendingAction: jest.fn(),
};
const mockConfirm = jest.fn();
const mockCancel = jest.fn();
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };

jest.mock("../../../../services/supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(async (_name: string, options: { body: { action: string; args?: Record<string, unknown> } }) => {
        const { action, args = {} } = options.body;
        mockCalls.push({ action, args });
        const reply = mockServer(action, args);
        if (reply.fail) {
          const body = { error: { code: reply.fail.code, message: "refused", latest: reply.fail.latest } };
          return { data: null, error: { context: { status: reply.fail.status, json: async () => body, clone: () => ({ json: async () => body }) } } };
        }
        return { data: { ok: true, data: reply.data }, error: null };
      }),
    },
    rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
      mockRpcCalls.push({ name, args });
      return { data: { ticket_id: "t-9", ticket_number: 2041, replayed: false }, error: null };
    }),
    // The brand's requests to the team (support_website_requests, read under RLS).
    from: jest.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) chain[method] = () => chain;
      chain.limit = async () => ({ data: mockRequestRows, error: null });
      return chain;
    }),
  },
}));
jest.mock("../../../brand/WorkspaceBrandSwitcher", () => {
  const ReactLib = require("react");
  const { Text } = require("react-native");
  return {
    WorkspaceBrandSwitcher: (props: { brandId?: string; compact?: boolean }) => {
      mockSwitcherProps = props;
      return ReactLib.createElement(Text, { testID: "workspace-brand-switcher" }, `Brand switcher for ${props.brandId}`);
    },
  };
});
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../../ui/SafeScreen", () => ({ SafeScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native");
  return { ScrollView: ({ children, testID }: { children: React.ReactNode; testID?: string }) => <View testID={testID}>{children}</View> };
});
jest.mock("../../../ui/Sheet", () => {
  const { View } = jest.requireActual("react-native");
  return { Sheet: ({ visible, children, testID }: { visible: boolean; children: React.ReactNode; testID?: string }) => (visible ? <View testID={testID}>{children}</View> : null) };
});
jest.mock("../../../ui/SheetScrollLayout", () => {
  const { View } = jest.requireActual("react-native");
  return { SheetScrollLayout: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => <View>{children}{footer}</View> };
});
jest.mock("../../../ui/Toast", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    Toast: ({ visible, message, action }: { visible: boolean; message: string; action?: { label: string; onPress: () => void } }) => (visible ? (
      <View testID="toast"><Text testID="toast-text">{message}</Text>{action ? <Pressable testID="toast-action" accessibilityLabel={action.label} onPress={action.onPress}><Text>{action.label}</Text></Pressable> : null}</View>
    ) : null),
  };
});
jest.mock("../../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: mockWide }) }));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteLook: () => ({ isLoading: false, isError: false, data: mockLook, refetch: jest.fn() }),
}));
let mockLook: { design: string; tokens: unknown; fonts: unknown; revision: string } = { design: "atelier", tokens: {}, fonts: {}, revision: "2026-11-18T00:00:00.000Z" };
jest.mock("../../../../sites/planApi", () => ({ useBrandSitePlanHeartbeat: () => ({ mutate: jest.fn() }) }));
jest.mock("../../../../hooks/useAgentChat", () => ({ useAgentChat: () => mockChat }));
jest.mock("../../../../hooks/useConfirmPendingAction", () => ({ useConfirmPendingAction: () => ({ confirm: mockConfirm, cancel: mockCancel, isExecuting: false }) }));
// Ari's hooks reach the workspace through the Ari chat chunk (workspace/ariRuntime.ts),
// never a static import; here that chunk is the three stand-ins above.
jest.mock("../workspace/ariRuntime", () => ({
  loadAriRuntime: async () => ({
    useAgentChat: () => mockChat,
    useConfirmPendingAction: () => ({ confirm: mockConfirm, cancel: mockCancel, isExecuting: false }),
    buildChoiceSubmission: jest.requireActual("../../../ari/agentChoices").buildChoiceSubmission,
    fetchAriTurnStatus: jest.fn(async () => ({ events: [] })),
  }),
}));
jest.mock("../../../../sites/ariRunActivity", () => ({
  followAriRun: jest.fn((_id: string, onEvents: typeof mockEmit) => {
    mockEmit = onEvents;
    return jest.fn();
  }),
}));
jest.mock("../workspace/LivePreview", () => {
  const ReactActual = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    LivePreview: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockPreviewProps = props;
      ReactActual.useImperativeHandle(ref, () => ({ post: mockPost }), []);
      const card = typeof props.renderCard === "function" && props.selectedId ? (props.renderCard as () => React.ReactNode)() : null;
      return <View testID="mock-live-preview">{card}</View>;
    }),
  };
});
jest.mock("../PhotoField", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    PhotoChooser: ({ visible, onPick }: { visible: boolean; onPick: (picked: { id: string; thumb_url: string | null }) => void }) => (visible
      ? <Pressable testID="mock-photo-pick" onPress={() => onPick({ id: "m9", thumb_url: null })}><Text>pick</Text></Pressable> : null),
  };
});
jest.mock("../sections/DesignSection", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const marker = (name: string) => {
    const Marker = () => <View testID={`mock-${name}`} />;
    Marker.displayName = `Mock(${name})`;
    return Marker;
  };
  return {
    DesignCard: marker("design-card"),
    CoverCard: marker("cover-card"),
    FontsCard: marker("fonts-card"),
    ShapeRow: marker("shape-row"),
    ColoursCard: ({ onTokens }: { onTokens: (tokens: unknown) => void }) => (
      <Pressable testID="mock-navy" onPress={() => onTokens({ colors: { accent: { seed: "#2a3f9f", steps: { 400: "#2a3f9f" } }, accent_ink: "#1b1736" } })}><Text>navy</Text></Pressable>
    ),
  };
});
jest.mock("../sections/PublishSection", () => {
  const { View } = jest.requireActual("react-native");
  return {
    PublishSection: ({ variant }: { variant?: string }) => <View testID={`mock-publish-section-${variant ?? "full"}`} />,
    CHECK_COPY: new Proxy({}, { get: () => ({ pass: "A check passed", warn: (n: number) => `${n} tips` }) }),
    failureReason: () => "Reason: the build failed.",
    publishStep: () => 0,
    STEPS: ["Checking your draft", "Building your pages"],
  };
});
jest.mock("../sections/DraftReviewCard", () => ({ sectionName: (type: string) => `Type ${type}` }));
for (const [file, names] of [
  ["../sections/OverviewSection", ["OverviewSection"]], ["../sections/PagesSection", ["PagesSection"]], ["../sections/CollectionSection", ["CollectionSection"]],
  ["../sections/DestinationEditor", ["DestinationEditor"]], ["../sections/StoryEditor", ["StoryEditor"]], ["../sections/ReviewEditor", ["ReviewEditor"]],
  ["../sections/PastTripsSection", ["PastTripsSection"]], ["../sections/AddressesSection", ["AddressesSection"]], ["../sections/SettingsSection", ["SettingsSection"]],
] as const) {
  jest.doMock(file, () => {
    const { View } = jest.requireActual("react-native");
    return Object.fromEntries(names.map((name) => [name, () => <View testID={`mock-${name}`} />]));
  });
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseWebsitePath, type WebsiteRoute } from "../../../../sites/websiteNav";
import type { WebsiteContextValue } from "../WebsiteContext";
import { HostShellInsetContext, WorkspaceRouteContext } from "../../../ui/hostShellContext";
// The root shell hands the brand switcher to screens through its context
// (the screen does not import it); here the test plays the shell.
import type { WorkspaceRoute } from "../../../brand/workspaceBrandContext";
import { WorkspaceBrandSwitcher } from "../../../brand/WorkspaceBrandSwitcher";
const SHELL_ROUTE: WorkspaceRoute = { pathname: "/brand/b/website", params: { id: "b" }, routeBrandId: "b", Switcher: WorkspaceBrandSwitcher };

const { WorkspaceShell } = require("../workspace/WorkspaceShell") as typeof import("../workspace/WorkspaceShell");
const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };

const SITE = "11111111-1111-4111-8111-111111111111";
type Row = { id: string; type: string; layout: string; review: { state: string; source: string } | null; fields: { key: string; label: string; kind: string; value: string; max: number }[]; [key: string]: unknown };
const sectionRow = (id: string, over: Record<string, unknown> = {}): Row => ({
  id, index: 0, type: "hero", label: id === "s1" ? "Top of the page" : id === "s2" ? "Pick a time" : "Good to know",
  layout: "split", layouts: [{ key: "split", label: "Side by side" }, { key: "centred", label: "Centred" }], review: null, feed: false,
  fields: [{ key: "heading", label: "Headline", kind: "text", value: "Hello", max: 80 }], media: [], can_remove: true, lists: [], ...over,
});
type State = {
  sections: Row[];
  revision: number;
  changes: { section: string; title: string; detail: string }[];
  history: { can_undo: boolean; can_redo: boolean; undo_label: string | null; redo_label: string | null };
  fail: Record<string, Reply["fail"]>;
};
let state: State;

function server(action: string, args: Record<string, unknown>): Reply {
  if (state.fail[action]) return { fail: state.fail[action] };
  const unread = state.sections.filter((entry) => entry.review?.state === "draft");
  const bump = () => {
    state.revision += 1;
    return { data: { page_revision: String(state.revision) } };
  };
  switch (action) {
    case "workspace": return { data: {
      draft_digest: "d1", design: "atelier", look_revision: "2026-11-18T00:00:00.000Z", menu_revision: "m1",
      pages: [{ id: "p1", title: "Home", path: "", enabled: true, in_menu: true, revision: String(state.revision), ari_draft: false, unreviewed: unread.length },
        { id: "p2", title: "About", path: "about", enabled: !mockAboutOff, in_menu: !mockAboutOff, revision: "3", ari_draft: false, unreviewed: 0 }],
      history: state.history,
    } };
    case "page_sections": return { data: { page: { id: args.page_id, title: "Home", path: "", revision: String(state.revision) }, sections: state.sections.map((entry, index) => ({ ...entry, index })) } };
    case "review_status": return { data: { total: unread.length, pages: [{ id: "p1", title: "Home", path: "", enabled: true, count: unread.length, blocks: unread.map((entry) => ({ id: entry.id, type: entry.type, source: entry.review!.source })) }] } };
    case "draft_changes": return { data: { published_at: "2026-11-01T00:00:00Z", changes: state.changes } };
    case "design_checks": return { data: { draft_digest: "d1", warning_count: 0, checks: [], ran_at: "2026-11-18T00:00:00Z" } };
    case "section_catalog": return { data: { types: [{ type: "faq", label: "Questions", description: "Answers people ask for.", needs_photo: false }, { type: "gallery", label: "Photos", description: "A wall of photos.", needs_photo: true }] } };
    case "edit_section": {
      const row = state.sections.find((entry) => entry.id === args.section_id)!;
      for (const edit of (args.edits as { key: string; value: string }[] | undefined) ?? []) {
        row.fields = row.fields.map((field) => (field.key === edit.key ? { ...field, value: edit.value } : field));
      }
      if (typeof args.layout === "string") row.layout = args.layout;
      return bump();
    }
    case "move_section": {
      const from = state.sections.findIndex((entry) => entry.id === args.section_id);
      const [moved] = state.sections.splice(from, 1);
      state.sections.splice(args.to_index as number, 0, moved!);
      return bump();
    }
    case "remove_section": state.sections = state.sections.filter((entry) => entry.id !== args.section_id); return bump();
    case "add_section": state.sections.push(sectionRow("s9", { label: "Questions", type: String(args.type), review: { state: "draft", source: "person" } })); return { data: { page_revision: String(state.revision += 1), section_id: "s9" } };
    case "mark_reviewed": state.sections = state.sections.map((entry) => ((args.block_ids as string[]).includes(entry.id) ? { ...entry, review: { state: "reviewed", source: "person" } } : entry)); state.revision += 1; return { data: { page_id: "p1", count: 1 } };
    case "undo": return { data: { group_id: "g1", label: "Move Pick a time", pages: ["p1"], look: false, menu: false } };
    case "set_look": return { data: { look_revision: "2026-11-18T01:00:00.000Z", warnings: [], design: "atelier" } };
    default: return { data: {} };
  }
}

const tick = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const byId = (root: Root, id: string) => root.findAll((node) => node.props.testID === id && typeof node.type !== "string");
// On screen means a host node: a component that renders nothing does not count.
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id && typeof node.type === "string").length > 0;
const press = async (root: Root, id: string) => {
  // The innermost pressable: what a finger or the keyboard actually reaches.
  const node = root.findAll((entry) => entry.props.testID === id && typeof entry.props.onPress === "function").at(-1);
  if (!node) throw new Error(`no pressable ${id}`);
  await act(async () => { (node.props.onPress as () => void)(); });
  await tick();
};
const type = async (root: Root, id: string, value: string) => {
  const node = root.findAll((entry) => entry.props.testID === id && typeof entry.props.onChangeText === "function")[0];
  if (!node) throw new Error(`no input ${id}`);
  await act(async () => { (node.props.onChangeText as (text: string) => void)(value); });
};
const words = (root: Root): string => root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
  .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
const labelOf = (root: Root, id: string): string => String(root.findAll((node) => node.props.testID === id && typeof node.props.accessibilityLabel === "string")[0]?.props.accessibilityLabel ?? "");
const called = (action: string) => mockCalls.filter((entry) => entry.action === action);

function controller(over: Record<string, unknown> = {}) {
  return {
    user: { id: "u1" },
    siteId: SITE,
    site: { isLoading: false, isError: false, data: {
      id: SITE, brand_id: "b", status: "published", active_publication_id: "pub1", last_successful_publication_id: "pub1", owner_offline_at: null,
      brand_site_hosts: [{ hostname: "gameland.sites.usemingla.com", status: "active", is_primary: true, kind: "mingla_subdomain" }],
    } },
    capabilities: { canPublish: true, canEdit: true, canCreate: true },
    validation: { data: { site_id: SITE, valid: true, home_revision: "7", draft_digest: "d1", checked_pages: 5 }, isFetching: false, isLoading: false, isError: false, error: null, refetch: jest.fn() },
    versions: { data: [], isLoading: false, refetch: jest.fn() },
    previewGrant: { data: { preview_url: "https://studio.test/preview?token=t1", pages: [] }, isError: false, refetch: jest.fn() },
    refreshPreview: jest.fn(),
    publicationOperation: null,
    publicationReceipt: { data: null },
    publicationPollingTimedOut: false,
    publicationCacheChecked: true,
    publishedJustNow: null,
    isPublishing: false,
    notice: null,
    actions: { publishChecked: jest.fn(async () => null), openUrl: jest.fn(), onResetFailedPublication: jest.fn(), onReconcilePublication: jest.fn(), dismissNotice: jest.fn(), retry: jest.fn() },
    ...over,
  } as unknown as WebsiteContextValue["controller"];
}

async function open(options: { segments?: string[]; search?: Record<string, string>; lockedBy?: string | null | false; controller?: Record<string, unknown>; wide?: boolean; shellTopBar?: boolean } = {}) {
  mockWide = options.wide ?? true;
  const control = controller(options.controller);
  const setTokenDeclarations = jest.fn();
  const base: WebsiteContextValue = {
    brandId: "b", brandName: "Gameland Lagos", controller: control, phone: !mockWide, section: "overview",
    go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: jest.fn(), asking: false,
    lock: { heldByOther: options.lockedBy !== undefined && options.lockedBy !== false, holderName: options.lockedBy || null, canTakeOver: true, takeOver: jest.fn(), takingOver: false },
    plan: null,
    previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations,
    headingRef: React.createRef(), offerings: [], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  };
  const segments = options.segments ?? [];
  const route = parseWebsitePath("b", segments) as Exclude<WebsiteRoute, { kind: "redirect" | "preview" | "setup" }>;
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
        <WorkspaceRouteContext.Provider value={SHELL_ROUTE}>
          <HostShellInsetContext.Provider value={options.shellTopBar === true}>
            <WorkspaceShell base={base} route={route} search={options.search ?? {}} segments={segments} contentDetails={["stories"]} dialogs={null} offlineDevice={false} />
          </HostShellInsetContext.Provider>
        </WorkspaceRouteContext.Provider>
      </QueryClientProvider>,
    );
  });
  await tick(100);
  mounted.push(tree.unmount);
  return { root: tree.root, base, control, setTokenDeclarations, unmount: tree.unmount };
}

const mounted: (() => void)[] = [];
afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((unmount) => unmount()); });
});

beforeEach(() => {
  mockCalls.length = 0;
  mockRpcCalls.length = 0;
  mockRequestRows = [];
  mockAboutOff = false;
  mockSwitcherProps = {};
  mockPost.mockClear();
  Object.values(mockChat).forEach((value) => typeof value === "function" && (value as jest.Mock).mockReset());
  mockConfirm.mockReset();
  mockCancel.mockReset();
  mockRouter.push.mockClear();
  mockLook = { design: "atelier", tokens: {}, fonts: {}, revision: "2026-11-18T00:00:00.000Z" };
  state = {
    sections: [sectionRow("s1"), sectionRow("s2"), sectionRow("s3")],
    revision: 7,
    changes: [{ section: "pages", title: "Home", detail: "Headline changed" }, { section: "design", title: "Design", detail: "Colours" }],
    history: { can_undo: true, can_redo: false, undo_label: "Move Pick a time", redo_label: null },
    fail: {},
  };
  mockServer = server;
});

describe("the workspace shell (desktop)", () => {
  it("shows the three modes, one status chip and one Publish button that only opens the panel", async () => {
    const { root, control } = await open();
    expect(has(root, "workspace-mode-ari") && has(root, "workspace-mode-edit") && has(root, "workspace-mode-design")).toBe(true);
    expect(has(root, "ari-intro")).toBe(true);
    expect(words(root)).toContain("Live · 2 not published yet");
    expect(words(root)).toContain("Publish 2 changes");
    // The header is the app's brand switcher for THIS brand (compact), with the save state under it.
    expect(mockSwitcherProps).toMatchObject({ brandId: "b", compact: true });
    expect(words(root)).toContain("Brand switcher for b");
    expect(has(root, "workspace-save-state")).toBe(true);
    expect(words(root)).toContain("Website · saved");
    expect(root.findAll((node) => node.props.testID === "workspace-publish" && typeof node.type !== "string").length).toBeGreaterThan(0);
    await press(root, "workspace-publish");
    expect(has(root, "publish-panel")).toBe(true);
    expect((control.actions as unknown as { publishChecked: jest.Mock }).publishChecked).not.toHaveBeenCalled();
    expect(mockPreviewProps.url).toBe(`https://studio.test/api/mingla/previews?site_id=${SITE}&token=t1`);
    expect(mockPreviewProps.editMode).toBe(true);
  });

  it.each([
    [["pages"], "edit-panel"], [["design"], "design-panel"], [["publish"], "publish-panel"], [["addresses"], "mock-AddressesSection"],
    [["settings"], "mock-SettingsSection"], [["stories"], "mock-CollectionSection"], [["stories", "abc"], "mock-StoryEditor"], [["past"], "mock-PastTripsSection"],
  ] as const)("the old address /website/%s lands in the right place", async (segments, testID) => {
    const { root } = await open({ segments: [...segments] });
    expect(has(root, testID)).toBe(true);
  });

  it("opens History, Stats and Requests from the more menu, and Website setup only before the first publish", async () => {
    const { root } = await open();
    await press(root, "workspace-more");
    expect(has(root, "more-setup")).toBe(false);
    await press(root, "more-history");
    expect(has(root, "mock-publish-section-history")).toBe(true);
    await press(root, "workspace-detail-back");
    await press(root, "workspace-more");
    await press(root, "more-requests");
    expect(words(root)).toContain("None yet");
    const first = await open({ controller: { site: { isLoading: false, isError: false, data: { id: SITE, status: "draft", active_publication_id: null, last_successful_publication_id: null, owner_offline_at: null, brand_site_hosts: [] } } } });
    await press(first.root, "workspace-more");
    expect(has(first.root, "more-setup")).toBe(true);
    expect(words(first.root)).toContain("Draft · not live");
    expect(words(first.root)).toContain("Go live");
  });

  it("a ready-for-review notification link opens the requests list on that request, with its section chosen and in view", async () => {
    mockRequestRows = [
      { ticket_id: "t-0", what: "Something else", section_id: null, section_label: null, page_path: null, due_at: "2026-11-21T09:00:00Z", ready_at: null, created_at: "2026-11-18T09:00:00Z", ticket: { ticket_number: 2040, status: "open" } },
      { ticket_id: "t-1", what: "Add a countdown", section_id: "s2", section_label: "Pick a time", page_path: "/", due_at: "2026-11-20T09:00:00Z", ready_at: "2026-11-19T12:00:00Z", created_at: "2026-11-19T09:00:00Z", ticket: { ticket_number: 2041, status: "pending" } },
    ];
    const { root } = await open({ search: { request: "t-1" } });
    expect(has(root, "requests-pane")).toBe(true);
    expect(words(root)).toContain("Add a countdown");
    expect(words(root)).toContain("Request 2041");
    expect(words(root)).toContain("Ready for your review");
    // The section the request is about is already chosen on the page behind the list.
    expect(mockPost).toHaveBeenCalledWith({ type: "mingla:preview-scroll-to", section_id: "s2" });
    expect((mockPreviewProps.marks as { selected: string | null }).selected).toBe("s2");
    // "Read it on the page" closes the list on that section, open in Edit.
    mockPost.mockClear();
    await press(root, "request-read-t-1");
    expect(has(root, "requests-pane")).toBe(false);
    expect(has(root, "workspace-mode-edit")).toBe(true);
    expect(mockPost).toHaveBeenCalledWith({ type: "mingla:preview-scroll-to", section_id: "s2" });
    expect(has(root, "field-s2-heading")).toBe(true);
  });

  it("a request the owner starts from a section is sent with the page's visitor address and the draft's digest", async () => {
    const { root } = await open({ segments: ["pages"] });
    await act(async () => { (mockPreviewProps.onSelect as (id: string) => void)("s2"); });
    await press(root, "section-ari-team");
    // The owner is writing this one: the card does not claim Ari wrote it.
    expect(words(root)).toContain("Say what you’d like in your own words. The team sees where you are on your website.");
    expect(words(root)).not.toContain("Ari wrote this so the team gets it right.");
    await type(root, "team-request-what", "Add a countdown to this section.");
    await press(root, "team-request-send");
    expect(mockRpcCalls).toHaveLength(1);
    expect(mockRpcCalls[0]!.name).toBe("issue_4453_create_website_request");
    expect(mockRpcCalls[0]!.args).toMatchObject({
      p_brand_id: "b", p_site_id: SITE, p_what: "Add a countdown to this section.",
      // "" in the workspace is "/" in the database (which refuses a section without its page).
      p_where: { page_path: "/", section_id: "s2", section_label: "Pick a time" },
    });
    expect(has(root, "team-request-sent")).toBe(true);
  });

  it("a page that is off has no draft page to show: it says so and offers to turn it on", async () => {
    mockAboutOff = true;
    const { root } = await open({ segments: ["pages"] });
    expect(has(root, "workspace-preview-off")).toBe(false);
    await press(root, "page-picker-toggle");
    await press(root, "page-option-about");
    // The preview would be "not found" for a page that is off: no frame is loaded for it.
    expect(has(root, "workspace-preview-off")).toBe(true);
    expect(words(root)).toContain("“About” is off");
    await press(root, "workspace-preview-off-turn-on");
    expect(called("set_page_enabled")[0]!.args).toEqual({ page_id: "p2", expected_revision: "3", enabled: true });
  });
});

describe("one brand switcher per screen", () => {
  it("leaves the switcher to the app's top bar on desktop and keeps only the save state in the panel", async () => {
    mockSwitcherProps = null;
    const { root } = await open({ shellTopBar: true });
    expect(has(root, "workspace-brand-slot")).toBe(true);
    expect(has(root, "workspace-brand-switcher")).toBe(false);
    expect(mockSwitcherProps).toBeNull();
    expect(has(root, "workspace-save-state")).toBe(true);
    expect(words(root)).toContain("Website · saved");
  });
  it("is the panel's own switcher where no top bar shows one (phones, narrow web)", async () => {
    const { root } = await open({ wide: false, shellTopBar: false });
    expect(has(root, "workspace-brand-switcher")).toBe(true);
    expect(has(root, "workspace-save-state")).toBe(true);
  });
});

describe("Edit mode", () => {
  it("lists the page's sections; typing shows at once, swaps the page text, and saves after the pause with the page's revision", async () => {
    const { root } = await open({ segments: ["pages"] });
    expect(words(root)).toContain("Top of the page");
    await press(root, "section-toggle-s1");
    expect(mockPost).toHaveBeenCalledWith({ type: "mingla:preview-scroll-to", section_id: "s1" });
    await type(root, "field-s1-heading", "Hello Lagos");
    expect(byId(root, "field-s1-heading")[0]!.props.value).toBe("Hello Lagos");
    expect(mockPost).toHaveBeenCalledWith({ type: "mingla:preview-text", section_id: "s1", from: "Hello", to: "Hello Lagos" });
    expect(called("edit_section")).toHaveLength(0);
    expect(words(root)).toContain("Website · saving…");
    await tick(750);
    expect(called("edit_section")).toEqual([{ action: "edit_section", args: { page_id: "p1", expected_revision: "7", section_id: "s1", edits: [{ key: "heading", value: "Hello Lagos" }] } }]);
    expect(words(root)).toContain("Website · saved");
  });

  it("layout, move and remove save at once on the newest revision; Remove needs no confirm and offers Undo", async () => {
    const { root, control } = await open({ segments: ["pages"] });
    await press(root, "section-toggle-s1");
    await press(root, "layout-s1-centred");
    await press(root, "section-down-s1");
    expect(called("edit_section")[0]!.args).toMatchObject({ expected_revision: "7", layout: "centred" });
    expect(called("move_section")[0]!.args).toEqual({ page_id: "p1", expected_revision: "8", section_id: "s1", to_index: 1 });
    await press(root, "section-remove-s1");
    expect(called("remove_section")[0]!.args).toMatchObject({ expected_revision: "9", section_id: "s1" });
    expect(words(root)).toContain("Removed “Top of the page” from your draft.");
    await press(root, "toast-action");
    expect(called("undo")).toHaveLength(1);
    await tick(450);
    expect((control as unknown as { refreshPreview: jest.Mock }).refreshPreview).toHaveBeenCalled();
  });

  it("a control that cannot act says why instead of doing nothing", async () => {
    state.sections[0] = sectionRow("s1", { can_remove: false });
    const { root } = await open({ segments: ["pages"] });
    await press(root, "section-up-s1");
    expect(words(root)).toContain("Already at the top.");
    await press(root, "section-toggle-s1");
    await press(root, "section-remove-s1");
    expect(words(root)).toContain("so it stays");
    expect(called("remove_section")).toHaveLength(0);
  });

  it("a clash shows the latest and says so; nothing is written over", async () => {
    const { root } = await open({ segments: ["pages"] });
    await press(root, "section-toggle-s1");
    state.fail.edit_section = { status: 409, code: "REVISION_CONFLICT", latest: { revision: "12" } };
    state.sections[0] = sectionRow("s1", { fields: [{ key: "heading", label: "Headline", kind: "text", value: "A teammate's words", max: 80 }] });
    await type(root, "field-s1-heading", "Mine");
    await tick(800);
    expect(words(root)).toContain("Someone changed this while you were editing. Showing the latest.");
    expect(byId(root, "field-s1-heading")[0]!.props.value).toBe("A teammate's words");
  });

  it("a change that does not save is taken off the screen even when the page cannot be read again", async () => {
    const { root } = await open({ segments: ["pages"] });
    const order = () => root.findAll((node) => typeof node.props.testID === "string" && /^section-row-/.test(node.props.testID) && typeof node.type === "string").map((node) => node.props.testID);
    expect(order()).toEqual(["section-row-s1", "section-row-s2", "section-row-s3"]);
    // The service stops answering: the move is refused and the page cannot be re-read either.
    state.fail.move_section = { status: 503, code: "SERVICE_TEMPORARILY_UNAVAILABLE" };
    state.fail.page_sections = { status: 503, code: "SERVICE_TEMPORARILY_UNAVAILABLE" };
    await press(root, "section-down-s1");
    await tick(100);
    expect(words(root)).toContain("Move Top of the page wasn’t saved.");
    expect(order()).toEqual(["section-row-s1", "section-row-s2", "section-row-s3"]);
    expect(words(root)).toContain("Website · last change not saved");
  });

  it("a refusal is said in the owner's words", async () => {
    const { root } = await open({ segments: ["pages"] });
    await press(root, "section-toggle-s1");
    state.fail.edit_section = { status: 422, code: "VALUE_TOO_LONG" };
    await type(root, "field-s1-heading", "x".repeat(60));
    await tick(800);
    expect(words(root)).toContain("That is too long for this spot. Shorten it a little.");
  });

  it("a 'didn't save' line goes away once the next change is on its way", async () => {
    const { root } = await open({ segments: ["pages"] });
    await press(root, "section-toggle-s1");
    state.fail.edit_section = { status: 422, code: "VALUE_TOO_LONG" };
    await type(root, "field-s1-heading", "x".repeat(60));
    await tick(800);
    expect(words(root)).toContain("That is too long for this spot. Shorten it a little.");
    state.fail = {};
    await type(root, "field-s1-heading", "Shorter");
    await tick(800);
    expect(words(root)).not.toContain("That is too long for this spot.");
    expect(words(root)).toContain("Website · saved");
  });

  it("adds a section from the catalog, photo first when it needs one", async () => {
    const { root } = await open({ segments: ["pages"] });
    await press(root, "edit-add-section");
    await press(root, "add-section-faq");
    expect(called("add_section")[0]!.args).toEqual({ page_id: "p1", expected_revision: "7", type: "faq", after_section_id: "s3" });
    expect(words(root)).toContain("starter words");
    await press(root, "edit-add-section");
    await press(root, "add-section-gallery");
    expect(called("add_section")).toHaveLength(1);
    await press(root, "mock-photo-pick");
    expect(called("add_section")[1]!.args).toMatchObject({ type: "gallery", media_id: "m9" });
  });

  it("rows: add, remove and move through list_ops, with the reason at each limit", async () => {
    const rows = (count: number) => Array.from({ length: count }, (_unused, index) => ({ key: `items.${index}.question`, label: "Question", kind: "text", value: `Q${index}`, max: 120 }));
    state.sections[2] = sectionRow("s3", { type: "faq", fields: rows(2), lists: [{ name: "items", label: "Questions", item_label: "question", min: 2, max: 3, count: 2, fields: [{ key: "question", label: "Question", kind: "text", max: 120 }] }] });
    const { root } = await open({ segments: ["pages"] });
    await press(root, "section-toggle-s3");
    expect(has(root, "field-s3-items.1.question")).toBe(true);
    await press(root, "row-remove-s3-items-0");
    expect(words(root)).toContain("This needs at least 2, so this one stays.");
    expect(called("edit_section")).toHaveLength(0);
    await press(root, "row-add-s3-items");
    expect(called("edit_section")[0]!.args).toEqual({ page_id: "p1", expected_revision: "7", section_id: "s3", list_ops: [{ list: "items", op: "add", after_index: 1 }] });
    await press(root, "row-down-s3-items-0");
    expect(called("edit_section")[1]!.args.list_ops).toEqual([{ list: "items", op: "move", index: 0, to_index: 1 }]);
    await press(root, "row-up-s3-items-0");
    expect(words(root)).toContain("Already first.");
    state.sections[2] = sectionRow("s3", { type: "faq", fields: rows(3), lists: [{ name: "items", label: "Questions", item_label: "question", min: 2, max: 3, count: 3, fields: [] }] });
    const full = await open({ segments: ["pages"] });
    await press(full.root, "section-toggle-s3");
    await press(full.root, "row-add-s3-items");
    expect(words(full.root)).toContain("This holds up to 3. Remove one to add another.");
    await press(full.root, "row-remove-s3-items-2");
    expect(called("edit_section").at(-1)!.args.list_ops).toEqual([{ list: "items", op: "remove", index: 2 }]);
  });

  it("Undo carries the change's name and calls undo; nothing to redo says so", async () => {
    const { root } = await open({ segments: ["pages"] });
    expect(labelOf(root, "workspace-undo")).toBe("Undo: Move Pick a time");
    expect(labelOf(root, "workspace-redo")).toBe("Nothing to redo. Nothing to redo");
    await press(root, "workspace-redo");
    expect(called("redo")).toHaveLength(0);
    await press(root, "workspace-undo");
    expect(called("undo")).toHaveLength(1);
    expect(words(root)).toContain("Undone: Move Pick a time");
  });

  it("pages: pick another, turn one off (Home never), rename in the menu through Ari", async () => {
    const { root } = await open({ segments: ["pages"] });
    await press(root, "page-picker-toggle");
    await press(root, "page-toggle-enabled");
    expect(words(root)).toContain("Your home page is always on.");
    expect(called("set_page_enabled")).toHaveLength(0);
    await press(root, "page-option-about");
    expect(called("page_sections").at(-1)!.args).toEqual({ page_id: "p2" });
    await press(root, "page-picker-toggle");
    await press(root, "page-toggle-enabled");
    expect(called("set_page_enabled")[0]!.args).toEqual({ page_id: "p2", expected_revision: "3", enabled: false });
    expect(words(root)).toContain("“About” is off and out of your menu. Undo puts it back.");
    await press(root, "page-rename-menu");
    expect(has(root, "ari-panel")).toBe(true);
    expect(byId(root, "ari-input")[0]!.props.value).toBe("Rename “About” in the menu to ");
  });

  it("loading, empty and error each have their own state", async () => {
    state.sections = [];
    const empty = await open({ segments: ["pages"] });
    expect(has(empty.root, "edit-empty")).toBe(true);
    state.fail.page_sections = { status: 503, code: "SERVICE_TEMPORARILY_UNAVAILABLE" };
    state.fail.workspace = { status: 503, code: "SERVICE_TEMPORARILY_UNAVAILABLE" };
    const down = await open({ segments: ["pages"] });
    expect(has(down.root, "workspace-down")).toBe(true);
    expect(has(down.root, "workspace-down-retry")).toBe(true);
    const broken = await open({ segments: ["pages"], controller: { previewGrant: { data: undefined, isError: true, refetch: jest.fn() } } });
    expect(has(broken.root, "workspace-preview-error")).toBe(true);
  });

  it("while a teammate holds the website it is view only, with the take-over banner", async () => {
    const { root } = await open({ segments: ["pages"], lockedBy: "Ada" });
    expect(has(root, "website-lock-banner")).toBe(true);
    expect(words(root)).toContain("Website · view only");
    await press(root, "section-toggle-s1");
    expect(byId(root, "field-s1-heading")[0]!.props.editable).toBe(false);
    await press(root, "section-down-s1");
    expect(words(root)).toContain("Ada is editing the website right now. Take over to make changes.");
    expect(called("move_section")).toHaveLength(0);
  });
});

describe("clicking a section on the page", () => {
  it("selects it, opens the Ari card beside it and marks the page", async () => {
    state.sections[1] = sectionRow("s2", { review: { state: "draft", source: "team" } });
    const { root } = await open();
    expect(mockPreviewProps.marks).toEqual({ selected: null, ari: null, unread: [{ id: "s2", by: "team" }] });
    await act(async () => { (mockPreviewProps.onSelect as (id: string) => void)("s2"); });
    expect(has(root, "section-ari-card")).toBe(true);
    expect(words(root)).toContain("Ari · Pick a time");
    expect((mockPreviewProps.marks as { selected: string }).selected).toBe("s2");
    await press(root, "section-ari-edit");
    expect(has(root, "section-editor-s2")).toBe(true);
    expect(words(root)).toContain("Made by the Mingla team for your request.");
  });

  it("a request from the card is scoped to that section", async () => {
    mockChat.sendMessage.mockResolvedValue({ kind: "text", text: "Done thinking.", conversation_id: "c", message_id: "m", client_turn_id: "t" });
    const { root } = await open();
    await act(async () => { (mockPreviewProps.onSelect as (id: string) => void)("s2"); });
    await type(root, "section-ari-input", "Make it stand out");
    await press(root, "section-ari-send");
    expect(mockChat.setWorkflowContext).toHaveBeenCalledWith("website_workspace");
    expect(mockChat.setSiteFocus).toHaveBeenLastCalledWith({ page_id: "p1", page_path: "", section_id: "s2", section_type: "hero", section_label: "Pick a time" });
    expect(mockChat.sendMessage).toHaveBeenCalledWith("Make it stand out");
    expect(words(root)).toContain("About: Pick a time");
    expect(has(root, "section-ari-card")).toBe(false);
  });
});

describe("Ari mode", () => {
  const plan = {
    kind: "pending_action", pending_action_id: "pa1", tool_name: "propose_site_change_set", client_turn_id: "turn1",
    tool_args: { request: "Put booking first", summary: "Two changes", steps: [
      { label: "Move Pick a time up", why: "Booking first", cites: [], step: { op: "move_section", page_id: "p1", section_id: "s2", to_index: 0 } },
      { label: "New headline", why: "From your listings", cites: [], step: { op: "edit_section", page_id: "p1", section_id: "s1", edits: [] } },
    ], couldnt: [] },
  };
  const defer = () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };

  it("turns one request into a plan, confirms it itself, shows each step land, then offers Undo this and Looks good", async () => {
    const confirm = defer();
    mockChat.sendMessage.mockResolvedValue(plan);
    mockConfirm.mockReturnValue(confirm.promise);
    const { root, control } = await open();
    await type(root, "ari-input", "Put booking first");
    await press(root, "ari-send");
    expect(mockConfirm).toHaveBeenCalledWith("pa1", undefined, "website_workspace");
    expect(has(root, "ari-plan")).toBe(true);
    expect(words(root)).toContain("I’ll make these on your draft one at a time. Watch the page.");
    await act(async () => { mockEmit([{ id: "e1", event_type: "site_step_started", detail: { index: 0, total: 2, label: "Move Pick a time up" } }]); });
    expect(has(root, "ari-step-0-active") && has(root, "ari-step-1-waiting")).toBe(true);
    expect((mockPreviewProps.marks as { ari: string }).ari).toBe("s2");
    await act(async () => { mockEmit([{ id: "e1", event_type: "site_step_started" }, { id: "e2", event_type: "site_step_done" }, { id: "e3", event_type: "site_step_started" }]); });
    expect(has(root, "ari-step-0-done") && has(root, "ari-step-1-active")).toBe(true);
    await act(async () => {
      confirm.resolve({ kind: "executed", result: { group_id: "g7", status: "applied", total: 2, applied: [{ index: 0, label: "a", op: "move_section", page_id: "p1", section_id: "s2" }, { index: 1, label: "b", op: "edit_section", page_id: "p1", section_id: "s1" }], checks: { passed: true, warnings: [] }, couldnt: [] } });
    });
    await tick(450);
    expect(words(root)).toContain("2 changes are on your draft. Nothing is live until you publish.");
    expect(has(root, "ari-step-1-done")).toBe(true);
    expect((mockPreviewProps.marks as { ari: string | null }).ari).toBeNull();
    expect((control as unknown as { refreshPreview: jest.Mock }).refreshPreview).toHaveBeenCalled();
    await press(root, "ari-keep-run");
    expect(called("mark_reviewed")[0]!.args).toEqual({ page_id: "p1", block_ids: ["s2", "s1"] });
    expect(words(root)).toContain("Marked as read.");
  });

  it("Undo this undoes the whole change set by its group", async () => {
    mockChat.sendMessage.mockResolvedValue(plan);
    mockConfirm.mockResolvedValue({ kind: "executed", result: { group_id: "g7", status: "applied", applied: [{ index: 0, op: "move_section", page_id: "p1", section_id: "s2" }], checks: { passed: true, warnings: [] }, couldnt: [] } });
    const { root } = await open();
    await type(root, "ari-input", "Put booking first");
    await press(root, "ari-send");
    await press(root, "ari-undo-run");
    expect(called("undo")[0]!.args).toEqual({ group_id: "g7" });
    expect(words(root)).toContain("Undone. Your draft is back to how it was.");
  });

  it("asks one question with answers to tap; the answer goes back as an ordinary message", async () => {
    mockChat.sendMessage.mockResolvedValueOnce({ kind: "text", text: "One thing I need.", site_question: { prompt: "Is parking free at Gameland?", options: ["Free, on site", "Paid, on site"] }, client_turn_id: "t1" })
      .mockResolvedValueOnce({ kind: "text", text: "Thanks.", client_turn_id: "t2" });
    const { root } = await open();
    await type(root, "ari-input", "Answer the parking question");
    await press(root, "ari-send");
    expect(words(root)).toContain("Is parking free at Gameland?");
    expect(words(root)).toContain("I won’t guess facts about your venue.");
    await press(root, "ari-answer-0");
    expect(mockChat.sendMessage).toHaveBeenLastCalledWith("Free, on site");
    expect(has(root, "ari-question")).toBe(false);
  });

  it("shows the question once when Ari's reply ends with it (the server sends both)", async () => {
    const prompt = "What time do you open on Sundays?";
    mockChat.sendMessage.mockResolvedValueOnce({ kind: "text", text: `I don't have your Sunday opening time on record. ${prompt}`, site_question: { prompt, options: ["9am", "10am"] }, client_turn_id: "t1" });
    const { root } = await open();
    await type(root, "ari-input", "Add our Sunday opening hours");
    await press(root, "ari-send");
    const all = String(words(root));
    expect(all.split(prompt).length - 1).toBe(1);
    expect(all).toContain("I don't have your Sunday opening time on record.");
  });

  it("a failed step is a rollback message: no change is claimed and nothing is offered to keep", async () => {
    mockChat.sendMessage.mockResolvedValue(plan);
    mockConfirm.mockResolvedValue({ kind: "executed", result: { group_id: "g8", status: "rolled_back", total: 2, applied: [], failed: { index: 1, label: "New headline", reason: "That claim isn’t backed by your listings." }, checks: null, couldnt: [] } });
    const { root } = await open();
    await type(root, "ari-input", "Put booking first");
    await press(root, "ari-send");
    expect(words(root)).toContain("“New headline” didn’t work. That claim isn’t backed by your listings. I put everything back, so your draft is exactly as it was.");
    expect(has(root, "ari-step-1-failed")).toBe(true);
    expect(has(root, "ari-keep-run")).toBe(false);
    expect(has(root, "ari-undo-partly")).toBe(false);
    expect(words(root)).not.toContain("are on your draft");
  });

  it("a rollback that could not be confirmed is said honestly and offers Undo this", async () => {
    mockChat.sendMessage.mockResolvedValue(plan);
    mockConfirm.mockResolvedValue({ kind: "executed", result: { group_id: "g9", status: "partly_applied", applied: [{ index: 0, op: "move_section", page_id: "p1", section_id: "s2" }], failed: { index: 1, label: "New headline", reason: "It timed out" }, checks: null, couldnt: [] } });
    const { root } = await open();
    await type(root, "ari-input", "Put booking first");
    await press(root, "ari-send");
    expect(words(root)).toContain("part of this may still be on your draft");
    await press(root, "ari-undo-partly");
    expect(called("undo")[0]!.args).toEqual({ group_id: "g9" });
  });

  it("a re-run refusal means it already ran: refresh, never retry", async () => {
    mockChat.sendMessage.mockResolvedValue(plan);
    mockConfirm.mockResolvedValue({ kind: "error", code: "DOMAIN_ACTION_REFUSED", message: "Already executed" });
    const { root } = await open();
    await type(root, "ari-input", "Put booking first");
    await press(root, "ari-send");
    // The server's own words: it may have landed in part the first time.
    expect(words(root)).toContain("This change was already started. Check your draft, and use Undo this if it looks half done.");
    expect(has(root, "ari-retry")).toBe(false);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    // Undo this undoes THAT change set (its group is the approval's id), never just the latest change.
    await press(root, "ari-undo-already");
    expect(called("undo")).toEqual([{ action: "undo", args: { group_id: "pa1" } }]);
  });

  it("cannot do it → Ari writes the team request → the owner edits and sends → sent", async () => {
    mockChat.sendMessage.mockResolvedValue({
      kind: "pending_action", pending_action_id: "pa2", tool_name: "propose_website_team_request", client_turn_id: "t3",
      tool_args: { brand_id: "b", site_id: SITE, what: "Add a 360° tour of the venue to Home.", where: { page_path: "", section_label: "Pick a time" }, why: "Ari has no section that can show a 360° tour yet", missing_capability: "tour_360" },
    });
    mockConfirm.mockResolvedValue({ kind: "executed", result: { ticket_id: "t-1", ticket_number: 1042, status: "received" } });
    const { root } = await open();
    await type(root, "ari-input", "Add a 360° tour of the venue");
    await press(root, "ari-send");
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(has(root, "team-request-card")).toBe(true);
    expect(words(root)).toContain("Ari wrote this so the team gets it right. Change anything, then send.");
    expect(words(root)).toContain("Home › Pick a time");
    expect(words(root)).toContain("Ari has no section that can show a 360° tour yet");
    await type(root, "team-request-what", "Add a 360° tour. I can send the footage.");
    await press(root, "team-request-send");
    // The WHOLE request goes back: the server replaces the stored one with it and re-checks every field.
    expect(mockConfirm).toHaveBeenCalledWith("pa2", {
      brand_id: "b", site_id: SITE, what: "Add a 360° tour. I can send the footage.", where: { page_path: "", section_label: "Pick a time" },
      why: "Ari has no section that can show a 360° tour yet", missing_capability: "tour_360",
    }, "website_workspace");
    expect(has(root, "team-request-sent")).toBe(true);
    expect(words(root)).toContain("Sent. Usually ready within 24 hours.");
    expect(has(root, "team-request-card")).toBe(false);
  });

  it("Not now declines Ari's request; an empty request cannot be sent; a failed send keeps the words", async () => {
    mockChat.sendMessage.mockResolvedValue({ kind: "pending_action", pending_action_id: "pa3", tool_name: "propose_website_team_request", client_turn_id: "t", tool_args: { what: "A tour", where: { page_path: "" }, why: "w", missing_capability: "m" } });
    mockCancel.mockResolvedValue({ kind: "cancelled" });
    const { root } = await open();
    await type(root, "ari-input", "A tour");
    await press(root, "ari-send");
    await type(root, "team-request-what", "  ");
    await press(root, "team-request-send");
    expect(words(root)).toContain("Say what you want changed first.");
    mockConfirm.mockResolvedValue({ kind: "error", code: "RPC_FAILED", message: "The request couldn’t be sent." });
    await type(root, "team-request-what", "A tour please");
    await press(root, "team-request-send");
    expect(words(root)).toContain("The request couldn’t be sent.");
    expect(byId(root, "team-request-what")[0]!.props.value).toBe("A tour please");
    await press(root, "team-request-cancel");
    expect(mockCancel).toHaveBeenCalledWith("pa3");
    expect(has(root, "team-request-card")).toBe(false);
  });

  it("anything else Ari proposes is never run from here; an error offers Try again", async () => {
    mockChat.sendMessage.mockResolvedValueOnce({ kind: "pending_action", pending_action_id: "pa9", tool_name: "publish_site", tool_args: {}, client_turn_id: "t" })
      .mockResolvedValueOnce({ kind: "error", code: "RATE_LIMITED", message: "Ari is busy. Try again in a minute." });
    const { root } = await open();
    await type(root, "ari-input", "Publish it");
    await press(root, "ari-send");
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(has(root, "ari-open-full")).toBe(true);
    await type(root, "ari-input", "Something else");
    await press(root, "ari-send");
    expect(words(root)).toContain("Ari is busy. Try again in a minute.");
    expect(has(root, "ari-retry")).toBe(true);
  });
});

describe("Design mode", () => {
  it("a mood shows on the page at once and autosaves as built: colours whole, shape beside them", async () => {
    const { root, setTokenDeclarations } = await open({ segments: ["design"] });
    expect(has(root, "mood-playful") && has(root, "mood-premium") && has(root, "mood-night")).toBe(true);
    await press(root, "mood-premium");
    const declarations = setTokenDeclarations.mock.calls.at(-1)![0] as string[];
    expect(Array.isArray(declarations) && declarations.length > 0).toBe(true);
    expect(called("set_look")).toHaveLength(0);
    await tick(750);
    const args = called("set_look")[0]!.args;
    expect(args).toMatchObject({ expected_revision: "2026-11-18T00:00:00.000Z", radius: "sharp", button_shape: "square", motion: "calm", fonts: {} });
    expect((args.tokens as { colors: { canvas: string }; radius?: string }).colors.canvas).toBe("#ffffff");
    expect((args.tokens as { radius?: string }).radius).toBeUndefined();
    await tick(750);
    expect(called("set_look")).toHaveLength(1);
  });

  it("the contrast guard names the hard-to-read pair, fixes it in one tap, and blocks Publish until then", async () => {
    const { root } = await open({ segments: ["design"] });
    expect(has(root, "contrast-guard")).toBe(false);
    await press(root, "mock-navy");
    expect(has(root, "contrast-guard")).toBe(true);
    expect(words(root)).toMatch(/Button labels on your accent colour is hard to read \(\d\.\d:1\)\./);
    await press(root, "contrast-fix");
    expect(has(root, "contrast-guard")).toBe(false);
    mockLook = { design: "atelier", tokens: { colors: { accent: { seed: "#2a3f9f", steps: { 400: "#2a3f9f" } }, accent_ink: "#1b1736" } }, fonts: {}, revision: "r" };
    const blocked = await open({ segments: ["publish"] });
    expect(words(blocked.root)).toContain("Fix the hard-to-read text first");
    expect(byId(blocked.root, "publish-final")[0]!.props.disabled).toBe(true);
    await press(blocked.root, "publish-open-design");
    expect(has(blocked.root, "design-panel")).toBe(true);
  });

  it("Ask Ari by mood starts a request in Ari mode", async () => {
    mockChat.sendMessage.mockResolvedValue({ kind: "text", text: "On it.", client_turn_id: "t" });
    const { root } = await open({ segments: ["design"] });
    await press(root, "design-ask-ari");
    expect(mockChat.sendMessage).toHaveBeenCalledWith("Make it feel more premium, keep it fun");
    expect(mockChat.setSiteFocus).toHaveBeenLastCalledWith(null);
    expect(has(root, "ari-panel")).toBe(true);
  });
});

describe("the Publish panel", () => {
  it("ready: lists what changes and publishes after checking the draft again", async () => {
    const { root, control } = await open({ segments: ["publish"] });
    expect(words(root)).toContain("What changes");
    expect(words(root)).toContain("Headline changed");
    expect(words(root)).toContain("All 5 pages build");
    expect(words(root)).toContain("Your last version stays live if anything goes wrong.");
    expect(byId(root, "publish-final")[0]!.props.label).toBe("Publish 2 changes");
    expect((control.validation as unknown as { refetch: jest.Mock }).refetch).toHaveBeenCalled();
    await press(root, "publish-final");
    expect((control.actions as unknown as { publishChecked: jest.Mock }).publishChecked).toHaveBeenCalledTimes(1);
  });

  it("read first: the button names how many, Show me goes to the section, Looks good clears it", async () => {
    state.sections[0] = sectionRow("s1", { review: { state: "draft", source: "ari" } });
    state.sections[1] = sectionRow("s2", { review: { state: "draft", source: "team" } });
    const { root } = await open({ segments: ["publish"] });
    expect(words(root)).toContain("Read before it goes live");
    expect(byId(root, "publish-final")[0]!.props.label).toBe("Read 2 more to publish");
    expect(byId(root, "publish-final")[0]!.props.disabled).toBe(true);
    expect(words(root)).toContain("Home · made by the Mingla team");
    expect(words(root)).toContain("2 to read · 2 not published");
    await press(root, "publish-ok-s1");
    expect(called("mark_reviewed")[0]!.args).toEqual({ page_id: "p1", block_ids: ["s1"] });
    expect(byId(root, "publish-final")[0]!.props.label).toBe("Read 1 more to publish");
    await press(root, "publish-show-s2");
    expect(has(root, "publish-panel")).toBe(false);
    expect(has(root, "section-editor-s2")).toBe(true);
    expect(mockPost).toHaveBeenCalledWith({ type: "mingla:preview-scroll-to", section_id: "s2" });
  });

  it("a real blocker, a failed check, publishing, a failed publish and the lock each say what is in the way", async () => {
    const { BrandSitesError } = jest.requireActual("../../../../services/brandSitesService");
    const validationWith = (over: object) => ({ data: undefined, isFetching: false, isLoading: false, isError: true, error: null, refetch: jest.fn(), ...over });
    const collision = await open({ segments: ["publish"], controller: { validation: validationWith({ error: new BrandSitesError("PATH_COLLISION", "Two parts of your website use the same address.", false) }) } });
    expect(byId(collision.root, "publish-final")[0]!.props.label).toBe("Fix 1 thing to publish");
    expect(words(collision.root)).toContain("Two parts of your website use the same address.");
    const unknown = await open({ segments: ["publish"], controller: { validation: validationWith({ error: new Error("boom") }) } });
    expect(byId(unknown.root, "publish-final")[0]!.props.label).toBe("Check again");
    const running = await open({ segments: ["publish"], controller: { publicationOperation: { operationId: "op", startedAt: Date.now(), kind: "publish" }, publicationReceipt: { data: { status: "running" } } } });
    expect(has(running.root, "publish-progress")).toBe(true);
    expect(byId(running.root, "publish-final")[0]!.props.label).toBe("Publishing…");
    expect(words(running.root)).toContain("Publishing…");
    const failed = await open({ segments: ["publish"], controller: { publicationOperation: { operationId: "op", startedAt: 1, kind: "publish" }, publicationReceipt: { data: { status: "failed", error_code: "X" } } } });
    expect(has(failed.root, "publish-failed")).toBe(true);
    expect(words(failed.root)).toContain("Your previous version is still live, so visitors saw no change. Reason: the build failed.");
    expect(words(failed.root)).toContain("Didn’t go live");
    const locked = await open({ segments: ["publish"], lockedBy: "Ada" });
    expect(byId(locked.root, "publish-final")[0]!.props.label).toBe("Ada is editing");
    const manager = await open({ segments: ["publish"], controller: { capabilities: { canPublish: false, canEdit: true, canCreate: false } } });
    expect(byId(manager.root, "publish-final")[0]!.props.label).toBe("Ask an admin to publish");
    await press(manager.root, "publish-final");
    expect(manager.base.askAdmin).toHaveBeenCalledWith("publish");
  });

  it("nothing new: says so instead of offering a publish", async () => {
    state.changes = [];
    const { root } = await open({ segments: ["publish"] });
    expect(byId(root, "publish-final")[0]!.props.label).toBe("Nothing new to publish");
    expect(words(root)).toContain("Live · up to date");
  });
});

describe("phones and narrow web", () => {
  it("shows the draft full screen with the three modes in a dock, and Publish in the top bar", async () => {
    const { root } = await open({ wide: false });
    expect(has(root, "website-workspace-phone")).toBe(true);
    expect(has(root, "workspace-panel")).toBe(false);
    expect(has(root, "workspace-dock-ari") && has(root, "workspace-dock-edit") && has(root, "workspace-dock-design")).toBe(true);
    expect(has(root, "workspace-publish") && has(root, "workspace-more") && has(root, "workspace-undo")).toBe(true);
    expect((mockPreviewProps.preference as { device: string }).device).toBe("phone");
    expect(mockPreviewProps.renderCard).toBeNull();
    expect(has(root, "workspace-panel-sheet")).toBe(false);
    await press(root, "workspace-dock-edit");
    expect(has(root, "workspace-panel-sheet") && has(root, "edit-panel")).toBe(true);
  });

  it("tapping a section opens the Ari card as a sheet; the more menu is a sheet too", async () => {
    const { root } = await open({ wide: false });
    await act(async () => { (mockPreviewProps.onSelect as (id: string) => void)("s1"); });
    expect(has(root, "section-ari-sheet") && has(root, "section-ari-card")).toBe(true);
    expect(has(root, "section-ari-close")).toBe(false);
    await press(root, "section-ari-edit");
    expect(has(root, "section-ari-sheet")).toBe(false);
    expect(has(root, "section-editor-s1")).toBe(true);
    await press(root, "workspace-more");
    expect(has(root, "more-sheet")).toBe(true);
    await press(root, "more-stats");
    expect(has(root, "mock-OverviewSection")).toBe(true);
    expect(has(root, "workspace-dock")).toBe(false);
  });
});
