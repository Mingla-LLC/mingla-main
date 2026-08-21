import { supabase } from "../supabase";
import type {
  ManualGroupDetail,
  ManualGroupMember,
  ManualGroupReviewResult,
  ManualGroupSummary,
} from "../../types/marketing";

export type ManualGroupMutationResult = {
  group: ManualGroupSummary;
  addedCount: number;
  alreadyMemberCount: number;
  pendingReviewCount: number;
  rejectedCount: number;
  suppressedMemberCount: number;
  membershipVersion?: number;
};
export type DeleteManualGroupResult =
  | { code: "manual_group_delete_blocked"; blockingCampaignCount: number }
  | { groupId: string; deletedAt: string; peoplePreservedCount: number };
export type RemoveManualGroupPeopleResult = {
  removedCount: number;
  notMemberCount: number;
  memberCount: number;
  membershipVersion: number;
};
export type RenameManualGroupResult = { groupId: string; name: string; updatedAt: string };

export const stableManualMutationRequest = (
  current: { key: string; id: string } | null,
  key: string,
  createId: () => string,
): { key: string; id: string } => current?.key === key ? current : { key, id: createId() };

export const manualGroupDraftNameError = (name: string, existingNames: string[]): string | null => {
  const normalized = name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!normalized) return "Enter a group name.";
  if ([...name].length > 60) return "Use 60 characters or fewer.";
  if (/\p{Cc}/u.test(name)) return "Remove control characters from the name.";
  if (normalized === "your book") return "Choose a name other than Your Book.";
  if (existingNames.some((candidate) => candidate.trim().replace(/\s+/g, " ").toLocaleLowerCase() === normalized)) {
    return "A Manual group already uses this name.";
  }
  return null;
};

export const resultingManualMemberCount = (
  currentPersonIds: string[],
  selectedPersonIds: string[],
  importedPersonIds: string[],
): number => new Set([...currentPersonIds, ...selectedPersonIds, ...importedPersonIds]).size;

export class ManualGroupError extends Error {
  constructor(public code: string, public retryable: boolean) {
    super(manualGroupErrorMessage(code));
    this.name = "ManualGroupError";
  }
}

const messages: Record<string, string> = {
  manual_group_name_required: "Enter a group name.",
  manual_group_name_too_long: "Use 60 characters or fewer.",
  manual_group_name_reserved: "Choose a name other than Your Book.",
  manual_group_name_conflict: "A Manual group already uses this name.",
  manual_group_delete_blocked: "This group is selected by an unsent campaign.",
  manual_group_preview_stale: "This group changed after preview.",
  manual_group_forbidden: "You no longer have access to this group.",
  manual_group_feature_disabled: "Manual groups are not available yet.",
  manual_group_idempotency_conflict: "This request no longer matches. Try again.",
};

export const manualGroupErrorMessage = (code: string): string =>
  messages[code] ?? "We couldn't save this change. Nothing changed.";

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManualGroupError("manual_group_invalid_response", true);
  }
  return value as Record<string, unknown>;
};
const stringValue = (o: Record<string, unknown>, key: string): string => {
  if (typeof o[key] !== "string") throw new ManualGroupError("manual_group_invalid_response", true);
  return o[key] as string;
};
const numberValue = (o: Record<string, unknown>, key: string): number => {
  if (typeof o[key] !== "number" || !Number.isFinite(o[key])) {
    throw new ManualGroupError("manual_group_invalid_response", true);
  }
  return o[key] as number;
};
const nullableString = (o: Record<string, unknown>, key: string): string | null =>
  o[key] === null || o[key] === undefined ? null : stringValue(o, key);

const decodeSummary = (raw: unknown): ManualGroupSummary => {
  const o = asObject(raw);
  return {
    groupId: stringValue(o, "groupId"),
    name: stringValue(o, "name"),
    kind: "manual",
    memberCount: numberValue(o, "memberCount"),
    pendingReviewCount: numberValue(o, "pendingReviewCount"),
    membershipVersion: numberValue(o, "membershipVersion"),
    lastUsedAt: nullableString(o, "lastUsedAt"),
    createdAt: stringValue(o, "createdAt"),
    updatedAt: stringValue(o, "updatedAt"),
  };
};

