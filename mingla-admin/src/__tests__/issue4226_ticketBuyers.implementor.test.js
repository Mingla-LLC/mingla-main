// Issue #4226 — ticket buyers in Mingla Admin.
//
//   1. People has a "Ticket buyers, no app" tab fed by the server segment
//      ticket_buyer_no_app, with Name/email, App status, City, Country,
//      Tickets, Spent, Last purchase and Emails OK; its rows have no account
//      id, so they are keyed by person and do not open the account drawer.
//   2. Ticket facts are in plain words: app status, spend per currency (never
//      summed across currencies), marketing consent.
//   3. The Email composer offers a "Ticket buyers" audience and the App
//      status, Event city, Bought tickets and Brand bought from filters, can
//      address a buyer with no account by email, and shows who is left out
//      and why (including "didn't agree to marketing email").
//   4. The Data room shows ticket buyers, buyers with no app and buyer→app
//      conversion, and says so instead of showing 0 for a day stored before
//      #4226.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PEOPLE_TABS,
  peopleTabFor,
  peopleTabLabel,
  flattenPersonRow,
  spentLabel,
  marketingConsent,
  appStatusLabel,
} from "../lib/peopleSegments.js";
import {
  AUDIENCE_PRESETS,
  EMPTY_FILTERS,
  audienceFor,
  audienceSummary,
  audienceFilterWords,
  choosePreset,
  exclusionReasons,
  isRecipientChosen,
  presetIsActive,
} from "../lib/emailAudience.js";
import { ticketBuyerTiles } from "../lib/dataRoomAnalytics.js";
import { restoreDraftAudience } from "../lib/emailDraftAudience.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("#4226 People: the ticket-buyer tab", () => {
  it("is a tab on the server segment, with the server count", () => {
    const tab = peopleTabFor("ticket-buyers");
    assert.equal(tab.segment, "ticket_buyer_no_app");
    assert.equal(tab.label, "Ticket buyers, no app");
    assert.equal(peopleTabLabel(tab, { ticket_buyer_no_app: 262 }), "Ticket buyers, no app · 262");
    assert.equal(peopleTabLabel(tab, null), "Ticket buyers, no app", "no count until the server answers");
    assert.equal(PEOPLE_TABS.filter((t) => t.segment === "ticket_buyer_no_app").length, 1);
  });

  it("flattens a no-account buyer into the table and CSV fields", () => {
    const row = flattenPersonRow({
      id: null,
      person_key: "e:ada@example.org",
      name: "Ada Buyer",
      email: "ada@example.org",
      segment: "ticket_buyer_no_app",
      app_status: "ticket_buyer_no_app",
      event_city: "Lagos",
      country: "NG",
      tickets: 2,
      spent: { NGN: 104500 },
      marketing_consent: "yes",
      brands_bought: [{ id: "b1", name: "We Go Again Exhibition" }, { id: "b2", name: "Ctrl" }],
    });
    assert.equal(row.row_key, "e:ada@example.org", "no account id: keyed by person");
    assert.equal(row.app_status_label, "No app yet");
    assert.match(row.spent_label, /1,045/);
    assert.equal(row.emails_ok_label, "Yes");
    assert.equal(row.brands_bought_names, "We Go Again Exhibition; Ctrl");
    assert.equal(flattenPersonRow({ id: "u1", email: "x@y.z" }).row_key, "u1", "an account keeps its id");
  });

  it("names ticket facts plainly; money is per currency, never summed", () => {
    assert.equal(appStatusLabel("both"), "Host and Explorer");
    assert.equal(appStatusLabel("incomplete"), "Didn't finish sign-up");
    assert.equal(appStatusLabel("__proto__"), "Unknown");
    const two = spentLabel({ USD: 1000, NGN: 50000 });
    assert.match(two, /500/);
    assert.match(two, /\$10/);
    assert.match(two, / \+ /, "two currencies read as two amounts");
    assert.equal(spentLabel({}), "Free");
    assert.equal(spentLabel({ NGN: 0 }), "Free");
    assert.equal(spentLabel(null), "Free");
    assert.deepEqual(marketingConsent("unsubscribed"), { label: "Unsubscribed", variant: "warning" });
    assert.equal(marketingConsent("maybe").label, "No", "anything unknown is not consent");
  });

  it("renders the agreed columns, exports, and does not open a drawer for no-account rows", () => {
    const page = read("pages/PeoplePage.jsx");
    const block = page.slice(page.indexOf("const TICKET_BUYER_COLUMNS"), page.indexOf("const COLUMNS = {"));
    for (const label of ["Name / email", "App status", "City", "Country", "Spent", "Last purchase", "Emails OK"]) {
      assert.match(block, new RegExp(`label: "${label}"`), `column ${label}`);
    }
    assert.match(block, /count\("tickets", "Tickets"\)/, "column Tickets");
    assert.match(page, /ticket_buyer_no_app: TICKET_BUYER_COLUMNS/);
    assert.match(page, /if \(segment === "ticket_buyer_no_app"\) return CSV_TICKET_BUYERS;/);
    assert.match(page, /rowKey=\{\(row\) => row\.row_key\}/);
    // Host contacts (no account either) share the no-drawer rule.
    assert.match(page, /const noAccountTab = segment === "ticket_buyer_no_app" \|\|/);
    assert.match(page, /onRowClick=\{noAccountTab \? undefined :/);
    const service = read("services/peopleService.js");
    assert.match(service, /last_purchase_at: \{ asc: "last_active_asc", desc: "last_active_desc" \}/);
  });
});

