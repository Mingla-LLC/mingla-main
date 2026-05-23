export function buildPendingCollabPhoneE164(
  phoneInput: string,
  dialCode: string | null | undefined,
): string {
  const digits = phoneInput.replace(/\D/g, "");
  if (!dialCode || !digits) return "";
  return `${dialCode}${digits}`;
}

export function isPendingCollabPhoneValid(phoneInput: string): boolean {
  return phoneInput.replace(/\D/g, "").length >= 7;
}

export type PendingCollabMembershipChangeRow = {
  session_id?: string | null;
  user_id?: string | null;
  invited_user_id?: string | null;
  has_accepted?: boolean | null;
  status?: string | null;
};

export type PendingCollabInviteLike = {
  status?: string | null;
  inviteKind?: "warm" | "cold" | null;
};

export function canRevokePendingCollabInvite(
  person: PendingCollabInviteLike | null | undefined,
): boolean {
  return (
    person?.status === "pending" &&
    (person.inviteKind === "warm" || person.inviteKind === "cold")
  );
}

export function getPendingCollabRealtimeSessionId(
  row: PendingCollabMembershipChangeRow | null | undefined,
): string | null {
  return typeof row?.session_id === "string" && row.session_id.length > 0
    ? row.session_id
    : null;
}

export function isPendingCollabReadyChange(
  row: PendingCollabMembershipChangeRow | null | undefined,
  pendingSessionIds: ReadonlySet<string>,
  currentUserId: string,
): boolean {
  const sessionId = getPendingCollabRealtimeSessionId(row);
  if (!sessionId || !pendingSessionIds.has(sessionId)) return false;

  const actorUserId = row?.user_id ?? row?.invited_user_id ?? null;
  if (actorUserId === currentUserId) return false;

  return row?.has_accepted === true || row?.status === "accepted";
}
