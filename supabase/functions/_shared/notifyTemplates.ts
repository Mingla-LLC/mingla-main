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

    default:
      // Generic fallback — never fabricate; render a plain notice from payload.
      return {
        push: { title: str(payload.title, "Mingla update"), body: str(payload.body, "") },
        email: { subject: str(payload.title, "Mingla update"), body: str(payload.body, "") },
        sms: `${brand}: ${str(payload.body, "You have a new update.")}`,
      };
  }
}
