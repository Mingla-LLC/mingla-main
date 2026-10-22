/**
 * Issue #3697 — deterministic three-stage paid-social audience plan.
 *
 * Provider ids may enter this module only from rows read from ad_audiences.
 * The browser selects stages and ordinary demographic intent; it never supplies
 * an audience id. Event audiences widen event -> brand -> market, and no stage
 * is executable until the event-buyer exclusion exists for that provider.
 */

import type { Platform } from "./adChannelCore.ts";

export type PaidSocialPlatform = "meta" | "snapchat" | "tiktok";
export type AdAudienceScope = "market" | "brand" | "event";
export type AdAudienceStatus = "creating" | "ready" | "too_small" | "error";
export type AdStage = "prospecting" | "retarget" | "abandoners";

export type AdAudienceRow = {
  id: string;
  platform: PaidSocialPlatform;
  code: string;
  scope: AdAudienceScope;
  market: string | null;
  brand_id: string | null;
  event_id: string | null;
  platform_audience_id: string | null;
  approx_size: number | null;
  status: AdAudienceStatus;
};

export type AdStageTargeting = {
  stage: AdStage;
  enabled: boolean;
  executable: boolean;
  budgetPercent: number;
  budgetCents: number;
  includeAudienceIds: string[];
  excludeAudienceIds: string[];
  audienceCodes: string[];
  audienceSizes: Record<string, number | null>;
  widened: Array<{ code: string; from: AdAudienceScope; to: AdAudienceScope }>;
  reason: string | null;
  advantageAudience: boolean;
  frequencyCap: { impressions: 3; days: 7 } | null;
};

export type AdStagePlan = {
  platform: PaidSocialPlatform;
  blocked: boolean;
  blockedReason: string | null;
  minimumAudienceSize: 1000;
  stages: AdStageTargeting[];
};

const MINIMUM_AUDIENCE_SIZE = 1000 as const;

const CODES: Record<
  PaidSocialPlatform,
  { prospecting: string[]; retarget: string[]; checkout: string; buyer: string }
> = {
  meta: {
    prospecting: ["M9"],
    retarget: ["M1", "M2", "M3", "M4"],
    checkout: "M5",
    buyer: "M6",
  },
  snapchat: {
    prospecting: ["S6"],
    retarget: ["S1", "S2"],
    checkout: "S3",
    buyer: "S4",
  },
  tiktok: {
    prospecting: ["T6"],
    retarget: ["T1", "T2"],
    checkout: "T3",
    buyer: "T4",
  },
};

function paidSocialPlatform(platform: Platform): PaidSocialPlatform | null {
  return platform === "meta" || platform === "snapchat" || platform === "tiktok"
    ? platform
    : null;
}

function cleanProviderId(row: AdAudienceRow | undefined): string | null {
  const id = row?.platform_audience_id?.trim();
  return id && row?.status !== "error" ? id : null;
}

function scopeMatches(
  row: AdAudienceRow,
  scope: AdAudienceScope,
  market: string,
  brandId: string,
  eventId: string,
): boolean {
  if (row.scope !== scope) return false;
  if (scope === "event") return row.event_id === eventId;
  if (scope === "brand") return row.brand_id === brandId;
  return row.market?.toUpperCase() === market.toUpperCase();
}

function candidateFor(
  rows: AdAudienceRow[],
  code: string,
  scope: AdAudienceScope,
  market: string,
  brandId: string,
  eventId: string,
): AdAudienceRow | undefined {
  return rows.find((row) =>
    row.code === code &&
    scopeMatches(row, scope, market, brandId, eventId) &&
    cleanProviderId(row) !== null
  );
}

function qualifyingAudience(
  rows: AdAudienceRow[],
  code: string,
  market: string,
  brandId: string,
  eventId: string,
): { row: AdAudienceRow | null; widened: AdStageTargeting["widened"] } {
  const scopes: AdAudienceScope[] = ["event", "brand", "market"];
  let firstExistingScope: AdAudienceScope | null = null;
  for (const scope of scopes) {
    const row = candidateFor(rows, code, scope, market, brandId, eventId);
    if (!row) continue;
    firstExistingScope ??= scope;
    if (
      row.status === "ready" &&
      Number.isFinite(row.approx_size) &&
      Number(row.approx_size) >= MINIMUM_AUDIENCE_SIZE
    ) {
      return {
        row,
        widened: firstExistingScope !== scope
          ? [{ code, from: firstExistingScope, to: scope }]
          : [],
      };
    }
  }
  return { row: null, widened: [] };
}

function anyAudience(
  rows: AdAudienceRow[],
  code: string,
  market: string,
  brandId: string,
  eventId: string,
): AdAudienceRow | null {
  for (const scope of ["event", "brand", "market"] as const) {
    const row = candidateFor(rows, code, scope, market, brandId, eventId);
    if (row) return row;
  }
  return null;
}

