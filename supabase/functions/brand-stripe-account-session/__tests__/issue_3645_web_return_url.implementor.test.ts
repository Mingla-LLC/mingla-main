/**
 * #3645 — brand-stripe-account-session accepts a Host-web HTTPS return_url
 * (and refuses foreign origins). Source-level contract; no live Stripe call.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("#3645 account-session: return_url validation exists", () => {
  assertStringIncludes(SOURCE, "function isValidReturnUrl");
  assertStringIncludes(SOURCE, "return_url_invalid_scheme");
  assertStringIncludes(SOURCE, 's.startsWith("mingla-business://")');
  assertStringIncludes(SOURCE, "s.startsWith(`${businessWebOrigin}/`)");
});

Deno.test("#3645 account-session: requested return_url is used when valid", () => {
  assertStringIncludes(SOURCE, "requestedReturn");
  assertStringIncludes(SOURCE, "returnTo = requestedReturn");
  assert(
    !SOURCE.includes('returnTo: "mingla-business://onboarding-complete"'),
    "must not hardcode deep link inside buildTargetUrl call",
  );
  assertEquals(SOURCE.includes("returnTo,"), true);
});

Deno.test("#3645 account-session: native default remains when return_url omitted", () => {
  assertStringIncludes(
    SOURCE,
    'const NATIVE_RETURN_DEEP_LINK = "mingla-business://onboarding-complete"',
  );
  assertStringIncludes(SOURCE, "let returnTo: string = NATIVE_RETURN_DEEP_LINK");
});
