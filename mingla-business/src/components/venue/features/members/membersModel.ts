/**
 * #4490 P6-2 — memberships on the Host, pure: the plan draft and its checks,
 * the words for member states, list filters, the billing timeline, and every
 * server refusal in plain words. No React, no network (unit-tested).
 *
 * Monthly and yearly plans. Money in minor units.
 */
import type {
  MemberDiscountKind,
  MemberStatus,
  MemberTimelineEvent,
  MembershipPlan,
  MembershipJoinMode,
  MembershipPlanPeriod,
  VenueMemberDetail,
  VenueMemberRow,
} from "../../../../types/venueMembers";
import { money } from "../offers/offersModel";

// ---------------------------------------------------------------- dates

/** "Tue 1 Dec" (or "Tue 1 Dec 2027") in the venue's time zone. */
export function memberDay(
  iso: string | null | undefined,
  timeZone = "Africa/Lagos",
  includeYear = false,
): string | null {
  if (iso === null || iso === undefined || iso.length === 0) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" as const } : {}),
      timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : timeZone,
    })
      .format(d)
      .replace(",", "");
  } catch {
    return d.toDateString();
  }
}

/** "Mar 2026" (member since). */
export function memberMonth(iso: string | null | undefined, timeZone = "Africa/Lagos"): string | null {
  if (iso === null || iso === undefined) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone }).format(d);
  } catch {
    return null;
  }
}

