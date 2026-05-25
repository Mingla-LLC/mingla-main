/**
 * ORCH-0955 [Native Stripe Tax for Platforms] — region gate decommissioned
 * (adversarial assertions).
 *
 * Original purpose (ORCH-0953 §8 adversarial): probes against ORCH-0953's
 * region gate — case-sensitivity, whitespace, null/undefined, partial-match
 * attacks against `NATIVE_PAID_ALLOWED_REGIONS` parsing.
 *
 * Per ORCH-0955 CLOSE 2026-05-25 + I-PROPOSED-REGION-GATE-DELETED: the
 * gate is entirely deleted. Adversarial probes against a deleted gate are
 * meaningless. Rewritten to adversarially assert the DELETED state —
 * verifying no fragment of the gate snuck back in via copy-paste, comments,
 * configs, or sibling files.
 *
 * Preserved per append-only policy. [TEST-MOD-APPROVED ORCH-0955]
 */

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

const REPO_ROOT = new URL("../../../..", import.meta.url).pathname;
const SCAN_DIRS = [
  `${REPO_ROOT}supabase/functions`,
  `${REPO_ROOT}app-mobile/src`,
  `${REPO_ROOT}mingla-business/src`,
  `${REPO_ROOT}mingla-business/app`,
];

const FORBIDDEN_TOKENS = [
  "NATIVE_PAID_ALLOWED_REGIONS",
  "isNativePaidAllowedForBrand",
  "getNativePaidAllowedRegions",
  "native_paid_not_allowed_in_region",
];

async function scanForToken(token: string): Promise<string[]> {
  const hits: string[] = [];
  for (const dir of SCAN_DIRS) {
    try {
      for await (
        const entry of walk(dir, {
          includeDirs: false,
          exts: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
          skip: [/node_modules/, /__tests__/, /\.test\.[jt]sx?$/],
        })
      ) {
        const src = await Deno.readTextFile(entry.path);
        if (src.includes(token)) hits.push(entry.path);
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return hits;
}

for (const token of FORBIDDEN_TOKENS) {
  Deno.test(
    `ORCH-0955 adversarial: token \`${token}\` MUST NOT appear in any product source file`,
    async () => {
      const hits = await scanForToken(token);
      assert(
        hits.length === 0,
        `ORCH-0955 I-PROPOSED-REGION-GATE-DELETED violated: token \`${token}\` found in:\n${hits.join("\n")}`,
      );
    },
  );
}

Deno.test("ORCH-0955 adversarial: _shared/stripeTax.ts MUST NOT be re-created", async () => {
  let exists = true;
  try {
    await Deno.stat(`${REPO_ROOT}supabase/functions/_shared/stripeTax.ts`);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) exists = false;
    else throw err;
  }
  assert(!exists, "_shared/stripeTax.ts must not be re-created after ORCH-0955 deletion");
});
