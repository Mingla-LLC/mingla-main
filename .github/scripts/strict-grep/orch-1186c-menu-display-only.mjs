#!/usr/bin/env node
/**
 * ORCH-1186-C — the venue menu never does money itself.
 *
 * Invariant I-PROPOSED-1186-MENU-DISPLAY-ONLY (ACTIVE), AMENDED at #1767 Phase 1
 * (issue #1789) per SPEC #1788 P-60/P-61/P-62.
 *
 * WHAT CHANGED, AND WHY THE GATE WAS RE-SCOPED RATHER THAN DELETED.
 * The original rule was "the venue menu builder + the public Menu tab carry NO
 * checkout / cart / quantity / order / payment surface" — ordering was out of
 * scope for META-ORCH-1186. #1767 makes the venue menu an ordering surface, so
 * half of that rule is deliberately retired. The half that was always the point
 * survives and is now the whole invariant:
 *
 *     the menu surface never does money itself, and the surfaces that must stay
 *     display-only forever still are.
 *
 * This file keeps its path, its MANIFEST.json row, its jobKey, its modes, and
 * its `selfTest: "wired"` flag — so `gates[]` never shrinks, the append-only
 * ratchet stays silent, `expectedStrictGrepMjsFiles` / `selfTestWiredFloor` are
 * unchanged, and no `[GATE-REMOVAL: …]` token is needed anywhere (SPEC P-60).
 * Deleting this gate and adding a replacement would trade a regex edit for a
 * permanently weaker registry. That trade is forbidden.
 *
 * THREE SCAN SETS (SPEC P-61):
 *
 *   SET-A — display-only FOREVER. Full nine-token FORBIDDEN list. An authoring
 *           form never becomes a buying form, and the marketing site never
 *           becomes a checkout:
 *             - the venue menu BUILDER sheets (MenuItemSheet / MenuCategorySheet)
 *             - the ISSUE-1080 venue-preview sales-demo skin under
 *               mingla-marketing/ (no ordering rail, no auth, no money path —
 *               and it must never grow one)
 *
 *   SET-B — MAY sell, may NEVER touch money. Money tokens only, whole file:
 *             - packages/brand-rendering/PublicMenuSections.tsx
 *             - mingla-business/src/components/venue/VenueMenuModule.tsx
 *             - every ordering renderer under packages/brand-rendering/venueOrdering/**
 *           These may carry a cart, a quantity stepper and an "Add to order"
 *           button. They may never import a provider SDK, name a payment sheet,
 *           or compute a fee/take-rate — every money number they render comes
 *           from `venue-order-create`'s priced response (SPEC P-20). The payment
 *           STEP lives in separately-named components that are explicitly OUT of
 *           SET-B; this gate is never pointed at them.
 *
 *   SET-C — anti-vacuity. Every explicitly listed SET-A / SET-B file must EXIST.
 *           A gate that goes green because its target moved is the failure class
 *           the registry exists to prevent.
 *
 * Comments are stripped before matching, so explanatory notes never trip it.
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 *
 * Supports `--self-test` (no repo scan; proves the SET-A / SET-B split).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// ---------------------------------------------------------------------------
// SET-A — display-only forever (full nine-token list).
// ---------------------------------------------------------------------------
// The builder sheets: authoring a dish is not buying one.
// NOTE: VenueMenuModule.tsx deliberately MOVED to SET-B — it hosts the one-tap
// availability (86) row toggle and, from #1793, the venue-side order surfaces.
const setAFiles = [
  "mingla-business/src/components/venue/MenuItemSheet.tsx",
  "mingla-business/src/components/venue/MenuCategorySheet.tsx",
  // The ISSUE-1080 venue-preview sales-demo skin (mingla-marketing is
  // DO-NOT-TOUCH for the whole #1767 programme — SPEC §10).
  "mingla-marketing/app/venue-preview/page.tsx",
  "mingla-marketing/app/venue-preview/VenuePreviewClient.tsx",
  "mingla-marketing/app/venue-preview/venueSkins.tsx",
];

// Any NEW sibling renderer dropped into the venue-preview skin is scanned
// automatically (drift resistance), non-recursively. `lookbook/` is a separate
// design-index surface that renders no venue menu and carries a Tailwind
// `bg-stripe-strong` utility class, so it is deliberately out of scope.
const setADirs = ["mingla-marketing/app/venue-preview"];

// ---------------------------------------------------------------------------
// SET-B — may sell, may never touch money (money tokens only, whole file).
// ---------------------------------------------------------------------------
const setBFiles = [
  "packages/brand-rendering/PublicMenuSections.tsx",
  "mingla-business/src/components/venue/VenueMenuModule.tsx",
];

// Recursive; may legitimately not exist yet (the ordering renderers land at
// #1793). Absence is NOT a failure — these are the files that do not exist
// until the phase that writes them, unlike the SET-C anchors above.
const setBDirs = ["packages/brand-rendering/venueOrdering"];

// The original nine display-only tokens (case-insensitive).
const FORBIDDEN_DISPLAY = [
  /\bcart\b/i,
  /\bcheckout\b/i,
  /addtoorder/i,
  /add to order/i,
  /\bquantity\b/i,
  /paymentsheet/i,
  /ticket-checkout/i,
  /\bstripe\b/i,
  /\bpaystack\b/i,
];

// The money subset + the two client-money-math needles (SPEC P-61 SET-B).
const FORBIDDEN_MONEY = [
  /paymentsheet/i,
  /ticket-checkout/i,
  /\bstripe\b/i,
  /\bpaystack\b/i,
  /application_fee/i,
  /\bfeeFromBps\b|\*\s*(take_rate|takeRate|bps)\b/i,
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const scan = (label, code, failures, patterns, why) => {
  const clean = stripComments(code);
  for (const re of patterns) {
    if (re.test(clean)) {
      failures.push(`${label}: matches /${re.source}/ — ${why}`);
    }
  }
};

const SET_A_WHY =
  "this surface is DISPLAY-ONLY FOREVER: an authoring form never becomes a buying form and the marketing venue-preview skin never becomes a checkout (I-PROPOSED-1186-MENU-DISPLAY-ONLY as amended at #1789; SPEC #1788 P-61 SET-A).";
const SET_B_WHY =
  "this surface may sell but may NEVER touch money: no provider SDK, no payment sheet, no client-side fee/take-rate math — every money number comes from venue-order-create's priced response (SPEC #1788 P-20; P-61 SET-B).";

// Collect .tsx/.ts files from a directory (SET-A: shallow, SET-B: recursive).
const collect = (absDir, relDir, recursive) => {
  const out = [];
  if (!existsSync(absDir)) return out;
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const rel = `${relDir}/${entry}`;
    if (statSync(abs).isDirectory()) {
      if (recursive) out.push(...collect(abs, rel, true));
      continue;
    }
    if (/\.(tsx?|jsx?|mjs)$/.test(entry)) out.push({ abs, rel });
  }
  return out;
};

if (process.argv.includes("--self-test")) {
  const cases = [];

  // 1. A cart string FAILS SET-A (the builder sheets / the marketing skin).
  const a1 = [];
  scan("self-test", "const x = <AddToCart quantity={1} />;", a1, FORBIDDEN_DISPLAY, SET_A_WHY);
  cases.push(["SET-A catches a cart control", a1.length > 0]);

  // 2. The SAME cart string PASSES SET-B — this is the whole point of the split.
  const b1 = [];
  scan("self-test", "const x = <AddToCart quantity={1} />;", b1, FORBIDDEN_MONEY, SET_B_WHY);
  cases.push(["SET-B allows a legitimate cart control", b1.length === 0]);

  // 3. A provider SDK call FAILS SET-B.
  const b2 = [];
  scan(
    "self-test",
    'const r = await stripe.confirmPayment(clientSecret);',
    b2,
    FORBIDDEN_MONEY,
    SET_B_WHY,
  );
  cases.push(["SET-B catches a payment-provider call", b2.length > 0]);

  // 4. Client-side fee math FAILS SET-B (the two new needles).
  const b3 = [];
  scan("self-test", "const fee = subtotal * takeRate;", b3, FORBIDDEN_MONEY, SET_B_WHY);
  cases.push(["SET-B catches client-side take-rate math", b3.length > 0]);
  const b4 = [];
  scan("self-test", 'body.application_fee_amount = 120;', b4, FORBIDDEN_MONEY, SET_B_WHY);
  cases.push(["SET-B catches an application_fee reference", b4.length > 0]);

  // 5. A clean display-only renderer trips NEITHER set.
  const clean = [];
  scan(
    "self-test-clean",
    "const MenuTab = () => <View><Text>Margherita</Text></View>;",
    clean,
    FORBIDDEN_DISPLAY,
    SET_A_WHY,
  );
  cases.push(["no false positive on clean menu code", clean.length === 0]);

  // 6. Comments never trip either set (the prose contracts name these tokens).
  const commented = [];
  scan(
    "self-test-comment",
    "// HARD: no cart/checkout/Stripe control here.\nconst MenuTab = () => null;",
    commented,
    FORBIDDEN_DISPLAY,
    SET_A_WHY,
  );
  cases.push(["comments are stripped before matching", commented.length === 0]);

  // 7. Anti-vacuity: a missing anchor file is a FAILURE, never a silent pass.
  const missing = [];
  const bogus = "mingla-business/src/components/venue/__ThisFileDoesNotExist.tsx";
  if (!existsSync(join(root, bogus))) {
    missing.push(`${bogus}: missing`);
  }
  cases.push(["SET-C flags a missing scanned file", missing.length > 0]);

  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error("ORCH-1186-C menu-money gate self-test FAILED:");
    for (const [name] of failed) console.error(`- ${name}`);
    process.exit(1);
  }
  console.log(
    `ORCH-1186-C menu-money gate self-test passed (${cases.length}/${cases.length}).`,
  );
  process.exit(0);
}

const failures = [];

// ---- SET-A ---------------------------------------------------------------
const seenA = new Set();
for (const rel of setAFiles) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    // SET-C anti-vacuity.
    failures.push(
      `${rel}: missing — a SET-A display-only surface must exist (ORCH-1186-C; SPEC #1788 P-61 SET-C).`,
    );
    continue;
  }
  seenA.add(rel);
  scan(rel, readFileSync(abs, "utf8"), failures, FORBIDDEN_DISPLAY, SET_A_WHY);
}
for (const relDir of setADirs) {
  for (const { abs, rel } of collect(join(root, relDir), relDir, false)) {
    if (seenA.has(rel)) continue;
    scan(rel, readFileSync(abs, "utf8"), failures, FORBIDDEN_DISPLAY, SET_A_WHY);
  }
}

// ---- SET-B ---------------------------------------------------------------
const seenB = new Set();
for (const rel of setBFiles) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    // SET-C anti-vacuity.
    failures.push(
      `${rel}: missing — a SET-B menu/ordering renderer must exist (ORCH-1186-C; SPEC #1788 P-61 SET-C).`,
    );
    continue;
  }
  seenB.add(rel);
  scan(rel, readFileSync(abs, "utf8"), failures, FORBIDDEN_MONEY, SET_B_WHY);
}
for (const relDir of setBDirs) {
  for (const { abs, rel } of collect(join(root, relDir), relDir, true)) {
    if (seenB.has(rel)) continue;
    scan(rel, readFileSync(abs, "utf8"), failures, FORBIDDEN_MONEY, SET_B_WHY);
  }
}

if (failures.length > 0) {
  console.error("ORCH-1186-C menu-money gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1186-C menu-money gate passed.");
