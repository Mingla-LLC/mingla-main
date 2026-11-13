// Issue #4422 rework (tester P1-1) — a long event page link can never stop a
// change notice. The email row builds no text at all; the text row falls back
// to the same sentence without a link when no link fits one segment.
//
// fails-on-revert: render the change text with renderBuyerSms again (no
// no-link fallback) and E-01..E-03 throw sms_template_overflow.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composeSmsBody } from "../../_shared/adapters/smsAdapter.ts";
import { finalSmsLength } from "../../_shared/sms/buyerSms.ts";
import type { ClaimLinkAdmin } from "../../_shared/claimLink.ts";
import {
  buildEventUpdateDispatch,
  type NoticeContext,
} from "../eventUpdate.ts";
import { copyFor } from "../copy.ts";

Deno.env.set("DENO_TESTING", "1");

// 120 characters, longer than any live event link (the longest is 89).
const LONG_URL = `https://host.usemingla.com/e/${"b".repeat(45)}/${
  "s".repeat(45)
}`;
assertEquals(LONG_URL.length, 120);

function context(field: "dates" | "venue" | "details"): NoticeContext {
  return {
    noticeId: "33333333-3333-4333-8333-333333333333",
    kind: "rsvp",
    eventName: "Sunday Sessions",
    brandName: "Lagos Rooftop",
    brandContactEmail: null,
    timezone: "Africa/Lagos",
    changes: field === "dates"
      ? [{
        field: "dates",
        old: [{ s: "2026-11-29T18:00:00Z", e: "2026-11-29T22:00:00Z" }],
        new: [{ s: "2026-12-16T18:30:00Z", e: "2026-12-16T22:00:00Z" }],
      }]
      : field === "venue"
      ? [{ field: "venue", old: "Waterside", new: "The Deck" }]
      : [{ field: "format", old: "in_person", new: "online" }],
    reason: null,
    venueName: "The Deck",
    eventUrl: LONG_URL,
    eventId: "11111111-1111-4111-8111-111111111111",
    lastEndAt: null,
  };
}

const failingMint: ClaimLinkAdmin = {
  rpc: () =>
    Promise.resolve({ data: null, error: { message: "redirect_invalid" } }),
};

function oneSegment(label: string, sms: string): void {
  assert(finalSmsLength(sms) <= 160, `${label}: ${composeSmsBody(sms)}`);
  assert(sms.startsWith("Mingla: "), `${label}: ${sms}`);
  assert(
    !sms.includes("host.usemingla.com"),
    `${label}: no cut-off link: ${sms}`,
  );
}

Deno.test("E-01 the email row of a change notice renders, and builds no text", async () => {
  for (const field of ["dates", "venue", "details"] as const) {
    const dispatch = await buildEventUpdateDispatch(
      context(field),
      {},
      null,
      false,
    );
    assertStringIncludes(dispatch.emailOverride.rendered.html, LONG_URL);
    assertEquals(dispatch.sms, "", `${field}: an email row builds no text`);
  }
});

Deno.test("E-02 the text row falls back to the sentence without a link", async () => {
  const expected = {
    dates: "Mingla: Sunday Sessions moved to Wed 16 Dec 7:30 PM.",
    venue: "Mingla: Sunday Sessions has a new venue.",
    details: "Mingla: Sunday Sessions has changed.",
  };
  for (const field of ["dates", "venue", "details"] as const) {
    const noLinks = await buildEventUpdateDispatch(
      context(field),
      {},
      null,
      true,
    );
    oneSegment(`${field}/no client`, noLinks.sms);
    assertEquals(noLinks.sms, expected[field]);
    const failed = await buildEventUpdateDispatch(
      context(field),
      {},
      failingMint,
      true,
    );
    oneSegment(`${field}/mint failed`, failed.sms);
    assertEquals(failed.sms, expected[field]);
  }
});

Deno.test("E-03 a legacy change row with a long link is one segment", () => {
  for (
    const template of ["rsvp_event_updated", "buyer_event_updated"] as const
  ) {
    const copy = copyFor(
      template,
      { eventName: "Sunday Sessions" },
      LONG_URL,
      LONG_URL.slice(8),
    );
    oneSegment(template, copy.sms);
  }
});
