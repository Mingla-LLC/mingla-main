import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderContactCodeEmail } from "../contactCodeEmail.ts";
import { DEFAULT_MINGLA_LOGO_URL } from "../../brandAssets.ts";

const INPUT = {
  code: "042731",
  supportEmail: "support@usemingla.com",
  // [TEST-MOD-APPROVED #4063] Use the canonical brand asset rather than a dead
  // legacy logo URL in the renderer fixture.
  logoUrl: DEFAULT_MINGLA_LOGO_URL,
  footerAddress: "Mingla, Raleigh, NC",
  sender: { name: "Mingla", address: "noreply@usemingla.com" },
};

Deno.test(
  "#4063 renders the approved contact-code copy in the brand shell",
  () => {
    const result = renderContactCodeEmail(INPUT);
    assertEquals(result.subject, "Your Mingla code: 042731");
    assertEquals(
      result.preheader,
      "Use it in the Mingla app. It works for 10 minutes.",
    );
    assertEquals(
      result.text,
      [
        "Your code",
        "",
        "042731",
        "",
        "Enter it in the Mingla app. It works for 10 minutes.",
        "",
        "Didn't ask for this? You can ignore this email.",
      ].join("\n"),
    );
    assertEquals(result.from, INPUT.sender);
    assertStringIncludes(result.html, "<!doctype html>");
    assertStringIncludes(result.html, ">Your code</h1>");
    assertStringIncludes(result.html, ">042731</p>");
    assertStringIncludes(result.html, "Need help?");
    assert(
      !result.html.includes("background:#C4471A"),
      "verification email must not render a CTA button",
    );
  },
);

Deno.test("#4063 refuses malformed verification codes before rendering", () => {
  assertThrows(
    () => renderContactCodeEmail({ ...INPUT, code: "12345<script>" }),
    Error,
    "contact_code_email_invalid_code",
  );
});
