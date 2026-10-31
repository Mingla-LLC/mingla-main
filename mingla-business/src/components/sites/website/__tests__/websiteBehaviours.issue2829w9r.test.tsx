/*
 * #2829 W9r — the behaviours the old Website screens proved, re-proven on the
 * redesigned sections that replaced them (BrandWebsiteView, SiteLookView,
 * SiteDomains, SitePlanView were removed):
 *  - #2830 terminal publication recovery: last good preserved, an explicit
 *    retry reset only for a retryable verified failure, never for an
 *    ambiguous outcome; the operation's reference on request;
 *  - #2830 state 4: a draft being created shows receipt progress only, and
 *    "Check setup status" after the window for Core's can_create only;
 *  - W9f offline wins over live; A20 export copy and states; owner offline
 *    asks first, online is one step;
 *  - W8 addresses: owner's words, exact records with copy, no provider
 *    names, main address only on a live address, disconnect explanation,
 *    email-records warning, the www offer, read-only below admin;
 *  - A8/W7 the design shows only what it draws (swatches and font slots),
 *    restores its colours, and readability never blocks saving;
 *  - W9a plan: Core's ticks, Ask an admin for owner parts, With Ari saves
 *    active_part at Core's revision before opening Ari, a refusal opens
 *    nothing; a menu that moved ahead of the website asks for a republish
 *    and an absent signal is silence; Change it with Ari on a phone.
 */
import React from "react";

const mockAsk = jest.fn();
const mockMutate = jest.fn();
const mockSaveLook = jest.fn();
const mockPush = jest.fn();
const mockCopy = jest.fn((_value: string) => Promise.resolve());
const mockPlanSave = jest.fn();
const mockDesignSave = jest.fn();
let mockDomains: Record<string, unknown> = {};
let mockLook: Record<string, unknown> = { design: "voyage", tokens: {}, fonts: {}, revision: "r1" };

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: { visible: boolean; onConfirm: () => void; title: string; description?: string; testID?: string }) =>
    props.visible
      ? require("react").createElement("mock-confirm", { testID: props.testID, onPress: props.onConfirm }, props.title, " ", props.description ?? "")
      : null,
}));
jest.mock("../../plan/OfferingsPart", () => ({ OfferingsPart: () => null }));
jest.mock("../../plan/StoryPart", () => ({ StoryPart: () => null }));
jest.mock("../../plan/BuildPart", () => ({ BuildPart: () => null }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("../../../../utils/copyAddressText", () => ({ copyAddressText: (value: string) => mockCopy(value) }));
jest.mock("../../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "b", displayName: "Young & Stamped", theme: null, tagline: "", bio: "" } }),
  useUpdateBrand: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteDomains: () => ({ isLoading: false, isError: false, data: mockDomains, refetch: jest.fn() }),
  useAttachBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useCheckBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useSetPrimaryBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useDetachBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useBrandSiteLook: () => ({ isLoading: false, isError: false, data: mockLook, refetch: jest.fn() }),
  useSaveBrandSiteLook: () => ({ mutate: mockSaveLook, isPending: false }),
  // #2829 W10 — Settings carries the private share-preview card.
  useBrandSiteShareLinks: () => ({ isLoading: false, isError: false, data: [] }),
  useCreateBrandSiteShareLink: () => ({ mutate: jest.fn(), isPending: false }),
  useRevokeBrandSiteShareLink: () => ({ mutate: jest.fn(), isPending: false, variables: undefined }),
}));
jest.mock("../../../../sites/planApi", () => ({
  useSaveBrandSitePlan: () => ({ mutateAsync: mockPlanSave }),
  useSaveBrandSitePlanDesign: () => ({ mutate: mockDesignSave, isPending: false }),
}));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi");
  return {
    ...actual,
    useDraftChanges: () => ({ isLoading: false, isError: false, data: { published_at: "2026-10-26T18:54:00Z", changes: [] } }),
    useContentList: () => ({ isLoading: false, isError: false, data: { entries: [], revision: "x", reordered: false } }),
    useSiteCover: () => ({ isLoading: false, data: { available: false, revision: null, photo: null, video: null } }),
    useSetSiteCover: () => ({ mutate: mockMutate, isPending: false }),
    useFontSearch: () => ({ isLoading: false, isError: false, data: [] }),
    useFontPreviews: () => ({ data: [] }),
    useSiteOverviewCounts: () => ({ isLoading: false, isError: false, data: null }),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { PublishSection } from "../sections/PublishSection";
import { OverviewSection } from "../sections/OverviewSection";
import { SettingsSection } from "../sections/SettingsSection";
import { AddressesSection } from "../sections/AddressesSection";
import { DesignSection } from "../sections/DesignSection";
import { PlanSection, startedByLine } from "../sections/PlanSection";
import { LockBanner } from "../LockBanner";
import { EXPORT_MEDIA_LINKS_NOTE } from "../../../../sites/exportCopy";
import { BrandSitesError } from "../../../../services/brandSitesService";
import type { BrandSiteDomainHost } from "../../../../sites/contracts";
import type { SitePlanState } from "../../../../sites/sitePlanState";

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
const pressable = (root: Root, id: string) => root.findAll((node) => node.props.testID === id && typeof node.props.onPress === "function")[0];
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id).length > 0;
const press = (root: Root, id: string) => {
  const node = pressable(root, id);
  if (!node) throw new Error(`no pressable ${id}`);
  act(() => { (node.props.onPress as () => void)(); });
};

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";
const baseSite = {
  id: SITE_ID, brand_id: "b", renderer_key: "sites-v2", renderer_version: 1, status: "published",
  active_publication_id: "p1", last_successful_publication_id: "p1", provisioning_error_code: null, owner_offline_at: null as string | null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-26T00:00:00Z",
  brand_site_hosts: [{ hostname: "young.sites.usemingla.com", status: "active", is_primary: true, kind: "mingla_subdomain" }],
};

