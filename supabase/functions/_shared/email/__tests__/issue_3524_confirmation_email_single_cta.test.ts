/**
 * issue #3524 follow-up — ONE call to action in a confirmation email, and it
 * carries the link that actually does something.
 *
 * ─── WHAT SHIPPED ───────────────────────────────────────────────────────────
 *
 * A ticket confirmation carried TWO competing buttons:
 *
 *   1. "Open in Mingla" — rendered inside the body by `renderAppCtaHtml`, href
 *      hardcoded to `MINGLA_APP_LINK_URL` (the download page). The marketed one.
 *   2. "Connect attendance" — a whole second block that
 *      `ticket-confirmation-dispatch` CONCATENATED onto the finished body, below
 *      the footer, carrying the real per-order attendance claim URL. The useful
 *      one.
 *
 * So the button the email sold went to a store listing while the link that
 * connected the buyer's ticket to their account sat underneath it in a second
 * card. The second block existed for an ordering reason, not a design one: the
 * claim URL is minted AFTER the body is rendered, and the mint order relative to
 * the checkout confirm screen is exactly what #3551 had to fix, so minting could
 * not simply move earlier. The body became late instead.
 *
 * ─── WHY THIS SUITE IS SHAPED THE WAY IT IS ─────────────────────────────────
 *
 * Nothing here pins a URL to a literal. Every assertion RENDERS a template and
 * EXTRACTS the href out of the anchor that says "Open in Mingla", then compares
 * it against the URL that was threaded in — so the test tracks the product
 * rather than a copy of the product's strings. #2240's own suite exists because
 * an assertion once pinned a dead URL's PRESENCE and stayed green while the
 * button 404'd.
 *
 * The fallback and the claim arms are asserted as a PAIR, with A0 proving the
 * two fixtures differ. A suite that only ever rendered one arm would pass
 * identically if the claim URL were ignored altogether.
 *
 * WHAT IS AND IS NOT CLAIMED ABOUT THE DISPATCH. A8 reads
 * `ticket-confirmation-dispatch/index.ts` as TEXT, because the send loop cannot
 * be invoked from a unit test without a Supabase client, a pepper ring and a
 * Resend key. A source assertion is weak on its own — it passes over an
 * undefined identifier — so it is paired with `deno check` on that file in the
 * lane, which is what proves the identifiers it names exist, and with the
 * strict-grep rule that now bans a private "Open in Mingla" anywhere under
 * `supabase/functions/**`. The END-TO-END thread through the shared renderer
 * (A7) IS executed.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  appCtaTextLine,
  type AppCtaHeadline,
  MINGLA_APP_LINK_URL,
  renderAppCtaHtml,
  resolveAppCtaUrl,
} from "../appLink.ts";
import { renderTicketBody } from "../ticketBody.ts";
import { renderTripConfirmationEmail } from "../tripConfirmationEmail.ts";
import { renderExperienceConfirmationEmail } from "../experienceConfirmationEmail.ts";
import { renderTransactionalEmail } from "../index.ts";
import { attendanceClaimUrls } from "../../attendanceClaim.ts";

Deno.env.set("DENO_TESTING", "1");

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORDER_ID = "0a0870b0-c117-4707-bdf4-21fc64bebcab";
const EVENT_ID = "c1d2e3f4-5566-4778-8899-aabbccddeeff";

/**
 * A REAL claim URL, from the real builder — not a hand-written stand-in. Its
 * fragment is query-shaped (`#v=1&kind=order&event=…&source=…&token=…`), so this
 * fixture is what makes the HTML-escaping and text-lockstep assertions mean
 * something: a URL with no `&` in it could not tell a correct implementation
 * from one that forgot to escape.
 */
const CLAIM_URL = attendanceClaimUrls({
  kind: "order",
  eventId: EVENT_ID,
  sourceId: ORDER_ID,
  token: "a".repeat(43),
}).webClaimUrl;

const EVENT_HEADLINE: AppCtaHeadline =
  "Your ticket, the event chat, and who's going — all in the app";
const TRIP_HEADLINE: AppCtaHeadline =
  "Your ticket, the trip chat, and who's going — all in the app";
const EXPERIENCE_HEADLINE: AppCtaHeadline =
  "Your ticket, the experience chat, and who's going — all in the app";

function ticketBodyInput() {
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
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
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

/** The three offering types, each rendered with whatever claim URL is passed. */
function renderAllThree(
  claimUrl: string | null,
): Array<
  { name: string; headline: AppCtaHeadline; html: string; text: string }
> {
  const ticket = renderTicketBody(ticketBodyInput(), claimUrl);
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
    appCtaClaimUrl: claimUrl,
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
    appCtaClaimUrl: claimUrl,
  });

  return [
    {
      name: "event",
      headline: EVENT_HEADLINE,
      html: ticket.html,
      text: ticket.text,
    },
    {
      name: "trip",
      headline: TRIP_HEADLINE,
      html: trip.html,
      text: trip.text,
    },
    {
      name: "experience",
      headline: EXPERIENCE_HEADLINE,
      html: experience.html,
      text: experience.text,
    },
  ];
}

