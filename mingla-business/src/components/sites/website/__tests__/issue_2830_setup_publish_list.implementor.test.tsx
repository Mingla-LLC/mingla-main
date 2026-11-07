/*
 * #2830 setup polish, bug 3 — the setup publish step lists every finding with
 * the page it is on, Fix opens that page, the count is the one Ari gives, and
 * a warning never turns Publish off (the server never refuses one).
 * Harness copied from the #2829 W9b publish review test, whose notes follow:
 *  - the six checks render from the stored run (passes as ticks, warnings as
 *    "doesn't block publishing" with their plain sentences, the truth check's
 *    "Check: '500 travellers' isn't backed by anything in Mingla");
 *  - a site's FIRST publish waits until the checks have run on this draft;
 *    a later publish never waits on them, even if they couldn't run;
 *  - "Why it looks like this" lists each change with its reason and citation.
 */
import React from "react";

type Checks = { data?: unknown; isFetching: boolean; isError: boolean; isLoading: boolean; refetch: jest.Mock };
const mockChecks: { current: Checks } = { current: { data: undefined, isFetching: false, isError: false, isLoading: false, refetch: jest.fn() } };
const mockOpenStudio = jest.fn();
const mockOnFix = jest.fn();
const mockLog: { current: { data?: unknown; isLoading: boolean; isError: boolean; refetch: jest.Mock } } = {
  current: { data: [], isLoading: false, isError: false, refetch: jest.fn() },
};

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi");
  return {
    ...actual,
    useDraftChanges: () => ({ isLoading: false, isError: false, data: { published_at: null, changes: [{ section: "pages", title: "Home", detail: "New words" }] } }),
    useDesignChecks: () => mockChecks.current,
    useWorkLog: () => mockLog.current,
    useSitePages: () => ({ data: { revision: "r", wordmark: null, footer_links: [], pages: [{ id: "page-home", title: "Home", path: "", kind: "page", collection_kind: null, planned_offering: null }] } }),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { PublishSection } from "../sections/PublishSection";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };

function textOf(root: Root): string {
  return root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
    .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
}

const RUN = {
  draft_digest: "d".repeat(64),
  warning_count: 3,
  ran_at: "2026-10-26T20:00:00Z",
  checks: [
    { key: "words", label: "Words", status: "pass", items: [] },
    { key: "photos", label: "Photos", status: "warn", items: [{ message: "Home, Gallery block 3: the picture has no description for people who can't see it", page_path: "", section: "pages" }] },
    { key: "readability", label: "Readability", status: "pass", items: [] },
    { key: "links", label: "Links and buttons", status: "warn", items: [{ message: "Home, Call to action block 4: “/tirps” doesn't go to a page on your website", page_path: "", section: "pages" }] },
    { key: "truth", label: "Truth", status: "warn", items: [{ message: "Check: '500 travellers' isn't backed by anything in Mingla (Home, Hero block 1)", page_path: "", section: "pages" }] },
    { key: "phone", label: "Phone layout", status: "pass", items: [] },
  ],
};

function site(published: boolean) {
  return {
    id: "11111111-1111-4111-8111-111111111111", brand_id: "b", renderer_key: "sites-v2", renderer_version: 1, status: published ? "published" : "draft",
    active_publication_id: published ? "p1" : null, last_successful_publication_id: published ? "p1" : null, provisioning_error_code: null, owner_offline_at: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-26T00:00:00Z",
    brand_site_hosts: [{ hostname: "young.sites.usemingla.com", status: "active", is_primary: true, kind: "mingla_subdomain" }],
  };
}

function context(published: boolean): WebsiteContextValue {
  const data = site(published);
  const controller = {
    user: { id: "u1" },
    site: { data, isLoading: false, isError: false },
    siteId: data.id,
    capabilities: { canPublish: true, canEdit: true, canCreate: true },
    validation: { data: { site_id: data.id, valid: true, renderer: "x", home_revision: "1", draft_digest: "d".repeat(64), checked_pages: 5 }, isLoading: false, isFetching: false, isError: false, error: null, refetch: jest.fn() },
    versions: { data: [], isLoading: false, refetch: jest.fn() },
    publicationOperation: null,
    publicationReceipt: { data: null },
    publishedJustNow: null,
    publicationPollingTimedOut: false,
    isPublishing: false,
    actions: { publish: jest.fn(), openStudio: mockOpenStudio, rollback: jest.fn(), openUrl: jest.fn(), onReconcilePublication: jest.fn(), onResetFailedPublication: jest.fn() },
  } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "b", brandName: "Young & Stamped", controller, phone: false, section: "publish",
    go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: jest.fn(), asking: false,
    lock: { heldByOther: false, holderName: null, canTakeOver: true, takeOver: jest.fn(), takingOver: false },
    plan: null,
    previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations: jest.fn(),
    headingRef: React.createRef(), offerings: ["trips"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  };
}

function render(published: boolean) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={context(published)}><PublishSection variant="setup" onFix={mockOnFix} /></WebsiteProvider></QueryClientProvider>);
  });
  return tree.root;
}

function publishDisabled(root: Root): boolean {
  const button = root.findAll((node) => node.props.testID === "publish-button" && typeof node.props.onPress === "function")[0];
  expect(button).toBeDefined();
  return button!.props.disabled === true;
}

const SETUP_RUN = {
  draft_digest: "d".repeat(64),
  warning_count: 2,
  ran_at: "2026-11-06T10:00:00Z",
  checks: [
    { key: "words", label: "Words", status: "pass", items: [] },
    { key: "links", label: "Links and buttons", status: "warn", items: [{ message: "A link to check (Settings)", page_path: null, section: "settings" }] },
    { key: "truth", label: "Truth", status: "warn", items: [
      { message: "Check: '20' isn't backed by anything in Mingla (Home, Call to action block 2)", page_path: "", section: "pages" },
      { message: "Check: '30' isn't backed by anything in Mingla (Home, Call to action block 2)", page_path: "", section: "pages" },
    ] },
  ],
};

beforeEach(() => {
  mockChecks.current = { data: SETUP_RUN, isFetching: false, isError: false, isLoading: false, refetch: jest.fn() };
  mockLog.current = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
  mockOpenStudio.mockReset();
  mockOnFix.mockReset();
});

const press = (root: Root, testID: string) => {
  const node = root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  expect(node).toBeDefined();
  act(() => { (node!.props.onPress as () => void)(); });
};

describe("#2830 the setup publish step names every finding", () => {
  it("lists each failing sentence with its page, and counts them as Ari does", () => {
    const root = render(false);
    const text = textOf(root);
    expect(text).toContain("Check: '20' isn't backed by anything in Mingla (Home, Call to action block 2)");
    expect(text).toContain("Check: '30' isn't backed by anything in Mingla (Home, Call to action block 2)");
    expect(text).toContain("A link to check (Settings)");
    // publishFindings / publishFindingsCount: the same words Ari's publish card uses.
    expect(text).toContain("3 things to look at. None of them stops you publishing.");
    expect(text).not.toContain("claims Mingla can");
  });

  it("a warning never turns Publish off: the server never refuses one", () => {
    expect(publishDisabled(render(false))).toBe(false);
    expect(textOf(render(false))).not.toContain("to fix first");
  });

  it("Fix opens the page the finding is on; without a page, its section", () => {
    const root = render(false);
    press(root, "setup-fix-truth-1");
    expect(mockOpenStudio).toHaveBeenCalledWith("page-home");
    press(root, "setup-fix-links-0");
    expect(mockOnFix).toHaveBeenCalledWith("settings");
  });
});
