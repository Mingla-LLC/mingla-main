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
  CampaignGroupFigures,
  MarketingBookQuote,
  SealedMarketingAudienceKind,
} from "../../types/marketing";
import {
  createDraft,
  deleteDraft,
  listGroupDrafts,
  MarketingBookSendError,
  updateDraft,
} from "./marketingCampaignService";
import {
  confirmMarketingBook,
  previewMarketingBook,
  previewMarketingCampaignGroup,
} from "./marketingBookSendService";
import { partialSendLine } from "./campaignSendCopy";

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
  if (code.includes("ALL_RECIPIENTS_FAILED")) {
    return `${label}: the provider couldn't reach anyone. It is marked Failed in Campaigns.`;
  }
  if (code.includes("AUDIENCE_NOT_FOUND")) {
    return channel === "push"
      ? "Push reaches Mingla accounts only, so it can't go to a buyer list."
      : `${label} isn't available for this audience.`;
  }
  if (code.includes("FLAG_DISABLED")) return `${label} isn't switched on for this audience yet.`;
  if (code.includes("FORBIDDEN")) return `You can't send ${label.toLowerCase()} for this brand.`;
  return `${label} preview is unavailable. Refresh before sending.`;
}

/**
 * #3682 wave 3 — every preview of a campaign (first open, schedule, retry)
 * goes through the lane of the channel being sent, so a push-only campaign
 * never previews as email.
 */
export function campaignPreviewInput(
  campaignId: string,
  audienceKind: SealedMarketingAudienceKind | null,
  channel: CampaignChannel,
): { campaignId: string; audienceKind: SealedMarketingAudienceKind; channel: CampaignChannel } {
  return { campaignId, audienceKind: audienceKind ?? "all_brand_people", channel };
}

/** Push to Friends of followers needs the same three switches the server checks. */
export function extendedPushReady(
  roster: boolean | undefined,
  controlsIos: boolean | undefined,
  controlsAndroid: boolean | undefined,
): boolean {
  return roster === true && controlsIos === true && controlsAndroid === true;
}

export { partialSendLine } from "./campaignSendCopy";

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

/**
 * #4273 — write every extra method as a sibling draft, then take ONE locked
 * preview of the whole campaign. Each method keeps its own quote to confirm;
 * `group` holds the figures that count each person once. All server figures.
 */
export async function prepareCampaignGroupPreview(input: {
  leadCampaignId: string;
  leadChannel: CampaignChannel;
  accountId: string;
  brandId: string;
  audienceId: string;
  name: string;
  extras: Array<{
    channel: CampaignChannel;
    payload: CampaignChannelPayload;
    existingCampaignId: string | null;
  }>;
}): Promise<{
  lead: MarketingBookQuote | null;
  leadError: string | null;
  group: CampaignGroupFigures | null;
  siblings: SiblingChannelState[];
}> {
  // A tab that closed with the review open leaves sibling drafts in the group.
  // Adopt one for a method the host ticked again (a second draft for the same
  // method would hit the one-per-method index); drop the rest.
  const { adopt: adopted, keep } = await settleLeftoverGroupDraftsDetailed({
    leadCampaignId: input.leadCampaignId,
    leadChannel: input.leadChannel,
    extras: input.extras,
  });
  const drafts: Array<{ channel: CampaignChannel; campaignId: string }> = [];
  for (const extra of input.extras) {
    let campaignId = extra.existingCampaignId ?? adopted.get(extra.channel) ?? null;
    if (campaignId === null) {
      const row = await createDraft({
        account_id: input.accountId,
        brand_id: input.brandId,
        audience_id: input.audienceId,
        name: input.name,
        channel_payload: extra.payload,
        campaign_group_id: input.leadCampaignId,
      });
      campaignId = row.id;
    } else {
      await updateDraft({
        campaign_id: campaignId,
        name: input.name,
        audience_id: input.audienceId,
        channel_payload: extra.payload,
      });
    }
    drafts.push({ channel: extra.channel, campaignId });
  }
  // Name exactly the drafts being sent, so nothing else in the group is priced.
  const preview = await previewMarketingCampaignGroup(input.leadCampaignId, [
    input.leadCampaignId,
    ...drafts.map((draft) => draft.campaignId),
  ]);
  // Never the group head: it is the host's original campaign (#4273 P2-1).
  const unlisted = (preview.unlistedDraftIds ?? []).filter((id) => !keep.has(id));
  if (unlisted.length > 0) {
    void discardSiblingDrafts(unlisted);
  }
  const lead = preview.methods.find((method) => method.channel === input.leadChannel);
  return {
    lead: lead?.quote ?? null,
    leadError: lead?.error ?? (lead === undefined ? "BOOK_BLAST_FAILED" : null),
    group: preview.group,
    siblings: drafts.map((draft) => {
      const method = preview.methods.find((row) => row.campaignId === draft.campaignId);
      return {
        channel: draft.channel,
        campaignId: draft.campaignId,
        quote: method?.quote ?? null,
        requestId: newSiblingRequestId(),
        error: method?.quote
          ? null
          : siblingErrorMessage(draft.channel, new Error(method?.error ?? "FAILED")),
      };
    }),
  };
}

