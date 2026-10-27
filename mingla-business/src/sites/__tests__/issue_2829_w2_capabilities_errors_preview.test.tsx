/**
 * #2829 W2 — the Business Website workspace.
 *
 * A5(a) The workspace gates on Core's can_* capability flags from the
 *       site-availability answer, never on a client-side copy of the role.
 * A5(b) Errors are truthful: a 403 says only brand admins and owners can do
 *       it; other known codes keep their own plain sentence; only an unknown
 *       code, a 5xx or a transport fault says "temporarily unavailable".
 * W2    Preview lists the draft's pages and opens any page; a refused publish
 *       names an owner-fixable reason (two pages at one address).
 *
 * Drives the REAL route, hooks and service down to the edge-function envelope.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";

const mockInvoke = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: "00000000-0000-4000-8000-00000000000b" }),
  Redirect: () => null,
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
const viewProps: Record<string, unknown>[] = [];
jest.mock("../../components/ui/SafeScreen", () => ({
  SafeScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../components/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("../../config/featureFlags", () => ({ isFeatureEnabled: () => true }));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-00000000000a" }, isAuthReady: true }),
}));
jest.mock("../../hooks/useBrands", () => ({ useBrand: () => ({ data: { displayName: "Young & Stamped" } }) }));
// If the route still read a local role, this owner-level rank would leak into
// the controls. The assertions below prove it does not.
jest.mock("../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ isLoading: false, isError: false, rank: 60, refetch: jest.fn() }),
}));
jest.mock("../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => null }));
jest.mock("../websiteExternalOpen", () => ({ openWebsiteUrl: jest.fn() }));
const mockHandoff = jest.fn();
jest.mock("../studioHandoff", () => ({
  openStudioHandoff: (...a: unknown[]) => mockHandoff(...a),
  studioReturnSurface: () => "native",
}));
jest.mock("../../components/ui/Button", () => ({
  Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    require("react").createElement("mock-button", { onPress }, label),
}));
jest.mock("../../components/ui/GlassCard", () => ({
  GlassCard: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
    require("react").createElement("mock-card", { testID }, children),
}));
jest.mock("../../components/ui/Icon", () => ({ Icon: () => null }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWebsiteController } from "../../components/sites/website/useWebsiteController";
/*
 * #2829 W9r — the old route and its BrandWebsiteView are gone; the Website
 * section's controller owns this logic now. This harness drives the REAL
 * controller (real hooks, real service, mocked edge envelope) and records
 * what it hands the sections, under the prop names these suites always read.
 */
function Route(): null {
  const [panel, setPanel] = React.useState("overview");
  const controller = useWebsiteController(BRAND, null, panel === "publish_review");
  if (controller.websiteAvailable !== true) return null;
  viewProps.push({
    capabilities: controller.capabilities,
    notice: controller.notice,
    journeyState: controller.journeyState,
    publicationOperationId: controller.publicationOperation?.operationId ?? null,
    validation: controller.validation.data ?? null,
    onSetPanel: setPanel,
    onValidatePublish: () => { void controller.validation.refetch(); },
    onPublish: controller.actions.publish,
    onOpenStudio: () => controller.actions.openStudio(),
    onPreview: () => controller.actions.openStudioPreview(""),
    onPreviewPage: (pagePath: string) => controller.actions.openStudioPreview(pagePath),
  });
  return null;
}
import { brandSitesErrorFrom, getBrandSite, SITES_ERROR_MESSAGES } from "../../services/brandSitesService";
import { previewUrlForPage, type BrandSiteOverview } from "../contracts";
import { websiteFailureNotice } from "../websiteJourney";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => {
    toJSON: () => unknown;
    unmount: () => void;
    root: { findAllByType: (type: string) => Array<{ props: { onPress?: () => void }; children: string[] }> };
  };
};

const BRAND = "00000000-0000-4000-8000-00000000000b";
const SITE: BrandSiteOverview = {
  id: "00000000-0000-4000-8000-00000000000c",
  brand_id: BRAND,
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status: "published",
  active_publication_id: "00000000-0000-4000-8000-00000000000d",
  last_successful_publication_id: "00000000-0000-4000-8000-00000000000d",
  provisioning_error_code: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  brand_site_hosts: [{ hostname: "ys.sites.localhost", status: "active", is_primary: true }],
  latest_provision_operation: null,
};
const ok = (data: unknown) => ({ data: { ok: true, data }, error: null });
const mounted: { unmount: () => void }[] = [];

function serve(availability: Record<string, unknown>, extra: (route: string) => unknown = () => null) {
  mockInvoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
    const route = String(opts.body.route ?? "");
    const custom = extra(route);
    if (custom) return Promise.resolve(custom);
    if (route.endsWith("/site-availability")) return Promise.resolve(ok(availability));
    if (route.endsWith("/site")) return Promise.resolve(ok(SITE));
    return Promise.resolve(ok([]));
  });
}

async function settle(passes = 12): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountRoute(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    mounted.push(create(<QueryClientProvider client={client}><Route /></QueryClientProvider>));
  });
  await settle();
}

const latest = () => viewProps[viewProps.length - 1] ?? {};

