/*
 * #2829 W2 — the site's redirect rules answer in the proxy, before any render,
 * with the owner's exact status; the home page and the runtime's own routes
 * are never redirected; nothing is invented when the site cannot be resolved.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  redirects: [] as Array<{ from: string; to: string; status: number }>,
  resolveFails: false,
  tree: true,
};

vi.mock("./config", () => ({ runtimeConfig: () => ({ mode: "local" }) }));
vi.mock("./publication", () => ({
  requestHost: (headers: Headers) => {
    const host = (headers.get("host") ?? "").replace(/:\d+$/, "");
    if (!host.endsWith(".sites.localhost")) throw new Error("NOT_FOUND");
    return host;
  },
  resolveHost: async () => {
    if (state.resolveFails) throw new Error("NOT_FOUND");
    return { value: { site_id: "s" }, stale: false };
  },
  loadResolvedArtifact: async () =>
    state.tree ? { site_routes: { redirects: state.redirects } } : { navigation: { page_roles: [] } },
}));

import { siteRedirectFor } from "./siteRedirects";

const headers = (host = "ys.sites.localhost:3100") => new Headers({ host });
const run = (pathname: string, search = "", host?: string) =>
  siteRedirectFor(headers(host), pathname, search, `http://${host ?? "ys.sites.localhost:3100"}${pathname}${search}`);

beforeEach(() => {
  state.redirects = [
    { from: "/destinations", to: "/stamped-destinations", status: 308 },
    { from: "/trips/:slug", to: "https://host.usemingla.com/t/ys/:slug", status: 308 },
    { from: "/old", to: "/new?from=old", status: 301 },
  ];
  state.resolveFails = false;
  state.tree = true;
});

describe("#2829 site redirects in the proxy", () => {
  it("answers a literal rule with 308 on the same host and port, keeping the query", async () => {
    expect(await run("/destinations", "?ref=ig")).toEqual({
      location: "http://ys.sites.localhost:3100/stamped-destinations?ref=ig",
      status: 308,
    });
  });
  it("fills a :param into an external https target", async () => {
    expect(await run("/trips/bali-2027")).toEqual({
      location: "https://host.usemingla.com/t/ys/bali-2027",
      status: 308,
    });
  });
  it("uses 301 when the owner chose it, and the target's own query wins", async () => {
    expect(await run("/old", "?x=1")).toEqual({
      location: "http://ys.sites.localhost:3100/new?from=old",
      status: 301,
    });
  });
  it("never redirects home, runtime routes, unmatched paths, earlier artifacts or unresolvable hosts", async () => {
    expect(await run("/")).toBeNull();
    expect(await run("/preview")).toBeNull();
    expect(await run("/media/x/960.webp")).toBeNull();
    expect(await run("/about")).toBeNull();
    state.tree = false;
    expect(await run("/destinations")).toBeNull();
    state.tree = true;
    state.resolveFails = true;
    expect(await run("/destinations")).toBeNull();
    state.resolveFails = false;
    expect(await run("/destinations", "", "evil.example.com")).toBeNull();
  });
});

describe("#2829 the proxy applies them before anything else", () => {
  it("returns the redirect before building the CSP response", () => {
    const proxy = fs.readFileSync(path.resolve(process.cwd(), "src/proxy.ts"), "utf8");
    const redirectAt = proxy.indexOf("NextResponse.redirect(redirect.location, redirect.status)");
    expect(redirectAt).toBeGreaterThan(0);
    expect(redirectAt).toBeLessThan(proxy.indexOf("buildCsp({"));
  });
});
