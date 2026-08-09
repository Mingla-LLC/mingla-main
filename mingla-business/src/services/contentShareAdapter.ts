import { buildSharePortraitUrl, buildShortShareUrl, contentShareRequestFromPublicUrl, createContentShareSingleFlight, type ShareEntityKind, type ShareFactsV1, type ShareMediaIdentity } from '@mingla/sharing';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { postHogService } from './postHogService';
import { logAppsFlyerEvent } from './appsFlyerService';
import { captureWeb } from '../analytics/webAnalytics';
import { emailIntent, smsIntent, twitterIntent, whatsappIntent } from '../utils/shareIntents';

export type ContentShareRequest = { kind: ShareEntityKind; identity: Record<string,string> };
export type PreparedBusinessShare = { shortCode:string; version:number; facts:ShareFactsV1; media:ShareMediaIdentity|null; url:string; message:string; title:string; s4Url:string|null };
type CreatedShare={shortCode:string;version:number;facts:ShareFactsV1;media?:ShareMediaIdentity|null};
type CreatedShareResponse=CreatedShare&{message:string};
const singleFlight=createContentShareSingleFlight();

export { contentShareRequestFromPublicUrl } from '@mingla/sharing';

export function trackBusinessShareEvent(event:'share_sheet_opened'|'share_link_ready'|'share_sheet_returned'|'share_link_opened'|'share_poster_result'|'share_failure',properties:Record<string,string|number|boolean>):void{
  try{postHogService.capture(event,properties)}catch{/* telemetry never owns sharing */}
  try{captureWeb(event,properties)}catch{/* telemetry never owns sharing */}
  try{logAppsFlyerEvent(event,properties)}catch{/* telemetry never owns sharing */}
}

export function buildBusinessShareIntent(channel:'twitter'|'whatsapp'|'email'|'sms',url:string,title:string,message?:string):string{
  return channel==='twitter'?twitterIntent(url,title,message):channel==='whatsapp'?whatsappIntent(url,title,message):channel==='email'?emailIntent(url,title,message):smsIntent(url,title,message)
}

export function isAllowedBusinessShareIntent(value:string):boolean{
  try {
    const parsed=new URL(value);
    return ['https:','mailto:','sms:','whatsapp:','twitter:'].includes(parsed.protocol)
      && !parsed.username && !parsed.password;
  } catch { return false }
}


export async function prepareBusinessContentShare(publicUrl:string,channel='generic',overrideKind?:ShareEntityKind):Promise<PreparedBusinessShare>{
  const request=contentShareRequestFromPublicUrl(publicUrl,overrideKind);if(!request)throw new Error('not_content_share');
  const key=JSON.stringify(request);const data=await singleFlight(key,async()=>{
    if(Platform.OS==='web'){
      const response=await fetch('/api/create-content-share',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'content_share_v1',...request,attribution:{channel}})});
      const body=await response.json().catch(()=>null) as CreatedShareResponse|null;if(!response.ok||!body?.shortCode||!body?.facts||!body.message)throw new Error('share_create_failed');return body;
    }
    const {data,error}=await supabase.functions.invoke<CreatedShareResponse>('shared-card',{body:{contract:'content_share_v1',...request,attribution:{channel}}});if(error||!data?.shortCode||!data?.facts||!data.message)throw new Error(error?.message||'share_create_failed');return data
  });const url=buildShortShareUrl(data.shortCode);return{shortCode:data.shortCode,version:data.version,facts:data.facts,media:data.media??null,url,title:data.facts.title,message:data.message,s4Url:data.media==null?null:buildSharePortraitUrl(data.shortCode,data.version)}
}
