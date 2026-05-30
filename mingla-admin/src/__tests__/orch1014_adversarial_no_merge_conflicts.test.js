// ORCH-1014 ADVERSARIAL — no unresolved merge conflict markers in shipped files.
//
// QA discovered the implementor committed unresolved <<<<<<< / ======= / >>>>>>>
// markers in 2 files (IntelligenceOverviewTab.jsx + strict-grep gate). Build
// FAILS in Vite ("Unexpected token '<<'"), and the strict-grep CI gate FAILS
// to even parse (SyntaxError at the marker line). Both were missed because the
// implementor's "exit 0" build claim was made BEFORE the bad merge with ORCH-1013.
//
// Fails-on-revert: if the conflict markers re-appear in ANY shipped source file,
// this test FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const FILES_TO_SCAN = [
  // shipped UI source
  "mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx",
  "mingla-admin/src/components/placeIntelligenceTrial/SeedStatusBadge.jsx",
  "mingla-admin/src/components/placeIntelligenceTrial/RefreshStatusBadge.jsx",
  "mingla-admin/src/components/placeIntelligenceTrial/seedRefreshBadgeContent.js",
  "mingla-admin/src/lib/constants.js",
  "mingla-admin/src/App.jsx",
  // shipped edge fn
  "supabase/functions/run-place-intelligence-trial/index.ts",
  // CI gate
  ".github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs",
];

const CONFLICT_PATTERNS = [/^<<<<<<< /m, /^=======$/m, /^>>>>>>> /m];

describe("ORCH-1014 ADVERSARIAL — no unresolved merge conflict markers", () => {
  for (const rel of FILES_TO_SCAN) {
    it(`${rel} has no <<<<<<<, =======, or >>>>>>> markers`, () => {
      const p = path.join(REPO_ROOT, rel);
      assert.ok(fs.existsSync(p), `file should exist: ${rel}`);
      const src = fs.readFileSync(p, "utf8");
      for (const pat of CONFLICT_PATTERNS) {
        const m = src.match(pat);
        assert.equal(
          m,
          null,
          `unresolved git conflict marker found in ${rel} matching ${pat}: '${m?.[0]}'`,
        );
      }
    });
  }
});