type Over = {
  canPublish?: boolean;
  site?: Record<string, unknown> | null;
  receipt?: Record<string, unknown> | null;
  operation?: boolean;
  exportResult?: Record<string, unknown> | null;
  provisionTimedOut?: boolean;
  phone?: boolean;
  plan?: SitePlanState | null;
};

function context(over: Over = {}): WebsiteContextValue {
  const canPublish = over.canPublish ?? true;
  const site = over.site === null ? null : { ...baseSite, ...(over.site ?? {}) };
  const controller = {
    user: { id: "u1" },
    site: { data: site, isLoading: false, isError: false },
    siteId: site?.id ?? null,
    capabilities: { canPublish, canEdit: true, canCreate: canPublish },
    validation: { data: { site_id: SITE_ID, valid: true, renderer: "x", home_revision: "1", draft_digest: "d".repeat(64), checked_pages: 9 }, isLoading: false, isFetching: false, isError: false, error: null, refetch: jest.fn() },
    versions: { data: [], isLoading: false, refetch: jest.fn() },
    publicationOperation: over.operation ? { operationId: OPERATION_ID, startedAt: Date.now(), kind: "publish" } : null,
    publicationReceipt: { data: over.receipt ?? null },
    publishedJustNow: null,
    publicationPollingTimedOut: false,
    provisionPollingTimedOut: over.provisionTimedOut ?? false,
    isProvisioning: false,
    isPublishing: false,
    isTogglingOffline: false,
    isExporting: false,
    isOpeningStudio: false,
    exportResult: over.exportResult ?? null,
    label: { data: site === null ? { hostname: "young-stamped.sites.usemingla.com" } : undefined },
    notice: null,
    journeyState: 0,
    actions: {
      publish: jest.fn(), rollback: jest.fn(), setOffline: jest.fn(), requestExport: jest.fn(), openUrl: jest.fn(), openStudio: jest.fn(),
      onReconcilePublication: jest.fn(), onResetFailedPublication: jest.fn(), reconcileProvision: jest.fn(), dismissNotice: jest.fn(),
    },
  } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "b", brandName: "Young & Stamped", controller, phone: over.phone ?? false, section: "overview",
    go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: mockAsk, asking: false,
    lock: { heldByOther: false, holderName: null, canTakeOver: canPublish, takeOver: jest.fn(), takingOver: false },
    plan: over.plan ?? null,
    previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations: jest.fn(),
    headingRef: React.createRef(), offerings: ["trips"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  } as WebsiteContextValue;
}

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  // Publishing screens poll on an interval; unmount so nothing keeps running.
  while (mounted.length) act(() => mounted.pop()!.unmount());
});

function render(node: React.ReactElement, over: Over = {}) {
  const value = context(over);
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={value}>{node}</WebsiteProvider></QueryClientProvider>);
  });
  mounted.push(tree);
  return { root: tree.root, value };
}

