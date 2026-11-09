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
  CampaignStatus,
  MarketingBookQuote,
  SealedMarketingAudienceKind,
} from "../../types/marketing";
import {
  createDraft,
  deleteDraft,
  DraftChangedElsewhereError,
  MarketingBookSendError,
  updateDraft,
} from "./marketingCampaignService";
import {
  confirmMarketingBook,
  listGroupDrafts,
  previewMarketingBook,
  previewMarketingCampaignGroup,
} from "./marketingBookSendService";
import { bookPricingErrorCopy, partialSendLine } from "./campaignSendCopy";

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
  // #4273 P2-a — a price failure reads exactly as it does for the lead method.
  const pricing = bookPricingErrorCopy(code);
  if (pricing !== null) {
    return pricing.startsWith(label) ? pricing : `${label}: ${pricing}`;
  }
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
  /**
   * #4273 follow-up 1 — group drafts this composer saw (id -> updated_at), at
   * load or from its own writes. This call records its own writes here.
   */
  seen: Map<string, string>;
}): Promise<{
  lead: MarketingBookQuote | null;
  leadError: string | null;
  group: CampaignGroupFigures | null;
  siblings: SiblingChannelState[];
}> {
  // A tab that closed with the review open leaves sibling drafts in the group.
  // Adopt one for a method the host ticked again (a second draft for the same
  // method would hit the one-per-method index); drop the rest.
  const { adopt: adopted, keep, groupId } = await settleLeftoverGroupDraftsDetailed({
    leadCampaignId: input.leadCampaignId,
    leadChannel: input.leadChannel,
    extras: input.extras,
    seen: input.seen,
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
        // The real group, COALESCE(campaign_group_id, id): a sibling reopened
        // from Drafts is not a group of its own (#4273).
        campaign_group_id: groupId,
      });
      campaignId = row.id;
      rememberWrite(input.seen, row);
    } else {
      // Only the version this composer saw: a draft another tab changed since
      // is theirs (follow-up 1).
      const expected = input.seen.get(campaignId);
      try {
        const row = await updateDraft({
          campaign_id: campaignId,
          name: input.name,
          audience_id: input.audienceId,
          channel_payload: extra.payload,
          ...(expected !== undefined ? { expectedUpdatedAt: expected } : {}),
        });
        rememberWrite(input.seen, row);
      } catch (error) {
        if (error instanceof DraftChangedElsewhereError) {
          throw new GroupDraftInUseElsewhereError(extra.channel);
        }
        throw error;
      }
    }
    drafts.push({ channel: extra.channel, campaignId });
  }
  // Name exactly the drafts being sent, so nothing else in the group is priced.
  const preview = await previewMarketingCampaignGroup(input.leadCampaignId, [
    input.leadCampaignId,
    ...drafts.map((draft) => draft.campaignId),
  ]);
  // Never the group head: it is the host's original campaign (#4273 P2-1).
  // Only drafts this composer saw: one another tab is still writing is theirs.
  const unlisted = (preview.unlistedDraftIds ?? [])
    .filter((id) => !keep.has(id) && input.seen.has(id));
  if (unlisted.length > 0) {
    void discardSiblingDrafts(unlisted, input.seen);
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
  /**
   * #4273 (tester P3) — false when a retry cannot help: nobody in the
   * audience can receive this method (for SMS, often because every number is
   * in a country Mingla can't text yet). The banner then never says "retry".
   */
  retryable?: boolean;
}

/** #4273 — the words for a method that reaches nobody, so it is not sent. */
export function siblingReachesNobodyMessage(
  channel: CampaignChannel,
  quote: MarketingBookQuote,
): string {
  const label = channel === "push" ? "Push" : channel === "sms" ? "SMS" : "Email";
  return channel === "sms" && (quote.unpricedCount ?? 0) > 0
    ? `${label}: nobody here can be texted. Mingla can't text their country yet.`
    : `${label}: no one in this audience can receive it.`;
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
      results.push({ channel: sibling.channel, ok: false, delivered: 0, failed: 0, message: sibling.error, retryable: true });
      continue;
    }
    if (sibling.quote.reachableCount === 0) {
      // Nothing to send: confirming would only be refused. Not a retry case.
      results.push({
        channel: sibling.channel,
        ok: false,
        delivered: 0,
        failed: 0,
        message: siblingReachesNobodyMessage(sibling.channel, sibling.quote),
        retryable: false,
      });
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
        retryable: !(error instanceof MarketingBookSendError &&
          error.code.includes("ZERO_RECIPIENTS")),
      });
    }
  }
  return results;
}

