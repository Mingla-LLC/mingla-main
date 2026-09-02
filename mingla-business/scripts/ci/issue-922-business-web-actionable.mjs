#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(packageRoot, "..");
const buildDir = resolve(packageRoot, process.env.ISSUE_922_WEB_BUILD ?? "dist");
const INVITE_SOURCE = "/accept-brand-invitation";
const INVITE_DESTINATION = "/accept-brand-invitation-entry";
// #1876 F-2: `assets/` joined the alternation. This guard hard-pins the shipped
// catch-all string, so the literal has to track `vercel.json` or the #922 gate
// reds on an unrelated change. The property #922 owns — the exact invitation
// entry is excluded and nothing else about the SPA fallback moved — is asserted
// by the matrix below and is unchanged.
const SPA_CATCHALL = "/((?!_expo/static/|assets/|accept-brand-invitation-entry$).*)";
const eagerRolePatterns = [
  ["Metro runtime", /^(?:__expo-metro-)?runtime(?:-.+)?\.js$/],
  ["common", /^(?:__)?common(?:-.+)?\.js$/],
  ["Router index", /^index(?:-.+)?\.js$/],
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function scriptAttributes(tag) {
  const open = tag.match(/^<script\b([^>]*)>/i)?.[1] ?? "";
  const attrs = [];
  const pattern = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  let match;
  while ((match = pattern.exec(open)) !== null) {
    attrs.push({ name: match[1], value: match[2] ?? match[3] ?? null });
  }
  return attrs;
}

function validateCatchallMatcher(source) {
  invariant(source === SPA_CATCHALL, "SPA catchall must exclude only static assets and the exact invitation entry");
  const matcher = new RegExp(`^(?:${source})$`);
  const matrix = [
    ["/_expo/static/a.js", false],
    ["/_expo/staticish/a.js", true],
    // #1876 F-2 — the second machine-fetched build-output tree.
    ["/assets/a.png", false],
    ["/assetsish/a.png", true],
    [INVITE_DESTINATION, false],
    [`${INVITE_DESTINATION}/`, true],
    [`${INVITE_DESTINATION}-evil`, true],
    [`${INVITE_DESTINATION}/child`, true],
    [INVITE_SOURCE, true],
    [`${INVITE_SOURCE}/success`, true],
    ["/", true],
  ];
  for (const [path, expected] of matrix) {
    invariant(matcher.test(path) === expected, `SPA catchall matrix drift for ${path}`);
  }
}

function validateRewrite(vercel) {
  invariant(
    vercel.buildCommand.endsWith("node scripts/inject-attendance-claim-bootstrap.mjs && node scripts/inject-mobile-blur-css.mjs && node scripts/build-invite-critical-entry.mjs"),
    "builder must run after the ordered attendance and blur/chunk-recovery injectors",
  );
  const dedicated = vercel.rewrites.findIndex(
    (rewrite) => rewrite.source === INVITE_SOURCE && rewrite.destination === INVITE_DESTINATION,
  );
  const catchall = vercel.rewrites.findIndex((rewrite) => rewrite.destination === "/" && rewrite.source === SPA_CATCHALL);
  invariant(dedicated >= 0, "exact invitation rewrite is missing");
  invariant(catchall >= 0 && dedicated < catchall, "invitation rewrite must precede the SPA catchall");
  invariant(catchall === vercel.rewrites.length - 1, "SPA catchall must remain the final rewrite");
  validateCatchallMatcher(vercel.rewrites[catchall].source);
}

function validateEntry(source, entry) {
  const sourceTags = [...source.matchAll(/<script\b[^>]*\bsrc=(?:"[^"]+"|'[^']+')[^>]*>\s*<\/script>/gi)].map((match) => match[0]);
  invariant(sourceTags.length === 3, `source index must retain exactly 3 eager scripts; found ${sourceTags.length}`);
  invariant(!/<script\b[^>]*\bsrc=/i.test(entry), "dedicated entry must have zero parser-discovered external scripts");
  invariant((entry.match(/id="issue-922-critical-entry"/g) ?? []).length === 1, "critical marker must be unique");
  const metadataText = entry.match(/var scripts=(\[.*?\]);var loaded=false;/s)?.[1];
  invariant(metadataText !== undefined, "ordered fallback metadata is missing");
  const metadata = JSON.parse(metadataText);
  invariant(metadata.length === 3, "fallback metadata must contain exactly 3 scripts");
  invariant(JSON.stringify(metadata) === JSON.stringify(sourceTags.map(scriptAttributes)), "fallback attributes/order drifted from index.html");
  const actualRoles = metadata.map((attrs) => {
    const src = attrs.find(({ name }) => name.toLowerCase() === "src")?.value ?? "";
    const basename = new URL(src, "https://host.usemingla.com").pathname.split("/").at(-1) ?? "";
    return eagerRolePatterns.find(([, pattern]) => pattern.test(basename))?.[0] ?? `unknown (${basename})`;
  });
  const expectedRoles = eagerRolePatterns.map(([label]) => label);
  invariant(
    actualRoles.every((role, index) => role === expectedRoles[index]),
    `fallback eager script order/topology must be ${expectedRoles.join(" -> ")}; found ${actualRoles.join(" -> ")}`,
  );
  invariant(entry.indexOf('<div id="root"></div>') < entry.indexOf('id="issue-922-critical-entry"'), "root scaffold must precede bootstrap");
  invariant((entry.match(/requestAnimationFrame\(function\(\)/g) ?? []).length === 2, "actionability marker must wait two animation frames");
  invariant(entry.includes('function protect(work){try{work()}catch(_error){boot()}}'), "eligible bootstrap failures must replay the full app");
  invariant(entry.includes('window.location.replace("/auth?next="+encodeURIComponent("/accept-brand-invitation?token="+token))'), "sign-in resume contract drifted");
  invariant(entry.includes('/^sb-.+-auth-token$/.test(key)'), "Supabase-session fallback detector is missing");
  invariant(entry.includes('key==="mingla_consent_v1"'), "returning-consent fallback detector is missing");
  invariant(entry.includes('window.__minglaPrebootConsentChoice=choice'), "ephemeral consent handoff is missing");
  invariant(entry.includes('node.async=false'), "fallback scripts are not forced into ordered execution");
}

function validateOwnerPins() {
  const files = Object.fromEntries(
    [
      "app/accept-brand-invitation.tsx",
      "src/analytics/ConsentBanner.web.tsx",
      "src/analytics/webAnalytics.web.ts",
      "src/components/ui/Button.tsx",
      "src/constants/designSystem.ts",
      "scripts/inject-attendance-claim-bootstrap.mjs",
      "scripts/inject-mobile-blur-css.mjs",
      "scripts/build-invite-critical-entry.mjs",
    ].map((path) => [path, readFileSync(join(packageRoot, path), "utf8")]),
  );
  for (const copy of ["You're invited", "Sign in to accept this invitation. We'll bring you right back.", 'label="Sign in"']) {
    invariant(files["app/accept-brand-invitation.tsx"].includes(copy), `invitation owner drift: ${copy}`);
  }
  for (const pin of ["Cookies &amp; analytics", "Accept all", "Reject cookies and analytics", "Manage analytics preferences", "https://usemingla.com/privacy-policy"]) {
    invariant(files["src/analytics/ConsentBanner.web.tsx"].includes(pin), `consent owner drift: ${pin}`);
  }
  const analytics = files["src/analytics/webAnalytics.web.ts"];
  invariant(analytics.indexOf("__minglaPrebootConsentChoice") < analytics.indexOf("window.localStorage.getItem(CONSENT_STORAGE_KEY)"), "ephemeral consent must be read before storage");
  invariant(!analytics.includes("delete window.__minglaPrebootConsentChoice"), "page-lifetime consent handoff must survive multiple readers");
  invariant(analytics.includes('JSON.stringify({ choice, ts: Date.now() })'), "canonical consent storage shape drifted");
  invariant(files["src/components/ui/Button.tsx"].includes("sm: 36, md: 44, lg: 52"), "button height owner drifted");
  invariant(files["src/components/ui/Button.tsx"].includes("outlineWidth: 2"), "button focus owner drifted");
  for (const token of ['warm: "#eb7825"', 'discover: "#0c0e12"', "profileBase: \"rgba(255, 255, 255, 0.04)\""]) {
    invariant(files["src/constants/designSystem.ts"].includes(token), `design token owner drift: ${token}`);
  }
  invariant(files["scripts/inject-mobile-blur-css.mjs"].includes('data-${JS_CACHE_BUST_MARKER}="true"'), "final script-attribute owner drifted");
}

function validateWorkflow() {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/issue-922-business-web-actionable.yml"), "utf8");
  for (const owner of [
    "mingla-business/app/accept-brand-invitation.tsx",
    "mingla-business/src/analytics/ConsentBanner.web.tsx",
    "mingla-business/src/analytics/webAnalytics.web.ts",
    "mingla-business/src/components/ui/Button.tsx",
    "mingla-business/src/constants/designSystem.ts",
    "mingla-business/scripts/inject-attendance-claim-bootstrap.mjs",
    "mingla-business/scripts/inject-mobile-blur-css.mjs",
    "mingla-business/scripts/build-invite-critical-entry.mjs",
    "mingla-business/scripts/ci/issue-922-business-web-actionable.mjs",
    "mingla-business/vercel.json",
  ]) invariant(workflow.includes(`- "${owner}"`), `workflow does not watch owner: ${owner}`);
}

function selfTest() {
  const vercel = {
    buildCommand: "x && node scripts/inject-attendance-claim-bootstrap.mjs && node scripts/inject-mobile-blur-css.mjs && node scripts/build-invite-critical-entry.mjs",
    rewrites: [
      { source: INVITE_SOURCE, destination: INVITE_DESTINATION },
      { source: SPA_CATCHALL, destination: "/" },
    ],
  };
  validateRewrite(vercel);
  let caughtHtmlDestination = false;
  try {
    validateRewrite({
      ...vercel,
      rewrites: vercel.rewrites.map((rewrite) => rewrite.source === INVITE_SOURCE
        ? { ...rewrite, destination: "/accept-brand-invitation-entry.html" }
        : rewrite),
    });
  } catch { caughtHtmlDestination = true; }
  invariant(caughtHtmlDestination, "self-test failed to detect the cleanUrls-incompatible .html destination");
  let caughtEntryFallthrough = false;
  try {
    validateRewrite({
      ...vercel,
      rewrites: vercel.rewrites.map((rewrite) => rewrite.source === SPA_CATCHALL
        ? { ...rewrite, source: "/((?!_expo/static/).*)" }
        : rewrite),
    });
  } catch { caughtEntryFallthrough = true; }
  invariant(caughtEntryFallthrough, "self-test failed to detect invitation-entry SPA fallthrough");
  let caughtRewrite = false;
  try { validateRewrite({ ...vercel, rewrites: vercel.rewrites.slice(1) }); } catch { caughtRewrite = true; }
  invariant(caughtRewrite, "self-test failed to detect removed rewrite");
  const attrs = ["runtime", "common", "index"].map((name) => `<script src="/_expo/static/js/web/${name}.js" defer></script>`);
  const metadata = JSON.stringify(attrs.map(scriptAttributes));
  const source = `<div id="root"></div>${attrs.join("")}`;
  const entry = `<div id="root"></div><script id="issue-922-critical-entry">var scripts=${metadata};var loaded=false;function protect(work){try{work()}catch(_error){boot()}}requestAnimationFrame(function(){requestAnimationFrame(function(){});});window.location.replace("/auth?next="+encodeURIComponent("/accept-brand-invitation?token="+token));/^sb-.+-auth-token$/.test(key);key==="mingla_consent_v1";window.__minglaPrebootConsentChoice=choice;node.async=false;</script>`;
  validateEntry(source, entry);
  let caughtOrder = false;
  try {
    const reordered = [attrs[1], attrs[0], attrs[2]];
    validateEntry(reordered.join(""), entry.replace(metadata, JSON.stringify(reordered.map(scriptAttributes))));
  } catch { caughtOrder = true; }
  invariant(caughtOrder, "self-test failed to detect reordered eager scripts");
  let caughtEager = false;
  try { validateEntry(source, entry.replace("</script>", `${attrs[0]}</script>`)); } catch { caughtEager = true; }
  invariant(caughtEager, "self-test failed to detect restored eager script");
  console.log("issue #922 guard self-test PASS (entry fallthrough, .html destination, rewrite removal, script reordering, and eager-script restoration detected)");
}

try {
  if (process.argv.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  validateOwnerPins();
  validateWorkflow();
  const vercel = JSON.parse(readFileSync(join(packageRoot, "vercel.json"), "utf8"));
  validateRewrite(vercel);
  const source = readFileSync(join(buildDir, "index.html"), "utf8");
  const entryPath = join(buildDir, "accept-brand-invitation-entry.html");
  invariant(existsSync(entryPath), "dedicated entry output is missing");
  const entry = readFileSync(entryPath, "utf8");
  validateEntry(source, entry);
  invariant(statSync(entryPath).size <= 20_000, "dedicated entry exceeds the 20 KB raw cap");
  invariant(gzipSync(entry).byteLength <= 6_000, "dedicated entry exceeds the 6 KB gzip cap");
  if (process.env.ISSUE_922_REQUIRE_ADVERSARIAL === "1") {
    for (const file of [
      "__tests__/issue922BusinessWebActionable.adversarial.test.ts",
      "playwright/issue922-business-web-actionable.adversarial.spec.ts",
    ]) invariant(existsSync(join(packageRoot, file)), `tester-owned adversarial proof is missing: ${file}`);
  }
  console.log(`issue #922 actionable guard PASS (${statSync(entryPath).size} raw / ${gzipSync(entry).byteLength} gzip bytes)`);
} catch (error) {
  console.error(`issue #922 actionable guard FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
