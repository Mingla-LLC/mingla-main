import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

const businessRoot = path.resolve(__dirname, "../..");
const appRoot = path.join(businessRoot, "app");
const config = JSON.parse(readFileSync(path.join(businessRoot, "vercel.json"), "utf8")) as {
  headers: HeaderRule[];
  rewrites: Array<{ source: string; destination: string }>;
};

const robotsValue = (rule: HeaderRule): string | undefined =>
  rule.headers.find((header) => header.key.toLowerCase() === "x-robots-tag")?.value;

const privateRules = config.headers.filter((rule) => robotsValue(rule) !== undefined);

const matches = (source: string, requestPath: string): boolean => {
  if (source === requestPath) return true;
  if (!source.endsWith("/:path*")) return false;
  const prefix = source.slice(0, -"/:path*".length);
  return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
};

const robotsFor = (requestPath: string): string[] =>
  privateRules.filter((rule) => matches(rule.source, requestPath)).map((rule) => robotsValue(rule) as string);

const routeName = (fileName: string): string =>
  fileName.replace(/\.web\.(?:tsx?|jsx?)$/, "").replace(/\.(?:tsx?|jsx?)$/, "");

const visibleChildren = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("_") && !entry.name.startsWith("+") && entry.name !== "__tests__")
    .map((entry) => entry.isDirectory() ? entry.name : routeName(entry.name));

const publicRouteFamilies = new Set(["b", "e", "exp", "t"]);
const privateRouteFamilies = new Set<string>();

for (const entry of readdirSync(appRoot, { withFileTypes: true })) {
  if (entry.name === "(tabs)") {
    for (const child of visibleChildren(path.join(appRoot, entry.name))) privateRouteFamilies.add(child);
    continue;
  }
  if (entry.name.startsWith("+") || entry.name === "_layout.tsx" || entry.name === "__tests__") continue;
  const name = entry.isDirectory() ? entry.name : routeName(entry.name);
  if (name === "index" || publicRouteFamilies.has(name)) continue;
  privateRouteFamilies.add(name);
}

describe("#2986 private Host routes stay out of search", () => {
  it("marks every current private Expo route family noindex and nofollow", () => {
    expect(robotsFor("/")).toContain("noindex, nofollow");
    for (const family of privateRouteFamilies) {
      expect(config.headers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: `/${family}/:path*`,
          headers: expect.arrayContaining([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
        }),
      ]));
    }
  });

  it("protects the indexed guest-management path and direct callback documents", () => {
    expect(robotsFor("/event/18210000-0000-4000-8000-000000000302/guests")).toEqual(["noindex, nofollow"]);
    expect(robotsFor("/event/18210000-0000-4000-8000-000000000302/preview")).toEqual(["noindex, nofollow"]);
    expect(robotsFor("/auth/callback.html")).toContain("noindex, nofollow");
    expect(robotsFor("/stripe-onboarding-return.html")).toContain("noindex, nofollow");
    expect(robotsFor("/accept-brand-invitation-entry")).toContain("noindex, nofollow");
  });

  it("does not override resolver-owned public pages or static discovery assets", () => {
    const publicPaths = [
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
    for (const requestPath of publicPaths) expect(robotsFor(requestPath)).toEqual([]);

    const publicSources = new Set([
      "/e/:brandSlug/:eventSlug",
      "/t/:brandSlug/:tripSlug",
      "/exp/:brandSlug/:experienceSlug",
      "/b/:brandSlug",
      "/b/:brandSlug/v/:venueSlug",
    ]);
    expect(config.rewrites.filter((rewrite) => publicSources.has(rewrite.source))).toHaveLength(5);
  });
});
