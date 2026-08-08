export type ShareEntityKind = 'place' | 'curated' | 'event' | 'rsvp_event' | 'trip' | 'experience' | 'venue' | 'brand';
export type ShareStatus = 'sold_out' | 'ended' | 'cancelled' | 'rsvp_closed' | 'date_tbd' | 'dates_tbd';
export type ShareMoney = { minorUnits: number; currency: string; disclosure?: string };
export type ShareMediaIdentity = {
  kind: 'photo' | 'gif' | 'video'; url: string; posterUrl: string;
  focalPoint?: { x: number; y: number }; alt?: string;
};
export type ShareDestination = { kind: ShareEntityKind; placeId?: string; eventSlug?: string; brandSlug?: string; venueSlug?: string };
type Common = { schemaVersion: 1; title: string; status?: ShareStatus; timezone?: string; media?: ShareMediaIdentity; route?: ShareDestination };
export type ShareHoursRow = { day: string; label: string; isToday?: boolean; special?: string };
export type ShareFactsV1 =
  | (Common & { kind: 'place'; category?: string; area?: string; rating?: number; priceLevel?: string; openState?: string; hours?: ShareHoursRow[]; planningPreference?: string; description?: string })
  | (Common & { kind: 'curated'; stopCount?: number; area?: string; duration?: string; estimate?: ShareMoney; planningPreference?: string; description?: string })
  | (Common & { kind: 'event'; localDate?: string; localTime?: string; venue?: string; area?: string; price?: ShareMoney; availability?: string; description?: string })
  | (Common & { kind: 'rsvp_event'; localDate?: string; localTime?: string; venue?: string; rsvpDeadline?: string; availability?: string; description?: string })
  | (Common & { kind: 'trip'; destination?: string; dateRange?: string; duration?: string; startingPrice?: ShareMoney; description?: string })
  | (Common & { kind: 'experience'; area?: string; nextDate?: string; duration?: string; price?: ShareMoney; availability?: string; description?: string })
  | (Common & { kind: 'venue'; category?: string; area?: string; nextPublicOffering?: string; openState?: string; hours?: ShareHoursRow[]; description?: string })
  | (Common & { kind: 'brand'; category?: string; area?: string; upcomingPublicOfferingCount?: number; description?: string });
export const SHARE_FACTS_VERSION: 1;
export const SHARE_ENTITY_KINDS: readonly ShareEntityKind[];
export const SHARE_STATUSES: readonly ShareStatus[];
export const SHARE_CHANNEL_BUDGETS: Readonly<Record<'generic' | 'sms' | 'whatsapp' | 'x' | 'email', { beforeUrl: number; total: number }>>;
export const ROUTE_MANIFEST: Readonly<Record<ShareEntityKind, { web: string; native: string; required: readonly string[] }>>;
export function cleanText(value: unknown, max?: number): string;
export function cleanHttpsUrl(value: unknown): string | null;
export function cleanMoney(value: unknown): ShareMoney | null;
export function cleanMedia(value: unknown): ShareMediaIdentity | null;
export function isPublicShareMediaUrl(value: unknown): boolean;
export function selectPublicMediaIdentity(value: {
  video?: { url: string; posterUrl?: string; publicSafe: boolean; authored?: boolean; focalPoint?: { x: number; y: number }; alt?: string };
  animated?: { url: string; posterUrl?: string; publicSafe: boolean; focalPoint?: { x: number; y: number }; alt?: string };
  photo?: { url: string; publicSafe: boolean; focalPoint?: { x: number; y: number }; alt?: string };
}): ShareMediaIdentity | null;
export function isShortShareCode(value: unknown): value is string;
export function buildShortShareUrl(code: string): string;
export function contentShareRequestFromPublicUrl(value: string, overrideKind?: ShareEntityKind): { kind: ShareEntityKind; identity: Record<string,string> } | null;
export function validateShareFactsV1(value: unknown): { ok: true; value: ShareFactsV1 } | { ok: false; errors: string[] };
export function parseShareFactsV1(value: unknown): ShareFactsV1;
export function formatMoney(value: unknown): string;
export function formatRating(value: unknown): string;
export function statusLabel(value: unknown): string;
export function selectRecipientFacts(value: ShareFactsV1, context?: { includePlanningPreference?: boolean }): string[];
export function selectPreviewFacts(value: ShareFactsV1, limit?: number): string[];
export function buildShareMessage(value: ShareFactsV1, context: { shortCode: string; channel?: 'generic' | 'sms' | 'whatsapp' | 'x' | 'email'; senderNote?: string }): string;
export function routeContractFor(kind: ShareEntityKind): { web: string; native: string; required: readonly string[] };
export function createContentShareSingleFlight(): <T>(key: string, load: () => Promise<T>) => Promise<T>;
