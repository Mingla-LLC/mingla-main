/**
 * Issue #3697 — the plain-English facts of a dead Mingla plan (pure).
 *
 * A plan in creation_failed_terminal failed after the provider made objects.
 * The recovery card shows what the provider was asked to create (the recorded
 * IDs), why it stopped, and the money held, then offers one action: check
 * with the provider. Mirrors supabase/functions/_shared/adPlanReconcile.ts
 * (the server recomputes everything; this only renders).
 */

import { PLATFORM_LABELS } from "./channelPlan.js";

const KEY_LEVELS = {
  external_campaign_id: "campaign",
  campaign_id: "campaign",
  external_adset_id: "ad_set",
  adset_id: "ad_set",
  ad_set_id: "ad_set",
  external_ad_id: "ad",
  ad_id: "ad",
  external_creative_id: "creative",
  creative_id: "creative",
  creative_residue_id: "creative",
};

export const LEVEL_LABELS = {
  campaign: "Campaign",
  ad_set: "Ad set",
  ad: "Ad",
  creative: "Creative",
};

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

function idValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Every recorded provider object of a recovery item, once. */
export function recordedProviderObjects(item) {
  const seen = new Map();
  const add = (platform, key, value) => {
    const level = KEY_LEVELS[key];
    const id = idValue(value);
    if (!level || !id || typeof platform !== "string") return;
    seen.set(`${platform}:${level}:${id}`, { platform, level, external_id: id });
  };
  for (const attempt of item?.provider_attempts ?? []) {
    if (attempt?.command !== "create_paused_objects") continue;
    for (const [key, value] of Object.entries(asRecord(attempt.external_ids) ?? {})) {
      add(attempt.platform, key, value);
    }
  }
  for (const event of item?.provider_failure_events ?? []) {
    for (const [key, value] of Object.entries(asRecord(event?.external_ids) ?? {})) {
      add(event.platform, key, value);
    }
    add(event?.platform, "creative_residue_id", asRecord(event?.provider_response)?.creative_residue_id);
  }
  return [...seen.values()];
}

/** "Meta", or "Meta and Google" — the provider-generic button label. */
export function providerNames(platforms) {
  const names = [...new Set(platforms)].map((p) => PLATFORM_LABELS[p] ?? p);
  if (names.length <= 1) return names[0] ?? "the provider";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function moneyLabel(currency, minor) {
  const value = Number(minor);
  if (!/^[A-Z]{3}$/.test(currency ?? "") || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value % 100 === 0 ? 0 : 2,
    }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

/** Why the create stopped, from the recorded failure (never invented). */
export function failureReason(item, providerLabel) {
  const event = (item?.provider_failure_events ?? []).at(-1) ?? null;
  const response = asRecord(event?.provider_response) ?? {};
  if (typeof response.db_error === "string") {
    if (response.campaign_rolled_back === true) {
      return "Mingla couldn't save it, so it was rolled back";
    }
    if (response.campaign_rolled_back === false) {
      return `Mingla couldn't save it, and the rollback on ${providerLabel} did not finish`;
    }
    return "Mingla couldn't save it after the provider created it";
  }
  if (typeof response.message === "string" && response.message.trim()) {
    return `${providerLabel} answered: ${response.message.trim()}`;
  }
  const attempt = (item?.provider_attempts ?? [])
    .filter((row) => row?.command === "create_paused_objects")
    .at(-1);
  if (typeof attempt?.error_detail === "string" && attempt.error_detail.trim()) {
    return attempt.error_detail.trim().replaceAll("_", " ");
  }
  return "—";
}

function failedAtLabel(item) {
  const event = (item?.provider_failure_events ?? []).at(-1);
  const iso = event?.created_at ?? item?.plan?.updated_at ?? null;
  const date = new Date(iso ?? "");
  if (Number.isNaN(date.getTime())) return null;
  const zone = item?.version?.canonical_plan?.schedule?.time_zone;
  let timeZone = "UTC";
  try {
    if (zone) {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      timeZone = zone;
    }
  } catch {
    timeZone = "UTC";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** Everything the dead-plan card shows. */
export function deadPlanFacts(item) {
  const objects = recordedProviderObjects(item);
  const platforms = objects.length
    ? objects.map((object) => object.platform)
    : (item?.provider_allocations ?? []).map((row) => row.platform);
  const providerLabel = providerNames(platforms);
  const hold = item?.funding_hold ?? null;
  const held = hold?.state === "held";
  return {
    name: item?.version?.canonical_plan?.name || "Untitled Mingla campaign",
    providerLabel,
    objects,
    failedAt: failedAtLabel(item),
    reason: failureReason(item, providerLabel),
    holdLabel: held
      ? `${moneyLabel(hold.currency, hold.amount_cents)} on Mingla's own account · nothing charged`
      : "No money is held",
    checkLabel: `Check with ${providerLabel}`,
  };
}

/** One line per plan a reconcile cleared ("1 old plan was cleared."). */
export function clearedPlanNote(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  const headline = `${list.length} old plan${list.length === 1 ? " was" : "s were"} cleared.`;
  const details = list.map((row) => {
    const response = asRecord(row?.provider_response) ?? {};
    const name = response.plan_name || "A Mingla plan";
    const provider = providerNames(
      Array.isArray(response.platforms) && response.platforms.length
        ? response.platforms
        : [row?.platform].filter(Boolean),
    );
    const money =
      response.hold_amount_cents != null
        ? moneyLabel(response.hold_currency, response.hold_amount_cents)
        : null;
    return money
      ? `${name} had no live ${provider} objects — its ${money} hold was released.`
      : `${name} had no live ${provider} objects and was closed.`;
  });
  return { headline, details };
}
