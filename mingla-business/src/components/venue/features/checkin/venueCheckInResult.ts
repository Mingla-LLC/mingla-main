/**
 * #4490 P2-5 — the one mapper from a door result to what staff see
 * (`ci-ok`, `ci-id`, `ci-wrong`, already in, not valid…). Pure, like
 * `scanner/scanResultCopy.ts`. Server codes are A's (reconciliation conflict
 * 14): admitted→ok, id_required→needs_id, already_used→already_in, plus
 * not_yet, void, wrong_venue, not_found, wrong_day and undone. Never shows a
 * raw code.
 */

import type { CheckInPass, ScanOutcome } from "../../../../types/venueOffers";

export type CheckInTone = "success" | "warning" | "danger" | "neutral";

export type CheckInAction =
  | "undo"
  | "scan_next"
  | "id_seen"
  | "sell_walk_in"
  | "close";

export interface CheckInResultView {
  /** UI state id (B's names). */
  state: "ok" | "needs_id" | "wrong_day" | "already_in" | "not_yet" | "void" | "wrong_venue" | "not_found" | "days_used" | "day_full" | "undone";
  tone: CheckInTone;
  title: string;
  /** Who and what ("Adaobi Nwosu · Walk-in × 2"). */
  subject: string | null;
  /** A plain explanation or instruction. */
  body: string | null;
  primary: CheckInAction;
  secondary: CheckInAction | null;
}

