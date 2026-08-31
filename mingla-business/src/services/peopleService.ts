import { reportNonFatal } from "../diagnostics/reportNonFatal";
import type {
  AddBrandPersonInput,
  AddBrandPersonResult,
  BookCursor,
  BrandPeopleBookPage,
  BrandPersonConflict,
  BrandPersonConflictCandidate,
  BrandPersonConflictPage,
  BrandPersonConflictReason,
  BrandPersonConflictSourceKind,
  BrandPersonDetail,
  BrandPersonSummary,
  ConflictResolution,
  PeopleErrorCode,
  ResolveBrandPersonConflictInput,
  ResolveBrandPersonConflictResult,
} from "../types/people";
import { supabase } from "./supabase";

const SAFE_CODES = "|people_forbidden|people_not_found|people_limit_invalid|people_search_invalid|people_cursor_invalid|" +
  "people_name_invalid|people_email_invalid|people_phone_invalid|people_contact_required|people_idempotency_conflict|" +
  // #2305 — every resolve-path error the sheet renders specific copy for. Anything
  // NOT listed here maps to people_temporarily_unavailable and stays retryable, so a
  // raw 23505/P0002 can never reach the UI as an opaque failure.
  "people_conflict_not_found|people_conflict_already_resolved|people_resolution_invalid|" +
  "people_conflict_candidate_invalid|people_conflict_source_missing|people_conflict_user_collision|" +
  "people_conflict_subject_unavailable|people_conflict_not_dismissable|people_erased_contact_suppressed|";
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
function parsePersonDetailOrLegacy(v: unknown): BrandPersonDetail | BrandPersonSummary {
  const person = parsePerson(v);
  if (!isRecord(v)) throw malformed();
  if (!("alternateNames" in v) && !("linked" in v)
      && !("identityVersion" in v) && !("capabilities" in v)) return person;
  if (!Array.isArray(v.alternateNames)
      || !v.alternateNames.every(stringValue) || typeof v.linked !== "boolean"
      || !stringValue(v.identityVersion) || !isRecord(v.capabilities)) throw malformed();
  const capabilities = v.capabilities;
  if (typeof capabilities.canMerge !== "boolean"
      || typeof capabilities.canPromotePrimary !== "boolean"
      || typeof capabilities.canViewMergeHistory !== "boolean"
      || typeof capabilities.canSplit !== "boolean") throw malformed();
  return { ...person, alternateNames: v.alternateNames as string[], linked: v.linked,
    identityVersion: v.identityVersion,
    capabilities: capabilities as unknown as BrandPersonDetail["capabilities"] };
}
function malformed(): PeopleServiceError {
  const error = new PeopleServiceError("people_unknown", false);
  reportNonFatal("people-malformed-response", error, { feature: "people", code: error.code });
  return error;
}
function fromRpcError(error: { code?: string; message?: string; status?: number }): PeopleServiceError {
  const messageCode = error.message?.match(/people_[a-z_]+/)?.[0];
  if (messageCode && SAFE_CODES.includes(`|${messageCode}|`)) return new PeopleServiceError(messageCode as PeopleErrorCode, false);
  return new PeopleServiceError("people_temporarily_unavailable", true);
}
export async function listBrandPeople(input:{brandId:string;search:string|null;cursor:BookCursor|null;limit:number}):Promise<BrandPeopleBookPage>{
  const { data,error } = await supabase.rpc("biz_get_brand_people_book", { p_brand_id:input.brandId,p_search:input.search,p_cursor:input.cursor,p_limit:input.limit });
  if(error) throw fromRpcError(error); if(!isRecord(data)||!Array.isArray(data.rows)||!(data.nextCursor===null||isRecord(data.nextCursor))||typeof data.bookTotal!=="number"||typeof data.filteredTotal!=="number") throw malformed();
  const cursor=data.nextCursor===null?null:(stringValue(data.nextCursor.updatedAt)&&stringValue(data.nextCursor.personId)?{updatedAt:data.nextCursor.updatedAt,personId:data.nextCursor.personId}:null);
  if(data.nextCursor!==null&&cursor===null) throw malformed();
  return {rows:data.rows.map(parsePerson),nextCursor:cursor,bookTotal:data.bookTotal,filteredTotal:data.filteredTotal};
}
export async function getBrandPerson(input:{brandId:string;personId:string}):Promise<BrandPersonDetail|BrandPersonSummary>{
  const {data,error}=await supabase.rpc("biz_get_brand_person",{p_brand_id:input.brandId,p_person_id:input.personId}); if(error) throw fromRpcError(error); return parsePersonDetailOrLegacy(data);
}
export async function addBrandPerson(input:AddBrandPersonInput):Promise<AddBrandPersonResult>{
  const {data,error}=await supabase.rpc("biz_add_brand_person",{p_brand_id:input.brandId,p_display_name:input.displayName,p_email:input.email,p_phone_e164:input.phoneE164,p_phone_country_iso:input.phoneCountryIso,p_client_request_id:input.clientRequestId});
  if(error) throw fromRpcError(error); if(!isRecord(data)||!(["created","updated","unchanged","review"] as unknown[]).includes(data.outcome)||!(data.conflictId===null||typeof data.conflictId==="string")) throw malformed();
  const outcome=data.outcome as AddBrandPersonResult["outcome"]; const person=data.person===null?null:parsePerson(data.person);
  if((outcome==="review")!==(person===null)) throw malformed(); return {outcome,person,conflictId:data.conflictId as string|null};
}

