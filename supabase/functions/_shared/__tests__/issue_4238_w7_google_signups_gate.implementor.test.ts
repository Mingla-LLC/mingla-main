// MINGLA-INVARIANT: I-4238-GOOGLE-SIGNUPS-NEVER-SILENT-VISITS | issue #4238 | a sign-ups Host plan (free event or RSVP page) that includes Google is refused with host_ad_google_needs_setup unless Google is ready for sign-ups (its own free_signup action AND the Z-4 docs check); the visits acknowledgement never applies to Google, and no other kind stands in for free_signup.
/**
 * #4238 W7: Google for free-event sign-ups mirrors the W4b §6 sales gate.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateHostOptimization } from "../adHostGoal.ts";
import {
  GOOGLE_HOST_SIGNUPS_CONFIRMED,
  googleSignupActionResource,
  googleSignupsReadiness,
  HOST_SIGNUPS_PLATFORMS,
  signupsReadiness,
} from "../adSalesReadiness.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const rsvpPage = { page_type: "rsvp", result_kind: "rsvp" };
const google = (extra: Record<string, unknown>) =>
  ({ id: "g1", platform: "google", extra }) as unknown as AdConnectionRow;
const FREE = "customers/1/conversionActions/FREE";

Deno.test("W7 no free_signup action → Google sign-ups needs_setup", async () => {
  assertEquals(googleSignupsReadiness(google({}), true), {
    ready: false,
    reason: "needs_setup",
  });
  assertEquals((await signupsReadiness(google({}))).reason, "needs_setup");
  assertEquals(HOST_SIGNUPS_PLATFORMS.includes("google"), true);
});

Deno.test("W7 adversarial: the purchase action or the alias never stands in for free_signup", () => {
  const conn = google({
    conversion_action_resource: "customers/1/conversionActions/PURCHASE",
    conversion_actions: {
      purchase: "customers/1/conversionActions/PURCHASE",
      host_lead: "customers/1/conversionActions/LEAD",
    },
  });
  assertEquals(googleSignupActionResource(conn), null);
  assertEquals(googleSignupsReadiness(conn, true).reason, "needs_setup");
});

Deno.test("W7 the action alone is not enough until Z-4; with both it is ready", async () => {
  const conn = google({ conversion_actions: { free_signup: FREE } });
  assertEquals(googleSignupActionResource(conn), FREE);
  assertEquals(GOOGLE_HOST_SIGNUPS_CONFIRMED, false);
  assertEquals(googleSignupsReadiness(conn).reason, "needs_setup");
  assertEquals((await signupsReadiness(conn)).ready, false);
  assertEquals(googleSignupsReadiness(conn, true), {
    ready: true,
    reason: "ready",
  });
});

Deno.test("W7 a sign-ups plan with Google not ready is refused, even acknowledged", () => {
  const result = validateHostOptimization(
    { meta: "signups", google: "visits" },
    ["meta", "google"],
    rsvpPage,
    {
      ready: { meta: { signups: true } },
      requestedGoal: "signups",
      acknowledgedFallback: ["google"],
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.detail, "host_ad_google_needs_setup");
    assertEquals(result.platforms, ["google"]);
  }
});

Deno.test("W7 a sign-ups plan without Google, and a visits plan with Google, are unchanged", () => {
  assertEquals(
    validateHostOptimization({ meta: "signups" }, ["meta"], rsvpPage, {
      ready: { meta: { signups: true } },
      requestedGoal: "signups",
    }).ok,
    true,
  );
  assertEquals(
    validateHostOptimization({ google: "visits" }, ["google"], rsvpPage, {
      requestedGoal: "visits",
    }).ok,
    true,
  );
});
