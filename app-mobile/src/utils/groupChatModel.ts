/**
 * Issue #4435: pure rules for group chats, shared by the create sheet, Add
 * people, Group info and the leave confirm. Dependency-free so it runs under
 * Deno. The server (create_group_chat, add_group_members, remove_group_member,
 * set_group_admin) is the authority; these mirror its limits for the UI.
 */

/** A group holds at most this many accepted members (collaboration_sessions.max_participants default). */
export const GROUP_CAP = 15;
/** The creator is one of the 15, so a new group takes at most 14 picks. */
export const MAX_CREATE_PICKS = GROUP_CAP - 1;

export type CreateButtonMode = "next" | "just_me";

/** "Next" with friends picked, "Just me for now" with nobody picked. */
export function createButtonMode(selectedCount: number): CreateButtonMode {
  return selectedCount > 0 ? "next" : "just_me";
}

/** How many more people a group can take. */
export function remainingSlots(acceptedCount: number, cap: number = GROUP_CAP): number {
  return Math.max(0, cap - Math.max(0, acceptedCount));
}

export type PickRowState = "pickable" | "picked" | "in_group" | "full";

/**
 * One friend row in a picker. People already in show "In group"; once the
 * picks would reach the cap, the unpicked rest show "Group full".
 */
export function pickRowState(input: {
  picked: boolean;
  inGroup: boolean;
  pickedCount: number;
  slots: number;
}): PickRowState {
  if (input.inGroup) return "in_group";
  if (input.picked) return "picked";
  return input.pickedCount >= input.slots ? "full" : "pickable";
}

export type DefaultGroupName =
  | { kind: "solo"; firstName: string }
  | { kind: "people"; firstNames: string[] };

/**
 * The name a blank group gets (decision Q4): "{first name}'s group" for a group
 * of one, otherwise the picked friends' first names (the caller joins them with
 * the locale's list format).
 */
export function defaultGroupName(myFirstName: string, friendFirstNames: string[]): DefaultGroupName {
  const names = friendFirstNames.map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) return { kind: "solo", firstName: myFirstName.trim() || "My" };
  return { kind: "people", firstNames: names.slice(0, 3) };
}

/** The server takes 1..100 characters; a typed name wins over the default. */
export function resolvedGroupName(typed: string, fallback: string): string {
  const name = typed.trim() || fallback.trim();
  return name.slice(0, 100);
}

export type LeaveCopyVariant = "last" | "second_to_last" | "standard";

/** Leave confirm copy: the last person deletes the group; the second-to-last leaves it open for one. */
export function leaveCopyVariant(acceptedCount: number): LeaveCopyVariant {
  if (acceptedCount <= 1) return "last";
  if (acceptedCount === 2) return "second_to_last";
  return "standard";
}

export interface GroupMemberRole {
  userId: string;
  isCreator: boolean;
  isAdmin: boolean;
}

export type MemberAction = "make_admin" | "remove_admin" | "remove" | "view_profile";

/**
 * The actions a viewer gets on one member row (design flow 3). Admins manage
 * people; nobody manages the creator (decision B); you never act on yourself
 * here (Leave is its own row).
 */
export function memberActions(viewer: GroupMemberRole, member: GroupMemberRole): MemberAction[] {
  const actions: MemberAction[] = [];
  const viewerIsAdmin = viewer.isCreator || viewer.isAdmin;
  if (viewerIsAdmin && member.userId !== viewer.userId && !member.isCreator) {
    actions.push(member.isAdmin ? "remove_admin" : "make_admin", "remove");
  }
  actions.push("view_profile");
  return actions;
}

/** The deferred-remove window (Undo toast). */
export const REMOVE_UNDO_MS = 6000;

/** Server error code → i18n key for the group membership functions. */
export function groupErrorKey(code: string | null | undefined): string {
  switch (code) {
    case "conflict_group_full":
      return "chat:group_full_toast";
    case "creator_protected":
      return "chat:group_creator_protected";
    case "last_admin":
      return "chat:group_last_admin";
    case "not_allowed":
      return "chat:group_not_allowed";
    default:
      return "chat:group_action_failed";
  }
}
