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
    // Issue #2113 EMPTY-WINDOW GUARD. The window above terminates on the
    // `// META-ORCH-1009 Sub-D` COMMENT. ADDING that comment as handleSave's first
    // line collapses the window to "", and `"".includes(x) === false` satisfies
    // both negative assertions below — proven 3/3 green with the banned partial
    // write (`from("place_pool").update` + `rpc("admin_edit_place")`) as the
    // function's very first statement. These two assertions make the collapse
    // itself a failure and pin the window to the real CAS body.
    assert.ok(
      handleSave.length > 400 && handleSave.length < 4000,
      `handleSave window collapsed or ran away (${handleSave.length} chars) — the "// META-ORCH-1009 Sub-D" boundary comment moved, or one was added inside handleSave`,
    );
    assert.match(handleSave, /buildAdminDiscoveryRangeUpdate\(\{/, "the window must contain the real atomic CAS builder");
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
