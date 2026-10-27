/*
 * #2829 W2 (T-W2) — the shared route contract: page paths, base paths,
 * redirect matching and the collision rule (PATH_COLLISION).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_ROUTES,
  findPathCollisions,
  isPagePath,
  isRedirectRules,
  matchRedirect,
  redirectRuleProblem,
  resolveSiteRoutes,
  type RedirectRule,
} from "../contracts/generated/routes.ts";

describe("#2829 page paths", () => {
  it("accepts home, top-level and nested paths up to depth 3", () => {
    for (const path of ["", "about", "resources/faqs", "a/b/c"]) {
      expect(isPagePath(path)).toBe(true);
    }
  });
  it("refuses depth 4, bad slugs and reserved first segments", () => {
    for (const path of ["a/b/c/d", "About", "with space", "a//b", "-x", "preview", "api/x", "fonts", "book", "om"]) {
      expect(isPagePath(path)).toBe(false);
    }
  });
});

describe("#2829 collection base paths", () => {
  it("fills defaults and lets stories live at the site root", () => {
    expect(resolveSiteRoutes({})).toEqual(DEFAULT_SITE_ROUTES);
    expect(resolveSiteRoutes({ stories: "", destinations: "stamped-destinations" })).toMatchObject({
      stories: "",
      destinations: "stamped-destinations",
    });
  });
  it("refuses a root base path for anything but stories, and reserved words", () => {
    expect(resolveSiteRoutes({ trips: "" })).toBeNull();
    expect(resolveSiteRoutes({ events: "media" })).toBeNull();
    expect(resolveSiteRoutes({ trips: "Trips" })).toBeNull();
  });
});

describe("#2829 redirects", () => {
  const rules: RedirectRule[] = [
    { from: "/destinations", to: "/stamped-destinations", status: 308 },
    { from: "/trips/:slug", to: "https://host.usemingla.com/t/ys/:slug", status: 308 },
    { from: "/blog/:rest*", to: "/:rest", status: 301 },
    { from: "/old", to: "/new", status: 301 },
  ];

  it("matches literals, a :param and a :path* tail", () => {
    expect(matchRedirect(rules, "/destinations")).toEqual({ location: "/stamped-destinations", status: 308 });
    expect(matchRedirect(rules, "/destinations/")).toEqual({ location: "/stamped-destinations", status: 308 });
    expect(matchRedirect(rules, "/trips/bali-2027")).toEqual({
      location: "https://host.usemingla.com/t/ys/bali-2027",
      status: 308,
    });
    expect(matchRedirect(rules, "/blog/a/b")).toEqual({ location: "/a/b", status: 301 });
    expect(matchRedirect(rules, "/blog")).toEqual({ location: "/", status: 301 });
    expect(matchRedirect(rules, "/old")).toEqual({ location: "/new", status: 301 });
  });

  it("does not match a longer path or another page", () => {
    expect(matchRedirect(rules, "/destinations/x")).toBeNull();
    expect(matchRedirect(rules, "/trips")).toBeNull();
    expect(matchRedirect(rules, "/about")).toBeNull();
  });

  it("refuses unsafe or broken rules", () => {
    expect(redirectRuleProblem({ from: "/", to: "/x", status: 308 })).toBe("REDIRECT_FROM");
    expect(redirectRuleProblem({ from: "/api/x", to: "/x", status: 308 })).toBe("REDIRECT_FROM");
    expect(redirectRuleProblem({ from: "/x", to: "//evil.example", status: 308 })).toBe("REDIRECT_TO");
    expect(redirectRuleProblem({ from: "/x", to: "javascript:alert(1)", status: 308 })).toBe("REDIRECT_TO");
    expect(redirectRuleProblem({ from: "/x", to: "http://plain.example", status: 308 })).toBe("REDIRECT_TO");
    expect(redirectRuleProblem({ from: "/x", to: "/y", status: 302 })).toBe("REDIRECT_STATUS");
    expect(redirectRuleProblem({ from: "/x/:a", to: "/y/:b", status: 301 })).toBe("REDIRECT_TO");
    expect(redirectRuleProblem({ from: "/x", to: "/x", status: 301 })).toBe("REDIRECT_LOOP");
    expect(isRedirectRules(Array.from({ length: 201 }, (_, i) => ({ from: `/r${i}`, to: "/", status: 301 })))).toBe(false);
    expect(isRedirectRules(Array.from({ length: 200 }, (_, i) => ({ from: `/r${i}`, to: "/", status: 301 })))).toBe(true);
  });
});

describe("#2829 PATH_COLLISION", () => {
  const routes = DEFAULT_SITE_ROUTES;
  it("a clean tree has no collision", () => {
    expect(findPathCollisions({
      pages: [{ path: "" }, { path: "about" }, { path: "resources" }, { path: "resources/faqs" }, { path: "trips" }],
      routes,
    })).toEqual([]);
  });
  it("two pages at one address collide", () => {
    expect(findPathCollisions({ pages: [{ path: "" }, { path: "about" }, { path: "about" }], routes }))
      .toEqual(["/about is used by two pages"]);
  });
  it("two collections on one base path collide", () => {
    expect(findPathCollisions({ pages: [{ path: "" }], routes: { ...routes, events: "trips" } })).toHaveLength(1);
  });
  it("a page shadowing a collection entry, or a root story, collides", () => {
    expect(findPathCollisions({
      pages: [{ path: "" }, { path: "trips/bali" }],
      routes,
      collectionSlugs: { trips: ["bali"] },
    })).toHaveLength(1);
    expect(findPathCollisions({
      pages: [{ path: "" }, { path: "about" }],
      routes: { ...routes, stories: "" },
      collectionSlugs: { stories: ["about"] },
    })).toHaveLength(1);
  });
  it("a redirect from an address a page lives at collides", () => {
    expect(findPathCollisions({
      pages: [{ path: "" }, { path: "about" }],
      routes,
      redirects: [{ from: "/about", to: "/", status: 308 }],
    })).toEqual(["/about redirects away, but a page lives there"]);
  });
});
