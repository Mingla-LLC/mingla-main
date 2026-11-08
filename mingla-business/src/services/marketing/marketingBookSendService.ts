/**
 * marketingBookSendService — the quote-then-confirm send path of a Blast
 * (Book, followers, Friends of followers, manual groups and push).
 *
 * Split out of marketingCampaignService (#3682) so the send path loads only
 * with the composer: marketingCampaignService is imported by the eager
 * campaign list hook, and this code is only reached from compose.
 *
 * Service-layer error contract (Constitution #3): every function THROWS on
 * error; MarketingBookSendError carries the server code and any refreshed
 * quote.
 */

import { supabase } from "../supabase";
import type {
  CampaignGroupPreview,
  CampaignStatus,
  MarketingBookQuote,
  SealedMarketingAudienceKind,
} from "../../types/marketing";
import { MarketingBookSendError } from "./marketingCampaignService";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** #4273 — one other campaign in the lead's group, any status. */
export interface GroupMemberRow {
  id: string;
  channel: "email" | "sms" | "push";
  status: CampaignStatus;
  isHead: boolean;
  /** The row's updated_at, as the server returned it (follow-up 1). */
  updatedAt: string;
}

/**
 * #4273 — the other campaigns in a campaign's group (not the lead). A tab that
 * closed with the review open leaves its sibling drafts behind; the composer
 * reads them so it can adopt or discard them instead of colliding with them.
 *
 * The group is COALESCE(campaign_group_id, id) of the lead, the same rule the
 * server uses: a sibling reopened from Drafts belongs to its head's group, and
 * the head comes back flagged `isHead` so it is never discarded.
 *
 * `members` holds every status (follow-up 2: a sent or scheduled method must be
 * named for what it is); `drafts` is the draft subset. Each row carries its
 * `updatedAt`, so the composer touches only drafts it saw unchanged
 * (follow-up 1).
 * Lives here, not in marketingCampaignService, so it loads only with the
 * composer (the campaign list loads that service eagerly; #3493 budget).
 * RLS (`marketing_campaigns_select`) admits the owner or a brand member.
 */
export async function listGroupDrafts(
  leadCampaignId: string,
): Promise<{
  /** COALESCE(campaign_group_id, id) of the lead: the id new siblings join. */
  groupId: string;
  drafts: GroupMemberRow[];
  members: GroupMemberRow[];
}> {
  if (!UUID_RE.test(leadCampaignId)) throw new Error("listGroupDrafts.lead_campaign_id: expected UUID");
  const lead = await supabase
    .from("marketing_campaigns")
    .select("id, campaign_group_id")
    .eq("id", leadCampaignId)
    .maybeSingle();
  if (lead.error) throw lead.error;
  if (lead.data === null) throw new Error("listGroupDrafts: campaign not found");
  const row = lead.data as { id: string; campaign_group_id: string | null };
  const group = row.campaign_group_id ?? row.id;
  if (!UUID_RE.test(group)) throw new Error("listGroupDrafts.group_id: expected UUID");
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("id, channel, status, updated_at")
    .or(`campaign_group_id.eq.${group},id.eq.${group}`)
    .neq("id", leadCampaignId);
  if (error) throw error;
  const members = ((data ?? []) as Array<{
    id: string;
    channel: "email" | "sms" | "push";
    status: CampaignStatus;
    updated_at: string;
  }>).map((member) => ({
    id: member.id,
    channel: member.channel,
    status: member.status,
    isHead: member.id === group,
    updatedAt: member.updated_at,
  }));
  return {
    groupId: group,
    drafts: members.filter((member) => member.status === "draft"),
    members,
  };
}


async function parseMarketingBookError(
  error: unknown,
): Promise<MarketingBookSendError> {
  const context = (error as { context?: { json?: () => Promise<unknown> } })
    .context;
  const payload =
    context?.json === undefined
      ? null
      : ((await context.json().catch(() => null)) as {
          error?: string;
          preview?: MarketingBookQuote;
        } | null);
  return new MarketingBookSendError(
    payload?.error ?? "BOOK_BLAST_FAILED",
    payload?.preview ?? null,
  );
}
export async function previewMarketingBook(
  input: string | {
    campaignId: string;
    audienceKind: SealedMarketingAudienceKind;
    /** #3682 wave 2 — a push campaign previews through the push lane. */
    channel?: "email" | "sms" | "push";
  },
): Promise<MarketingBookQuote> {
  const audienceKind = typeof input === "string" ? "all_brand_people" : input.audienceKind;
  const isPush = typeof input !== "string" && input.channel === "push";
  const action = isPush ? "preview_push_v1" : audienceKind === "combined_sources"
    ? "preview_combined_v1"
    : audienceKind === "manual_group"
    ? "preview_people_v2"
    : audienceKind === "brand_followers" || audienceKind === "brand_circle_extended"
      ? "preview_circle_v1"
      : "preview_book_v1";
  const { data, error } = await supabase.functions.invoke("marketing-send", {
    body: { action, campaign_id: typeof input === "string" ? input : input.campaignId },
  });
  if (error) throw await parseMarketingBookError(error);
  return data as MarketingBookQuote;
}
/**
 * #4273 — every method of one campaign previewed at one moment. Each method
 * keeps its own lockable quote; `group` holds the figures that count each
 * person once. All of it is the server's.
 */
