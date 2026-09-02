import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../supabaseRpc", () => ({ requestRpcJson: jest.fn() }));

const rpc = (jest.requireMock("../supabaseRpc") as { requestRpcJson: jest.Mock<any> }).requestRpcJson;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../publicSearchDocument") as {
  PUBLIC_HOST_ORIGIN: string;
  buildPublicPath: (kind: string, slugs: string[]) => string | null;
  handlePublicSearchDocument: (input: unknown) => Promise<void>;
  jsonLdFor: (facts: Record<string, unknown>, canonical: string) => Record<string, unknown>;
};

type Result = { statusCode: number; headers: Record<string, string>; body: string };

const responseHarness = () => {
  const result: Result = { statusCode: 0, headers: {}, body: "" };
  const response = {
    get statusCode() { return result.statusCode; },
    set statusCode(value: number) { result.statusCode = value; },
    setHeader(key: string, value: string) { result.headers[key.toLowerCase()] = String(value); },
    end(body = "") { result.body = String(body); },
  };
  return { response, result };
};

const routeFor = (kind: string) => ({
  event: ["event", ["acme", "summer-night"]],
  trip: ["trip", ["acme", "lagos-weekend"]],
  experience: ["experience", ["acme", "gallery-tour"]],
  brand: ["brand", ["acme"]],
  venue: ["venue", ["acme", "rooftop"]],
}[kind] as [string, string[]]);

const factsFor = (kind: string) => ({
  kind,
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "acme",
  brandName: kind === "brand" ? "Acme Social" : "Acme",
  slug: kind === "brand" ? undefined : "offering",
  title: kind === "brand" ? "Acme Social" : `Truthful ${kind}`,
  description: `A visible, sourced description of this ${kind} with enough useful detail for an explorer.`,
  status: "scheduled",
  eventType: kind === "event" ? "event" : kind,
  visibility: "public",
  startAt: "2026-10-10T18:00:00.000Z",
  endAt: "2026-10-10T21:00:00.000Z",
  timezone: "America/New_York",
  isOnline: false,
  location: "Downtown Durham",
  city: "Durham",
  countryCode: "US",
  destination: "Lagos",
  departure: "London",
  venue: "Downtown gallery",
  imageUrl: "https://images.example.test/cover.jpg",
  imageType: "image",
  imageAlt: `Guests enjoying the ${kind}`,
  eventCount: 2,
  priceCents: 2500,
  currency: "USD",
  isFree: false,
  actionAvailable: ["event", "trip", "experience"].includes(kind),
  sourceUpdatedAt: "2026-09-01T10:00:00.000Z",
});

const resolutionFor = (kind: string, state = "search_ready") => ({
  valid: true,
  kind,
  state,
  canonicalPath: publicSearch.buildPublicPath(...routeFor(kind)),
  integrityOk: true,
  facts: factsFor(kind),
});

const invoke = async ({
  kind = "event",
  state = "search_ready",
  method = "GET",
  userAgent = "Mozilla/5.0",
  resolution = resolutionFor(kind, state),
  rpcError = false,
  slugs,
}: {
  kind?: string;
  state?: string;
  method?: string;
  userAgent?: string;
  resolution?: Record<string, unknown>;
  rpcError?: boolean;
  slugs?: string[];
} = {}) => {
  rpc.mockReset();
  if (rpcError) rpc.mockRejectedValueOnce(new Error("dependency down"));
  else rpc.mockResolvedValueOnce(resolution);
  const { response, result } = responseHarness();
  await publicSearch.handlePublicSearchDocument({
    req: { method, headers: { "user-agent": userAgent }, url: `${publicSearch.buildPublicPath(...routeFor(kind))}?utm_source=test` },
    res: response,
    kind,
    slugs: slugs ?? routeFor(kind)[1],
  });
  return result;
};

beforeEach(() => { rpc.mockReset(); });

