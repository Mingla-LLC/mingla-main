// Issue #4226 — host contacts in Mingla Admin, and Everyone means everyone.
//
//   1. People has a "Host contacts, no app" tab fed by the server segment
//      host_contact_no_app, with Name/email, Added by, City (host city),
//      Country, Emails OK and Added; its rows have no account, so they are
//      keyed by person and open no drawer. Folded rows on other tabs carry a
//      "Host contact" marker.
//   2. The Email composer offers a "Host contacts" audience, the App status
//      "Host contact, no app" and a Source filter (Ticket buyer / Host
//      contact).
//   3. Everyone is the whole list; the estimate shows who will receive by
//      group (every group, zeros included) and who is left out by reason.
//   4. The Data room shows host contacts and host contacts who later got an
//      app, and says so instead of showing 0 for an older stored day.
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
  appStatusLabel,
  consentBasisLabel,
} from "../lib/peopleSegments.js";
import {
  APP_STATUS_OPTIONS,
  AUDIENCE_PRESETS,
  EMPTY_FILTERS,
  EVERYONE_GROUPS,
  SOURCE_OPTIONS,
  audienceFor,
  audienceFilterWords,
  audienceSummary,
  choosePreset,
  exclusionReasons,
  groupBreakdown,
  presetIsActive,
} from "../lib/emailAudience.js";
import { hostContactTiles } from "../lib/dataRoomAnalytics.js";
import { restoreDraftAudience } from "../lib/emailDraftAudience.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("#4226 People: the host-contact tab", () => {
  it("is a tab on the server segment, with the server count", () => {
    const tab = peopleTabFor("host-contacts");
    assert.equal(tab.segment, "host_contact_no_app");
    assert.equal(tab.label, "Host contacts, no app");
    assert.equal(peopleTabLabel(tab, { host_contact_no_app: 276 }), "Host contacts, no app · 276");
    assert.equal(PEOPLE_TABS.filter((t) => t.segment === "host_contact_no_app").length, 1);
    assert.equal(appStatusLabel("host_contact_no_app"), "No app yet");
  });

  it("flattens a host contact into the table and CSV fields", () => {
    const row = flattenPersonRow({
      id: null,
      person_key: "e:kemi@example.org",
      name: "Kemi Imported",
      email: "kemi@example.org",
      segment: "host_contact_no_app",
      app_status: "host_contact_no_app",
      host_city: "Lagos",
      country: "NG",
      marketing_consent: "yes",
      consent_basis: "host_import_attestation",
      host_brands: [{ id: "b1", name: "We Go Again Exhibition" }, { id: "b2", name: "Ctrl" }],
      host_contact_added_at: "2026-10-01T00:00:00Z",
    });
    assert.equal(row.row_key, "e:kemi@example.org", "no account: keyed by person");
    assert.equal(row.host_brand_names, "We Go Again Exhibition; Ctrl");
    assert.equal(row.emails_ok_label, "Yes");
    assert.equal(row.consent_basis_label, "Host import (host confirmed permission)");
    assert.equal(consentBasisLabel("host_manual_add"), "Added by a host");
    assert.equal(consentBasisLabel("__proto__"), "");
  });

  it("renders the agreed columns, marks folded rows, exports, opens no drawer", () => {
    const page = read("pages/PeoplePage.jsx");
    const block = page.slice(page.indexOf("const HOST_CONTACT_COLUMNS"), page.indexOf("const COLUMNS = {"));
    for (const label of ["Name / email", "Added by", "City", "Country", "Emails OK", "Added"]) {
      assert.match(block, new RegExp(`label: "${label}"`), `column ${label}`);
    }
    assert.match(block, /key: "host_city", label: "City"/, "City is the host city, not the event city");
    assert.match(page, /host_contact_no_app: HOST_CONTACT_COLUMNS/);
    assert.match(page, /if \(segment === "host_contact_no_app"\) return CSV_HOST_CONTACTS;/);
    assert.match(page, /\{ key: "host_city", label: "Host city" \}/);
    assert.match(page, /row\.is_host_contact && row\.segment !== "host_contact_no_app"[\s\S]{0,80}>Host contact</);
    assert.match(page, /onRowClick=\{noAccountTab \? undefined :/);
    assert.match(page, /const noAccountTab = segment === "ticket_buyer_no_app" \|\| segment === "host_contact_no_app";/);
  });
});

