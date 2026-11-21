/**
 * #4490 P6/K — membership plans as the Host reads them. Pure types;
 * the server (`issue_4490_membership_plans`, `issue_4490_venue_members`,
 * `issue_4490_venue_member`) is the authority for every value. Money is in
 * minor units.
 */

export type MembershipPlanStatus = "draft" | "live" | "paused" | "archived";
export type MembershipPlanPeriod = "month" | "year";
export type MembershipJoinMode = "instant" | "request";

/** Server member statuses (A §3.6 + backend deviation 2: `lapsed`). */
export type MemberStatus =
  | "pending"
  | "active"
  | "payment_due"
  | "grace"
  | "lapsed"
  | "paused"
  | "requested"
  | "declined"
  | "cancelled";

export type MemberDiscountKind = "entry" | "group_package" | "private_hire" | "by_the_hour";

export interface MembershipPlan {
  id: string;
  venueId: string;
  name: string;
  summary: string | null;
  inclusions: string[];
  priceMinor: number;
  currencyCode: string;
  period: MembershipPlanPeriod;
  joinMode: MembershipJoinMode;
  deskSpaceIds: string[];
  deskSpaces: { id: string; name: string }[];
  entryIncluded: boolean;
  entryOfferingId: string | null;
  entryOfferName: string | null;
  roomHours: number;
  /** Empty = every by-the-hour offer of the venue. */
  hourOfferingIds: string[];
  hourOfferNames: string[];
  guestPasses: number;
  discountBps: number;
  discountKinds: MemberDiscountKind[];
  maxMembers: number | null;
  minMonths: number;
  noticeDays: number;
  graceDays: number;
  renewalNoticeDays: number;
  status: MembershipPlanStatus;
  sortOrder: number;
  version: number;
  members: number;
  activeMembers: number;
  full: boolean;
  /** The billing interval cannot change after the first join/request. */
  periodLocked: boolean;
}

export interface MembershipPlansState {
  venueId: string;
  featureOn: boolean;
  canManage: boolean;
  entryOffers: { id: string; name: string }[];
  hourOffers: { id: string; name: string }[];
  spaces: { id: string; name: string }[];
  plans: MembershipPlan[];
}

export type MembersServerFilter = "all" | "active" | "payment_due" | "paused" | "ended" | "pending" | "requests";

export interface VenueMemberRow {
  subscriptionId: string;
  name: string;
  email: string | null;
  phone: string | null;
  planId: string;
  planName: string;
  planPeriod: MembershipPlanPeriod;
  status: MemberStatus;
  activeUntil: string | null;
  renewsOn: string | null;
  leavingOn: string | null;
  pausingOn: string | null;
  roomHoursLeft: number;
  guestPassesLeft: number;
  inToday: boolean;
  amountDueMinor: number | null;
  assignedSpaceName: string | null;
  version: number;
  joinedAt: string | null;
}

export interface VenueMembersList {
  venueId: string;
  localDate: string;
  tiles: {
    members: number;
    membersAllowed: number | null;
    inToday: number;
    paymentDue: { count: number; amountMinor: number };
    renewingThisWeek: number;
  };
  members: VenueMemberRow[];
}

export type MemberPeriodStatus = "scheduled" | "link_sent" | "paid" | "overdue" | "void";

export interface MemberPeriod {
  periodId: string;
  sequence: number;
  start: string;
  end: string;
  amountMinor: number;
  currencyCode: string;
  dueAt: string | null;
  status: MemberPeriodStatus;
  paidAt: string | null;
  paidVia: "online" | "venue" | null;
  paidMethod: string | null;
  remindersSent: string[];
}

export interface MemberTimelineEvent {
  type: string;
  by: "member" | "staff" | "system";
  at: string;
  periodId: string | null;
  detail: Record<string, unknown> | null;
}

export interface MemberVisit {
  localDate: string;
  guests: number;
  at: string;
  undone: boolean;
}

export interface MemberPaymentDue {
  periodId: string;
  amountMinor: number;
  currencyCode: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  status: MemberPeriodStatus;
  graceEndsAt: string | null;
  paying: boolean;
}

/** One member, as the Host reads them (`issue_4490_venue_member`). */
export interface VenueMemberDetail {
  subscriptionId: string;
  status: MemberStatus;
  memberCode: string | null;
  memberName: string;
  email: string | null;
  phone: string | null;
  signedIn: boolean;
  plan: {
    id: string;
    name: string;
    priceMinor: number;
    currencyCode: string;
    inclusions: string[];
    entryIncluded: boolean;
    roomHours: number;
    guestPasses: number;
    discountBps: number;
    period: MembershipPlanPeriod;
    joinMode: MembershipJoinMode;
    deskSpaces: { id: string; name: string }[];
  };
  terms: { priceMinor: number | null; minMonths: number | null; noticeDays: number | null; graceDays: number | null };
  venue: { id: string; name: string; timezone: string };
  startOn: string | null;
  startedAt: string | null;
  activeUntil: string | null;
  renewsOn: string | null;
  renewalEmailOn: string | null;
  canCheckIn: boolean;
  assignedSpace: { id: string; name: string } | null;
  deskBookedFrom: string | null;
  paymentDue: MemberPaymentDue | null;
  leaving: { endsAt: string; by: string | null } | null;
  pausing: { from: string; by: string | null } | null;
  paused: { since: string | null; by: string | null } | null;
  endedAt: string | null;
  endReason: "left" | "cancelled_by_venue" | "not_paid" | null;
  credits: {
    roomHoursLeft: number;
    roomHoursPerMonth: number;
    guestPassesLeft: number;
    guestPassesPerMonth: number;
  };
  inToday: boolean;
  periods: MemberPeriod[];
  timeline: MemberTimelineEvent[];
  visits: MemberVisit[];
  canManage: boolean;
  canManageMoney: boolean;
  version: number;
  createdAt: string | null;
}

export type ManagePlanAction = "create" | "update" | "publish" | "pause" | "archive";

export type ManageMemberAction =
  | { action: "pause"; when: "now" | "period_end"; reason?: string }
  | { action: "resume" }
  | { action: "cancel"; when: "now" | "period_end"; reason: string }
  | { action: "undo_cancel" }
  | { action: "send_link" }
  | { action: "approve_request" }
  | { action: "decline_request"; reason?: string }
  | { action: "assign_desk"; spaceId: string }
  | { action: "unassign_desk" }
  | { action: "mark_paid"; method: "cash" | "transfer" | "card_at_venue" | "other"; note?: string; periodId?: string };
