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
  MarketingBookQuote,
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
  /** #3682 — join an existing campaign as another channel of it. */
  campaign_group_id?: string;
}

export interface ScheduleInput {
  campaign_id: string;
  scheduled_for: string; // ISO timestamptz
  name: string;
  channel_payload: CampaignChannelPayload;
}

export const AUDIENCE_BRAND_MISMATCH = "audience_brand_mismatch";

/** #3682 — refuse attaching another brand's audience to this campaign. */
export async function assertAudienceMatchesCampaignBrand(input: {
  audience_id: string;
  brand_id: string;
}): Promise<void> {
  assertUuid(input.audience_id, "assertAudienceMatchesCampaignBrand.audience_id");
  assertUuid(input.brand_id, "assertAudienceMatchesCampaignBrand.brand_id");
  const { data, error } = await supabase
    .from("marketing_audiences")
    .select("id, brand_id, query_definition")
    .eq("id", input.audience_id)
    .maybeSingle();
  if (error) throw error;
  const row = data as {
    brand_id?: string | null;
    query_definition?: { kind?: string; brand_id?: string; event_id?: string } | null;
  } | null;
  const audienceBrandId =
    row !== null && typeof row.brand_id === "string" ? row.brand_id : null;
  if (audienceBrandId !== input.brand_id) {
    throw new Error(AUDIENCE_BRAND_MISMATCH);
  }

  const qd = row?.query_definition;
  if (qd === null || typeof qd !== "object") {
    throw new Error(AUDIENCE_BRAND_MISMATCH);
  }
  const queryBrandId =
    typeof qd.brand_id === "string" && qd.brand_id.length > 0
      ? qd.brand_id
      : null;
  if (queryBrandId !== null && queryBrandId !== input.brand_id) {
    throw new Error(AUDIENCE_BRAND_MISMATCH);
  }
  const kind = typeof qd.kind === "string" ? qd.kind : "";
  if (
    kind === "brand_buyers" ||
    kind === "brand_followers" ||
    kind === "brand_circle_extended" ||
    kind === "all_brand_people"
  ) {
    if (queryBrandId !== input.brand_id) {
      throw new Error(AUDIENCE_BRAND_MISMATCH);
    }
  }
  const eventId =
    typeof qd.event_id === "string" && qd.event_id.length > 0
      ? qd.event_id
      : null;
  if (kind === "event_buyers" || eventId !== null) {
    if (eventId === null) {
      throw new Error(AUDIENCE_BRAND_MISMATCH);
    }
    // orch-strict-grep-allow events-type-filter — #3682 brand-scope gate: single-row brand_id lookup by known event id before send; event_type is irrelevant to the ownership check.
    const { data: eventRow, error: eventErr } = await supabase
      .from("events")
      .select("id, brand_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) throw eventErr;
    const eventBrandId =
      eventRow !== null &&
      typeof (eventRow as { brand_id?: string }).brand_id === "string"
        ? (eventRow as { brand_id: string }).brand_id
        : null;
    if (eventBrandId !== input.brand_id) {
      throw new Error(AUDIENCE_BRAND_MISMATCH);
    }
  }
}

/** #3682 — refuse a deep-link event audience from another brand. */
export async function assertEventBelongsToBrand(input: {
  event_id: string;
  brand_id: string;
}): Promise<void> {
  assertUuid(input.event_id, "assertEventBelongsToBrand.event_id");
  assertUuid(input.brand_id, "assertEventBelongsToBrand.brand_id");
  // orch-strict-grep-allow events-type-filter — #3682 brand-scope gate: single-row brand_id lookup by known event id; event_type is irrelevant to the ownership check.
  const { data, error } = await supabase
    .from("events")
    .select("id, brand_id")
    .eq("id", input.event_id)
    .maybeSingle();
  if (error) throw error;
  const eventBrandId =
    data !== null && typeof (data as { brand_id?: string }).brand_id === "string"
      ? (data as { brand_id: string }).brand_id
      : null;
  if (eventBrandId !== input.brand_id) {
    throw new Error(
      "That audience belongs to another brand. Pick one for this brand.",
    );
  }
}

export async function createDraft(
  input: DraftInput,
): Promise<MarketingCampaignRow> {
  assertUuid(input.account_id, "createDraft.account_id");
  assertUuid(input.brand_id, "createDraft.brand_id");
  assertUuid(input.audience_id, "createDraft.audience_id");
  await assertAudienceMatchesCampaignBrand({
    audience_id: input.audience_id,
    brand_id: input.brand_id,
  });
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
  if (input.campaign_group_id !== undefined) {
    assertUuid(input.campaign_group_id, "createDraft.campaign_group_id");
    insertPayload.campaign_group_id = input.campaign_group_id;
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
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.audience_id !== undefined) {
    assertUuid(input.audience_id, "updateDraft.audience_id");
    // Load campaign brand so we can refuse a cross-brand audience swap.
    const { data: campRow, error: campErr } = await supabase
      .from("marketing_campaigns")
      .select("brand_id")
      .eq("id", input.campaign_id)
      .maybeSingle();
    if (campErr) throw campErr;
    const campaignBrandId =
      campRow !== null &&
      typeof (campRow as { brand_id?: string }).brand_id === "string"
        ? (campRow as { brand_id: string }).brand_id
        : null;
    if (campaignBrandId === null) {
      throw new Error("updateDraft: campaign brand missing");
    }
    await assertAudienceMatchesCampaignBrand({
      audience_id: input.audience_id,
      brand_id: campaignBrandId,
    });
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
    throw new Error(
      "updateDraft: no row updated (campaign not found or not draft)",
    );
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
    throw new Error(
      "cancelScheduled: no row updated (already sent or not scheduled)",
    );
  }
  return data as unknown as MarketingCampaignRow;
}

/**
 * #4273 — the other drafts in a campaign's group (not the lead). A tab that
 * closed with the review open leaves its sibling drafts behind; the composer
 * reads them so it can adopt or discard them instead of colliding with them.
 *
 * The group is COALESCE(campaign_group_id, id) of the lead, the same rule the
 * server uses: a sibling reopened from Drafts belongs to its head's group, and
 * the head comes back flagged `isHead` so it is never discarded.
 * RLS (`marketing_campaigns_select`) admits the owner or a brand member.
 */
export async function listGroupDrafts(
  leadCampaignId: string,
): Promise<{
  /** COALESCE(campaign_group_id, id) of the lead: the id new siblings join. */
  groupId: string;
  drafts: Array<{ id: string; channel: "email" | "sms" | "push"; isHead: boolean }>;
}> {
  assertUuid(leadCampaignId, "listGroupDrafts.lead_campaign_id");
  const lead = await supabase
    .from("marketing_campaigns")
    .select("id, campaign_group_id")
    .eq("id", leadCampaignId)
    .maybeSingle();
  if (lead.error) throw lead.error;
  if (lead.data === null) throw new Error("listGroupDrafts: campaign not found");
  const row = lead.data as { id: string; campaign_group_id: string | null };
  const group = row.campaign_group_id ?? row.id;
  assertUuid(group, "listGroupDrafts.group_id");
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("id, channel")
    .or(`campaign_group_id.eq.${group},id.eq.${group}`)
    .eq("status", "draft")
    .neq("id", leadCampaignId);
  if (error) throw error;
  return {
    groupId: group,
    drafts: ((data ?? []) as Array<{ id: string; channel: "email" | "sms" | "push" }>).map((draft) => ({
      ...draft,
      isHead: draft.id === group,
    })),
  };
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
    throw new Error(
      "Draft not found, already sent, or not eligible for deletion",
    );
  }
}