function timeOf(iso: string | null, timezone?: string): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    // A malformed legacy venue zone must not hide the admission time.
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function subjectOf(outcome: ScanOutcome): string | null {
  if (outcome.kind === "guest_list") {
    const entry = outcome.guestListEntry ?? null;
    return entry === null
      ? null
      : `${entry.guestName} · Guest list × ${1 + entry.plusOnes}`;
  }
  if (outcome.kind === "member") {
    const m = outcome.member ?? null;
    if (m === null) return null;
    return `${m.name} · ${m.planName.length > 0 ? `${m.planName} · ` : ""}Member`;
  }
  if (outcome.kind === "event_ticket") {
    const parts = [outcome.ticketHolder, outcome.ticketName].filter((p): p is string => p !== null && p.length > 0);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  const pass = outcome.pass;
  if (pass === null) return null;
  const base = pass.offerKind === "by_the_hour"
    ? `${pass.holderName} · ${pass.offerName}`
    : `${pass.holderName} · ${pass.offerName} × ${pass.admits}`;
  const daysAllowed = pass.daysAllowed ?? 1;
  return daysAllowed > 1 ? `${base} · Day ${pass.dayNumber ?? 1} of ${daysAllowed}` : base;
}

/** #4490 P6 — a member pass or a member from the list. */
function memberResultView(outcome: ScanOutcome, subject: string | null): CheckInResultView {
  const m = outcome.member ?? null;
  const period = m?.planPeriod ?? "month";
  const due = outcome.paymentDue === true || m?.paymentDue === true;
  switch (outcome.result) {
    case "admitted": {
      const n = outcome.admitted ?? 1;
      const guests = Math.max(0, n - 1);
      return {
        state: "ok",
        tone: due ? "warning" : "success",
        title: "Member checked in",
        subject,
        body: `${guests > 0 ? `The member and ${guests === 1 ? "1 guest" : `${guests} guests`} in.` : "The member is in."}${
          due ? ` This ${period} isn't paid yet: remind them to pay from their member page.` : ""
        }`,
        primary: "scan_next",
        secondary: outcome.logId !== null ? "undo" : null,
      };
    }
    case "already_used":
      return {
        state: "already_in",
        tone: "warning",
        title: "Already in today",
        subject,
        body: "Members check in once a day. They came in earlier today.",
        primary: "scan_next",
        secondary: null,
      };
    case "not_yet":
      return {
        state: "not_yet",
        tone: "warning",
        title: "Membership starts later",
        subject,
        body: "Their membership hasn't started yet. They can buy entry today.",
        primary: "scan_next",
        secondary: "sell_walk_in",
      };
    case "void":
      return {
        state: "void",
        tone: "danger",
        title: m?.status === "lapsed" ? `Not paid this ${period}` : m?.status === "paused" ? "Membership paused" : "Membership not active",
        subject,
        body:
          m?.status === "lapsed"
            ? "Their pass won't open the door until they pay. They can pay from their member page, or buy entry today."
            : m?.status === "paused"
              ? `It starts again once they pay for a new ${period}. They can buy entry today.`
              : "This membership has ended or was never paid. They can buy entry today.",
        primary: "scan_next",
        secondary: "sell_walk_in",
      };
    case "undone":
      return {
        state: "undone",
        tone: "neutral",
        title: "Check-in undone",
        subject,
        body: "Their visit today is cleared, and any guest passes are back.",
        primary: "scan_next",
        secondary: null,
      };
    case "wrong_venue":
      return {
        state: "wrong_venue",
        tone: "danger",
        title: "For another venue",
        subject,
        body: "This member pass is for a different venue.",
        primary: "scan_next",
        secondary: null,
      };
    default:
      return {
        state: "not_found",
        tone: "danger",
        title: "Code not recognised",
        subject: null,
        body: "This isn't a member pass for this venue. Search their name instead.",
        primary: "scan_next",
        secondary: null,
      };
  }
}

export function checkInResultView(outcome: ScanOutcome, timezone?: string): CheckInResultView {
  const subject = subjectOf(outcome);
  if (outcome.kind === "guest_list") {
    if (outcome.result === "admitted") {
      const n = outcome.admitted ?? outcome.count ?? 1;
      return {
        state: "ok",
        tone: "success",
        title: "Guest list checked in",
        subject,
        body: `${n === 1 ? "1 guest" : `${n} guests`} in.`,
        primary: "scan_next",
        secondary: outcome.logId !== null ? "undo" : null,
      };
    }
    if (outcome.result === "undone") {
      return {
        state: "undone",
        tone: "neutral",
        title: "Check-in undone",
        subject,
        body: "They're back on the guest list as still to arrive.",
        primary: "scan_next",
        secondary: null,
      };
    }
    return {
      state: "not_yet",
      tone: "warning",
      title: "List price has ended",
      subject,
      body: "Sell normal Entry instead.",
      primary: "close",
      secondary: "sell_walk_in",
    };
  }
  if (outcome.kind === "member") return memberResultView(outcome, subject);
  const pass = outcome.pass;
  switch (outcome.result) {
    case "admitted": {
      const n = outcome.admitted ?? pass?.admits ?? 1;
      const left = pass !== null && pass.remaining > 0 ? ` ${pass.remaining} still to come on this pass.` : "";
      return {
        state: "ok",
        tone: "success",
        title: "Checked in",
        subject,
        body: `${n === 1 ? "1 guest" : `${n} guests`} in.${left}`,
        primary: "scan_next",
        secondary: outcome.logId !== null ? "undo" : null,
      };
    }
    case "id_required": {
      const label = pass?.idCheckLabel ?? "a valid ID";
      const idGuests = pass?.idCheckCount ?? 0;
      const party = pass?.admits ?? 0;
      if (idGuests > 0 && party > idGuests) {
        // A mixed party: only some of the guests are on the price that needs an ID.
        const rest = party - idGuests;
        return {
          state: "needs_id",
          tone: "warning",
          title: "Check ID first",
          subject,
          body: `Ask ${idGuests} of ${party} guests for ${label}. If they have no ID, ${
            idGuests === 1 ? "sell that guest a walk-in ticket" : "sell those guests walk-in tickets"
          } instead of using this price. ${rest === 1 ? "The other guest keeps" : `The other ${rest} guests keep`} their entry.`,
          primary: "id_seen",
          secondary: "sell_walk_in",
        };
      }
      return {
        state: "needs_id",
        tone: "warning",
        title: "Check ID first",
        subject,
        body: `Ask for ${label}. No ID? Don't check them in on this price: sell them a walk-in price instead.`,
        primary: "id_seen",
        secondary: "sell_walk_in",
      };
    }
    case "wrong_day": {
      const day = pass?.dayLabel ?? null;
      const multiDay = (pass?.daysAllowed ?? 1) > 1;
      return {
        state: "wrong_day",
        tone: "danger",
        title: "Not valid today",
        subject,
        body:
          day !== null
            ? multiDay
              ? day
              : `This pass is for ${day}. It stays valid for that day.`
            : "This isn't for today. It stays valid for its own day.",
        primary: "close",
        secondary: "sell_walk_in",
      };
    }
    case "already_used": {
      const at = timeOf(pass?.lastAdmittedAt ?? null, timezone);
      return {
        state: "already_in",
        tone: "warning",
        title: "Already checked in",
        subject,
        body: at !== null ? `Everyone on this pass came in at ${at}.` : "Everyone on this pass is already in.",
        primary: "scan_next",
        secondary: null,
      };
    }
    case "days_used":
      return {
        state: "days_used",
        tone: "warning",
        title: "All days used",
        subject,
        body: `All ${pass?.daysAllowed ?? 0} days used.`,
        primary: "scan_next",
        secondary: "sell_walk_in",
      };
    case "day_full":
      return {
        state: "day_full",
        tone: "warning",
        title: "Today is full",
        subject,
        body: "Today is full. This pass can be used on another valid day.",
        primary: "scan_next",
        secondary: "sell_walk_in",
      };
    case "not_yet":
      return {
        state: "not_yet",
        tone: "warning",
        title: "Too early",
        subject,
        body: (pass?.daysAllowed ?? 1) > 1
          ? pass?.dayLabel !== null && pass?.dayLabel !== undefined
            ? `${pass.dayLabel}. It hasn't started yet.`
            : "This pass hasn't started yet."
          : "This session hasn't opened yet. Ask them to come back at their start time.",
        primary: "scan_next",
        secondary: null,
      };
    case "void":
      return {
        state: "void",
        tone: "danger",
        title: "Cancelled pass",
        subject,
        body: "This booking was cancelled or refunded, so it can't be used.",
        primary: "scan_next",
        secondary: "sell_walk_in",
      };
    case "wrong_venue":
      return {
        state: "wrong_venue",
        tone: "danger",
        title: "For another venue",
        subject,
        body:
          outcome.venueName !== null
            ? `This is for ${outcome.venueName}, not this venue.`
            : "This pass is for a different venue.",
        primary: "scan_next",
        secondary: null,
      };
    case "undone":
      return {
        state: "undone",
        tone: "neutral",
        title: "Check-in undone",
        subject,
        body: "They're back on the list as still to arrive.",
        primary: "scan_next",
        secondary: null,
      };
    case "not_found":
    default:
      return {
        state: "not_found",
        tone: "danger",
        title: "Code not recognised",
        subject: null,
        body: "This isn't a Mingla pass for this venue. Check they're showing the right code, or search their name.",
        primary: "scan_next",
        secondary: null,
      };
  }
}

