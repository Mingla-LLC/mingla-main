export type ShareEntityKind = 'place' | 'curated' | 'event' | 'rsvp_event' | 'trip' | 'experience' | 'venue' | 'brand';
export type ShareStatus = 'sold_out' | 'ended' | 'cancelled' | 'rsvp_closed' | 'date_tbd' | 'dates_tbd';
export type ShareMoney = { minorUnits: number; currency: string; disclosure?: string };
export type ShareMediaIdentity = {
  kind: 'photo' | 'gif' | 'video'; url: string; posterUrl: string;
  focalPoint?: { x: number; y: number }; alt?: string;
};
export type PublicShareDetails =
  | { kind: 'place'; description?: string; address?: string; directionsUrl?: string; phone?: string; website?: string; utcOffsetMinutes?: number }
  | { kind: 'curated'; estimate?: unknown; stops: { title: string; category?: string; area?: string; address?: string; description?: string; imageUrl?: string }[] }
  | { kind: 'event' | 'rsvp_event' | 'trip' | 'experience'; actionEligible: boolean; occurrences: { startAt: string; endAt?: string; timezone?: string }[] }
  | { kind: 'venue' | 'brand'; offerings: { title: string; kind: 'event' | 'rsvp' | 'trip' | 'experience'; brandSlug: string; eventSlug: string; startAt: string }[] };
export type ShareDestination = { kind: ShareEntityKind; placeId?: string; eventSlug?: string; brandSlug?: string; venueSlug?: string };
export type NativeContentCardDescriptorV1 = { contract: 'native_content_card_v1'; version: 1; kind: 'place' | 'curated'; snapshotRef: string; snapshotFingerprint: string; preview: { title: string; category?: string; image?: string; cardType?: 'single' | 'curated'; stopCount?: number } };
type Common = { schemaVersion: 1; title: string; status?: ShareStatus; timezone?: string; media?: ShareMediaIdentity; route?: ShareDestination };
export type ShareHoursRow = { day: string; label: string; isToday?: boolean; special?: string };
export type ShareFactsV1 =
  | (Common & { kind: 'place'; category?: string; area?: string; rating?: number; priceLevel?: string; openState?: string; hours?: ShareHoursRow[]; description?: string })
  | (Common & { kind: 'curated'; stopCount?: number; area?: string; duration?: string; estimate?: string; description?: string })
  | (Common & { kind: 'event'; localDate?: string; localTime?: string; venue?: string; area?: string; price?: ShareMoney; availability?: string; description?: string })
  | (Common & { kind: 'rsvp_event'; localDate?: string; localTime?: string; venue?: string; rsvpDeadline?: string; availability?: string; description?: string })
  | (Common & { kind: 'trip'; destination?: string; dateRange?: string; duration?: string; startingPrice?: ShareMoney; description?: string })
  | (Common & { kind: 'experience'; area?: string; nextDate?: string; duration?: string; price?: ShareMoney; availability?: string; description?: string })
  | (Common & { kind: 'venue'; category?: string; area?: string; nextPublicOffering?: string; openState?: string; hours?: ShareHoursRow[]; description?: string })
  | (Common & { kind: 'brand'; category?: string; area?: string; upcomingPublicOfferingCount?: number; description?: string });