function host(over: Partial<BrandSiteDomainHost>): BrandSiteDomainHost {
  return {
    id: "h-own", hostname: "youngandstamped.com", kind: "custom_domain", status: "pending", is_primary: false, is_apex: true,
    apex: "youngandstamped.com", dns_state: "pending", tls_state: "pending",
    records: [{ type: "A", name: "youngandstamped.com", value: "203.0.113.7" }, { type: "TXT", name: "_v.youngandstamped.com", value: "verify=abc123" }],
    registrar: "namecheap", mx_missing: false, misconfigured_since: null, redirect_until: null, last_checked_at: null, activated_at: null,
    created_at: "2026-10-26T10:00:00Z", ...over,
  };
}
const SUBDOMAIN = host({ id: "h-sub", hostname: "young-stamped.sites.usemingla.com", kind: "mingla_subdomain", status: "active", is_primary: true, is_apex: false, apex: "usemingla.com", dns_state: "ok", tls_state: "issued", records: [], registrar: null });
const domainsOf = (hosts: BrandSiteDomainHost[], canManage = true) => ({ site_id: SITE_ID, can_manage: canManage, max_custom_domains: 4, hosts });

beforeEach(() => {
  mockAsk.mockClear();
  mockMutate.mockClear();
  mockPush.mockClear();
  mockCopy.mockClear();
  mockPlanSave.mockReset();
  mockDesignSave.mockReset();
  mockDomains = domainsOf([SUBDOMAIN]);
  mockLook = { design: "voyage", tokens: {}, fonts: {}, revision: "r1" };
});

describe("#2830 terminal publication recovery (Publish & history)", () => {
  const failedReceipt = { operation_id: OPERATION_ID, site_id: SITE_ID, kind: "publish", status: "failed", error_code: "PROBE_FAILED", result_summary: { retryable: true } };

  it("a retryable verified failure preserves the last good site and needs an explicit Try again", () => {
    const { root, value } = render(<PublishSection />, { operation: true, receipt: failedReceipt });
    const words = textOf(root);
    expect(words).toContain("Last good preserved");
    expect(has(root, "publish-failed-live")).toBe(true);
    expect(value.controller.actions.onResetFailedPublication).not.toHaveBeenCalled();
    press(root, "publish-reset");
    expect(value.controller.actions.onResetFailedPublication).toHaveBeenCalledTimes(1);
    expect(textOf(root)).not.toContain(OPERATION_ID);
    press(root, "publish-failed-details");
    expect(textOf(root)).toContain(OPERATION_ID);
    expect(textOf(root)).toContain("PROBE_FAILED");
  });

  it("#2829 W11 a FIRST publish that fails: nothing went live, the reason, and Fix with Ari (never 'previous version is still live')", () => {
    const { root } = render(<PublishSection />, { operation: true, receipt: failedReceipt, site: { last_successful_publication_id: null, active_publication_id: null, status: "draft" } });
    const words = textOf(root);
    expect(words).toContain("Nothing went live: your website isn't public yet.");
    expect(words).not.toContain("previous version is still live");
    press(root, "publish-fix-with-ari");
    expect(mockPush).toHaveBeenCalledWith("/brand/b/website/ari");
  });

  it("a non-retryable failure routes to Review fixes, never Try again", () => {
    const { root, value } = render(<PublishSection />, { operation: true, receipt: { ...failedReceipt, result_summary: { retryable: false, reason_code: "PATH_COLLISION" } } });
    expect(has(root, "publish-reset")).toBe(false);
    expect(textOf(root)).toContain("Two parts of your website use the same address.");
    press(root, "publish-review-fixes");
    expect(value.go).toHaveBeenCalledWith({ kind: "section", section: "pages" });
  });

  it("an ambiguous outcome only checks the same operation: no reset, no Review fixes", () => {
    const { root, value } = render(<PublishSection />, { operation: true, receipt: { ...failedReceipt, status: "ambiguous" } });
    expect(has(root, "publish-reset")).toBe(false);
    expect(has(root, "publish-review-fixes")).toBe(false);
    expect(has(root, "publish-progress")).toBe(true);
    press(root, "publish-reconcile");
    expect(value.controller.actions.onReconcilePublication).toHaveBeenCalledTimes(1);
  });

});

