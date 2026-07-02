#!/usr/bin/env node
/**
 * META-ORCH-1255 — I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE (DRAFT),
 * strict-grep arm (enforcement (b)). Venue creation NEVER inserts a brands row.
 *
 * Fails if:
 *   (a) any migration with version >= 20261130000000 (re)defines
 *       biz_create_venue_brand_authoring or biz_create_venue_brand_pending_review
 *       with a FUNCTIONAL body — the only allowed body is the fail-soft stub
 *       raising 'venue_creation_moved:update_app' (no INSERT anywhere in it);
 *   (b) any migration >= 20261130000000 defines biz_create_venue_listing with a
 *       brands-table INSERT in its body (the F-1 hidden-brand path returning);
 *   (c) mingla-business/src/components/venue/VenueCreatorWizard.tsx or
 *       mingla-business/src/services/venueListingsService.ts references the
 *       decommissioned RPC names (Leg B files; missing file = skipped).
 *
 * SQL runtime complement: supabase/migrations/__tests__/orch_1255_no_hidden_brand.test.sql.
 * Mirrors the modular self-testing gate pattern (sibling: orch-1186-hours-single-owner.mjs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const MIGRATIONS_DIR = join(root, "supabase", "migrations");
const MIN_VERSION = 20261130000000n;
const DECOMMISSIONED = [
  "biz_create_venue_brand_authoring",
  "biz_create_venue_brand_pending_review",
];
const STUB_MARKER = "venue_creation_moved:update_app";

// Strip SQL comments so explanatory notes never trip the gate.
const stripSql = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^-])--.*$/gm, "$1");

// Extract each CREATE [OR REPLACE] FUNCTION block for `fn` (to the terminating
// dollar-quote + semicolon).
const functionBlocks = (code, fn) => {
  const blocks = [];
  const re = new RegExp(
    `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\b[\\s\\S]*?\\$[a-zA-Z_]*\\$;`,
    "gi",
  );
  let m;
  while ((m = re.exec(code)) !== null) blocks.push(m[0]);
  return blocks;
};

const run = (files) => {
  // files: [{ name, read: () => string }]
  const failures = [];
  for (const f of files) {
    const versionMatch = basename(f.name).match(/^(\d{14})/);
    if (!versionMatch) continue;
    if (BigInt(versionMatch[1]) < MIN_VERSION) continue;
    const code = stripSql(f.read());

    for (const fn of DECOMMISSIONED) {
      for (const block of functionBlocks(code, fn)) {
        const functional = /\bINSERT\s+INTO\b/i.test(block) ||
          !block.includes(STUB_MARKER);
        if (functional) {
          failures.push(
            `${f.name}: (re)defines ${fn} with a FUNCTIONAL body — the hidden-brand venue path is decommissioned; only the '${STUB_MARKER}' stub is allowed.`,
          );
        }
      }
    }

    for (const block of functionBlocks(code, "biz_create_venue_listing")) {
      if (/\bINSERT\s+INTO\s+(public\.)?brands\b/i.test(block)) {
        failures.push(
          `${f.name}: biz_create_venue_listing inserts into brands — venue creation must NEVER create a brands row (D-1).`,
        );
      }
    }
  }
  return failures;
};

const runClient = (clientFiles) => {
  const failures = [];
  for (const cf of clientFiles) {
    const code = cf.read();
    if (code === null) continue; // Leg B file not present yet — skipped.
    for (const fn of DECOMMISSIONED) {
      if (code.includes(fn)) {
        failures.push(
          `${cf.name}: references decommissioned RPC ${fn} — the venue create path is biz_create_venue_listing.`,
        );
      }
    }
  }
  return failures;
};

if (SELF_TEST) {
  const stub = `CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring (p text) RETURNS uuid AS $$ BEGIN RAISE EXCEPTION '${STUB_MARKER}'; END; $$;`;
  const goodCreate = `CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (p uuid) RETURNS uuid AS $$ BEGIN INSERT INTO public.venue_listings (brand_id) VALUES (p); RETURN p; END; $$;`;
  const ok = run([
    { name: "20261130000003_x.sql", read: () => stub + "\n" + goodCreate },
  ]);
  if (ok.length !== 0) {
    console.error("SELF-TEST FAIL: clean fixture should pass:", ok);
    process.exit(1);
  }
  const badFunctional = run([
    {
      name: "20261201000000_y.sql",
      read: () =>
        `CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring (p text) RETURNS uuid AS $$ BEGIN INSERT INTO public.brands (name) VALUES (p); END; $$;`,
    },
  ]);
  if (badFunctional.length === 0) {
    console.error("SELF-TEST FAIL: functional decommissioned body should fail");
    process.exit(1);
  }
  const badBrandInsert = run([
    {
      name: "20261201000001_z.sql",
      read: () =>
        `CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (p uuid) RETURNS uuid AS $$ BEGIN INSERT INTO public.brands (name) VALUES ('x'); END; $$;`,
    },
  ]);
  if (badBrandInsert.length === 0) {
    console.error("SELF-TEST FAIL: brands INSERT in create RPC should fail");
    process.exit(1);
  }
  const badClient = runClient([
    {
      name: "venueListingsService.ts",
      read: () => 'await supabase.rpc("biz_create_venue_brand_authoring", {});',
    },
  ]);
  if (badClient.length === 0) {
    console.error("SELF-TEST FAIL: client reference to old RPC should fail");
    process.exit(1);
  }
  console.log("ORCH-1255 no-hidden-brand-on-venue-create gate self-test passed.");
  process.exit(0);
}

const sqlFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({
      name: f,
      read: () => readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
    }))
  : [];

const clientPaths = [
  join(root, "mingla-business", "src", "components", "venue", "VenueCreatorWizard.tsx"),
  join(root, "mingla-business", "src", "services", "venueListingsService.ts"),
];
const clientFiles = clientPaths.map((p) => ({
  name: p.slice(root.length + 1),
  read: () => (existsSync(p) ? readFileSync(p, "utf8") : null),
}));

const failures = [...run(sqlFiles), ...runClient(clientFiles)];
if (failures.length > 0) {
  console.error("ORCH-1255 no-hidden-brand-on-venue-create gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1255 no-hidden-brand-on-venue-create gate passed.");
