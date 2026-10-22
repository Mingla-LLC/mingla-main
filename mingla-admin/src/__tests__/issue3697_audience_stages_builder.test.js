import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  stageSplitLabels,
  validateAudience,
} from "../lib/adBuilder/audienceRules.js";
import { platformsForGoal, visibleGoals } from "../lib/adBuilder/goals.js";

describe("#3697 staged campaign builder", () => {
  it("shows the paid-social retargeting shortcut", () => {
    const goal = visibleGoals().find((row) => row.id === "retargeting");
    assert.ok(goal);
    assert.deepEqual(platformsForGoal("retargeting").sort(), [
      "meta",
      "snapchat",
      "tiktok",
    ]);
  });

  it("requires at least one stage", () => {
    const errors = validateAudience({
      countries: ["US"],
      ageMin: 18,
      ageMax: 65,
      stages: { prospecting: false, retarget: false, abandoners: false },
    });
    assert.match(errors.join(" "), /at least one audience stage/i);
  });

  it("shows a truthful split when the retargeting shortcut turns prospecting off", () => {
    assert.deepEqual(
      stageSplitLabels({
        prospecting: false,
        retarget: true,
        abandoners: true,
      }),
      { prospecting: "Off", retarget: "67%", abandoners: "33%" },
    );
    assert.deepEqual(
      stageSplitLabels({
        prospecting: false,
        retarget: true,
        abandoners: false,
      }),
      { prospecting: "Off", retarget: "100%", abandoners: "Off" },
    );
  });

  it("stores stage selection on the immutable plan and locks buyer exclusion", () => {
    const page = readFileSync(
      new URL("../pages/CampaignBuilderPage.jsx", import.meta.url),
      "utf8",
    );
    const audience = readFileSync(
      new URL(
        "../components/campaign-builder/StepAudience.jsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(page, /stage_selection: audience\.stages/);
    assert.match(
      page,
      /prospecting: false,[\s\S]*retarget: true,[\s\S]*abandoners: true/,
    );
    assert.deepEqual(stageSplitLabels(), {
      prospecting: "70%",
      retarget: "20%",
      abandoners: "10%",
    });
    assert.match(audience, /stageSplitLabels\(stages\)/);
    assert.match(audience, /Exclude people who already bought/);
    assert.match(audience, /Locked on every stage and platform/);
  });
});
