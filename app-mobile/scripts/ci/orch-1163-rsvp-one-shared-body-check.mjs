#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-ONE-SHARED-BODY.
 *
 * The public RSVP page (event_type='rsvp') renders through ONE shared, shell-
 * agnostic body — @mingla/offering-rendering's RsvpOfferingBody +
 * RsvpOfferingDecisionDock, driven by the lifted useRsvpOfferingState hook — on
 * every surface (buyer-web + business iOS/Android + consumer iOS/Android). The
 * old forked business `RsvpPublicBody` is GONE, and the consumer screen no longer
 * hand-mirrors the RSVP nodes (no bespoke rsvpDock / rsvpMomentumUnit identifiers).
 *
 * Structural source-string gate (the app-mobile .mjs convention). FAIL-ON-REVERT:
 * delete any of the asserted seams and a check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Gates live in app-mobile/scripts/ci → ../../.. is the WORKTREE root, which lets
// us reach packages/, mingla-business/, supabase/ AND app-mobile/.
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));
// Strip // line-comments + /* */ block-comments so identifier checks don't trip
// on prose that merely *names* a decommissioned node.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const barrel = read("packages/offering-rendering/index.ts");
const foundation = read(
  "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
);
const publicEventPage = read(
  "mingla-business/src/components/event/PublicEventPage.tsx",
);
const publicEventPageCode = stripComments(publicEventPage);
const consumer = read(
  "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
);
const consumerNoComments = stripComments(consumer);

// Collect the SPECIFIERS of every value `export { ... } from "./RsvpOfferingBody"`
// block (NOT `export type { ... }`). Comments stripped first so a doc mention of a
// symbol never counts as an export. A bare-greedy regex would span the whole file
// and be satisfied by prose — this binds to the actual re-export list.
const barrelCode = stripComments(barrel);
const exportedFromBody = new Set();
const blockRe =
  /export\s*\{([^}]*)\}\s*from\s*["']\.\/RsvpOfferingBody["']/g;
// `export\s*\{` does NOT match `export type {` (the `type` keyword sits between),
// so type-only re-export blocks are excluded by construction.
let blockMatch;
while ((blockMatch = blockRe.exec(barrelCode)) !== null) {
  for (const spec of blockMatch[1].split(",")) {
    const id = spec.trim().split(/\s+as\s+/)[0].trim();
    if (id.length > 0) exportedFromBody.add(id);
  }
}

check(
  "T1 barrel exports RsvpOfferingBody",
  exportedFromBody.has("RsvpOfferingBody"),
  'packages/offering-rendering/index.ts must value-export RsvpOfferingBody from "./RsvpOfferingBody"',
);
check(
  "T2 barrel exports RsvpOfferingDecisionDock",
  exportedFromBody.has("RsvpOfferingDecisionDock"),
  'packages/offering-rendering/index.ts must value-export RsvpOfferingDecisionDock from "./RsvpOfferingBody"',
);
check(
  "T3 barrel exports useRsvpOfferingState",
  exportedFromBody.has("useRsvpOfferingState"),
  'packages/offering-rendering/index.ts must value-export useRsvpOfferingState from "./RsvpOfferingBody"',
);
check(
  "T4 forked business RsvpPublicBody is DELETED (no such file)",
  exists("mingla-business/src/components/event/RsvpPublicBody.tsx") === false,
  "mingla-business/src/components/event/RsvpPublicBody.tsx must NOT exist",
);
check(
  "T5 FoundationRsvpPreview imports RsvpOfferingBody from @mingla/offering-rendering",
  /import\s*\{[\s\S]*?\bRsvpOfferingBody\b[\s\S]*?\}\s*from\s*["']@mingla\/offering-rendering["']/.test(
    foundation,
  ),
  "FoundationRsvpPreview.tsx must import RsvpOfferingBody from @mingla/offering-rendering",
);
check(
  "T6 PublicEventPage mounts <FoundationRsvpPreview",
  publicEventPage.includes("<FoundationRsvpPreview"),
  "PublicEventPage.tsx must mount <FoundationRsvpPreview",
);
check(
  "T7 PublicEventPage no longer mounts/imports the dead RsvpPublicBody",
  !publicEventPageCode.includes("<RsvpPublicBody") &&
    !/\bRsvpPublicBody\b/.test(publicEventPageCode),
  "PublicEventPage.tsx must NOT mount or import RsvpPublicBody (a comment mention is fine)",
);
check(
  "T8 ConsumerEventDetailScreen mounts the shared <RsvpOfferingBody",
  consumer.includes("<RsvpOfferingBody"),
  "ConsumerEventDetailScreen.tsx must mount <RsvpOfferingBody",
);
check(
  "T9 ConsumerEventDetailScreen has NO bespoke rsvpDock/rsvpMomentumUnit identifiers",
  !/\brsvpDock\b/.test(consumerNoComments) &&
    !/\brsvpMomentumUnit\b/.test(consumerNoComments),
  "ConsumerEventDetailScreen.tsx must not retain the hand-mirrored rsvpDock / rsvpMomentumUnit nodes (comments excluded)",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-one-shared-body gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-one-shared-body gate: PASS");