describe("#2986 implementor happy path — one truthful public document", () => {
  it.each([
    ["event", "Event"],
    ["trip", "TouristTrip"],
    ["experience", "Service"],
    ["brand", "Organization"],
    ["venue", "LocalBusiness"],
  ])("renders %s as meaningful no-JS HTML with its truthful schema", async (kind, schemaType) => {
    const result = await invoke({ kind });
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(result.headers["x-robots-tag"]).toBe("index, follow");
    expect(result.body).toContain(`<h1>${kind === "brand" ? "Acme Social" : `Truthful ${kind}`}</h1>`);
    expect(result.body.match(/<link rel="canonical"/g)).toHaveLength(1);
    expect(result.body).toContain(`${publicSearch.PUBLIC_HOST_ORIGIN}${publicSearch.buildPublicPath(...routeFor(kind))}`);
    expect(result.body).not.toContain("business.usemingla.com");
    expect(result.body).toContain('id="root"');
    expect(result.body).toContain('/brand/mingla-business-logo.png');
    expect(result.body).toContain('id="mingla-share"');
    expect(result.body).toContain('fetch("/index.html"');
    const jsonLdText = result.body.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    expect(jsonLdText).toBeDefined();
    const jsonLd = JSON.parse(jsonLdText as string) as { "@graph": Array<Record<string, unknown>> };
    expect(jsonLd["@graph"].some((node) => node["@type"] === schemaType)).toBe(true);
    expect(JSON.stringify(jsonLd)).toContain("https://usemingla.com/#organization");
    expect(JSON.stringify(jsonLd)).not.toMatch(/"offers"|"review"|"aggregateRating"|illustrative/i);
  });

  it("keeps attribution on live actions while canonical/share URLs stay clean", async () => {
    rpc.mockResolvedValueOnce(resolutionFor("event"));
    const { response, result } = responseHarness();
    await publicSearch.handlePublicSearchDocument({
      req: { method: "GET", headers: {}, url: "/e/acme/summer-night?utm_source=google&gclid=abc&token=private" },
      res: response,
      kind: "event",
      slugs: ["acme", "summer-night"],
    });
    expect(result.body).toContain('/checkout/11111111-1111-4111-8111-111111111111?utm_source=google&amp;gclid=abc');
    expect(result.body).not.toContain("token=private");
    expect(result.body.match(/https:\/\/host\.usemingla\.com\/e\/acme\/summer-night/g)?.length).toBeGreaterThanOrEqual(2);
    expect(result.body).not.toContain("summer-night?utm_source");
  });

  it("uses the exact-path RPC once and strips query variants from canonical truth", async () => {
    const result = await invoke({ kind: "event" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("resolve_public_search_document", { p_path: "/e/acme/summer-night" });
    expect(result.body).toContain('<link rel="canonical" href="https://host.usemingla.com/e/acme/summer-night"');
    expect(result.body).toContain('<meta property="og:url" content="https://host.usemingla.com/e/acme/summer-night"');
    expect(result.body).not.toContain("summer-night?utm_source");
  });

  it.each(["public_noindex", "stale", "expired_archived"])("keeps %s visible but out of schema and search", async (state) => {
    const resolution = resolutionFor("event", state);
    if (state === "expired_archived") {
      resolution.facts.status = "ended";
    }
    const result = await invoke({ state, resolution });
    expect(result.statusCode).toBe(200);
    expect(result.headers["x-robots-tag"]).toBe("noindex");
    expect(result.body).toContain('name="robots" content="noindex,follow"');
    expect(result.body).not.toContain("application/ld+json");
    if (state === "expired_archived") {
      expect(result.body).toContain("has ended");
      expect(result.body).not.toContain("Get tickets");
    }
  });

  it("ignores founder-approved illustrative fields instead of laundering them into HTML/schema", async () => {
    const resolution = resolutionFor("brand");
    Object.assign(resolution.facts, { illustrativeMetrics: { bookings: "10,000+" }, socialProof: "Everyone loves it" });
    const result = await invoke({ kind: "brand", resolution });
    expect(result.body).not.toContain("10,000+");
    expect(result.body).not.toContain("Everyone loves it");
  });
});

describe("#2986 lifecycle, UA, method and hostile-input contract", () => {
  it.each([
    ["draft", 404],
    ["gone", 410],
  ])("returns real %s status without entity facts/canonical", async (state, status) => {
    const resolution = resolutionFor("event", state);
    resolution.facts.title = "SECRET NEVER LEAK";
    const result = await invoke({ state, resolution });
    expect(result.statusCode).toBe(status);
    expect(result.body).not.toContain("SECRET NEVER LEAK");
    expect(result.body).not.toContain('rel="canonical"');
    expect(result.body).not.toContain("application/ld+json");
  });

  it("returns a one-hop Host-only 308", async () => {
    const result = await invoke({ resolution: {
      valid: true, kind: "event", state: "redirected", canonicalPath: "/e/acme/summer-night",
      redirectTargetPath: "/e/acme/autumn-night", integrityOk: true,
    } });
    expect(result.statusCode).toBe(308);
    expect(result.headers.location).toBe("https://host.usemingla.com/e/acme/autumn-night?utm_source=test");
    expect(result.body).toBe("");
  });

  it.each(["https://evil.test/e/a/b", "/e/a/%2fsecret", "/e/a/../secret", "/e/a/b?next=evil", "/e/a/b//c"])("fails closed on hostile redirect target %s", async (redirectTargetPath) => {
    const result = await invoke({ resolution: {
      valid: true, kind: "event", state: "redirected", canonicalPath: "/e/acme/summer-night",
      redirectTargetPath, integrityOk: true,
    } });
    expect(result.statusCode).toBe(503);
    expect(result.headers.location).toBeUndefined();
  });

  it("returns 503 rather than fabricating not-found truth on dependency/integrity failures", async () => {
    expect((await invoke({ rpcError: true })).statusCode).toBe(503);
    expect((await invoke({ resolution: { ...resolutionFor("event"), integrityOk: false } })).statusCode).toBe(503);
    expect((await invoke({ resolution: { ...resolutionFor("event"), facts: null } })).statusCode).toBe(503);
  });

  it.each(["Mozilla/5.0", "Googlebot", "Bingbot", "OAI-SearchBot", "Claude-SearchBot", "Claude-User", "PerplexityBot"])("is materially identical for %s", async (userAgent) => {
    const result = await invoke({ userAgent });
    expect({ status: result.statusCode, canonical: result.body.match(/<link rel="canonical" href="([^"]+)/)?.[1], h1: result.body.match(/<h1>([^<]+)/)?.[1], robots: result.headers["x-robots-tag"] }).toEqual({
      status: 200,
      canonical: "https://host.usemingla.com/e/acme/summer-night",
      h1: "Truthful event",
      robots: "index, follow",
    });
  });

  it.each(["event", "trip", "experience", "brand", "venue"])("preserves %s status/headers for HEAD with no body", async (kind) => {
    const get = await invoke({ kind, method: "GET" });
    const head = await invoke({ kind, method: "HEAD" });
    expect(head.statusCode).toBe(get.statusCode);
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(head.headers["x-robots-tag"]).toBe(get.headers["x-robots-tag"]);
    expect(head.body).toBe("");
  });

  it("rejects non-read methods and malformed/lookalike route segments before RPC", async () => {
    expect((await invoke({ method: "POST" })).statusCode).toBe(405);
    rpc.mockClear();
    for (const slugs of [["Acme", "event"], ["acme", "%2fevent"], ["acme", ".."], ["аcme", "event"], ["acme", "event/child"]]) {
      const result = await invoke({ slugs });
      expect(result.statusCode).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("escapes hostile visible strings in HTML and JSON-LD", async () => {
    const resolution = resolutionFor("event");
    resolution.facts.title = `</h1><script>alert("x")</script>`;
    const result = await invoke({ resolution });
    expect(result.body).not.toContain('<script>alert("x")</script>');
    expect(result.body).toContain("&lt;/h1&gt;&lt;script&gt;");
    expect(result.body).toContain("\\u003c/script\\u003e");
  });
});

describe("#2986 source wiring is one resolver, not five revived readers", () => {
  it("all five handlers delegate to the same module and the Vercel rewrites have no UA gate", () => {
    const root = path.resolve(__dirname, "../..");
    for (const file of ["public-event.js", "public-trip.js", "public-experience.js", "public-brand.js", "public-venue.js"]) {
      const source = readFileSync(path.join(root, "api", file), "utf8");
      expect(source).toContain('../server/publicSearchDocument');
      expect(source).toContain("handlePublicSearchDocument");
      expect(source).not.toContain("socialPreview");
    }
    const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")) as { rewrites: Array<{ source: string; has?: unknown }> };
    const publicSources = new Set(["/e/:brandSlug/:eventSlug", "/t/:brandSlug/:tripSlug", "/exp/:brandSlug/:experienceSlug", "/b/:brandSlug", "/b/:brandSlug/v/:venueSlug"]);
    expect(config.rewrites.filter((rewrite) => publicSources.has(rewrite.source))).toHaveLength(5);
    expect(config.rewrites.filter((rewrite) => publicSources.has(rewrite.source)).every((rewrite) => rewrite.has === undefined)).toBe(true);
  });
});

describe("#2986 privacy transitions and Share recovery remain user-safe", () => {
  it.each(["search_ready", "public_noindex", "stale", "expired_archived", "draft", "gone"])(
    "serves %s with resolver-owned no-store headers",
    async (state) => {
      const resolution = resolutionFor("event", state);
      if (state === "expired_archived") resolution.facts.status = "ended";
      const result = await invoke({ state, resolution });
      expect(result.headers["cache-control"]).toBe("private, no-store, max-age=0, must-revalidate");
      expect(result.headers["cdn-cache-control"]).toBe("no-store");
      expect(result.headers["vercel-cdn-cache-control"]).toBe("no-store");
      expect(result.headers["cache-control"]).not.toMatch(/s-maxage|stale-while-revalidate|public/);
    },
  );

  it("applies the same no-store contract to redirects and dependency failures", async () => {
    const redirected = await invoke({ resolution: {
      valid: true, kind: "event", state: "redirected", canonicalPath: "/e/acme/summer-night",
      redirectTargetPath: "/e/acme/autumn-night", integrityOk: true,
    } });
    const failed = await invoke({ rpcError: true });
    for (const result of [redirected, failed]) {
      expect(result.headers["cache-control"]).toBe("private, no-store, max-age=0, must-revalidate");
      expect(result.headers["cdn-cache-control"]).toBe("no-store");
      expect(result.headers["vercel-cdn-cache-control"]).toBe("no-store");
    }
  });

  it("ships visible live-region feedback and a canonical manual-copy fallback", async () => {
    const result = await invoke({ kind: "event" });
    expect(result.body).toContain('id="mingla-share-status" role="status" aria-live="polite"');
    expect(result.body).toContain('id="mingla-runtime-status" role="status" aria-live="polite"');
    expect(result.body).toContain('id="mingla-share-fallback" hidden');
    expect(result.body).toContain('aria-label="Canonical Mingla link" type="text" readonly');
    expect(result.body).toContain('value="https://host.usemingla.com/e/acme/summer-night"');
  });
});
