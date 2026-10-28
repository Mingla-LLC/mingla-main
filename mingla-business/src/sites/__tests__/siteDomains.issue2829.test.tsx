/*
 * #2829 W8 (SC-24..26, Business half) — addresses: the status chips (Waiting
 * for DNS / Securing / Live / Needs attention / Disconnecting), the
 * registrar's steps, the disconnect explanation, the www offer, and the
 * service calling brand-site-domains with the routes Core expects and
 * surfacing its refusals in plain words.
 * (#2829 W9r: the screen moved into the Website section's Addresses; its
 * rendering is proven in components/sites/website/__tests__/websiteBehaviours.)
 */
const mockInvoke = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

import type { BrandSiteDomainHost, BrandSiteDomains } from "../contracts";
import { disconnectExplanation, domainChip, domainGuide, needsSetup, wwwOffer } from "../siteDomains";
import {
  attachBrandSiteDomain,
  detachBrandSiteDomain,
  getBrandSiteDomains,
  setPrimaryBrandSiteDomain,
} from "../../services/brandSitesService";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";

function host(over: Partial<BrandSiteDomainHost>): BrandSiteDomainHost {
  return {
    id: "h-" + (over.hostname ?? "x"),
    hostname: "youngandstamped.com",
    kind: "custom_domain",
    status: "pending",
    is_primary: false,
    is_apex: true,
    apex: "youngandstamped.com",
    dns_state: "pending",
    tls_state: "pending",
    records: [{ type: "A", name: "youngandstamped.com", value: "203.0.113.7" }],
    registrar: "namecheap",
    mx_missing: false,
    misconfigured_since: null,
    redirect_until: null,
    last_checked_at: null,
    activated_at: null,
    created_at: "2026-10-26T10:00:00Z",
    ...over,
  };
}

const SUBDOMAIN = host({
  id: "h-sub", hostname: "young-stamped.sites.usemingla.com", kind: "mingla_subdomain",
  status: "active", is_primary: true, is_apex: false, apex: "usemingla.com", dns_state: "ok",
  tls_state: "issued", records: [], registrar: null, created_at: "2026-10-01T00:00:00Z",
});

function domains(hosts: BrandSiteDomainHost[], canManage = true): BrandSiteDomains {
  return { site_id: SITE, can_manage: canManage, max_custom_domains: 4, hosts };
}

describe("#2829 W8 status chips", () => {
  it("names each state in the owner's words", () => {
    expect(domainChip(host({ status: "pending" })).label).toBe("Waiting for DNS");
    expect(domainChip(host({ status: "verifying", dns_state: "ok" })).label).toBe("Securing");
    expect(domainChip(host({ status: "active", dns_state: "ok", tls_state: "issued" })).label).toBe("Live");
    expect(domainChip(host({ status: "active", dns_state: "misconfigured" })).label).toBe("Needs attention");
    expect(domainChip(host({ status: "detaching" })).label).toBe("Disconnecting");
    expect(domainChip(SUBDOMAIN).label).toBe("Mingla address");
  });
});

describe("#2829 W8 guide, disconnect and www rules", () => {
  it("names the registrar's steps, and a live address needs no setup", () => {
    expect(domainGuide(host({ registrar: "cloudflare" })).steps.join(" ")).toContain("DNS only");
    expect(needsSetup(host({ status: "active", dns_state: "ok" }))).toBe(false);
    expect(needsSetup(host({}))).toBe(true);
  });

  it("explains disconnecting in each state", () => {
    const main = host({ id: "h-main", status: "active", is_primary: true, dns_state: "ok", tls_state: "issued" });
    expect(disconnectExplanation(main, "young-stamped.sites.usemingla.com")).toContain(
      "young-stamped.sites.usemingla.com becomes your main address immediately. youngandstamped.com will keep redirecting visitors to young-stamped.sites.usemingla.com for 30 days, then disconnect.",
    );
    expect(disconnectExplanation(host({ status: "detaching" }), "x.sites.usemingla.com")).toContain("If you've moved your DNS");
    expect(disconnectExplanation(host({ status: "pending" }), null)).toContain("isn't live yet");
  });

  it("offers www only for an apex, once, with room left", () => {
    expect(wwwOffer(host({}), domains([SUBDOMAIN, host({})]))).toBe("www.youngandstamped.com");
    expect(wwwOffer(host({}), domains([SUBDOMAIN, host({}), host({ hostname: "www.youngandstamped.com" })]))).toBeNull();
    expect(wwwOffer(host({ is_apex: false, hostname: "shop.brand.com" }), domains([SUBDOMAIN]))).toBeNull();
    const full = domains([SUBDOMAIN, ...["a", "b", "c", "d"].map((l) => host({ id: l, hostname: `${l}.com` }))]);
    expect(wwwOffer(host({ hostname: "a.com" }), full)).toBeNull();
  });
});

describe("#2829 W8 service", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("calls brand-site-domains with the routes Core expects", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, data: { site_id: SITE, hosts: [] } }, error: null });
    await getBrandSiteDomains(SITE);
    await attachBrandSiteDomain({ siteId: SITE, hostname: "youngandstamped.com", operationId: "op-1" });
    await setPrimaryBrandSiteDomain({ siteId: SITE, hostId: "h1", operationId: "op-2" });
    await detachBrandSiteDomain({ siteId: SITE, hostId: "h1", operationId: "op-3" });
    expect(mockInvoke.mock.calls.map((call) => [call[0], call[1].body.route, call[1].body.method])).toEqual([
      ["brand-site-domains", `/v1/sites/${SITE}/domains`, "GET"],
      ["brand-site-domains", `/v1/sites/${SITE}/domains`, "POST"],
      ["brand-site-domains", `/v1/sites/${SITE}/domains/h1/primary`, "POST"],
      ["brand-site-domains", `/v1/sites/${SITE}/domains/h1`, "DELETE"],
    ]);
    expect(mockInvoke.mock.calls[1][1].body).toMatchObject({ hostname: "youngandstamped.com", operation_id: "op-1" });
  });

  it("surfaces Core's refusal in plain words", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { status: 409, json: async () => ({ ok: false, error: { code: "DOMAIN_TAKEN" } }) } },
    });
    await expect(attachBrandSiteDomain({ siteId: SITE, hostname: "x.com" })).rejects.toMatchObject({
      code: "DOMAIN_TAKEN",
      message: "That address is already connected to a Mingla website.",
    });
    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { status: 503, json: async () => ({ ok: false, error: { code: "CHECK_UNAVAILABLE" } }) } },
    });
    await expect(getBrandSiteDomains(SITE)).rejects.toMatchObject({ code: "CHECK_UNAVAILABLE" });
  });
});
