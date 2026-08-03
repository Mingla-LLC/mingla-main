/**
 * ISSUE-1009 [Campaign Builder partial-failure retry lockout] — implementor
 * happy-path regression.
 *
 * This suite proves the parent derives completion from the current
 * destinations × creative-buildable platforms, a mixed success/error result
 * keeps both Review actions usable, and the real StepReview component reaches
 * its existing callbacks without creating any provider object.
 *
 * Run: node --test src/__tests__/issue1009_retry_lockout.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import {
  areAllExpectedCreatePairsSuccessful,
  expectedCreateResultKeys,
} from "../lib/adBuilder/createProgress.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) => readFileSync(resolve(__dirname, "..", relativePath), "utf8");

const EVENT = { id: "event-1", page_type: "event" };
const BRAND = { id: "brand-1", page_type: "brand" };

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

function reviewProps(overrides = {}) {
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
      destinationLine: "Friday Live",
      creativeLine: "1 image",
      copyLine: "Checked",
      warnings: [],
    },
    name: "Friday Live",
    onNameChange() {},
    submitting: false,
    validatingShapes: false,
    createResults: {
      meta: {
        platform: "meta",
        campaign: { id: "campaign-paused-1" },
      },
      google: {
        platform: "google",
        error: { code: "provider_error", message: "Try again." },
      },
    },
    allExpectedPairsSucceeded: false,
    onCreate() {},
    onValidateShapes() {},
    onJumpToStep() {},
    ...overrides,
  };
}

function actionButton(tree, label) {
  return collectElements(tree).find(
    (element) => textContent(element.props.children) === label &&
      typeof element.props.onClick === "function",
  );
}

describe("ISSUE-1009 · current expected-pair completion", () => {
  it("one destination keeps bare keys and a mixed success/error remains incomplete", () => {
    assert.deepEqual(
      expectedCreateResultKeys({
        destinations: [EVENT],
        buildablePlatforms: ["meta", "google"],
      }),
      ["meta", "google"],
    );

    assert.equal(areAllExpectedCreatePairsSuccessful({
      destinations: [EVENT],
      buildablePlatforms: ["meta", "google"],
      createResults: reviewProps().createResults,
    }), false);
  });

  it("multiple destinations keep the existing composite keys and complete only after every pair succeeds", () => {
    const destinations = [EVENT, BRAND];
    const buildablePlatforms = ["meta"];
    const keys = expectedCreateResultKeys({ destinations, buildablePlatforms });

    assert.deepEqual(keys, [
      "meta::event:event-1",
      "meta::brand:brand-1",
    ]);
    assert.equal(areAllExpectedCreatePairsSuccessful({
      destinations,
      buildablePlatforms,
      createResults: {
        "meta::event:event-1": { campaign: { id: "campaign-1" } },
        "meta::brand:brand-1": { error: { message: "Retry me." } },
      },
    }), false);
    assert.equal(areAllExpectedCreatePairsSuccessful({
      destinations,
      buildablePlatforms,
      createResults: {
        "meta::event:event-1": { campaign: { id: "campaign-1" } },
        "meta::brand:brand-1": { campaign: { id: "campaign-2" } },
      },
    }), true);
  });
});

describe("ISSUE-1009 · actual StepReview runtime keeps partial retries reachable", () => {
  it("mixed real-create results keep Create and Validate enabled and invoke both callbacks", () => {
    let createCalls = 0;
    let validateCalls = 0;
    const tree = StepReview(reviewProps({
      onCreate: () => { createCalls += 1; },
      onValidateShapes: () => { validateCalls += 1; },
    }));

    const create = actionButton(tree, "Create campaign (paused)");
    const validate = actionButton(tree, "Validate shapes (nothing created)");

    assert.ok(create, "the real StepReview Create button must render");
    assert.ok(validate, "the real StepReview Validate button must render");
    assert.equal(create.props.disabled, false);
    assert.equal(validate.props.disabled, false);

    create.props.onClick();
    validate.props.onClick();
    assert.equal(createCalls, 1, "partial success must still reach the existing create callback");
    assert.equal(validateCalls, 1, "partial success must still reach the existing validate callback");
    assert.match(textContent(tree), /Created — paused\./, "any success still renders the paused banner");
    assert.match(textContent(tree), /Nothing is spending yet\./, "the successful result card stays visible");
    assert.match(textContent(tree), /Try again\./, "the failed sibling result card stays visible");
  });

  it("all expected campaigns disable both actions while preserving the paused banner", () => {
    const tree = StepReview(reviewProps({ allExpectedPairsSucceeded: true }));
    assert.equal(actionButton(tree, "Create campaign (paused)").props.disabled, true);
    assert.equal(actionButton(tree, "Validate shapes (nothing created)").props.disabled, true);
    assert.match(textContent(tree), /Created — paused\./);
  });
});

describe("ISSUE-1009 · parent wiring reuses the retry-ready runCreate path", () => {
  const page = SRC("pages/CampaignBuilderPage.jsx");

  it("derives completion from destinations × creativePartition.buildable and passes it to Review", () => {
    assert.match(page, /areAllExpectedCreatePairsSuccessful\(\{\s*destinations,\s*buildablePlatforms: creativePartition\.buildable,\s*createResults,/);
    assert.match(page, /allExpectedPairsSucceeded=\{allExpectedPairsSucceeded\}/);
  });

  it("keeps the existing successful-pair skip and both callbacks on runCreate", () => {
    assert.match(page, /if \(results\[resultKey\]\?\.campaign\) continue/);
    assert.match(page, /onCreate=\{\(\) => runCreate\(\{ validateOnly: false \}\)\}/);
    assert.match(page, /onValidateShapes=\{\(\) => runCreate\(\{ validateOnly: true \}\)\}/);
  });
});
