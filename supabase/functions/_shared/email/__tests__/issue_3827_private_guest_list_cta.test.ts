// #3827 Q-A3 (Seth, 2026-10-20) — when the host makes the guest list private,
// the app hides the whole going box, so the ticket, trip and experience
// confirmation emails must stop promising "who's going". A public guest list
// (or a theme with no flag at all) keeps the line exactly as #3524 shipped it.
//
// G1–G3 render the real templates both ways. G4 pins the theme path the
// dispatch reads, which is the one the guest-list RPCs read. G5 reads the
// dispatch as text and proves the flag is threaded into every offering arm;
// `deno check` on the dispatch in the #2240 lane proves those identifiers exist.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@1";

Deno.env.set("DENO_TESTING", "1");

const { renderTicketBody } = await import("../ticketBody.ts");
const { renderTripConfirmationEmail } = await import(
  "../tripConfirmationEmail.ts"
);
const { renderExperienceConfirmationEmail } = await import(
  "../experienceConfirmationEmail.ts"
);
const { renderTransactionalEmail } = await import("../index.ts");
const { appCtaHeadlineFor, isGuestListPrivate } = await import(
  "../appLink.ts"
);

const ORDER_ID = "0a0870b0-c117-4707-bdf4-21fc64bebcab";
const FOLLOW = {
  unfollowUrl: "https://usemingla.com/u/x",
  followUrl: null,
  reason: "purchase" as const,
};

const PUBLIC_COPY = {
  event: "Your ticket, the event chat, and who's going — all in the app",
  trip: "Your ticket, the trip chat, and who's going — all in the app",
  experience: "Your ticket, the details, and who's going — all in the app",
};
const PRIVATE_COPY = {
  event: "Your ticket and the event chat — all in the app",
  trip: "Your ticket and the trip chat — all in the app",
  experience: "Your ticket and the details — all in the app",
};

