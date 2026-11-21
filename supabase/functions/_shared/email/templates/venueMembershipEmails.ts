import { venueAppLinkDisplay } from "./venueBookingEmails.ts";
// ===========================================================================
// #4490 P6 — the member's messages:
//   venue_membership_renewal (steps: renewal 7 days before, due on renewal
//     day, reminder 3 days after, restart after a pause, resend-* when the
//     venue sends the link again) · venue_membership_lapsed ·
//   venue_membership_paid (first period / renewal receipt) ·
//   venue_membership_ended (leaving / ended)
// ---------------------------------------------------------------------------
// The outbox row carries words and ids (venue and plan names, the member's
// name, dates, amounts). The private member link (`/visit/plan/<id>#t=…`)
// is built by notify-outbox-drain when the email is sent and travels in the
// dispatch body only, as the email's one button.
//
// COPY APPROVED BY SETH — 21 Nov 2026. Period-aware wording says that no
// membership renews or is charged by itself. Rules kept: plain words, the
// numbers, one button, no raw codes, no payment-provider names.
// ===========================================================================
import { venueEmailDate, venueEmailMoney } from "./venueBookingEmails.ts";

export const VENUE_MEMBERSHIP_CATEGORIES = new Set([
  "venue_membership_renewal",
  "venue_membership_lapsed",
  "venue_membership_paid",
  "venue_membership_ended",
]);

export const isVenueMembershipCategory = (key: string): boolean =>
  VENUE_MEMBERSHIP_CATEGORIES.has(key);

type Json = Record<string, unknown>;
const text = (v: unknown): string =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : "";
const minor = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^-?\d{1,16}$/.test(v)) return Number(v);
  return null;
};
const memberCode = (v: unknown): string => {
  const code = text(v).toUpperCase();
  return /^[2-9A-HJ-NP-Z]{6}$/.test(code)
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : "";
};

