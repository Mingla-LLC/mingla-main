// ISSUE-1162 — stock-first creative provenance happy-path guard.
//
// Licensed stock plus Remotion is the default. Magnific is explicit opt-in, so
// omission must remain non-generated while an explicit true still reaches
// Meta's self-AI disclosure.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

describe("ISSUE-1162 — stock is the honest default and Magnific is opt-in", () => {
  it("both admin creative entry points default to non-generated", () => {
    const builder = read("mingla-admin/src/pages/CampaignBuilderPage.jsx");
    const engine = read("mingla-admin/src/pages/AdEnginePage.jsx");

    assert.match(builder, /aiGenerated:\s*false,/);
    assert.doesNotMatch(builder, /aiGenerated:\s*true,/);
    assert.match(engine, /ai_generated:\s*false,/);
    assert.doesNotMatch(engine, /ai_generated:\s*true,/);
  });

  it("creative upload maps omitted→false and preserves explicit false/true", () => {
    const upload = read("supabase/functions/admin-ad-creative-upload/index.ts");

    assert.match(
      upload,
      /const aiGenerated = typeof body\.ai_generated === "boolean" \? body\.ai_generated : false;/,
    );

    const normalize = (value) => (typeof value === "boolean" ? value : false);
    assert.equal(normalize(undefined), false);
    assert.equal(normalize(false), false);
    assert.equal(normalize(true), true);
  });

  it("explicit true still maps to Meta OPT_IN while false omits disclosure", () => {
    const meta = read("supabase/functions/_shared/meta.ts");

    assert.match(
      meta,
      /if \(input\.aiGenerated\) \{[\s\S]*?body\.self_ai_disclosure = "OPT_IN";[\s\S]*?\}/,
    );
    assert.doesNotMatch(meta, /self_ai_disclosure\s*=\s*"OPT_IN"[\s\S]*?else/);
  });

  it("the canonical marketing workflow requires Envato, explicit Magnific consent, and Remotion", () => {
    const marketing = read("MARKETING.md");

    assert.match(marketing, /Envato stock → Remotion/);
    assert.match(marketing, /Seth manually downloads\/licenses/);
    assert.match(marketing, /Magnific is opt-in only/);
    assert.match(marketing, /every ad is\s+assembled and rendered in Remotion/);
    assert.match(marketing, /Higgsfield, Seedance, and Soul are retired/);
  });
});
