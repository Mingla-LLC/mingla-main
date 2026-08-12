#!/usr/bin/env node
/**
 * Issue #1793 (#1767 Phase 4) — the STRUCTURAL half of guest ordering.
 *
 * WHY A GATE AND NOT A JEST TEST. Every rule below is a property of the SHAPE of
 * the code — which module imports which, in what order two statements run, which
 * specifier a dynamic import names. Asserting those from jest means
 * `readFileSync` + `expect(src).toContain(...)`, which is exactly the pure
 * source-text pin `I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN` forbids as a
 * regression proof, and CI says so. The behaviour half — the wire payload, the
 * failure copy, the provider arms — is executed for real in
 * `mingla-business/src/components/venueOrdering/__tests__/buyerVenueOrdering.issue1793.test.ts`.
 * This file carries only what a running test structurally cannot.
 *
 * FIVE RULES:
 *
 *   R1 ANON. A diner has no account. No file on the guest ordering rail — either
 *      app's hook, slots, service, the order page, or the public-menu hook — may
 *      call an auth hook, import AuthContext, or read `isAuthReady`. The venue
 *      page is on the public buyer-route allowlist and its ordering surface must
 *      not quietly re-introduce a gate underneath it.
 *
 *   R2 THE SITTING SURVIVES THE REDIRECT. On buyer web `persistSitting(` must
 *      appear BEFORE `window.location.assign(` in the submit path. A hosted
 *      checkout takes the guest off the page and the browser may never return to
 *      it; persisting after the redirect is persisting never, and the sitting is
 *      what stops a table being asked to tip twice (OQ-2).
 *
 *   R3 SAME TAB. Buyer web redirects with `window.location.assign`, the house
 *      pattern for every other buyer-web payment surface. `Linking.openURL` on
 *      web resolves to `window.open(url, "_blank", "noopener")` — a popup, after
 *      an await, which is the exact shape a popup blocker eats.
 *
 *   R4 ONE DYNAMIC-IMPORT SPECIFIER. The venue page and the order page must
 *      reach the ordering surface through the SAME `import()` specifier. Two
 *      specifiers is two async chunks, and a module two async chunks share is a
 *      module Metro hoists into `__common` — the payload every visitor downloads
 *      before anything renders. Measured at #1793: +31 KB against a 12 KB
 *      per-PR allowance (ORCH-1083).
 *
 *   R5 NO CLIENT MONEY MATH. No host file may perform arithmetic on a field of
 *      the server's priced response (`preview.*Cents` / `totals.*Cents` followed
 *      by an operator). Every money number a guest reads is computed by
 *      `venue-order-create` (SPEC #1788 P-20); a surface that subtracts two of
 *      them to draw a third has started pricing.
 *
 * Comments are stripped before matching, so the prose above never trips it.
 * Supports `--self-test` (no repo scan; GOOD and BAD fixtures for every rule).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// ---------------------------------------------------------------------------
// The scanned surface. Every file must EXIST: a gate that goes green because its
// target moved is the failure class the registry exists to prevent.
// ---------------------------------------------------------------------------
const ANON_FILES = [
  "mingla-business/src/components/venueOrdering/useBuyerVenueOrdering.ts",
  "mingla-business/src/components/venueOrdering/BuyerVenueOrderingSlots.tsx",
  "mingla-business/src/services/venueOrderingService.ts",
  "mingla-business/src/hooks/usePublicMenuBundle.ts",
  "mingla-business/app/o/venue/[orderId].tsx",
  "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  "app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx",
  "app-mobile/src/services/venueOrderingService.ts",
];
const BUYER_HOOK =
  "mingla-business/src/components/venueOrdering/useBuyerVenueOrdering.ts";
const BUYER_VENUE_ROUTE = "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx";
const BUYER_ORDER_ROUTE = "mingla-business/app/o/venue/[orderId].tsx";
const ORDERING_SPECIFIER = "src/components/venueOrdering/BuyerVenueOrderingSlots";
const MONEY_MATH_FILES = [
  BUYER_HOOK,
  "mingla-business/src/components/venueOrdering/BuyerVenueOrderingSlots.tsx",
  BUYER_ORDER_ROUTE,
  "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  "app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx",
];

const AUTH_CALL = /\buseAuth\w*\s*\(/;
const AUTH_IMPORT = /from\s+["'][^"']*AuthContext["']/;
const AUTH_READY = /\bisAuthReady\b/;
/** `preview.totalCents -` / `totals.tipCents +` — arithmetic on a server price. */
const PRICED_ARITHMETIC = /\b(?:preview|totals)\.\w*Cents\s*[-+*/]/;

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (rel) => {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
};

