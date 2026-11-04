// #3682 wave 3 (#1782) — the words for Friends of followers controls. One
// place so every surface says the same true thing: a brand sees a name and a
// photo, never contact details, and never which friend connects you (#876).

export const FRIENDS_REACH_LABEL = "Invites through friends";

export function friendsReachHint(enabled: boolean): string {
  return enabled
    ? "Brands your friends follow can invite you. They see only your name and photo, never your email, phone or which friend connects you."
    : "Off. Brands reach you only if you follow them or you're on their guest list.";
}

export const STOP_THROUGH_FRIENDS_ROW = "Stop invites through friends";

export function stopThroughFriendsConfirm(brandName: string): {
  title: string;
  body: string;
  confirm: string;
} {
  return {
    title: "Stop invites through friends?",
    body: `You'll unfollow ${brandName}, and it won't be able to invite you through friends who follow it. You can undo this in Brands you follow.`,
    confirm: "Unfollow and stop",
  };
}

export function stoppedToast(brandName: string, unfollowed: boolean): string {
  return unfollowed
    ? `Unfollowed ${brandName}. No invites through friends.`
    : `${brandName} won't invite you through friends.`;
}

export function allowedAgainToast(brandName: string): string {
  return `${brandName} can invite you through friends again.`;
}

export const STOPPED_SECTION_TITLE = "Stopped invites through friends";
export const STOPPED_SECTION_CAPTION =
  "These brands can't invite you through friends. Following one again undoes this.";

export function stoppedCaption(exitedAt: string | null): string {
  if (!exitedAt) return "Stopped";
  const d = new Date(exitedAt);
  if (Number.isNaN(d.getTime())) return "Stopped";
  return `Stopped ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** Brand page foot line for a signed-in guest who does not follow the brand. */
export function brandPageReachLine(brandName: string, stopped: boolean): string {
  return stopped
    ? `You stopped invites through friends from ${brandName}.`
    : `${brandName} can invite you through friends who follow it.`;
}

/** The brand page line shows only for a signed-in non-follower, only when true. */
export function shouldShowBrandFriendsReachRow(input: {
  userId: string | null;
  isFollowing: boolean;
  controlsLive: boolean;
  extendedEnabled: boolean;
  stopped: boolean;
}): boolean {
  if (!input.userId || input.isFollowing || !input.controlsLive) return false;
  return input.extendedEnabled || input.stopped;
}
