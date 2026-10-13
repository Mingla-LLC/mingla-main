/**
 * toward #3697 Wave 9 — shared Host/Admin Meta provider sync helpers.
 *
 * Host reshape of Admin create/launch: createFullCampaignAtomic + top-down
 * setStatus. No second Meta stack — adapters live in adChannel / meta.ts.
 */

import {
  type AdConnectionRow,
  type AtomicCreateInput,
  type ChannelAdapter,
  type CreateAdSetInput,
  type CreateCampaignInput,
  type CreateCreativeInput,
  type CreateAdInput,
} from "./adChannel.ts";

/** Registrable destination domain for Meta AEM conversion_domain (A4.g). */
export function conversionDomainFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const labels = host.split(".");
    if (labels.length < 2) return host;
    return labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

/** Currency → default Meta geo country for Host plans that omit targeting. */
export function hostDefaultCountriesForCurrency(currency: string): string[] {
  const c = currency.trim().toUpperCase();
  if (c === "GBP") return ["GB"];
  if (c === "NGN") return ["NG"];
  return ["US"];
}

export type HostMetaAtomicBuildInput = {
  name: string;
  destUrl: string;
  message: string;
  imageHash: string;
  budgetCents: number;
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
  headline?: string;
  description?: string;
};

/**
 * Host Meta OUTCOME_TRAFFIC / LINK_CLICKS CBO input for createFullCampaignAtomic.
 * Everything PAUSED on the wire; caller persists only after success.
 */
export function buildHostMetaAtomicInput(
  input: HostMetaAtomicBuildInput,
): AtomicCreateInput {
  const campaign: CreateCampaignInput = {
    name: input.name,
    objective: "OUTCOME_TRAFFIC",
    dailyBudgetCents: input.budgetCents,
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  };
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: input.countries },
  };
  const adSet: CreateAdSetInput = {
    name: `${input.name} — ad set`,
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    targeting,
    ...(input.startsAt ? { startTime: input.startsAt } : {}),
    ...(input.endsAt ? { endTime: input.endsAt } : {}),
  };
  const creative: CreateCreativeInput = {
    destUrl: input.destUrl,
    message: input.message,
    imageHash: input.imageHash,
    callToActionType: "LEARN_MORE",
    campaignName: input.name,
    adName: `${input.name} — ad`,
    ...(input.headline ? { headline: input.headline } : {}),
    ...(input.description ? { description: input.description } : {}),
  };
  const ad: Omit<CreateAdInput, "externalCreativeId"> = {
    name: `${input.name} — ad`,
    conversionDomain: conversionDomainFromUrl(input.destUrl) ?? undefined,
  };
  return { campaign, adSet, creative, ad };
}

export type ProviderChildIds = {
  externalCampaignId: string;
  adSetExternalIds: string[];
  adExternalIds: string[];
};

/**
 * Top-down launch (campaign → ad sets → ads) or campaign-only pause.
 * Mirrors admin-ad-campaign-action §4.0 order.
 */
export async function setCampaignTreeStatus(
  adapter: ChannelAdapter,
  connection: AdConnectionRow,
  tree: ProviderChildIds,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  await adapter.setStatus(
    connection,
    "campaign",
    tree.externalCampaignId,
    status,
  );
  if (status === "ACTIVE") {
    for (const id of tree.adSetExternalIds) {
      await adapter.setStatus(connection, "ad_set", id, "ACTIVE");
    }
    for (const id of tree.adExternalIds) {
      await adapter.setStatus(connection, "ad", id, "ACTIVE");
    }
  }
}

/** True when the campaign still uses a Wave 7c synthetic host_* placeholder id. */
export function isSyntheticHostExternalId(externalId: string | null | undefined): boolean {
  if (!externalId || typeof externalId !== "string") return true;
  return externalId.startsWith("host_");
}