/** Plain words for a door refusal (edge error codes). Never a raw code. */
export function doorErrorCopy(code: string, detail: string | null = null): string {
  switch (code) {
    case "not_authorized":
    case "auth_required":
    case "auth_invalid":
      return "You can't check guests in at this venue. Ask a brand owner or admin for check-in access.";
    case "venue_not_found":
      return "This venue was removed.";
    case "admit_count_invalid":
      return detail !== null ? `Only ${detail} still to come on this pass.` : "That's more guests than are left on this pass.";
    case "check_in_not_found":
    case "check_in_not_undoable":
      return "That check-in can't be undone.";
    case "check_in_undo_too_late":
      return "It's been more than 10 minutes, so this check-in can't be undone here.";
    case "check_in_already_undone":
      return "That check-in was already undone.";
    case "event_scan_not_allowed":
      return "You can't scan tickets for that event.";
    case "qr_token_pepper_missing":
      return "Scanning isn't set up yet. Search the guest's name instead.";
    case "offer_sold_out":
      return "Sold out for today, including the places kept for walk-ins.";
    case "offer_day_closed":
      return "The venue is closed today, so nothing can be sold.";
    case "offer_wrong_weekday":
      return "That price isn't sold on this day.";
    case "offer_wrong_time":
      return "That price isn't sold at this time.";
    case "offer_window_unavailable":
      return "Today isn't on sale for this offer.";
    case "offer_option_unavailable":
    case "offer_not_found":
      return "That offer isn't on sale any more. Close this and try again.";
    case "offer_guests_out_of_range":
      return "That's more guests than one sale allows. Split it into two sales.";
    case "offer_guest_email_required":
      return "Add the guest's email to send them the pay link.";
    case "offer_guest_invalid":
      return "Check the guest's name, email and phone.";
    case "offer_amount_too_large":
      return "This payment is too large to take in one go. Ask for a smaller deposit, or record it as paid to the venue.";
    case "offers_not_enabled":
      return "Selling at the gate isn't switched on for your brand yet.";
    case "rate_limited":
      return "Too many tries in a row. Wait a moment, then try again.";
    case "member_code_rate_limited":
      return "Too many wrong codes. Scan the pass or try again in 10 minutes.";
    case "network":
      return "You're offline or the connection dropped. Try again.";
    // #4490 P6 — members.
    case "member_guest_passes_used_up":
      return detail !== null && Number(detail) > 0
        ? `Only ${detail} guest ${Number(detail) === 1 ? "pass is" : "passes are"} left in this billing period.`
        : "No guest passes left in this billing period. The guests can buy entry instead.";
    case "member_guests_day_full":
      return detail !== null && Number(detail) > 0
        ? `Only ${detail} more ${Number(detail) === 1 ? "guest fits" : "guests fit"} today. The member can still go in.`
        : "Today is full, so guests can't come in on passes. The member can still go in alone.";
    case "membership_not_found":
      return "That member couldn't be found. Refresh the list.";
    default:
      return "That didn't go through. Try again.";
  }
}

