#!/usr/bin/env node
// ORCH-0785-C — Buyer-string escape gate (heuristic).
//
// Scans supabase/functions/_shared/email/** and supabase/functions/**/*.ts
// for template-literal interpolations of identifiers matching
//   ^(order|event|brand|recipient|attendee|cta|paragraph|line|ticket)
// inside an HTML-context template literal (one containing `<` or assigned to
// a variable named html/Html). Each such interpolation must flow through
// escapeHtml(...).
//
// This is intentionally a heuristic: false positives can be silenced by
// either wrapping in escapeHtml(...) or refactoring to a local variable.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = [path.join(ROOT, "supabase", "functions")];
const PREFIX = /^(order|event|brand|recipient|attendee|cta|paragraph|line|ticket)/i;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip __tests__
      if (entry.name === "__tests__") continue;
      out.push(...walk(full));
    } else if (entry.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const failures = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, "utf8");
    // Pull every template literal in the file.
    const tpls = text.match(/`[^`]*\$\{[^`]*`/gs) ?? [];
    for (const tpl of tpls) {
      // Only consider HTML-context literals.
      const looksLikeHtml = tpl.includes("<") || tpl.includes("&lt;") ||
        tpl.includes(">") || tpl.includes("style=") || tpl.includes("href=");
      if (!looksLikeHtml) continue;
      const interpolations = tpl.match(/\$\{([^}]+)\}/g) ?? [];
      for (const interp of interpolations) {
        const inner = interp.slice(2, -1).trim();
        // Already wrapped in escapeHtml? Allow.
        if (/escapeHtml\s*\(/.test(inner)) continue;
        // Common safe helpers — currency, dateLine, SHELL_TOKENS, etc — allow.
        if (/^(SHELL_TOKENS|BRAND_|MINGLA_|formatMoney|formatEventDateLine|formatSenderHeader|encodeURIComponent|String\b)/
          .test(inner)) continue;
        // Identifiers explicitly named *Html / *HTML are already-escaped HTML
        // fragments built by sibling renderers; safe to interpolate raw.
        if (/(Html|HTML)$/.test(inner.split(".").pop() ?? "")) continue;
        if (/^render[A-Z]/.test(inner)) continue; // renderHero(...), renderLineItems(...)
        // First identifier token in the expression.
        const tokenMatch = inner.match(/[A-Za-z_$][A-Za-z0-9_$.]*/);
        if (!tokenMatch) continue;
        const token = tokenMatch[0];
        const head = token.split(".")[0];
        if (!PREFIX.test(head)) continue;
        // Final allowlist: literal/dotted property access on input variants
        // that are NOT strings (e.g., numbers go through escapeHtml stringify
        // anyway, but we'd rather force the wrap).
        failures.push(
          `${path.relative(ROOT, file)}: interpolation \`${interp}\` in HTML template not wrapped in escapeHtml()`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("ORCH-0785-C buyer-string-escape gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-0785-C buyer-string-escape gate passed.");
