import { buildSharePortraitUrl, buildShortShareUrl, checkContentShareReadiness, checkContentShareReadinessDetailed, contentShareRequestFromPublicUrl, createContentShareSingleFlight, selectCompactPreviewFacts, shareKindLabel, statusLabel, type ShareEntityKind, type ShareFactsV1, type ShareMediaIdentity } from '@mingla/sharing';
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
// ShareModalContent loads this adapter on demand. Re-export the preview helpers
// through that same split boundary so @mingla/sharing is owned by one async
// chunk instead of being hoisted into Metro's eager __common chunk.
export { checkContentShareReadiness, checkContentShareReadinessDetailed, selectCompactPreviewFacts, shareKindLabel, statusLabel };

export function trackBusinessShareEvent(event:'share_sheet_opened'|'share_link_ready'|'share_sheet_returned'|'share_link_opened'|'share_poster_result'|'share_failure',properties:Record<string,string|number|boolean>):void{
  try{postHogService.capture(event,properties)}catch{/* telemetry never owns sharing */}
  try{captureWeb(event,properties)}catch{/* telemetry never owns sharing */}
  try{logAppsFlyerEvent(event,properties)}catch{/* telemetry never owns sharing */}
}

/**
 * #2589 — adopt the version the readiness check reports, keeping the prepared
 * share internally consistent. Mirrors `adoptContentShareVersion` in the
 * Explorer adapter: the portrait-card URL is the adapter's to build, and the
 * share sheet previews the COVER, never the generated card.
 *
 * Returns the SAME object when there is nothing to adopt, so a caller can use
 * the result as a state update without forcing a re-render.
 */
export function adoptBusinessShareVersion(
  prepared: PreparedBusinessShare,
  version: number,
): PreparedBusinessShare {
  if (!Number.isSafeInteger(version) || version <= prepared.version) return prepared;
  return {
    ...prepared,
    version,
    s4Url: prepared.media === null ? null : buildSharePortraitUrl(prepared.shortCode, version),
  };
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

/**
 * #2589 — WHY a share could not be prepared, not merely THAT it could not.
 *
 * Three unrelated server outcomes used to arrive at the sheet as one string,
 * *"Couldn't prepare this share"*, beside a Retry that could not help two of
 * them: a draft or private offering (404 — retry can never succeed, the
 * organiser has to publish it), a signed-out session (401), and a genuine
 * outage (503 — retry is exactly right). Guessing between them from the copy is
 * impossible, and that is precisely how one screenshot got attributed to the
 * wrong cause during the investigation.
 */
export type BusinessShareFailureReason = 'not_public' | 'unauthorized' | 'unavailable' | 'unknown';

// The human-readable half of a preparation failure. The MACHINE-readable half
// is the `reason` property attached beside it — a message is for a log, and a
// sheet that had to parse one to decide what to render would be one string
// edit away from showing the wrong thing.
const SHARE_FAILURE_PREFIX = 'share_create_failed:';

/** Maps a transport status onto the reason the sheet renders. */
const reasonForStatus = (status: number | null): BusinessShareFailureReason =>
  status === 401 || status === 403 ? 'unauthorized'
    : status === 404 ? 'not_public'
    : status === 503 ? 'unavailable'
    : 'unknown';

/**
 * supabase-js wraps a non-2xx edge response in a FunctionsHttpError whose
 * `context` IS the Response. Read defensively: a network failure has no context
 * at all, and a thrown plain object is not an Error instance.
 */
const invokeStatus = (error: unknown): number | null => {
  const status = (error as { context?: { status?: unknown } } | null | undefined)?.context?.status;
  return typeof status === 'number' ? status : null;
};

/**
 * The reason travels as a PROPERTY on the error, not only inside its message.
 * The sheet reads that property with a local pure helper and imports nothing to
 * do it — an error handler that has to load a module in order to describe a
 * failure is one module-load away from having no message at all.
 */
const shareCreateFailure = (status: number | null): Error => {
  const reason = reasonForStatus(status);
  return Object.assign(new Error(`${SHARE_FAILURE_PREFIX}${reason}`), { reason });
};

export async function prepareBusinessContentShare(publicUrl:string,channel='generic',overrideKind?:ShareEntityKind):Promise<PreparedBusinessShare>{
  const request=contentShareRequestFromPublicUrl(publicUrl,overrideKind);if(!request)throw new Error('not_content_share');
  const key=JSON.stringify(request);const data=await singleFlight(key,async()=>{
    if(Platform.OS==='web'){
      const response=await fetch('/api/create-content-share',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'content_share_v1',...request,attribution:{channel}})});
      const body=await response.json().catch(()=>null) as CreatedShareResponse|null;
      if(!response.ok)throw shareCreateFailure(response.status);
      if(!body?.shortCode||!body?.facts||!body.message)throw shareCreateFailure(null);
      return body;
    }
    const {data,error}=await supabase.functions.invoke<CreatedShareResponse>('shared-card',{body:{contract:'content_share_v1',...request,attribution:{channel}}});
    if(error)throw shareCreateFailure(invokeStatus(error));
    if(!data?.shortCode||!data?.facts||!data.message)throw shareCreateFailure(null);
    return data
  });const url=buildShortShareUrl(data.shortCode);return{shortCode:data.shortCode,version:data.version,facts:data.facts,media:data.media??null,url,title:data.facts.title,message:data.message,s4Url:data.media==null?null:buildSharePortraitUrl(data.shortCode,data.version)}
}
