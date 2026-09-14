import { reportNonFatal } from "../diagnostics/reportNonFatal";
import type {
  BrandCircleAvailability,
  BrandCircleAvailabilityReason,
  BrandCircleReachPage,
} from "../types/brandCircleReach";
import { supabase } from "./supabase";

export type BrandCircleReachSummary = Pick<
  BrandCircleReachPage,
  "state" | "counts" | "availability"
>;

const availabilityReasons = new Set<BrandCircleAvailabilityReason>([
  "rollout_disabled",
  "controls_not_live",
  "refresh_pending",
  "refresh_failed",
  "freshness_expired",
  "authority_unavailable",
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).sort().join("|") === keys.slice().sort().join("|");
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function malformedSummary(): Error {
  const error = new Error("circle_temporarily_unavailable");
  reportNonFatal("brand-circle-reach-summary-malformed", error, {
    feature: "brand-circle-reach",
    code: "circle_temporarily_unavailable",
  });
  return error;
}

function parseAvailability(value: unknown): BrandCircleAvailability {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["state", "reason", "refreshedAt", "expiresAt"]) ||
    (value.state !== "ready" && value.state !== "unavailable") ||
    !(value.reason === null ||
      (typeof value.reason === "string" &&
        availabilityReasons.has(value.reason as BrandCircleAvailabilityReason))) ||
    !isNullableString(value.refreshedAt) ||
    !isNullableString(value.expiresAt) ||
    (value.state === "ready") !== (value.reason === null) ||
    (value.state === "ready" &&
      (value.refreshedAt === null || value.expiresAt === null))
  ) {
    throw malformedSummary();
  }
  return value as unknown as BrandCircleAvailability;
}

function parseSummary(value: unknown): BrandCircleReachSummary {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "state",
      "snapshotVersion",
      "counts",
      "availability",
      "rows",
      "nextCursor",
    ]) ||
    value.schemaVersion !== 1 ||
    !["ready", "partial", "unavailable"].includes(String(value.state)) ||
    !isRecord(value.counts) ||
    !hasExactKeys(value.counts, ["followers", "extended", "total"]) ||
    ![value.counts.followers, value.counts.extended, value.counts.total].every(
      (count) => count === null || isCount(count),
    ) ||
    !isRecord(value.availability) ||
    !hasExactKeys(value.availability, ["followers", "extended"]) ||
    !Array.isArray(value.rows)
  ) {
    throw malformedSummary();
  }
  return {
    state: value.state as BrandCircleReachPage["state"],
    counts: value.counts as unknown as BrandCircleReachPage["counts"],
    availability: {
      followers: parseAvailability(value.availability.followers),
      extended: parseAvailability(value.availability.extended),
    },
  };
}

export async function getBrandCircleReachSummary(
  brandId: string,
): Promise<BrandCircleReachSummary> {
  const { data, error } = await supabase.rpc("get_brand_circle_reach", {
    p_brand_id: brandId,
    p_ring: "all",
    p_cursor: null,
    p_limit: 1,
  });
  if (error) throw new Error("circle_temporarily_unavailable");
  return parseSummary(data);
}