/** Every rule, over sources supplied as a map. Pure, so the self-test drives it. */
export function auditGuestOrdering(sources) {
  const failures = [];
  const clean = {};
  for (const [rel, raw] of Object.entries(sources)) {
    if (raw === null) {
      failures.push(
        `${rel}: missing — the guest ordering rail must EXIST for this gate to mean anything (#1793).`,
      );
      continue;
    }
    clean[rel] = stripComments(raw);
  }
  if (failures.length > 0) return failures;

  // R1 — anon.
  for (const rel of ANON_FILES) {
    const src = clean[rel];
    if (src === undefined) continue;
    if (AUTH_CALL.test(src)) {
      failures.push(
        `${rel}: calls an auth hook. A diner has no account — the guest ordering rail is anon end to end (#1793 R1).`,
      );
    }
    if (AUTH_IMPORT.test(src)) {
      failures.push(`${rel}: imports AuthContext (#1793 R1).`);
    }
    if (AUTH_READY.test(src)) {
      failures.push(
        `${rel}: reads isAuthReady — a public buyer path may never gate on auth readiness (#1793 R1).`,
      );
    }
  }

  // R2 — the sitting is written BEFORE the guest is sent away to pay.
  const hook = clean[BUYER_HOOK];
  if (hook !== undefined) {
    const persistAt = hook.indexOf("persistSitting({");
    const redirectAt = hook.indexOf("window.location.assign(");
    if (persistAt === -1) {
      failures.push(
        `${BUYER_HOOK}: no persistSitting call — the sitting handle must be written before the redirect (#1793 R2).`,
      );
    } else if (redirectAt === -1) {
      // R3 reports this; R2 has nothing to order against.
    } else if (persistAt > redirectAt) {
      failures.push(
        `${BUYER_HOOK}: persistSitting runs AFTER the redirect. A hosted checkout leaves this page and may never come back to it, so that is persisting never — and the sitting is what stops a table being asked to tip twice (#1793 R2).`,
      );
    }

    // R3 — same tab.
    if (redirectAt === -1) {
      failures.push(
        `${BUYER_HOOK}: buyer web must redirect with window.location.assign. Linking.openURL resolves to window.open(url, "_blank", "noopener") on web — a popup, after an await (#1793 R3).`,
      );
    }
  }

  // R4 — one dynamic-import specifier for the ordering chunk.
  for (const rel of [BUYER_VENUE_ROUTE, BUYER_ORDER_ROUTE]) {
    const src = clean[rel];
    if (src === undefined) continue;
    if (!src.includes(ORDERING_SPECIFIER)) {
      failures.push(
        `${rel}: does not reach the ordering surface through "${ORDERING_SPECIFIER}". Two specifiers is two async chunks, and a module two async chunks share is hoisted into __common — the payload every visitor downloads before anything renders (#1793 R4, ORCH-1083).`,
      );
    }
  }

  // R5 — no arithmetic on a server-priced field.
  for (const rel of MONEY_MATH_FILES) {
    const src = clean[rel];
    if (src === undefined) continue;
    if (PRICED_ARITHMETIC.test(src)) {
      failures.push(
        `${rel}: performs arithmetic on a server-priced field. Every money number a guest reads is computed by venue-order-create; a surface that subtracts two of them to draw a third has started pricing (#1793 R5, SPEC #1788 P-20).`,
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// --self-test — GOOD and BAD fixtures for every rule, no repo scan.
// ---------------------------------------------------------------------------
function selfTest() {
  const good = {};
  for (const rel of ANON_FILES) good[rel] = "export const ok = 1;\n";
  good[BUYER_HOOK] =
    'const x = () => { persistSitting({ a: 1 }); window.location.assign(url); };\n';
  good[BUYER_VENUE_ROUTE] = `import("../${ORDERING_SPECIFIER}")\n`;
  good[BUYER_ORDER_ROUTE] = `import("../${ORDERING_SPECIFIER}")\n`;
  for (const rel of MONEY_MATH_FILES) {
    if (good[rel] === undefined) good[rel] = "export const ok = 1;\n";
  }

  const cases = [
    ["GOOD: a clean rail passes", good, 0],
    [
      "BAD R1: an auth hook on the guest rail",
      { ...good, [ANON_FILES[0]]: "const { user } = useAuth();\n" },
      1,
    ],
    [
      "BAD R1: isAuthReady on a public path",
      {
        ...good,
        "mingla-business/src/hooks/usePublicMenuBundle.ts":
          "const enabled = isAuthReady && slug !== null;\n",
      },
      1,
    ],
    [
      "BAD R2: the sitting is written after the redirect",
      {
        ...good,
        [BUYER_HOOK]:
          "const x = () => { window.location.assign(url); persistSitting({ a: 1 }); };\n",
      },
      1,
    ],
    [
      "BAD R3: a popup instead of a same-tab assignment",
      {
        ...good,
        [BUYER_HOOK]:
          "const x = () => { persistSitting({ a: 1 }); await Linking.openURL(url); };\n",
      },
      1,
    ],
    [
      "BAD R4: the order page reaches its own module",
      { ...good, [BUYER_ORDER_ROUTE]: 'import("../../src/services/other")\n' },
      1,
    ],
    [
      "BAD R5: the client subtracts two server prices",
      {
        ...good,
        [BUYER_HOOK]:
          "const x = () => { persistSitting({ a: 1 }); window.location.assign(url); };\n" +
          "const fees = preview.buyerSubtotalCents - preview.subtotalCents;\n",
      },
      1,
    ],
    [
      "BAD: a scanned surface has been deleted",
      { ...good, [BUYER_HOOK]: null },
      1,
    ],
    [
      "GOOD: the prose naming a forbidden shape does not trip it",
      {
        ...good,
        [ANON_FILES[2]]:
          "// this file must never call useAuth() or read isAuthReady\nexport const ok = 1;\n",
      },
      0,
    ],
  ];

  let bad = 0;
  for (const [label, sources, expected] of cases) {
    const failures = auditGuestOrdering(sources);
    const actual = failures.length > 0 ? 1 : 0;
    if (actual !== expected) {
      bad += 1;
      console.error(
        `self-test FAIL: ${label} — expected ${expected}, got ${actual}` +
          (failures.length > 0 ? `\n    ${failures.join("\n    ")}` : ""),
      );
    } else {
      console.log(`self-test ok: ${label}`);
    }
  }
  if (bad > 0) {
    console.error(`\nissue-1793 guest-ordering gate SELF-TEST FAILED (${bad}).`);
    process.exit(1);
  }
  console.log("\nissue-1793 guest-ordering gate self-test passed.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const sources = {};
  for (
    const rel of new Set([
      ...ANON_FILES,
      BUYER_HOOK,
      BUYER_VENUE_ROUTE,
      BUYER_ORDER_ROUTE,
      ...MONEY_MATH_FILES,
    ])
  ) {
    sources[rel] = read(rel);
  }
  const failures = auditGuestOrdering(sources);
  if (failures.length > 0) {
    console.error("issue-1793 guest-ordering structure gate FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    "issue-1793 guest-ordering structure gate passed (anon rail, sitting before redirect, same-tab, one ordering chunk, no client money math).",
  );
}