/**
 * #4273 — leftover sibling drafts in a group. A draft on the lead's method, or
 * on a method the host did not tick, is deleted (it would collide with the lead
 * or be counted for a method nobody picked). A draft on a ticked method that
 * has no draft in memory is returned to be reused. Returns method -> draft id.
 *
 * Follow-up 1 (invariant I-4273-GROUP-DRAFT-CLEANUP-SEEN-ONLY): only a
 * draft this composer saw, with the same updated_at, may be adopted or
 * deleted. Any other draft belongs to another tab or device and is left alone;
 * if it holds a method this composer wants, the host is told instead.
 * Follow-up 2: a method the campaign already scheduled or sent is named for
 * what it is, before anything is written or deleted.
 */
export async function settleLeftoverGroupDrafts(input: {
  leadCampaignId: string;
  leadChannel: CampaignChannel;
  extras: ReadonlyArray<{ channel: CampaignChannel; existingCampaignId: string | null }>;
  seen: ReadonlyMap<string, string>;
}): Promise<Map<CampaignChannel, string>> {
  return (await settleLeftoverGroupDraftsDetailed(input)).adopt;
}

/** A member in these states keeps its method: it went out, or will. */
const METHOD_HOLDING_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>([
  "scheduled",
  "sending",
  "sent",
]);

/**
 * Same as settleLeftoverGroupDrafts, and also returns the ids that must never
 * be discarded (the group head when the lead is a sibling reopened from Drafts).
 */
async function settleLeftoverGroupDraftsDetailed(input: {
  leadCampaignId: string;
  leadChannel: CampaignChannel;
  extras: ReadonlyArray<{ channel: CampaignChannel; existingCampaignId: string | null }>;
  seen: ReadonlyMap<string, string>;
}): Promise<{ adopt: Map<CampaignChannel, string>; keep: Set<string>; groupId: string }> {
  const { groupId, drafts: leftovers, members } = await listGroupDrafts(input.leadCampaignId);
  const keep = new Set(leftovers.filter((draft) => draft.isHead).map((draft) => draft.id));
  const wants = (member: { id: string; channel: CampaignChannel }): boolean =>
    member.channel === input.leadChannel ||
    input.extras.some((extra) => extra.channel === member.channel && extra.existingCampaignId !== member.id);
  // Follow-up 2. The head is the host's original campaign and a scheduled or
  // sent method is spoken for: never reused, overwritten or deleted from here.
  // If this composer wants that method, say what holds it. A failed or
  // cancelled method no longer holds its slot (#4273 extra b).
  for (const member of members) {
    const holds = member.status === "draft" ? member.isHead : METHOD_HOLDING_STATUSES.has(member.status);
    if (holds && wants(member)) {
      throw new GroupHeadMethodTakenError(member.channel, member.status, member.isHead);
    }
  }
  const known = new Set(
    input.extras.flatMap((extra) => (extra.existingCampaignId === null ? [] : [extra.existingCampaignId])),
  );
  const ours = leftovers.filter((draft) => !draft.isHead && !known.has(draft.id));
  // Follow-up 1. A draft this composer did not see, or saw before someone
  // changed it, belongs to another tab: refuse before writing anything.
  for (const draft of ours) {
    if (input.seen.get(draft.id) !== draft.updatedAt && wants(draft)) {
      throw new GroupDraftInUseElsewhereError(draft.channel);
    }
  }
  const adopt = new Map<CampaignChannel, string>();
  const discard: string[] = [];
  for (const draft of ours) {
    if (input.seen.get(draft.id) !== draft.updatedAt) continue; // another tab's
    const extra = input.extras.find((row) => row.channel === draft.channel);
    if (
      draft.channel !== input.leadChannel &&
      extra !== undefined &&
      extra.existingCampaignId === null &&
      !adopt.has(draft.channel)
    ) {
      adopt.set(draft.channel, draft.id);
    } else {
      discard.push(draft.id);
    }
  }
  if (discard.length > 0) await discardSiblingDrafts(discard, input.seen);
  return { adopt, keep, groupId };
}

