import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  audienceErrorCopy,
  audienceStatus,
  formatAudienceSize,
} from "../lib/adAudiencesModel.js";

describe("#3697 Ads audiences UI", () => {
  it("maps provider states and errors to operator language", () => {
    assert.deepEqual(audienceStatus("too_small"), {
      label: "Too small",
      variant: "warning",
    });
    assert.match(audienceErrorCopy({ error: "http_401 token invalid" }), /Reconnect/);
    assert.match(audienceErrorCopy({ error: "too few users" }), /1,000/);
    assert.equal(formatAudienceSize(null), "—");
  });

  it("adds the audience inventory to the one Ads workspace", () => {
    const page = readFileSync(new URL("../pages/AdEnginePage.jsx", import.meta.url), "utf8");
    const panel = readFileSync(
      new URL("../components/ad-engine/AdAudiencesPanel.jsx", import.meta.url),
      "utf8",
    );
    assert.match(page, /id: "audiences", label: "Audiences"/);
    assert.match(page, /shownTab === "audiences" && <AdAudiencesPanel/);
    assert.match(panel, /Off|are off/i);
    assert.match(panel, /Refresh now/);
    assert.match(panel, /Platform/);
    assert.match(panel, /Market/);
    assert.match(panel, /Brand/);
    assert.match(panel, /Event/);
  });
});
