/**
 * Issue #3258 — the platform prefills the connected account's own public
 * website at CREATE time, and does it WITHOUT dropping the managed-risk
 * responsibilities off the same `defaults` object.
 *
 * WHY THIS FILE EXISTS
 *
 * Stripe fetches `business_profile.url` before it will enable the
 * `card_payments` capability. Mingla sent no business profile at all, so the
 * seller was asked for a website inside Connect onboarding and typed whatever
 * they had; for the brand this issue was filed over that was a domain whose
 * ports 80 and 443 are closed, so `card_payments` sat at `pending` forever
 * with `disabled_reason = requirements.pending_verification` and
 * `pending_verification: ["business_profile.url"]`, and the brand could not
 * take money.
 *
 * THE TRAP THIS FILE GUARDS
 *
 * `STRIPE_MANAGED_RISK_CONTROLLER` supplies the ENTIRE `defaults` key
 * (`defaults.responsibilities.{losses_collector,fees_collector}`) and reaches
 * the request body through a spread. A sibling `defaults: { profile: ... }`
 * written next to that spread silently clobbers `responsibilities` — which on
 * a live marketplace changes who absorbs losses and who collects fees, with no
 * error anywhere. Every assertion below that names `business_url` also names
 * `losses_collector` and `fees_collector` IN THE SAME BODY, so a regression
 * that merges wrongly cannot pass by getting only the new half right.
 *
 * Field paths cited from https://docs.stripe.com/api/v2/core/accounts/create
 * (`defaults.profile.business_url`, `defaults.profile.product_description`)
 * and the prefill guidance from https://docs.stripe.com/connect/hosted-onboarding.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildRecipientAccountDefaults,
  createRecipientAccount,
  STRIPE_MANAGED_RISK_CONTROLLER,
} from "../stripeBlueprintClient.ts";
import {
  brandPublicPath,
  buildBrandPublicUrl,
  resolveBrandPublicUrl,
} from "../brandPublicUrl.ts";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Captures the real wire body. The fetch stub parses what
 * `stripeBlueprintRequest` actually serialized — not a hand-built fixture that
 * could agree with a broken implementation.
 */
function withStripeFetch(
  fn: (captured: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  const originalMode = Deno.env.get("MINGLA_STRIPE_MODE");
  const originalKey = Deno.env.get("STRIPE_RAK_ONBOARD_TEST");
  Deno.env.set("MINGLA_STRIPE_MODE", "test");
  Deno.env.set("STRIPE_RAK_ONBOARD_TEST", "rk_test_issue3258");
  globalThis.fetch = ((url: unknown, init: { body?: unknown }) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "acct_issue3258" }), { status: 200 }),
    );
  }) as typeof fetch;

  return fn(captured).finally(() => {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) Deno.env.delete("MINGLA_STRIPE_MODE");
    else Deno.env.set("MINGLA_STRIPE_MODE", originalMode);
    if (originalKey === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
    else Deno.env.set("STRIPE_RAK_ONBOARD_TEST", originalKey);
  });
}

const defaultsOf = (body: Record<string, unknown>): Record<string, unknown> =>
  body.defaults as Record<string, unknown>;

const profileOf = (body: Record<string, unknown>): Record<string, unknown> =>
  defaultsOf(body).profile as Record<string, unknown>;

const responsibilitiesOf = (
  body: Record<string, unknown>,
): Record<string, unknown> =>
  defaultsOf(body).responsibilities as Record<string, unknown>;

Deno.test("#3258 — /v2/core/accounts carries defaults.profile.business_url AND keeps defaults.responsibilities", async () => {
  await withStripeFetch(async (captured) => {
    const expectedUrl = buildBrandPublicUrl({
      origin: "https://host.usemingla.com",
      slug: "lanternroom",
    });
    assertEquals(expectedUrl, "https://host.usemingla.com/b/lanternroom");

    await createRecipientAccount({
      displayName: "Lantern Room",
      contactEmail: "operator@example.com",
      country: "US",
      businessUrl: expectedUrl,
      productDescription: null,
      idempotencyKey: "issue3258:create",
    });

    assertEquals(captured.length, 1);
    assertEquals(captured[0].url, "https://api.stripe.com/v2/core/accounts");
    const body = captured[0].body;

    // The new half — the whole point of the change.
    assertEquals(profileOf(body).business_url, expectedUrl);

    // The half a bad merge silently destroys. SAME body, SAME request.
    assertEquals(responsibilitiesOf(body).losses_collector, "stripe");
    assertEquals(responsibilitiesOf(body).fees_collector, "stripe");
    // `dashboard` rides the same spread and must survive too.
    assertEquals(body.dashboard, "none");

    // Belt and braces: the merged object must be a SUPERSET of the controller
    // constant's own defaults, so this stays true if the constant ever grows.
    for (
      const [key, value] of Object.entries(
        STRIPE_MANAGED_RISK_CONTROLLER.defaults,
      )
    ) {
      assertEquals(defaultsOf(body)[key], value);
    }

    // `include` must ask Stripe to echo `defaults` back, or the prefill is
    // unverifiable from the create response.
    assert((body.include as string[]).includes("defaults"));

    // Stripe rejects a bare host with `invalid_url_format`.
    assert(String(profileOf(body).business_url).startsWith("https://"));
  });
});

