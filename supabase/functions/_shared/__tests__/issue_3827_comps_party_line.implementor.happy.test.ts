/**
 * issue #3827 — guest-list party line in the ticket confirmation email.
 *
 * Unset: the email is byte-identical to the pre-#3827 template (the digest
 * below was computed from origin/main 6c112eeff's ticketBody.ts with the same
 * frozen clock and random seed). Set: one escaped line, once in HTML and once
 * in text. The dispatcher sets it only for comps that snapshotted a lead name.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import { renderTicketBody } from "../email/ticketBody.ts";
import type { TicketBodyInput } from "../email/types.ts";
import { guestListPartyLine } from "../email/partyLine.ts";

const PRE_3827_DIGEST = "81a4daf04489b49097f977653a377eead16d40386d993328bdd801be6c0f1e38";

function input(partyLine?: string | null): TicketBodyInput {
  const order: TicketBodyInput["order"] = {
    id: "00000000-0000-4000-8000-000000003827",
    shortId: "3827",
    totalCents: 0,
    currency: "NGN",
    buyerName: "Chidi",
    lineItems: [{ ticketName: "Guest list", quantity: 1, unitPriceCents: 0, totalCents: 0 }],
    tickets: [{ ticketId: "t1", ticketName: "Guest list" }],
  };
  if (partyLine !== undefined) order.partyLine = partyLine;
  return {
    variant: "ticket_confirmation_free",
    event: {
      title: "Rooftop Social",
      coverMediaUrl: null,
      coverMediaType: null,
      locationText: "Lagos",
      isOnline: false,
      startAt: "2026-11-20T19:00:00Z",
      endAt: "2026-11-20T23:00:00Z",
      timezone: "Africa/Lagos",
    },
    brand: { name: "Kaycee Nights", profilePhotoUrl: null, slug: "kaycee" },
    order,
  };
}

async function frozenDigest(value: TicketBodyInput): Promise<string> {
  const fake = new FakeTime(new Date("2026-10-20T12:00:00Z"));
  const random = Math.random;
  Math.random = () => 0.3827;
  try {
    const out = renderTicketBody(value);
    const bytes = new TextEncoder().encode(JSON.stringify(out));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } finally {
    Math.random = random;
    fake.restore();
  }
}

Deno.test("#3827 party line unset or null: byte-identical to the pre-change email", async () => {
  assertEquals(await frozenDigest(input()), PRE_3827_DIGEST);
  assertEquals(await frozenDigest(input(null)), PRE_3827_DIGEST);
});

Deno.test("#3827 party line set: once in HTML, once in text, HTML-escaped", () => {
  const out = renderTicketBody(input("You're on the guest list with <script>Ada</script>."));
  const html = (out as { html: string }).html;
  const text = (out as { text: string }).text;
  assertEquals(html.split("You&#39;re on the guest list with &lt;script&gt;Ada&lt;/script&gt;.").length - 1, 1);
  assert(!html.includes("<script>Ada"));
  assertEquals(text.split("You're on the guest list with <script>Ada</script>.").length - 1, 1);
  assertStringIncludes(html, "font-weight:600;");
});

Deno.test("#3827 dispatcher party line: comps with a lead name only, host vs link wording", () => {
  assertEquals(guestListPartyLine("comp", { party_lead_name: "Ada Okoro", party_origin: "host" }),
    "You're on the guest list with Ada Okoro.");
  assertEquals(guestListPartyLine("comp", { party_lead_name: "Ada Okoro", party_origin: "link" }),
    "Ada Okoro added you to the guest list.");
  assertEquals(guestListPartyLine("comp", { comp: true }), null);
  assertEquals(guestListPartyLine("comp", { party_lead_name: "  ", party_origin: "host" }), null);
  assertEquals(guestListPartyLine("online_checkout", { party_lead_name: "Ada", party_origin: "host" }), null);
  assertEquals(guestListPartyLine("comp", { party_lead_name: "Ada", party_origin: "other" }), null);
  assertEquals(guestListPartyLine(null, null), null);
});
