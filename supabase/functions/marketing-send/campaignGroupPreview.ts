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
import {
  buildPushQuote,
  publicPushQuote,
  type PushCandidatesEnvelope,
} from "./pushCampaign.ts";

export type GroupMethodChannel = "email" | "sms" | "push";

export interface GroupPreviewDeps {
  loadGroup: (
    campaignId: string,
  ) => Promise<Array<{ id: string; channel: GroupMethodChannel }>>;
  candidates: (
    campaignId: string,
    channel: GroupMethodChannel,
  ) => Promise<unknown>;
  followBrand: (
    candidates: unknown,
  ) => Promise<{ name: string; slug: string } | null>;
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
): Promise<
  { group: GroupPreviewFigures | null; methods: GroupMethodPreview[] }
> {
  const rows = await deps.loadGroup(leadCampaignId);
  const methods: GroupMethodPreview[] = [];
  // personKey → reachable on at least one method.
  const people = new Map<string, boolean>();
  let sources: MarketingAudienceSourceTotal[] | null = null;
  let costMinor: number | null = null;
  let currency: string | null = null;
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
        const quote = await buildMarketingBookQuote(envelope, now, {
          followBrand: await deps.followBrand(candidates),
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
          costMinor = (costMinor ?? 0) + quote.estimatedCostMinor;
          currency = quote.currency;
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
  if (quotedAt === null || expiresAt === null) return { group: null, methods };
  const reachableCount = [...people.values()].filter(Boolean).length;
  return {
    group: {
      selectedCount: people.size,
      reachableCount,
      skippedCount: people.size - reachableCount,
      estimatedCostMinor: costMinor,
      currency,
      costKind: costMinor === null ? "not_metered" : "provider_estimate",
      audienceSources: sources ?? [],
      quotedAt,
      expiresAt,
    },
    methods,
  };
}
