import { buildShareMessage, buildShortShareUrl, contentShareRequestFromPublicUrl, createContentShareSingleFlight, type ShareEntityKind, type ShareFactsV1 } from '@mingla/sharing';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type ContentShareRequest = { kind: ShareEntityKind; identity: Record<string,string> };
export type PreparedBusinessShare = { url:string; message:string; title:string; s4Url:string };
type CreatedShare={shortCode:string;version:number;facts:ShareFactsV1};
const singleFlight=createContentShareSingleFlight();

export { contentShareRequestFromPublicUrl } from '@mingla/sharing';

export async function prepareBusinessContentShare(publicUrl:string,channel='generic',overrideKind?:ShareEntityKind):Promise<PreparedBusinessShare>{
  const request=contentShareRequestFromPublicUrl(publicUrl,overrideKind);if(!request)throw new Error('not_content_share');
  const key=JSON.stringify(request);const data=await singleFlight(key,async()=>{
    if(Platform.OS==='web'){
      const response=await fetch('/api/create-content-share',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'content_share_v1',...request,attribution:{channel}})});
      const body=await response.json().catch(()=>null) as CreatedShare|null;if(!response.ok||!body?.shortCode||!body?.facts)throw new Error('share_create_failed');return body;
    }
    const {data,error}=await supabase.functions.invoke<CreatedShare>('shared-card',{body:{contract:'content_share_v1',...request,attribution:{channel}}});if(error||!data?.shortCode||!data?.facts)throw new Error(error?.message||'share_create_failed');return data
  });const url=buildShortShareUrl(data.shortCode);return{url,title:data.facts.title,message:buildShareMessage(data.facts,{shortCode:data.shortCode,channel:channel as never}),s4Url:`https://usemingla.com/og/s/${data.shortCode}/v${data.version}.png`}
}