beforeEach(() => {
  viewProps.length = 0;
  mockInvoke.mockReset();
  mockHandoff.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

describe("#2829 A5(a) the workspace follows Core's capability flags", () => {
  it("a member Core lets edit but not publish gets no publish, offline or export controls", async () => {
    serve({ available: true, can_create: false, can_publish: false, can_edit: true, site: SITE });
    await mountRoute();
    // #2829 W9r — the sections hide publish, offline and download on this flag
    // (websiteSections / websiteBehaviours suites render that).
    expect(latest().capabilities).toEqual({ canCreate: false, canPublish: false, canEdit: true });
  });

  it("a member Core lets publish gets them", async () => {
    serve({ available: true, can_create: true, can_publish: true, can_edit: true, site: SITE });
    await mountRoute();
    expect(latest().capabilities).toEqual({ canCreate: true, canPublish: true, canEdit: true });
  });

  it("a brand Core says is not available never opens the workspace", async () => {
    serve({ available: false, can_create: false, can_publish: false, can_edit: false, site: null });
    await mountRoute();
    expect(viewProps).toHaveLength(0);
  });

  it("the route keeps no client-side copy of the role", () => {
    const route = ["src/components/sites/website/useWebsiteController.ts", "src/components/sites/website/WebsiteApp.tsx", "app/brand/[id]/website.tsx"]
      .map((file) => fs.readFileSync(path.resolve(__dirname, "../../..", file), "utf8")).join("\n");
    expect(route).not.toMatch(/\brole\.rank\b/);
    expect(route).not.toContain("useCurrentBrandRole");
    expect(route).toContain("capabilitiesFrom(availability.data)");
  });
});

describe("#2829 A5(b) truthful error messages", () => {
  it("a 403 says only brand admins and owners can do this", async () => {
    const response = { status: 403, json: async () => ({ ok: false, error: { code: "FORBIDDEN", message: "This Website action is not available for your role." } }) };
    mockInvoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError", context: response } });
    await expect(getBrandSite(BRAND)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only brand admins and owners can do this.",
    });
    expect(websiteFailureNotice({ code: "FORBIDDEN", message: "x" }).body).toBe(
      "Only brand admins and owners can do this.",
    );
  });

  it("other known codes keep their own plain sentence, even through an HTTP error", async () => {
    const response = { status: 409, json: async () => ({ ok: false, error: { code: "REVISION_CONFLICT", message: "The draft changed. Refresh it before trying again." } }) };
    mockInvoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError", context: response } });
    await expect(getBrandSite(BRAND)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      message: "The draft changed. Refresh it before trying again.",
    });
    expect(brandSitesErrorFrom(409, { ok: false, error: { code: "INVALID_STATE" } }).message)
      .toBe(SITES_ERROR_MESSAGES.INVALID_STATE);
  });

  it("a draft with two pages at one address says so, instead of 'try again'", async () => {
    const response = { status: 409, json: async () => ({ ok: false, error: { code: "VALIDATION_FAILED", message: "x", reason_code: "PATH_COLLISION" } }) };
    mockInvoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError", context: response } });
    await expect(getBrandSite(BRAND)).rejects.toMatchObject({
      code: "PATH_COLLISION",
      message: SITES_ERROR_MESSAGES.PATH_COLLISION,
      retryable: false,
    });
    expect(websiteFailureNotice({ code: "PATH_COLLISION", message: SITES_ERROR_MESSAGES.PATH_COLLISION! }).body)
      .toContain("Give one of those pages a different address");
  });

  it("only an unknown code, a 5xx or a transport fault says temporarily unavailable", async () => {
    const unavailable = "Website tools are temporarily unavailable.";
    expect(brandSitesErrorFrom(409, { ok: false, error: { code: "SOMETHING_NEW" } })).toMatchObject({
      code: "SERVICE_TEMPORARILY_UNAVAILABLE", message: unavailable,
    });
    expect(brandSitesErrorFrom(503, { ok: false, error: { code: "INVALID_STATE" } }).message).toBe(unavailable);
    expect(brandSitesErrorFrom(403, null)).toMatchObject({ code: "FORBIDDEN" });
    mockInvoke.mockResolvedValue({ data: null, error: new Error("Failed to send a request") });
    await expect(getBrandSite(BRAND)).rejects.toMatchObject({
      code: "SERVICE_TEMPORARILY_UNAVAILABLE", message: unavailable,
    });
  });
});

describe("#2829 W2 preview any page", () => {
  const PAGES = [
    { path: "", title: "Home" },
    { path: "resources", title: "Resources" },
    { path: "resources/faqs", title: "FAQs" },
  ];

  it("builds the page preview link", () => {
    expect(previewUrlForPage("https://studio/preview?token=t", "")).toBe("https://studio/preview?token=t");
    expect(previewUrlForPage("https://studio/preview?token=t", "resources/faqs"))
      .toBe("https://studio/preview?token=t&path=resources%2Ffaqs");
  });

  it("after the first preview, the route lists every page and opens the chosen one", async () => {
    serve(
      { available: true, can_create: true, can_publish: true, can_edit: true, site: SITE },
      (route) => {
        if (route.endsWith("/ari")) {
          return ok({ site_id: SITE.id, valid: true, renderer: "Restaurant Website v1", home_revision: "4", draft_digest: "a".repeat(64), checked_pages: 3 });
        }
        if (route.endsWith("/previews")) {
          return ok({ site_id: SITE.id, source_revision: "4", expires_at: new Date(Date.now() + 1_800_000).toISOString(), preview_url: "https://studio.example/preview?token=t", pages: PAGES });
        }
        return null;
      },
    );
    await mountRoute();
    await act(async () => (latest().onPreview as () => void)());
    await settle();
    expect(mockHandoff.mock.calls[0]![0]).toBe("https://studio.example/preview?token=t");
    await act(async () => (latest().onPreviewPage as (path: string) => void)("resources/faqs"));
    await settle();
    expect(mockHandoff.mock.calls[1]![0]).toBe("https://studio.example/preview?token=t&path=resources%2Ffaqs");
    // The grant was reused: one preview minted, two pages opened.
    expect(mockInvoke.mock.calls.filter(([, opts]) => String((opts as { body: { route: string } }).body.route).endsWith("/previews"))).toHaveLength(1);
  });
});
