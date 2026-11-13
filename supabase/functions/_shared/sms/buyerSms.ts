// Issue #4063 — the single source of truth for buyer-facing SMS copy.
// Returned bodies do not include the transactional STOP footer; callers pass
// them through composeSmsBody at the send boundary.

import { composeSmsBody, sanitizeGsm7 } from "../adapters/smsAdapter.ts";

export type SmsTemplateKey =
  | "S1"
  | "S1G"
  | "S2"
  | "S3"
  | "S4"
  | "S4A"
  | "S4P"
  | "S4G"
  | "S4M"
  | "S4W"
  | "S4R"
  | "S4N"
  | "S4L"
  | "S5"
  | "S5H"
  | "S6"
  | "S7"
  | "S8"
  | "S8H"
  | "S9"
  | "S9V"
  | "S9B"
  | "S10V"
  | "S11"
  | "S11F"
  | "S11V"
  | "S12"
  | "S13"
  | "S14"
  | "S14N"
  | "S15"
  | "S16"
  | "S17"
  | "S18"
  | "S18A"
  | "S18N"
  | "S19"
  | "S20"
  | "S20V"
  | "S20D";

export type BuyerSmsNoun = "ticket" | "booking" | "pass" | "receipt";

export interface BuyerSmsSlots {
  title?: string | null;
  venue?: string | null;
  brand?: string | null;
  lead?: string | null;
  sender?: string | null;
  date?: string | null;
  time?: string | null;
  dayWord?: "today" | "tonight" | "tomorrow" | null;
  party?: number | string | null;
  amount?: string | null;
  expiry?: string | null;
  link?: string | null;
  noun?: BuyerSmsNoun | null;
  claimed?: boolean;
  stateWord?: string | null;
  subjectLabel?: string | null;
}

interface NormalizedSlots {
  title: string;
  venue: string;
  brand: string;
  lead: string;
  sender: string;
  date: string;
  time: string;
  dayWord: "today" | "tonight" | "tomorrow" | null;
  party: string;
  amount: string;
  expiry: string;
  link: string;
  noun: BuyerSmsNoun;
  claimed: boolean;
  stateWord: string;
  subjectLabel: string;
}

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";
const SECONDARY_CAPS = { brand: 14, venue: 20, lead: 12, sender: 12 } as const;
const USER_SLOT_LIMITS = {
  title: 120,
  venue: 60,
  brand: 40,
  lead: 30,
  sender: 30,
} as const;

function isGsm7Char(char: string): boolean {
  return GSM7_BASIC.includes(char) || GSM7_EXT.includes(char);
}

export function toGsm7Text(input: string): string {
  const output: string[] = [];
  for (const char of sanitizeGsm7(input)) {
    if (isGsm7Char(char)) {
      output.push(char);
      continue;
    }

    for (const decomposed of char.normalize("NFKD")) {
      if (/\p{Mark}/u.test(decomposed)) continue;
      if (isGsm7Char(decomposed)) output.push(decomposed);
    }
  }
  return output.join("").replace(/\s+/g, " ").trim();
}

function boundedUserSlot(
  value: string | null | undefined,
  fallback: string,
  limit: number,
): string {
  const normalized = toGsm7Text(value ?? "") || fallback;
  return Array.from(normalized).slice(0, limit).join("").trim() || fallback;
}

function fixedSlot(value: string | number | null | undefined): string {
  return toGsm7Text(String(value ?? ""));
}

