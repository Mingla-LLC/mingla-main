/**
 * #3682 Wave 2.4 — ticket email follow block + unfollow token (surface d).
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  renderTicketFollowBlockHtml,
  ticketFollowFooterHtml,
  ticketFollowTextLines,
} from "../email/ticketFollow.ts";
import { renderTicketBody } from "../email/ticketBody.ts";
import type { TicketBodyInput } from "../email/types.ts";

function baseTicket(follow: TicketBodyInput["follow"]): TicketBodyInput {
  return {
    variant: "ticket_confirmation_paid",
    event: {
      title: "Tuesday Night Jazz",
      coverMediaUrl: null,
      coverMediaType: null,
      locationText: "Brooklyn",
      isOnline: false,
      startAt: "2026-10-13T19:00:00Z",
      endAt: "2026-10-13T22:00:00Z",
      timezone: "America/New_York",
    },
    brand: { name: "Lantern Room", profilePhotoUrl: null, slug: "lanternroom" },
    order: {
      id: "00000000-0000-4000-8000-000000000001",
      shortId: "ABCD",
      totalCents: 2000,
      currency: "USD",
      buyerName: "Ada",
      lineItems: [
        {
          ticketName: "GA",
          quantity: 1,
          unitPriceCents: 2000,
          totalCents: 2000,
        },
      ],
      tickets: [{ ticketId: "t1", ticketName: "GA" }],
    },
    follow,
  };
}

Deno.test("#3682 happy: follow block renders You're following + Unfollow", () => {
  const html = renderTicketFollowBlockHtml({
    brandName: "Lantern Room",
    unfollowUrl: "https://example.test/unfollow/tok",
    followUrl: null,
    reason: "purchase",
  });
  assertStringIncludes(html, "You're following Lantern Room");
  assertStringIncludes(html, "Unfollow");
  assertStringIncludes(html, "https://example.test/unfollow/tok");
  assertStringIncludes(html, "#6b1420");
});

Deno.test("#3682 happy: offer block when follow write failed", () => {
  const html = renderTicketFollowBlockHtml({
    brandName: "Lantern Room",
    unfollowUrl: null,
    followUrl: "https://host.usemingla.com/b/lanternroom",
    reason: "purchase",
  });
  assertStringIncludes(html, "Want new dates from Lantern Room?");
  assertStringIncludes(html, "Follow");
});

Deno.test("#3682 happy: text part + footer line", () => {
  const lines = ticketFollowTextLines({
    brandName: "Lantern Room",
    unfollowUrl: "https://example.test/u",
    followUrl: null,
  });
  assertEquals(lines[0], "You're following Lantern Room. Unfollow: https://example.test/u");
  const footer = ticketFollowFooterHtml({
    brandName: "Lantern Room",
    unfollowUrl: "https://example.test/u",
    reason: "purchase",
  });
  assertStringIncludes(footer, "bought tickets from Lantern Room");
  assertStringIncludes(footer, "unfollow");
});

Deno.test("#3682 happy: renderTicketBody inserts follow between calendar and app CTA", () => {
  const rendered = renderTicketBody(
    baseTicket({
      unfollowUrl: "https://example.test/unfollow/tok",
      followUrl: null,
      reason: "purchase",
    }),
  );
  assertStringIncludes(rendered.html, "You're following Lantern Room");
  assertStringIncludes(rendered.text, "You're following Lantern Room. Unfollow:");
  const followIdx = rendered.html.indexOf("You're following Lantern Room");
  const appIdx = rendered.html.indexOf("Open in Mingla");
  assert(followIdx > 0);
  assert(appIdx > followIdx);
});

Deno.test("#3682 happy: brandFollowTokens + brand-follow-action wired", async () => {
  Deno.env.set(
    "UNSUBSCRIBE_TOKEN_SECRET",
    "0123456789abcdef0123456789abcdef",
  );
  const { signBrandFollowToken, verifyBrandFollowToken } = await import(
    "../brandFollowTokens.ts"
  );
  const token = await signBrandFollowToken({
    action: "unfollow",
    brand_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
  });
  const payload = await verifyBrandFollowToken(token);
  assertEquals(payload.action, "unfollow");
  assertEquals(payload.brand_id, "11111111-1111-4111-8111-111111111111");

  const dispatchSrc = await Deno.readTextFile(
    new URL("../../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );
  assert(dispatchSrc.includes("attachTicketFollowBlock"));
  assert(dispatchSrc.includes("signBrandFollowToken"));

  const actionSrc = await Deno.readTextFile(
    new URL("../../brand-follow-action/index.ts", import.meta.url),
  );
  assert(actionSrc.includes("verifyBrandFollowToken"));
  assert(actionSrc.includes("You've unfollowed"));
  // GET must confirm; mutation only on POST (email scanners open GET).
  assert(actionSrc.includes('if (req.method === "GET")'));
  assert(actionSrc.includes("htmlConfirm"));
  assert(actionSrc.includes('method="POST"'));
  const getConfirmIdx = actionSrc.indexOf('if (req.method === "GET")');
  const deleteIdx = actionSrc.indexOf('.delete()');
  const upsertIdx = actionSrc.indexOf('.upsert(');
  assert(getConfirmIdx > 0);
  assert(deleteIdx > getConfirmIdx);
  assert(upsertIdx > getConfirmIdx);
});
