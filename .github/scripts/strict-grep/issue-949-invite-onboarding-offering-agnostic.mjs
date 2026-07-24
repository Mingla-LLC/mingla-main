#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ALLOW =
  "// orch-strict-grep-allow invite-offering-agnostic —";

const SURFACES = [
  "supabase/functions/_shared/brandInviteEmail.ts",
  "mingla-business/app/accept-brand-invitation.tsx",
  "mingla-business/app/accept-brand-invitation/success.tsx",
  "mingla-business/src/components/invite/BusinessAppDownloadCta.tsx",
  "mingla-business/src/components/brand/BrandOnboardView.tsx",
  "mingla-business/src/components/brand/BrandPaymentsView.tsx",
  "mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx",
  "mingla-business/src/utils/brandStripeUiState.ts",
];

const BANNED = [
  { re: /sell(?:ing)? tickets/i, why: "use 'take payments' / 'get paid'" },
  { re: /ticket sales/i, why: "use 'payments' / 'sales'" },
  { re: /buy tickets/i, why: "use 'pay you' / 'pay for what you sell'" },
  { re: /get paid for your events/i, why: "use 'get paid for what you sell'" },
  { re: /publish events\b/i, why: "use 'publish your offerings'" },
  { re: /receive money from ticket/i, why: "use 'get paid'" },
  { re: /events open for tickets/i, why: "use 'offerings open for bookings'" },
  { re: /scan guests in/i, why: "use 'run the door'" },
  { re: /check guests in/i, why: "false app-exclusivity claim" },
  {
    re: /your page, events and photos/i,
    why: "use 'your page, offerings and photos'",
  },
  {
    re: /events,?\s*tickets and (?:a )?page/i,
    why: "use 'offerings and page'",
  },
];

function commentStrippedWithAllows(raw) {
  const lines = raw.split("\n");
  const allowedLines = new Set();
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].includes(ALLOW) && lines[index].slice(ALLOW.length).trim()) {
      allowedLines.add(index + 1);
    }
  }

  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  return stripped
    .split("\n")
    .map((line, index) => (allowedLines.has(index) ? "" : line))
    .join("\n");
}

function findingsFor(label, raw) {
  const source = commentStrippedWithAllows(raw);
  const findings = [];
  for (const banned of BANNED) {
    const match = banned.re.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(`${label}:${line}: ${JSON.stringify(match[0])} — ${banned.why}`);
  }
  return findings;
}

function selfTest() {
  const good =
    "take payments; your offerings open for bookings; run the door; get paid for what you sell";
  const bad = [
    "sell tickets",
    "ticket sales",
    "buy tickets",
    "get paid for your events",
    "publish events",
    "receive money from ticket inventory",
    "events open for tickets",
    "scan guests in",
    "check guests in",
    "your page, events and photos",
    "events, tickets and page",
  ];
  const cases = [
    ["compliant", good, 0],
    ...bad.map((fixture, index) => [`banned-${index + 1}`, fixture, 1]),
    ["block-comment", `/* sell tickets */\n${good}`, 0],
    ["line-comment", `// ticket sales\n${good}`, 0],
    [
      "allow-comment",
      `${ALLOW} genuine future exception\nsell tickets`,
      0,
    ],
  ];

  const failures = [];
  for (const [name, fixture, expected] of cases) {
    const actual = findingsFor(name, fixture).length;
    if (actual !== expected) {
      failures.push(`${name}: expected ${expected}, got ${actual}`);
    }
  }
  if (failures.length > 0) {
    console.error(`self-test FAIL\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`self-test PASS (${cases.length}/${cases.length} cases)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const findings = [];
  for (const surface of SURFACES) {
    let raw;
    try {
      raw = readFileSync(resolve(ROOT, surface), "utf8");
    } catch (error) {
      console.error(`HARD FAIL: required surface missing: ${surface}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }
    findings.push(...findingsFor(surface, raw));
  }

  if (findings.length > 0) {
    console.error(
      `I-PROPOSED-949-INVITE-ONBOARDING-OFFERING-AGNOSTIC FAIL\n${findings.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `I-PROPOSED-949-INVITE-ONBOARDING-OFFERING-AGNOSTIC PASS (${SURFACES.length} surfaces)`,
  );
}
