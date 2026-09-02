import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../../server/supabaseRpc", () => ({ requestRpcJson: jest.fn() }));

const rpc = (jest.requireMock("../../server/supabaseRpc") as { requestRpcJson: jest.Mock<any> }).requestRpcJson;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const robots = require("../robots") as ((req: unknown, res: unknown) => void) & { ROBOTS_BODY: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sitemap = require("../sitemap") as ((req: unknown, res: unknown) => Promise<void>) & { buildSitemapXml: (rows: unknown) => string };

const harness = () => {
  const result = { statusCode: 0, headers: {} as Record<string, string>, body: "" };
  const response = {
    get statusCode() { return result.statusCode; },
    set statusCode(value: number) { result.statusCode = value; },
    setHeader(key: string, value: string) { result.headers[key.toLowerCase()] = String(value); },
    end(value = "") { result.body = String(value); },
  };
  return { response, result };
};

beforeEach(() => { rpc.mockReset(); });

describe("#2986 Host robots is a real conservative text document", () => {
  it("allows the five public families and excludes non-search surfaces/query variants", () => {
    const { response, result } = harness();
    robots({ method: "GET" }, response);
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(result.body).toContain("Allow: /e/");
    expect(result.body).toContain("Allow: /t/");
    expect(result.body).toContain("Allow: /exp/");
    expect(result.body).toContain("Allow: /b/");
    for (const path of ["/auth/", "/account/", "/checkout/", "/checkout-trip/", "/checkout-experience/", "/payment/", "/connect/", "/accept-brand-invitation", "/dashboard/", "/preview/", "/share/", "/s/", "/p/", "/og/", "/api/", "/*?*"]) {
      expect(result.body).toContain(`Disallow: ${path}`);
    }
    expect(result.body).toContain("Sitemap: https://host.usemingla.com/sitemap.xml");
    expect(result.body).not.toContain("business.usemingla.com");
    expect(result.body).not.toMatch(/<!doctype|<html/i);
  });

  it("returns equivalent HEAD metadata with no body and rejects mutation methods", () => {
    const headHarness = harness();
    robots({ method: "HEAD" }, headHarness.response);
    expect(headHarness.result).toMatchObject({ statusCode: 200, body: "" });
    expect(headHarness.result.headers["content-type"]).toContain("text/plain");
    const postHarness = harness();
    robots({ method: "POST" }, postHarness.response);
    expect(postHarness.result.statusCode).toBe(405);
    expect(postHarness.result.headers.allow).toBe("GET, HEAD");
  });
});

describe("#2986 Host sitemap is search_ready-only output from its separate RPC", () => {
  const rows = [
    { canonical_path: "/t/acme/trip", last_modified: "2026-09-01T10:00:00Z" },
    { canonical_path: "/e/acme/event", last_modified: "2026-09-01T11:00:00Z" },
    { canonical_path: "/exp/acme/tour", last_modified: "2026-09-01T12:00:00Z" },
    { canonical_path: "/b/acme", last_modified: "2026-09-01T13:00:00Z" },
    { canonical_path: "/b/acme/v/roof", last_modified: "2026-09-01T14:00:00Z" },
    { canonical_path: "/e/acme/event", last_modified: "2026-09-01T09:00:00Z" },
    { canonical_path: "https://evil.test/e/acme/event", last_modified: "2026-09-01T15:00:00Z" },
    { canonical_path: "/e/acme/%2fsecret", last_modified: "2026-09-01T15:00:00Z" },
    { canonical_path: "/e/acme/event?utm=x", last_modified: "2026-09-01T15:00:00Z" },
    { canonical_path: "/e/acme/other", last_modified: "not-a-date" },
  ];

  it("emits valid Host XML once per valid path with real timestamps", async () => {
    rpc.mockResolvedValueOnce(rows);
    const { response, result } = harness();
    await sitemap({ method: "GET" }, response);
    expect(rpc).toHaveBeenCalledWith("list_public_search_sitemap", {});
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("application/xml; charset=utf-8");
    expect(result.body).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(result.body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(result.body.match(/<url>/g)).toHaveLength(5);
    expect(result.body.match(/https:\/\/host\.usemingla\.com\/e\/acme\/event/g)).toHaveLength(1);
    expect(result.body).toContain("2026-09-01T11:00:00.000Z");
    expect(result.body).not.toContain("evil.test");
    expect(result.body).not.toContain("%2fsecret");
    expect(result.body).not.toContain("utm=");
    expect(result.body).not.toContain("business.usemingla.com");
    expect(result.body).not.toMatch(/<html|<!doctype/i);
  });

  it("returns a valid empty urlset rather than inventing inventory", () => {
    expect(sitemap.buildSitemapXml([])).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  });

  it("keeps HEAD status/MIME but no body", async () => {
    rpc.mockResolvedValueOnce(rows);
    const { response, result } = harness();
    await sitemap({ method: "HEAD" }, response);
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toContain("application/xml");
    expect(result.body).toBe("");
  });

  it("fails as 503/no-store instead of returning a false empty sitemap", async () => {
    rpc.mockRejectedValueOnce(new Error("dependency down"));
    const { response, result } = harness();
    await sitemap({ method: "GET" }, response);
    expect(result.statusCode).toBe(503);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.headers["x-robots-tag"]).toBe("noindex");
    expect(result.body).not.toContain("<urlset");
  });

  it("rejects mutation methods without calling the reader", async () => {
    const { response, result } = harness();
    await sitemap({ method: "POST" }, response);
    expect(result.statusCode).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });
});
