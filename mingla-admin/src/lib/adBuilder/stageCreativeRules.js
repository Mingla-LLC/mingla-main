export const PAID_SOCIAL_PLATFORMS = Object.freeze([
  "meta",
  "snapchat",
  "tiktok",
]);

export const CREATIVE_STAGES = Object.freeze([
  "prospecting",
  "retarget",
  "abandoners",
]);

export const MIN_CREATIVES_PER_STAGE = 2;
export const MAX_CREATIVES_PER_STAGE = 4;

const REQUIRED_RATIOS = Object.freeze({
  meta: ["9:16", "4:5", "1:1"],
  snapchat: ["9:16"],
  tiktok: ["9:16"],
});

export function creativeRatios(row) {
  const serialized = (row?.placement_formats ?? []).join(" ");
  return ["9:16", "4:5", "1:1"].filter((ratio) =>
    serialized.includes(ratio)
  );
}

export function creativeFatigue(row) {
  const active = Number(row?.usage?.active_campaign_count ?? 0);
  if (active >= 3) return { label: "Heavy rotation", variant: "warning" };
  if (active > 0) return { label: "In rotation", variant: "default" };
  return { label: "Fresh", variant: "success" };
}

export function validateStageCreativeSelection({
  stageCreativeIds = {},
  rows = [],
  enabledStages = {},
  platforms = [],
  brandId = null,
}) {
  const paidSocial = platforms.filter((platform) =>
    PAID_SOCIAL_PLATFORMS.includes(platform)
  );
  if (paidSocial.length === 0) return { ok: true, reason: null, stages: {} };
  if (!brandId) {
    return {
      ok: false,
      reason: "The destination has no authoritative brand for Creative Library filtering.",
      stages: {},
    };
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const stages = {};
  for (const stage of CREATIVE_STAGES) {
    const enabled = enabledStages[stage] !== false;
    const ids = [...new Set(stageCreativeIds[stage] ?? [])];
    const errors = [];
    if (enabled && ids.length < MIN_CREATIVES_PER_STAGE) {
      errors.push(`Choose at least ${MIN_CREATIVES_PER_STAGE} creatives.`);
    }
    if (ids.length > MAX_CREATIVES_PER_STAGE) {
      errors.push(`Choose no more than ${MAX_CREATIVES_PER_STAGE} creatives.`);
    }
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || row.brand_id !== brandId) {
        errors.push("A selected creative is missing or belongs to another brand.");
        continue;
      }
      const ratios = creativeRatios(row);
      for (const platform of paidSocial) {
        const missing = (REQUIRED_RATIOS[platform] ?? []).filter((ratio) =>
          !ratios.includes(ratio)
        );
        if (missing.length > 0) {
          errors.push(`${row.name} is missing ${missing.join(", ")} for ${platform}.`);
        }
        if (["snapchat", "tiktok"].includes(platform) && row.has_audio !== true) {
          errors.push(`${row.name} needs audio for ${platform}.`);
        }
      }
    }
    stages[stage] = { enabled, ids, errors: [...new Set(errors)] };
  }
  const firstError = CREATIVE_STAGES.flatMap((stage) =>
    stages[stage].enabled ? stages[stage].errors : []
  )[0] ?? null;
  return { ok: firstError === null, reason: firstError, stages };
}
