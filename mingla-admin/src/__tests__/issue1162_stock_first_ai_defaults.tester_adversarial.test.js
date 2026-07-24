// ISSUE-1162 — tester-owned adversarial provenance guard.
//
// Different angle from the implementor suite: prove that the workflow cannot
// silently cross the Magnific permission boundary, that operators can still
// opt in deliberately at both admin entry points, and that only exact true
// survives the full upload → campaign → Meta disclosure chain.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

describe("ISSUE-1162 — adversarial stock-first permission and disclosure boundary", () => {
  it("the durable workflow forbids implicit generation and always terminates in Remotion", () => {
    const marketing = read("MARKETING.md");
    const paidAds = marketing.match(/### Paid ads pipeline([\s\S]*?)(?=\n### |\n## |\s*$)/)?.[1] ?? "";

    assert.match(paidAds, /Envato stock → Remotion\*\* by default/);
    assert.match(paidAds, /Seth manually downloads\/licenses/);
    assert.match(paidAds, /Magnific is opt-in only/);
    assert.match(paidAds, /solely when Seth\s+explicitly requests/);
    assert.match(paidAds, /then finish in Remotion/);
    assert.match(paidAds, /every ad is\s+assembled and rendered in Remotion/);
    assert.doesNotMatch(paidAds, /Production pipeline:\s*\*\*Higgsfield/);
    assert.match(paidAds, /Higgsfield, Seedance, and Soul are retired/);
  });

  it("both admin surfaces default false but retain a deliberate operator opt-in", () => {
    const builder = read("mingla-admin/src/pages/CampaignBuilderPage.jsx");
    const stepCreative = read("mingla-admin/src/components/campaign-builder/StepCreative.jsx");
    const engine = read("mingla-admin/src/pages/AdEnginePage.jsx");

    assert.match(builder, /aiGenerated:\s*false,/);
    assert.match(builder, /aiGenerated:\s*creative\.aiGenerated,/);
    assert.match(stepCreative, /checked=\{creative\.aiGenerated\}/);
    assert.match(stepCreative, /onChange=\{\(v\) => set\(\{ aiGenerated: v \}\)\}/);
    assert.match(stepCreative, /ai_generated:\s*creative\.aiGenerated,/);

    assert.match(engine, /ai_generated:\s*false,/);
    assert.match(engine, /ai_generated:\s*form\.ai_generated,/);
    assert.match(engine, /checked=\{form\.ai_generated\}/);
    assert.match(engine, /onChange=\{\(v\) => setField\("ai_generated"\)\(v\)\}/);
  });

  it("omission and malformed values cannot become generated while booleans survive unchanged", () => {
    const upload = read("supabase/functions/admin-ad-creative-upload/index.ts");
    const normalize = (value) => (typeof value === "boolean" ? value : false);

    assert.equal(normalize(undefined), false);
    assert.equal(normalize(null), false);
    assert.equal(normalize("true"), false);
    assert.equal(normalize(1), false);
    assert.equal(normalize(false), false);
    assert.equal(normalize(true), true);
    assert.match(
      upload,
      /const aiGenerated = typeof body\.ai_generated === "boolean" \? body\.ai_generated : false;/,
    );
    assert.match(upload, /ai_generated:\s*aiGenerated,/);
  });

  it("the terminal adapter only discloses the exact true that the campaign parser preserves", () => {
    const campaign = read("supabase/functions/admin-ad-create-campaign/index.ts");
    const meta = read("supabase/functions/_shared/meta.ts");

    assert.match(campaign, /aiGenerated:\s*creative\.ai_generated === true,/);
    assert.match(
      meta,
      /if \(input\.aiGenerated\) \{[\s\S]*?body\.self_ai_disclosure = "OPT_IN";[\s\S]*?\}/,
    );
    assert.doesNotMatch(meta, /self_ai_disclosure\s*=\s*"OPT_IN"[\s\S]*?else/);
  });
});
