// SHARE-SEMANTIC-ROLE:content-adapter
import { Platform, Share } from 'react-native';
import { buildSharePortraitUrl, buildShortShareUrl, createContentShareSingleFlight, type PublicShareDetails, type ShareDestination, type ShareEntityKind, type ShareFactsV1, type ShareMediaIdentity } from '@mingla/sharing';
import { supabase } from './supabase';
import { openUnifiedContentShare } from './contentShareController';
import { mixpanelService } from './mixpanelService';
import { logAppsFlyerEvent } from './appsFlyerService';

export type ContentShareIdentity = {
  placePoolId?: string; googlePlaceId?: string; savedCardId?: string; stopPlaceIds?: string[];
  sourceScope?: 'solo' | 'collaboration'; sourceRecordId?: string;
  eventId?: string; eventSlug?: string; brandSlug?: string; venueSlug?: string;
};
export type { PublicShareDetails } from '@mingla/sharing';
export type PreparedContentShareV1 = {
  contract: 'content_share_v1'; kind: ShareEntityKind; title: string;
  shortCode: string; version: number; canonicalUrl: string; message: string;
  s4Url: string | null; facts: ShareFactsV1; media: ShareMediaIdentity | null;
  destination: ShareDestination; publicDetails: PublicShareDetails | null;
};
export type PreparedContentShare = PreparedContentShareV1;
type CreatedShare = {
  shortCode: string; version: number; message: string; facts: ShareFactsV1;
  media?: ShareMediaIdentity | null; destination?: ShareDestination;
  publicDetails?: PublicShareDetails | null;
};
const singleFlight=createContentShareSingleFlight();

export type ContentShareTelemetryEvent =
  | 'share_sheet_opened' | 'share_presentation_requested' | 'share_sheet_presented'
  | 'share_link_ready' | 'share_sheet_returned' | 'share_poster_result' | 'share_failure';

export function trackContentShareEvent(
  event: ContentShareTelemetryEvent,
  properties: Record<string, string | number | boolean>,
): void {
  try { mixpanelService.track(event, properties); } catch { /* telemetry never owns sharing */ }
  try { logAppsFlyerEvent(event, properties); } catch { /* telemetry never owns sharing */ }
}

/**
 * #2589 — adopt the version the readiness check reports, keeping the prepared
 * share internally consistent.
 *
 * WHY IT LIVES HERE AND NOT IN THE SHEET. The portrait-card URL is this
 * adapter's to build (it is the only place that calls `buildSharePortraitUrl`
 * for a prepared share), and the share sheet is a presentation surface that
 * previews the COVER — `prepared.media.posterUrl` — never the generated card.
 * Three separate suites pin that boundary by forbidding the portrait URL inside
 * `UnifiedShareProvider.tsx`, alongside `Share.share`, `Linking.openURL` and the
 * per-channel intents: the list is "things the sheet must not do itself". An
 * earlier draft of #2589 recomputed the URL inside the sheet, which is exactly
 * the boundary those suites exist to hold.
 *
 * Returns the SAME object when there is nothing to adopt, so a caller can use
 * the result as a state update without forcing a re-render.
 */
export function adoptContentShareVersion(
  prepared: PreparedContentShare,
  version: number,
): PreparedContentShare {
  if (!Number.isSafeInteger(version) || version <= prepared.version) return prepared;
  return {
    ...prepared,
    version,
    s4Url: prepared.media === null ? null : buildSharePortraitUrl(prepared.shortCode, version),
  };
}

export type ShareMessageContext = {
  planningPreference?: string | { dayOfWeek?: string; timeOfDay?: string; planningTimeframe?: string };
  senderNote?: string;
};

