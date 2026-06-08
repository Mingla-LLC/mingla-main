#!/usr/bin/env node
/**
 * ORCH-1105 [Business-web parity strict-grep gates] — I-WEB-GLASS-OPAQUE-FALLBACK.
 *
 * WHY: ORCH-1100 RC-2 — Mingla's glass surfaces (expo-blur `BlurView` L1 base +
 * translucent tint floor) render see-through panels on Android, on web without
 * `backdrop-filter`, and on mobile web < 768px (where a media rule strips
 * `backdrop-filter` even though `CSS.supports` still returns true). The fix
 * consolidated the width-aware decision into ONE helper —
 * `src/utils/glassBlur.shouldUseRealBlur(windowWidth)` — and routed every glass
 * surface through it so a transparent panel can't regress per-component.
 *
 * RULE:
 *   1. the shared helper `shouldUseRealBlur` is EXPORTED from
 *      `mingla-business/src/utils/glassBlur.ts`.
 *   2. each glass surface fixed by ORCH-1100 imports `shouldUseRealBlur` from
 *      the shared `glassBlur` module AND calls it (so the blur decision is
 *      width-aware, with an opaque fallback below the threshold). The gated
 *      surfaces are: TopSheet, GlassChrome, Toast, BlastCustomersCta,
 *      AiDisclosureModal, SheetMobile.
 *
 * A surface that renders `BlurView` glass WITHOUT routing through
 * `shouldUseRealBlur` would paint a see-through panel on phone web — exactly the
 * regression ORCH-1100 closed. This gate catches the removal of the helper call.
 *
 * SCOPE: shipped business source. Curated surface list (small, stable,
 * UX-load-bearing) rather than a fragile BlurView sweep, mirroring the curated
 * approach of the ORCH-1004 gate.
 *
 * Self-test (`--self-test`) proves the gate FIRES when a surface drops the
 * helper and PASSES when it routes through it.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const GLASS_HELPER_REL = "mingla-business/src/utils/glassBlur.ts";

// Glass surfaces fixed in ORCH-1100 (relative to mingla-business/src).
const GATED_SURFACES = [
  "components/ui/TopSheet.tsx",
  "components/ui/GlassChrome.tsx",
  "components/ui/Toast.tsx",
  "components/marketing/BlastCustomersCta.tsx",
  "components/ari/AiDisclosureModal.tsx",
  "components/ui/SheetMobile.tsx",
];

// Imports shouldUseRealBlur from a glassBlur module (relative path tolerant).
const IMPORTS_FROM_GLASSBLUR =
  /import\s*{[^}]*\bshouldUseRealBlur\b[^}]*}\s*from\s*["'][^"']*glassBlur["']/;
// Calls the helper: `shouldUseRealBlur(` somewhere in the body.
const CALLS_HELPER = /\bshouldUseRealBlur\s*\(/;

function checkHelperExport(failures) {
  const abs = path.join(root, GLASS_HELPER_REL);
  if (!fs.existsSync(abs)) {
    failures.push(
      `shared helper not found at ${GLASS_HELPER_REL} — the single source of truth for the web blur/opaque decision is gone.`,
    );
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!/export\s+const\s+shouldUseRealBlur\b/.test(src)) {
    failures.push(
      `${GLASS_HELPER_REL}: \`export const shouldUseRealBlur\` is missing — the width-aware blur decision must stay exported.`,
    );
  }
}

function checkSurface(relFromSrc, failures) {
  const abs = path.join(root, "mingla-business/src", relFromSrc);
  if (!fs.existsSync(abs)) {
    failures.push(
      `glass surface "${relFromSrc}" not found — gate surface list out of sync with source.`,
    );
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!IMPORTS_FROM_GLASSBLUR.test(src)) {
    failures.push(
      `${relFromSrc}: does not import \`shouldUseRealBlur\` from the shared glassBlur module — its glass would render see-through on phone web (ORCH-1100 RC-2).`,
    );
    return;
  }
  if (!CALLS_HELPER.test(src)) {
    failures.push(
      `${relFromSrc}: imports \`shouldUseRealBlur\` but never calls it — the blur decision must route through the width-aware helper, not a bare BlurView.`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const probe = (label, src, expectOk) => {
    const ok = IMPORTS_FROM_GLASSBLUR.test(src) && CALLS_HELPER.test(src);
    if (ok !== expectOk) {
      selfFailures.push(
        `SELF-TEST "${label}": expected ok=${expectOk}, got ${ok}`,
      );
    }
  };
  probe(
    "routed through helper (good)",
    `import { shouldUseRealBlur } from "../../utils/glassBlur";\nconst blurOk = shouldUseRealBlur(windowWidth);\n<BlurView />`,
    true,
  );
  probe(
    "bare BlurView, no helper import (bug)",
    `import { BlurView } from "expo-blur";\n<BlurView intensity={40} />`,
    false,
  );
  probe(
    "imports helper but never calls it (dead import)",
    `import { shouldUseRealBlur } from "../../utils/glassBlur";\n<BlurView />`,
    false,
  );
  // Helper-export detection
  const exportOk = /export\s+const\s+shouldUseRealBlur\b/.test(
    "export const shouldUseRealBlur = (w) => true;",
  );
  if (!exportOk) {
    selfFailures.push("SELF-TEST: helper export pattern not detected");
  }
  if (selfFailures.length) {
    console.error("ORCH-1105 I-WEB-GLASS-OPAQUE-FALLBACK self-test FAIL:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log(
    "ORCH-1105 I-WEB-GLASS-OPAQUE-FALLBACK self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
checkHelperExport(failures);
GATED_SURFACES.forEach((s) => checkSurface(s, failures));

if (failures.length > 0) {
  console.error(
    `ORCH-1105 I-WEB-GLASS-OPAQUE-FALLBACK FAIL — the ORCH-1100 web blur/opaque fallback regressed.\n` +
      `Every gated glass surface must route its blur decision through the shared\n` +
      `\`shouldUseRealBlur(windowWidth)\` helper so phone web gets an opaque fallback instead of a see-through panel.\n\nFailures:\n  ` +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1105 I-WEB-GLASS-OPAQUE-FALLBACK PASS — shared helper exported; all ${GATED_SURFACES.length} glass surfaces route through it.`,
);
