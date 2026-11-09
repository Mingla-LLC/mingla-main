// Issue #4339 round A (Seth approved, 8 Nov 2026) — every confirmed "Book a
// call" booking from usemingla.com/schedule is an Inbound lead.
//
//   BC-1  A book_a_call row reads "Book a call" and shows what they run, the
//         social as a working profile link, the website and the call time.
//         Only https profiles and http(s) sites are ever links.
//   BC-2  Add to Hosts: a Prospect card with the email and the social as
//         contact details (so the pipeline's duplicate check sees them), the
//         booker as the contact, and the Hosts ICP for what they run.
//   BC-3  The page reads the booking's contact details through
//         admin_book_call_lead_get and renders the booking details.
//   BC-4  The migration: the table is closed to clients, the union gains the
//         book_a_call kind, and the new getter checks who is asking first and
//         refuses anon.
//
// Run: node --test src/pages/__tests__/issue4339_inboundBookACall.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bookCallHostFields, bookingView, leadView } from "../../lib/inboundLeads.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const MIGRATION = fs.readFileSync(
  path.join(SRC, "../../supabase/migrations/20280520004339_issue_4339_book_a_call_leads.sql"),
  "utf8"
);

const ROW = {
  id: "b1",
  source: "book_a_call",
  created_at: "2026-11-08T15:00:00Z",
  business: "Blue Note",
  has_email: true,
  is_test: false,
  host: null,
  booking: {
    icp: "restaurants",
    social_platform: "instagram",
    social_handle: "@bluenote",
    social_url: "https://instagram.com/bluenote",
    website: "https://bluenote.example",
    call_at: "2026-11-12T15:00:00Z",
    source: "venue_grader",
  },
};

describe("#4339 BC-1: a booking row", () => {
  it("reads Book a call with its ICP, social link, website and call time", () => {
    const lead = leadView(ROW);
    // #4339 calls: a booking with no audience is a Host call.
    assert.equal(lead.source, "Host call");
    assert.equal(lead.canAdd, true);
    assert.equal(lead.hasEmail, true);
    assert.deepEqual(lead.booking, {
      audience: "host",
      label: "Host call",
      icp: "Restaurant, café or diner",
      city: null,
      makes: null,
      workUrl: null,
      firstPlace: null,
      socialLabel: "Instagram",
      socialHandle: "@bluenote",
      socialUrl: "https://instagram.com/bluenote",
      website: "https://bluenote.example",
      callAt: "2026-11-12T15:00:00Z",
      // #4339 calendar sync: a row with no status reads as booked.
      status: "booked",
      statusLabel: "Booked",
      statusChangedAt: null,
      originalCallAt: null,
      cameFrom: "venue_grader",
    });
  });

  it("never renders an unsafe link; the other kinds carry no booking", () => {
    const bad = bookingView({ ...ROW.booking, social_url: "javascript:alert(1)", website: "data:text/html,x" });
    assert.equal(bad.socialUrl, null);
    assert.equal(bad.website, null);
    assert.equal(bookingView({ ...ROW.booking, social_url: "http://instagram.com/x" }).socialUrl, null, "a profile link is https");
    assert.equal(bookingView({ ...ROW.booking, website: "http://plain.example" }).website, "http://plain.example");
    assert.equal(bookingView(null), null);
    assert.equal(leadView({ id: "t", source: "tool", tool: "venues", business: "Rooftop", booking: ROW.booking }).booking, null);
    assert.equal(leadView({ id: "x", source: "beta", business: "Kitchen" }).booking, null);
  });
});