function normalizeSlots(slots: BuyerSmsSlots): NormalizedSlots {
  const noun = slots.noun === "booking" || slots.noun === "pass" ||
      slots.noun === "receipt"
    ? slots.noun
    : "ticket";
  return {
    title: boundedUserSlot(slots.title, "your event", USER_SLOT_LIMITS.title),
    venue: boundedUserSlot(slots.venue, "the venue", USER_SLOT_LIMITS.venue),
    brand: boundedUserSlot(slots.brand, "Your host", USER_SLOT_LIMITS.brand),
    lead: boundedUserSlot(slots.lead, "A friend", USER_SLOT_LIMITS.lead),
    sender: boundedUserSlot(slots.sender, "A friend", USER_SLOT_LIMITS.sender),
    date: fixedSlot(slots.date),
    time: fixedSlot(slots.time),
    dayWord: slots.dayWord ?? null,
    party: fixedSlot(slots.party),
    amount: fixedSlot(slots.amount),
    expiry: fixedSlot(slots.expiry),
    link: fixedSlot(slots.link),
    noun,
    claimed: slots.claimed === true,
    stateWord: fixedSlot(slots.stateWord),
    subjectLabel: fixedSlot(slots.subjectLabel),
  };
}

function claimTail(slots: NormalizedSlots, noun = slots.noun): string {
  if (noun === "receipt") {
    return slots.claimed
      ? `Your receipt: ${slots.link}`
      : `Get it using this number: ${slots.link}`;
  }
  if (slots.claimed) return `Your ${noun}: ${slots.link}`;
  return `Get your ${noun} using this number: ${slots.link}`;
}

function updatedTail(slots: NormalizedSlots): string {
  return `Your ${slots.noun} is updated: ${slots.link}`;
}

