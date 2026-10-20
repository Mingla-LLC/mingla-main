// MINGLA-INVARIANT: I-3697-SNAP-IMAGE-PREPARE-STEP | issue #3697 | Create and Resume run "Prepare the image for Snapchat" (admin-ad-creative-prepare) before "Create paused on Snapchat" whenever Snapchat runs an image creative; other platforms never get an image-prepare step
// MINGLA-INVARIANT: I-3697-CREATIVE-RECORDED-BEFORE-NEXT | issue #3697 | the Creative step's Next stays disabled until the creative is recorded to the library ("Use this creative"), so create never fails on creative_library_id_required
/**
 * Issue #3697 — a Mingla Snapchat image campaign failed at "Create paused on
 * Snapchat" (creative_not_uploaded) because nothing uploaded the image to
 * Snap first, and the Builder let Next through before the image was recorded.
 *
 * FAILS ON REVERT: drop the image branch from housePlanCreateSteps /
 * resumeAdminAdPlan / the Builder create, or the creativeRow Next gate.
 *
 * Run: node --test src/__tests__/issue3697_snap_image_prepare.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import {
  housePlanCreateSteps,
  housePlanNextAction,
  IMAGE_PREPARATION_PLATFORMS,
  preparationPlatformsFor,
  templatesCreativeKind,
} from "../lib/adBuilder/housePlanPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_HASH = "a286220176c586141d55df9d0861e141772e22db5e884e6f6508c9d7796399a3";
const CREATIVE_ID = "33333333-3333-4333-8333-333333333333";

describe("#3697 the image-prepare step is named for Snapchat only", () => {
  it("only Snapchat needs an uploaded image", () => {
    assert.deepEqual([...IMAGE_PREPARATION_PLATFORMS], ["snapchat"]);
    assert.deepEqual(
      preparationPlatformsFor({ platforms: ["meta", "snapchat", "tiktok"], kind: "image" }),
      ["snapchat"],
    );
    assert.deepEqual(
      preparationPlatformsFor({ platforms: ["meta", "snapchat"], kind: "video" }),
      ["meta", "snapchat"],
    );
    assert.deepEqual(preparationPlatformsFor({ platforms: ["snapchat"], kind: null }), []);
  });

  it("Create lists Prepare the image for Snapchat before Create paused on Snapchat", () => {
    const steps = housePlanCreateSteps({
      platforms: ["meta", "snapchat"],
      isImage: true,
    });
    const ids = steps.map((step) => step.id);
    assert.ok(ids.includes("prepare:snapchat"));
    assert.ok(!ids.includes("prepare:meta"), "Meta uses the hosted image");
    assert.ok(ids.indexOf("prepare:snapchat") < ids.indexOf("create:snapchat"));
    assert.equal(
      steps.find((step) => step.id === "prepare:snapchat").label,
      "Prepare the image for Snapchat",
    );
    const metaOnly = housePlanCreateSteps({ platforms: ["meta"], isImage: true });
    assert.ok(!metaOnly.some((step) => step.id.startsWith("prepare:")));
  });

  it("the recovery card says Resume will prepare the image first", () => {
    const next = housePlanNextAction({
      state: "creation_failed_retryable",
      platforms: ["snapchat"],
      createdPlatforms: [],
      isImage: true,
      sealed: true,
      hasFundingHold: true,
    });
    assert.equal(next.canResume, true);
    const prepare = next.steps.indexOf("prepare the image for Snapchat");
    const create = next.steps.indexOf("create paused on Snapchat");
    assert.ok(prepare >= 0 && create > prepare, next.steps.join(" | "));
  });

  it("a sealed image template reads as an image plan", () => {
    assert.equal(
      templatesCreativeKind({
        snapchat: { creative: { creative_library_id: CREATIVE_ID }, creative_intent: { kind: "image" } },
      }),
      "image",
    );
    assert.equal(
      templatesCreativeKind({ meta: { creative_intent: { kind: "video" } } }),
      "video",
    );
    assert.equal(templatesCreativeKind(null), null);
  });
});

describe("#3697 Resume on a failed Snapchat image plan prepares before it creates", () => {
  let vite;
  let service;
  const calls = [];

  before(async () => {
    vite = await createServer({
      root: ADMIN_ROOT,
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      server: { middlewareMode: true },
      plugins: [{
        name: "issue-3697-fake-supabase",
        enforce: "pre",
        resolveId(id) {
          return /(^|\/)lib\/supabase(\.js)?$/.test(id) ? "\0fake-supabase" : null;
        },
        load(id) {
          if (id !== "\0fake-supabase") return null;
          return "export const supabase = {};\n" +
            "export const invokeWithRefresh = (...args) => globalThis.__issue3697Invoke(...args);\n";
        },
      }],
    });
    service = await vite.ssrLoadModule("/src/services/adEngineService.js");
  });

  after(async () => {
    delete globalThis.__issue3697Invoke;
    await vite?.close();
  });

  function fakeBackend(platforms) {
    calls.length = 0;
    const templates = Object.fromEntries(platforms.map((platform) => [platform, {
      creative: { creative_library_id: CREATIVE_ID, headline: "Femzy" },
      creative_intent: { kind: "image", creative_library_id: CREATIVE_ID },
    }]));
    const aggregate = {
      plan: { id: "plan-1", owner_kind: "mingla", state: "creation_failed_retryable" },
      version: {
        id: VERSION_ID,
        plan_hash: PLAN_HASH,
        canonical_plan: { creative_library_id: CREATIVE_ID, lane: "consumer", execution_payloads: templates },
      },
      provider_allocations: platforms.map((platform) => ({ platform })),
      campaigns: [],
    };
    const prepared = new Set();
    globalThis.__issue3697Invoke = (fn, { body }) => {
      calls.push({ fn, body });
      if (fn === "ad-plan") return Promise.resolve({ data: aggregate, error: null });
      if (fn === "admin-ad-creative-prepare") {
        if (body.action === "start") prepared.add(body.platform);
        return Promise.resolve({
          data: {
            platform: body.platform,
            state: prepared.has(body.platform) ? "ready" : "not_started",
          },
          error: null,
        });
      }
      if (fn === "admin-ad-create-campaign") {
        return Promise.resolve({ data: { campaign: { id: "c-1" } }, error: null });
      }
      throw new Error(`unexpected invoke ${fn}`);
    };
  }

  it("runs status → start on Snapchat, then the paused create", async () => {
    fakeBackend(["snapchat"]);
    const steps = [];
    await service.resumeAdminAdPlan("plan-1", {
      onStep: (id, state) => steps.push(`${id}:${state}`),
    });
    const prepareCalls = calls.filter((call) => call.fn === "admin-ad-creative-prepare");
    assert.deepEqual(prepareCalls.map((call) => call.body.action), ["status", "start"]);
    for (const call of prepareCalls) {
      assert.equal(call.body.platform, "snapchat");
      assert.equal(call.body.creative_library_id, CREATIVE_ID);
      assert.equal(call.body.lane, "consumer");
      assert.equal(call.body.plan_version_id, VERSION_ID);
      assert.equal(call.body.plan_hash, PLAN_HASH);
    }
    const firstPrepare = calls.findIndex((call) => call.fn === "admin-ad-creative-prepare");
    const create = calls.findIndex((call) => call.fn === "admin-ad-create-campaign");
    assert.ok(firstPrepare >= 0 && create > firstPrepare, "prepare must precede create");
    assert.ok(steps.includes("prepare:snapchat:done"));
    assert.ok(steps.indexOf("prepare:snapchat:done") < steps.indexOf("create:snapchat:running"));
  });

  it("a Meta-only image plan never calls image preparation", async () => {
    fakeBackend(["meta"]);
    await service.resumeAdminAdPlan("plan-1", {});
    assert.equal(calls.filter((call) => call.fn === "admin-ad-creative-prepare").length, 0);
    assert.equal(calls.filter((call) => call.fn === "admin-ad-create-campaign").length, 1);
  });
});

describe("#3697 the Builder create path and the Creative Next gate", () => {
  const page = SRC("pages/CampaignBuilderPage.jsx");
  const campaigns = SRC("pages/CampaignsPage.jsx");

  it("Create builds the image step and prepares the image platforms", () => {
    assert.match(page, /isImage: creative\.kind === "image"/);
    assert.match(page, /preparationPlatformsFor\(\{/);
    assert.match(page, /if \(preparePlatforms\.length > 0\) \{\s*try \{\s*await prepareBoundVideoCreative\(\{/);
    assert.match(page, /platforms: preparePlatforms,\s*noun: creative\.kind,/);
  });

  it("the Campaigns recovery card and Resume steps know an image plan", () => {
    assert.match(campaigns, /templatesCreativeKind\(templates\)/);
    assert.match(campaigns, /isImage: facts\.isImage/);
  });

  it("Next on Creative waits for Use this creative", () => {
    const creativeCase = page.slice(
      page.indexOf('case "creative": {'),
      page.indexOf("const nextDisabledReason"),
    );
    assert.match(creativeCase, /if \(!creative\.creativeRow\) return false;/);
    assert.match(
      page,
      /if \(!creative\.creativeRow\) \{\s*return "Press “Use this creative” to record it to the library before continuing\.";/,
    );
  });
});
