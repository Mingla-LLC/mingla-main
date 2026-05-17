/**
 * marketingCampaignService — campaign CRUD for the Phase B composer.
 *
 * All writes go through RLS-gated PostgREST calls. The `marketing-send` edge
 * function (service-role) is the only path that flips status to `sending` /
 * `sent` / `failed` — the composer only handles `draft` → `scheduled` and
 * `scheduled` → `cancelled` transitions.
 *
 * Service-layer error contract (Constitution #3):
 *   - All functions THROW on error. Caller hooks translate to user-facing
 *     toasts / banners.
 *   - No silent return-null fallbacks.
 *
 * SPEC reference: SPEC §5.1 (composer data dependencies), §9.3 (service shape).
 */

import { supabase } from "../supabase";
import type {
  CampaignChannelPayload,
  CampaignStatus,
  MarketingCampaignRow,
} from "../../types/marketing";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

export interface DraftInput {
  account_id: string;
  brand_id: string;
  audience_id: string;
  name: string;
  channel_payload: CampaignChannelPayload;
  /** Optional template_id (ORCH-0863) — populates marketing_campaigns.template_id
   *  on first save when the composer was opened via `?template={id}`. */
  template_id?: string;
}

export interface ScheduleInput {
  campaign_id: string;
  scheduled_for: string; // ISO timestamptz
  name: string;
  channel_payload: CampaignChannelPayload;
}

export async function createDraft(
  input: DraftInput,
): Promise<MarketingCampaignRow> {
  assertUuid(input.account_id, "createDraft.account_id");
  assertUuid(input.brand_id, "createDraft.brand_id");
  assertUuid(input.audience_id, "createDraft.audience_id");
  const channel = input.channel_payload.kind;
  // Let Postgres generate the UUID via `DEFAULT gen_random_uuid()` on the
  // marketing_campaigns.id column. The Hermes-safe `randomId()` util
  // returns a non-UUID-shaped string on RN when global `crypto` is absent,
  // which the uuid column rejects with "invalid input syntax for type uuid".
  if (input.template_id !== undefined) {
    assertUuid(input.template_id, "createDraft.template_id");
  }
  const insertPayload: Record<string, unknown> = {
    account_id: input.account_id,
    brand_id: input.brand_id,
    audience_id: input.audience_id,
    name: input.name,
    channel,
    channel_payload: input.channel_payload,
    status: "draft" as CampaignStatus,
  };
  if (input.template_id !== undefined) {
    insertPayload.template_id = input.template_id;
  }
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .insert(insertPayload)
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("createDraft: insert returned no row (RLS or constraint?)");
  }
  return data as unknown as MarketingCampaignRow;
}

export async function updateDraft(input: {
  campaign_id: string;
  name?: string;
  audience_id?: string;
  channel_payload?: CampaignChannelPayload;
}): Promise<MarketingCampaignRow> {
  assertUuid(input.campaign_id, "updateDraft.campaign_id");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.audience_id !== undefined) {
    assertUuid(input.audience_id, "updateDraft.audience_id");
    patch.audience_id = input.audience_id;
  }
  if (input.channel_payload !== undefined) {
    patch.channel_payload = input.channel_payload;
    patch.channel = input.channel_payload.kind;
  }
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .update(patch)
    .eq("id", input.campaign_id)
    .eq("status", "draft")
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("updateDraft: no row updated (campaign not found or not draft)");
  }
  return data as unknown as MarketingCampaignRow;
}

export async function scheduleSend(
  input: ScheduleInput,
): Promise<MarketingCampaignRow> {
  assertUuid(input.campaign_id, "scheduleSend.campaign_id");
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .update({
      name: input.name,
      channel: input.channel_payload.kind,
      channel_payload: input.channel_payload,
      status: "scheduled" as CampaignStatus,
      scheduled_for: input.scheduled_for,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.campaign_id)
    .in("status", ["draft", "scheduled"])
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("scheduleSend: no row updated (already sent or not found)");
  }
  return data as unknown as MarketingCampaignRow;
}

export async function cancelScheduled(
  campaignId: string,
): Promise<MarketingCampaignRow> {
  assertUuid(campaignId, "cancelScheduled.campaign_id");
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .update({
      status: "cancelled" as CampaignStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("cancelScheduled: no row updated (already sent or not scheduled)");
  }
  return data as unknown as MarketingCampaignRow;
}

export async function deleteDraft(campaignId: string): Promise<void> {
  assertUuid(campaignId, "deleteDraft.campaign_id");
  // .select("id") per I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED — verify a
  // matching draft row actually existed; if not (already sent, not a draft,
  // or RLS denied), throw rather than silently succeed.
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Draft not found, already sent, or not eligible for deletion");
  }
}