const decodeMember = (raw: unknown): ManualGroupMember => {
  const o = asObject(raw);
  const contacts = Array.isArray(o.contacts) ? o.contacts.map((value) => {
    const c = asObject(value);
    const channel = stringValue(c, "channel");
    if (channel !== "email" && channel !== "phone") {
      throw new ManualGroupError("manual_group_invalid_response", true);
    }
    return {
      id: stringValue(c, "id"), channel: channel as "email" | "phone", value: stringValue(c, "value"),
      isPrimary: c.isPrimary === true,
    };
  }) : [];
  const suppressions = Array.isArray(o.suppressions) ? o.suppressions.map((value) => {
    const s = asObject(value);
    const channel = stringValue(s, "channel");
    if (channel !== "email" && channel !== "sms") {
      throw new ManualGroupError("manual_group_invalid_response", true);
    }
    return { channel: channel as "email" | "sms", scope: stringValue(s, "scope") };
  }) : [];
  return {
    personId: stringValue(o, "personId"),
    displayName: stringValue(o, "displayName"),
    avatarUrl: nullableString(o, "avatarUrl"),
    contacts,
    suppressions,
    ...(typeof o.isMember === "boolean" ? { isMember: o.isMember } : {}),
  };
};

const invoke = async <T>(name: string, args: Record<string, unknown>, decode: (raw: unknown) => T): Promise<T> => {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    const code = typeof error.message === "string"
      ? Object.keys(messages).find((candidate) => error.message.includes(candidate)) ?? "manual_group_unknown"
      : "manual_group_unknown";
    throw new ManualGroupError(code, !["manual_group_forbidden", "manual_group_feature_disabled"].includes(code));
  }
  return decode(data);
};

export const listManualGroups = (brandId: string): Promise<ManualGroupSummary[]> =>
  invoke("biz_list_people_manual_groups_v1", { p_brand_id: brandId }, (raw) => {
    const o = asObject(raw);
    if (!Array.isArray(o.groups)) throw new ManualGroupError("manual_group_invalid_response", true);
    return o.groups.map(decodeSummary);
  });

export const getManualGroup = (input: { brandId: string; groupId: string; search?: string; cursor?: Record<string, unknown> | null; limit?: number }): Promise<ManualGroupDetail> =>
  invoke("biz_get_manual_group_v1", {
    p_brand_id: input.brandId, p_group_id: input.groupId, p_search: input.search?.trim() || null,
    p_cursor: input.cursor ?? null, p_limit: input.limit ?? 50,
  }, (raw) => {
    const o = asObject(raw);
    const group = decodeSummary(o.group);
    return { ...group, members: Array.isArray(o.members) ? o.members.map(decodeMember) : [],
      totalMembers: numberValue(o, "totalMembers"), filteredTotal: numberValue(o, "filteredTotal"),
      nextCursor: o.nextCursor && typeof o.nextCursor === "object" ? o.nextCursor as Record<string, unknown> : null };
  });

export const previewManualGroupResult = (input: { brandId: string; groupId: string; personIds: string[]; importBatchIds: string[] }): Promise<ManualGroupReviewResult> =>
  invoke("biz_preview_manual_group_result_v1", { p_brand_id: input.brandId, p_group_id: input.groupId,
    p_person_ids: input.personIds, p_import_batch_ids: input.importBatchIds }, (raw) => {
      const o = asObject(raw);
      return { currentMemberCount: numberValue(o, "currentMemberCount"), resultingMemberCount: numberValue(o, "resultingMemberCount"), newMemberCount: numberValue(o, "newMemberCount") };
    });