describe("#2830 state 4: the draft is being created", () => {
  it("shows receipt progress and no editing, preview, publish or numbers", () => {
    const { root } = render(<OverviewSection />, { site: { status: "provisioning", active_publication_id: null, last_successful_publication_id: null, brand_site_hosts: [] } });
    expect(textOf(root)).toContain("Creating your website draft");
    for (const id of ["overview-preview", "overview-review-publish", "overview-ari", "overview-last-30", "overview-status"]) expect(has(root, id)).toBe(false);
  });

  it("Check setup status appears only after the window, and only for Core's can_create", () => {
    const provisioning = { status: "provisioning", active_publication_id: null, last_successful_publication_id: null, brand_site_hosts: [] };
    expect(has(render(<OverviewSection />, { site: provisioning }).root, "provision-reconcile")).toBe(false);
    const admin = render(<OverviewSection />, { site: provisioning, provisionTimedOut: true });
    press(admin.root, "provision-reconcile");
    expect(admin.value.controller.actions.reconcileProvision).toHaveBeenCalledTimes(1);
    const manager = render(<OverviewSection />, { site: provisioning, provisionTimedOut: true, canPublish: false });
    expect(has(manager.root, "provision-reconcile")).toBe(false);
    expect(textOf(manager.root)).toContain("authoritative setup receipt");
  });
});

describe("W9f offline wins, and owners manage their own website (Settings)", () => {
  it("an offline published site says offline, never live", () => {
    const { root } = render(<OverviewSection />, { site: { owner_offline_at: "2026-10-26T22:41:03Z" } });
    const words = textOf(root);
    expect(words).toContain("Offline since");
    expect(words).toContain("Offline");
    expect(words).not.toMatch(/Live · published/);
    expect(has(root, "offline-banner")).toBe(true);
  });

  it("asks before taking the site offline; bringing it back is one step", () => {
    const { root, value } = render(<SettingsSection />);
    const toggle = pressable(root, "settings-online-toggle") ?? root.findAll((node) => node.props.testID === "settings-online-toggle" && typeof node.props.onValueChange === "function")[0];
    const flip = (online: boolean) => act(() => {
      const props = toggle!.props as { onPress?: () => void; onValueChange?: (v: boolean) => void };
      if (props.onValueChange) props.onValueChange(online); else props.onPress!();
    });
    flip(false);
    expect(value.controller.actions.setOffline).not.toHaveBeenCalled();
    expect(textOf(root)).toContain("Take your website offline?");
    press(root, "settings-offline-confirm");
    expect(value.controller.actions.setOffline).toHaveBeenCalledWith(true);

    const offline = render(<SettingsSection />, { site: { owner_offline_at: "2026-10-26T22:41:03Z" } });
    press(offline.root, "offline-bring-back");
    expect(offline.value.controller.actions.setOffline).toHaveBeenCalledWith(false);
  });

  it("export: the 24-hour note for owners, the file once ready, and a failure says so", () => {
    const owner = render(<SettingsSection />);
    expect(textOf(owner.root)).toContain(EXPORT_MEDIA_LINKS_NOTE);
    const manager = render(<SettingsSection />, { canPublish: false });
    expect(textOf(manager.root)).not.toContain(EXPORT_MEDIA_LINKS_NOTE);
    expect(has(manager.root, "settings-download-button")).toBe(false);
    const ready = render(<SettingsSection />, { exportResult: { status: "succeeded", download_url: "https://example.test/export.zip" } });
    press(ready.root, "settings-get-file");
    expect(ready.value.controller.actions.openUrl).toHaveBeenCalledWith("https://example.test/export.zip");
    expect(textOf(ready.root)).toContain("the link works for 24 hours");
    const failed = render(<SettingsSection />, { exportResult: { status: "failed", download_url: null } });
    expect(textOf(failed.root)).toContain("Mingla couldn't prepare your download. Try again.");
    expect(textOf(failed.root)).not.toContain("Preparing");
  });
});

