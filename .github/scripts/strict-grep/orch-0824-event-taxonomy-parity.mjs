#!/usr/bin/env node
/**
 * ORCH-0824 — I-PROPOSED-EVENT-TAXONOMY-PARITY gate.
 *
 * The canonical event taxonomy (Party Types / Vibe Tags / Music Genres)
 * is duplicated in three places to satisfy the cross-stack import boundary
 * (Deno edge function / business RN app / mobile RN app cannot share one
 * module without monorepo plumbing not in scope for ORCH-0824):
 *
 *   - supabase/functions/_shared/eventTaxonomy.ts
 *   - mingla-business/src/constants/eventTaxonomy.ts
 *   - app-mobile/src/constants/eventTaxonomy.ts
 *
 * This gate enforces byte-for-byte equivalence so a partial update can
 * never silently desync the three sides.
 *
 * If a future ORCH establishes a real monorepo shared package, this gate
 * can be retired AND the three files collapsed into one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const PATHS = [
  "supabase/functions/_shared/eventTaxonomy.ts",
  "mingla-business/src/constants/eventTaxonomy.ts",
  "app-mobile/src/constants/eventTaxonomy.ts",
];

const contents = PATHS.map((p) => {
  try {
    return { path: p, content: readFileSync(join(REPO_ROOT, p), "utf8") };
  } catch (e) {
    console.error(`[ORCH-0824 TAXONOMY-PARITY] missing file: ${p}`);
    process.exit(1);
  }
});

const reference = contents[0];
let drift = 0;

for (const c of contents.slice(1)) {
  if (c.content !== reference.content) {
    drift++;
    console.error(
      `\n[ORCH-0824 TAXONOMY-PARITY] file content drift\n  reference: ${reference.path}\n  diverged:  ${c.path}\n`,
    );
    // Print a short diff hint — first differing line.
    const a = reference.content.split("\n");
    const b = c.content.split("\n");
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== b[i]) {
        console.error(`  first diff at line ${i + 1}:`);
        console.error(`    reference: ${a[i] ?? "(eof)"}`);
        console.error(`    diverged : ${b[i] ?? "(eof)"}`);
        break;
      }
    }
  }
}

if (drift > 0) {
  console.error(
    `\nORCH-0824 TAXONOMY-PARITY gate: ${drift} file(s) drifted from the reference.`,
  );
  console.error(
    "Re-sync via:\n" +
      "  cp supabase/functions/_shared/eventTaxonomy.ts mingla-business/src/constants/eventTaxonomy.ts\n" +
      "  cp supabase/functions/_shared/eventTaxonomy.ts app-mobile/src/constants/eventTaxonomy.ts",
  );
  process.exit(1);
}

console.log("ORCH-0824 TAXONOMY-PARITY: clean — three modules byte-equivalent.");
process.exit(0);
