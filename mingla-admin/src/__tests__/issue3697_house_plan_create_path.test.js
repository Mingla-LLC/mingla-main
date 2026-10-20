// MINGLA-INVARIANT: I-3697-HOUSE-CREATE-NO-SILENT-STOP | issue #3697 | the CREATE PAUSED phrase is visible before the first Create click and is checked before any plan is bound; a missing phrase never reads as "no channel can run".
// MINGLA-INVARIANT: I-3697-HOUSE-CREATE-VISIBLE-STEPS | issue #3697 | Create and Resume report bind, fund, confirm, prepare and create-paused progress, and keep every failure on screen with its next action.
// MINGLA-INVARIANT: I-3697-BUDGET-ENTRY-NEVER-DEADLOCKS | issue #3697 | the budget input's currency is resolved without the budget floor, so typing an amount digit by digit never disables the input.
// MINGLA-INVARIANT: I-3697-SCHEDULE-NAMED-ZONE | issue #3697 | campaign start and end are wall-clock times in a named, labelled zone, never silently the browser zone.
/**
 * Issue #3697 — a Mingla (house) campaign goes from plan to PAUSED provider
 * objects with no dead ends.
 *
 * Live evidence (2026-10-20): plan 534424c7… reached ready_for_funding with
 * ad-plan open/create_version/freeze_targeting/mark_ready only — no fund, no
 * confirm, no provider call — because the phrase field appeared only after the
 * first click and the button was then disabled under "No channel can run".
 *
 * Run: node --test src/__tests__/issue3697_house_plan_create_path.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import {
  CREATE_PAUSED_PHRASE,
  createBlockReason,
  housePlanCreateSteps,
  housePlanNextAction,
  initialStepStates,
  setStepState,
} from "../lib/adBuilder/housePlanPath.js";
import {
  budgetCurrencyPlatforms,
  planChannels,
} from "../lib/adBuilder/channelPlan.js";
import { resolvePlanCurrency } from "../lib/adBuilder/payload.js";
import {
  defaultScheduleTimeZone,
  scheduleTimeZoneOptions,
  timeZoneLabel,
  zonedLocalToIso,
} from "../lib/adBuilder/scheduleTimeZone.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

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
      headline: "Ready to create 1 paused video campaign across 1 platform",
      channels: [{
        platform: "meta",
        label: "Meta",
        dailyLabel: "$30.00/day",
        statusLine: "Paused → will go live on Launch",
        objectiveLabel: "OUTCOME_TRAFFIC · LINK_CLICKS",
        videoReadiness: "Video not ready",
      }],
      blocked: [],
      destinationLine: "Deserted Island 6.0",
      creativeLine: "1 video",
      copyLine: "Checked",
      warnings: [],
    },
    name: "Deserted Island 6.0",
    onNameChange() {},
    submitting: false,
    validatingShapes: false,
    createResults: null,
    allExpectedPairsSucceeded: false,
    onCreate() {},
    onValidateShapes() {},
    onJumpToStep() {},
    ...overrides,
  };
}

const phraseInput = (tree) =>
  collectElements(tree).find(
    (element) =>
      typeof element.props.label === "string" &&
      element.props.label.includes(CREATE_PAUSED_PHRASE) &&
      typeof element.props.onChange === "function",
  );
const createButton = (tree) =>
  collectElements(tree).find(
    (element) =>
      textContent(element.props.children) === "Create campaign (paused)" &&
      typeof element.props.onClick === "function",
  );

describe("#3697 Review shows the confirmation before the first Create click", () => {
  it("renders the CREATE PAUSED field with no plan bound yet", () => {
    const tree = StepReview(reviewProps({ planPreview: null }));
    assert.ok(
      phraseInput(tree),
      "the phrase must be typeable before the first click binds a plan",
    );
  });

  it("a bound ready plan with no phrase names the phrase, never 'no channel can run'", () => {
    const tree = StepReview(reviewProps({
      planPreview: {
        status: "ready",
        plan_hash: "a".repeat(64),
        targeting_snapshots: [],
      },
      confirmationPhrase: "",
    }));
    const text = textContent(tree);
    assert.doesNotMatch(text, /No channel can run an ad right now/);
    assert.match(text, /Type CREATE PAUSED above to enable create\./);
    assert.equal(
      createButton(tree).props.disabled,
      false,
      "pressing Create must explain the missing phrase, not sit disabled",
    );
  });

  it("explains that 'Video not ready' is prepared by Create itself", () => {
    const text = textContent(StepReview(reviewProps()));
    assert.match(text, /Create\s+prepares it on each platform after the plan is funded and confirmed/);
  });

  it("renders each create step with its state, and a failure with its next action", () => {
    let steps = initialStepStates(
      housePlanCreateSteps({ platforms: ["meta"], isVideo: true }),
    );
    steps = setStepState(steps, "bind", "done");
    steps = setStepState(steps, "fund", "done");
    steps = setStepState(steps, "confirm", "done");
    steps = setStepState(steps, "prepare:meta", "failed", "meta: provider busy");
    const tree = StepReview(reviewProps({
      createSteps: steps,
      createError: { title: "Plan preparation failed", message: "meta: provider busy" },
    }));
    const text = textContent(tree);
    assert.match(text, /Hold the cap on Mingla's own ad account/);
    assert.match(text, /Prepare the video for Meta/);
    assert.match(text, /Create paused on Meta/);
    assert.match(text, /Failed/);
    assert.ok(
      collectElements(tree).some(
        (element) => element.props.title === "Plan preparation failed",
      ),
      "the failure stays on screen as an alert, not toast-only",
    );
    assert.match(text, /press\s+Create again — it resumes this same plan/);
    assert.match(text, /Nothing launched and no spend began/);
  });
});

describe("#3697 runCreate checks the phrase before binding and reports every step", () => {
  const page = SRC("pages/CampaignBuilderPage.jsx");
  const body = page.slice(page.indexOf("const runCreate = async"));

  it("checks CREATE PAUSED before prepareImmutablePlan opens a plan", () => {
    const phraseGate = body.indexOf("launchPhrase !== CREATE_PAUSED_PHRASE");
    const bind = body.indexOf("immutablePlan = await prepareImmutablePlan(");
    assert.ok(phraseGate > 0, "the up-front phrase gate must exist");
    assert.ok(bind > 0);
    assert.ok(phraseGate < bind, "the phrase gate must run before any plan is bound");
    assert.doesNotMatch(body, /if \(launchPhrase !== "CREATE PAUSED"\) \{/);
  });

  it("marks fund, confirm, prepare and create steps in order and never launches", () => {
    const order = [
      'markStep("bind", "running")',
      'markStep("fund", "running")',
      'action: "fund"',
      'markStep("confirm", "running")',
      'action: "confirm_launch"',
      "prepareBoundVideoCreative({",
      "markStep(`create:${platform}`, \"running\")",
    ].map((needle) => {
      const at = body.indexOf(needle);
      assert.ok(at > 0, `missing ${needle}`);
      return at;
    });
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.doesNotMatch(body, /campaignAction\([^)]*"launch"/);
    assert.match(body, /setCreateError\(\{ title, message \}\)/);
  });

  it("prepares video on the plan's lane, not a hard-coded one", () => {
    assert.doesNotMatch(page, /lane: "consumer",\s*planVersionId: immutablePlan/);
  });
});

describe("#3697 the recovery queue names the next action and Resume reports progress", () => {
  it("an unfunded video plan says it will fund, confirm, prepare and create paused", () => {
    const next = housePlanNextAction({
      state: "ready_for_funding",
      platforms: ["meta"],
      createdPlatforms: [],
      isVideo: true,
      sealed: true,
      hasFundingHold: false,
    });
    assert.equal(next.canResume, true);
    assert.match(next.explanation, /never funded/);
    assert.match(next.explanation, /hold the cap on Mingla's own ad account/);
    assert.match(next.explanation, /prepare the video for Meta/);
    assert.match(next.explanation, /create paused on Meta/);
    assert.match(next.explanation, /Nothing launches and no spend begins/);
  });

  it("a terminal or unsealed plan cannot resume and says what to do instead", () => {
    assert.equal(
      housePlanNextAction({ state: "creation_failed_terminal", platforms: ["meta"] }).canResume,
      false,
    );
    assert.match(
      housePlanNextAction({ state: "ready_for_funding", platforms: ["meta"], sealed: false }).title,
      /Rebuild in Campaign Builder/,
    );
  });

  it("Resume streams step progress, and the modal shows it with no hidden reason box", () => {
    const service = SRC("services/adEngineService.js");
    const campaigns = SRC("pages/CampaignsPage.jsx");
    const modal = SRC("components/entity/HighRiskActionModal.jsx");
    assert.match(service, /export async function resumeAdminAdPlan\(planId, \{ onStep \} = \{\}\)/);
    assert.match(service, /begin\("fund"\)/);
    assert.match(service, /begin\(`create:\$\{platform\}`\)/);
    assert.match(service, /canonical_plan\?\.lane === "business"/);
    assert.match(campaigns, /resumeAdminAdPlan\(planId, \{\s*onStep:/);
    assert.match(campaigns, /aria-label="Resume progress"/);
    assert.match(campaigns, /aria-label="Next required action"/);
    assert.match(modal, /\{requireReason && \(/);
  });
});

describe("#3697 budget entry never deadlocks below the provider floor", () => {
  const planInput = {
    preflightRows: [{ platform: "meta", overall: "green", checks: [] }],
    goalIds: ["traffic"],
    countries: ["NG"],
    allowlist: null,
    connections: {
      meta: { currency: "USD", extra: { minimum_budgets: { high_freq: 500 } } },
    },
    metaGoal: "LINK_CLICKS",
  };

  it("the first keystroke ($3) is below Meta's floor but the currency stays resolved", () => {
    const floorRows = planChannels({ ...planInput, totalDailyCents: 300 });
    assert.equal(
      floorRows.find((row) => row.platform === "meta").eligible,
      false,
      "precondition: $3/day is below Meta's $5 floor",
    );
    const platforms = budgetCurrencyPlatforms({
      planInput: { ...planInput, totalDailyCents: 300 },
      selectedPlatforms: ["meta"],
      excluded: {},
    });
    assert.deepEqual(platforms, ["meta"]);
    const currency = resolvePlanCurrency(planInput.connections, platforms);
    assert.equal(currency.unresolved, false);
    assert.equal(currency.currency, "USD");
  });

  it("the Builder resolves the plan currency from the floor-agnostic set", () => {
    const page = SRC("pages/CampaignBuilderPage.jsx");
    assert.match(page, /resolvePlanCurrency\(connections, currencyPlatforms\)/);
    assert.doesNotMatch(page, /resolvePlanCurrency\(connections, effectivePlatforms\)/);
  });
});

describe("#3697 the schedule is entered in a named, labelled zone", () => {
  it("converts Lagos wall-clock to the right instant regardless of browser zone", () => {
    assert.equal(
      zonedLocalToIso("2026-10-23T18:00", "Africa/Lagos"),
      "2026-10-23T17:00:00.000Z",
    );
    assert.equal(
      zonedLocalToIso("2026-07-01T09:30", "Europe/London"),
      "2026-07-01T08:30:00.000Z",
    );
    assert.equal(
      zonedLocalToIso("2026-01-15T09:30", "America/New_York"),
      "2026-01-15T14:30:00.000Z",
    );
    assert.equal(zonedLocalToIso("2026-10-23T18:00", "Not/AZone"), null);
    assert.equal(zonedLocalToIso("", "Africa/Lagos"), null);
  });

  it("defaults a Nigeria-only audience to Africa/Lagos and always offers it", () => {
    assert.equal(defaultScheduleTimeZone(["NG"], "America/Chicago"), "Africa/Lagos");
    assert.equal(defaultScheduleTimeZone(["NG", "GB"], "America/Chicago"), "America/Chicago");
    assert.ok(scheduleTimeZoneOptions("America/Chicago", "Asia/Tokyo").includes("Africa/Lagos"));
    assert.ok(scheduleTimeZoneOptions("Asia/Tokyo", "UTC").includes("Asia/Tokyo"));
    assert.match(timeZoneLabel("Africa/Lagos", new Date("2026-10-23T12:00:00Z")), /^Africa\/Lagos \(GMT\+1\)$/);
  });

  it("Budget converts with the named zone and Review prints that zone", () => {
    const budget = SRC("components/campaign-builder/StepBudget.jsx");
    assert.doesNotMatch(budget, /new Date\(local\)\.toISOString\(\)/);
    assert.match(budget, /zonedLocalToIso\(local, scheduleTimeZone\)/);
    assert.match(budget, /aria-label="Schedule time zone"/);
    const summary = buildLaunchSummary({
      startsAt: "2026-10-23T17:00:00.000Z",
      timeZone: "Africa/Lagos",
    });
    assert.match(summary.scheduleLine, /18:00 Africa\/Lagos/);
    const page = SRC("pages/CampaignBuilderPage.jsx");
    assert.match(page, /time_zone: scheduleZone/);
  });
});

describe("#3697 create readiness reasons are ordered and honest", () => {
  it("names the real blocker first and the phrase last", () => {
    assert.equal(
      createBlockReason({ channelCount: 1, currencyBlockedReason: "Currency missing" }),
      "Currency missing",
    );
    assert.match(createBlockReason({ channelCount: 0 }), /No channel can run/);
    assert.match(createBlockReason({ channelCount: 1, planBlocked: true }), /targeting/);
    assert.match(createBlockReason({ channelCount: 1, phrase: "" }), /Type CREATE PAUSED/);
    assert.equal(createBlockReason({ channelCount: 1, phrase: CREATE_PAUSED_PHRASE }), null);
  });
});
