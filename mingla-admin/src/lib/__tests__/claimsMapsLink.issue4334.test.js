// #4334 (tester D-2) — byte test of the claim review's Google Maps link.
// Fails on revert: drop `&query=` (the pre-#4334 link was query_place_id only).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { claimMapsUri, googleMapsPinUrl } from "../claimsMapsLink.js";
import { readFileSync } from "node:fs";

describe("claimMapsUri", () => {
  it("anchors by place id and always carries query (coordinates when known)", () => {
    assert.equal(
      claimMapsUri({ google_place_id: "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0", lat: 6.4325387, lng: 3.4236889, name: "Didi Museum" }),
      "https://www.google.com/maps/search/?api=1&query=6.4325387%2C3.4236889&query_place_id=ChIJ0Wq9hS_1OxARsFOw5qkW6Y0",
    );
  });
  it("without coordinates the query is the venue's name and address", () => {
    assert.equal(
      claimMapsUri({ google_place_id: "ChIJabc", name: "Didi Museum", address: "175 Akin Adesola St" }),
      "https://www.google.com/maps/search/?api=1&query=Didi%20Museum%2C%20175%20Akin%20Adesola%20St&query_place_id=ChIJabc",
    );
  });
  it("the pool's own Maps URI wins; no id and no URI → no link", () => {
    assert.equal(claimMapsUri({ place_pool: { google_maps_uri: "https://maps.google.com/?cid=1" }, google_place_id: "ChIJabc" }), "https://maps.google.com/?cid=1");
    assert.equal(claimMapsUri({ name: "x" }), null);
    assert.equal(claimMapsUri(null), null);
  });
});

// #4334 R3-1 — the venue change review's proposed-pin link carries the picked
// Google place id. Fails on revert: drop the `query_place_id` branch.
describe("googleMapsPinUrl (venue change review proposed pin)", () => {
  it("anchors the proposed pin on the picked Google place", () => {
    assert.equal(
      googleMapsPinUrl(6.4325, 3.4236, "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0"),
      "https://www.google.com/maps/search/?api=1&query=6.4325,3.4236&query_place_id=ChIJ0Wq9hS_1OxARsFOw5qkW6Y0",
    );
  });
  it("no id, a malformed id, or no pin: the old link or none", () => {
    assert.equal(
      googleMapsPinUrl(6.4325, 3.4236, null),
      "https://www.google.com/maps/search/?api=1&query=6.4325,3.4236",
    );
    assert.equal(
      googleMapsPinUrl(6.4325, 3.4236, "bad id!"),
      "https://www.google.com/maps/search/?api=1&query=6.4325,3.4236",
    );
    assert.equal(googleMapsPinUrl(null, 3.4, null), null);
  });
  it("the review link passes the request's place id (and the select reads it)", () => {
    const src = readFileSync(new URL("../../services/adminVenueDetailsChangeService.js", import.meta.url), "utf8");
    assert.match(src, /googleMapsPinUrl\(\s*request\?\.details_change_lat,\s*request\?\.details_change_lng,\s*request\?\.details_change_place_id,?\s*\)/);
    assert.match(src, /details_change_place_id,\n\s*details_change_requested_at/);
  });
});
