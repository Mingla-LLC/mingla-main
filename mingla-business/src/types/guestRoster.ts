export type GuestRosterPrimaryStatus =
  | "bought_ticket"
  | "going"
  | "awaiting_approval"
  | "waitlisted"
  | "declined"
  | "denied"
  | "refunded"
  | "cancelled"
  | "transferred"
  | "not_responded"
  | "removed"
  | "existing_rsvp"
  | "existing_buyer"
  | "unlinked_guest"
  | "not_sent"
  | "sending"
  | "invite_failed"
  | "suppressed_or_skipped";

export type GuestRosterInvitationStatus =
  | "not_sent"
  | "sending"
  | "invited"
  | "failed"
  | "suppressed_or_skipped"
  | "removed"
  | "none";

export type GuestRosterFilter =
  | "all"
  | "needs_attention"
  | "no_response"
  | "confirmed"
  | "checked_in"
  | "not_checked_in"
  | "delivery_failed"
  | "removed"
  | "going"
  | "maybe"
  | "awaiting_approval"
  | "waitlisted"
  | "declined"
  | "denied"
  | "bought_ticket"
  | "refunded"
  | "cancelled"
  | "transferred";

export type GuestRosterSort =
  | "action_priority"
  | "name_asc"
  | "name_desc"
  | "recent_first";

export interface GuestRosterChannelAttempt {
  channel: "email" | "sms" | "push";
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed";
  providerAccepted: boolean;
  retryable: boolean;
  reason: string | null;
  occurredAt: string | null;
}

export interface GuestRosterPartySummary {
  size: number;
  activeTickets: number;
  refundedTickets: number;
  transferredTickets: number;
  checkedIn: number;
}

export interface GuestRosterRow {
  rosterKey: string;
  personId: string | null;
  displayName: string;
  avatarUrl: string | null;
  contactLabel: string | null;
  primaryStatus: GuestRosterPrimaryStatus;
  invitationStatus: GuestRosterInvitationStatus;
  invitationLabel: string | null;
  attempts: GuestRosterChannelAttempt[];
  party: GuestRosterPartySummary;
  rsvpId: string | null;
  orderIds: string[];
  latestActivityAt: string;
  checkedIn: boolean;
  canRemind: boolean;
  canRetry: boolean;
  canApprove: boolean;
  canDeny: boolean;
  isExportable: boolean;
}

export interface GuestRosterSummary {
  all: number;
  notResponded: number;
  confirmed: number;
  needsAttention: number;
  invited: number;
  notSent: number;
  sending: number;
  inviteFailed: number;
  watermark: number;
  generatedAt: string;
}

export interface GuestRosterPage {
  rows: GuestRosterRow[];
  summary: GuestRosterSummary;
  nextCursor: Record<string, unknown> | null;
  staleAfter: string;
  canExport: boolean;
}

export const GUEST_ROSTER_PRIMARY_LABELS: Readonly<Record<GuestRosterPrimaryStatus, string>> = {
  bought_ticket: "Bought ticket",
  going: "Going",
  awaiting_approval: "Awaiting approval",
  waitlisted: "Waitlisted",
  declined: "Declined",
  denied: "Denied",
  refunded: "Refunded",
  cancelled: "Cancelled",
  transferred: "Transferred",
  not_responded: "Not responded",
  removed: "Removed",
  existing_rsvp: "Existing RSVP",
  existing_buyer: "Existing buyer",
  unlinked_guest: "Unlinked guest",
  not_sent: "Not sent yet",
  sending: "Sending",
  invite_failed: "Invite failed",
  suppressed_or_skipped: "Suppressed / skipped",
};

export const GUEST_ROSTER_INVITATION_LABELS: Readonly<Record<GuestRosterInvitationStatus, string | null>> = {
  not_sent: "Not sent yet",
  sending: "Sending",
  invited: "Invited",
  failed: "Invite failed",
  suppressed_or_skipped: "Suppressed / skipped",
  removed: "Removed",
  none: null,
};
