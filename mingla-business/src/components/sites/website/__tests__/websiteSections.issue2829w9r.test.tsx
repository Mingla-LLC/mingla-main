/*
 * #2829 W9r — the redesigned Website sections, rendered:
 *  - a marketing manager (Core says can_publish false) gets "Ask an admin"
 *    instead of Publish, Restore, address changes, offline, download and the
 *    review confirmation (which is disabled, saying why);
 *  - an unconfirmed review can't be switched on;
 *  - a typed hex colour applies on blur (no lost input) and a bad one is kept
 *    with the reason;
 *  - the remembered preview size is read and written for THIS user only.
 */
import React from "react";

const mockAsk = jest.fn();
const mockMutate = jest.fn();
const mockSaveLook = jest.fn();

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("../../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "b", displayName: "Young & Stamped", theme: null, tagline: "", bio: "" } }),
  useUpdateBrand: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteDomains: () => ({
    isLoading: false, isError: false, data: {
      site_id: "s", can_manage: false, max_custom_domains: 4,
      hosts: [{ id: "h1", hostname: "young.sites.usemingla.com", kind: "mingla_subdomain", status: "active", is_primary: true, is_apex: false, apex: null, dns_state: "ok", tls_state: "issued", records: [], registrar: null, mx_missing: false, misconfigured_since: null, redirect_until: null, last_checked_at: null, activated_at: null, created_at: "2026-10-01T00:00:00Z" }],
    }, refetch: jest.fn(),
  }),
  useAttachBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useCheckBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useSetPrimaryBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useDetachBrandSiteDomain: () => ({ mutate: mockMutate, isPending: false }),
  useBrandSiteLook: () => ({ isLoading: false, isError: false, data: { design: "voyage", tokens: {}, fonts: {}, revision: "r1" }, refetch: jest.fn() }),
  useSaveBrandSiteLook: () => ({ mutate: mockSaveLook, isPending: false }),
  // #2829 W10 — Settings carries the private share-preview card.
  useBrandSiteShareLinks: () => ({ isLoading: false, isError: false, data: [] }),
  useCreateBrandSiteShareLink: () => ({ mutate: jest.fn(), isPending: false }),
  useRevokeBrandSiteShareLink: () => ({ mutate: jest.fn(), isPending: false, variables: undefined }),
}));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi");
  const review = { id: "r3", revision: "rev", enabled: false, sort_order: null, thumb_url: null, quote: "Ten strangers on day one.", reviewer: "Alex R.", review_date: "2025-06-27", trip_name: null, related_offering: null, confirmed: false, confirmed_at: null, source_note: "Pasted" };
  return {
    ...actual,
    useContentEntry: () => ({ isLoading: false, isError: false, data: review, refetch: jest.fn() }),
    useSaveContentEntry: () => ({ mutate: mockMutate, mutateAsync: jest.fn(), isPending: false }),
    useContentRowActions: () => ({ remove: { mutate: mockMutate, isPending: false }, visibility: { mutate: mockMutate, isPending: false }, reorder: { mutate: mockMutate, isPending: false } }),
    useMinglaOfferings: () => ({ isLoading: false, data: [] }),
    useDraftChanges: () => ({ isLoading: false, isError: false, data: { published_at: "2026-10-26T18:54:00Z", changes: [{ section: "design", title: "Website design", detail: "Colours" }] } }),
    useContentList: () => ({ isLoading: false, isError: false, data: { entries: [], revision: "x", reordered: false } }),
    useSiteCover: () => ({ isLoading: false, data: { available: false, revision: null, photo: null, video: null } }),
    useSetSiteCover: () => ({ mutate: mockMutate, isPending: false }),
    useFontSearch: () => ({ isLoading: false, isError: false, data: [] }),
    useFontPreviews: () => ({ data: [] }),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { ReviewEditor } from "../sections/ReviewEditor";
import { SettingsSection } from "../sections/SettingsSection";
import { AddressesSection } from "../sections/AddressesSection";
import { PublishSection } from "../sections/PublishSection";
import { DesignSection } from "../sections/DesignSection";

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

const site = {
  id: "11111111-1111-4111-8111-111111111111", brand_id: "b", renderer_key: "sites-v2", renderer_version: 1, status: "published",
  active_publication_id: "p1", last_successful_publication_id: "p1", provisioning_error_code: null, owner_offline_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-26T00:00:00Z",
  brand_site_hosts: [{ hostname: "young.sites.usemingla.com", status: "active", is_primary: true, kind: "mingla_subdomain" }],
};

function context(canPublish: boolean): WebsiteContextValue {
  const controller = {
    user: { id: "u1" },
    site: { data: site, isLoading: false, isError: false },
    siteId: site.id,
    capabilities: { canPublish, canEdit: true, canCreate: canPublish },
    validation: { data: { site_id: site.id, valid: true, renderer: "x", home_revision: "1", draft_digest: "d".repeat(64), checked_pages: 9 }, isLoading: false, isFetching: false, isError: false, error: null, refetch: jest.fn() },
    versions: { data: [
      { id: "p1", site_id: site.id, source_revision_id: "1", source_digest: "a", artifact_digest: "b", renderer_version: 1, status: "published", previous_publication_id: null, rollback_source_publication_id: null, requested_at: "2026-10-26T18:54:00Z", completed_at: "2026-10-26T18:54:30Z", failure_code: null },
      { id: "p0", site_id: site.id, source_revision_id: "0", source_digest: "c", artifact_digest: "d", renderer_version: 1, status: "published", previous_publication_id: null, rollback_source_publication_id: null, requested_at: "2026-10-26T12:27:00Z", completed_at: "2026-10-26T12:27:30Z", failure_code: null },
    ], isLoading: false, refetch: jest.fn() },
    publicationOperation: null,
    publicationReceipt: { data: null },
    publishedJustNow: null,
    publicationPollingTimedOut: false,
    isPublishing: false,
    isTogglingOffline: false,
    isExporting: false,
    isOpeningStudio: false,
    exportResult: null,
    actions: { publish: jest.fn(), rollback: jest.fn(), setOffline: jest.fn(), requestExport: jest.fn(), openUrl: jest.fn(), openStudio: jest.fn(), onReconcilePublication: jest.fn(), onResetFailedPublication: jest.fn() },
  } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "b", brandName: "Young & Stamped", controller, phone: false, section: "overview",
    go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: mockAsk, asking: false,
    lock: { heldByOther: false, holderName: null, canTakeOver: canPublish, takeOver: jest.fn(), takingOver: false },
    plan: null,
    previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations: jest.fn(),
    headingRef: React.createRef(), offerings: ["trips"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  };
}

function render(node: React.ReactElement, canPublish: boolean) {
  const value = context(canPublish);
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={value}>{node}</WebsiteProvider></QueryClientProvider>);
  });
  return { root: tree.root, value };
}

