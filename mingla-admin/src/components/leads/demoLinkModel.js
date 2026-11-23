// #4571 W4 — the pure words and links of booked demos (Needs linking, the
// host card's Demos section and the Calendar). No email or phone is ever
// shown: the server never sends one.

export const SCHEDULER_BASE = "https://usemingla.com/schedule";

/** The host card's own scheduler link; a booking made with it links itself. */
export function schedulerLink(token) {
  return typeof token === "string" && /^[0-9a-f-]{36}$/i.test(token) ? `${SCHEDULER_BASE}?for=${token.toLowerCase()}` : null;
}

/** Why a card is suggested, in a person's words. */
export function reasonWords(s) {
  if (!s || typeof s !== "object") return "";
  switch (s.reason) {
    case "your_call": {
      const m = Number(s.minutes_before);
      if (!Number.isFinite(m)) return "You called them around then";
      if (m === 0) return "You called them as it was booked";
      if (m < 0) return `You called them ${Math.abs(m)} minute${Math.abs(m) === 1 ? "" : "s"} after`;
      return `You called them ${m} minute${m === 1 ? "" : "s"} before`;
    }
    case "email": return "Same email as this card";
    case "phone": return "Same phone as this card";
    case "venue_name": return "Same name as the venue they gave";
    default: return "";
  }
}

const SOURCE_WORDS = Object.freeze({
  card_link: "Booked through the card's link",
  confirmed_suggestion: "Linked from a suggestion",
  picked: "Linked by hand",
  created_from_booking: "Card made from this booking",
});

export function linkSourceWords(source) {
  return SOURCE_WORDS[source] || "";
}

/** A demo's status as the card shows it. */
export function demoStatusWords(status) {
  if (status === "cancelled") return "Demo cancelled";
  if (status === "declined") return "They declined the demo";
  if (status === "moved") return "Demo moved";
  return "Demo booked";
}

/** "N booked demos are not linked to a host card", or "" for none. */
export function bannerWords(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n === 1 ? "1 booked demo is not linked to a host card" : `${n} booked demos are not linked to a host card`;
}

/** The inbox with each list guaranteed to be an array (a missing list is empty, never invented). */
export function inboxView(data) {
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    needsLinking: list(data?.needs_linking),
    withoutDemo: list(data?.without_demo),
    cancelled: list(data?.cancelled),
    count: Number.isFinite(Number(data?.count)) ? Number(data.count) : list(data?.needs_linking).length,
  };
}