describe("#4226 Email: host contacts and Everyone", () => {
  it("offers Host contacts as an audience that sets the segment", () => {
    const preset = AUDIENCE_PRESETS.find((p) => p.id === "host_contacts");
    assert.equal(preset.label, "Host contacts");
    const next = choosePreset(preset, EMPTY_FILTERS);
    assert.equal(next.audienceMode, "segment");
    assert.equal(next.filters.userType, "host_contacts");
    assert.equal(next.filters.source, "all");
    assert.equal(presetIsActive(preset, next.audienceMode, next.filters), true);
    assert.equal(audienceSummary("segment", next.filters, { will_receive: 270 }), "270 host contacts");
  });

  it("adds the 'Host contact, no app' status and the Source filter", () => {
    assert.ok(APP_STATUS_OPTIONS.some((o) => o.value === "host_contact_no_app" && o.label === "Host contact, no app"));
    assert.deepEqual(SOURCE_OPTIONS.map((o) => [o.value, o.label]), [["ticket_buyer", "Ticket buyer"], ["host_contact", "Host contact"]]);
    assert.deepEqual(audienceFor("segment", null, { ...EMPTY_FILTERS, userType: "all", source: "host_contact" }).filters.source, "host_contact");
    assert.deepEqual(
      audienceFilterWords({ userType: "host_contacts", appStatus: "host_contact_no_app", source: "host_contact" }),
      ["host contacts", "Host contact, no app", "source: host contact"],
    );
  });

  it("Everyone is the whole list and is broken down by every group", () => {
    assert.deepEqual(audienceFor("everyone", null, EMPTY_FILTERS), { mode: "everyone", filters: {} });
    assert.deepEqual(EVERYONE_GROUPS.map((g) => g.key), [
      "explorer", "host", "both", "incomplete", "ticket_buyer_no_app", "host_contact_no_app",
    ]);
    const groups = groupBreakdown({ groups: { explorer: 80, host: 60, both: 6, incomplete: 30, ticket_buyer_no_app: 247 } });
    assert.deepEqual(groups.map((g) => `${g.label}: ${g.count}`), [
      "Explorers: 80", "Hosts: 60", "Host and Explorer: 6", "Didn't finish sign-up: 30",
      "Ticket buyers, no app: 247", "Host contacts, no app: 0",
    ], "a missing group shows as 0, never disappears");
    assert.deepEqual(groupBreakdown(null), []);
    assert.equal(audienceSummary("everyone", EMPTY_FILTERS, { will_receive: 690 }), "Everyone (690)");
    assert.doesNotMatch(read("lib/emailAudience.js"), /Everyone with a Mingla app/, "no old 'app users only' Everyone");
    assert.deepEqual(
      exclusionReasons({ opted_out: 3, no_consent: 20, internal: 37, no_contact: 1, duplicate: 2 }).map((r) => r.key),
      ["opted_out", "no_consent", "internal", "no_contact", "duplicate"],
    );
  });

  it("the composer renders the preset, the filters, the Everyone words and the breakdown", () => {
    const composer = read("components/email/EmailComposer.jsx");
    assert.match(composer, /<option value="host_contacts">Host contacts<\/option>/);
    assert.match(composer, /label="Source"/);
    assert.match(composer, /SOURCE_OPTIONS\.map/);
    assert.match(composer, /const byGroup = groupBreakdown\(estimate\);/);
    assert.match(composer, /byGroup\.map/);
    assert.match(composer, /Everyone on the People list: app users, people who didn't finish sign-up, ticket buyers and host contacts\./);
    assert.doesNotMatch(composer, /Everyone with the Host or Explorer app/);
  });

  it("a saved Host contacts draft still restores as Hosts (never pre-selects marketing)", () => {
    const restored = restoreDraftAudience({ audienceMode: "segment", filters: { ...EMPTY_FILTERS, userType: "host_contacts" } }, EMPTY_FILTERS);
    assert.equal(restored.filters.userType, "host");
  });
});

describe("#4226 Data room: host contacts", () => {
  it("shows host contacts, no app, and those who later got an app", () => {
    const tiles = hostContactTiles({ contacts: 293, no_app: 280, no_app_no_ticket: 276, with_app: 13, added_before_account: 285, converted: 5, conversion_rate: 0.0175 });
    assert.deepEqual(tiles.map((t) => t.label), ["Host contacts", "Host contacts with no app", "Later got an app", "Host contact → app conversion"]);
    assert.equal(tiles[0].value, "293");
    assert.match(tiles[0].note, /276 with no account and no ticket/);
    assert.equal(tiles[2].value, "5");
    assert.equal(tiles[3].value, "1.8%");
    assert.equal(hostContactTiles({ contacts: 0, conversion_rate: null })[3].value, "–");
    assert.equal(hostContactTiles(undefined), null);
    const overview = read("components/dataRoom/DataRoomOverview.jsx");
    assert.match(overview, /<HostContacts users=\{users\} \/>/);
    assert.match(overview, /Host contact numbers start with snapshots taken after this release/);
  });
});
