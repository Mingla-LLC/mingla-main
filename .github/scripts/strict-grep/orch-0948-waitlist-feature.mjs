#!/usr/bin/env node
/**
 * ORCH-0948 strict-grep gate — I-WAITLIST-CONFIRM-EXCLUSION.
 *
 * ORCH-0948 must not touch buyer confirmation files owned by
 * META-ORCH-0952. The gate scans the PR diff against origin/main and fails
 * if confirm routes or TicketQrCarousel appear.
 */

import { execSync } from "node:child_process";

const FORBIDDEN = [
  "mingla-business/app/checkout/[eventId]/confirm/",
  "mingla-business/app/checkout-trip/[tripEventId]/confirm/",
  "TicketQrCarousel.tsx",
];

function changedFiles() {
  try {
    return execSync("git diff --name-only origin/main...HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return execSync("git diff --name-only HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

const offenders = changedFiles().filter((file) =>
  FORBIDDEN.some((pattern) =>
    pattern.endsWith(".tsx") ? file.endsWith(pattern) : file.startsWith(pattern)
  )
);

if (offenders.length > 0) {
  console.error("ORCH-0948 waitlist strict-grep FAILED:");
  console.error(
    "I-WAITLIST-CONFIRM-EXCLUSION forbids touching confirm routes or TicketQrCarousel:",
  );
  for (const offender of offenders) {
    console.error(`  - ${offender}`);
  }
  process.exit(1);
}

console.log(
  "ORCH-0948 waitlist strict-grep PASS — confirm exclusion preserved.",
);
