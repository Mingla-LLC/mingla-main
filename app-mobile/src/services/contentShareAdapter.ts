// SHARE-SEMANTIC-ROLE:content-adapter
import { Platform, Share } from 'react-native';
import { buildShareMessage, buildSharePortraitUrl, buildShortShareUrl, createContentShareSingleFlight, type ShareDestination, type ShareEntityKind, type ShareFactsV1, type ShareMediaIdentity } from '@mingla/sharing';
import { supabase } from './supabase';
import { createSharedCard } from './sharedCardService';
import { isLegacyRollbackEligible, prepareLegacyPublicFields, type LegacyPublicSnapshot } from './legacyContentShareRollback';

export type ContentShareIdentity = {
  placePoolId?: string; googlePlaceId?: string; savedCardId?: string;
  eventId?: string; eventSlug?: string; brandSlug?: string; venueSlug?: string;
};
export type PublicShareDetails =
  | { kind: 'place'; description?: string; address?: string; directionsUrl?: string; phone?: string; website?: string; utcOffsetMinutes?: number }
  | { kind: 'curated'; estimate?: unknown; stops: { title: string; category?: string; area?: string; address?: string; description?: string; imageUrl?: string }[] }
  | { kind: 'event' | 'rsvp_event' | 'trip' | 'experience'; actionEligible: boolean; occurrences: { startAt: string; endAt?: string; timezone?: string }[] }
  | { kind: 'venue' | 'brand'; offerings: { title: string; kind: 'event' | 'rsvp' | 'trip' | 'experience'; brandSlug: string; eventSlug: string; startAt: string }[] };
export type PreparedContentShareV1 = {
  contract: 'content_share_v1'; kind: ShareEntityKind; title: string;
  shortCode: string; version: number; canonicalUrl: string; message: string;
  s4Url: string | null; facts: ShareFactsV1; media: ShareMediaIdentity | null;
  destination: ShareDestination; publicDetails: PublicShareDetails | null;
};
export type PreparedLegacyContentShare = {
  contract: 'legacy_shared_card'; kind: 'place' | 'curated'; title: string;
  canonicalUrl: string; message: string; s4Url: string | null;
  legacySnapshot: LegacyPublicSnapshot;
};
export type PreparedContentShare = PreparedContentShareV1 | PreparedLegacyContentShare;
type CreatedShare = {
  shortCode: string; version: number; facts: ShareFactsV1;
  media?: ShareMediaIdentity | null; destination?: ShareDestination;
  publicDetails?: PublicShareDetails | null;
};
const singleFlight=createContentShareSingleFlight();

export type ShareMessageContext = {
  planningPreference?: string | { dayOfWeek?: string; timeOfDay?: string; planningTimeframe?: string };
  senderNote?: string;
};

export async function prepareContentShare(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic', messageContext: ShareMessageContext = {}): Promise<PreparedContentShare> {
  const key = JSON.stringify([kind, identity]);
  const prepared=await singleFlight(key,async () => {
    const { data, error, response } = await supabase.functions.invoke<CreatedShare>('shared-card', {
      body: { contract:'content_share_v1', kind, identity, attribution:{ channel } },
    });
    if (!error && data?.shortCode && data?.facts) return { contract: 'content_share_v1' as const, data };
    if (!error || (kind !== 'place' && kind !== 'curated') || !isLegacyRollbackEligible(error, response?.status)) {
      throw new Error(error?.message || 'share_create_failed');
    }
    const legacy = await createSharedCard({
      kind,
      sourceIds: {
        ...(identity.placePoolId ? { placePoolId: identity.placePoolId } : {}),
        ...(identity.googlePlaceId ? { googlePlaceId: identity.googlePlaceId } : {}),
        ...(identity.savedCardId ? { savedCardId: identity.savedCardId } : {}),
      },
      attribution: { channel },
    });
    return { contract: 'legacy_shared_card' as const, data: legacy };
  });
  if (prepared.contract === 'legacy_shared_card') {
    const legacy = prepareLegacyPublicFields(prepared.data.snapshot, prepared.data.canonicalUrl, prepared.data.s4Url, kind as 'place' | 'curated', messageContext);
    return { contract: 'legacy_shared_card', kind: legacy.snapshot.kind, title: legacy.snapshot.title, canonicalUrl: legacy.canonicalUrl, message: legacy.message, s4Url: legacy.s4Url, legacySnapshot: legacy.snapshot };
  }
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
    message: buildShareMessage(data.facts, { shortCode: data.shortCode, channel: channel as never, ...messageContext }),
    s4Url: media === null ? null : buildSharePortraitUrl(data.shortCode, data.version),
    facts: data.facts,
    media,
    destination: data.destination ?? { kind },
    publicDetails: data.publicDetails ?? null,
  };
}

export const messageForPreparedContentShare=(prepared:PreparedContentShare,channel='generic',messageContext:ShareMessageContext={}):PreparedContentShare=>prepared.contract === 'content_share_v1'
  ? {...prepared,message:buildShareMessage(prepared.facts,{shortCode:prepared.shortCode,channel:channel as never,...messageContext})}
  : {...prepared,message:prepareLegacyPublicFields(prepared.legacySnapshot,prepared.canonicalUrl,prepared.s4Url,prepared.kind,messageContext).message};

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
  const prepared=await prepareContentShare(kind,identity,channel);
  await sharePreparedContent(prepared);
}
