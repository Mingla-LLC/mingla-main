/**
 * toward #3697 Wave 7c — Host-owned ad campaigns (owner_kind=host).
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
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("host-ad-campaign", {
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
): Promise<{ campaign: HostAdCampaign & Record<string, unknown>; spend_total_cents: number }> {
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

export async function pauseHostAdCampaign(input: {
  brandId: string;
  campaignId: string;
}): Promise<{ ok: true; status: string }> {
  return invokeHostAd({
    action: "pause",
    brand_id: input.brandId,
    campaign_id: input.campaignId,
  });
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