describe("#4339 BC-2: Add to Hosts", () => {
  it("a Prospect card with the email and social as contact details", () => {
    const fields = bookCallHostFields(leadView(ROW), {
      name: " Ada Lovelace ",
      email: " ada@bluenote.example ",
      icp: "restaurants",
      host_icp: "restaurant_bar",
      social_platform: "instagram",
      social_url: "https://instagram.com/bluenote",
    });
    assert.deepEqual(fields, {
      name: "Blue Note",
      source: "inbound",
      identifiers: [
        { kind: "email", value: "ada@bluenote.example" },
        { kind: "handle", value: "https://instagram.com/bluenote", platform: "instagram" },
      ],
      channel: "email",
      contact: "Ada Lovelace",
      icp: "restaurant_bar",
    });
    assert.ok(!("stage" in fields), "the server starts every new card at its first stage (Prospect)");
  });

  // #4339: the booking-to-Hosts ICP map moved to the server
  // (admin_book_call_lead_get returns host_icp; #3802 C-8 keeps every ICP id
  // out of the admin client). The map's values are checked against the Hosts
  // ICP list in the migration.
  it("the Hosts ICP is the server's, never a client guess", () => {
    assert.equal(bookCallHostFields({ business: "Somewhere" }, { icp: "other", host_icp: null }).icp, undefined);
    assert.equal(bookCallHostFields({ business: "Somewhere" }, { icp: "restaurants" }).icp, undefined, "no host_icp, no ICP");
    assert.equal(bookCallHostFields({ business: "Somewhere" }, { icp: "events", host_icp: "event_organizer" }).icp, "event_organizer");
    const hostIcps = new Set(["restaurant_bar", "venue_gallery", "event_organizer", "community_host", "trip_stay_host", "experience_host", "partner_org"]);
    const body = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.admin_book_call_lead_get("));
    const map = body.slice(body.indexOf("'host_icp', CASE k.icp"), body.indexOf("END)"));
    const pairs = [...map.matchAll(/WHEN '([a-z]+)'\s+THEN '([a-z_]+)'/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(pairs.map(([b]) => b), ["events", "trips", "experiences", "restaurants", "hotels", "art", "play"]);
    for (const [icp, hostIcp] of pairs) assert.ok(hostIcps.has(hostIcp), `${icp} → ${hostIcp}`);
    assert.match(map, /ELSE NULL/);
  });
});

describe("#4339 BC-3: the page", () => {
  it("reads the booking's contact details and shows the booking details", () => {
    const page = stripComments(read("pages/InboundLeadsPage.jsx"));
    assert.match(read("services/dashboardService.js"), /export const getBookCallLead = \(id\) => rpc\("admin_book_call_lead_get", \{ p_id: id \}\);/);
    assert.match(page, /lead\.raw\.source === "book_a_call"\) \{\s*const detail = await getBookCallLead\(lead\.id\);/);
    assert.match(page, /createRecord\("hosts", bookCallHostFields\(lead, detail\), newRequestKey\(\)\)/);
    assert.match(page, /\{lead\.booking && <BookingDetails booking=\{lead\.booking\} \/>\}/);
    assert.match(page, /<a href=\{booking\.socialUrl\} target="_blank" rel="noopener noreferrer"/);
    assert.match(page, /<a href=\{booking\.website\} target="_blank" rel="noopener noreferrer"/);
    assert.match(page, /Call: \{formatDateTime\(booking\.callAt\)\}/);
    assert.match(page, /Their email and social go on the card as contact details\./);
  });
});

describe("#4339 BC-4: the migration", () => {
  it("closes the table to clients and adds the book_a_call kind", () => {
    assert.match(MIGRATION, /ALTER TABLE public\.book_call_leads ENABLE ROW LEVEL SECURITY;/);
    assert.match(MIGRATION, /REVOKE ALL ON TABLE public\.book_call_leads FROM PUBLIC, anon, authenticated;/);
    assert.match(MIGRATION, /CONSTRAINT book_call_leads_booking_key_key UNIQUE \(booking_key\)/);
    assert.match(MIGRATION, /SELECT k\.id, 'book_a_call', k\.created_at, COALESCE\(NULLIF\(btrim\(k\.venue\), ''\), btrim\(k\.name\)\)/);
    const sql = MIGRATION.replace(/--.*$/gm, "");
    assert.ok(!/EXECUTE\s+(format|v_sql|'|")/i.test(sql), "static SQL only");
    assert.ok(!/40001|serialization_failure/.test(sql), "no 40001 (a conflict is DO NOTHING, never a retry loop)");
  });
  it("the getter checks who is asking first and refuses anon", () => {
    const body = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.admin_book_call_lead_get("));
    const firstStatement = body.slice(body.indexOf("BEGIN") + 5).replace(/^\s*--.*$/gm, "").trim().split("\n")[0];
    assert.match(firstStatement, /IF NOT \(public\.is_admin_user\(\) OR COALESCE\(public\.admin_team_can\('beta_leads'\), false\)\) THEN/);
    assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.admin_book_call_lead_get\(uuid\) FROM PUBLIC, anon;/);
    assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.admin_inbound_leads\(boolean, integer\) FROM PUBLIC, anon;/);
  });
});
