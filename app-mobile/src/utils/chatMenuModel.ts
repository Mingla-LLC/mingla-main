/**
 * Issue #4114 Wave 3: ONE action list for a friend, shared by the 1:1 chat's ⋯
 * menu and FriendActionsSheet (the friends sheet's ⋯). Pure and dependency-free
 * so it runs under Deno.
 *
 * Order (design contract "One menu"): start a collab, view profile, photos /
 * videos / cards, then the sharing rows, mute, the pairing row (paired friends
 * get "Birthday, holidays and saves"), and the destructive rows last with
 * Report before Block. "Search in chat" is not in the list yet: the thread only
 * holds the loaded pages, so a search would silently miss older messages.
 *
 * Issue #4114 Wave 5: "Start a collab with {name}" is first when the chat can
 * start one (a friend, nobody blocked, no live collab); "End the collab"
 * takes its place while one is live.
 */

export type FriendMenuItemId =
  | "startCollab"
  | "endCollab"
  | "viewProfile"
  | "media"
  | "shareCard"
  | "addToSession"
  | "mute"
  | "pairedView"
  | "sendPair"
  | "pairPending"
  | "unpair"
  | "removeFriend"
  | "report"
  | "block";

export interface FriendMenuItem {
  id: FriendMenuItemId;
  /** i18n key (namespace-qualified). */
  labelKey: string;
  icon: string;
  tone: "default" | "danger" | "disabled";
}

export interface FriendMenuContext {
  /** `chat`: the 1:1 thread's ⋯. `friendSheet`: FriendActionsSheet. */
  surface: "chat" | "friendSheet";
  isFriend: boolean;
  pairState: "paired" | "pending" | "none";
  /** A paired friend's birthday/holidays/saves view can be opened. */
  canOpenPairedView: boolean;
  /** The pairing id is known, so Unpair can run. */
  canUnpair: boolean;
  canViewProfile: boolean;
  /** The chat has a conversation (media and card sharing need one). */
  hasConversation: boolean;
  isMuted: boolean;
  /** Wave 5: a friend, nobody blocked, and no live collab in this 1:1 chat. */
  canStartCollab?: boolean;
  /** Wave 5: this 1:1 chat holds a live collab you are part of. */
  canEndCollab?: boolean;
}

export const FRIEND_MENU_ORDER: readonly FriendMenuItemId[] = [
  "startCollab",
  "endCollab",
  "viewProfile",
  "media",
  "shareCard",
  "addToSession",
  "mute",
  "pairedView",
  "sendPair",
  "pairPending",
  "unpair",
  "removeFriend",
  "report",
  "block",
];

const ITEMS: Record<FriendMenuItemId, Omit<FriendMenuItem, "id">> = {
  startCollab: { labelKey: "chat:menuStartCollab", icon: "albums-outline", tone: "default" },
  endCollab: { labelKey: "chat:menuEndCollab", icon: "close-circle-outline", tone: "default" },
  viewProfile: { labelKey: "chat:menuViewProfile", icon: "person-outline", tone: "default" },
  media: { labelKey: "chat:menuMedia", icon: "images-outline", tone: "default" },
  shareCard: { labelKey: "chat:menuShareCard", icon: "bookmark-outline", tone: "default" },
  addToSession: { labelKey: "chat:menuAddToSession", icon: "people-outline", tone: "default" },
  mute: { labelKey: "chat:menuMute", icon: "notifications-off", tone: "default" },
  pairedView: { labelKey: "connections:chat_menu_paired_view", icon: "gift-outline", tone: "default" },
  sendPair: { labelKey: "chat:menuSendPair", icon: "star-outline", tone: "default" },
  pairPending: { labelKey: "chat:menuPairPending", icon: "star-outline", tone: "disabled" },
  unpair: { labelKey: "chat:menuUnpair", icon: "star", tone: "default" },
  removeFriend: { labelKey: "chat:menuRemoveFriend", icon: "person-remove-outline", tone: "danger" },
  report: { labelKey: "chat:menuReport", icon: "flag-outline", tone: "danger" },
  block: { labelKey: "chat:menuBlock", icon: "ban-outline", tone: "danger" },
};

function included(id: FriendMenuItemId, ctx: FriendMenuContext): boolean {
  switch (id) {
    case "startCollab":
      return ctx.surface === "chat" && ctx.isFriend && ctx.canStartCollab === true && ctx.canEndCollab !== true;
    case "endCollab":
      return ctx.surface === "chat" && ctx.canEndCollab === true;
    case "viewProfile":
      return ctx.canViewProfile;
    case "media":
    case "shareCard":
      return ctx.surface === "chat" && ctx.hasConversation;
    case "addToSession":
      return ctx.isFriend;
    case "mute":
      return true;
    case "pairedView":
      return ctx.isFriend && ctx.pairState === "paired" && ctx.canOpenPairedView;
    case "sendPair":
      return ctx.surface === "friendSheet" && ctx.isFriend && ctx.pairState === "none";
    case "pairPending":
      return ctx.surface === "friendSheet" && ctx.isFriend && ctx.pairState === "pending";
    case "unpair":
      return ctx.surface === "friendSheet" && ctx.isFriend && ctx.pairState === "paired" && ctx.canUnpair;
    case "removeFriend":
      return ctx.isFriend;
    case "report":
    case "block":
      return true;
    default: {
      const never: never = id;
      return never;
    }
  }
}

export function buildFriendMenu(ctx: FriendMenuContext): FriendMenuItem[] {
  return FRIEND_MENU_ORDER.filter((id) => included(id, ctx)).map((id) => {
    const item = { id, ...ITEMS[id] };
    if (id === "mute" && ctx.isMuted) {
      return { ...item, labelKey: "chat:menuUnmute", icon: "notifications-outline" };
    }
    return item;
  });
}
