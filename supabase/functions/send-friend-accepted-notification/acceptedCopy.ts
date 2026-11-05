// Issue #4261: the push copy for "your friend request was accepted" and for
// "someone joined from your invite link". Pure (no Deno or network imports) so
// the copy and the idempotency key are unit-testable.

export type AcceptedSource = "share_link";

export interface AcceptedCopyInput {
  accepterName: string;
  accepterId: string;
  senderId: string;
  requestId?: string;
  source?: AcceptedSource;
}

export interface AcceptedCopy {
  title: string;
  body: string;
  dataType: "friend_accepted" | "friend_share_joined";
  idempotencyKey: string;
}

/** Only the literal "share_link" selects the invite copy; anything else is the default. */
export function parseAcceptedSource(value: unknown): AcceptedSource | undefined {
  return value === "share_link" ? "share_link" : undefined;
}

export function acceptedNotificationCopy(input: AcceptedCopyInput): AcceptedCopy {
  if (input.source === "share_link") {
    return {
      title: `${input.accepterName} joined from your invite`,
      body: "You're friends now. Say hi.",
      dataType: "friend_share_joined",
      idempotencyKey: `friend_share_joined:${input.accepterId}:${input.senderId}`,
    };
  }
  return {
    title: `${input.accepterName} accepted your request`,
    body: "You're now connected — start planning together!",
    dataType: "friend_accepted",
    idempotencyKey: `friend_request_accepted:${input.accepterId}:${input.requestId || input.senderId}`,
  };
}
