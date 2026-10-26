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
 * The 1:1 collab ("Start a collab") is Wave 5. Its slot is reserved behind
 * DM_COLLAB_MENU_ENABLED so the order does not move when it ships.
 * MINGLA-INVARIANT: I-4114-ONE-FRIEND-MENU | issue #4114 | The 1:1 chat menu and FriendActionsSheet render the same ordered list from buildFriendMenu; Report and Block are always last.
 */

// [TRANSITIONAL] Wave 5 (1:1 collab) flips this on and wires the action.
export const DM_COLLAB_MENU_ENABLED = false;

export type FriendMenuItemId =
  | "startCollab"
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
  dmCollabEnabled?: boolean;
}

export const FRIEND_MENU_ORDER: readonly FriendMenuItemId[] = [
  "startCollab",
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
  viewProfile: { labelKey: "chat:menuViewProfile", icon: "person-outline", tone: "default" },
  media: { labelKey: "chat:menuMedia", icon: "images-outline", tone: "default" },
  shareCard: { labelKey: "chat:menuShareCard", icon: "bookmark-outline", tone: "default" },
  addToSession: { labelKey: "chat:menuAddToSession", icon: "people-outline", tone: "default" },
  mute: { labelKey: "chat:menuMute", icon: "volume-mute-outline", tone: "default" },
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
      return ctx.surface === "chat" && ctx.isFriend && (ctx.dmCollabEnabled ?? DM_COLLAB_MENU_ENABLED);
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
      return { ...item, labelKey: "chat:menuUnmute", icon: "volume-high-outline" };
    }
    return item;
  });
}
