/**
 * Issue #3355 rework 8 — the staged rollout switch for "Ari understands
 * first" (the intent read and start_flow, the reply claim check with its
 * status reads, memory in the turn, the ask-the-team escalation, the brand
 * snapshot and the screen context).
 *
 * The switch is the existing Ari rollout mechanism: a row in
 * `public.ari_runtime_versions` with `version_key = 'ari-understand-first-3355'`
 * and a row in `public.ari_rollouts` for it (both service-role only, from
 * migration 20280209003355). Migration 20280628153355 creates both, on for
 * every brand; with no rows a brand keeps the earlier behaviour.
 *
 *   - Per brand (allow-list): a rollout with status `pilot`, `expanding` or
 *     `active` whose `audience.brand_ids` lists the brand.
 *   - A share of brands: the same rollout with `rollout_percent` 1–99; a
 *     brand is in when its stable bucket (0–99, from its id) is below it.
 *   - Everyone: status `active` with `rollout_percent = 100`, or
 *     `audience.all = true`. Migration 20280628153355 seeds this (Seth,
 *     2026-11-12: on for all brands at launch).
 *   - `completed` (the Improvement Lab's Complete) keeps its audience on.
 *   - Off again: set the rollout's status to `paused` or `rolled_back`.
 *
 * `ARI_UNDERSTAND_FIRST=on|off` overrides it (a local stack or an eval run).
 * With no override, a local stack (SUPABASE_URL on localhost / 127.0.0.1 /
 * kong) and a unit test (no SUPABASE_URL) are on. A failed read is off. The read is cached per isolate for 15 s.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const ARI_UNDERSTAND_FIRST_VERSION_KEY = "ari-understand-first-3355";
// #3355 final fix (C-3): the Improvement Lab's "Complete" (status
// `completed`, only from an active 100% rollout) ships the version: it keeps
// the rollout's last audience on, never switches it off.
const LIVE_ROLLOUT_STATUSES = [
  "pilot",
  "expanding",
  "active",
  "completed",
] as const;
const ROLLOUT_TTL_MS = 15_000;

/** One rollout row, as the switch reads it. */
export interface AriRolloutRow {
  status: string;
  audience: unknown;
  rollout_percent: unknown;
}

/** The explicit override: true / false, or null when it is not set. */
export function ariUnderstandFirstOverride(
  value: string | undefined = Deno.env.get("ARI_UNDERSTAND_FIRST"),
  supabaseUrl: string | undefined = Deno.env.get("SUPABASE_URL"),
): boolean | null {
  const flag = (value ?? "").trim().toLowerCase();
  if (flag === "on" || flag === "true" || flag === "1") return true;
  if (flag === "off" || flag === "false" || flag === "0") return false;
  // No Supabase URL at all: a unit test or a script, never a deployed
  // function (the platform always sets it).
  if (typeof supabaseUrl !== "string" || supabaseUrl.trim() === "") return true;
  if (
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|kong|host\.docker\.internal)(?::\d+)?(?:\/|$)/i
      .test(supabaseUrl.trim())
  ) return true;
  return null;
}

