#!/usr/bin/env node
/**
 * ORCH-1342 [web-see-whos-going-funnel] — OneLink landing single-parse gate.
 * Invariant: I-PROPOSED-1342-LANDING-SINGLE-PARSE (DRAFT until CLOSE).
 *
 * The OneLink landing discriminator (`deep_link_sub3`) is parsed in exactly ONE
 * place — `app-mobile/src/services/oneLinkResolver.ts` (the I-ONELINK-SINGLE-
 * RESOLVER dispatch point, extended in place by ORCH-1342) — and travels
 * app-internally ONLY as the `?landing=guest-list` query param composed by
 * `dispatchOneLinkDestination` (app-mobile/app/index.tsx). No other module may
 * read `deep_link_sub3` (a second payload parser is the exact divergence class
 * the ONE-resolver invariant exists to kill).
 *
 * REQUIRE (comment-stripped):
 *   1. the resolver parses `deep_link_sub3` and maps the exact 'guest-list'
 *      token to the typed `landing` field.
 *   2. the dispatcher composes `landing=guest-list` onto the entity path (ONE
 *      composition point — line-deleting the append fails this gate).
 * BAN (comment-stripped, over app-mobile/src/** + app-mobile/app/**):
 *   3. the token `deep_link_sub3` anywhere OUTSIDE oneLinkResolver.ts
 *      (__tests__ excluded — suites quote the payload as fixtures).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a
 * banned token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("app-mobile")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const RESOLVER = "app-mobile/src/services/oneLinkResolver.ts";
const DISPATCHER = "app-mobile/app/index.tsx";
const SCAN_ROOTS = ["app-mobile/src", "app-mobile/app"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Core checker — pure over a {relPath: content} map for --self-test. */
function checkLandingSingleParse(files, failures) {
  const resolver = files[RESOLVER];
  const dispatcher = files[DISPATCHER];

  // 1. The ONE parser: resolver reads deep_link_sub3 → landing 'guest-list'.
  if (resolver === undefined) {
    failures.push(`${RESOLVER}: resolver not found (gate path out of sync).`);
  } else {
    const src = stripComments(resolver);
    if (!/deep_link_sub3/.test(src)) {
      failures.push(
        `${RESOLVER}: no deep_link_sub3 parse — the landing discriminator must be parsed HERE and only here.`,
      );
    }
    if (!/landing.*['"]guest-list['"]|['"]guest-list['"].*landing/s.test(src)) {
      failures.push(
        `${RESOLVER}: the exact 'guest-list' token must map to the typed \`landing\` field.`,
      );
    }
  }

  // 2. The ONE composition point: the dispatcher appends ?landing=guest-list.
  if (dispatcher === undefined) {
    failures.push(`${DISPATCHER}: dispatcher not found (gate path out of sync).`);
  } else {
    const src = stripComments(dispatcher);
    if (!/landing=guest-list/.test(src)) {
      failures.push(
        `${DISPATCHER}: dispatchOneLinkDestination no longer composes ?landing=guest-list onto the entity path — the deferred install funnel is dead.`,
      );
    }
  }

  // 3. No second parser: deep_link_sub3 appears NOWHERE else.
  for (const [rel, raw] of Object.entries(files)) {
    if (rel === RESOLVER) continue;
    if (!rel.startsWith("app-mobile/")) continue;
    if (/\/__tests__\//.test(rel)) continue; // suites quote payload fixtures
    const src = stripComments(raw);
    if (/deep_link_sub3/.test(src)) {
      failures.push(
        `${rel}: reads deep_link_sub3 — a SECOND landing parser. The discriminator is parsed ONLY in oneLinkResolver.ts (I-PROPOSED-1342-LANDING-SINGLE-PARSE).`,
      );
    }
  }
}

function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (SCAN_EXT.has(path.extname(entry.name))) out.push(abs);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => {
    const f = [];
    checkLandingSingleParse(files, f);
    return f;
  };

  const resolverFix = `
export function resolveOneLinkDestination(data) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const landing = str(data.deep_link_sub3);
  if (landing === 'guest-list') dest.landing = 'guest-list';
  return dest;
}
`;
  const dispatcherFix = `
function dispatchOneLinkDestination(dest) {
  let path = '/e/b/s';
  if (dest.landing === 'guest-list') {
    path = \`\${path}?landing=guest-list\`;
  }
  router.push(path);
}
`;
  const good = {
    [RESOLVER]: resolverFix,
    [DISPATCHER]: dispatcherFix,
    "app-mobile/src/services/deepLinkService.ts": "export const parseDeepLink = (u) => null;\n",
  };
  if (run(good).length !== 0) selfFailures.push("compliant fixture wrongly flagged: " + JSON.stringify(run(good)));

  // 1. Resolver loses the sub3 parse → fire.
  const noParse = { ...good, [RESOLVER]: resolverFix.replace(/deep_link_sub3/g, "deep_link_sub2") };
  if (run(noParse).length === 0) selfFailures.push("stripped resolver sub3 parse not flagged");

  // 2. Resolver loses the guest-list → landing mapping → fire.
  const noMap = {
    ...good,
    [RESOLVER]: resolverFix
      .replace("if (landing === 'guest-list') dest.landing = 'guest-list';", "")
      .replace("const landing = str(data.deep_link_sub3);", "void str(data.deep_link_sub3);"),
  };
  if (run(noMap).length === 0) selfFailures.push("stripped guest-list→landing mapping not flagged");

  // 3. Dispatcher loses the ?landing=guest-list append → fire.
  const noAppend = {
    ...good,
    [DISPATCHER]: dispatcherFix.replace("path = `${path}?landing=guest-list`;", ""),
  };
  if (run(noAppend).length === 0) selfFailures.push("stripped dispatcher landing append not flagged");

  // 4. A SECOND parser appears (deep_link_sub3 outside the resolver) → fire.
  const secondParser = {
    ...good,
    "app-mobile/src/services/appsFlyerService.ts":
      "const landing = data.deep_link_sub3;\n",
  };
  if (run(secondParser).length === 0) selfFailures.push("second deep_link_sub3 parser not flagged");

  // 5. The token inside a COMMENT elsewhere is stripped → still passes.
  const commented = {
    ...good,
    "app-mobile/app/e/[brandSlug]/[eventSlug].tsx":
      "// the deep_link_sub3 payload is parsed by oneLinkResolver, never here\nexport default function X() { return null; }\n",
  };
  if (run(commented).length !== 0) selfFailures.push("commented token wrongly flagged (comment-strip broken): " + JSON.stringify(run(commented)));

  // 6. A __tests__ fixture quoting the payload is ALLOWED.
  const testFixture = {
    ...good,
    "app-mobile/src/services/__tests__/oneLinkResolver.orch1342.test.ts":
      "const payload = { deep_link_sub3: 'guest-list' };\n",
  };
  if (run(testFixture).length !== 0) selfFailures.push("__tests__ payload fixture wrongly flagged: " + JSON.stringify(run(testFixture)));

  // 7. Missing resolver file entirely → fire.
  const noResolver = { ...good };
  delete noResolver[RESOLVER];
  if (run(noResolver).length === 0) selfFailures.push("missing resolver not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1342 landing-single-parse self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1342 landing-single-parse self-test PASS (7/7 cases).");
  process.exit(0);
}

// ---- Live mode
const files = {};
for (const scanRoot of SCAN_ROOTS) {
  const absFiles = [];
  walk(path.join(root, scanRoot), absFiles);
  for (const abs of absFiles) {
    files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
  }
}

const failures = [];
checkLandingSingleParse(files, failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1342 (I-PROPOSED-1342-LANDING-SINGLE-PARSE) FAIL — the OneLink landing\n" +
      "discriminator (deep_link_sub3) is parsed ONLY in oneLinkResolver.ts and travels\n" +
      "app-internally ONLY as the ?landing=guest-list param composed by\n" +
      "dispatchOneLinkDestination.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1342 PASS — deep_link_sub3 is parsed only in oneLinkResolver.ts and the\n" +
    "dispatcher composes ?landing=guest-list at its ONE composition point.",
);
