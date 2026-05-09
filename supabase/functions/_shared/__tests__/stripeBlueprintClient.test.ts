import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createRecipientAccount,
  createRecipientAccountLink,
  STRIPE_BLUEPRINT_API_VERSION,
} from "../stripeBlueprintClient.ts";

interface CapturedRequest {
  url: string;
  init?: RequestInit;
  body: Record<string, unknown>;
}

function withStripeFetch(
  fn: (captured: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("STRIPE_RAK_ONBOARD");
  Deno.env.set("STRIPE_RAK_ONBOARD", "rk_test_mock");
  globalThis.fetch = ((url, init) => {
    const requestInit = init as { body?: unknown };
    captured.push({
      url: String(url),
      init,
      body: JSON.parse(String(requestInit?.body ?? "{}")),
    });
    const responseBody = String(url).endsWith("/account_links")
      ? { id: "link_123", url: "https://connect.stripe.com/setup/mock" }
      : { id: "acct_123" };
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), { status: 200 }),
    );
  }) as typeof fetch;

  return fn(captured).finally(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      Deno.env.delete("STRIPE_RAK_ONBOARD");
    } else {
      Deno.env.set("STRIPE_RAK_ONBOARD", originalKey);
    }
  });
}

Deno.test("createRecipientAccount posts required Accounts v2 payload with blueprint version header", async () => {
  await withStripeFetch(async (captured) => {
    await createRecipientAccount({
      displayName: "Mingla Test Brand",
      contactEmail: "operator@example.com",
      country: "GB",
      idempotencyKey: "brand:onboard_create:test",
    });

    assertEquals(captured.length, 1);
    assertEquals(captured[0].url, "https://api.stripe.com/v2/core/accounts");
    assertEquals(captured[0].init?.method, "POST");
    const headers = new Headers(captured[0].init?.headers);
    assertEquals(headers.get("Stripe-Version"), STRIPE_BLUEPRINT_API_VERSION);
    assertEquals(headers.get("Idempotency-Key"), "brand:onboard_create:test");

    const body = captured[0].body;
    assertEquals(body.display_name, "Mingla Test Brand");
    assertEquals(body.contact_email, "operator@example.com");
    assertEquals(body.dashboard, "express");
    assertEquals((body.identity as Record<string, unknown>).country, "GB");
    const configuration = body.configuration as Record<string, unknown>;
    assertEquals(
      ((configuration.recipient as Record<string, unknown>)
        .capabilities as Record<string, unknown>).stripe_balance,
      { stripe_transfers: { requested: true } },
    );
    assertEquals(
      ((configuration.merchant as Record<string, unknown>)
        .capabilities as Record<string, unknown>).card_payments,
      { requested: true },
    );
    assertEquals(body.defaults, {
      responsibilities: {
        losses_collector: "application",
        fees_collector: "application",
      },
    });
    assert(
      (body.include as string[]).includes("configuration.recipient"),
    );
  });
});

Deno.test("createRecipientAccountLink posts hosted account onboarding payload with blueprint version header", async () => {
  await withStripeFetch(async (captured) => {
    const link = await createRecipientAccountLink({
      accountId: "acct_123",
      refreshUrl:
        "https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete&stripe_onboarding_refresh=1",
      returnUrl:
        "https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete",
      idempotencyKey: "brand:onboard_account_link:test",
    });

    assertEquals(captured.length, 1);
    assertEquals(
      captured[0].url,
      "https://api.stripe.com/v2/core/account_links",
    );
    const headers = new Headers(captured[0].init?.headers);
    assertEquals(headers.get("Stripe-Version"), STRIPE_BLUEPRINT_API_VERSION);
    assertEquals(
      headers.get("Idempotency-Key"),
      "brand:onboard_account_link:test",
    );

    const body = captured[0].body;
    assertEquals(body.account, "acct_123");
    const useCase = body.use_case as Record<string, unknown>;
    assertEquals(useCase.type, "account_onboarding");
    const onboarding = useCase.account_onboarding as Record<string, unknown>;
    assertEquals(onboarding.configurations, ["recipient", "merchant"]);
    assertEquals(
      onboarding.return_url,
      "https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete",
    );
    assertEquals(
      onboarding.refresh_url,
      "https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete&stripe_onboarding_refresh=1",
    );
    assertEquals(link.url, "https://connect.stripe.com/setup/mock");
  });
});
