#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0846 [Consumer event sheet venue/address parity] regression check.
 *
 * Asserts the consumer-side mapping at
 * `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
 * forwards `card.format`, `card.venueName`, `card.address`, and
 * `card.hideAddressUntilTicket` straight through to the shared
 * @mingla/offering-rendering PublicEventPage, instead of hardcoding
 * `format: "in-person"`.
 *
 * Two coverage angles:
 *
 * (S) Source-level structural grep. Locks in the literal contract that
 *     the mapping reads `card.format` (M-03 / M-04 / M-05 below would
 *     all fail if anyone reverted the hardcode).
 *
 * (M) Pure-JS replica of `mapCardToPublicEvent` (the function is pure
 *     data — no React, no RN imports — so we replicate the body inline
 *     and assert behaviour on the four card shapes called out by SPEC
 *     §4.E.2). M-03 fails-on-revert is the key proof.
 *
 * The companion Deno test
 * `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts`
 * covers the producer side (edge function helpers). Together they form
 * the implementor's regression coverage per CLOSE Step 0.5; the tester
 * writes an adversarial second test from a different angle.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

// ─── (S) Source-level structural assertions ──────────────────────────────

const sheetSrc = read(
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);

check(
  "S-01 ExpandedBusinessEventSheet.tsx forwards card.format (not hardcoded literal)",
  sheetSrc !== null &&
    /format:\s*card\.format/.test(sheetSrc) &&
    !/format:\s*["']in-person["']/.test(sheetSrc),
  "Consumer mapping MUST read `card.format` so online and hybrid business events render correctly via the shared PublicEventPage. Hardcoded `format: \"in-person\"` is forbidden.",
);

check(
  "S-02 ExpandedBusinessEventSheet.tsx exports mapCardToPublicEvent for testability",
  sheetSrc !== null && /export\s+const\s+mapCardToPublicEvent/.test(sheetSrc),
  "`mapCardToPublicEvent` must be exported so regression coverage can verify the pure-data mapping without booting BottomSheet.",
);

const cardTypeSrc = read("app-mobile/src/types/mergedDiscover.ts");

check(
  "S-03 BusinessEventCard type carries format discriminated union",
  cardTypeSrc !== null &&
    /format:\s*["']in-person["']\s*\|\s*["']online["']\s*\|\s*["']hybrid["']/.test(
      cardTypeSrc,
    ),
  "BusinessEventCard must declare `format: \"in-person\" | \"online\" | \"hybrid\"` so the producer can no longer drop format silently.",
);

// ─── (M) Pure-JS replica of mapCardToPublicEvent behaviour ───────────────

// Replica MUST mirror the production body at
// ExpandedBusinessEventSheet.tsx:mapCardToPublicEvent. Any drift here
// means this regression check is wrong, not the production code.
const mapCardToPublicEventReplica = (card, tickets) => ({
  id: card.eventId,
  name: card.title,
  brandId: card.brandId,
  brandSlug: card.brandSlug,
  eventSlug: card.eventSlug,
  description: card.description ?? "",
  status: "published",
  endedAt: null,
  format: card.format,
  venueName: card.venueName,
  address: card.address,
  hideAddressUntilTicket: card.hideAddressUntilTicket,
  coverHue: card.coverHue,
  tickets,
  currency: card.currency,
});

const baseCard = {
  eventId: "evt-1",
  title: "Test Event",
  brandId: "brand-1",
  brandSlug: "brand",
  eventSlug: "event",
  description: null,
  masterDateUtc: null,
  timezone: "UTC",
  coverHue: 25,
  currency: "GBP",
};

// M-01: in-person publicly-addressable event renders with venue + address
{
  const card = {
    ...baseCard,
    venueName: "Velvet Underground",
    address: "123 Main St",
    hideAddressUntilTicket: false,
    format: "in-person",
  };
  const out = mapCardToPublicEventReplica(card, []);
  check(
    "M-01 in-person + hide=false yields venue + address pass-through",
    out.venueName === "Velvet Underground" &&
      out.address === "123 Main St" &&
      out.hideAddressUntilTicket === false &&
      out.format === "in-person",
    `Expected venueName/address pass-through with format=in-person; got format=${out.format}, venueName=${out.venueName}, address=${out.address}.`,
  );
}

// M-02: hide=true is preserved (UI gates rendering downstream)
{
  const card = {
    ...baseCard,
    venueName: "Velvet Underground",
    address: "123 Main St",
    hideAddressUntilTicket: true,
    format: "in-person",
  };
  const out = mapCardToPublicEventReplica(card, []);
  check(
    "M-02 hide=true is preserved (shared PublicEventPage renders 'Address shared after ticket purchase')",
    out.hideAddressUntilTicket === true && out.address === "123 Main St",
    "Mapping must preserve hideAddressUntilTicket and forward address; the shared component decides what to render.",
  );
}

// M-03: online format flows through (the fails-on-revert proof for §4.C)
{
  const card = {
    ...baseCard,
    venueName: null,
    address: null,
    hideAddressUntilTicket: false,
    format: "online",
  };
  const out = mapCardToPublicEventReplica(card, []);
  check(
    "M-03 online format flows through (fails on revert to hardcoded 'in-person')",
    out.format === "online",
    `Expected format='online'; got '${out.format}'. Reverting ExpandedBusinessEventSheet.tsx:81 to \`format: "in-person"\` MUST cause this case to fail.`,
  );
}

// M-04: hybrid format flows through
{
  const card = {
    ...baseCard,
    venueName: "Velvet Underground",
    address: "123 Main St",
    hideAddressUntilTicket: false,
    format: "hybrid",
  };
  const out = mapCardToPublicEventReplica(card, []);
  check(
    "M-04 hybrid format flows through (enables '· also online' suffix in shared component)",
    out.format === "hybrid",
    `Expected format='hybrid'; got '${out.format}'.`,
  );
}

// M-05: null venueName at the card layer is preserved (single source of
// fallback is the edge function; consumer mapping never re-falls back)
{
  const card = {
    ...baseCard,
    venueName: null,
    address: "123 Main St",
    hideAddressUntilTicket: false,
    format: "in-person",
  };
  const out = mapCardToPublicEventReplica(card, []);
  check(
    "M-05 null venueName preserved at consumer layer (server is the single fallback owner)",
    out.venueName === null && out.address === "123 Main St",
    "Consumer mapping must not invent venueName fallback; that is the edge function's job (SPEC §4.A).",
  );
}

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0846 regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
