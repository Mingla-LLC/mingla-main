/*
 * #2829 W10 — the Website section's agency and analytics additions:
 *  - Settings › Share a private preview: brand admins and owners make a link
 *    that works for 1, 7 or 14 days; its address is shown once with Copy;
 *    working links list who made them, until when, and whether they were
 *    opened; Turn off asks first and revokes that link; a marketing manager
 *    sees why they can't (no controls, nothing fetched);
 *  - Overview › Last 30 days: book clicks, top pages and where visitors came
 *    from, from Core's one analytics reader, with honest empty lines and the
 *    consent wording (visits are counted only with the visitor's permission).
 */
import React from "react";

const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockCopy = jest.fn((_value: string) => Promise.resolve());
const mockListEnabled = jest.fn();
let mockLinks: unknown[] = [];
let mockCounts: unknown = null;

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: { visible: boolean; onConfirm: () => void; title: string; description?: string; testID?: string }) =>
    props.visible
      ? require("react").createElement("mock-confirm", { testID: props.testID, onPress: props.onConfirm }, props.title, " ", props.description ?? "")
      : null,
}));
jest.mock("../../../../utils/copyAddressText", () => ({ copyAddressText: (value: string) => mockCopy(value) }));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteDomains: () => ({ isLoading: false, isError: false, data: { hosts: [] }, refetch: jest.fn() }),
  useBrandSiteShareLinks: (_siteId: string | null, enabled: boolean) => {
    mockListEnabled(enabled);
    return { isLoading: false, isError: false, data: enabled ? mockLinks : undefined };
  },
  useCreateBrandSiteShareLink: () => ({ mutate: mockCreate, isPending: false }),
  useRevokeBrandSiteShareLink: () => ({ mutate: mockRevoke, isPending: false, variables: undefined }),
}));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi");
  return {
    ...actual,
    useDraftChanges: () => ({ isLoading: false, isError: false, data: { published_at: "2026-10-26T18:54:00Z", changes: [] } }),
    useContentList: () => ({ isLoading: false, isError: false, data: { entries: [], revision: "x", reordered: false } }),
    useOverviewCounts: () => ({ isLoading: false, isError: false, data: mockCounts }),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { SettingsSection } from "../sections/SettingsSection";
import { OverviewSection } from "../sections/OverviewSection";
import { shareLinkLine } from "../sections/SharePreviewCard";
import { overviewCountsFrom } from "../../../../sites/contentApi";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };

function textOf(root: Root): string {
  return root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
    .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
}
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id).length > 0;
const press = (root: Root, id: string) => {
  const node = root.findAll((candidate) => candidate.props.testID === id && typeof candidate.props.onPress === "function")[0];
  if (!node) throw new Error(`no pressable ${id}`);
  act(() => { (node.props.onPress as () => void)(); });
};

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const site = {
  id: SITE_ID, brand_id: "b", renderer_key: "sites-v2", renderer_version: 1, status: "published",
  active_publication_id: "p1", last_successful_publication_id: "p1", provisioning_error_code: null, owner_offline_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-26T00:00:00Z",
  brand_site_hosts: [{ hostname: "young.sites.usemingla.com", status: "active", is_primary: true, kind: "mingla_subdomain" }],
};
const toast = jest.fn();

function context(canPublish: boolean): WebsiteContextValue {
  const controller = {
    user: { id: "u1" },
    site: { data: site, isLoading: false, isError: false },
    siteId: SITE_ID,
    capabilities: { canPublish, canEdit: true, canCreate: canPublish },
    validation: { data: null, isLoading: false, isFetching: false, isError: false, error: null, refetch: jest.fn() },
    versions: { data: [], isLoading: false, refetch: jest.fn() },
    publicationOperation: null, publicationReceipt: { data: null }, publishedJustNow: null,
    publicationPollingTimedOut: false, provisionPollingTimedOut: false, isProvisioning: false, isPublishing: false,
    isTogglingOffline: false, isExporting: false, isOpeningStudio: false, exportResult: null,
    label: { data: undefined }, notice: null, journeyState: 0,
    actions: { publish: jest.fn(), rollback: jest.fn(), setOffline: jest.fn(), requestExport: jest.fn(), openUrl: jest.fn(), openStudio: jest.fn() },
  } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "b", brandName: "Young & Stamped", controller, phone: false, section: "settings",
    go: jest.fn(), back: jest.fn(), toast, askAdmin: jest.fn(), asking: false,
    lock: { heldByOther: false, holderName: null, canTakeOver: canPublish, takeOver: jest.fn(), takingOver: false },
    plan: null, previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations: jest.fn(),
    headingRef: React.createRef(), offerings: ["trips"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  } as WebsiteContextValue;
}

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) act(() => mounted.pop()!.unmount()); });
beforeEach(() => {
  mockCreate.mockReset();
  mockRevoke.mockReset();
  mockCopy.mockClear();
  mockListEnabled.mockClear();
  toast.mockClear();
  mockLinks = [];
  mockCounts = null;
});