function render(key: SmsTemplateKey, s: NormalizedSlots): string {
  switch (key) {
    case "S1":
      return `Mingla: You're in: ${s.title}, ${s.date} ${s.time}. ${
        claimTail(s, "ticket")
      }`;
    case "S1G":
      return `Mingla: ${s.brand} added you to the guest list for ${s.title}, ${s.date}. ${
        claimTail(s, "ticket")
      }`;
    case "S2":
      return `Mingla: You're booked on ${s.title}, ${s.date}. ${
        claimTail(s, "booking")
      }`;
    case "S3":
      return `Mingla: You're booked for ${s.title}, ${s.date} ${s.time}. ${
        claimTail(s, "booking")
      }`;
    // Issue #4422 (Seth's copy) — each pass text names the action that earned
    // it. "Here's your pass:" is true claimed or not: the /c/ link opens it.
    case "S4":
      return `Mingla: You RSVP'd to ${s.title}, ${s.date}. Here's your pass: ${s.link}`;
    case "S4A":
      return `Mingla: The host approved your RSVP to ${s.title}, ${s.date}. Here's your pass: ${s.link}`;
    case "S4P":
      return `Mingla: A spot opened at ${s.title}, ${s.date}, so your RSVP is in. Here's your pass: ${s.link}`;
    case "S4G":
      return `Mingla: ${s.lead} added you to the list for ${s.title}, ${s.date}. ${
        claimTail(s, "pass")
      }`;
    // Issue #4422 — RSVP states without a pass link to the event page.
    case "S4M":
      return `Mingla: Maybe saved: ${s.title}, ${s.date}. Change it any time: ${s.link}`;
    case "S4W":
      return `Mingla: Waitlisted: ${s.title}, ${s.date}. We'll text you if a spot opens: ${s.link}`;
    case "S4R":
      return `Mingla: Request sent for ${s.title}, ${s.date}. We'll text you when the host says yes: ${s.link}`;
    case "S4N":
      return `Mingla: Got it, you can't go to ${s.title}, ${s.date}. See the event: ${s.link}`;
    // The same states when no link fits one segment: `stateWord` is the fixed
    // lead-in of S4M/S4W/S4R/S4N ("Maybe saved:", "Waitlisted:", ...).
    case "S4L":
      return `Mingla: ${s.stateWord} ${s.title}, ${s.date}. Check your email for the event link.`;
    case "S5":
      return `Mingla: The host couldn't fit your RSVP for ${s.title}, ${s.date}.`;
    case "S5H":
      return `Mingla: The host removed your RSVP for ${s.title}, ${s.date}.`;
    case "S6": {
      const when = s.dayWord === "tomorrow"
        ? `is tomorrow, ${s.time}`
        : `is on ${s.date}, ${s.time}`;
      return `Mingla: ${s.title} ${when}. ${claimTail(s)}`;
    }
    case "S7": {
      const when = s.dayWord === "today" || s.dayWord === "tonight"
        ? `${s.time} ${s.dayWord}`
        : `${s.date} ${s.time}`;
      return `Mingla: ${s.title} starts ${when}. ${claimTail(s)}`;
    }
    case "S8":
      return `Mingla: Booked: ${s.venue}, ${s.date} ${s.time}, ${s.party} people. ${
        claimTail(s, "booking")
      }`;
    case "S8H":
      return `Mingla: ${s.venue} booked your table: ${s.date} ${s.time}, ${s.party} people. ${
        claimTail(s, "booking")
      }`;
    case "S9":
      return `Mingla: ${s.title} moved to ${s.date} ${s.time}. ${
        updatedTail(s)
      }`;
    case "S9V":
      return `Mingla: ${s.title}, ${s.date}, has new details. ${
        updatedTail(s)
      }`;
    case "S9B":
      return `Mingla: ${s.venue} booking changed: ${s.date} ${s.time}, ${s.party} people. ${
        claimTail(s, "booking")
      }`;
    case "S10V":
      return `Mingla: ${s.venue} ${
        s.dayWord ?? s.date
      }, ${s.time}, ${s.party} people. ${claimTail(s, "booking")}`;
    case "S11":
      return `Mingla: ${s.title}, ${s.date}, is cancelled. Your ${s.amount} refund is on its way.`;
    case "S11F":
      return `Mingla: ${s.title}, ${s.date}, is cancelled.`;
    case "S11V":
      return s.amount.length > 0
        ? `Mingla: ${s.venue} booking for ${s.date} ${s.time} is cancelled. Your ${s.amount} refund is on its way.`
        : `Mingla: ${s.venue} booking for ${s.date} ${s.time} is cancelled.`;
    case "S12":
      return `Mingla: Your ${s.amount} refund for ${s.title} is on its way. Allow 5-10 days.`;
    case "S13":
      return `Mingla: Your ${s.noun} for ${s.title} is waiting. Get it using this number: ${s.link}`;
    case "S14":
      return `Mingla: A spot opened for ${s.title}, ${s.date}. Held for you until ${s.expiry}: ${s.link}`;
    case "S14N":
      return `Mingla: A spot opened for ${s.title}, ${s.date}. Held for you until ${s.expiry}. Check your email to book.`;
    case "S15":
      return `Mingla: Thanks for coming to ${s.title}. Your receipt is in the Mingla app. Get it using this number: ${s.link}`;
    case "S16":
      return `Mingla: ${s.sender} sent you a ticket for ${s.title}, ${s.date} ${s.time}. Get it using this number: ${s.link}`;
    case "S17": {
      const tail = s.claimed
        ? `Your receipt: ${s.link}`
        : `Get it using this number: ${s.link}`;
      return `Mingla: Thanks for ordering at ${s.venue}. Your receipt is in the Mingla app. ${tail}`;
    }
    case "S18":
      return `Mingla: Your ${s.amount} refund for ${s.subjectLabel} is ${s.stateWord}.`;
    case "S18A":
      return `Mingla: Action needed on your ${s.amount} refund for ${s.subjectLabel}: ${s.link}`;
    case "S18N":
      return `Mingla: Action needed on your ${s.amount} refund for ${s.subjectLabel}. Check your email to continue.`;
    // Issue #4271 — the host texted the guest a door pay link.
    case "S19":
      return `Mingla: Pay for ${s.title} here: ${s.link}`;
    // Issue #4422 — an event the guest or buyer holds has changed.
    case "S20":
      return `Mingla: ${s.title} moved to ${s.date} ${s.time}. See the details: ${s.link}`;
    case "S20V":
      return `Mingla: ${s.title} has a new venue. See the details: ${s.link}`;
    case "S20D":
      return `Mingla: ${s.title} has changed. See the details: ${s.link}`;
  }
}

