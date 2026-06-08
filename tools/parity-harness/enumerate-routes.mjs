#!/usr/bin/env node
/**
 * ORCH-1100 parity harness — route enumerator.
 *
 * Walks mingla-business/app/ and converts every Expo Router screen file into the
 * URL pathname it serves. Emits routes.manifest.json that the CDP driver reads.
 *
 * Conventions handled:
 *   - (group)          -> stripped (route groups don't appear in the URL)
 *   - index.tsx        -> parent dir path (or "/" at root)
 *   - [param].tsx      -> :param  (dynamic; harness substitutes a sample value)
 *   - [...rest].tsx    -> :rest*  (catch-all; substituted)
 *   - +html/+not-found/_layout/__tests__/*.test.* are skipped (not navigable screens)
 *
 * This is a DIAGNOSTIC tool for the ORCH-1100 parity baseline. Not shipped product.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, "..", "..", "mingla-business", "app");

const SKIP_FILE = (name) =>
  name.startsWith("_") ||
  name.startsWith("+") ||
  name.includes(".test.") ||
  name === "__tests__";

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, acc);
    } else if (entry.endsWith(".tsx") && !SKIP_FILE(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

// Sample substitutions for dynamic segments so the route is actually navigable.
// These are intentionally obviously-fake values; a route that 404s on bad data
// still proves whether the SCREEN SHELL boots vs crashes vs hits the firewall.
const SAMPLE = {
  id: "00000000-0000-0000-0000-000000000000",
  brandSlug: "leggo-this",
  orderId: "00000000-0000-0000-0000-000000000001",
  token: "diagnostic-sample-token",
  eventId: "00000000-0000-0000-0000-000000000002",
  default: "sample",
};

function fileToPathname(absFile) {
  const rel = absFile
    .slice(APP_DIR.length + 1)
    .replace(/\.tsx$/, "")
    // `.web` platform variant resolves to the SAME URL as the base file; the
    // bundler picks foo.web.tsx for web. Strip the suffix so we don't emit a
    // bogus "/connect-onboarding.web" pathname.
    .replace(/\.web$/, "")
    .replace(/\.web\/index$/, "/index")
    .replace(/\\/g, "/");
  const segments = rel.split("/").filter(Boolean);
  const out = [];
  let dynamicParams = [];
  for (const seg of segments) {
    if (seg.startsWith("(") && seg.endsWith(")")) continue; // route group
    if (seg === "index") continue; // index resolves to parent
    const catchAll = seg.match(/^\[\.\.\.(.+)\]$/);
    const dyn = seg.match(/^\[(.+)\]$/);
    if (catchAll) {
      const name = catchAll[1];
      dynamicParams.push(name);
      out.push(SAMPLE[name] ?? SAMPLE.default);
    } else if (dyn) {
      const name = dyn[1];
      dynamicParams.push(name);
      out.push(SAMPLE[name] ?? SAMPLE.default);
    } else {
      out.push(seg);
    }
  }
  const pathname = "/" + out.join("/");
  return {
    pathname: pathname === "/" ? "/" : pathname.replace(/\/$/, ""),
    sourceFile: "app/" + rel + ".tsx",
    dynamic: dynamicParams.length > 0,
    dynamicParams,
  };
}

const files = walk(APP_DIR, []);
const routes = files
  .map(fileToPathname)
  // de-dup pathnames (e.g. (tabs)/index + index could collide); keep first
  .reduce((acc, r) => {
    if (!acc.some((x) => x.pathname === r.pathname)) acc.push(r);
    return acc;
  }, [])
  .sort((a, b) => a.pathname.localeCompare(b.pathname));

const manifest = {
  generatedAt: new Date().toISOString(),
  orch: "ORCH-1100",
  note: "DIAGNOSTIC route manifest for the business-web parity baseline harness. Not a product artifact.",
  total: routes.length,
  routes,
};

const outPath = join(__dirname, "routes.manifest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`Enumerated ${routes.length} routes -> ${outPath}`);
