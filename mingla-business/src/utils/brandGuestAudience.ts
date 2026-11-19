/**
 * #4420 — the Guests side's words: who a post reaches, the send label and the
 * first-send check. Pure: no React.
 *
 * N is the Guest chat's members who are not on the brand team, exactly as
 * membership says (#4508 may change who is a member; names may be missing).
 * While the roster is loading or failed to load, N is unknown and the words
 * say "your guests": an unknown N is never shown as 0 (SC-3).
 */

export interface GuestAudienceMember {
  is_team: boolean;
}

/** Guests in the room, or null when the roster is not (yet) known. */
export function guestAudienceCount(
  members: readonly GuestAudienceMember[],
  state: { loaded: boolean; error: string | null },
): number | null {
  if (!state.loaded || state.error) return null;
  return members.filter((member) => !member.is_team).length;
}

function guests(n: number): string {
  return `${n} ${n === 1 ? "guest" : "guests"}`;
}

/** The audience chip above the Guests composer. */
export function guestAudienceLine(n: number | null, brandName: string, broadcast: boolean): string {
  if (n === 0) return `No guests yet · posts go out as ${brandName}`;
  const who = n === null ? "your guests" : guests(n);
  return broadcast ? `Broadcast to ${who} as ${brandName}` : `To ${who} · as ${brandName}`;
}

/** The send button's words (and its accessibility label names the audience). */
export function guestSendLabel(broadcast: boolean): string {
  return broadcast ? "Broadcast" : "Send to guests";
}

export function guestSendA11y(n: number | null, brandName: string, broadcast: boolean): string {
  const who = n === null || n === 0 ? "your guests" : guests(n);
  return `${broadcast ? "Broadcast" : "Send"} to ${who} as ${brandName}`;
}

/** The first-send check (once per thread open). */
export function guestConfirmCopy(n: number | null, brandName: string, broadcast: boolean): {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
} {
  const who = n === null || n === 0 ? "your guests" : guests(n);
  return {
    title: `${broadcast ? "Broadcast" : "Send"} to ${who}?`,
    description: `Everyone with a ticket or RSVP to ${brandName} sees this in the Guests room, posted as ${brandName}. Your Team chat stays private. We ask before your first guest message each time you open this chat.`,
    confirmLabel: broadcast ? "Broadcast" : n === null || n === 0 ? "Send to guests" : `Send to ${guests(n)}`,
    cancelLabel: "Keep editing",
  };
}

/** The Broadcast / Open chat switch's confirm, and the line under the switch. */
export function guestModeConfirmCopy(toBroadcast: boolean, n: number | null, brandName: string): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const who = n === null || n === 0 ? "guests" : guests(n);
  return toBroadcast
    ? {
      title: `Turn off replies for ${who}?`,
      description: `Guests keep reading what ${brandName} posts but cannot reply.`,
      confirmLabel: "Turn off replies",
    }
    : {
      title: `Let ${who} reply?`,
      description: "Guests can post in the room, and everyone in it sees replies.",
      confirmLabel: "Let guests reply",
    };
}

export function guestModeLine(broadcast: boolean, brandName: string): string {
  return broadcast
    ? `Only ${brandName} posts. Guests read but cannot reply.`
    : "Guests can reply. Everyone in the room sees replies.";
}
