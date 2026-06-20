// META-ORCH-1161 Sub-A — per-category message templates (single source of truth).
//
// Copy is VERBATIM from
// Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md.
// GSM-7 discipline: SMS bodies use only ASCII punctuation (straight quotes,
// hyphens). The dispatcher's smsAdapter still runs the sanitizer, but these are
// authored clean. The thin slice wires buyer_reservation_changed; the other
// rendered moments are present so the v2 core can fan out the seeded categories.

export interface RenderedMessage {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string; // WITHOUT the STOP footer — smsAdapter appends it.
}

function str(v: unknown, fallback = ""): string {
  return v === null || v === undefined ? fallback : String(v);
}

// Format an integer cents amount into a currency-aware display string. Mirrors the
// edge-side formatMoneyCents intent without importing the Stripe helper here (this
// module must stay dependency-light + unit-testable). Falls back to a plain amount
// if the payload already carries a pre-formatted `amount` string.
function fmtAmount(payload: Record<string, unknown>): string {
  if (typeof payload.amount === "string" && payload.amount.length > 0) {
    return payload.amount;
  }
  const cents = Number(payload.amount_cents);
  if (!Number.isFinite(cents)) return "";
  const currency = str(payload.currency, "USD").toUpperCase().slice(0, 3);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// Format an ISO timestamp into a short date + time for copy interpolation.
// Locale-aware-friendly but deterministic for tests (en-US, UTC-stable display
// would require the venue tz — the thin slice passes pre-formatted date/time in
// payload when available, else derives a simple split).
function fmtDate(payload: Record<string, unknown>): { date: string; time: string } {
  if (payload.date && payload.time) {
    return { date: str(payload.date), time: str(payload.time) };
  }
  const iso = str(payload.reserved_for);
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

export function renderCategoryMessage(
  categoryKey: string,
  payload: Record<string, unknown>,
): RenderedMessage {
  const brand = str(payload.brand_name ?? payload.brand, "Mingla");
  const party = str(payload.party_size ?? payload.party, "");
  const { date, time } = fmtDate(payload);
  // Reminder lead bucket ('24h' | '2h') decides which COPY §3.3-3.6 variant renders.
  const leadBucket = str(payload.lead_bucket, "24h");
  const eventTitle = str(payload.event_title ?? payload.title, "your event");

  switch (categoryKey) {
    case "buyer_reservation_changed":
      // COPY §3.1
      return {
        push: {
          title: "Reservation updated",
          body: `${brand}: now ${date} ${time}, party of ${party}.`,
        },
        email: {
          subject: `Your ${brand} reservation changed`,
          body:
            `Your reservation at ${brand} has been updated.\n\n` +
            `It's now ${date} at ${time}, party of ${party}.\n\n` +
            `See the details in the Mingla app.`,
        },
        sms: `${brand}: Your reservation changed - now ${date} ${time}, party of ${party}.`,
      };

    case "buyer_reservation_confirmed":
      return {
        push: { title: "Reservation confirmed", body: `${brand}: ${date} ${time}, party of ${party}.` },
        email: {
          subject: `Your ${brand} reservation is confirmed`,
          body: `Your table for ${party} is confirmed at ${brand} on ${date} at ${time}.\n\nSee you there!`,
        },
        sms: `${brand}: Table for ${party} confirmed ${date} ${time}.`,
      };

    case "buyer_reservation_cancelled":
      // COPY §3.2
      return {
        push: { title: "Reservation cancelled", body: `${brand}: your ${date} reservation was cancelled.` },
        email: {
          subject: `Your ${brand} reservation was cancelled`,
          body: `Your reservation at ${brand} for ${date} was cancelled.\n\nQuestions? Contact the venue.`,
        },
        sms: `${brand}: Your reservation for ${date} was cancelled. Questions? Contact the venue.`,
      };

    case "buyer_event_reminder":
      // COPY §3.3 (24h) / §3.4 (2h).
      if (leadBucket === "2h") {
        return {
          push: {
            title: `Starting soon: ${eventTitle}`,
            body: `${brand}: starts in 2h at ${time}.`,
          },
          email: {
            subject: `${eventTitle} starts in 2 hours`,
            body:
              `${eventTitle} starts in 2 hours at ${time}.\n\n` +
              `See you soon! Details are in the Mingla app.`,
          },
          sms: `${brand}: ${eventTitle} starts in 2 hours at ${time}. See you soon!`,
        };
      }
      return {
        push: {
          title: `Tomorrow: ${eventTitle}`,
          body: `${brand}: starts ${time}. See you there!`,
        },
        email: {
          subject: `${eventTitle} is tomorrow`,
          body:
            `${eventTitle} is tomorrow at ${time}.\n\n` +
            `See you there! Details are in the Mingla app.`,
        },
        sms: `${brand}: ${eventTitle} is tomorrow at ${time}. See you there!`,
      };

    case "buyer_reservation_reminder":
      // COPY §3.5 (24h) / §3.6 (2h).
      if (leadBucket === "2h") {
        return {
          push: {
            title: "Reservation soon",
            body: `${brand}: in 2h at ${time}, party of ${party}.`,
          },
          email: {
            subject: `Your ${brand} reservation is in 2 hours`,
            body:
              `Your reservation at ${brand} is in 2 hours at ${time}, party of ${party}.\n\n` +
              `See you soon!`,
          },
          sms: `${brand}: Your reservation is in 2 hours at ${time}, party of ${party}.`,
        };
      }
      return {
        push: {
          title: "Reservation tomorrow",
          body: `${brand}: ${time}, party of ${party}.`,
        },
        email: {
          subject: `Your ${brand} reservation is tomorrow`,
          body:
            `Reminder - your reservation at ${brand} is tomorrow at ${time}, party of ${party}.\n\n` +
            `See you there!`,
        },
        sms: `${brand}: Reminder - your reservation is tomorrow at ${time}, party of ${party}.`,
      };

    case "buyer_purchase_confirmation": {
      // COPY §3.11 — NO SMS (DEC-185). Push + email only. The email PDF/.ics
      // artifact stays owned by ticket-confirmation-dispatch (§7.1); this push/
      // inapp leg is the net-new add. The sms string is rendered defensively but
      // the seed has no 'sms' channel for this category so it is never used.
      return {
        push: {
          title: `You're in for ${eventTitle}`,
          body: `${brand}: ${date} at ${time} - your tickets are in the Mingla app.`,
        },
        email: {
          subject: `Your ${brand} tickets for ${eventTitle}`,
          body:
            `You're confirmed for ${eventTitle}. ` +
            `Your ticket and calendar invite are attached, and everything lives in the Mingla app.`,
        },
        sms: `${brand}: You're in for ${eventTitle} on ${date}. Tickets in the Mingla app.`,
      };
    }

    case "buyer_refund_issued": {
      // COPY §3.9.
      const amount = fmtAmount(payload);
      return {
        push: {
          title: "Refund issued",
          body: `${brand}: ${amount} refunded, 5-10 days to appear.`,
        },
        email: {
          subject: `Your ${brand} refund has been issued`,
          body:
            `Your refund of ${amount} from ${brand} has been issued.\n\n` +
            `It should appear on your statement in 5-10 days.`,
        },
        sms: `${brand}: Your refund of ${amount} has been issued and should appear in 5-10 days.`,
      };
    }

    case "buyer_order_cancelled":
      // COPY §3.10.
      return {
        push: {
          title: "Order cancelled",
          body: `${brand}: your ${eventTitle} order was cancelled; payment refunded.`,
        },
        email: {
          subject: `Your ${brand} order was cancelled`,
          body:
            `Your order for ${eventTitle} at ${brand} was cancelled.\n\n` +
            `Any payment will be refunded.`,
        },
        sms: `${brand}: Your order for ${eventTitle} was cancelled. Any payment will be refunded.`,
      };

    default:
      // Generic fallback — never fabricate; render a plain notice from payload.
      return {
        push: { title: str(payload.title, "Mingla update"), body: str(payload.body, "") },
        email: { subject: str(payload.title, "Mingla update"), body: str(payload.body, "") },
        sms: `${brand}: ${str(payload.body, "You have a new update.")}`,
      };
  }
}