export const SHARE_FACTS_VERSION: 1;
export const SHARE_PORTRAIT_REVISION: 2;
export const SHARE_ENTITY_KINDS: readonly ShareEntityKind[];
export const SHARE_STATUSES: readonly ShareStatus[];
export const CONTENT_SHARE_NOTE_MAX_GRAPHEMES: 120;
export const SHARE_CHANNEL_BUDGETS: Readonly<Record<'generic' | 'sms' | 'whatsapp' | 'x' | 'email', { beforeUrl: number; total: number }>>;
export const ROUTE_MANIFEST: Readonly<Record<ShareEntityKind, { web: string; native: string; required: readonly string[] }>>;
export function cleanText(value: unknown, max?: number): string;
export function cleanHttpsUrl(value: unknown): string | null;
export function cleanMoney(value: unknown): ShareMoney | null;
export function cleanMedia(value: unknown): ShareMediaIdentity | null;
export function isPublicShareMediaUrl(value: unknown, allowedBunnyHosts?: string[]): boolean;
export function selectPublicMediaIdentity(value: {
  video?: { url: string; posterUrl?: string; publicSafe: boolean; authored?: boolean; focalPoint?: { x: number; y: number }; alt?: string };
  animated?: { url: string; posterUrl?: string; publicSafe: boolean; focalPoint?: { x: number; y: number }; alt?: string };
  photo?: { url: string; publicSafe: boolean; focalPoint?: { x: number; y: number }; alt?: string };
}, options?: { allowedBunnyHosts?: string[] }): ShareMediaIdentity | null;
export function isShortShareCode(value: unknown): value is string;
export function sanitizeReferralCode(value: unknown): string | null;
export function buildShortShareUrl(code: string): string;
export function buildSharePortraitUrl(code: string, version: number): string;
export function contentShareRequestFromPublicUrl(value: string, overrideKind?: ShareEntityKind): { kind: ShareEntityKind; identity: Record<string,string> } | null;
export function validateShareFactsV1(value: unknown): { ok: true; value: ShareFactsV1 } | { ok: false; errors: string[] };
export function parseShareFactsV1(value: unknown): ShareFactsV1;
export function formatMoney(value: unknown): string;
export function formatEstimate(value: unknown): string;
export function formatRating(value: unknown): string;
export function statusLabel(value: unknown): string;
export function shareKindLabel(value: unknown): string;
export function segmentGraphemes(value: unknown): string[];
export function normalizeContentShareNote(value: unknown): { note: string | null; graphemeCount: number };
export function formatPlanningPreference(value: unknown): string;
export function selectRecipientFacts(value: ShareFactsV1, context?: { includePlanningPreference?: boolean }): string[];
export function selectPreviewFacts(value: ShareFactsV1, limit?: number): string[];
export function selectCompactPreviewFacts(value: ShareFactsV1, limit?: number): string[];
export function buildShareMessage(value: ShareFactsV1, context: { shortCode: string; channel?: 'generic' | 'sms' | 'whatsapp' | 'x' | 'email'; senderNote?: string; planningPreference?: string | { dayOfWeek?: string; timeOfDay?: string; planningTimeframe?: string } }): string;
export function routeContractFor(kind: ShareEntityKind): { web: string; native: string; required: readonly string[] };
export function validateNativeContentCardDescriptorV1(value: unknown): NativeContentCardDescriptorV1 | null;
export function nativeContentCardCacheKey(userId: string, messageId: string): string;
export function createNativeContentCardSessionCache<T>(): { clear(): void; set(userId: string, messageId: string, fingerprint: string, card: T): void; get(userId: string, messageId: string, fingerprint: string): T | null };
export function createContentShareSingleFlight(): <T>(key: string, load: () => Promise<T>) => Promise<T>;
export type ShareReadinessState = 'ready' | 'waiting' | 'transient' | 'terminal';
export function checkContentShareReadiness(code: string, version: number, fetchImpl?: typeof fetch): Promise<ShareReadinessState>;
/**
 * #2589 — the same call, plus the version the server says is live. `version` is
 * non-null only for a `ready` result from a server that named one, and is never
 * lower than the version asked for.
 */
export function checkContentShareReadinessDetailed(code: string, version: number, fetchImpl?: typeof fetch): Promise<{ state: ShareReadinessState; version: number | null }>;
export function weekdayForShareTimezone(timezone: string, now?: Date): string;
export function openStateForHours(hours: ShareHoursRow[], timezone: string, now?: Date): '' | 'Open now' | 'Closed';
