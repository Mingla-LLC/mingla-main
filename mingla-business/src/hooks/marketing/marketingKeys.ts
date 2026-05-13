/**
 * Shared query-key factory for Phase B marketing hooks.
 * Constitution #4 — one query key per entity.
 */

import type { CampaignStatus } from "../../types/marketing";

export const marketingKeys = {
  all: ["marketing"] as const,
  campaigns: {
    all: ["marketing", "campaigns"] as const,
    list: (accountId: string, status?: CampaignStatus): readonly unknown[] =>
      ["marketing", "campaigns", "list", accountId, status ?? "all"] as const,
    byId: (campaignId: string): readonly unknown[] =>
      ["marketing", "campaigns", "byId", campaignId] as const,
  },
  templates: {
    starter: ["marketing", "templates", "starter"] as const,
  },
} as const;
