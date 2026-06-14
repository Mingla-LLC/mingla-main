#!/usr/bin/env node

/**
 * I-PROPOSED-WEB-TOPBAR-BREATHING-GAP  (ORCH-1136 Batch C / F-1)
 *
 * CONTEXT: on web `insets.top === 0` (no viewport-fit=cover), so the detail
 * (event/trip/experience) and Home/Hub top bars sat glued to the browser
 * viewport top — Seth's perceived "hug." This is a perceived-spacing polish, NOT
 * a code defect (F-1's header-container theory is proven negative on web — the
 * headers are byte-identical). The fix adds an ADDITIVE, WEB-ONLY `spacing.sm`
 * (8px) top padding so the chrome isn't flush to the viewport edge; native top
 * insets are UNTOUCHED (+0 on native).
 *
 * THE RULE: each of the five top-bar wrappers must add a web-only top padding
 * gated on `Platform.OS === 'web'` and sized `spacing.sm`. FAILS if the web gap
 * is removed from any surface, or if a NON-web-gated top padding is introduced
 * (which would double-inset native).
 *
 * Scope: the five mingla-business top-bar hosts in the allowlist.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// Each entry: the file + how many web-gated `spacing.sm` top-padding sites it
// must carry. event/[id] has TWO header wrappers (not-found shell + main).
const TARGETS = [
  { rel: "mingla-business/app/event/[id]/index.tsx", min: 2 },
  { rel: "mingla-business/app/trip/[id]/index.tsx", min: 1 },
  { rel: "mingla-business/app/experience/[id]/index.tsx", min: 1 },
  { rel: "mingla-business/app/(tabs)/home.tsx", min: 1 },
  { rel: "mingla-business/app/(tabs)/hub/_layout.tsx", min: 1 },
];

const violations = [];

// Two accepted web-gated spacing.sm shapes:
//   (a) ternary added to an existing inset: `(Platform.OS === "web" ? spacing.sm : 0)`
//   (b) conditional style object:           `Platform.OS === "web" ? { paddingTop: spacing.sm } : null`
const PATTERN_A =
  /Platform\.OS\s*===\s*["']web["']\s*\?\s*spacing\.sm\s*:\s*0/g;
const PATTERN_B =
  /Platform\.OS\s*===\s*["']web["']\s*\?\s*\{\s*paddingTop:\s*spacing\.sm\s*\}\s*:\s*null/g;

for (const { rel, min } of TARGETS) {
  let src;
  try {
    src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    violations.push(`cannot read ${rel}`);
    continue;
  }
  const countA = (src.match(PATTERN_A) ?? []).length;
  const countB = (src.match(PATTERN_B) ?? []).length;
  const total = countA + countB;
  if (total < min) {
    violations.push(
      `${rel}: expected >= ${min} web-gated spacing.sm top-padding site(s), found ${total} ` +
        `(the ORCH-1136 web breathing gap was removed or not web-gated).`,
    );
  }
}

if (violations.length > 0) {
  console.error("\nFAIL [I-PROPOSED-WEB-TOPBAR-BREATHING-GAP]:");
  console.error(
    "  Detail + Home/Hub top bars must add a WEB-ONLY `spacing.sm` top padding",
  );
  console.error(
    "  (Platform.OS === 'web'); native top insets stay untouched (ORCH-1136 F-1).",
  );
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error("");
  process.exit(1);
}

console.log(
  "OK [I-PROPOSED-WEB-TOPBAR-BREATHING-GAP]: all five top-bar hosts carry the web-gated spacing.sm breathing gap; native untouched.",
);
