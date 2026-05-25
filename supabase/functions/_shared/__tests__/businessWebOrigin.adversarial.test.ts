import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveBusinessWebOrigin } from "../businessWebOrigin.ts";

const configuredOrigin = "https://business.usemingla.com";
const rejected = {
  ok: false,
  detail: "business_web_origin_override_unrecognized",
} as const;

Deno.test("ORCH-0954 adversarial - rejects unsafe business_web_origin_override values", () => {
  for (
    const override of [
      42,
      { origin: "https://mingla-business-good.vercel.app" },
      "https://evil.example.com",
      "https://evil.vercel.app",
      "http://mingla-business-9cd9mn2im-seth-ogievas-projects.vercel.app",
      "https://mingla-business_9cd9mn2im.vercel.app",
      "https://mingla-business-9cd9mn2im.vercel.app.evil.com",
      "",
    ]
  ) {
    assertEquals(
      resolveBusinessWebOrigin({ configuredOrigin, override }),
      rejected,
      `override must reject: ${JSON.stringify(override)}`,
    );
  }
});

Deno.test("ORCH-0954 adversarial - accepts only production and Mingla business preview origins", () => {
  assertEquals(
    resolveBusinessWebOrigin({
      configuredOrigin,
      override: undefined,
    }),
    { ok: true, origin: configuredOrigin },
  );
  assertEquals(
    resolveBusinessWebOrigin({
      configuredOrigin,
      override: configuredOrigin,
    }),
    { ok: true, origin: configuredOrigin },
  );
  assertEquals(
    resolveBusinessWebOrigin({
      configuredOrigin,
      override: "https://mingla-business-9cd9mn2im-seth-ogievas-projects.vercel.app",
    }),
    {
      ok: true,
      origin:
        "https://mingla-business-9cd9mn2im-seth-ogievas-projects.vercel.app",
    },
  );
});
