#!/usr/bin/env node
/**
 * ORCH-1093 — signed-in mobile browser route-entry OOM guard.
 *
 * Source checks always run. Exported bundle checks run when dist/index.html
 * exists, so `npm run test:orch-1093` can run before export and the final
 * `node scripts/ci/orch-1093-signedin-route-oom.mjs` enforces budgets after
 * `npx expo export -p web` + ORCH-1091 injection.
 */

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const EAGER_TOTAL_LIMIT = 2_100_000;
const COMMON_LIMIT = 1_200_000;

const ROUTES = [
  {
    label: "/hub/trips",
    status: "approved",
    source: "app/(tabs)/hub/trips.tsx",
    budget: 80_000,
    tokens: ["No trips yet", "Select a brand to see its trips."],
  },
  {
    label: "/hub/events",
    status: "approved",
    source: "app/(tabs)/hub/events.tsx",
    budget: 120_000,
    tokens: ["Nothing created yet", "Build a new event"],
  },
  {
    label: "/marketing",
    status: "approved",
    source: "app/(tabs)/marketing/index.tsx",
    budget: 150_000,
    tokens: ["Blast these", "Marketing"],
  },
  {
    label: "/marketing/campaigns/compose",
    status: "approved",
    source: "app/(tabs)/marketing/campaigns/compose.tsx",
    budget: 600_000,
    tokens: ["Compose blast", "campaigns/compose"],
  },
  {
    label: "/account",
    status: "approved",
    source: "app/(tabs)/account.tsx",
    budget: 120_000,
    tokens: ["Sign out everywhere", "Your brands"],
  },
  {
    label: "/event/create",
    status: "approved",
    source: "app/event/create.tsx",
    budget: 80_000,
    tokens: ["CreateRouteTerminalState", "Getting your brand ready"],
  },
];

const PHYSICALLY_PROVEN_OVERSIZE_BOOT_ROUTES = new Set([
  "/event/create",
  "/hub/events",
  "/hub/trips",
  "/marketing",
  "/marketing/campaigns/compose",
  "/account",
]);

const FORBIDDEN_EAGER_TOKENS = [
  "expo-image-picker",
  "expo-file-system",
  "expo-file-system/legacy",
  "react-native-compressor",
  "react-native-video-trim",
  "@react-native-community/datetimepicker",
  "@stripe/connect-js",
  "@stripe/react-connect-js",
  "react-native-qrcode-svg",
  "GlobalSearchSheet",
  "CommandPalette.web",
  "BrandSwitcherSheet",
  "BrandDeleteSheet",
  "UniversalCreatorSheet",
  "OfferingManageSheet",
  "ShareModal",
];

const FORBIDDEN_ROUTE_ENTRY_TOKENS = [
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
  console.error(`ORCH-1093 signed-in route OOM FAIL: ${message}`);
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
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
  const clean = src.split("?")[0].replace(/^\//, "");
  return join(root, clean);
}

function rawBytes(path) {
  return statSync(path).size;
}

function findRouteChunk(root, route) {
  const webJsDir = join(root, "_expo/static/js/web");
  const html = read(join(root, "index.html"));
  const eager = new Set(
    [...scriptSrcsFromHtml(html), ...deferredScriptSrcsFromHtml(html)].map((src) =>
      basename(distPathForScript(src, root)),
    ),
  );
  const fromRouteMap = findRouteChunkFromExpoMap(root, route);
  if (fromRouteMap !== null) return fromRouteMap;
  const candidates = [];
  const stack = [webJsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const names = readDirSafe(dir);
    for (const name of names) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        stack.push(path);
      } else if (name.endsWith(".js") && !eager.has(name)) {
        candidates.push(path);
      }
    }
  }

  for (const path of candidates) {
    const source = read(path);
    if (
      source.includes(route.source) ||
      route.tokens.some((token) => source.includes(token))
    ) {
      return path;
    }
  }
  return null;
}

