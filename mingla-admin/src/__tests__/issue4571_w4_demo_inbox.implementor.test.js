// Issue #4571 W4 (demo bookings and the Demo booked stage rule) — implementor
// tests for Admin.
//
//   D-1  the card's scheduler link is usemingla.com/schedule?for=<token>, only
//        for a real token; Book a demo opens it in a new tab
//   D-2  suggestion reasons read as a person says them ("You called them 12
//        minutes before"); never an email or a phone
//   D-3  the inbox view never invents a list; the banner words follow the count
//   D-4  the Calendar chip and panel carry Needs linking and the linked card
//   D-5  Demos to link sits on Leads (#/inbound) with Confirm, Pick another
//        host, Create host card and Not a host; the banner sits on Hosts; the
//        seven new RPCs live only in the one crm service; no typed date field
//   D-6  the new server refusals have words (booking_linked, demo_in_use)
//
// FAILS-ON-REVERT: on W3 demoLinkModel.js, DemosToLink.jsx, DemosBanner.jsx
// and the crm_demo_* service calls do not exist.
//
// Run: node --test src/__tests__/issue4571_w4_demo_inbox.implementor.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bannerWords, demoStatusWords, inboxView, linkSourceWords, reasonWords, schedulerLink } from "../components/leads/demoLinkModel.js";
import { callEntriesOn, callView } from "../lib/calendarCalls.js";
import { errorCopy } from "../lib/crmModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const TOKEN = "3f1c2b8e-9a47-4d1e-b6a2-0c9e7d5f4a31";

