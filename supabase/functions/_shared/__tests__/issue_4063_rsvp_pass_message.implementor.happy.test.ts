import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTransactionalEmail } from "../email/index.ts";
import { buildRsvpPassMessage } from "../rsvpPassMessage.ts";

Deno.env.set("DENO_TESTING", "1");

// [TEST-MOD-APPROVED #4422] `promoted` became `reason`, and the pass texts
// are Seth's #4422 copy (each names the action that earned the pass).
const BASE = {
  reason: "going" as const,
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
  assertStringIncludes(message.sms, "Here's your pass: usemingla.com/c/");
  assert(!email.text.toLowerCase().includes("pdf"));
  assert(!email.html.toLowerCase().includes("qr"));
});

Deno.test("#4063 promoted and plus-one RSVP copy keeps approved vocabulary", () => {
  const message = buildRsvpPassMessage({
    ...BASE,
    reason: "spot_opened",
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

Deno.test("#4422 each pass reason has its own text; the email copy follows", () => {
  const going = buildRsvpPassMessage(BASE);
  assertEquals(
    going.sms,
    "Mingla: You RSVP'd to Bachata Takeover, Sat 25 Oct. Here's your pass: usemingla.com/c/AB12CD34EF",
  );
  assertEquals(
    going.body.copy.subject,
    "You're on the list: Bachata Takeover, Sat 25 Oct",
  );
  const approved = buildRsvpPassMessage({ ...BASE, reason: "approved" });
  assertEquals(
    approved.sms,
    "Mingla: The host approved your RSVP to Bachata Takeover, Sat 25 Oct. Here's your pass: usemingla.com/c/AB12CD34EF",
  );
  assertEquals(approved.body.copy.subject, going.body.copy.subject);
  const opened = buildRsvpPassMessage({ ...BASE, reason: "spot_opened" });
  assertEquals(
    opened.sms,
    "Mingla: A spot opened at Bachata Takeover, Sat 25 Oct, so your RSVP is in. Here's your pass: usemingla.com/c/AB12CD34EF",
  );
  assertEquals(opened.body.copy.subject, "You're in: Bachata Takeover");
  // Claimed or not, the wording is the same: the /c/ link opens the pass.
  assertEquals(buildRsvpPassMessage({ ...BASE, claimed: true }).sms, going.sms);
});
