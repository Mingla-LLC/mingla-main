#!/usr/bin/env node
/**
 * ORCH-1186-C — the venue menu is DISTINCT from the snap-menu Gemini parser.
 *
 * Invariant I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS (DRAFT): the manually
 * authored venue menu (menus / menu_items) is fully separate from the snap-menu
 * path (parse-restaurant-menu → experience_stops → create_experience, the
 * curated-experience builder). The menu data layer + builder MUST NOT import or
 * query that path.
 *
 * This gate FAILS the build if any menu data/builder file references
 * `experience_stops`, `parse-restaurant-menu`, or `create_experience`
 * (comments stripped so explanatory notes never trip it):
 *   - mingla-business/src/services/menusService.ts
 *   - mingla-business/src/services/publicMenusService.ts
 *   - mingla-business/src/hooks/useMenus.ts
 *   - mingla-business/src/components/venue/VenueMenuModule.tsx
 *
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 * Supports `--self-test`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const files = [
  "mingla-business/src/services/menusService.ts",
  "mingla-business/src/services/publicMenusService.ts",
  "mingla-business/src/hooks/useMenus.ts",
  "mingla-business/src/components/venue/VenueMenuModule.tsx",
];

const FORBIDDEN = [
  /experience_stops/i,
  /parse-restaurant-menu/i,
  /create_experience/i,
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const scan = (label, code, failures) => {
  const clean = stripComments(code);
  for (const re of FORBIDDEN) {
    if (re.test(clean)) {
      failures.push(
        `${label}: references /${re.source}/ — the venue menu must stay DISTINCT from the snap-menu parser / experience_stops (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).`,
      );
    }
  }
};

if (process.argv.includes("--self-test")) {
  const fails = [];
  scan("self-test", "const r = supabase.from('experience_stops').select('*');", fails);
  if (fails.length === 0) {
    console.error("ORCH-1186-C no-entanglement gate self-test FAILED: matcher did not catch experience_stops.");
    process.exit(1);
  }
  const clean = [];
  scan("self-test-clean", "const r = supabase.from('menu_items').select('*');", clean);
  if (clean.length !== 0) {
    console.error("ORCH-1186-C no-entanglement gate self-test FAILED: matcher false-positived on menu_items.");
    process.exit(1);
  }
  console.log("ORCH-1186-C no-entanglement gate self-test passed.");
  process.exit(0);
}

const failures = [];
for (const rel of files) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    failures.push(`${rel}: missing — the menu data/builder file must exist (ORCH-1186-C).`);
    continue;
  }
  scan(rel, readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error("ORCH-1186-C menu-not-experience-stops gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1186-C menu-not-experience-stops gate passed.");
