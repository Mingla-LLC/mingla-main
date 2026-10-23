import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("#3697 Creative Library campaign metadata", () => {
  it("shows audio and campaign tags, with an edit action", () => {
    const card = read("../components/ad-engine/CreativeCard.jsx");
    assert.match(card, /creative\.has_audio === true \? "Audio" : "No audio"/);
    assert.match(card, /creative\.stage_tags/);
    assert.match(card, /Concept:/);
    assert.match(card, /Hook:/);
    assert.match(card, /Edit campaign tags/);
  });

  it("sends tag edits through the governed ad-plan action", () => {
    const page = read("../pages/AdEnginePage.jsx");
    const service = read("../services/adEngineService.js");
    assert.match(page, /updateAdCreativeTags\(tagTarget\.id/);
    assert.match(page, /Auto-archive after/);
    assert.match(service, /action: "creative_update_tags"/);
    assert.match(service, /licence_reference: tags\.licenceReference/);
  });
});
