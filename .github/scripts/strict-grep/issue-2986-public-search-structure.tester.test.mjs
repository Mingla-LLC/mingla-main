// Issue #3025 independent tester proof for #2986 private/public search partitioning.
//
// This suite deliberately does not import the implementor evaluator. It walks the
// real Expo route tree into concrete request paths, parses the real Vercel config,
// and asks whether every private leaf has exactly one unconditional, complete
// robots owner while public, static, and discovery paths have none.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = path.join(REPO, "mingla-business", "app");
const VERCEL_PATH = process.env.MINGLA_3025_VERCEL_CONFIG ||
  path.join(REPO, "mingla-business", "vercel.json");

const PUBLIC_NAMESPACES = new Set(["b", "e", "exp", "t"]);
const DIRECT_PRIVATE_PATHS = [
  "/accept-brand-invitation-entry",
  "/auth/callback.html",
  "/stripe-onboarding-return.html",
];
const PUBLIC_PATH_GROUPS = Object.freeze({
  resolver: [
    "/e/acme/opening-night",
    "/t/acme/lagos-weekend",
    "/exp/acme/gallery-tour",
    "/b/acme",
    "/b/acme/v/rooftop",
  ],
  static: [
    "/_expo/static/js/web/app.js",
    "/assets/mingla-logo.png",
    "/favicon.ico",
  ],
  discovery: [
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ],
});
const ALL_PUBLIC_PATHS = Object.values(PUBLIC_PATH_GROUPS).flat();

function routeName(fileName) {
  return fileName
    .replace(/\.web\.(?:[jt]sx?)$/, "")
    .replace(/\.(?:[jt]sx?)$/, "");
}

function concreteSegment(segment) {
  if (/^\[\.\.\..+\]$/.test(segment)) return "probe/tail";
  if (/^\[.+\]$/.test(segment)) return "probe";
  return segment;
}

function discoverRouteLeaves(directory = APP_ROOT, segments = []) {
  const leaves = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "_layout.tsx" || entry.name.startsWith("+")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const transparentGroup = /^\(.+\)$/.test(entry.name);
      leaves.push(...discoverRouteLeaves(absolute, transparentGroup ? segments : [...segments, entry.name]));
      continue;
    }
    if (!/\.(?:[jt]sx?)$/.test(entry.name)) continue;
    const name = routeName(entry.name);
    const routeSegments = name === "index" ? segments : [...segments, name];
    leaves.push(routeSegments.length === 0
      ? "/"
      : `/${routeSegments.map(concreteSegment).join("/")}`);
  }
  return [...new Set(leaves)].sort();
}

function isPrivateRoute(requestPath) {
  if (requestPath === "/") return true;
  return !PUBLIC_NAMESPACES.has(requestPath.split("/")[1]);
}

function matchesSource(source, requestPath) {
  if (source === requestPath) return true;
  if (typeof source !== "string" || !source.endsWith("/:path*")) return false;
  const prefix = source.slice(0, -"/:path*".length);
  return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

function robotsHeaders(rule) {
  return Array.isArray(rule?.headers)
    ? rule.headers.filter((header) => header?.key?.toLowerCase() === "x-robots-tag")
    : [];
}

function robotsRules(config) {
  return Array.isArray(config?.headers)
    ? config.headers.filter((rule) => robotsHeaders(rule).length > 0)
    : [];
}

function normalizedDirectives(header) {
  return typeof header?.value === "string"
    ? header.value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)
    : [];
}

