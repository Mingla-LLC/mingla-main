import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTransactionalEmail } from "../email/index.ts";
import { buildRsvpPassMessage } from "../rsvpPassMessage.ts";

Deno.env.set("DENO_TESTING", "1");

const BASE = {
  promoted: false,
  guest: false,
  title: "Bachata Takeover",
  brandName: "Bachata Lagos",
  recipientName: "Amara Okafor",
  recipientEmail: "amara@example.test",
  recipientPhoneLast4: "0123",
  leadName: null,
  claimed: false,
  buttonUrl: "https://usemingla.com/c/AB12CD34EF",
  smsLink: "usemingla.com/c/AB12CD34EF",
  date: "Sat 25 Oct",
  time: "7:30 PM",
  when: "Sat 25 Oct, 7:30 PM",
  place: "The Waterside",
};

Deno.test("#4063 RSVP pass email is QR-free, one-button and linked", () => {
  const message = buildRsvpPassMessage(BASE);
  const email = renderTransactionalEmail({
    variant: "purchase_message",
    recipient: { name: BASE.recipientName, email: BASE.recipientEmail },
    body: message.body,
  });

  assertEquals(
    email.subject,
    "You're on the list: Bachata Takeover, Sat 25 Oct",
  );
  assertEquals(email.html.match(/background:#C4471A/g)?.length, 1);
  assertStringIncludes(email.text, "Get my pass: https://usemingla.com/c/");
  assertStringIncludes(message.sms, "Get your pass using this number");
  assert(!email.text.toLowerCase().includes("pdf"));
  assert(!email.html.toLowerCase().includes("qr"));
});

Deno.test("#4063 promoted and plus-one RSVP copy keeps approved vocabulary", () => {
  const message = buildRsvpPassMessage({
    ...BASE,
    promoted: true,
    guest: true,
    leadName: "Amara",
    claimed: true,
  });
  const email = renderTransactionalEmail({
    variant: "purchase_message",
    recipient: { name: BASE.recipientName, email: BASE.recipientEmail },
    body: message.body,
  });

  assertEquals(email.subject, "You're in: Bachata Takeover");
  assertStringIncludes(email.text, "Amara added you to the list.");
  assertStringIncludes(message.sms, "Amara added you to the list");
  assertStringIncludes(message.sms, "Your pass: usemingla.com/c/AB12CD34EF");
});
