// issue #3827 — guest-list party line for the ticket confirmation email.

/**
 * issue #3827 — the one line a guest-list guest's ticket email adds under the
 * intro, naming the guest they were added with. Comps only, and only when the
 * issue snapshotted the lead's name; every other order gets no line.
 */
export function guestListPartyLine(
  source: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (source !== "comp" || !metadata) return null;
  const lead = typeof metadata.party_lead_name === "string" ? metadata.party_lead_name.trim() : "";
  if (lead === "") return null;
  if (metadata.party_origin === "link") return `${lead} added you to the guest list.`;
  if (metadata.party_origin === "host") return `You're on the guest list with ${lead}.`;
  return null;
}