describe("D-1 the card's scheduler link", () => {
  it("is usemingla.com/schedule?for=<token>", () => {
    assert.equal(schedulerLink(TOKEN), `https://usemingla.com/schedule?for=${TOKEN}`);
    assert.equal(schedulerLink(TOKEN.toUpperCase()), `https://usemingla.com/schedule?for=${TOKEN}`);
  });
  it("is nothing without a real token", () => {
    for (const bad of [null, undefined, "", "abc", 12, `${TOKEN}&x=1`]) assert.equal(schedulerLink(bad), null, String(bad));
  });
  it("Book a demo opens it in a new tab; Copy scheduler link toasts a failed copy", () => {
    const src = read("components/crm/RecordPanel.jsx");
    assert.match(src, /<a href=\{link\} target="_blank" rel="noopener noreferrer" data-book-demo=""/);
    assert.match(src, /navigator\.clipboard\.writeText\(link\)/);
    assert.match(src, /Couldn't copy the link/);
    assert.match(src, /scheduleToken=\{current\.data\?\.schedule_token\}/);
  });
});

describe("D-2 why a card is suggested", () => {
  it("names the viewer's own call with minutes before or after", () => {
    assert.equal(reasonWords({ reason: "your_call", minutes_before: 12 }), "You called them 12 minutes before");
    assert.equal(reasonWords({ reason: "your_call", minutes_before: 1 }), "You called them 1 minute before");
    assert.equal(reasonWords({ reason: "your_call", minutes_before: -15 }), "You called them 15 minutes after");
    assert.equal(reasonWords({ reason: "your_call", minutes_before: 0 }), "You called them as it was booked");
  });
  it("says email, phone or venue without showing them", () => {
    assert.equal(reasonWords({ reason: "email" }), "Same email as this card");
    assert.equal(reasonWords({ reason: "phone" }), "Same phone as this card");
    assert.equal(reasonWords({ reason: "venue_name" }), "Same name as the venue they gave");
    assert.equal(reasonWords({ reason: "other" }), "");
    assert.equal(reasonWords(null), "");
  });
  it("names how a demo was linked and its state", () => {
    assert.equal(linkSourceWords("card_link"), "Booked through the card's link");
    assert.equal(linkSourceWords("nope"), "");
    assert.equal(demoStatusWords("cancelled"), "Demo cancelled");
    assert.equal(demoStatusWords("moved"), "Demo moved");
    assert.equal(demoStatusWords("booked"), "Demo booked");
  });
});

describe("D-3 the inbox and the banner", () => {
  it("never invents a list", () => {
    assert.deepEqual(inboxView(null), { needsLinking: [], withoutDemo: [], cancelled: [], count: 0 });
    assert.equal(inboxView({ needs_linking: [{}, {}], count: 2 }).count, 2);
    assert.equal(inboxView({ needs_linking: [{}] }).count, 1);
  });
  it("the banner follows the count and is silent at zero", () => {
    assert.equal(bannerWords(0), "");
    assert.equal(bannerWords(null), "");
    assert.equal(bannerWords(1), "1 booked demo is not linked to a host card");
    assert.equal(bannerWords(3), "3 booked demos are not linked to a host card");
  });
});

describe("D-4 the Calendar", () => {
  const call = { id: "b1", audience: "host", name: "Ngozi Bello", call_at: "2026-11-24T13:00:00Z", status: "booked", needs_linking: true, record: null };
  it("a chip carries Needs linking", () => {
    const [e] = callEntriesOn("2026-11-24", [call], "UTC");
    assert.equal(e.needsLinking, true);
    const [linked] = callEntriesOn("2026-11-24", [{ ...call, needs_linking: false, record: { id: "r1", name: "Vault" } }], "UTC");
    assert.equal(linked.needsLinking, false);
  });
  it("the panel names the linked card, or says it needs linking", () => {
    assert.deepEqual(callView({ ...call, needs_linking: false, record: { id: "r1", name: "Vault" } }, "UTC").record, { id: "r1", name: "Vault" });
    const v = callView(call, "UTC");
    assert.equal(v.record, null);
    assert.equal(v.needsLinking, true);
    const page = read("pages/ContentCalendarPage.jsx");
    assert.match(page, /data-call-needs-linking=""/);
    assert.match(page, /#\/hosts\?card=/);
  });
});

describe("D-5 where it lives", () => {
  it("Demos to link is on Leads with its four decisions", () => {
    assert.match(read("pages/InboundLeadsPage.jsx"), /\{canLinkDemos && <DemosToLink \/>\}/);
    const c = read("components/leads/DemosToLink.jsx");
    for (const words of ["Confirm: ", "Pick another host", "Create host card", "Not a host", "Demo booked without a linked demo", "Demos cancelled"]) {
      assert.ok(c.includes(words), words);
    }
    assert.match(c, /demoLink\(b\.booking_id, recordId, what === "pick" \? "picked" : "confirmed_suggestion"\)/);
    assert.ok(!/email|phone/i.test(c.replace(/\/\/.*$/gm, "").replace(/No email or phone/g, "")), "the list never renders an email or a phone");
  });
  it("the banner is on the Hosts board only and a failed count is said, not zero", () => {
    assert.match(read("pages/PipelinePage.jsx"), /\{pipeline === "hosts" && online && <DemosBanner \/>\}/);
    const b = read("components/leads/DemosBanner.jsx");
    assert.match(b, /Couldn't check for booked demos that need linking/);
    assert.match(b, /href="#\/inbound"/);
  });
  it("the seven new RPCs are called from the one crm service only", () => {
    const svc = read("services/crmService.js");
    for (const fn of ["crm_demo_inbox", "crm_demo_inbox_count", "crm_demo_suggestions", "crm_demo_link", "crm_demo_create_record", "crm_demo_not_a_host", "crm_demo_unlink"]) {
      assert.ok(svc.includes(`"${fn}"`), fn);
    }
    for (const f of ["components/leads/DemosToLink.jsx", "components/leads/DemosBanner.jsx", "components/crm/RecordPanel.jsx", "pages/ContentCalendarPage.jsx"]) {
      assert.ok(!/supabase\.rpc\(\s*["']crm_demo/.test(read(f)), f);
      assert.ok(!/type="date"/.test(read(f)), `${f}: no typed date field`);
    }
  });
});

describe("D-6 the new refusals have words", () => {
  it("shows the server's sentence for a booking already linked and a demo in use", () => {
    const s = "This demo is already linked to Token Terrace. Unlink it there first.";
    assert.equal(errorCopy("booking_linked", s), s);
    const u = "Token Terrace is in Demo booked (Google Meet) on this demo. Move the card back first, then unlink the demo.";
    assert.equal(errorCopy("demo_in_use", u), u);
  });
});
