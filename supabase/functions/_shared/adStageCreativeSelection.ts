/** Issue #3697 — server authority for 2–4 brand creatives per paid-social stage. */

import { classifyRatio } from "./adCreativeMatrix.ts";
import type { Platform } from "./adChannelCore.ts";

type Stage = "prospecting" | "retarget" | "abandoners";
type Row = Record<string, unknown>;

const STAGES: Stage[] = ["prospecting", "retarget", "abandoners"];
const PAID_SOCIAL = new Set<Platform>(["meta", "snapchat", "tiktok"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

export function stageCreativeIds(
  value: unknown,
): { ok: true; byStage: Record<Stage, string[]>; allIds: string[] } | {
  ok: false;
  detail: string;
} {
  const input = record(value);
  if (!input) return { ok: false, detail: "stage_creative_ids_required" };
  const byStage = {} as Record<Stage, string[]>;
  const all = new Set<string>();
  for (const stage of STAGES) {
    const raw = input[stage];
    if (
      !Array.isArray(raw) ||
      raw.some((id) => typeof id !== "string" || !UUID_RE.test(id))
    ) {
      return { ok: false, detail: `stage_creative_ids_invalid:${stage}` };
    }
    const ids = [...new Set(raw as string[])];
    byStage[stage] = ids;
    ids.forEach((id) => all.add(id));
  }
  return { ok: true, byStage, allIds: [...all] };
}

function coverage(row: Row): Set<string> {
  const ratios = new Set<string>();
  const variants = record(row.variants) ?? {};
  for (const ratio of ["1:1", "4:5", "9:16"]) {
    const variant = record(variants[ratio]);
    if (typeof variant?.source_url === "string" && variant.source_url.trim()) {
      ratios.add(ratio);
    }
  }
  const aspectRatio = Number(row.aspect_ratio);
  const master = classifyRatio(
    Number.isFinite(aspectRatio) ? aspectRatio : null,
    ["1:1", "4:5", "9:16"],
  );
  if (master) ratios.add(master);
  return ratios;
}

export function validateStageCreativeRows(input: {
  ids: Record<Stage, string[]>;
  rows: Row[];
  enabledStages: Partial<Record<Stage, boolean>>;
  platforms: readonly Platform[];
  brandId: string | null;
}): { ok: true } | { ok: false; detail: string } {
  const platforms = input.platforms.filter((platform) =>
    PAID_SOCIAL.has(platform)
  );
  if (platforms.length === 0) return { ok: true };
  if (!input.brandId) {
    return { ok: false, detail: "stage_creative_brand_required" };
  }
  const byId = new Map(input.rows.map((row) => [String(row.id), row]));
  for (const stage of STAGES) {
    if (input.enabledStages[stage] === false) continue;
    const ids = input.ids[stage] ?? [];
    if (ids.length < 2 || ids.length > 4) {
      return { ok: false, detail: `stage_creative_count_invalid:${stage}` };
    }
    for (const id of ids) {
      const row = byId.get(id);
      if (
        !row || row.status !== "active" || row.purged_at !== null ||
        row.brand_id !== input.brandId
      ) {
        return { ok: false, detail: `stage_creative_not_reusable:${stage}` };
      }
      const ratios = coverage(row);
      if (
        platforms.includes("meta") &&
        ["1:1", "4:5", "9:16"].some((ratio) => !ratios.has(ratio))
      ) {
        return { ok: false, detail: `stage_creative_meta_coverage:${id}` };
      }
      if (
        (platforms.includes("snapchat") || platforms.includes("tiktok")) &&
        !ratios.has("9:16")
      ) {
        return { ok: false, detail: `stage_creative_vertical_coverage:${id}` };
      }
      if (
        (platforms.includes("snapchat") || platforms.includes("tiktok")) &&
        row.has_audio !== true
      ) {
        return { ok: false, detail: `stage_creative_audio_required:${id}` };
      }
    }
  }
  return { ok: true };
}
