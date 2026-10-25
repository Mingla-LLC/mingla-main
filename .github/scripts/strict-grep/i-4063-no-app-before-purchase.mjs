#!/usr/bin/env node
// MINGLA-INVARIANT: I-4063-NO-APP-BEFORE-PURCHASE | issue #4063 | Buyer-facing pre-purchase surfaces describe the purchase promise without promoting the app.
/**
 * #4063 — pre-purchase copy stays focused on the purchase.
 *
 * The existing See who's going social-proof box is the only temporary
 * exception. STOP-SEEWHO is pending Seth's product decision, so the exception
 * is legal only while prePurchaseAppBox.ts exports the explicit `true` branch.
 * Flipping that branch to `false` intentionally makes this gate require the
 * app-promotional copy to be removed from SeeWhosGoingGate.tsx too.
 *
 * This gate also proves every public event/trip/experience render is routed
 * through that one branch point. `--self-test` mutates each contract edge so a
 * green result cannot mean the scanner matched nothing.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FLAG = "mingla-business/src/components/event/prePurchaseAppBox.ts";
const SEE_WHO = "mingla-business/src/components/event/SeeWhosGoingGate.tsx";

const PRE_PURCHASE_FILES = [
  "packages/offering-rendering/EventOfferingBody.tsx",
  "packages/offering-rendering/TripOfferingBody.tsx",
  "packages/offering-rendering/ExperienceOfferingBody.tsx",
  "packages/offering-rendering/RsvpOfferingBody.tsx",
  "packages/offering-rendering/RsvpDetailsModal.tsx",
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
  "mingla-business/src/components/venue/GuestVenueReservation.tsx",
  "mingla-business/src/components/ticketLinks/TicketLinkLanding.tsx",
];

const RENDERERS = [
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
];

const FORBIDDEN = ["Mingla app", "Open in Mingla", "Get the app"];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
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
  const flagRaw = read(FLAG);
  if (flagRaw === null) return [`${FLAG}: missing branch-point owner`];
  const flag = stripComments(flagRaw);
  const flagMatch = /export\s+const\s+SHOW_PRE_PURCHASE_APP_BOX\s*=\s*(true|false)\s*;/.exec(flag);
  if (flagMatch === null) {
    violations.push(`${FLAG}: SHOW_PRE_PURCHASE_APP_BOX must be an explicit true or false literal`);
  }
  const allowSeeWho = flagMatch?.[1] === "true";

  const scanFiles = allowSeeWho ? PRE_PURCHASE_FILES : [...PRE_PURCHASE_FILES, SEE_WHO];
  for (const relative of scanFiles) {
    const raw = read(relative);
    if (raw === null) {
      violations.push(`${relative}: missing pre-purchase surface`);
      continue;
    }
    const source = stripComments(raw);
    for (const phrase of FORBIDDEN) {
      if (source.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())) {
        violations.push(`${relative}: contains forbidden pre-purchase app copy "${phrase}"`);
      }
    }
  }

  for (const relative of RENDERERS) {
    const raw = read(relative);
    if (raw === null) {
      violations.push(`${relative}: missing See who's going renderer`);
      continue;
    }
    const source = stripComments(raw);
    if (!/import\s*\{\s*SHOW_PRE_PURCHASE_APP_BOX\s*\}\s*from\s*["'][^"']*prePurchaseAppBox["']\s*;/.test(source)) {
      violations.push(`${relative}: does not import the pre-purchase app-box branch point`);
    }
    if (!/SHOW_PRE_PURCHASE_APP_BOX\s*&&[\s\S]{0,240}<SeeWhosGoingGate\b/.test(source)) {
      violations.push(`${relative}: SeeWhosGoingGate is not guarded by SHOW_PRE_PURCHASE_APP_BOX`);
    }
  }

  return violations;
}

function runSelfTest() {
  const realTree = readTree();
  const control = check(realTree);
  if (control.length > 0) throw new Error(`real-tree control failed: ${control.join("; ")}`);

  const load = (relative) => realTree.read(relative);
  const cases = [
    [
      "app promise leaks into checkout",
      new Map([[PRE_PURCHASE_FILES[6], `${load(PRE_PURCHASE_FILES[6])}\nconst leak = "Get the app";`]]),
    ],
    [
      "branch point removed from event",
      new Map([[RENDERERS[0], load(RENDERERS[0]).replaceAll("SHOW_PRE_PURCHASE_APP_BOX && acquisitionState.kind", "acquisitionState.kind")]]),
    ],
    [
      "branch point import removed from trip",
      new Map([[RENDERERS[1], load(RENDERERS[1]).replace(/import\s*\{\s*SHOW_PRE_PURCHASE_APP_BOX\s*\}[^;]+;\s*/, "")]]),
    ],
    [
      "disabled exception exposes See who's going copy",
      new Map([[FLAG, load(FLAG).replace("= true", "= false")]]),
    ],
    [
      "non-literal branch point is rejected",
      new Map([[FLAG, load(FLAG).replace("= true", "= Boolean(1)")]]),
    ],
  ];

  for (const [label, overrides] of cases) {
    const violations = check(readTree(overrides));
    if (violations.length === 0) throw new Error(`${label}: mutation was not detected`);
  }
  console.log(`#4063 no-app-before-purchase self-test PASS (${cases.length} mutations)`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const violations = check(readTree());
  if (violations.length > 0) {
    console.error("#4063 no-app-before-purchase invariant failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log("#4063 no-app-before-purchase PASS (copy + single branch point)");
}