function render(node: React.ReactElement, canPublish = true) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={context(canPublish)}>{node}</WebsiteProvider></QueryClientProvider>);
  });
  mounted.push(tree);
  return tree.root;
}

const LINK = {
  id: "33333333-3333-4333-8333-333333333333", created_at: "2026-10-26T10:00:00Z", expires_at: "2026-11-02T10:00:00Z",
  revoked_at: null, last_viewed_at: "2026-10-27T09:00:00Z", view_count: 2, created_by_name: "Ada", state: "active",
};

describe("#2829 W10 Share a private preview (Settings)", () => {
  it("an owner makes a link for the chosen length; the address is shown once with Copy", async () => {
    const root = render(<SettingsSection />);
    expect(has(root, "settings-share")).toBe(true);
    press(root, "share-ttl-14");
    press(root, "share-create");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toBe(14);
    const url = "http://young.sites.localhost:3100/preview/share/" + "a".repeat(43);
    act(() => { mockCreate.mock.calls[0][1].onSuccess({ id: LINK.id, created_at: LINK.created_at, expires_at: LINK.expires_at, url, preview_ready: true }); });
    const words = textOf(root);
    expect(words).toContain(url);
    expect(words).toContain("Mingla shows this link only once");
    expect(words).not.toContain("isn't ready yet");
    press(root, "share-copy");
    expect(mockCopy).toHaveBeenCalledWith(url);
  });

  it("says plainly when the draft preview isn't ready yet", () => {
    const root = render(<SettingsSection />);
    press(root, "share-create");
    act(() => { mockCreate.mock.calls[0][1].onSuccess({ id: LINK.id, created_at: LINK.created_at, expires_at: LINK.expires_at, url: "http://x/preview/share/t", preview_ready: false }); });
    expect(textOf(root)).toContain("isn't ready yet");
  });

  it("lists working links and turns one off only after confirming", () => {
    mockLinks = [LINK, { ...LINK, id: "44444444-4444-4444-8444-444444444444", state: "revoked", revoked_at: "2026-10-26T12:00:00Z" }];
    const root = render(<SettingsSection />);
    const words = textOf(root);
    expect(words).toContain("Made by Ada");
    expect(words).toContain("opened 2 times");
    expect(words).toContain("1 earlier link no longer works");
    expect(has(root, `share-revoke-44444444-4444-4444-8444-444444444444`)).toBe(false);
    press(root, `share-revoke-${LINK.id}`);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(textOf(root)).toContain("Turn off this link?");
    press(root, "share-revoke-confirm");
    expect(mockRevoke).toHaveBeenCalledWith(LINK.id, expect.any(Object));
  });

  it("a marketing manager sees why, with no controls and no link list fetched", () => {
    const root = render(<SettingsSection />, false);
    expect(textOf(root)).toContain("Only brand admins and owners can share a private preview.");
    expect(has(root, "share-create")).toBe(false);
    expect(mockListEnabled).toHaveBeenCalledWith(false);
  });

  it("describes each link in one line", () => {
    const format = (iso: string) => iso.slice(0, 10);
    expect(shareLinkLine(LINK as never, format)).toBe("Made by Ada · works until 2026-11-02 · opened 2 times, last 2026-10-27");
    expect(shareLinkLine({ ...LINK, view_count: 0, created_by_name: null } as never, format)).toBe("Made by a teammate · works until 2026-11-02 · not opened yet");
    expect(shareLinkLine({ ...LINK, state: "expired" } as never, format)).toContain("ended 2026-11-02");
  });
});

describe("#2829 W10 Overview › Last 30 days", () => {
  it("shows book clicks, top pages and sources from Core's reader", () => {
    mockCounts = overviewCountsFrom({
      visits_30d: 12, enquiries_30d: 2, bookings_30d: 1, book_clicks_30d: 4,
      top_pages: [{ path: "/trips", views: 9 }, { path: "/", views: 5 }],
      sources: { search: 7, direct: 5, unknown_kind: 3 },
    });
    const root = render(<OverviewSection />);
    const words = textOf(root);
    expect(words).toContain("Book clicks (to your Mingla pages)");
    expect(words).toContain("/trips");
    expect(words).toContain("Search engines");
    expect(words).toContain("Typed or bookmarked");
    expect(words).not.toContain("unknown_kind");
    expect(words).toContain("Visits are counted only for visitors who allow analytics");
  });

  it("says so when there is nothing yet (no invented numbers)", () => {
    mockCounts = overviewCountsFrom({});
    const words = textOf(render(<OverviewSection />));
    expect(words).toContain("No page views yet.");
    expect(words).toContain("No visits yet.");
  });

  it("keeps only well-formed rows from Core", () => {
    const counts = overviewCountsFrom({ top_pages: [{ path: "/a", views: 1 }, { path: "nope", views: 2 }, { path: "/b" }], sources: { social: -1, mingla: 2 }, visits_30d: "9" });
    expect(counts.top_pages).toEqual([{ path: "/a", views: 1 }]);
    expect(counts.sources).toEqual({ mingla: 2 });
    expect(counts.visits_30d).toBe(0);
  });
});