describe("W8 Addresses", () => {
  it("shows the exact records with copy buttons and the registrar's steps, and never names Mingla's providers", () => {
    mockDomains = domainsOf([SUBDOMAIN, host({})]);
    const { root } = render(<AddressesSection />);
    const words = textOf(root);
    expect(words).toContain("203.0.113.7");
    expect(words).toContain("verify=abc123");
    expect(words).toContain("Waiting for DNS");
    expect(words).toContain("Advanced DNS");
    expect(words).not.toMatch(/vercel|supabase|bunny|payload|neon/i);
    const copy = root.findAll((node) => node.props.accessibilityLabel === "Copy 203.0.113.7" && typeof node.props.onPress === "function")[0]!;
    act(() => { (copy.props.onPress as () => void)(); });
    expect(mockCopy).toHaveBeenCalledWith("203.0.113.7");
  });

  it("offers Make this my main address only on a live address; disconnect explains the 30-day redirect first", () => {
    mockDomains = domainsOf([SUBDOMAIN, host({})]);
    expect(has(render(<AddressesSection />).root, "address-make-main")).toBe(false);
    mockDomains = domainsOf([{ ...SUBDOMAIN, is_primary: false }, host({ status: "active", is_primary: true, dns_state: "ok", tls_state: "issued" })]);
    const { root } = render(<AddressesSection />);
    press(root, "address-disconnect");
    expect(mockMutate).not.toHaveBeenCalled();
    expect(textOf(root)).toContain("young-stamped.sites.usemingla.com becomes your main address immediately. youngandstamped.com will keep redirecting visitors to young-stamped.sites.usemingla.com for 30 days, then disconnect.");
    press(root, "address-disconnect-confirm");
    expect(mockMutate).toHaveBeenCalledWith("h-own", expect.anything());
    mockDomains = domainsOf([SUBDOMAIN, host({ status: "active", dns_state: "ok", tls_state: "issued" })]);
    expect(has(render(<AddressesSection />).root, "address-make-main")).toBe(true);
  });

  it("warns when the email records disappear", () => {
    mockDomains = domainsOf([SUBDOMAIN, host({ status: "active", dns_state: "ok", tls_state: "issued", mx_missing: true })]);
    expect(textOf(render(<AddressesSection />).root)).toContain("Your email records changed. We didn't touch them, but check with your email provider.");
  });

  it("after adding a bare domain, offers www too", () => {
    const { root } = render(<AddressesSection />);
    const input = root.findAll((node) => node.props.testID === "domain-input" && typeof node.props.onChangeText === "function")[0]!;
    act(() => { (input.props.onChangeText as (v: string) => void)("youngandstamped.com"); });
    press(root, "domain-continue");
    const [typed, handlers] = mockMutate.mock.calls[0] as [string, { onSuccess: (result: unknown) => void }];
    expect(typed).toBe("youngandstamped.com");
    act(() => handlers.onSuccess({ host_id: "h-own", hostname: "youngandstamped.com", checked: false, domains: domainsOf([SUBDOMAIN, host({})]) }));
    expect(textOf(root)).toContain("Also add www.youngandstamped.com?");
    press(root, "address-www-add");
    expect(mockMutate.mock.calls[1]![0]).toBe("www.youngandstamped.com");
  });

  it("below brand admin: reads, cannot change anything, can ask an admin", () => {
    mockDomains = domainsOf([SUBDOMAIN, host({ status: "active", dns_state: "ok", tls_state: "issued" })], false);
    const { root } = render(<AddressesSection />, { canPublish: false });
    expect(textOf(root)).toContain("Only brand admins and owners can change addresses");
    for (const id of ["address-make-main", "address-disconnect"]) {
      const node = root.findAll((candidate) => candidate.props.testID === id && candidate.props.accessibilityState !== undefined)[0];
      expect(node === undefined || (node.props.accessibilityState as { disabled?: boolean }).disabled === true).toBe(true);
    }
  });
});

