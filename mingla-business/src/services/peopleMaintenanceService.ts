import type {
  BrandPersonMaintenanceOperation,
  BrandPersonIdentitySummary,
  BrandPersonMergeCandidate,
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
  PeopleErrorCode,
} from "../types/people";
import { reportNonFatal } from "../diagnostics/reportNonFatal";
import { PeopleServiceError } from "./peopleService";
import { supabase } from "./supabase";

const SAFE_CODES = new Set([
  "people_forbidden", "people_not_found", "people_merge_pair_invalid",
  "people_merge_stale", "people_merge_open_conflict", "people_merge_distinct_users",
  "people_split_not_found", "people_split_stale", "people_split_unsafe",
  "people_primary_invalid", "people_primary_stale", "people_erased_contact_suppressed",
]);
const isPeopleRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const peopleStringValue = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
function peopleServiceMalformed(): PeopleServiceError {
  const error = new PeopleServiceError("people_unknown", false);
  reportNonFatal("people-malformed-response", error, {
    feature: "people",
    code: error.code,
  });
  return error;
}
function peopleServiceFromRpcError(
  error: { code?: string; message?: string; status?: number },
  aliases: Readonly<Record<string, PeopleErrorCode>> = {},
): PeopleServiceError {
  const messageCode = error.message?.match(/people_[a-z_]+/)?.[0];
  const safeCode = messageCode && (aliases[messageCode] ?? (
    SAFE_CODES.has(messageCode) ? messageCode as PeopleErrorCode : null
  ));
  if (safeCode) return new PeopleServiceError(safeCode, false);
  return new PeopleServiceError("people_temporarily_unavailable", true);
}

function parseBrandPersonIdentitySummary(
  value: unknown,
): BrandPersonIdentitySummary {
  if (
    !isPeopleRecord(value) || !peopleStringValue(value.personId) ||
    !peopleStringValue(value.displayName) ||
    !(value.avatarUrl === null || typeof value.avatarUrl === "string") ||
    !peopleStringValue(value.updatedAt) || !Array.isArray(value.alternateNames) ||
    !value.alternateNames.every(peopleStringValue) ||
    !Array.isArray(value.contacts) || typeof value.linked !== "boolean" ||
    !peopleStringValue(value.identityVersion)
  ) throw peopleServiceMalformed();
  const contacts = value.contacts.map((contact) => {
    if (
      !isPeopleRecord(contact) || !peopleStringValue(contact.id) ||
      (contact.channel !== "email" && contact.channel !== "phone") ||
      !peopleStringValue(contact.value) || typeof contact.isPrimary !== "boolean"
    ) throw peopleServiceMalformed();
    return {
      id: contact.id,
      channel: contact.channel as "email" | "phone",
      value: contact.value,
      isPrimary: contact.isPrimary,
    };
  });
  return {
    personId: value.personId,
    displayName: value.displayName,
    avatarUrl: value.avatarUrl,
    updatedAt: value.updatedAt,
    alternateNames: value.alternateNames as string[],
    contacts,
    linked: value.linked,
    identityVersion: value.identityVersion,
  };
}

function parseCandidateCursor(
  value: unknown,
): BrandPersonMergeCandidateCursor | null {
  if (value === null) return null;
  if (
    !isPeopleRecord(value) || !peopleStringValue(value.updatedAt) ||
    !peopleStringValue(value.personId)
  ) {
    throw peopleServiceMalformed();
  }
  return { updatedAt: value.updatedAt, personId: value.personId };
}

function parseCandidate(value: unknown): BrandPersonMergeCandidate {
  const identity = parseBrandPersonIdentitySummary(value);
  if (!isPeopleRecord(value) || !("matchedContact" in value)) {
    throw peopleServiceMalformed();
  }
  if (value.matchedContact === null) return { ...identity, matchedContact: null };
  const contact = value.matchedContact;
  if (
    !isPeopleRecord(contact) || !peopleStringValue(contact.id) ||
    (contact.channel !== "email" && contact.channel !== "phone") ||
    !peopleStringValue(contact.value) || typeof contact.isPrimary !== "boolean"
  ) {
    throw peopleServiceMalformed();
  }
  return {
    ...identity,
    matchedContact: {
      id: contact.id,
      channel: contact.channel,
      value: contact.value,
      isPrimary: contact.isPrimary,
    },
  };
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
    throw peopleServiceFromRpcError(error, {
      people_query_invalid: "people_search_invalid",
    });
  }
  if (!isPeopleRecord(data) || !Array.isArray(data.rows)) {
    throw peopleServiceMalformed();
  }
  return {
    rows: data.rows.map(parseCandidate),
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
    throw peopleServiceFromRpcError(error, {
      people_merge_invalid: "people_merge_pair_invalid",
    });
  }
  if (
    !isPeopleRecord(data) ||
    (data.state !== "ready" && data.state !== "open_conflict" &&
      data.state !== "distinct_linked_users") ||
    !peopleStringValue(data.leftVersion) ||
    !peopleStringValue(data.rightVersion) ||
    typeof data.hadOpenConflict !== "boolean" ||
    typeof data.hadPriorSeparation !== "boolean"
  ) throw peopleServiceMalformed();
  return {
    state: data.state,
    left: parseBrandPersonIdentitySummary(data.left),
    right: parseBrandPersonIdentitySummary(data.right),
    leftVersion: data.leftVersion,
    rightVersion: data.rightVersion,
    hadOpenConflict: data.hadOpenConflict,
    hadPriorSeparation: data.hadPriorSeparation,
  };
}

