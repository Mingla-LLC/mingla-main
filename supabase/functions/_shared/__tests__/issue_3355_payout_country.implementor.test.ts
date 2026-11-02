// Issue #3355 P7 (Phase 7 certification fix) — Ari's payout-country pick is
// the Host chooser's pick (BrandPayoutCountryField), made as the caller.
//
// MINGLA-INVARIANT: I-ARI-PAYOUT-COUNTRY-HOST-PARITY | issue #3355 | Ari sets a brand's payout country only through the confirmed write set_brand_payout_country, which makes the Host chooser's writes as the caller and nothing else: Nigeria calls brand-paystack-onboard select_provider (the server sets the Nigerian rail and naira); any other supported country clears a Paystack rail if one is set, updates brands.default_currency, then remembers brands.payout_country. A brand that already has a different currency, or an unsupported country, is refused with nothing written.
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

/** The caller's own Supabase client over one brand row, with a call log. */
function callerClient(brand: Brand, opts: { canUpdate?: boolean } = {}) {
  const log: string[] = [];
  const client: Any = {
    from(table: string) {
      assertEquals(table, "brands");
      let patch: Record<string, unknown> | null = null;
      const self: Any = {
        select: () => self,
        eq: () => self,
        is: () => self,
        update(next: Record<string, unknown>) {
          patch = next;
          return self;
        },
        maybeSingle: () => Promise.resolve({ data: { ...brand }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          // update(...).eq().is().select("id")
          if (!patch) return resolve({ data: [], error: null });
          log.push(`update ${JSON.stringify(patch)}`);
          if (opts.canUpdate === false) return resolve({ data: [], error: null });
          Object.assign(brand, patch);
          return resolve({ data: [{ id: brand.id }], error: null });
        },
      };
      return self;
    },
    functions: {
      invoke(name: string, init: { body: Record<string, unknown> }) {
        log.push(`invoke ${name} ${init.body.action}`);
        if (init.body.action === "select_provider") {
          Object.assign(brand, {
            payment_provider: "paystack",
            default_currency: "NGN",
          });
        }
        if (init.body.action === "clear_provider") {
          Object.assign(brand, { payment_provider: null });
        }
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

Deno.test("payout country: the United Kingdom sets GBP, then remembers GB (the Host's order)", async () => {
  const brand = freshBrand();
  const { client, log } = callerClient(brand);
  const result = await tool.executor(
    { brand_id: BRAND, country_code: "GB" },
    client,
    "user",
    {},
  ) as Any;
  assertEquals(log, [
    'update {"default_currency":"GBP"}',
    'update {"payout_country":"GB"}',
  ]);
  assertEquals(brand.default_currency, "GBP");
  assertEquals(result.currency, "GBP");
  assertEquals(result.country_name, "United Kingdom");
});

Deno.test("payout country: Nigeria goes through select_provider (server sets the rail and naira)", async () => {
  const brand = freshBrand();
  const { client, log } = callerClient(brand);
  const result = await tool.executor(
    { brand_id: BRAND, country_code: "NG" },
    client,
    "user",
    {},
  ) as Any;
  assertEquals(log, [
    "invoke brand-paystack-onboard select_provider",
    'update {"payout_country":"NG"}',
  ]);
  assertEquals(brand.default_currency, "NGN");
  assertEquals(result.payout_provider, "paystack");
});

Deno.test("payout country: leaving a Paystack rail clears it before the new currency", async () => {
  const brand = freshBrand({ payment_provider: "paystack" });
  const { client, log } = callerClient(brand);
  await tool.executor({ brand_id: BRAND, country_code: "IE" }, client, "u", {});
  assertEquals(log, [
    "invoke brand-paystack-onboard clear_provider",
    'update {"default_currency":"EUR"}',
    'update {"payout_country":"IE"}',
  ]);
});

Deno.test("payout country: refusals write nothing", async () => {
  const set = freshBrand({ default_currency: "USD" });
  const first = callerClient(set);
  const err = await assertRejects(
    () => tool.executor({ brand_id: BRAND, country_code: "GB" }, first.client, "u", {}),
    ToolError,
  );
  assertEquals((err as ToolError).code, "PAYOUT_COUNTRY_ALREADY_SET");
  assertEquals(first.log, []);
  const unsupported = callerClient(freshBrand());
  const err2 = await assertRejects(
    () => tool.executor({ brand_id: BRAND, country_code: "AU" }, unsupported.client, "u", {}),
    ToolError,
  );
  assertEquals((err2 as ToolError).code, "PAYOUT_COUNTRY_UNSUPPORTED");
  assertEquals(unsupported.log, []);
  const denied = callerClient(freshBrand(), { canUpdate: false });
  const err3 = await assertRejects(
    () => tool.executor({ brand_id: BRAND, country_code: "GB" }, denied.client, "u", {}),
    ToolError,
  );
  assertEquals((err3 as ToolError).code, "PERMISSION_DENIED");
  for (const code of ["PAYOUT_COUNTRY_ALREADY_SET", "PAYOUT_COUNTRY_UNSUPPORTED", "PAYOUT_COUNTRY_NOT_SAVED"]) {
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
  assertEquals(WRITE_TOOL_OWNER_COPY.set_brand_payout_country, HOST_COPY.set_brand_payout_country);
});