/** A typed or pasted code: a full pass QR, a booking code, or a name. */
export function matchTypedCode(raw: string, passes: readonly CheckInPass[]): { kind: "qr"; payload: string } | { kind: "pass"; pass: CheckInPass } | { kind: "many"; count: number } | { kind: "none" } {
  const text = raw.trim();
  if (text.length === 0) return { kind: "none" };
  if (/^mingla:v\d+:/i.test(text)) return { kind: "qr", payload: text };
  const needle = text.toLowerCase().replace(/\s+/g, " ");
  const byRef = passes.filter((p) => p.reference !== null && p.reference.toLowerCase() === needle);
  if (byRef.length === 1) return { kind: "pass", pass: byRef[0] };
  const byPrefix = passes.filter(
    (p) => (p.reference ?? "").toLowerCase().startsWith(needle) || p.holderName.toLowerCase().includes(needle),
  );
  if (byPrefix.length === 1) return { kind: "pass", pass: byPrefix[0] };
  if (byPrefix.length > 1) return { kind: "many", count: byPrefix.length };
  // Anything else goes to the server as a code (it answers "not recognised").
  return { kind: "qr", payload: text };
}


// #4490 P3 — groups and money owed at the door.
/** The pass id inside a scanned pass code (`mingla:v1:vpass:<id>:sig:…`). */
export function passIdFromCode(payload: string): string | null {
  const m = /^mingla:v\d+:vpass:([0-9a-f-]{36}):/i.exec(payload.trim());
  return m === null ? null : m[1].toLowerCase();
}

/** #4490 P6 — the member id inside a member pass code (`mingla:v1:vmember:<id>:sig:…`). */
export function memberIdFromCode(payload: string): string | null {
  const m = /^mingla:v\d+:vmember:([0-9a-f-]{36}):/i.exec(payload.trim());
  return m === null ? null : m[1].toLowerCase();
}

/** A group pass, or anything that still owes money, gets the step before going in. */
export function needsGroupStep(pass: CheckInPass): boolean {
  if (pass.status !== "valid") return false;
  if ((pass.balanceDueMinor ?? 0) > 0) return true;
  return pass.offerKind === "group_package" && pass.admits - pass.admittedCount > 1;
}