function gsm7Length(text: string): number {
  let length = 0;
  for (const char of text) {
    if (GSM7_EXT.includes(char)) length += 2;
    else if (GSM7_BASIC.includes(char)) length += 1;
    else return Number.POSITIVE_INFINITY;
  }
  return length;
}

export function finalSmsLength(body: string): number {
  return gsm7Length(composeSmsBody(body));
}

function truncateToSeptets(value: string, maxSeptets: number): string {
  if (gsm7Length(value) <= maxSeptets) return value;
  const ellipsis = "...";
  const kept: string[] = [];
  let used = gsm7Length(ellipsis);
  for (const char of value) {
    const cost = GSM7_EXT.includes(char) ? 2 : 1;
    if (used + cost > maxSeptets) break;
    kept.push(char);
    used += cost;
  }
  return `${kept.join("").trimEnd()}${ellipsis}`;
}

function primarySlot(
  key: SmsTemplateKey,
): "title" | "venue" | "subjectLabel" {
  if (key === "S18" || key === "S18A" || key === "S18N") {
    return "subjectLabel";
  }
  return ["S8", "S8H", "S9B", "S10V", "S11V", "S17"].includes(key)
    ? "venue"
    : "title";
}

function usedSecondarySlots(
  key: SmsTemplateKey,
): Array<keyof typeof SECONDARY_CAPS> {
  if (key === "S1G") return ["brand"];
  if (key === "S4G") return ["lead"];
  if (key === "S16") return ["sender"];
  return [];
}

function fitPrimary(
  key: SmsTemplateKey,
  slots: NormalizedSlots,
): string | null {
  const field = primarySlot(key);
  const full = slots[field];
  for (let cap = gsm7Length(full); cap >= 10; cap -= 1) {
    const candidate = truncateToSeptets(full, cap);
    if (gsm7Length(candidate) < 10) continue;
    const body = render(key, { ...slots, [field]: candidate });
    if (finalSmsLength(body) <= 160) return body;
  }
  return null;
}

export function renderBuyerSms(
  key: SmsTemplateKey,
  rawSlots: BuyerSmsSlots,
): string {
  const slots = normalizeSlots(rawSlots);
  const full = render(key, slots);
  if (finalSmsLength(full) <= 160) return full;

  let fitted = { ...slots };
  for (const field of usedSecondarySlots(key)) {
    fitted[field] = truncateToSeptets(fitted[field], SECONDARY_CAPS[field]);
  }
  let body = render(key, fitted);
  if (finalSmsLength(body) <= 160) return body;

  const withPrimary = fitPrimary(key, fitted);
  if (withPrimary !== null) return withPrimary;

  for (let cap = 11; cap >= 6; cap -= 1) {
    fitted = { ...fitted };
    for (const field of usedSecondarySlots(key)) {
      fitted[field] = truncateToSeptets(slots[field], cap);
    }
    body = render(key, fitted);
    if (finalSmsLength(body) <= 160) return body;
    const retried = fitPrimary(key, fitted);
    if (retried !== null) return retried;
  }

  throw new Error(`sms_template_overflow:${key}`);
}

/**
 * Issue #4422 — fit a fixed RSVP sentence into one segment by shortening the
 * event title with "..." (never below 10 characters). Unlike renderBuyerSms it
 * never throws: when even the shortest title does not fit (a long legacy
 * recovery link), the full title is kept and the text sends as more than one
 * segment, exactly as it did before.
 */
export function fitTitleToSegment(
  build: (title: string) => string,
  rawTitle: string,
): string {
  const title = toGsm7Text(rawTitle) || "your event";
  const full = build(title);
  if (finalSmsLength(full) <= 160) return full;
  for (let cap = gsm7Length(title) - 1; cap >= 10; cap -= 1) {
    const candidate = truncateToSeptets(title, cap);
    if (gsm7Length(candidate) < 10) continue;
    const body = build(candidate);
    if (finalSmsLength(body) <= 160) return body;
  }
  // Shortening cannot make it fit: keep the whole title.
  return full;
}
