// ISSUE-979 Bug 2 [Campaign Builder correctness] — FALSE "Created" TOAST.
//
// The bug: runCreate treated any response that was not truthy-`validated` as a
// create success. TikTok/Snap/Reddit have NO validate-only mode and return
// { validated: false, skipped_layers: [...] } to a validate_only call — nothing
// was created or validated. The old code fired "Created on <platform>. Nothing
// is spending yet." for that response.
//
// The fix (createResult.js classifyCreateResult): success is ONLY
// `validated === true` (a real dry-run) OR the presence of a `campaign` object
// (a real create). Everything else is the honest "nothing happened" state — no
// "Created" toast.
//
// FAILS-ON-REVERT: deleting the campaign-presence branch in classifyCreateResult
// drops the "created" outcome (the created test fails); the source assertion
// greps CampaignBuilderPage for the classifier and the absence of the old
// truthy `else if (data?.validated)` toast path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyCreateResult } from "../lib/adBuilder/createResult.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

describe("ISSUE-979 Bug 2 — classifyCreateResult only calls success what actually happened", () => {
  it("Meta/Google validate_only (validated:true) → validated, NO created toast", () => {
    const r = classifyCreateResult({ validated: true, validated_layers: ["campaign", "ad_set", "creative"], skipped_layers: [] });
    assert.equal(r.outcome, "validated");
    assert.equal(r.showCreatedToast, false);
    assert.deepEqual(r.validatedLayers, ["campaign", "ad_set", "creative"]);
  });

  it("THE BUG: TikTok/Snap/Reddit validate_only (validated:false) → NOT created, NO toast", () => {
    for (const detail of ["tiktok_no_validate_only", "snapchat_no_validate_only", "reddit_no_validate_only"]) {
      const r = classifyCreateResult({ validated: false, validated_layers: [], skipped_layers: [{ layer: "campaign" }], detail });
      assert.equal(r.outcome, "novalidate", `${detail} must not be a create`);
      assert.equal(r.showCreatedToast, false, `${detail} must NOT fire a "Created" toast`);
      assert.equal(r.campaign, null);
      assert.equal(r.detail, detail);
    }
  });

  it("a real created object → created, WITH the toast", () => {
    const r = classifyCreateResult({ campaign: { id: "camp_123" } });
    assert.equal(r.outcome, "created");
    assert.equal(r.showCreatedToast, true);
    assert.deepEqual(r.campaign, { id: "camp_123" });
  });

  it("empty / null / undefined responses are the honest no-op state, never created", () => {
    for (const data of [{}, null, undefined]) {
      const r = classifyCreateResult(data);
      assert.equal(r.outcome, "novalidate");
      assert.equal(r.showCreatedToast, false);
    }
  });

  it("a validated:false response that ALSO has no campaign is never mislabeled created", () => {
    // The precise shape the false-toast bug mishandled.
    const r = classifyCreateResult({ validated: false, skipped_layers: [{ layer: "ad_set" }] });
    assert.notEqual(r.outcome, "created");
    assert.equal(r.showCreatedToast, false);
  });
});

describe("ISSUE-979 Bug 2 — call site wired to the classifier (fails-on-revert)", () => {
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
  const review = read(path.join(ADMIN_SRC, "components/campaign-builder/StepReview.jsx"));

  it("runCreate classifies the response instead of the old truthy-validated branch", () => {
    assert.ok(page.includes("classifyCreateResult"), "runCreate must classify the response honestly");
    assert.ok(
      !page.includes("} else if (data?.validated) {"),
      "the old truthy `else if (data?.validated)` toast path must be gone",
    );
  });

  it('the "Created" toast fires only inside the created branch', () => {
    // The success toast text must sit under the created outcome, never a blanket else.
    assert.ok(page.includes('outcome.outcome === "created"'), "the created toast must be gated on the created outcome");
    assert.ok(page.includes("noPlatformValidate"), "the honest no-dry-run state must be recorded");
  });

  it("StepReview renders the honest no-dry-run state", () => {
    assert.ok(review.includes("noPlatformValidate"), "Review must surface the honest state, not swallow it");
  });
});
