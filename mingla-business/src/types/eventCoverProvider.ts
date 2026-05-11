export type EventCoverMediaProvider = "upload" | "giphy" | "pexels";

export interface EventCoverProviderMetadata {
  provider: EventCoverMediaProvider | null;
  sourceUrl: string | null;
  credit: string | null;
  creditUrl: string | null;
  alt: string | null;
}

export const EMPTY_EVENT_COVER_PROVIDER_METADATA: EventCoverProviderMetadata = {
  provider: null,
  sourceUrl: null,
  credit: null,
  creditUrl: null,
  alt: null,
};

export const UPLOAD_EVENT_COVER_PROVIDER_METADATA: EventCoverProviderMetadata = {
  provider: "upload",
  sourceUrl: null,
  credit: null,
  creditUrl: null,
  alt: null,
};

export const asEventCoverMediaProvider = (
  value: unknown,
): EventCoverMediaProvider | null =>
  value === "upload" || value === "giphy" || value === "pexels" ? value : null;

const cleanStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const normalizeEventCoverProviderMetadata = (
  value: Partial<EventCoverProviderMetadata> | null | undefined,
): EventCoverProviderMetadata => {
  if (value === null || value === undefined) {
    return EMPTY_EVENT_COVER_PROVIDER_METADATA;
  }
  return {
    provider: asEventCoverMediaProvider(value.provider),
    sourceUrl: cleanStringOrNull(value.sourceUrl),
    credit: cleanStringOrNull(value.credit),
    creditUrl: cleanStringOrNull(value.creditUrl),
    alt: cleanStringOrNull(value.alt),
  };
};

export const eventCoverProviderCreditLabel = (
  metadata: {
    provider?: EventCoverMediaProvider | null;
    credit?: string | null;
  },
): string | null => {
  if (metadata.provider === "giphy") return metadata.credit ?? "GIPHY";
  if (metadata.provider === "pexels") {
    return metadata.credit !== null ? `Photo by ${metadata.credit}` : "Photo via Pexels";
  }
  return null;
};
