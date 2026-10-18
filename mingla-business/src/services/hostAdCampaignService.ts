/**
 * toward #3697 Wave 7c — Host-owned ad campaigns (owner_kind=host).
 * Historical Wave 9 marker: `invoke("host-ad-campaign"` remains the launch,
 * read and stop boundary; v1.4 pause now shares Admin's aggregate action engine.
 */

import { supabase } from "./supabase";

export type HostAdCampaign = {
  id: string;
  name: string;
  status: string;
  platform: string;
  daily_budget_cents: number | null;
  lifetime_budget_cents: number | null;
  cap_cents: number | null;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  dest_page_type: string | null;
  dest_url: string | null;
  brand_id: string | null;
  owner_kind: string | null;
  created_at: string | null;
  updated_at: string | null;
  plan_version_id: string | null;
  plan_state: string | null;
  lifecycle:
    "in_review" | "scheduled" | "live" | "paused" | "needs_attention" | "ended";
  next_action: string;
  campaign_ids: string[];
  platforms: string[];
  destination: { page_type: string | null; url: string | null };
  host_spend_equivalent_cents: number | null;
  spend_by_currency: { currency: string; spend_cents: number }[];
  primary_result_label: string;
  primary_result_count: number;
  cost_per_result_cents: number | null;
  impressions: number;
  clicks: number;
  creative: {
    name: string;
    kind: string;
    preview_url: string | null;
    review_status: string | null;
  } | null;
};

export type HostAdCampaignDetail = {
  campaign: HostAdCampaign & Record<string, unknown>;
  plan_campaigns: (HostAdCampaign & Record<string, unknown>)[];
  plan_state: string | null;
  plan_currency: string | null;
  plan_cap_cents: number | null;
  provider_spend_by_currency: {
    currency: string;
    spend_cents: number;
  }[];
  host_spend_equivalent_cents: number | null;
  host_spend_equivalent_quality: "frozen_plan_fx" | "unavailable";
  spend_daily: {
    campaign_id?: string;
    spend_date: string;
    spend_cents: number;
    impressions: number;
    clicks: number;
    platform: string;
    currency: string;
  }[];
  results: {
    conversions?: number;
    value_cents?: Record<string, number>;
    spend_by_currency?: {
      currency: string;
      spend_cents: number;
    }[];
    host_spend_equivalent_cents?: number | null;
    by_platform?: {
      platform: string;
      conversions: number;
    }[];
  };
  measurement: {
    manifest: null | {
      result_kind?: string;
      result_hierarchy?: string[];
      quality?: string;
      capture_authority?: string;
      consent?: Record<string, string>;
    };
    trusted_conversion_count: number;
    platform_shared_conversion_count: number;
    platform_withheld_conversion_count: number;
    observed_through: string | null;
  };
  by_placement: {
    platform: string;
    placement: string;
    conversions: number;
  }[];
  creatives: {
    id: string;
    name: string;
    status: string;
    review_status: string | null;
    review_detail: Record<string, unknown> | null;
    ad_creatives?: {
      id: string;
      kind: string;
      name: string;
      source_url: string | null;
      poster_url: string | null;
      mp4_master_url: string | null;
    } | null;
  }[];
  timeline: {
    id: string;
    platform: string | null;
    entity: string | null;
    action: string;
    from_status: string | null;
    to_status: string | null;
    provider_response: Record<string, unknown> | null;
    created_at: string;
  }[];
  credit_events: {
    id: string;
    entry_kind: string;
    amount_cents: number;
    currency: string;
    created_at: string;
  }[];
  settlements: {
    id: string;
    campaign_id: string;
    state: string;
    provider_currency: string;
    host_currency: string;
    final_provider_spend_cents: number | null;
    final_host_spend_cents: number | null;
    stop_requested_at: string;
    provider_stopped_at: string | null;
    settle_after: string | null;
    settled_at: string | null;
    released_host_cents: number;
  }[];
};

export class HostAdCampaignError extends Error {
  readonly code: string;
  readonly detail: string | null;
  constructor(code: string, message: string, detail: string | null = null) {
    super(message);
    this.name = "HostAdCampaignError";
    this.code = code;
    this.detail = detail;
  }
}

async function invokeHostAd<T>(
  body: Record<string, unknown>,
  functionName = "host-ad-campaign",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });
  if (error !== null) {
    let payload: { error?: string; detail?: string } | null = null;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        payload = (await ctx.json()) as { error?: string; detail?: string };
      }
    } catch {
      payload = null;
    }
    throw new HostAdCampaignError(
      payload?.error ?? "network",
      payload?.detail ?? error.message ?? "host_ad_failed",
      payload?.detail ?? null,
    );
  }
  if (data && typeof data === "object" && "error" in data) {
    const errBody = data as { error: string; detail?: string };
    throw new HostAdCampaignError(
      errBody.error || "unknown",
      errBody.detail ?? errBody.error,
      errBody.detail ?? null,
    );
  }
  return data as T;
}

export async function listHostAdCampaigns(
  brandId: string,
): Promise<HostAdCampaign[]> {
  const res = await invokeHostAd<{ ok: true; campaigns: HostAdCampaign[] }>({
    action: "list",
    brand_id: brandId,
  });
  return res.campaigns ?? [];
}

export async function getHostAdCampaign(
  brandId: string,
  campaignId: string,
): Promise<HostAdCampaignDetail> {
  return invokeHostAd({
    action: "get",
    brand_id: brandId,
    campaign_id: campaignId,
  });
}

export async function launchHostAdCampaign(input: {
  brandId: string;
  campaignId: string;
  idempotencyKey: string;
}): Promise<{ ok: true; status: string; debited_cents?: number }> {
  return invokeHostAd({
    action: "launch",
    brand_id: input.brandId,
    campaign_id: input.campaignId,
    idempotency_key: input.idempotencyKey,
  });
}

/** Resume every provider campaign bound to the same immutable Host plan. */
export async function resumeHostAdCampaignPlan(input: {
  campaignId: string;
  reason: string;
}): Promise<{ plan_state?: string; outcomes?: Record<string, unknown>[] }> {
  return invokeHostAd(
    {
      action: "launch",
      campaign_id: input.campaignId,
      confirm_phrase: "LAUNCH",
      reason: input.reason,
    },
    "admin-ad-campaign-action",
  );
}

export async function pauseHostAdCampaign(input: {
  brandId: string;
  campaignId: string;
}): Promise<{ ok: true; status: string }> {
  const result = await invokeHostAd<{
    plan_state?: string;
    campaign?: { status?: string };
  }>(
    {
      action: "pause",
      campaign_id: input.campaignId,
    },
    "admin-ad-campaign-action",
  );
  return {
    ok: true,
    status: result.plan_state ?? result.campaign?.status ?? "PAUSED",
  };
}

export async function endHostAdCampaign(input: {
  brandId: string;
  campaignId: string;
  idempotencyKey: string;
}): Promise<{ ok: true; status: string; unspent_returned_cents?: number }> {
  return invokeHostAd({
    action: "end",
    brand_id: input.brandId,
    campaign_id: input.campaignId,
    idempotency_key: input.idempotencyKey,
  });
}

/** Cancel only before any platform spend (full credit return when launched). */
export async function cancelHostAdCampaign(input: {
  brandId: string;
  campaignId: string;
  idempotencyKey: string;
}): Promise<{ ok: true; status: string; credit_returned_cents?: number }> {
  return invokeHostAd({
    action: "cancel",
    brand_id: input.brandId,
    campaign_id: input.campaignId,
    idempotency_key: input.idempotencyKey,
  });
}