/** "4 hours", "1 hour", "1.5 hours", "No room hours". */
export function hoursWords(hours: number): string {
  if (!(hours > 0)) return "0 hours";
  const n = Math.round(hours * 4) / 4;
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} ${n === 1 ? "hour" : "hours"}`;
}

// ---------------------------------------------------------------- statuses

export interface StatusWords {
  label: string;
  variant: "ok" | "warn" | "error" | "muted" | "info" | "draft";
}

/** Host words for a member's state (the contract's member row + Host detail). */
export function memberStatusWords(status: MemberStatus, leavingOn: string | null = null): StatusWords {
  switch (status) {
    case "active":
      return leavingOn !== null ? { label: "Leaving", variant: "info" } : { label: "Active", variant: "ok" };
    case "payment_due":
      return { label: "Payment due", variant: "warn" };
    case "grace":
      return { label: "In grace", variant: "warn" };
    case "lapsed":
      return { label: "Lapsed", variant: "error" };
    case "paused":
      return { label: "Paused", variant: "muted" };
    case "requested":
      return { label: "Requested", variant: "info" };
    case "declined":
      return { label: "Declined", variant: "muted" };
    case "pending":
      return { label: "Joining", variant: "draft" };
    case "cancelled":
      return { label: "Ended", variant: "muted" };
    default: {
      const never: never = status;
      return { label: String(never), variant: "muted" };
    }
  }
}

/** Request rows are decisions, not memberships with billing/end controls. */
export function memberRequestState(status: MemberStatus): boolean {
  return status === "requested" || status === "declined";
}

export function memberCanEnd(
  status: MemberStatus,
  canManage: boolean,
  leaving: VenueMemberDetail["leaving"],
): boolean {
  return canManage && status !== "cancelled" && !memberRequestState(status) && leaving === null;
}

export function memberCanAssignDesk(status: MemberStatus): boolean {
  return status === "active" || status === "payment_due" || status === "grace";
}

export type MemberFilter = "all" | "requests" | "active" | "payment_due" | "grace" | "lapsed" | "paused" | "leaving" | "joining" | "ended";

export const MEMBER_FILTERS: readonly { key: MemberFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "requests", label: "Requests" },
  { key: "active", label: "Active" },
  { key: "payment_due", label: "Payment due" },
  { key: "grace", label: "In grace" },
  { key: "lapsed", label: "Lapsed" },
  { key: "paused", label: "Paused" },
  { key: "leaving", label: "Leaving" },
  { key: "joining", label: "Joining" },
  { key: "ended", label: "Ended" },
];

/** Does a row belong under a chip? (`ended` is its own server read.) */
export function memberMatches(row: VenueMemberRow, filter: MemberFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "requests":
      return row.status === "requested";
    case "active":
      return row.status === "active" && row.leavingOn === null;
    case "payment_due":
      return row.status === "payment_due";
    case "grace":
      return row.status === "grace";
    case "lapsed":
      return row.status === "lapsed";
    case "paused":
      return row.status === "paused" || row.pausingOn !== null;
    case "leaving":
      return row.leavingOn !== null && row.status !== "cancelled";
    case "joining":
      return row.status === "pending" || row.status === "requested";
    case "ended":
      return row.status === "cancelled" || row.status === "declined";
    default: {
      const never: never = filter;
      return never;
    }
  }
}

/** The list's one line under a member's plan ("Renews Tue 1 Dec", "Leaving Fri 25 Dec"…). */
export function memberRowLine(row: VenueMemberRow, timeZone: string): string {
  const day = (iso: string | null): string => memberDay(iso, timeZone, row.planPeriod === "year") ?? "—";
  if (row.status === "cancelled") return "Membership ended";
  if (row.status === "declined") return "Request declined";
  if (row.status === "requested") return "Waiting for the venue to reply";
  if (row.status === "pending") return `First ${row.planPeriod} not paid yet`;
  if (row.leavingOn !== null) return `Leaving ${day(row.leavingOn)}`;
  if (row.status === "paused") return "Paused until they pay to start again";
  if (row.pausingOn !== null) return `Pausing ${day(row.pausingOn)}`;
  if (row.status === "lapsed") return "Not paid: can't check in";
  if (row.status === "payment_due" || row.status === "grace") {
    return row.amountDueMinor !== null ? "Can still check in until the grace ends" : "Payment due";
  }
  return row.renewsOn !== null ? `Renews ${day(row.renewsOn)}` : `Paid until ${day(row.activeUntil)}`;
}

/** "3 of 4 room hours" for the list. */
export function roomHoursLine(left: number, perMonth: number | null): string {
  if (perMonth !== null && perMonth <= 0) return "No room hours";
  const n = (h: number): string => hoursWords(h).replace(/ hours?$/, "");
  return perMonth !== null ? `${n(left)} of ${n(perMonth)} room hours` : `${hoursWords(left)} of room time left`;
}

// ---------------------------------------------------------------- timeline

const EVENT_WORDS: Readonly<Record<string, string>> = {
  member_joined: "Joined",
  member_paid: "Paid",
  member_renewal_sent: "Payment email sent",
  member_payment_due: "Payment due",
  member_reminder_sent: "Reminder sent",
  member_lapsed: "Lapsed: not paid",
  member_link_sent: "Payment link sent again",
  member_leaving: "Asked to leave",
  member_stays: "Decided to stay",
  member_paused: "Pause set",
  member_pause_started: "Paused",
  member_resumed: "Resumed",
  member_ended: "Membership ended",
  member_paid_twice: "Paid twice: refund by hand",
};

export function timelineWords(e: MemberTimelineEvent, period: MembershipPlanPeriod = "month"): string {
  const base = e.type === "member_join_closed" ? `Join closed: first ${period} never paid` : EVENT_WORDS[e.type] ?? "Updated";
  const by = e.by === "staff" ? " by the venue" : e.by === "member" && (e.type === "member_leaving" || e.type === "member_paused") ? " by the member" : "";
  return `${base}${by}`;
}

export interface BillingStep {
  key: string;
  title: string;
  meta: string;
  state: "done" | "current" | "pending";
}

/**
 * The billing timeline the host reads for a member (design `mb-member`):
 * what happened this billing period and what happens next. Plain words only.
 */
export function billingSteps(m: VenueMemberDetail, now: number = Date.now()): BillingStep[] {
  const tz = m.venue.timezone;
  const period = m.plan.period;
  const day = (iso: string | null | undefined): string => memberDay(iso ?? null, tz, period === "year") ?? "—";
  const out: BillingStep[] = [];
  const due = m.paymentDue;
  if (m.status === "cancelled") {
    out.push({ key: "ended", title: "Membership ended", meta: day(m.endedAt), state: "done" });
    return out;
  }
  if (m.status === "pending" && due !== null) {
    out.push({ key: "joined", title: "Joined", meta: day(m.createdAt), state: "done" });
    out.push({ key: "first", title: `First ${period} to pay`, meta: money(due.amountMinor, due.currencyCode), state: "current" });
    out.push(
      m.plan.joinMode === "request"
        ? {
            key: "closes",
            title: "3 days to pay after approval",
            meta: `Closes if still unpaid after ${day(due.dueAt)}`,
            state: "pending",
          }
        : { key: "closes", title: "Closes if never paid", meta: "2 days after joining", state: "pending" },
    );
    return out;
  }
  if (due !== null) {
    const sent = m.timeline.filter((e) => e.periodId === due.periodId && (e.type === "member_renewal_sent" || e.type === "member_link_sent"));
    const reminder = m.timeline.find((e) => e.periodId === due.periodId && e.type === "member_reminder_sent");
    if (sent.length > 0) out.push({ key: "sent", title: "Payment email sent", meta: day(sent[0]?.at), state: "done" });
    const dueAt = due.dueAt !== null ? Date.parse(due.dueAt) : NaN;
    if (reminder !== undefined) out.push({ key: "reminder", title: "Reminder sent", meta: day(reminder.at), state: "done" });
    if (m.status === "lapsed") {
      out.push({ key: "lapsed", title: "Lapsed: can't check in", meta: `Since ${day(due.graceEndsAt)}`, state: "current" });
      out.push({ key: "restart", title: "Starts again when paid", meta: money(due.amountMinor, due.currencyCode), state: "pending" });
      return out;
    }
    if (m.status === "paused") {
      out.push({ key: "restart", title: "Paused: starts again when paid", meta: money(due.amountMinor, due.currencyCode), state: "current" });
      return out;
    }
    if (!Number.isNaN(dueAt) && dueAt <= now) {
      out.push({ key: "due", title: "Can still check in", meta: `Until ${day(due.graceEndsAt)}, then it lapses`, state: "current" });
      out.push({ key: "lapse", title: "Lapses if still unpaid", meta: day(due.graceEndsAt), state: "pending" });
    } else {
      out.push({ key: "due", title: due.paying ? "Paying now" : "Payment due", meta: day(due.dueAt), state: "current" });
      out.push({ key: "grace", title: "Grace ends", meta: day(due.graceEndsAt), state: "pending" });
    }
    return out;
  }
  // Paid up.
  out.push({ key: "paid", title: "Paid", meta: `Until ${day(m.activeUntil)}`, state: "done" });
  if (m.leaving !== null) {
    out.push({ key: "leaving", title: "Leaving", meta: `Ends ${day(m.leaving.endsAt)}`, state: "pending" });
  } else if (m.pausing !== null) {
    out.push({ key: "pausing", title: "Pauses", meta: day(m.pausing.from), state: "pending" });
  } else if (m.paused !== null) {
    out.push({ key: "paused", title: "Paused", meta: m.paused.since !== null ? `Since ${day(m.paused.since)}` : "Until they pay", state: "current" });
  } else {
    if (m.renewalEmailOn !== null) out.push({ key: "email", title: "Payment email goes out", meta: day(m.renewalEmailOn), state: "pending" });
    if (m.renewsOn !== null) out.push({ key: "renews", title: "Renews", meta: day(m.renewsOn), state: "pending" });
  }
  return out;
}

/** "Paid online · Tue 1 Dec", "Paid at the venue (cash)", "Payment email sent". */
export function periodWords(
  p: VenueMemberDetail["periods"][number],
  timeZone: string,
  includeYear = false,
): string {
  const day = (iso: string | null): string => memberDay(iso, timeZone, includeYear) ?? "";
  switch (p.status) {
    case "paid":
      return p.paidVia === "venue"
        ? `Paid at the venue${p.paidMethod !== null ? ` (${PAY_METHOD_WORDS[p.paidMethod] ?? p.paidMethod})` : ""} · ${day(p.paidAt)}`
        : `Paid online · ${day(p.paidAt)}`;
    case "link_sent":
      return "Payment email sent";
    case "overdue":
      return "Not paid";
    case "scheduled":
      return "Not due yet";
    case "void":
      return "Not charged";
    default: {
      const never: never = p.status;
      return String(never);
    }
  }
}

export const PAY_METHOD_WORDS: Readonly<Record<string, string>> = {
  cash: "cash",
  transfer: "bank transfer",
  card_at_venue: "card at the venue",
  other: "other",
};

// ---------------------------------------------------------------- plans

export const DISCOUNT_KIND_LABEL: Readonly<Record<MemberDiscountKind, string>> = {
  entry: "Entry",
  group_package: "Group packages",
  private_hire: "Private hire",
  by_the_hour: "By the hour",
};

export const PLAN_STATUS: Readonly<Record<MembershipPlan["status"], StatusWords>> = {
  live: { label: "On sale", variant: "ok" },
  draft: { label: "Draft", variant: "draft" },
  paused: { label: "Not taking new members", variant: "warn" },
  archived: { label: "Archived", variant: "muted" },
};

export function planStatusWords(plan: MembershipPlan): StatusWords {
  if (plan.status === "live" && plan.full) return { label: "Full", variant: "warn" };
  return PLAN_STATUS[plan.status];
}

export interface PlanDraft {
  name: string;
  summary: string;
  priceMinor: number | null;
  period: MembershipPlanPeriod;
  joinMode: MembershipJoinMode;
  deskSpaceIds: string[];
  entryIncluded: boolean;
  entryOfferingId: string | null;
  guestPasses: number;
  roomHours: number;
  /** Empty = every by-the-hour offer. */
  hourOfferingIds: string[];
  discountPercent: number;
  discountKinds: MemberDiscountKind[];
  inclusions: string[];
  limitMembers: boolean;
  maxMembers: number;
  minMonths: number;
  noticeDays: number;
  graceDays: number;
  renewalNoticeDays: number;
}

export function planDraftFrom(plan: MembershipPlan | null, defaults?: { entryOfferingId?: string | null }): PlanDraft {
  return {
    name: plan?.name ?? "",
    summary: plan?.summary ?? "",
    priceMinor: plan?.priceMinor ?? null,
    period: plan?.period ?? "month",
    joinMode: plan?.joinMode ?? "instant",
    deskSpaceIds: plan?.deskSpaceIds ?? [],
    entryIncluded: plan?.entryIncluded ?? (defaults?.entryOfferingId ?? null) !== null,
    entryOfferingId: plan?.entryOfferingId ?? defaults?.entryOfferingId ?? null,
    guestPasses: plan?.guestPasses ?? 0,
    roomHours: plan?.roomHours ?? 0,
    hourOfferingIds: plan?.hourOfferingIds ?? [],
    discountPercent: Math.round((plan?.discountBps ?? 0) / 100),
    discountKinds: plan?.discountKinds ?? [],
    inclusions: plan?.inclusions ?? [],
    limitMembers: (plan?.maxMembers ?? null) !== null,
    maxMembers: plan?.maxMembers ?? 20,
    minMonths: plan?.period === "year" ? 12 : plan?.minMonths ?? 1,
    noticeDays: plan?.noticeDays ?? 0,
    graceDays: plan?.graceDays ?? 7,
    renewalNoticeDays: plan?.renewalNoticeDays ?? (plan?.period === "year" ? 30 : 7),
  };
}

/** Apply the host's billing choice and its non-editable period defaults. */
export function planPeriodDraft(d: PlanDraft, period: MembershipPlanPeriod): PlanDraft {
  if (period === "year") return { ...d, period, minMonths: 12, renewalNoticeDays: 30 };
  return { ...d, period, minMonths: 1, renewalNoticeDays: 7 };
}

/** The server payload (`issue_4490_manage_membership_plan`), never more than it accepts. */
export function planPayload(d: PlanDraft, planId: string | null): Record<string, unknown> {
  return {
    ...(planId !== null ? { planId } : {}),
    name: d.name.trim(),
    summary: d.summary.trim().length > 0 ? d.summary.trim() : null,
    inclusions: d.inclusions.map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 6),
    priceMinor: d.priceMinor,
    period: d.period,
    joinMode: d.joinMode,
    deskSpaceIds: d.deskSpaceIds,
    entryIncluded: d.entryIncluded && d.entryOfferingId !== null,
    entryOfferingId: d.entryIncluded ? d.entryOfferingId : null,
    roomHours: d.roomHours,
    hourOfferingIds: d.roomHours > 0 ? d.hourOfferingIds : [],
    guestPasses: d.entryIncluded ? d.guestPasses : 0,
    discountBps: d.discountPercent * 100,
    discountKinds: d.discountPercent > 0 ? d.discountKinds : [],
    maxMembers: d.limitMembers ? d.maxMembers : null,
    minMonths: d.period === "year" ? 12 : d.minMonths,
    noticeDays: d.noticeDays,
    graceDays: d.graceDays,
    renewalNoticeDays: d.renewalNoticeDays,
  };
}

export interface PlanIssues {
  name: string | null;
  price: string | null;
  entry: string | null;
  discount: string | null;
  inclusions: string | null;
  desks: string | null;
}

export function planIssues(d: PlanDraft, currency = "NGN"): PlanIssues {
  const lines = d.inclusions.map((l) => l.trim()).filter((l) => l.length > 0);
  return {
    name: d.name.trim().length === 0 ? "Name this plan" : d.name.trim().length > 80 ? "Keep the name under 80 characters" : null,
    price:
      d.priceMinor === null || d.priceMinor <= 0
        ? `Set the ${d.period === "year" ? "yearly" : "monthly"} price`
        : d.priceMinor > 2_147_483_647
          ? d.period === "year"
            ? `A yearly price can't be above ${money(2_147_483_647, currency)}`
            : "This price is too large to take in one payment"
          : null,
    entry: d.entryIncluded && d.entryOfferingId === null ? "Pick the Entry offer members get in on" : null,
    discount: d.discountPercent > 0 && d.discountKinds.length === 0 ? "Pick what the member price applies to" : null,
    inclusions: lines.length > 6 ? "Up to 6 lines" : lines.some((l) => l.length > 80) ? "Keep each line under 80 characters" : null,
    desks: d.deskSpaceIds.length > 500 ? "Pick no more than 500 assignable desks" : null,
  };
}