const METHOD_LABEL: Record<CampaignChannel, string> = { email: "Email", sms: "SMS", push: "Push" };

/**
 * #4273 — this composer wants a method the campaign already uses. The message
 * says what holds it (follow-up 2): a draft, a scheduled send, one that went
 * out. The class name is kept for imports.
 */
export class GroupHeadMethodTakenError extends Error {
  constructor(
    public readonly channel: CampaignChannel,
    public readonly status: CampaignStatus = "draft",
    public readonly isHead: boolean = true,
  ) {
    super(groupMethodTakenMessage(channel, status, isHead));
    this.name = "GroupHeadMethodTakenError";
  }
}

export function groupMethodTakenMessage(
  channel: CampaignChannel,
  status: CampaignStatus,
  isHead: boolean,
): string {
  const label = METHOD_LABEL[channel];
  const subject = isHead ? "Your original campaign" : "This campaign";
  switch (status) {
    case "draft":
      return `${subject} already sends by ${label}. Open it from Drafts to send by ${label}, or untick ${label} here.`;
    case "scheduled":
      return `${subject} is already scheduled to send by ${label}. Untick ${label} here, or cancel that send in Campaigns first.`;
    case "sending":
    case "sent":
      return `${subject} already went out by ${label}. Untick ${label} here. To send by ${label} again, start a new campaign.`;
    case "failed":
    case "cancelled":
      return `${subject}'s ${label} didn't go out. Untick ${label} here, or delete that send in Campaigns and try again.`;
    default: {
      const _exhaustive: never = status;
      return String(_exhaustive);
    }
  }
}

/** #4273 follow-up 1 — a draft for this method is being written in another tab. */
export class GroupDraftInUseElsewhereError extends Error {
  constructor(public readonly channel: CampaignChannel) {
    const label = METHOD_LABEL[channel];
    super(
      `This campaign is open in another tab or device, and that tab is using ${label}. Close it there, or reload here and try again.`,
    );
    this.name = "GroupDraftInUseElsewhereError";
  }
}

/** Record this composer's own write so it may later adopt or drop the draft. */
function rememberWrite(seen: Map<string, string>, row: { id: string; updated_at?: string } | undefined): void {
  if (row !== undefined && typeof row.updated_at === "string") seen.set(row.id, row.updated_at);
}

/**
 * #4273 — a draft save the database refused, in plain words. Never the raw
 * database text: hosts saw "duplicate key value violates unique constraint …".
 */
export function draftSaveErrorMessage(error: unknown): string {
  const text = error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";
  const code = (error as { code?: unknown } | null)?.code;
  if (text.includes("issue_3682_one_channel_per_campaign_group") || code === "23505") {
    return "This campaign already has a message by this method — as a draft, a scheduled send, or one that went out. Pick a different method here, or start a new campaign.";
  }
  if (text.includes("campaign_group_invalid")) {
    return "This draft can't join that campaign. Start a new campaign from Blast and try again.";
  }
  // Anything else keeps today's wording (already plain, e.g. the brand check).
  return error instanceof Error ? error.message : "Couldn't save draft. Tap Save draft to retry.";
}

/**
 * Drop sibling drafts the host backed out of (they never sent). Given `seen`,
 * each delete holds only for the version this composer saw: a draft another
 * tab changed since is theirs and stays (follow-up 1).
 */
export async function discardSiblingDrafts(
  campaignIds: string[],
  seen?: ReadonlyMap<string, string>,
): Promise<void> {
  for (const id of campaignIds) {
    const expected = seen?.get(id);
    try {
      await deleteDraft(id, expected !== undefined ? { expectedUpdatedAt: expected } : undefined);
    } catch {
      // Already confirmed, gone, or changed in another tab: not ours to drop.
    }
  }
}
