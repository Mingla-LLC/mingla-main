// #4490 P5 — guest waitlist messages: plain words, the numbers, no token.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { waitlistDate } from "../email/templates/venueWaitlistEmails.ts";

const base = {
  waitlist_id: "00000000-4490-4000-8000-0000000000e1",
  venue_id: "00000000-4490-4000-8000-0000000000a1",
  venue_name: "Lantern Room",
  party_size: 4,
  desired_date: "2026-11-21",
};

Deno.test("joined: place in line and the time range", () => {
  const m = renderCategoryMessage("venue_waitlist_joined", {
    ...base,
    desired_from: "19:00",
    desired_to: "21:00",
    position: 2,
  });
  assertEquals(
    m.email.subject,
    "You're on the waitlist at Lantern Room on Sat 21 Nov",
  );
  assert(m.email.body.includes("You're number 2 in line."));
  assert(m.email.body.includes("between 19:00 and 21:00"));
});

Deno.test("a table opened names the time found", () => {
  const m = renderCategoryMessage("venue_table_opened", {
    ...base,
    slot_label: "20:30",
  });
  assertEquals(m.email.subject, "A table opened at Lantern Room on Sat 21 Nov");
  assert(m.email.body.includes("at 20:30 for 4 guests"));
});

Deno.test("ready, and no raw codes or tokens anywhere", () => {
  const m = renderCategoryMessage("venue_waitlist_ready", base);
  assertEquals(m.push.title, "Your table at Lantern Room is ready");
  for (const t of [m.email.body, m.email.subject, m.sms, m.push.body]) {
    assert(!/#t=|token|waitlist_/.test(t), t);
  }
  assertEquals(waitlistDate("bad"), "");
});