describe("A8 / W7 Website design shows what the design draws", () => {
  const swatchIds = (root: Root) => root.findAll((node) => typeof node.props.testID === "string" && (node.props.testID as string).startsWith("swatch-hex-") && typeof node.props.onBlur === "function")
    .map((node) => (node.props.testID as string).slice("swatch-hex-".length)).filter((id, index, all) => all.indexOf(id) === index);
  const slotIds = (root: Root) => root.findAll((node) => typeof node.props.testID === "string" && (node.props.testID as string).startsWith("font-slot-"))
    .map((node) => node.props.testID as string).filter((id, index, all) => all.indexOf(id) === index);

  it("atelier: six swatches, no Headings or Second accent; Headings and Body text fonts", () => {
    mockLook = { design: "atelier", tokens: {}, fonts: {}, revision: "r1" };
    const { root } = render(<DesignSection />);
    expect(swatchIds(root).sort()).toEqual(["accent", "accent_ink", "canvas", "ink_body", "surface_deep", "surface_sunken"]);
    expect(slotIds(root)).toEqual(["font-slot-display", "font-slot-body"]);
  });

  it("voyage adds Accent lettering with its own default face", () => {
    const { root } = render(<DesignSection />);
    expect(slotIds(root)).toContain("font-slot-accent");
    expect(textOf(root)).toContain("Accent lettering");
  });

  it("restores the design's colours; a readability warning never disables Save", () => {
    const { root, value } = render(<DesignSection />);
    const hex = () => root.findAll((node) => node.props.testID === "swatch-hex-accent_ink" && typeof node.props.onBlur === "function")[0]!;
    act(() => { (hex().props.onChangeText as (v: string) => void)("#9a8f6a"); });
    act(() => { (hex().props.onBlur as () => void)(); });
    expect(has(root, "readability-accent_ink")).toBe(true);
    const bars = (value.setStickyBar as jest.Mock).mock.calls.map((call) => call[0]).filter(Boolean);
    const save = (bars.at(-1)?.actions as { testID: string; disabled?: boolean }[] | undefined)?.find((action) => action.testID === "design-save");
    expect(save).toBeDefined();
    expect(save!.disabled ?? false).toBe(false);
    press(root, "colours-restore");
    expect(has(root, "readability-accent_ink")).toBe(false);
  });
});