export async function previewMarketingCampaignGroup(
  leadCampaignId: string,
  /** #4273 — the drafts being sent (lead first); only these are priced. */
  campaignIds?: readonly string[],
): Promise<CampaignGroupPreview> {
  const { data, error } = await supabase.functions.invoke("marketing-send", {
    body: {
      action: "preview_group_v1",
      campaign_id: leadCampaignId,
      ...(campaignIds === undefined ? {} : { campaign_ids: [...campaignIds] }),
    },
  });
  if (error) throw await parseMarketingBookError(error);
  return data as CampaignGroupPreview;
}
export async function confirmMarketingBook(input: {
  campaign_id: string;
  client_request_id: string;
  quote: MarketingBookQuote;
  scheduled_for: string | null;
  audience_kind?: SealedMarketingAudienceKind;
  /** #3682 wave 2 — a push campaign confirms through the push lane. */
  channel?: "email" | "sms" | "push";
}): Promise<ConfirmMarketingBookResult> {
  const { data, error } = await supabase.functions.invoke("marketing-send", {
    body: {
      action: input.channel === "push"
        ? "confirm_push_v1"
        : input.audience_kind === "combined_sources"
        ? "confirm_combined_v1"
        : input.audience_kind === "manual_group"
        ? "confirm_people_v2"
        : input.audience_kind === "brand_followers" || input.audience_kind === "brand_circle_extended"
          ? "confirm_circle_v1"
          : "confirm_book_v1",
      campaign_id: input.campaign_id,
      client_request_id: input.client_request_id,
      quoteHash: input.quote.quoteHash,
      quotedAt: input.quote.quotedAt,
      expectedCostMinor: input.quote.estimatedCostMinor,
      currency: input.quote.currency,
      scheduledFor: input.scheduled_for,
    },
  });
  if (error) {
    throw await parseMarketingBookError(error);
  }
  const resultState = (data as { resultState?: string } | null)?.resultState;
  if (resultState === "scheduled") {
    return {
      mode: "scheduled",
      delivered: 0,
      deferred: 0,
      failed: 0,
      skippedAfterConfirm: 0,
    };
  }
  if (resultState === "in_progress") {
    return {
      mode: "in_progress",
      delivered: 0,
      deferred: 0,
      failed: 0,
      skippedAfterConfirm: 0,
    };
  }
  const dispatch = (
    data as {
      dispatch?: {
        processed?: number;
        succeeded?: number;
        failed?: number;
        delivered?: number;
        deferred?: number;
        recipient_failed?: number;
        skipped_after_confirm?: number;
        preview_skipped?: number;
        errors?: unknown[];
      };
    } | null
  )?.dispatch;
  // #3682 wave 3 — some recipients can fail at the provider while others are
  // delivered. That is a partial send, reported as such (sent N, failed M),
  // never a blanket dispatch error. Nothing delivered or held is still a
  // failure, and the counts must add up to the sealed reach.
  const recipientFailed = dispatch?.recipient_failed ?? -1;
  const accounted = (dispatch?.delivered ?? -1) + (dispatch?.deferred ?? -1) +
    recipientFailed + (dispatch?.skipped_after_confirm ?? -1);
  // #4273 — a combined email or SMS send can go out to fewer than it quoted, because
  // the server keeps contact-match skips out of skipped_after_confirm. Below the quote
  // is a normal send and reads exactly like one; above it is still a real mismatch.
  // Push is by account, has no contact match, and stays exact.
  const countsAddUp = input.audience_kind === "combined_sources" && input.channel !== "push"
    ? accounted <= input.quote.reachableCount
    : accounted === input.quote.reachableCount;
  if (
    dispatch?.processed !== 1 ||
    dispatch.succeeded !== 1 ||
    dispatch.failed !== 0 ||
    dispatch.preview_skipped !== 0 ||
    !Number.isInteger(recipientFailed) ||
    recipientFailed < 0 ||
    !Number.isInteger(dispatch.skipped_after_confirm) ||
    (dispatch.skipped_after_confirm ?? -1) < 0 ||
    !countsAddUp ||
    !Array.isArray(dispatch.errors) ||
    dispatch.errors.length !== 0
  ) {
    throw new MarketingBookSendError("BOOK_BLAST_DISPATCH_FAILED", null);
  }
  if (recipientFailed > 0 && (dispatch.delivered ?? 0) + (dispatch.deferred ?? 0) === 0) {
    // Confirmed, but the provider took none of them.
    throw new MarketingBookSendError("BOOK_BLAST_ALL_RECIPIENTS_FAILED", null);
  }
  const delivered = dispatch.delivered ?? 0;
  const deferred = dispatch.deferred ?? 0;
  const skippedAfterConfirm = dispatch.skipped_after_confirm ?? 0;
  return {
    mode: recipientFailed > 0 ? "partial" : deferred > 0 ? "deferred" : "sent",
    delivered,
    deferred,
    failed: recipientFailed,
    skippedAfterConfirm,
  };
}

export interface ConfirmMarketingBookResult {
  mode: "sent" | "deferred" | "scheduled" | "in_progress" | "partial";
  delivered: number;
  deferred: number;
  /** #3682 — recipients the provider turned down in a send-now. */
  failed: number;
  skippedAfterConfirm: number;
}
