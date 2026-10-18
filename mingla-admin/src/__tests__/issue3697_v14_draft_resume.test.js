import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");

describe("#3697 Admin revisioned draft resume", () => {
  const builder = read("pages/CampaignBuilderPage.jsx");
  const service = read("services/adEngineService.js");

  it("autosaves every serializable field after one idle second", () => {
    assert.match(builder, /window\.setTimeout\(\(\) => \{/);
    assert.match(builder, /}, 1000\)/);
    assert.match(builder, /saveAdminAdPlanDraft/);
    assert.match(builder, /expected_revision: draftRevisionRef\.current/);
    assert.match(builder, /draft_state: \{ \.\.\.snapshot, active_step: step \}/);
    assert.match(builder, /file: null/);
    assert.match(builder, /Typed LAUNCH\/certification phrases are authorization/);
  });

  it("flushes on step navigation and keeps a stable deep link", () => {
    assert.match(builder, /replaceBuilderHash\(draftContextRef\.current\.id, nextStep\)/);
    assert.match(builder, /void persistDraft\(/);
    assert.match(builder, /params\.set\("draft", draftId\)/);
    assert.match(builder, /params\.set\("step", stepId\)/);
  });

  it("restores exact draft state and fails visibly on a device conflict", () => {
    assert.match(builder, /getAdminAdPlanDraft\(context\.id\)/);
    assert.match(builder, /setDestinations\(state\.destinations\)/);
    assert.match(builder, /setPreparationRows\(state\.preparation_rows\)/);
    assert.match(builder, /setPlanPreview\(state\.plan_preview\)/);
    assert.match(builder, /Newer draft found/);
    assert.match(builder, /Reload newer draft/);
    assert.match(service, /action: "get_draft"/);
    assert.match(service, /action: "save_draft"/);
  });
});