export async function listCampaigns(input: {
  account_id: string;
  status?: CampaignStatus;
  limit?: number;
}): Promise<MarketingCampaignRow[]> {
  assertUuid(input.account_id, "listCampaigns.account_id");
  let query = supabase
    .from("marketing_campaigns")
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .eq("account_id", input.account_id)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (input.status !== undefined) query = query.eq("status", input.status);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as MarketingCampaignRow[]);
}

export async function getCampaign(
  campaignId: string,
): Promise<MarketingCampaignRow | null> {
  assertUuid(campaignId, "getCampaign.campaign_id");
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as MarketingCampaignRow | null;
}

/**
 * Direct "Send now" invocation. Composer writes status='scheduled' with
 * scheduled_for=now() first, then calls this to trigger marketing-send
 * synchronously. Cron remains as the safety-net path.
 */
export async function sendNow(campaignId: string): Promise<void> {
  assertUuid(campaignId, "sendNow.campaign_id");
  const { error } = await supabase.functions.invoke("marketing-send", {
    body: { campaign_id: campaignId },
  });
  if (error) throw error;
}

/**
 * Resolve a brand's audience UUID for `kind='brand_buyers'`. The composer
 * needs an audience_id to write `marketing_campaigns.audience_id`; system-
 * generated audiences are seeded lazily via this lookup-or-create pattern.
 */
export async function ensureBrandBuyersAudience(input: {
  account_id: string;
  brand_id: string;
}): Promise<string> {
  assertUuid(input.account_id, "ensureBrandBuyersAudience.account_id");
  assertUuid(input.brand_id, "ensureBrandBuyersAudience.brand_id");
  // Find existing system-generated brand_buyers audience for this brand.
  const { data: existing, error: selErr } = await supabase
    .from("marketing_audiences")
    .select("id, query_definition")
    .eq("brand_id", input.brand_id)
    .eq("is_system_generated", true);
  if (selErr) throw selErr;
  for (const row of (existing ?? []) as Array<{
    id: string;
    query_definition: { kind?: string; brand_id?: string };
  }>) {
    if (
      row.query_definition.kind === "brand_buyers" &&
      row.query_definition.brand_id === input.brand_id
    ) {
      return row.id;
    }
  }
  // Create the system audience row.
  const { data: inserted, error: insErr } = await supabase
    .from("marketing_audiences")
    .insert({
      account_id: input.account_id,
      brand_id: input.brand_id,
      name: "All brand buyers",
      query_definition: {
        kind: "brand_buyers",
        brand_id: input.brand_id,
        payment_statuses: ["paid", "partial_refund"],
      },
      is_system_generated: true,
    })
    .select("id")
    .maybeSingle();
  if (insErr) throw insErr;
  if (inserted === null) {
    throw new Error("ensureBrandBuyersAudience: insert returned no row");
  }
  return (inserted as { id: string }).id;
}

export async function ensureEventBuyersAudience(input: {
  account_id: string;
  brand_id: string;
  event_id: string;
}): Promise<string> {
  assertUuid(input.account_id, "ensureEventBuyersAudience.account_id");
  assertUuid(input.brand_id, "ensureEventBuyersAudience.brand_id");
  assertUuid(input.event_id, "ensureEventBuyersAudience.event_id");
  const { data: existing, error: selErr } = await supabase
    .from("marketing_audiences")
    .select("id, query_definition")
    .eq("brand_id", input.brand_id)
    .eq("is_system_generated", true);
  if (selErr) throw selErr;
  for (const row of (existing ?? []) as Array<{
    id: string;
    query_definition: { kind?: string; event_id?: string };
  }>) {
    if (
      row.query_definition.kind === "event_buyers" &&
      row.query_definition.event_id === input.event_id
    ) {
      return row.id;
    }
  }
  const { data: inserted, error: insErr } = await supabase
    .from("marketing_audiences")
    .insert({
      account_id: input.account_id,
      brand_id: input.brand_id,
      name: "Event buyers",
      query_definition: {
        kind: "event_buyers",
        event_id: input.event_id,
        payment_statuses: ["paid", "partial_refund"],
      },
      is_system_generated: true,
    })
    .select("id")
    .maybeSingle();
  if (insErr) throw insErr;
  if (inserted === null) {
    throw new Error("ensureEventBuyersAudience: insert returned no row");
  }
  return (inserted as { id: string }).id;
}
