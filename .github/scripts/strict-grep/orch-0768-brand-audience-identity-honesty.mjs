#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relPath) => {
  const absPath = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (error) {
    console.error(`ORCH-0768 ERROR: could not read ${relPath}: ${error.message}`);
    process.exit(2);
  }
};

const checks = [
  {
    relPath: "mingla-business/app/(tabs)/home.tsx",
    signatures: [
      'label="Followers"',
      "currentBrand.stats.followers",
    ],
  },
  {
    relPath: "mingla-business/app/(tabs)/account.tsx",
    signatures: [
      "brand.stats.followers",
      "brand.stats.rev",
      "brand.stats.attendees",
      "followers",
    ],
  },
  {
    relPath: "mingla-business/src/components/brand/BrandSwitcherSheet.tsx",
    signatures: [
      "brand.stats.events",
      "brand.stats.followers",
      "followers",
    ],
  },
  {
    relPath: "mingla-business/src/components/brand/PublicBrandPage.tsx",
    signatures: [
      "`@${brand.slug}`",
      "@${brand.slug}",
      "`@${",
      "brand.stats.followers",
      "brand.stats.attendees",
      "brand.stats.events",
    ],
  },
];

const violations = [];

const requiredIncludes = [
  {
    relPath: "mingla-business/app/(tabs)/account.tsx",
    signature: "Your brands",
    message: "Account must keep the Your brands list.",
  },
  {
    relPath: "mingla-business/app/(tabs)/account.tsx",
    signature: "formatBrandEventCount(brand.stats.events)",
    message: "Account Your brands list must show only the accurate server-derived event count.",
  },
  {
    relPath: "mingla-business/src/services/brandsService.ts",
    signature: '.from("events")',
    message: "Brand list event counts must be derived from the events table.",
  },
];

for (const required of requiredIncludes) {
  const source = read(required.relPath);
  if (!source.includes(required.signature)) {
    violations.push({
      relPath: required.relPath,
      line: 0,
      signature: required.signature,
      text: `missing required signature: ${required.message}`,
    });
  }
}

for (const check of checks) {
  const source = read(check.relPath);
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const signature of check.signatures) {
      if (line.includes(signature)) {
        violations.push({
          relPath: check.relPath,
          line: index + 1,
          signature,
          text: line.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    "ORCH-0768 violation: brand audience and slug-as-handle UI must stay honest.",
  );
  console.error(
    "Fix: do not render Home followers, fake Account metrics, switcher counts, or public @slug identity. Account may show server-derived event counts only.",
  );
  for (const violation of violations) {
    const lineLabel = violation.line > 0 ? violation.line : "required";
    console.error(
      `${violation.relPath}:${lineLabel}: ${violation.signature} :: ${violation.text}`,
    );
  }
  process.exit(1);
}

console.log(
  `ORCH-0768 PASS: brand audience and public identity honesty guard passed (${checks.length} files).`,
);