/**
 * #2589 — WHY a share could not be prepared, not merely THAT it could not.
 *
 * Byte-mirrored from `mingla-business/src/services/contentShareAdapter.ts`: the
 * two sheets are a pair and their failure vocabulary must not diverge. Three
 * unrelated server outcomes used to reach the sheet as one string beside a Retry
 * that could not help two of them — an unpublished offering (404), a signed-out
 * session (401), and a real outage (503). The consumer app's own runtime capture
 * on 2026-08-25 showed the 401 case wearing the 404 case's copy.
 */
export type ContentShareFailureReason = 'not_public' | 'unauthorized' | 'unavailable' | 'unknown';

// The human-readable half of a preparation failure. The MACHINE-readable half
// is the `reason` property attached beside it — a message is for a log, and a
// sheet that had to parse one to decide what to render would be one string
// edit away from showing the wrong thing.
const SHARE_FAILURE_PREFIX = 'share_create_failed:';

const reasonForStatus = (status: number | null): ContentShareFailureReason =>
  status === 401 || status === 403 ? 'unauthorized'
    : status === 404 ? 'not_public'
    : status === 503 ? 'unavailable'
    : 'unknown';

/**
 * supabase-js wraps a non-2xx edge response in a FunctionsHttpError whose
 * `context` IS the Response. Read defensively: a network failure carries no
 * context, and a thrown plain object is not an Error instance.
 */
const invokeStatus = (error: unknown): number | null => {
  const status = (error as { context?: { status?: unknown } } | null | undefined)?.context?.status;
  return typeof status === 'number' ? status : null;
};

export async function prepareContentShare(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic', messageContext: ShareMessageContext = {}): Promise<PreparedContentShare> {
  const key = JSON.stringify([kind, identity, messageContext]);
  const prepared=await singleFlight(key,async () => {
    const { data, error } = await supabase.functions.invoke<CreatedShare>('shared-card', {
      body: { contract:'content_share_v1', kind, identity, attribution:{ channel }, messageContext },
    });
    if (!error && data?.shortCode && data?.facts) return { contract: 'content_share_v1' as const, data };
    // The reason travels as a PROPERTY as well as in the message: the sheet reads
    // it with a local pure helper and imports nothing to describe a failure.
    const reason = reasonForStatus(error ? invokeStatus(error) : null);
    throw Object.assign(new Error(`${SHARE_FAILURE_PREFIX}${reason}`), { reason });
  });
  const data=prepared.data;
  const canonicalUrl=buildShortShareUrl(data.shortCode);
  const media = data.media ?? null;
  return {
    contract: 'content_share_v1',
    kind: data.facts.kind,
    title: data.facts.title,
    shortCode: data.shortCode,
    version: data.version,
    canonicalUrl,
    message: data.message,
    s4Url: media === null ? null : buildSharePortraitUrl(data.shortCode, data.version),
    facts: data.facts,
    media,
    destination: data.destination ?? { kind },
    publicDetails: data.publicDetails ?? null,
  };
}

export async function sharePreparedContent(prepared:PreparedContentShare):Promise<void>{
  const title=prepared.title;
  // SHARE-CONTENT-CALL:adapter
  if(Platform.OS==='android'){await Share.share({title,message:prepared.message});return;}
  const body=prepared.message.split(prepared.canonicalUrl).join('').trim();
  // SHARE-CONTENT-CALL:adapter
  await Share.share({title,message:body,url:prepared.canonicalUrl});
}

export async function shareCanonicalFallback(input: { title: string; url: string; message: string }): Promise<void> {
  // SHARE-CONTENT-CALL:adapter
  if (Platform.OS === 'android') { await Share.share({ title: input.title, message: input.message }); return; }
  const body = input.message.split(input.url).join('').trim();
  // SHARE-CONTENT-CALL:adapter
  await Share.share({ title: input.title, message: body, url: input.url });
}

export async function shareContent(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic'): Promise<void> {
  // The provider opens synchronously; link and recipient preparation begin only
  // after the sheet is visible. Keep Promise<void> for source compatibility.
  openUnifiedContentShare({ kind, identity });
}