/* #2305 — the conflict review queue. */
const CONFLICT_SOURCE_KINDS = "|event_rsvp|rsvp_plus_one|order|ticket_holder|reservation|stay_reservation|manual|import|";
const CONFLICT_REASONS = "|different_nonempty_names|multi_person_address_chain|manual_review|";
const nullableString = (v: unknown): v is string | null => v === null || typeof v === "string";
function parseConflictCandidate(v: unknown): BrandPersonConflictCandidate {
  if (!isRecord(v) || !stringValue(v.personId) || !stringValue(v.displayName)
      || !(v.avatarUrl === null || typeof v.avatarUrl === "string") || !Array.isArray(v.contacts)) throw malformed();
  const contacts = v.contacts.map((c) => {
    if (!isRecord(c) || (c.channel !== "email" && c.channel !== "phone") || !stringValue(c.value)
        || typeof c.isPrimary !== "boolean") throw malformed();
    return { channel: c.channel as "email" | "phone", value: c.value, isPrimary: c.isPrimary };
  });
  return { personId: v.personId, displayName: v.displayName, avatarUrl: v.avatarUrl, contacts };
}
function parseConflict(v: unknown): BrandPersonConflict {
  if (!isRecord(v) || !Array.isArray(v.conflictIds) || v.conflictIds.length === 0
      || !v.conflictIds.every(stringValue) || !Array.isArray(v.sourceKinds)
      || !v.sourceKinds.every((k) => typeof k === "string" && CONFLICT_SOURCE_KINDS.includes(`|${k}|`))
      || typeof v.reason !== "string" || !CONFLICT_REASONS.includes(`|${v.reason}|`)
      || !stringValue(v.createdAt) || typeof v.canResolve !== "boolean"
      || typeof v.detailsRetained !== "boolean" || typeof v.canDismiss !== "boolean"
      || !(v.dismissibleReason === null || v.dismissibleReason === "source_row_absent"
           || v.dismissibleReason === "manual_payload_not_retained")
      || !isRecord(v.incoming)
      || !nullableString(v.incoming.displayName) || !nullableString(v.incoming.email)
      || !nullableString(v.incoming.phone) || !Array.isArray(v.candidates)
      || !Array.isArray(v.matchedOn)
      || !v.matchedOn.every((m) => m === "email" || m === "phone")) throw malformed();
  return {
    conflictIds: v.conflictIds as string[],
    sourceKinds: v.sourceKinds as BrandPersonConflictSourceKind[],
    reason: v.reason as BrandPersonConflictReason,
    createdAt: v.createdAt,
    canResolve: v.canResolve,
    detailsRetained: v.detailsRetained,
    dismissibleReason: v.dismissibleReason as BrandPersonConflict["dismissibleReason"],
    canDismiss: v.canDismiss,
    incoming: {
      displayName: v.incoming.displayName, email: v.incoming.email, phone: v.incoming.phone,
    },
    candidates: v.candidates.map(parseConflictCandidate),
    matchedOn: v.matchedOn as ("email" | "phone")[],
  };
}
export async function listBrandPersonConflicts(input:{brandId:string;limit:number}):Promise<BrandPersonConflictPage>{
  const { data, error } = await supabase.rpc("biz_list_brand_person_conflicts", {
    p_brand_id: input.brandId, p_limit: input.limit,
  });
  if (error) throw fromRpcError(error);
  if (!isRecord(data) || typeof data.openCount !== "number" || !Array.isArray(data.rows)) throw malformed();
  return { openCount: data.openCount, rows: data.rows.map(parseConflict) };
}
export async function resolveBrandPersonConflict(
  input: ResolveBrandPersonConflictInput,
): Promise<ResolveBrandPersonConflictResult> {
  const { data, error } = await supabase.rpc("biz_resolve_brand_person_conflict", {
    p_brand_id: input.brandId,
    p_conflict_ids: input.conflictIds,
    p_resolution: input.resolution,
    p_winner_person_id: input.winnerPersonId,
    p_client_request_id: input.clientRequestId,
  });
  if (error) throw fromRpcError(error);
  if (!isRecord(data) || !Array.isArray(data.conflictIds) || !data.conflictIds.every(stringValue)
      || (data.resolution !== "merge" && data.resolution !== "separate"
          && data.resolution !== "dismiss")
      || !(data.personId === null || typeof data.personId === "string")
      || !Array.isArray(data.links) || !Array.isArray(data.mergedPersonIds)
      || !data.mergedPersonIds.every(stringValue)
      || typeof data.replayed !== "boolean") throw malformed();
  const links = data.links.map((l) => {
    if (!isRecord(l) || !stringValue(l.conflictId) || !stringValue(l.sourceLinkId)) throw malformed();
    return { conflictId: l.conflictId, sourceLinkId: l.sourceLinkId };
  });
  return {
    conflictIds: data.conflictIds as string[],
    resolution: data.resolution as ConflictResolution,
    personId: data.personId as string | null,
    links,
    mergedPersonIds: data.mergedPersonIds as string[],
    replayed: data.replayed,
  };
}