export interface SiblingSendResult {
  channel: CampaignChannel;
  ok: boolean;
  delivered: number;
  failed: number;
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
      results.push({ channel: sibling.channel, ok: false, delivered: 0, failed: 0, message: sibling.error });
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
      const label = sibling.channel === "push" ? "Push" : sibling.channel === "sms" ? "SMS" : "Email";
      results.push({
        channel: sibling.channel,
        ok: true,
        delivered: sent.delivered,
        failed: sent.failed,
        message: sent.failed > 0 ? `${label}: ${partialSendLine(sent.delivered, sent.failed)}` : null,
      });
    } catch (error) {
      results.push({
        channel: sibling.channel,
        ok: false,
        delivered: 0,
        failed: 0,
        message: siblingErrorMessage(sibling.channel, error),
      });
    }
  }
  return results;
}

/**
 * #4273 — leftover sibling drafts in a group. A draft on the lead's method, or
 * on a method the host did not tick, is deleted (it would collide with the lead
 * or be counted for a method nobody picked). A draft on a ticked method that
 * has no draft in memory is returned to be reused. Returns method → draft id.
 */
export async function settleLeftoverGroupDrafts(input: {
  leadCampaignId: string;
  leadChannel: CampaignChannel;
  extras: ReadonlyArray<{ channel: CampaignChannel; existingCampaignId: string | null }>;
}): Promise<Map<CampaignChannel, string>> {
  return (await settleLeftoverGroupDraftsDetailed(input)).adopt;
}

/**
 * Same as settleLeftoverGroupDrafts, and also returns the ids that must never
 * be discarded (the group head when the lead is a sibling reopened from Drafts).
 */
async function settleLeftoverGroupDraftsDetailed(input: {
  leadCampaignId: string;
  leadChannel: CampaignChannel;
  extras: ReadonlyArray<{ channel: CampaignChannel; existingCampaignId: string | null }>;
}): Promise<{ adopt: Map<CampaignChannel, string>; keep: Set<string> }> {
  const leftovers = await listGroupDrafts(input.leadCampaignId);
  const keep = new Set(leftovers.filter((draft) => draft.isHead).map((draft) => draft.id));
  const known = new Set(
    input.extras.flatMap((extra) => (extra.existingCampaignId === null ? [] : [extra.existingCampaignId])),
  );
  const adopt = new Map<CampaignChannel, string>();
  const discard: string[] = [];
  for (const draft of leftovers) {
    if (known.has(draft.id)) continue;
    const extra = input.extras.find((row) => row.channel === draft.channel);
    if (
      draft.channel !== input.leadChannel &&
      extra !== undefined &&
      extra.existingCampaignId === null &&
      !adopt.has(draft.channel)
    ) {
      adopt.set(draft.channel, draft.id);
    } else if (!draft.isHead) {
      // The head is the host's original campaign: skipped, never deleted.
      discard.push(draft.id);
    }
  }
  if (discard.length > 0) await discardSiblingDrafts(discard);
  return { adopt, keep };
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
