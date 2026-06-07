#!/usr/bin/env node
/**
 * ORCH-1095 — Business Web interactive parity wave guard.
 *
 * Fails the old ORCH-1094 contract where signed-in phone-browser users for
 * Hub Events, Hub Trips, Marketing, Compose, and Account were redirected to
 * static Home anchors before Expo app JavaScript could load.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const INTERACTIVE_ROUTES = [
  ["/", "app/index.tsx", "auth-root", 120_000, ["BusinessWelcomeScreen", "signInWithGoogle"]],
  ["/auth", "app/auth/index.tsx", "auth-index", 120_000, ["BusinessWelcomeScreen", "signInWithGoogle"]],
  ["/auth/callback", "app/auth/callback.tsx", "auth-callback", 120_000, ["auth/v1/callback", "Redirect"]],
  ["/hub/events", "app/(tabs)/hub/events.tsx", "hub-events", 120_000, ["Nothing created yet", "Build a new event"]],
  ["/hub/trips", "app/(tabs)/hub/trips.tsx", "hub-trips", 80_000, ["No trips yet", "Select a brand to see its trips."]],
  ["/marketing", "app/(tabs)/marketing/index.tsx", "marketing-overview", 150_000, ["Blast these", "Marketing"]],
  ["/marketing/campaigns/compose", "app/(tabs)/marketing/campaigns/compose.tsx", "marketing-compose", 600_000, ["Compose blast", "campaigns/compose"]],
  ["/account", "app/(tabs)/account.tsx", "account", 120_000, ["Sign out everywhere", "Your brands"]],
];

const BLOCKED_ROUTES = [
  "/hub/experiences",
  "/ari",
  "/connect-account-management",
];

const FORBIDDEN_NATIVE_PROVIDER_TOKENS = [
  "expo-image-picker",
  "expo-file-system",
  "expo-file-system/legacy",
  "react-native-compressor",
  "react-native-video-trim",
  "@react-native-community/datetimepicker",
  "@stripe/connect-js",
  "@stripe/react-connect-js",
];

const FORBIDDEN_ROUTE_BODY_TOKENS = [
  "from \"../../../src/components/ui/ShareModal\"",
  "from \"../../../src/components/offering/OfferingManageSheet\"",
  "from \"../../../src/components/event/EventManageMenu\"",
  "from \"../../../src/components/event/EndSalesSheet\"",
  "from \"../../src/components/brand/BrandSwitcherSheet\"",
  "from \"../../src/components/brand/BrandDeleteSheet\"",
  "from \"../../src/components/ui/UniversalCreatorSheet\"",
  "from \"../../../src/components/brand/BrandSwitcherSheet\"",
  "from \"../../../src/components/brand/BrandDeleteSheet\"",
  "from \"../../../src/components/ui/UniversalCreatorSheet\"",
];

function fail(message) {
  console.error(`ORCH-1095 business web interactive parity FAIL: ${message}`);
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

function walkFiles(root, acc = []) {
  if (!existsSync(root)) return acc;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkFiles(path, acc);
    else if (path.endsWith(".js")) acc.push(path);
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
  return walkFiles(join(root, "_expo/static/js/web")).find((path) => {
    if (eagerNames.has(basename(path))) return false;
    const source = read(path);
    return source.includes(routeSource) || tokens.some((token) => source.includes(token));
  }) ?? null;
}

const home = read("public/home.html");
const rootLayout = read("app/_layout.tsx");
const injector = read("scripts/inject-mobile-blur-css.mjs");

for (const [route, _source, marker] of INTERACTIVE_ROUTES) {
  if (marker !== "auth-root" && marker !== "auth-index" && marker !== "auth-callback") {
    assertIncludes(home, `href="${route}"`, "public/home.html");
    assertIncludes(home, `data-orch-1095-interactive-route="${marker}"`, "public/home.html");
  }
  assertIncludes(rootLayout, `"${route}": "interactive"`, "app/_layout.tsx");
  assertIncludes(injector, `"${route}":"interactive"`, "scripts/inject-mobile-blur-css.mjs");
}

assertIncludes(rootLayout, '"/event/create": "interactive"', "app/_layout.tsx");
assertIncludes(injector, '"/event/create":"interactive"', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(rootLayout, '] ?? "static-section"', "app/_layout.tsx");
assertIncludes(injector, 'return map[path]||"static-section"', "scripts/inject-mobile-blur-css.mjs");
assertNotIncludes(injector, 'location.replace("/home#"+target)', "scripts/inject-mobile-blur-css.mjs");
assertNotIncludes(injector, 'status==="approved"', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'status!=="interactive"', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'data-orch-1095-light-route-entry="true"', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'status==="interactive"&&isLightRoute(path)', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'renderRoute(path,session);return', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'business_management_events_view', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'marketing_campaigns', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'currentBrandId()', "scripts/inject-mobile-blur-css.mjs");
assertIncludes(injector, 'resolvePublicConfig("EXPO_PUBLIC_SUPABASE_ANON_KEY")', "scripts/inject-mobile-blur-css.mjs");
assertNotIncludes(injector, ["eyJ", "hbGciOiJI"].join(""), "scripts/inject-mobile-blur-css.mjs");
for (const token of [
  '"/account/edit-profile"',
  '"/brand/"+b.id',
  '"/marketing/campaigns/"+c.id',
  '"/trip/"+t.id',
  '"/trip/create"',
  '"/event/"+e.id+"/edit"',
  '"Save draft in full composer"',
]) {
  assertNotIncludes(injector, token, "scripts/inject-mobile-blur-css.mjs");
}
for (const token of ['"/home#account"', '"/home#hub-trips"', '"/home#hub-events"', '"Return to marketing"']) {
  assertIncludes(injector, token, "scripts/inject-mobile-blur-css.mjs");
}

for (const route of BLOCKED_ROUTES) {
  assertNotIncludes(home, `href="${route}"`, "public/home.html");
  assertIncludes(rootLayout, `"${route}": "blocked"`, "app/_layout.tsx");
  assertIncludes(injector, `"${route}":"blocked"`, "scripts/inject-mobile-blur-css.mjs");
}
for (const shell of ["hub-experiences", "ari-assistant", "payout-account"]) {
  assertIncludes(home, `data-shell-link="${shell}"`, "public/home.html");
}
assertIncludes(home, "generated secure session", "public/home.html");
for (const copy of ["Connect Stripe", "Payments & Stripe", "Stripe account"]) {
  assertNotIncludes(home, copy, "public/home.html");
}
for (const expoToken of ["/_expo/static", "expo-router", "data-orch1091-js-cache-bust"]) {
  assertNotIncludes(home, expoToken, "public/home.html");
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
  assertIncludes(distIndex, '"/hub/events":"interactive"', "dist/index.html");
  assertIncludes(distIndex, 'data-orch-1095-light-route-entry="true"', "dist/index.html");
  assertIncludes(distIndex, 'status==="interactive"&&isLightRoute(path)', "dist/index.html");
  assertIncludes(distIndex, 'renderRoute(path,session);return', "dist/index.html");
  assertNotIncludes(distIndex, 'location.replace("/home#"+target)', "dist/index.html");

  const phoneBootPaths = [...scriptSrcsFromHtml(distIndex), ...deferredScriptSrcsFromHtml(distIndex)].map((src) =>
    distPathForScript(src),
  );
  const phoneBoot = phoneBootPaths.reduce((sum, path) => sum + statSync(path).size, 0);
  const bootSource = phoneBootPaths.map((path) => read(path)).join("\n");
  for (const token of FORBIDDEN_NATIVE_PROVIDER_TOKENS) {
    assertNotIncludes(bootSource, token, "phone boot chunks");
  }
  console.log(`ORCH-1095 bundle evidence phoneBoot=${phoneBoot}; deferred=true`);

  for (const [route, source, _marker, budget, tokens] of INTERACTIVE_ROUTES) {
    const chunk = findRouteChunk("dist", source, tokens);
    if (chunk === null) fail(`could not resolve deferred route chunk for ${route}`);
    const bytes = statSync(chunk).size;
    if (bytes > budget) fail(`${route} route chunk ${basename(chunk)} is ${bytes} bytes; budget ${budget}`);
    const routeSource = read(chunk);
    for (const token of [...FORBIDDEN_NATIVE_PROVIDER_TOKENS, ...FORBIDDEN_ROUTE_BODY_TOKENS]) {
      assertNotIncludes(routeSource, token, `${route} route-entry chunk ${basename(chunk)}`);
    }
    console.log(`ORCH-1095 route chunk ${route} ${basename(chunk)} ${bytes}`);
  }
}

console.log("ORCH-1095 business web interactive parity guard PASS");
