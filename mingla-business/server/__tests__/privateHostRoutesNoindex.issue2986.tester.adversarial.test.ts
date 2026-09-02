import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

type Header = { key: string; value: string };
type HeaderRule = {
  source: string;
  headers: Header[];
  has?: unknown[];
  missing?: unknown[];
};
type RouteRule = {
  source: string;
  destination: string;
  has?: unknown[];
};
type VercelConfig = {
  headers: HeaderRule[];
  redirects: RouteRule[];
  rewrites: RouteRule[];
};

const businessRoot = path.resolve(__dirname, "../..");
const config = JSON.parse(readFileSync(path.join(businessRoot, "vercel.json"), "utf8")) as VercelConfig;

const robotsHeaders = (rule: HeaderRule): Header[] =>
  rule.headers.filter((header) => header.key.toLowerCase() === "x-robots-tag");

const matches = (source: string, requestPath: string): boolean => {
  if (source === requestPath) return true;
  const wildcard = source.match(/^(.*)\/:path\*$/);
  if (!wildcard) return false;
  return requestPath === wildcard[1] || requestPath.startsWith(`${wildcard[1]}/`);
};

const robotsRules = (candidate: VercelConfig): HeaderRule[] =>
  candidate.headers.filter((rule) => robotsHeaders(rule).length > 0);

const assertPrivatePartition = (candidate: VercelConfig): void => {
  const rules = robotsRules(candidate);
  const sources = rules.map((rule) => rule.source);

  expect(new Set(sources).size).toBe(sources.length);
  expect(sources).toEqual(expect.arrayContaining([
    "/",
    "/event/:path*",
    "/auth/:path*",
    "/account/:path*",
    "/checkout/:path*",
  ]));

  for (const rule of rules) {
    expect(rule.has).toBeUndefined();
    expect(rule.missing).toBeUndefined();
    expect(robotsHeaders(rule)).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  }

  const protectedPublicPaths = [
    "/e/minglanigeria/new-forms-collector-s-preview",
    "/t/mingla/lagos-weekend",
    "/exp/mingla/gallery-tour",
    "/b/mingla",
    "/b/mingla/v/rooftop",
    "/robots.txt",
    "/sitemap.xml",
    "/_expo/static/js/web/app.js",
    "/assets/logo.png",
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ];
  for (const requestPath of protectedPublicPaths) {
    expect(rules.filter((rule) => matches(rule.source, requestPath))).toEqual([]);
  }
};

const clonedConfig = (): VercelConfig => JSON.parse(JSON.stringify(config)) as VercelConfig;

describe("#2986 adversarial private/public Host search partition", () => {
  it("keeps private exclusion unconditional while preserving public and discovery ownership", () => {
    assertPrivatePartition(config);

    const publicSources = new Set([
      "/e/:brandSlug/:eventSlug",
      "/t/:brandSlug/:tripSlug",
      "/exp/:brandSlug/:experienceSlug",
      "/b/:brandSlug",
      "/b/:brandSlug/v/:venueSlug",
    ]);
    expect(config.rewrites.filter((rule) => publicSources.has(rule.source))).toHaveLength(5);
    expect(config.redirects.filter((rule) => publicSources.has(rule.source))).toHaveLength(5);

    expect(config.rewrites).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "/auth/callback", destination: "/auth/callback.html" }),
      expect.objectContaining({ source: "/stripe-onboarding-return", destination: "/stripe-onboarding-return.html" }),
      expect.objectContaining({ source: "/accept-brand-invitation", destination: "/accept-brand-invitation-entry" }),
    ]));
  });

  it("rejects crawler-only, incomplete, duplicate, and public-shadowing variants", () => {
    const conditional = clonedConfig();
    const conditionalEvent = conditional.headers.find((rule) => rule.source === "/event/:path*");
    expect(conditionalEvent).toBeDefined();
    conditionalEvent!.has = [{ type: "header", key: "user-agent", value: "Googlebot" }];
    expect(() => assertPrivatePartition(conditional)).toThrow();

    const incomplete = clonedConfig();
    const incompleteEvent = incomplete.headers.find((rule) => rule.source === "/event/:path*");
    expect(incompleteEvent).toBeDefined();
    incompleteEvent!.headers = [{ key: "X-Robots-Tag", value: "noindex" }];
    expect(() => assertPrivatePartition(incomplete)).toThrow();

    const duplicate = clonedConfig();
    const duplicateEvent = duplicate.headers.find((rule) => rule.source === "/event/:path*");
    expect(duplicateEvent).toBeDefined();
    duplicate.headers.push(JSON.parse(JSON.stringify(duplicateEvent)) as HeaderRule);
    expect(() => assertPrivatePartition(duplicate)).toThrow();

    const shadowing = clonedConfig();
    const shadowingEvent = shadowing.headers.find((rule) => rule.source === "/event/:path*");
    expect(shadowingEvent).toBeDefined();
    shadowingEvent!.source = "/:path*";
    expect(() => assertPrivatePartition(shadowing)).toThrow();
  });
});
