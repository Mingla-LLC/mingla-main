#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-SHELL-AGNOSTIC.
 *
 * The shared RsvpOfferingBody is PURE CONTENT: it hosts NO scroll root and NO
 * cover host. It MUST NOT import or render ParallaxCoverShell (doing so re-triggers
 * the consumer gorhom freeze). The SURFACE owns the cover scaffold — the business
 * FoundationRsvpPreview composes ParallaxCoverShell AROUND the shared body.
 *
 * Structural source-string gate. FAIL-ON-REVERT: re-introduce ParallaxCoverShell
 * inside the body, or drop it from the surface, and a check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};
// Strip comments so the "no ParallaxCoverShell" invariant binds to imports/JSX —
// the body's own doc comment legitimately says it MUST NOT wrap ParallaxCoverShell.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const body = read("packages/offering-rendering/RsvpOfferingBody.tsx");
const bodyCode = stripComments(body);
const foundation = read(
  "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
);

check(
  "T1 RsvpOfferingBody is shell-agnostic (no ParallaxCoverShell import/render)",
  !bodyCode.includes("ParallaxCoverShell"),
  "packages/offering-rendering/RsvpOfferingBody.tsx must NOT import or render ParallaxCoverShell (comments excluded)",
);
check(
  "T2 FoundationRsvpPreview imports ParallaxCoverShell from @mingla/offering-rendering",
  /import\s*\{[\s\S]*?\bParallaxCoverShell\b[\s\S]*?\}\s*from\s*["']@mingla\/offering-rendering["']/.test(
    foundation,
  ),
  "FoundationRsvpPreview.tsx (the surface) must import ParallaxCoverShell",
);
check(
  "T3 FoundationRsvpPreview composes <ParallaxCoverShell around the body",
  foundation.includes("<ParallaxCoverShell"),
  "FoundationRsvpPreview.tsx must render <ParallaxCoverShell (the surface owns the cover scaffold)",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-shell-agnostic gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-shell-agnostic gate: PASS");