export function planIssueList(i: PlanIssues): string[] {
  return [i.name, i.price, i.entry, i.discount, i.inclusions, i.desks].filter((x): x is string => x !== null);
}

/**
 * What a member gets, as lines (the editor's preview and the Plans table):
 * entry, room hours, guest passes, the member price, then the host's own lines.
 */
export function planIncludesLines(
  p: Pick<PlanDraft, "entryIncluded" | "guestPasses" | "roomHours" | "discountPercent" | "discountKinds" | "inclusions" | "period">,
  names: { entryOffer?: string | null; hourOffers?: string[] } = {},
): string[] {
  const out: string[] = [];
  if (p.entryIncluded) out.push(names.entryOffer ? `Free entry (${names.entryOffer})` : "Free entry");
  if (p.roomHours > 0) {
    const rooms = names.hourOffers !== undefined && names.hourOffers.length > 0 ? names.hourOffers.join(", ") : "rooms";
    out.push(`${hoursWords(p.roomHours)} of ${rooms} a ${p.period}`);
  }
  if (p.entryIncluded && p.guestPasses > 0) out.push(`${p.guestPasses} guest ${p.guestPasses === 1 ? "pass" : "passes"} a ${p.period}`);
  if (p.discountPercent > 0 && p.discountKinds.length > 0) {
    out.push(`${p.discountPercent}% off ${p.discountKinds.map((k) => DISCOUNT_KIND_LABEL[k].toLowerCase()).join(", ")}`);
  }
  for (const l of p.inclusions) if (l.trim().length > 0) out.push(l.trim());
  return out;
}

