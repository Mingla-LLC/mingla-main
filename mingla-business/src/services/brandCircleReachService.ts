import { reportNonFatal } from "../diagnostics/reportNonFatal";
import type { BrandCircleAvailability, BrandCircleAvailabilityReason, BrandCircleCursor, BrandCircleErrorCode, BrandCircleMember, BrandCircleReachPage, BrandCircleRequestRing } from "../types/brandCircleReach";
import { supabase } from "./supabase";

export class BrandCircleReachError extends Error {
  constructor(public readonly code:BrandCircleErrorCode,public readonly retryable:boolean){super(code);this.name="BrandCircleReachError";}
}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const nonnegative=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const nullableString=(v:unknown):v is string|null=>v===null||typeof v==="string";
const reasons=new Set<BrandCircleAvailabilityReason>(["rollout_disabled","controls_not_live","refresh_pending","refresh_failed","freshness_expired","authority_unavailable"]);
function malformed():BrandCircleReachError{const error=new BrandCircleReachError("circle_temporarily_unavailable",true);reportNonFatal("brand-circle-reach-malformed",error,{feature:"brand-circle-reach",code:error.code});return error;}
function parseAvailability(v:unknown):BrandCircleAvailability{
  if(!record(v)||!exact(v,["state","reason","refreshedAt","expiresAt"])||(v.state!=="ready"&&v.state!=="unavailable")||!(v.reason===null||(typeof v.reason==="string"&&reasons.has(v.reason as BrandCircleAvailabilityReason)))||!nullableString(v.refreshedAt)||!nullableString(v.expiresAt))throw malformed();
  if((v.state==="ready")!==(v.reason===null)||v.state==="ready"&&(v.refreshedAt===null||v.expiresAt===null))throw malformed();
  return v as unknown as BrandCircleAvailability;
}
function parseMember(v:unknown):BrandCircleMember{
  if(!record(v)||!exact(v,["memberId","ring","displayName","avatarUrl","reasonCode","reasonLabel"])||typeof v.memberId!=="string"||typeof v.displayName!=="string"||v.displayName.length===0||v.displayName.length>120||!nullableString(v.avatarUrl)||(v.ring!=="follower"&&v.ring!=="extended"))throw malformed();
  if((v.ring==="follower"&&(v.reasonCode!=="follows_brand"||v.reasonLabel!=="Follows your brand."))||(v.ring==="extended"&&(v.reasonCode!=="extended_circle"||v.reasonLabel!=="In your extended circle.")))throw malformed();
  return v as unknown as BrandCircleMember;
}
function parseCursor(v:unknown):BrandCircleCursor|null{
  if(v===null)return null;if(!record(v)||!exact(v,["snapshotVersion","ringOrder","sortName","memberId"])||!nonnegative(v.snapshotVersion)||(v.ringOrder!==2&&v.ringOrder!==3)||typeof v.sortName!=="string"||typeof v.memberId!=="string")throw malformed();return v as unknown as BrandCircleCursor;
}
export function parseBrandCircleReach(v:unknown):BrandCircleReachPage{
  if(!record(v)||!exact(v,["schemaVersion","state","snapshotVersion","counts","availability","rows","nextCursor"])||v.schemaVersion!==1||!(["ready","partial","unavailable"] as unknown[]).includes(v.state)||!(v.snapshotVersion===null||nonnegative(v.snapshotVersion))||!record(v.counts)||!exact(v.counts,["followers","extended","total"])||!record(v.availability)||!exact(v.availability,["followers","extended"])||!Array.isArray(v.rows))throw malformed();
  for(const count of [v.counts.followers,v.counts.extended,v.counts.total])if(!(count===null||nonnegative(count)))throw malformed();
  const page={schemaVersion:1 as const,state:v.state as BrandCircleReachPage["state"],snapshotVersion:v.snapshotVersion as number|null,counts:v.counts as unknown as BrandCircleReachPage["counts"],availability:{followers:parseAvailability(v.availability.followers),extended:parseAvailability(v.availability.extended)},rows:v.rows.map(parseMember),nextCursor:parseCursor(v.nextCursor)};
  if(page.state==="unavailable"&&(page.rows.length!==0||page.nextCursor!==null||page.snapshotVersion!==null))throw malformed();
  return page;
}
function fromRpc(error:{message?:string}):BrandCircleReachError{const code=error.message?.match(/circle_[a-z_]+/)?.[0] as BrandCircleErrorCode|undefined;if(code&&["circle_forbidden","circle_cursor_invalid","circle_cursor_stale","circle_limit_invalid","circle_ring_invalid"].includes(code))return new BrandCircleReachError(code,code==="circle_cursor_stale");return new BrandCircleReachError("circle_temporarily_unavailable",true);}
export async function listBrandCircleReach(input:{brandId:string;ring:BrandCircleRequestRing;cursor:BrandCircleCursor|null;limit:number}):Promise<BrandCircleReachPage>{
  const {data,error}=await supabase.rpc("get_brand_circle_reach",{p_brand_id:input.brandId,p_ring:input.ring,p_cursor:input.cursor,p_limit:input.limit});if(error)throw fromRpc(error);return parseBrandCircleReach(data);
}