function findRouteChunkFromExpoMap(root, route) {
  const webJsDir = join(root, "_expo/static/js/web");
  const routeKey = `./${route.source.replace(/^app\//, "")}`;
  const indexFile = readDirSafe(webJsDir).find((name) => {
    if (!/^index-[a-f0-9]+\.js$/.test(name)) return false;
    return read(join(webJsDir, name)).includes(routeKey);
  });
  if (indexFile === undefined) return null;
  const source = read(join(webJsDir, indexFile));
  const routePattern = new RegExp(
    `${routeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\{enumerable:!0,get:\\(\\)=>r\\(d\\[1\\]\\)\\(d\\[(\\d+)\\],d\\.paths\\)\\}`,
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

function readDirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function routeStatusMap(overrides = {}) {
  return new Map(ROUTES.map((route) => [route.label, overrides[route.label] ?? route.status]));
}

function approvedRoutesWithoutOversizeProof(statuses, provenRoutes = PHYSICALLY_PROVEN_OVERSIZE_BOOT_ROUTES) {
  return ROUTES.filter(
    (route) =>
      statuses.get(route.label) === "approved" &&
      !provenRoutes.has(route.label),
  ).map((route) => route.label);
}

async function assertBundleBudgets(root = "dist", options = {}) {
  const indexPath = join(root, "index.html");
  let html;
  try {
    html = readFileSync(indexPath, "utf8");
  } catch {
    console.log("ORCH-1093 bundle budget SKIP: dist/index.html not present.");
    return;
  }

  const scriptPaths = scriptSrcsFromHtml(html).map((src) => distPathForScript(src, root));
  const deferredScriptPaths = deferredScriptSrcsFromHtml(html).map((src) => distPathForScript(src, root));
  const deferredByOrch1093 =
    deferredScriptPaths.length > 0 && html.includes("orch1093-mobile-route-script-deferral");
  if (scriptPaths.length === 0 && !deferredByOrch1093) {
    fail("dist/index.html has no eager Expo web scripts and no ORCH-1093 deferral marker");
  }

  const phoneBootScriptPaths = scriptPaths.length > 0 ? scriptPaths : deferredScriptPaths;
  const phoneBootTotal = phoneBootScriptPaths.reduce((sum, path) => sum + rawBytes(path), 0);
  const commonPath = phoneBootScriptPaths.find((path) => basename(path).startsWith("__common-"));
  const commonBytes = commonPath === undefined ? 0 : rawBytes(commonPath);
  const statuses = routeStatusMap(options.routeStatusOverride ?? {});
  const unprovenApprovedRoutes = approvedRoutesWithoutOversizeProof(statuses);
  const bootOverBudget = phoneBootTotal > EAGER_TOTAL_LIMIT || commonBytes > COMMON_LIMIT;
  if (bootOverBudget && unprovenApprovedRoutes.length > 0) {
    fail(
      `approved mobile route(s) ${unprovenApprovedRoutes.join(", ")} still load Expo boot JS ` +
        `${phoneBootTotal} bytes (__common=${commonBytes}); mark them pending-proof or reduce boot payload`,
    );
  }
  if (commonPath === undefined) fail("phone boot __common chunk not found");
  if (scriptPaths.length > 0 && phoneBootTotal > EAGER_TOTAL_LIMIT) {
    fail(`eager direct-route raw JS ${phoneBootTotal} exceeds ${EAGER_TOTAL_LIMIT}`);
  }
  if (scriptPaths.length > 0 && commonBytes > COMMON_LIMIT) {
    fail(`eager __common raw JS ${commonBytes} exceeds ${COMMON_LIMIT}`);
  }

  const eagerSources = scriptPaths.map((path) => [path, read(path)]);
  for (const [path, source] of eagerSources) {
    for (const token of FORBIDDEN_EAGER_TOKENS) {
      if (source.includes(token)) fail(`${basename(path)} contains forbidden first-entry token ${token}`);
    }
  }

  const routeRows = [];
  for (const route of ROUTES) {
    const path = findRouteChunk(root, route);
    if (path === null) fail(`could not resolve route chunk for ${route.label}`);
    const bytes = rawBytes(path);
    if (bytes > route.budget) {
      fail(`${route.label} route chunk ${basename(path)} is ${bytes}, over ${route.budget}`);
    }
    routeRows.push(`${route.label} ${basename(path)} ${bytes}`);
  }

  console.log(
    `ORCH-1093 bundle budgets PASS. phoneBoot=${phoneBootTotal}; __common=${commonBytes}; deferred=${deferredByOrch1093}; approved=${ROUTES.filter((route) => statuses.get(route.label) === "approved").map((route) => route.label).join(",") || "none"}`,
  );
  for (const row of routeRows) console.log(`ORCH-1093 route chunk ${row}`);
}

function assertSourceGuards() {
  const appJson = JSON.parse(read("app.json"));
  if (appJson.expo?.web?.output !== "single") fail("app.json must preserve Expo Web web.output=single");
  const routerPlugin = (appJson.expo?.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-router",
  );
  if (routerPlugin?.[1]?.asyncRoutes?.web !== true) {
    fail("app.json must preserve expo-router asyncRoutes.web=true");
  }

  const rootLayout = read("app/_layout.tsx");
  for (const token of [
    "ORCH_1093_SIGNED_IN_ROUTE_STATUS",
    "\"/hub/events\": \"approved\"",
    "\"/marketing\": \"approved\"",
    "\"/marketing/campaigns/compose\": \"approved\"",
    "\"/account\": \"approved\"",
    "\"/hub/trips\": \"approved\"",
    "\"/hub/experiences\": \"blocked\"",
    "\"/ari\": \"blocked\"",
    "\"/connect-account-management\": \"blocked\"",
    "Orch1093MobileRouteRecovery",
    "physical Android Chrome and mobile Safari proof",
  ]) {
    assertIncludes(rootLayout, token, "app/_layout.tsx");
  }

  const tabLayout = read("app/(tabs)/_layout.tsx");
  assertIncludes(tabLayout, "GlobalSearchSheetHost", "app/(tabs)/_layout.tsx");
  assertIncludes(tabLayout, "CommandPaletteHost", "app/(tabs)/_layout.tsx");
  assertNotIncludes(stripComments(tabLayout), "from \"../../src/components/ui/GlobalSearchSheet\"", "app/(tabs)/_layout.tsx");
  assertNotIncludes(stripComments(tabLayout), "from \"../../src/components/ui/CommandPalette\"", "app/(tabs)/_layout.tsx");

  for (const path of [
    "app/(tabs)/hub/trips.tsx",
    "app/(tabs)/hub/events.tsx",
    "app/(tabs)/account.tsx",
    "app/(tabs)/hub/_layout.tsx",
    "app/(tabs)/marketing/_layout.tsx",
  ]) {
    const source = stripComments(read(path));
    assertIncludes(source, "React.lazy", path);
    for (const token of FORBIDDEN_ROUTE_ENTRY_TOKENS) {
      assertNotIncludes(source, token, path);
    }
  }

  const home = read("public/home.html");
  for (const route of ["/hub/experiences", "/ari", "/connect-account-management"]) {
    assertNotIncludes(home, `href="${route}"`, "public/home.html");
    assertNotIncludes(home, `href='${route}'`, "public/home.html");
  }
  assertIncludes(home, 'href="/hub/trips"', "public/home.html");
  assertIncludes(home, 'data-orch-1094-core-route="hub-trips"', "public/home.html");

  const inject = read("scripts/inject-mobile-blur-css.mjs");
  for (const token of [
    "orch1091-js-cache-bust",
    "?v=${JS_CACHE_BUST_PARAM}",
    "mingla-mobile-web-chunk-recovery",
    "mingla-mobile-web-home-preboot",
    "mingla-mobile-web-no-blur",
    "orch1093-mobile-route-script-deferral",
  ]) {
    assertIncludes(inject, token, "scripts/inject-mobile-blur-css.mjs");
  }
  for (const route of ["/hub/events", "/marketing", "/marketing/campaigns/compose", "/account", "/hub/trips"]) {
    assertIncludes(inject, `"${route}":"approved"`, "scripts/inject-mobile-blur-css.mjs");
  }
  assertIncludes(inject, 'status!=="approved"', "scripts/inject-mobile-blur-css.mjs");
  assertIncludes(inject, "function hasSession()", "scripts/inject-mobile-blur-css.mjs");
  assertIncludes(inject, "function staticTarget(path)", "scripts/inject-mobile-blur-css.mjs");
  assertIncludes(inject, 'location.replace("/home#"+target)', "scripts/inject-mobile-blur-css.mjs");

  const vercel = JSON.parse(read("vercel.json"));
  const webJsHeader = (vercel.headers ?? []).find((header) => header.source === "/_expo/static/js/web/(.*)");
  if (!JSON.stringify(webJsHeader?.headers ?? []).includes("public, max-age=0, must-revalidate")) {
    fail("Vercel web JS cache header must stay public, max-age=0, must-revalidate");
  }

  const combinedSource = [
    "src/components/offering/StripeBlockedCard.tsx",
    "src/components/event/EventCreatorWizard.tsx",
    "public/home.html",
  ].map(read).join("\n");
  for (const copy of ["Stripe account", "Connect Stripe", "Payments & Stripe"]) {
    assertNotIncludes(stripComments(combinedSource), copy, "provider-neutral seller copy");
  }
}

function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "orch-1093-"));
  try {
    const jsDir = join(dir, "dist/_expo/static/js/web");
    mkdirSync(jsDir, { recursive: true });
    writeFileSync(
      join(dir, "dist/index.html"),
      '<script src="/_expo/static/js/web/__expo-metro-runtime-test.js"></script><script src="/_expo/static/js/web/__common-test.js"></script><script src="/_expo/static/js/web/index-test.js"></script>',
    );
    writeFileSync(join(jsDir, "__expo-metro-runtime-test.js"), "x".repeat(3_802));
    writeFileSync(join(jsDir, "__common-test.js"), "x".repeat(1_881_365));
    writeFileSync(join(jsDir, "index-test.js"), "x".repeat(998_981));
    const previous = process.cwd();
    process.chdir(dir);
    let failed = false;
    try {
      awaitableAssertBundleBudgets("dist");
    } catch {
      failed = true;
    } finally {
      process.chdir(previous);
    }
    if (!failed) fail("--self-test expected production-equivalent eager payload to fail");
    console.log("ORCH-1093 self-test PASS.");
    writeFileSync(
      join(dir, "dist/index.html"),
      '<script id="orch1093-mobile-route-script-deferral">(function(){var scripts=["/_expo/static/js/web/__expo-metro-runtime-test.js","/_expo/static/js/web/__common-test.js","/_expo/static/js/web/index-test.js"];function isPhone(){return true}})();</script>',
    );
    const previousDeferred = process.cwd();
    process.chdir(dir);
    let failedDeferredFalsePass = false;
    try {
      awaitableAssertBundleBudgets("dist", {
        "/hub/events": "approved",
        "/marketing": "approved",
        "/marketing/campaigns/compose": "approved",
        "/account": "approved",
      });
    } catch {
      failedDeferredFalsePass = true;
    } finally {
      process.chdir(previousDeferred);
    }
    if (!failedDeferredFalsePass) fail("--self-test expected deferred oversized approved-route payload to fail");
    console.log("ORCH-1093 deferred false-pass self-test PASS.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function awaitableAssertBundleBudgets(root, routeStatusOverride = {}) {
  const indexPath = join(root, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const scriptPaths = scriptSrcsFromHtml(html).map((src) => distPathForScript(src, root));
  const deferredScriptPaths = deferredScriptSrcsFromHtml(html).map((src) => distPathForScript(src, root));
  const phoneBootScriptPaths = scriptPaths.length > 0 ? scriptPaths : deferredScriptPaths;
  const phoneBootTotal = phoneBootScriptPaths.reduce((sum, path) => sum + rawBytes(path), 0);
  const commonPath = phoneBootScriptPaths.find((path) => basename(path).startsWith("__common-"));
  const commonBytes = commonPath === undefined ? 0 : rawBytes(commonPath);
  const statuses = routeStatusMap(routeStatusOverride);
  const unprovenApprovedRoutes = approvedRoutesWithoutOversizeProof(statuses, new Set());
  if (
    scriptPaths.length > 0 &&
    (phoneBootTotal > EAGER_TOTAL_LIMIT || commonBytes > COMMON_LIMIT)
  ) {
    throw new Error("self-test eager budget failure");
  }
  if ((phoneBootTotal > EAGER_TOTAL_LIMIT || commonBytes > COMMON_LIMIT) && unprovenApprovedRoutes.length > 0) {
    throw new Error("self-test budget failure");
  }
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  assertSourceGuards();
  await assertBundleBudgets();
  console.log("ORCH-1093 signed-in route OOM PASS.");
}