function stageBudgetShares(
  enabled: Record<AdStage, boolean>,
  executable: Record<AdStage, boolean>,
  totalCents: number,
): Record<AdStage, number> {
  const base = {
    prospecting: Math.floor(totalCents * 0.7),
    retarget: Math.floor(totalCents * 0.2),
    abandoners: totalCents - Math.floor(totalCents * 0.7) -
      Math.floor(totalCents * 0.2),
  };
  if (enabled.prospecting && executable.prospecting) {
    let prospecting = base.prospecting;
    for (const stage of ["retarget", "abandoners"] as const) {
      if (!enabled[stage] || !executable[stage]) prospecting += base[stage];
    }
    return {
      prospecting,
      retarget: enabled.retarget && executable.retarget ? base.retarget : 0,
      abandoners: enabled.abandoners && executable.abandoners
        ? base.abandoners
        : 0,
    };
  }

  // The Admin retargeting shortcut intentionally turns prospecting off. Keep
  // the entered total intact by redistributing it across the executable warm
  // stages in their default 20:10 ratio (or entirely to the sole survivor).
  const warmStages = (["retarget", "abandoners"] as const).filter((stage) =>
    enabled[stage] && executable[stage]
  );
  if (warmStages.length === 0) {
    return { prospecting: 0, retarget: 0, abandoners: 0 };
  }
  if (warmStages.length === 1) {
    return {
      prospecting: 0,
      retarget: warmStages[0] === "retarget" ? totalCents : 0,
      abandoners: warmStages[0] === "abandoners" ? totalCents : 0,
    };
  }
  const retarget = Math.floor(totalCents * (20 / 30));
  return {
    prospecting: 0,
    retarget,
    abandoners: totalCents - retarget,
  };
}

export function buildAdStagePlan(input: {
  platform: Platform;
  rows: AdAudienceRow[];
  market: string;
  brandId: string;
  eventId: string;
  totalBudgetCents: number;
  enabledStages?: Partial<Record<AdStage, boolean>>;
}): AdStagePlan | null {
  const platform = paidSocialPlatform(input.platform);
  if (!platform) return null;
  const rows = input.rows.filter((row) => row.platform === platform);
  const codes = CODES[platform];
  const enabled: Record<AdStage, boolean> = {
    prospecting: input.enabledStages?.prospecting !== false,
    retarget: input.enabledStages?.retarget !== false,
    abandoners: input.enabledStages?.abandoners !== false,
  };
  const buyer = anyAudience(
    rows,
    codes.buyer,
    input.market,
    input.brandId,
    input.eventId,
  );
  const buyerId = cleanProviderId(buyer ?? undefined);
  const blocked = buyerId === null;

  const retargetRows: AdAudienceRow[] = [];
  const retargetWidened: AdStageTargeting["widened"] = [];
  for (const code of codes.retarget) {
    const found = qualifyingAudience(
      rows,
      code,
      input.market,
      input.brandId,
      input.eventId,
    );
    if (found.row) retargetRows.push(found.row);
    retargetWidened.push(...found.widened);
  }
  const checkout = qualifyingAudience(
    rows,
    codes.checkout,
    input.market,
    input.brandId,
    input.eventId,
  );
  const checkoutAny = anyAudience(
    rows,
    codes.checkout,
    input.market,
    input.brandId,
    input.eventId,
  );
  const lookalikes = codes.prospecting.map((code) =>
    qualifyingAudience(
      rows,
      code,
      input.market,
      input.brandId,
      input.eventId,
    ).row
  ).filter((row): row is AdAudienceRow => row !== null);

  const executable: Record<AdStage, boolean> = {
    prospecting: enabled.prospecting && !blocked,
    retarget: enabled.retarget && !blocked && retargetRows.length > 0,
    abandoners: enabled.abandoners && !blocked && checkout.row !== null,
  };
  const totalBudget = Number.isSafeInteger(input.totalBudgetCents) &&
      input.totalBudgetCents > 0
    ? input.totalBudgetCents
    : 0;
  const budgets = stageBudgetShares(enabled, executable, totalBudget);
  const exclusions = buyerId ? [buyerId] : [];
  const checkoutExclusion = cleanProviderId(checkoutAny ?? undefined);

  const rowsFor = (items: AdAudienceRow[]) => ({
    ids: items.map((row) => cleanProviderId(row)).filter((id): id is string =>
      id !== null
    ),
    codes: items.map((row) => row.code),
    sizes: Object.fromEntries(items.map((row) => [row.code, row.approx_size])),
  });
  const prospecting = rowsFor(lookalikes);
  const retarget = rowsFor(retargetRows);
  const abandoners = rowsFor(checkout.row ? [checkout.row] : []);

  const stage = (
    name: AdStage,
    percentage: number,
    include: ReturnType<typeof rowsFor>,
    extraExclusions: string[],
    widened: AdStageTargeting["widened"],
    reason: string | null,
  ): AdStageTargeting => ({
    stage: name,
    enabled: enabled[name],
    executable: executable[name],
    budgetPercent: percentage,
    budgetCents: budgets[name],
    includeAudienceIds: include.ids,
    excludeAudienceIds: [...new Set([...exclusions, ...extraExclusions])],
    audienceCodes: include.codes,
    audienceSizes: include.sizes,
    widened,
    reason: blocked
      ? `${codes.buyer} event-buyer exclusion is not ready.`
      : !enabled[name]
      ? "Stage turned off."
      : reason,
    advantageAudience: name === "prospecting",
    frequencyCap: name !== "prospecting" && platform !== "tiktok"
      ? { impressions: 3, days: 7 }
      : null,
  });

  return {
    platform,
    blocked,
    blockedReason: blocked
      ? `${codes.buyer} event-buyer exclusion must exist before any ad set can be created.`
      : null,
    minimumAudienceSize: MINIMUM_AUDIENCE_SIZE,
    stages: [
      stage("prospecting", 70, prospecting, [], [], null),
      stage(
        "retarget",
        20,
        retarget,
        checkoutExclusion ? [checkoutExclusion] : [],
        retargetWidened,
        retargetRows.length === 0
          ? "No retargeting audience has at least 1,000 people after event, brand and market fallback. Its budget folds into prospecting."
          : null,
      ),
      stage(
        "abandoners",
        10,
        abandoners,
        [],
        checkout.widened,
        checkout.row === null
          ? "The checkout-starter audience has fewer than 1,000 people after event, brand and market fallback. Its budget folds into prospecting."
          : null,
      ),
    ],
  };
}
