import { composeSmsBody, computeSegments } from "./adapters/smsAdapter.ts";
import { smsBlastBodyWithFollow } from "./marketingBlastFollow.ts";
import { allocateSmsCosts } from "./smsPriceBook.ts";
import { smsMarketingCountry } from "./e164Country.ts";
import { smsCountryProfile } from "./smsCountries.ts";
import type { SmsRateV1 } from "./smsPriceBook.ts";
import {
  SMS_FX_PROVIDER,
  SMS_FX_UNAVAILABLE,
  type SmsFxConverted,
  type SmsFxConverter,
} from "./marketingSmsFx.ts";

const HEX = /^[0-9a-f]{64}$/;
const QUOTE_TRACKING_ID = "00000000-0000-4000-8000-000000000000";

export interface MarketingSmsLink {
  tracking_id: string;
  destination_url: string;
}

/**
 * #2470 — the SMS half of the branded-link fix.
 *
 * This is the THIRD tracking-origin builder in the codebase and it was missed
 * when the two email builders were fixed, so marketing SMS kept sending raw
 * `…supabase.co/functions/v1/marketing-track-click/…` links. In a text message
 * that is worse than in email: there is no anchor text to hide behind, so the
 * recipient reads the bare cloud hostname and it looks like a scam.
 *
 * Same rule as the email builders: the branded origin is the DEFAULT, never an
 * env var somebody has to remember to set. A fallback nobody configures away IS
 * the production path — that is the entire lesson of #2470, and this file is
 * the proof it needed enforcing rather than merely writing down.
 *
 * `usemingla.com/m/<id>` is served by the marketing app's rewrite
 * (mingla-marketing/next.config.ts). Keep the two in step.
 */
const BRANDED_TRACKING_LINK_ORIGIN = "https://usemingla.com/m";

export function resolveMarketingTrackingOrigin(
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string {
  const override = getEnv("MINGLA_TRACKING_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  return BRANDED_TRACKING_LINK_ORIGIN;
}

/** One owner for the exact SMS body shape used by both Book quotes and send. */
export function rewriteMarketingSmsLinks(
  body: string,
  origin: string,
  createTrackingId: () => string = () => crypto.randomUUID(),
): { rewritten: string; links: MarketingSmsLink[] } {
  const links: MarketingSmsLink[] = [];
  const rewritten = body.replace(/https?:\/\/[^\s]+/g, (match) => {
    const trailingMatch = match.match(/[.,;:!?)]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const destination = trailing.length > 0
      ? match.slice(0, match.length - trailing.length)
      : match;
    const trackingId = createTrackingId();
    links.push({ tracking_id: trackingId, destination_url: destination });
    return `${origin}/${trackingId}${trailing}`;
  });
  return { rewritten, links };
}

export function marketingBookSmsWireBody(
  rawBody: string,
  trackingOrigin: string,
  /**
   * #4273 — the recipient's sender cannot take a "STOP" reply, so the text
   * ends with a branded opt-out link of the same fixed length as at send.
   */
  optOutLink = false,
): string {
  return composeSmsBody(
    rewriteMarketingSmsLinks(rawBody, trackingOrigin, () => QUOTE_TRACKING_ID)
      .rewritten,
    true,
    optOutLink ? `${trackingOrigin}/${QUOTE_TRACKING_ID}` : undefined,
  );
}

/** #4273 — true when a text to this number carries the opt-out link. */
export function smsNeedsOptOutLink(normalizedPhone: string | null): boolean {
  return smsCountryProfile(smsMarketingCountry(normalizedPhone))?.replyable ===
    false;
}
export interface MarketingBookCandidate {
  brandPersonId: string;
  /** #1778 service-only identity for a circle member; never returned publicly. */
  recipientUserId?: string | null;
  ring?: "follower" | "extended" | null;
  snapshotVersion?: number | null;
  contactMethodId: string | null;
  normalizedContact: string | null;
  allowed: boolean;
  safeReasonCode: string;
  /** #4273 — the one person this row is, across groups and methods. Service-only. */
  personKey?: string;
  /** #4273 — the sealed Book subject of a combined row (null for account or buyer). */
  targetBrandPersonId?: string | null;
  /** #4273 — a buyer known only from orders (digest of their email). Service-only. */
  buyerContactKey?: string | null;
}
/** #4273 — one picked group: its name and totals, never a person. */
export interface MarketingAudienceSourceTotal {
  key: string;
  name: string;
  count: number;
  alsoInBookCount: number;
}
export interface MarketingBookCandidateResponse {
  brandId: string;
  channel: "email" | "sms";
  selectedCount: number;
  content: Record<string, unknown>;
  candidates: MarketingBookCandidate[];
  audienceId?: string;
  audienceKind?:
    | "all_brand_people"
    | "manual_group"
    | "brand_followers"
    | "brand_circle_extended"
    | "combined_sources";
  audienceVersion?: number;
  audienceName?: string;
  audienceSources?: MarketingAudienceSourceTotal[];
}
export function parseBookQuotedAt(
  value: unknown,
  now = new Date(),
): Date | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) return null;
  const parsed = new Date(value), age = now.getTime() - parsed.getTime();
  return parsed.toISOString() === value && age >= 0 && age <= 300_000
    ? parsed
    : null;
}

