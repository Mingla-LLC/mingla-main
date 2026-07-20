// ISSUE-1001 [brand logo consolidation] — implementor HAPPY-PATH regression
// suite for the canonical backend logo resolution (_shared/brandAssets.ts).
//
// Contract under test (SPEC #1001 §4.1 / SC-1):
//   - With the MINGLA_LOGO_URL secret UNSET, every email renderer and both
//     PDF entrypoints resolve the logo to EXACTLY the live canonical URL
//     https://usemingla.com/brand/email/mingla-wordmark-email.png (bare host).
//   - The env secret remains the authoritative override; whitespace-only
//     values are treated as unset (trim guard, T12).
//   - No code path can produce the retired dead email-assets URL, the retired
//     root logo.png literal, or a www.usemingla.com host.
//
// Tester adversarial surface is RESERVED at
// issue_1001_brand_assets.adversarial.test.ts — do not fold it in here.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Sender/footer envs BEFORE importing the renderers (they read env at module
// load / call time — mirrors _shared/email/__tests__/shell.test.ts). The logo
// env is deliberately DELETED: the default path is the subject under test.
Deno.env.set("DENO_TESTING", "1");
Deno.env.delete("MINGLA_LOGO_URL");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
Deno.env.set("MINGLA_FROM_EMAIL", "hello@send.usemingla.com");
Deno.env.set("RESEND_TICKET_FROM", "Mingla <tickets@usemingla.com>");
Deno.env.set("RESEND_ADMIN_FROM", "Mingla <hello@usemingla.com>");
Deno.env.set("RESEND_SYSTEM_FROM", "Mingla <notifications@usemingla.com>");

const { DEFAULT_MINGLA_LOGO_URL, minglaLogoUrl } = await import(
  "../brandAssets.ts"
);
const { renderTransactionalEmail } = await import("../email/index.ts");
const { renderMarketingEmail } = await import("../marketingEmailRender.ts");
const { buildInviteEmail } = await import("../brandInviteEmail.ts");
import type { RenderInput, TicketBodyInput } from "../email/types.ts";

const CANONICAL = "https://usemingla.com/brand/email/mingla-wordmark-email.png";
// Assembled from parts so THIS file never carries the dead literals the
// issue-1001-dead-logo-urls.mjs gate bans repo-wide.
const DEAD_EMAIL_ASSETS = ["usemingla.com", "email-assets", "mingla-logo.png"]
  .join("/");
const DEAD_ROOT_LOGO = ["usemingla.com", "logo.png"].join("/");

function ticketFixture(): RenderInput {
  const body: TicketBodyInput = {
    variant: "ticket_confirmation_paid",
    event: {
      title: "Sunset Sail",
      coverMediaUrl: "https://cdn.usemingla.com/events/sunset.jpg",
      coverMediaType: "image",
      locationText: "Brighton Marina",
      isOnline: false,
      startAt: "2026-06-12T18:00:00Z",
      endAt: "2026-06-12T20:00:00Z",
      timezone: "Europe/London",
    },
    brand: { name: "Coastline Co", profilePhotoUrl: null },
    order: {
      id: "order_fixture_1001",
      shortId: "abcd1001",
      totalCents: 5000,
      currency: "GBP",
      buyerName: "Buyer Name",
      lineItems: [{
        ticketName: "General",
        quantity: 2,
        unitPriceCents: 2500,
        totalCents: 5000,
      }],
      tickets: [
        { ticketId: "t1", ticketName: "General" },
        { ticketId: "t2", ticketName: "General" },
      ],
    },
  };
  return {
    variant: "ticket_confirmation_paid",
    recipient: { name: "Buyer", email: "buyer@example.com" },
    body,
  };
}

function assertNoDeadOrWwwLogo(html: string): void {
  assert(!html.includes(DEAD_EMAIL_ASSETS), "dead email-assets URL leaked");
  assert(!html.includes(DEAD_ROOT_LOGO), "dead root logo.png URL leaked");
  assert(!html.includes("www.usemingla.com"), "www host leaked into email");
}

