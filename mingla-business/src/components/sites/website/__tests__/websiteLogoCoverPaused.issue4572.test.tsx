/*
 * #4572 — the Host website parts of items 8, 15 and 16.
 *  - item 15: the setup step "Check and publish" says "Publishing is paused
 *    for a few minutes" while Core pauses a FIRST Go live, and Publish waits;
 *    a site that has published before is never paused here;
 *  - item 16: Design has a Logo row: choose, replace or remove; it saves
 *    { logo } to the draft and nothing else;
 *  - item 8: Add section never offers a Cover the server would refuse, and
 *    says why in one line.
 * FAILS-ON-REVERT: without the pause read the setup step shows Publish enabled
 * and no banner; without LogoCard there is no "design-logo" row.
 */
import React from "react";

const mockPaused = { paused: false, refetch: jest.fn() };
const mockSaveLogo = jest.fn();
const mockPicked: { onPick: ((picked: { id: string; thumb_url: string | null }) => void) | null } = { onPick: null };

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../../sites/usePublishingPaused", () => ({ usePublishingPaused: (_site: unknown, firstPublish: boolean) => ({ paused: firstPublish && mockPaused.paused, refetch: mockPaused.refetch }) }));
jest.mock("../../../../hooks/useBrandSite", () => ({ useSaveBrandSiteLogo: () => ({ mutate: mockSaveLogo, isPending: false }) }));
jest.mock("../PhotoField", () => ({
  PhotoChooser: (props: { visible: boolean; onPick: (picked: { id: string; thumb_url: string | null }) => void }) => {
    if (props.visible) mockPicked.onPick = props.onPick;
    return null;
  },
}));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi");
  return {
    ...actual,
    useDraftChanges: () => ({ isLoading: false, isError: false, data: { published_at: null, changes: [] } }),
    useDesignChecks: () => ({ data: { draft_digest: "d".repeat(64), warning_count: 0, ran_at: "2026-11-23T10:00:00Z", checks: [] }, isFetching: false, isError: false, isLoading: false, refetch: jest.fn() }),
    useWorkLog: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
    useSitePages: () => ({ data: { revision: "r", wordmark: null, footer_links: [], pages: [] } }),
    useReviewStatus: () => ({ data: undefined }),
    useMediaLibrary: () => ({ data: [{ id: "logo-1", filename: "kolanut-logo-white.png", width: 400, height: 400, thumb_url: "https://thumbs.test/logo" }] }),
  };
});
jest.mock("../sections/DraftReviewCard", () => ({ DraftReviewCard: () => null, sectionName: () => "" }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { PublishSection } from "../sections/PublishSection";
import { LogoCard } from "../sections/DesignSection";
import { offeredSections } from "../../../../sites/contentApi";

const mockOpenStudio = jest.fn();

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };
const textOf = (root: Root): string => root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
  .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id).length > 0;
const press = (root: Root, testID: string) => {
  const node = root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  if (!node) throw new Error(`no pressable ${testID}`);
  act(() => { (node.props.onPress as () => void)(); });
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


const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) act(() => mounted.pop()!.unmount()); });
beforeEach(() => {
  mockPaused.paused = false;
  mockPaused.refetch.mockReset();
  mockSaveLogo.mockReset();
  mockPicked.onPick = null;
});

function render(node: React.ReactElement, published = false) {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={context(published)}>{node}</WebsiteProvider></QueryClientProvider>); });
  mounted.push(tree);
  return tree.root;
}
const publishButton = (root: Root) => root.findAll((node) => node.props.testID === "publish-button" && typeof node.props.onPress === "function")[0]!;

describe("#4572 item 15 — Check and publish while publishing is paused", () => {
  it("says it is paused, keeps Publish off, and Check again reads the pause again", () => {
    mockPaused.paused = true;
    const root = render(<PublishSection variant="setup" />);
    expect(has(root, "setup-publishing-paused")).toBe(true);
    expect(textOf(root)).toContain("Publishing is paused for a few minutes");
    expect(textOf(root)).toContain("Mingla is finishing a routine safety backup. Your draft is saved and nothing is lost. Try again shortly.");
    expect(publishButton(root).props.disabled).toBe(true);
    press(root, "setup-publishing-paused-retry");
    expect(mockPaused.refetch).toHaveBeenCalledTimes(1);
  });

  it("not paused: no banner and Publish is on", () => {
    const root = render(<PublishSection variant="setup" />);
    expect(has(root, "setup-publishing-paused")).toBe(false);
    expect(publishButton(root).props.disabled).toBe(false);
  });

  it("a site that has published before is never paused here", () => {
    mockPaused.paused = true;
    const root = render(<PublishSection variant="setup" />, true);
    expect(has(root, "setup-publishing-paused")).toBe(false);
  });
});

describe("#4572 item 16 — the Logo row", () => {
  it("no logo: says the name is shown, and choosing one saves only the logo", () => {
    const root = render(<LogoCard brandId="b" siteId="s" logoMediaId={null} revision="r1" disabled={false} />);
    expect(has(root, "design-logo-none")).toBe(true);
    expect(textOf(root)).toContain("No logo · your site’s name is shown");
    press(root, "logo-choose");
    act(() => mockPicked.onPick!({ id: "logo-1", thumb_url: null }));
    expect(mockSaveLogo).toHaveBeenCalledWith({ revision: "r1", logoMediaId: "logo-1" }, expect.anything());
  });

  it("with a logo: Replace and Remove; Remove saves null", () => {
    const root = render(<LogoCard brandId="b" siteId="s" logoMediaId="logo-1" revision="r2" disabled={false} />);
    expect(has(root, "design-logo-set")).toBe(true);
    expect(textOf(root)).toContain("Replace logo");
    press(root, "logo-remove");
    expect(mockSaveLogo).toHaveBeenCalledWith({ revision: "r2", logoMediaId: null }, expect.anything());
  });

  it("read-only: nothing can be changed", () => {
    const root = render(<LogoCard brandId="b" siteId="s" logoMediaId="logo-1" revision="r2" disabled />);
    const choose = root.findAll((node) => node.props.testID === "logo-choose" && typeof node.props.onPress === "function")[0]!;
    expect(choose.props.disabled).toBe(true);
  });
});

describe("#4572 item 8 — Add section never offers a Cover the server refuses", () => {
  const cover = { type: "hero", label: "Cover", description: "A photo or video across the top of Home. Needs a photo.", needs_photo: true };
  const faq = { type: "faq", label: "Questions", description: "Q and A.", needs_photo: false };
  it("keeps the server's list and reason as they are", () => {
    expect(offeredSections({ types: [cover, faq], coverNote: null }, [])).toEqual({ types: [cover, faq], coverNote: null });
    expect(offeredSections({ types: [faq], coverNote: "A cover can only go at the top of Home." }, [])).toEqual({ types: [faq], coverNote: "A cover can only go at the top of Home." });
  });
  it("a page that already has a cover never lists one, and says where to change it (an older Studio lists it everywhere)", () => {
    expect(offeredSections({ types: [faq, cover], coverNote: null }, [{ type: "hero" }])).toEqual({ types: [faq], coverNote: "Home already has a cover. Change it in Design → Cover." });
  });
});
