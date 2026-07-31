#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270205001423_issue_1423_stay_discovery.sql",
  discover: "app-mobile/src/components/DiscoverScreen.tsx",
  filters: "app-mobile/src/components/discover/StayFilterChips.tsx",
  content: "app-mobile/src/components/discover/StaysContent.tsx",
  card: "app-mobile/src/components/discover/StayCard.tsx",
  service: "app-mobile/src/services/staysDiscoveryService.ts",
  hook: "app-mobile/src/hooks/useDiscoverStays.ts",
  store: "app-mobile/src/store/appStore.ts",
  allowlist: "supabase/security/anon_executable_definer_allowlist.txt",
  happyTest: "app-mobile/src/components/discover/__tests__/issue1423StayDiscovery.test.mjs",
  adversarialTest: "app-mobile/src/components/discover/__tests__/issue1423StayDiscovery.tester.adversarial.test.mjs",
};

const required = {
  migration: [
    "pg_public_stays_discover",
    "STAY_PUBLIC_PAGES",
    "venue_public_view",
    "venue.venue_category = 'stay'",
    "settings.booking_state = 'active'",
    "offering.kind = 'room'",
    "offering.status = 'live'",
    "media.status = 'ready'",
    "price.currency_code::text = venue.default_currency",
    "hold.state = 'reconciliation_required'",
    "commitment.state = 'active'",
    "night.sellable_quantity",
    "TO anon, authenticated",
  ],
  discover: [
    'id: "events"',
    'id: "trips"',
    'id: "stays"',
    'activeTab === "stays"',
    "<StaysContent",
    'activeTab === "trips"',
    "<TripsContent",
    'activeTab === "events"',
  ],
  filters: ["Destination", "Dates", "Guests & rooms", "Filters", "maximum={10}"],
  content: [
    'pathname: "/b/[brandSlug]/v/[venueSlug]"',
    "isFlagEnabled === false",
    "discover_stays",
    "stay_discover_filter_applied",
    "stay_discover_card_viewed",
    "stay_discover_card_opened",
  ],
  card: ["propertyKind", "From {price} / night", "availabilityState", "currencyCode"],
  service: [
    'supabase.rpc("pg_public_stays_discover"',
    "p_check_in: filters.checkIn",
    "p_rooms: filters.rooms",
    "row.currencyCode",
  ],
  hook: ["useInfiniteQuery", "if (!lastPage.enabled) return undefined"],
  store: [
    "discoverActiveTab: 'events' | 'trips' | 'stays'",
    "discoverStayFilters",
    "discover_stays",
  ],
  allowlist: [
    "pg_public_stays_discover(p_destination_query text, p_check_in date, p_check_out date, p_adults integer, p_children integer, p_rooms integer, p_property_kinds text[], p_amenities text[], p_confirmation_mode text, p_limit integer, p_offset integer)",
  ],
  happyTest: ["exactly the four approved Stay filter entry points"],
  adversarialTest: ["database negative space excludes non-public and consumed supply"],
};

function check(source) {
  const failures = [];
  for (const [key, needles] of Object.entries(required)) {
    for (const needle of needles) {
      if (!source[key]?.includes(needle)) {
        failures.push(`${files[key]} missing ${JSON.stringify(needle)}`);
      }
    }
  }
  if ((source.filters?.match(/<Chip\b/g) ?? []).length !== 4) {
    failures.push("Stay filters must expose exactly four top-level chips");
  }
  if (/\.from\(\s*["'](?:brands|venue_listings|stay_)/u.test(source.service ?? "")) {
    failures.push("Stay consumer service bypasses the public RPC");
  }
  if (/["'](?:USD|GBP)["']/u.test(source.service ?? "") || /'(?:USD|GBP)'/u.test(source.migration ?? "")) {
    failures.push("Stay discovery contains a forbidden fallback currency");
  }
  if (/(?:INSERT\s+INTO|UPDATE)\s+public\.feature_flags[\s\S]{0,120}is_enabled\s*=\s*true/iu.test(source.migration ?? "")) {
    failures.push("Issue #1423 enables a Stay launch flag");
  }
  if (/tabId === ["']stays["'][\s\S]{0,100}targetRef/u.test(source.discover ?? "")) {
    failures.push("Stays added an unauthorized coach-mark step");
  }
  if (/rating|reviewCount|selling fast|best deal/iu.test(source.card ?? "")) {
    failures.push("Stay card fabricates an unsupported discovery attribute");
  }
  return failures;
}

function load() {
  return Object.fromEntries(
    Object.entries(files).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(
    Object.entries(required).map(([key, needles]) => [key, needles.join("\n")]),
  );
  good.filters += "\n<Chip/><Chip/><Chip/><Chip/>";
  let reversions = 0;
  if (check(good).length > 0) {
    console.error(`issue-1423 self-test fixture invalid:\n${check(good).join("\n")}`);
    process.exit(2);
  }
  for (const [key, needles] of Object.entries(required)) {
    const bad = { ...good, [key]: good[key].replace(needles[0], "") };
    if (check(bad).length === 0) {
      console.error(`issue-1423 self-test missed ${key} reversion`);
      process.exit(1);
    }
    reversions += 1;
  }
  for (const bad of [
    { ...good, service: `${good.service}\n.from("stay_offerings")` },
    { ...good, service: `${good.service}\nconst fallback = "USD"` },
    { ...good, migration: `${good.migration}\nUPDATE public.feature_flags SET is_enabled = true` },
    { ...good, discover: `${good.discover}\nif (tabId === "stays") return stay.targetRef` },
    { ...good, card: `${good.card}\nconst rating = 5` },
    { ...good, filters: good.filters.replace("<Chip/>", "") },
  ]) {
    if (check(bad).length === 0) {
      console.error("issue-1423 self-test missed an adversarial reversion");
      process.exit(1);
    }
    reversions += 1;
  }
  console.log(`issue-1423 self-test PASS (${reversions} reversions)`);
  process.exit(0);
}

try {
  const failures = check(load());
  if (failures.length > 0) {
    console.error(["I-1423-STAY-DISCOVERY violation:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
    process.exit(1);
  }
  console.log("I-1423-STAY-DISCOVERY PASS");
} catch (error) {
  console.error(`I-1423-STAY-DISCOVERY inconclusive: ${error.message}`);
  process.exit(2);
}
