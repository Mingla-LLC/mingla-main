import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { canonicalVenuePriceLabel } from "../deckCardPreviewRules.js";

const page = readFileSync(
  new URL("../../pages/PlacePoolManagementPage.jsx", import.meta.url),
  "utf8",
);

describe("issue #1384 Admin discovery-price contract", () => {
  it("uses one atomic CAS RPC and does not retain the partial write sequence", () => {
    assert.match(page, /issue_1384_admin_update_place_and_discovery_range/);
    const handleSave = page.slice(
      page.indexOf("const handleSave"),
      page.indexOf("// META-ORCH-1009 Sub-D", page.indexOf("const handleSave")),
    );
    assert.equal(handleSave.includes('rpc("admin_edit_place"'), false);
    assert.equal(handleSave.includes('from("place_pool").update'), false);
  });

  it("requires a human reason and exposes canonical provenance", () => {
    assert.equal(page.includes("Audit reason (required)"), true);
    assert.match(page, /source_type/);
    assert.match(page, /updated_by/);
    assert.match(page, /actor_id/);
    assert.match(page, /p_expected_version/);
  });

  it("live venue preview ignores tiers and renders exact source money", () => {
    assert.equal(canonicalVenuePriceLabel({
      price_level: "PRICE_LEVEL_VERY_EXPENSIVE",
      price_tiers: [{}, {}, {}, {}],
    }), null);
    assert.match(canonicalVenuePriceLabel({
      source_min_minor: 125000,
      source_max_minor: 250000,
      source_currency_code: "NGN",
      source_minor_unit_exponent: 2,
    }), /NGN/);
  });
});