/** A brand's stable bucket, 0–99 (FNV-1a of its id). */
export function ariRolloutBucket(brandId: string): number {
  let hash = 0x811c9dc5;
  for (const char of brandId.toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/** Whether the rollout rows switch the new behaviour on for one brand. */
export function ariRolloutCovers(
  rows: readonly AriRolloutRow[],
  brandId: string | null,
): boolean {
  for (const row of rows) {
    if (
      !(LIVE_ROLLOUT_STATUSES as readonly string[]).includes(row.status)
    ) continue;
    const audience = row.audience && typeof row.audience === "object" &&
        !Array.isArray(row.audience)
      ? row.audience as Record<string, unknown>
      : {};
    const percent = typeof row.rollout_percent === "number"
      ? row.rollout_percent
      : 0;
    if (audience.all === true) return true;
    if (
      (row.status === "active" || row.status === "completed") &&
      percent >= 100
    ) return true;
    if (!brandId) continue;
    const listed = Array.isArray(audience.brand_ids) &&
      audience.brand_ids.some((id) =>
        typeof id === "string" && id.toLowerCase() === brandId.toLowerCase()
      );
    if (listed) return true;
    if (percent > 0 && ariRolloutBucket(brandId) < percent) return true;
  }
  return false;
}

let rolloutCache: { rows: AriRolloutRow[]; at: number } | null = null;

/** Test seam: forget the cached rollout read. */
export function resetAriRolloutCache(): void {
  rolloutCache = null;
}

async function readRolloutRows(
  service: Pick<SupabaseClient, "from">,
  now: number,
): Promise<AriRolloutRow[]> {
  if (rolloutCache && now - rolloutCache.at < ROLLOUT_TTL_MS) {
    return rolloutCache.rows;
  }
  let rows: AriRolloutRow[] = [];
  try {
    const version = await service.from("ari_runtime_versions")
      .select("id")
      .eq("version_key", ARI_UNDERSTAND_FIRST_VERSION_KEY)
      .maybeSingle();
    const id = (version.data as { id?: unknown } | null)?.id;
    if (!version.error && typeof id === "string") {
      const rollouts = await service.from("ari_rollouts")
        .select("status,audience,rollout_percent")
        .eq("runtime_version_id", id)
        .in("status", [...LIVE_ROLLOUT_STATUSES]);
      if (!rollouts.error && Array.isArray(rollouts.data)) {
        rows = rollouts.data as AriRolloutRow[];
      } else if (rollouts.error) {
        console.warn(
          "[ari-rollout] rollout read failed",
          JSON.stringify({ code: rollouts.error.code ?? null }),
        );
      }
    } else if (version.error) {
      console.warn(
        "[ari-rollout] runtime version read failed",
        JSON.stringify({ code: version.error.code ?? null }),
      );
    }
  } catch (error) {
    console.warn(
      "[ari-rollout] rollout read threw",
      error instanceof Error ? error.message.slice(0, 120) : "unknown",
    );
    rows = [];
  }
  rolloutCache = { rows, at: now };
  return rows;
}

/**
 * Whether "Ari understands first" runs for this turn's brand: the override,
 * else the rollout rows (service client; RLS keeps the tables from callers).
 */
export async function readAriUnderstandFirst(
  service: Pick<SupabaseClient, "from">,
  brandId: string | null,
  options: {
    override?: boolean | null;
    now?: number;
  } = {},
): Promise<boolean> {
  const override = options.override !== undefined
    ? options.override
    : ariUnderstandFirstOverride();
  if (override !== null) return override;
  const rows = await readRolloutRows(service, options.now ?? Date.now());
  return ariRolloutCovers(rows, brandId);
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** #3355 final fix (C-2): a brand id fit for `related_brand_id`, else null. */
export function pendingActionBrandId(value: unknown): string | null {
  return typeof value === "string" && UUID_SHAPE.test(value.trim())
    ? value.trim()
    : null;
}

/**
 * #3355 final fix (C-2): the brand an approved Ari card belongs to, for the
 * post-approval switch read: the card's stored brand (`related_brand_id`),
 * else its args' `brand_id`, else the brand of the event or trip it changes
 * (`event_id`, read with the service client). Null when none resolves.
 */
export async function resolveApprovedActionBrandId(args: {
  brandId?: string | null;
  toolArgs?: Record<string, unknown>;
  service: Pick<SupabaseClient, "from">;
}): Promise<string | null> {
  const stored = pendingActionBrandId(args.brandId) ??
    pendingActionBrandId(args.toolArgs?.brand_id);
  if (stored) return stored;
  const eventId = pendingActionBrandId(args.toolArgs?.event_id);
  if (!eventId) return null;
  try {
    const { data, error } = await args.service.from("events")
      .select("brand_id")
      .eq("id", eventId)
      .maybeSingle();
    if (error) {
      console.warn(
        "[ari-rollout] approved card brand read failed",
        JSON.stringify({ code: error.code ?? null }),
      );
      return null;
    }
    return pendingActionBrandId(
      (data as { brand_id?: unknown } | null)?.brand_id,
    );
  } catch (error) {
    console.warn(
      "[ari-rollout] approved card brand read threw",
      error instanceof Error ? error.message.slice(0, 120) : "unknown",
    );
    return null;
  }
}
