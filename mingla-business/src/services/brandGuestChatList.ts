/**
 * #4459 — Messages → Guests: the list of brand Guest chats the signed-in person
 * runs and the route a row opens.
 *
 * Kept apart from groupChatService on purpose: the Messages inbox loads this,
 * while the Guest chat panel (and groupChatService with it) loads on intent
 * through LazyGroupChatPanel. A module both chunks import is hoisted into the
 * eager web `__common` chunk (bundle-baseline-movement), so this file and
 * groupChatService never import each other. Runtime imports: ./supabase only.
 */
import { supabase } from "./supabase";

/** #4459: one brand Guest chat the signed-in person runs (Messages → Guests). */
export interface BrandGuestChatSummary {
  conversation_id: string;
  brand_id: string;
  brand_name: string;
  brand_logo_url: string | null;
  is_broadcast_only: boolean;
  member_count: number;
  last_message_at: string | null;
}

/** #4459: the Guest chats of every brand I am on the team of. Throws on a failed read. */
export async function listMyBrandGuestChats(): Promise<BrandGuestChatSummary[]> {
  const { data, error } = await supabase.rpc("issue_4459_list_my_brand_guest_chats");
  // A read refusal has no write-specific wording (groupChatService's
  // brandGuestErrorCopy covers writes); say it plainly and let the row retry.
  if (error) throw new Error("Something went wrong. Try again.");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    conversation_id: String(row.conversation_id),
    brand_id: String(row.brand_id),
    brand_name: typeof row.brand_name === "string" ? row.brand_name : "",
    brand_logo_url: typeof row.brand_logo_url === "string" ? row.brand_logo_url : null,
    is_broadcast_only: row.is_broadcast_only === true,
    member_count: typeof row.member_count === "number" ? row.member_count : 0,
    last_message_at: typeof row.last_message_at === "string" ? row.last_message_at : null,
  }));
}

/**
 * #4420: the guest side's unread count and last line, per Guest chat I run
 * (issue_4420_brand_guest_activity, team members only). Shown on the inbox
 * row and the Guests tab of the switcher.
 */
export interface BrandGuestActivity {
  conversation_id: string;
  unread_count: number;
  last_message_preview: string;
  /** The last message was a brand post (a team member posting as the brand). */
  last_message_from_brand: boolean;
  last_message_at: string | null;
}

/** #4420: guest-side activity for the inbox. Throws on a failed read. */
export async function listMyBrandGuestActivity(): Promise<BrandGuestActivity[]> {
  const { data, error } = await supabase.rpc("issue_4420_brand_guest_activity");
  if (error) throw new Error(error.message || "guest_activity_failed");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    conversation_id: String(row.conversation_id),
    unread_count: typeof row.unread_count === "number" && row.unread_count > 0 ? row.unread_count : 0,
    last_message_preview: typeof row.last_message_preview === "string" ? row.last_message_preview : "",
    last_message_from_brand: row.last_message_from_brand === true,
    last_message_at: typeof row.last_message_at === "string" ? row.last_message_at : null,
  }));
}

/** #4459: where a Guest chat opens in the Host app. */
export function brandGuestChatHref(brandId: string): string {
  return `/brand/${brandId}/guest-chat`;
}
