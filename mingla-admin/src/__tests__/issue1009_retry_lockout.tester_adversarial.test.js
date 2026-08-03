/**
 * ISSUE-1009 [Campaign Builder partial-failure retry lockout] — independent
 * tester adversarial regression.
 *
 * This suite attacks completion's negative space: empty plans, creative-
 * excluded funded platforms, stale/foreign successes, legacy/composite key
 * mismatches, and every non-campaign outcome. It also loads the real
 * StepReview component through Vite and proves those incomplete states cannot
 * restore the old any-success button lockout.
 *
 * Run: node --test src/__tests__/issue1009_retry_lockout.tester_adversarial.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import {
  areAllExpectedCreatePairsSuccessful,
  expectedCreateResultKeys,
} from "../lib/adBuilder/createProgress.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");

const CURRENT_EVENT = { id: "event-current", page_type: "event" };
const CURRENT_BRAND = { id: "brand-current", page_type: "brand" };

let vite;
let StepReview;

before(async () => {
  vite = await createServer({
    root: ADMIN_ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ StepReview } = await vite.ssrLoadModule(
    "/src/components/campaign-builder/StepReview.jsx",
  ));
});

after(async () => {
  await vite?.close();
});

function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return textContent(node.props?.children);
}

function collectElements(node, elements = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!node || typeof node !== "object" || !node.props) return elements;
  elements.push(node);
  collectElements(node.props.children, elements);
  return elements;
}

function actionButton(tree, label) {
  return collectElements(tree).find(
    (element) => textContent(element.props.children) === label &&
      typeof element.props.onClick === "function",
  );
}

function reviewProps({
  createResults,
  allExpectedPairsSucceeded,
  onCreate = () => {},
  onValidateShapes = () => {},
}) {
  return {
    summary: {
      headline: "Ready to create",
      channels: [{
        platform: "meta",
        label: "Meta",
        dailyLabel: "$10.00/day",
        statusLine: "Paused",
        objectiveLabel: "Traffic",
      }],
      blocked: [],
      destinationLine: "Current plan",
      creativeLine: "1 image",
      copyLine: "Checked",
      warnings: [],
    },
    name: "Current plan",
    onNameChange() {},
    submitting: false,
    validatingShapes: false,
    createResults,
    allExpectedPairsSucceeded,
    onCreate,
    onValidateShapes,
    onJumpToStep() {},
  };
}

function completion({
  destinations = [CURRENT_EVENT],
  buildablePlatforms = ["meta"],
  createResults,
} = {}) {
  return areAllExpectedCreatePairsSuccessful({
    destinations,
    buildablePlatforms,
    createResults,
  });
}

describe("ISSUE-1009 · tester negative-space completion boundaries", () => {
  it("never treats an empty expected set as complete, even with foreign successes", () => {
    const foreignSuccess = { google: { campaign: { id: "foreign" } } };

    assert.equal(completion({
      destinations: [],
      createResults: foreignSuccess,
    }), false);
    assert.equal(completion({
      buildablePlatforms: [],
      createResults: foreignSuccess,
    }), false);
    assert.equal(areAllExpectedCreatePairsSuccessful(), false);
  });

  it("ignores creative-excluded funded platforms in both completion directions", () => {
    assert.equal(completion({
      buildablePlatforms: ["meta"],
      createResults: {
        meta: { campaign: { id: "meta-paused" } },
        google: { error: { message: "Excluded before create." } },
      },
    }), true, "an excluded funded Google row must not keep a completed Meta-only plan open");

    assert.equal(completion({
      buildablePlatforms: ["meta"],
      createResults: {
        google: { campaign: { id: "foreign-google-success" } },
      },
    }), false, "an excluded platform success must not complete the expected Meta pair");
  });

  it("rejects stale or foreign successes that are outside the current expected keys", () => {
    assert.equal(completion({
      createResults: {
        "meta::event:event-old": { campaign: { id: "stale-event" } },
        google: { campaign: { id: "foreign-platform" } },
      },
    }), false);
  });

  it("keeps single- and multi-destination key shapes strictly compatible", () => {
    assert.deepEqual(expectedCreateResultKeys({
      destinations: [CURRENT_EVENT],
      buildablePlatforms: ["meta"],
    }), ["meta"]);
    assert.equal(completion({
      createResults: {
        "meta::event:event-current": { campaign: { id: "wrong-single-shape" } },
      },
    }), false, "a composite key cannot complete the legacy single-destination shape");

    const destinations = [CURRENT_EVENT, CURRENT_BRAND];
    const buildablePlatforms = ["meta"];
    assert.deepEqual(expectedCreateResultKeys({
      destinations,
      buildablePlatforms,
    }), [
      "meta::event:event-current",
      "meta::brand:brand-current",
    ]);
    assert.equal(completion({
      destinations,
      buildablePlatforms,
      createResults: {
        meta: { campaign: { id: "wrong-multi-shape" } },
        "meta::event:event-current": { campaign: { id: "current-event" } },
      },
    }), false, "a bare key cannot stand in for a missing multi-destination pair");
  });

  it("keeps validated, no-dry-run, error, unknown, null, and missing outcomes retryable", () => {
    const retryableOutcomes = [
      { validated: true, validated_layers: ["campaign"] },
      { noPlatformValidate: true },
      { error: { code: "provider_error", message: "Retry." } },
      { status: "ready", detail: "Unknown non-campaign state." },
      null,
      undefined,
    ];

    for (const outcome of retryableOutcomes) {
      const createResults = outcome === undefined ? {} : { meta: outcome };
      assert.equal(completion({ createResults }), false);
    }
  });

  it("completes only when every current pair succeeds, regardless of foreign noise", () => {
    const destinations = [CURRENT_EVENT, CURRENT_BRAND];
    const buildablePlatforms = ["meta", "snapchat"];
    const createResults = Object.fromEntries(
      expectedCreateResultKeys({ destinations, buildablePlatforms }).map((key) => [
        key,
        { campaign: { id: `paused-${key}` } },
      ]),
    );
    createResults["meta::event:event-old"] = { campaign: { id: "stale" } };
    createResults.google = { validated: true };

    assert.equal(completion({
      destinations,
      buildablePlatforms,
      createResults,
    }), true);
  });
});

describe("ISSUE-1009 · real StepReview resists the old global-success lockout", () => {
  it("keeps both actions live for each incomplete terminal-looking result state", () => {
    const scenarios = [
      {
        label: "foreign success only",
        createResults: {
          google: { platform: "google", campaign: { id: "foreign-success" } },
        },
      },
      {
        label: "expected validation plus foreign success",
        createResults: {
          meta: { platform: "meta", validated: true },
          google: { platform: "google", campaign: { id: "foreign-success" } },
        },
      },
      {
        label: "expected no-dry-run plus foreign success",
        createResults: {
          meta: { platform: "meta", noPlatformValidate: true },
          google: { platform: "google", campaign: { id: "foreign-success" } },
        },
      },
      {
        label: "expected unknown state plus foreign success",
        createResults: {
          meta: { platform: "meta", status: "ready" },
          google: { platform: "google", campaign: { id: "foreign-success" } },
        },
      },
    ];

    for (const scenario of scenarios) {
      let createCalls = 0;
      let validateCalls = 0;
      const isComplete = completion({ createResults: scenario.createResults });
      assert.equal(isComplete, false, `${scenario.label} must remain incomplete`);

      const tree = StepReview(reviewProps({
        createResults: scenario.createResults,
        allExpectedPairsSucceeded: isComplete,
        onCreate: () => { createCalls += 1; },
        onValidateShapes: () => { validateCalls += 1; },
      }));
      const create = actionButton(tree, "Create campaign (paused)");
      const validate = actionButton(tree, "Validate shapes (nothing created)");

      assert.ok(create, `${scenario.label}: Create must render`);
      assert.ok(validate, `${scenario.label}: Validate must render`);
      assert.equal(create.props.disabled, false, `${scenario.label}: Create must stay enabled`);
      assert.equal(validate.props.disabled, false, `${scenario.label}: Validate must stay enabled`);
      create.props.onClick();
      validate.props.onClick();
      assert.equal(createCalls, 1, `${scenario.label}: Create callback must remain reachable`);
      assert.equal(validateCalls, 1, `${scenario.label}: Validate callback must remain reachable`);
    }
  });

  it("disables both actions once the exact current expected set is complete", () => {
    const createResults = {
      meta: { platform: "meta", campaign: { id: "current-meta" } },
      google: { platform: "google", validated: true },
    };
    const isComplete = completion({ createResults });
    assert.equal(isComplete, true);

    const tree = StepReview(reviewProps({
      createResults,
      allExpectedPairsSucceeded: isComplete,
    }));
    assert.equal(actionButton(tree, "Create campaign (paused)").props.disabled, true);
    assert.equal(actionButton(tree, "Validate shapes (nothing created)").props.disabled, true);
  });
});
