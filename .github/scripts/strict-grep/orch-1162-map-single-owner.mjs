#!/usr/bin/env node
/**
 * ORCH-1162 Bug 2 — single owner of the static-Mapbox URL builder.
 *
 * Invariant I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER (DRAFT): there is exactly
 * ONE implementation of buildStaticMapUrl, owned by @mingla/event-rendering
 * (packages/event-rendering/mapboxStaticImage.ts). mingla-business and app-mobile
 * RE-EXPORT it (a re-export shim), never re-implement it. This ends the prior
 * byte-for-byte fork in the two app utils and keeps I-MOR-0827-PACKAGE-ISOLATION
 * intact (app-mobile imports from the @mingla/* package, not mingla-business/src).
 *
 * The gate FAILS if:
 *   (a) more than one `export const buildStaticMapUrl =` DEFINITION exists, OR
 *   (b) the one definition does NOT live under packages/event-rendering/, OR
 *   (c) either app util re-implements the body instead of re-exporting it.
 *
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const SCAN_ROOTS = [
  "packages",
  "mingla-business/src",
  "app-mobile/src",
];

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
};

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// A DEFINITION = `export const buildStaticMapUrl = (` (an arrow-fn body). A
// RE-EXPORT = `export { buildStaticMapUrl } from "..."` (does not match below).
const DEFINITION_RE = /export\s+const\s+buildStaticMapUrl\s*=/;

const definitions = [];
for (const relRoot of SCAN_ROOTS) {
  for (const file of walk(join(root, relRoot))) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (DEFINITION_RE.test(code)) {
      definitions.push(relative(root, file).replace(/\\/g, "/"));
    }
  }
}

if (definitions.length !== 1) {
  failures.push(
    `expected exactly ONE buildStaticMapUrl definition; found ${definitions.length}: ${
      definitions.join(", ") || "(none)"
    }. The two app utils must RE-EXPORT from @mingla/event-rendering, never re-implement.`,
  );
} else if (
  !definitions[0].startsWith("packages/event-rendering/")
) {
  failures.push(
    `the single buildStaticMapUrl definition must live under packages/event-rendering/, found at ${definitions[0]}.`,
  );
}

// The two app utils must be re-export shims (no local definition).
for (const shim of [
  "mingla-business/src/utils/mapboxStaticImage.ts",
  "app-mobile/src/utils/mapboxStaticImage.ts",
]) {
  const path = join(root, shim);
  if (!existsSync(path)) {
    failures.push(`${shim}: missing re-export shim for buildStaticMapUrl.`);
    continue;
  }
  const code = stripComments(readFileSync(path, "utf8"));
  if (DEFINITION_RE.test(code)) {
    failures.push(
      `${shim}: re-implements buildStaticMapUrl — must RE-EXPORT from @mingla/event-rendering (single owner).`,
    );
  }
  if (!/from\s+["']@mingla\/event-rendering["']/.test(code)) {
    failures.push(
      `${shim}: must re-export buildStaticMapUrl from @mingla/event-rendering.`,
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-1162 map-single-owner gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1162 map-single-owner gate passed.");