/** "3-month minimum · 30 days' notice · 7 days' grace". */
export function planTermsLine(d: Pick<PlanDraft, "period" | "minMonths" | "noticeDays" | "graceDays">): string {
  const parts: string[] = [];
  parts.push(d.period === "year" ? "1-year minimum" : d.minMonths > 1 ? `${d.minMonths}-month minimum` : "Leave any month");
  if (d.noticeDays > 0) parts.push(`${d.noticeDays} days' notice`);
  parts.push(d.graceDays > 0 ? `${d.graceDays} days' grace` : "No grace");
  return parts.join(" · ");
}

export function planJoinLine(plan: Pick<PlanDraft, "joinMode" | "deskSpaceIds">): string {
  const parts = [plan.joinMode === "request" ? "By request" : "Join and pay"];
  if (plan.deskSpaceIds.length > 0) parts.push("Assigned desk available");
  return parts.join(" · ");
}

export const MIN_MONTH_OPTIONS = [1, 2, 3, 6, 12].map((n) => ({ value: n, label: n === 1 ? "None" : `${n} months` }));
export const NOTICE_OPTIONS = [0, 7, 14, 30, 60].map((n) => ({ value: n, label: n === 0 ? "None" : `${n} days` }));
export const GRACE_OPTIONS = [0, 3, 5, 7, 10, 14].map((n) => ({ value: n, label: n === 0 ? "None" : `${n} days` }));
export const RENEWAL_NOTICE_OPTIONS = [3, 5, 7, 10, 14].map((n) => ({ value: n, label: `${n} days before` }));
export const YEARLY_RENEWAL_NOTICE_OPTIONS = [7, 14, 21, 30, 45, 60].map((n) => ({ value: n, label: `${n} days before` }));
export const DISCOUNT_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 50].map((n) => ({ value: n, label: n === 0 ? "No member price" : `${n}% off` }));

