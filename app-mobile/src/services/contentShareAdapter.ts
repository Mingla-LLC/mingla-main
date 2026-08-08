// SHARE-SEMANTIC-ROLE:content-adapter
import { Platform, Share } from 'react-native';
import { buildShareMessage, buildShortShareUrl, createContentShareSingleFlight, type ShareEntityKind, type ShareFactsV1 } from '@mingla/sharing';
import { supabase } from './supabase';

export type ContentShareIdentity = {
  placePoolId?: string; googlePlaceId?: string; savedCardId?: string;
  eventId?: string; eventSlug?: string; brandSlug?: string; venueSlug?: string;
};
export type PreparedContentShare = { shortCode:string;version:number;canonicalUrl: string; message: string; s4Url: string; facts: ShareFactsV1 };
type CreatedShare={shortCode:string;version:number;facts:ShareFactsV1};
const singleFlight=createContentShareSingleFlight();

export async function prepareContentShare(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic'): Promise<PreparedContentShare> {
  const key = JSON.stringify([kind, identity]);
  const data=await singleFlight(key,async () => {
    const { data, error } = await supabase.functions.invoke<CreatedShare>('shared-card', {
      body: { contract:'content_share_v1', kind, identity, attribution:{ channel } },
    });
    if (error || !data?.shortCode || !data?.facts) throw new Error(error?.message || 'share_create_failed');
    return data;
  });
  const canonicalUrl=buildShortShareUrl(data.shortCode);
  return { shortCode:data.shortCode,version:data.version,canonicalUrl,message:buildShareMessage(data.facts,{shortCode:data.shortCode,channel:channel as never}),s4Url:`https://usemingla.com/og/s/${data.shortCode}/v${data.version}.png`,facts:data.facts };
}

export const messageForPreparedContentShare=(prepared:PreparedContentShare,channel='generic'):PreparedContentShare=>({...prepared,message:buildShareMessage(prepared.facts,{shortCode:prepared.shortCode,channel:channel as never})});

export async function sharePreparedContent(prepared:PreparedContentShare):Promise<void>{
  const title=prepared.facts.title;
  if(Platform.OS==='android'){await Share.share({title,message:prepared.message});return;}
  const body=prepared.message.split(prepared.canonicalUrl).join('').trim();
  await Share.share({title,message:body,url:prepared.canonicalUrl});
}

export async function shareContent(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic'): Promise<void> {
  const prepared=await prepareContentShare(kind,identity,channel);
  await sharePreparedContent(prepared);
}