describe("W9a Setup plan", () => {
  const plan = (canManage: boolean, over: Partial<SitePlanState> = {}): SitePlanState => ({
    canManage,
    doneCount: 3,
    parts: [
      { key: "offer", done: true, skipped: false, optional: false },
      { key: "brand", done: true, skipped: false, optional: false },
      { key: "look", done: true, skipped: false, optional: false },
      { key: "story", done: false, skipped: false, optional: false },
      { key: "approve", done: false, skipped: false, optional: false },
      { key: "build", done: false, skipped: false, optional: false },
      { key: "first_offering", done: false, skipped: false, optional: true },
      { key: "publish", done: false, skipped: false, optional: false },
    ],
    plan: { revision: 7, skippedParts: [] },
    site: null,
    ...over,
  } as unknown as SitePlanState);

  it("shows Core's ticks; owner parts ask an admin for a marketing manager", () => {
    const { root } = render(<PlanSection part={null} planState={plan(false)} />, { canPublish: false });
    expect(textOf(root)).toContain("3 of 8 done");
    for (const key of ["approve", "build", "publish"]) {
      press(root, `plan-ask-${key}`);
    }
    expect(mockAsk).toHaveBeenCalledWith("plan");
    expect(has(root, "plan-ari-approve")).toBe(false);
    expect(has(root, "plan-ari-story")).toBe(true);
  });

  it("part 7 is marked optional; while someone else holds the lock, or Mingla paused the site, nothing can be changed", () => {
    const open = render(<PlanSection part={null} planState={plan(true)} />);
    expect(textOf(open.root)).toContain("Optional");
    expect(has(open.root, "plan-self-story")).toBe(true);
    const locked = context();
    (locked.lock as { heldByOther: boolean }).heldByOther = true;
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={locked}><PlanSection part={null} planState={plan(true)} /></WebsiteProvider></QueryClientProvider>); });
    mounted.push(tree);
    expect(has(tree.root, "plan-self-story")).toBe(false);
    expect(has(tree.root, "plan-ari-story")).toBe(false);
    const paused = render(<PlanSection part={null} planState={plan(true, { site: { id: "s", status: "suspended", designKey: null, published: false, paused: true } } as Partial<SitePlanState>)} />);
    expect(textOf(paused.root)).toContain("Mingla has paused your website, so the plan is paused too.");
    expect(has(paused.root, "plan-self-story")).toBe(false);
  });

  it("With Ari saves active_part at Core's revision, then opens Ari; a refusal says why and opens nothing", async () => {
    mockPlanSave.mockResolvedValueOnce({});
    const { root, value } = render(<PlanSection part={null} planState={plan(true)} />);
    await act(async () => { (pressable(root, "plan-ari-story")!.props.onPress as () => void)(); });
    expect(mockPlanSave).toHaveBeenCalledWith({ revision: 7, patch: { active_part: "story" } });
    expect(mockPush).toHaveBeenCalledWith("/brand/b/website/ari?intent=setup&part=story");
    mockPush.mockClear();
    mockPlanSave.mockRejectedValueOnce(new BrandSitesError("REVISION_CONFLICT", "Someone else changed the plan. Here is the latest.", false));
    await act(async () => { (pressable(root, "plan-ari-build")!.props.onPress as () => void)(); });
    expect(mockPush).not.toHaveBeenCalled();
    expect(value.toast).toHaveBeenCalledWith("Someone else changed the plan. Here is the latest.", "error");
  });

  it("shows field-level gaps with both Ari-owned and self-service paths", async () => {
    mockPlanSave.mockResolvedValueOnce({});
    const state = plan(true, {
      completeness: {
        revision: 7,
        designKey: "voyage",
        fields: [
          { key: "contact_phone", label: "Contact phone", group: "Contact", requirement: "recommended", state: "invalid", value: "555", sourceType: "owner", sourceRef: null, sourceUrl: null, observedAt: null, ownerConfirmedAt: null, exceptionReason: null, humanActionRequired: false },
          { key: "cover_media", label: "Cover media", group: "Media", requirement: "recommended", state: "missing", value: null, sourceType: null, sourceRef: null, sourceUrl: null, observedAt: null, ownerConfirmedAt: null, exceptionReason: null, humanActionRequired: true },
        ],
        requiredGapCount: 0,
        recommendedGapCount: 2,
        gapCount: 2,
        verifiedCount: 15,
        exceptionCount: 0,
        minimumComplete: true,
        contextComplete: false,
        checkedAt: "2026-10-30T22:00:00Z",
      },
    });
    const { root } = render(<PlanSection part={null} planState={state} />);
    expect(has(root, "plan-context-gaps")).toBe(true);
    expect(has(root, "plan-gaps-ari")).toBe(true);
    expect(has(root, "plan-gaps-self")).toBe(true);
    press(root, "plan-see-gaps");
    expect(textOf(root)).toContain("needs your upload");
    press(root, "plan-gaps-self");
    expect(mockPush).toHaveBeenCalledWith("/brand/b/edit");
    await act(async () => { (pressable(root, "plan-gaps-ari")!.props.onPress as () => void)(); });
    expect(mockPlanSave).toHaveBeenCalledWith({ revision: 7, patch: { active_part: "brand" } });
    expect(mockPush).toHaveBeenCalledWith("/brand/b/website/ari?intent=setup&part=brand");
  });

  it("chooses a design in the shared plan before any site exists", () => {
    const state = plan(true, {
      doneCount: 2,
      plan: { revision: 7, designKey: null, skippedParts: [] } as unknown as SitePlanState["plan"],
      site: null,
    });
    const { root } = render(<PlanSection part="look" planState={state} />);
    expect(has(root, "plan-design-part")).toBe(true);
    expect(textOf(root)).toContain("No draft yet");
    press(root, "plan-design-voyage");
    press(root, "plan-design-save");
    expect(mockDesignSave).toHaveBeenCalledWith(
      { revision: 7, designKey: "voyage" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});

describe("#2829 W11 one plan per brand: who started it, who is working on it", () => {
  const planBy = (over: Record<string, unknown>, canManage = true): SitePlanState => ({
    canManage,
    doneCount: 3,
    parts: [
      { key: "offer", done: true, skipped: false, optional: false },
      { key: "brand", done: true, skipped: false, optional: false },
      { key: "look", done: true, skipped: false, optional: false },
      { key: "story", done: false, skipped: false, optional: false },
      { key: "approve", done: false, skipped: false, optional: false },
      { key: "build", done: false, skipped: false, optional: false },
      { key: "first_offering", done: false, skipped: false, optional: true },
      { key: "publish", done: false, skipped: false, optional: false },
    ],
    plan: { revision: 7, skippedParts: [], startedAt: "2026-10-03T09:00:00Z", startedByMe: false, startedByName: "Ama", ...over },
    site: null,
  } as unknown as SitePlanState);

  it("another admin opening the plan sees who started it and when, and continues at the next part", () => {
    const { root, value } = render(<PlanSection part={null} planState={planBy({})} />);
    expect(textOf(root)).toContain("Ama started this on 3 Oct. Continue?");
    expect(textOf(root)).toContain("Next: Your story");
    press(root, "plan-started-continue");
    expect(value.go).toHaveBeenCalledWith({ kind: "section", section: "plan", planPart: "story" });
  });

  it("says nothing to the person who started it, on a live site, or once every part is done", () => {
    expect(startedByLine(planBy({ startedByMe: true }), false)).toBeNull();
    expect(startedByLine(planBy({}), true)).toBeNull();
    const done = planBy({});
    (done as { doneCount: number }).doneCount = 8;
    expect(startedByLine(done, false)).toBeNull();
    expect(has(render(<PlanSection part={null} planState={planBy({ startedByMe: true })} />).root, "plan-started-by")).toBe(false);
  });

  it("a starter with no name on file (Core sends null) reads as A teammate, never a blank", () => {
    expect(startedByLine(planBy({ startedByName: null }), false)).toBe("A teammate started this on 3 Oct. Continue?");
  });

  it("a marketing manager sees who started it but no Continue into an owner part", () => {
    const owners = planBy({}, false);
    (owners as { parts: { key: string; done: boolean }[] }).parts = owners.parts.map((part) => ({ ...part, done: part.key !== "approve" && part.key !== "build" && part.key !== "publish" }));
    const { root } = render(<PlanSection part={null} planState={owners} />, { canPublish: false });
    expect(has(root, "plan-started-by")).toBe(true);
    expect(has(root, "plan-started-continue")).toBe(false);
  });

  it("two admins at once: the second sees who is working right now, with Take over", () => {
    const value = context();
    const takeOver = jest.fn();
    Object.assign(value.lock, { heldByOther: true, holderName: "Ama", canTakeOver: true, takeOver });
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={value}><LockBanner section="plan" /></WebsiteProvider></QueryClientProvider>); });
    mounted.push(tree);
    expect(textOf(tree.root)).toContain("Ama is working on the setup plan right now");
    expect(textOf(tree.root)).toContain("nothing Ama has saved is lost");
    press(tree.root, "lock-takeover");
    expect(takeOver).toHaveBeenCalled();
  });

  it("a nameless holder (Core sends null) and a member who can't take over", () => {
    const value = context({ canPublish: false });
    Object.assign(value.lock, { heldByOther: true, holderName: null, canTakeOver: false });
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={value}><LockBanner section="design" /></WebsiteProvider></QueryClientProvider>); });
    mounted.push(tree);
    expect(textOf(tree.root)).toContain("A teammate is changing your website design right now");
    expect(textOf(tree.root)).toContain("until they finish or you take over");
    expect(textOf(tree.root)).toContain("Only admins can take over");
    expect(has(tree.root, "lock-takeover")).toBe(false);
  });
});