// ---------------------------------------------------------------- refusals

const PLAN_ERRORS: Readonly<Record<string, string>> = {
  plan_name_required: "Name this plan.",
  plan_summary_invalid: "Keep the short description under 300 characters.",
  plan_inclusions_invalid: "Up to 6 lines of what's included, each under 80 characters.",
  plan_price_invalid: "Set a price above zero and no more than ₦21,474,836.47.",
  plan_period_invalid: "Choose Monthly or Yearly billing.",
  plan_period_locked: "You can't change how a plan is billed once people have joined.",
  plan_entry_invalid: "Pick an Entry offer of this venue for free entry.",
  plan_room_hours_invalid: "Room hours must be 0 to 744 a month, or 0 to 8,784 a year.",
  plan_room_offers_invalid: "Pick By the hour offers of this venue for the included hours.",
  plan_guest_passes_invalid: "Guest passes must be 0 to 100 a month, or 0 to 1,200 a year.",
  plan_discount_invalid: "The member price must be 0% to 100% off, on the kinds you pick.",
  plan_max_members_invalid: "The member limit must be between 1 and 100,000.",
  plan_join_mode_invalid: "Choose whether guests join and pay or ask first.",
  plan_desks_invalid: "Pick only spaces at this venue as assignable desks.",
  plan_desks_in_use: "Unassign this desk from its current member before removing it from the plan.",
  plan_terms_invalid: "Check the minimum term, notice, grace and payment-email days.",
  plan_not_found: "This plan no longer exists. Reload Plans.",
  plan_archived: "This plan is archived and can't be changed.",
  plan_has_members: "This plan still has members, so it can't be archived. Stop new members instead.",
  stale_write: "Someone else saved this first. Reload, then make your change again.",
  "offer_not_ready:feature_off": "Memberships is off for this venue. Turn it on, then publish.",
  offers_not_enabled: "Selling isn't switched on for your brand yet.",
  not_authorized: "You don't have permission to change plans at this venue.",
  offer_idempotency_conflict: "That was already sent. Reload Plans to see it.",
  network: "You're offline. Check your connection and try again.",
};

