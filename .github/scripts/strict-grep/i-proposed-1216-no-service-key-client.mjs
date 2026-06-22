#!/usr/bin/env node
/**
 * ORCH-1216 [Explorer "Get the app" lead-capture] —
 * I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT (mirror of I-1045-NO-SERVICE-KEY-CLIENT).
 *
 * WHY: the explorer marketing site is unauthenticated and ships to the public.
 * The lead transport uses the ANON key only (RLS denies anon SELECT; the edge fn
 * re-validates + writes via the service role server-side). A Supabase service-role
 * key / secret in any mingla-marketing/ file would be a catastrophic leak. This
 * gate asserts NO service-role token appears anywhere under mingla-marketing/.
 *
 * Banned tokens (any source/ts/tsx/js/jsx/mjs/cjs file under mingla-marketing/):
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - service_role  (the role name; in a JWT/header this is the secret posture)
 *   - sb_secret     (new-style Supabase secret key prefix)
 *   - rk_live_ / rk_test_  (Stripe restricted-key style secret prefixes)
 *
 * `--self-test` injects fixtures (a service-role read in a marketing file → MUST
 * fire; anon-only transport → MUST pass).
 *
 * Model: orch-1211-notif-web-render-safe.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const SCAN_DIR = path.join(root, "mingla-marketing");
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
// Skip generated / vendored dirs.
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build", "out", ".turbo"]);

const BANNED = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /\bservice_role\b/,
  /\bsb_secret/,
  /\brk_(live|test)_/,
];

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

function checkSource(src, relPath, failures) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const re of BANNED) {
      if (re.test(line)) {
        failures.push(
          `${relPath}:${i + 1}: banned service-role token "${re}" — the marketing ` +
            `client must use the ANON key only (I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT).`,
        );
      }
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    checkSource(src, "fixture.ts", f);
    return f;
  };

  // (a) Anon-only transport → MUST pass.
  const good = `const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";\nheaders: { apikey: ANON_KEY };\n`;
  if (run(good).length !== 0) {
    selfFailures.push("anon-only transport wrongly flagged");
  }

  // (b) Service-role env read → MUST fire.
  const badEnv = `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`;
  if (run(badEnv).length === 0) {
    selfFailures.push("SUPABASE_SERVICE_ROLE_KEY not flagged");
  }

  // (c) service_role role name → MUST fire.
  const badRole = `createClient(url, key, { db: { role: 'service_role' } });\n`;
  if (run(badRole).length === 0) {
    selfFailures.push("service_role token not flagged");
  }

  // (d) sb_secret / rk_live_ secret prefixes → MUST fire.
  const badSecret = `const s = "sb_secret_abc";\nconst r = "rk_live_xyz";\n`;
  if (run(badSecret).length < 2) {
    selfFailures.push("sb_secret / rk_live_ secret prefixes not both flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1216 I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1216 I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

// ---- Live mode
if (!fs.existsSync(SCAN_DIR)) {
  console.error(
    `ORCH-1216 gate FAIL — mingla-marketing/ not found at ${SCAN_DIR} (gate path out of sync).`,
  );
  process.exit(1);
}
const files = [];
walk(SCAN_DIR, files);
const failures = [];
for (const f of files) {
  checkSource(fs.readFileSync(f, "utf8"), path.relative(root, f), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1216 I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT FAIL — a service-role key /\n" +
      "secret token appears in a mingla-marketing/ client file. The marketing\n" +
      "client must use the public anon key ONLY.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1216 I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT PASS — scanned ${files.length} ` +
    `mingla-marketing/ files; no service-role token present.`,
);
