#!/usr/bin/env node
/**
 * ORCH-1094 — Business Web core parity wave guard.
 *
 * Locks one bundled route-graduation contract:
 * Event Create, Hub Events, Hub Trips, Marketing, Marketing Compose, and
 * Account are approved together; Experiences, Ari, and sessionless payout
 * account management remain blocked.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const APPROVED_ROUTES = [
  ["/event/create", 'data-orch-1094-core-route="event-create"'],
  ["/hub/events", 'data-orch-1094-core-route="hub-events"'],
  ["/hub/trips", 'data-orch-1094-core-route="hub-trips"'],
  ["/marketing", 'data-orch-1094-core-route="marketing-overview"'],
  ["/marketing/campaigns/compose", 'data-orch-1094-core-route="marketing-compose"'],
  ["/account", 'data-orch-1094-core-route="account"'],
];

const BLOCKED_ROUTES = [
  "/hub/experiences",
  "/ari",
  "/connect-account-management",
];

const ROUTE_CHUNKS = [
  ["/event/create", "app/event/create.tsx", ["CreateRouteTerminalState", "Getting your brand ready"]],
  ["/hub/events", "app/(tabs)/hub/events.tsx", ["Nothing created yet", "Build a new event"]],
  ["/hub/trips", "app/(tabs)/hub/trips.tsx", ["No trips yet", "Select a brand to see its trips."]],
  ["/marketing", "app/(tabs)/marketing/index.tsx", ["Blast these", "Marketing"]],
  [
    "/marketing/campaigns/compose",
    "app/(tabs)/marketing/campaigns/compose.tsx",
    ["ComposeCampaignRoute", "campaigns/compose"],
  ],
  ["/account", "app/(tabs)/account.tsx", ["Sign out everywhere", "Your brands"]],
];

function fail(message) {
  console.error(`ORCH-1094 business web core parity FAIL: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function assertIncludes(source, token, label) {
  if (!source.includes(token)) fail(`${label} missing required token: ${token}`);
}

function assertNotIncludes(source, token, label) {
  if (source.includes(token)) fail(`${label} must not include forbidden token: ${token}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRootStatuses(source) {
  const match = source.match(/const ORCH_1093_SIGNED_IN_ROUTE_STATUS = \{([\s\S]*?)\} as const;/);
  if (match === null) fail("app/_layout.tsx route status map not found");
  const statuses = new Map();
  for (const row of match[1].matchAll(/"([^"]+)": "([^"]+)"/g)) {
    statuses.set(row[1], row[2]);
  }
  return statuses;
}

function extractInjectorStatuses(source) {
  const match = source.match(/var map=\{([^}]+)\};return map\[path\]\|\|"approved"/);
  if (match === null) fail("injector route status map not found");
  const statuses = new Map();
  for (const row of match[1].matchAll(/"([^"]+)":"([^"]+)"/g)) {
    statuses.set(row[1], row[2]);
  }
  return statuses;
}

function scriptSrcsFromHtml(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)]
    .map((match) => match[1])
    .filter((src) => src.includes("/_expo/static/js/web/"));
}

function deferredScriptSrcsFromHtml(html) {
  const match = html.match(/var scripts=(\[[^\]]*\]);function isPhone/);
  if (match === null) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function distPathForScript(src, root = "dist") {
  return join(root, src.split("?")[0].replace(/^\//, ""));
}

function readDirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function walkFiles(root, predicate, acc = []) {
  if (!existsSync(root)) return acc;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkFiles(path, predicate, acc);
    else if (predicate(path)) acc.push(path);
  }
  return acc;
}

function findRouteChunkFromExpoMap(root, routeSource) {
  const webJsDir = join(root, "_expo/static/js/web");
  const routeKey = `./${routeSource.replace(/^app\//, "")}`;
  const indexFile = readDirSafe(webJsDir).find((name) => {
    if (!/^index-[a-f0-9]+\.js$/.test(name)) return false;
    return read(join(webJsDir, name)).includes(routeKey);
  });
  if (indexFile === undefined) return null;
  const source = read(join(webJsDir, indexFile));
  const routePattern = new RegExp(
    `${escapeRegExp(routeKey)}":\\{enumerable:!0,get:\\(\\)=>r\\(d\\[1\\]\\)\\(d\\[(\\d+)\\],d\\.paths\\)\\}`,
  );
  const routeMatch = source.match(routePattern);
  if (routeMatch === null) return null;
  const depIndex = routeMatch[1];
  const depsMatch = source.match(new RegExp(`"${depIndex}":(\\d+)`));
  if (depsMatch === null) return null;
  const moduleId = depsMatch[1];
  const pathMatch = source.match(new RegExp(`"${moduleId}":"([^"]+)"`));
  if (pathMatch === null) return null;
  return join(root, pathMatch[1].replace(/^\//, ""));
}

function findRouteChunk(root, routeSource, tokens) {
  const fromRouteMap = findRouteChunkFromExpoMap(root, routeSource);
  if (fromRouteMap !== null) return fromRouteMap;
  const html = read(join(root, "index.html"));
  const eagerNames = new Set(
    [...scriptSrcsFromHtml(html), ...deferredScriptSrcsFromHtml(html)]
      .map((src) => basename(distPathForScript(src, root))),
  );
  const candidates = walkFiles(join(root, "_expo/static/js/web"), (path) => path.endsWith(".js"))
    .filter((path) => !eagerNames.has(basename(path)));
  return candidates.find((path) => {
    const source = read(path);
    return source.includes(routeSource) || tokens.some((token) => source.includes(token));
  }) ?? null;
}

const home = read("public/home.html");
const rootLayout = read("app/_layout.tsx");
const injector = read("scripts/inject-mobile-blur-css.mjs");
const indexRoute = read("app/index.tsx");
const authRoute = read("app/auth/index.tsx");
const authCallbackRoute = read("app/auth/callback.tsx");
const mobileWebRedirect = read("src/utils/mobileWebStaticHomeRedirect.ts");

for (const [route, marker] of APPROVED_ROUTES) {
  assertIncludes(home, `href="${route}"`, "public/home.html");
  assertIncludes(home, marker, "public/home.html");
}

for (const route of BLOCKED_ROUTES) {
  assertNotIncludes(home, `href="${route}"`, "public/home.html");
  assertNotIncludes(home, `href='${route}'`, "public/home.html");
}
for (const target of ["hub-experiences", "ari-assistant", "payout-account"]) {
  assertIncludes(home, `data-shell-link="${target}"`, "public/home.html");
}
assertIncludes(home, "generated secure session", "public/home.html");
assertNotIncludes(home, "data-orch-1092-payout-session-reopened", "public/home.html");
for (const copy of ["Stripe account", "Connect Stripe", "Payments & Stripe"]) {
  assertNotIncludes(home, copy, "public/home.html");
}

const rootStatuses = extractRootStatuses(rootLayout);
const injectorStatuses = extractInjectorStatuses(injector);
for (const [route] of APPROVED_ROUTES) {
  if (rootStatuses.get(route) !== "approved") fail(`${route} is not approved in app/_layout.tsx`);
  if (injectorStatuses.get(route) !== "approved") fail(`${route} is not approved in injector`);
}
for (const route of BLOCKED_ROUTES) {
  if (rootStatuses.get(route) !== "blocked") fail(`${route} is not blocked in app/_layout.tsx`);
  if (injectorStatuses.get(route) !== "blocked") fail(`${route} is not blocked in injector`);
}
for (const route of [...APPROVED_ROUTES.map(([route]) => route), ...BLOCKED_ROUTES]) {
  if (rootStatuses.get(route) !== injectorStatuses.get(route)) {
    fail(`${route} status mismatch: root=${rootStatuses.get(route)} injector=${injectorStatuses.get(route)}`);
  }
}

assertIncludes(rootLayout, '"/hub/trips"', "app/_layout.tsx signed-out recovery routes");
assertIncludes(rootLayout, "Sign in to open {routeLabel}.", "app/_layout.tsx signed-out recovery");
assertIncludes(injector, 'status!=="approved"', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, "function hasSession()", "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, '"/marketing/campaigns/compose":"compose-blast"', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'location.replace("/home#"+target)', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(mobileWebRedirect, 'Platform.OS !== "web"', "src/utils/mobileWebStaticHomeRedirect.ts");
assertIncludes(mobileWebRedirect, 'window.location.replace("/home")', "src/utils/mobileWebStaticHomeRedirect.ts");
assertIncludes(mobileWebRedirect, "(max-width: 767px), (pointer: coarse)", "src/utils/mobileWebStaticHomeRedirect.ts");
for (const [source, label] of [
  [indexRoute, "app/index.tsx"],
  [authRoute, "app/auth/index.tsx"],
  [authCallbackRoute, "app/auth/callback.tsx"],
]) {
  assertIncludes(source, "redirectMobileBusinessWebToStaticHome", label);
}

if (existsSync(join("dist", "home.html"))) {
  const distHome = read(join("dist", "home.html"));
  for (const [route, marker] of APPROVED_ROUTES) {
    assertIncludes(distHome, `href="${route}"`, "dist/home.html");
    assertIncludes(distHome, marker, "dist/home.html");
  }
  for (const route of BLOCKED_ROUTES) assertNotIncludes(distHome, `href="${route}"`, "dist/home.html");
}

if (existsSync(join("dist", "index.html"))) {
  const distIndex = read(join("dist", "index.html"));
  for (const token of [
    "orch1091-js-cache-bust",
    "mingla-mobile-web-chunk-recovery",
    "mingla-mobile-web-home-preboot",
    "mingla-mobile-web-no-blur",
    "orch1093-mobile-route-script-deferral",
  ]) {
    assertIncludes(distIndex, token, "dist/index.html");
  }
  const deferred = deferredScriptSrcsFromHtml(distIndex);
  if (deferred.length === 0) fail("dist/index.html must defer Expo web scripts for phone route protection");
  const phoneBootPaths = [...scriptSrcsFromHtml(distIndex), ...deferred].map((src) =>
    distPathForScript(src),
  );
  const phoneBoot = phoneBootPaths.reduce((sum, path) => sum + statSync(path).size, 0);
  const common = phoneBootPaths.find((path) => basename(path).startsWith("__common-"));
  if (common === undefined) fail("dist/index.html boot scripts must include __common");
  console.log(`ORCH-1094 bundle evidence phoneBoot=${phoneBoot}; __common=${statSync(common).size}; deferred=true`);
  for (const [route, source, tokens] of ROUTE_CHUNKS) {
    const chunk = findRouteChunk("dist", source, tokens);
    if (chunk === null) fail(`could not resolve deferred route chunk for ${route}`);
    console.log(`ORCH-1094 route chunk ${route} ${basename(chunk)} ${statSync(chunk).size}`);
  }
}

console.log("ORCH-1094 business web core parity PASS.");