/**
 * #2514 — BRAND is the scope, not account.
 *
 * This used to filter on `account_id` alone and never mention `brand_id`,
 * which broke in both directions at once: standing inside Brand A you saw
 * your OWN campaigns from Brand B, and you could not see campaigns created
 * by anyone else on the brand you were actually in. During the 2026-08-24
 * blast incident that meant the person with authority to re-send could not
 * find the campaign at all.
 *
 * `account_id` is deliberately GONE as a filter. RLS on
 * `marketing_campaigns_select` already admits the owner OR a brand team
 * member, so brand + RLS returns exactly the rows this caller may see —
 * and keeping the account filter is precisely what hid teammates' work.
 */
export async function listCampaigns(input: {
  brand_id: string;
  status?: CampaignStatus;
  limit?: number;
}): Promise<MarketingCampaignRow[]> {
  assertUuid(input.brand_id, "listCampaigns.brand_id");
  let query = supabase
    .from("marketing_campaigns")
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .eq("brand_id", input.brand_id)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (input.status !== undefined) query = query.eq("status", input.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as MarketingCampaignRow[];
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
export class MarketingBookSendError extends Error {
  constructor(
    public readonly code: string,
    public readonly refreshedPreview: MarketingBookQuote | null,
  ) {
    super(code);
    this.name = "MarketingBookSendError";
  }
}
export async function getOrCreateMarketingBookAudience(input: {
  actor_id: string;
  brand_id: string;
}): Promise<{ audienceId: string; activeBookTotal: number }> {
  const { data, error } = await supabase.rpc(
    "biz_get_or_create_marketing_book_audience",
    { p_actor_id: input.actor_id, p_brand_id: input.brand_id },
  );
  if (error) throw error;
  return data as { audienceId: string; activeBookTotal: number };
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