// ─── Extractors ─────────────────────────────────────────────────────────────

/**
 * Every href attached to an anchor whose label is "Open in Mingla" — the CTA and
 * nothing else. A confirmation body also carries calendar links and a mailto,
 * and counting those would make "exactly one CTA" unfalsifiable.
 */
function ctaHrefs(html: string): string[] {
  return [
    ...html.matchAll(/<a\s+href="([^"]*)"[^>]*>\s*Open in Mingla\s*<\/a>/g),
  ].map((m) => m[1]);
}

/** HTML attribute decoding — `&amp;` in an href IS the same URL as a bare `&`. */
function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The URL the plain-text twin prints after its headline. */
function textCtaUrls(text: string, headline: string): string[] {
  return [
    ...text.matchAll(new RegExp(`${escapeRegExp(headline)}: (\\S+)`, "g")),
  ].map((m) => m[1]);
}

// ─── A0 — the two arms are really different ─────────────────────────────────

Deno.test("A0 the claim-URL fixture is not the fallback, so A1 and A2 are different assertions", () => {
  assert(
    CLAIM_URL !== MINGLA_APP_LINK_URL,
    "the claim URL fixture equals the fallback constant — A1 and A2 would then pass on an implementation that ignores the claim URL entirely",
  );
  assertStringIncludes(
    CLAIM_URL,
    "&",
    "the claim URL fixture carries no '&', so the HTML-escaping and text-lockstep assertions below cannot fail",
  );
});

// ─── A1 — the button carries the claim URL when there is one ────────────────

