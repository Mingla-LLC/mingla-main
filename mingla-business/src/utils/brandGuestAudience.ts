/**
 * #4420 — the Guests side's words: who a post reaches, the send label and the
 * first-send check. Pure: no React. Every word comes from the translator
 * (messages.* in the locale files).
 *
 * N is the Guest chat's members who are not on the brand team, exactly as
 * membership says (#4508 may change who is a member; names may be missing).
 * While the roster is loading or failed to load, N is unknown and the words
 * say "your guests": an unknown N is never shown as 0 (SC-3).
 */

export type MessagesTranslator = (key: string, variables?: Record<string, string | number>) => string;

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

/** "your guests", "1 guest", "23 guests" (0 and unknown read as "your guests"). */
export function guestWho(t: MessagesTranslator, n: number | null): string {
  if (n === null || n === 0) return t("messages.who_unknown");
  return n === 1 ? t("messages.who_one") : t("messages.who_count", { n });
}

/** The audience chip above the Guests composer. */
export function guestAudienceLine(t: MessagesTranslator, n: number | null, brand: string, broadcast: boolean): string {
  if (n === 0) return t("messages.audience_none", { brand });
  const who = guestWho(t, n);
  return broadcast ? t("messages.audience_broadcast", { who, brand }) : t("messages.audience_open", { who, brand });
}

/** The send button's words. */
export function guestSendLabel(t: MessagesTranslator, broadcast: boolean): string {
  return broadcast ? t("messages.mode_broadcast") : t("messages.send_guests");
}

/** The send button's accessibility label names the audience. */
export function guestSendA11y(t: MessagesTranslator, n: number | null, brand: string, broadcast: boolean): string {
  const who = guestWho(t, n);
  return broadcast ? t("messages.send_a11y_broadcast", { who, brand }) : t("messages.send_a11y_open", { who, brand });
}

/** The first-send check (once per thread open). */
export function guestConfirmCopy(t: MessagesTranslator, n: number | null, brand: string, broadcast: boolean): {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
} {
  const who = guestWho(t, n);
  return {
    title: broadcast ? t("messages.confirm_title_broadcast", { who }) : t("messages.confirm_title_open", { who }),
    description: t("messages.confirm_body", { brand }),
    confirmLabel: broadcast ? t("messages.mode_broadcast") : n === null || n === 0 ? t("messages.send_guests") : t("messages.confirm_send", { who }),
    cancelLabel: t("messages.keep_editing"),
  };
}

/** The Broadcast / Open chat switch's confirm. */
export function guestModeConfirmCopy(t: MessagesTranslator, toBroadcast: boolean, n: number | null, brand: string): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const who = guestWho(t, n);
  return toBroadcast
    ? { title: t("messages.mode_off_title", { who }), description: t("messages.mode_off_body", { brand }), confirmLabel: t("messages.mode_off_confirm") }
    : { title: t("messages.mode_on_title", { who }), description: t("messages.mode_on_body"), confirmLabel: t("messages.mode_on_confirm") };
}

/** The line under the switch. */
export function guestModeLine(t: MessagesTranslator, broadcast: boolean, brand: string): string {
  return broadcast ? t("messages.mode_line_broadcast", { brand }) : t("messages.mode_line_open");
}
