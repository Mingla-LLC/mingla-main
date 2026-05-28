// ORCH-0987: pure model for the friend more-menu — kept separate from the hook/component
// so the pair-state logic + the action set are unit-testable without a renderer.

export type FriendPairAction = "unpair" | "pending" | "pair";

/** Which pairing row the sheet shows, given the friend's current pair state. */
export function derivePairAction(isPaired: boolean, isPending: boolean): FriendPairAction {
  if (isPaired) return "unpair";
  if (isPending) return "pending";
  return "pair";
}

/** The six friend actions, in display order. The pairing row label is pair-state-aware. */
export const FRIEND_MENU_ACTIONS = [
  "pair",
  "addToSession",
  "mute",
  "removeFriend",
  "block",
  "report",
] as const;

export type FriendMenuAction = (typeof FRIEND_MENU_ACTIONS)[number];
