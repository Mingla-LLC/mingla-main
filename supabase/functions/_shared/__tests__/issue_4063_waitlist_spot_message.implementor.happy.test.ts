import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTransactionalEmail } from "../email/index.ts";
import { buildWaitlistSpotMessage } from "../waitlistSpotMessage.ts";

Deno.env.set("DENO_TESTING", "1");

const BASE = {
  title: "Bachata Takeover",
  brandName: "Bachata Lagos",
  ticketTypeName: "General admission",
  quantity: 2,
  date: "Sat 25 Oct",
  time: "7:30 PM",
  when: "Sat 25 Oct, 7:30 PM",
  place: "The Waterside",
  expiry: "9:00 PM",
  zoneLabel: "Lagos time",
  checkoutUrl: "https://usemingla.com/checkout/event-id?wl=entry-id",
  smsLink: "usemingla.com/c/AB12CD34EF",
};

Deno.test("#4063 waitlist email uses the shared shell and one checkout button", () => {
  const message = buildWaitlistSpotMessage(BASE);
  const email = renderTransactionalEmail({
    variant: "purchase_message",
    recipient: { name: null, email: "buyer@example.test" },
    body: message.body,
  });

  assertEquals(email.subject, "A spot opened: Bachata Takeover, Sat 25 Oct");
  assertEquals(email.html.match(/background:#C4471A/g)?.length, 1);
  assertStringIncludes(email.text, "We're holding 2 General admission");
  assertStringIncludes(email.text, "Book my spot: https://usemingla.com/");
  assert(!email.text.toLowerCase().includes("pdf"));
});

Deno.test("#4063 waitlist SMS uses the redirect code or bounded email fallback", () => {
  const linked = buildWaitlistSpotMessage(BASE);
  assertStringIncludes(linked.sms, "usemingla.com/c/AB12CD34EF");
  assertStringIncludes(linked.sms, "Held for you until 9:00 PM");

  const fallback = buildWaitlistSpotMessage({ ...BASE, smsLink: null });
  assertStringIncludes(fallback.sms, "Check your email to book");
  assert(!fallback.sms.includes("usemingla.com/c/"));
});
