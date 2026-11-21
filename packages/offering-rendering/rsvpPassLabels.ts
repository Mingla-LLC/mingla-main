/**
 * rsvpPassLabels — issue #4508: the success card's pass chip and the name
 * under its QR. Only the success card imports this module, so it rides that
 * chunk; the shared row label is the tiny rsvpGuestRowLabel leaf.
 */
import { rsvpGuestRowLabel } from "./rsvpGuestRowLabel.ts";

/**
 * Round 9 — the success card's pass chip and the name under its QR: a guest's
 * pass reads as their row does, never the host-facing "<Inviter>'s guest"
 * (`displayName` from the pass entity) when the submit answer knows the guest.
 */
export const rsvpPassLabel = (
  credential: { entityType: "primary" | "guest"; entityId: string; displayName: string },
  invites: ReadonlyArray<{ guestId: string | null; displayName: string | null; phoneLast4: string | null }> | undefined,
): string => {
  const invite = credential.entityType === "guest"
    ? invites?.find((g) => g.guestId === credential.entityId)
    : undefined;
  return invite !== undefined ? rsvpGuestRowLabel(invite.displayName, invite.phoneLast4) : credential.displayName;
};

/**
 * Round 10 — the short pass chip: the chips sit side by side, so on a small
 * phone "Number ending 0141" was cut to "Number ending 0…" and two number
 * guests looked the same. The chip keeps the digits that tell guests apart
 * ("Guest · 0141", "Kofi · 0002"); rsvpPassLabel stays the full label for
 * screen readers and the name under the QR.
 */
export const rsvpPassChipLabel = (
  credential: { entityType: "primary" | "guest"; entityId: string; displayName: string },
  invites: ReadonlyArray<{ guestId: string | null; displayName: string | null; phoneLast4: string | null }> | undefined,
): string => {
  const invite = credential.entityType === "guest"
    ? invites?.find((g) => g.guestId === credential.entityId)
    : undefined;
  const last4 = invite?.phoneLast4 ?? null;
  if (invite === undefined || last4 === null || last4.length === 0) {
    return rsvpPassLabel(credential, invites);
  }
  const first = (invite.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return `${first.length > 0 ? first : "Guest"} · ${last4}`;
};
