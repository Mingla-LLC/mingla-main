import { reportNonFatal } from "../diagnostics/reportNonFatal";
import type { AddBrandPersonInput, AddBrandPersonResult, BookCursor, BrandPeopleBookPage, BrandPersonSummary, PeopleErrorCode } from "../types/people";
import { supabase } from "./supabase";

const SAFE_CODES: ReadonlySet<string> = new Set([
  "people_forbidden","people_not_found","people_limit_invalid","people_search_invalid","people_cursor_invalid",
  "people_name_invalid","people_email_invalid","people_phone_invalid","people_contact_required","people_idempotency_conflict",
]);
export class PeopleServiceError extends Error {
  constructor(public readonly code: PeopleErrorCode, public readonly retryable: boolean) {
    super(code); this.name = "PeopleServiceError";
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const stringValue = (v: unknown): v is string => typeof v === "string" && v.length > 0;
function parsePerson(v: unknown): BrandPersonSummary {
  if (!isRecord(v) || !stringValue(v.personId) || !stringValue(v.displayName) ||
      !(v.avatarUrl === null || typeof v.avatarUrl === "string") || !stringValue(v.updatedAt) ||
      !Array.isArray(v.contacts) || !Array.isArray(v.suppressions)) throw malformed();
  const contacts = v.contacts.map((x) => {
    if (!isRecord(x) || !stringValue(x.id) || (x.channel !== "email" && x.channel !== "phone") || !stringValue(x.value) || typeof x.isPrimary !== "boolean") throw malformed();
    return { id: x.id, channel: x.channel as "email" | "phone", value: x.value, isPrimary: x.isPrimary };
  });
  const suppressions = v.suppressions.map((x) => {
    if (!isRecord(x) || (x.channel !== "email" && x.channel !== "sms") || (x.scope !== "marketing" && x.scope !== "all")) throw malformed();
    return { channel: x.channel as "email" | "sms", scope: x.scope as "marketing" | "all" };
  });
  return { personId:v.personId, displayName:v.displayName, avatarUrl:v.avatarUrl, updatedAt:v.updatedAt, contacts, suppressions };
}
function malformed(): PeopleServiceError {
  const error = new PeopleServiceError("people_unknown", false);
  reportNonFatal("people-malformed-response", error, { feature: "people", code: error.code });
  return error;
}
function fromRpcError(error: { code?: string; message?: string; status?: number }): PeopleServiceError {
  const messageCode = error.message?.match(/people_[a-z_]+/)?.[0];
  if (messageCode && SAFE_CODES.has(messageCode)) return new PeopleServiceError(messageCode as PeopleErrorCode, false);
  if (typeof error.status === "number" && error.status >= 500) return new PeopleServiceError("people_temporarily_unavailable", true);
  return new PeopleServiceError("people_temporarily_unavailable", true);
}
export async function listBrandPeople(input:{brandId:string;search:string|null;cursor:BookCursor|null;limit:number}):Promise<BrandPeopleBookPage>{
  const { data,error } = await supabase.rpc("biz_get_brand_people_book", { p_brand_id:input.brandId,p_search:input.search,p_cursor:input.cursor,p_limit:input.limit });
  if(error) throw fromRpcError(error); if(!isRecord(data)||!Array.isArray(data.rows)||!(data.nextCursor===null||isRecord(data.nextCursor))||typeof data.bookTotal!=="number"||typeof data.filteredTotal!=="number") throw malformed();
  const cursor=data.nextCursor===null?null:(stringValue(data.nextCursor.updatedAt)&&stringValue(data.nextCursor.personId)?{updatedAt:data.nextCursor.updatedAt,personId:data.nextCursor.personId}:null);
  if(data.nextCursor!==null&&cursor===null) throw malformed();
  return {rows:data.rows.map(parsePerson),nextCursor:cursor,bookTotal:data.bookTotal,filteredTotal:data.filteredTotal};
}
export async function getBrandPerson(input:{brandId:string;personId:string}):Promise<BrandPersonSummary>{
  const {data,error}=await supabase.rpc("biz_get_brand_person",{p_brand_id:input.brandId,p_person_id:input.personId}); if(error) throw fromRpcError(error); return parsePerson(data);
}
export async function addBrandPerson(input:AddBrandPersonInput):Promise<AddBrandPersonResult>{
  const {data,error}=await supabase.rpc("biz_add_brand_person",{p_brand_id:input.brandId,p_display_name:input.displayName,p_email:input.email,p_phone_e164:input.phoneE164,p_phone_country_iso:input.phoneCountryIso,p_client_request_id:input.clientRequestId});
  if(error) throw fromRpcError(error); if(!isRecord(data)||!(["created","updated","unchanged","review"] as unknown[]).includes(data.outcome)||!(data.conflictId===null||typeof data.conflictId==="string")) throw malformed();
  const outcome=data.outcome as AddBrandPersonResult["outcome"]; const person=data.person===null?null:parsePerson(data.person);
  if((outcome==="review")!==(person===null)) throw malformed(); return {outcome,person,conflictId:data.conflictId as string|null};
}