function ticketInput(privateGuestList?: boolean) {
  return {
    variant: "ticket_confirmation_paid" as const,
    event: {
      title: "Rooftop Sessions",
      coverMediaUrl: null,
      coverMediaType: null,
      locationText: "Lagos",
      isOnline: false,
      startAt: "2026-09-01T18:00:00Z",
      endAt: "2026-09-01T22:00:00Z",
      timezone: "Africa/Lagos",
      ...(privateGuestList === undefined ? {} : { privateGuestList }),
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
    follow: FOLLOW,
    order: {
      id: ORDER_ID,
      shortId: "MG-1234",
      totalCents: 5000,
      currency: "NGN",
      buyerName: "Ada",
      lineItems: [
        {
          ticketName: "General",
          quantity: 2,
          unitPriceCents: 2500,
          totalCents: 5000,
        },
      ],
      tickets: [{ ticketId: "t1", ticketName: "General" }],
    },
  };
}

function renderAll(privateGuestList?: boolean) {
  const ticket = renderTicketBody(ticketInput(privateGuestList), null);
  // The event arm the dispatch actually calls goes through the index renderer.
  const transactional = renderTransactionalEmail({
    variant: "ticket_confirmation_paid",
    recipient: { name: "Ada", email: "ada@example.com" },
    body: ticketInput(privateGuestList),
    appCtaClaimUrl: null,
  });
  const trip = renderTripConfirmationEmail({
    recipient: { name: "Ada", email: "ada@example.com" },
    trip: {
      title: "Obudu Weekend",
      startAtIso: "2026-10-02T08:00:00Z",
      endAtIso: "2026-10-04T18:00:00Z",
      destinationText: "Obudu",
      timezone: "Africa/Lagos",
      days: [{ ordinal: 1, title: "Arrival" }],
      inclusions: [{ kind: "included", item: "Transport" }],
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
    order: {
      id: ORDER_ID,
      shortId: "MG-1235",
      totalCents: 90000,
      currency: "NGN",
    },
    follow: FOLLOW,
    appCtaClaimUrl: null,
    privateGuestList,
  });
  const experience = renderExperienceConfirmationEmail({
    recipient: { name: "Ada", email: "ada@example.com" },
    experience: {
      title: "Island Food Crawl",
      dateIso: "2026-09-12T15:00:00Z",
      timezone: "Africa/Lagos",
      venueText: "Victoria Island",
      stops: [
        {
          stopOrder: 1,
          placeName: "Stop One",
          address: "1 Road",
          startTime: "15:00",
          priceCents: null,
        },
      ],
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
    order: {
      id: ORDER_ID,
      shortId: "MG-1236",
      totalCents: 30000,
      currency: "NGN",
    },
    follow: FOLLOW,
    appCtaClaimUrl: null,
    privateGuestList,
  });
  return [
    { name: "event", offering: "event" as const, html: ticket.html, text: ticket.text },
    {
      name: "event (renderTransactionalEmail)",
      offering: "event" as const,
      html: transactional.html,
      text: transactional.text,
    },
    { name: "trip", offering: "trip" as const, html: trip.html, text: trip.text },
    {
      name: "experience",
      offering: "experience" as const,
      html: experience.html,
      text: experience.text,
    },
  ];
}

/** Both apostrophe spellings, so an escaped "who&#039;s going" cannot hide. */
const WHOS_GOING = /who(?:'|&#0?39;|&apos;|’)s going/i;

Deno.test("G1 a private guest list drops \"who's going\" from every confirmation email, HTML and text", () => {
  for (const { name, offering, html, text } of renderAll(true)) {
    assert(!WHOS_GOING.test(html), `${name}: HTML still promises who's going`);
    assert(!WHOS_GOING.test(text), `${name}: text still promises who's going`);
    // The CTA itself is still there, with the offering's own private line.
    assertStringIncludes(html, PRIVATE_COPY[offering], `${name}: HTML lost its CTA`);
    assertStringIncludes(text, PRIVATE_COPY[offering], `${name}: text lost its CTA`);
    assertStringIncludes(html, "Open in Mingla", `${name}: the button is gone`);
  }
});

Deno.test("G2 a public guest list keeps \"who's going\", unchanged from #3524", () => {
  for (const { name, offering, html, text } of renderAll(false)) {
    assertStringIncludes(html, PUBLIC_COPY[offering], `${name}: HTML lost who's going`);
    assertStringIncludes(text, PUBLIC_COPY[offering], `${name}: text lost who's going`);
  }
});

Deno.test("G3 an absent flag is a public guest list, as it is in the app", () => {
  for (const { name, offering, html, text } of renderAll(undefined)) {
    assertStringIncludes(html, PUBLIC_COPY[offering], `${name}: HTML lost who's going`);
    assertStringIncludes(text, PUBLIC_COPY[offering], `${name}: text lost who's going`);
  }
  for (const offering of ["event", "trip", "experience"] as const) {
    assertEquals(appCtaHeadlineFor(offering), PUBLIC_COPY[offering]);
    assertEquals(appCtaHeadlineFor(offering, null), PUBLIC_COPY[offering]);
    assertEquals(appCtaHeadlineFor(offering, true), PRIVATE_COPY[offering]);
  }
});

Deno.test("G4 the flag is read from theme.business_event.settings.privateGuestList, and only a literal true is private", () => {
  assertEquals(
    isGuestListPrivate({ business_event: { settings: { privateGuestList: true } } }),
    true,
  );
  for (
    const theme of [
      null,
      undefined,
      "x",
      {},
      { business_event: null },
      { business_event: {} },
      { business_event: { settings: null } },
      { business_event: { settings: {} } },
      { business_event: { settings: { privateGuestList: false } } },
      // A string is not the boolean the app writes.
      { business_event: { settings: { privateGuestList: "true" } } },
      // The flag lives under settings, not on business_event or the root.
      { business_event: { privateGuestList: true } },
      { privateGuestList: true },
    ]
  ) {
    assertEquals(isGuestListPrivate(theme), false, JSON.stringify(theme));
  }
});

Deno.test("G5 ticket-confirmation-dispatch keeps privacy while unifying every offering arm", () => {
  const source = Deno.readTextFileSync(
    new URL("../../../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );
  // Read once off the order's theme, into the shared body input (event arm).
  assertStringIncludes(
    source,
    "privateGuestList: isGuestListPrivate(order.events.theme),",
  );
  // #4063 unifies event, trip, and experience delivery behind one purchase
  // message that never renders the former "who's going" CTA. The legacy flag
  // stays in the shared body input for authenticated/PDF compatibility, while
  // the public email path can no longer branch back into any old template.
  const at = source.indexOf("renderEmailBody = (legacyClaimUrl) => {");
  assert(at > 0, "the unified purchase-message render closure must exist");
  const callHead = source.slice(at, at + 700);
  assertStringIncludes(callHead, 'variant: "purchase_message"');
  assert(!callHead.includes("renderTripConfirmationEmail"));
  assert(!callHead.includes("renderExperienceConfirmationEmail"));
});
