#!/usr/bin/env node
/**
 * I-1047-BIZ-RSVP-PREVIEW-NO-TICKET-RENDERER  (issue #1047)
 *
 * Re-homes I-PROPOSED-1150-RSVP-PREVIEW-NO-TICKET-RENDERER, previously pinned by
 * `mingla-business/app/rsvp/[id]/__tests__/preview.test.tsx` (ORCH-1150-R2 D-5).
 * That pin rotted on a draft-migration-helper rename and is now quarantined; this
 * additive gate keeps the module-boundary rule enforced.
 *
 * THE RULE: the RSVP in-app preview route must render the ticketless RSVP renderer
 * and must NEVER import or mount the ticket-assuming event renderers, nor call the
 * live submit path:
 *   - the route file exists + default-exports RsvpPreviewRoute (fails-on-delete —
 *     a missing route falls through to +not-found.tsx: the white-screen bug), AND
 *   - it never IMPORTS or MOUNTS PreviewEventView / FoundationEventPreview, AND
 *   - it never references resolveOfferingCta (ticket-CTA resolver), AND
 *   - the Going/Not-going submit is a preview no-op: never imports or CALLS
 *     submitPublicRsvp.
 * (The route's doc comment intentionally NAMES these to document the rule, so the
 *  gate strips comments before asserting — code only.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROUTE = "mingla-business/app/rsvp/[id]/preview.tsx";

let raw;
try {
  raw = fs.readFileSync(path.join(REPO, ROUTE), "utf8");
} catch {
  console.error(
    `\nFAIL [I-1047-BIZ-RSVP-PREVIEW-NO-TICKET-RENDERER]: ${ROUTE} is MISSING — the RSVP preview ` +
      "route file was deleted; expo-router falls through to +not-found.tsx (the white-screen bug this rule guards).\n",
  );
  process.exit(1);
}
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];
if (!/export\s+default\s+function\s+RsvpPreviewRoute/.test(code)) {
  violations.push("the route no longer default-exports `RsvpPreviewRoute` (route resolution / fails-on-delete anchor).");
}
for (const name of ["PreviewEventView", "FoundationEventPreview"]) {
  if (new RegExp(`import\\s+[^;]*\\b${name}\\b`).test(code) || code.includes(`<${name}`)) {
    violations.push(`RSVP preview imports or mounts the ticket-assuming renderer \`${name}\` — forbidden (ticketless boundary).`);
  }
}
if (/\bresolveOfferingCta\b/.test(code)) {
  violations.push("RSVP preview references `resolveOfferingCta` (the ticket-CTA resolver) — forbidden on the ticketless preview.");
}
if (/import\s+[^;]*\bsubmitPublicRsvp\b/.test(code) || /\bsubmitPublicRsvp\s*\(/.test(code)) {
  violations.push("RSVP preview imports or CALLS `submitPublicRsvp` — the preview submit must be a no-op, never the live edge fn.");
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-RSVP-PREVIEW-NO-TICKET-RENDERER]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-RSVP-PREVIEW-NO-TICKET-RENDERER]: ticketless renderer, no ticket-CTA, submit is a no-op.");
