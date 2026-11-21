/**
 * rsvpGuestRowLabel — issue #4508: the inviter's own name for one of their
 * guests, wherever the inviter sees it (the success card's rows, its pass
 * chips, the pass sheet). Pure and tiny: the success card and the guest model
 * both import it.
 */
/**
 * Round 8 — the inviter's own name for one of their guests. A
 * guest added by number always carries the number's last four digits (the
 * host list's convention), so two number guests never read the same; a friend
 * picked from the list has no last four (the server never returns them).
 */
export const rsvpGuestRowLabel = (
  displayName: string | null | undefined,
  phoneLast4: string | null | undefined,
): string => {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  const last4 = typeof phoneLast4 === "string" && phoneLast4.length > 0 ? phoneLast4 : null;
  if (name.length > 0) return last4 !== null ? `${name} · ${last4}` : name;
  return last4 !== null ? `Number ending ${last4}` : "Your guest";
};
