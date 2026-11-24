// Issue #4508 — the one rule for an inviter's name in a Mingla-branded guest
// message (text, push, in-app and the guest pass email).
//
// P2-2 / R-11: whatever reaches a Mingla-branded message is letters, spaces,
// hyphens and apostrophes, plus one trailing last initial ("O."), at most 24
// characters, so no link, number or markup can ride in a name (the database
// applies the same rule to its labels; this is the second line). Nothing safe
// left reads "A friend".

import { toGsm7Text } from "./sms/buyerSms.ts";

const INVITER_LIMIT = 24;

/** "Ada O." made safe for one GSM-7 segment; "A friend" when unknown. */
export function inviterForText(label: string | null | undefined): string {
  const raw = toGsm7Text(label ?? "").trim();
  const initial = /\s([A-Za-z])\.$/.exec(raw);
  const head = (initial ? raw.slice(0, initial.index) : raw)
    .replace(/[^\p{L} '\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (head.length === 0) return "A friend";
  const withInitial = initial ? `${head} ${initial[1].toUpperCase()}.` : head;
  const bounded = Array.from(withInitial).slice(0, INVITER_LIMIT).join("")
    .trim();
  return bounded.length > 0 ? bounded : "A friend";
}