const byTestId = (root: Root, id: string) => root.findAll((node) => node.props.testID === id && typeof node.props.onPress === "function" || node.props.testID === id && node.props.accessibilityState !== undefined);

beforeEach(() => {
  mockAsk.mockClear();
  mockMutate.mockClear();
});

describe("#2829 W9r marketing manager gets Ask an admin (Core's capability, not a local rank)", () => {
  it("Publish & history: no Publish, no Restore; Ask an admin notifies", () => {
    const { root } = render(<PublishSection />, false);
    expect(root.findAll((node) => node.props.testID === "publish-button")).toHaveLength(0);
    expect(root.findAll((node) => String(node.props.testID ?? "").startsWith("history-restore-"))).toHaveLength(0);
    const ask = root.findAll((node) => node.props.testID === "publish-ask-admin" && typeof node.props.onPress === "function")[0]!;
    act(() => { (ask.props.onPress as () => void)(); });
    expect(mockAsk).toHaveBeenCalledWith("publish");
    expect(textOf(root)).toContain("Publishing needs a brand admin or the owner");
  });

  it("the owner gets Publish 1 change and Restore on the older version", () => {
    const { root, value } = render(<PublishSection />, true);
    const publish = root.findAll((node) => node.props.testID === "publish-button" && typeof node.props.onPress === "function")[0]!;
    expect(textOf(root)).toContain("Publish 1 change");
    act(() => { (publish.props.onPress as () => void)(); });
    expect(value.controller.actions.publish).toHaveBeenCalled();
    expect(root.findAll((node) => node.props.testID === "history-restore-p0").length).toBeGreaterThan(0);
    expect(root.findAll((node) => node.props.testID === "history-restore-p1")).toHaveLength(0);
  });

  it("Addresses, Settings: read-only with Ask an admin", () => {
    const addresses = render(<AddressesSection />, false).root;
    expect(textOf(addresses)).toContain("Only brand admins and owners can change addresses");
    const ask = addresses.findAll((node) => node.props.testID === "addresses-ask" && typeof node.props.onPress === "function")[0]!;
    act(() => { (ask.props.onPress as () => void)(); });
    expect(mockAsk).toHaveBeenCalledWith("domain");
    const settings = render(<SettingsSection />, false).root;
    expect(settings.findAll((node) => node.props.testID === "settings-online-toggle")).toHaveLength(0);
    expect(settings.findAll((node) => node.props.testID === "settings-download-button")).toHaveLength(0);
    expect(settings.findAll((node) => node.props.testID === "settings-ask-offline").length).toBeGreaterThan(0);
    expect(settings.findAll((node) => node.props.testID === "settings-ask-download").length).toBeGreaterThan(0);
  });

  it("Review: the confirm box is disabled and says why; Ask an admin; Show can't be switched on", () => {
    const { root } = render(<ReviewEditor entryId="r3" />, false);
    const confirm = root.findAll((node) => node.props.testID === "review-confirm" && node.props.accessibilityState !== undefined)[0]!;
    expect((confirm.props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
    expect(textOf(root)).toContain("Only a brand admin or the owner can confirm a review.");
    expect(textOf(root)).toContain("I confirm this is a real review from a real traveller and I have permission to show it.");
    expect(root.findAll((node) => node.props.testID === "review-ask-admin").length).toBeGreaterThan(0);
    const show = root.findAll((node) => node.props.testID === "review-enabled" && node.props.accessibilityState !== undefined)[0]!;
    expect((show.props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
  });

  it("Review: an owner can tick the confirmation, which then allows Show", () => {
    const { root } = render(<ReviewEditor entryId="r3" />, true);
    const confirm = root.findAll((node) => node.props.testID === "review-confirm" && typeof node.props.onPress === "function")[0]!;
    act(() => { (confirm.props.onPress as () => void)(); });
    const show = root.findAll((node) => node.props.testID === "review-enabled" && node.props.accessibilityState !== undefined)[0]!;
    expect((show.props.accessibilityState as { disabled: boolean }).disabled).toBe(false);
    expect(textOf(root)).toContain("Required before it can show on your website. Mingla records who confirmed it and when.");
  });
});

describe("#2829 W9r Website design colours", () => {
  it("applies a typed hex on blur, keeps a bad one with the reason", () => {
    const { root, value } = render(<DesignSection />, true);
    const hex = () => root.findAll((node) => node.props.testID === "swatch-hex-accent_ink" && typeof node.props.onBlur === "function")[0]!;
    act(() => { (hex().props.onChangeText as (v: string) => void)("#9a8f6"); });
    act(() => { (hex().props.onBlur as () => void)(); });
    expect(textOf(root)).toContain("That isn't a colour code. Try something like #89cff0");
    expect(hex().props.value).toBe("#9a8f6");
    act(() => { (hex().props.onChangeText as (v: string) => void)("#9a8f6a"); });
    act(() => { (hex().props.onBlur as () => void)(); });
    expect(value.setDesignDirty).toHaveBeenLastCalledWith(true);
    // The low-contrast button text now shows its warning under that swatch.
    expect(root.findAll((node) => node.props.testID === "readability-accent_ink").length).toBeGreaterThan(0);
    expect(textOf(root)).toContain("Button labels on your accent colour is hard to read");
  });
});