describe("#4226 Email: the Ticket buyers audience", () => {
  it("offers Ticket buyers as an audience that sets the segment", () => {
    const preset = AUDIENCE_PRESETS.find((p) => p.id === "ticket_buyers");
    assert.equal(preset.label, "Ticket buyers");
    const next = choosePreset(preset, EMPTY_FILTERS);
    assert.equal(next.audienceMode, "segment");
    assert.equal(next.filters.userType, "ticket_buyers");
    assert.equal(next.filters.city, "all");
    assert.equal(presetIsActive(preset, next.audienceMode, next.filters), true);
    assert.equal(presetIsActive(AUDIENCE_PRESETS[0], next.audienceMode, next.filters), false, "Hosts is not also pressed");
    assert.deepEqual(audienceFor("segment", null, { ...next.filters, city: "Lagos", appStatus: "ticket_buyer_no_app" }), {
      mode: "segment",
      filters: { ...next.filters, city: "Lagos", appStatus: "ticket_buyer_no_app" },
    });
    assert.equal(audienceSummary("segment", next.filters, { will_receive: 249 }), "249 ticket buyers");
  });

  it("addresses one buyer with no account by email", () => {
    assert.deepEqual(audienceFor("person", { profile_id: null, email: "ada@example.org" }, EMPTY_FILTERS), {
      mode: "person",
      email: "ada@example.org",
    });
    assert.deepEqual(audienceFor("person", { profile_id: "u1", email: "x@y.z" }, EMPTY_FILTERS), { mode: "person", profileId: "u1" });
    assert.equal(isRecipientChosen({ profile_id: null, email: "ada@example.org" }), true);
    assert.equal(isRecipientChosen(null), false);
  });

  it("shows who is left out and why, hiding zeros", () => {
    assert.deepEqual(
      exclusionReasons({ opted_out: 2, no_consent: 15, internal: 7, no_contact: 0, duplicate: 0 }).map((r) => `${r.count} ${r.label}`),
      ["2 unsubscribed", "15 didn't agree to marketing email", "7 staff and test"],
    );
    assert.deepEqual(exclusionReasons(null), []);
  });

  it("names the ticket-buyer filters in campaign history", () => {
    assert.deepEqual(
      audienceFilterWords({ userType: "ticket_buyers", appStatus: "ticket_buyer_no_app", city: "Lagos", boughtTickets: "yes", brandId: "b1" }),
      ["ticket buyers", "Ticket buyer, no app", "event city Lagos", "bought tickets", "one brand"],
    );
  });

  it("a saved Ticket buyers draft still restores as Hosts (never pre-selects marketing)", () => {
    const restored = restoreDraftAudience({ audienceMode: "segment", filters: { ...EMPTY_FILTERS, userType: "ticket_buyers" } }, EMPTY_FILTERS);
    assert.equal(restored.filters.userType, "host");
  });

  it("the composer renders the audience, the filters and the reasons", () => {
    const composer = read("components/email/EmailComposer.jsx");
    assert.match(composer, /AUDIENCE_PRESETS\.map/);
    for (const label of ["App status", "Event city", "Bought tickets", "Brand bought from"]) {
      assert.match(composer, new RegExp(`label="${label}"`), `filter ${label}`);
    }
    assert.match(composer, /<option value="ticket_buyers">Ticket buyers<\/option>/);
    assert.match(composer, /leftOut\.map/);
    assert.match(composer, /Didn't agree to marketing/);
    assert.match(composer, /isRecipientChosen\(selectedRecipient\)/);
    assert.doesNotMatch(composer, /!selectedRecipient\?\.profile_id/, "a no-account buyer is a valid choice");
  });
});

describe("#4226 Data room: ticket buyers and conversion", () => {
  it("shows buyers, no app, with app and conversion", () => {
    const tiles = ticketBuyerTiles({ buyers: 275, with_app: 13, no_app: 262, no_account: 257, bought_before_account: 262, converted: 5, conversion_rate: 0.0191 });
    assert.deepEqual(tiles.map((t) => t.label), ["Ticket buyers", "Buyers with no app", "Buyers with an app", "Buyer → app conversion"]);
    assert.equal(tiles[1].value, "262");
    assert.equal(tiles[3].value, "1.9%");
    assert.match(tiles[3].note, /5 of 262/);
    assert.equal(ticketBuyerTiles({ buyers: 0, conversion_rate: null })[3].value, "–", "nothing to convert yet is a dash, not 0%");
  });

  it("a day stored before #4226 says so instead of showing 0", () => {
    assert.equal(ticketBuyerTiles(undefined), null);
    const overview = read("components/dataRoom/DataRoomOverview.jsx");
    assert.match(overview, /<TicketBuyers users=\{users\} \/>/);
    assert.match(overview, /Ticket buyer numbers start with snapshots taken after this release/);
  });
});
