// #1981 — Ari charge_installment_now + send_installment_reminder (implementor).
//
// Fails on revert of:
//   - both tool registrations + finance/brand auth
//   - CHARGE confirm on charge_installment_now
//   - invoke of manual-charge-installment / send-installment-reminder
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1981_ari_installments.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOMAIN_TOOLS,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const INSTALLMENT = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

Deno.test("#1981 implementor: charge + reminder registered finance/brand", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.charge_installment_now, {
    requiredRole: "finance_manager",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.send_installment_reminder, {
    requiredRole: "finance_manager",
    resource: "brand",
  });
  assert(MONEY_CONFIRM_TOOLS.has("charge_installment_now"));
  assert(!MONEY_CONFIRM_TOOLS.has("send_installment_reminder"));
  const charge = domainTool("charge_installment_now");
  assertEquals(charge.parameters.required.includes("confirm_phrase"), true);
});

Deno.test("#1981 implementor: charge_installment_now requires CHARGE and invokes edge", async () => {
  const tool = domainTool("charge_installment_now");
  const invoked: { name: string; body: Record<string, unknown> } = {
    name: "",
    body: {},
  };
  const client = {
    functions: {
      invoke: (name: string, opts: { body: Record<string, unknown> }) => {
        invoked.name = name;
        invoked.body = opts.body;
        return Promise.resolve({ data: { ok: true, chargeId: "ch_1" }, error: null });
      },
    },
  };
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, installment_id: INSTALLMENT, confirm_phrase: "NOPE" },
        client as never,
        USER,
      ),
    ToolError,
  );
  const result = await tool.executor(
    {
      brand_id: BRAND,
      installment_id: INSTALLMENT,
      at_risk_override: true,
      confirm_phrase: "CHARGE",
    },
    client as never,
    USER,
  );
  assertEquals(invoked.name, "manual-charge-installment");
  assertEquals(invoked.body, {
    installmentId: INSTALLMENT,
    atRiskOverride: true,
  });
  assertEquals(result, { ok: true, chargeId: "ch_1" });
});

Deno.test("#1981 implementor: send_installment_reminder invokes edge with orderId", async () => {
  const tool = domainTool("send_installment_reminder");
  const invoked: { name: string; body: Record<string, unknown> } = {
    name: "",
    body: {},
  };
  const client = {
    functions: {
      invoke: (name: string, opts: { body: Record<string, unknown> }) => {
        invoked.name = name;
        invoked.body = opts.body;
        return Promise.resolve({
          data: { ok: true, deliveredVia: ["email"] },
          error: null,
        });
      },
    },
  };
  const result = await tool.executor(
    { brand_id: BRAND, order_id: ORDER },
    client as never,
    USER,
  );
  assertEquals(invoked.name, "send-installment-reminder");
  assertEquals(invoked.body, { orderId: ORDER });
  assertEquals(result.ok, true);
});