Deno.test("#3258 — a blank slug falls back to product_description, sends NO business_url, and never sets both to one string", async () => {
  await withStripeFetch(async (captured) => {
    // The real guard the edge function uses — a blank slug yields no URL.
    const noUrl = resolveBrandPublicUrl({
      origin: "https://host.usemingla.com",
      slug: "   ",
    });
    assertEquals(noUrl, null);

    const description =
      "Sells tickets and bookings for its own events. Guests pay by card online at booking.";
    await createRecipientAccount({
      displayName: "Slugless Brand",
      contactEmail: "operator@example.com",
      country: "US",
      businessUrl: noUrl,
      productDescription: description,
      idempotencyKey: "issue3258:fallback",
    });

    const body = captured[0].body;
    assertEquals(profileOf(body).product_description, description);
    // Stripe answers `invalid_product_description_url_match` when both carry
    // the same string, so the URL key must be ABSENT, not empty.
    assertEquals("business_url" in profileOf(body), false);
    assertNotEquals(
      profileOf(body).product_description,
      profileOf(body).business_url,
    );
    // And the responsibilities still survive on the fallback path.
    assertEquals(responsibilitiesOf(body).losses_collector, "stripe");
    assertEquals(responsibilitiesOf(body).fees_collector, "stripe");
  });
});

Deno.test("#3258 — a caller supplying neither sends a byte-identical pre-#3258 body (partner-stripe-onboard)", async () => {
  await withStripeFetch(async (captured) => {
    // EXACTLY the argument shape partner-stripe-onboard passes.
    await createRecipientAccount({
      displayName: "Mingla partner",
      contactEmail: "partner@example.com",
      country: "US",
      idempotencyKey: "issue3258:partner",
    });

    const body = captured[0].body;
    // Deep equality, not a subset check: `defaults` must carry NOTHING new.
    assertEquals(body.defaults, {
      responsibilities: {
        losses_collector: "stripe",
        fees_collector: "stripe",
      },
    });
    assertEquals("profile" in defaultsOf(body), false);
    assertEquals(body.dashboard, "none");
  });
});

Deno.test("#3258 — the URL always wins over a description; neither present leaves defaults untouched", () => {
  // Both supplied: the URL wins and the description is not sent, so a body
  // carrying the same string twice is unrepresentable.
  const both = buildRecipientAccountDefaults({
    businessUrl: "https://host.usemingla.com/b/lanternroom",
    productDescription: "https://host.usemingla.com/b/lanternroom",
  });
  const bothProfile = both.profile as Record<string, unknown>;
  assertEquals(
    bothProfile.business_url,
    "https://host.usemingla.com/b/lanternroom",
  );
  assertEquals("product_description" in bothProfile, false);

  // Whitespace-only is treated as absent, never as an empty URL.
  const blank = buildRecipientAccountDefaults({
    businessUrl: "   ",
    productDescription: null,
  });
  assertEquals("profile" in blank, false);
  assertEquals(blank, {
    responsibilities: { losses_collector: "stripe", fees_collector: "stripe" },
  });
});

Deno.test("#3258 — the brand public page is /b/{slug} on the resolved origin, slug-encoded", () => {
  assertEquals(brandPublicPath("lanternroom"), "/b/lanternroom");
  assertEquals(
    buildBrandPublicUrl({
      origin: "https://host.usemingla.com///",
      slug: " lanternroom ",
    }),
    "https://host.usemingla.com/b/lanternroom",
  );
  // The canonical brand page is /b/{slug}, NOT /{slug}.
  assertEquals(
    buildBrandPublicUrl({
      origin: "https://host.usemingla.com",
      slug: "lanternroom",
    }).endsWith("/b/lanternroom"),
    true,
  );
  // A missing origin yields null rather than a half-built "/b/slug".
  assertEquals(resolveBrandPublicUrl({ origin: "", slug: "x" }), null);
  assertEquals(resolveBrandPublicUrl({ origin: null, slug: "x" }), null);
  assertEquals(
    resolveBrandPublicUrl({ origin: "https://h.example", slug: null }),
    null,
  );
});

Deno.test("#3258 — brand-stripe-onboard reads the slug and hands Stripe the brand page; partner-stripe-onboard does neither", async () => {
  const brandSource = await Deno.readTextFile(
    new URL("../../brand-stripe-onboard/index.ts", import.meta.url),
  );
  // The slug has to be SELECTED before it can be sent.
  assert(
    /\.select\("name, contact_email, default_currency, slug"\)/.test(
      brandSource,
    ),
    "brand-stripe-onboard must select brands.slug",
  );
  assert(
    brandSource.includes("resolveBrandPublicUrl({"),
    "brand-stripe-onboard must build the brand page through the shared helper",
  );
  assert(
    brandSource.includes("businessUrl: brandPublicPageUrl"),
    "brand-stripe-onboard must pass the brand page as the business URL",
  );
  assert(
    brandSource.includes("BRAND_STRIPE_FALLBACK_PRODUCT_DESCRIPTION"),
    "brand-stripe-onboard must keep the no-page fallback",
  );

  const partnerSource = await Deno.readTextFile(
    new URL("../../partner-stripe-onboard/index.ts", import.meta.url),
  );
  // A partner has no brand record and therefore no /b/{slug} page; inventing
  // one would point Stripe at a page that is not theirs.
  assertEquals(partnerSource.includes("businessUrl"), false);
  assertEquals(partnerSource.includes("productDescription"), false);
});

Deno.test("#3258 — brand-stripe-refresh-status returns the URL the ACCOUNT reports, not the one the app guesses", async () => {
  const source = await Deno.readTextFile(
    new URL("../../brand-stripe-refresh-status/index.ts", import.meta.url),
  );
  assert(
    source.includes("business_profile_url: readBusinessProfileUrl(account)"),
    "the refreshed response must carry the account's own business_profile.url",
  );
  assert(
    source.includes("account.business_profile?.url"),
    "the value must be read off the retrieved Stripe account object",
  );
  // Present on BOTH response branches, so an absent field never has to be
  // told apart from "this brand has no account".
  assertEquals(
    (source.match(/business_profile_url:/g) ?? []).length,
    2,
  );
});