describe("Overview signals", () => {
  it("before a website exists: the plan, the proposed address, and nothing that claims it is live", () => {
    const { root } = render(<OverviewSection />, { site: null, plan: { doneCount: 2, parts: [] } as unknown as SitePlanState });
    expect(has(root, "website-no-site")).toBe(true);
    expect(textOf(root)).toContain("Address · young-stamped.sites.usemingla.com");
    expect(textOf(root)).not.toMatch(/remains live|is live|Live ·/i);
  });

  it("asks for a republish when Mingla's offerings moved ahead of the website; absent or false is silence", () => {
    expect(textOf(render(<OverviewSection />, { site: { menu_changed_since_publish: true } }).root)).toContain("Your trips changed in Mingla");
    expect(textOf(render(<OverviewSection />, { site: { menu_changed_since_publish: false } }).root)).not.toContain("changed in Mingla");
    expect(textOf(render(<OverviewSection />).root)).not.toContain("changed in Mingla");
  });

  it("Change it with Ari is offered on a phone too", () => {
    expect(has(render(<OverviewSection />, { phone: true }).root, "overview-ari")).toBe(true);
  });
});

describe("Core's capabilities, never a local role copy", () => {
  it("the Website section reads no client-side role and shows nothing to a member Core gives no capability", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const dir = path.resolve(__dirname, "..");
    const files = [
      "useWebsiteController.ts", "WebsiteApp.tsx",
      ...fs.readdirSync(path.join(dir, "sections")).map((name: string) => `sections/${name}`),
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source).not.toMatch(/useCurrentBrandRole|Journey state|rank\s*[-:=]\s*10/);
    }
    expect(fs.readFileSync(path.join(dir, "WebsiteApp.tsx"), "utf8"))
      .toContain("if (!props.capabilities.canEdit && !canPublish && !canProvision) return null;");
  });
});
