/**
 * #4420 — Host Messages, one thread per brand. Pure: no React, no services.
 *
 * The inbox shows ONE row per brand. The two lists the app already loads (the
 * Brand groups and the brand Guest chats) are joined here, in memory, by
 * brand_id: no new query, no second key for either entity. Inside the thread a
 * Team | Guests switcher picks the side, and the URL `side` param is the one
 * owner of which side shows.
 *
 * Loaded only by the Messages chunk (app/messages/[conversationId].tsx and the
 * inbox it lazy-loads), never by an eager route (SC-13).
 */
import type { BrandGroupSummary } from "../services/brandGroupsService";
import type { BrandGuestActivity, BrandGuestChatSummary } from "../services/brandGuestChatList";
import { brandGroupInboxPreview, type BrandGroupInboxFilter } from "./brandGroupThreadModel";

export type MessagesSide = "team" | "guests";

export interface BrandInboxRow {
  /** The brand id: one row per brand. */
  key: string;
  brandId: string;
  brandName: string;
  photoUrl: string | null;
  /** The brand's Team chat (Brand group); null when only a Guest chat exists. */
  group: BrandGroupSummary | null;
  /** The brand's Guest chat; null when the brand has none (or the viewer is support). */
  guestChat: BrandGuestChatSummary | null;
  /** The guest side's unread count and last message; null when unknown. */
  guestActivity: BrandGuestActivity | null;
  /** The later of the two sides' last message. */
  lastAt: string | null;
  /** Which side spoke last. */
  lastSide: MessagesSide;
  teamUnread: number;
  guestUnread: number;
  /** "support" rows (staff supporting a brand) never show the Guests side. */
  accessKind: "brand" | "support";
}

function time(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** The later of two ISO times (null only when both are missing). */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return time(b) > time(a) ? b : a;
}

/**
 * Brand groups + Guest chats → one row per brand, newest first. A support row
 * never carries a Guest chat (staff not on the team cannot see one). A Guest
 * chat with no Brand group still gets a row; it opens on Guests.
 */
export function buildBrandInboxRows(
  groups: readonly BrandGroupSummary[],
  guestChats: readonly BrandGuestChatSummary[],
  guestActivity: ReadonlyMap<string, BrandGuestActivity> = new Map(),
): BrandInboxRow[] {
  const guestsByBrand = new Map<string, BrandGuestChatSummary>();
  for (const chat of guestChats) {
    if (chat.brand_id && !guestsByBrand.has(chat.brand_id)) guestsByBrand.set(chat.brand_id, chat);
  }
  const rows: BrandInboxRow[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.brand_id)) continue;
    seen.add(group.brand_id);
    const guestChat = group.access_kind === "brand" ? guestsByBrand.get(group.brand_id) ?? null : null;
    rows.push(rowFor(group.brand_id, group, guestChat, guestChat ? guestActivity.get(guestChat.conversation_id) ?? null : null));
  }
  for (const chat of guestChats) {
    if (seen.has(chat.brand_id)) continue;
    seen.add(chat.brand_id);
    rows.push(rowFor(chat.brand_id, null, chat, guestActivity.get(chat.conversation_id) ?? null));
  }
  return rows.sort((left, right) => {
    const delta = time(right.lastAt) - time(left.lastAt);
    if (delta !== 0 && Number.isFinite(delta)) return delta;
    if (left.lastAt && !right.lastAt) return -1;
    if (!left.lastAt && right.lastAt) return 1;
    return left.brandName.localeCompare(right.brandName);
  });
}

function rowFor(
  brandId: string,
  group: BrandGroupSummary | null,
  guestChat: BrandGuestChatSummary | null,
  activity: BrandGuestActivity | null,
): BrandInboxRow {
  const teamAt = group?.last_message_at ?? null;
  const guestAt = activity?.last_message_at ?? guestChat?.last_message_at ?? null;
  const lastAt = laterOf(teamAt, guestAt);
  const lastSide: MessagesSide = !group || (guestChat && guestAt && time(guestAt) > time(teamAt)) ? "guests" : "team";
  return {
    key: brandId,
    brandId,
    brandName: group?.brand_name || guestChat?.brand_name || "Brand",
    photoUrl: group?.brand_photo_url ?? guestChat?.brand_logo_url ?? null,
    group,
    guestChat,
    guestActivity: activity,
    lastAt,
    lastSide,
    teamUnread: Math.max(0, group?.unread_count ?? 0),
    guestUnread: Math.max(0, activity?.unread_count ?? 0),
    accessKind: group?.access_kind === "support" ? "support" : "brand",
  };
}

