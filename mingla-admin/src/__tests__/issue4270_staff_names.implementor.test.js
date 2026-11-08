// #4270 W7 follow-up: Mingla staff read by name, not "A teammate".
// Live check 2026-11-08: Seth's staff account carries seth@usemingla.com as its
// display name, so every staff line in Admin › Community › Brand groups read
// "A teammate". Staff names now follow the Work board's rule for an address
// (crm_display_name): "seth@usemingla.com" reads "Seth". Brand teammates keep
// the D-4 rule: an address never shows and never becomes a name.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_NAME_WORDS, personName, staffName } from "../lib/brandGroupInbox.js";

const panel = readFileSync(new URL("../components/community/BrandGroupsPanel.jsx", import.meta.url), "utf8");

describe("staffName: a Mingla staff name", () => {
  it("turns a work address into the name the Work board gives it", () => {
    assert.equal(staffName("seth@usemingla.com"), "Seth");
    assert.equal(staffName("  ada.obi@usemingla.com "), "Ada");
    assert.equal(staffName("kemi+ops@usemingla.com"), "Kemi");
  });
  it("keeps a real name as it is", () => {
    assert.equal(staffName("Seth Ogieva"), "Seth Ogieva");
    assert.equal(staffName("  Ada   Obi "), "Ada Obi");
  });
  it("never shows an address or a broken name", () => {
    for (const bad of ["", "   ", null, undefined, 42, "_x@usemingla.com", ".x@usemingla.com", "@usemingla.com", "a b@x.com", "<b>@x.com"]) {
      const out = staffName(bad);
      assert.equal(out.includes("@"), false, String(bad));
      assert.equal(out, NO_NAME_WORDS, String(bad));
    }
  });
  it("leaves the brand-teammate rule alone: an address is still hidden there", () => {
    assert.equal(personName("kim@ox.example"), NO_NAME_WORDS);
  });
});

describe("the panel uses staffName only for Mingla Support senders", () => {
  it("names staff senders through staffName in the name map and the staff list", () => {
    assert.match(panel, /m\.sender_role === "Mingla Support" && m\.sender_id && !names\.has\(m\.sender_id\)\) names\.set\(m\.sender_id, staffName\(m\.sender_display_name\)\)/);
    assert.match(panel, /sender_role === "Mingla Support" && m\.sender_display_name\)\.map\(\(m\) => staffName\(m\.sender_display_name\)\)/);
  });
  it("lets the People tab's brand names win over a staff name for the same user", () => {
    assert.match(panel, /new Map\(people\.rows\.map\(\(p\) => \[p\.user_id, p\.display_name\]\)\)/);
  });
});
