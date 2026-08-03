import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const discover = read("../../DiscoverScreen.tsx");
const content = read("../StaysContent.tsx");
const filters = read("../StayFilterChips.tsx");
const card = read("../StayCard.tsx");
const service = read("../../../services/staysDiscoveryService.ts");
const migration = read("../../../../../supabase/migrations/20270205001423_issue_1423_stay_discovery.sql");

test("A-1423 client cannot bypass the anonymous-safe projection", () => {
  assert.doesNotMatch(service, /\.from\(\s*["'](?:brands|venue_listings|stay_)/);
  assert.doesNotMatch(content, /\.from\(/);
  assert.doesNotMatch(service, /["'](?:USD|GBP)["']/);
  assert.doesNotMatch(card, /rating|reviewCount|stars/i);
});

test("A-1423 database negative space excludes non-public and consumed supply", () => {
  for (const guard of [
    "venue_public_view",
    "venue.venue_category = 'stay'",
    "settings.booking_state = 'active'",
    "offering.kind = 'room'",
    "offering.status = 'live'",
    "media.status = 'ready'",
    "price.currency_code::text = venue.default_currency",
    "hold.state = 'reconciliation_required'",
    "commitment.state = 'active'",
  ]) assert.ok(migration.includes(guard), guard);
  assert.doesNotMatch(migration, /['"]USD['"]|['"]GBP['"]/);
});

test("A-1423 does not add a coach step or disturb the Events and Trips branches", () => {
  assert.match(discover, /if \(tabId === 'events'\) return coachEventsTab\.targetRef/);
  assert.match(discover, /if \(tabId === 'trips'\) return coachTripsTab\.targetRef/);
  assert.doesNotMatch(discover, /tabId === ['"]stays['"][\s\S]{0,80}targetRef/);
  assert.match(discover, /activeTab === "events"[\s\S]*FILTER_BAR_TOP \+ FILTER_BAR_HEIGHT/);
  assert.match(discover, /onBrowseEvents=\{\(\) => setActiveTab\("events"\)\}/);
});

test("A-1423 bounds typed filters and sends no destination text to analytics", () => {
  assert.match(filters, /maxLength=\{120\}/);
  assert.match(filters, /maximum=\{10\}/);
  assert.match(migration, /p_check_out - p_check_in NOT BETWEEN 1 AND 365/);
  assert.match(migration, /p_rooms, 0\) NOT BETWEEN 1 AND 100/);
  const analyticsBlock = content.slice(
    content.indexOf('postHogService.capture("stay_discover_filter_applied"'),
    content.indexOf("});", content.indexOf('postHogService.capture("stay_discover_filter_applied"')) + 3,
  );
  assert.doesNotMatch(analyticsBlock, /destination_query\s*:|\bdestination\s*:/);
  assert.match(analyticsBlock, /has_destination/);
});

test("A-1423 card claims availability only after date-filtered server proof", () => {
  assert.match(migration, /WHEN p_check_in IS NULL THEN 'choose_dates'/);
  assert.match(migration, /ELSE 'available'/);
  assert.match(card, /stay\.availabilityState === "available"/);
  assert.doesNotMatch(card, /["'][^"']*(?:Only \d|selling fast|best deal|\d+ left)[^"']*["']/i);
});
