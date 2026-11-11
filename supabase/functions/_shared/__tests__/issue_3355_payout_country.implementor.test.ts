// Issue #3355 P7 (Phase 7 certification fix) — Ari's payout-country pick is
// the Host chooser's pick (BrandPayoutCountryField), made as the caller.
//
// MINGLA-INVARIANT: I-ARI-PAYOUT-COUNTRY-HOST-PARITY | issue #3355 | Ari sets a payout country only through the confirmed set_brand_payout_country, making the Host chooser's write as the caller. Since #4389 that is ONE write, biz_set_brand_payout_country (the derive trigger sets currency, rail and payment country); Nigeria then stamps the hold through brand-paystack-onboard select_provider. A locked country, a forbidden caller or an unsupported country is refused and never reported as done.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_payout_country.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import {
  ARI_10X_TOOLS,
  PAYOUT_COUNTRIES,
  payoutRailFor,
} from "../agentAri10xTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { WRITE_TOOL_OWNER_COPY } from "../ariPresentation/toolLabels.ts";
import { WRITE_TOOL_OWNER_COPY as HOST_COPY } from "../../../../mingla-business/src/components/ari/toolProposalCopy.ts";
import { STRIPE_SUPPORTED_COUNTRIES } from "../../../../mingla-business/src/constants/stripeSupportedCountries.ts";
import { toolErrorHttpStatus } from "../../agent-confirm-action/executionOutcome.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Brand = {
  id: string;
  name: string;
  default_currency: string | null;
  payment_provider: string | null;
  payout_country: string | null;
};

/** The caller's own Supabase client: the #4389 RPC and the Paystack edge, logged. */
function callerClient(brand: Brand, opts: { refuse?: string } = {}) {
  const log: string[] = [];
  const client: Any = {
    rpc(name: string, params: Record<string, unknown>) {
      log.push(`rpc ${name} ${params.p_country}`);
      if (opts.refuse) return Promise.resolve({ data: null, error: { message: opts.refuse } });
      const country = String(params.p_country);
      const rail = payoutRailFor(country)!;
      Object.assign(brand, {
        payout_country: country,
        default_currency: rail.currency,
        payment_provider: rail.provider,
      });
      return Promise.resolve({
        data: { payout_country: country, default_currency: rail.currency, payment_provider: rail.provider },
        error: null,
      });
    },
    from() {
      throw new Error("#4389: no direct brands table write");
    },
    functions: {
      invoke(name: string, init: { body: Record<string, unknown> }) {
        log.push(`invoke ${name} ${init.body.action}`);
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
  return { client, log };
}

// The raw definition (AGENT_TOOLS wraps it with the caller's role check).
const tool = ARI_10X_TOOLS.find((t) => t.name === "set_brand_payout_country")!;

function freshBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: BRAND,
    name: "Ari Flow Demo",
    default_currency: null,
    payment_provider: null,
    payout_country: null,
    ...overrides,
  };
}

Deno.test("payout country: the United Kingdom is one write that sets GB and GBP", async () => {
  const brand = freshBrand();
  const { client, log } = callerClient(brand);
  const result = await tool.executor(
    { brand_id: BRAND, country_code: "GB" },
    client,
    "user",
    {},
  ) as Any;
  assertEquals(log, ["rpc biz_set_brand_payout_country GB"]);
  assertEquals(brand.default_currency, "GBP");
  assertEquals(result.currency, "GBP");
  assertEquals(result.country_name, "United Kingdom");
});

Deno.test("payout country: Nigeria is the same write, then the hold stamp", async () => {
  const brand = freshBrand();
  const { client, log } = callerClient(brand);
  const result = await tool.executor(
    { brand_id: BRAND, country_code: "NG" },
    client,
    "user",
    {},
  ) as Any;
  assertEquals(log, [
    "rpc biz_set_brand_payout_country NG",
    "invoke brand-paystack-onboard select_provider",
  ]);
  assertEquals(brand.default_currency, "NGN");
  assertEquals(result.payout_provider, "paystack");
});

Deno.test("payout country: leaving a Paystack rail is the server's job (one write)", async () => {
  const brand = freshBrand({ payment_provider: "paystack", payout_country: "NG" });
  const { client, log } = callerClient(brand);
  await tool.executor({ brand_id: BRAND, country_code: "IE" }, client, "u", {});
  assertEquals(log, ["rpc biz_set_brand_payout_country IE"]);
  assertEquals(brand.default_currency, "EUR");
});

Deno.test("payout country: refusals are never reported as done (#4389 D7)", async () => {
  const locked = callerClient(freshBrand(), { refuse: "payout_country_locked" });
  const err = await assertRejects(
    () => tool.executor({ brand_id: BRAND, country_code: "GB" }, locked.client, "u", {}),
    ToolError,
  );
  assertEquals((err as ToolError).code, "PAYOUT_COUNTRY_LOCKED");
  const unsupported = callerClient(freshBrand());
  const err2 = await assertRejects(
    () => tool.executor({ brand_id: BRAND, country_code: "AU" }, unsupported.client, "u", {}),
    ToolError,
  );
  assertEquals((err2 as ToolError).code, "PAYOUT_COUNTRY_UNSUPPORTED");
  assertEquals(unsupported.log, []);
  const denied = callerClient(freshBrand(), { refuse: "forbidden" });
  const err3 = await assertRejects(
    () => tool.executor({ brand_id: BRAND, country_code: "GB" }, denied.client, "u", {}),
    ToolError,
  );
  assertEquals((err3 as ToolError).code, "FORBIDDEN");
  for (
    const code of [
      "PAYOUT_COUNTRY_LOCKED",
      "PAYOUT_COUNTRY_UNSUPPORTED",
      "PAYOUT_COUNTRY_NOT_SAVED",
      "FORBIDDEN",
    ]
  ) {
    assertEquals(toolErrorHttpStatus(code), 409, code);
  }
});

Deno.test("payout country: the list is the Host chooser's (card countries + Nigeria)", () => {
  assertEquals(
    PAYOUT_COUNTRIES.map((r) => r.country).sort(),
    [...STRIPE_SUPPORTED_COUNTRIES.map((c) => c.country), "NG"].sort(),
  );
  for (const host of STRIPE_SUPPORTED_COUNTRIES) {
    const rail = payoutRailFor(host.country)!;
    assertEquals(rail.currency, host.defaultCurrency, host.country);
    assertEquals(payoutRailFor(host.displayName)?.country, host.country);
  }
  assertEquals(payoutRailFor("UK")?.country, "GB");
  assertEquals(payoutRailFor("It's in the UK.")?.country, "GB");
  assertEquals(payoutRailFor("Nigeria (NGN)")?.currency, "NGN");
  assertEquals(payoutRailFor("Australia"), null);
});

Deno.test("payout country: a confirmed brand-admin write, registered everywhere the registry requires", () => {
  assert(AGENT_TOOLS.some((t) => t.name === "set_brand_payout_country"));
  assertEquals(READ_ONLY_TOOL_NAMES.has("set_brand_payout_country"), false);
  assertEquals(AGENT_TOOL_AUTHORIZATION.set_brand_payout_country, {
    requiredRole: "brand_admin",
    resource: "brand",
  });
  assertEquals(
    WRITE_TOOL_OWNER_COPY.set_brand_payout_country,
    HOST_COPY.set_brand_payout_country,
  );
});