function inspectPartition(config, routeLeaves = discoverRouteLeaves()) {
  const errors = [];
  const fail = (code, detail) => errors.push(`${code}: ${detail}`);
  if (!Array.isArray(config?.headers)) return ["CONFIG_SHAPE: headers must be an array"];

  const rules = robotsRules(config);
  if (rules.length < 35) fail("ROBOTS_VACUOUS", `only ${rules.length} X-Robots rules found`);

  const counts = new Map();
  for (const rule of rules) {
    counts.set(rule.source, (counts.get(rule.source) ?? 0) + 1);
    const tagged = robotsHeaders(rule);
    if (tagged.length !== 1) fail("HEADER_CARDINALITY", `${rule.source} has ${tagged.length} X-Robots headers`);
    const directives = tagged.length === 1 ? normalizedDirectives(tagged[0]) : [];
    if (directives.length !== 2 || !directives.includes("noindex") || !directives.includes("nofollow")) {
      fail("HEADER_INCOMPLETE", `${rule.source} must contain exactly noindex and nofollow`);
    }
    if (Object.hasOwn(rule, "has") || Object.hasOwn(rule, "missing")) {
      fail("HEADER_CONDITIONAL", `${rule.source} is request-conditional`);
    }
    if (rule.source !== "/" && rule.source !== "/stripe-onboarding-return.html" &&
        !/^\/[A-Za-z0-9_-]+\/:path\*$/.test(rule.source)) {
      fail("SOURCE_TOO_BROAD", `${rule.source} is outside the closed private-owner grammar`);
    }
  }
  for (const [source, count] of counts) {
    if (count !== 1) fail("SOURCE_DUPLICATE", `${source} occurs ${count} times`);
  }

  const privateLeaves = routeLeaves.filter(isPrivateRoute);
  if (routeLeaves.length < 100 || privateLeaves.length < 80) {
    fail("ROUTE_INVENTORY_VACUOUS", `${routeLeaves.length} total / ${privateLeaves.length} private leaves`);
  }
  for (const requestPath of [...privateLeaves, ...DIRECT_PRIVATE_PATHS]) {
    const owners = rules.filter((rule) => matchesSource(rule.source, requestPath));
    if (owners.length !== 1) fail("PRIVATE_OWNER", `${requestPath} has ${owners.length} owners`);
  }
  for (const requestPath of ALL_PUBLIC_PATHS) {
    const owners = rules.filter((rule) => matchesSource(rule.source, requestPath));
    if (owners.length !== 0) fail("PUBLIC_CAPTURE", `${requestPath} captured by ${owners.map((r) => r.source).join(",")}`);
  }

  const ownedPrivatePaths = [...privateLeaves, ...DIRECT_PRIVATE_PATHS];
  for (const rule of rules) {
    if (!ownedPrivatePaths.some((requestPath) => matchesSource(rule.source, requestPath))) {
      fail("ORPHAN_OWNER", `${rule.source} owns no real private route`);
    }
  }
  return errors;
}

function readRealConfig() {
  return JSON.parse(fs.readFileSync(VERCEL_PATH, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function privateRule(config, source = "/event/:path*") {
  const rule = robotsRules(config).find((candidate) => candidate.source === source);
  assert.ok(rule, `fixture missing ${source}`);
  return rule;
}

function expectRejected(config, code) {
  const errors = inspectPartition(config);
  assert.ok(errors.some((error) => error.startsWith(`${code}:`)),
    `expected ${code}, received:\n${errors.join("\n")}`);
}

test("the real route tree has one complete unconditional robots owner per private leaf", () => {
  const leaves = discoverRouteLeaves();
  const privateFamilies = new Set(leaves.filter(isPrivateRoute).filter((p) => p !== "/").map((p) => p.split("/")[1]));
  assert.equal(privateFamilies.size, 38, "current private family inventory must be explicit and non-vacuous");
  assert.deepEqual(inspectPartition(readRealConfig(), leaves), []);
});

test("missing, conditional, incomplete, duplicate, and broad private ownership all fail closed", async (t) => {
  const clean = readRealConfig();
  const mutants = [
    ["missing route owner", "PRIVATE_OWNER", (config) => {
      config.headers = config.headers.filter((rule) => rule.source !== "/event/:path*");
    }],
    ["crawler-conditional owner", "HEADER_CONDITIONAL", (config) => {
      privateRule(config).has = [{ type: "header", key: "user-agent", value: "Googlebot" }];
    }],
    ["missing nofollow", "HEADER_INCOMPLETE", (config) => {
      privateRule(config).headers[0].value = "noindex";
    }],
    ["duplicate source", "SOURCE_DUPLICATE", (config) => {
      config.headers.push(clone(privateRule(config)));
    }],
    ["overlapping private owners", "PRIVATE_OWNER", (config) => {
      config.headers.push({ source: "/event/probe", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
    }],
    ["site-wide public shadow", "SOURCE_TOO_BROAD", (config) => {
      config.headers.push({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
    }],
    ["regex-shaped public shadow", "SOURCE_TOO_BROAD", (config) => {
      config.headers.push({ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
    }],
    ["two X-Robots values in one rule", "HEADER_CARDINALITY", (config) => {
      privateRule(config).headers.push({ key: "x-robots-tag", value: "index, follow" });
    }],
    ["orphan private rule", "ORPHAN_OWNER", (config) => {
      config.headers.push({ source: "/not-a-real-route/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
    }],
  ];
  for (const [name, code, mutate] of mutants) {
    await t.test(name, () => {
      const config = clone(clean);
      mutate(config);
      expectRejected(config, code);
    });
  }
});

test("resolver, static, and discovery paths cannot be captured by private robots rules", async (t) => {
  const clean = readRealConfig();
  for (const [group, requestPaths] of Object.entries(PUBLIC_PATH_GROUPS)) {
    await t.test(group, () => {
      const config = clone(clean);
      for (const source of requestPaths) {
        config.headers.push({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
      }
      expectRejected(config, "PUBLIC_CAPTURE");
    });
  }
});

test("public namespace wildcards cannot hide resolver families", () => {
  const config = readRealConfig();
  config.headers.push({ source: "/b/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
  expectRejected(config, "PUBLIC_CAPTURE");
});
