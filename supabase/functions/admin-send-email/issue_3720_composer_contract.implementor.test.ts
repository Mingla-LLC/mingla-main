import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  documentPlainText,
  fallbackPersonalization,
  normalizeAudience,
  personalizeDocument,
  personalizeText,
  validateDocument,
} from "./model.ts";
import { sanitizeAdminRichText } from "../_shared/email/genericBody.ts";

Deno.test("#3720 personalization covers the approved tokens with safe fallbacks", () => {
  const profile = { email: "member@example.com" };
  const values = fallbackPersonalization(profile);
  assertEquals(values.first_name, "Mingla");
  assertEquals(values.display_name, "Mingla member");
  assertEquals(
    personalizeText(
      "Hi {first_name}, {username} joined {joined_date}",
      profile,
    ),
    "Hi Mingla, member joined recently",
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
});

Deno.test("#3720 rich text renderer strips executable markup and unsafe links", () => {
  const clean = sanitizeAdminRichText(
    '<p onclick="bad()">Safe <strong>copy</strong><script>alert(1)</script><a href="javascript:bad()">link</a></p>',
  );
  assertEquals(clean.includes("onclick"), false);
  assertEquals(clean.includes("script"), false);
  assertEquals(clean.includes("javascript:"), false);
  assertStringIncludes(clean, "<strong>copy</strong>");
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
});
