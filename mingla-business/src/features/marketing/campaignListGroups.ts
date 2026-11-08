/**
 * #4273 polish — the campaign list folds a blast's methods into one card.
 * Pure functions only. Kept apart from sentPreviewModel so the list route and
 * the campaign screen share no module (anything two lazy routes import is
 * hoisted into the boot chunk, __common).
 */

import type {
  CampaignStatus,
  MarketingCampaignRow,
} from "../../types/marketing";

export type ListMethod = "email" | "sms" | "push";
const LIST_METHOD_ORDER: readonly ListMethod[] = ["email", "sms", "push"];

export const LIST_METHOD_LABEL: Record<ListMethod, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
};

export interface CampaignListGroup {
  groupId: string;
  /** The head when it is listed, else the earliest member. */
  primary: MarketingCampaignRow;
  members: MarketingCampaignRow[];
  /** One status for the card (see rollUpStatus). */
  status: CampaignStatus;
  channels: ListMethod[];
}

/**
 * sending > scheduled > failed (all failed) > sent (any sent) > draft (all
 * draft) > cancelled. A mix not covered above reads as its most recent member.
 */
export function rollUpStatus(statuses: readonly CampaignStatus[]): CampaignStatus {
  if (statuses.includes("sending")) return "sending";
  if (statuses.includes("scheduled")) return "scheduled";
  if (statuses.length > 0 && statuses.every((status) => status === "failed")) return "failed";
  if (statuses.includes("sent")) return "sent";
  if (statuses.length > 0 && statuses.every((status) => status === "draft")) return "draft";
  if (statuses.includes("cancelled") && statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("draft")) return "draft";
  return "cancelled";
}

/** Groups rows by COALESCE(campaign_group_id, id), keeping the list's order. */
export function groupCampaignRows(rows: readonly MarketingCampaignRow[]): CampaignListGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, MarketingCampaignRow[]>();
  for (const row of rows) {
    const groupId = row.campaign_group_id ?? row.id;
    const list = byGroup.get(groupId);
    if (list === undefined) {
      byGroup.set(groupId, [row]);
      order.push(groupId);
    } else {
      list.push(row);
    }
  }
  return order.map((groupId) => {
    const members = byGroup.get(groupId) ?? [];
    const head = members.find((row) => row.id === groupId);
    const earliest = [...members].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const primary = head ?? earliest ?? members[0];
    const present = new Set(members.map((row) => row.channel));
    return {
      groupId,
      primary,
      members,
      status: rollUpStatus(members.map((row) => row.status)),
      channels: LIST_METHOD_ORDER.filter((channel) => present.has(channel)),
    };
  });
}

/** The status filter applies after grouping: a group shows if any member matches. */
export function filterCampaignGroups(
  groups: readonly CampaignListGroup[],
  status: CampaignStatus | undefined,
): CampaignListGroup[] {
  if (status === undefined) return [...groups];
  return groups.filter((group) => group.members.some((row) => row.status === status));
}
