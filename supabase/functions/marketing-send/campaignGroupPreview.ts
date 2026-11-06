// #4273 wave B — one locked preview for every method of one campaign.
//
// Each method keeps its own sealed quote (the one its confirm checks), built
// here by the same builders the per-method lanes use and at the same moment.
// On top sit the figures the host reads: each person counts once across
// methods, and every number comes from the server's candidate lists. Recipients
// never leave: the public quote and the group figures hold counts only.
import {
  buildMarketingBookQuote,
  type MarketingAudienceSourceTotal,
  type MarketingBookCandidateResponse,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";
import type { SmsRateV1 } from "../_shared/smsPriceBook.ts";
import type {
  SmsFxConverted,
  SmsFxConverter,
} from "../_shared/marketingSmsFx.ts";
import {
  buildPushQuote,
  publicPushQuote,
  type PushCandidatesEnvelope,
} from "./pushCampaign.ts";

export type GroupMethodChannel = "email" | "sms" | "push";

export interface GroupRows {
  /** The drafts this preview prices. */
  rows: Array<{ id: string; channel: GroupMethodChannel }>;
  /** Group drafts the client did not name: never priced (#4273). */
  unlisted: string[];
}

export interface QuoteBrand {
  followBrand: { name: string; slug: string } | null;
  costCurrency: string | null;
}

export interface GroupPreviewDeps {
  loadGroup: (
    campaignId: string,
    onlyIds?: readonly string[],
  ) => Promise<GroupRows>;
  candidates: (
    campaignId: string,
    channel: GroupMethodChannel,
  ) => Promise<unknown>;
  /** One brand read per quote: the Follow line and the cost currency. */
  quoteBrand: (candidates: unknown) => Promise<QuoteBrand>;
  /** Converts a mixed-currency SMS total into the brand's currency. */
  fx?: SmsFxConverter;
  allowance: (
    candidates: unknown,
    quote: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  errorCode: (error: unknown) => string;
  /** Tests only: the rate book the quote prices with. */
  smsRates?: SmsRateV1[];
}

export interface GroupMethodPreview {
  campaignId: string;
  channel: GroupMethodChannel;
  quote: Record<string, unknown> | null;
  error: string | null;
}

export interface GroupPreviewFigures {
  selectedCount: number;
  reachableCount: number;
  skippedCount: number;
  estimatedCostMinor: number | null;
  currency: string | null;
  costKind: "provider_estimate" | "not_metered";
  /** #4273 — the SMS total's per-currency parts (empty when not metered). */
  costBreakdown: SmsFxConverted[];
  audienceSources: MarketingAudienceSourceTotal[];
  quotedAt: string;
  expiresAt: string;
}

/** Display order of the methods in the review sheet. */
const METHOD_ORDER: readonly GroupMethodChannel[] = ["email", "sms", "push"];

export async function buildCampaignGroupPreview(
  deps: GroupPreviewDeps,
  leadCampaignId: string,
  now: Date,
  onlyIds?: readonly string[],
): Promise<
  {
    group: GroupPreviewFigures | null;
    methods: GroupMethodPreview[];
    unlistedDraftIds: string[];
  }
> {
  const { rows, unlisted } = await deps.loadGroup(leadCampaignId, onlyIds);
  const methods: GroupMethodPreview[] = [];
  // personKey → reachable on at least one method.
  const people = new Map<string, boolean>();
  let sources: MarketingAudienceSourceTotal[] | null = null;
  let costMinor: number | null = null;
  let currency: string | null = null;
  let metered = false;
  let currencyConflict = false;
  let breakdown: SmsFxConverted[] = [];
  let quotedAt: string | null = null;
  let expiresAt: string | null = null;

  const ordered = [...rows].sort((a, b) =>
    METHOD_ORDER.indexOf(a.channel) - METHOD_ORDER.indexOf(b.channel)
  );
  for (const row of ordered) {
    try {
      const candidates = await deps.candidates(row.id, row.channel);
      let publicQuote: Record<string, unknown>;
      if (row.channel === "push") {
        const envelope = candidates as PushCandidatesEnvelope;
        const quote = await buildPushQuote(row.id, envelope, now);
        publicQuote = publicPushQuote(quote);
        for (const candidate of envelope.candidates) {
          // A combined push row always names its person; fall back to the
          // account so a stray row is still counted, never dropped.
          const key = candidate.personKey ??
            `user:${candidate.recipientUserId}`;
          people.set(key, (people.get(key) ?? false) || candidate.allowed);
        }
        sources ??= envelope.audienceSources ?? null;
      } else {
        const envelope = candidates as MarketingBookCandidateResponse;
        const brand = await deps.quoteBrand(candidates);
        const quote = await buildMarketingBookQuote(envelope, now, {
          followBrand: brand.followBrand,
          costCurrency: brand.costCurrency,
          ...(deps.fx === undefined ? {} : { fx: deps.fx }),
          ...(deps.smsRates === undefined ? {} : { smsRates: deps.smsRates }),
        });
        publicQuote = publicMarketingBookQuote(quote);
        for (const candidate of envelope.candidates) {
          const key = candidate.personKey ?? candidate.brandPersonId;
          const reachable = candidate.allowed &&
            candidate.normalizedContact !== null;
          people.set(key, (people.get(key) ?? false) || reachable);
        }
        sources ??= envelope.audienceSources ?? null;
        if (
          quote.costKind === "provider_estimate" &&
          quote.estimatedCostMinor !== null
        ) {
          // Two metered quotes in different currencies cannot be summed:
          // say the cost is unavailable rather than add unlike money. One SMS
          // row per group (I-3682-CAMPAIGN-GROUP-COUNTS-ONCE) keeps this
          // defensive.
          if (metered && currency !== quote.currency) currencyConflict = true;
          metered = true;
          costMinor = (costMinor ?? 0) + quote.estimatedCostMinor;
          currency = quote.currency;
          breakdown = [...breakdown, ...quote.costBreakdown];
        }
      }
      quotedAt ??= String(publicQuote.quotedAt);
      expiresAt ??= String(publicQuote.expiresAt);
      methods.push({
        campaignId: row.id,
        channel: row.channel,
        quote: await deps.allowance(candidates, publicQuote),
        error: null,
      });
    } catch (error) {
      methods.push({
        campaignId: row.id,
        channel: row.channel,
        quote: null,
        error: deps.errorCode(error),
      });
    }
  }
  if (quotedAt === null || expiresAt === null) {
    return { group: null, methods, unlistedDraftIds: unlisted };
  }
  const reachableCount = [...people.values()].filter(Boolean).length;
  return {
    group: {
      selectedCount: people.size,
      reachableCount,
      skippedCount: people.size - reachableCount,
      estimatedCostMinor: currencyConflict ? null : costMinor,
      currency: currencyConflict ? null : currency,
      costKind: metered ? "provider_estimate" : "not_metered",
      costBreakdown: currencyConflict ? [] : breakdown,
      audienceSources: sources ?? [],
      quotedAt,
      expiresAt,
    },
    methods,
    unlistedDraftIds: unlisted,
  };
}
