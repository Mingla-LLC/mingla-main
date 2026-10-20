/**
 * Issue #3697 — reconcile a dead Mingla plan against its provider.
 *
 * A create that fails after the provider made objects records their IDs and
 * moves the plan to `creation_failed_terminal`. Its funding hold then stays
 * "held" for ever, because nothing may release funds while provider objects
 * might exist. Production 2026-10-20: plan 534424c7 recorded Meta campaign
 * 52609719519827, which no longer exists, and its $120 hold was still held.
 *
 * This module is the read side: it lists every provider object ID the plan
 * recorded, asks the provider whether each still exists, and turns the
 * answers into one decision. The database RPC `ad_plan_reconcile_clear`
 * recomputes the recorded IDs itself and only clears when the evidence names
 * every one of them as absent.
 */

import { AdApiError, type Platform } from "./adChannelCore.ts";

export type ProviderObjectLevel = "campaign" | "ad_set" | "ad" | "creative";

export type RecordedProviderObject = {
  platform: Platform;
  level: ProviderObjectLevel;
  external_id: string;
};

export type ProbeVerdict = "absent" | "exists" | "unknown";

export type ProviderObjectProbe = RecordedProviderObject & {
  verdict: ProbeVerdict;
  /** The provider's own status when it answered (e.g. ACTIVE, DELETED). */
  provider_status: string | null;
  detail: string | null;
};

export type ReconcileDecision =
  | { verdict: "clear"; objects: ProviderObjectProbe[] }
  | { verdict: "still_exists"; objects: ProviderObjectProbe[] }
  | { verdict: "unknown"; objects: ProviderObjectProbe[] };

/** Recorded key → provider object level. Plan binding keys are skipped. */
const KEY_LEVELS: Record<string, ProviderObjectLevel> = {
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

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function idValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const PLATFORMS = new Set(["meta", "tiktok", "snapchat", "google", "reddit"]);

/**
 * Every provider object ID the plan recorded: paused-create attempts,
 * create_failed / rollback audit rows (including a surviving creative residue)
 * and any campaign rows. Deduplicated by platform + level + id.
 */
export function recordedProviderObjects(input: {
  attempts?: Row[];
  failureEvents?: Row[];
  campaigns?: Row[];
}): RecordedProviderObject[] {
  const seen = new Map<string, RecordedProviderObject>();
  const add = (platform: unknown, key: string, value: unknown) => {
    const level = KEY_LEVELS[key];
    const id = idValue(value);
    if (!level || !id || typeof platform !== "string") return;
    if (!PLATFORMS.has(platform)) return;
    const object = { platform: platform as Platform, level, external_id: id };
    seen.set(`${platform}:${level}:${id}`, object);
  };
  for (const attempt of input.attempts ?? []) {
    if (attempt.command !== "create_paused_objects") continue;
    for (
      const [key, value] of Object.entries(asRecord(attempt.external_ids) ?? {})
    ) {
      add(attempt.platform, key, value);
    }
  }
  for (const event of input.failureEvents ?? []) {
    if (event.action !== "create_failed" && event.action !== "rollback") {
      continue;
    }
    for (
      const [key, value] of Object.entries(asRecord(event.external_ids) ?? {})
    ) {
      add(event.platform, key, value);
    }
    const residue = asRecord(event.provider_response)?.creative_residue_id;
    add(event.platform, "creative_residue_id", residue);
  }
  for (const campaign of input.campaigns ?? []) {
    add(
      campaign.platform,
      "external_campaign_id",
      campaign.external_campaign_id,
    );
  }
  return [...seen.values()];
}

/** One decision for the whole plan. Unknown never clears. */
export function reconcileDecision(
  objects: ProviderObjectProbe[],
): ReconcileDecision {
  if (objects.some((object) => object.verdict === "exists")) {
    return { verdict: "still_exists", objects };
  }
  if (objects.some((object) => object.verdict !== "absent")) {
    return { verdict: "unknown", objects };
  }
  return { verdict: "clear", objects };
}

/** Provider statuses that mean the object no longer runs or bills. */
const GONE_STATUSES = new Set(["DELETED", "ARCHIVED"]);

/** Meta's "object does not exist" answer (Graph error 100, subcode 33). */
export function isMetaObjectMissing(error: unknown): boolean {
  if (!(error instanceof AdApiError)) return false;
  return Number(error.code) === 100 && Number(error.subcode) === 33;
}

export type MetaGraphCall = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/**
 * Ask Meta about each recorded object. A "does not exist" answer only counts
 * when the same token can read the ad account first; otherwise a token for
 * the wrong account would make every object look deleted.
 */
export async function probeMetaObjects(
  graph: MetaGraphCall,
  adAccountId: string,
  objects: RecordedProviderObject[],
): Promise<ProviderObjectProbe[]> {
  const metaObjects = objects.filter((object) => object.platform === "meta");
  if (metaObjects.length === 0) return [];
  try {
    await graph("GET", `act_${adAccountId.replace(/^act_/i, "")}`, {
      fields: "id",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return metaObjects.map((object) => ({
      ...object,
      verdict: "unknown",
      provider_status: null,
      detail: `ad_account_unreadable: ${detail}`.slice(0, 300),
    }));
  }
  const probes: ProviderObjectProbe[] = [];
  for (const object of metaObjects) {
    try {
      const payload = await graph("GET", object.external_id, {
        fields: "id,status",
      });
      const status = typeof payload.status === "string"
        ? payload.status.toUpperCase()
        : null;
      probes.push({
        ...object,
        verdict: status && GONE_STATUSES.has(status) ? "absent" : "exists",
        provider_status: status,
        detail: null,
      });
    } catch (error) {
      probes.push({
        ...object,
        verdict: isMetaObjectMissing(error) ? "absent" : "unknown",
        provider_status: null,
        detail: isMetaObjectMissing(error)
          ? "not_found"
          : (error instanceof Error ? error.message : String(error)).slice(
            0,
            300,
          ),
      });
    }
  }
  return probes;
}

/** Providers this module cannot check yet answer "unknown", never "absent". */
export function unsupportedProbes(
  objects: RecordedProviderObject[],
): ProviderObjectProbe[] {
  return objects
    .filter((object) => object.platform !== "meta")
    .map((object) => ({
      ...object,
      verdict: "unknown" as const,
      provider_status: null,
      detail: `${object.platform}_check_not_supported_yet`,
    }));
}

/**
 * Delete order for "Delete on provider, then clear": children first, the
 * account-level creative last (Meta refuses to delete a creative in use).
 */
const DELETE_ORDER: Record<ProviderObjectLevel, number> = {
  ad: 0,
  ad_set: 1,
  campaign: 2,
  creative: 3,
};

export function deletionOrder(
  probes: ProviderObjectProbe[],
): ProviderObjectProbe[] {
  return probes
    .filter((probe) => probe.verdict === "exists")
    .sort((left, right) =>
      DELETE_ORDER[left.level] - DELETE_ORDER[right.level]
    );
}

/** The phrase that must be typed before Mingla deletes provider objects. */
export const RECONCILE_DELETE_PHRASE = "DELETE ON PROVIDER";

/** The evidence shape the clear RPC verifies. */
export function reconcileEvidence(probes: ProviderObjectProbe[]) {
  return probes.map((probe) => ({
    platform: probe.platform,
    level: probe.level,
    external_id: probe.external_id,
    verdict: probe.verdict,
    provider_status: probe.provider_status,
  }));
}
