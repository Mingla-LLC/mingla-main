import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("#3697 Admin Creative Library", () => {
  const page = read("pages/AdEnginePage.jsx");
  const builder = read("pages/CampaignBuilderPage.jsx");
  const service = read("services/adEngineService.js");
  const preview = read("components/campaign-builder/AdPreview.jsx");
  const preparationPanel = read(
    "components/campaign-builder/VideoPreparationPanel.jsx",
  );
  const preparation = read("lib/adBuilder/preparationState.js");

  it("loads the server-safe inventory and presents operational truth", () => {
    assert.match(service, /action: "creative_library"/);
    assert.match(page, /Provider copies/);
    assert.match(page, /Campaign use/);
    assert.match(page, /Rights confirmed/);
    assert.match(page, /Placement fit pending/);
    assert.match(page, /PROCESSING_LABEL/);
  });

  it("makes Reuse a real, rights-gated builder handoff", () => {
    assert.match(page, /step=creative&creative=/);
    assert.match(service, /action: "creative_reuse"/);
    assert.match(builder, /getAdCreativeForReuse\(creativePresetId\)/);
    assert.match(builder, /creativeUpload\(validationPayload\)/);
    assert.match(builder, /rightsConfirmed: false/);
    assert.match(builder, /Creative selected from the library/);
  });

  it("describes every wired video-create path without obsolete Phase A copy", () => {
    assert.doesNotMatch(preview, /video creation is not in Phase A/i);
    assert.doesNotMatch(preparationPanel, /no Phase A video create|video create not in Phase A/i);
    assert.match(preparationPanel, /Video is ready for every selected platform/);
    assert.match(preview, /eligible for paused creation/);
    assert.match(preparation, /platform === "google"[\s\S]*create_and_approx_preview/);
    assert.match(preparation, /create_and_real_preview/);
  });
});
