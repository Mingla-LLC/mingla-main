import { formatEstimate, formatPlanningPreference } from '@mingla/sharing';

export type LegacyShareKind = 'place' | 'curated';
export type LegacyMessageContext = {
  planningPreference?: string | { dayOfWeek?: string; timeOfDay?: string; planningTimeframe?: string };
  senderNote?: string;
};
export type LegacyPublicSnapshot = {
  kind: LegacyShareKind;
  title: string;
  metadata: {
    category?: string;
    location?: string;
    price?: string;
    duration?: string;
    description?: string;
  };
  stops: { title: string; category?: string; area?: string }[];
};

const RETRYABLE_STATUS = new Set([408, 425, 429]);
const cleanText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
};

const functionStatus = (error: unknown, responseStatus?: number): number | undefined => {
  if (typeof responseStatus === 'number') return responseStatus;
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { status?: unknown; context?: { status?: unknown } };
  const status = record.context?.status ?? record.status;
  return typeof status === 'number' ? status : undefined;
};

/** Only transport failures and retryable/unavailable HTTP statuses may downgrade. */
export const isLegacyRollbackEligible = (error: unknown, responseStatus?: number): boolean => {
  const status = functionStatus(error, responseStatus);
  if (status !== undefined) return RETRYABLE_STATUS.has(status) || status >= 500;
  if (!error || typeof error !== 'object') return false;
  const named = error as { name?: unknown; message?: unknown };
  if (named.name === 'FunctionsFetchError' || named.name === 'FunctionsRelayError') return true;
  const message = typeof named.message === 'string' ? named.message.toLowerCase() : '';
  return /failed to send|relay error|network request failed|fetch failed|timed?\s*out/.test(message);
};

const exactLegacyCanonicalUrl = (value: unknown): { url: string; shareId: string } | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/p\/([a-f0-9]{36})$/);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'usemingla.com' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || !match) return null;
    return { url: parsed.toString(), shareId: match[1] };
  } catch {
    return null;
  }
};

const exactLegacyPortraitUrl = (value: unknown, shareId: string): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'usemingla.com' && !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash && parsed.pathname === `/share/${shareId}.png`
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
};

export const selectLegacyPublicSnapshot = (raw: unknown, expectedKind: LegacyShareKind): LegacyPublicSnapshot | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const title = cleanText(source.title, 120);
  const rawKind = source.kind;
  if (!title || rawKind !== expectedKind) return null;
  const rawMetadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
    ? source.metadata as Record<string, unknown>
    : {};
  const metadata = Object.fromEntries([
    ['category', cleanText(rawMetadata.category, 60)],
    ['location', cleanText(rawMetadata.location, 100)],
    ['price', cleanText(rawMetadata.price, 40)],
    ['duration', cleanText(rawMetadata.duration, 40)],
    ['description', cleanText(rawMetadata.description, 220)],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const stops = Array.isArray(source.stops)
    ? source.stops.slice(0, 20).flatMap((rawStop) => {
        if (!rawStop || typeof rawStop !== 'object' || Array.isArray(rawStop)) return [];
        const stop = rawStop as Record<string, unknown>;
        const stopTitle = cleanText(stop.title, 100);
        if (!stopTitle) return [];
        return [{
          title: stopTitle,
          ...(cleanText(stop.category, 60) ? { category: cleanText(stop.category, 60) } : {}),
          ...(cleanText(stop.area, 100) ? { area: cleanText(stop.area, 100) } : {}),
        }];
      })
    : [];
  return { kind: expectedKind, title, metadata, stops };
};

export const buildLegacyShareMessage = (
  snapshot: LegacyPublicSnapshot,
  canonicalUrl: string,
  context: LegacyMessageContext = {},
): string => {
  const lead = snapshot.kind === 'curated'
    ? `${snapshot.title} is a ${snapshot.stops.length}-stop plan.`
    : `How about ${snapshot.title}?`;
  const lines = [lead];
  const categoryLocation = [snapshot.metadata.category, snapshot.metadata.location].filter(Boolean).join(' · ');
  if (categoryLocation) lines.push(categoryLocation);
  if (snapshot.metadata.description) lines.push(snapshot.metadata.description);
  const truthfulPrice = snapshot.kind === 'curated' ? formatEstimate(snapshot.metadata.price) : snapshot.metadata.price;
  const priceDuration = [truthfulPrice, snapshot.metadata.duration].filter(Boolean).join(' · ');
  if (priceDuration) lines.push(priceDuration);
  if (snapshot.kind === 'curated' && snapshot.stops.length > 0) {
    const visible = snapshot.stops.slice(0, 3).map((stop) => stop.title).join('; ');
    const remainder = snapshot.stops.length - 3;
    lines.push(`Stops: ${visible}${remainder > 0 ? `; +${remainder} more` : ''}`);
  }
  const planning = formatPlanningPreference(context.planningPreference);
  if (planning) lines.push(`I was thinking ${planning}.`);
  const senderNote = cleanText(context.senderNote, 240);
  if (senderNote) lines.unshift(`From the sender: ${senderNote}`);
  const withoutDuplicateUrl = lines.map((line) => line.split(canonicalUrl).join('').trim()).filter(Boolean);
  return `${withoutDuplicateUrl.join('\n')}\n\n${canonicalUrl}`;
};

export const prepareLegacyPublicFields = (
  rawSnapshot: unknown,
  canonicalUrl: unknown,
  s4Url: unknown,
  kind: LegacyShareKind,
  context: LegacyMessageContext = {},
): { snapshot: LegacyPublicSnapshot; canonicalUrl: string; s4Url: string | null; message: string } => {
  const canonical = exactLegacyCanonicalUrl(canonicalUrl);
  const snapshot = selectLegacyPublicSnapshot(rawSnapshot, kind);
  if (!canonical || !snapshot) throw new Error('legacy_share_invalid');
  return {
    snapshot,
    canonicalUrl: canonical.url,
    s4Url: exactLegacyPortraitUrl(s4Url, canonical.shareId),
    message: buildLegacyShareMessage(snapshot, canonical.url, context),
  };
};
