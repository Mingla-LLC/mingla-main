/**
 * Shared measurement for the business-web boot budget (issue #1509).
 *
 * ONE definition of "how big is the boot payload", used by all three consumers:
 *   - scripts/ci/orch-1083-initial-bundle-budget.mjs  (the PR gate)
 *   - scripts/ci/bundle-baseline-update.mjs           (the post-merge ratchet)
 *   - scripts/ci/bundle-attribute.mjs                 (the attribution tool)
 *
 * Before #1509 the gate computed sizes inline, which is why the ratchet and the
 * attribution could not exist without duplicating (and eventually contradicting)
 * it. Any change to what "boot payload" means belongs HERE and nowhere else.
 *
 * Terms:
 *   eager  — every <script> referenced by web-build/index.html. This is what a
 *            visitor downloads before ANY route renders, guest or authenticated.
 *   common — the single `__common` chunk inside `eager`. Metro hoists any module
 *            imported by two or more async chunks into it, so it grows whenever
 *            code is shared between lazy routes, not only when boot code is added.
 *
 * Sizes are reported three ways because they answer different questions:
 *   raw    — what the build produced. Stable, comparable, what the old cap used.
 *   gzip   — the floor any CDN gives you.
 *   brotli — what Vercel actually serves, i.e. what a guest on mobile data waits
 *            for. This is the CUSTOMER-FELT number and the one the product
 *            ceiling is expressed in.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { join } from "node:path";

/** Deferred specifiers that must never be statically reachable from an eager script. */
export const DEFERRED_SPECIFIERS = [
  "@stripe/connect-js",
  "@stripe/react-connect-js",
  "react-native-qrcode-svg",
  "@expo-google-fonts/",
];

/** Compress with the settings a CDN would use for a static asset it serves repeatedly. */
function compressedSizes(buf) {
  return {
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
  };
}

const zero = () => ({ raw: 0, gzip: 0, brotli: 0 });
const add = (acc, s) => {
  acc.raw += s.raw;
  acc.gzip += s.gzip;
  acc.brotli += s.brotli;
  return acc;
};

/**
 * Measure a `expo export -p web` output directory.
 *
 * @param {string} webBuild path to the export directory
 * @returns {{
 *   eager: {raw:number,gzip:number,brotli:number},
 *   common: {raw:number,gzip:number,brotli:number}|null,
 *   commonRel: string|null,
 *   mainEntryRel: string,
 *   scriptRels: string[],
 *   chunkCount: number,
 *   perScript: Array<{rel:string,raw:number,gzip:number,brotli:number}>,
 * }}
 */
export function measureWebBuild(webBuild) {
  const indexPath = join(webBuild, "index.html");
  let html;
  try {
    html = readFileSync(indexPath, "utf8");
  } catch (err) {
    throw new Error(
      `cannot read ${indexPath} (run \`npm run web:export\` first): ${err.message}`,
    );
  }

  const scriptRels = [
    ...html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g),
  ].map((m) => m[0]);
  if (scriptRels.length === 0) {
    throw new Error(`no <script> references found in ${indexPath}`);
  }

  const perScript = [];
  const eager = zero();
  for (const rel of scriptRels) {
    const buf = readFileSync(join(webBuild, rel.replace(/^\//, "")));
    const entry = { rel, raw: buf.length, ...compressedSizes(buf) };
    perScript.push(entry);
    add(eager, entry);
  }

  const commonEntry = perScript.find((e) => e.rel.includes("__common")) ?? null;

  // The main entry chunk is the largest index-*.js — the app bulk.
  const indexEntries = perScript
    .filter((e) => /\/index-[0-9a-f]+\.js$/.test(e.rel))
    .sort((a, b) => b.raw - a.raw);
  if (indexEntries.length === 0) {
    throw new Error("could not identify the main entry chunk (index-*.js) in index.html");
  }

  const jsDir = join(webBuild, "_expo", "static", "js", "web");
  const chunkCount = readdirSync(jsDir).filter((n) => n.endsWith(".js")).length;

  return {
    eager,
    common: commonEntry
      ? { raw: commonEntry.raw, gzip: commonEntry.gzip, brotli: commonEntry.brotli }
      : null,
    commonRel: commonEntry?.rel ?? null,
    mainEntryRel: indexEntries[0].rel,
    scriptRels,
    chunkCount,
    perScript,
  };
}

/** Format a byte count as `1,234,567 B (1.18 MB)`. */
export function fmt(bytes) {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1_048_576).toFixed(2)} MB)`;
}

/** Format a size triple on one line. */
export function fmtTriple(s) {
  return `raw ${s.raw.toLocaleString("en-US")} · gzip ${s.gzip.toLocaleString(
    "en-US",
  )} · brotli ${s.brotli.toLocaleString("en-US")}`;
}

/** Signed byte delta, e.g. `+3,660` / `-12,004`. */
export function fmtDelta(n) {
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("en-US")}`;
}

export { statSync };