/** What the row says under the name: which side spoke last, then the line. */
export function brandInboxRowPreview(row: BrandInboxRow, viewerId: string | null): { side: MessagesSide | null; text: string } {
  const teamText = row.group ? brandGroupInboxPreview(row.group, viewerId) : "";
  if (!row.guestChat) return { side: null, text: teamText };
  if (row.lastSide === "team" && row.group) return { side: "team", text: teamText };
  const line = (row.guestActivity?.last_message_preview ?? "").replace(/\s+/g, " ").trim();
  if (!line) return { side: "guests", text: "No guest messages yet" };
  return { side: "guests", text: row.guestActivity?.last_message_from_brand ? `As ${row.brandName}: ${line}` : line };
}

/** Search and the All / Unread / My brands / Supporting chips, on rows. */
export function filterBrandInboxRows(
  rows: readonly BrandInboxRow[],
  filter: BrandGroupInboxFilter,
  query: string,
  viewerId: string | null = null,
): BrandInboxRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "unread" && row.teamUnread + row.guestUnread <= 0) return false;
    if (filter === "mine" && row.accessKind !== "brand") return false;
    if (filter === "supporting" && row.accessKind !== "support") return false;
    if (!needle) return true;
    return row.brandName.toLowerCase().includes(needle)
      || brandInboxRowPreview(row, viewerId).text.toLowerCase().includes(needle);
  });
}

/** Which side a row opens on: Guests when only guests have news, else Team. */
export function brandInboxOpenSide(row: BrandInboxRow): MessagesSide {
  if (!row.group) return "guests";
  if (row.guestChat && row.guestUnread > 0 && row.teamUnread === 0) return "guests";
  return "team";
}

/** The one owner of the visible side: `?side=` (anything else reads as Team). */
export function parseMessagesSide(value: string | string[] | null | undefined): MessagesSide {
  const item = Array.isArray(value) ? value[0] : value;
  return item === "guests" ? "guests" : "team";
}

/** Where a row opens. A brand with a Team chat opens its thread; Guests only opens the Guest chat route. */
export function brandInboxRowHref(row: BrandInboxRow, side: MessagesSide = brandInboxOpenSide(row)): string {
  if (!row.group) return `/brand/${row.brandId}/guest-chat`;
  return brandThreadHref(row.group.conversation_id, row.group.access_kind, side);
}

export function brandThreadHref(conversationId: string, accessKind: "brand" | "support", side: MessagesSide): string {
  const mode = accessKind === "support" ? "support" : "brand";
  return side === "guests" && accessKind === "brand"
    ? `/messages/${conversationId}?mode=${mode}&side=guests`
    : `/messages/${conversationId}?mode=${mode}`;
}

/**
 * #4420 redirects: /brand/X/guest-chat and /messages/<guest chat id> both land
 * on X's thread with Guests selected. Null when X has no Team chat the viewer
 * can open (the caller then shows the Guest chat on its own).
 */
export function guestChatRedirectHref(
  brandId: string | null,
  groups: readonly Pick<BrandGroupSummary, "brand_id" | "conversation_id" | "access_kind">[],
): string | null {
  if (!brandId) return null;
  const group = groups.find((item) => item.brand_id === brandId && item.access_kind === "brand");
  return group ? brandThreadHref(group.conversation_id, "brand", "guests") : null;
}

/** Whether the switcher shows: a team row whose brand has a Guest chat (SC-2). */
export function showsSideSwitcher(group: Pick<BrandGroupSummary, "access_kind"> | null, guestChat: unknown): boolean {
  return group?.access_kind === "brand" && guestChat != null;
}
