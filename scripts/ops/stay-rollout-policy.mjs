#!/usr/bin/env node

export const STAY_FLAG_KEYS = Object.freeze([
  "STAY_VENUE_AUTHORING",
  "STAY_PUBLIC_PAGES",
  "STAY_RESERVE_READS",
  "STAY_RESERVE_WRITES",
  "STAY_STRIPE_COMMERCE",
  "STAY_PAYSTACK_COMMERCE",
  "STAY_NOTIFICATIONS",
]);

export const DARK_STAY_FLAGS = Object.freeze(
  Object.fromEntries(STAY_FLAG_KEYS.map((key) => [key, false])),
);

const evidenceKeys = Object.freeze([
  "releaseFixtureReady",
  "notificationDeliveryReady",
  "stripeUsdReady",
  "paystackNgnReady",
  "ngSmsReady",
  "zeroRefundBacklog",
]);

function exactBooleans(input, keys, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { value: null, errors: [`${label} must be an object`] };
  }
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  const errors = [];
  for (const missing of expected.filter((key) => !actual.includes(key))) {
    errors.push(`${label} missing ${missing}`);
  }
  for (const extra of actual.filter((key) => !expected.includes(key))) {
    errors.push(`${label} has unknown ${extra}`);
  }
  for (
    const key of actual.filter((candidate) => expected.includes(candidate))
  ) {
    if (typeof input[key] !== "boolean") {
      errors.push(
        `${label}.${key} must be boolean`,
      );
    }
  }
  return { value: errors.length === 0 ? { ...input } : null, errors };
}

export function stayStage(flags) {
  const parsed = exactBooleans(flags, STAY_FLAG_KEYS, "flags");
  if (!parsed.value) return "invalid";
  const enabled = STAY_FLAG_KEYS.filter((key) => parsed.value[key]);
  if (enabled.length === 0) return "S0_DARK";
  if (enabled.join("|") === "STAY_VENUE_AUTHORING") return "S1_AUTHORING";
  if (
    enabled.join("|") ===
      "STAY_VENUE_AUTHORING|STAY_PUBLIC_PAGES|STAY_RESERVE_READS"
  ) return "S2_PUBLIC_READS";
  if (
    enabled.join("|") ===
      "STAY_VENUE_AUTHORING|STAY_PUBLIC_PAGES|STAY_RESERVE_READS|STAY_NOTIFICATIONS"
  ) return "S3_NOTIFICATIONS";
  if (
    parsed.value.STAY_VENUE_AUTHORING && parsed.value.STAY_PUBLIC_PAGES &&
    parsed.value.STAY_RESERVE_READS && parsed.value.STAY_RESERVE_WRITES &&
    parsed.value.STAY_STRIPE_COMMERCE &&
    !parsed.value.STAY_PAYSTACK_COMMERCE && parsed.value.STAY_NOTIFICATIONS
  ) return "S4_STRIPE_WRITES";
  if (STAY_FLAG_KEYS.every((key) => parsed.value[key])) return "S5_ALL_RAILS";
  return "TRANSITIONAL";
}

export function validateStayRolloutTransition({
  currentFlags,
  nextFlags,
  evidence,
  currentRefundPostingEnabled,
  nextRefundPostingEnabled,
  unresolvedRefundObligations = 0,
}) {
  const current = exactBooleans(currentFlags, STAY_FLAG_KEYS, "currentFlags");
  const next = exactBooleans(nextFlags, STAY_FLAG_KEYS, "nextFlags");
  const proof = exactBooleans(evidence, evidenceKeys, "evidence");
  const errors = [...current.errors, ...next.errors, ...proof.errors];

  if (typeof currentRefundPostingEnabled !== "boolean") {
    errors.push("currentRefundPostingEnabled must be boolean");
  }
  if (typeof nextRefundPostingEnabled !== "boolean") {
    errors.push("nextRefundPostingEnabled must be boolean");
  }
  if (
    !Number.isSafeInteger(unresolvedRefundObligations) ||
    unresolvedRefundObligations < 0
  ) {
    errors.push(
      "unresolvedRefundObligations must be a non-negative safe integer",
    );
  }
  if (!current.value || !next.value || !proof.value) {
    return { ok: false, errors, stage: "invalid" };
  }

  const enabling = STAY_FLAG_KEYS.filter(
    (key) => !current.value[key] && next.value[key],
  );
  const disabling = STAY_FLAG_KEYS.filter(
    (key) => current.value[key] && !next.value[key],
  );
  const nextStage = stayStage(next.value);

  if (enabling.length > 0 && nextStage === "TRANSITIONAL") {
    errors.push("forward rollout must land on one of the five approved stages");
  }

  if (next.value.STAY_PUBLIC_PAGES && !next.value.STAY_VENUE_AUTHORING) {
    errors.push("public pages require Stay authoring");
  }
  if (next.value.STAY_RESERVE_READS && !next.value.STAY_PUBLIC_PAGES) {
    errors.push("reserve reads require public pages");
  }
  if (next.value.STAY_RESERVE_WRITES) {
    for (
      const dependency of [
        "STAY_VENUE_AUTHORING",
        "STAY_PUBLIC_PAGES",
        "STAY_RESERVE_READS",
        "STAY_NOTIFICATIONS",
      ]
    ) {
      if (!next.value[dependency]) {
        errors.push(`reserve writes require ${dependency}`);
      }
    }
    if (
      !next.value.STAY_STRIPE_COMMERCE &&
      !next.value.STAY_PAYSTACK_COMMERCE
    ) errors.push("reserve writes require at least one proven commerce rail");
    if (!nextRefundPostingEnabled) {
      errors.push("reserve writes require source-refund posting enabled");
    }
    if (!proof.value.releaseFixtureReady) {
      errors.push("reserve writes require a reversible release fixture");
    }
  }

  if (enabling.length > 0) {
    if (next.value.STAY_PUBLIC_PAGES && !proof.value.releaseFixtureReady) {
      errors.push("public pages require a verified release fixture");
    }
    if (
      next.value.STAY_NOTIFICATIONS &&
      !proof.value.notificationDeliveryReady
    ) errors.push("notifications require delivery proof");
    if (next.value.STAY_STRIPE_COMMERCE && !proof.value.stripeUsdReady) {
      errors.push("Stripe commerce requires independent USD/Stripe proof");
    }
  }
  if (enabling.length > 0 && next.value.STAY_PAYSTACK_COMMERCE) {
    if (!proof.value.paystackNgnReady) {
      errors.push("Paystack commerce requires independent NGN/Paystack proof");
    }
    if (!proof.value.ngSmsReady) {
      errors.push("Paystack commerce requires Nigeria transactional SMS proof");
    }
  }

  if (!currentRefundPostingEnabled && nextRefundPostingEnabled) {
    if (!proof.value.zeroRefundBacklog) {
      errors.push("enabling refund posting requires a zero-backlog readback");
    }
  }
  if (currentRefundPostingEnabled && !nextRefundPostingEnabled) {
    if (current.value.STAY_RESERVE_WRITES || next.value.STAY_RESERVE_WRITES) {
      errors.push(
        "refund posting cannot be disabled while Stay writes are or were open",
      );
    }
    if (unresolvedRefundObligations > 0) {
      errors.push(
        "refund posting cannot be disabled with unresolved obligations",
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stage: nextStage,
    enabling,
    disabling,
  };
}
