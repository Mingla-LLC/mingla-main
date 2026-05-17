#!/usr/bin/env node
// ORCH-0842 — I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH.
//
// `pdf-lib` may be imported ONLY from `supabase/functions/_shared/ticketPdf.ts`.
// All edge functions that render ticket PDFs MUST go through buildTicketPdf
// from that shared module. This gate fails if any other file under
// `supabase/functions/` imports pdf-lib directly.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FN_ROOT = path.join(ROOT, "supabase/functions");
const ALLOWED = path.join(FN_ROOT, "_shared/ticketPdf.ts");

if (!fs.existsSync(FN_ROOT)) {
  console.log(
    "I-PROPOSED-AL gate skipped: supabase/functions/ not present in this checkout.",
  );
  process.exit(0);
}

const PDF_LIB_RE = /from\s+["'][^"']*pdf-lib[^"']*["']/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const failures = [];
for (const file of walk(FN_ROOT)) {
  if (path.resolve(file) === path.resolve(ALLOWED)) continue;
  // Test files legitimately import pdf-lib to inspect the rendered PDF
  // (e.g., verifying page count, decoded text). They do not produce
  // user-facing PDFs.
  if (/__tests__\//.test(file)) continue;
  if (/\.test\.(ts|tsx|mts|js|mjs)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (PDF_LIB_RE.test(line)) {
      failures.push(
        `${path.relative(ROOT, file)}:${
          i + 1
        }: forbidden direct pdf-lib import. Use buildTicketPdf from supabase/functions/_shared/ticketPdf.ts (I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH).`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH gate failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  "I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH: pdf-lib imports are isolated to _shared/ticketPdf.ts.",
);
