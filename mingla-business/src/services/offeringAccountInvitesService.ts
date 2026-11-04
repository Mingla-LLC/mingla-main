// #3682 wave 2 — the host's view of followers invited through their Mingla
// account. Names, avatars and delivery states only: an address or phone
// number is never part of this response (#876 ring contract).
import { supabase } from "./supabase";

export type AccountInviteDeliveryState = "queued" | "sent" | "skipped" | "failed";

export interface OfferingAccountInviteRecipient {
  displayName: string;
  avatarUrl: string | null;
  reason: "follower" | "extended";
  push: AccountInviteDeliveryState;
  email: AccountInviteDeliveryState;
}

export interface OfferingAccountInvites {
  counts: { invited: number; reached: number; pending: number; notReached: number };
  recipients: OfferingAccountInviteRecipient[];
}

const STATES = new Set(["queued", "sent", "skipped", "failed"]);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function parseOfferingAccountInvites(value: unknown): OfferingAccountInvites {
  const record = value as Record<string, unknown> | null;
  const counts = record?.counts as Record<string, unknown> | undefined;
  const recipients = record?.recipients;
  if (!counts || !Array.isArray(recipients) ||
      ![counts.invited, counts.reached, counts.pending, counts.notReached].every(isCount)) {
    throw new Error("account_invites_invalid_response");
  }
  return {
    counts: {
      invited: counts.invited as number,
      reached: counts.reached as number,
      pending: counts.pending as number,
      notReached: counts.notReached as number,
    },
    recipients: recipients.flatMap((row): OfferingAccountInviteRecipient[] => {
      const item = row as Record<string, unknown>;
      if (typeof item.displayName !== "string" ||
          (item.reason !== "follower" && item.reason !== "extended") ||
          !STATES.has(String(item.push)) || !STATES.has(String(item.email))) return [];
      return [{
        displayName: item.displayName,
        avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : null,
        reason: item.reason,
        push: item.push as AccountInviteDeliveryState,
        email: item.email as AccountInviteDeliveryState,
      }];
    }),
  };
}

export async function getOfferingAccountInvites(eventId: string): Promise<OfferingAccountInvites> {
  const { data, error } = await supabase.rpc(
    "biz_get_offering_account_invites_v1" as never,
    { p_event_id: eventId } as never,
  );
  if (error) throw error;
  return parseOfferingAccountInvites(data);
}
