// #4255 — a work card email's subject names the card, so each card is its own
// email and Gmail conversation; the body links to the card on Mingla Admin
// only (never another host).
// FAILS-ON-REVERT: drop the admin.team_mention case in notifyTemplates.ts ->
// the body loses "Open the card" and the off-host link test fails.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

const card = "42550000-0000-4000-a0ce-0000000000c1";
const link = `https://admin.usemingla.com/#/work-board?card=${card}`;

Deno.test("#4255 card email subject is the producer's card title line", () => {
  const out = renderCategoryMessage("admin.team_mention", {
    title: "Seth tagged you: Roving Heights Open Mic",
    body: "Seth on Roving Heights Open Mic: can you check the venue?",
    card_title: "Roving Heights Open Mic",
    deep_link: link,
  });
  assertEquals(out.email.subject, "Seth tagged you: Roving Heights Open Mic");
  assertEquals(
    out.email.body,
    `Seth on Roving Heights Open Mic: can you check the venue?\n\nOpen the card: ${link}`,
  );
  assertEquals(out.sms, "");
});

Deno.test("#4255 card email falls back to the card title, and never links off Admin", () => {
  const out = renderCategoryMessage("admin.team_mention", {
    card_title: "Roving Heights Open Mic",
    body: "A note.",
    deep_link: "https://evil.example/#/work-board",
  });
  assertEquals(out.email.subject, "Work card: Roving Heights Open Mic");
  assertEquals(out.email.body, "A note.");
  assertEquals(
    renderCategoryMessage("admin.team_mention", {}).email.subject,
    "A Mingla work card changed",
  );
});
