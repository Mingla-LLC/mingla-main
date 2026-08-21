import { composeSmsBody, computeSegments } from "./adapters/smsAdapter.ts";
import { allocateSmsCosts } from "./smsPriceBook.ts";
import type { SmsRateV1 } from "./smsPriceBook.ts";

const HEX = /^[0-9a-f]{64}$/;
const QUOTE_TRACKING_ID = "00000000-0000-4000-8000-000000000000";

export interface MarketingSmsLink {
  tracking_id: string;
  destination_url: string;
}

export function resolveMarketingTrackingOrigin(
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string {
  const override = getEnv("MINGLA_TRACKING_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  const supabaseUrl = getEnv("SUPABASE_URL")?.replace(/\/+$/, "") ??
    "https://gqnoajqerqhnvulmnyvv.supabase.co";
  return `${supabaseUrl}/functions/v1/marketing-track-click`;
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
): string {
  return composeSmsBody(
    rewriteMarketingSmsLinks(rawBody, trackingOrigin, () => QUOTE_TRACKING_ID)
      .rewritten,
    true,
  );
}
export interface MarketingBookCandidate {
  brandPersonId: string;
  contactMethodId: string | null;
  normalizedContact: string | null;
  allowed: boolean;
  safeReasonCode: string;
}
export interface MarketingBookCandidateResponse {
  brandId: string;
  channel: "email" | "sms";
  selectedCount: number;
  content: Record<string, unknown>;
  candidates: MarketingBookCandidate[];
  audienceId?: string;
  audienceKind?: "all_brand_people" | "manual_group";
  audienceVersion?: number;
  audienceName?: string;
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
  options: { trackingOrigin?: string; smsRates?: SmsRateV1[] } = {},
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
    allocatedCostMinor: null as number | null,
    rateId: null as string | null,
    sourceReference: null as string | null,
  }));
  const reachable = candidates.filter((candidate) =>
    candidate.allowed && candidate.contactMethodId !== null
  );
  let estimatedCostMinor: number | null = null, currency: string | null = null;
  if (input.channel === "sms" && reachable.length > 0) {
    const wireBody = marketingBookSmsWireBody(
      String(input.content.body ?? ""),
      options.trackingOrigin ?? resolveMarketingTrackingOrigin(),
    );
    const segments = computeSegments(wireBody);
    const priced = allocateSmsCosts(
      reachable.map((candidate) => {
        if (candidate.normalizedContact === null) {
          throw new Error("cost_unavailable");
        }
        return {
          key: `${candidate.brandPersonId}:${candidate.contactMethodId}`,
          normalizedPhone: candidate.normalizedContact,
          segments,
          target: candidate,
        };
      }),
      now,
      options.smsRates,
    );
    estimatedCostMinor = priced.estimatedCostMinor;
    currency = priced.currency;
    for (const allocation of priced.allocations) {
      allocation.target.segments = allocation.segments;
      allocation.target.allocatedCostMinor = allocation.allocatedCostMinor;
      allocation.target.rateId = allocation.rate.rateId;
      allocation.target.sourceReference = allocation.rate.sourceReference;
    }
  }
  const suppressedCount =
    candidates.filter((candidate) =>
      candidate.contactMethodId !== null && !candidate.allowed
    ).length;
  const unavailableCount =
    candidates.filter((candidate) => candidate.contactMethodId === null).length;
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
    reachableCount: reachable.length,
    suppressedCount,
    unavailableCount,
    smsSegments: candidates.reduce(
      (sum, candidate) => sum + candidate.segments,
      0,
    ),
    costKind: input.channel === "sms" ? "provider_estimate" : "not_metered",
    estimatedCostMinor: input.channel === "sms" ? estimatedCostMinor : null,
    currency: input.channel === "sms" ? currency : null,
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
    audienceId,
    audienceKind,
    audienceVersion,
    ...safe
  } = quote;
  return audienceKind === "manual_group" &&
      typeof audienceId === "string" &&
      typeof audienceVersion === "number"
    ? { ...safe, audienceId, audienceKind, audienceVersion }
    : safe;
}