export const getManualGroupBookPicker = (input: { brandId: string; groupId: string | null; search?: string; cursor?: Record<string, unknown> | null; limit?: number }): Promise<{ rows: ManualGroupMember[]; nextCursor: Record<string, unknown> | null }> =>
  invoke("biz_get_manual_group_book_picker_v1", {
    p_brand_id: input.brandId, p_group_id: input.groupId, p_search: input.search?.trim() || null,
    p_cursor: input.cursor ?? null, p_limit: input.limit ?? 50,
  }, (raw) => {
    const o = asObject(raw);
    return { rows: Array.isArray(o.rows) ? o.rows.map(decodeMember) : [],
      nextCursor: o.nextCursor && typeof o.nextCursor === "object" ? o.nextCursor as Record<string, unknown> : null };
  });

const decodeMutation = (raw: unknown): ManualGroupMutationResult => {
  const o = asObject(raw);
  return { group: decodeSummary(o.group), addedCount: numberValue(o, "addedCount"),
    alreadyMemberCount: numberValue(o, "alreadyMemberCount"), pendingReviewCount: numberValue(o, "pendingReviewCount"),
    rejectedCount: numberValue(o, "rejectedCount"), suppressedMemberCount: numberValue(o, "suppressedMemberCount"),
    ...(typeof o.membershipVersion === "number" ? { membershipVersion: o.membershipVersion } : {}) };
};

export const createManualGroup = (input: { brandId: string; name: string; personIds: string[]; importBatchIds: string[]; clientRequestId: string }) =>
  invoke("biz_create_manual_group_v1", { p_brand_id: input.brandId, p_name: input.name,
    p_person_ids: input.personIds, p_import_batch_ids: input.importBatchIds, p_client_request_id: input.clientRequestId }, decodeMutation);
export const addManualGroupPeople = (input: { brandId: string; groupId: string; personIds: string[]; importBatchIds: string[]; clientRequestId: string }) =>
  invoke("biz_add_manual_group_people_v1", { p_brand_id: input.brandId, p_group_id: input.groupId,
    p_person_ids: input.personIds, p_import_batch_ids: input.importBatchIds, p_client_request_id: input.clientRequestId }, decodeMutation);
export const removeManualGroupPeople = (input: { brandId: string; groupId: string; personIds: string[]; clientRequestId: string }) =>
  invoke("biz_remove_manual_group_people_v1", { p_brand_id: input.brandId, p_group_id: input.groupId,
    p_person_ids: input.personIds, p_client_request_id: input.clientRequestId }, (raw): RemoveManualGroupPeopleResult => {
      const o = asObject(raw);
      return { removedCount: numberValue(o, "removedCount"), notMemberCount: numberValue(o, "notMemberCount"),
        memberCount: numberValue(o, "memberCount"), membershipVersion: numberValue(o, "membershipVersion") };
    });
export const renameManualGroup = (input: { brandId: string; groupId: string; name: string; clientRequestId: string }) =>
  invoke("biz_rename_manual_group_v1", { p_brand_id: input.brandId, p_group_id: input.groupId,
    p_name: input.name, p_client_request_id: input.clientRequestId }, (raw): RenameManualGroupResult => {
      const o = asObject(raw);
      return { groupId: stringValue(o, "groupId"), name: stringValue(o, "name"), updatedAt: stringValue(o, "updatedAt") };
    });
export const deleteManualGroup = (input: { brandId: string; groupId: string; clientRequestId: string }) =>
  invoke("biz_delete_manual_group_v1", { p_brand_id: input.brandId, p_group_id: input.groupId,
    p_client_request_id: input.clientRequestId }, (raw): DeleteManualGroupResult => {
      const o = asObject(raw);
      if (o.code === "manual_group_delete_blocked") return { code: "manual_group_delete_blocked", blockingCampaignCount: numberValue(o, "blockingCampaignCount") };
      return { groupId: stringValue(o, "groupId"), deletedAt: stringValue(o, "deletedAt"), peoplePreservedCount: numberValue(o, "peoplePreservedCount") };
    });