const MEMBER_ERRORS: Readonly<Record<string, string>> = {
  invalid_action: "That can't be done to this member.",
  invalid_payload: "Something in that change wasn't right. Try again.",
  member_cancel_reason_required: "Say why you're ending this membership (at least 3 characters).",
  membership_ended: "This membership has already ended.",
  membership_already_leaving: "This member is already leaving.",
  membership_not_leaving: "This member isn't leaving.",
  membership_cannot_pause: "This membership can't be paused now.",
  membership_not_paused: "This membership isn't paused.",
  membership_nothing_to_pay: "Nothing is owed on this membership right now.",
  member_link_too_soon: "The payment link was sent less than 10 minutes ago. Try again shortly.",
  member_request_not_open: "This request has already been decided.",
  member_request_plan_full: "This plan is full now, so the request can't be approved.",
  member_desk_not_allowed: "Pick a desk offered by this member's plan.",
  member_desk_not_assignable: "A desk can only be assigned to a current or joining member.",
  desk_taken: "That desk is already booked. Pick another desk.",
  offer_payment_already_pending: "The member is paying online right now. Wait a few minutes, then check again.",
  membership_not_found: "This member couldn't be found. Reload the list.",
  member_guest_passes_used_up: "No guest passes left this month. The guests can buy entry instead.",
  member_guests_day_full: "Today is full, so guests can't come in on passes. The member can still go in.",
  stale_write: "Someone else changed this member first. It has been reloaded; try again.",
  not_authorized: "You don't have permission to do that for members.",
  network: "You're offline. Check your connection and try again.",
};

