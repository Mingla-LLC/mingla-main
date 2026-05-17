/**
 * Shared query-key factory for marketing hooks.
 * Constitution #4 — one query key per entity.
 *
 * Phase A (ORCH-0815) shipped: campaigns.{all,list,byId}, templates.starter.
 * Phase B (ORCH-0863) adds: overview, audiences.{list,reach}, templates.{user,byId}.
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
  overview: {
    all: ["marketing", "overview"] as const,
    byAccount: (accountId: string): readonly unknown[] =>
      ["marketing", "overview", accountId] as const,
  },
  audiences: {
    all: ["marketing", "audiences"] as const,
    list: (accountId: string): readonly unknown[] =>
      ["marketing", "audiences", "list", accountId] as const,
    reach: (clientKey: string): readonly unknown[] =>
      ["marketing", "audiences", "reach", clientKey] as const,
  },
  templates: {
    all: ["marketing", "templates"] as const,
    starter: ["marketing", "templates", "starter"] as const,
    user: (accountId: string): readonly unknown[] =>
      ["marketing", "templates", "user", accountId] as const,
    byId: (templateId: string): readonly unknown[] =>
      ["marketing", "templates", "byId", templateId] as const,
  },
} as const;
