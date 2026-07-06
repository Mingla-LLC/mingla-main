#!/usr/bin/env node
/**
 * ORCH-1319 [Kill the beta link] — G-4.
 * Invariant: I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT (+ I-1319-NO-DOWNLOAD-GATE).
 *
 * The single hard proof the beta link is gone forever: the token
 * `testflight.apple.com` must appear in ZERO files (source OR comment) under
 * mingla-marketing/ AND supabase/functions/. Catches someone "temporarily"
 * restoring the beta link in the edge fn or a new component.
 *
 * NOT comment-stripped by design — a commented-out TestFlight URL still counts as
 * a reappearance and must fail.
 *
 * --self-test injects fixtures (clean → pass; a testflight token → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const SCAN_DIRS = [
  path.join(root, "mingla-marketing"),
  path.join(root, "supabase", "functions"),
];
const SCAN_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".toml", ".md", ".mdx", ".css", ".scss", ".txt", ".html", ".svg", ".yml", ".yaml",
]);
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build", "out", ".turbo", ".git"]);

// The forbidden token (case-insensitive — a Capitalized "TestFlight.apple.com"
// still counts as the live beta host reappearing).
const TESTFLIGHT_RE = /testflight\.apple\.com/i;

function checkContent(src, relPath, failures) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (TESTFLIGHT_RE.test(lines[i])) {
      failures.push(
        `${relPath}:${i + 1}: contains a \`testflight.apple.com\` token — the beta ` +
          `link is retired (ORCH-1319). The app is live on both public stores.`,
      );
    }
  }
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), files);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      files.push(path.join(dir, e.name));
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkContent(s, "fixture", f); return f; };

  // (a) Clean file → MUST pass.
  const good = `const APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'\n`;
  if (run(good).length !== 0) selfFailures.push("clean file wrongly flagged");

  // (b) A live testflight URL → MUST fire.
  const bad = `const x = "https://testflight.apple.com/join/1gvHNqkQ";\n`;
  if (run(bad).length === 0) selfFailures.push("testflight URL not flagged");

  // (c) A COMMENTED testflight URL → MUST STILL fire (not comment-stripped).
  const commented = `// old link was https://testflight.apple.com/join/1gvHNqkQ\n`;
  if (run(commented).length === 0) selfFailures.push("commented testflight URL not flagged");

  // (d) Capitalized host → MUST fire (case-insensitive).
  const caps = `Open TestFlight.apple.com/join/x\n`;
  if (run(caps).length === 0) selfFailures.push("capitalized testflight host not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1319 G-4 no-testflight-anywhere self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1319 G-4 no-testflight-anywhere self-test PASS (4/4 cases).");
  process.exit(0);
}

// ---- Live mode
const files = [];
for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) {
    console.error(`ORCH-1319 G-4 FAIL — scan dir not found: ${dir} (path out of sync).`);
    process.exit(1);
  }
  walk(dir, files);
}
const failures = [];
for (const f of files) {
  checkContent(fs.readFileSync(f, "utf8"), path.relative(root, f), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1319 G-4 FAIL — a `testflight.apple.com` token reappeared under\n" +
      "mingla-marketing/ or supabase/functions/. The beta link is retired.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1319 G-4 PASS — scanned ${files.length} files under mingla-marketing/ + ` +
    `supabase/functions/; zero testflight.apple.com tokens.`,
);