Deno.test("T1: env unset → minglaLogoUrl() returns the canonical bare-host URL", () => {
  Deno.env.delete("MINGLA_LOGO_URL");
  assertEquals(minglaLogoUrl(), CANONICAL);
  assertEquals(DEFAULT_MINGLA_LOGO_URL, CANONICAL);
});

Deno.test("T2: env override wins (trimmed)", () => {
  Deno.env.set("MINGLA_LOGO_URL", "  https://x.test/l.png  ");
  assertEquals(minglaLogoUrl(), "https://x.test/l.png");
  Deno.env.delete("MINGLA_LOGO_URL");
});

Deno.test("T12: whitespace-only env → default returned (trim guard)", () => {
  Deno.env.set("MINGLA_LOGO_URL", "   ");
  assertEquals(minglaLogoUrl(), CANONICAL);
  Deno.env.delete("MINGLA_LOGO_URL");
});

Deno.test("T3: transactional shell render with NO secret — canonical URL >=2x (header+footer), zero dead/www literals", () => {
  Deno.env.delete("MINGLA_LOGO_URL");
  const result = renderTransactionalEmail(ticketFixture());
  const matches = result.html.match(/mingla-wordmark-email\.png/g) ?? [];
  assert(matches.length >= 2, `logo rendered ${matches.length}x, expected >=2`);
  assertStringIncludes(result.html, CANONICAL);
  assertNoDeadOrWwwLogo(result.html);
});

Deno.test("T4a: marketing render default path emits the canonical URL", () => {
  Deno.env.delete("MINGLA_LOGO_URL");
  const result = renderMarketingEmail({
    body_html: "<p>Hello {first_name}</p>",
    variables: {
      first_name: "Ada",
      event_name: null,
      event_date: null,
      event_time: null,
      doors_open: null,
      ends_at: null,
      brand_name: "Coastline Co",
      event_url: null,
      spots_left: null,
      previous_event_name: null,
      next_event_name: null,
      event_id: null,
    },
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/unsubscribe/tok",
    subject: "Hello",
    brand_name: "Coastline Co",
  });
  assertStringIncludes(result.html, CANONICAL);
  assertNoDeadOrWwwLogo(result.html);
});

Deno.test("T4b: brand-invite build default path emits the canonical URL", () => {
  Deno.env.delete("MINGLA_LOGO_URL");
  const email = buildInviteEmail({
    inviteeName: "Jamie",
    inviteeEmail: "jamie@example.com",
    brandName: "Coastline Co",
    inviterName: "Seth",
    role: "manager",
    acceptUrl: "https://business.usemingla.com/accept-invite?token=tok",
    from: "Mingla <hello@usemingla.com>",
  });
  assertStringIncludes(email.html, CANONICAL);
  assertNoDeadOrWwwLogo(email.html);
});

Deno.test("T5: both PDF entrypoints bind their logo through minglaLogoUrl() — never null", () => {
  // The entrypoints call serve() at module load, so this asserts the binding
  // at source level PLUS the shared resolver's unset-env value (the exact
  // expression those bindings evaluate). Runtime handler-level coverage is
  // the tester's reserved adversarial surface.
  Deno.env.delete("MINGLA_LOGO_URL");
  assertEquals(minglaLogoUrl(), CANONICAL);
  for (
    const entrypoint of [
      "../../ticket-confirmation-dispatch/index.ts",
      "../../ticket-pdf-fetch/index.ts",
    ]
  ) {
    const src = Deno.readTextFileSync(
      new URL(entrypoint, import.meta.url),
    );
    assertStringIncludes(src, "const MINGLA_LOGO_URL = minglaLogoUrl();");
    assert(
      !src.includes('Deno.env.get("MINGLA_LOGO_URL") ?? null'),
      `${entrypoint} regressed to the nullable env read`,
    );
  }
});
