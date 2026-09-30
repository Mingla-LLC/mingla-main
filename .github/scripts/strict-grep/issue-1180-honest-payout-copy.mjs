#!/usr/bin/env node
/**
 * #1180 [payout-ui-copy] — I-PROPOSED-1180-HONEST-PAYOUT-COPY (ACTIVE via #3645).
 *
 * WHY: payouts mature about a day after each payment (#3645), then typically
 * take 1–2 business days to arrive. Surfaces must not claim instant / same-day /
 * next-business-day / weekly-clockwork payouts, must not revive the retired
 * "3 days after the event" hold, and must not claim Mingla absorbs NG transfer fees.
 *
 * `--self-test` proves PASS-on-honest-copy + FAIL-on-each-lie.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

const FILES = [
  "mingla-business/src/components/brand/BrandPaymentsView.tsx",
  "mingla-business/src/utils/brandStripeUiState.ts",
  "mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
  "mingla-business/src/components/onboarding/MinglaToSAcceptanceGate.tsx",
  "mingla-business/src/components/brand/BrandPayoutBreakdown.tsx",
  "mingla-business/src/components/brand/BrandPayoutTimelineExplainer.tsx",
  "mingla-business/src/utils/payoutBreakdown.ts",
  "mingla-marketing/components/sections/organiser-home/dining-dashboard-card.tsx",
  "mingla-marketing/components/sections/organiser-home/venue-activity-feed.tsx",
];

const BANNED = [
  {
    name: "next-business-day",
    re: /next business day/i,
    hint: 'Payouts mature ~24h after payment; never "next business day".',
  },
  {
    name: "instant-payout",
    re: /\binstant(?:ly)?\b/i,
    hint: "No instant-payout claim — funds mature about a day after each payment.",
  },
  {
    name: "same-day",
    re: /\bsame[-\s]?day\b/i,
    hint: "No same-day payout claim.",
  },
  {
    name: "weekly-clockwork",
    re: /(?:weekly payout|paid out (?:this|every|each) week|payouts? every week)/i,
    hint: "No weekly-clockwork payout claim — payouts release per payment, not on a weekly clock.",
  },
  {
    name: "event-plus-3-days",
    re: /3 days after (?:each |your |the |the corresponding )?(?:event|first event)/i,
    hint: "#3645: payouts mature ~24h after payment, not 3 days after the event.",
  },
  {
    name: "mingla-absorbs-transfer-fee",
    re: /mingla\s+absorb\w*[^.\n]{0,60}(?:transfer fees?|stamp duty|\bduty\b)/i,
    hint: "NG fee model B: the brand absorbs the transfer fee; never claim Mingla absorbs it.",
  },
  {
    name: "transfer-fee-absorbed-by-mingla",
    re: /(?:transfer fees?|stamp duty)[^.\n]{0,60}absorb\w*\s+by\s+mingla/i,
    hint: "NG fee model B: never claim the transfer fee / stamp duty is absorbed by Mingla.",
  },
];

/** Strip block comments + full-line `//` comments (leave inline URLs alone). */
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^[ \t]*\/\/.*$/gm, "");
  return s;
}

/** Populate `failures` with every banned-pattern hit in `src` (comments removed). */
function scan(label, src, failures) {
  const lines = stripComments(src).split("\n");
  lines.forEach((line, i) => {
    for (const b of BANNED) {
      if (b.re.test(line)) {
        failures.push(
          `${label}:${i + 1} [${b.name}] — ${b.hint}\n    > ${line.trim()}`,
        );
      }
    }
  });
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const expectClean = (label, src) => {
    const f = [];
    scan(label, src, f);
    if (f.length) self.push(`FALSE POSITIVE on ${label}: ${f.join(" | ")}`);
  };
  const expectHit = (label, src, pattern) => {
    const f = [];
    scan(label, src, f);
    if (!f.some((m) => m.includes(`[${pattern}]`))) {
      self.push(`MISSED ${pattern} in ${label}`);
    }
  };

  expectClean(
    "honest.tsx",
    `const a = "Payouts settle to X, released about a day after each payment and typically arrive within 1–2 business days.";\n` +
      `const b = "Ticket sales are released to this account about a day after each payment.";\n` +
      `const c = "Within 1–2 business days, it reaches your bank.";`,
  );
  expectClean(
    "tos-clause3.tsx",
    `"3. Refunds and chargebacks for tickets sold via Mingla are absorbed by Mingla. We may pause your payouts if dispute volume exceeds risk thresholds.",`,
  );
  expectClean(
    "ng-note.tsx",
    `"In Nigeria, bank transfer fees and stamp duty are deducted from your payout.",`,
  );

  expectHit("lie1.tsx", `"Payouts settle to your bank, usually the next business day.";`, "next-business-day");
  expectHit("lie2.tsx", `"Get paid instantly with instant payouts.";`, "instant-payout");
  expectHit("lie3.tsx", `"Same-day payout to your account.";`, "same-day");
  expectHit("lie4.tsx", `"Paid out this week, straight to you.";`, "weekly-clockwork");
  expectHit("lie5.tsx", `"The transfer fee is absorbed by Mingla.";`, "transfer-fee-absorbed-by-mingla");
  expectHit("lie6.tsx", `"Mingla absorbs the ₦50 stamp duty for you.";`, "mingla-absorbs-transfer-fee");
  expectHit("lie7.tsx", `"released 3 days after each event date ends";`, "event-plus-3-days");

  if (self.length) {
    console.error("#1180 honest-payout-copy self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("#1180 honest-payout-copy self-test PASS (10/10 cases).");
  process.exit(0);
}

const failures = [];
for (const rel of FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(
      `#1180 I-PROPOSED-1180-HONEST-PAYOUT-COPY script error: target not found at ${rel}. ` +
        `If the file was renamed, update FILES in this gate.`,
    );
    process.exit(2);
  }
  scan(rel, fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "#1180 I-PROPOSED-1180-HONEST-PAYOUT-COPY FAIL — dishonest payout copy found:\n  " +
      failures.join("\n  ") +
      "\n\nSee docs/INVARIANT_REGISTRY.md I-PROPOSED-1180-HONEST-PAYOUT-COPY.",
  );
  process.exit(1);
}

console.log(
  `#1180 I-PROPOSED-1180-HONEST-PAYOUT-COPY PASS — ${FILES.length} payout surfaces carry honest hold-timing + fee copy.`,
);
