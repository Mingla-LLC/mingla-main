import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createAccountSession,
  createRecipientAccount,
} from "../stripeBlueprintClient.ts";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function hasCollectionOptions(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCollectionOptions);
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).includes("collection_options") ||
    Object.values(record).some(hasCollectionOptions);
}

function withStripeContractFetch(
  fn: (captured: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("STRIPE_RAK_ONBOARD");
  Deno.env.set("STRIPE_RAK_ONBOARD", "rk_test_contract_mock");
  globalThis.fetch = ((url, init) => {
    const body = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"));
    captured.push({ url: String(url), body });

    if (String(url).endsWith("/v2/core/accounts")) {
      const feesCollector = ((body.defaults as Record<string, unknown>)
        ?.responsibilities as Record<string, unknown>)?.fees_collector;
      if (feesCollector !== "application" && feesCollector !== "stripe") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                param: "defaults.responsibilities.fees_collector",
                code: "parameter_unknown",
                message:
                  "Unrecognized enum value 'account', valid values are: application, stripe",
              },
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "acct_contract",
            livemode: false,
            dashboard: body.dashboard,
            defaults: body.defaults,
          }),
          { status: 200 },
        ),
      );
    }

    if (String(url).endsWith("/v1/account_sessions")) {
      if (hasCollectionOptions(body.components)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                param:
                  "components[account_onboarding][features][collection_options]",
                code: "parameter_unknown",
                message:
                  "Received unknown parameter: components[account_onboarding][features][collection_options]",
              },
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            client_secret: "acs_test_contract_secret",
            expires_at: 1_800_000_000,
            components: body.components,
            account: body.account,
          }),
          { status: 200 },
        ),
      );
    }

    return Promise.resolve(new Response("{}", { status: 404 }));
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

Deno.test("ORCH-0954 amendment — Accounts v2 controller and Account Session payload match Stripe-documented schema", async () => {
  await withStripeContractFetch(async (captured) => {
    const account = await createRecipientAccount({
      displayName: "ORCH-0954 contract",
      contactEmail: "sethogieva+orch0954-contract@usemingla.com",
      country: "US",
      idempotencyKey: "orch-0954:contract:account",
    });
    const session = await createAccountSession({
      accountId: "acct_contract",
      components: {
        account_onboarding: {
          enabled: true,
          features: {
            external_account_collection: true,
          },
        },
      },
      idempotencyKey: "orch-0954:contract:session",
    });

    assertEquals(account.id, "acct_contract");
    assertEquals(account.livemode, false);
    assertEquals(session.client_secret, "acs_test_contract_secret");
    assertEquals(captured.length, 2);

    const accountBody = captured[0].body;
    assertEquals(accountBody.dashboard, "none");
    assertEquals(accountBody.defaults, {
      responsibilities: {
        losses_collector: "stripe",
        fees_collector: "stripe",
      },
    });
    assert(
      !hasCollectionOptions(captured[1].body),
      "Account Session create payload must not send server-side collection_options",
    );
  });

  for (
    const edgeFunctionPath of [
      new URL("../../brand-stripe-onboard/index.ts", import.meta.url),
      new URL("../../brand-stripe-account-session/index.ts", import.meta.url),
    ]
  ) {
    const source = await Deno.readTextFile(edgeFunctionPath);
    assert(
      !source.includes("collection_options"),
      `${edgeFunctionPath.pathname} must not send server-side collection_options`,
    );
  }
});
