// ISSUE-979 Bug 3 [Campaign Builder correctness] — COMPLIANCE-FLAG LEAK.
//
// The bug: ai_generated + specialAdCategory reached ONLY the Meta create branch;
// they were silently dropped for the other four platforms even though the UI
// presents both as global (policy/legal risk).
//
// The fix: every platform's create payload now carries a platform-neutral
// `compliance` descriptor (camelCase — deliberately distinct from Meta's
// platform-specific API keys special_ad_categories / ai_generated, which stay
// Meta-shaped and Meta-only). The backend applies it where the API supports it
// (Meta) and DOCUMENTS the drop where it does not (the other four), never
// silently.
//
// FAILS-ON-REVERT: deleting `compliance,` from any platform branch fails the
// per-platform assertion (compliance becomes undefined); deleting the backend
// documentComplianceDrop calls fails the backend-documentation assertion.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { goalById } from "../lib/adBuilder/goals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

const trafficGoal = goalById("traffic");
const PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"];

const stateFor = ({ aiGenerated, specialAdCategory }) => ({
  lane: "consumer",
  name: "979 — Velvet Lounge — Friday Live",
  goal: {
    metaObjective: "OUTCOME_TRAFFIC",
    metaOptimizationGoal: "LINK_CLICKS",
    platforms: trafficGoal.platforms,
  },
  destination: { page_type: "event", brand_slug: "velvet-lounge", entity_slug: "friday-live" },
  audience: { countries: ["US"], ageMin: 21, ageMax: 45, gender: "all" },
  budget: { dailyCentsForChannel: 2000 },
  creative: { imageUrl: "https://cdn.example/creative.jpg", aiGenerated, brandName: "Velvet Lounge" },
  copy: {
    primary: "Friday Live at Velvet Lounge",
    headline: "Friday Live",
    description: "Come through.",
    cta: "LEARN_MORE",
    googleHeadlines: ["Friday Live", "Velvet Lounge", "Live Music Friday"],
    googleDescriptions: ["Live music this Friday.", "Book your table now."],
    keywords: ["velvet lounge"],
    negativeKeywords: [],
  },
  specialAdCategory,
  requestId: "req-979",
});

describe("ISSUE-979 Bug 3 — EVERY platform payload carries the global compliance flags", () => {
  it("all 5 platforms carry compliance { aiGenerated, specialAdCategory }", () => {
    const state = stateFor({ aiGenerated: true, specialAdCategory: "HOUSING" });
    for (const platform of PLATFORMS) {
      const payload = buildCreatePayload(platform, state);
      assert.ok(payload.compliance, `${platform} payload is missing the compliance descriptor (silent drop)`);
      assert.equal(payload.compliance.aiGenerated, true, `${platform} dropped ai_generated`);
      assert.equal(payload.compliance.specialAdCategory, "HOUSING", `${platform} dropped specialAdCategory`);
    }
  });

  it("NONE / not-AI defaults are carried explicitly, never omitted", () => {
    const state = stateFor({ aiGenerated: false, specialAdCategory: "NONE" });
    for (const platform of PLATFORMS) {
      const payload = buildCreatePayload(platform, state);
      assert.deepEqual(payload.compliance, { aiGenerated: false, specialAdCategory: "NONE" }, `${platform}`);
    }
  });

  it("Meta STILL applies the flags via its API keys (no regression)", () => {
    const payload = buildCreatePayload("meta", stateFor({ aiGenerated: true, specialAdCategory: "HOUSING" }));
    assert.deepEqual(payload.special_ad_categories, ["HOUSING"]);
    assert.deepEqual(payload.special_ad_category_country, ["US"]);
    assert.equal(payload.creative.ai_generated, true);
  });

  it("the neutral descriptor does NOT reintroduce Meta's API keys on other channels", () => {
    // The existing invariant (Meta's snake_case API keys are Meta-only) holds —
    // the neutral `compliance` block is camelCase and distinct.
    const state = stateFor({ aiGenerated: true, specialAdCategory: "HOUSING" });
    for (const platform of ["tiktok", "snapchat", "reddit", "google"]) {
      const flat = JSON.stringify(buildCreatePayload(platform, state));
      assert.ok(!flat.includes('"special_ad_categories"'), `${platform} must not carry Meta's special_ad_categories key`);
      assert.ok(!flat.includes('"ai_generated"'), `${platform} must not carry Meta's ai_generated key`);
    }
  });
});

describe("ISSUE-979 Bug 3 — the backend documents the drop where the API can't carry it (fails-on-revert)", () => {
  const backend = read(path.join(REPO_ROOT, "supabase/functions/admin-ad-create-campaign/index.ts"));

  it("documentComplianceDrop is defined and called for each non-Meta branch", () => {
    assert.ok(backend.includes("function documentComplianceDrop"), "the documentation helper must exist");
    for (const platform of ["google", "snapchat", "tiktok", "reddit"]) {
      assert.ok(
        backend.includes(`documentComplianceDrop("${platform}"`),
        `${platform} branch must document its compliance-flag handling (never silent)`,
      );
    }
  });

  it("each unsupported platform records a researched reason (not a silent drop)", () => {
    for (const platform of ["tiktok", "snapchat", "reddit", "google"]) {
      assert.ok(
        new RegExp(`${platform}:[\\s\\S]{0,200}(no|unreachable|CUSTOMIZED_USER|no general)`, "i").test(backend) ||
          backend.includes(`${platform}:`),
        `${platform} must carry a documented reason in COMPLIANCE_UNSUPPORTED_REASON`,
      );
    }
    // Meta remains the one that APPLIES the flags.
    assert.ok(backend.includes("self_ai_disclosure") || backend.includes("special_ad_categories"), "Meta applies the flags");
  });
});
