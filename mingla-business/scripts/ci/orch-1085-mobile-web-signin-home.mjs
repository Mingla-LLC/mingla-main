#!/usr/bin/env node
/**
 * ORCH-1085 — mobile-browser sign-in Home contract.
 *
 * This is the regression guard for the physical-phone OOM class. Signed-in
 * mobile browsers must land on a static Home shell before the Expo/RN web
 * bootstrap runs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_BUILD = process.env.ORCH_1085_WEB_BUILD ?? "web-build-orch1085-after";
const JS_DIR = join(WEB_BUILD, "_expo", "static", "js", "web");
const INITIAL_CEILING_RAW = Number(process.env.ORCH_1085_INITIAL_CEILING ?? 3_100_000);

function fail(message) {
  console.error(`ORCH-1085 mobile-web sign-in FAIL: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

const appJson = JSON.parse(read("app.json"));
const expoRouterPlugin = appJson.expo?.plugins?.find((plugin) =>
  Array.isArray(plugin) && plugin[0] === "expo-router"
);
if (!expoRouterPlugin) {
  fail("app.json must configure the expo-router plugin with asyncRoutes");
}
const asyncRoutes = expoRouterPlugin[1]?.asyncRoutes;
if (
  asyncRoutes?.web !== true ||
  asyncRoutes?.ios !== false ||
  asyncRoutes?.android !== false ||
  asyncRoutes?.default !== false
) {
  fail("asyncRoutes must be enabled only for web and explicitly disabled for native");
}

const callback = read("public/auth/callback.html");
if (!callback.includes('window.location.replace("/home")')) {
  fail("auth callback must redirect successful sign-in to /home");
}
if (!callback.includes("sb-gqnoajqerqhnvulmnyvv-auth-token")) {
  fail("auth callback must persist the Supabase browser session");
}

const home = read("public/home.html");
if (!home.includes("Fast mobile home")) {
  fail("public/home.html must render the static mobile Home shell");
}
if (home.includes("/_expo/static/js/") || home.includes("expo-metro-runtime")) {
  fail("public/home.html must not load the Expo/RN web bundle");
}

const vercel = JSON.parse(read("vercel.json"));
const rewriteText = JSON.stringify(vercel.rewrites ?? []);
if (!rewriteText.includes('"source":"/home"') || !rewriteText.includes('"destination":"/home.html"')) {
  fail("vercel.json must rewrite /home to /home.html");
}
const homeRewriteIndex = (vercel.rewrites ?? []).findIndex((r) => r.source === "/home");
const catchAllIndex = (vercel.rewrites ?? []).findIndex((r) => r.source === "/(.*)");
if (homeRewriteIndex < 0 || catchAllIndex < 0 || homeRewriteIndex > catchAllIndex) {
  fail("/home rewrite must appear before the SPA catch-all rewrite");
}

const injectScript = read("scripts/inject-mobile-blur-css.mjs");
if (
  !injectScript.includes("mingla-mobile-web-home-preboot") ||
  !injectScript.includes('location.replace("/home")')
) {
  fail("post-export injection must include the signed-in mobile / -> /home preboot redirect");
}

if (existsSync(join(WEB_BUILD, "index.html"))) {
  const indexHtml = read(join(WEB_BUILD, "index.html"));
  const scripts = [...indexHtml.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g)].map(
    (match) => match[0],
  );
  if (scripts.length === 0) {
    fail(`${WEB_BUILD}/index.html has no eager script tags`);
  }
  let initialRaw = 0;
  for (const script of scripts) {
    initialRaw += statSync(join(WEB_BUILD, script.replace(/^\//, ""))).size;
  }
  if (initialRaw > INITIAL_CEILING_RAW) {
    fail(`initial Expo payload ${initialRaw} exceeds ceiling ${INITIAL_CEILING_RAW}`);
  }
  const chunks = existsSync(JS_DIR)
    ? readdirSync(JS_DIR).filter((name) => name.endsWith(".js"))
    : [];
  if (chunks.length < 100) {
    fail(`expected async route chunks in ${JS_DIR}, found ${chunks.length}`);
  }
}

if (existsSync(join("dist", "index.html"))) {
  const distIndex = read(join("dist", "index.html"));
  if (!distIndex.includes("mingla-mobile-web-home-preboot")) {
    fail("dist/index.html must contain the mobile signed-in preboot redirect");
  }
  if (!distIndex.includes("mingla-mobile-web-no-blur")) {
    fail("dist/index.html must contain the mobile no-blur style");
  }
}
if (existsSync(join("dist", "home.html"))) {
  const distHome = read(join("dist", "home.html"));
  if (distHome.includes("/_expo/static/js/") || distHome.includes("expo-metro-runtime")) {
    fail("dist/home.html must not load the Expo/RN web bundle");
  }
}

console.log("ORCH-1085 mobile-web sign-in PASS.");
