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
  BrandPersonIdentitySummary,
  BrandPersonMaintenanceOperation,
  BrandPersonMergeCandidateCursor,
  BrandPersonMergeCandidatePage,
  BrandPersonMergeHistoryCursor,
  BrandPersonMergeHistoryPage,
  BrandPersonMergeHistoryRow,
  BrandPersonMergePreview,
  BrandPersonMergeResult,
  BrandPersonPromoteResult,
  BrandPersonSplitPreview,
  BrandPersonSplitResult,
  BrandPersonSummary,
  ConflictResolution,
  PeopleErrorCode,
  ResolveBrandPersonConflictInput,
  ResolveBrandPersonConflictResult,
} from "../types/people";
import { supabase } from "./supabase";

const SAFE_CODES: ReadonlySet<string> = new Set([
  "people_forbidden","people_not_found","people_limit_invalid","people_search_invalid","people_cursor_invalid",
  "people_name_invalid","people_email_invalid","people_phone_invalid","people_contact_required","people_idempotency_conflict",
  // #2305 — every resolve-path error the sheet renders specific copy for. Anything
  // NOT listed here maps to people_temporarily_unavailable and stays retryable, so a
  // raw 23505/P0002 can never reach the UI as an opaque failure.
  "people_conflict_not_found","people_conflict_already_resolved","people_resolution_invalid",
  "people_conflict_candidate_invalid","people_conflict_source_missing","people_conflict_user_collision",
  "people_conflict_subject_unavailable","people_conflict_not_dismissable",
  "people_merge_pair_invalid","people_merge_stale","people_merge_open_conflict","people_merge_distinct_users",
  "people_split_not_found","people_split_stale","people_split_unsafe","people_primary_invalid",
  "people_primary_stale","people_erased_contact_suppressed",
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
function parseContacts(v: unknown): BrandPersonIdentitySummary["contacts"] {
  if (!Array.isArray(v)) throw malformed();
  return v.map((contact) => {
    if (!isRecord(contact) || !stringValue(contact.id)
        || (contact.channel !== "email" && contact.channel !== "phone")
        || !stringValue(contact.value) || typeof contact.isPrimary !== "boolean") {
      throw malformed();
    }
    return {
      id: contact.id,
      channel: contact.channel,
      value: contact.value,
      isPrimary: contact.isPrimary,
    };
  });
}
function parseIdentitySummary(v: unknown): BrandPersonIdentitySummary {
  if (!isRecord(v) || !stringValue(v.personId) || !stringValue(v.displayName)
      || !(v.avatarUrl === null || typeof v.avatarUrl === "string")
      || !stringValue(v.updatedAt) || !Array.isArray(v.alternateNames)
      || !v.alternateNames.every(stringValue) || typeof v.linked !== "boolean"
      || !stringValue(v.identityVersion)) throw malformed();
  return {
    personId: v.personId,
    displayName: v.displayName,
    avatarUrl: v.avatarUrl,
    updatedAt: v.updatedAt,
    alternateNames: v.alternateNames as string[],
    contacts: parseContacts(v.contacts),
    linked: v.linked,
    identityVersion: v.identityVersion,
  };
}
function parsePersonDetail(v: unknown): BrandPersonDetail {
  const identity = parseIdentitySummary(v);
  if (!isRecord(v) || !Array.isArray(v.suppressions) || !isRecord(v.capabilities)) {
    throw malformed();
  }
  const suppressions = v.suppressions.map((suppression) => {
    if (!isRecord(suppression)
        || (suppression.channel !== "email" && suppression.channel !== "sms")
        || (suppression.scope !== "marketing" && suppression.scope !== "all")) {
      throw malformed();
    }
    return {
      channel: suppression.channel as "email" | "sms",
      scope: suppression.scope as "marketing" | "all",
    };
  });
  const capabilities = v.capabilities;
  if (typeof capabilities.canMerge !== "boolean"
      || typeof capabilities.canPromotePrimary !== "boolean"
      || typeof capabilities.canViewMergeHistory !== "boolean"
      || typeof capabilities.canSplit !== "boolean") throw malformed();
  return { ...identity, suppressions, capabilities: {
    canMerge: capabilities.canMerge,
    canPromotePrimary: capabilities.canPromotePrimary,
    canViewMergeHistory: capabilities.canViewMergeHistory,
    canSplit: capabilities.canSplit,
  } };
}
function parsePersonDetailOrLegacy(v: unknown): BrandPersonDetail | BrandPersonSummary {
  if (isRecord(v)
      && !("alternateNames" in v) && !("linked" in v)
      && !("identityVersion" in v) && !("capabilities" in v)) {
    return parsePerson(v);
  }
  return parsePersonDetail(v);
}
function malformed(): PeopleServiceError {
  const error = new PeopleServiceError("people_unknown", false);
  reportNonFatal("people-malformed-response", error, { feature: "people", code: error.code });
  return error;
}
function fromRpcError(
  error: { code?: string; message?: string; status?: number },
  aliases: Readonly<Record<string, PeopleErrorCode>> = {},
): PeopleServiceError {
  const messageCode = error.message?.match(/people_[a-z_]+/)?.[0];
  if (messageCode && aliases[messageCode]) {
    return new PeopleServiceError(aliases[messageCode], false);
  }
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
const CONFLICT_SOURCE_KINDS: ReadonlySet<string> = new Set([
  "event_rsvp","rsvp_plus_one","order","ticket_holder","reservation","stay_reservation","manual","import",
]);
const CONFLICT_REASONS: ReadonlySet<string> = new Set([
  "different_nonempty_names","multi_person_address_chain","manual_review",
]);
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
      || !v.sourceKinds.every((k) => typeof k === "string" && CONFLICT_SOURCE_KINDS.has(k))
      || typeof v.reason !== "string" || !CONFLICT_REASONS.has(v.reason)
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

function parseCandidateCursor(value: unknown): BrandPersonMergeCandidateCursor | null {
  if (value === null) return null;
  if (!isRecord(value) || !stringValue(value.updatedAt) || !stringValue(value.personId)) {
    throw malformed();
  }
  return { updatedAt: value.updatedAt, personId: value.personId };
}

export async function listBrandPersonMergeCandidates(input: {
  brandId: string;
  personId: string;
  search: string | null;
  cursor: BrandPersonMergeCandidateCursor | null;
  limit: number;
}): Promise<BrandPersonMergeCandidatePage> {
  const { data, error } = await supabase.rpc(
    "biz_list_brand_person_merge_candidates",
    {
      p_brand_id: input.brandId,
      p_person_id: input.personId,
      p_search: input.search,
      p_cursor: input.cursor,
      p_limit: input.limit,
    },
  );
  if (error) {
    throw fromRpcError(error, { people_query_invalid: "people_search_invalid" });
  }
  if (!isRecord(data) || !Array.isArray(data.rows)) throw malformed();
  return {
    rows: data.rows.map(parseIdentitySummary),
    nextCursor: parseCandidateCursor(data.nextCursor),
  };
}

export async function previewBrandPersonMerge(input: {
  brandId: string;
  leftPersonId: string;
  rightPersonId: string;
}): Promise<BrandPersonMergePreview> {
  const { data, error } = await supabase.rpc("biz_preview_brand_person_merge", {
    p_brand_id: input.brandId,
    p_left_person_id: input.leftPersonId,
    p_right_person_id: input.rightPersonId,
  });
  if (error) {
    throw fromRpcError(error, { people_merge_invalid: "people_merge_pair_invalid" });
  }
  if (!isRecord(data)
      || (data.state !== "ready" && data.state !== "open_conflict"
        && data.state !== "distinct_linked_users")
      || !stringValue(data.leftVersion) || !stringValue(data.rightVersion)
      || typeof data.hadOpenConflict !== "boolean"
      || typeof data.hadPriorSeparation !== "boolean") throw malformed();
  return {
    state: data.state,
    left: parseIdentitySummary(data.left),
    right: parseIdentitySummary(data.right),
    leftVersion: data.leftVersion,
    rightVersion: data.rightVersion,
    hadOpenConflict: data.hadOpenConflict,
    hadPriorSeparation: data.hadPriorSeparation,
  };
}

function parseMergeResult(data: unknown): BrandPersonMergeResult {
  if (!isRecord(data) || !stringValue(data.operationId)
      || !stringValue(data.mergeEventId) || !stringValue(data.survivorPersonId)
      || !stringValue(data.absorbedPersonId) || !stringValue(data.identityVersion)
      || typeof data.replayed !== "boolean") throw malformed();
  return {
    operationId: data.operationId,
    mergeEventId: data.mergeEventId,
    survivorPersonId: data.survivorPersonId,
    absorbedPersonId: data.absorbedPersonId,
    identityVersion: data.identityVersion,
    replayed: data.replayed,
  };
}

export async function mergeBrandPeople(input: {
  brandId: string;
  winnerPersonId: string;
  loserPersonId: string;
  winnerVersion: string;
  loserVersion: string;
  clientRequestId: string;
}): Promise<BrandPersonMergeResult> {
  const { data, error } = await supabase.rpc("biz_merge_brand_people_manual", {
    p_brand_id: input.brandId,
    p_winner_person_id: input.winnerPersonId,
    p_loser_person_id: input.loserPersonId,
    p_winner_version: input.winnerVersion,
    p_loser_version: input.loserVersion,
    p_client_request_id: input.clientRequestId,
  });
  if (error) {
    throw fromRpcError(error, {
      people_merge_invalid: "people_merge_pair_invalid",
      people_identity_stale: "people_merge_stale",
      people_merge_distinct_linked_users: "people_merge_distinct_users",
    });
  }
  return parseMergeResult(data);
}

function parsePromoteResult(data: unknown): BrandPersonPromoteResult {
  if (!isRecord(data) || !stringValue(data.operationId)
      || (data.outcome !== "completed" && data.outcome !== "unchanged")
      || !stringValue(data.personId) || !stringValue(data.contactMethodId)
      || (data.channel !== "email" && data.channel !== "phone")
      || !stringValue(data.identityVersion) || typeof data.replayed !== "boolean") {
    throw malformed();
  }
  return {
    operationId: data.operationId,
    outcome: data.outcome,
    personId: data.personId,
    contactMethodId: data.contactMethodId,
    channel: data.channel,
    identityVersion: data.identityVersion,
    replayed: data.replayed,
  };
}

export async function promoteBrandPersonContact(input: {
  brandId: string;
  personId: string;
  contactMethodId: string;
  personVersion: string;
  clientRequestId: string;
}): Promise<BrandPersonPromoteResult> {
  const { data, error } = await supabase.rpc(
    "biz_promote_brand_person_contact",
    {
      p_brand_id: input.brandId,
      p_person_id: input.personId,
      p_contact_method_id: input.contactMethodId,
      p_person_version: input.personVersion,
      p_client_request_id: input.clientRequestId,
    },
  );
  if (error) {
    throw fromRpcError(error, {
      people_identity_stale: "people_primary_stale",
      people_contact_not_found: "people_primary_invalid",
    });
  }
  return parsePromoteResult(data);
}

function parseHistoryCursor(value: unknown): BrandPersonMergeHistoryCursor | null {
  if (value === null) return null;
  if (!isRecord(value) || !stringValue(value.createdAt)
      || !stringValue(value.mergeEventId)) throw malformed();
  return { createdAt: value.createdAt, mergeEventId: value.mergeEventId };
}

function parseHistoryRow(value: unknown): BrandPersonMergeHistoryRow {
  if (!isRecord(value) || !stringValue(value.mergeEventId)
      || (value.status !== "active" && value.status !== "reversed")
      || !stringValue(value.createdAt)
      || !(value.reversedAt === null || typeof value.reversedAt === "string")
      || !stringValue(value.survivorPersonId) || !stringValue(value.survivorLabel)
      || !stringValue(value.counterpartPersonId) || !stringValue(value.counterpartLabel)
      || typeof value.canSplit !== "boolean" || !stringValue(value.eventVersion)) {
    throw malformed();
  }
  return {
    mergeEventId: value.mergeEventId,
    status: value.status,
    createdAt: value.createdAt,
    reversedAt: value.reversedAt,
    survivorPersonId: value.survivorPersonId,
    survivorLabel: value.survivorLabel,
    counterpartPersonId: value.counterpartPersonId,
    counterpartLabel: value.counterpartLabel,
    canSplit: value.canSplit,
    eventVersion: value.eventVersion,
  };
}

export async function listBrandPersonMergeHistory(input: {
  brandId: string;
  personId: string;
  cursor: BrandPersonMergeHistoryCursor | null;
  limit: number;
}): Promise<BrandPersonMergeHistoryPage> {
  const { data, error } = await supabase.rpc(
    "biz_list_brand_person_merge_history",
    {
      p_brand_id: input.brandId,
      p_person_id: input.personId,
      p_cursor: input.cursor,
      p_limit: input.limit,
    },
  );
  if (error) {
    throw fromRpcError(error, { people_query_invalid: "people_limit_invalid" });
  }
  if (!isRecord(data) || !Array.isArray(data.rows)) throw malformed();
  return {
    rows: data.rows.map(parseHistoryRow),
    nextCursor: parseHistoryCursor(data.nextCursor),
  };
}

function parseSplitPreview(data: unknown): BrandPersonSplitPreview {
  if (!isRecord(data)) throw malformed();
  if (data.state === "unsafe" && stringValue(data.supportReference)) {
    return { state: "unsafe", supportReference: data.supportReference };
  }
  if (data.state !== "safe" || !stringValue(data.mergeEventId)
      || !stringValue(data.splitVersion)) throw malformed();
  return {
    state: "safe",
    mergeEventId: data.mergeEventId,
    splitVersion: data.splitVersion,
    left: parseIdentitySummary(data.left),
    right: parseIdentitySummary(data.right),
  };
}

export async function previewBrandPersonSplit(input: {
  brandId: string;
  mergeEventId: string;
}): Promise<BrandPersonSplitPreview> {
  const { data, error } = await supabase.rpc("biz_preview_brand_person_split", {
    p_brand_id: input.brandId,
    p_merge_event_id: input.mergeEventId,
  });
  if (error) {
    throw fromRpcError(error, { people_merge_not_found: "people_split_not_found" });
  }
  return parseSplitPreview(data);
}

function parseSplitResult(data: unknown): BrandPersonSplitResult {
  if (!isRecord(data) || !stringValue(data.operationId)
      || typeof data.replayed !== "boolean") throw malformed();
  if (data.outcome === "reversed" && stringValue(data.restoredPersonId)) {
    return {
      operationId: data.operationId,
      outcome: "reversed",
      restoredPersonId: data.restoredPersonId,
      replayed: data.replayed,
    };
  }
  if (data.outcome === "escalated" && stringValue(data.supportReference)) {
    return {
      operationId: data.operationId,
      outcome: "escalated",
      supportReference: data.supportReference,
      replayed: data.replayed,
    };
  }
  throw malformed();
}

export async function splitBrandPersonMerge(input: {
  brandId: string;
  mergeEventId: string;
  splitVersion: string;
  clientRequestId: string;
}): Promise<BrandPersonSplitResult> {
  const { data, error } = await supabase.rpc(
    "biz_reverse_brand_person_merge_manual",
    {
      p_brand_id: input.brandId,
      p_merge_event_id: input.mergeEventId,
      p_split_version: input.splitVersion,
      p_client_request_id: input.clientRequestId,
    },
  );
  if (error) {
    throw fromRpcError(error, {
      people_merge_not_found: "people_split_not_found",
      people_identity_stale: "people_split_stale",
      merge_reversal_requires_manual_partition: "people_split_unsafe",
    });
  }
  return parseSplitResult(data);
}

export async function getBrandPersonMaintenanceOperation(input: {
  brandId: string;
  clientRequestId: string;
}): Promise<BrandPersonMaintenanceOperation> {
  const { data, error } = await supabase.rpc(
    "biz_get_brand_person_maintenance_operation",
    {
      p_brand_id: input.brandId,
      p_client_request_id: input.clientRequestId,
    },
  );
  if (error) {
    throw fromRpcError(error, { people_operation_not_found: "people_not_found" });
  }
  if (isRecord(data) && "mergeEventId" in data) return parseMergeResult(data);
  if (isRecord(data) && "contactMethodId" in data) return parsePromoteResult(data);
  return parseSplitResult(data);
}
