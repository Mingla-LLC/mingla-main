/**
 * Issue #3697 — the Mingla (house) plan path from an immutable plan to PAUSED
 * provider objects, as one visible sequence with no dead ends.
 *
 * The server owns every gate (ad-plan `fund` → ad_plan_mark_admin_funded,
 * `confirm_launch` → ad_plan_confirm_launch, admin-ad-creative-prepare,
 * admin-ad-create-campaign). This module only names the steps, reports which
 * one is next for a recorded plan state, and explains why Create is disabled.
 * It never launches: activation stays on the Campaigns page behind LAUNCH.
 *
 * House funding is the contract's provider-account hold: Mingla's own
 * connected ad account pays the provider, so the hold records the frozen cap
 * (funding_source 'mingla_provider_account') and no money moves through
 * Mingla's ledger.
 */

import { PLATFORM_LABELS } from "./channelPlan.js";

export const CREATE_PAUSED_PHRASE = "CREATE PAUSED";

const label = (platform) => PLATFORM_LABELS[platform] ?? platform;

/**
 * The ordered steps one "Create campaign (paused)" (or Resume) runs.
 * @param {{ platforms: string[], isVideo: boolean }} input
 * @returns {Array<{ id: string, platform: string|null, label: string }>}
 */
export function housePlanCreateSteps({ platforms = [], isVideo = false } = {}) {
  const steps = [
    { id: "bind", platform: null, label: "Bind the exact immutable plan" },
    {
      id: "fund",
      platform: null,
      label: "Hold the cap on Mingla's own ad account (no charge now)",
    },
    {
      id: "confirm",
      platform: null,
      label: `Confirm ${CREATE_PAUSED_PHRASE} for this plan hash`,
    },
  ];
  if (isVideo) {
    for (const platform of platforms) {
      steps.push({
        id: `prepare:${platform}`,
        platform,
        label: `Prepare the video for ${label(platform)}`,
      });
    }
  }
  for (const platform of platforms) {
    steps.push({
      id: `create:${platform}`,
      platform,
      label: `Create paused on ${label(platform)}`,
    });
  }
  return steps;
}

/** Start every step as pending. */
export function initialStepStates(steps) {
  return steps.map((step) => ({ ...step, state: "pending", detail: null }));
}

/**
 * Immutable update of one step's state. Unknown ids are ignored so a progress
 * callback can never invent a step.
 */
export function setStepState(stepStates, id, state, detail = null) {
  return stepStates.map((step) =>
    step.id === id ? { ...step, state, detail } : step
  );
}

/**
 * The exact next action for a recorded Mingla plan, so the recovery card can
 * say why Resume is needed and what it will do before anyone clicks.
 * @param {{ state: string, platforms: string[], createdPlatforms: string[],
 *   isVideo: boolean, sealed: boolean, hasFundingHold: boolean }} input
 */
export function housePlanNextAction({
  state,
  platforms = [],
  createdPlatforms = [],
  isVideo = false,
  sealed = true,
  hasFundingHold = false,
} = {}) {
  const created = new Set(createdPlatforms);
  const missing = platforms.filter((platform) => !created.has(platform));
  const missingLabels = missing.map(label).join(", ");
  if (!sealed) {
    return {
      kind: "rebuild",
      canResume: false,
      title: "Rebuild in Campaign Builder",
      explanation:
        "This older plan has no sealed provider template, so it cannot be resumed exactly.",
      steps: [],
    };
  }
  if (state === "creation_failed_terminal") {
    return {
      kind: "inspect",
      canResume: false,
      title: "Inspect the provider evidence",
      explanation:
        "A provider returned a terminal failure. Inspect it before creating a replacement plan.",
      steps: [],
    };
  }
  if (missing.length === 0) {
    return {
      kind: "none",
      canResume: false,
      title: "Every paused provider object exists",
      explanation: "Launch it from the campaign list when you are ready.",
      steps: [],
    };
  }
  const todo = [];
  if (state === "ready_for_funding" && !hasFundingHold) {
    todo.push("hold the cap on Mingla's own ad account (no charge now)");
  }
  todo.push(`confirm ${CREATE_PAUSED_PHRASE} for this plan hash`);
  if (isVideo) todo.push(`prepare the video for ${missingLabels}`);
  todo.push(`create paused on ${missingLabels}`);
  const why =
    state === "ready_for_funding"
      ? "The plan was bound but never funded, so nothing was sent to a provider."
      : state === "funded_held"
        ? "The plan is funded but the paused create was never confirmed."
        : state === "creation_failed_retryable"
          ? "A provider step failed and can be retried safely."
          : "The paused create was interrupted.";
  return {
    kind: "resume",
    canResume: true,
    title: `Next: resume the paused create for ${missingLabels}`,
    explanation: `${why} Resume will ${todo.join(", then ")}. Nothing launches and no spend begins.`,
    steps: todo,
  };
}

/**
 * Why the real Create button is disabled, in the order an operator fixes it.
 * The phrase is its own reason: it must never read as "no channel can run".
 * @returns {string|null}
 */
export function createBlockReason({
  channelCount = 0,
  currencyBlockedReason = null,
  planBlocked = false,
  phrase = "",
} = {}) {
  if (currencyBlockedReason) return currencyBlockedReason;
  if (channelCount === 0) {
    return "No channel can run an ad right now. Fix at least one blocker to continue.";
  }
  if (planBlocked) {
    return "Resolve the targeting checks above before creating.";
  }
  if (phrase !== CREATE_PAUSED_PHRASE) {
    return `Type ${CREATE_PAUSED_PHRASE} above to enable create.`;
  }
  return null;
}
