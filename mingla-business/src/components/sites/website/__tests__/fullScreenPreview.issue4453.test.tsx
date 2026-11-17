/*
 * #4453 M8 (spec v2 §7) — the full-screen real preview:
 *  - the slim bar: Back to editing, the brand, Share private link (disabled with
 *    no draft; a marketing manager is told why);
 *  - Desktop / Tablet / Phone frames at 1440 / 820 / 390, rotate, and every state
 *    of the preview: no draft yet, loading, error with retry, ready;
 *  - the share-link flow: create (1, 7 or 14 days) → address shown once with Copy
 *    and Share, list working / expired / turned-off links, Turn off asks first,
 *    list loading and error with retry, and "no links yet";
 *  - the share sheet dismisses (close button), and Draft chips never appear.
 */
import React from "react";

const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockCopy = jest.fn((_value: string) => Promise.resolve());
const mockShare = jest.fn(async (_content: unknown, _options?: unknown) => ({ action: "sharedAction" }));
const mockRefetch = jest.fn();
let mockLinks: unknown[] = [];
let mockLinksState: { isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string }) =>
    props.visible ? require("react").createElement("mock-sheet", { testID: props.testID, onClose: props.onClose }, props.children) : null,
}));
jest.mock("../../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: { visible: boolean; onConfirm: () => void; title: string; testID?: string }) =>
    props.visible ? require("react").createElement("mock-confirm", { testID: props.testID, onPress: props.onConfirm }, props.title) : null,
}));
jest.mock("../../../../utils/copyAddressText", () => ({ copyAddressText: (value: string) => mockCopy(value) }));
jest.mock("../../../../utils/shareLinkAddress", () => ({ shareLinkAddress: (url: string, brand: string) => mockShare({ url, brand }) }));
jest.mock("../preview/ScaledPreviewFrame", () => ({
  ScaledPreviewFrame: (props: { url: string; preference: { device: string } }) =>
    require("react").createElement("mock-frame", { testID: "scaled-frame", url: props.url, device: props.preference.device }),
}));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteShareLinks: () => ({ ...mockLinksState, data: mockLinksState.isError || mockLinksState.isLoading ? undefined : mockLinks, refetch: mockRefetch }),
  useCreateBrandSiteShareLink: () => ({ mutate: mockCreate, isPending: false }),
  useRevokeBrandSiteShareLink: () => ({ mutate: mockRevoke, isPending: false, variables: undefined }),
}));

import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { FullScreenPreviewBar } from "../preview/FullScreenPreviewBar";
import { SitePreviewPanel, type PreviewGrantState } from "../preview/SitePreviewPanel";
import { previewDimensions, type PreviewDevicePreference } from "../../../../sites/previewDevice";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };

const textOf = (root: Root): string =>
  root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
    .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
const has = (root: Root, id: string): boolean =>
  root.findAll((node) => node.props.testID === id && (id !== "preview-share-sheet" || node.type === "mock-sheet")).length > 0;
const press = (root: Root, id: string): void => {
  const node = root.findAll((candidate) => candidate.props.testID === id && typeof candidate.props.onPress === "function")[0];
  if (!node) throw new Error(`no pressable ${id}`);
  act(() => { (node.props.onPress as () => void)(); });
};

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const toast = jest.fn();

function context(canPublish: boolean): WebsiteContextValue {
  const controller = {
    user: { id: "u1" },
    siteId: SITE_ID,
    capabilities: { canPublish, canEdit: true, canCreate: canPublish },
  } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "b", brandName: "Young & Stamped", controller, phone: false, section: "overview",
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
  [mockCreate, mockRevoke, mockCopy, mockShare, mockRefetch, toast].forEach((fn) => fn.mockClear());
  mockLinks = [];
  mockLinksState = { isLoading: false, isError: false };
});

function render(node: React.ReactElement, canPublish = true): Root {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<WebsiteProvider value={context(canPublish)}>{node}</WebsiteProvider>); });
  mounted.push(tree);
  return tree.root;
}

const bar = (props: Partial<React.ComponentProps<typeof FullScreenPreviewBar>> = {}) =>
  <FullScreenPreviewBar brandName="Young & Stamped" onClose={jest.fn()} canShare shareReady {...props} />;

const LINK = {
  id: "33333333-3333-4333-8333-333333333333", created_at: "2026-10-26T10:00:00Z", expires_at: "2026-11-02T10:00:00Z",
  revoked_at: null, last_viewed_at: "2026-10-27T09:00:00Z", view_count: 2, created_by_name: "Ada", state: "active",
};

describe("#4453 M8 full-screen preview bar", () => {
  it("names the brand, goes back to editing, and carries no Draft chip", () => {
    const onClose = jest.fn();
    const root = render(bar({ onClose }));
    const words = textOf(root);
    expect(words).toContain("Back to editing");
    expect(words).toContain("Draft preview");
    expect(words).toContain("Young & Stamped");
    expect(words).not.toMatch(/Draft ·|Draft tag/);
    press(root, "preview-back");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Share private link is disabled until a draft exists, then opens a sheet that closes", () => {
    const off = render(bar({ shareReady: false }));
    const button = off.findAll((node) => node.props.testID === "preview-share")[0]!;
    expect(button.props.disabled).toBe(true);
    const root = render(bar());
    expect(has(root, "preview-share-sheet")).toBe(false);
    press(root, "preview-share");
    expect(has(root, "preview-share-sheet")).toBe(true);
    expect(has(root, "share-create")).toBe(true);
    press(root, "preview-share-close");
    expect(has(root, "preview-share-sheet")).toBe(false);
  });

  it("a marketing manager is told why, with no controls", () => {
    const root = render(bar({ canShare: false }), false);
    press(root, "preview-share");
    expect(has(root, "preview-share-no-permission")).toBe(true);
    expect(has(root, "share-create")).toBe(false);
  });
});

