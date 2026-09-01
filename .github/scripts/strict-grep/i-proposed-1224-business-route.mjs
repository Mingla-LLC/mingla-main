#!/usr/bin/env node
/**
 * ORCH-1224 [business route rename] — the marketing business surface moved
 * /organisers → /host (Seth 2026-06-22). This gate locks the rename:
 *
 * Invariant I-PROPOSED-1224-BUSINESS-ROUTE (DRAFT until ORCH-1224 CLOSE):
 *   (a) NO `/organisers` HREF survives in mingla-marketing component/lib source.
 *       Every navigable link (Link href, anchor href, SITE_CHIPS/SEGMENTS entry,
 *       BUSINESS_PATH constant, surface-detection `pathname.startsWith('/...')`)
 *       must point at /host. The ONLY tolerated `/organisers` strings are the
 *       two typed redirect contracts and bare historical code comments.
 *   (b) the typed registry owns permanent bare and family redirects to /host,
 *       and next.config.ts derives its redirect result from that registry.
 *
 * Scope: mingla-marketing/{components,lib,app} *.ts/*.tsx (the navigable source),
 * comment-stripped so a historical `// ... /organisers ...` note never trips it.
 * The exact route-registry file is excluded from the generic scan and instead
 * receives stricter contract validation below; no other source exemption exists.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MARKETING = "mingla-marketing";
const SCAN_DIRS = ["components", "lib", "app"];
const NEXT_CONFIG = join(MARKETING, "next.config.ts");
const ROUTE_REGISTRY = join(MARKETING, "lib", "search", "route-registry.ts");

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Match a navigable /organisers reference: `'/organisers'`, `"/organisers"`,
// `/organisers/...`, or `startsWith('/organisers')`. We match the literal path
// token bounded by a quote or `/` so `/organisers-foo` won't false-positive but
// `/organisers` and `/organisers/case-studies/x` both trip.
const ORGANISERS_HREF_RE = /\/organisers(?=['"`/])/;

const walk = (dir, acc) => {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, acc);
    } else if ([".ts", ".tsx"].includes(extname(entry))) {
      acc.push(abs);
    }
  }
  return acc;
};

const scanSourceForOrganisersHref = (absDirRoot) => {
  const failures = [];
  for (const sub of SCAN_DIRS) {
    const dir = join(absDirRoot, sub);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, [])) {
      if (file === join(absDirRoot, "lib", "search", "route-registry.ts")) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      if (ORGANISERS_HREF_RE.test(src)) {
        failures.push(
          `${file.slice(absDirRoot.length - MARKETING.length)}: a navigable \`/organisers\` href survived — must point at /host (ORCH-1224). I-PROPOSED-1224-BUSINESS-ROUTE.`,
        );
      }
    }
  }
  return failures;
};

const occurrences = (source, needle) => source.split(needle).length - 1;

const registryParts = (source) => {
  const startMarker = "const REDIRECTED_ROUTES = [";
  const endMarker = "] as const satisfies readonly RedirectedRouteContract[]";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return null;
  const after = end + endMarker.length;
  return {
    block: source.slice(start, after),
    outside: `${source.slice(0, start)}${source.slice(after)}`,
  };
};

const contractById = (block, id) => {
  const idToken = `id: '${id}'`;
  if (occurrences(block, idToken) !== 1) return "";
  const idIndex = block.indexOf(idToken);
  const start = block.lastIndexOf("{", idIndex);
  const closing = block.slice(idIndex).match(/\n\s*},/);
  const end = closing?.index == null ? -1 : idIndex + closing.index + closing[0].length;
  return start >= 0 && end > start ? block.slice(start, end) : "";
};

// (b) one typed registry owns BOTH legacy redirect contracts; Next consumes
// only its permanent projection. This keeps #1224's navigation protection while
// preserving #2981's one-owner lifecycle architecture.
const checkRedirectOwnership = (configSrc, registrySrc) => {
  const failures = [];
  const config = stripComments(configSrc);
  const registry = stripComments(registrySrc);
  const parts = registryParts(registry);

  if (!parts) {
    failures.push("route-registry.ts: missing the typed redirected-route owner. I-PROPOSED-1224-BUSINESS-ROUTE.");
    return failures;
  }

  if (ORGANISERS_HREF_RE.test(parts.outside)) {
    failures.push("route-registry.ts: `/organisers` may appear only inside the typed redirected-route owner. I-PROPOSED-1224-BUSINESS-ROUTE.");
  }

  const bare = contractById(parts.block, "organisers-redirect");
  for (const token of [
    "match: { type: 'exact', pathname: '/organisers' }",
    "lifecycle: 'redirected'",
    "source: '/organisers'",
    "destination: '/host'",
  ]) {
    if (!bare.includes(token)) {
      failures.push("route-registry.ts: missing the exact `/organisers` → `/host` redirected contract. I-PROPOSED-1224-BUSINESS-ROUTE.");
      break;
    }
  }

  const family = contractById(parts.block, "organisers-family-redirect");
  for (const token of [
    "match: { type: 'prefix', pathname: '/organisers' }",
    "lifecycle: 'redirected'",
    "source: '/organisers/:path*'",
    "destination: '/host/:path*'",
  ]) {
    if (!family.includes(token)) {
      failures.push("route-registry.ts: missing the `/organisers/:path*` → `/host/:path*` redirected contract. I-PROPOSED-1224-BUSINESS-ROUTE.");
      break;
    }
  }

  if (!/export\s+function\s+nextRedirectsFromRegistry[\s\S]*?lifecycle\s*===\s*['"]redirected['"][\s\S]*?permanent:\s*true\s+as\s+const/.test(registry)) {
    failures.push("route-registry.ts: redirected contracts must project as permanent Next redirects. I-PROPOSED-1224-BUSINESS-ROUTE.");
  }

  if (!/import\s*\{\s*nextRedirectsFromRegistry\s*\}\s*from\s*['"]\.\/lib\/search\/route-registry['"]/.test(config)) {
    failures.push("next.config.ts: missing the typed redirect-registry import. I-PROPOSED-1224-BUSINESS-ROUTE.");
  }
  if (!/async\s+redirects\s*\(\s*\)\s*\{[\s\S]{0,240}?return\s*\[\s*\.\.\.nextRedirectsFromRegistry\(\)\s*\]/.test(config)) {
    failures.push("next.config.ts: redirects must derive from nextRedirectsFromRegistry(). I-PROPOSED-1224-BUSINESS-ROUTE.");
  }
  return failures;
};

// --- self-test ------------------------------------------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  // (a) source scan
  const GOOD_SOURCE = `
    const SEGMENTS = [{ surface: 'organiser', label: 'Business', href: '/host' }]
    const active = pathname.startsWith('/host') ? 'organiser' : 'explorer'
    // historical: this used to live at /organisers (comment only — tolerated)
  `;
  const BAD_HREF = `const x = [{ href: '/organisers', label: 'Organiser' }]`;
  const BAD_STARTSWITH = `const a = pathname.startsWith('/organisers') ? 'organiser' : 'explorer'`;
  const BAD_SUBPATH = `const c = { href: '/organisers/case-studies/x' }`;
  const COMMENT_ONLY = `// see the /organisers premium redesign\nconst y = '/host'`;

  const scanStr = (s) => (ORGANISERS_HREF_RE.test(stripComments(s)) ? ["hit"] : []);

  // (b) typed redirect-owner check
  const GOOD_CONFIG = `
    import { nextRedirectsFromRegistry } from './lib/search/route-registry'
    const config = {
      async redirects() {
        return [...nextRedirectsFromRegistry()]
      },
    }
  `;
  const GOOD_REGISTRY = `
    const REDIRECTED_ROUTES = [
      {
        id: 'organisers-redirect',
        match: { type: 'exact', pathname: '/organisers' },
        lifecycle: 'redirected',
        source: '/organisers',
        destination: '/host',
      },
      {
        id: 'organisers-family-redirect',
        match: { type: 'prefix', pathname: '/organisers' },
        lifecycle: 'redirected',
        source: '/organisers/:path*',
        destination: '/host/:path*',
      },
    ] as const satisfies readonly RedirectedRouteContract[]
    export const ROUTE_REGISTRY = [...REDIRECTED_ROUTES]
    export function nextRedirectsFromRegistry() {
      return ROUTE_REGISTRY.filter((contract) => contract.lifecycle === 'redirected')
        .map(({ source, destination }) => ({ source, destination, permanent: true as const }))
    }
  `;
  const BAD_NO_REDIRECTS = `const config = { async headers() { return [] } }`;
  const BAD_TEMP = GOOD_REGISTRY.replace("permanent: true as const", "permanent: false as const");
  const BAD_NO_BARE = GOOD_REGISTRY.replace(/\s*\{\s*id: 'organisers-redirect',[\s\S]*?\n\s*\},/, "");
  const BAD_NO_SUBPATH = GOOD_REGISTRY.replace(/\s*\{\s*id: 'organisers-family-redirect',[\s\S]*?\n\s*\},/, "");
  const BAD_BARE_DESTINATION = GOOD_REGISTRY.replace("destination: '/host',", "destination: '/tools',");
  const BAD_FAMILY_DESTINATION = GOOD_REGISTRY.replace("destination: '/host/:path*',", "destination: '/tools/:path*',");
  const BAD_REGISTRY_HREF = `${GOOD_REGISTRY}\nconst stray = { href: '/organisers' }`;

  const ok =
    scanStr(GOOD_SOURCE).length === 0 &&
    scanStr(COMMENT_ONLY).length === 0 &&
    scanStr(BAD_HREF).length >= 1 &&
    scanStr(BAD_STARTSWITH).length >= 1 &&
    scanStr(BAD_SUBPATH).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, GOOD_REGISTRY).length === 0 &&
    checkRedirectOwnership(BAD_NO_REDIRECTS, GOOD_REGISTRY).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, BAD_TEMP).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, BAD_NO_BARE).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, BAD_NO_SUBPATH).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, BAD_BARE_DESTINATION).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, BAD_FAMILY_DESTINATION).length >= 1 &&
    checkRedirectOwnership(GOOD_CONFIG, BAD_REGISTRY_HREF).length >= 1;

  if (!ok) {
    console.error("ORCH-1224 business-route SELF-TEST failed:", {
      goodSource: scanStr(GOOD_SOURCE),
      commentOnly: scanStr(COMMENT_ONLY),
      badHref: scanStr(BAD_HREF),
      badStartsWith: scanStr(BAD_STARTSWITH),
      badSubpath: scanStr(BAD_SUBPATH),
      goodConfig: checkRedirectOwnership(GOOD_CONFIG, GOOD_REGISTRY),
      badNoRedirects: checkRedirectOwnership(BAD_NO_REDIRECTS, GOOD_REGISTRY),
      badTemp: checkRedirectOwnership(GOOD_CONFIG, BAD_TEMP),
      badNoBare: checkRedirectOwnership(GOOD_CONFIG, BAD_NO_BARE),
      badNoSubpath: checkRedirectOwnership(GOOD_CONFIG, BAD_NO_SUBPATH),
      badBareDestination: checkRedirectOwnership(GOOD_CONFIG, BAD_BARE_DESTINATION),
      badFamilyDestination: checkRedirectOwnership(GOOD_CONFIG, BAD_FAMILY_DESTINATION),
      badRegistryHref: checkRedirectOwnership(GOOD_CONFIG, BAD_REGISTRY_HREF),
    });
    process.exit(1);
  }
  console.log("ORCH-1224 business-route gate self-test passed.");
  process.exit(0);
}

const failures = [];

const marketingAbs = join(root, MARKETING);
if (!existsSync(marketingAbs)) {
  failures.push(`${MARKETING}: marketing app not found — cannot verify the /organisers → /host rename.`);
} else {
  failures.push(...scanSourceForOrganisersHref(marketingAbs));
}

const configAbs = join(root, NEXT_CONFIG);
const registryAbs = join(root, ROUTE_REGISTRY);
if (!existsSync(configAbs)) {
  failures.push(`${NEXT_CONFIG}: next.config.ts not found — cannot verify the /organisers → /host redirect.`);
}
if (!existsSync(registryAbs)) {
  failures.push(`${ROUTE_REGISTRY}: typed route registry not found — cannot verify the /organisers → /host redirect.`);
}
if (existsSync(configAbs) && existsSync(registryAbs)) {
  failures.push(...checkRedirectOwnership(
    readFileSync(configAbs, "utf8"),
    readFileSync(registryAbs, "utf8"),
  ));
}

if (failures.length > 0) {
  console.error("ORCH-1224 business-route gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1224 business-route gate passed.");