export interface VenueMembershipMessage {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

/** The button under each member email (label + the line under it). */
export const VENUE_MEMBERSHIP_CTA: Record<
  string,
  { label: string; note: string }
> = {
  venue_membership_renewal: {
    label: "Pay now",
    note:
      "This link is just for you: it opens your member page, where you pay or leave. Please don't forward this email.",
  },
  venue_membership_lapsed: {
    label: "Pay to start again",
    note:
      "This link is just for you: it opens your member page. Please don't forward this email.",
  },
  venue_membership_paid: {
    label: "See your member pass",
    note:
      "Your member pass is on your member page. This link is just for you, so please don't forward this email.",
  },
  venue_membership_ended: {
    label: "See your membership",
    note: "This link is just for you: it opens your member page.",
  },
};

/** The money lines: "Hot desk · 1 Dec: ₦85,000 / VAT: ₦6,375 / Total: ₦91,375". */
function moneyLines(payload: Json): { total: string; lines: string } {
  const currency = text(payload.currency) || "NGN";
  const base = minor(payload.amount_cents);
  const vat = minor(payload.vat_cents) ?? 0;
  const total = minor(payload.total_cents) ?? (base ?? 0) + vat;
  if (base === null) return { total: "", lines: "" };
  const plan = text(payload.plan_name) || "Membership";
  const from = venueEmailDate(text(payload.period_start_date));
  const lines = [
    `${plan}${from ? ` from ${from}` : ""}: ${venueEmailMoney(base, currency)}`,
    ...(vat > 0 ? [`VAT: ${venueEmailMoney(vat, currency)}`] : []),
    `Total: ${venueEmailMoney(total, currency)}`,
  ].join("\n");
  return { total: venueEmailMoney(total, currency), lines };
}

export function renderVenueMembershipMessage(
  categoryKey: string,
  payload: Json,
): VenueMembershipMessage {
  const venue = text(payload.venue_name) || "the venue";
  const plan = text(payload.plan_name) || "membership";
  const name = text(payload.member_name);
  const hi = name ? `Hi ${name.split(/\s+/)[0]},\n\n` : "";
  const step = text(payload.step);
  const period = text(payload.period) === "year" ? "year" : "month";
  const thisPeriod = `this ${period}`;
  const renewsOn = venueEmailDate(text(payload.period_start_date));
  const graceEnds = venueEmailDate(text(payload.grace_ends_on));
  const paidThrough = venueEmailDate(text(payload.paid_through));
  const endsOn = venueEmailDate(text(payload.ends_on));
  const { total, lines } = moneyLines(payload);
  const money = lines ? `\n\n${lines}` : "";
  const code = memberCode(payload.member_code);
  const codeLine = code ? `\n\nCan’t scan? Your code: ${code}` : "";

  if (categoryKey === "venue_membership_lapsed") {
    const body =
      `${hi}We haven't received ${thisPeriod}'s payment for your ${plan} membership at ${venue}, so it is paused: your pass won't open the door and included hours can't be used.${money}\n\nPay${
        total ? ` ${total}` : ""
      } from your member page and it starts again at once.`;
    return {
      push: {
        title: `Your ${plan} is paused`,
        body: `Pay${total ? ` ${total}` : ""} to start again at ${venue}.`,
      },
      email: { subject: `Your ${plan} at ${venue} is paused`, body },
      sms: `${venue}: your ${plan} is paused until ${thisPeriod} is paid.`,
    };
  }

  if (categoryKey === "venue_membership_paid") {
    if (step === "first") {
      const body =
        `${hi}Welcome to ${plan} at ${venue}. Your first ${period} is paid${
          total ? ` (${total})` : ""
        }${
          paidThrough ? ` and your membership runs until ${paidThrough}` : ""
        }.\n\nYour member pass is on your member page: show its code at the front desk.${codeLine}\n\nBefore each new ${period} we'll email you a link to pay for it. Nothing renews by itself, and you can leave any time from your member page.`;
      return {
        push: {
          title: `Welcome to ${plan}`,
          body: `Your member pass for ${venue} is ready.`,
        },
        email: { subject: `Welcome to ${plan} at ${venue}`, body },
        sms: venueAppLinkDisplay(payload)
          ? `Mingla: welcome to ${plan} at ${venue}. Your pass is in the Mingla app: ${
            venueAppLinkDisplay(payload)
          }`
          : `${venue}: welcome to ${plan}. Your member pass is ready.`,
      };
    }
    const body = `${hi}Thanks, we received${
      total ? ` ${total}` : " your payment"
    } for your ${plan} membership at ${venue}.${
      paidThrough ? ` You're a member until ${paidThrough}.` : ""
    }${codeLine}`;
    return {
      push: {
        title: `Your ${plan} is paid`,
        body: paidThrough ? `Member until ${paidThrough}.` : `Thank you.`,
      },
      email: {
        subject: `Your ${plan} is paid${
          paidThrough ? ` until ${paidThrough}` : ""
        }`,
        body,
      },
      sms: `${venue}: your ${plan} is paid. Thank you.`,
    };
  }

  if (categoryKey === "venue_membership_ended") {
    if (step === "declined") {
      const body =
        `${hi}${venue} can't take you on ${plan} right now. No payment was taken.`;
      return {
        push: {
          title: `Your ${plan} request`,
          body: `${venue} can't take you on this plan right now.`,
        },
        email: { subject: `Your ${plan} request at ${venue}`, body },
        sms:
          `${venue}: we can't take you on ${plan} right now. No payment was taken.`,
      };
    }
    if (step === "leaving") {
      const body = `${hi}You're leaving ${plan} at ${venue}.${
        endsOn ? ` Your membership ends on ${endsOn};` : ""
      } until then your pass works as usual and nothing more is owed.\n\nChanged your mind? You can stay on from your member page.`;
      return {
        push: {
          title: `You're leaving ${plan}`,
          body: endsOn ? `Your membership ends on ${endsOn}.` : venue,
        },
        email: {
          subject: `You're leaving ${plan}${endsOn ? ` on ${endsOn}` : ""}`,
          body,
        },
        sms: `${venue}: your ${plan} ends${endsOn ? ` on ${endsOn}` : ""}.`,
      };
    }
    const body =
      `${hi}Your ${plan} membership at ${venue} has ended. Thank you for being a member.`;
    return {
      push: {
        title: `Your ${plan} has ended`,
        body: `Thank you, from ${venue}.`,
      },
      email: { subject: `Your ${plan} at ${venue} has ended`, body },
      sms: `${venue}: your ${plan} has ended.`,
    };
  }

  // venue_membership_renewal
  if (step === "approval") {
    const body = `${hi}You're approved for ${plan} at ${venue}. Pay${
      total ? ` ${total}` : ""
    }${
      period === "year" ? " for your first year" : ""
    } within 3 days to start.${money}${codeLine}\n\nNothing renews or is charged by itself.`;
    return {
      push: {
        title: `You're approved for ${plan}`,
        body: `Pay within 3 days to start at ${venue}.`,
      },
      email: { subject: `You're approved for ${plan} at ${venue}`, body },
      sms: `${venue}: you're approved for ${plan}. Pay within 3 days to start.`,
    };
  }
  if (step === "due") {
    const body =
      `${hi}Your ${plan} membership at ${venue} renews today and ${thisPeriod} isn't paid yet.${money}\n\nYou can still come in${
        graceEnds ? ` until ${graceEnds}` : ""
      }. Pay${
        total ? ` ${total}` : ""
      } from your member page to keep your place.${codeLine}`;
    return {
      push: {
        title: `Your ${plan} payment is due`,
        body: `Pay${total ? ` ${total}` : ""} to keep your place at ${venue}.`,
      },
      email: { subject: `Your ${plan} payment is due today`, body },
      sms: `${venue}: your ${plan} payment is due today.`,
    };
  }
  if (step === "reminder") {
    const body =
      `${hi}A reminder: ${thisPeriod}'s payment for your ${plan} membership at ${venue} is still open.${money}\n\n${
        graceEnds
          ? `After ${graceEnds} your membership pauses until it is paid.`
          : "Your membership pauses soon if it isn't paid."
      }${codeLine}`;
    return {
      push: {
        title: `Reminder: pay for your ${plan}`,
        body: graceEnds
          ? `Pay by ${graceEnds} to keep your place.`
          : "Pay soon to keep your place.",
      },
      email: {
        subject: `Reminder: pay for your ${plan}${
          graceEnds ? ` by ${graceEnds}` : ""
        }`,
        body,
      },
      sms: `${venue}: reminder, your ${plan} payment is open.`,
    };
  }
  const restart = step === "restart";
  const yearlyReminder = period === "year" && step === "year_reminder";
  const body = restart
    ? `${hi}Welcome back. Pay for your next ${period} of ${plan} at ${venue} and your membership starts again at once.${money}${codeLine}`
    : `${hi}${
      yearlyReminder ? "A reminder: " : ""
    }Your ${plan} membership at ${venue} renews${
      renewsOn ? ` on ${renewsOn}` : " soon"
    }. Pay before then to keep your place.${money}${codeLine}\n\nNothing is charged by itself: you pay from your member page. If you'd rather stop, you can leave there too.`;
  return {
    push: {
      // Spec 06 §6 (renewal push): "Your {plan} renews on {date}" /
      // "Pay {amount} to keep it. Tap to see your pass." (push opens the
      // member pass in the app).
      title: restart
        ? `Start your ${plan} again`
        : `${yearlyReminder ? "Reminder: " : ""}Your ${plan} renews${
          renewsOn ? ` on ${renewsOn}` : " soon"
        }`,
      body: restart
        ? `Pay${total ? ` ${total}` : ""} from your member page.`
        : `Pay${total ? ` ${total}` : ""} to keep it. Tap to see your pass.`,
    },
    email: {
      subject: restart
        ? `Start your ${plan} at ${venue} again`
        : period === "year"
        ? `${yearlyReminder ? "Reminder: " : ""}Your year with ${venue} renews${
          renewsOn ? ` on ${renewsOn}` : " soon"
        }`
        : `Your ${plan} renews${renewsOn ? ` on ${renewsOn}` : " soon"}`,
      body,
    },
    // Spec 06 §6 / W2 item 6: "Pay here: {link}" with the app link when the
    // handoff is on; otherwise notify-dispatch puts in the web pay link built
    // at send time (venueMembershipRenewalSms), which never rides the payload.
    sms: venueMembershipRenewalSms(categoryKey, payload, null) ??
      `${venue}: your ${plan} renews${
        renewsOn ? ` on ${renewsOn}` : " soon"
      }. Pay from your member page.`,
  };
}

/**
 * Spec 06 §6 renewal text: "Mingla: your {plan} at {venue} renews on {date}.
 * Pay here: {link}". The link is the app link when the handoff gave one, else
 * `payUrl`, the member's web pay page (`/visit/plan/<id>#t=…`) that
 * notify-dispatch built and checked at send time; it is passed here in transit
 * only and never stored in the payload, the inbox or the delivery ledger.
 * Null when this is not a renewal-on-a-date text or there is no link.
 */
export function venueMembershipRenewalSms(
  categoryKey: string,
  payload: Json,
  payUrl: string | null | undefined,
): string | null {
  if (categoryKey !== "venue_membership_renewal") return null;
  const step = text(payload.step);
  if (["approval", "due", "reminder", "restart"].includes(step)) return null;
  const renewsOn = venueEmailDate(text(payload.period_start_date));
  const link = venueAppLinkDisplay(payload) || text(payUrl);
  if (!renewsOn || !link) return null;
  const venue = text(payload.venue_name) || "the venue";
  const plan = text(payload.plan_name) || "membership";
  return `Mingla: your ${plan} at ${venue} renews on ${renewsOn}. Pay here: ${link}`;
}
