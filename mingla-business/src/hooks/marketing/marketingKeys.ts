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
    // #2514 — keyed by BRAND. Keying by account made two brands share one
    // cache entry, so switching brand served the previous brand's list.
    list: (brandId: string, status?: CampaignStatus): readonly unknown[] =>
      ["marketing", "campaigns", "list", brandId, status ?? "all"] as const,
    byId: (campaignId: string): readonly unknown[] =>
      ["marketing", "campaigns", "byId", campaignId] as const,
  },
  overview: {
    all: ["marketing", "overview"] as const,
    byBrand: (brandId: string): readonly unknown[] =>
      ["marketing", "overview", brandId] as const,
  },
  audiences: {
    all: ["marketing", "audiences"] as const,
    list: (accountId: string): readonly unknown[] =>
      ["marketing", "audiences", "list", accountId] as const,
    reach: (clientKey: string): readonly unknown[] =>
      ["marketing", "audiences", "reach", clientKey] as const,
    book: (brandId: string): readonly unknown[] =>
      ["marketing", "audiences", "book", brandId] as const,
    bookPreview: (campaignId: string): readonly unknown[] =>
      ["marketing", "audiences", "book-preview", campaignId] as const,
  },
  people: {
    all: (brandId: string): readonly unknown[] =>
      ["marketing", "people", brandId] as const,
    book: (brandId: string, search: string | null): readonly unknown[] =>
      [
        ...marketingKeys.people.all(brandId),
        "book",
        search?.trim() ?? "",
      ] as const,
    detail: (brandId: string, personId: string): readonly unknown[] =>
      [...marketingKeys.people.all(brandId), "detail", personId] as const,
    mergeCandidates: (
      brandId: string,
      personId: string,
      search: string | null,
    ): readonly unknown[] => [
      ...marketingKeys.people.all(brandId),
      "merge-candidates",
      personId,
      search?.trim() ?? "",
    ] as const,
    mergeHistory: (brandId: string, personId: string): readonly unknown[] =>
      [...marketingKeys.people.all(brandId), "merge-history", personId] as const,
    mergePreview: (
      brandId: string,
      leftPersonId: string,
      rightPersonId: string,
    ): readonly unknown[] => [
      ...marketingKeys.people.all(brandId),
      "merge-preview",
      leftPersonId,
      rightPersonId,
    ] as const,
    operation: (brandId: string, clientRequestId: string): readonly unknown[] =>
      [...marketingKeys.people.all(brandId), "operation", clientRequestId] as const,
    // #2305 — the identity-conflict review queue. Nested under people.all so a
    // resolve can invalidate the book and the queue with one prefix if needed,
    // but the two are invalidated explicitly (a resolve ADDS a person to the
    // book, so a stale book is a visible bug).
    conflicts: (brandId: string): readonly unknown[] =>
      [...marketingKeys.people.all(brandId), "conflicts"] as const,
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