function parseMergeResult(data: unknown): BrandPersonMergeResult {
  if (
    !isPeopleRecord(data) || !peopleStringValue(data.operationId) ||
    !peopleStringValue(data.mergeEventId) ||
    !peopleStringValue(data.survivorPersonId) ||
    !peopleStringValue(data.absorbedPersonId) ||
    !peopleStringValue(data.identityVersion) ||
    typeof data.replayed !== "boolean"
  ) throw peopleServiceMalformed();
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
    throw peopleServiceFromRpcError(error, {
      people_merge_invalid: "people_merge_pair_invalid",
      people_identity_stale: "people_merge_stale",
      people_merge_distinct_linked_users: "people_merge_distinct_users",
    });
  }
  return parseMergeResult(data);
}

function parsePromoteResult(data: unknown): BrandPersonPromoteResult {
  if (
    !isPeopleRecord(data) || !peopleStringValue(data.operationId) ||
    (data.outcome !== "completed" && data.outcome !== "unchanged") ||
    !peopleStringValue(data.personId) ||
    !peopleStringValue(data.contactMethodId) ||
    (data.channel !== "email" && data.channel !== "phone") ||
    !peopleStringValue(data.identityVersion) || typeof data.replayed !== "boolean"
  ) throw peopleServiceMalformed();
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
    throw peopleServiceFromRpcError(error, {
      people_identity_stale: "people_primary_stale",
      people_contact_not_found: "people_primary_invalid",
    });
  }
  return parsePromoteResult(data);
}

function parseHistoryCursor(
  value: unknown,
): BrandPersonMergeHistoryCursor | null {
  if (value === null) return null;
  if (
    !isPeopleRecord(value) || !peopleStringValue(value.createdAt) ||
    !peopleStringValue(value.mergeEventId)
  ) throw peopleServiceMalformed();
  return { createdAt: value.createdAt, mergeEventId: value.mergeEventId };
}

function parseHistoryRow(value: unknown): BrandPersonMergeHistoryRow {
  if (
    !isPeopleRecord(value) || !peopleStringValue(value.mergeEventId) ||
    (value.status !== "active" && value.status !== "reversed") ||
    !peopleStringValue(value.createdAt) ||
    !(value.reversedAt === null || typeof value.reversedAt === "string") ||
    !peopleStringValue(value.survivorPersonId) ||
    !peopleStringValue(value.survivorLabel) ||
    !peopleStringValue(value.counterpartPersonId) ||
    !peopleStringValue(value.counterpartLabel) ||
    typeof value.canSplit !== "boolean" ||
    !peopleStringValue(value.eventVersion)
  ) throw peopleServiceMalformed();
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
    throw peopleServiceFromRpcError(error, {
      people_query_invalid: "people_limit_invalid",
    });
  }
  if (!isPeopleRecord(data) || !Array.isArray(data.rows)) {
    throw peopleServiceMalformed();
  }
  return {
    rows: data.rows.map(parseHistoryRow),
    nextCursor: parseHistoryCursor(data.nextCursor),
  };
}

function parseSplitPreview(data: unknown): BrandPersonSplitPreview {
  if (!isPeopleRecord(data)) throw peopleServiceMalformed();
  if (data.state === "unsafe" && peopleStringValue(data.supportReference)) {
    return { state: "unsafe", supportReference: data.supportReference };
  }
  if (
    data.state !== "safe" || !peopleStringValue(data.mergeEventId) ||
    !peopleStringValue(data.splitVersion)
  ) throw peopleServiceMalformed();
  return {
    state: "safe",
    mergeEventId: data.mergeEventId,
    splitVersion: data.splitVersion,
    left: parseBrandPersonIdentitySummary(data.left),
    right: parseBrandPersonIdentitySummary(data.right),
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
    throw peopleServiceFromRpcError(error, {
      people_merge_not_found: "people_split_not_found",
    });
  }
  return parseSplitPreview(data);
}

function parseSplitResult(data: unknown): BrandPersonSplitResult {
  if (
    !isPeopleRecord(data) || !peopleStringValue(data.operationId) ||
    typeof data.replayed !== "boolean"
  ) throw peopleServiceMalformed();
  if (data.outcome === "reversed" && peopleStringValue(data.restoredPersonId)) {
    return {
      operationId: data.operationId,
      outcome: "reversed",
      restoredPersonId: data.restoredPersonId,
      replayed: data.replayed,
    };
  }
  if (
    data.outcome === "escalated" && peopleStringValue(data.supportReference)
  ) {
    return {
      operationId: data.operationId,
      outcome: "escalated",
      supportReference: data.supportReference,
      replayed: data.replayed,
    };
  }
  throw peopleServiceMalformed();
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
    throw peopleServiceFromRpcError(error, {
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
    throw peopleServiceFromRpcError(error, {
      people_operation_not_found: "people_not_found",
    });
  }
  if (isPeopleRecord(data) && "mergeEventId" in data) {
    return parseMergeResult(data);
  }
  if (isPeopleRecord(data) && "contactMethodId" in data) {
    return parsePromoteResult(data);
  }
  return parseSplitResult(data);
}
