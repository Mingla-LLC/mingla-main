#!/usr/bin/env node
// MINGLA-INVARIANT: I-4063-LOCAL-TIME | issue #4063 | Buyer messages never format a date in the edge runtime's ambient timezone.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BUYER_MESSAGE_FILES = [
  "supabase/functions/_shared/messageTime.ts",
  "supabase/functions/_shared/notifyTemplates.ts",
  "supabase/functions/_shared/orderConfirmationMessage.ts",
  "supabase/functions/_shared/rsvpPassMessage.ts",
  "supabase/functions/_shared/waitlistSpotMessage.ts",
  "supabase/functions/attendance-claim-backfill/index.ts",
  "supabase/functions/rsvp-notify/index.ts",
  "supabase/functions/send-installment-reminder/index.ts",
  "supabase/functions/ticket-confirmation-dispatch/index.ts",
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function calls(source) {
  const found = [];
  const startPattern =
    /(?:\.toLocale(?:Date|Time)?String|Intl\.DateTimeFormat)\s*\(/g;
  for (const match of source.matchAll(startPattern)) {
    const open = source.indexOf("(", match.index);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let end = -1;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    found.push({
      index: match.index,
      text: end === -1
        ? source.slice(match.index)
        : source.slice(match.index, end),
    });
  }
  return found;
}

function readTree(overrides = new Map()) {
  const read = (relative) => {
    if (overrides.has(relative)) return overrides.get(relative);
    const absolute = path.join(ROOT, relative);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  };
  return { read };
}

export function check({ read }) {
  const violations = [];
  for (const relative of BUYER_MESSAGE_FILES) {
    const raw = read(relative);
    if (raw === null) {
      violations.push(`${relative}: missing buyer message file`);
      continue;
    }
    const source = stripComments(raw);
    for (const call of calls(source)) {
      const hasNamedTimezone = /\btimeZone\s*:/.test(call.text) ||
        /(?:\{|,)\s*timeZone\s*(?:,|})/.test(call.text);
      if (!hasNamedTimezone) {
        const line = source.slice(0, call.index).split("\n").length;
        violations.push(
          `${relative}:${line}: date formatter has no explicit timeZone`,
        );
      }
    }
  }
  return violations;
}

function runSelfTest() {
  const realTree = readTree();
  const control = check(realTree);
  if (control.length > 0) {
    throw new Error(`real-tree control failed: ${control.join("; ")}`);
  }
  const fixture = BUYER_MESSAGE_FILES[2];
  const source = realTree.read(fixture);
  const rejected = [
    `\nnew Date().toLocaleString("en-US");`,
    `\nnew Date().toLocaleDateString("en-US", { month: "short" });`,
    `\nnew Date().toLocaleTimeString("en-US", { hour: "numeric" });`,
    `\nnew Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date());`,
    `\nnew Intl.DateTimeFormat("en-US", { tz: timeZone }).format(new Date());`,
  ];
  for (const mutation of rejected) {
    const violations = check(
      readTree(new Map([[fixture, `${source}${mutation}`]])),
    );
    if (violations.length === 0) {
      throw new Error(`timezone mutation was not detected: ${mutation}`);
    }
  }
  const accepted = [
    `\nnew Date().toLocaleString("en-US", { timeZone: "UTC" });`,
    `\nnew Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(new Date());`,
    `\nnew Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());`,
  ];
  for (const mutation of accepted) {
    const violations = check(
      readTree(new Map([[fixture, `${source}${mutation}`]])),
    );
    if (violations.length > 0) {
      throw new Error(
        `explicit timezone was rejected: ${violations.join("; ")}`,
      );
    }
  }
  console.log(
    `#4063 local-time self-test PASS (${rejected.length} rejecting + ${accepted.length} accepting mutations)`,
  );
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const violations = check(readTree());
  if (violations.length > 0) {
    console.error("#4063 local-time invariant failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log(
    `#4063 local-time PASS (${BUYER_MESSAGE_FILES.length} buyer message files)`,
  );
}
