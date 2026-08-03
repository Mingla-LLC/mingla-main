import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminDiscoveryRangeErrorMessage,
  buildAdminDiscoveryRangeUpdate,
} from "../deckCardPreviewRules.js";

const place = {
  id: "place-1",
  place_discovery_price_ranges: {
    status: "active",
    version: 9,
  },
};
const baseForm = {
  name: "Venue",
  price_tiers: [],
  is_active: true,
  ai_categories: ["restaurant"],
  discovery_min_minor: "20000",
  discovery_max_minor: "50000",
  discovery_edit_reason: "Corrected from venue receipt",
};

describe("issue #1384 executable Admin edit flow", () => {
  it("blocks missing reasons and invalid ranges before any RPC payload exists", () => {
    assert.deepEqual(buildAdminDiscoveryRangeUpdate({
      place,
      editForm: { ...baseForm, discovery_edit_reason: " " },
      requestId: "request-1",
    }), {
      ok: false,
      code: "admin_reason_required",
      message: "Enter a human-readable audit reason before saving.",
    });
    assert.equal(buildAdminDiscoveryRangeUpdate({
      place,
      editForm: {
        ...baseForm,
        discovery_min_minor: "50001",
        discovery_max_minor: "50000",
      },
      requestId: "request-1",
    }).code, "invalid_range");
  });

  it("builds one reasoned CAS payload with actor request identity", () => {
    assert.deepEqual(buildAdminDiscoveryRangeUpdate({
      place,
      editForm: baseForm,
      requestId: "request-1",
    }), {
      ok: true,
      params: {
        p_place_pool_id: "place-1",
        p_name: "Venue",
        p_price_tier: null,
        p_price_tiers: [],
        p_is_active: true,
        p_ai_categories: ["restaurant"],
        p_source_min_minor: 20000,
        p_source_max_minor: 50000,
        p_expected_version: 9,
        p_actor_reason: "Corrected from venue receipt",
        p_request_id: "request-1",
      },
    });
  });

  it("turns a CAS conflict into an actionable revision reload message", () => {
    assert.match(
      adminDiscoveryRangeErrorMessage({
        message: "rpc: range_version_conflict",
      }),
      /Reload.*latest revision/,
    );
  });
});
