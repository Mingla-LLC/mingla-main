import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("#4063 enriched RSVP passes use claim links and the shared purchase message", () => {
  assertStringIncludes(source, "buildRsvpPassMessage({");
  assertStringIncludes(source, 'kind: text(p.role) === "guest"');
  assertStringIncludes(source, '"rsvp_guest" : "rsvp_primary"');
  assertStringIncludes(source, "buttonUrl: buyerLink.url");
  assertStringIncludes(source, "smsLink: buyerLink.display");
});

Deno.test("#4063 enriched RSVP email attaches only a stable ICS and replies to the brand", () => {
  assertStringIncludes(source, "uid: `mingla-rsvp-${entityId}@usemingla.com`");
  assertStringIncludes(source, "filename: modernCalendar.icsFilename");
  assertStringIncludes(
    source,
    "replyTo: eventUpdateReplyTo(pass?.brandContactEmail)",
  );
  assertStringIncludes(
    source,
    'modernMessage === null && claim.template_key === "rsvp_pass"',
  );
});
