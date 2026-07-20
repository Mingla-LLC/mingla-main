#!/usr/bin/env node
/**
 * ISSUE-1001 [brand logo consolidation] — DEAD LOGO URLS ARE BANNED, REPO-WIDE.
 * I-PROPOSED-1001-BRAND-ASSET-CANON rule (a).
 *
 * WHY THIS GATE EXISTS (read before "fixing" a red here by re-adding a
 * fallback): before #1001, FOUR backend call sites (marketingEmailRender,
 * careers-apply x2, brandInviteEmail) silently fell back to a DEAD 404 URL
 * on the retired `/email-assets/` path whenever the MINGLA_LOGO_URL secret
 * was missing — every marketing/careers/invite email shipped a broken logo.
 * A second dead literal (the bare `/logo.png` root path) lived in test env
 * pins. #1001 consolidated ALL backend logo resolution onto
 * `supabase/functions/_shared/brandAssets.ts` (env override → LIVE bare-host
 * default). Any reappearance of either dead literal means a code path can
 * resolve a 404 logo again.
 *
 * THE RULE: zero occurrences of either dead literal across git-tracked text
 * files. The sole allowlisted exception is THIS gate's own pattern constants
 * (self-excluded by path; the constants are assembled from parts so no other
 * scanner trips on them either).
 *
 * Fails-on-revert: restoring the dead fallback in marketingEmailRender.ts
 * (or any file) makes this exit 1. `--self-test` proves both directions.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SELF = ".github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs";

// Assembled from parts — the joined literals never appear verbatim here.
export const DEAD_PATTERNS = [
  ["usemingla.com", "email-assets", "mingla-logo.png"].join("/"),
  ["usemingla.com", "logo.png"].join("/"),
];

// Binary / non-text extensions never scanned (a PNG can't carry a URL that
// any renderer resolves).
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip",
  ".jar", ".keystore", ".p8", ".p12", ".mp4", ".mov", ".ttf", ".otf",
  ".woff", ".woff2", ".hbc", ".lottie", ".svga", ".bin",
]);

export function isScannable(relPath) {
  if (relPath === SELF) return false; // sole allowlisted exception
  return !SKIP_EXT.has(path.extname(relPath).toLowerCase());
}

/**
 * Pure check: `files` is [{ path, text }]. Returns violations
 * [{ path, line, pattern }].
 */
export function check(files) {
  const violations = [];
  for (const f of files) {
    if (!isScannable(f.path)) continue;
    const lines = f.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of DEAD_PATTERNS) {
        if (lines[i].includes(pattern)) {
          violations.push({ path: f.path, line: i + 1, pattern });
        }
      }
    }
  }
  return violations;
}

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function selfTest() {
  const clean = [
    { path: "supabase/functions/_shared/brandAssets.ts",
      text: 'const x = "https://usemingla.com/brand/email/mingla-wordmark-email.png";' },
    { path: "docs/notes.md", text: "nothing to see" },
  ];
  const plantedA = [{
    path: "supabase/functions/_shared/marketingEmailRender.ts",
    text: `logoUrl: Deno.env.get("MINGLA_LOGO_URL") ?? "https://${DEAD_PATTERNS[0]}",`,
  }];
  const plantedB = [{
    path: "supabase/functions/__tests__/x.test.ts",
    text: `Deno.env.set("MINGLA_LOGO_URL", "https://${DEAD_PATTERNS[1]}");`,
  }];
  const plantedInBinary = [{
    path: "app-mobile/assets/icon.png",
    text: `https://${DEAD_PATTERNS[0]}`,
  }];
  const plantedInSelf = [{ path: SELF, text: `"https://${DEAD_PATTERNS[0]}"` }];

  const cases = [
    ["clean tree passes", check(clean).length === 0],
    ["planted email-assets literal fails", check(plantedA).length === 1],
    ["planted root logo.png literal fails", check(plantedB).length === 1],
    ["binary paths are skipped", check(plantedInBinary).length === 0],
    ["the gate's own file is self-excluded", check(plantedInSelf).length === 0],
  ];
  let ok = true;
  for (const [name, pass] of cases) {
    if (!pass) {
      ok = false;
      console.error(`SELF-TEST FAIL: ${name}`);
    }
  }
  if (!ok) process.exit(1);
  console.log(
    `issue-1001-dead-logo-urls self-test OK (${cases.length}/${cases.length} cases).`,
  );
  process.exit(0);
}

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  let files;
  try {
    files = listTrackedFiles()
      .filter((p) => isScannable(p))
      .map((p) => {
        try {
          return { path: p, text: readFileSync(path.join(REPO_ROOT, p), "utf8") };
        } catch {
          return { path: p, text: "" }; // deleted-in-worktree tracked path
        }
      });
  } catch (err) {
    console.error("issue-1001-dead-logo-urls: git ls-files failed:", err.message);
    process.exit(2);
  }

  const violations = check(files);
  if (violations.length > 0) {
    console.error(
      "✗ ISSUE-1001 / I-PROPOSED-1001-BRAND-ASSET-CANON (a) — dead logo URLs found:",
    );
    for (const v of violations) {
      console.error(`  - ${v.path}:${v.line} contains "${v.pattern}"`);
    }
    console.error(
      "\nResolve the logo through supabase/functions/_shared/brandAssets.ts " +
        "(minglaLogoUrl()) or the canonical hosted URL. Never re-add a dead " +
        "fallback — see this gate's header.",
    );
    process.exit(1);
  }
  console.log("✓ ISSUE-1001: zero dead logo URLs in tracked text files.");
}

main();