async function sha(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      ).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(
        ",",
      )
    }}`;
  }
  return JSON.stringify(value);
}

export async function buildMarketingBookQuote(
  input: MarketingBookCandidateResponse,
  now = new Date(),
  options: {
    trackingOrigin?: string;
    smsRates?: SmsRateV1[];
    /** #4273 — per-country switch; see allocateSmsCosts for the default. */
    smsCountryLive?: (country: string) => boolean;
    /** #3682 — same Follow line dispatch appends; required for SMS segment parity. */
    followBrand?: { name: string; slug: string } | null;
    /** #4273 — the brand's pricing currency; a mixed-currency SMS total is shown in it. */
    costCurrency?: string | null;
    /** #4273 — converts per-currency subtotals with the snapshot as of quotedAt. */
    fx?: SmsFxConverter;
  } = {},
) {
  now = new Date(Math.floor(now.getTime() / 1000) * 1000);
  if (
    !Array.isArray(input.candidates) ||
    !Number.isSafeInteger(input.selectedCount) ||
    input.selectedCount !== input.candidates.length
  ) throw new Error("book_blast_quote_invalid");
  if (
    input.channel === "sms" && Array.isArray(input.content.media_urls) &&
    input.content.media_urls.length > 0
  ) throw new Error("book_blast_mms_not_supported");
  const contentHash = await sha(stable(input.content));
  const candidates = input.candidates.map((candidate) => ({
    ...candidate,
    segments: 0,
    /** #4273 — reachable by the Book's verdict, but no rate for this phone. */
    smsUnpriced: false,
    allocatedCostMinor: null as number | null,
    rateId: null as string | null,
    sourceReference: null as string | null,
  }));
  const hasDeliveryIdentity = (candidate: MarketingBookCandidate): boolean =>
    candidate.contactMethodId !== null ||
    (typeof candidate.recipientUserId === "string" &&
      candidate.normalizedContact !== null) ||
    (typeof candidate.buyerContactKey === "string" &&
      candidate.normalizedContact !== null);
  const deliverable = candidates.filter((candidate) =>
    candidate.allowed && hasDeliveryIdentity(candidate)
  );
  // #4273 — the SMS reach: a deliverable phone with no rate is SKIPPED with
  // SMS_UNPRICED_COUNTRY (its sealed target keeps segments = 0, which the
  // seal turns into a suppressed target), never a whole-quote failure.
  let reachable = deliverable;
  let unpricedCount = 0;
  let estimatedCostMinor: number | null = null, currency: string | null = null;
  let costBreakdown: SmsFxConverted[] = [];
  let fxSnapshotId: string | null = null;
  if (input.channel === "sms" && deliverable.length > 0) {
    const authorBody = smsBlastBodyWithFollow(
      String(input.content.body ?? ""),
      options.followBrand?.name,
      options.followBrand?.slug,
    );
    const origin = options.trackingOrigin ?? resolveMarketingTrackingOrigin();
    // #4273 — quote = send: a text that carries the opt-out link is measured
    // with it (the send appends a link of exactly this length).
    const wireBody = marketingBookSmsWireBody(authorBody, origin);
    const segmentsWithStop = computeSegments(wireBody);
    const segmentsWithLink = computeSegments(
      marketingBookSmsWireBody(authorBody, origin, true),
    );
    const priced = allocateSmsCosts(
      deliverable.map((candidate) => {
        if (candidate.normalizedContact === null) {
          throw new Error("cost_unavailable");
        }
        return {
          key: `${candidate.brandPersonId}:${
            candidate.contactMethodId ?? candidate.recipientUserId ??
              candidate.buyerContactKey ?? "unavailable"
          }`,
          normalizedPhone: candidate.normalizedContact,
          segments: smsNeedsOptOutLink(candidate.normalizedContact)
            ? segmentsWithLink
            : segmentsWithStop,
          target: candidate,
        };
      }),
      now,
      options.smsRates,
      options.smsCountryLive,
    );
    for (const skipped of priced.unpriced) skipped.target.smsUnpriced = true;
    unpricedCount = priced.unpriced.length;
    reachable = deliverable.filter((candidate) => !candidate.smsUnpriced);
    for (const allocation of priced.allocations) {
      allocation.target.segments = allocation.segments;
      allocation.target.allocatedCostMinor = allocation.allocatedCostMinor;
      allocation.target.rateId = allocation.rate.rateId;
      allocation.target.sourceReference = allocation.rate.sourceReference;
    }
    if (priced.subtotals.length <= 1) {
      // One provider currency: exactly the numbers a quote always had.
      estimatedCostMinor = priced.estimatedCostMinor;
      currency = priced.currency;
      costBreakdown = priced.subtotals.map((subtotal) => ({
        currency: subtotal.currency,
        providerCostMinor: subtotal.estimatedCostMinor,
        convertedCostMinor: subtotal.estimatedCostMinor,
      }));
    } else {
      // Several provider currencies: one total in the brand's currency,
      // converted with the snapshot as of quotedAt and sealed in the hash.
      const costCurrency = typeof options.costCurrency === "string"
        ? options.costCurrency
        : "";
      if (!/^[A-Z]{3}$/.test(costCurrency) || options.fx === undefined) {
        throw new Error(SMS_FX_UNAVAILABLE);
      }
      const conversion = await options.fx.convert({
        subtotals: priced.subtotals,
        targetCurrency: costCurrency,
        at: now,
      });
      const byCurrency = new Map(
        conversion.converted.map((row) => [row.currency, row]),
      );
      if (
        typeof conversion.snapshotId !== "string" ||
        conversion.snapshotId.length === 0 ||
        conversion.converted.length !== priced.subtotals.length ||
        priced.subtotals.some((subtotal) =>
          byCurrency.get(subtotal.currency)?.providerCostMinor !==
            subtotal.estimatedCostMinor ||
          !Number.isSafeInteger(
            byCurrency.get(subtotal.currency)?.convertedCostMinor,
          ) ||
          (byCurrency.get(subtotal.currency)?.convertedCostMinor ?? -1) < 0
        )
      ) throw new Error(SMS_FX_UNAVAILABLE);
      // Re-allocate each person's share INTO the brand currency: within each
      // provider currency, that currency's converted total is split by largest
      // remainder weighted by the person's native share (tie by key), so the
      // per-person figures still sum exactly to the total.
      for (const subtotal of priced.subtotals) {
        const convertedTotal = BigInt(
          (byCurrency.get(subtotal.currency) as SmsFxConverted)
            .convertedCostMinor,
        );
        const native = BigInt(subtotal.estimatedCostMinor);
        const group = priced.allocations.filter((allocation) =>
          allocation.rate.currency === subtotal.currency
        );
        const shares = group.map((allocation) => {
          const weighted = convertedTotal *
            BigInt(allocation.allocatedCostMinor);
          return {
            allocation,
            floor: weighted / native,
            remainder: weighted % native,
          };
        });
        let left = convertedTotal -
          shares.reduce((sum, share) => sum + share.floor, 0n);
        for (const share of shares) {
          share.allocation.target.allocatedCostMinor = Number(share.floor);
        }
        [...shares].sort((a, b) =>
          a.remainder === b.remainder
            ? a.allocation.key.localeCompare(b.allocation.key)
            : a.remainder > b.remainder
            ? -1
            : 1
        ).forEach((share) => {
          if (left > 0n) {
            share.allocation.target.allocatedCostMinor =
              (share.allocation.target.allocatedCostMinor ?? 0) + 1;
            left -= 1n;
          }
        });
      }
      currency = costCurrency;
      costBreakdown = [...conversion.converted].sort((a, b) =>
        a.currency.localeCompare(b.currency)
      );
      estimatedCostMinor = costBreakdown.reduce(
        (sum, row) => sum + row.convertedCostMinor,
        0,
      );
      fxSnapshotId = conversion.snapshotId;
    }
  }
  // #4273 — an unpriced phone is skipped like a suppression, so the sealed
  // execution keeps selected = reachable + suppressed + unavailable;
  // unpricedCount says how many of the suppressed are that reason.
  const suppressedCount =
    candidates.filter((candidate) =>
      hasDeliveryIdentity(candidate) &&
      (!candidate.allowed || candidate.smsUnpriced)
    ).length;
  const unavailableCount =
    candidates.filter((candidate) => !hasDeliveryIdentity(candidate)).length;
  const quotedAt = now.toISOString();
  const internal = {
    quoteVersion: 1,
    brandId: input.brandId,
    // Service-only structural content snapshot. PostgreSQL compares this JSONB
    // value directly at confirmation; contentHash remains the immutable digest
    // written to the execution ledger. publicMarketingBookQuote strips both.
    content: input.content,
    contentHash,
    quotedAt,
    selectedCount: input.selectedCount,
    audienceId: input.audienceId ?? null,
    audienceKind: input.audienceKind ?? null,
    audienceVersion: input.audienceVersion ?? null,
    audienceName: input.audienceName ?? null,
    ...(input.audienceSources === undefined
      ? {}
      : { audienceSources: input.audienceSources }),
    reachableCount: reachable.length,
    suppressedCount,
    unavailableCount,
    /** #4273 — of suppressedCount: phones skipped because their country has no rate. */
    unpricedCount,
    smsSegments: candidates.reduce(
      (sum, candidate) => sum + candidate.segments,
      0,
    ),
    costKind: input.channel === "sms" ? "provider_estimate" : "not_metered",
    estimatedCostMinor: input.channel === "sms" ? estimatedCostMinor : null,
    currency: input.channel === "sms" ? currency : null,
    // #4273 — the per-currency parts of the total (public), and the FX
    // snapshot that joined them (server-only). Both are inside quoteHash.
    costBreakdown: input.channel === "sms" ? costBreakdown : [],
    fxSnapshotId: input.channel === "sms" ? fxSnapshotId : null,
    rateIds: [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.rateId === null ? [] : [candidate.rateId]
        ),
      ),
    ].sort(),
    sourceReferences: [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.sourceReference === null ? [] : [candidate.sourceReference]
        ).concat(
          fxSnapshotId === null
            ? []
            : [`fx:${SMS_FX_PROVIDER}:${fxSnapshotId}`],
        ),
      ),
    ].sort(),
    candidates,
  };
  // normalizedContact is deliberately inside the server-only hash. The digest
  // is public-safe, while any in-place address/phone change makes the preview
  // stale instead of silently redirecting a sealed delivery.
  const quoteHash = await sha(stable(internal));
  if (!HEX.test(quoteHash)) throw new Error("book_blast_quote_invalid");
  return {
    ...internal,
    quoteHash,
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
  };
}

export function publicMarketingBookQuote(
  quote: Awaited<ReturnType<typeof buildMarketingBookQuote>>,
) {
  const {
    candidates: _candidates,
    brandId: _brandId,
    content: _content,
    contentHash: _contentHash,
    rateIds: _rateIds,
    sourceReferences: _sources,
    audienceName: _audienceName,
    fxSnapshotId: _fxSnapshotId,
    audienceId,
    audienceKind,
    audienceVersion,
    ...safe
  } = quote;
  return audienceKind !== null && audienceKind !== "all_brand_people" &&
      typeof audienceId === "string" &&
      typeof audienceVersion === "number"
    ? { ...safe, audienceId, audienceKind, audienceVersion }
    : safe;
}
