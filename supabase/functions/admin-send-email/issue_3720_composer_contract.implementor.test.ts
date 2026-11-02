import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assertSupportedPersonalization,
  documentPlainText,
  fallbackPersonalization,
  normalizeAudience,
  personalizeDocument,
  personalizeText,
  snapshotAudience,
  validateDocument,
} from "./model.ts";
import { sanitizeAdminRichText } from "../_shared/email/genericBody.ts";

Deno.test("#3720 personalization covers the approved tokens with safe fallbacks", () => {
  const profile = { email: "member@example.com" };
  const values = fallbackPersonalization(profile);
  assertEquals(values.first_name, "there");
  assertEquals(values.display_name, "Mingla member");
  assertEquals(values.username, "Mingla member");
  assertEquals(values.country, "your area");
  assertEquals(values.language, "English");
  assertEquals(
    personalizeText(
      "Hi {first_name}, {username} joined {joined_date}",
      profile,
    ),
    "Hi there, Mingla member joined recently",
  );
  const [block] = personalizeDocument(
    [{ type: "rich_text", html: "<p>{display_name} in {country}</p>" }],
    profile,
  );
  assertEquals(block.type, "rich_text");
  if (block.type === "rich_text") {
    assertEquals(block.html, "<p>Mingla member in your area</p>");
  }
});

Deno.test("#3720 document validator accepts structured content and rejects unsafe media", () => {
  const document = validateDocument([
    { type: "rich_text", html: "<p>Hello</p>" },
    { type: "divider" },
    {
      type: "image",
      url: "https://example.com/image.gif",
      alt: "People dancing",
    },
  ]);
  assertEquals(
    documentPlainText(document),
    "Hello\n\n────────\n\nPeople dancing",
  );
  assertThrows(
    () =>
      validateDocument([{
        type: "image",
        url: "javascript:alert(1)",
        alt: "Unsafe",
      }]),
    Error,
    "email_image_url_invalid",
  );
  assertThrows(
    () =>
      validateDocument([{
        type: "image",
        url: "https://example.com/a.png",
        alt: "",
      }]),
    Error,
    "email_image_invalid",
  );
  assertThrows(
    () =>
      validateDocument([{
        type: "image",
        url: "not a url",
        alt: "Broken",
      }]),
    Error,
    "email_image_url_invalid",
  );
  const [sanitized] = validateDocument([{
    type: "rich_text",
    html: "<p>Safe<script>bad()</script></p>",
  }]);
  assertEquals(sanitized.type, "rich_text");
  if (sanitized.type === "rich_text") {
    assertEquals(sanitized.html, "<p>Safe</p>");
  }
  assertThrows(
    () =>
      assertSupportedPersonalization("Hi {unknown}", [
        { type: "rich_text", html: "<p>Safe</p>" },
      ]),
    Error,
    "personalization_token_unsupported:unknown",
  );
});

Deno.test("#3720 rich text renderer strips executable markup and unsafe links", () => {
  const clean = sanitizeAdminRichText(
    '<p onclick="bad()">Safe <strong>copy</strong><script>alert(1)</script><a href="javascript:bad()">link</a></p>',
  );
  assertEquals(clean.includes("onclick"), false);
  assertEquals(clean.includes("script"), false);
  assertEquals(clean.includes("javascript:"), false);
  assertStringIncludes(clean, "<strong>copy</strong>");
  assertStringIncludes(
    sanitizeAdminRichText(
      '<p><a href="mailto:hello@usemingla.com">Email us</a></p>',
    ),
    'href="mailto:hello@usemingla.com"',
  );
});

Deno.test("#3720 audience normalizer exposes All for every optional segment filter", () => {
  assertEquals(normalizeAudience({ mode: "everyone" }), {
    mode: "everyone",
    filters: {},
  });
  assertEquals(normalizeAudience({ mode: "segment", filters: {} }), {
    mode: "segment",
    filters: {
      userType: "all",
      // #4226: ticket-buyer filters default to All too.
      appStatus: "all",
      city: "all",
      boughtTickets: "all",
      brandId: "all",
      country: "all",
      onboarding: "all",
      accountStatus: "all",
      emailStatus: "all",
      language: "all",
      beta: "all",
      joinedFrom: undefined,
      joinedTo: undefined,
    },
  });
  assertThrows(
    () =>
      normalizeAudience({ mode: "segment", filters: { userType: "admin" } }),
    Error,
    "audience_filter_invalid:userType",
  );
  assertThrows(
    () =>
      normalizeAudience({
        mode: "segment",
        filters: { joinedFrom: "2026-10-20", joinedTo: "2026-10-10" },
      }),
    Error,
    "audience_filter_invalid:joined_range",
  );
  assertEquals(
    normalizeAudience({
      mode: "person",
      profileId: "123e4567-e89b-42d3-a456-426614174000",
    }),
    {
      mode: "person",
      profileId: "123e4567-e89b-42d3-a456-426614174000",
    },
  );
  // #4226: a ticket buyer with no account is addressed by email. Only people
  // on the admin people list are loaded for it (an outside address matches no
  // one and the send is refused with audience_has_no_eligible_recipients);
  // an address that is not an email still fails closed here.
  assertEquals(
    normalizeAudience({ mode: "person", email: " Outside@Example.com " }),
    { mode: "person", email: "outside@example.com" },
  );
  assertThrows(
    () => normalizeAudience({ mode: "person", email: "not-an-email" }),
    Error,
    "recipient_email_invalid",
  );
  assertThrows(
    () => normalizeAudience({ mode: "person" }),
    Error,
    "recipient_profile_invalid",
  );
});

Deno.test("#3720 recipient snapshot reports every exclusion and queues one normalized address", () => {
  const snapshot = snapshotAudience([
    { id: "one", email: " MEMBER@example.com " },
    { id: "duplicate", email: "member@example.com" },
    { id: "missing", email: null },
    { id: "invalid", email: "not-an-email" },
    { id: "suppressed", email: "optedout@example.com" },
  ], new Set(["optedout@example.com"]));

  assertEquals(snapshot.matched, 5);
  assertEquals(snapshot.willReceive, 1);
  assertEquals(snapshot.skippedOptOut, 1);
  assertEquals(snapshot.noContact, 2);
  assertEquals(snapshot.duplicate, 1);
  assertEquals(
    snapshot.deliveries.map((delivery) => ({
      profile_id: delivery.profile_id,
      recipient_email: delivery.recipient_email,
      status: delivery.status,
    })),
    [
      {
        profile_id: "one",
        recipient_email: "member@example.com",
        status: "pending",
      },
      {
        profile_id: "suppressed",
        recipient_email: "optedout@example.com",
        status: "skipped_opt_out",
      },
    ],
  );
});
