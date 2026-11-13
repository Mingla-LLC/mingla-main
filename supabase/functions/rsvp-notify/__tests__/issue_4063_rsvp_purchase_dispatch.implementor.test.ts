import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("#4063 enriched RSVP passes use claim links and the shared purchase message", () => {
  assertStringIncludes(source, "buildRsvpPassMessage({");
  assertStringIncludes(source, 'kind: text(p.role) === "guest"');
  assertStringIncludes(source, '"rsvp_guest" : "rsvp_primary"');
  assertStringIncludes(source, "buttonUrl: buyerLink.url");
  assertStringIncludes(source, "smsLink: buyerLink.display");
  // [TEST-MOD-APPROVED #4422] the pass text names why the guest holds it.
  assertStringIncludes(source, "reason: passReason(claim.template_key, p)");
});

// [TEST-MOD-APPROVED #4422] The enriched pass email keeps the stable ICS and
// the brand Reply-To; the QR PDF stays on the legacy (switch-off) path only.
Deno.test("#4063/#4422 enriched RSVP email attaches only the ICS and replies to the brand", () => {
  assertStringIncludes(source, "uid: `mingla-rsvp-${entityId}@usemingla.com`");
  assertStringIncludes(source, "filename: modernCalendar.icsFilename");
  assertStringIncludes(source, "attachments,");
  assertStringIncludes(
    source,
    '} else if (\n    modernMessage === null && claim.template_key === "rsvp_pass" &&',
  );
  assertStringIncludes(
    source,
    "replyTo: eventUpdateReplyTo(pass?.brandContactEmail)",
  );
  assert(
    !source.includes("        attachment,\n"),
    "the single attachment field is gone",
  );
});

Deno.test("#4422 no RSVP text or email carries the Connect attendance line", () => {
  assert(
    !source.includes("Connect attendance"),
    "the SMS Connect line is gone",
  );
  assert(
    !source.includes("Connect this RSVP"),
    "the email Connect line is gone",
  );
});
