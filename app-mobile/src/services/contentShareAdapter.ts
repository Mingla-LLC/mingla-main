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
  | 'share_sheet_opened' | 'share_link_ready' | 'share_sheet_returned' | 'share_poster_result' | 'share_failure';

export function trackContentShareEvent(
  event: ContentShareTelemetryEvent,
  properties: Record<string, string | number | boolean>,
): void {
  try { mixpanelService.track(event, properties); } catch { /* telemetry never owns sharing */ }
  try { logAppsFlyerEvent(event, properties); } catch { /* telemetry never owns sharing */ }
}

export type ShareMessageContext = {
  planningPreference?: string | { dayOfWeek?: string; timeOfDay?: string; planningTimeframe?: string };
  senderNote?: string;
};

export async function prepareContentShare(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic', messageContext: ShareMessageContext = {}): Promise<PreparedContentShare> {
  const key = JSON.stringify([kind, identity, messageContext]);
  const prepared=await singleFlight(key,async () => {
    const { data, error } = await supabase.functions.invoke<CreatedShare>('shared-card', {
      body: { contract:'content_share_v1', kind, identity, attribution:{ channel }, messageContext },
    });
    if (!error && data?.shortCode && data?.facts) return { contract: 'content_share_v1' as const, data };
    throw new Error(error?.message || 'share_create_failed');
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