describe("#4453 M8 share-link flow in the sheet", () => {
  const open = (canPublish = true): Root => {
    const root = render(bar({ canShare: canPublish }), canPublish);
    press(root, "preview-share");
    return root;
  };

  it("makes a link for the chosen days; the address is shown once with Copy and Share", async () => {
    const root = open();
    press(root, "share-ttl-14");
    press(root, "share-create");
    expect(mockCreate.mock.calls[0][0]).toBe(14);
    const url = "https://young.sites.usemingla.com/preview/share/" + "a".repeat(43);
    act(() => { mockCreate.mock.calls[0][1].onSuccess({ id: LINK.id, created_at: LINK.created_at, expires_at: LINK.expires_at, url, preview_ready: true }); });
    expect(textOf(root)).toContain(url);
    expect(textOf(root)).toContain("Mingla shows this link only once");
    press(root, "share-copy");
    expect(mockCopy).toHaveBeenCalledWith(url);
    await act(async () => { press(root, "share-send"); });
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockShare.mock.calls[0][0])).toContain(url);
  });

  it("a failed create says so in the owner's words", () => {
    const root = open();
    press(root, "share-create");
    act(() => { mockCreate.mock.calls[0][1].onError(new Error("boom")); });
    expect(toast).toHaveBeenCalledWith("Mingla couldn’t make a preview link. Try again.", "error");
  });

  it("lists working links to turn off, and shows expired and turned-off links as ended", () => {
    mockLinks = [
      LINK,
      { ...LINK, id: "44444444-4444-4444-8444-444444444444", state: "expired", expires_at: "2026-10-20T10:00:00Z" },
      { ...LINK, id: "55555555-5555-4555-8555-555555555555", state: "revoked", revoked_at: "2026-10-26T12:00:00Z" },
    ];
    const root = open();
    expect(has(root, `share-revoke-${LINK.id}`)).toBe(true);
    expect(has(root, "share-revoke-44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(has(root, "share-ended-44444444-4444-4444-8444-444444444444")).toBe(true);
    const words = textOf(root);
    expect(words).toContain("opened 2 times");
    expect(words).toContain("ended");
    expect(words).toContain("turned off");
    press(root, `share-revoke-${LINK.id}`);
    expect(mockRevoke).not.toHaveBeenCalled();
    press(root, "share-revoke-confirm");
    expect(mockRevoke).toHaveBeenCalledWith(LINK.id, expect.any(Object));
    act(() => { mockRevoke.mock.calls[0][1].onSuccess(); });
    expect(toast).toHaveBeenCalledWith("Link turned off", "success");
  });

  it("every list state: none yet, loading, error with retry", () => {
    const empty = open();
    expect(has(empty, "share-links-empty")).toBe(true);
    mockLinksState = { isLoading: true, isError: false };
    const loading = open();
    expect(has(loading, "share-links-empty")).toBe(false);
    mockLinksState = { isLoading: false, isError: true };
    const failed = open();
    expect(textOf(failed)).toContain("couldn't be loaded");
    press(failed, "share-links-retry");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("#4453 M8 preview frames and states", () => {
  const ready: PreviewGrantState = { kind: "ready", previewUrl: "https://studio.example/preview?token=t", siteId: SITE_ID, pages: [] };
  const panel = (grant: PreviewGrantState, preference: PreviewDevicePreference, onPreference = jest.fn()) =>
    <SitePreviewPanel grant={grant} preference={preference} onPreference={onPreference} purpose="Your draft" onOpenFullScreen={jest.fn()} variant="full" />;
  const desktop: PreviewDevicePreference = { device: "desktop", tablet: "portrait", phone: "portrait" };

  it("Desktop, Tablet and Phone switch the frame at 1440, 820 and 390 wide, and rotate swaps", () => {
    expect(previewDimensions(desktop).width).toBe(1440);
    expect(previewDimensions({ ...desktop, device: "tablet" }).width).toBe(820);
    expect(previewDimensions({ ...desktop, device: "phone" }).width).toBe(390);
    expect(previewDimensions({ ...desktop, device: "phone", phone: "landscape" }).width).toBe(844);
    const onPreference = jest.fn();
    const root = render(panel(ready, desktop, onPreference));
    expect(root.findAll((n) => n.props.testID === "scaled-frame")[0]!.props.device).toBe("desktop");
    press(root, "preview-device-tablet");
    expect(onPreference).toHaveBeenLastCalledWith({ ...desktop, device: "tablet" });
    press(root, "preview-device-phone");
    expect(onPreference).toHaveBeenLastCalledWith({ ...desktop, device: "phone" });
    const phone = render(panel(ready, { ...desktop, device: "phone" }, onPreference));
    press(phone, "preview-rotate");
    expect(onPreference).toHaveBeenLastCalledWith({ ...desktop, device: "phone", phone: "landscape" });
    expect(textOf(phone)).toContain("390 × 844 · portrait");
  });

  it("no draft yet, loading and error each say what is happening; error can retry", () => {
    expect(textOf(render(panel({ kind: "nodraft" }, desktop)))).toContain("Your preview appears here once the draft exists");
    const loading = render(panel({ kind: "loading" }, desktop));
    expect(loading.findAll((n) => n.props.accessibilityLabel === "Making your private preview").length).toBeGreaterThan(0);
    const onRetry = jest.fn();
    const failed = render(panel({ kind: "error", onRetry }, desktop));
    expect(textOf(failed)).toContain("We couldn't load the preview");
    press(failed, "preview-retry");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