Deno.test("A1 every offering's CTA carries the per-order claim URL when one exists", () => {
  for (const { name, html } of renderAllThree(CLAIM_URL)) {
    const hrefs = ctaHrefs(html);
    assertEquals(
      hrefs.length,
      1,
      `${name}: expected exactly one "Open in Mingla" button, found ${hrefs.length}`,
    );
    assertEquals(
      decodeEntities(hrefs[0]),
      CLAIM_URL,
      `${name}: the button does not carry the order's claim URL. That link is the whole point of the email — before this change it lived in a SECOND block below the footer.`,
    );
    // And it is attribute-ESCAPED. A claim URL's fragment is query-shaped, and a
    // raw `&` in an attribute value is wrong even where browsers tolerate it.
    assertStringIncludes(
      hrefs[0],
      "&amp;",
      `${name}: the button's href is not HTML-attribute escaped`,
    );
    assert(
      !/&(?!amp;|lt;|gt;|quot;|#\d+;)/.test(hrefs[0]),
      `${name}: the button's href carries a raw & — it is not attribute-escaped`,
    );
  }
});

// ─── A2 — and falls back to the constant when there is none ─────────────────

Deno.test("A2 with no claim URL the CTA still renders, on the download page", () => {
  // Seth's decision: already-connected orders, and orders whose proof the
  // checkout confirm screen armed first (`already_issued`), have no claim URL.
  // The email must never lose its route into the app.
  for (const noClaim of [null, undefined]) {
    for (const { name, html } of renderAllThree(noClaim as string | null)) {
      const hrefs = ctaHrefs(html);
      assertEquals(
        hrefs.length,
        1,
        `${name} (claim=${String(noClaim)}): expected exactly one "Open in Mingla" button, found ${hrefs.length}`,
      );
      assertEquals(
        decodeEntities(hrefs[0]),
        MINGLA_APP_LINK_URL,
        `${name} (claim=${String(noClaim)}): an order with no claim URL must still get a working button`,
      );
    }
  }
});

// ─── A3 — #2240's lockstep, on BOTH arms ────────────────────────────────────

Deno.test("A3 the plain-text twin carries the SAME link as the HTML href, claim or fallback", () => {
  for (const claimUrl of [CLAIM_URL, null]) {
    for (const { name, headline, html, text } of renderAllThree(claimUrl)) {
      const hrefs = ctaHrefs(html);
      assertEquals(hrefs.length, 1, `${name}: one CTA expected`);
      const textUrls = textCtaUrls(text, headline);
      assertEquals(
        textUrls.length,
        1,
        `${name} (claim=${claimUrl !== null}): the plain-text body must carry the CTA exactly once, found ${textUrls.length}`,
      );
      assertEquals(
        textUrls[0],
        decodeEntities(hrefs[0]),
        `${name} (claim=${claimUrl !== null}): the text body's link diverged from the HTML href — #2240 requires them identical`,
      );
    }
  }
});

// ─── A4 — ONE call to action, not two ───────────────────────────────────────

Deno.test("A4 no confirmation email renders a second call to action", () => {
  for (const claimUrl of [CLAIM_URL, null]) {
    for (const { name, html, text } of renderAllThree(claimUrl)) {
      assertEquals(
        [...html.matchAll(/Open in Mingla/g)].length,
        1,
        `${name}: "Open in Mingla" appears more than once in the HTML`,
      );
      // The removed block, by its own copy. It had a heading, a button label and
      // a sentence, and any of the three surviving means it is still being
      // appended somewhere.
      for (
        const gone of [
          "Connect your attendance",
          "Connect attendance",
          "Connect it to your Mingla account",
        ]
      ) {
        assert(
          !html.includes(gone),
          `${name}: the removed second CTA is still in the HTML ("${gone}")`,
        );
        assert(
          !text.includes(gone),
          `${name}: the removed second CTA is still in the text ("${gone}")`,
        );
      }
      // Exactly one occurrence of the CTA's destination in the text body too —
      // a second appended block would print the claim URL twice.
      const claimHits =
        [...text.matchAll(new RegExp(escapeRegExp(CLAIM_URL), "g"))].length;
      assertEquals(
        claimHits,
        claimUrl === null ? 0 : 1,
        `${name}: expected the claim URL ${claimUrl === null ? 0 : 1}× in the text body, found ${claimHits}`,
      );
    }
  }
});

// ─── A5 — offering-aware copy, each type its own noun ───────────────────────

Deno.test("A5 each offering type renders its own copy, ticket first and chat second", () => {
  const nounFor: Record<string, string> = {
    event: "the event chat",
    trip: "the trip chat",
    experience: "the experience chat",
  };
  const rendered = renderAllThree(CLAIM_URL);
  assertEquals(rendered.length, 3, "three offering types expected");

  for (const { name, headline, html, text } of rendered) {
    // The copy is in BOTH bodies, not just the one someone looked at.
    assertStringIncludes(html, headline, `${name}: HTML is missing its headline`);
    assertStringIncludes(text, headline, `${name}: text is missing its headline`);

    // Ticket first, chat second, who's going last — Seth's order, asserted as
    // an ORDER rather than as three independent substrings.
    const ticketAt = headline.indexOf("Your ticket");
    const chatAt = headline.indexOf(nounFor[name]);
    const goingAt = headline.indexOf("who's going");
    assert(ticketAt === 0, `${name}: the headline must lead with the ticket`);
    assert(
      chatAt > ticketAt && goingAt > chatAt,
      `${name}: expected ticket, then chat, then who's going — got "${headline}"`,
    );

    // …and it names ITS OWN offering, not a neighbour's.
    for (const [other, noun] of Object.entries(nounFor)) {
      if (other === name) continue;
      assert(
        !html.includes(noun),
        `${name}: promises "${noun}" — that is the ${other} email's copy`,
      );
      assert(
        !text.includes(noun),
        `${name}: the text body promises "${noun}" — that is the ${other} email's copy`,
      );
    }
  }
});

Deno.test("A5 the experience email no longer ships the chat-free copy", () => {
  // It was the odd one out: "Your ticket + details are in the Mingla app",
  // the only confirmation of the three that promised no group chat. Seth
  // (2026-09-22): every offering type comes with one.
  for (const claimUrl of [CLAIM_URL, null]) {
    const experience = renderAllThree(claimUrl).find((r) =>
      r.name === "experience"
    )!;
    for (const body of [experience.html, experience.text]) {
      assert(
        !body.includes("Your ticket + details are in the Mingla app"),
        "the experience email still ships the pre-#3524 chat-free CTA copy",
      );
    }
  }
});

// ─── A6 — the resolver refuses a destination it cannot vouch for ────────────

Deno.test("A6 a malformed or hostile claim URL degrades to the download page", () => {
  for (
    const bad of [
      "",
      "   ",
      "javascript:alert(1)",
      "http://host.usemingla.com/attendance/claim#v=1",
      "host.usemingla.com/attendance/claim",
      "https://",
      "data:text/html,<script>alert(1)</script>",
    ]
  ) {
    assertEquals(
      resolveAppCtaUrl(bad),
      MINGLA_APP_LINK_URL,
      `resolveAppCtaUrl accepted "${bad}" as the CTA destination`,
    );
    const hrefs = ctaHrefs(renderAppCtaHtml(EVENT_HEADLINE, bad));
    assertEquals(hrefs.length, 1, `"${bad}": one CTA expected`);
    assertEquals(
      decodeEntities(hrefs[0]),
      MINGLA_APP_LINK_URL,
      `"${bad}" reached the button's href`,
    );
    assertStringIncludes(
      appCtaTextLine(EVENT_HEADLINE, bad),
      MINGLA_APP_LINK_URL,
      `"${bad}" reached the plain-text line`,
    );
  }
  // …and a well-formed one is NOT degraded, or the check above is vacuous.
  assertEquals(resolveAppCtaUrl(CLAIM_URL), CLAIM_URL);
  assertEquals(resolveAppCtaUrl(` ${CLAIM_URL} `), CLAIM_URL);
});

// ─── A7 — the thread through the shared renderer, executed ──────────────────

Deno.test("A7 renderTransactionalEmail threads the claim URL into the body's one CTA", () => {
  // This is the exact entry point `ticket-confirmation-dispatch` calls for an
  // event order, so the plumbing is proven end to end rather than at the leaf.
  const withClaim = renderTransactionalEmail({
    variant: "ticket_confirmation_paid",
    recipient: { name: "Ada", email: "ada@example.com" },
    body: ticketBodyInput(),
    appCtaClaimUrl: CLAIM_URL,
  });
  const withoutClaim = renderTransactionalEmail({
    variant: "ticket_confirmation_paid",
    recipient: { name: "Ada", email: "ada@example.com" },
    body: ticketBodyInput(),
  });

  assertEquals(ctaHrefs(withClaim.html).length, 1);
  assertEquals(decodeEntities(ctaHrefs(withClaim.html)[0]), CLAIM_URL);
  assertEquals(
    textCtaUrls(withClaim.text, EVENT_HEADLINE)[0],
    CLAIM_URL,
    "the shared renderer's text body did not follow its HTML href",
  );

  assertEquals(ctaHrefs(withoutClaim.html).length, 1);
  assertEquals(
    decodeEntities(ctaHrefs(withoutClaim.html)[0]),
    MINGLA_APP_LINK_URL,
  );
  assertEquals(
    textCtaUrls(withoutClaim.text, EVENT_HEADLINE)[0],
    MINGLA_APP_LINK_URL,
  );
});

// ─── A8 — the dispatch no longer appends a second block ─────────────────────

Deno.test("A8 ticket-confirmation-dispatch renders the CTA through the template, not after it", () => {
  const source = Deno.readTextFileSync(
    new URL("../../../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );

  // The second block is gone, root and branch.
  assert(
    !source.includes("renderAttendanceClaimAvailableEmail"),
    "the dispatch still references renderAttendanceClaimAvailableEmail — that is the appended second CTA",
  );
  assert(
    !/\$\{renderedEmail\.html\}\$\{/.test(source),
    "the dispatch still concatenates something onto the rendered HTML body",
  );
  assert(
    !/\$\{renderedEmail\.text\}\\n\\n\$\{/.test(source),
    "the dispatch still concatenates something onto the rendered text body",
  );

  // …and the claim URL now goes IN, through the same render that produced the
  // body. `deno check` on this file in the lane is what proves these identifiers
  // exist; this assertion proves they are wired to each other.
  assertStringIncludes(
    source,
    "renderEmailBody(attendanceWebClaimUrl)",
    "the minted claim URL is not passed back into the body render",
  );
  assertStringIncludes(
    source,
    "renderedEmail = renderEmailBody(null)",
    "the eager no-claim render is gone, so a render failure would no longer surface before the send loop",
  );
  for (
    const arm of [
      "renderEmailBody = (appCtaClaimUrl) => renderTripConfirmationEmail({",
      "renderEmailBody = (appCtaClaimUrl) => renderExperienceConfirmationEmail({",
      "renderEmailBody = (appCtaClaimUrl) => renderTransactionalEmail({",
    ]
  ) {
    assertStringIncludes(
      source,
      arm,
      `an offering arm does not take the claim URL: ${arm}`,
    );
  }

  // THE MINT DID NOT MOVE. #3551 fixed the order in which this issuance runs
  // relative to the checkout confirm screen's own mint; a "render earlier"
  // refactor that hoisted it would silently undo that.
  const mintAt = source.indexOf('"issue_order_attendance_claim_proof_v2"');
  const sendLoopAt = source.indexOf("for (const notification of notifications");
  assert(mintAt > 0 && sendLoopAt > 0, "mint and send loop both expected");
  assert(
    mintAt > sendLoopAt,
    "the attendance-claim mint has moved OUT of the notification loop — #3551's ordering fix depends on where it runs",
  );
  assertStringIncludes(
    source,
    "p_allow_retry_rotation: false",
    "replay-safe issuance flag lost",
  );
});