export function planErrorCopy(code: string, detail: string | null = null): string {
  const key = detail !== null && PLAN_ERRORS[`${code}:${detail}`] !== undefined ? `${code}:${detail}` : code;
  return PLAN_ERRORS[key] ?? (code === "offer_not_ready" ? "This plan isn't ready to go on sale yet." : "That didn't save. Try again.");
}

export function memberErrorCopy(code: string, detail: string | null = null, period: MembershipPlanPeriod = "month"): string {
  const base = MEMBER_ERRORS[code];
  if (base === undefined) return "That didn't go through. Try again.";
  if (code === "member_guest_passes_used_up") {
    return detail !== null && Number(detail) > 0
      ? `Only ${detail} guest ${Number(detail) === 1 ? "pass is" : "passes are"} left this ${period}.`
      : `No guest passes left this ${period}. The guests can buy entry instead.`;
  }
  if (code === "member_guests_day_full" && detail !== null && Number(detail) > 0) {
    return `Only ${detail} more ${Number(detail) === 1 ? "guest fits" : "guests fit"} today.`;
  }
  return base;
}

/** #4490 fix 2 (N83): what a venue's by-the-hour places are called, by its type. */
export function hourPlacesTitle(venueCategory: string | null | undefined): string {
  switch (venueCategory) {
    case "coworking":
      return "Meeting rooms";
    case "creative_and_arts":
      return "Studios and rooms";
    case "play":
      return "Lanes, tables and rooms";
    default:
      return "Rooms by the hour";
  }
}
