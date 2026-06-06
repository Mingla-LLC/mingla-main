#!/usr/bin/env node
/**
 * ORCH-1092 — Business Web restoration wave guard.
 *
 * Static Home may reopen only the approved phone-browser routes, and each
 * reopened route must carry an ORCH-1092 marker. Payout management stays
 * shelled unless a future generated-session proof marker is added.
 */

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";

function fail(message) {
  console.error(`ORCH-1092 business web restoration wave FAIL: ${message}`);
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

function assertNoStaticImport(source, moduleName, label) {
  const stripped = stripComments(source);
  const importPattern = new RegExp(`(?:import[\\s\\S]*?from\\s*|import\\s*\\()([\"'])${moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
  const requirePattern = new RegExp(`require\\((['"])${moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\)`);
  if (importPattern.test(stripped) || requirePattern.test(stripped)) {
    fail(`${label} must not statically import ${moduleName}`);
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

function scriptSrcsFromHtml(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(
    (match) => match[1],
  );
}

function normalizeDistScriptPath(src) {
  const withoutQuery = src.split("?")[0];
  if (!withoutQuery.startsWith("/_expo/static/js/web/")) return null;
  return join("dist", withoutQuery.replace(/^\//, ""));
}

function contentTypeFor(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

async function withDistServer(callback) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let filePath;
    if (url.pathname === "/home") {
      filePath = join("dist", "home.html");
    } else {
      const candidate = join("dist", decodeURIComponent(url.pathname));
      filePath =
        existsSync(candidate) && statSync(candidate).isFile()
          ? candidate
          : join("dist", "index.html");
    }
    response.setHeader("Content-Type", contentTypeFor(filePath));
    if (url.pathname.startsWith("/_expo/static/js/web/")) {
      response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    }
    createReadStream(filePath).pipe(response);
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    fail("could not allocate local dist server for ORCH-1092 runtime smoke");
  }
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertSignedOutRecoveryRuntime() {
  const { chromium } = await import("playwright");
  const routes = [
    ["/hub/events", "Sign in to open Hub Events."],
    ["/marketing", "Sign in to open Marketing overview."],
    ["/marketing/campaigns/compose", "Sign in to open Compose blast."],
    ["/account", "Sign in to open Account settings."],
  ];

  await withDistServer(async (origin) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
      });
      for (const [route, expected] of routes) {
        const page = await context.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(`pageerror:${error.message}`));
        page.on("requestfailed", (request) => {
          failures.push(`requestfailed:${request.url()}:${request.failure()?.errorText ?? ""}`);
        });
        await page.goto(`${origin}${route}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.getByText(expected, { exact: true }).waitFor({ timeout: 6000 });
        await page.getByText("Return to Home", { exact: true }).waitFor({ timeout: 1000 });
        if (failures.length > 0) {
          fail(`${route} unsigned recovery had runtime failures: ${failures.join("; ")}`);
        }
        await page.close();
      }
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

const reopenedRoutes = [
  {
    route: "/hub/events",
    marker: "data-orch-1092-hub-events-reopened",
    label: "Hub Events",
  },
  {
    route: "/marketing",
    marker: "data-orch-1092-marketing-overview-reopened",
    label: "Marketing overview",
  },
  {
    route: "/marketing/campaigns/compose",
    marker: "data-orch-1092-compose-shell-reopened",
    label: "Marketing Composer shell",
  },
  {
    route: "/account",
    marker: "data-orch-1092-account-reopened",
    label: "Account settings",
  },
];

const stillShelledTargets = [
  "hub-experiences",
  "hub-trips",
  "ari-assistant",
  "payout-account",
];

const forbiddenDirectRoutes = [
  "/hub/experiences",
  "/hub/trips",
  "/ari",
  "/connect-account-management",
];

const forbiddenCopy = ["Stripe account", "Connect Stripe", "Payments & Stripe"];
const forbiddenNativeModules = [
  "react-native-keyboard-controller",
  "expo-camera",
  "expo-image-picker",
  "expo-file-system",
  "expo-file-system/legacy",
  "@react-native-community/datetimepicker",
  "@stripe/connect-js",
  "@stripe/react-connect-js",
  "react-native-video-trim",
  "react-native-compressor",
];

const home = read("public/home.html");
for (const { route, marker, label } of reopenedRoutes) {
  assertIncludes(home, `href="${route}"`, `public/home.html ${label}`);
  assertIncludes(home, marker, `public/home.html ${label}`);
}

for (const route of forbiddenDirectRoutes) {
  assertNotIncludes(home, `href="${route}"`, "public/home.html");
  assertNotIncludes(home, `href='${route}'`, "public/home.html");
}

for (const target of stillShelledTargets) {
  assertIncludes(home, `href="#${target}"`, "public/home.html");
  assertIncludes(home, `data-shell-link="${target}"`, "public/home.html");
}

assertIncludes(home, "Payout account", "public/home.html");
assertIncludes(home, "generated secure session", "public/home.html");
assertNotIncludes(home, "data-orch-1092-payout-session-reopened", "public/home.html");
for (const copy of forbiddenCopy) assertNotIncludes(home, copy, "public/home.html");

const directHrefMatches = [...home.matchAll(/\shref=["']([^#"'][^"']*)["']/g)]
  .map((match) => match[1])
  .filter((href) => href.startsWith("/"));
const allowedDirectRoutes = new Set(["/event/create", ...reopenedRoutes.map((r) => r.route)]);
for (const href of directHrefMatches) {
  if (!allowedDirectRoutes.has(href)) {
    fail(`public/home.html has unapproved direct route href: ${href}`);
  }
}

const vercel = JSON.parse(read("vercel.json"));
const homeRewriteIndex = (vercel.rewrites ?? []).findIndex((rewrite) => rewrite.source === "/home");
const catchAllIndex = (vercel.rewrites ?? []).findIndex((rewrite) => rewrite.source === "/(.*)");
if (homeRewriteIndex < 0 || catchAllIndex < 0 || homeRewriteIndex > catchAllIndex) {
  fail("vercel.json must keep /home -> /home.html before the SPA catch-all");
}
const broadExpoStaticHeaderIndex = (vercel.headers ?? []).findIndex(
  (header) => header.source === "/_expo/static/(.*)",
);
const webJsHeaderIndex = (vercel.headers ?? []).findIndex(
  (header) => header.source === "/_expo/static/js/web/(.*)",
);
const webJsHeader = (vercel.headers ?? [])[webJsHeaderIndex];
if (
  broadExpoStaticHeaderIndex < 0 ||
  webJsHeaderIndex < broadExpoStaticHeaderIndex ||
  !JSON.stringify(webJsHeader?.headers ?? []).includes("public, max-age=0, must-revalidate")
) {
  fail("Vercel web JS cache header must override broad immutable Expo static header");
}

const injectScript = read("scripts/inject-mobile-blur-css.mjs");
for (const token of [
  "orch1091-js-cache-bust",
  "?v=${JS_CACHE_BUST_PARAM}",
  "mingla-mobile-web-chunk-recovery",
  "mingla-mobile-web-home-preboot",
  "mingla-mobile-web-no-blur",
]) {
  assertIncludes(injectScript, token, "scripts/inject-mobile-blur-css.mjs");
}

const appJson = JSON.parse(read("app.json"));
const expoRouterPlugin = appJson.expo?.plugins?.find((plugin) =>
  Array.isArray(plugin) && plugin[0] === "expo-router"
);
if (expoRouterPlugin?.[1]?.asyncRoutes?.web !== true) {
  fail("Expo Router asyncRoutes.web must remain enabled");
}

const routeSourceFiles = [
  "app/(tabs)/hub/events.tsx",
  "app/(tabs)/hub/_layout.tsx",
  "app/(tabs)/marketing/index.tsx",
  "app/(tabs)/marketing/_layout.tsx",
  "app/(tabs)/marketing/campaigns/compose.tsx",
  "app/(tabs)/account.tsx",
  "src/components/marketing/ComposerV2/SchedulePickerSheet.tsx",
  "src/components/ui/ShareModal.tsx",
  "src/components/ui/UniversalCreatorSheet.tsx",
  "src/wrappers/KeyboardRoot.tsx",
  "src/wrappers/SmartScrollView.tsx",
];

for (const file of routeSourceFiles) {
  const source = read(file);
  for (const moduleName of forbiddenNativeModules) {
    assertNoStaticImport(source, moduleName, file);
  }
}

const webSourceFiles = [
  ...walkFiles("app", (path) => /\.(ts|tsx|js|jsx)$/.test(path)),
  ...walkFiles("src", (path) => /\.(ts|tsx|js|jsx)$/.test(path)),
].filter(
  (path) =>
    !path.includes("__tests__") &&
    !path.includes(".native.") &&
    !path.includes(".test.") &&
    !path.includes(".spec."),
);
for (const file of webSourceFiles) {
  const source = read(file);
  for (const moduleName of ["expo-image-picker", "expo-file-system", "expo-file-system/legacy"]) {
    assertNoStaticImport(source, moduleName, file);
  }
}

const scheduleWeb = read("src/components/marketing/ComposerV2/SchedulePickerSheet.tsx");
const scheduleNative = read("src/components/marketing/ComposerV2/SchedulePickerSheet.native.tsx");
assertIncludes(scheduleWeb, 'type="date"', "SchedulePickerSheet.tsx");
assertIncludes(scheduleWeb, 'type="time"', "SchedulePickerSheet.tsx");
assertIncludes(scheduleWeb, "showPicker", "SchedulePickerSheet.tsx");
assertNotIncludes(stripComments(scheduleWeb), "@react-native-community/datetimepicker", "SchedulePickerSheet.tsx runtime source");
assertIncludes(scheduleNative, "@react-native-community/datetimepicker", "SchedulePickerSheet.native.tsx");

const shareModal = stripComments(read("src/components/ui/ShareModal.tsx"));
assertIncludes(shareModal, 'React.lazy(() => import("react-native-qrcode-svg"))', "ShareModal");
assertNotIncludes(shareModal, 'import QRCode from "react-native-qrcode-svg"', "ShareModal");

if (existsSync(join("dist", "home.html"))) {
  const distHome = read(join("dist", "home.html"));
  for (const { route, marker } of reopenedRoutes) {
    assertIncludes(distHome, `href="${route}"`, "dist/home.html");
    assertIncludes(distHome, marker, "dist/home.html");
  }
  for (const route of forbiddenDirectRoutes) {
    assertNotIncludes(distHome, `href="${route}"`, "dist/home.html");
  }
  for (const copy of forbiddenCopy) assertNotIncludes(distHome, copy, "dist/home.html");
}

if (existsSync(join("dist", "index.html"))) {
  const distIndex = read(join("dist", "index.html"));
  for (const token of [
    "orch1091-js-cache-bust",
    "?v=orch1091",
    "mingla-mobile-web-chunk-recovery",
    "mingla-mobile-web-home-preboot",
    "mingla-mobile-web-no-blur",
  ]) {
    assertIncludes(distIndex, token, "dist/index.html");
  }

  const eagerBootChunks = scriptSrcsFromHtml(distIndex)
    .map(normalizeDistScriptPath)
    .filter((path) => path !== null);
  if (eagerBootChunks.length === 0) {
    fail("dist/index.html must eagerly load Expo web JS chunks for boot inspection");
  }

  for (const chunkPath of eagerBootChunks) {
    const chunk = read(chunkPath);
    for (const token of forbiddenNativeModules) {
      assertNotIncludes(chunk, token, `${chunkPath} (eager boot chunk from dist/index.html)`);
    }
  }

  const commonChunk = eagerBootChunks.find((chunkPath) => basename(chunkPath).startsWith("__common"));
  if (commonChunk === undefined) {
    fail("dist/index.html eager boot chunks must include __common for ORCH-1092 inspection");
  }
}

const jsDir = join("dist", "_expo", "static", "js", "web");
if (existsSync(jsDir)) {
  const chunks = walkFiles(jsDir, (path) => path.endsWith(".js"));
  const reopenedChunkTokens = [
    "ComposeCampaignRoute",
    "MarketingOverviewRoute",
    "EventsTab",
    "AccountTab",
    "SchedulePickerSheet",
  ];
  for (const chunkPath of chunks) {
    const chunk = read(chunkPath);
    if (!reopenedChunkTokens.some((token) => chunk.includes(token))) continue;
    for (const token of [
      "@react-native-community/datetimepicker",
      "react-native-keyboard-controller",
      "expo-image-picker",
      "expo-file-system",
      "expo-file-system/legacy",
      "@stripe/connect-js",
      "@stripe/react-connect-js",
    ]) {
      assertNotIncludes(chunk, token, chunkPath);
    }
  }
}

if (existsSync(join("dist", "index.html"))) {
  await assertSignedOutRecoveryRuntime();
}

console.log("ORCH-1092 business web restoration wave PASS.");
