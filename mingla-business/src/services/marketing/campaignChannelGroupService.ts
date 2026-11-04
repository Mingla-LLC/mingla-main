/**
 * #3682 wave 2 — one campaign on several channels (Seth, 2026-09-30).
 *
 * The composer writes the lead channel exactly as before. Every extra channel
 * the host ticks under "Also send by" becomes a sibling draft that shares the
 * lead's campaign_group_id, gets its own sealed server preview (reach, cost,
 * allowance) and is confirmed right after the lead. Push is free and
 * unlimited; email and SMS keep their monthly allowance; the rolling-week
 * warning counts the group once (server side).
 */
import type {
  CampaignChannelPayload,
  MarketingBookQuote,
  SealedMarketingAudienceKind,
} from "../../types/marketing";
import {
  confirmMarketingBook,
  createDraft,
  deleteDraft,
  MarketingBookSendError,
  previewMarketingBook,
  updateDraft,
} from "./marketingCampaignService";

export type CampaignChannel = "email" | "sms" | "push";

export interface SiblingChannelState {
  channel: CampaignChannel;
  campaignId: string;
  quote: MarketingBookQuote | null;
  requestId: string;
  error: string | null;
}

export interface PrepareSiblingInput {
  leadCampaignId: string;
  accountId: string;
  brandId: string;
  audienceId: string;
  audienceKind: SealedMarketingAudienceKind;
  channel: CampaignChannel;
  name: string;
  payload: CampaignChannelPayload;
  existingCampaignId: string | null;
}

export function newSiblingRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

export function siblingErrorMessage(channel: CampaignChannel, error: unknown): string {
  const code = error instanceof MarketingBookSendError
    ? error.code
    : error instanceof Error ? error.message : "FAILED";
  const label = channel === "push" ? "Push" : channel === "sms" ? "SMS" : "Email";
  if (code.includes("ZERO_RECIPIENTS")) return `${label}: no one in this audience can receive it.`;
  if (code.includes("MONTHLY_CAP")) return `${label}: this would go over your monthly limit.`;
  if (code.includes("AUDIENCE_NOT_FOUND")) {
    return channel === "push"
      ? "Push reaches Mingla accounts only: pick Your Book, Followers, Friends of followers or a saved group."
      : `${label} isn't available for this audience.`;
  }
  if (code.includes("FLAG_DISABLED")) return `${label} isn't switched on for this audience yet.`;
  if (code.includes("FORBIDDEN")) return `You can't send ${label.toLowerCase()} for this brand.`;
  return `${label} preview is unavailable. Refresh before sending.`;
}

/** Create or refresh one sibling draft, then take its sealed server preview. */
export async function prepareSiblingChannel(
  input: PrepareSiblingInput,
): Promise<SiblingChannelState> {
  let campaignId = input.existingCampaignId;
  if (campaignId === null) {
    const row = await createDraft({
      account_id: input.accountId,
      brand_id: input.brandId,
      audience_id: input.audienceId,
      name: input.name,
      channel_payload: input.payload,
      campaign_group_id: input.leadCampaignId,
    });
    campaignId = row.id;
  } else {
    await updateDraft({
      campaign_id: campaignId,
      name: input.name,
      audience_id: input.audienceId,
      channel_payload: input.payload,
    });
  }
  try {
    const quote = await previewMarketingBook({
      campaignId,
      audienceKind: input.audienceKind,
      channel: input.channel,
    });
    return { channel: input.channel, campaignId, quote, requestId: newSiblingRequestId(), error: null };
  } catch (error) {
    return {
      channel: input.channel,
      campaignId,
      quote: null,
      requestId: newSiblingRequestId(),
      error: siblingErrorMessage(input.channel, error),
    };
  }
}

export interface SiblingSendResult {
  channel: CampaignChannel;
  ok: boolean;
  delivered: number;
  message: string | null;
}

/** Confirm every previewed sibling after the lead succeeded, one at a time. */
export async function confirmSiblingChannels(input: {
  siblings: SiblingChannelState[];
  audienceKind: SealedMarketingAudienceKind;
  scheduledFor: string | null;
}): Promise<SiblingSendResult[]> {
  const results: SiblingSendResult[] = [];
  for (const sibling of input.siblings) {
    if (sibling.quote === null) {
      results.push({ channel: sibling.channel, ok: false, delivered: 0, message: sibling.error });
      continue;
    }
    try {
      const sent = await confirmMarketingBook({
        campaign_id: sibling.campaignId,
        client_request_id: sibling.requestId,
        quote: sibling.quote,
        scheduled_for: input.scheduledFor,
        audience_kind: input.audienceKind,
        channel: sibling.channel,
      });
      results.push({ channel: sibling.channel, ok: true, delivered: sent.delivered, message: null });
    } catch (error) {
      results.push({
        channel: sibling.channel,
        ok: false,
        delivered: 0,
        message: siblingErrorMessage(sibling.channel, error),
      });
    }
  }
  return results;
}

/** Drop sibling drafts the host backed out of (they never sent). */
export async function discardSiblingDrafts(campaignIds: string[]): Promise<void> {
  for (const id of campaignIds) {
    try {
      await deleteDraft(id);
    } catch {
      // Already confirmed or gone: nothing left to discard.
    }
  }
}
