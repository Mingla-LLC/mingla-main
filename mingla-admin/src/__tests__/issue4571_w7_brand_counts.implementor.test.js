// Issue #4571 W7 (a linked brand counts too, Seth's decision (d)) —
// implementor tests for Admin.
//
//   B-1  demoLocked reads the server's demo_gate.locked_stages: a brand-linked
//        host below the band is locked out of Demo booked only, so Onboarded
//        is offered; a host with neither link is locked out of all three; a
//        gate from before W7 (no locked_stages) still locks the whole band
//   B-2  moveBlocker gives the server's sentence for that stage (reasons)
//   B-3  the lock words beside a stage: Demo booked needs a demo; Onboarded
//        and Live need a demo or brand
//   B-4  the Needs linking note names the stage and, past Demo booked, the
//        brand; the card and the tile use these words, not the W4 sentence
//
// FAILS-ON-REVERT: on the W6d code demoLocked ignores locked_stages (B-1),
// moveBlocker ignores reasons (B-2), demoLockWords and needsLinkingWords do
// not exist (B-3, B-4) and RecordPanel still says "This card was in Demo
// booked before demos were linked".
//
// Run: node --test src/__tests__/issue4571_w7_brand_counts.implementor.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as crm from "../lib/crmModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

const HOSTS = {
  id: "hosts",
  stages: [
    { id: "prospect", label: "Prospect" }, { id: "contacted", label: "Contacted" }, { id: "replied", label: "Replied" },
    { id: "meeting", label: "Demo booked (Google Meet)" }, { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true }, { id: "lost", label: "Lost", terminal: true },
  ],
};
const ONBOARDED_WORDS = "Onboarded needs a demo booked through the scheduler and linked to this card, or the host's Mingla brand linked. Send the card's scheduler link, or link the brand on the card.";
const brandLinked = {
  stage: "replied",
  demo_gate: {
    locked: true, brand_linked: true, locked_stages: ["meeting"],
    reason: "Demo booked means a Google Meet booked through the scheduler and linked here. This host's Mingla brand is linked, so Onboarded is open.",
    reasons: { meeting: "Demo booked needs a Google Meet booked through the scheduler and linked to this card." },
  },
};
const noLinks = {
  stage: "replied",
  demo_gate: {
    locked: true, brand_linked: false, locked_stages: ["meeting", "onboarded", "live"],
    reason: "Demo booked means a Google Meet booked through the scheduler and linked here.",
    reasons: { meeting: "Demo booked needs a Google Meet.", onboarded: ONBOARDED_WORDS, live: "Live needs a demo or brand." },
  },
};

describe("B-1 the lock follows locked_stages", () => {
  it("a brand-linked host is locked out of Demo booked only", () => {
    assert.equal(crm.demoLocked(HOSTS, brandLinked, "meeting"), true);
    assert.equal(crm.demoLocked(HOSTS, brandLinked, "onboarded"), false);
    assert.equal(crm.moveBlocker(HOSTS, brandLinked, "onboarded"), null);
  });
  it("a host with neither link is locked out of all three", () => {
    for (const to of ["meeting", "onboarded", "live"]) assert.equal(crm.demoLocked(HOSTS, noLinks, to), true, to);
  });
  it("a gate from before W7 (no locked_stages) locks the whole band", () => {
    const old = { stage: "replied", demo_gate: { locked: true } };
    assert.equal(crm.demoLocked(HOSTS, old, "onboarded"), true);
    assert.equal(crm.demoLocked(HOSTS, { stage: "replied", demo_gate: { locked: false } }, "onboarded"), false);
  });
});

describe("B-2 the refusal is the server's sentence for that stage", () => {
  it("moveBlocker reads reasons[stage]", () => {
    const b = crm.moveBlocker(HOSTS, noLinks, "onboarded");
    assert.equal(b?.token, "demo_required");
    assert.equal(b?.message, ONBOARDED_WORDS);
    assert.equal(crm.moveBlocker(HOSTS, brandLinked, "meeting")?.message, brandLinked.demo_gate.reasons.meeting);
  });
});

describe("B-3 the words beside a locked stage", () => {
  it("Demo booked needs a demo; Onboarded and Live a demo or brand", () => {
    assert.equal(crm.demoLockWords("meeting"), "locked, needs a linked demo");
    assert.equal(crm.demoLockWords("onboarded"), "locked, needs a linked demo or brand");
    assert.equal(crm.demoLockWords("live"), "locked, needs a linked demo or brand");
  });
});

describe("B-4 Needs linking names the stage and the brand", () => {
  it("past Demo booked it names the brand", () => {
    assert.match(crm.needsLinkingWords({ stage: "onboarded" }), /^This card is in Onboarded with no booked demo or Mingla brand linked\./);
    assert.match(crm.needsLinkingWords({ stage: "live" }), /^This card is in Live with no booked demo or Mingla brand linked\./);
    assert.match(crm.needsLinkingWords({ stage: "meeting" }), /^This card is in Demo booked with no booked demo linked\./);
  });
  it("the card and the tile use these words", () => {
    const card = read("components/crm/RecordPanel.jsx");
    assert.match(card, /<b>Needs linking\.<\/b> \{needsLinkingWords\(record\)\}/);
    assert.doesNotMatch(card, /This card was in Demo booked before demos were linked/);
    assert.match(card, /o\.locked \? ` · \$\{demoLockWords\(o\.value\)\}` : ""/);
    const tile = read("components/crm/RecordCard.jsx");
    assert.match(tile, /needs a linked demo or the host's Mingla brand\. Open the card to book a demo or link the brand\./);
  });
});
